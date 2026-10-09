package com.gosuas.core.entity;

import jakarta.persistence.*;
import lombok.*;
import java.math.BigDecimal;
import java.time.LocalDateTime;
import java.util.UUID;

@Entity
@Getter @Setter @NoArgsConstructor @AllArgsConstructor @Builder
public class Product {
    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;

    @Column(name = "tenant_id")
    private UUID tenantId;

    @Column(nullable = false)
    private String name;

    private String category;
    private String color;
    private String size;

    @Column(unique = true, nullable = false)
    private String sku;

    @Column(unique = true, nullable = false)
    private String barcode;

    private BigDecimal purchasePrice;
    private BigDecimal sellingPrice;
    private BigDecimal mrp;

    // RENTAL products use these instead of sellingPrice/mrp — set by the Product Type toggle.
    @Column(name = "product_type")
    private String productType; // OTHER (default) or RENTAL
    private BigDecimal depositAmount;
    private BigDecimal rentAmount;

    private Integer stockQty;
    private Integer lowStockAlertQty;
    private Boolean active;
    private LocalDateTime createdAt;
    private String imageUrl;

    // The colour variant's own dedicated photo, tracked separately from the general imageUrl
    // list above (which also includes it, for display) so Edit can tell them apart on reload.
    @Column(name = "color_photo_url")
    private String colorPhotoUrl;

    @Column(columnDefinition = "TEXT")
    private String description;

    private Boolean featured;
    private Boolean festiveOffer;
    private Integer soldCount;
    private String subcategory;
    private Boolean rentalAvailable;

    @Column(name = "variant_attrs", columnDefinition = "TEXT")
    private String variantAttrs;

    @PrePersist
    public void prePersist() {
        this.createdAt = LocalDateTime.now();
        if (this.active == null) this.active = false;
        if (this.stockQty == null) this.stockQty = 0;
        if (this.lowStockAlertQty == null) this.lowStockAlertQty = 5;
        if (this.soldCount == null) this.soldCount = 0;
        if (this.featured == null) this.featured = false;
        if (this.festiveOffer == null) this.festiveOffer = false;
        if (this.rentalAvailable == null) this.rentalAvailable = false;
        if (this.productType == null) this.productType = "OTHER";
    }
}
