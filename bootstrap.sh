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

# ─── 0.5. APT 国内镜像（清华 TUNA） ───────────────
# Pi 在国内网络下，官方源 raspbian.raspberrypi.org / archive.raspberrypi.org 慢且偶发超时。
# 切到 TUNA：bullseye / armv7。bookworm 同源路径不变；换大版本时改下面 SUITE 即可。
# 想换别家镜像（中科大 / 阿里）改 MIRROR_* 两行就行。
log "切换 APT 源到国内镜像（清华 TUNA，幂等）"
SUITE="$(. /etc/os-release && echo "$VERSION_CODENAME")"  # bullseye / bookworm
MIRROR_RASPBIAN="https://mirrors.tuna.tsinghua.edu.cn/raspbian/raspbian"
MIRROR_RASPI="https://mirrors.tuna.tsinghua.edu.cn/raspberrypi"

if ! grep -q "tuna.tsinghua.edu.cn/raspbian" /etc/apt/sources.list 2>/dev/null; then
  sudo cp /etc/apt/sources.list "/etc/apt/sources.list.bak.$(date +%s)" 2>/dev/null || true
  sudo tee /etc/apt/sources.list >/dev/null <<EOF
deb ${MIRROR_RASPBIAN}/ ${SUITE} main contrib non-free rpi
# deb-src ${MIRROR_RASPBIAN}/ ${SUITE} main contrib non-free rpi
EOF
  echo "已写入 /etc/apt/sources.list (TUNA, ${SUITE})"
else
  echo "/etc/apt/sources.list 已是 TUNA，跳过"
fi

RASPI_LIST=/etc/apt/sources.list.d/raspi.list
if [ -f "$RASPI_LIST" ] && ! grep -q "tuna.tsinghua.edu.cn/raspberrypi" "$RASPI_LIST"; then
  sudo cp "$RASPI_LIST" "${RASPI_LIST}.bak.$(date +%s)"
  sudo tee "$RASPI_LIST" >/dev/null <<EOF
deb ${MIRROR_RASPI}/ ${SUITE} main
# deb-src ${MIRROR_RASPI}/ ${SUITE} main
EOF
  echo "已写入 ${RASPI_LIST} (TUNA, ${SUITE})"
else
  echo "${RASPI_LIST} 已是 TUNA 或不存在，跳过"
fi

# ─── 1. 系统包 ────────────────────────────────────
log "安装系统依赖（apt）"
sudo apt-get update -y
sudo apt-get install -y \
    git curl wget \
    python3-pip python3-pil python3-numpy python3-spidev python3-rpi.gpio \
    fonts-wqy-microhei \
    i2c-tools


# ─── 1.5. Node.js（官方 armv7l 预编译包） ──────────────────────────────────
# 锁定 v22.22.2：v24 起官方将 armv7l 降为 Experimental、停止发布预编译包，v22 是最后有官方包的 LTS。
# 升级时改 NODE_VER 即可。
NODE_VER=22.22.2
NODE_ARCH="armv7l"
log "安装 Node.js v${NODE_VER}（官方 armv7l 预编译包）"
if node --version 2>/dev/null | grep -q "^v${NODE_VER}"; then
  echo "Node.js 已是 ${NODE_VER}，跳过"
else
  echo "安装 Node.js v${NODE_VER}"
  wget -q --show-progress -O /tmp/node.tar.xz \
    "https://nodejs.org/dist/v${NODE_VER}/node-v${NODE_VER}-linux-${NODE_ARCH}.tar.xz"
  sudo tar -xJf /tmp/node.tar.xz -C /usr/local --strip-components=1
  rm -f /tmp/node.tar.xz
  node --version && npm --version
fi

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
# 锁定 2.3.2：1.7.x 系列存在 long-uptime accept-queue 死锁（上游 issue #131）；
# 2.3.3 仅是 CI 改成 ARMv6 编译目标（适配 pi zero v1），对 Pi Zero 2 W (ARMv7) 反而更慢。
PISUGAR_VER=2.3.2
PISUGAR_ARCH=$(dpkg --print-architecture)
log "安装/升级 PiSugar power-manager 到 ${PISUGAR_VER} (${PISUGAR_ARCH})"
PISUGAR_CUR=""
if command -v pisugar-server >/dev/null 2>&1; then
  PISUGAR_CUR=$(pisugar-server --version 2>/dev/null | awk '{print $2}')
fi
if [ "$PISUGAR_CUR" = "$PISUGAR_VER" ]; then
  echo "pisugar-server 已是 ${PISUGAR_VER}，跳过"
else
  echo "当前 ${PISUGAR_CUR:-未装} → 升级到 ${PISUGAR_VER}"
  PISUGAR_TMP=$(mktemp -d /tmp/pisugar-install.XXXXXX)
  for pkg in pisugar-server pisugar-poweroff pisugar-programmer; do
    wget -q -O "${PISUGAR_TMP}/${pkg}.deb" \
      "http://cdn.pisugar.com/release/${pkg}_${PISUGAR_VER}-1_${PISUGAR_ARCH}.deb"
  done
  # 已知坑：旧版 server 死锁时 prerm 的 systemctl stop 会卡死，pkill -9 兜底
  sudo systemctl stop pisugar-server 2>/dev/null || true
  sleep 1
  sudo pkill -9 -x pisugar-server 2>/dev/null || true
  # --force-confold：保留我们自己的 /etc/pisugar-server/config.json（auth + auto_rtc_sync）
  sudo dpkg --force-confold -i "${PISUGAR_TMP}"/*.deb
  rm -rf "$PISUGAR_TMP"
  sudo systemctl enable --now pisugar-server >/dev/null
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
