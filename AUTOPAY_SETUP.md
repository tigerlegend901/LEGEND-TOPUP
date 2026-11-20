অটো পেমেন্ট ভেরিফাই — সেটআপ
কীভাবে কাজ করে
কাস্টমার bKash/Nagad/Rocket এ আপনার নম্বরে Send Money করে → TrxID + নিজের নম্বর দিয়ে “ভেরিফাই” চাপে।
আপনার ফোনে SMS আসে → SMS Forwarder অ্যাপ সেটা POST /api/sms-webhook এ পাঠায়।
সার্ভার SMS থেকে TrxID / টাকা / মাধ্যম / প্রেরকের নম্বর বের করে অর্ডারের সাথে মেলায়।
সব মিললে অর্ডার নিজে paid (autoVerified) হয় আর অ্যাড-মানি হলে ওয়ালেটে টাকা যোগ হয়। Telegram এ অ্যাডমিন নোটিফিকেশন যায়।
SMS আগে আসুক বা পরে — দুই দিক থেকেই মেলানো হয়। ইউজারের স্ক্রিনে ~২ মিনিট “SMS যাচাই হচ্ছে…” দেখায়।
না মিললে (SMS না এলে / টাকা কম / নম্বর ভুল) অর্ডার আগের মতোই Pending থাকে, অ্যাডমিন প্যানেল থেকে হাতে Approve করা যায়।
১) সার্ভারে Environment Variable
নাম	মান
SMS_WEBHOOK_KEY	একটা লম্বা গোপন কোড (যেমন ৩২ অক্ষরের র‍্যান্ডম)। এটা সেট না করলে অটো ভেরিফাই বন্ধ থাকবে।
MONGODB_URI	আগের মতোই
PAY_BKASH / PAY_NAGAD / PAY_ROCKET	(ঐচ্ছিক) অ্যাডমিন প্যানেলে নম্বর সেভ করলে সেটাই ব্যবহার হয়
TG_BOT_TOKEN, TG_ADMIN_CHAT_ID	(ঐচ্ছিক) অটো ভেরিফাই হলে Telegram এ জানাবে
২) ফোনে SMS Forwarder অ্যাপ (যে ফোনে bKash/Nagad/Rocket সিম আছে)
যেকোনো “SMS to URL / HTTP webhook” ধরনের অ্যাপ চলবে। সেটিং:

URL: https://আপনার-ডোমেইন/api/sms-webhook
Method: POST, Content-Type: application/json
Header: x-webhook-secret: <আপনার SMS_WEBHOOK_KEY>
(হেডার দেওয়া না গেলে URL এ ?secret=<কী> দিলেও চলে)
Body: {"from":"%from%","message":"%text%"} (অ্যাপের প্লেসহোল্ডার অনুযায়ী বদলান)
Sender ফিল্টার: bKash, NAGAD, 16216 (Rocket)
ফোনে অ্যাপকে Battery optimization থেকে বাদ দিন, নইলে ব্যাকগ্রাউন্ডে বন্ধ হয়ে যেতে পারে।
৩) টেস্ট
npm run test:autopay        # MongoDB ছাড়াই পুরো লজিক টেস্ট
লাইভ টেস্ট: নিজের ফোন থেকে ছোট অ্যামাউন্ট (যেমন ১ টাকার একটা টেস্ট প্যাকেজ) অন্য নম্বরে পাঠিয়ে দেখুন।
ওয়েবহুক হাতে চেক:

curl -X POST https://আপনার-ডোমেইন/api/sms-webhook \
  -H "x-webhook-secret: <কী>" -H "Content-Type: application/json" \
  -d '{"from":"bKash","message":"You have received Tk 85.00 from 01712345678. Fee Tk 0.00. Balance Tk 100.00. TrxID TEST123456 at 20/11/2026 11:10"}'
নিরাপত্তা / নিয়ম
ইউজারের দেওয়া দাম নয়, সার্ভারের প্যাকেজ দামই ধরা হয়।
একই TrxID একবারই ব্যবহার করা যায় (অর্ডার ও অ্যাড-মানি মিলিয়ে)।
SMS এর টাকা ≥ অর্ডারের দাম, মাধ্যম ও প্রেরকের নম্বর মিলতে হবে।
ওয়েবহুক ছাড়া কেউ SMS ঢোকাতে পারে না; সিক্রেট কাউকে দেবেন না।
পার্সোনাল নম্বরে ব্যবসা চালানো bKash/Nagad এর শর্তে পড়ে না, অ্যাকাউন্ট লিমিট/বন্ধ হওয়ার ঝুঁকি আছে। লেনদেন বাড়লে মার্চেন্ট নম্বর/গেটওয়ে নিন।
কী কী বদলেছে
নতুন/বদলানো: services/smsParse.js, services/smsHook.js, services/paymentVerify.js, models/index.js (SmsPayment যোগ), routes/orders.js, routes/wallet.js, services/telegram.js, FFX.html ও public/js/checkout.js (অপেক্ষা-পোলিং), tests/autopay.test.js
পুরনো অটো-ভেরিফাই বাদ: আগের verifyTrx (যা SmsPayment মডেল না থাকায় আসলে চলতই না) এবং ১০ সেকেন্ডের ব্লকিং অপেক্ষা।
