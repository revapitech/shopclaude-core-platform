package com.gosuas.core.service;

import com.gosuas.core.config.TenantContext;
import com.gosuas.core.dto.RentalRequest;
import com.gosuas.core.dto.RentalResponse;
import com.gosuas.core.dto.RentalReturnRequest;
import com.gosuas.core.entity.Product;
import com.gosuas.core.entity.RentalOrder;
import com.gosuas.core.repository.ProductRepository;
import com.gosuas.core.repository.RentalOrderRepository;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.mockito.junit.jupiter.MockitoSettings;
import org.mockito.quality.Strictness;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

/**
 * Unit tests for RentalService.
 *
 * Covers:
 *   Create rental
 *     1. Happy path — returns a RentalResponse with computed total amount.
 *     2. Product not found → RuntimeException.
 *     3. Product not marked rental-available → RuntimeException.
 *     4. Null booking date → RuntimeException.
 *     5. Overbooking (not enough stock available) → RuntimeException.
 *
 *   Update rental
 *     6. Happy path — amounts and dates updated, same rental_no.
 *     7. Cross-tenant update → RuntimeException (tenant isolation).
 *
 *   Mark returned
 *     8. Happy path — status becomes RETURNED, refund = deposit - deduction.
 *     9. Deduction capped at deposit amount.
 *    10. Negative deduction clamped to zero.
 *    11. Already RETURNED — idempotent, no mutation.
 *    12. Cross-tenant markReturned → RuntimeException (tenant isolation).
 *
 *   Delete rental
 *    13. Happy path — delete called on repository.
 *    14. Cross-tenant delete → RuntimeException (tenant isolation).
 *
 *   List rentals
 *    15. Returns mapped responses for the current tenant only.
 */
@ExtendWith(MockitoExtension.class)
@MockitoSettings(strictness = Strictness.LENIENT)
class RentalServiceTest {

    @Mock private RentalOrderRepository rentalRepository;
    @Mock private ProductRepository     productRepository;

    @InjectMocks private RentalService rentalService;

    private UUID    tenantId;
    private UUID    otherTenantId;
    private Product rentalProduct;

    @BeforeEach
    void setUp() {
        tenantId      = UUID.randomUUID();
        otherTenantId = UUID.randomUUID();
        TenantContext.setTenantId(tenantId);

        rentalProduct = new Product();
        rentalProduct.setId(UUID.randomUUID());
        rentalProduct.setName("Wedding Tent");
        rentalProduct.setBarcode("TENT-001");
        rentalProduct.setStockQty(5);
        rentalProduct.setRentalAvailable(true);

        when(rentalRepository.save(any())).thenAnswer(inv -> inv.getArgument(0));
        when(rentalRepository.findAllByTenantIdAndRentalNoStartingWith(eq(tenantId), any()))
                .thenReturn(List.of());
        when(rentalRepository.findAllByTenantIdAndProductCode(eq(tenantId), eq("TENT-001")))
                .thenReturn(List.of());
    }

    @AfterEach
    void tearDown() {
        TenantContext.clear();
    }

    // ── Create rental ──────────────────────────────────────────────────────────

    /** 1. Valid create — total = advance + deposit + rent. */
    @Test
    void createRental_validRequest_returnsMappedResponse() {
        when(productRepository.findByBarcodeAndTenantId("TENT-001", tenantId))
                .thenReturn(Optional.of(rentalProduct));

        RentalRequest req = new RentalRequest(
                "TENT-001", 1,
                new BigDecimal("500"), new BigDecimal("1000"), new BigDecimal("2000"),
                "Alice", "9876543210",
                LocalDate.now().plusDays(2), 2);

        RentalResponse resp = rentalService.createRental(req);

        assertThat(resp).isNotNull();
        assertThat(resp.totalAmount()).isEqualByComparingTo("3500");
        assertThat(resp.customerName()).isEqualTo("Alice");
        assertThat(resp.productCode()).isEqualTo("TENT-001");
        assertThat(resp.eventPeriodDays()).isEqualTo(2);
    }

    /** 2. Product code not found → exception. */
    @Test
    void createRental_productNotFound_throwsRuntimeException() {
        when(productRepository.findByBarcodeAndTenantId(any(), eq(tenantId)))
                .thenReturn(Optional.empty());
        when(productRepository.findBySkuAndTenantId(any(), eq(tenantId)))
                .thenReturn(Optional.empty());

        RentalRequest req = new RentalRequest(
                "GHOST-001", 1, null, null, null,
                "Bob", null, LocalDate.now(), 1);

        assertThatThrownBy(() -> rentalService.createRental(req))
                .isInstanceOf(RuntimeException.class)
                .hasMessageContaining("Product not found");
    }

    /** 3. Product exists but rentalAvailable = false → exception. */
    @Test
    void createRental_productNotRentalAvailable_throwsRuntimeException() {
        rentalProduct.setRentalAvailable(false);
        when(productRepository.findByBarcodeAndTenantId("TENT-001", tenantId))
                .thenReturn(Optional.of(rentalProduct));

        RentalRequest req = new RentalRequest(
                "TENT-001", 1, null, null, null,
                "Bob", null, LocalDate.now(), 1);

        assertThatThrownBy(() -> rentalService.createRental(req))
                .isInstanceOf(RuntimeException.class)
                .hasMessageContaining("not marked as available for rental");
    }

    /** 4. Null booking date → exception. */
    @Test
    void createRental_nullBookingDate_throwsRuntimeException() {
        when(productRepository.findByBarcodeAndTenantId("TENT-001", tenantId))
                .thenReturn(Optional.of(rentalProduct));

        RentalRequest req = new RentalRequest(
                "TENT-001", 1, null, null, null,
                "Carol", null, null, 1);

        assertThatThrownBy(() -> rentalService.createRental(req))
                .isInstanceOf(RuntimeException.class)
                .hasMessageContaining("Booking date is required");
    }

    /** 5. Requesting more units than available on the requested dates → exception. */
    @Test
    void createRental_overbooking_throwsRuntimeException() {
        rentalProduct.setStockQty(1); // only 1 unit

        // An existing active rental takes the 1 unit on the same date range
        RentalOrder existing = new RentalOrder();
        existing.setId(UUID.randomUUID());
        existing.setTenantId(tenantId);
        existing.setProductCode("TENT-001");
        existing.setStatus("RENTED");
        existing.setQuantity(1);
        existing.setBookingDate(LocalDate.now());
        existing.setBookingEndDate(LocalDate.now().plusDays(2));

        when(productRepository.findByBarcodeAndTenantId("TENT-001", tenantId))
                .thenReturn(Optional.of(rentalProduct));
        when(rentalRepository.findAllByTenantIdAndProductCode(tenantId, "TENT-001"))
                .thenReturn(List.of(existing));

        RentalRequest req = new RentalRequest(
                "TENT-001", 1, null, null, null,
                "Dave", null, LocalDate.now().plusDays(1), 1);

        assertThatThrownBy(() -> rentalService.createRental(req))
                .isInstanceOf(RuntimeException.class)
                .hasMessageContaining("already booked");
    }

    // ── Update rental ──────────────────────────────────────────────────────────

    /** 6. Valid update — amounts and dates are persisted. */
    @Test
    void updateRental_validRequest_updatesFields() {
        UUID rentalId = UUID.randomUUID();

        RentalOrder existing = rentalOrder(rentalId, tenantId, "TENT-001");
        when(rentalRepository.findById(rentalId)).thenReturn(Optional.of(existing));
        when(productRepository.findByBarcodeAndTenantId("TENT-001", tenantId))
                .thenReturn(Optional.of(rentalProduct));

        RentalRequest req = new RentalRequest(
                "TENT-001", 2,
                new BigDecimal("600"), new BigDecimal("1200"), new BigDecimal("2400"),
                "Eve", "9000000001",
                LocalDate.now().plusDays(5), 3);

        RentalResponse resp = rentalService.updateRental(rentalId, req);

        assertThat(resp.quantity()).isEqualTo(2);
        assertThat(resp.totalAmount()).isEqualByComparingTo("4200");
        assertThat(resp.customerName()).isEqualTo("Eve");
        assertThat(resp.eventPeriodDays()).isEqualTo(3);
    }

    /** 7. Update rental belonging to another tenant → exception (tenant isolation). */
    @Test
    void updateRental_crossTenant_throwsRuntimeException() {
        UUID rentalId = UUID.randomUUID();
        RentalOrder otherTenantRental = rentalOrder(rentalId, otherTenantId, "TENT-001");

        when(rentalRepository.findById(rentalId)).thenReturn(Optional.of(otherTenantRental));

        RentalRequest req = new RentalRequest(
                "TENT-001", 1, null, null, null,
                "Hacker", null, LocalDate.now(), 1);

        assertThatThrownBy(() -> rentalService.updateRental(rentalId, req))
                .isInstanceOf(RuntimeException.class)
                .hasMessageContaining("Rental not found");
    }

    // ── Mark returned ──────────────────────────────────────────────────────────

    /** 8. Mark returned: refund = deposit - deduction. */
    @Test
    void markReturned_validDeduction_setsRefundCorrectly() {
        UUID rentalId = UUID.randomUUID();
        RentalOrder rental = rentalOrder(rentalId, tenantId, "TENT-001");
        rental.setDepositAmount(new BigDecimal("1000"));

        when(rentalRepository.findById(rentalId)).thenReturn(Optional.of(rental));

        RentalReturnRequest req = new RentalReturnRequest(
                new BigDecimal("200"), "Minor damage", LocalDate.now());

        RentalResponse resp = rentalService.markReturned(rentalId, req);

        assertThat(resp.status()).isEqualTo("RETURNED");
        assertThat(resp.deductionAmount()).isEqualByComparingTo("200");
        assertThat(resp.refundAmount()).isEqualByComparingTo("800");
    }

    /** 9. Deduction exceeding deposit is capped at deposit amount. */
    @Test
    void markReturned_deductionExceedsDeposit_cappedAtDeposit() {
        UUID rentalId = UUID.randomUUID();
        RentalOrder rental = rentalOrder(rentalId, tenantId, "TENT-001");
        rental.setDepositAmount(new BigDecimal("500"));

        when(rentalRepository.findById(rentalId)).thenReturn(Optional.of(rental));

        RentalReturnRequest req = new RentalReturnRequest(
                new BigDecimal("9999"), "Total loss", LocalDate.now());

        RentalResponse resp = rentalService.markReturned(rentalId, req);

        assertThat(resp.deductionAmount()).isEqualByComparingTo("500");
        assertThat(resp.refundAmount()).isEqualByComparingTo("0");
    }

    /** 10. Negative deduction is clamped to zero — no windfall refund. */
    @Test
    void markReturned_negativeDeduction_clampedToZero() {
        UUID rentalId = UUID.randomUUID();
        RentalOrder rental = rentalOrder(rentalId, tenantId, "TENT-001");
        rental.setDepositAmount(new BigDecimal("500"));

        when(rentalRepository.findById(rentalId)).thenReturn(Optional.of(rental));

        RentalReturnRequest req = new RentalReturnRequest(
                new BigDecimal("-100"), "No damage", LocalDate.now());

        RentalResponse resp = rentalService.markReturned(rentalId, req);

        assertThat(resp.deductionAmount()).isEqualByComparingTo("0");
        assertThat(resp.refundAmount()).isEqualByComparingTo("500");
    }

    /** 11. Already RETURNED rental is not mutated (idempotent). */
    @Test
    void markReturned_alreadyReturned_isIdempotent() {
        UUID rentalId = UUID.randomUUID();
        RentalOrder rental = rentalOrder(rentalId, tenantId, "TENT-001");
        rental.setStatus("RETURNED");
        rental.setRefundAmount(new BigDecimal("400"));

        when(rentalRepository.findById(rentalId)).thenReturn(Optional.of(rental));

        RentalReturnRequest req = new RentalReturnRequest(
                new BigDecimal("999"), "Re-return attempt", LocalDate.now());

        // Should not throw; deduction/refund must remain at previously-set values
        RentalResponse resp = rentalService.markReturned(rentalId, req);

        assertThat(resp.status()).isEqualTo("RETURNED");
        assertThat(resp.refundAmount()).isEqualByComparingTo("400");
    }

    /** 12. markReturned on another tenant's rental → exception (tenant isolation). */
    @Test
    void markReturned_crossTenant_throwsRuntimeException() {
        UUID rentalId = UUID.randomUUID();
        RentalOrder otherTenantRental = rentalOrder(rentalId, otherTenantId, "TENT-001");

        when(rentalRepository.findById(rentalId)).thenReturn(Optional.of(otherTenantRental));

        assertThatThrownBy(() -> rentalService.markReturned(rentalId, null))
                .isInstanceOf(RuntimeException.class)
                .hasMessageContaining("Rental not found");
    }

    // ── Delete rental ──────────────────────────────────────────────────────────

    /** 13. Delete own tenant's rental — repository delete is called. */
    @Test
    void deleteRental_ownTenant_deletesSuccessfully() {
        UUID rentalId = UUID.randomUUID();
        RentalOrder rental = rentalOrder(rentalId, tenantId, "TENT-001");

        when(rentalRepository.findById(rentalId)).thenReturn(Optional.of(rental));

        rentalService.deleteRental(rentalId);

        verify(rentalRepository).delete(rental);
    }

    /** 14. Delete another tenant's rental → exception (tenant isolation). */
    @Test
    void deleteRental_crossTenant_throwsRuntimeException() {
        UUID rentalId = UUID.randomUUID();
        RentalOrder otherTenantRental = rentalOrder(rentalId, otherTenantId, "TENT-001");

        when(rentalRepository.findById(rentalId)).thenReturn(Optional.of(otherTenantRental));

        assertThatThrownBy(() -> rentalService.deleteRental(rentalId))
                .isInstanceOf(RuntimeException.class)
                .hasMessageContaining("Rental not found");

        verify(rentalRepository, never()).delete(any());
    }

    // ── List rentals ───────────────────────────────────────────────────────────

    /** 15. listRentals delegates to repository filtered by current tenant's ID. */
    @Test
    void listRentals_returnsMappedResponsesForCurrentTenant() {
        UUID rentalId1 = UUID.randomUUID();
        UUID rentalId2 = UUID.randomUUID();

        when(rentalRepository.findAllByTenantIdOrderByRentedAtDesc(tenantId))
                .thenReturn(List.of(
                        rentalOrder(rentalId1, tenantId, "TENT-001"),
                        rentalOrder(rentalId2, tenantId, "TENT-001")));

        List<RentalResponse> result = rentalService.listRentals();

        assertThat(result).hasSize(2);
        verify(rentalRepository).findAllByTenantIdOrderByRentedAtDesc(tenantId);
        // Must never query another tenant's rentals
        verify(rentalRepository, never()).findAllByTenantIdOrderByRentedAtDesc(otherTenantId);
    }

    // ── Helper ─────────────────────────────────────────────────────────────────

    /** Builds a minimal RentalOrder for the given tenant. */
    private RentalOrder rentalOrder(UUID id, UUID ownerTenantId, String productCode) {
        RentalOrder r = new RentalOrder();
        r.setId(id);
        r.setTenantId(ownerTenantId);
        r.setRentalNo("RENT-20261114-0001");
        r.setProductCode(productCode);
        r.setProductName("Wedding Tent");
        r.setQuantity(1);
        r.setAdvanceAmount(new BigDecimal("500"));
        r.setDepositAmount(new BigDecimal("1000"));
        r.setRentAmount(new BigDecimal("2000"));
        r.setTotalAmount(new BigDecimal("3500"));
        r.setCustomerName("Test Customer");
        r.setBookingDate(LocalDate.now());
        r.setBookingEndDate(LocalDate.now().plusDays(1));
        r.setEventPeriodDays(2);
        r.setStatus("RENTED");
        return r;
    }
}