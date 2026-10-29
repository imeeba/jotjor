/* Jotjor web app (GitHub Pages) — คุยกับ Apps Script ผ่าน fetch (POST text/plain = ไม่มี preflight)
 * ลิงก์ Web app และ APP_KEY เก็บใน localStorage ของเครื่องนี้เท่านั้น ไม่มีค่าใดฝังในคลัง */
(function () {
'use strict';

var LS_URL = 'jotjor_url', LS_KEY = 'jotjor_appkey', LS_CACHE = 'jotjor_cache';
var URL_RE = /^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]+\/exec$/;

var recentPage = { out: 0, in: 0 }, offset = 0, DATA = null, tab = 'out', catAmt = false, catSubs = false, unOpen = false;
var mg = null, mgErr = '', mgBusy = false, mgNew = '', MGL = [];
var cDir = 'out', cBusy = false;
var pending = 0, wgen = 0;   // จำนวนการเขียนที่ยังค้าง / ตัวนับรุ่นของการแก้ ใช้ทิ้งผลโหลดที่เก่ากว่าหน้าจอ

function $(id) { return document.getElementById(id); }
function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
/** t() สำหรับแทรกใน HTML: ค่าที่แทนเข้าไปถูก escape ให้ ส่วนข้อความในตารางเชื่อถือได้ */
function te(key, vars) {
  var v = {};
  if (vars) Object.keys(vars).forEach(function (k) { v[k] = esc(vars[k]); });
  return t(key, v);
}
function money(n, dec) {
  n = Number(n) || 0; var neg = n < 0; n = Math.abs(n);
  var d = (dec == null) ? ((Math.abs(n - Math.round(n)) > 0.004) ? 2 : 0) : dec;
  return (neg ? '-' : '') + n.toFixed(d).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}
var BK = 'Asia/Bangkok';
var fDay = new Intl.DateTimeFormat('th-TH', { day: 'numeric', month: 'short', timeZone: BK });
var fDT = new Intl.DateTimeFormat('th-TH', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false, timeZone: BK });
var fT = new Intl.DateTimeFormat('th-TH', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: BK });

function showErr(m) { var e = $('err'); e.hidden = !m; e.textContent = m || ''; }
function errMsg(e) { return e && e.message ? e.message : String(e); }

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
  $('stCredit').value = st.credit || ''; $('stTransfer').value = st.transfer || '';
  $('stMsg').textContent = '';
}
$('stSave').onclick = function () {
  var a = $('stCredit').value, b = $('stTransfer').value;
  $('stSave').disabled = true; $('stMsg').textContent = t('cash.saving');
  api('setSetting', ['step_credit', a]).then(function () { return api('setSetting', ['step_transfer', b]); }).then(function () {
    $('stSave').disabled = false; $('stMsg').textContent = t('cash.saved'); load();
  }, function (e) {
    $('stSave').disabled = false;
    if (!guard(e)) $('stMsg').textContent = t('cash.fail', { e: errMsg(e) });
  });
};
function showView(v) {
  view = v; $('main').hidden = v !== 'main'; $('settings').hidden = v !== 'settings';
  if (v === 'settings') { fillSteps(); renderMg(); window.scrollTo(0, 0); }
}
$('gear').onclick = function () { showView('settings'); };
$('setback').onclick = function () { showView('main'); };
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
  return send().then(function () {
    pending--; wgen++; load();
  }, function (e) {
    pending--; wgen++;
    if (guard(e)) return;
    DATA = JSON.parse(snap); saveCache(); render();
    if (onFail) onFail(e); else showErr(t(failMsg, { e: errMsg(e) }));
    load();
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

function setTag(row, sel) {
  var nt = sel.value;
  optimistic(function (d) { patchTag(d, row, nt); }, function () { return api('setTag', [row, nt]); }, 'tag.saveFail');
}
window.setTag = setTag;

function recentGo(n) { recentPage[tab] = Math.max(0, recentPage[tab] + n); render(); }
window.recentGo = recentGo;
function toggleCat() { catAmt = !catAmt; render(); }
function toggleSubs() { catSubs = !catSubs; render(); }
function toggleUnOpen() { unOpen = !unOpen; render(); }
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
  var p = { dir: cDir, amount: $('camt').value, merchant: $('cmer').value, when: $('cwhen').value };
  if (!(Number(String(p.amount).replace(/,/g, '')) > 0) || !DATA) {   // ยอดไม่ถูกต้อง: ให้ฝั่งชีตตอบข้อความผิดพลาดตามเดิม
    cBusy = true; $('cgo').disabled = true; cashMsg(t('cash.saving'));
    api('addCash', [p]).then(function () {
      cBusy = false; $('cgo').disabled = false;
      $('camt').value = ''; $('cmer').value = ''; $('cwhen').value = '';
      cashMsg(t('cash.saved')); closeCash(); load();
    }, function (e) {
      cBusy = false; $('cgo').disabled = false;
      if (!guard(e)) cashMsg(t('cash.fail', { e: errMsg(e) }));
    });
    return;
  }
  $('camt').value = ''; $('cmer').value = ''; $('cwhen').value = ''; cashMsg(''); closeCash();
  optimistic(function (d) { patchCash(d, p); }, function () { return api('addCash', [p]); }, 'cash.fail', function (e) {
    $('camt').value = p.amount; $('cmer').value = p.merchant; $('cwhen').value = p.when;   // คืนค่าที่กรอกไว้ให้แก้แล้วกดใหม่
    openCash(); cashMsg(t('cash.fail', { e: errMsg(e) }));
  });
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
  var it = MGL[i], dis = mgBusy ? ' disabled' : '';
  var h = '<div class="mgrow' + (it.isMain ? '' : ' s') + '"><span class="mgn">' + (it.isMain ? '' : '&#8627; ') + esc(it.isMain ? it.main : it.sub) + '</span>';
  h += '<span class="sub">' + useOf(d.usage, it) + '</span>';
  if (it.isMain) h += '<button class="mb mba"' + dis + ' onclick="mgAddSubOpen(' + i + ')"><i class="ic ic-add"></i>' + t('mg.addSub') + '</button>';
  h += '<button class="mb ib"' + dis + ' onclick="mgRenameOpen(' + i + ')" aria-label="' + esc(t('mg.rename')) + '"><i class="ic ic-edit"></i></button>';
  h += '<button class="mb ib"' + dis + ' onclick="mgDelOpen(' + i + ')" aria-label="' + esc(t('mg.delete')) + '"><i class="ic ic-delete"></i></button></div>';
  return h;
}

function mgPanel(d, i) {
  if (!mg || mg.i !== i) return '';
  var it = MGL[i], dis = mgBusy ? ' disabled' : '';
  var cur = it.isMain ? it.main : it.sub;
  var h = '<div class="mgp">';
  if (mg.mode === 'rename') {
    h += '<div class="lab">' + te('mg.renameTo', { name: it.full }) + '</div>';
    h += '<input id="mgin" maxlength="20" value="' + esc(mg.draft != null ? mg.draft : cur) + '">';
    h += '<div class="btns"><button class="pri"' + dis + ' onclick="mgRenameGo()">' + t('mg.save') + '</button><button' + dis + ' onclick="mgCancel()">' + t('mg.cancel') + '</button></div>';
  } else if (mg.mode === 'merge') {
    h += '<div class="txt">' + te('mg.mergeMsg', { draft: mg.draft, name: it.full, target: mg.target, count: mg.count }) + '</div>';
    h += '<div class="btns"><button class="dng"' + dis + ' onclick="mgMergeGo()">' + t('mg.mergeGo') + '</button><button' + dis + ' onclick="mgCancel()">' + t('mg.cancel') + '</button></div>';
  } else if (mg.mode === 'addsub') {
    h += '<div class="lab">' + te('mg.addSubTo', { main: it.main }) + '</div>';
    h += '<input id="mgin" maxlength="20" placeholder="' + esc(t('mg.subName')) + '" value="' + esc(mg.draft || '') + '">';
    h += '<div class="btns"><button class="pri"' + dis + ' onclick="mgAddSubGo()">' + t('mg.add') + '</button><button' + dis + ' onclick="mgCancel()">' + t('mg.cancel') + '</button></div>';
  } else if (mg.mode === 'delete') {
    var nTx = useOf(d.usage, it), nRu = useOf(d.ruleUsage, it);
    h += '<div class="txt">' + te('mg.delAsk', { name: it.full }) + (it.isMain ? t('mg.delSubs') : '') + '</div>';
    if (nTx + nRu > 0) {
      h += '<div class="sub" style="margin-top:4px">' + t('mg.delUse', { tx: nTx, rules: nRu ? t('mg.delRules', { n: nRu }) : '' }) + '</div>';
      h += '<div class="lab" style="margin-top:8px">' + t('mg.moveTo') + '</div><select id="mgmv">' + opt('', t('mg.moveNone'), '');
      d.tags.forEach(function (m) {
        if (!inSetOf(it, m)) h += opt(m, m, '');
        (d.tagOptions[m] || []).forEach(function (s) {
          var f = m + '/' + s;
          if (!inSetOf(it, f)) h += opt(f, m + t('tag.sep') + s, '');
        });
      });
      h += opt('ข้าม', t('tag.skip'), '') + '</select>';
    }
    h += '<div class="btns"><button class="dng"' + dis + ' onclick="mgDelGo()">' + t('mg.delGo') + '</button><button' + dis + ' onclick="mgCancel()">' + t('mg.cancel') + '</button></div>';
  }
  if (mgErr) h += '<div class="err">' + esc(mgErr) + '</div>';
  return h + '</div>';
}

function mgInner(d) {
  MGL = [];
  var dis = mgBusy ? ' disabled' : '';
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
  h += '<div class="addrow"><input id="mgnew" maxlength="20" placeholder="' + esc(t('mg.newMain')) + '" value="' + esc(mgNew) + '"><button' + dis + ' onclick="mgAddMain()">' + t('mg.add') + '</button></div>';
  if (!mg && mgErr) h += '<div class="err">' + esc(mgErr) + '</div>';
  return h;
}

function renderMg() { var b = $('mgbox'); if (b && DATA) b.innerHTML = icons(mgInner(DATA)); }

function mgOpen(i, mode) {
  mg = { i: i, mode: mode, draft: null, target: '', count: 0 }; mgErr = '';
  renderMg();
  var el = $('mgin'); if (el) el.focus();
}
function mgRenameOpen(i) { mgOpen(i, 'rename'); }
function mgAddSubOpen(i) { mgOpen(i, 'addsub'); }
function mgDelOpen(i) { mgOpen(i, 'delete'); }
function mgCancel() { mg = null; mgErr = ''; renderMg(); }
function mgDone() { mg = null; mgErr = ''; mgNew = ''; load(); }

function mgRun(name, args, done) {
  mgBusy = true; mgErr = ''; renderMg();
  api(name, args).then(function (res) { mgBusy = false; done(res); }, function (e) {
    mgBusy = false;
    if (!guard(e)) { mgErr = errMsg(e); renderMg(); }
  });
}

function mgIn() { var el = $('mgin'); return el ? el.value : ''; }

function mgRenameGo() {
  var it = MGL[mg.i]; mg.draft = mgIn();
  mgRun('renameTag', [it.full, mg.draft, false], function (r) {
    if (r && r.needConfirm) { mg.mode = 'merge'; mg.count = r.count; mg.target = r.target; renderMg(); return; }
    mgDone();
  });
}
function mgMergeGo() {
  var it = MGL[mg.i];
  mgRun('renameTag', [it.full, mg.draft, true], function () { mgDone(); });
}
function mgAddSubGo() {
  var it = MGL[mg.i]; mg.draft = mgIn();
  mgRun('addSubTag', [it.main, mg.draft], function () { mgDone(); });
}
function mgDelGo() {
  var it = MGL[mg.i], sel = $('mgmv');
  mgRun('deleteTag', [it.full, sel ? sel.value : ''], function () { mgDone(); });
}
function mgAddMain() {
  var el = $('mgnew'); mgNew = el ? el.value : '';
  mgRun('addMainTag', [mgNew], function () { mgDone(); });
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
        h += '<div class="crow s"><span class="cn">' + esc(x || t('subs.none')) + '</span><span class="bar c"><i style="width:' + Math.max(0, Math.min(100, sp)).toFixed(1) + '%"></i></span><span class="cv">' + (catAmt ? money(v) : sp.toFixed(0) + '%') + '</span></div>';
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
    h += '<div class="item"><div class="nm">' + esc(nm) + '</div><div class="am">' + money(x.amount, 2) + '</div><div class="sub">' + fDT.format(new Date(x.at)) + '</div><div></div>'
      + '<select class="un"' + (x.row ? '' : ' disabled') + ' onchange="setTag(' + Number(x.row) + ',this)"><option value="">' + t('tag.pick') + '</option>' + tagOpts(d, '') + '</select></div>';
  });
  return h + '</section>';
}

function streamCard(cls, label, s, step) {
  var pct = Math.max(0, Math.min(100, s.progress * 100));
  return '<div class="mini ' + cls + '"><div class="lab">' + label + '</div><div class="num">' + money(s.total) + '</div>'
    + '<div class="bar cpb"><i style="width:' + pct.toFixed(1) + '%"></i></div>'
    + '<div class="cp"><span>' + money(s.prev, 0) + '</span><span>' + money(s.next, 0) + '</span></div></div>';
}

function cashTile(d) {
  var k = d.cash, p = d.total.total > 0 ? Math.max(0, Math.min(100, k.total / d.total.total * 100)) : 0;
  return '<button type="button" class="card cashtile" onclick="openCash()" aria-label="' + esc(t('cash.add')) + '"><div class="lab">' + esc(t('card.cash')) + '</div><div class="num">' + money(k.total) + '</div>'
    + '<div class="bar c" style="margin-top:10px"><i style="width:' + p.toFixed(1) + '%"></i></div>'
    + '<div class="sub" style="margin-top:6px">' + p.toFixed(0) + '%</div></button>';
}
function openCash() { $('sheet').hidden = false; cashMsg(''); }
function closeCash() { $('sheet').hidden = true; }
window.openCash = openCash;

function suggestBlock(d) {
  if (!d.suggest || !d.suggest.length) return '';
  var h = '<section class="card"><h2>' + t('suggest.title') + '</h2>';
  d.suggest.forEach(function (s) {
    h += '<div class="sg"><div class="gh"><span>' + t('suggest.in', { amount: money(s.amount, 2) }) + '</span><span class="sub">🏦 x' + esc(s.ref) + '</span></div>';
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
  var h = '<section class="card"><h2>' + t('recent.title') + '</h2>';
  var list = d.recent.filter(function (x) { return mode === 'in' ? x.dir === 'in' : (x.dir === 'out' || x.stream === 'credit'); });   // หน้ารายจ่ายรวมเงินคืนบัตรที่หักยอด
  var shown = 0, PER = 5, pages = Math.max(1, Math.ceil(list.length / PER)), page = Math.min(recentPage[mode], pages - 1);
  recentPage[mode] = page;
  list.slice(page * PER, page * PER + PER).forEach(function (x) {
    var spend = x.dir === 'out';
    var refund = x.stream === 'credit' && !spend;
    shown++;
    var nm = x.merchant || (x.stream === 'credit' ? t(refund ? 'recent.creditRefund' : 'recent.creditName')
      : (x.stream === 'cash' ? t('recent.cashName') : (spend ? t('recent.outName') : t(x.linked ? 'recent.refundIn' : 'recent.in'))));
    var who = x.stream === 'cash' ? t('recent.whoCash') : te(x.stream === 'credit' ? 'recent.whoCard' : 'recent.whoAcct', { ref: x.ref });
    h += '<div class="item"><div class="nm">' + esc(nm) + '</div><div class="am' + (spend ? '' : ' in') + '">' + (spend ? '' : '+') + money(x.amount, 2) + '</div>';
    h += '<div class="sub">' + fDT.format(new Date(x.at)) + ' &middot; ' + who + (!spend && x.tag ? ' &middot; ' + esc(x.tag) : '')
      + (refund ? ' &middot; ' + t('recent.cardRefundNote') : '') + (x.linked ? ' &middot; ' + t('recent.linkedNote') : '') + '</div><div></div>';
    if (spend || refund) {
      h += '<select class="' + (x.tag ? '' : 'un') + '"' + (x.row ? '' : ' disabled') + ' onchange="setTag(' + Number(x.row) + ',this)"><option value="">' + t('tag.pick') + '</option>';
      h += tagOpts(d, x.tag);
      h += '</select>';
    }
    h += '</div>';
  });
  if (!shown) h += '<div class="sub" style="padding:12px 0">' + t('recent.empty') + '</div>';
  if (pages > 1) h += '<div class="pg"><button' + (page <= 0 ? ' disabled' : '') + ' onclick="recentGo(-1)">&#8249; ' + t('pg.prev') + '</button><span class="sub">' + t('pg.page', { p: page + 1, n: pages }) + '</span><button' + (page >= pages - 1 ? ' disabled' : '') + ' onclick="recentGo(1)">' + t('pg.next') + ' &#8250;</button></div>';
  return h + '</section>';
}

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
    h += '<div class="toprow"><section class="card hero"><div class="lab">' + t('total.label') + '</div><div class="big">' + money(d.total.total) + '<span>' + t('unit.baht') + '</span></div>';
    h += '<div class="sub">' + t('total.today', { n: money(d.total.today) }) + '</div></section>' + cashTile(d) + '</div><div class="split">';
    h += streamCard('c', t('card.credit'), c) + streamCard('t', t('card.transfer'), tr) + '</div>';
    if (d.unknown) h += '<div class="warnb">' + t('warn.unknown', { n: d.unknown }) + '</div>';
    h += catBlock(d) + recentBlock(d, 'out');
  } else {
    h += '<div id="topslot"></div>' + suggestBlock(d) + incomeBlock(d) + recentBlock(d, 'in');
  }
  $('app').innerHTML = icons(h);
  $('topslot').appendChild($('topbar'));
  renderMg();
}

/* ---------- เริ่มต้น ---------- */

function applyStrings() {
  document.title = t('app.title');
  Array.prototype.forEach.call(document.querySelectorAll('[data-t]'), function (el) { el.innerHTML = icons(esc(t(el.getAttribute('data-t')))); });
  Array.prototype.forEach.call(document.querySelectorAll('[data-ph]'), function (el) { el.placeholder = t(el.getAttribute('data-ph')); });
  Array.prototype.forEach.call(document.querySelectorAll('[data-aria]'), function (el) { el.setAttribute('aria-label', t(el.getAttribute('data-aria'))); });
}

function busy() { if (mg || mgBusy) return true; var a = document.activeElement; return a && (a.tagName === 'INPUT' || a.tagName === 'SELECT'); }

applyStrings();
$('prev').onclick = function () { offset--; load(); };
$('next').onclick = function () { if (offset < 0) { offset++; load(); } };
$('rf').onclick = function () { load(true); };   // ปุ่มรีเฟรชข้ามแคชฝั่งเซิร์ฟเวอร์
$('cout').onclick = function () { cashDir('out'); };
$('cin').onclick = function () { cashDir('in'); };
$('cgo').onclick = cashGo;
$('cashClose').onclick = closeCash; $('sheetbg').onclick = closeCash;
$('tabOut').onclick = function () { tab = 'out'; if (DATA) render(); };
$('tabIn').onclick = function () { tab = 'in'; if (DATA) render(); };
document.addEventListener('visibilitychange', function () { if (!document.hidden && !$('main').hidden && !busy()) load(); });
setInterval(function () { if (!document.hidden && !$('main').hidden && !busy()) load(); }, 60000);

/* หน้าเว็บเองเปิดจากแคชในเครื่อง (sw.js); เมื่อมีเวอร์ชันใหม่ขึ้นปุ่มให้แตะโหลดใหม่ */
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(function () { /* ใช้ต่อได้ แค่ไม่มีแคชหน้าเว็บ */ });
  navigator.serviceWorker.addEventListener('message', function (ev) { if (ev.data === 'jotjor-updated') $('newver').hidden = false; });
}
$('newver').onclick = function () { window.location.reload(); };

if (conn.url && conn.key && URL_RE.test(conn.url)) showMain(); else showSetup('');
})();
