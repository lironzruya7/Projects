# Beszel — ניטור 3 שרתי Hostinger VPS (self-hosted, ידידותי לאייפון)

חלופה קלת-משקל ל-Netdata: דשבורד אחד עם **CPU, זיכרון, דיסק, רשת וטמפרטורה**
לכל 3 השרתים. הכל רץ אצלך (ללא שירות ענן), וה-UI רספונסיבי — אפשר להוסיף אותו
כ-**PWA למסך הבית של האייפון**.

## ארכיטקטורה
```
                 ┌─────────────────────────┐
   אייפון  ───►  │  Beszel HUB (שרת אחד)   │  ◄── דשבורד web על :8090
                 └───────────▲─────────────┘
             agent           │ agent          │ agent
        ┌────────────┐  ┌────────────┐  ┌────────────┐
        │  שרת 1     │  │  שרת 2     │  │  שרת 3     │
        └────────────┘  └────────────┘  └────────────┘
```
- **Hub** — רץ על שרת אחד, נותן את הדשבורד.
- **Agent** — רץ על כל שרת, אוסף metrics ושולח ל-Hub.

דרישה מוקדמת: Docker מותקן. אם אין:
```bash
curl -fsSL https://get.docker.com | sudo sh
```

---

## שלב 1 — הפעלת ה-Hub (על שרת אחד)

```bash
# מעתיקים את התיקייה הזו לשרת, ואז:
cd beszel
docker compose -f docker-compose.hub.yml up -d
```

פותחים בדפדפן: `http://<IP-של-השרת>:8090`
- יוצרים משתמש אדמין (פעם ראשונה).
- לוחצים **Add System** → נותנים שם (למשל `hostinger-1`) וה-IP → מקבלים
  **PUBLIC KEY** ו-**TOKEN**. שומרים אותם לשלב הבא.

> פתח את פורט 8090 ב-firewall אם צריך:  `sudo ufw allow 8090`

---

## שלב 2 — התקנת agent על כל אחד מ-3 השרתים

### אפשרות א' — Docker (מומלץ)
```bash
cd beszel
KEY='ssh-ed25519 AAAA...' TOKEN='<TOKEN>' HUB_URL='http://<IP-של-ה-Hub>:8090' \
  docker compose -f docker-compose.agent.yml up -d
```

### אפשרות ב' — בלי Docker (systemd)
```bash
KEY='ssh-ed25519 AAAA...' TOKEN='<TOKEN>' HUB_URL='http://<IP-של-ה-Hub>:8090' \
  sudo -E ./install-agent.sh
```

חוזרים על השלב לכל שרת. תוך כמה שניות כל שרת יעבור ל-**Up** בדשבורד.

> על השרת שמריץ גם את ה-Hub וגם agent — אפשר לחבר דרך ה-socket המשותף
> (`/beszel_socket`) במקום IP. פרטים: <https://beszel.dev>.

---

## שלב 3 — צפייה מהאייפון 📱

Beszel אין לו אפליקציה נייטיב, אבל ה-UI מצוין כ-PWA:
1. פותחים ב-**Safari**: `http://<IP-של-ה-Hub>:8090`
2. כפתור שיתוף → **Add to Home Screen**
3. נפתח כמו אפליקציה, עם כל 3 השרתים בעמוד אחד.

**התראות** — Beszel תומך בהתראות (אימייל / Pushover / Telegram / webhook)
דרך **Settings → Notifications** בדשבורד. ל-push לאייפון מומלץ Pushover או Telegram.

---

## פקודות שימושיות
```bash
docker compose -f docker-compose.hub.yml logs -f     # לוגים של ה-Hub
docker compose -f docker-compose.agent.yml logs -f   # לוגים של agent
sudo systemctl status beszel-agent                   # אם התקנת דרך systemd
```

## Netdata מול Beszel — מתי מה
| | **Netdata** | **Beszel** |
|---|---|---|
| metrics מלא באייפון | דרך PWA בלבד¹ | דרך PWA |
| אפליקציית iOS נייטיב | יש — אך **להתראות בלבד**¹ | אין (PWA) |
| פירוט ה-metrics | 🔥 עצום | בסיסי-נקי (CPU/RAM/דיסק/רשת) |
| צריכת משאבים | בינונית (~140MB) | זעומה (~30MB) |
| ענן חיצוני | Netdata Cloud | אין — הכל אצלך |
| קלות התקנה | פקודה אחת | Hub + agents |

¹ אפליקציית Netdata ל-iOS מציגה התראות וסטטוס בלבד, לא גרפים. את ה-metrics
המפורט רואים דרך דשבורד ה-web (`app.netdata.cloud`) כ-PWA. כלומר בשני הפתרונות
הצפייה המלאה מהאייפון היא דרך PWA בדפדפן.

שני הפתרונות מותקנים בריפו — אפשר להריץ את שניהם במקביל.
```
```
