package com.gosuas.core.dto;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.UUID;

public record RentalResponse(
        UUID id,
        String rentalNo,
        String productCode,
        String productName,
        Integer quantity,
        BigDecimal advanceAmount,
        BigDecimal depositAmount,
        BigDecimal rentAmount,
        BigDecimal totalAmount,
        String customerName,
        String customerMobile,
        LocalDate bookingDate,
        Integer eventPeriodDays,
        LocalDate bookingEndDate,
        String status,
        BigDecimal deductionAmount,
        BigDecimal refundAmount,
        String returnNotes,
        LocalDateTime rentedAt,
        LocalDateTime returnedAt
) {}
