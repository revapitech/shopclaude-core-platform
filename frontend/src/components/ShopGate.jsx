import React, { createContext, useContext, useEffect, useState } from 'react';
import axios from 'axios';
import { API } from '../utils/config.js';
import { getSubdomain } from '../utils/getSubdomain.js';
import { prettifySubdomain, assetUrl } from '../utils/tenant.js';

/**
 * ShopGate resolves the current shop (from the hostname) via the backend and
 * provides its public info — name, logo, banner, theme, phone — to the tree.
 *
 *   loading   → neutral spinner (never another shop's name)
 *   not found → "shop doesn't exist" page
 *   error     → "can't reach shop" page with retry
 *
 * The context value is keyed by subdomain and discarded whenever it changes, so
 * data from one shop can never render under another.
 */
const ShopContext = createContext(null);

/** Public info of the current shop: { name, subdomain, logoUrl, bannerUrl, phoneNumber, … } */
export function useShop() {
  const ctx = useContext(ShopContext);
  if (!ctx) throw new Error('useShop must be used inside <ShopGate>');
  return ctx;
}

/** Display helpers derived from shop info. */
export function shopDisplay(info) {
  return {
    name: info?.name || prettifySubdomain(info?.subdomain || getSubdomain()),
    logoSrc: assetUrl(info?.logoUrl, info?.subdomain) || '/logo.png',
    bannerSrc: assetUrl(info?.bannerUrl, info?.subdomain),
  };
}

/** Returns `src` only once it has loaded successfully (null while loading or if it fails) — for CSS backgrounds. */
export function useLoadableImage(src) {
  const [ok, setOk] = useState(null);
  useEffect(() => {
    if (!src) { setOk(null); return; }
    let live = true;
    const img = new Image();
    img.onload = () => live && setOk(src);
    img.onerror = () => live && setOk(null);
    img.src = src;
    return () => { live = false; };
  }, [src]);
  return ok;
}

const pageStyle = {
  minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
  flexDirection: 'column', gap: 12, padding: 24, textAlign: 'center',
  fontFamily: 'Inter, system-ui, sans-serif', background: '#F8FAFC', color: '#1f2937',
};
const btnStyle = {
  marginTop: 8, padding: '10px 22px', border: 'none', borderRadius: 8,
  background: '#1E3A5F', color: '#fff', fontSize: 14, fontWeight: 600, cursor: 'pointer',
};

export function ShopGate({ children }) {
  const subdomain = getSubdomain();
  const [state, setState] = useState({ subdomain, status: 'loading', info: null });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setState({ subdomain, status: 'loading', info: null });
    // `_` makes every request a distinct URL so a cached/stale-while-revalidate copy is never reused.
    axios.get(`${API}/public/shop-info`, { params: { subdomain, _: Date.now() } })
      .then(r => { if (!cancelled) setState({ subdomain, status: 'ready', info: { ...r.data, subdomain: r.data?.subdomain || subdomain } }); })
      .catch(err => {
        if (cancelled) return;
        setState({ subdomain, status: err.response?.status === 404 ? 'notfound' : 'error', info: null });
      });
    return () => { cancelled = true; };
  }, [subdomain, attempt]);

  // Tab title + favicon follow the shop's own branding.
  const info = state.status === 'ready' && state.subdomain === subdomain ? state.info : null;
  useEffect(() => {
    if (!info) return;
    document.title = info.name || prettifySubdomain(subdomain);
    if (info.logoUrl) {
      let link = document.querySelector('link[rel="icon"]');
      if (!link) { link = document.createElement('link'); link.rel = 'icon'; document.head.appendChild(link); }
      link.href = assetUrl(info.logoUrl, subdomain);
    }
  }, [info, subdomain]);

  if (state.subdomain !== subdomain || state.status === 'loading') {
    return (
      <div style={pageStyle} role="status" aria-live="polite">
        <div style={{ width: 36, height: 36, border: '3px solid #cbd5e1', borderTopColor: '#1E3A5F', borderRadius: '50%', animation: 'sc-gate-spin .8s linear infinite' }} />
        <style>{'@keyframes sc-gate-spin{to{transform:rotate(360deg)}}'}</style>
        <div style={{ fontSize: 14, color: '#64748b' }}>Loading shop…</div>
      </div>
    );
  }

  if (state.status === 'notfound') {
    return (
      <div style={pageStyle}>
        <div style={{ fontSize: 48 }}>🏪</div>
        <h1 style={{ margin: 0, fontSize: 22 }}>Shop not found</h1>
        <p style={{ margin: 0, maxWidth: 380, color: '#64748b', lineHeight: 1.6 }}>
          We couldn't find a shop at <strong>{subdomain}</strong>. Check the address, or ask the shop owner for the correct link.
        </p>
      </div>
    );
  }

  if (state.status === 'error') {
    return (
      <div style={pageStyle}>
        <div style={{ fontSize: 48 }}>⚠️</div>
        <h1 style={{ margin: 0, fontSize: 22 }}>Can't load this shop right now</h1>
        <p style={{ margin: 0, maxWidth: 380, color: '#64748b', lineHeight: 1.6 }}>
          There was a problem reaching the server. Please check your connection and try again.
        </p>
        <button style={btnStyle} onClick={() => setAttempt(a => a + 1)}>Try again</button>
      </div>
    );
  }

  return <ShopContext.Provider value={state.info}>{children}</ShopContext.Provider>;
}
