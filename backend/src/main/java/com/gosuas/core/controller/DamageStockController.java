package com.gosuas.core.controller;

import com.gosuas.core.dto.DamageStockRequest;
import com.gosuas.core.dto.DamageStockResponse;
import com.gosuas.core.service.DamageStockService;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/damage")
@RequiredArgsConstructor
public class DamageStockController {

    private final DamageStockService damageService;

    /** Record a new damage stock entry. Stock is immediately decremented. */
    @PostMapping
    public ResponseEntity<DamageStockResponse> recordDamage(@RequestBody DamageStockRequest request) {
        return ResponseEntity.ok(damageService.recordDamage(request));
    }

    /** List all damage entries for the current tenant, newest first. */
    @GetMapping
    public ResponseEntity<List<DamageStockResponse>> listDamages() {
        return ResponseEntity.ok(damageService.listDamages());
    }

    /** Look up a product by SKU or barcode before recording damage. */
    @GetMapping("/product-lookup")
    public ResponseEntity<Map<String, Object>> productLookup(@RequestParam String sku) {
        return ResponseEntity.ok(damageService.lookupProduct(sku));
    }
}
