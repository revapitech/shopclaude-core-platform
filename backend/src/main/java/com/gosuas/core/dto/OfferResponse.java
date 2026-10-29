package com.gosuas.core.dto;

import java.math.BigDecimal;
import java.time.LocalDateTime;
import java.util.List;
import java.util.UUID;

public record OfferResponse(
        UUID id,
        String name,
        String description,
        String offerType,
        Integer requiredQty,
        BigDecimal comboPrice,
        LocalDateTime startDateTime,
        LocalDateTime endDateTime,
        Boolean active,
        Boolean showOnHome,
        Boolean allowRepeat,
        String posterUrl,
        String status,                          // computed: ACTIVE|INACTIVE|SCHEDULED|EXPIRED|DRAFT
        LocalDateTime createdAt,
        LocalDateTime updatedAt,
        List<OfferProductEntry> eligibleProducts
) {}
