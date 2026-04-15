#!/usr/bin/env bash
/usr/bin/bluelayer-mihomo-service-uninstall || true

if [ -f "/usr/share/applications/bluelayer.desktop" ]; then
    rm -vf "/usr/share/applications/bluelayer.desktop"
fi

update-desktop-database /usr/share/applications || true
