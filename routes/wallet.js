// routes/wallet.js → /api/wallet/*
const wallet = require('../services/wallet');
const { settle } = require('../services/paymentVerify');
const { publicUser } = require('../middleware/auth');

const METHODS = ['bkash', 'nagad', 'rocket', 'upay', 'binance'];
const SMS_METHODS = ['bkash', 'nagad', 'rocket'];

async function handle(c) {
  const { req, res, pathname, method, user, deps, HttpError, limit, models, paymentInfo } = c;
  const { AddRequest, Txn, Code, Order } = models;
  const cid = user.id;

  if (method === 'GET' && pathname === '/api/wallet/payment-info') {
    deps.sendJson(res, 200, await paymentInfo()); // অ্যাডমিন প্যানেলে সেভ করা নম্বর (না থাকলে PAY_* env)
    return true;
  }

  if (method === 'POST' && pathname === '/api/wallet/add-money') {
    limit('add:' + cid, 15, 10 * 60 * 1000);
    const b = await deps.readJson(req, 8192);
    const via = String(b.method || '').toLowerCase();
    const mode = b.mode === 'instant' && SMS_METHODS.includes(via) ? 'instant' : 'manual';
    const amount = Math.round(Number(b.amount) * 100) / 100;
    const senderNumber = String(b.senderNumber || '').trim();
    const trxId = String(b.trxId || '').trim().toUpperCase();
    if (!METHODS.includes(via)) throw new HttpError(400, 'Choose a supported payment method');
    if (!Number.isFinite(amount) || amount < 1 || amount > 100000) throw new HttpError(400, 'Enter a valid amount');
    if (senderNumber && !/^01\d{9}$/.test(senderNumber)) throw new HttpError(400, 'Enter a valid 11-digit sender number'); // ঐচ্ছিক
    { const trxErr = require('../services/trxFormat').check(via, trxId); if (trxErr) throw new HttpError(400, trxErr); }
    const pendingCount = await AddRequest.countDocuments({ customerId: cid, status: 'pending' });
    if (pendingCount >= 3) throw new HttpError(429, 'আপনার ৩টি অনুরোধ এখনো যাচাই হচ্ছে। যাচাই শেষ হলে নতুন অনুরোধ করুন।');
    if (!(await wallet.reserveTrx(trxId, 'addmoney'))) throw new HttpError(409, 'This Transaction ID was already used');

    let doc;
    try {
      doc = await AddRequest.create({ customerId: cid, method: via, amount, senderNumber, trxId, mode, status: 'pending' });
    } catch (e) { await wallet.releaseTrx(trxId).catch(() => {}); throw e; }

    // SMS আগেই এসে থাকলে এখনই অনুমোদন; না এলে SMS আসার পর webhook নিজে অনুমোদন করবে
    let verified = false;
    try { verified = SMS_METHODS.includes(via) && !!(await settle(trxId)); } catch (e) { console.error('settle', e.message); }
    if (verified) {
      deps.sendJson(res, 200, { ok: true, id: doc._id, approved: true, message: 'Payment verified. Money added to your wallet.' });
    } else {
      deps.sendJson(res, 200, { ok: true, id: doc._id, approved: false, message: SMS_METHODS.includes(via) ? 'Request submitted. Payment SMS verification is pending, or admin can review it.' : 'Request submitted. This payment method requires manual admin verification before wallet credit.' });
    }
    return true;
  }

  let rm;
  if (method === 'GET' && (rm = pathname.match(/^\/api\/wallet\/requests\/([a-f0-9]{24})$/))) {
    const r = await AddRequest.findOne({ _id: rm[1], customerId: cid }).lean();
    if (!r) throw new HttpError(404, 'Request not found');
    deps.sendJson(res, 200, { id: r._id, status: r.status, paid: r.status === 'approved', rejected: r.status === 'rejected' || r.status === 'cancelled', cancelled: r.status === 'cancelled' });
    return true;
  }

  // ইউজার নিজে টাকা-যোগের অনুরোধ বাতিল করলে (শুধু pending থাকলে)। TrxID ছেড়ে দেওয়া হয়।
  if (method === 'POST' && (rm = pathname.match(/^\/api\/wallet\/requests\/([a-f0-9]{24})\/cancel$/))) {
    const r = await AddRequest.findOneAndUpdate({ _id: rm[1], customerId: cid, status: 'pending' }, { status: 'cancelled', adminNote: 'Cancelled by customer' }, { new: true });
    if (!r) {
      const cur = await AddRequest.findOne({ _id: rm[1], customerId: cid }).lean();
      if (!cur) throw new HttpError(404, 'Request not found');
      if (cur.status === 'cancelled') return deps.sendJson(res, 200, { ok: true, cancelled: true }), true;
      throw new HttpError(409, cur.status === 'approved' ? 'পেমেন্ট ইতিমধ্যে যাচাই হয়ে টাকা যোগ হয়ে গেছে।' : 'এই অনুরোধ বাতিল করা যাবে না।');
    }
    await wallet.releaseTrx(r.trxId).catch(() => {});
    deps.sendJson(res, 200, { ok: true, cancelled: true });
    return true;
  }

  if (method === 'GET' && pathname === '/api/wallet/transactions') {
    const transactions = await Txn.find({ customerId: cid }).sort({ createdAt: -1 }).limit(100).lean();
    deps.sendJson(res, 200, { transactions });
    return true;
  }

  if (method === 'GET' && pathname === '/api/wallet/requests') {
    const requests = await AddRequest.find({ customerId: cid }).sort({ createdAt: -1 }).limit(50).lean();
    deps.sendJson(res, 200, { requests });
    return true;
  }

  if (method === 'GET' && pathname === '/api/wallet/codes') {
    const redeemed = await Code.find({ usedBy: cid }).sort({ usedAt: -1 }).limit(100).lean();
    const delivered = await Order.find({ customerId: cid, status: 'Completed', deliveredCode: { $ne: '' } }).sort({ updatedAt: -1 }).limit(100).lean();
    deps.sendJson(res, 200, { redeemed, delivered });
    return true;
  }

  if (method === 'POST' && pathname === '/api/wallet/redeem') {
    limit('redeem:' + cid, 10, 10 * 60 * 1000);
    const b = await deps.readJson(req, 2048);
    const code = String(b.code || '').trim().toUpperCase();
    if (!/^[A-Z0-9-]{4,40}$/.test(code)) throw new HttpError(400, 'Invalid code');
    const c1 = await Code.findOneAndUpdate({ code, usedBy: null }, { usedBy: cid, usedAt: new Date() }, { new: true });
    if (!c1) throw new HttpError(400, 'Invalid or already used code');
    const w = await wallet.credit(cid, c1.amount, 'Redeemed code ' + code, c1._id);
    deps.sendJson(res, 200, { ok: true, amount: c1.amount, user: publicUser(user, w.balance) });
    return true;
  }
  return false;
}
module.exports = { handle };
