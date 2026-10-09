package com.gosuas.core.dto;

import java.math.BigDecimal;
import java.util.List;

public record BillRequest(
        String customerName,
        String customerMobile,
        BigDecimal discountAmount,
        String paymentMode,
        List<BillItemRequest> items
) {}
