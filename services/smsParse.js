// services/smsParse.js — bKash / Nagad / Rocket "টাকা পেয়েছেন" SMS থেকে TrxID, অঙ্ক, প্রেরকের নাম্বার বের করে।
function num(s) { return parseFloat(String(s).replace(/,/g, '')); }

function detectMethod(text, from) {
  const t = String(text || '') + ' ' + String(from || '');
  if (/bkash/i.test(t)) return 'bkash';
  if (/nagad/i.test(t)) return 'nagad';
  if (/rocket|dbbl|16216/i.test(t)) return 'rocket';
  return '';
}

function parseSms(text, from) {
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  if (!t) return null;
  // শুধু "টাকা এসেছে" ধরনের SMS। পাঠানো / ক্যাশ আউট / পেমেন্ট করা SMS বাদ।
  if (!/receiv|cash\s*in/i.test(t)) return null;
  if (/you have (sent|paid)|cash\s*out|sent money|payment to/i.test(t)) return null;
  const method = detectMethod(t, from);
  let m;

  // bKash: "You have received Tk 500.00 from 01712345678. Fee Tk 0.00. Balance Tk 1,200.00. TrxID ABC123XYZ9 at ..."
  if ((m = t.match(/received Tk\.?\s?([\d,]+(?:\.\d+)?) from (01\d{9}).*?TrxID\s*:?\s*([A-Z0-9]{8,12})/i)))
    return { method: method || 'bkash', amount: num(m[1]), sender: m[2], trxId: m[3].toUpperCase() };
  // Nagad: "Money Received. Amount: Tk 500.00 Sender: 01712345678 Ref: N/A TxnID: 71ABCDEF Balance: ..."
  if ((m = t.match(/Amount:?\s*Tk\.?\s?([\d,]+(?:\.\d+)?).*?Sender:?\s*(01\d{9}).*?(?:TxnID|TrxID):?\s*([A-Z0-9]{6,14})/i)))
    return { method: method || 'nagad', amount: num(m[1]), sender: m[2], trxId: m[3].toUpperCase() };
  // Rocket: "Tk500.00 received from A/C: 01712345678 Fee: Tk0, Your A/C Balance: Tk 1000 TxnId: 1234567890"
  if ((m = t.match(/Tk\.?\s?([\d,]+(?:\.\d+)?) received from (?:A\/C:?\s*)?(01\d{9,10}).*?(?:TxnId|TrxID):?\s*([A-Z0-9]{6,14})/i)))
    return { method: method || 'rocket', amount: num(m[1]), sender: m[2].slice(0, 11), trxId: m[3].toUpperCase() };

  // অন্য ফরম্যাট (যেমন "received payment Tk ...") — সাধারণ ধরনে চেষ্টা
  const am = t.match(/(?:Tk\.?|BDT|৳)\s*([\d,]+(?:\.\d+)?)/i) || t.match(/Amount:?\s*([\d,]+(?:\.\d+)?)/i);
  const tx = t.match(/(?:Trx\s?ID|Txn\s?ID|Transaction\s?ID)\s*[:\-]?\s*([A-Z0-9]{6,20})/i);
  const sd = t.match(/(?:from|Sender:?|A\/C:?)\s*(01\d{9,10})/i);
  if (!am || !tx) return null;
  const amount = num(am[1]);
  if (!(amount > 0)) return null;
  return { method, amount, sender: sd ? sd[1].slice(0, 11) : '', trxId: tx[1].toUpperCase() };
}

// দুই নাম্বার একই কিনা (প্রথম ১১ ডিজিট মেলাই)
function sameNumber(a, b) {
  const x = String(a || '').replace(/\D/g, '').slice(0, 11);
  const y = String(b || '').replace(/\D/g, '').slice(0, 11);
  return !!x && x === y;
}

module.exports = { parseSms, sameNumber, detectMethod };
