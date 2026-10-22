package com.gosuas.core.repository;

import com.gosuas.core.entity.DamageStock;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.UUID;

public interface DamageStockRepository extends JpaRepository<DamageStock, UUID> {

    List<DamageStock> findAllByTenantIdOrderByCreatedAtDesc(UUID tenantId);

    List<DamageStock> findAllByTenantIdAndDamageNoStartingWith(UUID tenantId, String prefix);
}
