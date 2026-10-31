/* Jotjor web app (GitHub Pages) — คุยกับ Apps Script ผ่าน fetch (POST text/plain = ไม่มี preflight)
 * ลิงก์ Web app และ APP_KEY เก็บใน localStorage ของเครื่องนี้เท่านั้น ไม่มีค่าใดฝังในคลัง */
(function () {
'use strict';

var LS_URL = 'jotjor_url', LS_KEY = 'jotjor_appkey', LS_CACHE = 'jotjor_cache';
var URL_RE = /^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]+\/exec$/;

var recentPage = { out: 0, in: 0 }, offset = 0, DATA = null, tab = 'out', catAmt = false, catSubs = false, unOpen = false;
var mg = null, mgErr = '', mgNew = '', MGL = [];
var cDir = 'out', cBusy = false;
var ST = { stream: '', offset: 0, data: null, page: 0, acct: null };   // หน้าลงลึกของการ์ด
var acc = null, accKind = 'credit', accAdding = false, accDraft = {};   // ส่วนบัญชีและบัตรในหน้าตั้งค่า
var pending = 0, wgen = 0;   // จำนวนการเขียนที่ยังค้าง / ตัวนับรุ่นของการแก้ ใช้ทิ้งผลโหลดที่เก่ากว่าหน้าจอ

function $(id) { return document.getElementById(id); }
function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
/** t() สำหรับแทรกใน HTML: ค่าที่แทนเข้าไปถูก escape ให้ ส่วนข้อความในตารางเชื่อถือได้ */
function te(key, vars) {
  var v = {};
  if (vars) Object.keys(vars).forEach(function (k) { v[k] = esc(vars[k]); });
  return t(key, v);
}
/** แสดงเป็นบาทเต็มเสมอ (ปัด .50 ขึ้น) ข้อมูลในชีตยังเก็บสตางค์ครบ */
function money(n) {
  n = Math.round(Number(n) || 0);
  var neg = n < 0; n = Math.abs(n);
  return (neg ? '-' : '') + String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}
var BK = 'Asia/Bangkok';
var fDay = new Intl.DateTimeFormat('th-TH', { day: 'numeric', month: 'short', timeZone: BK });
var fDT = new Intl.DateTimeFormat('th-TH', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false, timeZone: BK });
var fT = new Intl.DateTimeFormat('th-TH', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: BK });

function showErr(m) { var e = $('err'); e.hidden = !m; e.textContent = m || ''; }
function errMsg(e) { return e && e.message ? e.message : String(e); }

/* ---------- ความลื่นไหล: toast, ปุ่มบันทึก, แถวกะพริบ, แถบวิ่ง, ตัวเลขนับขึ้น, สั่น ---------- */

var RM = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
function buzz() { if (!RM && navigator.vibrate) { try { navigator.vibrate(12); } catch (e) { /* เครื่องไม่รองรับ */ } } }

var toastT = 0;
/** แถบแจ้งผิดพลาดล่างจอ หายเองใน 4 วินาที หรือแตะเพื่อปิด */
function toast(m) {
  var el = $('toast');
  el.textContent = m; el.hidden = false; el.classList.remove('out');
  clearTimeout(toastT);
  toastT = setTimeout(toastHide, 4000);
}
function toastHide() { var el = $('toast'); el.classList.add('out'); setTimeout(function () { el.hidden = true; }, 200); }
$('toast').onclick = toastHide;

/* สถานะปุ่มบันทึก: busy = วงหมุน กดซ้ำไม่ได้, done = ✓  (SB ใช้กับปุ่มที่ถูกวาดใหม่ด้วย innerHTML) */
var SB = {};
function sbAny() { return Object.keys(SB).length > 0; }
function sbCls(id) { return SB[id] ? ' sb-' + SB[id] : ''; }
function sbSet(btn, st) { btn.classList.remove('sb-busy', 'sb-done'); if (st) btn.classList.add('sb-' + st); btn.disabled = st === 'busy'; }

/* แผงที่ขยายออก: xpNext = ชื่อแผงที่เพิ่งเปิด (เล่นแอนิเมชันครั้งเดียว ไม่เล่นซ้ำตอนวาดใหม่) */
var xpNext = '';
function xpc(k) { return xpNext === k ? ' xp' : ''; }
/** เล่นแอนิเมชันหุบของแผง .xpanel แล้วค่อยเปลี่ยนสถานะ */
function collapseThen(cb) {
  var els = document.querySelectorAll('.xpanel');
  if (RM || !els.length) { cb(); return; }
  Array.prototype.forEach.call(els, function (el) { el.classList.add('xpout'); });
  setTimeout(cb, 170);
}

/* แถวที่เพิ่งเพิ่ม/แก้ กะพริบสีส้มอ่อนครั้งเดียว (data-k ของแถว) */
var flashK = '';
function flashIn(root) {
  if (!flashK || !root) return;
  var el = root.querySelector('[data-k="' + flashK.replace(/["\\]/g, '') + '"]');
  if (el) { el.classList.add('flash'); flashK = ''; el.scrollIntoView({ block: 'nearest', behavior: RM ? 'auto' : 'smooth' }); }
}

/* แถบพลังวิ่งจาก 0 และตัวเลขยอดรวมนับขึ้น เฉพาะตอนเปิดหน้า/เปลี่ยนรอบ/เปลี่ยนแท็บ */
var animMain = true, animSt = false;
function countUp(el) {
  var to = Number(el.getAttribute('data-n')) || 0, t0 = 0, D = 650;
  function f(now) {
    if (!t0) t0 = now;
    var k = Math.min(1, (now - t0) / D), e = 1 - Math.pow(1 - k, 3);
    el.textContent = money(to * e);
    if (k < 1) requestAnimationFrame(f);
  }
  el.textContent = money(0);
  requestAnimationFrame(f);
}
function animIn(root) {
  if (RM || !root) return;
  Array.prototype.forEach.call(root.querySelectorAll('.bar i'), function (i) {
    var w = i.style.width;
    i.style.transition = 'none'; i.style.width = '0';
    void i.offsetWidth;
    i.style.transition = '';
    requestAnimationFrame(function () { i.style.width = w; });
  });
  Array.prototype.forEach.call(root.querySelectorAll('[data-n]'), countUp);
}

/* ---------- bottom sheet (ใช้กับฟอร์มเงินสดและตัวเลือกแทน select ของมือถือ) ---------- */

function sheetOpen(id) { var w = $(id); w.classList.remove('out'); w.hidden = false; }
function sheetClose(id, cb) {
  var w = $(id);
  if (w.hidden) { if (cb) cb(); return; }
  if (RM) { w.hidden = true; if (cb) cb(); return; }
  w.classList.add('out');
  setTimeout(function () { w.hidden = true; w.classList.remove('out'); if (cb) cb(); }, 190);
}

/** แทน <select> ทุกตัวใน root ด้วยปุ่มที่เปิด bottom sheet; select ตัวจริงซ่อนไว้ เก็บค่าและ onchange เดิม */
function enhance(root) {
  if (!root) return;
  Array.prototype.forEach.call(root.querySelectorAll('select:not(.nsel)'), function (sel) {
    sel.classList.add('nsel');
    var b = document.createElement('button');
    b.type = 'button'; b.className = 'selbtn';
    b.onclick = function () { pickOpen(sel); };
    sel.parentNode.insertBefore(b, sel.nextSibling);
    pickSync(sel);
  });
}
function pickSync(sel) {
  var b = sel.nextSibling, o = sel.options[sel.selectedIndex];
  if (!b || b.className.indexOf('selbtn') < 0) return;
  b.disabled = sel.disabled;
  b.className = 'selbtn' + (sel.classList.contains('un') ? ' un' : '') + (!o || o.hasAttribute('data-ph') ? ' ph' : '');
  b.innerHTML = '<span>' + esc(o ? o.text : '') + '</span><i class="ic ic-caret"></i>';
}
var PK = null;
function pickOpen(sel) {
  if (sel.disabled) return;
  PK = sel;
  var h = '';
  function one(o, ind) {
    if (o.hasAttribute('data-ph')) return '';
    var on = o.index === sel.selectedIndex;
    return '<button type="button" class="pko' + (ind ? ' ind' : '') + (on ? ' on' : '') + '" onclick="pickGo(' + o.index + ')"><span>' + esc(o.text) + '</span>' + (on ? '<i class="ic ic-check"></i>' : '') + '</button>';
  }
  Array.prototype.forEach.call(sel.children, function (c) {
    if (c.tagName === 'OPTGROUP') {
      h += '<div class="pkg">' + esc(c.label) + '</div>';
      Array.prototype.forEach.call(c.children, function (o) { h += one(o, true); });
    } else h += one(c, false);
  });
  $('pkTitle').textContent = sel.getAttribute('data-title') || t('pick.title');
  $('pkList').innerHTML = h;
  sheetOpen('picker');
  var on = $('pkList').querySelector('.on');
  $('pkList').scrollTop = 0;
  if (on) on.scrollIntoView({ block: 'center' });
}
function pickGo(i) {
  var sel = PK; PK = null;
  sheetClose('picker');
  if (!sel || sel.selectedIndex === i) return;
  sel.selectedIndex = i;
  pickSync(sel);
  sel.dispatchEvent(new Event('change'));
}
window.pickGo = pickGo;
$('pkbg').onclick = function () { PK = null; sheetClose('picker'); };

/* ---------- เก็บค่าในเครื่อง ---------- */

function lsGet(k) { try { return localStorage.getItem(k) || ''; } catch (e) { return ''; } }
function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* โหมดส่วนตัว: ใช้ได้เฉพาะครั้งนี้ */ } }
function lsDel(k) { try { localStorage.removeItem(k); } catch (e) { /* ไม่มีอะไรต้องลบ */ } }

var conn = { url: lsGet(LS_URL), key: lsGet(LS_KEY) };

/* ---------- เรียก Apps Script ---------- */

/** คืน Promise ของ data; ถ้า key ผิดจะเด้งกลับหน้าเชื่อมต่อ */
function api(fn, args, c) {
  c = c || conn;
  return fetch(c.url, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ fn: fn, key: c.key, args: args || [] }),
    redirect: 'follow',
    credentials: 'omit',
    referrerPolicy: 'no-referrer'
  }).then(function (r) {
    return r.text();
  }, function () {
    throw new Error(t('net.error'));
  }).then(function (txt) {
    var j;
    try { j = JSON.parse(txt); } catch (e) { throw new Error(t('net.badReply')); }
    if (!j.ok) {
      var err = new Error(j.error || 'error');
      err.auth = !!j.auth;
      throw err;
    }
    return j.data;
  });
}

function guard(e) {
  if (e && e.auth) { lsDel(LS_CACHE); showSetup(errMsg(e)); return true; }
  return false;
}

/* ---------- หน้าเชื่อมต่อ ---------- */

function showSetup(msg) {
  $('main').hidden = true; $('settings').hidden = true; $('setup').hidden = false;
  $('sUrl').value = conn.url || '';
  $('sKey').value = '';
  $('sMsg').textContent = msg || '';
  $('sGo').disabled = false;
}

/* เก็บข้อมูลรอบปัจจุบันล่าสุดไว้ในเครื่อง เปิดแอปมาโชว์ก่อนแล้วค่อยอัปเดต (ล้างตอนออกจากระบบ) */
function saveCache() { if (DATA && offset === 0) lsSet(LS_CACHE, JSON.stringify(DATA)); }
function readCache() { try { var j = JSON.parse(lsGet(LS_CACHE)); return j && j.cycle && j.recent ? j : null; } catch (e) { return null; } }

function showMain() {
  $('setup').hidden = true; showView('main');
  var c = (offset === 0 && !DATA) ? readCache() : null;
  if (c) { DATA = c; render(); }
  load();
}

$('setupForm').onsubmit = function (ev) {
  ev.preventDefault();
  var url = $('sUrl').value.trim(), key = $('sKey').value.trim();
  if (!URL_RE.test(url)) { $('sMsg').textContent = t('setup.badUrl'); return; }
  if (!key) { $('sMsg').textContent = t('setup.noKey'); return; }
  $('sGo').disabled = true; $('sMsg').textContent = t('setup.checking');
  api('dashData', [0], { url: url, key: key }).then(function () {
    conn = { url: url, key: key };
    lsSet(LS_URL, url); lsSet(LS_KEY, key);
    offset = 0;
    showMain();
  }, function (e) {
    $('sGo').disabled = false;
    $('sMsg').textContent = t('setup.fail', { e: errMsg(e) });
  });
};

var view = 'main';
function fillSteps() {
  var st = (DATA && DATA.steps) || {};
  $('stTotal').value = st.total || ''; $('stCredit').value = st.credit || ''; $('stTransfer').value = st.transfer || '';
}
$('stSave').onclick = function () {
  var a = $('stTotal').value, b = $('stCredit').value, c = $('stTransfer').value, btn = $('stSave');
  sbSet(btn, 'busy');
  api('setSetting', ['step_total', a]).then(function () { return api('setSetting', ['step_credit', b]); })
    .then(function () { return api('setSetting', ['step_transfer', c]); }).then(function () {
      sbSet(btn, 'done'); buzz(); load();
      setTimeout(function () { sbSet(btn, ''); }, 1200);
    }, function (e) {
      sbSet(btn, '');
      if (!guard(e)) toast(t('cash.fail', { e: errMsg(e) }));
    });
};
/* เปลี่ยนหน้า: หน้าย่อยเลื่อนเข้าจากขวา กลับหน้าหลักเลื่อนออกทางขวา (View Transitions ถ้าเบราว์เซอร์รองรับ) */
function showView(v) {
  var same = v === view;
  function swap() {
    view = v; $('main').hidden = v !== 'main'; $('settings').hidden = v !== 'settings'; $('stream').hidden = v !== 'stream';
    if (v === 'settings') { fillSteps(); renderCy(); renderAcc(); renderMg(); }
    if (v === 'main' && !same && DATA) { animMain = true; render(); }
    if (v !== 'main') window.scrollTo(0, 0);
  }
  if (same || RM || !document.startViewTransition) { swap(); return; }
  document.documentElement.setAttribute('data-nav', v === 'main' ? 'back' : 'fwd');
  document.startViewTransition(swap);
}
/* หน้าย่อย (ตั้งค่า / ลงลึก) ใส่ใน history ให้ปุ่มย้อนกลับของมือถือกลับหน้าหลัก ไม่ใช่ปิดแอป */
function openSub(v) { if (view === 'main') history.pushState({ v: v }, ''); else history.replaceState({ v: v }, ''); showView(v); }
function closeSub() { if (history.state && history.state.v) history.back(); else showView('main'); }
window.addEventListener('popstate', function () { if (view !== 'main' && $('setup').hidden) showView('main'); });
if (history.state && history.state.v) history.replaceState(null, '');
$('gear').onclick = function () { openSub('settings'); };
$('setback').onclick = closeSub;
var THEME_IC = { system: 'monitor', light: 'sun', dark: 'moon' };
function applyTheme(th) {
  var r = document.documentElement;
  if (th === 'light' || th === 'dark') r.setAttribute('data-theme', th); else r.removeAttribute('data-theme');
  var cur = (th === 'light' || th === 'dark') ? th : 'system';
  $('themeBtn').innerHTML = '<i class="ic ic-' + THEME_IC[cur] + '"></i>';
  $('themeBtn').setAttribute('aria-label', t('settings.theme') + ': ' + t('theme.' + cur));
}
$('themeBtn').onclick = function () {
  var cur = lsGet('jotjor_theme'); cur = (cur === 'light' || cur === 'dark') ? cur : 'system';
  var th = { system: 'light', light: 'dark', dark: 'system' }[cur];
  lsSet('jotjor_theme', th); applyTheme(th);
};
applyTheme(lsGet('jotjor_theme'));
$('logout').onclick = function () {
  if (!window.confirm(t('settings.confirmLogout'))) return;
  lsDel(LS_URL); lsDel(LS_KEY); lsDel(LS_CACHE);
  conn = { url: '', key: '' }; DATA = null;
  showSetup('');
};

/* ---------- โหลดและแท็ก ---------- */

function load(fresh) {
  var g = wgen, off = offset;
  $('rf').classList.add('spin');
  api('dashData', [off, fresh === true ? 1 : 0]).then(function (d) {
    $('rf').classList.remove('spin');
    if (pending > 0 || g !== wgen || off !== offset) return;   // มีการแก้ที่ใหม่กว่าผลนี้: ทิ้ง ตัวที่แก้เสร็จจะโหลดใหม่เอง
    DATA = d; showErr(''); saveCache(); render();
  }, function (e) {
    $('rf').classList.remove('spin');
    if (!guard(e)) showErr(t('load.fail', { e: errMsg(e) }));
  });
}

/* ---------- แก้บนหน้าจอทันที แล้วส่งไปชีตเบื้องหลัง; พลาดแล้วย้อนกลับ ---------- */

function optimistic(patch, send, failMsg, onFail) {
  var snap = JSON.stringify(DATA);
  wgen++; pending++;
  try { patch(DATA); } catch (e) { /* คำนวณในเครื่องพลาด: ปล่อยให้โหลดจากชีตแก้ให้ */ }
  showErr(''); saveCache(); render();
  if (view === 'stream') renderStream();
  return send().then(function () {
    pending--; wgen++; buzz(); load(); if (view === 'stream') loadStream();
  }, function (e) {
    pending--; wgen++;
    if (guard(e)) return;
    DATA = JSON.parse(snap); saveCache(); render();
    if (onFail) onFail(e); else toast(t(failMsg, { e: errMsg(e) }));
    load(); if (view === 'stream') loadStream();
  });
}

function mainOf(tg) { var i = String(tg || '').indexOf('/'); return i < 0 ? String(tg || '') : tg.slice(0, i); }
function spendOf(x) { return x.stream === 'credit' ? (x.dir === 'out' ? x.amount : -x.amount) : (x.dir === 'out' ? x.amount : 0); }
var SKIP = 'ข้าม', UNTAG = 'ยังไม่แท็ก';   // ต้องตรงกับ SKIP_TAG / UNTAGGED ฝั่ง Apps Script

function addByTag(s, main, v) {
  var k = main || UNTAG;
  s.byTag[k] = (s.byTag[k] || 0) + v;
  if (Math.abs(s.byTag[k]) < 0.005) delete s.byTag[k];
}
function addSubPart(d, tg, v) {
  var main = mainOf(tg), sub = tg.length > main.length ? tg.slice(main.length + 1) : '', map = d.subs && d.subs.cycle;
  if (!map) return;
  var m = map[main || UNTAG];
  if (!m) { if (!sub) return; m = map[main || UNTAG] = { total: 0, parts: [] }; }
  m.total += v;
  var p = m.parts.filter(function (x) { return x.name === sub; })[0];
  if (!p) m.parts.push(p = { name: sub, amt: 0 });
  p.amt += v;
  m.parts = m.parts.filter(function (x) { return Math.abs(x.amt) >= 0.005; }).sort(function (a, b) { return b.amt - a.amt; });
}
/** บวก/ลบยอดของ stream แล้วคำนวณแถบ checkpoint ใหม่ */
function addStream(d, stream, delta) {
  var s = d[stream], step = (d.steps && d.steps[stream]) || d.step || 10000;
  s.total += delta; d.total.total += delta;
  var lvl = Math.max(0, Math.floor(s.total / step));
  s.prev = lvl * step; s.next = (lvl + 1) * step; s.remaining = s.next - s.total; s.progress = (s.total - s.prev) / step;
}

function patchTag(d, row, nt) {
  var x = d.recent.filter(function (r) { return r.row === row; })[0];
  if (!x || x.linked || x.tag === nt) return;
  var old = x.tag, v = spendOf(x);
  if (old !== SKIP) { addByTag(d[x.stream], mainOf(old), -v); addSubPart(d, old, -v); }
  if (nt !== SKIP) { addByTag(d[x.stream], mainOf(nt), v); addSubPart(d, nt, v); }
  var delta = (nt === SKIP ? 0 : v) - (old === SKIP ? 0 : v);
  if (delta) addStream(d, x.stream, delta);
  if (x.dir === 'out') d.untagged += (nt ? 0 : 1) - (old ? 0 : 1);
  if (old && d.usage[old]) d.usage[old]--;
  if (nt) d.usage[nt] = (d.usage[nt] || 0) + 1;
  x.tag = nt;
}

/** แก้แท็กในข้อมูลหน้าลงลึกด้วย (ยอดของบัตร/บัญชีเปลี่ยนเมื่อสลับเข้าออก "ข้าม") */
function patchStreamTag(row, nt) {
  var sd = ST.data, x = sd && sd.list.filter(function (r) { return r.row === row; })[0];
  if (!x || x.linked || x.tag === nt) return;
  var g = sd.accts.filter(function (a) { return a.key === x.acct; })[0], v = spendOf(x);
  if (g) g.total += (nt === SKIP ? 0 : v) - (x.tag === SKIP ? 0 : v);
  x.tag = nt;
}

function setTag(row, sel) {
  var nt = sel.value;
  flashK = 'r' + row;
  optimistic(function (d) { patchTag(d, row, nt); patchStreamTag(row, nt); }, function () { return api('setTag', [row, nt]); }, 'tag.saveFail');
}
window.setTag = setTag;

function recentGo(n) { recentPage[tab] = Math.max(0, recentPage[tab] + n); render(); }
window.recentGo = recentGo;
function toggleCat() { catAmt = !catAmt; render(); if (view === 'stream') renderStream(); }
function toggleSubs() { catSubs = !catSubs; if (catSubs) xpNext = 'cat'; render(); }
function toggleUnOpen() { unOpen = !unOpen; if (unOpen) xpNext = 'un'; render(); }
window.toggleCat = toggleCat; window.toggleSubs = toggleSubs; window.toggleUnOpen = toggleUnOpen;


/* ---------- เงินสด ---------- */

function cashDir(d) { cDir = d; $('cout').className = d === 'out' ? 'on' : ''; $('cin').className = d === 'in' ? 'on' : ''; }
function cashMsg(m) { $('cmsg').textContent = m || ''; }
function patchCash(d, p) {
  var a = Number(String(p.amount).replace(/,/g, ''));
  var at = p.when ? new Date(p.when).getTime() : Date.now();
  if (offset !== 0 || !(a > 0) || isNaN(at) || at < d.cycle.start || at >= d.cycle.end) return;   // นอกรอบนี้: รอโหลดจากชีต
  d.recent.push({ row: 0, at: at, stream: 'cash', dir: p.dir, amount: a, merchant: p.merchant.trim(), ref: '', tag: '', linked: false });
  d.recent.sort(function (x, y) { return y.at - x.at; });
  if (p.dir === 'out') {
    addStream(d, 'cash', a); addByTag(d.cash, '', a); d.untagged++;
    if (fDay.format(new Date(at)) === fDay.format(new Date())) { d.cash.today += a; d.total.today += a; }
  } else {
    d.income.cash += a; d.income.cashCount++; d.income.total += a;
  }
}

function cashGo() {
  if (cBusy) return;
  var p = { dir: cDir, amount: $('camt').value, merchant: $('cmer').value, when: $('cwhen').value }, btn = $('cgo');
  if (!(Number(String(p.amount).replace(/,/g, '')) > 0) || !DATA) {   // ยอดไม่ถูกต้อง: ให้ฝั่งชีตตอบข้อความผิดพลาดตามเดิม
    cBusy = true; sbSet(btn, 'busy'); cashMsg('');
    api('addCash', [p]).then(function () {
      cBusy = false; sbSet(btn, 'done'); buzz();
      setTimeout(function () {
        sbSet(btn, '');
        $('camt').value = ''; $('cmer').value = ''; $('cwhen').value = '';
        closeCash(); load();
      }, 500);
    }, function (e) {
      cBusy = false; sbSet(btn, '');
      if (!guard(e)) toast(t('cash.fail', { e: errMsg(e) }));
    });
    return;
  }
  /* ยอดถูกต้อง: ✓ ทันที ปิดฟอร์ม แล้วรายการใหม่กะพริบ ส่งไปชีตเบื้องหลัง */
  cBusy = true; sbSet(btn, 'done');
  setTimeout(function () {
    cBusy = false; sbSet(btn, '');
    $('camt').value = ''; $('cmer').value = ''; $('cwhen').value = ''; cashMsg('');
    closeCash(function () {
      flashK = 'new';
      optimistic(function (d) { patchCash(d, p); }, function () { return api('addCash', [p]); }, 'cash.fail', function (e) {
        $('camt').value = p.amount; $('cmer').value = p.merchant; $('cwhen').value = p.when;   // คืนค่าที่กรอกไว้ให้แก้แล้วกดใหม่
        openCash(); toast(t('cash.fail', { e: errMsg(e) }));
      });
    });
  }, 450);
}

/* ---------- เงินคืน ---------- */

function patchRefund(d, inRow, yes) {
  var s = d.suggest.filter(function (x) { return x.inRow === inRow; })[0];
  d.suggest = d.suggest.filter(function (x) { return x.inRow !== inRow; });
  if (!yes || !s) return;
  var it = d.recent.filter(function (r) { return r.row === inRow; })[0];
  if (it) { it.linked = true; it.tag = s.outTag || ''; }
  addStream(d, 'transfer', -s.amount); addByTag(d.transfer, mainOf(s.outTag), -s.amount); addSubPart(d, s.outTag || '', -s.amount);
  d.income.account -= s.amount; d.income.accountCount--; d.income.total -= s.amount;
}

function refundGo(inRow, outRow, yes) {
  if (!DATA) return;
  optimistic(function (d) { patchRefund(d, inRow, yes); },
    function () { return yes ? api('confirmRefund', [inRow, outRow]) : api('rejectRefund', [inRow]); }, 'save.fail');
}
window.refundGo = refundGo;

/* ---------- บล็อกหน้าจอ ---------- */

function opt(v, label, cur) { return '<option value="' + esc(v) + '"' + (v === cur ? ' selected' : '') + '>' + esc(label) + '</option>'; }
function tagOpts(d, cur) {
  var h = '';
  d.tags.forEach(function (m) {
    var subs = d.tagOptions[m] || [];
    if (!subs.length) { h += opt(m, m, cur); return; }
    h += '<optgroup label="' + esc(m) + '">' + opt(m, t('tag.noSub', { m: m }), cur);
    subs.forEach(function (s) { h += opt(m + '/' + s, m + t('tag.sep') + s, cur); });
    h += '</optgroup>';
  });
  return h + opt('ข้าม', t('tag.skip'), cur);   // ค่า 'ข้าม' คือค่าที่เก็บในชีต ต้องตรงกับ SKIP_TAG ฝั่ง Apps Script
}

/* ----- จัดการแท็ก: เพิ่ม / เปลี่ยนชื่อ / ลบ (ยืนยันในหน้า ไม่ใช้ alert/confirm/prompt) ----- */

function useOf(map, it) {
  var n = 0;
  Object.keys(map || {}).forEach(function (k) {
    if (k === it.full || (it.isMain && k.indexOf(it.full + '/') === 0)) n += map[k];
  });
  return n;
}

function inSetOf(it, tg) {
  return it.isMain ? (tg === it.main || tg.indexOf(it.main + '/') === 0) : (tg === it.full);
}

function mgRow(d, i) {
  var it = MGL[i], dis = sbAny() ? ' disabled' : '';
  var h = '<div class="mgrow' + (it.isMain ? '' : ' s') + '" data-k="t:' + esc(it.full) + '"><span class="mgn">' + (it.isMain ? '' : '&#8627; ') + esc(it.isMain ? it.main : it.sub) + '</span>';
  h += '<span class="sub">' + useOf(d.usage, it) + '</span>';
  if (it.isMain) h += '<button class="mb mba"' + dis + ' onclick="mgAddSubOpen(' + i + ')"><i class="ic ic-add"></i>' + t('mg.addSub') + '</button>';
  h += '<button class="mb ib"' + dis + ' onclick="mgRenameOpen(' + i + ')" aria-label="' + esc(t('mg.rename')) + '"><i class="ic ic-edit"></i></button>';
  h += '<button class="mb ib"' + dis + ' onclick="mgDelOpen(' + i + ')" aria-label="' + esc(t('mg.delete')) + '"><i class="ic ic-delete"></i></button></div>';
  return h;
}

function mgPanel(d, i) {
  if (!mg || mg.i !== i) return '';
  var it = MGL[i], dis = sbAny() ? ' disabled' : '';
  var cur = it.isMain ? it.main : it.sub;
  var h = '<div class="mgp xpanel' + xpc('mg') + '">', sb = sbCls('mg');
  if (mg.mode === 'rename') {
    h += '<div class="lab">' + te('mg.renameTo', { name: it.full }) + '</div>';
    h += '<input id="mgin" maxlength="20" value="' + esc(mg.draft != null ? mg.draft : cur) + '">';
    h += '<div class="btns"><button class="pri' + sb + '"' + dis + ' onclick="mgRenameGo()">' + t('mg.save') + '</button><button' + dis + ' onclick="mgCancel()">' + t('mg.cancel') + '</button></div>';
  } else if (mg.mode === 'merge') {
    h += '<div class="txt">' + te('mg.mergeMsg', { draft: mg.draft, name: it.full, target: mg.target, count: mg.count }) + '</div>';
    h += '<div class="btns"><button class="dng' + sb + '"' + dis + ' onclick="mgMergeGo()">' + t('mg.mergeGo') + '</button><button' + dis + ' onclick="mgCancel()">' + t('mg.cancel') + '</button></div>';
  } else if (mg.mode === 'addsub') {
    h += '<div class="lab">' + te('mg.addSubTo', { main: it.main }) + '</div>';
    h += '<input id="mgin" maxlength="20" placeholder="' + esc(t('mg.subName')) + '" value="' + esc(mg.draft || '') + '">';
    h += '<div class="btns"><button class="pri' + sb + '"' + dis + ' onclick="mgAddSubGo()">' + t('mg.add') + '</button><button' + dis + ' onclick="mgCancel()">' + t('mg.cancel') + '</button></div>';
  } else if (mg.mode === 'delete') {
    var nTx = useOf(d.usage, it), nRu = useOf(d.ruleUsage, it);
    h += '<div class="txt">' + te('mg.delAsk', { name: it.full }) + (it.isMain ? t('mg.delSubs') : '') + '</div>';
    if (nTx + nRu > 0) {
      h += '<div class="sub" style="margin-top:4px">' + t('mg.delUse', { tx: nTx, rules: nRu ? t('mg.delRules', { n: nRu }) : '' }) + '</div>';
      h += '<div class="lab" style="margin-top:8px">' + t('mg.moveTo') + '</div><select id="mgmv" data-title="' + esc(t('mg.moveTo')) + '">' + opt('', t('mg.moveNone'), '');
      d.tags.forEach(function (m) {
        if (!inSetOf(it, m)) h += opt(m, m, '');
        (d.tagOptions[m] || []).forEach(function (s) {
          var f = m + '/' + s;
          if (!inSetOf(it, f)) h += opt(f, m + t('tag.sep') + s, '');
        });
      });
      h += opt('ข้าม', t('tag.skip'), '') + '</select>';
    }
    h += '<div class="btns"><button class="dng' + sb + '"' + dis + ' onclick="mgDelGo()">' + t('mg.delGo') + '</button><button' + dis + ' onclick="mgCancel()">' + t('mg.cancel') + '</button></div>';
  }
  if (mgErr) h += '<div class="err">' + esc(mgErr) + '</div>';
  return h + '</div>';
}

function mgInner(d) {
  MGL = [];
  var dis = sbAny() ? ' disabled' : '';
  var h = '<h2>' + t('mg.title') + '</h2><div class="sub">' + t('mg.hint') + '</div>';
  d.tags.forEach(function (m) {
    var im = MGL.length;
    MGL.push({ full: m, main: m, sub: '', isMain: true });
    h += mgRow(d, im) + mgPanel(d, im);
    (d.tagOptions[m] || []).forEach(function (s) {
      var is = MGL.length;
      MGL.push({ full: m + '/' + s, main: m, sub: s, isMain: false });
      h += mgRow(d, is) + mgPanel(d, is);
    });
  });
  h += '<div class="addrow"><input id="mgnew" maxlength="20" placeholder="' + esc(t('mg.newMain')) + '" value="' + esc(mgNew) + '"><button class="' + sbCls('mgnew') + '"' + dis + ' onclick="mgAddMain()">' + t('mg.add') + '</button></div>';
  if (!mg && mgErr) h += '<div class="err">' + esc(mgErr) + '</div>';
  return h;
}

function renderMg() {
  var b = $('mgbox');
  if (!b || !DATA) return;
  b.innerHTML = icons(mgInner(DATA));
  if (xpNext === 'mg') xpNext = '';
  enhance(b); flashIn(b);
}

function mgOpen(i, mode) {
  mg = { i: i, mode: mode, draft: null, target: '', count: 0 }; mgErr = ''; xpNext = 'mg';
  renderMg();
  var el = $('mgin'); if (el) el.focus();
}
function mgRenameOpen(i) { mgOpen(i, 'rename'); }
function mgAddSubOpen(i) { mgOpen(i, 'addsub'); }
function mgDelOpen(i) { mgOpen(i, 'delete'); }
function mgCancel() { collapseThen(function () { mg = null; mgErr = ''; renderMg(); }); }
function mgDone(k) { mg = null; mgErr = ''; mgNew = ''; if (k) flashK = 't:' + k; renderMg(); load(); }

/** เรียก API ของส่วนแท็ก: ปุ่มหมุน → ✓ → แผงหุบ; พลาด = toast และแผงค้างไว้ */
function mgRun(name, args, done, id) {
  id = id || 'mg';
  SB[id] = 'busy'; mgErr = ''; renderMg();
  api(name, args).then(function (res) {
    if (res && res.needConfirm) { delete SB[id]; done(res); return; }
    SB[id] = 'done'; buzz(); renderMg();
    setTimeout(function () { collapseThen(function () { delete SB[id]; done(res); }); }, 550);
  }, function (e) {
    delete SB[id];
    if (!guard(e)) { toast(errMsg(e)); renderMg(); }
  });
}

function renamed(it, draft) { draft = String(draft || '').trim(); return it.isMain ? draft : it.main + '/' + draft; }
function mgIn() { var el = $('mgin'); return el ? el.value : ''; }

function mgRenameGo() {
  var it = MGL[mg.i], dr = mg.draft = mgIn();
  mgRun('renameTag', [it.full, dr, false], function (r) {
    if (r && r.needConfirm) { if (mg) { mg.mode = 'merge'; mg.count = r.count; mg.target = r.target; } renderMg(); return; }
    mgDone(renamed(it, dr));
  });
}
function mgMergeGo() {
  var it = MGL[mg.i], dr = mg.draft;
  mgRun('renameTag', [it.full, dr, true], function () { mgDone(renamed(it, dr)); });
}
function mgAddSubGo() {
  var it = MGL[mg.i], dr = mg.draft = mgIn();
  mgRun('addSubTag', [it.main, dr], function () { mgDone(it.main + '/' + String(dr).trim()); });
}
function mgDelGo() {
  var it = MGL[mg.i], sel = $('mgmv');
  mgRun('deleteTag', [it.full, sel ? sel.value : ''], function () { mgDone(); });
}
function mgAddMain() {
  var el = $('mgnew'); mgNew = el ? el.value : '';
  mgRun('addMainTag', [mgNew], function () { mgDone(mgNew.trim()); }, 'mgnew');
}
window.mgRenameOpen = mgRenameOpen; window.mgAddSubOpen = mgAddSubOpen; window.mgDelOpen = mgDelOpen;
window.mgCancel = mgCancel; window.mgRenameGo = mgRenameGo; window.mgMergeGo = mgMergeGo;
window.mgAddSubGo = mgAddSubGo; window.mgDelGo = mgDelGo; window.mgAddMain = mgAddMain;

function catBlock(d) {
  var map = {}, total = 0;
  ['credit', 'transfer', 'cash'].forEach(function (k) {
    var bt = d[k].byTag;
    Object.keys(bt).forEach(function (tg) {
      var v = bt[tg]; if (Math.abs(v) < 0.005) return;
      var main = tg;
      var m = map[main] || (map[main] = { total: 0, subs: {} });
      m.total += v; total += v;
    });
  });
  Object.keys(map).forEach(function (n) {   // แท็กรองมาจาก d.subs.cycle (byTag เก็บแค่แท็กหลัก)
    var g = d.subs && d.subs.cycle && d.subs.cycle[n];
    if (!g || !g.parts.some(function (p) { return p.name !== ''; })) return;
    g.parts.forEach(function (p) { map[n].subs[p.name] = (map[n].subs[p.name] || 0) + p.amt; });
  });
  var names = Object.keys(map);
  var h = '<section class="card"><div class="chead"><h2>' + t('cat.title') + '</h2><span class="ctl"><button class="mb mt' + (catSubs ? ' on' : '') + '" onclick="toggleSubs()" aria-pressed="' + catSubs + '" aria-label="' + esc(t('cat.subs')) + '"><i class="ic ic-subs"></i></button><button class="mb" onclick="toggleCat()" aria-label="' + esc(t('cat.toggle')) + '">' + (catAmt ? '฿' : '%') + '</button></span></div>';
  if (!names.length) return h + '<div class="sub">' + t('cat.empty') + '</div></section>';
  names.sort(function (a, b) { return map[b].total - map[a].total; });
  names.forEach(function (n) {
    var m = map[n], p = total > 0 ? m.total / total * 100 : 0;
    var subs = Object.keys(m.subs).filter(function (x) { return x !== ''; });
    var open = catSubs && subs.length > 0, un = n === 'ยังไม่แท็ก';
    var val = catAmt ? money(m.total) : p.toFixed(0) + '%';
    h += '<div class="cat' + (un ? ' un' : '') + '"><div class="crow">'
      + '<span class="cn">' + esc(un ? t('tag.untagged') : n) + '' + '</span>'
      + '<span class="bar c"><i style="width:' + Math.max(0, Math.min(100, p)).toFixed(1) + '%"></i></span>'
      + '<span class="cv">' + val + '</span></div>';
    if (open && subs.length) {
      subs.sort(function (a, b) { return m.subs[b] - m.subs[a]; });
      if (m.subs[''] > 0.004) subs.push('');
      subs.forEach(function (x) {
        var v = m.subs[x], sp = total > 0 ? v / total * 100 : 0;
        h += '<div class="crow s' + xpc('cat') + '"><span class="cn">' + esc(x || t('subs.none')) + '</span><span class="bar c"><i style="width:' + Math.max(0, Math.min(100, sp)).toFixed(1) + '%"></i></span><span class="cv">' + (catAmt ? money(v) : sp.toFixed(0) + '%') + '</span></div>';
      });
    }
    h += '</div>';
  });
  return h + '</section>';
}

function unBar(d) {
  var list = d.recent.filter(function (x) { return x.dir === 'out' && !x.tag; });
  if (!d.untagged) return '';
  var h = '<section class="card unbar"><div class="unh" onclick="toggleUnOpen()">' + te('un.bar', { n: d.untagged }) + '<i class="car' + (unOpen ? ' o' : '') + '">&#9662;</i></div>';
  if (unOpen) list.forEach(function (x) {
    var nm = x.merchant || t(x.stream === 'credit' ? 'recent.creditName' : (x.stream === 'cash' ? 'recent.cashName' : 'recent.outName'));
    h += '<div class="item' + xpc('un') + '" data-k="r' + Number(x.row) + '"><div class="nm">' + esc(nm) + '</div><div class="am">' + money(x.amount) + '</div><div class="sub">' + fDT.format(new Date(x.at)) + '</div><div></div>'
      + '<select data-title="' + esc(t('tag.pickTitle')) + '" class="un"' + (x.row ? '' : ' disabled') + ' onchange="setTag(' + Number(x.row) + ',this)"><option value="" data-ph>' + t('tag.pick') + '</option>' + tagOpts(d, '') + '</select></div>';
  });
  return h + '</section>';
}

function streamCard(cls, label, s, stream) {
  var pct = Math.max(0, Math.min(100, s.progress * 100));
  return '<div class="mini ' + cls + ' tap" role="button" tabindex="0" onclick="openStream(\'' + stream + '\')" aria-label="' + esc(t('drill.open')) + '">'
    + '<i class="ic ic-next go"></i><div class="lab">' + label + '</div><div class="num">' + money(s.total) + '</div>'
    + '<div class="bar cpb"><i style="width:' + pct.toFixed(1) + '%"></i></div>'
    + '<div class="cp"><span>' + money(s.prev) + '</span><span>' + money(s.next) + '</span></div></div>';
}

function cashTile(d) {
  var k = d.cash, p = d.total.total > 0 ? Math.max(0, Math.min(100, k.total / d.total.total * 100)) : 0;
  return '<button type="button" class="card cashtile" onclick="openCash()" aria-label="' + esc(t('cash.add')) + '"><div class="lab">' + esc(t('card.cash')) + '</div><div class="num">' + money(k.total) + '</div>'
    + '<div class="bar c" style="margin-top:10px"><i style="width:' + p.toFixed(1) + '%"></i></div>'
    + '<div class="sub" style="margin-top:6px">' + p.toFixed(0) + '%</div></button>';
}
function openCash() { sheetOpen('sheet'); cashMsg(''); }
function closeCash(cb) { sheetClose('sheet', cb); }
window.openCash = openCash;

function suggestBlock(d) {
  if (!d.suggest || !d.suggest.length) return '';
  var h = '<section class="card"><h2>' + t('suggest.title') + '</h2>';
  d.suggest.forEach(function (s) {
    h += '<div class="sg"><div class="gh"><span>' + t('suggest.in', { amount: money(s.amount) }) + '</span><span class="sub">🏦 x' + esc(s.ref) + '</span></div>';
    h += '<div class="sub">' + t('suggest.at', { time: fDT.format(new Date(s.inAt)) }) + '</div>';
    h += '<div class="sub">' + te('suggest.match', { time: fDT.format(new Date(s.outAt)), merchant: s.outMerchant ? ' · ' + s.outMerchant : '', tag: s.outTag || t('tag.untagged') }) + '</div>';
    h += '<div class="btns"><button class="pri" onclick="refundGo(' + Number(s.inRow) + ',' + Number(s.outRow) + ',true)">' + t('suggest.yes') + '</button>';
    h += '<button onclick="refundGo(' + Number(s.inRow) + ',0,false)">' + t('suggest.no') + '</button></div></div>';
  });
  h += '<div class="sub" style="margin-top:10px">' + t('suggest.note') + '</div>';
  return h + '</section>';
}

function incomeBlock(d) {
  var n = d.income;
  var h = '<section class="card"><div class="lab">' + t('income.label') + '</div><div class="big">' + money(n.total) + '<span>' + t('unit.baht') + '</span></div><div class="split">';
  h += '<div class="mini n"><div class="lab">' + t('income.account') + '</div><div class="num">' + money(n.account) + '</div><div class="sub">' + t('income.count', { n: n.accountCount }) + '</div></div>';
  h += '<div class="mini n"><div class="lab">' + t('income.cash') + '</div><div class="num">' + money(n.cash) + '</div><div class="sub">' + t('income.count', { n: n.cashCount }) + '</div></div>';
  h += '<div class="mini k"><div class="lab">' + t('income.card') + '</div><div class="num">' + money(n.card) + '</div>';
  h += '<div class="sub">' + t('income.cardNote', { n: n.cardCount }) + '</div></div>';
  return h + '</div></section>';
}

function recentBlock(d, mode) {
  var list = d.recent.filter(function (x) { return mode === 'in' ? x.dir === 'in' : (x.dir === 'out' || x.stream === 'credit'); });   // หน้ารายจ่ายรวมเงินคืนบัตรที่หักยอด
  var pages = Math.max(1, Math.ceil(list.length / 5));
  recentPage[mode] = Math.min(recentPage[mode], pages - 1);
  return recentList(d, list, recentPage[mode], 5, 'recentGo');
}

/** การ์ดรายการล่าสุด (ใช้ทั้งหน้าหลักและหน้าลงลึก) d = ข้อมูลหน้าหลัก ใช้รายชื่อแท็ก, goFn = ชื่อฟังก์ชันเปลี่ยนหน้า */
function recentList(d, list, page, PER, goFn) {
  var h = '<section class="card"><h2>' + t('recent.title') + '</h2>';
  var shown = 0, pages = Math.max(1, Math.ceil(list.length / PER));
  list.slice(page * PER, page * PER + PER).forEach(function (x) {
    var spend = x.dir === 'out';
    var refund = x.stream === 'credit' && !spend;
    shown++;
    var nm = x.merchant || (x.stream === 'credit' ? t(refund ? 'recent.creditRefund' : 'recent.creditName')
      : (x.stream === 'cash' ? t('recent.cashName') : (spend ? t('recent.outName') : t(x.linked ? 'recent.refundIn' : 'recent.in'))));
    var who = x.stream === 'cash' ? t('recent.whoCash') : te(x.stream === 'credit' ? 'recent.whoCard' : 'recent.whoAcct', { ref: x.ref });
    h += '<div class="item" data-k="' + (x.row ? 'r' + Number(x.row) : 'new') + '"><div class="nm">' + esc(nm) + '</div><div class="am' + (spend ? '' : ' in') + '">' + (spend ? '' : '+') + money(x.amount) + '</div>';
    h += '<div class="sub">' + fDT.format(new Date(x.at)) + ' &middot; ' + who + (!spend && x.tag ? ' &middot; ' + esc(x.tag) : '')
      + (refund ? ' &middot; ' + t('recent.cardRefundNote') : '') + (x.linked ? ' &middot; ' + t('recent.linkedNote') : '') + '</div><div></div>';
    if ((spend || refund) && d) {
      h += '<select data-title="' + esc(t('tag.pickTitle')) + '" class="' + (x.tag ? '' : 'un') + '"' + (x.row ? '' : ' disabled') + ' onchange="setTag(' + Number(x.row) + ',this)"><option value="" data-ph>' + t('tag.pick') + '</option>';
      h += tagOpts(d, x.tag);
      h += '</select>';
    }
    h += '</div>';
  });
  if (!shown) h += '<div class="sub" style="padding:12px 0">' + t('recent.empty') + '</div>';
  if (pages > 1) h += '<div class="pg"><button' + (page <= 0 ? ' disabled' : '') + ' onclick="' + goFn + '(-1)">&#8249; ' + t('pg.prev') + '</button><span class="sub">' + t('pg.page', { p: page + 1, n: pages }) + '</span><button' + (page >= pages - 1 ? ' disabled' : '') + ' onclick="' + goFn + '(1)">' + t('pg.next') + ' &#8250;</button></div>';
  return h + '</section>';
}

/* ---------- หน้าลงลึกของการ์ด: สัดส่วนแต่ละบัตร/บัญชี + รายการล่าสุดเฉพาะประเภทนั้น ---------- */

function openStream(s) {
  ST = { stream: s, offset: offset, data: null, page: 0, acct: null }; animSt = true;
  openSub('stream'); renderStream(); loadStream();
}
function loadStream(fresh) {
  var s = ST.stream, off = ST.offset;
  api('streamData', [s, off, fresh === true ? 1 : 0]).then(function (d) {
    if (view !== 'stream' || s !== ST.stream || off !== ST.offset || pending > 0) return;
    ST.data = d; renderStream();
  }, function (e) {
    if (!guard(e) && view === 'stream') $('stapp').innerHTML = '<div class="err">' + esc(t('load.fail', { e: errMsg(e) })) + '</div>';
  });
}
function stGo(n) { ST.page = Math.max(0, ST.page + n); renderStream(); }
function stPick(k) { ST.acct = ST.acct === k ? null : k; ST.page = 0; renderStream(); }
window.openStream = openStream; window.stGo = stGo; window.stPick = stPick;

function range(a, b) { return fDay.format(new Date(a)) + ' – ' + fDay.format(new Date(b - 86400000)); }

function acctName(g, credit) {
  if (g.name) return g.name + (g.last4 ? ' x-' + g.last4 : '');
  return g.last4 ? t(credit ? 'drill.cardRef' : 'drill.acctRef', { ref: g.last4 }) : t('drill.noRef');
}

function renderStream() {
  var credit = ST.stream === 'credit', sd = ST.data;
  $('sttitle').innerHTML = icons(esc(t(credit ? 'card.credit' : 'card.transfer')));
  $('stnext').disabled = ST.offset >= 0;
  if (!sd) {
    $('stcyc').innerHTML = '&nbsp;'; $('stupd').innerHTML = '&nbsp;';
    $('stapp').innerHTML = '<div class="skel"><i class="sk"></i><i class="sk h"></i></div>';
    return;
  }
  var groups = sd.accts.slice().sort(function (a, b) { return b.total - a.total; });
  var sel = groups.filter(function (g) { return g.key === ST.acct; })[0];
  $('stcyc').textContent = range(sd.cycle.start, sd.cycle.end) + (ST.offset === 0 ? t('top.current') : '');
  $('stupd').textContent = t('top.updated', { time: fT.format(new Date(sd.now)) });

  var total = 0;
  groups.forEach(function (g) { if (g.total > 0) total += g.total; });
  var h = '<section class="card"><div class="chead"><h2>' + t(credit ? 'drill.shareCredit' : 'drill.shareTransfer') + '</h2><span class="ctl"><button class="mb" onclick="toggleCat()" aria-label="' + esc(t('cat.toggle')) + '">' + (catAmt ? '฿' : '%') + '</button></span></div>';
  if (!groups.length) h += '<div class="sub">' + t('cat.empty') + '</div>';
  groups.forEach(function (g) {
    var p = total > 0 ? Math.max(0, g.total) / total * 100 : 0;
    h += '<div class="cat tap' + (sel ? (sel === g ? ' on' : ' off') : '') + '" role="button" tabindex="0" onclick="stPick(\'' + esc(g.key) + '\')"><div class="crow">'
      + '<span class="cn">' + esc(acctName(g, credit)) + '</span>'
      + '<span class="bar ' + (credit ? 'c' : 't') + '"><i style="width:' + Math.min(100, p).toFixed(1) + '%"></i></span>'
      + '<span class="cv">' + (catAmt ? money(g.total) : p.toFixed(0) + '%') + '</span></div>'
      + '<div class="sub dsub">' + t('drill.count', { n: g.count }) + '</div></div>';
  });
  if (groups.length > 1) h += '<div class="sub" style="margin-top:8px">' + t('drill.pickHint') + '</div>';
  h += '</section>';

  var list = sd.list.filter(function (x) { return (x.dir === 'out' || x.stream === 'credit') && (!ST.acct || x.acct === ST.acct); });
  var PER = 10, pages = Math.max(1, Math.ceil(list.length / PER));
  ST.page = Math.min(ST.page, pages - 1);
  h += recentList(DATA, list, ST.page, PER, 'stGo');
  $('stapp').innerHTML = icons(h);
  enhance($('stapp'));
  if (animSt) { animSt = false; animIn($('stapp')); }
  flashIn($('stapp'));
}

/* ---------- บัญชีและบัตร (หน้าตั้งค่า) ----------
 * ทุกบัญชี/บัตรที่เพิ่มเป็นของตัวเอง ไม่มีวันตัดรอบรายบัตร (ใช้วันตัดรอบของทั้งแอปในการ์ดวันตัดรอบ) */

function kindLabel(k) { return t(k === 'credit' ? 'acc.credit' : 'acc.bank'); }
function dv(id, def) { return accDraft[id] != null ? accDraft[id] : (def == null ? '' : def); }
function accDraftSet(el) { accDraft[el.id] = el.value; }
window.accDraftSet = accDraftSet;
function accInput(id, ph, attrs, def) {
  return '<input id="' + id + '" ' + (attrs || '') + ' autocomplete="off" placeholder="' + esc(ph) + '" value="' + esc(dv(id, def)) + '" oninput="accDraftSet(this)">';
}

function accRow(a, i) {
  var dis = sbAny() ? ' disabled' : '', credit = a.kind === 'credit';
  var h = '<div class="mgrow acrow" data-k="a:' + esc(a.kind + ':' + a.last4) + '"><span class="acic">' + (credit ? '💳' : '🏦') + '</span>'
    + '<span class="mgn"><span class="acn">' + esc(a.name || kindLabel(a.kind)) + '</span>'
    + '<span class="acm"><span class="acx">x-' + esc(a.last4) + '</span><span class="pill' + (credit ? ' c' : ' t') + '">' + esc(kindLabel(a.kind)) + '</span></span></span>';
  h += '<button class="mb ib"' + dis + ' onclick="accOpen(' + i + ',\'edit\')" aria-label="' + esc(t('acc.edit')) + '"><i class="ic ic-edit"></i></button>';
  h += '<button class="mb ib"' + dis + ' onclick="accOpen(' + i + ',\'del\')" aria-label="' + esc(t('mg.delete')) + '"><i class="ic ic-delete"></i></button></div>';
  if (!acc || acc.i !== i) return h;
  h += '<div class="mgp xpanel' + xpc('acc') + '">';
  if (acc.mode === 'edit') {
    h += accInput('acName', t('acc.namePh'), 'maxlength="30"', a.name);
    h += accInput('acNum', t('acc.newNum', { last4: a.last4 }), 'inputmode="numeric"', '');
    h += '<div class="btns"><button class="pri' + sbCls('acc') + '"' + dis + ' onclick="accSave()">' + t('mg.save') + '</button><button' + dis + ' onclick="accCancel()">' + t('mg.cancel') + '</button></div>';
  } else {
    h += '<div class="txt">' + te('acc.delAsk', { name: (a.name || kindLabel(a.kind)) + ' x-' + a.last4 }) + '</div>';
    h += '<div class="btns"><button class="dng' + sbCls('acc') + '"' + dis + ' onclick="accDel()">' + t('mg.delGo') + '</button><button' + dis + ' onclick="accCancel()">' + t('mg.cancel') + '</button></div>';
  }
  return h + '</div>';
}

function accInner(d) {
  var list = d.accounts || [], dis = sbAny() ? ' disabled' : '';
  var h = '<h2>' + t('acc.title') + '</h2><div class="sub">' + t('acc.hint') + '</div>';
  if (!list.length) h += '<div class="sub acempty">' + t('acc.empty') + '</div>';
  list.forEach(function (a, i) { h += accRow(a, i); });
  if (!accAdding) {
    h += '<button type="button" class="addlong"' + dis + ' onclick="accAddOpen()"><i class="ic ic-add"></i>' + t('acc.addLong') + '</button>';
  } else {
    var credit = accKind === 'credit';
    h += '<div class="mgp xpanel accform' + xpc('accadd') + '"><div class="lab">' + t('acc.addLong') + '</div>';
    h += accInput('acNewName', t('acc.namePh'), 'maxlength="30"', '');
    h += '<select id="acKind" data-title="' + esc(t('acc.kind')) + '" onchange="accKindSet(this.value)">' + opt('credit', t('acc.credit'), accKind) + opt('bank', t('acc.bank'), accKind) + '</select>';
    h += accInput('acNewNum', t(credit ? 'acc.numCredit' : 'acc.numBank'), 'inputmode="numeric"', '');
    h += '<div class="sub" style="margin-top:6px">' + t('acc.numHint') + '</div>';
    h += '<div class="btns"><button class="pri' + sbCls('accadd') + '"' + dis + ' onclick="accAdd()">' + t('mg.save') + '</button><button' + dis + ' onclick="accAddClose()">' + t('mg.cancel') + '</button></div></div>';
  }
  return h;
}

function renderAcc() {
  var b = $('accbox');
  if (!b || !DATA) return;
  b.innerHTML = icons(accInner(DATA));
  if (xpNext === 'acc' || xpNext === 'accadd') xpNext = '';
  enhance(b); flashIn(b);
}

/** เรียก API ของส่วนบัญชี: ปุ่มหมุน → ✓ → แผงหุบ แล้วแถวที่เพิ่ม/แก้กะพริบ; พลาด = toast แผงค้างไว้ */
function accRun(id, name, args, k) {
  SB[id] = 'busy'; renderAcc();
  api(name, args).then(function () {
    SB[id] = 'done'; buzz(); renderAcc();
    setTimeout(function () {
      collapseThen(function () {
        delete SB[id]; acc = null; accAdding = false; accDraft = {};
        if (k) flashK = k;
        renderAcc(); load();
      });
    }, 550);
  }, function (e) {
    delete SB[id];
    if (!guard(e)) { toast(errMsg(e)); renderAcc(); }
  });
}
function val(id) { var el = $(id); return el ? el.value.trim() : ''; }
function dayOk(v) { var n = Number(v); return n >= 1 && n <= 31 && Math.floor(n) === n; }
/** เลข 4 หลักที่ฝั่งชีตจะเก็บ (ตรงกับ accDigits_ ใน Code.gs) ใช้หาแถวที่จะกะพริบ */
function last4Of(kind, num) { var dg = String(num || '').replace(/\D/g, ''); return kind === 'bank' && dg.length === 10 ? dg.slice(5, 9) : dg.slice(-4); }
function accOpen(i, mode) {
  acc = { i: i, mode: mode }; accAdding = false; accDraft = {}; xpNext = 'acc';
  renderAcc();
  var el = $('acName'); if (el) el.focus();
}
function accCancel() { collapseThen(function () { acc = null; accDraft = {}; renderAcc(); }); }
function accAddOpen() {
  acc = null; accAdding = true; accDraft = {}; xpNext = 'accadd';
  renderAcc();
  var el = $('acNewName'); if (el) el.focus();
}
function accAddClose() { collapseThen(function () { accAdding = false; accDraft = {}; renderAcc(); }); }
function accKindSet(k) { accKind = k === 'bank' ? 'bank' : 'credit'; renderAcc(); }
function accSave() {
  var a = DATA.accounts[acc.i], num = val('acNum');
  accRun('acc', 'updateAccount', [a.row, a.last4, { name: val('acName'), number: num }], 'a:' + a.kind + ':' + (num ? last4Of(a.kind, num) : a.last4));
}
function accDel() { var a = DATA.accounts[acc.i]; accRun('acc', 'deleteAccount', [a.row, a.last4], ''); }
function accAdd() {
  var p = { kind: accKind, name: val('acNewName'), number: val('acNewNum') };
  accRun('accadd', 'addAccount', [p], 'a:' + p.kind + ':' + last4Of(p.kind, p.number));
}
window.accOpen = accOpen; window.accCancel = accCancel; window.accKindSet = accKindSet; window.accAddOpen = accAddOpen; window.accAddClose = accAddClose;
window.accSave = accSave; window.accDel = accDel; window.accAdd = accAdd;

/* ---------- วันตัดรอบของทั้งแอป (ค่าเดียว) ---------- */

function renderCy() {
  var b = $('cybox');
  if (!b || !DATA) return;
  var dis = sbAny() ? ' disabled' : '', cur = $('cyApp') && document.activeElement === $('cyApp') ? $('cyApp').value : (DATA.cycleDay || '');
  b.innerHTML = '<h2>' + t('cy.title') + '</h2><div class="sub">' + t('cy.hint') + '</div>'
    + '<div class="addrow"><input id="cyApp" inputmode="numeric" autocomplete="off" placeholder="' + esc(t('cy.ph')) + '" value="' + esc(cur) + '">'
    + '<button class="' + sbCls('cy') + '"' + dis + ' onclick="cySave()">' + t('mg.save') + '</button></div>';
}
function cySave() {
  var v = val('cyApp');
  if (!dayOk(v)) { toast(t('acc.badDay')); return; }
  SB.cy = 'busy'; renderCy();
  api('setSetting', ['cycle_day', v]).then(function () {
    SB.cy = 'done'; buzz(); renderCy(); animMain = true; load();
    setTimeout(function () { delete SB.cy; renderCy(); }, 1200);
  }, function (e) {
    delete SB.cy;
    if (!guard(e)) { toast(errMsg(e)); renderCy(); }
  });
}
window.cySave = cySave;

/* แทนอีโมจิในข้อความด้วยไอคอนจาก icons/ (Phosphor Thin, MIT) */
function icons(h) {
  return h.replace(/💳/g, '<i class="ic ic-credit"></i>').replace(/🏦/g, '<i class="ic ic-transfer"></i>').replace(/💵/g, '<i class="ic ic-cash"></i>').replace(/&#8627; |↳ /g, '<i class="ic ic-sub"></i> ');
}

/* เส้นแนวโน้มรายวันสะสมในการ์ดบัตร/โอน */
function spark(a) {
  if (!a || a.length < 2) return '';
  var cum = [], s = 0, i;
  for (i = 0; i < a.length; i++) { s += Number(a[i]) || 0; cum.push(s); }
  var mx = cum[cum.length - 1] || 1, pts = [];
  for (i = 0; i < cum.length; i++) pts.push((i / (cum.length - 1) * 100).toFixed(1) + ',' + (30 - cum[i] / mx * 28).toFixed(1));
  return '<svg class="spark" viewBox="0 0 100 32" preserveAspectRatio="none" aria-hidden="true"><polyline points="' + pts.join(' ') + '" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" vector-effect="non-scaling-stroke"/></svg>';
}

/** แถบพลังของค่าใช้จ่ายรวม (บัตร + โอน + เงินสด ในรอบนี้) เทียบ checkpoint รวม */
function totalBar(d) {
  var step = (d.steps && d.steps.total) || d.step || 10000, v = d.total.total;
  var lvl = Math.max(0, Math.floor(v / step)), prev = lvl * step, pct = Math.max(0, Math.min(100, (v - prev) / step * 100));
  return '<div class="bar cpb"><i style="width:' + pct.toFixed(1) + '%"></i></div><div class="cp"><span>' + money(prev) + '</span><span>' + money(prev + step) + '</span></div>';
}

function render() {
  var d = DATA, c = d.credit, tr = d.transfer;
  mg = null; mgErr = '';
  $('cyc').textContent = fDay.format(new Date(d.cycle.start)) + ' – ' + fDay.format(new Date(d.cycle.end - 86400000)) + (offset === 0 ? t('top.current') : '');
  $('upd').textContent = t('top.updated', { time: fT.format(new Date(d.now)) });
  $('next').disabled = offset >= 0;
  $('tabOut').className = tab === 'out' ? 'on' : ''; $('tabIn').className = tab === 'in' ? 'on' : '';
  $('tabIn').className += (d.suggest && d.suggest.length ? ' dot' : '');
  $('hold').appendChild($('topbar'));   // เก็บแถบหัวไว้ก่อน innerHTML จะล้างหน้า
  var h = '';
  if (tab === 'out') {
    h += unBar(d) + suggestBlock(d) + '<div id="topslot"></div>';
    h += '<div class="toprow"><section class="card hero"><div class="lab">' + t('total.label') + '</div><div class="big"><b data-n="' + Number(d.total.total) + '">' + money(d.total.total) + '</b><span>' + t('unit.baht') + '</span></div>';
    h += '<div class="sub">' + t('total.today', { n: money(d.total.today) }) + '</div>' + totalBar(d) + '</section>' + cashTile(d) + '</div><div class="split">';
    h += streamCard('c', t('card.credit'), c, 'credit') + streamCard('t', t('card.transfer'), tr, 'transfer') + '</div>';
    if (d.unknown) h += '<div class="warnb">' + t('warn.unknown', { n: d.unknown }) + '</div>';
    h += catBlock(d) + recentBlock(d, 'out');
  } else {
    h += '<div id="topslot"></div>' + suggestBlock(d) + incomeBlock(d) + recentBlock(d, 'in');
  }
  $('app').innerHTML = icons(h);
  $('topslot').appendChild($('topbar'));
  if (xpNext === 'cat' || xpNext === 'un') xpNext = '';
  enhance($('app'));
  if (animMain && view === 'main') { animMain = false; animIn($('app')); }
  flashIn($('app'));
  renderMg(); renderAcc(); if (view === 'settings') renderCy();
}

/* ---------- เริ่มต้น ---------- */

function applyStrings() {
  document.title = t('app.title');
  Array.prototype.forEach.call(document.querySelectorAll('[data-t]'), function (el) { el.innerHTML = icons(esc(t(el.getAttribute('data-t')))); });
  Array.prototype.forEach.call(document.querySelectorAll('[data-ph]'), function (el) { el.placeholder = t(el.getAttribute('data-ph')); });
  Array.prototype.forEach.call(document.querySelectorAll('[data-aria]'), function (el) { el.setAttribute('aria-label', t(el.getAttribute('data-aria'))); });
}

function busy() { if (mg || acc || accAdding || sbAny() || !$('picker').hidden || !$('sheet').hidden) return true; var a = document.activeElement; return a && (a.tagName === 'INPUT' || a.tagName === 'SELECT'); }

applyStrings();
$('prev').onclick = function () { offset--; animMain = true; load(); };
$('next').onclick = function () { if (offset < 0) { offset++; animMain = true; load(); } };
$('rf').onclick = function () { load(true); };   // ปุ่มรีเฟรชข้ามแคชฝั่งเซิร์ฟเวอร์
$('cout').onclick = function () { cashDir('out'); };
$('cin').onclick = function () { cashDir('in'); };
$('cgo').onclick = cashGo;
$('cashClose').onclick = function () { closeCash(); }; $('sheetbg').onclick = function () { closeCash(); };
$('tabOut').onclick = function () { if (tab !== 'out') animMain = true; tab = 'out'; if (DATA) render(); };
$('tabIn').onclick = function () { if (tab !== 'in') animMain = true; tab = 'in'; if (DATA) render(); };
function tick() {
  if (document.hidden || busy()) return;
  if (view === 'main' && !$('main').hidden) load();
  else if (view === 'stream') loadStream();
}
document.addEventListener('visibilitychange', tick);
setInterval(tick, 60000);
$('stback').onclick = closeSub;
$('stprev').onclick = function () { ST.offset--; ST.data = null; ST.page = 0; animSt = true; renderStream(); loadStream(); };
$('stnext').onclick = function () { if (ST.offset < 0) { ST.offset++; ST.data = null; ST.page = 0; animSt = true; renderStream(); loadStream(); } };

/* หน้าเว็บเองเปิดจากแคชในเครื่อง (sw.js); เมื่อมีเวอร์ชันใหม่ขึ้นปุ่มให้แตะโหลดใหม่ */
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(function () { /* ใช้ต่อได้ แค่ไม่มีแคชหน้าเว็บ */ });
  navigator.serviceWorker.addEventListener('message', function (ev) { if (ev.data === 'jotjor-updated') $('newver').hidden = false; });
}
$('newver').onclick = function () { window.location.reload(); };

if (conn.url && conn.key && URL_RE.test(conn.url)) showMain(); else showSetup('');
})();
