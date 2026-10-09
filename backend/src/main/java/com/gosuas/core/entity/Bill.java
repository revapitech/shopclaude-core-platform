package com.gosuas.core.entity;

import jakarta.persistence.*;
import lombok.*;
import java.math.BigDecimal;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

@Entity
@Getter @Setter @NoArgsConstructor @AllArgsConstructor @Builder
public class Bill {
    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;

    @Column(name = "tenant_id")
    private UUID tenantId;

    @Column(unique = true, nullable = false)
    private String billNo;

    private String customerName;
    private String customerMobile;
    private BigDecimal subTotal;
    private BigDecimal discountAmount;
    private BigDecimal grandTotal;
    private String paymentMode;
    private String paymentStatus;
    private LocalDateTime billDate;

    @OneToMany(mappedBy = "bill", cascade = CascadeType.ALL, orphanRemoval = true)
    private List<BillItem> items = new ArrayList<>();

    @PrePersist
    public void prePersist() {
        this.billDate = LocalDateTime.now();
    }
}
