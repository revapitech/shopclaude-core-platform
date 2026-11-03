package com.gosuas.core.entity;

import jakarta.persistence.*;
import lombok.*;

import java.util.UUID;

/**
 * Links an offer to one eligible product.
 * For FIXED_COMBO: quantity is the required count of this product in the combo.
 * For CUSTOMER_SELECT: quantity is null (pool of eligible products).
 */
@Entity
@Table(name = "offer_product")
@Getter @Setter @NoArgsConstructor @AllArgsConstructor @Builder
public class OfferProduct {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;

    @Column(name = "offer_id", nullable = false)
    private UUID offerId;

    @Column(name = "product_id", nullable = false)
    private UUID productId;

    /** Null for CUSTOMER_SELECT; required for FIXED_COMBO. */
    private Integer quantity;
}
