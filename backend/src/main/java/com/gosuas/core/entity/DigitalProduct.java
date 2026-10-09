package com.gosuas.core.entity;

import jakarta.persistence.*;
import lombok.*;
import java.math.BigDecimal;
import java.time.LocalDateTime;
import java.util.UUID;

@Entity
@Table(name = "digital_product")
@Getter @Setter @NoArgsConstructor @AllArgsConstructor @Builder
public class DigitalProduct {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;

    @Column(name = "tenant_id")
    private UUID tenantId;

    @Column(nullable = false)
    private String title;

    @Column(columnDefinition = "TEXT")
    private String description;

    @Column(nullable = false, precision = 10, scale = 2)
    private BigDecimal price;

    @Column(name = "pdf_path")
    private String pdfPath;

    @Column(name = "password_protected")
    private boolean passwordProtected;

    @Column(name = "pdf_password")
    private String pdfPassword;

    @Column(name = "cover_emoji")
    private String coverEmoji;

    private boolean active;

    @Column(name = "created_at")
    private LocalDateTime createdAt;

    @PrePersist
    public void prePersist() {
        createdAt = LocalDateTime.now();
        if (coverEmoji == null) coverEmoji = "📄";
        active = true;
    }
}
