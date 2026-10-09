package com.gosuas.core.controller;

import com.gosuas.core.dto.LoginRequest;
import com.gosuas.core.dto.LoginResponse;
import com.gosuas.core.dto.SignupRequest;
import com.gosuas.core.repository.TenantRepository;
import com.gosuas.core.service.AuthService;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.Map;

@RestController
@RequestMapping("/api/auth")
@RequiredArgsConstructor
public class AuthController {

    private final AuthService authService;
    private final TenantRepository tenantRepository;

    @PostMapping("/login")
    public ResponseEntity<?> login(@RequestBody LoginRequest request) {
        try {
            return ResponseEntity.ok(authService.login(request));
        } catch (IllegalArgumentException e) {
            return ResponseEntity.status(HttpStatus.UNAUTHORIZED)
                    .body(Map.of("error", e.getMessage()));
        }
    }

    @PostMapping("/signup")
    public ResponseEntity<?> signup(@RequestBody SignupRequest request) {
        try {
            return ResponseEntity.status(HttpStatus.CREATED).body(authService.signup(request));
        } catch (IllegalArgumentException e) {
            return ResponseEntity.status(HttpStatus.BAD_REQUEST)
                    .body(Map.of("error", e.getMessage()));
        }
    }

    @GetMapping("/check-subdomain")
    public ResponseEntity<Map<String, Object>> checkSubdomain(@RequestParam String subdomain) {
        String normalized = subdomain.toLowerCase().replaceAll("[^a-z0-9]", "");
        boolean available = !normalized.isBlank() && !tenantRepository.existsBySubdomain(normalized);
        return ResponseEntity.ok(Map.of("available", available, "subdomain", normalized));
    }
}
