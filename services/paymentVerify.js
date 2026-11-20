// services/paymentVerify.js — অটো পেমেন্ট ভেরিফাই (SMS ফরওয়ার্ডিং)।
// ফোনের SMS → /api/sms-webhook → SmsPayment-এ জমা। অর্ডার/টাকা-যোগের অনুরোধ আর SMS দুটো মিললে settle() নিজে অনুমোদন করে।
// SMS আগে এলেও পরে এলেও কাজ করে: দুই দিক থেকেই settle(trxId) ডাকা হয় (webhook + অর্ডার/অনুরোধ তৈরির পর)।
const { sameNumber } = require('./smsParse');
const wallet = require('./wallet');
const autotopup = require('./autotopup');
const telegram = require('./telegram');

const normTrx = (t) => String(t || '').trim().toUpperCase();

// SMS-এর টাকা/মাধ্যম/প্রেরক অর্ডারের সাথে মেলে কিনা
function fits(sms, amount, method, sender) {
  if (!(Number(sms.amount) + 0.001 >= Number(amount))) return false;
  if (sms.method && method && sms.method !== method) return false;
  if (sms.sender && sender && !sameNumber(sms.sender, sender)) return false;
  return true;
}

// ফেরত: { kind: 'order' | 'addmoney', doc } অথবা null (মেলেনি / SMS আসেনি / আগেই ব্যবহার হয়েছে)
async function settle(trxId, opts) {
  const { SmsPayment, AddRequest, Order } = require('../models');
  const notify = opts && opts.notify;
  trxId = normTrx(trxId);
  if (!trxId) return null;

  const sms = await SmsPayment.findOne({ trxId, used: false }).lean();
  if (!sms) return null;

  const claim = (usedFor) => SmsPayment.findOneAndUpdate({ _id: sms._id, used: false }, { used: true, usedFor });
  const unclaim = () => SmsPayment.updateOne({ _id: sms._id }, { used: false, usedFor: '' }).catch(() => {});

  // ১) ওয়ালেটে টাকা যোগের অনুরোধ
  const ar = await AddRequest.findOne({ trxId, status: 'pending' });
  if (ar) {
    if (!fits(sms, ar.amount, ar.method, ar.senderNumber)) return null;
    if (!(await claim('addmoney:' + ar._id))) return null;
    const done = await AddRequest.findOneAndUpdate({ _id: ar._id, status: 'pending' }, { status: 'approved', autoVerified: true }, { new: true });
    if (!done) { await unclaim(); return null; }
    await wallet.credit(done.customerId, done.amount, 'Add money (' + done.method + ')', done._id);
    if (notify) notify('addmoney', done);
    return { kind: 'addmoney', doc: done };
  }

  // ২) ইনস্ট্যান্ট পে অর্ডার
  const od = await Order.findOne({ trxId, payMethod: 'instant', paid: false, status: 'Pending' });
  if (od) {
    if (!fits(sms, od.price, od.via, od.senderNumber)) return null;
    if (!(await claim('order:' + od._id))) return null;
    const done = await Order.findOneAndUpdate({ _id: od._id, paid: false, status: 'Pending' }, { paid: true, autoVerified: true }, { new: true });
    if (!done) { await unclaim(); return null; }
    if (notify) notify('order', done);
    // পেমেন্ট নিশ্চিত → অটো টপআপ (ব্যাকগ্রাউন্ডে; ব্যর্থ হলে অর্ডার Pending থেকে যায়)
    autotopup.deliver(done._id).then((r) => { if (r && r.state !== 'skipped') telegram.notifyDelivery(done, r); }).catch(() => {});
    return { kind: 'order', doc: done };
  }
  return null;
}

module.exports = { settle, fits, normTrx };
