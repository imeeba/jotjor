# Jotjor (จดจ่อ)

ระบบบันทึกรายจ่ายส่วนตัวจากแจ้งเตือนธนาคาร (ตอนนี้รองรับ K PLUS) ข้อมูลอยู่ใน Google Sheet ของคุณเอง ไม่มีเซิร์ฟเวอร์กลาง

```
แจ้งเตือน K PLUS → MacroDroid → Google Apps Script → Google Sheet
                                         ↑
                       หน้าเว็บนี้ (GitHub Pages) เรียกผ่าน JSON
```

## ในคลังนี้

| ไฟล์ | หน้าที่ |
|---|---|
| `index.html`, `assets/` | หน้าเว็บ (ไฟล์ static ล้วน) |
| `assets/strings.js` | ข้อความทั้งหมดของหน้าเว็บ (key → ไทย) เพิ่มภาษาอื่นภายหลังได้ |
| `apps-script/Code.gs` | โค้ดฝั่ง Apps Script (วางในโปรเจกต์ของคุณเอง) |

คลังนี้ไม่มี URL, key หรือข้อมูลจริงของใคร หน้าเว็บถามลิงก์ Web app และ `APP_KEY` ครั้งแรก แล้วเก็บใน `localStorage` ของเครื่องนั้นเท่านั้น

## ติดตั้งหน้าเว็บ (GitHub Pages)

1. Fork หรือใช้คลังนี้ แล้วไปที่ Settings → Pages
2. Source = Deploy from a branch, Branch = `main`, Folder = `/ (root)` แล้วกด Save
3. รอสักครู่ จะได้ลิงก์ `https://<ชื่อผู้ใช้>.github.io/<ชื่อคลัง>/`

## ตั้งค่า Apps Script

1. วาง `apps-script/Code.gs` ในโปรเจกต์ Apps Script ที่ผูกกับชีต แล้วรัน `setup` ครั้งหนึ่ง
2. Project Settings → Script properties เพิ่ม `APP_KEY` เป็นรหัสยาวที่เดายาก (อย่าใส่ในคลัง)
3. Deploy → Manage deployments → ✏️ → New version (ใช้ Web app, Execute as: Me, Who has access: Anyone) ทุกครั้งที่แก้โค้ด
4. เปิดหน้าเว็บ ใส่ลิงก์ Web app (ลงท้าย `/exec`) และ `APP_KEY`

ความปลอดภัย: ใครมีลิงก์ Web app และ `APP_KEY` เขียนข้อมูลได้ ใช้ key ยาวและห้ามแชร์ หน้าเว็บส่ง key ไปที่ `script.google.com` เท่านั้น

## ขอบเขต

เปิดโค้ด เอกสาร และข้อความตัวอย่างที่สร้างเอง ไม่รวมค่า Script properties ข้อมูลชีตจริง หรือข้อความแจ้งเตือนจริง ไม่รับปากซัพพอร์ต รองรับ K PLUS ก่อน ใบอนุญาต MIT

---

## English summary

Jotjor is a personal expense tracker that turns Thai bank app notifications (K PLUS first) into rows in your own Google Sheet. An Android automation app (MacroDroid) posts each notification to a Google Apps Script web app, which parses it into the sheet. This repo holds the static web dashboard (hosted on GitHub Pages) and the Apps Script code.

- No URL or key lives in this repo. On first open the page asks for your Apps Script web app URL (`.../exec`) and your `APP_KEY`, and stores them in the browser's `localStorage`.
- The page talks to Apps Script with `fetch` (POST, `text/plain`, JSON body), so no CORS preflight is needed.
- The UI is Thai only; all strings are in `assets/strings.js` so another language can be added later.
- Setup: enable Pages on `main` / root, paste `apps-script/Code.gs` into your Apps Script project, add an `APP_KEY` script property, create a new deployment version.
- MIT licensed. No support is promised.
