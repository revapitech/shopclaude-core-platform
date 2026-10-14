package com.gosuas.core.repository;

import com.gosuas.core.entity.SalesReturn;
import jakarta.persistence.LockModeType;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

public interface SalesReturnRepository extends JpaRepository<SalesReturn, UUID> {

    List<SalesReturn> findAllByTenantIdOrderByCreatedAtDesc(UUID tenantId);

    /**
     * Row lock for status transitions. Without it, two concurrent APPROVE requests (double
     * click, two tabs) both read stockRestored=false and both restore stock.
     */
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("SELECT r FROM SalesReturn r WHERE r.id = :id")
    Optional<SalesReturn> findByIdForUpdate(@Param("id") UUID id);

    Optional<SalesReturn> findByReturnNoAndTenantId(String returnNo, UUID tenantId);

    List<SalesReturn> findAllByTenantIdAndReturnNoStartingWith(UUID tenantId, String prefix);

    /**
     * Returns the sum of returnedQty for a given (tenant, sourceBill, barcode) across all
     * non-cancelled/non-rejected returns. Used to enforce that cumulative returned qty
     * never exceeds the original sale qty.
     */
    @Query("SELECT COALESCE(SUM(i.returnedQty), 0) FROM SalesReturnItem i " +
           "WHERE i.salesReturn.tenantId = :tenantId " +
           "AND i.salesReturn.sourceBillId = :sourceBillId " +
           "AND i.barcode = :barcode " +
           "AND i.salesReturn.status NOT IN ('CANCELLED', 'REJECTED')")
    int sumReturnedQtyByBillAndBarcode(
            @Param("tenantId") UUID tenantId,
            @Param("sourceBillId") UUID sourceBillId,
            @Param("barcode") String barcode);
}