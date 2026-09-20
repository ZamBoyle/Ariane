#!/bin/bash
# Appended to the Debian package's postinst by electron-builder.
#
# Installs the AppArmor profile that lets Chromium open an unprivileged user
# namespace for its sandbox. Without it, Ubuntu 24.04 denies the capability and
# Electron aborts before drawing a window — the app simply does nothing when
# launched from the menu.
#
# electron-builder's own postinst tries to decide this by running
# `unshare --user true`, but it runs that test AS ROOT during installation,
# where the restriction does not apply. The test therefore passes, chrome-sandbox
# is left without the setuid bit, and the app then fails at runtime as an
# ordinary user. Installing the profile fixes the cause rather than the symptom,
# and keeps the namespace sandbox instead of falling back to the weaker SUID one.

set -e

PROFILE_SOURCE='/opt/Ariane/resources/apparmor/ariane'
PROFILE_TARGET='/etc/apparmor.d/ariane'

if [ ! -f "$PROFILE_SOURCE" ]; then
  exit 0
fi

# Only meaningful where AppArmor is actually in use.
if [ ! -d /etc/apparmor.d ]; then
  exit 0
fi

install -m 0644 "$PROFILE_SOURCE" "$PROFILE_TARGET" || exit 0

# Load it now so the app works without a reboot. A failure here is not fatal:
# the profile is on disk and will be picked up on the next boot.
if command -v apparmor_parser >/dev/null 2>&1; then
  apparmor_parser -r -T -W "$PROFILE_TARGET" >/dev/null 2>&1 || true
fi

exit 0
