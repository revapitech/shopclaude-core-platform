package com.gosuas.core.repository;

import com.gosuas.core.entity.BillPayment;
import org.springframework.data.jpa.repository.JpaRepository;
import java.util.List;
import java.util.UUID;

public interface BillPaymentRepository extends JpaRepository<BillPayment, UUID> {
    List<BillPayment> findByBillId(UUID billId);
}
