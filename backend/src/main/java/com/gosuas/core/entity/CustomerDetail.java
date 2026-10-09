package com.gosuas.core.entity;

import jakarta.persistence.*;
import lombok.*;
import java.math.BigDecimal;
import java.util.List;
import java.util.UUID;

@Entity
@Table(name = "customer_detail")
@Data @Builder @NoArgsConstructor @AllArgsConstructor
public class CustomerDetail {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;

    @Column(name = "tenant_id")
    private UUID tenantId;

    @Column(name = "shopify_customer_id")
    private String shopifyCustomerId;

    private String firstName;
    private String lastName;

    @Column(unique = true)
    private String email;

    private String phone;
    private String city;
    private String state;
    private String country;
    private String pincode;
    private String address;

    private BigDecimal totalSpent;
    private Integer totalOrders;

    @OneToMany(mappedBy = "customer", cascade = CascadeType.ALL, fetch = FetchType.LAZY)
    @com.fasterxml.jackson.annotation.JsonIgnore
    private List<OrderDetail> orders;
}
