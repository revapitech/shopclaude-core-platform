package com.gosuas.core.dto;

import java.math.BigDecimal;

public record PaymentEntryResponse(String method, BigDecimal amount) {}
