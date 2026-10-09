package com.gosuas.core.controller;

import com.razorpay.Order;
import com.razorpay.Plan;
import com.razorpay.RazorpayClient;
import com.razorpay.Subscription;
import com.razorpay.Utils;
import org.json.JSONObject;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.HashMap;
import java.util.Map;

@RestController
@RequestMapping("/api/payment")
public class RazorpayController {

    @Value("${razorpay.key.id}")
    private String keyId;

    @Value("${razorpay.key.secret}")
    private String keySecret;

    /** POST /api/payment/create-order  { amount: rupees (e.g. 299.0) } */
    @PostMapping("/create-order")
    public ResponseEntity<Map<String, Object>> createOrder(@RequestBody Map<String, Object> body) {
        try {
            if (body.get("amount") == null) {
                return ResponseEntity.badRequest().body(Map.of("error", "amount is required"));
            }

            int amountPaise = (int) (((Number) body.get("amount")).doubleValue() * 100);

            // Razorpay minimum is 100 paise (₹1)
            if (amountPaise < 100) {
                return ResponseEntity.badRequest()
                        .body(Map.of("error", "Amount must be at least ₹1 (100 paise)"));
            }

            RazorpayClient client = new RazorpayClient(keyId, keySecret);

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
            res.put("keyId", keyId);   // PUBLIC key — safe to send to frontend
            return ResponseEntity.ok(res);

        } catch (Exception e) {
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR)
                    .body(Map.of("error", "Failed to create payment order: " + e.getMessage()));
        }
    }

    /** POST /api/payment/create-subscription  { plan: "STARTER"|"PRO" }
     *  Creates a Razorpay plan + subscription for monthly e-mandate. */
    @PostMapping("/create-subscription")
    public ResponseEntity<Map<String, Object>> createSubscription(@RequestBody Map<String, Object> body) {
        try {
            String planName = body.getOrDefault("plan", "STARTER").toString().toUpperCase();
            int amountPaise = "PRO".equals(planName) ? 249900 : 99900; // ₹2499 or ₹999
            String planLabel = "PRO".equals(planName) ? "Pro Plan" : "Starter Plan";

            RazorpayClient client = new RazorpayClient(keyId, keySecret);

            // Create Razorpay plan
            JSONObject itemObj = new JSONObject();
            itemObj.put("name", planLabel);
            itemObj.put("amount", amountPaise);
            itemObj.put("unit_amount", amountPaise);
            itemObj.put("currency", "INR");
            itemObj.put("description", planLabel + " - Monthly subscription");

            JSONObject planOpts = new JSONObject();
            planOpts.put("period", "monthly");
            planOpts.put("interval", 1);
            planOpts.put("item", itemObj);

            Plan rzpPlan = client.plans.create(planOpts);
            String planId = rzpPlan.get("id").toString();

            // Create subscription (12 billing cycles, customer can cancel anytime)
            JSONObject subOpts = new JSONObject();
            subOpts.put("plan_id", planId);
            subOpts.put("total_count", 12);
            subOpts.put("quantity", 1);
            subOpts.put("customer_notify", 1);

            Subscription sub = client.subscriptions.create(subOpts);

            Map<String, Object> res = new HashMap<>();
            res.put("subscriptionId", sub.get("id").toString());
            res.put("planId", planId);
            res.put("amount", amountPaise);
            res.put("keyId", keyId);
            return ResponseEntity.ok(res);

        } catch (Exception e) {
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR)
                    .body(Map.of("error", "Failed to create subscription: " + e.getMessage()));
        }
    }

    /** POST /api/payment/verify  { razorpayOrderId, razorpayPaymentId, razorpaySignature } */
    @PostMapping("/verify")
    public ResponseEntity<Map<String, String>> verify(@RequestBody Map<String, String> body) {
        String razorpayOrderId   = body.get("razorpayOrderId");
        String razorpayPaymentId = body.get("razorpayPaymentId");
        String razorpaySignature = body.get("razorpaySignature");

        // Validate all required fields
        if (razorpayOrderId == null || razorpayPaymentId == null || razorpaySignature == null) {
            return ResponseEntity.badRequest()
                    .body(Map.of("error", "razorpayOrderId, razorpayPaymentId and razorpaySignature are required"));
        }

        try {
            // HMAC-SHA256(order_id + "|" + payment_id, KEY_SECRET)
            String payload  = razorpayOrderId + "|" + razorpayPaymentId;
            String expected = Utils.getHash(payload, keySecret);

            if (expected.equals(razorpaySignature)) {
                return ResponseEntity.ok(Map.of("status", "success"));
            } else {
                // Signature mismatch — return 400, do NOT mark as paid
                return ResponseEntity.status(HttpStatus.BAD_REQUEST)
                        .body(Map.of("error", "Payment signature verification failed"));
            }
        } catch (Exception e) {
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR)
                    .body(Map.of("error", "Verification error: " + e.getMessage()));
        }
    }
}
