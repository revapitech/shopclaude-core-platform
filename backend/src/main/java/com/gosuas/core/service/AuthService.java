package com.gosuas.core.service;

import com.gosuas.core.dto.LoginRequest;
import com.gosuas.core.dto.LoginResponse;
import com.gosuas.core.dto.SignupRequest;
import com.gosuas.core.entity.Tenant;
import com.gosuas.core.entity.User;
import com.gosuas.core.repository.TenantRepository;
import com.gosuas.core.repository.UserRepository;
import com.gosuas.core.util.JwtUtil;
import com.razorpay.Utils;
import jakarta.transaction.Transactional;
import lombok.RequiredArgsConstructor;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;

@Service
@RequiredArgsConstructor
public class AuthService {

    private final TenantRepository tenantRepository;
    private final UserRepository userRepository;
    private final PasswordEncoder passwordEncoder;
    private final JwtUtil jwtUtil;

    @Value("${razorpay.key.secret}")
    private String razorpayKeySecret;

    public LoginResponse login(LoginRequest request) {
        // Super-admin login (subdomain = "admin", no tenant)
        if ("admin".equalsIgnoreCase(request.subdomain())) {
            User admin = userRepository.findByEmailAndRole(request.email(), "SUPERADMIN")
                    .orElseThrow(() -> new IllegalArgumentException("Invalid credentials"));
            if (!passwordEncoder.matches(request.password(), admin.getPasswordHash())) {
                throw new IllegalArgumentException("Invalid credentials");
            }
            String token = jwtUtil.generate(admin.getId(), null, "SUPERADMIN", null);
            return new LoginResponse(token, admin.getName(), "SUPERADMIN", "ShopClaude Platform", "admin");
        }

        Tenant tenant = tenantRepository.findBySubdomain(request.subdomain())
                .orElseThrow(() -> new IllegalArgumentException("Shop not found"));

        User user = userRepository.findByEmailAndTenantId(request.email(), tenant.getId())
                .orElseThrow(() -> new IllegalArgumentException("Invalid email or password"));

        if (!passwordEncoder.matches(request.password(), user.getPasswordHash())) {
            throw new IllegalArgumentException("Invalid email or password");
        }


        String token = jwtUtil.generate(user.getId(), tenant.getId(), user.getRole(), tenant.getSubdomain());
        return new LoginResponse(token, user.getName(), user.getRole(), tenant.getName(), tenant.getSubdomain());
    }

    @Transactional
    public LoginResponse signup(SignupRequest request) {
        if (tenantRepository.existsBySubdomain(request.subdomain().toLowerCase())) {
            throw new IllegalArgumentException("Subdomain '" + request.subdomain() + "' is already taken");
        }

        String plan = (request.plan() != null && !request.plan().isBlank()) ? request.plan().toUpperCase() : "FREE";

        // Verify Razorpay payment for paid plans
        String paymentId = null;
        String subscriptionId = null;
        if ("STARTER".equals(plan) || "PRO".equals(plan)) {
            try {
                if (request.razorpaySubscriptionId() != null && !request.razorpaySubscriptionId().isBlank()) {
                    // E-mandate: verify subscription payment signature
                    String payload = request.razorpayPaymentId() + "|" + request.razorpaySubscriptionId();
                    String expected = Utils.getHash(payload, razorpayKeySecret);
                    if (!expected.equals(request.razorpaySignature())) {
                        throw new IllegalArgumentException("Payment verification failed");
                    }
                    paymentId = request.razorpayPaymentId();
                    subscriptionId = request.razorpaySubscriptionId();
                } else {
                    // One-time payment: verify order payment signature
                    String payload = request.razorpayOrderId() + "|" + request.razorpayPaymentId();
                    String expected = Utils.getHash(payload, razorpayKeySecret);
                    if (!expected.equals(request.razorpaySignature())) {
                        throw new IllegalArgumentException("Payment verification failed");
                    }
                    paymentId = request.razorpayPaymentId();
                }
            } catch (IllegalArgumentException e) {
                throw e;
            } catch (Exception e) {
                throw new IllegalArgumentException("Payment verification error: " + e.getMessage());
            }
        }

        Tenant tenant = Tenant.builder()
                .name(request.shopName())
                .subdomain(request.subdomain().toLowerCase())
                .ownerEmail(request.ownerEmail())
                .phoneNumber(request.phoneNumber())
                .plan(plan)
                .status("ACTIVE")
                .customDomain(request.customDomain())
                .razorpayPaymentId(paymentId)
                .razorpaySubscriptionId(subscriptionId)
                .build();
        tenantRepository.save(tenant);

        User user = User.builder()
                .tenantId(tenant.getId())
                .email(request.ownerEmail())
                .passwordHash(passwordEncoder.encode(request.password()))
                .role("OWNER")
                .name(request.ownerName())
                .build();
        userRepository.save(user);

        String token = jwtUtil.generate(user.getId(), tenant.getId(), user.getRole(), tenant.getSubdomain());
        return new LoginResponse(token, user.getName(), user.getRole(), tenant.getName(), tenant.getSubdomain());
    }
}
