package com.gosuas.core.service;

import com.gosuas.core.config.TenantContext;
import com.gosuas.core.dto.RentalRequest;
import com.gosuas.core.entity.*;
import com.gosuas.core.repository.*;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.mockito.junit.jupiter.MockitoSettings;
import org.mockito.quality.Strictness;

import java.time.LocalDate;
import java.util.Optional;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.*;

/**
 * Cross-service tenant isolation tests.
 *
 * Every service operation that takes an entity ID must reject access to records
 * belonging to a different tenant, even when the caller supplies a valid ID.
 * These tests confirm the {@code .filter(r -> tenantId.equals(r.getTenantId()))}
 * guard is in place for each such operation.
 *
 * The error message is intentionally identical to the genuine "not found" case —
 * it must not leak whether the record exists under a different tenant.
 *
 * Services covered:
 *   RentalService    — updateRental, markReturned, deleteRental
 *   ProductService   — delete, updateStock
 *   SalesReturnService — getReturn, updateStatus
 */
@ExtendWith(MockitoExtension.class)
@MockitoSettings(strictness = Strictness.LENIENT)
class TenantIsolationTest {

    // ── Shared mocks ───────────────────────────────────────────────────────────
    @Mock ProductRepository     productRepository;
    @Mock TenantRepository      tenantRepository;

    // ── RentalService ──────────────────────────────────────────────────────────
    @Mock RentalOrderRepository rentalRepository;
    @InjectMocks RentalService  rentalService;

    // ── ProductService ─────────────────────────────────────────────────────────
    @InjectMocks ProductService productService;

    // ── SalesReturnService ─────────────────────────────────────────────────────
    @Mock SalesReturnRepository returnRepository;
    @Mock BillRepository        billRepository;
    @Mock ShopOrderRepository   shopOrderRepository;
    @InjectMocks SalesReturnService salesReturnService;

    private UUID tenantA;
    private UUID tenantB;

    @BeforeEach
    void setUp() {
        tenantA = UUID.randomUUID();
        tenantB = UUID.randomUUID();
        TenantContext.setTenantId(tenantA); // authenticated as tenantA
    }

    @AfterEach
    void tearDown() {
        TenantContext.clear();
    }

    // ── RentalService isolation ────────────────────────────────────────────────

    /** RentalService.updateRental: reject update of a rental owned by tenantB. */
    @Test
    void rentalService_updateRental_crossTenant_rejected() {
        UUID rentalId = UUID.randomUUID();
        when(rentalRepository.findById(rentalId))
                .thenReturn(Optional.of(rentalOrder(rentalId, tenantB)));

        RentalRequest req = new RentalRequest(
                "TENT-001", 1, null, null, null,
                "Attacker", null, LocalDate.now(), 1);

        assertThatThrownBy(() -> rentalService.updateRental(rentalId, req))
                .isInstanceOf(RuntimeException.class)
                .hasMessageContaining("not found");
    }

    /** RentalService.markReturned: reject marking a rental owned by tenantB as returned. */
    @Test
    void rentalService_markReturned_crossTenant_rejected() {
        UUID rentalId = UUID.randomUUID();
        when(rentalRepository.findById(rentalId))
                .thenReturn(Optional.of(rentalOrder(rentalId, tenantB)));

        assertThatThrownBy(() -> rentalService.markReturned(rentalId, null))
                .isInstanceOf(RuntimeException.class)
                .hasMessageContaining("not found");
    }

    /** RentalService.deleteRental: reject delete of a rental owned by tenantB. */
    @Test
    void rentalService_deleteRental_crossTenant_rejected() {
        UUID rentalId = UUID.randomUUID();
        when(rentalRepository.findById(rentalId))
                .thenReturn(Optional.of(rentalOrder(rentalId, tenantB)));

        assertThatThrownBy(() -> rentalService.deleteRental(rentalId))
                .isInstanceOf(RuntimeException.class)
                .hasMessageContaining("not found");

        verify(rentalRepository, never()).delete(any());
    }

    // ── ProductService isolation ───────────────────────────────────────────────

    /** ProductService.delete: reject delete of a product owned by tenantB. */
    @Test
    void productService_delete_crossTenant_rejected() {
        UUID productId = UUID.randomUUID();
        Product otherProduct = product(productId, tenantB);

        when(productRepository.findById(productId)).thenReturn(Optional.of(otherProduct));

        assertThatThrownBy(() -> productService.delete(productId))
                .isInstanceOf(RuntimeException.class)
                .hasMessageContaining("not found");

        verify(productRepository, never()).delete(any());
    }

    /** ProductService.updateStock: reject stock update on a product owned by tenantB. */
    @Test
    void productService_updateStock_crossTenant_rejected() {
        UUID productId = UUID.randomUUID();
        Product otherProduct = product(productId, tenantB);

        when(productRepository.findById(productId)).thenReturn(Optional.of(otherProduct));

        assertThatThrownBy(() -> productService.updateStock(productId, 10))
                .isInstanceOf(RuntimeException.class)
                .hasMessageContaining("not found");

        verify(productRepository, never()).save(any());
    }

    // ── SalesReturnService isolation ───────────────────────────────────────────

    /** SalesReturnService.getReturn: reject fetching a return owned by tenantB. */
    @Test
    void salesReturnService_getReturn_crossTenant_rejected() {
        UUID returnId = UUID.randomUUID();
        SalesReturn otherReturn = salesReturn(returnId, tenantB);

        when(returnRepository.findById(returnId)).thenReturn(Optional.of(otherReturn));

        assertThatThrownBy(() -> salesReturnService.getReturn(returnId))
                .isInstanceOf(RuntimeException.class)
                .hasMessageContaining("not found");
    }

    /** SalesReturnService.updateStatus: reject status change on a return owned by tenantB. */
    @Test
    void salesReturnService_updateStatus_crossTenant_rejected() {
        UUID returnId = UUID.randomUUID();
        SalesReturn otherReturn = salesReturn(returnId, tenantB);

        when(returnRepository.findByIdForUpdate(returnId)).thenReturn(Optional.of(otherReturn));

        assertThatThrownBy(() -> salesReturnService.updateStatus(returnId, "APPROVED"))
                .isInstanceOf(RuntimeException.class)
                .hasMessageContaining("not found");

        verify(returnRepository, never()).save(any());
    }

    // ── Helpers ────────────────────────────────────────────────────────────────

    private RentalOrder rentalOrder(UUID id, UUID ownerTenantId) {
        RentalOrder r = new RentalOrder();
        r.setId(id);
        r.setTenantId(ownerTenantId);
        r.setRentalNo("RENT-20261114-0001");
        r.setProductCode("TENT-001");
        r.setQuantity(1);
        r.setStatus("RENTED");
        r.setBookingDate(LocalDate.now());
        r.setBookingEndDate(LocalDate.now().plusDays(1));
        return r;
    }

    private Product product(UUID id, UUID ownerTenantId) {
        Product p = new Product();
        p.setId(id);
        p.setTenantId(ownerTenantId);
        p.setName("Other Tenant's Product");
        return p;
    }

    private SalesReturn salesReturn(UUID id, UUID ownerTenantId) {
        SalesReturn r = new SalesReturn();
        r.setId(id);
        r.setTenantId(ownerTenantId);
        r.setStatus("PENDING");
        return r;
    }
}