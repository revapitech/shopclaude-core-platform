/**
 * Razorpay Checkout helper — shared by every payment flow (storefront orders,
 * digital products, plan upgrades, signup payments and e-mandates).
 *
 * Rules:
 *  - The Key ID ALWAYS comes from the backend's order/subscription response. No
 *    key is read from env or hardcoded, so Test/Live is purely a backend setting.
 *  - The Key Secret is never read, sent or stored in the browser.
 *  - Order creation and signature verification stay on the backend; callers
 *    only pass the checkout `handler` result back to it.
 */

const CHECKOUT_SRC = 'https://checkout.razorpay.com/v1/checkout.js';
let scriptPromise = null;

function userError(message) {
  const e = new Error(message);
  e.userMessage = message;
  return e;
}

/** Loads checkout.js once. Resolves true/false (never rejects). */
export function loadRazorpayScript() {
  if (typeof window === 'undefined') return Promise.resolve(false);
  if (window.Razorpay) return Promise.resolve(true);
  if (!scriptPromise) {
    scriptPromise = new Promise(resolve => {
      const s = document.createElement('script');
      s.src = CHECKOUT_SRC;
      s.onload = () => resolve(true);
      s.onerror = () => { scriptPromise = null; s.remove(); resolve(false); };
      document.body.appendChild(s);
    });
  }
  return scriptPromise;
}

/**
 * 'test' | 'live' | 'unknown'. Prefers the backend's explicit mode
 * (`mode` / `paymentMode` / `testMode`), falling back to the Key ID prefix
 * Razorpay itself assigns (rzp_test_… / rzp_live_…).
 */
export function getPaymentMode(data) {
  const explicit = String(data?.mode ?? data?.paymentMode ?? '').toLowerCase();
  if (explicit === 'test' || explicit === 'live') return explicit;
  if (typeof data?.testMode === 'boolean') return data.testMode ? 'test' : 'live';
  const key = String(data?.keyId || '');
  if (key.startsWith('rzp_test_')) return 'test';
  if (key.startsWith('rzp_live_')) return 'live';
  return 'unknown';
}

/**
 * Opens Razorpay Checkout using the Key ID the backend returned.
 *
 * @param {object} serverData  backend response: { keyId, mode?, ... }
 * @param {object} options     Razorpay options WITHOUT `key` (amount, order_id, handler, …)
 * @param {object} [hooks]     { onFailed(response) }
 * @returns {Promise<object>}  the Razorpay instance (already opened)
 * @throws  Error with `.userMessage` when the gateway can't be started
 */
export async function openRazorpayCheckout(serverData, options, hooks = {}) {
  const keyId = serverData?.keyId;
  if (!keyId || typeof keyId !== 'string') {
    throw userError('Online payments are not set up for this shop yet. Please contact the shop owner.');
  }
  if (!(await loadRazorpayScript()) || !window.Razorpay) {
    throw userError('Could not load the payment gateway. Please check your connection and try again.');
  }

  const mode = getPaymentMode(serverData);
  const opts = { ...options, key: keyId };
  if (mode === 'test') {
    // Make it obvious inside the checkout window that no real money moves.
    opts.description = `${opts.description || 'Payment'} [TEST MODE]`;
    opts.notes = { ...(opts.notes || {}), payment_mode: 'test' };
  }

  const rzp = new window.Razorpay(opts);
  if (hooks.onFailed) rzp.on('payment.failed', hooks.onFailed);
  rzp.open();
  return rzp;
}

/** Message for a failed start-of-payment call (axios error, fetch body or our own error). */
export function paymentStartError(err, fallback = 'Could not start payment. Please try again.') {
  return err?.userMessage || err?.response?.data?.error || err?.response?.data?.message || fallback;
}
