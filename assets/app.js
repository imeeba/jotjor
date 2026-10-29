/* Jotjor web app (GitHub Pages) — คุยกับ Apps Script ผ่าน fetch (POST text/plain = ไม่มี preflight)
 * ลิงก์ Web app และ APP_KEY เก็บใน localStorage ของเครื่องนี้เท่านั้น ไม่มีค่าใดฝังในคลัง */
(function () {
'use strict';

var LS_URL = 'jotjor_url', LS_KEY = 'jotjor_appkey';
var URL_RE = /^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]+\/exec$/;

var recentPage = 0, offset = 0, DATA = null, tab = 'out', catAmt = false, catSubs = false, unOpen = false;
var mg = null, mgErr = '', mgBusy = false, mgNew = '', MGL = [];
var cDir = 'out', cBusy = false, rBusy = false;

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
  if (e && e.auth) { showSetup(errMsg(e)); return true; }
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

function showMain() {
  $('setup').hidden = true; showView('main');
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
function showView(v) {
  view = v; $('main').hidden = v !== 'main'; $('settings').hidden = v !== 'settings';
  if (v === 'settings') { renderMg(); window.scrollTo(0, 0); }
}
$('gear').onclick = function () { showView('settings'); };
$('setback').onclick = function () { showView('main'); };
function applyTheme(th) {
  var r = document.documentElement;
  if (th === 'light' || th === 'dark') r.setAttribute('data-theme', th); else r.removeAttribute('data-theme');
  Array.prototype.forEach.call(document.querySelectorAll('#themeSeg button'), function (b) { b.className = b.getAttribute('data-th') === (th || 'system') ? 'on' : ''; });
}
Array.prototype.forEach.call(document.querySelectorAll('#themeSeg button'), function (b) {
  b.onclick = function () { var th = b.getAttribute('data-th'); lsSet('jotjor_theme', th); applyTheme(th); };
});
applyTheme(lsGet('jotjor_theme'));
$('logout').onclick = function () {
  if (!window.confirm(t('settings.confirmLogout'))) return;
  lsDel(LS_URL); lsDel(LS_KEY);
  conn = { url: '', key: '' }; DATA = null;
  showSetup('');
};

/* ---------- โหลดและแท็ก ---------- */

function load() {
  $('rf').classList.add('spin');
  api('dashData', [offset]).then(function (d) {
    DATA = d; $('rf').classList.remove('spin'); showErr(''); render();
  }, function (e) {
    $('rf').classList.remove('spin');
    if (!guard(e)) showErr(t('load.fail', { e: errMsg(e) }));
  });
}

function setTag(row, sel) {
  sel.disabled = true;
  api('setTag', [row, sel.value]).then(load, function (e) {
    sel.disabled = false;
    if (!guard(e)) showErr(t('tag.saveFail', { e: errMsg(e) }));
  });
}
window.setTag = setTag;

function recentGo(n) { recentPage = Math.max(0, recentPage + n); render(); }
window.recentGo = recentGo;
function toggleCat() { catAmt = !catAmt; render(); }
function toggleSubs() { catSubs = !catSubs; render(); }
function toggleUnOpen() { unOpen = !unOpen; render(); }
window.toggleCat = toggleCat; window.toggleSubs = toggleSubs; window.toggleUnOpen = toggleUnOpen;


/* ---------- เงินสด ---------- */

function cashDir(d) { cDir = d; $('cout').className = d === 'out' ? 'on' : ''; $('cin').className = d === 'in' ? 'on' : ''; }
function cashMsg(m) { $('cmsg').textContent = m || ''; }
function cashGo() {
  if (cBusy) return;
  cBusy = true; $('cgo').disabled = true; cashMsg(t('cash.saving'));
  api('addCash', [{ dir: cDir, amount: $('camt').value, merchant: $('cmer').value, when: $('cwhen').value }]).then(function () {
    cBusy = false; $('cgo').disabled = false;
    $('camt').value = ''; $('cmer').value = ''; $('cwhen').value = '';
    cashMsg(t('cash.saved')); closeCash(); load();
  }, function (e) {
    cBusy = false; $('cgo').disabled = false;
    if (!guard(e)) cashMsg(t('cash.fail', { e: errMsg(e) }));
  });
}

/* ---------- เงินคืน ---------- */

function refundGo(inRow, outRow, yes) {
  if (rBusy) return;
  rBusy = true; showErr('');
  (yes ? api('confirmRefund', [inRow, outRow]) : api('rejectRefund', [inRow])).then(function () {
    rBusy = false; load();
  }, function (e) {
    rBusy = false;
    if (!guard(e)) { showErr(t('save.fail', { e: errMsg(e) })); load(); }
  });
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
  if (it.isMain) h += '<button class="mb"' + dis + ' onclick="mgAddSubOpen(' + i + ')">' + t('mg.addSub') + '</button>';
  h += '<button class="mb"' + dis + ' onclick="mgRenameOpen(' + i + ')">' + t('mg.rename') + '</button>';
  h += '<button class="mb"' + dis + ' onclick="mgDelOpen(' + i + ')">' + t('mg.delete') + '</button></div>';
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

function renderMg() { var b = $('mgbox'); if (b && DATA) b.innerHTML = mgInner(DATA); }

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
      var i = tg.indexOf('/'), main = i < 0 ? tg : tg.slice(0, i), sub = i < 0 ? '' : tg.slice(i + 1);
      var m = map[main] || (map[main] = { total: 0, subs: {} });
      m.total += v; total += v;
      m.subs[sub] = (m.subs[sub] || 0) + v;
    });
  });
  var names = Object.keys(map);
  var h = '<section class="card"><div class="chead"><h2>' + t('cat.title') + '</h2><span class="ctl"><button class="mb mt' + (catSubs ? ' on' : '') + '" onclick="toggleSubs()">' + t('cat.subs') + '</button><button class="mb" onclick="toggleCat()" aria-label="' + esc(t('cat.toggle')) + '">' + (catAmt ? '฿' : '%') + '</button></span></div>';
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
      + '<select class="un" onchange="setTag(' + Number(x.row) + ',this)"><option value="">' + t('tag.pick') + '</option>' + tagOpts(d, '') + '</select></div>';
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

function recentBlock(d) {
  var h = '<section class="card"><h2>' + t('recent.title') + '</h2>';
  var shown = 0, PER = 5, pages = Math.max(1, Math.ceil(d.recent.length / PER));
  if (recentPage >= pages) recentPage = pages - 1;
  d.recent.slice(recentPage * PER, recentPage * PER + PER).forEach(function (x) {
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
      h += '<select class="' + (x.tag ? '' : 'un') + '" onchange="setTag(' + Number(x.row) + ',this)"><option value="">' + t('tag.pick') + '</option>';
      h += tagOpts(d, x.tag);
      h += '</select>';
    }
    h += '</div>';
  });
  if (!shown) h += '<div class="sub" style="padding:12px 0">' + t('recent.empty') + '</div>';
  if (pages > 1) h += '<div class="pg"><button' + (recentPage <= 0 ? ' disabled' : '') + ' onclick="recentGo(-1)">&#8249; ' + t('pg.prev') + '</button><span class="sub">' + t('pg.page', { p: recentPage + 1, n: pages }) + '</span><button' + (recentPage >= pages - 1 ? ' disabled' : '') + ' onclick="recentGo(1)">' + t('pg.next') + ' &#8250;</button></div>';
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
    h += catBlock(d) + recentBlock(d);
  } else {
    h += '<div id="topslot"></div>' + suggestBlock(d) + incomeBlock(d);
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
$('rf').onclick = load;
$('cout').onclick = function () { cashDir('out'); };
$('cin').onclick = function () { cashDir('in'); };
$('cgo').onclick = cashGo;
$('cashClose').onclick = closeCash; $('sheetbg').onclick = closeCash;
$('tabOut').onclick = function () { tab = 'out'; if (DATA) render(); };
$('tabIn').onclick = function () { tab = 'in'; if (DATA) render(); };
document.addEventListener('visibilitychange', function () { if (!document.hidden && !$('main').hidden && !busy()) load(); });
setInterval(function () { if (!document.hidden && !$('main').hidden && !busy()) load(); }, 60000);

if (conn.url && conn.key && URL_RE.test(conn.url)) showMain(); else showSetup('');
})();
