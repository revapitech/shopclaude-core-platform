package com.gosuas.core.config;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.web.cors.CorsConfiguration;
import org.springframework.web.cors.CorsConfigurationSource;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Verifies that the CORS allowedOriginPatterns list covers all expected origins.
 * Localhost is allowed via the wildcard pattern http://localhost:[*] so any Vite
 * dev-server port (5173, 5174, 5177, …) is covered without hardcoding each one.
 * Note: Spring requires the port wildcard to be bracketed ([*]) — a bare trailing
 * "*" (http://localhost:*) is parsed as a literal character and never matches.
 *
 * A missing origin in this list causes Spring's CorsFilter to return 403 before
 * any permitAll() rule is evaluated — which is the root cause of the
 * "GET /api/public/shop-info returns 403" bug when the frontend runs on an
 * unexpected port.
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
    void corsConfig_allowsLocalhostWildcard() {
        // Single wildcard pattern covers all Vite dev ports (5173, 5174, 5177, …)
        assertThat(configFor("/api/public/shop-info").getAllowedOriginPatterns())
                .contains("http://localhost:[*]");
    }

    @Test
    void corsConfig_actuallyMatchesLocalhostOriginWithAnyPort() {
        // Regression test: a bare "http://localhost:*" pattern is parsed literally
        // and never matches a real Origin header, even though it looks correct
        // and even though it appears in getAllowedOriginPatterns().
        CorsConfiguration cfg = configFor("/api/auth/login");
        assertThat(cfg.checkOrigin("http://localhost:5173")).isEqualTo("http://localhost:5173");
        assertThat(cfg.checkOrigin("http://localhost:4321")).isEqualTo("http://localhost:4321");
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
