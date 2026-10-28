package com.gosuas.core.service;

import com.gosuas.core.dto.LoginRequest;
import com.gosuas.core.dto.LoginResponse;
import com.gosuas.core.entity.Tenant;
import com.gosuas.core.entity.User;
import com.gosuas.core.repository.TenantRepository;
import com.gosuas.core.repository.UserRepository;
import com.gosuas.core.util.JwtUtil;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.mockito.junit.jupiter.MockitoSettings;
import org.mockito.quality.Strictness;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.test.util.ReflectionTestUtils;

import java.util.Optional;
import java.util.UUID;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

@ExtendWith(MockitoExtension.class)
@MockitoSettings(strictness = Strictness.LENIENT)
class AuthServiceTest {

    @Mock TenantRepository   tenantRepository;
    @Mock UserRepository     userRepository;
    @Mock PasswordEncoder    passwordEncoder;
    @Mock JwtUtil            jwtUtil;
    @InjectMocks AuthService authService;

    private final UUID tenantId = UUID.randomUUID();
    private final UUID userId   = UUID.randomUUID();
    private Tenant tenant;
    private User   user;

    @BeforeEach
    void setUp() {
        // inject @Value field (razorpayKeySecret is only needed for signup payment verification)
        ReflectionTestUtils.setField(authService, "razorpayKeySecret", "test-secret");

        tenant = Tenant.builder()
                .id(tenantId).name("Test Shop").subdomain("testshop")
                .ownerEmail("owner@test.com").plan("STARTER").status("ACTIVE")
                .build();

        user = User.builder()
                .id(userId).tenantId(tenantId)
                .email("owner@test.com").passwordHash("hashed-pw")
                .role("OWNER").name("Test Owner")
                .build();
    }

    // ── Normal tenant login ───────────────────────────────────────────────────

    @Test
    void login_validCredentials_returnsToken() {
        when(tenantRepository.findBySubdomain("testshop")).thenReturn(Optional.of(tenant));
        when(userRepository.findByEmailAndTenantId("owner@test.com", tenantId)).thenReturn(Optional.of(user));
        when(passwordEncoder.matches("secret", "hashed-pw")).thenReturn(true);
        when(jwtUtil.generate(userId, tenantId, "OWNER", "testshop")).thenReturn("tok.en");

        LoginResponse resp = authService.login(new LoginRequest("owner@test.com", "secret", "testshop"));

        assertThat(resp.token()).isEqualTo("tok.en");
        assertThat(resp.role()).isEqualTo("OWNER");
        assertThat(resp.subdomain()).isEqualTo("testshop");
    }

    @Test
    void login_wrongPassword_throws() {
        when(tenantRepository.findBySubdomain("testshop")).thenReturn(Optional.of(tenant));
        when(userRepository.findByEmailAndTenantId("owner@test.com", tenantId)).thenReturn(Optional.of(user));
        when(passwordEncoder.matches("wrong", "hashed-pw")).thenReturn(false);

        assertThatThrownBy(() -> authService.login(new LoginRequest("owner@test.com", "wrong", "testshop")))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("Invalid email or password");
    }

    @Test
    void login_unknownEmail_throws() {
        when(tenantRepository.findBySubdomain("testshop")).thenReturn(Optional.of(tenant));
        when(userRepository.findByEmailAndTenantId("nobody@test.com", tenantId)).thenReturn(Optional.empty());

        assertThatThrownBy(() -> authService.login(new LoginRequest("nobody@test.com", "pw", "testshop")))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("Invalid email or password");
    }

    @Test
    void login_unknownSubdomain_throws() {
        when(tenantRepository.findBySubdomain("ghost")).thenReturn(Optional.empty());

        assertThatThrownBy(() -> authService.login(new LoginRequest("owner@test.com", "pw", "ghost")))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("Shop not found");
    }

    // ── SuperAdmin login ──────────────────────────────────────────────────────

    @Test
    void login_superAdminSubdomain_authenticatesViaRole() {
        UUID saId = UUID.randomUUID();
        User superadmin = User.builder()
                .id(saId).tenantId(null)
                .email("owner@theshopclaude.com").passwordHash("sa-hash")
                .role("SUPERADMIN").name("Platform Admin")
                .build();

        when(userRepository.findByEmailAndRole("owner@theshopclaude.com", "SUPERADMIN"))
                .thenReturn(Optional.of(superadmin));
        when(passwordEncoder.matches("sa-pw", "sa-hash")).thenReturn(true);
        when(jwtUtil.generate(saId, null, "SUPERADMIN", null)).thenReturn("sa.token");

        LoginResponse resp = authService.login(
                new LoginRequest("owner@theshopclaude.com", "sa-pw", "admin"));

        assertThat(resp.token()).isEqualTo("sa.token");
        assertThat(resp.role()).isEqualTo("SUPERADMIN");
    }

    @Test
    void login_superAdminSubdomain_wrongPassword_throws() {
        UUID saId = UUID.randomUUID();
        User superadmin = User.builder()
                .id(saId).tenantId(null).email("owner@theshopclaude.com")
                .passwordHash("sa-hash").role("SUPERADMIN").name("Platform Admin")
                .build();

        when(userRepository.findByEmailAndRole("owner@theshopclaude.com", "SUPERADMIN"))
                .thenReturn(Optional.of(superadmin));
        when(passwordEncoder.matches("wrong", "sa-hash")).thenReturn(false);

        assertThatThrownBy(() -> authService.login(
                new LoginRequest("owner@theshopclaude.com", "wrong", "admin")))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("Invalid credentials");
    }

    @Test
    void login_superAdminSubdomain_nonSuperadminEmail_throws() {
        when(userRepository.findByEmailAndRole("notadmin@test.com", "SUPERADMIN"))
                .thenReturn(Optional.empty());

        assertThatThrownBy(() -> authService.login(
                new LoginRequest("notadmin@test.com", "pw", "admin")))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("Invalid credentials");
    }

    // ── Case insensitivity for 'admin' subdomain ───────────────────────────────

    @Test
    void login_superAdminSubdomain_isCaseInsensitive() {
        // "ADMIN" should hit the superadmin path, not a tenant lookup
        when(userRepository.findByEmailAndRole("owner@theshopclaude.com", "SUPERADMIN"))
                .thenReturn(Optional.empty());

        assertThatThrownBy(() -> authService.login(
                new LoginRequest("owner@theshopclaude.com", "pw", "ADMIN")))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("Invalid credentials");

        // verify we never looked up a tenant with subdomain "ADMIN"
        verify(tenantRepository, never()).findBySubdomain(anyString());
    }

    // ── Tenant isolation: JWT carries tenantId, not subdomain ─────────────────

    @Test
    void login_jwtContainsTenantId_notSubdomain() {
        when(tenantRepository.findBySubdomain("testshop")).thenReturn(Optional.of(tenant));
        when(userRepository.findByEmailAndTenantId("owner@test.com", tenantId)).thenReturn(Optional.of(user));
        when(passwordEncoder.matches("pw", "hashed-pw")).thenReturn(true);
        when(jwtUtil.generate(userId, tenantId, "OWNER", "testshop")).thenReturn("tok");

        authService.login(new LoginRequest("owner@test.com", "pw", "testshop"));

        // verify JWT is generated with the DB-verified tenantId UUID, not just the subdomain string
        verify(jwtUtil).generate(userId, tenantId, "OWNER", "testshop");
    }
}
