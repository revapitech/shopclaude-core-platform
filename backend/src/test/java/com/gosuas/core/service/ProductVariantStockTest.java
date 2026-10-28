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
import org.mockito.ArgumentCaptor;
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
 * Tests that per-colour stock is stored correctly when the admin creates or
 * updates colour-variant products.  Each colour is its own Product row — the
 * frontend sends separate POST /products calls with the colour's own stockQty.
 * These tests verify that ProductService stores exactly what it receives.
 */
@ExtendWith(MockitoExtension.class)
class ProductVariantStockTest {

    @Mock private ProductRepository productRepository;
    @Mock private TenantRepository tenantRepository;
    @InjectMocks private ProductService productService;

    private final UUID tenantId = UUID.randomUUID();

    @BeforeEach
    void setTenant() {
        TenantContext.setTenantId(tenantId);
    }

    @AfterEach
    void clearTenant() {
        TenantContext.clear();
    }

    private ProductRequest request(String color, int stock) {
        return new ProductRequest(
            "Test Shirt", "Apparel", color, null,
            "TS-" + color.substring(0, 3).toUpperCase(), null,
            new BigDecimal("200"), new BigDecimal("499"), new BigDecimal("599"),
            stock, 5, null, null, false, false, null, true,
            "{\"Colour\":\"" + color + "\"}", false, "OTHER",
            null, null, null, null, null, null
        );
    }

    /** Saving stub: return the product unchanged (simulates a DB round-trip). */
    private void stubSave() {
        when(productRepository.save(any(Product.class)))
            .thenAnswer(inv -> inv.getArgument(0));
    }

    // ── Test 1: stock is stored per colour ───────────────────────────────────

    @Test
    void create_storesCorrectStockForEachColour() {
        when(tenantRepository.findById(tenantId)).thenReturn(Optional.of(new Tenant()));
        when(productRepository.findBySkuAndTenantId(anyString(), eq(tenantId))).thenReturn(Optional.empty());
        stubSave();

        // Admin sends three separate POST calls (one per colour) with different stocks
        Product red   = productService.create(request("Red",   10));
        Product blue  = productService.create(request("Blue",   5));
        Product black = productService.create(request("Black",  0));

        assertThat(red.getStockQty()).isEqualTo(10);
        assertThat(blue.getStockQty()).isEqualTo(5);
        assertThat(black.getStockQty()).isEqualTo(0);

        assertThat(red.getColor()).isEqualTo("Red");
        assertThat(blue.getColor()).isEqualTo("Blue");
        assertThat(black.getColor()).isEqualTo("Black");
    }

    // ── Test 2: updating one colour's stock does not touch other products ────

    @Test
    void updateStock_onlyAffectsTargetProduct() {
        UUID redId   = UUID.randomUUID();
        UUID blueId  = UUID.randomUUID();

        Product redProduct   = Product.builder().id(redId).tenantId(tenantId).color("Red").stockQty(10).build();
        Product blueProduct  = Product.builder().id(blueId).tenantId(tenantId).color("Blue").stockQty(5).build();

        when(productRepository.findById(redId)).thenReturn(Optional.of(redProduct));
        when(productRepository.save(any())).thenAnswer(inv -> inv.getArgument(0));

        // Admin sets Red's stock to 3; Blue is not touched
        Product updated = productService.updateStock(redId, 3);

        assertThat(updated.getStockQty()).isEqualTo(3);
        assertThat(blueProduct.getStockQty()).isEqualTo(5); // unchanged
        verify(productRepository, never()).findById(blueId);
    }

    // ── Test 3: update() applies the new stockQty from the request ──────────

    @Test
    void update_setsStockToRequestValue() {
        UUID productId = UUID.randomUUID();
        Product existing = Product.builder()
            .id(productId).tenantId(tenantId)
            .name("Test").color("Red").stockQty(10).sku("TS-RED").barcode("1234567890123")
            .build();

        when(productRepository.findById(productId)).thenReturn(Optional.of(existing));
        when(productRepository.save(any())).thenAnswer(inv -> inv.getArgument(0));
        // tenantRepository is only consulted when imageUrl increases — request() passes null imageUrl,
        // so no stub needed here.

        // Admin edits Red's stock from 10 → 7
        ProductRequest editRequest = request("Red", 7);
        Product result = productService.update(productId, editRequest);

        assertThat(result.getStockQty()).isEqualTo(7);
    }

    // ── Test 4: zero stock is valid and stored as-is ─────────────────────────

    @Test
    void create_withZeroStock_storesZero() {
        when(tenantRepository.findById(tenantId)).thenReturn(Optional.of(new Tenant()));
        when(productRepository.findBySkuAndTenantId(anyString(), eq(tenantId))).thenReturn(Optional.empty());
        stubSave();

        Product p = productService.create(request("Black", 0));

        assertThat(p.getStockQty()).isEqualTo(0);
    }

    // ── Test 5: negative stock in create request is rejected ─────────────────

    @Test
    void create_withNegativeStock_throwsIllegalArgument() {
        when(tenantRepository.findById(tenantId)).thenReturn(Optional.of(new Tenant()));
        when(productRepository.findBySkuAndTenantId(anyString(), eq(tenantId))).thenReturn(Optional.empty());

        ProductRequest bad = new ProductRequest(
            "Test Shirt", "Apparel", "Red", null, "TS-NEG", null,
            new BigDecimal("200"), new BigDecimal("499"), new BigDecimal("599"),
            -1, 5, null, null, false, false, null, true,
            "{\"Colour\":\"Red\"}", false, "OTHER", null, null, null, null, null, null
        );

        assertThatThrownBy(() -> productService.create(bad))
            .isInstanceOf(IllegalArgumentException.class)
            .hasMessageContaining("negative");
    }

    // ── Test 6: negative stock in update request is rejected ─────────────────

    @Test
    void update_withNegativeStock_throwsIllegalArgument() {
        UUID productId = UUID.randomUUID();

        ProductRequest bad = new ProductRequest(
            "Test Shirt", "Apparel", "Red", null, "TS-RED", null,
            new BigDecimal("200"), new BigDecimal("499"), new BigDecimal("599"),
            -5, 5, null, null, false, false, null, true,
            "{\"Colour\":\"Red\"}", false, "OTHER", null, null, null, null, null, null
        );

        assertThatThrownBy(() -> productService.update(productId, bad))
            .isInstanceOf(IllegalArgumentException.class)
            .hasMessageContaining("negative");
    }
}
