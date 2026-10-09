package com.gosuas.core.dto;

import java.math.BigDecimal;
import java.time.LocalDate;

public record RentalRequest(
        String productCode,
        Integer quantity,
        BigDecimal advanceAmount,
        BigDecimal depositAmount,
        BigDecimal rentAmount,
        String customerName,
        String customerMobile,
        LocalDate bookingDate,
        Integer eventPeriodDays
) {}
