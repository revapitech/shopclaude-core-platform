package com.gosuas.core.repository;

import com.gosuas.core.entity.OrderDetail;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import java.util.List;
import java.util.UUID;

public interface OrderDetailRepository extends JpaRepository<OrderDetail, UUID> {
    List<OrderDetail> findByCustomerId(UUID customerId);

    /**
     * @deprecated Returns ALL orders across ALL tenants — this is a cross-tenant data leak.
     * Use {@link #findAllWithItemsByTenantId(UUID)} instead, which scopes to a single tenant.
     * This method is kept only for reference; it must NOT be called from any controller or service.
     */
    @Deprecated
    @Query("SELECT o FROM OrderDetail o LEFT JOIN FETCH o.items ORDER BY o.orderedAt DESC")
    List<OrderDetail> findAllWithItems();

    @Query("SELECT o FROM OrderDetail o LEFT JOIN FETCH o.items WHERE o.tenantId = :tenantId ORDER BY o.orderedAt DESC")
    List<OrderDetail> findAllWithItemsByTenantId(@Param("tenantId") UUID tenantId);

    List<OrderDetail> findAllByTenantId(UUID tenantId);
}
