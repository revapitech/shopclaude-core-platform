package com.gosuas.core.service;

import com.gosuas.core.config.TenantContext;
import com.gosuas.core.dto.ExpenseRequest;
import com.gosuas.core.dto.ExpenseResponse;
import com.gosuas.core.entity.Expense;
import com.gosuas.core.repository.ExpenseRepository;
import jakarta.transaction.Transactional;
import lombok.RequiredArgsConstructor;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.stereotype.Service;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.*;

@Service
@RequiredArgsConstructor
public class ExpenseService {

    private final ExpenseRepository expenseRepository;

    /** Seven predefined categories — order is significant for UI display. */
    public static final List<String> VALID_CATEGORIES = List.of(
            "DAILY_EXPENSE", "RENT", "ELECTRICITY", "WATER_BILL",
            "SALARY", "TRANSPORT", "OTHER_EXPENSE");

    private static final Set<String> VALID_PAYMENT_METHODS =
            Set.of("CASH", "CARD", "UPI", "OTHER");

    // ── Create ────────────────────────────────────────────────────────────────

    @Transactional
    public ExpenseResponse createExpense(ExpenseRequest request) {
        UUID tenantId = TenantContext.getTenantId();
        validate(request);

        Expense expense = Expense.builder()
                .tenantId(tenantId)
                .category(request.category().toUpperCase())
                .amount(request.amount())
                .expenseDate(request.expenseDate())
                .description(request.description())
                .paymentMethod(request.paymentMethod() != null
                        ? request.paymentMethod().toUpperCase() : "CASH")
                .referenceNumber(request.referenceNumber())
                .createdBy(currentUserId())
                .build();

        return toResponse(expenseRepository.save(expense));
    }

    // ── List ──────────────────────────────────────────────────────────────────

    @Transactional
    public List<ExpenseResponse> listExpenses(LocalDate from, LocalDate to) {
        UUID tenantId = TenantContext.getTenantId();
        List<Expense> list = (from != null && to != null)
                ? expenseRepository.findAllByTenantIdAndExpenseDateBetweenOrderByExpenseDateDescCreatedAtDesc(tenantId, from, to)
                : expenseRepository.findAllByTenantIdOrderByExpenseDateDescCreatedAtDesc(tenantId);
        return list.stream().map(this::toResponse).toList();
    }

    // ── Get by ID ─────────────────────────────────────────────────────────────

    @Transactional
    public ExpenseResponse getExpense(UUID id) {
        return toResponse(findOwned(id));
    }

    // ── Update ────────────────────────────────────────────────────────────────

    @Transactional
    public ExpenseResponse updateExpense(UUID id, ExpenseRequest request) {
        validate(request);
        Expense expense = findOwned(id);

        expense.setCategory(request.category().toUpperCase());
        expense.setAmount(request.amount());
        expense.setExpenseDate(request.expenseDate());
        expense.setDescription(request.description());
        expense.setPaymentMethod(request.paymentMethod() != null
                ? request.paymentMethod().toUpperCase() : "CASH");
        expense.setReferenceNumber(request.referenceNumber());

        return toResponse(expenseRepository.save(expense));
    }

    // ── Delete ────────────────────────────────────────────────────────────────

    @Transactional
    public void deleteExpense(UUID id) {
        expenseRepository.delete(findOwned(id));
    }

    // ── Summary (dashboard + reports) ─────────────────────────────────────────

    @Transactional
    public Map<String, Object> getSummary(LocalDate from, LocalDate to) {
        UUID      tenantId   = TenantContext.getTenantId();
        LocalDate today      = LocalDate.now();
        LocalDate weekStart  = today.minusDays(today.getDayOfWeek().getValue() - 1L);
        LocalDate monthStart = today.withDayOfMonth(1);

        BigDecimal totalForRange = orZero(expenseRepository.sumByTenantIdAndDateRange(tenantId, from, to));
        BigDecimal totalToday    = orZero(expenseRepository.sumByTenantIdAndDateRange(tenantId, today,      today));
        BigDecimal totalWeek     = orZero(expenseRepository.sumByTenantIdAndDateRange(tenantId, weekStart,  today));
        BigDecimal totalMonth    = orZero(expenseRepository.sumByTenantIdAndDateRange(tenantId, monthStart, today));

        // Category-wise — seed all categories with zero so every category always appears.
        Map<String, BigDecimal> catMap = new LinkedHashMap<>();
        VALID_CATEGORIES.forEach(c -> catMap.put(c, BigDecimal.ZERO));
        expenseRepository.sumByCategoryAndDateRange(tenantId, from, to)
                .forEach(row -> catMap.put((String) row[0],
                        row[1] instanceof BigDecimal b ? b : new BigDecimal(row[1].toString())));

        // Daily totals for the requested range.
        List<Map<String, Object>> dailyList = new ArrayList<>();
        expenseRepository.sumByDayAndDateRange(tenantId, from, to).forEach(row -> {
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("date",   row[0].toString());
            m.put("amount", row[1]);
            dailyList.add(m);
        });

        Map<String, Object> result = new LinkedHashMap<>();
        result.put("totalToday",    totalToday);
        result.put("totalWeek",     totalWeek);
        result.put("totalMonth",    totalMonth);
        result.put("totalForRange", totalForRange);
        result.put("categoryBreakdown", catMap);
        result.put("dailyBreakdown",    dailyList);
        return result;
    }

    // ── Internal helpers ──────────────────────────────────────────────────────

    private void validate(ExpenseRequest req) {
        if (req.category() == null || req.category().isBlank())
            throw new IllegalArgumentException("Category is required");
        if (!VALID_CATEGORIES.contains(req.category().toUpperCase()))
            throw new IllegalArgumentException(
                    "Category must be one of: " + String.join(", ", VALID_CATEGORIES));
        if (req.amount() == null)
            throw new IllegalArgumentException("Amount is required");
        if (req.amount().compareTo(BigDecimal.ZERO) <= 0)
            throw new IllegalArgumentException("Amount must be greater than zero");
        if (req.expenseDate() == null)
            throw new IllegalArgumentException("Expense date is required");
        if (req.paymentMethod() != null && !req.paymentMethod().isBlank()
                && !VALID_PAYMENT_METHODS.contains(req.paymentMethod().toUpperCase()))
            throw new IllegalArgumentException("Payment method must be one of: CASH, CARD, UPI, OTHER");
    }

    private Expense findOwned(UUID id) {
        UUID tenantId = TenantContext.getTenantId();
        return expenseRepository.findByIdAndTenantId(id, tenantId)
                .orElseThrow(() -> new RuntimeException("Expense not found"));
    }

    private ExpenseResponse toResponse(Expense e) {
        return new ExpenseResponse(
                e.getId(), e.getCategory(), e.getAmount(),
                e.getExpenseDate(), e.getDescription(),
                e.getPaymentMethod(), e.getReferenceNumber(),
                e.getCreatedBy(), e.getCreatedAt(), e.getUpdatedAt());
    }

    private UUID currentUserId() {
        Authentication auth = SecurityContextHolder.getContext().getAuthentication();
        if (auth == null || auth.getName() == null) return null;
        try { return UUID.fromString(auth.getName()); }
        catch (IllegalArgumentException e) { return null; }
    }

    private BigDecimal orZero(BigDecimal v) {
        return v != null ? v : BigDecimal.ZERO;
    }
}