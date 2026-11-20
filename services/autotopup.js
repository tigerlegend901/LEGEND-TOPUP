// services/autotopup.js — অটো টপআপ (ডেলিভারি) সিস্টেম।
// অর্ডার "paid" হওয়ার পর (ওয়ালেট পে / SMS অটো-ভেরিফাই) এই ফাইল আপনার AUTO TOPUP API-কে ডাকে।
// সফল হলে অর্ডার নিজে Completed হয়। ব্যর্থ হলে অর্ডার Pending থাকে, অ্যাডমিন প্যানেল থেকে Retry / হাতে Deliver করা যায়।
//
// কনফিগ: অ্যাডমিন প্যানেল → "Auto Topup" (MongoDB-তে সেভ হয়) অথবা Environment Variable:
//   AUTO_TOPUP_API_KEY   = API-12345678            (আপনার API কী)
//   AUTO_TOPUP_API_URL   = https://provider.com/api/topup   (প্রোভাইডারের topup endpoint)
//   AUTO_TOPUP_AUTH      = bearer | header | body | query  (ডিফল্ট: bearer)
//   AUTO_TOPUP_ENABLED   = 1  (অ্যাডমিন প্যানেলে একবার সেভ করলে সেটাই চলবে)
//
// ⚠️ প্রোভাইডারভেদে রিকোয়েস্ট/রেসপন্সের ফরম্যাট আলাদা। নিচের buildRequest() ও isSuccess() আপনার
// প্রোভাইডারের ডকুমেন্টেশন অনুযায়ী মিলিয়ে নিন (শুধু এই দুটো ফাংশনই বদলাতে হবে)।

const AUTH_MODES = ['bearer', 'header', 'body', 'query'];

function envConfig() {
  return {
    enabled: /^(1|true|yes|on)$/i.test(String(process.env.AUTO_TOPUP_ENABLED || '').trim()) || !!(process.env.AUTO_TOPUP_API_KEY && process.env.AUTO_TOPUP_API_URL && process.env.AUTO_TOPUP_ENABLED == null),
    url: (process.env.AUTO_TOPUP_API_URL || '').trim(),
    key: (process.env.AUTO_TOPUP_API_KEY || '').trim(),
    auth: (process.env.AUTO_TOPUP_AUTH || 'bearer').trim().toLowerCase(),
    map: {}
  };
}

async function getConfig() {
  const env = envConfig();
  try {
    const { Setting } = require('../models');
    const d = await Setting.findOne({ key: 'autotopup' }).lean();
    const v = (d && d.value) || null;
    if (!v) return env;
    return {
      enabled: typeof v.enabled === 'boolean' ? v.enabled : env.enabled,
      url: typeof v.url === 'string' && v.url ? v.url : env.url,
      key: typeof v.key === 'string' && v.key ? v.key : env.key,
      auth: AUTH_MODES.includes(v.auth) ? v.auth : env.auth,
      map: v.map && typeof v.map === 'object' ? v.map : {}
    };
  } catch (_) { return env; }
}

// ---- প্রোভাইডারের ফরম্যাট (দরকারে এখানে বদলান) ----
function buildRequest(cfg, order, code) {
  const payload = { uid: String(order.uid), package: String(code), order_id: String(order._id), amount: Number(order.price) };
  const headers = { 'content-type': 'application/json', accept: 'application/json' };
  let url = cfg.url;
  if (cfg.auth === 'bearer') headers.authorization = 'Bearer ' + cfg.key;
  else if (cfg.auth === 'header') headers['x-api-key'] = cfg.key;
  else if (cfg.auth === 'body') payload.api_key = cfg.key;
  else if (cfg.auth === 'query') url += (url.includes('?') ? '&' : '?') + 'api_key=' + encodeURIComponent(cfg.key);
  return { url, init: { method: 'POST', headers, body: JSON.stringify(payload) } };
}
function isSuccess(httpOk, body) {
  if (!httpOk) return false;
  if (!body || typeof body !== 'object') return false;
  if (body.success === true || body.ok === true) return true;
  const s = String(body.status || body.result || '').toLowerCase();
  return ['success', 'successful', 'completed', 'complete', 'ok', 'done', 'delivered'].includes(s);
}
function refOf(body) { return String((body && (body.transaction_id || body.txn_id || body.trx_id || body.order_id || body.id || body.ref)) || '').slice(0, 100); }
function errOf(body, status) { return String((body && (body.message || body.error || body.msg)) || ('HTTP ' + status)).slice(0, 200); }

// অর্ডারটি অটো ডেলিভারির যোগ্য কিনা দেখে চালায়। কখনো throw করে না।
// ফেরত: { ok, state: 'done'|'skipped'|'failed', reason }
async function deliver(orderId, opts) {
  const force = !!(opts && opts.force);
  let Order;
  try { ({ Order } = require('../models')); } catch (e) { return { ok: false, state: 'failed', reason: 'models' }; }
  let claimed = null;
  try {
    const cfg = await getConfig();
    if (!cfg.enabled || !cfg.url || !cfg.key) return { ok: false, state: 'skipped', reason: 'অটো টপআপ চালু/কনফিগার করা নেই' };

    const peek = await Order.findById(orderId).lean();
    if (!peek) return { ok: false, state: 'skipped', reason: 'order not found' };
    const code = cfg.map[peek.packageName];
    if (!code) return { ok: false, state: 'skipped', reason: 'এই প্যাকেজের API কোড সেট করা নেই' };

    // একবারই ক্লেইম — একসাথে দুবার ডাকলেও দুবার টপআপ হবে না
    const allowed = force ? ['none', 'failed', null] : ['none', null]; // null = পুরনো অর্ডার (ফিল্ড নেই)
    claimed = await Order.findOneAndUpdate(
      { _id: orderId, paid: true, status: 'Pending', delivery: { $in: allowed } },
      { delivery: 'processing', deliveryError: '' }, { new: true });
    if (!claimed) return { ok: false, state: 'skipped', reason: 'অর্ডার যোগ্য নয় (পেইড নয় / আগেই হয়েছে)' };

    const req = buildRequest(cfg, claimed, code);
    let res, body = null;
    try {
      res = await fetch(req.url, Object.assign({ signal: AbortSignal.timeout(25000) }, req.init));
      body = await res.json().catch(() => null);
    } catch (e) {
      // টাইমআউট/নেটওয়ার্ক: টপআপ হয়ে গেছে কিনা জানা নেই — অ্যাডমিনকে প্রোভাইডারে দেখে নিতে বলা হয়
      const msg = 'API-র সাথে যোগাযোগ হয়নি (' + (e && e.message) + ') — প্রোভাইডারে চেক করে তারপর Retry করুন';
      await Order.updateOne({ _id: orderId }, { delivery: 'failed', deliveryError: msg.slice(0, 200) });
      return { ok: false, state: 'failed', reason: msg };
    }
    if (isSuccess(res.ok, body)) {
      const done = await Order.findOneAndUpdate({ _id: orderId }, { status: 'Completed', delivery: 'done', deliveryRef: refOf(body), deliveryError: '', adminNote: 'Auto topup' }, { new: true });
      return { ok: true, state: 'done', order: done };
    }
    const reason = errOf(body, res.status);
    await Order.updateOne({ _id: orderId }, { delivery: 'failed', deliveryError: reason });
    return { ok: false, state: 'failed', reason };
  } catch (e) {
    console.error('autotopup error:', e && e.message);
    if (claimed) await Order.updateOne({ _id: orderId, delivery: 'processing' }, { delivery: 'failed', deliveryError: String(e && e.message).slice(0, 200) }).catch(() => {});
    return { ok: false, state: 'failed', reason: e && e.message };
  }
}

module.exports = { deliver, getConfig, AUTH_MODES, buildRequest, isSuccess };
