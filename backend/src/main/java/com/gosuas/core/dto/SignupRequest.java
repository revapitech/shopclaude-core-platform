package com.gosuas.core.dto;

public record SignupRequest(
    String shopName,
    String subdomain,
    String ownerName,
    String ownerEmail,
    String phoneNumber,
    String password,
    String plan,                   // STARTER, PRO
    String customDomain,           // null if using our subdomain
    String razorpayOrderId,        // for one-time payment
    String razorpayPaymentId,
    String razorpaySignature,
    String razorpaySubscriptionId  // for e-mandate subscription
) {}
