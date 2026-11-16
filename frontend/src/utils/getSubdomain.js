/**
 * Tenant subdomain resolution
 *
 * resolveSubdomain(hostname) is the pure, testable core.
 * getSubdomain() wraps it with window.location.hostname.
 *
 * Rules (applied in order):
 *   localhost / 127.0.0.1 / [::1] / ::1     → 'gosuas'   (local dev)
 *   gosuas.com / *.gosuas.com                → 'gosuas'   (legacy backward-compat)
 *   {sub}.theshopclaude.com                  → sub        (platform tenants)
 *   theshopclaude.com / www.theshopclaude.com → 'www'     (landing page)
 *   anything else                            → 'www'      (no silent wrong-tenant fallback)
 */

const PLATFORM_SUFFIX = '.theshopclaude.com';
const SUBDOMAIN_RE    = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/;

/**
 * @param {string} hostname  raw value from window.location.hostname (or test input)
 * @returns {string}         tenant subdomain, 'www', or 'admin'
 */
export function resolveSubdomain(hostname) {
  if (typeof hostname !== 'string' || !hostname) return 'www';

  // Normalise: lower-case and strip any trailing DNS dot
  const host = hostname.toLowerCase().replace(/\.$/, '');

  // ── Local development (IPv4 loopback, IPv6 loopback, bare hostname) ──────────
  if (
    host === 'localhost' ||
    host === '127.0.0.1' ||
    host === '[::1]' ||          // browsers bracket IPv6
    host === '::1'               // just in case
  ) {
    return 'gosuas';
  }

  // ── Legacy gosuas.com domain (backward-compat) ────────────────────────────────
  if (host === 'gosuas.com' || host.endsWith('.gosuas.com')) {
    return 'gosuas';
  }

  // ── Platform root domains → landing page ─────────────────────────────────────
  if (host === 'theshopclaude.com' || host === 'www.theshopclaude.com') {
    return 'www';
  }

  // ── Platform tenant: {subdomain}.theshopclaude.com ────────────────────────────
  if (host.endsWith(PLATFORM_SUFFIX)) {
    const sub = host.slice(0, host.length - PLATFORM_SUFFIX.length);
    // sub must be a single label (no dots) with valid subdomain characters
    if (sub && !sub.includes('.') && SUBDOMAIN_RE.test(sub)) {
      return sub;
    }
    // Malformed label (e.g. double-dot, empty, invalid chars) → landing page
    return 'www';
  }

  // ── Unknown / custom domain ───────────────────────────────────────────────────
  // Fall through to landing page rather than silently resolving wrong tenant.
  // Custom-domain support (stored in Tenant.customDomain) will be implemented
  // here when the feature is added.
  return 'www';
}

// ── Local-dev tenant override ────────────────────────────────────────────────
// On localhost every request resolves to 'gosuas', so other tenants (and the
// super-admin console via ?tenant=admin) cannot be reached locally. Visiting
// /?tenant=<sub> on a loopback host selects that tenant for this browser;
// /?tenant= clears it. Never consulted on real domains — production routing
// is unaffected.
const DEV_TENANT_KEY = 'sc_dev_tenant';

export function isLoopbackHost(hostname) {
  const host = String(hostname || '').toLowerCase();
  return host === 'localhost' || host === '127.0.0.1' || host === '[::1]' || host === '::1';
}

/**
 * Pure core of the dev override.
 * @param {string} search       location.search, e.g. '?tenant=kakli'
 * @param {string|null} stored  previously stored override
 * @returns {{ tenant: string|null, changed: boolean }}
 */
export function resolveDevTenant(search, stored) {
  const storedValid = stored && SUBDOMAIN_RE.test(stored) ? stored : null;
  const params = new URLSearchParams(search || '');
  if (!params.has('tenant')) return { tenant: storedValid, changed: false };
  const raw = (params.get('tenant') || '').trim().toLowerCase();
  const tenant = raw && SUBDOMAIN_RE.test(raw) ? raw : null;
  return { tenant, changed: tenant !== storedValid };
}

function readDevTenant() {
  let stored = null;
  try { stored = localStorage.getItem(DEV_TENANT_KEY); } catch { /* storage blocked */ }
  const { tenant, changed } = resolveDevTenant(window.location.search, stored);
  if (changed) {
    try {
      if (tenant) localStorage.setItem(DEV_TENANT_KEY, tenant);
      else localStorage.removeItem(DEV_TENANT_KEY);
      // A token issued for another tenant must not carry over to the new one.
      localStorage.removeItem('gosuas_token');
    } catch { /* storage blocked */ }
  }
  return tenant;
}

/** Returns the tenant subdomain for the current browser tab. */
export function getSubdomain() {
  const host = window.location.hostname;
  if (isLoopbackHost(host)) {
    const devTenant = readDevTenant();
    if (devTenant) return devTenant;
  }
  return resolveSubdomain(host);
}

/** A tenant's store URL — the local override on localhost, the real subdomain otherwise. */
export function tenantHomeUrl(sub) {
  if (isLoopbackHost(window.location.hostname)) {
    return `${window.location.origin}/?tenant=${encodeURIComponent(sub)}`;
  }
  return `https://${sub}.theshopclaude.com`;
}