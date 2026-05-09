#!/usr/bin/env bash
# 把 projects/<name> 全量推到 Pi:~/projects/<name>。
# 用 tar 流式传输（不依赖 rsync，git-bash 默认即可），传完后可选重启 service。
# 用法: bash scripts/deploy.sh <项目名> [--restart]
set -euo pipefail

PI_USER="pi"
PI_HOST="192.168.31.35"

# Windows git-bash: 优先系统 ssh.exe（能用 1Password agent）
SSH="${SSH_BIN:-ssh}"
if [ -z "${SSH_BIN:-}" ] && [ -x /c/Windows/System32/OpenSSH/ssh.exe ]; then
  SSH=/c/Windows/System32/OpenSSH/ssh.exe
fi

if [ $# -lt 1 ]; then
  echo "用法: $0 <项目名> [--restart]"
  echo "可选项目:"
  ls -1 "$(dirname "$0")/../projects" 2>/dev/null || echo "  (projects/ 为空)"
  exit 1
fi

NAME="$1"
RESTART="${2:-}"
SRC="$(cd "$(dirname "$0")/.." && pwd)/projects/$NAME"

[ -d "$SRC" ] || { echo "找不到 $SRC"; exit 1; }

echo "推送 $SRC -> ${PI_USER}@${PI_HOST}:projects/$NAME"
"$SSH" "${PI_USER}@${PI_HOST}" "rm -rf projects/$NAME && mkdir -p projects/$NAME"

tar -C "$SRC" \
    --exclude='.git' --exclude='__pycache__' --exclude='*.pyc' \
    --exclude='node_modules' --exclude='.venv' \
    -cf - . | \
"$SSH" "${PI_USER}@${PI_HOST}" "tar -xf - -C projects/$NAME"

echo "完成。"

if [ "$RESTART" = "--restart" ]; then
  echo "重启 $NAME.service ..."
  "$SSH" "${PI_USER}@${PI_HOST}" "sudo systemctl restart $NAME.service && systemctl is-active $NAME.service"
fi
