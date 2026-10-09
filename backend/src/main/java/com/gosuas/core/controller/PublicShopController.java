package com.gosuas.core.controller;

import com.gosuas.core.entity.Product;
import com.gosuas.core.entity.ShopOrder;
import com.gosuas.core.entity.ShopOrderItem;
import com.gosuas.core.entity.Tenant;
import com.gosuas.core.repository.ProductRepository;
import com.gosuas.core.repository.ShopOrderRepository;
import com.gosuas.core.repository.TenantRepository;
import jakarta.transaction.Transactional;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;

@RestController
@RequestMapping("/api/public")
@RequiredArgsConstructor
public class PublicShopController {

    private final ProductRepository productRepository;
    private final ShopOrderRepository shopOrderRepository;
    private final TenantRepository tenantRepository;

    @GetMapping("/shop-info")
    public ResponseEntity<Map<String, Object>> getShopInfo(@RequestParam String subdomain) {
        return tenantRepository.findBySubdomain(subdomain.toLowerCase())
                .map(t -> {
                    Map<String, Object> info = new java.util.LinkedHashMap<>();
                    info.put("name", t.getName());
                    info.put("subdomain", t.getSubdomain());
                    info.put("logoUrl", t.getLogoUrl());
                    info.put("bannerUrl", t.getBannerUrl());
                    info.put("phoneNumber", t.getPhoneNumber());
                    return ResponseEntity.ok(info);
                })
                .orElse(ResponseEntity.notFound().build());
    }

    @GetMapping("/products")
    public List<Product> listPublicProducts(@RequestParam(required = false) String subdomain) {
        if (subdomain != null && !subdomain.isBlank()) {
            return tenantRepository.findBySubdomain(subdomain.toLowerCase())
                    .map(t -> productRepository.findAllByTenantId(t.getId()).stream()
                            .filter(p -> Boolean.TRUE.equals(p.getActive()))
                            .toList())
                    .orElse(List.of());
        }
        // Backward-compat fallback: all active products
        return productRepository.findAll().stream()
                .filter(p -> Boolean.TRUE.equals(p.getActive()))
                .toList();
    }

    @PostMapping("/orders")
    @Transactional
    public ShopOrder placeOrder(@RequestBody Map<String, Object> body) {
        String customerPhone = (String) body.get("customerPhone");
        if (customerPhone == null || !customerPhone.trim().matches("\\d{10}")) {
            throw new IllegalArgumentException("Enter a valid 10-digit mobile number.");
        }
        String customerName = (String) body.get("customerName");
        if (customerName == null || customerName.trim().isEmpty()) {
            throw new IllegalArgumentException("Customer name is required.");
        }
        String houseNo  = (String) body.getOrDefault("houseNo", "");
        String street   = (String) body.getOrDefault("street", "");
        String city     = (String) body.getOrDefault("city", "");
        String pincode  = (String) body.getOrDefault("pincode", "");
        String state    = (String) body.getOrDefault("state", "");
        if (houseNo.trim().isEmpty() || street.trim().isEmpty() || city.trim().isEmpty()
                || pincode.trim().isEmpty() || state.trim().isEmpty()) {
            throw new IllegalArgumentException("Delivery address is required — please fill in all address fields.");
        }

        String subdomain = (String) body.getOrDefault("subdomain", null);
        Tenant tenant = subdomain != null
                ? tenantRepository.findBySubdomain(subdomain.toLowerCase()).orElse(null)
                : null;
        UUID tenantId = tenant != null ? tenant.getId() : null;

        String razorpayOrderId   = (String) body.getOrDefault("razorpayOrderId", null);
        String razorpayPaymentId = (String) body.getOrDefault("razorpayPaymentId", null);
        String razorpaySignature = (String) body.getOrDefault("razorpaySignature", null);
        if (tenant == null || !tenant.isRazorpayMerchantConnected()) {
            throw new IllegalArgumentException("This shop hasn't set up payments yet.");
        }
        try {
            if (!PublicPaymentController.verifySignature(tenant, razorpayOrderId, razorpayPaymentId, razorpaySignature)) {
                throw new IllegalArgumentException("Payment could not be verified.");
            }
        } catch (Exception e) {
            throw new IllegalArgumentException("Payment could not be verified.");
        }

        ShopOrder order = new ShopOrder();
        order.setTenantId(tenantId);
        order.setOrderNo(generateOrderNo(tenantId));
        order.setCustomerName(customerName.trim());
        order.setCustomerPhone(customerPhone.trim());
        order.setHouseNo(houseNo);
        order.setStreet(street);
        order.setCity(city);
        order.setPincode(pincode);
        order.setState(state);
        order.setCountry((String) body.getOrDefault("country", "India"));

        @SuppressWarnings("unchecked")
        List<Map<String, Object>> itemsData = (List<Map<String, Object>>) body.get("items");

        List<ShopOrderItem> items = new ArrayList<>();
        BigDecimal total = BigDecimal.ZERO;

        for (Map<String, Object> i : itemsData) {
            String barcode = (String) i.get("barcode");
            int qty = ((Number) i.get("quantity")).intValue();

            Product product = (tenantId != null)
                    ? productRepository.findByBarcodeAndTenantId(barcode, tenantId)
                            .orElseThrow(() -> new RuntimeException("Product not found: " + barcode))
                    : productRepository.findByBarcode(barcode)
                            .orElseThrow(() -> new RuntimeException("Product not found: " + barcode));

            BigDecimal price = product.getSellingPrice();
            BigDecimal lineTotal = price.multiply(BigDecimal.valueOf(qty));

            items.add(ShopOrderItem.builder()
                    .order(order)
                    .productId(product.getId())
                    .productName(product.getName())
                    .barcode(barcode)
                    .unitPrice(price)
                    .quantity(qty)
                    .lineTotal(lineTotal)
                    .selectedColor((String) i.getOrDefault("selectedColor", null))
                    .selectedSize((String) i.getOrDefault("selectedSize", null))
                    .build());

            total = total.add(lineTotal);
            product.setStockQty(product.getStockQty() - qty);
            product.setSoldCount((product.getSoldCount() == null ? 0 : product.getSoldCount()) + qty);
            productRepository.save(product);
        }

        order.setItems(items);
        order.setTotalAmount(total);
        order.setRazorpayOrderId(razorpayOrderId);
        order.setRazorpayPaymentId(razorpayPaymentId);
        order.setPaymentStatus("PAID");
        order.setStatus("CONFIRMED");
        return shopOrderRepository.save(order);
    }

    @GetMapping("/orders/track")
    public ResponseEntity<?> trackOrder(
            @RequestParam(required = false) String orderId,
            @RequestParam(required = false) String phone,
            @RequestParam(required = false) String subdomain) {

        if (subdomain == null || subdomain.isBlank()) {
            return ResponseEntity.badRequest().body(Map.of("error", "subdomain is required"));
        }
        UUID tenantId = tenantRepository.findBySubdomain(subdomain.toLowerCase())
                .map(Tenant::getId).orElse(null);
        if (tenantId == null) {
            return ResponseEntity.notFound().build();
        }

        if (orderId != null && !orderId.isBlank()) {
            return shopOrderRepository.findByOrderNoAndTenantId(orderId.trim().toUpperCase(), tenantId)
                    .map(ResponseEntity::ok)
                    .orElse(ResponseEntity.notFound().build());
        }
        if (phone != null && !phone.isBlank()) {
            List<ShopOrder> orders = shopOrderRepository.findByCustomerPhoneAndTenantId(phone.trim(), tenantId);
            if (orders.isEmpty()) return ResponseEntity.notFound().build();
            return ResponseEntity.ok(orders);
        }
        return ResponseEntity.badRequest().build();
    }

    // MAX-based, not COUNT-based — a failed/rolled-back order leaves a gap, which would make
    // count-based numbering collide on the same number forever. See BillService.generateBillNo.
    private String generateOrderNo(UUID tenantId) {
        String prefix = "WEB-" + LocalDate.now().format(DateTimeFormatter.BASIC_ISO_DATE) + "-";
        List<ShopOrder> existing = (tenantId != null)
                ? shopOrderRepository.findAllByTenantIdAndOrderNoStartingWith(tenantId, prefix)
                : shopOrderRepository.findAllByOrderNoStartingWith(prefix);
        int maxSeq = existing.stream()
                .mapToInt(o -> {
                    try { return Integer.parseInt(o.getOrderNo().substring(prefix.length())); }
                    catch (Exception e) { return 0; }
                })
                .max().orElse(0);
        return prefix + String.format("%04d", maxSeq + 1);
    }
}
