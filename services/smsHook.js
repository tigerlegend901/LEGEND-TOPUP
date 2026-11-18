// services/smsHook.js — ফোন থেকে আসা SMS সেভ করে, আর আগে থেকে "Pending" থাকা মিলে যাওয়া অনুরোধ নিজে Approve করে।
const crypto = require('crypto');
const { parseSms, sameNumber } = require('./smsParse');

function keyOk(given) {
  const want = (process.env.SMS_WEBHOOK_KEY || '').trim();
  if (!want || !given) return false;
  const a = Buffer.from(String(given)), b = Buffer.from(want);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

async function readRaw(req, limit) {
  return new Promise((resolve, reject) => {
    let n = 0; const chunks = [];
    req.on('data', (c) => { n += c.length; if (n > limit) { reject(new Error('too_large')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

// JSON, form (a=b&c=d) বা সাধারণ লেখা — তিনটাই চলবে
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

async function reconcile(sms, models, wallet) {
  const { SmsPayment, AddRequest, Order } = models;
  const claim = () => SmsPayment.findOneAndUpdate({ trxId: sms.trxId, used: false }, { used: true });
  const fits = (amt, method, sender) =>
    sms.amount + 0.001 >= Number(amt) && (!sms.method || !method || sms.method === method) && (!sms.sender || !sender || sameNumber(sms.sender, sender));

  const ar = await AddRequest.findOne({ trxId: sms.trxId, status: 'pending' });
  if (ar && fits(ar.amount, ar.method, ar.senderNumber)) {
    if (await claim()) {
      const done = await AddRequest.findOneAndUpdate({ _id: ar._id, status: 'pending' }, { status: 'approved', autoVerified: true });
      if (done) await wallet.credit(ar.customerId, ar.amount, 'Add money (' + ar.method + ')', ar._id);
      return 'addmoney';
    }
    return null;
  }
  const od = await Order.findOne({ trxId: sms.trxId, payMethod: 'instant', paid: false, status: 'Pending' });
  if (od && fits(od.price, od.via, od.senderNumber)) {
    if (await claim()) {
      await Order.updateOne({ _id: od._id, paid: false }, { paid: true, autoVerified: true });
      return 'order';
    }
  }
  return null;
}

async function handle({ req, res, deps, connect, getModels }) {
  const url = new URL(req.url, 'http://x');
  const given = req.headers['x-sms-key'] || url.searchParams.get('key');
  if (!(process.env.SMS_WEBHOOK_KEY || '').trim()) return deps.sendJson(res, 503, { error: 'SMS_WEBHOOK_KEY not set' });
  if (!keyOk(given)) return deps.sendJson(res, 401, { error: 'bad key' });
  const raw = await readRaw(req, 16 * 1024);
  const { text, from } = extract(raw, url.searchParams);
  const sms = parseSms(text, from);
  if (!sms) return deps.sendJson(res, 200, { ok: true, ignored: true }); // টাকা-পাওয়ার SMS না, বাদ
  await connect();
  const models = getModels();
  const wallet = require('./wallet');
  try { await models.SmsPayment.create({ trxId: sms.trxId, amount: sms.amount, method: sms.method, sender: sms.sender, used: false }); }
  catch (e) { if (!(e && e.code === 11000)) throw e; } // একই SMS দুবার এলে সমস্যা নেই
  const matched = await reconcile(sms, models, wallet);
  return deps.sendJson(res, 200, { ok: true, trxId: sms.trxId, matched: matched || null });
}

module.exports = { handle };
