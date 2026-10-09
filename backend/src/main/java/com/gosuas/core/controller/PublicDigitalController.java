package com.gosuas.core.controller;

import com.gosuas.core.entity.DigitalOrder;
import com.gosuas.core.entity.DigitalProduct;
import com.gosuas.core.entity.Tenant;
import com.gosuas.core.repository.DigitalOrderRepository;
import com.gosuas.core.repository.DigitalProductRepository;
import com.gosuas.core.repository.TenantRepository;
import com.gosuas.core.service.EmailService;
import lombok.RequiredArgsConstructor;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.math.BigDecimal;
import java.util.List;
import java.util.Map;
import java.util.UUID;

@RestController
@RequestMapping("/api/public/digital")
@RequiredArgsConstructor
public class PublicDigitalController {

    private final DigitalProductRepository digitalProductRepository;
    private final DigitalOrderRepository digitalOrderRepository;
    private final TenantRepository tenantRepository;
    private final EmailService emailService;

    @Value("${upload.dir}")
    private String uploadDir;

    @GetMapping("/products")
    public List<DigitalProduct> listProducts(@RequestParam String subdomain) {
        return tenantRepository.findBySubdomain(subdomain.toLowerCase())
                .map(t -> digitalProductRepository.findByTenantIdAndActiveTrue(t.getId()))
                .orElse(List.of());
    }

    @PostMapping("/orders")
    public ResponseEntity<DigitalOrder> createOrder(@RequestBody Map<String, Object> body) {
        String subdomain = (String) body.get("subdomain");
        UUID tenantId = tenantRepository.findBySubdomain(subdomain.toLowerCase())
                .map(t -> t.getId()).orElse(null);
        if (tenantId == null) return ResponseEntity.badRequest().build();

        UUID productId = UUID.fromString((String) body.get("productId"));
        DigitalProduct dp = digitalProductRepository.findById(productId).orElse(null);
        if (dp == null) return ResponseEntity.notFound().build();

        DigitalOrder order = DigitalOrder.builder()
                .tenantId(tenantId)
                .digitalProductId(productId)
                .customerEmail((String) body.get("customerEmail"))
                .customerName((String) body.getOrDefault("customerName", null))
                .amount(dp.getPrice())
                .paymentStatus("PENDING")
                .razorpayOrderId((String) body.getOrDefault("razorpayOrderId", null))
                .deliveryAddress((String) body.getOrDefault("deliveryAddress", null))
                .deliveryPhone((String) body.getOrDefault("deliveryPhone", null))
                .build();

        return ResponseEntity.ok(digitalOrderRepository.save(order));
    }

    @PostMapping("/orders/{id}/confirm")
    public ResponseEntity<?> confirmOrder(@PathVariable UUID id, @RequestBody Map<String, Object> body) {
        DigitalOrder pending = digitalOrderRepository.findById(id).orElse(null);
        if (pending == null) return ResponseEntity.notFound().build();

        Tenant tenant = pending.getTenantId() != null ? tenantRepository.findById(pending.getTenantId()).orElse(null) : null;
        String razorpayPaymentId = (String) body.getOrDefault("razorpayPaymentId", null);
        String razorpayOrderId   = (String) body.getOrDefault("razorpayOrderId", null);
        String razorpaySignature = (String) body.getOrDefault("razorpaySignature", null);
        if (tenant == null || !tenant.isRazorpayMerchantConnected()) {
            return ResponseEntity.badRequest().body(Map.of("error", "This shop hasn't set up payments yet."));
        }
        try {
            if (!PublicPaymentController.verifySignature(tenant, razorpayOrderId, razorpayPaymentId, razorpaySignature)) {
                return ResponseEntity.badRequest().body(Map.of("error", "Payment could not be verified."));
            }
        } catch (Exception e) {
            return ResponseEntity.badRequest().body(Map.of("error", "Payment could not be verified."));
        }

        pending.setPaymentStatus("PAID");
        pending.setRazorpayPaymentId(razorpayPaymentId);
        pending.setRazorpayOrderId(razorpayOrderId);
        DigitalOrder saved = digitalOrderRepository.save(pending);

        digitalProductRepository.findById(pending.getDigitalProductId()).ifPresent(dp ->
            emailService.sendDigitalProduct(saved, dp, uploadDir)
        );

        return ResponseEntity.ok(saved);
    }
}
