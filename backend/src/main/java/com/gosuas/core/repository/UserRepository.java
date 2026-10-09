package com.gosuas.core.repository;

import com.gosuas.core.entity.User;
import org.springframework.data.jpa.repository.JpaRepository;
import java.util.Optional;
import java.util.UUID;

public interface UserRepository extends JpaRepository<User, UUID> {
    Optional<User> findByEmailAndTenantId(String email, UUID tenantId);
    Optional<User> findByEmailAndRole(String email, String role);
    boolean existsByEmail(String email);
}
