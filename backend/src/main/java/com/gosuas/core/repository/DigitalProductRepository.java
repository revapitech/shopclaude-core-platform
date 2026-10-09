package com.gosuas.core.repository;

import com.gosuas.core.entity.DigitalProduct;
import org.springframework.data.jpa.repository.JpaRepository;
import java.util.List;
import java.util.UUID;

public interface DigitalProductRepository extends JpaRepository<DigitalProduct, UUID> {
    List<DigitalProduct> findByTenantId(UUID tenantId);
    List<DigitalProduct> findByTenantIdAndActiveTrue(UUID tenantId);
}
