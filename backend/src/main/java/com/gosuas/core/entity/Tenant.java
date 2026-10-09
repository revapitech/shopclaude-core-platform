package com.gosuas.core.entity;

import com.fasterxml.jackson.annotation.JsonIgnore;
import jakarta.persistence.*;
import lombok.*;
import java.time.LocalDateTime;
import java.util.UUID;

@Entity
@Table(name = "tenant")
@Getter @Setter @NoArgsConstructor @AllArgsConstructor @Builder
public class Tenant {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;

    @Column(nullable = false)
    private String name;

    @Column(unique = true, nullable = false)
    private String subdomain;

    @Column(nullable = false)
    private String ownerEmail;

    private String phoneNumber;

    @Column(nullable = false)
    private String plan;   // FREE, STARTER, PRO

    @Column(nullable = false)
    private String status; // ACTIVE, INACTIVE, TRIAL

    private LocalDateTime createdAt;

    private LocalDateTime planExpiresAt;

    @Column(name = "logo_url")
    private String logoUrl;

    @Column(name = "banner_url")
    private String bannerUrl;

    @Column(name = "categories_json", columnDefinition = "TEXT")
    private String categoriesJson;

    @Column(name = "custom_domain")
    private String customDomain;

    // These two record the tenant's OWN payment TO us for their subscription plan.
    @Column(name = "razorpay_payment_id")
    private String razorpayPaymentId;

    @Column(name = "razorpay_subscription_id")
    private String razorpaySubscriptionId;

    // The tenant's OWN connected Razorpay account, used for THEIR storefront checkout so their
    // customers' sales money settles directly to them — never routed through our platform account.
    @Column(name = "razorpay_merchant_key_id")
    private String razorpayMerchantKeyId;

    @JsonIgnore
    @Column(name = "razorpay_merchant_key_secret")
    private String razorpayMerchantKeySecret;

    // Computed, read-only flag so the admin UI can show connection status without ever
    // exposing the secret itself back over the API.
    public boolean isRazorpayMerchantConnected() {
        return razorpayMerchantKeyId != null && !razorpayMerchantKeyId.isBlank()
                && razorpayMerchantKeySecret != null && !razorpayMerchantKeySecret.isBlank();
    }

    @Column(name = "shop_address", columnDefinition = "TEXT")
    private String shopAddress;

    @Column(name = "bank_account_number")
    private String bankAccountNumber;

    @Column(name = "bank_account_holder_name")
    private String bankAccountHolderName;

    @Column(name = "bank_ifsc_code")
    private String bankIfscCode;

    @Column(name = "bank_branch_name")
    private String bankBranchName;

    @PrePersist
    public void prePersist() {
        this.createdAt = LocalDateTime.now();
        if (this.plan == null) this.plan = "FREE";
        if (this.status == null) this.status = "ACTIVE";
    }
}
