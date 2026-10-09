package com.gosuas.core.repository;

import com.gosuas.core.entity.DigitalOrder;
import org.springframework.data.jpa.repository.JpaRepository;
import java.util.List;
import java.util.UUID;

public interface DigitalOrderRepository extends JpaRepository<DigitalOrder, UUID> {
    List<DigitalOrder> findByTenantId(UUID tenantId);
    List<DigitalOrder> findByDigitalProductId(UUID digitalProductId);
}
