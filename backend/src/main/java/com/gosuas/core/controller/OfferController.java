package com.gosuas.core.controller;

import com.gosuas.core.dto.OfferRequest;
import com.gosuas.core.dto.OfferResponse;
import com.gosuas.core.service.OfferService;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.UUID;

@RestController
@RequestMapping("/api/offers")
@RequiredArgsConstructor
public class OfferController {

    private final OfferService offerService;

    @GetMapping
    public List<OfferResponse> list() {
        return offerService.listAll();
    }

    @GetMapping("/{id}")
    public OfferResponse get(@PathVariable UUID id) {
        return offerService.getById(id);
    }

    @PostMapping
    public OfferResponse create(@RequestBody OfferRequest req) {
        return offerService.create(req);
    }

    @PutMapping("/{id}")
    public OfferResponse update(@PathVariable UUID id, @RequestBody OfferRequest req) {
        return offerService.update(id, req);
    }

    @PatchMapping("/{id}/toggle-active")
    public OfferResponse toggleActive(@PathVariable UUID id) {
        return offerService.toggleActive(id);
    }

    @DeleteMapping("/{id}")
    public ResponseEntity<Void> delete(@PathVariable UUID id) {
        offerService.delete(id);
        return ResponseEntity.noContent().build();
    }
}
