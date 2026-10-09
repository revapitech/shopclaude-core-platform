package com.gosuas.core.repository;

import com.gosuas.core.entity.CustomerDetail;
import org.springframework.data.jpa.repository.JpaRepository;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

public interface CustomerDetailRepository extends JpaRepository<CustomerDetail, UUID> {
    Optional<CustomerDetail> findByEmail(String email);
    List<CustomerDetail> findAllByTenantId(UUID tenantId);
}
