package com.gosuas.core.service;

import com.gosuas.core.config.TenantContext;
import com.gosuas.core.dto.DamageStockRequest;
import com.gosuas.core.dto.DamageStockResponse;
import com.gosuas.core.entity.DamageStock;
import com.gosuas.core.entity.Product;
import com.gosuas.core.repository.DamageStockRepository;
import com.gosuas.core.repository.ProductRepository;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

@ExtendWith(MockitoExtension.class)
class DamageStockServiceTest {

    @Mock private DamageStockRepository damageRepository;
    @Mock private ProductRepository     productRepository;
    @InjectMocks private DamageStockService service;

    private final UUID tenantId  = UUID.randomUUID();
    private final UUID productId = UUID.randomUUID();

    @BeforeEach void setTenant()   { TenantContext.setTenantId(tenantId); }
    @AfterEach  void clearTenant() { TenantContext.clear(); }

    // ── Helpers ───────────────────────────────────────────────────────────────

    private Product makeProduct(int stock) {
        return Product.builder()
                .id(productId).tenantId(tenantId)
                .name("Test Shirt").sku("TS-001").barcode("1234567890123")
                .stockQty(stock).build();
    }

    private void stubSave() {
        when(damageRepository.save(any(DamageStock.class)))
                .thenAnswer(inv -> inv.getArgument(0));
    }

    private void stubNoDamageNoConflict() {
        when(damageRepository.findAllByTenantIdAndDamageNoStartingWith(eq(tenantId), anyString()))
                .thenReturn(List.of());
    }

    // ── Test 1: records damage and decrements stock ───────────────────────────

    @Test
    void recordDamage_decrementsStockAndSavesEntry() {
        when(productRepository.findBySkuAndTenantId("TS-001", tenantId))
                .thenReturn(Optional.of(makeProduct(20)));
        when(productRepository.decrementStock(productId, tenantId, 3)).thenReturn(1);
        stubNoDamageNoConflict();
        stubSave();

        DamageStockResponse resp = service.recordDamage(
                new DamageStockRequest("TS-001", 3, "BREAKAGE", "Fell off shelf"));

        assertThat(resp.damageQty()).isEqualTo(3);
        assertThat(resp.stockBefore()).isEqualTo(20);
        assertThat(resp.stockAfter()).isEqualTo(17);
        assertThat(resp.reason()).isEqualTo("BREAKAGE");
        verify(productRepository).decrementStock(productId, tenantId, 3);
    }

    // ── Test 2: zero qty rejected ─────────────────────────────────────────────

    @Test
    void recordDamage_zeroQty_throwsIllegalArgument() {
        assertThatThrownBy(() -> service.recordDamage(
                new DamageStockRequest("TS-001", 0, "OTHER", null)))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("greater than zero");
    }

    // ── Test 3: negative qty rejected ────────────────────────────────────────

    @Test
    void recordDamage_negativeQty_throwsIllegalArgument() {
        assertThatThrownBy(() -> service.recordDamage(
                new DamageStockRequest("TS-001", -5, "OTHER", null)))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("greater than zero");
    }

    // ── Test 4: insufficient stock is rejected ────────────────────────────────

    @Test
    void recordDamage_insufficientStock_throwsIllegalArgument() {
        when(productRepository.findBySkuAndTenantId("TS-001", tenantId))
                .thenReturn(Optional.of(makeProduct(2)));
        when(productRepository.decrementStock(productId, tenantId, 5)).thenReturn(0);

        assertThatThrownBy(() -> service.recordDamage(
                new DamageStockRequest("TS-001", 5, "EXPIRED", null)))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("Insufficient stock");
    }

    // ── Test 5: unknown reason is rejected ───────────────────────────────────

    @Test
    void recordDamage_invalidReason_throwsIllegalArgument() {
        assertThatThrownBy(() -> service.recordDamage(
                new DamageStockRequest("TS-001", 1, "LOST", null)))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("reason must be one of");
    }

    // ── Test 6: null SKU rejected ─────────────────────────────────────────────

    @Test
    void recordDamage_nullSku_throwsIllegalArgument() {
        assertThatThrownBy(() -> service.recordDamage(
                new DamageStockRequest(null, 1, "OTHER", null)))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("SKU or barcode is required");
    }

    // ── Test 7: falls back to barcode lookup if SKU not found ─────────────────

    @Test
    void recordDamage_skuNotFound_fallsBackToBarcode() {
        when(productRepository.findBySkuAndTenantId("1234567890123", tenantId))
                .thenReturn(Optional.empty());
        when(productRepository.findByBarcodeAndTenantId("1234567890123", tenantId))
                .thenReturn(Optional.of(makeProduct(10)));
        when(productRepository.decrementStock(productId, tenantId, 1)).thenReturn(1);
        stubNoDamageNoConflict();
        stubSave();

        DamageStockResponse resp = service.recordDamage(
                new DamageStockRequest("1234567890123", 1, "OTHER", null));

        assertThat(resp.barcode()).isEqualTo("1234567890123");
    }

    // ── Test 8: product not found throws RuntimeException ────────────────────

    @Test
    void recordDamage_productNotFound_throwsRuntimeException() {
        when(productRepository.findBySkuAndTenantId("GHOST-SKU", tenantId))
                .thenReturn(Optional.empty());
        when(productRepository.findByBarcodeAndTenantId("GHOST-SKU", tenantId))
                .thenReturn(Optional.empty());

        assertThatThrownBy(() -> service.recordDamage(
                new DamageStockRequest("GHOST-SKU", 1, "OTHER", null)))
                .isInstanceOf(RuntimeException.class)
                .hasMessageContaining("Product not found");
    }

    // ── Test 9: damage number is sequential within the same day ──────────────

    @Test
    void recordDamage_generatesSequentialDamageNo() {
        Product product = makeProduct(50);
        when(productRepository.findBySkuAndTenantId(anyString(), eq(tenantId)))
                .thenReturn(Optional.of(product));
        when(productRepository.decrementStock(any(), eq(tenantId), anyInt())).thenReturn(1);

        // First entry: no existing entries this day
        when(damageRepository.findAllByTenantIdAndDamageNoStartingWith(eq(tenantId), anyString()))
                .thenReturn(List.of())
                .thenReturn(List.of(DamageStock.builder().damageNo("DMG-"
                        + java.time.LocalDate.now().format(java.time.format.DateTimeFormatter.BASIC_ISO_DATE)
                        + "-0001").build()));
        when(damageRepository.save(any())).thenAnswer(inv -> inv.getArgument(0));

        DamageStockResponse first  = service.recordDamage(new DamageStockRequest("TS-001", 1, "OTHER", null));
        DamageStockResponse second = service.recordDamage(new DamageStockRequest("TS-001", 1, "OTHER", null));

        assertThat(first.damageNo()).endsWith("-0001");
        assertThat(second.damageNo()).endsWith("-0002");
    }

    // ── Test 10: listDamages returns tenant-scoped results ───────────────────

    @Test
    void listDamages_returnsTenantScopedList() {
        DamageStock d1 = DamageStock.builder().id(UUID.randomUUID()).tenantId(tenantId)
                .damageNo("DMG-20241022-0001").productName("Shirt").sku("TS-001")
                .damageQty(2).stockBefore(10).stockAfter(8).reason("BREAKAGE").build();
        DamageStock d2 = DamageStock.builder().id(UUID.randomUUID()).tenantId(tenantId)
                .damageNo("DMG-20241022-0002").productName("Pants").sku("TP-001")
                .damageQty(1).stockBefore(5).stockAfter(4).reason("EXPIRED").build();

        when(damageRepository.findAllByTenantIdOrderByCreatedAtDesc(tenantId))
                .thenReturn(List.of(d1, d2));

        List<DamageStockResponse> results = service.listDamages();

        assertThat(results).hasSize(2);
        assertThat(results.get(0).damageNo()).isEqualTo("DMG-20241022-0001");
        assertThat(results.get(1).damageNo()).isEqualTo("DMG-20241022-0002");
    }

    // ── Test 11: lookupProduct returns product info ───────────────────────────

    @Test
    void lookupProduct_foundBySku_returnsProductMap() {
        when(productRepository.findBySkuAndTenantId("TS-001", tenantId))
                .thenReturn(Optional.of(makeProduct(15)));

        var result = service.lookupProduct("TS-001");

        assertThat(result.get("sku")).isEqualTo("TS-001");
        assertThat(result.get("stockQty")).isEqualTo(15);
    }

    // ── Test 12: lookupProduct not found throws RuntimeException ─────────────

    @Test
    void lookupProduct_notFound_throwsRuntimeException() {
        when(productRepository.findBySkuAndTenantId("GHOST", tenantId)).thenReturn(Optional.empty());
        when(productRepository.findByBarcodeAndTenantId("GHOST", tenantId)).thenReturn(Optional.empty());

        assertThatThrownBy(() -> service.lookupProduct("GHOST"))
                .isInstanceOf(RuntimeException.class)
                .hasMessageContaining("Product not found");
    }
}
