#!/usr/bin/env bash
#
# install-netdata.sh
# ------------------
# מתקין את ה-Netdata agent על שרת VPS של Hostinger ומחבר אותו ל-Netdata Cloud
# כדי שכל 3 השרתים יופיעו בדשבורד אחד + באפליקציה לאייפון.
#
# איך להשתמש (מריצים על כל אחד מ-3 השרתים בנפרד, כ-root):
#
#   CLAIM_TOKEN=xxxxx CLAIM_ROOM=yyyyy ./install-netdata.sh
#
# את ה-CLAIM_TOKEN וה-CLAIM_ROOM משיגים מ-Netdata Cloud:
#   Space -> Connect Nodes -> מעתיקים את הערכים מפקודת ה-kickstart שמוצגת.
#
# אפשר גם להעביר שם ידידותי לשרת (יופיע בדשבורד):
#   HOSTNAME_LABEL="hostinger-web-1" CLAIM_TOKEN=... CLAIM_ROOM=... ./install-netdata.sh

set -euo pipefail

CLAIM_URL="${CLAIM_URL:-https://app.netdata.cloud}"
CLAIM_TOKEN="${CLAIM_TOKEN:-}"
CLAIM_ROOM="${CLAIM_ROOM:-}"
HOSTNAME_LABEL="${HOSTNAME_LABEL:-}"

if [[ "$(id -u)" -ne 0 ]]; then
  echo "❌ צריך להריץ כ-root (נסה: sudo ./install-netdata.sh)" >&2
  exit 1
fi

if [[ -z "$CLAIM_TOKEN" || -z "$CLAIM_ROOM" ]]; then
  echo "❌ חסרים CLAIM_TOKEN / CLAIM_ROOM." >&2
  echo "   דוגמה: CLAIM_TOKEN=xxx CLAIM_ROOM=yyy ./install-netdata.sh" >&2
  exit 1
fi

# שם ידידותי לשרת (רשות) — מקל להבחין בין 3 השרתים בדשבורד
if [[ -n "$HOSTNAME_LABEL" ]]; then
  echo "➡️  מגדיר hostname: $HOSTNAME_LABEL"
  hostnamectl set-hostname "$HOSTNAME_LABEL" || true
fi

echo "➡️  מוריד ומתקין Netdata + מחבר ל-Netdata Cloud..."
TMP_SCRIPT="$(mktemp /tmp/netdata-kickstart.XXXXXX.sh)"
if command -v curl >/dev/null 2>&1; then
  curl -fsSL https://get.netdata.cloud/kickstart.sh -o "$TMP_SCRIPT"
else
  wget -qO "$TMP_SCRIPT" https://get.netdata.cloud/kickstart.sh
fi

sh "$TMP_SCRIPT" \
  --nightly-channel \
  --claim-token "$CLAIM_TOKEN" \
  --claim-rooms "$CLAIM_ROOM" \
  --claim-url "$CLAIM_URL"

rm -f "$TMP_SCRIPT"

echo ""
echo "✅ הותקן בהצלחה."
echo "   • דשבורד מקומי:  http://$(hostname -I | awk '{print $1}'):19999"
echo "   • דשבורד מאוחד:  https://app.netdata.cloud  (כל 3 השרתים ביחד)"
echo "   • אייפון:        אפליקציית 'Netdata' מה-App Store, מתחברים לאותו חשבון."
