/**
 * Shop-admin session token, bound to the shop it was issued for.
 *
 * The token is stored together with the subdomain that issued it. getToken()
 * only returns it while the current tab still resolves to that same shop, so a
 * session from one shop can never be replayed against another (e.g. when
 * switching shops with the localhost ?tenant= override).
 *
 * Tokens written by older builds under 'gosuas_token' (no shop recorded) are
 * still honoured and migrated on first read, so existing logins keep working.
 */
import { getSubdomain } from './getSubdomain.js';

export const TOKEN_KEY        = 'sc_token';
const TOKEN_TENANT_KEY = 'sc_token_tenant';
const LEGACY_TOKEN_KEY = 'gosuas_token';

function safe(fn, fallback = null) {
  try { return fn(); } catch { return fallback; }
}

export function getToken() {
  return safe(() => {
    const current = getSubdomain();
    let token = localStorage.getItem(TOKEN_KEY);
    if (token) {
      const owner = localStorage.getItem(TOKEN_TENANT_KEY);
      return owner && owner !== current ? null : token;
    }
    // One-time migration of a pre-existing session.
    const legacy = localStorage.getItem(LEGACY_TOKEN_KEY);
    if (legacy) {
      localStorage.setItem(TOKEN_KEY, legacy);
      localStorage.setItem(TOKEN_TENANT_KEY, current);
      localStorage.removeItem(LEGACY_TOKEN_KEY);
      return legacy;
    }
    return null;
  });
}

/** @param {string} token  @param {string} [subdomain] shop the token was issued for (defaults to current tab's shop) */
export function setToken(token, subdomain) {
  safe(() => {
    localStorage.setItem(TOKEN_KEY, token);
    localStorage.setItem(TOKEN_TENANT_KEY, (subdomain || getSubdomain()).toLowerCase());
    localStorage.removeItem(LEGACY_TOKEN_KEY);
  });
}

export function clearToken() {
  safe(() => {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(TOKEN_TENANT_KEY);
    localStorage.removeItem(LEGACY_TOKEN_KEY);
  });
}

export const hasToken = () => !!getToken();
