/* ============================================================
   함께 쓰기 — 깃허브 페이지 버전용 파이어베이스(Firebase Firestore) 연결
   - claude.ai 공유 버전(window.claude.use 가 있음)에서는 아무것도 하지 않습니다 (그쪽은 sync.js 가 db 기능으로 연결).
   - 설정값이 없으면 아무것도 불러오지 않습니다 (기록은 이 브라우저에만). 설정이 있을 때만 SDK 를 늦게 불러옵니다.
   - 부부가 각자 이메일·비밀번호로 로그인하면, 같은 기록을 sync.js 의 규칙(문서 하나씩 · 3-방향 합치기)대로 함께 고칩니다.

   설정 찾는 순서
     (a) 주소의 ?connect=<base64url JSON> (아내 초대 링크) → 검사 후 이 브라우저에 저장하고 주소에서 지움
         (이미 다른 저장소 설정이 있으면 바로 바꾸지 않고 함께 쓰기 화면에서 물어봄 · BAKED 가 있으면 링크는 쓰지 않음)
     (b) 아래 BAKED (저장소에 설정값을 넣어 두면 모든 기기가 자동으로 같은 파이어베이스를 씀)
     (c) 이 브라우저에 저장한 설정 (localStorage 'mv:fb:config' — 함께 쓰기 화면에서 붙여 넣은 것)
   시험용: localStorage 'mv:fb:emu' = {"host":"127.0.0.1","firestore":8180,"auth":9199} 이면 에뮬레이터에 붙음
           (붙여 넣은 설정값에는 이 값이 절대 들어가지 않음)

   저장 위치: Firestore homes/<space>/<컬렉션>/<문서>   (space 기본 'ours', sync.js 의 'move/meta' → homes/ours/move/meta)
   문서 내용: { j: JSON 문자열(_sa 를 뗀 내용), sa: _sa 배열, at: 서버 시각, by: 로그인 이메일 }
     — Firestore 는 배열 안 배열·빈 키·특수 문자 키·깊이 20 제한이 있어 상태를 그대로 넣으면 깨지므로 글자로 저장.
       j 가 없거나 깨진 문서는 무시.
   읽기: 컬렉션마다 Firestore 구독 하나만 엶. 첫 서버 스냅샷이 오면 get() 이 풀리고(페이지 열 때 문서를 한 번만 읽음),
         그 뒤의 변경만 sync.js 로 넘김. 내 대기 중 쓰기(메아리)·메타데이터만 바뀐 변경은 넘기지 않음.
   ============================================================ */
(function (global) {
  'use strict';
  const c0 = global.claude;
  if (c0 && typeof c0.use === 'function') { MV.fb = { available: false, reason: 'claude' }; return; }

  /* 설정값을 저장소에 넣으려면 아래 null 을 파이어베이스 콘솔의 설정값으로 바꾸세요. 예:
       const BAKED = { apiKey: 'AIza…', authDomain: '내프로젝트.firebaseapp.com', projectId: '내프로젝트', appId: '1:…:web:…' };
     apiKey 는 비밀번호가 아니에요 (앱 주소처럼 공개돼도 됨). 기록을 지키는 것은 파이어베이스 규칙(두 사람 이메일만 허용)입니다.
     넣어 두면 초대 링크 없이 앱 주소만 열고 로그인하면 됩니다. */
  const BAKED = null;

  const VER = '12.19.0';
  const SDK_FILES = ['firebase-app-compat.js', 'firebase-auth-compat.js', 'firebase-firestore-compat.js'];
  const CDNS = [
    (f) => 'https://www.gstatic.com/firebasejs/' + VER + '/' + f,
    (f) => 'https://cdn.jsdelivr.net/npm/firebase@' + VER + '/' + f,
  ];
  const SDK_TIMEOUT = 20000;
  const READY_TIMEOUT = 20000;      // 첫 서버 스냅샷을 기다리는 시간
  const SLOW_WRITE = 10000;         // 이보다 오래 저장이 안 끝나면 '끊김' 표시
  const CFG_KEY = 'mv:fb:config';
  const EMU_KEY = 'mv:fb:emu';
  const COLS = ['move', 'items', 'inventory', 'planbg'];
  const Y = MV.sync;
  const S = MV.store;

  const lsGet = (k) => { try { return global.localStorage.getItem(k); } catch (e) { return null; } };
  const lsSet = (k, v) => { try { global.localStorage.setItem(k, v); return true; } catch (e) { return false; } };
  const lsDel = (k) => { try { global.localStorage.removeItem(k); } catch (e) { /* 무시 */ } };

  /* ---------- 설정값 읽기·검사 ---------- */
  const KEYS = ['apiKey', 'authDomain', 'projectId', 'storageBucket', 'messagingSenderId', 'appId', 'space'];
  /** 붙여 넣은 글(콘솔의 const firebaseConfig = {...}; 그대로 또는 JSON) → { ok, config } | { ok:false, error } */
  const MAX_SRC = 20000;             // 콘솔의 설정값 글은 1~2천 자 — 이보다 길면 잘못 복사한 것
  function parseConfig(text) {
    const src = typeof text === 'string' ? text.trim() : (text && typeof text === 'object' ? JSON.stringify(text) : '');
    if (!src) return { ok: false, error: '설정값을 붙여 넣어 주세요.' };
    if (src.length > MAX_SRC) return { ok: false, error: '설정값이 너무 길어요 — 파이어베이스 콘솔의 설정값에서 중괄호 { } 안 내용만 복사해 주세요.' };
    const found = {};
    let obj = null;
    try { obj = JSON.parse(src); } catch (e) { obj = null; }
    if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
      KEYS.forEach((k) => { if (typeof obj[k] === 'string') found[k] = obj[k].trim(); });
    } else {
      // 이름 길이·값 길이에 상한, 이름 앞은 글자 경계 (긴 영문 글에서 되돌아가며 멈추지 않게)
      const re = /(?:^|[^A-Za-z])["']?([A-Za-z]{1,40})["']?\s*:\s*["'`]([^"'`\n]{0,300})["'`]/g;
      let m;
      while ((m = re.exec(src))) { if (KEYS.indexOf(m[1]) >= 0 && !(m[1] in found)) found[m[1]] = m[2].trim(); }
    }
    if (!Object.keys(found).length) return { ok: false, error: '설정값을 찾지 못했어요. 파이어베이스 콘솔의 \'내 앱\' 칸에 있는 설정값(중괄호 { } 안 내용 전체)을 그대로 복사해 붙여 넣어 주세요.' };
    if (!found.apiKey) return { ok: false, error: '설정값에 API 키(apiKey)가 없어요. 중괄호 { } 안 내용을 빠짐없이 복사해 주세요.' };
    if (!/^AIza[0-9A-Za-z_-]{30,}$/.test(found.apiKey)) return { ok: false, error: 'API 키가 맞지 않아요 — 설정값의 첫 줄(키 줄)을 빠짐없이 다시 복사해 주세요.' };
    if (!found.projectId) return { ok: false, error: '설정값에 프로젝트 아이디(projectId)가 없어요. 중괄호 { } 안 내용을 빠짐없이 복사해 주세요.' };
    if (!/^[a-z0-9][a-z0-9-]{2,62}$/.test(found.projectId)) return { ok: false, error: '프로젝트 아이디가 맞지 않아요 — 소문자·숫자·하이픈(-)만 들어 있어야 해요. 설정값을 다시 복사해 주세요.' };
    const cfg = { apiKey: found.apiKey, projectId: found.projectId };
    cfg.authDomain = found.authDomain || (found.projectId + '.firebaseapp.com');
    if (!/^[A-Za-z0-9.-]+$/.test(cfg.authDomain)) return { ok: false, error: '인증 주소가 맞지 않아요 — 설정값을 다시 복사해 주세요.' };
    if (found.appId) cfg.appId = found.appId;
    if (found.storageBucket) cfg.storageBucket = found.storageBucket;
    if (found.messagingSenderId) cfg.messagingSenderId = found.messagingSenderId;
    if (found.space) {
      if (!/^[A-Za-z0-9_-]{1,40}$/.test(found.space)) return { ok: false, error: '기록 묶음 이름은 영문 글자·숫자·-·_ 만 쓸 수 있어요.' };
      cfg.space = found.space;
    }
    return { ok: true, config: cfg };
  }
  function b64urlEncode(str) {
    const bytes = new TextEncoder().encode(str);
    let bin = '';
    bytes.forEach((b) => { bin += String.fromCharCode(b); });
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  function b64urlDecode(s) {
    let t = String(s).replace(/-/g, '+').replace(/_/g, '/');
    while (t.length % 4) t += '=';
    const bin = atob(t);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder().decode(bytes);
  }
  function readEmu() {
    const raw = lsGet(EMU_KEY);
    if (!raw) return null;
    try {
      const e = JSON.parse(raw);
      if (!e || !/^[A-Za-z0-9.-]+$/.test(String(e.host || '')) || !(e.firestore > 0) || !(e.auth > 0)) return null;
      return { host: String(e.host), firestore: Number(e.firestore), auth: Number(e.auth) };
    } catch (err) { return null; }
  }

  /* ---------- 초대 링크로 들어왔을 때 (app.js 가 화면을 그리기 전에) ---------- */
  let inviteNote = null;
  let inviteAsk = null;             // { cfg, cur } 이미 다른 저장소 설정이 있어 바꿀지 물어볼 초대 설정
  const sameStore = (a, b) => !!(a && b && a.apiKey === b.apiKey && a.projectId === b.projectId && (a.space || 'ours') === (b.space || 'ours'));
  (function takeInvite() {
    let params;
    try { params = new URLSearchParams(global.location.search); } catch (e) { return; }
    const raw = params.get('connect');
    if (raw === null) return;
    let res = { ok: false };
    try { res = parseConfig(JSON.parse(b64urlDecode(raw))); } catch (e) { res = { ok: false }; }
    if (res.ok && BAKED) {
      inviteNote = '이 앱에는 함께 쓰기 설정이 이미 들어 있어서 초대 링크의 설정은 쓰지 않아요. 로그인만 하면 돼요.';
    } else if (res.ok) {
      let cur = null;
      const raw0 = lsGet(CFG_KEY);
      if (raw0) { const r0 = parseConfig(raw0); if (r0.ok) cur = r0.config; }
      if (cur && !sameStore(cur, res.config)) {
        inviteAsk = { cfg: res.config, cur };   // 묻지 않고 바꾸지 않음 (옛 링크·남의 링크로 다른 저장소에 기록을 올리지 않게)
      } else if (lsSet(CFG_KEY, JSON.stringify(res.config))) inviteNote = cur ? null : '함께 쓰기 연결 정보를 받았어요. 로그인해 주세요.';
      else inviteNote = '이 브라우저는 저장이 막혀 있어 연결 정보를 기억할 수 없어요. 다른 브라우저(크롬·사파리)로 열어 주세요.';
    } else inviteNote = '초대 링크가 올바르지 않아요. 링크를 끝까지 복사했는지 확인하고 다시 받아 주세요.';
    params.delete('connect');
    const q = params.toString();
    try { global.history.replaceState(null, '', global.location.pathname + (q ? '?' + q : '') + '#/together'); } catch (e) { /* 무시 */ }
  })();

  function loadConfig() {
    if (BAKED) { const r = parseConfig(BAKED); if (r.ok) return { cfg: r.config, baked: true }; }
    const raw = lsGet(CFG_KEY);
    if (!raw) return null;
    const r = parseConfig(raw);
    return r.ok ? { cfg: r.config, baked: false } : null;
  }

  /* ---------- 공개 객체 ---------- */
  const listeners = new Set();
  const F = MV.fb = {
    available: true,
    configured: false,
    baked: false,
    config: null,          // 보여 주기용 (apiKey 는 앞 6자만)
    state: 'off',          // off | loading | login | ready | error
    user: null,            // { email }
    error: '',
    on(fn) { listeners.add(fn); return () => listeners.delete(fn); },
  };
  function emit() {
    listeners.forEach((fn) => { try { fn(F); } catch (e) { console.error(e); } });
    try { S.emit('fb', F); } catch (e) { /* 무시 */ }
  }
  function setState(st, extra) {
    F.state = st;
    if (extra && 'error' in extra) F.error = extra.error || '';
    else if (st !== 'error') F.error = '';
    emit();
  }
  /** sync.js 상태 칸 표시만 바꿈 (연결 안 된 동안) */
  function syncShow(status) {
    if (!Y) return;
    Y.backend = 'firebase';
    Y.detach(status, { keepBackend: true });
  }

  let cfg = null;
  let emu = null;
  let app = null;
  let auth = null;
  let fs = null;
  let adapter = null;
  let starting = null;

  /* ---------- SDK 늦게 불러오기 ---------- */
  function loadScript(url) {
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = url;
      s.async = false;
      s.crossOrigin = 'anonymous';
      const t = setTimeout(() => { s.remove(); reject(new Error('시간 초과')); }, SDK_TIMEOUT);
      s.onload = () => { clearTimeout(t); resolve(); };
      s.onerror = () => { clearTimeout(t); s.remove(); reject(new Error('불러오기 실패')); };
      document.head.appendChild(s);
    });
  }
  function sdkHas(file) {
    const fb = global.firebase;
    if (!fb) return false;
    if (file === 'firebase-app-compat.js') return typeof fb.initializeApp === 'function';
    if (file === 'firebase-auth-compat.js') return typeof fb.auth === 'function';
    return typeof fb.firestore === 'function';
  }
  async function loadSdk() {
    for (const f of SDK_FILES) {
      if (sdkHas(f)) continue;
      let ok = false;
      for (const cdn of CDNS) {
        try { await loadScript(cdn(f)); } catch (e) { console.info('[함께 쓰기] SDK 불러오기 실패', cdn(f), e && e.message); continue; }
        if (sdkHas(f)) { ok = true; break; }
      }
      if (!ok) throw new Error('함께 쓰기 프로그램(파이어베이스)을 불러오지 못했어요. 인터넷 연결을 확인하고 다시 시도하세요. 회사·학교 인터넷이나 광고 차단 앱이 막고 있을 수도 있어요.');
    }
  }

  /* ---------- 오류 코드 → sync.js 코드 ---------- */
  function mapErr(e, kind) {
    const fc = String((e && e.code) || '').replace(/^firestore\//, '');
    let code;
    switch (fc) {
      case 'permission-denied': code = kind === 'write' ? 'not_writer' : 'revoked'; break;
      case 'unauthenticated': code = 'revoked'; break;
      case 'resource-exhausted': code = 'quota_exceeded'; break;
      case 'invalid-argument': code = 'invalid_argument'; break;
      case 'not-found': case 'failed-precondition': code = 'revoked'; break;
      default: code = 'unavailable';
    }
    console.info('[함께 쓰기]', kind, fc || '(코드 없음)', e && e.message);
    const out = new Error(code === 'revoked' && (fc === 'not-found' || fc === 'failed-precondition')
      ? '파이어베이스에서 데이터베이스를 아직 만들지 않았어요.'
      : '함께 쓰기 저장소 오류');
    out.code = code;
    out.fbCode = fc;
    return out;
  }
  function fail(code) { const e = new Error('함께 쓰기 저장소에 연결하지 못했어요.'); e.code = code; e.fbCode = ''; return e; }

  /* ---------- sync.js 가 쓰는 db 모양의 어댑터 ---------- */
  function makeAdapter(email) {
    const space = (cfg && cfg.space) || 'ours';
    const FV = global.firebase.firestore.FieldValue;
    const home = fs.collection('homes').doc(space);
    const cols = new Map();
    const localDel = new Set();       // 보내는 중인 내 지우기 (메아리를 넘기지 않으려고)
    const stats = { listens: {}, snaps: 0, docsSeen: 0, writes: 0 };
    let closed = false;

    /** Firestore 문서 → { j, sa, key } (깨졌으면 null) */
    function enc(raw) {
      if (!raw || typeof raw.j !== 'string') return null;
      let body;
      try { body = JSON.parse(raw.j); } catch (e) { return null; }
      if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
      const sa = Array.isArray(raw.sa) ? raw.sa.filter((x) => typeof x === 'string') : [];
      return { j: raw.j, sa, key: raw.j + '\u0001' + sa.join(',') };
    }
    const docOut = (id, e) => ({ id, exists: true, data: () => Object.assign(JSON.parse(e.j), { _sa: e.sa.slice() }) });
    const snapOut = (changes) => ({ docChanges: () => changes, size: changes.length });

    function col(name) {
      let cs = cols.get(name);
      if (cs) return cs;
      cs = { name, docs: new Map(), ready: false, live: false, offline: false, waiters: [], buffer: [], next: null, onErr: null, fatal: null, unsub: null, delay: 5000, retryT: 0 };
      cols.set(name, cs);
      open(cs);
      return cs;
    }
    function open(cs) {
      if (closed) return;
      cs.live = false;
      stats.listens[cs.name] = (stats.listens[cs.name] || 0) + 1;
      try {
        cs.unsub = home.collection(cs.name).onSnapshot({ includeMetadataChanges: true }, (snap) => onFsSnap(cs, snap), (e) => onFsErr(cs, e));
      } catch (e) { onFsErr(cs, e); }
    }
    function anyOffline() { let off = false; cols.forEach((x) => { if (x.offline) off = true; }); return off; }
    function onFsSnap(cs, snap) {
      if (closed) return;
      const fromCache = !!(snap.metadata && snap.metadata.fromCache);
      if (!cs.live) {
        if (fromCache) return;          // (다시) 연 뒤 첫 서버 스냅샷 전의 캐시는 믿지 않음 (빠진 문서를 '지워짐'으로 잘못 볼 수 있음)
        cs.live = true;
        cs.delay = 5000;
      }
      stats.snaps++;
      // 연결 상태 힌트: 서버와 끊기면 캐시 스냅샷이 옴
      if (fromCache !== cs.offline) {
        cs.offline = fromCache;
        if (Y && Y._hint) Y._hint(anyOffline() ? 'disconnected' : 'online');
      }
      const changes = [];
      const ids = new Set();
      snap.docs.forEach((d) => {
        ids.add(d.id);
        const e = enc(d.data());
        if (!e) return;                // j 가 없거나 깨진 문서는 무시
        const prev = cs.docs.get(d.id);
        cs.docs.set(d.id, e);
        if (prev && prev.key === e.key) return;              // 메타데이터만 바뀜 (예: 서버가 내 쓰기를 받음)
        if (d.metadata && d.metadata.hasPendingWrites) return; // 내 대기 중 쓰기 (메아리)
        stats.docsSeen++;
        changes.push({ type: prev ? 'modified' : 'added', doc: docOut(d.id, e) });
      });
      Array.from(cs.docs.keys()).forEach((id) => {
        if (ids.has(id)) return;
        cs.docs.delete(id);
        if (localDel.has(cs.name + '/' + id)) return;         // 내가 지운 것
        changes.push({ type: 'removed', doc: { id, exists: false, data: () => undefined } });
      });
      if (!cs.ready) {
        cs.ready = true;
        cs.buffer = [];
        cs.waiters.splice(0).forEach((w) => w.ok());
        return;
      }
      if (!changes.length) return;
      if (cs.next) cs.next(snapOut(changes));
      else cs.buffer.push(...changes);
    }
    function onFsErr(cs, e) {
      if (closed) return;
      cs.unsub = null;                 // Firestore 구독은 오류가 나면 끝남
      const err = mapErr(e, 'read');
      if (err.code === 'revoked') cs.fatal = err;
      cs.waiters.splice(0).forEach((w) => w.no(err));
      if (cs.onErr) { try { cs.onErr(err); } catch (x) { console.error(x); } }
      if (err.code !== 'revoked') {
        // 잠시 뒤 구독을 다시 엶 (5초 → 최대 60초)
        clearTimeout(cs.retryT);
        cs.retryT = setTimeout(() => { if (!closed && !cs.unsub) open(cs); }, cs.delay);
        cs.delay = Math.min(60000, cs.delay * 2);
      }
    }
    function track(p, key) {
      let done = false;
      const t = setTimeout(() => { if (!done && !closed && Y && Y._hint) Y._hint('offline'); }, SLOW_WRITE);
      return Promise.resolve(p).then(() => { done = true; clearTimeout(t); }, (e) => {
        done = true;
        clearTimeout(t);
        if (key) localDel.delete(key);
        throw mapErr(e, 'write');
      });
    }
    const SEG = /^[A-Za-z0-9_\-.~:@+]{1,200}$/;

    return {
      doc(path) {
        const parts = String(path).split('/');
        if (parts.length !== 2 || !SEG.test(parts[0]) || !SEG.test(parts[1]) || parts[1] === '.' || parts[1] === '..' || /^__.*__$/.test(parts[1])) throw new TypeError('쓸 수 없는 경로');
        const key = parts[0] + '/' + parts[1];
        const ref = home.collection(parts[0]).doc(parts[1]);
        return {
          set(obj) {
            if (closed) return Promise.reject(fail('unavailable'));
            const body = Object.assign({}, obj);
            const sa = Array.isArray(body._sa) ? body._sa.filter((x) => typeof x === 'string') : [];
            delete body._sa;
            let j;
            try { j = JSON.stringify(body); } catch (e) { return Promise.reject(Object.assign(new Error('저장할 수 없는 내용'), { code: 'invalid_argument', fbCode: '' })); }
            stats.writes++;
            localDel.delete(key);
            let p;
            try { p = ref.set({ j, sa, at: FV.serverTimestamp(), by: email || '' }); } catch (e) { p = Promise.reject(e); }
            return track(p);
          },
          delete() {
            if (closed) return Promise.reject(fail('unavailable'));
            stats.writes++;
            localDel.add(key);
            let p;
            try { p = ref.delete(); } catch (e) { p = Promise.reject(e); }
            return track(p, key).then(() => { localDel.delete(key); });
          },
        };
      },
      collection(name) {
        return {
          get() {
            const cs = col(name);
            if (cs.fatal) return Promise.reject(cs.fatal);
            if (cs.ready) { cs.buffer = []; return Promise.resolve(qs(cs)); }
            if (!cs.unsub && !cs.retryT) open(cs);
            return new Promise((resolve, reject) => {
              const w = {
                ok: () => { clearTimeout(t); cs.buffer = []; resolve(qs(cs)); },
                no: (e) => { clearTimeout(t); reject(e); },
              };
              const t = setTimeout(() => { const i = cs.waiters.indexOf(w); if (i >= 0) cs.waiters.splice(i, 1); reject(fail('unavailable')); }, READY_TIMEOUT);
              cs.waiters.push(w);
            });
          },
          onSnapshot(next, onErr) {
            const cs = col(name);
            cs.next = next;
            cs.onErr = onErr || null;
            if (cs.fatal) { const fe = cs.fatal; setTimeout(() => { if (cs.onErr === onErr && onErr) onErr(fe); }, 0); }
            // get() 과 등록 사이에 온 변경 (순서를 지키려고 바로 넘김)
            if (cs.buffer.length) { const b = cs.buffer.splice(0); try { next(snapOut(b)); } catch (e) { console.error(e); } }
            return () => { if (cs.next === next) { cs.next = null; cs.onErr = null; } };
          },
        };
      },
      close() {
        closed = true;
        cols.forEach((cs) => {
          clearTimeout(cs.retryT);
          if (cs.unsub) { try { cs.unsub(); } catch (e) { /* 무시 */ } }
          cs.unsub = null;
          cs.waiters.splice(0).forEach((w) => w.no(fail('unavailable')));
        });
      },
      get closed() { return closed; },
      stats,
      email,
    };
    function qs(cs) {
      const docs = [];
      cs.docs.forEach((e, id) => docs.push(docOut(id, e)));
      return { docs, size: docs.length, empty: !docs.length };
    }
  }

  /* ---------- 로그인 ---------- */
  function authText(e) {
    const code = String((e && e.code) || '');
    console.info('[함께 쓰기] 로그인', code, e && e.message);
    if (/invalid-credential|wrong-password|user-not-found|invalid-login-credentials/.test(code)) return '이메일이나 비밀번호가 맞지 않아요.';
    if (/missing-password/.test(code)) return '비밀번호를 입력해 주세요.';
    if (/invalid-email|missing-email/.test(code)) return '이메일 형식이 맞지 않아요. 예) 이름@메일주소';
    if (/too-many-requests/.test(code)) return '여러 번 틀려서 잠시 막혔어요. 몇 분 뒤 다시 하거나 \'비밀번호를 잊었어요\'로 재설정하세요.';
    if (/network-request-failed/.test(code)) return '인터넷에 연결되지 않았어요. 연결을 확인하고 다시 해 보세요.';
    if (/operation-not-allowed/.test(code)) return '파이어베이스에서 이메일/비밀번호 로그인을 아직 켜지 않았어요 (설정 안내 ③단계).';
    if (/user-disabled/.test(code)) return '이 계정은 사용 중지돼 있어요. 파이어베이스 콘솔의 사용자 목록에서 확인하세요.';
    if (/invalid-api-key|api-key-not-valid|api-key-expired/.test(code)) return '설정값의 API 키가 맞지 않아요. 함께 쓰기 화면에서 설정값을 다시 붙여 넣어 주세요.';
    if (/unauthorized-domain|unauthorized-continue-uri/.test(code)) return '이 앱 주소가 파이어베이스의 승인된 도메인에 없어요. 파이어베이스 콘솔 → 인증 → 설정 → 승인된 도메인에 이 주소를 더해 주세요.';
    if (/admin-restricted-operation/.test(code)) return '이 작업은 파이어베이스에서 막혀 있어요. 계정은 파이어베이스 콘솔에서 직접 만들어 주세요.';
    return '로그인하지 못했어요. 잠시 뒤 다시 해 보세요.';
  }
  F.login = function login(email, pw) {
    if (!auth) return Promise.reject(new Error(F.state === 'error' ? F.error : '함께 쓰기를 준비하는 중이에요. 잠시 뒤 다시 해 보세요.'));
    const em = String(email || '').trim();
    if (!em) return Promise.reject(new Error('이메일을 입력해 주세요.'));
    if (!pw) return Promise.reject(new Error('비밀번호를 입력해 주세요.'));
    return auth.signInWithEmailAndPassword(em, String(pw)).then(() => true, (e) => { throw new Error(authText(e)); });
  };
  F.logout = function logout() {
    // 구독이 '권한 없음'으로 끊겨 엉뚱한 안내가 뜨지 않게, 먼저 연결을 끊고 로그아웃
    closeAdapter();
    F.user = null;
    if (auth) syncShow('login');
    setState(auth ? 'login' : F.state);
    return auth ? auth.signOut().then(() => true, (e) => { console.info('[함께 쓰기] 로그아웃', e && e.code); return true; }) : Promise.resolve(true);
  };
  F.resetPassword = function resetPassword(email) {
    if (!auth) return Promise.reject(new Error('함께 쓰기를 준비하는 중이에요. 잠시 뒤 다시 해 보세요.'));
    const em = String(email || '').trim();
    if (!em) return Promise.reject(new Error('이메일 칸에 이메일을 먼저 적어 주세요.'));
    return auth.sendPasswordResetEmail(em).then(() => true, (e) => {
      const code = String((e && e.code) || '');
      if (/user-not-found/.test(code)) return true;   // 계정이 있는지 알려 주지 않음
      throw new Error(authText(e));
    });
  };

  /** 이미 다른 저장소 설정이 있는데 초대 링크가 왔을 때: 바꿀지 물어봄 */
  function askInvite() {
    const a = inviteAsk;
    inviteAsk = null;
    if (!a || !MV.ui || !MV.ui.confirm) return;
    const pj = (c) => c.projectId + (c.space && c.space !== 'ours' ? ' · 묶음 ' + c.space : '');
    MV.ui.confirm('다른 함께 쓰기 저장소(프로젝트 ' + pj(a.cfg) + ')로 바꿀까요? 지금 설정(프로젝트 ' + pj(a.cur) + ')은 지워지고, 새 저장소에 다시 로그인해야 해요. 이 기기 기록은 그대로 남아요. 누가 보냈는지 모르는 링크라면 [취소]를 누르세요.', { okLabel: '바꾸기', danger: true }).then((ok) => {
      if (!ok) { MV.ui.toast('초대 링크의 설정은 쓰지 않았어요. 지금 설정을 그대로 써요.'); return; }
      if (!lsSet(CFG_KEY, JSON.stringify(a.cfg))) { MV.ui.toast('이 브라우저에 저장할 수 없어요 (사생활 보호 창이거나 저장이 막혀 있어요).', { ms: 5000 }); return; }
      const go = () => { try { global.location.hash = '#/together'; global.location.reload(); } catch (e) { /* 무시 */ } };
      closeAdapter();
      if (auth && auth.currentUser) auth.signOut().then(go, go); else go();
    });
  }

  /* ---------- 연결 ---------- */
  function closeAdapter() {
    if (adapter) { try { adapter.close(); } catch (e) { /* 무시 */ } }
    adapter = null;
  }
  function attach() {
    const u = auth && auth.currentUser;
    if (!u) return;
    closeAdapter();
    adapter = makeAdapter(u.email || '');
    F._adapter = adapter;
    // 같은 저장소(프로젝트·기록 묶음)에 다시 붙으면 sync.js 가 이 기기에서 고친 것을 공유 기록과 합침
    const connId = 'firebase:' + cfg.projectId + '/' + (cfg.space || 'ours') + (emu ? '@' + emu.host + ':' + emu.firestore : '');
    Y.attach(adapter, { backend: 'firebase', account: u.email || '', connId });
  }
  let retryT = 0;
  let retryDelay = 15000;
  function onSyncStatus(ev) {
    const st = ev && ev.status;
    if (!adapter || F.state !== 'ready') return;
    if (st === 'revoked') {
      // 권한 없음: 구독을 닫아 읽기를 아낌 (다시 시도·다시 로그인하면 새로 엶)
      closeAdapter();
      return;
    }
    if (st === 'unreachable') {
      clearTimeout(retryT);
      retryT = setTimeout(() => { if (Y.status === 'unreachable' && F.state === 'ready') F.retry(); }, retryDelay);
      retryDelay = Math.min(120000, retryDelay * 2);
    } else if (st === 'synced' || st === 'empty' || st === 'readonly') retryDelay = 15000;
  }
  /** 다시 시도: SDK 를 못 불러왔으면 다시 불러오고, 로그인돼 있으면 다시 연결 */
  F.retry = function retry() {
    clearTimeout(retryT);
    if (F.state === 'error' || !app) { start(); return; }
    if (auth && auth.currentUser) attach();
  };

  async function init() {
    const r = loadConfig();
    if (!r) { F.configured = false; F.config = null; setState('off'); return; }
    cfg = r.cfg;
    F.configured = true;
    F.baked = r.baked;
    F.config = Object.assign({}, cfg, { apiKey: cfg.apiKey.slice(0, 6) + '…' });
    emu = readEmu();
    setState('loading');
    syncShow('connecting');
    try { await loadSdk(); } catch (e) {
      syncShow('unreachable');
      setState('error', { error: e.message });
      return;
    }
    try {
      const fb = global.firebase;
      const had = fb.apps.find((a) => a.name === 'move');
      app = had || fb.initializeApp(Object.assign({}, cfg), 'move');
      try { fb.firestore.setLogLevel('silent'); } catch (e) { /* 무시 */ }
      auth = app.auth();
      fs = app.firestore();
      if (emu && !had) {
        fs.useEmulator(emu.host, emu.firestore);
        auth.useEmulator('http://' + emu.host + ':' + emu.auth, { disableWarnings: true });
      }
    } catch (e) {
      console.info('[함께 쓰기] 시작 실패', e && e.code, e && e.message);
      app = null; auth = null; fs = null;
      syncShow('unreachable');
      setState('error', { error: '함께 쓰기를 시작하지 못했어요. 설정값이 맞는지 확인하고 다시 붙여 넣어 주세요.' });
      return;
    }
    auth.onAuthStateChanged((u) => {
      if (u) {
        F.user = { email: u.email || '' };
        setState('ready');
        attach();
      } else {
        closeAdapter();
        F.user = null;
        syncShow('login');
        setState('login');
      }
    }, (e) => { console.info('[함께 쓰기] 로그인 상태', e && e.code); });
  }
  function start() {
    if (starting) return starting;
    starting = init().catch((e) => { console.error(e); }).finally(() => { starting = null; });
    return starting;
  }

  /* ---------- 설정 저장·지우기 ---------- */
  F.parseConfig = parseConfig;
  F.saveConfig = function saveConfig(text) {
    const r = parseConfig(text);
    if (!r.ok) return r;
    if (BAKED) return { ok: false, error: '이 앱에는 설정값이 이미 들어 있어요. 바꾸려면 저장소의 설정을 고쳐야 해요.' };
    if (!lsSet(CFG_KEY, JSON.stringify(r.config))) return { ok: false, error: '이 브라우저에 저장할 수 없어요 (사생활 보호 창이거나 저장이 막혀 있어요).' };
    if (app) {
      // 이미 다른 설정으로 시작했으면 새로 열어서 새 설정으로 (로그인 상태는 프로젝트마다 따로)
      setTimeout(() => { try { global.location.hash = '#/together'; global.location.reload(); } catch (e) { /* 무시 */ } }, 600);
    } else start();
    return { ok: true, config: r.config };
  };
  F.clearConfig = function clearConfig() {
    const done = () => {
      lsDel(CFG_KEY);
      closeAdapter();
      Y.detach('local');
      try { global.location.hash = '#/together'; global.location.reload(); } catch (e) { /* 무시 */ }
      return true;
    };
    if (auth && auth.currentUser) return auth.signOut().then(done, done);
    return Promise.resolve(done());
  };
  F.inviteLink = function inviteLink() {
    if (!cfg) return '';
    const base = global.location.origin + global.location.pathname;
    if (F.baked) return base + '#/together';
    const o = { apiKey: cfg.apiKey, authDomain: cfg.authDomain, projectId: cfg.projectId };
    if (cfg.appId) o.appId = cfg.appId;
    if (cfg.space) o.space = cfg.space;
    return base + '?connect=' + b64urlEncode(JSON.stringify(o)) + '#/together';
  };
  /** 파이어베이스 규칙 글 (이메일은 이 화면에서만 쓰고 어디에도 저장하지 않음) */
  F.rulesText = function rulesText(email1, email2) {
    const RE = /^[^\s@'"\\,\[\]]+@[^\s@'"\\,\[\]]+\.[^\s@'"\\,\[\]]+$/;
    const list = [email1, email2].map((x) => String(x || '').trim().toLowerCase()).filter(Boolean);
    if (!list.length) return { ok: false, error: '이메일을 적어 주세요 (나·아내 두 사람).' };
    const bad = list.find((x) => !RE.test(x));
    if (bad) return { ok: false, error: '이메일 형식이 맞지 않아요: ' + bad };
    const uniq = Array.from(new Set(list));
    const text = [
      "rules_version = '2';",
      'service cloud.firestore {',
      '  match /databases/{database}/documents {',
      '    match /homes/{home}/{document=**} {',
      '      allow read, write: if request.auth != null',
      '        && request.auth.token.email.lower() in [' + uniq.map((x) => "'" + x + "'").join(', ') + '];',
      '    }',
      '  }',
      '}',
    ].join('\n');
    return { ok: true, text };
  };

  if (Y) S.on('sync', onSyncStatus);
  global.addEventListener('online', () => { if (Y && Y.backend === 'firebase' && (Y.status === 'unreachable' || F.state === 'error')) F.retry(); });
  const boot = () => {
    if (inviteNote && MV.ui && MV.ui.toast) setTimeout(() => MV.ui.toast(inviteNote, { ms: 6000 }), 300);
    if (inviteAsk) setTimeout(askInvite, 400);
    start();
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else setTimeout(boot, 0);

  // 테스트·디버깅용
  F._debug = { parseConfig, b64urlEncode, b64urlDecode, mapErr, get adapter() { return adapter; }, get app() { return app; } };
})(window);
