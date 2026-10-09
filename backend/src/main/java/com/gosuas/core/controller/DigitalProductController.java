package com.gosuas.core.controller;

import com.gosuas.core.config.TenantContext;
import com.gosuas.core.entity.DigitalOrder;
import com.gosuas.core.entity.DigitalProduct;
import com.gosuas.core.entity.Tenant;
import com.gosuas.core.repository.DigitalOrderRepository;
import com.gosuas.core.repository.DigitalProductRepository;
import com.gosuas.core.repository.TenantRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;

import java.io.IOException;
import java.io.InputStream;
import java.math.BigDecimal;
import java.nio.file.*;
import java.util.List;
import java.util.Map;
import java.util.UUID;

@RestController
@RequestMapping("/api/digital-products")
@RequiredArgsConstructor
public class DigitalProductController {

    private final DigitalProductRepository digitalProductRepository;
    private final DigitalOrderRepository digitalOrderRepository;
    private final TenantRepository tenantRepository;

    @Value("${upload.dir}")
    private String uploadDir;

    @GetMapping("/settings")
    public ResponseEntity<Map<String, Object>> getSettings() {
        UUID tenantId = TenantContext.getTenantId();
        Map<String, Object> result = new java.util.HashMap<>();
        return tenantRepository.findById(tenantId).map(t -> {
            result.put("shopAddress", t.getShopAddress() != null ? t.getShopAddress() : "");
            return ResponseEntity.ok(result);
        }).orElseGet(() -> { result.put("shopAddress", ""); return ResponseEntity.ok(result); });
    }

    @PutMapping("/settings")
    public ResponseEntity<Map<String, Object>> saveSettings(@RequestBody Map<String, Object> body) {
        UUID tenantId = TenantContext.getTenantId();
        return tenantRepository.findById(tenantId).map(t -> {
            t.setShopAddress((String) body.getOrDefault("shopAddress", ""));
            tenantRepository.save(t);
            Map<String, Object> result = new java.util.HashMap<>();
            result.put("shopAddress", t.getShopAddress() != null ? t.getShopAddress() : "");
            return ResponseEntity.ok(result);
        }).orElse(ResponseEntity.notFound().build());
    }

    @GetMapping
    public List<DigitalProduct> list() {
        return digitalProductRepository.findByTenantId(TenantContext.getTenantId());
    }

    @GetMapping("/orders")
    public List<DigitalOrder> listOrders() {
        return digitalOrderRepository.findByTenantId(TenantContext.getTenantId());
    }

    @PostMapping("/upload")
    public ResponseEntity<DigitalProduct> upload(
            @RequestParam("file") MultipartFile file,
            @RequestParam("title") String title,
            @RequestParam(value = "description", required = false) String description,
            @RequestParam("price") BigDecimal price,
            @RequestParam(value = "password", required = false) String password,
            @RequestParam(value = "coverEmoji", required = false, defaultValue = "📄") String coverEmoji
    ) throws IOException {
        UUID tenantId = TenantContext.getTenantId();

        Path pdfsDir = Paths.get(uploadDir, "pdfs").toAbsolutePath().normalize();
        Files.createDirectories(pdfsDir);

        String filename = "dp_" + tenantId + "_" + UUID.randomUUID() + ".pdf";
        try (InputStream in = file.getInputStream()) {
            Files.copy(in, pdfsDir.resolve(filename), StandardCopyOption.REPLACE_EXISTING);
        }

        DigitalProduct dp = DigitalProduct.builder()
                .tenantId(tenantId)
                .title(title)
                .description(description)
                .price(price)
                .pdfPath("/uploads/pdfs/" + filename)
                .passwordProtected(password != null && !password.isBlank())
                .pdfPassword(password != null && !password.isBlank() ? password : null)
                .coverEmoji(coverEmoji)
                .build();

        return ResponseEntity.ok(digitalProductRepository.save(dp));
    }

    @PutMapping("/{id}")
    public ResponseEntity<DigitalProduct> update(@PathVariable UUID id, @RequestBody Map<String, Object> body) {
        return digitalProductRepository.findById(id)
                .filter(dp -> dp.getTenantId().equals(TenantContext.getTenantId()))
                .map(dp -> {
                    if (body.containsKey("title")) dp.setTitle((String) body.get("title"));
                    if (body.containsKey("description")) dp.setDescription((String) body.get("description"));
                    if (body.containsKey("price")) dp.setPrice(new BigDecimal(body.get("price").toString()));
                    if (body.containsKey("active")) dp.setActive((Boolean) body.get("active"));
                    if (body.containsKey("coverEmoji")) dp.setCoverEmoji((String) body.get("coverEmoji"));
                    return ResponseEntity.ok(digitalProductRepository.save(dp));
                }).orElse(ResponseEntity.notFound().build());
    }

    @DeleteMapping("/{id}")
    public ResponseEntity<Void> delete(@PathVariable UUID id) {
        return digitalProductRepository.findById(id)
                .filter(dp -> dp.getTenantId().equals(TenantContext.getTenantId()))
                .map(dp -> {
                    dp.setActive(false);
                    digitalProductRepository.save(dp);
                    return ResponseEntity.ok().<Void>build();
                }).orElse(ResponseEntity.notFound().build());
    }
}
