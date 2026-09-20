#!/bin/bash
# Appended to the Debian package's postrm. Removes the AppArmor profile that
# deb-after-install.sh added, so an uninstall leaves nothing behind.

set -e

PROFILE='/etc/apparmor.d/ariane'

if [ -f "$PROFILE" ]; then
  if command -v apparmor_parser >/dev/null 2>&1; then
    apparmor_parser -R "$PROFILE" >/dev/null 2>&1 || true
  fi
  rm -f "$PROFILE"
fi

exit 0
