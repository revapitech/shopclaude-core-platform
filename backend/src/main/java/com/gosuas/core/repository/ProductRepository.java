package com.gosuas.core.repository;

import com.gosuas.core.entity.Product;
import org.springframework.data.jpa.repository.JpaRepository;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

public interface ProductRepository extends JpaRepository<Product, UUID> {
    Optional<Product> findByBarcode(String barcode);
    Optional<Product> findBySku(String sku);
    List<Product> findAllByTenantId(UUID tenantId);
    Optional<Product> findByBarcodeAndTenantId(String barcode, UUID tenantId);
    Optional<Product> findBySkuAndTenantId(String sku, UUID tenantId);
    long countByTenantId(UUID tenantId);
}
