/* ============================================================
   우리집 이사 관리 — 체크리스트 (슬랙처럼 쓰는 할 일 + 메모 스레드)
   파트(MV.parts) = 채널, 항목(MV.items) = 할 일, 항목의 notes = 스레드.

   라우트
     #/checklist                     데스크톱·태블릿: 🔥 지금 할 일 / 폰: 채널 목록
     #/checklist/<partId>            채널
     #/checklist/<partId>/<itemId>   채널 + 스레드
     #/checklist/~focus|~week|~all|~done|~activity[/<itemId>]   특수 채널
     #/checklist/~search/<검색어>[/<itemId>]

   화면 안에서의 이동(채널·항목 클릭)은 history.pushState/replaceState 로 처리해 다시 그리지 않습니다.
   뒤로·앞으로(hashchange)는 앱 셸이 화면을 새로 그리므로, 스크롤·초안·초점을 mem 에 두었다가 되살립니다.
   CSS 접두사: ck-
   ============================================================ */
(function () {
  'use strict';
  const el = MV.el;
  const D = MV.date;

  /* ---------------- 상수 ---------------- */
  const SPECIALS = [
    { id: '~focus', emoji: '🔥', name: '지금 할 일', desc: '기한이 지났거나 오늘·3일 안에 마감인 일', statuses: ['overdue', 'today', 'soon'] },
    { id: '~week', emoji: '🗓', name: '7일 이내', desc: '지난 것 포함, 앞으로 7일 안에 마감인 일', statuses: ['overdue', 'today', 'soon', 'week'] },
    { id: '~all', emoji: '📋', name: '전체', desc: '아직 끝나지 않은 모든 할 일', statuses: ['overdue', 'today', 'soon', 'week', 'later', 'nodate'] },
    { id: '~done', emoji: '✅', name: '완료', desc: '끝낸 일 (최근에 끝낸 순)' },
    { id: '~activity', emoji: '🕘', name: '최근 활동', desc: '체크·메모·수정 기록' },
  ];
  const SEARCH = { id: '~search', emoji: '🔍', name: '검색', desc: '제목·설명·메모에서 찾았어요' };
  const SPECIAL_MAP = {};
  SPECIALS.concat([SEARCH]).forEach((s) => { SPECIAL_MAP[s.id] = s; });

  const BUCKETS = [
    { id: 'overdue', label: '지연', cls: 'ck-bad' },
    { id: 'today', label: '오늘', cls: 'ck-warn' },
    { id: 'soon', label: '3일 이내', cls: '' },
    { id: 'week', label: '이번 주(7일)', cls: '' },
    { id: 'later', label: '이후', cls: '' },
    { id: 'nodate', label: '기한 없음', cls: '' },
    { id: 'done', label: '완료', cls: '' },
  ];
  const PRI_RANK = { high: 0, mid: 1, low: 2 };
  const PRI_LABEL = { high: '중요', mid: '보통', low: '여유' };
  const OWNER_FILTERS = [['', '전체'], ['나', '나'], ['아내', '아내'], ['함께', '함께']];
  const OWNER_CHIP = { '나': 'kid', '아내': 'think', '함께': '' };
  const EMOJIS = ['📌', '🏠', '📦', '🧹', '🔧', '📝', '💳', '📞', '🚗', '🏫', '🧒', '🪴', '🎁', '🧾', '🛋️', '🔑'];
  const PRI_WORDS = { '': 'high', '!': 'high', '중요': 'high', '높음': 'high', '급함': 'high', '긴급': 'high', '보통': 'mid', '중간': 'mid', '여유': 'low', '낮음': 'low' };
  const OWNER_WORDS = { '나': '나', '내가': '나', '아내': '아내', '와이프': '아내', '함께': '함께', '같이': '함께', '우리': '함께', '둘다': '함께' };
  const WEEK = ['일', '월', '화', '수', '목', '금', '토'];

  /* 뷰를 떠났다 돌아와도 유지되는 메모리 (저장하지 않음) */
  const mem = {
    listScroll: {},     // 채널 → 목록 스크롤 (데스크톱 열)
    winScroll: {},      // 폰 화면 키 → window.scrollY
    doneOpen: {},       // 채널 → 완료 묶음 펼침 여부
    draft: '',          // 할 일 입력창 초안
    noteDrafts: {},     // 항목 → 메모 초안
    composerPart: '',   // 특수 채널에서 추가할 파트
    lastChannel: '~focus',
    sideScroll: 0,      // 사이드바 스크롤
    unmountedAt: -1e9,  // 마지막으로 이 뷰를 닫은 시각 (같은 뷰 다시 그리기 판별)
    focusRow: null,     // 다시 그린 뒤 초점을 돌려줄 항목
  };

  /* ---------------- 작은 도우미 ---------------- */
  const mq = (q) => (window.matchMedia ? window.matchMedia(q) : { matches: false, addEventListener() {}, removeEventListener() {} });
  const MQ_PHONE = '(max-width: 699px)';
  const MQ_DESK = '(min-width: 1100px)';
  const isPhone = () => mq(MQ_PHONE).matches;
  const isDesk = () => mq(MQ_DESK).matches;
  const isSpecial = (ch) => !!ch && ch.charAt(0) === '~';

  function ui() { return MV.store.ensure('checklistUI', { hideDone: true, owner: '' }); }
  function setUI(patch) { MV.store.update(() => { Object.assign(ui(), patch); }); }

  function hashFor(ch, itemId, q) {
    let h = '#/checklist';
    if (ch) {
      h += '/' + encodeURIComponent(ch);
      if (ch === '~search') {
        if (!q) return h;
        h += '/' + encodeURIComponent(q);
      }
    }
    if (ch && itemId) h += '/' + encodeURIComponent(itemId);
    return h;
  }
  const guideHash = (g) => '#/guide/' + String(g).replace('#', '/');

  function statusOf(it) { try { return MV.items.status(it); } catch (e) { return 'nodate'; } }
  function openStatusOf(it) { return statusOf(Object.assign({}, it, { done: false })); }
  function dueKey(it) { const d = D.parse(it.due); return d ? D.str(d) : '9999-12-31'; }
  function cmpItems(a, b) {
    const da = dueKey(a); const db = dueKey(b);
    if (da !== db) return da < db ? -1 : 1;
    const pa = PRI_RANK[a.priority] != null ? PRI_RANK[a.priority] : 1;
    const pb = PRI_RANK[b.priority] != null ? PRI_RANK[b.priority] : 1;
    if (pa !== pb) return pa - pb;
    return (+a.order || 0) - (+b.order || 0);
  }
  const cmpDone = (a, b) => String(b.doneAt || '').localeCompare(String(a.doneAt || ''));
  function ownerMatch(it, f) {
    if (!f) return true;
    if (f === '함께') return it.owner === '함께';
    return it.owner === f || it.owner === '함께';
  }
  const partLabel = (p) => (p ? (p.emoji || '📌') + ' ' + (p.name || '이름 없는 파트') : '📌 파트 없음');
  function isTyping(t) {
    if (!t || t === document.body) return false;
    if (t.isContentEditable) return true;
    const tag = t.tagName;
    if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
    if (tag === 'INPUT') return !/^(checkbox|radio|button|submit|reset|range|color|file)$/i.test(t.type);
    return false;
  }
  function plainLinkClick(e) { return e.button === 0 && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey; }
  function hhmm(iso) { const d = new Date(iso); if (isNaN(d)) return ''; return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); }

  /* '10/10 금, D-4' (카톡 복사용) */
  function dueText(due) {
    const d = D.parse(due);
    if (!d) return '';
    const n = D.diff(D.today(), D.str(d));
    const rel = n === 0 ? '오늘' : n > 0 ? 'D-' + n : (-n) + '일 지남';
    return (d.getMonth() + 1) + '/' + d.getDate() + ' ' + WEEK[d.getDay()] + ', ' + rel;
  }

  /* ---------------- 빠른 입력 파서 ---------------- */
  function ymd(y, mo, d) {
    const dt = new Date(y, mo - 1, d);
    if (dt.getFullYear() !== y || dt.getMonth() !== mo - 1 || dt.getDate() !== d) return null;
    return D.str(dt);
  }
  function parseDue(s) {
    s = String(s || '').trim();
    if (!s) return null;
    const today = D.today();
    if (s === '오늘') return today;
    if (s === '내일') return D.add(today, 1);
    if (s === '모레') return D.add(today, 2);
    if (s === '글피') return D.add(today, 3);
    if (/^(이사|이삿날|이사날|이사당일|d-?day|d0|d[-+]0)$/i.test(s)) return D.moveDate();
    let m = /^d([+-])(\d{1,3})$/i.exec(s);
    if (m) return D.add(D.moveDate(), (m[1] === '-' ? -1 : 1) * Number(m[2]));
    m = /^\+(\d{1,3})일?$/.exec(s) || /^(\d{1,3})일(후|뒤)$/.exec(s);
    if (m) return D.add(today, Number(m[1]));
    m = /^(\d{4})[-./](\d{1,2})[-./](\d{1,2})$/.exec(s);
    if (m) return ymd(+m[1], +m[2], +m[3]);
    m = /^(\d{1,2})[/.](\d{1,2})$/.exec(s) || /^(\d{1,2})월(\d{1,2})일?$/.exec(s);
    if (m) {
      const y = D.parse(today).getFullYear();
      let r = ymd(y, +m[1], +m[2]);
      if (r && D.diff(r, today) > 90) r = ymd(y + 1, +m[1], +m[2]);
      return r;
    }
    m = /^(일|월|화|수|목|금|토)(요일)?$/.exec(s);
    if (m) {
      const target = WEEK.indexOf(m[1]);
      const cd = D.parse(today).getDay();
      return D.add(today, (target - cd + 7) % 7);
    }
    return null;
  }
  function parseQuick(raw) {
    const r = { title: '', due: null, priority: null, owner: null, bad: [] };
    const keep = [];
    String(raw || '').split(/\s+/).filter(Boolean).forEach((w) => {
      const head = w.charAt(0); const rest = w.slice(1);
      if (head === '~' || head === '～') {
        if (!rest) { keep.push(w); return; }
        const d = parseDue(rest);
        if (d) { r.due = d; return; }
        r.bad.push(w); keep.push(w); return;
      }
      if (head === '!' || head === '！') {
        const p = PRI_WORDS[rest];
        if (p) { r.priority = p; return; }
        keep.push(w); return;
      }
      if (head === '@' && OWNER_WORDS[rest]) { r.owner = OWNER_WORDS[rest]; return; }
      keep.push(w);
    });
    r.title = keep.join(' ').trim();
    return r;
  }

  /* ---------------- 검색 ---------------- */
  const termsOf = (q) => String(q || '').toLowerCase().split(/\s+/).filter(Boolean);
  function haystack(it) {
    return [it.title, it.detail].concat((it.notes || []).map((n) => n.text), (it.links || []).map((l) => (l.label || '') + ' ' + (l.url || '')))
      .filter(Boolean).join('\n').toLowerCase();
  }
  const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  function highlight(text, terms) {
    text = String(text == null ? '' : text);
    if (!terms || !terms.length) return text;
    const re = new RegExp('(' + terms.map(escRe).join('|') + ')', 'gi');
    const frag = document.createDocumentFragment();
    let last = 0;
    text.replace(re, (m, g, idx) => {
      if (idx > last) frag.appendChild(document.createTextNode(text.slice(last, idx)));
      frag.appendChild(el('mark', { class: 'ck-mark' }, m));
      last = idx + m.length;
      return m;
    });
    if (last < text.length) frag.appendChild(document.createTextNode(text.slice(last)));
    return frag;
  }
  function snippetFor(it, terms) {
    if (!terms.length) return null;
    const title = String(it.title || '').toLowerCase();
    if (terms.every((t) => title.includes(t))) return null;
    const sources = [['📝', it.detail]].concat((it.notes || []).map((n) => ['💬', n.text]));
    for (const [icon, txt] of sources) {
      const s = String(txt || '');
      const low = s.toLowerCase();
      const t = terms.find((x) => low.includes(x));
      if (!t) continue;
      const i = low.indexOf(t);
      const from = Math.max(0, i - 24);
      const cut = (from ? '…' : '') + s.slice(from, i + t.length + 40).replace(/\s+/g, ' ') + (i + t.length + 40 < s.length ? '…' : '');
      return { icon, text: cut };
    }
    return null;
  }

  /* ---------------- DOM 도우미 ---------------- */
  /* 자식 바꾸기: 배열은 펴고 null/false/'' 는 건너뜀 (replaceChildren 은 배열·null 을 글자로 바꿔 버림) */
  function put(node, ...kids) {
    const flat = [];
    (function walk(list) {
      list.forEach((k) => {
        if (k === null || k === undefined || k === false || k === '') return;
        if (Array.isArray(k)) walk(k);
        else flat.push(k instanceof Node ? k : document.createTextNode(String(k)));
      });
    })(kids);
    node.replaceChildren(...flat);
    return node;
  }
  function autosize(ta, max) {
    if (!ta || !ta.isConnected || !ta.getClientRects().length) return;
    ta.style.height = 'auto';
    const h = ta.scrollHeight + (ta.offsetHeight - ta.clientHeight);
    const lim = max && h > max;
    ta.style.height = (lim ? max : h) + 'px';
    ta.style.overflowY = lim ? 'auto' : 'hidden';
  }
  function focusKeyIn(box) {
    const a = document.activeElement;
    return a && a !== document.body && box.contains(a) && a.dataset ? (a.dataset.fkey || null) : null;
  }
  function restoreFocusIn(box, key) {
    if (!key) return;
    let n = null;
    try { n = box.querySelector('[data-fkey="' + (window.CSS && CSS.escape ? CSS.escape(key) : key) + '"]'); } catch (e) { n = null; }
    if (n) n.focus({ preventScroll: true });
  }
  function seg(opts, value, onPick, label, fkeyPrefix) {
    const btns = opts.map(([v, text, cls]) => el('button', {
      type: 'button', class: 'ck-seg-b' + (cls ? ' ' + cls : ''), 'aria-pressed': String(v === value),
      'data-v': v, 'data-fkey': fkeyPrefix ? fkeyPrefix + (v || 'none') : null,
      onclick: () => onPick(v),
    }, text));
    const node = el('div', { class: 'ck-seg', role: 'group', 'aria-label': label }, btns);
    node.set = (val) => btns.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.v === (val || ''))));
    return node;
  }
  function emptyState(icon, text, ...extra) {
    return el('div', { class: 'empty ck-empty' }, el('span', { class: 'big', 'aria-hidden': 'true' }, icon), el('p', { class: 'mb-0' }, text), extra.length ? el('div', { class: 'ck-empty-act' }, extra) : null);
  }
  function copyText(text) {
    const fallback = () => {
      const ta = el('textarea', { readonly: 'readonly', style: { position: 'fixed', top: '-1000px', left: '0', opacity: '0' } }, text);
      document.body.appendChild(ta);
      ta.select();
      let ok = false;
      try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
      ta.remove();
      return ok;
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text).then(() => true, () => fallback());
    }
    return Promise.resolve(fallback());
  }
  function emojiPicker(value) {
    let v = value || '📌';
    const custom = el('input', { class: 'input ck-emo-input', value: v, maxlength: '16', 'aria-label': '이모지 직접 입력', placeholder: '직접' });
    const btns = EMOJIS.map((e) => el('button', {
      type: 'button', class: 'ck-emo', 'aria-pressed': String(e === v), 'aria-label': '아이콘 ' + e,
      onclick: () => { v = e; custom.value = e; sync(); },
    }, e));
    function sync() { btns.forEach((b) => b.setAttribute('aria-pressed', String(b.textContent === v))); }
    custom.addEventListener('input', () => { v = custom.value.trim(); sync(); });
    return { node: el('div', { class: 'ck-emo-grid' }, btns, custom), get: () => (v || '📌') };
  }

  /* ---------------- 파트 만들기·고치기 (모달) ---------------- */
  function partForm(existing, onDone) {
    const groups = [];
    MV.parts.list().forEach((p) => { if (p.group && !groups.includes(p.group)) groups.push(p.group); });
    const name = el('input', { class: 'input', value: existing ? existing.name : '', placeholder: '예) 아이 학교 전학', maxlength: '40' });
    const pick = emojiPicker(existing ? existing.emoji : '📌');
    const desc = el('input', { class: 'input', value: existing ? (existing.desc || '') : '', placeholder: '한 줄 설명 (선택)' });
    const listId = 'ck-groups-' + Math.random().toString(36).slice(2, 7);
    const group = el('input', { class: 'input', value: existing ? (existing.group || '') : '내가 만든 파트', list: listId, placeholder: '예) 돈·계약' });
    const dl = el('datalist', { id: listId }, groups.map((g) => el('option', { value: g })));
    const save = () => {
      const n = name.value.trim();
      if (!n) { name.focus(); name.setAttribute('aria-invalid', 'true'); return false; }
      const data = { name: n, emoji: pick.get(), desc: desc.value.trim(), group: group.value.trim() || '내가 만든 파트' };
      if (existing) {
        MV.parts.update(existing.id, data);
        MV.store.log('📁 파트 수정: ' + data.name);
        onDone && onDone(existing.id);
      } else {
        const p = MV.parts.add(data);
        onDone && onDone(p.id);
      }
      return true;
    };
    let modal = null;
    name.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.isComposing && e.keyCode !== 229) { e.preventDefault(); if (save() && modal) modal.close(); }
    });
    const body = el('div', { class: 'stack' },
      el('label', { class: 'field' }, el('span', '파트 이름'), name),
      el('div', { class: 'field' }, el('span', '아이콘'), pick.node),
      el('label', { class: 'field' }, el('span', '설명'), desc),
      el('label', { class: 'field' }, el('span', '그룹'), group, dl, el('small', { class: 'hint' }, '같은 그룹끼리 사이드바에 모여 보여요')));
    modal = MV.ui.modal({
      title: existing ? '파트 수정' : '새 파트 만들기',
      body,
      actions: [
        { label: '취소', kind: 'ghost' },
        { label: existing ? '저장' : '만들기', kind: 'primary', onClick: () => save() },
      ],
    });
    return modal;
  }

  /* ================================================================
     뷰 본체
     ================================================================ */
  function mount(root, params, ctx) {
    let alive = true;
    const cur = { ch: null, q: '', itemId: null };
    const lingering = new Map();   // 방금 체크한 항목 → 잠깐 제자리에 남겨 두는 타이머
    let pendingFlash = null;
    const effCh = () => cur.ch || '~focus';

    /* ---------- 뼈대 ---------- */
    const sideTop = el('div', { class: 'ck-ws' });
    const searchInput = el('input', {
      class: 'input ck-search-input', type: 'search', placeholder: '할 일·메모 검색', 'aria-label': '체크리스트 검색 (제목·설명·메모)',
      autocomplete: 'off', enterkeyhint: 'search', spellcheck: 'false',
    });
    const searchClear = el('button', { type: 'button', class: 'ck-search-clear', 'aria-label': '검색 지우기', hidden: true }, '✕');
    const searchBox = el('div', { class: 'ck-search', role: 'search' },
      el('span', { class: 'ck-search-ico', 'aria-hidden': 'true' }, '🔍'), searchInput, searchClear);
    const chans = el('nav', { class: 'ck-chans', 'aria-label': '파트(채널) 목록' });
    const side = el('aside', { class: 'ck-side' },
      el('div', { class: 'ck-side-head' }, sideTop, searchBox),
      chans,
      el('div', { class: 'ck-side-foot' },
        el('button', { type: 'button', class: 'ck-addpart', onclick: () => addPart() }, el('span', { 'aria-hidden': 'true' }, '＋'), ' 파트 추가'),
        el('p', { class: 'ck-keys' }, el('kbd', '/'), ' 검색 · ', el('kbd', 'n'), ' 새 할 일', el('br'), el('kbd', 'j'), ' ', el('kbd', 'k'), ' 위아래 · ', el('kbd', 'Esc'), ' 상세 닫기')));

    const head = el('header', { class: 'ck-head' });
    const sub = el('div', { class: 'ck-sub' });
    const list = el('div', { class: 'ck-list', tabindex: '-1' });

    const compPart = el('select', { class: 'select ck-comp-part', 'aria-label': '추가할 파트' });
    const compInput = el('input', {
      class: 'input ck-comp-input', placeholder: '할 일 추가… 예) 우리은행 방문 ~10/15 !중요 @아내',
      'aria-label': '할 일 추가', autocomplete: 'off', enterkeyhint: 'done',
    });
    const compBtn = el('button', { type: 'button', class: 'btn btn-primary ck-comp-btn', 'aria-label': '할 일 추가' }, '추가');
    const compPrev = el('div', { class: 'ck-comp-prev', 'aria-live': 'polite' });
    const composer = el('div', { class: 'ck-composer' }, el('div', { class: 'ck-comp-row' }, compPart, compInput, compBtn), compPrev);
    const main = el('section', { class: 'ck-main', 'aria-label': '할 일 목록' }, head, sub, list, composer);

    const thread = el('aside', { class: 'ck-thread', 'aria-label': '항목 상세' });
    const backdrop = el('div', { class: 'ck-backdrop', 'aria-hidden': 'true', onclick: () => closeThread() });
    const wrap = el('div', { class: 'ck' }, side, main, thread, backdrop);
    root.appendChild(wrap);

    /* ---------- 라우팅 ---------- */
    function screenKey() {
      if (!cur.ch) return 'channels';
      if (cur.itemId) return 'thread:' + cur.itemId;
      if (cur.ch === '~search') return 'search';
      return 'list:' + cur.ch;
    }
    function nav(hash, opts) {
      opts = opts || {};
      if (location.hash === hash) { applyRoute(MV.parseHash().params, opts.how || 'same'); return; }
      try {
        if (opts.replace) history.replaceState(history.state, '', hash);
        else history.pushState({ ckPrev: location.hash }, '', hash);
      } catch (e) { location.hash = hash; return; }
      const r = MV.parseHash();
      MV.route = { name: 'checklist', params: r.params };
      applyRoute(r.params, opts.how || 'push');
    }
    function goBackTo(target) {
      const st = history.state;
      if (st && st.ckPrev === target) {
        if (cur.itemId && !isPhone()) mem.focusRow = cur.itemId;
        history.back();   // 앱 셸이 다시 그림 → mem 으로 스크롤·초점 복원
      } else nav(target, { replace: true, how: 'history' });
    }

    function applyRoute(params, how) {
      const inPlace = how === 'init' && performance.now() - mem.unmountedAt < 120;   // 뒤로·앞으로로 같은 뷰를 다시 그림
      const prevKey = screenKey();
      const prevEff = effCh(); const prevQ = cur.q;
      if (how !== 'init') {
        if (isPhone()) mem.winScroll[prevKey] = window.scrollY;
        else mem.listScroll[prevEff + (prevEff === '~search' ? ':' + prevQ : '')] = list.scrollTop;
      }

      let ch = params[0] || null; let q = ''; let itemId = null;
      if (ch === '~search') { q = params[1] || ''; itemId = params[2] || null; }
      else itemId = params[1] || null;
      if (itemId && !MV.items.get(itemId)) {
        itemId = null;
        try { history.replaceState(history.state, '', hashFor(ch, null, q)); } catch (e) { /* 무시 */ }
        MV.route = { name: 'checklist', params: MV.parseHash().params };
      }
      const prevItem = cur.itemId;
      cur.ch = ch; cur.q = q; cur.itemId = itemId;
      if (ch && ch !== '~search') mem.lastChannel = ch;

      wrap.dataset.screen = !ch ? 'channels' : itemId ? 'thread' : ch === '~search' ? 'search' : 'list';
      wrap.dataset.ch = effCh();
      const chChanged = effCh() !== prevEff || q !== prevQ;
      if (document.activeElement !== searchInput) searchInput.value = ch === '~search' ? q : '';
      searchClear.hidden = !searchInput.value;
      renderSidebar();
      if (chChanged || how === 'init') {
        renderHeader();
        renderList({ restore: true });
        updateComposer();
      } else markSelected();

      if (itemId !== T.id) {
        flushThread();
        if (itemId) buildThread(MV.items.get(itemId)); else clearThread();
      }
      wrap.classList.toggle('ck-open', !!itemId);

      if (how === 'init') {
        chans.scrollTop = mem.sideScroll || 0;
        if (inPlace && isPhone()) {
          const k = screenKey();
          const y = k.indexOf('thread:') === 0 ? 0 : (mem.winScroll[k] || 0);
          requestAnimationFrame(() => { if (alive) window.scrollTo(0, y); });   // 셸의 scrollTo 다음에
        }
        if (inPlace && mem.focusRow && !isPhone()) {
          const a = list.querySelector('.ck-row[data-id="' + cssEsc(mem.focusRow) + '"] .ck-row-title');
          if (a) a.focus({ preventScroll: true });
        }
        mem.focusRow = null;
      } else if (isPhone()) {
        const k = screenKey();
        if (k !== prevKey || how === 'history') {
          const y = how === 'history' && mem.winScroll[k] != null ? mem.winScroll[k] : 0;
          if (!(prevKey === 'channels' && k === 'search')) window.scrollTo(0, y);
        }
      }
      // 태블릿 서랍: 열릴 때 초점을 서랍으로, 닫힐 때 원래 줄로
      if (!isPhone() && !isDesk()) {
        if (itemId && !prevItem && T.f.close) setTimeout(() => { if (alive && T.f.close && T.f.close.isConnected) T.f.close.focus({ preventScroll: true }); }, 60);
      }
      if (!itemId && prevItem && !isPhone()) {
        const a = list.querySelector('.ck-row[data-id="' + cssEsc(prevItem) + '"] .ck-row-title');
        if (a && (!document.activeElement || document.activeElement === document.body || thread.contains(document.activeElement))) a.focus({ preventScroll: true });
      }
    }
    const cssEsc = (s) => (window.CSS && CSS.escape ? CSS.escape(s) : String(s).replace(/"/g, '\\"'));

    function selectItem(id) {
      const ch = effCh();
      nav(hashFor(ch, id, cur.q), { replace: !!cur.itemId });
    }
    function closeThread() {
      if (!cur.itemId) return;
      flushThread();
      goBackTo(hashFor(cur.ch || '~focus', null, cur.q));
    }
    function goChannel(ch, itemId) { nav(hashFor(ch, itemId || null)); }
    function linkNav(hash) {
      return (e) => { if (!plainLinkClick(e)) return; e.preventDefault(); nav(hash); };
    }

    /* ---------- 사이드바 ---------- */
    function computeCounts() {
      const byPart = {}; const sp = { '~focus': 0, '~week': 0, '~all': 0, '~done': 0, '~activity': 0 };
      let overdue = 0; let total = 0; let done = 0; let focusOver = 0;
      MV.items.list().forEach((it) => {
        const s = statusOf(it);
        const p = byPart[it.partId] || (byPart[it.partId] = { total: 0, done: 0, overdue: 0 });
        p.total++; total++;
        if (s === 'done') { p.done++; done++; sp['~done']++; return; }
        sp['~all']++;
        if (s === 'overdue') { p.overdue++; overdue++; focusOver++; }
        if (s === 'overdue' || s === 'today' || s === 'soon') sp['~focus']++;
        if (s !== 'later' && s !== 'nodate') sp['~week']++;
      });
      return { byPart, sp, overdue, total, done, focusOver };
    }
    function chanRow(id, emoji, name, meta, badge, active, title) {
      const hash = hashFor(id);
      return el('a', {
        class: 'ck-chan' + (active ? ' ck-active' : ''), href: hash, 'data-fkey': 'ch:' + id,
        'aria-current': active ? 'page' : null, title: title || null, onclick: linkNav(hash),
      },
      el('span', { class: 'ck-chan-emo', 'aria-hidden': 'true' }, emoji),
      el('span', { class: 'ck-chan-name' }, name),
      meta != null && meta !== '' ? el('span', { class: 'ck-chan-meta' }, meta) : null,
      badge ? el('span', { class: 'badge ck-chan-badge', title: '기한 지난 항목 ' + badge + '개', 'aria-label': '지연 ' + badge + '개' }, String(badge)) : null);
    }
    function renderSidebar() {
      const c = computeCounts();
      const fk = focusKeyIn(side);
      const active = cur.ch === '~search' ? null : (cur.ch || (isPhone() ? null : '~focus'));
      const dd = D.dday(D.moveDate());
      put(sideTop, 
        el('div', { class: 'ck-ws-row' },
          el('h1', { class: 'ck-ws-title' }, '체크리스트'),
          el('span', { class: 'ck-ws-sub' }, c.done + '/' + c.total + ' 완료')),
        MV.ui.progress(c.total ? c.done / c.total : 0),
        el('p', { class: 'ck-ws-note' },
          '이사 ' + (dd.n === 0 ? '오늘' : dd.label) + ' · ' + D.fmt(D.moveDate()),
          c.overdue ? el('span', { class: 'ck-ws-over' }, ' · 지연 ' + c.overdue) : null));

      const nodes = [];
      nodes.push(el('div', { class: 'ck-group ck-group-sp' }, SPECIALS.map((s) => chanRow(
        s.id, s.emoji, s.name,
        s.id === '~activity' ? '' : String(c.sp[s.id] || 0),
        s.id === '~focus' ? c.focusOver : 0,
        active === s.id, s.desc))));
      const groups = []; const gmap = new Map();
      MV.parts.list().forEach((p) => {
        const g = p.group || '기타';
        if (!gmap.has(g)) { gmap.set(g, []); groups.push(g); }
        gmap.get(g).push(p);
      });
      groups.forEach((g) => {
        nodes.push(el('div', { class: 'ck-group' },
          el('h2', { class: 'ck-group-h' }, g),
          gmap.get(g).map((p) => {
            const st = c.byPart[p.id] || { total: 0, done: 0, overdue: 0 };
            return chanRow(p.id, p.emoji || '📌', p.name || '이름 없는 파트', st.done + '/' + st.total, st.overdue, active === p.id, p.desc);
          })));
      });
      if (!groups.length) nodes.push(el('p', { class: 'ck-side-empty' }, '파트가 없어요. 아래에서 새 파트를 만들어 보세요.'));
      put(chans, ...nodes);
      restoreFocusIn(side, fk);
    }

    /* ---------- 채널 머리 ---------- */
    function channelInfo(ch) {
      const sp = SPECIAL_MAP[ch];
      if (sp) {
        if (ch === '~search') return { emoji: sp.emoji, name: cur.q ? '“' + cur.q + '” 검색' : '검색', desc: cur.q ? sp.desc : '검색창에 찾을 말을 적어 보세요.', special: true };
        return { emoji: sp.emoji, name: sp.name, desc: sp.desc, special: true };
      }
      const p = MV.parts.get(ch);
      if (p) return { emoji: p.emoji || '📌', name: p.name || '이름 없는 파트', desc: p.desc || '', part: p };
      return { emoji: '❓', name: '찾을 수 없는 파트', desc: '삭제되었거나 주소가 잘못되었어요.', missing: true };
    }
    function renderHeader() {
      const ch = effCh();
      const info = channelInfo(ch);
      const u = ui();
      const fkH = focusKeyIn(head); const fkS = focusKeyIn(sub);
      const backBtn = ch === '~search' ? null : el('button', {
        type: 'button', class: 'btn btn-ghost btn-icon ck-back ck-phone-only', 'aria-label': '파트 목록으로', 'data-fkey': 'back',
        onclick: () => goBackTo('#/checklist'),
      }, '←');
      const guideBtn = info.part && info.part.guide ? el('a', {
        class: 'btn btn-sm ck-guide-btn', href: guideHash(info.part.guide), 'data-fkey': 'guide', title: '이 파트의 가이드 읽기',
      }, '📖', el('span', { class: 'ck-guide-lbl' }, ' 가이드')) : null;
      const menuBtn = (ch !== '~activity' && !info.missing) ? el('button', {
        type: 'button', class: 'btn btn-ghost btn-icon ck-menu-btn', 'aria-label': '채널 메뉴', 'data-fkey': 'menu', title: '수정·복사·삭제',
        onclick: () => openMenu(),
      }, '⋯') : null;
      put(head, el('div', { class: 'ck-head-top' },
        backBtn,
        el('span', { class: 'ck-head-emo', 'aria-hidden': 'true' }, info.emoji),
        el('h2', { class: 'ck-head-title', title: info.name }, info.name),
        el('span', { class: 'ck-spacer' }),
        guideBtn, menuBtn));

      // 진행률·요약
      let summary = null;
      if (info.part) {
        const st = MV.parts.stats(info.part.id);
        summary = el('div', { class: 'ck-prog' }, MV.ui.progress(st.pct), el('span', { class: 'ck-prog-txt' }, st.done + '/' + st.total + ' 완료'),
          st.overdue ? el('span', { class: 'chip bad' }, '지연 ' + st.overdue) : null);
      } else if (ch === '~focus' || ch === '~week' || ch === '~all') {
        const its = MV.items.list((it) => !it.done && SPECIAL_MAP[ch].statuses.includes(statusOf(it)) && ownerMatch(it, u.owner));
        const n = (s) => its.filter((it) => statusOf(it) === s).length;
        summary = el('div', { class: 'ck-prog ck-prog-sp' },
          n('overdue') ? el('span', { class: 'chip bad' }, '지연 ' + n('overdue')) : null,
          n('today') ? el('span', { class: 'chip warn' }, '오늘 ' + n('today')) : null,
          el('span', { class: 'ck-prog-txt' }, '모두 ' + its.length + '개'));
      } else if (ch === '~done') {
        summary = el('div', { class: 'ck-prog ck-prog-sp' }, el('span', { class: 'ck-prog-txt' }, '완료 ' + MV.items.list((it) => it.done && ownerMatch(it, u.owner)).length + '개'));
      } else if (ch === '~search' && cur.q) {
        const n = listItemsFor('~search').length;
        summary = el('div', { class: 'ck-prog ck-prog-sp' }, el('span', { class: 'ck-prog-txt' }, '결과 ' + n + '개'));
      } else if (ch === '~activity') {
        summary = el('div', { class: 'ck-prog ck-prog-sp' }, el('span', { class: 'ck-prog-txt' }, '기록 ' + (MV.store.get().activity || []).length + '개 (최근 300개까지)'));
      }
      let filters = null;
      if (ch !== '~activity' && !info.missing && !(ch === '~search' && !cur.q)) {
        const showHide = !!info.part || ch === '~search';
        filters = el('div', { class: 'ck-filters' },
          seg(OWNER_FILTERS, u.owner || '', (v) => setUI({ owner: v }), '담당자로 거르기', 'own:'),
          showHide ? el('button', {
            type: 'button', class: 'ck-toggle', 'aria-pressed': String(!!u.hideDone), 'data-fkey': 'hide',
            title: '켜 두면 끝낸 일은 아래 “완료” 묶음에 접혀 있어요',
            onclick: () => { mem.doneOpen = {}; setUI({ hideDone: !ui().hideDone }); },
          }, el('span', { class: 'ck-switch', 'aria-hidden': 'true' }), '완료 숨기기') : null);
      }
      put(sub, 
        info.desc ? el('p', { class: 'ck-head-desc' }, info.desc) : null,
        (summary || filters) ? el('div', { class: 'ck-head-bar' }, summary, filters) : null);
      sub.hidden = !sub.firstChild;
      restoreFocusIn(head, fkH); restoreFocusIn(sub, fkS);
    }

    /* ---------- ⋯ 메뉴 ---------- */
    function menuAction(icon, label, onClick, cls) {
      return el('button', { type: 'button', class: 'ck-menu-item' + (cls ? ' ' + cls : ''), onclick: onClick },
        el('span', { class: 'ck-menu-ico', 'aria-hidden': 'true' }, icon), el('span', label));
    }
    function openMenu() {
      const ch = effCh();
      const info = channelInfo(ch);
      const acts = [];
      let m = null;
      if (info.part) {
        acts.push(menuAction('✏️', '파트 이름·이모지·설명 수정', () => { m.close(); partForm(MV.parts.get(info.part.id)); }));
      }
      acts.push(menuAction('📋', '카톡용 텍스트 복사', () => { m.close(); copyChannel(ch); }));
      if (info.part) {
        acts.push(el('div', { class: 'ck-menu-row' },
          menuAction('⬆️', '위로', () => movePart(info.part.id, -1)),
          menuAction('⬇️', '아래로', () => movePart(info.part.id, 1))));
        acts.push(menuAction('🗑️', '파트 삭제', () => { m.close(); deletePart(info.part.id); }, 'ck-danger'));
      }
      m = MV.ui.modal({ title: info.emoji + ' ' + info.name, body: el('div', { class: 'ck-menu' }, acts) });
    }
    function movePart(id, dir) {
      const parts = MV.parts.list();
      const me = parts.find((p) => p.id === id);
      if (!me) return;
      const same = parts.filter((p) => (p.group || '기타') === (me.group || '기타'));
      const i = same.indexOf(me); const other = same[i + dir];
      if (!other) { MV.ui.toast(dir < 0 ? '그룹의 맨 위예요' : '그룹의 맨 아래예요'); return; }
      MV.store.update((st) => {
        const sorted = st.parts.slice().sort((a, b) => (a.order || 0) - (b.order || 0));
        sorted.forEach((p, k) => { p.order = k; });
        const a = st.parts.find((p) => p.id === me.id); const b = st.parts.find((p) => p.id === other.id);
        const t = a.order; a.order = b.order; b.order = t;
      });
      MV.ui.toast((dir < 0 ? '⬆️ 위로' : '⬇️ 아래로') + ' 옮겼어요');
    }
    function deletePart(id) {
      const p = MV.parts.get(id);
      if (!p) return;
      const n = MV.items.byPart(id).length;
      MV.ui.confirm('“' + p.name + '” 파트를 지울까요? 안에 있는 항목 ' + n + '개와 메모도 모두 지워지고 되돌릴 수 없어요.', { danger: true, okLabel: '파트 삭제', title: '파트 삭제' })
        .then((ok) => {
          if (!ok || !alive) return;
          flushThread();
          nav(hashFor(isPhone() ? null : '~focus'), { replace: true });
          MV.parts.remove(id);
          MV.ui.toast('“' + p.name + '” 파트를 지웠어요');
        });
    }
    function addPart() {
      partForm(null, (id) => {
        nav(hashFor(id));
        if (!isPhone()) setTimeout(() => { if (alive && !composer.hidden) compInput.focus(); }, 80);
      });
    }

    /* ---------- 카톡용 텍스트 ---------- */
    function channelText(ch) {
      const info = channelInfo(ch);
      const sp = isSpecial(ch);
      const today = D.today();
      const dd = D.dday(D.moveDate());
      const u = ui();
      const lines = [];
      const items = listItemsFor(ch);
      if (ch === '~done') {
        const done = items.filter((it) => it.done).sort(cmpDone);
        lines.push(info.emoji + ' ' + info.name + ' — 끝낸 일 ' + done.length + '개');
        done.forEach((it) => lines.push('☑ ' + (sp ? '[' + ((MV.parts.get(it.partId) || {}).name || '파트 없음') + '] ' : '') + it.title));
      } else {
        const open = items.filter((it) => !it.done).sort(cmpItems);
        lines.push(info.emoji + ' ' + info.name + ' — 남은 할 일 ' + open.length + '개' + (u.owner ? ' (' + u.owner + ')' : ''));
        lines.push('(' + D.fmt(today) + ' 기준 · 이사 ' + (dd.n === 0 ? '오늘' : dd.label) + ')');
        open.forEach((it) => {
          const p = MV.parts.get(it.partId);
          const due = dueText(it.due);
          lines.push('☐ ' + (it.priority === 'high' ? '❗' : '') + (sp ? '[' + (p ? p.name : '파트 없음') + '] ' : '') + it.title +
            (due ? ' (' + due + ')' : '') + (it.owner ? ' · ' + it.owner : ''));
        });
        const doneN = items.length - open.length;
        if (!sp && doneN) lines.push('— 끝낸 일 ' + doneN + '개');
      }
      return lines.join('\n');
    }
    function copyChannel(ch) {
      const text = channelText(ch);
      copyText(text).then((ok) => {
        if (ok) { MV.ui.toast('카톡에 붙여 넣을 수 있게 복사했어요'); return; }
        const ta = el('textarea', { class: 'textarea ck-copy-ta', readonly: 'readonly', rows: '10' }, text);
        MV.ui.modal({ title: '직접 복사해 주세요', body: el('div', { class: 'stack' }, el('p', { class: 'small muted mb-0' }, '이 브라우저는 자동 복사를 막고 있어요. 아래 글을 길게 눌러 복사하세요.'), ta) });
        setTimeout(() => { ta.focus(); ta.select(); }, 60);
      });
    }

    /* ---------- 목록 ---------- */
    function listItemsFor(ch) {
      const u = ui();
      let items;
      if (ch === '~search') {
        const terms = termsOf(cur.q);
        items = terms.length ? MV.items.list((it) => { const h = haystack(it); return terms.every((t) => h.includes(t)); }) : [];
      } else if (ch === '~done') {
        items = MV.items.list((it) => it.done);
      } else if (SPECIAL_MAP[ch] && SPECIAL_MAP[ch].statuses) {
        const sts = SPECIAL_MAP[ch].statuses;
        items = MV.items.list((it) => {
          if (it.done && !lingering.has(it.id)) return false;
          return sts.includes(it.done ? openStatusOf(it) : statusOf(it));
        });
      } else if (MV.parts.get(ch)) {
        items = MV.items.byPart(ch);
      } else items = [];
      return items.filter((it) => ownerMatch(it, u.owner));
    }

    function rowFor(it, ch, opts) {
      opts = opts || {};
      const s = statusOf(it);
      const leaving = lingering.has(it.id);
      const cls = ['ck-row'];
      if (it.done) cls.push('ck-done');
      if (s === 'overdue') cls.push('ck-overdue');
      if (leaving && it.done) cls.push('ck-leaving');
      if (it.id === cur.itemId) cls.push('ck-sel');
      const href = hashFor(ch, it.id, cur.q);
      const terms = ch === '~search' ? termsOf(cur.q) : null;
      const cb = el('button', {
        type: 'button', class: 'ck-cb', role: 'checkbox', 'aria-checked': it.done ? 'true' : 'false',
        'aria-label': (it.done ? '완료 취소: ' : '완료로 표시: ') + it.title, 'data-fkey': 'cb:' + it.id,
        onclick: (e) => { e.stopPropagation(); toggleItem(it.id); },
      }, el('span', { class: 'ck-cb-box', 'aria-hidden': 'true' }));
      const title = el('a', {
        class: 'ck-row-title', href, 'data-fkey': 'row:' + it.id,
        onclick: (e) => { if (!plainLinkClick(e)) return; e.preventDefault(); e.stopPropagation(); selectItem(it.id); },
      }, highlight(it.title || '(제목 없음)', terms));
      const meta = [];
      if (opts.doneMeta) meta.push(el('span', { class: 'chip good' }, '✓ ' + D.time(it.doneAt) + ' 완료'));
      else meta.push(MV.ui.dueChip(it.due, it.done));
      if (it.priority === 'high' && !it.done) meta.push(el('span', { class: 'chip bad' }, '중요'));
      if (it.owner) meta.push(el('span', { class: 'chip ' + (OWNER_CHIP[it.owner] || '') }, it.owner));
      const nn = (it.notes || []).length;
      if (nn) meta.push(el('span', { class: 'ck-meta-n', title: '메모 ' + nn + '개' }, '💬 ' + nn));
      if (it.guide) meta.push(el('span', { class: 'ck-meta-n', title: '관련 가이드가 있어요' }, '📖'));
      if (opts.showPart) {
        const p = MV.parts.get(it.partId);
        meta.push(el('button', {
          type: 'button', class: 'chip ck-pchip', title: (p ? p.name : '파트 없음') + ' 채널로',
          onclick: (e) => { e.stopPropagation(); if (p) goChannel(p.id); },
        }, partLabel(p)));
      }
      const snip = terms ? snippetFor(it, terms) : null;
      return el('div', {
        class: cls.join(' '), 'data-id': it.id,
        onclick: (e) => {
          if (e.target.closest('button, a, input, select, textarea')) return;
          const sel = window.getSelection && window.getSelection();
          if (sel && String(sel).length > 0) return;
          selectItem(it.id);
        },
      }, cb, el('div', { class: 'ck-row-main' }, title, el('div', { class: 'ck-row-meta' }, meta),
        snip ? el('div', { class: 'ck-snip' }, snip.icon + ' ', highlight(snip.text, terms)) : null));
    }

    function bucketHead(label, n, cls) {
      return el('h3', { class: 'ck-bucket-h ' + (cls || '') }, label, el('span', { class: 'ck-count' }, String(n)));
    }

    /* 목록 구성: [{node}] (빈 상태 등 매번 새로) 또는 [{sec, key, headSig, head(), rows:[[item, opts]]}] */
    function buildList(ch) {
      const nodeBlocks = (...nodes) => nodes.map((node) => ({ node }));
      if (ch === '~activity') return nodeBlocks(...buildActivity());
      const info = channelInfo(ch);
      const u = ui();
      if (info.missing) {
        return nodeBlocks(emptyState('❓', '이 파트를 찾을 수 없어요. 삭제되었을 수 있어요.',
          el('button', { type: 'button', class: 'btn btn-sm', onclick: () => nav(hashFor('~focus'), { replace: true }) }, '🔥 지금 할 일 보기')));
      }
      if (ch === '~search' && !termsOf(cur.q).length) return nodeBlocks(emptyState('🔍', '찾을 말을 입력하세요. 제목·설명·메모를 모두 뒤져요.'));
      const items = listItemsFor(ch);
      const showPart = !!info.special;
      const resetOwner = () => (u.owner ? el('button', { type: 'button', class: 'btn btn-sm', onclick: () => setUI({ owner: '' }) }, '모든 담당 보기') : null);

      if (ch === '~done') {
        if (!items.length) return nodeBlocks(emptyState('🌱', u.owner ? '“' + u.owner + '” 담당으로 끝낸 일이 아직 없어요.' : '아직 끝낸 일이 없어요. 하나씩 체크해 볼까요?', resetOwner()));
        items.sort(cmpDone);
        const realToday = D.str(new Date()); const yest = D.add(realToday, -1);
        const days = []; const byDay = new Map();
        items.forEach((it) => {
          const dt = new Date(it.doneAt);
          const k = isNaN(dt) ? '' : D.str(dt);
          if (!byDay.has(k)) { byDay.set(k, []); days.push(k); }
          byDay.get(k).push(it);
        });
        return days.map((k) => {
          const arr = byDay.get(k);
          const label = !k ? '날짜 모름' : k === realToday ? '오늘' : k === yest ? '어제' : D.fmt(k);
          return { sec: true, key: 'doneday:' + k, headSig: label + '|' + arr.length, head: () => bucketHead(label, arr.length), rows: arr.map((it) => [it, { showPart: true, doneMeta: true }]) };
        });
      }

      if (!items.length) {
        if (ch === '~search') return nodeBlocks(emptyState('🔍', '“' + cur.q + '”와(과) 맞는 항목이 없어요.', resetOwner()));
        if (u.owner) return nodeBlocks(emptyState('👤', '“' + u.owner + '” 담당 항목이 여기엔 없어요.', resetOwner()));
        if (ch === '~focus') return nodeBlocks(emptyState('😌', '급한 일이 없어요! 다음 일주일을 미리 볼까요?', el('button', { type: 'button', class: 'btn btn-sm', onclick: () => goChannel('~week') }, '🗓 7일 이내 보기')));
        if (ch === '~week') return nodeBlocks(emptyState('🗓', '7일 안에 마감인 일이 없어요.', el('button', { type: 'button', class: 'btn btn-sm', onclick: () => goChannel('~all') }, '📋 전체 보기')));
        if (ch === '~all') return nodeBlocks(emptyState('🎉', '남은 할 일이 하나도 없어요. 수고하셨어요!'));
        return nodeBlocks(emptyState('🌱', '아직 할 일이 없어요. 아래 입력창에 첫 할 일을 적어 보세요.'));
      }

      const buckets = {};
      BUCKETS.forEach((b) => { buckets[b.id] = []; });
      items.forEach((it) => {
        let s = statusOf(it);
        if (s === 'done' && lingering.has(it.id) && ch !== '~search') s = openStatusOf(it);
        (buckets[s] || buckets.nodate).push(it);
      });
      BUCKETS.forEach((b) => { buckets[b.id].sort(b.id === 'done' ? cmpDone : cmpItems); });
      const out = [];
      const openN = items.length - buckets.done.length;
      if (openN === 0 && info.part) out.push({ node: emptyState('🎉', '이 파트는 모두 끝났어요!') });
      BUCKETS.forEach((b) => {
        const arr = buckets[b.id];
        if (!arr.length) return;
        if (b.id === 'done') {
          const open = mem.doneOpen[ch] != null ? mem.doneOpen[ch] : (ch === '~search' || !u.hideDone);
          out.push({
            sec: true, key: 'b:done', cls: 'ck-bucket-done', headSig: 'done|' + arr.length + '|' + open + '|' + ch,
            head: () => el('button', {
              type: 'button', class: 'ck-bucket-h ck-done-h', 'aria-expanded': String(open), 'data-fkey': 'donegrp',
              onclick: () => { mem.doneOpen[ch] = !open; renderList(); },
            }, el('span', { class: 'ck-caret', 'aria-hidden': 'true' }, open ? '▾' : '▸'), '완료', el('span', { class: 'ck-count' }, String(arr.length))),
            rows: open ? arr.map((it) => [it, { showPart }]) : [],
          });
          return;
        }
        out.push({ sec: true, key: 'b:' + b.id, headSig: b.id + '|' + arr.length, head: () => bucketHead(b.label, arr.length, b.cls), rows: arr.map((it) => [it, { showPart }]) });
      });
      return out;
    }

    /* 줄 캐시: 내용 서명이 같으면 같은 DOM 을 그대로 둠 (다시 만들면 레이아웃·글꼴 처리 비용이 큼) */
    const rowCache = new Map();   // itemId → { sig, node }
    const secCache = new Map();   // key → { node, head, headSig }
    function rowSig(it, ch, opts) {
      const p = MV.parts.get(it.partId);
      return [ch, ch === '~search' ? cur.q + '\u0002' + haystack(it) : '', D.today(), it.title, it.done ? 1 : 0, it.doneAt || '', it.due || '',
        it.priority || '', it.owner || '', (it.notes || []).length, it.guide ? 1 : 0, it.partId,
        opts.showPart && p ? (p.emoji || '') + p.name : '', lingering.has(it.id) ? 1 : 0, opts.showPart ? 1 : 0, opts.doneMeta ? 1 : 0].join('\u0001');
    }
    function getRow(it, ch, opts) {
      const sig = rowSig(it, ch, opts);
      const c = rowCache.get(it.id);
      if (c && c.sig === sig) return c.node;
      const node = rowFor(it, ch, opts);
      rowCache.set(it.id, { sig, node });
      return node;
    }
    /* parent 의 자식(after 다음부터)을 desired 순서로 맞춤 — 최장 증가 부분수열로 움직이는 노드를 최소화 */
    function reconcile(parent, desired, after) {
      const want = new Set(desired);
      const first = () => (after ? after.nextSibling : parent.firstChild);
      for (let c = first(); c;) { const nx = c.nextSibling; if (!want.has(c)) parent.removeChild(c); c = nx; }
      const idx = new Map(desired.map((n, i) => [n, i]));
      const curNodes = [];
      for (let c = first(); c; c = c.nextSibling) curNodes.push(c);
      // LIS (patience sorting)
      const tails = []; const prev = new Array(curNodes.length);
      curNodes.forEach((n, i) => {
        const v = idx.get(n);
        let lo = 0; let hi = tails.length;
        while (lo < hi) { const mid = (lo + hi) >> 1; if (idx.get(curNodes[tails[mid]]) < v) lo = mid + 1; else hi = mid; }
        prev[i] = lo > 0 ? tails[lo - 1] : -1;
        tails[lo] = i;
      });
      const stable = new Set();
      for (let i = tails.length ? tails[tails.length - 1] : -1; i >= 0; i = prev[i]) stable.add(curNodes[i]);
      let next = null;
      for (let i = desired.length - 1; i >= 0; i--) {
        const n = desired[i];
        if (!stable.has(n)) parent.insertBefore(n, next);
        next = n;
      }
    }

    function activityIcon(text) {
      const m = /^(\p{Extended_Pictographic})[\uFE0E\uFE0F]?\s*/u.exec(text);
      if (m) return { icon: m[1] + '\uFE0F', text: text.slice(m[0].length) };
      if (/^항목 추가/.test(text)) return { icon: '➕', text };
      if (/^(항목|파트|짐) 삭제/.test(text)) return { icon: '🗑️', text };
      if (/^파트/.test(text)) return { icon: '📁', text };
      if (/^짐/.test(text)) return { icon: '📦', text };
      if (/^(백업|이사 관리|새 기본)/.test(text)) return { icon: '💾', text };
      return { icon: '•', text };
    }
    function buildActivity() {
      const acts = (MV.store.get().activity || []).slice(0, 300);
      if (!acts.length) return [emptyState('🕘', '아직 기록이 없어요.')];
      const byTitle = new Map();
      MV.items.list().forEach((i) => { if (i.title && !byTitle.has(i.title)) byTitle.set(i.title, i); });
      const realToday = D.str(new Date()); const yest = D.add(realToday, -1);
      const out = []; let day = null; let sec = null;
      acts.forEach((a) => {
        const dt = new Date(a.at);
        const k = isNaN(dt) ? '' : D.str(dt);
        if (k !== day || !sec) {
          day = k;
          sec = el('section', { class: 'ck-bucket ck-act-day' }, el('h3', { class: 'ck-bucket-h' }, !k ? '날짜 모름' : k === realToday ? '오늘' : k === yest ? '어제' : D.fmtLong(k)));
          out.push(sec);
        }
        const raw = String(a.text || '');
        const ic = activityIcon(raw);
        let target = null;
        const ci = raw.indexOf(': ');
        if (ci >= 0) {
          const rest = raw.slice(ci + 2);
          target = byTitle.get(rest) || byTitle.get(rest.split(' → ')[0]) || null;
        }
        const p = target ? MV.parts.get(target.partId) : null;
        const inner = [
          el('span', { class: 'ck-act-ico', 'aria-hidden': 'true' }, ic.icon),
          el('span', { class: 'ck-act-main' },
            el('span', { class: 'ck-act-text' }, ic.text),
            el('span', { class: 'ck-act-time' }, hhmm(a.at) + (p ? ' · ' + partLabel(p) : ''))),
        ];
        sec.appendChild(target
          ? el('button', { type: 'button', class: 'ck-act ck-act-link', title: '항목 열기', onclick: () => goChannel(target.partId, target.id) }, inner)
          : el('div', { class: 'ck-act' }, inner));
      });
      return out;
    }

    function renderList(opts) {
      opts = opts || {};
      const ch = effCh();
      const key = ch + (ch === '~search' ? ':' + cur.q : '');
      const fk = focusKeyIn(list);
      let fkIndex = -1;
      if (fk && /^(cb|row):/.test(fk)) {
        const fr = document.activeElement.closest('.ck-row');
        fkIndex = fr ? MV.$$('.ck-row', list).indexOf(fr) : -1;
      }
      let blocks;
      try { blocks = buildList(ch); } catch (e) { console.error(e); blocks = [{ node: emptyState('⚠️', '목록을 그리다 문제가 생겼어요: ' + (e && e.message)) }]; }
      const usedRows = new Set(); const usedSecs = new Set();
      const top = [];
      blocks.forEach((b) => {
        if (!b.sec) { top.push(b.node); return; }
        let sec = secCache.get(b.key);
        if (!sec) { sec = { node: el('section', { class: 'ck-bucket' + (b.cls ? ' ' + b.cls : '') }), head: null, headSig: null }; secCache.set(b.key, sec); }
        if (sec.headSig !== b.headSig || !sec.head || sec.head.parentNode !== sec.node) {
          const h = b.head();
          if (sec.head && sec.head.parentNode === sec.node) sec.node.replaceChild(h, sec.head);
          else sec.node.insertBefore(h, sec.node.firstChild);
          sec.head = h; sec.headSig = b.headSig;
        }
        const rows = b.rows.map(([it, o]) => { usedRows.add(it.id); return getRow(it, ch, o); });
        reconcile(sec.node, rows, sec.head);
        usedSecs.add(b.key);
        top.push(sec.node);
      });
      reconcile(list, top, null);
      rowCache.forEach((v, id) => { if (!usedRows.has(id)) rowCache.delete(id); });
      secCache.forEach((v, k) => { if (!usedSecs.has(k)) secCache.delete(k); });
      markSelected();
      // 자식만 바꾸면 스크롤 위치는 그대로 유지됨 → scrollTop 을 읽고 쓰지 않아 강제 레이아웃을 피함
      if (opts.restore && !isPhone()) list.scrollTop = mem.listScroll[key] || 0;
      restoreFocusIn(list, fk);
      // 초점이 있던 줄이 사라졌으면(완료 묶음으로 접힘 등) 같은 자리의 다음 줄로
      if (fk && fkIndex >= 0 && (!document.activeElement || document.activeElement === document.body || !list.contains(document.activeElement))) {
        const rows = MV.$$('.ck-row', list);
        const r = rows[Math.min(fkIndex, rows.length - 1)];
        const t = r && r.querySelector(fk.indexOf('cb:') === 0 ? '.ck-cb' : '.ck-row-title');
        if (t) t.focus({ preventScroll: true });
      }
      if (pendingFlash) {
        const pf = pendingFlash; pendingFlash = null;
        const row = list.querySelector('.ck-row[data-id="' + cssEsc(pf.id) + '"]');
        if (row) {
          row.classList.remove('ck-flash'); void row.offsetWidth; row.classList.add('ck-flash');
          row.addEventListener('animationend', () => row.classList.remove('ck-flash'), { once: true });
          row.scrollIntoView({ block: 'nearest' });
        } else {
          const p = MV.parts.get(pf.partId);
          MV.ui.toast('“' + pf.title + '” → ' + partLabel(p) + '에 추가했어요', { action: { label: '보기', onClick: () => goChannel(pf.partId, pf.id) } });
        }
      }
    }
    function markSelected() {
      MV.$$('.ck-row', list).forEach((r) => r.classList.toggle('ck-sel', r.dataset.id === cur.itemId));
    }

    function toggleItem(id) {
      const it = MV.items.get(id);
      if (!it) return;
      const willDone = !it.done;
      if (lingering.has(id)) { clearTimeout(lingering.get(id)); lingering.delete(id); }
      if (willDone) {
        lingering.set(id, setTimeout(() => { lingering.delete(id); if (alive) { renderList(); renderHeader(); } }, 1300));
      }
      MV.items.toggle(id);
      if (willDone) {
        MV.ui.toast('완료했어요', {
          action: { label: '되돌리기', onClick: () => { const x = MV.items.get(id); if (x && x.done) { if (lingering.has(id)) { clearTimeout(lingering.get(id)); lingering.delete(id); } MV.items.toggle(id); } } },
        });
      } else MV.ui.toast('다시 열었어요');
    }

    /* ---------- 입력창 (composer) ---------- */
    function fillPartSelect(sel, value, placeholder) {
      const parts = MV.parts.list();
      const sig = parts.map((p) => p.id + '|' + p.name + '|' + p.emoji + '|' + p.group).join(',') + '#' + (placeholder || '');
      if (sel.dataset.sig !== sig) {
        sel.dataset.sig = sig;
        const groups = []; const gmap = new Map();
        parts.forEach((p) => { const g = p.group || '기타'; if (!gmap.has(g)) { gmap.set(g, []); groups.push(g); } gmap.get(g).push(p); });
        put(sel, 
          placeholder ? el('option', { value: '' }, placeholder) : null,
          groups.map((g) => el('optgroup', { label: g }, gmap.get(g).map((p) => el('option', { value: p.id }, partLabel(p))))));
      }
      if (value != null) sel.value = value;
      if (sel.selectedIndex < 0 && sel.options.length) sel.selectedIndex = 0;
    }
    function updateComposer() {
      const ch = effCh();
      const sp = isSpecial(ch);
      const show = (ch === '~focus' || ch === '~week' || ch === '~all') || (!sp && !!MV.parts.get(ch));
      composer.hidden = !show;
      if (!show) return;
      compPart.hidden = !sp;
      if (sp && document.activeElement !== compPart) {
        const parts = MV.parts.list();
        const want = parts.some((p) => p.id === mem.composerPart) ? mem.composerPart : (parts[0] ? parts[0].id : '');
        fillPartSelect(compPart, want);
      }
      if (compInput.value !== mem.draft && document.activeElement !== compInput) compInput.value = mem.draft;
      updatePreview();
    }
    function updatePreview() {
      const raw = compInput.value;
      mem.draft = raw;
      composer.classList.toggle('ck-has-text', !!raw.trim());
      if (!raw.trim()) {
        put(compPrev, el('span', { class: 'ck-hint' },
          '빠른 입력: ', el('code', '~10/15'), ' ', el('code', '~내일'), ' ', el('code', '~D-3'), ' 마감 · ', el('code', '!중요'), ' · ', el('code', '@아내')));
        return;
      }
      const p = parseQuick(raw);
      const u = ui();
      const owner = p.owner != null ? p.owner : (u.owner || '');
      const chips = [];
      if (p.due) {
        const dd = D.dday(p.due);
        chips.push(el('span', { class: 'chip ' + (dd.n < 0 ? 'bad' : dd.n <= 3 ? 'warn' : 'brand') }, '📅 ' + D.fmt(p.due) + ' · ' + (dd.n === 0 ? '오늘' : dd.label)));
      } else chips.push(el('span', { class: 'chip' }, '📅 기한 없음'));
      if (p.priority) chips.push(el('span', { class: 'chip ' + (p.priority === 'high' ? 'bad' : '') }, PRI_LABEL[p.priority]));
      if (owner) chips.push(el('span', { class: 'chip ' + (OWNER_CHIP[owner] || '') }, '👤 ' + owner + (p.owner == null ? ' (필터)' : '')));
      p.bad.forEach((b) => chips.push(el('span', { class: 'chip warn' }, '“' + b + '” 날짜를 못 읽었어요')));
      if (isSpecial(effCh())) {
        const pt = MV.parts.get(compPart.value);
        if (pt) chips.push(el('span', { class: 'ck-prev-to' }, '→ ' + partLabel(pt)));
      }
      if (!p.title) chips.push(el('span', { class: 'ck-prev-warn' }, '할 일 내용을 적어 주세요'));
      put(compPrev, ...chips);
    }
    function addFromComposer() {
      const raw = compInput.value.trim();
      if (!raw) { compInput.focus(); return; }
      const p = parseQuick(raw);
      if (!p.title) {
        compInput.classList.remove('ck-shake'); void compInput.offsetWidth; compInput.classList.add('ck-shake');
        MV.ui.toast('할 일 내용을 적어 주세요');
        return;
      }
      const ch = effCh();
      const partId = isSpecial(ch) ? compPart.value : ch;
      if (!partId || !MV.parts.get(partId)) { MV.ui.toast('추가할 파트를 먼저 만들어 주세요'); return; }
      const owner = p.owner != null ? p.owner : (ui().owner || '');
      compInput.value = ''; mem.draft = '';
      const it = MV.items.add({ partId, title: p.title, due: p.due || null, priority: p.priority || 'mid', owner });
      pendingFlash = { id: it.id, partId, title: it.title };
      updatePreview();
      compInput.focus({ preventScroll: true });
    }
    compInput.addEventListener('input', updatePreview);
    compInput.addEventListener('focus', updatePreview);
    compInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.isComposing && e.keyCode !== 229) { e.preventDefault(); addFromComposer(); }
      else if (e.key === 'Escape' && !e.isComposing && compInput.value) { e.preventDefault(); e.stopPropagation(); compInput.value = ''; updatePreview(); }
    });
    compBtn.addEventListener('click', addFromComposer);
    compPart.addEventListener('change', () => { mem.composerPart = compPart.value; updatePreview(); });

    /* ---------- 검색 ---------- */
    const runSearch = MV.debounce(() => {
      if (!alive) return;
      const q = searchInput.value.trim();
      if (q) {
        nav(hashFor('~search', null, q), { replace: cur.ch === '~search' });
      } else if (cur.ch === '~search') {
        exitSearch();
      }
    }, 250);
    function exitSearch() {
      const target = isPhone() ? '#/checklist' : hashFor(mem.lastChannel && (MV.parts.get(mem.lastChannel) || SPECIAL_MAP[mem.lastChannel]) ? mem.lastChannel : '~focus');
      goBackTo(target);
    }
    searchInput.addEventListener('input', () => { searchClear.hidden = !searchInput.value; runSearch(); });
    searchInput.addEventListener('keydown', (e) => {
      if (e.isComposing || e.keyCode === 229) return;
      if (e.key === 'Enter') { e.preventDefault(); runSearch.flush(); if (isPhone()) searchInput.blur(); }
      else if (e.key === 'Escape') {
        e.preventDefault(); e.stopPropagation();
        searchInput.value = ''; searchClear.hidden = true;
        runSearch.flush();
        if (cur.ch === '~search') exitSearch();
        searchInput.blur();
      }
    });
    searchClear.addEventListener('click', () => {
      searchInput.value = ''; searchClear.hidden = true;
      if (cur.ch === '~search') exitSearch();
      if (!isPhone()) searchInput.focus();
    });

    /* ================================================================
       스레드 (항목 상세)
       ================================================================ */
    const T = { id: null, f: {}, notesSig: '', linksSig: '', scrollNotes: false };

    function clearThread() {
      T.id = null; T.f = {}; T.notesSig = ''; T.linksSig = '';
      put(thread);
    }
    function curItem() { return T.id ? MV.items.get(T.id) : null; }

    function commitTitle() {
      const it = curItem(); const f = T.f;
      if (!it || !f.title) return;
      const v = f.title.value.replace(/\s+/g, ' ').trim();
      if (!v) { f.title.value = it.title; autosize(f.title); return; }
      if (v !== it.title) MV.items.update(it.id, { title: v }, '✏️ 제목 변경: ' + v);
    }
    function commitDetail(final) {
      const it = curItem(); const f = T.f;
      if (!it || !f.detail) return;
      const v = f.detail.value;
      const logText = '📝 설명 수정: ' + it.title;
      if (v !== (it.detail || '')) MV.items.update(it.id, { detail: v }, final && v !== f.detail._orig ? logText : undefined);
      else if (final && f.detail._orig != null && v !== f.detail._orig) MV.store.log(logText);
      if (final) f.detail._orig = v;
    }
    const saveDetailSoon = MV.debounce(() => { if (alive) commitDetail(false); }, 900);
    function flushThread() {
      if (!T.id) return;
      saveDetailSoon.flush();
      commitTitle();
      commitDetail(true);
      if (T.f.noteInput) mem.noteDrafts[T.id] = T.f.noteInput.value;
    }

    function setDue(v) {
      const it = curItem();
      if (!it) return;
      const nv = v || null;
      if ((it.due || null) === nv) { syncThread(); return; }
      MV.items.update(it.id, { due: nv }, '📅 마감 변경: ' + it.title + ' → ' + (nv ? D.fmt(nv) : '없음'));
    }
    function moveTo(partId) {
      const it = curItem(); const p = MV.parts.get(partId);
      if (!it || !p || it.partId === partId) return;
      flushThread();
      MV.items.update(it.id, { partId }, '📁 파트 이동: ' + it.title + ' → ' + p.name);
      MV.ui.toast(partLabel(p) + '(으)로 옮겼어요');
      if (!isSpecial(cur.ch)) nav(hashFor(partId, it.id), { replace: true });
    }
    function addLink() {
      const it = curItem();
      if (!it) return;
      const url = el('input', { class: 'input', type: 'url', placeholder: 'https://…', inputmode: 'url' });
      const label = el('input', { class: 'input', placeholder: '예) 견적서, 제품 페이지 (비워도 돼요)' });
      const id = it.id;
      const save = () => {
        let u = url.value.trim();
        if (!u) { url.focus(); url.setAttribute('aria-invalid', 'true'); return false; }
        if (!/^[a-z][a-z0-9+.-]*:/i.test(u)) u = 'https://' + u;
        const x = MV.items.get(id);
        if (!x) return true;
        const links = (x.links || []).concat([{ label: label.value.trim() || u.replace(/^https?:\/\//, '').slice(0, 40), url: u }]);
        MV.items.update(id, { links }, '🔗 링크 추가: ' + x.title);
        return true;
      };
      let m = null;
      [url, label].forEach((inp) => inp.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.isComposing && e.keyCode !== 229) { e.preventDefault(); if (save() && m) m.close(); }
      }));
      m = MV.ui.modal({
        title: '링크 추가',
        body: el('div', { class: 'stack' }, el('label', { class: 'field' }, el('span', '주소 (URL)'), url), el('label', { class: 'field' }, el('span', '이름'), label)),
        actions: [{ label: '취소', kind: 'ghost' }, { label: '추가', kind: 'primary', onClick: () => save() }],
      });
    }
    function removeLink(idx) {
      const it = curItem();
      if (!it) return;
      const links = (it.links || []).slice();
      const [gone] = links.splice(idx, 1);
      const id = it.id;
      MV.items.update(id, { links });
      MV.ui.toast('링크를 지웠어요', { action: { label: '되돌리기', onClick: () => {
        const x = MV.items.get(id); if (!x) return;
        const l2 = (x.links || []).slice(); l2.splice(Math.min(idx, l2.length), 0, gone);
        MV.items.update(id, { links: l2 });
      } } });
    }
    function deleteItem() {
      const it = curItem();
      if (!it) return;
      const nn = (it.notes || []).length;
      MV.ui.confirm('“' + it.title + '” 항목을 지울까요?' + (nn ? ' 메모 ' + nn + '개도 함께 지워져요.' : ''), { danger: true, okLabel: '삭제', title: '항목 삭제' })
        .then((ok) => {
          if (!ok || !alive) return;
          const snap = MV.clone(MV.items.get(it.id));
          if (!snap) return;
          T.id = null;
          nav(hashFor(cur.ch || '~focus', null, cur.q), { replace: true });
          MV.items.remove(snap.id);
          MV.ui.toast('항목을 지웠어요', { action: { label: '되돌리기', onClick: () => {
            MV.store.update((st) => {
              if (!st.items.some((x) => x.id === snap.id)) st.items.push(snap);
              st.meta.deletedSeed = (st.meta.deletedSeed || []).filter((x) => x !== snap.id);
            }, { log: '↩︎ 항목 복구: ' + snap.title });
          } } });
        });
    }

    function buildThread(it) {
      if (!it) { clearThread(); return; }
      T.id = it.id; T.notesSig = ''; T.linksSig = '';
      const f = T.f = {};
      const id = it.id;

      // 머리: 파트 칩 + 옮기기 + 닫기
      f.back = el('button', { type: 'button', class: 'btn btn-ghost ck-th-back ck-phone-only', onclick: () => closeThread() }, '← 목록');
      f.partChip = el('button', { type: 'button', class: 'chip ck-pchip ck-th-part', onclick: () => { const x = curItem(); if (x && MV.parts.get(x.partId)) goChannel(x.partId, x.id); } });
      f.moveSel = el('select', { class: 'select ck-move', 'aria-label': '다른 파트로 옮기기', title: '다른 파트로 옮기기' });
      f.moveSel.addEventListener('change', () => { const v = f.moveSel.value; f.moveSel.value = ''; if (v) moveTo(v); });
      f.close = el('button', { type: 'button', class: 'btn btn-ghost btn-icon ck-th-close', 'aria-label': '상세 닫기 (Esc)', title: '닫기 (Esc)', onclick: () => closeThread() }, '✕');
      const headEl = el('div', { class: 'ck-th-head' }, f.back, f.partChip, el('span', { class: 'ck-spacer' }), f.moveSel, f.close);

      // 완료 + 제목
      f.doneBtn = el('button', { type: 'button', class: 'ck-th-done', onclick: () => toggleItem(id) });
      f.title = el('textarea', { class: 'ck-th-title', rows: '1', 'aria-label': '제목', maxlength: '300', spellcheck: 'false' });
      f.title.value = it.title || '';
      f.title.addEventListener('input', () => autosize(f.title));
      f.title.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.isComposing && e.keyCode !== 229) { e.preventDefault(); f.title.blur(); }
        else if (e.key === 'Escape' && !e.isComposing) { e.stopPropagation(); const x = curItem(); if (x) f.title.value = x.title; f.title.blur(); }
      });
      f.title.addEventListener('blur', () => { if (T.id === id) commitTitle(); });

      // 마감
      f.due = el('input', { class: 'input ck-due', type: 'date', 'aria-label': '마감일' });
      f.due.value = D.valid(it.due) ? D.str(D.parse(it.due)) : '';
      f.due.addEventListener('change', () => { if (T.id === id) setDue(f.due.value || null); });
      const base = () => { const x = curItem(); return x && D.valid(x.due) ? D.str(D.parse(x.due)) : D.today(); };
      const quick = (label, fn, aria) => el('button', { type: 'button', class: 'btn btn-sm ck-quick', 'aria-label': aria || label, onclick: () => setDue(fn()) }, label);
      f.dueInfo = el('div', { class: 'ck-due-info' });
      const dueBox = el('div', { class: 'ck-due-box' },
        el('div', { class: 'ck-due-row' }, f.due),
        el('div', { class: 'ck-quicks' },
          quick('+1일', () => D.add(base(), 1), '마감 하루 미루기'),
          quick('+7일', () => D.add(base(), 7), '마감 일주일 미루기'),
          quick('이사 D-7', () => D.add(D.moveDate(), -7), '이사 7일 전으로'),
          quick('이사 당일', () => D.moveDate(), '이사 당일로'),
          quick('지우기', () => null, '마감 지우기')),
        f.dueInfo);

      // 중요도·담당
      f.prio = seg([['high', '중요', 'ck-seg-bad'], ['mid', '보통'], ['low', '여유']], it.priority || 'mid', (v) => {
        const x = curItem(); if (!x || (x.priority || 'mid') === v) return;
        MV.items.update(id, { priority: v }, '🚩 중요도 변경: ' + x.title + ' → ' + PRI_LABEL[v]);
      }, '중요도');
      f.owner = seg([['', '없음'], ['나', '나'], ['아내', '아내'], ['함께', '함께']], it.owner || '', (v) => {
        const x = curItem(); if (!x || (x.owner || '') === v) return;
        MV.items.update(id, { owner: v }, '👤 담당 변경: ' + x.title + ' → ' + (v || '없음'));
      }, '담당');

      // 설명
      f.detail = el('textarea', { class: 'textarea ck-detail', id: 'ck-detail-' + String(id).replace(/[^\w-]/g, ''), rows: '3', 'aria-label': '설명', placeholder: '자세한 내용, 전화번호, 준비물, 결정한 것…' });
      f.detail.value = it.detail || '';
      f.detail._orig = f.detail.value;
      f.detail.addEventListener('focus', () => { const x = curItem(); f.detail._orig = x ? (x.detail || '') : f.detail.value; });
      f.detail.addEventListener('input', () => { autosize(f.detail, 420); renderDetailPreview(f.detail.value); saveDetailSoon(); });
      f.detail.addEventListener('blur', () => { if (T.id === id) { saveDetailSoon.flush(); commitDetail(true); } });
      f.detailPrev = el('div', { class: 'ck-detail-prev' });

      // 링크·가이드
      f.links = el('div', { class: 'ck-links' });
      f.guide = el('div', { class: 'ck-guide' });

      // 메모 타임라인
      f.notesCount = el('span', { class: 'ck-count' });
      f.notes = el('div', { class: 'ck-notes', 'aria-live': 'polite' });
      f.stamps = el('p', { class: 'ck-stamps' });
      const delBtn = el('button', { type: 'button', class: 'btn btn-danger btn-sm ck-del', onclick: deleteItem }, '🗑 항목 삭제');

      f.body = el('div', { class: 'ck-th-body' },
        el('div', { class: 'ck-th-top' }, f.doneBtn),
        f.title,
        el('div', { class: 'ck-fields' },
          el('div', { class: 'ck-field' }, el('span', { class: 'ck-field-l' }, '마감'), dueBox),
          el('div', { class: 'ck-field' }, el('span', { class: 'ck-field-l' }, '중요도'), f.prio),
          el('div', { class: 'ck-field' }, el('span', { class: 'ck-field-l' }, '담당'), f.owner)),
        el('div', { class: 'ck-sec' }, el('label', { class: 'ck-sec-h', for: f.detail.id }, '설명'), f.detail, f.detailPrev),
        el('div', { class: 'ck-sec' }, el('div', { class: 'ck-sec-h' }, '링크', el('button', { type: 'button', class: 'btn btn-ghost btn-sm ck-addlink', onclick: addLink }, '+ 링크 추가')), f.links, f.guide),
        el('div', { class: 'ck-sec ck-thread-sec' }, el('div', { class: 'ck-sec-h ck-thread-h' }, '💬 메모', f.notesCount), f.notes),
        f.stamps,
        el('div', { class: 'ck-th-danger' }, delBtn));

      // 메모 입력
      f.noteInput = el('textarea', { class: 'textarea ck-note-input', rows: '1', 'aria-label': '메모 입력', placeholder: '메모 남기기… (Enter 저장 · Shift+Enter 줄바꿈)' });
      f.noteInput.value = mem.noteDrafts[id] || '';
      f.noteSend = el('button', { type: 'button', class: 'btn btn-primary ck-note-send', 'aria-label': '메모 저장' }, '보내기');
      const sendNote = () => {
        const v = f.noteInput.value.trim();
        if (!v) { f.noteInput.focus(); return; }
        T.scrollNotes = true;
        f.noteInput.value = ''; mem.noteDrafts[id] = '';
        autosize(f.noteInput, 160);
        MV.items.addNote(id, v);
        f.noteInput.focus({ preventScroll: true });
      };
      f.noteInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && e.keyCode !== 229) { e.preventDefault(); sendNote(); }
      });
      f.noteInput.addEventListener('input', () => { mem.noteDrafts[id] = f.noteInput.value; autosize(f.noteInput, 160); });
      f.noteSend.addEventListener('click', sendNote);
      const foot = el('div', { class: 'ck-th-foot' }, el('div', { class: 'ck-note-row' }, f.noteInput, f.noteSend));

      put(thread, headEl, f.body, foot);
      syncThread(true);
      f.body.scrollTop = 0;
      requestAnimationFrame(() => { if (T.f === f) { autosize(f.title); autosize(f.detail, 420); autosize(f.noteInput, 160); } });
    }

    function renderDetailPreview(text) {
      const f = T.f;
      if (!f.detailPrev) return;
      const has = /https?:\/\//.test(text || '');
      f.detailPrev.hidden = !has;
      if (has) put(f.detailPrev, el('span', { class: 'ck-prev-lbl' }, '링크 미리보기'), el('div', MV.linkify(text)));
      else put(f.detailPrev);
    }

    function syncThread(initial) {
      if (!T.id) return;
      const it = MV.items.get(T.id);
      const f = T.f;
      if (!it) {
        // 다른 곳에서 지워짐 → 닫기
        const h = hashFor(cur.ch || '~focus', null, cur.q);
        T.id = null;
        try { history.replaceState(history.state, '', h); } catch (e) { /* 무시 */ }
        MV.route = { name: 'checklist', params: MV.parseHash().params };
        applyRoute(MV.route.params, 'replace');
        return;
      }
      const ae = document.activeElement;
      const p = MV.parts.get(it.partId);
      f.partChip.textContent = partLabel(p);
      f.partChip.title = p ? p.name + ' 채널 보기' : '';
      if (ae !== f.moveSel) {
        fillPartSelect(f.moveSel, '', '📁 다른 파트로 옮기기…');
        MV.$$('option', f.moveSel).forEach((o) => { o.disabled = o.value === it.partId; });
        f.moveSel.value = '';
      }
      // 완료
      f.doneBtn.className = 'ck-th-done' + (it.done ? ' ck-on' : '');
      f.doneBtn.setAttribute('aria-pressed', String(!!it.done));
      put(f.doneBtn, el('span', { class: 'ck-cb-box', 'aria-hidden': 'true' }), it.done ? '완료됨 · ' + D.time(it.doneAt) : '완료로 표시');
      thread.classList.toggle('ck-th-isdone', !!it.done);
      // 제목·설명 (입력 중이면 건드리지 않음)
      if (ae !== f.title && f.title.value !== (it.title || '')) { f.title.value = it.title || ''; autosize(f.title); }
      if (ae !== f.detail && f.detail.value !== (it.detail || '')) { f.detail.value = it.detail || ''; f.detail._orig = f.detail.value; autosize(f.detail, 420); }
      renderDetailPreview(ae === f.detail ? f.detail.value : (it.detail || ''));
      // 마감
      const dueStr = D.valid(it.due) ? D.str(D.parse(it.due)) : '';
      if (ae !== f.due && f.due.value !== dueStr) f.due.value = dueStr;
      if (dueStr) {
        const dd = D.dday(dueStr);
        const toMove = D.diff(dueStr, D.moveDate());
        put(f.dueInfo, MV.ui.dueChip(dueStr, it.done), el('span', { class: 'ck-due-move' },
          toMove > 0 ? '이사 ' + toMove + '일 전' : toMove === 0 ? '이사 당일' : '이사 ' + (-toMove) + '일 후'));
        f.dueInfo.title = D.fmtLong(dueStr) + ' · ' + dd.label;
      } else put(f.dueInfo, el('span', { class: 'chip' }, '기한 없음'));
      f.prio.set(it.priority || 'mid');
      f.owner.set(it.owner || '');
      // 링크·가이드
      const links = (it.links || []).filter((l) => l && l.url);
      const lsig = JSON.stringify(links);
      if (lsig !== T.linksSig) {
        T.linksSig = lsig;
        put(f.links, ...(links.length ? links.map((l, i) => el('div', { class: 'ck-link' },
          el('a', { href: l.url, target: '_blank', rel: 'noopener noreferrer' }, '🔗 ', l.label || l.url),
          el('button', { type: 'button', class: 'ck-x', 'aria-label': '링크 지우기: ' + (l.label || l.url), onclick: () => {
            const x = curItem(); if (!x) return;
            const idx = (x.links || []).findIndex((y) => y && y.url === l.url && y.label === l.label);
            if (idx >= 0) removeLink(idx); else if (i < (x.links || []).length) removeLink(i);
          } }, '×')))
          : [el('p', { class: 'ck-none' }, '견적서·제품 페이지 주소를 붙여 두면 편해요.')]));
      }
      const g = it.guide || (p && p.guide) || '';
      put(f.guide, g ? el('a', { class: 'ck-guide-link', href: guideHash(g) }, '📖 ', it.guide ? '관련 가이드 보기' : (p ? p.name + ' 가이드 보기' : '가이드 보기')) : '');
      f.guide.hidden = !g;
      // 메모
      const notes = it.notes || [];
      const nsig = notes.map((n) => n.id + ':' + (n.text || '').length).join(',');
      f.notesCount.textContent = String(notes.length);
      if (nsig !== T.notesSig) {
        T.notesSig = nsig;
        const fk = focusKeyIn(f.notes);
        put(f.notes, ...(notes.length ? notes.map((n) => el('div', { class: 'ck-note', 'data-nid': n.id },
          el('span', { class: 'ck-note-ava', 'aria-hidden': 'true' }, '📝'),
          el('div', { class: 'ck-note-body' },
            el('div', { class: 'ck-note-meta' },
              el('span', { class: 'ck-note-who' }, '메모'),
              el('time', { class: 'ck-note-time', datetime: n.at || '' }, D.time(n.at)),
              el('button', {
                type: 'button', class: 'ck-x ck-note-del', 'aria-label': '메모 지우기', 'data-fkey': 'nd:' + n.id,
                onclick: () => MV.ui.confirm('이 메모를 지울까요?', { danger: true, okLabel: '지우기', title: '메모 삭제' }).then((ok) => { if (ok && T.id) MV.items.removeNote(T.id, n.id); }),
              }, '×')),
            el('div', { class: 'ck-note-text' }, MV.linkify(n.text)))))
          : [el('p', { class: 'ck-none ck-notes-empty' }, '아직 메모가 없어요. 통화 내용, 견적, 결정한 것을 남겨 두면 나중에 찾기 쉬워요.')]));
        restoreFocusIn(f.notes, fk);
        if (T.scrollNotes && !initial) {
          T.scrollNotes = false;
          const last = f.notes.lastElementChild;
          if (last) {
            last.classList.add('ck-flash');
            last.addEventListener('animationend', () => last.classList.remove('ck-flash'), { once: true });
            if (isPhone()) last.scrollIntoView({ block: 'nearest' });
            else f.body.scrollTop = f.body.scrollHeight;
          }
        }
      }
      f.stamps.textContent = '만든 날 ' + (D.time(it.createdAt) || '-') + ' · 마지막 수정 ' + (D.time(it.updatedAt) || '-') + (it.seed ? ' · 기본 항목' : '');
    }

    /* ---------- 갱신 ---------- */
    let queued = false;
    function refresh() {
      if (!alive) return;
      if (cur.itemId && !MV.items.get(cur.itemId)) {
        const h = hashFor(cur.ch || '~focus', null, cur.q);
        try { history.replaceState(history.state, '', h); } catch (e) { /* 무시 */ }
        MV.route = { name: 'checklist', params: MV.parseHash().params };
        applyRoute(MV.route.params, 'replace');
      }
      renderSidebar();
      renderHeader();
      renderList();
      updateComposer();
      syncThread();
    }
    ctx.subscribe(() => {
      if (!alive || queued) return;
      queued = true;
      Promise.resolve().then(() => { queued = false; try { refresh(); } catch (e) { console.error(e); } });
    });

    /* ---------- 키보드 ---------- */
    function onKey(e) {
      if (!alive || e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return;
      if (document.querySelector('.modal-back')) return;
      const t = e.target;
      const typing = isTyping(t);
      if (e.key === 'Escape') {
        if (cur.itemId) { e.preventDefault(); closeThread(); }
        else if (typing && t === compInput) compInput.blur();
        return;
      }
      if (typing || e.isComposing) return;
      const k = e.key;
      if (k === '/') { e.preventDefault(); if (isPhone() && cur.ch) nav('#/checklist'); searchInput.focus(); searchInput.select(); }
      else if (k === 'n' || k === 'ㅜ') { if (!composer.hidden) { e.preventDefault(); compInput.focus(); } }
      else if (k === 'j' || k === 'ㅓ') { e.preventDefault(); moveSel(1); }
      else if (k === 'k' || k === 'ㅏ') { e.preventDefault(); moveSel(-1); }
    }
    function moveSel(d) {
      const rows = MV.$$('.ck-row[data-id]', list);
      if (!rows.length) return;
      let i = rows.findIndex((r) => r.dataset.id === cur.itemId);
      i = i < 0 ? (d > 0 ? 0 : rows.length - 1) : MV.clamp(i + d, 0, rows.length - 1);
      const id = rows[i].dataset.id;
      if (id === cur.itemId) return;
      selectItem(id);
      const r = list.querySelector('.ck-row[data-id="' + cssEsc(id) + '"]');
      if (r) { r.scrollIntoView({ block: 'nearest' }); if (isDesk()) { const a = r.querySelector('.ck-row-title'); if (a) a.focus({ preventScroll: true }); } }
    }
    document.addEventListener('keydown', onKey);
    ctx.onCleanup(() => document.removeEventListener('keydown', onKey));

    /* ---------- 화면 크기 변화 ---------- */
    const mqP = mq(MQ_PHONE); const mqD = mq(MQ_DESK);
    const onMode = () => { if (!alive) return; renderSidebar(); requestAnimationFrame(() => { if (T.f.title) { autosize(T.f.title); autosize(T.f.detail, 420); autosize(T.f.noteInput, 160); } }); };
    try { mqP.addEventListener('change', onMode); mqD.addEventListener('change', onMode); } catch (e) { /* 옛 브라우저 */ }
    ctx.onCleanup(() => { try { mqP.removeEventListener('change', onMode); mqD.removeEventListener('change', onMode); } catch (e) { /* 무시 */ } });

    ctx.onCleanup(() => {
      try { flushThread(); } catch (e) { /* 무시 */ }
      alive = false;
      lingering.forEach((t) => clearTimeout(t));
      lingering.clear();
      if (!isPhone()) mem.listScroll[effCh() + (effCh() === '~search' ? ':' + cur.q : '')] = list.scrollTop;
      else mem.winScroll[screenKey()] = window.scrollY;
      mem.sideScroll = chans.scrollTop;
      mem.unmountedAt = performance.now();
    });

    /* ---------- 시작 ---------- */
    compInput.value = mem.draft || '';
    applyRoute(params || [], 'init');
  }

  /* ================================================================
     스타일
     ================================================================ */
  const CSS = `
/* ---------- 공통 조각 ---------- */
.ck { --ck-side: 248px; --ck-thread: clamp(320px, 30vw, 400px); position: relative; }
.ck-spacer { flex: 1 1 auto; }
.ck-phone-only { display: none !important; }
.ck .ck-mark { background: color-mix(in srgb, var(--warn) 30%, transparent); color: inherit; border-radius: 3px; padding: 0 1px; }
.ck kbd { font-size: .7rem; padding: 0 .35em; border: 1px solid var(--line-2); border-bottom-width: 2px; background: var(--bg-2); }

/* 사이드바 */
.ck-side { display: flex; flex-direction: column; min-height: 0; min-width: 0; background: color-mix(in srgb, var(--bg-3) 50%, var(--bg-2)); border-right: 1px solid var(--line); }
.ck-side-head { flex: none; padding: 14px 12px 6px; }
.ck-ws-row { display: flex; align-items: baseline; gap: 8px; margin-bottom: 6px; }
.ck-ws-title { font-size: 1.05rem; margin: 0; }
.ck-ws-sub { margin-left: auto; font-size: .74rem; color: var(--ink-3); font-variant-numeric: tabular-nums; white-space: nowrap; }
.ck-ws .progress { height: 6px; }
.ck-ws-note { margin: 6px 0 0; font-size: .74rem; color: var(--ink-3); }
.ck-ws-over { color: var(--bad); font-weight: 700; }
.ck-search { position: relative; margin-top: 10px; }
.ck-search-ico { position: absolute; left: 10px; top: 50%; transform: translateY(-50%); font-size: .8rem; opacity: .65; pointer-events: none; }
.ck-search-input { padding-left: 32px; padding-right: 34px; min-height: 38px; font-size: .9rem; }
.ck-search-input::-webkit-search-cancel-button { -webkit-appearance: none; appearance: none; display: none; }
.ck-search-clear { position: absolute; right: 4px; top: 50%; transform: translateY(-50%); width: 30px; height: 30px; border: 0; border-radius: 8px; background: transparent; color: var(--ink-3); font: inherit; cursor: pointer; }
.ck-search-clear:hover { background: var(--bg-3); color: var(--ink); }
.ck-chans { flex: 1 1 auto; min-height: 0; overflow-y: auto; overscroll-behavior: contain; padding: 4px 8px 12px; }
.ck-group + .ck-group { margin-top: 4px; }
.ck-group-sp { padding-bottom: 6px; border-bottom: 1px solid var(--line); }
.ck-group-h { margin: 0; padding: 12px 8px 4px; font-size: .72rem; font-weight: 800; letter-spacing: .02em; color: var(--ink-3); }
.ck-chan { display: flex; align-items: center; gap: 8px; min-height: 36px; padding: 4px 8px; border-radius: 8px; color: var(--ink-2); text-decoration: none; font-size: .9rem; font-weight: 600; line-height: 1.3; }
.ck-chan:hover { background: var(--bg-3); color: var(--ink); }
.ck-chan.ck-active { background: var(--brand); color: var(--on-brand); }
.ck-chan-emo { flex: none; width: 1.4em; text-align: center; }
.ck-chan-name { flex: 1 1 auto; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.ck-chan-meta { flex: none; font-size: .72rem; font-weight: 600; color: var(--ink-3); font-variant-numeric: tabular-nums; }
.ck-chan.ck-active .ck-chan-meta { color: inherit; opacity: .85; }
.ck-chan-badge { flex: none; }
.ck-chan.ck-active .ck-chan-badge { background: var(--on-brand); color: var(--brand); }
.ck-side-empty { font-size: .82rem; color: var(--ink-3); padding: 12px 8px; margin: 0; }
.ck-side-foot { flex: none; padding: 8px; border-top: 1px solid var(--line); }
.ck-addpart { width: 100%; min-height: 38px; display: flex; align-items: center; gap: 6px; padding: 0 10px; border: 1px dashed var(--line-2); border-radius: 10px; background: transparent; color: var(--ink-2); font: inherit; font-size: .88rem; font-weight: 700; cursor: pointer; }
.ck-addpart:hover { background: var(--bg-2); color: var(--brand); border-color: var(--brand); }
.ck-keys { display: none; margin: 8px 2px 0; font-size: .7rem; color: var(--ink-3); line-height: 1.8; }
@media (hover: hover) and (pointer: fine) { .ck-keys { display: block; } }

/* 채널 머리 */
.ck-main { display: flex; flex-direction: column; min-width: 0; min-height: 0; background: var(--bg-2); }
.ck-head { flex: none; padding: 12px 16px 0; }
.ck-head-top { display: flex; align-items: center; gap: 8px; min-width: 0; min-height: 38px; }
.ck-head-emo { flex: none; font-size: 1.3rem; line-height: 1; }
.ck-head-title { margin: 0; min-width: 0; font-size: 1.15rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.ck-guide-btn { flex: none; }
.ck-menu-btn { flex: none; }
.ck-sub { flex: none; padding: 0 16px 10px; border-bottom: 1px solid var(--line); }
.ck-head { border-bottom: 0; }
.ck-sub[hidden] + .ck-list { border-top: 1px solid var(--line); }
.ck-head-desc { margin: 2px 0 0; font-size: .82rem; color: var(--ink-3); line-height: 1.45; }
.ck-head-bar { display: flex; align-items: center; gap: 8px 12px; flex-wrap: wrap; margin-top: 8px; }
.ck-prog { display: flex; align-items: center; gap: 8px; flex: 1 1 180px; min-width: 0; max-width: 340px; }
.ck-prog .progress { flex: 1 1 auto; min-width: 60px; }
.ck-prog-sp { flex: 1 1 auto; max-width: none; }
.ck-prog-txt { font-size: .78rem; font-weight: 700; color: var(--ink-2); white-space: nowrap; font-variant-numeric: tabular-nums; }
.ck-filters { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; margin-left: auto; }

/* 세그먼트·토글 */
.ck-seg { display: inline-flex; flex-wrap: wrap; gap: 2px; padding: 3px; border-radius: 10px; background: var(--bg-3); }
.ck-seg-b { min-height: 32px; min-width: 40px; padding: 0 10px; border: 0; border-radius: 8px; background: transparent; color: var(--ink-2); font: inherit; font-size: .82rem; font-weight: 700; cursor: pointer; }
.ck-seg-b:hover { color: var(--ink); }
.ck-seg-b[aria-pressed="true"] { background: var(--bg-2); color: var(--ink); box-shadow: 0 1px 2px rgba(0,0,0,.12); }
.ck-seg-b.ck-seg-bad[aria-pressed="true"] { color: var(--bad); }
.ck-toggle { display: inline-flex; align-items: center; gap: 6px; min-height: 36px; padding: 0 10px 0 6px; border: 1px solid var(--line); border-radius: 999px; background: var(--bg-2); color: var(--ink-2); font: inherit; font-size: .8rem; font-weight: 700; cursor: pointer; white-space: nowrap; }
.ck-switch { position: relative; width: 28px; height: 16px; border-radius: 999px; background: var(--line-2); transition: background .15s; flex: none; }
.ck-switch::after { content: ''; position: absolute; top: 2px; left: 2px; width: 12px; height: 12px; border-radius: 50%; background: var(--bg-2); transition: transform .15s; }
.ck-toggle[aria-pressed="true"] { color: var(--ink); }
.ck-toggle[aria-pressed="true"] .ck-switch { background: var(--good); }
.ck-toggle[aria-pressed="true"] .ck-switch::after { transform: translateX(12px); }

/* 목록 */
.ck-list { flex: 1 1 auto; min-height: 0; overflow-y: auto; overscroll-behavior: contain; padding: 0 0 16px; outline: none; }
.ck-bucket { padding-bottom: 2px; }
.ck-bucket-h { position: sticky; top: 0; z-index: 2; display: flex; align-items: center; gap: 8px; width: 100%; margin: 0; padding: 10px 16px 6px; border: 0; background: color-mix(in srgb, var(--bg-2) 94%, transparent); backdrop-filter: blur(6px); color: var(--ink-2); font: inherit; font-size: .78rem; font-weight: 800; text-align: left; }
.ck-bucket-h::after { content: ''; flex: 1 1 auto; height: 1px; background: var(--line); }
.ck-bucket-h .ck-count, .ck-count { font-weight: 700; color: var(--ink-3); font-variant-numeric: tabular-nums; }
.ck-bucket-h.ck-bad { color: var(--bad); }
.ck-bucket-h.ck-warn { color: var(--warn); }
.ck-done-h { cursor: pointer; min-height: 40px; }
.ck-done-h:hover { color: var(--ink); }
.ck-caret { width: 1em; display: inline-block; }
.ck-row { position: relative; display: flex; align-items: flex-start; gap: 4px; padding: 4px 16px 6px 8px; cursor: pointer; transition: background .1s; }
@media (hover: hover) { .ck-row:hover { background: color-mix(in srgb, var(--bg-3) 65%, transparent); } }
.ck-row.ck-overdue { box-shadow: inset 3px 0 0 var(--bad); }
.ck-row.ck-sel { background: var(--brand-bg); box-shadow: inset 3px 0 0 var(--brand); }
.ck-cb { flex: none; display: grid; place-items: center; width: 40px; height: 40px; padding: 0; border: 0; border-radius: 10px; background: transparent; cursor: pointer; -webkit-tap-highlight-color: transparent; }
.ck-cb-box { position: relative; display: grid; place-items: center; width: 24px; height: 24px; border: 2px solid var(--line-2); border-radius: 7px; background: var(--bg-2); transition: background .12s, border-color .12s, transform .08s; }
.ck-cb:hover .ck-cb-box { border-color: var(--good); }
.ck-cb:active .ck-cb-box { transform: scale(.9); }
.ck-cb[aria-checked="true"] .ck-cb-box, .ck-th-done.ck-on .ck-cb-box { background: var(--good); border-color: var(--good); }
.ck-cb[aria-checked="true"] .ck-cb-box::after, .ck-th-done.ck-on .ck-cb-box::after { content: ''; width: 6px; height: 12px; margin-top: -2px; border: solid var(--on-good); border-width: 0 2.5px 2.5px 0; transform: rotate(45deg); }
.ck-row.ck-overdue .ck-cb-box { border-color: color-mix(in srgb, var(--bad) 55%, var(--line-2)); }
.ck-row-main { flex: 1 1 auto; min-width: 0; padding-top: 8px; }
.ck-row-title { display: block; color: var(--ink); text-decoration: none; font-size: .95rem; font-weight: 600; line-height: 1.4; border-radius: 4px; }
.ck-row-title:hover { color: var(--ink); text-decoration: underline; text-decoration-color: var(--line-2); }
.ck-done .ck-row-title { color: var(--ink-3); font-weight: 500; text-decoration: line-through; text-decoration-color: var(--ink-3); }
.ck-row-meta { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 6px; margin-top: 4px; font-size: .76rem; color: var(--ink-3); }
.ck-row-meta .chip { font-size: .72rem; line-height: 1.6; }
.ck-meta-n { font-weight: 700; font-variant-numeric: tabular-nums; }
.ck-pchip { border: 0; font: inherit; cursor: pointer; max-width: 100%; overflow: hidden; text-overflow: ellipsis; }
.ck-row-meta .ck-pchip { font-size: .72rem; line-height: 1.6; }
.ck-pchip:hover { background: var(--line); color: var(--ink); }
.ck-snip { margin-top: 3px; font-size: .78rem; color: var(--ink-3); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ck-leaving { animation: ck-leave 1.3s ease-in forwards; }
@keyframes ck-leave { 0%, 55% { opacity: 1; } 100% { opacity: .3; } }
.ck-flash { animation: ck-flash 1.8s ease-out; }
@keyframes ck-flash { 0%, 25% { background: color-mix(in srgb, var(--brand) 20%, transparent); } 100% { background: transparent; } }
.ck-empty { padding: 40px 16px; }
.ck-empty-act { margin-top: 12px; display: flex; gap: 8px; justify-content: center; flex-wrap: wrap; }

/* 최근 활동 */
.ck-act { display: flex; align-items: flex-start; gap: 10px; width: 100%; padding: 7px 16px; border: 0; background: transparent; color: var(--ink); font: inherit; text-align: left; }
.ck-act-link { cursor: pointer; }
@media (hover: hover) { .ck-act-link:hover { background: color-mix(in srgb, var(--bg-3) 65%, transparent); } }
.ck-act-ico { flex: none; display: grid; place-items: center; width: 32px; height: 32px; border-radius: 9px; background: var(--bg-3); font-size: .95rem; }
.ck-act-main { flex: 1 1 auto; min-width: 0; display: flex; flex-direction: column; }
.ck-act-text { font-size: .9rem; line-height: 1.45; }
.ck-act-link .ck-act-text { font-weight: 600; }
.ck-act-time { font-size: .74rem; color: var(--ink-3); }

/* 입력창 */
.ck-composer { flex: none; padding: 10px 12px 12px; border-top: 1px solid var(--line); background: var(--bg-2); }
.ck-comp-row { display: flex; align-items: center; gap: 8px; }
.ck-comp-part { flex: 0 1 auto; width: auto; max-width: 38%; min-height: 44px; font-size: .85rem; }
.ck-comp-input { flex: 1 1 0; min-width: 0; min-height: 44px; }
.ck-comp-btn { flex: none; min-height: 44px; }
.ck-comp-prev { display: none; flex-wrap: wrap; align-items: center; gap: 6px; margin-top: 7px; min-height: 22px; font-size: .76rem; color: var(--ink-3); }
.ck-composer:focus-within .ck-comp-prev, .ck-composer.ck-has-text .ck-comp-prev { display: flex; }
.ck-comp-prev code { font-size: .74rem; }
.ck-prev-to { font-weight: 700; color: var(--ink-2); }
.ck-prev-warn { color: var(--bad); font-weight: 700; }
.ck-shake { animation: ck-shake .3s; }
@keyframes ck-shake { 25% { transform: translateX(-5px); } 75% { transform: translateX(5px); } }

/* 스레드 */
.ck-thread { display: none; flex-direction: column; min-width: 0; min-height: 0; background: var(--bg-2); }
.ck-th-head { flex: none; display: flex; align-items: center; gap: 8px; min-height: 54px; padding: 8px 10px 8px 14px; border-bottom: 1px solid var(--line); background: var(--bg-2); }
.ck-th-back { flex: none; white-space: nowrap; padding: 0 8px; }
.ck-th-part { flex: 0 1 auto; min-width: 0; min-height: 30px; font-size: .8rem; }
.ck-move { flex: 0 1 auto; width: auto; max-width: 170px; min-height: 36px; padding: 4px 8px; font-size: .8rem; }
.ck-th-body { flex: 1 1 auto; min-height: 0; overflow-y: auto; overscroll-behavior: contain; padding: 14px 16px 20px; }
.ck-th-top { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
.ck-th-done { display: inline-flex; align-items: center; gap: 8px; min-height: 40px; padding: 0 14px 0 8px; border: 1px solid var(--line-2); border-radius: 999px; background: var(--bg-2); color: var(--ink); font: inherit; font-size: .88rem; font-weight: 700; cursor: pointer; }
.ck-th-done:hover { border-color: var(--good); }
.ck-th-done .ck-cb-box { width: 22px; height: 22px; }
.ck-th-done.ck-on { background: var(--good-bg); border-color: color-mix(in srgb, var(--good) 40%, var(--line)); color: var(--good); }
.ck-th-title { display: block; width: calc(100% + 16px); margin: 0 -8px; padding: 6px 8px; border: 1px solid transparent; border-radius: 10px; background: transparent; color: var(--ink); font: inherit; font-size: 1.18rem; font-weight: 800; line-height: 1.35; letter-spacing: -.01em; resize: none; overflow: hidden; }
.ck-th-title:hover { border-color: var(--line); }
.ck-th-title:focus { outline: none; border-color: var(--brand); box-shadow: 0 0 0 3px color-mix(in srgb, var(--brand) 18%, transparent); }
.ck-th-isdone .ck-th-title { color: var(--ink-3); text-decoration: line-through; }
.ck-fields { margin-top: 10px; border-top: 1px solid var(--line); }
.ck-field { display: grid; grid-template-columns: 56px minmax(0, 1fr); gap: 8px; align-items: start; padding: 10px 0; border-bottom: 1px solid var(--line); }
.ck-field-l { padding-top: 8px; font-size: .78rem; font-weight: 800; color: var(--ink-3); }
.ck-due-row { display: flex; gap: 8px; align-items: center; }
.ck-due { width: auto; max-width: 100%; min-height: 38px; }
.ck-quicks { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 6px; }
.ck-quick { min-height: 32px; padding: 0 9px; font-size: .78rem; }
.ck-due-info { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; margin-top: 6px; }
.ck-due-move { font-size: .76rem; color: var(--ink-3); font-weight: 600; }
.ck-sec { margin-top: 14px; }
.ck-sec-h { display: flex; align-items: center; gap: 8px; margin-bottom: 6px; font-size: .78rem; font-weight: 800; color: var(--ink-3); }
.ck-addlink { margin-left: auto; min-height: 30px; }
.ck-detail { min-height: 76px; resize: none; font-size: .92rem; }
.ck-detail-prev { margin-top: 6px; padding: 8px 10px; border-radius: 10px; background: var(--bg-3); font-size: .84rem; line-height: 1.5; overflow-wrap: anywhere; }
.ck-prev-lbl { display: block; font-size: .7rem; font-weight: 800; color: var(--ink-3); margin-bottom: 2px; }
.ck-links { display: flex; flex-direction: column; gap: 4px; }
.ck-link { display: flex; align-items: center; gap: 6px; min-height: 32px; padding: 2px 4px 2px 10px; border-radius: 8px; background: var(--bg-3); font-size: .86rem; }
.ck-link a { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 600; }
.ck-x { flex: none; width: 30px; height: 30px; border: 0; border-radius: 8px; background: transparent; color: var(--ink-3); font: inherit; font-size: 1.05rem; line-height: 1; cursor: pointer; }
.ck-x:hover { background: var(--bad-bg); color: var(--bad); }
.ck-none { margin: 0; font-size: .82rem; color: var(--ink-3); }
.ck-guide { margin-top: 8px; }
.ck-guide-link { display: inline-flex; align-items: center; gap: 4px; min-height: 32px; font-size: .86rem; font-weight: 700; }
.ck-thread-sec { margin-top: 20px; }
.ck-thread-h { padding-bottom: 6px; border-bottom: 1px solid var(--line); }
.ck-notes { display: flex; flex-direction: column; }
.ck-note { display: flex; gap: 10px; padding: 10px 6px 10px 0; border-radius: 10px; }
.ck-note + .ck-note { border-top: 1px dashed var(--line); }
.ck-note-ava { flex: none; display: grid; place-items: center; width: 32px; height: 32px; border-radius: 9px; background: var(--kid-bg); font-size: .9rem; }
.ck-note-body { flex: 1 1 auto; min-width: 0; }
.ck-note-meta { display: flex; align-items: center; gap: 8px; min-height: 22px; }
.ck-note-who { font-size: .82rem; font-weight: 800; }
.ck-note-time { font-size: .74rem; color: var(--ink-3); font-variant-numeric: tabular-nums; }
.ck-note-del { margin-left: auto; width: 28px; height: 28px; opacity: .55; }
.ck-note:hover .ck-note-del, .ck-note-del:focus-visible { opacity: 1; }
@media (hover: none) { .ck-note-del { opacity: .8; } }
.ck-note-text { font-size: .92rem; line-height: 1.55; overflow-wrap: anywhere; white-space: normal; }
.ck-notes-empty { padding: 8px 0; }
.ck-stamps { margin: 16px 0 0; font-size: .72rem; color: var(--ink-3); }
.ck-th-danger { margin-top: 10px; }
.ck-th-foot { flex: none; padding: 10px 12px 12px; border-top: 1px solid var(--line); background: var(--bg-2); }
.ck-note-row { display: flex; align-items: flex-end; gap: 8px; }
.ck-note-input { flex: 1 1 auto; min-width: 0; min-height: 44px; max-height: 160px; resize: none; }
.ck-note-send { flex: none; min-height: 44px; }

/* 메뉴·모달 내용 */
.ck-menu { display: flex; flex-direction: column; gap: 6px; }
.ck-menu-row { display: flex; gap: 6px; }
.ck-menu-row .ck-menu-item { flex: 1 1 0; }
.ck-menu-item { display: flex; align-items: center; gap: 10px; min-height: 46px; padding: 0 14px; border: 1px solid var(--line); border-radius: 12px; background: var(--bg-2); color: var(--ink); font: inherit; font-weight: 700; font-size: .92rem; text-align: left; cursor: pointer; }
.ck-menu-item:hover { background: var(--bg-3); }
.ck-menu-item.ck-danger { color: var(--bad); border-color: color-mix(in srgb, var(--bad) 35%, var(--line)); }
.ck-menu-item.ck-danger:hover { background: var(--bad-bg); }
.ck-menu-ico { width: 1.4em; text-align: center; }
.ck-emo-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(42px, 1fr)); gap: 6px; }
.ck-emo { min-height: 42px; border: 1px solid var(--line); border-radius: 10px; background: var(--bg-2); font-size: 1.25rem; cursor: pointer; }
.ck-emo:hover { background: var(--bg-3); }
.ck-emo[aria-pressed="true"] { border-color: var(--brand); background: var(--brand-bg); box-shadow: 0 0 0 2px color-mix(in srgb, var(--brand) 25%, transparent); }
.ck-emo-input { grid-column: span 2; min-height: 42px; text-align: center; font-size: 1.1rem; }
.ck-copy-ta { min-height: 220px; font-size: .85rem; }

@media (prefers-reduced-motion: reduce) {
  .ck *, .ck *::before, .ck *::after { animation: none !important; transition: none !important; }
}

/* ---------- 데스크톱·태블릿: 작업 공간 ---------- */
@media (min-width: 700px) {
  .view[data-view="checklist"] { padding-bottom: 20px; }
  .ck {
    display: grid; grid-template-columns: var(--ck-side) minmax(0, 1fr);
    height: calc(100vh - var(--topbar-h) - 40px);
    height: calc(100dvh - var(--topbar-h) - 40px);
    min-height: 460px;
    background: var(--bg-2); border: 1px solid var(--line); border-radius: var(--radius); box-shadow: var(--shadow); overflow: hidden;
  }
  .ck-backdrop { display: none; }
}
@media (min-width: 700px) and (max-width: 860px) {
  .view[data-view="checklist"] { padding-bottom: calc(var(--bottom-h) + 14px + env(safe-area-inset-bottom)); }
  .ck { height: calc(100vh - var(--topbar-h) - var(--bottom-h) - 28px); height: calc(100dvh - var(--topbar-h) - var(--bottom-h) - 28px - env(safe-area-inset-bottom)); }
}
@media (min-width: 1100px) {
  .ck.ck-open { grid-template-columns: var(--ck-side) minmax(0, 1fr) var(--ck-thread); }
  .ck.ck-open .ck-thread { display: flex; border-left: 1px solid var(--line); }
}
@media (min-width: 1100px) and (max-width: 1279px) { .ck { --ck-side: 224px; } }

/* 태블릿: 스레드는 오른쪽 서랍 */
@media (min-width: 700px) and (max-width: 1099px) {
  .ck { --ck-side: 220px; }
  .ck-thread {
    display: flex; position: fixed; top: 0; right: 0; bottom: 0; z-index: 60;
    width: min(460px, 92vw); border-left: 1px solid var(--line); box-shadow: var(--shadow-lg);
    transform: translateX(104%); visibility: hidden;
    transition: transform .22s ease, visibility 0s linear .22s;
  }
  .ck.ck-open .ck-thread { transform: none; visibility: visible; transition: transform .22s ease; }
  .ck-th-foot { padding-bottom: calc(12px + env(safe-area-inset-bottom)); }
  .ck-backdrop { display: block; position: fixed; inset: 0; z-index: 55; background: rgba(20,18,15,.4); opacity: 0; pointer-events: none; transition: opacity .2s; }
  .ck.ck-open .ck-backdrop { opacity: 1; pointer-events: auto; }
}

/* ---------- 폰: 화면을 쌓아서 ---------- */
@media (max-width: 699px) {
  .view[data-view="checklist"] { padding-bottom: calc(var(--bottom-h) + env(safe-area-inset-bottom)); }
  .ck-phone-only { display: inline-flex !important; }
  .ck { display: block; --ck-screen-h: calc(100vh - var(--topbar-h) - var(--bottom-h) - 14px); }
  @supports (height: 100dvh) { .ck { --ck-screen-h: calc(100dvh - var(--topbar-h) - var(--bottom-h) - 14px - env(safe-area-inset-bottom)); } }
  .ck[data-screen="list"] .ck-main, .ck[data-screen="search"] .ck-main { min-height: var(--ck-screen-h); flex-direction: column; }
  .ck[data-screen="list"] .ck-list { flex: 1 0 auto; }
  .ck[data-screen="thread"] .ck-thread { min-height: var(--ck-screen-h); flex-direction: column; }
  .ck[data-screen="thread"] .ck-th-body { flex: 1 0 auto; }
  .ck[data-screen="channels"] .ck-side { padding-bottom: 20px; }
  .ck-side, .ck-main, .ck-thread, .ck-backdrop { display: none; }
  .ck[data-screen="channels"] .ck-side, .ck[data-screen="search"] .ck-side { display: block; background: transparent; border: 0; }
  .ck[data-screen="list"] .ck-main, .ck[data-screen="search"] .ck-main { display: flex; background: transparent; }
  .ck[data-screen="thread"] .ck-thread { display: flex; background: transparent; }
  .ck[data-screen="search"] .ck-ws, .ck[data-screen="search"] .ck-chans, .ck[data-screen="search"] .ck-side-foot { display: none; }
  .ck[data-screen="search"] .ck-side-head { padding: 0 0 8px; }
  .ck[data-screen="search"] .ck-head { display: none; }
  .ck[data-screen="search"] .ck-sub { padding-top: 4px; }

  .ck-side-head { padding: 0 0 4px; }
  .ck-ws-title { font-size: 1.5rem; }
  .ck-ws-row { margin-bottom: 8px; }
  .ck-ws .progress { height: 8px; }
  .ck-search-input { min-height: 44px; font-size: 1rem; background: var(--bg-2); }
  .ck-search-clear { width: 38px; height: 38px; }
  .ck-chans { overflow: visible; padding: 4px 0 8px; }
  .ck-group { margin-top: 10px; background: var(--bg-2); border: 1px solid var(--line); border-radius: var(--radius); padding: 4px; }
  .ck-group-sp { border-bottom: 1px solid var(--line); padding-bottom: 4px; }
  .ck-group-h { padding: 8px 10px 2px; }
  .ck-chan { min-height: 48px; padding: 6px 10px; font-size: 1rem; border-radius: 12px; }
  .ck-chan + .ck-chan { box-shadow: 0 -1px 0 var(--line); }
  .ck-chan.ck-active { background: transparent; color: var(--ink-2); }
  .ck-chan.ck-active .ck-chan-meta { color: var(--ink-3); opacity: 1; }
  .ck-chan.ck-active .ck-chan-badge { background: var(--bad); color: var(--on-bad); }
  .ck-chan::after { content: '›'; flex: none; color: var(--ink-3); font-size: 1.2rem; margin-left: 2px; }
  .ck-chan-emo { font-size: 1.15rem; }
  .ck-side-foot { padding: 12px 0 0; border: 0; }
  .ck-addpart { min-height: 48px; justify-content: center; }

  .ck-head { position: sticky; top: var(--topbar-h); z-index: 6; margin: -14px -16px 0; padding: 8px 10px 8px 6px; background: color-mix(in srgb, var(--bg) 92%, transparent); backdrop-filter: blur(10px); border-bottom: 1px solid var(--line); }
  .ck-head-top { min-height: 40px; }
  .ck-head-title { font-size: 1.1rem; }
  .ck-back { font-size: 1.3rem; width: 40px; }
  .ck-sub { padding: 10px 0 8px; border-bottom: 0; }
  .ck-head-bar { flex-direction: column; align-items: stretch; }
  .ck-prog { max-width: none; flex-basis: auto; }
  .ck-filters { margin-left: 0; justify-content: space-between; }
  .ck-list { overflow: visible; padding-bottom: 8px; }
  .ck-bucket-h { position: static; padding: 14px 2px 6px; background: transparent; backdrop-filter: none; }
  .ck-row { padding: 6px 4px 8px 0; margin: 0 -4px; border-radius: 12px; }
  .ck-row.ck-overdue { box-shadow: inset 3px 0 0 var(--bad); }
  .ck-row + .ck-row::before { content: ''; position: absolute; top: 0; left: 44px; right: 4px; height: 1px; background: var(--line); }
  .ck-cb { width: 44px; height: 44px; }
  .ck-cb-box { width: 26px; height: 26px; }
  .ck-row-main { padding-top: 9px; }
  .ck-row-title { font-size: 1rem; }
  .ck-act { padding: 8px 2px; }
  .ck-composer { position: sticky; bottom: calc(var(--bottom-h) + env(safe-area-inset-bottom)); z-index: 6; margin: 0 -16px; padding: 8px 12px 10px; background: color-mix(in srgb, var(--bg) 94%, transparent); backdrop-filter: blur(10px); border-top: 1px solid var(--line); }
  .ck-comp-part { flex: 0 1 auto; max-width: 34%; min-height: 44px; padding-left: 6px; padding-right: 2px; font-size: .8rem; }
  .ck-comp-btn { padding: 0 12px; }
  .ck-comp-input { font-size: 1rem; }

  .ck-th-head { position: sticky; top: var(--topbar-h); z-index: 6; margin: -14px -16px 0; padding: 6px 10px 6px 4px; background: color-mix(in srgb, var(--bg) 92%, transparent); backdrop-filter: blur(10px); }
  .ck-th-close { display: none; }
  .ck-move { max-width: 46vw; }
  .ck-th-body { overflow: visible; padding: 14px 0 16px; }
  .ck-th-title { font-size: 1.25rem; }
  .ck-field { grid-template-columns: 1fr; gap: 4px; }
  .ck-field-l { padding-top: 0; }
  .ck-quick { min-height: 36px; padding: 0 11px; }
  .ck-seg-b { min-height: 36px; min-width: 48px; font-size: .88rem; }
  .ck-th-foot { position: sticky; bottom: calc(var(--bottom-h) + env(safe-area-inset-bottom)); z-index: 6; margin: 0 -16px; padding: 8px 12px 10px; background: color-mix(in srgb, var(--bg) 94%, transparent); backdrop-filter: blur(10px); }
  .ck-note-input { font-size: 1rem; }
}
`;

  /* ---------------- 등록 ---------------- */
  MV.view('checklist', {
    title: '체크리스트', short: '체크', icon: '✅', order: 20,
    badge: () => {
      try { return MV.items.list((i) => !i.done && MV.items.status(i) === 'overdue').length; } catch (e) { return 0; }
    },
    render(root, params, ctx) {
      MV.css('ck', CSS);
      try {
        mount(root, params, ctx);
      } catch (e) {
        console.error(e);
        put(root, el('div', { class: 'card tint-bad' }, el('h2', '체크리스트를 여는 중 문제가 생겼어요'), el('p', { class: 'small' }, String(e && e.message || e)),
          el('button', { type: 'button', class: 'btn', onclick: () => MV.rerender() }, '다시 시도')));
      }
    },
  });
})();
