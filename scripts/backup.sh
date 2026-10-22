#!/usr/bin/env bash
# Gift Valy — database, uploads and invoices backup (FUNNEL_LINER.md GV-13),
# at the same times as Antu Boutique's and the admin panel's backups and to
# the same encrypted off-server copy (Antu's docs/BACKUPS.md and DEPLOYMENT.md
# step 12: the rclone crypt remote "antu-offsite:" on Backblaze B2, a key that
# can't delete, Object Lock 14 days). Everything goes under a giftvaly- prefix:
#
#   nightly (default) — 03:00 Dhaka:
#       giftvaly-db-<stamp>.dump              the database, at the remote's top level
#       giftvaly-uploads/  giftvaly-invoices/  the two folders, synced incrementally;
#                                             a file deleted or replaced on the server
#                                             is moved to giftvaly-files-old/<stamp>/
#   --hourly          — every hour 10:00–22:00 Dhaka:
#       giftvaly-hourly/giftvaly-db-<stamp>.dump
#
# In order: pg_dump (custom format) and check it reads back (pg_restore
# --list) → copy it off the server → nightly: sync uploads and invoices off
# the server → local retention, only after a good dump. Off-server retention
# is the bucket's lifecycle rules (the server's key can't delete): the owner
# adds the giftvaly- rules in DEPLOYMENT.md step 11.
#
# No report to the app (owner, 18 Oct 2026: no backup-report route). A failed
# run writes "BACKUP FAILED" to /var/log/giftvaly/backup.log and exits 1.
#
# It only ever READS the database. It never restores, drops or resets
# anything (CLAUDE.md rule 8) — a restore goes into a NEW database, with the
# owner's OK (DEPLOYMENT.md step 11).
#
# Usage:   scripts/backup.sh [--hourly] [path/to/.env]     (default: the app's .env)
#
# Settings (the .env or the environment):
#   DIRECT_URL                         the database as its owner role
#   BACKUP_DIR                         e.g. /var/backups/giftvaly (required)
#   UPLOAD_DIR, INVOICE_DIR            the app's folders (as the app reads them)
#   BACKUP_RETENTION_DAYS              nightly dumps on the server — default 14
#   BACKUP_HOURLY_RETENTION_HOURS      hourly dumps on the server — default 48
#   BACKUP_RCLONE_REMOTE               e.g. "antu-offsite:" (required in production)
#   PG_DUMP / PG_RESTORE               optional paths to a pg_dump/pg_restore at least as new as the server

set -Eeuo pipefail
umask 077

MODE="nightly"
if [[ "${1:-}" == "--hourly" ]]; then MODE="hourly"; shift; fi

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${1:-$APP_DIR/.env}"
if [[ -f "$ENV_FILE" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a
fi

DB_URL="${DIRECT_URL:-${DATABASE_URL:-}}"
BACKUP_DIR="${BACKUP_DIR:-}"
RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-14}"
HOURLY_RETENTION_HOURS="${BACKUP_HOURLY_RETENTION_HOURS:-48}"
REMOTE="${BACKUP_RCLONE_REMOTE:-}"
PG_DUMP="${PG_DUMP:-pg_dump}"
PG_RESTORE="${PG_RESTORE:-pg_restore}"
abs() { [[ "$1" = /* ]] && printf '%s' "$1" || printf '%s/%s' "$APP_DIR" "${1#./}"; }
UPLOADS="$(abs "${UPLOAD_DIR:-./storage/uploads}")"
INVOICES="$(abs "${INVOICE_DIR:-./storage/invoices}")"

STAMP="$(date -u +%Y%m%d-%H%M%S)"
DUMP_FILE="giftvaly-db-$STAMP.dump"
LOG_FILE="$(mktemp -t giftvaly-backup.XXXXXX)"
DEST_DIR="$BACKUP_DIR"
[[ "$MODE" == "hourly" && -n "$BACKUP_DIR" ]] && DEST_DIR="$BACKUP_DIR/hourly"
# One lock per mode: an hourly run never waits on or collides with the nightly one.
LOCK_DIR="${BACKUP_DIR:-/tmp}/.giftvaly-backup-$MODE.lock"
FAILED=()

log() { printf '%s [%s] %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$MODE" "$*"; }

fail() {
  log "BACKUP FAILED: $1"
  exit 1
}
trap 'fail "step failed at line $LINENO: $(tail -n 5 "$LOG_FILE" 2>/dev/null | tr "\n" " ")"' ERR
trap 'rm -f "$LOG_FILE"; rmdir "$LOCK_DIR" 2>/dev/null || true' EXIT

# "antu-offsite:" + "giftvaly-hourly" → "antu-offsite:giftvaly-hourly"; "b2:bucket" + "x" → "b2:bucket/x".
remote_path() {
  local base="${REMOTE%/}"
  if [[ "$base" == *: ]]; then printf '%s%s' "$base" "$1"; else printf '%s/%s' "$base" "$1"; fi
}

# ── Checks ────────────────────────────────────────────────────────────────
[[ -n "$BACKUP_DIR" ]] || fail "BACKUP_DIR is not set"
[[ -n "$DB_URL" ]] || fail "DIRECT_URL is not set"
[[ "$RETENTION_DAYS" =~ ^[1-9][0-9]*$ ]] || fail "BACKUP_RETENTION_DAYS must be a whole number of at least 1"
[[ "$HOURLY_RETENTION_HOURS" =~ ^[1-9][0-9]*$ ]] || fail "BACKUP_HOURLY_RETENTION_HOURS must be a whole number of at least 1"
command -v "$PG_DUMP" >/dev/null || fail "pg_dump not found (install postgresql-client-18, or set PG_DUMP)"
command -v "$PG_RESTORE" >/dev/null || fail "pg_restore not found (set PG_RESTORE)"
mkdir -p "$DEST_DIR"
mkdir "$LOCK_DIR" 2>/dev/null || { log "Another $MODE backup is still running — skipping"; trap - EXIT; rm -f "$LOG_FILE"; exit 0; }

# ── 1. Dump ───────────────────────────────────────────────────────────────
log "Dumping the database to $DEST_DIR/$DUMP_FILE"
"$PG_DUMP" --format=custom --compress=9 --no-owner --no-privileges --file="$DEST_DIR/$DUMP_FILE.part" "$DB_URL" 2>>"$LOG_FILE"
"$PG_RESTORE" --list "$DEST_DIR/$DUMP_FILE.part" >/dev/null 2>>"$LOG_FILE"
mv "$DEST_DIR/$DUMP_FILE.part" "$DEST_DIR/$DUMP_FILE"
DUMP_BYTES="$(wc -c <"$DEST_DIR/$DUMP_FILE" | tr -d ' ')"
[[ "$DUMP_BYTES" -gt 0 ]] || fail "the dump is empty"
log "Database dump OK ($DUMP_BYTES bytes)"

# ── 2. Off the server ─────────────────────────────────────────────────────
if [[ -z "$REMOTE" ]]; then
  log "WARN: BACKUP_RCLONE_REMOTE is not set — this backup stays on the server only"
elif ! command -v rclone >/dev/null; then
  FAILED+=("rclone is not installed")
else
  if [[ "$MODE" == "hourly" ]]; then TARGET="$(remote_path giftvaly-hourly)"; else TARGET="${REMOTE%/}"; fi
  if rclone copy "$DEST_DIR/$DUMP_FILE" "$TARGET" 2>>"$LOG_FILE"; then
    log "Dump copied to $TARGET"
  else
    FAILED+=("copying the dump to $TARGET")
  fi

  # Nightly: the uploads and the invoice PDFs. Only new and changed files
  # travel; anything deleted or replaced on the server goes to
  # giftvaly-files-old/<stamp>/ off-site, never lost.
  if [[ "$MODE" == "nightly" ]]; then
    for pair in "uploads:$UPLOADS" "invoices:$INVOICES"; do
      name="${pair%%:*}"; dir="${pair#*:}"
      if [[ ! -d "$dir" ]]; then
        log "WARN: $name folder $dir not found — skipped"
        continue
      fi
      if rclone sync "$dir" "$(remote_path "giftvaly-$name")" --backup-dir "$(remote_path "giftvaly-files-old/$STAMP/$name")" 2>>"$LOG_FILE"; then
        log "$name synced to $(remote_path "giftvaly-$name")"
      else
        FAILED+=("syncing $name off the server")
      fi
    done
  fi
fi

# ── 3. Retention on the server (only after a good dump) ───────────────────
if [[ "$MODE" == "hourly" ]]; then
  OLD=(-maxdepth 1 -type f -name 'giftvaly-db-*' -mmin "+$((HOURLY_RETENTION_HOURS * 60))")
else
  OLD=(-maxdepth 1 -type f -name 'giftvaly-db-*' -mtime "+$((RETENTION_DAYS - 1))")
fi
PRUNED="$(find "$DEST_DIR" "${OLD[@]}" -print | wc -l | tr -d ' ')"
find "$DEST_DIR" "${OLD[@]}" -delete
find "$DEST_DIR" -maxdepth 1 -type f -name 'giftvaly-*.part' -mmin +720 -delete
log "Retention: removed $PRUNED old file(s)"

if (( ${#FAILED[@]} )); then
  fail "backed up on the server ($DUMP_FILE), but off the server: ${FAILED[*]} — $(tail -n 3 "$LOG_FILE" | tr '\n' ' ')"
fi
log "Backup complete"
