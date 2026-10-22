#!/usr/bin/env bash
# Gift Valy — deploy or update (FUNNEL_LINER.md GV-14, DEPLOYMENT.md step 7).
# On the server, as the deploy user:
#
#   /srv/giftvaly/app/scripts/deploy.sh <branch, tag or commit>             production (default: main)
#   /srv/giftvaly/app/scripts/deploy.sh --staging <branch, tag or commit>   the staging copy
#
# The same shape as Antu Boutique's and the Funnel Liner admin panel's
# scripts/deploy.sh: check the .env → fetch from GitHub → build in
# /srv/giftvaly[-staging]/releases/<stamp>-<sha> while the current release
# keeps serving (npm ci → prisma migrate deploy → GRANTs → build) → switch the
# `app` symlink → pm2 startOrReload → health check on 127.0.0.1:<port>/login,
# switching back if the new release doesn't answer. Five releases are kept.
#
# The database: only `prisma migrate deploy` (CLAUDE.md rule 8 — never reset,
# push or migrate dev against it), outside the first five minutes of an hour,
# when the hourly pg_dumps run. A migration is not rolled back if a later step
# fails: migrations are written to work with the code before them.
#
# It refuses an .env that could reach the wrong database, keep files inside a
# release, or hold what a server .env must never hold (the shadow database,
# BOOTSTRAP_ADMIN_*).

set -Eeuo pipefail
umask 022

STAGING=0
if [[ "${1:-}" == "--staging" ]]; then STAGING=1; shift; fi
REF="${1:-main}"
# Its own read-only deploy key, through the "github-giftvaly" SSH host alias
# (DEPLOYMENT.md step 1) — GitHub allows one repository per deploy key.
REPO_URL="${GIFTVALY_REPO:-git@github-giftvaly:Soft-IT-Care-Ltd/Gift-Valy-CRM.git}"
# One mirror of the repository serves both copies.
MIRROR="${GIFTVALY_MIRROR:-/srv/giftvaly/repo.git}"
if (( STAGING )); then
  BASE="${GIFTVALY_BASE:-/srv/giftvaly-staging}"
  DB_NAME=giftvaly_staging; OWNER_ROLE=giftvaly_staging_owner; APP_ROLE=giftvaly_staging_app
  PUBLIC_URL="https://gv-staging.funnelliner.com"
  ECOSYSTEM=deploy/ecosystem.staging.config.cjs; PORT=3210; ERROR_LOG=/var/log/giftvaly/staging-error.log
else
  BASE="${GIFTVALY_BASE:-/srv/giftvaly}"
  DB_NAME=giftvaly; OWNER_ROLE=giftvaly_owner; APP_ROLE=giftvaly_app
  PUBLIC_URL="https://dashboard.funnelliner.com"
  ECOSYSTEM=deploy/ecosystem.config.cjs; PORT=3200; ERROR_LOG=/var/log/giftvaly/app-error.log
fi
RELEASES="$BASE/releases"
SHARED_ENV="$BASE/shared/.env"
CURRENT="$BASE/app"
KEEP=5

log() { printf '\n%s ── %s\n' "$(date -u +%H:%M:%S)" "$*"; }
die() { printf '\nDEPLOY FAILED: %s\n' "$*" >&2; exit 1; }
trap 'die "a step failed at line $LINENO — the running app is unchanged unless the switch already happened"' ERR

[[ "$(id -un)" != "root" ]] || die "run as the deploy user, not root"
[[ -f "$SHARED_ENV" ]] || die "$SHARED_ENV is missing (DEPLOYMENT.md step 6)"
[[ "$(stat -c %a "$SHARED_ENV")" == "600" ]] || die "$SHARED_ENV must be mode 600"

# ── 0. The .env ───────────────────────────────────────────────────────────
env_value() { sed -nE "s/^$1=\"?([^\"]*)\"?\$/\1/p" "$SHARED_ENV" | tail -n 1; }
DIRECT_URL="$(env_value DIRECT_URL)"
[[ "$DIRECT_URL" == *"//$OWNER_ROLE:"* ]] || die "DIRECT_URL must be the $OWNER_ROLE role"
[[ "$(env_value DATABASE_URL)" == *"//$APP_ROLE:"* ]] || die "DATABASE_URL must be the $APP_ROLE role"
# The database name, exactly — a staging .env can never reach "giftvaly", nor production "giftvaly_staging".
for v in DIRECT_URL DATABASE_URL; do
  [[ "$(env_value "$v")" =~ @[^@/]+/${DB_NAME}(\?|$) ]] || die "$v must point at the $DB_NAME database"
done
# CLAUDE.md rule 9: people's links use NEXTAUTH_URL, machines INSTANCE_URL.
[[ "$(env_value NEXTAUTH_URL)" == "$PUBLIC_URL" ]] || die "NEXTAUTH_URL must be $PUBLIC_URL"
[[ "$(env_value INSTANCE_URL)" == "$PUBLIC_URL/_c/giftvaly" ]] || die "INSTANCE_URL must be $PUBLIC_URL/_c/giftvaly"
for v in NEXTAUTH_SECRET COURIER_ENCRYPTION_KEY PLATFORM_SECRET; do
  [[ -n "$(env_value "$v")" ]] || die "$v is not set"
done
# The saved Steadfast keys are encrypted with COURIER_ENCRYPTION_KEY: it must
# be its own key, or rotating NEXTAUTH_SECRET would make them unreadable.
[[ "$(env_value COURIER_ENCRYPTION_KEY)" != "$(env_value NEXTAUTH_SECRET)" ]] || die "COURIER_ENCRYPTION_KEY must differ from NEXTAUTH_SECRET"
CRON_SECRET_VALUE="$(env_value CRON_SECRET)"
(( ${#CRON_SECRET_VALUE} >= 16 )) || die "CRON_SECRET must be at least 16 characters"
[[ "$CRON_SECRET_VALUE" != "$(env_value PLATFORM_SECRET)" ]] || die "PLATFORM_SECRET must differ from CRON_SECRET"
# GV-11: uploads and invoices live outside every release, in this copy's own folder.
for pair in "UPLOAD_DIR:$BASE/uploads" "INVOICE_DIR:$BASE/invoices"; do
  v="${pair%%:*}"; want="${pair#*:}"
  [[ "$(env_value "$v")" == "$want" ]] || die "$v must be $want"
  [[ -d "$want" ]] || die "$want is missing (DEPLOYMENT.md step 2)"
done
for v in SHADOW_DATABASE_URL BOOTSTRAP_ADMIN_NAME BOOTSTRAP_ADMIN_EMAIL BOOTSTRAP_ADMIN_PHONE BOOTSTRAP_ADMIN_PASSWORD; do
  [[ -z "$(env_value "$v")" ]] || die "$v must not be in a server .env"
done

# ── 1. Pull ───────────────────────────────────────────────────────────────
log "Fetching $REF"
if [[ ! -d "$MIRROR" ]]; then git clone --quiet --mirror "$REPO_URL" "$MIRROR"; fi
# Always from GitHub (read-only deploy key) — never whatever was last pushed
# into the mirror by hand.
[[ "$(git -C "$MIRROR" config --get remote.origin.url || true)" == "$REPO_URL" ]] \
  || die "$MIRROR must fetch from $REPO_URL"
git -C "$MIRROR" fetch --quiet --prune origin || die "can't fetch from GitHub — check the deploy key: ssh -T git@github-giftvaly"
SHA="$(git -C "$MIRROR" rev-parse --verify --quiet "$REF^{commit}")" || die "no branch, tag or commit called $REF"
DIR="$RELEASES/$(date -u +%Y%m%d-%H%M%S)-${SHA:0:7}"
mkdir -p "$RELEASES"
git clone --quiet --no-checkout "$MIRROR" "$DIR"
git -C "$DIR" checkout --quiet --detach "$SHA"
ln -s "$SHARED_ENV" "$DIR/.env"
echo "Release $DIR ($(git -C "$DIR" log -1 --format='%h %s'))"
cd "$DIR"

# ── 2. Dependencies ───────────────────────────────────────────────────────
log "npm ci"
npm ci --no-audit --no-fund

# ── 3. Migrations — outside the first five minutes of an hour ─────────────
minute=$((10#$(date -u +%M)))
if (( minute < 6 )); then
  wait_s=$(( (6 - minute) * 60 - 10#$(date -u +%S) ))
  log "Waiting ${wait_s}s: the hourly backups run in the first minutes of the hour"
  sleep "$wait_s"
fi
log "prisma migrate deploy"
npx prisma migrate deploy

# ── 4. Grants for the app's role ──────────────────────────────────────────
log "GRANTs to $APP_ROLE"
psql "$DIRECT_URL" -v ON_ERROR_STOP=1 -q \
  -c "GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO $APP_ROLE;" \
  -c "GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public TO $APP_ROLE;"

# ── 5. Build ──────────────────────────────────────────────────────────────
log "npm run build"
npm run build

# ── 6. Switch and reload ──────────────────────────────────────────────────
PREVIOUS="$(readlink "$CURRENT" 2>/dev/null || true)"
log "Switching $CURRENT → $DIR"
ln -sfn "$DIR" "$CURRENT.next"
mv -T "$CURRENT.next" "$CURRENT"
pm2 startOrReload "$CURRENT/$ECOSYSTEM" --update-env
pm2 save >/dev/null

# ── 7. Health check — roll the code back if the new release won't answer ──
log "Health check"
healthy=0
for _ in $(seq 1 30); do
  if curl -fsS -o /dev/null -m 5 "http://127.0.0.1:$PORT/login"; then healthy=1; break; fi
  sleep 2
done
if (( ! healthy )); then
  if [[ -n "$PREVIOUS" && -d "$PREVIOUS" ]]; then
    ln -sfn "$PREVIOUS" "$CURRENT.next" && mv -T "$CURRENT.next" "$CURRENT"
    pm2 startOrReload "$CURRENT/$ECOSYSTEM" --update-env && pm2 save >/dev/null
    die "the new release didn't answer on 127.0.0.1:$PORT/login — switched back to $PREVIOUS (any migration stays applied). See $ERROR_LOG"
  fi
  die "the app didn't answer on 127.0.0.1:$PORT/login — see $ERROR_LOG"
fi

# ── 8. Tidy ───────────────────────────────────────────────────────────────
ls -1dt "$RELEASES"/*/ | tail -n +$((KEEP + 1)) | while IFS= read -r d; do
  [[ "$(realpath "$d")" == "$(realpath "$CURRENT")" ]] || rm -rf "$d"
done

trap - ERR
log "Deployed ${SHA:0:7} — $PUBLIC_URL"
