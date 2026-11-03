package com.gosuas.core.controller;

import com.gosuas.core.config.TenantContext;
import com.gosuas.core.entity.*;
import com.gosuas.core.repository.*;
import com.gosuas.core.service.ExpenseService;
import lombok.RequiredArgsConstructor;
import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.web.bind.annotation.*;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.*;
import java.util.UUID;
import java.util.stream.Collectors;
import java.util.Objects;

@RestController
@RequestMapping("/api/admin/reports")
@RequiredArgsConstructor
public class ReportsController {

    private final BillRepository        billRepo;
    private final ShopOrderRepository   shopOrderRepo;
    private final OrderDetailRepository orderDetailRepo;
    private final RentalOrderRepository rentalOrderRepo;
    private final DamageStockRepository damageRepo;
    private final ProductRepository     productRepo;
    private final ExpenseRepository     expenseRepo;

    @GetMapping
    public Map<String, Object> getStats(
        @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate from,
        @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate to
    ) {
        UUID tenantId = TenantContext.getTenantId();
        LocalDateTime fromDt = from != null ? from.atStartOfDay()           : LocalDateTime.of(2000,1,1,0,0);
        LocalDateTime toDt   = to   != null ? to.plusDays(1).atStartOfDay() : LocalDateTime.now().plusDays(1);

        // ── POS bills (offline) ──────────────────────────────────────────────
        List<Bill> bills = billRepo.findAllByTenantIdWithPayments(tenantId).stream()
            .filter(b -> b.getBillDate() != null && !b.getBillDate().isBefore(fromDt) && b.getBillDate().isBefore(toDt))
            .collect(Collectors.toList());

        double offlineRevenue = bills.stream().mapToDouble(b -> safeNum(b.getGrandTotal())).sum();
        double offlineDiscount = bills.stream().mapToDouble(b -> safeNum(b.getDiscountAmount())).sum();
        int    offlineOrders  = bills.size();

        // ── GST totals (POS bills only) ───────────────────────────────────────
        double totalTaxableValue = bills.stream().mapToDouble(b -> safeNum(b.getTaxableAmount())).sum();
        double totalCgst  = bills.stream().mapToDouble(b -> safeNum(b.getCgst())).sum();
        double totalSgst  = bills.stream().mapToDouble(b -> safeNum(b.getSgst())).sum();
        double totalIgst  = bills.stream().mapToDouble(b -> safeNum(b.getIgst())).sum();
        double totalGst   = bills.stream().mapToDouble(b -> safeNum(b.getTotalGst())).sum();

        Map<String, Double> paymentMethods = new LinkedHashMap<>();
        bills.forEach(b -> {
            if ("SPLIT".equals(b.getPaymentMode()) && b.getPayments() != null && !b.getPayments().isEmpty()) {
                b.getPayments().forEach(p ->
                    paymentMethods.merge(p.getMethod(), p.getAmount().doubleValue(), Double::sum)
                );
            } else {
                String pm = b.getPaymentMode() != null ? b.getPaymentMode() : "Other";
                paymentMethods.merge(pm, safeNum(b.getGrandTotal()), Double::sum);
            }
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

        // ── Damage Stock ─────────────────────────────────────────────────────
        // Load all damage entries for this tenant, filter to date range.
        List<DamageStock> damages = damageRepo.findAllByTenantIdOrderByCreatedAtDesc(tenantId).stream()
            .filter(d -> d.getCreatedAt() != null && !d.getCreatedAt().isBefore(fromDt) && d.getCreatedAt().isBefore(toDt))
            .collect(Collectors.toList());

        // Build a productId → purchasePrice map in one query (avoids N+1).
        Map<UUID, BigDecimal> productCostMap = productRepo.findAllByTenantId(tenantId).stream()
            .filter(p -> p.getPurchasePrice() != null && p.getId() != null)
            .collect(Collectors.toMap(Product::getId, Product::getPurchasePrice, (a, b) -> a));

        long   totalDamageQty     = damages.stream().mapToLong(d -> d.getDamageQty() != null ? d.getDamageQty() : 0).sum();
        long   totalDamageEntries = damages.size();
        long   affectedSkuCount   = damages.stream().map(DamageStock::getSku).filter(Objects::nonNull).distinct().count();

        // Estimated damage value — only when purchasePrice is known for the product.
        double damageValue = damages.stream().mapToDouble(d -> {
            if (d.getProductId() == null) return 0;
            BigDecimal cost = productCostMap.get(d.getProductId());
            return cost != null ? cost.doubleValue() * (d.getDamageQty() != null ? d.getDamageQty() : 0) : 0;
        }).sum();

        // Damage qty grouped by reason
        Map<String, Long> damageByReason = damages.stream()
            .collect(Collectors.groupingBy(
                d -> d.getReason() != null ? d.getReason() : "OTHER",
                LinkedHashMap::new,
                Collectors.summingLong(d -> d.getDamageQty() != null ? d.getDamageQty() : 0)
            ));

        // Damage qty + estimated value grouped by SKU / product name
        Map<String, long[]> dmgBySkuMap = new LinkedHashMap<>();
        damages.forEach(d -> {
            String key = (d.getSku() != null ? d.getSku() : "?") + "||" + (d.getProductName() != null ? d.getProductName() : "Unknown");
            dmgBySkuMap.computeIfAbsent(key, k -> new long[]{0, 0});
            long qty = d.getDamageQty() != null ? d.getDamageQty() : 0;
            dmgBySkuMap.get(key)[0] += qty;
            if (d.getProductId() != null) {
                BigDecimal cost = productCostMap.get(d.getProductId());
                if (cost != null) dmgBySkuMap.get(key)[1] += Math.round(cost.doubleValue() * qty);
            }
        });

        List<Map<String, Object>> damageByProduct = dmgBySkuMap.entrySet().stream()
            .sorted((a, b) -> Long.compare(b.getValue()[0], a.getValue()[0]))
            .map(e -> {
                String[] parts = e.getKey().split("\\|\\|", 2);
                Map<String, Object> m = new LinkedHashMap<>();
                m.put("sku",   parts[0]);
                m.put("name",  parts.length > 1 ? parts[1] : "Unknown");
                m.put("qty",   e.getValue()[0]);
                m.put("value", e.getValue()[1] > 0 ? e.getValue()[1] : null);
                return m;
            }).collect(Collectors.toList());

        // Damage qty grouped by date (ascending)
        Map<String, Long> dmgByDateMap = new TreeMap<>();
        damages.forEach(d -> {
            String dateKey = d.getCreatedAt() != null ? d.getCreatedAt().toLocalDate().toString() : "unknown";
            dmgByDateMap.merge(dateKey, d.getDamageQty() != null ? (long) d.getDamageQty() : 0L, Long::sum);
        });
        List<Map<String, Object>> damageByDate = dmgByDateMap.entrySet().stream()
            .map(e -> { Map<String, Object> m = new LinkedHashMap<>(); m.put("date", e.getKey()); m.put("qty", e.getValue()); return m; })
            .collect(Collectors.toList());

        // Detailed damage entries (newest first, max 200)
        List<Map<String, Object>> damageEntries = damages.stream().limit(200).map(d -> {
            BigDecimal cost = d.getProductId() != null ? productCostMap.get(d.getProductId()) : null;
            long       qty  = d.getDamageQty() != null ? d.getDamageQty() : 0;
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("id",          d.getId() != null ? d.getId().toString() : null);
            m.put("damageNo",    d.getDamageNo());
            m.put("date",        d.getCreatedAt() != null ? d.getCreatedAt().toLocalDate().toString() : null);
            m.put("productName", d.getProductName());
            m.put("sku",         d.getSku());
            m.put("color",       d.getColor());
            m.put("damageQty",   qty);
            m.put("reason",      d.getReason() != null ? d.getReason() : "OTHER");
            m.put("notes",       d.getNotes());
            m.put("createdBy",   d.getCreatedBy() != null ? d.getCreatedBy().toString() : null);
            m.put("unitCost",    cost != null ? cost.doubleValue() : null);
            m.put("lineValue",   cost != null ? Math.round(cost.doubleValue() * qty) : null);
            return m;
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
        res.put("gstTaxableValue", Math.round(totalTaxableValue * 100.0) / 100.0);
        res.put("gstCgst",         Math.round(totalCgst  * 100.0) / 100.0);
        res.put("gstSgst",         Math.round(totalSgst  * 100.0) / 100.0);
        res.put("gstIgst",         Math.round(totalIgst  * 100.0) / 100.0);
        res.put("gstTotal",        Math.round(totalGst   * 100.0) / 100.0);
        // Damage Stock summary — not counted in revenue or orders
        res.put("totalDamageQty",     totalDamageQty);
        res.put("totalDamageEntries", totalDamageEntries);
        res.put("affectedSkuCount",   affectedSkuCount);
        res.put("damageValue",        Math.round(damageValue * 100.0) / 100.0);
        res.put("damageByReason",     damageByReason);
        res.put("damageByProduct",    damageByProduct);
        res.put("damageByDate",       damageByDate);
        res.put("damageEntries",      damageEntries);

        // ── Expense Summary ──────────────────────────────────────────────────
        LocalDate expFrom = from != null ? from : LocalDate.of(2000, 1, 1);
        LocalDate expTo   = to   != null ? to   : LocalDate.now();

        long       expenseCount = expenseRepo.countByTenantIdAndDateRange(tenantId, expFrom, expTo);
        BigDecimal expenseTotal = expenseRepo.sumByTenantIdAndDateRange(tenantId, expFrom, expTo);
        if (expenseTotal == null) expenseTotal = BigDecimal.ZERO;

        // Seed all 7 categories with zero — missing categories still appear.
        Map<String, Object> expenseByCat = new LinkedHashMap<>();
        for (String cat : ExpenseService.VALID_CATEGORIES) expenseByCat.put(cat, BigDecimal.ZERO);
        expenseRepo.sumByCategoryAndDateRange(tenantId, expFrom, expTo)
                .forEach(row -> expenseByCat.put((String) row[0], row[1]));

        List<Map<String, Object>> expenseDaily = new ArrayList<>();
        expenseRepo.sumByDayAndDateRange(tenantId, expFrom, expTo).forEach(row -> {
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("date",   row[0].toString());
            m.put("amount", row[1]);
            expenseDaily.add(m);
        });

        // Fixed-period expense totals (always relative to today, not affected by the report date filter)
        LocalDate rptToday      = LocalDate.now();
        LocalDate rptWeekStart  = rptToday.minusDays(rptToday.getDayOfWeek().getValue() - 1L);
        LocalDate rptMonthStart = rptToday.withDayOfMonth(1);
        BigDecimal expTotalToday = expenseRepo.sumByTenantIdAndDateRange(tenantId, rptToday, rptToday);
        if (expTotalToday == null) expTotalToday = BigDecimal.ZERO;
        BigDecimal expTotalWeek  = expenseRepo.sumByTenantIdAndDateRange(tenantId, rptWeekStart,  rptToday);
        if (expTotalWeek  == null) expTotalWeek  = BigDecimal.ZERO;
        BigDecimal expTotalMonth = expenseRepo.sumByTenantIdAndDateRange(tenantId, rptMonthStart, rptToday);
        if (expTotalMonth == null) expTotalMonth = BigDecimal.ZERO;

        // Individual expense records for the selected period (detail table, max 200)
        List<Map<String, Object>> expenseEntries = expenseRepo
                .findAllByTenantIdAndExpenseDateBetweenOrderByExpenseDateDescCreatedAtDesc(
                        tenantId, expFrom, expTo)
                .stream().limit(200).map(e -> {
                    Map<String, Object> m = new LinkedHashMap<>();
                    m.put("id",              e.getId() != null ? e.getId().toString() : null);
                    m.put("date",            e.getExpenseDate() != null ? e.getExpenseDate().toString() : null);
                    m.put("category",        e.getCategory());
                    m.put("description",     e.getDescription());
                    m.put("paymentMethod",   e.getPaymentMethod());
                    m.put("referenceNumber", e.getReferenceNumber());
                    m.put("amount",          e.getAmount());
                    return m;
                }).collect(Collectors.toList());

        // ── Estimated Operating Profit / Loss ─────────────────────────────────────
        // offlineRevenue is already net of discounts (grandTotal). Add back discounts + refunds to get Gross Sales.
        BigDecimal plGrossSales = BigDecimal.valueOf(
                offlineRevenue + offlineDiscount + onlineRevenue + shopifyRevenue + refundAmount)
                .setScale(2, java.math.RoundingMode.HALF_UP);
        BigDecimal plDiscounts  = BigDecimal.valueOf(offlineDiscount)
                .setScale(2, java.math.RoundingMode.HALF_UP);
        BigDecimal plRefunds    = BigDecimal.valueOf(refundAmount)
                .setScale(2, java.math.RoundingMode.HALF_UP);
        // Net Sales Revenue = Gross Sales - Discounts - Refunds = totalRevenue (POS net + online + non-refunded Shopify)
        BigDecimal plNetSalesRevenue    = BigDecimal.valueOf(totalRevenue).setScale(2, java.math.RoundingMode.HALF_UP);
        BigDecimal plNetOperatingResult = plNetSalesRevenue.subtract(expenseTotal);
        String plMarginPct = plNetSalesRevenue.compareTo(BigDecimal.ZERO) > 0
                ? String.format("%.1f", plNetOperatingResult.doubleValue() / plNetSalesRevenue.doubleValue() * 100.0)
                : null;
        String plStatus = plNetOperatingResult.compareTo(BigDecimal.ZERO) > 0 ? "PROFIT"
                : plNetOperatingResult.compareTo(BigDecimal.ZERO) < 0 ? "LOSS" : "BREAKEVEN";

        res.put("expenseCount",      expenseCount);
        res.put("expenseTotal",      expenseTotal);
        res.put("expenseByCat",      expenseByCat);
        res.put("expenseDaily",      expenseDaily);
        res.put("expTotalToday",     expTotalToday);
        res.put("expTotalWeek",      expTotalWeek);
        res.put("expTotalMonth",     expTotalMonth);
        res.put("expenseEntries",    expenseEntries);
        res.put("plGrossSales",      plGrossSales);
        res.put("plDiscounts",       plDiscounts);
        res.put("plRefunds",         plRefunds);
        res.put("plNetSalesRevenue", plNetSalesRevenue);
        res.put("plExpenses",        expenseTotal);
        res.put("plNetResult",       plNetOperatingResult);
        res.put("plMarginPct",       plMarginPct);
        res.put("plStatus",          plStatus);
        return res;
    }

    private double safeNum(BigDecimal v) { return v != null ? v.doubleValue() : 0; }
}
