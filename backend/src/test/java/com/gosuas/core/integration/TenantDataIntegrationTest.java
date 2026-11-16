package com.gosuas.core.integration;

import com.gosuas.core.entity.Bill;
import com.gosuas.core.entity.Product;
import com.gosuas.core.entity.Tenant;
import com.gosuas.core.repository.BillRepository;
import com.gosuas.core.repository.ProductRepository;
import com.gosuas.core.repository.TenantRepository;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.jdbc.AutoConfigureTestDatabase;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.testcontainers.service.connection.ServiceConnection;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.test.annotation.DirtiesContext;
import org.springframework.test.context.TestPropertySource;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;

import java.math.BigDecimal;
import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.*;

/**
 * Real PostgreSQL integration tests using Testcontainers.
 *
 * Requires Docker Desktop to be running.
 * These tests verify what unit tests with Mockito mocks cannot:
 *
 *   1. Composite unique constraint uq_product_sku_tenant:
 *      - Two different tenants CAN share the same SKU.
 *      - The same tenant CANNOT have two products with the same SKU.
 *
 *   2. Composite unique constraint uq_product_barcode_tenant:
 *      - Same rules as above, applied to barcode.
 *
 *   3. Tenant isolation in repository queries:
 *      - findAllByTenantId returns only that tenant's data.
 *      - Cross-tenant data never leaks.
 *
 *   4. Tenant data migration guard:
 *      - decrementStock and other tenant-scoped @Modifying queries include
 *        tenantId in the WHERE clause (verified at the JDBC level).
 *
 * Run with: mvn test -Dtest=TenantDataIntegrationTest
 * (Skipped automatically when Docker is unavailable.)
 */
@SpringBootTest
@Testcontainers(disabledWithoutDocker = true)
@AutoConfigureTestDatabase(replace = AutoConfigureTestDatabase.Replace.NONE)
@TestPropertySource(properties = {
        // Disable SMTP — not needed for data-layer tests
        "spring.autoconfigure.exclude=org.springframework.boot.autoconfigure.mail.MailSenderAutoConfiguration",
        // Suppress noisy Hibernate DDL logs in test output
        "spring.jpa.show-sql=false",
        // DataInitializer creates the gosuas seed tenant; allow it to run once
        "gosuas.init.create-seed-tenant=true"
})
@DirtiesContext(classMode = DirtiesContext.ClassMode.AFTER_CLASS)
class TenantDataIntegrationTest {

    @Container
    @ServiceConnection
    static final PostgreSQLContainer<?> POSTGRES =
            new PostgreSQLContainer<>("postgres:16-alpine");

    @Autowired BillRepository    billRepository;
    @Autowired ProductRepository productRepository;
    @Autowired TenantRepository  tenantRepository;

    // ── Helper ────────────────────────────────────────────────────────────────

    private Tenant createTenant(String subdomain) {
        return tenantRepository.save(Tenant.builder()
                .name("Test Tenant " + subdomain)
                .subdomain(subdomain)
                .ownerEmail(subdomain + "@test.com")
                .plan("STARTER")
                .status("ACTIVE")
                .build());
    }

    private Bill bill(UUID tenantId, String billNo) {
        return Bill.builder()
                .tenantId(tenantId)
                .billNo(billNo)
                .customerName("Test Customer")
                .grandTotal(new BigDecimal("100"))
                .paymentMode("CASH")
                .paymentStatus("PAID")
                .build();
    }

    private Product product(UUID tenantId, String sku, String barcode) {
        return Product.builder()
                .tenantId(tenantId)
                .name("Product " + sku)
                .sku(sku)
                .barcode(barcode)
                .sellingPrice(new BigDecimal("100"))
                .stockQty(10)
                .active(true)
                .build();
    }

    // ── Composite SKU constraint ───────────────────────────────────────────────

    /**
     * Two different tenants can store products with the same SKU.
     * This would have failed under the old global unique constraint.
     */
    @Test
    void skuConstraint_differentTenants_canShareSameSku() {
        Tenant t1 = createTenant("alpha-" + UUID.randomUUID());
        Tenant t2 = createTenant("beta-"  + UUID.randomUUID());

        String sharedSku     = "SHARED-SKU-" + UUID.randomUUID();
        String sharedBarcode = "BAR-A-"      + UUID.randomUUID();
        String otherBarcode  = "BAR-B-"      + UUID.randomUUID();

        // Both tenants can save a product with the same SKU — no exception expected
        assertThatCode(() -> {
            productRepository.save(product(t1.getId(), sharedSku, sharedBarcode));
            productRepository.save(product(t2.getId(), sharedSku, otherBarcode));
        }).doesNotThrowAnyException();
    }

    /**
     * The same tenant cannot store two products with the same SKU.
     * The composite constraint (sku, tenant_id) must reject this.
     */
    @Test
    void skuConstraint_sameTenant_duplicateSkuRejected() {
        Tenant t = createTenant("gamma-" + UUID.randomUUID());

        String dupSku = "DUP-SKU-" + UUID.randomUUID();

        productRepository.save(product(t.getId(), dupSku, "BAR-C-" + UUID.randomUUID()));

        // Second product with same SKU for same tenant must throw
        assertThatThrownBy(() ->
                productRepository.saveAndFlush(product(t.getId(), dupSku, "BAR-D-" + UUID.randomUUID())))
                .isInstanceOf(DataIntegrityViolationException.class);
    }

    // ── Composite barcode constraint ───────────────────────────────────────────

    /**
     * Two different tenants can store products with the same barcode.
     */
    @Test
    void barcodeConstraint_differentTenants_canShareSameBarcode() {
        Tenant t1 = createTenant("delta-"   + UUID.randomUUID());
        Tenant t2 = createTenant("epsilon-" + UUID.randomUUID());

        String sharedBarcode = "SHARED-BAR-" + UUID.randomUUID();
        String skuA          = "SKU-E-"      + UUID.randomUUID();
        String skuB          = "SKU-F-"      + UUID.randomUUID();

        assertThatCode(() -> {
            productRepository.save(product(t1.getId(), skuA, sharedBarcode));
            productRepository.save(product(t2.getId(), skuB, sharedBarcode));
        }).doesNotThrowAnyException();
    }

    /**
     * The same tenant cannot store two products with the same barcode.
     */
    @Test
    void barcodeConstraint_sameTenant_duplicateBarcodeRejected() {
        Tenant t = createTenant("zeta-" + UUID.randomUUID());

        String dupBarcode = "DUP-BAR-" + UUID.randomUUID();

        productRepository.save(product(t.getId(), "SKU-G-" + UUID.randomUUID(), dupBarcode));

        assertThatThrownBy(() ->
                productRepository.saveAndFlush(product(t.getId(), "SKU-H-" + UUID.randomUUID(), dupBarcode)))
                .isInstanceOf(DataIntegrityViolationException.class);
    }

    // ── Tenant isolation in repository queries ─────────────────────────────────

    /**
     * findAllByTenantId returns only that tenant's products;
     * products saved under another tenant are never included.
     */
    @Test
    void findAllByTenantId_returnsOnlyOwnTenantProducts() {
        Tenant tA = createTenant("eta-"   + UUID.randomUUID());
        Tenant tB = createTenant("theta-" + UUID.randomUUID());

        // Save 2 products under tA, 1 under tB
        productRepository.save(product(tA.getId(), "SKU-TA1-" + UUID.randomUUID(), "B-TA1-" + UUID.randomUUID()));
        productRepository.save(product(tA.getId(), "SKU-TA2-" + UUID.randomUUID(), "B-TA2-" + UUID.randomUUID()));
        productRepository.save(product(tB.getId(), "SKU-TB1-" + UUID.randomUUID(), "B-TB1-" + UUID.randomUUID()));

        List<Product> resultA = productRepository.findAllByTenantId(tA.getId());
        List<Product> resultB = productRepository.findAllByTenantId(tB.getId());

        // tA gets exactly 2 results
        assertThat(resultA).hasSize(2);
        assertThat(resultA).allMatch(p -> tA.getId().equals(p.getTenantId()));

        // tB gets exactly 1 result
        assertThat(resultB).hasSize(1);
        assertThat(resultB.get(0).getTenantId()).isEqualTo(tB.getId());

        // tA's products are not in tB's list and vice versa
        List<UUID> idsA = resultA.stream().map(Product::getId).toList();
        List<UUID> idsB = resultB.stream().map(Product::getId).toList();
        assertThat(idsA).doesNotContainAnyElementsOf(idsB);
    }

    // ── Tenant-scoped write guard ──────────────────────────────────────────────

    /**
     * decrementStock includes tenant_id in the WHERE clause.
     * Attempting to decrement stock on another tenant's product must affect 0 rows.
     */
    @Test
    void decrementStock_wrongTenant_affectsZeroRows() {
        Tenant tOwner    = createTenant("iota-"  + UUID.randomUUID());
        Tenant tAttacker = createTenant("kappa-" + UUID.randomUUID());

        Product p = productRepository.save(
                product(tOwner.getId(), "SKU-DEC-" + UUID.randomUUID(), "BAR-DEC-" + UUID.randomUUID()));

        // Attacker supplies the owner's product ID but their own tenant ID
        int rows = productRepository.decrementStock(p.getId(), tAttacker.getId(), 1);

        assertThat(rows)
                .as("Cross-tenant decrementStock must update 0 rows")
                .isZero();

        // Owner's stock must be untouched
        Product unchanged = productRepository.findById(p.getId()).orElseThrow();
        assertThat(unchanged.getStockQty()).isEqualTo(10);
    }

    // ── Composite bill_no constraint ──────────────────────────────────────────

    /**
     * Two different tenants can store bills with the same bill number.
     * (e.g. both use GOS-20261116-0001 when they share the same 3-char prefix)
     */
    @Test
    void billNoConstraint_differentTenants_canShareSameBillNo() {
        Tenant t1 = createTenant("lambda-" + UUID.randomUUID());
        Tenant t2 = createTenant("mu-"     + UUID.randomUUID());

        String sharedBillNo = "TST-20261116-0001";

        assertThatCode(() -> {
            billRepository.save(bill(t1.getId(), sharedBillNo));
            billRepository.save(bill(t2.getId(), sharedBillNo));
        }).doesNotThrowAnyException();
    }

    /**
     * The same tenant cannot store two bills with the same bill number.
     * The composite constraint (bill_no, tenant_id) must reject this.
     */
    @Test
    void billNoConstraint_sameTenant_duplicateBillNoRejected() {
        Tenant t = createTenant("nu-" + UUID.randomUUID());

        String dupBillNo = "DUP-20261116-0001";

        billRepository.save(bill(t.getId(), dupBillNo));

        assertThatThrownBy(() ->
                billRepository.saveAndFlush(bill(t.getId(), dupBillNo)))
                .isInstanceOf(DataIntegrityViolationException.class);
    }

    // ── Seed tenant created by DataInitializer ─────────────────────────────────

    /**
     * DataInitializer runs on startup and creates the gosuas seed tenant.
     * Verify it was created and is accessible by subdomain.
     */
    @Test
    void dataInitializer_createsGosuasSeedTenant() {
        assertThat(tenantRepository.findBySubdomain("gosuas"))
                .isPresent()
                .hasValueSatisfying(t -> {
                    assertThat(t.getSubdomain()).isEqualTo("gosuas");
                    assertThat(t.getStatus()).isEqualTo("ACTIVE");
                });
    }
}
