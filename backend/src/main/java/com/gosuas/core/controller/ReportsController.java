package com.gosuas.core.controller;

import com.gosuas.core.config.TenantContext;
import com.gosuas.core.entity.*;
import com.gosuas.core.repository.*;
import lombok.RequiredArgsConstructor;
import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.web.bind.annotation.*;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.*;
import java.util.UUID;
import java.util.stream.Collectors;

@RestController
@RequestMapping("/api/admin/reports")
@RequiredArgsConstructor
public class ReportsController {

    private final BillRepository       billRepo;
    private final ShopOrderRepository  shopOrderRepo;
    private final OrderDetailRepository orderDetailRepo;
    private final RentalOrderRepository rentalOrderRepo;

    @GetMapping
    public Map<String, Object> getStats(
        @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate from,
        @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate to
    ) {
        UUID tenantId = TenantContext.getTenantId();
        LocalDateTime fromDt = from != null ? from.atStartOfDay()           : LocalDateTime.of(2000,1,1,0,0);
        LocalDateTime toDt   = to   != null ? to.plusDays(1).atStartOfDay() : LocalDateTime.now().plusDays(1);

        // ── POS bills (offline) ──────────────────────────────────────────────
        List<Bill> bills = billRepo.findAllByTenantId(tenantId).stream()
            .filter(b -> b.getBillDate() != null && !b.getBillDate().isBefore(fromDt) && b.getBillDate().isBefore(toDt))
            .collect(Collectors.toList());

        double offlineRevenue = bills.stream().mapToDouble(b -> safeNum(b.getGrandTotal())).sum();
        double offlineDiscount = bills.stream().mapToDouble(b -> safeNum(b.getDiscountAmount())).sum();
        int    offlineOrders  = bills.size();

        Map<String, Double> paymentMethods = new LinkedHashMap<>();
        bills.forEach(b -> {
            String pm = b.getPaymentMode() != null ? b.getPaymentMode() : "Other";
            paymentMethods.merge(pm, safeNum(b.getGrandTotal()), Double::sum);
        });

        // ── Online shop orders ───────────────────────────────────────────────
        List<ShopOrder> shopOrders = shopOrderRepo.findAllByTenantId(tenantId).stream()
            .filter(o -> o.getCreatedAt() != null && !o.getCreatedAt().isBefore(fromDt) && o.getCreatedAt().isBefore(toDt))
            .collect(Collectors.toList());

        double onlineRevenue = shopOrders.stream().mapToDouble(o -> safeNum(o.getTotalAmount())).sum();
        int    onlineOrders  = shopOrders.size();

        // ── Shopify imported orders ──────────────────────────────────────────
        List<OrderDetail> imported = orderDetailRepo.findAllByTenantId(tenantId).stream()
            .filter(o -> o.getOrderedAt() != null && !o.getOrderedAt().isBefore(fromDt) && o.getOrderedAt().isBefore(toDt))
            .collect(Collectors.toList());

        double shopifyRevenue = imported.stream()
            .filter(o -> !"refunded".equalsIgnoreCase(o.getFinancialStatus()))
            .mapToDouble(o -> safeNum(o.getTotal())).sum();
        double refundAmount   = imported.stream()
            .filter(o -> "refunded".equalsIgnoreCase(o.getFinancialStatus()))
            .mapToDouble(o -> safeNum(o.getTotal())).sum();
        long   refundCount    = imported.stream()
            .filter(o -> "refunded".equalsIgnoreCase(o.getFinancialStatus())).count();
        int    shopifyOrders  = imported.size();

        // ── Rental deposit refunds — money handed back to customers, NOT shop revenue,
        // so it's kept entirely separate from totalRevenue below. ──────────────────
        List<RentalOrder> returnedRentals = rentalOrderRepo.findAllByTenantIdOrderByRentedAtDesc(tenantId).stream()
            .filter(r -> "RETURNED".equals(r.getStatus()))
            .filter(r -> r.getReturnedAt() != null && !r.getReturnedAt().isBefore(fromDt) && r.getReturnedAt().isBefore(toDt))
            .collect(Collectors.toList());
        double rentalReturnAmount = returnedRentals.stream().mapToDouble(r -> safeNum(r.getRefundAmount())).sum();
        double rentalDeductionAmount = returnedRentals.stream().mapToDouble(r -> safeNum(r.getDeductionAmount())).sum();
        long   rentalReturnCount = returnedRentals.size();

        // ── Aggregates ───────────────────────────────────────────────────────
        int    totalOrders   = offlineOrders + onlineOrders + shopifyOrders;
        double totalRevenue  = offlineRevenue + onlineRevenue + shopifyRevenue;
        double avgOrderValue = totalOrders > 0 ? totalRevenue / totalOrders : 0;

        // ── Daily revenue for chart (last 30 days or date range) ─────────────
        LocalDate chartFrom = from != null ? from : LocalDate.now().minusDays(29);
        LocalDate chartTo   = to   != null ? to   : LocalDate.now();
        List<Map<String, Object>> daily = new ArrayList<>();

        for (LocalDate d = chartFrom; !d.isAfter(chartTo); d = d.plusDays(1)) {
            final LocalDate fd = d;
            LocalDateTime dayStart = fd.atStartOfDay();
            LocalDateTime dayEnd   = fd.plusDays(1).atStartOfDay();

            double posAmt = bills.stream()
                .filter(b -> b.getBillDate() != null && !b.getBillDate().isBefore(dayStart) && b.getBillDate().isBefore(dayEnd))
                .mapToDouble(b -> safeNum(b.getGrandTotal())).sum();
            double onAmt = shopOrders.stream()
                .filter(o -> o.getCreatedAt() != null && !o.getCreatedAt().isBefore(dayStart) && o.getCreatedAt().isBefore(dayEnd))
                .mapToDouble(o -> safeNum(o.getTotalAmount())).sum();
            double shAmt = imported.stream()
                .filter(o -> o.getOrderedAt() != null && !o.getOrderedAt().isBefore(dayStart) && o.getOrderedAt().isBefore(dayEnd)
                          && !"refunded".equalsIgnoreCase(o.getFinancialStatus()))
                .mapToDouble(o -> safeNum(o.getTotal())).sum();

            Map<String, Object> dm = new LinkedHashMap<>();
            dm.put("date",    fd.toString());
            dm.put("label",   fd.getDayOfMonth() + " " + fd.getMonth().toString().substring(0,3));
            dm.put("pos",     Math.round(posAmt));
            dm.put("online",  Math.round(onAmt));
            dm.put("shopify", Math.round(shAmt));
            dm.put("total",   Math.round(posAmt + onAmt + shAmt));
            daily.add(dm);
        }

        // ── Top products (offline bills) ─────────────────────────────────────
        Map<String, long[]> prodMap = new LinkedHashMap<>();
        bills.forEach(b -> (b.getItems() != null ? b.getItems() : List.<BillItem>of()).forEach(i -> {
            String name = i.getProductName() != null ? i.getProductName() : "Unknown";
            prodMap.computeIfAbsent(name, k -> new long[]{0, 0});
            prodMap.get(name)[0] += i.getQuantity()  != null ? i.getQuantity()  : 0;
            prodMap.get(name)[1] += i.getLineTotal()  != null ? i.getLineTotal().longValue()  : 0;
        }));
        shopOrders.forEach(o -> (o.getItems() != null ? o.getItems() : List.<ShopOrderItem>of()).forEach(i -> {
            String name = i.getProductName() != null ? i.getProductName() : "Unknown";
            prodMap.computeIfAbsent(name, k -> new long[]{0, 0});
            prodMap.get(name)[0] += i.getQuantity()  != null ? i.getQuantity()  : 0;
            prodMap.get(name)[1] += i.getLineTotal()  != null ? i.getLineTotal().longValue()  : 0;
        }));

        List<Map<String, Object>> topProducts = prodMap.entrySet().stream()
            .sorted((a, b) -> Long.compare(b.getValue()[1], a.getValue()[1]))
            .limit(10)
            .map(e -> {
                Map<String, Object> p = new LinkedHashMap<>();
                p.put("name",    e.getKey());
                p.put("qty",     e.getValue()[0]);
                p.put("revenue", e.getValue()[1]);
                return p;
            }).collect(Collectors.toList());

        // ── Build response ───────────────────────────────────────────────────
        Map<String, Object> res = new LinkedHashMap<>();
        res.put("totalOrders",    totalOrders);
        res.put("totalRevenue",   Math.round(totalRevenue * 100.0) / 100.0);
        res.put("offlineRevenue", Math.round(offlineRevenue * 100.0) / 100.0);
        res.put("onlineRevenue",  Math.round(onlineRevenue * 100.0) / 100.0);
        res.put("shopifyRevenue", Math.round(shopifyRevenue * 100.0) / 100.0);
        res.put("offlineOrders",  offlineOrders);
        res.put("onlineOrders",   onlineOrders);
        res.put("shopifyOrders",  shopifyOrders);
        res.put("avgOrderValue",  Math.round(avgOrderValue * 100.0) / 100.0);
        res.put("offlineDiscount",Math.round(offlineDiscount * 100.0) / 100.0);
        res.put("refundAmount",   Math.round(refundAmount * 100.0) / 100.0);
        res.put("refundCount",    refundCount);
        // Rental deposit refunds — shown separately, excluded from totalRevenue on purpose.
        res.put("rentalReturnAmount",    Math.round(rentalReturnAmount * 100.0) / 100.0);
        res.put("rentalDeductionAmount", Math.round(rentalDeductionAmount * 100.0) / 100.0);
        res.put("rentalReturnCount",     rentalReturnCount);
        res.put("paymentMethods", paymentMethods);
        res.put("daily",          daily);
        res.put("topProducts",    topProducts);
        return res;
    }

    private double safeNum(BigDecimal v) { return v != null ? v.doubleValue() : 0; }
}
