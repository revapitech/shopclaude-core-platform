package com.gosuas.core.entity;

import com.fasterxml.jackson.annotation.JsonIgnore;
import jakarta.persistence.*;
import lombok.*;
import java.math.BigDecimal;
import java.util.UUID;

@Entity
@Getter @Setter @NoArgsConstructor @AllArgsConstructor @Builder
public class BillItem {
    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;

    @ManyToOne(fetch = FetchType.LAZY)
    @JsonIgnore
    private Bill bill;

    @ManyToOne(fetch = FetchType.LAZY)
    @JsonIgnore
    private Product product;

    private String productName;
    private String barcode;
    private Integer quantity;
    private BigDecimal unitPrice;
    private BigDecimal lineTotal;

    // Snapshot of product tax config at time of billing (so the invoice stays correct even if
    // the product's GST rate or HSN code changes later).
    @Column(name = "hsn_code")
    private String hsnCode;

    @Column(name = "gst_rate", precision = 5, scale = 2)
    private BigDecimal gstRate;

    @Column(name = "taxable_amount", precision = 12, scale = 2)
    private BigDecimal taxableAmount;

    @Column(name = "cgst", precision = 12, scale = 2)
    private BigDecimal cgst;

    @Column(name = "sgst", precision = 12, scale = 2)
    private BigDecimal sgst;

    @Column(name = "igst", precision = 12, scale = 2)
    private BigDecimal igst;
}
