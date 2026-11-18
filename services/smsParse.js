// services/smsParse.js — bKash / Nagad / Rocket "টাকা পেয়েছেন" SMS থেকে TrxID, অঙ্ক, প্রেরকের নাম্বার বের করে।
function detectMethod(text, from) {
  const t = String(text || '') + ' ' + String(from || '');
  if (/bkash/i.test(t)) return 'bkash';
  if (/nagad/i.test(t)) return 'nagad';
  if (/rocket|dbbl|16216/i.test(t)) return 'rocket';
  return '';
}

function parseSms(text, from) {
  const msg = String(text || '').replace(/\s+/g, ' ').trim();
  if (!msg) return null;
  // শুধু "টাকা এসেছে" ধরনের SMS (Send Money / Cash Out / Payment পাঠানো বাদ)
  if (!/receiv|cash\s*in/i.test(msg)) return null;
  if (/you have (sent|paid)|cash\s*out|sent money|payment to/i.test(msg) && !/receiv/i.test(msg)) return null;

  const am = msg.match(/(?:Tk\.?|BDT|৳)\s*([\d,]+(?:\.\d+)?)/i) || msg.match(/Amount:?\s*([\d,]+(?:\.\d+)?)/i);
  const tx = msg.match(/(?:Trx\s?ID|Txn\s?ID|Transaction\s?ID|TrxId|TxnId)\s*[:\-]?\s*([A-Z0-9]{6,20})/i);
  const sd = msg.match(/(?:from|Sender:?|A\/C:?)\s*(01\d{9,10})/i);
  if (!am || !tx) return null;
  const amount = Number(am[1].replace(/,/g, ''));
  if (!(amount > 0)) return null;
  return {
    trxId: tx[1].toUpperCase(),
    amount,
    sender: sd ? sd[1] : '',
    method: detectMethod(msg, from)
  };
}

// দুই নাম্বার একই কিনা (Rocket-এ শেষে বাড়তি ১ ডিজিট থাকে, তাই প্রথম ১১ ডিজিট মেলাই)
function sameNumber(a, b) {
  const x = String(a || '').replace(/\D/g, '').slice(0, 11);
  const y = String(b || '').replace(/\D/g, '').slice(0, 11);
  return !!x && x === y;
}

module.exports = { parseSms, sameNumber, detectMethod };

