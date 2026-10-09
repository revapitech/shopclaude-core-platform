package com.gosuas.core.entity;

import jakarta.persistence.*;
import lombok.*;
import java.math.BigDecimal;
import java.time.LocalDateTime;
import java.util.List;
import java.util.UUID;

@Entity
@Table(name = "shop_order")
@Getter @Setter @NoArgsConstructor @AllArgsConstructor @Builder
public class ShopOrder {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;

    @Column(name = "tenant_id")
    private UUID tenantId;

    private String orderNo;
    private String customerName;
    private String customerPhone;

    private String houseNo;
    private String street;
    private String city;
    private String pincode;
    private String state;
    private String country;

    private BigDecimal totalAmount;
    private String status;
    private LocalDateTime createdAt;

    private String razorpayOrderId;
    private String razorpayPaymentId;
    private String paymentStatus;

    @OneToMany(mappedBy = "order", cascade = CascadeType.ALL, fetch = FetchType.EAGER)
    private List<ShopOrderItem> items;

    @PrePersist
    public void prePersist() {
        this.createdAt = LocalDateTime.now();
        if (this.status == null) this.status = "PENDING";
        if (this.country == null || this.country.isBlank()) this.country = "India";
    }
}
