package com.gosuas.core.service;

import com.gosuas.core.config.TenantContext;
import com.gosuas.core.dto.ExpenseRequest;
import com.gosuas.core.dto.ExpenseResponse;
import com.gosuas.core.entity.Expense;
import com.gosuas.core.repository.ExpenseRepository;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

@ExtendWith(MockitoExtension.class)
class ExpenseServiceTest {

    @Mock private ExpenseRepository expenseRepository;
    @InjectMocks private ExpenseService service;

    private final UUID tenantId   = UUID.randomUUID();
    private final UUID otherTenant = UUID.randomUUID();

    @BeforeEach void setTenant()   { TenantContext.setTenantId(tenantId); }
    @AfterEach  void clearTenant() { TenantContext.clear(); }

    // ── Helpers ───────────────────────────────────────────────────────────────

    private ExpenseRequest validRequest() {
        return new ExpenseRequest("RENT", new BigDecimal("1500.00"),
                LocalDate.now(), "Monthly rent", "CASH", null);
    }

    private Expense savedExpense(UUID id, String category, BigDecimal amount, LocalDate date) {
        Expense e = new Expense();
        e.setId(id); e.setTenantId(tenantId);
        e.setCategory(category); e.setAmount(amount); e.setExpenseDate(date);
        e.setPaymentMethod("CASH");
        return e;
    }

    private void stubSave() {
        when(expenseRepository.save(any(Expense.class)))
                .thenAnswer(inv -> { Expense e = inv.getArgument(0); if (e.getId() == null) e.setId(UUID.randomUUID()); return e; });
    }

    // ── Test 1: successfully create an expense ────────────────────────────────

    @Test
    void createExpense_validRequest_savesAndReturnsResponse() {
        stubSave();

        ExpenseResponse resp = service.createExpense(validRequest());

        ArgumentCaptor<Expense> captor = ArgumentCaptor.forClass(Expense.class);
        verify(expenseRepository).save(captor.capture());
        Expense saved = captor.getValue();

        assertThat(saved.getTenantId()).isEqualTo(tenantId);
        assertThat(saved.getCategory()).isEqualTo("RENT");
        assertThat(saved.getAmount()).isEqualByComparingTo(new BigDecimal("1500.00"));
        assertThat(saved.getPaymentMethod()).isEqualTo("CASH");
        assertThat(resp.category()).isEqualTo("RENT");
    }

    // ── Test 2: zero amount is rejected ──────────────────────────────────────

    @Test
    void createExpense_zeroAmount_throwsIllegalArgument() {
        assertThatThrownBy(() -> service.createExpense(
                new ExpenseRequest("RENT", BigDecimal.ZERO, LocalDate.now(), null, "CASH", null)))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("greater than zero");
    }

    // ── Test 3: negative amount is rejected ───────────────────────────────────

    @Test
    void createExpense_negativeAmount_throwsIllegalArgument() {
        assertThatThrownBy(() -> service.createExpense(
                new ExpenseRequest("SALARY", new BigDecimal("-100"), LocalDate.now(), null, "CASH", null)))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("greater than zero");
    }

    // ── Test 4: missing category is rejected ──────────────────────────────────

    @Test
    void createExpense_missingCategory_throwsIllegalArgument() {
        assertThatThrownBy(() -> service.createExpense(
                new ExpenseRequest(null, new BigDecimal("200"), LocalDate.now(), null, "CASH", null)))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("Category is required");
    }

    // ── Test 5: invalid category is rejected ──────────────────────────────────

    @Test
    void createExpense_invalidCategory_throwsIllegalArgument() {
        assertThatThrownBy(() -> service.createExpense(
                new ExpenseRequest("FOOD", new BigDecimal("200"), LocalDate.now(), null, "CASH", null)))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("Category must be one of");
    }

    // ── Test 6: missing date is rejected ──────────────────────────────────────

    @Test
    void createExpense_missingDate_throwsIllegalArgument() {
        assertThatThrownBy(() -> service.createExpense(
                new ExpenseRequest("ELECTRICITY", new BigDecimal("800"), null, null, "CASH", null)))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("Expense date is required");
    }

    // ── Test 7: list expenses returns only current tenant's records ───────────

    @Test
    void listExpenses_returnsTenantScopedList() {
        UUID id1 = UUID.randomUUID(), id2 = UUID.randomUUID();
        when(expenseRepository.findAllByTenantIdOrderByExpenseDateDescCreatedAtDesc(tenantId))
                .thenReturn(List.of(
                        savedExpense(id1, "RENT",      new BigDecimal("1500"), LocalDate.now()),
                        savedExpense(id2, "ELECTRICITY", new BigDecimal("400"), LocalDate.now().minusDays(1))));

        List<ExpenseResponse> results = service.listExpenses(null, null);

        assertThat(results).hasSize(2);
        assertThat(results.get(0).category()).isEqualTo("RENT");
        assertThat(results.get(1).category()).isEqualTo("ELECTRICITY");
        // Ensure the repository was called with the correct tenant
        verify(expenseRepository).findAllByTenantIdOrderByExpenseDateDescCreatedAtDesc(tenantId);
        verify(expenseRepository, never()).findAllByTenantIdOrderByExpenseDateDescCreatedAtDesc(otherTenant);
    }

    // ── Test 8: unauthorized cross-tenant access is prevented ─────────────────

    @Test
    void updateExpense_wrongTenant_throwsRuntimeException() {
        UUID expenseId = UUID.randomUUID();
        // Repository returns empty — the expense doesn't belong to this tenant
        when(expenseRepository.findByIdAndTenantId(expenseId, tenantId)).thenReturn(Optional.empty());

        assertThatThrownBy(() -> service.updateExpense(expenseId, validRequest()))
                .isInstanceOf(RuntimeException.class)
                .hasMessageContaining("Expense not found");
    }

    // ── Test 9: update expense replaces all mutable fields ───────────────────

    @Test
    void updateExpense_validRequest_updatesFields() {
        UUID expenseId = UUID.randomUUID();
        Expense existing = savedExpense(expenseId, "RENT", new BigDecimal("1500"), LocalDate.now().minusDays(5));
        when(expenseRepository.findByIdAndTenantId(expenseId, tenantId)).thenReturn(Optional.of(existing));
        when(expenseRepository.save(any())).thenAnswer(inv -> inv.getArgument(0));

        ExpenseRequest update = new ExpenseRequest("SALARY", new BigDecimal("30000"),
                LocalDate.now(), "Staff salary for October", "UPI", "REF-001");

        ExpenseResponse resp = service.updateExpense(expenseId, update);

        assertThat(resp.category()).isEqualTo("SALARY");
        assertThat(resp.amount()).isEqualByComparingTo(new BigDecimal("30000"));
        assertThat(resp.paymentMethod()).isEqualTo("UPI");
        assertThat(resp.referenceNumber()).isEqualTo("REF-001");
    }

    // ── Test 10: delete expense removes only the owned record ─────────────────

    @Test
    void deleteExpense_ownedByTenant_callsRepositoryDelete() {
        UUID expenseId = UUID.randomUUID();
        Expense existing = savedExpense(expenseId, "TRANSPORT", new BigDecimal("200"), LocalDate.now());
        when(expenseRepository.findByIdAndTenantId(expenseId, tenantId)).thenReturn(Optional.of(existing));

        service.deleteExpense(expenseId);

        verify(expenseRepository).delete(existing);
    }

    // ── Test 11: delete from wrong tenant is rejected ─────────────────────────

    @Test
    void deleteExpense_wrongTenant_throwsRuntimeException() {
        UUID expenseId = UUID.randomUUID();
        when(expenseRepository.findByIdAndTenantId(expenseId, tenantId)).thenReturn(Optional.empty());

        assertThatThrownBy(() -> service.deleteExpense(expenseId))
                .isInstanceOf(RuntimeException.class)
                .hasMessageContaining("Expense not found");

        verify(expenseRepository, never()).delete(any(Expense.class));
    }

    // ── Test 12: getSummary seeds all 7 categories including zero totals ───────

    @Test
    void getSummary_seedsAllCategoriesWithZero() {
        LocalDate from = LocalDate.now().withDayOfMonth(1);
        LocalDate to   = LocalDate.now();

        when(expenseRepository.sumByTenantIdAndDateRange(eq(tenantId), any(), any()))
                .thenReturn(BigDecimal.ZERO);
        // Only RENT has data — all others should still appear with zero
        List<Object[]> catResult = new java.util.ArrayList<>();
        catResult.add(new Object[]{ "RENT", new BigDecimal("3000") });
        when(expenseRepository.sumByCategoryAndDateRange(eq(tenantId), eq(from), eq(to)))
                .thenReturn(catResult);
        List<Object[]> dayResult = new java.util.ArrayList<>();
        when(expenseRepository.sumByDayAndDateRange(eq(tenantId), eq(from), eq(to)))
                .thenReturn(dayResult);

        @SuppressWarnings("unchecked")
        java.util.Map<String, Object> summary = service.getSummary(from, to);

        @SuppressWarnings("unchecked")
        java.util.Map<String, BigDecimal> cats =
                (java.util.Map<String, BigDecimal>) summary.get("categoryBreakdown");

        // All 7 categories present
        assertThat(cats).containsKeys("DAILY_EXPENSE","RENT","ELECTRICITY","WATER_BILL",
                                       "SALARY","TRANSPORT","OTHER_EXPENSE");
        // RENT has data
        assertThat(cats.get("RENT")).isEqualByComparingTo(new BigDecimal("3000"));
        // Others are zero
        assertThat(cats.get("SALARY")).isEqualByComparingTo(BigDecimal.ZERO);
        assertThat(cats.get("ELECTRICITY")).isEqualByComparingTo(BigDecimal.ZERO);
        assertThat(cats.get("WATER_BILL")).isEqualByComparingTo(BigDecimal.ZERO);
        assertThat(cats.get("TRANSPORT")).isEqualByComparingTo(BigDecimal.ZERO);
        assertThat(cats.get("DAILY_EXPENSE")).isEqualByComparingTo(BigDecimal.ZERO);
        assertThat(cats.get("OTHER_EXPENSE")).isEqualByComparingTo(BigDecimal.ZERO);
    }
}