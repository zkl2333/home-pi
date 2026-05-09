#!/usr/bin/env bash
# 在 Pi 本机执行：装成 systemd daemon（事件驱动，常驻）。
set -euo pipefail

cd "$(dirname "$0")"
[ -f eink_status.py ] || { echo "找不到 eink_status.py"; exit 1; }

# 移除旧的 timer（如有）
sudo systemctl disable --now eink-status.timer 2>/dev/null || true
sudo rm -f /etc/systemd/system/eink-status.timer

sudo install -m 644 eink-status.service /etc/systemd/system/eink-status.service
sudo systemctl daemon-reload
sudo systemctl enable --now eink-status.service
sudo systemctl restart eink-status.service

sleep 2
systemctl status eink-status.service --no-pager || true
echo
echo "查看日志:  journalctl -u eink-status -e -f"
