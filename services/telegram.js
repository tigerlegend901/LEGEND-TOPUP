const crypto = require('crypto');

const TOKEN = (process.env.TG_BOT_TOKEN || process.env.TELEGRAM_BOT_TOKEN || '').trim();
const ADMIN_CHAT = (process.env.TG_ADMIN_CHAT_ID || process.env.TELEGRAM_CHAT_ID || '').trim();
const API = 'https://api.telegram.org/bot' + TOKEN;

function webhookSecret() {
  if (!TOKEN) return '';
  return crypto.createHash('sha256').update('ffx-tg:' + TOKEN).digest('hex').slice(0, 32);
}

async function call(method, body) {
  if (!TOKEN) return null;
  try {
    const r = await fetch(API + '/' + method, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body || {}),
      signal: AbortSignal.timeout(10000)
    });
    const j = await r.json().catch(function () { return null; });
    if (!r.ok || !j || !j.ok) console.error('Telegram ' + method + ' failed:', r.status, j && j.description);
    return j;
  } catch (e) {
    console.error('Telegram ' + method + ' error:', e && e.message);
    return null;
  }
}

function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

function notifyOrder(order, user) {
  if (!TOKEN || !ADMIN_CHAT) return;
  try {
    const o = order || {}, u = user || {};
    const lines = [
      '🛒 <b>নতুন অর্ডার</b>',
      'প্যাকেজ: ' + esc(o.packageName),
      'Player UID: <code>' + esc(o.uid) + '</code>',
      'প্রাইস: ' + esc(o.price) + ' BDT',
      'পেমেন্ট: ' + (o.payMethod === 'wallet' ? 'Wallet (পরিশোধিত)' : 'Instant (' + esc(o.via) + ')'),
      o.payMethod === 'instant' ? 'TrxID: <code>' + esc(o.trxId) + '</code>' + (o.senderNumber ? ' | Sender: ' + esc(o.senderNumber) : '') : '',
      'কাস্টমার: ' + esc(u.name) + ' (' + esc(u.email) + ')',
      o.autoVerified ? '✅ পেমেন্ট অটো ভেরিফাইড' : (o.payMethod === 'instant' ? '⏳ পেমেন্ট এখনো যাচাই হয়নি' : ''),
      'স্ট্যাটাস: ' + esc(o.status),
      'অর্ডার আইডি: <code>' + esc(o._id) + '</code>'
    ].filter(Boolean);
    call('sendMessage', { chat_id: ADMIN_CHAT, text: lines.join('\n'), parse_mode: 'HTML' });
  } catch (e) { console.error('notifyOrder error:', e && e.message); }
}

// SMS পরে এসে পেমেন্ট অটো ভেরিফাই হলে অ্যাডমিনকে জানায়
function notifyAutoPaid(kind, doc) {
  if (!TOKEN || !ADMIN_CHAT) return;
  try {
    const d = doc || {};
    const lines = kind === 'order'
      ? ['✅ <b>অর্ডারের পেমেন্ট অটো ভেরিফাইড</b>', 'প্যাকেজ: ' + esc(d.packageName), 'Player UID: <code>' + esc(d.uid) + '</code>', 'প্রাইস: ' + esc(d.price) + ' BDT', 'TrxID: <code>' + esc(d.trxId) + '</code>', 'অর্ডার আইডি: <code>' + esc(d._id) + '</code>']
      : ['✅ <b>অ্যাড-মানি অটো অনুমোদিত</b>', 'পরিমাণ: ' + esc(d.amount) + ' BDT (' + esc(d.method) + ')', 'TrxID: <code>' + esc(d.trxId) + '</code>'];
    call('sendMessage', { chat_id: ADMIN_CHAT, text: lines.join('\n'), parse_mode: 'HTML' });
  } catch (e) { console.error('notifyAutoPaid error:', e && e.message); }
}

// অটো টপআপের ফলাফল অ্যাডমিনকে জানায়
function notifyDelivery(order, r) {
  if (!TOKEN || !ADMIN_CHAT) return;
  try {
    const o = order || {};
    const lines = r && r.ok
      ? ['🚀 <b>অটো টপআপ সম্পন্ন</b>', 'প্যাকেজ: ' + esc(o.packageName), 'Player UID: <code>' + esc(o.uid) + '</code>', 'অর্ডার আইডি: <code>' + esc(o._id) + '</code>']
      : ['⚠️ <b>অটো টপআপ ব্যর্থ — হাতে দেখুন</b>', 'প্যাকেজ: ' + esc(o.packageName), 'Player UID: <code>' + esc(o.uid) + '</code>', 'কারণ: ' + esc(r && r.reason), 'অর্ডার আইডি: <code>' + esc(o._id) + '</code>'];
    call('sendMessage', { chat_id: ADMIN_CHAT, text: lines.join('\n'), parse_mode: 'HTML' });
  } catch (e) { console.error('notifyDelivery error:', e && e.message); }
}

async function handleUpdate(update) {
  const m = update && update.message;
  if (!m || !m.chat) return;
  const text = String(m.text || '').trim();
  if (text === '/start' || text === '/id') {
    await call('sendMessage', { chat_id: m.chat.id, text: 'আপনার chat id: ' + m.chat.id });
  }
}

async function setupWebhook(baseUrl) {
  if (!TOKEN || !baseUrl) return false;
  const base = String(baseUrl).replace(/\/$/, '');
  const sec = webhookSecret();
  const j = await call('setWebhook', { url: base + '/api/tg/' + sec, secret_token: sec, allowed_updates: ['message'] });
  return !!(j && j.ok);
}

module.exports = { notifyOrder, notifyAutoPaid, notifyDelivery, handleUpdate, setupWebhook, webhookSecret };
