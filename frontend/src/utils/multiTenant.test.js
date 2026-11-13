import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// ── Minimal browser stubs (vitest runs in node) ───────────────────────────────
function stubBrowser(hostname, search = '') {
  const store = new Map();
  vi.stubGlobal('localStorage', {
    getItem: k => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: k => store.delete(k),
  });
  vi.stubGlobal('window', { location: { hostname, search, origin: `https://${hostname}` } });
  return store;
}

afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); });

describe('session token is bound to its shop', () => {
  it('returns the token for the shop that issued it', async () => {
    stubBrowser('alpha.theshopclaude.com');
    const s = await import('./session.js');
    s.setToken('tok-alpha');
    expect(s.getToken()).toBe('tok-alpha');
  });

  it("never returns shop A's token while the tab resolves to shop B", async () => {
    const store = stubBrowser('alpha.theshopclaude.com');
    const s = await import('./session.js');
    s.setToken('tok-alpha');
    // Same browser storage, now on another shop (e.g. localhost ?tenant= switch).
    window.location.hostname = 'beta.theshopclaude.com';
    expect(s.getToken()).toBeNull();
    expect(store.get('sc_token')).toBe('tok-alpha'); // untouched, still belongs to alpha
  });

  it('migrates a legacy gosuas_token once and keeps the user logged in', async () => {
    const store = stubBrowser('gosuas.theshopclaude.com');
    store.set('gosuas_token', 'legacy');
    const s = await import('./session.js');
    expect(s.getToken()).toBe('legacy');
    expect(store.has('gosuas_token')).toBe(false);
    expect(store.get('sc_token_tenant')).toBe('gosuas');
  });

  it('clearToken removes everything', async () => {
    const store = stubBrowser('alpha.theshopclaude.com');
    const s = await import('./session.js');
    s.setToken('t');
    s.clearToken();
    expect(s.getToken()).toBeNull();
    expect([...store.keys()]).toEqual([]);
  });
});

describe('two shops resolve independently', () => {
  it.each([
    ['alpha.theshopclaude.com', 'alpha'],
    ['beta.theshopclaude.com', 'beta'],
    ['gosuas.theshopclaude.com', 'gosuas'],
  ])('%s → %s', async (host, sub) => {
    stubBrowser(host);
    const { getSubdomain } = await import('./getSubdomain.js');
    expect(getSubdomain()).toBe(sub);
  });

  it('localhost ?tenant= selects other shops; default tenant is configurable', async () => {
    stubBrowser('localhost', '?tenant=beta');
    const { getSubdomain } = await import('./getSubdomain.js');
    expect(getSubdomain()).toBe('beta');
  });
});

describe('rental feature is a per-tenant flag, not a shop name check', () => {
  it('honours the backend flag over everything else', async () => {
    const { isRentalEnabled } = await import('./tenant.js');
    expect(isRentalEnabled({ subdomain: 'beta', rentalEnabled: true })).toBe(true);
    expect(isRentalEnabled({ subdomain: 'gosuas', rentalEnabled: false })).toBe(false);
    expect(isRentalEnabled({ subdomain: 'beta', features: { rental: true } })).toBe(true);
  });
  it('keeps the existing shop working until the backend sends the flag; others stay off', async () => {
    const { isRentalEnabled } = await import('./tenant.js');
    expect(isRentalEnabled({ subdomain: 'gosuas' })).toBe(true);
    expect(isRentalEnabled({ subdomain: 'beta' })).toBe(false);
    expect(isRentalEnabled(null)).toBe(false);
  });
});

describe('Razorpay checkout uses only backend-provided keys', () => {
  let opened;
  beforeEach(() => {
    opened = [];
    class FakeRazorpay {
      constructor(opts) { this.opts = opts; opened.push(this); this.handlers = {}; }
      on(ev, fn) { this.handlers[ev] = fn; }
      open() { this.isOpen = true; }
    }
    vi.stubGlobal('window', { Razorpay: FakeRazorpay });
  });

  it('getPaymentMode: explicit mode wins, key prefix is the fallback', async () => {
    const { getPaymentMode } = await import('./razorpay.js');
    expect(getPaymentMode({ mode: 'TEST', keyId: 'rzp_live_x' })).toBe('test');
    expect(getPaymentMode({ paymentMode: 'live' })).toBe('live');
    expect(getPaymentMode({ testMode: true })).toBe('test');
    expect(getPaymentMode({ keyId: 'rzp_test_abc' })).toBe('test');
    expect(getPaymentMode({ keyId: 'rzp_live_abc' })).toBe('live');
    expect(getPaymentMode({})).toBe('unknown');
  });

  it("opens checkout with the backend's keyId and ignores any key passed by the caller", async () => {
    const { openRazorpayCheckout } = await import('./razorpay.js');
    await openRazorpayCheckout({ keyId: 'rzp_live_SHOP_A' }, { key: 'rzp_test_HARDCODED', amount: 100, description: 'Order' });
    expect(opened).toHaveLength(1);
    expect(opened[0].opts.key).toBe('rzp_live_SHOP_A');
    expect(opened[0].opts.description).toBe('Order'); // live → untouched
    expect(opened[0].isOpen).toBe(true);
  });

  it('marks Test Mode in the checkout window', async () => {
    const { openRazorpayCheckout } = await import('./razorpay.js');
    await openRazorpayCheckout({ keyId: 'rzp_test_SHOP_B', mode: 'test' }, { amount: 100, description: 'Order' });
    expect(opened[0].opts.key).toBe('rzp_test_SHOP_B');
    expect(opened[0].opts.description).toBe('Order [TEST MODE]');
  });

  it('two shops get two different keys — no shared state between calls', async () => {
    const { openRazorpayCheckout } = await import('./razorpay.js');
    await openRazorpayCheckout({ keyId: 'rzp_test_A' }, { amount: 1 });
    await openRazorpayCheckout({ keyId: 'rzp_test_B' }, { amount: 1 });
    expect(opened.map(o => o.opts.key)).toEqual(['rzp_test_A', 'rzp_test_B']);
  });

  it('refuses to open without a backend key (shop payments not configured)', async () => {
    const { openRazorpayCheckout } = await import('./razorpay.js');
    await expect(openRazorpayCheckout({ razorpayOrderId: 'order_1' }, { amount: 1 }))
      .rejects.toMatchObject({ userMessage: expect.stringContaining('not set up') });
    expect(opened).toHaveLength(0);
  });

  it('wires payment.failed and never reads a key secret from the response', async () => {
    const { openRazorpayCheckout } = await import('./razorpay.js');
    const onFailed = vi.fn();
    await openRazorpayCheckout({ keyId: 'rzp_test_A', keySecret: 'SECRET' }, { amount: 1 }, { onFailed });
    expect(JSON.stringify(opened[0].opts)).not.toContain('SECRET');
    opened[0].handlers['payment.failed']({});
    expect(onFailed).toHaveBeenCalled();
  });
});

describe('logo / banner URLs refresh after an upload', () => {
  it('returns null when there is no image, so callers can fall back to the default', async () => {
    stubBrowser('alpha.theshopclaude.com');
    const { assetUrl } = await import('./tenant.js');
    expect(assetUrl(null)).toBeNull();
    expect(assetUrl('')).toBeNull();
  });

  it('a new upload changes the URL even though the backend reuses the same file name', async () => {
    stubBrowser('alpha.theshopclaude.com');
    const { assetUrl, markImagesUpdated } = await import('./tenant.js');
    const before = assetUrl('/uploads/logo_1.jpg');
    expect(before).not.toMatch(/[?&]v=/);          // nothing uploaded yet
    vi.spyOn(Date, 'now').mockReturnValue(1000);
    markImagesUpdated();
    const first = assetUrl('/uploads/logo_1.jpg');
    expect(first).toMatch(/logo_1\.jpg\?v=1000$/);
    vi.spyOn(Date, 'now').mockReturnValue(2000);
    markImagesUpdated();                            // replace the logo
    const second = assetUrl('/uploads/logo_1.jpg');
    expect(second).toMatch(/\?v=2000$/);
    expect(second).not.toBe(first);                 // browser must refetch
    vi.restoreAllMocks();
  });

  it('keeps a version the backend already added and handles existing query strings', async () => {
    stubBrowser('alpha.theshopclaude.com');
    const { assetUrl, markImagesUpdated } = await import('./tenant.js');
    markImagesUpdated();
    expect(assetUrl('/uploads/b.png?v=555')).toMatch(/\?v=555$/);
    expect(assetUrl('/uploads/b.png?x=1')).toMatch(/\?x=1&v=\d+$/);
  });

  it("versions are per shop: shop A's upload never touches shop B's URLs", async () => {
    stubBrowser('alpha.theshopclaude.com');
    const { assetUrl, markImagesUpdated } = await import('./tenant.js');
    markImagesUpdated('alpha');
    expect(assetUrl('/uploads/logo.jpg', 'alpha')).toMatch(/\?v=\d+$/);
    expect(assetUrl('/uploads/logo.jpg', 'beta')).not.toMatch(/[?&]v=/);
  });

  it('works when localStorage is blocked', async () => {
    vi.stubGlobal('window', { location: { hostname: 'alpha.theshopclaude.com', search: '' } });
    vi.stubGlobal('localStorage', { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); }, removeItem() {} });
    const { assetUrl, markImagesUpdated } = await import('./tenant.js');
    expect(() => markImagesUpdated()).not.toThrow();
    expect(assetUrl('/uploads/logo.jpg')).toMatch(/\/uploads\/logo\.jpg$/);
  });
});
