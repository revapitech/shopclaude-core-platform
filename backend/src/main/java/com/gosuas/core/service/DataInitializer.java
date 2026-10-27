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

        // Backfill customer_detail from POS bills where a phone was captured.
        // Idempotent: only inserts records missing for that tenant+phone pair.
        backfillCustomersFromBills();
    }

    private void migrateTable(String table, UUID tenantId) {
        em.createNativeQuery("UPDATE " + table + " SET tenant_id = CAST(:tid AS uuid) WHERE tenant_id IS NULL")
                .setParameter("tid", tenantId.toString())
                .executeUpdate();
    }

    private void backfillCustomersFromBills() {
        em.createNativeQuery(
            "INSERT INTO customer_detail (id, tenant_id, first_name, phone, total_spent, total_orders, last_purchase_date) " +
            "SELECT gen_random_uuid(), bs.tenant_id, bs.first_name, bs.phone, bs.total_spent, bs.total_orders, bs.last_purchase_date " +
            "FROM ( " +
            "  SELECT " +
            "    b.tenant_id, " +
            "    b.customer_mobile AS phone, " +
            "    (SELECT b2.customer_name FROM bill b2 " +
            "     WHERE b2.tenant_id = b.tenant_id AND b2.customer_mobile = b.customer_mobile " +
            "       AND b2.customer_name IS NOT NULL AND b2.customer_name <> '' " +
            "       AND LOWER(b2.customer_name) NOT LIKE '%walk%in%' " +
            "     ORDER BY b2.bill_date DESC LIMIT 1) AS first_name, " +
            "    SUM(b.grand_total) AS total_spent, " +
            "    COUNT(*) AS total_orders, " +
            "    MAX(DATE(b.bill_date)) AS last_purchase_date " +
            "  FROM bill b " +
            "  WHERE b.customer_mobile IS NOT NULL AND b.customer_mobile <> '' " +
            "  GROUP BY b.tenant_id, b.customer_mobile " +
            ") bs " +
            "WHERE NOT EXISTS ( " +
            "  SELECT 1 FROM customer_detail cd " +
            "  WHERE cd.tenant_id = bs.tenant_id AND cd.phone = bs.phone " +
            ")"
        ).executeUpdate();
    }
}
