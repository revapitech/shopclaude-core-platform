package com.gosuas.core.dto;

import java.math.BigDecimal;
import java.time.LocalDateTime;
import java.util.List;
import java.util.UUID;

public record OfferRequest(
        String name,
        String description,
        String offerType,          // "CUSTOMER_SELECT" | "FIXED_COMBO"
        Integer requiredQty,
        BigDecimal comboPrice,
        LocalDateTime startDateTime,
        LocalDateTime endDateTime,
        Boolean active,
        Boolean showOnHome,
        Boolean allowRepeat,
        String posterUrl,
        List<OfferProductEntry> eligibleProducts   // productId + quantity required
) {}
