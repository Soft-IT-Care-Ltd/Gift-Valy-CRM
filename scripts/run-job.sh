#!/usr/bin/env bash
# Gift Valy — call one scheduled job on the app, for cron (deploy/cron/giftvaly,
# FUNNEL_LINER.md GV-13). The job routes are called on 127.0.0.1:3200, never
# through Cloudflare; CRON_SECRET is read from the production .env here, so it
# is never written into a crontab or a cron.d file.
#
#   scripts/run-job.sh <steadfast-sync|trash-cleanup>
#
# While Funnel Liner has the shop suspended, trash-cleanup answers 423 (GV-7)
# and this exits non-zero: the log shows it, and the purge catches up once
# the shop is open again (it works from a cutoff date).
#
# Settings it reads (environment, or the .env): CRON_SECRET; GIFTVALY_ENV
# (default /srv/giftvaly/shared/.env); GIFTVALY_URL (default http://127.0.0.1:3200).

set -Eeuo pipefail

JOB="${1:-}"
[[ "$JOB" =~ ^(steadfast-sync|trash-cleanup)$ ]] || { echo "usage: run-job.sh <steadfast-sync|trash-cleanup>" >&2; exit 2; }

ENV_FILE="${GIFTVALY_ENV:-/srv/giftvaly/shared/.env}"
URL="${GIFTVALY_URL:-http://127.0.0.1:3200}"
if [[ -z "${CRON_SECRET:-}" && -f "$ENV_FILE" ]]; then
  CRON_SECRET="$(sed -nE 's/^CRON_SECRET="?([^"]*)"?$/\1/p' "$ENV_FILE" | tail -n 1)"
fi
[[ -n "${CRON_SECRET:-}" ]] || { echo "$(date -u +%FT%TZ) $JOB: no CRON_SECRET" >&2; exit 1; }

# The secret reaches curl on stdin (-K -), never on its command line.
printf '%s %s ' "$(date -u +%FT%TZ)" "$JOB"
printf 'header = "Authorization: Bearer %s"\n' "$CRON_SECRET" \
  | curl -fsS -m 300 -K - "$URL/api/cron/$JOB"
echo
