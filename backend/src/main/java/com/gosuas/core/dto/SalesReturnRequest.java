package com.gosuas.core.dto;

import java.time.LocalDate;
import java.util.List;
import java.util.UUID;

public record SalesReturnRequest(
        String sourceType,       // POS | ONLINE | SHOPIFY
        UUID sourceBillId,
        LocalDate returnDate,    // defaults to today if null
        String returnReason,
        String remarks,
        String refundMode,
        List<SalesReturnItemRequest> items
) {}