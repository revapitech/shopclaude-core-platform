package com.gosuas.core.controller;

import com.gosuas.core.dto.ProductRequest;
import com.gosuas.core.entity.Product;
import com.gosuas.core.service.ProductService;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import java.util.List;
import java.util.UUID;

@RestController
@RequestMapping("/api/products")
@RequiredArgsConstructor
public class ProductController {
    private final ProductService productService;

    @PostMapping
    public Product create(@RequestBody ProductRequest request) {
        return productService.create(request);
    }

    @GetMapping
    public List<Product> list() {
        return productService.list();
    }

    @GetMapping("/barcode/{barcode}")
    public ResponseEntity<Product> findByBarcode(@PathVariable String barcode) {
        return productService.findByBarcodeOpt(barcode)
                .map(ResponseEntity::ok)
                .orElse(ResponseEntity.notFound().build());
    }

    @GetMapping("/sku/{sku}")
    public ResponseEntity<Product> findBySku(@PathVariable String sku) {
        return productService.findBySkuOpt(sku)
                .map(ResponseEntity::ok)
                .orElse(ResponseEntity.notFound().build());
    }

    @PutMapping("/{id}/stock/{qty}")
    public Product updateStock(@PathVariable UUID id, @PathVariable Integer qty) {
        return productService.updateStock(id, qty);
    }

    @PutMapping("/{id}")
    public Product update(@PathVariable UUID id, @RequestBody ProductRequest request) {
        return productService.update(id, request);
    }

    @DeleteMapping("/{id}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void delete(@PathVariable UUID id) {
        productService.delete(id);
    }
}
