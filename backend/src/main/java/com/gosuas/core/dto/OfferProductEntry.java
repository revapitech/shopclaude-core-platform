package com.gosuas.core.dto;

import java.math.BigDecimal;
import java.util.UUID;

/**
 * Shared DTO for both request (eligible product spec) and response (eligible product detail).
 */
public record OfferProductEntry(
        UUID productId,
        String productName,
        String barcode,
        String sku,
        String imageUrl,
        BigDecimal sellingPrice,
        Integer stockQty,
        Boolean trackStock,
        Integer quantity   // fixed-combo only; null for CUSTOMER_SELECT
) {}
