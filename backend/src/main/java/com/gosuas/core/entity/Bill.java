package com.gosuas.core.entity;

import jakarta.persistence.*;
import lombok.*;
import java.math.BigDecimal;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

@Entity
@Table(uniqueConstraints =
    // Bill numbers are prefixed with the tenant's subdomain abbreviation, so global collisions
    // are unlikely — but two tenants with the same 3-char prefix would collide. Enforce uniqueness
    // per tenant. See db-migration-phase2.sql to drop the old global unique constraint.
    @UniqueConstraint(name = "uq_bill_no_tenant", columnNames = {"bill_no", "tenant_id"})
)
@Getter @Setter @NoArgsConstructor @AllArgsConstructor @Builder
public class Bill {
    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;

    @Column(name = "tenant_id")
    private UUID tenantId;

    // Uniqueness enforced tenant-scoped via uq_bill_no_tenant (see @Table above).
    @Column(nullable = false)
    private String billNo;

    private String customerName;
    private String customerMobile;
    private BigDecimal subTotal;
    private BigDecimal discountAmount;
    private BigDecimal grandTotal;
    private String paymentMode;
    private String paymentStatus;
    private LocalDateTime billDate;

    // GST breakdown — populated only when the tenant is GST-registered.
    // Null on older bills created before this feature was added.
    @Column(name = "taxable_amount", precision = 12, scale = 2)
    private BigDecimal taxableAmount;

    @Column(name = "cgst", precision = 12, scale = 2)
    private BigDecimal cgst;

    @Column(name = "sgst", precision = 12, scale = 2)
    private BigDecimal sgst;

    @Column(name = "igst", precision = 12, scale = 2)
    private BigDecimal igst;

    @Column(name = "total_gst", precision = 12, scale = 2)
    private BigDecimal totalGst;

    @OneToMany(mappedBy = "bill", cascade = CascadeType.ALL, orphanRemoval = true)
    @Builder.Default
    private List<BillItem> items = new ArrayList<>();

    @OneToMany(mappedBy = "bill", cascade = CascadeType.ALL, orphanRemoval = true)
    @Builder.Default
    private List<BillPayment> payments = new ArrayList<>();

    @PrePersist
    public void prePersist() {
        this.billDate = LocalDateTime.now();
    }
}
