package com.gosuas.core.repository;

import com.gosuas.core.entity.OfferProduct;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.UUID;

public interface OfferProductRepository extends JpaRepository<OfferProduct, UUID> {

    List<OfferProduct> findAllByOfferId(UUID offerId);

    void deleteAllByOfferId(UUID offerId);
}
