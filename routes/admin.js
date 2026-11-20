// routes/admin.js — admin API (uses the same admin login token as /admin, header "Authorization: Bearer <token>")
const wallet = require('../services/wallet');
const autotopup = require('../services/autotopup');
const { notifyDelivery } = require('../services/telegram');

const ID = '([a-f0-9]{24})';
const UID = '([a-zA-Z0-9-]{8,64})';

async function handle(c) {
  const { req, res, pathname, method, deps, HttpError, models, crypto, paymentInfo } = c;
  const { Order, AddRequest, Code, Wallet, Setting } = models;
  const send = (obj) => deps.sendJson(res, 200, obj);
  const who = (id) => { const u = deps.customerById(id); return u ? { name: u.name, email: u.email } : { name: '', email: '' }; };
  const q = new URL(req.url, 'http://x').searchParams;
  let m;

  if (method === 'GET' && pathname === '/api/admin/orders') {
    const f = {}; if (['Pending', 'Completed', 'Rejected', 'Cancelled'].includes(q.get('status'))) f.status = q.get('status');
    const rows = await Order.find(f).sort({ createdAt: -1 }).limit(200).lean();
    send({ orders: rows.map((o) => Object.assign({}, o, { customer: who(o.customerId) })) });
    return true;
  }
  if (method === 'POST' && (m = pathname.match(new RegExp('^/api/admin/orders/' + ID + '/(complete|reject)$')))) {
    const b = await deps.readJson(req, 4096);
    const note = String(b.note || '').slice(0, 300);
    if (m[2] === 'complete') {
      const cur = await Order.findById(m[1]).lean();
      if (cur && cur.delivery === 'processing') throw new HttpError(409, 'অটো টপআপ এখন চলছে, কিছুক্ষণ পরে দেখুন।');
      const code = String(b.code || '').trim().slice(0, 200);
      const o = await Order.findOneAndUpdate({ _id: m[1], status: 'Pending' }, { status: 'Completed', paid: true, deliveredCode: code, adminNote: note }, { new: true });
      if (!o) throw new HttpError(409, 'Order is not pending');
      return send({ ok: true, order: o }), true;
    }
    const o = await Order.findOneAndUpdate({ _id: m[1], status: 'Pending' }, { status: 'Rejected', adminNote: note }, { new: true });
    if (!o) throw new HttpError(409, 'Order is not pending');
    // টাকা আগেই পেইড হয়ে থাকলে (ওয়ালেট বা অটো-ভেরিফাইড instant) ওয়ালেটে ফেরত যায়
    if (o.paid) await wallet.credit(o.customerId, o.price, 'Refund: ' + o.packageName, o._id);
    return send({ ok: true, order: o, refunded: !!o.paid }), true;
  }
  // অটো টপআপ ব্যর্থ হলে আবার চেষ্টা
  if (method === 'POST' && (m = pathname.match(new RegExp('^/api/admin/orders/' + ID + '/retry$')))) {
    const r = await autotopup.deliver(m[1], { force: true });
    const order = await Order.findById(m[1]).lean();
    if (order && r.state !== 'skipped') notifyDelivery(order, r);
    return send({ ok: r.ok, state: r.state, reason: r.reason || '', order }), true;
  }

  if (method === 'GET' && pathname === '/api/admin/addmoney') {
    const f = {}; if (['pending', 'approved', 'rejected', 'cancelled'].includes(q.get('status'))) f.status = q.get('status');
    const rows = await AddRequest.find(f).sort({ createdAt: -1 }).limit(200).lean();
    send({ requests: rows.map((r) => Object.assign({}, r, { customer: who(r.customerId) })) });
    return true;
  }
  if (method === 'POST' && (m = pathname.match(new RegExp('^/api/admin/addmoney/' + ID + '/(approve|reject)$')))) {
    const b = await deps.readJson(req, 4096);
    const note = String(b.note || '').slice(0, 300);
    const approve = m[2] === 'approve';
    const r = await AddRequest.findOneAndUpdate({ _id: m[1], status: 'pending' }, { status: approve ? 'approved' : 'rejected', adminNote: note }, { new: true });
    if (!r) throw new HttpError(409, 'Request is not pending');
    if (approve) await wallet.credit(r.customerId, r.amount, 'Add money (' + r.method + ')', r._id);
    return send({ ok: true, request: r }), true;
  }

  if (method === 'GET' && pathname === '/api/admin/codes') {
    return send({ codes: await Code.find({}).sort({ createdAt: -1 }).limit(200).lean() }), true;
  }
  if (method === 'POST' && pathname === '/api/admin/codes') {
    const b = await deps.readJson(req, 2048);
    const amount = Math.round(Number(b.amount) * 100) / 100;
    const count = Math.min(Math.max(parseInt(b.count, 10) || 1, 1), 100);
    if (!Number.isFinite(amount) || amount < 1 || amount > 100000) throw new HttpError(400, 'Enter a valid amount');
    const codes = [];
    for (let i = 0; i < count; i++) {
      const code = 'FF-' + crypto.randomBytes(5).toString('hex').toUpperCase();
      await Code.create({ code, amount });
      codes.push(code);
    }
    return send({ ok: true, amount, codes }), true;
  }
  // ---- users + balance
  if (method === 'GET' && pathname === '/api/admin/users') {
    const s = String(q.get('q') || '').trim().toLowerCase();
    const all = deps.listCustomers().filter((u) => !s || String(u.name || '').toLowerCase().includes(s) || String(u.email || '').toLowerCase().includes(s));
    const list = all.slice().sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))).slice(0, 200);
    const ws = await Wallet.find({ customerId: { $in: list.map((u) => u.id) } }).lean();
    const bal = {}; ws.forEach((w) => { bal[w.customerId] = w.balance; });
    return send({ total: all.length, users: list.map((u) => ({ id: u.id, name: u.name, email: u.email, createdAt: u.createdAt, balance: bal[u.id] || 0 })) }), true;
  }
  if (method === 'POST' && (m = pathname.match(new RegExp('^/api/admin/users/' + UID + '/balance$')))) {
    const u = deps.customerById(m[1]);
    if (!u) throw new HttpError(404, 'ইউজার পাওয়া যায়নি');
    const b = await deps.readJson(req, 2048);
    const amount = Math.round(Number(b.amount) * 100) / 100;
    if (!Number.isFinite(amount) || amount < 1 || amount > 1000000) throw new HttpError(400, 'সঠিক পরিমাণ দিন');
    const note = String(b.note || '').trim().slice(0, 100);
    const tag = note ? ' (' + note + ')' : '';
    if (b.action === 'subtract') {
      const w = await wallet.debit(u.id, amount, 'Admin: balance deducted' + tag, 'admin');
      if (!w) throw new HttpError(400, 'ইউজারের ব্যালেন্স এত নেই');
      return send({ ok: true, balance: w.balance }), true;
    }
    const w = await wallet.credit(u.id, amount, 'Admin: balance added' + tag, 'admin');
    return send({ ok: true, balance: w.balance }), true;
  }

  // ---- অটো টপআপ সেটিং (API কী/URL/প্যাকেজ কোড)
  if (method === 'GET' && pathname === '/api/admin/autotopup') {
    const cfg = await autotopup.getConfig();
    const pk = deps.listPackages().map((p) => p.name).filter((n, i, a) => a.indexOf(n) === i);
    return send({ enabled: !!cfg.enabled, url: cfg.url, auth: cfg.auth, hasKey: !!cfg.key, keyHint: cfg.key ? cfg.key.slice(0, 4) + '…' + cfg.key.slice(-3) : '', map: cfg.map || {}, packages: pk, authModes: autotopup.AUTH_MODES }), true;
  }
  if (method === 'POST' && pathname === '/api/admin/autotopup') {
    const b = await deps.readJson(req, 16384);
    const old = (await Setting.findOne({ key: 'autotopup' }).lean()) || {};
    const prev = old.value || {};
    const url = String(b.url || '').trim();
    if (url && !/^https:\/\/[^\s]+$/i.test(url)) throw new HttpError(400, 'URL অবশ্যই https:// দিয়ে শুরু হতে হবে');
    const auth = autotopup.AUTH_MODES.includes(b.auth) ? b.auth : 'bearer';
    const key = String(b.key || '').trim() || prev.key || '';
    const map = {};
    Object.keys(b.map && typeof b.map === 'object' ? b.map : {}).slice(0, 500).forEach((k) => {
      const v = String(b.map[k] == null ? '' : b.map[k]).trim().slice(0, 100);
      if (v) map[String(k).slice(0, 120)] = v;
    });
    await Setting.findOneAndUpdate({ key: 'autotopup' }, { value: { enabled: !!b.enabled, url, auth, key, map } }, { upsert: true });
    return send({ ok: true }), true;
  }

  // ---- payment numbers
  if (method === 'GET' && pathname === '/api/admin/payment') {
    return send({ payment: await paymentInfo() }), true;
  }
  if (method === 'POST' && pathname === '/api/admin/payment') {
    const b = await deps.readJson(req, 2048);
    const val = {};
    ['bkash', 'nagad', 'rocket', 'upay'].forEach((k) => {
      const v = String(b[k] == null ? '' : b[k]).trim();
      if (!/^[0-9+\-\s]{0,30}$/.test(v)) throw new HttpError(400, k + ': নম্বর ঠিক নেই');
      val[k] = v;
    });
    val.binance = String(b.binance == null ? '' : b.binance).trim().slice(0, 200);
    val.binanceNetwork = String(b.binanceNetwork == null ? '' : b.binanceNetwork).trim().slice(0, 60);
    await Setting.findOneAndUpdate({ key: 'payment' }, { value: val }, { upsert: true });
    return send({ ok: true, payment: await paymentInfo() }), true;
  }
  return false;
}
module.exports = { handle };
