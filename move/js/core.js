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
            MV.store.on('change', fn) → 해제함수 / MV.store.on('flush', fn) 창을 닫기 직전 (입력 중인 값 반영용)
            MV.store.ensure(key, defaultsFactory) 모듈 전용 하위 상태 확보
            MV.store.log(text) 활동 기록 / exportJSON() / importJSON(text) / reset()
   체크     MV.parts.list() / get(id) / add(p) / update(id, patch) / remove(id) / stats(id)
            MV.items.list(filterFn) / byPart(id) / get(id) / add(p) / update(id, patch)
            MV.items.remove(id) / toggle(id) / addNote(id, text) / removeNote(id, noteId)
            MV.items.status(item) → 'done'|'overdue'|'today'|'soon'|'week'|'later'|'nodate'
            할 일은 '우리 집 할 일' — 나·아내로 담당을 나누지 않음 (옛 기록의 owner 값은 보이지 않게 둠)
            MV.items.stripOwnerTag(title) → {title, dropped} 제목의 '@아내'·'@나' 같은 옛 담당 표시 빼기 (빠른 추가·AI 비서 공용)
   짐목록   MV.inv.list(filterFn) / get / add / update / remove / volume(item) m³
            MV.inv.CATS / MV.inv.FATES / MV.inv.cat(id) / MV.inv.fate(id)
            MV.inv.editor(idOrNull, {preset, defaults, onSave}) 편집 모달
                     ('추정 규격'은 가로·깊이·높이를 고치면 꺼지고, 프리셋을 고르면 켜짐 — catalog assumed:false 는 제외.
                      모델명(model)만 바꾸면 '추정'은 그대로)
            규격 확인  MV.inv.specTarget(it) / specStatus(it) → 'need'|'model'|'done' / SPEC_STATUS / specList() / specStats()
                     MV.inv.specUrls(model) → { naver, danawa } (모델명으로 규격 찾는 검색 주소)
   계산     MV.calc.* — 모듈이 등록 (moveEstimate, financeSummary 등). 없을 수 있으니 ?.() 로 호출.
   라우팅   MV.view(name, {title, icon, order, nav, badge(), render(root, params, ctx)})
            ctx.onCleanup(fn) / ctx.subscribe(fn) (뷰를 떠날 때 자동 해제)
            MV.go('#/checklist/money') / MV.route → {name, params}
   UI       MV.ui.modal({title, body, wide, actions:[{label, kind, onClick(close)}], onClose})
            MV.ui.confirm(msg, {okLabel, danger}) → Promise<bool>
            MV.ui.prompt(title, {value, placeholder, multiline, label}) → Promise<string|null>
            MV.ui.toast(msg, {action:{label, onClick}, ms})
            MV.ui.progress(pct, cls) / MV.ui.dueChip(dateStr, done) / MV.ui.moneyInput(value, onChange, opts)
            MV.ui.download(filename, text, mime)  (공유 버전에서는 Promise)
            MV.ui.errorBox(title, err, {small, hint, retry, cls}) 화면 오류 카드 (쉬운 안내 + 접힌 '자세히'에 오류 원문)
            MV.ui.errorText(err, fallback) 한국어 메시지면 그대로, 영어 원문·코드면 fallback
            MV.ui.saveErrorText(code) 공유 버전 파일 저장 오류 코드 → 한국어 (취소면 null)
   ============================================================ */
(function (global) {
  'use strict';

  const MV = global.MV = global.MV || {};
  MV.VERSION = '1.0.0';
  /** 배포 설정 — sharedUrl: claude.ai 공유 버전(AI 비서·함께 쓰기) 주소 */
  MV.config = MV.config || { sharedUrl: 'https://claude.ai/artifact/GKFEJDgH6AwCm6fRszZbdy' };

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
                 // owner: 옛 기록 호환용으로만 남김 (기본 ''). 할 일은 사람에게 나눠 배정하지 않으므로
                 //        화면·거르기·정렬·검색·복사 글·AI 비서 어디에도 쓰지 않음
       inventory: [{ id, name, cat, fate, qty, w, d, h, url, room, roomNew, brand, model, lg, ac, tag, note, assumed, seed, use? }],
                 // model: 명판·라벨에 적힌 모델명 (규격 확인용, 없으면 '')
                 // use: 쓰임 공간(선택, normInv 기본값 없음 — 없으면 화면이 태그·종류별 기본값을 씀)
                 //      { kind: 'drawer'|'hinged'|'sliding'|'lid'|'front-door'|'seat'|'bed'|'open'|'airflow'|'table',
                 //        front, left, right, back, top (cm), note } — 자세한 뜻은 data-seed.js 머리말.
                 //      정면 방향은 도면 배치 placement.rot (0 남 · 90 서 · 180 북 · 270 동, data-layouts.js 머리말)
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
      url: '', room: '', roomNew: '', brand: '', model: '', lg: false, ac: null, tag: '', note: '', assumed: false, seed: !!seed,
    }, it);
  }
  /* 기본 항목의 만든·고친 시각은 기기마다 다르지 않게 기본 데이터 버전의 고정 시각으로
     (두 기기가 같이 새 기본 항목을 더해도 내용이 글자 하나까지 같아서 공유 기록과 어긋나지 않음) */
  const SEED_AT_DEFAULT = '2026-10-06T00:00:00.000Z';
  function seedAt(seed) {
    const v = seed && seed.versionAt;
    return typeof v === 'string' && !isNaN(new Date(v)) ? v : SEED_AT_DEFAULT;
  }
  /** 기본 항목 글 지문 — 직전 버전 기본값 그대로인지 볼 때 (migrations 의 itemsFrom) */
  function itemPrint(it) {
    const body = JSON.stringify([it.partId || '', it.title || '', it.detail || '', it.due || null, it.priority || 'mid', it.guide || '', it.links || []]);
    let h1 = 0xdeadbeef;
    let h2 = 0x41c6ce57;
    for (let i = 0; i < body.length; i++) {
      const ch = body.charCodeAt(i);
      h1 = Math.imul(h1 ^ ch, 2654435761);
      h2 = Math.imul(h2 ^ ch, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
  }
  MV.seedItemPrint = itemPrint;
  function freshState() {
    const seed = MV.seed || { version: 0, parts: [], items: [], inventory: [] };
    const now = MV.nowISO();
    const at = seedAt(seed);
    return {
      version: 1,
      seedVersion: seed.version || 0,
      meta: { moveDate: seed.moveDate || '2026-11-03', createdAt: now, updatedAt: now, deletedSeed: [] },
      parts: MV.clone(seed.parts || []).map((p, i) => Object.assign({ order: i }, p)),
      items: (seed.items || []).map((it, i) => normItem(Object.assign({ order: i, createdAt: at, updatedAt: at }, MV.clone(it)), true)),
      inventory: (seed.inventory || []).map((it) => normInv(MV.clone(it), true)),
      activity: [{ at: now, text: '이사 관리 시작 — 기본 체크리스트를 불러왔습니다.' }],
      // 큰 가전을 도면에 미리 놓아 둔 기본 배치 (data-layouts.js)
      layouts: MV.seedLayouts ? MV.clone(MV.seedLayouts) : undefined,
    };
  }
  /* 도면 배치가 바닥에서 차지하는 사각형 (view-floorplan 의 foot·rectOf 와 같은 규칙, 벽걸이 에어컨은 null)
     rot = 정면 방향 0 남 · 90 서 · 180 북 · 270 동 — 바닥 크기는 0·180 이 w×d, 90·270 이 d×w */
  const PL_ROTS = [0, 90, 180, 270];
  const plRot = (v) => (PL_ROTS.indexOf(+v) >= 0 ? +v : 0);
  function rectOfPl(p, it) {
    if (!p || !it || (it.cat === 'aircon' && it.ac === 'wall')) return null;
    const nv = (v, d) => { const x = parseFloat(v); return isFinite(x) ? x : d; };
    const w = Math.max(5, nv(it.w, 60)), d = Math.max(5, nv(it.d, 60));
    const rot = plRot(p.rot) === 90 || plRot(p.rot) === 270;
    return { x: nv(p.x, 0), y: nv(p.y, 0), w: rot ? d : w, h: rot ? w : d };
  }
  function rectHit(a, b) {
    const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
    const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
    return w > 1 && h > 1;
  }
  /** 이 짐(invId)의 배치가 개수(qty)보다 많으면 남는 것을 모든 도면에서 빼요 → 뺀 수.
      v7 기본 배치(pl-new-*·pl-old-*)가 아닌 것부터, 나중에 놓은 것(배열 뒤)부터 */
  function trimPlacements(state, iid, qty) {
    if (!state.layouts || typeof state.layouts !== 'object') return 0;
    let cut = 0;
    Object.keys(state.layouts).forEach((lk) => {
      const L = state.layouts[lk];
      if (!L || !Array.isArray(L.placements)) return;
      const mine = L.placements.filter((p) => p && p.invId === iid);
      let extra = mine.length - Math.max(0, qty);
      if (extra <= 0) return;
      const isSeedPl = (p) => /^pl-(new|old)-/.test(String(p.id || ''));
      const order = mine.slice().reverse().sort((a, b) => (isSeedPl(a) ? 1 : 0) - (isSeedPl(b) ? 1 : 0));
      const drop = new Set();
      order.forEach((p) => { if (extra > 0) { drop.add(p); extra--; } });
      L.placements = L.placements.filter((p) => !drop.has(p));
      cut += drop.size;
    });
    return cut;
  }
  /** 정면(rot) 뜻이 생기기 전(v8 전) 배치: 등을 댄 벽을 보고 정면을 한 번만 정해요 (0↔180, 90↔270 — 바닥 크기·좌표는 그대로).
      v7 까지 rot 0·90 은 '돌렸나'만 뜻했어요. v8 은 0 = 정면 아래 · 90 = 왼쪽이라, 아래 벽에 등을 댄 0 이나
      왼쪽 벽에 등을 댄 90 은 '정면이 벽을 본다'로 잘못 읽혀요 → 그 벽에서 15cm 안이고 맞은편 벽은 더 멀면(20cm 넘게) 뒤집어요 */
  function frontFromWall(p, it, rooms) {
    const rot = plRot(p.rot);
    if (rot !== 0 && rot !== 90) return false;
    const r = rectOfPl(p, it);
    if (!r || !Array.isArray(rooms)) return false;
    const ok = (m) => m && isFinite(+m.x) && isFinite(+m.y) && +m.w > 0 && +m.h > 0;
    const inside = (m) => r.x >= m.x - 1 && r.y >= m.y - 1 && r.x + r.w <= m.x + m.w + 1 && r.y + r.h <= m.y + m.h + 1;
    const cx = r.x + r.w / 2, cy = r.y + r.h / 2;
    const rm = rooms.find((m) => ok(m) && inside(m)) || rooms.find((m) => ok(m) && cx >= m.x && cx <= m.x + m.w && cy >= m.y && cy <= m.y + m.h);
    if (!rm) return false;
    const gT = r.y - rm.y, gB = rm.y + rm.h - r.y - r.h, gL = r.x - rm.x, gR = rm.x + rm.w - r.x - r.w;
    // 15cm: v8 에서 크기가 줄어든 짐(예: 퀸 침대 210 → 라지킹 200)은 왼쪽 위 기준이라 벽에서 조금 떨어져 보여요
    if (rot === 0 && gB <= 15 && gT > gB + 20) { p.rot = 180; return true; }
    if (rot === 90 && gL <= 15 && gR > gL + 20) { p.rot = 270; return true; }
    return false;
  }
  // 예전 버전 기록을 새 기본값에 맞추기 (data-seed.js 의 MV.seed.migrations)
  function migrateSeed(state, seed) {
    const from = state.seedVersion || 0;
    let n = 0;
    // 활동 기록에 한 번만 남길 안내 (key 로 두 기기가 같이 맞춰도 한 줄 — sync.js mergeActivity)
    const notes = [];
    const noteOnce = (key, text) => { if (!state.activity.some((a) => a && a.key === key) && !notes.some((x) => x.key === key)) notes.push({ at: MV.nowISO(), key, text }); };
    // 직전 버전 기본 글의 지문 (migrations 의 itemsFrom: { id: 지문 }) — 담당만 바꾼 항목도 '글은 그대로'로 봄
    const prev = new Map();
    (seed.migrations || []).forEach((m) => {
      if (!(m.to > from && m.to <= seed.version) || !m.itemsFrom) return;
      Object.keys(m.itemsFrom).forEach((iid) => {
        const v = m.itemsFrom[iid];
        (Array.isArray(v) ? v : [v]).forEach((h) => { if (typeof h === 'string') { if (!prev.has(iid)) prev.set(iid, new Set()); prev.get(iid).add(h); } });
      });
    });
    // 손대지 않은 기본 항목(완료·메모 없음, 한 번도 고치지 않았거나 글이 직전 기본값 그대로)은 새 기본 내용으로 바꿔요.
    // 숫자(n)에는 글·날짜·중요도·링크가 실제로 바뀐 항목만 셈 — 보이지 않는 옛 담당(owner)은 조용히 지움
    const seedItems = new Map((seed.items || []).map((x) => [x.id, x]));
    const keys = ['partId', 'title', 'detail', 'due', 'priority', 'guide'];
    const sv = (sp, k) => (sp[k] === undefined ? (k === 'due' ? null : k === 'priority' ? 'mid' : '') : sp[k]);
    state.items.forEach((it) => {
      const sp = seedItems.get(it.id);
      if (!sp || !it.seed || it.done || (it.notes && it.notes.length)) return;
      const untouched = it.updatedAt === it.createdAt || (prev.has(it.id) && prev.get(it.id).has(itemPrint(it)));
      if (!untouched) return;
      const changed = keys.some((k) => sv(sp, k) !== (it[k] === undefined ? sv({}, k) : it[k]))
        || JSON.stringify(sp.links || []) !== JSON.stringify(it.links || []);
      if (it.owner) it.owner = '';
      if (!changed) return;
      keys.forEach((k) => { it[k] = MV.clone(sv(sp, k)); });
      it.links = MV.clone(sp.links || []);
      n++;
    });
    (seed.migrations || []).forEach((m) => {
      if (!(m.to > from && m.to <= seed.version)) return;
      Object.keys(m.parts || {}).forEach((pid) => {
        const p = state.parts.find((x) => x.id === pid);
        const sp = (seed.parts || []).find((x) => x.id === pid);
        if (!p || !sp) return;
        const f = m.parts[pid].from || {};
        const same = Object.keys(f).every((k) => p[k] === f[k]);
        if (!same) return;
        ['name', 'emoji', 'group', 'desc', 'guide'].forEach((k) => { if (sp[k] !== undefined) p[k] = sp[k]; });
        n++;
      });
      (m.removeItems || []).forEach((iid) => {
        const idx = state.items.findIndex((x) => x.id === iid);
        if (idx < 0) return;
        const it = state.items[idx];
        if (!it.seed || it.done || (it.notes && it.notes.length)) return;
        state.items.splice(idx, 1);
        state.meta.deletedSeed = state.meta.deletedSeed || [];
        if (state.meta.deletedSeed.indexOf(iid) < 0) state.meta.deletedSeed.push(iid);
        n++;
      });
      // 칸 값이 없으면(옛 기록에 model 칸이 없을 때 등) normInv 기본값과 비교해요
      const invDef = normInv({ id: '_' }, true);
      const cur = (it, k) => (it[k] === undefined ? invDef[k] : it[k]);
      const sameVal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
      // 기본 짐을 목록에서 뺀 경우: { removeInventory: [id | { id, from: { 칸: 옛 기본값 }, keepNote: '메모 앞 글' }] }
      //  · 기본 짐(seed)이고 지금 값이 from 과 모두 같을 때만(사용자가 고치지 않았을 때만) 지우고 meta.deletedSeed 에 넣어요
      //    (다시 추가되지 않게). 그 짐을 가리키는 도면 배치도 모든 도면에서 함께 지워요(없는 짐을 가리키는 배치가 남지 않게)
      //  · 사용자가 고친 짐은 남기고, keepNote 가 있으면 메모 앞에 한 번만 붙여요(지울지 사용자가 정하게)
      (m.removeInventory || []).forEach((r) => {
        const iid = typeof r === 'string' ? r : (r && typeof r === 'object' ? r.id : null);
        if (!iid) return;
        const idx = state.inventory.findIndex((x) => x && x.id === iid);
        if (idx < 0) return;
        const it = state.inventory[idx];
        const f = (r && typeof r === 'object' && r.from && typeof r.from === 'object') ? r.from : {};
        const untouched = !!it.seed && Object.keys(f).every((k) => sameVal(cur(it, k), f[k]));
        if (untouched) {
          state.inventory.splice(idx, 1);
          state.meta.deletedSeed = state.meta.deletedSeed || [];
          if (state.meta.deletedSeed.indexOf(iid) < 0) state.meta.deletedSeed.push(iid);
          if (state.layouts && typeof state.layouts === 'object') {
            Object.keys(state.layouts).forEach((lk) => {
              const L = state.layouts[lk];
              if (L && Array.isArray(L.placements)) L.placements = L.placements.filter((p) => !(p && p.invId === iid));
            });
          }
          n++;
          return;
        }
        const pre = r && typeof r === 'object' && typeof r.keepNote === 'string' ? r.keepNote : '';
        const note = String(it.note || '');
        if (pre && note.indexOf(pre.trim()) < 0) { it.note = pre + note; n++; }
      });
      // 기본 짐 목록 항목이 바뀐 경우: { inventory: { id: { from: { note: 옛 글 }, set?: { 칸: 새 값 }, prev?: { 칸: 옛 기본값 } } } }
      // 지금 값이 from 과 모두 같을 때만(사용자가 고치지 않았을 때만) 바꿔요.
      //  · set 이 없으면: from 에 적은 칸을 이 버전의 기본값(seed)으로
      //  · set 이 있으면: set 에 적은 칸은 set 값으로, from 에만 적은 칸은 기본값(seed)으로
      //    (from 에 적지 않은 칸 — 모델명·추정 표시 등 — 도 함께 바꿀 수 있어요. 예: 모델명으로 찾은 규격 넣기)
      //  · prev 가 있으면: set 의 칸 중 지금 값이 prev(옛 기본값)와 다른 칸 = 사용자가 고친 칸(메모·모델명·링크·위치 등)은
      //    그대로 두고 나머지만 바꿔요 (from = 바꿀지 말지 정하는 문, prev = 칸마다 지키는 것)
      Object.keys(m.inventory || {}).forEach((iid) => {
        const it = state.inventory.find((x) => x && x.id === iid);
        const sp = (seed.inventory || []).find((x) => x.id === iid);
        const rule = m.inventory[iid] || {};
        const f = rule.from || {};
        const set = (rule.set && typeof rule.set === 'object') ? rule.set : null;
        const prevV = (rule.prev && typeof rule.prev === 'object') ? rule.prev : null;
        const keys = Object.keys(f);
        if (!it || !sp || !keys.length) return;
        if (!keys.every((k) => JSON.stringify(cur(it, k)) === JSON.stringify(f[k]))) {
          // 사용자가 고쳐서 바꾸지 않은 짐: keptNote 가 있으면 메모 앞에 한 번만 (예: 짐을 둘로 나눠 새 짐이 더해진 경우 — 두 번 세지 않게 안내)
          const kn = typeof rule.keptNote === 'string' ? rule.keptNote : '';
          const note = String(it.note || '');
          // (이미 새 값인 짐 — 이 버전으로 맞춘 뒤 다시 돌 때 등 — 은 빼요)
          const isNew = keys.every((k) => sameVal(cur(it, k), set && Object.prototype.hasOwnProperty.call(set, k) ? set[k] : (sp[k] === undefined ? invDef[k] : sp[k])));
          if (kn && it.seed && !isNew && note.indexOf(kn.trim()) < 0) { it.note = kn + note; n++; }
          return;
        }
        const target = {};
        keys.forEach((k) => { target[k] = sp[k] === undefined ? invDef[k] : sp[k]; });
        if (set) {
          Object.keys(set).forEach((k) => {
            if (k === 'id' || k === 'seed') return;
            // from 에 있는 칸은 이미 옛 기본값과 같다고 확인했으니 그대로 바꿈
            if (keys.indexOf(k) < 0 && prevV && Object.prototype.hasOwnProperty.call(prevV, k) && !sameVal(cur(it, k), prevV[k])) return;
            target[k] = set[k];
          });
        }
        const tk = Object.keys(target);
        if (tk.every((k) => JSON.stringify(cur(it, k)) === JSON.stringify(target[k]))) return;
        const qty0 = Math.round(+cur(it, 'qty') || 0);
        tk.forEach((k) => { it[k] = MV.clone(target[k]); });
        n++;
        // 개수를 줄였으면(예: 책장 5단 3 → 1) 도면에 남는 배치도 빼요 — 없는 책장이 그려지거나 '수량보다 많이 놓였어요'가 뜨지 않게
        const qty1 = Math.round(+it.qty || 0);
        if (qty1 < qty0) {
          const cut = trimPlacements(state, iid, qty1);
          if (cut) {
            n += cut;
            noteOnce('seed-v' + m.to + '-trim-' + iid, '「' + String(it.name || iid).slice(0, 30) + '」 개수를 ' + qty0 + '개 → ' + qty1 + '개로 맞추며 도면에서 남는 배치 ' + cut + '개를 뺐어요.');
          }
        }
      });
      // 도면 기본 배치가 바뀐 경우: { layouts: { new: { add: [placement…], move: { 배치id: { from:{x,y,rot}, set:{x,y,rot}, ifInv? } } } } }
      //  · rot 는 정면 방향 0·90·180·270 (그 밖의 값은 0)
      //  · move: 그 배치가 지금 from 과 같을 때만(사용자가 옮기지 않았을 때만) set 으로
      //  · add: 같은 id 배치가 없고, 그 짐이 있고, 그 짐의 배치 수가 짐 개수(qty)보다 적을 때만 넣어요
      //         (사용자가 이미 놓은 짐은 건드리지 않음 · 배치 id 가 고정이라 두 기기가 같이 올려도 겹치지 않음)
      //  · ifInv { w, d }: 짐의 가로·깊이가 이 값일 때만 (사용자가 크기를 고친 짐은 좌표가 안 맞아 건드리지 않음)
      //  · add 는 그 도면에 이미 있는 다른 배치와 1cm 넘게 겹치면 넣지 않아요 (사용자가 그 자리에 다른 짐을 놓았을 때)
      //  · add 의 clear {x,y,w,h}(쓰임 공간 앞): 그 안에 다른 짐이 있거나, 새 짐이 이미 놓인 초안 배치의 clear 를 막으면 넣지 않아요
      //    — 벽걸이 에어컨처럼 바닥을 차지하지 않는 짐은 겹침으로 보지 않음 (view-floorplan 과 같은 규칙)
      Object.keys(m.layouts || {}).forEach((key) => {
        const rule = m.layouts[key];
        if (!rule || typeof rule !== 'object') return;
        if (!state.layouts || typeof state.layouts !== 'object' || Array.isArray(state.layouts)) state.layouts = {};
        let L = state.layouts[key];
        if (!L || typeof L !== 'object' || Array.isArray(L)) L = state.layouts[key] = { placements: [] };
        if (!Array.isArray(L.placements)) L.placements = [];
        const pls = L.placements;
        const invOf = (iid) => state.inventory.find((x) => x && x.id === iid);
        const sizeOk = (it, w) => !w || ['w', 'd'].every((k) => w[k] === undefined || Math.abs((+it[k] || 0) - w[k]) < 0.05);
        const same = (p, f) => ['x', 'y', 'rot'].every((k) => f[k] === undefined || Math.abs((+p[k] || 0) - (+f[k] || 0)) < 0.05);
        const clearAt = {};
        (rule.add || []).forEach((pl) => { if (pl && pl.id && pl.clear) clearAt[pl.id] = { at: { x: pl.x, y: pl.y, rot: pl.rot }, clear: pl.clear }; });
        Object.keys(rule.move || {}).forEach((pid) => { const mv = rule.move[pid]; if (mv && mv.clear && mv.set) clearAt[pid] = { at: mv.set, clear: mv.clear }; });
        const addIds = new Set((rule.add || []).map((pl) => pl && pl.id).filter(Boolean));
        const before = new Set(pls.filter((x) => x && x.id).map((x) => x.id));   // 이 버전으로 맞추기 전부터 있던 배치
        const moved = new Set();
        const kept = [];
        // move: 옮길 후보(아직 v7 기본 자리)를 먼저 모두 고르고, 후보끼리는 '옮긴 뒤 자리'로 비교해요 (순서와 상관없이 같은 답)
        let cand = [];
        Object.keys(rule.move || {}).forEach((pid) => {
          const mv = rule.move[pid] || {};
          const p = pls.find((x) => x && x.id === pid);
          const it = p && invOf(p.invId);
          if (!p || !it || !mv.from || !mv.set || !same(p, mv.from) || !sizeOk(it, mv.ifInv)) return;
          if (same(p, mv.set)) { moved.add(pid); return; }
          const np = { x: mv.set.x !== undefined ? mv.set.x : p.x, y: mv.set.y !== undefined ? mv.set.y : p.y, rot: mv.set.rot !== undefined ? mv.set.rot : p.rot };
          cand.push({ p, it, mv, np });
        });
        // 새 자리에 다른 배치가 있으면(사용자가 그 자리에 짐을 놓음) 옮기지 않아요 (쓰임 공간 앞은 보지 않음 — 옛 자리가 더 나쁠 수 있어서,
        // 그 경우는 도면 점검이 알려요).
        // 못 옮긴 후보는 제자리에 남으니, 남은 후보를 다시 봐요 (바뀌는 것이 없을 때까지)
        for (let round = 0; round < 8; round++) {
          const at = new Map(cand.map((c) => [c.p, c.np]));
          const rectNow = (x) => rectOfPl(at.get(x) || x, invOf(x.invId));
          const stuck = cand.filter((c) => {
            const r = rectOfPl(c.np, c.it);
            const others = pls.filter((x) => x && x !== c.p);
            return !!r && others.some((x) => { const o = rectNow(x); return o && rectHit(r, o); });
          });
          if (!stuck.length) break;
          stuck.forEach((c) => kept.push(String(c.it.name || c.p.invId).slice(0, 24)));
          cand = cand.filter((c) => stuck.indexOf(c) < 0);
        }
        cand.forEach(({ p, mv }) => {
          ['x', 'y', 'rot'].forEach((k) => { if (mv.set[k] !== undefined) p[k] = k === 'rot' ? plRot(mv.set[k]) : mv.set[k]; });
          moved.add(p.id);
          n++;
        });
        if (kept.length) noteOnce('seed-v' + m.to + '-keep-' + key, '도면 초안 자리에 다른 짐이 있어 옮기지 않았어요(지금 자리 그대로): ' + kept.join(', ') + '.');
        // 정면 뜻이 생기기 전에 놓은 배치(초안이 옮기지 않은 것)는 등을 댄 벽을 보고 정면을 한 번 정해요
        if (rule.fixFront) {
          const plan = MV.plans && MV.plans[key];
          const rooms = plan && Array.isArray(plan.rooms) ? plan.rooms : null;
          if (rooms) pls.forEach((p) => { if (p && before.has(p.id) && !moved.has(p.id) && !addIds.has(p.id) && frontFromWall(p, invOf(p.invId), rooms)) n++; });
        }
        (rule.add || []).forEach((pl) => {
          if (!pl || !pl.id || pls.some((x) => x && x.id === pl.id)) return;
          const it = invOf(pl.invId);
          if (!it || !sizeOk(it, pl.ifInv)) return;
          // needs: 함께 놓이는 배치(예: 의자 → 식탁)가 그 초안 자리에 있을 때만 (식탁 없이 의자만 떠 있지 않게)
          if (pl.needs) {
            const t = pls.find((x) => x && x.id === pl.needs);
            const at = (rule.add || []).find((x) => x && x.id === pl.needs);
            if (!t || (at && !same(t, at))) return;
          }
          const qty = Math.max(0, Math.round(+it.qty || 0));
          if (pls.filter((x) => x && x.invId === pl.invId).length >= qty) return;
          const np = { id: pl.id, invId: pl.invId, x: pl.x, y: pl.y, rot: plRot(pl.rot) };
          const r = rectOfPl(np, it);
          if (r && pls.some((x) => { const o = x && rectOfPl(x, invOf(x.invId)); return o && rectHit(r, o); })) return;
          // clear: 이 짐의 쓰임 공간 앞(서랍·문 앞 등)에 다른 짐이 있으면 넣지 않음 + 이미 놓인 초안 배치의 쓰임 공간 앞을 막지 않음
          if (pl.clear && pls.some((x) => { const o = x && rectOfPl(x, invOf(x.invId)); return o && rectHit(pl.clear, o); })) return;
          if (r && pls.some((x) => { const c = x && clearAt[x.id]; return c && same(x, c.at) && rectHit(r, c.clear); })) return;
          pls.push(np);
          n++;
        });
      });
      // 묶음 이름이 바뀐 경우: 사용자가 만들거나 이름을 고친 파트도 같은 새 묶음으로 옮겨요
      Object.keys(m.renameGroups || {}).forEach((og) => {
        state.parts.forEach((p) => { if (p.group === og) { p.group = m.renameGroups[og]; n++; } });
      });
      if (m.reorderParts) {
        (seed.parts || []).forEach((sp, i) => {
          const p = state.parts.find((x) => x.id === sp.id);
          if (p && p.order !== i) { p.order = i; n++; }
        });
      }
    });
    notes.reverse().forEach((a) => state.activity.unshift(a));
    return n;
  }
  /* 옛 기록(편집 창에 담당 칸이 있던 때)의 '👤 담당 변경: …' 활동 줄은 지움 — 할 일을 사람에게 나누지 않으므로
     최근 활동·AI 비서 요약에 다시 나오지 않게. 지운 것이 있으면 true */
  const OWNER_LOG = /^\s*(?:🤖\s*)?👤\s*담당 변경\s*:/;
  function dropOwnerLog(state) {
    if (!state || !Array.isArray(state.activity)) return false;
    const n = state.activity.length;
    state.activity = state.activity.filter((a) => !(a && OWNER_LOG.test(String(a.text || ''))));
    return state.activity.length !== n;
  }
  function mergeSeed(state) {
    const dropped = dropOwnerLog(state);
    const seed = MV.seed;
    if (!seed || !seed.version || (state.seedVersion || 0) >= seed.version) return dropped;
    const deleted = new Set(state.meta.deletedSeed || []);
    const partIds = new Set(state.parts.map((p) => p.id));
    const itemIds = new Set(state.items.map((i) => i.id));
    const invIds = new Set(state.inventory.map((i) => i.id));
    let added = 0;
    (seed.parts || []).forEach((p, i) => {
      if (!partIds.has(p.id) && !deleted.has(p.id)) { state.parts.push(Object.assign({ order: 100 + i }, MV.clone(p))); added++; }
    });
    const at = seedAt(seed);
    (seed.items || []).forEach((it, i) => {
      if (!itemIds.has(it.id) && !deleted.has(it.id)) { state.items.push(normItem(Object.assign({ order: 1000 + i, createdAt: at, updatedAt: at }, MV.clone(it)), true)); added++; }
    });
    (seed.inventory || []).forEach((it) => {
      if (!invIds.has(it.id) && !deleted.has(it.id)) { state.inventory.push(normInv(MV.clone(it), true)); added++; }
    });
    const migrated = migrateSeed(state, seed);
    state.seedVersion = seed.version;
    // 활동 줄에 버전별 key 를 붙여 둠 — 두 기기가 같이 새 버전으로 맞춰도 공유 기록에는 한 줄만 (sync.js mergeActivity)
    const hasKey = (k) => state.activity.some((a) => a && a.key === k);
    const kFix = 'seed-v' + seed.version + '-fix';
    const kAdd = 'seed-v' + seed.version + '-add';
    if (migrated && !hasKey(kFix)) state.activity.unshift({ at: MV.nowISO(), key: kFix, text: '기본 파트·항목·짐 목록·도면 배치를 새 버전에 맞췄습니다 (' + migrated + '곳, 고친 내용·완료·메모·직접 옮긴 배치는 그대로).' });
    if (added && !hasKey(kAdd)) state.activity.unshift({ at: MV.nowISO(), key: kAdd, text: '새 기본 항목 ' + added + '개를 추가했습니다 (기존 메모·완료 표시는 그대로).' });
    return true;
  }
  function validState(s) {
    return s && typeof s === 'object' && Array.isArray(s.parts) && Array.isArray(s.items) && s.meta;
  }
  S.load = function load() {
    let st = null;
    let raw = null;
    S.loadProblem = null;
    try {
      raw = global.localStorage.getItem(KEY);
    } catch (e) { S.storageOK = false; S.loadProblem = 'blocked'; }
    if (raw) {
      try { st = JSON.parse(raw); } catch (e) { st = null; }
      if (!validState(st)) {
        // 읽을 수 없는 기록: 지우지 않고 따로 보관한 뒤 새로 시작
        try { global.localStorage.setItem(KEY + ':corrupt', raw); } catch (e) { /* 무시 */ }
        S.loadProblem = 'corrupt';
        st = null;
      }
    }
    if (!validState(st)) st = freshState();
    st.inventory = st.inventory || [];
    st.activity = st.activity || [];
    st.meta.deletedSeed = st.meta.deletedSeed || [];
    // 새 기본값 버전으로 맞추기 직전의 기록 — 공유 저장소(sync.js loadBase)가 '마지막으로 안 서버 내용'을 되살릴 때 씀.
    // (맞춘 뒤의 내용으로만 되살리면 바뀐 문서의 기준을 잃어, 서버의 옛 내용과 칸마다 섞이거나 지운 짐이 되살아나요)
    S.preSeedState = (MV.seed && MV.seed.version && (st.seedVersion || 0) < MV.seed.version) ? JSON.parse(JSON.stringify(st)) : null;
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
      // 공유 저장소에 연결돼 있으면 기록은 거기에 남으므로 경고하지 않음
      if (S.storageOK && !(MV.sync && MV.sync.mode === 'shared')) MV.ui && MV.ui.toast && MV.ui.toast('브라우저 저장소를 쓸 수 없어 이 창을 닫으면 사라집니다. ⋯ 메뉴에서 백업하세요.');
      S.storageOK = false;
    }
    S.afterPersist.forEach((fn) => { try { fn(); } catch (err) { console.error(err); } });
  };
  /** 저장 직후 불리는 훅 (공유 저장소 동기화가 씀) */
  S.afterPersist = [];
  S.KEY = KEY;
  S.mergeSeed = (st) => mergeSeed(st);
  /** '👤 담당 변경' 같은 옛 담당 활동 줄인지 (보여 주거나 AI 비서에 넘기지 않음) */
  S.isOwnerLog = (text) => OWNER_LOG.test(String(text || ''));
  S.normItem = (it) => normItem(it, !!(it && it.seed));
  S.normInv = (it) => normInv(it, !!(it && it.seed));
  const persistSoon = MV.debounce(() => S.persist(), 250);
  // 시작할 때 저장소 문제를 한 번 알림 (화면이 그려진 뒤)
  global.addEventListener('load', () => setTimeout(() => {
    if (!MV.ui || !MV.ui.toast) return;
    if (S.loadProblem === 'blocked' && !(MV.sync && MV.sync.mode === 'shared')) MV.ui.toast('이 브라우저는 저장이 막혀 있어 창을 닫으면 기록이 사라져요. ⋯ 메뉴에서 백업 파일을 저장하세요.', { ms: 8000 });
    else if (S.loadProblem === 'corrupt') MV.ui.toast('저장된 기록을 읽을 수 없어 처음 상태로 열었어요. ⋯ 메뉴에서 백업 파일을 복원하세요.', { ms: 8000 });
  }, 800));
  // 창을 닫기 직전: 뷰들이 입력 중이던 값을 먼저 반영하도록 'flush' 를 알린 뒤 저장
  const flushAll = () => { try { bus.emit('flush'); } catch (e) { /* 무시 */ } persistSoon.flush(); };
  global.addEventListener('pagehide', flushAll);
  global.addEventListener('beforeunload', flushAll);
  global.document.addEventListener('visibilitychange', () => { if (global.document.visibilityState === 'hidden') flushAll(); });

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
    let st;
    try { st = JSON.parse(text); } catch (e) { throw new Error('파일을 읽을 수 없어요. 이 앱에서 저장한 백업 파일인지 확인해 주세요.'); }
    const looksOk = validState(st) && (st._app === 'mv-move' || (typeof st.seedVersion === 'number' && st.items.every((i) => i && typeof i.id === 'string' && typeof i.title === 'string')));
    if (!looksOk) throw new Error('이 앱의 백업 파일이 아니에요.');
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
  /** 통째로 되돌리기 (AI 비서 '이번 변경 되돌리기' 등) */
  S.restore = function restore(snapshot, logText) {
    if (!validState(snapshot)) return false;
    S.state = MV.clone(snapshot);
    S.persist();
    if (logText) S.log(logText, true);
    bus.emit('change', { log: logText || 'restore', reset: true });
    return true;
  };
  global.addEventListener('storage', (e) => {
    if (MV.sync && MV.sync.mode === 'shared') return; // 공유 모드에서는 공유 저장소가 동기화를 맡음
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
  /* 예전에 담당으로 쓰던 낱말 — '@아내'·'@나' 같은 표시는 제목에서 빼기만 함 (빠른 추가·AI 비서 같은 규칙).
     그 밖의 '@○○'(이메일·상호 등)는 제목 글로 둠 */
  I.OLD_OWNER_WORDS = ['나', '내가', '아내', '와이프', '함께', '같이', '우리', '둘다', '둘이'];
  I.isOwnerTag = (w) => {
    w = String(w || '');
    const head = w.charAt(0);
    return (head === '@' || head === '＠') && I.OLD_OWNER_WORDS.indexOf(w.slice(1)) >= 0;
  };
  /** 제목에서 옛 담당 표시를 뺌 → { title, dropped: [뺀 낱말] } (뺀 것이 없으면 제목 그대로) */
  I.stripOwnerTag = (title) => {
    const t = String(title == null ? '' : title);
    const words = t.split(/\s+/).filter(Boolean);
    const dropped = words.filter(I.isOwnerTag);
    if (!dropped.length) return { title: t, dropped };
    return { title: words.filter((w) => !I.isOwnerTag(w)).join(' ').trim(), dropped };
  };
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
  // 제조사: 가전을 누가 옮길지(제조사 서비스) 판단에 씁니다. 비어 있으면 이름으로 짐작합니다.
  V.BRANDS = [{ id: '', label: '모름·해당 없음' }, { id: 'LG', label: 'LG' }, { id: '삼성', label: '삼성' }, { id: '기타', label: '그 밖의 제조사' }];
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

  /* ---- 규격 확인 (모델명으로 규격 확정) ----
     대상: 처리가 '가져감'·'미정'인 짐 중 ① 규격이 추정이거나 ② 모델명을 받았거나 ③ 처음에 추정이었던 기본 짐
     (③ 덕분에 크기를 고쳐 '확정'된 기본 짐도 목록에 남아 진행률 n/m 이 줄지 않아요).
     버릴 짐·팔 짐·살 짐은 빼요 (살 물건은 살 때 정해요). */
  V.SPEC_FATES = ['move', 'undecided'];
  V.SPEC_STATUS = {
    need: { label: '확인 필요', short: '확인 필요', cls: 'warn', icon: '📸' },
    model: { label: '모델명 받음 — 규격 찾는 중', short: '모델명 받음', cls: 'brand', icon: '🔎' },
    done: { label: '확정', short: '확정', cls: 'good', icon: '✅' },
  };
  const modelOf = (it) => String((it && it.model) || '').trim();
  const fateOf = (it) => (V.FATES.some((f) => f.id === it.fate) ? it.fate : 'undecided');
  const seedAssumed = (id) => {
    const sp = MV.seed && Array.isArray(MV.seed.inventory) ? MV.seed.inventory.find((x) => x && x.id === id) : null;
    return !!(sp && sp.assumed);
  };
  V.specTarget = (it) => {
    if (!it || typeof it !== 'object' || V.SPEC_FATES.indexOf(fateOf(it)) < 0) return false;
    return !!it.assumed || !!modelOf(it) || (!!it.seed && seedAssumed(it.id));
  };
  V.specStatus = (it) => (!it.assumed ? 'done' : modelOf(it) ? 'model' : 'need');
  V.specList = () => V.list(V.specTarget);
  V.specStats = () => {
    const r = { total: 0, done: 0, model: 0, need: 0 };
    V.specList().forEach((it) => { r.total++; r[V.specStatus(it)]++; });
    return r;
  };
  V.specUrls = (model) => {
    const m = String(model || '').trim();
    if (!m) return null;
    return {
      naver: 'https://search.naver.com/search.naver?query=' + encodeURIComponent(m + ' 규격 크기'),
      danawa: 'https://search.danawa.com/dsearch.php?query=' + encodeURIComponent(m),
    };
  };
  /** 모델명 검색 링크 두 개 (네이버·다나와) — 모델명이 없으면 null */
  V.specLinks = (model, cls) => {
    const u = V.specUrls(model);
    if (!u) return null;
    MV.css('mv-speclinks', `
      .mv-speclinks { display: inline-flex; flex-wrap: wrap; gap: 0 12px; font-size: .82rem; font-weight: 700; }
      .mv-speclinks a { display: inline-flex; align-items: center; min-height: 32px; }
      .mv-modelfield { gap: 2px; }
      @media (pointer: coarse) { .mv-speclinks a { min-height: 44px; } }
    `);
    return MV.el('span', { class: 'mv-speclinks' + (cls ? ' ' + cls : '') },
      MV.el('a', { href: u.naver, target: '_blank', rel: 'noopener' }, '🔎 네이버에서 규격 찾기'),
      MV.el('a', { href: u.danawa, target: '_blank', rel: 'noopener' }, '🔎 다나와에서 찾기'));
  };

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
    f.qty = el('input', { class: 'input num', type: 'number', min: '0', max: '999', step: '1', value: draft.qty });
    f.w = el('input', { class: 'input num', type: 'number', min: '0', step: '1', value: draft.w });
    f.d = el('input', { class: 'input num', type: 'number', min: '0', step: '1', value: draft.d });
    f.h = el('input', { class: 'input num', type: 'number', min: '0', step: '1', value: draft.h });
    f.room = el('input', { class: 'input', value: draft.room, placeholder: '예: 안방' });
    f.roomNew = el('input', { class: 'input', value: draft.roomNew, placeholder: '예: 거실' });
    f.url = el('input', { class: 'input', type: 'url', value: draft.url, placeholder: '제품 페이지 주소를 붙여 넣으세요' });
    f.brand = el('select', { class: 'select' }, V.BRANDS.map((b) => el('option', { value: b.id, selected: b.id === (draft.brand || '') }, b.label)));
    // 모델명: 바꿔도 '추정 규격'은 그대로 (크기를 고쳐야 꺼짐). 적으면 검색 링크가 바로 생겨요
    f.model = el('input', { class: 'input', value: draft.model || '', placeholder: '예) 명판·라벨에 적힌 모델명', autocomplete: 'off', spellcheck: 'false' });
    const modelLinks = el('div', { class: 'mv-speclinks-wrap' });
    const syncModelLinks = () => { modelLinks.replaceChildren(...[V.specLinks(f.model.value)].filter(Boolean)); };
    f.model.addEventListener('input', syncModelLinks);
    syncModelLinks();
    f.lg = el('input', { type: 'checkbox', checked: !!draft.lg });
    f.ac = el('select', { class: 'select' }, el('option', { value: '' }, '해당 없음'), V.AC.map((a) => el('option', { value: a.id, selected: a.id === draft.ac }, a.label)));
    f.note = el('textarea', { class: 'textarea', placeholder: '상태, 분해 필요 여부 등' }, draft.note || '');
    /* '추정 규격' 표시: 이름·메모·위치·처리만 고치면 그대로 두고, 가로·깊이·높이를 고치면 꺼짐(실측값).
       프리셋을 고르면 일반 규격이라 켜짐. 사용자가 직접 켜고 끌 수도 있음 (그때는 지금 크기를 기준으로) */
    f.assumed = el('input', { type: 'checkbox', checked: !!draft.assumed });
    const dimVals = () => [f.w, f.d, f.h].map((x) => Math.max(0, +x.value || 0));
    let dimsBase = dimVals();
    let assumedBase = !!draft.assumed;
    const syncAssumed = () => {
      const changed = dimVals().some((v, i) => v !== dimsBase[i]);
      f.assumed.checked = changed ? false : assumedBase;
    };
    [f.w, f.d, f.h].forEach((x) => x.addEventListener('input', syncAssumed));
    f.assumed.addEventListener('change', () => { assumedBase = f.assumed.checked; dimsBase = dimVals(); });
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
      // 프리셋 = 흔한 제품의 근사값(추정). 우리 집 실제 모델 규격(catalog 의 assumed: false)만 추정 아님
      dimsBase = dimVals(); assumedBase = c.assumed !== false; f.assumed.checked = assumedBase;
      syncAc();
    });
    if (opts.preset != null && catalog[opts.preset]) { f.preset.value = String(opts.preset); f.preset.dispatchEvent(new Event('change')); }
    syncAc();
    const body = el('div', { class: 'stack' },
      catalog.length ? field('규격 프리셋', f.preset) : null,
      el('div', { class: 'form-grid' },
        field('이름', f.name), field('분류', f.cat), field('처리', f.fate), field('수량', f.qty)),
      el('div', { class: 'form-grid' },
        field('가로 (cm)', f.w), field('깊이 (cm)', f.d), field('높이 (cm)', f.h)),
      el('label', { class: 'check' }, f.assumed, '추정 규격 — 아직 재지 않은 예시 크기 (가로·깊이·높이를 고치면 저절로 꺼져요)'),
      el('div', { class: 'form-grid' },
        field('지금 집 위치', f.room), field('새 집 위치', f.roomNew), field('제조사', f.brand), acRow),
      el('div', { class: 'field mv-modelfield' }, el('label', { class: 'field' }, el('span', '모델명'), f.model,
        el('small', { class: 'hint' }, '명판·라벨 사진의 모델명을 적어 두면 정확한 규격을 찾을 수 있어요')), modelLinks),
      field('제품 링크 (URL)', f.url, '인터넷에서 찾은 제품 페이지를 붙여 두면 규격 확인이 쉽습니다'),
      el('label', { class: 'check' }, f.lg, '제조사 서비스(LG·삼성전자서비스)로 옮김 — 이삿짐센터 대신'),
      field('메모', f.note));
    const read = () => ({
      name: f.name.value.trim() || '이름 없는 짐',
      cat: f.cat.value, fate: f.fate.value,
      qty: MV.clamp(parseInt(f.qty.value, 10) || 0, 0, 999),
      w: Math.max(0, +f.w.value || 0), d: Math.max(0, +f.d.value || 0), h: Math.max(0, +f.h.value || 0),
      room: f.room.value.trim(), roomNew: f.roomNew.value.trim(), url: f.url.value.trim(),
      brand: f.brand.value, model: f.model.value.trim().slice(0, 80), lg: f.lg.checked, ac: f.cat.value === 'aircon' ? (f.ac.value || null) : null,
      tag: draft.tag || '', note: f.note.value, assumed: !!f.assumed.checked,
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
    // 배경을 눌렀다 뗐을 때만 닫기 (열자마자 들어오는 더블클릭의 두 번째 누름·드래그로 닫히지 않게)
    let downOnBack = false;
    back.addEventListener('mousedown', (e) => { downOnBack = e.target === back && e.detail < 2; });
    back.addEventListener('click', (e) => { if (downOnBack && e.target === back) close(); downOnBack = false; });
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
    if (!o.multiline) input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); ok(); m.close(); } });
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
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.isComposing && e.keyCode !== 229) { e.preventDefault(); input.blur(); } });
    const wrap = MV.el('span', { class: 'money-input', style: { display: 'flex', flexDirection: 'column', gap: '2px' } }, input, o.noHint ? null : hint);
    wrap.input = input;
    return wrap;
  };
  /** 오류를 '자세히'에 넣을 글로 (코드·메시지·스택). 화면 본문에는 쓰지 않습니다. */
  U.errorDetail = function errorDetail(err) {
    if (err == null) return '';
    if (typeof err !== 'object') return String(err);
    const head = [err.code ? '코드: ' + err.code : '', err.message && !(err.stack && String(err.stack).indexOf(err.message) >= 0) ? String(err.message) : ''].filter(Boolean).join('\n');
    return [head, err.stack ? String(err.stack) : ''].filter(Boolean).join('\n') || String(err);
  };
  /** 오류 메시지가 한국어로 쓴 안내이면 그대로, 아니면(영어 원문·코드) fallback */
  U.errorText = function errorText(err, fallback) {
    const m = err && typeof err === 'object' ? err.message : err;
    return (typeof m === 'string' && /[가-힣]/.test(m)) ? m : (fallback || '문제가 생겼어요. 잠시 뒤 다시 해 보세요.');
  };
  /** 화면을 그리다 난 오류: 쉬운 안내 + 접힌 '자세히'(오류 원문). o: {small, hint, retry, cls} */
  U.errorBox = function errorBox(title, err, o) {
    o = o || {};
    MV.css('mv-err', `
      .mv-err-more { margin-top: 8px; font-size: .82rem; color: var(--ink-3); }
      .mv-err-more > summary { cursor: pointer; display: inline-flex; align-items: center; gap: 6px; min-height: 36px; font-weight: 700; color: var(--ink-2); list-style: none; }
      .mv-err-more > summary::-webkit-details-marker { display: none; }
      .mv-err-more > summary::before { content: '▸'; display: inline-block; transition: transform .15s; }
      .mv-err-more[open] > summary::before { transform: rotate(90deg); }
      .mv-err-more > pre { margin: 4px 0 0; padding: 8px 10px; max-height: 220px; overflow: auto; white-space: pre-wrap; overflow-wrap: anywhere; font-size: .74rem; background: var(--bg-2); border: 1px solid var(--line); border-radius: 8px; }
      .mv-err .mv-err-act { margin-top: 8px; }
    `);
    const detail = U.errorDetail(err);
    return MV.el('div', { class: 'card tint-bad mv-err' + (o.cls ? ' ' + o.cls : ''), role: 'alert' },
      o.small ? MV.el('p', { class: 'strong mb-0' }, title) : MV.el('h2', title),
      MV.el('p', { class: 'small mb-0' }, o.hint || '저장된 기록은 그대로예요. 새로고침하거나 다른 화면에 갔다가 다시 와 보세요.'),
      o.retry ? MV.el('button', { type: 'button', class: 'btn btn-sm mv-err-act', onclick: o.retry }, '다시 시도') : null,
      detail ? MV.el('details', { class: 'mv-err-more' }, MV.el('summary', '자세히 (문제를 알릴 때 보여 주세요)'), MV.el('pre', detail)) : null);
  };
  /** 공유 버전의 파일 저장(downloads) 오류 코드 → 한국어 안내. 사용자가 취소했으면 null */
  U.saveErrorText = function saveErrorText(code) {
    switch (code) {
      case 'declined': return null;
      case 'rate_limited': return '저장 창이 이미 열려 있어요. 잠시 뒤 다시 눌러 주세요.';
      case 'too_large': return '파일이 너무 커서 저장할 수 없어요.';
      case 'rejected_extension': case 'extension_not_enabled': return '이 파일 형식은 이 화면에서 저장할 수 없어요.';
      case 'bad_request': case 'transform_error': case 'request_unknown': return '파일을 만들지 못해 저장하지 못했어요. 새로고침한 뒤 다시 해 보세요.';
      default: return '이 화면에서는 파일을 저장할 수 없어요. 깃허브 페이지 버전 주소로 열어서 저장해 주세요.';
    }
  };
  U.download = function download(filename, text, mime) {
    // claude.ai 공유 버전: 브라우저 다운로드가 막혀 있어 downloads 기능으로 저장
    const dl = MV.sync && MV.sync.cap && MV.sync.cap.downloads;
    if (dl && typeof dl.save === 'function') {
      return dl.save({ filename, data: text }).then(() => true).catch((e) => {
        const code = e && e.code;
        const msg = U.saveErrorText(code);
        if (!msg) return false;
        console.warn('[파일 저장] 실패', code, e && e.message);
        U.toast(msg, { ms: 5000 });
        return false;
      });
    }
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
      root.appendChild(U.errorBox('화면을 그리다 문제가 생겼어요', e, { retry: () => MV.rerender(true) }));
    }
    document.title = (v.title ? v.title + ' · ' : '') + '우리집 이사 관리';
    MV.store.emit('route', MV.route);
    if (keepScroll || sameView) global.scrollTo(0, scrollY); else global.scrollTo(0, 0);
  };
})(window);
