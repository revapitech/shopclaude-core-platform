package com.gosuas.core.repository;

import com.gosuas.core.entity.RentalOrder;
import org.springframework.data.jpa.repository.JpaRepository;
import java.util.List;
import java.util.UUID;

public interface RentalOrderRepository extends JpaRepository<RentalOrder, UUID> {
    List<RentalOrder> findAllByTenantIdOrderByRentedAtDesc(UUID tenantId);
    long countByRentalNoStartingWithAndTenantId(String prefix, UUID tenantId);
    List<RentalOrder> findAllByTenantIdAndRentalNoStartingWith(UUID tenantId, String prefix);
    List<RentalOrder> findAllByTenantIdAndProductCode(UUID tenantId, String productCode);
}
