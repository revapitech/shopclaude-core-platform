package com.gosuas.core.repository;

import com.gosuas.core.entity.Expense;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

public interface ExpenseRepository extends JpaRepository<Expense, UUID> {

    List<Expense> findAllByTenantIdOrderByExpenseDateDescCreatedAtDesc(UUID tenantId);

    List<Expense> findAllByTenantIdAndExpenseDateBetweenOrderByExpenseDateDescCreatedAtDesc(
            UUID tenantId, LocalDate from, LocalDate to);

    Optional<Expense> findByIdAndTenantId(UUID id, UUID tenantId);

    @Query("SELECT COALESCE(SUM(e.amount), 0) FROM Expense e WHERE e.tenantId = :tenantId AND e.expenseDate BETWEEN :from AND :to")
    BigDecimal sumByTenantIdAndDateRange(
            @Param("tenantId") UUID tenantId,
            @Param("from") LocalDate from,
            @Param("to") LocalDate to);

    @Query("SELECT e.category, COALESCE(SUM(e.amount), 0) FROM Expense e WHERE e.tenantId = :tenantId AND e.expenseDate BETWEEN :from AND :to GROUP BY e.category")
    List<Object[]> sumByCategoryAndDateRange(
            @Param("tenantId") UUID tenantId,
            @Param("from") LocalDate from,
            @Param("to") LocalDate to);

    @Query("SELECT e.expenseDate, COALESCE(SUM(e.amount), 0) FROM Expense e WHERE e.tenantId = :tenantId AND e.expenseDate BETWEEN :from AND :to GROUP BY e.expenseDate ORDER BY e.expenseDate")
    List<Object[]> sumByDayAndDateRange(
            @Param("tenantId") UUID tenantId,
            @Param("from") LocalDate from,
            @Param("to") LocalDate to);

    @Query("SELECT COUNT(e) FROM Expense e WHERE e.tenantId = :tenantId AND e.expenseDate BETWEEN :from AND :to")
    long countByTenantIdAndDateRange(
            @Param("tenantId") UUID tenantId,
            @Param("from") LocalDate from,
            @Param("to") LocalDate to);
}