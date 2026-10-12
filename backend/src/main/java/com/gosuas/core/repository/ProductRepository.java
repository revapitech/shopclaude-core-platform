package com.gosuas.core.repository;

import com.gosuas.core.entity.Product;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
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

    /**
     * Atomically decrements stock and increments soldCount only when sufficient
     * stock exists. Returns the number of rows updated (1 = success, 0 = insufficient
     * stock). The WHERE stockQty >= qty guard prevents concurrent overselling even
     * under READ COMMITTED isolation — PostgreSQL row-level write locks ensure the
     * second concurrent UPDATE sees the committed value before proceeding.
     */
    @Modifying(clearAutomatically = true)
    @Query("UPDATE Product p SET p.stockQty = p.stockQty - :qty, p.soldCount = COALESCE(p.soldCount, 0) + :qty WHERE p.id = :id AND p.tenantId = :tenantId AND p.stockQty >= :qty")
    int decrementStock(@Param("id") UUID id, @Param("tenantId") UUID tenantId, @Param("qty") int qty);
}
