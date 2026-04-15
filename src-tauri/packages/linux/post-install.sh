#!/usr/bin/env bash
chmod +x /usr/bin/bluelayer-mihomo-service-install
chmod +x /usr/bin/bluelayer-mihomo-service-uninstall
chmod +x /usr/bin/bluelayer-mihomo-service

for f in /usr/lib/bluelayer/*.desktop /usr/lib64/bluelayer/*.desktop /usr/lib/Bluelayer\ 加速器/*.desktop /usr/lib64/Bluelayer\ 加速器/*.desktop; do
    if [ -f "$f" ]; then
        mv -vf "$f" "/usr/share/applications/bluelayer.desktop"
        break
    fi
done

update-desktop-database /usr/share/applications || true
