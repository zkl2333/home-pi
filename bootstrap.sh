#!/usr/bin/env bash
# 在新 / 重装后的 Pi 上一键复盘到当前状态。
# 假设：本仓库已 git clone 到任意位置，以 pi 用户身份运行。
#
#   git clone <this-repo> ~/dev/pi
#   cd ~/dev/pi && bash bootstrap.sh
#
# 幂等：可重复执行。
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")" && pwd)"
PI_HOME="${HOME}"

log() { printf '\n\033[1;36m== %s ==\033[0m\n' "$*"; }

# ─── 0. 必要前置 ───────────────────────────────────
if [ "$(id -un)" != "pi" ]; then
  echo "建议以 pi 用户运行；当前是 $(id -un)。"
fi

# ─── 1. 系统包 ────────────────────────────────────
log "安装系统依赖（apt）"
sudo apt-get update -y
sudo apt-get install -y \
    git curl wget \
    python3-pip python3-pil python3-numpy python3-spidev python3-rpi.gpio \
    fonts-wqy-microhei

# ─── 2. 启用 SPI / I2C ────────────────────────────
log "启用 SPI / I2C（如未启用）"
sudo raspi-config nonint do_spi 0 || true
sudo raspi-config nonint do_i2c 0 || true

# ─── 3. 微雪 e-Paper SDK ─────────────────────────
log "拉取 Waveshare e-Paper SDK 到 ~/e-Paper（如不存在）"
if [ ! -d "${PI_HOME}/e-Paper/RaspberryPi_JetsonNano/python/lib/waveshare_epd" ]; then
  git clone --depth 1 https://github.com/waveshareteam/e-Paper.git "${PI_HOME}/e-Paper"
else
  echo "已存在，跳过"
fi

# ─── 4. PiSugar 套件 ──────────────────────────────
log "安装 PiSugar power-manager（如未装）"
if ! systemctl is-enabled --quiet pisugar-server 2>/dev/null; then
  curl -fsSL https://cdn.pisugar.com/release/pisugar-power-manager.sh | bash -s -- -c release
else
  echo "pisugar-server 已存在，跳过"
fi

# ─── 5. SSH 公钥定时同步 ─────────────────────────
log "部署 GitHub 公钥同步脚本到 ~/.ssh/sync-github-keys.sh"
mkdir -p "${PI_HOME}/.ssh"
chmod 700 "${PI_HOME}/.ssh"
install -m 755 "${REPO_ROOT}/pi-scripts/sync-github-keys.sh" "${PI_HOME}/.ssh/sync-github-keys.sh"
"${PI_HOME}/.ssh/sync-github-keys.sh" || echo "(首次同步失败，稍后 cron 会重试)"

log "安装 crontab"
( crontab -l 2>/dev/null | grep -v 'github-keys-sync' || true; \
  cat "${REPO_ROOT}/pi-config/pi-crontab.txt" | grep -v '^#' ) | crontab -
crontab -l

# ─── 6. /etc/rc.local（如和仓库版本不同则替换） ─
log "同步 /etc/rc.local"
if ! diff -q "${REPO_ROOT}/pi-config/etc/rc.local" /etc/rc.local >/dev/null 2>&1; then
  sudo install -m 755 "${REPO_ROOT}/pi-config/etc/rc.local" /etc/rc.local
  echo "已更新 /etc/rc.local"
else
  echo "已是最新"
fi

# ─── 7. 我的项目 ──────────────────────────────────
log "部署 projects/* 到 ~/projects/"
mkdir -p "${PI_HOME}/projects"
for proj in "${REPO_ROOT}"/projects/*/; do
  [ -d "$proj" ] || continue
  name="$(basename "$proj")"
  dst="${PI_HOME}/projects/${name}"
  rm -rf "${dst}"
  cp -r "$proj" "${dst}"
  echo "  $name → ${dst}"
  if [ -x "${dst}/install.sh" ]; then
    echo "  运行 ${name}/install.sh"
    ( cd "${dst}" && bash install.sh )
  fi
done

log "全部完成。"
echo "建议手动确认："
echo "  • systemctl status eink-status pisugar-server"
echo "  • crontab -l"
echo "  • 重启一次让 SPI / rc.local 生效（如本次有更新）"
