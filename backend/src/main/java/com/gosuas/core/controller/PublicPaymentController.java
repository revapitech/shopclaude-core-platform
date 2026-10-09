package com.gosuas.core.controller;

import com.gosuas.core.entity.Tenant;
import com.gosuas.core.repository.TenantRepository;
import com.razorpay.Order;
import com.razorpay.RazorpayClient;
import com.razorpay.Utils;
import lombok.RequiredArgsConstructor;
import org.json.JSONObject;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.HashMap;
import java.util.Map;

// Storefront checkout — runs on the TENANT's own connected Razorpay account (not the platform's),
// so a shop's sales money settles directly to that shop's bank account. Contrast with
// RazorpayController, which uses the platform's own keys for subscription/plan payments.
@RestController
@RequestMapping("/api/public/payment")
@RequiredArgsConstructor
public class PublicPaymentController {

    private final TenantRepository tenantRepository;

    private Tenant requireConnectedTenant(String subdomain) {
        if (subdomain == null || subdomain.isBlank()) {
            throw new IllegalArgumentException("subdomain is required");
        }
        Tenant tenant = tenantRepository.findBySubdomain(subdomain.toLowerCase())
                .orElseThrow(() -> new IllegalArgumentException("Shop not found"));
        if (!tenant.isRazorpayMerchantConnected()) {
            throw new IllegalStateException("This shop hasn't set up payments yet. Please contact the shop owner.");
        }
        return tenant;
    }

    /** POST /api/public/payment/create-order  { subdomain, amount: rupees } */
    @PostMapping("/create-order")
    public ResponseEntity<Map<String, Object>> createOrder(@RequestBody Map<String, Object> body) {
        try {
            Tenant tenant = requireConnectedTenant((String) body.get("subdomain"));
            if (body.get("amount") == null) {
                return ResponseEntity.badRequest().body(Map.of("error", "amount is required"));
            }

            int amountPaise = (int) (((Number) body.get("amount")).doubleValue() * 100);
            if (amountPaise < 100) {
                return ResponseEntity.badRequest().body(Map.of("error", "Amount must be at least ₹1 (100 paise)"));
            }

            RazorpayClient client = new RazorpayClient(tenant.getRazorpayMerchantKeyId(), tenant.getRazorpayMerchantKeySecret());

            JSONObject options = new JSONObject();
            options.put("amount", amountPaise);
            options.put("currency", "INR");
            options.put("receipt", "rcpt_" + System.currentTimeMillis());
            options.put("payment_capture", 1);

            Order order = client.orders.create(options);

            Map<String, Object> res = new HashMap<>();
            res.put("razorpayOrderId", order.get("id").toString());
            res.put("amount", amountPaise);
            res.put("currency", "INR");
            res.put("keyId", tenant.getRazorpayMerchantKeyId());   // public key — safe to send to frontend
            return ResponseEntity.ok(res);
        } catch (IllegalArgumentException | IllegalStateException e) {
            return ResponseEntity.badRequest().body(Map.of("error", e.getMessage()));
        } catch (Exception e) {
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR)
                    .body(Map.of("error", "Failed to create payment order: " + e.getMessage()));
        }
    }

    /** POST /api/public/payment/verify  { subdomain, razorpayOrderId, razorpayPaymentId, razorpaySignature } */
    @PostMapping("/verify")
    public ResponseEntity<Map<String, String>> verify(@RequestBody Map<String, String> body) {
        try {
            Tenant tenant = requireConnectedTenant(body.get("subdomain"));
            if (!verifySignature(tenant, body.get("razorpayOrderId"), body.get("razorpayPaymentId"), body.get("razorpaySignature"))) {
                return ResponseEntity.status(HttpStatus.BAD_REQUEST)
                        .body(Map.of("error", "Payment signature verification failed"));
            }
            return ResponseEntity.ok(Map.of("status", "success"));
        } catch (IllegalArgumentException | IllegalStateException e) {
            return ResponseEntity.badRequest().body(Map.of("error", e.getMessage()));
        } catch (Exception e) {
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR)
                    .body(Map.of("error", "Verification error: " + e.getMessage()));
        }
    }

    public static boolean verifySignature(Tenant tenant, String orderId, String paymentId, String signature) throws Exception {
        if (orderId == null || paymentId == null || signature == null) return false;
        String payload = orderId + "|" + paymentId;
        String expected = Utils.getHash(payload, tenant.getRazorpayMerchantKeySecret());
        return expected.equals(signature);
    }
}
