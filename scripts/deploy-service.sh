#!/usr/bin/env bash
set -euo pipefail

export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
if [ -s "$NVM_DIR/nvm.sh" ]; then
  # shellcheck disable=SC1090
  . "$NVM_DIR/nvm.sh"
fi

cd /home/ilangurudev/projects/lifeos-dashboard
npm run build
systemctl --user restart lifeos-dashboard.service
systemctl --user --no-pager --full status lifeos-dashboard.service
