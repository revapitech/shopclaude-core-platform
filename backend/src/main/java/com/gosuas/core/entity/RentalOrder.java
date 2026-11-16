package com.gosuas.core.entity;

import jakarta.persistence.*;
import lombok.*;
import java.math.BigDecimal;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.UUID;

@Entity
@Table(name = "rental_order", uniqueConstraints =
    // All tenants would use the same rental number series without tenant scoping.
    // Enforce uniqueness per tenant. See db-migration-phase2.sql to drop the old constraint.
    @UniqueConstraint(name = "uq_rental_no_tenant", columnNames = {"rental_no", "tenant_id"})
)
@Getter @Setter @NoArgsConstructor @AllArgsConstructor @Builder
public class RentalOrder {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;

    @Column(name = "tenant_id")
    private UUID tenantId;

    // Uniqueness enforced tenant-scoped via uq_rental_no_tenant (see @Table above).
    @Column(nullable = false)
    private String rentalNo;

    private String productCode;
    private String productName;
    private Integer quantity;
    private BigDecimal advanceAmount;
    private BigDecimal depositAmount;
    private BigDecimal rentAmount;
    private BigDecimal totalAmount;

    private String customerName;
    private String customerMobile;

    // The date range the product is booked/blocked for — not to be confused with rentedAt
    // (when this record was created), which is just an audit timestamp.
    private LocalDate bookingDate;
    private Integer eventPeriodDays;
    private LocalDate bookingEndDate;

    private String status; // RENTED, RETURNED

    // Set when the item comes back — refundAmount is what was actually handed back to the
    // customer (deposit minus any damage deduction), tracked separately from shop revenue.
    private BigDecimal deductionAmount;
    private BigDecimal refundAmount;
    @Column(columnDefinition = "TEXT")
    private String returnNotes;

    private LocalDateTime rentedAt;
    private LocalDateTime returnedAt;

    @PrePersist
    public void prePersist() {
        this.rentedAt = LocalDateTime.now();
        if (this.status == null) this.status = "RENTED";
    }
}
