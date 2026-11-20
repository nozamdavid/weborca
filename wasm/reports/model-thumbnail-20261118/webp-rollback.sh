#!/usr/bin/env bash
set -euo pipefail
rm -f "$HOME/.config/systemd/user/weborca-models-preview-18974.service.d/98-model-thumbnail-webp.conf"
systemctl --user daemon-reload
systemctl --user restart weborca-models-preview-18974.service
