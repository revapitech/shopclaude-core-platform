package com.gosuas.core.controller;

import com.gosuas.core.dto.SalesReturnRequest;
import com.gosuas.core.dto.SalesReturnResponse;
import com.gosuas.core.service.SalesReturnService;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;
import java.util.UUID;

@RestController
@RequestMapping("/api/returns")
@RequiredArgsConstructor
public class SalesReturnController {

    private final SalesReturnService returnService;

    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    public SalesReturnResponse createReturn(@RequestBody SalesReturnRequest request) {
        return returnService.createReturn(request);
    }

    @GetMapping
    public List<SalesReturnResponse> listReturns() {
        return returnService.listReturns();
    }

    @GetMapping("/{id}")
    public SalesReturnResponse getReturn(@PathVariable UUID id) {
        return returnService.getReturn(id);
    }

    @PutMapping("/{id}/status")
    public SalesReturnResponse updateStatus(
            @PathVariable UUID id,
            @RequestBody Map<String, String> body) {
        String status = body.get("status");
        if (status == null || status.isBlank()) {
            throw new IllegalArgumentException("status is required");
        }
        return returnService.updateStatus(id, status.trim().toUpperCase());
    }

    /**
     * Preview endpoint — load original sale items + already-returned quantities.
     * Used by the frontend create-return form.
     *
     * GET /api/returns/preview?sourceType=POS&ref=GOS-20241013-0001
     */
    @GetMapping("/preview")
    public ResponseEntity<Map<String, Object>> getPreview(
            @RequestParam String sourceType,
            @RequestParam String ref) {
        return ResponseEntity.ok(returnService.getPreview(sourceType, ref));
    }

    /**
     * Look up a product by SKU or barcode for direct (walk-in) returns.
     *
     * GET /api/returns/product-lookup?sku=SKU-001  or  ?sku=BARCODE
     */
    @GetMapping("/product-lookup")
    public ResponseEntity<Map<String, Object>> productLookup(@RequestParam String sku) {
        return ResponseEntity.ok(returnService.lookupProductForReturn(sku));
    }
}