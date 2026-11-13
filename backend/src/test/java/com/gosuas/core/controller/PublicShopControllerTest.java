package com.gosuas.core.controller;

import com.gosuas.core.dto.PublicProductDTO;
import com.gosuas.core.entity.Product;
import com.gosuas.core.entity.Tenant;
import com.gosuas.core.repository.OfferProductRepository;
import com.gosuas.core.repository.OfferRepository;
import com.gosuas.core.repository.ProductRepository;
import com.gosuas.core.repository.ShopOrderRepository;
import com.gosuas.core.repository.TenantRepository;
import com.gosuas.core.service.OfferService;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.http.ResponseEntity;

import java.math.BigDecimal;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.Mockito.*;

/**
 * Unit tests for the public storefront APIs in PublicShopController.
 *
 * Covers:
 *   Shop Info API (/api/public/shop-info)
 *     1. Valid subdomain → 200 with shop name and subdomain fields.
 *     2. Unknown subdomain → 404.
 *     3. Subdomain lookup is case-insensitive.
 *
 *   Public Product Listing API (/api/public/products)
 *     4. Only active products are returned.
 *     5. Inactive products are excluded.
 *     6. Unknown subdomain returns empty list (200), not 404.
 *     7. Tenant isolation: products from one subdomain never appear for another.
 *     8. Empty shop returns empty list.
 *     9. Product DTO carries the correct fields (name, category, sellingPrice).
 *    10. purchasePrice is NOT exposed in the public DTO.
 */
@ExtendWith(MockitoExtension.class)
class PublicShopControllerTest {

    @Mock private ProductRepository      productRepository;
    @Mock private ShopOrderRepository    shopOrderRepository;
    @Mock private TenantRepository       tenantRepository;
    @Mock private OfferService           offerService;
    @Mock private OfferRepository        offerRepository;
    @Mock private OfferProductRepository offerProductRepository;

    @InjectMocks private PublicShopController controller;

    private final UUID   tenantId = UUID.randomUUID();
    private final Tenant tenant   = Tenant.builder()
            .id(tenantId)
            .name("Samson Electronics")
            .subdomain("samsonelectronics")
            .build();

    // ── Shop Info Tests ───────────────────────────────────────────────────────

    /** 1. Valid subdomain → 200 and shop info payload. */
    @Test
    void getShopInfo_validSubdomain_returns200WithShopData() {
        when(tenantRepository.findBySubdomain("samsonelectronics"))
                .thenReturn(Optional.of(tenant));

        @SuppressWarnings("unchecked")
        ResponseEntity<Map<String, Object>> resp =
                (ResponseEntity<Map<String, Object>>) controller.getShopInfo("samsonelectronics");

        assertThat(resp.getStatusCode().value()).isEqualTo(200);
        assertThat(resp.getBody()).containsEntry("name", "Samson Electronics");
        assertThat(resp.getBody()).containsEntry("subdomain", "samsonelectronics");
    }

    /** 2. Unknown subdomain → 404. */
    @Test
    void getShopInfo_unknownSubdomain_returns404() {
        when(tenantRepository.findBySubdomain("unknownshop"))
                .thenReturn(Optional.empty());

        ResponseEntity<?> resp = controller.getShopInfo("unknownshop");

        assertThat(resp.getStatusCode().value()).isEqualTo(404);
    }

    /** 3. Backend lowercases the subdomain before lookup. */
    @Test
    void getShopInfo_subdomainLookupIsCaseInsensitive() {
        when(tenantRepository.findBySubdomain("samsonelectronics"))
                .thenReturn(Optional.of(tenant));

        ResponseEntity<?> resp = controller.getShopInfo("SamsonElectronics");

        assertThat(resp.getStatusCode().value()).isEqualTo(200);
        verify(tenantRepository).findBySubdomain("samsonelectronics");
    }

    // ── Public Product Listing Tests ─────────────────────────────────────────

    /** 4. Only active products are returned to the storefront. */
    @Test
    void listPublicProducts_returnsOnlyActiveProducts() {
        Product active   = product("SonicWave Pro", true);
        Product inactive = product("Draft Cable",  false);

        when(tenantRepository.findBySubdomain("samsonelectronics"))
                .thenReturn(Optional.of(tenant));
        when(productRepository.findAllByTenantId(tenantId))
                .thenReturn(List.of(active, inactive));

        ResponseEntity<List<PublicProductDTO>> resp =
                controller.listPublicProducts("samsonelectronics");

        assertThat(resp.getStatusCode().value()).isEqualTo(200);
        assertThat(resp.getBody()).hasSize(1);
        assertThat(resp.getBody().get(0).getName()).isEqualTo("SonicWave Pro");
    }

    /** 5. Inactive products are completely excluded from the response. */
    @Test
    void listPublicProducts_excludesAllInactiveProducts() {
        when(tenantRepository.findBySubdomain("samsonelectronics"))
                .thenReturn(Optional.of(tenant));
        when(productRepository.findAllByTenantId(tenantId))
                .thenReturn(List.of(product("Draft A", false), product("Draft B", false)));

        ResponseEntity<List<PublicProductDTO>> resp =
                controller.listPublicProducts("samsonelectronics");

        assertThat(resp.getBody()).isEmpty();
    }

    /** 6. Unknown subdomain returns 200 with empty list — not a 404. */
    @Test
    void listPublicProducts_unknownSubdomain_returnsEmptyList() {
        when(tenantRepository.findBySubdomain("ghost")).thenReturn(Optional.empty());

        ResponseEntity<List<PublicProductDTO>> resp =
                controller.listPublicProducts("ghost");

        assertThat(resp.getStatusCode().value()).isEqualTo(200);
        assertThat(resp.getBody()).isEmpty();
    }

    /** 7. Tenant isolation: querying subdomain A never returns subdomain B's products. */
    @Test
    void listPublicProducts_tenantIsolation_otherTenantsProductsNotReturned() {
        UUID   otherTenantId = UUID.randomUUID();
        Tenant otherTenant   = Tenant.builder()
                .id(otherTenantId).name("Other Shop").subdomain("othershop").build();

        when(tenantRepository.findBySubdomain("samsonelectronics"))
                .thenReturn(Optional.of(tenant));
        // lenient: these stubs prove the other tenant's data is never fetched — must not be called
        lenient().when(tenantRepository.findBySubdomain("othershop"))
                .thenReturn(Optional.of(otherTenant));
        when(productRepository.findAllByTenantId(tenantId))
                .thenReturn(List.of(product("My Product", true)));
        lenient().when(productRepository.findAllByTenantId(otherTenantId))
                .thenReturn(List.of(product("Their Product", true)));

        ResponseEntity<List<PublicProductDTO>> resp =
                controller.listPublicProducts("samsonelectronics");

        assertThat(resp.getBody()).hasSize(1);
        assertThat(resp.getBody().get(0).getName()).isEqualTo("My Product");
        // Repository must never be called with the other tenant's ID
        verify(productRepository, never()).findAllByTenantId(otherTenantId);
    }

    /** 8. Shop with no active products returns an empty list. */
    @Test
    void listPublicProducts_emptyShop_returnsEmptyList() {
        when(tenantRepository.findBySubdomain("samsonelectronics"))
                .thenReturn(Optional.of(tenant));
        when(productRepository.findAllByTenantId(tenantId))
                .thenReturn(List.of());

        ResponseEntity<List<PublicProductDTO>> resp =
                controller.listPublicProducts("samsonelectronics");

        assertThat(resp.getStatusCode().value()).isEqualTo(200);
        assertThat(resp.getBody()).isEmpty();
    }

    /** 9. Product DTO carries the correct public fields. */
    @Test
    void listPublicProducts_dtoContainsCorrectPublicFields() {
        Product p = Product.builder()
                .id(UUID.randomUUID()).tenantId(tenantId)
                .name("SonicWave Pro").category("Electronics")
                .sellingPrice(new BigDecimal("8999"))
                .mrp(new BigDecimal("9999"))
                .stockQty(10).active(true)
                .build();

        when(tenantRepository.findBySubdomain("samsonelectronics"))
                .thenReturn(Optional.of(tenant));
        when(productRepository.findAllByTenantId(tenantId))
                .thenReturn(List.of(p));

        PublicProductDTO dto = controller.listPublicProducts("samsonelectronics")
                .getBody().get(0);

        assertThat(dto.getName()).isEqualTo("SonicWave Pro");
        assertThat(dto.getCategory()).isEqualTo("Electronics");
        assertThat(dto.getSellingPrice()).isEqualByComparingTo("8999");
        assertThat(dto.getMrp()).isEqualByComparingTo("9999");
        assertThat(dto.getStockQty()).isEqualTo(10);
    }

    /** 10. purchasePrice (cost price) is never exposed in the public DTO. */
    @Test
    void listPublicProducts_purchasePriceNotExposedInDTO() {
        // PublicProductDTO has no getPurchasePrice() — this is enforced at compile time.
        // This test confirms the DTO class does not carry cost-price information.
        Product p = Product.builder()
                .id(UUID.randomUUID()).tenantId(tenantId)
                .name("Product").active(true)
                .purchasePrice(new BigDecimal("3000"))
                .sellingPrice(new BigDecimal("8999")).build();

        when(tenantRepository.findBySubdomain("samsonelectronics"))
                .thenReturn(Optional.of(tenant));
        when(productRepository.findAllByTenantId(tenantId))
                .thenReturn(List.of(p));

        PublicProductDTO dto = controller.listPublicProducts("samsonelectronics")
                .getBody().get(0);

        // PublicProductDTO has no getPurchasePrice(); if this compiles the field is absent.
        // Verify the DTO class does not expose the field via reflection.
        boolean hasPurchasePrice = java.util.Arrays.stream(dto.getClass().getMethods())
                .anyMatch(m -> m.getName().equals("getPurchasePrice"));
        assertThat(hasPurchasePrice)
                .as("purchasePrice must not be exposed in the public storefront DTO")
                .isFalse();
    }

    // ── Helper ────────────────────────────────────────────────────────────────

    private Product product(String name, boolean active) {
        return Product.builder()
                .id(UUID.randomUUID()).tenantId(tenantId)
                .name(name).active(active)
                .sellingPrice(new BigDecimal("999"))
                .build();
    }
}
