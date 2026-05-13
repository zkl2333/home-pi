#!/usr/bin/env bash
# 一键 ssh 进 Pi。在 Windows git-bash 下优先用系统 ssh.exe（能用 1Password agent）。
# mDNS 不通时用 PI_HOST=<ip> bash scripts/pi.sh ... 临时覆盖。
SSH="${SSH_BIN:-ssh}"
if [ -z "${SSH_BIN:-}" ] && [ -x /c/Windows/System32/OpenSSH/ssh.exe ]; then
  SSH=/c/Windows/System32/OpenSSH/ssh.exe
fi
PI_USER="${PI_USER:-pi}"
PI_HOST="${PI_HOST:-zero2w.local}"
exec "$SSH" -4 "${PI_USER}@${PI_HOST}" "$@"
