# Gift Valy — Go live: মালিকের নিজের কাজ, ক্রম অনুযায়ী

Gift Valy এখন Funnel Liner এর দ্বিতীয় client। সফটওয়্যার চলবে Antu Boutique এর server এ, staff ঢুকবে **`dashboard.funnelliner.com`** দিয়ে। সার্ভারের সব command developer চালাবে (`DEPLOYMENT.md`)। এই পাতায় শুধু **আপনার** নিজের হাতে করার কাজগুলো, যে ক্রমে করতে হবে সেই ক্রমে।

> **সব পাসওয়ার্ড ও secret শুধু আপনার password manager এ থাকবে।** কোনো secret chat এ, WhatsApp এ, ইমেইলে বা কোনো ফাইলে লিখবেন না। যেখানে secret লাগবে, সেটা আপনি নিজের Terminal থেকে দেখে সরাসরি জায়গামতো paste করবেন।

---

## ধাপ ১ — শুরুর আগে (staging এর আগেই)

1. **GitHub deploy key।** Developer server এ একটা key বানিয়ে আপনাকে একটা লাইন দেবে। GitHub → `Soft-IT-Care-Ltd/Gift-Valy-CRM` → **Settings → Deploy keys → Add deploy key** → Title: `antu-vps` → লাইনটা paste করুন → **"Allow write access" টিক দেবেন না** → Add key।
2. **Repository টা private করুন।** `Gift-Valy-CRM` এখন **public** — যে কেউ code আর deploy এর ফাইল পড়তে পারে। Antu আর admin panel এর repo private। GitHub → Settings → General → Danger Zone → **Change visibility → Private**। (কোনো secret repo তে নেই, তবু private রাখাই নিরাপদ।)
3. **Cloudflare — staging এর নাম।** Zone `funnelliner.com` → **DNS → Add record**: Type `A`, Name `gv-staging`, IPv4 = server এর IP (Antu যেটায় চলে), **Proxied (কমলা মেঘ) চালু**। তারপর **Caching → Cache Rules** এ admin panel এর জন্য যে *Bypass cache* rule আছে, তার hostname তালিকায় `gv-staging.funnelliner.com` যোগ করুন।
4. **Backblaze B2 — ব্যাকআপ মুছে ফেলার নিয়ম।** B2 → bucket `antu-backups` → **Lifecycle Settings** → Antu ও admin panel এর নিয়মগুলোর পাশে এই পাঁচটা যোগ করুন:

   | File name prefix | Days from uploading to hiding | Days from hiding to deleting |
   |---|---|---|
   | `giftvaly-db-` | 14 | 1 |
   | `giftvaly-hourly/` | 7 | 1 |
   | `giftvaly-uploads/` | (খালি) | 30 |
   | `giftvaly-invoices/` | (খালি) | 30 |
   | `giftvaly-files-old/` | 30 | 1 |

---

## ধাপ ২ — Staging (পরীক্ষার কপি)

Developer staging বসানোর পর:

1. **Staging এর প্রথম Admin** — নিজের Mac এর Terminal থেকে:

   ```bash
   ssh -t antu 'cd /srv/giftvaly-staging/app && npm run db:bootstrap'
   ```

   নাম, ইমেইল, ফোন আর একটা অস্থায়ী পাসওয়ার্ড (দুবার, স্ক্রিনে দেখাবে না) চাইবে। প্রথমবার ঢুকলে নতুন পাসওয়ার্ড দিতে হবে।
2. **Staging এর দরজার পাসওয়ার্ড** — নিজের Terminal থেকে:

   ```bash
   ssh -t antu '/srv/giftvaly-staging/app/scripts/staging-auth.sh'
   ```

   একবারই একটা user name ও পাসওয়ার্ড দেখাবে — সাথে সাথে password manager এ রাখুন। `https://gv-staging.funnelliner.com` খুললে আগে এটা চাইবে।
3. **admin-staging এ Gift Valy যোগ করুন** — `https://admin-staging.funnelliner.com` → **Clients → Add client**:
   - নাম: Gift Valy (staging)
   - Shop code: `giftvaly`
   - Machine address: `http://localhost:3210`
   - Platform secret: নিজের Terminal এ এটা চালিয়ে যা আসে, সেটাই paste করুন:

     ```bash
     ssh antu 'sed -nE "s/^PLATFORM_SECRET=\"?([^\"]*)\"?$/\1/p" /srv/giftvaly-staging/shared/.env'
     ```

   তারপর **Test connection** — সবুজ হতে হবে।
4. **মাসের পরীক্ষা** — developer admin-staging এর `?asOf=` দিয়ে ১ তারিখ, ৭ তারিখ, ৮ তারিখ চালিয়ে দেখাবে: বিল আসে, reminder আসে, ৮ তারিখে dashboard বন্ধ হয়, পেমেন্ট দিলে কয়েক সেকেন্ডে খুলে যায়। সব ঠিক থাকলে developer কে **OK** দিন — তার আগে production হবে না।

> Staging এ **আসল Steadfast API key কখনো সেভ করবেন না** — ওখান থেকে parcel পাঠালে সত্যিকারের consignment তৈরি হয়ে যাবে।

---

## ধাপ ৩ — Production এর দিন

Developer production বসানো, cron, ব্যাকআপ আর Nginx এর কাজ শেষ করার পর, এই ক্রমে:

1. **`.env` এর কপি password manager এ** — নিজের Terminal থেকে:

   ```bash
   ssh antu 'cat /srv/giftvaly/shared/.env'
   ```

   পুরোটা password manager এ একটা secure note হিসেবে রাখুন। (সার্ভার নষ্ট হলে ব্যাকআপ ফেরত আনতে বিশেষ করে `COURIER_ENCRYPTION_KEY` লাগবে।) একইভাবে `/srv/giftvaly-staging/shared/.env` ও রাখুন।
2. **আপনার Admin account** — নিজের Terminal থেকে:

   ```bash
   ssh -t antu 'cd /srv/giftvaly/app && npm run db:bootstrap'
   ```

   এটা শুধু role আর আপনার Admin বানায় — কোনো demo data, কোনো order না। **Production এ কখনো পরীক্ষার order বানাবেন না** — প্রতিটা order Funnel Liner এর বিলে গোনা হয়। পরীক্ষা শুধু staging এ।
3. **Admin panel এ Gift Valy যোগ করুন** — `https://admin.funnelliner.com` → **Clients → Add client**:
   - নাম: Gift Valy
   - Shop code: `giftvaly`
   - Machine address: `http://localhost:3200`
   - Billing start date আর build fee: আপনার সিদ্ধান্ত মতো
   - Platform secret: নিজের Terminal থেকে:

     ```bash
     ssh antu 'sed -nE "s/^PLATFORM_SECRET=\"?([^\"]*)\"?$/\1/p" /srv/giftvaly/shared/.env'
     ```

   **Test connection** — সবুজ হতে হবে।
4. **Steadfast panel** — `https://dashboard.funnelliner.com` এ Admin হিসেবে ঢুকে **Courier** পাতায় Steadfast এর API key ও secret সেভ করুন। ওই পাতায় একটা **Callback URL** আর একটা **Bearer token** দেখাবে। Steadfast এর panel → Webhook settings এ:
   - Callback URL: `https://dashboard.funnelliner.com/_c/giftvaly/api/webhooks/steadfast`
   - Auth token: Courier পাতার Bearer token

   প্রথম parcel এর status আপডেট এলে বুঝবেন webhook কাজ করছে।
5. **Staff account** — **Admin → Users → নতুন user**: প্রত্যেকের নাম, ইমেইল, **ফোন নম্বর** (একেকজনের আলাদা — এই নম্বর দিয়েই সে ঢুকবে), role, আর একটা অস্থায়ী পাসওয়ার্ড। প্রথমবার ঢুকলে সে নিজের পাসওয়ার্ড বানাবে।
6. **Staff কে জানান:**
   - নতুন ঠিকানা: **`https://dashboard.funnelliner.com`**
   - প্রথমবার একটা "ফোন নম্বর দিন" পাতা আসবে → নিজের নম্বর দিলে Gift Valy এর sign-in পাতায় নিয়ে যাবে → পাসওয়ার্ড দিন। এরপর ওই ফোনে সরাসরি Gift Valy খুলবে।
   - আগে মোবাইলে যারা app (PWA) install করেছিল, পুরনোটা মুছে নতুন ঠিকানা থেকে আবার "Add to Home Screen" করুক।

---

## ধাপ ৪ — `app.giftvaly.com` কে নতুন ঠিকানায় পাঠানো (Cloudflare)

পুরনো bookmark আর install করা app যেন নতুন জায়গায় যায়:

1. Cloudflare → zone **`giftvaly.com`** → **DNS**: `app` record টা **Proxied (কমলা মেঘ)** থাকতে হবে। পুরনো VPS বাতিল করার পর record টা `A`, IPv4 `192.0.2.1`, Proxied করে দিন — redirect টা Cloudflare নিজেই করে, server লাগে না।
2. **Rules → Redirect Rules → Create rule**:
   - নাম: `app.giftvaly.com → dashboard`
   - If: **Hostname equals** `app.giftvaly.com`
   - Then: **Static**, URL `https://dashboard.funnelliner.com`, Status **301**, *Preserve query string* বন্ধ
   - Deploy
3. পরীক্ষা: ব্রাউজারে `https://app.giftvaly.com` খুললে `dashboard.funnelliner.com` এ চলে যাবে।

---

## ধাপ ৫ — পুরনো VPS বাতিল (`144.79.124.98`)

পুরনো server থেকে কিছুই নতুন জায়গায় আনা হচ্ছে না (ওখানে আসল data কখনো ছিল না — ১৮ অক্টোবরের সিদ্ধান্ত)। বাতিলের আগে:

1. ধাপ ৪ এর redirect কাজ করছে কিনা দেখে নিন।
2. **সাবধান:** ওই VPS এ Gift Valy ছাড়াও **`iva.autoslip.xyz`** নামে আরেকটা site (সাথে MySQL/Redis) চলে। ওটার কী হবে আগে ঠিক করুন — দরকার হলে অন্য জায়গায় সরান। ওটা সরানো না হলে VPS বাতিল করবেন না।
3. GitHub → `Gift-Valy-CRM` → Settings → Deploy keys → পুরনো server এর key টা **Delete** করুন।
4. তারপর hosting provider এর panel থেকে VPS বাতিল করুন।

---

## শেষে মিলিয়ে নিন

- [ ] নতুন ফোনে `dashboard.funnelliner.com` → নম্বর চাওয়ার পাতা → Gift Valy এর নম্বর দিলে Gift Valy, Antu এর নম্বর দিলে Antu।
- [ ] Admin panel এ Gift Valy এর **Test connection** সবুজ।
- [ ] Steadfast এর প্রথম webhook এসেছে।
- [ ] Developer জানিয়েছে: প্রথম রাতের ও ঘণ্টার ব্যাকআপ Backblaze এ পৌঁছেছে, আর restore drill পাস করেছে।
- [ ] `app.giftvaly.com` → `dashboard.funnelliner.com`।
- [ ] Production এ কোনো পরীক্ষার order নেই।
