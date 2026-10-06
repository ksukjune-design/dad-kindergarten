/* ============================================================
   우리집 이사 관리 — 대시보드 (홈)
   "지금 뭘 해야 하지? 일정대로 가고 있나?" 에 답하는 첫 화면.
   섹션: 히어로(D-day·진행률) / 지금 할 일 / 주간 워크플랜 / 11/3 돈 흐름 / 이사 견적 /
         파트별 진행 / 최근 활동 / 바로가기
         (데스크톱은 '지금 할 일' 옆에 돈 흐름·견적을 두고, 한 줄로 쌓이는 화면에선 위 순서대로)
   주간 워크플랜: 주마다 이정표 + 중요 FLAG_LIMIT 개 + 파트 묶음 ROW_BUDGET 줄, 나머지는 '+n'·파트 칩으로 펼침.
   - 데이터는 MV.items / MV.parts / MV.inv / MV.calc.* 만 읽고, 체크는 MV.items.toggle 로.
   - 저장소 변경 시 스크롤·가로 스크롤·펼침 상태·포커스를 유지한 채 다시 그립니다.
     다시 그리기는 다음 프레임 뒤에, 내용이 바뀐 카드·줄·주 칸만 바꿔 끼웁니다 (patchNode — 태블릿 가로 화면 체크 속도).
   - 11/3 돈 흐름: 머리 숫자는 '꼭 필요한 현금 기준'(financeSummary.netEssential), 아래 작은 줄에 살림 구입까지 / 전부 포함.
     자금 모듈이 없으면 가족 결정(2026-10-06)을 반영한 계획값으로 같은 모양을 그림.
   - 이사 견적: 자금·LG 비교와 같은 '실제로 낼 돈'(moveEstimate.pay, 부가세 포함), LG 이전설치는 따로.
   CSS 접두사: db-
   ============================================================ */
(function () {
  'use strict';
  const { el } = MV;
  const D = MV.date;

  const LEASE_END = '2026-11-18';            // 원래 전세 만기 (계약서 기준, 고정)
  const PRI = { high: 0, mid: 1, low: 2 };
  const OWNER_CLS = { '나': '', '아내': 'kid', '함께': 'think' };
  const FLAG_LIMIT = 3;                      // 주간 칸 맨 위 '중요' 깃발 수 (나머지 중요 항목은 파트 묶음 안에 ⚑)
  const ROW_BUDGET = 7;                      // 주간 칸에서 파트 묶음으로 먼저 보여 줄 항목 수 (나머지는 '+n' / 파트 칩)
  const KEEP_DONE = 2;                       // '지금 할 일'에 줄 그어 남겨 둘 '방금 완료' 항목 수
  const ACC_MQ = '(max-width: 860px)';       // 이 너비 이하면 주간 워크플랜을 아코디언으로

  /* ---------- 모듈 UI 상태 (화면 안에서만 유지) ---------- */
  const ui = {
    openWeeks: null,          // 아코디언에서 펼친 주 (Set of key)
    roadScroll: 0,            // 가로 스크롤 위치
    moreGroups: new Set(),    // '+n' / 파트 칩으로 펼친 (주|파트)
    partCols: 1,              // '파트별 진행' 칸 수 (너비로 정함)
  };
  let sessionDone = new Map(); // 이 화면에서 방금 완료한 항목 id → 완료 시각 (최근 KEEP_DONE 개만 자리에 남김)
  let undoBatch = null;        // 연달아 체크할 때 되돌리기 토스트 하나로 묶기 {toast, entries}
  let persistUi = () => {};    // render 가 연결: 펼침 상태가 바뀌면 지금 기록(history)에 저장

  /* ---------- 작은 도우미 ---------- */
  const isNum = (n) => typeof n === 'number' && isFinite(n);
  const normDate = (s) => (D.valid(s) ? D.str(D.parse(s)) : null);
  const dueKey = (i) => normDate(i.due) || '9999-12-31';
  const md = (s) => { const d = D.parse(s); return d ? (d.getMonth() + 1) + '/' + d.getDate() : ''; };
  const clip = (s, n) => { s = String(s == null ? '' : s); return s.length > n ? s.slice(0, n - 1) + '…' : s; };
  const itemHref = (i) => '#/checklist/' + encodeURIComponent(i.partId || '_') + '/' + encodeURIComponent(i.id);
  const partHref = (id) => '#/checklist/' + encodeURIComponent(id);
  function byDue(a, b) {
    const da = dueKey(a), dbb = dueKey(b);
    if (da !== dbb) return da < dbb ? -1 : 1;
    const pa = PRI[a.priority] != null ? PRI[a.priority] : 1;
    const pb = PRI[b.priority] != null ? PRI[b.priority] : 1;
    if (pa !== pb) return pa - pb;
    return (a.order || 0) - (b.order || 0);
  }
  function partMap() {
    const m = new Map();
    MV.parts.list().forEach((p) => m.set(p.id, p));
    return m;
  }
  const partOf = (pm, id) => pm.get(id) || { id: id || '', name: '기타', emoji: '📌', group: '기타' };
  // 이사일 (백업 복원 등으로 값이 깨져 있으면 null)
  const moveDay = () => normDate(D.moveDate());
  function milestones() {
    const move = moveDay();
    const list = [{ date: LEASE_END, label: '원래 전세 만기', icon: '📄' }];
    if (move) {
      list.push({ date: D.add(move, -1), label: '가전 선이동(예정)', icon: '🔌' });
      list.push({ date: move, label: '이사·잔금·전입신고', icon: '🚚', main: true });
    }
    return list.sort((a, b) => (a.date < b.date ? -1 : 1));
  }
  // 바로가기용: 가이드 id → 파트의 guide 필드 → partIds 로 찾고, 없으면 그 파트 체크리스트로
  function guideLink(key) {
    const guides = (Array.isArray(MV.guides) ? MV.guides : []).filter((g) => g && g.id != null && g.id !== '');
    const byId = (id) => guides.find((g) => String(g.id) === String(id));
    const part = MV.parts.get(key);
    let g = byId(key), anchor = '';
    if (!g && part && part.guide) {
      const k = String(part.guide).split('#');
      g = byId(k[0]); anchor = k[1] || '';
    }
    if (!g) g = guides.find((x) => Array.isArray(x.partIds) && x.partIds.map(String).includes(key));
    if (g) return { href: '#/guide/' + encodeURIComponent(g.id) + (anchor ? '/' + encodeURIComponent(anchor) : ''), guide: true };
    if (part) return { href: partHref(key), guide: false };
    return { href: '#/guide', guide: false };
  }
  /* 뒤로 가기로 돌아왔을 때 스크롤·펼친 주를 되살리기 위해, 지금 대시보드 기록(history entry)에 화면 상태를 적어 둡니다.
     새로 들어온 기록(메뉴 클릭 등)엔 상태가 없으니 맨 위·기본 펼침으로 시작합니다. */
  const HS_KEY = 'mvDash';
  function readHS() {
    try {
      const s = history.state;
      const v = s && typeof s === 'object' ? s[HS_KEY] : null;
      return v && typeof v === 'object' ? v : null;
    } catch (e) { return null; }
  }
  function writeHS(v) {
    try {
      const s = history.state;
      const base = s && typeof s === 'object' && !Array.isArray(s) ? s : {};
      history.replaceState(Object.assign({}, base, { [HS_KEY]: v }), '');
    } catch (e) { /* 무시 */ }
  }
  function relWeek(ws, moveW) {
    if (!moveW) return '';
    const k = Math.round(D.diff(ws, moveW) / 7);
    if (k > 0) return '이사 ' + k + '주 전';
    if (k === 0) return '이사 주간';
    return '이사 ' + (-k) + '주 후';
  }
  function head(icon, title, sub, more, key) {
    return el('div', { class: 'db-head', dataset: key ? { dbKey: key } : null },
      el('h2', el('span', { class: 'db-head-ico', 'aria-hidden': 'true' }, icon), title),
      sub ? el('span', { class: 'db-head-sub' }, sub) : null,
      more || null);
  }
  const moreLink = (label, href) => el('a', { class: 'db-more', href }, label);
  function safe(cls, fn) {
    try { return fn(); } catch (e) {
      console.error('[dashboard]', e);
      return el('section', { class: 'card ' + cls }, el('p', { class: 'small muted mb-0' }, '이 영역을 그리다 문제가 생겼어요: ' + ((e && e.message) || e)));
    }
  }

  /* ---------- 스타일 ---------- */
  MV.css('db', `
.toast.db-toast { white-space:nowrap; max-width:calc(100vw - 24px); }
.toast.db-toast > span { min-width:0; max-width:calc(100vw - 150px); overflow:hidden; text-overflow:ellipsis; }
.toast.db-toast > button { flex:none; min-height:36px; }
.db-sr { position:absolute; width:1px; height:1px; overflow:hidden; clip:rect(0 0 0 0); white-space:nowrap; }
.db-grid { display:grid; gap:14px; grid-template-columns:repeat(12, minmax(0, 1fr)); align-items:stretch; }
.db-grid > .card, .db-side > .card { margin:0; min-width:0; }
.db-span-12 { grid-column:1 / -1; }
.db-span-7 { grid-column:span 7; }
.db-span-5 { grid-column:span 5; }
.db-side { grid-column:span 5; display:grid; gap:14px; align-content:start; align-items:stretch; min-width:0; }
@media (max-width: 1100px) {
  .db-span-7, .db-span-5 { grid-column:1 / -1; }
  .db-side { grid-column:1 / -1; grid-template-columns:repeat(2, minmax(0, 1fr)); }
  /* 한 줄로 쌓일 때 스펙 순서: 히어로 → 지금 할 일 → 주간 워크플랜 → 돈 흐름·견적 → 파트별 → 최근 활동 → 바로가기 */
  .db-grid > .db-late { order:2; }
}
@media (max-width: 680px) { .db-side { grid-template-columns:1fr; } .db-grid { gap:12px; } }

.db-head { display:flex; align-items:center; gap:6px 10px; flex-wrap:wrap; margin-bottom:10px; min-height:36px; }
.db-head h2 { margin:0; font-size:1.02rem; display:flex; align-items:center; gap:7px; }
.db-head-ico { font-size:1.05rem; }
.db-head-sub { color:var(--ink-3); font-size:.8rem; }
@media (max-width: 420px) { .db-now-sub { display:none; } }
.db-more { margin-left:auto; display:inline-flex; align-items:center; min-height:36px; padding:0 4px; font-size:.85rem; font-weight:700; text-decoration:none; white-space:nowrap; }
.db-more:hover { text-decoration:underline; }

/* 히어로 */
.db-hero { padding:20px 22px; background:linear-gradient(135deg, var(--brand-bg) 0%, var(--bg-2) 64%); border-color:color-mix(in srgb, var(--brand) 22%, var(--line)); }
.db-hero-grid { display:grid; grid-template-columns:minmax(0, 1.05fr) minmax(0, 1fr); gap:18px 32px; align-items:center; }
@media (max-width: 760px) { .db-hero { padding:16px; } .db-hero-grid { grid-template-columns:1fr; } }
.db-eyebrow { font-size:.82rem; font-weight:800; color:var(--brand); letter-spacing:.01em; }
.db-big { font-size:clamp(2.8rem, 10vw, 4.4rem); font-weight:900; line-height:1.02; letter-spacing:-.045em; color:var(--ink); font-variant-numeric:tabular-nums; margin:2px 0 4px; }
.db-big small { font-size:.36em; font-weight:800; margin-left:6px; color:var(--ink-2); letter-spacing:0; }
.db-big.is-today { font-size:clamp(2.2rem, 8vw, 3.4rem); color:var(--brand); }
.db-when { font-weight:700; color:var(--ink-2); }
.db-route { display:flex; align-items:center; flex-wrap:wrap; gap:4px 8px; margin-top:8px; font-weight:750; }
.db-route-arrow { color:var(--brand); font-weight:900; }
.db-route-area { color:var(--ink-3); font-size:.8rem; font-weight:650; }
.db-prog-top { display:flex; align-items:baseline; gap:10px; flex-wrap:wrap; margin-bottom:6px; }
.db-prog-label { font-weight:800; font-size:.9rem; }
.db-prog-num { font-size:1.7rem; font-weight:900; letter-spacing:-.03em; font-variant-numeric:tabular-nums; line-height:1; }
.db-prog-sub { color:var(--ink-3); font-size:.85rem; font-variant-numeric:tabular-nums; }
.db-hero .progress { height:10px; background:color-mix(in srgb, var(--ink) 9%, transparent); }
.db-counters { display:flex; flex-wrap:wrap; gap:8px; margin-top:12px; }
.db-counter { display:inline-flex; align-items:center; gap:7px; min-height:36px; padding:4px 13px; border-radius:999px; text-decoration:none; font-weight:700; font-size:.86rem; background:var(--bg-2); color:var(--ink-2); border:1px solid var(--line); }
.db-counter b { font-size:1.02rem; font-variant-numeric:tabular-nums; }
.db-counter-note { font-size:.72rem; font-weight:650; opacity:.8; }
.db-counter:hover { border-color:var(--line-2); }
.db-counter.is-bad { background:var(--bad-bg); color:var(--bad); border-color:color-mix(in srgb, var(--bad) 30%, transparent); }
.db-counter.is-warn { background:var(--warn-bg); color:var(--warn); border-color:color-mix(in srgb, var(--warn) 30%, transparent); }
.db-counter.is-brand { background:var(--brand-bg); color:var(--brand); border-color:color-mix(in srgb, var(--brand) 30%, transparent); }
.db-next { margin-top:10px; font-size:.85rem; color:var(--ink-2); display:flex; flex-wrap:wrap; align-items:center; gap:2px 8px; }
.db-next b { color:var(--ink); }
.db-next-label { white-space:nowrap; }
.db-next-what { display:inline-flex; align-items:center; flex-wrap:wrap; gap:2px 6px; min-width:0; }
.db-dchip { display:inline-flex; align-items:center; padding:0 8px; border-radius:999px; background:var(--brand-bg); color:var(--brand); font-size:.76rem; font-weight:800; line-height:1.7; white-space:nowrap; font-variant-numeric:tabular-nums; }

/* 지금 할 일 */
.db-tasks { display:flex; flex-direction:column; }
.db-task { display:flex; align-items:flex-start; gap:4px; padding:6px 0; border-top:1px solid var(--line); }
.db-task:first-child { border-top:0; padding-top:0; }
.db-check { flex:none; width:40px; height:40px; margin:-2px 0 -2px -8px; display:flex; align-items:center; justify-content:center; cursor:pointer; border-radius:10px; }
.db-check:hover { background:var(--bg-3); }
.db-check input { width:20px; height:20px; margin:0; accent-color:var(--good); cursor:pointer; }
.db-task-main { flex:1; min-width:0; padding-top:6px; }
.db-task-title { display:block; color:var(--ink); font-weight:650; text-decoration:none; line-height:1.4; padding:8px 0; margin:-8px 0; }
.db-task-title:hover { color:var(--brand); text-decoration:underline; }
.db-task.is-done .db-task-title { color:var(--ink-3); text-decoration:line-through; }
.db-meta { display:flex; flex-wrap:wrap; gap:4px; margin-top:4px; }
.db-meta .chip { max-width:100%; overflow:hidden; text-overflow:ellipsis; }
.db-empty { padding:14px 4px; color:var(--ink-3); font-size:.92rem; }
.db-empty b { color:var(--ink); }
.db-subhead { display:flex; align-items:center; gap:6px; font-size:.76rem; font-weight:800; color:var(--ink-3); margin:12px 0 2px; letter-spacing:.02em; }
.db-subhead:first-child { margin-top:0; }
.db-subhead::before { content:''; width:7px; height:7px; border-radius:50%; background:var(--ink-3); flex:none; }
.db-subhead.is-today { color:var(--warn); }
.db-subhead.is-today::before { background:var(--warn); }
.db-subhead.is-overdue { color:var(--bad); }
.db-subhead.is-overdue::before { background:var(--bad); }
.db-subhead-n { font-variant-numeric:tabular-nums; font-weight:700; opacity:.85; }
.db-subhead + .db-task { border-top:0; padding-top:0; }
.db-more-rest { margin-left:0; margin-top:4px; }

/* 돈 흐름 */
.db-ledger { display:flex; flex-direction:column; }
.db-lr { display:grid; grid-template-columns:minmax(0, 1fr) auto; gap:0 10px; padding:7px 0; border-top:1px dashed var(--line); align-items:baseline; }
.db-lr:first-child { border-top:0; padding-top:0; }
.db-lr-label { font-size:.88rem; font-weight:650; min-width:0; }
.db-lr-sub { display:block; font-size:.74rem; color:var(--ink-3); font-weight:500; }
.db-lr-amt { font-weight:800; font-variant-numeric:tabular-nums; white-space:nowrap; text-align:right; }
.db-lr-amt.is-in { color:var(--good); }
.db-lr-bal { display:block; font-size:.72rem; color:var(--ink-3); font-weight:600; }
.db-lr.is-sum .db-lr-label { font-weight:800; }
.db-total { display:flex; align-items:baseline; justify-content:space-between; gap:10px; flex-wrap:wrap; margin-top:8px; padding:10px 12px; border-radius:12px; background:var(--good-bg); color:var(--good); }
.db-total.is-bad { background:var(--bad-bg); color:var(--bad); }
.db-total span { font-weight:750; font-size:.88rem; }
.db-total b { font-size:1.25rem; font-weight:900; font-variant-numeric:tabular-nums; letter-spacing:-.02em; }
.db-alts { list-style:none; margin:6px 0 0; padding:0 2px; display:flex; flex-direction:column; gap:2px; }
.db-alt { display:grid; grid-template-columns:minmax(0, 1fr) auto; align-items:baseline; gap:0 10px; padding:3px 2px; font-size:.84rem; color:var(--ink-2); }
.db-alt-k { min-width:0; font-weight:650; }
.db-alt-k small { display:block; font-size:.72rem; font-weight:500; color:var(--ink-3); line-height:1.35; }
.db-alt b { font-weight:800; font-variant-numeric:tabular-nums; white-space:nowrap; text-align:right; }
.db-alt b.is-bad { color:var(--bad); }
.db-alt b.is-good { color:var(--good); }
.db-hug { display:inline-flex; align-items:center; min-height:36px; margin-top:2px; padding:0 2px; font-size:.8rem; font-weight:700; text-decoration:none; }
.db-hug:hover { text-decoration:underline; }
.db-basis { margin-top:8px; font-size:.74rem; color:var(--ink-3); }
.db-warns { margin-top:8px; display:flex; flex-direction:column; gap:6px; }
.db-warns .callout { margin:0; padding:7px 10px; font-size:.8rem; line-height:1.45; }

/* 견적 */
.db-est-label { font-size:.8rem; font-weight:700; color:var(--ink-3); }
.db-est-head { display:flex; align-items:center; flex-wrap:wrap; gap:4px 8px; }
.db-est-big { font-size:1.75rem; font-weight:900; letter-spacing:-.03em; line-height:1.15; font-variant-numeric:tabular-nums; }
.db-vat { display:inline-flex; align-items:center; padding:1px 8px; border-radius:999px; background:var(--good-bg); color:var(--good); font-size:.72rem; font-weight:800; white-space:nowrap; }
.db-vat.is-ex { background:var(--warn-bg); color:var(--warn); }
.db-est-range { font-size:.85rem; color:var(--ink-2); font-variant-numeric:tabular-nums; }
.db-est-lg { display:flex; align-items:flex-start; gap:6px; margin-top:8px; padding:7px 10px; border-radius:10px; background:var(--bg-3); font-size:.82rem; line-height:1.45; color:var(--ink-2); font-variant-numeric:tabular-nums; }
.db-est-lg b { color:var(--ink); }
.db-est-tot { font-weight:750; color:var(--ink); }
.db-notes .db-note-tip { color:var(--ink-2); }
.db-range { position:relative; height:8px; border-radius:999px; margin:10px 0 4px; background:linear-gradient(90deg, var(--good-bg), var(--warn-bg), var(--bad-bg)); border:1px solid var(--line); }
.db-range i { position:absolute; top:50%; width:14px; height:14px; margin:-7px 0 0 -7px; border-radius:50%; background:var(--brand); border:2px solid var(--bg-2); box-shadow:var(--shadow); }
.db-range-ends { display:flex; justify-content:space-between; font-size:.7rem; color:var(--ink-3); font-variant-numeric:tabular-nums; }
.db-facts { display:flex; flex-wrap:wrap; gap:5px; margin-top:10px; }
.db-notes { margin:8px 0 0; padding-left:1.1em; font-size:.78rem; color:var(--ink-3); }
.db-notes li + li { margin-top:2px; }
.db-cta { margin-top:10px; }
.db-cta .btn { min-height:40px; }

/* 주간 워크플랜 */
.db-road-ctrl { margin-left:auto; display:flex; gap:4px; }
.db-road-ctrl .btn { min-height:36px; }
.db-road-ctrl .btn-icon { width:36px; }
.db-road-scroll { position:relative; display:flex; gap:12px; overflow-x:auto; scroll-snap-type:x mandatory; scroll-padding:0 2px; padding:2px 2px 12px; overscroll-behavior-x:contain; scrollbar-width:thin; -webkit-overflow-scrolling:touch; }
.db-wk { flex:0 0 272px; scroll-snap-align:start; display:flex; flex-direction:column; min-width:0; background:var(--bg); border:1px solid var(--line); border-radius:14px; overflow:hidden; }
.db-wk.is-cur { border-color:var(--brand); box-shadow:0 0 0 2px color-mix(in srgb, var(--brand) 22%, transparent); }
.db-wk.is-move { background:color-mix(in srgb, var(--brand-bg) 55%, var(--bg)); }
.db-wk.is-past { border-color:color-mix(in srgb, var(--bad) 45%, var(--line)); background:color-mix(in srgb, var(--bad-bg) 55%, var(--bg)); }
.db-wk-head { display:block; width:100%; text-align:left; padding:10px 12px 9px; border:0; border-bottom:1px solid var(--line); background:var(--bg-2); color:inherit; font:inherit; }
button.db-wk-head { cursor:pointer; min-height:52px; position:relative; padding-right:40px; }
button.db-wk-head:hover { background:var(--bg-3); }
.db-wk.is-closed .db-wk-head { border-bottom:0; }
.db-wk-top { display:flex; align-items:center; gap:6px; flex-wrap:wrap; }
.db-wk-label { font-weight:850; font-size:.98rem; font-variant-numeric:tabular-nums; letter-spacing:-.01em; }
.db-wk-sub { display:flex; gap:8px; justify-content:space-between; font-size:.76rem; color:var(--ink-3); margin-top:2px; }
.db-wk-head .progress { height:5px; margin-top:6px; }
.db-chev { position:absolute; right:12px; top:50%; transform:translateY(-50%); color:var(--ink-3); font-size:.8rem; transition:transform .15s; }
.db-wk.is-open .db-chev { transform:translateY(-50%) rotate(180deg); }
.db-wk-msline { display:flex; flex-wrap:wrap; gap:4px; margin-top:6px; }
.db-wk-body { display:flex; flex-direction:column; gap:8px; padding:8px 10px 12px; }
.db-days { display:grid; grid-template-columns:repeat(7, minmax(0, 1fr)); gap:3px; }
.db-day { position:relative; text-align:center; padding:3px 0 4px; border-radius:8px; border:1px solid var(--line); background:var(--bg-2); font-size:.66rem; line-height:1.2; color:var(--ink-3); }
.db-day b { display:block; font-size:.86rem; color:var(--ink-2); font-variant-numeric:tabular-nums; }
.db-day.is-we b { color:var(--bad); }
.db-day.is-past { opacity:.5; }
.db-day.is-today { border-color:var(--brand); background:var(--brand-bg); opacity:1; }
.db-day.is-today b, .db-day.is-today span { color:var(--brand); }
.db-day.is-ms { border-color:color-mix(in srgb, var(--brand) 55%, var(--line)); }
.db-day.is-move { background:var(--brand); border-color:var(--brand); }
.db-day.is-move b, .db-day.is-move span { color:var(--on-brand); }
.db-day-flag { position:absolute; top:-8px; right:-4px; font-size:.72rem; }
.db-dots { display:flex; justify-content:center; gap:2px; height:5px; margin-top:2px; }
.db-dot { width:5px; height:5px; border-radius:50%; background:var(--ink-3); }
.db-dot.is-late { background:var(--bad); }
.db-dot.is-done { background:var(--good); }
.db-day.is-move .db-dot { background:var(--on-brand); }
.db-flags { display:flex; flex-direction:column; gap:4px; }
.db-ms { display:flex; align-items:flex-start; gap:6px; padding:6px 9px; border-radius:9px; background:var(--brand-bg); color:var(--brand); font-size:.82rem; font-weight:750; line-height:1.35; }
.db-ms.is-main { background:var(--brand); color:var(--on-brand); }
.db-ms-date { white-space:nowrap; font-variant-numeric:tabular-nums; }
.db-mschip { display:inline-flex; align-items:center; gap:3px; padding:1px 8px; border-radius:999px; background:var(--brand-bg); color:var(--brand); font-size:.72rem; font-weight:750; white-space:nowrap; }
.db-mschip.is-main { background:var(--brand); color:var(--on-brand); }
.db-wi { display:flex; align-items:flex-start; gap:6px; min-height:36px; padding:6px 7px; border-radius:8px; color:var(--ink); text-decoration:none; font-size:.84rem; line-height:1.4; }
.db-wi:hover { background:var(--bg-3); }
.db-wi:focus-visible { outline-offset:0; }
.db-wi-st { flex:none; width:16px; text-align:center; font-weight:900; color:var(--ink-3); }
.db-wi-emo { flex:none; }
.db-wi-t { flex:1; min-width:0; display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden; }
.db-wi-d { flex:none; margin-left:2px; font-size:.7rem; color:var(--ink-3); white-space:nowrap; font-variant-numeric:tabular-nums; padding-top:2px; }
.db-wi.is-done .db-wi-t { text-decoration:line-through; color:var(--ink-3); }
.db-wi.is-done .db-wi-st { color:var(--good); }
.db-wi.is-late .db-wi-st, .db-wi.is-late .db-wi-d { color:var(--bad); }
.db-wi.is-hi { background:var(--bg-2); border:1px solid color-mix(in srgb, var(--bad) 28%, var(--line)); }
.db-wi.is-hi .db-wi-st { color:var(--bad); }
.db-wi.is-hi.is-done { border-color:var(--line); }
.db-wi.is-hi.is-done .db-wi-st { color:var(--good); }
.db-grp-head { display:flex; align-items:center; gap:6px; padding:0 4px 2px; font-size:.76rem; font-weight:800; color:var(--ink-2); }
.db-grp-name { min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.db-grp-count { margin-left:auto; color:var(--ink-3); font-variant-numeric:tabular-nums; font-weight:700; }
.db-grp-head.has-tog { min-height:36px; padding-bottom:0; }
.db-grp-tog { flex:none; min-height:36px; min-width:44px; padding:0 9px; border:1px solid var(--line); border-radius:999px; background:var(--bg-2); color:var(--brand); font:inherit; font-size:.74rem; font-weight:800; cursor:pointer; white-space:nowrap; font-variant-numeric:tabular-nums; }
.db-grp-tog:hover { border-color:var(--brand); }
.db-wi.is-pri .db-wi-st { color:var(--bad); }
.db-flags-more { font-size:.72rem; color:var(--ink-3); padding:0 6px; }
.db-pcs { display:flex; flex-direction:column; gap:5px; padding-top:2px; }
.db-pcs-label { font-size:.72rem; font-weight:750; color:var(--ink-3); padding:0 4px; }
.db-pcs-row { display:flex; flex-wrap:wrap; gap:5px; }
.db-pc { display:inline-flex; align-items:center; gap:4px; min-height:36px; max-width:100%; padding:0 10px; border-radius:999px; border:1px solid var(--line); background:var(--bg-2); color:var(--ink-2); font:inherit; font-size:.76rem; font-weight:700; cursor:pointer; }
.db-pc:hover { border-color:var(--brand); color:var(--ink); }
.db-pc-name { min-width:0; max-width:7.5em; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.db-pc b { font-variant-numeric:tabular-nums; color:var(--ink-3); font-weight:700; }
.db-pc-hi { color:var(--bad); font-weight:800; font-size:.72rem; }
.db-pc.is-late { border-color:color-mix(in srgb, var(--bad) 45%, var(--line)); }
.db-pc.is-done b { color:var(--good); }
.db-chip-cur { background:var(--brand-bg); color:var(--brand); }
.db-wk-empty { font-size:.8rem; color:var(--ink-3); padding:4px 4px 0; }
.db-gap { flex:0 0 56px; display:flex; align-items:center; justify-content:center; text-align:center; color:var(--ink-3); font-size:.74rem; font-weight:700; border:1px dashed var(--line-2); border-radius:14px; writing-mode:vertical-rl; letter-spacing:.1em; }
.db-legend { display:flex; flex-wrap:wrap; gap:4px 14px; font-size:.74rem; color:var(--ink-3); margin-top:4px; align-items:center; }
.db-legend a { font-weight:700; display:inline-flex; align-items:center; min-height:36px; }
.db-road.is-cols .db-road-scroll { align-items:flex-start; }
.db-road.is-cols .db-wk { max-height:min(720px, calc(100vh - 150px)); }
.db-road.is-cols .db-wk-body { flex:1 1 auto; min-height:0; overflow-y:auto; scrollbar-width:thin; }
.db-road.is-cols .db-wk-body.has-more { -webkit-mask-image:linear-gradient(to bottom, #000 calc(100% - 40px), transparent); mask-image:linear-gradient(to bottom, #000 calc(100% - 40px), transparent); }
.db-road.is-cols .db-gap { align-self:stretch; }
.db-road.is-acc .db-road-scroll { flex-direction:column; overflow:visible; scroll-snap-type:none; padding:0; gap:8px; }
.db-road.is-acc .db-wk { flex:none; }
.db-road.is-acc .db-gap { flex:none; writing-mode:horizontal-tb; padding:6px; letter-spacing:0; }

/* 파트별 진행 */
/* 다단(columns) 대신 미리 나눈 칸 — 다단은 다시 그릴 때마다 높이 맞추기 계산이 무거워요 (partsCard 참고) */
.db-pgroups { display:grid; grid-template-columns:repeat(var(--db-pcols, 1), minmax(0, 1fr)); gap:0 14px; align-items:start; }
.db-pcol { display:flex; flex-direction:column; gap:14px; min-width:0; }
.db-pg { min-width:0; }
.db-pg-title { font-size:.74rem; font-weight:800; color:var(--ink-3); margin:0 0 6px 2px; letter-spacing:.02em; }
.db-tiles { display:flex; flex-direction:column; gap:6px; }
.db-tile { display:flex; flex-direction:column; gap:5px; min-width:0; padding:9px 12px; border:1px solid var(--line); border-radius:12px; background:var(--bg); color:var(--ink); text-decoration:none; transition:border-color .12s, background .12s; }
.db-tile:hover { border-color:var(--brand); background:var(--bg-2); }
.db-tile-top { display:flex; align-items:center; gap:8px; min-width:0; }
.db-tile-emo { font-size:1.2rem; flex:none; }
.db-tile-name { font-weight:750; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.db-tile-count { margin-left:auto; flex:none; font-size:.8rem; color:var(--ink-3); font-variant-numeric:tabular-nums; font-weight:700; }
.db-tile .progress { height:6px; flex:1; min-width:0; }
.db-tile-bar { display:flex; align-items:center; gap:6px; }
.db-tile-count2 { display:none; font-size:.72rem; color:var(--ink-3); font-variant-numeric:tabular-nums; font-weight:700; }
.db-tile-next { font-size:.78rem; color:var(--ink-3); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.db-tile-next.is-late { color:var(--bad); }
.db-tile.is-complete .db-tile-next { color:var(--good); font-weight:700; }
@media (max-width: 520px) {
  .db-tiles { display:grid; grid-template-columns:repeat(2, minmax(0, 1fr)); gap:6px; }
  .db-tile { padding:8px 10px; gap:4px; }
  .db-tile-top { gap:5px; }
  .db-tile-top { align-items:flex-start; }
  .db-tile-emo { font-size:1.05rem; line-height:1.3; }
  .db-tile-name { font-size:.86rem; line-height:1.3; white-space:normal; overflow:visible; }
  .db-tile-count { display:none; }
  .db-tile-count2 { display:inline; }
  .db-tile .badge { height:18px; min-width:18px; padding:0 5px; margin-left:auto; flex:none; }
  .db-tile-next { font-size:.72rem; line-height:1.35; white-space:normal; display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; }
}

/* 최근 활동 · 바로가기 */
.db-acts { list-style:none; margin:0; padding:0; }
.db-act { display:flex; gap:10px; padding:6px 0; border-top:1px solid var(--line); font-size:.86rem; line-height:1.45; }
.db-act:first-child { border-top:0; padding-top:0; }
.db-grid > .db-activity { align-self:start; }
.db-act time { flex:none; min-width:74px; color:var(--ink-3); font-size:.76rem; font-variant-numeric:tabular-nums; padding-top:2px; }
.db-act span { min-width:0; }
.db-qlinks { display:grid; grid-template-columns:repeat(2, minmax(0, 1fr)); gap:8px; }
.db-qlink { display:flex; align-items:center; gap:10px; min-height:52px; padding:8px 12px; border-radius:12px; border:1px solid var(--line); background:var(--bg); color:var(--ink); text-decoration:none; font:inherit; text-align:left; cursor:pointer; }
.db-qlink:hover { border-color:var(--brand); background:var(--bg-2); }
.db-qlink-ico { font-size:1.3rem; flex:none; }
.db-qlink b { display:block; font-size:.9rem; }
.db-qlink small { display:block; font-size:.74rem; color:var(--ink-3); line-height:1.3; }
@media (max-width: 520px) {
  .db-qlinks { grid-template-columns:repeat(3, minmax(0, 1fr)); gap:6px; }
  .db-qlink { flex-direction:column; justify-content:center; gap:4px; min-height:76px; padding:8px 4px; text-align:center; }
  .db-qlink b { font-size:.8rem; line-height:1.3; }
  .db-qlink small { display:none; }
}
`);

  /* ======================= 섹션: 히어로 ======================= */
  function counter(label, n, cls, href, note, title) {
    return el('a', { class: 'db-counter' + (n ? ' is-' + cls : ''), href, 'aria-label': label + (note ? '(' + note + ')' : '') + ' ' + n + '개', title: title || (note ? label + ' — ' + note : null) },
      el('span', label), el('b', String(n)), note ? el('small', { class: 'db-counter-note' }, note) : null);
  }
  function heroCard() {
    const move = moveDay();
    const dd = D.dday(move);
    const st = MV.parts.stats();
    // 7일 이내 = 오늘부터 앞으로 7일 안에 마감인 열린 일 (지난 일은 '지연'에서 따로 셈.
    //   눌러서 가는 체크리스트 '7일 이내' 목록에는 지연 항목도 맨 위에 함께 보여요)
    let nOver = 0, nToday = 0, n7 = 0;
    MV.items.list().forEach((i) => {
      const s = MV.items.status(i);
      if (s === 'overdue') nOver++;
      if (s === 'today') nToday++;
      if (s === 'today' || s === 'soon' || s === 'week') n7++;
    });
    const plans = MV.plans || {};
    const area = (p) => (p && +p.exclusive_m2 > 0 ? (+p.exclusive_m2) + '㎡' : null);
    const aOld = area(plans.old), aNew = area(plans.new);

    let eyebrow, big;
    if (dd.n == null) { eyebrow = '이사일'; big = el('div', { class: 'db-big' }, '—'); } else if (dd.n > 0) {
      eyebrow = '이사까지';
      big = el('div', { class: 'db-big', 'aria-label': '이사까지 ' + dd.n + '일' }, String(dd.n), el('small', '일'));
    } else if (dd.n === 0) {
      eyebrow = 'D-day'; big = el('div', { class: 'db-big is-today' }, '오늘 이사! 🚚');
    } else {
      eyebrow = '이사한 지'; big = el('div', { class: 'db-big' }, String(-dd.n), el('small', '일 지났어요'));
    }
    const today = D.today();
    const next = milestones().filter((m) => D.diff(today, m.date) >= 0)[0];
    const whenText = move ? D.fmtLong(move) : '이사일 정보가 올바르지 않아요 (백업 데이터 확인)';

    return el('section', { class: 'card db-hero db-span-12', 'aria-label': '이사 개요', dataset: { dbDeep: '1' } },
      el('div', { class: 'db-hero-grid', dataset: { dbKey: 'hero-grid', dbDeep: '1' } },
        el('div', { class: 'db-hero-left', dataset: { dbKey: 'hero-l' } },
          el('div', { class: 'db-eyebrow' }, eyebrow),
          big,
          el('div', { class: 'db-when' }, whenText, dd.n > 0 ? el('span', { class: 'nowrap' }, ' · ' + dd.label) : null),
          el('div', { class: 'db-route' },
            el('span', '등촌우성 2층'), el('span', { class: 'db-route-arrow', 'aria-hidden': 'true' }, '→'), el('span', '서광등촌마을 14층'),
            aOld && aNew ? el('span', { class: 'db-route-area' }, '전용 ' + aOld + ' → ' + aNew) : null)),
        el('div', { class: 'db-hero-right', dataset: { dbKey: 'hero-r' } },
          el('div', { class: 'db-prog-top' },
            el('span', { class: 'db-prog-label' }, '전체 진행'),
            el('span', { class: 'db-prog-num' }, MV.fmt.pct(st.pct, 0)),
            el('span', { class: 'db-prog-sub' }, st.done + ' / ' + st.total + ' 완료')),
          MV.ui.progress(st.pct),
          el('div', { class: 'db-counters' },
            counter('지연', nOver, 'bad', '#/checklist/~focus'),
            counter('오늘', nToday, 'warn', '#/checklist/~focus'),
            counter('7일 이내', n7, 'brand', '#/checklist/~week', null,
              '오늘부터 7일 안에 마감인 일' + (nOver ? ' (목록에는 지연 ' + nOver + '개도 함께 보여요)' : ''))),
          next ? el('div', { class: 'db-next' },
            el('span', { class: 'db-next-label' }, '🚩 다음 이정표'),
            el('span', { class: 'db-next-what' }, el('b', D.fmt(next.date) + ' ' + next.label),
              el('span', { class: 'db-dchip' }, D.dday(next.date).label))) : null)));
  }

  /* ======================= 섹션: 지금 할 일 ======================= */
  function taskRow(i, pm) {
    const p = partOf(pm, i.partId);
    const cb = el('input', { type: 'checkbox', checked: !!i.done, 'aria-label': (i.done ? '다시 열기: ' : '완료: ') + i.title, dataset: { id: i.id } });
    cb.addEventListener('change', () => onToggle(i.id, cb));
    const owner = i.owner ? el('span', { class: 'chip ' + (OWNER_CLS[i.owner] || '') }, '👤 ' + i.owner) : null;
    return el('div', { class: 'db-task' + (i.done ? ' is-done' : ''), dataset: { dbKey: 'row-' + i.id } },
      el('label', { class: 'db-check', title: i.done ? '다시 열기' : '완료로 표시' }, cb),
      el('div', { class: 'db-task-main' },
        el('a', { class: 'db-task-title', href: itemHref(i) }, i.title || '(제목 없음)'),
        el('div', { class: 'db-meta' },
          // 파트 칩은 표시만 (작은 누름 대상이 제목 링크 바로 밑에 겹치지 않게 — 파트 이동은 '파트별 진행' 타일로)
          el('span', { class: 'chip', title: p.name }, (p.emoji || '📌') + ' ' + clip(p.name, 10)),
          MV.ui.dueChip(i.due, i.done),
          i.priority === 'high' && !i.done ? el('span', { class: 'chip bad' }, '중요') : null,
          owner)));
  }
  function onToggle(id, cb) {
    const it = MV.items.get(id);
    if (!it) return;
    const willDone = !it.done;
    // 바로 보이는 반응: 다시 그리기(다음 프레임 뒤)를 기다리지 않고 이 줄에 먼저 줄을 긋거나 지움
    const row = cb && cb.closest ? cb.closest('.db-task') : null;
    if (row) row.classList.toggle('is-done', willDone);
    if (cb) cb.setAttribute('aria-label', (willDone ? '다시 열기: ' : '완료: ') + (it.title || ''));
    if (willDone) sessionDone.set(id, Date.now()); else sessionDone.delete(id);
    MV.items.toggle(id);
    // 되돌리기 토스트는 하나만: 앞 토스트가 아직 떠 있으면 거기에 이어 붙여 'n개 완료 · 모두 되돌리기' 로
    const live = undoBatch && undoBatch.toast && undoBatch.toast.isConnected;
    const entries = live ? undoBatch.entries : [];
    if (live) undoBatch.toast.remove();
    const k = entries.findIndex((e) => e.id === id);
    if (k >= 0) entries.splice(k, 1);                      // 같은 항목을 다시 누름 = 원래대로
    else entries.push({ id, willDone, title: it.title || '' });
    if (!entries.length) { undoBatch = null; return; }
    const nDone = entries.filter((e) => e.willDone).length;
    const nOpen = entries.length - nDone;
    const msg = entries.length === 1
      ? (entries[0].willDone ? '✅ 완료: ' : '↩︎ 다시 열었어요: ') + clip(entries[0].title, 16)
      : [nDone ? '✅ ' + nDone + '개 완료' : '', nOpen ? '↩︎ ' + nOpen + '개 다시 열기' : ''].filter(Boolean).join(' · ');
    const batch = { entries, toast: null };
    batch.toast = MV.ui.toast(msg, {
      action: {
        label: entries.length > 1 ? '모두 되돌리기' : '되돌리기',
        onClick: () => {
          entries.forEach((e) => {
            const cur = MV.items.get(e.id);
            if (!cur || cur.done !== e.willDone) return;
            if (e.willDone) sessionDone.delete(e.id); else sessionDone.set(e.id, Date.now());
            MV.items.toggle(e.id);
          });
          if (undoBatch === batch) undoBatch = null;
        },
      },
    });
    // 셸의 .toast-wrap 은 화면 절반 폭에서 줄바꿈되므로 (폰에서 '모두 / 되돌리기'), 이 토스트는 한 줄로
    if (batch.toast && batch.toast.classList) batch.toast.classList.add('db-toast');
    undoBatch = batch;
  }
  const NOW_MAX = 8;
  // 화면에 보이는 묶음 순서: 오늘 마감(이사 당일 일 포함) → 기한 지남 → 3일 안 → 7일 안
  const NOW_SLOTS = [
    { id: 'today', label: '오늘 마감', cls: 'is-today' },
    { id: 'overdue', label: '기한 지남', cls: 'is-overdue' },
    { id: 'soon', label: '3일 안에', cls: '' },
    { id: 'week', label: '7일 안에', cls: '' },
  ];
  // 방금 완료해서 status 가 'done' 이 된 항목도 원래 자리에 남도록 기한으로 칸을 정합니다
  function nowSlot(i, today) {
    if (!D.valid(i.due)) return 'later';
    const n = D.diff(today, normDate(i.due));
    return n < 0 ? 'overdue' : n === 0 ? 'today' : n <= 3 ? 'soon' : n <= 7 ? 'week' : 'later';
  }
  function nowCard(pm) {
    const today = D.today();
    const all = MV.items.list();
    const open = all.filter((i) => !i.done);
    const slot = new Map(all.map((i) => [i.id, nowSlot(i, today)]));
    const urgent = open.filter((i) => ['overdue', 'today', 'soon'].includes(slot.get(i.id)));
    const weekOpen = open.filter((i) => slot.get(i.id) === 'week');
    const topped = urgent.length < 5 && weekOpen.length > 0;     // 급한 일이 적으면 7일 안 일로 채움
    const pick = topped ? urgent.concat(weekOpen) : urgent;
    // 고르는 순서: 오늘 마감 → 중요한 지연 → 중요한 3일 안 → 나머지 지연 → 3일 안 → 7일 안 (같은 칸 안에서는 기한·중요도 순)
    const rank = (i) => {
      const sl = slot.get(i.id), hi = i.priority === 'high';
      if (sl === 'today') return 0;
      if (sl === 'overdue') return hi ? 1 : 3;
      if (sl === 'soon') return hi ? 2 : 4;
      return 5;
    };
    // 열린 일이 언제나 NOW_MAX 칸을 채우고, 방금 끝낸 일은 가장 최근 KEEP_DONE 개만 제자리에 줄 그어 남깁니다
    const chosenOpen = pick.slice().sort((a, b) => (rank(a) - rank(b)) || byDue(a, b)).slice(0, NOW_MAX);
    const kept = all.filter((i) => i.done && sessionDone.has(i.id) && slot.get(i.id) !== 'later' && (topped || slot.get(i.id) !== 'week'))
      .sort((a, b) => sessionDone.get(b.id) - sessionDone.get(a.id)).slice(0, KEEP_DONE);
    const chosen = chosenOpen.concat(kept);
    const nLate = urgent.filter((i) => slot.get(i.id) === 'overdue').length;
    const nToday = urgent.filter((i) => slot.get(i.id) === 'today').length;
    const showsWeek = chosen.some((i) => slot.get(i.id) === 'week');
    // '전체 보기' 는 카드에 보이는 항목이 모두 들어 있는 목록으로
    const allHref = !pick.length && open.length ? '#/checklist/~all' : showsWeek ? '#/checklist/~week' : '#/checklist/~focus';
    const subBits = [];
    if (nToday) subBits.push('오늘 ' + nToday);
    if (nLate) subBits.push('지연 ' + nLate);
    const sub = pick.length ? (subBits.length ? subBits.join(' · ') : (topped ? '7일 안에 마감' : '3일 안에 마감')) : '';
    const body = el('div', { class: 'db-tasks', dataset: { dbKey: 'now-list', dbDeep: '1' } });
    if (chosen.length) {
      NOW_SLOTS.forEach((g) => {
        const rows = chosen.filter((i) => slot.get(i.id) === g.id).sort(byDue);
        if (!rows.length) return;
        const left = pick.filter((i) => slot.get(i.id) === g.id).length;   // 이 칸의 열린 일 전체 (카드에 안 보이는 것 포함)
        body.appendChild(el('div', { class: 'db-subhead ' + g.cls, dataset: { dbKey: 'sh-' + g.id } }, g.label,
          el('span', { class: 'db-subhead-n', 'aria-label': left ? '남은 일 ' + left + '개' : '모두 완료' }, left ? String(left) : '✓')));
        rows.forEach((i) => body.appendChild(taskRow(i, pm)));
      });
      const rest = pick.length - chosenOpen.length;
      if (rest > 0) body.appendChild(el('a', { class: 'db-more db-more-rest', href: allHref, dataset: { dbKey: 'more' } }, '그 외 ' + rest + '개 더 보기 →'));
    }
    if (!chosenOpen.length) {
      // 급한 일이 없거나 방금 다 끝낸 경우 (끝낸 줄은 위에 남아 있음)
      if (!all.length) {
        body.appendChild(el('div', { class: 'db-empty', dataset: { dbKey: 'empty' } }, '아직 체크 항목이 없어요. ', el('a', { href: '#/checklist' }, '체크리스트에서 추가하기 →')));
      } else if (!open.length) {
        body.appendChild(el('div', { class: 'db-empty', dataset: { dbKey: 'empty' } }, el('b', '🎉 모든 할 일을 끝냈어요!'), ' 이사 준비 완료.'));
      } else {
        const upcoming = open.slice().sort(byDue).slice(0, 3);
        body.appendChild(el('div', { class: 'db-empty', dataset: { dbKey: 'empty' } }, el('b', kept.length ? '급한 일은 다 끝냈어요 🙌' : '일주일 안에 급한 일은 없어요 🙌'), ' 미리 해 두면 좋은 일:'));
        upcoming.forEach((i) => body.appendChild(taskRow(i, pm)));
      }
    }
    return el('section', { class: 'card db-now db-span-7', 'aria-label': '지금 할 일', dataset: { dbDeep: '1' } },
      head('✅', '지금 할 일', sub ? el('span', { class: 'db-now-sub' }, sub) : null, moreLink('전체 보기 →', allHref), 'now-head'),
      body);
  }

  /* ======================= 섹션: 11/3 돈 흐름 ======================= */
  const signed = (n, sign) => (sign > 0 ? '+' : '−') + MV.fmt.krw(Math.abs(n));
  const minus = (n) => (n < 0 ? '−' + MV.fmt.krw(-n) : MV.fmt.krw(n));   // 음수는 '−'(U+2212) 로 통일
  // 결과는 '여유 X' / '부족 X' (부족이면 금액은 절댓값 — 이중 부정 X)
  const verdict = (n) => (n < 0 ? '부족 ' : '여유 ') + MV.fmt.krw(Math.abs(n));
  const HUG_HREF = '#/guide/hug';             // 별첨: HUG 보증, 가입할 때와 안 할 때 (실제 금액 비교)
  function ledgerRow(label, sub, amtText, cls, bal, title) {
    return el('div', { class: 'db-lr' + (cls === 'sum' ? ' is-sum' : '') },
      el('div', { class: 'db-lr-label' }, label, sub ? el('span', { class: 'db-lr-sub' }, sub) : null),
      el('div', { class: 'db-lr-amt' + (cls === 'in' ? ' is-in' : ''), title: title || null }, amtText,
        bal != null ? el('span', { class: 'db-lr-bal' }, '→ ' + minus(bal)) : null));
  }
  function warnText(w) {
    if (w == null) return '';
    if (typeof w === 'string') return w;
    return w.text || w.msg || w.message || w.title || '';
  }
  /* 계획값 — 자금흐름 화면(MV.calc.financeSummary)이 없을 때만 씁니다.
     가족 결정(2026-10-06) 반영: 옷장은 이사 뒤 간이 옷장(약 20만원, 선택·나중에) · 통돌이 약 50만원(이사 후 배송)
     · 커튼·소품은 지금 것을 가져감(0원) · 입주청소는 직접(0원) · 예비비 없음.
     11월 월세 70만원은 계약서상 후불이라 11/3에 낼 때만 — 낸다면 잔금(1억 + 1억 + 9,500만)과 따로 이체. */
  const PLAN_FLOW = [
    { label: '집주인 A에게 받을 돈', sub: '보증금 4.2억 − 먼저 받은 0.42억', amt: 378000000, sign: 1 },
    { label: '우리은행 전세대출 상환', sub: '남은 대출 0.78억 (일할이자가 조금 붙을 수 있어요)', amt: 78000000, sign: -1 },
    { label: '집주인 C 잔금', sub: '1억 + 1억 + 9,500만으로 나눠 이체', amt: 295000000, sign: -1 },
    { label: '11월 월세 (11/3에 낸다면)', sub: '계약서상 후불 — 낸다면 잔금과 따로 이체하고 영수증도 따로 받기', amt: 700000, sign: -1 },
    { label: '중개보수 (상한)', sub: '법정 상한 117만원 · 부가세 별도', amt: 1170000, sign: -1 },
  ];
  function planCosts() {
    let est = null;
    try { est = MV.calc && typeof MV.calc.moveEstimate === 'function' ? MV.calc.moveEstimate(MV.store.get()) : null; } catch (e) { est = null; }
    const pay = est && est.pay && isNum(est.pay.typical) ? est.pay.typical : null;
    const lg = est && est.lgCost && isNum(est.lgCost.typical) ? est.lgCost.typical : null;
    const essential = (pay != null ? pay : 2167000)       // 이사업체 (부가세 포함, 모델 중간값)
      + (lg != null ? lg : 565000)                         // LG 가전 이전설치
      + 50000 + 100000 + 20000;                            // 대형폐기물 · 엘리베이터(두 단지) · 인터넷 이전
    return { essential, purchase: 500000, optional: 200000 + 780800, fromEst: pay != null };
  }
  /* 결과: 머리 숫자는 '꼭 필요한 현금 기준'(11/3 남는 돈 − 꼭 드는 이사 비용), 아래 작은 줄에 살림 구입까지 / 전부 포함 */
  function cashResult(r) {
    const box = el('div', { class: 'db-result' });
    const bad = r.netEssential < 0;
    box.appendChild(el('div', { class: 'db-total' + (bad ? ' is-bad' : '') },
      el('span', '꼭 필요한 현금 기준'),
      el('b', { title: MV.fmt.won(r.netEssential) }, (bad ? '⚠ ' : '') + verdict(r.netEssential))));
    const alts = [];
    if (isNum(r.netWithPurchases)) {
      alts.push(el('li', { class: 'db-alt' },
        el('span', { class: 'db-alt-k' }, '살림 구입까지 포함하면',
          isNum(r.purchase) && r.purchase > 0 ? el('small', '통돌이 세탁기 등 +' + MV.fmt.krw(r.purchase)) : null),
        el('b', { class: r.netWithPurchases < 0 ? 'is-bad' : 'is-good', title: MV.fmt.won(r.netWithPurchases) }, verdict(r.netWithPurchases))));
    }
    if (isNum(r.net)) {
      alts.push(el('li', { class: 'db-alt' },
        el('span', { class: 'db-alt-k' }, '전부 포함하면',
          isNum(r.optional) && r.optional > 0 ? el('small', '간이 옷장·HUG 보증료 등 +' + MV.fmt.krw(r.optional) + ' (이사 뒤에 내는 돈)') : null),
        el('b', { class: r.net < 0 ? 'is-bad' : 'is-good', title: MV.fmt.won(r.net) }, verdict(r.net))));
    }
    if (alts.length) box.appendChild(el('ul', { class: 'db-alts' }, alts));
    box.appendChild(el('a', { class: 'db-hug', href: HUG_HREF }, '🛡 HUG 보증: 가입할 때와 안 할 때 비교 →'));
    return box;
  }
  function moneyCard() {
    let fs = null;
    try {
      if (MV.calc && typeof MV.calc.financeSummary === 'function') fs = MV.calc.financeSummary(MV.store.get());
    } catch (e) { console.warn('[dashboard] financeSummary 실패', e); fs = null; }
    const ok = fs && typeof fs === 'object' && ['inflow', 'outflow', 'leftover', 'net', 'netEssential'].some((k) => isNum(fs[k]));
    const body = el('div');
    if (ok) {
      const inflow = isNum(fs.inflow) ? fs.inflow : null;
      const outflow = isNum(fs.outflow) ? fs.outflow : null;
      const leftover = isNum(fs.leftover) ? fs.leftover : (inflow != null && outflow != null ? inflow - outflow : null);
      const exp = isNum(fs.expensesTotal) ? fs.expensesTotal : null;
      const rent = isNum(fs.rentPart) && fs.rentPart > 0 ? fs.rentPart : 0;
      const led = el('div', { class: 'db-ledger' });
      if (inflow != null) led.appendChild(ledgerRow('받을 돈', '11/3 오전 보증금 잔액 등', signed(inflow, 1), 'in', null, MV.fmt.won(inflow)));
      if (outflow != null) {
        led.appendChild(ledgerRow('나갈 돈', '대출 상환 · 잔금 · 중개보수' + (rent ? ' · 11월 월세 ' + MV.fmt.krw(rent) + '(잔금과 따로 이체)' : ''),
          signed(outflow, -1), '', null, MV.fmt.won(outflow)));
      }
      if (isNum(fs.netEssential)) {
        // 새 요약: 묶음별 (꼭 드는 이사 비용 / 새로 사는 살림 / 선택·나중에)
        const left = leftover != null ? leftover : null;
        const essential = isNum(fs.essentialUnpaid) ? fs.essentialUnpaid : (left != null ? left - fs.netEssential : null);
        const nwp = isNum(fs.netWithPurchases) ? fs.netWithPurchases : null;
        const net = isNum(fs.net) ? fs.net : null;
        const purchase = isNum(fs.purchaseUnpaid) ? fs.purchaseUnpaid : (nwp != null ? fs.netEssential - nwp : null);
        const optional = isNum(fs.optionalUnpaid) ? fs.optionalUnpaid : (nwp != null && net != null ? nwp - net : null);
        if (left != null) led.appendChild(ledgerRow('남는 돈', null, minus(left), 'sum', null, MV.fmt.won(left)));
        if (essential != null) led.appendChild(ledgerRow('꼭 드는 이사 비용', '이사업체 · LG 가전 이전 · 엘리베이터 등', signed(essential, -1), '', null, MV.fmt.won(essential)));
        body.appendChild(led);
        body.appendChild(cashResult({ netEssential: fs.netEssential, netWithPurchases: nwp, net, purchase, optional }));
      } else {
        // 예전 요약 (묶음 없음): 최종 여유 = 남는 돈 − 아직 낼 이사 비용 전부
        const net = isNum(fs.net) ? fs.net : (leftover != null && exp != null ? leftover - exp : null);
        if (leftover != null && net != null) led.appendChild(ledgerRow('남는 돈', null, minus(leftover), 'sum', null, MV.fmt.won(leftover)));
        if (exp != null) led.appendChild(ledgerRow('이사 비용', '이사업체 · 가전 이전 · 살림 구입 등', signed(exp, -1), '', null, MV.fmt.won(exp)));
        body.appendChild(led);
        const fin = net != null ? net : leftover;
        if (fin != null) {
          const label = net != null ? '이사 비용까지 모두 내면' : '남는 돈';
          body.appendChild(el('div', { class: 'db-total' + (fin < 0 ? ' is-bad' : '') },
            el('span', label), el('b', { title: MV.fmt.won(fin) }, (fin < 0 ? '⚠ ' : '') + verdict(fin))));
        }
      }
      const warns = (Array.isArray(fs.warnings) ? fs.warnings : []).map(warnText).filter(Boolean);
      if (warns.length) {
        const box = el('div', { class: 'db-warns' });
        warns.slice(0, 3).forEach((w) => box.appendChild(el('div', { class: 'callout warn' }, w)));
        if (warns.length > 3) box.appendChild(el('a', { class: 'db-more db-more-rest', href: '#/money' }, '주의사항 ' + (warns.length - 3) + '개 더 →'));
        body.appendChild(box);
      }
      body.appendChild(el('div', { class: 'db-basis' }, '자금흐름 화면에 입력한 값 기준 · 꼭 필요한 현금 = 남는 돈 − 꼭 드는 이사 비용'));
    } else {
      // 계획값 (자금흐름 화면이 없을 때): 11/3 흐름 → 남는 돈 → 가족이 정한 이사 비용 묶음
      let bal = 0;
      const led = el('div', { class: 'db-ledger' });
      PLAN_FLOW.forEach((s) => {
        bal += s.sign * s.amt;
        led.appendChild(ledgerRow(s.label, s.sub, signed(s.amt, s.sign), s.sign > 0 ? 'in' : '', bal, MV.fmt.won(s.amt)));
      });
      const pc = planCosts();
      led.appendChild(ledgerRow('꼭 드는 이사 비용 (약)', (pc.fromEst ? '이사업체(견적 계산값)' : '이사업체') + ' · LG 가전 이전 · 엘리베이터 · 폐기물 · 인터넷',
        signed(pc.essential, -1), '', null, MV.fmt.won(pc.essential)));
      body.appendChild(led);
      const nE = bal - pc.essential;
      body.appendChild(cashResult({ netEssential: nE, netWithPurchases: nE - pc.purchase, net: nE - pc.purchase - pc.optional, purchase: pc.purchase, optional: pc.optional }));
      body.appendChild(el('div', { class: 'db-basis' }, '계획값 기준 (약) · 옷장은 이사 뒤 간이 옷장(선택·나중에), 커튼·소품은 지금 것, 입주청소는 직접, 예비비는 없어요. 11월 월세 70만원은 11/3에 낸다고 넣었어요 (계약서대로 후불이면 그만큼 여유). 자금흐름 화면에서 실제 금액을 넣으면 자동으로 바뀝니다.'));
    }
    return el('section', { class: 'card db-money', 'aria-label': '11월 3일 돈 흐름' },
      head('💸', (moveDay() ? md(moveDay()) : '이사일') + ' 돈 흐름', null, moreLink('자금흐름 자세히 →', '#/money')),
      body);
  }

  /* ======================= 섹션: 이사 견적 ======================= */
  function invSummary() {
    const inv = MV.inv.list();
    const n = (f) => inv.filter((x) => x.fate === f).reduce((s, x) => s + Math.max(0, +x.qty || 0), 0);
    return { count: inv.length, move: n('move'), discard: n('discard'), buy: n('buy'), sell: n('sell'), lg: inv.filter((x) => x.lg && x.fate === 'move').length };
  }
  function estimateCard() {
    let est = null;
    try {
      if (MV.calc && typeof MV.calc.moveEstimate === 'function') est = MV.calc.moveEstimate(MV.store.get());
    } catch (e) { console.warn('[dashboard] moveEstimate 실패', e); est = null; }
    const inv = invSummary();
    const body = el('div');
    const ok = est && typeof est === 'object' && isNum(est.typical);
    if (ok) {
      // 머리 숫자는 자금 화면·LG 비교와 같은 '실제로 낼 돈'(부가세 포함, est.pay). 없으면 기준가를 쓰고 부가세 기준을 밝혀 둠
      const pay = est.pay && typeof est.pay === 'object' && isNum(est.pay.typical) ? est.pay : null;
      const typ = pay ? pay.typical : est.typical;
      const low = pay ? (isNum(pay.low) ? pay.low : typ) : (isNum(est.low) ? est.low : typ);
      const high = pay ? (isNum(pay.high) ? pay.high : typ) : (isNum(est.high) ? est.high : typ);
      const vatIn = pay ? true : !!est.vatIncl;
      const vatTxt = vatIn ? '부가세 포함' : '부가세 별도';
      // 부가세 별도 금액은 보조 숫자로 (견적서가 부가세 별도로 올 때 비교용)
      const exTyp = pay ? (est.ex && isNum(est.ex.typical) ? est.ex.typical : (!est.vatIncl ? est.typical : null)) : null;
      body.appendChild(el('div', { class: 'db-est-label' }, '예상 이사비 · 이삿짐센터'));
      body.appendChild(el('div', { class: 'db-est-head' },
        el('span', { class: 'db-est-big', title: MV.fmt.won(typ) + ' (' + vatTxt + ')' }, '약 ' + MV.fmt.krw(typ)),
        el('span', { class: 'db-vat' + (vatIn ? '' : ' is-ex') }, vatTxt)));
      body.appendChild(el('div', { class: 'db-est-range' }, el('span', { class: 'nowrap' }, '범위 ' + MV.fmt.krw(low) + ' ~ ' + MV.fmt.krw(high)),
        exTyp != null && Math.abs(exTyp - typ) >= 1 ? el('span', { class: 'nowrap' }, ' · 부가세 별도 약 ' + MV.fmt.krw(exTyp)) : null));
      if (high > low) {
        const pos = MV.clamp((typ - low) / (high - low), 0, 1);
        body.appendChild(el('div', { class: 'db-range', 'aria-hidden': 'true' }, el('i', { style: { left: Math.round(pos * 100) + '%' } })));
        body.appendChild(el('div', { class: 'db-range-ends', 'aria-hidden': 'true' }, el('span', MV.fmt.krw(low)), el('span', MV.fmt.krw(high))));
      }
      const facts = el('div', { class: 'db-facts' });
      if (isNum(est.tons)) facts.appendChild(el('span', { class: 'chip' }, '📦 짐량 약 ' + (Math.round(est.tons * 10) / 10) + '톤'));
      if (isNum(est.crew)) facts.appendChild(el('span', { class: 'chip' }, '👷 ' + est.crew + '명'));
      facts.appendChild(el('span', { class: 'chip' }, '짐 ' + inv.count + '개'));
      body.appendChild(facts);
      // LG 이전설치는 LG에 따로 내는 돈 (소비자가, 부가세 포함) — 이삿짐센터 금액에 섞지 않고 따로 보여 줌
      const lgc = est.lgCost;
      if (lgc && isNum(lgc.typical) && lgc.typical > 0) {
        const tot = est.totalPay && isNum(est.totalPay.typical) ? est.totalPay.typical : (pay ? typ + lgc.typical : null);
        body.appendChild(el('div', { class: 'db-est-lg', title: isNum(lgc.low) && isNum(lgc.high) ? 'LG 이전 ' + MV.fmt.krw(lgc.low) + ' ~ ' + MV.fmt.krw(lgc.high) + ' (부가세 포함)' : null },
          el('span', { 'aria-hidden': 'true' }, '🔌'),
          el('span', 'LG 이전설치는 따로 약 ', el('b', MV.fmt.krw(lgc.typical)), ' (부가세 포함)',
            tot != null ? el('span', { class: 'db-est-tot' }, ' → 이사 전체 약 ' + MV.fmt.krw(tot)) : null)));
      }
      const notes = (Array.isArray(est.notes) ? est.notes : []).map(warnText).filter(Boolean);
      const list = notes.slice(0, 3).map((t) => el('li', t));
      // 가족 결정 (10/6): 옷장은 이사 뒤에 사니, 옷은 박스·행거박스로 — 견적 받을 때 행거박스 수를 꼭 물어보기
      if (!notes.some((t) => t.indexOf('행거박스') >= 0)) {
        list.push(el('li', { class: 'db-note-tip' }, '👕 옷장은 이사 뒤에 사요 — 업체가 행거박스를 몇 개 가져오는지 묻고 견적에 넣으세요.'));
      }
      if (list.length) body.appendChild(el('ul', { class: 'db-notes' }, list));
    } else {
      body.appendChild(el('p', { class: 'small mb-0' }, inv.count
        ? '짐 목록 ' + inv.count + '개가 있어요. 냉장고·에어컨·가구 규격을 채우면 예상 이사비와 짐량(톤)이 자동으로 계산돼요.'
        : '짐 목록(냉장고 규격, 에어컨, 가구 개수)을 채우면 예상 이사비가 자동으로 계산돼요.'));
      if (inv.count) {
        body.appendChild(el('div', { class: 'db-facts' },
          el('span', { class: 'chip kid' }, '가져감 ' + inv.move),
          el('span', { class: 'chip bad' }, '버림 ' + inv.discard),
          el('span', { class: 'chip good' }, '구매 ' + inv.buy),
          inv.lg ? el('span', { class: 'chip' }, '🔌 LG ' + inv.lg) : null));
      }
      body.appendChild(el('div', { class: 'db-cta' }, el('a', { class: 'btn btn-sm btn-primary', href: '#/stuff' }, '짐 목록 채우기 →')));
    }
    return el('section', { class: 'card db-est', 'aria-label': '이사 견적' },
      head('🚚', '이사 견적', null, moreLink('짐 목록 →', '#/stuff')),
      body);
  }

  /* ======================= 섹션: 주간 워크플랜 ======================= */
  function roadModel() {
    const today = D.today();
    const curW = D.weekStart(today);
    const move = moveDay();                              // 깨진 값이면 null → 오늘 기준으로 그림
    const moveW = move ? D.weekStart(move) : null;
    let endW = D.add(moveW || curW, 14);                 // 이사 다음 주 + 한 주 더
    const minEnd = D.add(curW, 35);                      // 최소 6주
    if (D.diff(endW, minEnd) > 0) endW = minEnd;
    const weeks = new Map();
    const mk = (ws) => {
      if (!weeks.has(ws)) weeks.set(ws, { key: ws, start: ws, end: D.add(ws, 6), items: [], ms: [] });
      return weeks.get(ws);
    };
    for (let w = curW; D.diff(w, endW) >= 0; w = D.add(w, 7)) mk(w);
    const past = [];
    MV.items.list((i) => D.valid(i.due)).forEach((i) => {
      const ws = D.weekStart(normDate(i.due));
      if (D.diff(ws, curW) > 0) { if (!i.done) past.push(i); return; }
      mk(ws).items.push(i);
    });
    milestones().forEach((m) => { const ws = D.weekStart(m.date); if (D.diff(curW, ws) >= 0) mk(ws).ms.push(m); });
    const list = Array.from(weeks.values()).sort((a, b) => (a.start < b.start ? -1 : 1));
    const nodate = MV.items.list((i) => !i.done && !D.valid(i.due)).length;
    return { today, curW, move, moveW, endW, weeks: list, past: past.sort(byDue), nodate };
  }
  // 주간 칸 정렬: 열린 일 먼저 → 기한 → 중요도
  const byOpen = (a, b) => ((a.done ? 1 : 0) - (b.done ? 1 : 0)) || byDue(a, b);
  const cssEsc = (s) => (window.CSS && CSS.escape ? CSS.escape(s) : String(s).replace(/["\\]/g, '\\$&'));
  // flag = 맨 위 '중요' 깃발 줄 (파트 이모지 + 테두리). 파트 묶음 안의 중요 항목은 ⚑ 표시만.
  function weekItemLink(i, pm, flag) {
    const st = MV.items.status(i);
    const late = st === 'overdue';
    const hi = i.priority === 'high' && !i.done;
    const glyph = i.done ? '✓' : late ? '!' : hi ? '⚑' : '○';
    const p = partOf(pm, i.partId);
    return el('a', {
      class: 'db-wi' + (i.done ? ' is-done' : '') + (late ? ' is-late' : '') + (flag ? ' is-hi' : hi ? ' is-pri' : ''),
      href: itemHref(i), title: p.name + ' · ' + i.title,
      'aria-label': (hi ? '중요 · ' : '') + i.title + ' · ' + D.fmt(i.due) + (i.done ? ' · 완료' : late ? ' · 기한 지남' : ''),
    },
    el('span', { class: 'db-wi-st', 'aria-hidden': 'true' }, glyph),
    flag ? el('span', { class: 'db-wi-emo', 'aria-hidden': 'true' }, p.emoji || '📌') : null,
    el('span', { class: 'db-wi-t' }, i.title || '(제목 없음)'),
    el('span', { class: 'db-wi-d', 'aria-hidden': 'true' }, D.fmt(i.due)));
  }
  /* 한 주(또는 '지난 주까지')의 항목을 파트별로 묶습니다.
     칸이 끝없이 길어지지 않게, 열린 일·기한 순으로 ROW_BUDGET 개만 파트 묶음에 바로 보여 주고
     - 묶음에 더 있으면 머리줄의 '+n' 로 펼치고
     - 한 줄도 못 보여 준 파트는 아래 '다른 파트' 칩(이모지·이름·done/total·⚑중요 수)으로 모아 둡니다 (눌러서 펼치기). */
  function groupsEl(items, pm, key, redraw) {
    const order = new Map(MV.parts.list().map((p, idx) => [p.id, idx]));
    const groups = new Map();
    items.forEach((i) => {
      const k = pm.has(i.partId) ? i.partId : '_';
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(i);
    });
    const keys = Array.from(groups.keys()).sort((a, b) => (order.has(a) ? order.get(a) : 1e9) - (order.has(b) ? order.get(b) : 1e9));
    // 먼저 보여 줄 ROW_BUDGET 줄: 열린 일 → 중요 → 기한 순 (보여 줄 때는 파트 안에서 기한 순)
    const isHi = (i) => (i.priority === 'high' && !i.done ? 0 : 1);
    const top = new Set(items.slice().sort((a, b) => ((a.done ? 1 : 0) - (b.done ? 1 : 0)) || (isHi(a) - isHi(b)) || byDue(a, b))
      .slice(0, ROW_BUDGET).map((i) => i.id));
    const blocks = [], chips = [];
    keys.forEach((k) => {
      const list = groups.get(k).sort(byOpen);
      const p = k === '_' ? { name: '기타', emoji: '📌' } : pm.get(k);
      const done = list.filter((i) => i.done).length;
      const gk = key + '|' + k;
      const expanded = ui.moreGroups.has(gk);
      const base = list.filter((i) => top.has(i.id));
      const shown = expanded ? list : base;
      const toggle = () => {
        if (ui.moreGroups.has(gk)) ui.moreGroups.delete(gk); else ui.moreGroups.add(gk);
        persistUi();
        redraw(gk);
      };
      const countTxt = done + '/' + list.length;
      const countLabel = list.length + '개 중 ' + done + '개 완료';
      if (!shown.length) {
        const nHi = list.filter((i) => !i.done && i.priority === 'high').length;
        const nLate = list.filter((i) => MV.items.status(i) === 'overdue').length;
        chips.push(el('button', {
          type: 'button', class: 'db-pc' + (nLate ? ' is-late' : '') + (done === list.length ? ' is-done' : ''),
          dataset: { gk }, 'aria-expanded': 'false', title: p.name + ' · ' + countLabel + (nHi ? ' · 중요 ' + nHi + '개' : ''),
          'aria-label': p.name + ' · ' + countLabel + (nHi ? ' · 중요 ' + nHi + '개' : '') + (nLate ? ' · 기한 지남 ' + nLate + '개' : '') + ' · 펼쳐 보기',
          onclick: toggle,
        },
        el('span', { 'aria-hidden': 'true' }, p.emoji || '📌'),
        el('span', { class: 'db-pc-name' }, p.name),
        el('b', countTxt),
        nHi ? el('span', { class: 'db-pc-hi', 'aria-hidden': 'true' }, '⚑' + nHi) : null));
        return;
      }
      const hidden = list.length - shown.length;
      const canFold = expanded && base.length < list.length;
      const tog = hidden > 0 || canFold
        ? el('button', {
          type: 'button', class: 'db-grp-tog', dataset: { gk }, 'aria-expanded': String(expanded),
          'aria-label': expanded ? p.name + ' 접기' : p.name + ' ' + hidden + '개 더 보기', onclick: toggle,
        }, expanded ? '접기 ▲' : '+' + hidden + ' ▼')
        : null;
      blocks.push(el('div', { class: 'db-grp' },
        el('div', { class: 'db-grp-head' + (tog ? ' has-tog' : '') },
          el('span', { 'aria-hidden': 'true' }, p.emoji || '📌'),
          el('span', { class: 'db-grp-name' }, p.name),
          el('span', { class: 'db-grp-count', 'aria-label': countLabel }, countTxt),
          tog),
        shown.map((i) => weekItemLink(i, pm, false))));
    });
    if (chips.length) {
      blocks.push(el('div', { class: 'db-pcs' },
        el('div', { class: 'db-pcs-label' }, (blocks.length ? '다른 파트 ' + chips.length + '곳' : '파트별 ' + chips.length + '곳') + ' · 눌러서 펼치기'),
        el('div', { class: 'db-pcs-row' }, chips)));
    }
    return blocks;
  }
  // 칸 하나를 새로 그려 바꿔 끼우기 (칸 안 세로 스크롤·포커스 유지)
  // 칸 높이를 넘는 데스크톱 칸: 아래에 더 있으면 끝을 흐리게 (칸 안에서 스크롤된다는 신호)
  /* 성능: 칸마다 '읽기(scrollHeight) → 쓰기(클래스)'를 번갈아 하면 칸 수만큼 레이아웃을 다시 계산해요 (가로 화면에서 체크가 느렸던 원인).
     그래서 먼저 모든 칸을 한꺼번에 읽고, 그다음 바뀐 칸의 클래스만 한꺼번에 바꿉니다. */
  function fade(bodies) {
    const list = Array.isArray(bodies) ? bodies : [bodies];
    const more = list.map((b) => (b && b.classList ? b.scrollHeight - b.scrollTop - b.clientHeight > 4 : null));
    list.forEach((b, k) => { if (more[k] != null && b.classList.contains('has-more') !== more[k]) b.classList.toggle('has-more', more[k]); });
  }
  function fadeAll(root) { fade(Array.from(root.querySelectorAll('.db-road.is-cols .db-wk-body'))); }
  // 칸 안 세로 스크롤: 스크롤 이벤트마다 바로 읽지 않고 다음 프레임에 모아서 한 번에
  const fadeQ = new Set();
  let fadeRaf = 0;
  function fadeSoon(b) {
    fadeQ.add(b);
    if (fadeRaf) return;
    fadeRaf = requestAnimationFrame(() => {
      fadeRaf = 0;
      const list = Array.from(fadeQ).filter((x) => x.isConnected);
      fadeQ.clear();
      fade(list);
    });
  }
  function swapCol(col, make, focusSel) {
    const ob = col.querySelector('.db-wk-body');
    const st = ob ? ob.scrollTop : 0;
    const nc = make();
    seal(nc);
    col.replaceWith(nc);
    const nb = nc.querySelector('.db-wk-body');
    if (nb && st) nb.scrollTop = st;
    const f = focusSel ? nc.querySelector(focusSel) : null;
    if (f) f.focus({ preventScroll: true });
    if (nb && nc.closest('.db-road.is-cols')) fade(nb);     // 쓰기(스크롤·포커스)를 마친 뒤 마지막에 한 번 읽기
    return nc;
  }
  function dayStrip(w, m, items) {
    const cells = [];
    for (let d = 0; d < 7; d++) {
      const date = D.add(w.start, d);
      const dayItems = items.filter((i) => normDate(i.due) === date);
      const dms = w.ms.filter((x) => x.date === date);
      const wd = D.weekday(date);
      const cls = ['db-day'];
      if (date === m.today) cls.push('is-today');
      else if (date < m.today) cls.push('is-past');
      if (dms.length) cls.push('is-ms');
      if (m.move && date === m.move) cls.push('is-move');
      if (wd === '토' || wd === '일') cls.push('is-we');
      const label = D.fmt(date) + (date === m.today ? ' 오늘' : '') + dms.map((x) => ' · ' + x.label).join('') + (dayItems.length ? ' · 할 일 ' + dayItems.length + '개' : '');
      const dots = dayItems.slice(0, 3).map((i) => el('i', { class: 'db-dot' + (i.done ? ' is-done' : date < m.today ? ' is-late' : '') }));
      cells.push(el('div', { class: cls.join(' '), title: label, role: 'listitem', 'aria-label': label },
        dms.length ? el('span', { class: 'db-day-flag', 'aria-hidden': 'true' }, '🚩') : null,
        el('span', { 'aria-hidden': 'true' }, wd),
        el('b', { 'aria-hidden': 'true' }, String(D.parse(date).getDate())),
        el('div', { class: 'db-dots', 'aria-hidden': 'true' }, dots)));
    }
    return el('div', { class: 'db-days', role: 'list', 'aria-label': '요일별 일정' }, cells);
  }
  function msEl(x) {
    return el('div', { class: 'db-ms' + (x.main ? ' is-main' : '') },
      el('span', { 'aria-hidden': 'true' }, '🚩'),
      el('span', { class: 'db-ms-date' }, D.fmt(x.date)),
      el('span', x.label));
  }
  function weekCol(w, m, acc, pm) {
    const isCur = w.start === m.curW, isMove = !!m.moveW && w.start === m.moveW;
    const items = w.items.slice().sort(byDue);
    const done = items.filter((i) => i.done).length;
    const late = items.filter((i) => !i.done && normDate(i.due) < m.today).length;
    const open = !acc || ui.openWeeks.has(w.key);
    const ms = w.ms.slice().sort((a, b) => (a.date < b.date ? -1 : 1));
    const headKids = [
      el('div', { class: 'db-wk-top' },
        el('span', { class: 'db-wk-label' }, md(w.start) + ' – ' + md(w.end)),
        w.multi ? el('span', { class: 'chip', title: w.multi + '개 주에 흩어진 후속 일정' }, '후속 일정') : null,
        isCur ? el('span', { class: 'chip db-chip-cur' }, '이번 주') : null,
        isMove ? el('span', { class: 'chip bad' }, '이사 주간') : null,
        late ? el('span', { class: 'badge', title: '기한이 지났는데 아직 못 한 일' }, '밀린 ' + late + '개') : null),
      el('div', { class: 'db-wk-sub' },
        el('span', relWeek(w.start, m.moveW) + (w.multi ? ' ~' : '')),
        el('span', items.length ? done + '/' + items.length + ' 완료' : '할 일 없음')),
      items.length ? MV.ui.progress(done / items.length) : null,
      acc && !open && ms.length ? el('div', { class: 'db-wk-msline' }, ms.map((x) => el('span', { class: 'db-mschip' + (x.main ? ' is-main' : '') }, '🚩 ' + D.fmt(x.date) + ' ' + x.label))) : null,
    ];
    const col = el('div', { class: 'db-wk' + (isCur ? ' is-cur' : '') + (isMove ? ' is-move' : '') + (open ? ' is-open' : ' is-closed'), role: 'listitem', dataset: { week: w.key } });
    const redraw = (gk) => swapCol(col, () => freshCol(w.key, acc) || weekCol(w, m, acc, pm), gk ? '[data-gk="' + cssEsc(gk) + '"]' : '.db-wk-head');
    if (acc) {
      const bodyId = 'db-wk-body-' + w.key;
      const btn = el('button', { type: 'button', class: 'db-wk-head', 'aria-expanded': String(open), 'aria-controls': open ? bodyId : null },
        headKids, el('span', { class: 'db-chev', 'aria-hidden': 'true' }, '▼'));
      btn.addEventListener('click', () => {
        if (ui.openWeeks.has(w.key)) ui.openWeeks.delete(w.key); else ui.openWeeks.add(w.key);
        persistUi();
        redraw(null);
      });
      col.appendChild(btn);
    } else {
      col.appendChild(el('div', { class: 'db-wk-head' }, headKids));
    }
    if (open) {
      // 맨 위: 이정표 깃발 + 이번 주 '중요' 열린 일 FLAG_LIMIT 개 (기한 순). 나머지 중요 항목은 파트 묶음·칩에 ⚑ 로.
      const hiOpen = items.filter((i) => i.priority === 'high' && !i.done);
      const flagged = hiOpen.slice(0, FLAG_LIMIT);
      const fset = new Set(flagged.map((i) => i.id));
      const rest = items.filter((i) => !fset.has(i.id));
      const moreHi = hiOpen.length - flagged.length;
      const body = el('div', { class: 'db-wk-body', id: acc ? 'db-wk-body-' + w.key : null },
        w.multi ? null : dayStrip(w, m, items),
        ms.length || flagged.length ? el('div', { class: 'db-flags' }, ms.map(msEl), flagged.map((i) => weekItemLink(i, pm, true)),
          moreHi > 0 ? el('div', { class: 'db-flags-more' }, '그 밖의 중요 ' + moreHi + '개는 아래 파트별로 ⚑ 표시') : null) : null,
        groupsEl(rest, pm, w.key, redraw),
        !items.length && !ms.length ? el('div', { class: 'db-wk-empty' }, '이 주에 잡힌 일이 없어요.') : null);
      col.appendChild(body);
    }
    return col;
  }
  function pastCol(m, acc, pm) {
    const open = !acc || ui.openWeeks.has('past');
    const col = el('div', { class: 'db-wk is-past' + (open ? ' is-open' : ' is-closed'), role: 'listitem', dataset: { week: 'past' } });
    const redraw = (gk) => swapCol(col, () => freshCol('past', acc) || pastCol(m, acc, pm), gk ? '[data-gk="' + cssEsc(gk) + '"]' : '.db-wk-head');
    const headKids = [
      el('div', { class: 'db-wk-top' },
        el('span', { class: 'db-wk-label' }, '⚠ 지난 주까지'),
        el('span', { class: 'badge' }, '밀린 ' + m.past.length + '개')),
      el('div', { class: 'db-wk-sub' }, el('span', '기한이 지났는데 아직 열려 있는 일'), el('span', '')),
    ];
    if (acc) {
      const btn = el('button', { type: 'button', class: 'db-wk-head', 'aria-expanded': String(open) }, headKids, el('span', { class: 'db-chev', 'aria-hidden': 'true' }, '▼'));
      btn.addEventListener('click', () => {
        if (ui.openWeeks.has('past')) ui.openWeeks.delete('past'); else ui.openWeeks.add('past');
        persistUi();
        redraw(null);
      });
      col.appendChild(btn);
    } else col.appendChild(el('div', { class: 'db-wk-head' }, headKids));
    if (open) col.appendChild(el('div', { class: 'db-wk-body' }, groupsEl(m.past, pm, 'past', redraw)));
    return col;
  }
  // 화면에 놓을 주 목록 — 폰·태블릿 세로(acc)에선 '이사 다음 주 + 한 주' 뒤의 드문드문한 후속 주(임대차 신고·세액공제 등)를 한 칸으로 묶음
  function roadWeeks(m, acc) {
    let weeks = m.weeks;
    if (acc) {
      const later = weeks.filter((w) => D.diff(m.endW, w.start) > 0);
      if (later.length >= 2) {
        weeks = weeks.filter((w) => D.diff(m.endW, w.start) <= 0);
        weeks.push({
          key: 'later', start: later[0].start, end: later[later.length - 1].end, multi: later.length,
          items: [].concat(...later.map((w) => w.items)), ms: [].concat(...later.map((w) => w.ms)),
        });
      }
    }
    return weeks;
  }
  // 칸 하나를 지금 데이터로 새로 만들기 (펼치기·접기) — 다시 그릴 때 그대로 둔 칸이 옛 데이터로 그려지지 않게
  function freshCol(key, acc) {
    const m = roadModel();
    const pm = partMap();
    if (key === 'past') return m.past.length ? pastCol(m, acc, pm) : null;
    const w = roadWeeks(m, acc).find((x) => x.key === key);
    return w ? weekCol(w, m, acc, pm) : null;
  }
  function roadCard(acc, pm) {
    const m = roadModel();
    if (!ui.openWeeks) {
      ui.openWeeks = new Set([m.curW]);
      if (m.past.length) ui.openWeeks.add('past');
    }
    const scroller = el('div', { class: 'db-road-scroll', role: 'list', 'aria-label': '주별 일정', dataset: { dbKey: 'road-scroll', dbDeep: '1' } });
    if (m.past.length) scroller.appendChild(pastCol(m, acc, pm));
    let prev = null;
    roadWeeks(m, acc).forEach((w) => {
      if (prev) {
        const gapWeeks = Math.round(D.diff(prev.start, w.start) / 7) - 1;
        if (gapWeeks > 0) scroller.appendChild(el('div', { class: 'db-gap', role: 'listitem', dataset: { dbKey: 'gap-' + w.key } }, '⋯ ' + gapWeeks + '주 건너뜀'));
      }
      scroller.appendChild(weekCol(w, m, acc, pm));
      prev = w;
    });
    let ctrl = null;
    if (!acc) {
      // 다시 그릴 때 가로 스크롤 칸만 바뀔 수 있어서, 누를 때마다 지금 화면의 칸을 찾음
      const scOf = (e) => { const r = e && e.currentTarget && e.currentTarget.closest ? e.currentTarget.closest('.db-road') : null; return r ? r.querySelector('.db-road-scroll') : null; };
      const step = (dir) => (e) => {
        const sc = scOf(e);
        if (!sc) return;
        const col = sc.querySelector('.db-wk');
        const wpx = col ? col.getBoundingClientRect().width + 12 : 284;
        sc.scrollBy({ left: dir * wpx, behavior: 'smooth' });
      };
      const toCur = (e) => {
        const sc = scOf(e);
        const c = sc ? sc.querySelector('.db-wk.is-cur') : null;
        if (c) sc.scrollTo({ left: Math.max(0, c.offsetLeft - 2), behavior: 'smooth' });
      };
      ctrl = el('div', { class: 'db-road-ctrl' },
        el('button', { type: 'button', class: 'btn btn-sm btn-ghost btn-icon', 'aria-label': '이전 주 보기', onclick: step(-1) }, '◀'),
        el('button', { type: 'button', class: 'btn btn-sm', onclick: toCur }, '이번 주'),
        el('button', { type: 'button', class: 'btn btn-sm btn-ghost btn-icon', 'aria-label': '다음 주 보기', onclick: step(1) }, '▶'));
    }
    const legend = el('div', { class: 'db-legend', dataset: { dbKey: 'road-legend' } },
      el('span', '🚩 이정표'), el('span', '⚑ 중요'), el('span', '✓ 완료'), el('span', '! 기한 지남'),
      m.nodate ? el('a', { href: '#/checklist' }, '기한 없는 일 ' + m.nodate + '개 →') : null);
    const hd = head('🗓️', '주간 워크플랜', '이번 주 → ' + md(m.weeks[m.weeks.length - 1].end) + ' · 날짜가 정해진 일만', ctrl);
    hd.dataset.dbKey = 'road-head';
    return el('section', { class: 'card db-road db-span-12 ' + (acc ? 'is-acc' : 'is-cols'), 'aria-label': '주간 워크플랜', dataset: { dbDeep: '1' } },
      hd, scroller, legend);
  }

  /* ======================= 섹션: 파트별 진행 ======================= */
  /* 파트 묶음(group)을 순서대로 N 칸에 나눠 담습니다.
     예전엔 CSS 다단(columns: 3 250px + break-inside: avoid)이었는데, 다단은 레이아웃 때마다 칸 높이를 맞추느라
     여러 번 다시 계산해서 화면 전체 레이아웃의 대부분을 차지했어요 (가로 화면에서 체크 한 번에 수백 ms).
     그래서 칸 수는 다단과 같은 규칙(칸 최소 PCOL_MIN, 최대 PCOL_MAX)으로 너비에서 정하고, 높이가 고르게 되도록 직접 나눕니다. */
  const PCOL_MIN = 250, PCOL_GAP = 14, PCOL_MAX = 3;
  const colsForWidth = (w) => Math.max(1, Math.min(PCOL_MAX, Math.floor((w + PCOL_GAP) / (PCOL_MIN + PCOL_GAP))));
  function measurePartCols(root) {
    const box = root.querySelector('.db-pgroups');
    let w = box ? box.clientWidth : 0;
    if (!w) {
      // 처음 그릴 때(아직 칸이 없음): 화면 여백·카드 여백을 빼서 어림 — 그린 뒤 실제 너비로 한 번 더 맞춤
      let pad = 48;
      try { const cs = getComputedStyle(root); pad = (parseFloat(cs.paddingLeft) || 0) + (parseFloat(cs.paddingRight) || 0); } catch (e) { /* 기본값 */ }
      w = root.clientWidth - pad - 34;                     // 카드 안쪽 여백 16px + 테두리 1px 씩
    }
    return w > 0 ? colsForWidth(w) : 1;
  }
  // 순서를 지키며 n 개의 연속 묶음으로 나눠, 가장 긴 칸이 가장 짧게 (묶음이 몇 개 안 돼서 전부 따져 봄)
  function splitCols(weights, n) {
    const m = weights.length;
    n = Math.max(1, Math.min(n, m));
    const pre = [0];
    weights.forEach((w, i) => pre.push(pre[i] + w));
    const best = [], cut = [];
    for (let k = 0; k <= n; k++) { best.push(new Array(m + 1).fill(Infinity)); cut.push(new Array(m + 1).fill(0)); }
    best[0][0] = 0;
    for (let k = 1; k <= n; k++) {
      for (let i = k; i <= m; i++) {
        for (let j = k - 1; j < i; j++) {
          const v = Math.max(best[k - 1][j], pre[i] - pre[j]);
          if (v <= best[k][i]) { best[k][i] = v; cut[k][i] = j; }   // 같으면 앞 칸을 더 채움 (다단처럼)
        }
      }
    }
    const out = [];
    let i = m;
    for (let k = n; k >= 1; k--) { const j = cut[k][i]; out.unshift([j, i]); i = j; }
    return out;
  }
  function partsCard(cols) {
    const parts = MV.parts.list();
    const groups = [];
    const gmap = new Map();
    parts.forEach((p) => {
      const g = p.group || '기타';
      if (!gmap.has(g)) { gmap.set(g, []); groups.push(g); }
      gmap.get(g).push(p);
    });
    const tile = (p) => {
      const st = MV.parts.stats(p.id);
      const open = MV.items.byPart(p.id).filter((i) => !i.done).sort(byDue);
      const next = open[0];
      const complete = st.total > 0 && st.done === st.total;
      let nextEl;
      if (next) {
        const late = MV.items.status(next) === 'overdue';
        nextEl = el('div', { class: 'db-tile-next' + (late ? ' is-late' : ''), title: next.title },
          '다음: ' + (D.valid(next.due) ? D.fmt(next.due) + ' ' : '') + next.title);
      } else nextEl = el('div', { class: 'db-tile-next' }, complete ? '모두 완료 ✓' : '아직 항목이 없어요');
      return el('a', { class: 'db-tile' + (complete ? ' is-complete' : ''), href: partHref(p.id), dataset: { dbKey: 'tile-' + p.id }, 'aria-label': p.name + ' · ' + st.total + '개 중 ' + st.done + '개 완료' + (st.overdue ? ' · 지연 ' + st.overdue + '개' : '') },
        el('div', { class: 'db-tile-top' },
          el('span', { class: 'db-tile-emo', 'aria-hidden': 'true' }, p.emoji || '📌'),
          el('span', { class: 'db-tile-name' }, p.name),
          st.overdue ? el('span', { class: 'badge', title: '기한 지난 항목' }, String(st.overdue)) : null,
          el('span', { class: 'db-tile-count' }, st.done + '/' + st.total)),
        el('div', { class: 'db-tile-bar' }, MV.ui.progress(st.pct), el('span', { class: 'db-tile-count2', 'aria-hidden': 'true' }, st.done + '/' + st.total)),
        nextEl);
    };
    let body;
    if (parts.length) {
      const n = Math.max(1, Math.min(isNum(cols) ? cols : 1, groups.length));
      const pg = (g) => el('div', { class: 'db-pg', dataset: { dbKey: 'pg-' + g, dbDeep: '1' } },
        el('div', { class: 'db-pg-title', dataset: { dbKey: 'pgt' } }, g),
        el('div', { class: 'db-tiles', dataset: { dbKey: 'tiles', dbDeep: '1' } }, gmap.get(g).map(tile)));
      // 높이 어림: 묶음 제목 ≈ 타일 0.6개
      const ranges = splitCols(groups.map((g) => 0.6 + gmap.get(g).length), n);
      body = el('div', { class: 'db-pgroups', style: { '--db-pcols': String(ranges.length) }, dataset: { dbKey: 'pgroups', dbDeep: '1' } },
        ranges.map(([a, b], ci) => el('div', { class: 'db-pcol', dataset: { dbKey: 'pcol-' + ci, dbDeep: '1' } }, groups.slice(a, b).map(pg))));
    } else {
      body = el('div', { class: 'db-empty', dataset: { dbKey: 'parts-empty' } }, '파트가 없어요. ', el('a', { href: '#/checklist' }, '체크리스트에서 만들기 →'));
    }
    return el('section', { class: 'card db-parts db-span-12', 'aria-label': '파트별 진행', dataset: { dbDeep: '1' } },
      head('🗂️', '파트별 진행', parts.length + '개 파트', moreLink('체크리스트 →', '#/checklist'), 'parts-head'),
      body);
  }

  /* ======================= 섹션: 최근 활동 · 바로가기 ======================= */
  function activityCard() {
    const acts = (MV.store.get().activity || []).slice(0, 8);
    return el('section', { class: 'card db-activity db-span-7', 'aria-label': '최근 활동', dataset: { dbDeep: '1' } },
      head('🕘', '최근 활동', null, moreLink('전체 기록 →', '#/checklist/~activity'), 'act-head'),
      acts.length
        ? el('ul', { class: 'db-acts', dataset: { dbKey: 'acts', dbDeep: '1' } }, acts.map((a) => el('li', { class: 'db-act', dataset: { dbKey: 'a-' + String(a.at) + '|' + String(a.text || '').slice(0, 60) } },
          el('time', { datetime: a.at }, D.time(a.at)), el('span', String(a.text || '')))))
        : el('div', { class: 'db-empty', dataset: { dbKey: 'acts-empty' } }, '아직 기록이 없어요.'));
  }
  function linksCard() {
    const mover = guideLink('mover');
    const lg = guideLink('appliance');
    const items = [
      { ico: '📐', label: '도면 배치', sub: '두 집 도면에 가구 놓아보기', href: '#/plan' },
      { ico: '🚚', label: '이사업체 가이드', sub: mover.guide ? '견적·계약 체크포인트' : '체크리스트 (가이드 준비 중)', href: mover.href },
      { ico: '🔌', label: 'LG 가전이사', sub: lg.guide ? '이전설치·선입주 양해' : '체크리스트 (가이드 준비 중)', href: lg.href },
      { ico: '📖', label: '모든 가이드', sub: '파트별 정리 노트', href: '#/guide' },
      { ico: '💾', label: '백업', sub: '파일로 저장·복원', onClick: () => { const b = document.getElementById('topbar-menu'); if (b) b.click(); } },
    ];
    return el('section', { class: 'card db-links db-span-5', 'aria-label': '바로가기' },
      head('🧭', '바로가기'),
      el('div', { class: 'db-qlinks' }, items.map((x) => {
        const kids = [el('span', { class: 'db-qlink-ico', 'aria-hidden': 'true' }, x.ico), el('span', el('b', x.label), el('small', x.sub))];
        return x.href
          ? el('a', { class: 'db-qlink', href: x.href }, kids)
          : el('button', { type: 'button', class: 'db-qlink', onclick: x.onClick }, kids);
      })));
  }

  /* ======================= 조립 ======================= */
  /* 다시 그리기는 '바뀐 부분만 바꿔 끼우기'로 합니다.
     체크 하나에 화면 전체(주간 칸 8개 등 레이아웃 객체 3천여 개)를 새로 만들면, 레이아웃·글자 모양 계산을 처음부터 다시 해서
     태블릿 가로 화면에서 체크가 굼떴어요. 그래서 새로 만든 화면과 지금 화면을 비교해, 내용이 그대로인 카드·주 칸은
     기존 노드를 그 자리에 그대로 둡니다 (옮기면 레이아웃을 다시 하므로 옮기지도 않음).
     - data-db-key: 비교 단위 (주 칸은 data-week). data-db-deep: 안쪽 자식 단위로 내려가서 비교하는 묶음
     - 비교는 '만들 때의 HTML'(_dbSig)로 — 그린 뒤 바뀌는 표시용 클래스(has-more 등)에 흔들리지 않게
     - 그대로 둔 노드의 이벤트는 id 로 지금 데이터를 다시 찾거나(체크), 지금 데이터로 칸을 새로 만듦(freshCol) */
  const keyOf = (n) => (n && n.dataset ? (n.dataset.dbKey || n.dataset.week || null) : null);
  const isDeep = (n) => !!(n && n.dataset && n.dataset.dbDeep);
  function seal(n) { if (n && !isDeep(n)) n._dbSig = n.outerHTML; return n; }
  function sealTree(tree) {
    if (!tree) return tree;
    seal(tree);
    tree.querySelectorAll('[data-db-key], [data-week]').forEach(seal);
    return tree;
  }
  const shallow = (n) => n.cloneNode(false).outerHTML;
  // o(지금 화면)를 n(새 화면)과 같게 만들기. 같게 만들었으면 true, 통째로 바꿔야 하면 false
  function patchNode(o, n) {
    const k = keyOf(n);
    if (!k || keyOf(o) !== k) return false;
    if (!isDeep(n)) return !!o._dbSig && o._dbSig === n._dbSig;
    if (!isDeep(o) || shallow(o) !== shallow(n)) return false;
    return patchKids(o, n);
  }
  /* 자식 목록 맞추기 (열쇠로 짝짓기): 순서가 그대로인 자식은 제자리에 두고 안쪽만 맞추고,
     새로 생긴 자식은 앞 자식 바로 뒤에 끼우고, 없어진 자식은 뺍니다 (예: 할 일 한 줄 추가, 최근 활동 한 줄 추가). */
  function patchKids(o, n) {
    const oK = Array.from(o.children), nK = Array.from(n.children);
    if (o.childNodes.length !== oK.length || n.childNodes.length !== nK.length) return false;   // 글자 노드가 섞여 있으면 통째로
    const ko = oK.map(keyOf), kn = nK.map(keyOf);
    if (ko.some((k) => !k) || kn.some((k) => !k)) return false;
    if (new Set(ko).size !== ko.length || new Set(kn).size !== kn.length) return false;      // 열쇠가 겹치면 통째로
    const at = new Map(ko.map((k, j) => [k, j]));
    const plan = [];
    let p = 0;
    kn.forEach((k) => {
      const j = at.get(k);
      if (j != null && j >= p) { plan.push(j); p = j + 1; } else plan.push(-1);   // 순서를 지키는 짝만 재사용
    });
    const used = new Set();
    let last = null;
    nK.forEach((x, i) => {
      const j = plan[i];
      let node = x;
      if (j >= 0) {
        used.add(j);
        if (patchNode(oK[j], x)) node = oK[j]; else oK[j].replaceWith(x);
      } else if (last) last.after(x);
      else o.prepend(x);
      last = node;
    });
    oK.forEach((x, j) => { if (!used.has(j)) x.remove(); });
    return true;
  }
  const keyed = (key, n) => { if (n && n.dataset) n.dataset.dbKey = key; return n; };
  const late = (n) => { n.classList.add('db-late'); return n; };   // 한 줄 레이아웃에서 워크플랜 뒤로
  const partsSection = (cols) => seal(keyed('parts', late(safe('db-span-12', () => partsCard(cols)))));
  function build(acc, cols) {
    const pm = partMap();
    return sealTree(el('div', { class: 'db', dataset: { dbKey: 'db', dbDeep: '1' } },
      el('h1', { class: 'db-sr', dataset: { dbKey: 'title' } }, '대시보드'),
      el('div', { class: 'db-grid', dataset: { dbKey: 'grid', dbDeep: '1' } },
        keyed('hero', safe('db-span-12', heroCard)),
        keyed('now', safe('db-span-7', () => nowCard(pm))),
        late(el('div', { class: 'db-side', dataset: { dbKey: 'side', dbDeep: '1' } }, keyed('money', safe('', moneyCard)), keyed('est', safe('', estimateCard)))),
        keyed('road', safe('db-span-12', () => roadCard(acc, pm))),
        partsSection(cols),
        keyed('activity', late(safe('db-span-7', activityCard))),
        keyed('links', late(safe('db-span-5', linksCard))))));
  }

  MV.view('dashboard', {
    title: '대시보드', short: '홈', icon: '🏠', order: 10,
    render(root, params, ctx) {
      let alive = true;
      sessionDone = new Map();
      // 뒤로 가기·새로고침으로 같은 기록에 돌아온 경우: 펼친 주·가로 스크롤·세로 스크롤을 되살림 (날짜가 바뀌었으면 처음부터)
      const saved = readHS();
      const restore = saved && saved.today === D.today() ? saved : null;
      ui.openWeeks = restore && Array.isArray(restore.open) ? new Set(restore.open.map(String)) : null;
      ui.moreGroups = restore && Array.isArray(restore.more) ? new Set(restore.more.map(String)) : new Set();
      ui.roadScroll = restore && isNum(restore.left) ? restore.left : 0;
      const mq = window.matchMedia ? window.matchMedia(ACC_MQ) : null;
      const isAcc = () => !!(mq && mq.matches);

      /* 화면 상태를 지금 기록(history entry)에 저장 — 링크를 누르는 순간·스크롤이 멈출 때·펼침을 바꿀 때 */
      const onDashboard = () => alive && MV.parseHash().name === 'dashboard' && root.dataset.view === 'dashboard';
      const saveNow = () => {
        if (!onDashboard()) return;
        const sc = root.querySelector('.db-road-scroll');
        if (sc && !isAcc()) ui.roadScroll = sc.scrollLeft;
        writeHS({
          today: D.today(),
          y: Math.round(window.scrollY),
          left: Math.round(ui.roadScroll || 0),
          open: ui.openWeeks ? Array.from(ui.openWeeks) : null,
          more: Array.from(ui.moreGroups),
        });
      };
      let saveT = 0;
      const saveSoon = () => { clearTimeout(saveT); saveT = setTimeout(saveNow, 180); };
      const flush = () => { clearTimeout(saveT); saveNow(); };
      window.addEventListener('scroll', saveSoon, { passive: true });
      document.addEventListener('click', flush, true);          // 링크 이동(해시 변경) 전에 먼저 실행됨
      root.addEventListener('scroll', (e) => {
        const t = e.target;
        if (!t || !t.classList) return;
        if (t.classList.contains('db-road-scroll')) saveSoon();
        else if (t.classList.contains('db-wk-body')) fadeSoon(t);
      }, { capture: true, passive: true });
      persistUi = saveSoon;
      ctx.onCleanup(() => {
        persistUi = () => {};
        clearTimeout(saveT);
        window.removeEventListener('scroll', saveSoon);
        document.removeEventListener('click', flush, true);
      });

      const draw = () => {
        if (!alive) return;
        // 읽기는 바꾸기 전에 한꺼번에 (지금 화면 기준)
        const y = window.scrollY;
        const sc = root.querySelector('.db-road-scroll');
        if (sc) ui.roadScroll = sc.scrollLeft;
        ui.partCols = measurePartCols(root);
        const ae = document.activeElement;
        const focusIn = !!(ae && root.contains(ae));
        const focusId = focusIn && ae.dataset ? ae.dataset.id : null;
        const nu = build(isAcc(), ui.partCols);
        const cur = root.children.length === 1 ? root.firstElementChild : null;
        if (!(cur && patchNode(cur, nu))) root.replaceChildren(nu);   // 바뀐 카드·주 칸만 바꿔 끼움
        // 쓰기(가로 스크롤·포커스) → 읽기(세로 스크롤·칸 흐림) 순서로 모아서, 다시 그릴 때 레이아웃 계산이 한 번만 일어나게
        const nsc = root.querySelector('.db-road-scroll');
        if (nsc && nsc !== sc && ui.roadScroll) nsc.scrollLeft = ui.roadScroll;      // 가로 스크롤 칸을 새로 만든 경우에만
        if (focusId && !(ae.isConnected && root.contains(ae))) {
          const f = root.querySelector('input[data-id="' + (window.CSS && CSS.escape ? CSS.escape(focusId) : focusId) + '"]');
          if (f) f.focus({ preventScroll: true });
        }
        if (Math.abs(window.scrollY - y) > 1) window.scrollTo(0, y);
        fadeAll(root);
      };
      let pending = false;
      const schedule = (e) => {
        if (e && e.reset) return;              // 초기화·복원·동기화는 app.js 가 화면 전체를 다시 그림
        if (pending) return;
        pending = true;
        // 체크 표시 같은 바로 보이는 반응이 먼저 화면에 그려지게, 다음 프레임을 그린 뒤에 다시 그림
        const run = () => { pending = false; draw(); };
        if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => setTimeout(run, 0));
        else setTimeout(run, 0);
      };
      ctx.subscribe(schedule);
      // 창 크기가 바뀌면: '파트별 진행' 칸 수가 달라질 때만 다시 그리고, 아니면 칸 흐림만 다시 확인
      const onResize = MV.debounce(() => {
        if (!alive) return;
        if (measurePartCols(root) !== ui.partCols) schedule(); else fadeAll(root);
      }, 150);
      window.addEventListener('resize', onResize, { passive: true });
      ctx.onCleanup(() => window.removeEventListener('resize', onResize));
      if (mq) {
        const onMq = () => { ui.roadScroll = 0; schedule(); saveSoon(); };
        if (mq.addEventListener) mq.addEventListener('change', onMq); else if (mq.addListener) mq.addListener(onMq);
        ctx.onCleanup(() => { if (mq.removeEventListener) mq.removeEventListener('change', onMq); else if (mq.removeListener) mq.removeListener(onMq); });
      }
      ctx.onCleanup(() => { alive = false; });
      ui.partCols = measurePartCols(root);         // 아직 빈 화면 → 여백으로 어림
      root.appendChild(build(isAcc(), ui.partCols));   // build 가 비교용 서명(_dbSig)까지 붙여 둠
      const sc0 = root.querySelector('.db-road-scroll');
      if (sc0 && ui.roadScroll && !isAcc()) sc0.scrollLeft = ui.roadScroll;
      // 실제 너비로 칸 수를 다시 확인 (어림이 틀렸을 때만 '파트별 진행'만 바꿔 끼움)
      const pc = measurePartCols(root);
      if (pc !== ui.partCols) {
        ui.partCols = pc;
        const oldParts = root.querySelector('.db-grid > .db-parts');
        if (oldParts) oldParts.replaceWith(partsSection(pc));
      }
      fadeAll(root);
      if (restore && isNum(restore.y) && restore.y > 0) {
        // MV.rerender 가 화면을 바꾸면서 맨 위로 올린 다음에 제자리로
        const y = restore.y;
        const put = () => { if (alive && Math.abs(window.scrollY - y) > 1) window.scrollTo(0, y); };
        Promise.resolve().then(put);
        requestAnimationFrame(put);
      }
    },
  });
})();
