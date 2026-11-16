package com.gosuas.core.entity;

import jakarta.persistence.*;
import lombok.*;

import java.time.LocalDateTime;
import java.util.UUID;

@Entity
@Table(name = "damage_stock")
@Getter @Setter @NoArgsConstructor @AllArgsConstructor @Builder
public class DamageStock {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;

    @Column(name = "tenant_id")
    private UUID tenantId;

    @Column(unique = true, nullable = false)
    private String damageNo;

    @Column(name = "product_id")
    private UUID productId;

    private String productName;

    private String sku;

    private String barcode;

    private String color;

    @Column(name = "damage_qty", nullable = false)
    private Integer damageQty;

    @Column(name = "stock_before")
    private Integer stockBefore;

    @Column(name = "stock_after")
    private Integer stockAfter;

    /** DAMAGED_IN_TRANSIT | EXPIRED | MANUFACTURING_DEFECT | WATER_DAMAGE | BREAKAGE | OTHER */
    private String reason;

    @Column(columnDefinition = "TEXT")
    private String notes;

    @Column(name = "created_by")
    private UUID createdBy;

    @Column(name = "created_at")
    private LocalDateTime createdAt;

    @PrePersist
    public void prePersist() {
        this.createdAt = LocalDateTime.now();
    }
}
