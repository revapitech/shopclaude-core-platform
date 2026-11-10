import { describe, it, expect } from 'vitest';
import { resolveSubdomain, resolveDevTenant, isLoopbackHost } from './getSubdomain.js';

// Helper: assert resolveSubdomain(host) === expected
const eq = (host, expected) =>
  it(`"${host}" → "${expected}"`, () =>
    expect(resolveSubdomain(host)).toBe(expected));

// ── Local development ─────────────────────────────────────────────────────────
describe('local development', () => {
  eq('localhost',  'gosuas');
  eq('127.0.0.1',  'gosuas');
  eq('[::1]',      'gosuas');   // browser wraps IPv6 in brackets
  eq('::1',        'gosuas');   // bare IPv6 loopback
});

// ── Legacy gosuas.com domain ──────────────────────────────────────────────────
describe('legacy gosuas.com', () => {
  eq('gosuas.com',         'gosuas');
  eq('www.gosuas.com',     'gosuas');
  eq('gosuas.gosuas.com',  'gosuas');
  eq('admin.gosuas.com',   'gosuas');  // still gosuas, not 'admin'
});

// ── Platform root → landing page ─────────────────────────────────────────────
describe('platform root domains', () => {
  eq('theshopclaude.com',      'www');
  eq('www.theshopclaude.com',  'www');
});

// ── Platform tenants ──────────────────────────────────────────────────────────
describe('platform tenant subdomains', () => {
  eq('gosuas.theshopclaude.com',  'gosuas');
  eq('shop1.theshopclaude.com',   'shop1');
  eq('my-store.theshopclaude.com','my-store');
  eq('admin.theshopclaude.com',   'admin');   // superadmin panel route
  eq('a1b2.theshopclaude.com',    'a1b2');    // alphanumeric
});

// ── Case normalisation ────────────────────────────────────────────────────────
describe('uppercase hostnames are normalised', () => {
  eq('GOSUAS.THESHOPCLAUDE.COM',     'gosuas');
  eq('SHOP1.THESHOPCLAUDE.COM',      'shop1');
  eq('THESHOPCLAUDE.COM',            'www');
  eq('WWW.THESHOPCLAUDE.COM',        'www');
  eq('LOCALHOST',                    'gosuas');
  eq('GOSUAS.COM',                   'gosuas');
  eq('ADMIN.GOSUAS.COM',             'gosuas');
});

// ── Trailing-dot hostnames ────────────────────────────────────────────────────
describe('trailing-dot (valid DNS form) is stripped', () => {
  eq('gosuas.theshopclaude.com.',  'gosuas');
  eq('theshopclaude.com.',         'www');
  eq('www.theshopclaude.com.',     'www');
  eq('gosuas.com.',                'gosuas');
  eq('localhost.',                 'gosuas');
});

// ── Localhost with port in URL ────────────────────────────────────────────────
// window.location.hostname never includes the port; these are hostname-only inputs
describe('localhost variants (hostname only, no port)', () => {
  // Port is stripped by the browser before hostname is exposed — hostname is always portless
  eq('localhost', 'gosuas');
  eq('127.0.0.1', 'gosuas');
});

// ── Unsupported / unknown domains ────────────────────────────────────────────
describe('unsupported domains fall back to landing page', () => {
  eq('example.com',               'www');
  eq('www.example.com',           'www');
  eq('shop1.example.com',         'www');  // NOT shop1 — wrong domain
  eq('shop1.myplatform.com',      'www');
  eq('randomdomain.io',           'www');
});

// ── Malformed hostnames ───────────────────────────────────────────────────────
describe('malformed hostnames are handled safely', () => {
  eq('',               'www');   // empty string
  eq('.',              'www');   // just a dot
  eq('..',             'www');   // double dot
  // @ts-expect-error - testing JS runtime safety
  expect(resolveSubdomain(null)).toBe('www');
  // @ts-expect-error
  expect(resolveSubdomain(undefined)).toBe('www');
  // @ts-expect-error
  expect(resolveSubdomain(42)).toBe('www');
});

// ── Malicious / similar-looking domains ──────────────────────────────────────
describe('malicious / lookalike domains are rejected', () => {
  // Path-traversal style or hostname injection attempts
  eq('shop1.theshopclaude.com.evil.com',        'www'); // evil.com suffix
  eq('theshopclaude.com.attacker.io',            'www');
  eq('gosuas.theshopclaude.com.evil.com',        'www');

  // Lookalike / homoglyph domains
  eq('shop1.thesh0pclaude.com',   'www');  // zero instead of o
  eq('shop1.theshopclaude.co',    'www');  // .co not .com
  eq('shop1.theshopclaude.net',   'www');

  // Multi-label subdomain injection (sub contains a dot)
  eq('bad.shop.theshopclaude.com', 'www'); // 'bad.shop' is not a valid single-label subdomain

  // Numeric-only or hyphen-edge subdomains
  eq('-bad.theshopclaude.com',     'www'); // starts with hyphen — invalid
  eq('bad-.theshopclaude.com',     'www'); // ends with hyphen — fails SUBDOMAIN_RE (only a-z0-9 at start)
  // Note: 'shop-1.theshopclaude.com' IS valid (hyphen in middle is OK)
  eq('shop-1.theshopclaude.com',   'shop-1');
});

// ── Backward-compatibility matrix ────────────────────────────────────────────
describe('backward-compatibility (all expected values from spec)', () => {
  eq('localhost',                   'gosuas');
  eq('127.0.0.1',                   'gosuas');
  eq('gosuas.com',                  'gosuas');
  eq('www.gosuas.com',              'gosuas');
  eq('gosuas.gosuas.com',           'gosuas');
  eq('gosuas.theshopclaude.com',    'gosuas');
  eq('shop1.theshopclaude.com',     'shop1');
  eq('theshopclaude.com',           'www');
  eq('www.theshopclaude.com',       'www');
});
// ── Local-dev tenant override (?tenant=<sub>, loopback hosts only) ───────────
describe('isLoopbackHost', () => {
  it('accepts loopback hosts', () => {
    ['localhost', '127.0.0.1', '[::1]', '::1', 'LOCALHOST'].forEach(h =>
      expect(isLoopbackHost(h)).toBe(true));
  });
  it('rejects real domains', () => {
    ['theshopclaude.com', 'kakli.theshopclaude.com', 'localhost.evil.com', ''].forEach(h =>
      expect(isLoopbackHost(h)).toBe(false));
  });
});

describe('resolveDevTenant', () => {
  it('no param, nothing stored → null', () =>
    expect(resolveDevTenant('', null)).toEqual({ tenant: null, changed: false }));
  it('no param → keeps stored tenant', () =>
    expect(resolveDevTenant('', 'kakli')).toEqual({ tenant: 'kakli', changed: false }));
  it('new param → selects and flags change', () =>
    expect(resolveDevTenant('?tenant=Kakli', null)).toEqual({ tenant: 'kakli', changed: true }));
  it('same param as stored → no change', () =>
    expect(resolveDevTenant('?tenant=kakli', 'kakli')).toEqual({ tenant: 'kakli', changed: false }));
  it('empty param clears the override', () =>
    expect(resolveDevTenant('?tenant=', 'kakli')).toEqual({ tenant: null, changed: true }));
  it('invalid param is rejected', () =>
    expect(resolveDevTenant('?tenant=../evil', 'kakli')).toEqual({ tenant: null, changed: true }));
  it('admin is allowed (super-admin console)', () =>
    expect(resolveDevTenant('?tenant=admin', null).tenant).toBe('admin'));
});
