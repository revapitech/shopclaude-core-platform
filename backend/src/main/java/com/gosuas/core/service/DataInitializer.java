package com.gosuas.core.service;

import com.gosuas.core.entity.Tenant;
import com.gosuas.core.entity.User;
import com.gosuas.core.repository.TenantRepository;
import com.gosuas.core.repository.UserRepository;
import jakarta.persistence.EntityManager;
import jakarta.persistence.PersistenceContext;
import jakarta.transaction.Transactional;
import lombok.RequiredArgsConstructor;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Component;

import java.util.UUID;

@Component
@RequiredArgsConstructor
public class DataInitializer implements ApplicationRunner {

    private final TenantRepository tenantRepository;
    private final UserRepository userRepository;
    private final PasswordEncoder passwordEncoder;

    @PersistenceContext
    private EntityManager em;

    @Value("${gosuas.init.admin-email:admin@gosuas.com}")
    private String adminEmail;

    @Value("${gosuas.init.admin-password:admin@123}")
    private String adminPassword;

    @Value("${gosuas.init.superadmin-email:owner@theshopclaude.com}")
    private String superadminEmail;

    @Value("${gosuas.init.superadmin-password:Sc@Admin2026#}")
    private String superadminPassword;

    @Override
    @Transactional
    public void run(ApplicationArguments args) {
        Tenant tenant;
        if (!tenantRepository.existsBySubdomain("gosuas")) {
            tenant = Tenant.builder()
                    .name("Gosuas Store")
                    .subdomain("gosuas")
                    .ownerEmail(adminEmail)
                    .plan("STARTER")
                    .status("ACTIVE")
                    .build();
            tenantRepository.save(tenant);

            User user = User.builder()
                    .tenantId(tenant.getId())
                    .email(adminEmail)
                    .passwordHash(passwordEncoder.encode(adminPassword))
                    .role("OWNER")
                    .name("Admin")
                    .build();
            userRepository.save(user);
        } else {
            tenant = tenantRepository.findBySubdomain("gosuas").orElseThrow();
        }

        // Create super-admin platform owner (no tenant)
        if (!userRepository.existsByEmail(superadminEmail)) {
            User superadmin = User.builder()
                    .tenantId(null)
                    .email(superadminEmail)
                    .passwordHash(passwordEncoder.encode(superadminPassword))
                    .role("SUPERADMIN")
                    .name("Platform Admin")
                    .build();
            userRepository.save(superadmin);
        }

        // Migrate any existing data that has no tenant assigned (idempotent)
        UUID tid = tenant.getId();
        migrateTable("product", tid);
        migrateTable("bill", tid);
        migrateTable("shop_order", tid);
        migrateTable("customer_detail", tid);
        migrateTable("order_detail", tid);
    }

    private void migrateTable(String table, UUID tenantId) {
        em.createNativeQuery("UPDATE " + table + " SET tenant_id = CAST(:tid AS uuid) WHERE tenant_id IS NULL")
                .setParameter("tid", tenantId.toString())
                .executeUpdate();
    }
}
