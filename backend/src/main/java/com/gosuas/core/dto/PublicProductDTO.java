package com.gosuas.core.dto;

import com.gosuas.core.entity.Product;
import lombok.Getter;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.LocalDateTime;
import java.time.ZoneId;
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

    // Active discount fields — null when no discount is currently active.
    private final BigDecimal discountedPrice; // effective price to pay (null = no discount)
    private final String     discountLabel;   // e.g. "10% off" or "₹50 off"

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

        // Compute active discount in IST (user-facing times are entered in IST)
        BigDecimal dp = null;
        String dl = null;
        if (Boolean.TRUE.equals(p.getDiscountEnabled())
                && p.getDiscountValue() != null
                && p.getDiscountType() != null
                && p.getSellingPrice() != null) {
            LocalDateTime now = LocalDateTime.now(ZoneId.of("Asia/Kolkata"));
            boolean started  = p.getDiscountStart() == null || !now.isBefore(p.getDiscountStart());
            boolean notEnded = p.getDiscountEnd()   == null || !now.isAfter(p.getDiscountEnd());
            if (started && notEnded) {
                if ("PERCENT".equals(p.getDiscountType())) {
                    BigDecimal factor = BigDecimal.ONE.subtract(
                            p.getDiscountValue().divide(new BigDecimal("100"), 10, RoundingMode.HALF_UP));
                    dp = p.getSellingPrice().multiply(factor).setScale(2, RoundingMode.HALF_UP);
                    dl = p.getDiscountValue().stripTrailingZeros().toPlainString() + "% off";
                } else if ("FLAT".equals(p.getDiscountType())) {
                    dp = p.getSellingPrice().subtract(p.getDiscountValue()).max(BigDecimal.ZERO)
                            .setScale(2, RoundingMode.HALF_UP);
                    dl = "\u20b9" + p.getDiscountValue().stripTrailingZeros().toPlainString() + " off";
                }
            }
        }
        this.discountedPrice = dp;
        this.discountLabel   = dl;
    }
}