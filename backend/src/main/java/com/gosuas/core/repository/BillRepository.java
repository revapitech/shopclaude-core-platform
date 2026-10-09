package com.gosuas.core.repository;

import com.gosuas.core.entity.Bill;
import org.springframework.data.jpa.repository.JpaRepository;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

public interface BillRepository extends JpaRepository<Bill, UUID> {
    long countByBillNoStartingWith(String prefix);
    long countByBillNoStartingWithAndTenantId(String prefix, UUID tenantId);
    List<Bill> findAllByTenantId(UUID tenantId);
    List<Bill> findAllByTenantIdAndBillNoStartingWith(UUID tenantId, String prefix);
    Optional<Bill> findFirstByTenantIdAndCustomerMobileOrderByBillDateDesc(UUID tenantId, String customerMobile);
}
