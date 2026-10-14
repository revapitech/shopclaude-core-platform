package com.gosuas.core.service;

import com.gosuas.core.config.TenantContext;
import com.gosuas.core.dto.BillItemRequest;
import com.gosuas.core.dto.BillItemResponse;
import com.gosuas.core.dto.BillRequest;
import com.gosuas.core.dto.BillResponse;
import com.gosuas.core.dto.PaymentEntryRequest;
import com.gosuas.core.dto.PaymentEntryResponse;
import com.gosuas.core.entity.Bill;
import com.gosuas.core.entity.BillItem;
import com.gosuas.core.entity.BillPayment;
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
        bill.setPaymentStatus("PAID");
        bill.setDiscountAmount(request.discountAmount() == null ? BigDecimal.ZERO : request.discountAmount());
        bill.setItems(new ArrayList<>());
        bill.setPayments(new ArrayList<>());

        BigDecimal subTotal = BigDecimal.ZERO;

        for (BillItemRequest itemRequest : request.items()) {
            Product product = productRepository.findByBarcodeAndTenantId(itemRequest.barcode(), tenantId)
                    .orElseThrow(() -> new RuntimeException("Product not found: " + itemRequest.barcode()));

            int updated = productRepository.decrementStock(product.getId(), tenantId, itemRequest.quantity());
            if (updated == 0) {
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
            subTotal = subTotal.add(lineTotal);
        }

        bill.setSubTotal(subTotal);
        BigDecimal grandTotal = subTotal.subtract(bill.getDiscountAmount());
        bill.setGrandTotal(grandTotal);

        List<PaymentEntryRequest> splitPayments = request.splitPayments();
        if (splitPayments != null && !splitPayments.isEmpty()) {
            BigDecimal splitSum = BigDecimal.ZERO;
            for (PaymentEntryRequest entry : splitPayments) {
                if (entry.method() == null || entry.method().isBlank()) {
                    throw new IllegalArgumentException("Payment method must not be blank");
                }
                if (entry.amount() == null || entry.amount().compareTo(BigDecimal.ZERO) <= 0) {
                    throw new IllegalArgumentException("Payment amount must be greater than zero");
                }
                splitSum = splitSum.add(entry.amount());
            }
            if (splitSum.compareTo(grandTotal) != 0) {
                throw new IllegalArgumentException(
                        "Split payment total (" + splitSum + ") does not match bill total (" + grandTotal + ")");
            }
            bill.setPaymentMode("SPLIT");
            for (PaymentEntryRequest entry : splitPayments) {
                bill.getPayments().add(BillPayment.builder()
                        .bill(bill)
                        .method(entry.method().trim().toUpperCase())
                        .amount(entry.amount())
                        .build());
            }
        } else {
            bill.setPaymentMode(request.paymentMode());
        }

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
        List<PaymentEntryResponse> payments = bill.getPayments().stream()
                .map(p -> new PaymentEntryResponse(p.getMethod(), p.getAmount()))
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
                items,
                payments);
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
