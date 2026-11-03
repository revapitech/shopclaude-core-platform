package com.gosuas.core.repository;

import com.gosuas.core.entity.Offer;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.time.LocalDateTime;
import java.util.List;
import java.util.UUID;

public interface OfferRepository extends JpaRepository<Offer, UUID> {

    List<Offer> findAllByTenantId(UUID tenantId);

    /** Public storefront: only active, visible, within validity window. */
    @Query("""
        SELECT o FROM Offer o
        WHERE o.tenantId    = :tenantId
          AND o.active      = true
          AND o.showOnHome  = true
          AND (o.startDateTime IS NULL OR o.startDateTime <= :now)
          AND (o.endDateTime   IS NULL OR o.endDateTime   >= :now)
        ORDER BY o.createdAt DESC
        """)
    List<Offer> findActivePublicOffers(@Param("tenantId") UUID tenantId,
                                       @Param("now") LocalDateTime now);
}
