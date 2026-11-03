package com.gosuas.core.repository;

import com.gosuas.core.entity.Bill;
import jakarta.persistence.LockModeType;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

public interface BillRepository extends JpaRepository<Bill, UUID> {
    long countByBillNoStartingWith(String prefix);
    long countByBillNoStartingWithAndTenantId(String prefix, UUID tenantId);
    List<Bill> findAllByTenantId(UUID tenantId);
    List<Bill> findAllByTenantIdAndBillNoStartingWith(UUID tenantId, String prefix);
    Optional<Bill> findFirstByTenantIdAndCustomerMobileOrderByBillDateDesc(UUID tenantId, String customerMobile);
    Optional<Bill> findByBillNoAndTenantId(String billNo, UUID tenantId);

    // Eagerly fetch payments to avoid LazyInitializationException in reports
    @Query("SELECT DISTINCT b FROM Bill b LEFT JOIN FETCH b.payments WHERE b.tenantId = :tenantId")
    List<Bill> findAllByTenantIdWithPayments(@Param("tenantId") UUID tenantId);

    List<Bill> findAllByTenantIdAndCustomerMobileOrderByBillDateDesc(UUID tenantId, String customerMobile);

    // Row lock on the bill so two concurrent returns against it can't both pass the
    // "returned qty <= sold qty" check before either one commits.
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("SELECT b FROM Bill b WHERE b.id = :id")
    Optional<Bill> findByIdForUpdate(@Param("id") UUID id);
}
