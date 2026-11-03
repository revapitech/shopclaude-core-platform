package com.gosuas.core.dto;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.UUID;

public record ExpenseResponse(
        UUID          id,
        String        category,
        BigDecimal    amount,
        LocalDate     expenseDate,
        String        description,
        String        paymentMethod,
        String        referenceNumber,
        UUID          createdBy,
        LocalDateTime createdAt,
        LocalDateTime updatedAt
) {}