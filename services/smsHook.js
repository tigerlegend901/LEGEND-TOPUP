// services/smsHook.js — ফোনের SMS Forwarder অ্যাপ এখানে POST করে: POST /api/sms-webhook
// সিক্রেট: হেডার "x-webhook-secret" (বা "x-sms-key") অথবা URL-এ ?secret=... ; মান = env SMS_WEBHOOK_KEY
// Body: JSON {"from":"bKash","message":"You have received Tk ..."} (form বা সাধারণ লেখাও চলে)
const crypto = require('crypto');
const { parseSms } = require('./smsParse');
const { settle } = require('./paymentVerify');
const telegram = require('./telegram');

function secretOk(given) {
  const want = (process.env.SMS_WEBHOOK_KEY || process.env.SMS_WEBHOOK_SECRET || '').trim();
  if (!want || !given) return false;
  const a = Buffer.from(String(given)), b = Buffer.from(want);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function readRaw(req, limit) {
  return new Promise((resolve, reject) => {
    let n = 0; const chunks = [];
    req.on('data', (c) => { n += c.length; if (n > limit) { reject(new Error('too_large')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function extract(raw, query) {
  let text = '', from = '';
  const pick = (o) => {
    text = o.message || o.text || o.body || o.sms || o.content || o.msg || text;
    from = o.from || o.sender || o.address || o.number || o.phone || from;
  };
  let parsed = null;
  try { parsed = JSON.parse(raw); } catch (_) {}
  if (parsed && typeof parsed === 'object') pick(parsed);
  else if (/^[\w.\-\[\]]+=/.test(raw)) { try { pick(Object.fromEntries(new URLSearchParams(raw))); } catch (_) {} }
  else text = raw;
  if (!text && query) pick(Object.fromEntries(query));
  return { text: String(text || ''), from: String(from || '') };
}

async function handle({ req, res, deps, connect, getModels }) {
  const url = new URL(req.url, 'http://x');
  if (!(process.env.SMS_WEBHOOK_KEY || process.env.SMS_WEBHOOK_SECRET || '').trim())
    return deps.sendJson(res, 503, { error: 'SMS_WEBHOOK_KEY not set' });
  const given = req.headers['x-webhook-secret'] || req.headers['x-sms-key'] || url.searchParams.get('secret') || url.searchParams.get('key');
  if (!secretOk(given)) return deps.sendJson(res, 401, { error: 'bad key' });

  const raw = await readRaw(req, 16 * 1024);
  const { text, from } = extract(raw, url.searchParams);
  const sms = parseSms(text, from);
  if (!sms) return deps.sendJson(res, 200, { ok: true, ignored: true }); // টাকা-পাওয়ার SMS না, বাদ

  await connect();
  const { SmsPayment } = getModels();
  try { await SmsPayment.create({ trxId: sms.trxId, amount: sms.amount, method: sms.method, sender: sms.sender, raw: text.slice(0, 500), used: false }); }
  catch (e) { if (!(e && e.code === 11000)) throw e; } // একই SMS দুবার এলে সমস্যা নেই

  const r = await settle(sms.trxId, { notify: telegram.notifyAutoPaid });
  return deps.sendJson(res, 200, { ok: true, trxId: sms.trxId, matched: r ? r.kind : null });
}

module.exports = { handle, secretOk };
