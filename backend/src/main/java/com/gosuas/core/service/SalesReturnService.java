package com.gosuas.core.service;

import com.gosuas.core.config.TenantContext;
import com.gosuas.core.dto.*;
import com.gosuas.core.entity.*;
import com.gosuas.core.repository.*;
import jakarta.transaction.Transactional;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.time.format.DateTimeFormatter;
import java.util.*;
import java.util.stream.Collectors;

@Service
@RequiredArgsConstructor
public class SalesReturnService {

    private final SalesReturnRepository returnRepository;
    private final BillRepository        billRepository;
    private final ShopOrderRepository   shopOrderRepository;
    private final ProductRepository     productRepository;

    private static final Set<String> VALID_SOURCE_TYPES =
            Set.of("POS", "ONLINE", "SHOPIFY", "DIRECT");
    private static final Set<String> TERMINAL_STATUSES =
            Set.of("REJECTED", "COMPLETED", "CANCELLED");

    // ── Create ────────────────────────────────────────────────────────────────

    @Transactional
    public SalesReturnResponse createReturn(SalesReturnRequest request) {
        UUID tenantId = TenantContext.getTenantId();

        if (request.sourceType() == null || !VALID_SOURCE_TYPES.contains(request.sourceType().toUpperCase())) {
            throw new IllegalArgumentException("sourceType must be one of POS, ONLINE, SHOPIFY");
        }
        if (request.sourceBillId() == null && !"DIRECT".equalsIgnoreCase(request.sourceType())) {
            throw new IllegalArgumentException("sourceBillId is required");
        }
        if (request.items() == null || request.items().isEmpty()) {
            throw new IllegalArgumentException("At least one return item is required");
        }
        for (SalesReturnItemRequest item : request.items()) {
            if (item.returnedQty() == null || item.returnedQty() <= 0) {
                throw new IllegalArgumentException(
                        "Return quantity must be greater than zero for barcode: " + item.barcode());
            }
        }

        String srcType = request.sourceType().toUpperCase();
        String sourceBillNo;
        String customerName;
        String customerMobile;
        Map<String, OriginalItemInfo> originals;

        switch (srcType) {
            case "POS" -> {
                Bill bill = billRepository.findById(request.sourceBillId())
                        .filter(b -> tenantId.equals(b.getTenantId()))
                        .orElseThrow(() -> new IllegalArgumentException(
                                "POS bill not found: " + request.sourceBillId()));
                sourceBillNo  = bill.getBillNo();
                customerName  = bill.getCustomerName();
                customerMobile = bill.getCustomerMobile();
                originals = bill.getItems().stream().collect(Collectors.toMap(
                        BillItem::getBarcode,
                        i -> new OriginalItemInfo(
                                i.getProduct() != null ? i.getProduct().getId() : null,
                                i.getProductName(), i.getBarcode(),
                                i.getUnitPrice(), i.getQuantity())));
            }
            case "ONLINE" -> {
                ShopOrder order = shopOrderRepository.findById(request.sourceBillId())
                        .filter(o -> tenantId.equals(o.getTenantId()))
                        .orElseThrow(() -> new IllegalArgumentException(
                                "Online order not found: " + request.sourceBillId()));
                sourceBillNo  = order.getOrderNo();
                customerName  = order.getCustomerName();
                customerMobile = order.getCustomerPhone();
                originals = order.getItems().stream().collect(Collectors.toMap(
                        ShopOrderItem::getBarcode,
                        i -> new OriginalItemInfo(
                                i.getProductId(), i.getProductName(), i.getBarcode(),
                                i.getUnitPrice(), i.getQuantity())));
            }
            case "DIRECT" -> {
                // Walk-in / direct return — no original bill; product is looked up by barcode in the item loop
                sourceBillNo   = "DIRECT";
                customerName   = request.customerName();
                customerMobile = request.customerMobile();
                originals      = Map.of();
            }
            default -> {
                // SHOPIFY — imported data only; no stock link, qty validation skipped
                sourceBillNo  = request.sourceBillId().toString();
                customerName  = null;
                customerMobile = null;
                originals     = Map.of();
            }
        }

        List<SalesReturnItem> returnItems = new ArrayList<>();
        BigDecimal total = BigDecimal.ZERO;

        for (SalesReturnItemRequest itemReq : request.items()) {
            OriginalItemInfo orig = originals.get(itemReq.barcode());

            if (orig == null && !"SHOPIFY".equals(srcType) && !"DIRECT".equals(srcType)) {
                throw new IllegalArgumentException(
                        "Barcode '" + itemReq.barcode() + "' was not found in the original sale");
            }

            if (orig != null) {
                int alreadyReturned = returnRepository.sumReturnedQtyByBillAndBarcode(
                        tenantId, request.sourceBillId(), itemReq.barcode());
                int returnable = orig.qty() - alreadyReturned;
                if (itemReq.returnedQty() > returnable) {
                    throw new IllegalArgumentException(
                            "'" + orig.productName() + "': return qty " + itemReq.returnedQty()
                            + " exceeds returnable qty " + returnable
                            + " (original " + orig.qty() + ", already returned " + alreadyReturned + ")");
                }
            }

            UUID   itemProductId;
            String itemProductName;
            BigDecimal unitPrice;
            if ("DIRECT".equals(srcType)) {
                Product p = productRepository.findByBarcodeAndTenantId(itemReq.barcode(), tenantId)
                        .orElseThrow(() -> new IllegalArgumentException(
                                "Product not found for barcode: " + itemReq.barcode()));
                itemProductId   = p.getId();
                itemProductName = p.getName() + (p.getColor() != null && !p.getColor().isBlank()
                        ? " (" + p.getColor() + ")" : "");
                unitPrice       = p.getSellingPrice() != null ? p.getSellingPrice() : BigDecimal.ZERO;
            } else {
                itemProductId   = orig != null ? orig.productId() : null;
                itemProductName = orig != null ? orig.productName() : itemReq.barcode();
                unitPrice       = orig != null ? orig.unitPrice() : BigDecimal.ZERO;
            }
            BigDecimal lineTotal = unitPrice.multiply(BigDecimal.valueOf(itemReq.returnedQty()));

            returnItems.add(SalesReturnItem.builder()
                    .productId(itemProductId)
                    .productName(itemProductName)
                    .barcode(itemReq.barcode())
                    .returnedQty(itemReq.returnedQty())
                    .unitPrice(unitPrice)
                    .lineTotal(lineTotal)
                    .restockable(itemReq.restockable() != null ? itemReq.restockable() : Boolean.TRUE)
                    .build());

            total = total.add(lineTotal);
        }

        SalesReturn ret = SalesReturn.builder()
                .tenantId(tenantId)
                .returnNo(generateReturnNo(tenantId))
                .sourceType(srcType)
                .sourceBillId(request.sourceBillId())
                .sourceBillNo(sourceBillNo)
                .customerName(customerName)
                .customerMobile(customerMobile)
                .returnDate(request.returnDate() != null ? request.returnDate() : LocalDate.now())
                .returnReason(request.returnReason())
                .remarks(request.remarks())
                .totalReturnAmount(total)
                .refundMode(request.refundMode())
                .status("PENDING")
                .refundStatus("PENDING")
                .stockRestored(false)
                .build();

        returnItems.forEach(item -> item.setSalesReturn(ret));
        ret.setItems(returnItems);

        return toResponse(returnRepository.save(ret));
    }

    // ── Read ──────────────────────────────────────────────────────────────────

    @Transactional
    public List<SalesReturnResponse> listReturns() {
        return returnRepository.findAllByTenantIdOrderByCreatedAtDesc(TenantContext.getTenantId())
                .stream().map(this::toResponse).toList();
    }

    @Transactional
    public SalesReturnResponse getReturn(UUID id) {
        UUID tenantId = TenantContext.getTenantId();
        return returnRepository.findById(id)
                .filter(r -> tenantId.equals(r.getTenantId()))
                .map(this::toResponse)
                .orElseThrow(() -> new RuntimeException("Return not found: " + id));
    }

    // ── Status transition ────────────────────────────────────────────────────

    @Transactional
    public SalesReturnResponse updateStatus(UUID id, String newStatus) {
        UUID tenantId = TenantContext.getTenantId();

        SalesReturn ret = returnRepository.findById(id)
                .filter(r -> tenantId.equals(r.getTenantId()))
                .orElseThrow(() -> new RuntimeException("Return not found: " + id));

        validateTransition(ret.getStatus(), newStatus);

        // Restore stock on APPROVED (only once — stockRestored flag is the idempotency guard)
        if ("APPROVED".equals(newStatus) && !ret.isStockRestored()) {
            restoreStock(ret, tenantId);
            ret.setStockRestored(true);
        }

        // CANCELLED after APPROVED: reverse the stock restoration
        if ("CANCELLED".equals(newStatus) && ret.isStockRestored()) {
            reverseStock(ret, tenantId);
            ret.setStockRestored(false);
        }

        if ("COMPLETED".equals(newStatus)) {
            ret.setRefundStatus("REFUNDED");
        }

        ret.setStatus(newStatus);
        return toResponse(returnRepository.save(ret));
    }

    // ── Preview (for return creation form) ───────────────────────────────────

    @Transactional
    public Map<String, Object> getPreview(String sourceType, String ref) {
        UUID tenantId = TenantContext.getTenantId();
        String srcType = sourceType != null ? sourceType.toUpperCase() : "";

        Map<String, Object> response = new LinkedHashMap<>();
        List<Map<String, Object>> items = new ArrayList<>();

        switch (srcType) {
            case "POS" -> {
                Bill bill = billRepository.findByBillNoAndTenantId(ref.trim().toUpperCase(), tenantId)
                        .orElseThrow(() -> new RuntimeException("Bill not found: " + ref));
                response.put("sourceBillId",   bill.getId().toString());
                response.put("sourceBillNo",   bill.getBillNo());
                response.put("sourceType",     "POS");
                response.put("customerName",   bill.getCustomerName());
                response.put("customerMobile", bill.getCustomerMobile());
                for (BillItem i : bill.getItems()) {
                    int alreadyReturned = returnRepository.sumReturnedQtyByBillAndBarcode(
                            tenantId, bill.getId(), i.getBarcode());
                    int returnable = i.getQuantity() - alreadyReturned;
                    if (returnable > 0) {
                        Map<String, Object> m = new LinkedHashMap<>();
                        m.put("productName",      i.getProductName());
                        m.put("barcode",          i.getBarcode());
                        m.put("unitPrice",        i.getUnitPrice());
                        m.put("originalQty",      i.getQuantity());
                        m.put("alreadyReturnedQty", alreadyReturned);
                        m.put("returnableQty",    returnable);
                        items.add(m);
                    }
                }
            }
            case "ONLINE" -> {
                ShopOrder order = shopOrderRepository.findByOrderNoAndTenantId(ref.trim().toUpperCase(), tenantId)
                        .orElseThrow(() -> new RuntimeException("Online order not found: " + ref));
                response.put("sourceBillId",   order.getId().toString());
                response.put("sourceBillNo",   order.getOrderNo());
                response.put("sourceType",     "ONLINE");
                response.put("customerName",   order.getCustomerName());
                response.put("customerMobile", order.getCustomerPhone());
                for (ShopOrderItem i : order.getItems()) {
                    int alreadyReturned = returnRepository.sumReturnedQtyByBillAndBarcode(
                            tenantId, order.getId(), i.getBarcode());
                    int returnable = i.getQuantity() - alreadyReturned;
                    if (returnable > 0) {
                        Map<String, Object> m = new LinkedHashMap<>();
                        m.put("productName",      i.getProductName());
                        m.put("barcode",          i.getBarcode());
                        m.put("unitPrice",        i.getUnitPrice());
                        m.put("originalQty",      i.getQuantity());
                        m.put("alreadyReturnedQty", alreadyReturned);
                        m.put("returnableQty",    returnable);
                        items.add(m);
                    }
                }
            }
            default -> throw new IllegalArgumentException(
                    "Preview is supported for POS and ONLINE source types only");
        }

        if (items.isEmpty()) {
            throw new IllegalArgumentException(
                    "No returnable items — all quantities have already been fully returned for this sale");
        }

        response.put("items", items);
        return response;
    }

    // ── Internal helpers ─────────────────────────────────────────────────────

    private void restoreStock(SalesReturn ret, UUID tenantId) {
        if ("SHOPIFY".equals(ret.getSourceType())) return;
        for (SalesReturnItem item : ret.getItems()) {
            if (Boolean.TRUE.equals(item.getRestockable()) && item.getProductId() != null) {
                productRepository.restoreStock(item.getProductId(), tenantId, item.getReturnedQty());
            }
        }
    }

    private void reverseStock(SalesReturn ret, UUID tenantId) {
        if ("SHOPIFY".equals(ret.getSourceType())) return;
        for (SalesReturnItem item : ret.getItems()) {
            if (Boolean.TRUE.equals(item.getRestockable()) && item.getProductId() != null) {
                // Use decrementStock — prevents stock going negative even on reversal
                productRepository.decrementStock(item.getProductId(), tenantId, item.getReturnedQty());
            }
        }
    }

    private void validateTransition(String current, String next) {
        boolean valid = switch (current) {
            case "PENDING"  -> Set.of("APPROVED", "REJECTED", "CANCELLED").contains(next);
            case "APPROVED" -> Set.of("COMPLETED", "CANCELLED").contains(next);
            default         -> false;
        };
        if (!valid) {
            throw new IllegalArgumentException(
                    "Cannot transition return from " + current + " to " + next);
        }
    }

    // ── SKU / direct return product lookup ───────────────────────────────────

    @Transactional
    public Map<String, Object> lookupProductForReturn(String sku) {
        UUID tenantId = TenantContext.getTenantId();
        Product p = productRepository.findBySkuAndTenantId(sku.trim(), tenantId)
                .or(() -> productRepository.findByBarcodeAndTenantId(sku.trim(), tenantId))
                .orElseThrow(() -> new RuntimeException("Product not found for SKU/barcode: " + sku));
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("productId",    p.getId().toString());
        result.put("productName",  p.getName() + (p.getColor() != null && !p.getColor().isBlank()
                ? " (" + p.getColor() + ")" : ""));
        result.put("sku",          p.getSku());
        result.put("barcode",      p.getBarcode());
        result.put("sellingPrice", p.getSellingPrice());
        result.put("stockQty",     p.getStockQty());
        result.put("imageUrl",     p.getImageUrl());
        return result;
    }

    private String generateReturnNo(UUID tenantId) {
        String prefix = "RET-" + LocalDate.now().format(DateTimeFormatter.BASIC_ISO_DATE) + "-";
        int maxSeq = returnRepository.findAllByTenantIdAndReturnNoStartingWith(tenantId, prefix)
                .stream()
                .mapToInt(r -> {
                    try { return Integer.parseInt(r.getReturnNo().substring(prefix.length())); }
                    catch (Exception e) { return 0; }
                })
                .max().orElse(0);
        return prefix + String.format("%04d", maxSeq + 1);
    }

    private SalesReturnResponse toResponse(SalesReturn r) {
        List<SalesReturnItemResponse> itemResps = r.getItems().stream()
                .map(i -> new SalesReturnItemResponse(
                        i.getId(), i.getProductName(), i.getBarcode(),
                        i.getReturnedQty(), i.getUnitPrice(), i.getLineTotal(), i.getRestockable()))
                .toList();
        return new SalesReturnResponse(
                r.getId(), r.getReturnNo(), r.getSourceType(),
                r.getSourceBillId(), r.getSourceBillNo(),
                r.getCustomerName(), r.getCustomerMobile(),
                r.getReturnDate(), r.getReturnReason(), r.getRemarks(),
                r.getTotalReturnAmount(), r.getRefundMode(), r.getRefundStatus(),
                r.getStatus(), r.isStockRestored(), r.getCreatedAt(), itemResps);
    }

    // Projection used internally during return creation
    private record OriginalItemInfo(UUID productId, String productName, String barcode,
                                    BigDecimal unitPrice, int qty) {}
}