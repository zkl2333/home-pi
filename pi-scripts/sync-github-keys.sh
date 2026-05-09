#!/usr/bin/env bash
# 部署在 Pi 的 /home/pi/.ssh/sync-github-keys.sh （此处保留一份副本作参考）
# 由 cron 周期性触发：
#   @reboot /home/pi/.ssh/sync-github-keys.sh
#   0 * * * * /home/pi/.ssh/sync-github-keys.sh
#
# 走 GitHub REST API（api.github.com 在国内 IP 可达；github.com 直连 443 会超时）
set -euo pipefail

GH_USER="zkl2333"
API_URL="https://api.github.com/users/${GH_USER}/keys"
DEST="$HOME/.ssh/authorized_keys"
TMP_JSON="$(mktemp)"
TMP_KEYS="$(mktemp)"
trap 'rm -f "$TMP_JSON" "$TMP_KEYS"' EXIT

if ! curl -fsSL --max-time 15 -H 'Accept: application/vnd.github+json' "$API_URL" -o "$TMP_JSON"; then
  logger -t github-keys "fetch failed: $API_URL"
  exit 1
fi

python3 - "$TMP_JSON" > "$TMP_KEYS" <<'PY'
import json, sys
data = json.load(open(sys.argv[1]))
assert isinstance(data, list) and data, "empty or non-list payload"
for item in data:
    k = (item.get("key") or "").strip()
    if k:
        print(k)
PY

if [ ! -s "$TMP_KEYS" ]; then
  logger -t github-keys "no keys parsed, abort (keep existing)"
  exit 1
fi

if ! head -n1 "$TMP_KEYS" | grep -qE '^(ssh-(ed25519|rsa|dss)|ecdsa-sha2-) '; then
  logger -t github-keys "invalid key format, abort"
  exit 1
fi

mkdir -p "$HOME/.ssh"
chmod 700 "$HOME/.ssh"
install -m 600 "$TMP_KEYS" "$DEST"
logger -t github-keys "synced $(wc -l < "$DEST") key(s) from $API_URL"
