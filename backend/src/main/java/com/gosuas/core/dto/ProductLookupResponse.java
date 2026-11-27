package com.gosuas.core.dto;

import com.gosuas.core.entity.Product;

import java.util.List;

/**
 * Result of resolving a scanned/typed code (barcode, variant SKU, or base SKU) to a product.
 * match = "EXACT" when a single product was resolved (product populated, variants null).
 * match = "AMBIGUOUS" when the code is a base SKU shared by multiple colour/size variants —
 * the caller must show these to the user and let them pick one (variants populated, product null).
 */
public record ProductLookupResponse(String match, Product product, List<Product> variants) {
    public static ProductLookupResponse exact(Product product) {
        return new ProductLookupResponse("EXACT", product, null);
    }

    public static ProductLookupResponse ambiguous(List<Product> variants) {
        return new ProductLookupResponse("AMBIGUOUS", null, variants);
    }
}
