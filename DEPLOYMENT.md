# Deploying Gift Valy

The exact commands, in order, for adding Gift Valy to **the server that already runs Antu Boutique and the Funnel Liner admin panel** (FUNNEL_LINER.md GV-11 … GV-17). That server was set up with the Antu repo's `DEPLOYMENT.md`: Ubuntu 24.04, the `deploy` user, PostgreSQL 18, Node 24 (Gift Valy's `package.json` pins `24.x`), PM2 (started on boot for `deploy`), Nginx with the Cloudflare real-IP snippet and `snippets/acme-challenge.conf`, ufw letting only Cloudflare reach 80/443, certbot by webroot, and the encrypted off-server backup remote `antu-offsite:` (Backblaze B2, a key that can't delete, Object Lock 14 days). **None of that is repeated here.** Gift Valy adds only its own folders, databases, `.env` files, PM2 apps, one staging site, a cron file and its backups.

| | Production | Staging |
|---|---|---|
| Address (people) | `https://dashboard.funnelliner.com` — shared with Antu; Nginx routes by the shop remembered on the device (GV-16) | `https://gv-staging.funnelliner.com` — basic auth, noindex |
| Address (machines) | `https://dashboard.funnelliner.com/_c/giftvaly/…`; on the server `http://localhost:3200` | `https://gv-staging.funnelliner.com/_c/giftvaly/…`; on the server `http://localhost:3210` |
| App | PM2 `giftvaly`, `localhost:3200`, `/srv/giftvaly` | PM2 `giftvaly-staging`, `localhost:3210`, `/srv/giftvaly-staging` |
| Database | `giftvaly` — roles `giftvaly_owner` / `giftvaly_app` | `giftvaly_staging` — roles `giftvaly_staging_owner` / `giftvaly_staging_app` |
| `.env` | `/srv/giftvaly/shared/.env` | `/srv/giftvaly-staging/shared/.env` |
| Uploads, invoice PDFs | `/srv/giftvaly/uploads`, `/srv/giftvaly/invoices` | `/srv/giftvaly-staging/uploads`, `/srv/giftvaly-staging/invoices` |
| Data | roles + the owner's Admin (`npm run db:bootstrap`), then real data only — **never the demo seed, never a test order** (CLAUDE.md rule 6) | bootstrap + test freely |
| Cron, backups | yes (steps 10, 11) | none — jobs run by hand |
| Logs | `/var/log/giftvaly/app*.log`, `cron.log`, `backup.log` | `/var/log/giftvaly/staging*.log` |

**Uploads and invoice PDFs** (GV-11) live outside every release folder, so a deploy never touches them. Nginx never serves either folder (no `root` or `alias` in any site file): uploads are served by the app's own `/uploads/<file>` route to signed-in people only, invoice PDFs by the logged-in invoice download. Both are backed up nightly (step 11).

Commands marked **(root)** run as root through `sudo` from `ssh antu` (the server refuses SSH logins as root; `deploy` has sudo); everything else runs as `deploy` (`ssh antu`). Secrets are made **on the server** with `openssl` and written straight into the files that need them — none is typed into a chat, a command line on another machine, or this repository. The owner keeps a copy of each `.env` in the password manager.

**Order (GV5):** staging first — steps 1–7, 8 (bootstrap), then 7b (the suite needs bootstrap's roles), 9 and 12 (staging) — then the month test (step 14a), then, after the owner's OK, production: steps 10, 11, 8 and 13, and the checklist (step 14b).

---

## 0. Before you start

| You need | State |
|---|---|
| DNS `gv-staging.funnelliner.com` — A record to the server, **proxied** (orange cloud) | owner, in Cloudflare |
| A read-only GitHub deploy key for `Soft-IT-Care-Ltd/Gift-Valy-CRM` — step 1 | a repository admin adds it |
| The A7 shared sign-in page (admin repo) and the GV-N Nginx block (Antu repo) built and pushed | both repos |
| B2 lifecycle rules for the `giftvaly-` prefixes — step 11 | owner, in the B2 web UI |
| The Admin's name, email and phone; Gift Valy's billing start date and build fee | owner |

Check the room first (six apps will run on this machine; each Next app takes 300–600 MB):

```bash
free -h && df -h / && pm2 ls
```

---

## 1. Deploy key **(deploy)**

GitHub allows a deploy key on one repository only, so this repo gets its own key and an SSH host alias, `github-giftvaly` (as the admin panel did):

```bash
ssh-keygen -q -t ed25519 -N "" -C "antu-vps giftvaly deploy (read-only)" -f ~/.ssh/github_giftvaly && printf '\nHost github-giftvaly\n  HostName github.com\n  User git\n  IdentityFile ~/.ssh/github_giftvaly\n  IdentitiesOnly yes\n' >> ~/.ssh/config && cat ~/.ssh/github_giftvaly.pub
```

On GitHub: `Soft-IT-Care-Ltd/Gift-Valy-CRM` → **Settings → Deploy keys → Add deploy key**, title `antu-vps`, paste the line, **leave "Allow write access" unticked**. Then:

```bash
ssh -T git@github-giftvaly
```

("You've successfully authenticated, but GitHub does not provide shell access" is right.) `scripts/deploy.sh` makes the mirror `/srv/giftvaly/repo.git` from it on the first deploy and fetches from GitHub on every deploy — push there first.

---

## 2. Folders and logs **(root)**

```bash
install -d -o deploy -g deploy -m 755 /srv/giftvaly /srv/giftvaly/releases /srv/giftvaly/shared /srv/giftvaly-staging /srv/giftvaly-staging/releases /srv/giftvaly-staging/shared /var/log/giftvaly && install -d -o deploy -g deploy -m 750 /srv/giftvaly/uploads /srv/giftvaly/invoices /srv/giftvaly-staging/uploads /srv/giftvaly-staging/invoices && install -d -o deploy -g deploy -m 700 /var/backups/giftvaly
```

A bootstrap clone, for the files the first install needs (removed in step 7):

```bash
sudo -u deploy git clone git@github-giftvaly:Soft-IT-Care-Ltd/Gift-Valy-CRM.git /srv/giftvaly/bootstrap
```

---

## 3. Databases and roles **(root)**

Both copies on the same PostgreSQL 18, each with its own database and two roles: an owner (migrations, backups) and the app's role (rows only). The passwords are made here and written straight into each `.env` in step 6 — so do steps 3 and 6 in one sitting, in one root shell:

```bash
umask 077; for c in prod staging; do printf 'OWNER_PW=%s\nAPP_PW=%s\n' "$(openssl rand -hex 24)" "$(openssl rand -hex 24)" > /root/giftvaly-$c.pw; done
```

```bash
for c in prod staging; do
  . /root/giftvaly-$c.pw
  if [ $c = prod ]; then DB=giftvaly; else DB=giftvaly_staging; fi
  sudo -u postgres psql -v ON_ERROR_STOP=1 -q <<SQL
CREATE ROLE ${DB}_owner LOGIN PASSWORD '$OWNER_PW';
CREATE ROLE ${DB}_app LOGIN PASSWORD '$APP_PW';
CREATE DATABASE $DB OWNER ${DB}_owner ENCODING 'UTF8' TEMPLATE template0 LC_COLLATE 'en_US.UTF-8' LC_CTYPE 'en_US.UTF-8';
\c $DB
REVOKE ALL ON SCHEMA public FROM PUBLIC;
GRANT ALL ON SCHEMA public TO ${DB}_owner;
GRANT USAGE ON SCHEMA public TO ${DB}_app;
ALTER DEFAULT PRIVILEGES FOR ROLE ${DB}_owner IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ${DB}_app;
ALTER DEFAULT PRIVILEGES FOR ROLE ${DB}_owner IN SCHEMA public GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO ${DB}_app;
SQL
done
```

Access: the six lines in `deploy/postgresql/pg_hba-giftvaly.conf`. Append them once and reload:

```bash
grep -q '^local   giftvaly ' /etc/postgresql/18/main/pg_hba.conf || grep -E '^(local|host)' /srv/giftvaly/bootstrap/deploy/postgresql/pg_hba-giftvaly.conf >> /etc/postgresql/18/main/pg_hba.conf; systemctl reload postgresql
```

**The same six lines must also go into the Antu repo's `deploy/postgresql/pg_hba.conf`** (the file installed on the server), as the admin panel's did — otherwise a re-install from it drops Gift Valy's access. Each copy's roles reach only its own database; Antu's and the admin panel's roles never reach these.

No shadow database on the server: `SHADOW_DATABASE_URL` is development only (CLAUDE.md rule 8) and `deploy.sh` refuses it.

---

## 4. Cloudflare (owner, in the dashboard, zone `funnelliner.com`)

1. **DNS:** `gv-staging` — A (and AAAA) to the server, **proxied**.
2. **Caching → Cache Rules** — the zone's only two, shared by every name in it (Antu's, the admin panel's and Gift Valy's; as of 23 Oct 2026 the zone had none, so they are made here once). Each: **Create rule** → **Custom filter expression** → **Edit expression** → paste → **Deploy**. *Never cache* stays above *Build files*.
   1. **Never cache** → *Cache eligibility:* **Bypass cache**:
      ```
      (starts_with(http.request.uri.path, "/api/") or starts_with(http.request.uri.path, "/uploads/") or starts_with(http.request.uri.path, "/_c/") or http.request.uri.path eq "/sw.js") or (http.host in {"dashboard.funnelliner.com" "admin.funnelliner.com" "admin-staging.funnelliner.com" "staging.funnelliner.com" "gv-staging.funnelliner.com"} and not starts_with(http.request.uri.path, "/_next/static/"))
      ```
   2. **Build files** → *Cache eligibility:* **Eligible for cache**; *Edge TTL:* **Use cache-control header if present, bypass cache if not**; *Browser TTL:* respect origin:
      ```
      starts_with(http.request.uri.path, "/_next/static/")
      ```
   The Edge TTL choice matters: a device with no remembered shop gets `302 /go/` for every path, `/_next/static/…` included, and that redirect must never be cached (Nginx also sends it with `Cache-Control: no-store`). Never "Cache Everything" in this zone. `staging-shop.funnelliner.com` (Antu's staging website) needs no host entry — the path conditions cover it. Antu's third rule (public images) belongs to the shop's own zone, not this one. Rocket Loader, Email Address Obfuscation and Bot Fight Mode stay off (Antu's SETUP.md §7.5).
3. Nothing else: Full (strict), Always Use HTTPS and TLS are the zone's. Production needs no new name — it is `dashboard.funnelliner.com`.

---

## 5. Nginx and the staging certificate **(root)**

The certificate first, through a port-80-only site:

```bash
printf 'server {\n    listen 80;\n    listen [::]:80;\n    server_name gv-staging.funnelliner.com;\n    include snippets/cloudflare-real-ip.conf;\n    include snippets/acme-challenge.conf;\n    location / { return 404; }\n}\n' > /etc/nginx/sites-available/gv-acme.conf && ln -sf /etc/nginx/sites-available/gv-acme.conf /etc/nginx/sites-enabled/ && nginx -t && systemctl reload nginx
```

```bash
certbot certonly --webroot -w /var/www/letsencrypt -d gv-staging.funnelliner.com --agree-tos -m <owner email> --non-interactive
```

Then the real files — staging's guard and site — and remove the temporary one:

```bash
B=/srv/giftvaly/bootstrap/deploy/nginx; install -m 644 $B/snippets/giftvaly-staging-guard.conf /etc/nginx/snippets/ && install -m 644 $B/giftvaly-staging.conf /etc/nginx/sites-available/ && ln -sf /etc/nginx/sites-available/giftvaly-staging.conf /etc/nginx/sites-enabled/ && rm -f /etc/nginx/sites-enabled/gv-acme.conf /etc/nginx/sites-available/gv-acme.conf && install -m 640 -o root -g www-data /dev/null /etc/nginx/giftvaly-staging.htpasswd && nginx -t && systemctl reload nginx
```

What it does: `gv-staging.funnelliner.com` → `127.0.0.1:3210`; `/_c/giftvaly/…` → the same app with the prefix removed; any other `/_c/…` and `/go/…` → 404; port 80 → a 301 to HTTPS; the Cloudflare real IP; basic auth and noindex (`snippets/giftvaly-staging-guard.conf`; the PWA files stay readable). It uses Antu's `antu-app-proxy.conf` for the proxy headers and timeouts. Until the owner runs `scripts/staging-auth.sh` (step 9), every staging request gets 401.

**Production has no site file of its own.** `dashboard.funnelliner.com` is the Antu repo's `antu-crm.conf` (GV-N/GV-16): `/_c/giftvaly/` → `127.0.0.1:3200`, and every other path → the shop remembered on the device. It is installed on go-live day (step 13).

### 5b. `app.giftvaly.com` — only if its DNS is moved here

The plan is a **Cloudflare Redirect Rule** in the `giftvaly.com` zone (GO_LIVE.md), which needs nothing on this server. Only if the owner points `app.giftvaly.com` at this server instead: a port-80 site and a certificate exactly as above with `app.giftvaly.com`, then

```bash
install -m 644 /srv/giftvaly/app/deploy/nginx/giftvaly-legacy-redirect.conf /etc/nginx/sites-available/ && ln -sf /etc/nginx/sites-available/giftvaly-legacy-redirect.conf /etc/nginx/sites-enabled/ && nginx -t && systemctl reload nginx
```

It answers only with a 301 to `https://dashboard.funnelliner.com/`.

---

## 6. The `.env` files **(root, the same shell as step 3)**

```bash
for c in prod staging; do
  . /root/giftvaly-$c.pw
  if [ $c = prod ]; then DB=giftvaly; DIR=/srv/giftvaly; URL=https://dashboard.funnelliner.com; else DB=giftvaly_staging; DIR=/srv/giftvaly-staging; URL=https://gv-staging.funnelliner.com; fi
  install -m 600 -o deploy -g deploy /dev/null $DIR/shared/.env
  cat > $DIR/shared/.env <<ENV
DATABASE_URL="postgresql://${DB}_app:$APP_PW@localhost/$DB?host=/var/run/postgresql&connection_limit=5&pool_timeout=10"
DIRECT_URL="postgresql://${DB}_owner:$OWNER_PW@localhost/$DB?host=/var/run/postgresql"
NEXTAUTH_URL="$URL"
INSTANCE_URL="$URL/_c/giftvaly"
NEXTAUTH_SECRET="$(openssl rand -base64 32)"
COURIER_ENCRYPTION_KEY="$(openssl rand -base64 32)"
CRON_SECRET="$(openssl rand -hex 32)"
PLATFORM_SECRET="$(openssl rand -hex 32)"
SHARED_SIGNIN=""
FUNNEL_LINER_HELP_PHONE=""
UPLOAD_DIR="$DIR/uploads"
INVOICE_DIR="$DIR/invoices"
ENV
  if [ $c = prod ]; then printf 'BACKUP_DIR="/var/backups/giftvaly"\nBACKUP_RCLONE_REMOTE="antu-offsite:"\nBACKUP_RETENTION_DAYS="14"\nBACKUP_HOURLY_RETENTION_HOURS="48"\n' >> $DIR/shared/.env; fi
done; shred -u /root/giftvaly-prod.pw /root/giftvaly-staging.pw
```

Then the owner copies each file into the password manager, from their own Terminal (`ssh antu 'cat /srv/giftvaly/shared/.env'`). A restore needs `COURIER_ENCRYPTION_KEY` above all: without it the saved Steadfast keys must be typed in again. Fill `FUNNEL_LINER_HELP_PHONE` with Funnel Liner's help number if it should show on the Billing page.

- Each copy has its **own** `PLATFORM_SECRET` — staging's is never production's.
- `SHARED_SIGNIN` stays empty until go-live day (step 13), and on staging always: there is no shared sign-in page on `gv-staging`.
- **Never** in these files: `SHADOW_DATABASE_URL` or `BOOTSTRAP_ADMIN_*`. `scripts/deploy.sh` refuses those, a database or role that isn't this copy's, a `NEXTAUTH_URL`/`INSTANCE_URL` that isn't this copy's, upload or invoice folders other than the two above, a `COURIER_ENCRYPTION_KEY` equal to `NEXTAUTH_SECRET`, and a `PLATFORM_SECRET` equal to `CRON_SECRET`.

---

## 7. Deploys — `scripts/deploy.sh` **(deploy)**

`scripts/deploy.sh [--staging] <branch, tag or commit>`: checks the `.env` → fetches from GitHub → builds in `releases/<stamp>-<sha>` while the current release keeps serving (`npm ci` → `prisma migrate deploy`, waiting past minute :05 of the hour for the hourly dumps → GRANTs to the app role → `npm run build`) → switches the `app` symlink → `pm2 startOrReload` → health check on `127.0.0.1:<port>/login`, switching back if it doesn't answer. Five releases are kept. Only `prisma migrate deploy` ever touches the database (CLAUDE.md rule 8).

**The first deploy** — staging (production follows in GV5 Part 2, after the owner's OK):

```bash
/srv/giftvaly/bootstrap/scripts/deploy.sh --staging main
```

```bash
/srv/giftvaly/bootstrap/scripts/deploy.sh main
```

`deploy.sh` runs `pm2 save`, so both start on boot. Once both are up, remove the bootstrap clone:

```bash
rm -rf /srv/giftvaly/bootstrap
```

**Every later deploy** — first on the development Mac: the tests (`npm run test:deploy`, `test:order-paths`, `test:bom`, `test:platform`, `test:shadow-db`), `npm run lint`, `npm run build`, then push to GitHub. Then on the server, staging first:

```bash
/srv/giftvaly/app/scripts/deploy.sh --staging main
```

```bash
/srv/giftvaly/app/scripts/deploy.sh main
```

A deploy restarts the one process: a few seconds where Gift Valy doesn't answer. Avoid 02:45–03:45 Dhaka (20:45–21:45 UTC), when the backups and the trash cleanup run.

Staging can be stopped when nobody is testing: `pm2 stop giftvaly-staging && pm2 save` (start the same way).

### 7b. The suite on the server (staging)

The file tests need no database; `test:platform` also runs its database part inside a transaction that is rolled back — **on staging only**, and **after step 8**: that part needs a role and the Funnel Liner system user, which bootstrap creates (on an empty database five of its tests fail with "record not found"):

```bash
cd /srv/giftvaly-staging/app && npm run test:deploy && npm run test:order-paths && npm run test:bom && npm run test:shadow-db && npm run test:platform
```

All must pass before production is deployed.

---

## 8. Roles and the first Admin — `npm run db:bootstrap` (the owner, from their own Terminal)

Staging now; production on go-live day (step 13):

```bash
ssh -t antu 'cd /srv/giftvaly-staging/app && npm run db:bootstrap'
```

```bash
ssh -t antu 'cd /srv/giftvaly/app && npm run db:bootstrap'
```

It creates what is missing — every permission, the six roles with their permissions, the default settings, the standard expense categories, the Steadfast courier (1% COD fee, zone rates set later on the Courier page) — and, only while no active Admin exists, asks for the Admin's name, email, phone and a temporary password (twice, not shown). They reach `prisma/bootstrap.ts` as environment variables of that one process: nothing is written to a file, a log or shell history. The Admin must change the password at first sign-in. It creates **no orders, customers, products or demo data** and never touches the order counter. Run again, it does nothing. More staff: **Admin → Users**.

**Never `npm run db:seed` (or `prisma db seed`) on the server.** The demo seed creates orders and moves the billing counter; it refuses `NODE_ENV=production` and any URL naming the `giftvaly` database.

---

## 9. Staging's password (the owner, from their own Terminal)

```bash
ssh -t antu '/srv/giftvaly-staging/app/scripts/staging-auth.sh'
```

It makes a random password, stores only its hash in `/etc/nginx/giftvaly-staging.htpasswd`, checks staging answers 401 without it and lets the password in, and prints it once — into the password manager. Run again to change it.

---

## 10. Cron and logs **(root, production only — go-live day)**

`deploy/cron/giftvaly` — a `/etc/cron.d` file of its own, because Antu's step 11 installs the deploy user's crontab whole with `crontab -`, which would wipe lines added there. The jobs call `127.0.0.1:3200` through `scripts/run-job.sh`, which reads `CRON_SECRET` from the production `.env` — no secret in the cron file:

| Job | Dhaka | Cron (UTC) |
|---|---|---|
| Steadfast status + payments sync | every 15 minutes | `*/15 * * * *` |
| Nightly backup (database + uploads + invoices) | 03:00 | `0 21 * * *` |
| Trash cleanup (orders in the trash 30 days) | 03:30 | `30 21 * * *` |
| Hourly database backup | 10:00–22:00 | `0 4-16 * * *` |

```bash
install -m 644 -o root -g root /srv/giftvaly/app/deploy/cron/giftvaly /etc/cron.d/giftvaly && install -m 644 /srv/giftvaly/app/deploy/logrotate/giftvaly /etc/logrotate.d/giftvaly && logrotate -d /etc/logrotate.d/giftvaly 2>&1 | tail -3
```

While Funnel Liner has Gift Valy suspended, the Steadfast sync keeps running and the trash cleanup answers 423 (`cron.log` shows it; it catches up when the shop is open again — GV-7).

Staging has no cron. Its jobs are run by hand **(deploy)**:

```bash
curl -fsS -H "Authorization: Bearer $(sed -nE 's/^CRON_SECRET="?([^"]*)"?$/\1/p' /srv/giftvaly-staging/shared/.env)" http://127.0.0.1:3210/api/cron/steadfast-sync
```

---

## 11. Backups

`scripts/backup.sh` (`--hourly`) — the same way and to the same remote as Antu's and the admin panel's:

- `pg_dump giftvaly` (custom format), checked with `pg_restore --list`, copied to `antu-offsite:` — nightly as `giftvaly-db-<stamp>.dump` at the top level, hourly under `giftvaly-hourly/`;
- nightly also: `rclone sync` of the uploads to `giftvaly-uploads/` and of the invoice PDFs to `giftvaly-invoices/` — only new and changed files travel; a file deleted or replaced on the server goes to `giftvaly-files-old/<stamp>/`, never lost;
- local retention in `/var/backups/giftvaly`: 14 days nightly, 48 hours hourly — only after a good dump;
- a failed run writes `BACKUP FAILED: …` to `/var/log/giftvaly/backup.log`. There is no backup report in the app (owner, 18 Oct 2026): check the log and the bucket.

The server's B2 key can't delete, so the bucket's lifecycle rules remove old copies. **The owner adds five rules** in B2 → the `antu-backups` bucket → Lifecycle Settings (beside Antu's and the admin panel's):

| File name prefix | Days from uploading to hiding | Days from hiding to deleting |
|---|---|---|
| `giftvaly-db-` | 14 | 1 |
| `giftvaly-hourly/` | 7 | 1 |
| `giftvaly-uploads/` | — | 30 |
| `giftvaly-invoices/` | — | 30 |
| `giftvaly-files-old/` | 30 | 1 |

Object Lock (Antu's step 12.5) covers the whole bucket, these files included. Then run both once by hand **(deploy)** and check the files are off the server:

```bash
/srv/giftvaly/app/scripts/backup.sh && /srv/giftvaly/app/scripts/backup.sh --hourly && rclone lsl antu-offsite: --include 'giftvaly-db-*' --include 'giftvaly-hourly/**' | tail -5 && rclone size antu-offsite:giftvaly-uploads
```

**Restore drill** (owner's OK first; never over a live database) **(root)** — into a throwaway database, then check and drop it:

```bash
sudo -u postgres createdb -O giftvaly_owner giftvaly_restore && sudo -u postgres pg_restore --no-owner --role=giftvaly_owner --dbname=giftvaly_restore < "$(ls -1t /var/backups/giftvaly/giftvaly-db-*.dump | head -1)" && sudo -u postgres psql -d giftvaly_restore -Atc "select count(*) from users; select count(*) from orders; select * from order_sequences order by year_month desc limit 3;"
```

```bash
sudo -u postgres dropdb giftvaly_restore
```

(Check the name twice: `giftvaly_restore`, never `giftvaly`.) The dump is fed in on standard input (`<`, opened by root) because `postgres` can't read `deploy`'s dumps (600, in a 700 folder). From off the server, fetch a dump first with `rclone copy antu-offsite:giftvaly-db-<stamp>.dump .`, and the files with `rclone copy antu-offsite:giftvaly-uploads /srv/giftvaly/uploads` (likewise invoices). The app needs the same `COURIER_ENCRYPTION_KEY` (from the password manager) to read the saved Steadfast keys.

| Date | Dump | Result |
|---|---|---|
| 23 Oct 2026 | `giftvaly-db-20261022-225718.dump` (production, before go-live) | passed — 28 migrations, 0 users / orders / `order_sequences` rows, as the live database |

---

## 12. Funnel Liner and Steadfast

**Staging — admin-staging.** The owner, in `https://admin-staging.funnelliner.com`: **Clients → Add client** — Gift Valy (staging), shop code `giftvaly`, machine address `http://localhost:3210`, and the staging `PLATFORM_SECRET` pasted in from their own Terminal:

```bash
ssh antu 'sed -nE "s/^PLATFORM_SECRET=\"?([^\"]*)\"?$/\1/p" /srv/giftvaly-staging/shared/.env'
```

**Test connection** must pass.

**Steadfast on staging:** never save the real Steadfast API keys on staging — sending a parcel there would book a real consignment. A webhook test is a `curl` to `http://127.0.0.1:3210/api/webhooks/steadfast` with the Bearer token the staging Courier page shows.

**Production — on go-live day (step 13):** the same in `https://admin.funnelliner.com`: Gift Valy, shop code `giftvaly`, machine address `http://localhost:3200`, the billing start date and build fee from the owner, and the production `PLATFORM_SECRET` (`/srv/giftvaly/shared/.env`), read by the owner from their own Terminal and pasted into the client page — never into a chat, a file or code. **Test connection** must pass.

**Steadfast panel (production):** Callback URL `https://dashboard.funnelliner.com/_c/giftvaly/api/webhooks/steadfast`, with the Bearer token shown on Gift Valy's Courier page (Admin). The Courier page shows the same URL (built from `INSTANCE_URL`).

---

## 13. Go live (GV5 Part 2, after the owner's OK)

In this order:

1. **Deploy production** (step 7) — the first time from the bootstrap clone.
2. **Cron and backups** — step 10 and step 11 (lifecycle rules, both runs by hand).
3. **Nginx for two shops (root):** install the admin repo's A7 files and the Antu repo's new `antu-crm.conf` together, as the admin panel's DEPLOYMENT.md step 14 says (`fl-shops.conf` already maps `giftvaly 127.0.0.1:3200`), then `nginx -t && systemctl reload nginx`. Two things first (found on go-live day, 23 Oct 2026):
   - the admin panel's **production** release must contain A7 (`/srv/fl-admin/app/deploy/nginx/conf.d/fl-shops.conf` exists, `/go` answers on `127.0.0.1:3300`) — otherwise deploy it (admin DEPLOYMENT.md step 7) first;
   - **both** shops — Antu (`antu`, `http://localhost:3000`) and Gift Valy — must already be clients **with their platform secret** in `admin.funnelliner.com`. The shared page asks only those; without them every device without Antu's session cookie lands on `/go/` and finds no shop. So do item 5 (Add client) before this item; the Antu repo's new `antu-crm.conf` takes a `__DOMAIN__` (`sed "s/__DOMAIN__/antuboutique.com/g"`).
4. **The owner's Admin** — step 8, production. No demo data, no test order (CLAUDE.md rule 6).
5. **Admin panel → Add client** and the **Steadfast panel** — step 12, production.
6. **Shared sign-in on** — in both Gift Valy's and Antu's production `.env` **(deploy)**, then restart both:

   ```bash
   for f in /srv/giftvaly/shared/.env /srv/antu-crm/shared/.env; do grep -q '^SHARED_SIGNIN=' $f && sed -i 's/^SHARED_SIGNIN=.*/SHARED_SIGNIN="enabled"/' $f || echo 'SHARED_SIGNIN="enabled"' >> $f; done; pm2 restart giftvaly antu-crm --update-env && pm2 save
   ```

7. **`app.giftvaly.com`** → the owner's Cloudflare redirect (GO_LIVE.md), or step 5b.
8. The checklist below.

---

## 14. Checklists

### 14a. Staging month test (with admin-staging's `?asOf=`)

1. 1st → the month's bill appears on Gift Valy staging's Billing page; Admin and Accounts see the reminder banner, the Admin the pop-up.
2. 7th → "Today is the last day".
3. 8th → every page goes to `/billing`; the Steadfast webhook (curl, step 12) and `steadfast-sync` (by hand, step 10) still work.
4. Record the payment in admin-staging → the dashboard opens within seconds.

### 14b. After the production deploy

- [ ] On a new phone, `dashboard.funnelliner.com` shows the shared sign-in page; a Gift Valy number lands on Gift Valy's sign-in page with the number filled in; an Antu number lands on Antu's; a number in neither gets "wrong phone/email or password".
- [ ] After sign-in, every page and asset loads from the right shop; "Not your shop?" switches shop.
- [ ] An Antu staff member's experience is unchanged apart from the shared sign-in page on a new device.
- [ ] `https://dashboard.funnelliner.com/_c/giftvaly/api/platform/usage` answers with `PLATFORM_SECRET` and 401 without it; `/_c/anything-else/` is a 404.
- [ ] Admin panel → Clients → Gift Valy (shop code `giftvaly`, `http://localhost:3200`): **Test connection** passes.
- [ ] Steadfast panel → Callback URL `https://dashboard.funnelliner.com/_c/giftvaly/api/webhooks/steadfast` with the Courier page's Bearer token; the first webhook arrives.
- [ ] An uploaded photo opens for a signed-in person, and `/uploads/<file>` in a private window (no session) gives 401.
- [ ] The first nightly and hourly backups land in Backblaze (`backup.log` ends "Backup complete"); the restore drill (step 11) passes and is logged above.
- [ ] `app.giftvaly.com` redirects to `dashboard.funnelliner.com`.
- [ ] No test order on production (rule 6): Settings → Funnel Liner shows this month's count = the real orders only.
