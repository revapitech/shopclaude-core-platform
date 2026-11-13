package com.gosuas.core.service;

import com.gosuas.core.config.TenantContext;
import com.gosuas.core.dto.ProductRequest;
import com.gosuas.core.entity.Product;
import com.gosuas.core.entity.Tenant;
import com.gosuas.core.repository.ProductRepository;
import com.gosuas.core.repository.TenantRepository;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.math.BigDecimal;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

/**
 * Verifies the product publishing lifecycle:
 *   1. Products created with showToWebsite=true (active=true) are visible on the storefront.
 *   2. Products created with showToWebsite=false (active=false) are hidden.
 *   3. The backend default for active is false when the flag is omitted.
 *   4. Products are always associated with the creating tenant.
 *   5. Updating active=true exposes a previously hidden product.
 *   6. Updating active=false removes a product from the storefront.
 *   7. Admin list() returns ALL products for the tenant regardless of active state.
 *   8. list() never returns products belonging to a different tenant.
 */
@ExtendWith(MockitoExtension.class)
class ProductPublishingTest {

    @Mock private ProductRepository productRepository;
    @Mock private TenantRepository  tenantRepository;
    @InjectMocks private ProductService productService;

    private final UUID   tenantId = UUID.randomUUID();
    private final Tenant tenant   = Tenant.builder()
            .id(tenantId).name("Samson Electronics").subdomain("samsonelectronics")
            .plan("STARTER").status("ACTIVE").build();

    @BeforeEach void setTenant()   { TenantContext.setTenantId(tenantId); }
    @AfterEach  void clearTenant() { TenantContext.clear(); }

    // ── Helpers ───────────────────────────────────────────────────────────────

    /** Builds a minimal valid ProductRequest with the given active flag. */
    private ProductRequest requestWithActive(Boolean active) {
        return new ProductRequest(
            "SonicWave Pro", "Electronics", null, null, "SW-PRO", null,
            new BigDecimal("5000"), new BigDecimal("8999"), new BigDecimal("9999"),
            10, 2, null, "Wireless headphones", false, false, null,
            active,          // position 16 — the active / showToWebsite flag
            null, false, "OTHER", null, null, null, null, null, null, null
        );
    }

    private void stubCreateDependencies() {
        when(tenantRepository.findById(tenantId)).thenReturn(Optional.of(tenant));
        when(productRepository.findBySkuAndTenantId(anyString(), eq(tenantId))).thenReturn(Optional.empty());
        when(productRepository.save(any(Product.class))).thenAnswer(inv -> inv.getArgument(0));
    }

    // ── 1. showToWebsite=true → active=true ──────────────────────────────────

    @Test
    void create_showOnWebsiteTrue_productIsActive() {
        stubCreateDependencies();
        Product p = productService.create(requestWithActive(true));
        assertThat(p.getActive()).isTrue();
    }

    // ── 2. showToWebsite=false → active=false ────────────────────────────────

    @Test
    void create_showOnWebsiteFalse_productIsInactive() {
        stubCreateDependencies();
        Product p = productService.create(requestWithActive(false));
        assertThat(p.getActive()).isFalse();
    }

    // ── 3. Backend default: null active → false ──────────────────────────────

    @Test
    void create_activeNull_defaultsToFalse() {
        stubCreateDependencies();
        Product p = productService.create(requestWithActive(null));
        // ProductService: active != null ? active : Boolean.FALSE
        assertThat(p.getActive()).isFalse();
    }

    // ── 4. Product is scoped to the creating tenant ──────────────────────────

    @Test
    void create_productCarriesTenantId() {
        stubCreateDependencies();
        Product p = productService.create(requestWithActive(true));
        assertThat(p.getTenantId()).isEqualTo(tenantId);
    }

    // ── 5. Update active=true exposes a previously hidden product ────────────

    @Test
    void update_setActiveTrue_makesProductVisibleOnStorefront() {
        UUID productId = UUID.randomUUID();
        Product existing = Product.builder()
                .id(productId).tenantId(tenantId)
                .name("Headphones").sku("SW-PRO").barcode("1234567890123")
                .active(false).stockQty(10).build();

        when(productRepository.findById(productId)).thenReturn(Optional.of(existing));
        when(productRepository.save(any())).thenAnswer(inv -> inv.getArgument(0));

        Product updated = productService.update(productId, requestWithActive(true));

        assertThat(updated.getActive()).isTrue();
    }

    // ── 6. Update active=false hides a previously visible product ────────────

    @Test
    void update_setActiveFalse_hidesProductFromStorefront() {
        UUID productId = UUID.randomUUID();
        Product existing = Product.builder()
                .id(productId).tenantId(tenantId)
                .name("Headphones").sku("SW-PRO").barcode("1234567890123")
                .active(true).stockQty(10).build();

        when(productRepository.findById(productId)).thenReturn(Optional.of(existing));
        when(productRepository.save(any())).thenAnswer(inv -> inv.getArgument(0));

        Product updated = productService.update(productId, requestWithActive(false));

        assertThat(updated.getActive()).isFalse();
    }

    // ── 7. Admin list() returns ALL products regardless of active ─────────────

    @Test
    void list_returnsAllTenantProducts_includingInactive() {
        Product active   = Product.builder().id(UUID.randomUUID()).tenantId(tenantId).name("Active").active(true).build();
        Product inactive = Product.builder().id(UUID.randomUUID()).tenantId(tenantId).name("Inactive").active(false).build();

        when(productRepository.findAllByTenantId(tenantId)).thenReturn(List.of(active, inactive));

        List<Product> result = productService.list();

        assertThat(result).hasSize(2).containsExactlyInAnyOrder(active, inactive);
    }

    // ── 8. list() is tenant-scoped — another tenant's products never returned ─

    @Test
    void list_neverReturnsOtherTenantsProducts() {
        UUID otherTenantId = UUID.randomUUID();
        Product mine  = Product.builder().id(UUID.randomUUID()).tenantId(tenantId).name("Mine").build();
        Product other = Product.builder().id(UUID.randomUUID()).tenantId(otherTenantId).name("Other").build();

        when(productRepository.findAllByTenantId(tenantId)).thenReturn(List.of(mine));
        // lenient: this stub proves the other tenant's data is never fetched — it must not be called
        lenient().when(productRepository.findAllByTenantId(otherTenantId)).thenReturn(List.of(other));

        List<Product> result = productService.list();

        assertThat(result).hasSize(1);
        assertThat(result.get(0).getName()).isEqualTo("Mine");
        verify(productRepository, never()).findAllByTenantId(otherTenantId);
    }
}
