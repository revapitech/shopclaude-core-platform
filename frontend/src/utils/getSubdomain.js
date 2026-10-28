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

/** Returns the tenant subdomain for the current browser tab. */
export function getSubdomain() {
  return resolveSubdomain(window.location.hostname);
}