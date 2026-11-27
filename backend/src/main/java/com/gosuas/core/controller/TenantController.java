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

import javax.imageio.ImageIO;
import java.awt.image.BufferedImage;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.util.Collections;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.regex.Pattern;

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

    // ── Logo / banner image validation ──────────────────────────────────────────
    private static final long MAX_IMAGE_BYTES = 10L * 1024 * 1024; // 10 MB
    private static final Set<String> RASTER_CONTENT_TYPES = Set.of("image/jpeg", "image/jpg", "image/png");
    private static final double ASPECT_TOLERANCE = 0.02; // 2%

    private static final double BANNER_ASPECT = 16.0 / 5.0;
    private static final int BANNER_MIN_W = 800;  // half of the recommended 1600 x 500
    private static final int BANNER_MIN_H = 250;
    private static final String BANNER_RATIO_MSG =
            "Please upload a banner with a 16:5 aspect ratio. Recommended size: 1600 × 500 px. You can crop your image to fit the required dimensions.";
    private static final String BANNER_LOWRES_MSG =
            "This image is too small and would look blurry as a banner. Please upload an image at least " + BANNER_MIN_W + " × " + BANNER_MIN_H + " px (recommended 1600 × 500 px).";

    private static final double LOGO_ASPECT = 1.0;
    private static final int LOGO_MIN_W = 256; // half of the recommended 512 x 512
    private static final int LOGO_MIN_H = 256;
    private static final String LOGO_RATIO_MSG =
            "Please upload a logo with a 1:1 (square) aspect ratio. Recommended size: 512 × 512 px. You can crop your image to fit the required dimensions.";
    private static final String LOGO_LOWRES_MSG =
            "This image is too small and would look blurry as a logo. Please upload an image at least " + LOGO_MIN_W + " × " + LOGO_MIN_H + " px (recommended 512 × 512 px).";

    private static final Pattern SVG_EVENT_ATTR = Pattern.compile("\\son\\w+\\s*=", Pattern.CASE_INSENSITIVE);

    /** Validates a JPG/PNG upload against a target aspect ratio and minimum resolution. Returns an error message, or null if valid. */
    private String validateRasterImage(MultipartFile file, double targetAspect, int minWidth, int minHeight,
                                        String formatMsg, String lowResMsg, String ratioMsg) throws IOException {
        if (file.isEmpty()) return "Please choose a file to upload.";
        if (file.getSize() > MAX_IMAGE_BYTES) return "File is too large. Maximum allowed size is 10 MB.";
        String contentType = file.getContentType() == null ? "" : file.getContentType().toLowerCase();
        if (!RASTER_CONTENT_TYPES.contains(contentType)) return formatMsg;
        BufferedImage img;
        try (InputStream in = file.getInputStream()) {
            img = ImageIO.read(in);
        }
        if (img == null) return "This file could not be read as an image. Please upload a valid JPG or PNG.";
        int w = img.getWidth(), h = img.getHeight();
        if (w < minWidth || h < minHeight) return lowResMsg;
        double ratio = (double) w / (double) h;
        if (Math.abs(ratio - targetAspect) / targetAspect > ASPECT_TOLERANCE) return ratioMsg;
        return null;
    }

    /** Validates a logo upload: JPG/PNG (square, min resolution) or a security-checked SVG. Returns an error message, or null if valid. */
    private String validateLogoFile(MultipartFile file) throws IOException {
        if (file.isEmpty()) return "Please choose a file to upload.";
        if (file.getSize() > MAX_IMAGE_BYTES) return "File is too large. Maximum allowed size is 10 MB.";
        String contentType = file.getContentType() == null ? "" : file.getContentType().toLowerCase();
        String original = file.getOriginalFilename() == null ? "" : file.getOriginalFilename().toLowerCase();
        boolean isSvg = contentType.contains("svg") || original.endsWith(".svg");

        if (isSvg) {
            String content = new String(file.getBytes(), StandardCharsets.UTF_8);
            String lower = content.toLowerCase();
            if (!lower.contains("<svg")) return "This SVG file could not be verified. Please upload a valid SVG, PNG or JPG.";
            if (lower.contains("<script") || lower.contains("javascript:") || lower.contains("<foreignobject")
                    || SVG_EVENT_ATTR.matcher(lower).find()) {
                return "This SVG contains unsupported content. Please upload a plain SVG, PNG or JPG.";
            }
            return null; // vector — no fixed pixel dimensions to validate
        }

        return validateRasterImage(file, LOGO_ASPECT, LOGO_MIN_W, LOGO_MIN_H,
                "Unsupported file format. Please upload a PNG, JPG, JPEG or SVG image.", LOGO_LOWRES_MSG, LOGO_RATIO_MSG);
    }

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
    public ResponseEntity<?> uploadLogo(@RequestParam("file") MultipartFile file) throws IOException {
        String validationError = validateLogoFile(file);
        if (validationError != null) {
            return ResponseEntity.badRequest().body(Map.of("error", validationError));
        }
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
                tenant.setLogoUrl("/uploads/" + filename + "?v=" + System.currentTimeMillis());
                return ResponseEntity.ok(tenantRepository.save(tenant));
            } catch (IOException e) { throw new RuntimeException(e); }
        }).orElse(ResponseEntity.notFound().build());
    }

    @PostMapping("/banner")
    public ResponseEntity<?> uploadBanner(@RequestParam("file") MultipartFile file) throws IOException {
        String validationError = validateRasterImage(file, BANNER_ASPECT, BANNER_MIN_W, BANNER_MIN_H,
                "Unsupported file format. Please upload a JPG, JPEG or PNG image.", BANNER_LOWRES_MSG, BANNER_RATIO_MSG);
        if (validationError != null) {
            return ResponseEntity.badRequest().body(Map.of("error", validationError));
        }
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
                tenant.setBannerUrl("/uploads/" + filename + "?v=" + System.currentTimeMillis());
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
            // Secrets are write-only: only overwrite when a new non-blank value is submitted.
            if (body.containsKey("razorpayMerchantKeySecret") && body.get("razorpayMerchantKeySecret") != null
                    && !body.get("razorpayMerchantKeySecret").isBlank())
                tenant.setRazorpayMerchantKeySecret(body.get("razorpayMerchantKeySecret"));
            // Test-mode Razorpay credentials (separate from live credentials above)
            if (body.containsKey("razorpayTestKeyId"))
                tenant.setRazorpayTestKeyId(body.get("razorpayTestKeyId"));
            if (body.containsKey("razorpayTestKeySecret") && body.get("razorpayTestKeySecret") != null
                    && !body.get("razorpayTestKeySecret").isBlank())
                tenant.setRazorpayTestKeySecret(body.get("razorpayTestKeySecret"));
            // Payment mode: "TEST" or "LIVE" only
            if (body.containsKey("razorpayMode")) {
                String mode = body.get("razorpayMode");
                if ("TEST".equalsIgnoreCase(mode) || "LIVE".equalsIgnoreCase(mode))
                    tenant.setRazorpayMode(mode.toUpperCase());
            }
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
