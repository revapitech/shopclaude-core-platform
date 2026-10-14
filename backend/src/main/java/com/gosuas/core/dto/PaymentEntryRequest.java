package com.gosuas.core.dto;

import java.math.BigDecimal;

public record PaymentEntryRequest(String method, BigDecimal amount) {}
