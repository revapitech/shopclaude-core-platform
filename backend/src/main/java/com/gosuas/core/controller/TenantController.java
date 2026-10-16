package com.gosuas.core.controller;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.gosuas.core.config.TenantContext;
import com.gosuas.core.entity.Tenant;
import com.gosuas.core.repository.TenantRepository;
import com.razorpay.Utils;
import lombok.RequiredArgsConstructor;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;

import java.io.IOException;
import java.io.InputStream;
import java.nio.file.*;
import java.util.Collections;
import java.util.List;
import java.util.Map;
import java.util.Set;

@RestController
@RequestMapping("/api/tenant")
@RequiredArgsConstructor
public class TenantController {

    private final TenantRepository tenantRepository;
    private final ObjectMapper objectMapper;

    @Value("${upload.dir}")
    private String uploadDir;

    @Value("${razorpay.key.secret}")
    private String razorpayKeySecret;

    private static final Set<String> UPGRADABLE_PLANS = Set.of("STARTER", "PRO");

    @GetMapping("/info")
    public ResponseEntity<Tenant> getTenantInfo() {
        return tenantRepository.findById(TenantContext.getTenantId())
                .map(ResponseEntity::ok)
                .orElse(ResponseEntity.notFound().build());
    }

    @GetMapping("/categories")
    public ResponseEntity<List<Map<String, Object>>> getCategories() {
        return tenantRepository.findById(TenantContext.getTenantId()).map(tenant -> {
            String json = tenant.getCategoriesJson();
            if (json == null || json.isBlank()) return ResponseEntity.ok(Collections.<Map<String, Object>>emptyList());
            try {
                return ResponseEntity.ok(objectMapper.readValue(json, new TypeReference<List<Map<String, Object>>>() {}));
            } catch (Exception e) {
                return ResponseEntity.ok(Collections.<Map<String, Object>>emptyList());
            }
        }).orElse(ResponseEntity.notFound().build());
    }

    @PutMapping("/categories")
    public ResponseEntity<?> saveCategories(@RequestBody List<Map<String, Object>> categories) {
        return tenantRepository.findById(TenantContext.getTenantId()).map(tenant -> {
            try {
                tenant.setCategoriesJson(objectMapper.writeValueAsString(categories));
                tenantRepository.save(tenant);
                return ResponseEntity.ok(Map.of("saved", true));
            } catch (Exception e) {
                return ResponseEntity.badRequest().body(Map.of("error", "Invalid data"));
            }
        }).orElse(ResponseEntity.notFound().build());
    }

    @PostMapping("/logo")
    public ResponseEntity<Tenant> uploadLogo(@RequestParam("file") MultipartFile file) throws IOException {
        return tenantRepository.findById(TenantContext.getTenantId()).map(tenant -> {
            try {
                Path uploadPath = Paths.get(uploadDir).toAbsolutePath().normalize();
                Files.createDirectories(uploadPath);
                String ext = "";
                String original = file.getOriginalFilename();
                if (original != null && original.contains(".")) ext = original.substring(original.lastIndexOf('.'));
                String filename = "logo_" + tenant.getId() + ext;
                try (InputStream in = file.getInputStream()) {
                    Files.copy(in, uploadPath.resolve(filename), StandardCopyOption.REPLACE_EXISTING);
                }
                tenant.setLogoUrl("/uploads/" + filename);
                return ResponseEntity.ok(tenantRepository.save(tenant));
            } catch (IOException e) { throw new RuntimeException(e); }
        }).orElse(ResponseEntity.notFound().build());
    }

    @PostMapping("/banner")
    public ResponseEntity<Tenant> uploadBanner(@RequestParam("file") MultipartFile file) throws IOException {
        return tenantRepository.findById(TenantContext.getTenantId()).map(tenant -> {
            try {
                Path uploadPath = Paths.get(uploadDir).toAbsolutePath().normalize();
                Files.createDirectories(uploadPath);
                String ext = "";
                String original = file.getOriginalFilename();
                if (original != null && original.contains(".")) ext = original.substring(original.lastIndexOf('.'));
                String filename = "banner_" + tenant.getId() + ext;
                try (InputStream in = file.getInputStream()) {
                    Files.copy(in, uploadPath.resolve(filename), StandardCopyOption.REPLACE_EXISTING);
                }
                tenant.setBannerUrl("/uploads/" + filename);
                return ResponseEntity.ok(tenantRepository.save(tenant));
            } catch (IOException e) { throw new RuntimeException(e); }
        }).orElse(ResponseEntity.notFound().build());
    }

    @PutMapping("/info")
    public ResponseEntity<Tenant> updateTenantInfo(@RequestBody Map<String, String> body) {
        return tenantRepository.findById(TenantContext.getTenantId()).map(tenant -> {
            if (body.containsKey("name") && !body.get("name").isBlank())
                tenant.setName(body.get("name"));
            if (body.containsKey("phoneNumber"))
                tenant.setPhoneNumber(body.get("phoneNumber"));
            if (body.containsKey("shopAddress"))
                tenant.setShopAddress(body.get("shopAddress"));
            if (body.containsKey("bankAccountNumber"))
                tenant.setBankAccountNumber(body.get("bankAccountNumber"));
            if (body.containsKey("bankAccountHolderName"))
                tenant.setBankAccountHolderName(body.get("bankAccountHolderName"));
            if (body.containsKey("bankIfscCode"))
                tenant.setBankIfscCode(body.get("bankIfscCode"));
            if (body.containsKey("bankBranchName"))
                tenant.setBankBranchName(body.get("bankBranchName"));
            if (body.containsKey("razorpayMerchantKeyId"))
                tenant.setRazorpayMerchantKeyId(body.get("razorpayMerchantKeyId"));
            // Secret is write-only and never sent back to the client, so only overwrite it when
            // a new non-blank value is actually submitted — an empty field means "leave as-is".
            if (body.containsKey("razorpayMerchantKeySecret") && body.get("razorpayMerchantKeySecret") != null
                    && !body.get("razorpayMerchantKeySecret").isBlank())
                tenant.setRazorpayMerchantKeySecret(body.get("razorpayMerchantKeySecret"));
            if (body.containsKey("gstin"))
                tenant.setGstin(body.get("gstin"));
            if (body.containsKey("gstRegistered"))
                tenant.setGstRegistered("true".equalsIgnoreCase(body.get("gstRegistered")));
            if (body.containsKey("supplyType") && ("INTRA".equalsIgnoreCase(body.get("supplyType")) || "INTER".equalsIgnoreCase(body.get("supplyType"))))
                tenant.setSupplyType(body.get("supplyType").toUpperCase());
            return ResponseEntity.ok(tenantRepository.save(tenant));
        }).orElse(ResponseEntity.notFound().build());
    }

    /** POST /api/tenant/upgrade-plan  { plan: "STARTER"|"PRO", razorpayOrderId, razorpayPaymentId, razorpaySignature }
     *  Verifies the Razorpay payment signature and activates the new plan for the logged-in tenant. */
    @PostMapping("/upgrade-plan")
    public ResponseEntity<?> upgradePlan(@RequestBody Map<String, String> body) {
        String plan = body.get("plan") != null ? body.get("plan").toUpperCase() : null;
        if (!UPGRADABLE_PLANS.contains(plan)) {
            return ResponseEntity.badRequest().body(Map.of("error", "plan must be STARTER or PRO"));
        }
        String razorpayOrderId   = body.get("razorpayOrderId");
        String razorpayPaymentId = body.get("razorpayPaymentId");
        String razorpaySignature = body.get("razorpaySignature");
        if (razorpayOrderId == null || razorpayPaymentId == null || razorpaySignature == null) {
            return ResponseEntity.badRequest().body(Map.of("error", "Payment details are required"));
        }
        try {
            String payload  = razorpayOrderId + "|" + razorpayPaymentId;
            String expected = Utils.getHash(payload, razorpayKeySecret);
            if (!expected.equals(razorpaySignature)) {
                return ResponseEntity.status(HttpStatus.BAD_REQUEST).body(Map.of("error", "Payment verification failed"));
            }
        } catch (Exception e) {
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).body(Map.of("error", "Verification error: " + e.getMessage()));
        }

        Tenant tenant = tenantRepository.findById(TenantContext.getTenantId()).orElse(null);
        if (tenant == null) return ResponseEntity.notFound().build();

        if ("STARTER".equals(plan) && "PRO".equals(tenant.getPlan())) {
            return ResponseEntity.badRequest().body(Map.of("error", "You're already on the PRO plan."));
        }

        tenant.setPlan(plan);
        tenant.setStatus("ACTIVE");
        tenant.setRazorpayPaymentId(razorpayPaymentId);
        return ResponseEntity.ok(tenantRepository.save(tenant));
    }
}
