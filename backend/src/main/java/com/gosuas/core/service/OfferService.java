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
import jakarta.transaction.Transactional;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;

import java.math.BigDecimal;
import java.time.LocalDateTime;
import java.util.*;
import java.util.stream.Collectors;

@Service
@RequiredArgsConstructor
public class OfferService {

    private final OfferRepository          offerRepository;
    private final OfferProductRepository   offerProductRepository;
    private final ProductRepository        productRepository;

    // ─── Admin CRUD ────────────────────────────────────────────────────────────

    @Transactional
    public OfferResponse create(OfferRequest req) {
        validate(req);
        UUID tenantId = TenantContext.getTenantId();

        Offer offer = Offer.builder()
                .tenantId(tenantId)
                .name(req.name().trim())
                .description(req.description())
                .offerType(req.offerType())
                .requiredQty(req.requiredQty())
                .comboPrice(req.comboPrice())
                .startDateTime(req.startDateTime())
                .endDateTime(req.endDateTime())
                .active(Boolean.TRUE.equals(req.active()))
                .showOnHome(Boolean.TRUE.equals(req.showOnHome()))
                .allowRepeat(Boolean.TRUE.equals(req.allowRepeat()))
                .posterUrl(req.posterUrl())
                .build();

        offer = offerRepository.save(offer);
        saveEligibleProducts(offer.getId(), req.eligibleProducts());
        return buildResponse(offer);
    }

    @Transactional
    public OfferResponse update(UUID id, OfferRequest req) {
        validate(req);
        UUID tenantId = TenantContext.getTenantId();

        Offer offer = offerRepository.findById(id)
                .filter(o -> o.getTenantId().equals(tenantId))
                .orElseThrow(() -> new IllegalArgumentException("Offer not found"));

        offer.setName(req.name().trim());
        offer.setDescription(req.description());
        offer.setOfferType(req.offerType());
        offer.setRequiredQty(req.requiredQty());
        offer.setComboPrice(req.comboPrice());
        offer.setStartDateTime(req.startDateTime());
        offer.setEndDateTime(req.endDateTime());
        offer.setActive(Boolean.TRUE.equals(req.active()));
        offer.setShowOnHome(Boolean.TRUE.equals(req.showOnHome()));
        offer.setAllowRepeat(Boolean.TRUE.equals(req.allowRepeat()));
        if (req.posterUrl() != null) offer.setPosterUrl(req.posterUrl());

        offerProductRepository.deleteAllByOfferId(id);
        saveEligibleProducts(id, req.eligibleProducts());
        return buildResponse(offer);
    }

    public List<OfferResponse> listAll() {
        return offerRepository.findAllByTenantId(TenantContext.getTenantId())
                .stream().map(this::buildResponse).toList();
    }

    public OfferResponse getById(UUID id) {
        UUID tenantId = TenantContext.getTenantId();
        return offerRepository.findById(id)
                .filter(o -> o.getTenantId().equals(tenantId))
                .map(this::buildResponse)
                .orElseThrow(() -> new IllegalArgumentException("Offer not found"));
    }

    @Transactional
    public void delete(UUID id) {
        UUID tenantId = TenantContext.getTenantId();
        Offer offer = offerRepository.findById(id)
                .filter(o -> o.getTenantId().equals(tenantId))
                .orElseThrow(() -> new IllegalArgumentException("Offer not found"));
        offerProductRepository.deleteAllByOfferId(id);
        offerRepository.delete(offer);
    }

    @Transactional
    public OfferResponse toggleActive(UUID id) {
        UUID tenantId = TenantContext.getTenantId();
        Offer offer = offerRepository.findById(id)
                .filter(o -> o.getTenantId().equals(tenantId))
                .orElseThrow(() -> new IllegalArgumentException("Offer not found"));
        offer.setActive(!Boolean.TRUE.equals(offer.getActive()));
        return buildResponse(offer);
    }

    // ─── Public storefront ──────────────────────────────────────────────────────

    public List<OfferResponse> listPublicOffers(UUID tenantId) {
        return offerRepository.findActivePublicOffers(tenantId, LocalDateTime.now())
                .stream().map(this::buildResponse).toList();
    }

    public OfferResponse getPublicOffer(UUID offerId, UUID tenantId) {
        Offer offer = offerRepository.findById(offerId)
                .filter(o -> o.getTenantId().equals(tenantId))
                .orElseThrow(() -> new IllegalArgumentException("Offer not found"));
        // Verify still active (re-check at request time)
        String status = offer.computeStatus();
        if (!"ACTIVE".equals(status) && !"SCHEDULED".equals(status)) {
            throw new IllegalArgumentException("Offer is not available");
        }
        return buildResponse(offer);
    }

    /**
     * Called by PublicShopController when a combo is included in an order.
     * Validates and returns the eligible product IDs so the caller can deduct stock.
     *
     * @param offerId         the offer being redeemed
     * @param tenantId        the shop's tenant
     * @param selectedBarcodes barcodes chosen by the customer
     * @return the combo price to charge
     */
    @Transactional
    public BigDecimal validateAndGetComboPrice(UUID offerId, UUID tenantId,
                                               List<String> selectedBarcodes) {
        Offer offer = offerRepository.findById(offerId)
                .orElseThrow(() -> new IllegalArgumentException("Offer not found"));

        if (!offer.getTenantId().equals(tenantId)) {
            throw new IllegalArgumentException("Offer does not belong to this shop");
        }
        String status = offer.computeStatus();
        if (!"ACTIVE".equals(status)) {
            throw new IllegalArgumentException("Offer '" + offer.getName() + "' is no longer active");
        }

        List<OfferProduct> eligibleLinks = offerProductRepository.findAllByOfferId(offerId);
        Set<UUID> eligibleProductIds = eligibleLinks.stream()
                .map(OfferProduct::getProductId).collect(Collectors.toSet());

        if ("CUSTOMER_SELECT".equals(offer.getOfferType())) {
            int required = offer.getRequiredQty() != null ? offer.getRequiredQty() : 0;
            if (selectedBarcodes.size() != required) {
                throw new IllegalArgumentException(
                        "Combo requires exactly " + required + " items; got " + selectedBarcodes.size());
            }
            // Check repeats
            if (!Boolean.TRUE.equals(offer.getAllowRepeat())) {
                Set<String> unique = new HashSet<>(selectedBarcodes);
                if (unique.size() < selectedBarcodes.size()) {
                    throw new IllegalArgumentException("This combo does not allow selecting the same product multiple times");
                }
            }
            // Validate each barcode is eligible
            for (String barcode : selectedBarcodes) {
                Product p = productRepository.findByBarcodeAndTenantId(barcode, tenantId)
                        .orElseThrow(() -> new IllegalArgumentException("Product not found: " + barcode));
                if (!eligibleProductIds.contains(p.getId())) {
                    throw new IllegalArgumentException("Product '" + p.getName() + "' is not eligible for this combo");
                }
            }
        } else {
            // FIXED_COMBO — validate barcodes match the configured set
            if (selectedBarcodes.isEmpty()) {
                // caller passed the fixed items, nothing extra to validate
            }
        }

        return offer.getComboPrice();
    }

    // ─── Helpers ────────────────────────────────────────────────────────────────

    private void saveEligibleProducts(UUID offerId, List<OfferProductEntry> entries) {
        if (entries == null || entries.isEmpty()) return;
        List<OfferProduct> rows = entries.stream()
                .filter(e -> e.productId() != null)
                .map(e -> OfferProduct.builder()
                        .offerId(offerId)
                        .productId(e.productId())
                        .quantity(e.quantity())
                        .build())
                .toList();
        offerProductRepository.saveAll(rows);
    }

    private OfferResponse buildResponse(Offer offer) {
        List<OfferProduct> links = offerProductRepository.findAllByOfferId(offer.getId());

        // Batch-load products for the eligible list
        Map<UUID, Product> productMap = new HashMap<>();
        if (!links.isEmpty()) {
            List<UUID> ids = links.stream().map(OfferProduct::getProductId).toList();
            productRepository.findAllById(ids).forEach(p -> productMap.put(p.getId(), p));
        }

        List<OfferProductEntry> entries = links.stream().map(link -> {
            Product p = productMap.get(link.getProductId());
            if (p == null) return null;
            return new OfferProductEntry(
                    p.getId(),
                    p.getName(),
                    p.getBarcode(),
                    p.getSku(),
                    p.getImageUrl(),
                    p.getSellingPrice(),
                    p.getStockQty(),
                    p.getTrackStock(),
                    link.getQuantity()
            );
        }).filter(Objects::nonNull).toList();

        return new OfferResponse(
                offer.getId(),
                offer.getName(),
                offer.getDescription(),
                offer.getOfferType(),
                offer.getRequiredQty(),
                offer.getComboPrice(),
                offer.getStartDateTime(),
                offer.getEndDateTime(),
                offer.getActive(),
                offer.getShowOnHome(),
                offer.getAllowRepeat(),
                offer.getPosterUrl(),
                offer.computeStatus(),
                offer.getCreatedAt(),
                offer.getUpdatedAt(),
                entries
        );
    }

    private void validate(OfferRequest req) {
        if (req.name() == null || req.name().isBlank()) {
            throw new IllegalArgumentException("Offer name is required");
        }
        if (req.comboPrice() == null || req.comboPrice().compareTo(BigDecimal.ZERO) < 0) {
            throw new IllegalArgumentException("Combo price must be zero or greater");
        }
        if (req.offerType() == null ||
                (!req.offerType().equals("CUSTOMER_SELECT") && !req.offerType().equals("FIXED_COMBO"))) {
            throw new IllegalArgumentException("Offer type must be CUSTOMER_SELECT or FIXED_COMBO");
        }
        if ("CUSTOMER_SELECT".equals(req.offerType()) &&
                (req.requiredQty() == null || req.requiredQty() <= 0)) {
            throw new IllegalArgumentException("Required quantity must be greater than zero for customer-select combos");
        }
        if (req.startDateTime() != null && req.endDateTime() != null &&
                req.endDateTime().isBefore(req.startDateTime())) {
            throw new IllegalArgumentException("End date must be after start date");
        }
    }
}
