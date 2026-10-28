package com.gosuas.core.dto;

import java.math.BigDecimal;

public record ProductRequest(
        String name,
        String category,
        String color,
        String size,
        String sku,
        String barcode,
        BigDecimal purchasePrice,
        BigDecimal sellingPrice,
        BigDecimal mrp,
        Integer stockQty,
        Integer lowStockAlertQty,
        String imageUrl,
        String description,
        Boolean featured,
        Boolean festiveOffer,
        String subcategory,
        Boolean active,
        String variantAttrs,
        Boolean rentalAvailable,
        String productType,
        BigDecimal depositAmount,
        BigDecimal rentAmount,
        String colorPhotoUrl,
        String hsnCode,
        BigDecimal gstRate,
        Boolean trackStock
) {}
