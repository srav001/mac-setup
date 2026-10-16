#!/usr/bin/env bash
# Set up this Mac. Safe to re-run: every step skips what is already done.
set -euo pipefail
cd "$(dirname "$0")"
exec > >(tee -a setup.log) 2>&1

echo "Your administrator password is needed once."
sudo -v
while kill -0 $$ 2>/dev/null; do sudo -n true; sleep 50; done 2>/dev/null &

for step in steps/*.sh; do
    echo "==> ${step#steps/} $(date '+%H:%M:%S')"
    bash "$step"
done
echo "Done. See MANUAL.md for the steps a script cannot do."
