package com.gosuas.core.config;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.web.cors.CorsConfiguration;
import org.springframework.web.cors.CorsConfigurationSource;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Verifies that the CORS allowedOriginPatterns list covers all expected origins,
 * including both local dev ports (5173 and 5174) and production domains.
 *
 * A missing origin in this list causes Spring's CorsFilter to return 403 before
 * any permitAll() rule is evaluated — which is the root cause of the
 * "GET /api/public/shop-info returns 403" bug when the frontend runs on port 5174.
 */
class SecurityCorsConfigTest {

    private CorsConfigurationSource corsSource;

    @BeforeEach
    void setUp() {
        SecurityConfig config = new SecurityConfig();
        corsSource = config.corsConfigurationSource();
    }

    private CorsConfiguration configFor(String path) {
        MockHttpServletRequest req = new MockHttpServletRequest("GET", path);
        return corsSource.getCorsConfiguration(req);
    }

    @Test
    void corsConfig_allowsLocalhost5173() {
        assertThat(configFor("/api/public/shop-info").getAllowedOriginPatterns())
                .contains("http://localhost:5173");
    }

    @Test
    void corsConfig_allowsLocalhost5174() {
        assertThat(configFor("/api/public/shop-info").getAllowedOriginPatterns())
                .contains("http://localhost:5174");
    }

    @Test
    void corsConfig_allowsProductionDomains() {
        CorsConfiguration cfg = configFor("/api/admin/products");
        assertThat(cfg.getAllowedOriginPatterns())
                .contains("https://*.gosuas.com")
                .contains("https://*.theshopclaude.com");
    }

    @Test
    void corsConfig_allowsRequiredMethods() {
        CorsConfiguration cfg = configFor("/api/auth/login");
        assertThat(cfg.getAllowedMethods())
                .contains("GET", "POST", "PUT", "DELETE", "OPTIONS");
    }

    @Test
    void corsConfig_appliesToAllPaths() {
        // Both public and protected paths must receive CORS config (pattern is /**)
        assertThat(configFor("/api/public/shop-info")).isNotNull();
        assertThat(configFor("/api/auth/login")).isNotNull();
        assertThat(configFor("/api/admin/products")).isNotNull();
    }
}
