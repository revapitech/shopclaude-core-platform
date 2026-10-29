package com.gosuas.core.entity;

import com.fasterxml.jackson.annotation.JsonIgnore;
import jakarta.persistence.*;
import lombok.*;
import java.math.BigDecimal;
import java.util.UUID;

@Entity
@Getter @Setter @NoArgsConstructor @AllArgsConstructor @Builder
public class ShopOrderItem {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "order_id")
    @JsonIgnore
    private ShopOrder order;

    private UUID productId;
    private String productName;
    private String barcode;
    private BigDecimal unitPrice;
    private Integer quantity;
    private BigDecimal lineTotal;
    private String selectedColor;
    private String selectedSize;

    /** Non-null when this line item represents a combo. */
    @Column(name = "offer_id")
    private UUID offerId;

    /**
     * JSON array of {barcode, productName, qty} for combo items.
     * Null for regular (non-combo) line items.
     */
    @Column(name = "combo_contents", columnDefinition = "TEXT")
    private String comboContents;
}
