package com.gosuas.core.dto;

import java.math.BigDecimal;
import java.util.UUID;

public record SalesReturnItemResponse(
        UUID id,
        String productName,
        String barcode,
        Integer returnedQty,
        BigDecimal unitPrice,
        BigDecimal lineTotal,
        Boolean restockable
) {}