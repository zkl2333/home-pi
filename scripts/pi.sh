#!/usr/bin/env bash
# 一键 ssh 进 Pi。在 Windows git-bash 下优先用系统 ssh.exe（能用 1Password agent）。
SSH="${SSH_BIN:-ssh}"
if [ -z "${SSH_BIN:-}" ] && [ -x /c/Windows/System32/OpenSSH/ssh.exe ]; then
  SSH=/c/Windows/System32/OpenSSH/ssh.exe
fi
exec "$SSH" pi@192.168.31.35 "$@"
