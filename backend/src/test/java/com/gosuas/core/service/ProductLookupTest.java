package com.gosuas.core.service;

import com.gosuas.core.config.TenantContext;
import com.gosuas.core.dto.ProductLookupResponse;
import com.gosuas.core.entity.Product;
import com.gosuas.core.repository.ProductRepository;
import com.gosuas.core.repository.TenantRepository;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * Covers ProductService.lookup — the unified Offline Billing entry point that resolves a
 * scanned/typed code to either a single product (EXACT: barcode, variant SKU, or a base SKU
 * with exactly one variant) or a list of sibling variants to choose from (AMBIGUOUS: a base
 * SKU shared by more than one colour/size). Mirrors the Mockito-unit-test style already used
 * in ProductVariantStockTest.
 */
@ExtendWith(MockitoExtension.class)
class ProductLookupTest {

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

    private Product variant(String sku, String barcode, String color, int stock) {
        return Product.builder()
                .id(UUID.randomUUID()).tenantId(tenantId)
                .name("Hydrogen M5 Wireless Mouse").category("Mouse")
                .sku(sku).barcode(barcode).color(color).stockQty(stock)
                .sellingPrice(new java.math.BigDecimal("799.00"))
                .build();
    }

    @Test
    void lookup_byExactBarcode_resolvesDirectly() {
        Product black = variant("HYD-MOU-002-BLA", "4715994564006", "Black", 2);
        when(productRepository.findByBarcodeAndTenantId("4715994564006", tenantId)).thenReturn(Optional.of(black));

        Optional<ProductLookupResponse> result = productService.lookup("4715994564006");

        assertThat(result).isPresent();
        assertThat(result.get().match()).isEqualTo("EXACT");
        assertThat(result.get().product().getSku()).isEqualTo("HYD-MOU-002-BLA");
        assertThat(result.get().variants()).isNull();
    }

    @Test
    void lookup_byExactVariantSku_resolvesDirectly() {
        Product white = variant("HYD-MOU-002-WHI", "4717593746005", "White", 5);
        when(productRepository.findByBarcodeAndTenantId("HYD-MOU-002-WHI", tenantId)).thenReturn(Optional.empty());
        when(productRepository.findBySkuAndTenantId("HYD-MOU-002-WHI", tenantId)).thenReturn(Optional.of(white));

        Optional<ProductLookupResponse> result = productService.lookup("HYD-MOU-002-WHI");

        assertThat(result).isPresent();
        assertThat(result.get().match()).isEqualTo("EXACT");
        assertThat(result.get().product().getColor()).isEqualTo("White");
    }

    @Test
    void lookup_byBaseSkuWithMultipleVariants_returnsAmbiguousSortedByColour() {
        Product white = variant("HYD-MOU-002-WHI", "4717593746005", "White", 5);
        Product black = variant("HYD-MOU-002-BLA", "4715994564006", "Black", 2);
        when(productRepository.findByBarcodeAndTenantId("HYD-MOU-002", tenantId)).thenReturn(Optional.empty());
        when(productRepository.findBySkuAndTenantId("HYD-MOU-002", tenantId)).thenReturn(Optional.empty());
        // Intentionally returned out of order to verify the service sorts, not the mock.
        when(productRepository.findByTenantIdAndSkuStartingWith(tenantId, "HYD-MOU-002-"))
                .thenReturn(List.of(white, black));

        Optional<ProductLookupResponse> result = productService.lookup("HYD-MOU-002");

        assertThat(result).isPresent();
        assertThat(result.get().match()).isEqualTo("AMBIGUOUS");
        assertThat(result.get().product()).isNull();
        assertThat(result.get().variants()).extracting(Product::getColor).containsExactly("Black", "White");
    }

    @Test
    void lookup_whenExactSkuMatchHasSiblings_stillReturnsAmbiguous() {
        // Real-world pattern: the "no suffix" colour variant's own SKU IS the base SKU
        // ("UTC-HD-103" = Black), with siblings "UTC-HD-103-GRE"/"UTC-HD-103-SIL". Typing
        // "UTC-HD-103" must NOT silently resolve straight to Black just because it happens
        // to be an exact SKU match — the user still has 3 colours to choose from.
        Product black = variant("UTC-HD-103", "1000000000001", "Black", 7);
        Product green = variant("UTC-HD-103-GRE", "1000000000002", "Green", 8);
        Product silver = variant("UTC-HD-103-SIL", "1000000000003", "Silver", 0);
        when(productRepository.findByBarcodeAndTenantId("UTC-HD-103", tenantId)).thenReturn(Optional.empty());
        when(productRepository.findBySkuAndTenantId("UTC-HD-103", tenantId)).thenReturn(Optional.of(black));
        when(productRepository.findByTenantIdAndSkuStartingWith(tenantId, "UTC-HD-103-"))
                .thenReturn(List.of(green, silver));

        Optional<ProductLookupResponse> result = productService.lookup("UTC-HD-103");

        assertThat(result).isPresent();
        assertThat(result.get().match()).isEqualTo("AMBIGUOUS");
        assertThat(result.get().product()).isNull();
        assertThat(result.get().variants()).extracting(Product::getColor).containsExactly("Black", "Green", "Silver");
    }

    @Test
    void lookup_byBarcode_resolvesDirectlyEvenWhenProductHasSiblings() {
        // A scanned barcode is physically tied to one specific unit — it must always
        // resolve directly, never force a variant picker, even if colour siblings exist.
        Product black = variant("UTC-HD-103", "1000000000001", "Black", 7);
        when(productRepository.findByBarcodeAndTenantId("1000000000001", tenantId)).thenReturn(Optional.of(black));

        Optional<ProductLookupResponse> result = productService.lookup("1000000000001");

        assertThat(result).isPresent();
        assertThat(result.get().match()).isEqualTo("EXACT");
        assertThat(result.get().product().getColor()).isEqualTo("Black");
        verify(productRepository, never()).findBySkuAndTenantId(anyString(), eq(tenantId));
        verify(productRepository, never()).findByTenantIdAndSkuStartingWith(eq(tenantId), anyString());
    }

    @Test
    void lookup_byBaseSkuWithExactlyOneVariant_resolvesDirectly() {
        Product onlyColour = variant("SOLO-001-RED", "1112223334445", "Red", 9);
        when(productRepository.findByBarcodeAndTenantId("SOLO-001", tenantId)).thenReturn(Optional.empty());
        when(productRepository.findBySkuAndTenantId("SOLO-001", tenantId)).thenReturn(Optional.empty());
        when(productRepository.findByTenantIdAndSkuStartingWith(tenantId, "SOLO-001-"))
                .thenReturn(List.of(onlyColour));

        Optional<ProductLookupResponse> result = productService.lookup("SOLO-001");

        assertThat(result).isPresent();
        assertThat(result.get().match()).isEqualTo("EXACT");
        assertThat(result.get().product().getSku()).isEqualTo("SOLO-001-RED");
    }

    @Test
    void lookup_unknownCode_returnsEmpty() {
        when(productRepository.findByBarcodeAndTenantId("NOPE", tenantId)).thenReturn(Optional.empty());
        when(productRepository.findBySkuAndTenantId("NOPE", tenantId)).thenReturn(Optional.empty());
        when(productRepository.findByTenantIdAndSkuStartingWith(tenantId, "NOPE-")).thenReturn(List.of());

        assertThat(productService.lookup("NOPE")).isEmpty();
    }

    @Test
    void lookup_blankCode_returnsEmptyWithoutQueryingRepository() {
        assertThat(productService.lookup("   ")).isEmpty();
        assertThat(productService.lookup(null)).isEmpty();
        verify(productRepository, never()).findByBarcodeAndTenantId(anyString(), eq(tenantId));
        verify(productRepository, never()).findBySkuAndTenantId(anyString(), eq(tenantId));
    }

    @Test
    void lookup_trimsWhitespaceBeforeMatching() {
        Product black = variant("HYD-MOU-002-BLA", "4715994564006", "Black", 2);
        when(productRepository.findByBarcodeAndTenantId("HYD-MOU-002-BLA", tenantId)).thenReturn(Optional.empty());
        when(productRepository.findBySkuAndTenantId("HYD-MOU-002-BLA", tenantId)).thenReturn(Optional.of(black));

        Optional<ProductLookupResponse> result = productService.lookup("  HYD-MOU-002-BLA\t");

        assertThat(result).isPresent();
        assertThat(result.get().product().getSku()).isEqualTo("HYD-MOU-002-BLA");
    }

    @Test
    void lookup_usesTenantFromContext_notFromCaller() {
        // lookup() has no tenantId parameter at all — it can only ever query the
        // tenant bound to the current request's validated JWT via TenantContext.
        when(productRepository.findByBarcodeAndTenantId("X", tenantId)).thenReturn(Optional.empty());
        when(productRepository.findBySkuAndTenantId("X", tenantId)).thenReturn(Optional.empty());
        when(productRepository.findByTenantIdAndSkuStartingWith(tenantId, "X-")).thenReturn(List.of());

        productService.lookup("X");

        verify(productRepository).findByBarcodeAndTenantId("X", tenantId);
        verify(productRepository).findBySkuAndTenantId("X", tenantId);
        verify(productRepository).findByTenantIdAndSkuStartingWith(tenantId, "X-");
    }
}
