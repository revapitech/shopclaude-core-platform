package com.gosuas.core.config;

import java.util.UUID;

public class TenantContext {
    private static final ThreadLocal<UUID> CURRENT = new ThreadLocal<>();

    public static UUID getTenantId() { return CURRENT.get(); }
    public static void setTenantId(UUID id) { CURRENT.set(id); }
    public static void clear() { CURRENT.remove(); }
}
