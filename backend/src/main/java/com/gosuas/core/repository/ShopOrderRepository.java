package com.gosuas.core.repository;

import com.gosuas.core.entity.ShopOrder;
import jakarta.persistence.LockModeType;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

public interface ShopOrderRepository extends JpaRepository<ShopOrder, UUID> {
    long countByOrderNoStartingWith(String prefix);
    long countByOrderNoStartingWithAndTenantId(String prefix, UUID tenantId);
    List<ShopOrder> findAllByOrderNoStartingWith(String prefix);
    List<ShopOrder> findAllByTenantIdAndOrderNoStartingWith(UUID tenantId, String prefix);
    Optional<ShopOrder> findByOrderNo(String orderNo);
    List<ShopOrder> findByCustomerPhone(String customerPhone);
    List<ShopOrder> findAllByTenantId(UUID tenantId);
    Optional<ShopOrder> findByOrderNoAndTenantId(String orderNo, UUID tenantId);
    List<ShopOrder> findByCustomerPhoneAndTenantId(String customerPhone, UUID tenantId);

    // Same guard as BillRepository.findByIdForUpdate, for returns against online orders.
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("SELECT o FROM ShopOrder o WHERE o.id = :id")
    Optional<ShopOrder> findByIdForUpdate(@Param("id") UUID id);
}
