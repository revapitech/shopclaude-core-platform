package com.gosuas.core.service;

import com.gosuas.core.config.TenantContext;
import com.gosuas.core.dto.BillItemRequest;
import com.gosuas.core.dto.BillItemResponse;
import com.gosuas.core.dto.BillRequest;
import com.gosuas.core.dto.BillResponse;
import com.gosuas.core.entity.Bill;
import com.gosuas.core.entity.BillItem;
import com.gosuas.core.entity.Product;
import com.gosuas.core.repository.BillRepository;
import com.gosuas.core.repository.ProductRepository;
import jakarta.transaction.Transactional;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

@Service
@RequiredArgsConstructor
public class BillService {
    private final BillRepository billRepository;
    private final ProductRepository productRepository;

    @Transactional
    public BillResponse createBill(BillRequest request) {
        UUID tenantId = TenantContext.getTenantId();
        Bill bill = new Bill();
        bill.setTenantId(tenantId);
        bill.setBillNo(generateBillNo(tenantId));
        bill.setCustomerName(request.customerName());
        bill.setCustomerMobile(request.customerMobile());
        bill.setPaymentMode(request.paymentMode());
        bill.setPaymentStatus("PAID");
        bill.setDiscountAmount(request.discountAmount() == null ? BigDecimal.ZERO : request.discountAmount());
        bill.setItems(new ArrayList<>());

        BigDecimal subTotal = BigDecimal.ZERO;

        for (BillItemRequest itemRequest : request.items()) {
            Product product = productRepository.findByBarcodeAndTenantId(itemRequest.barcode(), tenantId)
                    .orElseThrow(() -> new RuntimeException("Product not found: " + itemRequest.barcode()));

            if (product.getStockQty() < itemRequest.quantity()) {
                throw new RuntimeException("Insufficient stock for: " + product.getName());
            }

            BigDecimal lineTotal = product.getSellingPrice().multiply(BigDecimal.valueOf(itemRequest.quantity()));
            BillItem item = BillItem.builder()
                    .bill(bill)
                    .product(product)
                    .productName(product.getName())
                    .barcode(product.getBarcode())
                    .quantity(itemRequest.quantity())
                    .unitPrice(product.getSellingPrice())
                    .lineTotal(lineTotal)
                    .build();

            bill.getItems().add(item);
            product.setStockQty(product.getStockQty() - itemRequest.quantity());
            productRepository.save(product);
            subTotal = subTotal.add(lineTotal);
        }

        bill.setSubTotal(subTotal);
        bill.setGrandTotal(subTotal.subtract(bill.getDiscountAmount()));
        return mapToResponse(billRepository.save(bill));
    }

    @Transactional
    public List<BillResponse> listBills() {
        return billRepository.findAllByTenantId(TenantContext.getTenantId()).stream()
                .map(this::mapToResponse)
                .toList();
    }

    // Lets the billing screen auto-fill a returning walk-in customer's name once their mobile
    // number matches a previous bill, instead of asking for it again.
    public String findCustomerNameByMobile(String mobile) {
        return billRepository.findFirstByTenantIdAndCustomerMobileOrderByBillDateDesc(TenantContext.getTenantId(), mobile)
                .map(Bill::getCustomerName)
                .filter(name -> name != null && !name.isBlank() && !"Walk-in Customer".equalsIgnoreCase(name))
                .orElse(null);
    }

    private BillResponse mapToResponse(Bill bill) {
        List<BillItemResponse> items = bill.getItems().stream()
                .map(i -> new BillItemResponse(
                        i.getId(),
                        i.getProductName(),
                        i.getBarcode(),
                        i.getQuantity(),
                        i.getUnitPrice(),
                        i.getLineTotal()))
                .toList();
        return new BillResponse(
                bill.getId(),
                bill.getBillNo(),
                bill.getCustomerName(),
                bill.getCustomerMobile(),
                bill.getSubTotal(),
                bill.getDiscountAmount(),
                bill.getGrandTotal(),
                bill.getPaymentMode(),
                bill.getPaymentStatus(),
                bill.getBillDate(),
                items);
    }

    // COUNT-based numbering breaks the moment any bill fails/rolls back (a stock check failure,
    // a past race, etc.) and leaves a gap — count stays the same forever, so "count+1" keeps
    // recomputing the same already-used number. MAX-based is immune to gaps: it always picks
    // the number one past whatever's actually the highest, regardless of what's missing below it.
    private String generateBillNo(UUID tenantId) {
        String prefix = "GOS-" + LocalDate.now().format(DateTimeFormatter.BASIC_ISO_DATE) + "-";
        int maxSeq = billRepository.findAllByTenantIdAndBillNoStartingWith(tenantId, prefix).stream()
                .mapToInt(b -> {
                    try { return Integer.parseInt(b.getBillNo().substring(prefix.length())); }
                    catch (Exception e) { return 0; }
                })
                .max().orElse(0);
        return prefix + String.format("%04d", maxSeq + 1);
    }
}
