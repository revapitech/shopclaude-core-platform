package com.gosuas.core.entity;

import com.fasterxml.jackson.annotation.JsonIgnore;
import jakarta.persistence.*;
import lombok.*;
import java.math.BigDecimal;
import java.util.UUID;

@Entity
@Table(name = "sales_return_item")
@Getter @Setter @NoArgsConstructor @AllArgsConstructor @Builder
public class SalesReturnItem {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "return_id", nullable = false)
    @JsonIgnore
    private SalesReturn salesReturn;

    @Column(name = "product_id")
    private UUID productId;   // null for SHOPIFY items with no product in this system

    private String productName;
    private String barcode;
    private Integer returnedQty;
    private BigDecimal unitPrice;
    private BigDecimal lineTotal;
    private Boolean restockable;  // true = put back into sellable inventory
}