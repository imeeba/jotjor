/* Jotjor web app (GitHub Pages) — คุยกับ Apps Script ผ่าน fetch (POST text/plain = ไม่มี preflight)
 * ลิงก์ Web app และ APP_KEY เก็บใน localStorage ของเครื่องนี้เท่านั้น ไม่มีค่าใดฝังในคลัง */
(function () {
'use strict';

var APP_VER = '0.9.1';   // SemVer หลัก.รอง.แก้ไข: ฟีเจอร์ใหม่ขึ้นตัวกลาง แก้บั๊กขึ้นตัวท้าย; 1.0.0 = เปิดเผยแพร่พร้อม tutorial
var LS_URL = 'jotjor_url', LS_KEY = 'jotjor_appkey', LS_CACHE = 'jotjor_cache';
var URL_RE = /^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]+\/exec$/;

var recentPage = { out: 0, in: 0 }, offset = 0, DATA = null, tab = 'out', catAmt = false, catSubs = false, unOpen = false;
var mg = null, mgErr = '', mgNew = '', MGL = [];
var cDir = 'out', cBusy = false, cWhen = '';
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

/* คีย์บอร์ดมือถือ: ยก sheet ขึ้นเหนือคีย์บอร์ด (visualViewport) และเลื่อนช่องที่กำลังพิมพ์ให้เห็นเสมอ
 * Android ใช้ interactive-widget=resizes-content ใน viewport อยู่แล้ว ส่วนนี้ช่วย iOS และเบราว์เซอร์ที่ไม่รองรับ */
function kbFix() {
  var vv = window.visualViewport, r = document.documentElement;
  if (!vv) return;
  r.style.setProperty('--kb', Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop)) + 'px');
  r.style.setProperty('--vvh', Math.round(vv.height) + 'px');
}
if (window.visualViewport) { window.visualViewport.addEventListener('resize', kbFix); window.visualViewport.addEventListener('scroll', kbFix); kbFix(); }
document.addEventListener('focusin', function (ev) {
  var el = ev.target;
  if (!el || el.tagName !== 'INPUT') return;
  setTimeout(function () { kbFix(); el.scrollIntoView({ block: 'center', behavior: RM ? 'auto' : 'smooth' }); }, 320);
});

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
/* เปลี่ยนหน้า: หน้าย่อยเลื่อนเข้าจากขวา กลับหน้าหลักเลื่อนออกทางขวา (View Transitions ถ้าเบราว์เซอร์รองรับ) */
function showView(v) {
  var same = v === view;
  function swap() {
    view = v; $('main').hidden = v !== 'main'; $('settings').hidden = v !== 'settings'; $('stream').hidden = v !== 'stream'; $('ov').hidden = v !== 'ov'; $('about').hidden = v !== 'about';
    if (v === 'settings') { renderCy(); renderCp(); renderAcc(); renderMg(); }
    if (v === 'main' && !same && DATA) { animMain = true; render(); }
    if (v !== 'main') window.scrollTo(0, 0);
    miniSync();
  }
  if (same || RM || !document.startViewTransition) { swap(); return; }
  document.documentElement.setAttribute('data-nav', v === 'main' ? 'back' : 'fwd');
  document.startViewTransition(swap);
}
/* หน้าย่อย (ตั้งค่า / ลงลึก) ใส่ใน history ให้ปุ่มย้อนกลับของมือถือกลับหน้าหลัก ไม่ใช่ปิดแอป */
function openSub(v) { if (view === 'main' || (view === 'settings' && v === 'about')) history.pushState({ v: v }, ''); else history.replaceState({ v: v }, ''); showView(v); }
function closeSub() { if (history.state && history.state.v) history.back(); else showView('main'); }
window.addEventListener('popstate', function () {
  if (view === 'main' || !$('setup').hidden) return;
  var s = history.state && history.state.v;
  showView(s === 'settings' ? 'settings' : 'main');   // หน้าเกี่ยวกับเปิดจากตั้งค่า: ย้อนกลับไปตั้งค่า
});
if (history.state && history.state.v) history.replaceState(null, '');
$('gear').onclick = function () { openSub('settings'); };
$('setback').onclick = closeSub;
$('aboutRow').onclick = function () { openSub('about'); };
$('aboutback').onclick = closeSub;
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
  var p = { dir: cDir, amount: $('camt').value, merchant: $('cmer').value, when: cWhen }, btn = $('cgo');
  if (!(Number(String(p.amount).replace(/,/g, '')) > 0) || !DATA) {   // ยอดไม่ถูกต้อง: ให้ฝั่งชีตตอบข้อความผิดพลาดตามเดิม
    cBusy = true; sbSet(btn, 'busy'); cashMsg('');
    api('addCash', [p]).then(function () {
      cBusy = false; sbSet(btn, 'done'); buzz();
      setTimeout(function () {
        sbSet(btn, '');
        $('camt').value = ''; $('cmer').value = ''; whenSet('');
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
    $('camt').value = ''; $('cmer').value = ''; whenSet(''); cashMsg('');
    closeCash(function () {
      flashK = 'new';
      optimistic(function (d) { patchCash(d, p); }, function () { return api('addCash', [p]); }, 'cash.fail', function (e) {
        $('camt').value = p.amount; $('cmer').value = p.merchant; whenSet(p.when);   // คืนค่าที่กรอกไว้ให้แก้แล้วกดใหม่
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

/* ----- จัดการแท็ก: เพิ่ม / แก้ไข (ชื่อ + ย้าย) / ลบ ทั้งหมดใน bottom sheet (ไม่ใช้ alert/confirm/prompt) ----- */

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

function btns(okCls, okFn, okLabel, sbId) {
  var dis = sbAny() ? ' disabled' : '';
  return '<div class="btns"><button type="button"' + dis + ' onclick="fsCancel()">' + t('mg.cancel') + '</button><button type="button" class="' + okCls + sbCls(sbId) + '"' + dis + ' onclick="' + okFn + '()">' + okLabel + '</button></div>';
}
function fld(label, inner) { return '<div class="fld"><div class="lab">' + label + '</div>' + inner + '</div>'; }
function mgInput(ph, val) { return '<input id="mgin" maxlength="20" autocomplete="off" placeholder="' + esc(ph || '') + '" value="' + esc(val) + '" oninput="mgDraft(this.value)">'; }

/** ข้อความยืนยันการย้าย: บอกปลายทาง แท็กรองที่ย้ายตาม และชื่อที่ชนแล้วจะรวมกัน */
function moveMsg(d, it, dest, leaf) {
  var q = function (s) { return '“' + s + '”'; }, merge = [], h;
  if (!it.isMain && !dest) {
    if (d.tags.indexOf(leaf) >= 0) merge.push(q(leaf));
    h = te('mg.moveUp', { name: it.main + t('tag.sep') + it.sub, to: leaf });
  } else {
    var have = d.tagOptions[dest] || [];
    if (have.indexOf(leaf) >= 0) merge.push(q(dest + t('tag.sep') + leaf));
    if (!it.isMain) h = te('mg.moveSub', { name: it.main + t('tag.sep') + it.sub, dest: dest, to: dest + t('tag.sep') + leaf });
    else {
      h = te('mg.moveMain', { name: it.main, dest: dest, to: dest + t('tag.sep') + leaf });
      var own = d.tagOptions[it.main] || [];
      if (own.length) h += '<div class="txt mt">' + te('mg.moveSubsFollow', { name: it.main, dest: dest, list: own.join(', ') }) + '</div>';
      own.forEach(function (s) { if (have.indexOf(s) >= 0 || s === leaf) merge.push(q(dest + t('tag.sep') + s)); });
    }
  }
  h = '<div class="txt">' + h + '</div>';
  if (merge.length) h += '<div class="warnb">' + te('mg.moveMerge', { list: merge.join(', ') }) + '</div>';
  var n = useOf(d.usage, it);
  if (n) h += '<div class="sub mt">' + t('mg.moveUse', { n: n }) + '</div>';
  return h;
}

/** เนื้อหาใน sheet ของแท็กตามโหมด คืน [หัวเรื่อง, html] */
function mgSheet(d) {
  var it = mg.it, h = '', title = '';
  var cur = it.isMain ? it.main : it.sub;
  if (mg.mode === 'edit') {
    title = t('mg.editTitle');
    var par = mg.parent, ph = '<select id="mgpar" data-title="' + esc(t('mg.parent')) + '" onchange="mgParSet(this.value)">' + opt('', t('mg.asMain'), par);
    d.tags.forEach(function (m) { if (!(it.isMain && m === it.main)) ph += opt(m, m, par); });
    h += fld(t('mg.name'), mgInput('', mg.draft != null ? mg.draft : cur)) + fld(t('mg.parent'), ph + '</select>');
    h += btns('pri', 'mgEditGo', t('mg.save'), 'mg');
  } else if (mg.mode === 'merge') {
    title = t('mg.editTitle');
    h += '<div class="txt">' + te('mg.mergeMsg', { draft: mg.draft, name: it.full, target: mg.target, count: mg.count }) + '</div>';
    h += btns('dng', 'mgMergeGo', t('mg.mergeGo'), 'mg');
  } else if (mg.mode === 'move') {
    title = t('mg.moveTitle');
    h += moveMsg(d, it, mg.parent, String(mg.draft || '').trim() || cur);
    h += btns('pri', 'mgMoveGo', t('mg.moveGo'), 'mg');
  } else if (mg.mode === 'addsub') {
    title = te('mg.addSubTo', { main: it.main });
    h += fld(t('mg.subName'), mgInput('', mg.draft || ''));
    h += btns('pri', 'mgAddSubGo', t('mg.add'), 'mg');
  } else if (mg.mode === 'addmain') {
    title = t('mg.addMainTitle');
    h += fld(t('mg.name'), mgInput('', mg.draft || ''));
    h += btns('pri', 'mgAddMain', t('mg.add'), 'mg');
  } else if (mg.mode === 'delete') {
    title = t('mg.delTitle');
    var nTx = useOf(d.usage, it), nRu = useOf(d.ruleUsage, it);
    h += '<div class="txt">' + te('mg.delAsk', { name: it.full }) + (it.isMain ? t('mg.delSubs') : '') + '</div>';
    if (nTx + nRu > 0) {
      h += '<div class="sub mt">' + t('mg.delUse', { tx: nTx, rules: nRu ? t('mg.delRules', { n: nRu }) : '' }) + '</div>';
      var s = '<select id="mgmv" data-title="' + esc(t('mg.moveTo')) + '" onchange="mgMvSet(this.value)">' + opt('', t('mg.moveNone'), mg.mv);
      d.tags.forEach(function (m) {
        if (!inSetOf(it, m)) s += opt(m, m, mg.mv);
        (d.tagOptions[m] || []).forEach(function (x) {
          var f = m + '/' + x;
          if (!inSetOf(it, f)) s += opt(f, m + t('tag.sep') + x, mg.mv);
        });
      });
      h += fld(t('mg.moveTo'), s + opt('ข้าม', t('tag.skip'), mg.mv) + '</select>' + (nRu ? '<div class="sub hint">' + t('mg.moveNoneRules') + '</div>' : ''));
    }
    h += btns('dng', 'mgDelGo', t('mg.delGo'), 'mg');
  }
  if (mgErr) h += '<div class="err">' + esc(mgErr) + '</div>';
  return [title, h];
}

function mgInner(d) {
  MGL = [];
  var dis = sbAny() ? ' disabled' : '';
  var h = '<h2>' + t('mg.title') + '</h2><div class="sub">' + t('mg.hint') + '</div>';
  d.tags.forEach(function (m) {
    var im = MGL.length;
    MGL.push({ full: m, main: m, sub: '', isMain: true });
    h += mgRow(d, im);
    (d.tagOptions[m] || []).forEach(function (s) {
      var is = MGL.length;
      MGL.push({ full: m + '/' + s, main: m, sub: s, isMain: false });
      h += mgRow(d, is);
    });
  });
  h += '<button type="button" class="addlong"' + dis + ' onclick="mgAddMainOpen()"><i class="ic ic-add"></i>' + t('mg.addMainLong') + '</button>';
  return h;
}

function renderMg() {
  var b = $('mgbox');
  if (!b || !DATA) return;
  b.innerHTML = icons(mgInner(DATA));
  enhance(b); flashIn(b);
  if (FS === 'mg') renderFs();
}

function mgOpen(it, mode) {
  mg = { it: it, mode: mode, draft: null, parent: it && !it.isMain ? it.main : '', mv: '', target: '', count: 0 }; mgErr = '';
  fsShow('mg');
}
function mgRenameOpen(i) { mgOpen(MGL[i], 'edit'); }
function mgAddSubOpen(i) { mgOpen(MGL[i], 'addsub'); }
function mgDelOpen(i) { mgOpen(MGL[i], 'delete'); }
function mgAddMainOpen() { mgOpen({ full: '', main: '', sub: '', isMain: true }, 'addmain'); }
function mgDraft(v) { if (mg) mg.draft = v; }
function mgParSet(v) { if (mg) mg.parent = v; }
function mgMvSet(v) { if (mg) mg.mv = v; }
function mgCancel() { fsHide(function () { mg = null; mgErr = ''; }); }
function mgDone(k) { fsHide(function () { mg = null; mgErr = ''; if (k) flashK = 't:' + k; renderMg(); load(); }); }

/** เรียก API ของส่วนแท็ก: ปุ่มหมุน → ✓ → ปิด sheet; พลาด = toast และ sheet ค้างไว้ */
function mgRun(name, args, done) {
  var id = 'mg';
  SB[id] = 'busy'; mgErr = ''; renderMg();
  api(name, args).then(function (res) {
    if (res && res.needConfirm) { delete SB[id]; done(res); return; }
    SB[id] = 'done'; buzz(); renderMg();
    setTimeout(function () { delete SB[id]; done(res); }, 550);
  }, function (e) {
    delete SB[id];
    if (!guard(e)) { toast(errMsg(e)); renderMg(); }
  });
}

function renamed(it, draft) { draft = String(draft || '').trim(); return it.isMain ? draft : it.main + '/' + draft; }
function mgIn() { var el = $('mgin'); return el ? el.value : ''; }

/** บันทึกจาก sheet แก้ไข: ที่อยู่ไม่เปลี่ยน = เปลี่ยนชื่อ, เปลี่ยน = ไปหน้ายืนยันการย้ายก่อน */
function mgEditGo() {
  var it = mg.it, dr = mg.draft = mgIn(), par = mg.parent, curPar = it.isMain ? '' : it.main;
  if (par !== curPar) { mg.mode = 'move'; renderFs(); return; }
  mgRun('renameTag', [it.full, dr, false], function (r) {
    if (r && r.needConfirm) { if (mg) { mg.mode = 'merge'; mg.count = r.count; mg.target = r.target; } renderMg(); return; }
    mgDone(renamed(it, dr));
  });
}
function mgMoveGo() {
  var it = mg.it, par = mg.parent, leaf = String(mg.draft || '').trim() || (it.isMain ? it.main : it.sub);
  mgRun('moveTag', [it.full, par, leaf], function () { mgDone(par ? par + '/' + leaf : leaf); });
}
function mgMergeGo() {
  var it = mg.it, dr = mg.draft;
  mgRun('renameTag', [it.full, dr, true], function () { mgDone(renamed(it, dr)); });
}
function mgAddSubGo() {
  var it = mg.it, dr = mg.draft = mgIn();
  mgRun('addSubTag', [it.main, dr], function () { mgDone(it.main + '/' + String(dr).trim()); });
}
function mgDelGo() {
  var it = mg.it;
  mgRun('deleteTag', [it.full, mg.mv || ''], function () { mgDone(); });
}
function mgAddMain() {
  var dr = mg.draft = mgIn();
  mgRun('addMainTag', [dr], function () { mgDone(String(dr).trim()); });
}
window.mgRenameOpen = mgRenameOpen; window.mgAddSubOpen = mgAddSubOpen; window.mgDelOpen = mgDelOpen; window.mgAddMainOpen = mgAddMainOpen;
window.mgDraft = mgDraft; window.mgParSet = mgParSet; window.mgMvSet = mgMvSet; window.mgEditGo = mgEditGo; window.mgMoveGo = mgMoveGo;
window.mgMergeGo = mgMergeGo; window.mgAddSubGo = mgAddSubGo; window.mgDelGo = mgDelGo; window.mgAddMain = mgAddMain;

/* ----- sheet ฟอร์มกลาง (แท็ก / บัญชีและบัตร) ----- */

var FS = '';   // '' | 'mg' | 'acc' | 'accadd'
function renderFs() {
  if (!FS || !DATA) return;
  var r = FS === 'mg' && mg ? mgSheet(DATA) : (FS === 'acc' && acc ? accSheet(DATA) : (FS === 'accadd' ? accAddSheet() : (FS === 'cy' ? cySheet() : (FS === 'cp' ? cpSheet() : ['', '']))));
  $('fsTitle').textContent = r[0];
  $('fsBody').innerHTML = icons(r[1]);
  enhance($('fsBody'));
}
function fsShow(kind) {
  FS = kind; renderFs(); sheetOpen('fsheet');
  var el = $('fsBody').querySelector('input');
  if (el) { try { el.focus({ preventScroll: true }); } catch (e) { el.focus(); } }
}
function fsHide(cb) {
  var a = document.activeElement; if (a && a.blur) a.blur();
  sheetClose('fsheet', function () { FS = ''; $('fsBody').innerHTML = ''; if (cb) cb(); });
}
function fsCancel() {
  if (sbAny()) return;
  if (FS === 'mg') mgCancel(); else if (FS === 'acc') accCancel(); else if (FS === 'accadd') accAddClose(); else fsHide(function () { accDraft = {}; });
}
window.fsCancel = fsCancel;
$('fsClose').onclick = fsCancel; $('fsbg').onclick = fsCancel;

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
  var h = '<section class="card"><div class="chead"><h2>' + t('cat.title') + '</h2><span class="ctl"><button class="rb' + (catSubs ? ' on' : '') + '" onclick="toggleSubs()" aria-pressed="' + catSubs + '" aria-label="' + esc(t('cat.subs')) + '"><i class="ic ic-subs"></i></button><button class="rb" onclick="toggleCat()" aria-label="' + esc(t('cat.toggle')) + '">' + (catAmt ? '฿' : '%') + '</button></span></div>';
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
    + '<div class="foot"><div class="bar cpb"><i style="width:' + pct.toFixed(1) + '%"></i></div>'
    + '<div class="cp"><span>' + money(s.prev) + '</span><span>' + money(s.next) + '</span></div></div></div>';
}

function cashTile(d) {
  var k = d.cash, p = d.total.total > 0 ? Math.max(0, Math.min(100, k.total / d.total.total * 100)) : 0;
  return '<button type="button" class="card cashtile" onclick="openCash()" aria-label="' + esc(t('cash.add')) + '"><div class="lab">' + esc(t('card.cash')) + '</div><div class="num">' + money(k.total) + '</div>'
    + '<div class="foot"><div class="bar c"><i style="width:' + p.toFixed(1) + '%"></i></div>'
    + '<div class="cp"><span>' + p.toFixed(0) + '%</span></div></div></button>';
}
function openCash() { sheetOpen('sheet'); cashMsg(''); }
function closeCash(cb) { sheetClose('sheet', cb); }
window.openCash = openCash;

/* ----- sheet เลือกวันเวลาของเงินสด: ปุ่มลัด วันนี้/เมื่อวาน + ปฏิทินรายเดือน + ช่องเวลา ค่าที่ส่ง = 'yyyy-MM-ddTHH:mm' (เวลาไทย) หรือว่าง = ตอนนี้ ----- */

var fParts = new Intl.DateTimeFormat('en-GB', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false, timeZone: BK });
var fMonth = new Intl.DateTimeFormat('th-TH', { month: 'long', year: 'numeric', timeZone: BK });
function bkNow(ms) {
  var o = {};
  fParts.formatToParts(new Date(ms == null ? Date.now() : ms)).forEach(function (p) { o[p.type] = p.value; });
  return { y: Number(o.year), m: Number(o.month), d: Number(o.day), hh: o.hour === '24' ? '00' : o.hour, mm: o.minute };
}
function ymd(y, m, d) { return y + '-' + (m < 10 ? '0' : '') + m + '-' + (d < 10 ? '0' : '') + d; }
function whenMs(v) { return new Date(v + ':00+07:00').getTime(); }
function whenSet(v) {
  cWhen = v || '';
  var b = $('cwhen');
  b.className = 'selbtn whenbtn' + (cWhen ? '' : ' ph');
  b.innerHTML = '<span>' + esc(cWhen ? t('cash.when') + ' · ' + fDT.format(new Date(whenMs(cWhen))) : t('cash.whenNow')) + '</span><i class="ic ic-calendar"></i>';
}
var DS = null;
function dsOpen() {
  var n = bkNow();
  if (cWhen) {
    var p = cWhen.split('T'), d = p[0].split('-');
    DS = { y: Number(d[0]), m: Number(d[1]), sel: p[0], hh: p[1].slice(0, 2), mm: p[1].slice(3, 5) };
  } else DS = { y: n.y, m: n.m, sel: ymd(n.y, n.m, n.d), hh: n.hh, mm: n.mm };
  dsRender(); sheetOpen('dsheet');
}
function dsRender() {
  var n = bkNow(), today = ymd(n.y, n.m, n.d), yd = bkNow(Date.now() - 86400000), yest = ymd(yd.y, yd.m, yd.d);
  var h = '<div class="chips dchips"><button type="button" class="chip' + (DS.sel === today ? ' on' : '') + '" onclick="dsPick(\'' + today + '\')">' + t('date.today') + '</button>'
    + '<button type="button" class="chip' + (DS.sel === yest ? ' on' : '') + '" onclick="dsPick(\'' + yest + '\')">' + t('date.yesterday') + '</button></div>';
  var last = DS.y > n.y || (DS.y === n.y && DS.m >= n.m);
  h += '<div class="calh"><button type="button" class="mb ib" onclick="dsMon(-1)" aria-label="' + esc(t('top.prev')) + '"><i class="ic ic-prev"></i></button><b>'
    + esc(fMonth.format(new Date(Date.UTC(DS.y, DS.m - 1, 15)))) + '</b><button type="button" class="mb ib"' + (last ? ' disabled' : '') + ' onclick="dsMon(1)" aria-label="' + esc(t('top.next')) + '"><i class="ic ic-next"></i></button></div>';
  h += '<div class="cal">';
  t('date.days').split(',').forEach(function (w) { h += '<span class="calw">' + w + '</span>'; });
  var first = new Date(Date.UTC(DS.y, DS.m - 1, 1)).getUTCDay(), dim = new Date(Date.UTC(DS.y, DS.m, 0)).getUTCDate(), i;
  for (i = 0; i < first; i++) h += '<span></span>';
  for (i = 1; i <= dim; i++) {
    var k = ymd(DS.y, DS.m, i), fut = k > today;
    h += '<button type="button" class="cald' + (k === DS.sel ? ' on' : '') + (k === today ? ' now' : '') + '"' + (fut ? ' disabled' : '') + ' onclick="dsPick(\'' + k + '\')">' + i + '</button>';
  }
  h += '</div>';
  h += fld(t('date.time'), '<div class="timef"><input id="dsH" inputmode="numeric" maxlength="2" autocomplete="off" value="' + esc(DS.hh) + '" oninput="dsT(\'hh\',this.value)"><b>:</b><input id="dsM" inputmode="numeric" maxlength="2" autocomplete="off" value="' + esc(DS.mm) + '" oninput="dsT(\'mm\',this.value)"></div>');
  h += '<div class="btns"><button type="button" onclick="dsNow()">' + t('date.now') + '</button><button type="button" class="pri" onclick="dsOk()">' + t('date.ok') + '</button></div>';
  $('dsBody').innerHTML = icons(h);
}
function dsPick(k) { DS.sel = k; var p = k.split('-'); DS.y = Number(p[0]); DS.m = Number(p[1]); dsRender(); }
function dsMon(n) { DS.m += n; if (DS.m < 1) { DS.m = 12; DS.y--; } if (DS.m > 12) { DS.m = 1; DS.y++; } dsRender(); }
function dsT(k, v) { DS[k] = String(v).replace(/\D/g, '').slice(0, 2); }
function dsClose() { var a = document.activeElement; if (a && a.blur) a.blur(); sheetClose('dsheet'); }
function dsNow() { whenSet(''); dsClose(); }
function dsOk() {
  var hh = Number(DS.hh), mm = Number(DS.mm);
  if (DS.hh === '' || DS.mm === '' || !(hh >= 0 && hh <= 23) || !(mm >= 0 && mm <= 59)) { toast(t('date.badTime')); return; }
  var v = DS.sel + 'T' + (hh < 10 ? '0' : '') + hh + ':' + (mm < 10 ? '0' : '') + mm;
  if (whenMs(v) - Date.now() > 60000) { toast(t('date.future')); return; }
  whenSet(v); dsClose();
}
window.dsPick = dsPick; window.dsMon = dsMon; window.dsT = dsT; window.dsNow = dsNow; window.dsOk = dsOk;
$('cwhen').onclick = dsOpen; $('dsClose').onclick = dsClose; $('dsbg').onclick = dsClose;

function suggestBlock(d) {
  if (!d.suggest || !d.suggest.length) return '';
  var h = '<section class="card"><h2>' + t('suggest.title') + '</h2>';
  d.suggest.forEach(function (s) {
    h += '<div class="sg"><div class="gh"><span>' + t('suggest.in', { amount: money(s.amount) }) + '</span><span class="sub">🏦 ' + esc(acctFmt('bank', s.ref)) + '</span></div>';
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
  var h = '<section class="card tap inhero" role="button" tabindex="0" onclick="openOv(\'in\')" aria-label="' + esc(t('ov.open')) + '"><i class="ic ic-next go"></i><div class="lab">' + t('income.label') + '</div><div class="big">' + money(n.total) + '<span>' + t('unit.baht') + '</span></div><div class="split">';
  h += '<div class="mini n"><div class="lab">' + t('income.account') + '</div><div class="num">' + money(n.account) + '</div><div class="sub">' + t('income.count', { n: n.accountCount }) + '</div></div>';
  h += '<div class="mini n"><div class="lab">' + t('income.cash') + '</div><div class="num">' + money(n.cash) + '</div><div class="sub">' + t('income.count', { n: n.cashCount }) + '</div></div>';
  h += '<div class="mini k"><div class="lab">' + t('income.card') + '</div><div class="num">' + money(n.card) + '</div>';
  h += '<div class="sub">' + t('income.cardNote', { n: n.cardCount }) + '</div></div>';
  return h + '</div></section>';
}

/* ----- เรียงรายการล่าสุด: new = ล่าสุด, desc = ยอดมากไปน้อย, asc = ยอดน้อยไปมาก (จำในเครื่อง ใช้ทั้งหน้าหลักและหน้าลงลึก) ----- */
var RSORT = { new: 'sort.new', desc: 'sort.desc', asc: 'sort.asc' };
var RTITLE = { new: 'recent.title', desc: 'recent.titleDesc', asc: 'recent.titleAsc' };   // หัวการ์ดเปลี่ยนตามการเรียง
var rsort = RSORT[lsGet('jotjor_sort')] ? lsGet('jotjor_sort') : 'new';
function sortList(list) {
  if (rsort === 'new') return list;
  var k = rsort === 'desc' ? -1 : 1;
  return list.slice().sort(function (a, b) { return (a.amount - b.amount) * k || b.at - a.at; });
}
function sortOpen() {
  var h = '';
  Object.keys(RSORT).forEach(function (k) {
    var on = k === rsort;
    h += '<button type="button" class="pko' + (on ? ' on' : '') + '" onclick="sortSet(\'' + k + '\')"><span>' + t(RSORT[k]) + '</span>' + (on ? '<i class="ic ic-check"></i>' : '') + '</button>';
  });
  PK = null;
  $('pkTitle').textContent = t('sort.title');
  $('pkList').innerHTML = h;
  sheetOpen('picker');
}
function sortSet(k) {
  sheetClose('picker');
  if (k === rsort || !RSORT[k]) return;
  rsort = k; lsSet('jotjor_sort', k);
  recentPage.out = 0; recentPage.in = 0; ST.page = 0;
  if (DATA) render();
  if (view === 'stream') renderStream();
}
window.sortOpen = sortOpen; window.sortSet = sortSet;

function recentBlock(d, mode) {
  var list = sortList(d.recent.filter(function (x) { return mode === 'in' ? x.dir === 'in' : (x.dir === 'out' || x.stream === 'credit'); }));   // หน้ารายจ่ายรวมเงินคืนบัตรที่หักยอด
  var pages = Math.max(1, Math.ceil(list.length / 5));
  recentPage[mode] = Math.min(recentPage[mode], pages - 1);
  return recentList(d, list, recentPage[mode], 5, 'recentGo');
}

/** การ์ดรายการล่าสุด (ใช้ทั้งหน้าหลักและหน้าลงลึก) d = ข้อมูลหน้าหลัก ใช้รายชื่อแท็ก, goFn = ชื่อฟังก์ชันเปลี่ยนหน้า */
function recentList(d, list, page, PER, goFn) {
  var h = '<section class="card"><div class="chead"><h2>' + t(RTITLE[rsort]) + '</h2><span class="ctl"><button class="rb" onclick="sortOpen()" aria-label="' + esc(t('sort.title') + ': ' + t(RSORT[rsort])) + '"><i class="ic ic-sort"></i></button></span></div>';
  var shown = 0, pages = Math.max(1, Math.ceil(list.length / PER));
  list.slice(page * PER, page * PER + PER).forEach(function (x) {
    var spend = x.dir === 'out';
    var refund = x.stream === 'credit' && !spend;
    shown++;
    var nm = x.merchant || (x.stream === 'credit' ? t(refund ? 'recent.creditRefund' : 'recent.creditName')
      : (x.stream === 'cash' ? t('recent.cashName') : (spend ? t('recent.outName') : t(x.linked ? 'recent.refundIn' : 'recent.in'))));
    var who = x.stream === 'cash' ? t('recent.whoCash') : te(x.stream === 'credit' ? 'recent.whoCard' : 'recent.whoAcct', { ref: acctFmt(x.stream === 'credit' ? 'credit' : 'bank', x.ref) });
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
  if (pages > 1) h += '<div class="pg"><button' + (page <= 0 ? ' disabled' : '') + ' onclick="' + goFn + '(-1)">&#8249; ' + t(rsort === 'new' ? 'pg.prev' : 'pg.prevAny') + '</button><span class="sub">' + t('pg.page', { p: page + 1, n: pages }) + '</span><button' + (page >= pages - 1 ? ' disabled' : '') + ' onclick="' + goFn + '(1)">' + t(rsort === 'new' ? 'pg.next' : 'pg.nextAny') + ' &#8250;</button></div>';
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
  var k = credit ? 'credit' : 'bank';
  if (g.name) return g.name + (g.last4 ? ' ' + acctFmt(k, g.last4) : '');
  return g.last4 ? t(credit ? 'drill.cardRef' : 'drill.acctRef', { ref: acctFmt(k, g.last4) }) : t('drill.noRef');
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
  var h = '<section class="card"><div class="chead"><h2>' + t(credit ? 'drill.shareCredit' : 'drill.shareTransfer') + '</h2><span class="ctl"><button class="rb" onclick="toggleCat()" aria-label="' + esc(t('cat.toggle')) + '">' + (catAmt ? '฿' : '%') + '</button></span></div>';
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

  var list = sortList(sd.list.filter(function (x) { return (x.dir === 'out' || x.stream === 'credit') && (!ST.acct || x.acct === ST.acct); }));
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

/* รูปแบบเลขบัญชี/บัตรทุกที่ในแอป: บัญชี XXX-X-XXXXX-X (4 หลักที่เก็บคือหลักที่ 6-9 ตามแจ้งเตือน KBank), บัตร XXXX-XXXX-XXXX-XXXX (4 หลักท้าย) */
var NUM_GROUPS = { bank: [3, 1, 5, 1], credit: [4, 4, 4, 4] };
function acctFmt(kind, last4) {
  var k = String(last4 == null ? '' : last4);
  if (!/^\d{4}$/.test(k)) return k ? 'x' + k : '';
  return kind === 'bank' ? 'XXX-X-X' + k + '-X' : 'XXXX-XXXX-XXXX-' + k;
}
/** จัดรูปแบบตอนพิมพ์: ใส่ขีดตามกลุ่มหลัก ตัดหลักที่เกิน */
function numGroup(kind, v) {
  var dg = String(v || '').replace(/\D/g, ''), g = NUM_GROUPS[kind === 'bank' ? 'bank' : 'credit'], out = [], i = 0;
  g.forEach(function (n) { if (i < dg.length) { out.push(dg.slice(i, i + n)); i += n; } });
  return out.join('-');
}
function numInput(el, kind) {
  var f = numGroup(kind, el.value);
  if (f !== el.value) el.value = f;
  accDraftSet(el);
}
window.numInput = numInput;

function kindLabel(k) { return t(k === 'credit' ? 'acc.credit' : 'acc.bank'); }
function dv(id, def) { return accDraft[id] != null ? accDraft[id] : (def == null ? '' : def); }
function accDraftSet(el) { accDraft[el.id] = el.value; }
window.accDraftSet = accDraftSet;
function accInput(id, ph, attrs, def) {
  attrs = attrs || '';
  return '<input id="' + id + '" ' + attrs + ' autocomplete="off" placeholder="' + esc(ph) + '" value="' + esc(dv(id, def)) + '"' + (attrs.indexOf('oninput') < 0 ? ' oninput="accDraftSet(this)"' : '') + '>';
}

function accRow(a, i) {
  var dis = sbAny() ? ' disabled' : '', credit = a.kind === 'credit';
  var h = '<div class="mgrow acrow" data-k="a:' + esc(a.kind + ':' + a.last4) + '"><span class="acic">' + (credit ? '💳' : '🏦') + '</span>'
    + '<span class="mgn"><span class="acn">' + esc(a.name || kindLabel(a.kind)) + '</span>'
    + '<span class="acm"><span class="acx">' + esc(acctFmt(a.kind, a.last4)) + '</span><span class="pill' + (credit ? ' c' : ' t') + '">' + esc(kindLabel(a.kind)) + '</span></span></span>';
  h += '<button class="mb ib"' + dis + ' onclick="accOpen(' + i + ',\'edit\')" aria-label="' + esc(t('acc.edit')) + '"><i class="ic ic-edit"></i></button>';
  h += '<button class="mb ib"' + dis + ' onclick="accOpen(' + i + ',\'del\')" aria-label="' + esc(t('mg.delete')) + '"><i class="ic ic-delete"></i></button></div>';
  return h;
}

/** sheet แก้ไข/ลบบัญชี คืน [หัวเรื่อง, html] */
function accSheet() {
  var a = acc.a;
  if (acc.mode === 'edit') {
    return [t('acc.editTitle'), fld(t('acc.name'), accInput('acName', t('acc.namePh'), 'maxlength="30"', a.name))
      + fld(t('acc.newNumLab'), accInput('acNum', acctFmt(a.kind, a.last4), 'inputmode="numeric" oninput="numInput(this,\'' + a.kind + '\')"', '') + '<div class="sub hint">' + t('acc.newNumHint') + '</div>')
      + btns('pri', 'accSave', t('mg.save'), 'acc')];
  }
  return [t('acc.delTitle'), '<div class="txt">' + te('acc.delAsk', { name: (a.name || kindLabel(a.kind)) + ' ' + acctFmt(a.kind, a.last4) }) + '</div>' + btns('dng', 'accDel', t('mg.delGo'), 'acc')];
}
function accAddSheet() {
  var credit = accKind === 'credit';
  return [t('acc.addLong'), fld(t('acc.kind'), '<select id="acKind" data-title="' + esc(t('acc.kind')) + '" onchange="accKindSet(this.value)">' + opt('credit', t('acc.credit'), accKind) + opt('bank', t('acc.bank'), accKind) + '</select>')
    + fld(t(credit ? 'acc.numCredit' : 'acc.numBank'), accInput('acNewNum', t(credit ? 'acc.numCreditPh' : 'acc.numBankPh'), 'inputmode="numeric" oninput="numInput(this,\'' + accKind + '\')"', '') + '<div class="sub hint">' + t('acc.numHint') + '</div>')
    + fld(t('acc.name'), accInput('acNewName', t('acc.namePh'), 'maxlength="30"', ''))
    + btns('pri', 'accAdd', t('mg.save'), 'accadd')];
}

function accInner(d) {
  var list = d.accounts || [], dis = sbAny() ? ' disabled' : '';
  var h = '<h2>' + t('acc.title') + '</h2><div class="sub">' + t('acc.hint') + '</div>';
  if (!list.length) h += '<div class="sub acempty">' + t('acc.empty') + '</div>';
  list.forEach(function (a, i) { h += accRow(a, i); });
  h += '<button type="button" class="addlong"' + dis + ' onclick="accAddOpen()"><i class="ic ic-add"></i>' + t('acc.addLong') + '</button>';
  return h;
}

function renderAcc() {
  var b = $('accbox');
  if (!b || !DATA) return;
  b.innerHTML = icons(accInner(DATA));
  enhance(b); flashIn(b);
  if (FS === 'acc' || FS === 'accadd') renderFs();
}

/** เรียก API ของส่วนบัญชี: ปุ่มหมุน → ✓ → ปิด sheet แล้วแถวที่เพิ่ม/แก้กะพริบ; พลาด = toast sheet ค้างไว้ */
function accRun(id, name, args, k) {
  SB[id] = 'busy'; renderAcc();
  api(name, args).then(function () {
    SB[id] = 'done'; buzz(); renderAcc();
    setTimeout(function () {
      delete SB[id];
      fsHide(function () {
        acc = null; accAdding = false; accDraft = {};
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
  acc = { i: i, a: DATA.accounts[i], mode: mode }; accAdding = false; accDraft = {};
  fsShow('acc');
}
function accCancel() { fsHide(function () { acc = null; accDraft = {}; }); }
function accAddOpen() {
  acc = null; accAdding = true; accDraft = {};
  fsShow('accadd');
}
function accAddClose() { fsHide(function () { accAdding = false; accDraft = {}; }); }
function accKindSet(k) { accKind = k === 'bank' ? 'bank' : 'credit'; if (accDraft.acNewNum) accDraft.acNewNum = numGroup(accKind, accDraft.acNewNum); renderFs(); }
function accSave() {
  var a = acc.a, num = val('acNum');
  accRun('acc', 'updateAccount', [a.row, a.last4, { name: val('acName'), number: num }], 'a:' + a.kind + ':' + (num ? last4Of(a.kind, num) : a.last4));
}
function accDel() { var a = acc.a; accRun('acc', 'deleteAccount', [a.row, a.last4], ''); }
function accAdd() {
  var p = { kind: accKind, name: val('acNewName'), number: val('acNewNum') };
  accRun('accadd', 'addAccount', [p], 'a:' + p.kind + ':' + last4Of(p.kind, p.number));
}
window.accOpen = accOpen; window.accCancel = accCancel; window.accKindSet = accKindSet; window.accAddOpen = accAddOpen; window.accAddClose = accAddClose;
window.accSave = accSave; window.accDel = accDel; window.accAdd = accAdd;

/* ---------- วันตัดรอบของทั้งแอป (ค่าเดียว) ---------- */

/* วันตัดรอบและ checkpoint: การ์ดแสดงค่า แก้ใน bottom sheet (ช่องกรอกในหน้าโดนคีย์บอร์ดบัง) */
function setRow(label, value) { return '<div class="kv"><span>' + label + '</span><b>' + value + '</b></div>'; }
function editLong(fn) { return '<button type="button" class="addlong"' + (sbAny() ? ' disabled' : '') + ' onclick="' + fn + '()"><i class="ic ic-edit"></i>' + t('acc.edit') + '</button>'; }
function renderCy() {
  var b = $('cybox');
  if (!b || !DATA) return;
  b.innerHTML = '<h2>' + t('cy.title') + '</h2><div class="sub">' + t('cy.hint') + '</div>' + setRow(t('cy.day'), t('cy.dayVal', { d: DATA.cycleDay || '' })) + editLong('cyOpen');
  if (FS === 'cy') renderFs();
}
function renderCp() {
  var b = $('cpbox');
  if (!b || !DATA) return;
  var st = DATA.steps || {};
  b.innerHTML = '<h2>' + t('settings.cp') + '</h2><div class="sub">' + t('settings.cpHint') + '</div>'
    + setRow(t('settings.cpTotal'), money(st.total)) + setRow(icons(t('card.credit')), money(st.credit)) + setRow(icons(t('card.transfer')), money(st.transfer)) + editLong('cpOpen');
  if (FS === 'cp') renderFs();
}
function cySheet() {
  return [t('cy.title'), fld(t('cy.day'), accInput('cyApp', t('cy.ph'), 'inputmode="numeric" maxlength="2"', DATA.cycleDay || '') + '<div class="sub hint">' + t('cy.hint') + '</div>') + btns('pri', 'cySave', t('mg.save'), 'cy')];
}
function cpSheet() {
  var st = DATA.steps || {}, a = 'inputmode="numeric"';
  return [t('settings.cp'), fld(t('settings.cpTotal'), accInput('stTotal', '', a, st.total || '')) + fld(icons(t('card.credit')), accInput('stCredit', '', a, st.credit || ''))
    + fld(icons(t('card.transfer')), accInput('stTransfer', '', a, st.transfer || '')) + btns('pri', 'cpSave', t('mg.save'), 'cp')];
}
function cyOpen() { accDraft = {}; fsShow('cy'); }
function cpOpen() { accDraft = {}; fsShow('cp'); }
/** บันทึกค่าตั้งหลายตัวตามลำดับ: ปุ่มหมุน → ✓ → ปิด sheet แล้วโหลดใหม่; พลาด = toast sheet ค้างไว้ */
function setRun(id, pairs) {
  var rr = function () { renderCy(); renderCp(); };
  SB[id] = 'busy'; rr();
  pairs.reduce(function (p, kv) { return p.then(function () { return api('setSetting', kv); }); }, Promise.resolve()).then(function () {
    SB[id] = 'done'; buzz(); rr();
    setTimeout(function () { delete SB[id]; fsHide(function () { accDraft = {}; animMain = true; load(); }); }, 550);
  }, function (e) {
    delete SB[id];
    if (!guard(e)) { toast(errMsg(e)); rr(); }
  });
}
function cySave() {
  var v = val('cyApp');
  if (!dayOk(v)) { toast(t('acc.badDay')); return; }
  setRun('cy', [['cycle_day', v]]);
}
function cpSave() { setRun('cp', [['step_total', val('stTotal')], ['step_credit', val('stCredit')], ['step_transfer', val('stTransfer')]]); }
window.cyOpen = cyOpen; window.cpOpen = cpOpen; window.cpSave = cpSave;
window.cySave = cySave;

/* ---------- หน้าภาพรวม: เน้นเห็นยอดใช้จ่ายเทียบรอบก่อน (ไม่ซ้ำการ์ดหน้าแรก)
 * รอบนี้ = กราฟยอดสะสมเทียบรอบก่อน ณ วันเดียวกัน (บน) + แท่งยอดรายวัน (ล่าง) ใช้แกนวันร่วมกัน คนละแกนยอด
 * รายเดือน = แท่งยอดต่อรอบ ย้อนหลัง 6 รอบ  กรองตามประเภทและหมวดหมู่ได้ ---------- */

var OV = { offset: 0, data: null, tab: 'out', mode: 'day', type: '', cat: '', sel: -1, selM: 5, m: null };
var DAY = 86400000;
var fMon = new Intl.DateTimeFormat('th-TH', { month: 'short', timeZone: BK });

function openOv(tb) {
  OV.tab = tb === 'in' ? 'in' : 'out'; OV.offset = offset; OV.data = null; OV.type = ''; OV.cat = ''; OV.sel = -1; OV.selM = 5;
  openSub('ov'); renderOv(); loadOv();
}
function loadOv(fresh) {
  var off = OV.offset;
  api('overviewData', [off, fresh === true ? 1 : 0]).then(function (d) {
    if (view !== 'ov' || off !== OV.offset) return;
    OV.data = d; renderOv();
  }, function (e) {
    if (!guard(e) && view === 'ov') $('ovapp').innerHTML = '<div class="err">' + esc(t('load.fail', { e: errMsg(e) })) + '</div>';
  });
}
function ovTab(tb) { if (OV.tab === tb) return; OV.tab = tb; OV.type = ''; OV.cat = ''; OV.sel = -1; renderOv(); }
function ovMode(m) { OV.mode = m; OV.sel = -1; OV.selM = 5; renderOv(); }
function ovType(v) { OV.type = v; renderOv(); if (!$('picker').hidden) ovFilterDraw(); }
function ovCat(v) { OV.cat = v; renderOv(); if (!$('picker').hidden) ovFilterDraw(); }
function ovCyc(n) { var o = OV.offset + n; if (o > 0) return; OV.offset = o; OV.data = null; OV.sel = -1; OV.selM = 5; renderOv(); loadOv(); }
window.openOv = openOv; window.ovMode = ovMode; window.ovType = ovType; window.ovCat = ovCat;

/** แถวที่ผ่านตัวกรอง คืน [รอบ, วัน, ยอด] */
function ovRows() {
  var d = OV.data;
  if (OV.tab === 'out') return d.ex.filter(function (r) { return (!OV.type || r[2] === OV.type) && (!OV.cat || r[3] === OV.cat); }).map(function (r) { return [r[0], r[1], r[4]]; });
  return d.inc.filter(function (r) { return !OV.type || r[2] === OV.type; }).map(function (r) { return [r[0], r[1], r[3]]; });
}
function cycLen(c) { return Math.max(1, Math.round((c.end - c.start) / DAY)); }
function ovDaily(rows, ci) {
  var n = cycLen(OV.data.cycles[ci]), a = [], i;
  for (i = 0; i < n; i++) a.push(0);
  rows.forEach(function (r) { if (r[0] === ci && r[1] >= 0 && r[1] < n) a[r[1]] += r[2]; });
  return a;
}
function cumOf(a) { var s = 0; return a.map(function (v) { s += v; return s; }); }
function niceMax(v) {
  if (!(v > 0)) return 1;
  var p = Math.pow(10, Math.floor(Math.log(v) / Math.LN10)), f = v / p;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * p;
}
function shortMoney(n) {
  var a = Math.abs(n);
  if (a >= 1e6) return (n / 1e6).toFixed(1).replace(/\.0$/, '') + 'M';
  if (a >= 1e4) return Math.round(n / 1e3) + 'k';
  if (a >= 1e3) return (n / 1e3).toFixed(1).replace(/\.0$/, '') + 'k';
  return money(n);
}
function dayLabel(c, i) { return fDay.format(new Date(c.start + i * DAY + DAY / 2)); }
/** ข้อความเทียบ: เป้าคือเตือนสติ จ่ายมากกว่ารอบก่อน = ป้ายสีเตือน */
function cmpPill(v, base) {
  if (!(base > 0)) return '';
  var p = Math.round(Math.abs(v - base) / base * 100);
  if (!p) return '<span class="pill">' + t('ov.same') + '</span>';
  var up = v > base, warn = up === (OV.tab === 'out');
  return '<span class="pill' + (warn ? ' up' : ' dn') + '">' + (up ? '▲ ' : '▼ ') + t(up ? 'ov.more' : 'ov.less', { p: p }) + '</span>';
}

/* ตัวกรองประเภท/หมวด อยู่ใน bottom sheet เดียว แตะแล้วมีผลทันที sheet ยังเปิดอยู่จนกดตกลง */
var OVF = [];   // ตัวเลือกใน sheet ตัวกรอง [ชนิด, ค่า] อ้างด้วยลำดับ (ชื่อหมวดอาจมีอักขระพิเศษ)
function ovFilterOpen() { PK = null; ovFilterDraw(); sheetOpen('picker'); }
function ovPick(i) { var o = OVF[i]; if (!o) return; if (o[0] === 'type') ovType(o[1]); else ovCat(o[1]); }
window.ovPick = ovPick;
function ovFilterDraw() {
  OVF = [];
  function one(fn, v, label, cur) {
    var on = v === cur;
    OVF.push([fn === 'ovType' ? 'type' : 'cat', v]);
    return '<button type="button" class="pko' + (on ? ' on' : '') + '" onclick="ovPick(' + (OVF.length - 1) + ')"><span>' + esc(label) + '</span>' + (on ? '<i class="ic ic-check"></i>' : '') + '</button>';
  }
  var o = OV.tab === 'out' ? [['c', 'ov.tCredit'], ['t', 'ov.tTransfer'], ['k', 'ov.tCash']] : [['a', 'ov.tAccount'], ['k', 'ov.tCashIn'], ['c', 'ov.tCard']];
  var h = '<div class="pkg">' + t('ov.type') + '</div>' + one('ovType', '', t('ov.all'), OV.type);
  o.forEach(function (x) { h += one('ovType', x[0], t(x[1]), OV.type); });
  if (OV.tab === 'out' && OV.data) {
    var names = OV.data.tags.slice();
    OV.data.ex.forEach(function (r) { if (names.indexOf(r[3]) < 0) names.push(r[3]); });
    h += '<div class="pkg">' + t('ov.cat') + '</div>' + one('ovCat', '', t('ov.all'), OV.cat);
    names.forEach(function (n) { h += one('ovCat', n, n === UNTAG ? t('tag.untagged') : n, OV.cat); });
  }
  h += '<div class="btns pkbtns"><button type="button"' + (OV.type || OV.cat ? '' : ' disabled') + ' onclick="ovClear()">' + t('ov.clear') + '</button><button type="button" class="pri" onclick="ovFilterDone()">' + t('ov.done') + '</button></div>';
  $('pkTitle').textContent = t('ov.filter');
  var sc = $('pkList').scrollTop;
  $('pkList').innerHTML = h;
  $('pkList').scrollTop = sc;
}
function ovClear() { OV.type = ''; OV.cat = ''; renderOv(); ovFilterDraw(); }
function ovFilterDone() { sheetClose('picker'); }
window.ovFilterOpen = ovFilterOpen; window.ovClear = ovClear; window.ovFilterDone = ovFilterDone;

function renderOv() {
  $('ovOut').className = OV.tab === 'out' ? 'on' : ''; $('ovIn').className = OV.tab === 'in' ? 'on' : '';
  $('ovnext').disabled = OV.offset >= 0;
  var d = OV.data;
  if (!d) {
    $('ovcyc').innerHTML = '&nbsp;'; $('ovupd').innerHTML = '&nbsp;';
    $('ovapp').innerHTML = '<div class="skel"><i class="sk"></i><i class="sk h"></i></div>';
    return;
  }
  var c = d.cycles[d.cycles.length - 1];
  $('ovcyc').textContent = range(c.start, c.end) + (OV.offset === 0 ? t('top.current') : '');
  $('ovupd').textContent = t('top.updated', { time: fT.format(new Date(d.now)) });
  var on = !!(OV.type || OV.cat);
  var h = '<div class="ovbar"><div class="mseg"><button type="button" class="' + (OV.mode === 'day' ? 'on' : '') + '" onclick="ovMode(\'day\')">' + t('ov.day') + '</button>'
    + '<button type="button" class="' + (OV.mode === 'month' ? 'on' : '') + '" onclick="ovMode(\'month\')">' + t('ov.month') + '</button></div>'
    + '<button type="button" class="rb fbtn' + (on ? ' on' : '') + '" onclick="ovFilterOpen()" aria-label="' + esc(t('ov.filter')) + '"><i class="ic ic-funnel"></i></button></div>';
  h += '<section class="card">' + (OV.mode === 'day' ? ovDayHead() : ovMonthHead()) + '<div id="ovchart" class="ovchart"></div><div id="ovinfo" class="sub ovinfo"></div></section>';
  $('ovapp').innerHTML = icons(h);
  enhance($('ovapp'));
  ovDraw();
  var el = $('ovchart');
  el.onpointerdown = el.onpointermove = function (ev) {
    if (ev.type === 'pointermove' && !ev.buttons && ev.pointerType !== 'mouse') return;
    var r = el.getBoundingClientRect(), m = OV.m;
    if (!m || !r.width) return;
    var i = Math.max(0, Math.min(m.n - 1, Math.floor((ev.clientX - r.left) / r.width * m.n)));
    if (OV.mode === 'day') { if (i === OV.sel) return; OV.sel = i; } else { if (i === OV.selM) return; OV.selM = i; }
    ovDraw();
  };
}

/* ----- รอบนี้ (รายวัน) ----- */
function ovDayHead() {
  var d = OV.data, rows = ovRows(), L = d.cycles.length;
  var cur = ovDaily(rows, L - 1), prv = ovDaily(rows, L - 2), cc = cumOf(cur), pc = cumOf(prv), n = cur.length;
  var c = d.cycles[L - 1], ti = d.now < c.end ? Math.max(0, Math.min(n - 1, Math.floor((d.now - c.start) / DAY))) : n - 1;
  var v = cc[ti], base = pc.length ? pc[Math.min(ti, pc.length - 1)] : 0;
  OV.m = { n: n, cur: cur, cc: cc, pc: pc, ti: ti, c: c };
  var h = '<div class="lab">' + t(OV.tab === 'out' ? 'ov.spent' : 'ov.got') + '</div><div class="big ovbig">' + money(v) + '<span>' + t('unit.baht') + '</span></div>';
  h += '<div class="ovcmp sub">' + (base > 0 ? t('ov.vsPrev', { n: money(base) }) + ' ' + cmpPill(v, base) : t('ov.noPrev')) + '</div>';
  if (!rows.length) h += '<div class="sub mt">' + t('ov.empty') + '</div>';
  return h + '<div class="lg' + (OV.tab === 'in' ? ' inlg' : '') + '"><span><i class="lgl s1"></i>' + t('ov.cur') + '</span><span><i class="lgl s2"></i>' + t('ov.prev') + '</span></div>';
}
function ovDraw() {
  if (!OV.m || !$('ovchart')) return;
  if (OV.mode === 'day') ovDrawDay(); else ovDrawMonth();
}
function svgW() { var w = $('ovchart').clientWidth; return w > 100 ? w : 320; }
function ovDrawDay() {
  var m = OV.m, n = m.n, W = svgW(), H1 = 132, G = 26, H2 = 64, XL = 18, top = 4, H = top + H1 + G + H2 + XL;
  var sel = OV.sel >= 0 && OV.sel < n ? OV.sel : m.ti, step = W / n;
  var cx = function (i) { return (i + 0.5) * step; };
  var mx1 = 0, i;
  for (i = 0; i <= m.ti; i++) mx1 = Math.max(mx1, m.cc[i]);
  for (i = 0; i < Math.min(n, m.pc.length); i++) mx1 = Math.max(mx1, m.pc[i]);
  mx1 = niceMax(mx1 * 1.05);
  var y1 = function (v) { return top + H1 - Math.max(0, v) / mx1 * (H1 - 8); };
  var b2 = top + H1 + G + H2, mx2 = niceMax(Math.max.apply(null, m.cur.slice(0, m.ti + 1).concat([1])));
  var s = '<svg class="ovs' + (OV.tab === 'in' ? ' in' : '') + '" viewBox="0 0 ' + W + ' ' + H + '" width="100%" role="img" aria-label="' + esc(t('ov.cum')) + '">';
  [mx1, mx1 / 2].forEach(function (g) {
    s += '<line class="gr" x1="0" x2="' + W + '" y1="' + y1(g).toFixed(1) + '" y2="' + y1(g).toFixed(1) + '"/><text class="tx" x="0" y="' + (y1(g) - 4).toFixed(1) + '">' + shortMoney(g) + '</text>';
  });
  s += '<line class="ax" x1="0" x2="' + W + '" y1="' + y1(0) + '" y2="' + y1(0) + '"/>';
  s += '<line class="xh" x1="' + cx(sel).toFixed(1) + '" x2="' + cx(sel).toFixed(1) + '" y1="' + top + '" y2="' + b2 + '"/>';
  var pts = function (a, k) { var p = []; for (var j = 0; j < Math.min(k, a.length); j++) p.push(cx(j).toFixed(1) + ',' + y1(a[j]).toFixed(1)); return p.join(' '); };
  s += '<polyline class="s2" points="' + pts(m.pc, n) + '"/><polyline class="s1" points="' + pts(m.cc, m.ti + 1) + '"/>';
  if (sel < m.pc.length) s += '<circle class="d2" cx="' + cx(sel).toFixed(1) + '" cy="' + y1(m.pc[sel]).toFixed(1) + '" r="4"/>';
  if (sel <= m.ti) s += '<circle class="d1" cx="' + cx(sel).toFixed(1) + '" cy="' + y1(m.cc[sel]).toFixed(1) + '" r="5"/>';
  s += '<text class="tx" x="0" y="' + (top + H1 + G - 6) + '">' + t('ov.daily') + ' · ' + shortMoney(mx2) + '</text>';
  var bw = Math.max(2, step - 2), r = Math.min(3, bw / 2);
  for (i = 0; i <= m.ti; i++) {
    var v = Math.max(0, m.cur[i]); if (!v) continue;
    var bh = Math.max(r + 1, v / mx2 * (H2 - 2)), x = i * step + (step - bw) / 2;
    s += '<path class="b1' + (i === sel ? '' : ' dim') + '" d="M' + x.toFixed(1) + ',' + b2 + 'v' + (-(bh - r)).toFixed(1) + 'q0,' + (-r) + ' ' + r + ',' + (-r) + 'h' + (bw - 2 * r).toFixed(1) + 'q' + r + ',0 ' + r + ',' + r + 'v' + (bh - r).toFixed(1) + 'z"/>';
  }
  s += '<line class="ax" x1="0" x2="' + W + '" y1="' + b2 + '" y2="' + b2 + '"/>';
  [[0, 'start'], [Math.floor((n - 1) / 2), 'middle'], [n - 1, 'end']].forEach(function (p) {
    s += '<text class="tx" text-anchor="' + p[1] + '" x="' + (p[1] === 'start' ? 0 : p[1] === 'end' ? W : cx(p[0])).toFixed(1) + '" y="' + (H - 3) + '">' + esc(dayLabel(m.c, p[0])) + '</text>';
  });
  $('ovchart').innerHTML = s + '</svg>';
  $('ovinfo').textContent = sel > m.ti ? t('ov.future', { day: dayLabel(m.c, sel) })
    : t('ov.dayInfo', { day: dayLabel(m.c, sel), v: money(m.cur[sel]), cum: money(m.cc[sel]) }) + (sel < m.pc.length ? t('ov.dayInfoPrev', { cum: money(m.pc[sel]) }) : '');
}

/* ----- รายเดือน (ตามรอบ) ----- */
function ovMonthHead() {
  var d = OV.data, rows = ovRows(), L = d.cycles.length, tot = [], i;
  for (i = 0; i < L; i++) tot.push(0);
  rows.forEach(function (r) { tot[r[0]] += r[2]; });
  var prior = tot.slice(0, L - 1).filter(function (v) { return v > 0; });
  var avg = prior.length ? prior.reduce(function (a, b) { return a + b; }, 0) / prior.length : 0, v = tot[L - 1];
  OV.m = { n: L, tot: tot };
  var h = '<div class="lab">' + t(OV.tab === 'out' ? 'ov.spent' : 'ov.got') + '</div><div class="big ovbig">' + money(v) + '<span>' + t('unit.baht') + '</span></div>';
  var pill = OV.offset === 0 ? '<span class="pill">' + t(OV.tab === 'out' ? 'ov.ofAvg' : 'ov.ofAvgIn', { p: Math.round(v / avg * 100) }) + '</span>' : cmpPill(v, avg);   // รอบนี้ยังไม่จบ: บอกเป็นสัดส่วนของค่าเฉลี่ยแทนมาก/น้อยกว่า
  h += '<div class="ovcmp sub">' + (avg > 0 ? t('ov.avg', { n: money(avg) }) + ' ' + pill : t('ov.noPrev')) + '</div>';
  if (!rows.length) h += '<div class="sub mt">' + t('ov.empty') + '</div>';
  return h;
}
function ovDrawMonth() {
  var m = OV.m, d = OV.data, n = m.n, W = svgW(), H1 = 150, top = 18, XL = 20, H = top + H1 + XL, step = W / n;
  var mx = niceMax(Math.max.apply(null, m.tot.concat([1]))), b = top + H1, bw = Math.min(40, step * 0.62), r = 4, sel = OV.selM;
  var s = '<svg class="ovs' + (OV.tab === 'in' ? ' in' : '') + '" viewBox="0 0 ' + W + ' ' + H + '" width="100%" role="img" aria-label="' + esc(t('ov.month')) + '">';
  m.tot.forEach(function (v, i) {
    var x = i * step + (step - bw) / 2, c = d.cycles[i];
    if (v > 0) {
      var bh = Math.max(r + 1, v / mx * (H1 - 4));
      s += '<path class="b1' + (i === sel ? '' : ' dim') + '" d="M' + x.toFixed(1) + ',' + b + 'v' + (-(bh - r)).toFixed(1) + 'q0,-' + r + ' ' + r + ',-' + r + 'h' + (bw - 2 * r).toFixed(1) + 'q' + r + ',0 ' + r + ',' + r + 'v' + (bh - r).toFixed(1) + 'z"/>';
      s += '<text class="tv' + (i === sel ? ' on' : '') + '" text-anchor="middle" x="' + (x + bw / 2).toFixed(1) + '" y="' + (b - bh - 5).toFixed(1) + '">' + shortMoney(v) + '</text>';
    }
    s += '<text class="tx' + (i === sel ? ' on' : '') + '" text-anchor="middle" x="' + (x + bw / 2).toFixed(1) + '" y="' + (H - 4) + '">' + esc(fMon.format(new Date(c.end - DAY))) + '</text>';
  });
  s += '<line class="ax" x1="0" x2="' + W + '" y1="' + b + '" y2="' + b + '"/>';
  $('ovchart').innerHTML = s + '</svg>';
  var c = d.cycles[sel];
  $('ovinfo').textContent = t('ov.cycInfo', { range: range(c.start, c.end), v: money(m.tot[sel]) });
}

$('ovback').onclick = closeSub;
$('ovOut').onclick = function () { ovTab('out'); };
$('ovIn').onclick = function () { ovTab('in'); };
$('ovprev').onclick = function () { ovCyc(-1); };
$('ovnext').onclick = function () { ovCyc(1); };
window.addEventListener('resize', function () { if (view === 'ov' && OV.data) ovDraw(); });


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
  return '<div class="foot"><div class="bar cpb"><i style="width:' + pct.toFixed(1) + '%"></i></div><div class="cp"><span>' + money(prev) + '</span><span>' + money(prev + step) + '</span></div></div>';
}

/* ----- แถบย่อติดบนสุด: เลื่อนพ้นการ์ดยอดรวม (รายจ่าย) / การ์ดรายรับ แล้วโผล่ แตะแล้วกลับบนสุด ----- */
function miniHtml() {
  var d = DATA;
  if (!d) return '';
  if (tab === 'out') {
    var step = (d.steps && d.steps.total) || d.step || 10000, v = d.total.total, prev = Math.max(0, Math.floor(v / step)) * step;
    var pct = Math.max(0, Math.min(100, (v - prev) / step * 100));
    return '<div class="mrow"><span class="mlab">' + t('total.label') + '</span><b>' + money(v) + ' <small>' + t('unit.baht') + '</small></b></div>'
      + '<div class="mbar"><i style="width:' + pct.toFixed(1) + '%"></i></div>';
  }
  return '<div class="mrow"><span class="mlab">' + t('income.label') + '</span><b>' + money(d.income.total) + ' <small>' + t('unit.baht') + '</small></b></div>';
}
var miniOn = false;
function miniSync() {
  var el = $('mini'), anchor = view === 'main' && !$('main').hidden ? document.querySelector(tab === 'out' ? '#app .toprow' : '#app .inhero') : null;
  var show = !!anchor && anchor.getBoundingClientRect().bottom < 0;
  if (show === miniOn) return;
  miniOn = show;
  if (show) { el.innerHTML = miniHtml(); el.classList.remove('out'); el.hidden = false; }
  else if (RM) el.hidden = true;
  else { el.classList.add('out'); setTimeout(function () { if (!miniOn) el.hidden = true; }, 180); }
}
var miniRaf = 0;
window.addEventListener('scroll', function () { if (!miniRaf) miniRaf = requestAnimationFrame(function () { miniRaf = 0; miniSync(); }); }, { passive: true });
$('mini').onclick = function () { window.scrollTo({ top: 0, behavior: RM ? 'auto' : 'smooth' }); };

function render() {
  var d = DATA, c = d.credit, tr = d.transfer;
  if (!FS) { mg = null; mgErr = ''; }
  $('cyc').textContent = fDay.format(new Date(d.cycle.start)) + ' – ' + fDay.format(new Date(d.cycle.end - 86400000)) + (offset === 0 ? t('top.current') : '');
  $('upd').textContent = t('top.updated', { time: fT.format(new Date(d.now)) });
  $('next').disabled = offset >= 0;
  $('tabOut').className = tab === 'out' ? 'on' : ''; $('tabIn').className = tab === 'in' ? 'on' : '';
  $('tabIn').className += (d.suggest && d.suggest.length ? ' dot' : '');
  $('hold').appendChild($('topbar'));   // เก็บแถบหัวไว้ก่อน innerHTML จะล้างหน้า
  var h = '';
  if (tab === 'out') {
    h += unBar(d) + suggestBlock(d) + '<div id="topslot"></div>';
    h += '<div class="toprow"><section class="card hero tap" role="button" tabindex="0" onclick="openOv(\'out\')" aria-label="' + esc(t('ov.open')) + '"><i class="ic ic-next go"></i><div class="lab">' + t('total.label') + '</div><div class="big"><b data-n="' + Number(d.total.total) + '">' + money(d.total.total) + '</b><span>' + t('unit.baht') + '</span></div>';
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
  renderMg(); renderAcc(); if (view === 'settings') { renderCy(); renderCp(); }
  if (miniOn) $('mini').innerHTML = miniHtml();
  miniSync();
}

/* ---------- เริ่มต้น ---------- */

function applyStrings() {
  document.title = t('app.title');
  Array.prototype.forEach.call(document.querySelectorAll('[data-t]'), function (el) { el.innerHTML = icons(esc(t(el.getAttribute('data-t')))); });
  Array.prototype.forEach.call(document.querySelectorAll('[data-tw]'), function (el) {   // ข้อความยาว: ตัดบรรทัดเฉพาะที่ | ไม่ตัดกลางคำ
    el.innerHTML = t(el.getAttribute('data-tw')).split('|').map(function (x) { return '<span class="nw">' + esc(x) + '</span>'; }).join('');
  });
  Array.prototype.forEach.call(document.querySelectorAll('[data-ph]'), function (el) { el.placeholder = t(el.getAttribute('data-ph')); });
  Array.prototype.forEach.call(document.querySelectorAll('[data-aria]'), function (el) { el.setAttribute('aria-label', t(el.getAttribute('data-aria'))); });
}

function busy() { if (FS || sbAny() || !$('picker').hidden || !$('sheet').hidden || !$('dsheet').hidden) return true; var a = document.activeElement; return a && (a.tagName === 'INPUT' || a.tagName === 'SELECT'); }

applyStrings();
$('abver').textContent = APP_VER;
whenSet('');
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
  else if (view === 'ov') loadOv();
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
