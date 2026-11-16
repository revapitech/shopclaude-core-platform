package com.gosuas.core.entity;

import jakarta.persistence.*;
import lombok.*;
import java.math.BigDecimal;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

@Entity
@Table(name = "sales_return")
@Getter @Setter @NoArgsConstructor @AllArgsConstructor @Builder
public class SalesReturn {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;

    @Column(name = "tenant_id")
    private UUID tenantId;

    @Column(unique = true, nullable = false)
    private String returnNo;

    @Column(nullable = false)
    private String sourceType;   // POS | ONLINE | SHOPIFY

    @Column(name = "source_bill_id")
    private UUID sourceBillId;

    @Column(name = "source_bill_no")
    private String sourceBillNo;

    private String customerName;
    private String customerMobile;

    private LocalDate returnDate;

    private String returnReason;  // DEFECTIVE | SIZE_ISSUE | WRONG_ITEM | CHANGE_OF_MIND | OTHER

    @Column(columnDefinition = "TEXT")
    private String remarks;

    private BigDecimal totalReturnAmount;

    private String refundMode;    // CASH | UPI | BANK_TRANSFER | STORE_CREDIT | ONLINE

    private String refundStatus;  // PENDING | REFUNDED

    @Column(nullable = false)
    private String status;        // PENDING | APPROVED | REJECTED | COMPLETED | CANCELLED

    @Column(name = "stock_restored")
    private boolean stockRestored;

    @Column(name = "created_by")
    private UUID createdBy;       // platform_user.id of the staff member who recorded the return

    private LocalDateTime createdAt;

    @OneToMany(mappedBy = "salesReturn", cascade = CascadeType.ALL, orphanRemoval = true, fetch = FetchType.EAGER)
    @Builder.Default
    private List<SalesReturnItem> items = new ArrayList<>();

    @PrePersist
    public void prePersist() {
        this.createdAt = LocalDateTime.now();
        if (this.status == null)       this.status = "PENDING";
        if (this.refundStatus == null) this.refundStatus = "PENDING";
        if (this.returnDate == null)   this.returnDate = LocalDate.now();
        if (this.stockRestored == false) this.stockRestored = false;
    }
}