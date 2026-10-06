/* ============================================================
   우리집 이사 관리 — 가이드 뷰어
   MV.guides (data-guides-*.js) 를 목록·본문으로 보여 줍니다.
   #/guide                  → 목록 (검색: 제목·요약·본문)
   #/guide/<id>             → 본문
   #/guide/<id>/<anchor>    → 본문 + 해당 위치로 이동 (잠깐 강조)
     · '<id>#<anchor>' 형태(체크 항목의 guide 필드 그대로)도 받아 줍니다.
     · 가이드 id 대신 파트 id 가 오면 그 파트의 guide 로 연결합니다.
   본문 처리: h2/h3 목차(데스크톱 오른쪽 고정, 폰은 접이식), 넓은 표 가로 스크롤,
             외부 링크 새 창, data-copy="문구" 요소에 '복사' 버튼, 출처·관련 체크리스트.
   CSS 접두사: gd-
   ============================================================ */
(function () {
  'use strict';
  const { el } = MV;
  const D = MV.date;

  const SIDE_MQ = '(min-width: 1100px)';     // 이 이상이면 목차를 오른쪽에 고정
  const INLINE_TAGS = new Set(['SPAN', 'CODE', 'A', 'B', 'STRONG', 'EM', 'I', 'KBD', 'MARK', 'SMALL', 'U', 'S', 'SUB', 'SUP', 'ABBR', 'TIME', 'LABEL']);

  /* ---------- 모듈 상태 ---------- */
  const st = { q: '', indexScroll: 0, lastKey: null };
  const cache = new Map();                 // guide id → 파싱 결과 (html 이 같을 때만 재사용)
  let suppressAnchorUntil = 0;
  // 초기화·복원·다른 탭 동기화로 화면이 통째로 다시 그려질 때는 앵커로 튀지 않게.
  // (app.js 보다 먼저 등록되므로 rerender 전에 실행됩니다)
  MV.store.on('change', (e) => { if (e && e.reset) suppressAnchorUntil = Date.now() + 600; });

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

  /* 파싱: <template> 안에서 (이미지 로드·스크립트 실행 없이) 목차용 id 를 붙이고 본문 텍스트를 뽑습니다. */
  function parse(g) {
    const html = String(g.html || '');
    const hit = cache.get(g.id);
    if (hit && hit.html === html) return hit;
    const tpl = document.createElement('template');
    tpl.innerHTML = html;
    const frag = tpl.content;
    frag.querySelectorAll('script').forEach((s) => s.remove());
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
      MV.ui.toast('복사했어요. 메시지 창에 붙여 넣으세요.');
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
.gd-cards { display:grid; gap:12px; grid-template-columns:repeat(auto-fill, minmax(min(100%, 300px), 1fr)); }
.gd-cards > .card { margin:0; }
.gd-card { display:flex; flex-direction:column; gap:8px; color:var(--ink); text-decoration:none; min-width:0; transition:border-color .12s, transform .08s; }
.gd-card:hover { border-color:var(--brand); }
.gd-card:active { transform:translateY(1px); }
.gd-card-top { display:flex; align-items:flex-start; gap:12px; }
.gd-card-ico { flex:none; width:44px; height:44px; border-radius:12px; display:flex; align-items:center; justify-content:center; font-size:1.5rem; background:var(--bg-3); }
.gd-card-title { font-weight:800; font-size:1.02rem; line-height:1.35; margin:2px 0 0; }
.gd-card-sum { color:var(--ink-2); font-size:.88rem; line-height:1.5; margin:0; display:-webkit-box; -webkit-line-clamp:3; -webkit-box-orient:vertical; overflow:hidden; }
.gd-card-snip { font-size:.8rem; color:var(--ink-3); background:var(--bg); border-radius:8px; padding:6px 9px; line-height:1.5; }
.gd-card-snip b { color:var(--ink-2); font-weight:700; }
.gd-card-foot { display:flex; flex-wrap:wrap; gap:4px; align-items:center; margin-top:auto; padding-top:4px; }
.gd-card-date { margin-left:auto; font-size:.72rem; color:var(--ink-3); white-space:nowrap; }
.gd-mark { background:color-mix(in srgb, var(--warn) 28%, transparent); color:inherit; border-radius:3px; padding:0 1px; }

/* 본문 레이아웃 */
.gd-art { display:grid; grid-template-columns:minmax(0, 1fr); gap:28px; align-items:start; }
@media (min-width: 1100px) { .gd-art.has-toc { grid-template-columns:minmax(0, 1fr) 236px; } }
.gd-main { min-width:0; max-width:820px; }
.gd-back { display:inline-flex; align-items:center; gap:4px; min-height:36px; font-weight:700; font-size:.88rem; text-decoration:none; margin-bottom:6px; }
.gd-back:hover { text-decoration:underline; }
.gd-hero { display:flex; gap:14px; align-items:flex-start; margin-bottom:10px; }
.gd-hero-ico { flex:none; width:56px; height:56px; border-radius:16px; display:flex; align-items:center; justify-content:center; font-size:1.9rem; background:var(--brand-bg); }
.gd-hero h1 { margin:0 0 4px; font-size:1.55rem; }
.gd-hero-meta { display:flex; flex-wrap:wrap; gap:4px 12px; font-size:.8rem; color:var(--ink-3); }
.gd-summary { color:var(--ink-2); font-size:.98rem; margin:0 0 12px; }
.gd-parts { display:flex; flex-wrap:wrap; gap:6px; margin:0 0 18px; }
.gd-pchip { display:inline-flex; align-items:center; gap:6px; min-height:36px; padding:4px 12px; border-radius:999px; border:1px solid var(--line); background:var(--bg-2); color:var(--ink); text-decoration:none; font-size:.84rem; font-weight:700; }
.gd-pchip:hover { border-color:var(--brand); }
.gd-pchip-n { color:var(--ink-3); font-weight:650; font-variant-numeric:tabular-nums; }
.gd-pchip.is-complete .gd-pchip-n { color:var(--good); }
.gd-pchip .badge { height:18px; min-width:18px; }
@media (max-width: 640px) { .gd-hero-ico { width:46px; height:46px; font-size:1.5rem; border-radius:13px; } .gd-hero h1 { font-size:1.3rem; } }

/* 목차: 오른쪽 고정 */
.gd-toc { position:sticky; top:calc(var(--topbar-h) + 16px); max-height:calc(100vh - var(--topbar-h) - 32px); overflow-y:auto; padding:4px 2px 8px; font-size:.86rem; }
.gd-toc-title { font-size:.74rem; font-weight:800; color:var(--ink-3); letter-spacing:.04em; margin:0 0 6px 10px; }
.gd-toc-list { list-style:none; margin:0; padding:0; border-left:2px solid var(--line); }
.gd-toc-list a { display:block; padding:5px 10px; margin-left:-2px; border-left:2px solid transparent; color:var(--ink-2); text-decoration:none; line-height:1.4; }
.gd-toc-list a:hover { color:var(--ink); background:var(--bg-3); }
.gd-toc-list a.is-active { color:var(--brand); border-left-color:var(--brand); font-weight:750; background:var(--brand-bg); }
.gd-toc-list .gd-l3 a { padding-left:22px; font-size:.82rem; }
.gd-toc-top { margin:10px 0 0 8px; }
@media (max-width: 1099.98px) { .gd-toc { display:none; } }

/* 목차: 접이식 (태블릿·폰) */
.gd-tocm { position:sticky; top:var(--topbar-h); z-index:20; margin:0 0 14px; }
@media (min-width: 1100px) { .gd-tocm { display:none; } }
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
.gd-prose .callout { line-height:1.6; }
.gd-tablewrap { overflow-x:auto; -webkit-overflow-scrolling:touch; margin:.7em 0 1.1em; border:1px solid var(--line); border-radius:12px;
  background:
    linear-gradient(to right, var(--bg-2) 30%, transparent) left center / 28px 100% no-repeat local,
    linear-gradient(to left, var(--bg-2) 30%, transparent) right center / 28px 100% no-repeat local,
    radial-gradient(farthest-side at 0 50%, color-mix(in srgb, var(--ink) 22%, transparent), transparent) left center / 12px 100% no-repeat scroll,
    radial-gradient(farthest-side at 100% 50%, color-mix(in srgb, var(--ink) 22%, transparent), transparent) right center / 12px 100% no-repeat scroll,
    var(--bg-2); }
.gd-tablewrap table { width:100%; border-collapse:collapse; margin:0; font-size:.88rem; line-height:1.5; }
.gd-tablewrap th, .gd-tablewrap td { padding:8px 11px; border-bottom:1px solid var(--line); text-align:left; vertical-align:top; overflow-wrap:normal; min-width:4.5em; }
.gd-tablewrap thead th { font-size:.78rem; color:var(--ink-2); font-weight:800; white-space:nowrap; background:color-mix(in srgb, var(--bg-3) 70%, transparent); }
.gd-tablewrap tr:last-child td { border-bottom:0; }
.gd-tablewrap td.num, .gd-tablewrap th.num { text-align:right; font-variant-numeric:tabular-nums; white-space:nowrap; }
.gd-tablewrap caption { caption-side:bottom; font-size:.75rem; color:var(--ink-3); padding:6px 10px; text-align:left; }
.gd-copywrap { position:relative; margin:.8em 0; }
.gd-copywrap > .gd-copy-target { margin:0 !important; padding-right:76px !important; }
.gd-copywrap > .gd-copybtn { position:absolute; top:7px; right:7px; }
.gd-copybtn { display:inline-flex; align-items:center; gap:4px; min-height:30px; padding:0 10px; border-radius:8px; border:1px solid var(--line-2); background:var(--bg-2); color:var(--ink-2); font:inherit; font-size:.76rem; font-weight:750; cursor:pointer; line-height:1; white-space:nowrap; }
.gd-copybtn:hover { border-color:var(--brand); color:var(--brand); }
.gd-copybtn.is-done { border-color:var(--good); color:var(--good); }
.gd-copybtn.is-inline { min-height:26px; padding:0 7px; margin-left:5px; vertical-align:1px; }
@media (pointer: coarse) { .gd-copybtn { min-height:36px; } .gd-copybtn.is-inline { min-height:32px; } }
@keyframes gd-flash { 0%, 30% { background:color-mix(in srgb, var(--brand) 22%, transparent); box-shadow:0 0 0 6px color-mix(in srgb, var(--brand) 22%, transparent); } 100% { background:transparent; box-shadow:0 0 0 6px transparent; } }
.gd-flash { animation:gd-flash 2s ease-out; border-radius:6px; }

/* 꼬리말 */
.gd-foot { margin-top:32px; display:flex; flex-direction:column; gap:14px; }
.gd-foot > .card { margin:0; }
.gd-foot h2 { font-size:1rem; margin:0 0 8px; }
.gd-sources { margin:0; padding-left:1.5em; font-size:.86rem; line-height:1.55; }
.gd-sources li + li { margin-top:4px; }
.gd-sources a { overflow-wrap:anywhere; }
.gd-sources .gd-src-host { color:var(--ink-3); font-size:.78rem; margin-left:4px; }
.gd-related { display:flex; flex-wrap:wrap; gap:8px; }
.gd-related .btn { min-height:42px; }
.gd-pager { display:grid; grid-template-columns:repeat(2, minmax(0, 1fr)); gap:10px; }
.gd-pager a { display:flex; flex-direction:column; gap:2px; padding:10px 14px; border:1px solid var(--line); border-radius:12px; background:var(--bg-2); color:var(--ink); text-decoration:none; min-width:0; min-height:56px; }
.gd-pager a:hover { border-color:var(--brand); }
.gd-pager small { color:var(--ink-3); font-size:.74rem; }
.gd-pager b { font-size:.9rem; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.gd-pager .is-next { text-align:right; grid-column:2; }
@media (max-width: 480px) { .gd-pager { grid-template-columns:1fr; } .gd-pager .is-next { grid-column:auto; } }
`);

  /* ======================= 목록 ======================= */
  function partChip(p, withProgress) {
    const s = withProgress ? MV.parts.stats(p.id) : null;
    return el('span', { class: 'chip' }, (p.emoji || '📌') + ' ' + p.name + (s ? ' ' + s.done + '/' + s.total : ''));
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
    const head = (String(g.title || '') + ' ' + String(g.summary || '') + ' ' + rel.map((x) => x.name).join(' ')).toLowerCase();
    const ok = tokens.every((t) => head.includes(t) || p.low.includes(t));
    if (!ok) return null;
    // 본문에서만 찾은 단어가 있으면 그 주변을 보여 주고, 그 절로 바로 가게
    const bodyTok = tokens.find((t) => !head.includes(t)) || tokens.find((t) => p.low.includes(t));
    let snip = null, anchor = '';
    if (bodyTok) {
      const at = p.low.indexOf(bodyTok);
      if (at !== -1) {
        const s = Math.max(0, at - 36), e = Math.min(p.text.length, at + bodyTok.length + 56);
        snip = (s > 0 ? '…' : '') + p.text.slice(s, e).trim() + (e < p.text.length ? '…' : '');
        const mk = p.marks.filter((m) => m.at <= at).pop();
        if (mk) { anchor = mk.id; snip = { text: snip, where: mk.text }; } else snip = { text: snip, where: '' };
      }
    }
    return { snip, anchor };
  }
  function renderIndex(root, ctx) {
    const prevKey = st.lastKey;
    st.lastKey = 'index';
    root.appendChild(el('div', { class: 'view-head' },
      el('h1', '📖 가이드'),
      el('span', { class: 'sub' }, '파트별로 꼭 알아야 할 것들을 정리한 노트예요')));
    const input = el('input', { class: 'input', type: 'search', value: st.q, placeholder: '검색: 예) 증여세, 사다리차, 통돌이', 'aria-label': '가이드 검색', enterkeyhint: 'search', autocomplete: 'off' });
    const count = el('div', { class: 'gd-count', 'aria-live': 'polite' });
    const cards = el('div', { class: 'gd-cards' });
    root.appendChild(el('div', { class: 'gd-search', role: 'search' }, el('span', { class: 'gd-search-ico', 'aria-hidden': 'true' }, '🔍'), input));
    root.appendChild(count);
    root.appendChild(cards);

    const draw = () => {
      const all = orderedGuides();
      const tokens = st.q.trim().toLowerCase().split(/\s+/).filter(Boolean);
      cards.replaceChildren();
      if (!all.length) {
        count.textContent = '';
        cards.appendChild(el('div', { class: 'empty', style: { gridColumn: '1 / -1' } }, el('span', { class: 'big' }, '📖'), '아직 가이드가 없어요. 리서치 내용이 들어오면 여기에 보입니다.'));
        return;
      }
      let shown = 0;
      all.forEach((entry) => {
        let m = { snip: null, anchor: '' };
        if (tokens.length) { m = matchGuide(entry, tokens); if (!m) return; }
        shown++;
        const { g, rel } = entry;
        cards.appendChild(el('a', { class: 'card gd-card', href: guideHash(g.id, m.anchor), 'aria-label': (g.title || g.id) + (m.snip && m.snip.where ? ' — ' + m.snip.where + ' 절로' : '') },
          el('div', { class: 'gd-card-top' },
            el('span', { class: 'gd-card-ico', 'aria-hidden': 'true' }, g.icon || '📄'),
            el('div', { style: { minWidth: '0' } },
              el('h2', { class: 'gd-card-title' }, highlight(String(g.title || g.id), tokens)))),
          g.summary ? el('p', { class: 'gd-card-sum' }, highlight(String(g.summary), tokens)) : null,
          m.snip ? el('div', { class: 'gd-card-snip' }, m.snip.where ? el('b', '§ ' + m.snip.where + ' — ') : null, highlight(m.snip.text, tokens)) : null,
          el('div', { class: 'gd-card-foot' },
            rel.map((p) => partChip(p, false)),
            g.updated ? el('span', { class: 'gd-card-date' }, '업데이트 ' + g.updated) : null)));
      });
      count.textContent = tokens.length ? '‘' + st.q.trim() + '’ 검색 결과 ' + shown + '개' : '가이드 ' + all.length + '개';
      if (tokens.length && !shown) {
        cards.appendChild(el('div', { class: 'empty', style: { gridColumn: '1 / -1' } },
          el('span', { class: 'big' }, '🔎'), '맞는 가이드가 없어요. ',
          el('button', { type: 'button', class: 'btn btn-sm', onclick: () => { st.q = ''; input.value = ''; draw(); input.focus(); } }, '검색어 지우기')));
      }
    };
    input.addEventListener('input', () => { st.q = input.value; draw(); });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && input.value) { e.preventDefault(); input.value = ''; st.q = ''; draw(); }
      if (e.key === 'Enter' && !e.isComposing) { const first = cards.querySelector('a.gd-card'); if (first && st.q.trim()) { e.preventDefault(); first.click(); } }
    });
    draw();
    ctx.subscribe((e) => { if (e && e.reset) return; draw(); });   // 파트 이름·이모지 변경 반영 (입력창은 그대로)
    ctx.onCleanup(() => { st.indexScroll = window.scrollY; });
    if (prevKey && prevKey.startsWith('g:')) {
      const y = st.indexScroll;
      requestAnimationFrame(() => window.scrollTo(0, y));
    }
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
        wrap.appendChild(n);
        n.classList.add('gd-copy-target');
        wrap.appendChild(btn);
      }
    });
    return idMap;
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
    root.appendChild(el('a', { class: 'gd-back', href: '#/guide' }, '← 가이드 목록'));
    root.appendChild(el('div', { class: 'card' },
      el('div', { class: 'empty' },
        el('span', { class: 'big' }, '🧭'),
        el('p', { class: 'strong', style: { color: 'var(--ink)' } }, '“' + rawId + '” 가이드를 찾지 못했어요.'),
        el('p', { class: 'small' }, '아직 작성 중이거나 이름이 바뀌었을 수 있어요.'),
        el('a', { class: 'btn btn-primary', href: '#/guide' }, '가이드 목록 보기'))));
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
    let alive = true;
    ctx.onCleanup(() => { alive = false; });

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
    const fillParts = () => {
      const fresh = idx >= 0 ? relatedParts(g) : rel;
      partsBox.replaceChildren(...fresh.map((pt) => {
        const s = MV.parts.stats(pt.id);
        const complete = s.total > 0 && s.done === s.total;
        return el('a', { class: 'gd-pchip' + (complete ? ' is-complete' : ''), href: '#/checklist/' + encodeURIComponent(pt.id), title: pt.name + ' 체크리스트로', 'aria-label': pt.name + ' 체크리스트 · ' + s.total + '개 중 ' + s.done + '개 완료' },
          el('span', { 'aria-hidden': 'true' }, pt.emoji || '📌'), pt.name,
          el('span', { class: 'gd-pchip-n' }, s.done + '/' + s.total + (complete ? ' ✓' : '')),
          s.overdue ? el('span', { class: 'badge', title: '기한 지난 항목' }, String(s.overdue)) : null);
      }));
      partsBox.hidden = !fresh.length;
      relatedBox.replaceChildren(...fresh.map((pt) => {
        const s = MV.parts.stats(pt.id);
        return el('a', { class: 'btn' + (fresh.length === 1 ? ' btn-primary' : ''), href: '#/checklist/' + encodeURIComponent(pt.id), 'aria-label': pt.name + ' 체크리스트로 이동 · ' + s.total + '개 중 ' + s.done + '개 완료' },
          fresh.length === 1
            ? '이 가이드 관련 체크리스트로 → ' + (pt.emoji || '📌') + ' ' + s.done + '/' + s.total
            : (pt.emoji || '📌') + ' ' + pt.name + ' ' + s.done + '/' + s.total + ' →');
      }));
    };
    fillParts();

    const header = el('header', null,
      el('a', { class: 'gd-back', href: '#/guide' }, '← 가이드 목록'),
      el('div', { class: 'gd-hero' },
        el('span', { class: 'gd-hero-ico', 'aria-hidden': 'true' }, g.icon || '📄'),
        el('div', { style: { minWidth: '0' } },
          el('h1', String(g.title || g.id)),
          el('div', { class: 'gd-hero-meta' },
            g.updated ? el('span', '업데이트 ' + g.updated) : null,
            el('span', '읽는 데 약 ' + minutes + '분'),
            sections.length ? el('span', '목차 ' + sections.filter((s) => s.level === 2).length + '개') : null))),
      g.summary ? el('p', { class: 'gd-summary' }, String(g.summary)) : null,
      partsBox);

    /* 목차 */
    const tocLinks = [];      // [{id, a}] 데스크톱 + 접이식 둘 다
    let closeMobile = () => {};
    const goAnchor = (logical, opts) => {
      opts = opts || {};
      const t = findTarget(content, logical, idMap);
      if (!t) return false;
      openParents(t);
      t.scrollIntoView({ behavior: opts.instant || reduceMotion() ? 'auto' : 'smooth', block: 'start' });
      if (opts.updateHash !== false) {
        try { history.replaceState(history.state, '', guideHash(g.id, logical)); } catch (e) { /* 무시 */ }
      }
      if (opts.flash !== false) flash(t);
      return true;
    };
    const tocList = () => el('ul', { class: 'gd-toc-list' }, sections.map((s) => {
      const a = el('a', { href: guideHash(g.id, s.id), dataset: { sec: s.id } }, s.text);
      a.addEventListener('click', (e) => {
        if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
        e.preventDefault();
        closeMobile();
        goAnchor(s.id);
        setActive(s.id);
      });
      tocLinks.push({ id: s.id, a });
      return el('li', { class: 'gd-l' + s.level }, a);
    }));
    let aside = null, mobile = null, mobileCur = null;
    if (sections.length >= 2) {
      aside = el('aside', { class: 'gd-toc', 'aria-label': '목차' },
        el('div', { class: 'gd-toc-title' }, '목차'),
        tocList(),
        el('button', { type: 'button', class: 'btn btn-sm btn-ghost gd-toc-top', onclick: () => { window.scrollTo({ top: 0, behavior: reduceMotion() ? 'auto' : 'smooth' }); try { history.replaceState(history.state, '', guideHash(g.id)); } catch (e) { /* 무시 */ } } }, '↑ 맨 위로'));
      mobileCur = el('span', { class: 'gd-tocm-cur' }, sections[0].text);
      const panel = el('nav', { class: 'gd-tocm-panel', 'aria-label': '목차', hidden: true }, tocList());
      const btn = el('button', { type: 'button', class: 'gd-tocm-btn', 'aria-expanded': 'false' },
        el('span', { 'aria-hidden': 'true' }, '☰'), el('span', '목차'), mobileCur, el('span', { class: 'gd-tocm-chev', 'aria-hidden': 'true' }, '▼'));
      mobile = el('div', { class: 'gd-tocm' }, btn, panel);
      const setOpen = (open) => {
        panel.hidden = !open;
        btn.setAttribute('aria-expanded', String(open));
        mobile.classList.toggle('is-open', open);
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
      if (mobileCur) mobileCur.textContent = s ? s.text : sections[0].text;
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
      const off = topOffset();
      let cur = null;
      for (const s of sections) {
        if (!s.el.isConnected) continue;
        if (s.el.getBoundingClientRect().top - off <= 4) cur = s; else break;
      }
      if (!cur && (window.innerHeight + window.scrollY) >= document.documentElement.scrollHeight - 2) cur = sections[sections.length - 1];
      setActive(cur ? cur.id : sections[0].id);
    };
    const onScroll = () => { if (!raf) raf = requestAnimationFrame(spy); };
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll, { passive: true });
    ctx.onCleanup(() => { window.removeEventListener('scroll', onScroll); window.removeEventListener('resize', onScroll); if (raf) cancelAnimationFrame(raf); });

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
    const foot = el('footer', { class: 'gd-foot' },
      srcs.length ? el('section', { class: 'card flat', 'aria-label': '출처' },
        el('h2', '📚 출처'),
        el('ol', { class: 'gd-sources' }, srcs.map((s) => el('li',
          s.url && /^https?:\/\//i.test(s.url)
            ? [el('a', { href: s.url, target: '_blank', rel: 'noopener noreferrer' }, String(s.label || s.url)), host(s.url) && s.label ? el('span', { class: 'gd-src-host' }, host(s.url)) : null]
            : String(s.label || s.url))))) : null,
      rel.length ? el('section', { class: 'card flat tint-brand', 'aria-label': '관련 체크리스트' },
        el('h2', '✅ 관련 체크리스트'),
        el('p', { class: 'small muted', style: { margin: '-2px 0 10px' } }, '읽은 내용을 바로 체크리스트에 옮겨 두세요. 메모·마감일도 거기서 관리해요.'),
        relatedBox) : null,
      prev || next ? el('nav', { class: 'gd-pager', 'aria-label': '다른 가이드' },
        prev ? el('a', { href: guideHash(prev.id) }, el('small', '← 이전 가이드'), el('b', (prev.icon || '📄') + ' ' + (prev.title || prev.id))) : null,
        next ? el('a', { class: 'is-next', href: guideHash(next.id) }, el('small', '다음 가이드 →'), el('b', (next.icon || '📄') + ' ' + (next.title || next.id))) : null) : null);

    const main = el('article', { class: 'gd-main' }, header, mobile, content, foot);
    root.appendChild(el('div', { class: 'gd-art' + (aside ? ' has-toc' : '') }, main, aside));

    ctx.subscribe((e) => { if (e && e.reset) return; if (alive) fillParts(); });

    // MV.rerender 가 스크롤을 정리한 다음 프레임에 위치 잡기
    requestAnimationFrame(() => {
      if (!alive) return;
      if (anchor && !suppressed) {
        const ok = goAnchor(anchor, { instant: true, updateHash: false });
        if (!ok) {
          if (prevKey !== key) window.scrollTo(0, 0);
          MV.ui.toast('‘' + anchor + '’ 위치를 찾지 못해 처음부터 보여 드려요.');
        }
      } else if (prevKey !== key && !suppressed) {
        window.scrollTo(0, 0);
      }
      spy();
    });
  }

  MV.view('guide', {
    title: '가이드', short: '가이드', icon: '📖', order: 60,
    render(root, params, ctx) {
      const id = params && params[0];
      if (!id) renderIndex(root, ctx);
      else renderArticle(root, id, params.slice(1).join('/'), ctx);
    },
  });
})();
