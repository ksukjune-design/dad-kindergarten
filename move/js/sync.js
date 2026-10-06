/* ============================================================
   공유 저장소 동기화 (claude.ai 공유 버전 전용)
   - GitHub Pages 처럼 window.claude 가 없는 곳에서는 아무것도 하지 않습니다 (기록은 이 브라우저에만).
   - claude.ai 에서 열면 db 기능으로 부부가 같은 기록을 보고, Claude 도 나중에 읽고 고칠 수 있습니다.

   저장 구조 (문서 경로 → 내용)
     move/meta        { moveDate, createdAt, deletedSeed, seedVersion, version }
     move/parts       { list: [파트...] }
     move/activity    { list: [최근 활동 150개] }
     move/layouts | move/planEdits | move/estimate | move/finance   { v: 해당 상태 }
     planbg/<old|new> { v: 평면도 사진 (256KiB 를 넘으면 이 기기에만) }
     items/<id>       체크 항목 하나
     inventory/<id>   짐 하나
   ui, checklistUI 같은 화면 설정은 기기마다 따로 둡니다.

   규칙: 항목·짐은 문서 하나씩이라 서로 다른 항목을 동시에 고쳐도 덮어쓰지 않습니다.
         같은 문서를 동시에 고치면 나중 저장이 이깁니다.
   ============================================================ */
(function (global) {
  'use strict';
  const S = MV.store;
  const Y = MV.sync = {
    mode: 'local',          // local | connecting | shared
    status: 'local',        // local | connecting | synced | saving | empty | readonly | offline | error
    readOnly: false,
    empty: false,
    cap: {},                // { db, user, downloads, sample } — 쓸 수 있는 것만
    lastError: null,
  };
  const SECTIONS = ['layouts', 'planEdits', 'estimate', 'finance'];
  const COLS = ['move', 'items', 'inventory', 'planbg'];
  const MAX_DOC = 250 * 1024;
  const BACKUP_KEY = 'mv:state:v1:before-share';

  let db = null;
  const last = new Map();       // 경로 → 공유 저장소에 있다고 아는 내용 (정렬된 JSON)
  const pending = new Map();    // 경로 → { body | null(삭제) }
  const inflight = new Set();
  const tooBig = new Set();
  const unsubs = [];
  let running = 0;
  let backoff = 0;
  let timer = null;
  const toasted = new Set();

  /* ---------- 도우미 ---------- */
  function canon(v) {
    if (v === null || typeof v !== 'object') return JSON.stringify(v === undefined ? null : v);
    if (Array.isArray(v)) return '[' + v.map((x) => (x === undefined ? 'null' : canon(x))).join(',') + ']';
    const keys = Object.keys(v).filter((k) => v[k] !== undefined).sort();
    return '{' + keys.map((k) => JSON.stringify(k) + ':' + canon(v[k])).join(',') + '}';
  }
  const SEG_RE = /^[A-Za-z0-9_\-.~:@+]{1,200}$/;
  const segOk = (s) => SEG_RE.test(s) && s !== '.' && s !== '..';
  function docId(id) {
    const s = String(id);
    if (segOk(s)) return s;
    let hex = '';
    try { hex = Array.from(new TextEncoder().encode(s)).map((b) => b.toString(16).padStart(2, '0')).join(''); } catch (e) { hex = String(Math.abs(hashCode(s))); }
    return ('x' + hex).slice(0, 190);
  }
  function hashCode(s) { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return h; }
  function toastOnce(key, msg) {
    if (toasted.has(key)) return;
    toasted.add(key);
    if (MV.ui && MV.ui.toast) MV.ui.toast(msg, { ms: 5000 });
  }
  function setStatus(st) {
    Y.status = st;
    renderChip();
    S.emit('sync', { status: st });
  }

  /* ---------- 상태 ↔ 문서 ---------- */
  function unitsOf(st) {
    const u = new Map();
    const meta = st.meta || {};
    u.set('move/meta', {
      moveDate: meta.moveDate || null, createdAt: meta.createdAt || null,
      deletedSeed: meta.deletedSeed || [], seedVersion: st.seedVersion || 0, version: st.version || 1,
    });
    u.set('move/parts', { list: st.parts || [] });
    u.set('move/activity', { list: (st.activity || []).slice(0, 150) });
    SECTIONS.forEach((k) => { if (st[k] !== undefined && st[k] !== null) u.set('move/' + k, { v: st[k] }); });
    if (st.planBg && typeof st.planBg === 'object') {
      Object.keys(st.planBg).forEach((pid) => { if (segOk(pid)) u.set('planbg/' + pid, { v: st.planBg[pid] === undefined ? null : st.planBg[pid] }); });
    }
    (st.items || []).forEach((it) => { if (it && it.id) u.set('items/' + docId(it.id), it); });
    (st.inventory || []).forEach((it) => { if (it && it.id) u.set('inventory/' + docId(it.id), it); });
    return u;
  }
  function replaceInPlace(target, src) {
    Object.keys(target).forEach((k) => { if (!(k in src)) delete target[k]; });
    Object.assign(target, MV.clone(src));
  }
  function applyUnit(st, path, body) {
    const slash = path.indexOf('/');
    const col = path.slice(0, slash);
    const id = path.slice(slash + 1);
    if (col === 'items' || col === 'inventory') {
      const arr = col === 'items' ? (st.items = st.items || []) : (st.inventory = st.inventory || []);
      const idx = arr.findIndex((x) => x && docId(x.id) === id);
      if (!body) { if (idx >= 0) arr.splice(idx, 1); return; }
      const clean = col === 'items' ? S.normItem(body) : S.normInv(body);
      if (idx >= 0) replaceInPlace(arr[idx], clean); else arr.push(clean);
      return;
    }
    if (col === 'planbg') {
      st.planBg = st.planBg || {};
      st.planBg[id] = body ? MV.clone(body.v === undefined ? null : body.v) : null;
      return;
    }
    if (col !== 'move' || !body) return;
    if (id === 'meta') {
      st.meta = st.meta || {};
      ['moveDate', 'createdAt', 'deletedSeed'].forEach((k) => { if (body[k] !== undefined && body[k] !== null) st.meta[k] = MV.clone(body[k]); });
      if (body.seedVersion) st.seedVersion = body.seedVersion;
      return;
    }
    if (id === 'parts') { st.parts = st.parts || []; st.parts.splice(0, st.parts.length, ...MV.clone(body.list || [])); return; }
    if (id === 'activity') { st.activity = st.activity || []; st.activity.splice(0, st.activity.length, ...MV.clone(body.list || [])); return; }
    if (SECTIONS.indexOf(id) >= 0) {
      const v = body.v;
      if (v && typeof v === 'object' && !Array.isArray(v) && st[id] && typeof st[id] === 'object' && !Array.isArray(st[id])) replaceInPlace(st[id], v);
      else st[id] = MV.clone(v);
    }
  }

  /* ---------- 쓰기 ---------- */
  function diffAndWrite() {
    if (Y.mode !== 'shared' || Y.readOnly || Y.empty || !db) return;
    const units = unitsOf(S.get());
    units.forEach((body, path) => {
      if (tooBig.has(path)) return;
      const j = canon(body);
      if (last.get(path) === j) return;
      if (j.length > MAX_DOC) {
        tooBig.add(path);
        toastOnce('big:' + path, path.startsWith('planbg/') ? '평면도 사진이 커서 이 기기에만 저장했어요 (공유되지 않음).' : '저장할 내용이 너무 커서 일부가 이 기기에만 남았어요.');
        return;
      }
      last.set(path, j);
      pending.set(path, { body: JSON.parse(j) });
    });
    last.forEach((j, path) => {
      if ((path.startsWith('items/') || path.startsWith('inventory/')) && !units.has(path)) {
        last.delete(path);
        pending.set(path, { body: null });
      }
    });
    if (pending.size) schedule();
  }
  function schedule() {
    if (timer) return;
    timer = setTimeout(() => { timer = null; pump(); }, backoff);
  }
  function pump() {
    if (!db || Y.mode !== 'shared') return;
    if (pending.size && Y.status !== 'saving') setStatus('saving');
    for (const [path, job] of Array.from(pending.entries())) {
      if (running >= 3) break;
      if (inflight.has(path)) continue;
      pending.delete(path);
      inflight.add(path);
      running++;
      let ref;
      try { ref = db.doc(path); } catch (e) { inflight.delete(path); running--; continue; }
      const p = job.body === null ? ref.delete() : ref.set(job.body);
      Promise.resolve(p).then(() => {
        backoff = 0;
      }).catch((e) => onWriteError(path, job, e)).finally(() => {
        inflight.delete(path);
        running--;
        if (pending.size) schedule();
        else if (!running && Y.mode === 'shared' && !Y.readOnly) setStatus('synced');
      });
    }
  }
  function onWriteError(path, job, e) {
    const code = (e && e.code) || 'unavailable';
    Y.lastError = code;
    if (code === 'invalid_argument') {
      if (job.body && canon(job.body).length > MAX_DOC - 4096) { tooBig.add(path); return; }
      // 권한이 없어 쓰지 못함 → 보기 전용
      Y.readOnly = true;
      pending.clear();
      setStatus('readonly');
      toastOnce('ro', '보기 전용 권한이라 바꾼 내용은 이 기기에만 남아요.');
      return;
    }
    if (code === 'quota_exceeded') { toastOnce('quota', '공유 저장소가 가득 찼어요. 오래된 항목을 지워 주세요.'); return; }
    if (code === 'revoked' || code === 'not_granted' || code === 'capability_disabled' || code === 'capability_removed') {
      stop('offline');
      toastOnce('revoked', '공유 저장소 연결이 끊겼어요. 지금부터는 이 기기에만 저장돼요.');
      return;
    }
    // resource_exhausted / unavailable / 그 밖 → 잠시 뒤 다시
    if (!pending.has(path)) pending.set(path, job);
    if (job.body !== null) last.set(path, canon(job.body));
    backoff = Math.min(30000, Math.max(1000, backoff * 2));
    setStatus('offline');
    schedule();
  }
  function stop(status) {
    unsubs.splice(0).forEach((u) => { try { u(); } catch (e) { /* 무시 */ } });
    Y.mode = 'local';
    db = null;
    setStatus(status || 'local');
  }

  /* ---------- 읽기 ---------- */
  function onSnap(col) {
    return (snap) => {
      const st = S.get();
      let changed = false;
      let metaArrived = false;
      snap.docChanges().forEach((ch) => {
        const path = col + '/' + ch.doc.id;
        if (path === 'move/meta' && ch.type !== 'removed') metaArrived = true;
        if (Y.empty) return;
        if (pending.has(path) || inflight.has(path)) return; // 더 새로운 내 변경이 나가는 중
        if (ch.type === 'removed') {
          if ((col === 'items' || col === 'inventory') && last.has(path)) { last.delete(path); applyUnit(st, path, null); changed = true; }
          return;
        }
        const data = ch.doc.data();
        if (!data) return;
        const j = canon(data);
        if (last.get(path) === j) return;
        last.set(path, j);
        if (tooBig.has(path)) tooBig.delete(path);
        applyUnit(st, path, data);
        changed = true;
      });
      if (Y.empty && metaArrived) { Y.empty = false; resync(); return; }
      if (changed) {
        S.persist();
        S.emit('change', { source: 'remote' });
        setStatus('synced');
      }
    };
  }
  function subscribe() {
    COLS.forEach((c) => {
      try {
        unsubs.push(db.collection(c).onSnapshot(onSnap(c), (e) => {
          Y.lastError = e && e.code;
          if (e && (e.code === 'revoked' || e.code === 'not_granted')) stop('offline');
          else setStatus('offline');
        }));
      } catch (e) { /* 무시 */ }
    });
  }
  async function readAll() {
    const snaps = await Promise.all(COLS.map((c) => db.collection(c).get()));
    const remote = new Map();
    snaps.forEach((qs, i) => qs.docs.forEach((d) => { if (d.exists) remote.set(COLS[i] + '/' + d.id, d.data()); }));
    return remote;
  }
  function adopt(remote) {
    const st = S.get();
    try { if (!global.localStorage.getItem(BACKUP_KEY)) global.localStorage.setItem(BACKUP_KEY, JSON.stringify(st)); } catch (e) { /* 무시 */ }
    unitsOf(st).forEach((b, path) => {
      if ((path.startsWith('items/') || path.startsWith('inventory/')) && !remote.has(path)) applyUnit(st, path, null);
    });
    last.clear();
    remote.forEach((data, path) => { applyUnit(st, path, data); last.set(path, canon(data)); });
    S.mergeSeed(st);          // 새 기본 항목이 생겼으면 추가 (지운 항목은 그대로 지운 채)
    S.persist();              // → diffAndWrite: 이 기기에만 있던 부분(예: 평면도 사진)과 새 기본 항목을 올림
    S.emit('change', { source: 'remote', reset: true });
  }
  async function resync() {
    try {
      const remote = await readAll();
      if (!remote.has('move/meta')) { Y.empty = true; setStatus('empty'); return; }
      Y.empty = false;
      adopt(remote);
      setStatus('synced');
    } catch (e) {
      Y.lastError = e && e.code;
      setStatus('offline');
    }
  }

  /** 공유 저장소가 비어 있을 때: 이 기기 기록으로 공유를 시작 */
  Y.initFromLocal = function initFromLocal() {
    if (!db || Y.readOnly) return false;
    Y.empty = false;
    last.clear();
    S.log('이 기기의 기록으로 공유를 시작했어요.', true);
    S.persist();
    S.emit('change', { source: 'local' });
    return true;
  };
  /** 처음 연결 때 따로 둔 '이 기기 기록' 백업 */
  Y.localBackup = function localBackup() {
    try { return global.localStorage.getItem(BACKUP_KEY); } catch (e) { return null; }
  };

  /* ---------- 상단바 표시 ---------- */
  const CHIP = {
    connecting: ['⏳', '공유 저장소에 연결하는 중'],
    synced: ['🔗', '공유 중 — 부부가 같은 기록을 봐요'],
    saving: ['⏳', '공유 저장소에 저장하는 중'],
    empty: ['🆕', '공유 기록이 아직 없어요 — ⋯ 메뉴에서 시작하세요'],
    readonly: ['👁', '보기 전용 — 바꾼 내용은 이 기기에만 남아요'],
    offline: ['⚠', '공유 저장소와 잠시 연결이 끊겼어요 — 다시 시도하는 중'],
    error: ['⚠', '공유 저장소 오류'],
  };
  function renderChip() {
    const top = document.querySelector('.topbar');
    if (!top) return;
    let chip = document.getElementById('sync-chip');
    const info = CHIP[Y.status];
    if (!info) { if (chip) chip.remove(); return; }
    if (!chip) {
      chip = document.createElement('button');
      chip.type = 'button';
      chip.id = 'sync-chip';
      chip.className = 'btn btn-ghost btn-sm sync-chip';
      chip.addEventListener('click', () => { const m = document.getElementById('topbar-menu'); if (m) m.click(); });
      const dday = document.getElementById('topbar-dday');
      if (dday && dday.parentNode === top) top.insertBefore(chip, dday.nextSibling); else top.appendChild(chip);
    }
    chip.textContent = info[0];
    chip.title = info[1];
    chip.setAttribute('aria-label', info[1]);
    chip.dataset.status = Y.status;
  }

  /* ---------- 시작 ---------- */
  async function connect() {
    const c = global.claude;
    if (!c || typeof c.use !== 'function') return; // GitHub Pages 등: 이 기기만
    Y.mode = 'connecting';
    setStatus('connecting');
    const safe = (name) => Promise.resolve().then(() => c.use(name)).catch(() => null);
    const [dbNs, userNs, dlNs, sampleNs] = await Promise.all([safe('db'), safe('user'), safe('downloads'), safe('sample')]);
    if (userNs) Y.cap.user = userNs;
    if (dlNs) Y.cap.downloads = dlNs;
    if (sampleNs) Y.cap.sample = sampleNs;
    S.emit('caps', Y.cap);
    if (!dbNs) { Y.mode = 'local'; setStatus('local'); return; }
    db = dbNs;
    Y.cap.db = dbNs;
    if (userNs) {
      try { const w = await userNs.can('data.write'); if (w === false) Y.readOnly = true; } catch (e) { /* 무시 */ }
    }
    let remote;
    try { remote = await readAll(); } catch (e) {
      Y.lastError = e && e.code;
      Y.mode = 'local';
      setStatus('offline');
      return;
    }
    Y.mode = 'shared';
    if (!remote.has('move/meta')) {
      Y.empty = true;
      setStatus(Y.readOnly ? 'readonly' : 'empty');
    } else {
      adopt(remote);
      setStatus(Y.readOnly ? 'readonly' : 'synced');
    }
    subscribe();
  }

  /* ---------- claude.ai 화면 안에서의 제약 보완 ---------- */
  function installViewerShims() {
    // 1) <a download> 링크는 막혀 있음 → downloads 기능으로 저장
    document.addEventListener('click', (e) => {
      const a = e.target && e.target.closest ? e.target.closest('a[download]') : null;
      const dl = Y.cap.downloads;
      if (!a || !dl || typeof dl.save !== 'function') return;
      const href = a.getAttribute('href') || '';
      if (!/^(blob:|data:)/.test(href)) return;
      e.preventDefault();
      e.stopPropagation();
      const name = a.getAttribute('download') || 'move-file.txt';
      fetch(href).then((r) => r.blob()).then((blob) => dl.save({ filename: name, data: blob })).catch((err) => {
        const code = err && err.code;
        if (code === 'declined' || !MV.ui) return;
        // 코드는 콘솔에만 남기고 화면에는 한국어 안내
        console.warn('[파일 저장] 실패', code || '', err && err.message);
        const msg = MV.ui.saveErrorText ? MV.ui.saveErrorText(code) : '파일을 저장할 수 없어요. 잠시 뒤 다시 해 보세요.';
        if (msg) MV.ui.toast(msg, { ms: 5000 });
      });
    }, true);
    // 2) 인쇄 창은 열리지 않음 → 안내
    try {
      global.print = function () { if (MV.ui) MV.ui.toast('클로드 공유 버전 화면에서는 인쇄가 안 돼요. 깃허브 페이지 버전 주소로 열어서 인쇄해 주세요.', { ms: 5000 }); };
    } catch (e) { /* 무시 */ }
  }
  if (global.claude && typeof global.claude.use === 'function') installViewerShims();

  S.afterPersist.push(diffAndWrite);
  MV.css('sync', `
    .sync-chip { flex: 0 0 auto; padding: 0 8px; font-size: 1rem; }
    .sync-chip[data-status="offline"], .sync-chip[data-status="error"] { color: var(--warn); }
  `);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => { connect(); });
  else setTimeout(connect, 0);

  // 테스트·디버깅용
  Y._debug = { canon, unitsOf, docId, last, pending, applyUnit };
})(window);
