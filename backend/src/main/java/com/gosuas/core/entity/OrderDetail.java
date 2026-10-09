package com.gosuas.core.entity;

import jakarta.persistence.*;
import lombok.*;
import java.math.BigDecimal;
import java.time.LocalDateTime;
import java.util.List;
import java.util.UUID;

@Entity
@Table(name = "order_detail")
@Data @Builder @NoArgsConstructor @AllArgsConstructor
public class OrderDetail {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;

    @Column(name = "tenant_id")
    private UUID tenantId;

    private String orderNumber;
    private String shopifyOrderId;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "customer_id")
    @com.fasterxml.jackson.annotation.JsonIgnore
    private CustomerDetail customer;

    private String customerEmail;
    private String customerName;

    private String financialStatus;
    private String fulfillmentStatus;
    private String paymentMethod;

    private BigDecimal subtotal;
    private BigDecimal total;
    private BigDecimal discountAmount;

    private String billingName;
    private String billingCity;
    private String shippingName;
    private String shippingCity;
    private String shippingPhone;
    private String shippingAddress;

    private LocalDateTime orderedAt;
    private LocalDateTime paidAt;

    @OneToMany(mappedBy = "order", cascade = CascadeType.ALL, fetch = FetchType.EAGER)
    private List<OrderItem> items;
}
