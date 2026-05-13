#!/usr/bin/env bash
# 一次性脚本：把 eink-render 推到 Pi、装 systemd、curl 拉 PNG 检查。
# 不动 eink-status、不实际推屏。
#
# 用法（任选一）：
#   bash scripts/pi-bringup.sh <pi-ip-or-mdns>
#   PI_HOST=<pi-ip-or-mdns> bash scripts/pi-bringup.sh
#
# 前置：
#   你的 ~/.ssh/config 或 1Password agent 能正常 ssh 上 Pi
#   （Claude 这边自动调 ssh 会被 1Password 弹窗 refuse，所以脚本由你跑）

set -euo pipefail

# 第一个位置参数优先；否则读环境变量；都没有就报错
PI_HOST="${1:-${PI_HOST:-}}"
if [ -z "$PI_HOST" ]; then
  echo "用法: bash scripts/pi-bringup.sh <pi-ip-or-mdns>"
  echo "  例: bash scripts/pi-bringup.sh zero2w.local"
  exit 2
fi
export PI_HOST  # deploy.sh / pi.sh 都读它

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT_DIR="${REPO_ROOT}/pi-bringup-output"
mkdir -p "$OUT_DIR"

echo "▶ 0. 检查 Pi 连通 + Node 版本（确保 bootstrap.sh 已经跑过、Node 在）"
bash "${REPO_ROOT}/scripts/pi.sh" 'hostname; uname -m; node --version; python3 --version'

echo
echo "▶ 1. 推 projects/eink-render 到 Pi（tar over ssh）"
bash "${REPO_ROOT}/scripts/deploy.sh" eink-render

echo
echo "▶ 2. Pi 上跑 install.sh（npm install --omit=dev + 字体 + systemd unit）"
bash "${REPO_ROOT}/scripts/pi.sh" 'cd ~/projects/eink-render && bash install.sh'

echo
echo "▶ 3. 等 server 就绪"
for i in 1 2 3 4 5; do
  if bash "${REPO_ROOT}/scripts/pi.sh" 'curl -fs http://127.0.0.1:8787/api/health' >/dev/null 2>&1; then
    echo "  ✓ health OK"
    break
  fi
  echo "  ... $i/5"
  sleep 2
done

echo
echo "▶ 4. 拉 6 页 PNG 回本机检查（${OUT_DIR}/）"
for page in overview system power calendar weather news; do
  bash "${REPO_ROOT}/scripts/pi.sh" "curl -fs http://127.0.0.1:8787/api/render?page=${page}" \
    > "${OUT_DIR}/${page}.png"
  bytes=$(wc -c < "${OUT_DIR}/${page}.png" | tr -d ' ')
  echo "  ${page}.png  ${bytes}B"
done

echo
echo "▶ 5. 内存占用快照（看有没有逼近 MemoryMax=180M）"
bash "${REPO_ROOT}/scripts/pi.sh" 'systemctl status eink-render --no-pager | head -8'

echo
echo "✅ 全部完成。检查："
echo "  - ${OUT_DIR}/*.png  6 张图，用图片查看器看"
echo "  - bash scripts/pi.sh 'journalctl -u eink-render -e --no-pager | tail -30'  日志"
echo "  - bash scripts/pi.sh 'sudo systemctl status eink-render'  状态"
echo
echo "回滚（如想下掉）："
echo "  bash scripts/pi.sh 'sudo systemctl disable --now eink-render && sudo rm /etc/systemd/system/eink-render.service && sudo systemctl daemon-reload'"
