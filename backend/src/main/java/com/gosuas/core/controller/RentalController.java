package com.gosuas.core.controller;

import com.gosuas.core.config.TenantContext;
import com.gosuas.core.dto.RentalRequest;
import com.gosuas.core.dto.RentalResponse;
import com.gosuas.core.dto.RentalReturnRequest;
import com.gosuas.core.repository.TenantRepository;
import com.gosuas.core.service.RentalService;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.UUID;

// Bespoke feature for the Gosuas tenant only — not part of the general ShopClaude SaaS offering.
@RestController
@RequestMapping("/api/rentals")
@RequiredArgsConstructor
public class RentalController {
    private final RentalService rentalService;
    private final TenantRepository tenantRepository;

    private void requireGosuasTenant() {
        UUID tenantId = TenantContext.getTenantId();
        String subdomain = tenantRepository.findById(tenantId).map(t -> t.getSubdomain()).orElse("");
        if (!"gosuas".equalsIgnoreCase(subdomain)) {
            throw new RuntimeException("Rental feature is not available for this shop");
        }
    }

    @GetMapping
    public List<RentalResponse> list() {
        requireGosuasTenant();
        return rentalService.listRentals();
    }

    @PostMapping
    public RentalResponse create(@RequestBody RentalRequest request) {
        requireGosuasTenant();
        return rentalService.createRental(request);
    }

    @PutMapping("/{id}")
    public RentalResponse update(@PathVariable UUID id, @RequestBody RentalRequest request) {
        requireGosuasTenant();
        return rentalService.updateRental(id, request);
    }

    @PutMapping("/{id}/return")
    public RentalResponse markReturned(@PathVariable UUID id, @RequestBody(required = false) RentalReturnRequest request) {
        requireGosuasTenant();
        return rentalService.markReturned(id, request);
    }

    @DeleteMapping("/{id}")
    public void delete(@PathVariable UUID id) {
        requireGosuasTenant();
        rentalService.deleteRental(id);
    }
}
