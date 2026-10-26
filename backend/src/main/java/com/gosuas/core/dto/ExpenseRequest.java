package com.gosuas.core.dto;

import java.math.BigDecimal;
import java.time.LocalDate;

public record ExpenseRequest(
        String     category,        // required; DAILY_EXPENSE|RENT|ELECTRICITY|WATER_BILL|SALARY|TRANSPORT|OTHER_EXPENSE
        BigDecimal amount,          // required; must be > 0
        LocalDate  expenseDate,     // required
        String     description,     // optional free-text
        String     paymentMethod,   // CASH|CARD|UPI|OTHER — defaults to CASH
        String     referenceNumber  // optional receipt / reference number
) {}