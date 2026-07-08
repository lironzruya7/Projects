# ניטור 3 שרתי VPS של Hostinger מהאייפון — עם Netdata Cloud

מעקב אחרי **CPU, זיכרון (RAM), דיסק ורשת** של כל 3 השרתים בדשבורד אחד,
כולל אפליקציה נייטיב לאייפון והתראות push.

למה Netdata Cloud:
- **אפליקציית iOS אמיתית** (App Store: "Netdata").
- **Metrics הכי מפורט שיש** — רזולוציה של שנייה אחת, מאות מדדים.
- **דשבורד מאוחד** — כל 3 השרתים בעמוד אחד.
- **חינם** בשכבת הבסיס, מספיק בהחלט ל-3 שרתים.

---

## שלב 1 — יצירת חשבון Netdata Cloud

1. נכנסים ל-<https://app.netdata.cloud> ונרשמים (אפשר עם Google / אימייל).
2. נוצר אוטומטית **Space** ובתוכו **Room** בשם `All nodes`.
3. לוחצים על **Connect Nodes** (או Nodes → Add Nodes).
4. בוחרים **Linux** — יופיע פקודת `kickstart` שמכילה שני ערכים חשובים:
   - `--claim-token <TOKEN>`  ← זה ה-`CLAIM_TOKEN`
   - `--claim-rooms <ROOM>`   ← זה ה-`CLAIM_ROOM`

מעתיקים את שני הערכים האלה — משתמשים בהם בשלב הבא.

---

## שלב 2 — התקנה על כל אחד מ-3 השרתים

מתחברים ב-SSH לכל שרת (הפרטים נמצאים ב-hPanel → VPS → SSH Access):

```bash
ssh root@<IP-של-השרת>
```

מעלים את הסקריפט (או clone לריפו הזה) ומריצים — **פעם אחת לכל שרת**,
עם שם ידידותי שונה לכל אחד:

```bash
# שרת 1
HOSTNAME_LABEL="hostinger-1" \
CLAIM_TOKEN="<TOKEN>" \
CLAIM_ROOM="<ROOM>" \
sudo ./install-netdata.sh

# שרת 2  ->  HOSTNAME_LABEL="hostinger-2"
# שרת 3  ->  HOSTNAME_LABEL="hostinger-3"
```

ה-`CLAIM_TOKEN` וה-`CLAIM_ROOM` **זהים** לכל 3 השרתים — רק ה-`HOSTNAME_LABEL` משתנה.

התקנה חד-שורתית בלי להעלות קובץ:

```bash
HOSTNAME_LABEL="hostinger-1" CLAIM_TOKEN="<TOKEN>" CLAIM_ROOM="<ROOM>" \
  bash -c 'curl -fsSL https://raw.githubusercontent.com/lironzruya7/projects/claude/hostinger-vps-monitoring-mobile-s52aiv/hostinger-vps-monitoring/install-netdata.sh | sudo -E bash'
```

אחרי דקה כל שרת יופיע ב-Netdata Cloud כ-**Online**.

---

## שלב 3 — צפייה מהאייפון 📱

1. מורידים מה-App Store את האפליקציה **Netdata**.
2. מתחברים עם **אותו חשבון** מהשלב הראשון.
3. בוחרים את ה-Space/Room — כל 3 השרתים מופיעים יחד.
4. נכנסים לכל שרת כדי לראות:
   - **CPU** — לפי ליבה, user/system/iowait
   - **Memory** — used / cached / available / swap
   - **Disks** — מקום פנוי, IOPS, latency
   - **Network, מערכת, תהליכים** ועוד

טיפ: אפשר גם פשוט לפתוח את <https://app.netdata.cloud> ב-Safari
ולהוסיף **"Add to Home Screen"** אם מעדיפים לא להתקין אפליקציה.

---

## שלב 4 — התראות push לאייפון (מומלץ)

1. באפליקציה: **Profile → Notifications** → מפעילים Push.
2. (רשות) התראות מותאמות ל-CPU/RAM/דיסק — מעתיקים לכל שרת:

   ```bash
   sudo cp alerts/health.d-custom.conf /etc/netdata/health.d/custom.conf
   sudo netdatacli reload-health
   ```

   ראה `alerts/health.d-custom.conf` לספים (85% warning / 95% critical).

---

## פקודות שימושיות בשרת

```bash
sudo systemctl status netdata     # סטטוס השירות
sudo systemctl restart netdata    # אתחול
sudo netdatacli reload-health     # טעינת התראות מחדש
# דשבורד מקומי (בלי Cloud):  http://<IP>:19999
```

> אבטחה: הפורט המקומי `19999` פתוח כברירת מחדל. אם לא צריך גישה ישירה,
> מומלץ לחסום אותו ב-firewall ולהשתמש רק ב-Netdata Cloud:
> `sudo ufw deny 19999`

---

## מבנה הריפו

```
hostinger-vps-monitoring/
├── README.md                     # המדריך הזה
├── install-netdata.sh            # התקנה + חיבור ל-Cloud (מריצים על כל שרת)
└── alerts/
    └── health.d-custom.conf      # התראות CPU/RAM/דיסק מותאמות
```
