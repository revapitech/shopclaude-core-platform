import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import axios from 'axios';
import './style.css';
import LandingPage from './pages/LandingPage';

const API     = import.meta.env.VITE_API_URL     ?? 'http://localhost:8080/gosuas-core/api';
const BACKEND = import.meta.env.VITE_BACKEND_URL ?? API.replace(/\/api$/, '');

function getSubdomain() {
  const host = window.location.hostname;
  if (host === 'localhost' || host === '127.0.0.1') return 'gosuas';
  // Any *.gosuas.com or gosuas.com domain → always gosuas tenant (backward compat)
  if (host === 'gosuas.com' || host.endsWith('.gosuas.com')) return 'gosuas';
  const parts = host.split('.');
  if (parts.length >= 3) return parts[0]; // e.g. "gosuas" from "gosuas.theshopclaude.com"
  return 'www'; // theshopclaude.com or www.theshopclaude.com → landing page
}

function maxPhotosForPlan(plan) {
  return plan === 'PRO' ? 6 : 2; // STARTER (₹999) → 2, PRO (₹1,699) → 6, FREE defaults to 2
}

// Attach JWT to every axios request
axios.interceptors.request.use(config => {
  const token = localStorage.getItem('gosuas_token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

// On 401, clear token and reload to login screen.
// Guards to prevent false-positive logouts:
//   1. File uploads — errors handled by the calling try/catch for a meaningful toast.
//   2. Auth endpoints (/auth/) — a wrong-password login returns 401 legitimately; that
//      must never clear an already-stored session token.
//   3. Requests sent WITHOUT an Authorization header — if the request was unauthenticated
//      to begin with, a 401 response cannot indicate an expired session.
axios.interceptors.response.use(
  res => res,
  err => {
    if (err.response?.status === 401) {
      const isFileUpload   = err.config?.headers?.['Content-Type']?.includes('multipart/form-data');
      const isAuthEndpoint = (err.config?.url || '').includes('/auth/');
      const hadAuthHeader  = !!err.config?.headers?.['Authorization'];
      if (!isFileUpload && !isAuthEndpoint && hadAuthHeader) {
        const token = localStorage.getItem('gosuas_token');
        if (token) { localStorage.removeItem('gosuas_token'); window.location.reload(); }
      }
    }
    return Promise.reject(err);
  }
);

// Shop admin pages that can be opened directly via the URL hash (/#returns etc.)
const ADMIN_PAGES = ['home', 'reports', 'customers', 'orders', 'rental', 'alerts', 'plan', 'returns', 'damage', 'expenses', 'print-labels', 'pdf-store'];

const FIELD_LABELS = {
  name: 'Product Name',
  sku: 'SKU Code',
  purchasePrice: 'Purchase Price (₹)',
  sellingPrice: 'Selling Price (₹)',
  mrp: 'MRP (₹)',
  stockQty: 'Stock Quantity',
  depositAmount: 'Deposit Amount (₹)',
  rentAmount: 'Rental Amount (₹)',
};

// Categories are now fully tenant-customizable — no hardcoded list

const COLOURS = [
  'Black','Blue','Beige','Brown','Cream','Gold','Green',
  'Lavender','Light Blue','Maroon','Multicolor','Orange',
  'Pink','Purple','Rani Pink','Red','Rose Gold','Royal Blue',
  'Silver','Sky Blue','White','Yellow',
];

const COMMON_SIZES = ['Free Size','XS','S','M','L','XL','XXL','2.0','2.1','2.2','2.4','2.6','2.8','2.10','2.12'];
const PRESET_ATTRS = {
  color:   { match: /colou?r/i, options: ['Black','White','Red','Blue','Green','Yellow','Orange','Pink','Purple','Brown','Beige','Cream','Gold','Silver','Maroon','Lavender','Multicolor'] },
  size:    { match: /^size$/i,  options: COMMON_SIZES },
  material:{ match: /material/i,options: ['Gold','Silver','Platinum','Rose Gold','Copper','Brass','Fabric','Leather','Plastic','Stainless Steel'] },
  pattern: { match: /pattern/i, options: ['Solid','Striped','Checked','Printed','Floral','Geometric','Plain'] },
  genre:   { match: /genre/i,   options: ['Fiction','Non-Fiction','Mystery','Sci-Fi','Romance','Biography','Self-Help','History','Children','Comics'] },
};

function cartesian(arrays) {
  return arrays.reduce((acc, arr) => acc.flatMap(x => arr.map(y => [...x, y])), [[]]);
}

function variantLabel(p) {
  if (p.variantAttrs) {
    try { return Object.values(JSON.parse(p.variantAttrs)).filter(Boolean).join(' · '); } catch {}
  }
  return [p.color, p.size].filter(Boolean).join(' · ');
}

// Turns ad-hoc {name, value} variant rows into the payload shape the backend expects.
// Colour/Size rows also populate the dedicated columns (barcode labels, sorting, etc.)
// while every row — including custom variant types — goes into variantAttrs for display.
function variantsToPayload(variants) {
  const attrsObj = {};
  let color = null, size = null;
  (variants || []).forEach(v => {
    const name = (v.name || '').trim();
    const value = (v.value || '').trim();
    if (!name || !value) return;
    attrsObj[name] = value;
    const lname = name.toLowerCase();
    if (lname === 'colour' || lname === 'color') color = value;
    if (lname === 'size') size = value;
  });
  return { color, size, variantAttrs: Object.keys(attrsObj).length ? JSON.stringify(attrsObj) : null };
}

// A colour variant's own photo is IN ADDITION to the shared/general product photos, not a
// replacement — e.g. Black gets its 1 dedicated photo plus the up-to-2/6 general photos.
function combineImages(colourUrl, generalUrl) {
  const generalUrls = generalUrl ? generalUrl.split(',').filter(Boolean) : [];
  const all = colourUrl ? [colourUrl, ...generalUrls] : generalUrls;
  return all.length ? all.join(',') : null;
}

// Colour-variant siblings share a SKU like "RB4" / "RB4-BLU" / "RB4-BLK" — strip the trailing
// "-XXX" variant suffix to find the family a product belongs to.
function baseSkuOf(sku) {
  const m = (sku || '').match(/^(.+)-([A-Za-z]{2,4})$/);
  return m ? m[1] : (sku || '');
}

const COLOR_ABBR = {
  'Red':'RED','Blue':'BLU','Green':'GRN','Orange':'ORG','Sky Blue':'SKY','Sky blue':'SKY',
  'Yellow':'YLW','Royal Blue':'ROY','Rani Pink':'RNI','Black':'BLK','White':'WHT',
  'Gold':'GLD','Silver':'SLV','Rose Gold':'RSG','Maroon':'MRN','Purple':'PRP',
  'Pink':'PNK','Beige':'BGE','Brown':'BRN','Lavender':'LVD','Cream':'CRM',
  'Multicolor':'MLT','Light Blue':'LBL',
};

const COLOR_CSS = {
  'Black':'#111','Blue':'#1565c0','Beige':'#d7ccc8','Brown':'#5d4037',
  'Cream':'#fce4ec','Gold':'#D4A017','Green':'#2e7d32','Lavender':'#9575cd',
  'Light Blue':'#4fc3f7','Maroon':'#880e4f','Orange':'#e65100','Pink':'#f48fb1',
  'Purple':'#6a1b9a','Rani Pink':'#e91e8c','Red':'#c62828','Rose Gold':'#b76e79',
  'Royal Blue':'#283593','Silver':'#90a4ae','Sky Blue':'#0288d1','Sky blue':'#0288d1',
  'White':'#f5f5f5','Yellow':'#f9a825',
  'Multicolor':'linear-gradient(135deg,#e53935 0%,#f9a825 25%,#43a047 50%,#1565c0 75%,#6a1b9a 100%)',
};

const COLOR_PRESETS = Object.keys(COLOR_CSS);
const SIZE_PRESETS = ['XS', 'S', 'M', 'L', 'XL', 'XXL', 'Free Size'];

const STICKER_TYPES = [
  { id: 'butterfly',  label: 'Butterfly',       size: '75 × 24 mm', w: '75mm', h: '24mm' },
  { id: 'two-row',    label: '2-Row Sticker',    size: '38 × 25 mm', w: '38mm', h: '25mm' },
  { id: 'three-row',  label: '3-Row Sticker',    size: '30 × 20 mm', w: '30mm', h: '20mm' },
  { id: 'four-row',   label: '4-Row Sticker',    size: '20 × 15 mm', w: '20mm', h: '15mm' },
  { id: 'single-row', label: 'Single Row',       size: '50 × 15 mm', w: '50mm', h: '15mm' },
];

// CATEGORY_STICKER removed — sticker type defaults to 'two-row'

function ChipGroup({ label, options, selected, onToggle, onSelectAll, onClear }) {
  const [customVal, setCustomVal] = useState('');
  const addCustom = () => {
    const v = customVal.trim();
    if (v) { onToggle(v); setCustomVal(''); }
  };
  const customSelected = selected.filter(s => !options.includes(s));
  return (
    <div className="chip-section">
      <div className="chip-header">
        <span className="chip-label">{label}</span>
        <button type="button" className="chip-action" onClick={onSelectAll}>All</button>
        <button type="button" className="chip-action chip-clear" onClick={onClear}>Clear</button>
      </div>
      <div className="chip-group">
        {options.map(o => (
          <button key={o} type="button"
            className={`chip ${selected.includes(o) ? 'chip-on' : ''}`}
            onClick={() => onToggle(o)}>{o}</button>
        ))}
        {customSelected.map(o => (
          <button key={o} type="button" className="chip chip-on chip-custom"
            onClick={() => onToggle(o)}>{o} ×</button>
        ))}
      </div>
      <div className="chip-custom-row">
        <input className="chip-custom-inp" placeholder={`Add custom ${label.toLowerCase()}…`}
          value={customVal} onChange={e => setCustomVal(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addCustom(); } }} />
        <button type="button" className="chip-custom-add" onClick={addCustom}>+ Add</button>
      </div>
    </div>
  );
}

/* Single-value color or size picker with presets + custom input */
function ColorSizeInput({ label, presets, value, onChange, isColor }) {
  const [customVal, setCustomVal] = useState('');
  const addCustom = () => {
    const v = customVal.trim();
    if (v) { onChange(v); setCustomVal(''); }
  };
  return (
    <div className="csf-wrap">
      <div className="csf-label">{label}</div>
      <div className="csf-chips">
        <button type="button" className={`csf-chip ${!value ? 'csf-chip-on' : ''}`}
          onClick={() => onChange('')}>None</button>
        {presets.map(p => (
          <button key={p} type="button"
            className={`csf-chip ${value === p ? 'csf-chip-on' : ''}`}
            onClick={() => onChange(value === p ? '' : p)}>
            {isColor && COLOR_CSS[p] && (
              <span className="csf-swatch" style={{background: COLOR_CSS[p]}} />
            )}
            {p}
          </button>
        ))}
        {value && !presets.includes(value) && (
          <button type="button" className="csf-chip csf-chip-on csf-chip-custom"
            onClick={() => onChange('')}>
            {isColor && <span className="csf-swatch" style={{background: COLOR_CSS[value] || '#ccc'}} />}
            {value} ×
          </button>
        )}
      </div>
      <div className="csf-custom-row">
        <input className="csf-custom-inp"
          placeholder={`Or type custom ${label.toLowerCase()}…`}
          value={customVal} onChange={e => setCustomVal(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addCustom(); } }} />
        <button type="button" className="csf-custom-add" onClick={addCustom}>+ Add</button>
      </div>
    </div>
  );
}

/* ── Shared animated login slider ── */
function LoginSlider({ slides }) {
  const [active, setActive] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setActive(i => (i + 1) % slides.length), 3400);
    return () => clearInterval(t);
  }, [slides.length]);
  const s = slides[active];
  return (
    <div style={{flex:1,display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',textAlign:'center',padding:'0 40px',gap:0}}>
      <div key={active} style={{animation:'lsSlideIn 0.5s ease forwards'}}>
        {s.art}
        <div style={{fontSize:22,fontWeight:800,color:'#fff',letterSpacing:'-0.4px',margin:'22px 0 10px'}}>{s.title}</div>
        <div style={{fontSize:14,color:'rgba(255,255,255,0.55)',lineHeight:1.65,maxWidth:300,margin:'0 auto'}}>{s.sub}</div>
      </div>
      <div style={{display:'flex',gap:8,marginTop:28}}>
        {slides.map((_,i) => (
          <button key={i} onClick={() => setActive(i)}
            style={{width:i===active?24:8,height:8,borderRadius:4,background:i===active?'#F5971E':'rgba(255,255,255,0.22)',border:'none',cursor:'pointer',transition:'all 0.35s',padding:0}} />
        ))}
      </div>
      <style>{`@keyframes lsSlideIn{from{opacity:0;transform:translateY(14px)}to{opacity:1;transform:translateY(0)}}
      @keyframes lsCardIn{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:translateY(0)}}
      @keyframes lsGlow{0%,100%{opacity:0.85}50%{opacity:1}}`}</style>
    </div>
  );
}

/* Slide illustration sets */
const SHOP_SLIDES = [
  {
    title: 'Instant POS Billing',
    sub: 'Generate professional invoices in seconds, accept cash, UPI & card.',
    art: (
      <svg viewBox="0 0 240 196" width="276" height="225">
        <rect x="60" y="8" width="120" height="178" rx="8" fill="rgba(255,255,255,0.05)" stroke="rgba(255,255,255,0.1)" strokeWidth="1"/>
        <rect x="60" y="8" width="120" height="36" rx="8" fill="#F5971E" opacity="0.88"/>
        <text x="120" y="31" textAnchor="middle" fill="#fff" fontSize="11" fontWeight="700" fontFamily="Arial">INVOICE #1042</text>
        {[['Kurti (2×)','₹2,598'],['Sandals (1×)','₹1,299'],['Dupatta (3×)','₹2,097']].map(([item,amt],i)=>(
          <g key={i}>
            <text x="72" y={60+i*20} fill="rgba(255,255,255,0.65)" fontSize="9" fontFamily="Arial">{item}</text>
            <text x="168" y={60+i*20} textAnchor="end" fill="rgba(255,255,255,0.65)" fontSize="9" fontFamily="Arial">{amt}</text>
            <line x1="72" y1={64+i*20} x2="168" y2={64+i*20} stroke="rgba(255,255,255,0.07)" strokeWidth="0.5"/>
          </g>
        ))}
        <line x1="64" y1="122" x2="176" y2="122" stroke="rgba(255,255,255,0.18)" strokeWidth="0.6" strokeDasharray="4,3"/>
        <text x="72" y="138" fill="rgba(255,255,255,0.45)" fontSize="9" fontFamily="Arial">Total</text>
        <text x="168" y="138" textAnchor="end" fill="#F5971E" fontSize="14" fontWeight="800" fontFamily="Arial">₹5,994</text>
        <rect x="78" y="150" width="84" height="26" rx="5" fill="rgba(34,197,94,0.12)" stroke="rgba(34,197,94,0.4)" strokeWidth="1.5"/>
        <text x="120" y="167" textAnchor="middle" fill="#22c55e" fontSize="11" fontWeight="700" fontFamily="Arial">✓ PAID</text>
      </svg>
    ),
  },
  {
    title: 'Smart Inventory',
    sub: 'Track every product in real time. Get alerts before you run out of stock.',
    art: (
      <svg viewBox="0 0 240 188" width="276" height="216">
        {[['👟',32],['👗',15],['💍',8],['📱',24],['🎒',41],['👠',6]].map(([em,stock],i)=>{
          const x=20+(i%3)*74, y=6+Math.floor(i/2)*88, low=stock<10;
          return (
            <g key={i}>
              <rect x={x} y={y} width="64" height="76" rx="7" fill="rgba(255,255,255,0.05)" stroke={low?'rgba(239,68,68,0.45)':'rgba(255,255,255,0.1)'} strokeWidth="1"/>
              <text x={x+32} y={y+30} textAnchor="middle" fontSize="20">{em}</text>
              <text x={x+32} y={y+48} textAnchor="middle" fill="rgba(255,255,255,0.6)" fontSize="8.5" fontFamily="Arial">Qty: {stock}</text>
              {low
                ? <><rect x={x+10} y={y+56} width="44" height="12" rx="3" fill="rgba(239,68,68,0.18)"/><text x={x+32} y={y+65} textAnchor="middle" fill="#f87171" fontSize="7.5" fontWeight="700" fontFamily="Arial">Low Stock!</text></>
                : <><rect x={x+10} y={y+58} width={(stock/45)*44} height="6" rx="3" fill="rgba(34,197,94,0.5)"/><rect x={x+10} y={y+58} width="44" height="6" rx="3" fill="rgba(255,255,255,0.06)"/></>
              }
            </g>
          );
        })}
      </svg>
    ),
  },
  {
    title: 'Your Online Store',
    sub: 'Launch your storefront online. Customers shop 24/7 from anywhere in India.',
    art: (
      <svg viewBox="0 0 240 196" width="276" height="225">
        <rect x="68" y="4" width="104" height="186" rx="16" fill="rgba(255,255,255,0.05)" stroke="rgba(255,255,255,0.14)" strokeWidth="1.5"/>
        <rect x="100" y="4" width="40" height="7" rx="3.5" fill="rgba(255,255,255,0.1)"/>
        <rect x="68" y="16" width="104" height="30" fill="#F5971E" opacity="0.85" style={{animation:'lsGlow 2.4s ease-in-out infinite'}}/>
        <text x="120" y="35" textAnchor="middle" fill="#fff" fontSize="10" fontWeight="700" fontFamily="Arial">🏪 My Store</text>
        {[['👟','₹2,499'],['👗','₹1,299'],['💍','₹4,999'],['🎒','₹1,999']].map(([em,pr],i)=>{
          const lx=i%2===0?72:126, ly=54+Math.floor(i/2)*66;
          return (
            <g key={i} style={{animation:'lsCardIn 0.5s ease both', animationDelay:`${0.15+i*0.1}s`}}>
              <rect x={lx} y={ly} width="42" height="56" rx="6" fill="rgba(255,255,255,0.04)" stroke="rgba(255,255,255,0.09)" strokeWidth="1"/>
              <text x={lx+21} y={ly+24} textAnchor="middle" fontSize="16">{em}</text>
              <text x={lx+21} y={ly+38} textAnchor="middle" fill="#F5971E" fontSize="8" fontWeight="700" fontFamily="Arial">{pr}</text>
              <rect x={lx+5} y={ly+42} width="32" height="9" rx="3" fill="rgba(245,151,30,0.7)"/>
              <text x={lx+21} y={ly+49.5} textAnchor="middle" fill="#fff" fontSize="6" fontWeight="700" fontFamily="Arial">Add to Cart</text>
            </g>
          );
        })}
      </svg>
    ),
  },
  {
    title: 'Sales Analytics',
    sub: 'See what\'s selling, track revenue and grow your business with data.',
    art: (
      <svg viewBox="0 0 240 196" width="276" height="225">
        <text x="20" y="24" fill="rgba(255,255,255,0.45)" fontSize="10" fontFamily="Arial">Monthly Revenue</text>
        <text x="20" y="50" fill="#fff" fontSize="24" fontWeight="900" fontFamily="Arial">₹1,24,500</text>
        <text x="148" y="50" fill="#22c55e" fontSize="12" fontWeight="700" fontFamily="Arial">↑ 23%</text>
        {[35,55,42,78,60,90,85].map((h,i)=>(
          <g key={i}>
            <rect x={18+i*31} y={162-h} width="22" height={h} rx="3" fill={i===6?'#F5971E':'rgba(245,151,30,0.32)'}/>
            <text x={29+i*31} y="178" textAnchor="middle" fill="rgba(255,255,255,0.35)" fontSize="8" fontFamily="Arial">{['J','F','M','A','M','J','J'][i]}</text>
          </g>
        ))}
        <line x1="14" y1="162" x2="226" y2="162" stroke="rgba(255,255,255,0.08)" strokeWidth="0.6"/>
      </svg>
    ),
  },
];

const ADMIN_SLIDES = [
  {
    title: 'All Tenants, One View',
    sub: 'Monitor every store across the platform — subscriptions, status and activity.',
    art: (
      <svg viewBox="0 0 240 196" width="240" height="196">
        {[['Kakli Sandal store','PRO','#16a34a'],['Priya Jewels','STARTER','#d97706'],['TechMart','TRIAL','#6366f1']].map(([name,plan,col],i)=>(
          <g key={i}>
            <rect x="14" y={10+i*60} width="212" height="50" rx="9" fill="rgba(255,255,255,0.05)" stroke="rgba(255,255,255,0.09)" strokeWidth="1"/>
            <circle cx="42" cy={35+i*60} r="15" fill={col+'22'} stroke={col} strokeWidth="1.5"/>
            <text x="42" y={40+i*60} textAnchor="middle" fontSize="13">🏪</text>
            <text x="66" y={31+i*60} fill="#fff" fontSize="11" fontWeight="700" fontFamily="Arial">{name}</text>
            <text x="66" y={47+i*60} fill="rgba(255,255,255,0.4)" fontSize="8.5" fontFamily="Arial">ACTIVE · theshopclaude.com</text>
            <rect x="174" y={27+i*60} width="40" height="16" rx="8" fill={col+'28'}/>
            <text x="194" y={38+i*60} textAnchor="middle" fill={col} fontSize="8" fontWeight="700" fontFamily="Arial">{plan}</text>
          </g>
        ))}
      </svg>
    ),
  },
  {
    title: 'Revenue Analytics',
    sub: 'Track subscription revenue, new signups and platform growth at a glance.',
    art: (
      <svg viewBox="0 0 240 196" width="240" height="196">
        <text x="20" y="24" fill="rgba(255,255,255,0.45)" fontSize="10" fontFamily="Arial">Platform Revenue</text>
        <text x="20" y="50" fill="#fff" fontSize="24" fontWeight="900" fontFamily="Arial">₹74,970</text>
        <text x="160" y="50" fill="#22c55e" fontSize="12" fontWeight="700" fontFamily="Arial">↑ 18%</text>
        {[20,38,30,55,42,68,62].map((h,i)=>(
          <g key={i}>
            <rect x={18+i*31} y={162-h} width="22" height={h} rx="3" fill={i===6?'#F5971E':'rgba(245,151,30,0.32)'}/>
            <text x={29+i*31} y="178" textAnchor="middle" fill="rgba(255,255,255,0.35)" fontSize="8" fontFamily="Arial">{['J','F','M','A','M','J','J'][i]}</text>
          </g>
        ))}
        <line x1="14" y1="162" x2="226" y2="162" stroke="rgba(255,255,255,0.08)" strokeWidth="0.6"/>
      </svg>
    ),
  },
  {
    title: 'Platform at a Glance',
    sub: 'Real-time stats across all stores — uptime, billing and store health.',
    art: (
      <svg viewBox="0 0 240 196" width="240" height="196">
        {[['50+','Active Stores','#F5971E'],['₹1Cr+','Monthly Revenue','#22c55e'],['10K+','Bills Generated','#6366f1'],['99.9%','Uptime SLA','#F5971E']].map(([v,l,col],i)=>{
          const x=i%2===0?14:128, y=6+Math.floor(i/2)*92;
          return (
            <g key={i}>
              <rect x={x} y={y} width="98" height="78" rx="10" fill="rgba(255,255,255,0.05)" stroke="rgba(255,255,255,0.09)" strokeWidth="1"/>
              <text x={x+49} y={y+44} textAnchor="middle" fill={col} fontSize="24" fontWeight="900" fontFamily="Arial">{v}</text>
              <text x={x+49} y={y+62} textAnchor="middle" fill="rgba(255,255,255,0.45)" fontSize="9" fontFamily="Arial">{l}</text>
            </g>
          );
        })}
      </svg>
    ),
  },
];

function Login({ onLogin }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [shopInfo, setShopInfo] = useState({ name: '', logoUrl: null });

  useEffect(() => {
    const sub = getSubdomain();
    fetch(`${API}/public/shop-info?subdomain=${sub}`)
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d) setShopInfo(d); })
      .catch(() => {});
  }, []);

  const displayName = shopInfo.name || getSubdomain().replace(/[-_]/g,' ').replace(/\b\w/g,c=>c.toUpperCase());
  const logoSrc = shopInfo.logoUrl ? `${BACKEND}${shopInfo.logoUrl}` : '/logo.png';

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`${API}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password, subdomain: getSubdomain() })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || 'Invalid email or password');
        return;
      }
      onLogin(data.token);
    } catch {
      setError('Could not connect to server. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{minHeight:'100vh',display:'flex',margin:0,padding:0,fontFamily:'Inter,system-ui,sans-serif'}}>
      {/* ── Left: animated slider panel ── */}
      <div style={{flex:1,background:'linear-gradient(145deg,#0A1628 0%,#1E3A5F 55%,#0D2240 100%)',display:'flex',flexDirection:'column',position:'relative',overflow:'hidden'}}>
        {/* Orbs */}
        <div style={{position:'absolute',width:480,height:480,borderRadius:'50%',background:'rgba(245,151,30,0.12)',filter:'blur(100px)',top:-140,right:-80,pointerEvents:'none'}} />
        <div style={{position:'absolute',width:280,height:280,borderRadius:'50%',background:'rgba(99,102,241,0.13)',filter:'blur(80px)',bottom:-70,left:-50,pointerEvents:'none'}} />
        {/* Grid decoration */}
        <svg style={{position:'absolute',bottom:0,right:0,opacity:0.05,pointerEvents:'none'}} width="300" height="300" viewBox="0 0 300 300">
          {[0,1,2,3,4,5,6,7].map(i=><g key={i}><line x1={i*40} y1="0" x2={i*40} y2="300" stroke="#fff" strokeWidth="1"/><line x1="0" y1={i*40} x2="300" y2={i*40} stroke="#fff" strokeWidth="1"/></g>)}
        </svg>

        {/* Brand header */}
        <div style={{display:'flex',alignItems:'center',gap:12,padding:'28px 36px',position:'relative',zIndex:1}}>
          {shopInfo.logoUrl
            ? <img src={logoSrc} alt="logo"
                style={{width:38,height:38,objectFit:'contain',borderRadius:9,background:'rgba(255,255,255,0.1)',padding:4,border:'1px solid rgba(255,255,255,0.15)'}}
                onError={e=>{e.currentTarget.onerror=null;e.currentTarget.style.display='none';}} />
            : <div style={{width:38,height:38,borderRadius:9,background:'rgba(245,151,30,0.18)',border:'1.5px solid rgba(245,151,30,0.35)',display:'flex',alignItems:'center',justifyContent:'center',fontSize:18}}>🏪</div>
          }
          <span style={{fontSize:16,fontWeight:800,color:'#fff',letterSpacing:'-0.3px'}}>{displayName}</span>
        </div>

        {/* Slider */}
        <div style={{flex:1,position:'relative',zIndex:1}}>
          <LoginSlider slides={SHOP_SLIDES} />
        </div>
      </div>

      {/* ── Right: login form ── */}
      <div style={{width:460,background:'#fff',display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',padding:'60px 52px'}}>
        <div style={{width:'100%',maxWidth:340}}>
          <div style={{marginBottom:32}}>
            <div style={{fontSize:26,fontWeight:800,color:'#0f172a',letterSpacing:'-0.5px',marginBottom:8}}>Welcome back</div>
            <div style={{fontSize:14,color:'#6b7280'}}>Sign in to manage your store</div>
          </div>
          <form onSubmit={handleSubmit}>
            <div style={{marginBottom:16}}>
              <label style={{display:'block',fontSize:13,fontWeight:600,color:'#374151',marginBottom:6}}>Email</label>
              <input type="email" placeholder="your@email.com" value={email}
                onChange={e=>{setEmail(e.target.value);setError('');}} autoFocus
                style={{display:'block',width:'100%',padding:'12px 14px',border:'1.5px solid #e5e7eb',borderRadius:10,fontSize:14,boxSizing:'border-box',outline:'none',color:'#111'}}
                onFocus={e=>e.target.style.borderColor='#F5971E'} onBlur={e=>e.target.style.borderColor='#e5e7eb'} />
            </div>
            <div style={{marginBottom:24}}>
              <label style={{display:'block',fontSize:13,fontWeight:600,color:'#374151',marginBottom:6}}>Password</label>
              <div style={{position:'relative'}}>
                <input type={showPw?'text':'password'} placeholder="••••••••" value={password}
                  onChange={e=>{setPassword(e.target.value);setError('');}}
                  style={{display:'block',width:'100%',padding:'12px 44px 12px 14px',border:'1.5px solid #e5e7eb',borderRadius:10,fontSize:14,boxSizing:'border-box',outline:'none',color:'#111'}}
                  onFocus={e=>e.target.style.borderColor='#F5971E'} onBlur={e=>e.target.style.borderColor='#e5e7eb'} />
                <button type="button" onClick={()=>setShowPw(p=>!p)}
                  style={{position:'absolute',right:12,top:'50%',transform:'translateY(-50%)',background:'none',border:'none',cursor:'pointer',fontSize:18,color:'#9ca3af',lineHeight:1,padding:0}}>
                  {showPw?'🙈':'👁️'}
                </button>
              </div>
            </div>
            {error && <div style={{marginBottom:16,padding:'10px 14px',background:'#fef2f2',border:'1px solid #fecaca',borderRadius:8,fontSize:13,color:'#dc2626',fontWeight:600}}>{error}</div>}
            <button type="submit" disabled={loading}
              style={{width:'100%',padding:'13px',background:'#F5971E',color:'#fff',border:'none',borderRadius:10,fontSize:15,fontWeight:700,cursor:loading?'not-allowed':'pointer',opacity:loading?0.7:1,letterSpacing:'0.2px'}}>
              {loading ? 'Signing in…' : 'Login →'}
            </button>
          </form>
          <div style={{marginTop:28,textAlign:'center',fontSize:12,color:'#9ca3af'}}>
            Powered by <span style={{color:'#1E3A5F',fontWeight:700}}>theshopclaude</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function fmt(val) {
  const n = Number(val);
  return isNaN(n) ? '0.00' : n.toFixed(2);
}

// Exports rows to a CSV file (opens directly in Excel/Sheets — no extra library needed).
// columns: [{ label, key }] where key is a field name or a (row) => value function.
function exportToCsv(filename, rows, columns) {
  const escape = (val) => {
    const s = val === null || val === undefined ? '' : String(val);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const header = columns.map(c => escape(c.label)).join(',');
  const lines = rows.map((row, i) => columns.map(c => escape(typeof c.key === 'function' ? c.key(row, i) : row[c.key])).join(','));
  const csv = [header, ...lines].join('\r\n');
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function printBillReceipt(bill, shopName = 'GOSUAS') {
  // Use hidden iframe (same origin) so Chrome remembers the last printer selection
  let iframe = document.getElementById('__receipt_print_frame__');
  if (!iframe) {
    iframe = document.createElement('iframe');
    iframe.id = '__receipt_print_frame__';
    iframe.style.cssText = 'position:fixed;width:0;height:0;border:0;top:0;left:0;opacity:0;pointer-events:none;';
    document.body.appendChild(iframe);
  }

  const rawDate = bill.billDate;
  const billDateObj = rawDate
    ? new Date(rawDate.endsWith('Z') ? rawDate : rawDate + 'Z')
    : new Date();
  const date = billDateObj.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }) + ' IST';
  const itemRows = (bill.items || []).map(item => `
    <tr>
      <td>${item.productName || '-'}</td>
      <td style="text-align:center">${item.quantity || 0}</td>
      <td style="text-align:right">₹${fmt(item.unitPrice)}</td>
      <td style="text-align:right">₹${fmt(item.lineTotal)}</td>
    </tr>`).join('');

  const doc = iframe.contentDocument || iframe.contentWindow.document;
  doc.open();
  doc.write(`<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>Receipt - ${bill.billNo || 'N/A'}</title>
  <style>
    @page { size: 80mm auto; margin: 4mm 4mm 8mm 4mm; }
    * { margin:0; padding:0; box-sizing:border-box; }
    body { font-family: 'Courier New', monospace; font-size: 13px; font-weight: bold; width: 72mm; color: #000; }
    h2 { text-align:center; font-size:22px; letter-spacing:3px; font-weight:900; margin-bottom:1mm; }
    .shop-phone { text-align:center; font-size:14px; font-weight:bold; margin:1mm 0 0.5mm; }
    .shop-addr  { text-align:center; font-size:12px; font-weight:bold; margin-bottom:2mm; }
    .sub { text-align:center; font-size:12px; font-weight:bold; margin-bottom:2mm; }
    .dash { border:none; border-top:1px dashed #000; margin:2mm 0; }
    .info-row { display:flex; justify-content:space-between; margin:1.5mm 0; font-size:12px; font-weight:bold; }
    .info-row span:first-child { flex-shrink:0; margin-right:2mm; }
    .info-row span:last-child { text-align:right; }
    table { width:100%; border-collapse:collapse; margin:1mm 0; font-size:12px; font-weight:bold; }
    th { border-bottom:1px solid #000; padding:1.5mm 0; text-align:left; font-size:12px; font-weight:900; }
    th:nth-child(2),th:nth-child(3),th:nth-child(4) { text-align:right; }
    td { padding:1.5mm 0; vertical-align:top; word-break:break-word; font-weight:bold; }
    td:nth-child(2),td:nth-child(3),td:nth-child(4) { text-align:right; white-space:nowrap; }
    td:first-child { padding-right:2mm; }
    .total-row { display:flex; justify-content:space-between; font-size:13px; font-weight:bold; padding:1mm 0; }
    .grand { display:flex; justify-content:space-between; font-weight:900; font-size:16px; border-top:2px solid #000; padding-top:2mm; margin-top:1mm; }
    .status { text-align:center; font-size:14px; font-weight:900; letter-spacing:2px; margin:2mm 0; }
    .footer { text-align:center; font-size:12px; font-weight:bold; margin-top:3mm; line-height:2; }
  </style>
</head>
<body>
  <h2>${shopName}</h2>
  <p class="shop-phone">📞 8078583062</p>
  <p class="shop-addr">OPP CET Sreekaryam</p>
  <p class="sub">Tax Invoice / Receipt</p>
  <div class="dash"></div>
  <div class="info-row"><span>Bill No:</span><span>${bill.billNo || 'N/A'}</span></div>
  <div class="info-row"><span>Date:</span><span>${date}</span></div>
  <div class="info-row"><span>Customer:</span><span>${bill.customerName || 'Walk-in'}</span></div>
  ${bill.paymentMode === 'SPLIT' && bill.payments && bill.payments.length > 0
    ? `<div class="info-row"><span>Payment:</span><span>Split</span></div>` +
      bill.payments.map(p => `<div class="info-row" style="font-size:11px;padding-left:10px"><span>${p.method}</span><span>₹${fmt(p.amount)}</span></div>`).join('')
    : `<div class="info-row"><span>Payment:</span><span>${bill.paymentMode || 'CASH'}</span></div>`}
  <div class="dash"></div>
  <table>
    <thead>
      <tr><th>Item</th><th>Qty</th><th>Rate</th><th>Amt</th></tr>
    </thead>
    <tbody>
      ${itemRows || '<tr><td colspan="4" style="text-align:center;padding:2mm 0;">No items</td></tr>'}
    </tbody>
  </table>
  <div class="dash"></div>
  <div class="total-row"><span>Sub Total</span><span>₹${fmt(bill.subTotal)}</span></div>
  ${Number(bill.discountAmount) > 0 ? `<div class="total-row"><span>Discount</span><span>- ₹${fmt(bill.discountAmount)}</span></div>` : ''}
  ${Number(bill.totalGst) > 0 ? `
  <div class="total-row" style="font-size:11px;color:#555"><span>Taxable Value</span><span>₹${fmt(bill.taxableAmount)}</span></div>
  ${Number(bill.cgst) > 0 ? `<div class="total-row" style="font-size:11px;color:#555"><span>CGST</span><span>₹${fmt(bill.cgst)}</span></div>` : ''}
  ${Number(bill.sgst) > 0 ? `<div class="total-row" style="font-size:11px;color:#555"><span>SGST</span><span>₹${fmt(bill.sgst)}</span></div>` : ''}
  ${Number(bill.igst) > 0 ? `<div class="total-row" style="font-size:11px;color:#555"><span>IGST</span><span>₹${fmt(bill.igst)}</span></div>` : ''}
  <div class="total-row" style="font-size:11px;color:#555"><span>Total GST</span><span>₹${fmt(bill.totalGst)}</span></div>` : ''}
  <div class="grand"><span>TOTAL</span><span>₹${fmt(bill.grandTotal)}</span></div>
  <div class="dash"></div>
  <p class="status">★ ${bill.paymentStatus || 'PAID'} ★</p>
  <p class="footer">Thank you for shopping!<br>Visit us again 🙏</p>
</body>
</html>`);
  doc.close();

  // Print from same-origin iframe — Chrome will remember the last printer
  setTimeout(() => { iframe.contentWindow.print(); }, 400);
}

function printRentalReceipt(rental, shopName = 'GOSUAS') {
  let iframe = document.getElementById('__rental_receipt_print_frame__');
  if (!iframe) {
    iframe = document.createElement('iframe');
    iframe.id = '__rental_receipt_print_frame__';
    iframe.style.cssText = 'position:fixed;width:0;height:0;border:0;top:0;left:0;opacity:0;pointer-events:none;';
    document.body.appendChild(iframe);
  }

  const rawDate = rental.rentedAt;
  const dateObj = rawDate ? new Date(rawDate.endsWith('Z') ? rawDate : rawDate + 'Z') : new Date();
  const date = dateObj.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }) + ' IST';
  const bookingWindow = rental.bookingDate
    ? (rental.bookingEndDate && rental.bookingEndDate !== rental.bookingDate
        ? `${rental.bookingDate} to ${rental.bookingEndDate}` : rental.bookingDate)
    : '-';
  const advance = Number(rental.advanceAmount || 0);
  const deposit = Number(rental.depositAmount || 0);
  const rent = Number(rental.rentAmount || 0);
  const total = Number(rental.totalAmount != null ? rental.totalAmount : advance + deposit + rent);

  const doc = iframe.contentDocument || iframe.contentWindow.document;
  doc.open();
  doc.write(`<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>Rental Receipt - ${rental.rentalNo || 'N/A'}</title>
  <style>
    @page { size: 80mm auto; margin: 4mm 4mm 8mm 4mm; }
    * { margin:0; padding:0; box-sizing:border-box; }
    body { font-family: 'Courier New', monospace; font-size: 13px; font-weight: bold; width: 72mm; color: #000; }
    h2 { text-align:center; font-size:22px; letter-spacing:3px; font-weight:900; margin-bottom:1mm; }
    .sub { text-align:center; font-size:12px; font-weight:bold; margin-bottom:2mm; }
    .dash { border:none; border-top:1px dashed #000; margin:2mm 0; }
    .info-row { display:flex; justify-content:space-between; margin:1.5mm 0; font-size:12px; font-weight:bold; }
    .info-row span:first-child { flex-shrink:0; margin-right:2mm; }
    .info-row span:last-child { text-align:right; }
    .total-row { display:flex; justify-content:space-between; font-size:13px; font-weight:bold; padding:1mm 0; }
    .grand { display:flex; justify-content:space-between; font-weight:900; font-size:16px; border-top:2px solid #000; padding-top:2mm; margin-top:1mm; }
    .status { text-align:center; font-size:14px; font-weight:900; letter-spacing:2px; margin:2mm 0; }
    .footer { text-align:center; font-size:12px; font-weight:bold; margin-top:3mm; line-height:2; }
  </style>
</head>
<body>
  <h2>${shopName}</h2>
  <p class="sub">Rental Receipt</p>
  <div class="dash"></div>
  <div class="info-row"><span>Rental No:</span><span>${rental.rentalNo || 'N/A'}</span></div>
  <div class="info-row"><span>Date:</span><span>${date}</span></div>
  <div class="info-row"><span>Customer:</span><span>${rental.customerName || 'Walk-in'}</span></div>
  ${rental.customerMobile ? `<div class="info-row"><span>Mobile:</span><span>${rental.customerMobile}</span></div>` : ''}
  <div class="dash"></div>
  <div class="info-row"><span>Product:</span><span>${rental.productName || '-'}</span></div>
  <div class="info-row"><span>Qty:</span><span>${rental.quantity || 1}</span></div>
  <div class="info-row"><span>Booking:</span><span>${bookingWindow}</span></div>
  <div class="dash"></div>
  ${advance > 0 ? `<div class="total-row"><span>Advance</span><span>₹${fmt(advance)}</span></div>` : ''}
  <div class="total-row"><span>Deposit Amount</span><span>₹${fmt(deposit)}</span></div>
  <div class="total-row"><span>Rental Amount</span><span>₹${fmt(rent)}</span></div>
  <div class="grand"><span>TOTAL</span><span>₹${fmt(total)}</span></div>
  <div class="dash"></div>
  <p class="status">★ ${rental.status || 'RENTED'} ★</p>
  <p class="footer">Deposit refundable on return of item in good condition.<br>Thank you!</p>
</body>
</html>`);
  doc.close();

  setTimeout(() => { iframe.contentWindow.print(); }, 400);
}

function printRentalReturnReceipt(rental, shopName = 'GOSUAS') {
  let iframe = document.getElementById('__rental_return_print_frame__');
  if (!iframe) {
    iframe = document.createElement('iframe');
    iframe.id = '__rental_return_print_frame__';
    iframe.style.cssText = 'position:fixed;width:0;height:0;border:0;top:0;left:0;opacity:0;pointer-events:none;';
    document.body.appendChild(iframe);
  }

  const rawDate = rental.returnedAt;
  const dateObj = rawDate ? new Date(rawDate.endsWith('Z') ? rawDate : rawDate + 'Z') : new Date();
  const date = dateObj.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }) + ' IST';
  const deposit = Number(rental.depositAmount || 0);
  const deduction = Number(rental.deductionAmount || 0);
  const refund = Number(rental.refundAmount != null ? rental.refundAmount : deposit - deduction);

  const doc = iframe.contentDocument || iframe.contentWindow.document;
  doc.open();
  doc.write(`<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>Return Receipt - ${rental.rentalNo || 'N/A'}</title>
  <style>
    @page { size: 80mm auto; margin: 4mm 4mm 8mm 4mm; }
    * { margin:0; padding:0; box-sizing:border-box; }
    body { font-family: 'Courier New', monospace; font-size: 13px; font-weight: bold; width: 72mm; color: #000; }
    h2 { text-align:center; font-size:22px; letter-spacing:3px; font-weight:900; margin-bottom:1mm; }
    .sub { text-align:center; font-size:12px; font-weight:bold; margin-bottom:2mm; }
    .dash { border:none; border-top:1px dashed #000; margin:2mm 0; }
    .info-row { display:flex; justify-content:space-between; margin:1.5mm 0; font-size:12px; font-weight:bold; }
    .info-row span:first-child { flex-shrink:0; margin-right:2mm; }
    .info-row span:last-child { text-align:right; }
    .total-row { display:flex; justify-content:space-between; font-size:13px; font-weight:bold; padding:1mm 0; }
    .grand { display:flex; justify-content:space-between; font-weight:900; font-size:16px; border-top:2px solid #000; padding-top:2mm; margin-top:1mm; }
    .footer { text-align:center; font-size:12px; font-weight:bold; margin-top:3mm; line-height:2; }
  </style>
</head>
<body>
  <h2>${shopName}</h2>
  <p class="sub">Rental Return / Deposit Refund</p>
  <div class="dash"></div>
  <div class="info-row"><span>Rental No:</span><span>${rental.rentalNo || 'N/A'}</span></div>
  <div class="info-row"><span>Return Date:</span><span>${date}</span></div>
  <div class="info-row"><span>Customer:</span><span>${rental.customerName || 'Walk-in'}</span></div>
  <div class="info-row"><span>Product:</span><span>${rental.productName || '-'}</span></div>
  <div class="dash"></div>
  <div class="total-row"><span>Deposit Collected</span><span>₹${fmt(deposit)}</span></div>
  ${deduction > 0 ? `<div class="total-row"><span>Damage Deduction</span><span>- ₹${fmt(deduction)}</span></div>` : ''}
  <div class="grand"><span>REFUNDED</span><span>₹${fmt(refund)}</span></div>
  <div class="dash"></div>
  ${rental.returnNotes ? `<p class="footer">Note: ${rental.returnNotes}</p>` : ''}
  <p class="footer">Thank you!</p>
</body>
</html>`);
  doc.close();

  setTimeout(() => { iframe.contentWindow.print(); }, 400);
}

// Inner HTML for one label cell of a grid sticker type (four-row / three-row / two-row).
// Shared by single-product and bulk printing so multiple products' cells can pack into the same physical rows.
function buildLabelCellHTML(product, stickerType, shopName = 'GOSUAS') {
  const name    = product.name || '';
  const sku     = product.sku  || '';
  const barUrl  = `${API}/barcodes/${product.barcode}`;
  const details = variantLabel(product);
  const F = 'font-family:Arial,sans-serif;font-weight:600;color:#000;';
  const p = product.productType === 'RENTAL'
    ? Number(product.depositAmount || 0) + Number(product.rentAmount || 0)
    : Number(product.sellingPrice);
  const priceStr = p % 1 === 0 ? String(Math.round(p)) : p.toFixed(2);

  if (stickerType === 'four-row') {
    return `
    <div style="width:100%;height:100%;padding:0.8mm 1mm;display:flex;flex-direction:column;gap:0.3mm;justify-content:flex-start;border-right:0.3mm solid #ddd;box-sizing:border-box;overflow:hidden;">
      <div style="${F}font-size:5.5pt;line-height:1;flex-shrink:0;">${shopName}</div>
      <div style="${F}font-size:4.5pt;line-height:1;overflow:hidden;white-space:nowrap;flex-shrink:0;">${name}${details ? ' '+details : ''}</div>
      <img src="${barUrl}" style="width:18mm;height:3.5mm;object-fit:contain;object-position:left;display:block;flex-shrink:0;">
      <div style="${F}font-size:5.5pt;line-height:1;flex-shrink:0;">${sku}</div>
      <div style="${F}font-size:5.5pt;line-height:1;flex-shrink:0;">RS: ${priceStr}/-</div>
    </div>`;
  }
  if (stickerType === 'three-row') {
    return `
    <div style="width:27mm;height:20mm;padding:1mm;display:flex;flex-direction:column;gap:0.3mm;justify-content:flex-start;box-sizing:border-box;overflow:hidden;">
      <div style="${F}font-size:6pt;line-height:1;flex-shrink:0;">${shopName}</div>
      <img src="${barUrl}" style="width:25mm;height:8mm;object-fit:contain;object-position:left;display:block;flex-shrink:0;">
      <div style="${F}font-size:5pt;line-height:1;flex-shrink:0;">${sku}</div>
      <div style="${F}font-size:5.5pt;line-height:1.1;overflow:hidden;white-space:nowrap;flex-shrink:0;">${name}${details ? ' '+details : ''}</div>
      <div style="${F}font-size:8pt;line-height:1;flex-shrink:0;">RS: ${priceStr}/-</div>
    </div>`;
  }
  if (stickerType === 'two-row') {
    return `
    <div style="width:38mm;height:25mm;padding:1.5mm 2mm;display:flex;flex-direction:column;gap:0.5mm;justify-content:flex-start;border-right:0.3mm solid #ddd;box-sizing:border-box;overflow:hidden;">
      <div style="${F}font-size:7pt;line-height:1;flex-shrink:0;">${shopName}</div>
      <img src="${barUrl}" style="width:34mm;height:8mm;object-fit:contain;object-position:left;display:block;flex-shrink:0;">
      <div style="${F}font-size:6pt;line-height:1;flex-shrink:0;">${sku}</div>
      <div style="${F}font-size:6pt;line-height:1.1;overflow:hidden;white-space:nowrap;flex-shrink:0;">${name}${details ? ' '+details : ''}</div>
      <div style="${F}font-size:9pt;line-height:1;flex-shrink:0;">RS: ${priceStr}/-</div>
    </div>`;
  }
  return '';
}

// Full standalone label (butterfly / single-row) — one label = one physical page, never shared across products.
function buildFullLabelHTML(product, stickerType, shopName = 'GOSUAS') {
  const name    = product.name || '';
  const sku     = product.sku  || '';
  const barUrl  = `${API}/barcodes/${product.barcode}`;
  const details = variantLabel(product);
  const F = 'font-family:Arial,sans-serif;font-weight:600;color:#000;';
  const p = product.productType === 'RENTAL'
    ? Number(product.depositAmount || 0) + Number(product.rentAmount || 0)
    : Number(product.sellingPrice);
  const priceStr = p % 1 === 0 ? String(Math.round(p)) : p.toFixed(2);

  if (stickerType === 'butterfly') {
    const butterflyWing = `
      <div style="width:22mm;height:24mm;padding:1.5mm 1mm 0.8mm;display:flex;flex-direction:column;box-sizing:border-box;overflow:hidden;">
        <div style="${F}font-size:6pt;line-height:1;flex-shrink:0;">${shopName}</div>
        <div style="height:0.5mm;flex-shrink:0;"></div>
        <img src="${barUrl}" style="width:20mm;height:5mm;object-fit:contain;object-position:left;display:block;flex-shrink:0;">
        <div style="height:0.5mm;flex-shrink:0;"></div>
        <div style="${F}font-size:5pt;line-height:1;flex-shrink:0;">${sku}</div>
        <div style="height:2mm;flex-shrink:0;"></div>
        <div style="${F}font-size:6pt;line-height:1.1;flex-shrink:0;overflow:hidden;white-space:nowrap;">${name}${details ? ' '+details : ''}</div>
        <div style="height:0.5mm;flex-shrink:0;"></div>
        <div style="${F}font-size:10pt;line-height:1;flex-shrink:0;">RS: ${priceStr}/-</div>
      </div>`;
    return `
      <div class="label" style="width:75mm;height:24mm;display:flex;flex-direction:row;box-sizing:border-box;overflow:hidden;">
        <div style="width:4.5mm;flex-shrink:0;"></div>
        ${butterflyWing}
        <div style="width:26.5mm;height:24mm;flex-shrink:0;"></div>
        ${butterflyWing}
      </div>`;
  }
  // single-row
  return `
      <div class="label" style="width:50mm;height:15mm;padding:1mm 1.5mm;display:flex;align-items:center;gap:2mm;border:0.3mm solid #bbb;box-sizing:border-box;overflow:hidden;">
        <img src="${barUrl}" style="width:28mm;height:12mm;object-fit:contain;object-position:left;flex-shrink:0;display:block;">
        <div style="display:flex;flex-direction:column;gap:0.4mm;overflow:hidden;">
          <span style="${F}font-size:5pt;line-height:1;white-space:nowrap;overflow:hidden;">${shopName}</span>
          <span style="${F}font-size:5pt;line-height:1;white-space:nowrap;overflow:hidden;">${sku}</span>
          <span style="${F}font-size:5pt;line-height:1;white-space:nowrap;overflow:hidden;">${name}${details ? ' '+details : ''}</span>
          <span style="${F}font-size:7pt;line-height:1;">RS: ${priceStr}/-</span>
        </div>
      </div>`;
}

function buildGrid(cellsHTML, cols, cellW, cellH, stretch = false) {
  let html = '';
  const rows = Math.ceil(cellsHTML.length / cols);
  const totalW = `${cols * parseInt(cellW)}mm`;
  // stretch: size the row/cells as percentages of the actual printed page instead of fixed mm,
  // so if the printer's real page ends up wider than requested, cells fill it exactly with no
  // leftover blank space on the right — instead of relying on the page matching totalW exactly.
  const rowW  = stretch ? '100%' : totalW;
  const cellW_ = stretch ? `${100 / cols}%` : cellW;
  for (let r = 0; r < rows; r++) {
    const pb = r < rows - 1 ? 'always' : 'auto';
    html += `<div class="label" style="font-size:0;white-space:nowrap;width:${rowW};height:${cellH};overflow:hidden;page-break-after:${pb};break-after:${pb === 'always' ? 'page' : 'auto'};">`;
    for (let c = 0; c < cols; c++) {
      const idx = r * cols + c;
      if (idx < cellsHTML.length) {
        html += `<div style="display:inline-block;vertical-align:top;width:${cellW_};height:${cellH};overflow:hidden;box-sizing:border-box;">${cellsHTML[idx]}</div>`;
      } else {
        html += `<div style="display:inline-block;vertical-align:top;width:${cellW_};height:${cellH};box-sizing:border-box;"></div>`;
      }
    }
    html += `</div>`;
  }
  return { html, pageW: totalW, pageH: cellH };
}

// Packs a flat list of already-built cell HTML (which may span several different products) into
// full grid rows, so bulk-printing multiple products never leaves a wasted blank row between them.
function buildGridRowsHTML(cellsHTML, stickerType) {
  if (stickerType === 'four-row') return buildGrid(cellsHTML, 4, '20mm', '15mm', true);
  if (stickerType === 'two-row')  return buildGrid(cellsHTML, 2, '38mm', '25mm');
  if (stickerType === 'three-row') {
    // 7mm left sheet margin + 3×27mm cells + 2×1mm gaps = 90mm sheet width
    const TR_COLS = 3, TR_CELL = '27mm', TR_H = '20mm', TR_GAP = '1mm', TR_OFF = '7mm';
    let html = '';
    const rows = Math.ceil(cellsHTML.length / TR_COLS);
    for (let r = 0; r < rows; r++) {
      const pb = r < rows - 1 ? 'always' : 'auto';
      html += `<div class="label" style="margin-left:${TR_OFF};font-size:0;white-space:nowrap;height:${TR_H};overflow:hidden;page-break-after:${pb};break-after:${pb === 'always' ? 'page' : 'auto'};">`;
      for (let c = 0; c < TR_COLS; c++) {
        if (c > 0) html += `<div style="display:inline-block;vertical-align:top;width:${TR_GAP};height:${TR_H};"></div>`;
        const idx = r * TR_COLS + c;
        html += `<div style="display:inline-block;vertical-align:top;width:${TR_CELL};height:${TR_H};overflow:hidden;box-sizing:border-box;">`;
        html += idx < cellsHTML.length ? cellsHTML[idx] : '';
        html += `</div>`;
      }
      html += `</div>`;
    }
    return { html, pageW: '90mm', pageH: TR_H };
  }
  return { html: '', pageW: '0mm', pageH: '0mm' };
}

const GRID_STICKER_TYPES = ['four-row', 'three-row', 'two-row'];

function buildProductLabels(product, stickerType, qty, shopName = 'GOSUAS') {
  const sticker = STICKER_TYPES.find(s => s.id === stickerType);
  if (!sticker) return { labelsHTML: '', pageW: '50mm', pageH: '25mm' };

  let labelsHTML, pageW, pageH;

  if (GRID_STICKER_TYPES.includes(stickerType)) {
    const cellHTML = buildLabelCellHTML(product, stickerType, shopName);
    const g = buildGridRowsHTML(Array.from({length: qty}, () => cellHTML), stickerType);
    labelsHTML = g.html; pageW = g.pageW; pageH = g.pageH;
  } else {
    const labelHTML = buildFullLabelHTML(product, stickerType, shopName);
    labelsHTML = Array.from({length: qty}, (_, i) =>
      `<div style="page-break-after:${i < qty - 1 ? 'always' : 'auto'};">${labelHTML}</div>`
    ).join('');
    pageW = sticker.w; pageH = sticker.h;
  }

  return {
    labelsHTML,
    pageW,
    pageH,
    isFourRow: stickerType === 'four-row',
    sticker,
  };
}

function openPrintWindow(labelsHTML, pageW, pageH, isFourRow, title, totalQty) {
  const isButterfly  = pageW === '75mm';
  const isTwoRow     = pageW === '76mm';   // 2 × 38mm grid
  const isThreeRow   = pageW === '90mm';   // 3 × 30mm grid
  const isSingleRow  = pageW === '50mm';
  const isGrid = isFourRow || isTwoRow || isThreeRow;
  const previewW = isButterfly ? 520 : isGrid ? 500 : 360;

  const paperName = isFourRow   ? 'Row Label'
    : isButterfly  ? 'Butterfly'
    : isThreeRow   ? 'Three Row'
    : isTwoRow     ? 'Two Row'
    : isSingleRow  ? 'Single Row'
    : pageW + ' × ' + pageH;

  const paperW_in = isFourRow   ? '3.15 in'
    : isButterfly  ? '2.953 in'
    : isThreeRow   ? '3.54 in'
    : isTwoRow     ? '2.99 in'
    : isSingleRow  ? '1.97 in'
    : pageW;

  const paperH_in = isFourRow   ? '0.59 in'
    : isButterfly  ? '0.945 in'
    : isThreeRow   ? '0.79 in'
    : isTwoRow     ? '0.98 in'
    : isSingleRow  ? '0.59 in'
    : pageH;

  // Reuse hidden iframe so Chrome remembers printer settings across prints
  let iframe = document.getElementById('__label_print_frame__');
  if (!iframe) {
    iframe = document.createElement('iframe');
    iframe.id = '__label_print_frame__';
    iframe.style.cssText = 'position:fixed;width:0;height:0;border:0;top:0;left:0;opacity:0;pointer-events:none;';
    document.body.appendChild(iframe);
  }
  const labelDoc = iframe.contentDocument || iframe.contentWindow.document;
  labelDoc.open();
  labelDoc.write(`<!DOCTYPE html>
<html><head>
  <meta charset="UTF-8">
  <title>${title}</title>
  <style>
    @page { size: ${pageW} ${pageH}; margin: 0mm; }
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: Arial, sans-serif; background: #fff; margin: 0; }
    .label { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    .labels-wrap { padding: 0; gap: 0; display: block; }
  </style>
</head>
<body>
  <div class="labels-wrap">${labelsHTML}</div>
</body></html>`);
  labelDoc.close();

  // Delay to allow barcode images to load, then print
  setTimeout(() => { iframe.contentWindow.print(); }, 600);
}

// Four-row is the tightest layout (4×20mm columns) — any drift in the printer driver's
// selected paper stock shows up as rotated/skipped columns, since browsers can't force the
// OS driver to switch stock automatically. Confirm it's set right before every four-row job.
function confirmFourRowStock() {
  return window.confirm(
    'Before printing, confirm in the printer driver (Printing Preferences → Page Setup):\n\n' +
    '  Stock: Row Label (3.15in × 0.59in)\n' +
    '  Orientation: Portrait, 0°\n\n' +
    'Continue with print?'
  );
}

function printLabels(product, stickerType, qty, shopName) {
  const { labelsHTML, pageW, pageH, isFourRow, sticker } = buildProductLabels(product, stickerType, qty, shopName);
  if (!sticker) return;
  openPrintWindow(labelsHTML, pageW, pageH, isFourRow,
    `Preview — ${qty} label${qty !== 1 ? 's' : ''} (${sticker.label} ${sticker.size})`, qty);
}

function printBulkLabels(items, stickerType, shopName) {
  if (!items.length) return;
  const sticker = STICKER_TYPES.find(s => s.id === stickerType);
  if (!sticker) return;
  const isFourRow = stickerType === 'four-row';

  let allHTML, pageW, pageH;
  let totalQty = 0;

  if (GRID_STICKER_TYPES.includes(stickerType)) {
    // Pack every product's cells into one continuous stream of grid rows, instead of forcing
    // a fresh page per product — that used to leave a wasted blank row between products
    // whenever a product's own label count didn't exactly fill a row.
    const allCells = [];
    items.forEach(({ product, qty }) => {
      const cellHTML = buildLabelCellHTML(product, stickerType, shopName);
      for (let i = 0; i < qty; i++) allCells.push(cellHTML);
      totalQty += qty;
    });
    const g = buildGridRowsHTML(allCells, stickerType);
    allHTML = g.html; pageW = g.pageW; pageH = g.pageH;
  } else {
    // butterfly / single-row: each label is already its own full page, so per-product
    // forced breaks are harmless — just concatenate each product's labels in sequence.
    let html = '';
    items.forEach(({ product, qty }, idx) => {
      const { labelsHTML } = buildProductLabels(product, stickerType, qty, shopName);
      const isLast = idx === items.length - 1;
      html += `<div style="page-break-after:${isLast ? 'auto' : 'always'};">${labelsHTML}</div>`;
      totalQty += qty;
    });
    allHTML = html; pageW = sticker.w; pageH = sticker.h;
  }

  openPrintWindow(allHTML, pageW, pageH, isFourRow,
    `Bulk Print — ${items.length} products, ${totalQty} labels (${sticker.label})`, totalQty);
}

function BarChart({ data }) {
  const maxVal = Math.max(...data.map(d => d.value), 1);
  const W = 420, H = 110, pL = 8, pR = 8, pT = 22, pB = 26;
  const slotW = (W - pL - pR) / data.length;
  const barW  = slotW * 0.55;
  return (
    <svg viewBox={`0 0 ${W} ${H + pT + pB}`} style={{width:'100%',height:'auto'}}>
      <line x1={pL} y1={pT+H} x2={W-pR} y2={pT+H} stroke="#eee" strokeWidth="1"/>
      {data.map((d, i) => {
        const bH = Math.max((d.value / maxVal) * H, d.value > 0 ? 2 : 0);
        const x  = pL + i * slotW + (slotW - barW) / 2;
        const y  = pT + H - bH;
        return (
          <g key={i}>
            <rect x={x} y={y} width={barW} height={bH} fill="#1E3A5F" rx="3" opacity={bH ? 1 : 0.15}/>
            <text x={x+barW/2} y={pT+H+14} textAnchor="middle" fontSize="8.5" fill="#888">{d.label}</text>
            {d.value > 0 && (
              <text x={x+barW/2} y={y-5} textAnchor="middle" fontSize="8" fill="#444">
                {d.value >= 1000 ? `₹${(d.value/1000).toFixed(1)}k` : `₹${d.value}`}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}

function printOrderShippingLabel(order, shopName, shopAddress) {
  const toAddr = order.source === 'ONLINE'
    ? [order.houseNo, order.street, order.city, order.pincode, order.state, order.country].filter(Boolean).join(', ')
    : order.shippingAddress || order.city || '';
  const toPhone = order.phone || order.customerContact || '';
  const toName = order.customerName || toPhone || 'Customer';
  const w = window.open('', '_blank', 'width=420,height=320');
  w.document.write(`<!DOCTYPE html><html><head><title>Shipping Label</title>
<style>
  body{margin:0;font-family:'Courier New',monospace;padding:4mm;}
  .label{width:380px;border:2px solid #000;padding:14px;box-sizing:border-box;}
  .top{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:10px;border-bottom:1px dashed #333;padding-bottom:8px;}
  .logo{font-size:16px;font-weight:900;}
  .date{font-size:10px;color:#555;}
  .section-label{font-size:9px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:#555;margin-bottom:3px;}
  .from{margin-bottom:10px;padding-bottom:10px;border-bottom:1px dashed #333;}
  .to{margin-bottom:10px;padding-bottom:10px;border-bottom:1px dashed #333;}
  .name{font-size:14px;font-weight:900;margin-bottom:2px;}
  .addr{font-size:11px;line-height:1.5;}
  .items{font-size:10px;background:#f0f0f0;padding:5px 8px;border-radius:4px;margin-bottom:8px;}
  .barcode{text-align:center;font-size:10px;letter-spacing:2px;border-top:1px dashed #333;padding-top:8px;color:#888;}
  @media print{body{margin:0;}@page{margin:4mm;}}
</style></head><body>
<div class="label">
  <div class="top">
    <div class="logo">${(shopName||'SHOP').toUpperCase()}</div>
    <div class="date">Order: ${order.orderNumber || ''} &nbsp; ${new Date().toLocaleDateString('en-IN')}</div>
  </div>
  <div class="from">
    <div class="section-label">From</div>
    <div class="name">${(shopName||'').toUpperCase()}</div>
    <div class="addr">${(shopAddress||'(No shop address set)').replace(/\n/g,'<br>')}</div>
  </div>
  <div class="to">
    <div class="section-label">To</div>
    <div class="name">${toName}</div>
    <div class="addr">${toAddr||'(No delivery address)'}</div>
    ${toPhone ? `<div style="font-size:11px;margin-top:3px;">📞 ${toPhone}</div>` : ''}
  </div>
  <div class="items">📦 ${(order.items||[]).map(i=>`${i.productName} ×${i.quantity}`).join(', ')||'Order'} | ₹${Number(order.total||0).toFixed(2)}</div>
  <div class="barcode">✦ ${(order.orderNumber||order.id?.slice(0,8)||'').toUpperCase()} ✦</div>
</div>
<script>window.onload=()=>{window.print();}<\/script>
</body></html>`);
  w.document.close();
}

/* ── PDF Store — tenant console page ── */
function PdfStorePage({ tenantInfo }) {
  const [pdfs, setPdfs] = useState([]);
  const [orders, setOrders] = useState([]);
  const [tab, setTab] = useState('products'); // 'products' | 'orders'
  const [uploading, setUploading] = useState(false);
  const [uploadForm, setUploadForm] = useState({ title:'', description:'', price:'', password:'', coverEmoji:'📄' });
  const [uploadFile, setUploadFile] = useState(null);
  const [uploadErr, setUploadErr] = useState('');
  const [showUpload, setShowUpload] = useState(false);
  const headers = { Authorization: `Bearer ${localStorage.getItem('gosuas_token')}` };
  const EMOJIS = ['📄','📚','📝','🎓','📖','📊','🧪','🖊️','📐','💡'];

  const load = async () => {
    const [p, o] = await Promise.all([
      axios.get(`${API}/digital-products`, { headers }),
      axios.get(`${API}/digital-products/orders`, { headers }),
    ]).then(([p, o]) => [p.data, o.data]).catch(() => [[], []]);
    setPdfs(p); setOrders(o);
  };
  useEffect(() => { load(); }, []);

  const printShippingLabel = (order) => {
    const dp = pdfs.find(p => p.id === order.digitalProductId);
    const w = window.open('', '_blank', 'width=420,height=320');
    w.document.write(`<!DOCTYPE html><html><head><title>Shipping Label</title>
<style>
  body{margin:0;font-family:'Courier New',monospace;padding:0;}
  .label{width:380px;border:2px solid #000;padding:14px;box-sizing:border-box;}
  .top{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:10px;border-bottom:1px dashed #333;padding-bottom:8px;}
  .logo{font-size:16px;font-weight:900;letter-spacing:-0.5px;}
  .date{font-size:10px;color:#555;}
  .section-label{font-size:9px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:#555;margin-bottom:3px;}
  .from{margin-bottom:10px;padding-bottom:10px;border-bottom:1px dashed #333;}
  .to{margin-bottom:10px;padding-bottom:10px;border-bottom:1px dashed #333;}
  .name{font-size:14px;font-weight:900;margin-bottom:2px;}
  .addr{font-size:11px;line-height:1.5;white-space:pre-line;}
  .product{font-size:10px;background:#f0f0f0;padding:5px 8px;border-radius:4px;margin-bottom:8px;}
  .barcode{text-align:center;font-size:10px;letter-spacing:2px;border-top:1px dashed #333;padding-top:8px;color:#888;}
  @media print{body{margin:0;}@page{margin:4mm;}}
</style></head><body>
<div class="label">
  <div class="top">
    <div class="logo">${(tenantInfo?.name || 'SHOP').toUpperCase()}</div>
    <div class="date">Date: ${new Date().toLocaleDateString('en-IN')}</div>
  </div>
  <div class="from">
    <div class="section-label">From</div>
    <div class="name">${(tenantInfo?.name || '').toUpperCase()}</div>
    <div class="addr">${(tenantInfo?.shopAddress || '(No shop address — set it in Shop Settings)').replace(/\n/g,'<br>')}</div>
  </div>
  <div class="to">
    <div class="section-label">To</div>
    <div class="name">${order.customerName || ''}</div>
    <div class="addr">${order.deliveryAddress || '(No delivery address)'}</div>
    ${order.deliveryPhone ? `<div style="font-size:11px;margin-top:3px;">📞 ${order.deliveryPhone}</div>` : ''}
  </div>
  <div class="product">📦 ${dp?.title || 'Product'} | ₹${Number(order.amount).toLocaleString('en-IN')} | ${order.paymentStatus}</div>
  <div class="barcode">✦ ${order.id?.slice(0,8).toUpperCase() || ''} ✦</div>
</div>
<script>window.onload=()=>{window.print();}<\/script>
</body></html>`);
    w.document.close();
  };

  const handleUpload = async (e) => {
    e.preventDefault();
    if (!uploadFile) { setUploadErr('Please select a PDF file'); return; }
    if (!uploadForm.title.trim()) { setUploadErr('Title is required'); return; }
    if (!uploadForm.price || isNaN(uploadForm.price) || Number(uploadForm.price) <= 0) { setUploadErr('Enter a valid price'); return; }
    setUploading(true); setUploadErr('');
    try {
      const fd = new FormData();
      fd.append('file', uploadFile);
      fd.append('title', uploadForm.title);
      fd.append('description', uploadForm.description);
      fd.append('price', uploadForm.price);
      fd.append('password', uploadForm.password);
      fd.append('coverEmoji', uploadForm.coverEmoji);
      await axios.post(`${API}/digital-products/upload`, fd, { headers: { ...headers, 'Content-Type': 'multipart/form-data' } });
      setShowUpload(false);
      setUploadForm({ title:'', description:'', price:'', password:'', coverEmoji:'📄' });
      setUploadFile(null);
      load();
    } catch { setUploadErr('Upload failed. Please try again.'); }
    finally { setUploading(false); }
  };

  const toggleActive = async (dp) => {
    await axios.put(`${API}/digital-products/${dp.id}`, { active: !dp.active }, { headers });
    load();
  };

  return (
    <div className="page-content">
      <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:24,flexWrap:'wrap',gap:12}}>
        <div>
          <h2 style={{margin:0,fontSize:22,fontWeight:800,color:'#1f2937'}}>📄 PDF Store</h2>
          <p style={{margin:'4px 0 0',fontSize:13,color:'#6b7280'}}>Sell class notes, documents & PDFs. Delivered to customer email after payment.</p>
        </div>
        <button className="btn-primary" onClick={() => setShowUpload(true)} style={{display:'flex',alignItems:'center',gap:6}}>
          + Upload PDF
        </button>
      </div>

      {/* Tabs */}
      <div style={{display:'flex',gap:4,marginBottom:20,borderBottom:'2px solid #e5e7eb'}}>
        {[['products','📄 My PDFs'],['orders','📦 Orders']].map(([k,l]) => (
          <button key={k} onClick={() => setTab(k)}
            style={{padding:'8px 18px',fontSize:13,fontWeight:600,border:'none',cursor:'pointer',borderBottom:`2px solid ${tab===k?'#1E3A5F':'transparent'}`,marginBottom:-2,background:'none',color:tab===k?'#1E3A5F':'#6b7280'}}>
            {l}
          </button>
        ))}
      </div>

      {/* Products list */}
      {tab === 'products' && (
        pdfs.length === 0
          ? <div style={{textAlign:'center',padding:'60px 0',color:'#9ca3af'}}>
              <div style={{fontSize:48,marginBottom:12}}>📄</div>
              <div style={{fontSize:16,fontWeight:600,marginBottom:6}}>No PDFs uploaded yet</div>
              <div style={{fontSize:13}}>Upload your first PDF to start selling</div>
            </div>
          : <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(280px,1fr))',gap:16}}>
              {pdfs.map(dp => (
                <div key={dp.id} style={{background:'#fff',border:'1.5px solid #e5e7eb',borderRadius:12,padding:20,position:'relative',opacity:dp.active?1:0.55}}>
                  <div style={{fontSize:36,marginBottom:10}}>{dp.coverEmoji || '📄'}</div>
                  <div style={{fontWeight:700,fontSize:15,color:'#1f2937',marginBottom:4}}>{dp.title}</div>
                  <div style={{fontSize:12,color:'#6b7280',marginBottom:12,lineHeight:1.5}}>{dp.description || '—'}</div>
                  <div style={{display:'flex',alignItems:'center',justifyContent:'space-between'}}>
                    <div style={{fontWeight:800,fontSize:18,color:'#16a34a'}}>₹{Number(dp.price).toLocaleString('en-IN')}</div>
                    <div style={{display:'flex',gap:6}}>
                      {dp.passwordProtected && <span title="Password protected" style={{fontSize:14}}>🔑</span>}
                      <button onClick={() => toggleActive(dp)}
                        style={{fontSize:11,padding:'4px 10px',borderRadius:6,border:`1px solid ${dp.active?'#d1d5db':'#1E3A5F'}`,background:dp.active?'#f9fafb':'#1E3A5F',color:dp.active?'#374151':'#fff',cursor:'pointer',fontWeight:600}}>
                        {dp.active ? 'Deactivate' : 'Activate'}
                      </button>
                    </div>
                  </div>
                  {!dp.active && <div style={{position:'absolute',top:10,right:10,fontSize:10,background:'#fee2e2',color:'#dc2626',padding:'2px 8px',borderRadius:20,fontWeight:700}}>INACTIVE</div>}
                </div>
              ))}
            </div>
      )}

      {/* Orders list */}
      {tab === 'orders' && (
        orders.length === 0
          ? <div style={{textAlign:'center',padding:'60px 0',color:'#9ca3af'}}>
              <div style={{fontSize:48,marginBottom:12}}>📦</div>
              <div style={{fontSize:16,fontWeight:600}}>No orders yet</div>
            </div>
          : <div style={{overflowX:'auto'}}>
              <table style={{width:'100%',borderCollapse:'collapse',fontSize:13}}>
                <thead>
                  <tr style={{borderBottom:'2px solid #e5e7eb'}}>
                    {['Product','Customer','Email','Address','Phone','Amount','Status','Date','Label'].map(h => (
                      <th key={h} style={{textAlign:'left',padding:'8px 12px',fontWeight:700,color:'#374151',whiteSpace:'nowrap'}}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {orders.map(o => {
                    const dp = pdfs.find(p => p.id === o.digitalProductId);
                    return (
                      <tr key={o.id} style={{borderBottom:'1px solid #f3f4f6'}}>
                        <td style={{padding:'10px 12px',maxWidth:140,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{dp?.title || '—'}</td>
                        <td style={{padding:'10px 12px',whiteSpace:'nowrap'}}>{o.customerName || '—'}</td>
                        <td style={{padding:'10px 12px',color:'#374151'}}>{o.customerEmail}</td>
                        <td style={{padding:'10px 12px',maxWidth:160,fontSize:12,color:'#6b7280'}}>{o.deliveryAddress || <span style={{color:'#d1d5db'}}>—</span>}</td>
                        <td style={{padding:'10px 12px',whiteSpace:'nowrap',fontSize:12}}>{o.deliveryPhone || <span style={{color:'#d1d5db'}}>—</span>}</td>
                        <td style={{padding:'10px 12px',fontWeight:700,color:'#16a34a',whiteSpace:'nowrap'}}>₹{Number(o.amount).toLocaleString('en-IN')}</td>
                        <td style={{padding:'10px 12px'}}>
                          <span style={{padding:'2px 10px',borderRadius:20,fontSize:11,fontWeight:700,background:o.paymentStatus==='PAID'?'#dcfce7':'#fef9c3',color:o.paymentStatus==='PAID'?'#15803d':'#a16207'}}>
                            {o.paymentStatus}
                          </span>
                        </td>
                        <td style={{padding:'10px 12px',color:'#9ca3af',whiteSpace:'nowrap'}}>{o.createdAt?.slice(0,10)}</td>
                        <td style={{padding:'10px 12px'}}>
                          <button onClick={() => printShippingLabel(o)}
                            title="Print Shipping Label"
                            style={{background:'#1E3A5F',color:'#fff',border:'none',borderRadius:7,padding:'5px 10px',fontSize:12,cursor:'pointer',whiteSpace:'nowrap'}}>
                            🖨 Label
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
      )}


      {/* Upload modal */}
      {showUpload && (
        <div className="modal-overlay" onClick={() => setShowUpload(false)}>
          <div className="modal-box" style={{maxWidth:480}} onClick={e => e.stopPropagation()}>
            <h3 style={{margin:'0 0 20px',fontSize:18}}>Upload PDF Product</h3>
            <form onSubmit={handleUpload}>
              <div style={{marginBottom:12}}>
                <label className="modal-label">Cover Icon</label>
                <div style={{display:'flex',gap:8,flexWrap:'wrap',marginTop:6}}>
                  {EMOJIS.map(em => (
                    <button key={em} type="button" onClick={() => setUploadForm(f => ({...f, coverEmoji: em}))}
                      style={{width:36,height:36,borderRadius:8,border:`2px solid ${uploadForm.coverEmoji===em?'#1E3A5F':'#e5e7eb'}`,background:uploadForm.coverEmoji===em?'#EFF6FF':'#fff',fontSize:18,cursor:'pointer'}}>
                      {em}
                    </button>
                  ))}
                </div>
              </div>
              <div style={{marginBottom:12}}>
                <label className="modal-label">Title *</label>
                <input className="modal-input" placeholder="e.g. Class 10 Maths Notes" value={uploadForm.title}
                  onChange={e => setUploadForm(f => ({...f, title: e.target.value}))} required />
              </div>
              <div style={{marginBottom:12}}>
                <label className="modal-label">Description</label>
                <textarea className="modal-input" placeholder="Brief description of the PDF content" rows={2}
                  value={uploadForm.description} onChange={e => setUploadForm(f => ({...f, description: e.target.value}))}
                  style={{resize:'vertical'}} />
              </div>
              <div style={{marginBottom:12}}>
                <label className="modal-label">Price (₹) *</label>
                <input className="modal-input" type="number" min="1" placeholder="e.g. 199" value={uploadForm.price}
                  onChange={e => setUploadForm(f => ({...f, price: e.target.value}))} required />
              </div>
              <div style={{marginBottom:12}}>
                <label className="modal-label">PDF Password (optional — leave blank for no protection)</label>
                <input className="modal-input" type="text" placeholder="e.g. mystore2024" value={uploadForm.password}
                  onChange={e => setUploadForm(f => ({...f, password: e.target.value}))} />
                <p style={{fontSize:11,color:'#6b7280',margin:'4px 0 0'}}>🔑 If set, this password will be emailed to the customer along with the PDF.</p>
              </div>
              <div style={{marginBottom:16}}>
                <label className="modal-label">PDF File *</label>
                <input type="file" accept="application/pdf" required
                  onChange={e => setUploadFile(e.target.files?.[0] || null)}
                  style={{display:'block',marginTop:4,fontSize:13}} />
              </div>
              {uploadErr && <div style={{color:'#dc2626',fontSize:13,marginBottom:12,padding:'8px 12px',background:'#fef2f2',borderRadius:7}}>{uploadErr}</div>}
              <div style={{display:'flex',gap:10}}>
                <button type="submit" className="btn-primary" disabled={uploading} style={{flex:1}}>
                  {uploading ? 'Uploading…' : '⬆ Upload & Publish'}
                </button>
                <button type="button" className="btn-secondary" onClick={() => setShowUpload(false)} style={{flex:1}}>Cancel</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

function App() {
  const [isLoggedIn, setIsLoggedIn] = useState(() => !!localStorage.getItem('gosuas_token'));
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [products, setProducts] = useState([]);
  const EMPTY_FORM = { productType: 'OTHER', name: '', category: '', subcategory: '', sku: '', purchasePrice: '', sellingPrice: '', mrp: '', depositAmount: '', rentAmount: '', stockQty: '', selectedAttrs: {}, variants: [], colours: [], colorPhotos: {}, colourStocks: {}, showColourPicker: false, showToWebsite: false, festiveOffer: false, rentalAvailable: false, description: '', hsnCode: '', gstRate: '' };
  const [form, setForm] = useState(EMPTY_FORM);
  const makeEmptyImageSlots = (n) => Array.from({length:n}, () => ({file:null,preview:null}));
  const [imageSlots, setImageSlots] = useState(makeEmptyImageSlots(2));
  const [digitalProducts, setDigitalProducts] = useState([]);
  const [barcode, setBarcode] = useState('');
  const [cart, setCart] = useState([]);
  const [lastBill, setLastBill] = useState(null);
  const [lastBillId, setLastBillId] = useState(null);
  const [regeneratingBill, setRegeneratingBill] = useState(false);
  const [scanError, setScanError] = useState('');
  const [billError, setBillError] = useState('');
  const [inventorySearch, setInventorySearch] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const barcodeInputRef = useRef(null);
  const [labelModal, setLabelModal] = useState(null);
  const [confirmDialog, setConfirmDialog] = useState(null);
  const [toasts, setToasts] = useState([]);
  const showToast = (message, type = 'success') => {
    const id = Date.now() + Math.random();
    setToasts(t => [...t, { id, message, type }]);
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 3500);
  };
  const dismissToast = (id) => setToasts(t => t.filter(x => x.id !== id));
  const [discountInput, setDiscountInput] = useState('');
  const [discountType, setDiscountType] = useState('AMOUNT'); // 'AMOUNT' (₹) or 'PERCENT' (%)
  const [custModal, setCustModal] = useState(false);
  const [custNameInput, setCustNameInput] = useState('');
  const [custMobileInput, setCustMobileInput] = useState('');
  const [custLookupFound, setCustLookupFound] = useState(false);
  const [paymentType, setPaymentType] = useState('CASH');
  const [splitEntries, setSplitEntries] = useState([{ method: 'CASH', amount: '' }]);
  const [splitError, setSplitError] = useState('');
  const [editModal, setEditModal] = useState(null);
  const [showAddForm, setShowAddForm] = useState(false);
  // The current page lives in the URL hash (e.g. /#returns) so a page can be opened
  // directly or bookmarked, and survives a browser refresh instead of falling back to Home.
  const [activePage, setActivePage] = useState(() => {
    const h = window.location.hash.replace(/^#\/?/, '');
    return ADMIN_PAGES.includes(h) ? h : 'home';
  });
  const [tenantCategories, setTenantCategories] = useState([]);
  const [newCatDraft, setNewCatDraft] = useState({ name: '', attributes: [] });
  const [newAttrDraft, setNewAttrDraft] = useState({ name: '', options: '' });
  const [bulkSelectedIds, setBulkSelectedIds] = useState(new Set());
  const [bulkStickerType, setBulkStickerType] = useState('two-row');
  const [bulkQty, setBulkQty] = useState(1);
  const [bulkQtyMap, setBulkQtyMap] = useState({}); // per-product qty: { productId: qty }
  const [bulkCategoryFilter, setBulkCategoryFilter] = useState('');
  const [bulkSearch, setBulkSearch] = useState('');
  const [bulkPage, setBulkPage] = useState(1);
  const BULK_PAGE_SIZE = 20;
  const [bills, setBills] = useState([]);
  const [showNotif, setShowNotif] = useState(false);
  const [customers, setCustomers] = useState([]);
  const [orders, setOrders] = useState([]);
  const [expandedOrder, setExpandedOrder] = useState(null);
  const [custSearch, setCustSearch] = useState('');
  const [orderSearch, setOrderSearch] = useState('');
  const [orderSourceFilter, setOrderSourceFilter] = useState('ALL');
  const [custPage, setCustPage] = useState(1);
  const [orderPage, setOrderPage] = useState(1);
  const PAGE_ROWS = 25;
  const [tenantInfo, setTenantInfo] = useState(null);
  const [upgradingPlan, setUpgradingPlan] = useState(false);
  const [upgradeError, setUpgradeError] = useState('');
  const [shopEditModal, setShopEditModal] = useState(null);
  const [rzpHelpOpen, setRzpHelpOpen] = useState(false);
  const [shopEditSaving, setShopEditSaving] = useState(false);
  const [shopLogoFile, setShopLogoFile] = useState(null);
  const [shopLogoPreview, setShopLogoPreview] = useState(null);
  const [shopBannerFile, setShopBannerFile] = useState(null);
  const [shopBannerPreview, setShopBannerPreview] = useState(null);

  // ── Rental register (Gosuas tenant only) ──
  const [rentals, setRentals] = useState([]);
  const [rentalCode, setRentalCode] = useState('');
  const [rentalProduct, setRentalProduct] = useState(null);
  const [rentalQty, setRentalQty] = useState(1);
  const [rentalAdvance, setRentalAdvance] = useState('');
  const [rentalDeposit, setRentalDeposit] = useState('');
  const [rentalRent, setRentalRent] = useState('');
  const [rentalCustName, setRentalCustName] = useState('');
  const [rentalCustMobile, setRentalCustMobile] = useState('');
  const [rentalBookingDate, setRentalBookingDate] = useState('');
  const [rentalEventDays, setRentalEventDays] = useState(3);
  const [rentalError, setRentalError] = useState('');
  const rentalCodeRef = useRef(null);
  const [rentalEditModal, setRentalEditModal] = useState(null);
  const [returnModal, setReturnModal] = useState(null);
  const [rentalEditError, setRentalEditError] = useState('');

  // ── Damage Stock ───────────────────────────────────────────────────────────
  const [damages, setDamages] = useState([]);
  const [damageSearch, setDamageSearch] = useState('');
  const [damagePage, setDamagePage] = useState(1);
  const [damageError, setDamageError] = useState('');
  const [showDamageForm, setShowDamageForm] = useState(false);
  const [damageSku, setDamageSku] = useState('');
  const [damageProduct, setDamageProduct] = useState(null);
  const [damageSkuError, setDamageSkuError] = useState('');
  const [damageSkuLoading, setDamageSkuLoading] = useState(false);
  const [damageForm, setDamageForm] = useState({ qty: '', reason: 'OTHER', notes: '' });
  const [damageSubmitError, setDamageSubmitError] = useState('');
  const [damageSubmitLoading, setDamageSubmitLoading] = useState(false);

  // ── Expenses state ──────────────────────────────────────────────────────────
  const [expenses, setExpenses] = useState([]);
  const [expenseLoading, setExpenseLoading] = useState(false);
  const [expenseError, setExpenseError] = useState('');
  const [expensePage, setExpensePage] = useState(1);
  const [expenseSearch, setExpenseSearch] = useState('');
  const [expenseCategoryFilter, setExpenseCategoryFilter] = useState('');
  const [expensePaymentFilter, setExpensePaymentFilter] = useState('');
  const [expenseDateFilter, setExpenseDateFilter] = useState('');
  const [showExpenseForm, setShowExpenseForm] = useState(false);
  const EXPENSE_FORM_EMPTY = { category: '', amount: '', expenseDate: new Date().toISOString().slice(0,10), description: '', paymentMethod: 'CASH', referenceNumber: '' };
  const [expenseForm, setExpenseForm] = useState(EXPENSE_FORM_EMPTY);
  const [expenseFormError, setExpenseFormError] = useState('');
  const [expenseFormLoading, setExpenseFormLoading] = useState(false);
  const [expenseEditId, setExpenseEditId] = useState(null);
  const [expenseSummary, setExpenseSummary] = useState(null);

  // ── Sales Returns ──────────────────────────────────────────────────────────
  const [salesReturns, setSalesReturns] = useState([]);
  const [returnSearch, setReturnSearch] = useState('');
  const [returnStatusFilter, setReturnStatusFilter] = useState('ALL');
  const [returnPage, setReturnPage] = useState(1);
  const [expandedReturn, setExpandedReturn] = useState(null);
  const [showCreateReturn, setShowCreateReturn] = useState(false);
  const [returnPreviewRef, setReturnPreviewRef] = useState({ sourceType: 'POS', ref: '' });
  const [returnPreview, setReturnPreview] = useState(null);
  const [returnPreviewError, setReturnPreviewError] = useState('');
  const [returnPreviewLoading, setReturnPreviewLoading] = useState(false);
  const [returnFormItems, setReturnFormItems] = useState([]);
  const [returnFormMeta, setReturnFormMeta] = useState({ returnReason: '', remarks: '', refundMode: 'CASH' });
  const [returnSubmitError, setReturnSubmitError] = useState('');
  const [returnSubmitLoading, setReturnSubmitLoading] = useState(false);
  const [returnMode, setReturnMode] = useState('bill'); // 'bill' | 'direct'
  const [returnDirectSku, setReturnDirectSku] = useState('');
  const [returnDirectProduct, setReturnDirectProduct] = useState(null);
  const [returnDirectError, setReturnDirectError] = useState('');
  const [returnDirectLoading, setReturnDirectLoading] = useState(false);
  const [returnDirectItems, setReturnDirectItems] = useState([]);
  const [returnDirectCustomer, setReturnDirectCustomer] = useState({ name: '', mobile: '' });
  const [salesReturnsError, setSalesReturnsError] = useState('');
  const [returnStatusBusy, setReturnStatusBusy] = useState(null); // id of the return whose status is being changed

  const logoSrc = tenantInfo?.logoUrl ? `${BACKEND}${tenantInfo.logoUrl}` : '/logo.png';

  const UPGRADE_PLAN_PRICES = { STARTER: 999, PRO: 1699 }; // ₹/month, matches PLAN_CONFIG on the landing page

  const upgradeToPlan = async (targetPlan) => {
    setUpgradeError('');
    setUpgradingPlan(targetPlan);
    try {
      const amount = UPGRADE_PLAN_PRICES[targetPlan];
      const rpRes = await axios.post(`${API}/payment/create-order`, { amount });
      const { razorpayOrderId, amount: amountPaise, keyId } = rpRes.data;

      const scriptLoaded = await new Promise(resolve => {
        if (window.Razorpay) { resolve(true); return; }
        const s = document.createElement('script');
        s.src = 'https://checkout.razorpay.com/v1/checkout.js';
        s.onload = () => resolve(true);
        s.onerror = () => resolve(false);
        document.body.appendChild(s);
      });
      if (!scriptLoaded) { setUpgradeError('Could not load payment gateway. Please try again.'); setUpgradingPlan(false); return; }

      new window.Razorpay({
        key: keyId,
        amount: amountPaise,
        currency: 'INR',
        name: tenantInfo?.name || 'ShopClaude',
        description: `Upgrade to ${targetPlan} plan`,
        order_id: razorpayOrderId,
        prefill: { name: tenantInfo?.name || '', contact: tenantInfo?.phoneNumber || '' },
        theme: { color: '#1E3A5F' },
        handler: async (response) => {
          try {
            const res = await axios.post(`${API}/tenant/upgrade-plan`, {
              plan: targetPlan,
              razorpayOrderId: response.razorpay_order_id,
              razorpayPaymentId: response.razorpay_payment_id,
              razorpaySignature: response.razorpay_signature,
            });
            setTenantInfo(res.data);
          } catch (err) {
            setUpgradeError(err.response?.data?.error || 'Payment succeeded but activating your plan failed. Contact support with payment ID: ' + response.razorpay_payment_id);
          } finally {
            setUpgradingPlan(false);
          }
        },
        modal: { ondismiss: () => setUpgradingPlan(false) },
      }).open();
    } catch (err) {
      setUpgradeError(err.response?.data?.error || 'Could not start payment. Please try again.');
      setUpgradingPlan(false);
    }
  };

  const saveShopSettings = async () => {
    if ((shopEditModal?.bankAccountNumber || '') !== (shopEditModal?.confirmBankAccountNumber || '')) {
      showToast('Account Number and Confirm Account Number do not match.', 'error');
      return;
    }
    setShopEditSaving(true);
    try {
      if (shopLogoFile) {
        const fd = new FormData();
        fd.append('file', shopLogoFile);
        const res = await axios.post(`${API}/tenant/logo`, fd, { headers: { 'Content-Type': 'multipart/form-data' } });
        setTenantInfo(res.data);
      }
      if (shopBannerFile) {
        const fd = new FormData();
        fd.append('file', shopBannerFile);
        const res = await axios.post(`${API}/tenant/banner`, fd, { headers: { 'Content-Type': 'multipart/form-data' } });
        setTenantInfo(res.data);
      }
      const infoUpdate = {};
      if (shopEditModal?.name?.trim()) infoUpdate.name = shopEditModal.name.trim();
      if (shopEditModal?.address !== undefined) infoUpdate.shopAddress = shopEditModal.address;
      if (shopEditModal?.phoneNumber !== undefined) infoUpdate.phoneNumber = shopEditModal.phoneNumber;
      if (shopEditModal?.bankAccountNumber !== undefined) infoUpdate.bankAccountNumber = shopEditModal.bankAccountNumber;
      if (shopEditModal?.bankAccountHolderName !== undefined) infoUpdate.bankAccountHolderName = shopEditModal.bankAccountHolderName;
      if (shopEditModal?.bankIfscCode !== undefined) infoUpdate.bankIfscCode = shopEditModal.bankIfscCode;
      if (shopEditModal?.bankBranchName !== undefined) infoUpdate.bankBranchName = shopEditModal.bankBranchName;
      if (shopEditModal?.razorpayMerchantKeyId !== undefined) infoUpdate.razorpayMerchantKeyId = shopEditModal.razorpayMerchantKeyId;
      if (shopEditModal?.razorpayMerchantKeySecret) infoUpdate.razorpayMerchantKeySecret = shopEditModal.razorpayMerchantKeySecret;
      if (shopEditModal?.gstin !== undefined) infoUpdate.gstin = shopEditModal.gstin;
      infoUpdate.gstRegistered = String(shopEditModal?.gstRegistered || false);
      if (shopEditModal?.supplyType) infoUpdate.supplyType = shopEditModal.supplyType;
      if (Object.keys(infoUpdate).length > 0) {
        const res = await axios.put(`${API}/tenant/info`, infoUpdate);
        setTenantInfo(res.data);
      }
      setShopEditModal(null);
      setShopLogoFile(null);
      setShopLogoPreview(null);
      setShopBannerFile(null);
      setShopBannerPreview(null);
      showToast('Shop settings saved successfully');
    } catch (err) {
      showToast(err.response?.data?.error || 'Failed to save shop settings.', 'error');
    }
    finally { setShopEditSaving(false); }
  };

  const loadTenantInfo = async () => {
    try {
      const res = await axios.get(`${API}/tenant/info`);
      setTenantInfo(res.data);
    } catch (e) {}
  };

  const loadTenantCategories = async () => {
    try {
      const res = await axios.get(`${API}/tenant/categories`);
      setTenantCategories(res.data || []);
    } catch (e) {}
  };

  const saveTenantCategories = async (cats) => {
    try { await axios.put(`${API}/tenant/categories`, cats); } catch (e) {}
  };

  const loadProducts = async () => {
    try {
      const res = await axios.get(`${API}/products`);
      setProducts(res.data);
    } catch (e) {}
  };

  const loadBills = async () => {
    try {
      const res = await axios.get(`${API}/bills`);
      setBills(res.data);
    } catch (e) {}
  };

  const loadSalesReturns = async () => {
    try {
      const res = await axios.get(`${API}/returns`);
      setSalesReturns(res.data);
      setSalesReturnsError('');
    } catch (e) {
      setSalesReturnsError(e.response?.data?.error || 'Could not load returns. Check your connection and try again.');
    }
  };

  const loadDamages = async () => {
    try {
      const res = await axios.get(`${API}/damage`);
      setDamages(res.data);
      setDamageError('');
    } catch (e) {
      setDamageError(e.response?.data?.error || 'Could not load damage entries.');
    }
  };

  const loadExpenses = async () => {
    setExpenseLoading(true);
    try {
      const res = await axios.get(`${API}/expenses`);
      setExpenses(res.data);
      setExpenseError('');
    } catch (e) {
      setExpenseError(e.response?.data?.error || 'Could not load expenses.');
    } finally {
      setExpenseLoading(false);
    }
  };

  const loadExpenseSummary = async () => {
    try {
      const res = await axios.get(`${API}/expenses/summary`);
      setExpenseSummary(res.data);
    } catch (e) {
      // Non-critical — silent fail
    }
  };

  // ── Expense CRUD handlers ──────────────────────────────────────────────────

  const EXPENSE_CATEGORIES = [
    { value:'DAILY_EXPENSE',  label:'Daily Expense' },
    { value:'RENT',           label:'Rent' },
    { value:'ELECTRICITY',    label:'Electricity' },
    { value:'WATER_BILL',     label:'Water Bill' },
    { value:'SALARY',         label:'Salary' },
    { value:'TRANSPORT',      label:'Transport' },
    { value:'OTHER_EXPENSE',  label:'Other Expense' },
  ];
  const EXPENSE_PAYMENT_METHODS = [
    { value:'CASH',  label:'Cash' },
    { value:'CARD',  label:'Card' },
    { value:'UPI',   label:'UPI' },
    { value:'OTHER', label:'Other' },
  ];

  const saveExpense = async (e) => {
    e.preventDefault();
    if (expenseFormLoading) return;
    setExpenseFormError('');
    if (!expenseForm.category) { setExpenseFormError('Category is required'); return; }
    const amt = parseFloat(expenseForm.amount);
    if (!expenseForm.amount || isNaN(amt) || amt <= 0) { setExpenseFormError('Amount must be greater than zero'); return; }
    if (!expenseForm.expenseDate) { setExpenseFormError('Expense date is required'); return; }
    setExpenseFormLoading(true);
    try {
      const payload = {
        category:        expenseForm.category,
        amount:          amt,
        expenseDate:     expenseForm.expenseDate,
        description:     expenseForm.description || null,
        paymentMethod:   expenseForm.paymentMethod || 'CASH',
        referenceNumber: expenseForm.referenceNumber || null,
      };
      if (expenseEditId) {
        await axios.put(`${API}/expenses/${expenseEditId}`, payload);
        showToast('Expense updated');
      } else {
        await axios.post(`${API}/expenses`, payload);
        showToast('Expense added');
      }
      setShowExpenseForm(false);
      setExpenseForm(EXPENSE_FORM_EMPTY);
      setExpenseEditId(null);
      await loadExpenses();
      loadExpenseSummary();
    } catch (err) {
      setExpenseFormError(err.response?.data?.error || err.response?.data?.message || 'Failed to save expense');
    } finally {
      setExpenseFormLoading(false);
    }
  };

  const deleteExpense = (id, category) => {
    const catLabel = EXPENSE_CATEGORIES.find(c => c.value === category)?.label || category;
    setConfirmDialog({
      title: 'Delete Expense',
      message: `Delete this ${catLabel} expense? This cannot be undone.`,
      onConfirm: async () => {
        setConfirmDialog(null);
        try {
          await axios.delete(`${API}/expenses/${id}`);
          setExpenses(prev => prev.filter(ex => ex.id !== id));
          loadExpenseSummary();
          showToast('Expense deleted');
        } catch (err) {
          showToast('Failed to delete expense: ' + (err.response?.data?.error || err.message), 'error');
        }
      }
    });
  };

  useEffect(() => {
    const current = window.location.hash.replace(/^#\/?/, '');
    if (current === activePage || (!current && activePage === 'home')) return;
    window.location.hash = activePage;
  }, [activePage]);

  useEffect(() => {
    const onHashChange = () => {
      const h = window.location.hash.replace(/^#\/?/, '');
      setActivePage(ADMIN_PAGES.includes(h) ? h : 'home');
    };
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  useEffect(() => {
    if (isLoggedIn) { loadProducts(); loadTenantInfo(); loadTenantCategories(); loadDigitalProducts(); loadExpenseSummary(); }
  }, [isLoggedIn]);

  useEffect(() => {
    if (tenantInfo?.plan) setImageSlots(makeEmptyImageSlots(maxPhotosForPlan(tenantInfo.plan)));
  }, [tenantInfo?.plan]);

  useEffect(() => {
    if (isLoggedIn && activePage === 'reports') { loadBills(); if (!rptStats) loadReports('', ''); }
    if (isLoggedIn && activePage === 'customers' && customers.length === 0)
      axios.get(`${API}/admin/customers`).then(r => setCustomers(r.data)).catch(() => {});
    if (isLoggedIn && activePage === 'orders' && orders.length === 0)
      axios.get(`${API}/admin/orders`).then(r => setOrders(r.data)).catch(() => {});
    if (isLoggedIn && activePage === 'rental')
      axios.get(`${API}/rentals`).then(r => setRentals(r.data)).catch(() => {});
    if (isLoggedIn && activePage === 'returns') loadSalesReturns();
    if (isLoggedIn && activePage === 'damage') loadDamages();
  if (isLoggedIn && activePage === 'expenses') loadExpenses();
  }, [activePage, isLoggedIn]);

  useEffect(() => {
    setCurrentPage(1);
  }, [inventorySearch]);

  const updateOrderStatus = async (orderId, newStatus) => {
    try {
      await axios.put(`${API}/admin/orders/${orderId}/status`, { status: newStatus });
      setOrders(prev => prev.map(o => o.id === orderId ? {...o, fulfillmentStatus: newStatus.toLowerCase()} : o));
      showToast('Order status updated');
    } catch (err) {
      showToast('Failed to update status: ' + (err.response?.data?.error || err.message), 'error');
    }
  };

  const deleteOrder = (order) => {
    setConfirmDialog({
      title: 'Delete Order',
      message: `Delete order ${order.orderNumber}? This cannot be undone.`,
      onConfirm: async () => {
        setConfirmDialog(null);
        try {
          await axios.delete(`${API}/admin/orders/${order.id}`, { params: { source: order.source } });
          setOrders(prev => prev.filter(o => o.id !== order.id));
          if (expandedOrder === order.id) setExpandedOrder(null);
          showToast('Order deleted');
        } catch (err) {
          showToast('Failed to delete order: ' + (err.response?.data?.error || err.message), 'error');
        }
      }
    });
  };

  // ── Rental register handlers ──
  const lookupRentalProduct = async () => {
    const input = rentalCode.trim();
    setRentalError('');
    setRentalProduct(null);
    if (!input) return;
    const applyResult = (product) => {
      if (!product.rentalAvailable) {
        setRentalError(`${product.name} is not marked "Available for Rental" — enable it from Inventory first.`);
        return;
      }
      setRentalProduct(product);
      // Prefill from the product's own configured Deposit/Rental Amount (Product Type: Rental),
      // still editable per booking.
      if (product.depositAmount != null) setRentalDeposit(String(product.depositAmount));
      if (product.rentAmount != null) setRentalRent(String(product.rentAmount));
    };
    try {
      const res = await axios.get(`${API}/products/barcode/${input}`);
      applyResult(res.data);
    } catch {
      try {
        const res = await axios.get(`${API}/products/sku/${input}`);
        applyResult(res.data);
      } catch {
        setRentalError('Product not found for code: ' + input);
      }
    }
  };

  const resetRentalForm = () => {
    setRentalCode(''); setRentalProduct(null); setRentalQty(1);
    setRentalAdvance(''); setRentalDeposit(''); setRentalRent('');
    setRentalCustName(''); setRentalCustMobile('');
    setRentalBookingDate(''); setRentalEventDays(3);
    rentalCodeRef.current?.focus();
  };

  const createRental = async () => {
    if (!rentalProduct) { setRentalError('Look up a valid product code first.'); return; }
    if (!rentalBookingDate) { setRentalError('Booking date is required.'); return; }
    try {
      const payload = {
        productCode: rentalProduct.barcode,
        quantity: Math.max(1, Number(rentalQty) || 1),
        advanceAmount: Number(rentalAdvance) || 0,
        depositAmount: Number(rentalDeposit) || 0,
        rentAmount: Number(rentalRent) || 0,
        customerName: rentalCustName.trim(),
        customerMobile: rentalCustMobile.trim(),
        bookingDate: rentalBookingDate,
        eventPeriodDays: Math.max(1, Number(rentalEventDays) || 1),
      };
      const res = await axios.post(`${API}/rentals`, payload);
      setRentals(prev => [res.data, ...prev]);
      setRentalError('');
      loadProducts();
      printRentalReceipt(res.data, tenantInfo?.name);
      resetRentalForm();
      showToast('Rental Successfully booked');
    } catch (err) {
      setRentalError(err.response?.data?.error || 'Failed to create rental.');
      showToast(err.response?.data?.error || 'Failed to create rental.', 'error');
    }
  };

  const openReturnModal = (rental) => {
    setReturnModal({
      id: rental.id,
      rentalNo: rental.rentalNo,
      productName: rental.productName,
      depositAmount: Number(rental.depositAmount || 0),
      returnDate: new Date().toISOString().slice(0, 10),
      deductionAmount: '',
      returnNotes: '',
    });
  };

  const confirmReturn = async () => {
    const m = returnModal;
    try {
      const res = await axios.put(`${API}/rentals/${m.id}/return`, {
        deductionAmount: Number(m.deductionAmount) || 0,
        returnNotes: m.returnNotes.trim() || null,
        returnDate: m.returnDate,
      });
      setRentals(prev => prev.map(r => r.id === m.id ? res.data : r));
      loadProducts();
      setReturnModal(null);
      showToast('Return Successfully recorded');
      printRentalReturnReceipt(res.data, tenantInfo?.name);
    } catch (err) {
      showToast('Failed to record return: ' + (err.response?.data?.error || err.message), 'error');
    }
  };

  const deleteRental = (rental) => {
    setConfirmDialog({
      title: 'Delete Rental',
      message: `Delete rental ${rental.rentalNo}? This cannot be undone.`,
      onConfirm: async () => {
        setConfirmDialog(null);
        try {
          await axios.delete(`${API}/rentals/${rental.id}`);
          setRentals(prev => prev.filter(r => r.id !== rental.id));
          loadProducts();
          showToast('Rental deleted');
        } catch (err) {
          showToast('Failed to delete rental: ' + (err.response?.data?.error || err.message), 'error');
        }
      }
    });
  };

  const openRentalEdit = (rental) => {
    setRentalEditError('');
    setRentalEditModal({
      id: rental.id,
      productName: rental.productName,
      productCode: rental.productCode,
      quantity: rental.quantity ?? 1,
      advanceAmount: rental.advanceAmount ?? 0,
      depositAmount: rental.depositAmount ?? 0,
      rentAmount: rental.rentAmount ?? 0,
      customerName: rental.customerName === 'Walk-in Customer' ? '' : (rental.customerName || ''),
      customerMobile: rental.customerMobile || '',
      bookingDate: rental.bookingDate || '',
      eventPeriodDays: rental.eventPeriodDays ?? 1,
    });
  };

  const saveRentalEdit = async () => {
    const m = rentalEditModal;
    try {
      const payload = {
        productCode: m.productCode,
        quantity: Math.max(1, Number(m.quantity) || 1),
        advanceAmount: Number(m.advanceAmount) || 0,
        depositAmount: Number(m.depositAmount) || 0,
        rentAmount: Number(m.rentAmount) || 0,
        customerName: m.customerName.trim(),
        customerMobile: m.customerMobile.trim(),
        bookingDate: m.bookingDate,
        eventPeriodDays: Math.max(1, Number(m.eventPeriodDays) || 1),
      };
      const res = await axios.put(`${API}/rentals/${m.id}`, payload);
      setRentals(prev => prev.map(r => r.id === m.id ? res.data : r));
      setRentalEditModal(null);
      showToast('Rental Successfully updated');
    } catch (err) {
      setRentalEditError(err.response?.data?.error || 'Failed to update rental.');
      showToast(err.response?.data?.error || 'Failed to update rental.', 'error');
    }
  };

  const handleLogin = (token) => {
    localStorage.setItem('gosuas_token', token);
    // Strip any stale URL hash left from the session-expiry redirect, then
    // update React state directly — avoids an unreliable same-path reload.
    if (window.location.hash) window.history.replaceState(null, '', window.location.pathname);
    setIsLoggedIn(true);
    setActivePage('home');
  };

  const handleLogout = () => {
    localStorage.removeItem('gosuas_token');
    window.location.reload();
  };

  if (!isLoggedIn) {
    return <Login onLogin={handleLogin} />;
  }

  const selectedCat = tenantCategories.find(c => c.name === form.category);
  const catAttrs = selectedCat?.attributes || [];

  const toggleAttr = (attrName, val) => {
    setForm(prev => {
      const cur = prev.selectedAttrs[attrName] || [];
      return { ...prev, selectedAttrs: { ...prev.selectedAttrs, [attrName]: cur.includes(val) ? cur.filter(x => x !== val) : [...cur, val] } };
    });
  };

  // Ad-hoc Colour variant — multi-select, one product generated per colour, each with its own photo.
  const toggleColour = (val) => {
    setForm(prev => {
      const on = prev.colours.includes(val);
      const colours = on ? prev.colours.filter(c => c !== val) : [...prev.colours, val];
      const colorPhotos = {...prev.colorPhotos};
      const colourStocks = {...prev.colourStocks};
      if (on) { delete colorPhotos[val]; delete colourStocks[val]; }
      return {...prev, colours, colorPhotos, colourStocks};
    });
  };
  const setColourPhoto = (colour, file) => setForm(f => ({...f, colorPhotos: {...f.colorPhotos, [colour]: {file, preview: URL.createObjectURL(file)}}}));
  const uploadColourPhoto = async (colour) => {
    const slot = form.colorPhotos[colour];
    if (!slot?.file) return null;
    const fd = new FormData();
    fd.append('file', slot.file);
    const res = await axios.post(`${API}/upload`, fd, { headers: { 'Content-Type': 'multipart/form-data' } });
    return res.data.url;
  };

  // Same Colour multi-select + per-colour photo mechanism, for Edit Product. Selecting more
  // than one colour here creates additional products for the extra colours on save (bulk-add
  // variants from an existing product), same as Add Product's bulk generation.
  const toggleEditColour = (val) => {
    setEditModal(prev => {
      const on = prev.colours.includes(val);
      const colours = on ? prev.colours.filter(c => c !== val) : [...prev.colours, val];
      const colorPhotos = {...prev.colorPhotos};
      if (on) delete colorPhotos[val];
      return {...prev, colours, colorPhotos};
    });
  };
  const setEditColourPhoto = (colour, file) => setEditModal(m => ({...m, colorPhotos: {...m.colorPhotos, [colour]: {file, preview: URL.createObjectURL(file)}}}));
  const uploadEditColourPhoto = async (colour) => {
    const slot = editModal.colorPhotos[colour];
    if (!slot) return null;
    if (!slot.file) return slot.serverUrl || null; // keep the existing photo if it wasn't changed
    const fd = new FormData();
    fd.append('file', slot.file);
    const res = await axios.post(`${API}/upload`, fd, { headers: { 'Content-Type': 'multipart/form-data' } });
    return res.data.url;
  };

  const uploadImages = async () => {
    const urls = [];
    for (const slot of imageSlots) {
      if (slot.file) {
        const fd = new FormData();
        fd.append('file', slot.file);
        const res = await axios.post(`${API}/upload`, fd, { headers: { 'Content-Type': 'multipart/form-data' } });
        urls.push(res.data.url);
      }
    }
    return urls.join(',') || null;
  };

  const loadDigitalProducts = () => {
    axios.get(`${API}/digital-products`).then(r => setDigitalProducts(r.data)).catch(() => {});
  };

  // Ad-hoc variant rows (Colour, Size, or any custom type) for categories with no predefined attributes.
  const addVariantRow = (presetName = '') => setForm(f => ({...f, variants: [...f.variants, { name: presetName, value: '' }]}));
  const updateVariantRow = (idx, patch) => setForm(f => ({...f, variants: f.variants.map((v, i) => i === idx ? {...v, ...patch} : v)}));
  const removeVariantRow = (idx) => setForm(f => ({...f, variants: f.variants.filter((_, i) => i !== idx)}));

  const addEditVariantRow = (presetName = '') => setEditModal(m => ({...m, variants: [...(m.variants||[]), { name: presetName, value: '' }]}));
  const updateEditVariantRow = (idx, patch) => setEditModal(m => ({...m, variants: m.variants.map((v, i) => i === idx ? {...v, ...patch} : v)}));
  const removeEditVariantRow = (idx) => setEditModal(m => ({...m, variants: m.variants.filter((_, i) => i !== idx)}));

  const createProduct = async (e) => {
    e.preventDefault();
    try {
      const imageUrl = await uploadImages();
      const activeAttrs = catAttrs.filter(a => (form.selectedAttrs[a.name] || []).length > 0);
      const isRental = form.productType === 'RENTAL';
      const pricing = isRental
        ? { sellingPrice: null, mrp: null, depositAmount: Number(form.depositAmount) || 0, rentAmount: Number(form.rentAmount) || 0 }
        : { sellingPrice: Number(form.sellingPrice), mrp: Number(form.mrp), depositAmount: null, rentAmount: null };
      const base = {
        name: form.name, category: form.category, subcategory: null,
        purchasePrice: Number(form.purchasePrice), ...pricing, stockQty: Number(form.stockQty),
        lowStockAlertQty: null, imageUrl, active: form.showToWebsite, festiveOffer: form.festiveOffer,
        hsnCode: form.hsnCode || null, gstRate: form.gstRate !== '' ? Number(form.gstRate) : null,
        rentalAvailable: form.rentalAvailable, productType: form.productType,
        description: form.description || null,
      };
      if (activeAttrs.length > 0) {
        const combos = cartesian(activeAttrs.map(a => form.selectedAttrs[a.name]));
        for (const combo of combos) {
          const attrsObj = {};
          activeAttrs.forEach((a, i) => { attrsObj[a.name] = combo[i]; });
          const suffix = combo.map(v => v.replace(/\s+/g,'').substring(0,3).toUpperCase()).join('-');
          await axios.post(`${API}/products`, {
            ...base,
            color: combo[0] || null,
            size: combo[1] || null,
            sku: `${form.sku}-${suffix}`,
            variantAttrs: JSON.stringify(attrsObj),
          });
        }
      } else if (form.colours.length > 0) {
        // One product per selected colour, each with its own photo (falls back to the general
        // Product Images above if a colour-specific photo wasn't uploaded).
        const otherVariants = form.variants.filter(v => v.name.trim() && v.value.trim());
        const attrsBase = {};
        otherVariants.forEach(v => { attrsBase[v.name.trim()] = v.value.trim(); });
        const sizeVal = otherVariants.find(v => v.name.trim().toLowerCase() === 'size')?.value?.trim() || null;
        for (const colour of form.colours) {
          const colourPhotoUrl = await uploadColourPhoto(colour);
          const suffix = colour.replace(/\s+/g,'').substring(0,3).toUpperCase();
          const perColourStock = form.colourStocks[colour] !== undefined && form.colourStocks[colour] !== ''
            ? Number(form.colourStocks[colour])
            : Number(form.stockQty) || 0;
          await axios.post(`${API}/products`, {
            ...base,
            stockQty: perColourStock,
            imageUrl: combineImages(colourPhotoUrl, imageUrl),
            colorPhotoUrl: colourPhotoUrl || null,
            color: colour, size: sizeVal,
            sku: `${form.sku}-${suffix}`,
            variantAttrs: JSON.stringify({...attrsBase, Colour: colour}),
          });
        }
      } else {
        await axios.post(`${API}/products`, { ...base, ...variantsToPayload(form.variants), sku: form.sku });
      }
      setForm(EMPTY_FORM);
      setImageSlots(makeEmptyImageSlots(maxPhotosForPlan(tenantInfo?.plan)));
      loadProducts();
      setShowAddForm(false);
      showToast('Product Successfully added');
    } catch (err) {
      const msg = err.response?.data?.error || '';
      showToast(msg.toLowerCase().includes('sku') && msg.toLowerCase().includes('exist')
        ? 'SKU already exist' : (msg || 'Failed to add product.'), 'error');
    }
  };

  const addProductToCart = (found) => {
    // Rental items have no selling price by design — they're booked (with deposit/rent
    // tracking) through the Rental page, not sold outright via Offline Billing.
    if (found.productType === 'RENTAL') {
      setScanError(`"${found.name}" is a Rental item — book it from the Rental page instead of Offline Billing.`);
      showToast(`${found.name} is a rental item — use the Rental page instead.`, 'error');
      setBarcode('');
      return;
    }
    setCart(prev => {
      const existing = prev.find(i => i.barcode === found.barcode);
      if (existing) return prev.map(i => i.barcode === found.barcode ? { ...i, quantity: i.quantity + 1 } : i);
      return [...prev, { barcode: found.barcode, name: found.name, quantity: 1, price: found.sellingPrice, gstRate: found.gstRate ?? null, hsnCode: found.hsnCode ?? null }];
    });
    setBarcode('');
    setScanError('');
  };

  const scanBarcode = async () => {
    const input = barcode.trim();
    if (!input) return;
    try {
      // Try barcode lookup first
      const res = await axios.get(`${API}/products/barcode/${input}`);
      addProductToCart(res.data);
    } catch {
      try {
        // Try SKU lookup
        const res = await axios.get(`${API}/products/sku/${input}`);
        addProductToCart(res.data);
      } catch {
        setScanError('Product not found for barcode/SKU: ' + input);
      }
    } finally {
      barcodeInputRef.current?.focus();
    }
  };

  const updateQty = (barcode, delta) => {
    setCart(prev =>
      prev.map(i => i.barcode === barcode ? { ...i, quantity: i.quantity + delta } : i)
          .filter(i => i.quantity > 0)
    );
  };

  const removeFromCart = (barcode) => {
    setCart(prev => prev.filter(i => i.barcode !== barcode));
  };

  const openEdit = (p) => {
    let editAttrValues = {};
    if (p.variantAttrs) {
      try { editAttrValues = JSON.parse(p.variantAttrs); } catch {}
    } else {
      if (p.color) editAttrValues['Color'] = p.color;
      if (p.size)  editAttrValues['Size']  = p.size;
    }
    // Ad-hoc variants (used when the product's category has no predefined attributes) —
    // editable name+value rows, not limited to Colour/Size. Colour is pulled out into its
    // own multi-select + per-colour-photo picker, same as Add Product.
    const colourEntry = Object.entries(editAttrValues).find(([name]) => ['colour','color'].includes(name.trim().toLowerCase()));
    const variants = Object.entries(editAttrValues)
      .filter(([name]) => !['colour','color'].includes(name.trim().toLowerCase()))
      .map(([name, value]) => ({ name, value }));
    const makeSlot = (url) => ({
      file: null,
      preview: url ? `${BACKEND}${url}` : null,
      serverUrl: url || null,
    });
    // The colour photo lives inside imageUrl too (for display elsewhere), so exclude it here —
    // otherwise it'd show twice: once in its own colour tile, once in the general images.
    const existingUrls = (p.imageUrl || '').split(',').filter(Boolean).filter(u => u !== p.colorPhotoUrl);

    // Sibling colour-variant products — same base SKU + category, created together via the
    // multi-colour bulk-add. Surfacing them here means the colour picker shows the WHOLE
    // family (not just this one product's own colour), and Save updates siblings in place
    // instead of trying to re-create them (which was crashing with "SKU already exists").
    const baseSku = baseSkuOf(p.sku);
    const siblings = products.filter(x => x.id !== p.id && x.category === p.category && x.color && baseSkuOf(x.sku) === baseSku);
    // Full sibling records (not just IDs) — saving needs their own name/price/stock/etc so an
    // update only touches colour/photo, without clobbering values that can legitimately differ
    // per colour (e.g. Blue might have different stock left than Black).
    const siblingByColour = {};
    siblings.forEach(s => { siblingByColour[s.color] = s; });

    const colours = colourEntry
      ? [colourEntry[1], ...siblings.map(s => s.color).filter(c => c && c !== colourEntry[1])]
      : [];
    const colorPhotos = {};
    if (colourEntry && p.colorPhotoUrl) colorPhotos[colourEntry[1]] = makeSlot(p.colorPhotoUrl);
    siblings.forEach(s => { if (s.colorPhotoUrl) colorPhotos[s.color] = makeSlot(s.colorPhotoUrl); });

    // Cap new upload slots to the plan's photo limit, but never drop existing photos (e.g. after a plan downgrade)
    const slotCount = Math.max(maxPhotosForPlan(tenantInfo?.plan), existingUrls.length);
    const siblingStocks = Object.fromEntries(siblings.map(s => [s.color, s.stockQty ?? 0]));
    setEditModal({
      id: p.id,
      name: p.name,
      category: p.category || '',
      sku: p.sku || '',
      description: p.description ?? '',
      purchasePrice: p.purchasePrice ?? '',
      sellingPrice: p.sellingPrice ?? '',
      mrp: p.mrp ?? '',
      productType: p.productType || 'OTHER',
      depositAmount: p.depositAmount ?? '',
      rentAmount: p.rentAmount ?? '',
      stockQty: p.stockQty ?? 0,
      color: p.color || '', size: p.size || '', barcode: p.barcode,
      editAttrValues,
      variants,
      colours,
      colorPhotos,
      siblingByColour,
      siblingStocks,
      showColourPicker: !!colourEntry,
      featured: p.featured ?? false,
      festiveOffer: p.festiveOffer ?? false,
      rentalAvailable: p.rentalAvailable ?? false,
      showToWebsite: p.active ?? false,
      imageSlots: Array.from({length: slotCount}, (_, i) => makeSlot(existingUrls[i])),
      hsnCode: p.hsnCode || '',
      gstRate: p.gstRate != null ? String(p.gstRate) : '',
    });
  };

  // Unchecking a colour never deleted its underlying product before — it just stayed out of
  // this save, so reopening Edit kept rediscovering it as a sibling. Deleting it is real data
  // loss (its own stock/barcode), so confirm first instead of doing it silently.
  const saveEdit = async () => {
    const removedColours = Object.keys(editModal.siblingByColour || {})
      .filter(c => !(editModal.colours || []).includes(c));
    if (removedColours.length === 0) {
      await performEditSave();
      return;
    }
    setConfirmDialog({
      title: `Remove Colour Variant${removedColours.length > 1 ? 's' : ''}`,
      message: `Unchecking ${removedColours.join(', ')} will permanently delete ${removedColours.length > 1 ? 'those colour products' : 'that colour product'} (SKU and stock included). This cannot be undone. Continue?`,
      onConfirm: async () => {
        setConfirmDialog(null);
        try {
          for (const c of removedColours) {
            const sib = editModal.siblingByColour[c];
            if (sib) await axios.delete(`${API}/products/${sib.id}`);
          }
        } catch (err) {
          showToast('Failed to remove colour variant: ' + (err.response?.data?.error || err.message), 'error');
          return;
        }
        await performEditSave();
      }
    });
  };

  const performEditSave = async () => {
    try {
    const savedUrls = [];
    for (const slot of editModal.imageSlots) {
      if (slot.file) {
        const fd = new FormData();
        fd.append('file', slot.file);
        const r = await axios.post(`${API}/upload`, fd, { headers: { 'Content-Type': 'multipart/form-data' } });
        savedUrls.push(r.data.url);
      } else if (slot.serverUrl) {
        savedUrls.push(slot.serverUrl);
      }
    }
    const imageUrl = savedUrls.join(',') || null;
    const editCatDef = tenantCategories.find(c => c.name === editModal.category);
    const editAttrs = editCatDef?.attributes || [];
    const attrVals = editModal.editAttrValues || {};
    const isRental = editModal.productType === 'RENTAL';
    const pricing = isRental
      ? { sellingPrice: null, mrp: null, depositAmount: Number(editModal.depositAmount) || 0, rentAmount: Number(editModal.rentAmount) || 0 }
      : { sellingPrice: Number(editModal.sellingPrice), mrp: Number(editModal.mrp), depositAmount: null, rentAmount: null };
    const base = {
      name: editModal.name,
      description: editModal.description,
      category: editModal.category,
      purchasePrice: Number(editModal.purchasePrice),
      ...pricing,
      productType: editModal.productType || 'OTHER',
      stockQty: Number(editModal.stockQty),
      lowStockAlertQty: null,
      featured: editModal.featured,
      festiveOffer: editModal.festiveOffer ?? false,
      rentalAvailable: editModal.rentalAvailable ?? false,
      active: editModal.showToWebsite,
      hsnCode: editModal.hsnCode || null,
      gstRate: editModal.gstRate !== '' && editModal.gstRate != null ? Number(editModal.gstRate) : null,
    };
      if (editAttrs.length > 0) {
        const color = attrVals[editAttrs[0]?.name] || null;
        const size = attrVals[editAttrs[1]?.name] || null;
        const variantAttrs = Object.keys(attrVals).length > 0 ? JSON.stringify(attrVals) : null;
        await axios.put(`${API}/products/${editModal.id}`, {
          ...base, color, size, variantAttrs, sku: editModal.sku, barcode: editModal.barcode, imageUrl,
        });
      } else {
        const otherVariants = (editModal.variants || []).filter(v => v.name.trim() && v.value.trim());
        const attrsBase = {};
        otherVariants.forEach(v => { attrsBase[v.name.trim()] = v.value.trim(); });
        const sizeVal = otherVariants.find(v => v.name.trim().toLowerCase() === 'size')?.value?.trim() || null;
        const colours = editModal.colours || [];
        const siblingByColour = editModal.siblingByColour || {};

        if (colours.length === 0) {
          const variantAttrs = Object.keys(attrsBase).length > 0 ? JSON.stringify(attrsBase) : null;
          await axios.put(`${API}/products/${editModal.id}`, {
            ...base, color: null, size: sizeVal, variantAttrs,
            sku: editModal.sku, barcode: editModal.barcode,
            imageUrl, colorPhotoUrl: null,
          });
        } else {
          // Whichever selected colour is still this product's own original colour stays on
          // this product; if that got deselected, just keep whatever's first in the list.
          const myColour = colours.includes(editModal.color) ? editModal.color : colours[0];
          const myPhotoUrl = await uploadEditColourPhoto(myColour);
          await axios.put(`${API}/products/${editModal.id}`, {
            ...base,
            color: myColour, size: sizeVal,
            variantAttrs: JSON.stringify({...attrsBase, Colour: myColour}),
            sku: editModal.sku, barcode: editModal.barcode,
            imageUrl: combineImages(myPhotoUrl, imageUrl),
            colorPhotoUrl: myPhotoUrl || null,
          });

          // Every other selected colour: if a sibling product for it already exists, update
          // it in place (only colour/photo — its own name/price/stock are left untouched, since
          // those can legitimately differ per colour). Otherwise create a new one, same as Add.
          for (const colour of colours.filter(c => c !== myColour)) {
            const colourPhotoUrl = await uploadEditColourPhoto(colour);
            const sibling = siblingByColour[colour];
            if (sibling) {
              const updatedSiblingStock = editModal.siblingStocks?.[colour] !== undefined
                ? Number(editModal.siblingStocks[colour])
                : sibling.stockQty;
              await axios.put(`${API}/products/${sibling.id}`, {
                name: sibling.name, category: sibling.category,
                purchasePrice: sibling.purchasePrice, sellingPrice: sibling.sellingPrice, mrp: sibling.mrp,
                productType: sibling.productType || 'OTHER', depositAmount: sibling.depositAmount, rentAmount: sibling.rentAmount,
                stockQty: updatedSiblingStock, lowStockAlertQty: null,
                featured: sibling.featured, festiveOffer: sibling.festiveOffer ?? false,
                rentalAvailable: sibling.rentalAvailable ?? false, active: sibling.active,
                color: colour, size: sizeVal,
                variantAttrs: JSON.stringify({...attrsBase, Colour: colour}),
                sku: sibling.sku, barcode: sibling.barcode,
                imageUrl: combineImages(colourPhotoUrl, imageUrl),
                colorPhotoUrl: colourPhotoUrl || null,
              });
            } else {
              const suffix = colour.replace(/\s+/g,'').substring(0,3).toUpperCase();
              await axios.post(`${API}/products`, {
                ...base,
                stockQty: editModal.siblingStocks?.[colour] !== undefined ? Number(editModal.siblingStocks[colour]) : 0,
                color: colour, size: sizeVal,
                variantAttrs: JSON.stringify({...attrsBase, Colour: colour}),
                sku: `${editModal.sku}-${suffix}`,
                imageUrl: combineImages(colourPhotoUrl, imageUrl),
                colorPhotoUrl: colourPhotoUrl || null,
              });
            }
          }
        }
      }
    } catch (err) {
      const msg = err.response?.data?.error || '';
      showToast(msg.toLowerCase().includes('sku') && msg.toLowerCase().includes('exist')
        ? 'SKU already exist' : (msg || 'Failed to save changes.'), 'error');
      return;
    }
    setEditModal(null);
    loadProducts();
    showToast('Product Successfully updated');
  };

  // Resolves the discount field (₹ or %) down to a plain rupee amount, capped at the subtotal.
  const calcDiscount = (subtotal) => {
    const v = Number(discountInput) || 0;
    if (discountType === 'PERCENT') return Math.min(subtotal * Math.min(v, 100) / 100, subtotal);
    return Math.min(v, subtotal);
  };

  const lookupCustomerByMobile = async (mobile) => {
    try {
      const res = await axios.get(`${API}/bills/customer-by-mobile/${mobile}`);
      if (res.data?.customerName) {
        setCustNameInput(res.data.customerName);
        setCustLookupFound(true);
      } else {
        setCustLookupFound(false);
      }
    } catch {
      setCustLookupFound(false);
    }
  };

  const generateBill = async (customerName, customerMobile, pmtType, pmtSplitEntries) => {
    try {
      const subtotal = cart.reduce((s, i) => s + Number(i.price) * i.quantity, 0);
      const discountAmount = calcDiscount(subtotal);
      const isSplit = pmtType === 'SPLIT' && pmtSplitEntries && pmtSplitEntries.length > 0;
      const payload = {
        customerName: (customerName || '').trim() || 'Walk-in Customer',
        customerMobile: (customerMobile || '').trim(),
        discountAmount,
        paymentMode: isSplit ? null : pmtType,
        splitPayments: isSplit
          ? pmtSplitEntries.map(e => ({ method: e.method, amount: parseFloat(e.amount) }))
          : null,
        items: cart.map(i => ({ barcode: i.barcode, quantity: i.quantity }))
      };
      const res = await axios.post(`${API}/bills`, payload);
      setLastBill(res.data);
      setLastBillId(res.data.id);
      setCart([]);
      setDiscountInput('');
      setDiscountType('AMOUNT');
      setBillError('');
      loadProducts();
      printBillReceipt(res.data, tenantInfo?.name);
      // Refocus the barcode field for the next customer. lastBill stays visible so
      // the cashier can still regenerate the receipt; they dismiss it with the × button.
      setTimeout(() => {
        barcodeInputRef.current?.focus();
      }, 3000);
      showToast('Bill Successfully generated');
    } catch {
      setBillError('Failed to generate bill. Please check backend is running and try again.');
      showToast('Failed to generate bill. Please check backend is running and try again.', 'error');
    }
  };

  const PAGE_SIZE = 10;
  const isSearching = inventorySearch.trim().length > 0;

  const filteredProducts = products.filter(p =>
    !isSearching ||
    p.name?.toLowerCase().includes(inventorySearch.toLowerCase()) ||
    p.sku?.toLowerCase().includes(inventorySearch.toLowerCase()) ||
    p.barcode?.toLowerCase().includes(inventorySearch.toLowerCase()) ||
    variantLabel(p).toLowerCase().includes(inventorySearch.toLowerCase()) ||
    p.category?.toLowerCase().includes(inventorySearch.toLowerCase())
  );

  const totalPages = isSearching ? 1 : Math.ceil(filteredProducts.length / PAGE_SIZE);
  const displayedProducts = isSearching
    ? filteredProducts
    : filteredProducts.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  const pageNumbers = (() => {
    if (totalPages <= 7) return Array.from({ length: totalPages }, (_, i) => i + 1);
    const near = new Set([1, totalPages, currentPage, currentPage - 1, currentPage + 1].filter(p => p >= 1 && p <= totalPages));
    const sorted = [...near].sort((a, b) => a - b);
    const result = [];
    let prev = 0;
    for (const p of sorted) {
      if (p - prev > 1) result.push('…');
      result.push(p);
      prev = p;
    }
    return result;
  })();

  // ── Stock alerts ──
  const lowStockItems  = products.filter(p => (p.stockQty ?? 0) < 5);
  const criticalItems  = lowStockItems.filter(p => p.stockQty === 0);
  const warningItems   = lowStockItems.filter(p => p.stockQty > 0);

  // ── Reports state ──
  const [rptStats, setRptStats] = useState(null);
  const [rptLoading, setRptLoading] = useState(false);
  const today = new Date().toISOString().slice(0, 10);
  const [rptFrom, setRptFrom] = useState('');
  const [rptTo,   setRptTo]   = useState('');
  const [rptRange, setRptRange] = useState('all');

  const loadReports = async (from, to) => {
    setRptLoading(true);
    try {
      const params = [];
      if (from) params.push(`from=${from}`);
      if (to)   params.push(`to=${to}`);
      const res = await axios.get(`${API}/admin/reports${params.length ? '?' + params.join('&') : ''}`);
      setRptStats(res.data);
    } catch(e) {} finally { setRptLoading(false); }
  };

  const applyRange = (range) => {
    setRptRange(range);
    const now = new Date();
    const fmt = d => d.toISOString().slice(0,10);
    if (range === 'today') { const t = fmt(now); setRptFrom(t); setRptTo(t); loadReports(t, t); }
    else if (range === 'week') { const s = new Date(now); s.setDate(now.getDate()-6); setRptFrom(fmt(s)); setRptTo(fmt(now)); loadReports(fmt(s), fmt(now)); }
    else if (range === 'month') { const s = new Date(now.getFullYear(), now.getMonth(), 1); setRptFrom(fmt(s)); setRptTo(fmt(now)); loadReports(fmt(s), fmt(now)); }
    else if (range === 'year')  { const s = new Date(now.getFullYear(), 0, 1); setRptFrom(fmt(s)); setRptTo(fmt(now)); loadReports(fmt(s), fmt(now)); }
    else { setRptFrom(''); setRptTo(''); loadReports('', ''); }
  };

  // Load reports when navigating to reports page
  // (handled in the useEffect below with activePage dependency)

  const fmt = v => Number(v || 0).toLocaleString('en-IN', {maximumFractionDigits:2});

  // Legacy POS-only stats (kept for backward compat with chart)
  const totalRevenue  = bills.reduce((s, b) => s + Number(b.grandTotal  || 0), 0);
  const totalBills    = bills.length;
  const avgBill       = totalBills > 0 ? totalRevenue / totalBills : 0;

  return (
    <div className={`app-layout${sidebarOpen ? ' sidebar-open' : ''}`} onClick={() => { showNotif && setShowNotif(false); }}>

      {/* Mobile sidebar overlay */}
      {sidebarOpen && <div className="sidebar-overlay" onClick={() => setSidebarOpen(false)} />}

      {/* ── Sidebar ── */}
      <nav className="sidebar">
        <div className="sidebar-brand">
          <div style={{position:'relative',flexShrink:0}}>
            {tenantInfo?.logoUrl
              ? <img src={logoSrc} alt="logo" className="sidebar-logo-img"
                  onError={e => { e.currentTarget.onerror = null; e.currentTarget.style.display = 'none'; }} />
              : <div className="sidebar-logo-img" style={{display:'flex',alignItems:'center',justifyContent:'center',fontSize:24,background:'rgba(255,255,255,0.15)'}}>🏪</div>
            }
            <button title="Edit shop name & logo" onClick={() => { setShopEditModal({name: tenantInfo?.name || '', address: tenantInfo?.shopAddress || '', phoneNumber: tenantInfo?.phoneNumber || '', bankAccountNumber: tenantInfo?.bankAccountNumber || '', confirmBankAccountNumber: tenantInfo?.bankAccountNumber || '', bankAccountHolderName: tenantInfo?.bankAccountHolderName || '', bankIfscCode: tenantInfo?.bankIfscCode || '', bankBranchName: tenantInfo?.bankBranchName || '', razorpayMerchantKeyId: tenantInfo?.razorpayMerchantKeyId || '', razorpayMerchantKeySecret: '', gstin: tenantInfo?.gstin || '', gstRegistered: tenantInfo?.gstRegistered || false, supplyType: tenantInfo?.supplyType || 'INTRA'}); setRzpHelpOpen(false); setShopLogoFile(null); setShopLogoPreview(null); }}
              style={{position:'absolute',bottom:-4,right:-4,width:20,height:20,background:'#fff',border:'1.5px solid #d1d5db',borderRadius:'50%',cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center',fontSize:11,padding:0,lineHeight:1}}>
              ✏️
            </button>
          </div>
          <div>
            <div className="sidebar-title">{tenantInfo?.name || getSubdomain().replace(/[-_]/g,' ').replace(/\b\w/g,c=>c.toUpperCase())}</div>
            {tenantInfo?.plan && <div className="sidebar-sub">{tenantInfo.plan} Plan</div>}
          </div>
        </div>

        <div className="sidebar-nav">
          <button className={`nav-item ${activePage==='home'?'nav-active':''}`} onClick={() => { setActivePage('home'); setSidebarOpen(false); }}>
            🏠 Home
          </button>
          <button className={`nav-item ${activePage==='reports'?'nav-active':''}`} onClick={() => { setActivePage('reports'); setSidebarOpen(false); }}>
            📊 Reports
          </button>
          <button className={`nav-item ${activePage==='customers'?'nav-active':''}`} onClick={() => { setActivePage('customers'); setSidebarOpen(false); }}>
            👥 Customers
          </button>
          <button className={`nav-item ${activePage==='orders'?'nav-active':''}`} onClick={() => { setActivePage('orders'); setSidebarOpen(false); }}>
            🛒 Orders
          </button>
          {tenantInfo?.subdomain === 'gosuas' && (
            <button className={`nav-item ${activePage==='rental'?'nav-active':''}`} onClick={() => { setActivePage('rental'); setSidebarOpen(false); }}>
              🔑 Rental
            </button>
          )}
          <button className={`nav-item ${activePage==='alerts'?'nav-active':''}`} onClick={() => { setActivePage('alerts'); setSidebarOpen(false); }}>
            ⚠ Stock Alerts
            {lowStockItems.length > 0 && <span className="alert-count-badge" style={{marginLeft:6}}>{lowStockItems.length}</span>}
          </button>
          <button className={`nav-item ${activePage==='plan'?'nav-active':''}`} onClick={() => { setActivePage('plan'); setSidebarOpen(false); }}>
            💎 My Plan
          </button>
          <button className={`nav-item ${activePage==='returns'?'nav-active':''}`} onClick={() => { setActivePage('returns'); setSidebarOpen(false); }}>
            🔄 Sales Returns
          </button>
          <button className={`nav-item ${activePage==='damage'?'nav-active':''}`} onClick={() => { setActivePage('damage'); setSidebarOpen(false); }}>
            🗑 Damage Stock
          </button>
          <button className={`nav-item ${activePage==='expenses'?'nav-active':''}`} onClick={() => { setActivePage('expenses'); setSidebarOpen(false); }}>
            💸 Expenses
          </button>
          <button className={`nav-item ${activePage==='print-labels'?'nav-active':''}`} onClick={() => { setActivePage('print-labels'); setSidebarOpen(false); setBulkSelectedIds(new Set()); }}>
            🏷 Print Labels
          </button>
        </div>

        {lowStockItems.length > 0 && (
          <div className="sidebar-alerts">
            <div className="sidebar-alert-title">⚠ Stock Alerts <span className="alert-count-badge">{lowStockItems.length}</span></div>
            {criticalItems.slice(0,3).map(p => (
              <div key={p.id} className="sb-alert-item sb-critical">
                <span className="sb-alert-name">{p.name}{variantLabel(p) ? ` (${variantLabel(p)})` : ''}</span>
                <span className="sb-alert-tag">OUT</span>
              </div>
            ))}
            {warningItems.slice(0,3).map(p => (
              <div key={p.id} className="sb-alert-item sb-warning">
                <span className="sb-alert-name">{p.name}{variantLabel(p) ? ` (${variantLabel(p)})` : ''}</span>
                <span className="sb-alert-tag">{p.stockQty}</span>
              </div>
            ))}
            {lowStockItems.length > 6 && <div className="sb-alert-more">+{lowStockItems.length-6} more items</div>}
          </div>
        )}

        <button className="sidebar-logout" onClick={() => { handleLogout(); setSidebarOpen(false); }}>⏻ Logout</button>
      </nav>

      {/* ── Main area ── */}
      <div className="main-area">

        {/* Top header bar */}
        <div className="top-header">
          <button className="hamburger-btn" onClick={e => { e.stopPropagation(); setSidebarOpen(o => !o); }}>
            {sidebarOpen ? '✕' : '☰'}
          </button>
          <h2 className="page-title">{{ home:'Home', reports:'Reports', customers:'Customers', orders:'Orders', rental:'Rental', alerts:'Stock Alerts', 'print-labels':'Print Labels', plan:'My Plan & Billing', returns:'Sales Returns', damage:'Damage Stock', expenses:'Expenses' }[activePage] || 'Home'}</h2>
          <div className="header-right" onClick={e => e.stopPropagation()}>
            <a href={`https://${getSubdomain()}.theshopclaude.com/shops`} target="_blank" rel="noreferrer"
              title="Visit your store"
              style={{display:'flex',alignItems:'center',justifyContent:'center',width:36,height:36,borderRadius:10,background:'#EFF6FF',border:'1.5px solid #BFDBFE',textDecoration:'none',fontSize:18,flexShrink:0}}>
              🏪
            </a>
            <div className="notif-wrap">
              <button className="notif-btn" onClick={() => setShowNotif(s => !s)}>
                🔔
                {lowStockItems.length > 0 && (
                  <span className={`notif-badge ${criticalItems.length > 0 ? 'badge-critical' : 'badge-warning'}`}>
                    {lowStockItems.length}
                  </span>
                )}
              </button>
              {showNotif && (
                <div className="notif-dropdown">
                  <div className="notif-hdr">Stock Alerts</div>
                  {lowStockItems.length === 0 && <div className="notif-empty">✓ All items are well-stocked</div>}
                  {criticalItems.length > 0 && <>
                    <div className="notif-section-lbl critical-lbl">🔴 Out of Stock</div>
                    {criticalItems.map(p => (
                      <div key={p.id} className="notif-row">
                        <span>{p.name}{variantLabel(p) ? ` (${variantLabel(p)})` : ''}</span>
                        <span className="notif-stock-tag out-tag">OUT</span>
                      </div>
                    ))}
                  </>}
                  {warningItems.length > 0 && <>
                    <div className="notif-section-lbl warning-lbl">🟠 Low Stock (&lt;5 units)</div>
                    {warningItems.map(p => (
                      <div key={p.id} className="notif-row">
                        <span>{p.name}{variantLabel(p) ? ` (${variantLabel(p)})` : ''}</span>
                        <span className="notif-stock-tag low-tag">{p.stockQty} left</span>
                      </div>
                    ))}
                  </>}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* ── HOME PAGE ── */}
        {activePage === 'home' && <div className="page-content">
        <section>
          <h2>Offline Billing</h2>
          <div className="barcode-row">
            <input
              ref={barcodeInputRef}
              placeholder="Scan barcode or enter SKU"
              autoFocus
              value={barcode}
              onChange={e => setBarcode(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && scanBarcode()}
            />
            <button onClick={scanBarcode}>Add to Cart</button>
          </div>
          {scanError && <p className="error-msg">{scanError}</p>}

          <ul className="cart-list">
            {cart.length === 0 && <li className="cart-empty">No items in cart</li>}
            {cart.map((i, idx) => (
              <li key={idx}>
                <span className="cart-name">{i.name}</span>
                <div className="cart-controls">
                  <button className="qty-btn" onClick={() => updateQty(i.barcode, -1)}>−</button>
                  <span className="qty-num">{i.quantity}</span>
                  <button className="qty-btn" onClick={() => updateQty(i.barcode, 1)}>+</button>
                  <span className="cart-price">₹{(Number(i.price) * i.quantity).toFixed(2)}</span>
                  <button className="remove-btn" onClick={() => removeFromCart(i.barcode)}>✕</button>
                </div>
              </li>
            ))}
          </ul>

          {cart.length > 0 && (() => {
            const subtotal = cart.reduce((s, i) => s + Number(i.price) * i.quantity, 0);
            const discount = calcDiscount(subtotal);
            return (
              <>
                <div className="discount-row">
                  <span>Discount <em>optional</em></span>
                  <div className="discount-input-group">
                    <select value={discountType} onChange={e => setDiscountType(e.target.value)}>
                      <option value="AMOUNT">₹</option>
                      <option value="PERCENT">%</option>
                    </select>
                    <input type="number" min="0" max={discountType === 'PERCENT' ? 100 : subtotal} placeholder="0"
                      value={discountInput} onChange={e => setDiscountInput(e.target.value)} />
                  </div>
                </div>
                {discount > 0 && (
                  <div className="cart-total-row cart-subtotal-row">
                    <span>Subtotal</span>
                    <span>₹{subtotal.toFixed(2)}</span>
                  </div>
                )}
                {discount > 0 && (
                  <div className="cart-total-row cart-subtotal-row">
                    <span>Discount{discountType === 'PERCENT' ? ` (${Number(discountInput)||0}%)` : ''}</span>
                    <span>− ₹{discount.toFixed(2)}</span>
                  </div>
                )}
                <div className="cart-total-row">
                  <span>Total</span>
                  <strong>₹{(subtotal - discount).toFixed(2)}</strong>
                </div>
                {tenantInfo?.gstRegistered && (() => {
                  const grandTotal = subtotal - discount;
                  const isInter = tenantInfo?.supplyType === 'INTER';
                  let totalTaxable = 0, totalCgst = 0, totalSgst = 0, totalIgst = 0;
                  cart.forEach(i => {
                    const rate = i.gstRate ? Number(i.gstRate) : 0;
                    const effectiveLine = (Number(i.price) * i.quantity) * (subtotal > 0 ? grandTotal / subtotal : 1);
                    if (rate > 0) {
                      const taxable = effectiveLine / (1 + rate / 100);
                      const gst = effectiveLine - taxable;
                      totalTaxable += taxable;
                      if (isInter) totalIgst += gst;
                      else { totalCgst += gst / 2; totalSgst += gst / 2; }
                    } else {
                      totalTaxable += effectiveLine;
                    }
                  });
                  const totalGst = totalCgst + totalSgst + totalIgst;
                  if (totalGst === 0) return null;
                  return (
                    <div className="gst-breakdown">
                      <div className="cart-total-row gst-row"><span>Taxable Value</span><span>₹{totalTaxable.toFixed(2)}</span></div>
                      {isInter
                        ? <div className="cart-total-row gst-row"><span>IGST</span><span>₹{totalIgst.toFixed(2)}</span></div>
                        : <><div className="cart-total-row gst-row"><span>CGST</span><span>₹{totalCgst.toFixed(2)}</span></div>
                           <div className="cart-total-row gst-row"><span>SGST</span><span>₹{totalSgst.toFixed(2)}</span></div></>
                      }
                      <div className="cart-total-row gst-row gst-total-row"><span>Total GST</span><span>₹{totalGst.toFixed(2)}</span></div>
                    </div>
                  );
                })()}
              </>
            );
          })()}

          <button disabled={!cart.length} onClick={() => { setCustNameInput(''); setCustMobileInput(''); setCustLookupFound(false); setPaymentType('CASH'); setSplitEntries([{ method: 'CASH', amount: '' }]); setSplitError(''); setCustModal(true); }}>Generate Bill</button>
          {billError && <p className="error-msg">{billError}</p>}

          {lastBill && (
            <div className="bill-result">
              <div className="bill-result-header">
                <span className="bill-result-title">Bill Generated</span>
                <button className="bill-result-dismiss" title="Dismiss" onClick={() => { setLastBill(null); setLastBillId(null); barcodeInputRef.current?.focus(); }}>×</button>
              </div>
              <div className="bill-result-row">
                <span>Bill No:</span><strong>{lastBill.billNo || '—'}</strong>
              </div>
              <div className="bill-result-row">
                <span>Total:</span><strong>₹{fmt(lastBill.grandTotal)}</strong>
              </div>
              <div className="bill-result-row">
                <span>Status:</span><span className="paid-badge">{lastBill.paymentStatus || 'PAID'}</span>
              </div>
              <button className="print-again-btn" onClick={() => printBillReceipt(lastBill, tenantInfo?.name)}>
                🖨 Reprint Receipt
              </button>
              <button className="regenerate-bill-btn" onClick={() => printBillReceipt(lastBill, tenantInfo?.name)}>
                ↺ Regenerate Bill
              </button>
            </div>
          )}
          {!lastBill && lastBillId && (
            <div className="bill-result bill-result-compact">
              <div className="bill-result-header">
                <span className="bill-result-title">Last bill saved</span>
                <button className="bill-result-dismiss" title="Clear" onClick={() => { setLastBillId(null); }}>×</button>
              </div>
              <button
                className="regenerate-bill-btn"
                disabled={regeneratingBill}
                onClick={async () => {
                  setRegeneratingBill(true);
                  setBillError('');
                  try {
                    const res = await axios.get(`${API}/bills/${lastBillId}`);
                    setLastBill(res.data);
                    printBillReceipt(res.data, tenantInfo?.name);
                  } catch {
                    setBillError('Could not retrieve the bill. Please check your connection.');
                  } finally {
                    setRegeneratingBill(false);
                  }
                }}
              >
                {regeneratingBill ? 'Retrieving…' : '↺ Regenerate Bill'}
              </button>
            </div>
          )}
        </section>

        {/* ── Expense Quick Widget ── */}
        <section style={{marginTop:24,paddingTop:20,borderTop:'1.5px solid #e5e7eb'}}>
          <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:14,flexWrap:'wrap',gap:10}}>
            <h2 style={{margin:0,fontSize:16,fontWeight:700}}>💸 Expenses</h2>
            <button className="btn-primary" style={{fontSize:13}} onClick={() => { setActivePage('expenses'); setSidebarOpen(false); }}>
              + Add Expense
            </button>
          </div>
          {expenseSummary && (
            <div style={{display:'flex',gap:12,flexWrap:'wrap'}}>
              {[
                { label:'Today',      value: expenseSummary.totalToday,  color:'#dc2626' },
                { label:'This Week',  value: expenseSummary.totalWeek,   color:'#d97706' },
                { label:'This Month', value: expenseSummary.totalMonth,  color:'#7c3aed' },
              ].map(c => (
                <div key={c.label} className="rpt-card" style={{flex:'1 1 140px',minWidth:0,borderTop:`3px solid ${c.color}`}}>
                  <div className="rpt-card-label">{c.label}</div>
                  <div className="rpt-card-value" style={{color:c.color}}>₹{fmt(c.value)}</div>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* ── Add Product modal ── */}
        {showAddForm && (
          <div className="modal-overlay" onClick={() => setShowAddForm(false)}>
            <div className="modal-box" style={{width:600,maxWidth:'95vw',maxHeight:'90vh',overflowY:'auto'}} onClick={e => e.stopPropagation()}>
              <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:12}}>
                <h2 style={{margin:0}}>Add Product</h2>
                <button type="button" style={{background:'none',border:'none',fontSize:22,cursor:'pointer',color:'#666',lineHeight:1,padding:'0 4px'}} onClick={() => setShowAddForm(false)}>×</button>
              </div>
              <form onSubmit={createProduct}>

            {tenantInfo?.subdomain === 'gosuas' && (
              <>
                <label className="modal-label">Product Type</label>
                <select value={form.productType}
                  onChange={e => setForm(f => ({...f, productType: e.target.value}))}
                  style={{marginBottom:10}}>
                  <option value="OTHER">Other (Sell)</option>
                  <option value="RENTAL">Rental</option>
                </select>
              </>
            )}
            <input
              placeholder="Product Name"
              value={form.name}
              onChange={e => setForm({...form, name: e.target.value})}
              required
            />
            <input
              type="text"
              placeholder="Product Description (optional)"
              value={form.description}
              onChange={e => setForm({...form, description: e.target.value})}
            />
            {form.category === '__new__' ? (
              <div style={{background:'#faf7f2',border:'1.5px solid #d4b896',borderRadius:8,padding:'12px 14px',display:'flex',flexDirection:'column',gap:10}}>
                <div style={{fontWeight:600,fontSize:13,color:'#1E3A5F'}}>New Category</div>
                <input autoFocus placeholder="Category name (e.g. T-Shirts, Bangles, Books)"
                  value={newCatDraft.name} onChange={e => setNewCatDraft(d => ({...d, name: e.target.value}))}
                  onKeyDown={e => { if (e.key === 'Escape') { setForm(f => ({...f, category:''})); setNewCatDraft({name:'',attributes:[]}); setNewAttrDraft({name:'',options:''}); }}}
                  style={{fontSize:14}} />

                {/* Attribute builder */}
                <div style={{fontSize:12,color:'#888'}}>Add attributes (e.g. Color, Size, Material, Genre, Pattern)</div>
                <div style={{display:'flex',gap:6,alignItems:'flex-start'}}>
                  <input placeholder="Attribute name" value={newAttrDraft.name}
                    onChange={e => setNewAttrDraft(d => ({...d, name: e.target.value}))}
                    style={{fontSize:13,width:'110px',flexShrink:0}} />
                  <div style={{flex:1}}>
                    <input placeholder="Options (comma-separated): Red, Blue, Green" value={newAttrDraft.options}
                      onChange={e => setNewAttrDraft(d => ({...d, options: e.target.value}))}
                      style={{fontSize:13,width:'100%'}} />
                    {/* Preset suggestions based on attribute name */}
                    {(() => {
                      const preset = Object.values(PRESET_ATTRS).find(p => p.match.test(newAttrDraft.name));
                      if (!preset || !newAttrDraft.name.trim()) return null;
                      const cur = newAttrDraft.options.split(',').map(x=>x.trim()).filter(Boolean);
                      return (
                        <div style={{marginTop:4,display:'flex',flexWrap:'wrap',gap:3}}>
                          {preset.options.filter(o => !cur.includes(o)).map(o => (
                            <span key={o} onClick={() => setNewAttrDraft(d => ({...d, options: [...cur, o].join(', ')}))}
                              style={{fontSize:11,padding:'2px 7px',background:'#D5E5F5',borderRadius:10,cursor:'pointer',color:'#1E3A5F'}}>+{o}</span>
                          ))}
                        </div>
                      );
                    })()}
                  </div>
                  <button type="button" onClick={() => {
                    const name = newAttrDraft.name.trim();
                    const opts = newAttrDraft.options.split(',').map(x=>x.trim()).filter(Boolean);
                    if (!name || opts.length === 0) return;
                    setNewCatDraft(d => ({...d, attributes: [...d.attributes, {name, options: opts}]}));
                    setNewAttrDraft({name:'', options:''});
                  }} style={{padding:'6px 10px',background:'#F5971E',color:'#111',border:'none',borderRadius:6,cursor:'pointer',fontWeight:700,fontSize:13,flexShrink:0}}>
                    + Add
                  </button>
                </div>

                {/* List of added attributes */}
                {newCatDraft.attributes.length > 0 && (
                  <div style={{background:'#fff8f0',borderRadius:6,padding:'8px 10px',display:'flex',flexDirection:'column',gap:5}}>
                    {newCatDraft.attributes.map((attr, i) => (
                      <div key={i} style={{display:'flex',alignItems:'center',gap:8,fontSize:13}}>
                        <span style={{fontWeight:600,color:'#1E3A5F',minWidth:70}}>{attr.name}</span>
                        <span style={{color:'#666',flex:1,fontSize:12}}>{attr.options.join(', ')}</span>
                        <button type="button" onClick={() => setNewCatDraft(d => ({...d, attributes: d.attributes.filter((_,j)=>j!==i)}))}
                          style={{background:'none',border:'none',cursor:'pointer',color:'#c33',fontSize:18,padding:0,lineHeight:1}}>×</button>
                      </div>
                    ))}
                  </div>
                )}

                <div style={{display:'flex',gap:8}}>
                  <button type="button" onClick={() => {
                    const name = newCatDraft.name.trim();
                    if (!name) return;
                    const newCat = {name, attributes: newCatDraft.attributes};
                    const updated = [...tenantCategories, newCat];
                    setTenantCategories(updated);
                    saveTenantCategories(updated);
                    setForm(f => ({...f, category: name, selectedAttrs: {}}));
                    setNewCatDraft({name:'', attributes:[]});
                    setNewAttrDraft({name:'', options:''});
                    showToast('Category Successfully added');
                  }} style={{padding:'6px 16px',background:'#1E3A5F',color:'#fff',border:'none',borderRadius:6,cursor:'pointer',fontWeight:600,fontSize:13}}>
                    Add Category
                  </button>
                  <button type="button" onClick={() => { setForm(f => ({...f, category:''})); setNewCatDraft({name:'',attributes:[]}); setNewAttrDraft({name:'',options:''}); }}
                    style={{padding:'6px 12px',background:'#eee',border:'none',borderRadius:6,cursor:'pointer',fontSize:13}}>
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <select value={form.category}
                onChange={e => {
                  setForm(f => ({...f, category: e.target.value, selectedAttrs: {}}));
                }} required>
                <option value="">Select Category</option>
                {tenantCategories.map(c => <option key={c.name} value={c.name}>{c.name}</option>)}
                <option value="__new__">+ Add New Category</option>
              </select>
            )}

            {catAttrs.length > 0 && form.category && form.category !== '__new__' && (
              <>
                {catAttrs.map(attr => (
                  <ChipGroup key={attr.name} label={attr.name} options={attr.options}
                    selected={form.selectedAttrs[attr.name] || []}
                    onToggle={val => toggleAttr(attr.name, val)}
                    onSelectAll={() => setForm(f => ({...f, selectedAttrs: {...f.selectedAttrs, [attr.name]: [...attr.options]}}))}
                    onClear={() => setForm(f => ({...f, selectedAttrs: {...f.selectedAttrs, [attr.name]: []}}))}
                  />
                ))}
                {(() => {
                  const active = catAttrs.filter(a => (form.selectedAttrs[a.name]||[]).length > 0);
                  if (active.length === 0) return null;
                  const total = active.reduce((acc, a) => acc * (form.selectedAttrs[a.name]||[]).length, 1);
                  const desc = active.map(a => `${(form.selectedAttrs[a.name]||[]).length} ${a.name}`).join(' × ');
                  return <p className="combo-info">Will create <strong>{total}</strong> product{total > 1 ? 's' : ''} ({desc})</p>;
                })()}
              </>
            )}

            {catAttrs.length === 0 && (
              <div className="variants-section">
                <div className="modal-label">Variants <span style={{fontWeight:400,color:'#9ca3af',textTransform:'none',letterSpacing:0}}>(optional — Colour, Size, or add your own)</span></div>

                {form.showColourPicker && (
                  <div className="variant-block">
                    <ChipGroup label="Colour" options={COLOR_PRESETS} selected={form.colours}
                      onToggle={toggleColour}
                      onSelectAll={() => setForm(f => ({...f, colours: [...COLOR_PRESETS]}))}
                      onClear={() => setForm(f => ({...f, colours: [], colorPhotos: {}}))} />
                    {form.colours.length > 0 && (
                      <div className="colour-photo-row">
                        <div className="modal-label" style={{marginTop:8}}>Photo per colour <span style={{fontWeight:400,color:'#9ca3af',textTransform:'none',letterSpacing:0}}>(optional — falls back to Product Images below if skipped)</span></div>
                        <div className="colour-photo-tiles">
                          {form.colours.map(c => (
                            <label key={c} className="colour-photo-tile">
                              {form.colorPhotos[c]?.preview ? (
                                <img src={form.colorPhotos[c].preview} alt={c} />
                              ) : (
                                <span className="colour-photo-plus">＋</span>
                              )}
                              <input type="file" accept="image/*" style={{display:'none'}}
                                onChange={e => { const f = e.target.files?.[0]; if (f) setColourPhoto(c, f); }} />
                              <span className="colour-photo-label">
                                {COLOR_CSS[c] && <span className="csf-swatch" style={{background: COLOR_CSS[c]}} />}
                                {c}
                              </span>
                            </label>
                          ))}
                        </div>
                        <div className="modal-label" style={{marginTop:12}}>Stock per colour <span style={{fontWeight:400,color:'#9ca3af',textTransform:'none',letterSpacing:0}}>(leave blank to use the Stock Quantity field below for all)</span></div>
                        <div className="colour-stock-list">
                          {form.colours.map(c => (
                            <div key={c} className="colour-stock-item">
                              {COLOR_CSS[c] && <span className="csf-swatch" style={{background: COLOR_CSS[c], flexShrink:0}} />}
                              <span className="colour-stock-name">{c}</span>
                              <input type="number" min="0" className="colour-stock-input"
                                placeholder="Qty"
                                value={form.colourStocks[c] ?? ''}
                                onChange={e => setForm(f => ({...f, colourStocks: {...f.colourStocks, [c]: e.target.value}}))} />
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {form.variants.map((v, idx) => (
                  <div key={idx} className="variant-block">
                    <div className="variant-block-head">
                      <input className="variant-name-inp" placeholder="Variant name e.g. Material"
                        value={v.name} onChange={e => updateVariantRow(idx, { name: e.target.value })} />
                      <button type="button" className="variant-remove-btn" onClick={() => removeVariantRow(idx)}>✕</button>
                    </div>
                    {v.name.trim().toLowerCase() === 'size' ? (
                      <ColorSizeInput label="" presets={SIZE_PRESETS}
                        value={v.value} onChange={val => updateVariantRow(idx, { value: val })} />
                    ) : (
                      <input placeholder="Value" value={v.value} onChange={e => updateVariantRow(idx, { value: e.target.value })} />
                    )}
                  </div>
                ))}
                <div className="variant-add-row">
                  {!form.showColourPicker && (
                    <button type="button" className="chip-action" onClick={() => setForm(f => ({...f, showColourPicker: true}))}>+ Colour</button>
                  )}
                  <button type="button" className="chip-action" onClick={() => addVariantRow('Size')}>+ Size</button>
                  <button type="button" className="chip-action" onClick={() => addVariantRow('')}>+ Custom Variant</button>
                </div>
              </div>
            )}

            <input
              placeholder="SKU Code (base)"
              value={form.sku}
              onChange={e => setForm({...form, sku: e.target.value})}
              required
            />
            {(form.productType === 'RENTAL'
              ? ['purchasePrice','depositAmount','rentAmount','stockQty']
              : ['purchasePrice','sellingPrice','mrp','stockQty']
            ).map(k => (
              <input
                key={k}
                type="number"
                placeholder={FIELD_LABELS[k]}
                value={form[k]}
                onChange={e => setForm({...form, [k]: e.target.value})}
                min="0"
              />
            ))}
            {tenantInfo?.gstRegistered && (
              <div style={{display:'flex',gap:8,marginTop:4}}>
                <input
                  placeholder="HSN / SAC Code (optional)"
                  value={form.hsnCode}
                  onChange={e => setForm({...form, hsnCode: e.target.value})}
                  style={{flex:2}}
                />
                <select value={form.gstRate} onChange={e => setForm({...form, gstRate: e.target.value})} style={{flex:1,padding:'8px 10px',border:'1.5px solid #e5e7eb',borderRadius:8,fontSize:14,background:'#fff',outline:'none'}}>
                  <option value="">GST Rate</option>
                  <option value="0">0% (Exempt)</option>
                  <option value="5">5%</option>
                  <option value="12">12%</option>
                  <option value="18">18%</option>
                  <option value="28">28%</option>
                </select>
              </div>
            )}
            <label className="modal-label">Product Images (up to {maxPhotosForPlan(tenantInfo?.plan)}) <span style={{fontWeight:400,color:'#9ca3af'}}>— {tenantInfo?.plan === 'PRO' ? 'PRO plan' : 'upgrade to PRO for up to 6 photos'}</span></label>
            <div className="edit-img-slots">
              {imageSlots.map((slot, idx) => (
                <div key={idx} className="edit-img-slot">
                  {slot.preview
                    ? <>
                        <img src={slot.preview} alt={`img${idx+1}`} className="edit-slot-thumb" />
                        <button type="button" className="edit-slot-remove"
                          onClick={() => setImageSlots(s => s.map((sl,i) => i===idx ? {file:null,preview:null} : sl))}>✕</button>
                      </>
                    : <label className="edit-slot-add">
                        <span>＋</span>
                        <small>Image {idx + 1}</small>
                        <input type="file" accept="image/*" style={{display:'none'}}
                          onChange={e => {
                            const f = e.target.files[0];
                            if (f) setImageSlots(s => s.map((sl,i) => i===idx ? {file:f,preview:URL.createObjectURL(f)} : sl));
                          }} />
                      </label>
                  }
                </div>
              ))}
            </div>
            <label className="edit-featured-toggle" style={{margin:'8px 0'}}>
              <input type="checkbox" checked={form.showToWebsite}
                onChange={e => setForm(f => ({...f, showToWebsite: e.target.checked}))} />
              <span>🌐 Show on Website</span>
            </label>
            <label className="edit-featured-toggle" style={{margin:'4px 0 8px'}}>
              <input type="checkbox" checked={form.festiveOffer || false}
                onChange={e => setForm(f => ({...f, festiveOffer: e.target.checked}))} />
              <span>🎉 Seasonal / Festive Offer</span>
            </label>
            {tenantInfo?.subdomain === 'gosuas' && (
              <label className="edit-featured-toggle" style={{margin:'4px 0 8px'}}>
                <input type="checkbox" checked={form.rentalAvailable || false}
                  onChange={e => setForm(f => ({...f, rentalAvailable: e.target.checked}))} />
                <span>🔑 Available for Rental</span>
              </label>
            )}
            <button>
              {(() => {
                const active = catAttrs.filter(a => (form.selectedAttrs[a.name]||[]).length > 0);
                const total = active.length > 0 ? active.reduce((acc, a) => acc * (form.selectedAttrs[a.name]||[]).length, 1) : 0;
                return total > 1 ? `Add ${total} Products` : 'Add Product';
              })()}
            </button>

              </form>
            </div>
          </div>
        )}

          <section className="inventory-section">
            <div className="inventory-header">
              <h2>Inventory</h2>
              <button style={{background:'#1E3A5F',color:'#fff',border:'none',borderRadius:6,padding:'7px 14px',fontSize:13,fontWeight:600,cursor:'pointer',whiteSpace:'nowrap',flexShrink:0}} onClick={() => setShowAddForm(true)}>+ Add Product</button>
              <input className="search-input" placeholder="Search by name, SKU, colour or barcode..."
                value={inventorySearch} onChange={e => setInventorySearch(e.target.value)} />
              <button className="export-csv-btn" onClick={() => exportToCsv('inventory.csv', filteredProducts, [
                { label: 'Name', key: 'name' },
                { label: 'Category', key: 'category' },
                { label: 'Variant', key: r => variantLabel(r) },
                { label: 'SKU', key: 'sku' },
                { label: 'Barcode', key: 'barcode' },
                { label: 'Stock', key: 'stockQty' },
                { label: 'Price', key: 'sellingPrice' },
              ])}>⬇ Export CSV</button>
            </div>
            <div className="table-meta">
              {isSearching
                ? `${filteredProducts.length} result${filteredProducts.length !== 1 ? 's' : ''} found`
                : `Showing ${filteredProducts.length === 0 ? 0 : (currentPage-1)*PAGE_SIZE+1}–${Math.min(currentPage*PAGE_SIZE, filteredProducts.length)} of ${filteredProducts.length}`}
            </div>
            <div className="table-scroll-wrap">
            <table>
              <thead>
                <tr><th>Name</th><th>Category</th><th>Variants</th><th>SKU</th><th>Barcode</th><th>Stock</th><th>Price</th><th>Barcode Image</th><th>Label</th><th>Edit</th><th>Delete</th></tr>
              </thead>
              <tbody>
                {displayedProducts.length === 0 && (
                  <tr><td colSpan={11} style={{textAlign:'center',color:'#888',padding:'16px'}}>No products found</td></tr>
                )}
                {displayedProducts.map(p => {
                  const suggested = 'two-row';
                  const isLow = (p.stockQty ?? 0) < 5;
                  const isOut = p.stockQty === 0;
                  return (
                    <tr key={p.id} className={isOut ? 'row-critical' : isLow ? 'row-warning' : ''}>
                      <td>{p.name}</td><td>{p.category}{p.subcategory ? <div style={{fontSize:'11px',color:'#888'}}>{p.subcategory}</div> : ''}</td>
                      <td>{variantLabel(p) || '—'}</td>
                      <td>{p.sku}</td><td>{p.barcode}</td>
                      <td><span className={isOut ? 'stock-out' : isLow ? 'stock-low' : ''}>{isOut ? '⚠ OUT' : p.stockQty}</span></td>
                      <td>{p.productType === 'RENTAL' ? `Dep ₹${p.depositAmount ?? 0} + Rent ₹${p.rentAmount ?? 0}` : `₹${p.sellingPrice}`}</td>
                      <td><img src={`${API}/barcodes/${p.barcode}`} alt={p.barcode} /></td>
                      <td><button className="label-btn" onClick={() => setLabelModal({product:p, stickerType:suggested, qty:1})}>🏷 Print</button></td>
                      <td><button className="edit-btn" onClick={() => openEdit(p)}>✏ Edit</button></td>
                      <td><button className="delete-btn" onClick={() => { if(window.confirm(`Delete "${p.name}"?`)) axios.delete(`${API}/products/${p.id}`).then(() => { loadProducts(); showToast('Product deleted'); }).catch(err => showToast(err.response?.data?.error || 'Failed to delete product.', 'error')); }}>🗑 Delete</button></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            </div>{/* end table-scroll-wrap */}
            {!isSearching && totalPages > 1 && (
              <div className="pagination">
                <button className="pg-btn" onClick={() => setCurrentPage(p=>Math.max(1,p-1))} disabled={currentPage===1}>‹ Prev</button>
                {pageNumbers.map((pg, i) => pg==='…'
                  ? <span key={`e${i}`} className="pg-ellipsis">…</span>
                  : <button key={pg} className={`pg-btn ${pg===currentPage?'pg-active':''}`} onClick={() => setCurrentPage(pg)}>{pg}</button>
                )}
                <button className="pg-btn" onClick={() => setCurrentPage(p=>Math.min(totalPages,p+1))} disabled={currentPage===totalPages}>Next ›</button>
              </div>
            )}
          </section>

          {/* ── Digital PDF Products ── */}
          {digitalProducts.length > 0 && (
            <section style={{marginTop:0}}>
              <h2 style={{display:'flex',alignItems:'center',gap:8}}>📄 Digital PDF Products</h2>
              <div style={{overflowX:'auto'}}>
                <table className="data-table">
                  <thead><tr><th>Title</th><th>Description</th><th>Price</th><th>Password</th><th>Action</th></tr></thead>
                  <tbody>
                    {digitalProducts.map(d => (
                      <tr key={d.id}>
                        <td><span style={{marginRight:6}}>{d.coverEmoji||'📄'}</span>{d.title}</td>
                        <td style={{maxWidth:200,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{d.description||'—'}</td>
                        <td>₹{d.price}</td>
                        <td>{d.passwordHash ? '🔒 Protected' : '—'}</td>
                        <td><button className="delete-btn" onClick={() => { if(window.confirm(`Delete "${d.title}"?`)) axios.delete(`${API}/digital-products/${d.id}`).then(() => { loadDigitalProducts(); showToast('Digital product deleted'); }).catch(err => showToast(err.response?.data?.error || 'Failed to delete.', 'error')); }}>🗑 Delete</button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}
        </div>}{/* end home page */}

        {/* ── REPORTS PAGE ── */}
        {activePage === 'reports' && <div className="page-content rpt-page">

          {/* ── Date Filter Bar ── */}
          <div className="rpt-filter-bar">
            <div className="rpt-range-btns">
              {[['all','All Time'],['today','Today'],['week','Last 7 Days'],['month','This Month'],['year','This Year'],['custom','Custom']].map(([k,l]) => (
                <button key={k} className={`rpt-range-btn ${rptRange===k?'rpt-range-active':''}`}
                  onClick={() => k !== 'custom' ? applyRange(k) : setRptRange('custom')}>
                  {l}
                </button>
              ))}
            </div>
            {rptRange === 'custom' && (
              <div className="rpt-custom-dates">
                <label>From <input type="date" className="rpt-date-inp" value={rptFrom} max={today}
                  onChange={e => setRptFrom(e.target.value)} /></label>
                <label>To <input type="date" className="rpt-date-inp" value={rptTo} max={today}
                  onChange={e => setRptTo(e.target.value)} /></label>
                <button className="rpt-apply-btn" onClick={() => loadReports(rptFrom, rptTo)}>Apply</button>
              </div>
            )}
            {rptLoading && <span className="rpt-loading">Loading…</span>}
          </div>

          {rptStats && (() => {
            const s = rptStats;
            const statCards = [
              { label:'Total Orders',       value: s.totalOrders,                        color:'#2563EB', sub: `${s.offlineOrders} POS · ${s.onlineOrders} Online · ${s.shopifyOrders} Shopify` },
              { label:'Total Revenue',      value: `₹${fmt(s.totalRevenue)}`,            color:'#059669', sub: 'All channels combined' },
              { label:'Offline (POS)',       value: `₹${fmt(s.offlineRevenue)}`,          color:'#7C3AED', sub: `${s.offlineOrders} bills` },
              { label:'Online Shop',        value: `₹${fmt(s.onlineRevenue)}`,           color:'#DB2777', sub: `${s.onlineOrders} orders` },
              { label:'Shopify Imported',   value: `₹${fmt(s.shopifyRevenue)}`,          color:'#0D9488', sub: `${s.shopifyOrders} orders` },
              { label:'Avg Order Value',    value: `₹${fmt(s.avgOrderValue)}`,           color:'#4F46E5', sub: 'Across all channels' },
              { label:'POS Discount Given', value: `₹${fmt(s.offlineDiscount)}`,         color:'#F97316', sub: 'Total discounts offline' },
              { label:'Refunds',            value: `₹${fmt(s.refundAmount)}`,            color:'#DC2626', sub: `${s.refundCount} orders refunded` },
              ...(tenantInfo?.subdomain === 'gosuas' ? [
                { label:'Rental Deposits Returned', value: `₹${fmt(s.rentalReturnAmount)}`, color:'#D97706',
                  sub: `${s.rentalReturnCount} returned · not counted in revenue${s.rentalDeductionAmount > 0 ? ` · ₹${fmt(s.rentalDeductionAmount)} deducted for damage` : ''}` },
              ] : []),
            ];
            const dailyData = (s.daily || []).slice(-30);
            const maxVal = Math.max(...dailyData.map(d => d.total), 1);
            const payMethods = Object.entries(s.paymentMethods || {});

            return <>
              {/* Stat cards */}
              <div className="rpt-stats-grid">
                {statCards.map(c => (
                  <div key={c.label} className="rpt-stat-card" style={{borderTop:`3px solid ${c.color}`}}>
                    <div className="rpt-stat-value" style={{color:c.color}}>{c.value}</div>
                    <div className="rpt-stat-label">{c.label}</div>
                    <div className="rpt-stat-sub">{c.sub}</div>
                  </div>
                ))}
              </div>

              {/* Revenue chart + breakdowns */}
              <div className="rpt-charts-row">
                {/* Daily revenue bar chart */}
                <div className="rpt-chart-card">
                  <div className="rpt-chart-title">Daily Revenue (₹)</div>
                  <div className="rpt-bar-chart">
                    {dailyData.map((d, i) => (
                      <div key={i} className="rpt-bar-col" title={`${d.label}: ₹${d.total}`}>
                        <div className="rpt-bar-stack" style={{height:'160px'}}>
                          {d.shopify > 0 && <div className="rpt-bar-seg rpt-bar-shopify" style={{height:`${(d.shopify/maxVal)*100}%`}} />}
                          {d.online > 0  && <div className="rpt-bar-seg rpt-bar-online"  style={{height:`${(d.online/maxVal)*100}%`}} />}
                          {d.pos > 0     && <div className="rpt-bar-seg rpt-bar-pos"     style={{height:`${(d.pos/maxVal)*100}%`}} />}
                        </div>
                        {(dailyData.length <= 14 || i % Math.ceil(dailyData.length/14) === 0) &&
                          <div className="rpt-bar-label">{d.label}</div>}
                      </div>
                    ))}
                  </div>
                  <div className="rpt-bar-legend">
                    <span><span className="rpt-leg-dot" style={{background:'#2563EB'}}/>POS</span>
                    <span><span className="rpt-leg-dot" style={{background:'#DB2777'}}/>Online</span>
                    <span><span className="rpt-leg-dot" style={{background:'#059669'}}/>Shopify</span>
                  </div>
                </div>

                {/* Payment methods */}
                {payMethods.length > 0 && (
                  <div className="rpt-chart-card rpt-pay-card">
                    <div className="rpt-chart-title">Payment Methods (POS)</div>
                    {payMethods.sort((a,b)=>b[1]-a[1]).map(([pm, amt]) => {
                      const pct = s.offlineRevenue > 0 ? (amt / s.offlineRevenue * 100) : 0;
                      return (
                        <div key={pm} className="rpt-pay-row">
                          <span className="rpt-pay-label">{pm}</span>
                          <div className="rpt-pay-bar-wrap">
                            <div className="rpt-pay-bar" style={{width:`${pct}%`}} />
                          </div>
                          <span className="rpt-pay-amt">₹{fmt(amt)}</span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* GST Summary */}
              {s.gstTotal > 0 && (
                <div className="rpt-chart-card" style={{marginTop:20}}>
                  <div className="rpt-chart-title">GST Summary (POS Bills)</div>
                  <table style={{width:'100%',borderCollapse:'collapse',fontSize:13,marginTop:8}}>
                    <tbody>
                      <tr style={{borderBottom:'1px solid #e5e7eb'}}><td style={{padding:'6px 0',color:'#374151'}}>Taxable Value</td><td style={{textAlign:'right',fontWeight:600}}>₹{fmt(s.gstTaxableValue)}</td></tr>
                      {s.gstCgst > 0 && <tr style={{borderBottom:'1px solid #f3f4f6'}}><td style={{padding:'4px 0',color:'#6b7280'}}>CGST</td><td style={{textAlign:'right'}}>₹{fmt(s.gstCgst)}</td></tr>}
                      {s.gstSgst > 0 && <tr style={{borderBottom:'1px solid #f3f4f6'}}><td style={{padding:'4px 0',color:'#6b7280'}}>SGST</td><td style={{textAlign:'right'}}>₹{fmt(s.gstSgst)}</td></tr>}
                      {s.gstIgst > 0 && <tr style={{borderBottom:'1px solid #f3f4f6'}}><td style={{padding:'4px 0',color:'#6b7280'}}>IGST</td><td style={{textAlign:'right'}}>₹{fmt(s.gstIgst)}</td></tr>}
                      <tr><td style={{padding:'6px 0',fontWeight:700,color:'#0D9488',borderTop:'2px solid #0D9488'}}>Total GST</td><td style={{textAlign:'right',fontWeight:700,color:'#0D9488',borderTop:'2px solid #0D9488'}}>₹{fmt(s.gstTotal)}</td></tr>
                    </tbody>
                  </table>
                  <p style={{fontSize:11.5,color:'#9ca3af',margin:'8px 0 0',lineHeight:1.5}}>GST shown is the tax component embedded in POS bills. This is not a substitute for a formal GST return — consult your accountant for ITC claims, reversals, and final tax liability.</p>
                </div>
              )}

              {/* Top products */}
              {s.topProducts && s.topProducts.length > 0 && (
                <div className="rpt-chart-card" style={{marginTop:20}}>
                  <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',gap:12}}>
                    <div className="rpt-chart-title" style={{marginBottom:0}}>Top Selling Products</div>
                    <button className="export-csv-btn" onClick={() => exportToCsv('top-selling-products.csv', s.topProducts, [
                      { label: 'Rank', key: (_, i) => i + 1 },
                      { label: 'Product', key: 'name' },
                      { label: 'Qty Sold', key: 'qty' },
                      { label: 'Revenue', key: 'revenue' },
                    ])}>⬇ Export CSV</button>
                  </div>
                  <table className="report-table" style={{marginTop:14}}>
                    <thead><tr><th>#</th><th>Product</th><th>Qty Sold</th><th>Revenue</th></tr></thead>
                    <tbody>{s.topProducts.map((p,i) => (
                      <tr key={i}>
                        <td style={{color:'#aaa', width:30}}>{i+1}</td>
                        <td>{p.name}</td>
                        <td style={{textAlign:'center'}}>{p.qty}</td>
                        <td style={{textAlign:'right', fontWeight:600, color:'#1E3A5F'}}>₹{fmt(p.revenue)}</td>
                      </tr>
                    ))}</tbody>
                  </table>
                </div>
              )}

            {/* ── Damage Stock Summary ── */}
            {(() => {
              const totalDamageQty = rptStats.totalDamageQty ?? 0;
              const totalDamageEntries = rptStats.totalDamageEntries ?? 0;
              const affectedSkuCount = rptStats.affectedSkuCount ?? 0;
              const damageValue = rptStats.damageValue ?? null;
              const damageByReason = rptStats.damageByReason ?? {};
              const damageByProduct = rptStats.damageByProduct ?? [];
              const damageEntries = rptStats.damageEntries ?? [];

              const maxReasonQty = Math.max(1, ...Object.values(damageByReason));

              function exportDamageByProductCsv() {
                const rows = [['SKU','Product','Qty','Est. Value']];
                damageByProduct.forEach(r => rows.push([r.sku, r.productName, r.qty, r.value ?? '']));
                const csv = rows.map(r => r.map(c => '"' + String(c).replace(/"/g,'""') + '"').join(',')).join('\n');
                const a = document.createElement('a');
                a.href = 'data:text/csv;charset=utf-8,' + encodeURIComponent(csv);
                a.download = 'damage_by_product.csv';
                a.click();
              }

              function exportDamageEntriesCsv() {
                const rows = [['Entry No','Date','SKU','Product','Qty','Reason','Note']];
                damageEntries.forEach(r => rows.push([r.entryNumber, r.date, r.sku, r.productName, r.qty, r.reason, r.note ?? '']));
                const csv = rows.map(r => r.map(c => '"' + String(c).replace(/"/g,'""') + '"').join(',')).join('\n');
                const a = document.createElement('a');
                a.href = 'data:text/csv;charset=utf-8,' + encodeURIComponent(csv);
                a.download = 'damage_entries.csv';
                a.click();
              }

              return (
                <div style={{marginTop:'2rem'}}>
                  <div style={{display:'flex',alignItems:'center',gap:'0.5rem',marginBottom:'1rem'}}>
                    <span style={{fontSize:'1.25rem'}}>&#x26A0;</span>
                    <h3 style={{margin:0,fontSize:'1.1rem',fontWeight:700,color:'var(--text)'}}>Damage Stock Summary</h3>
                  </div>

                  {totalDamageEntries === 0 ? (
                    <div className="rpt-card" style={{textAlign:'center',padding:'2rem',color:'var(--text-muted)'}}>
                      <div style={{fontSize:'2rem',marginBottom:'0.5rem'}}>&#x2714;</div>
                      <div style={{fontWeight:600}}>No damage entries in this period</div>
                      <div style={{fontSize:'0.85rem',marginTop:'0.25rem'}}>Record damage stock entries from the Damage Stock page.</div>
                    </div>
                  ) : (
                    <>
                      {/* Summary cards */}
                      <div className="rpt-row" style={{marginBottom:'1rem'}}>
                        <div className="rpt-card">
                          <div className="rpt-card-label">Total Damaged Units</div>
                          <div className="rpt-card-value">{totalDamageQty}</div>
                        </div>
                        <div className="rpt-card">
                          <div className="rpt-card-label">Damage Entries</div>
                          <div className="rpt-card-value">{totalDamageEntries}</div>
                        </div>
                        <div className="rpt-card">
                          <div className="rpt-card-label">Affected SKUs</div>
                          <div className="rpt-card-value">{affectedSkuCount}</div>
                        </div>
                        <div className="rpt-card">
                          <div className="rpt-card-label">Est. Damage Value</div>
                          <div className="rpt-card-value" style={{color:'var(--danger,#ef4444)'}}>
                            {damageValue != null ? '₹' + Number(damageValue).toLocaleString('en-IN', {minimumFractionDigits:2,maximumFractionDigits:2}) : '—'}
                          </div>
                        </div>
                      </div>

                      {/* Damage by reason */}
                      {Object.keys(damageByReason).length > 0 && (
                        <div className="rpt-card" style={{marginBottom:'1rem'}}>
                          <div style={{fontWeight:600,marginBottom:'0.75rem',fontSize:'0.9rem'}}>Damage by Reason</div>
                          {Object.entries(damageByReason).sort((a,b)=>b[1]-a[1]).map(([reason, qty]) => (
                            <div key={reason} className="rpt-pay-row">
                              <span className="rpt-pay-label">{reason}</span>
                              <div className="rpt-pay-bar-wrap">
                                <div className="rpt-pay-bar" style={{width: Math.round((qty / maxReasonQty) * 100) + '%', background:'var(--danger,#ef4444)'}} />
                              </div>
                              <span className="rpt-pay-val">{qty} unit{qty !== 1 ? 's' : ''}</span>
                            </div>
                          ))}
                        </div>
                      )}

                      {/* Damage by product table */}
                      {damageByProduct.length > 0 && (
                        <div className="rpt-card" style={{marginBottom:'1rem'}}>
                          <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:'0.75rem'}}>
                            <span style={{fontWeight:600,fontSize:'0.9rem'}}>Damage by Product / SKU</span>
                            <button className="rpt-export-btn" onClick={exportDamageByProductCsv}>Export CSV</button>
                          </div>
                          <div style={{overflowX:'auto'}}>
                            <table className="rpt-table">
                              <thead>
                                <tr>
                                  <th>SKU</th>
                                  <th>Product</th>
                                  <th style={{textAlign:'right'}}>Qty</th>
                                  <th style={{textAlign:'right'}}>Est. Value</th>
                                </tr>
                              </thead>
                              <tbody>
                                {damageByProduct.map((r,i) => (
                                  <tr key={i}>
                                    <td><code style={{fontSize:'0.8rem'}}>{r.sku}</code></td>
                                    <td>{r.productName}</td>
                                    <td style={{textAlign:'right'}}>{r.qty}</td>
                                    <td style={{textAlign:'right',color:'var(--danger,#ef4444)'}}>
                                      {r.value != null ? '₹' + Number(r.value).toLocaleString('en-IN', {minimumFractionDigits:2,maximumFractionDigits:2}) : '—'}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      )}

                      {/* Damage entry log */}
                      {damageEntries.length > 0 && (
                        <div className="rpt-card">
                          <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:'0.75rem'}}>
                            <span style={{fontWeight:600,fontSize:'0.9rem'}}>Damage Entry Log</span>
                            <button className="rpt-export-btn" onClick={exportDamageEntriesCsv}>Export CSV</button>
                          </div>
                          <div style={{overflowX:'auto'}}>
                            <table className="rpt-table">
                              <thead>
                                <tr>
                                  <th>Entry No</th>
                                  <th>Date</th>
                                  <th>SKU</th>
                                  <th>Product</th>
                                  <th style={{textAlign:'right'}}>Qty</th>
                                  <th>Reason</th>
                                  <th>Note</th>
                                </tr>
                              </thead>
                              <tbody>
                                {damageEntries.map((r,i) => (
                                  <tr key={i}>
                                    <td><code style={{fontSize:'0.8rem'}}>{r.entryNumber}</code></td>
                                    <td style={{whiteSpace:'nowrap'}}>{r.date}</td>
                                    <td><code style={{fontSize:'0.8rem'}}>{r.sku}</code></td>
                                    <td>{r.productName}</td>
                                    <td style={{textAlign:'right'}}>{r.qty}</td>
                                    <td>{r.reason}</td>
                                    <td style={{color:'var(--text-muted)',fontSize:'0.85rem'}}>{r.note || '—'}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      )}
                    </>
                  )}
                </div>
              );
            })()}

            {/* ── Expense Summary ── */}
            {(() => {
              const expenseTotal = rptStats.expenseTotal ?? 0;
              const expenseByCat = rptStats.expenseByCat ?? {};
              const expenseDaily = rptStats.expenseDaily ?? [];
              const expenseCount = rptStats.expenseCount ?? 0;

              const EXPENSE_CAT_LABELS = {
                DAILY_EXPENSE:'Daily Expense', RENT:'Rent', ELECTRICITY:'Electricity',
                WATER_BILL:'Water Bill', SALARY:'Salary', TRANSPORT:'Transport', OTHER_EXPENSE:'Other Expense',
              };
              const EXPENSE_CAT_COLORS = {
                DAILY_EXPENSE:'#7C3AED', RENT:'#2563EB', ELECTRICITY:'#D97706',
                WATER_BILL:'#0891B2', SALARY:'#059669', TRANSPORT:'#F97316', OTHER_EXPENSE:'#6B7280',
              };
              const catValues = Object.values(expenseByCat).map(v => Number(v));
              const maxCatAmt = Math.max(1, ...catValues);

              function exportExpenseCsv() {
                const rows = [['Category','Amount (INR)']];
                Object.entries(EXPENSE_CAT_LABELS).forEach(([k, label]) => {
                  rows.push([label, Number(expenseByCat[k] || 0).toFixed(2)]);
                });
                const csv = rows.map(r => r.map(c => '"' + String(c).replace(/"/g,'""') + '"').join(',')).join('\n');
                const a = document.createElement('a');
                a.href = 'data:text/csv;charset=utf-8,' + encodeURIComponent(csv);
                a.download = 'expense_report.csv';
                a.click();
              }

              return (
                <div style={{marginTop:'2rem'}}>
                  <div style={{display:'flex',alignItems:'center',gap:'0.5rem',marginBottom:'1rem'}}>
                    <span style={{fontSize:'1.25rem'}}>💸</span>
                    <h3 style={{margin:0,fontSize:'1.1rem',fontWeight:700,color:'var(--text)'}}>Expense Summary</h3>
                  </div>

                  {expenseCount === 0 ? (
                    <div className="rpt-card" style={{textAlign:'center',padding:'2rem',color:'var(--text-muted)'}}>
                      <div style={{fontSize:'2rem',marginBottom:'0.5rem'}}>✔</div>
                      <div style={{fontWeight:600}}>No expenses recorded in this period</div>
                      <div style={{fontSize:'0.85rem',marginTop:'0.25rem'}}>Add expenses from the Expenses page.</div>
                    </div>
                  ) : (
                    <>
                      {/* Summary cards */}
                      <div className="rpt-row" style={{marginBottom:'1rem'}}>
                        <div className="rpt-card">
                          <div className="rpt-card-label">Total Expenses</div>
                          <div className="rpt-card-value" style={{color:'var(--danger,#ef4444)'}}>
                            {'₹' + Number(expenseTotal).toLocaleString('en-IN',{minimumFractionDigits:2,maximumFractionDigits:2})}
                          </div>
                        </div>
                        <div className="rpt-card">
                          <div className="rpt-card-label">Expense Entries</div>
                          <div className="rpt-card-value">{expenseCount}</div>
                        </div>
                      </div>

                      {/* Category breakdown */}
                      <div className="rpt-card" style={{marginBottom:'1rem'}}>
                        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:'0.75rem'}}>
                          <span style={{fontWeight:600,fontSize:'0.9rem'}}>Category Breakdown</span>
                          <button className="rpt-export-btn" onClick={exportExpenseCsv}>Export CSV</button>
                        </div>
                        {Object.entries(EXPENSE_CAT_LABELS).map(([key, label]) => {
                          const amt = Number(expenseByCat[key] || 0);
                          return (
                            <div key={key} className="rpt-pay-row">
                              <span className="rpt-pay-label">{label}</span>
                              <div className="rpt-pay-bar-wrap">
                                <div className="rpt-pay-bar" style={{
                                  width: amt > 0 ? Math.round((amt/maxCatAmt)*100)+'%' : '0%',
                                  background: EXPENSE_CAT_COLORS[key] || '#6b7280'
                                }} />
                              </div>
                              <span className="rpt-pay-val">
                                {'₹' + amt.toLocaleString('en-IN',{minimumFractionDigits:2,maximumFractionDigits:2})}
                              </span>
                            </div>
                          );
                        })}
                      </div>

                      {/* Daily breakdown */}
                      {expenseDaily.length > 0 && (
                        <div className="rpt-card">
                          <div style={{fontWeight:600,fontSize:'0.9rem',marginBottom:'0.75rem'}}>Daily Expense Breakdown</div>
                          <div style={{overflowX:'auto'}}>
                            <table className="rpt-table">
                              <thead>
                                <tr>
                                  <th>Date</th>
                                  <th style={{textAlign:'right'}}>Amount (₹)</th>
                                </tr>
                              </thead>
                              <tbody>
                                {expenseDaily.map((r,i) => (
                                  <tr key={i}>
                                    <td>{r.date}</td>
                                    <td style={{textAlign:'right',color:'var(--danger,#ef4444)',fontWeight:600}}>
                                      {'₹' + Number(r.amount).toLocaleString('en-IN',{minimumFractionDigits:2,maximumFractionDigits:2})}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      )}
                    </>
                  )}
                </div>
              );
            })()}

            </>;
          })()}

          {!rptStats && !rptLoading && (
            <p className="no-data" style={{marginTop:40}}>Select a date range or click "All Time" to load statistics.</p>
          )}
        </div>}{/* end reports page */}

        {/* ── STOCK ALERTS PAGE ── */}
        {activePage === 'alerts' && <div className="page-content">
          {lowStockItems.length === 0
            ? <p className="no-data" style={{color:'#2e7d32',marginTop:40}}>✓ All products are well-stocked (≥5 units)</p>
            : <>
                {criticalItems.length > 0 && (
                  <div className="alert-block critical-block">
                    <div className="alert-block-title">🔴 Out of Stock — Restock Immediately <span className="alert-count-badge">{criticalItems.length}</span></div>
                    <div className="alert-items-grid">
                      {criticalItems.map(p => (
                        <div key={p.id} className="alert-product-card critical-card">
                          <div className="apc-name">{p.name}</div>
                          {variantLabel(p) && <div className="apc-detail">{variantLabel(p)}</div>}
                          <div className="apc-stock out">OUT OF STOCK</div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {warningItems.length > 0 && (
                  <div className="alert-block warning-block" style={{marginTop:20}}>
                    <div className="alert-block-title">🟠 Low Stock — Less than 5 units <span className="alert-count-badge" style={{background:'#fff3e0',color:'#e65100'}}>{warningItems.length}</span></div>
                    <div className="alert-items-grid">
                      {warningItems.map(p => (
                        <div key={p.id} className="alert-product-card warning-card">
                          <div className="apc-name">{p.name}</div>
                          {variantLabel(p) && <div className="apc-detail">{variantLabel(p)}</div>}
                          <div className="apc-stock low">{p.stockQty} unit{p.stockQty!==1?'s':''} left</div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </>}
        </div>}{/* end alerts page */}

        {/* ── PRINT LABELS PAGE ── */}
        {activePage === 'print-labels' && (() => {
          const allCats = [...new Set([...tenantCategories.map(c => c.name), ...products.map(p => p.category).filter(Boolean)])].sort();
          const bq = bulkSearch.trim().toLowerCase();
          const bulkFiltered = products.filter(p => {
            const matchCat = !bulkCategoryFilter || p.category === bulkCategoryFilter;
            const matchSearch = !bq ||
              p.name?.toLowerCase().includes(bq) ||
              p.sku?.toLowerCase().includes(bq) ||
              p.barcode?.toLowerCase().includes(bq) ||
              p.color?.toLowerCase().includes(bq) ||
              p.category?.toLowerCase().includes(bq) ||
              p.subcategory?.toLowerCase().includes(bq);
            return matchCat && matchSearch;
          });
          const bulkTotalPages = Math.max(1, Math.ceil(bulkFiltered.length / BULK_PAGE_SIZE));
          const safeBulkPage = Math.min(bulkPage, bulkTotalPages);
          const bulkDisplayed = bulkFiltered.slice((safeBulkPage - 1) * BULK_PAGE_SIZE, safeBulkPage * BULK_PAGE_SIZE);
          const allSelected = bulkFiltered.length > 0 && bulkFiltered.every(p => bulkSelectedIds.has(p.id));
          const toggleAll = () => {
            if (allSelected) {
              setBulkSelectedIds(prev => { const s = new Set(prev); bulkFiltered.forEach(p => s.delete(p.id)); return s; });
            } else {
              setBulkSelectedIds(prev => { const s = new Set(prev); bulkFiltered.forEach(p => s.add(p.id)); return s; });
            }
          };
          const selectedProducts = products.filter(p => bulkSelectedIds.has(p.id));
          const totalLabelCount = selectedProducts.reduce((sum, p) => sum + (bulkQtyMap[p.id] || 1), 0);
          return (
            <div className="page-content">
              {/* Search bar */}
              <div style={{position:'relative',marginBottom:'12px'}}>
                <span style={{position:'absolute',left:'10px',top:'50%',transform:'translateY(-50%)',color:'#aaa',fontSize:'16px',pointerEvents:'none'}}>🔍</span>
                <input
                  placeholder="Search by name, SKU, colour, barcode, category..."
                  value={bulkSearch}
                  onChange={e => { setBulkSearch(e.target.value); setBulkPage(1); }}
                  style={{width:'100%',padding:'8px 12px 8px 34px',borderRadius:'8px',border:'1px solid #ddd',fontSize:'14px',boxSizing:'border-box'}}
                />
                {bulkSearch && (
                  <button onClick={() => { setBulkSearch(''); setBulkPage(1); }}
                    style={{position:'absolute',right:'10px',top:'50%',transform:'translateY(-50%)',background:'none',border:'none',cursor:'pointer',color:'#aaa',fontSize:'16px'}}>✕</button>
                )}
              </div>

              {/* Controls bar */}
              <div style={{display:'flex',flexWrap:'wrap',gap:'10px',alignItems:'center',marginBottom:'12px'}}>
                <select value={bulkCategoryFilter} onChange={e => { setBulkCategoryFilter(e.target.value); setBulkPage(1); }}
                  style={{padding:'7px 10px',borderRadius:'6px',border:'1px solid #ddd',fontSize:'14px',minWidth:'170px'}}>
                  <option value="">All Categories</option>
                  {allCats.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
                <select value={bulkStickerType} onChange={e => setBulkStickerType(e.target.value)}
                  style={{padding:'7px 10px',borderRadius:'6px',border:'1px solid #ddd',fontSize:'14px'}}>
                  {STICKER_TYPES.map(s => <option key={s.id} value={s.id}>{s.label} ({s.size})</option>)}
                </select>
                <button onClick={toggleAll}
                  style={{padding:'7px 14px',borderRadius:'6px',border:'1px solid #1E3A5F',background:'#fff',color:'#1E3A5F',cursor:'pointer',fontSize:'13px'}}>
                  {allSelected ? 'Deselect All' : 'Select All'}
                </button>
                {bulkSelectedIds.size > 0 && (
                  <button onClick={() => setBulkSelectedIds(new Set())}
                    style={{padding:'7px 14px',borderRadius:'6px',border:'1px solid #ccc',background:'#fff',color:'#666',cursor:'pointer',fontSize:'13px'}}>
                    Clear ({bulkSelectedIds.size})
                  </button>
                )}
                <button
                  disabled={bulkSelectedIds.size === 0}
                  onClick={() => {
                    if (bulkStickerType === 'four-row' && !confirmFourRowStock()) return;
                    printBulkLabels(selectedProducts.map(p => ({product:p, qty: bulkQtyMap[p.id] || 1})), bulkStickerType, tenantInfo?.name);
                  }}
                  style={{padding:'7px 18px',borderRadius:'6px',border:'none',background: bulkSelectedIds.size ? '#1E3A5F' : '#ccc',color:'#fff',cursor: bulkSelectedIds.size ? 'pointer' : 'default',fontSize:'14px',fontWeight:600,marginLeft:'auto'}}>
                  🖨 Print {bulkSelectedIds.size > 0 ? `${totalLabelCount} Label${totalLabelCount!==1?'s':''} (${bulkSelectedIds.size} product${bulkSelectedIds.size>1?'s':''})` : 'Labels'}
                </button>
              </div>

              {/* Table meta */}
              <div className="table-meta" style={{marginBottom:'6px'}}>
                {bq || bulkCategoryFilter
                  ? `${bulkFiltered.length} result${bulkFiltered.length !== 1 ? 's' : ''} found`
                  : `Showing ${bulkFiltered.length === 0 ? 0 : (safeBulkPage-1)*BULK_PAGE_SIZE+1}–${Math.min(safeBulkPage*BULK_PAGE_SIZE, bulkFiltered.length)} of ${bulkFiltered.length} products`}
                {bulkSelectedIds.size > 0 && <span style={{marginLeft:'12px',color:'#1E3A5F',fontWeight:600}}>{bulkSelectedIds.size} selected · {totalLabelCount} labels total</span>}
              </div>

              {/* Table */}
              <div className="table-scroll-wrap">
                <table>
                  <thead>
                    <tr>
                      <th style={{width:'36px'}}>
                        <input type="checkbox" checked={allSelected} onChange={toggleAll}
                          style={{width:'16px',height:'16px',cursor:'pointer'}} />
                      </th>
                      <th>Name</th><th>Category</th><th>Colour</th><th>SKU</th><th>Barcode</th><th>Stock</th><th>Price</th>
                      <th style={{width:'90px',textAlign:'center'}}>Label Qty</th>
                    </tr>
                  </thead>
                  <tbody>
                    {bulkDisplayed.length === 0 && (
                      <tr><td colSpan={9} style={{textAlign:'center',color:'#888',padding:'20px'}}>No products found</td></tr>
                    )}
                    {bulkDisplayed.map(p => {
                      const checked = bulkSelectedIds.has(p.id);
                      const pQty = bulkQtyMap[p.id] || 1;
                      return (
                        <tr key={p.id} style={{background: checked ? '#EEF4FF' : '', cursor:'pointer'}}
                          onClick={() => setBulkSelectedIds(prev => { const s = new Set(prev); checked ? s.delete(p.id) : s.add(p.id); return s; })}>
                          <td onClick={e => e.stopPropagation()}>
                            <input type="checkbox" checked={checked}
                              onChange={() => setBulkSelectedIds(prev => { const s = new Set(prev); checked ? s.delete(p.id) : s.add(p.id); return s; })}
                              style={{width:'16px',height:'16px',cursor:'pointer'}} />
                          </td>
                          <td>{p.name}</td>
                          <td>{p.category}{p.subcategory ? <div style={{fontSize:'11px',color:'#888'}}>{p.subcategory}</div> : ''}</td>
                          <td>{p.color || '—'}</td>
                          <td>{p.sku}</td>
                          <td>{p.barcode}</td>
                          <td><span className={p.stockQty===0?'stock-out':p.stockQty<5?'stock-low':''}>{p.stockQty===0?'⚠ OUT':p.stockQty}</span></td>
                          <td>{p.productType === 'RENTAL' ? `Dep ₹${p.depositAmount ?? 0} + Rent ₹${p.rentAmount ?? 0}` : `₹${p.sellingPrice}`}</td>
                          <td onClick={e => e.stopPropagation()} style={{textAlign:'center'}}>
                            <input
                              type="number" min="1" max="500"
                              value={pQty}
                              disabled={!checked}
                              onChange={e => {
                                const v = Math.max(1, parseInt(e.target.value)||1);
                                setBulkQtyMap(prev => ({...prev, [p.id]: v}));
                              }}
                              style={{
                                width:'64px', padding:'5px 6px', borderRadius:'6px',
                                border: checked ? '1.5px solid #1E3A5F' : '1px solid #ddd',
                                fontSize:'14px', textAlign:'center',
                                background: checked ? '#fff' : '#f5f5f5',
                                color: checked ? '#1E3A5F' : '#aaa',
                                fontWeight: checked ? 700 : 400
                              }}
                            />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* Pagination */}
              {bulkTotalPages > 1 && (
                <div className="pagination">
                  <button className="pg-btn" onClick={() => setBulkPage(p => Math.max(1, p-1))} disabled={safeBulkPage === 1}>‹ Prev</button>
                  {Array.from({length: bulkTotalPages}, (_, i) => i + 1)
                    .filter(pg => pg === 1 || pg === bulkTotalPages || Math.abs(pg - safeBulkPage) <= 2)
                    .reduce((acc, pg, i, arr) => {
                      if (i > 0 && pg - arr[i-1] > 1) acc.push('…');
                      acc.push(pg);
                      return acc;
                    }, [])
                    .map((pg, i) => pg === '…'
                      ? <span key={`e${i}`} className="pg-ellipsis">…</span>
                      : <button key={pg} className={`pg-btn ${pg === safeBulkPage ? 'pg-active' : ''}`} onClick={() => setBulkPage(pg)}>{pg}</button>
                    )}
                  <button className="pg-btn" onClick={() => setBulkPage(p => Math.min(bulkTotalPages, p+1))} disabled={safeBulkPage === bulkTotalPages}>Next ›</button>
                </div>
              )}
            </div>
          );
        })()}

        {/* ── CUSTOMERS PAGE ── */}
        {activePage === 'customers' && (() => {
          const q = custSearch.toLowerCase();
          const filtered = customers.filter(c => !q || [c.firstName,c.lastName,c.email,c.phone,c.city].join(' ').toLowerCase().includes(q));
          const totalCustPages = Math.max(1, Math.ceil(filtered.length / PAGE_ROWS));
          const safeCustPage = Math.min(custPage, totalCustPages);
          const custSlice = filtered.slice((safeCustPage-1)*PAGE_ROWS, safeCustPage*PAGE_ROWS);
          return (
          <div className="page-content">
            <div className="cust-toolbar">
              <input className="cust-search" placeholder="🔍 Search name, email, phone, city…"
                value={custSearch} onChange={e => { setCustSearch(e.target.value); setCustPage(1); }} />
              <span className="cust-count">{filtered.length} customers</span>
              <button className="export-csv-btn" onClick={() => exportToCsv('customers.csv', filtered, [
                { label: '#', key: (_, i) => i + 1 },
                { label: 'Name', key: r => [r.firstName, r.lastName].filter(Boolean).join(' ') },
                { label: 'Email', key: 'email' },
                { label: 'Phone', key: 'phone' },
                { label: 'City', key: 'city' },
                { label: 'State', key: 'state' },
                { label: 'Orders', key: 'totalOrders' },
                { label: 'Total Spent', key: r => Number(r.totalSpent || 0).toFixed(2) },
              ])}>⬇ Export CSV</button>
            </div>
            <div className="data-table-wrap">
              <table className="data-table">
                <thead><tr><th>#</th><th>Name</th><th>Email</th><th>Phone</th><th>City</th><th>State</th><th>Orders</th><th>Total Spent</th></tr></thead>
                <tbody>
                  {custSlice.map((c, i) => (
                    <tr key={c.id}>
                      <td className="td-num">{(safeCustPage-1)*PAGE_ROWS + i + 1}</td>
                      <td className="td-name">{[c.firstName,c.lastName].filter(Boolean).join(' ') || '—'}</td>
                      <td className="td-email">{c.email || '—'}</td>
                      <td>{c.phone || '—'}</td>
                      <td>{c.city || '—'}</td>
                      <td>{c.state || '—'}</td>
                      <td className="td-center">{c.totalOrders}</td>
                      <td className="td-amt">₹{Number(c.totalSpent||0).toFixed(2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {totalCustPages > 1 && (
              <div className="tbl-pagination">
                <button className="tbl-pg-btn" onClick={() => setCustPage(p=>Math.max(1,p-1))} disabled={safeCustPage===1}>‹ Prev</button>
                <span className="tbl-pg-info">Page {safeCustPage} of {totalCustPages}</span>
                <button className="tbl-pg-btn" onClick={() => setCustPage(p=>Math.min(totalCustPages,p+1))} disabled={safeCustPage===totalCustPages}>Next ›</button>
              </div>
            )}
          </div>
        );})()}{/* end customers page */}

        {/* ── ORDERS PAGE ── */}
        {activePage === 'orders' && (() => {
          const q = orderSearch.toLowerCase();
          const srcFiltered = orders.filter(o => orderSourceFilter==='ALL' || o.source===orderSourceFilter);
          const filtered = srcFiltered.filter(o => !q || [o.orderNumber,o.customerName,o.customerContact,o.city].join(' ').toLowerCase().includes(q));
          const totalOrdPages = Math.max(1, Math.ceil(filtered.length / PAGE_ROWS));
          const safeOrdPage = Math.min(orderPage, totalOrdPages);
          const ordSlice = filtered.slice((safeOrdPage-1)*PAGE_ROWS, safeOrdPage*PAGE_ROWS);
          const sourceCounts = { ALL: orders.length, SHOPIFY: orders.filter(o=>o.source==='SHOPIFY').length, POS: orders.filter(o=>o.source==='POS').length, ONLINE: orders.filter(o=>o.source==='ONLINE').length };
          return (
          <div className="page-content">
            <div className="cust-toolbar">
              <input className="cust-search" placeholder="🔍 Search order #, customer, city…"
                value={orderSearch} onChange={e => { setOrderSearch(e.target.value); setOrderPage(1); }} />
              <div className="order-src-filters">
                {['ALL','SHOPIFY','POS','ONLINE'].map(src => (
                  <button key={src} className={`src-filter-btn ${orderSourceFilter===src?'src-active':''}`}
                    onClick={() => { setOrderSourceFilter(src); setOrderPage(1); }}>
                    {src==='ALL'?'All':src==='SHOPIFY'?'Shopify':src==='POS'?'Offline Billing':'Online Shop'}
                    <span className="src-count">{sourceCounts[src]}</span>
                  </button>
                ))}
              </div>
              <span className="cust-count">{filtered.length} orders</span>
            </div>
            <div className="data-table-wrap">
              <table className="data-table">
                <thead><tr><th>Source</th><th>Order #</th><th>Customer</th><th>Date</th><th>Items</th><th>Total</th><th>Payment</th><th>Status</th><th></th><th></th></tr></thead>
                <tbody>
                  {ordSlice.map(o => (
                    <React.Fragment key={o.id}>
                      <tr className={`order-row ${expandedOrder===o.id?'order-row-open':''}`}
                        onClick={() => setExpandedOrder(expandedOrder===o.id ? null : o.id)}
                        style={{cursor:'pointer'}}>
                        <td><span className={`src-badge src-${o.source}`}>{o.source==='SHOPIFY'?'Shopify':o.source==='POS'?'POS':'Online'}</span></td>
                        <td className="td-ordnum">{o.orderNumber}</td>
                        <td className="td-name">{o.source === 'POS' ? 'Walk-in Customer' : (o.customerName || o.customerContact || '—')}</td>
                        <td className="td-date">{o.orderedAt ? o.orderedAt.slice(0,10) : '—'}</td>
                        <td className="td-center">{o.items?.length || 0}</td>
                        <td className="td-amt">₹{Number(o.total||0).toFixed(2)}</td>
                        <td><span className="pay-badge">{o.paymentMethod || '—'}</span></td>
                        <td>
                          <span className={`status-badge status-${o.financialStatus}`}>{o.financialStatus}</span>
                          {o.fulfillmentStatus && <span className={`status-badge status-${o.fulfillmentStatus}`} style={{marginLeft:4}}>{o.fulfillmentStatus}</span>}
                        </td>
                        <td className="td-expand">{expandedOrder===o.id?'▲':'▼'}</td>
                        <td>
                          <button className="delete-btn" onClick={e => { e.stopPropagation(); deleteOrder(o); }}>🗑</button>
                        </td>
                      </tr>
                      {expandedOrder===o.id && (
                        <tr className="order-items-row">
                          <td colSpan={10}>
                            <div className="order-items-wrap">
                              {/* Delivery address block */}
                              {(() => {
                                const fullAddr = o.source === 'ONLINE'
                                  ? [o.houseNo, o.street, o.city, o.pincode, o.state, o.country].filter(Boolean).join(', ')
                                  : o.shippingAddress
                                    ? [o.shippingAddress, o.city].filter(Boolean).join(', ')
                                    : o.city || '';
                                return (
                                  <div style={{ display:'flex', gap:24, flexWrap:'wrap', marginBottom:10, padding:'12px 16px', background:'#F0F6FF', borderRadius:8, border:'1px solid #A8C4E0' }}>
                                    <div style={{ minWidth:220 }}>
                                      <div style={{ fontSize:11, fontWeight:700, color:'#1E3A5F', letterSpacing:0.5, marginBottom:6 }}>📦 DELIVERY ADDRESS</div>
                                      {o.source === 'ONLINE' ? (
                                        <div style={{ fontSize:13, color:'#1f2937', lineHeight:2 }}>
                                          {o.houseNo && <div><span style={{color:'#6B7280',fontSize:11}}>House/Flat:</span> {o.houseNo}</div>}
                                          {o.street   && <div><span style={{color:'#6B7280',fontSize:11}}>Street:</span> {o.street}</div>}
                                          {o.city     && <div><span style={{color:'#6B7280',fontSize:11}}>City/District:</span> {o.city}</div>}
                                          {o.pincode  && <div><span style={{color:'#6B7280',fontSize:11}}>PIN Code:</span> {o.pincode}</div>}
                                          {o.state    && <div><span style={{color:'#6B7280',fontSize:11}}>State:</span> {o.state}</div>}
                                          {o.country  && <div><span style={{color:'#6B7280',fontSize:11}}>Country:</span> {o.country}</div>}
                                          {!o.houseNo && !o.street && !o.city && !o.pincode && !o.state && <span style={{color:'#9CA3AF'}}>No address provided</span>}
                                        </div>
                                      ) : (
                                        <div style={{ fontSize:13, color:'#1f2937', lineHeight:1.6 }}>
                                          {fullAddr || <span style={{color:'#9CA3AF'}}>No address provided</span>}
                                        </div>
                                      )}
                                    </div>
                                    <div>
                                      <div style={{ fontSize:11, fontWeight:700, color:'#1E3A5F', letterSpacing:0.5, marginBottom:6 }}>📞 CONTACT</div>
                                      <div style={{ fontSize:13, color:'#1f2937' }}>
                                        {o.phone || o.customerContact || <span style={{color:'#9CA3AF'}}>—</span>}
                                      </div>
                                    </div>
                                    {o.customerName && (
                                      <div>
                                        <div style={{ fontSize:11, fontWeight:700, color:'#1E3A5F', letterSpacing:0.5, marginBottom:6 }}>👤 CUSTOMER</div>
                                        <div style={{ fontSize:13, color:'#1f2937' }}>{o.customerName}</div>
                                      </div>
                                    )}
                                    <div style={{marginLeft:'auto',alignSelf:'flex-start',display:'flex',flexDirection:'column',alignItems:'flex-end',gap:8}}>
                                      {o.source === 'ONLINE' && (
                                        <div style={{display:'flex',alignItems:'center',gap:6}} onClick={e => e.stopPropagation()}>
                                          <span style={{fontSize:11,fontWeight:700,color:'#1E3A5F',letterSpacing:0.5}}>STATUS:</span>
                                          <select value={(o.fulfillmentStatus || 'pending').toUpperCase()}
                                            onChange={e => updateOrderStatus(o.id, e.target.value)}
                                            style={{fontSize:12,fontWeight:600,padding:'5px 8px',borderRadius:6,border:'1.5px solid #A8C4E0',background:'#fff',cursor:'pointer'}}>
                                            {['PENDING','CONFIRMED','SHIPPED','DELIVERED','CANCELLED'].map(s => (
                                              <option key={s} value={s}>{s.charAt(0)+s.slice(1).toLowerCase()}</option>
                                            ))}
                                          </select>
                                        </div>
                                      )}
                                      <button onClick={e => { e.stopPropagation(); printOrderShippingLabel(o, tenantInfo?.name, tenantInfo?.shopAddress); }}
                                        title="Print Shipping Label"
                                        style={{background:'#1E3A5F',color:'#fff',border:'none',borderRadius:8,padding:'7px 14px',fontSize:12,fontWeight:700,cursor:'pointer',whiteSpace:'nowrap'}}>
                                        🖨 Print Label
                                      </button>
                                    </div>
                                  </div>
                                );
                              })()}
                              <table className="order-items-table">
                                <thead><tr><th>Product</th><th>SKU / Barcode</th><th>Variant</th><th>Qty</th><th>Price</th><th>Subtotal</th></tr></thead>
                                <tbody>
                                  {(o.items||[]).map((item,idx) => (
                                    <tr key={idx}>
                                      <td>{item.productName}</td>
                                      <td className="td-sku">{item.sku||'—'}</td>
                                      <td className="td-sku">{variantLabel(item)||'—'}</td>
                                      <td className="td-center">{item.quantity}</td>
                                      <td className="td-amt">₹{Number(item.price||0).toFixed(2)}</td>
                                      <td className="td-amt">₹{(Number(item.quantity||0)*Number(item.price||0)).toFixed(2)}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                              {/* Order-level discount totals — POS bills only */}
                              {o.source === 'POS' && (
                                <div style={{display:'flex',justifyContent:'flex-end',marginTop:10}}>
                                  <div style={{minWidth:260,fontSize:13}}>
                                    {Number(o.discountAmount||0) > 0 && (
                                      <>
                                        <div style={{display:'flex',justifyContent:'space-between',padding:'3px 0',color:'#374151'}}>
                                          <span>Subtotal</span>
                                          <span>₹{Number(o.subTotal||0).toFixed(2)}</span>
                                        </div>
                                        <div style={{display:'flex',justifyContent:'space-between',padding:'3px 0',color:'#dc2626',fontWeight:600}}>
                                          <span>Discount</span>
                                          <span>− ₹{Number(o.discountAmount||0).toFixed(2)}</span>
                                        </div>
                                      </>
                                    )}
                                    {Number(o.totalGst||0) > 0 && (
                                      <>
                                        <div style={{display:'flex',justifyContent:'space-between',padding:'2px 0',color:'#6b7280',fontSize:12}}>
                                          <span>Taxable Value</span>
                                          <span>₹{Number(o.taxableAmount||0).toFixed(2)}</span>
                                        </div>
                                        {Number(o.cgst||0) > 0 && <div style={{display:'flex',justifyContent:'space-between',padding:'2px 0',color:'#6b7280',fontSize:12}}><span>CGST</span><span>₹{Number(o.cgst||0).toFixed(2)}</span></div>}
                                        {Number(o.sgst||0) > 0 && <div style={{display:'flex',justifyContent:'space-between',padding:'2px 0',color:'#6b7280',fontSize:12}}><span>SGST</span><span>₹{Number(o.sgst||0).toFixed(2)}</span></div>}
                                        {Number(o.igst||0) > 0 && <div style={{display:'flex',justifyContent:'space-between',padding:'2px 0',color:'#6b7280',fontSize:12}}><span>IGST</span><span>₹{Number(o.igst||0).toFixed(2)}</span></div>}
                                        <div style={{display:'flex',justifyContent:'space-between',padding:'2px 0',color:'#6b7280',fontSize:12,fontWeight:600}}>
                                          <span>Total GST</span><span>₹{Number(o.totalGst||0).toFixed(2)}</span>
                                        </div>
                                      </>
                                    )}
                                    <div style={{display:'flex',justifyContent:'space-between',padding:'5px 0',borderTop:'2px solid #1E3A5F',marginTop:2,fontWeight:700,fontSize:14,color:'#1E3A5F'}}>
                                      <span>Total</span>
                                      <span>₹{Number(o.total||0).toFixed(2)}</span>
                                    </div>
                                  </div>
                                </div>
                              )}
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  ))}
                </tbody>
              </table>
            </div>
            {totalOrdPages > 1 && (
              <div className="tbl-pagination">
                <button className="tbl-pg-btn" onClick={() => setOrderPage(p=>Math.max(1,p-1))} disabled={safeOrdPage===1}>‹ Prev</button>
                <span className="tbl-pg-info">Page {safeOrdPage} of {totalOrdPages}</span>
                <button className="tbl-pg-btn" onClick={() => setOrderPage(p=>Math.min(totalOrdPages,p+1))} disabled={safeOrdPage===totalOrdPages}>Next ›</button>
              </div>
            )}
          </div>
        );})()}{/* end orders page */}

        {/* ── RENTAL PAGE (Gosuas tenant only) ── */}
        {activePage === 'rental' && tenantInfo?.subdomain === 'gosuas' && (
          <div className="page-content">
            <section>
              <h2>New Rental</h2>
              <div className="barcode-row">
                <input
                  ref={rentalCodeRef}
                  placeholder="Scan barcode or enter product code"
                  autoFocus
                  value={rentalCode}
                  onChange={e => setRentalCode(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && lookupRentalProduct()}
                />
                <button onClick={lookupRentalProduct}>Find Product</button>
              </div>
              {rentalError && <p className="error-msg">{rentalError}</p>}
              {rentalProduct && (
                <div className="rental-product-preview">
                  <strong>{rentalProduct.name}</strong>
                  <span>SKU: {rentalProduct.sku || '—'} · Barcode: {rentalProduct.barcode} · Total stock: {rentalProduct.stockQty}</span>
                </div>
              )}

              <div className="rental-form-grid">
                <div>
                  <label className="modal-label">Booking Date</label>
                  <input type="date" value={rentalBookingDate}
                    onChange={e => setRentalBookingDate(e.target.value)} />
                </div>
                <div>
                  <label className="modal-label">Event Period (days)</label>
                  <input type="number" min="1" value={rentalEventDays}
                    onChange={e => setRentalEventDays(Math.max(1, Number(e.target.value) || 1))} />
                </div>
                <div>
                  <label className="modal-label">Quantity</label>
                  <input type="number" min="1" value={rentalQty}
                    onChange={e => setRentalQty(Math.max(1, Number(e.target.value) || 1))} />
                </div>
                <div>
                  <label className="modal-label">Advance Amount (₹)</label>
                  <input type="number" min="0" placeholder="0" value={rentalAdvance}
                    onChange={e => setRentalAdvance(e.target.value)} />
                </div>
                <div>
                  <label className="modal-label">Deposit Amount (₹)</label>
                  <input type="number" min="0" placeholder="0" value={rentalDeposit}
                    onChange={e => setRentalDeposit(e.target.value)} />
                </div>
                <div>
                  <label className="modal-label">Rent (₹)</label>
                  <input type="number" min="0" placeholder="0" value={rentalRent}
                    onChange={e => setRentalRent(e.target.value)} />
                </div>
                <div>
                  <label className="modal-label">Total (₹)</label>
                  <input type="text" disabled value={((Number(rentalAdvance) || 0) + (Number(rentalDeposit) || 0) + (Number(rentalRent) || 0)).toFixed(2)} />
                </div>
                <div>
                  <label className="modal-label">Customer Name <span style={{fontWeight:400,color:'#9ca3af'}}>(optional)</span></label>
                  <input placeholder="Walk-in Customer" value={rentalCustName}
                    onChange={e => setRentalCustName(e.target.value)} />
                </div>
                <div>
                  <label className="modal-label">Mobile Number <span style={{fontWeight:400,color:'#9ca3af'}}>(optional)</span></label>
                  <input placeholder="Optional" value={rentalCustMobile}
                    onChange={e => setRentalCustMobile(e.target.value)} />
                </div>
              </div>

              <button disabled={!rentalProduct || !rentalBookingDate} onClick={createRental}>Generate Rental</button>
            </section>

            <section style={{marginTop:20}}>
              <h2>Rental History</h2>
              <div className="data-table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Rental #</th><th>Product</th><th>Qty</th><th>Customer</th><th>Contact</th>
                      <th>Booking Window</th><th>Advance</th><th>Deposit</th><th>Rent</th><th>Total</th><th>Status</th><th></th><th></th><th></th><th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {rentals.length === 0 && (
                      <tr><td colSpan={15} style={{textAlign:'center',color:'#888',padding:'16px'}}>No rentals yet</td></tr>
                    )}
                    {rentals.map(r => (
                      <tr key={r.id}>
                        <td className="td-ordnum">{r.rentalNo}</td>
                        <td className="td-name">{r.productName}</td>
                        <td className="td-center">{r.quantity}</td>
                        <td className="td-name">{r.customerName || '—'}</td>
                        <td>{r.customerMobile || '—'}</td>
                        <td className="td-date">{r.bookingDate || '—'}{r.bookingEndDate && r.bookingEndDate !== r.bookingDate ? ` → ${r.bookingEndDate}` : ''}{r.eventPeriodDays ? ` (${r.eventPeriodDays}d)` : ''}</td>
                        <td className="td-amt">₹{Number(r.advanceAmount || 0).toFixed(2)}</td>
                        <td className="td-amt">
                          ₹{Number(r.depositAmount || 0).toFixed(2)}
                          {r.status === 'RETURNED' && (
                            <div className="rental-refund-note">
                              {Number(r.deductionAmount || 0) > 0 && <span className="rental-deduction">− ₹{Number(r.deductionAmount).toFixed(2)} damage</span>}
                              <span className="rental-refunded">Refunded ₹{Number(r.refundAmount ?? r.depositAmount ?? 0).toFixed(2)}</span>
                            </div>
                          )}
                        </td>
                        <td className="td-amt">₹{Number(r.rentAmount || 0).toFixed(2)}</td>
                        <td className="td-amt">₹{Number(r.totalAmount || 0).toFixed(2)}</td>
                        <td>
                          <span className={`status-badge status-${(r.status || '').toLowerCase()}`}>{r.status}</span>
                          {r.status === 'RETURNED' && r.returnedAt && <div className="td-date" style={{marginTop:4}}>{r.returnedAt.slice(0,10)}</div>}
                        </td>
                        <td>
                          {r.status !== 'RETURNED' && (
                            <button className="rental-return-btn" onClick={() => openReturnModal(r)}>Return</button>
                          )}
                        </td>
                        <td><button className="rental-edit-btn" onClick={() => openRentalEdit(r)}>✎ Edit</button></td>
                        <td><button className="rental-edit-btn" onClick={() => printRentalReceipt(r, tenantInfo?.name)}>🖨 Receipt</button></td>
                        <td><button className="delete-btn" onClick={() => deleteRental(r)}>🗑</button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          </div>
        )}{/* end rental page */}

        {/* ── PLAN PAGE ── */}
        {activePage === 'plan' && (() => {
          const plan = tenantInfo?.plan || 'FREE';
          const status = tenantInfo?.status || '—';
          const productCount = products.length;
          const FREE_LIMIT = 50;
          const usagePct = plan === 'FREE' ? Math.min(100, Math.round((productCount / FREE_LIMIT) * 100)) : null;
          const planColors = { FREE: '#6b7280', STARTER: '#3b82f6', PRO: '#8b5cf6' };
          const planColor = planColors[plan] || '#6b7280';
          return (
            <div className="page-content" style={{maxWidth:680,margin:'0 auto'}}>
              <div style={{background:'#fff',borderRadius:12,border:'1.5px solid #e5e7eb',padding:'32px 36px',marginBottom:24}}>
                <div style={{display:'flex',alignItems:'center',gap:16,marginBottom:24}}>
                  <div style={{width:52,height:52,borderRadius:12,background:planColor,display:'flex',alignItems:'center',justifyContent:'center',fontSize:26}}>
                    {plan==='PRO'?'👑':plan==='STARTER'?'⭐':'🆓'}
                  </div>
                  <div>
                    <div style={{fontSize:22,fontWeight:700,color:'#1f2937'}}>{plan} Plan</div>
                    <div style={{fontSize:14,color: status==='ACTIVE'?'#16a34a':'#dc2626',fontWeight:600,marginTop:2}}>
                      {status==='ACTIVE'?'✓ Active':status==='TRIAL'?'⏳ Trial':status}
                    </div>
                  </div>
                </div>

                {plan === 'FREE' && (
                  <div style={{marginBottom:20}}>
                    <div style={{display:'flex',justifyContent:'space-between',marginBottom:6}}>
                      <span style={{fontSize:14,color:'#4b5563',fontWeight:600}}>Product usage</span>
                      <span style={{fontSize:14,color: productCount >= FREE_LIMIT ? '#dc2626':'#374151',fontWeight:700}}>
                        {productCount} / {FREE_LIMIT}
                      </span>
                    </div>
                    <div style={{height:10,background:'#f3f4f6',borderRadius:99,overflow:'hidden'}}>
                      <div style={{height:'100%',width:`${usagePct}%`,background: usagePct >= 90 ? '#ef4444': usagePct >= 70 ? '#f97316':'#3b82f6',borderRadius:99,transition:'width 0.3s'}} />
                    </div>
                    {productCount >= FREE_LIMIT && (
                      <div style={{marginTop:8,padding:'8px 12px',background:'#fef2f2',borderRadius:8,fontSize:13,color:'#dc2626',fontWeight:600}}>
                        ⚠ Product limit reached. Upgrade to add more products.
                      </div>
                    )}
                  </div>
                )}

                <div style={{borderTop:'1px solid #f3f4f6',paddingTop:20}}>
                  <div style={{fontSize:15,fontWeight:600,color:'#374151',marginBottom:12}}>Plan features</div>
                  {plan === 'FREE' && (
                    <ul style={{margin:0,padding:0,listStyle:'none',display:'flex',flexDirection:'column',gap:8}}>
                      {['Up to 50 products','POS billing','Online shop','Basic reports'].map(f => (
                        <li key={f} style={{display:'flex',gap:8,fontSize:14,color:'#4b5563'}}><span style={{color:'#16a34a'}}>✓</span>{f}</li>
                      ))}
                      {['Unlimited products','Priority support','Custom domain'].map(f => (
                        <li key={f} style={{display:'flex',gap:8,fontSize:14,color:'#9ca3af'}}><span>✗</span>{f}</li>
                      ))}
                    </ul>
                  )}
                  {plan === 'STARTER' && (
                    <ul style={{margin:0,padding:0,listStyle:'none',display:'flex',flexDirection:'column',gap:8}}>
                      {['Unlimited products','POS billing','Online shop','Full reports','Priority support'].map(f => (
                        <li key={f} style={{display:'flex',gap:8,fontSize:14,color:'#4b5563'}}><span style={{color:'#16a34a'}}>✓</span>{f}</li>
                      ))}
                    </ul>
                  )}
                  {plan === 'PRO' && (
                    <ul style={{margin:0,padding:0,listStyle:'none',display:'flex',flexDirection:'column',gap:8}}>
                      {['Everything in STARTER','Custom domain','White-label','Dedicated support'].map(f => (
                        <li key={f} style={{display:'flex',gap:8,fontSize:14,color:'#4b5563'}}><span style={{color:'#16a34a'}}>✓</span>{f}</li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>

              {upgradeError && (
                <div style={{marginBottom:16,padding:'10px 16px',background:'#fef2f2',border:'1.5px solid #fecaca',borderRadius:10,fontSize:13,color:'#dc2626',fontWeight:600}}>
                  {upgradeError}
                </div>
              )}

              {plan !== 'PRO' && (
                <div style={{display:'flex',flexDirection:'column',gap:14}}>
                  {plan === 'FREE' && (
                    <div style={{background:'linear-gradient(135deg,#3b82f6 0%,#60a5fa 100%)',borderRadius:12,padding:'24px 32px',color:'#fff',textAlign:'center'}}>
                      <div style={{fontSize:18,fontWeight:700,marginBottom:6}}>⭐ Upgrade to STARTER — ₹{UPGRADE_PLAN_PRICES.STARTER}/month</div>
                      <div style={{fontSize:13,opacity:0.9,marginBottom:16}}>Unlimited products, full reports, and priority support.</div>
                      <button onClick={() => upgradeToPlan('STARTER')} disabled={!!upgradingPlan}
                        style={{background:'#fff',color:'#2563eb',fontWeight:700,fontSize:15,padding:'10px 28px',borderRadius:8,border:'none',cursor:upgradingPlan?'default':'pointer',opacity:upgradingPlan?0.7:1}}>
                        {upgradingPlan==='STARTER' ? 'Processing…' : 'Upgrade Plan →'}
                      </button>
                    </div>
                  )}
                  <div style={{background:'linear-gradient(135deg,#6C3FD5 0%,#8b5cf6 100%)',borderRadius:12,padding:'24px 32px',color:'#fff',textAlign:'center'}}>
                    <div style={{fontSize:18,fontWeight:700,marginBottom:6}}>👑 Upgrade to PRO — ₹{UPGRADE_PLAN_PRICES.PRO}/month</div>
                    <div style={{fontSize:13,opacity:0.9,marginBottom:16}}>Everything in STARTER, plus custom domain, white-label, and dedicated support.</div>
                    <button onClick={() => upgradeToPlan('PRO')} disabled={!!upgradingPlan}
                      style={{background:'#fff',color:'#6C3FD5',fontWeight:700,fontSize:15,padding:'10px 28px',borderRadius:8,border:'none',cursor:upgradingPlan?'default':'pointer',opacity:upgradingPlan?0.7:1}}>
                      {upgradingPlan==='PRO' ? 'Processing…' : 'Upgrade Plan →'}
                    </button>
                  </div>
                  <div style={{textAlign:'center',fontSize:12,color:'#9ca3af'}}>
                    Secure payment via Razorpay. Questions? Email <a href="mailto:support@theshopclaude.com" style={{color:'#6b7280'}}>support@theshopclaude.com</a>
                  </div>
                </div>
              )}
              {plan === 'PRO' && (
                <div style={{background:'#f0fdf4',border:'1.5px solid #bbf7d0',borderRadius:12,padding:'20px 36px',textAlign:'center',fontSize:14,color:'#166534'}}>
                  <strong>👑 You're on our highest plan.</strong> For billing questions, email <a href="mailto:support@theshopclaude.com" style={{color:'#166534'}}>support@theshopclaude.com</a>
                </div>
              )}
            </div>
          );
        })()}{/* end plan page */}

        {/* ── PDF Store page ── */}
        {activePage === 'pdf-store' && <PdfStorePage tenantInfo={tenantInfo} />}

        {/* ── Sales Returns page ── */}
        {activePage === 'returns' && (() => {
          const STATUS_COLORS = { PENDING:'#b45309', APPROVED:'#1d4ed8', REJECTED:'#dc2626', COMPLETED:'#15803d', CANCELLED:'#6b7280' };
          const q = returnSearch.toLowerCase();
          const filtered = salesReturns.filter(r =>
            (returnStatusFilter === 'ALL' || r.status === returnStatusFilter) &&
            (!q || [r.returnNo, r.sourceBillNo, r.customerName, r.customerMobile].join(' ').toLowerCase().includes(q))
          );
          const totalRetPages = Math.max(1, Math.ceil(filtered.length / PAGE_ROWS));
          const safeRetPage = Math.min(returnPage, totalRetPages);
          const retSlice = filtered.slice((safeRetPage-1)*PAGE_ROWS, safeRetPage*PAGE_ROWS);

          const lookupPreview = async () => {
            if (!returnPreviewRef.ref.trim()) return;
            setReturnPreviewLoading(true); setReturnPreviewError(''); setReturnPreview(null);
            try {
              const res = await axios.get(`${API}/returns/preview`, {
                params: { sourceType: returnPreviewRef.sourceType, ref: returnPreviewRef.ref.trim() }
              });
              setReturnPreview(res.data);
              setReturnFormItems(res.data.items.map(i => ({
                barcode: i.barcode, productName: i.productName, unitPrice: i.unitPrice,
                returnableQty: i.returnableQty, originalQty: i.originalQty,
                returnedQty: 0, restockable: true,
              })));
              setReturnFormMeta({ returnReason: '', remarks: '', refundMode: 'CASH' });
              setReturnSubmitError('');
            } catch (err) {
              setReturnPreviewError(err.response?.data?.error || 'Sale not found. Check the reference number.');
            } finally { setReturnPreviewLoading(false); }
          };

          const submitReturn = async () => {
            const itemsToReturn = returnFormItems.filter(i => i.returnedQty > 0);
            if (!itemsToReturn.length) { setReturnSubmitError('Enter a return quantity for at least one item.'); return; }
            setReturnSubmitLoading(true); setReturnSubmitError('');
            try {
              await axios.post(`${API}/returns`, {
                sourceType: returnPreview.sourceType,
                sourceBillId: returnPreview.sourceBillId,
                returnReason: returnFormMeta.returnReason || null,
                remarks: returnFormMeta.remarks || null,
                refundMode: returnFormMeta.refundMode || null,
                items: itemsToReturn.map(i => ({
                  barcode: i.barcode, returnedQty: i.returnedQty, restockable: i.restockable
                })),
              });
              setShowCreateReturn(false); setReturnPreview(null); setReturnPreviewRef({ sourceType:'POS', ref:'' });
              loadSalesReturns(); showToast('Return created successfully');
            } catch (err) {
              setReturnSubmitError(err.response?.data?.error || 'Failed to create return.');
            } finally { setReturnSubmitLoading(false); }
          };

          const applyStatus = async (retId, newStatus) => {
            if (returnStatusBusy) return;
            setReturnStatusBusy(retId);
            try {
              await axios.put(`${API}/returns/${retId}/status`, { status: newStatus });
              await loadSalesReturns();
              // Approve / cancel move stock — refresh inventory so Home and Stock Alerts match the DB
              if (newStatus === 'APPROVED' || newStatus === 'CANCELLED') await loadProducts();
              showToast(`Return ${newStatus.toLowerCase()}`);
            } catch (err) {
              showToast(err.response?.data?.error || 'Failed to update status. Check your connection and try again.', 'error');
              loadSalesReturns();
            } finally { setReturnStatusBusy(null); }
          };

          // Status changes that move stock need an explicit confirmation first.
          const changeStatus = (ret, newStatus) => {
            const restockQty = (ret.items || []).filter(i => i.restockable).reduce((s, i) => s + (i.returnedQty || 0), 0);
            if (newStatus === 'APPROVED') {
              setConfirmDialog({
                title: `Approve ${ret.returnNo}?`,
                message: restockQty > 0
                  ? `${restockQty} unit(s) marked Restock will be added back to inventory.`
                  : 'No items are marked Restock, so inventory will not change.',
                confirmLabel: 'Approve',
                onConfirm: () => { setConfirmDialog(null); applyStatus(ret.id, newStatus); },
              });
            } else if (newStatus === 'CANCELLED' && ret.stockRestored) {
              setConfirmDialog({
                title: `Cancel ${ret.returnNo}?`,
                message: `${restockQty} unit(s) already restocked by this return will be removed from inventory again.`,
                confirmLabel: 'Cancel Return',
                onConfirm: () => { setConfirmDialog(null); applyStatus(ret.id, newStatus); },
              });
            } else {
              applyStatus(ret.id, newStatus);
            }
          };

          const lookupDirectProduct = async () => {
            if (!returnDirectSku.trim()) return;
            setReturnDirectLoading(true); setReturnDirectError(''); setReturnDirectProduct(null);
            try {
              const res = await axios.get(`${API}/returns/product-lookup`, { params: { sku: returnDirectSku.trim() } });
              setReturnDirectProduct({ ...res.data, returnedQty: 1, restockable: true });
            } catch (err) {
              setReturnDirectError(err.response?.data?.error || 'Product not found. Check the SKU or barcode.');
            } finally { setReturnDirectLoading(false); }
          };

          const addDirectItem = () => {
            if (!returnDirectProduct) return;
            if (returnDirectProduct.returnedQty < 1) { setReturnDirectError('Quantity must be at least 1.'); return; }
            const barcode = returnDirectProduct.barcode;
            const existing = returnDirectItems.find(i => i.barcode === barcode);
            if (existing) {
              setReturnDirectItems(prev => prev.map(i => i.barcode === barcode
                ? { ...i, returnedQty: i.returnedQty + returnDirectProduct.returnedQty } : i));
            } else {
              setReturnDirectItems(prev => [...prev, {
                productId: returnDirectProduct.productId,
                productName: returnDirectProduct.productName,
                barcode: returnDirectProduct.barcode,
                unitPrice: returnDirectProduct.sellingPrice || 0,
                returnedQty: returnDirectProduct.returnedQty,
                restockable: returnDirectProduct.restockable,
              }]);
            }
            setReturnDirectProduct(null); setReturnDirectSku(''); setReturnDirectError('');
          };

          const submitDirectReturn = async () => {
            if (!returnDirectItems.length) { setReturnSubmitError('Add at least one item.'); return; }
            setReturnSubmitLoading(true); setReturnSubmitError('');
            try {
              await axios.post(`${API}/returns`, {
                sourceType: 'DIRECT',
                sourceBillId: null,
                customerName: returnDirectCustomer.name || null,
                customerMobile: returnDirectCustomer.mobile || null,
                returnReason: returnFormMeta.returnReason || null,
                remarks: returnFormMeta.remarks || null,
                refundMode: returnFormMeta.refundMode || null,
                items: returnDirectItems.map(i => ({
                  barcode: i.barcode, returnedQty: i.returnedQty, restockable: i.restockable
                })),
              });
              setShowCreateReturn(false); setReturnPreview(null); setReturnPreviewRef({ sourceType:'POS', ref:'' });
              setReturnDirectSku(''); setReturnDirectProduct(null); setReturnDirectItems([]);
              setReturnDirectCustomer({ name: '', mobile: '' });
              loadSalesReturns(); showToast('Return created successfully');
            } catch (err) {
              setReturnSubmitError(err.response?.data?.error || 'Failed to create return.');
            } finally { setReturnSubmitLoading(false); }
          };

          return (
            <div className="page-content">
              {/* Toolbar */}
              <div className="cust-toolbar" style={{marginBottom:12}}>
                <input className="cust-search" placeholder="🔍 Search return #, bill #, customer…"
                  value={returnSearch} onChange={e => { setReturnSearch(e.target.value); setReturnPage(1); }} />
                <div className="order-src-filters">
                  {['ALL','PENDING','APPROVED','REJECTED','COMPLETED','CANCELLED'].map(s => (
                    <button key={s} className={`src-filter-btn ${returnStatusFilter===s?'src-active':''}`}
                      onClick={() => { setReturnStatusFilter(s); setReturnPage(1); }}>
                      {s === 'ALL' ? 'All' : s.charAt(0) + s.slice(1).toLowerCase()}
                      <span className="src-count">{s==='ALL' ? salesReturns.length : salesReturns.filter(r=>r.status===s).length}</span>
                    </button>
                  ))}
                </div>
                <button className="btn-primary" style={{marginLeft:'auto'}} onClick={() => {
                  setShowCreateReturn(true); setReturnPreview(null);
                  setReturnPreviewRef({ sourceType:'POS', ref:'' }); setReturnPreviewError('');
                  setReturnMode('bill');
                  setReturnDirectSku(''); setReturnDirectProduct(null); setReturnDirectError('');
                  setReturnDirectItems([]); setReturnDirectCustomer({ name: '', mobile: '' });
                  setReturnFormMeta({ returnReason: '', remarks: '', refundMode: 'CASH' });
                  setReturnSubmitError('');
                }}>+ New Return</button>
              </div>

              {salesReturnsError && (
                <div style={{padding:'10px 14px',background:'#fef2f2',border:'1px solid #fecaca',borderRadius:8,fontSize:13,color:'#dc2626',marginBottom:12,display:'flex',alignItems:'center',gap:12}}>
                  {salesReturnsError}
                  <button className="btn-secondary" style={{fontSize:12,padding:'4px 12px'}} onClick={loadSalesReturns}>Retry</button>
                </div>
              )}

              {/* Returns table */}
              <div className="data-table-wrap">
                <table className="data-table">
                  <thead><tr><th>Return #</th><th>Source</th><th>Bill / Order #</th><th>Customer</th><th>Date</th><th>Amount</th><th>Refund Mode</th><th>Refund</th><th>Status</th><th></th></tr></thead>
                  <tbody>
                    {retSlice.length === 0 && (
                      <tr><td colSpan={10} style={{textAlign:'center',padding:'32px',color:'#9ca3af'}}>No returns found.</td></tr>
                    )}
                    {retSlice.map(r => (
                      <React.Fragment key={r.id}>
                        <tr className={`order-row ${expandedReturn===r.id?'order-row-open':''}`}
                          onClick={() => setExpandedReturn(expandedReturn===r.id ? null : r.id)}
                          style={{cursor:'pointer'}}>
                          <td className="td-ordnum">{r.returnNo}</td>
                          <td><span className={`src-badge src-${r.sourceType}`}>{r.sourceType}</span></td>
                          <td>{r.sourceBillNo}</td>
                          <td className="td-name">{r.customerName || '—'}</td>
                          <td className="td-date">{r.returnDate || (r.createdAt?.slice(0,10) ?? '—')}</td>
                          <td className="td-amt">₹{Number(r.totalReturnAmount||0).toFixed(2)}</td>
                          <td>{r.refundMode || '—'}</td>
                          <td><span style={{fontSize:12,fontWeight:600,color:r.refundStatus==='REFUNDED'?'#15803d':'#b45309'}}>{r.refundStatus}</span></td>
                          <td><span style={{fontSize:12,fontWeight:700,color:STATUS_COLORS[r.status]||'#374151'}}>{r.status}</span></td>
                          <td className="td-expand">{expandedReturn===r.id?'▲':'▼'}</td>
                        </tr>
                        {expandedReturn===r.id && (
                          <tr className="order-items-row">
                            <td colSpan={10}>
                              <div className="order-items-wrap">
                                {r.returnReason && <div style={{marginBottom:8,fontSize:13}}><strong>Reason:</strong> {r.returnReason}{r.remarks ? ` — ${r.remarks}` : ''}</div>}
                                <table style={{width:'100%',borderCollapse:'collapse',fontSize:13,marginBottom:12}}>
                                  <thead><tr style={{background:'#f9fafb'}}>
                                    <th style={{padding:'6px 8px',textAlign:'left'}}>Product</th>
                                    <th style={{padding:'6px 8px',textAlign:'left'}}>Barcode</th>
                                    <th style={{padding:'6px 8px',textAlign:'right'}}>Qty</th>
                                    <th style={{padding:'6px 8px',textAlign:'right'}}>Unit Price</th>
                                    <th style={{padding:'6px 8px',textAlign:'right'}}>Line Total</th>
                                    <th style={{padding:'6px 8px',textAlign:'center'}}>Restockable</th>
                                  </tr></thead>
                                  <tbody>
                                    {(r.items||[]).map((item,idx) => (
                                      <tr key={idx} style={{borderTop:'1px solid #f3f4f6'}}>
                                        <td style={{padding:'6px 8px'}}>{item.productName}</td>
                                        <td style={{padding:'6px 8px',fontFamily:'monospace',fontSize:12}}>{item.barcode}</td>
                                        <td style={{padding:'6px 8px',textAlign:'right'}}>{item.returnedQty}</td>
                                        <td style={{padding:'6px 8px',textAlign:'right'}}>₹{Number(item.unitPrice||0).toFixed(2)}</td>
                                        <td style={{padding:'6px 8px',textAlign:'right'}}>₹{Number(item.lineTotal||0).toFixed(2)}</td>
                                        <td style={{padding:'6px 8px',textAlign:'center'}}>{item.restockable ? '✓' : '✗'}</td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                                {/* Status action buttons */}
                                <div style={{display:'flex',gap:8,flexWrap:'wrap'}}>
                                  {r.status === 'PENDING' && <>
                                    <button className="btn-primary" style={{fontSize:13,padding:'6px 14px'}} disabled={returnStatusBusy === r.id}
                                      onClick={e => { e.stopPropagation(); changeStatus(r, 'APPROVED'); }}>Approve</button>
                                    <button className="btn-secondary" style={{fontSize:13,padding:'6px 14px',color:'#dc2626',borderColor:'#fca5a5'}} disabled={returnStatusBusy === r.id}
                                      onClick={e => { e.stopPropagation(); changeStatus(r, 'REJECTED'); }}>Reject</button>
                                    <button className="btn-secondary" style={{fontSize:13,padding:'6px 14px'}} disabled={returnStatusBusy === r.id}
                                      onClick={e => { e.stopPropagation(); changeStatus(r, 'CANCELLED'); }}>Cancel</button>
                                  </>}
                                  {r.status === 'APPROVED' && <>
                                    <button className="btn-primary" style={{fontSize:13,padding:'6px 14px'}} disabled={returnStatusBusy === r.id}
                                      onClick={e => { e.stopPropagation(); changeStatus(r, 'COMPLETED'); }}>Mark Completed</button>
                                    <button className="btn-secondary" style={{fontSize:13,padding:'6px 14px'}} disabled={returnStatusBusy === r.id}
                                      onClick={e => { e.stopPropagation(); changeStatus(r, 'CANCELLED'); }}>Cancel</button>
                                  </>}
                                  {returnStatusBusy === r.id && <span style={{fontSize:13,color:'#6b7280',alignSelf:'center'}}>Updating…</span>}
                                </div>
                              </div>
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Pagination */}
              {totalRetPages > 1 && (
                <div className="pagination">
                  {Array.from({length:totalRetPages},(_,i)=>i+1).map(p => (
                    <button key={p} className={`page-btn ${safeRetPage===p?'page-active':''}`}
                      onClick={() => setReturnPage(p)}>{p}</button>
                  ))}
                </div>
              )}

              {/* Create Return Modal */}
              {showCreateReturn && (
                <div className="modal-overlay" onClick={() => setShowCreateReturn(false)}>
                  <div className="modal-box" style={{width:680,maxWidth:'95vw',maxHeight:'90vh',overflowY:'auto'}}
                    onClick={e => e.stopPropagation()}>
                    <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:16}}>
                      <h3 style={{margin:0}}>New Sales Return</h3>
                      <button type="button" style={{background:'none',border:'none',fontSize:22,cursor:'pointer',color:'#666',lineHeight:1}} onClick={() => setShowCreateReturn(false)}>×</button>
                    </div>

                    {/* Mode tabs */}
                    <div style={{display:'flex',borderRadius:8,overflow:'hidden',border:'1.5px solid #e5e7eb',marginBottom:18}}>
                      <button type="button" style={{flex:1,padding:'9px',fontSize:13,fontWeight:600,background:returnMode==='bill'?'#1E3A5F':'#fff',color:returnMode==='bill'?'#fff':'#374151',border:'none',cursor:'pointer'}}
                        onClick={() => { setReturnMode('bill'); setReturnPreview(null); setReturnPreviewRef({sourceType:'POS',ref:''}); setReturnPreviewError(''); setReturnSubmitError(''); }}>
                        By Bill / Order #
                      </button>
                      <button type="button" style={{flex:1,padding:'9px',fontSize:13,fontWeight:600,background:returnMode==='direct'?'#1E3A5F':'#fff',color:returnMode==='direct'?'#fff':'#374151',border:'none',cursor:'pointer',borderLeft:'1px solid #e5e7eb'}}
                        onClick={() => { setReturnMode('direct'); setReturnSubmitError(''); }}>
                        By SKU / Direct
                      </button>
                    </div>

                    {/* ── Bill / Order mode ── */}
                    {returnMode === 'bill' && (
                      <>
                        {!returnPreview && (
                          <div>
                            <div style={{display:'flex',gap:10,marginBottom:8}}>
                              <select value={returnPreviewRef.sourceType}
                                onChange={e => setReturnPreviewRef(r => ({...r, sourceType: e.target.value}))}
                                style={{padding:'9px 12px',border:'1.5px solid #e5e7eb',borderRadius:8,fontSize:14,background:'#fff'}}>
                                <option value="POS">POS / Offline Bill</option>
                                <option value="ONLINE">Online Order</option>
                              </select>
                              <input style={{flex:1,padding:'9px 12px',border:'1.5px solid #e5e7eb',borderRadius:8,fontSize:14}}
                                placeholder={returnPreviewRef.sourceType==='POS' ? 'Bill number, e.g. GOS-20241013-0001' : 'Order number, e.g. WEB-20241013-0001'}
                                value={returnPreviewRef.ref}
                                onChange={e => setReturnPreviewRef(r => ({...r, ref: e.target.value}))}
                                onKeyDown={e => e.key==='Enter' && lookupPreview()} />
                              <button className="btn-primary" onClick={lookupPreview} disabled={returnPreviewLoading}>
                                {returnPreviewLoading ? '…' : 'Look Up'}
                              </button>
                            </div>
                            {returnPreviewError && <div style={{padding:'10px',background:'#fef2f2',borderRadius:8,fontSize:13,color:'#dc2626',marginBottom:8}}>{returnPreviewError}</div>}
                            <div style={{fontSize:13,color:'#6b7280'}}>Enter the original bill or order number to load its items.</div>
                          </div>
                        )}

                        {returnPreview && (
                          <div>
                            <div style={{background:'#f0fdf4',border:'1px solid #bbf7d0',borderRadius:8,padding:'10px 14px',marginBottom:14,fontSize:13}}>
                              <strong>{returnPreview.sourceBillNo}</strong> · {returnPreview.customerName || 'Walk-in'}
                              {returnPreview.customerMobile ? ` · ${returnPreview.customerMobile}` : ''}
                              <button style={{marginLeft:12,fontSize:12,color:'#6b7280',background:'none',border:'none',cursor:'pointer',textDecoration:'underline'}}
                                onClick={() => { setReturnPreview(null); setReturnPreviewRef(r => ({...r, ref:''})); }}>Change</button>
                            </div>

                            <div style={{overflowX:'auto',marginBottom:14}}>
                              <table style={{width:'100%',borderCollapse:'collapse',fontSize:13}}>
                                <thead><tr style={{background:'#f9fafb',borderBottom:'2px solid #e5e7eb'}}>
                                  <th style={{padding:'8px',textAlign:'left'}}>Product</th>
                                  <th style={{padding:'8px',textAlign:'right'}}>Returnable</th>
                                  <th style={{padding:'8px',textAlign:'right',width:90}}>Return Qty</th>
                                  <th style={{padding:'8px',textAlign:'center',width:80}}>Restock?</th>
                                  <th style={{padding:'8px',textAlign:'right'}}>Subtotal</th>
                                </tr></thead>
                                <tbody>
                                  {returnFormItems.map((item, idx) => (
                                    <tr key={idx} style={{borderBottom:'1px solid #f3f4f6'}}>
                                      <td style={{padding:'8px'}}>
                                        <div style={{fontWeight:600}}>{item.productName}</div>
                                        <div style={{fontSize:11,color:'#9ca3af',fontFamily:'monospace'}}>{item.barcode}</div>
                                      </td>
                                      <td style={{padding:'8px',textAlign:'right',color:'#6b7280'}}>{item.returnableQty}</td>
                                      <td style={{padding:'8px',textAlign:'right'}}>
                                        <input type="number" min="0" step="1" max={item.returnableQty}
                                          style={{width:70,padding:'5px',border:'1.5px solid #e5e7eb',borderRadius:6,textAlign:'right',fontSize:13}}
                                          value={item.returnedQty}
                                          onChange={e => {
                                            // Whole units only — the backend field is an integer and would silently truncate 2.5
                                            const v = Math.min(item.returnableQty, Math.max(0, Math.floor(Number(e.target.value)||0)));
                                            setReturnFormItems(prev => prev.map((x,i) => i===idx ? {...x, returnedQty: v} : x));
                                          }} />
                                      </td>
                                      <td style={{padding:'8px',textAlign:'center'}}>
                                        <input type="checkbox" checked={item.restockable}
                                          onChange={e => setReturnFormItems(prev => prev.map((x,i) => i===idx ? {...x, restockable: e.target.checked} : x))} />
                                      </td>
                                      <td style={{padding:'8px',textAlign:'right'}}>
                                        ₹{(Number(item.unitPrice||0) * item.returnedQty).toFixed(2)}
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                                <tfoot>
                                  <tr style={{borderTop:'2px solid #e5e7eb',fontWeight:700}}>
                                    <td colSpan={4} style={{padding:'8px',textAlign:'right'}}>Total Return Amount</td>
                                    <td style={{padding:'8px',textAlign:'right'}}>
                                      ₹{returnFormItems.reduce((s,i) => s + Number(i.unitPrice||0)*i.returnedQty, 0).toFixed(2)}
                                    </td>
                                  </tr>
                                </tfoot>
                              </table>
                            </div>

                            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10,marginBottom:12}}>
                              <div>
                                <label style={{display:'block',fontSize:12,fontWeight:600,color:'#374151',marginBottom:4}}>Return Reason</label>
                                <select value={returnFormMeta.returnReason}
                                  onChange={e => setReturnFormMeta(m => ({...m, returnReason: e.target.value}))}
                                  style={{width:'100%',padding:'9px 10px',border:'1.5px solid #e5e7eb',borderRadius:8,fontSize:13,background:'#fff'}}>
                                  <option value="">— Select reason —</option>
                                  <option value="DEFECTIVE">Defective / Damaged</option>
                                  <option value="SIZE_ISSUE">Wrong Size</option>
                                  <option value="WRONG_ITEM">Wrong Item Delivered</option>
                                  <option value="CHANGE_OF_MIND">Change of Mind</option>
                                  <option value="OTHER">Other</option>
                                </select>
                              </div>
                              <div>
                                <label style={{display:'block',fontSize:12,fontWeight:600,color:'#374151',marginBottom:4}}>Refund Mode</label>
                                <select value={returnFormMeta.refundMode}
                                  onChange={e => setReturnFormMeta(m => ({...m, refundMode: e.target.value}))}
                                  style={{width:'100%',padding:'9px 10px',border:'1.5px solid #e5e7eb',borderRadius:8,fontSize:13,background:'#fff'}}>
                                  <option value="CASH">Cash</option>
                                  <option value="UPI">UPI</option>
                                  <option value="BANK_TRANSFER">Bank Transfer</option>
                                  <option value="STORE_CREDIT">Store Credit</option>
                                  <option value="ONLINE">Online (Razorpay)</option>
                                </select>
                              </div>
                            </div>
                            <div style={{marginBottom:14}}>
                              <label style={{display:'block',fontSize:12,fontWeight:600,color:'#374151',marginBottom:4}}>Remarks (optional)</label>
                              <textarea rows={2} style={{width:'100%',padding:'9px 10px',border:'1.5px solid #e5e7eb',borderRadius:8,fontSize:13,resize:'vertical',boxSizing:'border-box'}}
                                placeholder="Additional notes about this return…"
                                value={returnFormMeta.remarks}
                                onChange={e => setReturnFormMeta(m => ({...m, remarks: e.target.value}))} />
                            </div>

                            {returnSubmitError && <div style={{padding:'10px',background:'#fef2f2',borderRadius:8,fontSize:13,color:'#dc2626',marginBottom:10}}>{returnSubmitError}</div>}
                            <div style={{display:'flex',gap:10,justifyContent:'flex-end'}}>
                              <button className="btn-secondary" onClick={() => setShowCreateReturn(false)}>Cancel</button>
                              <button className="btn-primary" onClick={submitReturn} disabled={returnSubmitLoading}>
                                {returnSubmitLoading ? 'Saving…' : 'Create Return'}
                              </button>
                            </div>
                          </div>
                        )}
                      </>
                    )}

                    {/* ── Direct / SKU mode ── */}
                    {returnMode === 'direct' && (
                      <div>
                        {/* SKU / barcode lookup */}
                        <div style={{display:'flex',gap:8,marginBottom:8}}>
                          <input style={{flex:1,padding:'9px 12px',border:'1.5px solid #e5e7eb',borderRadius:8,fontSize:14}}
                            placeholder="Enter product SKU or scan barcode…"
                            value={returnDirectSku}
                            onChange={e => { setReturnDirectSku(e.target.value); setReturnDirectError(''); setReturnDirectProduct(null); }}
                            onKeyDown={e => e.key==='Enter' && lookupDirectProduct()} />
                          <button className="btn-primary" onClick={lookupDirectProduct} disabled={returnDirectLoading}>
                            {returnDirectLoading ? '…' : 'Look Up'}
                          </button>
                        </div>
                        {returnDirectError && <div style={{padding:'10px',background:'#fef2f2',borderRadius:8,fontSize:13,color:'#dc2626',marginBottom:8}}>{returnDirectError}</div>}

                        {/* Product card */}
                        {returnDirectProduct && (
                          <div style={{background:'#f0fdf4',border:'1px solid #bbf7d0',borderRadius:8,padding:'12px 14px',marginBottom:14}}>
                            <div style={{fontWeight:700,fontSize:15,marginBottom:4}}>{returnDirectProduct.productName}</div>
                            <div style={{fontSize:12,color:'#6b7280',marginBottom:10}}>
                              SKU: {returnDirectProduct.sku} · Barcode: {returnDirectProduct.barcode}
                              {returnDirectProduct.color ? ` · Colour: ${returnDirectProduct.color}` : ''}
                              {returnDirectProduct.size ? ` · Size: ${returnDirectProduct.size}` : ''}
                              {' '}· Current stock: <strong>{returnDirectProduct.stockQty}</strong> · ₹{Number(returnDirectProduct.sellingPrice||0).toFixed(2)}
                            </div>
                            <div style={{display:'flex',gap:12,alignItems:'center',flexWrap:'wrap'}}>
                              <label style={{fontSize:13,fontWeight:600,display:'flex',alignItems:'center',gap:6}}>
                                Qty to Return:
                                <input type="number" min="1" step="1"
                                  style={{width:70,padding:'5px',border:'1.5px solid #e5e7eb',borderRadius:6,textAlign:'right',fontSize:13}}
                                  value={returnDirectProduct.returnedQty}
                                  onChange={e => setReturnDirectProduct(p => ({...p, returnedQty: Math.max(1, Math.floor(Number(e.target.value)||1))}))} />
                              </label>
                              <label style={{fontSize:13,display:'flex',alignItems:'center',gap:5,cursor:'pointer'}}>
                                <input type="checkbox" checked={returnDirectProduct.restockable}
                                  onChange={e => setReturnDirectProduct(p => ({...p, restockable: e.target.checked}))} />
                                Restock to inventory
                              </label>
                              <button className="btn-primary" style={{fontSize:13,padding:'6px 14px'}} onClick={addDirectItem}>+ Add to Return</button>
                            </div>
                          </div>
                        )}

                        {/* Items added so far */}
                        {returnDirectItems.length > 0 && (
                          <div style={{marginBottom:14}}>
                            <table style={{width:'100%',borderCollapse:'collapse',fontSize:13}}>
                              <thead><tr style={{background:'#f9fafb',borderBottom:'2px solid #e5e7eb'}}>
                                <th style={{padding:'8px',textAlign:'left'}}>Product</th>
                                <th style={{padding:'8px',textAlign:'right'}}>Qty</th>
                                <th style={{padding:'8px',textAlign:'right'}}>Unit Price</th>
                                <th style={{padding:'8px',textAlign:'right'}}>Subtotal</th>
                                <th style={{padding:'8px',textAlign:'center'}}>Restock?</th>
                                <th style={{padding:'8px'}}></th>
                              </tr></thead>
                              <tbody>
                                {returnDirectItems.map((item, idx) => (
                                  <tr key={idx} style={{borderBottom:'1px solid #f3f4f6'}}>
                                    <td style={{padding:'8px'}}>
                                      <div style={{fontWeight:600}}>{item.productName}</div>
                                      <div style={{fontSize:11,color:'#9ca3af',fontFamily:'monospace'}}>{item.barcode}</div>
                                    </td>
                                    <td style={{padding:'8px',textAlign:'right'}}>{item.returnedQty}</td>
                                    <td style={{padding:'8px',textAlign:'right'}}>₹{Number(item.unitPrice||0).toFixed(2)}</td>
                                    <td style={{padding:'8px',textAlign:'right'}}>₹{(Number(item.unitPrice||0)*item.returnedQty).toFixed(2)}</td>
                                    <td style={{padding:'8px',textAlign:'center'}}>{item.restockable ? '✓' : '✗'}</td>
                                    <td style={{padding:'8px',textAlign:'center'}}>
                                      <button type="button" style={{background:'none',border:'none',color:'#dc2626',cursor:'pointer',fontSize:18,lineHeight:1}} onClick={() => setReturnDirectItems(prev => prev.filter((_,i) => i!==idx))}>×</button>
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                              <tfoot>
                                <tr style={{borderTop:'2px solid #e5e7eb',fontWeight:700}}>
                                  <td colSpan={3} style={{padding:'8px',textAlign:'right'}}>Total</td>
                                  <td style={{padding:'8px',textAlign:'right'}}>₹{returnDirectItems.reduce((s,i) => s + Number(i.unitPrice||0)*i.returnedQty, 0).toFixed(2)}</td>
                                  <td colSpan={2}></td>
                                </tr>
                              </tfoot>
                            </table>
                          </div>
                        )}

                        {returnDirectItems.length > 0 && (
                          <div>
                            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10,marginBottom:12}}>
                              <div>
                                <label style={{display:'block',fontSize:12,fontWeight:600,color:'#374151',marginBottom:4}}>Customer Name (optional)</label>
                                <input style={{width:'100%',padding:'9px 10px',border:'1.5px solid #e5e7eb',borderRadius:8,fontSize:13,boxSizing:'border-box'}}
                                  placeholder="Walk-in customer"
                                  value={returnDirectCustomer.name}
                                  onChange={e => setReturnDirectCustomer(c => ({...c, name: e.target.value}))} />
                              </div>
                              <div>
                                <label style={{display:'block',fontSize:12,fontWeight:600,color:'#374151',marginBottom:4}}>Mobile (optional)</label>
                                <input style={{width:'100%',padding:'9px 10px',border:'1.5px solid #e5e7eb',borderRadius:8,fontSize:13,boxSizing:'border-box'}}
                                  placeholder="e.g. 9876543210"
                                  value={returnDirectCustomer.mobile}
                                  onChange={e => setReturnDirectCustomer(c => ({...c, mobile: e.target.value}))} />
                              </div>
                            </div>
                            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10,marginBottom:12}}>
                              <div>
                                <label style={{display:'block',fontSize:12,fontWeight:600,color:'#374151',marginBottom:4}}>Return Reason</label>
                                <select value={returnFormMeta.returnReason}
                                  onChange={e => setReturnFormMeta(m => ({...m, returnReason: e.target.value}))}
                                  style={{width:'100%',padding:'9px 10px',border:'1.5px solid #e5e7eb',borderRadius:8,fontSize:13,background:'#fff'}}>
                                  <option value="">— Select reason —</option>
                                  <option value="DEFECTIVE">Defective / Damaged</option>
                                  <option value="SIZE_ISSUE">Wrong Size</option>
                                  <option value="WRONG_ITEM">Wrong Item Delivered</option>
                                  <option value="CHANGE_OF_MIND">Change of Mind</option>
                                  <option value="OTHER">Other</option>
                                </select>
                              </div>
                              <div>
                                <label style={{display:'block',fontSize:12,fontWeight:600,color:'#374151',marginBottom:4}}>Refund Mode</label>
                                <select value={returnFormMeta.refundMode}
                                  onChange={e => setReturnFormMeta(m => ({...m, refundMode: e.target.value}))}
                                  style={{width:'100%',padding:'9px 10px',border:'1.5px solid #e5e7eb',borderRadius:8,fontSize:13,background:'#fff'}}>
                                  <option value="CASH">Cash</option>
                                  <option value="UPI">UPI</option>
                                  <option value="BANK_TRANSFER">Bank Transfer</option>
                                  <option value="STORE_CREDIT">Store Credit</option>
                                  <option value="ONLINE">Online (Razorpay)</option>
                                </select>
                              </div>
                            </div>
                            <div style={{marginBottom:14}}>
                              <label style={{display:'block',fontSize:12,fontWeight:600,color:'#374151',marginBottom:4}}>Remarks (optional)</label>
                              <textarea rows={2} style={{width:'100%',padding:'9px 10px',border:'1.5px solid #e5e7eb',borderRadius:8,fontSize:13,resize:'vertical',boxSizing:'border-box'}}
                                placeholder="Additional notes about this return…"
                                value={returnFormMeta.remarks}
                                onChange={e => setReturnFormMeta(m => ({...m, remarks: e.target.value}))} />
                            </div>
                            {returnSubmitError && <div style={{padding:'10px',background:'#fef2f2',borderRadius:8,fontSize:13,color:'#dc2626',marginBottom:10}}>{returnSubmitError}</div>}
                            <div style={{display:'flex',gap:10,justifyContent:'flex-end'}}>
                              <button className="btn-secondary" onClick={() => setShowCreateReturn(false)}>Cancel</button>
                              <button className="btn-primary" onClick={submitDirectReturn} disabled={returnSubmitLoading}>
                                {returnSubmitLoading ? 'Saving…' : 'Create Return'}
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          );
        })()}

        {/* ── Damage Stock page ── */}
        {activePage === 'damage' && (() => {
          const DAMAGE_REASONS = [
            { value:'DAMAGED_IN_TRANSIT', label:'Damaged in Transit' },
            { value:'EXPIRED',            label:'Expired' },
            { value:'MANUFACTURING_DEFECT', label:'Manufacturing Defect' },
            { value:'WATER_DAMAGE',       label:'Water Damage' },
            { value:'BREAKAGE',           label:'Breakage' },
            { value:'OTHER',              label:'Other' },
          ];
          const ITEMS_PER_PAGE = 15;
          const dq = damageSearch.toLowerCase();
          const filtered = damages.filter(d =>
            !dq ||
            (d.damageNo || '').toLowerCase().includes(dq) ||
            (d.productName || '').toLowerCase().includes(dq) ||
            (d.sku || '').toLowerCase().includes(dq) ||
            (d.reason || '').toLowerCase().includes(dq)
          );
          const totalDamagePages = Math.max(1, Math.ceil(filtered.length / ITEMS_PER_PAGE));
          const pageDamages = filtered.slice((damagePage - 1) * ITEMS_PER_PAGE, damagePage * ITEMS_PER_PAGE);

          const lookupDamageProduct = async () => {
            if (!damageSku.trim()) return;
            setDamageSkuError(''); setDamageSkuLoading(true); setDamageProduct(null);
            try {
              const res = await axios.get(`${API}/damage/product-lookup?sku=${encodeURIComponent(damageSku.trim())}`);
              setDamageProduct(res.data);
            } catch (e) {
              setDamageSkuError(e.response?.data?.error || e.response?.data || 'Product not found');
            } finally { setDamageSkuLoading(false); }
          };

          const submitDamage = async () => {
            if (!damageProduct) { setDamageSubmitError('Look up a product first'); return; }
            const qty = parseInt(damageForm.qty, 10);
            if (!qty || qty <= 0) { setDamageSubmitError('Enter a valid damage quantity'); return; }
            if (qty > damageProduct.stockQty) { setDamageSubmitError(`Quantity ${qty} exceeds current stock of ${damageProduct.stockQty}`); return; }
            setDamageSubmitError(''); setDamageSubmitLoading(true);
            try {
              await axios.post(`${API}/damage`, {
                sku: damageProduct.sku || damageSku.trim(),
                damageQty: qty,
                reason: damageForm.reason,
                notes: damageForm.notes || null,
              });
              await loadDamages();
              setShowDamageForm(false);
              setDamageSku(''); setDamageProduct(null);
              setDamageForm({ qty: '', reason: 'OTHER', notes: '' });
              showToast('Damage entry recorded');
            } catch (e) {
              setDamageSubmitError(e.response?.data?.error || e.response?.data || 'Failed to record damage');
            } finally { setDamageSubmitLoading(false); }
          };

          return (
            <div className="page-content">
              {/* Header row */}
              <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:20,flexWrap:'wrap',gap:12}}>
                <div>
                  <div style={{fontSize:13,color:'#6b7280'}}>Record products removed from sellable inventory due to damage, expiry, or defects.</div>
                </div>
                <button className="btn-primary" onClick={() => { setShowDamageForm(v=>!v); setDamageSkuError(''); setDamageSubmitError(''); }}>
                  {showDamageForm ? '✕ Cancel' : '+ Record Damage'}
                </button>
              </div>

              {/* Entry form */}
              {showDamageForm && (
                <div style={{background:'#f9fafb',border:'1.5px solid #e5e7eb',borderRadius:12,padding:'20px 24px',marginBottom:24}}>
                  <h3 style={{margin:'0 0 16px',fontSize:16,color:'#1f2937'}}>New Damage Entry</h3>

                  {/* SKU lookup */}
                  <div style={{display:'flex',gap:10,alignItems:'flex-end',marginBottom:16}}>
                    <div style={{flex:1}}>
                      <label className="modal-label">SKU or Barcode</label>
                      <input placeholder="Enter SKU or scan barcode"
                        value={damageSku}
                        onChange={e => { setDamageSku(e.target.value); setDamageProduct(null); setDamageSkuError(''); }}
                        onKeyDown={e => e.key === 'Enter' && lookupDamageProduct()}
                        style={{marginTop:4}} />
                    </div>
                    <button className="btn-secondary" onClick={lookupDamageProduct} disabled={damageSkuLoading || !damageSku.trim()}
                      style={{whiteSpace:'nowrap'}}>
                      {damageSkuLoading ? 'Looking up…' : 'Look Up'}
                    </button>
                  </div>
                  {damageSkuError && <div style={{fontSize:13,color:'#dc2626',marginBottom:12}}>{damageSkuError}</div>}

                  {/* Product card */}
                  {damageProduct && (
                    <div style={{display:'flex',alignItems:'center',gap:14,background:'#fff',border:'1.5px solid #d1fae5',borderRadius:10,padding:'12px 16px',marginBottom:16}}>
                      {damageProduct.imageUrl && (
                        <img src={`${BACKEND}${damageProduct.imageUrl}`} alt=""
                          style={{width:56,height:56,objectFit:'cover',borderRadius:8,flexShrink:0,background:'#f3f4f6'}} />
                      )}
                      <div style={{flex:1,minWidth:0}}>
                        <div style={{fontWeight:700,fontSize:15,color:'#111827',marginBottom:2}}>{damageProduct.productName}</div>
                        <div style={{fontSize:12,color:'#6b7280',fontFamily:'monospace'}}>SKU: {damageProduct.sku} &nbsp;|&nbsp; Barcode: {damageProduct.barcode}</div>
                        {damageProduct.color && <div style={{fontSize:12,color:'#6b7280'}}>Colour: {damageProduct.color}</div>}
                        <div style={{fontSize:13,fontWeight:600,color:'#1d4ed8',marginTop:4}}>Stock: {damageProduct.stockQty}</div>
                      </div>
                    </div>
                  )}

                  {/* Form fields */}
                  {damageProduct && (
                    <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:14}}>
                      <div>
                        <label className="modal-label">Damage Quantity <span style={{color:'#dc2626'}}>*</span></label>
                        <input type="number" min="1" max={damageProduct.stockQty} placeholder="e.g. 2"
                          value={damageForm.qty}
                          onChange={e => setDamageForm(f => ({...f, qty: e.target.value}))}
                          style={{marginTop:4}} />
                      </div>
                      <div>
                        <label className="modal-label">Reason</label>
                        <select value={damageForm.reason}
                          onChange={e => setDamageForm(f => ({...f, reason: e.target.value}))}
                          style={{marginTop:4,width:'100%',padding:'8px 10px',border:'1.5px solid #e5e7eb',borderRadius:8,fontSize:13,background:'#fff',outline:'none'}}>
                          {DAMAGE_REASONS.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
                        </select>
                      </div>
                      <div style={{gridColumn:'1 / -1'}}>
                        <label className="modal-label">Notes <span style={{fontWeight:400,color:'#9ca3af'}}>(optional)</span></label>
                        <input placeholder="e.g. Fell off shelf during restocking"
                          value={damageForm.notes}
                          onChange={e => setDamageForm(f => ({...f, notes: e.target.value}))}
                          style={{marginTop:4}} />
                      </div>
                    </div>
                  )}

                  {damageSubmitError && <div style={{fontSize:13,color:'#dc2626',marginTop:12}}>{damageSubmitError}</div>}

                  {damageProduct && (
                    <div style={{marginTop:16,display:'flex',gap:10,justifyContent:'flex-end'}}>
                      <button className="btn-secondary" onClick={() => { setShowDamageForm(false); setDamageSku(''); setDamageProduct(null); setDamageForm({ qty:'', reason:'OTHER', notes:'' }); }}>
                        Cancel
                      </button>
                      <button className="btn-primary" onClick={submitDamage} disabled={damageSubmitLoading}>
                        {damageSubmitLoading ? 'Recording…' : '✓ Confirm Damage'}
                      </button>
                    </div>
                  )}
                </div>
              )}

              {/* Search */}
              <div style={{marginBottom:16}}>
                <input placeholder="Search by damage no, product, SKU or reason…"
                  value={damageSearch}
                  onChange={e => { setDamageSearch(e.target.value); setDamagePage(1); }}
                  style={{width:'100%',padding:'9px 14px',border:'1.5px solid #e5e7eb',borderRadius:9,fontSize:13,outline:'none',boxSizing:'border-box'}} />
              </div>

              {/* Error */}
              {damageError && (
                <div style={{padding:'12px 16px',background:'#fef2f2',borderRadius:8,color:'#dc2626',fontSize:13,marginBottom:16,display:'flex',alignItems:'center',justifyContent:'space-between'}}>
                  {damageError}
                  <button className="btn-secondary" style={{fontSize:12,padding:'4px 12px'}} onClick={loadDamages}>Retry</button>
                </div>
              )}

              {/* History table */}
              <div className="table-scroll-wrap">
                <table className="admin-table">
                  <thead>
                    <tr>
                      <th>Damage No</th>
                      <th>Product</th>
                      <th>SKU</th>
                      <th style={{textAlign:'right'}}>Qty</th>
                      <th style={{textAlign:'right'}}>Before</th>
                      <th style={{textAlign:'right'}}>After</th>
                      <th>Reason</th>
                      <th>Notes</th>
                      <th>Date</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pageDamages.length === 0 ? (
                      <tr><td colSpan={9} style={{textAlign:'center',padding:'32px',color:'#9ca3af'}}>
                        {damages.length === 0 ? 'No damage entries yet. Use "Record Damage" to log damaged stock.' : 'No entries match your search.'}
                      </td></tr>
                    ) : pageDamages.map(d => (
                      <tr key={d.id}>
                        <td style={{fontFamily:'monospace',fontWeight:600,color:'#1d4ed8'}}>{d.damageNo}</td>
                        <td style={{fontWeight:600}}>{d.productName}</td>
                        <td style={{fontFamily:'monospace',fontSize:12,color:'#6b7280'}}>{d.sku}</td>
                        <td style={{textAlign:'right',fontWeight:700,color:'#dc2626'}}>{d.damageQty}</td>
                        <td style={{textAlign:'right',color:'#6b7280'}}>{d.stockBefore ?? '—'}</td>
                        <td style={{textAlign:'right',color:'#374151'}}>{d.stockAfter ?? '—'}</td>
                        <td>
                          <span style={{display:'inline-block',padding:'2px 8px',borderRadius:12,fontSize:11,fontWeight:600,
                            background: d.reason === 'EXPIRED' ? '#fef9c3' : d.reason === 'BREAKAGE' ? '#fee2e2' : '#f3f4f6',
                            color: d.reason === 'EXPIRED' ? '#92400e' : d.reason === 'BREAKAGE' ? '#991b1b' : '#374151'}}>
                            {(DAMAGE_REASONS.find(r => r.value === d.reason)?.label) || d.reason || '—'}
                          </span>
                        </td>
                        <td style={{color:'#6b7280',fontSize:12,maxWidth:180,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{d.notes || '—'}</td>
                        <td style={{fontSize:12,color:'#9ca3af',whiteSpace:'nowrap'}}>
                          {d.createdAt ? new Date(d.createdAt).toLocaleDateString('en-IN', {day:'2-digit',month:'short',year:'numeric'}) : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Pagination */}
              {totalDamagePages > 1 && (
                <div style={{display:'flex',justifyContent:'center',gap:6,marginTop:16}}>
                  <button className="btn-secondary" disabled={damagePage === 1} onClick={() => setDamagePage(p => p - 1)}>‹ Prev</button>
                  <span style={{padding:'6px 12px',fontSize:13,color:'#374151'}}>Page {damagePage} of {totalDamagePages}</span>
                  <button className="btn-secondary" disabled={damagePage === totalDamagePages} onClick={() => setDamagePage(p => p + 1)}>Next ›</button>
                </div>
              )}
            </div>
          );
        })()}

        {/* ── Expenses page ── */}
        {activePage === 'expenses' && (() => {
          const EXPENSE_CAT_LABELS = {
            DAILY_EXPENSE:'Daily Expense', RENT:'Rent', ELECTRICITY:'Electricity',
            WATER_BILL:'Water Bill', SALARY:'Salary', TRANSPORT:'Transport', OTHER_EXPENSE:'Other Expense',
          };
          const EXPENSE_CAT_COLORS = {
            DAILY_EXPENSE:'#7C3AED', RENT:'#2563EB', ELECTRICITY:'#D97706',
            WATER_BILL:'#0891B2', SALARY:'#059669', TRANSPORT:'#F97316', OTHER_EXPENSE:'#6B7280',
          };
          const ITEMS_PER_PAGE = 15;

          const lq = expenseSearch.toLowerCase();
          const filtered = expenses.filter(ex => {
            if (expenseCategoryFilter && ex.category !== expenseCategoryFilter) return false;
            if (expensePaymentFilter && ex.paymentMethod !== expensePaymentFilter) return false;
            if (expenseDateFilter && ex.expenseDate !== expenseDateFilter) return false;
            if (lq && !(
              (ex.description || '').toLowerCase().includes(lq) ||
              (EXPENSE_CAT_LABELS[ex.category] || '').toLowerCase().includes(lq) ||
              (ex.referenceNumber || '').toLowerCase().includes(lq)
            )) return false;
            return true;
          });

          const totalExpPages = Math.max(1, Math.ceil(filtered.length / ITEMS_PER_PAGE));
          const pageExps = filtered.slice((expensePage - 1) * ITEMS_PER_PAGE, expensePage * ITEMS_PER_PAGE);

          return (
            <div className="page-content">
              {/* Header */}
              <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:20,flexWrap:'wrap',gap:12}}>
                <div style={{fontSize:13,color:'#6b7280'}}>Manage your daily, recurring, and one-time business expenses.</div>
                <button className="btn-primary" onClick={() => {
                  if (showExpenseForm && !expenseEditId) {
                    setShowExpenseForm(false);
                  } else {
                    setExpenseForm(EXPENSE_FORM_EMPTY); setExpenseEditId(null); setExpenseFormError(''); setShowExpenseForm(true);
                  }
                }}>
                  {showExpenseForm && !expenseEditId ? '✕ Cancel' : '+ Add Expense'}
                </button>
              </div>

              {/* Summary cards */}
              {expenseSummary && (
                <div style={{display:'flex',gap:12,flexWrap:'wrap',marginBottom:20}}>
                  {[
                    { label:'Today',       value: expenseSummary.totalToday,    color:'#dc2626' },
                    { label:'This Week',   value: expenseSummary.totalWeek,     color:'#d97706' },
                    { label:'This Month',  value: expenseSummary.totalMonth,    color:'#7c3aed' },
                    { label:'This Period', value: expenseSummary.totalForRange, color:'#0891b2' },
                  ].map(c => (
                    <div key={c.label} className="rpt-card" style={{flex:'1 1 130px',minWidth:0,borderTop:`3px solid ${c.color}`}}>
                      <div className="rpt-card-label">{c.label}</div>
                      <div className="rpt-card-value" style={{color:c.color}}>
                        {'₹' + Number(c.value || 0).toLocaleString('en-IN',{minimumFractionDigits:2,maximumFractionDigits:2})}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* Add / Edit form */}
              {(showExpenseForm || expenseEditId) && (
                <div style={{background:'#f9fafb',border:'1.5px solid #e5e7eb',borderRadius:12,padding:'20px 24px',marginBottom:24}}>
                  <h3 style={{margin:'0 0 16px',fontSize:16,color:'#1f2937'}}>
                    {expenseEditId ? 'Edit Expense' : 'New Expense'}
                  </h3>
                  <form onSubmit={saveExpense}>
                    <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill, minmax(200px, 1fr))',gap:14}}>
                      <div>
                        <label className="modal-label">Category <span style={{color:'#dc2626'}}>*</span></label>
                        <select value={expenseForm.category}
                          onChange={e => setExpenseForm(f => ({...f, category: e.target.value}))}
                          style={{marginTop:4,width:'100%',padding:'8px 10px',border:'1.5px solid #e5e7eb',borderRadius:8,fontSize:13,background:'#fff',outline:'none'}}>
                          <option value="">Select category…</option>
                          {EXPENSE_CATEGORIES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
                        </select>
                      </div>
                      <div>
                        <label className="modal-label">Amount (₹) <span style={{color:'#dc2626'}}>*</span></label>
                        <input type="number" min="0.01" step="0.01" placeholder="e.g. 1500.00"
                          value={expenseForm.amount}
                          onChange={e => setExpenseForm(f => ({...f, amount: e.target.value}))}
                          style={{marginTop:4}} />
                      </div>
                      <div>
                        <label className="modal-label">Payment Date <span style={{color:'#dc2626'}}>*</span></label>
                        <input type="date"
                          value={expenseForm.expenseDate}
                          onChange={e => setExpenseForm(f => ({...f, expenseDate: e.target.value}))}
                          style={{marginTop:4}} />
                      </div>
                      <div>
                        <label className="modal-label">Payment Method</label>
                        <select value={expenseForm.paymentMethod}
                          onChange={e => setExpenseForm(f => ({...f, paymentMethod: e.target.value}))}
                          style={{marginTop:4,width:'100%',padding:'8px 10px',border:'1.5px solid #e5e7eb',borderRadius:8,fontSize:13,background:'#fff',outline:'none'}}>
                          {EXPENSE_PAYMENT_METHODS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
                        </select>
                      </div>
                      <div style={{gridColumn:'1 / -1'}}>
                        <label className="modal-label">Description <span style={{fontWeight:400,color:'#9ca3af'}}>(optional)</span></label>
                        <input placeholder="e.g. Monthly shop rent for October"
                          value={expenseForm.description}
                          onChange={e => setExpenseForm(f => ({...f, description: e.target.value}))}
                          style={{marginTop:4}} />
                      </div>
                      <div>
                        <label className="modal-label">Reference No. <span style={{fontWeight:400,color:'#9ca3af'}}>(optional)</span></label>
                        <input placeholder="e.g. REC-001"
                          value={expenseForm.referenceNumber}
                          onChange={e => setExpenseForm(f => ({...f, referenceNumber: e.target.value}))}
                          style={{marginTop:4}} />
                      </div>
                    </div>
                    {expenseFormError && <div style={{fontSize:13,color:'#dc2626',marginTop:12}}>{expenseFormError}</div>}
                    <div style={{marginTop:16,display:'flex',gap:10,justifyContent:'flex-end'}}>
                      <button type="button" className="btn-secondary" onClick={() => {
                        setShowExpenseForm(false); setExpenseForm(EXPENSE_FORM_EMPTY); setExpenseEditId(null); setExpenseFormError('');
                      }}>
                        Cancel
                      </button>
                      <button type="submit" className="btn-primary" disabled={expenseFormLoading}>
                        {expenseFormLoading ? 'Saving…' : (expenseEditId ? '✓ Update Expense' : '✓ Save Expense')}
                      </button>
                    </div>
                  </form>
                </div>
              )}

              {/* Filters */}
              <div style={{display:'flex',gap:10,marginBottom:16,flexWrap:'wrap',alignItems:'center'}}>
                <input placeholder="Search description, category, reference…"
                  value={expenseSearch}
                  onChange={e => { setExpenseSearch(e.target.value); setExpensePage(1); }}
                  style={{flex:'1 1 200px',padding:'8px 12px',border:'1.5px solid #e5e7eb',borderRadius:8,fontSize:13,outline:'none'}} />
                <select value={expenseCategoryFilter}
                  onChange={e => { setExpenseCategoryFilter(e.target.value); setExpensePage(1); }}
                  style={{padding:'8px 10px',border:'1.5px solid #e5e7eb',borderRadius:8,fontSize:13,background:'#fff',outline:'none',flexShrink:0}}>
                  <option value="">All Categories</option>
                  {EXPENSE_CATEGORIES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
                </select>
                <select value={expensePaymentFilter}
                  onChange={e => { setExpensePaymentFilter(e.target.value); setExpensePage(1); }}
                  style={{padding:'8px 10px',border:'1.5px solid #e5e7eb',borderRadius:8,fontSize:13,background:'#fff',outline:'none',flexShrink:0}}>
                  <option value="">All Payment Methods</option>
                  {EXPENSE_PAYMENT_METHODS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
                </select>
                <input type="date" value={expenseDateFilter}
                  onChange={e => { setExpenseDateFilter(e.target.value); setExpensePage(1); }}
                  title="Filter by payment date"
                  style={{padding:'8px 10px',border:'1.5px solid #e5e7eb',borderRadius:8,fontSize:13,outline:'none',flexShrink:0}} />
                {expenseDateFilter && (
                  <button className="btn-secondary" style={{fontSize:12,padding:'6px 12px',flexShrink:0}}
                    onClick={() => { setExpenseDateFilter(''); setExpensePage(1); }}>
                    Clear
                  </button>
                )}
              </div>

              {/* Error */}
              {expenseError && (
                <div style={{padding:'12px 16px',background:'#fef2f2',borderRadius:8,color:'#dc2626',fontSize:13,marginBottom:16,display:'flex',alignItems:'center',justifyContent:'space-between'}}>
                  {expenseError}
                  <button className="btn-secondary" style={{fontSize:12,padding:'4px 12px'}} onClick={loadExpenses}>Retry</button>
                </div>
              )}

              {/* Loading */}
              {expenseLoading && (
                <div style={{textAlign:'center',padding:'32px',color:'#6b7280',fontSize:14}}>Loading expenses…</div>
              )}

              {/* Table */}
              {!expenseLoading && (
                <div className="table-scroll-wrap">
                  <table className="admin-table">
                    <thead>
                      <tr>
                        <th>Date</th>
                        <th>Category</th>
                        <th>Description</th>
                        <th>Payment</th>
                        <th>Reference</th>
                        <th style={{textAlign:'right'}}>Amount (₹)</th>
                        <th style={{textAlign:'center'}}>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {pageExps.length === 0 ? (
                        <tr><td colSpan={7} style={{textAlign:'center',padding:'32px',color:'#9ca3af'}}>
                          {expenses.length === 0
                            ? 'No expenses yet. Click "+ Add Expense" to record your first expense.'
                            : 'No expenses match the current filters.'}
                        </td></tr>
                      ) : pageExps.map(ex => (
                        <tr key={ex.id}>
                          <td style={{whiteSpace:'nowrap',color:'#374151'}}>
                            {ex.expenseDate
                              ? new Date(ex.expenseDate + 'T00:00:00').toLocaleDateString('en-IN',{day:'2-digit',month:'short',year:'numeric'})
                              : '—'}
                          </td>
                          <td>
                            <span style={{display:'inline-block',padding:'2px 10px',borderRadius:12,fontSize:11,fontWeight:700,
                              background:(EXPENSE_CAT_COLORS[ex.category]||'#6B7280')+'18',
                              color:EXPENSE_CAT_COLORS[ex.category]||'#6B7280',
                              border:'1px solid '+(EXPENSE_CAT_COLORS[ex.category]||'#6B7280')+'44'}}>
                              {EXPENSE_CAT_LABELS[ex.category] || ex.category}
                            </span>
                          </td>
                          <td style={{color:'#4b5563',maxWidth:200,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>
                            {ex.description || '—'}
                          </td>
                          <td style={{color:'#6b7280',fontSize:12}}>{ex.paymentMethod || 'CASH'}</td>
                          <td style={{color:'#9ca3af',fontSize:12,fontFamily:'monospace'}}>{ex.referenceNumber || '—'}</td>
                          <td style={{textAlign:'right',fontWeight:700,color:'#dc2626',whiteSpace:'nowrap'}}>
                            {'₹' + Number(ex.amount).toLocaleString('en-IN',{minimumFractionDigits:2,maximumFractionDigits:2})}
                          </td>
                          <td style={{textAlign:'center',whiteSpace:'nowrap'}}>
                            <button className="btn-secondary" style={{fontSize:11,padding:'3px 10px',marginRight:4}}
                              onClick={() => {
                                setExpenseEditId(ex.id);
                                setExpenseForm({
                                  category: ex.category,
                                  amount: String(ex.amount),
                                  expenseDate: ex.expenseDate,
                                  description: ex.description || '',
                                  paymentMethod: ex.paymentMethod || 'CASH',
                                  referenceNumber: ex.referenceNumber || '',
                                });
                                setShowExpenseForm(true);
                                setExpenseFormError('');
                                window.scrollTo({top:0,behavior:'smooth'});
                              }}>
                              Edit
                            </button>
                            <button style={{fontSize:11,padding:'3px 10px',background:'#fef2f2',color:'#dc2626',border:'1.5px solid #fecaca',borderRadius:6,cursor:'pointer',fontWeight:600}}
                              onClick={() => deleteExpense(ex.id, ex.category)}>
                              Delete
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    {pageExps.length > 0 && (
                      <tfoot>
                        <tr style={{background:'#f9fafb',fontWeight:700}}>
                          <td colSpan={5} style={{textAlign:'right',padding:'10px 16px',color:'#374151',fontSize:13}}>
                            {filtered.length < expenses.length
                              ? `Filtered Total (${filtered.length} entries):`
                              : `Total (${expenses.length} entries):`}
                          </td>
                          <td style={{textAlign:'right',padding:'10px 16px',color:'#dc2626',fontWeight:800}}>
                            {'₹' + filtered.reduce((s,ex) => s + parseFloat(ex.amount||0), 0)
                              .toLocaleString('en-IN',{minimumFractionDigits:2,maximumFractionDigits:2})}
                          </td>
                          <td />
                        </tr>
                      </tfoot>
                    )}
                  </table>
                </div>
              )}

              {/* Pagination */}
              {totalExpPages > 1 && (
                <div style={{display:'flex',justifyContent:'center',gap:6,marginTop:16}}>
                  <button className="btn-secondary" disabled={expensePage === 1} onClick={() => setExpensePage(p => p - 1)}>‹ Prev</button>
                  <span style={{padding:'6px 12px',fontSize:13,color:'#374151'}}>Page {expensePage} of {totalExpPages}</span>
                  <button className="btn-secondary" disabled={expensePage === totalExpPages} onClick={() => setExpensePage(p => p + 1)}>Next ›</button>
                </div>
              )}
            </div>
          );
        })()}

      </div>{/* end main-area */}

      {/* ── Shop Settings Modal ── */}
      {shopEditModal && (() => {
        const bannerSrc = tenantInfo?.bannerUrl ? `${BACKEND}${tenantInfo.bannerUrl}` : null;
        const closeModal = () => { setShopEditModal(null); setShopLogoFile(null); setShopLogoPreview(null); setShopBannerFile(null); setShopBannerPreview(null); };
        return (
        <div className="modal-overlay" onClick={closeModal}>
          <div className="modal-box shop-settings-box" style={{width:820, maxWidth:'94vw'}} onClick={e => e.stopPropagation()}>
            <h3>Shop Settings</h3>

            <div className="shop-settings-grid">
              {/* Logo upload */}
              <div>
                <label className="modal-label">Shop Logo</label>
                <div style={{display:'flex',alignItems:'center',gap:14,margin:'8px 0'}}>
                  <img src={shopLogoPreview || logoSrc} alt="logo"
                    style={{width:64,height:64,objectFit:'contain',borderRadius:10,border:'1.5px solid #e5e7eb',background:'#f9fafb',flexShrink:0}} />
                  <div>
                    <label style={{display:'inline-block',padding:'7px 14px',background:'#1E3A5F',color:'#fff',borderRadius:7,cursor:'pointer',fontSize:13,fontWeight:600}}>
                      📁 Choose Image
                      <input type="file" accept="image/*" style={{display:'none'}} onChange={e => {
                        const f = e.target.files?.[0];
                        if (!f) return;
                        setShopLogoFile(f);
                        setShopLogoPreview(URL.createObjectURL(f));
                      }} />
                    </label>
                    <div style={{fontSize:11.5,color:'#9ca3af',marginTop:5}}>PNG, JPG, SVG</div>
                  </div>
                </div>
              </div>

              {/* Banner upload */}
              <div>
                <label className="modal-label">Store Banner</label>
                <div style={{margin:'8px 0'}}>
                  {(shopBannerPreview || bannerSrc) ? (
                    <div style={{marginBottom:8,borderRadius:8,overflow:'hidden',border:'1.5px solid #e5e7eb',height:64,position:'relative'}}>
                      <img src={shopBannerPreview || bannerSrc} alt="banner"
                        style={{width:'100%',height:'100%',objectFit:'cover'}} />
                      {shopBannerPreview && <span style={{position:'absolute',top:4,right:6,background:'#16a34a',color:'#fff',fontSize:9,padding:'2px 6px',borderRadius:99,fontWeight:700}}>NEW</span>}
                    </div>
                  ) : (
                    <div style={{marginBottom:8,height:64,border:'2px dashed #d1d5db',borderRadius:8,display:'flex',alignItems:'center',justifyContent:'center',color:'#9ca3af',fontSize:11.5}}>
                      No banner set
                    </div>
                  )}
                  <label style={{display:'inline-block',padding:'7px 14px',background:'#1E3A5F',color:'#fff',borderRadius:7,cursor:'pointer',fontSize:13,fontWeight:600}}>
                    🖼️ {bannerSrc ? 'Change Banner' : 'Upload Banner'}
                    <input type="file" accept="image/*" style={{display:'none'}} onChange={e => {
                      const f = e.target.files?.[0];
                      if (!f) return;
                      setShopBannerFile(f);
                      setShopBannerPreview(URL.createObjectURL(f));
                    }} />
                  </label>
                </div>
              </div>

              {/* Shop name */}
              <div>
                <label className="modal-label">Shop Name</label>
                <input value={shopEditModal.name} onChange={e => setShopEditModal(m => ({...m, name: e.target.value}))}
                  placeholder="Enter your shop name" autoFocus style={{marginTop:4}} />
              </div>

              <div>
                <label className="modal-label">WhatsApp / Contact Number <span style={{fontWeight:400,color:'#9ca3af'}}>(shown on storefront)</span></label>
                <input type="tel" inputMode="numeric" maxLength={10} placeholder="10-digit mobile number"
                  value={shopEditModal.phoneNumber || ''}
                  onChange={e => setShopEditModal(m => ({...m, phoneNumber: e.target.value.replace(/\D/g,'').slice(0,10)}))}
                  style={{marginTop:4}} />
              </div>
            </div>

            {/* Shop address — full width */}
            <label className="modal-label" style={{marginTop:14}}>Shop Address <span style={{fontWeight:400,color:'#9ca3af'}}>(used on shipping labels)</span></label>
            <textarea value={shopEditModal.address || ''} onChange={e => setShopEditModal(m => ({...m, address: e.target.value}))}
              rows={3} placeholder={'e.g.\n12 MG Road, Indiranagar\nBengaluru, Karnataka - 560038\nPhone: 9876543210'}
              style={{marginTop:4,width:'100%',padding:'8px 10px',border:'1.5px solid #e5e7eb',borderRadius:8,fontSize:13,fontFamily:'inherit',resize:'vertical',boxSizing:'border-box',outline:'none'}}
              onFocus={e=>e.target.style.borderColor='#1E3A5F'} onBlur={e=>e.target.style.borderColor='#e5e7eb'} />

            {/* Bank details */}
            <label className="modal-label" style={{marginTop:16}}>Bank Details <span style={{fontWeight:400,color:'#9ca3af'}}>(for payouts)</span></label>
            <div className="shop-settings-grid" style={{marginTop:6}}>
              <input value={shopEditModal.bankAccountNumber || ''} onChange={e => setShopEditModal(m => ({...m, bankAccountNumber: e.target.value}))}
                placeholder="Account Number" />
              <input value={shopEditModal.confirmBankAccountNumber || ''} onChange={e => setShopEditModal(m => ({...m, confirmBankAccountNumber: e.target.value}))}
                placeholder="Confirm Account Number" />
              <input value={shopEditModal.bankAccountHolderName || ''} onChange={e => setShopEditModal(m => ({...m, bankAccountHolderName: e.target.value}))}
                placeholder="Account Holder Name" />
              <input value={shopEditModal.bankIfscCode || ''} onChange={e => setShopEditModal(m => ({...m, bankIfscCode: e.target.value.toUpperCase()}))}
                placeholder="IFSC Code" />
              <input value={shopEditModal.bankBranchName || ''} onChange={e => setShopEditModal(m => ({...m, bankBranchName: e.target.value}))}
                placeholder="Branch Name" />
            </div>

            {/* Razorpay — customer payments settle straight to the shop's own account, not ours */}
            <label className="modal-label" style={{marginTop:16,display:'flex',alignItems:'center',gap:6}}>
              Razorpay Payments <span style={{fontWeight:400,color:'#9ca3af'}}>(so your customers' payments go to you)</span>
              <button type="button" onClick={() => setRzpHelpOpen(v => !v)} title="How do I connect Razorpay?"
                style={{width:18,height:18,minWidth:18,padding:0,margin:0,borderRadius:'50%',border:'1.5px solid #1E3A5F',background: rzpHelpOpen ? '#1E3A5F' : '#fff',color: rzpHelpOpen ? '#fff' : '#1E3A5F',fontSize:11,fontWeight:700,lineHeight:1,cursor:'pointer',display:'inline-flex',alignItems:'center',justifyContent:'center'}}>
                i
              </button>
            </label>

            {rzpHelpOpen && (
              <div className="rzp-help-box">
                <strong>Steps to connect your Razorpay account:</strong>
                <ol>
                  <li>Go to <strong>razorpay.com</strong> and sign up (or log in) for your own Razorpay business account — separate from this shop platform.</li>
                  <li>Complete Razorpay's KYC / business verification. This is required before they'll activate live payments to your bank account.</li>
                  <li>Add your bank account details inside Razorpay so they know where to send your sales money.</li>
                  <li>In the Razorpay Dashboard, go to <strong>Settings → API Keys</strong>.</li>
                  <li>Click <strong>Generate Live Key</strong> (use "Test Key" only if you're just trying things out). Razorpay shows a <strong>Key ID</strong> and a <strong>Key Secret</strong> — copy both immediately, the Secret is shown only once.</li>
                  <li>Paste the Key ID and Key Secret into the two boxes below, then click <strong>Save</strong>.</li>
                </ol>
                <p>Once connected, every payment your customers make on your shop goes directly into your own Razorpay account and settles to your bank — it never passes through or is visible to us.</p>
              </div>
            )}

            <div style={{fontSize:12,fontWeight:600,margin:'2px 0 8px',color: tenantInfo?.razorpayMerchantConnected ? '#1e7e34' : '#e65100'}}>
              {tenantInfo?.razorpayMerchantConnected ? '✅ Connected — payments settle to your account' : '⚠ Not connected — customers can\'t check out yet'}
            </div>
            <div className="shop-settings-grid">
              <input value={shopEditModal.razorpayMerchantKeyId || ''} onChange={e => setShopEditModal(m => ({...m, razorpayMerchantKeyId: e.target.value}))}
                placeholder="Razorpay Key ID (rzp_live_...)" />
              <input type="password" value={shopEditModal.razorpayMerchantKeySecret || ''} onChange={e => setShopEditModal(m => ({...m, razorpayMerchantKeySecret: e.target.value}))}
                placeholder={tenantInfo?.razorpayMerchantConnected ? 'Key Secret (leave blank to keep current)' : 'Razorpay Key Secret'} />
            </div>
            <p style={{fontSize:11.5,color:'#9ca3af',margin:'6px 0 0'}}>
              Get these from your own Razorpay Dashboard → Settings → API Keys. We never see or store your sales money — it goes straight to your Razorpay account.
            </p>

            {/* GST Settings */}
            <label className="modal-label" style={{marginTop:16}}>GST Settings</label>
            <div style={{background:'#f8faff',border:'1.5px solid #dbeafe',borderRadius:8,padding:'12px 14px',marginTop:4,display:'flex',flexDirection:'column',gap:10}}>
              <label style={{display:'flex',alignItems:'center',gap:8,cursor:'pointer',fontSize:13,fontWeight:600,color:'#1E3A5F'}}>
                <input type="checkbox" checked={shopEditModal.gstRegistered || false}
                  onChange={e => setShopEditModal(m => ({...m, gstRegistered: e.target.checked}))} />
                GST Registered Business
              </label>
              {shopEditModal.gstRegistered && (
                <>
                  <div>
                    <label className="modal-label">GSTIN</label>
                    <input value={shopEditModal.gstin || ''} onChange={e => setShopEditModal(m => ({...m, gstin: e.target.value.toUpperCase()}))}
                      placeholder="e.g. 29ABCDE1234F1Z5" maxLength={15} style={{marginTop:4,fontFamily:'monospace',letterSpacing:1}} />
                  </div>
                  <div>
                    <label className="modal-label">Supply Type</label>
                    <select value={shopEditModal.supplyType || 'INTRA'} onChange={e => setShopEditModal(m => ({...m, supplyType: e.target.value}))}
                      style={{marginTop:4,padding:'8px 10px',border:'1.5px solid #e5e7eb',borderRadius:8,fontSize:13,background:'#fff',outline:'none',width:'100%'}}>
                      <option value="INTRA">Intra-State (CGST + SGST)</option>
                      <option value="INTER">Inter-State (IGST)</option>
                    </select>
                  </div>
                </>
              )}
            </div>
            <p style={{fontSize:11.5,color:'#9ca3af',margin:'4px 0 0'}}>
              When enabled, GST will be computed on every POS bill and shown on receipts. Set the applicable rate per product in the Products page.
            </p>

            <div style={{display:'flex',gap:10,marginTop:18}}>
              <button className="btn-primary" onClick={saveShopSettings} disabled={shopEditSaving} style={{flex:1}}>
                {shopEditSaving ? 'Saving…' : 'Save'}
              </button>
              <button className="btn-secondary" onClick={closeModal} style={{flex:1}}>Cancel</button>
            </div>
          </div>
        </div>
        );
      })()}

      {/* ── Edit Product Modal ── */}
      {editModal && (() => {
        const editCatDef = tenantCategories.find(c => c.name === editModal.category);
        const editAttrs = editCatDef?.attributes || [];
        return (
        <div className="modal-overlay" onClick={() => setEditModal(null)}>
          <div className="modal-box edit-modal-box" onClick={e => e.stopPropagation()}>
            <h3>Edit Product</h3>

            {tenantInfo?.subdomain === 'gosuas' && (
              <>
                <label className="modal-label">Product Type</label>
                <select value={editModal.productType || 'OTHER'}
                  onChange={e => setEditModal(m => ({...m, productType: e.target.value}))}
                  style={{marginBottom:10}}>
                  <option value="OTHER">Other (Sell)</option>
                  <option value="RENTAL">Rental</option>
                </select>
              </>
            )}

            <label className="modal-label">Product Name</label>
            <input value={editModal.name} onChange={e => setEditModal(m => ({...m, name: e.target.value}))} />

            <label className="modal-label" style={{marginTop:'10px'}}>Category</label>
            <select value={editModal.category}
              onChange={e => setEditModal(m => ({...m, category: e.target.value, editAttrValues: {}}))}>
              <option value="">No Category</option>
              {tenantCategories.map(c => <option key={c.name} value={c.name}>{c.name}</option>)}
            </select>

            <label className="modal-label" style={{marginTop:'10px'}}>SKU</label>
            <input value={editModal.sku} onChange={e => setEditModal(m => ({...m, sku: e.target.value}))} placeholder="SKU" />

            <label className="modal-label" style={{marginTop:'10px'}}>Barcode <span style={{fontWeight:400,color:'#9ca3af'}}>(used for scanning &amp; printed labels)</span></label>
            <input value={editModal.barcode || ''} onChange={e => setEditModal(m => ({...m, barcode: e.target.value}))} placeholder="Barcode" />

            <div className="edit-prices-row" style={{marginTop:'10px'}}>
              <div>
                <label className="modal-label">Purchase Price ₹</label>
                <input type="number" min="0" value={editModal.purchasePrice} onChange={e => setEditModal(m => ({...m, purchasePrice: e.target.value}))} />
              </div>
              {editModal.productType === 'RENTAL' ? (
                <>
                  <div>
                    <label className="modal-label">Deposit Amount ₹</label>
                    <input type="number" min="0" value={editModal.depositAmount} onChange={e => setEditModal(m => ({...m, depositAmount: e.target.value}))} />
                  </div>
                  <div>
                    <label className="modal-label">Rental Amount ₹</label>
                    <input type="number" min="0" value={editModal.rentAmount} onChange={e => setEditModal(m => ({...m, rentAmount: e.target.value}))} />
                  </div>
                </>
              ) : (
                <>
                  <div>
                    <label className="modal-label">Selling Price ₹</label>
                    <input type="number" min="0" value={editModal.sellingPrice} onChange={e => setEditModal(m => ({...m, sellingPrice: e.target.value}))} />
                  </div>
                  <div>
                    <label className="modal-label">MRP ₹</label>
                    <input type="number" min="0" value={editModal.mrp} onChange={e => setEditModal(m => ({...m, mrp: e.target.value}))} />
                  </div>
                </>
              )}
            </div>

            {tenantInfo?.gstRegistered && (
              <div style={{display:'flex',gap:8,marginTop:10}}>
                <div style={{flex:2}}>
                  <label className="modal-label">HSN / SAC Code</label>
                  <input value={editModal.hsnCode || ''} onChange={e => setEditModal(m => ({...m, hsnCode: e.target.value}))} placeholder="HSN / SAC Code (optional)" />
                </div>
                <div style={{flex:1}}>
                  <label className="modal-label">GST Rate</label>
                  <select value={editModal.gstRate ?? ''} onChange={e => setEditModal(m => ({...m, gstRate: e.target.value}))} style={{padding:'8px 10px',border:'1.5px solid #e5e7eb',borderRadius:8,fontSize:14,background:'#fff',outline:'none',width:'100%'}}>
                    <option value="">None</option>
                    <option value="0">0% (Exempt)</option>
                    <option value="5">5%</option>
                    <option value="12">12%</option>
                    <option value="18">18%</option>
                    <option value="28">28%</option>
                  </select>
                </div>
              </div>
            )}

            <div className="edit-restock-banner" style={{marginTop:'10px'}}>
              <span className="edit-restock-label">Stock Quantity</span>
              <div className="edit-restock-controls">
                <button type="button" className="qty-btn" onClick={() => setEditModal(m => ({...m, stockQty: Math.max(0, Number(m.stockQty) - 1)}))}>−</button>
                <input type="number" min="0" className="edit-stock-input" value={editModal.stockQty}
                  onChange={e => setEditModal(m => ({...m, stockQty: e.target.value}))} />
                <button type="button" className="qty-btn" onClick={() => setEditModal(m => ({...m, stockQty: Number(m.stockQty) + 1}))}>+</button>
              </div>
            </div>

            {/* Variant attributes — single-select per attribute */}
            {editAttrs.length > 0 && (
              <div style={{marginTop:'12px',display:'flex',flexDirection:'column',gap:10}}>
                {editAttrs.map(attr => (
                  <div key={attr.name}>
                    <label className="modal-label">{attr.name}</label>
                    <div style={{display:'flex',flexWrap:'wrap',gap:6,marginTop:4}}>
                      <span onClick={() => setEditModal(m => {const v={...m.editAttrValues}; delete v[attr.name]; return {...m,editAttrValues:v};})}
                        style={{padding:'4px 12px',borderRadius:20,border:'1.5px solid '+(!(editModal.editAttrValues||{})[attr.name]?'#1E3A5F':'#ddd'),
                          background:!(editModal.editAttrValues||{})[attr.name]?'#1E3A5F':'#f5f5f5',
                          color:!(editModal.editAttrValues||{})[attr.name]?'#fff':'#555',cursor:'pointer',fontSize:13}}>
                        None
                      </span>
                      {attr.options.map(opt => (
                        <span key={opt} onClick={() => setEditModal(m => ({...m, editAttrValues:{...m.editAttrValues,[attr.name]:opt}}))}
                          style={{padding:'4px 12px',borderRadius:20,border:'1.5px solid '+((editModal.editAttrValues||{})[attr.name]===opt?'#1E3A5F':'#ddd'),
                            background:(editModal.editAttrValues||{})[attr.name]===opt?'#1E3A5F':'#f5f5f5',
                            color:(editModal.editAttrValues||{})[attr.name]===opt?'#fff':'#333',cursor:'pointer',fontSize:13}}>
                          {opt}
                        </span>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Fallback picker if no category attributes defined — same variant builder Add Product uses */}
            {editAttrs.length === 0 && (
              <div className="variants-section" style={{marginTop:'10px'}}>
                <div className="modal-label">Variants <span style={{fontWeight:400,color:'#9ca3af',textTransform:'none',letterSpacing:0}}>(optional — Colour, Size, or add your own)</span></div>

                {editModal.showColourPicker && (
                  <div className="variant-block">
                    <ChipGroup label="Colour" options={COLOR_PRESETS} selected={editModal.colours}
                      onToggle={toggleEditColour}
                      onSelectAll={() => setEditModal(m => ({...m, colours: [...COLOR_PRESETS]}))}
                      onClear={() => setEditModal(m => ({...m, colours: [], colorPhotos: {}}))} />
                    {editModal.colours.length > 1 && (() => {
                      const others = editModal.colours.filter(c => c !== (editModal.colours.includes(editModal.color) ? editModal.color : editModal.colours[0]));
                      const existingCount = others.filter(c => editModal.siblingByColour?.[c]).length;
                      const newCount = others.length - existingCount;
                      const parts = [];
                      if (existingCount > 0) parts.push(`${existingCount} existing colour product${existingCount > 1 ? 's' : ''} will be updated`);
                      if (newCount > 0) parts.push(`${newCount} new colour product${newCount > 1 ? 's' : ''} will be created`);
                      return <p className="combo-info">On save: {parts.join(', ')}.</p>;
                    })()}
                    {editModal.colours.length > 0 && (
                      <div className="colour-photo-row">
                        <div className="modal-label" style={{marginTop:8}}>Photo per colour <span style={{fontWeight:400,color:'#9ca3af',textTransform:'none',letterSpacing:0}}>(optional — falls back to Product Images below if skipped)</span></div>
                        <div className="colour-photo-tiles">
                          {editModal.colours.map(c => (
                            <label key={c} className="colour-photo-tile">
                              {editModal.colorPhotos[c]?.preview ? (
                                <img src={editModal.colorPhotos[c].preview} alt={c} />
                              ) : (
                                <span className="colour-photo-plus">＋</span>
                              )}
                              <input type="file" accept="image/*" style={{display:'none'}}
                                onChange={e => { const f = e.target.files?.[0]; if (f) setEditColourPhoto(c, f); }} />
                              <span className="colour-photo-label">
                                {COLOR_CSS[c] && <span className="csf-swatch" style={{background: COLOR_CSS[c]}} />}
                                {c}
                              </span>
                            </label>
                          ))}
                        </div>
                        <div className="modal-label" style={{marginTop:12}}>Stock per colour</div>
                        <div className="colour-stock-list">
                          {editModal.colours.map(c => {
                            const isPrimary = c === (editModal.colours.includes(editModal.color) ? editModal.color : editModal.colours[0]);
                            const stockVal = isPrimary ? editModal.stockQty : (editModal.siblingStocks?.[c] ?? 0);
                            return (
                              <div key={c} className="colour-stock-item">
                                {COLOR_CSS[c] && <span className="csf-swatch" style={{background: COLOR_CSS[c], flexShrink:0}} />}
                                <span className="colour-stock-name">{c}</span>
                                <input type="number" min="0" className="colour-stock-input"
                                  value={stockVal}
                                  onChange={e => {
                                    if (isPrimary) {
                                      setEditModal(m => ({...m, stockQty: e.target.value}));
                                    } else {
                                      setEditModal(m => ({...m, siblingStocks: {...(m.siblingStocks||{}), [c]: e.target.value}}));
                                    }
                                  }} />
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {(editModal.variants || []).map((v, idx) => (
                  <div key={idx} className="variant-block">
                    <div className="variant-block-head">
                      <input className="variant-name-inp" placeholder="Variant name e.g. Material"
                        value={v.name} onChange={e => updateEditVariantRow(idx, { name: e.target.value })} />
                      <button type="button" className="variant-remove-btn" onClick={() => removeEditVariantRow(idx)}>✕</button>
                    </div>
                    {v.name.trim().toLowerCase() === 'size' ? (
                      <ColorSizeInput label="" presets={SIZE_PRESETS}
                        value={v.value} onChange={val => updateEditVariantRow(idx, { value: val })} />
                    ) : (
                      <input placeholder="Value" value={v.value} onChange={e => updateEditVariantRow(idx, { value: e.target.value })} />
                    )}
                  </div>
                ))}
                <div className="variant-add-row">
                  {!editModal.showColourPicker && (
                    <button type="button" className="chip-action" onClick={() => setEditModal(m => ({...m, showColourPicker: true}))}>+ Colour</button>
                  )}
                  <button type="button" className="chip-action" onClick={() => addEditVariantRow('Size')}>+ Size</button>
                  <button type="button" className="chip-action" onClick={() => addEditVariantRow('')}>+ Custom Variant</button>
                </div>
              </div>
            )}

            <label className="modal-label" style={{marginTop:'12px'}}>Description</label>
            <textarea className="edit-desc-textarea" rows={3}
              placeholder="Product description, material, care instructions..."
              value={editModal.description}
              onChange={e => setEditModal(m => ({...m, description: e.target.value}))} />

            <label className="modal-label" style={{marginTop:'12px'}}>Product Images (up to {maxPhotosForPlan(tenantInfo?.plan)}) <span style={{fontWeight:400,color:'#9ca3af'}}>— {tenantInfo?.plan === 'PRO' ? 'PRO plan' : 'upgrade to PRO for up to 6 photos'}</span></label>
            <div className="edit-img-slots">
              {editModal.imageSlots.map((slot, idx) => (
                <div key={idx} className="edit-img-slot">
                  {slot.preview
                    ? <>
                        <img src={slot.preview} alt={`img${idx+1}`} className="edit-slot-thumb" />
                        <button type="button" className="edit-slot-remove"
                          onClick={() => setEditModal(m => {
                            const s = [...m.imageSlots];
                            s[idx] = { file: null, preview: null, serverUrl: null };
                            return { ...m, imageSlots: s };
                          })}>✕</button>
                      </>
                    : <label className="edit-slot-add">
                        <span>＋</span>
                        <small>Image {idx + 1}</small>
                        <input type="file" accept="image/*" style={{display:'none'}}
                          onChange={e => {
                            const f = e.target.files[0];
                            if (f) setEditModal(m => {
                              const s = [...m.imageSlots];
                              s[idx] = { file: f, preview: URL.createObjectURL(f), serverUrl: null };
                              return { ...m, imageSlots: s };
                            });
                          }} />
                      </label>
                  }
                </div>
              ))}
            </div>

            <label className="edit-featured-toggle" style={{marginTop:'10px'}}>
              <input type="checkbox" checked={editModal.featured}
                onChange={e => setEditModal(m => ({...m, featured: e.target.checked}))} />
              <span>❤ Mark as Favourite</span>
            </label>
            <label className="edit-featured-toggle" style={{marginTop:'8px'}}>
              <input type="checkbox" checked={editModal.showToWebsite ?? false}
                onChange={e => setEditModal(m => ({...m, showToWebsite: e.target.checked}))} />
              <span>🌐 Show on Website</span>
            </label>
            <label className="edit-featured-toggle" style={{marginTop:'8px'}}>
              <input type="checkbox" checked={editModal.festiveOffer ?? false}
                onChange={e => setEditModal(m => ({...m, festiveOffer: e.target.checked}))} />
              <span>🎉 Seasonal / Festive Offer</span>
            </label>
            {tenantInfo?.subdomain === 'gosuas' && (
              <label className="edit-featured-toggle" style={{marginTop:'8px'}}>
                <input type="checkbox" checked={editModal.rentalAvailable ?? false}
                  onChange={e => setEditModal(m => ({...m, rentalAvailable: e.target.checked}))} />
                <span>🔑 Available for Rental</span>
              </label>
            )}

            <div className="modal-actions" style={{marginTop:'18px'}}>
              <button className="modal-cancel" onClick={() => setEditModal(null)}>Cancel</button>
              <button className="modal-print" onClick={saveEdit}>💾 Save Changes</button>
            </div>
          </div>
        </div>
        );
      })()}

      {/* ── Label modal (global) ── */}
      {labelModal && (
        <div className="modal-overlay" onClick={() => setLabelModal(null)}>
          <div className="modal-box" onClick={e => e.stopPropagation()}>
            <h3>Print Barcode Label</h3>
            <p className="modal-product-name">{labelModal.product.name}
              {labelModal.product.color ? ` · ${labelModal.product.color}` : ''}
              {labelModal.product.size  ? ` · ${labelModal.product.size}`  : ''}
            </p>
            <label className="modal-label">Sticker Type</label>
            {STICKER_TYPES.map(s => (
              <div key={s.id} className={`sticker-option ${labelModal.stickerType===s.id?'sticker-selected':''}`}
                onClick={() => setLabelModal(m => ({...m, stickerType:s.id}))}>
                <div className="sticker-name">{s.label}</div>
                <div className="sticker-size">{s.size}</div>
                {s.id === 'two-row' && <span className="sticker-suggested">★ Suggested</span>}
              </div>
            ))}
            <label className="modal-label" style={{marginTop:'14px'}}>Quantity</label>
            <input type="number" min="1" max="100" className="modal-qty" value={labelModal.qty}
              onChange={e => setLabelModal(m => ({...m, qty:Math.max(1,Number(e.target.value))}))} />
            <div className="modal-actions">
              <button className="modal-cancel" onClick={() => setLabelModal(null)}>Cancel</button>
              <button className="modal-print" onClick={() => {
                if (labelModal.stickerType === 'four-row' && !confirmFourRowStock()) return;
                printLabels(labelModal.product, labelModal.stickerType, labelModal.qty, tenantInfo?.name);
                setLabelModal(null);
              }}>
                🖨 Print {labelModal.qty} Label{labelModal.qty>1?'s':''}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Toast notifications (global) ── */}
      {toasts.length > 0 && (
        <div className="toast-stack">
          {toasts.map(t => (
            <div key={t.id} className={`toast toast-${t.type}`} onClick={() => dismissToast(t.id)}>
              <span className="toast-icon">{t.type === 'success' ? '✓' : t.type === 'error' ? '✕' : 'ⓘ'}</span>
              <span className="toast-msg">{t.message}</span>
            </div>
          ))}
        </div>
      )}

      {/* ── Generic confirm dialog (global) — replaces window.confirm to match app styling ── */}
      {confirmDialog && (
        <div className="modal-overlay" onClick={() => setConfirmDialog(null)}>
          <div className="modal-box" style={{maxWidth:380}} onClick={e => e.stopPropagation()}>
            <h3>{confirmDialog.title || 'Confirm'}</h3>
            <p style={{color:'#555',fontSize:14,margin:'10px 0 0'}}>{confirmDialog.message}</p>
            <div className="modal-actions">
              <button className="modal-cancel" onClick={() => setConfirmDialog(null)}>Cancel</button>
              <button className="modal-danger" onClick={confirmDialog.onConfirm}>{confirmDialog.confirmLabel || 'Delete'}</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Optional customer details before generating a POS bill (global) ── */}
      {custModal && (
        <div className="modal-overlay" onClick={() => setCustModal(false)}>
          <div className="modal-box" style={{maxWidth:400}} onClick={e => e.stopPropagation()}>
            <h3>Customer Details <span style={{fontWeight:400,color:'#9ca3af',fontSize:13}}>(optional)</span></h3>
            <label className="modal-label">Mobile Number</label>
            <input placeholder="Optional" value={custMobileInput} autoFocus
              onChange={e => {
                const v = e.target.value.replace(/\D/g,'').slice(0,10);
                setCustMobileInput(v);
                if (v.length === 10) lookupCustomerByMobile(v);
              }} />
            {custLookupFound && <p style={{fontSize:12,color:'#1e7e34',margin:'4px 0 0'}}>✓ Existing customer found — name filled in</p>}
            <label className="modal-label" style={{marginTop:'10px'}}>Name</label>
            <input placeholder="Walk-in Customer" value={custNameInput}
              onChange={e => setCustNameInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && paymentType !== 'SPLIT') { setCustModal(false); generateBill(custNameInput, custMobileInput, paymentType, splitEntries); } }} />

            {/* ── Payment type selector ── */}
            <label className="modal-label" style={{marginTop:'14px'}}>Payment Method</label>
            <div style={{display:'flex',gap:8,flexWrap:'wrap',marginBottom:8}}>
              {['CASH','CARD','QR','SPLIT'].map(m => (
                <button key={m} type="button"
                  onClick={() => { setPaymentType(m); setSplitError(''); if (m !== 'SPLIT') setSplitEntries([{ method: m, amount: '' }]); }}
                  style={{padding:'6px 14px',borderRadius:6,border:'2px solid',cursor:'pointer',fontWeight:600,fontSize:13,
                    borderColor: paymentType===m ? '#4f46e5':'#d1d5db',
                    background: paymentType===m ? '#ede9fe':'#f9fafb',
                    color: paymentType===m ? '#4f46e5':'#374151'}}>
                  {m==='CASH'?'💵 Cash':m==='CARD'?'💳 Card':m==='QR'?'📱 QR':'✂️ Split'}
                </button>
              ))}
            </div>

            {/* ── Split payment breakdown ── */}
            {paymentType === 'SPLIT' && (() => {
              const subtotal = cart.reduce((s, i) => s + Number(i.price) * i.quantity, 0);
              const discount = calcDiscount(subtotal);
              const grandTotal = subtotal - discount;
              const splitSum = splitEntries.reduce((s, e) => s + (parseFloat(e.amount) || 0), 0);
              const remaining = Math.round((grandTotal - splitSum) * 100) / 100;
              return (
                <div style={{background:'#f8f7ff',border:'1px solid #e0dcff',borderRadius:8,padding:'12px 14px',marginBottom:8}}>
                  {splitEntries.map((entry, idx) => (
                    <div key={idx} style={{display:'flex',gap:8,alignItems:'center',marginBottom:8}}>
                      <select value={entry.method}
                        onChange={e => setSplitEntries(prev => prev.map((x, i) => i===idx ? {...x, method:e.target.value} : x))}
                        style={{flex:'0 0 100px',padding:'5px 8px',borderRadius:6,border:'1px solid #d1d5db',fontSize:13}}>
                        <option value="CASH">Cash</option>
                        <option value="CARD">Card</option>
                        <option value="QR">QR</option>
                        <option value="UPI">UPI</option>
                      </select>
                      <input type="number" min="0.01" step="0.01" placeholder="Amount"
                        value={entry.amount}
                        onChange={e => setSplitEntries(prev => prev.map((x, i) => i===idx ? {...x, amount:e.target.value} : x))}
                        style={{flex:1,padding:'5px 8px',borderRadius:6,border:'1px solid #d1d5db',fontSize:13}} />
                      {splitEntries.length > 1 && (
                        <button type="button" onClick={() => setSplitEntries(prev => prev.filter((_, i) => i!==idx))}
                          style={{background:'none',border:'none',color:'#ef4444',cursor:'pointer',fontSize:18,lineHeight:1,padding:'0 4px'}}>✕</button>
                      )}
                    </div>
                  ))}
                  <button type="button"
                    onClick={() => setSplitEntries(prev => [...prev, { method: 'CASH', amount: '' }])}
                    style={{fontSize:13,color:'#4f46e5',background:'none',border:'none',cursor:'pointer',padding:'2px 0',fontWeight:600}}>
                    + Add payment row
                  </button>
                  <div style={{display:'flex',justifyContent:'space-between',marginTop:10,paddingTop:8,borderTop:'1px solid #e0dcff',fontSize:13,fontWeight:600}}>
                    <span>Bill total: ₹{grandTotal.toFixed(2)}</span>
                    <span style={{color: remaining===0 ? '#16a34a' : '#dc2626'}}>
                      {remaining===0 ? '✓ Balanced' : remaining > 0 ? `₹${remaining.toFixed(2)} remaining` : `Over by ₹${Math.abs(remaining).toFixed(2)}`}
                    </span>
                  </div>
                  {splitError && <p style={{color:'#dc2626',fontSize:12,margin:'6px 0 0'}}>{splitError}</p>}
                </div>
              );
            })()}

            <div className="modal-actions">
              <button className="modal-cancel" onClick={() => setCustModal(false)}>Back</button>
              <button className="modal-print" onClick={() => {
                if (paymentType === 'SPLIT') {
                  const subtotal = cart.reduce((s, i) => s + Number(i.price) * i.quantity, 0);
                  const grandTotal = subtotal - calcDiscount(subtotal);
                  const splitSum = splitEntries.reduce((s, e) => s + (parseFloat(e.amount) || 0), 0);
                  if (Math.abs(splitSum - grandTotal) > 0.001) { setSplitError(`Split total ₹${splitSum.toFixed(2)} must equal bill total ₹${grandTotal.toFixed(2)}`); return; }
                  if (splitEntries.some(e => !e.method || !(parseFloat(e.amount) > 0))) { setSplitError('Each payment row needs a method and a positive amount.'); return; }
                  setSplitError('');
                }
                setCustModal(false);
                generateBill(custNameInput, custMobileInput, paymentType, splitEntries);
              }}>
                Generate Bill
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Edit rental (global) — e.g. customer paid only advance at booking, settles rent/deposit later ── */}
      {rentalEditModal && (
        <div className="modal-overlay" onClick={() => setRentalEditModal(null)}>
          <div className="modal-box rental-edit-box" style={{width:680, maxWidth:'92vw'}} onClick={e => e.stopPropagation()}>
            <h3>Edit Rental</h3>
            <p className="modal-product-name">{rentalEditModal.productName}</p>
            {rentalEditError && <p className="error-msg">{rentalEditError}</p>}

            <div className="rental-form-grid">
              <div>
                <label className="modal-label">Booking Date</label>
                <input type="date" value={rentalEditModal.bookingDate}
                  onChange={e => setRentalEditModal(m => ({...m, bookingDate: e.target.value}))} />
              </div>
              <div>
                <label className="modal-label">Event Period (days)</label>
                <input type="number" min="1" value={rentalEditModal.eventPeriodDays}
                  onChange={e => setRentalEditModal(m => ({...m, eventPeriodDays: Math.max(1, Number(e.target.value) || 1)}))} />
              </div>
              <div>
                <label className="modal-label">Quantity</label>
                <input type="number" min="1" value={rentalEditModal.quantity}
                  onChange={e => setRentalEditModal(m => ({...m, quantity: Math.max(1, Number(e.target.value) || 1)}))} />
              </div>
              <div>
                <label className="modal-label">Advance Amount (₹)</label>
                <input type="number" min="0" value={rentalEditModal.advanceAmount}
                  onChange={e => setRentalEditModal(m => ({...m, advanceAmount: e.target.value}))} />
              </div>
              <div>
                <label className="modal-label">Deposit Amount (₹)</label>
                <input type="number" min="0" value={rentalEditModal.depositAmount}
                  onChange={e => setRentalEditModal(m => ({...m, depositAmount: e.target.value}))} />
              </div>
              <div>
                <label className="modal-label">Rent (₹)</label>
                <input type="number" min="0" value={rentalEditModal.rentAmount}
                  onChange={e => setRentalEditModal(m => ({...m, rentAmount: e.target.value}))} />
              </div>
              <div>
                <label className="modal-label">Total (₹)</label>
                <input type="text" disabled value={((Number(rentalEditModal.advanceAmount) || 0) + (Number(rentalEditModal.depositAmount) || 0) + (Number(rentalEditModal.rentAmount) || 0)).toFixed(2)} />
              </div>
              <div>
                <label className="modal-label">Customer Name <span style={{fontWeight:400,color:'#9ca3af'}}>(optional)</span></label>
                <input placeholder="Walk-in Customer" value={rentalEditModal.customerName}
                  onChange={e => setRentalEditModal(m => ({...m, customerName: e.target.value}))} />
              </div>
              <div>
                <label className="modal-label">Mobile Number <span style={{fontWeight:400,color:'#9ca3af'}}>(optional)</span></label>
                <input placeholder="Optional" value={rentalEditModal.customerMobile}
                  onChange={e => setRentalEditModal(m => ({...m, customerMobile: e.target.value}))} />
              </div>
            </div>

            <div className="modal-actions">
              <button className="modal-cancel" onClick={() => setRentalEditModal(null)}>Cancel</button>
              <button className="modal-print" onClick={saveRentalEdit}>💾 Save Changes</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Return rental (global) — records deposit refund, any damage deduction, and return date ── */}
      {returnModal && (
        <div className="modal-overlay" onClick={() => setReturnModal(null)}>
          <div className="modal-box" style={{maxWidth:420}} onClick={e => e.stopPropagation()}>
            <h3>Return Rental</h3>
            <p className="modal-product-name">{returnModal.productName} <span style={{fontWeight:400,color:'#9ca3af'}}>({returnModal.rentalNo})</span></p>

            <label className="modal-label" style={{marginTop:10}}>Return Date</label>
            <input type="date" value={returnModal.returnDate}
              onChange={e => setReturnModal(m => ({...m, returnDate: e.target.value}))} />

            <label className="modal-label" style={{marginTop:10}}>Damage / Deduction Amount (₹) <span style={{fontWeight:400,color:'#9ca3af'}}>(optional)</span></label>
            <input type="number" min="0" max={returnModal.depositAmount} placeholder="0"
              value={returnModal.deductionAmount}
              onChange={e => setReturnModal(m => ({...m, deductionAmount: e.target.value}))} />

            <label className="modal-label" style={{marginTop:10}}>Notes <span style={{fontWeight:400,color:'#9ca3af'}}>(optional — e.g. scratch on clasp)</span></label>
            <input placeholder="Condition notes" value={returnModal.returnNotes}
              onChange={e => setReturnModal(m => ({...m, returnNotes: e.target.value}))} />

            <div className="cart-total-row" style={{marginTop:14}}>
              <span>Deposit Collected</span>
              <span>₹{returnModal.depositAmount.toFixed(2)}</span>
            </div>
            {Number(returnModal.deductionAmount) > 0 && (
              <div className="cart-total-row cart-subtotal-row">
                <span>Deduction</span>
                <span>− ₹{Number(returnModal.deductionAmount).toFixed(2)}</span>
              </div>
            )}
            <div className="cart-total-row">
              <span>Refund to Customer</span>
              <strong>₹{Math.max(0, returnModal.depositAmount - (Number(returnModal.deductionAmount) || 0)).toFixed(2)}</strong>
            </div>

            <div className="modal-actions">
              <button className="modal-cancel" onClick={() => setReturnModal(null)}>Cancel</button>
              <button className="modal-print" onClick={confirmReturn}>✓ Confirm Return</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Public Shop ────────────────────────────────────────────────
const INDIA_STATES = [
  'Andhra Pradesh','Arunachal Pradesh','Assam','Bihar','Chhattisgarh','Goa','Gujarat',
  'Haryana','Himachal Pradesh','Jharkhand','Karnataka','Kerala','Madhya Pradesh',
  'Maharashtra','Manipur','Meghalaya','Mizoram','Nagaland','Odisha','Punjab','Rajasthan',
  'Sikkim','Tamil Nadu','Telangana','Tripura','Uttar Pradesh','Uttarakhand','West Bengal',
  'Andaman and Nicobar Islands','Chandigarh','Dadra and Nagar Haveli and Daman and Diu',
  'Delhi','Jammu and Kashmir','Ladakh','Lakshadweep','Puducherry',
];

const STATUS_STEPS = ['PENDING','CONFIRMED','SHIPPED','DELIVERED'];
const STATUS_LABELS = { PENDING:'Order Placed', CONFIRMED:'Confirmed', SHIPPED:'Shipped', DELIVERED:'Delivered', CANCELLED:'Cancelled' };
const STATUS_ICONS  = { PENDING:'🕐', CONFIRMED:'✅', SHIPPED:'🚚', DELIVERED:'🎉', CANCELLED:'❌' };

function ShopApp() {
  const [products, setProducts]   = useState([]);
  const [cart, setCart]           = useState([]);
  const [showCart, setShowCart]   = useState(false);
  const [checkout, setCheckout]   = useState(false);
  const [orderDone, setOrderDone] = useState(null);
  const [orderForm, setOrderForm] = useState({
    name:'', phone:'', houseNo:'', street:'', city:'', pincode:'', state:'', country:'India'
  });
  const [orderError, setOrderError] = useState('');
  const [search, setSearch]         = useState('');
  const [filterCat, setFilterCat]   = useState('');
  const [shopPage, setShopPage]     = useState(1);
  const [shopView, setShopView]     = useState('shop'); // 'shop' | 'track'
  const [trackInput, setTrackInput] = useState('');
  const [trackedOrders, setTrackedOrders] = useState(null);
  const [trackError, setTrackError]       = useState('');
  const [copied, setCopied] = useState(false);
  const [shopTab, setShopTab] = useState('all');  // 'all' | 'new' | 'popular' | 'featured'
  const [detailProduct, setDetailProduct] = useState(null);
  const [detailQty, setDetailQty] = useState(1);
  const [detailImgIdx, setDetailImgIdx] = useState(0);
  const [detailColor, setDetailColor] = useState('');
  const [detailSize, setDetailSize] = useState('');

  const [shopInfo, setShopInfo] = useState({ name: '', logoUrl: null });
  const [digitalProducts, setDigitalProducts] = useState([]);
  const [pdfBuyModal, setPdfBuyModal] = useState(null); // DigitalProduct being purchased
  const [pdfForm, setPdfForm] = useState({ name: '', email: '', address: '', phone: '' });
  const [pdfPaying, setPdfPaying] = useState(false);
  const [pdfSuccess, setPdfSuccess] = useState(null); // email string after success
  const imgUrls = (p) => (p?.imageUrl || '').split(',').filter(Boolean);
  const imgSrc  = (url) => `${BACKEND}${url}`;
  const shopLogoSrc = shopInfo.logoUrl ? `${BACKEND}${shopInfo.logoUrl}` : '/logo.png';
  const shopName = shopInfo.name || getSubdomain().replace(/[-_]/g,' ').replace(/\b\w/g,c=>c.toUpperCase());

  useEffect(() => {
    const sub = getSubdomain();
    axios.get(`${API}/public/products?subdomain=${sub}`).then(r => setProducts(r.data)).catch(() => {});
    axios.get(`${API}/public/shop-info?subdomain=${sub}`).then(r => setShopInfo(r.data)).catch(() => {});
    axios.get(`${API}/public/digital/products?subdomain=${sub}`).then(r => setDigitalProducts(r.data)).catch(() => {});
  }, []);

  const addToCart = (p, selectedColor, selectedSize) => {
    const key = p.barcode + (selectedColor||'') + (selectedSize||'');
    setCart(prev => {
      const ex = prev.find(i => i.key === key);
      if (ex) return prev.map(i => i.key === key ? { ...i, qty: i.qty + 1 } : i);
      return [...prev, {
        key, barcode: p.barcode, name: p.name, price: p.sellingPrice,
        imageUrl: p.imageUrl, qty: 1,
        selectedColor: selectedColor || p.color || '',
        selectedSize: selectedSize || p.size || '',
      }];
    });
  };

  const updateCartQty = (key, delta) => {
    setCart(prev => prev.map(i => i.key === key ? { ...i, qty: i.qty + delta } : i).filter(i => i.qty > 0));
  };

  const cartTotal = cart.reduce((s, i) => s + Number(i.price) * i.qty, 0);
  const cartCount = cart.length;

  const placeOrder = async (e) => {
    e.preventDefault();
    if (!orderForm.name.trim()) { setOrderError('Name is required.'); return; }
    if (!/^\d{10}$/.test(orderForm.phone.trim())) { setOrderError('Enter a valid 10-digit mobile number.'); return; }
    if (!orderForm.houseNo.trim() || !orderForm.street.trim() || !orderForm.city.trim() || !orderForm.pincode.trim() || !orderForm.state.trim()) {
      setOrderError('Delivery address is required — please fill in all address fields.');
      return;
    }
    setOrderError('');

    try {
      // Step 1: Create Razorpay order — on the SHOP's own connected Razorpay account, not ours
      const rpRes = await axios.post(`${API}/public/payment/create-order`, { subdomain: getSubdomain(), amount: cartTotal });
      const { razorpayOrderId, amount, keyId } = rpRes.data;

      // Step 2: Load Razorpay script if not already loaded
      await new Promise((resolve) => {
        if (window.Razorpay) { resolve(); return; }
        const s = document.createElement('script');
        s.src = 'https://checkout.razorpay.com/v1/checkout.js';
        s.onload = resolve;
        document.body.appendChild(s);
      });

      // Step 3: Open Razorpay checkout
      const orderPayload = {
        subdomain: getSubdomain(),
        customerName: orderForm.name,
        customerPhone: orderForm.phone,
        houseNo: orderForm.houseNo,
        street: orderForm.street,
        city: orderForm.city,
        pincode: orderForm.pincode,
        state: orderForm.state,
        country: orderForm.country,
        items: cart.map(i => ({ barcode: i.barcode, quantity: i.qty, selectedColor: i.selectedColor||null, selectedSize: i.selectedSize||null })),
      };

      new window.Razorpay({
        key: keyId,
        amount,
        currency: 'INR',
        name: shopName,
        description: `Purchase from ${shopName}`,
        image: shopLogoSrc,
        order_id: razorpayOrderId,
        prefill: { name: orderForm.name, contact: orderForm.phone },
        theme: { color: '#1E3A5F' },
        handler: async (rpResponse) => {
          try {
            // Step 4: Verify payment signature
            const verifyRes = await axios.post(`${API}/public/payment/verify`, {
              subdomain: getSubdomain(),
              razorpayOrderId:   rpResponse.razorpay_order_id,
              razorpayPaymentId: rpResponse.razorpay_payment_id,
              razorpaySignature: rpResponse.razorpay_signature,
            });

            if (verifyRes.data.status !== 'success') {
              setOrderError('Payment verification failed. Please contact support.');
              return;
            }

            // Step 5: Save the confirmed order (server re-verifies the signature independently)
            const res = await axios.post(`${API}/public/orders`, {
              ...orderPayload,
              razorpayOrderId:   rpResponse.razorpay_order_id,
              razorpayPaymentId: rpResponse.razorpay_payment_id,
              razorpaySignature: rpResponse.razorpay_signature,
            });
            setOrderDone(res.data);
            setCart([]);
            setCheckout(false);
            setShowCart(false);
          } catch (err) {
            setOrderError(err.response?.data?.error || err.response?.data?.message || 'Order save failed after payment. Contact support with payment ID: ' + rpResponse.razorpay_payment_id);
          }
        },
        modal: {
          ondismiss: () => setOrderError('Payment cancelled. Your order was not placed.'),
        },
      }).open();

    } catch (err) {
      setOrderError(err.response?.data?.error || err.response?.data?.message || 'Could not initiate payment. Please try again.');
    }
  };

  const trackOrder = async (e) => {
    e.preventDefault();
    setTrackError('');
    setTrackedOrders(null);
    if (!trackInput.trim()) { setTrackError('Enter an Order ID or mobile number.'); return; }
    const val = trackInput.trim();
    const isPhone = /^\d{10,}$/.test(val);
    const param = isPhone ? `phone=${val}` : `orderId=${encodeURIComponent(val)}`;
    try {
      const res = await axios.get(`${API}/public/orders/track?${param}&subdomain=${getSubdomain()}`);
      const data = Array.isArray(res.data) ? res.data : [res.data];
      setTrackedOrders(data);
    } catch {
      setTrackError('No order found. Please check the Order ID or mobile number.');
    }
  };

  const copyOrderId = (id) => {
    navigator.clipboard.writeText(id);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const formatAddress = (o) =>
    [o.houseNo, o.street, o.city, o.pincode, o.state, o.country].filter(Boolean).join(', ');

  const cats = [...new Set(products.map(p => p.category).filter(Boolean))].sort();
  const filtered = products.filter(p => {
    const s = search.toLowerCase();
    return (!search || p.name?.toLowerCase().includes(s) || p.category?.toLowerCase().includes(s))
      && (!filterCat || p.category === filterCat);
  });
  const now = Date.now();
  const tabFiltered = (() => {
    const base = [...products].filter(p => Boolean(p.active !== false));
    if (shopTab === 'new') {
      return base
        .filter(p => p.createdAt && (now - new Date(p.createdAt).getTime()) < 60 * 24 * 60 * 60 * 1000)
        .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    }
    if (shopTab === 'popular') {
      return base
        .filter(p => (p.soldCount || 0) > 0)
        .sort((a, b) => (b.soldCount || 0) - (a.soldCount || 0));
    }
    if (shopTab === 'featured') {
      return base.filter(p => p.featured === true);
    }
    return null; // 'all' — use filtered (cat + search)
  })();

  const displaySource = shopTab === 'all' ? filtered : (tabFiltered || []);
  const SHOP_PAGE_SIZE = 10;
  const shopTotalPages = Math.ceil(displaySource.length / SHOP_PAGE_SIZE);
  const shopPageSafe   = Math.min(shopPage, Math.max(1, shopTotalPages));
  const pagedProducts  = displaySource.slice((shopPageSafe - 1) * SHOP_PAGE_SIZE, shopPageSafe * SHOP_PAGE_SIZE);

  useEffect(() => { setShopPage(1); }, [filterCat, search, shopTab]);

  /* ── Product detail screen ── */
  if (detailProduct) {
    const dp = detailProduct;
    const dpUrls = imgUrls(dp);
    // Group all colour-variant siblings (same base SKU + category) so we can render them as a single product with a colour picker
    const dpBaseSku = baseSkuOf(dp.sku);
    const colorFamily = products.filter(p => p.category === dp.category && baseSkuOf(p.sku) === dpBaseSku && p.color);
    const hasColorFamily = colorFamily.length > 1;
    // Exclude colour siblings from "You May Also Like" since they're shown in the colour picker above
    const similar = products.filter(p => p.category === dp.category && p.id !== dp.id && !(hasColorFamily && baseSkuOf(p.sku) === dpBaseSku)).slice(0, 8);
    return (
      <>
        <div className="s2-detail-page">
        {/* Header */}
        <header className="s2-header" style={{position:'sticky',top:0,zIndex:100}}>
          <div className="s2-header-inner">
            <img src={shopLogoSrc} className="s2-logo" alt={shopName} onClick={() => setDetailProduct(null)} style={{cursor:'pointer'}} onError={e=>{e.currentTarget.onerror=null;e.currentTarget.src='/logo.png';}} />
            <button className="s2-back-btn" onClick={() => { setDetailProduct(null); window.scrollTo({top:0,behavior:'smooth'}); }}>← Back</button>
            <button className="s2-cart-icon" onClick={() => setShowCart(true)}>
              🛍️ {cartCount > 0 && <span className="s2-cart-badge">{cartCount}</span>}
            </button>
          </div>
        </header>

        <div className="s2-detail-wrap">
          {/* Left: image gallery */}
          <div className="s2-detail-gallery">
            <div className="s2-detail-main-img">
              {dpUrls.length > 0
                ? <img src={imgSrc(dpUrls[detailImgIdx])} alt={dp.name} />
                : <div className="s2-detail-placeholder">💎</div>
              }
              {dp.stockQty === 0 && <div className="s2-detail-soldout-badge">Sold Out</div>}
            </div>
            {dpUrls.length > 1 && (
              <div className="s2-detail-thumbs">
                {dpUrls.map((url, i) => (
                  <img key={i} src={imgSrc(url)} alt={`view ${i+1}`}
                    className={`s2-detail-thumb ${i === detailImgIdx ? 's2-thumb-active' : ''}`}
                    onClick={() => setDetailImgIdx(i)} />
                ))}
              </div>
            )}
          </div>

          {/* Right: product info */}
          <div className="s2-detail-info">
            <div className="s2-detail-cat">{dp.category}{dp.subcategory ? ` · ${dp.subcategory}` : ''}</div>
            <h1 className="s2-detail-name">{dp.name}</h1>
            <div className="s2-detail-price">₹{Number(dp.sellingPrice).toFixed(2)}</div>

            {(hasColorFamily || dp.color) && (
              <div className="s2-detail-attr-block">
                <div className="s2-attr-lbl">Colour</div>
                <div className="s2-detail-color-chips">
                  {hasColorFamily ? colorFamily.map(variant => {
                    const c = variant.color;
                    const isOos = variant.stockQty === 0;
                    return (
                      <button key={variant.id}
                        className={`s2-color-chip ${variant.id === dp.id ? 's2-color-chip-on' : ''} ${isOos ? 's2-color-chip-oos' : ''}`}
                        onClick={() => { setDetailProduct(variant); setDetailQty(1); setDetailImgIdx(0); setDetailColor(c); }}>
                        <span className="s2-color-dot"
                          style={{background: COLOR_CSS[c] || '#ccc', border: c === 'White' ? '1px solid #ddd' : 'none'}} />
                        {c}
                        {isOos && <span style={{fontSize:'0.72em',marginLeft:3,opacity:0.65}}>(Out)</span>}
                      </button>
                    );
                  }) : dp.color.split(',').filter(Boolean).map(c => c.trim()).map(c => (
                    <button key={c}
                      className={`s2-color-chip ${detailColor === c ? 's2-color-chip-on' : ''}`}
                      onClick={() => setDetailColor(detailColor === c ? '' : c)}>
                      <span className="s2-color-dot"
                        style={{background: COLOR_CSS[c] || '#ccc', border: c === 'White' ? '1px solid #ddd' : 'none'}} />
                      {c}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {dp.size && (
              <div className="s2-detail-attr-block">
                <div className="s2-attr-lbl">Size</div>
                <div className="s2-detail-size-chips">
                  {dp.size.split(',').filter(Boolean).map(s => s.trim()).map(s => (
                    <button key={s}
                      className={`s2-size-chip ${detailSize === s ? 's2-size-chip-on' : ''}`}
                      onClick={() => setDetailSize(detailSize === s ? '' : s)}>
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {dp.description && (
              <div className="s2-detail-desc">
                <div className="s2-detail-desc-title">Description</div>
                <p className="s2-detail-desc-text">{dp.description}</p>
              </div>
            )}

            {dp.stockQty > 0 ? (
              <>
                <div className="s2-detail-qty-row">
                  <span className="s2-attr-lbl">Quantity</span>
                  <div className="s2-detail-qty">
                    <button onClick={() => setDetailQty(q => Math.max(1, q - 1))}>−</button>
                    <span>{detailQty}</span>
                    <button onClick={() => setDetailQty(q => Math.min(dp.stockQty, q + 1))}>+</button>
                  </div>
                </div>
                <button className="s2-detail-atc" onClick={() => {
                  for (let i = 0; i < detailQty; i++) addToCart(dp, detailColor, detailSize);
                  setDetailProduct(null);
                  setShowCart(true);
                }}>🛍️ Add to Cart</button>
                <button className="s2-detail-buy" onClick={() => {
                  for (let i = 0; i < detailQty; i++) addToCart(dp, detailColor, detailSize);
                  setDetailProduct(null);
                  setCheckout(true);
                }}>Buy Now</button>
              </>
            ) : (
              <div className="s2-detail-oos">Currently Out of Stock</div>
            )}
          </div>
        </div>

        {/* Similar products */}
        {similar.length > 0 && (
          <div className="s2-similar-section">
            <h3 className="s2-similar-title">You May Also Like</h3>
            <div className="s2-similar-row">
              {similar.map(p => {
                const sUrls = imgUrls(p);
                return (
                  <div key={p.id} className={`s2-similar-card ${p.stockQty === 0 ? 's2-card-soldout' : ''}`}
                    onClick={() => { setDetailProduct(p); setDetailQty(1); setDetailImgIdx(0); setDetailColor(p.color?.split(',')[0]?.trim()||''); setDetailSize(p.size?.split(',')[0]?.trim()||''); window.scrollTo({top:0,behavior:'smooth'}); }}>
                    <div className="s2-similar-img-wrap">
                      {sUrls.length > 0
                        ? <img src={imgSrc(sUrls[0])} alt={p.name} />
                        : <div className="s2-similar-placeholder">💎</div>
                      }
                      {p.stockQty === 0 && <div className="s2-sold-ribbon">Sold Out</div>}
                    </div>
                    <div className="s2-similar-name">{p.name}</div>
                    <div className={`s2-similar-price ${p.stockQty === 0 ? 's2-price-soldout' : ''}`}>₹{Number(p.sellingPrice).toFixed(2)}</div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

      </div>

      {/* Cart Drawer */}
      {showCart && (
        <div className="s2-overlay" onClick={() => setShowCart(false)}>
          <div className="s2-drawer" onClick={e => e.stopPropagation()}>
            <div className="s2-drawer-hdr">
              <h3>Your Cart ({cartCount})</h3>
              <button className="s2-drawer-close" onClick={() => setShowCart(false)}>✕</button>
            </div>
            {cart.length === 0
              ? <div className="s2-cart-empty">Your cart is empty<br/><small>Add some items to get started!</small></div>
              : <>
                  <div className="s2-cart-items">
                    {cart.map(i => (
                      <div key={i.key} className="s2-cart-row">
                        {i.imageUrl
                          ? <img src={imgSrc(i.imageUrl.split(',')[0])} alt={i.name} className="s2-cart-thumb" />
                          : <div className="s2-cart-thumb-ph">💎</div>}
                        <div className="s2-cart-info">
                          <div className="s2-cart-name">{i.name}</div>
                          {(i.selectedColor || i.selectedSize) && (
                            <div className="s2-cart-variant">
                              {i.selectedColor && (
                                <span className="s2-cart-color-dot"
                                  style={{background: COLOR_CSS[i.selectedColor] || '#ccc',
                                    border: i.selectedColor==='White'?'1px solid #ddd':'none'}} />
                              )}
                              {[i.selectedColor, i.selectedSize].filter(Boolean).join(' · ')}
                            </div>
                          )}
                          <div className="s2-cart-price-each">₹{Number(i.price).toFixed(2)}</div>
                        </div>
                        <div className="s2-qty-wrap">
                          <button className="s2-qty-btn" onClick={() => updateCartQty(i.key, -1)}>−</button>
                          <span className="s2-qty-num">{i.qty}</span>
                          <button className="s2-qty-btn" onClick={() => updateCartQty(i.key, 1)}>+</button>
                        </div>
                        <div className="s2-cart-line">₹{(Number(i.price) * i.qty).toFixed(2)}</div>
                      </div>
                    ))}
                  </div>
                  <div className="s2-cart-footer">
                    <div className="s2-cart-subtotal"><span>Subtotal</span><strong>₹{cartTotal.toFixed(2)}</strong></div>
                    <button className="s2-checkout-btn" onClick={() => { setShowCart(false); setCheckout(true); }}>
                      Proceed to Checkout →
                    </button>
                  </div>
                </>
            }
          </div>
        </div>
      )}

      {/* Checkout Modal */}
      {checkout && (
        <div className="s2-overlay s2-center-overlay" onClick={() => setCheckout(false)}>
          <div className="s2-checkout-modal" onClick={e => e.stopPropagation()}>
            <div className="s2-drawer-hdr">
              <h3>Checkout</h3>
              <button className="s2-drawer-close" onClick={() => setCheckout(false)}>✕</button>
            </div>
            <form onSubmit={placeOrder} className="s2-checkout-form">
              <div className="s2-form-group">
                <label>Full Name *</label>
                <input placeholder="Your full name" value={orderForm.name} onChange={e => setOrderForm({...orderForm, name: e.target.value})} />
              </div>
              <div className="s2-form-group">
                <label>Phone Number *</label>
                <input type="tel" inputMode="numeric" maxLength={10} placeholder="10-digit mobile number"
                  value={orderForm.phone}
                  onChange={e => setOrderForm({...orderForm, phone: e.target.value.replace(/\D/g, '').slice(0, 10)})} />
              </div>
              <div className="s2-addr-section">
                <div className="s2-addr-title">Delivery Address *</div>
                <input placeholder="House / Flat / Building No. *" value={orderForm.houseNo} onChange={e => setOrderForm({...orderForm, houseNo: e.target.value})} required />
                <input placeholder="Street / Area / Locality *" value={orderForm.street} onChange={e => setOrderForm({...orderForm, street: e.target.value})} required />
                <div className="s2-form-row">
                  <input placeholder="City *" value={orderForm.city} onChange={e => setOrderForm({...orderForm, city: e.target.value})} required />
                  <input placeholder="PIN Code *" value={orderForm.pincode} onChange={e => setOrderForm({...orderForm, pincode: e.target.value})} required />
                </div>
                <select value={orderForm.state} onChange={e => setOrderForm({...orderForm, state: e.target.value})} required>
                  <option value="">Select State *</option>
                  {INDIA_STATES.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
              <div className="s2-order-summary">
                <div className="s2-summary-title">Order Summary</div>
                {cart.map(i => (
                  <div key={i.barcode} className="s2-summary-row">
                    <span>{i.name} × {i.qty}</span><span>₹{(Number(i.price)*i.qty).toFixed(2)}</span>
                  </div>
                ))}
                <div className="s2-summary-total"><span>Total</span><strong>₹{cartTotal.toFixed(2)}</strong></div>
              </div>
              {orderError && <p className="s2-form-error">{orderError}</p>}
              <button type="submit" className="s2-place-btn">Place Order</button>
            </form>
          </div>
        </div>
      )}
    </>
  );
  }

  /* ── Order success screen ── */
  if (orderDone) return (
    <div className="s2-success-page">
      <div className="s2-success-card">
        <div className="s2-success-check">✓</div>
        <h2 className="s2-success-h2">Order Placed Successfully!</h2>
        <div className="s2-orderid-box">
          <div className="s2-orderid-lbl">Your Order ID</div>
          <div className="s2-orderid-val">{orderDone.orderNo}</div>
          <button className="s2-copy-btn" onClick={() => copyOrderId(orderDone.orderNo)}>
            {copied ? '✓ Copied!' : '📋 Copy'}
          </button>
        </div>
        <p className="s2-success-msg">
          Save your Order ID to track status anytime.<br/>
          We'll call you on <strong>{orderDone.customerPhone}</strong> to confirm.
        </p>
        <button className="s2-track-btn" onClick={() => { setOrderDone(null); setShopView('track'); setTrackInput(orderDone.orderNo); }}>
          📦 Track This Order
        </button>
        <button className="s2-back-btn" onClick={() => setOrderDone(null)}>← Continue Shopping</button>
      </div>
    </div>
  );

  return (
    <div className="s2-app">

      {/* ── Announcement bar ── */}
      <div className="s2-announce">
        ✦ Free delivery on orders above ₹999 &nbsp;·&nbsp; {shopName} &nbsp;·&nbsp; Secure & trusted ✦
      </div>

      {/* ── Top header ── */}
      <header className="s2-header">
        <div className="s2-header-inner">
          <div className="s2-brand">
            <img src={shopLogoSrc} alt={shopName} className="s2-logo" onError={e=>{e.currentTarget.onerror=null;e.currentTarget.src='/logo.png';}} />
            <div className="s2-brand-text">
              <span className="s2-brand-name">{shopName}</span>
            </div>
          </div>
          <nav className="s2-nav">
            <button className={`s2-nav-link ${!filterCat&&shopView==='shop'?'s2-nav-active':''}`}
              onClick={() => { setShopView('shop'); setFilterCat(''); setSearch(''); }}>HOME</button>
            {cats.map(c => (
              <button key={c} className={`s2-nav-link ${filterCat===c&&shopView==='shop'?'s2-nav-active':''}`}
                onClick={() => { setShopView('shop'); setFilterCat(c); }}>
                {c.toUpperCase()}
              </button>
            ))}
          </nav>
          <div className="s2-header-actions">
            <button className="s2-icon-btn" title="Search" aria-label="Search" onClick={() => document.getElementById('s2-search-input')?.focus()}>
              🔍
            </button>
            <button
              className={`s2-icon-btn ${shopView==='track'?'s2-icon-active':''}`}
              title="Track Order"
              aria-label="Track Order"
              onClick={() => { setShopView(shopView==='track'?'shop':'track'); setTrackedOrders(null); setTrackError(''); setTrackInput(''); }}
            >
              📦
            </button>
            <button className="s2-cart-icon-btn" title="Cart" aria-label="Cart" onClick={() => setShowCart(true)}>
              🛒
              {cartCount > 0 && <span className="s2-cart-count">{cartCount}</span>}
            </button>
          </div>
        </div>
        {shopView === 'shop' && (
          <div className="s2-search-bar">
            <input id="s2-search-input" className="s2-search-input" placeholder="Search products…"
              value={search} onChange={e => setSearch(e.target.value)} />
          </div>
        )}
      </header>

      {/* ── Track Order page ── */}
      {shopView === 'track' && (
        <main className="s2-main">
          <div className="s2-track-page">
            <h2 className="s2-track-title">Track Your Order</h2>
            <p className="s2-track-sub">Enter your Order ID or the mobile number you used while ordering.</p>
            <form className="s2-track-form" onSubmit={trackOrder}>
              <input className="s2-track-input"
                placeholder="e.g. WEB-20260612-0001 or 9747303943"
                value={trackInput} onChange={e => setTrackInput(e.target.value)} />
              <button type="submit" className="s2-track-submit">Track Order</button>
            </form>
            {trackError && <p className="s2-track-error">{trackError}</p>}
            {trackedOrders && trackedOrders.map(order => {
              const stepIdx = STATUS_STEPS.indexOf(order.status);
              const addr = formatAddress(order);
              return (
                <div key={order.id} className="s2-track-card">
                  <div className="s2-track-card-hdr">
                    <div>
                      <div className="s2-track-order-no">{order.orderNo}</div>
                      <div className="s2-track-date">{order.createdAt ? new Date(order.createdAt).toLocaleString('en-IN') : ''}</div>
                    </div>
                    <span className={`s2-status-badge s2-status-${order.status?.toLowerCase()}`}>
                      {STATUS_ICONS[order.status]} {STATUS_LABELS[order.status] || order.status}
                    </span>
                  </div>
                  {order.status !== 'CANCELLED' && (
                    <div className="s2-track-steps">
                      {STATUS_STEPS.map((s, i) => (
                        <React.Fragment key={s}>
                          <div className="s2-step">
                            <div className={`s2-step-dot ${i <= stepIdx ? 's2-step-done' : ''}`}>{i < stepIdx ? '✓' : i === stepIdx ? '●' : ''}</div>
                            <div className={`s2-step-lbl ${i <= stepIdx ? 's2-step-done' : ''}`}>{STATUS_LABELS[s]}</div>
                          </div>
                          {i < STATUS_STEPS.length - 1 && <div className={`s2-step-line ${i < stepIdx ? 's2-step-done' : ''}`} />}
                        </React.Fragment>
                      ))}
                    </div>
                  )}
                  <div className="s2-track-items">
                    {(order.items || []).map((item, idx) => (
                      <div key={idx} className="s2-track-item"><span>{item.productName} × {item.quantity}</span><span>₹{Number(item.lineTotal).toFixed(2)}</span></div>
                    ))}
                    <div className="s2-track-total"><span>Total</span><strong>₹{Number(order.totalAmount).toFixed(2)}</strong></div>
                  </div>
                  {addr && <div className="s2-track-addr"><b>Delivery:</b> {addr}</div>}
                </div>
              );
            })}
          </div>
        </main>
      )}

      {shopView === 'shop' && (<>
        {/* ── Hero banner ── */}
        {(() => {
          const bannerImg = shopInfo.bannerUrl ? `${BACKEND}${shopInfo.bannerUrl}` : null;
          return (
            <section className="s2-hero" style={bannerImg ? {
              backgroundImage: `url(${bannerImg})`,
              backgroundSize: 'cover',
              backgroundPosition: 'center',
              backgroundRepeat: 'no-repeat',
            } : {}}>
              <div className="s2-hero-overlay" style={bannerImg ? {background:'rgba(0,0,0,0.45)'} : {}}>
                <div className="s2-hero-content">
                  <p className="s2-hero-sub">Welcome to {shopName}</p>
                  <h1 className="s2-hero-title">{shopName}</h1>
                  <p className="s2-hero-tag">Shop the best — only at {shopName}</p>
                  <button className="s2-hero-btn" onClick={() => setFilterCat('')}>Shop All</button>
                </div>
              </div>
            </section>
          );
        })()}

        {/* ── Products section ── */}
        <main className="s2-main">
          <div className="s2-section-hdr">
            <h2 className="s2-section-title">
              {filterCat ? filterCat : search ? `Results for "${search}"` : 'All Products'}
            </h2>
            {(filterCat || search) && (
              <button className="s2-view-all" onClick={() => { setFilterCat(''); setSearch(''); }}>View all →</button>
            )}
          </div>

          {displaySource.length === 0
            ? <div className="s2-empty">
                No products found.{' '}
                <button className="s2-empty-link" onClick={() => { setFilterCat(''); setSearch(''); setShopPage(1); }}>Browse all →</button>
              </div>
            : <>
                <div className="s2-grid">
                  {pagedProducts.map(p => {
                    const urls = imgUrls(p);
                    const isNew = p.createdAt && (now - new Date(p.createdAt).getTime()) < 60 * 24 * 60 * 60 * 1000;
                    return (
                    <div key={p.id} className={`s2-card ${p.stockQty === 0 ? 's2-card-soldout' : ''}`}
                      onClick={() => { setDetailProduct(p); setDetailQty(1); setDetailImgIdx(0); setDetailColor(p.color?.split(',')[0]?.trim()||''); setDetailSize(p.size?.split(',')[0]?.trim()||''); window.scrollTo({top:0,behavior:'smooth'}); }}>
                      <div className="s2-card-img-wrap">
                        {p.stockQty === 0 && <div className="s2-sold-ribbon">Sold Out</div>}
                        {p.festiveOffer && p.stockQty > 0 && <div className="s2-new-badge" style={{background:'#dc2626'}}>🎉 Sale</div>}
                        {!p.festiveOffer && isNew && p.stockQty > 0 && <div className="s2-new-badge">NEW</div>}
                        {p.featured && <div className="s2-fav-badge">❤</div>}
                        {urls.length > 0
                          ? <img src={imgSrc(urls[0])} alt={p.name} className="s2-card-img"
                              onError={e => { e.currentTarget.style.display='none'; e.currentTarget.nextElementSibling.style.display='flex'; }} />
                          : null}
                        <div className="s2-card-placeholder" style={{display: urls.length > 0 ? 'none' : 'flex'}}><span>💎</span></div>
                        {p.stockQty > 0
                          ? <button className="s2-quick-add" onClick={e => { e.stopPropagation(); addToCart(p); }}>Add to Cart</button>
                          : <div className="s2-out-of-stock">Out of Stock</div>
                        }
                      </div>
                      <div className="s2-card-body">
                        <div className="s2-card-cat">{p.category}</div>
                        <div className="s2-card-name">{p.name}</div>
                        {p.description && <div className="s2-card-desc" style={{fontSize:11,color:'#6b7280',lineHeight:1.4,margin:'2px 0 4px',display:'-webkit-box',WebkitLineClamp:2,WebkitBoxOrient:'vertical',overflow:'hidden'}}>{p.description}</div>}
                        {variantLabel(p) && <div className="s2-card-meta">{variantLabel(p)}</div>}
                        <div style={{display:'flex',alignItems:'center',gap:8,flexWrap:'wrap'}}>
                          <div className={`s2-card-price ${p.stockQty === 0 ? 's2-price-soldout' : ''}`}>₹{Number(p.sellingPrice).toFixed(2)}</div>
                          {p.mrp && Number(p.mrp) > Number(p.sellingPrice) && (
                            <>
                              <div style={{fontSize:11,color:'#9ca3af',textDecoration:'line-through'}}>₹{Number(p.mrp).toFixed(0)}</div>
                              <div style={{fontSize:10,background:'#dcfce7',color:'#15803d',padding:'1px 6px',borderRadius:99,fontWeight:700}}>
                                {Math.round((Number(p.mrp)-Number(p.sellingPrice))/Number(p.mrp)*100)}% off
                              </div>
                            </>
                          )}
                        </div>
                      </div>
                    </div>
                    );
                  })}
                </div>

                {shopTotalPages > 1 && (
                  <div className="s2-pagination">
                    <button className="s2-pg-btn" disabled={shopPageSafe === 1}
                      onClick={() => { setShopPage(shopPageSafe - 1); window.scrollTo({top:0,behavior:'smooth'}); }}>
                      ← Prev
                    </button>
                    {Array.from({length: shopTotalPages}, (_, i) => i + 1).map(n => (
                      <button key={n}
                        className={`s2-pg-btn ${n === shopPageSafe ? 's2-pg-active' : ''}`}
                        onClick={() => { setShopPage(n); window.scrollTo({top:0,behavior:'smooth'}); }}>
                        {n}
                      </button>
                    ))}
                    <button className="s2-pg-btn" disabled={shopPageSafe === shopTotalPages}
                      onClick={() => { setShopPage(shopPageSafe + 1); window.scrollTo({top:0,behavior:'smooth'}); }}>
                      Next →
                    </button>
                    <span className="s2-pg-info">
                      Showing {(shopPageSafe-1)*SHOP_PAGE_SIZE+1}–{Math.min(shopPageSafe*SHOP_PAGE_SIZE, filtered.length)} of {filtered.length}
                    </span>
                  </div>
                )}
              </>
          }
        </main>

        {/* ── Features strip ── */}
        <div className="s2-features">
          {[
            { icon: '🚚', title: 'Free Delivery', sub: 'On orders above ₹999' },
            { icon: '💎', title: 'Authentic Products', sub: 'Guaranteed quality' },
            { icon: '🔄', title: 'Easy Returns', sub: '7-day return policy' },
            { icon: '📞', title: 'Customer Support', sub: 'WhatsApp us anytime' },
          ].map(f => (
            <div key={f.title} className="s2-feature">
              <span className="s2-feature-icon">{f.icon}</span>
              <div className="s2-feature-title">{f.title}</div>
              <div className="s2-feature-sub">{f.sub}</div>
            </div>
          ))}
        </div>
      </>)}

      {/* ── Cart Drawer ── */}
      {showCart && (
        <div className="s2-overlay" onClick={() => setShowCart(false)}>
          <div className="s2-drawer" onClick={e => e.stopPropagation()}>
            <div className="s2-drawer-hdr">
              <h3>Your Cart ({cartCount})</h3>
              <button className="s2-drawer-close" onClick={() => setShowCart(false)}>✕</button>
            </div>
            {cart.length === 0
              ? <div className="s2-cart-empty">Your cart is empty<br/><small>Add some items to get started!</small></div>
              : <>
                  <div className="s2-cart-items">
                    {cart.map(i => (
                      <div key={i.key} className="s2-cart-row">
                        {i.imageUrl
                          ? <img src={imgSrc(i.imageUrl.split(',')[0])} alt={i.name} className="s2-cart-thumb" />
                          : <div className="s2-cart-thumb-ph">💎</div>}
                        <div className="s2-cart-info">
                          <div className="s2-cart-name">{i.name}</div>
                          {(i.selectedColor || i.selectedSize) && (
                            <div className="s2-cart-variant">
                              {i.selectedColor && (
                                <span className="s2-cart-color-dot"
                                  style={{background: COLOR_CSS[i.selectedColor] || '#ccc',
                                    border: i.selectedColor==='White'?'1px solid #ddd':'none'}} />
                              )}
                              {[i.selectedColor, i.selectedSize].filter(Boolean).join(' · ')}
                            </div>
                          )}
                          <div className="s2-cart-price-each">₹{Number(i.price).toFixed(2)}</div>
                        </div>
                        <div className="s2-qty-wrap">
                          <button className="s2-qty-btn" onClick={() => updateCartQty(i.key, -1)}>−</button>
                          <span className="s2-qty-num">{i.qty}</span>
                          <button className="s2-qty-btn" onClick={() => updateCartQty(i.key, 1)}>+</button>
                        </div>
                        <div className="s2-cart-line">₹{(Number(i.price) * i.qty).toFixed(2)}</div>
                      </div>
                    ))}
                  </div>
                  <div className="s2-cart-footer">
                    <div className="s2-cart-subtotal"><span>Subtotal</span><strong>₹{cartTotal.toFixed(2)}</strong></div>
                    <button className="s2-checkout-btn" onClick={() => { setShowCart(false); setCheckout(true); }}>
                      Proceed to Checkout →
                    </button>
                  </div>
                </>
            }
          </div>
        </div>
      )}

      {/* ── Checkout Modal ── */}
      {checkout && (
        <div className="s2-overlay s2-center-overlay" onClick={() => setCheckout(false)}>
          <div className="s2-checkout-modal" onClick={e => e.stopPropagation()}>
            <div className="s2-drawer-hdr">
              <h3>Checkout</h3>
              <button className="s2-drawer-close" onClick={() => setCheckout(false)}>✕</button>
            </div>
            <form onSubmit={placeOrder} className="s2-checkout-form">
              <div className="s2-form-group">
                <label>Full Name *</label>
                <input placeholder="Your full name" value={orderForm.name} onChange={e => setOrderForm({...orderForm, name: e.target.value})} />
              </div>
              <div className="s2-form-group">
                <label>Phone Number *</label>
                <input type="tel" inputMode="numeric" maxLength={10} placeholder="10-digit mobile number"
                  value={orderForm.phone}
                  onChange={e => setOrderForm({...orderForm, phone: e.target.value.replace(/\D/g, '').slice(0, 10)})} />
              </div>
              <div className="s2-addr-section">
                <div className="s2-addr-title">Delivery Address *</div>
                <input placeholder="House / Flat / Building No. *" value={orderForm.houseNo} onChange={e => setOrderForm({...orderForm, houseNo: e.target.value})} required />
                <input placeholder="Street / Area / Locality *" value={orderForm.street} onChange={e => setOrderForm({...orderForm, street: e.target.value})} required />
                <div className="s2-form-row">
                  <input placeholder="City *" value={orderForm.city} onChange={e => setOrderForm({...orderForm, city: e.target.value})} required />
                  <input placeholder="PIN Code *" value={orderForm.pincode} onChange={e => setOrderForm({...orderForm, pincode: e.target.value})} required />
                </div>
                <select value={orderForm.state} onChange={e => setOrderForm({...orderForm, state: e.target.value})} required>
                  <option value="">Select State *</option>
                  {INDIA_STATES.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
              <div className="s2-order-summary">
                <div className="s2-summary-title">Order Summary</div>
                {cart.map(i => (
                  <div key={i.barcode} className="s2-summary-row">
                    <span>{i.name} × {i.qty}</span><span>₹{(Number(i.price)*i.qty).toFixed(2)}</span>
                  </div>
                ))}
                <div className="s2-summary-total"><span>Total</span><strong>₹{cartTotal.toFixed(2)}</strong></div>
              </div>
              {orderError && <p className="s2-form-error">{orderError}</p>}
              <button type="submit" className="s2-place-btn">Place Order</button>
            </form>
          </div>
        </div>
      )}

      {/* ── PDF / Digital Products Section ── */}
      {digitalProducts.length > 0 && (
        <section style={{padding:'56px 5%',background:'#f8faff',borderTop:'1px solid #e5e7eb'}}>
          <div style={{maxWidth:1100,margin:'0 auto'}}>
            <div style={{textAlign:'center',marginBottom:36}}>
              <div style={{display:'inline-flex',alignItems:'center',gap:8,background:'#EFF6FF',border:'1px solid #BFDBFE',padding:'6px 16px',borderRadius:20,fontSize:13,fontWeight:700,color:'#1D4ED8',marginBottom:14}}>
                📚 Digital Downloads
              </div>
              <h2 style={{fontSize:'clamp(22px,3vw,32px)',fontWeight:900,color:'#1f2937',margin:'0 0 10px'}}>Books & Class Notes</h2>
              <p style={{fontSize:15,color:'#6b7280',maxWidth:480,margin:'0 auto'}}>Purchase and receive PDF documents instantly in your email inbox.</p>
            </div>

            <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(240px,1fr))',gap:20}}>
              {digitalProducts.map(dp => (
                <div key={dp.id} style={{background:'#fff',border:'1.5px solid #e5e7eb',borderRadius:14,overflow:'hidden',boxShadow:'0 2px 12px rgba(0,0,0,0.06)',transition:'transform 0.2s,box-shadow 0.2s'}}
                  onMouseEnter={e=>{e.currentTarget.style.transform='translateY(-3px)';e.currentTarget.style.boxShadow='0 8px 24px rgba(0,0,0,0.1)';}}
                  onMouseLeave={e=>{e.currentTarget.style.transform='';e.currentTarget.style.boxShadow='0 2px 12px rgba(0,0,0,0.06)';}}>
                  {/* Cover */}
                  <div style={{background:'linear-gradient(135deg,#1E3A5F,#2d5a8e)',padding:'28px 20px',textAlign:'center',position:'relative'}}>
                    <div style={{fontSize:52}}>{dp.coverEmoji || '📄'}</div>
                    {dp.passwordProtected && (
                      <div style={{position:'absolute',top:10,right:10,background:'rgba(255,255,255,0.15)',borderRadius:8,padding:'4px 8px',fontSize:11,color:'#fff',fontWeight:600}}>🔑 Protected</div>
                    )}
                  </div>
                  {/* Info */}
                  <div style={{padding:'16px'}}>
                    <div style={{fontWeight:800,fontSize:15,color:'#1f2937',marginBottom:6,lineHeight:1.3}}>{dp.title}</div>
                    <div style={{fontSize:12,color:'#6b7280',marginBottom:14,lineHeight:1.5,minHeight:36}}>{dp.description || ''}</div>
                    <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',gap:8}}>
                      <div style={{fontWeight:900,fontSize:20,color:'#16a34a'}}>₹{Number(dp.price).toLocaleString('en-IN')}</div>
                      <button onClick={() => { setPdfBuyModal(dp); setPdfForm({name:'',email:'',address:'',phone:''}); setPdfSuccess(null); }}
                        style={{background:'#1E3A5F',color:'#fff',border:'none',borderRadius:8,padding:'9px 16px',fontSize:13,fontWeight:700,cursor:'pointer'}}>
                        Buy Now →
                      </button>
                    </div>
                    <div style={{marginTop:10,fontSize:11,color:'#9ca3af',display:'flex',alignItems:'center',gap:4}}>
                      <span>📧</span> Delivered to your email instantly
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* ── PDF Buy Modal ── */}
      {pdfBuyModal && !pdfSuccess && (
        <div className="s2-modal-overlay" onClick={() => { setPdfBuyModal(null); setPdfPaying(false); }}>
          <div className="s2-modal-box" style={{maxWidth:420}} onClick={e => e.stopPropagation()}>
            <div style={{textAlign:'center',marginBottom:20}}>
              <div style={{fontSize:40,marginBottom:8}}>{pdfBuyModal.coverEmoji || '📄'}</div>
              <div style={{fontWeight:800,fontSize:17,color:'#1f2937'}}>{pdfBuyModal.title}</div>
              <div style={{fontSize:13,color:'#6b7280',marginTop:4}}>{pdfBuyModal.description}</div>
              <div style={{fontWeight:900,fontSize:22,color:'#16a34a',marginTop:10}}>₹{Number(pdfBuyModal.price).toLocaleString('en-IN')}</div>
            </div>

            <div style={{background:'#f0f7ff',border:'1px solid #bfdbfe',borderRadius:10,padding:'12px 16px',marginBottom:18,fontSize:13,color:'#1d4ed8'}}>
              📧 The PDF will be delivered to your email after payment. Make sure your email is correct.
            </div>

            <div style={{marginBottom:12}}>
              <label style={{display:'block',fontSize:13,fontWeight:600,color:'#374151',marginBottom:5}}>Full Name *</label>
              <input value={pdfForm.name} onChange={e => setPdfForm(f => ({...f, name: e.target.value}))}
                placeholder="Your full name"
                style={{width:'100%',padding:'10px 12px',border:'1.5px solid #d1d5db',borderRadius:8,fontSize:14,boxSizing:'border-box',outline:'none'}}
                onFocus={e=>e.target.style.borderColor='#1E3A5F'} onBlur={e=>e.target.style.borderColor='#d1d5db'} />
            </div>
            <div style={{marginBottom:12}}>
              <label style={{display:'block',fontSize:13,fontWeight:600,color:'#374151',marginBottom:5}}>Email Address * <span style={{color:'#dc2626'}}>(PDF will be sent here)</span></label>
              <input type="email" value={pdfForm.email} onChange={e => setPdfForm(f => ({...f, email: e.target.value}))}
                placeholder="yourname@gmail.com"
                style={{width:'100%',padding:'10px 12px',border:'1.5px solid #d1d5db',borderRadius:8,fontSize:14,boxSizing:'border-box',outline:'none'}}
                onFocus={e=>e.target.style.borderColor='#1E3A5F'} onBlur={e=>e.target.style.borderColor='#d1d5db'} />
            </div>
            <div style={{marginBottom:12}}>
              <label style={{display:'block',fontSize:13,fontWeight:600,color:'#374151',marginBottom:5}}>Phone Number</label>
              <input type="tel" value={pdfForm.phone} onChange={e => setPdfForm(f => ({...f, phone: e.target.value}))}
                placeholder="e.g. 9876543210"
                style={{width:'100%',padding:'10px 12px',border:'1.5px solid #d1d5db',borderRadius:8,fontSize:14,boxSizing:'border-box',outline:'none'}}
                onFocus={e=>e.target.style.borderColor='#1E3A5F'} onBlur={e=>e.target.style.borderColor='#d1d5db'} />
            </div>
            <div style={{marginBottom:20}}>
              <label style={{display:'block',fontSize:13,fontWeight:600,color:'#374151',marginBottom:5}}>Delivery Address</label>
              <textarea value={pdfForm.address} onChange={e => setPdfForm(f => ({...f, address: e.target.value}))}
                placeholder={'Street, City, State - Pincode'}
                rows={3}
                style={{width:'100%',padding:'10px 12px',border:'1.5px solid #d1d5db',borderRadius:8,fontSize:14,boxSizing:'border-box',outline:'none',resize:'vertical',fontFamily:'inherit'}}
                onFocus={e=>e.target.style.borderColor='#1E3A5F'} onBlur={e=>e.target.style.borderColor='#d1d5db'} />
            </div>

            <button
              disabled={pdfPaying || !pdfForm.email || !pdfForm.name}
              onClick={async () => {
                if (!pdfForm.email || !pdfForm.name) return;
                setPdfPaying(true);
                try {
                  const sub = getSubdomain();
                  // Create order
                  const orderRes = await axios.post(`${API}/public/digital/orders`, {
                    subdomain: sub, productId: pdfBuyModal.id,
                    customerEmail: pdfForm.email, customerName: pdfForm.name,
                    deliveryAddress: pdfForm.address || null,
                    deliveryPhone: pdfForm.phone || null,
                  });
                  const orderId = orderRes.data.id;

                  // Create Razorpay order — on the shop's own connected Razorpay account
                  const rzpOrderRes = await axios.post(`${API}/public/payment/create-order`, {
                    subdomain: sub, amount: Number(pdfBuyModal.price),
                  });

                  const rzpOptions = {
                    key: rzpOrderRes.data.keyId,
                    amount: rzpOrderRes.data.amount,
                    currency: 'INR',
                    name: shopInfo.name || shopName,
                    description: pdfBuyModal.title,
                    order_id: rzpOrderRes.data.razorpayOrderId,
                    prefill: { name: pdfForm.name, email: pdfForm.email },
                    theme: { color: '#1E3A5F' },
                    handler: async (resp) => {
                      await axios.post(`${API}/public/digital/orders/${orderId}/confirm`, {
                        razorpayPaymentId: resp.razorpay_payment_id,
                        razorpayOrderId: resp.razorpay_order_id,
                        razorpaySignature: resp.razorpay_signature,
                      });
                      setPdfBuyModal(null);
                      setPdfSuccess(pdfForm.email);
                      setPdfPaying(false);
                    },
                  };
                  const rzp = new window.Razorpay(rzpOptions);
                  rzp.on('payment.failed', () => { setPdfPaying(false); alert('Payment failed. Please try again.'); });
                  rzp.open();
                } catch (err) { setPdfPaying(false); alert(err.response?.data?.error || 'Something went wrong. Please try again.'); }
              }}
              style={{width:'100%',padding:'13px',background:pdfPaying||!pdfForm.email||!pdfForm.name?'#9ca3af':'#1E3A5F',color:'#fff',border:'none',borderRadius:10,fontSize:15,fontWeight:700,cursor:pdfPaying?'wait':'pointer'}}>
              {pdfPaying ? 'Opening Payment…' : `Pay ₹${Number(pdfBuyModal.price).toLocaleString('en-IN')} & Get PDF`}
            </button>
          </div>
        </div>
      )}

      {/* ── PDF Success Modal ── */}
      {pdfSuccess && (
        <div className="s2-modal-overlay" onClick={() => setPdfSuccess(null)}>
          <div className="s2-modal-box" style={{maxWidth:380,textAlign:'center'}} onClick={e => e.stopPropagation()}>
            <div style={{fontSize:56,marginBottom:12}}>🎉</div>
            <h3 style={{margin:'0 0 8px',fontSize:20,color:'#1f2937'}}>Payment Successful!</h3>
            <p style={{color:'#6b7280',fontSize:14,lineHeight:1.6,margin:'0 0 16px'}}>
              Your PDF has been sent to<br />
              <strong style={{color:'#1E3A5F'}}>{pdfSuccess}</strong>
            </p>
            <div style={{background:'#f0fdf4',border:'1px solid #bbf7d0',borderRadius:10,padding:'12px 16px',marginBottom:20,fontSize:13,color:'#166534'}}>
              📥 Check your inbox (and spam folder if not visible within 5 minutes).
            </div>
            <button onClick={() => setPdfSuccess(null)} style={{background:'#1E3A5F',color:'#fff',border:'none',borderRadius:9,padding:'11px 24px',fontSize:14,fontWeight:700,cursor:'pointer'}}>Done</button>
          </div>
        </div>
      )}

      {/* ── Footer ── */}
      <footer className="s2-footer">
        <div className="s2-footer-inner">
          <div className="s2-footer-brand">
            <img src={shopLogoSrc} alt={shopName} className="s2-footer-logo" onError={e=>{e.currentTarget.onerror=null;e.currentTarget.src='/logo.png';}} />
            <div>
              <div className="s2-footer-name">{shopName}</div>
            </div>
          </div>
          <div className="s2-footer-links">
            <div className="s2-footer-col">
              <div className="s2-footer-col-title">Shop</div>
              {cats.slice(0,5).map(c => <button key={c} className="s2-footer-link" onClick={() => { setFilterCat(c); setShopView('shop'); window.scrollTo(0,0); }}>{c}</button>)}
            </div>
            <div className="s2-footer-col">
              <div className="s2-footer-col-title">Help</div>
              <button className="s2-footer-link" onClick={() => setShopView('track')}>Track Order</button>
              {shopInfo.phoneNumber
                ? <a className="s2-footer-link" href={`https://wa.me/91${shopInfo.phoneNumber.replace(/\D/g,'')}`} target="_blank" rel="noopener noreferrer">WhatsApp Support</a>
                : <span className="s2-footer-link" style={{opacity:0.5,cursor:'default'}} title="Shop hasn't set up a WhatsApp contact number yet">WhatsApp Support</span>
              }
            </div>
          </div>
        </div>
        <div className="s2-footer-bottom">© {new Date().getFullYear()} {shopName} · All rights reserved</div>
      </footer>
    </div>
  );
}

// ─── Super Admin App ───────────────────────────────────────────────────────
/* ── SVG Bar Chart ── */
function SaBarChart({ data, color = '#1E3A5F', height = 140 }) {
  const max = Math.max(...data.map(d => d.v), 1);
  const n = data.length;
  const bw = 100 / n;
  return (
    <svg viewBox={`0 0 100 ${height}`} style={{width:'100%',height,display:'block'}}>
      {data.map((d, i) => {
        const barH = Math.max((d.v / max) * (height - 28), d.v > 0 ? 4 : 0);
        const x = i * bw + bw * 0.18;
        const w = bw * 0.64;
        const y = height - 22 - barH;
        return (
          <g key={i}>
            <rect x={x} y={y} width={w} height={barH} fill={color} rx={1.5} opacity={0.85} />
            {d.v > 0 && <text x={x+w/2} y={y-2} textAnchor="middle" fontSize={5.5} fill="#374151" fontFamily="Arial">{d.v}</text>}
            <text x={x+w/2} y={height-6} textAnchor="middle" fontSize={4.8} fill="#9CA3AF" fontFamily="Arial">{d.l}</text>
          </g>
        );
      })}
      <line x1={0} y1={height-22} x2={100} y2={height-22} stroke="#E5E7EB" strokeWidth={0.3} />
    </svg>
  );
}

/* ── SVG Donut Chart ── */
function SaDonut({ segments, size = 130 }) {
  const total = segments.reduce((s, x) => s + x.v, 0) || 1;
  const cx = 60, cy = 60, r = 42, ir = 26;
  let angle = -90;
  const toXY = (a, radius) => ({
    x: cx + radius * Math.cos((a * Math.PI) / 180),
    y: cy + radius * Math.sin((a * Math.PI) / 180),
  });
  const arcs = segments.map(seg => {
    const sweep = (seg.v / total) * 360;
    const a1 = angle, a2 = angle + sweep - 0.5;
    angle += sweep;
    if (sweep < 0.1) return null;
    const s = toXY(a1, r), e = toXY(a2, r), si = toXY(a1, ir), ei = toXY(a2, ir);
    const lg = sweep > 180 ? 1 : 0;
    return { ...seg, d: `M${s.x},${s.y} A${r},${r} 0 ${lg} 1 ${e.x},${e.y} L${ei.x},${ei.y} A${ir},${ir} 0 ${lg} 0 ${si.x},${si.y} Z` };
  }).filter(Boolean);
  return (
    <svg viewBox="0 0 120 120" style={{width:size,height:size}}>
      {arcs.map((a,i) => <path key={i} d={a.d} fill={a.c} />)}
      <text x={cx} y={cy+4} textAnchor="middle" fontSize={11} fontWeight="bold" fill="#1f2937" fontFamily="Arial">{total}</text>
      <text x={cx} y={cy+13} textAnchor="middle" fontSize={6} fill="#6b7280" fontFamily="Arial">Total</text>
    </svg>
  );
}

function SuperAdminApp() {
  const [token, setToken] = useState(() => localStorage.getItem('gosuas_sa_token') || '');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showAdminPw, setShowAdminPw] = useState(false);
  const [loginErr, setLoginErr] = useState('');
  const [stats, setStats] = useState(null);
  const [tenants, setTenants] = useState([]);
  const [editPlan, setEditPlan] = useState(null);
  const [saving, setSaving] = useState(false);
  const [activePage, setActivePage] = useState('dashboard');
  const [reportRange, setReportRange] = useState('7d'); // 'today' | '7d' | 'month' | '12m'

  const saHeaders = () => ({ Authorization: `Bearer ${token}` });

  const doLogin = async (e) => {
    e.preventDefault(); setLoginErr('');
    try {
      const res = await axios.post(`${API}/auth/login`, { email, password, subdomain: 'admin' });
      localStorage.setItem('gosuas_sa_token', res.data.token);
      setToken(res.data.token);
    } catch { setLoginErr('Invalid credentials'); }
  };

  const loadData = async () => {
    try {
      const [s, tl] = await Promise.all([
        axios.get(`${API}/superadmin/stats`, { headers: saHeaders() }),
        axios.get(`${API}/superadmin/tenants`, { headers: saHeaders() }),
      ]);
      setStats(s.data); setTenants(tl.data);
    } catch { setToken(''); localStorage.removeItem('gosuas_sa_token'); }
  };

  useEffect(() => { if (token) loadData(); }, [token]);

  const savePlan = async () => {
    if (!editPlan) return; setSaving(true);
    try {
      await axios.put(`${API}/superadmin/tenants/${editPlan.id}/plan`,
        { plan: editPlan.plan, status: editPlan.status }, { headers: saHeaders() });
      setEditPlan(null); loadData();
    } catch { alert('Save failed'); }
    finally { setSaving(false); }
  };

  if (!token) return (
    <div style={{minHeight:'100vh',display:'flex',margin:0,padding:0,fontFamily:'Inter,system-ui,sans-serif'}}>
      {/* ── Left: animated slider panel ── */}
      <div style={{flex:1,background:'linear-gradient(145deg,#0A1628 0%,#1E3A5F 55%,#0D2240 100%)',display:'flex',flexDirection:'column',position:'relative',overflow:'hidden'}}>
        {/* Orbs */}
        <div style={{position:'absolute',width:480,height:480,borderRadius:'50%',background:'rgba(245,151,30,0.12)',filter:'blur(100px)',top:-140,right:-80,pointerEvents:'none'}} />
        <div style={{position:'absolute',width:280,height:280,borderRadius:'50%',background:'rgba(99,102,241,0.13)',filter:'blur(80px)',bottom:-70,left:-50,pointerEvents:'none'}} />
        {/* Grid decoration */}
        <svg style={{position:'absolute',bottom:0,right:0,opacity:0.05,pointerEvents:'none'}} width="300" height="300" viewBox="0 0 300 300">
          {[0,1,2,3,4,5,6,7].map(i=><g key={i}><line x1={i*40} y1="0" x2={i*40} y2="300" stroke="#fff" strokeWidth="1"/><line x1="0" y1={i*40} x2="300" y2={i*40} stroke="#fff" strokeWidth="1"/></g>)}
        </svg>

        {/* Brand header */}
        <div style={{display:'flex',alignItems:'center',gap:12,padding:'28px 36px',position:'relative',zIndex:1}}>
          <div style={{width:36,height:36,borderRadius:9,background:'rgba(245,151,30,0.18)',border:'1.5px solid rgba(245,151,30,0.35)',display:'flex',alignItems:'center',justifyContent:'center',fontSize:18}}>🏪</div>
          <span style={{fontSize:16,fontWeight:800,color:'#fff',letterSpacing:'-0.3px'}}>theshopclaude</span>
          <span style={{fontSize:11,fontWeight:600,color:'rgba(245,151,30,0.8)',background:'rgba(245,151,30,0.12)',border:'1px solid rgba(245,151,30,0.25)',padding:'3px 8px',borderRadius:12,marginLeft:4}}>ADMIN</span>
        </div>

        {/* Slider */}
        <div style={{flex:1,position:'relative',zIndex:1}}>
          <LoginSlider slides={ADMIN_SLIDES} />
        </div>
      </div>

      {/* ── Right: login form ── */}
      <div style={{width:460,background:'#fff',display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',padding:'60px 52px'}}>
        <div style={{width:'100%',maxWidth:340}}>
          <div style={{marginBottom:36}}>
            <div style={{fontSize:26,fontWeight:800,color:'#0f172a',letterSpacing:'-0.5px',marginBottom:8}}>Admin Sign In</div>
            <div style={{fontSize:14,color:'#6b7280'}}>Super admin access only</div>
          </div>

          <form onSubmit={doLogin}>
            <div style={{marginBottom:16}}>
              <label style={{display:'block',fontSize:13,fontWeight:600,color:'#374151',marginBottom:6}}>Email</label>
              <input value={email} onChange={e=>setEmail(e.target.value)} type="email" required
                placeholder="owner@theshopclaude.com"
                style={{display:'block',width:'100%',padding:'12px 14px',border:'1.5px solid #e5e7eb',borderRadius:10,fontSize:14,boxSizing:'border-box',outline:'none',color:'#111'}}
                onFocus={e=>e.target.style.borderColor='#1E3A5F'} onBlur={e=>e.target.style.borderColor='#e5e7eb'} />
            </div>
            <div style={{marginBottom:24}}>
              <label style={{display:'block',fontSize:13,fontWeight:600,color:'#374151',marginBottom:6}}>Password</label>
              <div style={{position:'relative'}}>
                <input value={password} onChange={e=>setPassword(e.target.value)} type={showAdminPw?'text':'password'} required
                  placeholder="••••••••••"
                  style={{display:'block',width:'100%',padding:'12px 44px 12px 14px',border:'1.5px solid #e5e7eb',borderRadius:10,fontSize:14,boxSizing:'border-box',outline:'none',color:'#111'}}
                  onFocus={e=>e.target.style.borderColor='#1E3A5F'} onBlur={e=>e.target.style.borderColor='#e5e7eb'} />
                <button type="button" onClick={()=>setShowAdminPw(p=>!p)}
                  style={{position:'absolute',right:12,top:'50%',transform:'translateY(-50%)',background:'none',border:'none',cursor:'pointer',fontSize:18,color:'#9ca3af',lineHeight:1,padding:0}}>
                  {showAdminPw?'🙈':'👁️'}
                </button>
              </div>
            </div>
            {loginErr && <div style={{marginBottom:16,padding:'10px 14px',background:'#fef2f2',border:'1px solid #fecaca',borderRadius:8,fontSize:13,color:'#dc2626',fontWeight:600}}>{loginErr}</div>}
            <button type="submit"
              style={{width:'100%',padding:'13px',background:'#1E3A5F',color:'#fff',border:'none',borderRadius:10,fontSize:15,fontWeight:700,cursor:'pointer',letterSpacing:'0.2px'}}>
              Sign In →
            </button>
          </form>
        </div>
      </div>
    </div>
  );

  /* ── Analytics computed from tenants ── */
  const now = new Date();
  const todayStr  = now.toISOString().slice(0, 10);
  const monthStr  = now.toISOString().slice(0, 7);
  const d7ago     = new Date(now - 7 * 86400000).toISOString().slice(0, 10);

  const activeCount   = tenants.filter(t => t.status === 'ACTIVE').length;
  const inactiveCount = tenants.filter(t => t.status !== 'ACTIVE').length;
  const paidTenants   = tenants.filter(t => t.status === 'ACTIVE' && (t.plan === 'STARTER' || t.plan === 'PRO'));
  const monthlyRevenue = paidTenants.reduce((s, t) => s + (t.plan === 'PRO' ? 2499 : 999), 0);

  const onboardedToday = tenants.filter(t => t.createdAt?.slice(0,10) === todayStr).length;
  const onboarded7d    = tenants.filter(t => t.createdAt?.slice(0,10) >= d7ago).length;
  const onboardedMonth = tenants.filter(t => t.createdAt?.slice(0,7) === monthStr).length;

  /* Bar chart data helpers */
  const getLast7DaysData = () => {
    return Array.from({length:7}, (_, i) => {
      const d = new Date(now - (6-i)*86400000);
      const ds = d.toISOString().slice(0,10);
      const label = d.toLocaleDateString('en-IN',{weekday:'short'}).slice(0,3);
      return { l: label, v: tenants.filter(t=>t.createdAt?.slice(0,10)===ds).length };
    });
  };

  const getLast12MonthsData = () => {
    return Array.from({length:12}, (_, i) => {
      const d = new Date(now.getFullYear(), now.getMonth() - (11-i), 1);
      const ms = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
      const label = d.toLocaleDateString('en-IN',{month:'short'});
      return { l: label, v: tenants.filter(t=>t.createdAt?.slice(0,7)===ms).length };
    });
  };

  const getTodayHoursData = () => {
    return Array.from({length:8}, (_, i) => {
      const hour = i * 3;
      const label = `${hour}h`;
      const count = tenants.filter(t => {
        if (!t.createdAt?.startsWith(todayStr)) return false;
        const h = new Date(t.createdAt).getHours();
        return h >= hour && h < hour + 3;
      }).length;
      return { l: label, v: count };
    });
  };

  const getMonthDaysData = () => {
    const daysInMonth = new Date(now.getFullYear(), now.getMonth()+1, 0).getDate();
    const step = Math.ceil(daysInMonth / 10);
    return Array.from({length: Math.ceil(daysInMonth/step)}, (_, i) => {
      const dayStart = i*step+1, dayEnd = Math.min((i+1)*step, daysInMonth);
      const label = `${dayStart}`;
      const count = tenants.filter(t => {
        if (!t.createdAt?.startsWith(monthStr)) return false;
        const day = new Date(t.createdAt).getDate();
        return day >= dayStart && day <= dayEnd;
      }).length;
      return { l: label, v: count };
    });
  };

  const chartData = reportRange==='today' ? getTodayHoursData()
                  : reportRange==='7d'    ? getLast7DaysData()
                  : reportRange==='month' ? getMonthDaysData()
                  : getLast12MonthsData();

  const planColors  = { FREE:'#6b7280', STARTER:'#3b82f6', PRO:'#8b5cf6', TRIAL:'#f97316' };
  const NAV = [
    { id:'dashboard', icon:'📊', label:'Dashboard' },
    { id:'reports',   icon:'📈', label:'Reports & Analytics' },
    { id:'tenants',   icon:'🏬', label:'All Tenants' },
  ];

  return (
    <div style={{display:'flex',minHeight:'100vh',background:'#f3f4f6'}}>

      {/* ── Sidebar ── */}
      <aside style={{width:220,background:'#1E3A5F',display:'flex',flexDirection:'column',flexShrink:0}}>
        <div style={{padding:'24px 20px 20px',borderBottom:'1px solid rgba(255,255,255,0.1)'}}>
          <div style={{display:'flex',alignItems:'center',gap:10}}>
            <img src="/logo.png" alt="logo" style={{width:36,height:36,objectFit:'contain',borderRadius:6}} />
            <div>
              <div style={{fontSize:13,fontWeight:700,color:'#fff',lineHeight:1.2}}>ShopClaude</div>
              <div style={{fontSize:10,color:'rgba(255,255,255,0.5)'}}>Super Admin</div>
            </div>
          </div>
        </div>
        <nav style={{flex:1,padding:'16px 10px'}}>
          {NAV.map(n => (
            <button key={n.id} onClick={()=>setActivePage(n.id)} style={{
              display:'flex',alignItems:'center',gap:10,width:'100%',padding:'10px 12px',
              background: activePage===n.id ? 'rgba(255,255,255,0.15)' : 'transparent',
              border:'none',borderRadius:8,cursor:'pointer',marginBottom:4,
              color: activePage===n.id ? '#fff' : 'rgba(255,255,255,0.6)',
              fontSize:13,fontWeight: activePage===n.id ? 700 : 400,textAlign:'left',
              transition:'all 0.15s'
            }}>
              <span style={{fontSize:16}}>{n.icon}</span>{n.label}
            </button>
          ))}
        </nav>
        <div style={{padding:'16px 10px',borderTop:'1px solid rgba(255,255,255,0.1)'}}>
          <button onClick={()=>{localStorage.removeItem('gosuas_sa_token');setToken('');}} style={{
            display:'flex',alignItems:'center',gap:8,width:'100%',padding:'9px 12px',
            background:'transparent',border:'1px solid rgba(255,255,255,0.2)',borderRadius:8,
            cursor:'pointer',color:'rgba(255,255,255,0.6)',fontSize:13
          }}>
            🚪 Logout
          </button>
        </div>
      </aside>

      {/* ── Main ── */}
      <div style={{flex:1,display:'flex',flexDirection:'column',minWidth:0}}>
        <header style={{background:'#fff',borderBottom:'1px solid #e5e7eb',padding:'0 28px',height:52,display:'flex',alignItems:'center',justifyContent:'space-between',flexShrink:0}}>
          <div style={{fontSize:16,fontWeight:700,color:'#1f2937'}}>
            {NAV.find(n=>n.id===activePage)?.icon} {NAV.find(n=>n.id===activePage)?.label}
          </div>
          <button onClick={loadData} style={{background:'#f3f4f6',border:'1px solid #e5e7eb',borderRadius:6,padding:'5px 14px',cursor:'pointer',fontSize:13,color:'#374151'}}>
            ↻ Refresh
          </button>
        </header>

        <div style={{flex:1,overflowY:'auto',padding:24}}>

          {/* ══ DASHBOARD ══ */}
          {activePage==='dashboard' && (
            <div>
              <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(160px,1fr))',gap:16,marginBottom:24}}>
                {[
                  {label:'Total Shops',   val: tenants.length,    color:'#1E3A5F', icon:'🏬'},
                  {label:'Active',        val: activeCount,        color:'#16a34a', icon:'✅'},
                  {label:'Inactive',      val: inactiveCount,      color:'#dc2626', icon:'❌'},
                  {label:'STARTER',       val: stats?.starterPlan??0, color:'#3b82f6', icon:'⭐'},
                  {label:'PRO',           val: stats?.proPlan??0,     color:'#8b5cf6', icon:'💎'},
                  {label:'Monthly MRR',   val:`₹${monthlyRevenue.toLocaleString('en-IN')}`, color:'#F5971E', icon:'💰'},
                ].map(c => (
                  <div key={c.label} style={{background:'#fff',borderRadius:10,padding:'18px 20px',border:'1.5px solid #e5e7eb',boxShadow:'0 1px 4px rgba(0,0,0,0.04)'}}>
                    <div style={{fontSize:22,marginBottom:4}}>{c.icon}</div>
                    <div style={{fontSize:26,fontWeight:800,color:c.color}}>{c.val}</div>
                    <div style={{fontSize:12,color:'#6b7280',marginTop:2,fontWeight:600}}>{c.label}</div>
                  </div>
                ))}
              </div>

              {/* Quick onboarding summary */}
              <div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:16,marginBottom:24}}>
                {[
                  {label:'Joined Today',      val: onboardedToday, color:'#1E3A5F'},
                  {label:'Last 7 Days',        val: onboarded7d,    color:'#3b82f6'},
                  {label:'This Month',         val: onboardedMonth,  color:'#8b5cf6'},
                ].map(c => (
                  <div key={c.label} style={{background:'#fff',borderRadius:10,padding:'16px 20px',border:'1.5px solid #e5e7eb',display:'flex',alignItems:'center',gap:16}}>
                    <div style={{width:48,height:48,borderRadius:12,background:c.color+'18',display:'flex',alignItems:'center',justifyContent:'center',fontSize:22}}>🏪</div>
                    <div>
                      <div style={{fontSize:22,fontWeight:800,color:c.color}}>{c.val}</div>
                      <div style={{fontSize:12,color:'#6b7280',fontWeight:600}}>{c.label}</div>
                    </div>
                  </div>
                ))}
              </div>

              {/* Last 7 days bar + plan donut */}
              <div style={{display:'grid',gridTemplateColumns:'1fr 300px',gap:16}}>
                <div style={{background:'#fff',borderRadius:10,padding:'20px',border:'1.5px solid #e5e7eb'}}>
                  <div style={{fontSize:14,fontWeight:700,color:'#1f2937',marginBottom:16}}>Shops Onboarded — Last 7 Days</div>
                  <SaBarChart data={getLast7DaysData()} color='#1E3A5F' height={130} />
                </div>
                <div style={{background:'#fff',borderRadius:10,padding:'20px',border:'1.5px solid #e5e7eb'}}>
                  <div style={{fontSize:14,fontWeight:700,color:'#1f2937',marginBottom:12}}>Plan Distribution</div>
                  <div style={{display:'flex',flexDirection:'column',alignItems:'center'}}>
                    <SaDonut segments={[
                      {l:'FREE',    v:stats?.freePlan??0,    c:'#6b7280'},
                      {l:'STARTER', v:stats?.starterPlan??0, c:'#3b82f6'},
                      {l:'PRO',     v:stats?.proPlan??0,     c:'#8b5cf6'},
                    ]} size={120} />
                    <div style={{display:'flex',gap:12,marginTop:12,flexWrap:'wrap',justifyContent:'center'}}>
                      {[['FREE','#6b7280',stats?.freePlan],['STARTER','#3b82f6',stats?.starterPlan],['PRO','#8b5cf6',stats?.proPlan]].map(([l,c,v])=>(
                        <div key={l} style={{display:'flex',alignItems:'center',gap:4,fontSize:12}}>
                          <div style={{width:10,height:10,borderRadius:2,background:c}} />
                          <span style={{color:'#6b7280'}}>{l}: <strong style={{color:'#1f2937'}}>{v??0}</strong></span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ══ REPORTS & ANALYTICS ══ */}
          {activePage==='reports' && (
            <div>
              {/* KPI Cards */}
              <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(200px,1fr))',gap:16,marginBottom:24}}>
                {[
                  {label:'Active Shops',       val: activeCount,       sub:'Currently active tenants',   color:'#16a34a', icon:'✅'},
                  {label:'Inactive Shops',     val: inactiveCount,     sub:'Inactive / paused tenants',   color:'#dc2626', icon:'⏸'},
                  {label:'Total Subscription Revenue', val:`₹${monthlyRevenue.toLocaleString('en-IN')}`, sub:'Estimated MRR (monthly)', color:'#F5971E', icon:'💰'},
                  {label:'Paid Tenants',       val: paidTenants.length, sub:'STARTER + PRO plans',        color:'#3b82f6', icon:'💳'},
                  {label:'Joined Today',       val: onboardedToday,    sub:'New shops today',             color:'#1E3A5F', icon:'🆕'},
                  {label:'Joined This Month',  val: onboardedMonth,    sub:`${monthStr}`,                 color:'#8b5cf6', icon:'📅'},
                ].map(c => (
                  <div key={c.label} style={{background:'#fff',borderRadius:10,padding:'18px 20px',border:'1.5px solid #e5e7eb',boxShadow:'0 1px 4px rgba(0,0,0,0.04)'}}>
                    <div style={{fontSize:22,marginBottom:6}}>{c.icon}</div>
                    <div style={{fontSize:24,fontWeight:800,color:c.color}}>{c.val}</div>
                    <div style={{fontSize:13,fontWeight:700,color:'#1f2937',marginTop:2}}>{c.label}</div>
                    <div style={{fontSize:11,color:'#9ca3af',marginTop:2}}>{c.sub}</div>
                  </div>
                ))}
              </div>

              {/* Revenue by time range */}
              {(() => {
                const planAmt = t => t.plan==='PRO'?2499:t.plan==='STARTER'?999:0;
                const revToday   = tenants.filter(t=>t.createdAt?.slice(0,10)===todayStr).reduce((s,t)=>s+planAmt(t),0);
                const rev7d      = tenants.filter(t=>t.createdAt?.slice(0,10)>=d7ago).reduce((s,t)=>s+planAmt(t),0);
                const revMonth   = tenants.filter(t=>t.createdAt?.slice(0,7)===monthStr).reduce((s,t)=>s+planAmt(t),0);
                const revTotal   = tenants.reduce((s,t)=>s+planAmt(t),0);

                const rev12mData = Array.from({length:12},(_,i)=>{
                  const d  = new Date(now.getFullYear(),now.getMonth()-(11-i),1);
                  const ms = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
                  const label = d.toLocaleDateString('en-IN',{month:'short'});
                  const rev = tenants.filter(t=>t.createdAt?.slice(0,7)===ms).reduce((s,t)=>s+planAmt(t),0);
                  return { l:label, v:rev };
                });

                return (
                  <div style={{marginBottom:20}}>
                    {/* Revenue KPI row */}
                    <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:14,marginBottom:16}}>
                      {[
                        {label:'Revenue Today',      val:revToday,  color:'#1E3A5F'},
                        {label:'Revenue Last 7 Days', val:rev7d,    color:'#3b82f6'},
                        {label:'Revenue This Month',  val:revMonth,  color:'#8b5cf6'},
                        {label:'Total Revenue (MRR)', val:revTotal,  color:'#F5971E'},
                      ].map(c=>(
                        <div key={c.label} style={{background:'#fff',borderRadius:10,padding:'16px 18px',border:'1.5px solid #e5e7eb',boxShadow:'0 1px 3px rgba(0,0,0,0.04)'}}>
                          <div style={{fontSize:11,fontWeight:700,color:'#9ca3af',letterSpacing:0.5,marginBottom:6,textTransform:'uppercase'}}>{c.label}</div>
                          <div style={{fontSize:22,fontWeight:800,color:c.color}}>₹{c.val.toLocaleString('en-IN')}</div>
                          <div style={{fontSize:11,color:'#9ca3af',marginTop:3}}>from subscriptions</div>
                        </div>
                      ))}
                    </div>

                    {/* Revenue bar chart — 12 months */}
                    <div style={{background:'#fff',borderRadius:10,border:'1.5px solid #e5e7eb',padding:'20px',marginBottom:0}}>
                      <div style={{fontSize:14,fontWeight:700,color:'#1f2937',marginBottom:14}}>💰 Subscription Revenue — Last 12 Months</div>
                      <SaBarChart data={rev12mData} color='#F5971E' height={150} />
                      <div style={{textAlign:'center',fontSize:12,color:'#9ca3af',marginTop:8}}>
                        Based on plan price at time of signup · Total: <strong style={{color:'#F5971E'}}>₹{revTotal.toLocaleString('en-IN')}/mo</strong>
                      </div>
                    </div>
                  </div>
                );
              })()}

              {/* Onboarding trend chart */}
              <div style={{background:'#fff',borderRadius:10,border:'1.5px solid #e5e7eb',padding:'20px',marginBottom:20}}>
                <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:16,flexWrap:'wrap',gap:10}}>
                  <div style={{fontSize:15,fontWeight:700,color:'#1f2937'}}>📈 Shops Onboarded Over Time</div>
                  <div style={{display:'flex',gap:6}}>
                    {[['today','Today'],['7d','7 Days'],['month','This Month'],['12m','12 Months']].map(([k,l])=>(
                      <button key={k} onClick={()=>setReportRange(k)} style={{
                        padding:'5px 12px',borderRadius:6,border:'1px solid',fontSize:12,fontWeight:600,cursor:'pointer',
                        background: reportRange===k ? '#1E3A5F' : '#fff',
                        color:      reportRange===k ? '#fff'    : '#6b7280',
                        borderColor:reportRange===k ? '#1E3A5F' : '#e5e7eb',
                      }}>{l}</button>
                    ))}
                  </div>
                </div>
                <SaBarChart data={chartData} color='#1E3A5F' height={160} />
                <div style={{textAlign:'center',fontSize:12,color:'#9ca3af',marginTop:8}}>
                  Total in range: <strong style={{color:'#1E3A5F'}}>{chartData.reduce((s,d)=>s+d.v,0)} shops</strong>
                </div>
              </div>

              {/* Active vs Inactive + Plan breakdown */}
              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:16}}>
                <div style={{background:'#fff',borderRadius:10,border:'1.5px solid #e5e7eb',padding:'20px'}}>
                  <div style={{fontSize:14,fontWeight:700,color:'#1f2937',marginBottom:16}}>Active vs Inactive</div>
                  <div style={{display:'flex',alignItems:'center',gap:24}}>
                    <SaDonut segments={[
                      {l:'Active',   v:activeCount,   c:'#16a34a'},
                      {l:'Inactive', v:inactiveCount, c:'#dc2626'},
                    ]} size={130} />
                    <div style={{flex:1}}>
                      {[['Active',activeCount,'#16a34a'],['Inactive',inactiveCount,'#dc2626']].map(([l,v,c])=>(
                        <div key={l} style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:12}}>
                          <div style={{display:'flex',alignItems:'center',gap:8}}>
                            <div style={{width:12,height:12,borderRadius:3,background:c}} />
                            <span style={{fontSize:13,color:'#374151'}}>{l}</span>
                          </div>
                          <span style={{fontWeight:800,fontSize:18,color:c}}>{v}</span>
                        </div>
                      ))}
                      <div style={{marginTop:8,fontSize:12,color:'#9ca3af'}}>
                        Active rate: <strong style={{color:'#16a34a'}}>{tenants.length ? Math.round(activeCount/tenants.length*100) : 0}%</strong>
                      </div>
                    </div>
                  </div>
                </div>

                <div style={{background:'#fff',borderRadius:10,border:'1.5px solid #e5e7eb',padding:'20px'}}>
                  <div style={{fontSize:14,fontWeight:700,color:'#1f2937',marginBottom:16}}>Plan Breakdown</div>
                  <div style={{display:'flex',alignItems:'center',gap:24}}>
                    <SaDonut segments={[
                      {l:'FREE',    v:stats?.freePlan??0,    c:'#6b7280'},
                      {l:'STARTER', v:stats?.starterPlan??0, c:'#3b82f6'},
                      {l:'PRO',     v:stats?.proPlan??0,     c:'#8b5cf6'},
                    ]} size={130} />
                    <div style={{flex:1}}>
                      {[['FREE',stats?.freePlan??0,'#6b7280',0],['STARTER',stats?.starterPlan??0,'#3b82f6',999],['PRO',stats?.proPlan??0,'#8b5cf6',2499]].map(([l,v,c,price])=>(
                        <div key={l} style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:10}}>
                          <div style={{display:'flex',alignItems:'center',gap:8}}>
                            <div style={{width:12,height:12,borderRadius:3,background:c}} />
                            <span style={{fontSize:13,color:'#374151'}}>{l}</span>
                          </div>
                          <div style={{textAlign:'right'}}>
                            <div style={{fontWeight:800,fontSize:16,color:c}}>{v}</div>
                            {price>0 && <div style={{fontSize:10,color:'#9ca3af'}}>₹{(v*price).toLocaleString('en-IN')}/mo</div>}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ══ ALL TENANTS ══ */}
          {activePage==='tenants' && (
            <div style={{background:'#fff',borderRadius:12,border:'1.5px solid #e5e7eb',overflow:'hidden'}}>
              <div style={{overflowX:'auto'}}>
                <table style={{width:'100%',borderCollapse:'collapse',fontSize:13}}>
                  <thead>
                    <tr style={{background:'#f9fafb'}}>
                      {['Shop Name','Subdomain','Owner Email','Phone','Plan','Subscription','Status','Products','Bills','Joined','Actions'].map(h => (
                        <th key={h} style={{padding:'10px 16px',textAlign:'left',fontWeight:600,color:'#6b7280',borderBottom:'1px solid #e5e7eb'}}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {tenants.map((t,i) => {
                      const subAmt = t.plan==='PRO' ? 2499 : t.plan==='STARTER' ? 999 : 0;
                      return (
                      <tr key={t.id} style={{borderBottom:'1px solid #f3f4f6',background:i%2===0?'#fff':'#fafafa'}}>
                        <td style={{padding:'10px 16px',fontWeight:600,color:'#1f2937'}}>{t.name}</td>
                        <td style={{padding:'10px 16px',fontFamily:'monospace',color:'#4b5563'}}>{t.subdomain}</td>
                        <td style={{padding:'10px 16px',color:'#4b5563'}}>{t.ownerEmail}</td>
                        <td style={{padding:'10px 16px',color:'#4b5563'}}>{t.phoneNumber||'—'}</td>
                        <td style={{padding:'10px 16px'}}>
                          <span style={{background:(planColors[t.plan]||'#6b7280')+'22',color:planColors[t.plan]||'#6b7280',padding:'2px 10px',borderRadius:99,fontWeight:700,fontSize:12}}>
                            {t.plan}
                          </span>
                        </td>
                        <td style={{padding:'10px 16px',fontWeight:700,color: subAmt>0?'#16a34a':'#9ca3af'}}>
                          {subAmt>0 ? `₹${subAmt.toLocaleString('en-IN')}/mo` : '₹0'}
                        </td>
                        <td style={{padding:'10px 16px'}}>
                          <span style={{color:t.status==='ACTIVE'?'#16a34a':t.status==='TRIAL'?'#f97316':'#dc2626',fontWeight:600}}>{t.status}</span>
                        </td>
                        <td style={{padding:'10px 16px',textAlign:'center'}}>{t.productCount}</td>
                        <td style={{padding:'10px 16px',textAlign:'center'}}>{t.billCount}</td>
                        <td style={{padding:'10px 16px',color:'#9ca3af'}}>{t.createdAt?t.createdAt.slice(0,10):'—'}</td>
                        <td style={{padding:'10px 16px'}}>
                          <button onClick={()=>setEditPlan({id:t.id,name:t.name,plan:t.plan,status:t.status})}
                            style={{background:'#1E3A5F',color:'#fff',border:'none',borderRadius:6,padding:'4px 12px',cursor:'pointer',fontSize:12,fontWeight:600}}>
                            Edit
                          </button>
                        </td>
                      </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

        </div>
      </div>

      {/* Edit plan modal */}
      {editPlan && (
        <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.4)',display:'flex',alignItems:'center',justifyContent:'center',zIndex:999}}>
          <div style={{background:'#fff',borderRadius:12,padding:'32px 40px',width:400,boxShadow:'0 8px 32px rgba(0,0,0,0.15)'}}>
            <h3 style={{margin:'0 0 20px',color:'#1f2937'}}>Edit Plan — {editPlan.name}</h3>
            <label style={{fontSize:13,fontWeight:600,color:'#374151'}}>Plan</label>
            <select value={editPlan.plan} onChange={e=>setEditPlan(p=>({...p,plan:e.target.value}))}
              style={{display:'block',width:'100%',marginTop:4,marginBottom:14,padding:'8px 12px',border:'1.5px solid #d1d5db',borderRadius:8,fontSize:14}}>
              {['FREE','STARTER','PRO'].map(p=><option key={p} value={p}>{p}</option>)}
            </select>
            <label style={{fontSize:13,fontWeight:600,color:'#374151'}}>Status</label>
            <select value={editPlan.status} onChange={e=>setEditPlan(p=>({...p,status:e.target.value}))}
              style={{display:'block',width:'100%',marginTop:4,marginBottom:24,padding:'8px 12px',border:'1.5px solid #d1d5db',borderRadius:8,fontSize:14}}>
              {['ACTIVE','INACTIVE','TRIAL'].map(s=><option key={s} value={s}>{s}</option>)}
            </select>
            <div style={{display:'flex',gap:12}}>
              <button onClick={savePlan} disabled={saving}
                style={{flex:1,padding:'10px',background:'#1E3A5F',color:'#fff',border:'none',borderRadius:8,fontWeight:700,cursor:'pointer'}}>
                {saving?'Saving…':'Save'}
              </button>
              <button onClick={()=>setEditPlan(null)}
                style={{flex:1,padding:'10px',background:'#f3f4f6',color:'#374151',border:'none',borderRadius:8,fontWeight:700,cursor:'pointer'}}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const subdomain = getSubdomain();
const isShop = window.location.pathname.startsWith('/shop');

let rootElement;
if (subdomain === 'www') {
  rootElement = <LandingPage />;
} else if (subdomain === 'admin') {
  rootElement = <SuperAdminApp />;
} else if (isShop) {
  rootElement = <ShopApp />;
} else {
  rootElement = <App />;
}

createRoot(document.getElementById('root')).render(rootElement);