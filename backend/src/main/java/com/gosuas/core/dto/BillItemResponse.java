package com.gosuas.core.dto;

import java.math.BigDecimal;
import java.util.UUID;

public record BillItemResponse(
        UUID id,
        String productName,
        String barcode,
        Integer quantity,
        BigDecimal unitPrice,
        BigDecimal lineTotal
) {}