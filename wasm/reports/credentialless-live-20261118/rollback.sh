#!/usr/bin/env bash
set -euo pipefail
rm -f "$HOME/.config/systemd/user/weborca-models-preview-18974.service.d/99-credentialless-live.conf"
systemctl --user daemon-reload
systemctl --user restart weborca-models-preview-18974.service
