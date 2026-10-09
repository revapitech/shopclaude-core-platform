package com.gosuas.core.controller;

import com.gosuas.core.entity.Tenant;
import com.gosuas.core.repository.BillRepository;
import com.gosuas.core.repository.ProductRepository;
import com.gosuas.core.repository.TenantRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.time.LocalDateTime;
import java.util.*;
import java.util.stream.Collectors;

@RestController
@RequestMapping("/api/superadmin")
@RequiredArgsConstructor
public class SuperAdminController {

    private final TenantRepository tenantRepository;
    private final ProductRepository productRepository;
    private final BillRepository billRepository;

    @GetMapping("/stats")
    public Map<String, Object> getPlatformStats() {
        List<Tenant> all = tenantRepository.findAll();
        Map<String, Object> stats = new LinkedHashMap<>();
        stats.put("totalTenants", all.size());
        stats.put("activeTenants", all.stream().filter(t -> "ACTIVE".equals(t.getStatus())).count());
        stats.put("freePlan", all.stream().filter(t -> "FREE".equals(t.getPlan())).count());
        stats.put("starterPlan", all.stream().filter(t -> "STARTER".equals(t.getPlan())).count());
        stats.put("proPlan", all.stream().filter(t -> "PRO".equals(t.getPlan())).count());
        return stats;
    }

    @GetMapping("/tenants")
    public List<Map<String, Object>> listTenants() {
        return tenantRepository.findAll().stream()
                .sorted(Comparator.comparing(Tenant::getCreatedAt, Comparator.nullsLast(Comparator.reverseOrder())))
                .map(t -> {
                    Map<String, Object> m = new LinkedHashMap<>();
                    m.put("id",           t.getId().toString());
                    m.put("name",         t.getName());
                    m.put("subdomain",    t.getSubdomain());
                    m.put("ownerEmail",   t.getOwnerEmail());
                    m.put("phoneNumber",  t.getPhoneNumber() != null ? t.getPhoneNumber() : "");
                    m.put("plan",         t.getPlan());
                    m.put("status",       t.getStatus());
                    m.put("createdAt",    t.getCreatedAt() != null ? t.getCreatedAt().toString() : "");
                    m.put("productCount", productRepository.countByTenantId(t.getId()));
                    m.put("billCount",    billRepository.findAllByTenantId(t.getId()).size());
                    return m;
                }).collect(Collectors.toList());
    }

    @PutMapping("/tenants/{tenantId}/plan")
    public ResponseEntity<?> updatePlan(@PathVariable UUID tenantId,
                                        @RequestBody Map<String, String> body) {
        return tenantRepository.findById(tenantId).map(tenant -> {
            String plan = body.get("plan");
            if (plan != null) tenant.setPlan(plan.toUpperCase());
            String status = body.get("status");
            if (status != null) tenant.setStatus(status.toUpperCase());
            String expiresStr = body.get("planExpiresAt");
            if (expiresStr != null && !expiresStr.isBlank()) {
                tenant.setPlanExpiresAt(LocalDateTime.parse(expiresStr));
            }
            return ResponseEntity.ok(tenantRepository.save(tenant));
        }).orElse(ResponseEntity.notFound().build());
    }
}
