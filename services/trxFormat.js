// services/trxFormat.js — ট্রানজেকশন আইডির ফরম্যাট যাচাই (মেথড অনুযায়ী)।
// ভুয়া/আজেবাজে আইডি (যেমন "123", "abcdef", "AAAAAAAAAA") শুরুতেই বাদ যায়।
// ফরম্যাট বদলাতে চাইলে শুধু নিচের RULES বদলান; ফ্রন্টএন্ডেও (FFX.html → TRX_RULES) একই নিয়ম আছে।
const RULES = {
  bkash:   { re: /^[A-Z0-9]{10}$/, mixed: true,  msg: 'bKash TrxID ঠিক ১০ অক্ষরের হয় (ইংরেজি অক্ষর + সংখ্যা মেশানো), যেমন 9KD3XYZ12A' },
  nagad:   { re: /^[A-Z0-9]{8,10}$/, digit: true, msg: 'Nagad TxnID ৮ অক্ষরের হয় (ইংরেজি অক্ষর + সংখ্যা), যেমন 71ABCDEF' },
  rocket:  { re: /^[0-9]{8,12}$/,                 msg: 'Rocket TxnID শুধু সংখ্যার হয় (৮-১২ ডিজিট), যেমন 5847201936' },
  upay:    { re: /^[A-Z0-9]{8,14}$/, digit: true, msg: 'Upay TrxID ৮-১৪ অক্ষরের হয় (ইংরেজি অক্ষর + সংখ্যা)' },
  binance: { re: /^[A-Z0-9]{10,100}$/,            msg: 'Binance Order ID / TxID সঠিকভাবে লিখুন' }
};

// ফেরত: null = ঠিক আছে, নাহলে ভুলের বার্তা (বাংলায়)
function check(method, trxId) {
  const t = String(trxId || '').trim().toUpperCase();
  const r = RULES[String(method || '').toLowerCase()];
  if (!t) return 'ট্রানজেকশন আইডি লিখুন';
  if (!r) return 'পেমেন্ট মেথড বাছাই করুন';
  if (!r.re.test(t)) return r.msg;
  if (new Set(t).size < 3) return r.msg;                       // AAAAAAAAAA / 1111111111 / ABABABABAB
  if (r.mixed && !(/[A-Z]/.test(t) && /[0-9]/.test(t))) return r.msg;
  if (r.digit && !/[0-9]/.test(t)) return r.msg;
  if (/^(0123456789|1234567890|9876543210|ABCDEFGHIJ)/.test(t)) return r.msg;
  return null;
}
module.exports = { check, RULES };
