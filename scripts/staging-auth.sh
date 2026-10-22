#!/usr/bin/env bash
# Gift Valy — the password in front of STAGING (gv-staging.funnelliner.com,
# FUNNEL_LINER.md GV-14). The OWNER runs it from their own Terminal, as the
# deploy user:
#
#   ssh -t antu '/srv/giftvaly-staging/app/scripts/staging-auth.sh'
#
# It makes a random password on the server, writes only its hash to
# /etc/nginx/giftvaly-staging.htpasswd (root:www-data, 640) and prints it
# ONCE, to that terminal only — into the password manager. Run again, it
# replaces the password. Production has no site file of its own and never
# asks for one.

set -Eeuo pipefail

FILE=/etc/nginx/giftvaly-staging.htpasswd
USERNAME="${1:-giftvaly}"
HOST=gv-staging.funnelliner.com

die() { printf '\nFAILED: %s\n' "$*" >&2; exit 1; }

[[ "$(id -un)" != "root" ]] || die "run as the deploy user, not root"
[[ "$USERNAME" =~ ^[a-z][a-z0-9_-]{2,31}$ ]] || die "the user name must be 3–32 lower-case letters, digits, - or _"
[[ -f /etc/nginx/snippets/giftvaly-staging-guard.conf ]] || die "the staging guard isn't installed in Nginx (DEPLOYMENT.md step 5)"

PASSWORD=""
while (( ${#PASSWORD} < 20 )); do
  PASSWORD+="$(openssl rand -base64 48 | LC_ALL=C tr -dc 'A-HJ-NP-Za-km-z2-9')"
done
PASSWORD="${PASSWORD:0:20}"

HASH="$(printf '%s\n' "$PASSWORD" | openssl passwd -6 -stdin)"
[[ "$HASH" == '$6$'* ]] || die "openssl didn't make a SHA-512 hash"

printf '%s:%s\n' "$USERNAME" "$HASH" | sudo tee "$FILE.new" >/dev/null
sudo chown root:www-data "$FILE.new"
sudo chmod 640 "$FILE.new"
sudo mv -f "$FILE.new" "$FILE"

url="https://$HOST/login"
without="$(curl -s -o /dev/null -w '%{http_code}' -m 10 --resolve "$HOST:443:127.0.0.1" "$url" || true)"
with="$(printf 'user = "%s:%s"\n' "$USERNAME" "$PASSWORD" | curl -s -o /dev/null -w '%{http_code}' -m 10 --resolve "$HOST:443:127.0.0.1" -K - "$url" || true)"
[[ "$without" == "401" ]] || die "$HOST answered $without without the password (expected 401)"
[[ "$with" != "401" && "$with" != "000" ]] || die "$HOST refused the new password ($with) — is the staging app running? (pm2 start giftvaly-staging)"
printf 'checked %s: %s without the password, %s with it\n' "$HOST" "$without" "$with"

printf '\n  Gift Valy staging password — shown once, put it in the password manager now:\n\n'
printf '    user name:  %s\n' "$USERNAME"
printf '    password:   %s\n\n' "$PASSWORD"
printf '  https://%s\n\n' "$HOST"
