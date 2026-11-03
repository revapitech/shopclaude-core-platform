package com.gosuas.core.entity;

import jakarta.persistence.*;
import lombok.*;

import java.math.BigDecimal;
import java.time.LocalDateTime;
import java.util.UUID;

@Entity
@Table(name = "offers")
@Getter @Setter @NoArgsConstructor @AllArgsConstructor @Builder
public class Offer {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;

    @Column(name = "tenant_id", nullable = false)
    private UUID tenantId;

    @Column(nullable = false)
    private String name;

    @Column(columnDefinition = "TEXT")
    private String description;

    /** "CUSTOMER_SELECT" or "FIXED_COMBO" */
    @Column(name = "offer_type", nullable = false)
    private String offerType;

    /** Items the customer must select (CUSTOMER_SELECT). */
    @Column(name = "required_qty")
    private Integer requiredQty;

    @Column(name = "combo_price", precision = 12, scale = 2, nullable = false)
    private BigDecimal comboPrice;

    @Column(name = "start_date_time")
    private LocalDateTime startDateTime;

    @Column(name = "end_date_time")
    private LocalDateTime endDateTime;

    @Column(nullable = false)
    private Boolean active;

    @Column(name = "show_on_home")
    private Boolean showOnHome;

    @Column(name = "allow_repeat")
    private Boolean allowRepeat;

    @Column(name = "poster_url")
    private String posterUrl;

    @Column(name = "created_at")
    private LocalDateTime createdAt;

    @Column(name = "updated_at")
    private LocalDateTime updatedAt;

    @PrePersist
    public void prePersist() {
        this.createdAt = LocalDateTime.now();
        this.updatedAt = LocalDateTime.now();
        if (this.active == null)      this.active      = false;
        if (this.showOnHome == null)  this.showOnHome  = false;
        if (this.allowRepeat == null) this.allowRepeat = false;
        if (this.offerType == null)   this.offerType   = "CUSTOMER_SELECT";
    }

    @PreUpdate
    public void preUpdate() {
        this.updatedAt = LocalDateTime.now();
    }

    /** Computed status — never persisted, always derived at runtime. */
    public String computeStatus() {
        if (!Boolean.TRUE.equals(active)) return "INACTIVE";
        LocalDateTime now = LocalDateTime.now();
        if (startDateTime != null && startDateTime.isAfter(now)) return "SCHEDULED";
        if (endDateTime   != null && endDateTime.isBefore(now))  return "EXPIRED";
        if (startDateTime == null && endDateTime == null)        return "DRAFT";
        return "ACTIVE";
    }
}
