#!/usr/bin/env bash
# Gift Valy — `npm run db:bootstrap` (FUNNEL_LINER.md GV-12, CLAUDE.md rule 6):
# roles, permissions and defaults, then the first Admin. Production and
# staging are bootstrapped with this, NEVER the demo seed.
#
# The owner runs it from their own Terminal, never a shared screen or a chat:
#
#   ssh -t antu 'cd /srv/giftvaly/app && npm run db:bootstrap'
#   ssh -t antu 'cd /srv/giftvaly-staging/app && npm run db:bootstrap'
#
# It first runs prisma/bootstrap.ts with no Admin details: that creates what
# is missing and stops. Only when no active Admin exists does it ask for the
# name, email, phone and a temporary password (twice, not shown), and hands
# them to prisma/bootstrap.ts as environment variables of that one process —
# nothing is written to a file, a log or shell history. Run again, it does
# nothing.

set -Eeuo pipefail
umask 077
cd "$(dirname "${BASH_SOURCE[0]}")/.."

NEEDS_ADMIN=3
MIN_LENGTH=8

rc=0
npx --no-install tsx prisma/bootstrap.ts || rc=$?
(( rc == NEEDS_ADMIN )) || exit "$rc"

[[ -t 0 ]] || { echo "Run this from a terminal (ssh -t …): it asks for the first Admin's details."; exit 1; }

echo
echo "The first Admin (more staff are added later in Admin → Users):"
read -r -p "Name: " NAME
read -r -p "Email: " EMAIL
read -r -p "Phone (01XXXXXXXXX): " PHONE
while true; do
  read -r -s -p "Temporary password (at least $MIN_LENGTH characters, not shown): " PW1; echo
  read -r -s -p "The same password again: " PW2; echo
  if [[ "$PW1" != "$PW2" ]]; then echo "They don't match — again."; continue; fi
  if (( ${#PW1} < MIN_LENGTH )); then echo "At least $MIN_LENGTH characters — again."; continue; fi
  break
done
unset PW2

BOOTSTRAP_ADMIN_NAME="$NAME" BOOTSTRAP_ADMIN_EMAIL="$EMAIL" BOOTSTRAP_ADMIN_PHONE="$PHONE" BOOTSTRAP_ADMIN_PASSWORD="$PW1" \
  npx --no-install tsx prisma/bootstrap.ts
unset PW1
echo "Sign in at the shop's address with $PHONE (or $EMAIL) and the temporary password; the app then asks for a new one."
