package com.gosuas.core.dto;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.List;
import java.util.UUID;

public record SalesReturnResponse(
        UUID id,
        String returnNo,
        String sourceType,
        UUID sourceBillId,
        String sourceBillNo,
        String customerName,
        String customerMobile,
        LocalDate returnDate,
        String returnReason,
        String remarks,
        BigDecimal totalReturnAmount,
        String refundMode,
        String refundStatus,
        String status,
        boolean stockRestored,
        UUID createdBy,
        LocalDateTime createdAt,
        List<SalesReturnItemResponse> items
) {}