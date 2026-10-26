package com.gosuas.core.dto;

public record DamageStockRequest(
        String sku,        // SKU or barcode used for product lookup
        Integer damageQty, // required; must be > 0
        String reason,     // DAMAGED_IN_TRANSIT | EXPIRED | MANUFACTURING_DEFECT | WATER_DAMAGE | BREAKAGE | OTHER
        String notes       // optional free-text
) {}
