import React, { useEffect, useRef, useState } from 'react';
import './landing.css';

const API = import.meta.env.VITE_API_URL ?? 'http://localhost:8080/gosuas-core/api';

function toSubdomain(name) {
  return name.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 20);
}

const PLAN_CONFIG = {
  STARTER: {
    label: 'STARTER',
    popular: true,
    features: ['Only store (online only)', 'Free sub-domain', '2 product photos', 'Normal sale (without labels)'],
    monthly: { price: '₹999',   display: '₹999',   amount: 999,   period: 'per month' },
    yearly:  { price: '₹9,588', display: '₹799',   amount: 9588,  period: 'billed ₹9,588/year', save: 'Save 20%' },
  },
  PRO: {
    label: 'PRO',
    popular: false,
    features: ['Online & offline selling (POS)', 'Free sub-domain', 'Up to 6 product photos', 'Festive sale with shipping labels'],
    monthly: { price: '₹1,699',  display: '₹1,699',  amount: 1699,  period: 'per month' },
    yearly:  { price: '₹16,308', display: '₹1,359',  amount: 16308, period: 'billed ₹16,308/year', save: 'Save 20%' },
  },
};

function loadRazorpayScript() {
  return new Promise(resolve => {
    if (window.Razorpay) { resolve(true); return; }
    const s = document.createElement('script');
    s.src = 'https://checkout.razorpay.com/v1/checkout.js';
    s.onload = () => resolve(true);
    s.onerror = () => resolve(false);
    document.body.appendChild(s);
  });
}

/* ── Signup multi-step modal ── */
function SignupModal({ initialShopName = '', initialPlan = 'STARTER', onClose, onSuccess }) {
  const [step, setStep] = useState(1);
  const [shopName, setShopName] = useState(initialShopName);
  const [subdomain, setSubdomain] = useState(toSubdomain(initialShopName));
  const [avail, setAvail] = useState(null);
  const [domainType, setDomainType] = useState('subdomain'); // 'subdomain' | 'custom'
  const [customDomain, setCustomDomain] = useState('');
  const [ownerName, setOwnerName] = useState('');
  const [ownerEmail, setOwnerEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [selectedPlan, setSelectedPlan] = useState(initialPlan in PLAN_CONFIG ? initialPlan : 'STARTER');
  const [billingCycle, setBillingCycle] = useState('monthly');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [createdSubdomain, setCreatedSubdomain] = useState('');
  const timerRef = useRef(null);

  useEffect(() => {
    if (!subdomain) { setAvail(null); return; }
    setAvail('checking');
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(async () => {
      try {
        const res = await fetch(`${API}/auth/check-subdomain?subdomain=${subdomain}`);
        const data = await res.json();
        setAvail(data.available ? 'ok' : 'no');
      } catch { setAvail(null); }
    }, 500);
  }, [subdomain]);

  const handleShopNameChange = (v) => { setShopName(v); setSubdomain(toSubdomain(v)); };

  const canProceedStep1 = shopName.trim() && subdomain.length >= 3 && avail === 'ok' &&
    (domainType === 'subdomain' || customDomain.trim().length > 3);
  const canProceedStep2 = ownerName.trim() && ownerEmail.trim() && password.length >= 6;

  const currentPricing = () => PLAN_CONFIG[selectedPlan][billingCycle];

  const doSignup = async (paymentData = {}) => {
    setError(''); setLoading(true);
    try {
      const res = await fetch(`${API}/auth/signup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          shopName, subdomain, ownerName, ownerEmail,
          phoneNumber: phone, password, plan: selectedPlan,
          customDomain: domainType === 'custom' ? customDomain : null,
          ...paymentData
        })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setError(data.error || 'Signup failed. Please try again.'); return; }
      localStorage.setItem('gosuas_token', data.token);
      setCreatedSubdomain(data.subdomain);
      setStep(4);
      if (onSuccess) onSuccess(data);
    } catch { setError('Network error. Please check your connection.'); }
    finally { setLoading(false); }
  };

  const handlePayNow = async () => {
    setError(''); setLoading(true);
    const loaded = await loadRazorpayScript();
    if (!loaded) { setError('Payment gateway failed to load. Please try again.'); setLoading(false); return; }
    try {
      const pricing = currentPricing();
      const orderRes = await fetch(`${API}/payment/create-order`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount: pricing.amount })
      });
      const orderData = await orderRes.json();
      if (!orderRes.ok) { setError(orderData.error || 'Could not initiate payment.'); setLoading(false); return; }

      const rzp = new window.Razorpay({
        key: orderData.keyId,
        amount: orderData.amount,
        currency: 'INR',
        name: 'theshopclaude',
        description: `${selectedPlan} Plan — ${pricing.display}/month`,
        order_id: orderData.razorpayOrderId,
        image: '/logo.png',
        prefill: { name: ownerName, email: ownerEmail, contact: phone },
        theme: { color: '#1E3A5F' },
        modal: { ondismiss: () => setLoading(false) },
        handler: (response) => {
          doSignup({
            razorpayOrderId: response.razorpay_order_id,
            razorpayPaymentId: response.razorpay_payment_id,
            razorpaySignature: response.razorpay_signature,
          });
        }
      });
      rzp.open();
    } catch { setError('Payment initiation failed. Please try again.'); setLoading(false); }
  };

  const handleEMandate = async () => {
    setError(''); setLoading(true);
    const loaded = await loadRazorpayScript();
    if (!loaded) { setError('Payment gateway failed to load. Please try again.'); setLoading(false); return; }
    try {
      const pricing = currentPricing();
      const subRes = await fetch(`${API}/payment/create-subscription`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plan: selectedPlan })
      });
      const subData = await subRes.json();
      if (!subRes.ok) { setError(subData.error || 'Could not create subscription.'); setLoading(false); return; }

      const rzp = new window.Razorpay({
        key: subData.keyId,
        subscription_id: subData.subscriptionId,
        name: 'theshopclaude',
        description: `${selectedPlan} Plan — ${pricing.display}/month auto-debit`,
        image: '/logo.png',
        prefill: { name: ownerName, email: ownerEmail, contact: phone },
        theme: { color: '#1E3A5F' },
        modal: { ondismiss: () => setLoading(false) },
        handler: (response) => {
          doSignup({
            razorpayPaymentId: response.razorpay_payment_id,
            razorpaySubscriptionId: response.razorpay_subscription_id,
            razorpaySignature: response.razorpay_signature,
          });
        }
      });
      rzp.open();
    } catch { setError('E-mandate setup failed. Please try again.'); setLoading(false); }
  };

  const shopUrl = domainType === 'custom' && customDomain
    ? `https://${customDomain}`
    : `https://${createdSubdomain}.theshopclaude.com`;

  return (
    <div className="sc-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="sc-modal">
        <button className="sc-modal-close" onClick={onClose}>✕</button>

        {step < 4 && (
          <div className="sc-modal-steps">
            {[1,2,3].map(s => (
              <React.Fragment key={s}>
                <div className={`sc-modal-step-dot ${step >= s ? 'active' : ''}`} />
                {s < 3 && <div style={{ flex: 1, height: 3, background: step > s ? 'var(--sc-purple)' : 'var(--sc-border)', borderRadius: 2, margin: '0 4px' }} />}
              </React.Fragment>
            ))}
          </div>
        )}

        {/* ── Step 1: Shop name + URL + Domain type ── */}
        {step === 1 && (
          <>
            <div className="sc-modal-title">Create your store</div>
            <div className="sc-modal-sub">Step 1 of 3 — Choose your shop name and URL</div>
            <div className="sc-form-row">
              <label className="sc-form-label">Shop Name</label>
              <input className="sc-form-input" placeholder="e.g. Priya Jewels" value={shopName}
                onChange={e => handleShopNameChange(e.target.value)} autoFocus />
            </div>
            <div className="sc-form-row">
              <label className="sc-form-label">Your Shop URL</label>
              <div className="sc-subdomain-row">
                <span className="sc-subdomain-prefix">https://</span>
                <input className="sc-form-input sc-subdomain-input" placeholder="yourshop"
                  value={subdomain} onChange={e => setSubdomain(e.target.value.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 20))} />
                <span className="sc-subdomain-suffix">.theshopclaude.com</span>
              </div>
              {avail === 'ok' && <div className="sc-avail-ok">✓ Available!</div>}
              {avail === 'no' && <div className="sc-avail-no">✗ Already taken. Try another.</div>}
              {avail === 'checking' && <div className="sc-avail-check">Checking availability…</div>}
            </div>

            {/* Domain type choice */}
            <div className="sc-form-row">
              <label className="sc-form-label">Store URL type</label>
              <div style={{ display: 'flex', gap: 8 }}>
                <button type="button" onClick={() => setDomainType('subdomain')} style={{
                  flex: 1, padding: '10px 8px', border: `2px solid ${domainType === 'subdomain' ? 'var(--sc-purple)' : 'var(--sc-border)'}`,
                  borderRadius: 8, background: domainType === 'subdomain' ? 'var(--sc-purple-light)' : '#fff',
                  cursor: 'pointer', textAlign: 'left'
                }}>
                  <div style={{ fontWeight: 700, color: domainType === 'subdomain' ? 'var(--sc-purple)' : '#111', fontSize: 12, marginBottom: 2 }}>
                    🏬 Our subdomain
                  </div>
                  <div style={{ fontSize: 11, color: '#6B7280' }}>{subdomain || 'yourshop'}.theshopclaude.com</div>
                  <div style={{ fontSize: 10, color: 'var(--sc-orange)', fontWeight: 600, marginTop: 2 }}>Recommended</div>
                </button>
                <button type="button" onClick={() => setDomainType('custom')} style={{
                  flex: 1, padding: '10px 8px', border: `2px solid ${domainType === 'custom' ? 'var(--sc-purple)' : 'var(--sc-border)'}`,
                  borderRadius: 8, background: domainType === 'custom' ? 'var(--sc-purple-light)' : '#fff',
                  cursor: 'pointer', textAlign: 'left'
                }}>
                  <div style={{ fontWeight: 700, color: domainType === 'custom' ? 'var(--sc-purple)' : '#111', fontSize: 12, marginBottom: 2 }}>
                    🌐 My own domain
                  </div>
                  <div style={{ fontSize: 11, color: '#6B7280' }}>e.g. www.yourstore.com</div>
                  <div style={{ fontSize: 10, color: '#9CA3AF', marginTop: 2 }}>DNS setup required</div>
                </button>
              </div>
            </div>

            {domainType === 'custom' && (
              <div className="sc-form-row">
                <label className="sc-form-label">Your domain</label>
                <input className="sc-form-input" placeholder="e.g. www.yourstore.com"
                  value={customDomain} onChange={e => setCustomDomain(e.target.value.toLowerCase().trim())} />
                <div style={{ marginTop: 8, padding: '10px 12px', background: '#FFF8E1', border: '1px solid #FFD54F', borderRadius: 8, fontSize: 12, color: '#5D4037' }}>
                  <strong>DNS Setup:</strong> Point your domain's <strong>A record</strong> to{' '}
                  <code style={{ background: '#FFE0B2', padding: '1px 5px', borderRadius: 4, fontFamily: 'monospace' }}>69.62.73.165</code>.
                  After signup, our team will configure SSL for your domain within 24 hours.
                </div>
              </div>
            )}

            <div className="sc-modal-btn-row">
              <button className="sc-btn-purple" disabled={!canProceedStep1}
                onClick={() => setStep(2)} style={{ flex: 1, padding: '13px' }}>
                Continue →
              </button>
            </div>
          </>
        )}

        {/* ── Step 2: Account details ── */}
        {step === 2 && (
          <>
            <div className="sc-modal-title">Your details</div>
            <div className="sc-modal-sub">Step 2 of 3 — Set up your admin account</div>
            {error && <div className="sc-error-box">{error}</div>}
            <div className="sc-form-row">
              <label className="sc-form-label">Your Name</label>
              <input className="sc-form-input" placeholder="Full name" value={ownerName}
                onChange={e => setOwnerName(e.target.value)} autoFocus />
            </div>
            <div className="sc-form-row">
              <label className="sc-form-label">Email</label>
              <input className="sc-form-input" type="email" placeholder="you@example.com"
                value={ownerEmail} onChange={e => setOwnerEmail(e.target.value)} />
            </div>
            <div className="sc-form-row">
              <label className="sc-form-label">Phone (optional)</label>
              <input className="sc-form-input" type="tel" placeholder="+91 98765 43210"
                value={phone} onChange={e => setPhone(e.target.value)} />
            </div>
            <div className="sc-form-row">
              <label className="sc-form-label">Password</label>
              <div style={{ position: 'relative' }}>
                <input className="sc-form-input" type={showPw ? 'text' : 'password'}
                  placeholder="Min 6 characters" value={password}
                  onChange={e => setPassword(e.target.value)}
                  style={{ paddingRight: 44 }} />
                <button type="button" onClick={() => setShowPw(!showPw)} style={{
                  position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)',
                  background: 'none', border: 'none', cursor: 'pointer', fontSize: 18, color: '#6B7280', lineHeight: 1
                }}>
                  {showPw ? '🙈' : '👁️'}
                </button>
              </div>
            </div>
            <div className="sc-modal-btn-row">
              <button className="sc-btn-outline" onClick={() => setStep(1)}>← Back</button>
              <button className="sc-btn-purple" disabled={!canProceedStep2}
                onClick={() => { setError(''); setStep(3); }} style={{ flex: 1, padding: '13px' }}>
                Choose Plan →
              </button>
            </div>
          </>
        )}

        {/* ── Step 3: Plan selection + Payment ── */}
        {step === 3 && (
          <>
            <div className="sc-modal-title">Choose your plan</div>
            <div className="sc-modal-sub">Step 3 of 3 — Select a plan and complete payment</div>
            {error && <div className="sc-error-box">{error}</div>}

            {/* Billing cycle toggle */}
            <div style={{ display: 'flex', gap: 0, margin: '12px 0 14px', border: '1px solid var(--sc-border)', borderRadius: 8, overflow: 'hidden' }}>
              {[{ key: 'monthly', label: 'Monthly' }, { key: 'yearly', label: 'Yearly  🏷 Save 20%' }].map(c => (
                <button key={c.key} type="button" onClick={() => setBillingCycle(c.key)} style={{
                  flex: 1, padding: '10px', border: 'none', cursor: 'pointer',
                  background: billingCycle === c.key ? 'var(--sc-purple)' : '#fff',
                  color: billingCycle === c.key ? '#fff' : '#6B7280',
                  fontWeight: 600, fontSize: 13
                }}>
                  {c.label}
                </button>
              ))}
            </div>

            {/* Plan picker */}
            <div style={{ display: 'flex', gap: 8, margin: '0 0 16px' }}>
              {Object.entries(PLAN_CONFIG).map(([key, p]) => {
                const pricing = p[billingCycle];
                return (
                  <button key={key} type="button" onClick={() => setSelectedPlan(key)} style={{
                    flex: 1, padding: '10px 6px', border: `2px solid ${selectedPlan === key ? 'var(--sc-purple)' : 'var(--sc-border)'}`,
                    borderRadius: 8, background: selectedPlan === key ? 'var(--sc-purple-light)' : '#fff',
                    cursor: 'pointer', textAlign: 'center', transition: 'all 0.15s'
                  }}>
                    {p.popular && <div style={{ fontSize: 9, background: 'var(--sc-orange)', color: '#fff', borderRadius: 4, padding: '1px 6px', marginBottom: 3, display: 'inline-block' }}>POPULAR</div>}
                    <div style={{ fontSize: 11, fontWeight: 700, color: selectedPlan === key ? 'var(--sc-purple)' : '#6B7280', letterSpacing: 1 }}>{p.label}</div>
                    <div style={{ fontSize: 17, fontWeight: 900, color: selectedPlan === key ? 'var(--sc-purple)' : '#111', margin: '2px 0' }}>{pricing.display}</div>
                    <div style={{ fontSize: 10, color: '#9CA3AF' }}>/mo</div>
                    {billingCycle === 'yearly' && <div style={{ fontSize: 10, color: 'var(--sc-orange)', fontWeight: 600 }}>{pricing.save}</div>}
                  </button>
                );
              })}
            </div>

            {/* Summary */}
            <div style={{ background: '#F9FAFB', border: '1px solid var(--sc-border)', borderRadius: 8, padding: '12px 14px', marginBottom: 14 }}>
              <div style={{ fontSize: 13, color: '#374151', fontWeight: 600, marginBottom: 3 }}>
                {PLAN_CONFIG[selectedPlan].label} — {billingCycle === 'yearly'
                  ? `${currentPricing().price}/year (${currentPricing().display}/mo)`
                  : `${currentPricing().price}/month`}
              </div>
              <div style={{ fontSize: 12, color: '#6B7280' }}>Secure payment via Razorpay. Cancel anytime.</div>
            </div>

            <button onClick={handlePayNow} disabled={loading} style={{
              width: '100%', padding: '13px', marginBottom: 10,
              background: 'var(--sc-purple)', color: '#fff', border: 'none',
              borderRadius: 8, fontSize: 15, fontWeight: 700, cursor: 'pointer'
            }}>
              {loading ? 'Processing…' : `💳 Pay ${currentPricing().price} Now`}
            </button>

            {billingCycle === 'monthly' && (
              <button onClick={handleEMandate} disabled={loading} style={{
                width: '100%', padding: '13px', marginBottom: 14,
                background: '#fff', color: 'var(--sc-purple)',
                border: '2px solid var(--sc-purple)',
                borderRadius: 8, fontSize: 14, fontWeight: 600, cursor: 'pointer'
              }}>
                {loading ? 'Processing…' : `🔄 Set up ${currentPricing().price}/month Auto-Pay (e-Mandate)`}
              </button>
            )}

            <div style={{ fontSize: 11, color: '#9CA3AF', textAlign: 'center', marginBottom: 8 }}>
              🔒 256-bit SSL · UPI Autopay / NACH / Cards accepted
            </div>
            <button className="sc-btn-outline" onClick={() => setStep(2)} style={{ width: '100%' }}>← Back</button>
          </>
        )}

        {/* ── Step 4: Success ── */}
        {step === 4 && (
          <div className="sc-success-box">
            <div className="sc-success-icon">🎉</div>
            <div className="sc-success-title">Your store is ready!</div>
            <p style={{ color: '#6B7280', fontSize: 14, marginBottom: 8 }}>
              Welcome to ShopClaude, {ownerName}! Your {selectedPlan} plan is active.
            </p>
            <div className="sc-success-url">{shopUrl}</div>
            {domainType === 'custom' && (
              <p style={{ fontSize: 12, color: '#F5971E', margin: '8px 0 0', fontWeight: 600 }}>
                ⚠ Remember to point your domain's A record to 69.62.73.165
              </p>
            )}
            <p style={{ fontSize: 13, color: '#6B7280', marginTop: 8 }}>
              Start adding products and go live instantly.
            </p>
            <a href={`https://${createdSubdomain}.theshopclaude.com`} style={{ display: 'block', marginTop: 20 }}>
              <button className="sc-btn-purple" style={{ width: '100%', padding: '14px', fontSize: 15 }}>
                Go to My Store →
              </button>
            </a>
          </div>
        )}
      </div>
    </div>
  );
}

/* ── Signin modal ── */
function SigninModal({ onClose }) {
  const [subdomain, setSubdomain] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSignin = async (e) => {
    e.preventDefault();
    if (!subdomain || !email || !password) { setError('Please fill all fields'); return; }
    setError(''); setLoading(true);
    try {
      const res = await fetch(`${API}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password, subdomain: subdomain.toLowerCase() })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setError(data.error || 'Invalid credentials'); return; }
      localStorage.setItem('gosuas_token', data.token);
      window.location.href = `https://${data.subdomain}.theshopclaude.com`;
    } catch { setError('Network error. Please try again.'); }
    finally { setLoading(false); }
  };

  return (
    <div className="sc-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="sc-modal">
        <button className="sc-modal-close" onClick={onClose}>✕</button>
        <div className="sc-signin-modal-title">Sign in to your store</div>
        <div className="sc-signin-modal-sub">Enter your shop URL to continue</div>

        {error && <div className="sc-error-box">{error}</div>}

        <form onSubmit={handleSignin}>
          <div className="sc-form-row">
            <label className="sc-form-label">Shop URL</label>
            <div className="sc-subdomain-row">
              <input className="sc-form-input sc-subdomain-input" style={{ borderRadius: '8px 0 0 8px' }}
                placeholder="yourshop" value={subdomain}
                onChange={e => setSubdomain(e.target.value.toLowerCase().replace(/[^a-z0-9]/g, ''))}
                autoFocus />
              <span className="sc-subdomain-suffix">.theshopclaude.com</span>
            </div>
          </div>
          <div className="sc-form-row">
            <label className="sc-form-label">Email</label>
            <input className="sc-form-input" type="email" placeholder="you@example.com"
              value={email} onChange={e => setEmail(e.target.value)} />
          </div>
          <div className="sc-form-row">
            <label className="sc-form-label">Password</label>
            <div style={{ position: 'relative' }}>
              <input className="sc-form-input" type={showPw ? 'text' : 'password'}
                placeholder="Your password" value={password}
                onChange={e => setPassword(e.target.value)}
                style={{ paddingRight: 44 }} />
              <button type="button" onClick={() => setShowPw(!showPw)} style={{
                position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)',
                background: 'none', border: 'none', cursor: 'pointer', fontSize: 18, color: '#6B7280', lineHeight: 1
              }}>
                {showPw ? '🙈' : '👁️'}
              </button>
            </div>
          </div>
          <button type="submit" className="sc-btn-purple" disabled={loading}
            style={{ width: '100%', padding: '13px', marginTop: 4, fontSize: 15 }}>
            {loading ? 'Signing in…' : 'Sign In →'}
          </button>
        </form>

        <div className="sc-signin-footer" style={{ marginTop: 20 }}>
          Don't have an account?{' '}
          <a onClick={() => onClose('signup')}>Get started</a>
        </div>
      </div>
    </div>
  );
}

/* ── Animated Store Slides ── */
/* ── Hero Section ── */
const HERO_STORES = [
  { label:'Jewellery Store', emoji:'💍', color:'#7C3AED', bg:'#FAF5FF', products:[['💍','Gold Ring','₹4,999'],['💎','Necklace','₹8,200'],['📿','Bracelet','₹2,800'],['👑','Tiara','₹12,500']] },
  { label:'Shoe Store',      emoji:'👟', color:'#EA580C', bg:'#FFF7ED', products:[['👟','Sneakers','₹2,499'],['👠','Heels','₹3,200'],['🥿','Loafers','₹1,800'],['🥾','Boots','₹4,100']] },
  { label:'Fashion Store',   emoji:'👗', color:'#BE185D', bg:'#FDF2F8', products:[['👗','Kurti','₹1,299'],['👘','Saree','₹2,800'],['🧣','Dupatta','₹699'],['🎒','Handbag','₹1,999']] },
  { label:'Electronics',     emoji:'📱', color:'#0369A1', bg:'#F0F9FF', products:[['📱','Phone','₹18,999'],['🎧','Earbuds','₹2,499'],['💻','Laptop','₹54,999'],['⌚','Watch','₹8,500']] },
];

function HeroSection({ heroShopName, setHeroShopName, openSignup, openSignin }) {
  const [storeIdx, setStoreIdx] = useState(0);
  const [wordIdx, setWordIdx] = useState(0);
  const words = ['Jewellery Shop', 'Shoe Store', 'Clothing Brand', 'Your Business'];
  const store = HERO_STORES[storeIdx % HERO_STORES.length];

  useEffect(() => {
    const t = setInterval(() => {
      setStoreIdx(i => (i + 1) % HERO_STORES.length);
      setWordIdx(i => (i + 1) % words.length);
    }, 2800);
    return () => clearInterval(t);
  }, []);

  return (
    <section className="sc-hero-new">
      {/* Floating background orbs */}
      <div className="sc-hero-orb sc-hero-orb1" />
      <div className="sc-hero-orb sc-hero-orb2" />
      <div className="sc-hero-orb sc-hero-orb3" />

      <div className="sc-hero-split">
        {/* Left — text */}
        <div className="sc-hero-left">
          <div className="sc-hero-badge-new">🚀 Built for Indian Retail</div>

          <h1 className="sc-hero-h1">
            Launch Your<br />
            <span className="sc-hero-word" key={wordIdx}>{words[wordIdx]}</span>
            <br />Online Today
          </h1>

          <p className="sc-hero-sub-new">
            POS billing · Inventory · Online store · Analytics<br />
            — everything in one simple platform.
          </p>

          <div className="sc-hero-form-new">
            <input
              placeholder="Enter your shop name…"
              value={heroShopName}
              onChange={e => setHeroShopName(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && heroShopName && openSignup(heroShopName)}
            />
            <button className="sc-hero-cta" onClick={() => openSignup(heroShopName)}>
              Get Started →
            </button>
          </div>

          <div className="sc-hero-signin-new">
            Already have a store? <span onClick={openSignin}>Sign in</span>
          </div>

          <div className="sc-hero-stats-new">
            {[['50+','Stores active'],['₹1Cr+','Processed monthly'],['10K+','Bills generated'],['99.9%','Uptime']].map(([n,l]) => (
              <div key={l} className="sc-stat-new">
                <div className="sc-stat-num-new">{n}</div>
                <div className="sc-stat-lbl-new">{l}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Right — single phone mockup */}
        <div className="sc-hero-right">
          {/* Floating badges */}
          <div className="sc-hero-badge-float sc-hbf1">✅ Order Confirmed!</div>
          <div className="sc-hero-badge-float sc-hbf2">🚀 Store is Live</div>
          <div className="sc-hero-badge-float sc-hbf3">💳 Payment Received</div>

          {/* Phone */}
          <div className="sc-hero-phone">
            <div className="sc-phone-notch" />
            <div className="sc-phone-screen">
              <div className="sc-phone-header" style={{background: store.color}}>
                <span style={{fontSize:14}}>{store.emoji}</span>
                <span style={{fontSize:10,fontWeight:700,color:'#fff',marginLeft:6}}>{store.label}</span>
                <span className="sc-phone-cart">🛒</span>
              </div>
              <div className="sc-phone-search">🔍 Search products…</div>
              <div className="sc-phone-grid">
                {store.products.map(([emoji, name, price], i) => (
                  <div key={i} className="sc-phone-product sc-anim-rise" style={{animationDelay:`${i*0.1}s`, background: store.bg}}>
                    <div className="sc-pp-emoji">{emoji}</div>
                    <div className="sc-pp-name">{name}</div>
                    <div className="sc-pp-price" style={{color: store.color}}>{price}</div>
                    <div className="sc-pp-add" style={{background: store.color}}>Add</div>
                  </div>
                ))}
              </div>
              <div className="sc-phone-bottombar">
                <div>🏠 Home</div>
                <div>📦 Orders</div>
                <div>👤 Profile</div>
              </div>
            </div>
          </div>

          {/* Store type indicators */}
          <div className="sc-store-dots">
            {HERO_STORES.map((s, i) => (
              <button key={i}
                className={`sc-store-dot${storeIdx === i ? ' active' : ''}`}
                style={storeIdx === i ? {background: s.color} : {}}
                onClick={() => setStoreIdx(i)}
              >{s.emoji}</button>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

function StoreSlider() {
  const [active, setActive] = useState(0);
  const slides = [
    { id: 0, label: 'Create Your Store', color: '#1E3A5F', accent: '#F5971E' },
    { id: 1, label: 'Jewellery & Fashion Online', color: '#4C1D95', accent: '#F59E0B' },
    { id: 2, label: 'Cart & Checkout', color: '#065F46', accent: '#10B981' },
    { id: 3, label: 'Fast Delivery', color: '#7C2D12', accent: '#F97316' },
  ];

  useEffect(() => {
    const t = setInterval(() => setActive(a => (a + 1) % slides.length), 3200);
    return () => clearInterval(t);
  }, []);

  return (
    <div className="sc-slider-wrap">
      {/* Slide pills */}
      <div className="sc-slider-pills">
        {slides.map((s, i) => (
          <button key={i} className={`sc-slider-pill${active === i ? ' active' : ''}`} onClick={() => setActive(i)}>
            {s.label}
          </button>
        ))}
      </div>

      {/* Slide viewport */}
      <div className="sc-slider-viewport">

        {/* SLIDE 0 — Create Your Store */}
        <div className={`sc-slide${active === 0 ? ' sc-slide-active' : ''}`} style={{background:'linear-gradient(135deg,#EEF2FF,#E0E7FF)'}}>
          <div className="sc-slide-inner">
            <div className="sc-slide-text">
              <div className="sc-slide-tag" style={{color:'#1E3A5F',background:'#C7D2FE'}}>🚀 Launch in minutes</div>
              <h3>Create Your Online Store</h3>
              <p>Enter your shop name, choose a plan and go live. Your store is ready in under 5 minutes.</p>
            </div>
            {/* SVG animation: create store */}
            <div className="sc-slide-art">
              <svg viewBox="0 0 340 240" width="340" height="240" style={{overflow:'visible'}}>
                {/* Browser frame */}
                <rect x="20" y="20" width="300" height="200" rx="12" fill="#fff" stroke="#C7D2FE" strokeWidth="2"/>
                <rect x="20" y="20" width="300" height="32" rx="12" fill="#1E3A5F"/>
                <rect x="20" y="38" width="300" height="14" fill="#1E3A5F"/>
                <circle cx="38" cy="36" r="5" fill="#ef4444"/>
                <circle cx="54" cy="36" r="5" fill="#f59e0b"/>
                <circle cx="70" cy="36" r="5" fill="#22c55e"/>
                {/* URL bar */}
                <rect x="90" y="28" width="180" height="16" rx="8" fill="rgba(255,255,255,0.15)"/>
                <text x="100" y="40" fontSize="8" fill="rgba(255,255,255,0.8)" fontFamily="monospace">kakli.theshopclaude.com</text>
                {/* Shop header mockup */}
                <rect x="36" y="68" width="268" height="40" rx="4" fill="#F0F6FF"/>
                <rect x="44" y="76" width="80" height="24" rx="4" fill="#1E3A5F" className="sc-anim-pulse"/>
                <rect x="200" y="80" width="45" height="16" rx="8" fill="#F5971E"/>
                {/* Product cards */}
                {[0,1,2].map(i => (
                  <g key={i} className="sc-anim-rise" style={{animationDelay:`${i*0.2}s`}}>
                    <rect x={36+i*92} y="120" width="82" height="90" rx="8" fill="#fff" stroke="#E0E7FF" strokeWidth="1.5"/>
                    <rect x={36+i*92} y="120" width="82" height="50" rx="6" fill={['#FEE2E2','#D1FAE5','#DBEAFE'][i]}/>
                    <text x={36+i*92+41} y="150" textAnchor="middle" fontSize="22">{['💎','👟','👗'][i]}</text>
                    <rect x={36+i*92+10} y="178" width="42" height="8" rx="4" fill="#E0E7FF"/>
                    <rect x={36+i*92+10} y="192" width="28" height="6" rx="3" fill="#C7D2FE"/>
                    <rect x={36+i*92+52} y="190" width="20" height="14" rx="4" fill="#F5971E"/>
                    <text x={36+i*92+62} y="200" textAnchor="middle" fontSize="6" fill="#fff" fontWeight="bold">ADD</text>
                  </g>
                ))}
                {/* Typing cursor animation */}
                <rect x="44" y="76" width="2" height="24" fill="#fff" opacity="0.9" className="sc-anim-blink"/>
              </svg>
            </div>
          </div>
        </div>

        {/* SLIDE 1 — Jewellery & Fashion */}
        <div className={`sc-slide${active === 1 ? ' sc-slide-active' : ''}`} style={{background:'linear-gradient(135deg,#FDF4FF,#F3E8FF)'}}>
          <div className="sc-slide-inner">
            <div className="sc-slide-text">
              <div className="sc-slide-tag" style={{color:'#6D28D9',background:'#EDE9FE'}}>✨ Beautiful storefronts</div>
              <h3>Sell Jewellery & Fashion Online</h3>
              <p>Showcase your products with photos, sizes, and colours. Your customers shop 24/7 from anywhere in India.</p>
            </div>
            <div className="sc-slide-art">
              <svg viewBox="0 0 340 240" width="340" height="240" style={{overflow:'visible'}}>
                {/* Phone frame */}
                <rect x="105" y="10" width="130" height="220" rx="20" fill="#fff" stroke="#D8B4FE" strokeWidth="2.5"/>
                <rect x="110" y="15" width="120" height="210" rx="16" fill="#FAF5FF"/>
                <rect x="125" y="10" width="90" height="6" rx="3" fill="#D8B4FE"/>
                {/* Shop banner */}
                <rect x="110" y="30" width="120" height="48" rx="8" fill="linear-gradient(135deg,#7C3AED,#A78BFA)"/>
                <rect x="110" y="30" width="120" height="48" rx="8" fill="#7C3AED"/>
                <text x="170" y="50" textAnchor="middle" fontSize="10" fill="#fff" fontWeight="bold">💎 Priya Jewels</text>
                <text x="170" y="66" textAnchor="middle" fontSize="7" fill="rgba(255,255,255,0.8)">Shop the finest collection</text>
                {/* Products */}
                {[['💍','Gold Ring','₹4,999',' '],['💎','Diamond','₹12,500',' '],['📿','Necklace','₹2,800',' '],['👑','Crown Set','₹8,200',' ']].map(([icon,name,price],i) => (
                  <g key={i} className="sc-anim-rise" style={{animationDelay:`${i*0.15}s`}}>
                    <rect x={i%2===0?114:170} y={85+Math.floor(i/2)*72} width="52" height="60" rx="8" fill="#fff" stroke="#E9D5FF" strokeWidth="1"/>
                    <text x={(i%2===0?114:170)+26} y={105+Math.floor(i/2)*72} textAnchor="middle" fontSize="18">{icon}</text>
                    <text x={(i%2===0?114:170)+26} y={120+Math.floor(i/2)*72} textAnchor="middle" fontSize="6" fill="#374151">{name}</text>
                    <text x={(i%2===0?114:170)+26} y={132+Math.floor(i/2)*72} textAnchor="middle" fontSize="7" fill="#7C3AED" fontWeight="bold">{price}</text>
                  </g>
                ))}
                {/* Cart fab */}
                <circle cx="220" cy="210" r="14" fill="#F5971E" className="sc-anim-bounce"/>
                <text x="220" y="215" textAnchor="middle" fontSize="12">🛒</text>
                {/* Floating shoes on side */}
                <text x="40" y="80" fontSize="42" className="sc-anim-float" style={{animationDelay:'0s'}}>👟</text>
                <text x="270" y="130" fontSize="36" className="sc-anim-float" style={{animationDelay:'0.6s'}}>👗</text>
                <text x="30" y="170" fontSize="32" className="sc-anim-float" style={{animationDelay:'1.2s'}}>💍</text>
              </svg>
            </div>
          </div>
        </div>

        {/* SLIDE 2 — Cart & Checkout */}
        <div className={`sc-slide${active === 2 ? ' sc-slide-active' : ''}`} style={{background:'linear-gradient(135deg,#ECFDF5,#D1FAE5)'}}>
          <div className="sc-slide-inner">
            <div className="sc-slide-text">
              <div className="sc-slide-tag" style={{color:'#065F46',background:'#A7F3D0'}}>🛒 Seamless checkout</div>
              <h3>Smart Cart & Instant Payment</h3>
              <p>Customers add items, enter address, and pay via UPI or card. You get notified instantly — no manual work.</p>
            </div>
            <div className="sc-slide-art">
              <svg viewBox="0 0 340 240" width="340" height="240" style={{overflow:'visible'}}>
                {/* Cart illustration */}
                {/* Cart body */}
                <ellipse cx="170" cy="220" rx="90" ry="6" fill="rgba(0,0,0,0.08)"/>
                <path d="M95,60 L105,140 L235,140 L245,60 Z" fill="#fff" stroke="#6EE7B7" strokeWidth="2" rx="8"/>
                <rect x="95" y="52" width="150" height="16" rx="8" fill="#fff" stroke="#6EE7B7" strokeWidth="2"/>
                <circle cx="125" cy="155" r="12" fill="#10B981"/>
                <circle cx="215" cy="155" r="12" fill="#10B981"/>
                {/* Cart items */}
                {[['💎','Gold Ring','₹4,999','1'],['👟','Sneakers','₹2,499','2']].map(([icon,name,price,qty],i) => (
                  <g key={i} className="sc-anim-rise" style={{animationDelay:`${i*0.25}s`}}>
                    <rect x="110" y={70+i*34} width="120" height="28" rx="6" fill="#F0FDF4" stroke="#BBF7D0" strokeWidth="1"/>
                    <text x="118" y={89+i*34} fontSize="14">{icon}</text>
                    <text x="138" y={87+i*34} fontSize="8" fill="#065F46" fontWeight="600">{name}</text>
                    <text x="138" y={97+i*34} fontSize="7" fill="#059669">{price}</text>
                    <rect x="200" y={76+i*34} width="24" height="16" rx="4" fill="#10B981"/>
                    <text x="212" y={87+i*34} textAnchor="middle" fontSize="7" fill="#fff" fontWeight="bold">×{qty}</text>
                  </g>
                ))}
                {/* Total */}
                <rect x="110" y="140" width="120" height="1" fill="#BBF7D0"/>
                <text x="120" y="156" fontSize="9" fill="#065F46">Total</text>
                <text x="222" y="156" textAnchor="end" fontSize="10" fill="#065F46" fontWeight="bold">₹9,997</text>
                {/* Pay button */}
                <rect x="110" y="165" width="120" height="28" rx="10" fill="#10B981" className="sc-anim-pulse"/>
                <text x="170" y="183" textAnchor="middle" fontSize="10" fill="#fff" fontWeight="bold">Pay Now 💳</text>
                {/* UPI logos floating */}
                <rect x="32" y="100" width="48" height="28" rx="6" fill="#fff" stroke="#10B981" strokeWidth="1.5" className="sc-anim-float" style={{animationDelay:'0s'}}/>
                <text x="56" y="119" textAnchor="middle" fontSize="8" fill="#10B981" fontWeight="bold">UPI</text>
                <rect x="260" y="100" width="48" height="28" rx="6" fill="#fff" stroke="#10B981" strokeWidth="1.5" className="sc-anim-float" style={{animationDelay:'0.8s'}}/>
                <text x="284" y="119" textAnchor="middle" fontSize="8" fill="#1a56db" fontWeight="bold">Card</text>
                {/* Checkmark success */}
                <circle cx="170" cy="38" r="20" fill="#10B981" className="sc-anim-pop"/>
                <text x="170" y="46" textAnchor="middle" fontSize="18">✓</text>
                <text x="170" y="20" textAnchor="middle" fontSize="7" fill="#065F46">Order Placed!</text>
              </svg>
            </div>
          </div>
        </div>

        {/* SLIDE 3 — Delivery */}
        <div className={`sc-slide${active === 3 ? ' sc-slide-active' : ''}`} style={{background:'linear-gradient(135deg,#FFF7ED,#FFEDD5)'}}>
          <div className="sc-slide-inner">
            <div className="sc-slide-text">
              <div className="sc-slide-tag" style={{color:'#9A3412',background:'#FED7AA'}}>🚚 Doorstep delivery</div>
              <h3>Track Orders, Delight Customers</h3>
              <p>Real-time order status from Confirmed to Delivered. Your customers track their parcel — you build trust.</p>
            </div>
            <div className="sc-slide-art">
              <svg viewBox="0 0 340 240" width="340" height="240" style={{overflow:'visible'}}>
                {/* Road */}
                <rect x="0" y="185" width="340" height="20" fill="#D1D5DB"/>
                <rect x="0" y="191" width="340" height="2" fill="#9CA3AF"/>
                {/* Dashed road line */}
                {[0,1,2,3,4,5].map(i => (
                  <rect key={i} x={i*56+10} y="195" width="30" height="3" rx="1" fill="#fff" opacity="0.6"/>
                ))}
                {/* Delivery van */}
                <g className="sc-anim-drive">
                  {/* Van body */}
                  <rect x="60" y="140" width="120" height="50" rx="8" fill="#F5971E"/>
                  {/* Windshield */}
                  <rect x="145" y="148" width="30" height="30" rx="4" fill="#BFDBFE"/>
                  {/* Cab */}
                  <rect x="155" y="135" width="30" height="20" rx="4" fill="#EA6C00"/>
                  {/* Wheels */}
                  <circle cx="90" cy="195" r="12" fill="#374151"/>
                  <circle cx="90" cy="195" r="5" fill="#9CA3AF"/>
                  <circle cx="160" cy="195" r="12" fill="#374151"/>
                  <circle cx="160" cy="195" r="5" fill="#9CA3AF"/>
                  {/* Logo on van */}
                  <text x="105" y="168" textAnchor="middle" fontSize="11" fill="#fff" fontWeight="bold">ShopClaude</text>
                  <text x="105" y="180" textAnchor="middle" fontSize="9" fill="rgba(255,255,255,0.85)">📦 Express</text>
                  {/* Headlight */}
                  <ellipse cx="184" cy="168" rx="5" ry="3" fill="#FEF08A" opacity="0.9"/>
                </g>
                {/* House destination */}
                <g transform="translate(250,110)">
                  <polygon points="40,50 0,50 0,20 20,0 40,20" fill="#FCA5A5" stroke="#F87171" strokeWidth="1.5"/>
                  <rect x="14" y="30" width="12" height="20" fill="#fff"/>
                  <text x="20" y="20" textAnchor="middle" fontSize="14">🏠</text>
                </g>
                {/* Package bounce at house */}
                <text x="290" y="140" fontSize="22" className="sc-anim-bounce" style={{animationDelay:'1s'}}>📦</text>
                {/* Track status pills */}
                {[['✅','Confirmed'],['🔄','Packed'],['🚚','Shipped'],['🎉','Delivered']].map(([icon,lbl],i) => (
                  <g key={i} className="sc-anim-rise" style={{animationDelay:`${i*0.2}s`}}>
                    <rect x={10+i*80} y="28" width="72" height="28" rx="14" fill={i===3?'#F97316':'#fff'} stroke={i===3?'#F97316':'#FCD9A8'} strokeWidth="1.5"/>
                    <text x={10+i*80+36} y="43" textAnchor="middle" fontSize="8" fill={i===3?'#fff':'#92400E'} fontWeight={i===3?'bold':'normal'}>{icon} {lbl}</text>
                  </g>
                ))}
                {/* Map pin path */}
                <path d="M180,185 Q220,150 260,160" stroke="#F97316" strokeWidth="2" strokeDasharray="6,4" fill="none" opacity="0.6"/>
              </svg>
            </div>
          </div>
        </div>

      </div>

      {/* Dot navigation */}
      <div className="sc-slider-dots">
        {slides.map((_, i) => (
          <button key={i} className={`sc-slider-dot${active === i ? ' active' : ''}`} onClick={() => setActive(i)} />
        ))}
      </div>
    </div>
  );
}

/* ── Main Landing Page ── */
export default function LandingPage() {
  const [showSignup, setShowSignup] = useState(false);
  const [showSignin, setShowSignin] = useState(false);
  const [heroShopName, setHeroShopName] = useState('');
  const [signupPlan, setSignupPlan] = useState('STARTER');
  const [pricingCycle, setPricingCycle] = useState('monthly');

  const openSignup = (name = '', plan = 'STARTER') => { setHeroShopName(name); setSignupPlan(plan); setShowSignup(true); setShowSignin(false); };
  const openSignin = () => { setShowSignin(true); setShowSignup(false); };

  const handleModalClose = (action) => {
    setShowSignup(false);
    setShowSignin(false);
    if (action === 'signup') openSignup();
    if (action === 'signin') openSignin();
  };

  const mqRow1 = [
    { icon:'🧾', title:'POS Billing',         desc:'Barcode scan, instant receipts, cash & UPI',   color:'navy'   },
    { icon:'🌐', title:'Online Store',         desc:'Products listed online automatically',          color:'blue'   },
    { icon:'📊', title:'Analytics',            desc:'Daily revenue charts & top products',           color:'purple' },
    { icon:'💳', title:'Razorpay Payments',    desc:'UPI, card & netbanking in one tap',             color:'green'  },
    { icon:'📄', title:'Digital Products',     desc:'Sell PDFs & notes, email delivery',             color:'teal'   },
    { icon:'🚀', title:'Instant Setup',        desc:'Go live in 60 seconds, no coding',              color:'orange' },
  ];
  const mqRow2 = [
    { icon:'📦', title:'Inventory',            desc:'Real-time stock & low-alert notifications',     color:'indigo' },
    { icon:'🏷️', title:'Label Printing',       desc:'5 sticker formats, bulk printing',              color:'pink'   },
    { icon:'🚚', title:'Shipping Labels',       desc:'FROM/TO labels printed per order',              color:'amber'  },
    { icon:'🔒', title:'Secure & Cloud',        desc:'Encrypted, backed up, any device',              color:'slate'  },
    { icon:'🎉', title:'Festive Sales',         desc:'Seasonal offers with discount badges',          color:'red'    },
    { icon:'📱', title:'Mobile Ready',          desc:'Manage your whole store from your phone',       color:'cyan'   },
  ];

  const steps = [
    { num: 1, icon: '📝', title: 'Sign up in 60 seconds', desc: 'Pick your shop name, set your URL, and you\'re ready.' },
    { num: 2, icon: '📦', title: 'Add your products', desc: 'Upload products with photos, prices, and barcodes.' },
    { num: 3, icon: '🚀', title: 'Start selling', desc: 'Bill at the counter, sell online, track everything.' },
  ];

  const plans = [
    {
      name: 'STARTER',
      popular: true,
      features: ['Only store (online only)', 'Free sub-domain', '2 product photos', 'Normal sale (without labels)'],
      monthly: { price: '₹999',   display: '₹999' },
      yearly:  { price: '₹9,588', display: '₹799' },
    },
    {
      name: 'PRO',
      popular: false,
      features: ['Online & offline selling (POS)', 'Free sub-domain', 'Up to 6 product photos', 'Festive sale with shipping labels'],
      monthly: { price: '₹1,699',  display: '₹1,699' },
      yearly:  { price: '₹16,308', display: '₹1,359' },
    },
  ];

  return (
    <div className="sc-page">

      {/* Navbar */}
      <nav className="sc-nav">
        <a className="sc-nav-logo" href="/">
          <img src="/logo.png" alt="theshopclaude" style={{width:56,height:56,objectFit:'contain',borderRadius:6}} />
          <div className="sc-nav-logo-text">theshopclaude</div>
        </a>
        <div className="sc-nav-links">
          <button className="sc-nav-link" onClick={() => document.getElementById('sc-features').scrollIntoView({ behavior: 'smooth' })}>Features</button>
          <button className="sc-nav-link" onClick={() => document.getElementById('sc-pricing').scrollIntoView({ behavior: 'smooth' })}>Pricing</button>
          <button className="sc-btn-outline" onClick={openSignin}>Sign In</button>
          <button className="sc-btn-primary" onClick={() => openSignup('')}>Get Started</button>
        </div>
      </nav>

      {/* Hero */}
      <HeroSection
        heroShopName={heroShopName}
        setHeroShopName={setHeroShopName}
        openSignup={openSignup}
        openSignin={openSignin}
      />

      {/* Animated Slider */}
      <StoreSlider />

      {/* Features — animated marquee */}
      <section className="sc-section sc-section-center" id="sc-features" style={{overflow:'hidden',paddingBottom:60}}>
        <div className="sc-section-tag">Everything you need</div>
        <div className="sc-section-title">One platform, all your retail tools</div>
        <div className="sc-section-sub">From the billing counter to your online store — manage everything without juggling multiple apps.</div>

        <div className="sc-feat-marquee-outer">
          {/* Row 1 — scrolls left */}
          <div className="sc-mq-row">
            <div className="sc-mq-track sc-mq-left">
              {[...mqRow1, ...mqRow1].map((f, i) => (
                <div key={i} className={`sc-mq-card sc-mq-${f.color}`}>
                  <span className="sc-mq-icon">{f.icon}</span>
                  <div className="sc-mq-title">{f.title}</div>
                  <div className="sc-mq-desc">{f.desc}</div>
                </div>
              ))}
            </div>
          </div>
          {/* Row 2 — scrolls right */}
          <div className="sc-mq-row">
            <div className="sc-mq-track sc-mq-right">
              {[...mqRow2, ...mqRow2].map((f, i) => (
                <div key={i} className={`sc-mq-card sc-mq-${f.color}`}>
                  <span className="sc-mq-icon">{f.icon}</span>
                  <div className="sc-mq-title">{f.title}</div>
                  <div className="sc-mq-desc">{f.desc}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* How it works */}
      <section className="sc-section sc-section-alt sc-section-center">
        <div className="sc-section-tag">Simple onboarding</div>
        <div className="sc-section-title">Up and running in minutes</div>
        <div className="sc-section-sub">No training needed. If you can use WhatsApp, you can use ShopClaude.</div>
        <div className="sc-steps">
          {steps.flatMap((s, i) => [
            <div className="sc-step" key={`step-${s.num}`} style={{animationDelay: `${i * 0.15}s`}}>
              <span className="sc-step-icon">{s.icon}</span>
              <div className="sc-step-num">{s.num}</div>
              <div className="sc-step-title">{s.title}</div>
              <p className="sc-step-desc">{s.desc}</p>
            </div>,
            i < steps.length - 1 && <div className="sc-step-arrow" key={`arrow-${s.num}`}>→</div>,
          ])}
        </div>
      </section>

      {/* Pricing */}
      <section className="sc-section sc-section-center" id="sc-pricing">
        <div className="sc-section-tag">Transparent pricing</div>
        <div className="sc-section-title">Simple, honest pricing</div>
        <div className="sc-section-sub">No hidden fees. Cancel anytime.</div>

        {/* Monthly / Yearly tabs */}
        <div style={{ display: 'inline-flex', border: '1px solid var(--sc-border)', borderRadius: 30, overflow: 'hidden', marginBottom: 40, background: '#fff' }}>
          {[{ key: 'monthly', label: 'Monthly Plan' }, { key: 'yearly', label: 'Yearly Plan  🏷 Save 20%' }].map(c => (
            <button key={c.key} type="button" onClick={() => setPricingCycle(c.key)} style={{
              padding: '10px 28px', border: 'none', cursor: 'pointer',
              background: pricingCycle === c.key ? 'var(--sc-purple)' : 'transparent',
              color: pricingCycle === c.key ? '#fff' : '#6B7280',
              fontWeight: 600, fontSize: 14, borderRadius: 30,
              transition: 'all 0.2s'
            }}>
              {c.label}
            </button>
          ))}
        </div>

        <div className="sc-plans">
          {plans.map(p => {
            const pricing = p[pricingCycle];
            return (
              <div className={`sc-plan ${p.popular ? 'sc-plan-popular' : ''}`} key={p.name}>
                {p.popular && <div className="sc-plan-badge">Most Popular</div>}
                <div className="sc-plan-name">{p.name}</div>
                <div className="sc-plan-price">
                  {pricing.display}<span>/mo</span>
                </div>
                {pricingCycle === 'yearly' && (
                  <div style={{ fontSize: 12, color: '#6B7280', marginBottom: 2 }}>billed {pricing.price}/year</div>
                )}
                <div className="sc-plan-period">
                  {pricingCycle === 'monthly' ? 'per month' : 'Save 20% vs monthly'}
                </div>
                <ul className="sc-plan-features">
                  {p.features.map(f => <li key={f}><span className="sc-check">✓</span>{f}</li>)}
                </ul>
                <button
                  className={p.popular ? 'sc-btn-purple' : 'sc-btn-outline'}
                  style={{ width: '100%', padding: '11px' }}
                  onClick={() => openSignup('', p.name)}>
                  {`Get ${p.name}`}
                </button>
              </div>
            );
          })}
        </div>
      </section>

      {/* CTA Banner */}
      <section className="sc-cta-banner">
        <h2>Ready to modernise your shop?</h2>
        <p>Join hundreds of retail stores already growing with ShopClaude.</p>
        <button className="sc-btn-primary" style={{ fontSize: 16, padding: '14px 36px' }}
          onClick={() => openSignup('')}>
          Get Started Now →
        </button>
      </section>

      {/* Footer */}
      <footer className="sc-footer">
        <div className="sc-footer-top">
          <div className="sc-footer-brand">
            <div className="sc-footer-logo">
              <img src="/logo.png" alt="theshopclaude" style={{width:40,height:40,objectFit:'contain'}} />
              <div className="sc-footer-logo-text">theshopclaude</div>
            </div>
            <p className="sc-footer-tagline">The complete retail management platform for Indian sellers.</p>
          </div>
          <div className="sc-footer-col">
            <div className="sc-footer-col-title">Product</div>
            <a onClick={() => document.getElementById('sc-features').scrollIntoView({ behavior: 'smooth' })}>Features</a>
            <a onClick={() => document.getElementById('sc-pricing').scrollIntoView({ behavior: 'smooth' })}>Pricing</a>
            <a onClick={() => openSignup('')}>Sign Up</a>
          </div>
          <div className="sc-footer-col">
            <div className="sc-footer-col-title">Support</div>
            <a>WhatsApp Support</a>
            <a>Email Us</a>
            <a onClick={openSignin}>Sign In</a>
          </div>
          <div className="sc-footer-col">
            <div className="sc-footer-col-title">Legal</div>
            <a>Privacy Policy</a>
            <a>Terms of Service</a>
            <a>Refund Policy</a>
          </div>
        </div>
        <div className="sc-footer-bottom">
          © 2026 ShopClaude. All rights reserved. Made in India 🇮🇳
        </div>
      </footer>

      {/* Modals */}
      {showSignup && (
        <SignupModal
          initialShopName={heroShopName}
          initialPlan={signupPlan}
          onClose={handleModalClose}
          onSuccess={() => {}}
        />
      )}
      {showSignin && <SigninModal onClose={handleModalClose} />}
    </div>
  );
}
