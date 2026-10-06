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
         한 문서(예: move/finance 의 예산 줄들)를 두 기기가 거의 동시에 고치면 3-방향 합치기를 합니다.
           기준(base)  = 이 기기가 마지막으로 안 서버 내용 (srv)
           내 것(local) = 지금 이 기기의 내용 (아직 저장 전·보내는 중 포함)
           받은 것(remote) = 방금 도착한 서버 내용
           객체: 키마다 — 나만 고쳤으면 내 것, 아니면 받은 것 (둘 다 고친 객체는 안으로 들어가서 다시 합침)
           id 가 있는 객체 배열(예산 줄·배치·견적·메모): id 마다 같은 규칙, 양쪽에서 더한 것은 모두 남김,
             지우기는 상대가 그 요소를 안 고쳤을 때만 이김
           문자열 배열(지운 기본 항목·지운 방 같은 목록): 집합처럼 합침 (양쪽에서 더한 것·지운 것 모두 반영)
           그 밖의 배열·값: 바뀐 쪽, 둘 다 바뀌었으면 받은 것
           활동 기록은 둘을 합쳐 시간순 · 평면도 사진은 사진이 다르면 통째로 받은 것
         합친 결과가 서버와 다르면 곧바로 다시 올립니다.
   상태: synced(공유 중) · saving · offline(잠시 끊김, 다시 시도) · partial(일부를 공유하지 못함 — 이 기기에만)
         readonly(보기 전용 — 언제나 이것) · revoked(공유 권한 없음 — 이 기기에만) · empty · connecting
   ============================================================ */
(function (global) {
  'use strict';
  const S = MV.store;
  const Y = MV.sync = {
    mode: 'local',          // local | connecting | shared
    status: 'local',        // local | connecting | synced | saving | empty | readonly | offline | partial | revoked | error
    readOnly: false,
    empty: false,
    cap: {},                // { db, user, downloads, sample } — 쓸 수 있는 것만
    lastError: null,
  };
  const SECTIONS = ['layouts', 'planEdits', 'estimate', 'finance'];
  const COLS = ['move', 'items', 'inventory', 'planbg'];
  const MAX_DOC = 250 * 1024;
  const BACKUP_KEY = 'mv:state:v1:before-share';
  const BACKOFF_MIN = 1000;     // 쓰기 실패 뒤 첫 재시도 (한 묶음에 한 번만 늘림)
  const BACKOFF_MAX = 4000;
  const STUCK_MIN = 15000;      // 공유 저장소가 가득 찼을 때 다시 올려 보는 간격
  const STUCK_MAX = 120000;
  const ANC_MAX = 8;
  const REVOKED = ['revoked', 'not_granted', 'capability_disabled', 'capability_removed'];

  let db = null;
  const last = new Map();       // 경로 → 이 기기가 보냈거나(보낼 예정) 받아 둔 내용 (정렬된 JSON) — 바뀐 것만 보내는 데 씀
  const srv = new Map();        // 경로 → 이 기기가 마지막으로 안 서버 내용 (합치기의 기준)
  const anc = new Map();        // 경로 → Set(JSON) 지금 이 기기 내용에 이미 들어 있는 예전 내용 (늦게 온 내 쓰기 메아리 거르기)
  const seen = new Map();       // 경로 → 받은 스냅샷 수 (쓰기 확인 사이에 새 내용이 왔는지)
  const pending = new Map();    // 경로 → { body | null(삭제) }
  const inflight = new Set();
  const tooBig = new Map();     // 경로 → 이 길이를 넘으면 보내지 않음 (너무 큼)
  const stuck = new Map();      // 경로 → true : 공유 저장소가 가득 차 못 올린 문서
  const unsubs = [];
  let running = 0;
  let backoff = 0;
  let batchNo = 0;
  let bumpedBatch = 0;
  let timer = null;
  let stuckTimer = null;
  let stuckDelay = STUCK_MIN;
  let retryingStuck = false;
  let resyncing = false;
  let deferred = [];            // 다시 읽는 동안 도착한 변경 (다 읽은 뒤 처리)
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
  const isItemPath = (p) => p.startsWith('items/') || p.startsWith('inventory/');
  function hasPartial() {
    if (stuck.size) return true;
    for (const p of tooBig.keys()) if (!p.startsWith('planbg/')) return true; // 큰 평면도 사진은 원래 이 기기에만 (안내 토스트로 충분)
    return false;
  }
  /** 쓰기가 다 끝났을 때 보여 줄 상태 */
  function idleStatus() {
    if (Y.readOnly) return 'readonly';
    return hasPartial() ? 'partial' : 'synced';
  }
  function setStatus(st) {
    // 보기 전용이면 공유 연결이 살아 있는 동안 언제나 '보기 전용' (공유 중이라고 말하지 않음)
    if (Y.readOnly && Y.mode !== 'local' && st !== 'connecting') st = 'readonly';
    Y.status = st;
    renderChip();
    S.emit('sync', { status: st });
  }
  function settle() {
    if (Y.mode === 'shared' && !pending.size && !running) setStatus(idleStatus());
  }
  function addAnc(path, j) {
    if (j === null || j === undefined) return;
    let set = anc.get(path);
    if (!set) { set = new Set(); anc.set(path, set); }
    set.delete(j);
    set.add(j);
    while (set.size > ANC_MAX) set.delete(set.values().next().value);
  }

  /* ---------- 상태 ↔ 문서 ---------- */
  function metaUnit(st) {
    const meta = st.meta || {};
    return {
      moveDate: meta.moveDate || null, createdAt: meta.createdAt || null,
      deletedSeed: meta.deletedSeed || [], seedVersion: st.seedVersion || 0, version: st.version || 1,
    };
  }
  function unitsOf(st) {
    const u = new Map();
    u.set('move/meta', metaUnit(st));
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
  /** 문서 하나만 (unitsOf 와 같은 모양) — 없으면 undefined */
  function unitOf(st, path) {
    const slash = path.indexOf('/');
    const col = path.slice(0, slash);
    const id = path.slice(slash + 1);
    if (col === 'move') {
      if (id === 'meta') return metaUnit(st);
      if (id === 'parts') return { list: st.parts || [] };
      if (id === 'activity') return { list: (st.activity || []).slice(0, 150) };
      if (SECTIONS.indexOf(id) >= 0) return (st[id] !== undefined && st[id] !== null) ? { v: st[id] } : undefined;
      return undefined;
    }
    if (col === 'planbg') {
      if (!st.planBg || typeof st.planBg !== 'object' || !Object.prototype.hasOwnProperty.call(st.planBg, id)) return undefined;
      return { v: st.planBg[id] === undefined ? null : st.planBg[id] };
    }
    if (col === 'items' || col === 'inventory') {
      let found;
      (st[col] || []).forEach((it) => { if (it && it.id && docId(it.id) === id) found = it; }); // unitsOf 처럼 같은 id 면 뒤의 것
      return found;
    }
    return undefined;
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

  /* ---------- 3-방향 합치기 ---------- */
  const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
  const has = (o, k) => isObj(o) && Object.prototype.hasOwnProperty.call(o, k) && o[k] !== undefined;
  function uniq(keys) { return new Set(keys).size === keys.length; }
  function idArr(a) {
    if (!Array.isArray(a)) return false;
    if (!a.every((x) => isObj(x) && (typeof x.id === 'string' || typeof x.id === 'number'))) return false;
    return uniq(a.map((x) => typeof x.id + ':' + x.id));
  }
  function strArr(a) { return Array.isArray(a) && a.every((x) => typeof x === 'string') && uniq(a); }
  /** b = 기준, l = 내 것, r = 받은 것. undefined = 없음 */
  function merge3(b, l, r) {
    const cl = canon(l);
    const cr = canon(r);
    if (cl === cr) return r;
    const cb = b === undefined ? undefined : canon(b);
    if (cl === cb) return r;          // 나는 안 고침
    if (cr === cb) return l;          // 상대는 안 고침
    // 둘 다 고침
    if (isObj(l) && isObj(r)) return mergeObj(isObj(b) ? b : {}, l, r);
    if (Array.isArray(l) && Array.isArray(r)) {
      const ab = Array.isArray(b) ? b : [];
      if (idArr(l) && idArr(r) && idArr(ab)) return mergeList(ab, l, r, (x) => typeof x.id + ':' + x.id, true);
      if (strArr(l) && strArr(r) && strArr(ab)) return mergeList(ab, l, r, (x) => x, false);
    }
    return r;                         // 그 밖: 받은 것이 이김
  }
  function mergeObj(b, l, r) {
    const out = {};
    const keys = [];
    Object.keys(r).forEach((k) => keys.push(k));
    Object.keys(l).forEach((k) => { if (!has(r, k)) keys.push(k); });
    keys.forEach((k) => {
      const inL = has(l, k);
      const inR = has(r, k);
      const inB = has(b, k);
      if (inL && inR) { out[k] = merge3(inB ? b[k] : undefined, l[k], r[k]); return; }
      if (inR) {                      // 내 쪽에 없음: 내가 지웠는데 상대가 안 고쳤으면 지움, 아니면 받은 것
        if (inB && canon(r[k]) === canon(b[k])) return;
        out[k] = r[k];
        return;
      }
      if (inL) {                      // 받은 쪽에 없음: 상대가 지웠는데 내가 안 고쳤으면 지움, 아니면 내 것
        if (inB && canon(l[k]) === canon(b[k])) return;
        out[k] = l[k];
      }
    });
    return out;
  }
  function mergeList(b, l, r, keyOf, deep) {
    const mb = new Map(b.map((x) => [keyOf(x), x]));
    const ml = new Map(l.map((x) => [keyOf(x), x]));
    const mr = new Map(r.map((x) => [keyOf(x), x]));
    const keep = new Map();
    const all = [];
    mr.forEach((x, k) => all.push(k));
    ml.forEach((x, k) => { if (!mr.has(k)) all.push(k); });
    all.forEach((k) => {
      const inL = ml.has(k);
      const inR = mr.has(k);
      const inB = mb.has(k);
      if (inL && inR) { keep.set(k, deep ? merge3(inB ? mb.get(k) : undefined, ml.get(k), mr.get(k)) : mr.get(k)); return; }
      if (inR) {
        if (inB && (!deep || canon(mr.get(k)) === canon(mb.get(k)))) return; // 내가 지움, 상대는 안 고침
        keep.set(k, mr.get(k));
        return;
      }
      if (inB && (!deep || canon(ml.get(k)) === canon(mb.get(k)))) return;   // 상대가 지움, 나는 안 고침
      keep.set(k, ml.get(k));
    });
    // 순서: 나만 순서를 바꿨으면 내 순서, 아니면 받은 순서. 다른 쪽에서 더한 것은 그쪽에서 바로 앞에 있던 요소 뒤에 끼움
    const kb = b.map(keyOf);
    const kl = l.map(keyOf);
    const kr = r.map(keyOf);
    const sameOrder = (a, c) => {
      const sa = new Set(a);
      const sc = new Set(c);
      return a.filter((k) => sc.has(k)).join('\u0001') === c.filter((k) => sa.has(k)).join('\u0001');
    };
    const localFirst = !sameOrder(kl, kb) && sameOrder(kr, kb);
    const primary = localFirst ? kl : kr;
    const secondary = localFirst ? kr : kl;
    const order = primary.filter((k) => keep.has(k));
    const placed = new Set(order);
    let prev = null;
    secondary.forEach((k) => {
      if (placed.has(k)) { prev = k; return; }
      if (!keep.has(k)) return;
      const at = prev === null ? 0 : order.indexOf(prev) + 1;
      order.splice(at, 0, k);
      placed.add(k);
      prev = k;
    });
    return order.map((k) => keep.get(k));
  }
  function mergeActivity(b, l, r) {
    const key = (a) => (a && a.at ? String(a.at) : '') + '\u0001' + (a && a.text ? String(a.text) : '');
    const base = new Set(((b && b.list) || []).map(key));
    const out = new Map();
    ((r && r.list) || []).forEach((a) => { if (a) out.set(key(a), a); });
    ((l && l.list) || []).forEach((a) => { if (a) { const k = key(a); if (!out.has(k) && !base.has(k)) out.set(k, a); } });
    const list = Array.from(out.values()).sort((x, y) => {
      const ax = String(x.at || '');
      const ay = String(y.at || '');
      return ax < ay ? 1 : ax > ay ? -1 : 0;
    });
    return { list: list.slice(0, 150) };
  }
  /** 문서 종류에 맞춰 합치기 */
  function mergeDoc(path, b, l, r) {
    if (path === 'move/activity') return mergeActivity(b, l, r);
    if (path.startsWith('planbg/')) {
      const src = (x) => (x && isObj(x.v) ? x.v.src : undefined);
      if (src(l) !== src(r)) {        // 사진 자체가 다르면 섞지 않음
        const cb = b === undefined ? undefined : canon(b);
        return canon(r) === cb ? l : r;
      }
    }
    return merge3(b, l, r);
  }

  /* ---------- 쓰기 ---------- */
  function diffAndWrite() {
    if (Y.mode !== 'shared' || Y.readOnly || Y.empty || resyncing || !db) return;
    const units = unitsOf(S.get());
    units.forEach((body, path) => {
      const j = canon(body);
      const lim = tooBig.has(path) ? Math.min(MAX_DOC, tooBig.get(path)) : MAX_DOC;
      if (j.length > lim) {
        if (!tooBig.has(path)) tooBig.set(path, MAX_DOC);
        toastOnce('big:' + path, path.startsWith('planbg/') ? '평면도 사진이 커서 이 기기에만 저장했어요 (공유되지 않음).' : '저장할 내용이 너무 커서 일부가 이 기기에만 남았어요.');
        return;
      }
      tooBig.delete(path);
      if (stuck.has(path)) {
        if (srv.get(path) === j) { stuck.delete(path); last.set(path, j); return; } // 서버에 이미 같은 내용
        if (!retryingStuck) return;   // 가득 찬 동안은 정해진 때에만 다시 올려 봄
      }
      if (last.get(path) === j) return;
      last.set(path, j);
      addAnc(path, j);
      pending.set(path, { body: JSON.parse(j) });
    });
    last.forEach((j, path) => {
      if (isItemPath(path) && !units.has(path)) {
        if (stuck.has(path) && !retryingStuck) return;
        last.delete(path);
        pending.set(path, { body: null });
      }
    });
    // 지워진 문서의 '못 올림' 표시 정리
    stuck.forEach((v, path) => { if (!units.has(path) && !last.has(path) && !pending.has(path)) stuck.delete(path); });
    tooBig.forEach((v, path) => { if (!units.has(path)) tooBig.delete(path); });
    if (pending.size) schedule();
    else if (Y.status === 'partial' || Y.status === 'synced') settle();
  }
  function schedule() {
    if (timer) return;
    timer = setTimeout(() => { timer = null; pump(); }, backoff);
  }
  function pump() {
    if (!db || Y.mode !== 'shared' || Y.readOnly) return;
    if (pending.size && Y.status !== 'saving') setStatus('saving');
    const batch = ++batchNo;
    for (const [path, job] of Array.from(pending.entries())) {
      if (running >= 3) break;
      if (inflight.has(path)) continue;
      pending.delete(path);
      inflight.add(path);
      running++;
      job.batch = batch;
      const seq0 = seen.get(path) || 0;
      const conn = db;
      let ref;
      try { ref = db.doc(path); } catch (e) { inflight.delete(path); running--; continue; } // 쓸 수 없는 경로 → 버림 (예전과 같음)
      let p;
      try { p = job.body === null ? ref.delete() : ref.set(job.body); } catch (e) { p = Promise.reject(e); }
      Promise.resolve(p).then(() => {
        if (conn !== db) return;
        backoff = 0;                  // 하나라도 되면 바로 다시 빠르게
        stuckDelay = STUCK_MIN;
        stuck.delete(path);
        // 보내는 사이에 새 스냅샷이 오지 않았으면 서버 내용 = 보낸 내용
        if ((seen.get(path) || 0) === seq0) { if (job.body === null) srv.delete(path); else srv.set(path, canon(job.body)); }
      }).catch((e) => { if (conn === db) onWriteError(path, job, e); }).finally(() => {
        inflight.delete(path);
        running--;
        if (conn !== db) return;
        if (pending.size) schedule();
        else settle();
      });
    }
  }
  function onWriteError(path, job, e) {
    const code = (e && e.code) || 'unavailable';
    Y.lastError = code;
    if (code === 'invalid_argument') {
      const len = job.body ? canon(job.body).length : 0;
      if (job.body && len > MAX_DOC - 4096) {
        tooBig.set(path, len - 2048);  // 이보다 줄어들면 다시 보냄
        toastOnce('big:' + path, path.startsWith('planbg/') ? '평면도 사진이 커서 이 기기에만 저장했어요 (공유되지 않음).' : '저장할 내용이 너무 커서 일부가 이 기기에만 남았어요.');
        return;
      }
      // 권한이 없어 쓰지 못함 → 보기 전용
      Y.readOnly = true;
      pending.clear();
      setStatus('readonly');
      toastOnce('ro', '보기 전용 권한이라 바꾼 내용은 이 기기에만 남아요.');
      return;
    }
    if (code === 'quota_exceeded') {
      // 버리지 않음: '일부를 공유하지 못함' 으로 표시하고, 잠시 뒤(또는 서버가 같은 내용을 갖게 되면) 풀림
      stuck.set(path, true);
      if (job.body === null) last.set(path, srv.get(path) || 'null');
      else if (srv.has(path)) last.set(path, srv.get(path));
      else last.delete(path);
      toastOnce('quota', '공유 저장소가 가득 차서 일부 기록을 공유하지 못했어요. 이 기기에는 남아 있어요 — 필요 없는 항목이나 사진을 지우면 다시 올려요.');
      scheduleStuck();
      return;
    }
    if (REVOKED.indexOf(code) >= 0) {
      stop('revoked');
      toastOnce('revoked', '공유 권한이 없어져서 지금부터 바꾼 내용은 이 기기에만 저장돼요.');
      return;
    }
    // resource_exhausted / unavailable / 그 밖 → 잠시 뒤 다시 (실패한 묶음마다 한 번만 늘림, 최대 4초)
    if (!pending.has(path)) {
      pending.set(path, job);
      if (job.body !== null) last.set(path, canon(job.body));
    }
    if ((job.batch || 0) > bumpedBatch) {
      bumpedBatch = job.batch || 0;
      backoff = Math.min(BACKOFF_MAX, backoff ? backoff * 2 : BACKOFF_MIN);
    }
    setStatus('offline');
    schedule();
  }
  function scheduleStuck() {
    if (stuckTimer) return;
    stuckTimer = setTimeout(() => {
      stuckTimer = null;
      if (!stuck.size || Y.mode !== 'shared') return;
      stuckDelay = Math.min(STUCK_MAX, stuckDelay * 2);
      retryingStuck = true;
      try { diffAndWrite(); } finally { retryingStuck = false; }
      if (stuck.size && !pending.size && !running) scheduleStuck();
    }, stuckDelay);
  }
  function stop(status) {
    unsubs.splice(0).forEach((u) => { try { u(); } catch (e) { /* 무시 */ } });
    if (timer) { clearTimeout(timer); timer = null; }
    if (stuckTimer) { clearTimeout(stuckTimer); stuckTimer = null; }
    pending.clear();
    stuck.clear();
    Y.mode = 'local';
    db = null;
    setStatus(status || 'local');
  }

  /* ---------- 읽기 ---------- */
  /** 받은 문서 하나 처리 → 0 그대로 · 1 이 기기 상태가 바뀜 · 2 상태는 그대로지만 내 내용을 다시 올려야 함 */
  function onRemote(st, path, data) {
    const j = canon(data);
    const base = srv.has(path) ? srv.get(path) : null;
    srv.set(path, j);
    const lu = unitOf(st, path);
    const lj = lu === undefined ? null : canon(lu);
    if (lj === j) {                    // 이미 같은 내용 (줄 서 있던 예전 내용은 보낼 필요 없음)
      last.set(path, j);
      pending.delete(path);
      if (!inflight.has(path)) anc.delete(path);
      stuck.delete(path);
      return 0;
    }
    const a = anc.get(path);
    if (a && a.has(j)) {               // 예전에 내가 보낸(또는 이미 합친) 내용이 늦게 옴 → 지금 내 것이 더 새것
      last.set(path, j);
      return 2;
    }
    const localDeleted = lu === undefined && isItemPath(path) && base !== null;
    const dirty = lu !== undefined ? lj !== base : localDeleted;
    if (!dirty) {                      // 이 기기에서 안 고친 문서 → 받은 내용 그대로
      last.set(path, j);
      pending.delete(path);
      if (!inflight.has(path)) anc.delete(path);
      stuck.delete(path);
      applyUnit(st, path, data);
      return 1;
    }
    if (localDeleted) {
      if (j === base) return 0;        // 상대는 안 고침 → 내 지우기가 이김 (보내는 중)
      pending.delete(path);            // 상대가 고친 것을 내가 지웠음 → 고친 쪽이 이김
      last.set(path, j);
      anc.delete(path);
      applyUnit(st, path, data);
      return 1;
    }
    // 둘 다 고침 → 합치기
    const merged = mergeDoc(path, base === null ? undefined : JSON.parse(base), MV.clone(lu), data);
    last.set(path, j);
    if (base !== null) addAnc(path, base);
    addAnc(path, j);
    if (canon(merged) === lj) return 2; // 받은 내용이 이미 내 쪽에 다 들어 있음 → 내 것을 올리기만
    applyUnit(st, path, merged);
    return 1;
  }
  function onRemoved(st, col, path) {
    const base = srv.has(path) ? srv.get(path) : null;
    srv.delete(path);
    if (col !== 'items' && col !== 'inventory') return 0; // 묶음 문서는 지우지 않음
    const lu = unitOf(st, path);
    if (lu === undefined) {
      last.delete(path);
      const pj = pending.get(path);
      if (pj && pj.body === null) pending.delete(path);
      anc.delete(path);
      stuck.delete(path);
      return 0;
    }
    if (base === null || canon(lu) !== base) {
      // 상대가 지웠지만 이 기기에서 고친(또는 아직 안 올린) 항목 → 고친 쪽이 이김: 다시 올림
      last.delete(path);
      anc.delete(path);
      return 2;
    }
    last.delete(path);
    pending.delete(path);
    anc.delete(path);
    stuck.delete(path);
    tooBig.delete(path);
    applyUnit(st, path, null);
    return 1;
  }
  function handleChanges(col, changes) {
    const st = S.get();
    let changed = false;
    let rewrite = false;
    changes.forEach((ch) => {
      const path = col + '/' + ch.id;
      seen.set(path, (seen.get(path) || 0) + 1);
      const r = ch.removed ? onRemoved(st, col, path) : onRemote(st, path, ch.data);
      if (r === 1) changed = true;
      else if (r === 2) rewrite = true;
    });
    if (changed) {
      S.persist();                     // → diffAndWrite: 합친 결과가 서버와 다르면 다시 올림
      S.emit('change', { source: 'remote' });
    } else if (rewrite) diffAndWrite();
    settle();                          // 보낼 것이 없으면 공유 중 / 일부 못 올림 / 보기 전용
  }
  function onSnap(col) {
    return (snap) => {
      let metaArrived = false;
      const changes = [];
      snap.docChanges().forEach((ch) => {
        const id = ch.doc.id;
        if (col === 'move' && id === 'meta' && ch.type !== 'removed') metaArrived = true;
        if (ch.type === 'removed') { changes.push({ id, removed: true }); return; }
        const data = ch.doc.data();
        if (data) changes.push({ id, data });
      });
      if (Y.empty) {
        if (metaArrived) { Y.empty = false; resync(); }
        return;
      }
      if (resyncing) { deferred.push([col, changes]); return; }
      if (changes.length) handleChanges(col, changes);
    };
  }
  function subscribe() {
    COLS.forEach((c) => {
      try {
        unsubs.push(db.collection(c).onSnapshot(onSnap(c), (e) => {
          Y.lastError = e && e.code;
          if (e && REVOKED.indexOf(e.code) >= 0) {
            stop('revoked');
            toastOnce('revoked', '공유 권한이 없어져서 지금부터 바꾼 내용은 이 기기에만 저장돼요.');
          } else setStatus('offline');
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
      if (isItemPath(path) && !remote.has(path)) applyUnit(st, path, null);
    });
    last.clear();
    srv.clear();
    anc.clear();
    stuck.clear();
    remote.forEach((data, path) => {
      applyUnit(st, path, data);
      const j = canon(data);
      last.set(path, j);
      srv.set(path, j);
    });
    S.mergeSeed(st);          // 새 기본 항목이 생겼으면 추가 (지운 항목은 그대로 지운 채)
    S.persist();              // → diffAndWrite: 이 기기에만 있던 부분(예: 평면도 사진)과 새 기본 항목을 올림
    S.emit('change', { source: 'remote', reset: true });
  }
  async function resync() {
    resyncing = true;
    deferred = [];
    try {
      const remote = await readAll();
      if (!remote.has('move/meta')) { Y.empty = true; resyncing = false; deferred = []; setStatus(Y.readOnly ? 'readonly' : 'empty'); return; }
      Y.empty = false;
      resyncing = false;
      adopt(remote);
      // 읽는 동안 도착한 변경 (대부분 이미 같은 내용이라 아무 일도 안 함)
      const later = deferred.splice(0);
      later.forEach(([col, changes]) => handleChanges(col, changes));
      if (!pending.size && !running) setStatus(idleStatus());
    } catch (e) {
      resyncing = false;
      deferred = [];
      Y.lastError = e && e.code;
      setStatus('offline');
    }
  }

  /** 공유 저장소가 비어 있을 때: 이 기기 기록으로 공유를 시작 */
  Y.initFromLocal = function initFromLocal() {
    if (!db || Y.readOnly) return false;
    Y.empty = false;
    last.clear();
    srv.clear();
    anc.clear();
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
    empty: ['✨', '공유 기록이 아직 없어요 — ⋯ 메뉴에서 시작하세요'],
    readonly: ['👁', '보기 전용 — 바꾼 내용은 이 기기에만 남아요'],
    offline: ['⚠', '공유 저장소와 잠시 연결이 끊겼어요 — 다시 시도하는 중'],
    partial: ['⚠', '일부 기록을 공유하지 못했어요 — 이 기기에만 남아요'],
    revoked: ['🔒', '공유 권한이 없어요 — 이 기기에만 저장돼요'],
    error: ['⚠', '공유 저장소 오류'],
  };
  /** ⋯ 메뉴 '함께 쓰기' 칸에 쓸 긴 설명 (app.js 에 아직 없는 상태만) */
  Y.statusText = function statusText(st) {
    st = st || Y.status;
    if (st === 'partial') {
      return '⚠ 일부 기록을 공유하지 못했어요. 그 부분은 이 기기에만 남아 있어요. '
        + (stuck.size ? '공유 저장소가 가득 찼어요 — 필요 없는 항목이나 사진을 지우면 잠시 뒤 자동으로 다시 올려요.' : '내용이 너무 커요 — 줄이면 다시 공유돼요.');
    }
    if (st === 'revoked') return '🔒 공유 권한이 없어요. 지금부터 바꾼 내용은 이 기기에만 저장돼요.';
    return null;
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
  // ⋯ 메뉴가 열리면 app.js 가 모르는 상태(일부 못 올림·권한 없음) 설명을 채움
  function patchMenu() {
    const txt = Y.statusText();
    if (!txt) return;
    const modals = Array.from(document.querySelectorAll('.modal'));
    const box = modals.find((m) => /데이터/.test(m.getAttribute('aria-label') || ''));
    if (!box || box.querySelector('.sync-menu-note')) return;
    const h = Array.from(box.querySelectorAll('h3')).find((x) => x.textContent.trim() === '함께 쓰기');
    if (h) {
      const p = h.parentNode.querySelector('p');
      if (p) { p.textContent = txt; p.classList.add('sync-menu-note'); }
      return;
    }
    const first = box.querySelector('.modal-body .card');
    if (!first) return;
    const card = MV.el('div', { class: 'card flat tint-kid' }, MV.el('h3', '함께 쓰기'), MV.el('p', { class: 'small sync-menu-note' }, txt));
    first.parentNode.insertBefore(card, first);
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
      setStatus(Y.readOnly ? 'readonly' : (pending.size || running ? 'saving' : idleStatus()));
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
    // 3) ⋯ 메뉴 설명 보완 (메뉴 단추·상태 칩 누름 → 창이 뜬 뒤)
    document.addEventListener('click', (e) => {
      const t = e.target && e.target.closest ? e.target.closest('#topbar-menu, #sync-chip') : null;
      if (t) setTimeout(() => { try { patchMenu(); } catch (err) { /* 무시 */ } }, 0);
    }, true);
  }
  if (global.claude && typeof global.claude.use === 'function') installViewerShims();

  S.afterPersist.push(diffAndWrite);
  MV.css('sync', `
    .sync-chip { flex: 0 0 auto; padding: 0 8px; font-size: 1rem; }
    .sync-chip[data-status="offline"], .sync-chip[data-status="error"], .sync-chip[data-status="partial"], .sync-chip[data-status="revoked"] { color: var(--warn); }
  `);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => { connect(); });
  else setTimeout(connect, 0);

  // 테스트·디버깅용
  Y._debug = { canon, unitsOf, unitOf, docId, last, srv, anc, pending, inflight, stuck, tooBig, applyUnit, merge3, mergeDoc, get backoff() { return backoff; } };
})(window);
