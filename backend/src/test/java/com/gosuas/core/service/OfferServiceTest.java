package com.gosuas.core.service;

import com.gosuas.core.config.TenantContext;
import com.gosuas.core.dto.OfferProductEntry;
import com.gosuas.core.dto.OfferRequest;
import com.gosuas.core.dto.OfferResponse;
import com.gosuas.core.entity.Offer;
import com.gosuas.core.entity.OfferProduct;
import com.gosuas.core.entity.Product;
import com.gosuas.core.repository.OfferProductRepository;
import com.gosuas.core.repository.OfferRepository;
import com.gosuas.core.repository.ProductRepository;
import org.junit.jupiter.api.*;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.*;
import org.mockito.junit.jupiter.MockitoExtension;
import org.mockito.junit.jupiter.MockitoSettings;
import org.mockito.quality.Strictness;

import java.math.BigDecimal;
import java.time.LocalDateTime;
import java.util.*;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

@ExtendWith(MockitoExtension.class)
@MockitoSettings(strictness = Strictness.LENIENT)
class OfferServiceTest {

    @Mock OfferRepository         offerRepository;
    @Mock OfferProductRepository  offerProductRepository;
    @Mock ProductRepository       productRepository;
    @InjectMocks OfferService     offerService;

    private final UUID tenantId = UUID.randomUUID();
    private final UUID offerId  = UUID.randomUUID();
    private final UUID productId = UUID.randomUUID();

    @BeforeEach
    void setUp() {
        TenantContext.setTenantId(tenantId);
    }

    @AfterEach
    void tearDown() {
        TenantContext.clear();
    }

    // ── create ─────────────────────────────────────────────────────────────────

    @Test
    void create_validRequest_savesOffer() {
        OfferRequest req = buildRequest("Summer Combo", "CUSTOMER_SELECT", 3,
                new BigDecimal("250.00"), null, null, true, true, false, null, List.of());

        Offer saved = Offer.builder().id(offerId).tenantId(tenantId)
                .name("Summer Combo").offerType("CUSTOMER_SELECT")
                .requiredQty(3).comboPrice(new BigDecimal("250.00"))
                .active(true).showOnHome(true).allowRepeat(false).build();
        saved.prePersist();

        when(offerRepository.save(any())).thenReturn(saved);
        when(offerProductRepository.findAllByOfferId(offerId)).thenReturn(List.of());

        OfferResponse resp = offerService.create(req);

        assertThat(resp.name()).isEqualTo("Summer Combo");
        assertThat(resp.comboPrice()).isEqualByComparingTo("250.00");
        verify(offerRepository).save(any());
    }

    @Test
    void create_negativePrice_throws() {
        OfferRequest req = buildRequest("Bad Offer", "CUSTOMER_SELECT", 3,
                new BigDecimal("-1.00"), null, null, true, false, false, null, List.of());
        assertThatThrownBy(() -> offerService.create(req))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("Combo price");
    }

    @Test
    void create_missingName_throws() {
        OfferRequest req = buildRequest("  ", "CUSTOMER_SELECT", 2,
                new BigDecimal("100.00"), null, null, true, false, false, null, List.of());
        assertThatThrownBy(() -> offerService.create(req))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("name");
    }

    @Test
    void create_invalidDateRange_throws() {
        LocalDateTime start = LocalDateTime.now().plusDays(5);
        LocalDateTime end   = LocalDateTime.now().plusDays(1);
        OfferRequest req = buildRequest("Wrong Dates", "CUSTOMER_SELECT", 2,
                new BigDecimal("99.00"), start, end, true, false, false, null, List.of());
        assertThatThrownBy(() -> offerService.create(req))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("End date");
    }

    @Test
    void create_customerSelectWithoutRequiredQty_throws() {
        OfferRequest req = buildRequest("No Qty", "CUSTOMER_SELECT", null,
                new BigDecimal("100.00"), null, null, true, false, false, null, List.of());
        assertThatThrownBy(() -> offerService.create(req))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("Required quantity");
    }

    @Test
    void create_fixedComboDoesNotRequireRequiredQty() {
        OfferRequest req = buildRequest("Fixed", "FIXED_COMBO", null,
                new BigDecimal("150.00"), null, null, true, false, false, null, List.of());

        Offer saved = Offer.builder().id(offerId).tenantId(tenantId)
                .name("Fixed").offerType("FIXED_COMBO")
                .comboPrice(new BigDecimal("150.00"))
                .active(true).showOnHome(false).allowRepeat(false).build();
        saved.prePersist();

        when(offerRepository.save(any())).thenReturn(saved);
        when(offerProductRepository.findAllByOfferId(offerId)).thenReturn(List.of());

        OfferResponse resp = offerService.create(req);
        assertThat(resp.offerType()).isEqualTo("FIXED_COMBO");
    }

    // ── listPublicOffers ────────────────────────────────────────────────────────

    @Test
    void listPublicOffers_returnsOnlyActiveVisible() {
        Offer active = Offer.builder().id(offerId).tenantId(tenantId)
                .name("Active Offer").offerType("CUSTOMER_SELECT").requiredQty(3)
                .comboPrice(new BigDecimal("200")).active(true).showOnHome(true)
                .allowRepeat(false).build();
        active.prePersist();

        when(offerRepository.findActivePublicOffers(eq(tenantId), any())).thenReturn(List.of(active));
        when(offerProductRepository.findAllByOfferId(offerId)).thenReturn(List.of());

        List<OfferResponse> result = offerService.listPublicOffers(tenantId);

        assertThat(result).hasSize(1);
        assertThat(result.get(0).name()).isEqualTo("Active Offer");
    }

    @Test
    void listPublicOffers_expiredOfferNotReturned() {
        // The repository query filters them out already — verify we call the right method
        when(offerRepository.findActivePublicOffers(eq(tenantId), any())).thenReturn(List.of());

        List<OfferResponse> result = offerService.listPublicOffers(tenantId);
        assertThat(result).isEmpty();
        verify(offerRepository, never()).findAllByTenantId(any());
    }

    // ── validateAndGetComboPrice ────────────────────────────────────────────────

    @Test
    void validateCombo_correctSelection_returnsPrice() {
        Offer offer = activeOffer("CUSTOMER_SELECT", 2, new BigDecimal("199.00"), false);
        Product p1 = product("B001"), p2 = product("B002");

        when(offerRepository.findById(offerId)).thenReturn(Optional.of(offer));
        when(offerProductRepository.findAllByOfferId(offerId)).thenReturn(List.of(
                offerProduct(p1.getId()), offerProduct(p2.getId())));
        when(productRepository.findByBarcodeAndTenantId("B001", tenantId)).thenReturn(Optional.of(p1));
        when(productRepository.findByBarcodeAndTenantId("B002", tenantId)).thenReturn(Optional.of(p2));

        BigDecimal price = offerService.validateAndGetComboPrice(offerId, tenantId, List.of("B001", "B002"));
        assertThat(price).isEqualByComparingTo("199.00");
    }

    @Test
    void validateCombo_wrongCount_throws() {
        Offer offer = activeOffer("CUSTOMER_SELECT", 3, new BigDecimal("199.00"), false);
        when(offerRepository.findById(offerId)).thenReturn(Optional.of(offer));
        when(offerProductRepository.findAllByOfferId(offerId)).thenReturn(List.of());

        assertThatThrownBy(() ->
                offerService.validateAndGetComboPrice(offerId, tenantId, List.of("B001", "B002")))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("exactly 3");
    }

    @Test
    void validateCombo_ineligibleProduct_throws() {
        Offer offer = activeOffer("CUSTOMER_SELECT", 1, new BigDecimal("100.00"), false);
        Product p1 = product("B001");
        UUID otherProductId = UUID.randomUUID();

        when(offerRepository.findById(offerId)).thenReturn(Optional.of(offer));
        when(offerProductRepository.findAllByOfferId(offerId))
                .thenReturn(List.of(offerProduct(otherProductId))); // p1 NOT eligible
        when(productRepository.findByBarcodeAndTenantId("B001", tenantId)).thenReturn(Optional.of(p1));

        assertThatThrownBy(() ->
                offerService.validateAndGetComboPrice(offerId, tenantId, List.of("B001")))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("not eligible");
    }

    @Test
    void validateCombo_repeatNotAllowed_throws() {
        Offer offer = activeOffer("CUSTOMER_SELECT", 2, new BigDecimal("100.00"), false);
        Product p1 = product("B001");

        when(offerRepository.findById(offerId)).thenReturn(Optional.of(offer));
        when(offerProductRepository.findAllByOfferId(offerId))
                .thenReturn(List.of(offerProduct(p1.getId())));
        when(productRepository.findByBarcodeAndTenantId("B001", tenantId)).thenReturn(Optional.of(p1));

        assertThatThrownBy(() ->
                offerService.validateAndGetComboPrice(offerId, tenantId, List.of("B001", "B001")))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("same product multiple times");
    }

    @Test
    void validateCombo_offerInactive_throws() {
        Offer offer = Offer.builder().id(offerId).tenantId(tenantId)
                .name("Inactive").offerType("CUSTOMER_SELECT").requiredQty(1)
                .comboPrice(new BigDecimal("99")).active(false)
                .showOnHome(false).allowRepeat(false).build();
        offer.prePersist();

        when(offerRepository.findById(offerId)).thenReturn(Optional.of(offer));

        assertThatThrownBy(() ->
                offerService.validateAndGetComboPrice(offerId, tenantId, List.of("B001")))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("no longer active");
    }

    @Test
    void validateCombo_wrongTenant_throws() {
        UUID otherTenant = UUID.randomUUID();
        Offer offer = Offer.builder().id(offerId).tenantId(otherTenant)
                .name("Other shop offer").offerType("CUSTOMER_SELECT").requiredQty(1)
                .comboPrice(new BigDecimal("50")).active(true)
                .showOnHome(false).allowRepeat(false).build();
        offer.prePersist();

        when(offerRepository.findById(offerId)).thenReturn(Optional.of(offer));

        assertThatThrownBy(() ->
                offerService.validateAndGetComboPrice(offerId, tenantId, List.of("B001")))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("does not belong");
    }

    // ── Helpers ─────────────────────────────────────────────────────────────────

    private OfferRequest buildRequest(String name, String type, Integer requiredQty,
                                      BigDecimal price, LocalDateTime start, LocalDateTime end,
                                      Boolean active, Boolean showOnHome, Boolean allowRepeat,
                                      String posterUrl, List<OfferProductEntry> products) {
        return new OfferRequest(name, null, type, requiredQty, price,
                start, end, active, showOnHome, allowRepeat, posterUrl, products);
    }

    private Offer activeOffer(String type, int requiredQty, BigDecimal price, boolean allowRepeat) {
        Offer o = Offer.builder().id(offerId).tenantId(tenantId)
                .name("Test Offer").offerType(type).requiredQty(requiredQty)
                .comboPrice(price).active(true).showOnHome(true).allowRepeat(allowRepeat)
                .startDateTime(LocalDateTime.now().minusHours(1))
                .endDateTime(LocalDateTime.now().plusDays(30))
                .build();
        o.prePersist();
        return o;
    }

    private Product product(String barcode) {
        Product p = new Product();
        p.setId(UUID.randomUUID());
        p.setName("Product-" + barcode);
        p.setBarcode(barcode);
        p.setSku("SKU-" + barcode);
        p.setSellingPrice(new BigDecimal("99.00"));
        p.setStockQty(10);
        p.setTrackStock(true);
        p.setTenantId(tenantId);
        return p;
    }

    private OfferProduct offerProduct(UUID productId) {
        return OfferProduct.builder()
                .id(UUID.randomUUID())
                .offerId(offerId)
                .productId(productId)
                .build();
    }
}
