# অটো পেমেন্ট ভেরিফাই — সেটআপ

## কীভাবে কাজ করে
1. কাস্টমার bKash/Nagad/Rocket এ আপনার নম্বরে Send Money করে → TrxID + নিজের নম্বর দিয়ে "ভেরিফাই" চাপে।
2. আপনার ফোনে SMS আসে → SMS Forwarder অ্যাপ সেটা `POST /api/sms-webhook` এ পাঠায়।
3. সার্ভার SMS থেকে TrxID / টাকা / মাধ্যম / প্রেরকের নম্বর বের করে অর্ডারের সাথে মেলায়।
4. সব মিললে অর্ডার নিজে `paid` (autoVerified) হয় আর অ্যাড-মানি হলে ওয়ালেটে টাকা যোগ হয়। Telegram এ অ্যাডমিন নোটিফিকেশন যায়।
5. SMS আগে আসুক বা পরে — দুই দিক থেকেই মেলানো হয়। ইউজারের স্ক্রিনে ~২ মিনিট "SMS যাচাই হচ্ছে…" দেখায়।
6. না মিললে (SMS না এলে / টাকা কম / নম্বর ভুল) অর্ডার আগের মতোই Pending থাকে, অ্যাডমিন প্যানেল থেকে হাতে Approve করা যায়।

## ১) সার্ভারে Environment Variable
| নাম | মান |
|---|---|
| `SMS_WEBHOOK_KEY` | একটা লম্বা গোপন কোড (যেমন ৩২ অক্ষরের র‍্যান্ডম)। **এটা সেট না করলে অটো ভেরিফাই বন্ধ থাকবে।** |
| `MONGODB_URI` | আগের মতোই |
| `PAY_BKASH` / `PAY_NAGAD` / `PAY_ROCKET` | (ঐচ্ছিক) অ্যাডমিন প্যানেলে নম্বর সেভ করলে সেটাই ব্যবহার হয় |
| `TG_BOT_TOKEN`, `TG_ADMIN_CHAT_ID` | (ঐচ্ছিক) অটো ভেরিফাই হলে Telegram এ জানাবে |

## ২) ফোনে SMS Forwarder অ্যাপ (যে ফোনে bKash/Nagad/Rocket সিম আছে)
যেকোনো "SMS to URL / HTTP webhook" ধরনের অ্যাপ চলবে। সেটিং:
- URL: `https://আপনার-ডোমেইন/api/sms-webhook`
- Method: `POST`, Content-Type: `application/json`
- Header: `x-webhook-secret: <আপনার SMS_WEBHOOK_KEY>`
  (হেডার দেওয়া না গেলে URL এ `?secret=<কী>` দিলেও চলে)
- Body: `{"from":"%from%","message":"%text%"}` (অ্যাপের প্লেসহোল্ডার অনুযায়ী বদলান)
- Sender ফিল্টার: bKash, NAGAD, 16216 (Rocket)
- ফোনে অ্যাপকে Battery optimization থেকে বাদ দিন, নইলে ব্যাকগ্রাউন্ডে বন্ধ হয়ে যেতে পারে।

## ৩) টেস্ট
    npm run test:autopay        # MongoDB ছাড়াই পুরো লজিক টেস্ট

লাইভ টেস্ট: নিজের ফোন থেকে ছোট অ্যামাউন্ট (যেমন ১ টাকার একটা টেস্ট প্যাকেজ) অন্য নম্বরে পাঠিয়ে দেখুন।
ওয়েবহুক হাতে চেক:

    curl -X POST https://আপনার-ডোমেইন/api/sms-webhook \
      -H "x-webhook-secret: <কী>" -H "Content-Type: application/json" \
      -d '{"from":"bKash","message":"You have received Tk 85.00 from 01712345678. Fee Tk 0.00. Balance Tk 100.00. TrxID TEST123456 at 20/11/2026 11:10"}'

## নিরাপত্তা / নিয়ম
- ইউজারের দেওয়া দাম নয়, সার্ভারের প্যাকেজ দামই ধরা হয়।
- একই TrxID একবারই ব্যবহার করা যায় (অর্ডার ও অ্যাড-মানি মিলিয়ে)।
- SMS এর টাকা ≥ অর্ডারের দাম, মাধ্যম ও প্রেরকের নম্বর মিলতে হবে।
- ওয়েবহুক ছাড়া কেউ SMS ঢোকাতে পারে না; সিক্রেট কাউকে দেবেন না।
- পার্সোনাল নম্বরে ব্যবসা চালানো bKash/Nagad এর শর্তে পড়ে না, অ্যাকাউন্ট লিমিট/বন্ধ হওয়ার ঝুঁকি আছে। লেনদেন বাড়লে মার্চেন্ট নম্বর/গেটওয়ে নিন।

## কী কী বদলেছে
- নতুন/বদলানো: `services/smsParse.js`, `services/smsHook.js`, `services/paymentVerify.js`, `models/index.js` (SmsPayment যোগ), `routes/orders.js`, `routes/wallet.js`, `services/telegram.js`, `FFX.html` ও `public/js/checkout.js` (অপেক্ষা-পোলিং), `tests/autopay.test.js`
- পুরনো অটো-ভেরিফাই বাদ: আগের `verifyTrx` (যা `SmsPayment` মডেল না থাকায় আসলে চলতই না) এবং ১০ সেকেন্ডের ব্লকিং অপেক্ষা।

---

# নতুন: পেমেন্ট বাতিল + অটো টপআপ API

## পেমেন্ট বাতিল (Payment Cancelled)
- পেমেন্ট পেজে নতুন লাল বোতাম **"পেমেন্ট বাতিল করুন"**। ×, হোম আইকন বা বাইরে ক্লিক করলেও বাতিল ধরা হয়।
- বাতিল করলে লাল ✕ সহ **"পেমেন্ট বাতিল হয়েছে"** স্ক্রিন দেখায়। অর্ডার/অ্যাড-মানি অনুরোধ সার্ভারে `Cancelled` হয় (অর্ডার লিস্টে "বাতিল" দেখায়) এবং TrxID মুক্ত হয়।
- অ্যাডমিন Reject করলেও ইউজার "পেমেন্ট বাতিল হয়েছে" দেখে (আগে ভুল করে "অর্ডার সফল" দেখাত)।
- পেমেন্ট যাচাই হয়ে গেলে আর বাতিল করা যায় না (সার্ভার আটকায়)।
- API: `POST /api/orders/:id/cancel`, `POST /api/wallet/requests/:id/cancel`

## অটো টপআপ API
অ্যাডমিন প্যানেল → **Auto Topup API** ট্যাব:
1. Enable টিক দিন
2. API URL (https://...) দিন
3. API Key বসান (যেমন `API-12345678`)
4. প্রতিটি প্যাকেজের পাশে প্রোভাইডারের **API কোড** লিখুন (খালি থাকলে ওই প্যাকেজ হাতে ডেলিভারি হবে)
5. Save

অথবা Environment Variable: `AUTO_TOPUP_API_URL`, `AUTO_TOPUP_API_KEY`, `AUTO_TOPUP_AUTH` (bearer | header | body | query)।

কীভাবে চলে: পেমেন্ট নিশ্চিত হলে (ওয়ালেট পে / SMS অটো-ভেরিফাই) সার্ভার API ডাকে → সফল হলে অর্ডার নিজে **Completed**। ব্যর্থ হলে অর্ডার **Pending** থাকে, Telegram-এ জানায়, অ্যাডমিনে **Retry auto topup** বা হাতে **Deliver** করা যায়। একই অর্ডারে দুবার টপআপ হয় না।

⚠️ প্রোভাইডারের রিকোয়েস্ট/রেসপন্স ফরম্যাট আলাদা হয়। `services/autotopup.js`-এর `buildRequest()` ও `isSuccess()` প্রোভাইডারের ডকুমেন্ট অনুযায়ী মিলিয়ে নিন।

## পেমেন্ট মেথড
bKash / Nagad / Rocket → SMS অটো-ভেরিফাই। Upay / Binance (USDT) → অ্যাডমিন হাতে অ্যাপ্রুভ করেন (Admin → Add Money requests / Orders)। নম্বর/ওয়ালেট: Admin → Payment numbers। লোগো: `public/img/pay/README.txt` দেখুন।

## অন্যান্য ফিক্স
- `account.js` থেকে পুরনো `/js/checkout.js` লোড বন্ধ (ওটা নতুন চেকআউটের সাথে রেস করে পুরনো UI দেখাতে পারত); ফাইলটি মুছে দেওয়া হয়েছে।
- পেইড অর্ডার Reject করলে (অটো-ভেরিফাইড instant সহ) টাকা ওয়ালেটে ফেরত যায়।
- `tests/` ফোল্ডার ব্রাউজারে খোলা বন্ধ। Telegram লিংকের ভুল `@` সরানো হয়েছে।
- টেস্ট: `npm run test:autopay` (১৯টি)
