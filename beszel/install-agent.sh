#!/usr/bin/env bash
#
# install-agent.sh — מתקין Beszel agent כ-systemd service (בלי Docker)
# ------------------------------------------------------------------
# חלופה קלה יותר ל-docker-compose.agent.yml עבור מי שלא רוצה Docker.
# מריצים על כל אחד מ-3 השרתים.
#
# שימוש:
#   KEY='ssh-ed25519 AAAA...' TOKEN='xxxx' HUB_URL='http://<IP>:8090' \
#     sudo -E ./install-agent.sh
#
# את KEY / TOKEN / HUB_URL מקבלים ב-Hub -> "Add System".

set -euo pipefail

if [[ "$(id -u)" -ne 0 ]]; then
  echo "❌ צריך root (sudo -E ./install-agent.sh)" >&2
  exit 1
fi

: "${KEY:?חסר KEY — העתק מ-Hub > Add System}"

# הסקריפט הרשמי של Beszel מתקין את ה-agent כ-systemd service ומגדיר הכל
curl -fsSL https://raw.githubusercontent.com/henrygd/beszel/main/supplemental/scripts/install-agent.sh \
  -o /tmp/beszel-install-agent.sh

sh /tmp/beszel-install-agent.sh \
  -k "$KEY" \
  ${TOKEN:+-t "$TOKEN"} \
  ${HUB_URL:+-url "$HUB_URL"} \
  -p 45876

rm -f /tmp/beszel-install-agent.sh

echo ""
echo "✅ Beszel agent הותקן ופועל (systemd)."
echo "   בדיקה:  sudo systemctl status beszel-agent"
