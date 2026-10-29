package com.gosuas.core.controller;

import com.gosuas.core.dto.OfferResponse;
import com.gosuas.core.entity.Tenant;
import com.gosuas.core.repository.TenantRepository;
import java.util.Optional;
import com.gosuas.core.service.OfferService;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.UUID;

@RestController
@RequestMapping("/api/public/offers")
@RequiredArgsConstructor
public class PublicOfferController {

    private final OfferService       offerService;
    private final TenantRepository   tenantRepository;

    /** Active, visible offers for the given subdomain — used on the storefront home page. */
    @GetMapping
    public ResponseEntity<List<OfferResponse>> listActive(@RequestParam String subdomain) {
        return tenantRepository.findBySubdomain(subdomain.toLowerCase())
                .map(t -> ResponseEntity.ok(offerService.listPublicOffers(t.getId())))
                .orElse(ResponseEntity.ok(List.of()));
    }

    /** Full offer detail (eligible products) for the combo selection page. */
    @GetMapping("/{id}")
    public ResponseEntity<OfferResponse> getDetail(@PathVariable UUID id,
                                                   @RequestParam String subdomain) {
        Tenant tenant = tenantRepository.findBySubdomain(subdomain.toLowerCase()).orElse(null);
        if (tenant == null) return ResponseEntity.notFound().build();
        try {
            return ResponseEntity.ok(offerService.getPublicOffer(id, tenant.getId()));
        } catch (IllegalArgumentException e) {
            return ResponseEntity.notFound().build();
        }
    }
}
