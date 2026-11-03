package com.gosuas.core.controller;

import com.gosuas.core.dto.ExpenseRequest;
import com.gosuas.core.dto.ExpenseResponse;
import com.gosuas.core.service.ExpenseService;
import lombok.RequiredArgsConstructor;
import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.time.LocalDate;
import java.util.List;
import java.util.Map;
import java.util.UUID;

@RestController
@RequestMapping("/api/expenses")
@RequiredArgsConstructor
public class ExpenseController {

    private final ExpenseService expenseService;

    /** Create a new expense for the authenticated tenant. */
    @PostMapping
    public ResponseEntity<ExpenseResponse> create(@RequestBody ExpenseRequest request) {
        return ResponseEntity.ok(expenseService.createExpense(request));
    }

    /** List all expenses, optionally filtered by date range. */
    @GetMapping
    public ResponseEntity<List<ExpenseResponse>> list(
            @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate from,
            @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate to) {
        return ResponseEntity.ok(expenseService.listExpenses(from, to));
    }

    /** Get a single expense by ID. Returns 404 if not found or belongs to another tenant. */
    @GetMapping("/{id}")
    public ResponseEntity<ExpenseResponse> getById(@PathVariable UUID id) {
        return ResponseEntity.ok(expenseService.getExpense(id));
    }

    /** Update an existing expense. Validates ownership before saving. */
    @PutMapping("/{id}")
    public ResponseEntity<ExpenseResponse> update(
            @PathVariable UUID id,
            @RequestBody ExpenseRequest request) {
        return ResponseEntity.ok(expenseService.updateExpense(id, request));
    }

    /** Delete an expense. Returns 204 on success, 404 if not owned by current tenant. */
    @DeleteMapping("/{id}")
    public ResponseEntity<Void> delete(@PathVariable UUID id) {
        expenseService.deleteExpense(id);
        return ResponseEntity.noContent().build();
    }

    /**
     * Dashboard summary: today / this-week / this-month totals plus category-wise
     * and daily breakdowns for the requested range.
     */
    @GetMapping("/summary")
    public ResponseEntity<Map<String, Object>> summary(
            @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate from,
            @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate to) {
        LocalDate today = LocalDate.now();
        LocalDate f = from != null ? from : today.withDayOfMonth(1);
        LocalDate t = to   != null ? to   : today;
        return ResponseEntity.ok(expenseService.getSummary(f, t));
    }
}