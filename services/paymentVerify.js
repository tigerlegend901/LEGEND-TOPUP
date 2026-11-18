// services/paymentVerify.js — অটো পেমেন্ট যাচাই (SMS ফরওয়ার্ডিং পদ্ধতি)।
// আপনার ফোনে bKash/Nagad/Rocket-এর SMS এলে ফোনের অ্যাপ সেটা /api/sms-webhook-এ পাঠায় (routes/index.js)।
// এখানে TrxID + অঙ্ক + পাঠানো নাম্বার মিললে true ফেরত দেয়। মিলে না বা SMS না এলে false → অ্যাডমিন হাতে Approve করেন।
const { sameNumber } = require('./smsParse');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function verifyTrx({ trxId, amount, method, senderNumber }) {
  if (!(process.env.SMS_WEBHOOK_KEY || '').trim()) return false; // সেটআপ করা নেই
  const { SmsPayment } = require('../models');
  trxId = String(trxId || '').trim().toUpperCase();
  // SMS আসতে কয়েক সেকেন্ড দেরি হতে পারে, তাই ~১০ সেকেন্ড অপেক্ষা
  for (let i = 0; i < 4; i++) {
    const s = await SmsPayment.findOne({ trxId, used: false }).lean();
    if (s) {
      if (!(s.amount + 0.001 >= Number(amount))) return false;
      if (s.method && method && s.method !== method) return false;
      if (s.sender && senderNumber && !sameNumber(s.sender, senderNumber)) return false;
      const got = await SmsPayment.findOneAndUpdate({ _id: s._id, used: false }, { used: true });
      return !!got;
    }
    if (i < 3) await sleep(3500);
  }
  return false;
}

module.exports = { verifyTrx };
