/** Tenant-level helpers shared across the app. Nothing here is specific to one shop. */
import { BACKEND } from './config.js';
import { getSubdomain } from './getSubdomain.js';

// ── Logo / banner URLs ───────────────────────────────────────────────────────
// The backend overwrites the same file (logo_<id>.jpg) on every upload, so the URL
// never changes and browsers keep showing their cached copy. We stamp the time of the
// last successful upload per shop and append it as ?v=, which makes the URL new.
// localStorage is shared by every tab of the same shop, so a storefront opened in
// another tab picks the new version up too.
const imgVersionKey = (sub) => `sc_img_v_${sub}`;

/** Call after a logo/banner upload succeeds. */
export function markImagesUpdated(subdomain = getSubdomain()) {
  try { localStorage.setItem(imgVersionKey(subdomain), String(Date.now())); } catch { /* storage blocked */ }
}

/** Full URL for an uploaded image path from the backend, or null if there is none. */
export function assetUrl(path, subdomain = getSubdomain()) {
  if (!path) return null;
  const base = /^https?:\/\//i.test(path) ? path : `${BACKEND}${path}`;
  if (/[?&]v=/.test(base)) return base; // backend already versioned it
  let v = null;
  try { v = localStorage.getItem(imgVersionKey(subdomain)); } catch { /* storage blocked */ }
  return v ? `${base}${base.includes('?') ? '&' : '?'}v=${v}` : base;
}

/** "my-shop_name" → "My Shop Name" — display fallback when a shop has no name yet. */
export function prettifySubdomain(sub) {
  return String(sub || '').replace(/[-_]/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

// Shops that had the rental register before it became a backend-driven feature flag.
// The backend should expose `rentalEnabled` (or `features.rental`) on /tenant/info; once it
// does, this list is ignored and can be deleted. The backend still enforces access itself.
const LEGACY_RENTAL_SUBDOMAINS = ['gosuas'];

/** Whether the rental register should be shown for this tenant (admin UI). */
export function isRentalEnabled(tenantInfo) {
  if (!tenantInfo) return false;
  if (typeof tenantInfo.rentalEnabled === 'boolean') return tenantInfo.rentalEnabled;
  if (typeof tenantInfo.features?.rental === 'boolean') return tenantInfo.features.rental;
  return LEGACY_RENTAL_SUBDOMAINS.includes(String(tenantInfo.subdomain || '').toLowerCase());
}

const DEFAULT_THEME = '#1E3A5F';
/** Brand colour for payment dialogs etc.; each shop may supply its own via shop-info. */
export function shopThemeColor(info) {
  const c = info?.themeColor || info?.primaryColor;
  return typeof c === 'string' && /^#[0-9a-f]{3,8}$/i.test(c) ? c : DEFAULT_THEME;
}
