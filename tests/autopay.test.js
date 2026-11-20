// অটো পেমেন্ট টেস্ট (MongoDB ছাড়াই, in-memory ফেক DB দিয়ে):  node tests/autopay.test.js
const path = require('path');
const assert = require('assert');
const { Readable } = require('stream');

// ---------- ছোট in-memory "mongoose" ----------
let idn = 0;
const hex = () => (++idn).toString(16).padStart(24, '0');
function coll(unique) {
  const rows = [];
  const eq = (a, b) => String(a) === String(b);
  const hit = (d, q) => Object.entries(q).every(([k, v]) => {
    if (v && typeof v === 'object' && !(v instanceof Date)) {
      if ('$gte' in v) return d[k] >= v.$gte;
      if ('$in' in v) return v.$in.some((x) => eq(x, d[k]));
      if ('$ne' in v) return !eq(v.$ne, d[k]);
    }
    return eq(d[k], v) || (v === null && d[k] == null);
  });
  const apply = (d, u) => { if (u.$inc) for (const k in u.$inc) d[k] = (d[k] || 0) + u.$inc[k]; Object.keys(u).filter((k) => k[0] !== '$').forEach((k) => { d[k] = u[k]; }); };
  const q = (v) => ({ lean: async () => (v ? { ...v } : null), then: (a, b) => Promise.resolve(v ? { ...v } : null).then(a, b) });
  const api = {
    rows,
    async create(o) {
      if (unique && rows.some((r) => r[unique] === o[unique])) { const e = new Error('dup'); e.code = 11000; throw e; }
      const d = { _id: hex(), ...o }; rows.push(d); return { ...d };
    },
    findOne: (f) => q(rows.find((r) => hit(r, f))),
    findById: (id) => q(rows.find((r) => eq(r._id, id))),
    async findOneAndUpdate(f, u, o = {}) {
      let d = rows.find((r) => hit(r, f));
      if (!d && o.upsert) { d = { _id: hex() }; Object.entries(f).forEach(([k, v]) => { if (typeof v !== 'object') d[k] = v; }); rows.push(d); }
      if (!d) return null;
      const before = { ...d }; apply(d, u); return o.new ? { ...d } : before;
    },
    async updateOne(f, u) { const d = rows.find((r) => hit(r, f)); if (d) apply(d, u); },
    async countDocuments(f) { return rows.filter((r) => hit(r, f)).length; },
    async deleteOne(f) { const i = rows.findIndex((r) => hit(r, f)); if (i >= 0) rows.splice(i, 1); },
  };
  return api;
}
const M = { Wallet: coll('customerId'), Txn: coll(), UsedTrx: coll('trxId'), SmsPayment: coll('trxId'), AddRequest: coll(), Order: coll(), Code: coll(), Setting: coll() };
const modPath = require.resolve('../models');
require.cache[modPath] = { id: modPath, filename: modPath, loaded: true, exports: M };

process.env.SMS_WEBHOOK_KEY = 'topsecret';
const { parseSms } = require('../services/smsParse');
const smsHook = require('../services/smsHook');
const orders = require('../routes/orders');
const walletRoute = require('../routes/wallet');

// ---------- হেল্পার ----------
const HttpError = class extends Error { constructor(s, m) { super(m); this.status = s; } };
const out = {};
const deps = {
  sendJson: (res, code, obj) => { res.code = code; res.obj = obj; },
  readJson: async (req) => req.body,
  listPackages: () => [{ name: '310 Diamond', price: 255 }, { name: '100 Diamond', price: 85 }],
};
const user = { id: 'u1', name: 'T', email: 't@x' };
async function call(mod, method, pathname, body, u = user) {
  const res = {}; const req = { body, url: pathname };
  try { await mod.handle({ req, res, pathname, method, user: u, deps, HttpError, limit() {}, models: M, paymentInfo: async () => ({}) }); }
  catch (e) { res.code = e.status || 500; res.obj = { error: e.message }; }
  return res;
}
async function hook(body, headers = { 'x-webhook-secret': 'topsecret' }, url = '/api/sms-webhook') {
  const req = Readable.from([Buffer.from(typeof body === 'string' ? body : JSON.stringify(body))]);
  req.headers = headers; req.url = url; const res = {};
  await smsHook.handle({ req, res, deps, connect: async () => {}, getModels: () => M });
  return res;
}
const BK = (amt, from, trx) => ({ from: 'bKash', message: `You have received Tk ${amt} from ${from}. Fee Tk 0.00. Balance Tk 1,200.00. TrxID ${trx} at 20/11/2026 11:10` });
const order = (pkg, price, via, sender, trx, u = user) => call(orders, 'POST', '/api/orders', { packageName: pkg, price, uid: '123456789', payMethod: 'instant', via, senderNumber: sender, trxId: trx }, u);
const user2 = { id: 'u2', name: 'T2', email: 't2@x' };
const bal = () => (M.Wallet.rows.find((w) => w.customerId === 'u1') || {}).balance || 0;
let n = 0; const ok = (name) => console.log('✓', name, ++n);

(async () => {
  // ---- পার্সার
  assert.deepStrictEqual(parseSms(BK('255.00', '01712345678', '9KD3XYZ12A').message, 'bKash'), { method: 'bkash', amount: 255, sender: '01712345678', trxId: '9KD3XYZ12A' });
  assert.strictEqual(parseSms('You have sent Tk 100 to 01711111111. TrxID AAAAAAAAAA', 'bKash'), null);
  assert.strictEqual(parseSms('Cash Out Tk 500 TrxID AAAAAAAAAA received', 'bKash'), null);
  const ng = parseSms('Money Received. Amount: Tk 85.00 Sender: 01811111111 Ref: N/A TxnID: 71ABCDEF Balance: Tk 600.00', 'NAGAD');
  assert.deepStrictEqual([ng.method, ng.amount, ng.sender, ng.trxId], ['nagad', 85, '01811111111', '71ABCDEF']);
  const rk = parseSms('Tk500.00 received from A/C: 017123456789 Fee: Tk0, Your A/C Balance: Tk 1000 TxnId: 1234567890', '16216');
  assert.deepStrictEqual([rk.method, rk.amount, rk.sender, rk.trxId], ['rocket', 500, '01712345678', '1234567890']);
  assert.strictEqual(parseSms('You have received payment Tk 1,000.00 from 01712345678. Balance Tk 5. TrxID 5ABCDEF123', 'bKash').amount, 1000);
  ok('SMS parser');

  // ---- নিরাপত্তা
  assert.strictEqual((await hook(BK('1', '01712345678', 'ZZZZZZZZZZ'), { 'x-webhook-secret': 'bad' })).code, 401);
  assert.strictEqual((await hook(BK('1', '01712345678', 'ZZZZZZZZZZ'), {})).code, 401);
  assert.strictEqual((await hook(BK('1', '01712345678', 'ZZZZZZZZZZ'), {}, '/api/sms-webhook?secret=topsecret')).obj.ok, true); // query secret
  assert.strictEqual((await hook('hello world, not a payment')).obj.ignored, true);
  ok('webhook secret + ignore non-payment SMS');

  // ---- কেস ১: অর্ডার আগে, SMS পরে
  let r = await order('310 Diamond', 255, 'bkash', '01712345678', '9KD3XYZ12A');
  assert.strictEqual(r.code, 200); assert.strictEqual(r.obj.verified, false);
  const oid = r.obj.order._id;
  let st = await call(orders, 'GET', '/api/orders/' + oid); assert.strictEqual(st.obj.paid, false);
  r = await hook(BK('255.00', '01712345678', '9KD3XYZ12A')); assert.strictEqual(r.obj.matched, 'order');
  st = await call(orders, 'GET', '/api/orders/' + oid); assert.strictEqual(st.obj.paid, true); assert.strictEqual(st.obj.autoVerified, true);
  ok('order first, SMS later → auto paid');

  // ---- কেস ২: SMS আগে, অর্ডার পরে → সাথে সাথে
  await hook(BK('85.00', '01912345678', '8AAAAAAA11'));
  r = await order('100 Diamond', 85, 'bkash', '01912345678', '8AAAAAAA11');
  assert.strictEqual(r.obj.verified, true); assert.strictEqual(r.obj.order.paid, true);
  ok('SMS first, order later → instantly paid');

  // ---- কেস ৩: একই TrxID আবার ব্যবহার
  r = await order('100 Diamond', 85, 'bkash', '01912345678', '8AAAAAAA11'); assert.strictEqual(r.code, 409);
  ok('TrxID reuse blocked');

  // ---- কেস ৪: কম টাকা / ভুল মাধ্যম / ভুল প্রেরক → পেইড না
  await hook(BK('50.00', '01912345678', '7BBBBBBB22'));
  r = await order('310 Diamond', 255, 'bkash', '01912345678', '7BBBBBBB22'); assert.strictEqual(r.obj.verified, false);
  await hook({ from: 'NAGAD', message: 'Money Received. Amount: Tk 255.00 Sender: 01811111111 Ref: N/A TxnID: 66CCCCCC Balance: Tk 600' });
  r = await order('310 Diamond', 255, 'bkash', '01811111111', '66CCCCCC'); assert.strictEqual(r.obj.verified, false);
  await hook(BK('255.00', '01711111111', '55DDDDDD55'));
  r = await order('310 Diamond', 255, 'bkash', '01722222222', '55DDDDDD55'); assert.strictEqual(r.obj.verified, false);
  assert.strictEqual(M.SmsPayment.rows.find((x) => x.trxId === '55DDDDDD55').used, false);
  ok('underpay / wrong method / wrong sender not auto-paid');

  // ---- কেস ৫: বেশি টাকা পাঠালে চলবে
  await hook(BK('300.00', '01733333333', '44EEEEEE44'));
  r = await order('310 Diamond', 255, 'bkash', '01733333333', '44EEEEEE44', user2); assert.strictEqual(r.obj.verified, true);
  // ৩টি খোলা অর্ডারের পর চতুর্থটা আটকায় (বিদ্যমান লিমিট)
  r = await order('310 Diamond', 255, 'bkash', '01733333333', '99XXXXXXXX'); assert.strictEqual(r.code, 429);
  ok('overpay accepted');

  // ---- কেস ৬: টাকা যোগ (add money) — একবারই ক্রেডিট, SMS রিপ্লে করলেও না
  r = await call(walletRoute, 'POST', '/api/wallet/add-money', { method: 'bkash', amount: 500, senderNumber: '01744444444', trxId: '33FFFFFF33', mode: 'instant' });
  assert.strictEqual(r.code, 200); assert.strictEqual(r.obj.approved, false); const rid = r.obj.id;
  assert.strictEqual(bal(), 0);
  r = await hook(BK('500.00', '01744444444', '33FFFFFF33')); assert.strictEqual(r.obj.matched, 'addmoney');
  assert.strictEqual(bal(), 500);
  await hook(BK('500.00', '01744444444', '33FFFFFF33')); await hook(BK('500.00', '01744444444', '33FFFFFF33'));
  assert.strictEqual(bal(), 500);
  st = await call(walletRoute, 'GET', '/api/wallet/requests/' + rid); assert.strictEqual(st.obj.paid, true);
  ok('add-money auto credited exactly once');

  // ---- কেস ৭: add money, SMS আগে এসেছে
  await hook(BK('200.00', '01755555555', '22GGGGGG22'));
  r = await call(walletRoute, 'POST', '/api/wallet/add-money', { method: 'bkash', amount: 200, senderNumber: '01755555555', trxId: '22GGGGGG22', mode: 'instant' });
  assert.strictEqual(r.obj.approved, true); assert.strictEqual(bal(), 700);
  ok('add-money with SMS already received');

  // ---- কেস ৮: দুই SMS একসাথে এলে একবারই ক্লেইম (রেস)
  await order('310 Diamond', 255, 'bkash', '01766666666', '11HHHHHH11', user2);
  await hook(BK('255.00', '01766666666', '11HHHHHH11'));
  const { settle } = require('../services/paymentVerify');
  const both = await Promise.all([settle('11HHHHHH11'), settle('11HHHHHH11')]);
  assert.strictEqual(both.filter(Boolean).length, 0); // আগেই হয়ে গেছে, আর কিছু হবে না
  assert.strictEqual(M.Order.rows.filter((o) => o.trxId === '11HHHHHH11' && o.paid).length, 1);
  ok('no double settle');

  console.log('\nসব টেস্ট পাস ✅', n);
})().catch((e) => { console.error('FAIL', e); process.exit(1); });
