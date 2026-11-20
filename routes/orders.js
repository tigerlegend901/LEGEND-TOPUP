// routes/orders.js → /api/orders
const wallet = require('../services/wallet');
const { resolvePackage } = require('../services/pricing');
const { settle } = require('../services/paymentVerify');
const { publicUser } = require('../middleware/auth');
const { notifyOrder } = require('../services/telegram');

const METHODS = ['bkash', 'nagad', 'rocket'];

async function handle(c) {
  const { req, res, pathname, method, user, deps, HttpError, limit, models } = c;
  const { Order } = models;
  const cid = user.id;

  if (method === 'GET' && pathname === '/api/orders/mine') {
    const orders = await Order.find({ customerId: cid }).sort({ createdAt: -1 }).limit(100).lean();
    deps.sendJson(res, 200, { orders });
    return true;
  }

  // পেমেন্ট যাচাইয়ের অবস্থা (ফ্রন্টএন্ড কয়েক সেকেন্ড পরপর দেখে)
  let sm;
  if (method === 'GET' && (sm = pathname.match(/^\/api\/orders\/([a-f0-9]{24})$/))) {
    const o = await Order.findOne({ _id: sm[1], customerId: cid }).lean();
    if (!o) throw new HttpError(404, 'Order not found');
    deps.sendJson(res, 200, { id: o._id, status: o.status, paid: !!o.paid, autoVerified: !!o.autoVerified });
    return true;
  }

  if (method === 'POST' && pathname === '/api/orders') {
    limit('order:' + cid, 40, 10 * 60 * 1000);
    const b = await deps.readJson(req, 8192);
    const uid = String(b.uid || '').trim();
    const payMethod = b.payMethod === 'instant' ? 'instant' : 'wallet';
    if (!/^\d{6,14}$/.test(uid)) throw new HttpError(400, 'Enter a valid Player UID (numbers only)');
    const pkg = resolvePackage({ packageName: b.packageName, clientPrice: b.price }, deps.listPackages);
    if (!pkg) throw new HttpError(400, 'Package not found or price changed. Please refresh and try again.');

    const base = { customerId: cid, packageId: String(b.packageId || ''), packageName: pkg.name, uid, price: pkg.price, payMethod, status: 'Pending' };

    if (payMethod === 'wallet') {
      const order = await Order.create(base);
      const w = await wallet.debit(cid, pkg.price, 'Order: ' + pkg.name + ' (UID ' + uid + ')', order._id);
      if (!w) {
        await Order.deleteOne({ _id: order._id });
        throw new HttpError(400, 'Insufficient wallet balance. Please add money first.');
      }
      order.paid = true;
      await order.save();
      notifyOrder(order, user);
      deps.sendJson(res, 200, { ok: true, order, user: publicUser(user, w.balance) });
      return true;
    }

    const via = String(b.via || '').toLowerCase();
    const senderNumber = String(b.senderNumber || '').trim();
    const trxId = String(b.trxId || '').trim().toUpperCase();
    if (!METHODS.includes(via)) throw new HttpError(400, 'Choose bKash, Nagad or Rocket');
    if (senderNumber && !/^01\d{9}$/.test(senderNumber)) throw new HttpError(400, 'Enter a valid 11-digit sender number'); // ঐচ্ছিক
    if (!/^[A-Z0-9]{6,20}$/.test(trxId)) throw new HttpError(400, 'Enter a valid Transaction ID');
    const openCount = await Order.countDocuments({ customerId: cid, payMethod: 'instant', paid: false, status: 'Pending' });
    if (openCount >= 3) throw new HttpError(429, 'আপনার ৩টি অর্ডার এখনো যাচাই হচ্ছে। যাচাই শেষ হলে নতুন অর্ডার করুন।');
    if (!(await wallet.reserveTrx(trxId, 'order'))) throw new HttpError(409, 'This Transaction ID was already used');
    try {
      let order = await Order.create(Object.assign({}, base, { via, senderNumber, trxId, autoVerified: false, paid: false }));
      // SMS আগেই এসে থাকলে এখনই পেইড হবে; না এলে SMS আসার পর webhook নিজে অনুমোদন করবে
      try { await settle(trxId); } catch (e) { console.error('settle', e.message); }
      order = (await Order.findById(order._id)) || order;
      notifyOrder(order, user);
      deps.sendJson(res, 200, { ok: true, order, verified: !!order.paid });
    } catch (e) { await wallet.releaseTrx(trxId).catch(() => {}); throw e; }
    return true;
  }
  return false;
}
module.exports = { handle };
  
