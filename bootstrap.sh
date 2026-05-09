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

log "安装 sugar-wifi-conf（蓝牙配 WiFi，PiSugar APP / 微信小程序连接用）"
if ! systemctl is-enabled --quiet sugar-wifi-config 2>/dev/null; then
  curl -fsSL https://repo.pisugar.uk/PiSugar/sugar-wifi-conf/raw/master/install-bin.sh -o /tmp/swc-install.sh
  sudo bash /tmp/swc-install.sh
  rm -f /tmp/swc-install.sh
else
  echo "sugar-wifi-config.service 已存在，跳过"
fi

log "PiSugar 配置 patch：开启 RTC ↔ 系统时间自动同步（pisugar-server 层）"
sudo apt-get install -y jq >/dev/null
PI_CFG=/etc/pisugar-server/config.json
if [ -f "$PI_CFG" ] && [ "$(sudo jq -r '.auto_rtc_sync' "$PI_CFG")" != "true" ]; then
  sudo cp "$PI_CFG" "${PI_CFG}.bak"
  sudo jq '.auto_rtc_sync = true' "${PI_CFG}.bak" | sudo tee "$PI_CFG" >/dev/null
  sudo systemctl restart pisugar-server
  echo "已启用 auto_rtc_sync"
else
  echo "auto_rtc_sync 已是 true 或配置不存在，跳过"
fi

log "把 PiSugar RTC 注册成内核硬件时钟（/dev/rtc0）"
# 内核层 i2c-rtc overlay：让 hwclock / systemd-timesyncd 能直接用 RTC，
# 比 pisugar-server 启动还早就拥有正确系统时间。需重启生效。
if grep -q '^dtoverlay=i2c-rtc' /boot/config.txt; then
  echo "已存在 dtoverlay=i2c-rtc，跳过"
else
  sudo cp /boot/config.txt "/boot/config.txt.bak.$(date +%s)"
  echo 'dtoverlay=i2c-rtc,ds3231' | sudo tee -a /boot/config.txt >/dev/null
  echo "已追加 dtoverlay=i2c-rtc,ds3231 — 重启后生效"
  REBOOT_NEEDED=1
fi
# 内核 RTC 接管后 fake-hwclock 没用了
if systemctl is-enabled --quiet fake-hwclock 2>/dev/null; then
  sudo systemctl disable --now fake-hwclock
  echo "已禁用 fake-hwclock"
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
if [ "${REBOOT_NEEDED:-0}" = "1" ]; then
  echo "  • ⚠️  需要重启：本次改了 /boot/config.txt（i2c-rtc 覆盖层）"
  echo "      sudo reboot"
fi
echo "  • 重启后验证 RTC：ls /dev/rtc0 && sudo hwclock -r"
