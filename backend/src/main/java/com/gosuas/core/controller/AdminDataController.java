package com.gosuas.core.controller;

import com.gosuas.core.config.TenantContext;
import com.gosuas.core.entity.*;
import com.gosuas.core.repository.*;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.*;
import java.util.UUID;
import java.util.stream.Collectors;

@RestController
@RequestMapping("/api/admin")
@RequiredArgsConstructor
public class AdminDataController {

    private final CustomerDetailRepository customerRepo;
    private final OrderDetailRepository orderRepo;
    private final BillRepository billRepo;
    private final ShopOrderRepository shopOrderRepo;

    // ── Customers ────────────────────────────────────────────────────────────
    @GetMapping("/customers")
    public List<Map<String, Object>> listCustomers() {
        UUID tenantId = TenantContext.getTenantId();
        return customerRepo.findAllByTenantId(tenantId).stream().map(c -> {
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("id",          c.getId().toString());
            m.put("firstName",   c.getFirstName()  != null ? c.getFirstName()  : "");
            m.put("lastName",    c.getLastName()   != null ? c.getLastName()   : "");
            m.put("email",       c.getEmail()      != null ? c.getEmail()      : "");
            m.put("phone",       c.getPhone()      != null ? c.getPhone()      : "");
            m.put("city",        c.getCity()       != null ? c.getCity()       : "");
            m.put("state",       c.getState()      != null ? c.getState()      : "");
            m.put("address",     c.getAddress()    != null ? c.getAddress()    : "");
            m.put("totalSpent",  c.getTotalSpent() != null ? c.getTotalSpent() : 0);
            m.put("totalOrders", c.getTotalOrders()!= null ? c.getTotalOrders(): 0);
            return m;
        }).collect(Collectors.toList());
    }

    // ── All Orders (Shopify imported + POS bills + Online shop orders) ───────
    @GetMapping("/orders")
    public List<Map<String, Object>> listOrders() {
        UUID tenantId = TenantContext.getTenantId();
        List<Map<String, Object>> all = new ArrayList<>();

        // 1. Imported Shopify orders
        orderRepo.findAllWithItemsByTenantId(tenantId).forEach(o -> {
            List<Map<String, Object>> items = o.getItems() != null
                ? o.getItems().stream().map(i -> {
                    Map<String, Object> im = new LinkedHashMap<>();
                    im.put("productName", i.getProductName() != null ? i.getProductName() : "");
                    im.put("sku",         i.getSku()         != null ? i.getSku()         : "");
                    im.put("quantity",    i.getQuantity()    != null ? i.getQuantity()    : 0);
                    im.put("price",       i.getPrice()       != null ? i.getPrice()       : 0);
                    im.put("color",       "");
                    im.put("size",        "");
                    return im;
                }).collect(Collectors.toList())
                : List.of();

            Map<String, Object> m = new LinkedHashMap<>();
            m.put("id",                o.getId().toString());
            m.put("source",            "SHOPIFY");
            m.put("orderNumber",       o.getOrderNumber()       != null ? o.getOrderNumber()       : "");
            m.put("customerName",      o.getCustomerName()      != null ? o.getCustomerName()      : "");
            m.put("customerContact",   o.getCustomerEmail()     != null ? o.getCustomerEmail()     : "");
            m.put("financialStatus",   o.getFinancialStatus()   != null ? o.getFinancialStatus()   : "");
            m.put("fulfillmentStatus", o.getFulfillmentStatus() != null ? o.getFulfillmentStatus() : "");
            m.put("paymentMethod",     o.getPaymentMethod()     != null ? o.getPaymentMethod()     : "");
            m.put("total",             o.getTotal()             != null ? o.getTotal()             : 0);
            m.put("orderedAt",         o.getOrderedAt()         != null ? o.getOrderedAt().toString() : "");
            m.put("shippingAddress",   o.getShippingAddress()   != null ? o.getShippingAddress()   : "");
            m.put("city",              o.getShippingCity()      != null ? o.getShippingCity()      : "");
            m.put("phone",             o.getShippingPhone()     != null ? o.getShippingPhone()     : "");
            m.put("items",             items);
            all.add(m);
        });

        // 2. POS Bills (offline billing)
        billRepo.findAllByTenantId(tenantId).forEach(b -> {
            List<Map<String, Object>> items = b.getItems() != null
                ? b.getItems().stream().map(i -> {
                    Map<String, Object> im = new LinkedHashMap<>();
                    im.put("productName", i.getProductName() != null ? i.getProductName() : "");
                    im.put("sku",         i.getBarcode()     != null ? i.getBarcode()     : "");
                    im.put("quantity",    i.getQuantity()    != null ? i.getQuantity()    : 0);
                    im.put("price",       i.getUnitPrice()   != null ? i.getUnitPrice()   : 0);
                    im.put("color",       "");
                    im.put("size",        "");
                    return im;
                }).collect(Collectors.toList())
                : List.of();

            Map<String, Object> m = new LinkedHashMap<>();
            m.put("id",                b.getId().toString());
            m.put("source",            "POS");
            m.put("orderNumber",       b.getBillNo()          != null ? b.getBillNo()          : "");
            m.put("customerName",      b.getCustomerName()    != null ? b.getCustomerName()    : "Walk-in");
            m.put("customerContact",   b.getCustomerMobile()  != null ? b.getCustomerMobile()  : "");
            m.put("financialStatus",   b.getPaymentStatus()   != null ? b.getPaymentStatus()   : "paid");
            m.put("fulfillmentStatus", "fulfilled");
            m.put("paymentMethod",     b.getPaymentMode()     != null ? b.getPaymentMode()     : "");
            m.put("total",             b.getGrandTotal()      != null ? b.getGrandTotal()      : 0);
            m.put("orderedAt",         b.getBillDate()        != null ? b.getBillDate().toString() : "");
            m.put("city",              "");
            m.put("phone",             b.getCustomerMobile()  != null ? b.getCustomerMobile()  : "");
            m.put("items",             items);
            all.add(m);
        });

        // 3. Online shop orders
        shopOrderRepo.findAllByTenantId(tenantId).forEach(o -> {
            List<Map<String, Object>> items = o.getItems() != null
                ? o.getItems().stream().map(i -> {
                    Map<String, Object> im = new LinkedHashMap<>();
                    im.put("productName", i.getProductName()   != null ? i.getProductName()   : "");
                    im.put("sku",         i.getBarcode()       != null ? i.getBarcode()       : "");
                    im.put("quantity",    i.getQuantity()      != null ? i.getQuantity()      : 0);
                    im.put("price",       i.getUnitPrice()     != null ? i.getUnitPrice()     : 0);
                    im.put("color",       i.getSelectedColor() != null ? i.getSelectedColor() : "");
                    im.put("size",        i.getSelectedSize()  != null ? i.getSelectedSize()  : "");
                    return im;
                }).collect(Collectors.toList())
                : List.of();

            Map<String, Object> m = new LinkedHashMap<>();
            m.put("id",                o.getId().toString());
            m.put("source",            "ONLINE");
            m.put("orderNumber",       o.getOrderNo()        != null ? o.getOrderNo()        : "");
            m.put("customerName",      o.getCustomerName()   != null ? o.getCustomerName()   : "");
            m.put("customerContact",   o.getCustomerPhone()  != null ? o.getCustomerPhone()  : "");
            m.put("financialStatus",   "paid");
            m.put("fulfillmentStatus", o.getStatus()         != null ? o.getStatus().toLowerCase() : "pending");
            m.put("paymentMethod",     "Online");
            m.put("total",             o.getTotalAmount()    != null ? o.getTotalAmount()    : 0);
            m.put("orderedAt",         o.getCreatedAt()      != null ? o.getCreatedAt().toString() : "");
            m.put("houseNo",           o.getHouseNo()        != null ? o.getHouseNo()        : "");
            m.put("street",            o.getStreet()         != null ? o.getStreet()         : "");
            m.put("city",              o.getCity()           != null ? o.getCity()           : "");
            m.put("pincode",           o.getPincode()        != null ? o.getPincode()        : "");
            m.put("state",             o.getState()          != null ? o.getState()          : "");
            m.put("country",           o.getCountry()        != null ? o.getCountry()        : "India");
            m.put("phone",             o.getCustomerPhone()  != null ? o.getCustomerPhone()  : "");
            m.put("items",             items);
            all.add(m);
        });

        // Sort all by date descending
        all.sort((a, b) -> {
            String da = (String) a.getOrDefault("orderedAt", "");
            String db = (String) b.getOrDefault("orderedAt", "");
            return db.compareTo(da);
        });

        return all;
    }

    // ── Update online order status (CONFIRMED → SHIPPED → DELIVERED, or CANCELLED) ──
    private static final Set<String> ALLOWED_ORDER_STATUSES =
        Set.of("PENDING", "CONFIRMED", "SHIPPED", "DELIVERED", "CANCELLED");

    @PutMapping("/orders/{id}/status")
    public ResponseEntity<?> updateOrderStatus(@PathVariable UUID id, @RequestBody Map<String, String> body) {
        UUID tenantId = TenantContext.getTenantId();
        String status = body.get("status") != null ? body.get("status").trim().toUpperCase() : "";
        if (!ALLOWED_ORDER_STATUSES.contains(status)) {
            return ResponseEntity.badRequest().body(Map.of("error", "Invalid status: " + status));
        }
        return shopOrderRepo.findById(id)
            .filter(o -> tenantId.equals(o.getTenantId()))
            .map(o -> {
                o.setStatus(status);
                shopOrderRepo.save(o);
                return ResponseEntity.ok(Map.of("id", o.getId().toString(), "status", o.getStatus()));
            })
            .orElse(ResponseEntity.notFound().build());
    }

    // ── Delete an order (any source) — for correcting mistaken entries ───────
    @DeleteMapping("/orders/{id}")
    public ResponseEntity<?> deleteOrder(@PathVariable UUID id, @RequestParam String source) {
        UUID tenantId = TenantContext.getTenantId();
        switch (source.toUpperCase()) {
            case "POS":
                return billRepo.findById(id)
                    .filter(b -> tenantId.equals(b.getTenantId()))
                    .map(b -> { billRepo.delete(b); return ResponseEntity.ok().build(); })
                    .orElse(ResponseEntity.notFound().build());
            case "SHOPIFY":
                return orderRepo.findById(id)
                    .filter(o -> tenantId.equals(o.getTenantId()))
                    .map(o -> { orderRepo.delete(o); return ResponseEntity.ok().build(); })
                    .orElse(ResponseEntity.notFound().build());
            case "ONLINE":
                return shopOrderRepo.findById(id)
                    .filter(o -> tenantId.equals(o.getTenantId()))
                    .map(o -> { shopOrderRepo.delete(o); return ResponseEntity.ok().build(); })
                    .orElse(ResponseEntity.notFound().build());
            default:
                return ResponseEntity.badRequest().body(Map.of("error", "Invalid source: " + source));
        }
    }
}
