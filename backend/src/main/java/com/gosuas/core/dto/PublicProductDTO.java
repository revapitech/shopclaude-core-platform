package com.gosuas.core.dto;

import com.gosuas.core.entity.Product;
import lombok.Getter;

import java.math.BigDecimal;
import java.time.LocalDateTime;
import java.util.UUID;

/**
 * Slim read-only projection of Product for the public storefront.
 *
 * Intentionally omits internal/admin-only fields:
 *   purchasePrice  — sensitive (cost price must not be exposed publicly)
 *   tenantId       — internal routing detail
 *   lowStockAlertQty, hsnCode, gstRate, trackStock — admin-only
 *   depositAmount, rentAmount, rentalAvailable, productType — rental-specific
 *   colorPhotoUrl  — already included inside imageUrl csv; admin-only split
 */
@Getter
public class PublicProductDTO {

    private final UUID    id;
    private final String  name;
    private final String  category;
    private final String  subcategory;
    private final String  color;
    private final String  size;
    private final String  barcode;
    private final BigDecimal sellingPrice;
    private final BigDecimal mrp;
    private final Integer stockQty;
    private final Boolean active;
    private final String  imageUrl;
    private final String  description;
    private final Boolean featured;
    private final Boolean festiveOffer;
    private final Integer soldCount;
    private final LocalDateTime createdAt;
    private final String  variantAttrs;
    private final String  variantImages;

    public PublicProductDTO(Product p) {
        this.id           = p.getId();
        this.name         = p.getName();
        this.category     = p.getCategory();
        this.subcategory  = p.getSubcategory();
        this.color        = p.getColor();
        this.size         = p.getSize();
        this.barcode      = p.getBarcode();
        this.sellingPrice = p.getSellingPrice();
        this.mrp          = p.getMrp();
        this.stockQty     = p.getStockQty();
        this.active       = p.getActive();
        this.imageUrl     = p.getImageUrl();
        this.description  = p.getDescription();
        this.featured     = p.getFeatured();
        this.festiveOffer = p.getFestiveOffer();
        this.soldCount    = p.getSoldCount();
        this.createdAt    = p.getCreatedAt();
        this.variantAttrs = p.getVariantAttrs();
        this.variantImages = p.getVariantImages();
    }
}
