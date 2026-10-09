package com.gosuas.core.repository;

import com.gosuas.core.entity.OrderDetail;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import java.util.List;
import java.util.UUID;

public interface OrderDetailRepository extends JpaRepository<OrderDetail, UUID> {
    List<OrderDetail> findByCustomerId(UUID customerId);

    @Query("SELECT o FROM OrderDetail o LEFT JOIN FETCH o.items ORDER BY o.orderedAt DESC")
    List<OrderDetail> findAllWithItems();

    @Query("SELECT o FROM OrderDetail o LEFT JOIN FETCH o.items WHERE o.tenantId = :tenantId ORDER BY o.orderedAt DESC")
    List<OrderDetail> findAllWithItemsByTenantId(@Param("tenantId") UUID tenantId);

    List<OrderDetail> findAllByTenantId(UUID tenantId);
}
