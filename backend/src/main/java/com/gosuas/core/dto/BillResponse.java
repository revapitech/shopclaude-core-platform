package com.gosuas.core.dto;

import java.math.BigDecimal;
import java.time.LocalDateTime;
import java.util.List;
import java.util.UUID;

public record BillResponse(
        UUID id,
        String billNo,
        String customerName,
        String customerMobile,
        BigDecimal subTotal,
        BigDecimal discountAmount,
        BigDecimal grandTotal,
        String paymentMode,
        String paymentStatus,
        LocalDateTime billDate,
        List<BillItemResponse> items,
        List<PaymentEntryResponse> payments
) {}