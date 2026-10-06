/* ============================================================
   우리집 이사 관리 — core (전역 이름: MV)
   의존성 없음. 다른 모든 js 파일은 이 파일이 만든 MV 위에 올라갑니다.

   ── 계약(contract) 요약 ─────────────────────────────────────
   DOM      MV.el(tag, props, ...kids) / MV.svg(tag, attrs, ...kids) / MV.$ / MV.$$
            MV.css(id, cssText)  뷰 전용 스타일을 한 번만 주입
            MV.esc(s) / MV.linkify(text) → DocumentFragment (URL 링크화 + 줄바꿈)
   유틸     MV.uid(prefix) / MV.clone(o) / MV.debounce(fn, ms) / MV.clamp(n, a, b)
   날짜     MV.date.today() 'YYYY-MM-DD' (?today=YYYY-MM-DD 로 덮어쓰기 가능)
            MV.date.parse(s) / str(d) / add(s, n) / diff(a, b) (= b - a 일수)
            MV.date.dday(s) → {n, label, overdue}  /  fmt(s) '11/3(화)'  /  fmtLong(s)
            MV.date.weekStart(s) 월요일 / MV.date.moveDate() 이사일
   돈       MV.fmt.won(n) '295,700,000원' / num(n) / man(n) '120만원'
            eok(n) '2억 9,570만원' / krw(n) 크기에 맞춰 / pct(x, d)
            MV.parseMoney('3.78억' | '2억 9,570만' | '120만' | '1,200,000') → 원
   저장소   MV.store.get() → state
            MV.store.update(fn(state), {log, silent}) 변경 + 저장 + 'change' 알림
            MV.store.on('change', fn) → 해제함수
            MV.store.ensure(key, defaultsFactory) 모듈 전용 하위 상태 확보
            MV.store.log(text) 활동 기록 / exportJSON() / importJSON(text) / reset()
   체크     MV.parts.list() / get(id) / add(p) / update(id, patch) / remove(id) / stats(id)
            MV.items.list(filterFn) / byPart(id) / get(id) / add(p) / update(id, patch)
            MV.items.remove(id) / toggle(id) / addNote(id, text) / removeNote(id, noteId)
            MV.items.status(item) → 'done'|'overdue'|'today'|'soon'|'week'|'later'|'nodate'
   짐목록   MV.inv.list(filterFn) / get / add / update / remove / volume(item) m³
            MV.inv.CATS / MV.inv.FATES / MV.inv.cat(id) / MV.inv.fate(id)
            MV.inv.editor(idOrNull, {preset, defaults, onSave}) 편집 모달
   계산     MV.calc.* — 모듈이 등록 (moveEstimate, financeSummary 등). 없을 수 있으니 ?.() 로 호출.
   라우팅   MV.view(name, {title, icon, order, nav, badge(), render(root, params, ctx)})
            ctx.onCleanup(fn) / ctx.subscribe(fn) (뷰를 떠날 때 자동 해제)
            MV.go('#/checklist/money') / MV.route → {name, params}
   UI       MV.ui.modal({title, body, wide, actions:[{label, kind, onClick(close)}], onClose})
            MV.ui.confirm(msg, {okLabel, danger}) → Promise<bool>
            MV.ui.prompt(title, {value, placeholder, multiline, label}) → Promise<string|null>
            MV.ui.toast(msg, {action:{label, onClick}, ms})
            MV.ui.progress(pct, cls) / MV.ui.dueChip(dateStr, done) / MV.ui.moneyInput(value, onChange, opts)
            MV.ui.download(filename, text, mime)
   ============================================================ */
(function (global) {
  'use strict';

  const MV = global.MV = global.MV || {};
  MV.VERSION = '1.0.0';

  /* ---------------- DOM ---------------- */
  function applyProps(node, props, isSvg) {
    for (const [k, v] of Object.entries(props)) {
      if (v === null || v === undefined || v === false) continue;
      if (k === 'class' || k === 'className') {
        if (isSvg) node.setAttribute('class', v); else node.className = v;
      } else if (k === 'style' && typeof v === 'object') {
        for (const [sk, sv] of Object.entries(v)) {
          if (sv === null || sv === undefined) continue;
          if (sk.startsWith('--')) node.style.setProperty(sk, String(sv));
          else node.style[sk] = sv;
        }
      } else if (k === 'html') node.innerHTML = v;
      else if (k === 'text') node.textContent = v;
      else if (k === 'dataset' && typeof v === 'object') Object.assign(node.dataset, v);
      else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2).toLowerCase(), v);
      else if (!isSvg && (k === 'value' || k === 'checked' || k === 'disabled' || k === 'selected' || k === 'hidden')) node[k] = v;
      else node.setAttribute(k, v === true ? '' : String(v));
    }
  }
  function appendKids(node, kids) {
    for (const kid of kids.flat(Infinity)) {
      if (kid === null || kid === undefined || kid === false) continue;
      node.appendChild(kid instanceof Node ? kid : document.createTextNode(String(kid)));
    }
  }
  function isProps(p) {
    return p && typeof p === 'object' && !(p instanceof Node) && !Array.isArray(p);
  }
  MV.el = function el(tag, props, ...kids) {
    const node = document.createElement(tag);
    if (!isProps(props)) { kids.unshift(props); props = null; }
    if (props) applyProps(node, props, false);
    appendKids(node, kids);
    return node;
  };
  const SVGNS = 'http://www.w3.org/2000/svg';
  MV.svg = function svg(tag, attrs, ...kids) {
    const node = document.createElementNS(SVGNS, tag);
    if (!isProps(attrs)) { kids.unshift(attrs); attrs = null; }
    if (attrs) applyProps(node, attrs, true);
    appendKids(node, kids);
    return node;
  };
  MV.$ = (sel, root) => (root || document).querySelector(sel);
  MV.$$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));

  const injected = new Set();
  MV.css = function css(id, text) {
    if (injected.has(id)) return;
    injected.add(id);
    const s = document.createElement('style');
    s.dataset.mv = id;
    s.textContent = text;
    document.head.appendChild(s);
  };

  MV.esc = (s) => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

  const URL_RE = /(https?:\/\/[^\s<>"')\]]+)/g;
  MV.linkify = function linkify(text) {
    const frag = document.createDocumentFragment();
    const lines = String(text == null ? '' : text).split('\n');
    lines.forEach((line, li) => {
      if (li) frag.appendChild(document.createElement('br'));
      let last = 0;
      line.replace(URL_RE, (m, url, idx) => {
        if (idx > last) frag.appendChild(document.createTextNode(line.slice(last, idx)));
        const a = document.createElement('a');
        a.href = url; a.target = '_blank'; a.rel = 'noopener noreferrer';
        a.textContent = url.length > 60 ? url.slice(0, 57) + '…' : url;
        frag.appendChild(a);
        last = idx + m.length;
        return m;
      });
      if (last < line.length) frag.appendChild(document.createTextNode(line.slice(last)));
    });
    return frag;
  };

  /* ---------------- 유틸 ---------------- */
  let uidSeq = 0;
  MV.uid = (prefix) => (prefix || 'id') + '_' + Date.now().toString(36) + (uidSeq++).toString(36) + Math.random().toString(36).slice(2, 6);
  MV.clone = (o) => (o === undefined ? undefined : JSON.parse(JSON.stringify(o)));
  MV.debounce = function (fn, ms) {
    let t = null;
    const d = function (...a) { clearTimeout(t); t = setTimeout(() => { t = null; fn.apply(this, a); }, ms); };
    d.flush = function (...a) { if (t) { clearTimeout(t); t = null; fn.apply(this, a); } };
    return d;
  };
  MV.clamp = (n, a, b) => Math.min(b, Math.max(a, n));
  MV.round = (n, step) => Math.round(n / (step || 1)) * (step || 1);
  MV.nowISO = () => new Date().toISOString();

  /* ---------------- 날짜 ---------------- */
  const WEEK = ['일', '월', '화', '수', '목', '금', '토'];
  const pad = (n) => String(n).padStart(2, '0');
  const D = MV.date = {};
  D.str = (d) => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  D.parse = (s) => {
    if (!s) return null;
    const m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(String(s));
    if (!m) return null;
    return new Date(+m[1], +m[2] - 1, +m[3]);
  };
  D.valid = (s) => !!D.parse(s);
  let todayOverride = null;
  try {
    const q = new URLSearchParams(global.location.search).get('today');
    if (q && /^\d{4}-\d{2}-\d{2}$/.test(q)) todayOverride = q;
  } catch (e) { /* 무시 */ }
  D.today = () => todayOverride || D.str(new Date());
  D.add = (s, n) => { const d = D.parse(s); d.setDate(d.getDate() + n); return D.str(d); };
  D.diff = (a, b) => Math.round((D.parse(b) - D.parse(a)) / 86400000);
  D.dday = (s) => {
    if (!D.valid(s)) return { n: null, label: '', overdue: false };
    const n = D.diff(D.today(), s);
    return { n, label: n === 0 ? 'D-day' : n > 0 ? 'D-' + n : 'D+' + (-n), overdue: n < 0 };
  };
  D.fmt = (s) => { const d = D.parse(s); return d ? (d.getMonth() + 1) + '/' + d.getDate() + '(' + WEEK[d.getDay()] + ')' : ''; };
  D.fmtLong = (s) => { const d = D.parse(s); return d ? d.getFullYear() + '년 ' + (d.getMonth() + 1) + '월 ' + d.getDate() + '일 (' + WEEK[d.getDay()] + ')' : ''; };
  D.weekday = (s) => { const d = D.parse(s); return d ? WEEK[d.getDay()] : ''; };
  D.weekStart = (s) => { const d = D.parse(s); const wd = (d.getDay() + 6) % 7; d.setDate(d.getDate() - wd); return D.str(d); };
  D.moveDate = () => (MV.store.state && MV.store.state.meta && MV.store.state.meta.moveDate) || '2026-11-03';
  D.time = (iso) => {
    const d = new Date(iso);
    if (isNaN(d)) return '';
    return (d.getMonth() + 1) + '/' + d.getDate() + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
  };

  /* ---------------- 돈 ---------------- */
  const F = MV.fmt = {};
  F.num = (n) => (n == null || isNaN(n)) ? '-' : Math.round(n).toLocaleString('ko-KR');
  F.won = (n) => (n == null || isNaN(n)) ? '-' : F.num(n) + '원';
  F.man = (n) => {
    if (n == null || isNaN(n)) return '-';
    const v = n / 10000;
    const r = Math.abs(v) >= 100 ? Math.round(v) : Math.round(v * 10) / 10;
    return r.toLocaleString('ko-KR') + '만원';
  };
  F.eok = (n) => {
    if (n == null || isNaN(n)) return '-';
    const neg = n < 0; let v = Math.abs(Math.round(n));
    const eok = Math.floor(v / 1e8); v -= eok * 1e8;
    const man = Math.floor(v / 1e4); const won = v - man * 1e4;
    const parts = [];
    if (eok) parts.push(eok.toLocaleString('ko-KR') + '억');
    if (man) parts.push(man.toLocaleString('ko-KR') + '만');
    if (won && !eok) parts.push(won.toLocaleString('ko-KR'));
    const s = (parts.join(' ') || '0') + '원';
    return (neg ? '−' : '') + s;
  };
  F.krw = (n) => {
    if (n == null || isNaN(n)) return '-';
    const a = Math.abs(n);
    if (a >= 1e8) return F.eok(n);
    if (a >= 1e4) return F.man(n);
    return F.won(n);
  };
  F.pct = (x, d) => (x == null || isNaN(x)) ? '-' : (x * 100).toFixed(d == null ? 1 : d) + '%';
  MV.parseMoney = function parseMoney(input) {
    if (typeof input === 'number') return input;
    let s = String(input == null ? '' : input).replace(/[\s,원₩]/g, '');
    if (!s) return 0;
    let neg = false;
    if (/^[-−]/.test(s)) { neg = true; s = s.slice(1); }
    let total = 0; let matched = false;
    const eok = /([\d.]+)억/.exec(s);
    if (eok) { total += parseFloat(eok[1]) * 1e8; s = s.replace(eok[0], ''); matched = true; }
    const cheon = /([\d.]+)천만/.exec(s);
    if (cheon) { total += parseFloat(cheon[1]) * 1e7; s = s.replace(cheon[0], ''); matched = true; }
    const man = /([\d.]+)만/.exec(s);
    if (man) { total += parseFloat(man[1]) * 1e4; s = s.replace(man[0], ''); matched = true; }
    const rest = parseFloat(s);
    if (!isNaN(rest)) total += rest; else if (!matched) return NaN;
    return Math.round(neg ? -total : total);
  };

  /* ---------------- 이벤트 ---------------- */
  function emitter() {
    const map = {};
    return {
      on(ev, fn) { (map[ev] = map[ev] || new Set()).add(fn); return () => map[ev] && map[ev].delete(fn); },
      emit(ev, data) { (map[ev] || []).forEach((fn) => { try { fn(data); } catch (e) { console.error(e); } }); },
    };
  }

  /* ---------------- 저장소 ----------------
     state = {
       version: 1, seedVersion: n,
       meta: { moveDate, createdAt, updatedAt, deletedSeed: [id...] },
       parts: [{ id, name, emoji, group, desc, guide, order }],
       items: [{ id, partId, title, detail, due, done, doneAt, priority, owner,
                 notes: [{ id, text, at }], links: [{label,url}], guide, order, seed, createdAt, updatedAt }],
       inventory: [{ id, name, cat, fate, qty, w, d, h, url, room, roomNew, lg, ac, tag, note, assumed, seed }],
                 // tag: 'fridge'|'washer'|'dryer'|'wardrobe'|'bed'|'sofa'|'tv'|'desk'|'table'|'shelf'|'aircon'|'' (의미 검색용)
       activity: [{ at, text }],
       ...모듈 하위 상태 (ensure 로 생성): layouts, planEdits, estimate, finance, ui
     }
  ------------------------------------------ */
  const KEY = 'mv:state:v1';
  const bus = emitter();
  const S = MV.store = { state: null, storageOK: true, lastSaved: null };

  function normItem(it, seed) {
    const now = MV.nowISO();
    return Object.assign({
      id: MV.uid('it'), partId: '', title: '', detail: '', due: null, done: false, doneAt: null,
      priority: 'mid', owner: '', notes: [], links: [], guide: '', order: 0, seed: !!seed,
      createdAt: now, updatedAt: now,
    }, it, { notes: (it && it.notes) ? it.notes.slice() : [], links: (it && it.links) ? it.links.slice() : [] });
  }
  function normInv(it, seed) {
    return Object.assign({
      id: MV.uid('inv'), name: '', cat: 'misc', fate: 'move', qty: 1, w: 60, d: 60, h: 60,
      url: '', room: '', roomNew: '', lg: false, ac: null, tag: '', note: '', assumed: false, seed: !!seed,
    }, it);
  }
  function freshState() {
    const seed = MV.seed || { version: 0, parts: [], items: [], inventory: [] };
    const now = MV.nowISO();
    return {
      version: 1,
      seedVersion: seed.version || 0,
      meta: { moveDate: seed.moveDate || '2026-11-03', createdAt: now, updatedAt: now, deletedSeed: [] },
      parts: MV.clone(seed.parts || []).map((p, i) => Object.assign({ order: i }, p)),
      items: (seed.items || []).map((it, i) => normItem(Object.assign({ order: i }, MV.clone(it)), true)),
      inventory: (seed.inventory || []).map((it) => normInv(MV.clone(it), true)),
      activity: [{ at: now, text: '이사 관리 시작 — 기본 체크리스트를 불러왔습니다.' }],
    };
  }
  function mergeSeed(state) {
    const seed = MV.seed;
    if (!seed || !seed.version || (state.seedVersion || 0) >= seed.version) return false;
    const deleted = new Set(state.meta.deletedSeed || []);
    const partIds = new Set(state.parts.map((p) => p.id));
    const itemIds = new Set(state.items.map((i) => i.id));
    const invIds = new Set(state.inventory.map((i) => i.id));
    let added = 0;
    (seed.parts || []).forEach((p, i) => {
      if (!partIds.has(p.id) && !deleted.has(p.id)) { state.parts.push(Object.assign({ order: 100 + i }, MV.clone(p))); added++; }
    });
    (seed.items || []).forEach((it, i) => {
      if (!itemIds.has(it.id) && !deleted.has(it.id)) { state.items.push(normItem(Object.assign({ order: 1000 + i }, MV.clone(it)), true)); added++; }
    });
    (seed.inventory || []).forEach((it) => {
      if (!invIds.has(it.id) && !deleted.has(it.id)) { state.inventory.push(normInv(MV.clone(it), true)); added++; }
    });
    state.seedVersion = seed.version;
    if (added) state.activity.unshift({ at: MV.nowISO(), text: '새 기본 항목 ' + added + '개를 추가했습니다 (기존 메모·완료 표시는 그대로).' });
    return true;
  }
  function validState(s) {
    return s && typeof s === 'object' && Array.isArray(s.parts) && Array.isArray(s.items) && s.meta;
  }
  S.load = function load() {
    let st = null;
    try {
      const raw = global.localStorage.getItem(KEY);
      if (raw) st = JSON.parse(raw);
    } catch (e) { S.storageOK = false; }
    if (!validState(st)) st = freshState();
    st.inventory = st.inventory || [];
    st.activity = st.activity || [];
    st.meta.deletedSeed = st.meta.deletedSeed || [];
    const merged = mergeSeed(st);
    S.state = st;
    if (merged) S.persist();
    return st;
  };
  S.persist = function persist() {
    if (!S.state) return;
    S.state.meta.updatedAt = MV.nowISO();
    try {
      global.localStorage.setItem(KEY, JSON.stringify(S.state));
      S.lastSaved = Date.now();
      S.storageOK = true;
    } catch (e) {
      if (S.storageOK) MV.ui && MV.ui.toast && MV.ui.toast('브라우저 저장소를 쓸 수 없어 이 창을 닫으면 사라집니다. ⋯ 메뉴에서 백업하세요.');
      S.storageOK = false;
    }
  };
  const persistSoon = MV.debounce(() => S.persist(), 250);
  global.addEventListener('pagehide', () => persistSoon.flush());
  global.addEventListener('beforeunload', () => persistSoon.flush());

  S.get = () => S.state || S.load();
  S.update = function update(fn, opts) {
    opts = opts || {};
    const st = S.get();
    const r = fn(st);
    if (opts.log) S.log(opts.log, true);
    persistSoon();
    if (!opts.silent) bus.emit('change', { log: opts.log || null, source: opts.source || null });
    return r;
  };
  S.on = (ev, fn) => bus.on(ev, fn);
  S.emit = (ev, data) => bus.emit(ev, data);
  S.ensure = function ensure(key, defaultsFactory) {
    const st = S.get();
    const defs = typeof defaultsFactory === 'function' ? defaultsFactory() : defaultsFactory;
    if (st[key] === undefined || st[key] === null) {
      st[key] = MV.clone(defs);
      persistSoon();
    } else if (defs && typeof defs === 'object' && !Array.isArray(defs) && typeof st[key] === 'object' && !Array.isArray(st[key])) {
      let changed = false;
      for (const k of Object.keys(defs)) {
        if (st[key][k] === undefined) { st[key][k] = MV.clone(defs[k]); changed = true; }
      }
      if (changed) persistSoon();
    }
    return st[key];
  };
  S.log = function log(text, noEmit) {
    const st = S.get();
    st.activity.unshift({ at: MV.nowISO(), text: String(text) });
    if (st.activity.length > 300) st.activity.length = 300;
    if (!noEmit) { persistSoon(); bus.emit('change', { log: text }); }
  };
  S.exportJSON = () => JSON.stringify(Object.assign({ _app: 'mv-move', _exportedAt: MV.nowISO() }, S.get()), null, 1);
  S.importJSON = function importJSON(text) {
    const st = JSON.parse(text);
    if (!validState(st)) throw new Error('이 앱의 백업 파일이 아닙니다.');
    delete st._app; delete st._exportedAt;
    st.inventory = st.inventory || [];
    st.activity = st.activity || [];
    st.meta.deletedSeed = st.meta.deletedSeed || [];
    mergeSeed(st);
    S.state = st;
    S.persist();
    S.log('백업 파일에서 복원했습니다.', true);
    bus.emit('change', { log: 'import', reset: true });
  };
  S.reset = function reset() {
    S.state = freshState();
    S.persist();
    bus.emit('change', { log: 'reset', reset: true });
  };
  global.addEventListener('storage', (e) => {
    if (e.key !== KEY || !e.newValue) return;
    try {
      const st = JSON.parse(e.newValue);
      if (validState(st)) { S.state = st; bus.emit('change', { log: 'sync', reset: true }); }
    } catch (err) { /* 무시 */ }
  });

  /* ---------------- 파트(채널) ---------------- */
  const P = MV.parts = {};
  P.list = () => S.get().parts.slice().sort((a, b) => (a.order || 0) - (b.order || 0));
  P.get = (id) => S.get().parts.find((p) => p.id === id) || null;
  P.add = function add(p) {
    const part = Object.assign({ id: MV.uid('pt'), name: '새 파트', emoji: '📌', group: '내가 만든 파트', desc: '', guide: '', order: S.get().parts.length + 1 }, p);
    S.update((st) => { st.parts.push(part); }, { log: '파트 추가: ' + part.name });
    return part;
  };
  P.update = (id, patch) => S.update((st) => {
    const p = st.parts.find((x) => x.id === id);
    if (p) Object.assign(p, patch);
  });
  P.remove = (id) => S.update((st) => {
    const p = st.parts.find((x) => x.id === id);
    st.parts = st.parts.filter((x) => x.id !== id);
    const gone = st.items.filter((i) => i.partId === id);
    st.items = st.items.filter((i) => i.partId !== id);
    st.meta.deletedSeed.push(id, ...gone.filter((i) => i.seed).map((i) => i.id));
    if (p) S.log('파트 삭제: ' + p.name + ' (항목 ' + gone.length + '개 포함)', true);
  });
  P.stats = function stats(id) {
    const items = S.get().items.filter((i) => !id || i.partId === id);
    const r = { total: items.length, done: 0, overdue: 0, today: 0, soon: 0, notes: 0 };
    items.forEach((i) => {
      const s = MV.items.status(i);
      if (s === 'done') r.done++;
      else if (s === 'overdue') r.overdue++;
      else if (s === 'today') r.today++;
      else if (s === 'soon') r.soon++;
      r.notes += (i.notes || []).length;
    });
    r.pct = r.total ? r.done / r.total : 0;
    return r;
  };

  /* ---------------- 체크 항목 ---------------- */
  const I = MV.items = {};
  I.list = (filter) => {
    const all = S.get().items.slice();
    return filter ? all.filter(filter) : all;
  };
  I.byPart = (id) => I.list((i) => i.partId === id);
  I.get = (id) => S.get().items.find((i) => i.id === id) || null;
  I.add = function add(p) {
    const it = normItem(Object.assign({ order: Date.now() }, p), false);
    S.update((st) => { st.items.push(it); }, { log: '항목 추가: ' + it.title });
    return it;
  };
  I.update = (id, patch, logText) => S.update((st) => {
    const it = st.items.find((x) => x.id === id);
    if (it) { Object.assign(it, patch); it.updatedAt = MV.nowISO(); }
  }, { log: logText });
  I.remove = (id) => S.update((st) => {
    const it = st.items.find((x) => x.id === id);
    st.items = st.items.filter((x) => x.id !== id);
    if (it && it.seed) st.meta.deletedSeed.push(it.id);
    if (it) S.log('항목 삭제: ' + it.title, true);
  });
  I.toggle = (id) => {
    const it = I.get(id);
    if (!it) return;
    const done = !it.done;
    I.update(id, { done, doneAt: done ? MV.nowISO() : null }, (done ? '✅ 완료: ' : '↩︎ 다시 열기: ') + it.title);
  };
  I.addNote = (id, text) => {
    const it = I.get(id);
    if (!it || !String(text).trim()) return null;
    const note = { id: MV.uid('nt'), text: String(text).trim(), at: MV.nowISO() };
    S.update((st) => {
      const x = st.items.find((y) => y.id === id);
      x.notes.push(note); x.updatedAt = note.at;
    }, { log: '💬 메모: ' + it.title });
    return note;
  };
  I.removeNote = (id, noteId) => S.update((st) => {
    const x = st.items.find((y) => y.id === id);
    if (x) x.notes = x.notes.filter((n) => n.id !== noteId);
  });
  I.status = function status(it) {
    if (it.done) return 'done';
    if (!D.valid(it.due)) return 'nodate';
    const n = D.diff(D.today(), it.due);
    if (n < 0) return 'overdue';
    if (n === 0) return 'today';
    if (n <= 3) return 'soon';
    if (n <= 7) return 'week';
    return 'later';
  };
  I.PRIORITY = { high: { label: '중요', cls: 'bad' }, mid: { label: '보통', cls: 'warn' }, low: { label: '여유', cls: '' } };
  I.OWNERS = ['', '나', '아내', '함께'];

  /* ---------------- 짐 목록 ---------------- */
  const V = MV.inv = {};
  V.CATS = [
    { id: 'appliance', label: '대형가전', icon: '🧊' },
    { id: 'aircon', label: '에어컨', icon: '❄️' },
    { id: 'bed', label: '침대·매트리스', icon: '🛏️' },
    { id: 'storage', label: '옷장·수납장', icon: '🚪' },
    { id: 'table', label: '책상·식탁', icon: '🪑' },
    { id: 'sofa', label: '소파·의자', icon: '🛋️' },
    { id: 'shelf', label: '책장·선반', icon: '📚' },
    { id: 'electronics', label: 'TV·전자기기', icon: '📺' },
    { id: 'kids', label: '아이 물건', icon: '🧸' },
    { id: 'misc', label: '기타', icon: '📦' },
  ];
  V.FATES = [
    { id: 'move', label: '가져감', cls: 'kid' },
    { id: 'buy', label: '새로 구매', cls: 'good' },
    { id: 'discard', label: '버림', cls: 'bad' },
    { id: 'sell', label: '판매·나눔', cls: 'warn' },
    { id: 'undecided', label: '미정', cls: '' },
  ];
  V.AC = [
    { id: 'wall', label: '벽걸이' }, { id: 'stand', label: '스탠드' }, { id: '2in1', label: '2in1 (스탠드+벽걸이)' }, { id: 'window', label: '창문형' },
  ];
  V.cat = (id) => V.CATS.find((c) => c.id === id) || V.CATS[V.CATS.length - 1];
  V.fate = (id) => V.FATES.find((f) => f.id === id) || V.FATES[V.FATES.length - 1];
  V.list = (filter) => { const all = S.get().inventory.slice(); return filter ? all.filter(filter) : all; };
  V.get = (id) => S.get().inventory.find((x) => x.id === id) || null;
  V.add = function add(p) {
    const it = normInv(p, false);
    S.update((st) => { st.inventory.push(it); }, { log: '짐 추가: ' + it.name });
    return it;
  };
  V.update = (id, patch, logText) => S.update((st) => {
    const it = st.inventory.find((x) => x.id === id);
    if (it) Object.assign(it, patch);
  }, { log: logText });
  V.remove = (id) => S.update((st) => {
    const it = st.inventory.find((x) => x.id === id);
    st.inventory = st.inventory.filter((x) => x.id !== id);
    if (it && it.seed) st.meta.deletedSeed.push(it.id);
    if (st.layouts) {
      Object.values(st.layouts).forEach((lay) => {
        if (lay && Array.isArray(lay.placements)) lay.placements = lay.placements.filter((p) => p.invId !== id);
      });
    }
    if (it) S.log('짐 삭제: ' + it.name, true);
  });
  V.volume = (it) => Math.max(0, (+it.w || 0) * (+it.d || 0) * (+it.h || 0) / 1e6) * Math.max(0, +it.qty || 0);

  V.editor = function editor(id, opts) {
    opts = opts || {};
    const existing = id ? V.get(id) : null;
    const draft = Object.assign(normInv({}, false), opts.defaults || {}, existing ? MV.clone(existing) : {});
    const el = MV.el;
    const catalog = MV.catalog || [];
    const f = {};
    const field = (label, input, hint) => el('label', { class: 'field' }, el('span', label), input, hint ? el('small', { class: 'hint' }, hint) : null);
    f.preset = el('select', { class: 'select' },
      el('option', { value: '' }, '— 많이 쓰는 규격에서 고르기 —'),
      catalog.map((c, i) => el('option', { value: String(i) }, (V.cat(c.cat).icon) + ' ' + c.name + ' (' + c.w + '×' + c.d + '×' + c.h + ')')));
    f.name = el('input', { class: 'input', value: draft.name, placeholder: '예: 양문형 냉장고' });
    f.cat = el('select', { class: 'select' }, V.CATS.map((c) => el('option', { value: c.id, selected: c.id === draft.cat }, c.icon + ' ' + c.label)));
    f.fate = el('select', { class: 'select' }, V.FATES.map((c) => el('option', { value: c.id, selected: c.id === draft.fate }, c.label)));
    f.qty = el('input', { class: 'input num', type: 'number', min: '0', step: '1', value: draft.qty });
    f.w = el('input', { class: 'input num', type: 'number', min: '0', step: '1', value: draft.w });
    f.d = el('input', { class: 'input num', type: 'number', min: '0', step: '1', value: draft.d });
    f.h = el('input', { class: 'input num', type: 'number', min: '0', step: '1', value: draft.h });
    f.room = el('input', { class: 'input', value: draft.room, placeholder: '예: 안방' });
    f.roomNew = el('input', { class: 'input', value: draft.roomNew, placeholder: '예: 거실' });
    f.url = el('input', { class: 'input', type: 'url', value: draft.url, placeholder: 'https:// 제품 페이지 주소' });
    f.lg = el('input', { type: 'checkbox', checked: !!draft.lg });
    f.ac = el('select', { class: 'select' }, el('option', { value: '' }, '해당 없음'), V.AC.map((a) => el('option', { value: a.id, selected: a.id === draft.ac }, a.label)));
    f.note = el('textarea', { class: 'textarea', placeholder: '모델명, 상태, 분해 필요 여부 등' }, draft.note || '');
    const acRow = field('에어컨 종류', f.ac, '에어컨이면 견적에 이전설치비가 붙습니다');
    const syncAc = () => { acRow.hidden = f.cat.value !== 'aircon'; };
    f.cat.addEventListener('change', syncAc);
    f.preset.addEventListener('change', () => {
      const c = catalog[+f.preset.value];
      if (!c) return;
      if (!f.name.value.trim()) f.name.value = c.name;
      f.cat.value = c.cat; f.w.value = c.w; f.d.value = c.d; f.h.value = c.h;
      if (c.ac) f.ac.value = c.ac;
      if (c.tag) draft.tag = c.tag;
      syncAc();
    });
    if (opts.preset != null && catalog[opts.preset]) { f.preset.value = String(opts.preset); f.preset.dispatchEvent(new Event('change')); }
    syncAc();
    const body = el('div', { class: 'stack' },
      catalog.length ? field('규격 프리셋', f.preset) : null,
      el('div', { class: 'form-grid' },
        field('이름', f.name), field('분류', f.cat), field('처리', f.fate), field('수량', f.qty)),
      el('div', { class: 'form-grid' },
        field('가로 W (cm)', f.w), field('깊이 D (cm)', f.d), field('높이 H (cm)', f.h)),
      el('div', { class: 'form-grid' },
        field('지금 집 위치', f.room), field('새 집 위치', f.roomNew), acRow),
      field('제품 링크 (URL)', f.url, '인터넷에서 찾은 제품 페이지를 붙여 두면 규격 확인이 쉽습니다'),
      el('label', { class: 'check' }, f.lg, 'LG 서비스로 옮김 (이삿짐센터 대신)'),
      field('메모', f.note));
    const read = () => ({
      name: f.name.value.trim() || '이름 없는 짐',
      cat: f.cat.value, fate: f.fate.value,
      qty: Math.max(0, parseInt(f.qty.value, 10) || 0),
      w: Math.max(0, +f.w.value || 0), d: Math.max(0, +f.d.value || 0), h: Math.max(0, +f.h.value || 0),
      room: f.room.value.trim(), roomNew: f.roomNew.value.trim(), url: f.url.value.trim(),
      lg: f.lg.checked, ac: f.cat.value === 'aircon' ? (f.ac.value || null) : null,
      tag: draft.tag || '', note: f.note.value, assumed: false,
    });
    const actions = [];
    if (existing) {
      actions.push({ label: '삭제', kind: 'danger', onClick: (close) => {
        MV.ui.confirm('“' + existing.name + '”을(를) 짐 목록에서 지울까요? 도면 배치도 함께 지워집니다.', { danger: true, okLabel: '삭제' })
          .then((ok) => { if (ok) { V.remove(existing.id); close(); opts.onSave && opts.onSave(null); } });
        return false;
      } });
    }
    actions.push({ label: '취소', kind: 'ghost' });
    actions.push({ label: existing ? '저장' : '추가', kind: 'primary', onClick: () => {
      const data = read();
      let saved;
      if (existing) { V.update(existing.id, data, '짐 수정: ' + data.name); saved = V.get(existing.id); }
      else saved = V.add(data);
      opts.onSave && opts.onSave(saved);
    } });
    return MV.ui.modal({ title: existing ? '짐 수정' : '짐 추가', body, actions });
  };

  /* ---------------- 계산 레지스트리 ---------------- */
  MV.calc = MV.calc || {};

  /* ---------------- UI ---------------- */
  const U = MV.ui = {};
  U.modal = function modal(o) {
    const el = MV.el;
    const prevFocus = document.activeElement;
    const back = el('div', { class: 'modal-back', role: 'presentation' });
    const close = () => {
      if (!back.isConnected) return;
      back.remove();
      document.removeEventListener('keydown', onKey);
      o.onClose && o.onClose();
      if (prevFocus && prevFocus.focus) try { prevFocus.focus({ preventScroll: true }); } catch (e) { /* 무시 */ }
    };
    const onKey = (e) => { if (e.key === 'Escape') close(); };
    const bodyNode = typeof o.body === 'string' ? el('div', { html: o.body }) : o.body;
    const foot = (o.actions && o.actions.length) ? el('div', { class: 'modal-foot' }, o.actions.map((a) => el('button', {
      class: 'btn ' + (a.kind === 'primary' ? 'btn-primary' : a.kind === 'danger' ? 'btn-danger' : a.kind === 'ghost' ? 'btn-ghost' : ''),
      type: 'button',
      onclick: () => { const r = a.onClick ? a.onClick(close) : undefined; if (r !== false) close(); },
    }, a.label))) : null;
    const box = el('div', { class: 'modal' + (o.wide ? ' wide' : ''), role: 'dialog', 'aria-modal': 'true', 'aria-label': o.title || '대화상자' },
      el('div', { class: 'modal-head' }, el('h2', o.title || ''), el('button', { class: 'btn btn-ghost btn-icon', type: 'button', 'aria-label': '닫기', onclick: close }, '✕')),
      el('div', { class: 'modal-body' }, bodyNode),
      foot);
    back.appendChild(box);
    back.addEventListener('mousedown', (e) => { if (e.target === back) close(); });
    document.addEventListener('keydown', onKey);
    document.body.appendChild(back);
    const first = box.querySelector('.modal-body input, .modal-body textarea, .modal-body select') || box.querySelector('.modal-foot .btn-primary');
    setTimeout(() => { if (first && first.isConnected) first.focus({ preventScroll: true }); }, 30);
    return { close, root: back, body: bodyNode };
  };
  U.confirm = (msg, o) => new Promise((resolve) => {
    o = o || {};
    let done = false;
    U.modal({
      title: o.title || '확인',
      body: MV.el('p', { class: 'mb-0' }, msg),
      actions: [
        { label: o.cancelLabel || '취소', kind: 'ghost', onClick: () => { done = true; resolve(false); } },
        { label: o.okLabel || '확인', kind: o.danger ? 'danger' : 'primary', onClick: () => { done = true; resolve(true); } },
      ],
      onClose: () => { if (!done) resolve(false); },
    });
  });
  U.prompt = (title, o) => new Promise((resolve) => {
    o = o || {};
    let done = false;
    const input = o.multiline
      ? MV.el('textarea', { class: 'textarea', placeholder: o.placeholder || '' }, o.value || '')
      : MV.el('input', { class: 'input', value: o.value || '', placeholder: o.placeholder || '' });
    const ok = () => { done = true; resolve(input.value); };
    if (!o.multiline) input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); m.close(); ok(); } });
    const m = U.modal({
      title,
      body: MV.el('label', { class: 'field' }, o.label ? MV.el('span', o.label) : null, input),
      actions: [
        { label: '취소', kind: 'ghost', onClick: () => { done = true; resolve(null); } },
        { label: o.okLabel || '확인', kind: 'primary', onClick: ok },
      ],
      onClose: () => { if (!done) resolve(null); },
    });
  });
  U.toast = function toast(msg, o) {
    o = o || {};
    const wrap = document.getElementById('toast-wrap') || document.body;
    const t = MV.el('div', { class: 'toast', role: 'status' }, MV.el('span', msg));
    if (o.action) t.appendChild(MV.el('button', { type: 'button', onclick: () => { o.action.onClick(); t.remove(); } }, o.action.label));
    wrap.appendChild(t);
    setTimeout(() => t.remove(), o.ms || (o.action ? 5000 : 2600));
    return t;
  };
  U.progress = (pct, cls) => MV.el('div', { class: 'progress ' + (cls || ''), role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': String(Math.round((pct || 0) * 100)) },
    MV.el('i', { style: { width: Math.round(MV.clamp(pct || 0, 0, 1) * 100) + '%' } }));
  U.dueChip = function dueChip(due, done) {
    if (!D.valid(due)) return MV.el('span', { class: 'chip' }, '기한 없음');
    const dd = D.dday(due);
    let cls = '';
    if (done) cls = 'good';
    else if (dd.n < 0) cls = 'bad';
    else if (dd.n <= 3) cls = 'warn';
    else if (dd.n <= 7) cls = 'brand';
    return MV.el('span', { class: 'chip ' + cls, title: D.fmtLong(due) }, D.fmt(due) + (done ? '' : ' · ' + dd.label));
  };
  U.moneyInput = function moneyInput(value, onChange, o) {
    o = o || {};
    const input = MV.el('input', { class: 'input num', inputmode: 'text', value: value == null ? '' : F.num(value), placeholder: o.placeholder || '예: 2.95억, 120만' });
    const hint = MV.el('small', { class: 'hint' }, value ? F.krw(value) : '');
    const commit = () => {
      const v = MV.parseMoney(input.value);
      if (isNaN(v)) { input.setAttribute('aria-invalid', 'true'); hint.textContent = '숫자로 읽을 수 없어요 (예: 3.78억 / 120만 / 1,200,000)'; return; }
      input.removeAttribute('aria-invalid');
      input.value = F.num(v);
      hint.textContent = F.krw(v);
      onChange && onChange(v);
    };
    input.addEventListener('change', commit);
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); input.blur(); } });
    const wrap = MV.el('span', { class: 'money-input', style: { display: 'flex', flexDirection: 'column', gap: '2px' } }, input, o.noHint ? null : hint);
    wrap.input = input;
    return wrap;
  };
  U.download = function download(filename, text, mime) {
    const blob = new Blob([text], { type: mime || 'application/json' });
    const a = MV.el('a', { href: URL.createObjectURL(blob), download: filename });
    document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  };

  /* ---------------- 라우팅 ---------------- */
  const views = MV.views = {};
  MV.view = function view(name, def) { views[name] = Object.assign({ name, order: 50, nav: true, icon: '•', title: name }, def); };
  MV.route = { name: 'dashboard', params: [] };
  MV.go = (hash) => { if (global.location.hash === hash) MV.rerender(); else global.location.hash = hash; };
  MV.parseHash = function parseHash() {
    const h = (global.location.hash || '').replace(/^#\/?/, '');
    const parts = h.split('/').filter(Boolean).map((p) => { try { return decodeURIComponent(p); } catch (e) { return p; } });
    return { name: parts[0] || 'dashboard', params: parts.slice(1) };
  };
  let cleanups = [];
  function runCleanups() { cleanups.forEach((fn) => { try { fn(); } catch (e) { console.error(e); } }); cleanups = []; }
  MV.rerender = function rerender(keepScroll) {
    const root = document.getElementById('view');
    if (!root) return;
    const r = MV.parseHash();
    const v = views[r.name] || views.dashboard;
    if (!v) return;
    const sameView = MV.route.name === r.name;
    MV.route = { name: v.name, params: r.params };
    runCleanups();
    const scrollY = global.scrollY;
    root.innerHTML = '';
    root.dataset.view = v.name;
    const ctx = {
      onCleanup: (fn) => cleanups.push(fn),
      subscribe: (fn) => cleanups.push(S.on('change', fn)),
    };
    try {
      const ret = v.render(root, r.params, ctx);
      if (typeof ret === 'function') cleanups.push(ret);
    } catch (e) {
      console.error(e);
      root.appendChild(MV.el('div', { class: 'card tint-bad' }, MV.el('h2', '화면을 그리다 문제가 생겼어요'), MV.el('pre', { class: 'small' }, String(e && e.stack || e))));
    }
    document.title = (v.title ? v.title + ' · ' : '') + '우리집 이사 관리';
    MV.store.emit('route', MV.route);
    if (keepScroll || sameView) global.scrollTo(0, scrollY); else global.scrollTo(0, 0);
  };
})(window);
