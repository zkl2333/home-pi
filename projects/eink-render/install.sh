#!/usr/bin/env bash
# 在 Pi 本机执行：装成 systemd daemon（HTTP server，监听 127.0.0.1:8787）。
set -euo pipefail

cd "$(dirname "$0")"
[ -f server.mjs ] || { echo "找不到 server.mjs"; exit 1; }

# ─── Node 版本预检 ──────────────────────────────────
if ! command -v node >/dev/null 2>&1; then
  echo "❌ 未找到 node，先跑 bootstrap.sh（会装 v22.22.2 armv7l 预编译包）"
  exit 1
fi
NODE_VER=$(node --version)
echo "node ${NODE_VER}"

# ─── 字体（gitignored，每台机器自己拉） ─────────────
if [ ! -f fonts/wqy-microhei.ttf ]; then
  echo "下载字体（wqy-microhei，gitignored）..."
  npm run setup-font
fi

# ─── prod 依赖（不装 vite / react-dom / @vitejs/plugin-react） ─
# Pi 上不跑 dev preview，只跑 server。
echo "npm install --omit=dev ..."
npm install --omit=dev --no-audit --no-fund

# ─── systemd unit ───────────────────────────────────
sudo install -m 644 eink-render.service /etc/systemd/system/eink-render.service
sudo systemctl daemon-reload
sudo systemctl enable --now eink-render.service
sudo systemctl restart eink-render.service

sleep 2
systemctl status eink-render.service --no-pager || true
echo
echo "Smoke test:"
curl -s --max-time 5 http://127.0.0.1:8787/api/health && echo " ← /api/health"
echo
echo "查看日志:  journalctl -u eink-render -e -f"
