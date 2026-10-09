package com.gosuas.core.dto;

import java.math.BigDecimal;
import java.time.LocalDate;

public record RentalReturnRequest(
        BigDecimal deductionAmount,
        String returnNotes,
        LocalDate returnDate
) {}
