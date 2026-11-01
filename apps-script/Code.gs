/**
 * KBank Spend Tracker v3.2 — Google Apps Script
 * แจ้งเตือน K PLUS / SMS KBank (ผ่าน MacroDroid) → Google Sheet → หน้า Dashboard บนมือถือ
 *
 * Dashboard:  หน้าเว็บแยกบน GitHub Pages เรียก JSON API ของไฟล์นี้ (POST /exec, ใช้ APP_KEY)
 *   - ยอดบัตรเครดิต / โอน-สแกนจ่าย / รวม ตามรอบบิล
 *   - Checkpoint ทุก CHECKPOINT_STEP บาท แยกเครดิต/โอน
 *   - แยกตามแท็ก และเลือกแท็กรายการได้ในหน้า Dashboard
 *   - จัดการแท็ก (เพิ่ม / เปลี่ยนชื่อ / ลบ ทั้งแท็กหลักและแท็กรอง) จากหน้า Dashboard
 *
 * แท็กทั้งหมดอยู่ที่ชีต Tags ที่เดียว: แถวที่ sub ว่าง = แท็กหลัก, แถวที่มี sub = แท็กรอง
 *
 * Script Properties (Project Settings > Script properties):
 *   SECRET           รหัสลับใน URL ของ MacroDroid (?secret=...)        [สร้างให้เองตอนรัน setup]
 *   APP_KEY          รหัสสำหรับบันทึกเงินสดและยืนยัน/ปฏิเสธเงินคืนและเข้าหน้าเว็บทั้งหมด (JSON API)  [ตั้งเองใน Script properties]
 *   CYCLE_DAY, SELF_ACCOUNTS  (เลิกใช้หลังรัน migrateAccounts) ย้ายไปอยู่ชีต Accounts แล้ว ใช้เป็น fallback ตอนชีตยังว่างเท่านั้น
 *   SELF_PAIR_SEC    โอนออก+เงินเข้าบัญชีตัวเองยอดเท่ากันภายในกี่วินาทีถึงนับว่าเป็นคู่   [ค่าเริ่มต้น 600]
 *   CHECKPOINT_STEP  ระยะห่างของ checkpoint (บาท)                      [ค่าเริ่มต้น 10000]
 *   CHECKPOINT_ALERT true = แจ้งเตือนเมื่อผ่าน checkpoint              [ค่าเริ่มต้น true]
 *   NOTIFY_EMAIL     false = ไม่ส่งอีเมลแจ้งเตือน                       [ค่าเริ่มต้น true]
 *   TAGS             (เลิกใช้หลังรัน migrateTags) ใช้เป็นค่าตั้งต้นตอนย้ายแท็กหลักเข้าชีต Tags ครั้งเดียว
 *   DEDUPE_SEC       ตัดรายการซ้ำภายในกี่วินาที                          [ค่าเริ่มต้น 120]
 *   OTP_AS           SMS OTP จ่ายออนไลน์ให้นับเป็น credit หรือ deposit   [ค่าเริ่มต้น credit]
 *
 * ชีต:  Settings = ค่าตั้งใช้ร่วมทุกเครื่อง (key, value เช่น ขีด checkpoint ต่อการ์ด สร้างให้เองครั้งแรกที่บันทึก) | Raw = ข้อความดิบ | Tx = รายการที่แยกแล้ว (คอลัมน์ tag เป็น dropdown) | Rules = คำค้น → แท็ก | Tags = แท็กหลัก/รอง | Accounts = บัญชี/บัตร (ชื่อ, เลขท้าย, ชนิด, วันตัดรอบ, บัญชีตัวเอง) | Matches = ผลยืนยัน/ปฏิเสธเงินคืนเข้าบัญชี (สร้างให้เองครั้งแรกที่กด)
 */

const TZ = 'Asia/Bangkok';
const PROPS = PropertiesService.getScriptProperties();
const TX_HEADERS = ['datetime', 'date', 'type', 'direction', 'amount', 'merchant', 'ref', 'app', 'raw', 'tag'];
const COL = { dt: 0, date: 1, type: 2, dir: 3, amount: 4, merchant: 5, ref: 6, app: 7, raw: 8, tag: 9 };
const UNTAGGED = 'ยังไม่แท็ก';
const SKIP_TAG = 'ข้าม';

function cfg_(key, def) {
  const v = PROPS.getProperty(key);
  return v === null || v === '' ? def : v;
}

/* ---------- แท็ก: อ่านจากชีต Tags ---------- */

let TAG_CACHE_ = null;   // แคชในการรันครั้งเดียว (ล้างทุกครั้งที่เขียนชีต Tags)

function clearTagCache_() { TAG_CACHE_ = null; }

/** ค่าตั้งต้นเดิม (Script property TAGS หรือค่า default) ใช้ตอนย้ายข้อมูล และเป็น fallback ถ้าชีต Tags ยังไม่มีแท็กหลัก */
function legacyTags_() {
  return cfg_('TAGS', 'อาหาร,เดินทาง,ช้อปปิ้ง,บิล,บันเทิง,อื่นๆ').split(',').map(s => s.trim()).filter(Boolean);
}

/** อ่านชีต Tags: mains = แถวที่ sub ว่าง (ตามลำดับแถว), subs = { main: [sub...] }, subRows = แถวแท็กรองตามลำดับแถว */
function tagTree_() {
  if (TAG_CACHE_) return TAG_CACHE_;
  const tree = { mains: [], subs: {}, subRows: [] };
  const sh = SpreadsheetApp.getActive().getSheetByName('Tags');
  if (sh && sh.getLastRow() > 1) {
    sh.getRange(2, 1, sh.getLastRow() - 1, 2).getValues().forEach(r => {
      const m = String(r[0]).trim(), s = String(r[1]).trim();
      if (!m) return;
      if (!s) {
        if (tree.mains.indexOf(m) < 0) tree.mains.push(m);
      } else {
        const arr = tree.subs[m] || (tree.subs[m] = []);
        if (arr.indexOf(s) < 0) { arr.push(s); tree.subRows.push({ main: m, sub: s }); }
      }
    });
  }
  TAG_CACHE_ = tree;
  return tree;
}

function tags_() {
  const m = tagTree_().mains;
  return m.length ? m.slice() : legacyTags_();
}

function copySubs_(subs) {
  const o = {};
  Object.keys(subs).forEach(k => { o[k] = subs[k].slice(); });
  return o;
}

/** เขียนชีต Tags ใหม่ทั้งหมด: แท็กหลักแต่ละตัวตามด้วยแท็กรองของมัน (ลำดับแถว = ลำดับที่แสดง) */
function writeTagTree_(mains, subs) {
  const ss = SpreadsheetApp.getActive();
  const sh = ensureSheet_(ss, 'Tags', ['main', 'sub']);
  const rows = [];
  const done = {};
  mains.forEach(m => {
    rows.push([m, '']);
    (subs[m] || []).forEach(s => rows.push([m, s]));
    done[m] = true;
  });
  Object.keys(subs).forEach(m => { if (!done[m]) subs[m].forEach(s => rows.push([m, s])); });   // กันแท็กรองหาย
  const last = sh.getLastRow();
  if (last > 1) sh.getRange(2, 1, last - 1, 2).clearContent();
  if (rows.length) {
    const rng = sh.getRange(2, 1, rows.length, 2);
    rng.setNumberFormat('@');
    rng.setValues(rows);
  }
  clearTagCache_();
}

/** ย้ายแท็กหลักเข้าชีต Tags (ไม่ล็อก) รันซ้ำได้ ไม่ซ้ำข้อมูล */
function migrateTags_() {
  const ss = SpreadsheetApp.getActive();
  clearTagCache_();
  const tree = tagTree_();
  // แท็กที่มีอยู่แล้วในชีต Tags ขึ้นก่อน แล้วเติมค่า default/TAGS ที่ยังไม่มี (แก้บั๊กที่ข้าม default เมื่อชีตมีแท็กหลักอยู่แล้ว)
  const mains = tree.mains.slice();
  legacyTags_().forEach(m => { if (mains.indexOf(m) < 0) mains.push(m); });
  const subs = copySubs_(tree.subs);
  let added = 0;
  const addMain = v => {
    const name = String(v == null ? '' : v).trim();
    if (!name || name === SKIP_TAG || name === UNTAGGED) return;
    if (mains.indexOf(name) < 0) { mains.push(name); added++; }
  };
  Object.keys(subs).forEach(addMain);
  [['Tx', COL.tag + 1], ['Rules', 2]].forEach(p => {
    const sh = ss.getSheetByName(p[0]);
    if (!sh || sh.getLastRow() < 2) return;
    sh.getRange(2, p[1], sh.getLastRow() - 1, 1).getValues().forEach(r => {
      const t = String(r[0] == null ? '' : r[0]).trim();
      if (t) addMain(splitTag_(t).main);
    });
  });
  writeTagTree_(mains, subs);
  return { mains: mains.length, added: added };
}

/** รันเองใน editor ครั้งเดียว: ย้ายแท็กหลักทั้งหมดเข้าชีต Tags (รันซ้ำได้) */
function migrateTags() {
  const r = withLock_(() => {
    const res = migrateTags_();
    applyTagValidation_(SpreadsheetApp.getActive());
    return res;
  });
  console.log('migrateTags: แท็กหลัก ' + r.mains + ' ตัว (เพิ่มใหม่ ' + r.added + ')');
  return r;
}

function ensureMigrated_() {
  if (!tagTree_().mains.length) migrateTags_();
}

/* ---------- บัญชี/บัตร: อ่านจากชีต Accounts ---------- */
// คอลัมน์: name (ชื่อที่ตั้ง ว่างได้), last4, kind (credit/bank/cash), cycle_day (ค่าเดิม ใช้เป็นค่าเริ่มต้นของวันตัดรอบแอปเท่านั้น), self (TRUE เสมอ)
// ถ้าชีตยังไม่มี/ว่าง ใช้ Script properties เดิม (CYCLE_DAY, SELF_ACCOUNTS) แทนจนกว่าจะรัน migrateAccounts

const ACC_HEADERS = ['name', 'last4', 'kind', 'cycle_day', 'self'];
const DEFAULT_CYCLE_DAY = 25;

let ACC_CACHE_ = null;

function clearAccCache_() { ACC_CACHE_ = null; }

/** คืน [{ name, last4, kind, cycleDay, self }] ตามลำดับแถว ([] ถ้าไม่มีชีตหรือไม่มีข้อมูล) */
function accounts_() {
  if (ACC_CACHE_) return ACC_CACHE_;
  const sh = SpreadsheetApp.getActive().getSheetByName('Accounts');
  const list = [];
  if (sh && sh.getLastRow() > 1) {
    sh.getRange(2, 1, sh.getLastRow() - 1, ACC_HEADERS.length).getValues().forEach((r, i) => {
      const name = String(r[0]).trim(), last4 = String(r[1]).trim();
      if (!name && !last4) return;
      const kind = String(r[2]).trim().toLowerCase();
      const cd = Number(r[3]);
      list.push({
        row: i + 2,
        name: name,
        last4: last4,
        kind: kind === 'bank' || kind === 'cash' ? kind : 'credit',
        cycleDay: cd >= 1 && cd <= 31 ? Math.floor(cd) : DEFAULT_CYCLE_DAY,
        hasDay: cd >= 1 && cd <= 31,
        self: r[4] === true || String(r[4]).trim().toLowerCase() === 'true'
      });
    });
  }
  ACC_CACHE_ = list;
  return list;
}

/** วันตัดรอบของทั้งแอป (มีค่าเดียว ไม่มีรอบรายบัตร): ค่า cycle_day ในชีต Settings
 *  ยังไม่ตั้ง = ใช้วันตัดรอบเดิมของบัตรใบแรกในชีต Accounts ถ้ามี ไม่งั้น CYCLE_DAY เดิม */
function cycleDay_() {
  const v = Number(settings_().cycle_day);
  if (v >= 1 && v <= 31) return Math.floor(v);
  const card = accounts_().filter(a => a.kind === 'credit' && a.hasDay)[0];
  return card ? card.cycleDay : (Number(cfg_('CYCLE_DAY', String(DEFAULT_CYCLE_DAY))) || DEFAULT_CYCLE_DAY);
}

/** สร้างชีต Accounts และย้ายค่า CYCLE_DAY / SELF_ACCOUNTS เดิมเข้าไปครั้งเดียว (ไม่ทำซ้ำถ้ามีข้อมูลแล้ว) */
function migrateAccounts_() {
  const ss = SpreadsheetApp.getActive();
  const sh = ensureSheet_(ss, 'Accounts', ACC_HEADERS);
  clearAccCache_();
  if (sh.getLastRow() > 1) return { added: 0, skipped: true };
  const rows = [['บัตรเครดิต', '', 'credit', Number(cfg_('CYCLE_DAY', String(DEFAULT_CYCLE_DAY))) || DEFAULT_CYCLE_DAY, false]];
  const seen = {};
  cfg_('SELF_ACCOUNTS', '').split(/[,\s]+/).forEach((a, i) => {
    const dg = a.replace(/\D/g, '');
    const last4 = dg.length === 10 ? dg.slice(5, 9) : (dg.length >= 4 ? dg.slice(-4) : '');
    if (!last4 || seen[last4]) return;
    seen[last4] = true;
    rows.push(['บัญชี ' + (rows.length), last4, 'bank', '', true]);
  });
  const rng = sh.getRange(2, 1, rows.length, ACC_HEADERS.length);
  sh.getRange(2, 2, rows.length, 1).setNumberFormat('@');
  rng.setValues(rows);
  sh.getRange(2, 5, 200, 1).insertCheckboxes();
  sh.getRange(2, 3, 200, 1).setDataValidation(
    SpreadsheetApp.newDataValidation().requireValueInList(['credit', 'bank', 'cash'], true).setAllowInvalid(false).build());
  clearAccCache_();
  return { added: rows.length, skipped: false };
}

/** รันเองใน editor ครั้งเดียว: สร้างชีต Accounts + ย้ายค่าเดิม (รันซ้ำได้ ไม่เขียนทับ) */
function migrateAccounts() {
  const r = withLock_(migrateAccounts_);
  console.log('migrateAccounts: ' + (r.skipped ? 'มีข้อมูลในชีต Accounts แล้ว ไม่ทำซ้ำ' : 'เพิ่ม ' + r.added + ' แถว'));
  return r;
}

function withLock_(fn) {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try { return fn(); } finally { bumpDash_(); lock.releaseLock(); }
}

/* ---------- Setup ---------- */

function setup() {
  const ss = SpreadsheetApp.getActive();
  ensureSheet_(ss, 'Raw', ['received_at', 'app', 'text']);
  const tx = ensureSheet_(ss, 'Tx', TX_HEADERS);
  if (tx.getRange(1, COL.tag + 1).getValue() !== 'tag') tx.getRange(1, COL.tag + 1).setValue('tag');

  ensureSheet_(ss, 'Rules', ['keyword', 'tag']);
  ensureSheet_(ss, 'Tags', ['main', 'sub']);   // แท็กหลักตั้งต้นเติมให้ใน migrateTags_ จาก legacyTags_
  clearTagCache_();
  migrateTags_();
  applyTagValidation_(ss);
  migrateAccounts_();

  ScriptApp.getProjectTriggers().filter(t => t.getHandlerFunction() === 'dailySummary').forEach(t => ScriptApp.deleteTrigger(t));  // trigger เก่าของ LINE
  resetTrigger_('checkCheckpoints', b => b.timeBased().everyMinutes(5));

  if (!cfg_('SECRET', '')) PROPS.setProperty('SECRET', Utilities.getUuid().replace(/-/g, ''));
  if (!cfg_('WIDGET_KEY', '')) PROPS.setProperty('WIDGET_KEY', Utilities.getUuid().replace(/-/g, ''));
  if (!cfg_('APP_KEY', '')) PROPS.setProperty('APP_KEY', Utilities.getUuid().replace(/-/g, ''));
  console.log('SECRET = ' + cfg_('SECRET', ''));
  console.log('WIDGET_KEY = ' + cfg_('WIDGET_KEY', ''));
  try {
    console.log('WIDGET = ' + ScriptApp.getService().getUrl() + '?widget=' + cfg_('WIDGET_KEY', ''));
  } catch (err) { /* ยังไม่ได้ Deploy */ }
}

/* ---------- เมนู Jotjor ในชีต (สำหรับผู้ใช้ทั่วไป ไม่ต้องเปิด editor) ---------- */

const VERSION = '1.0.0';

function onOpen() {
  SpreadsheetApp.getUi().createMenu('Jotjor')
    .addItem('1. ตั้งค่าครั้งแรก', 'firstRun')
    .addItem('2. ทดสอบการรับข้อความ', 'sendTest')
    .addItem('ดูลิงก์และรหัสของฉัน', 'showLinks')
    .addItem('ตรวจสถานะ', 'showStatus')
    .addToUi();
}

/** URL ของ Web app ที่ Deploy แล้ว (ลงท้าย /exec) ไม่งั้นคืน '' */
function execUrl_() {
  try {
    const u = ScriptApp.getService().getUrl() || '';
    return /\/exec$/.test(u) ? u : '';
  } catch (err) { return ''; }
}

function copyBox_(label, value) {
  const id = 'f' + Math.random().toString(36).slice(2, 8);
  const v = String(value).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
  return '<p style="margin:14px 0 4px;font-weight:600">' + label + '</p>' +
    '<input id="' + id + '" readonly value="' + v + '" style="width:100%;box-sizing:border-box;padding:8px;font:13px monospace" onclick="this.select()">' +
    '<button style="margin-top:4px" onclick="var e=document.getElementById(\'' + id + '\');e.select();document.execCommand(\'copy\');this.textContent=\'คัดลอกแล้ว\'">คัดลอก</button>';
}

/** แสดงลิงก์/รหัสของผู้ใช้เอง (อยู่ในชีตของเขาเอง ไม่ผ่านใคร) */
function showLinks() {
  const url = execUrl_();
  let html = '<div style="font:14px sans-serif;padding:4px 8px">';
  if (!cfg_('SECRET', '') || !cfg_('APP_KEY', '')) {
    html += '<p>ยังไม่ได้ตั้งค่าครั้งแรก กดเมนู Jotjor &gt; 1. ตั้งค่าครั้งแรก ก่อน</p></div>';
  } else if (!url) {
    html += '<p>ยังไม่ได้ Deploy เป็น Web app (หรือลิงก์ไม่ลงท้าย /exec) ทำตามขั้น Deploy ใน guide แล้วเปิดเมนูนี้อีกครั้ง</p></div>';
  } else {
    html += '<p style="color:#b00">ห้ามแชร์ลิงก์และรหัสเหล่านี้ให้ใคร</p>' +
      copyBox_('ลิงก์สำหรับ MacroDroid', url + '?secret=' + cfg_('SECRET', '') + '&app=kplus') +
      copyBox_('ลิงก์ Web app (วางในหน้าเว็บ Jotjor)', url) +
      copyBox_('APP_KEY (วางในหน้าเว็บ Jotjor)', cfg_('APP_KEY', '')) + '</div>';
  }
  SpreadsheetApp.getUi().showModalDialog(HtmlService.createHtmlOutput(html).setWidth(520).setHeight(420), 'ลิงก์และรหัสของฉัน');
}

/** ขั้นตอนตั้งค่าครั้งแรก: สร้างชีต/รหัส แล้วแสดงลิงก์ (รันซ้ำได้ ไม่เปลี่ยนรหัสเดิม) */
function firstRun() {
  setup();
  showLinks();
}

/** ส่งข้อความตัวอย่างเข้าท่อเดียวกับ MacroDroid เพื่อเช็กว่าชีตรับ-แยก-บันทึกได้ (รายการทดสอบถูกติดแท็ก ข้าม ไม่นับยอด) */
function sendTest() {
  const ui = SpreadsheetApp.getUi();
  if (!cfg_('SECRET', '')) { ui.alert('ยังไม่ได้ตั้งค่าครั้งแรก กดเมนู Jotjor > 1. ตั้งค่าครั้งแรก ก่อน'); return; }
  const text = 'รายการใช้บัตร หมายเลขบัตร xxxx-xxxx-xxxx-0000 จำนวนเงิน 1.00 บาท ที่ JOTJOR TEST';
  const res = JSON.parse(doPost({ parameter: { secret: cfg_('SECRET', ''), app: 'test' }, postData: { contents: text } }).getContent());
  if (res.duplicate) { ui.alert('เพิ่งทดสอบไปเมื่อสักครู่ รอ 2 นาทีแล้วกดใหม่'); return; }
  if (!res.ok || !res.parsed) { ui.alert('ชีตรับข้อความได้แต่แยกไม่ได้ ดูแท็บ Raw แล้วแจ้งผ่าน GitHub Issues'); return; }
  SpreadsheetApp.getActive().getSheetByName('Tx').getRange(res.row, COL.tag + 1).setValue(SKIP_TAG);
  ui.alert('ผ่าน: มีรายการทดสอบ 1 บาทที่แท็บ Tx (ติดแท็ก ข้าม ลบทิ้งได้)');
}

/** สรุปสถานะ: เวอร์ชัน, Deploy แล้วหรือยัง, ข้อความล่าสุดที่ได้รับจากมือถือ */
function showStatus() {
  const ss = SpreadsheetApp.getActive();
  const raw = ss.getSheetByName('Raw');
  let last = 'ยังไม่เคยได้รับ';
  if (raw && raw.getLastRow() > 1) {
    const r = raw.getRange(raw.getLastRow(), 1, 1, 2).getValues()[0];
    last = fmt_(r[0], 'd/M/yyyy HH:mm') + ' (' + (r[1] || '-') + ')';
  }
  SpreadsheetApp.getUi().alert('Jotjor เวอร์ชัน ' + VERSION +
    '\nตั้งค่าครั้งแรก: ' + (cfg_('SECRET', '') && cfg_('APP_KEY', '') ? 'แล้ว' : 'ยังไม่ได้ทำ') +
    '\nDeploy Web app: ' + (execUrl_() ? 'แล้ว' : 'ยังไม่ได้ทำ') +
    '\nข้อความล่าสุดที่ได้รับ: ' + last);
}

function resetTrigger_(handler, build) {
  ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === handler)
    .forEach(t => ScriptApp.deleteTrigger(t));
  build(ScriptApp.newTrigger(handler)).create();
}

function ensureSheet_(ss, name, headers) {
  let sh = ss.getSheetByName(name);
  if (!sh) sh = ss.insertSheet(name);
  if (sh.getLastRow() === 0) {
    sh.appendRow(headers);
    sh.setFrozenRows(1);
  }
  return sh;
}

function applyTagValidation_(ss) {
  const rule = SpreadsheetApp.newDataValidation()
    .requireValueInList(validTags_(ss), true)
    .setAllowInvalid(false)
    .build();
  ss.getSheetByName('Tx').getRange(2, COL.tag + 1, 5000, 1).setDataValidation(rule);
}

/* ---------- Webhook (MacroDroid) ---------- */

function doPost(e) {
  const q = (e && e.parameter) || {};
  const apiReq = apiRequest_(e);
  if (apiReq) return api_(apiReq);
  if (!q.secret || q.secret !== cfg_('SECRET', '')) return out_({ ok: false, error: 'unauthorized' });

  let text = (e.postData && e.postData.contents) || q.text || '';
  let app = q.app || '';
  let body = null;
  try { body = JSON.parse(text); } catch (err) { /* text/plain จาก MacroDroid */ }

  if (body && typeof body === 'object') { text = body.text || ''; app = body.app || app; }

  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const ss = SpreadsheetApp.getActive();
    const now = new Date();
    text = redactOtp_(text);
    ss.getSheetByName('Raw').appendRow([now, app, text]);

    const tx = parse_(text, now);
    if (!tx) return out_({ ok: true, parsed: false });
    const when = tx.when || now;                      // ใช้เวลาในข้อความ ถ้ามี
    if (isDuplicate_(ss, tx, when)) return out_({ ok: true, duplicate: true });

    tx.tag = autoTag_(ss, tx.merchant + ' ' + text);
    const row = appendTx_(ss, when, tx, app, text);
    markSelfTransfers_(ss, 40);

    return out_({ ok: true, parsed: true, row: row, type: tx.type, direction: tx.direction, amount: tx.amount });
  } finally {
    bumpDash_();
    lock.releaseLock();
  }
}

function doGet(e) {
  const p = (e && e.parameter) || {};
  if (p.view !== undefined) {                        // หน้า Dashboard ย้ายไป GitHub Pages แล้ว
    return HtmlService.createHtmlOutput('<meta name="viewport" content="width=device-width"><p style="font:16px sans-serif;padding:24px">หน้า Dashboard ย้ายไปที่ GitHub Pages แล้ว</p>');
  }
  if (p.widget !== undefined) {                      // JSON อ่านอย่างเดียว สำหรับ KWGT (ใช้ WIDGET_KEY แยกจาก APP_KEY)
    const wk = cfg_('WIDGET_KEY', '');
    if (!wk || p.widget !== wk) return out_({ ok: false, error: 'unauthorized' });
    try {
      return out_(widgetData_());
    } catch (err) {
      console.error(err);
      return out_({ ok: false, error: 'server error' });
    }
  }
  return out_({ ok: true, msg: 'KBank Spend Tracker is running' });
}

function out_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function appendTx_(ss, dt, tx, app, raw) {
  const sh = ss.getSheetByName('Tx');
  const row = sh.getLastRow() + 1;
  sh.getRange(row, COL.ref + 1).setNumberFormat('@');   // เก็บเลขอ้างอิงเป็นข้อความ ไม่ให้ 0030 กลายเป็น 30
  sh.getRange(row, 1, 1, 10).setValues([[dt, fmt_(dt, 'yyyy-MM-dd'), tx.type, tx.direction, tx.amount, tx.merchant, String(tx.ref || ''), app, raw, tx.tag || '']]);
  return row;
}

/* ---------- Parser ---------- */
// รูปแบบข้อความของ K PLUS อาจเปลี่ยนได้ ให้ดูข้อความจริงในชีต Raw แล้วปรับ regex ตรงนี้

const RE_SKIP = /OTP|รหัสผ่าน|รหัสยืนยัน|verification|โปรโมชั่น|สิทธิพิเศษ|เชิญชวน|คะแนน|point/i;
const RE_SCHEDULED = /โอนเงินล่วงหน้า/;
const RE_BALANCE_BEFORE = /(คงเหลือ|ยอดคงเหลือ|เหลือ|balance|avail|วงเงิน(?:คงเหลือ)?|ใช้ได้)\s*[:：]?\s*(?:บาท|THB|฿)?\s*$/i;
const RE_IN = /เงินเข้า|รับโอน|รับเงิน|ฝากเงิน|เข้าบัญชี|received|incoming|deposit|refund|คืนเงิน|ยกเลิกรายการ|reversal/i;
const RE_OUT = /เงินออก|ถอน|โอน|จ่าย|ชำระ|ใช้จ่าย|ใช้บัตร|หัก|ซื้อ|รูด|paid|payment|purchase|spend|spent|withdraw|transfer|debit/i;
const RE_CREDIT = /บัตรเครดิต|credit\s*card|credit|บัตร\s*(?:หมายเลข|เลขที่)?\s*[xX*•\-]*\d{4}|card\s*(?:no\.?)?\s*[xX*•\-]*\d{4}/i;
const RE_DEPOSIT = /บัญชี|บช\.?|account|a\/c|acct|[xX]{3,}[\-xX]*\d{3,}/i;

// SMS OTP ตอนจ่ายออนไลน์ของ KBank: "ชำระ=THB9,816.00 SHOPEE. OTP=xxxxxx(ABCD) ห้ามเปิดเผย OTP"
const RE_SMS_PAY = /^ช(?:ำ|ํา)ระ\s*[=:]\s*(?:THB|฿)?\s*([0-9]{1,3}(?:,[0-9]{3})*(?:\.[0-9]{1,2})?|[0-9]+(?:\.[0-9]{1,2})?)\s+(.+?)\.?\s*OTP\s*[=:]/i;

const TH_MONTHS = { 'ม.ค.': 1, 'ก.พ.': 2, 'มี.ค.': 3, 'เม.ย.': 4, 'พ.ค.': 5, 'มิ.ย.': 6,
                    'ก.ค.': 7, 'ส.ค.': 8, 'ก.ย.': 9, 'ต.ค.': 10, 'พ.ย.': 11, 'ธ.ค.': 12 };
const RE_WHEN_TH = /(\d{1,2})\s*(ม\.ค\.|ก\.พ\.|มี\.ค\.|เม\.ย\.|พ\.ค\.|มิ\.ย\.|ก\.ค\.|ส\.ค\.|ก\.ย\.|ต\.ค\.|พ\.ย\.|ธ\.ค\.)\s*(\d{2,4})\s+(\d{1,2}):(\d{2})/;
const RE_WHEN_NUM = /(\d{1,2})\/(\d{1,2})\/(\d{2,4})\s+(\d{1,2}):(\d{2})/;

/** กันรหัส OTP หลุดลงชีต */
function redactOtp_(s) {
  return String(s || '').replace(/(OTP\s*[=:]\s*)[0-9]{4,8}/gi, '$1******');
}

function pad2_(n) { return (n < 10 ? '0' : '') + n; }

/** อ่านวันเวลาในข้อความ เช่น "27 ต.ค. 69 00:16 น." หรือ "26/10/69 15:02 น." (ปี พ.ศ. 2 หลักก็ได้) */
function parseWhen_(s, ref, loose) {
  let d, mo, y, hh, mi;
  let m = s.match(RE_WHEN_TH);
  if (m) { d = +m[1]; mo = TH_MONTHS[m[2]]; y = +m[3]; hh = +m[4]; mi = +m[5]; }
  else {
    m = s.match(RE_WHEN_NUM);
    if (!m) return null;
    d = +m[1]; mo = +m[2]; y = +m[3]; hh = +m[4]; mi = +m[5];
  }
  if (y < 100) y += 2500;
  if (y > 2400) y -= 543;
  if (!mo || mo > 12 || d < 1 || d > 31 || hh > 23 || mi > 59) return null;
  const dt = Utilities.parseDate(y + '-' + pad2_(mo) + '-' + pad2_(d) + ' ' + pad2_(hh) + ':' + pad2_(mi), TZ, 'yyyy-MM-dd HH:mm');
  const diff = ref - dt;
  if (!loose && (diff < -3600000 || diff > 3 * 86400000)) return null;   // เวลาในข้อความดูไม่สมเหตุสมผล → ใช้เวลาที่รับแทน
  return dt;
}

function parse_(raw, ref) {
  const s = String(raw || '').replace(/\s+/g, ' ').trim();

  const sms = s.match(RE_SMS_PAY);
  if (sms) {
    const amt = Number(sms[1].replace(/,/g, ''));
    if (!(amt > 0)) return null;
    // SMS นี้ไม่บอกว่าเป็นบัตรใบไหน/เครดิตหรือเดบิต → ใช้ค่า OTP_AS (ค่าเริ่มต้น credit)
    return { type: cfg_('OTP_AS', 'credit'), direction: 'out', amount: amt, merchant: sms[2].trim(), ref: '', when: null };
  }

  if (!s || RE_SKIP.test(s)) return null;
  // แจ้งเตือนโอนล่วงหน้าไม่มีเวลาและบอกบัญชีปลายทาง ธนาคารส่ง "รายการโอน/ถอน" ของรายการเดียวกันตามมา → ไม่นับ กันซ้ำ
  if (RE_SCHEDULED.test(s)) return null;

  const amount = pickAmount_(s);
  if (amount === null || amount <= 0) return null;

  const isCredit = RE_CREDIT.test(s);
  const isDeposit = RE_DEPOSIT.test(s);

  let type = isCredit ? 'credit' : (isDeposit ? 'deposit' : 'unknown');
  // จ่ายบิลบัตรเครดิตจากบัญชี → ไม่นับเป็นรายจ่าย (กันนับซ้ำ)
  if (isCredit && /บัญชี|บช\.?|account|a\/c/i.test(s) && /ชำระ(?:ค่า)?บัตร|ชำระยอด/.test(s)) type = 'card_payment';

  let direction = RE_IN.test(s) ? 'in' : (RE_OUT.test(s) ? 'out' : (type === 'credit' ? 'out' : 'unknown'));
  if (type === 'card_payment') direction = 'transfer';

  return { type: type, direction: direction, amount: amount, merchant: pickMerchant_(s), ref: pickRef_(s),
           when: parseWhen_(s, ref || new Date()) };
}

// เงินสดจากฟอร์มบนหน้าเว็บ (app = manual): "รายการเงินสดจ่าย จำนวนเงิน 120.00 บาท ที่ ร้านข้าว วันที่ 29/10/69 12:30 น."
const RE_CASH = /^รายการเงินสด(จ่าย|รับ) จำนวนเงิน ([0-9]+\.[0-9]{2}) บาท(?: ที่ (.+?))? วันที่ (\d{1,2}\/\d{1,2}\/\d{2,4} \d{1,2}:\d{2}) น\.$/;

function parseCash_(raw, ref) {
  const m = String(raw || '').replace(/\s+/g, ' ').trim().match(RE_CASH);
  if (!m) return null;
  return { type: 'cash', direction: m[1] === 'จ่าย' ? 'out' : 'in', amount: Number(m[2]), merchant: (m[3] || '').trim(), ref: '',
           when: parseWhen_(m[4], ref || new Date(), true) };
}

/** เลือกตัวอ่านตามค่า app ใน Raw (manual = เงินสดจากฟอร์ม, อื่นๆ = แจ้งเตือนธนาคาร) */
function parseApp_(raw, ref, app) {
  return app === 'manual' ? parseCash_(raw, ref) : parse_(raw, ref);
}

function pickAmount_(s) {
  const re = /([0-9]{1,3}(?:,[0-9]{3})+|[0-9]+)\.([0-9]{2})(?![0-9])/g;
  let m;
  while ((m = re.exec(s)) !== null) {
    const before = s.slice(Math.max(0, m.index - 25), m.index);
    if (RE_BALANCE_BEFORE.test(before)) continue;
    return Number((m[1] + '.' + m[2]).replace(/,/g, ''));
  }
  const m2 = s.match(/([0-9]{1,3}(?:,[0-9]{3})+|[0-9]+)\s*(?:บาท|บ\.|THB)/i);
  if (m2) {
    const idx = s.indexOf(m2[0]);
    if (!RE_BALANCE_BEFORE.test(s.slice(Math.max(0, idx - 25), idx))) return Number(m2[1].replace(/,/g, ''));
  }
  return null;
}

function pickMerchant_(s) {
  const m = s.match(/(?:ร้านค้า|ร้าน|(?<!วัน)ที่|merchant|\bat\b|@)\s*[:：]?\s*([A-Za-z0-9ก-๙&'’.\-\/* ]{2,40}?)(?=\s*(?:จำนวน|ยอด|เมื่อ|วันที่|เวลา|คงเหลือ|วงเงิน|[0-9]{1,2}[\/\-.][0-9]{1,2}|[0-9][0-9,]*\.[0-9]{2}|THB|บาท|$))/i);
  return m ? m[1].trim() : '';
}

function pickRef_(s) {
  const m = s.match(/[xX*•\-]{2,}\s*([0-9]{3,4})\b/) || s.match(/(?:บัตร|card)\D{0,15}([0-9]{4})\b/i);
  return m ? m[1] : '';
}

function isDuplicate_(ss, tx, when) {
  const sh = ss.getSheetByName('Tx');
  const last = sh.getLastRow();
  if (last < 2) return false;
  const n = Math.min(20, last - 1);
  const rows = sh.getRange(last - n + 1, 1, n, 5).getValues();
  const windowMs = Number(cfg_('DEDUPE_SEC', '120')) * 1000;
  return rows.some(r =>
    r[COL.type] === tx.type && r[COL.dir] === tx.direction && Number(r[COL.amount]) === tx.amount &&
    Math.abs(when - new Date(r[COL.dt])) <= windowMs);
}

/* ---------- Tagging ---------- */

function rules_(ss) {
  return ss.getSheetByName('Rules').getDataRange().getValues().slice(1)
    .filter(r => r[0] && r[1])
    .map(r => ({ kw: String(r[0]).trim().toUpperCase(), tag: String(r[1]).trim() }));
}

function autoTag_(ss, haystack) {
  const h = String(haystack || '').toUpperCase();
  const hit = rules_(ss).find(r => h.indexOf(r.kw) >= 0);
  return hit ? hit.tag : '';
}

/** ใช้กฎในชีต Rules กับรายการที่ยังไม่มีแท็ก (รันหลังเพิ่มกฎใหม่) */
function retagUntagged() {
  const ss = SpreadsheetApp.getActive();
  const sh = ss.getSheetByName('Tx');
  const rows = sh.getDataRange().getValues();
  let n = 0;
  for (let i = 1; i < rows.length; i++) {
    if (rows[i][COL.tag]) continue;
    const tag = autoTag_(ss, rows[i][COL.merchant] + ' ' + rows[i][COL.raw]);
    if (tag) { sh.getRange(i + 1, COL.tag + 1).setValue(tag); n++; }
  }
  console.log('retagged ' + n);
  return n;
}

function untaggedRows_(ss) {
  const rows = ss.getSheetByName('Tx').getDataRange().getValues();
  const list = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    if ((r[COL.type] === 'credit' || r[COL.type] === 'deposit') && r[COL.dir] === 'out' && !r[COL.tag]) {
      list.push({ row: i + 1, dt: r[COL.dt], amount: Number(r[COL.amount]), merchant: r[COL.merchant], ref: refStr_(r[COL.ref]) });
    }
  }
  return list;
}

function getTx_(ss, row) {
  const sh = ss.getSheetByName('Tx');
  if (row < 2 || row > sh.getLastRow()) return null;
  const r = sh.getRange(row, 1, 1, TX_HEADERS.length).getValues()[0];
  return { row: row, dt: r[COL.dt], amount: Number(r[COL.amount]), merchant: r[COL.merchant], ref: refStr_(r[COL.ref]), tag: r[COL.tag] };
}

/* ---------- โอนระหว่างบัญชีตัวเอง → แท็ก "ข้าม" ---------- */
// K PLUS แจ้ง "โอนออก" จากบัญชีหนึ่ง และ "เงินเข้า" อีกบัญชีหนึ่ง ยอดเท่ากันในเวลาไล่เลี่ยกัน → จับคู่แล้วข้ามทั้งคู่

/** เลขอ้างอิงสำหรับแสดงผล: แถวเก่าที่ชีตเก็บเป็นตัวเลข (เช่น 30) เติม 0 ข้างหน้าให้ครบ 4 หลัก */
function refStr_(v) {
  if (v === '' || v == null) return '';
  const s = String(v);
  return typeof v === 'number' && s.length < 4 ? ('0000' + s).slice(-4) : s;
}

function refNorm_(v) {
  const n = parseInt(String(v), 10);
  return isNaN(n) ? '' : String(n);
}

/** เลขท้ายที่ K PLUS แสดงในรูป xxx-x-xNNNN-x คือหลักที่ 6-9 ของเลขบัญชี 10 หลัก */
function selfKeys_() {
  const acc = accounts_();
  if (acc.length) {
    return acc.filter(a => a.kind === 'bank').map(a => {   // ทุกบัญชีที่เพิ่มถือเป็นบัญชีตัวเอง
      const dg = a.last4.replace(/\D/g, '');
      return dg.length >= 4 ? refNorm_(dg.slice(-4)) : '';
    }).filter(Boolean);
  }
  return cfg_('SELF_ACCOUNTS', '').split(/[,\s]+/).map(a => {
    const dg = a.replace(/\D/g, '');
    if (dg.length === 10) return refNorm_(dg.slice(5, 9));
    if (dg.length >= 4) return refNorm_(dg.slice(-4));
    return '';
  }).filter(Boolean);
}

/** scan = จำนวนแถวท้ายชีตที่ตรวจ (0 = ทั้งชีต) คืนจำนวนแถวที่ถูกแท็ก */
function markSelfTransfers_(ss, scan) {
  const keys = selfKeys_();
  if (keys.length < 2) return 0;
  const sh = ss.getSheetByName('Tx');
  const last = sh.getLastRow();
  if (last < 3) return 0;
  const from = scan ? Math.max(2, last - scan + 1) : 2;
  const rows = sh.getRange(from, 1, last - from + 1, TX_HEADERS.length).getValues();
  const winMs = Number(cfg_('SELF_PAIR_SEC', '600')) * 1000;
  const used = {};
  let marked = 0;
  for (let i = 0; i < rows.length; i++) {
    const a = rows[i];
    if (a[COL.type] !== 'deposit' || a[COL.dir] !== 'out' || a[COL.tag]) continue;
    const ka = refNorm_(a[COL.ref]);
    if (keys.indexOf(ka) < 0) continue;
    for (let j = 0; j < rows.length; j++) {
      const b = rows[j];
      if (used[j] || b[COL.type] !== 'deposit' || b[COL.dir] !== 'in' || b[COL.tag]) continue;
      const kb = refNorm_(b[COL.ref]);
      if (keys.indexOf(kb) < 0 || kb === ka) continue;
      if (Number(b[COL.amount]) !== Number(a[COL.amount])) continue;
      if (Math.abs(new Date(b[COL.dt]) - new Date(a[COL.dt])) > winMs) continue;
      sh.getRange(from + i, COL.tag + 1).setValue(SKIP_TAG);
      sh.getRange(from + j, COL.tag + 1).setValue(SKIP_TAG);
      rows[i][COL.tag] = SKIP_TAG; rows[j][COL.tag] = SKIP_TAG;
      used[j] = true; marked += 2;
      break;
    }
  }
  return marked;
}

/** รันเองได้ใน editor: ตรวจทั้งชีตแล้วข้ามการโอนระหว่างบัญชีตัวเอง */
function markSelfTransfers() {
  console.log('marked ' + markSelfTransfers_(SpreadsheetApp.getActive(), 0));
}

/* ---------- แท็กหลัก/แท็กรอง (เช่น เดท/พิม) ---------- */
// เก็บในคอลัมน์ tag เป็นข้อความ "หลัก/รอง"  รายชื่อแท็กทั้งหมดอยู่ในชีต Tags (main, sub)

function splitTag_(tag) {
  const t = String(tag || '');
  const i = t.indexOf('/');
  return i < 0 ? { main: t, sub: '' } : { main: t.slice(0, i), sub: t.slice(i + 1) };
}

function subTags_() {
  return tagTree_().subRows.slice();
}

/** แท็กที่เลือกได้ทั้งหมด: แท็กหลัก + ข้าม + หลัก/รอง */
function validTags_() {
  return tags_().concat([SKIP_TAG]).concat(subTags_().map(r => r.main + '/' + r.sub));
}

/* ---------- รอบบิล ---------- */

/** รอบบิลที่ offset (0 = รอบปัจจุบัน, -1 = รอบก่อน) เริ่ม 00:00 วันถัดจากวันตัดรอบ
 *  day = วันตัดรอบ (ไม่ใส่ = ของทั้งแอป) เดือนที่ไม่มีวันนั้นใช้วันสุดท้ายของเดือน */
function cycleBounds_(now, offset, day) {
  day = day || cycleDay_();
  const y = Number(fmt_(now, 'yyyy'));
  const m = Number(fmt_(now, 'M'));
  const d = Number(fmt_(now, 'd'));
  const k = (d > cutDay_(y, m, day) ? 0 : -1) + (offset || 0);
  return { start: afterCut_(y, m + k, day), end: afterCut_(y, m + k + 1, day) };
}

/** วันตัดรอบจริงของเดือน m (ไม่เกินจำนวนวันในเดือน) */
function cutDay_(y, m, day) {
  return Math.min(day, new Date(Date.UTC(y, m, 0)).getUTCDate());
}

/** 00:00 ของวันถัดจากวันตัดรอบในเดือน m (m เกิน 1-12 ได้ จะเลื่อนปีให้) */
function afterCut_(y, m, day) {
  const yy = y + Math.floor((m - 1) / 12), mm = ((m - 1) % 12 + 12) % 12 + 1;
  return new Date(bkk_(yy, mm, cutDay_(yy, mm, day)).getTime() + 86400000);
}

function bkk_(y, m, d) {
  return Utilities.parseDate(y + '-' + pad2_(m) + '-' + pad2_(d) + ' 00:00', TZ, 'yyyy-MM-dd HH:mm');
}

function cycleStart_(now) { return cycleBounds_(now, 0).start; }

/* ---------- Dashboard ---------- */

function checkKey_(key) { checkAppKey_(key); }          // VIEW_KEY เลิกใช้แล้ว ใช้ APP_KEY อย่างเดียว

/** เรียกผ่าน api_ จากหน้าเว็บ */
/* แคชผล dashData ใน CacheService (เปิดแอปครั้งถัดไปไม่ต้องอ่านชีตใหม่) ทุกการเขียนชีตเรียก bumpDash_() เพื่อทิ้งแคชเก่า
 * ค่าเกิน 100KB หรือแคชใช้ไม่ได้ จะข้ามไปคำนวณสดเหมือนเดิม; fresh = true (ปุ่มรีเฟรช) ข้ามแคช */
const DASH_TTL = 120;

function dashVer_() {
  const c = CacheService.getScriptCache();
  let v = c.get('dashver');
  if (!v) { v = String(Date.now()); c.put('dashver', v, 21600); }
  return v;
}

function bumpDash_() {
  try { CacheService.getScriptCache().put('dashver', String(Date.now()), 21600); } catch (err) { /* แคชใช้ไม่ได้: ข้าม */ }
}

function dashData(key, offset, fresh) {
  checkKey_(key);
  offset = Number(offset) || 0;
  return cached_('dash_' + offset, fresh, () => dashData_(offset));
}

/** หน้าลงลึกของการ์ด stream = 'credit' | 'transfer' */
function streamData(key, stream, offset, fresh) {
  checkKey_(key);
  if (stream !== 'credit' && stream !== 'transfer') throw new Error('bad stream');
  offset = Number(offset) || 0;
  return cached_('st_' + stream + '_' + offset, fresh, () => streamData_(stream, offset));
}

/** หน้าภาพรวม: 6 รอบที่จบที่ offset */
function overviewData(key, offset, fresh) {
  checkKey_(key);
  offset = Number(offset) || 0;
  return cached_('ov_' + offset, fresh, () => overviewData_(offset));
}

/** คืนผล fn() จากแคช (ชื่อผูกกับ dashVer_ ทุกการเขียนชีตจึงได้ค่าใหม่) */
function cached_(name, fresh, fn) {
  const c = CacheService.getScriptCache();
  let ck = '';
  try { ck = name + '_' + dashVer_(); } catch (err) { ck = ''; }
  if (ck && !fresh) {
    try { const hit = c.get(ck); if (hit) return JSON.parse(hit); } catch (err) { /* อ่านแคชไม่ได้: คำนวณสด */ }
  }
  const d = fn();
  if (ck) { try { c.put(ck, JSON.stringify(d), DASH_TTL); } catch (err) { /* ใหญ่เกินแคช: ข้าม */ } }
  return d;
}

function setTagFromDash(key, row, tag) {
  checkKey_(key);
  tag = String(tag || '');
  if (tag && validTags_().indexOf(tag) < 0) throw new Error('bad tag');
  const sh = SpreadsheetApp.getActive().getSheetByName('Tx');
  row = Number(row);
  if (!(row >= 2 && row <= sh.getLastRow())) throw new Error('bad row');
  sh.getRange(row, COL.tag + 1).setValue(tag);
  bumpDash_();
  return true;
}

/* ---------- JSON API สำหรับหน้าเว็บบน GitHub Pages ----------
 * POST /exec  Content-Type: text/plain  body = {"fn":"dashData","key":"<APP_KEY>","args":[0]}
 * ตอบ {ok:true,data} หรือ {ok:false,error,auth?} (auth = key ผิด) ไม่ใช้ secret ของ MacroDroid */

const API_FNS = {
  dashData: function (k, a) { return dashData(k, a[0], a[1]); },
  setTag: function (k, a) { return setTagFromDash(k, a[0], a[1]); },
  addCash: function (k, a) { return addCash(k, a[0]); },
  confirmRefund: function (k, a) { return confirmRefund(k, a[0], a[1]); },
  rejectRefund: function (k, a) { return rejectRefund(k, a[0]); },
  addMainTag: function (k, a) { return addMainTag(k, a[0]); },
  addSubTag: function (k, a) { return addSubTag(k, a[0], a[1]); },
  renameTag: function (k, a) { return renameTag(k, a[0], a[1], a[2]); },
  deleteTag: function (k, a) { return deleteTag(k, a[0], a[1]); },
  setSetting: function (k, a) { return setSetting(k, a[0], a[1]); },
  streamData: function (k, a) { return streamData(k, a[0], a[1], a[2]); },
  addAccount: function (k, a) { return addAccount(k, a[0]); },
  updateAccount: function (k, a) { return updateAccount(k, a[0], a[1], a[2]); },
  deleteAccount: function (k, a) { return deleteAccount(k, a[0], a[1]); },
  moveTag: function (k, a) { return moveTag(k, a[0], a[1], a[2]); },
  overviewData: function (k, a) { return overviewData(k, a[0], a[1]); }
};

/** คืน object ถ้า body เป็น JSON ที่มี fn (และไม่มี secret ของ MacroDroid) ไม่งั้น null */
function apiRequest_(e) {
  if (!e || (e.parameter && e.parameter.secret)) return null;
  try {
    const b = JSON.parse((e.postData && e.postData.contents) || '');
    return b && typeof b === 'object' && typeof b.fn === 'string' ? b : null;
  } catch (err) { return null; }
}

function api_(b) {
  try { checkAppKey_(b.key); } catch (err) { return out_({ ok: false, auth: true, error: String(err.message || err) }); }
  const f = Object.prototype.hasOwnProperty.call(API_FNS, b.fn) ? API_FNS[b.fn] : null;
  if (!f) return out_({ ok: false, error: 'unknown fn' });
  try {
    return out_({ ok: true, data: f(b.key, Array.isArray(b.args) ? b.args : []) });
  } catch (err) {
    console.error(err);
    return out_({ ok: false, error: String(err.message || err) });
  }
}

/* ---------- ตั้งค่า: ชีต Settings (key, value) ใช้ร่วมทุกเครื่อง ---------- */
// key ที่ยอมรับ: step_credit, step_transfer = ขีด checkpoint ของการ์ดแต่ละใบ (บาท) ถ้าไม่ตั้งใช้ CHECKPOINT_STEP
//               step_total = ขีด checkpoint ของค่าใช้จ่ายรวม (บัตร + โอน + เงินสด)
//               cycle_day = วันตัดรอบของทั้งแอป (ค่าเดียว ใช้ทุกการ์ด)

const SETTINGS_HEADERS = ['key', 'value'];
const SETTING_KEYS = { step_total: 'num', step_credit: 'num', step_transfer: 'num', cycle_day: 'day' };

function settings_() {
  const sh = SpreadsheetApp.getActive().getSheetByName('Settings');
  const out = {};
  if (sh && sh.getLastRow() > 1) {
    sh.getRange(2, 1, sh.getLastRow() - 1, 2).getValues().forEach(r => { if (r[0] !== '') out[String(r[0]).trim()] = r[1]; });
  }
  return out;
}

function stepFor_(stream, st) {
  const v = Number((st || settings_())['step_' + stream]);
  return v >= 100 ? v : (Number(cfg_('CHECKPOINT_STEP', '10000')) || 10000);
}

/** key = ชื่อใน SETTING_KEYS, value = ตัวเลข (ว่าง = ลบค่าที่ตั้ง กลับไปใช้ค่าเริ่มต้น) */
function setSetting(appKey, key, value) {
  checkAppKey_(appKey);
  if (!Object.prototype.hasOwnProperty.call(SETTING_KEYS, key)) throw new Error('ไม่รู้จักค่าที่ตั้ง');
  const raw = String(value == null ? '' : value).replace(/,/g, '').trim();
  let val = '';
  if (raw !== '' && SETTING_KEYS[key] === 'day') val = checkDay_(raw);
  else if (raw !== '') {
    val = Number(raw);
    if (!(val >= 100 && val <= 10000000) || Math.floor(val) !== val) throw new Error('ขีด checkpoint ต้องเป็นจำนวนเต็ม 100 ถึง 10,000,000 บาท');
  }
  return withLock_(function () {
    const sh = ensureSheet_(SpreadsheetApp.getActive(), 'Settings', SETTINGS_HEADERS);
    const n = sh.getLastRow() > 1 ? sh.getRange(2, 1, sh.getLastRow() - 1, 1).getValues() : [];
    let row = 0;
    for (let i = 0; i < n.length; i++) if (String(n[i][0]).trim() === key) { row = i + 2; break; }
    if (row) sh.getRange(row, 2).setValue(val);
    else if (val !== '') sh.appendRow([key, val]);
    return { ok: true };
  });
}

/* ---------- บัญชี/บัตร: เพิ่ม แก้ ลบ จากหน้าตั้งค่า ----------
 * เก็บแค่ 4 หลักที่ใช้จับคู่กับแจ้งเตือน: บัตร = 4 ตัวท้าย; บัญชีเลขเต็ม 10 หลัก = หลักที่ 6-9 (ที่ K PLUS แสดง) ไม่งั้น 4 ตัวท้าย
 * ทุกบัญชี/บัตรที่เพิ่มเป็นของตัวเองเสมอ (self = TRUE) ไม่มีวันตัดรอบรายบัตร (ใช้วันตัดรอบของทั้งแอป)
 * name = ชื่อที่ผู้ใช้ตั้ง (ไม่บังคับ ว่างได้ หน้าเว็บแสดงชื่อประเภทแทน) */

function checkDay_(v) {
  const n = Number(String(v).trim());
  if (!(n >= 1 && n <= 31) || Math.floor(n) !== n) throw new Error('วันตัดรอบต้องเป็นวันที่ 1 ถึง 31');
  return n;
}

function accDigits_(kind, number) {
  const dg = String(number == null ? '' : number).replace(/\D/g, '');
  if (dg.length < 4) throw new Error('หมายเลขต้องมีอย่างน้อย 4 หลัก');
  return kind === 'bank' && dg.length === 10 ? dg.slice(5, 9) : dg.slice(-4);
}

function accName_(kind, last4) { return (kind === 'credit' ? 'บัตรเครดิต' : 'บัญชี') + ' •' + last4; }

function accLabel_(v) {
  const n = String(v == null ? '' : v).trim();
  if (n.length > 30) throw new Error('ชื่อต้องยาวไม่เกิน 30 ตัว');
  return n;
}

function accSheet_() {
  const sh = ensureSheet_(SpreadsheetApp.getActive(), 'Accounts', ACC_HEADERS);
  clearAccCache_();
  return sh;
}

function accDup_(kind, last4, skipRow) {
  return accounts_().some(a => a.kind === kind && a.row !== skipRow && refNorm_(a.last4) === refNorm_(last4));
}

/** p = { kind: 'credit'|'bank', number, name (ไม่บังคับ) } */
function addAccount(appKey, p) {
  checkAppKey_(appKey);
  p = p || {};
  const kind = p.kind === 'bank' ? 'bank' : (p.kind === 'credit' ? 'credit' : '');
  if (!kind) throw new Error('ต้องเลือกประเภท');
  const last4 = accDigits_(kind, p.number);
  const name = accLabel_(p.name);
  return withLock_(function () {
    const sh = accSheet_();
    if (accDup_(kind, last4, 0)) throw new Error('มีหมายเลขนี้อยู่แล้ว');
    const row = sh.getLastRow() + 1;
    sh.getRange(row, 2).setNumberFormat('@');
    sh.getRange(row, 1, 1, ACC_HEADERS.length).setValues([[name, last4, kind, '', true]]);
    clearAccCache_();
    return { ok: true, row: row };
  });
}

/** แก้ชื่อและ/หรือหมายเลขของแถว row (ตรวจว่ายังเป็นแถวเดิมด้วย last4 เดิม) ประเภทเปลี่ยนไม่ได้ ช่อง cycle_day เดิมคงไว้ */
function updateAccount(appKey, row, oldLast4, p) {
  checkAppKey_(appKey);
  p = p || {};
  return withLock_(function () {
    const sh = accSheet_();
    const a = accounts_().filter(x => x.row === Number(row))[0];
    if (!a || a.last4 !== String(oldLast4) || a.kind === 'cash') throw new Error('ไม่พบรายการนี้ (ข้อมูลอาจเปลี่ยนไปแล้ว ลองรีเฟรช)');
    const last4 = String(p.number || '').trim() ? accDigits_(a.kind, p.number) : a.last4;
    if (accDup_(a.kind, last4, a.row)) throw new Error('มีหมายเลขนี้อยู่แล้ว');
    const name = p.name !== undefined ? accLabel_(p.name) : (a.name === accName_(a.kind, a.last4) ? '' : a.name);
    sh.getRange(a.row, 2).setNumberFormat('@');
    sh.getRange(a.row, 1, 1, 2).setValues([[name, last4]]);
    sh.getRange(a.row, 5).setValue(true);
    clearAccCache_();
    return { ok: true };
  });
}

function deleteAccount(appKey, row, oldLast4) {
  checkAppKey_(appKey);
  return withLock_(function () {
    const sh = accSheet_();
    const a = accounts_().filter(x => x.row === Number(row))[0];
    if (!a || a.last4 !== String(oldLast4) || a.kind === 'cash') throw new Error('ไม่พบรายการนี้ (ข้อมูลอาจเปลี่ยนไปแล้ว ลองรีเฟรช)');
    sh.deleteRow(a.row);
    clearAccCache_();
    return { ok: true };
  });
}

/* ---------- เงินสด: บันทึกจากฟอร์มบนหน้า Dashboard (ใช้ APP_KEY) ---------- */

function checkAppKey_(key) {
  const k = cfg_('APP_KEY', '');
  if (!k) throw new Error('ยังไม่ได้ตั้ง APP_KEY ใน Script properties');
  if (key !== k) throw new Error('APP_KEY ไม่ถูกต้อง');
}

/** p = { dir: 'out'|'in', amount, merchant, when: 'yyyy-MM-ddTHH:mm' หรือว่าง = ตอนนี้ } เขียน Raw (app = manual) แล้ว parse เข้า Tx */
function addCash(appKey, p) {
  checkAppKey_(appKey);
  p = p || {};
  const amount = round2_(String(p.amount).replace(/,/g, ''));
  if (!(amount > 0 && amount <= 10000000)) throw new Error('ยอดเงินไม่ถูกต้อง');
  if (p.dir !== 'out' && p.dir !== 'in') throw new Error('ต้องเลือกจ่ายหรือรับ');
  const merchant = String(p.merchant || '').replace(/\s+/g, ' ').trim().slice(0, 40);

  const now = new Date();
  let at = now;
  if (p.when) {
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(p.when)) throw new Error('วันเวลาไม่ถูกต้อง');
    at = Utilities.parseDate(p.when.replace('T', ' '), TZ, 'yyyy-MM-dd HH:mm');
    if (at - now > 3600000) throw new Error('วันเวลาเป็นอนาคต');
  }
  const be = (Number(fmt_(at, 'yyyy')) + 543) % 100;
  const text = 'รายการเงินสด' + (p.dir === 'out' ? 'จ่าย' : 'รับ') + ' จำนวนเงิน ' + amount.toFixed(2) + ' บาท'
    + (merchant ? ' ที่ ' + merchant : '') + ' วันที่ ' + fmt_(at, 'd/M/') + pad2_(be) + ' ' + fmt_(at, 'H:mm') + ' น.';

  return withLock_(function () {
    const ss = SpreadsheetApp.getActive();
    ss.getSheetByName('Raw').appendRow([now, 'manual', text]);
    const tx = parseCash_(text, now);
    if (!tx) throw new Error('อ่านรายการไม่ได้');
    tx.tag = autoTag_(ss, tx.merchant + ' ' + text);
    return { ok: true, row: appendTx_(ss, tx.when || now, tx, 'manual', text) };
  });
}

function round2_(n) { return Math.round((Number(n) || 0) * 100) / 100; }

/* ---------- คืนเงินเข้าบัญชี (เช่น void QR): แนะนำคู่ให้กดยืนยัน ไม่จับคู่เอง ---------- */
// เงินเข้า (deposit/in) ยอดเท่ากับโอนออก (deposit/out) ภายใน 24 ชม. เลขท้ายบัญชีเดียวกัน → แนะนำ
// ยืนยัน = ผูกกับรายการเดิม ได้แท็กเดิม หักจากยอดโอนและยอดแท็ก ไม่นับรายรับ / ปฏิเสธ = นับเป็นเงินเข้าปกติ
// ผลตัดสินเก็บในชีต Matches โดยอ้างด้วยคีย์ (ทิศทาง|เวลา|ยอด|เลขท้าย) ไม่ใช่เลขแถว จึงรอด reparseAll
// รายการที่ติดแท็ก "ข้าม" (โอนระหว่างบัญชีตัวเอง) ไม่ถูกแนะนำ

const MATCH_HEADERS = ['in_key', 'out_key', 'status', 'decided_at'];   // status: ok = ยืนยัน, no = ไม่ใช่
const MATCH_WINDOW_MS = 24 * 3600000;
const MATCH_SKEW_MS = 120000;                  // เวลาแจ้งเตือนคลาดกันได้เล็กน้อย
const MATCH_LOOKBACK_MS = 30 * 86400000;       // แนะนำเฉพาะเงินเข้า 30 วันล่าสุด

function txKey_(r) {
  return [r[COL.dir], new Date(r[COL.dt]).getTime(), round2_(r[COL.amount]).toFixed(2), refNorm_(r[COL.ref])].join('|');
}

function matches_() {
  const sh = SpreadsheetApp.getActive().getSheetByName('Matches');
  const m = { link: {}, usedOut: {}, rejected: {} };
  if (sh && sh.getLastRow() > 1) {
    sh.getRange(2, 1, sh.getLastRow() - 1, 3).getValues().forEach(r => {
      const a = String(r[0]), b = String(r[1]), s = String(r[2]).trim();
      if (s === 'ok' && a && b) { m.link[a] = b; m.usedOut[b] = true; }
      else if (s === 'no' && a) m.rejected[a] = true;
    });
  }
  return m;
}

/** คืน [{ inRow, outRow, inKey, outKey, amount, ref, inAt, outAt, outMerchant, outTag }] rows = ค่าทั้งชีต Tx (รวมหัวตาราง) */
function suggestRefunds_(rows, mt, nowMs) {
  const outs = [], ins = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    if (r[COL.type] !== 'deposit' || !r[COL.dt] || r[COL.tag] === SKIP_TAG) continue;
    const ref = refNorm_(r[COL.ref]);
    if (!ref) continue;
    const o = { row: i + 1, at: new Date(r[COL.dt]).getTime(), amt: round2_(r[COL.amount]), ref: ref, show: refStr_(r[COL.ref]), key: txKey_(r),
                merchant: r[COL.merchant] ? String(r[COL.merchant]) : '', tag: r[COL.tag] ? String(r[COL.tag]) : '' };
    if (r[COL.dir] === 'out') { if (!mt.usedOut[o.key]) outs.push(o); }
    else if (r[COL.dir] === 'in' && !mt.link[o.key] && !mt.rejected[o.key] && nowMs - o.at <= MATCH_LOOKBACK_MS) ins.push(o);
  }
  ins.sort((a, c) => a.at - c.at);
  const taken = {}, list = [];
  ins.forEach(n => {
    let best = null;
    outs.forEach(o => {
      if (taken[o.row] || o.amt !== n.amt || o.ref !== n.ref) return;
      const gap = n.at - o.at;
      if (gap < -MATCH_SKEW_MS || gap > MATCH_WINDOW_MS) return;
      if (!best || Math.abs(gap) < Math.abs(n.at - best.at)) best = o;
    });
    if (!best) return;
    taken[best.row] = true;
    list.push({ inRow: n.row, outRow: best.row, inKey: n.key, outKey: best.key, amount: n.amt, ref: n.show,
                inAt: n.at, outAt: best.at, outMerchant: best.merchant, outTag: best.tag });
  });
  return list;
}

/** ยืนยันว่าเงินเข้าแถว inRow คือเงินคืนของโอนออกแถว outRow (ใช้ APP_KEY) ตรวจเงื่อนไขซ้ำฝั่งเซิร์ฟเวอร์ */
function confirmRefund(appKey, inRow, outRow) {
  checkAppKey_(appKey);
  return withLock_(function () {
    const ss = SpreadsheetApp.getActive();
    const rows = ss.getSheetByName('Tx').getDataRange().getValues();
    const hit = suggestRefunds_(rows, matches_(), Date.now())
      .filter(s => s.inRow === Number(inRow) && s.outRow === Number(outRow))[0];
    if (!hit) throw new Error('ไม่พบคู่ที่แนะนำนี้แล้ว (อาจตัดสินไปแล้ว) กดรีเฟรชแล้วลองใหม่');
    ensureSheet_(ss, 'Matches', MATCH_HEADERS).appendRow([hit.inKey, hit.outKey, 'ok', new Date()]);
    return { ok: true };
  });
}

/** กด "ไม่ใช่": เงินเข้าแถว inRow นับเป็นเงินเข้าปกติ และไม่ถูกแนะนำอีก (ใช้ APP_KEY) */
function rejectRefund(appKey, inRow) {
  checkAppKey_(appKey);
  return withLock_(function () {
    const ss = SpreadsheetApp.getActive();
    const rows = ss.getSheetByName('Tx').getDataRange().getValues();
    const hit = suggestRefunds_(rows, matches_(), Date.now()).filter(s => s.inRow === Number(inRow))[0];
    if (!hit) throw new Error('ไม่พบรายการที่แนะนำนี้แล้ว กดรีเฟรชแล้วลองใหม่');
    ensureSheet_(ss, 'Matches', MATCH_HEADERS).appendRow([hit.inKey, '', 'no', new Date()]);
    return { ok: true };
  });
}

function newStream_() { return { total: 0, today: 0, count: 0, byTag: {}, checkpoints: [], reached: 0 }; }

function finStream_(s, step) {
  const lvl = Math.max(0, Math.floor(s.total / step));
  const prev = lvl * step, next = (lvl + 1) * step;
  const byTag = {};
  Object.keys(s.byTag).forEach(k => { byTag[k] = round2_(s.byTag[k]); });
  return { total: round2_(s.total), today: round2_(s.today), count: s.count, byTag: byTag,
           checkpoints: s.checkpoints, prev: prev, next: next,
           remaining: round2_(next - s.total), progress: (s.total - prev) / step };
}

function spendVal_(stream, dir, amt) {
  if (stream === 'credit') return dir === 'out' ? amt : (dir === 'in' ? -amt : 0);
  return dir === 'out' ? amt : 0;
}

function addSub_(obj, sp, v) {
  const m = sp.main || UNTAGGED;
  const o = obj[m] || (obj[m] = { total: 0, parts: {} });
  o.total += v;
  o.parts[sp.sub] = (o.parts[sp.sub] || 0) + v;
}

/** เก็บเฉพาะแท็กหลักที่มีแท็กรอง (อยู่ในชีต Tags หรือเคยถูกใช้) พร้อมสัดส่วนเรียงจากมากไปน้อย */
function finSubs_(obj, mains) {
  const out = {};
  Object.keys(obj).forEach(m => {
    const o = obj[m];
    const hasSub = Object.keys(o.parts).some(k => k !== '');
    if (!hasSub && mains.indexOf(m) < 0) return;
    const parts = Object.keys(o.parts)
      .map(k => ({ name: k, amt: round2_(o.parts[k]) }))
      .filter(p => Math.abs(p.amt) >= 0.005)
      .sort((a, c) => c.amt - a.amt);
    out[m] = { total: round2_(o.total), parts: parts };
  });
  return out;
}

/**
 * รวมยอดของรอบบิล: credit = บัตรเครดิต (หักคืนเงิน), transfer = เงินออกจากบัญชี (โอน/สแกนจ่าย), cash = เงินสดจ่าย
 * รายการที่แท็ก "ข้าม" ไม่นับ  ส่วนสัดส่วนแท็กรองคำนวณทั้งรอบนี้ (cycle) และตั้งแต่เริ่มบันทึก (all)
 * usage / ruleUsage = จำนวนรายการ (ทุกรอบ) และจำนวนกฎ ที่ใช้แต่ละแท็ก (ใช้ในส่วนจัดการแท็ก)
 */
function dashData_(offset) {
  const ss = SpreadsheetApp.getActive();
  const now = new Date();
  const b = cycleBounds_(now, offset || 0);
  const stt = settings_();
  const steps = { credit: stepFor_('credit', stt), transfer: stepFor_('transfer', stt), cash: stepFor_('cash', stt), total: stepFor_('total', stt) };
  const today = fmt_(now, 'yyyy-MM-dd');
  const rows = ss.getSheetByName('Tx').getDataRange().getValues();
  const S = { credit: newStream_(), transfer: newStream_(), cash: newStream_() };
  const items = [], list = [];
  const subsCycle = {}, subsAll = {};
  const dayMap = { credit: {}, transfer: {}, cash: {} };
  const usage = {}, ruleUsage = {};
  let unknown = 0;
  const income = { account: 0, accountCount: 0, card: 0, cardCount: 0, cash: 0, cashCount: 0 };
  const mt = matches_();
  const outTagByKey = {};
  rows.forEach((r, i) => {
    if (i && r[COL.type] === 'deposit' && r[COL.dir] === 'out' && r[COL.dt]) outTagByKey[txKey_(r)] = r[COL.tag] ? String(r[COL.tag]) : '';
  });
  const suggest = suggestRefunds_(rows, mt, now.getTime());

  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    let tag = r[COL.tag] ? String(r[COL.tag]) : '';
    if (tag) usage[tag] = (usage[tag] || 0) + 1;
    if (!r[COL.dt]) continue;
    const dt = new Date(r[COL.dt]);
    const inCycle = dt >= b.start && dt < b.end;
    const type = r[COL.type], dir = r[COL.dir], amt = Number(r[COL.amount]) || 0;
    if (type === 'unknown') { if (inCycle) unknown++; continue; }
    const stream = type === 'credit' ? 'credit' : (type === 'deposit' ? 'transfer' : (type === 'cash' ? 'cash' : ''));
    if (!stream) continue;
    // เงินเข้าบัญชีที่ผู้ใช้ยืนยันว่าเป็นเงินคืน: ใช้แท็กของรายการโอนออกเดิม หักจากยอดโอนและยอดแท็ก ไม่นับรายรับ
    let linked = false;
    if (type === 'deposit' && dir === 'in') {
      const ok = mt.link[txKey_(r)];
      if (ok !== undefined && outTagByKey[ok] !== undefined) { linked = true; tag = outTagByKey[ok]; }
    }
    const v = linked ? -amt : spendVal_(stream, dir, amt);
    const sp = splitTag_(tag);
    if (tag !== SKIP_TAG && v) addSub_(subsAll, sp, v);
    if (!inCycle) continue;
    const merchant = r[COL.merchant] ? String(r[COL.merchant]) : '';
    const ref = refStr_(r[COL.ref]);
    list.push({ row: i + 1, at: dt.getTime(), stream: stream, dir: dir, amount: amt, merchant: merchant, ref: ref, tag: tag, linked: linked });
    if (dir === 'in' && tag !== SKIP_TAG && !linked) {
      if (stream === 'transfer') { income.account += amt; income.accountCount++; }
      else if (stream === 'credit') { income.card += amt; income.cardCount++; }
      else { income.cash += amt; income.cashCount++; }
    }
    if (tag === SKIP_TAG || !v) continue;
    addSub_(subsCycle, sp, v);
    items.push({ at: dt.getTime(), stream: stream, v: v, merchant: merchant, main: sp.main, day: fmt_(dt, 'yyyy-MM-dd') });
  }

  rules_(ss).forEach(r => { ruleUsage[r.tag] = (ruleUsage[r.tag] || 0) + 1; });

  items.sort((a, c) => a.at - c.at);
  items.forEach(it => {
    const s = S[it.stream];
    const before = s.total;
    s.total += it.v;
    if (it.v > 0) s.count++;
    const tg = it.main || UNTAGGED;
    s.byTag[tg] = (s.byTag[tg] || 0) + it.v;
    if (it.day === today) s.today += it.v;
    dayMap[it.stream][it.day] = (dayMap[it.stream][it.day] || 0) + it.v;
    const step = steps[it.stream];
    const ka = Math.floor(s.total / step);
    for (let k = Math.max(Math.floor(before / step) + 1, s.reached + 1); k <= ka; k++) {
      s.checkpoints.push({ k: k * step, at: it.at, merchant: it.merchant, amount: round2_(it.v) });
      s.reached = k;
    }
  });

  const st = subTags_();
  const tagOptions = {};
  st.forEach(x => { (tagOptions[x.main] = tagOptions[x.main] || []).push(x.sub); });
  const mains = Object.keys(tagOptions);

  // ยอดรายวันตั้งแต่ต้นรอบถึงวันนี้ (หรือถึงสิ้นรอบถ้าเป็นรอบที่ผ่านมาแล้ว) ใช้ทำ sparkline
  const daily = { days: [], credit: [], transfer: [] };
  const lastMs = Math.min(b.end.getTime() - 1, now.getTime());
  for (let t = b.start.getTime(); t <= lastMs; t += 86400000) {
    const k = fmt_(t, 'yyyy-MM-dd');
    daily.days.push(k);
    daily.credit.push(round2_(dayMap.credit[k] || 0));
    daily.transfer.push(round2_(dayMap.transfer[k] || 0));
  }

  list.sort((a, c) => c.at - a.at);
  return {
    now: now.getTime(), step: steps.credit, steps: steps, tags: tags_(), tagOptions: tagOptions, unknown: unknown, daily: daily,
    usage: usage, ruleUsage: ruleUsage,
    cycle: { start: b.start.getTime(), end: b.end.getTime(), offset: offset || 0 },
    credit: finStream_(S.credit, steps.credit),
    transfer: finStream_(S.transfer, steps.transfer),
    cash: finStream_(S.cash, steps.cash),
    income: { account: round2_(income.account), accountCount: income.accountCount, card: round2_(income.card), cardCount: income.cardCount,
              cash: round2_(income.cash), cashCount: income.cashCount, total: round2_(income.account + income.card + income.cash) },
    suggest: suggest,
    total: { total: round2_(S.credit.total + S.transfer.total + S.cash.total), today: round2_(S.credit.today + S.transfer.today + S.cash.today) },
    subs: { cycle: finSubs_(subsCycle, mains), all: finSubs_(subsAll, mains) },
    recent: list,   // ทั้งรอบ: หน้าเว็บเรียงตามยอดได้ทั้งรอบ
    untagged: list.filter(x => x.dir === 'out' && !x.tag).length,
    accounts: accounts_().filter(a => a.kind !== 'cash')
      .map(a => ({ row: a.row, name: a.name === accName_(a.kind, a.last4) ? '' : a.name, last4: a.last4, kind: a.kind })),
    cycleDay: cycleDay_(),
    cycleSetting: Number(stt.cycle_day) || ''
  };
}

/**
 * หน้าลงลึกของการ์ด: credit แยกตามบัตร (ref = เลขท้ายบัตร), transfer แยกตามบัญชี (ref) ทุกใบใช้รอบของทั้งแอป  ยอดคิดแบบเดียวกับ dashData_ (ข้าม = ไม่นับ, เงินคืนที่ยืนยันแล้วหักยอด)
 */
function streamData_(stream, offset) {
  const now = new Date();
  const app = cycleBounds_(now, offset);
  const groups = {}, order = [];
  accounts_().filter(a => a.kind === (stream === 'credit' ? 'credit' : 'bank')).forEach(a => {
    const k = refNorm_(a.last4.replace(/\D/g, '').slice(-4));
    if (!k || groups[k]) return;
    groups[k] = { key: k, name: a.name === accName_(a.kind, a.last4) ? '' : a.name, last4: a.last4, known: true, b: app, total: 0, count: 0, items: 0 };
    order.push(k);
  });
  const rows = SpreadsheetApp.getActive().getSheetByName('Tx').getDataRange().getValues();
  const mt = stream === 'transfer' ? matches_() : null;
  const outTagByKey = {};
  if (mt) rows.forEach((r, i) => {
    if (i && r[COL.type] === 'deposit' && r[COL.dir] === 'out' && r[COL.dt]) outTagByKey[txKey_(r)] = r[COL.tag] ? String(r[COL.tag]) : '';
  });
  const type = stream === 'credit' ? 'credit' : 'deposit';
  const list = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    if (!r[COL.dt] || r[COL.type] !== type) continue;
    const ref = refStr_(r[COL.ref]);
    const k = refNorm_(ref);
    let g = groups[k];
    if (!g) { g = groups[k] = { key: k, name: '', last4: ref, known: false, b: app, total: 0, count: 0, items: 0 }; order.push(k); }
    const dt = new Date(r[COL.dt]);
    if (dt < g.b.start || dt >= g.b.end) continue;
    let tag = r[COL.tag] ? String(r[COL.tag]) : '';
    const dir = r[COL.dir], amt = Number(r[COL.amount]) || 0;
    let linked = false;
    if (mt && dir === 'in') {
      const ok = mt.link[txKey_(r)];
      if (ok !== undefined && outTagByKey[ok] !== undefined) { linked = true; tag = outTagByKey[ok]; }
    }
    const v = linked ? -amt : spendVal_(stream, dir, amt);
    list.push({ row: i + 1, at: dt.getTime(), stream: stream, dir: dir, amount: amt, merchant: r[COL.merchant] ? String(r[COL.merchant]) : '',
                ref: ref, tag: tag, linked: linked, acct: k });
    g.items++;
    if (tag === SKIP_TAG || !v) continue;
    g.total += v;
    if (v > 0) g.count++;
  }
  list.sort((a, c) => c.at - a.at);
  return {
    now: now.getTime(), stream: stream,
    cycle: { start: app.start.getTime(), end: app.end.getTime(), offset: offset || 0 },
    accts: order.map(k => groups[k]).filter(g => g.known || g.items)
      .map(g => ({ key: g.key, name: g.name, last4: g.last4, known: g.known, start: g.b.start.getTime(), end: g.b.end.getTime(),
                   total: round2_(g.total), count: g.count })),
    list: list
  };
}

/**
 * หน้าภาพรวม: ยอดรายวันของ 6 รอบ (เก่าสุดก่อน รอบสุดท้าย = offset) คิดแบบเดียวกับ dashData_
 * ex = [รอบ, วันที่ในรอบ (0 = วันแรก), ประเภท c|t|k, แท็กหลัก, ยอด]  inc = [รอบ, วัน, a|k|c, ยอด]
 * ยอดรวมกันตาม key แล้ว หน้าเว็บกรองตามประเภท/หมวดเอง
 */
function overviewData_(offset) {
  const now = new Date();
  const N = 6, cycles = [];
  for (let k = 0; k < N; k++) {
    const b = cycleBounds_(now, offset - (N - 1) + k);
    cycles.push({ start: b.start.getTime(), end: b.end.getTime() });
  }
  const rows = SpreadsheetApp.getActive().getSheetByName('Tx').getDataRange().getValues();
  const mt = matches_();
  const outTagByKey = {};
  rows.forEach((r, i) => {
    if (i && r[COL.type] === 'deposit' && r[COL.dir] === 'out' && r[COL.dt]) outTagByKey[txKey_(r)] = r[COL.tag] ? String(r[COL.tag]) : '';
  });
  const ex = {}, inc = {};
  const add = (m, k, v) => { m[k] = (m[k] || 0) + v; };
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    if (!r[COL.dt]) continue;
    const at = new Date(r[COL.dt]).getTime();
    if (at < cycles[0].start || at >= cycles[N - 1].end) continue;
    let ci = 0;
    while (ci < N - 1 && at >= cycles[ci].end) ci++;
    const day = Math.floor((at - cycles[ci].start) / 86400000);
    const type = r[COL.type], dir = r[COL.dir], amt = Number(r[COL.amount]) || 0;
    const stream = type === 'credit' ? 'credit' : (type === 'deposit' ? 'transfer' : (type === 'cash' ? 'cash' : ''));
    if (!stream) continue;
    let tag = r[COL.tag] ? String(r[COL.tag]) : '';
    let linked = false;
    if (type === 'deposit' && dir === 'in') {
      const ok = mt.link[txKey_(r)];
      if (ok !== undefined && outTagByKey[ok] !== undefined) { linked = true; tag = outTagByKey[ok]; }
    }
    if (tag === SKIP_TAG) continue;
    const s = stream === 'credit' ? 'c' : (stream === 'transfer' ? 't' : 'k');
    if (dir === 'in' && !linked) add(inc, ci + '|' + day + '|' + (stream === 'transfer' ? 'a' : s), amt);
    const v = linked ? -amt : spendVal_(stream, dir, amt);
    if (v) add(ex, ci + '|' + day + '|' + s + '|' + (splitTag_(tag).main || UNTAGGED), v);
  }
  const unpack = m => Object.keys(m).map(k => {
    const p = k.split('|');
    return [Number(p[0]), Number(p[1])].concat(p.slice(2)).concat([round2_(m[k])]);
  }).filter(x => Math.abs(x[x.length - 1]) >= 0.005);
  return { now: now.getTime(), offset: offset, cycles: cycles, tags: tags_(), ex: unpack(ex), inc: unpack(inc) };
}

/* ---------- จัดการแท็กจาก Dashboard (เพิ่ม / เปลี่ยนชื่อ / ลบ) ---------- */

/** ตรวจชื่อแท็ก: ไม่ว่าง, ไม่เกิน 20 ตัว, ห้ามมี , หรือ /, ห้ามเป็นชื่อพิเศษของระบบ คืนชื่อที่ตัดช่องว่างแล้ว */
function cleanTagName_(raw) {
  const n = String(raw == null ? '' : raw).trim();
  if (!n) throw new Error('ชื่อแท็กห้ามว่าง');
  if (n.length > 20) throw new Error('ชื่อแท็กต้องยาวไม่เกิน 20 ตัว');
  if (/[,\/]/.test(n)) throw new Error('ชื่อแท็กห้ามมี , หรือ /');
  if (n === SKIP_TAG || n === UNTAGGED) throw new Error('ชื่อนี้เป็นชื่อพิเศษของระบบ ใช้ไม่ได้');
  return n;
}

/** หาชื่อซ้ำแบบไม่สนตัวพิมพ์เล็กใหญ่ คืนชื่อที่มีอยู่จริง หรือ null */
function findName_(list, name) {
  const low = String(name).toLowerCase();
  for (let i = 0; i < list.length; i++) if (String(list[i]).toLowerCase() === low) return list[i];
  return null;
}

/** แก้คอลัมน์แท็กของชีต (col เริ่มที่ 1) ด้วย fn(tag) → tag ใหม่ แถวที่ว่างไม่แตะ คืนจำนวนแถวที่เปลี่ยน */
function retagColumn_(sh, col, fn) {
  const last = sh.getLastRow();
  if (last < 2) return 0;
  const rng = sh.getRange(2, col, last - 1, 1);
  const vals = rng.getValues();
  let n = 0;
  const out = vals.map(r => {
    const cur = r[0] == null ? '' : String(r[0]).trim();
    if (!cur) return [r[0]];
    const nx = fn(cur);
    if (nx === cur) return [r[0]];
    n++;
    return [nx];
  });
  if (n) rng.setValues(out);
  return n;
}

function countTagUse_(sh, col, pred) {
  const last = sh.getLastRow();
  if (last < 2) return 0;
  let n = 0;
  sh.getRange(2, col, last - 1, 1).getValues().forEach(r => {
    const t = r[0] == null ? '' : String(r[0]).trim();
    if (t && pred(t)) n++;
  });
  return n;
}

/** เปลี่ยนชื่อแท็กหลัก from → to ในทุกแท็กที่ขึ้นต้นด้วย from หรือ from/... (subMap ใช้ตอนรวมแท็กรองชื่อซ้ำ) */
function mapMainTag_(t, from, to, subMap) {
  let r;
  if (t === from) return to;
  if (t.indexOf(from + '/') !== 0) return t;
  const sub = t.slice(from.length + 1);
  r = subMap && subMap[sub] ? subMap[sub] : sub;
  return to + '/' + r;
}

function addMainTag(key, name) {
  checkKey_(key);
  name = cleanTagName_(name);
  return withLock_(() => {
    ensureMigrated_();
    const tree = tagTree_();
    if (findName_(tree.mains, name)) throw new Error('มีแท็กหลักชื่อนี้แล้ว');
    writeTagTree_(tree.mains.concat([name]), copySubs_(tree.subs));
    applyTagValidation_(SpreadsheetApp.getActive());
    return true;
  });
}

/** เพิ่มชื่อแท็กรอง (เช่น เดท → พิม) จากหน้า Dashboard */
function addSubTag(key, main, sub) {
  checkKey_(key);
  main = String(main || '').trim();
  sub = cleanTagName_(sub);
  return withLock_(() => {
    ensureMigrated_();
    const tree = tagTree_();
    if (tree.mains.indexOf(main) < 0) throw new Error('ไม่มีแท็กหลักนี้');
    const subs = copySubs_(tree.subs);
    const list = subs[main] || (subs[main] = []);
    if (findName_(list, sub)) throw new Error('มีชื่อนี้แล้ว');
    list.push(sub);
    writeTagTree_(tree.mains, subs);
    applyTagValidation_(SpreadsheetApp.getActive());
    return true;
  });
}

/**
 * เปลี่ยนชื่อแท็กหลัก (oldName = "เดท") หรือแท็กรอง (oldName = "เดท/พิม", newName = "ชื่อรองใหม่")
 * แก้ทุกที่: ชีต Tags, คอลัมน์ tag ใน Tx, คอลัมน์ tag ใน Rules
 * ถ้า newName ตรงกับแท็กที่มีอยู่แล้ว = รวมแท็ก ต้องส่ง confirmMerge = true ไม่งั้นคืน { needConfirm: true, count }
 */
function renameTag(key, oldName, newName, confirmMerge) {
  checkKey_(key);
  return withLock_(() => {
    ensureMigrated_();
    const ss = SpreadsheetApp.getActive();
    const txSh = ss.getSheetByName('Tx'), ruSh = ss.getSheetByName('Rules');
    const tree = tagTree_();
    const mains = tree.mains.slice();
    const subs = copySubs_(tree.subs);
    const old = splitTag_(String(oldName || '').trim());

    if (old.sub === '') {                               // ----- แท็กหลัก -----
      const idx = mains.indexOf(old.main);
      if (idx < 0) throw new Error('ไม่พบแท็กนี้');
      const nn = cleanTagName_(newName);
      if (nn === old.main) return { ok: true, unchanged: true };
      const hit = findName_(mains, nn);
      const inFam = t => t === old.main || t.indexOf(old.main + '/') === 0;
      if (hit && hit !== old.main) {                    // รวมเข้ากับแท็กที่มีอยู่
        const count = countTagUse_(txSh, COL.tag + 1, inFam) + countTagUse_(ruSh, 2, inFam);
        if (!confirmMerge) return { ok: false, needConfirm: true, count: count, target: hit };
        const target = subs[hit] || (subs[hit] = []);
        const subMap = {};
        (subs[old.main] || []).forEach(s => {
          const ex = findName_(target, s);
          if (ex) subMap[s] = ex; else target.push(s);
        });
        const f = t => mapMainTag_(t, old.main, hit, subMap);
        const tx = retagColumn_(txSh, COL.tag + 1, f);
        const ru = retagColumn_(ruSh, 2, f);
        mains.splice(idx, 1);
        delete subs[old.main];
        writeTagTree_(mains, subs);
        applyTagValidation_(ss);
        return { ok: true, merged: true, tx: tx, rules: ru };
      }
      mains[idx] = nn;                                   // เปลี่ยนชื่อธรรมดา (รวมกรณีเปลี่ยนแค่ตัวพิมพ์)
      if (subs[old.main]) { subs[nn] = subs[old.main]; delete subs[old.main]; }
      const f2 = t => mapMainTag_(t, old.main, nn, null);
      const tx2 = retagColumn_(txSh, COL.tag + 1, f2);
      const ru2 = retagColumn_(ruSh, 2, f2);
      writeTagTree_(mains, subs);
      applyTagValidation_(ss);
      return { ok: true, merged: false, tx: tx2, rules: ru2 };
    }

    // ----- แท็กรอง -----
    const list = subs[old.main];
    if (mains.indexOf(old.main) < 0 || !list || list.indexOf(old.sub) < 0) throw new Error('ไม่พบแท็กนี้');
    let ns = String(newName == null ? '' : newName).trim();
    if (ns.indexOf('/') >= 0) {
      const p = splitTag_(ns);
      if (p.main !== old.main) throw new Error('ย้ายแท็กรองไปแท็กหลักอื่นไม่ได้');
      ns = p.sub;
    }
    ns = cleanTagName_(ns);
    if (ns === old.sub) return { ok: true, unchanged: true };
    const from = old.main + '/' + old.sub;
    const hit2 = findName_(list, ns);
    if (hit2 && hit2 !== old.sub) {                      // รวมเข้ากับแท็กรองที่มีอยู่
      const count2 = countTagUse_(txSh, COL.tag + 1, t => t === from) + countTagUse_(ruSh, 2, t => t === from);
      if (!confirmMerge) return { ok: false, needConfirm: true, count: count2, target: old.main + '/' + hit2 };
      const to = old.main + '/' + hit2;
      const tx3 = retagColumn_(txSh, COL.tag + 1, t => t === from ? to : t);
      const ru3 = retagColumn_(ruSh, 2, t => t === from ? to : t);
      list.splice(list.indexOf(old.sub), 1);
      writeTagTree_(mains, subs);
      applyTagValidation_(ss);
      return { ok: true, merged: true, tx: tx3, rules: ru3 };
    }
    const to2 = old.main + '/' + ns;
    list[list.indexOf(old.sub)] = ns;
    const tx4 = retagColumn_(txSh, COL.tag + 1, t => t === from ? to2 : t);
    const ru4 = retagColumn_(ruSh, 2, t => t === from ? to2 : t);
    writeTagTree_(mains, subs);
    applyTagValidation_(ss);
    return { ok: true, merged: false, tx: tx4, rules: ru4 };
  });
}

/**
 * ลบแท็กหลัก (name = "เดท" ลบแท็กรองของมันด้วย) หรือแท็กรอง (name = "เดท/พิม")
 * ถ้ามีรายการหรือกฎใช้แท็กนี้อยู่ ต้องส่ง moveTo: ชื่อแท็กปลายทาง หรือ "" = ยังไม่แท็ก
 * (ถ้า moveTo ว่าง กฎใน Rules ที่ใช้แท็กนี้จะถูกลบ) ไม่ส่ง moveTo → คืน { needMove: true }
 */
function deleteTag(key, name, moveTo) {
  checkKey_(key);
  return withLock_(() => {
    ensureMigrated_();
    const ss = SpreadsheetApp.getActive();
    const txSh = ss.getSheetByName('Tx'), ruSh = ss.getSheetByName('Rules');
    const tree = tagTree_();
    const mains = tree.mains.slice();
    const subs = copySubs_(tree.subs);
    const p = splitTag_(String(name || '').trim());
    const isMain = p.sub === '';
    if (mains.indexOf(p.main) < 0) throw new Error('ไม่พบแท็กนี้');
    if (!isMain && (!subs[p.main] || subs[p.main].indexOf(p.sub) < 0)) throw new Error('ไม่พบแท็กนี้');
    if (isMain && mains.length <= 1) throw new Error('ต้องมีแท็กหลักอย่างน้อย 1 ตัว');

    const full = p.main + '/' + p.sub;
    const inSet = isMain ? (t => t === p.main || t.indexOf(p.main + '/') === 0) : (t => t === full);
    let dest = moveTo == null ? null : String(moveTo).trim();
    if (dest === UNTAGGED) dest = '';
    const useTx = countTagUse_(txSh, COL.tag + 1, inSet);
    const useRu = countTagUse_(ruSh, 2, inSet);
    if ((useTx + useRu) > 0 && dest === null) return { ok: false, needMove: true, tx: useTx, rules: useRu };
    if (dest) {
      if (validTags_().indexOf(dest) < 0) throw new Error('ไม่พบแท็กปลายทาง');
      if (inSet(dest)) throw new Error('ย้ายไปแท็กที่กำลังลบไม่ได้');
    }

    const target = dest || '';
    const tx = retagColumn_(txSh, COL.tag + 1, t => inSet(t) ? target : t);
    let ru = 0;
    if (dest) {
      ru = retagColumn_(ruSh, 2, t => inSet(t) ? dest : t);
    } else {                                              // ไม่มีแท็กปลายทาง → ลบกฎที่ชี้มาที่แท็กนี้
      const last = ruSh.getLastRow();
      if (last >= 2) {
        const vals = ruSh.getRange(2, 1, last - 1, 2).getValues();
        for (let i = vals.length - 1; i >= 0; i--) {
          const t = String(vals[i][1] == null ? '' : vals[i][1]).trim();
          if (t && inSet(t)) { ruSh.deleteRow(i + 2); ru++; }
        }
      }
    }

    if (isMain) {
      mains.splice(mains.indexOf(p.main), 1);
      delete subs[p.main];
    } else {
      subs[p.main].splice(subs[p.main].indexOf(p.sub), 1);
    }
    writeTagTree_(mains, subs);
    applyTagValidation_(ss);
    return { ok: true, tx: tx, rules: ru };
  });
}

/**
 * ย้ายแท็ก: name = "เดท/พิม" หรือ "เดท", destMain = แท็กหลักปลายทาง ("" = ให้เป็นแท็กหลัก), newName = ชื่อใหม่ (ว่าง = ชื่อเดิม)
 * แท็กรอง → แท็กหลัก หรือย้ายไปอยู่ใต้แท็กหลักอื่น
 * แท็กหลัก → แท็กรองของ destMain: แท็กรองเดิมของมันย้ายตามไปอยู่ใต้ destMain ด้วย (ระดับเดียว)
 * ชื่อซ้ำที่ปลายทาง = รวมเข้าด้วยกัน (หน้าเว็บแจ้งก่อนยืนยันแล้ว) แก้ทุกที่: Tags, Tx, Rules
 */
function moveTag(key, name, destMain, newName) {
  checkKey_(key);
  return withLock_(() => {
    ensureMigrated_();
    const ss = SpreadsheetApp.getActive();
    const txSh = ss.getSheetByName('Tx'), ruSh = ss.getSheetByName('Rules');
    const tree = tagTree_();
    const mains = tree.mains.slice();
    const subs = copySubs_(tree.subs);
    const p = splitTag_(String(name || '').trim());
    const dest = String(destMain == null ? '' : destMain).trim();
    if (mains.indexOf(p.main) < 0) throw new Error('ไม่พบแท็กนี้');
    if (p.sub && (!subs[p.main] || subs[p.main].indexOf(p.sub) < 0)) throw new Error('ไม่พบแท็กนี้');
    if (dest && mains.indexOf(dest) < 0) throw new Error('ไม่พบแท็กปลายทาง');
    const leaf = cleanTagName_(String(newName == null ? '' : newName).trim() || p.sub || p.main);
    let f;
    if (p.sub) {
      const from = p.main + '/' + p.sub;
      if (dest === p.main) throw new Error('อยู่ใต้แท็กนี้อยู่แล้ว');
      subs[p.main].splice(subs[p.main].indexOf(p.sub), 1);
      let to;
      if (!dest) {                                        // แท็กรอง → แท็กหลัก
        const hit = findName_(mains, leaf);
        to = hit || leaf;
        if (!hit) mains.splice(mains.indexOf(p.main) + 1, 0, leaf);
      } else {                                            // ไปอยู่ใต้แท็กหลักอื่น
        const list = subs[dest] || (subs[dest] = []);
        const hit2 = findName_(list, leaf);
        if (!hit2) list.push(leaf);
        to = dest + '/' + (hit2 || leaf);
      }
      f = t => t === from ? to : t;
    } else {                                              // แท็กหลัก → แท็กรองของ dest
      if (!dest || dest === p.main) throw new Error('ต้องเลือกแท็กหลักปลายทาง');
      const list = subs[dest] || (subs[dest] = []);
      const own = (subs[p.main] || []).slice();
      const hitSelf = findName_(list, leaf);
      if (!hitSelf) list.push(leaf);
      const self = dest + '/' + (hitSelf || leaf);
      const subMap = {};
      own.forEach(s => {
        const ex = findName_(list, s);
        if (!ex) list.push(s);
        subMap[s] = dest + '/' + (ex || s);
      });
      mains.splice(mains.indexOf(p.main), 1);
      delete subs[p.main];
      f = t => {
        if (t === p.main) return self;
        if (t.indexOf(p.main + '/') !== 0) return t;
        const s = t.slice(p.main.length + 1);
        return subMap[s] || (dest + '/' + s);
      };
    }
    const tx = retagColumn_(txSh, COL.tag + 1, f);
    const ru = retagColumn_(ruSh, 2, f);
    writeTagTree_(mains, subs);
    applyTagValidation_(ss);
    return { ok: true, tx: tx, rules: ru };
  });
}

/* ---------- แจ้งเตือนเมื่อผ่าน checkpoint (รันทุก 5 นาทีด้วย trigger) ---------- */

function notify_(title, body) {
  if (cfg_('NOTIFY_EMAIL', 'true') !== 'false') {
    try { MailApp.sendEmail(Session.getEffectiveUser().getEmail(), title, body); } catch (err) { console.error(err); }
  }
}

function checkCheckpoints() {
  if (cfg_('CHECKPOINT_ALERT', 'true') !== 'true') return;
  const d = dashData_(0);
  const bk = fmt_(d.cycle.start, 'yyyyMMdd');
  [['credit', '💳 บัตรเครดิต'], ['transfer', '🏦 โอน/สแกนจ่าย']].forEach(p => {
    const s = d[p[0]];
    const stp = d.steps[p[0]];
    const lvl = Math.max(0, Math.floor(s.total / stp));
    const key = 'CP_' + p[0] + '_' + bk;
    const raw = PROPS.getProperty(key);
    const prev = raw === null ? 0 : Number(raw);
    if (lvl > prev) {
      PROPS.setProperty(key, String(lvl));
      notify_(p[1] + ' ผ่าน ' + money_(lvl * stp).replace(/\.00$/, '') + ' บาท แล้ว',
              'รอบนี้ใช้ไป ' + money_(s.total) + ' บาท · อีก ' + money_(s.remaining) + ' ถึง ' + money_(s.next).replace(/\.00$/, ''));
    } else if (raw === null) {
      PROPS.setProperty(key, String(lvl));
    }
  });
}

/* ---------- Widget (KWGT) ---------- */

/** สร้าง WIDGET_KEY ถ้ายังไม่มี แล้วแสดงลิงก์ widget ใน Execution log (รันเองครั้งเดียวใน editor) */
function setupWidgetKey() {
  if (!cfg_('WIDGET_KEY', '')) PROPS.setProperty('WIDGET_KEY', Utilities.getUuid().replace(/-/g, ''));
  console.log('WIDGET_KEY = ' + cfg_('WIDGET_KEY', ''));
  try {
    console.log('WIDGET = ' + ScriptApp.getService().getUrl() + '?widget=' + cfg_('WIDGET_KEY', ''));
  } catch (err) { /* ยังไม่ได้ Deploy */ }
}

/** ตั้งรหัส widget ใหม่ (ถ้าลิงก์หลุด) ต้องแก้ URL ใน KWGT ตามด้วย */
function resetWidgetKey() {
  PROPS.setProperty('WIDGET_KEY', Utilities.getUuid().replace(/-/g, ''));
  console.log('WIDGET_KEY = ' + cfg_('WIDGET_KEY', ''));
}

/** JSON เล็กๆ สำหรับ widget: ยอดรอบปัจจุบัน + sparkline รายวัน (cum = ยอดสะสมรายวัน, daily = ยอดแต่ละวัน) */
function widgetData_() {
  const d = dashData_(0);
  const cum = arr => { let s = 0; return arr.map(v => { s += v; return round2_(s); }); };
  const dispInt_ = n => money_(n).replace(/\.00$/, '');
  const pack = s => ({
    total: s.total, today: s.today, count: s.count,
    totalText: dispInt_(s.total), todayText: dispInt_(s.today),
    next: s.next, remaining: s.remaining, remainingText: dispInt_(s.remaining),
    progress: Math.round(s.progress * 1000) / 1000
  });
  return {
    ok: true,
    updated: d.now,
    updatedText: fmt_(d.now, 'HH:mm'),
    cycle: {
      start: d.cycle.start, end: d.cycle.end,
      label: fmt_(d.cycle.start, 'd/M') + '-' + fmt_(d.cycle.end - 86400000, 'd/M')
    },
    total: { total: d.total.total, today: d.total.today,
             totalText: dispInt_(d.total.total), todayText: dispInt_(d.total.today) },
    credit: pack(d.credit),
    transfer: pack(d.transfer),
    spark: {
      days: d.daily.days,
      credit: cum(d.daily.credit),
      transfer: cum(d.daily.transfer),
      creditDaily: d.daily.credit,
      transferDaily: d.daily.transfer
    },
    unknown: d.unknown,
    untagged: d.untagged
  };
}

/* ---------- Utilities ---------- */

function fmt_(d, pattern) { return Utilities.formatDate(new Date(d), TZ, pattern); }

function cut_(s, n) { s = String(s); return s.length > n ? s.slice(0, n - 1) + '…' : s; }

function money_(n) {
  const v = Math.round((Number(n) || 0) * 100) / 100;
  const [i, f] = Math.abs(v).toFixed(2).split('.');
  return (v < 0 ? '-' : '') + i.replace(/\B(?=(\d{3})+(?!\d))/g, ',') + '.' + f;
}

/* ---------- เครื่องมือซ่อมข้อมูล ---------- */

/** สร้างชีต Tx ใหม่จาก Raw ทั้งหมด (หลังปรับ regex) — เก็บแท็กเดิมไว้ และข้ามการโอนระหว่างบัญชีตัวเองให้ */
function reparseAll() {
  const ss = SpreadsheetApp.getActive();
  const tx = ss.getSheetByName('Tx');
  const keep = {}, seen = {};
  tx.getDataRange().getValues().slice(1).forEach(r => {
    const k = String(r[COL.raw]);
    seen[k] = (seen[k] || 0) + 1;
    if (r[COL.tag]) keep[k + '#' + seen[k]] = r[COL.tag];
  });

  const raw = ss.getSheetByName('Raw').getDataRange().getValues().slice(1);
  tx.clearContents();
  tx.appendRow(TX_HEADERS);
  const seen2 = {};
  raw.forEach(r => {
    const rec = new Date(r[0]);
    const text = String(r[2]);
    const p = parseApp_(text, rec, r[1]);
    if (!p) return;
    const when = p.when || rec;
    if (p.type !== 'cash' && isDuplicate_(ss, p, when)) return;
    seen2[text] = (seen2[text] || 0) + 1;
    p.tag = keep[text + '#' + seen2[text]] || autoTag_(ss, p.merchant + ' ' + text);
    appendTx_(ss, when, p, r[1], text);
  });
  applyTagValidation_(ss);
  markSelfTransfers_(ss, 0);
}

/** ทดสอบ parser ใน editor — ดูผลที่ Execution log */
function testParse() {
  const ss = SpreadsheetApp.getActive();
  [
    'รายการใช้บัตร หมายเลขบัตร xxxx-xxxx-xxxx-7697 จำนวนเงิน 20.00 บาท ที่ SHOPEE *SHOPEE',
    'รายการโอน/ถอน บัญชี xxx-x-x5855-x จำนวนเงิน 1.00 บาท วันที่ 27 ต.ค. 69 00:16 น.',
    'รายการโอนเงินล่วงหน้าสำเร็จ โอนให้บัญชี xxx-x-x0030-x จำนวนเงิน 1.00 บาท',
    'รายการเงินเข้า บัญชี xxx-x-x9024-x จำนวนเงิน 1.00 บาท วันที่ 27 ต.ค. 69 00:16 น.',
    'ชำระ=THB9,816.00 SHOPEE. OTP=211264(DTGW) ห้ามเปิดเผย OTP',
    'รหัส OTP ของคุณคือ 123456'
  ].forEach(s => {
    const p = parse_(s, new Date());
    if (p) p.tag = autoTag_(ss, p.merchant + ' ' + s);
    console.log(s + '\n→ ' + JSON.stringify(p));
  });
}

/* ---------- หน้า Dashboard (HTML) ---------- */
