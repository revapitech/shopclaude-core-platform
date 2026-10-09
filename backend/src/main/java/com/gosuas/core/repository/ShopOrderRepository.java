package com.gosuas.core.repository;

import com.gosuas.core.entity.ShopOrder;
import org.springframework.data.jpa.repository.JpaRepository;
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
}
