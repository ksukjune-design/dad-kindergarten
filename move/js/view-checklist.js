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
  /* '나'·'아내' 거르기는 둘이 '함께' 하는 일도 보여 줌 (내가 챙길 일 = 내 일 + 함께 할 일) */
  const OWNER_WITH_TOGETHER = { '나': true, '아내': true };
  const OWNER_TITLES = { '': '모든 담당 보기', '나': '나 담당 + 함께 하는 일', '아내': '아내 담당 + 함께 하는 일', '함께': '함께 하는 일만' };
  const EMOJIS = ['📌', '🏠', '📦', '🧹', '🔧', '📝', '💳', '📞', '🚗', '🏫', '🧒', '🪴', '🎁', '🧾', '🛋️', '🔑'];
  const PRI_WORDS = { '': 'high', '!': 'high', '중요': 'high', '높음': 'high', '급함': 'high', '긴급': 'high', '보통': 'mid', '중간': 'mid', '여유': 'low', '낮음': 'low' };
  const OWNER_WORDS = { '나': '나', '내가': '나', '아내': '아내', '와이프': '아내', '함께': '함께', '같이': '함께', '우리': '함께', '둘다': '함께' };
  const WEEK = ['일', '월', '화', '수', '목', '금', '토'];
  const TITLE_MAX = 300;   // 스레드 제목 칸과 같은 한도

  /* 뷰를 떠났다 돌아와도 유지되는 메모리 (저장하지 않음) */
  const mem = {
    listScroll: {},     // 채널 → 목록 스크롤 (데스크톱 열)
    winScroll: {},      // 폰 화면 키 → window.scrollY
    doneOpen: {},       // 채널 → 완료 묶음 펼침 여부
    draft: '',          // 할 일 입력창 초안
    noteDrafts: {},     // 항목 → 메모 초안
    composerPart: '',   // 특수 채널에서 추가할 파트
    lastChannel: '~focus',
    refocusSearch: false, // ✕ 로 검색을 닫은 뒤 다시 그려지면 검색창에 초점
    sideScroll: 0,      // 사이드바 스크롤
    unmountedAt: -1e9,  // 마지막으로 이 뷰를 닫은 시각 (같은 뷰 다시 그리기 판별)
    focusRow: null,     // 다시 그린 뒤 초점을 돌려줄 항목
    listAnchor: {},     // 채널 → 목록 맨 위에 보이던 줄 { id, off } (데스크톱 열)
    winAnchor: {},      // 폰 화면 키 → 맨 위에 보이던 줄 { id, off }
  };

  /* ---------------- 작은 도우미 ---------------- */
  /* MediaQueryList 는 한 번만 만들어 둠 (.matches 는 늘 최신) — 크기를 재지 않고 화면 종류를 앎 */
  const mqCache = {};
  const mq = (q) => mqCache[q] || (mqCache[q] = window.matchMedia ? window.matchMedia(q) : { matches: false, addEventListener() {}, removeEventListener() {} });
  const MQ_PHONE = '(max-width: 699px)';
  const MQ_DESK = '(min-width: 1100px)';
  const MQ_TOUCH = '(pointer: coarse)';   // 손가락이 주 입력 (폰·태블릿)
  const isPhone = () => mq(MQ_PHONE).matches;
  const isDesk = () => mq(MQ_DESK).matches;
  const isTouch = () => mq(MQ_TOUCH).matches;
  /* 메모 입력 안내: 화면 키보드에는 쉬프트가 없어 터치 화면에서는 엔터 = 줄바꿈, 저장은 '보내기' */
  const NOTE_PH_TOUCH = '메모 남기기… (보내기로 저장)';   // 폰 한 줄에 들어가게 짧게
  const NOTE_PH_KEYS = '메모 남기기… (엔터: 저장 · 쉬프트\u2060+\u2060엔터: 줄바꿈)';   // \u2060(보이지 않는 글자): '쉬프트+엔터' 가운데서 줄이 갈리지 않게
  /* 할 일 입력창 예시: 칸 너비에 맞는 것 중 가장 긴 것 (잘린 예시는 오히려 헷갈림) */
  const COMP_PH = ['할 일 추가… 예) 우리은행 방문 ~10/15 !중요 @아내', '할 일 추가… 예) 은행 ~10/15', '할 일 추가…'];
  const MOVE_PH = '📁 파트 옮기기';
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
  /* 이모지 칸에는 글자 하나(그래핌)만: '가나다라…' 같은 긴 글이 제목을 밀어내지 않게 */
  let segmenter = null;
  try { segmenter = window.Intl && Intl.Segmenter ? new Intl.Segmenter('ko', { granularity: 'grapheme' }) : null; } catch (e) { segmenter = null; }
  function firstGrapheme(s) {
    s = String(s == null ? '' : s).trim();
    if (!s) return '';
    if (segmenter) {
      try { const r = segmenter.segment(s)[Symbol.iterator]().next(); if (!r.done) return r.value.segment; } catch (e) { /* 아래로 */ }
    }
    return Array.from(s)[0] || '';
  }
  const emo = (p) => (p && firstGrapheme(p.emoji)) || '📌';
  const partLabel = (p) => (p ? emo(p) + ' ' + (p.name || '이름 없는 파트') : '📌 파트 없음');
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
  /* 같은 종류 토큰이 여러 번이면 마지막 것을 쓰고, 미리보기에서 알려 줌 (r.multi) */
  function parseQuick(raw) {
    const r = { title: '', due: null, priority: null, owner: null, bad: [], multi: [] };
    const seen = { due: 0, priority: 0, owner: 0 };
    const keep = [];
    String(raw || '').split(/\s+/).filter(Boolean).forEach((w) => {
      const head = w.charAt(0); const rest = w.slice(1);
      if (head === '~' || head === '～') {
        if (!rest) { keep.push(w); return; }
        const d = parseDue(rest);
        if (d) { r.due = d; seen.due++; return; }
        r.bad.push(w); keep.push(w); return;
      }
      if (head === '!' || head === '！') {
        const p = PRI_WORDS[rest.replace(/^[!！]+/, '')];   // '!!중요', '!!!' 도 중요로
        if (p) { r.priority = p; seen.priority++; return; }
        keep.push(w); return;
      }
      if ((head === '@' || head === '＠') && OWNER_WORDS[rest]) { r.owner = OWNER_WORDS[rest]; seen.owner++; return; }
      keep.push(w);
    });
    Object.keys(seen).forEach((k) => { if (seen[k] > 1) r.multi.push(k); });
    r.title = keep.join(' ').trim();
    return r;
  }

  /* ---------------- 검색 ---------------- */
  const termsOf = (q) => String(q || '').toLowerCase().split(/\s+/).filter(Boolean);
  /* 백업에서 온 이상한 값(null 메모·링크, 글자가 아닌 제목)도 견딤 */
  const arr = (v) => (Array.isArray(v) ? v : []);
  const notesOf = (it) => arr(it && it.notes).filter((n) => n && typeof n === 'object');
  const linksOf = (it) => arr(it && it.links).filter((l) => l && typeof l === 'object' && l.url);
  const str = (v) => (v == null ? '' : typeof v === 'string' ? v : String(v));
  function haystack(it) {
    return [str(it.title), str(it.detail)].concat(notesOf(it).map((n) => str(n.text)), linksOf(it).map((l) => str(l.label) + ' ' + str(l.url)))
      .filter(Boolean).join('\n').toLowerCase();
  }
  /* 링크로 열어도 되는 주소만 (javascript: 등은 막음) */
  const SAFE_URL = /^(https?:\/\/|tel:|mailto:)/i;
  const safeUrl = (u) => { u = str(u).trim(); return SAFE_URL.test(u) ? u : null; };
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
    const sources = [['📝', str(it.detail)]].concat(notesOf(it).map((n) => ['💬', str(n.text)]));
    for (const [icon, txt] of sources) {
      const s = String(txt || '');
      const low = s.toLowerCase();
      const t = terms.find((x) => low.includes(x));
      if (!t) continue;
      const i = low.indexOf(t);
      const from = Math.max(0, i - 10);   // 앞 글은 조금만: 폰 한 줄에서도 찾은 말이 잘리지 않게
      const cut = (from ? '…' : '') + s.slice(from, i + t.length + 50).replace(/\s+/g, ' ') + (i + t.length + 50 < s.length ? '…' : '');
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
  /* 글 높이에 맞춰 textarea 키우기. 여러 칸을 한꺼번에: 모두 쓰고(auto) → 모두 읽고 → 모두 씀 (레이아웃 계산 1번) */
  function autosizeAll(pairs) {
    const tas = pairs.filter((p) => p && p[0] && p[0].isConnected);
    const prev = tas.map(([ta]) => ta.style.height);
    tas.forEach(([ta]) => { ta.style.height = 'auto'; });
    const hs = tas.map(([ta]) => (ta.offsetHeight || ta.clientHeight ? ta.scrollHeight + (ta.offsetHeight - ta.clientHeight) : -1));
    tas.forEach(([ta, max], i) => {
      const h = hs[i];
      if (h < 0) { ta.style.height = prev[i]; return; }   // 화면에 없음 (숨김) → 그대로
      const lim = max && h > max;
      ta.style.height = (lim ? max : h) + 'px';
      ta.style.overflowY = lim ? 'auto' : 'hidden';
    });
  }
  function autosize(ta, max) { autosizeAll([[ta, max]]); }
  /* 애니메이션 다시 틀기 (offsetWidth 로 강제 레이아웃을 일으키지 않음) */
  function replayAnim(node, cls) {
    if (!node) return;
    if (node.classList.contains(cls) && node.getAnimations) {
      const a = node.getAnimations().find((x) => x.animationName === cls);
      if (a) { a.currentTime = 0; a.play(); return; }
    }
    node.classList.add(cls);
    node.addEventListener('animationend', () => node.classList.remove(cls), { once: true });
  }
  /* 폰(창 전체가 스크롤): node 를 위쪽 고정 머리와 아래쪽 고정 입력창(+하단 메뉴) 사이에 보이게.
     scrollIntoView({block:'nearest'}) 는 sticky 입력창을 모르므로 새 줄·새 메모가 그 뒤에 숨었음. */
  function revealOnPhone(node, footEl, headEl) {
    if (!node || !node.isConnected || !node.getClientRects().length) return;
    const vh = window.innerHeight || document.documentElement.clientHeight;
    let bottom = vh;
    if (footEl && footEl.isConnected && footEl.getClientRects().length) {
      const cs = getComputedStyle(footEl);
      const off = cs.position === 'sticky' || cs.position === 'fixed' ? (parseFloat(cs.bottom) || 0) : 0;
      bottom = Math.min(vh - off - footEl.offsetHeight, footEl.getBoundingClientRect().top);
    }
    let top = 0;
    if (headEl && headEl.isConnected && headEl.getClientRects().length) top = Math.max(0, headEl.getBoundingClientRect().bottom);
    top += 8; bottom -= 8;
    const r = node.getBoundingClientRect();
    let dy = 0;
    if (r.height > bottom - top || r.top < top) dy = r.top - top;
    else if (r.bottom > bottom) dy = r.bottom - bottom;
    if (Math.abs(dy) >= 1) window.scrollBy(0, Math.round(dy));
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
  /** 화면 오류 카드: 쉬운 한국어 안내 + 접힌 '자세히'(오류 원문은 여기와 콘솔에만). o: {small, retry} */
  function errCard(title, e, o) {
    o = o || {};
    if (MV.ui.errorBox) return MV.ui.errorBox(title, e, o);
    return el('div', { class: 'card tint-bad', role: 'alert' }, el(o.small ? 'p' : 'h2', title),
      el('p', { class: 'small' }, '저장된 기록은 그대로예요. 새로고침하거나 다른 화면에 갔다가 다시 와 보세요.'),
      o.retry ? el('button', { type: 'button', class: 'btn', onclick: o.retry }, '다시 시도') : null);
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
    let v = firstGrapheme(value) || '📌';
    const custom = el('input', { class: 'input ck-emo-input', value: v, maxlength: '16', 'aria-label': '이모지 직접 입력 (한 글자)', placeholder: '직접', title: '이모지나 글자 하나' });
    const btns = EMOJIS.map((e) => el('button', {
      type: 'button', class: 'ck-emo', 'aria-pressed': String(e === v), 'aria-label': '아이콘 ' + e,
      onclick: () => { v = e; custom.value = e; sync(); },
    }, e));
    function sync() { btns.forEach((b) => b.setAttribute('aria-pressed', String(b.textContent === v))); }
    custom.addEventListener('input', () => { v = firstGrapheme(custom.value); sync(); });
    custom.addEventListener('blur', () => { if (custom.value.trim() && custom.value !== v) custom.value = v; });
    return { node: el('div', { class: 'ck-emo-grid' }, btns, custom), get: () => (firstGrapheme(v) || '📌') };
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
    const searchBack = el('button', { type: 'button', class: 'btn btn-ghost btn-icon ck-search-back', 'aria-label': '검색 닫고 파트 목록으로' }, '←');
    const chans = el('nav', { class: 'ck-chans', 'aria-label': '파트(채널) 목록' });
    const side = el('aside', { class: 'ck-side' },
      el('div', { class: 'ck-side-head' }, sideTop, el('div', { class: 'ck-search-row' }, searchBack, searchBox)),
      chans,
      el('div', { class: 'ck-side-foot' },
        el('button', { type: 'button', class: 'ck-addpart', onclick: () => addPart() }, el('span', { 'aria-hidden': 'true' }, '＋'), ' 파트 추가'),
        // 키보드 단축키 (마우스가 있는 컴퓨터에서만 보임). 한글 자판 글쇠 이름으로: ㅜ=새 할 일, ㅓ·ㅏ=아래·위
        el('p', { class: 'ck-keys' }, el('span', { class: 'ck-keys-h' }, '단축키'), ' ',
          el('kbd', '/'), ' 검색 · ', el('kbd', 'ㅜ'), ' 새 할 일', el('br'),
          el('kbd', 'ㅓ'), ' ', el('kbd', 'ㅏ'), ' 아래·위 · ', el('kbd', '이스케이프'), ' 닫기')));

    const head = el('header', { class: 'ck-head' });
    const sub = el('div', { class: 'ck-sub' });
    const list = el('div', { class: 'ck-list', tabindex: '-1' });

    const compPart = el('select', { class: 'select ck-comp-part', 'aria-label': '추가할 파트' });
    const compPartWrap = el('label', { class: 'ck-comp-pw' }, el('span', { class: 'ck-comp-pl', 'aria-hidden': 'true' }, '추가할 파트'), compPart);
    const compInput = el('input', {
      class: 'input ck-comp-input', placeholder: isPhone() ? COMP_PH[1] : COMP_PH[0],   // 칸 너비에 맞게 fitCompPh 가 고침
      'aria-label': '할 일 추가', autocomplete: 'off', enterkeyhint: 'done', maxlength: String(TITLE_MAX + 60),
    });
    const compBtn = el('button', { type: 'button', class: 'btn btn-primary ck-comp-btn', 'aria-label': '할 일 추가' }, '추가');
    const compNote = el('div', { class: 'ck-comp-note', role: 'status', hidden: true });
    const compPrev = el('div', { class: 'ck-comp-prev', 'aria-live': 'polite' });
    const composer = el('div', { class: 'ck-composer' }, compNote, el('div', { class: 'ck-comp-row' }, compPartWrap, compInput, compBtn), compPrev);
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
    const listKey = () => effCh() + (effCh() === '~search' ? ':' + cur.q : '');

    /* ---------- 다음 프레임에 한꺼번에 ----------
       스크롤 쓰기·크기 재기처럼 레이아웃이 필요한 일은 그리는 도중이 아니라 다음 프레임 직전에 모아서 함
       → DOM 을 다 바꾼 뒤 레이아웃을 딱 한 번만 계산 (그리는 도중에 읽으면 줄 220개를 한 번 더 계산했음) */
    let frameQ = null;
    function inFrame(fn) {
      if (!frameQ) {
        frameQ = [];
        requestAnimationFrame(() => {
          const q = frameQ; frameQ = null;
          if (!alive) return;
          q.forEach((f) => { try { f(); } catch (e) { console.error(e); } });
        });
      }
      frameQ.push(fn);
    }

    /* ---------- 스크롤 저장·복원 ----------
       줄은 content-visibility:auto (화면 밖 줄은 그리지 않음) → 화면 밖 줄 높이는 어림값이라 픽셀만 되살리면
       몇 줄 어긋날 수 있음 → '맨 위에 보이던 줄'(기준 줄)과 그 위치를 함께 저장해 그 줄을 같은 자리에 둠.
       저장은 화면을 바꾸기 전에만 (레이아웃이 이미 깨끗해 읽기가 쌈) */
    function viewTop(phone) {
      if (!phone) return list.getBoundingClientRect().top;
      return head.getClientRects().length ? Math.max(0, head.getBoundingClientRect().bottom) : 0;   // 폰: 위에 붙는 머리 아래
    }
    function anchorRow(phone) {
      const rows = list.querySelectorAll('.ck-row[data-id]');
      if (!rows.length || !list.getClientRects().length) return null;
      const top = viewTop(phone);
      let lo = 0; let hi = rows.length - 1; let ans = -1;   // 아래쪽 끝이 보이는 첫 줄 (이진 탐색)
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if (rows[mid].getBoundingClientRect().bottom > top + 1) { ans = mid; hi = mid - 1; } else lo = mid + 1;
      }
      if (ans < 0) return null;
      const r = rows[ans].getBoundingClientRect();
      return r.height ? { id: rows[ans].dataset.id, off: r.top - top } : null;
    }
    function saveScroll(sKey, lKey) {
      try {
        if (isPhone()) {
          mem.winScroll[sKey] = window.scrollY;
          mem.winAnchor[sKey] = /^(list|search)/.test(sKey) ? anchorRow(true) : null;
        } else {
          mem.listScroll[lKey] = list.scrollTop;
          mem.listAnchor[lKey] = anchorRow(false);
        }
      } catch (e) { /* 무시 */ }
    }
    /* 기준 줄을 저장 때 자리로 돌리려면 얼마나 더 내려야 하는지 (없으면 null → 픽셀로) */
    function anchorDelta(a, phone) {
      if (!a) return null;
      const row = list.querySelector('.ck-row[data-id="' + cssEsc(a.id) + '"]');
      if (!row || !row.getClientRects().length) return null;
      return row.getBoundingClientRect().top - viewTop(phone) - a.off;
    }
    /* 기준 줄 근처 줄이 처음 그려지며 어림값과 실제 높이가 다르면 기준 줄이 조금 밀림 → 다음 프레임에 한 번 더 맞춤 */
    function recheckAnchor(a, phone, stillSame) {
      if (!a) return;
      requestAnimationFrame(() => {
        if (!alive || !stillSame()) return;
        const d = anchorDelta(a, phone);
        if (d == null || Math.abs(d) < 1) return;
        if (phone) window.scrollTo(0, Math.max(0, window.scrollY + d)); else list.scrollTop += d;
      });
    }
    function restoreListScroll(key) {   // 데스크톱·태블릿: 목록 칸
      const a = mem.listAnchor[key];
      const d = anchorDelta(a, false);
      const cur0 = list.scrollTop;
      const y = d != null ? cur0 + d : (mem.listScroll[key] || 0);
      if (Math.abs(cur0 - y) >= 1) list.scrollTop = y;
      if (d != null) recheckAnchor(a, false, () => listKey() === key && !isPhone());
    }
    function restoreWinScroll(k, y) {   // 폰: 창 전체
      const a = y ? mem.winAnchor[k] : null;
      const d = anchorDelta(a, true);
      window.scrollTo(0, Math.max(0, d != null ? window.scrollY + d : y));
      if (d != null) recheckAnchor(a, true, () => screenKey() === k && isPhone());
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
    let backAt = -1e9;   // history.back() 을 부른 시각 (뒤로 두 번 가지 않게)
    function goBackTo(target) {
      const st = history.state;
      if (st && st.ckPrev === target) {
        if (cur.itemId && !isPhone()) mem.focusRow = cur.itemId;
        backAt = performance.now();
        history.back();   // 앱 셸이 다시 그림 → mem 으로 스크롤·초점 복원
      } else nav(target, { replace: true, how: 'history' });
    }

    function applyRoute(params, how) {
      const inPlace = how === 'init' && performance.now() - mem.unmountedAt < 120;   // 뒤로·앞으로로 같은 뷰를 다시 그림
      const prevKey = screenKey();
      const prevEff = effCh(); const prevQ = cur.q;
      if (how !== 'init') saveScroll(prevKey, listKey());   // 아직 아무것도 바꾸기 전 (레이아웃이 깨끗해 읽기가 쌈)

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
        renderList();
        updateComposer();
      } else markSelected();

      if (itemId !== T.id) {
        flushThread();
        if (itemId) buildThread(MV.items.get(itemId)); else clearThread();
      }
      wrap.classList.toggle('ck-open', !!itemId);
      syncDrawer();
      // 목록 스크롤은 다음 프레임 직전에 되살림: 3열(스레드 열림)·2열 배치, 좁은 입력창(컨테이너 쿼리)까지
      // 모두 정해진 한 번의 레이아웃에서 → 그리는 도중에 레이아웃을 강제로 계산하지 않음 (전체 220개도 빠르게)
      if ((chChanged || how === 'init') && !isPhone()) {
        const key = listKey();
        if (how !== 'init' || mem.listScroll[key] || mem.listAnchor[key]) {
          inFrame(() => { if (listKey() === key && !isPhone()) restoreListScroll(key); });
        }
      }
      if (chChanged) hideCompNote();

      if (how === 'init') {
        const sy = mem.sideScroll || 0;
        if (sy > 0) inFrame(() => { chans.scrollTop = sy; });
        if (inPlace && isPhone()) {
          const k = screenKey();
          const y = k.indexOf('thread:') === 0 ? 0 : (mem.winScroll[k] || 0);
          inFrame(() => { if (screenKey() === k) restoreWinScroll(k, y); });   // 셸의 scrollTo 다음에
        }
        if (inPlace && mem.focusRow && !isPhone()) {
          const a = list.querySelector('.ck-row[data-id="' + cssEsc(mem.focusRow) + '"] .ck-row-title');
          if (a) a.focus({ preventScroll: true });
        }
        mem.focusRow = null;
        if (inPlace && mem.refocusSearch) searchInput.focus({ preventScroll: true });
        mem.refocusSearch = false;
      } else if (isPhone()) {
        const k = screenKey();
        if (k !== prevKey || how === 'history') {
          const y = how === 'history' && mem.winScroll[k] != null ? mem.winScroll[k] : 0;
          if (!(prevKey === 'channels' && k === 'search')) {
            if (!y) window.scrollTo(0, 0);   // 맨 위로는 레이아웃 계산 없이 바로 됨
            else inFrame(() => { if (screenKey() === k) restoreWinScroll(k, y); });
          }
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

    /* 태블릿 서랍(700–1099px)은 모달처럼: 뒤쪽은 inert, Tab 은 서랍 안에서만 돎 */
    const drawerMode = () => !isPhone() && !isDesk();
    function syncDrawer() {
      const open = drawerMode() && !!cur.itemId;
      if (open) { thread.setAttribute('role', 'dialog'); thread.setAttribute('aria-modal', 'true'); }
      else { thread.removeAttribute('role'); thread.removeAttribute('aria-modal'); }
      side.inert = open; main.inert = open;
    }
    function trapTab(e) {
      const f = MV.$$('a[href], button, input, select, textarea, [tabindex]', thread)
        .filter((n) => !n.disabled && n.tabIndex >= 0 && n.getClientRects().length > 0);
      if (!f.length) return;
      const first = f[0]; const last = f[f.length - 1]; const a = document.activeElement;
      if (!thread.contains(a)) { e.preventDefault(); (e.shiftKey ? last : first).focus(); }
      else if (e.shiftKey && a === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && a === last) { e.preventDefault(); first.focus(); }
    }

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
    /* 내용 서명이 같으면 DOM 을 건드리지 않음 → 누르는 도중(mousedown~click)에 노드가 바뀌어 클릭이 사라지는 일을 막음 */
    let sideTopSig = null; let chansSig = null;
    function renderSidebar() {
      const c = computeCounts();
      const active = cur.ch === '~search' ? null : (cur.ch || (isPhone() ? null : '~focus'));
      const dd = D.dday(D.moveDate());
      const topSig = [c.done, c.total, c.overdue, dd.n, dd.label, D.moveDate()].join('|');
      if (topSig !== sideTopSig) {
        sideTopSig = topSig;
        put(sideTop,
          el('div', { class: 'ck-ws-row' },
            el('h1', { class: 'ck-ws-title' }, '체크리스트'),
            el('span', { class: 'ck-ws-sub' }, c.done + '/' + c.total + ' 완료')),
          MV.ui.progress(c.total ? c.done / c.total : 0),
          el('p', { class: 'ck-ws-note' },
            '이사 ' + (dd.n === 0 ? '오늘' : dd.label) + ' · ' + D.fmt(D.moveDate()),
            c.overdue ? el('span', { class: 'ck-ws-over' }, ' · 지연 ' + c.overdue) : null));
      }

      const groups = []; const gmap = new Map();
      MV.parts.list().forEach((p) => {
        const g = p.group || '기타';
        if (!gmap.has(g)) { gmap.set(g, []); groups.push(g); }
        gmap.get(g).push(p);
      });
      const stOf = (p) => c.byPart[p.id] || { total: 0, done: 0, overdue: 0 };
      const sig = JSON.stringify([active, SPECIALS.map((x) => c.sp[x.id] || 0), c.focusOver,
        groups.map((g) => [g, gmap.get(g).map((p) => { const st = stOf(p); return [p.id, emo(p), p.name || '', p.desc || '', st.done, st.total, st.overdue]; })])]);
      if (sig === chansSig) return;
      chansSig = sig;
      const fk = focusKeyIn(side);
      const nodes = [];
      nodes.push(el('div', { class: 'ck-group ck-group-sp' }, SPECIALS.map((x) => chanRow(
        x.id, x.emoji, x.name,
        x.id === '~activity' ? '' : String(c.sp[x.id] || 0),
        x.id === '~focus' ? c.focusOver : 0,
        active === x.id, x.desc))));
      groups.forEach((g) => {
        nodes.push(el('div', { class: 'ck-group' },
          el('h2', { class: 'ck-group-h' }, g),
          gmap.get(g).map((p) => {
            const st = stOf(p);
            return chanRow(p.id, emo(p), p.name || '이름 없는 파트', st.done + '/' + st.total, st.overdue, active === p.id, p.desc);
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
      if (p) return { emoji: emo(p), name: p.name || '이름 없는 파트', desc: p.desc || '', part: p };
      return { emoji: '❓', name: '찾을 수 없는 파트', desc: '삭제되었거나 주소가 잘못되었어요.', missing: true };
    }
    let headSig = null;
    function renderHeader() {
      const ch = effCh();
      const info = channelInfo(ch);
      const u = ui();
      // 요약 숫자 먼저 계산 → 서명이 같으면 그대로 둠
      let sum = null;
      if (info.part) {
        const st = MV.parts.stats(info.part.id);
        sum = ['part', st.pct, st.done, st.total, st.overdue];
      } else if (ch === '~focus' || ch === '~week' || ch === '~all') {
        // 목록과 같은 기준(방금 체크해 잠깐 남아 있는 줄 포함) → 머리 숫자와 묶음 숫자가 어긋나지 않게
        const its = listItemsFor(ch);
        const st = (it) => (it.done ? openStatusOf(it) : statusOf(it));
        const n = (x) => its.filter((it) => st(it) === x).length;
        sum = ['sp', n('overdue'), n('today'), its.length];
      } else if (ch === '~done') {
        sum = ['done', MV.items.list((it) => it.done && ownerMatch(it, u.owner)).length];
      } else if (ch === '~search' && cur.q) {
        sum = ['search', listItemsFor('~search').length];
      } else if (ch === '~activity') {
        sum = ['act', (MV.store.get().activity || []).length];
      }
      const sig = JSON.stringify([ch, cur.q, info.emoji, info.name, info.desc, info.part ? (info.part.guide || '') : '', !!info.missing, u.owner || '', !!u.hideDone, sum]);
      if (sig === headSig) return;
      headSig = sig;

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
      if (sum && sum[0] === 'part') {
        summary = el('div', { class: 'ck-prog' }, MV.ui.progress(sum[1]), el('span', { class: 'ck-prog-txt' }, sum[2] + '/' + sum[3] + ' 완료'),
          sum[4] ? el('span', { class: 'chip bad' }, '지연 ' + sum[4]) : null);
      } else if (sum && sum[0] === 'sp') {
        summary = el('div', { class: 'ck-prog ck-prog-sp' },
          sum[1] ? el('span', { class: 'chip bad' }, '지연 ' + sum[1]) : null,
          sum[2] ? el('span', { class: 'chip warn' }, '오늘 ' + sum[2]) : null,
          el('span', { class: 'ck-prog-txt' }, '모두 ' + sum[3] + '개'));
      } else if (sum && sum[0] === 'done') {
        summary = el('div', { class: 'ck-prog ck-prog-sp' }, el('span', { class: 'ck-prog-txt' }, '완료 ' + sum[1] + '개'));
      } else if (sum && sum[0] === 'search') {
        summary = el('div', { class: 'ck-prog ck-prog-sp' }, el('span', { class: 'ck-prog-txt' }, '결과 ' + sum[1] + '개'));
      } else if (sum && sum[0] === 'act') {
        summary = el('div', { class: 'ck-prog ck-prog-sp' }, el('span', { class: 'ck-prog-txt' }, '기록 ' + sum[1] + '개 (최근 300개까지)'));
      }
      let filters = null;
      if (ch !== '~activity' && !info.missing && !(ch === '~search' && !cur.q)) {
        const showHide = !!info.part || ch === '~search';
        const ownSeg = seg(OWNER_FILTERS, u.owner || '', (v) => setUI({ owner: v }), '담당자로 거르기', 'own:');
        MV.$$('.ck-seg-b', ownSeg).forEach((b) => { const t = OWNER_TITLES[b.dataset.v]; if (t) b.title = t; });
        filters = el('div', { class: 'ck-filters' },
          el('div', { class: 'ck-own' }, ownSeg,
            OWNER_WITH_TOGETHER[u.owner] ? el('span', { class: 'ck-own-note', title: OWNER_TITLES[u.owner] }, '+함께 포함') : null),
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
        lines.push(info.emoji + ' ' + info.name + ' — 남은 할 일 ' + open.length + '개' + (u.owner ? ' (' + u.owner + (OWNER_WITH_TOGETHER[u.owner] ? ' + 함께' : '') + ')' : ''));
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
      const nn = notesOf(it).length;
      if (nn) meta.push(el('span', { class: 'ck-meta-n', title: '메모 ' + nn + '개' }, '💬 ' + nn));
      if (it.guide) meta.push(el('span', { class: 'ck-meta-n', title: '관련 가이드가 있어요' }, '📖'));
      if (opts.showPart) {
        const p = MV.parts.get(it.partId);
        meta.push(el('button', {
          type: 'button', class: 'ck-rchip', title: (p ? p.name : '파트 없음') + ' 채널로',
          onclick: (e) => { e.stopPropagation(); const x = MV.items.get(it.id); const q = x && MV.parts.get(x.partId); if (q) goChannel(q.id); },
        }, el('span', { class: 'chip ck-pchip-t' }, partLabel(p))));
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
        it.priority || '', it.owner || '', notesOf(it).length, it.guide ? 1 : 0, it.partId,
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
      try { blocks = buildList(ch); } catch (e) { console.error(e); blocks = [{ node: errCard('목록을 그리다 문제가 생겼어요', e, { small: true }) }]; }
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
          replayAnim(row, 'ck-flash');
          inFrame(() => {   // 보이게 스크롤은 다음 프레임에 (그리는 도중에 레이아웃을 강제로 계산하지 않게)
            if (!row.isConnected) return;
            if (isPhone()) revealOnPhone(row, composer, head);   // 아래 고정 입력창 뒤에 숨지 않게
            else row.scrollIntoView({ block: 'nearest' });
          });
        } else showCompNote(pf);   // 지금 목록에 안 보이는 곳에 추가됨 → 입력창 위에 알림 (토스트는 입력창을 가림)
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
        lingering.set(id, setTimeout(() => { lingering.delete(id); if (alive) { rowCache.delete(id); scheduleRefresh(); } }, 1300));
      }
      MV.items.toggle(id);
      if (willDone) toastDone(id);
      else {
        if (doneBatch) doneBatch.ids = doneBatch.ids.filter((x) => x !== id);
        MV.ui.toast('다시 열었어요');
      }
    }
    /* 연달아 체크하면 토스트를 하나로 합침 ('3개 완료했어요 · 모두 되돌리기') → 폰에서 목록을 덮지 않게 */
    let doneBatch = null;
    function undoDone(id) {
      const x = MV.items.get(id);
      if (!x || !x.done) return;
      if (lingering.has(id)) { clearTimeout(lingering.get(id)); lingering.delete(id); }
      MV.items.toggle(id);
    }
    function toastDone(id) {
      if (doneBatch && doneBatch.toast && doneBatch.toast.isConnected) {
        doneBatch.toast.remove();
        if (!doneBatch.ids.includes(id)) doneBatch.ids.push(id);
      } else doneBatch = { ids: [id], toast: null };
      const batch = doneBatch;
      const n = batch.ids.length;
      batch.toast = MV.ui.toast(n > 1 ? n + '개 완료했어요' : '완료했어요', {
        action: { label: n > 1 ? '모두 되돌리기' : '되돌리기', onClick: () => { const ids = batch.ids.slice(); if (doneBatch === batch) doneBatch = null; ids.forEach(undoDone); } },
      });
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
      compPartWrap.hidden = !sp;
      if (!sp) hideCompNote();
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
      if (p.multi.length) {
        const nm = { due: '날짜', priority: '중요도', owner: '담당' };
        chips.push(el('span', { class: 'chip warn', title: '같은 종류를 두 번 이상 적으면 마지막 것만 저장돼요' }, '여러 번 적은 ' + p.multi.map((k) => nm[k]).join('·') + ' → 마지막 것으로'));
      }
      if (isSpecial(effCh())) {
        const pt = MV.parts.get(compPart.value);
        if (pt) chips.push(el('span', { class: 'ck-prev-to' }, '→ ' + partLabel(pt)));
      }
      if (!p.title) chips.push(el('span', { class: 'ck-prev-warn' }, '할 일 내용을 적어 주세요'));
      else if (p.title.length > TITLE_MAX) chips.push(el('span', { class: 'ck-prev-warn' }, '제목은 ' + TITLE_MAX + '자까지만 저장돼요 (자세한 건 설명에)'));
      put(compPrev, ...chips);
    }
    let compNoteTimer = null;
    function hideCompNote() {
      clearTimeout(compNoteTimer); compNoteTimer = null;
      if (!compNote.hidden) { compNote.hidden = true; put(compNote); }
    }
    function showCompNote(pf) {
      const p = MV.parts.get(pf.partId);
      const t = String(pf.title || '');
      put(compNote,
        el('span', { class: 'ck-comp-note-ico', 'aria-hidden': 'true' }, '✓'),
        el('span', { class: 'ck-comp-note-txt' }, '“' + (t.length > 40 ? t.slice(0, 38) + '…' : t) + '” → ' + partLabel(p) + '에 추가했어요'),
        el('button', { type: 'button', class: 'btn btn-sm ck-comp-note-go', onclick: () => { hideCompNote(); goChannel(pf.partId, pf.id); } }, '보기'),
        el('button', { type: 'button', class: 'ck-x ck-comp-note-x', 'aria-label': '알림 닫기', onclick: () => hideCompNote() }, '×'));
      compNote.hidden = false;
      clearTimeout(compNoteTimer);
      compNoteTimer = setTimeout(hideCompNote, 7000);
    }
    ctx.onCleanup(() => clearTimeout(compNoteTimer));
    function addFromComposer() {
      const raw = compInput.value.trim();
      if (!raw) { compInput.focus(); return; }
      const p = parseQuick(raw);
      if (!p.title) {
        replayAnim(compInput, 'ck-shake');
        MV.ui.toast('할 일 내용을 적어 주세요');
        return;
      }
      const ch = effCh();
      const partId = isSpecial(ch) ? compPart.value : ch;
      if (!partId || !MV.parts.get(partId)) { MV.ui.toast('추가할 파트를 먼저 만들어 주세요'); return; }
      const owner = p.owner != null ? p.owner : (ui().owner || '');
      compInput.value = ''; mem.draft = '';
      hideCompNote();
      const it = MV.items.add({ partId, title: p.title.slice(0, TITLE_MAX).trim(), due: p.due || null, priority: p.priority || 'mid', owner });
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
      } else if (cur.ch === '~search' && cur.q) {
        // 글자를 다 지운 것뿐 → 빈 검색 화면에 머묾 (주소만 바꿔 다시 그리지 않음 → 초점·입력 유지).
        // 검색을 끝내려면 Esc · ✕ · ← 또는 채널을 누르면 돼요.
        nav(hashFor('~search'), { replace: true });
      }
    }, 250);
    function exitSearch(refocus) {
      if (performance.now() - backAt < 1500) return;   // 이미 뒤로 가는 중 (두 번 뒤로 가지 않게)
      const target = isPhone() ? '#/checklist' : hashFor(mem.lastChannel && (MV.parts.get(mem.lastChannel) || SPECIAL_MAP[mem.lastChannel]) ? mem.lastChannel : '~focus');
      mem.refocusSearch = !!refocus;
      goBackTo(target);
      if (!(performance.now() - backAt < 50)) { mem.refocusSearch = false; if (refocus) searchInput.focus(); }   // 제자리 이동(replace)이면 지금 바로
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
    searchBack.addEventListener('click', () => {
      searchInput.value = ''; searchClear.hidden = true;
      runSearch.flush();
      if (cur.ch === '~search') exitSearch();
      searchInput.blur();
    });
    searchClear.addEventListener('click', () => {
      searchInput.value = ''; searchClear.hidden = true;
      runSearch.flush();
      if (cur.ch === '~search') exitSearch(!isPhone());
      else if (!isPhone()) searchInput.focus();
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

    function commitTitle(soft) {
      const it = curItem(); const f = T.f;
      if (!it || !f.title) return;
      const v = f.title.value.replace(/\s+/g, ' ').trim();
      if (!v) { if (!soft) { f.title.value = it.title; autosize(f.title); } return; }
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
    const saveDueSoon = MV.debounce(() => { if (alive) commitDue(false); }, 1200);
    /* soft: 앱 전환(visibilitychange) 때처럼 계속 편집할 수 있는 경우 → 저장만 하고 칸 내용은 되돌리지 않음 */
    function flushThread(soft) {
      if (!T.id) return;
      saveDetailSoon.flush();
      saveDueSoon.flush();
      commitTitle(soft);
      commitDetail(true);
      if (T.f.due && T.f.due._dirty && !soft) commitDue(true);
      if (T.f.noteInput) mem.noteDrafts[T.id] = T.f.noteInput.value;
    }

    /* 날짜 칸: 키보드로 칠 때는 칸마다 change 가 와서 0002-10-14 → 0020-… → 2027-10-14 처럼 중간값이 저장됐음.
       → 연도가 2000~2100 인 완성된 날짜만 받고, 키보드 입력은 잠시 멈추거나 칸을 떠날 때(Enter·blur) 한 번만 저장. */
    const dueOf = (it) => (it && D.valid(it.due) ? D.str(D.parse(it.due)) : '');
    function saneDate(v) {
      const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(v || ''));
      return !!m && +m[1] >= 2000 && +m[1] <= 2100 && D.valid(v);
    }
    function commitDue(final) {
      const it = curItem(); const inp = T.f.due;
      if (!it || !inp) return;
      const v = inp.value;
      const partial = !v && inp.validity && inp.validity.badInput;   // 일부 칸만 채운 상태
      if (v ? saneDate(v) : !partial) { inp._dirty = false; setDue(v || null); return; }
      if (final) {   // 덜 쓴 날짜·말이 안 되는 연도 → 저장된 값으로 되돌림
        inp._dirty = false;
        inp.value = dueOf(it);
        if (v || partial) MV.ui.toast('날짜를 끝까지 입력하지 않아 원래 마감으로 두었어요');
      }
    }
    function fmtDueLog(v) {
      const d = D.parse(v);
      if (!d) return '없음';
      return (d.getFullYear() !== D.parse(D.today()).getFullYear() ? d.getFullYear() + '년 ' : '') + D.fmt(v);
    }
    function setDue(v) {
      const it = curItem();
      if (!it) return;
      const nv = v || null;
      if ((it.due || null) === nv) { syncThread(); return; }
      MV.items.update(it.id, { due: nv }, '📅 마감 변경: ' + it.title + ' → ' + fmtDueLog(nv));
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
      const url = el('input', { class: 'input', type: 'url', placeholder: '인터넷 주소를 붙여 넣으세요', inputmode: 'url' });
      const hint = el('small', { class: 'hint ck-link-hint', role: 'alert', hidden: true });
      url.addEventListener('input', () => { url.removeAttribute('aria-invalid'); hint.hidden = true; });
      const label = el('input', { class: 'input', placeholder: '예) 견적서, 제품 페이지 (비워도 돼요)' });
      const id = it.id;
      const save = () => {
        let u = url.value.trim();
        const bad = (msg) => { url.focus(); url.setAttribute('aria-invalid', 'true'); hint.textContent = msg; hint.hidden = false; return false; };
        if (!u) return bad('주소를 입력해 주세요.');
        if (/^www\./i.test(u) || !/^[a-z][a-z0-9+.-]*:/i.test(u) || /^[^:/]+\.[^:/]+:\d+/.test(u)) u = 'https://' + u.replace(/^\/+/, '');
        if (!safeUrl(u)) return bad('인터넷 주소나 전화·메일 링크만 넣을 수 있어요.');
        const x = MV.items.get(id);
        if (!x) return true;
        const links = arr(x.links).concat([{ label: label.value.trim() || u.replace(/^https?:\/\//, '').slice(0, 40), url: u }]);
        MV.items.update(id, { links }, '🔗 링크 추가: ' + x.title);
        return true;
      };
      let m = null;
      [url, label].forEach((inp) => inp.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.isComposing && e.keyCode !== 229) { e.preventDefault(); if (save() && m) m.close(); }
      }));
      m = MV.ui.modal({
        title: '링크 추가',
        body: el('div', { class: 'stack' }, el('label', { class: 'field' }, el('span', '주소 (URL)'), url, hint), el('label', { class: 'field' }, el('span', '이름'), label)),
        actions: [{ label: '취소', kind: 'ghost' }, { label: '추가', kind: 'primary', onClick: () => save() }],
      });
    }
    function removeLink(idx) {
      const it = curItem();
      if (!it) return;
      const links = arr(it.links).slice();
      const [gone] = links.splice(idx, 1);
      const id = it.id;
      MV.items.update(id, { links });
      MV.ui.toast('링크를 지웠어요', { action: { label: '되돌리기', onClick: () => {
        const x = MV.items.get(id); if (!x) return;
        const l2 = arr(x.links).slice(); l2.splice(Math.min(idx, l2.length), 0, gone);
        MV.items.update(id, { links: l2 });
      } } });
    }
    function deleteItem() {
      const it = curItem();
      if (!it) return;
      const nn = notesOf(it).length;
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
      f.close = el('button', { type: 'button', class: 'btn btn-ghost btn-icon ck-th-close', 'aria-label': '상세 닫기', title: '닫기 (이스케이프 키)', onclick: () => closeThread() }, '✕');
      const headEl = f.head = el('div', { class: 'ck-th-head' }, f.back, f.partChip, el('span', { class: 'ck-spacer' }), f.moveSel, f.close);

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
      let dueKeyAt = -1e9;
      f.due.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); saveDueSoon.flush(); if (f.due._dirty) commitDue(true); return; }
        if (e.key !== 'Tab' && e.key !== 'Escape') dueKeyAt = performance.now();
      });
      const onDueEdit = () => {
        if (T.id !== id) return;
        if (performance.now() - dueKeyAt < 1500) { f.due._dirty = true; saveDueSoon(); }   // 키보드로 치는 중
        else { f.due._dirty = true; commitDue(true); }                                       // 달력에서 고름 → 바로
      };
      f.due.addEventListener('change', onDueEdit);
      f.due.addEventListener('blur', () => {
        dueKeyAt = -1e9;
        if (T.id === id && f.due._dirty) { saveDueSoon.flush(); if (f.due._dirty) commitDue(true); }
      });
      const base = () => { const x = curItem(); return x && D.valid(x.due) ? D.str(D.parse(x.due)) : D.today(); };
      const quick = (label, fn, aria) => el('button', { type: 'button', class: 'btn btn-sm ck-quick', 'aria-label': aria || label, onclick: () => { f.due._dirty = false; setDue(fn()); } }, label);
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
      f.noteInput = el('textarea', { class: 'textarea ck-note-input', rows: '1', 'aria-label': '메모 입력' });
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
      /* 엔터: 컴퓨터(마우스)에서는 저장·쉬프트+엔터는 줄바꿈 / 터치 화면에서는 줄바꿈 (화면 키보드엔 쉬프트가 없음) → 저장은 '보내기'.
         어느 기기든 컨트롤(⌘)+엔터는 저장. 한글 조합 중 엔터는 건드리지 않음 */
      f.noteInput.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter' || e.isComposing || e.keyCode === 229) return;
        if (e.ctrlKey || e.metaKey) { e.preventDefault(); sendNote(); return; }
        if (e.shiftKey || isTouch()) return;
        e.preventDefault(); sendNote();
      });
      f.noteInput.addEventListener('input', () => { mem.noteDrafts[id] = f.noteInput.value; autosize(f.noteInput, 160); });
      f.noteSend.addEventListener('click', sendNote);
      const foot = f.foot = el('div', { class: 'ck-th-foot' }, el('div', { class: 'ck-note-row' }, f.noteInput, f.noteSend));
      syncNoteHint();

      put(thread, headEl, f.body, foot);
      syncThread(true);
      // (f.body 는 새로 만든 칸이라 스크롤은 이미 맨 위 — scrollTop 을 쓰면 레이아웃을 강제로 계산하게 됨)
      inFrame(() => { if (T.f === f) autosizeAll([[f.title], [f.detail, 420], [f.noteInput, 160]]); });
    }
    function syncNoteHint() {
      const ta = T.f.noteInput;
      if (!ta) return;
      const touch = isTouch();
      ta.placeholder = touch ? NOTE_PH_TOUCH : NOTE_PH_KEYS;
      ta.setAttribute('enterkeyhint', touch ? 'enter' : 'send');
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
      const pl = partLabel(p);
      if (f.partChip.textContent !== pl) put(f.partChip, el('span', { class: 'ck-th-part-t' }, pl));
      f.partChip.title = p ? p.name + ' 채널 보기' : '';
      if (ae !== f.moveSel) {
        fillPartSelect(f.moveSel, '', MOVE_PH);   // 짧게: 서랍·폰 머리에서 잘리지 않게 (전체 뜻은 aria-label·title)
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
      if (ae !== f.due && !f.due._dirty && f.due.value !== dueStr) f.due.value = dueStr;
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
      const links = linksOf(it);
      const lsig = JSON.stringify(links);
      if (lsig !== T.linksSig) {
        T.linksSig = lsig;
        put(f.links, ...(links.length ? links.map((l) => el('div', { class: 'ck-link' },
          safeUrl(l.url)
            ? el('a', { href: safeUrl(l.url), target: '_blank', rel: 'noopener noreferrer' }, '🔗 ', str(l.label) || str(l.url))
            : el('span', { class: 'ck-link-bad', title: '열 수 없는 주소예요 (인터넷 주소·전화·메일 링크만 열려요)' }, '⚠️ ', str(l.label) || str(l.url), el('small', ' · 열 수 없는 주소')),
          el('button', { type: 'button', class: 'ck-x', 'aria-label': '링크 지우기: ' + (str(l.label) || str(l.url)), onclick: () => {
            const x = curItem(); if (!x) return;
            const idx = arr(x.links).findIndex((y) => y && y.url === l.url && y.label === l.label);
            if (idx >= 0) removeLink(idx);
          } }, '×')))
          : [el('p', { class: 'ck-none' }, '견적서·제품 페이지 주소를 붙여 두면 편해요.')]));
      }
      const g = it.guide || (p && p.guide) || '';
      put(f.guide, g ? el('a', { class: 'ck-guide-link', href: guideHash(g) }, '📖 ', it.guide ? '관련 가이드 보기' : (p ? p.name + ' 가이드 보기' : '가이드 보기')) : '');
      f.guide.hidden = !g;
      // 메모
      const notes = notesOf(it);
      const nsig = notes.map((n) => n.id + ':' + str(n.text).length).join(',');
      f.notesCount.textContent = String(notes.length);
      if (nsig !== T.notesSig) {
        T.notesSig = nsig;
        const fk = focusKeyIn(f.notes);
        put(f.notes, ...(notes.length ? notes.map((n) => el('div', { class: 'ck-note', 'data-nid': n.id },
          el('span', { class: 'ck-note-ava', 'aria-hidden': 'true' }, '📝'),
          el('div', { class: 'ck-note-body' },
            el('div', { class: 'ck-note-meta' },
              el('span', { class: 'ck-note-who' }, '메모'),
              el('time', { class: 'ck-note-time', datetime: str(n.at) }, D.time(n.at)),
              el('button', {
                type: 'button', class: 'ck-x ck-note-del', 'aria-label': '메모 지우기', 'data-fkey': 'nd:' + n.id,
                onclick: () => MV.ui.confirm('이 메모를 지울까요?', { danger: true, okLabel: '지우기', title: '메모 삭제' }).then((ok) => { if (ok && T.id) MV.items.removeNote(T.id, n.id); }),
              }, '×')),
            el('div', { class: 'ck-note-text' }, MV.linkify(str(n.text))))))
          : [el('p', { class: 'ck-none ck-notes-empty' }, '아직 메모가 없어요. 통화 내용, 견적, 결정한 것을 남겨 두면 나중에 찾기 쉬워요.')]));
        restoreFocusIn(f.notes, fk);
        if (T.scrollNotes && !initial) {
          T.scrollNotes = false;
          const last = f.notes.lastElementChild;
          if (last) {
            replayAnim(last, 'ck-flash');
            inFrame(() => {
              if (!last.isConnected) return;
              if (isPhone()) revealOnPhone(last, f.foot, f.head);   // 아래 메모 입력창·하단 메뉴에 가리지 않게
              else f.body.scrollTop = f.body.scrollHeight;
            });
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
    /* 누르는 중(mousedown/터치 ~ click)에는 다시 그리지 않고 click 이 끝난 뒤에 그림.
       스레드의 제목·설명 칸은 blur 때 저장되는데, blur 는 다른 곳을 누르는 mousedown 순간에 일어남 →
       그때 바로 다시 그리면 누른 사이드바·버튼·체크박스 노드가 바뀌어 첫 클릭이 사라졌음. */
    let holding = false; let holdTimer = null; let pendingRefresh = false;
    function scheduleRefresh() {
      if (!alive) return;
      if (holding) { pendingRefresh = true; return; }
      if (queued) return;
      queued = true;
      Promise.resolve().then(() => { queued = false; try { refresh(); } catch (e) { console.error(e); } });
    }
    function releaseHold() {
      clearTimeout(holdTimer); holdTimer = null;
      if (!holding) return;
      holding = false;
      if (pendingRefresh) { pendingRefresh = false; scheduleRefresh(); }
    }
    function releaseSoon(ms) { clearTimeout(holdTimer); holdTimer = setTimeout(releaseHold, ms); }
    const onDown = (e) => { if (e.button > 0) return; holding = true; releaseSoon(2500); };   // 안전장치: 아주 오래 누르고 있으면 그냥 그림
    const onUp = () => { if (holding) releaseSoon(450); };      // click 이 오지 않는 경우(끌기 등) 대비
    const onClickDone = () => { if (holding) releaseSoon(0); };  // click 처리가 모두 끝난 다음 작업에서 그림
    const onCancel = () => { if (holding) releaseSoon(0); };
    document.addEventListener('pointerdown', onDown, true);
    document.addEventListener('mousedown', onDown, true);
    document.addEventListener('pointerup', onUp, true);
    document.addEventListener('click', onClickDone, true);
    document.addEventListener('pointercancel', onCancel, true);
    ctx.onCleanup(() => {
      clearTimeout(holdTimer);
      document.removeEventListener('pointerdown', onDown, true);
      document.removeEventListener('mousedown', onDown, true);
      document.removeEventListener('pointerup', onUp, true);
      document.removeEventListener('click', onClickDone, true);
      document.removeEventListener('pointercancel', onCancel, true);
    });
    ctx.subscribe(scheduleRefresh);

    /* ---------- 창을 닫거나 새로 고칠 때: 스레드에서 쓰던 제목·설명·마감을 저장 ---------- */
    /* (core 는 pagehide 때 저장 대기열만 비움 → 아직 blur·디바운스 전인 칸은 여기서 먼저 반영하고 바로 저장) */
    const onPageHide = (soft) => {
      if (!alive) return;
      try { flushThread(soft === true); } catch (e) { console.error(e); }
      try { MV.store.persist(); } catch (e) { /* 무시 */ }
    };
    const onVisibility = () => { if (document.visibilityState === 'hidden') onPageHide(true); };
    window.addEventListener('pagehide', onPageHide);
    window.addEventListener('beforeunload', onPageHide);
    document.addEventListener('visibilitychange', onVisibility);
    ctx.onCleanup(() => {
      window.removeEventListener('pagehide', onPageHide);
      window.removeEventListener('beforeunload', onPageHide);
      document.removeEventListener('visibilitychange', onVisibility);
    });

    /* 더블클릭: 첫 클릭이 연 대화상자를 두 번째 mousedown(배경)이 바로 닫던 문제 → 배경의 연속 클릭은 무시 */
    const onModalDown = (e) => {
      const t = e.target;
      if (e.detail >= 2 && t && t.classList && t.classList.contains('modal-back')) { e.stopPropagation(); e.preventDefault(); }
    };
    window.addEventListener('mousedown', onModalDown, true);
    ctx.onCleanup(() => window.removeEventListener('mousedown', onModalDown, true));

    /* ---------- 키보드 ---------- */
    function onKey(e) {
      if (!alive || e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return;
      if (document.querySelector('.modal-back')) return;
      const t = e.target;
      if (e.key === 'Tab') { if (cur.itemId && drawerMode()) trapTab(e); return; }
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
      if (!r) return;
      if (isDesk()) { const a = r.querySelector('.ck-row-title'); if (a) a.focus({ preventScroll: true }); }
      inFrame(() => { if (!r.isConnected) return; if (isPhone()) revealOnPhone(r, composer, head); else r.scrollIntoView({ block: 'nearest' }); });
    }
    document.addEventListener('keydown', onKey);
    ctx.onCleanup(() => document.removeEventListener('keydown', onKey));

    /* ---------- 화면 크기 변화 ---------- */
    const mqP = mq(MQ_PHONE); const mqD = mq(MQ_DESK); const mqT = mq(MQ_TOUCH);
    /* 좁은 목록 열에서 입력창을 두 줄로 바꾸는 건 CSS 컨테이너 쿼리가 함 (크기를 재지 않음).
       ResizeObserver 는 레이아웃이 끝난 뒤 크기를 알려 주므로 강제 레이아웃 없이:
       ① 두 줄 입력창일 때 토스트를 더 위로(ck-narrow) ② 입력창 너비에 맞는 예시 문구 고르기 */
    let compPhFont = ''; let compPhW = null;
    function fitCompPh(w) {
      if (!(w > 0)) return;
      let font = '';
      try { const cs = getComputedStyle(compInput); font = cs.fontStyle + ' ' + cs.fontWeight + ' ' + cs.fontSize + ' ' + cs.fontFamily; } catch (e) { font = ''; }
      if (!compPhW || font !== compPhFont) {
        compPhFont = font;
        let c2 = null;
        try { c2 = document.createElement('canvas').getContext('2d'); if (c2 && font) c2.font = font; } catch (e) { c2 = null; }
        compPhW = COMP_PH.map((t) => (c2 ? c2.measureText(t).width : t.length * 15));
      }
      let i = compPhW.findIndex((x) => x + 2 <= w);
      if (i < 0) i = COMP_PH.length - 1;
      if (compInput.placeholder !== COMP_PH[i]) compInput.placeholder = COMP_PH[i];
    }
    if (window.ResizeObserver) {
      const ro = new ResizeObserver((entries) => {
        if (!alive) return;
        entries.forEach((en) => {
          const w = en.contentRect.width;
          if (en.target === main) composer.classList.toggle('ck-narrow', !isPhone() && w > 0 && w < 480);
          else if (en.target === compInput) fitCompPh(w);
        });
      });
      ro.observe(main); ro.observe(compInput);
      ctx.onCleanup(() => ro.disconnect());
    }
    const onMode = () => {
      if (!alive) return;
      syncDrawer(); renderSidebar();
      inFrame(() => { if (T.f.title) autosizeAll([[T.f.title], [T.f.detail, 420], [T.f.noteInput, 160]]); });
    };
    const onTouchMode = () => { if (alive) syncNoteHint(); };
    try { mqP.addEventListener('change', onMode); mqD.addEventListener('change', onMode); mqT.addEventListener('change', onTouchMode); } catch (e) { /* 옛 브라우저 */ }
    ctx.onCleanup(() => { try { mqP.removeEventListener('change', onMode); mqD.removeEventListener('change', onMode); mqT.removeEventListener('change', onTouchMode); } catch (e) { /* 무시 */ } });

    /* 사이드바 스크롤은 스크롤할 때 기억 (떠날 때 읽지 않음) */
    let sideY = mem.sideScroll || 0;
    chans.addEventListener('scroll', () => { sideY = chans.scrollTop; }, { passive: true });

    ctx.onCleanup(() => {
      try { flushThread(); } catch (e) { /* 무시 */ }
      saveScroll(screenKey(), listKey());   // alive 를 끄기 전에 (아직 화면에 붙어 있음)
      alive = false;
      lingering.forEach((t) => clearTimeout(t));
      lingering.clear();
      mem.sideScroll = sideY;
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
.ck-search-row { display: flex; align-items: center; gap: 4px; margin-top: 10px; }
.ck-search { position: relative; flex: 1 1 auto; min-width: 0; }
.ck-search-back { display: none; flex: none; font-size: 1.3rem; width: 40px; min-height: 44px; }
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
.ck-chan-emo { flex: none; width: 1.4em; text-align: center; overflow: hidden; white-space: nowrap; }
.ck-chan-name { flex: 1 1 auto; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.ck-chan-meta { flex: none; font-size: .72rem; font-weight: 600; color: var(--ink-3); font-variant-numeric: tabular-nums; }
.ck-chan.ck-active .ck-chan-meta { color: inherit; opacity: .85; }
.ck-chan-badge { flex: none; }
.ck-chan.ck-active .ck-chan-badge { background: var(--on-brand); color: var(--brand); }
.ck-side-empty { font-size: .82rem; color: var(--ink-3); padding: 12px 8px; margin: 0; }
.ck-side-foot { flex: none; padding: 8px; border-top: 1px solid var(--line); }
.ck-addpart { width: 100%; min-height: 38px; display: flex; align-items: center; gap: 6px; padding: 0 10px; border: 1px dashed var(--line-2); border-radius: 10px; background: transparent; color: var(--ink-2); font: inherit; font-size: .88rem; font-weight: 700; cursor: pointer; }
.ck-addpart:hover { background: var(--bg-2); color: var(--brand); border-color: var(--brand); }
/* 키보드 단축키 안내: 마우스가 있는 컴퓨터에서만 (터치 화면에서는 숨김) */
.ck-keys { display: none; margin: 8px 2px 0; font-size: .7rem; color: var(--ink-3); line-height: 1.8; }
.ck-keys-h { font-weight: 800; color: var(--ink-2); }
@media (hover: hover) and (pointer: fine) { .ck-keys { display: block; } }

/* 채널 머리 */
.ck-main { display: flex; flex-direction: column; min-width: 0; min-height: 0; background: var(--bg-2); }
.ck-head { flex: none; padding: 12px 16px 0; }
.ck-head-top { display: flex; align-items: center; gap: 8px; min-width: 0; min-height: 38px; }
.ck-head-emo { flex: none; max-width: 1.5em; overflow: hidden; white-space: nowrap; text-align: center; font-size: 1.3rem; line-height: 1.2; }
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
.ck-own { display: inline-flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.ck-own-note { font-size: .72rem; font-weight: 700; color: var(--ink-3); white-space: nowrap; }

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
/* 줄은 position 을 주지 않음: 위치 지정된 줄은 터치 보정(touch adjustment)에서 바로 위 줄의 칩 터치를 가로챔 */
.ck-row { display: flex; align-items: flex-start; gap: 4px; padding: 4px 16px 6px 8px; cursor: pointer; transition: background .1s; }
/* 화면 밖 줄은 그리지 않음 → '전체'(220개)도 빨리 열림. 높이는 어림값, 한 번 그린 줄은 실제 높이를 기억.
   (어림값은 안쪽 높이라 위아래 여백은 따로 더해짐: 54 + 4 + 6 = 한 줄짜리 줄 64px) */
.ck-row { content-visibility: auto; contain-intrinsic-size: auto 54px; }
.ck-row .ck-cb:focus-visible { outline-offset: -2px; }   /* 줄 밖으로 나간 초점 테두리는 잘리므로 안쪽에 */
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
.ck-pchip { border: 0; font: inherit; cursor: pointer; max-width: 100%; min-width: 0; }
.ck-th-part { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; display: inline-block; }
/* 목록 줄의 파트 칩: 버튼은 투명한 틀, 모양은 안쪽 span (터치 때 틀만 키워 줄 높이는 그대로) */
.ck-rchip { position: relative; z-index: 1; display: inline-flex; max-width: 100%; min-width: 0; padding: 0; margin: 0; border: 0; border-radius: 999px; background: transparent; color: inherit; font: inherit; cursor: pointer; -webkit-tap-highlight-color: transparent; }
.ck-rchip .ck-pchip-t { display: block; max-width: 100%; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ck-rchip:hover .ck-pchip-t { background: var(--line); color: var(--ink); }
.ck-rchip:focus-visible { outline: none; }
.ck-rchip:focus-visible .ck-pchip-t { outline: 2px solid var(--brand); outline-offset: 1px; }
.ck-pchip:hover { background: var(--line); color: var(--ink); }
.ck-snip { margin-top: 3px; font-size: .78rem; color: var(--ink-3); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ck-leaving { animation: ck-leave 1.3s ease-in forwards; }
@keyframes ck-leave { 0%, 55% { opacity: 1; } 100% { opacity: .3; } }
.ck-flash { animation: ck-flash 1.8s ease-out; }
@keyframes ck-flash { 0%, 25% { background: color-mix(in srgb, var(--brand) 20%, transparent); } 100% { background: transparent; } }
.ck-empty { padding: 40px 16px; }
.ck-empty-act { margin-top: 12px; display: flex; gap: 8px; justify-content: center; flex-wrap: wrap; }

/* 최근 활동 */
.ck-act { display: flex; align-items: flex-start; gap: 10px; width: 100%; padding: 7px 16px; border: 0; background: transparent; color: var(--ink); font: inherit; text-align: left; content-visibility: auto; contain-intrinsic-size: auto 38px; }
.ck-act-link { cursor: pointer; }
.ck-act-link:focus-visible { outline-offset: -3px; }
@media (hover: hover) { .ck-act-link:hover { background: color-mix(in srgb, var(--bg-3) 65%, transparent); } }
.ck-act-ico { flex: none; display: grid; place-items: center; width: 32px; height: 32px; border-radius: 9px; background: var(--bg-3); font-size: .95rem; }
.ck-act-main { flex: 1 1 auto; min-width: 0; display: flex; flex-direction: column; }
.ck-act-text { font-size: .9rem; line-height: 1.45; }
.ck-act-link .ck-act-text { font-weight: 600; }
.ck-act-time { font-size: .74rem; color: var(--ink-3); }

/* 입력창 */
.ck-composer { flex: none; padding: 10px 12px 12px; border-top: 1px solid var(--line); background: var(--bg-2); }
.ck-comp-row { display: flex; align-items: center; gap: 8px; }
.ck-comp-pw { flex: 0 1 auto; display: flex; align-items: center; gap: 6px; min-width: 0; max-width: 38%; }
.ck-comp-pw[hidden] { display: none; }
.ck-comp-pl { display: none; flex: none; font-size: .74rem; font-weight: 800; color: var(--ink-3); white-space: nowrap; }
.ck-comp-part { flex: 1 1 auto; width: auto; min-width: 0; max-width: 100%; min-height: 44px; font-size: .85rem; }
/* 좁은 목록 열(목록 열 480px 미만: 스레드가 열린 데스크톱, 좁은 태블릿 등): 파트 고르기는 윗줄로 → 입력칸을 넓게.
   컨테이너 쿼리라 JS 로 너비를 재지 않음 (입력창 영역의 안쪽 너비 456px = 목록 열 480px − 좌우 여백 24px) */
.ck-composer { container: ck-comp / inline-size; }
@media (min-width: 700px) {
  @container ck-comp (max-width: 455.98px) {
    .ck-comp-row { flex-wrap: wrap; row-gap: 6px; }
    .ck-comp-pw { flex: 1 1 100%; max-width: none; }
    .ck-comp-pl { display: inline; }
    .ck-comp-part { min-height: 36px; padding-top: 4px; padding-bottom: 4px; }
    .ck-comp-btn { padding: 0 12px; }
  }
}
.ck-comp-note { display: flex; align-items: center; gap: 8px; margin: 0 0 8px; padding: 4px 4px 4px 10px; border-radius: 10px; background: var(--good-bg); color: var(--ink); font-size: .82rem; font-weight: 600; animation: ck-note-in .16s ease-out; }
.ck-comp-note[hidden] { display: none; }
.ck-comp-note-ico { flex: none; color: var(--good); font-weight: 900; }
.ck-comp-note-txt { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ck-comp-note-go { flex: none; white-space: nowrap; }
.ck-comp-note-x { width: 32px; height: 32px; }
@keyframes ck-note-in { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: none; } }
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
.ck-th-part { flex: 0 1 auto; min-width: 0; max-width: 52%; min-height: 30px; font-size: .8rem; }
.ck-th-part-t { display: block; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ck-move { flex: 0 1 132px; width: auto; min-width: 96px; max-width: 150px; min-height: 36px; padding: 4px 8px; font-size: .8rem; }   /* '📁 파트 옮기기' 가 다 보이는 너비 → 남는 자리는 파트 칩에 */
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
.ck-link a, .ck-link-bad { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 600; }
.ck-link-bad { color: var(--ink-3); font-weight: 500; }
.field .ck-link-hint { color: var(--bad); font-weight: 700; }
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

/* 손가락 터치: 36px 이상 */
@media (pointer: coarse) {
  .ck-rchip { padding: 8px 2px; margin: -8px -2px; }   /* 누르는 영역 36px, 보이는 칩은 그대로 */
  .ck-th-part { min-height: 36px; display: inline-flex; align-items: center; }
  .ck-addlink, .ck-del, .ck-guide-link, .ck-link { min-height: 36px; }
  .ck-x { width: 36px; height: 36px; }
  .ck-note-del { width: 36px; height: 36px; }
}
/* 체크리스트가 열려 있으면 토스트를 아래 입력창 위로 (입력창을 가리지 않게) */
body:has(.ck) .toast button { white-space: nowrap; flex: none; }
@media (min-width: 700px) {
  body:has(.ck .ck-composer:not([hidden])) .toast-wrap { bottom: calc(var(--bottom-h) + 128px + env(safe-area-inset-bottom)); }
  body:has(.ck .ck-composer.ck-narrow:not([hidden])) .toast-wrap { bottom: calc(var(--bottom-h) + 170px + env(safe-area-inset-bottom)); }
}
@media (max-width: 699px) {
  body:has(.ck[data-screen="list"] .ck-composer:not([hidden])) .toast-wrap,
  body:has(.ck[data-screen="thread"]) .toast-wrap { bottom: calc(var(--bottom-h) + 84px + env(safe-area-inset-bottom)); }
  body:has(.ck[data-screen="list"] .ck-composer:not([hidden]):is(:focus-within, .ck-has-text)) .toast-wrap { bottom: calc(var(--bottom-h) + 112px + env(safe-area-inset-bottom)); }
  body:has(.ck:is([data-screen="channels"], [data-screen="search"])) .toast-wrap { bottom: calc(var(--bottom-h) + 16px + env(safe-area-inset-bottom)); }
}

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
@media (min-width: 1100px) and (max-width: 1279px) {
  .ck { --ck-side: 224px; }
  .ck.ck-open { --ck-side: 208px; --ck-thread: 316px; }
}

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
  .ck[data-screen="search"] .ck-search-row { margin-top: 0; }
  .ck[data-screen="search"] .ck-search-back { display: inline-flex; }
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
  .ck-chan { position: relative; min-height: 48px; padding: 6px 10px; font-size: 1rem; border-radius: 12px; }
  /* 줄 사이 구분선: 곧은 한 줄 (둥근 모서리 줄에 box-shadow 를 쓰면 양 끝이 휘어 보였음) */
  .ck-chan + .ck-chan::before { content: ''; position: absolute; top: 0; left: 10px; right: 10px; height: 1px; background: var(--line); pointer-events: none; }
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
  .ck-row { padding: 6px 4px 8px 0; margin: 0 -4px; border-radius: 12px; contain-intrinsic-size: auto 62px; }   /* 62 + 6 + 8 ≈ 폰 줄 평균 76px */
  .ck-row.ck-overdue { box-shadow: inset 3px 0 0 var(--bad); }
  .ck-row + .ck-row { background-image: linear-gradient(var(--line), var(--line)); background-repeat: no-repeat; background-position: 44px 0; background-size: calc(100% - 48px) 1px; }
  .ck-cb { width: 44px; height: 44px; }
  .ck-cb-box { width: 26px; height: 26px; }
  .ck-row-main { padding-top: 9px; }
  .ck-row-title { font-size: 1rem; }
  .ck-act { padding: 8px 2px; }
  .ck-composer { position: sticky; bottom: calc(var(--bottom-h) + env(safe-area-inset-bottom)); z-index: 6; margin: 0 -16px; padding: 8px 12px 10px; background: color-mix(in srgb, var(--bg) 94%, transparent); backdrop-filter: blur(10px); border-top: 1px solid var(--line); }
  .ck-comp-pw { max-width: 33%; }
  .ck-comp-part { min-height: 44px; padding-left: 6px; padding-right: 2px; font-size: .8rem; }
  .ck-comp-btn { padding: 0 12px; }
  .ck-comp-input { font-size: 1rem; }

  .ck-th-head { position: sticky; top: var(--topbar-h); z-index: 6; margin: -14px -16px 0; padding: 6px 10px 6px 4px; background: color-mix(in srgb, var(--bg) 92%, transparent); backdrop-filter: blur(10px); }
  .ck-th-close { display: none; }
  .ck-move { max-width: 46vw; min-width: 124px; }   /* 옮기기 글자가 잘리지 않게: 좁으면 파트 칩이 먼저 줄어듦 */
  .ck-th-part { flex-shrink: 3; }   /* 좁으면 파트 칩이 먼저 줄어 '옮기기' 글자가 보이게 */
  .ck-th-back { padding: 0 6px; }
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
        put(root, errCard('체크리스트를 여는 중 문제가 생겼어요', e, { retry: () => MV.rerender() }));
      }
    },
  });
})();
