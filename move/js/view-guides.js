/* ============================================================
   우리집 이사 관리 — 가이드 뷰어
   MV.guides (data-guides-*.js) 를 목록·본문으로 보여 줍니다.
   #/guide                  → 목록 (검색: 제목·요약·본문)
   #/guide/<id>             → 본문
   #/guide/<id>/<anchor>    → 본문 + 해당 위치로 이동 (잠깐 강조)
     · '<id>#<anchor>' 형태(체크 항목의 guide 필드 그대로)도 받아 줍니다.
     · 가이드 id 대신 파트 id 가 오면 그 파트의 guide 로 연결합니다.
   본문 처리: h2/h3 목차(데스크톱 오른쪽 고정, 폰은 접이식 — h2 와 지금 읽는 절의 h3 만), 넓은 표 가로 스크롤,
             외부 링크 새 창, data-copy="문구" 요소에 '복사' 버튼, 지난 날짜 칩 회색·일정표의 지난 날짜 칸 회색(오늘 줄 강조),
             머리의 '🔥 지금 할 일'(관련 파트에서 안 끝났고 오늘 → 기한 지남 → 3일 안 순서. 별첨처럼 파트를 빌려 쓰는 가이드는 이 가이드로 이어진 할 일만), 꼬리말(관련 체크리스트 → 이전/다음 → 출처).
   할 일 상세(#/checklist/<파트>/<id>)에서 들어오면 '← 할 일로' 단추 (iOS 홈 화면 앱에는 뒤로 단추가 없어서).
   목록: 검색어가 없으면 급한 순(기한 지남 > 오늘 > 곧 마감 > 남은 일), 다 끝난 가이드는 아래로. 검색은 관련도 순.
   이 기기에만 기억: localStorage 'mv:guide:last' {id, sec, secText, at} — 목록 맨 위 '이어 읽기' (7일 지나면 숨김)
   CSS 접두사: gd-
   ============================================================ */
(function () {
  'use strict';
  const { el } = MV;
  const D = MV.date;

  const SIDE_MQ = '(min-width: 1100px)';     // 이 이상이면 목차를 오른쪽에 고정
  const INLINE_TAGS = new Set(['SPAN', 'CODE', 'A', 'B', 'STRONG', 'EM', 'I', 'KBD', 'MARK', 'SMALL', 'U', 'S', 'SUB', 'SUP', 'ABBR', 'TIME', 'LABEL']);

  /* ---------- 모듈 상태 ---------- */
  // from: 할 일 상세에서 바로 들어왔을 때 그 주소 · hit: 검색 결과를 눌러 열 때 본문에서 표시할 검색어
  const st = { q: '', indexScroll: 0, lastKey: null, from: null, hit: null };
  const cache = new Map();                 // guide id → 파싱 결과 (html 이 같을 때만 재사용)
  let suppressAnchorUntil = 0;
  // 초기화·복원·다른 탭 동기화로 화면이 통째로 다시 그려질 때는 앵커로 튀지 않게.
  // (app.js 보다 먼저 등록되므로 rerender 전에 실행됩니다)
  MV.store.on('change', (e) => { if (e && e.reset) suppressAnchorUntil = Date.now() + 600; });
  // 직전 주소 기억 (app.js 의 hashchange 보다 먼저 등록되므로 그리기 전에 실행됩니다).
  // 할 일 상세 → 가이드로 바로 온 때만 남기고, 그 밖의 이동(가이드끼리 포함)은 지워요 → history.back() 이 그 할 일로 가요
  const ITEM_HASH = /^#\/checklist\/[^/]+\/[^/]+/;
  window.addEventListener('hashchange', (e) => {
    let oldH = '';
    try { oldH = new URL(e.oldURL).hash; } catch (err) { oldH = ''; }
    st.from = /^#\/guide\/[^/]/.test(window.location.hash) && ITEM_HASH.test(oldH) ? oldH : null;
  });
  function itemFromHash(h) {
    const segs = String(h || '').replace(/^#\/?/, '').split('/').map((s) => decodeURIComponentSafe(s));
    if (segs[0] !== 'checklist') return null;
    const id = segs[1] === '~search' ? segs[3] : segs[2];
    return id ? MV.items.get(id) : null;
  }
  const cleanTitle = (t) => String(t || '').replace(/^\s*\[\d{1,2}\/\d{1,2}\]\s*/, '');

  /* 이어 읽기 (이 기기에만 · 공유·백업 대상 아님) */
  const LAST_KEY = 'mv:guide:last';
  const LAST_DAYS = 7;
  function readLast() {
    try {
      const v = JSON.parse(window.localStorage.getItem(LAST_KEY) || 'null');
      return v && typeof v === 'object' && typeof v.id === 'string' && typeof v.at === 'number' && isFinite(v.at) ? v : null;
    } catch (e) { return null; }
  }
  function writeLast(v) { try { window.localStorage.setItem(LAST_KEY, JSON.stringify(v)); } catch (e) { /* 무시 */ } }

  /* 본문의 'M/D' 날짜: 연도가 없으니 오늘에서 가장 가까운 해로 읽어요 (10/27 → 올해, 1/20 → 내년) */
  function mdNear(m, d) {
    const t = D.parse(D.today());
    if (!t || m < 1 || m > 12 || d < 1 || d > 31) return null;
    let best = null;
    [-1, 0, 1].forEach((k) => {
      const x = new Date(t.getFullYear() + k, m - 1, d);
      if (x.getMonth() !== m - 1) return;
      if (!best || Math.abs(x - t) < Math.abs(best - t)) best = x;
    });
    return best ? D.str(best) : null;
  }
  // '10/27까지', '10/26(월)', '10/30~11/2', '10/15(목)~10/16(금)', '11/4~6' → { start, end }
  const MD_RE = /^\s*(\d{1,2})\/(\d{1,2})(?!\d)(?:\s*\([^)]{1,3}\))?(?:\s*[~～–-]\s*(?:(\d{1,2})\/)?(\d{1,2})(?!\d))?/;
  function dateSpan(text) {
    const m = MD_RE.exec(String(text || ''));
    if (!m) return null;
    const start = mdNear(+m[1], +m[2]);
    if (!start) return null;
    let end = start;
    if (m[4]) { const e = mdNear(m[3] ? +m[3] : +m[1], +m[4]); if (e && e >= start) end = e; }
    return { start, end };
  }
  function dayState(span) {
    const t = D.today();
    if (span.end < t) return 'past';
    if (span.start <= t) return 'today';
    return 'future';
  }
  function focusQuiet(n) {
    if (!n) return;
    if (!n.hasAttribute('tabindex')) n.setAttribute('tabindex', '-1');
    try { n.focus({ preventScroll: true }); } catch (e) { /* 무시 */ }
  }
  // 관련 파트를 합친 진행 상황
  function partsStats(parts) {
    const r = { total: 0, done: 0, overdue: 0, today: 0, soon: 0 };
    parts.forEach((p) => { const s = MV.parts.stats(p.id); r.total += s.total; r.done += s.done; r.overdue += s.overdue; r.today += s.today; r.soon += s.soon; });
    r.open = r.total - r.done;
    return r;
  }
  // 이 가이드가 '주인'인 파트가 있나요? (파트의 guide 가 이 가이드를 가리킴)
  // 없으면 별첨(hug)처럼 다른 파트를 빌려 쓰는 가이드라서, 그 파트 전체가 아니라 이 가이드로 이어진 할 일만 셉니다
  const ownsParts = (g, parts) => parts.some((p) => p.guide && String(p.guide).split('#')[0] === String(g.id));
  const linkedItems = (g) => MV.items.list((it) => String(it.guide || '').split('#')[0] === String(g.id));
  function guideStats(g, parts) {
    if (!parts.length || ownsParts(g, parts)) return partsStats(parts);
    const r = { total: 0, done: 0, overdue: 0, today: 0, soon: 0 };
    linkedItems(g).forEach((it) => {
      r.total++;
      const s = MV.items.status(it);
      if (s === 'done') r.done++; else if (s === 'overdue') r.overdue++; else if (s === 'today') r.today++; else if (s === 'soon') r.soon++;
    });
    r.open = r.total - r.done;
    return r;
  }

  /* ---------- 도우미 ---------- */
  const cssEsc = (s) => (window.CSS && CSS.escape ? CSS.escape(s) : String(s).replace(/["\\]/g, '\\$&'));
  const reduceMotion = () => !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  function slugify(s) {
    let r = String(s || '').trim().toLowerCase().replace(/[\s_]+/g, '-');
    try { r = r.replace(/[^\p{L}\p{N}-]+/gu, ''); } catch (e) { r = r.replace(/[^\w\u3131-\uD79D-]+/g, ''); }
    r = r.replace(/-+/g, '-').replace(/^-|-$/g, '');
    return r || 'section';
  }
  function guideList() {
    const arr = Array.isArray(MV.guides) ? MV.guides : [];
    const map = new Map();
    const order = [];
    arr.forEach((g) => {
      if (!g || typeof g !== 'object' || g.id == null || g.id === '') return;
      const id = String(g.id);
      if (!map.has(id)) order.push(id);
      map.set(id, g);                       // 같은 id 가 또 오면 나중 것(최신 내용)을 씁니다
    });
    return order.map((id) => map.get(id));
  }
  function relatedParts(g) {
    const ids = new Set((Array.isArray(g.partIds) ? g.partIds : []).map(String));
    MV.parts.list().forEach((p) => {
      if (p.guide && String(p.guide).split('#')[0] === String(g.id)) ids.add(p.id);
    });
    const order = new Map(MV.parts.list().map((p, i) => [p.id, i]));
    return Array.from(ids).map((id) => MV.parts.get(id)).filter(Boolean)
      .sort((a, b) => order.get(a.id) - order.get(b.id));
  }
  function orderedGuides() {
    const order = new Map(MV.parts.list().map((p, i) => [p.id, i]));
    return guideList().map((g, i) => {
      const rel = relatedParts(g);
      const first = rel.length ? Math.min(...rel.map((p) => order.get(p.id))) : 1e9;
      return { g, rel, first, i };
    }).sort((a, b) => (a.first - b.first) || (a.i - b.i));
  }
  function findGuide(id) {
    return guideList().find((g) => String(g.id) === String(id)) || null;
  }
  // id 해석: 가이드 id → 파트 id(그 파트의 guide) → partIds 에 그 파트가 들어 있는 가이드
  function resolve(rawId, rawAnchor) {
    let id = String(rawId || ''), anchor = rawAnchor ? String(rawAnchor) : '';
    if (id.includes('#')) { const k = id.indexOf('#'); anchor = anchor || id.slice(k + 1); id = id.slice(0, k); }
    let g = findGuide(id);
    if (g) return { g, anchor, redirected: false };
    const part = MV.parts.get(id);
    if (part && part.guide) {
      const [gid, ga] = String(part.guide).split('#');
      g = findGuide(gid);
      if (g) return { g, anchor: anchor || ga || '', redirected: true };
    }
    g = guideList().find((x) => Array.isArray(x.partIds) && x.partIds.map(String).includes(id));
    if (g) return { g, anchor, redirected: true };
    return { g: null, anchor, id };
  }
  const guideHash = (id, anchor) => '#/guide/' + encodeURIComponent(id) + (anchor ? '/' + encodeURIComponent(anchor) : '');
  /* 읽던 위치: 지금 기록(history entry)에 {id, y, det} 를 적어 두고, 뒤로/앞으로·새로고침으로 같은 기록에 돌아오면 되살립니다. */
  const HS_KEY = 'mvGuide';
  function readHS(id) {
    try {
      const s = history.state;
      const v = s && typeof s === 'object' ? s[HS_KEY] : null;
      return v && typeof v === 'object' && v.id === String(id) && typeof v.y === 'number' && isFinite(v.y) ? v : null;
    } catch (e) { return null; }
  }
  function writeHS(v, key) {
    try {
      const s = history.state;
      const base = s && typeof s === 'object' && !Array.isArray(s) ? s : {};
      history.replaceState(Object.assign({}, base, { [key || HS_KEY]: v }), '');
    } catch (e) { /* 무시 */ }
  }
  /* 목록 화면: 검색어·스크롤을 그 기록에 적어 두고, 뒤로/앞으로·새로고침 때만 되살립니다.
     다른 화면(하단 메뉴 등)에서 새로 들어오면 검색어 없이 처음부터. */
  const HS_IDX = 'mvGuideIdx';
  function readIdxHS() {
    try {
      const s = history.state;
      const v = s && typeof s === 'object' ? s[HS_IDX] : null;
      return v && typeof v === 'object' && typeof v.q === 'string' ? v : null;
    } catch (e) { return null; }
  }

  /* 파싱: <template> 안에서 (이미지 로드·스크립트 실행 없이) 목차용 id 를 붙이고 본문 텍스트를 뽑습니다. */
  function parse(g) {
    const html = String(g.html || '');
    const hit = cache.get(g.id);
    if (hit && hit.html === html) return hit;
    const tpl = document.createElement('template');
    tpl.innerHTML = html;
    const frag = tpl.content;
    // 콘텐츠는 우리가 쓴 것이지만, 실행되는 코드는 들이지 않습니다
    frag.querySelectorAll('script, iframe, object, embed').forEach((s) => s.remove());
    frag.querySelectorAll('*').forEach((n) => {
      Array.from(n.attributes).forEach((a) => {
        if (/^on/i.test(a.name) || (/^(href|src|xlink:href|action|formaction)$/i.test(a.name) && /^\s*javascript:/i.test(a.value))) n.removeAttribute(a.name);
      });
    });
    const used = new Set(Array.from(frag.querySelectorAll('[id]')).map((n) => n.id));
    const sections = [];
    frag.querySelectorAll('h2, h3').forEach((h) => {
      if (!h.id) {
        const base = slugify(h.textContent);
        let id = base, k = 2;
        while (used.has(id)) id = base + '-' + (k++);
        h.id = id; used.add(id);
      }
      sections.push({ id: h.id, level: h.tagName === 'H2' ? 2 : 3, text: h.textContent.replace(/\s+/g, ' ').trim() });
    });
    // 검색용 텍스트 + 각 제목이 시작하는 위치
    let text = '';
    const marks = [];
    const walker = document.createTreeWalker(frag, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
    let n = walker.nextNode();
    while (n) {
      if (n.nodeType === 1) {
        if (/^H[23]$/.test(n.tagName) && n.id) marks.push({ at: text.length, id: n.id, text: n.textContent.trim() });
        if (/^(P|LI|H\d|TD|TH|TR|DIV|SUMMARY|DT|DD|BR|BLOCKQUOTE)$/.test(n.tagName) && text && !/\s$/.test(text)) text += ' ';
      } else {
        const t = n.nodeValue.replace(/\s+/g, ' ');
        if (t.trim()) text += (text && /\s$/.test(text) && /^\s/.test(t)) ? t.replace(/^\s+/, '') : t;
      }
      n = walker.nextNode();
    }
    const r = { html, tpl, sections, text: text.trim(), marks, low: text.trim().toLowerCase() };
    cache.set(g.id, r);
    return r;
  }

  function copyText(text) {
    const legacy = () => {
      const ta = el('textarea', { readonly: true, style: { position: 'fixed', top: '-1000px', left: '0', opacity: '0' } });
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      let ok = false;
      try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
      ta.remove();
      return ok;
    };
    if (navigator.clipboard && window.isSecureContext) {
      return navigator.clipboard.writeText(text).then(() => true, () => legacy());
    }
    return Promise.resolve(legacy());
  }
  function manualCopy(text) {
    const ta = el('textarea', { class: 'textarea', readonly: true, rows: '6' });
    ta.value = text;
    const m = MV.ui.modal({ title: '직접 복사하기', body: el('div', { class: 'stack' }, el('p', { class: 'small muted mb-0' }, '자동 복사가 막혀 있어요. 아래 글을 길게 눌러 복사하세요.'), ta), actions: [{ label: '닫기', kind: 'primary' }] });
    setTimeout(() => { try { ta.focus(); ta.select(); } catch (e) { /* 무시 */ } }, 60);
    return m;
  }
  function doCopy(text, btn) {
    copyText(text).then((ok) => {
      if (!ok) { manualCopy(text); return; }
      const t = MV.ui.toast('복사했어요. 메시지 창에 붙여 넣으세요.');
      if (t && t.classList) t.classList.add('gd-toast');
      if (btn) {
        const old = btn.textContent;
        btn.textContent = '복사됨 ✓';
        btn.classList.add('is-done');
        setTimeout(() => { if (btn.isConnected) { btn.textContent = old; btn.classList.remove('is-done'); } }, 1600);
      }
    });
  }

  /* ---------- 스타일 ---------- */
  MV.css('gd', `
/* 목록 */
.gd-search { position:relative; max-width:560px; margin-bottom:6px; }
.gd-search .input { padding-left:38px; min-height:44px; font-size:1rem; }
.gd-search-ico { position:absolute; left:12px; top:50%; transform:translateY(-50%); color:var(--ink-3); pointer-events:none; }
.gd-count { font-size:.8rem; color:var(--ink-3); margin:0 0 12px 2px; min-height:1.3em; }
.gd-resume { display:flex; align-items:center; gap:10px; max-width:560px; min-height:48px; margin:0 0 10px; padding:8px 14px; border:1px solid color-mix(in srgb, var(--brand) 35%, var(--line)); border-radius:12px; background:var(--brand-bg); color:var(--ink); text-decoration:none; }
.gd-resume:hover { border-color:var(--brand); }
.gd-resume small { display:block; font-size:var(--fs-min, .75rem); font-weight:750; color:var(--brand-ink, var(--brand)); }
.gd-resume b { display:block; font-size:.92rem; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.gd-resume > span:nth-child(2) { min-width:0; flex:1; }
.gd-sec-h { grid-column:1 / -1; font-size:.9rem; font-weight:800; color:var(--ink-2); margin:10px 2px 0; }
.gd-card-foot .chip.warn, .gd-now .chip.warn { color:var(--warn-ink, var(--warn)); }
.gd-card.is-done { gap:0; padding-top:10px; padding-bottom:10px; }
.gd-card.is-done .gd-card-top { align-items:center; }
.gd-card.is-done .gd-card-ico { width:36px; height:36px; font-size:1.2rem; border-radius:10px; }
.gd-card.is-done .gd-card-title { font-size:.95rem; margin:0; font-weight:750; }
.gd-cards { display:grid; gap:12px; grid-template-columns:repeat(auto-fill, minmax(min(100%, 300px), 1fr)); }
.gd-cards > .card { margin:0; }
.gd-card { display:flex; flex-direction:column; gap:8px; color:var(--ink); text-decoration:none; min-width:0; transition:border-color .12s, transform .08s; }
.gd-card:hover { border-color:var(--brand); }
.gd-card:active { transform:translateY(1px); }
.gd-card-top { display:flex; align-items:flex-start; gap:12px; }
.gd-card-ico { flex:none; width:44px; height:44px; border-radius:12px; display:flex; align-items:center; justify-content:center; font-size:1.5rem; background:var(--bg-3); }
.gd-card-title { font-weight:800; font-size:1.02rem; line-height:1.35; margin:2px 0 0; }
.gd-card-sum { color:var(--ink-2); font-size:.88rem; line-height:1.5; margin:0; display:-webkit-box; -webkit-line-clamp:3; -webkit-box-orient:vertical; overflow:hidden; }
@media (max-width: 640px) { .gd-card-sum { -webkit-line-clamp:2; } }
.gd-card-snip { font-size:.8rem; color:var(--ink-3); background:var(--bg); border-radius:8px; padding:6px 9px; line-height:1.5; }
.gd-card-snip b { color:var(--ink-2); font-weight:700; }
.gd-card-foot { display:flex; flex-wrap:wrap; gap:4px; align-items:center; margin-top:auto; padding-top:4px; }
.gd-card-date { margin-left:auto; font-size:var(--fs-min, .75rem); color:var(--ink-3); white-space:nowrap; }
.gd-mark { background:color-mix(in srgb, var(--warn) 22%, transparent); color:var(--ink); font-weight:700; border-radius:3px; padding:0 1px; }
.gd-card-title .gd-mark { font-weight:inherit; }
mark.gd-hit { outline:2px solid color-mix(in srgb, var(--warn) 75%, transparent); outline-offset:1px; scroll-margin:120px 0; }

/* 본문 레이아웃 */
.gd-art { display:grid; grid-template-columns:minmax(0, 1fr); gap:28px; align-items:start; }
@media (min-width: 1100px) { .gd-art.has-toc { grid-template-columns:minmax(0, 1fr) 236px; } }
.gd-main { min-width:0; max-width:820px; }
.gd-topline { display:flex; flex-wrap:wrap; align-items:center; gap:2px 14px; margin-bottom:6px; min-width:0; }
.gd-back { display:inline-flex; align-items:center; gap:4px; min-height:var(--tap, 44px); font-weight:700; font-size:.88rem; text-decoration:none; }
.gd-topline > .gd-back:only-child, header > .gd-back { margin-bottom:6px; }
.gd-back:hover, .gd-from:hover { text-decoration:underline; }
.gd-from { display:inline-flex; align-items:center; gap:4px; min-height:var(--tap, 44px); max-width:100%; min-width:0; font-weight:800; font-size:.88rem; color:var(--brand-ink, var(--brand)); text-decoration:none; }
.gd-from-t { min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-weight:700; }
.gd-toc .gd-from { display:flex; margin:0 0 8px 8px; font-size:.84rem; }
.gd-skip { position:absolute; left:-9999px; top:auto; }
.gd-skip:focus { position:static; left:auto; min-height:var(--tap, 44px); margin:0 0 10px; }
@media (max-width: 1099.98px) { .gd-skip { display:none; } }
/* 화면 읽기·키보드용으로 제목에 옮긴 포커스는 테두리를 그리지 않아요 (누르는 곳이 아니라서) */
.gd-hero h1[tabindex="-1"]:focus, .gd-prose [tabindex="-1"]:focus { outline:none; }
/* 지금 할 일 (관련 파트 · 기한 지남·오늘·3일 안) */
.gd-now { margin:-6px 0 18px; padding:10px 12px 8px; border:1px solid color-mix(in srgb, var(--warn) 35%, var(--line)); border-radius:12px; background:var(--warn-bg); }
.gd-now-head { display:flex; flex-wrap:wrap; align-items:baseline; gap:2px 8px; margin:0 0 4px; }
.gd-now-head b { font-size:.95rem; }
.gd-now-head span { font-size:var(--fs-min, .75rem); color:var(--ink-2); }
.gd-now-list { list-style:none; margin:0; padding:0; }
.gd-now-row { display:flex; align-items:center; gap:8px; border-top:1px dashed color-mix(in srgb, var(--warn) 30%, var(--line)); }
.gd-now-row:first-child { border-top:0; }
.gd-now-title { flex:1; min-width:0; display:block; min-height:var(--tap, 44px); padding:6px 0; color:var(--ink); font-weight:700; font-size:.9rem; line-height:1.55; text-decoration:none; }
.gd-now-title .chip { margin-right:6px; vertical-align:1px; }
.gd-now-title:hover .gd-now-t { text-decoration:underline; }
.gd-now-sec { flex:none; display:inline-flex; align-items:center; min-height:var(--tap, 44px); padding:0 2px 0 6px; font-size:.82rem; font-weight:750; color:var(--brand-ink, var(--brand)); white-space:nowrap; }
.gd-now-more { display:inline-flex; align-items:center; min-height:var(--tap, 44px); font-size:.84rem; font-weight:750; color:var(--brand-ink, var(--brand)); }
/* 지난 날짜·오늘 (칩, 일정표 줄) */
.gd-prose .chip.gd-past { background:var(--bg-3); color:var(--ink-3); }   /* 흐린 회색 칩 (글자 대비 4.5:1 이상 유지) */
/* 지난 줄은 첫 칸(날짜) 글자만 회색으로 — 줄 전체를 흐리게 하면 링크·칩 대비가 4.5:1 아래로 떨어지고,
   아직 안 끝난 일이 '지난 일'처럼 보여요 */
.gd-prose tr.gd-past > :first-child { color:var(--ink-3); }
.gd-prose tr.gd-today > td, .gd-prose tr.gd-today > th { background:var(--warn-bg); }
.gd-prose tr.gd-today > :first-child { box-shadow:inset 3px 0 0 var(--warn); }
.gd-today-chip { margin-right:4px; color:var(--warn-ink, var(--warn)) !important; }
.gd-hero { display:flex; gap:14px; align-items:flex-start; margin-bottom:10px; }
.gd-hero-ico { flex:none; width:56px; height:56px; border-radius:16px; display:flex; align-items:center; justify-content:center; font-size:1.9rem; background:var(--brand-bg); }
.gd-hero h1 { margin:0 0 4px; font-size:1.55rem; }
.gd-hero-meta { display:flex; flex-wrap:wrap; gap:4px 12px; font-size:.8rem; color:var(--ink-3); }
.gd-summary { color:var(--ink-2); font-size:.98rem; margin:0 0 12px; }
.gd-parts { display:flex; flex-wrap:wrap; gap:6px; margin:0 0 18px; }
.gd-pchip { display:inline-flex; align-items:center; gap:6px; min-height:var(--tap, 44px); padding:4px 12px; border-radius:999px; border:1px solid var(--line); background:var(--bg-2); color:var(--ink); text-decoration:none; font-size:.84rem; font-weight:700; }
.gd-pchip:hover { border-color:var(--brand); }
.gd-pchip-n { color:var(--ink-3); font-weight:650; font-variant-numeric:tabular-nums; }
.gd-pchip.is-complete .gd-pchip-n { color:var(--good-ink, var(--good)); }
.gd-pbadge { display:inline-flex; align-items:center; padding:0 7px; border-radius:999px; font-size:var(--fs-min, .75rem); font-weight:800; line-height:1.6; white-space:nowrap; }
.gd-pbadge.is-bad { background:var(--bad-bg); color:var(--bad); }
.gd-pbadge.is-warn { background:var(--warn-bg); color:var(--warn-ink, var(--warn)); }
@media (max-width: 640px) { .gd-hero-ico { width:46px; height:46px; font-size:1.5rem; border-radius:13px; } .gd-hero h1 { font-size:1.3rem; } }

/* 목차: 오른쪽 고정 */
.gd-toc { position:sticky; top:calc(var(--topbar-h) + 16px); max-height:calc(100vh - var(--topbar-h) - 32px); overflow-y:auto; padding:4px 2px 8px; font-size:.86rem; }
.gd-toc-title { font-size:var(--fs-min, .75rem); font-weight:800; color:var(--ink-3); letter-spacing:.04em; margin:0 0 6px 10px; }
.gd-toc-list { list-style:none; margin:0; padding:0; border-left:2px solid var(--line); }
.gd-toc-list a { display:flex; align-items:center; min-height:36px; padding:4px 10px; margin-left:-2px; border-left:2px solid transparent; color:var(--ink-2); text-decoration:none; line-height:1.4; }
.gd-toc-list a:hover { color:var(--ink); background:var(--bg-3); }
.gd-toc-list a.is-active { color:var(--brand); border-left-color:var(--brand); font-weight:750; background:var(--brand-bg); }
.gd-toc-list .gd-l3 a { padding-left:22px; font-size:.82rem; }
.gd-toc-top { margin:10px 0 0 8px; min-height:36px; }
.gd-btn { min-height:36px; }
@media (max-width: 1099.98px) { .gd-toc { display:none; } }

/* 목차: 접이식 (태블릿·폰) */
.gd-tocm { position:sticky; top:var(--topbar-h); z-index:20; margin:0 0 14px; }
@media (min-width: 1100px) { .gd-tocm { display:none; } }
@media (max-width: 1099.98px) { .gd-tocm.has-from { display:flex; gap:6px; } .gd-tocm.has-from > .gd-tocm-btn { flex:1; min-width:0; } }
.gd-from-m { flex:none; display:inline-flex; align-items:center; min-height:44px; padding:0 12px; border:1px solid var(--line); border-radius:12px; background:color-mix(in srgb, var(--bg-2) 94%, transparent); backdrop-filter:blur(8px); color:var(--brand-ink, var(--brand)); font-size:.86rem; font-weight:800; text-decoration:none; box-shadow:var(--shadow); white-space:nowrap; }
.gd-tocm-btn { display:flex; align-items:center; gap:8px; width:100%; min-height:44px; padding:6px 14px; border:1px solid var(--line); border-radius:12px; background:color-mix(in srgb, var(--bg-2) 94%, transparent); backdrop-filter:blur(8px); color:var(--ink); font:inherit; font-size:.88rem; font-weight:700; text-align:left; cursor:pointer; box-shadow:var(--shadow); }
.gd-tocm-btn .gd-tocm-cur { flex:1; min-width:0; color:var(--ink-3); font-weight:600; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.gd-tocm-btn .gd-tocm-chev { color:var(--ink-3); font-size:.75rem; transition:transform .15s; }
.gd-tocm.is-open .gd-tocm-chev { transform:rotate(180deg); }
.gd-tocm-panel { position:absolute; left:0; right:0; top:calc(100% + 6px); max-height:min(60vh, 460px); overflow-y:auto; background:var(--bg-2); border:1px solid var(--line); border-radius:12px; box-shadow:var(--shadow-lg); padding:6px; }
.gd-tocm-panel .gd-toc-list { border-left:0; }
.gd-tocm-panel .gd-toc-list a { border-left:0; margin:0; border-radius:8px; min-height:40px; display:flex; align-items:center; }

/* 본문 */
.gd-prose { font-size:1rem; line-height:1.75; }
.gd-prose > :first-child { margin-top:0; }
.gd-prose h2 { font-size:1.28rem; margin-top:1.7em; padding-top:1em; border-top:1px solid var(--line); }
.gd-prose > h2:first-child { border-top:0; padding-top:0; }
.gd-prose h3 { font-size:1.06rem; margin-top:1.4em; }
.gd-prose h4 { font-size:.98rem; margin-top:1.2em; }
.gd-prose [id] { scroll-margin-top:calc(var(--topbar-h) + 16px); }
@media (max-width: 1099.98px) { .gd-prose [id] { scroll-margin-top:calc(var(--topbar-h) + 64px); } }
.gd-prose li::marker { color:var(--brand); }
.gd-prose ol > li::marker { font-weight:800; }
.gd-prose hr { border:0; border-top:1px solid var(--line); margin:1.6em 0; }
.gd-prose img, .gd-prose video { max-width:100%; height:auto; border-radius:10px; }
.gd-prose pre { overflow-x:auto; background:var(--bg-3); padding:10px 12px; border-radius:10px; font-size:.86rem; line-height:1.55; }
.gd-prose blockquote { margin:.9em 0; padding:8px 14px; border-left:4px solid var(--line-2); background:var(--bg-3); color:var(--ink-2); border-radius:0 10px 10px 0; }
.gd-prose blockquote > :last-child { margin-bottom:0; }
.gd-prose details { margin:.8em 0; border:1px solid var(--line); border-radius:12px; background:var(--bg-2); padding:0 14px; }
.gd-prose details[open] { padding-bottom:10px; }
.gd-prose summary { cursor:pointer; font-weight:750; min-height:44px; padding:10px 0; display:list-item; }
.gd-prose summary::marker { color:var(--brand); }
.gd-prose details[open] > summary { border-bottom:1px dashed var(--line); margin-bottom:8px; }
.gd-prose dl { margin:0 0 1em; }
.gd-prose dt { font-weight:750; }
.gd-prose dd { margin:0 0 .6em 1em; color:var(--ink-2); }
.gd-prose .chip { vertical-align:1px; }
.gd-prose a.gd-ext::after { content:'↗'; font-size:.78em; margin-left:2px; text-decoration:none; display:inline-block; }
/* 앱 안 이동 링크: 세로 padding 은 줄 배치를 바꾸지 않고 누르는 곳만 키워요.
   크기는 줄 간격에 맞춰요 — 바로 아래 줄 링크의 padding 이 이 링크 글자를 덮으면 엉뚱한 링크가 열려요
   (글자 높이 약 1.2em: 본문 줄 1.75em → .45em, 상자(callout) 줄 1.6em → .3em).
   표(칸·캡션) 6px: 칸·캡션 padding 안쪽이라 표 상자에 세로 스크롤이 생기지 않아요 */
@media (pointer: coarse) {
  .gd-prose a[href^="#/"] { padding-block:.45em; -webkit-box-decoration-break:clone; box-decoration-break:clone; }
  .gd-prose .callout a[href^="#/"] { padding-block:.3em; }
  .gd-prose .gd-tablewrap a[href^="#/"] { padding-block:6px; }
}
.gd-prose .callout { line-height:1.6; }
.gd-tablewrap { overflow-x:auto; -webkit-overflow-scrolling:touch; margin:.7em 0 1.1em; border:1px solid var(--line); border-radius:12px;
  background:
    linear-gradient(to right, var(--bg-2) 30%, transparent) left center / 28px 100% no-repeat local,
    linear-gradient(to left, var(--bg-2) 30%, transparent) right center / 28px 100% no-repeat local,
    radial-gradient(farthest-side at 0 50%, color-mix(in srgb, var(--ink) 22%, transparent), transparent) left center / 12px 100% no-repeat scroll,
    radial-gradient(farthest-side at 100% 50%, color-mix(in srgb, var(--ink) 22%, transparent), transparent) right center / 12px 100% no-repeat scroll,
    var(--bg-2); }
.gd-tablewrap table { width:100%; border-collapse:collapse; margin:0; font-size:.88rem; line-height:1.5; }
.gd-tablewrap th, .gd-tablewrap td { padding:8px 11px; border-bottom:1px solid var(--line); text-align:left; vertical-align:top; overflow-wrap:normal; }
.gd-tablewrap td { min-width:7.5em; }
.gd-tablewrap td.num, .gd-tablewrap td:first-child { min-width:4em; }
.gd-tablewrap thead th { font-size:.78rem; color:var(--ink-2); font-weight:800; white-space:nowrap; background:color-mix(in srgb, var(--bg-3) 70%, transparent); }
.gd-tablewrap tr:last-child td { border-bottom:0; }
.gd-tablewrap td.num, .gd-tablewrap th.num { text-align:right; font-variant-numeric:tabular-nums; white-space:nowrap; }
.gd-tablewrap caption { caption-side:bottom; font-size:.75rem; color:var(--ink-3); padding:6px 10px; text-align:left; }
/* 복사 상자: 단추를 상자 첫 줄 오른쪽에 띄워서 그 줄만 비켜 가요 (모든 줄에 오른쪽 여백을 두지 않음) */
.gd-copywrap { margin:.8em 0; display:flow-root; }
.gd-copywrap > .gd-copy-target { margin:0 !important; }
.gd-copywrap > pre.gd-copy-target { overflow:visible; }
.gd-copywrap > .gd-copybtn { float:right; position:relative; z-index:1; margin:6px 6px 2px 10px; }
.gd-copybtn { display:inline-flex; align-items:center; gap:4px; min-height:var(--tap, 44px); padding:0 10px; border-radius:8px; border:1px solid var(--line-2); background:var(--bg-2); color:var(--ink-2); font:inherit; font-size:.76rem; font-weight:750; cursor:pointer; line-height:1; white-space:nowrap; }
.toast.gd-toast { white-space:nowrap; max-width:calc(100vw - 24px); }
.gd-copybtn:hover { border-color:var(--brand); color:var(--brand); }
.gd-copybtn.is-done { border-color:var(--good); color:var(--good); }
.gd-copybtn.is-inline { min-height:26px; padding:0 7px; margin-left:5px; vertical-align:1px; }
@media (any-pointer: coarse) { .gd-copybtn { min-height:44px; } .gd-copybtn.is-inline { min-height:40px; vertical-align:middle; margin-top:2px; margin-bottom:2px; } }
@keyframes gd-flash { 0%, 35% { background-color:color-mix(in srgb, var(--brand) 20%, transparent); } 100% { background-color:transparent; } }
.gd-flash { animation:gd-flash 2s ease-out; background-clip:content-box; border-radius:6px; }

/* 꼬리말 */
.gd-foot { margin-top:32px; display:flex; flex-direction:column; gap:14px; }
.gd-foot > .card { margin:0; }
.gd-foot h2 { font-size:1rem; margin:0 0 8px; }
.gd-src > summary { display:list-item; min-height:44px; padding:10px 0; cursor:pointer; font-weight:800; font-size:.95rem; }
.gd-src > summary::marker { color:var(--brand); }
.gd-src[open] > summary { margin-bottom:4px; }
.gd-sources { margin:0; padding-left:1.5em; font-size:.86rem; line-height:1.55; }
.gd-sources li + li { margin-top:2px; }
.gd-sources a { display:block; width:fit-content; max-width:100%; padding:8px 0; overflow-wrap:anywhere; }
.gd-sources .gd-src-host { display:inline-block; color:var(--ink-3); font-size:.78rem; margin-left:6px; }   /* inline-block: 링크 밑줄이 안 붙음 */
.gd-related { display:grid; grid-template-columns:repeat(auto-fill, minmax(min(100%, 230px), 1fr)); gap:8px; }
.gd-rel { display:flex; flex-direction:column; gap:2px; min-width:0; min-height:56px; padding:9px 14px; border-radius:12px; border:1px solid var(--line); background:var(--bg-2); color:var(--ink); text-decoration:none; }
.gd-rel:hover { border-color:var(--brand); }
.gd-rel small { font-size:var(--fs-min, .75rem); color:var(--ink-3); font-weight:700; }
.gd-rel b { display:flex; align-items:center; gap:6px; font-size:.95rem; min-width:0; }
.gd-rel-name { min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.gd-rel-n { margin-left:auto; flex:none; font-size:.8rem; font-weight:700; color:var(--ink-3); font-variant-numeric:tabular-nums; }
.gd-rel.is-main { background:var(--brand); border-color:var(--brand); color:var(--on-brand); }
.gd-rel.is-main small, .gd-rel.is-main .gd-rel-n { color:var(--on-brand); }   /* 흐리게(opacity) 하면 4.16:1 → 그대로 */
.gd-rel.is-main:hover { filter:brightness(1.05); }
.gd-rel.is-complete .gd-rel-n { color:var(--good-ink, var(--good)); }
.gd-rel.is-main.is-complete .gd-rel-n { color:var(--on-brand); }
.gd-nf-list { display:flex; flex-direction:column; gap:6px; text-align:left; max-width:460px; margin:12px auto 0; }
.gd-nf-list a { display:flex; align-items:center; gap:10px; min-height:44px; padding:6px 12px; border:1px solid var(--line); border-radius:10px; background:var(--bg-2); color:var(--ink); text-decoration:none; font-weight:700; font-size:.9rem; }
.gd-nf-list a:hover { border-color:var(--brand); }
.gd-nf-actions { display:flex; flex-wrap:wrap; gap:8px; justify-content:center; margin-top:12px; }
.gd-pager { display:grid; grid-template-columns:repeat(2, minmax(0, 1fr)); gap:10px; }
.gd-pager a { display:flex; flex-direction:column; gap:2px; padding:10px 14px; border:1px solid var(--line); border-radius:12px; background:var(--bg-2); color:var(--ink); text-decoration:none; min-width:0; min-height:56px; }
.gd-pager a:hover { border-color:var(--brand); }
.gd-pager small { color:var(--ink-3); font-size:var(--fs-min, .75rem); }
.gd-pager b { font-size:.9rem; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.gd-pager .is-next { text-align:right; grid-column:2; }
@media (max-width: 480px) { .gd-pager { grid-template-columns:1fr; } .gd-pager .is-next { grid-column:auto; } }
`);

  /* ======================= 목록 ======================= */
  function partChip(p) {
    return el('span', { class: 'chip' }, (p.emoji || '📌') + ' ' + p.name);
  }
  // 카드의 진행 상황: 'done/total'(10/32)은 날짜처럼 읽혀서 '기한 지남 n · 오늘 n · 남은 n' 으로
  function statChips(s) {
    if (!s.total) return [];
    if (!s.open) return [el('span', { class: 'chip good' }, '✓ 다 끝남')];
    return [
      s.overdue ? el('span', { class: 'chip bad' }, '기한 지남 ' + s.overdue) : null,
      s.today ? el('span', { class: 'chip warn' }, '오늘 ' + s.today) : null,
      el('span', { class: 'chip' }, '남은 ' + s.open),
    ];
  }
  function statLabel(s) {
    if (!s.total) return '';
    if (!s.open) return '다 끝났어요';
    return (s.overdue ? '기한 지남 ' + s.overdue + '개, ' : '') + (s.today ? '오늘 마감 ' + s.today + '개, ' : '') + '남은 일 ' + s.open + '개';
  }
  // 검색어: 한글을 치는 중이면 끝의 낱자(ㄱ-ㅎ·ㅏ-ㅣ)를 떼고 찾아요 ('사다ㄹ' → '사다', 'ㅌ' → 없음)
  const searchTokens = (q) => String(q || '').trim().toLowerCase().split(/\s+/).map((t) => t.replace(/[ᄀ-ᇿㄱ-ㆎ]+$/, '')).filter(Boolean);
  function countIn(hay, t, max) {
    let n = 0;
    let i = hay.indexOf(t);
    while (i !== -1 && n < max) { n++; i = hay.indexOf(t, i + t.length); }
    return n;
  }
  function highlight(text, tokens) {
    const frag = document.createDocumentFragment();
    if (!tokens.length) { frag.appendChild(document.createTextNode(text)); return frag; }
    const low = text.toLowerCase();
    let i = 0;
    while (i < text.length) {
      let best = -1, len = 0;
      tokens.forEach((t) => { const k = low.indexOf(t, i); if (k !== -1 && (best === -1 || k < best)) { best = k; len = t.length; } });
      if (best === -1) { frag.appendChild(document.createTextNode(text.slice(i))); break; }
      if (best > i) frag.appendChild(document.createTextNode(text.slice(i, best)));
      frag.appendChild(el('mark', { class: 'gd-mark' }, text.slice(best, best + len)));
      i = best + len;
    }
    return frag;
  }
  function matchGuide(entry, tokens) {
    const { g, rel } = entry;
    const p = parse(g);
    const title = String(g.title || '').toLowerCase();
    const sum = String(g.summary || '').toLowerCase();
    const pnames = rel.map((x) => x.name).join(' ').toLowerCase();
    const head = title + ' ' + sum + ' ' + pnames;
    const ok = tokens.every((t) => head.includes(t) || p.low.includes(t));
    if (!ok) return null;
    // 관련도: 제목 100 · 요약 40 · 파트 이름 30 · 절 제목 20 · 본문 등장 횟수(최대 10) × 2
    const secLow = p.sections.map((s) => s.text.toLowerCase()).join('\n');
    let score = 0;
    tokens.forEach((t) => {
      if (title.includes(t)) score += 100;
      if (sum.includes(t)) score += 40;
      if (pnames.includes(t)) score += 30;
      if (secLow.includes(t)) score += 20;
      score += 2 * countIn(p.low, t, 10);
    });
    // 본문에서만 찾은 단어가 있으면 그 주변을 보여 주고 그 절로 바로 가게.
    // 검색어가 모두 제목·요약에 있으면 본문 일부만 참고로 보여 주고 글 처음으로 갑니다.
    const onlyBody = tokens.find((t) => !head.includes(t));
    const bodyTok = onlyBody || tokens.find((t) => p.low.includes(t));
    let snip = null, anchor = '';
    if (bodyTok) {
      const at = p.low.indexOf(bodyTok);
      if (at !== -1) {
        const s = Math.max(0, at - 36), e = Math.min(p.text.length, at + bodyTok.length + 56);
        snip = (s > 0 ? '…' : '') + p.text.slice(s, e).trim() + (e < p.text.length ? '…' : '');
        const mk = p.marks.filter((m) => m.at <= at).pop();
        if (mk && onlyBody) { anchor = mk.id; snip = { text: snip, where: mk.text }; } else snip = { text: snip, where: '' };
      }
    }
    return { snip, anchor, score, tok: anchor ? onlyBody : '' };
  }
  function renderIndex(root, ctx) {
    const prevKey = st.lastKey;
    st.lastKey = 'index';
    const savedIdx = readIdxHS();
    if (savedIdx) st.q = savedIdx.q;               // 뒤로/앞으로·새로고침: 그때 검색어 그대로
    else if (!prevKey) { st.q = ''; st.indexScroll = 0; }   // 다른 화면에서 새로 들어옴: 검색어 초기화
    root.appendChild(el('div', { class: 'view-head' },
      el('h1', '📖 가이드'),
      el('span', { class: 'sub' }, '파트별로 꼭 알아야 할 것들을 정리한 노트예요')));
    // 이어 읽기: 이 기기에서 마지막으로 읽던 가이드·절 (7일 지나면 숨김)
    const last = readLast();
    const lastG = last && Date.now() - last.at < LAST_DAYS * 86400000 ? findGuide(last.id) : null;
    if (lastG) {
      root.appendChild(el('a', { class: 'gd-resume', href: guideHash(lastG.id, last.sec || ''), 'aria-label': '이어 읽기: ' + (lastG.title || lastG.id) + (last.secText ? ' · ' + last.secText : '') },
        el('span', { 'aria-hidden': 'true' }, lastG.icon || '📖'),
        el('span', el('small', '이어 읽기'), el('b', String(lastG.title || lastG.id).split(' — ')[0] + (last.secText ? ' · ' + last.secText : ''))),
        el('span', { 'aria-hidden': 'true' }, '→')));
    }
    const input = el('input', { class: 'input', type: 'search', value: st.q, placeholder: '검색: 예) 증여세, 사다리차, 통돌이', 'aria-label': '가이드 검색', enterkeyhint: 'search', autocomplete: 'off' });
    const count = el('div', { class: 'gd-count', 'aria-live': 'polite' });
    const cards = el('div', { class: 'gd-cards' });
    root.appendChild(el('div', { class: 'gd-search', role: 'search' }, el('span', { class: 'gd-search-ico', 'aria-hidden': 'true' }, '🔍'), input));
    root.appendChild(count);
    root.appendChild(cards);
    // 검색 결과를 눌러 열면 본문에서 그 낱말을 표시하고 화면 가운데로 (renderArticle 이 한 번 쓰고 지워요)
    cards.addEventListener('click', (e) => {
      const a = e.target.closest && e.target.closest('a.gd-card');
      if (!a) return;
      st.hit = a.dataset.hitTok ? { id: a.dataset.gid, tok: a.dataset.hitTok } : null;
    });

    const fresh = (s) => { const d = D.diff(s, D.today()); return D.valid(s) && d >= 0 && d <= 3; };
    const md = (s) => { const d = D.parse(s); return d ? (d.getMonth() + 1) + '/' + d.getDate() : ''; };
    const card = (entry, m, tokens, s) => {
      const { g, rel } = entry;
      const done = !tokens.length && s.total > 0 && !s.open;
      const label = (g.title || g.id) + (m.snip && m.snip.where ? ' — ' + m.snip.where + ' 절로' : '') + (statLabel(s) ? ' · ' + statLabel(s) : '');
      const a = el('a', { class: 'card gd-card' + (done ? ' is-done' : ''), href: guideHash(g.id, m.anchor), 'aria-label': label, dataset: { gid: String(g.id) } },
        el('div', { class: 'gd-card-top' },
          el('span', { class: 'gd-card-ico', 'aria-hidden': 'true' }, g.icon || '📄'),
          el('div', { style: { minWidth: '0', flex: '1' } },
            el('h2', { class: 'gd-card-title' }, highlight(String(g.title || g.id), tokens))),
          done ? el('span', { class: 'chip good', style: { flex: 'none' } }, '✓ 다 끝남') : null),
        !done && g.summary ? el('p', { class: 'gd-card-sum' }, highlight(String(g.summary), tokens)) : null,
        m.snip ? el('div', { class: 'gd-card-snip' }, m.snip.where ? el('b', '§ ' + m.snip.where + ' — ') : null, highlight(m.snip.text, tokens)) : null,
        done ? null : el('div', { class: 'gd-card-foot' },
          statChips(s),
          rel.length > 1 ? rel.map((p) => partChip(p)) : null,
          fresh(g.updated) ? el('span', { class: 'gd-card-date' }, md(g.updated) + ' 고침') : null));
      if (m.tok) a.dataset.hitTok = m.tok;
      return a;
    };
    let emptyT = 0;
    const draw = () => {
      clearTimeout(emptyT);
      const all = orderedGuides();
      const tokens = searchTokens(st.q);
      cards.replaceChildren();
      if (!all.length) {
        count.textContent = '';
        cards.appendChild(el('div', { class: 'empty', style: { gridColumn: '1 / -1' } }, el('span', { class: 'big' }, '📖'), '아직 가이드가 없어요. 리서치 내용이 들어오면 여기에 보여요.'));
        return;
      }
      const rows = all.map((entry, k) => ({ entry, k, s: guideStats(entry.g, entry.rel), m: { snip: null, anchor: '', score: 0, tok: '' } }));
      if (tokens.length) {
        // 검색: 관련도 순 (같으면 원래 순서)
        const hits = rows.filter((r) => { const m = matchGuide(r.entry, tokens); if (m) r.m = m; return !!m; })
          .sort((a, b) => (b.m.score - a.m.score) || (a.k - b.k));
        hits.forEach((r) => cards.appendChild(card(r.entry, r.m, tokens, r.s)));
        if (hits.length) { count.textContent = '‘' + st.q.trim() + '’ 검색 결과 ' + hits.length + '개'; return; }
        // 결과 없음: 치는 중에 깜빡이지 않게 잠깐 멈춘 뒤에만 알려요
        count.textContent = '';
        emptyT = setTimeout(() => {
          if (!alive) return;
          count.textContent = '‘' + st.q.trim() + '’ 검색 결과 0개';
          cards.appendChild(el('div', { class: 'empty', style: { gridColumn: '1 / -1' } },
            el('span', { class: 'big' }, '🔎'), '맞는 가이드가 없어요. ',
            el('button', { type: 'button', class: 'btn gd-btn', onclick: () => { st.q = ''; input.value = ''; draw(); saveIdx(); input.focus(); } }, '검색어 지우기')));
        }, 250);
        return;
      }
      // 검색어 없음: 급한 순 (기한 지남 > 오늘 > 곧 마감 > 남은 일), 다 끝난 가이드는 아래로
      const isDone = (r) => r.s.total > 0 && !r.s.open;
      const active = rows.filter((r) => !isDone(r)).sort((a, b) =>
        (b.s.overdue - a.s.overdue) || (b.s.today - a.s.today) || (b.s.soon - a.s.soon) || (b.s.open - a.s.open) || (a.k - b.k));
      const finished = rows.filter(isDone);
      active.forEach((r) => cards.appendChild(card(r.entry, r.m, tokens, r.s)));
      if (finished.length) {
        cards.appendChild(el('h2', { class: 'gd-sec-h' }, '✅ 다 끝난 가이드 ' + finished.length + '개'));
        finished.forEach((r) => cards.appendChild(card(r.entry, r.m, tokens, r.s)));
      }
      count.textContent = '가이드 ' + all.length + '개';
    };
    let alive = true;
    let saveT = 0;
    const saveIdx = () => {
      clearTimeout(saveT);
      const h = MV.parseHash();
      if (!alive || h.name !== 'guide' || h.params.length) return;
      writeHS({ q: st.q, y: Math.round(window.scrollY) }, HS_IDX);
    };
    const saveSoon = () => { clearTimeout(saveT); saveT = setTimeout(saveIdx, 200); };
    window.addEventListener('scroll', saveSoon, { passive: true });
    document.addEventListener('click', saveIdx, true);        // 카드를 눌러 이동하기 직전에 지금 상태 기록
    ctx.onCleanup(() => { alive = false; clearTimeout(saveT); clearTimeout(emptyT); window.removeEventListener('scroll', saveSoon); document.removeEventListener('click', saveIdx, true); });
    input.addEventListener('input', () => { st.q = input.value; draw(); saveSoon(); });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && input.value) { e.preventDefault(); input.value = ''; st.q = ''; draw(); saveSoon(); }
      if (e.key === 'Enter' && !e.isComposing) { const first = cards.querySelector('a.gd-card'); if (first && st.q.trim()) { e.preventDefault(); first.click(); } }
    });
    draw();
    ctx.subscribe((e) => { if (e && e.reset) return; draw(); });   // 파트 이름·이모지 변경 반영 (입력창은 그대로)
    ctx.onCleanup(() => { st.indexScroll = window.scrollY; });
    // 뒤로/앞으로·새로고침 → 그 기록의 위치, 글에서 목록으로 → 전에 보던 위치, 그 밖(새로 들어옴·없는 글) → 맨 위.
    // 같은 목록을 다시 그릴 때(초기화 등)만 그대로 둡니다. (같은 'guide' 화면끼리는 셸이 스크롤을 유지하므로 직접 정해야 함)
    const restoreY = savedIdx && typeof savedIdx.y === 'number' && isFinite(savedIdx.y) ? savedIdx.y
      : prevKey && prevKey.startsWith('g:') ? st.indexScroll
        : prevKey === 'index' ? null : 0;
    if (restoreY != null) requestAnimationFrame(() => window.scrollTo(0, restoreY));
    // 첫 검색 글자가 멈칫하지 않게, 한가할 때 본문을 하나씩 미리 파싱해 둬요 (화면을 떠나면 멈춤)
    const idle = window.requestIdleCallback ? (fn) => window.requestIdleCallback(fn, { timeout: 1500 }) : (fn) => setTimeout(fn, 120);
    const queue = guideList().filter((g) => { const h = cache.get(g.id); return !(h && h.html === String(g.html || '')); });
    const step = () => { if (!alive || !queue.length) return; try { parse(queue.shift()); } catch (e) { /* 무시 */ } idle(step); };
    if (queue.length) setTimeout(() => idle(step), 300);
  }

  /* ======================= 본문 ======================= */
  function decorate(content, g) {
    // 문서의 다른 요소(app 셸)와 id 가 겹치면 이름을 바꾸고 원래 이름 → 새 이름 표를 남깁니다
    const idMap = new Map();
    content.querySelectorAll('[id]').forEach((n) => {
      if (document.getElementById(n.id)) {
        const nid = 'gd-x-' + n.id;
        idMap.set(n.id, nid);
        n.id = nid;
      }
    });
    // 링크: 외부 → 새 창, '#abc' (앱 경로가 아닌 해시) → 본문 안 이동
    content.querySelectorAll('a[href]').forEach((a) => {
      const href = a.getAttribute('href') || '';
      if (/^(https?:)?\/\//i.test(href)) {
        a.target = '_blank'; a.rel = 'noopener noreferrer'; a.classList.add('gd-ext');
      } else if (/^mailto:|^tel:/i.test(href)) {
        /* 그대로 */
      } else if (/^#[^/]/.test(href)) {
        a.dataset.gdAnchor = decodeURIComponentSafe(href.slice(1));
      }
    });
    // 표: 가로 스크롤 감싸기
    content.querySelectorAll('table').forEach((t) => {
      if (t.parentElement && t.parentElement.classList.contains('gd-tablewrap')) return;
      const wrap = el('div', { class: 'gd-tablewrap', tabindex: '0', role: 'region', 'aria-label': '표 (옆으로 밀어 보기)' });
      t.parentNode.insertBefore(wrap, t);
      wrap.appendChild(t);
    });
    // data-copy: 복사 버튼
    content.querySelectorAll('[data-copy]').forEach((n) => {
      const value = n.getAttribute('data-copy') || n.innerText || n.textContent || '';
      const inline = INLINE_TAGS.has(n.tagName);
      const btn = el('button', { type: 'button', class: 'gd-copybtn' + (inline ? ' is-inline' : ''), 'aria-label': '문구 복사', title: '클립보드에 복사' }, inline ? '복사' : '📋 복사');
      btn.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); doCopy(n.getAttribute('data-copy') || value, btn); });
      if (inline || n.tagName === 'TABLE' || n.tagName === 'LI' || n.tagName === 'TD' || n.tagName === 'TH' || n.tagName === 'SUMMARY') {
        if (inline) n.after(btn); else n.appendChild(btn);
      } else {
        const wrap = el('div', { class: 'gd-copywrap' });
        n.parentNode.insertBefore(wrap, n);
        wrap.appendChild(btn);              // 단추를 먼저 두고 오른쪽에 띄워요 (상자 첫 줄만 비켜 감)
        wrap.appendChild(n);
        n.classList.add('gd-copy-target');
      }
    });
    // 지난 날짜 칩은 회색
    content.querySelectorAll('.chip').forEach((c) => {
      const sp = dateSpan(c.textContent);
      if (sp && dayState(sp) === 'past') { c.classList.add('gd-past'); if (!c.title) c.title = '지난 날짜'; }
    });
    // 날짜별 일정표(첫 칸이 'M/D'인 줄이 2개 이상): 오늘 줄은 강조, 지난 줄은 날짜 칸만 회색
    content.querySelectorAll('table').forEach((t) => {
      const rows = [];
      Array.from(t.tBodies).forEach((b) => Array.from(b.rows).forEach((r) => { const sp = r.cells[0] ? dateSpan(r.cells[0].textContent) : null; if (sp) rows.push({ r, sp }); }));
      if (rows.length < 2) return;
      rows.forEach(({ r, sp }) => {
        const s = dayState(sp);
        if (s === 'past') r.classList.add('gd-past');
        else if (s === 'today') {
          r.classList.add('gd-today');
          r.cells[0].insertBefore(el('span', { class: 'chip warn gd-today-chip' }, '오늘'), r.cells[0].firstChild);
        }
      });
    });
    return idMap;
  }
  // 검색어가 처음 나오는 곳(start 제목부터)에 <mark> 를 씌워요. 낱말이 태그로 나뉘어 있으면 못 찾아요 → null
  function markHit(container, start, tok) {
    if (!tok) return null;
    const low = tok.toLowerCase();
    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
    let n = walker.nextNode();
    while (n) {
      const ok = start === n.parentNode || start.contains(n) || (start.compareDocumentPosition(n) & Node.DOCUMENT_POSITION_FOLLOWING);
      if (ok && !(n.parentElement && n.parentElement.closest('.gd-copybtn, .gd-today-chip'))) {
        const k = n.nodeValue.toLowerCase().indexOf(low);
        if (k !== -1) {
          const mid = n.splitText(k);
          mid.splitText(tok.length);
          const mk = el('mark', { class: 'gd-mark gd-hit' });
          mid.parentNode.replaceChild(mk, mid);
          mk.appendChild(mid);
          return mk;
        }
      }
      n = walker.nextNode();
    }
    return null;
  }
  function decodeURIComponentSafe(s) { try { return decodeURIComponent(s); } catch (e) { return s; } }

  function findTarget(container, logical, idMap) {
    if (!logical) return null;
    const tryId = (id) => (id ? container.querySelector('[id="' + cssEsc(idMap.get(id) || id) + '"]') : null);
    let t = tryId(logical) || tryId(slugify(logical));
    if (!t) {
      const low = String(logical).toLowerCase().replace(/-/g, ' ');
      t = Array.from(container.querySelectorAll('h2, h3, h4')).find((h) => h.textContent.toLowerCase().includes(low)) || null;
    }
    return t;
  }
  function openParents(t) {
    let n = t;
    while (n && n !== document.body) {
      if (n.tagName === 'DETAILS' && !n.open) n.open = true;
      n = n.parentElement;
    }
  }
  function flash(t) {
    const target = t.tagName === 'DETAILS' ? (t.querySelector('summary') || t) : t;
    target.classList.remove('gd-flash');
    void target.offsetWidth;   // 애니메이션 다시 시작
    target.classList.add('gd-flash');
    setTimeout(() => target.classList.remove('gd-flash'), 2100);
  }

  function renderNotFound(root, rawId) {
    st.lastKey = 'missing';
    // 파트 id 로 들어왔는데 가이드가 아직 없으면: 그 파트 체크리스트 + 같은 묶음(group)의 가이드를 대신 권합니다
    const part = MV.parts.get(rawId);
    const all = orderedGuides();
    let near = [];
    if (part) {
      near = all.filter((x) => x.rel.some((p) => p.id !== part.id && (p.group || '') === (part.group || '')));
    }
    if (!near.length) near = all.slice(0, 3);
    near = near.slice(0, 4);
    root.appendChild(el('a', { class: 'gd-back', href: '#/guide' }, '← 가이드 목록'));
    root.appendChild(el('div', { class: 'card' },
      el('div', { class: 'empty' },
        el('span', { class: 'big' }, part ? (part.emoji || '🧭') : '🧭'),
        el('p', { class: 'strong', style: { color: 'var(--ink)' } }, part
          ? '‘' + part.name + '’ 가이드는 아직 준비 중이에요.'
          : '찾는 가이드가 없어요.'),
        el('p', { class: 'small' }, part
          ? '할 일과 메모는 체크리스트에서 바로 관리할 수 있어요.'
          : '아직 작성 중이거나 이름이 바뀌었을 수 있어요.'),
        el('div', { class: 'gd-nf-actions' },
          part ? el('a', { class: 'btn btn-primary', href: '#/checklist/' + encodeURIComponent(part.id) }, (part.emoji || '📌') + ' ' + part.name + ' 체크리스트로 →') : null,
          el('a', { class: 'btn' + (part ? '' : ' btn-primary'), href: '#/guide' }, '가이드 목록 보기')),
        near.length ? el('div', { class: 'gd-nf-list', 'aria-label': '관련 가이드' },
          el('div', { class: 'tiny muted' }, part ? '같이 보면 좋은 가이드' : '다른 가이드'),
          near.map((x) => el('a', { href: guideHash(x.g.id) }, el('span', { 'aria-hidden': 'true' }, x.g.icon || '📄'), String(x.g.title || x.g.id)))) : null)));
    window.scrollTo(0, 0);
  }

  function renderArticle(root, rawId, rawAnchor, ctx) {
    const r = resolve(rawId, rawAnchor);
    if (!r.g) { renderNotFound(root, String(rawId).split('#')[0]); return; }
    const g = r.g;
    const anchor = r.anchor;
    if (r.redirected || String(rawId).includes('#')) {
      try { history.replaceState(history.state, '', guideHash(g.id, anchor)); } catch (e) { /* 무시 */ }
    }
    const key = 'g:' + g.id;
    const prevKey = st.lastKey;
    st.lastKey = key;
    const suppressed = Date.now() < suppressAnchorUntil;
    const saved = readHS(g.id);
    const hit = st.hit && st.hit.id === String(g.id) ? st.hit : null;   // 검색 결과에서 열었을 때만, 한 번
    st.hit = null;
    let alive = true;
    ctx.onCleanup(() => { alive = false; });
    // 할 일 상세에서 바로 왔으면 '← 할 일로' (뒤로 가기 = 그 할 일, 열린 상세·스크롤까지 체크리스트가 되살려요)
    const fromHash = st.from;
    const fromItem = fromHash ? itemFromHash(fromHash) : null;
    const backToItem = (e) => {
      if (e && (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey)) return;
      if (e) e.preventDefault();
      const before = window.location.hash;
      let moved = false;
      const onHash = () => { moved = true; };
      window.addEventListener('hashchange', onHash);
      try { history.back(); } catch (err) { /* 무시 */ }
      setTimeout(() => { window.removeEventListener('hashchange', onHash); if (!moved && window.location.hash === before) MV.go(fromHash); }, 450);
    };
    const fromLink = (cls, short) => el('a', { class: cls, href: fromHash, onclick: backToItem, 'aria-label': '할 일로 돌아가기: ' + cleanTitle(fromItem.title) },
      short ? '← 할 일' : ['← 할 일로: ', el('span', { class: 'gd-from-t' }, cleanTitle(fromItem.title))]);

    const p = parse(g);
    const content = el('div', { class: 'prose gd-prose' });
    content.appendChild(document.importNode(p.tpl.content, true));
    const idMap = decorate(content, g);
    const sections = p.sections.map((s) => ({ ...s, el: content.querySelector('[id="' + cssEsc(idMap.get(s.id) || s.id) + '"]') })).filter((s) => s.el);

    /* 머리 */
    const all = orderedGuides();
    const idx = all.findIndex((x) => x.g === g);
    const rel = idx >= 0 ? all[idx].rel : relatedParts(g);
    const minutes = Math.max(1, Math.round(p.text.length / 600));
    const partsBox = el('div', { class: 'gd-parts', 'aria-label': '관련 체크리스트' });
    const relatedBox = el('div', { class: 'gd-related' });
    const nowBox = el('section', { class: 'gd-now', 'aria-label': '지금 할 일', hidden: true });
    const leftLabel = (s, complete) => (complete ? '✓ 다 끝남' : s.total ? '남은 ' + (s.total - s.done) : '');
    const PRI = { high: 0, mid: 1, low: 2 };
    const pri = (it) => (PRI[it.priority] != null ? PRI[it.priority] : 1);
    // 지금 할 일: 관련 파트에서 안 끝났고 오늘·기한 지남·3일 안에 마감 (폰 3개, 넓은 화면 5개)
    // 순서: 오늘(중요도 순) → 기한 지남(최근 것부터) → 3일 안(가까운 것부터). 며칠 체크를 못 해도 오늘 할 일이 밀려나지 않게.
    const RANK = { today: 0, overdue: 1, soon: 2 };
    const cmpStr = (x, y) => (x < y ? -1 : x > y ? 1 : 0);
    const fillNow = (parts) => {
      const ids = new Set(parts.map((pt) => pt.id));
      // 별첨처럼 파트를 빌려 쓰는 가이드는 이 가이드로 이어진 할 일만 (통장업무 할 일을 HUG 별첨 위에 올리지 않게)
      const pool = !parts.length ? [] : ownsParts(g, parts) ? MV.items.list((it) => ids.has(it.partId) && !it.done) : linkedItems(g).filter((it) => !it.done);
      const list = pool
        .map((it) => ({ it, s: MV.items.status(it) }))
        .filter((x) => x.s === 'overdue' || x.s === 'today' || x.s === 'soon')
        .sort((a, b) => (RANK[a.s] - RANK[b.s])
          || (a.s === 'today' ? pri(a.it) - pri(b.it) : 0)
          || (a.s === 'overdue' ? cmpStr(b.it.due, a.it.due) : cmpStr(a.it.due, b.it.due))
          || (pri(a.it) - pri(b.it)));
      nowBox.hidden = !list.length;
      if (!list.length) { nowBox.replaceChildren(); return; }
      const max = window.matchMedia && window.matchMedia('(max-width: 640px)').matches ? 3 : 5;
      // 파트가 하나면 그 파트 목록(여기 숨긴 일이 다 있어요), 여럿이면 체크리스트 '지금 할 일'(7일·모든 파트라 개수가 달라서 개수는 안 써요)
      const one = parts.length === 1;
      const allHref = one ? '#/checklist/' + encodeURIComponent(parts[0].id) : '#/checklist/~focus';
      const hiddenN = list.length - Math.min(max, list.length);
      nowBox.replaceChildren(
        el('div', { class: 'gd-now-head' }, el('b', '🔥 지금 할 일 ' + list.length + '개'), el('span', '오늘 · 기한 지남 · 3일 안에 마감')),
        el('ul', { class: 'gd-now-list' }, list.slice(0, max).map(({ it }) => {
          const [gid, ga] = String(it.guide || '').split('#');
          const sec = gid === String(g.id) && ga && findTarget(content, ga, idMap) ? ga : '';
          return el('li', { class: 'gd-now-row' },
            el('a', { class: 'gd-now-title', href: '#/checklist/' + encodeURIComponent(it.partId) + '/' + encodeURIComponent(it.id) },
              MV.ui.dueChip(it.due, false), el('span', { class: 'gd-now-t' }, cleanTitle(it.title))),
            sec ? el('a', { class: 'gd-now-sec', href: guideHash(g.id, sec), 'aria-label': '이 가이드에서 읽기: ' + cleanTitle(it.title),
              onclick: (e) => { if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return; e.preventDefault(); goAnchor(sec); } }, '이 절 읽기') : null);
        })),
        el('a', { class: 'gd-now-more', href: allHref },
          !one ? '체크리스트 ‘🔥 지금 할 일’에서 모두 보기 →' : hiddenN ? '외 ' + hiddenN + '개 더 — 체크리스트에서 보기 →' : '체크리스트에서 보기 →'));
    };
    const fillParts = () => {
      const fresh = idx >= 0 ? relatedParts(g) : rel;
      partsBox.replaceChildren(...fresh.map((pt) => {
        const s = MV.parts.stats(pt.id);
        const complete = s.total > 0 && s.done === s.total;
        const aria = pt.name + ' 체크리스트 · ' + (complete ? '다 끝났어요' : '남은 일 ' + (s.total - s.done) + '개') + (s.overdue ? ' · 기한 지남 ' + s.overdue + '개' : '') + (s.today ? ' · 오늘 마감 ' + s.today + '개' : '');
        return el('a', { class: 'gd-pchip' + (complete ? ' is-complete' : ''), href: '#/checklist/' + encodeURIComponent(pt.id), title: pt.name + ' 체크리스트로', 'aria-label': aria },
          el('span', { 'aria-hidden': 'true' }, pt.emoji || '📌'), pt.name,
          el('span', { class: 'gd-pchip-n' }, leftLabel(s, complete)),
          s.overdue ? el('span', { class: 'gd-pbadge is-bad' }, '기한 지남 ' + s.overdue) : null,
          s.today ? el('span', { class: 'gd-pbadge is-warn' }, '오늘 ' + s.today) : null);
      }));
      partsBox.hidden = !fresh.length;
      relatedBox.replaceChildren(...fresh.map((pt, i) => {
        const s = MV.parts.stats(pt.id);
        const complete = s.total > 0 && s.done === s.total;
        return el('a', { class: 'gd-rel' + (i === 0 ? ' is-main' : '') + (complete ? ' is-complete' : ''), href: '#/checklist/' + encodeURIComponent(pt.id), 'aria-label': '이 가이드 관련 체크리스트로: ' + pt.name + ' · ' + (complete ? '다 끝났어요' : '남은 일 ' + (s.total - s.done) + '개') },
          el('small', '이 가이드 관련 체크리스트로 →'),
          el('b', el('span', { 'aria-hidden': 'true' }, pt.emoji || '📌'), el('span', { class: 'gd-rel-name' }, pt.name),
            el('span', { class: 'gd-rel-n' }, leftLabel(s, complete))));
      }));
      fillNow(fresh);
    };
    fillParts();

    const h1 = el('h1', String(g.title || g.id));
    const header = el('header', null,
      el('div', { class: 'gd-topline' },
        fromItem ? fromLink('gd-from', false) : null,
        el('a', { class: 'gd-back', href: '#/guide' }, fromItem ? '가이드 목록' : '← 가이드 목록')),
      el('div', { class: 'gd-hero' },
        el('span', { class: 'gd-hero-ico', 'aria-hidden': 'true' }, g.icon || '📄'),
        el('div', { style: { minWidth: '0' } },
          h1,
          el('div', { class: 'gd-hero-meta' },
            D.valid(g.updated) ? el('span', D.fmt(g.updated) + ' 고침') : null,
            el('span', '읽는 데 약 ' + minutes + '분'),
            sections.length ? el('span', '목차 ' + sections.filter((s) => s.level === 2).length + '개') : null))),
      // 키보드: 제목 다음 Tab 한 번이면 오른쪽 목차로 (넓은 화면에서만, 포커스를 받을 때만 보여요)
      sections.length >= 2 ? el('button', { type: 'button', class: 'btn btn-sm gd-skip', onclick: () => { const a = root.querySelector('.gd-toc .gd-toc-list a'); if (a) a.focus(); } }, '목차로 건너뛰기') : null,
      g.summary ? el('p', { class: 'gd-summary' }, String(g.summary)) : null,
      partsBox,
      nowBox);

    /* 목차 */
    const tocLinks = [];      // [{id, a}] 데스크톱 + 접이식 둘 다
    let closeMobile = () => {};
    let spyLock = 0, spyTimer = 0;
    const goAnchor = (logical, opts) => {
      opts = opts || {};
      const t = findTarget(content, logical, idMap);
      if (!t) return false;
      openParents(t);
      if (!opts.instant && !reduceMotion()) spyLock = Date.now() + 900;   // 부드러운 스크롤 중엔 목차 강조가 흔들리지 않게
      t.scrollIntoView({ behavior: opts.instant || reduceMotion() ? 'auto' : 'smooth', block: 'start' });
      if (opts.updateHash !== false) {
        try { history.replaceState(history.state, '', guideHash(g.id, logical)); } catch (e) { /* 무시 */ }
      }
      if (opts.flash !== false) flash(t);
      if (opts.focus !== false) focusQuiet(t);      // 키보드·화면 읽기: 그 절에서 이어 읽게
      return true;
    };
    // 절 → 속한 h2 (폰 목차는 h2 와 지금 읽는 h2 의 h3 만 보여요)
    const parentOf = new Map();
    let lastH2 = null;
    sections.forEach((s) => { if (s.level === 2) lastH2 = s.id; parentOf.set(s.id, s.level === 2 ? s.id : lastH2); });
    const panelH3 = [];       // [{li, parent}]
    const tocList = (inPanel) => el('ul', { class: 'gd-toc-list' }, sections.map((s) => {
      const a = el('a', { href: guideHash(g.id, s.id), dataset: { sec: s.id } }, s.text);
      a.addEventListener('click', (e) => {
        if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
        e.preventDefault();
        closeMobile();
        goAnchor(s.id);
        setActive(s.id);
      });
      tocLinks.push({ id: s.id, a });
      const li = el('li', { class: 'gd-l' + s.level }, a);
      if (inPanel && s.level === 3 && parentOf.get(s.id)) { li.hidden = true; panelH3.push({ li, parent: parentOf.get(s.id) }); }
      return li;
    }));
    let aside = null, mobile = null, mobileCur = null, panel = null;
    if (sections.length >= 2) {
      aside = el('aside', { class: 'gd-toc', 'aria-label': '목차' },
        fromItem ? fromLink('gd-from', false) : null,
        el('div', { class: 'gd-toc-title' }, '목차'),
        tocList(false),
        el('button', { type: 'button', class: 'btn btn-sm btn-ghost gd-toc-top', onclick: () => { window.scrollTo({ top: 0, behavior: reduceMotion() ? 'auto' : 'smooth' }); try { history.replaceState(history.state, '', guideHash(g.id)); } catch (e) { /* 무시 */ } } }, '↑ 맨 위로'));
      mobileCur = el('span', { class: 'gd-tocm-cur' }, '처음');
      panel = el('nav', { class: 'gd-tocm-panel', 'aria-label': '목차', hidden: true }, tocList(true));
      const btn = el('button', { type: 'button', class: 'gd-tocm-btn', 'aria-expanded': 'false' },
        el('span', { 'aria-hidden': 'true' }, '☰'), el('span', '목차'), mobileCur, el('span', { class: 'gd-tocm-chev', 'aria-hidden': 'true' }, '▼'));
      mobile = el('div', { class: 'gd-tocm' + (fromItem ? ' has-from' : '') }, fromItem ? fromLink('gd-from-m', true) : null, btn, panel);
      const setOpen = (open) => {
        panel.hidden = !open;
        btn.setAttribute('aria-expanded', String(open));
        mobile.classList.toggle('is-open', open);
        if (open) {
          const act = panel.querySelector('a.is-active');
          if (act) panel.scrollTop = Math.max(0, act.offsetTop - panel.clientHeight / 3);
        }
      };
      closeMobile = () => setOpen(false);
      btn.addEventListener('click', () => setOpen(panel.hidden));
      const onDoc = (e) => { if (!panel.hidden && !mobile.contains(e.target)) setOpen(false); };
      const onKey = (e) => { if (e.key === 'Escape' && !panel.hidden) { setOpen(false); btn.focus(); } };
      document.addEventListener('pointerdown', onDoc);
      document.addEventListener('keydown', onKey);
      ctx.onCleanup(() => { document.removeEventListener('pointerdown', onDoc); document.removeEventListener('keydown', onKey); });
    }
    let activeId = null;
    function setActive(id) {
      if (id === activeId) return;
      activeId = id;
      tocLinks.forEach((x) => {
        const on = x.id === id;
        x.a.classList.toggle('is-active', on);
        if (on) x.a.setAttribute('aria-current', 'location'); else x.a.removeAttribute('aria-current');
      });
      const s = sections.find((x) => x.id === id);
      if (mobileCur) mobileCur.textContent = s ? s.text : '처음';
      const curH2 = id ? parentOf.get(id) : null;
      panelH3.forEach((x) => { x.li.hidden = x.parent !== curH2; });
      const act = aside && aside.querySelector('a.is-active');
      if (act && aside.scrollHeight > aside.clientHeight) {
        const ar = aside.getBoundingClientRect(), r2 = act.getBoundingClientRect();
        if (r2.top < ar.top || r2.bottom > ar.bottom) aside.scrollTop += r2.top - ar.top - ar.height / 3;
      }
    }
    // 스크롤 위치에 따라 현재 절 표시
    const topOffset = () => {
      const tb = document.querySelector('.topbar');
      let off = tb ? tb.getBoundingClientRect().bottom : 56;
      if (mobile && mobile.offsetParent !== null) off += mobile.getBoundingClientRect().height + 8;
      return off + 12;
    };
    let raf = 0;
    const spy = () => {
      raf = 0;
      if (!alive || !sections.length) return;
      const wait = spyLock - Date.now();
      if (wait > 0) {
        clearTimeout(spyTimer);
        spyTimer = setTimeout(() => { if (alive) spy(); }, wait + 40);
        return;
      }
      const off = topOffset();
      let cur = null;
      for (const s of sections) {
        if (!s.el.isConnected) continue;
        if (s.el.getBoundingClientRect().top - off <= 28) cur = s; else break;
      }
      if (!cur && (window.innerHeight + window.scrollY) >= document.documentElement.scrollHeight - 2) cur = sections[sections.length - 1];
      setActive(cur ? cur.id : null);      // 첫 제목 앞(도입부)을 읽는 중이면 '처음'
    };
    const onScroll = () => { if (!raf) raf = requestAnimationFrame(spy); };
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll, { passive: true });
    ctx.onCleanup(() => { window.removeEventListener('scroll', onScroll); window.removeEventListener('resize', onScroll); if (raf) cancelAnimationFrame(raf); clearTimeout(spyTimer); });

    // 본문 안의 해시 링크 (#abc, #/guide/<같은 id>/abc) 는 화면을 다시 그리지 않고 이동
    content.addEventListener('click', (e) => {
      const a = e.target.closest && e.target.closest('a[href]');
      if (!a || !content.contains(a) || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      let logical = a.dataset.gdAnchor || null;
      if (!logical) {
        const m = /^#\/guide\/([^/]+)\/(.+)$/.exec(a.getAttribute('href') || '');
        if (m && decodeURIComponentSafe(m[1]) === String(g.id)) logical = decodeURIComponentSafe(m[2]);
      }
      if (logical && findTarget(content, logical, idMap)) { e.preventDefault(); goAnchor(logical); }
    });

    /* 꼬리말 */
    const srcs = (Array.isArray(g.sources) ? g.sources : []).filter((s) => s && (s.url || s.label));
    const host = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch (e) { return ''; } };
    const prev = idx > 0 ? all[idx - 1].g : null;
    const next = idx >= 0 && idx < all.length - 1 ? all[idx + 1].g : null;
    // 순서: 관련 체크리스트 → 이전/다음 가이드 → 출처(접어 둠)
    const foot = el('footer', { class: 'gd-foot' },
      rel.length ? el('section', { class: 'card flat tint-brand', 'aria-label': '관련 체크리스트' },
        el('h2', '✅ 관련 체크리스트'),
        el('p', { class: 'small muted', style: { margin: '-2px 0 10px' } }, '읽은 내용을 바로 체크리스트에 옮겨 두세요. 메모·마감일도 거기서 관리해요.'),
        relatedBox) : null,
      prev || next ? el('nav', { class: 'gd-pager', 'aria-label': '다른 가이드' },
        prev ? el('a', { href: guideHash(prev.id) }, el('small', '← 이전 가이드'), el('b', (prev.icon || '📄') + ' ' + (prev.title || prev.id))) : null,
        next ? el('a', { class: 'is-next', href: guideHash(next.id) }, el('small', '다음 가이드 →'), el('b', (next.icon || '📄') + ' ' + (next.title || next.id))) : null) : null,
      srcs.length ? el('details', { class: 'card flat gd-src' },
        el('summary', '📚 출처 ' + srcs.length + '개'),
        el('ol', { class: 'gd-sources' }, srcs.map((s) => el('li',
          s.url && /^https?:\/\//i.test(s.url)
            ? el('a', { href: s.url, target: '_blank', rel: 'noopener noreferrer' }, String(s.label || s.url), host(s.url) && s.label ? el('span', { class: 'gd-src-host' }, host(s.url)) : null)
            : String(s.label || s.url))))) : null);

    const main = el('article', { class: 'gd-main' }, header, mobile, content, foot);
    root.appendChild(el('div', { class: 'gd-art' + (aside ? ' has-toc' : '') }, main, aside));

    // 기록이 바뀌면(체크·다른 기기 동기화) 머리의 파트 칩·지금 할 일만 다시 그려요.
    // 머리가 화면 위로 지나간 뒤라면 높이가 바뀐 만큼 스크롤을 보정해 읽던 곳이 밀리지 않게 해요
    // (스크롤 앵커링이 없는 iOS Safari 대비. 브라우저가 이미 맞췄으면 차이가 0이라 아무것도 안 해요)
    const refresh = () => {
      if (!alive) return;
      const tb = document.querySelector('.topbar');
      const lim = tb ? tb.getBoundingClientRect().bottom : 0;
      const before = content.isConnected ? content.getBoundingClientRect().top : NaN;
      fillParts();
      if (!(before < lim)) return;
      const d = content.getBoundingClientRect().top - before;
      if (Math.abs(d) >= 1) window.scrollBy(0, d);
    };
    ctx.subscribe((e) => { if (e && e.reset) return; refresh(); });

    // 읽던 위치 저장: 스크롤이 멈출 때 + 링크를 누르는 순간(해시가 바뀌기 전)
    const here = () => { const h = MV.parseHash(); return alive && h.name === 'guide' && String(h.params[0] || '') === String(g.id); };
    const saveNow = () => {
      if (!here()) return;
      const det = [];
      content.querySelectorAll('details').forEach((d, i) => { if (d.open) det.push(i); });
      writeHS({ id: String(g.id), y: Math.round(window.scrollY), det });
      // 이어 읽기 (이 기기에만): 첫 제목을 지나 읽고 있을 때만 적어요
      const s = activeId ? sections.find((x) => x.id === activeId) : null;
      if (s) writeLast({ id: String(g.id), sec: s.id, secText: s.text, at: Date.now() });
    };
    let saveT = 0;
    const saveSoon = () => { clearTimeout(saveT); saveT = setTimeout(saveNow, 180); };
    const flushSave = () => { clearTimeout(saveT); saveNow(); };
    window.addEventListener('scroll', saveSoon, { passive: true });
    document.addEventListener('click', flushSave, true);
    content.addEventListener('toggle', saveSoon, true);
    ctx.onCleanup(() => { clearTimeout(saveT); window.removeEventListener('scroll', saveSoon); document.removeEventListener('click', flushSave, true); });

    // MV.rerender 가 스크롤을 정리한 다음 프레임에 위치 잡기
    requestAnimationFrame(() => {
      if (!alive) return;
      // 창 제목: 가이드 이름 (셸이 그린 뒤에 덮어써요)
      document.title = String(g.title || g.id).split(' — ')[0] + ' · 가이드 · 우리집 이사 관리';
      const fresh = prevKey !== key;
      if (saved && !suppressed) {
        // 뒤로 가기·새로고침: 펼쳐 둔 접이식 내용과 읽던 위치 그대로
        const dets = content.querySelectorAll('details');
        (Array.isArray(saved.det) ? saved.det : []).forEach((i) => { if (dets[i]) dets[i].open = true; });
        window.scrollTo(0, saved.y);
      } else if (anchor && !suppressed) {
        // 검색 결과에서 왔으면 그 절에서 검색어가 처음 나오는 곳을 표시하고 화면 가운데로
        const t = hit ? findTarget(content, anchor, idMap) : null;
        const mk = t ? markHit(content, t, hit.tok) : null;
        if (mk) {
          openParents(mk);
          mk.scrollIntoView({ block: 'center' });
          focusQuiet(t);
        } else {
          const ok = goAnchor(anchor, { instant: true, updateHash: false });
          if (!ok) {
            if (fresh) window.scrollTo(0, 0);
            MV.ui.toast('그 부분을 찾지 못해 글 처음부터 보여 드려요.');
            if (fresh) focusQuiet(h1);
          }
        }
      } else if (fresh && !suppressed) {
        window.scrollTo(0, 0);
        focusQuiet(h1);
      }
      spy();
    });
  }

  MV.view('guide', {
    title: '가이드', short: '가이드', icon: '📖', order: 60,
    ownScroll: true,      // 읽던 위치·앵커는 이 화면이 직접 정해요 (셸의 뒤로 가기 스크롤 기억을 쓰지 않음)
    render(root, params, ctx) {
      ctx.onCleanup(() => { if (MV.parseHash().name !== 'guide') st.lastKey = null; });
      const id = params && params[0];
      if (!id) renderIndex(root, ctx);
      else renderArticle(root, id, params.slice(1).join('/'), ctx);
    },
  });
})();
