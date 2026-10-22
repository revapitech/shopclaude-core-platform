package com.gosuas.core.service;

import com.gosuas.core.config.TenantContext;
import com.gosuas.core.dto.DamageStockRequest;
import com.gosuas.core.dto.DamageStockResponse;
import com.gosuas.core.entity.DamageStock;
import com.gosuas.core.entity.Product;
import com.gosuas.core.repository.DamageStockRepository;
import com.gosuas.core.repository.ProductRepository;
import jakarta.transaction.Transactional;
import lombok.RequiredArgsConstructor;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.stereotype.Service;

import java.time.LocalDate;
import java.time.format.DateTimeFormatter;
import java.util.*;

@Service
@RequiredArgsConstructor
public class DamageStockService {

    private final DamageStockRepository damageRepository;
    private final ProductRepository     productRepository;

    private static final Set<String> VALID_REASONS = Set.of(
            "DAMAGED_IN_TRANSIT", "EXPIRED", "MANUFACTURING_DEFECT",
            "WATER_DAMAGE", "BREAKAGE", "OTHER");

    // ── Record damage ─────────────────────────────────────────────────────────

    @Transactional
    public DamageStockResponse recordDamage(DamageStockRequest request) {
        UUID tenantId = TenantContext.getTenantId();

        if (request.sku() == null || request.sku().isBlank()) {
            throw new IllegalArgumentException("SKU or barcode is required");
        }
        if (request.damageQty() == null || request.damageQty() <= 0) {
            throw new IllegalArgumentException("Damage quantity must be greater than zero");
        }
        if (request.reason() != null && !VALID_REASONS.contains(request.reason().toUpperCase())) {
            throw new IllegalArgumentException(
                    "reason must be one of: " + String.join(", ", VALID_REASONS));
        }

        Product product = productRepository
                .findBySkuAndTenantId(request.sku().trim(), tenantId)
                .or(() -> productRepository.findByBarcodeAndTenantId(request.sku().trim(), tenantId))
                .orElseThrow(() -> new RuntimeException(
                        "Product not found for SKU/barcode: " + request.sku()));

        int stockBefore = product.getStockQty() != null ? product.getStockQty() : 0;

        int updated = productRepository.decrementStock(product.getId(), tenantId, request.damageQty());
        if (updated == 0) {
            throw new IllegalArgumentException(
                    "Insufficient stock for '" + product.getName() + "': available " + stockBefore
                    + ", requested damage qty " + request.damageQty());
        }

        int stockAfter = stockBefore - request.damageQty();

        String productName = product.getName()
                + (product.getColor() != null && !product.getColor().isBlank()
                   ? " (" + product.getColor() + ")" : "");

        DamageStock entry = DamageStock.builder()
                .tenantId(tenantId)
                .damageNo(generateDamageNo(tenantId))
                .productId(product.getId())
                .productName(productName)
                .sku(product.getSku())
                .barcode(product.getBarcode())
                .color(product.getColor())
                .damageQty(request.damageQty())
                .stockBefore(stockBefore)
                .stockAfter(stockAfter)
                .reason(request.reason() != null ? request.reason().toUpperCase() : "OTHER")
                .notes(request.notes())
                .createdBy(currentUserId())
                .build();

        return toResponse(damageRepository.save(entry));
    }

    // ── List ──────────────────────────────────────────────────────────────────

    @Transactional
    public List<DamageStockResponse> listDamages() {
        return damageRepository
                .findAllByTenantIdOrderByCreatedAtDesc(TenantContext.getTenantId())
                .stream().map(this::toResponse).toList();
    }

    // ── Product lookup (SKU or barcode) ───────────────────────────────────────

    @Transactional
    public Map<String, Object> lookupProduct(String sku) {
        UUID tenantId = TenantContext.getTenantId();
        Product p = productRepository.findBySkuAndTenantId(sku.trim(), tenantId)
                .or(() -> productRepository.findByBarcodeAndTenantId(sku.trim(), tenantId))
                .orElseThrow(() -> new RuntimeException("Product not found for SKU/barcode: " + sku));

        Map<String, Object> result = new LinkedHashMap<>();
        result.put("productId",    p.getId().toString());
        result.put("productName",  p.getName() + (p.getColor() != null && !p.getColor().isBlank()
                ? " (" + p.getColor() + ")" : ""));
        result.put("sku",          p.getSku());
        result.put("barcode",      p.getBarcode());
        result.put("color",        p.getColor());
        result.put("size",         p.getSize());
        result.put("stockQty",     p.getStockQty());
        result.put("imageUrl",     p.getImageUrl());
        return result;
    }

    // ── Internal helpers ──────────────────────────────────────────────────────

    private String generateDamageNo(UUID tenantId) {
        String prefix = "DMG-" + LocalDate.now().format(DateTimeFormatter.BASIC_ISO_DATE) + "-";
        int maxSeq = damageRepository.findAllByTenantIdAndDamageNoStartingWith(tenantId, prefix)
                .stream()
                .mapToInt(d -> {
                    try { return Integer.parseInt(d.getDamageNo().substring(prefix.length())); }
                    catch (Exception e) { return 0; }
                })
                .max().orElse(0);
        return prefix + String.format("%04d", maxSeq + 1);
    }

    private DamageStockResponse toResponse(DamageStock d) {
        return new DamageStockResponse(
                d.getId(), d.getDamageNo(), d.getProductId(), d.getProductName(),
                d.getSku(), d.getBarcode(), d.getColor(),
                d.getDamageQty(), d.getStockBefore(), d.getStockAfter(),
                d.getReason(), d.getNotes(), d.getCreatedBy(), d.getCreatedAt());
    }

    private UUID currentUserId() {
        Authentication auth = SecurityContextHolder.getContext().getAuthentication();
        if (auth == null || auth.getName() == null) return null;
        try { return UUID.fromString(auth.getName()); }
        catch (IllegalArgumentException e) { return null; }
    }
}
