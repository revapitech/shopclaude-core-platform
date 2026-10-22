package com.gosuas.core.dto;

import java.time.LocalDateTime;
import java.util.UUID;

public record DamageStockResponse(
        UUID id,
        String damageNo,
        UUID productId,
        String productName,
        String sku,
        String barcode,
        String color,
        Integer damageQty,
        Integer stockBefore,
        Integer stockAfter,
        String reason,
        String notes,
        UUID createdBy,
        LocalDateTime createdAt
) {}
