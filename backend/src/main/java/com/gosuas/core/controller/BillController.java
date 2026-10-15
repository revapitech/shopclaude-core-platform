package com.gosuas.core.controller;

import com.gosuas.core.dto.BillRequest;
import com.gosuas.core.dto.BillResponse;
import com.gosuas.core.service.BillService;
import lombok.RequiredArgsConstructor;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;
import java.util.UUID;

@RestController
@RequestMapping("/api/bills")
@RequiredArgsConstructor
public class BillController {
    private final BillService billService;

    // The bill number is "count of today's bills + 1" — not atomic, so two requests landing at
    // nearly the same time (double-click, or just two tenants billing simultaneously) can compute
    // the same number and collide on the unique constraint. Each createBill() call runs in its
    // own transaction, so a clean retry (which re-reads the count) is safe here.
    @PostMapping
    public BillResponse createBill(@RequestBody BillRequest request) {
        for (int attempt = 1; attempt <= 3; attempt++) {
            try {
                return billService.createBill(request);
            } catch (DataIntegrityViolationException e) {
                if (attempt == 3) throw e;
            }
        }
        throw new IllegalStateException("unreachable");
    }

    @GetMapping
    public List<BillResponse> listBills() {
        return billService.listBills();
    }

    @GetMapping("/{id}")
    public ResponseEntity<BillResponse> getBillById(@PathVariable UUID id) {
        try {
            return ResponseEntity.ok(billService.getBillById(id));
        } catch (RuntimeException e) {
            return ResponseEntity.notFound().build();
        }
    }

    @GetMapping("/customer-by-mobile/{mobile}")
    public ResponseEntity<Map<String, String>> customerByMobile(@PathVariable String mobile) {
        String name = billService.findCustomerNameByMobile(mobile);
        return name != null ? ResponseEntity.ok(Map.of("customerName", name)) : ResponseEntity.notFound().build();
    }
}