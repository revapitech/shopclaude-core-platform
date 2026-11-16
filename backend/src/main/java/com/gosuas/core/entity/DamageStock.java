package com.gosuas.core.entity;

import jakarta.persistence.*;
import lombok.*;

import java.time.LocalDateTime;
import java.util.UUID;

@Entity
@Table(name = "damage_stock", uniqueConstraints =
    // All tenants use the same DMG-{date}-{seq} prefix, so the global unique constraint
    // collides when two tenants create damage records on the same day. Enforce per tenant.
    // See db-migration-phase2.sql to drop the old global unique constraint.
    @UniqueConstraint(name = "uq_damage_no_tenant", columnNames = {"damage_no", "tenant_id"})
)
@Getter @Setter @NoArgsConstructor @AllArgsConstructor @Builder
public class DamageStock {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;

    @Column(name = "tenant_id")
    private UUID tenantId;

    // Uniqueness enforced tenant-scoped via uq_damage_no_tenant (see @Table above).
    @Column(nullable = false)
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
