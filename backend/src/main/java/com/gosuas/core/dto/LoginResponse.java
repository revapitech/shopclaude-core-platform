package com.gosuas.core.dto;

public record LoginResponse(
    String token,
    String userName,
    String role,
    String shopName,
    String subdomain
) {}
