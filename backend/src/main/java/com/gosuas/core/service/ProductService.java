package com.gosuas.core.service;

import com.gosuas.core.config.TenantContext;
import com.gosuas.core.dto.ProductRequest;
import com.gosuas.core.entity.Product;
import com.gosuas.core.entity.Tenant;
import com.gosuas.core.repository.ProductRepository;
import com.gosuas.core.repository.TenantRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import java.util.List;
import java.util.UUID;

@Service
@RequiredArgsConstructor
public class ProductService {
    private final ProductRepository productRepository;
    private final TenantRepository tenantRepository;

    private static int maxPhotosForPlan(String plan) {
        return "PRO".equals(plan) ? 6 : 2; // STARTER (₹999) → 2, PRO (₹1,699) → 6
    }

    // A colour variant gets its own single dedicated photo on top of the plan's general photo
    // quota — e.g. STARTER = up to 2 general photos + 1 for this colour, not instead of it.
    private static boolean hasColourVariant(String variantAttrsJson) {
        if (variantAttrsJson == null) return false;
        String lower = variantAttrsJson.toLowerCase();
        return lower.contains("\"colour\"") || lower.contains("\"color\"");
    }

    private static void validatePhotoLimit(String imageUrl, String plan, String variantAttrsJson) {
        int count = (imageUrl == null || imageUrl.isBlank()) ? 0 : imageUrl.split(",").length;
        int max = maxPhotosForPlan(plan) + (hasColourVariant(variantAttrsJson) ? 1 : 0);
        if (count > max) {
            throw new IllegalArgumentException(
                "Your plan allows up to " + maxPhotosForPlan(plan) + " product photos"
                + (hasColourVariant(variantAttrsJson) ? " plus 1 per colour variant" : "")
                + ". Upgrade to PRO for up to 6.");
        }
    }

    public Product create(ProductRequest request) {
        UUID tenantId = TenantContext.getTenantId();
        Tenant tenant = tenantRepository.findById(tenantId).orElse(null);

        // Enforce FREE plan product limit (50 products max)
        if (tenant != null && "FREE".equals(tenant.getPlan()) && productRepository.countByTenantId(tenantId) >= 50) {
            throw new IllegalArgumentException(
                "Free plan limit reached (50 products). Upgrade to Starter or Pro to add more.");
        }
        validatePhotoLimit(request.imageUrl(), tenant != null ? tenant.getPlan() : null, request.variantAttrs());

        if (productRepository.findBySkuAndTenantId(request.sku(), tenantId).isPresent()) {
            throw new IllegalArgumentException("SKU '" + request.sku() + "' already exists");
        }
        if (request.stockQty() != null && request.stockQty() < 0) {
            throw new IllegalArgumentException("Stock quantity cannot be negative");
        }
        String barcode = generateEan13();
        String productType = request.productType() != null ? request.productType() : "OTHER";
        boolean isRental = "RENTAL".equalsIgnoreCase(productType);
        Product product = Product.builder()
                .tenantId(tenantId)
                .name(request.name())
                .category(request.category())
                .color(request.color())
                .size(request.size())
                .sku(request.sku())
                .barcode(barcode)
                .purchasePrice(request.purchasePrice())
                .sellingPrice(request.sellingPrice())
                .mrp(request.mrp())
                .productType(productType)
                .depositAmount(request.depositAmount())
                .rentAmount(request.rentAmount())
                .stockQty(request.stockQty())
                .lowStockAlertQty(request.lowStockAlertQty())
                .imageUrl(request.imageUrl())
                .colorPhotoUrl(request.colorPhotoUrl())
                .description(request.description())
                .subcategory(request.subcategory())
                .variantAttrs(request.variantAttrs())
                .hsnCode(request.hsnCode())
                .gstRate(request.gstRate())
                .active(request.active() != null ? request.active() : Boolean.FALSE)
                .festiveOffer(request.festiveOffer() != null ? request.festiveOffer() : Boolean.FALSE)
                // Choosing "Rental" as the product type always makes it rental-eligible,
                // independent of the separate legacy rentalAvailable flag some tenants still use.
                .rentalAvailable(isRental ? Boolean.TRUE : (request.rentalAvailable() != null ? request.rentalAvailable() : Boolean.FALSE))
                .trackStock(request.trackStock() != null ? request.trackStock() : Boolean.TRUE)
                .build();
        return productRepository.save(product);
    }

    public List<Product> list() {
        return productRepository.findAllByTenantId(TenantContext.getTenantId());
    }

    public Product findByBarcode(String barcode) {
        return productRepository.findByBarcodeAndTenantId(barcode, TenantContext.getTenantId())
                .orElseThrow(() -> new RuntimeException("Product not found for barcode: " + barcode));
    }

    public java.util.Optional<Product> findByBarcodeOpt(String barcode) {
        return productRepository.findByBarcodeAndTenantId(barcode, TenantContext.getTenantId());
    }

    public java.util.Optional<Product> findBySkuOpt(String sku) {
        return productRepository.findBySkuAndTenantId(sku, TenantContext.getTenantId());
    }

    private String generateEan13() {
        String base = String.format("%012d", System.currentTimeMillis() % 1_000_000_000_000L);
        int sum = 0;
        for (int i = 0; i < 12; i++) {
            int d = base.charAt(i) - '0';
            sum += (i % 2 == 0) ? d : d * 3;
        }
        int check = (10 - (sum % 10)) % 10;
        return base + check;
    }

    public void delete(UUID productId) {
        UUID tenantId = TenantContext.getTenantId();
        Product product = productRepository.findById(productId)
                .filter(p -> tenantId.equals(p.getTenantId()))
                .orElseThrow(() -> new RuntimeException("Product not found"));
        productRepository.delete(product);
    }

    public Product updateStock(UUID productId, Integer qty) {
        UUID tenantId = TenantContext.getTenantId();
        Product product = productRepository.findById(productId)
                .filter(p -> tenantId.equals(p.getTenantId()))
                .orElseThrow(() -> new RuntimeException("Product not found"));
        product.setStockQty(qty);
        return productRepository.save(product);
    }

    public Product update(UUID productId, ProductRequest request) {
        UUID tenantId = TenantContext.getTenantId();
        if (request.stockQty() != null && request.stockQty() < 0) {
            throw new IllegalArgumentException("Stock quantity cannot be negative");
        }
        Product product = productRepository.findById(productId)
                .filter(p -> tenantId.equals(p.getTenantId()))
                .orElseThrow(() -> new RuntimeException("Product not found"));
        if (request.imageUrl() != null) {
            int newCount = request.imageUrl().isBlank() ? 0 : request.imageUrl().split(",").length;
            int oldCount = (product.getImageUrl() == null || product.getImageUrl().isBlank())
                    ? 0 : product.getImageUrl().split(",").length;
            // Only enforce the plan limit when adding photos, so downgraded tenants can still
            // edit other fields without being forced to delete photos they already had.
            if (newCount > oldCount) {
                Tenant tenant = tenantRepository.findById(tenantId).orElse(null);
                validatePhotoLimit(request.imageUrl(), tenant != null ? tenant.getPlan() : null, request.variantAttrs());
            }
        }
        product.setName(request.name());
        if (request.category() != null) product.setCategory(request.category());
        if (request.sku() != null) product.setSku(request.sku());
        if (request.barcode() != null && !request.barcode().isBlank() && !request.barcode().equals(product.getBarcode())) {
            productRepository.findByBarcode(request.barcode()).ifPresent(existing -> {
                if (!existing.getId().equals(productId)) {
                    throw new IllegalArgumentException("Barcode '" + request.barcode() + "' is already in use.");
                }
            });
            product.setBarcode(request.barcode());
        }
        product.setColor(request.color());
        product.setSize(request.size());
        product.setPurchasePrice(request.purchasePrice());
        product.setSellingPrice(request.sellingPrice());
        product.setMrp(request.mrp());
        product.setDepositAmount(request.depositAmount());
        product.setRentAmount(request.rentAmount());
        product.setStockQty(request.stockQty());
        product.setVariantAttrs(request.variantAttrs());
        if (request.imageUrl() != null) product.setImageUrl(request.imageUrl());
        product.setColorPhotoUrl(request.colorPhotoUrl());
        if (request.description() != null) product.setDescription(request.description());
        if (request.featured() != null) product.setFeatured(request.featured());
        if (request.festiveOffer() != null) product.setFestiveOffer(request.festiveOffer());
        if (request.subcategory() != null) product.setSubcategory(request.subcategory());
        if (request.active() != null) product.setActive(request.active());
        if (request.hsnCode() != null) product.setHsnCode(request.hsnCode());
        // Allow explicitly setting gstRate to null (to remove GST from a product)
        product.setGstRate(request.gstRate());
        if (request.productType() != null) product.setProductType(request.productType());
        boolean isRental = "RENTAL".equalsIgnoreCase(product.getProductType());
        if (isRental) product.setRentalAvailable(true);
        else if (request.rentalAvailable() != null) product.setRentalAvailable(request.rentalAvailable());
        if (request.trackStock() != null) product.setTrackStock(request.trackStock());
        return productRepository.save(product);
    }
}
