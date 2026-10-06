/* ============================================================
   우리집 이사 관리 — 🤖 AI 비서 (통합 에이전트)
   claude.ai 공유 버전에서만 동작합니다. sync.js 가 window.claude 의 기능을 확인해
   MV.sync.cap.sample 을 채우고 MV.store.emit('caps') 를 보내면 메뉴·떠 있는 버튼이 나타납니다.
   GitHub Pages 처럼 window.claude 가 없으면 #/agent 는 안내 카드만 보여 줍니다.

   라우트   #/agent        대화 화면 (메뉴 order 15, 기능이 있을 때만 nav 표시)
   대화     이 브라우저의 localStorage 'mv:agent:chat' 에 마지막 40개 (보는 사람마다 따로)
            같은 브라우저의 다른 탭과는 저장할 때·storage 이벤트 때 메시지 id 로 합침 (지운 id 는 removed 로 기억)
            매 요청 = [지시 턴(오늘·사실·앱 데이터 요약 JSON·규칙)] + 최근 대화 12턴 (120KB 이하)
            끊긴 답을 '다시 보내기'하면 끊긴 글·이미 바꾼 목록을 같이 보내 같은 변경을 되풀이하지 않게 함
            (다시 보내기·도구 없이 묻기는 대화의 마지막 답에만). tools_unavailable 을 받으면 이 창에서는 도구 없이 물음
   도구     sample.limits().tools 가 있을 때만 (없으면 요약만 보고 답하고 '직접 고치세요'로 안내)
            읽기: get_overview, list_items, get_item, list_parts, get_budget, get_estimate,
                  get_workplan(주별 일정), get_move_day(이사 당일 순서), list_inventory
            고치기: update_item, add_item, add_note, update_budget, add_budget_line,
                  add_quote, update_quote, update_inventory, add_inventory
            고치는 도구는 MV.items/MV.inv/MV.store.update 로만 바꾸고 활동 기록에 '🤖 ' 를 붙입니다.
            삭제 도구는 없습니다. 자금흐름 상태가 아직 없으면 자금흐름 화면이 기본값을 만들게 합니다.
   🤖 버튼  #/agent 가 아닌 모든 화면 오른쪽 아래 (모달이 열리면 숨김, 화면 아래 입력줄이 있으면 그 위로)
            페이지가 스크롤되는 화면에는 맨 아래 76px 빈 자리(body.ag-fab-pad)를 둬서 마지막 버튼이 가려지지 않게
   되돌리기 도구가 처음 고치기 직전에 그 할 일·짐(하나씩)·예산·견적(통째로)의 값을 떠 두고, 답 아래 '변경 n건'
            상자에서 그것만 되돌림 (도면 사진·화면 설정·다른 항목은 그대로). 답마다 따로(최근 10개),
            그 답이 고친 것을 이후에 누가 또 고치면 그 답의 되돌리기만 막음. 새로고침하면 사라짐.
   예산     예산 화면과 같은 틀: ① 꼭 드는 이사 비용 기준 11/3 전후 현금(netEssential) ② 살림까지 ③ 전부.
            줄마다 group(essential/purchase/optional), AI가 고친 줄은 edited=true (자금흐름 기본값 바꿈이 건드리지 않게)
   오류     sample 오류 코드마다 한국어 안내, 자동 재시도 없음 (사용자가 '다시 보내기').
   CSS 접두사: ag-
   ============================================================ */
(function () {
  'use strict';
  const el = MV.el;
  const D = MV.date;
  const F = MV.fmt;

  /* ======================= 상수 ======================= */
  const CHAT_KEY = 'mv:agent:chat';
  const DRAFT_KEY = 'mv:agent:draft';
  const PREF_KEY = 'mv:agent:prefs';
  const KEEP_MSGS = 40;               // 저장하는 대화 수
  const SEND_TURNS = 12;              // 한 번에 보내는 최근 대화 수
  const INPUT_BUDGET = 120 * 1024;    // 한 번에 보내는 글 전체 (바이트)
  const TURN_CHARS = 8000;            // 지난 대화 한 턴의 최대 글자 수
  const MAX_TEXT = 4000;              // 입력 최대 글자 수
  const RESULT_BYTES = 28 * 1024;     // 도구 결과 최대 (플랫폼 한도 32KB)
  const MAX_UNDOS = 10;               // 되돌리기를 기억하는 답 수 (이 창에서만)
  const OWNER_LABEL = { '': '미정', '나': '나', '아내': '아내', '함께': '함께' };
  const PRI_LABEL = { high: '중요', mid: '보통', low: '여유' };
  const PRI_RANK = { high: 0, mid: 1, low: 2 };
  /* 자금흐름 예산에서 '자동 계산'이 되는 항목 (view-finance.js 의 LINE_META.auto) */
  const AUTO_BUDGET = new Set(['mover', 'lg', 'waste', 'elevator', 'hug']);
  /* 이 코드가 오면 이 화면에서 기능을 숨김 (다시 묻지 않음) */
  const HIDE_CODES = new Set(['not_granted', 'sampling_disabled', 'not_declared', 'capability_disabled', 'capability_removed']);
  const BLOCK_COPY = {
    not_granted: ['Claude 사용을 허용하지 않았어요', '이 창에서는 AI 비서를 쓸 수 없어요. 페이지를 새로 열고 다시 물어볼 때 허용하면 쓸 수 있어요. 조직에서 막아 둔 경우에는 관리자에게 문의하세요.'],
    sampling_disabled: ['이 계정에서는 Claude를 쓸 수 없어요', '계정이나 조직 설정에서 Claude 사용이 꺼져 있어요. 다른 기능(체크리스트·예산·견적)은 그대로 쓸 수 있어요.'],
    not_declared: ['이 공유 버전에는 AI 비서가 켜져 있지 않아요', '공유 버전을 다시 게시해야 해요. 다른 기능은 그대로 쓸 수 있어요.'],
    capability_disabled: ['이 화면에서는 AI 비서를 쓸 수 없어요', 'Claude 연결이 이 보기에서 꺼져 있어요. claude.ai 에서 공유 버전을 직접 열어 보세요.'],
    capability_removed: ['이 앱 버전에서는 AI 비서를 쓸 수 없어요', 'Claude 앱을 최신으로 업데이트한 뒤 다시 열어 보세요.'],
  };
  const SUGGESTIONS = [
    { id: 'week', icon: '🗓', label: '이번 주 할 일 정리', prompt: () => '이번 주 할 일을 담당자별로 정리해 줘. 기한이 지난 일도 같이 알려 줘.' },
    { id: 'late', icon: '⏰', label: '지연된 일과 해결 방법', prompt: () => '기한이 지난 일을 모두 찾아서, 하나씩 오늘 바로 할 수 있는 해결 방법을 알려 줘.' },
    { id: 'budget', icon: '💰', label: '예산·비용 점검', prompt: () => '이사 예산과 ' + D.fmt(D.moveDate()) + ' 뒤 남는 돈을 점검해 줘. 부족하면 얼마나 부족하고 어떻게 메울 수 있는지 알려 줘.' },
    { id: 'plan', icon: '📈', label: '일정(워크플랜) 점검', prompt: () => '이사일까지 주별 워크플랜을 점검해 줘. 밀린 주·일이 몰린 주와 일정을 조정해야 할 일을 알려 줘.' },
    { id: 'day', icon: '📅', label: () => moveMD() + ' 당일 순서', prompt: () => D.fmt(D.moveDate()) + ' 이사 당일 순서를 시간대별로 알려 줘. 돈 보내는 순서와 각자 맡을 일도 같이.' },
    { id: 'quote', icon: '🚚', label: '이사업체 견적 비교', prompt: () => '받은 이사업체 견적을 모델 추정치와 비교해 줘. 아직 없으면 견적 받을 때 꼭 확인할 점을 알려 줘.' },
    { id: 'kid', icon: '🎒', label: '아이 취학 일정', prompt: () => '아이 취학(2027년 3월 백석초 입학) 관련 일정과 지금 해야 할 일을 정리해 줘.' },
  ];
  const EXAMPLES = [
    'LG 견적 32만원 받았어, 예산에 반영해줘',
    '이사업체 A 견적 210만원, 사다리차 포함 — 견적 비교에 넣어줘',
    '우리은행 질권 확인 끝났어, 체크하고 메모 남겨줘: 질권 없음',
    '다음 주 월요일까지 옷장 주문 할 일 추가해줘 @아내 !중요',
    '남은 예산 얼마나 부족해?',
  ];

  /* ======================= 작은 도우미 ======================= */
  const moveMD = () => { const d = D.parse(D.moveDate()); return d ? (d.getMonth() + 1) + '/' + d.getDate() : '11/3'; };
  const has = (o, k) => !!o && Object.prototype.hasOwnProperty.call(o, k) && o[k] !== undefined;
  const str = (v, max) => String(v == null ? '' : v).trim().slice(0, max || 500);
  const clip = (s, n) => { s = String(s == null ? '' : s).replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1) + '…' : s; };
  const num = (v) => { const n = typeof v === 'number' ? v : parseFloat(v); return isFinite(n) ? n : 0; };
  const fmtDue = (s) => (D.valid(s) ? D.fmt(s) : '기한 없음');
  const won = (n) => F.won(Math.round(num(n)));
  const krw = (n) => F.krw(Math.round(num(n)));
  let enc = null;
  function bytes(s) {
    try { enc = enc || new TextEncoder(); return enc.encode(String(s)).length; } catch (e) { return String(s).length * 3; }
  }
  function hash(s) {
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return (h >>> 0).toString(36) + ':' + s.length;
  }
  function lsGet(k) { try { return window.localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { if (v == null) window.localStorage.removeItem(k); else window.localStorage.setItem(k, v); return true; } catch (e) { return false; } }
  function toBool(v) {
    if (typeof v === 'boolean') return v;
    if (typeof v === 'number') return v !== 0;
    const s = String(v == null ? '' : v).trim().toLowerCase();
    if (['true', '1', 'yes', 'y', '예', '네', '완료', 'o'].indexOf(s) >= 0) return true;
    if (['false', '0', 'no', 'n', '아니오', '아니요', 'x', ''].indexOf(s) >= 0) return false;
    throw new Error('참/거짓(true/false)으로 주세요: ' + clip(v, 30));
  }
  function parseDate(v, label) {
    if (v === null || v === undefined) return null;
    const s = String(v).trim();
    if (!s || s === 'null' || s === '없음' || s === 'none') return null;
    const m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s);
    if (!m) throw new Error((label || '날짜') + '는 YYYY-MM-DD 형식으로 주세요 (예: 2026-10-12). 지우려면 null.');
    const d = new Date(+m[1], +m[2] - 1, +m[3]);
    if (d.getMonth() !== +m[2] - 1 || d.getDate() !== +m[3]) throw new Error('없는 날짜예요: ' + s);
    if (+m[1] < 2020 || +m[1] > 2035) throw new Error('날짜 연도를 확인해 주세요: ' + s);
    return D.str(d);
  }
  function parseOwner(v) {
    const s = String(v == null ? '' : v).trim().replace(/^@/, '');
    if (s === '' || s === '없음' || s === '미정' || s === 'none' || s === 'null') return '';
    if (['나', '남편', '저', 'me', 'husband'].indexOf(s) >= 0) return '나';
    if (['아내', '와이프', '부인', 'wife'].indexOf(s) >= 0) return '아내';
    if (['함께', '같이', '둘다', '둘 다', '부부', 'both', 'together'].indexOf(s) >= 0) return '함께';
    throw new Error('담당자는 나·아내·함께·없음 중 하나로 주세요: ' + clip(v, 20));
  }
  function parsePri(v) {
    const s = String(v == null ? '' : v).trim().replace(/^!/, '').toLowerCase();
    if (['high', '중요', '높음', '급함', 'urgent'].indexOf(s) >= 0) return 'high';
    if (['mid', 'medium', '보통', '중간', 'normal'].indexOf(s) >= 0) return 'mid';
    if (['low', '여유', '낮음'].indexOf(s) >= 0) return 'low';
    throw new Error('우선순위는 high(중요)·mid(보통)·low(여유) 중 하나로 주세요: ' + clip(v, 20));
  }
  function parseAmount(v, label, o) {
    o = o || {};
    let n;
    if (typeof v === 'number') n = v;
    else {
      const s = String(v == null ? '' : v).replace(/[０-９．，]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xFEE0)).trim();
      if (!s) throw new Error((label || '금액') + '이 비어 있어요.');
      n = MV.parseMoney(s);
    }
    if (typeof n !== 'number' || !isFinite(n)) throw new Error((label || '금액') + '을 숫자로 읽을 수 없어요: ' + clip(v, 30) + ' (예: 320000 또는 "32만원")');
    if (n < 0) throw new Error((label || '금액') + '은 0원보다 작을 수 없어요.');
    if (n > (o.max || 1e10)) throw new Error((label || '금액') + '이 너무 커요: ' + krw(n) + ' — 단위를 확인해 주세요.');
    if (o.min && n > 0 && n < o.min) throw new Error((label || '금액') + '이 너무 작아요: ' + won(n) + ' — 원 단위로 주세요 (예: 2100000 또는 "210만원").');
    return Math.round(n);
  }
  function parseDim(v, label) {
    const n = typeof v === 'number' ? v : parseFloat(String(v).replace(/cm$/i, ''));
    if (!isFinite(n) || n < 0 || n > 1000) throw new Error(label + '은(는) 0~1000cm 사이 숫자로 주세요: ' + clip(v, 20));
    return Math.round(n);
  }
  function parseInt0(v, label, max) {
    const n = typeof v === 'number' ? v : parseFloat(v);
    if (!isFinite(n) || n < 0 || n > max) throw new Error(label + '은(는) 0~' + max + ' 사이 숫자로 주세요: ' + clip(v, 20));
    return Math.round(n);
  }
  function safeUrl(u) {
    const s = String(u == null ? '' : u).trim();
    if (!s) return '';
    try {
      const x = new URL(/^[a-z][a-z0-9+.-]*:/i.test(s) ? s : 'https://' + s);
      if (x.protocol !== 'http:' && x.protocol !== 'https:') throw new Error('x');
      return x.href;
    } catch (e) { throw new Error('링크는 http(s) 주소로 주세요: ' + clip(s, 40)); }
  }

  /* ======================= 런타임 상태 ======================= */
  const R = {
    capsSeen: false,
    blocked: null,       // 이 화면에서 기능을 숨기게 한 오류 코드
    toolsOff: false,     // tools_unavailable 을 한 번 받으면 이 창에서는 도구 없이 물음
    tierNote: false,     // ⚡ 빠른 답변을 요금제가 못 받아 다른 모델이 답한 적 있음
    limitsP: null,       // Promise<limits|null>
    limits: undefined,   // 확인된 limits (null = 확인 실패)
    mine: new Set(),     // 이 창에서 만들거나 고친 메시지 id (다른 탭과 합칠 때 이 창 것이 이김)
    removed: new Set(),  // 이 창에서 지운 메시지 id (다른 탭 기록과 합칠 때 다시 살아나지 않게)
    chat: { msgs: [] },
    active: null,        // 진행 중인 요청
    undos: new Map(),    // 답 id → { pre, fp, foreign } — 그 답에서 AI가 고친 것들의 고치기 전 값 (답마다 따로 되돌림)
    inTool: false,       // 도구가 데이터를 바꾸는 중 (그때 생긴 change 는 우리 것)
    draft: lsGet(DRAFT_KEY) || '',
    prefs: loadPrefs(),
    view: null,          // 지금 그려진 화면 참조
    composerFocused: false,
  };

  /* ---- 대화 저장: 같은 브라우저의 다른 탭과 합쳐서 저장 (서로 덮어쓰지 않게) ---- */
  const okMsg = (m) => m && typeof m === 'object' && typeof m.id === 'string' && (m.role === 'user' || m.role === 'assistant') && typeof m.text === 'string';
  function readStored() {
    try {
      const o = JSON.parse(lsGet(CHAT_KEY) || 'null');
      if (o && Array.isArray(o.msgs)) return { msgs: o.msgs.filter(okMsg), removed: Array.isArray(o.removed) ? o.removed.filter((x) => typeof x === 'string') : [] };
    } catch (e) { /* 무시 */ }
    return { msgs: [], removed: [] };
  }
  /** 다른 탭(또는 지난번 창)이 저장한 메시지를 이 창에서 보여 줄 모양으로 */
  function viewCopy(m, first) {
    const c = MV.clone(m);
    if (!Array.isArray(c.changes)) c.changes = [];
    if (first && c.status === 'pending') { c.status = 'stopped'; c.note = '창을 닫거나 새로고침해서 답이 끊겼어요.'; c.actions = []; }
    // 되돌리기 정보는 답을 받은 창에만 있음 (답하는 중에 새로고침한 경우 포함)
    if (c.changes.length && (c.undo === 'avail' || !c.undo)) c.undo = 'gone';
    return c;
  }
  const tms = (m) => { const t = Date.parse(m && m.at); return isFinite(t) ? t : 0; };
  /** 저장된 기록 + 이 창의 기록 → { mem: 이 창에서 보여 줄 목록, store: 저장할 목록, changed: 다른 탭 것이 바뀜 } */
  function mergeChat(stored, first) {
    const removed = new Set(stored.removed);
    R.removed.forEach((id) => removed.add(id));
    const sById = new Map(stored.msgs.map((m) => [m.id, m]));
    const memById = new Map(R.chat.msgs.map((m) => [m.id, m]));
    const rows = [];
    let changed = false;
    R.chat.msgs.forEach((m, k) => {
      if (removed.has(m.id)) { changed = true; return; }
      if (R.mine.has(m.id)) { rows.push({ k, m, s: m }); return; }
      const s = sById.get(m.id);
      if (!s) { changed = true; return; }           // 다른 탭에서 지웠거나 오래돼 밀려남
      if (JSON.stringify(s) !== m._raw) { changed = true; const c = viewCopy(s, false); c._raw = JSON.stringify(s); rows.push({ k, m: c, s }); return; }
      rows.push({ k, m, s });
    });
    stored.msgs.forEach((s, i) => {
      if (memById.has(s.id) || removed.has(s.id)) return;
      const c = viewCopy(s, first);
      c._raw = JSON.stringify(s);
      rows.push({ k: 100000 + i, m: c, s });
      if (!first) changed = true;
    });
    rows.sort((a, b) => (tms(a.m) - tms(b.m)) || (a.k - b.k));
    const keep = rows.slice(-KEEP_MSGS);
    return { mem: keep.map((r) => r.m), store: keep.map((r) => r.s), removed, changed };
  }
  function loadChat() {
    R.chat = { msgs: mergeChat(readStored(), true).mem };
  }
  const stripRaw = (m) => { if (!m || m._raw === undefined) return m; const c = Object.assign({}, m); delete c._raw; return c; };
  function saveChat() {
    const r = mergeChat(readStored(), false);
    R.chat.msgs = r.mem;
    lsSet(CHAT_KEY, JSON.stringify({ v: 2, msgs: r.store.map(stripRaw), removed: Array.from(r.removed).slice(-400) }));
    if (r.changed) repaintSoon();
  }
  /** 이 창이 메시지를 고쳤음 — 다른 탭 기록과 합칠 때 이 창 것을 씀 */
  const own = (m) => { if (m && m.id) { R.mine.add(m.id); delete m._raw; } return m; };
  let repaintTimer = null;
  function repaintSoon() {
    if (repaintTimer) return;
    repaintTimer = setTimeout(() => { repaintTimer = null; paintAll(false); updateComposer(); }, 0);
  }
  window.addEventListener('storage', (e) => {
    if (e.key !== CHAT_KEY) return;
    const r = mergeChat(readStored(), false);
    R.chat.msgs = r.mem;
    if (r.changed) repaintSoon();
  });
  loadChat();
  function loadPrefs() {
    try { const o = JSON.parse(lsGet(PREF_KEY) || '{}'); return { quick: !!(o && o.quick) }; } catch (e) { return { quick: false }; }
  }
  const saveDraft = MV.debounce(() => lsSet(DRAFT_KEY, R.draft ? R.draft : null), 400);

  /* ======================= 사용 가능 여부 ======================= */
  function sampleFn() {
    const c = MV.sync && MV.sync.cap;
    return c && typeof c.sample === 'function' ? c.sample : null;
  }
  const hasClaude = () => { try { return !!(window.claude && typeof window.claude.use === 'function'); } catch (e) { return false; } };
  const available = () => !!sampleFn() && !R.blocked;
  function viewMode() {
    if (R.blocked && sampleFn()) return 'blocked';
    if (sampleFn()) return 'chat';
    if (hasClaude() && !R.capsSeen) return 'waiting';
    return hasClaude() ? 'nocap' : 'off';
  }
  /** nav 표시를 맞추고, 바뀌었으면 true */
  function syncAvailability() {
    const v = MV.views.agent;
    const on = available();
    let changed = false;
    if (v && v.nav !== on) { v.nav = on; changed = true; }
    updateFab();
    return changed;
  }
  function getLimits() {
    const s = sampleFn();
    if (!s) return Promise.resolve(null);
    if (!R.limitsP) {
      R.limitsP = Promise.resolve()
        .then(() => (typeof s.limits === 'function' ? s.limits() : null))
        .then((l) => (l && typeof l === 'object' ? l : null))
        .catch(() => null)
        .then((l) => { R.limits = l; paintHeadState(); return l; });
    }
    return R.limitsP;
  }

  MV.store.on('caps', () => {
    R.capsSeen = true;
    if (syncAvailability()) MV.store.emit('caps', MV.sync && MV.sync.cap);
  });
  MV.store.on('route', () => { updateFab(); if (fab && !fab.hidden) { requestAnimationFrame(placeFab); setTimeout(placeFab, 400); } });

  /* ======================= 떠 있는 🤖 버튼 ======================= */
  let fab = null;
  let fabObserver = null;
  /** 이 화면에 🤖 버튼이 있어야 하는지 (모달 때문에 잠깐 숨긴 것은 빼고 — 아래 여백은 그대로 둬서 화면이 튀지 않게) */
  const fabRoute = () => available() && !!MV.route && MV.route.name !== 'agent';
  function updateFab() {
    if (!document.body) return;
    const show = available() && MV.route && MV.route.name !== 'agent' && !document.querySelector('.modal-back');
    if (!show && !fab) return;
    if (!fab) {
      fab = el('button', {
        type: 'button', class: 'ag-fab', 'aria-label': 'AI 비서 열기', title: 'AI 비서에게 묻기',
        onclick: () => MV.go('#/agent'),
      }, el('span', { class: 'ag-fab-ico', 'aria-hidden': 'true' }, '🤖'), el('span', { class: 'ag-fab-dot', 'aria-hidden': 'true' }));
      MV.css('ag', STYLE);
      document.body.appendChild(fab);
      watchView();
      try {
        fabObserver = new MutationObserver(() => updateFab());
        fabObserver.observe(document.body, { childList: true });
      } catch (e) { /* 무시 */ }
    }
    if (fab.hidden !== !show) fab.hidden = !show;
    padFab(fabRoute());
    fab.classList.toggle('ag-busy', !!R.active);
    fab.title = R.active ? 'AI 비서가 답하는 중 — 눌러서 보기' : 'AI 비서에게 묻기';
    if (show) placeSoon();
  }
  /* 버튼 아래에 화면에 고정된 입력칸·버튼(예: 체크리스트 아래 입력줄)이 있으면 그 위로 올림.
     페이지·목록을 스크롤해서 비킬 수 있는 내용은 그대로 둠 */
  function scrollable(n) {
    const cs = getComputedStyle(n);
    return /(auto|scroll)/.test(cs.overflowY) && n.scrollHeight > n.clientHeight + 2;
  }
  /** ctl 이 화면 아래쪽에 붙어 있는 입력줄(바닥 막대)이면 그 막대의 윗변 y, 아니면 null */
  function bottomBarTop(ctl) {
    const vh = window.innerHeight;
    for (let n = ctl; n && n !== document.body && n !== document.documentElement; n = n.parentElement) {
      const pos = getComputedStyle(n).position;
      if (pos === 'fixed' || pos === 'sticky') {
        const r = n.getBoundingClientRect();
        // 목차처럼 위아래로 긴 고정 영역은 올려도 소용없으니 그대로 둠
        return (r.height < vh * 0.4 && r.bottom > vh * 0.6) ? r.top : null;
      }
      if (n !== ctl && scrollable(n)) return null;
    }
    // 페이지가 스크롤되지 않는 화면(예: 데스크톱 체크리스트)에서 아래쪽에 있는 버튼·입력칸
    if (document.documentElement.scrollHeight > vh + 2) return null;
    const r = ctl.getBoundingClientRect();
    return r.bottom > vh * 0.7 ? r.top : null;
  }
  function probeFab() {
    const r = fab.getBoundingClientRect();
    const pts = [[r.left + r.width / 2, r.top + r.height / 2], [r.left + 5, r.top + 5], [r.right - 5, r.top + 5], [r.left + 5, r.bottom - 5], [r.right - 5, r.bottom - 5]];
    let top = null;
    fab.style.pointerEvents = 'none';
    try {
      pts.forEach(([x, y]) => {
        if (x < 0 || y < 0 || x >= window.innerWidth || y >= window.innerHeight) return;
        const e = document.elementFromPoint(x, y);
        if (!e || e === fab || fab.contains(e) || e.closest('#nav, .toast-wrap, .modal-back')) return;
        const ctl = e.closest('button, a[href], input, textarea, select, [role="button"], [contenteditable="true"]');
        if (!ctl) return;
        const t = bottomBarTop(ctl);
        if (t !== null && (top === null || t < top)) top = t;
      });
    } finally { fab.style.pointerEvents = ''; }
    return top;
  }
  /* 페이지가 스크롤되는 화면에서는 맨 아래에 버튼만큼 빈 자리를 둬서 마지막 버튼·입력칸이 🤖 아래에 갇히지 않게 */
  const FAB_PAD = 76;
  function padFab(show) {
    const b = document.body;
    if (!b) return;
    const on = b.classList.contains('ag-fab-pad');
    let want = !!show;
    if (want) want = document.documentElement.scrollHeight - (on ? FAB_PAD : 0) > window.innerHeight + 2;
    if (want !== on) b.classList.toggle('ag-fab-pad', want);
  }
  function placeFab() {
    padFab(!!fab && fab.isConnected && fabRoute());
    if (!fab || fab.hidden || !fab.isConnected) return;
    // 움직이는 중(transition)에는 위치를 잴 수 없으니 잠깐 끄고 재요
    const from = fab.style.bottom;
    fab.style.transition = 'none';
    fab.style.removeProperty('bottom');
    for (let k = 0; k < 3; k++) {
      const top = probeFab();
      if (top === null) break;
      const b = Math.round(window.innerHeight - top + 10);
      if (b > window.innerHeight * 0.6) { fab.style.removeProperty('bottom'); break; }
      fab.style.bottom = b + 'px';
    }
    const to = fab.style.bottom;
    if (from !== to) { fab.style.bottom = from; void fab.offsetWidth; }
    fab.style.transition = '';
    if (from !== to) fab.style.bottom = to;
  }
  let placeTimer = null;
  /* 묶어서 한 번 (계속 바뀌는 화면에서도 늦어도 ms 뒤에는 실행) */
  function placeSoon(ms) {
    if (placeTimer) return;
    placeTimer = setTimeout(() => { placeTimer = null; requestAnimationFrame(placeFab); }, ms == null ? 120 : ms);
  }
  let viewObserver = null;
  function watchView() {
    if (viewObserver) return;
    const v = document.getElementById('view');
    if (!v) return;
    try {
      viewObserver = new MutationObserver(() => { if (fab && !fab.hidden) placeSoon(160); });
      viewObserver.observe(v, { childList: true, subtree: true, attributes: true, attributeFilter: ['hidden'] });
    } catch (e) { /* 무시 */ }
    window.addEventListener('resize', () => placeSoon(120), { passive: true });
    window.addEventListener('scroll', () => { if (fab && !fab.hidden) placeSoon(60); }, { passive: true });
  }

  /* ======================= 앱 데이터 요약 ======================= */
  function partName(id) { const p = MV.parts.get(id); return p ? p.name : (id || ''); }
  function itemHref(it) { return '#/checklist/' + encodeURIComponent(it.partId || '~all') + '/' + encodeURIComponent(it.id); }
  function compactItem(it) {
    return {
      id: it.id, partId: it.partId, part: partName(it.partId), title: it.title,
      due: D.valid(it.due) ? it.due : null, dueFmt: fmtDue(it.due), done: !!it.done,
      owner: it.owner || '', priority: it.priority || 'mid', status: MV.items.status(it),
      notes: Array.isArray(it.notes) ? it.notes.length : 0,
    };
  }
  function byDue(a, b) {
    const ad = D.valid(a.due) ? a.due : '9999-99-99';
    const bd = D.valid(b.due) ? b.due : '9999-99-99';
    if (ad !== bd) return ad < bd ? -1 : 1;
    const pr = (PRI_RANK[a.priority] == null ? 1 : PRI_RANK[a.priority]) - (PRI_RANK[b.priority] == null ? 1 : PRI_RANK[b.priority]);
    if (pr) return pr;
    return (a.order || 0) - (b.order || 0);
  }
  /* 예산 묶음 — view-finance.js 의 GROUPS·GROUP_OF 와 같은 규칙 (줄에 group 이 없으면 id 로, 직접 넣은 줄은 '새로 사는 살림') */
  const GROUP_LABEL = { essential: '꼭 드는 이사 비용', purchase: '새로 사는 살림', optional: '선택·나중에' };
  const GROUP_OF = { mover: 'essential', lg: 'essential', elevator: 'essential', waste: 'essential', internet: 'essential', washer: 'purchase', wardrobe: 'optional', hug: 'optional', deco: 'purchase', clean: 'optional', reserve: 'optional' };
  const groupOf = (l) => (l && GROUP_LABEL[l.group] ? l.group : (l && GROUP_OF[l.id]) || 'purchase');
  function parseGroup(v) {
    const s = str(v, 20).toLowerCase().replace(/\s+/g, '');
    if (GROUP_LABEL[s]) return s;
    if (/^(꼭|필수|이사비|이사비용|꼭드는)/.test(s)) return 'essential';
    if (/^(살림|구매|구입|새로사는)/.test(s)) return 'purchase';
    if (/^(선택|나중)/.test(s)) return 'optional';
    throw new Error('묶음(group)은 essential(꼭 드는 이사 비용)·purchase(새로 사는 살림)·optional(선택·나중에) 중 하나로 주세요.');
  }
  /** 이름으로 묶음 짐작 (모델이 group 을 안 줬을 때) */
  function guessGroup(label) {
    const s = String(label || '');
    if (/옷장|세탁기|냉장고|건조기|가구|가전|커튼|소품|침대|소파|책상|식탁|매트리스|조명|구매|구입/.test(s)) return 'purchase';
    if (/보증료|보험|나중|선택|HUG/i.test(s)) return 'optional';
    if (/이사|청소|폐기|엘리베이터|사다리|인터넷|이전|설치|보관|관리비|정산|도시가스|수리|열쇠|도어락|용달/.test(s)) return 'essential';
    return 'purchase';
  }
  const verdict = (n) => (n < 0 ? '부족 ' : '여유 ') + krw(Math.abs(n));
  /** financeSummary 의 경고 — 예산(부족) 경고는 잘리지 않게 앞으로 */
  function financeWarnings(fs, max) {
    const ws = Array.isArray(fs && fs.warnings) ? fs.warnings.filter((w) => w && w.text) : [];
    const isBudget = (w) => (/이사 비용|예산/.test(w.text) ? 1 : 0);
    const sorted = ws.map((w, i) => ({ w, i })).sort((a, b) => (isBudget(b.w) - isBudget(a.w)) || (a.i - b.i)).map((x) => x.w);
    return { list: sorted.slice(0, max).map((w) => clip(w.text, 170)), more: Math.max(0, sorted.length - max) };
  }
  /** 예산 숫자 — 자금흐름 '이사 비용 예산' 화면과 같은 틀: ① 꼭 드는 비용 기준(머리 숫자) ② 살림까지 ③ 전부 */
  function moneyFrame(fs) {
    const n = (k) => Math.round(num(fs[k]));
    const has3 = isFinite(fs.netEssential) && isFinite(fs.essentialUnpaid);
    const move = D.fmt(D.moveDate());
    const out = {
      leftoverAfterMoveDay: n('leftover'),
      essentialToPay: has3 ? n('essentialUnpaid') : null,
      purchaseToPay: has3 ? n('purchaseUnpaid') : null,
      optionalToPay: has3 ? n('optionalUnpaid') : null,
      netEssential: has3 ? n('netEssential') : n('net'),
      netWithPurchases: has3 ? n('netWithPurchases') : n('net'),
      netAll: n('net'),
      alreadyPaid: n('expensesPaid'), budgetTotal: n('expensesAll'), stillToPayAll: n('expensesTotal'),
      refundsExpected: n('refunds'), netAllWithRefunds: n('netWithRefunds'),
      rentOnMoveDay: n('rentPart'),
    };
    out.text = {
      headline: move + ' 전후 꼭 필요한 현금: 꼭 드는 이사 비용 ' + (has3 ? krw(out.essentialToPay) : '?') + ' → ' + (out.netEssential < 0 ? '⚠ 내면 ' : '내고 ') + verdict(out.netEssential),
      withPurchases: '새로 사는 살림' + (has3 ? '(' + krw(out.purchaseToPay) + ')' : '') + '까지: ' + verdict(out.netWithPurchases),
      allIncluded: '선택·나중에' + (has3 ? '(' + krw(out.optionalToPay) + ')' : '') + '까지 전부: ' + verdict(out.netAll),
      leftoverAfterMoveDay: move + ' 돈 흐름 뒤 남는 돈 ' + krw(out.leftoverAfterMoveDay),
      rent: out.rentOnMoveDay ? move + ' 돈 흐름에 11월 월세 ' + krw(out.rentOnMoveDay) + ' 포함 — 계약서상 후불이면 그만큼 덜 나가요 (확인 필요)' : '',
    };
    return out;
  }
  function financeSummaryNow() {
    try { return MV.calc && typeof MV.calc.financeSummary === 'function' ? MV.calc.financeSummary(MV.store.get()) : null; } catch (e) { return null; }
  }
  function financeNumbers() {
    const fs = financeSummaryNow();
    if (!fs || typeof fs !== 'object') return null;
    const f = moneyFrame(fs);
    const w = financeWarnings(fs, 6);
    return {
      howToRead: '예산·부족 질문에는 예산 화면(#/money/budget)과 같은 순서로: ① cashVsEssential(머리 숫자) ② withPurchases ③ allIncluded. "부족"을 하나로 뭉뚱그리지 마세요.',
      cashVsEssential: f.text.headline,
      withPurchases: f.text.withPurchases,
      allIncluded: f.text.allIncluded,
      leftoverAfterMoveDay: f.text.leftoverAfterMoveDay,
      rentNote: f.text.rent || undefined,
      alreadyPaid: krw(f.alreadyPaid),
      refundsExpected: krw(f.refundsExpected) + ' (받으면 전부 기준 ' + verdict(f.netAllWithRefunds) + ')',
      warnings: w.list,
      moreWarnings: w.more || undefined,
    };
  }
  function estimateNumbers() {
    let est = null;
    try { est = MV.calc && typeof MV.calc.moveEstimate === 'function' ? MV.calc.moveEstimate(MV.store.get()) : null; } catch (e) { est = null; }
    if (!est || typeof est !== 'object') return null;
    const quotes = quotesOf(MV.store.get());
    return {
      basis: est.vatIncl ? '부가세 포함' : '부가세 별도',
      typical: won(est.typical), low: won(est.low), high: won(est.high),
      payWithVat: est.pay ? won(est.pay.typical) : null,
      truck: est.truckLabel || (num(est.tons) + '톤'), tons: est.tons, crew: est.crewLabel || est.crew,
      lgCost: est.lgCost && isFinite(est.lgCost.typical) ? won(est.lgCost.typical) : null,
      quotes: quotes.filter((q) => num(q.amount) > 0).length,
    };
  }
  function overview() {
    const st = MV.store.get();
    const today = D.today();
    const move = D.moveDate();
    const items = Array.isArray(st.items) ? st.items : [];
    const all = MV.parts.stats();
    const parts = MV.parts.list().map((p) => {
      const s = MV.parts.stats(p.id);
      return { id: p.id, name: p.name, done: s.done, total: s.total, overdue: s.overdue };
    });
    const open = items.filter((i) => !i.done);
    const soon = open.filter((i) => D.valid(i.due) && D.diff(today, i.due) <= 14).sort(byDue);
    const fateCount = {};
    (st.inventory || []).forEach((x) => { const f = MV.inv.fate(x && x.fate).label; fateCount[f] = (fateCount[f] || 0) + 1; });
    return {
      today, todayFmt: D.fmt(today), moveDate: move, moveDateFmt: D.fmt(move), dday: D.dday(move).label,
      progress: { done: all.done, total: all.total, overdue: all.overdue, dueToday: all.today, open: open.length, openNoDate: open.filter((i) => !D.valid(i.due)).length },
      parts,
      upcoming14d: soon.slice(0, 40).map((i) => ({ id: i.id, part: i.partId, title: clip(i.title, 70), due: i.due, dueFmt: D.fmt(i.due), owner: i.owner || '', priority: i.priority || 'mid', status: MV.items.status(i) })),
      upcomingMore: Math.max(0, soon.length - 40),
      finance: financeNumbers(),
      estimate: estimateNumbers(),
      inventory: { total: (st.inventory || []).length, byFate: fateCount },
      recentActivity: (st.activity || []).slice(0, 6).map((a) => D.time(a.at) + ' ' + clip(a.text, 80)),
    };
  }
  function weekRefs() {
    const today = D.today();
    const move = D.moveDate();
    const out = [];
    const last = D.weekStart(D.add(move, 7));
    let w = D.weekStart(today);
    const names = ['이번 주', '다음 주', '다다음 주'];
    for (let k = 0; k < 8 && w <= last; k++) {
      out.push((names[k] || (k + '주 뒤')) + ' ' + D.fmt(w) + '~' + D.fmt(D.add(w, 6)));
      w = D.add(w, 7);
    }
    return out.join(', ');
  }
  function instruction(withTools) {
    const today = D.today();
    const move = D.moveDate();
    let data = '';
    try { data = JSON.stringify(overview()); } catch (e) { data = '{"error":"요약을 만들지 못했어요"}'; }
    const rules = [
      '1. 한국어 존댓말로 짧고 실용적으로 답하세요. 서론 없이 바로, 목록과 **굵은 글씨**로 핵심을 보여 주세요.',
      withTools
        ? '2. 세부 내용은 추측하지 말고 도구로 읽으세요. 바꿔 달라는 요청이면 도구로 바로 바꾸고, 답에 무엇을 어떻게 바꿨는지(항목 이름, 이전 값 → 새 값) 정확히 적으세요. 무엇을 바꿀지 애매하면 바꾸기 전에 짧게 되물으세요. 삭제 도구는 없으니 지우는 일은 화면에서 직접 하도록 안내하세요.'
        : '2. 이번 대화에서는 앱 데이터를 직접 읽거나 바꿀 수 없어요. 위 요약으로 답하고, 바꿔야 할 내용은 사용자가 직접 고치도록 어느 화면에서 무엇을 바꾸면 되는지 링크와 함께 알려 주세요. 바꿨다고 말하면 안 돼요.',
      '3. 금액·법률·세금·은행 규정을 지어내지 마세요. 데이터에 없으면 "확인 필요"라고 쓰고 누구에게 물을지(은행·중개사·세무사·주민센터·관리사무소·이사업체 등) 알려 주세요.',
      '4. 사람 이름·전화번호·계좌번호·주민등록번호·동·호수 같은 개인 식별 정보는 쓰지 마세요. 사람은 A·B·C·중개사로 부르세요.',
      '5. 날짜는 M/D(요일) 형식(예: ' + D.fmt(move) + '), 금액은 "32만원", "2억 9,500만원"처럼 쓰세요. "다음 주 월요일" 같은 말은 [날짜 참고]로 실제 날짜(YYYY-MM-DD)를 계산하세요.',
      '6. 할 일을 추가·수정할 때 "@아내"·"@나"·"@함께"는 담당자, "!중요"는 priority high("!보통" mid, "!여유" low)예요. 파트를 말하지 않으면 가장 알맞은 파트를 고르세요.',
      '7. 앱 화면 링크를 마크다운으로 붙일 수 있어요: [할 일](#/checklist/<partId>/<itemId>), [지금 할 일](#/checklist/~focus), [예산](#/money/budget), [' + D.fmt(move) + ' 돈 흐름](#/money/flow), [업체 견적](#/stuff/quotes), [이사 견적](#/stuff/estimate), [짐 목록](#/stuff/inventory), [대시보드](#/dashboard), [가이드](#/guide/<partId>).',
      '8. 예산·부족을 물으면 예산 화면(#/money/budget)과 같은 순서로 답하세요: ① 꼭 드는 이사 비용 기준 ' + D.fmt(move) + ' 전후 현금 여유/부족(머리 숫자 — finance.cashVsEssential) ② 새로 사는 살림까지 ③ 선택·나중에까지 전부. "부족"을 한 숫자로 뭉뚱그리지 마세요. 중개보수·잔금·대출 상환·월세는 예산이 아니라 돈 흐름에 이미 들어 있어요.',
      '9. 지난 답에 "(이 답에서 앱에 이미 반영한 변경: …)"이 붙어 있으면 그 변경은 이미 저장됐어요 — 같은 변경을 다시 하지 마세요.',
    ];
    return [
      '[역할]',
      '당신은 이 가족의 이사 관리 비서입니다. 가족은 나(남편)·아내·유치원생 아이 한 명이에요. 이 앱 "우리집 이사 관리"의 체크리스트(할 일·메모), 주간 워크플랜(일정), 이사 예산·자금흐름(비용), 이사업체 견적, 짐 목록을 함께 관리하고 진척도·비용·일정을 챙깁니다.',
      '',
      '[오늘] ' + today + ' ' + D.fmt(today) + ' · 이사일 ' + move + ' ' + D.fmt(move) + ' · ' + D.dday(move).label,
      '[날짜 참고] ' + weekRefs(),
      '',
      '[확정된 사실]',
      '- ' + D.fmt(move) + ' 이사: 등촌우성 2층(전용 66.9㎡, 붙박이장 있음) → 서광등촌마을 14층(전용 59.67㎡, 붙박이장 없음).',
      '- 보증금·대출 흐름: A(지금 집 집주인)에게 보증금 남은 3.78억 받기 → 우리전세론 0.78억 상환 → C(새 집 집주인)에게 잔금 2.95억 송금. 11월 월세 70만원은 계약서상 "매월 3일 후불"이라 이사 날 낼지 확인 필요.',
      '- 중개보수 법정 상한 117만원(부가세 별도).',
      '- 아이는 유치원생이고 2027년 3월 백석초 입학 예정.',
      '- 사람: A = 지금 집 집주인, B = 지금 집 매수인, C = 새 집 집주인, 중개사.',
      '',
      '[지금 앱 데이터 요약 (JSON, 방금 계산)]',
      data,
      '',
      '[답하는 방법]',
      rules.join('\n'),
    ].join('\n');
  }

  /* ======================= 도구 ======================= */
  function needItem(id) {
    const s = str(id, 120);
    if (!s) throw new Error('할 일 id 가 필요해요. list_items 로 먼저 찾아 주세요.');
    const it = MV.items.get(s);
    if (!it) throw new Error('id 가 "' + s + '"인 할 일을 찾지 못했어요. list_items 로 먼저 찾아 정확한 id 를 쓰세요.');
    return it;
  }
  function record(ctx, t, href) {
    ctx.call.changes.push({ t: String(t), href: href || null });
    paintMsg(ctx.call.msgId);
  }
  /* ---- 되돌리기용 기록: AI가 고친 것만 (할 일·짐은 하나씩, 예산·견적은 통째로) ----
     touch = { items: [id...] } | { inventory: [id...] } | { section: 'finance' | 'estimate' }
     pre   = { items: {id: 고치기 전 값 | null(새로 만듦)}, inventory: {...}, sections: {key: 값 | null(없었음)} } */
  const NONE = null;
  function entityNow(kind, id) {
    const st = MV.store.get();
    const list = Array.isArray(st[kind]) ? st[kind] : [];
    const x = list.find((y) => y && y.id === id);
    return x === undefined ? NONE : x;
  }
  function sectionNow(key) { const v = MV.store.get()[key]; return v === undefined ? NONE : v; }
  function touchKeys(touch) {
    const out = [];
    if (touch.items) touch.items.forEach((id) => out.push(['items', id]));
    if (touch.inventory) touch.inventory.forEach((id) => out.push(['inventory', id]));
    if (touch.section) out.push(['sections', touch.section]);
    return out;
  }
  const valueOf = (kind, id) => (kind === 'sections' ? sectionNow(id) : entityNow(kind, id));
  function fpValue(v) { try { return hash(JSON.stringify(v === undefined ? null : v)); } catch (e) { return MV.uid('fp'); } }
  /** 되돌리기 대상(AI가 고친 것)의 지금 모습 지문 — 이게 바뀌면(사람이 이후에 고치면) 한 번에 되돌리기를 막음 */
  function undoFingerprint(pre) {
    if (!pre) return '';
    const parts = [];
    ['items', 'inventory', 'sections'].forEach((kind) => Object.keys(pre[kind] || {}).sort().forEach((id) => parts.push(kind + ':' + id + '=' + fpValue(valueOf(kind, id)))));
    // AI가 새로 넣은 짐을 도면에 놓았으면 되돌릴 때 배치가 깨지니 도면 배치도 같이 봄
    if (Object.keys(pre.inventory || {}).some((id) => pre.inventory[id] === NONE)) parts.push('layouts=' + fpValue(MV.store.get().layouts));
    return parts.join('|');
  }
  /** 도구가 데이터를 바꿀 때 — 중지됐거나 끝난 요청이면 바꾸지 않음. touch: 무엇을 바꾸는지 (되돌리기용) */
  function mutate(ctx, fn, touch) {
    if (ctx.signal && ctx.signal.aborted) throw new Error('중지해서 바꾸지 않았어요.');
    if (R.active !== ctx.call) throw new Error('이 요청은 이미 끝나서 바꾸지 않았어요.');
    const call = ctx.call;
    const keys = touch ? touchKeys(touch) : [];
    keys.forEach(([kind, id]) => {
      const box = call.pre[kind];
      if (!Object.prototype.hasOwnProperty.call(box, id)) box[id] = MV.clone(valueOf(kind, id));
      // AI가 앞서 고친 뒤에 사람이 같은 것을 또 고쳤으면 되돌릴 때 그것도 되돌아감 → 확인 창에서 알림
      else if (call.post[kind + ':' + id] && call.post[kind + ':' + id] !== fpValue(valueOf(kind, id))) call.foreign = true;
    });
    R.inTool = true;
    try { return fn(); } finally {
      R.inTool = false;
      keys.forEach(([kind, id]) => { call.post[kind + ':' + id] = fpValue(valueOf(kind, id)); });
    }
  }
  function capResult(out) {
    if (typeof out === 'string') return bytes(out) <= RESULT_BYTES ? out : out.slice(0, 8000) + '…(잘림)';
    let s;
    try { s = JSON.stringify(out); } catch (e) { return '결과를 만들지 못했어요.'; }
    if (bytes(s) <= RESULT_BYTES) return out;
    const o = Object.assign({}, out);
    Object.keys(o).forEach((k) => {
      if (!Array.isArray(o[k])) return;
      while (o[k].length > 1 && bytes(JSON.stringify(o)) > RESULT_BYTES) o[k] = o[k].slice(0, Math.max(1, Math.floor(o[k].length * 0.7)));
      o.truncated = true;
    });
    s = JSON.stringify(o);
    return bytes(s) <= RESULT_BYTES ? o : s.slice(0, 8000) + '…(잘림)';
  }

  /* ---- 예산 (state.finance — view-finance.js 와 같은 모양) ---- */
  function financeReady(st) {
    return !!(st && st.finance && typeof st.finance === 'object' && st.finance.budget && Array.isArray(st.finance.budget.lines));
  }
  /** 자금흐름 상태가 아직 없으면 자금흐름 화면이 기본값을 만들게 함 (화면 밖에서 한 번 그림) */
  function ensureFinance() {
    if (financeReady(MV.store.get())) return MV.store.get().finance;
    const v = MV.views.money;
    if (v && typeof v.render === 'function') {
      const host = document.createElement('div');
      const cleanups = [];
      const route = MV.route;
      const ctx = { onCleanup: (fn) => cleanups.push(fn), subscribe: (fn) => cleanups.push(MV.store.on('change', fn)) };
      try {
        const r = v.render(host, ['budget'], ctx);
        if (typeof r === 'function') cleanups.push(r);
      } catch (e) { console.warn('[agent] finance bootstrap', e); }
      cleanups.forEach((fn) => { try { fn(); } catch (e) { /* 무시 */ } });
      MV.route = route;
    }
    const st = MV.store.get();
    if (!financeReady(st)) throw new Error('자금흐름 화면이 아직 준비되지 않아 예산을 읽을 수 없어요. 자금흐름 화면을 한 번 열어 주세요.');
    if (!Array.isArray(st.finance.budget.refunds)) st.finance.budget.refunds = [];
    return st.finance;
  }
  function withLine(st, id, patch) {
    const f = st.finance;
    return Object.assign({}, st, { finance: Object.assign({}, f, { budget: Object.assign({}, f.budget, {
      lines: f.budget.lines.map((x) => (x && x.id === id ? Object.assign({}, x, patch) : x)),
    }) }) });
  }
  /** 항목별로 실제 예산에 잡히는 금액 (자동 항목은 자금흐름 계산 그대로 — 켜고 끈 합계의 차이) */
  function lineValue(st, line) {
    const fsum = MV.calc && MV.calc.financeSummary;
    if (AUTO_BUDGET.has(line.id) && line.auto !== false && typeof fsum === 'function') {
      try {
        const on = fsum(withLine(st, line.id, { on: true })).expensesAll;
        const off = fsum(withLine(st, line.id, { on: false })).expensesAll;
        if (isFinite(on) && isFinite(off)) return Math.round(on - off);
      } catch (e) { /* 무시 */ }
    }
    return Math.round(num(line.amount));
  }
  /** 도구 결과용 예산 요약 — 숫자(원) + 화면과 같은 틀의 글 */
  function budgetSummary() {
    const fs = financeSummaryNow();
    if (!fs || typeof fs !== 'object') return null;
    const f = moneyFrame(fs);
    const w = financeWarnings(fs, 5);
    return {
      howToRead: '"얼마나 부족해?"에는 text.headline(꼭 드는 이사 비용 기준, 예산 화면 머리 숫자)을 먼저, 그다음 withPurchases, allIncluded 순서로 답하세요.',
      leftoverAfterMoveDay: f.leftoverAfterMoveDay,
      essentialToPay: f.essentialToPay, purchaseToPay: f.purchaseToPay, optionalToPay: f.optionalToPay,
      netEssential: f.netEssential, netWithPurchases: f.netWithPurchases, netAll: f.netAll,
      alreadyPaid: f.alreadyPaid, budgetTotal: f.budgetTotal, refundsExpected: f.refundsExpected,
      text: Object.assign({ balance: '꼭 드는 이사 비용 기준 ' + verdict(f.netEssential) + ' (전부 포함 ' + verdict(f.netAll) + ')' }, f.text),
      warnings: w.list,
    };
  }
  function lineView(st, l) {
    const v = lineValue(st, l);
    const g = groupOf(l);
    return {
      id: l.id, label: l.label, amount: v, amountTxt: krw(v),
      group: g, groupLabel: GROUP_LABEL[g],
      mode: AUTO_BUDGET.has(l.id) ? (l.auto !== false ? 'auto' : 'manual') : 'manual',
      included: l.on !== false, paid: !!l.paid, date: l.date || '', memo: clip(l.memo, 120),
    };
  }
  function findBudget(fin, key) {
    const k = str(key, 120);
    if (!k) throw new Error('예산 항목 id 가 필요해요. get_budget 으로 확인하세요.');
    const lines = fin.budget.lines.filter((x) => x && typeof x === 'object');
    const refunds = (fin.budget.refunds || []).filter((x) => x && typeof x === 'object');
    let hit = lines.find((x) => x.id === k);
    if (hit) return { line: hit, refund: false };
    hit = refunds.find((x) => x.id === k);
    if (hit) return { line: hit, refund: true };
    const low = k.toLowerCase().replace(/\s+/g, '');
    const norm = (s) => String(s || '').toLowerCase().replace(/\s+/g, '');
    const exact = lines.filter((x) => norm(x.label) === low).map((x) => ({ line: x, refund: false }))
      .concat(refunds.filter((x) => norm(x.label) === low).map((x) => ({ line: x, refund: true })));
    if (exact.length === 1) return exact[0];
    const part = lines.filter((x) => norm(x.label).indexOf(low) >= 0).map((x) => ({ line: x, refund: false }))
      .concat(refunds.filter((x) => norm(x.label).indexOf(low) >= 0).map((x) => ({ line: x, refund: true })));
    if (part.length === 1) return part[0];
    throw new Error('예산 항목 "' + k + '"을(를) ' + (part.length > 1 ? '하나로 정할 수 없어요' : '찾지 못했어요') + '. id 로 주세요. 항목: ' +
      lines.map((x) => x.id + '(' + x.label + ')').concat(refunds.map((x) => x.id + '(들어올 돈: ' + x.label + ')')).join(', '));
  }

  /* ---- 견적 (state.estimate.quotes — view-estimate.js 와 같은 모양) ---- */
  function quotesOf(st) {
    const e = st && st.estimate;
    return e && Array.isArray(e.quotes) ? e.quotes.filter((q) => q && typeof q === 'object') : [];
  }
  function newQuote() {
    return { id: MV.uid('qt'), company: '', date: '', amount: null, vatIncluded: true, tons: null, crew: null, ladder: false, aircon: false, arrange: false, waste: false, deposit: null, licenseChecked: false, insuranceChecked: false, visitDone: false, note: '' };
  }
  function modelEstimate() {
    try { return MV.calc && typeof MV.calc.moveEstimate === 'function' ? MV.calc.moveEstimate(MV.store.get()) : null; } catch (e) { return null; }
  }
  /** 업체 견적 → 모델과 같은 조건·같은 부가세 기준 (빠진 항목은 모델 금액을 더함) — 견적 화면과 같은 방식 */
  function sameBasis(q, est) {
    const amt = num(q && q.amount);
    if (!(amt > 0) || !est) return null;
    const vatPct = num(est.coef && est.coef.vat_pct) || 10;
    const vm = 1 + vatPct / 100;
    const incl = !!est.vatIncl;
    const ex0 = q.vatIncluded !== false ? amt / vm : amt;
    const pe = est.partsEx || {};
    const adds = [];
    let ex = ex0;
    [['ladder', '사다리차'], ['aircon', '에어컨 이전'], ['waste', '폐기물'], ['arrange', '정리 인력']].forEach(([k, label]) => {
      if (!q[k] && num(pe[k]) > 0) { ex += num(pe[k]); adds.push(label + ' ' + krw(num(pe[k]) * (incl ? vm : 1))); }
    });
    return { amount: Math.round(incl ? ex * vm : ex), adds };
  }
  function quoteView(q, est) {
    const sb = sameBasis(q, est);
    const out = {
      id: q.id, company: q.company || '', amount: num(q.amount) || null, amountTxt: num(q.amount) > 0 ? krw(q.amount) : '금액 없음',
      vatIncluded: q.vatIncluded !== false,
      includes: { ladder: !!q.ladder, aircon: !!q.aircon, waste: !!q.waste, arrange: !!q.arrange },
      tons: q.tons == null ? null : num(q.tons), crew: q.crew == null ? null : num(q.crew), deposit: q.deposit == null ? null : num(q.deposit),
      date: q.date || '', visitDone: !!q.visitDone, licenseChecked: !!q.licenseChecked, insuranceChecked: !!q.insuranceChecked,
      note: clip(q.note, 120),
    };
    if (sb && est && num(est.typical) > 0) {
      const diff = sb.amount / est.typical - 1;
      out.sameBasis = sb.amount;
      out.sameBasisTxt = krw(sb.amount) + ' (' + (est.vatIncl ? '부가세 포함' : '부가세 별도') + ' 기준' + (sb.adds.length ? ', 빠진 항목 더함: ' + sb.adds.join(', ') : '') + ')';
      out.vsModel = (diff >= 0 ? '+' : '−') + Math.abs(Math.round(diff * 100)) + '%';
      out.flag = sb.amount < num(est.low) ? '모델 하한보다 쌈 — 당일 추가요금 위험, 포함 항목 서면 확인' : sb.amount > num(est.high) ? '모델 상한보다 비쌈 — 포함 항목 확인 후 협상' : '모델 범위 안';
    }
    return out;
  }
  function modelView(est) {
    if (!est) return null;
    return {
      basis: est.vatIncl ? '부가세 포함' : '부가세 별도 (실제로 낼 돈은 payWithVat)',
      typical: Math.round(num(est.typical)), low: Math.round(num(est.low)), high: Math.round(num(est.high)),
      typicalTxt: krw(est.typical), rangeTxt: krw(est.low) + ' ~ ' + krw(est.high),
      payWithVat: est.pay ? { typical: krw(est.pay.typical), low: krw(est.pay.low), high: krw(est.pay.high) } : null,
      truck: est.truckLabel || null, tons: est.tons, crew: est.crewLabel || est.crew, volumeM3: est.volume,
      lgCost: est.lgCost && isFinite(est.lgCost.typical) ? { typical: krw(est.lgCost.typical), low: krw(est.lgCost.low), high: krw(est.lgCost.high) } : null,
      totalWithLg: est.totalPay ? krw(est.totalPay.typical) : null,
      calibrated: num(est.calibFactor) && Math.abs(num(est.calibFactor) - 1) > 1e-6 ? '방문견적으로 ×' + num(est.calibFactor).toFixed(2) + ' 보정됨' : '보정 전 (리서치 추정치)',
      notes: Array.isArray(est.notes) ? est.notes.slice(0, 4).map((n) => clip(n, 160)) : [],
    };
  }
  function quotePatch(input, base, isNew) {
    const p = {};
    const diffs = [];
    const set = (k, v, label, fmt) => {
      const before = base ? base[k] : undefined;
      if (!isNew && JSON.stringify(before == null ? null : before) === JSON.stringify(v == null ? null : v)) return;
      p[k] = v;
      if (!isNew) diffs.push(label + ' ' + (fmt ? fmt(before) : String(before == null ? '-' : before)) + ' → ' + (fmt ? fmt(v) : String(v == null ? '-' : v)));
    };
    const yes = (b) => (b ? '포함' : '미포함');
    const ok = (b) => (b ? '확인' : '미확인');
    if (has(input, 'company')) { const c = str(input.company, 60); if (!c) throw new Error('업체 이름이 비어 있어요.'); set('company', c, '업체'); }
    if (has(input, 'amount')) set('amount', parseAmount(input.amount, '견적 금액', { min: 100000, max: 1e9 }), '금액', (v) => (v ? krw(v) : '-'));
    if (has(input, 'vatIncluded')) set('vatIncluded', toBool(input.vatIncluded), '부가세', (b) => (b === false ? '별도' : '포함'));
    [['ladder', '사다리차'], ['aircon', '에어컨 이전'], ['waste', '폐기물'], ['arrange', '정리 인력']].forEach(([k, l]) => { if (has(input, k)) set(k, toBool(input[k]), l, yes); });
    [['visitDone', '방문견적'], ['licenseChecked', '허가증'], ['insuranceChecked', '보험증권']].forEach(([k, l]) => { if (has(input, k)) set(k, toBool(input[k]), l, ok); });
    if (has(input, 'tons')) { const t = input.tons === null ? null : num(input.tons); if (t != null && (t <= 0 || t > 30)) throw new Error('차량 톤수는 0~30 사이로 주세요.'); set('tons', t, '차량', (v) => (v == null ? '-' : v + '톤')); }
    if (has(input, 'crew')) { const c = input.crew === null ? null : parseInt0(input.crew, '인원', 30); set('crew', c, '인원', (v) => (v == null ? '-' : v + '명')); }
    if (has(input, 'deposit')) { const d = input.deposit === null ? null : parseAmount(input.deposit, '계약금', { max: 1e8 }); set('deposit', d, '계약금', (v) => (v == null ? '-' : krw(v))); }
    if (has(input, 'date')) { const d = parseDate(input.date, '견적 날짜'); set('date', d || '', '날짜', (v) => (v ? D.fmt(v) : '-')); }
    if (has(input, 'note')) set('note', str(input.note, 500), '메모', (v) => clip(v || '-', 30));
    return { p, diffs };
  }

  /* ---- 짐 목록 ---- */
  const FATE_ALIAS = { '가져감': 'move', '가져가기': 'move', '이사': 'move', '새로 구매': 'buy', '구매': 'buy', '새로구매': 'buy', '버림': 'discard', '버리기': 'discard', '폐기': 'discard', '판매': 'sell', '나눔': 'sell', '판매·나눔': 'sell', '판매/나눔': 'sell', '미정': 'undecided' };
  function parseFate(v) {
    const s = str(v, 20);
    if (MV.inv.FATES.some((f) => f.id === s)) return s;
    if (FATE_ALIAS[s]) return FATE_ALIAS[s];
    const f = MV.inv.FATES.find((x) => x.label === s);
    if (f) return f.id;
    throw new Error('처리(fate)는 ' + MV.inv.FATES.map((x) => x.id + '(' + x.label + ')').join(', ') + ' 중 하나로 주세요.');
  }
  function parseCat(v) {
    const s = str(v, 30);
    if (MV.inv.CATS.some((c) => c.id === s)) return s;
    const c = MV.inv.CATS.find((x) => x.label === s || x.label.split('·').indexOf(s) >= 0);
    if (c) return c.id;
    throw new Error('분류(cat)는 ' + MV.inv.CATS.map((x) => x.id + '(' + x.label + ')').join(', ') + ' 중 하나로 주세요.');
  }
  function invView(x) {
    return {
      id: x.id, name: x.name, cat: x.cat, catLabel: MV.inv.cat(x.cat).label, fate: x.fate, fateLabel: MV.inv.fate(x.fate).label,
      qty: num(x.qty), size: num(x.w) + '×' + num(x.d) + '×' + num(x.h) + 'cm', assumedSize: !!x.assumed,
      lg: !!x.lg, room: x.room || '', roomNew: x.roomNew || '', note: clip(x.note, 120),
    };
  }
  function catalogMatch(name) {
    const cat = Array.isArray(MV.catalog) ? MV.catalog : [];
    const n = String(name || '').replace(/\s+/g, '');
    if (!n) return null;
    let best = null; let score = 0;
    cat.forEach((c) => {
      if (!c || !c.name) return;
      const cn = String(c.name).replace(/\s+/g, '');
      const first = String(c.name).split(/\s+/)[0].replace(/[()]/g, '');
      let s = 0;
      if (cn === n) s = 1000;
      else if (cn.indexOf(n) >= 0) s = 100 + n.length;
      else if (first.length >= 2 && n.indexOf(first) >= 0) s = first.length;
      if (s > score) { score = s; best = c; }
    });
    return best;
  }
  function invPatch(input, base) {
    const p = {};
    const diffs = [];
    const set = (k, v, label, fmt) => {
      const before = base ? base[k] : undefined;
      if (base && JSON.stringify(before == null ? null : before) === JSON.stringify(v == null ? null : v)) return;
      p[k] = v;
      if (base) diffs.push(label + ' ' + (fmt ? fmt(before) : (before == null || before === '' ? '-' : before)) + ' → ' + (fmt ? fmt(v) : (v === '' ? '-' : v)));
    };
    if (has(input, 'name')) { const n = str(input.name, 80); if (!n) throw new Error('짐 이름이 비어 있어요.'); set('name', n, '이름'); }
    if (has(input, 'cat')) set('cat', parseCat(input.cat), '분류', (v) => MV.inv.cat(v).label);
    if (has(input, 'fate')) set('fate', parseFate(input.fate), '처리', (v) => MV.inv.fate(v).label);
    if (has(input, 'qty')) set('qty', parseInt0(input.qty, '수량', 999), '수량');
    let dims = false;
    [['w', '가로'], ['d', '깊이'], ['h', '높이']].forEach(([k, l]) => { if (has(input, k)) { set(k, parseDim(input[k], l), l, (v) => (v == null ? '-' : v + 'cm')); dims = dims || has(p, k); } });
    if (dims) p.assumed = false;
    if (has(input, 'url')) set('url', safeUrl(input.url), '링크', (v) => (v ? '있음' : '없음'));
    if (has(input, 'note')) set('note', str(input.note, 1000), '메모', (v) => clip(v || '-', 30));
    if (has(input, 'lg')) set('lg', toBool(input.lg), 'LG 이전', (b) => (b ? '예' : '아니오'));
    if (has(input, 'room')) set('room', str(input.room, 40), '지금 집 위치');
    if (has(input, 'roomNew')) set('roomNew', str(input.roomNew, 40), '새 집 위치');
    return { p, diffs };
  }

  /* ---- 도구 정의 (중요한 순서 — limits.tools.maxCount 가 작으면 앞에서부터) ---- */
  const S_OWNER = { type: 'string', enum: ['나', '아내', '함께', '없음'], description: '담당자 (없음 = 미정)' };
  const S_PRI = { type: 'string', enum: ['high', 'mid', 'low'], description: 'high=중요, mid=보통, low=여유' };
  const S_DATE = { type: ['string', 'null'], description: 'YYYY-MM-DD (지우려면 null)' };
  const S_MONEY = { type: ['number', 'string'], description: '원 단위 숫자 또는 "32만원"·"2.1억" 같은 글' };
  const S_GROUP = { type: 'string', enum: ['essential', 'purchase', 'optional'], description: 'essential=꼭 드는 이사 비용, purchase=새로 사는 살림, optional=선택·나중에' };
  const TOOLS = [
    {
      name: 'get_overview', label: '전체 현황 보는 중',
      description: '지금 앱 데이터 요약을 새로 계산해 돌려줘요: 진행률, 파트별 완료/전체/지연, 14일 안 마감·지연된 미완료 할 일(최대 40개), 예산·남는 돈, 이사 견적 모델, 짐 처리별 개수, 최근 활동. 데이터를 바꾼 뒤 다시 확인할 때 쓰세요.',
      run: () => overview(),
    },
    {
      name: 'list_items', label: '할 일 찾는 중',
      description: '체크리스트 할 일을 찾아요. 결과 {total, items:[{id, partId, part, title, due, dueFmt, done, owner, priority, status, notes(메모 수)}]} — 기한 순. status: open=미완료(기본), overdue=기한 지남, today=오늘 마감, week=미완료 중 7일 안 마감(지난 것 포함), done=완료, all=전부. 고치기 전에 이걸로 정확한 id 를 찾으세요.',
      inputSchema: {
        type: 'object',
        properties: {
          partId: { type: 'string', description: '파트 id (list_parts 참고)' },
          status: { type: 'string', enum: ['open', 'done', 'overdue', 'today', 'week', 'all'] },
          dueFrom: { type: 'string', description: '이 날짜(YYYY-MM-DD) 이후 기한만' },
          dueTo: { type: 'string', description: '이 날짜(YYYY-MM-DD) 이전 기한만' },
          query: { type: 'string', description: '제목·설명·메모에서 찾을 말 (띄어쓰기로 여러 단어 = 모두 포함)' },
          owner: S_OWNER,
          limit: { type: 'integer', minimum: 1, maximum: 60, description: '기본 30' },
        },
      },
      run: (a) => {
        const today = D.today();
        const status = a.status ? str(a.status, 10) : 'open';
        if (['open', 'done', 'overdue', 'today', 'week', 'all'].indexOf(status) < 0) throw new Error('status 는 open·done·overdue·today·week·all 중 하나예요.');
        const partId = a.partId ? str(a.partId, 60) : '';
        if (partId && !MV.parts.get(partId)) throw new Error('파트 id "' + partId + '"가 없어요. 파트: ' + MV.parts.list().map((p) => p.id + '(' + p.name + ')').join(', '));
        const from = a.dueFrom ? parseDate(a.dueFrom, 'dueFrom') : null;
        const to = a.dueTo ? parseDate(a.dueTo, 'dueTo') : null;
        const owner = has(a, 'owner') && a.owner !== '' ? parseOwner(a.owner) : null;
        const words = str(a.query, 100).toLowerCase().split(/\s+/).filter(Boolean);
        const limit = MV.clamp(Math.round(num(a.limit) || 30), 1, 60);
        const list = MV.items.list((it) => {
          if (partId && it.partId !== partId) return false;
          const s = MV.items.status(it);
          if (status === 'open' && it.done) return false;
          if (status === 'done' && !it.done) return false;
          if (status === 'overdue' && s !== 'overdue') return false;
          if (status === 'today' && s !== 'today') return false;
          if (status === 'week' && (it.done || !D.valid(it.due) || D.diff(today, it.due) > 7)) return false;
          if ((from || to) && !D.valid(it.due)) return false;
          if (from && it.due < from) return false;
          if (to && it.due > to) return false;
          if (owner !== null && (it.owner || '') !== owner) return false;
          if (words.length) {
            const hay = (it.title + ' ' + (it.detail || '') + ' ' + (it.notes || []).map((n) => n.text).join(' ') + ' ' + partName(it.partId)).toLowerCase();
            if (!words.every((w) => hay.indexOf(w) >= 0)) return false;
          }
          return true;
        }).sort(status === 'done' ? (x, y) => String(y.doneAt || '').localeCompare(String(x.doneAt || '')) : byDue);
        return { total: list.length, items: list.slice(0, limit).map(compactItem), more: Math.max(0, list.length - limit) };
      },
    },
    {
      name: 'get_item', label: '할 일 자세히 보는 중',
      description: '할 일 하나의 자세한 내용: 설명(detail), 링크, 연결된 가이드, 최근 메모 10개. 결과 {id, part, title, detail, due, done, owner, priority, links, guide, notes:[{id, text, at}], notesTotal}.',
      inputSchema: { type: 'object', properties: { id: { type: 'string', description: '할 일 id' } }, required: ['id'] },
      run: (a) => {
        const it = needItem(a.id);
        const notes = Array.isArray(it.notes) ? it.notes : [];
        return Object.assign(compactItem(it), {
          detail: String(it.detail || '').slice(0, 2000) + (String(it.detail || '').length > 2000 ? '…(잘림)' : ''),
          doneAt: it.doneAt || null,
          links: (it.links || []).slice(0, 10).map((l) => ({ label: clip(l && l.label, 60), url: String((l && l.url) || '').slice(0, 300) })),
          guide: it.guide ? '#/guide/' + String(it.guide).replace('#', '/') : null,
          notes: notes.slice(-10).map((n) => ({ id: n.id, text: String(n.text || '').slice(0, 600), at: D.time(n.at) })),
          notesTotal: notes.length,
          href: itemHref(it),
        });
      },
    },
    {
      name: 'update_item', label: '할 일 고치는 중',
      description: '할 일 하나를 고쳐요: done(완료 체크/해제), due(기한, YYYY-MM-DD 또는 null), owner, priority, title, detail. 바꿀 것만 넣으세요. 결과 {id, title, changed:[바뀐 내용]}.',
      inputSchema: {
        type: 'object',
        properties: {
          id: { type: 'string' }, done: { type: 'boolean' }, due: S_DATE, owner: S_OWNER, priority: S_PRI,
          title: { type: 'string' }, detail: { type: 'string', description: '설명 전체를 이 글로 바꿈 (덧붙이려면 add_note)' },
        },
        required: ['id'],
      },
      run: (a, ctx) => {
        const it = needItem(a.id);
        const patch = {};
        const diffs = [];
        if (has(a, 'done')) { const d = toBool(a.done); if (d !== !!it.done) { patch.done = d; patch.doneAt = d ? MV.nowISO() : null; diffs.push(d ? '완료로 체크' : '완료 해제'); } }
        if (has(a, 'due')) { const due = parseDate(a.due, '기한'); if (due !== (D.valid(it.due) ? it.due : null)) { patch.due = due; diffs.push('기한 ' + fmtDue(it.due) + ' → ' + fmtDue(due)); } }
        if (has(a, 'owner')) { const o = parseOwner(a.owner); if (o !== (it.owner || '')) { patch.owner = o; diffs.push('담당 ' + OWNER_LABEL[it.owner || ''] + ' → ' + OWNER_LABEL[o]); } }
        if (has(a, 'priority')) { const p = parsePri(a.priority); if (p !== (it.priority || 'mid')) { patch.priority = p; diffs.push('우선순위 ' + (PRI_LABEL[it.priority] || '보통') + ' → ' + PRI_LABEL[p]); } }
        if (has(a, 'title')) { const t = str(a.title, 200); if (!t) throw new Error('제목이 비어 있어요.'); if (t !== it.title) { patch.title = t; diffs.push('제목 “' + clip(it.title, 30) + '” → “' + clip(t, 30) + '”'); } }
        if (has(a, 'detail')) { const d = String(a.detail == null ? '' : a.detail).slice(0, 5000); if (d !== (it.detail || '')) { patch.detail = d; diffs.push('설명 바꿈'); } }
        if (!diffs.length) return { id: it.id, title: it.title, changed: [], note: '이미 그 상태라 바꾼 것이 없어요.' };
        const onlyDone = Object.keys(patch).every((k) => k === 'done' || k === 'doneAt');
        const logText = onlyDone ? (patch.done ? '🤖 ✅ 완료: ' : '🤖 ↩︎ 다시 열기: ') + it.title : '🤖 항목 수정: ' + it.title + ' (' + diffs.join(', ') + ')';
        mutate(ctx, () => MV.items.update(it.id, patch, logText), { items: [it.id] });
        const now = MV.items.get(it.id) || it;
        record(ctx, (patch.done === true && onlyDone ? '✅ ' : '✏️ ') + '“' + clip(now.title, 40) + '” — ' + diffs.join(', '), itemHref(now));
        return { id: now.id, title: now.title, changed: diffs, item: compactItem(now) };
      },
    },
    {
      name: 'add_item', label: '할 일 추가하는 중',
      description: '체크리스트에 새 할 일을 추가해요. partId 는 list_parts 의 id (예: buy=가구구매, money=통장업무). 결과 {id, part, title, due, owner, priority}.',
      inputSchema: {
        type: 'object',
        properties: { partId: { type: 'string' }, title: { type: 'string' }, due: S_DATE, owner: S_OWNER, priority: S_PRI, detail: { type: 'string' } },
        required: ['partId', 'title'],
      },
      run: (a, ctx) => {
        const key = str(a.partId, 60);
        const parts = MV.parts.list();
        const p = MV.parts.get(key) || parts.find((x) => x.name === key);
        if (!p) throw new Error('파트 id "' + key + '"가 없어요. 쓸 수 있는 파트: ' + parts.map((x) => x.id + '(' + x.name + ')').join(', '));
        const title = str(a.title, 200);
        if (!title) throw new Error('할 일 제목이 비어 있어요.');
        const due = has(a, 'due') ? parseDate(a.due, '기한') : null;
        const owner = has(a, 'owner') ? parseOwner(a.owner) : '';
        const priority = has(a, 'priority') ? parsePri(a.priority) : 'mid';
        const detail = has(a, 'detail') ? String(a.detail == null ? '' : a.detail).slice(0, 5000) : '';
        const dup = MV.items.list((x) => x.partId === p.id && !x.done && String(x.title || '').replace(/\s+/g, '') === title.replace(/\s+/g, ''))[0];
        if (dup) throw new Error('같은 제목의 할 일이 이미 있어요 (id ' + dup.id + ', 기한 ' + fmtDue(dup.due) + '). 고치려면 update_item 을 쓰세요.');
        const it = MV.store.normItem({ partId: p.id, title, due, owner, priority, detail, order: Date.now() });
        mutate(ctx, () => MV.store.update((st) => { st.items.push(it); }, { log: '🤖 할 일 추가: ' + title }), { items: [it.id] });
        record(ctx, '➕ 할 일 추가: “' + clip(title, 40) + '” (' + p.name + ' · ' + fmtDue(due) + ' · ' + OWNER_LABEL[owner] + ' · ' + PRI_LABEL[priority] + ')', itemHref(it));
        return { id: it.id, partId: p.id, part: p.name, title, due, dueFmt: fmtDue(due), owner, priority };
      },
    },
    {
      name: 'add_note', label: '메모 남기는 중',
      description: '할 일에 메모(스레드 댓글)를 남겨요 — 통화 결과, 확인한 내용, 금액 등. 결과 {noteId, id, title}.',
      inputSchema: { type: 'object', properties: { id: { type: 'string', description: '할 일 id' }, text: { type: 'string' } }, required: ['id', 'text'] },
      run: (a, ctx) => {
        const it = needItem(a.id);
        const text = String(a.text == null ? '' : a.text).trim().slice(0, 2000);
        if (!text) throw new Error('메모 내용이 비어 있어요.');
        // 같은 메모가 이미 있으면 다시 남기지 않음 (끊긴 답을 다시 보낼 때 두 번 남는 것 방지)
        const flat = (x) => String(x || '').replace(/\s+/g, ' ').trim();
        const same = (Array.isArray(it.notes) ? it.notes : []).slice(-20).find((n) => n && flat(n.text) === flat(text));
        if (same) return { noteId: same.id, id: it.id, title: it.title, changed: [], note: '같은 메모가 이미 있어 다시 남기지 않았어요 (' + D.time(same.at) + ').' };
        const note = { id: MV.uid('nt'), text, at: MV.nowISO() };
        mutate(ctx, () => MV.store.update((st) => {
          const x = st.items.find((y) => y.id === it.id);
          if (!x) return;
          if (!Array.isArray(x.notes)) x.notes = [];
          x.notes.push(note);
          x.updatedAt = note.at;
        }, { log: '🤖 💬 메모: ' + it.title }), { items: [it.id] });
        record(ctx, '💬 메모 “' + clip(it.title, 30) + '”: ' + clip(text, 60), itemHref(it));
        return { noteId: note.id, id: it.id, title: it.title };
      },
    },
    {
      name: 'get_budget', label: '예산 보는 중',
      description: '이사 예산(자금흐름 화면)을 읽어요: 지출 항목 lines[{id, label, amount, group(essential=꼭 드는 이사 비용/purchase=새로 사는 살림/optional=선택·나중에), mode(auto/manual), included, paid, date, memo}], 들어올 돈 refunds[], 요약 summary — 부족·여유는 summary.text.headline(꼭 드는 비용 기준, 머리 숫자) → withPurchases → allIncluded 순서로 말하세요. 금액은 원.',
      run: () => {
        const fin = ensureFinance();
        const st = MV.store.get();
        return {
          lines: fin.budget.lines.filter((x) => x && typeof x === 'object').map((l) => lineView(st, l)),
          refunds: (fin.budget.refunds || []).filter((x) => x && typeof x === 'object').map((r) => ({ id: r.id, label: r.label, amount: Math.round(num(r.amount)), amountTxt: krw(r.amount), received: !!r.got, memo: clip(r.memo, 120) })),
          summary: budgetSummary(),
          note: '중개보수·잔금·보증금·대출 상환·11월 월세는 예산이 아니라 ' + D.fmt(D.moveDate()) + ' 돈 흐름(#/money/flow)에 들어 있어요 (leftoverAfterMoveDay 에 이미 반영).',
          link: '#/money/budget',
        };
      },
    },
    {
      name: 'update_budget', label: '예산 고치는 중',
      description: '예산 항목(지출 또는 들어올 돈) 하나를 고쳐요. id 는 get_budget 의 id(또는 정확한 항목 이름). amount 를 주면 자동 계산 항목은 직접 입력으로 바뀌어요. paid=냈음(들어올 돈은 받음), included=예산에 넣기, auto:true=자동 계산으로 되돌리기, group=묶음 옮기기. 결과에 바뀐 내용과 다시 계산한 요약.',
      inputSchema: {
        type: 'object',
        properties: {
          id: { type: 'string' }, amount: S_MONEY, paid: { type: 'boolean' }, included: { type: 'boolean' }, auto: { type: 'boolean' },
          group: S_GROUP,
          date: { type: ['string', 'null'], description: '결제일 YYYY-MM-DD' }, memo: { type: 'string' }, label: { type: 'string' },
        },
        required: ['id'],
      },
      run: (a, ctx) => {
        const fin = ensureFinance();
        const found = findBudget(fin, a.id);
        const L = found.line;
        const st0 = MV.store.get();
        const before = found.refund ? Math.round(num(L.amount)) : lineValue(st0, L);
        const wasAuto = !found.refund && AUTO_BUDGET.has(L.id) && L.auto !== false;
        const patch = {};
        const diffs = [];
        if (has(a, 'amount') && has(a, 'auto') && toBool(a.auto)) throw new Error('amount 와 auto:true 는 함께 쓸 수 없어요.');
        if (has(a, 'amount')) {
          const v = parseAmount(a.amount, '금액');
          if (wasAuto) { patch.auto = false; patch.amount = v; diffs.push('금액 ' + krw(before) + '(자동) → ' + krw(v) + '(직접 입력)'); }
          else if (v !== Math.round(num(L.amount))) { patch.amount = v; diffs.push('금액 ' + krw(L.amount) + ' → ' + krw(v)); }
        } else if (has(a, 'auto')) {
          if (found.refund || !AUTO_BUDGET.has(L.id)) throw new Error('“' + L.label + '”은(는) 자동 계산이 없는 항목이에요.');
          if (toBool(a.auto)) { if (L.auto === false) { patch.auto = true; diffs.push('자동 계산으로 되돌림'); } }
          else if (wasAuto) { patch.auto = false; patch.amount = before; diffs.push('자동 → 직접 입력 (' + krw(before) + ' 그대로)'); }
        }
        if (has(a, 'paid')) {
          const p = toBool(a.paid);
          const k = found.refund ? 'got' : 'paid';
          if (p !== !!L[k]) { patch[k] = p; diffs.push(found.refund ? (p ? '받음 표시' : '받음 해제') : (p ? '냄 표시' : '냄 해제')); }
        }
        if (has(a, 'included')) {
          if (found.refund) throw new Error('들어올 돈에는 included 를 쓸 수 없어요.');
          const on = toBool(a.included);
          if (on !== (L.on !== false)) { patch.on = on; diffs.push(on ? '예산에 넣음' : '예산에서 뺌'); }
        }
        if (has(a, 'group')) {
          if (found.refund) throw new Error('들어올 돈에는 묶음(group)이 없어요.');
          const g = parseGroup(a.group);
          if (g !== groupOf(L)) { patch.group = g; diffs.push('묶음 ' + GROUP_LABEL[groupOf(L)] + ' → ' + GROUP_LABEL[g]); }
        }
        if (has(a, 'date')) {
          if (found.refund) throw new Error('들어올 돈에는 결제일이 없어요.');
          const d = parseDate(a.date, '결제일') || '';
          if (d !== (L.date || '')) { patch.date = d; diffs.push('결제일 ' + (L.date ? D.fmt(L.date) : '-') + ' → ' + (d ? D.fmt(d) : '-')); }
        }
        if (has(a, 'memo')) { const m = str(a.memo, 300); if (m !== (L.memo || '')) { patch.memo = m; diffs.push('메모 “' + clip(m || '-', 40) + '”'); } }
        if (has(a, 'label')) { const t = str(a.label, 80); if (!t) throw new Error('항목 이름이 비어 있어요.'); if (t !== L.label) { patch.label = t; diffs.push('이름 “' + L.label + '” → “' + t + '”'); } }
        if (!diffs.length) return { id: L.id, label: L.label, changed: [], note: '이미 그 값이라 바꾼 것이 없어요.', summary: budgetSummary() };
        // 사람이(여기서는 AI가 대신) 고친 줄 — 자금흐름 화면의 기본값 바꿈(마이그레이션)이 건드리지 않게
        if (!found.refund) { patch.edited = true; if (!has(patch, 'group')) patch.group = groupOf(L); }
        const id = L.id;
        mutate(ctx, () => MV.store.update((st) => {
          const list = found.refund ? st.finance.budget.refunds : st.finance.budget.lines;
          const x = list.find((y) => y && y.id === id);
          if (x) Object.assign(x, patch);
        }, { log: '🤖 예산 수정: ' + (patch.label || L.label) + ' (' + diffs.join(', ') + ')' }), { section: 'finance' });
        const st1 = MV.store.get();
        const L1 = (found.refund ? st1.finance.budget.refunds : st1.finance.budget.lines).find((y) => y && y.id === id) || L;
        const after = found.refund ? Math.round(num(L1.amount)) : lineValue(st1, L1);
        const sum = budgetSummary();
        record(ctx, '💰 예산 “' + clip(L1.label, 30) + '” — ' + diffs.join(', ') + (sum ? ' · 지금 꼭 드는 비용 기준 ' + verdict(sum.netEssential) : ''), '#/money/budget');
        return { id, label: L1.label, kind: found.refund ? '들어올 돈' : '지출', group: found.refund ? undefined : groupOf(L1), changed: diffs, amountBefore: before, amountAfter: after, summary: sum };
      },
    },
    {
      name: 'add_budget_line', label: '예산 항목 추가하는 중',
      description: '예산에 새 항목을 추가해요. type: expense(지출, 기본) 또는 refund(들어올 돈). 지출은 group 을 정하세요: essential=이사 날 전후 꼭 드는 이사 비용(입주청소·사다리차·보관이사 등), purchase=새로 사는 살림(가구·가전), optional=선택·나중에. 이미 있는 항목(이사업체·가전 이전설치 등)은 update_budget 으로 고치고, 중개보수·잔금·대출 상환·월세는 돈 흐름에 이미 있으니 넣지 마세요.',
      inputSchema: {
        type: 'object',
        properties: { label: { type: 'string' }, amount: S_MONEY, type: { type: 'string', enum: ['expense', 'refund'] }, group: S_GROUP, paid: { type: 'boolean' }, date: { type: ['string', 'null'] }, memo: { type: 'string' } },
        required: ['label', 'amount'],
      },
      run: (a, ctx) => {
        const fin = ensureFinance();
        const label = str(a.label, 80);
        if (!label) throw new Error('항목 이름이 비어 있어요.');
        const refund = str(a.type, 10) === 'refund';
        if (!refund && /중개\s*보수|복비|잔금|보증금|대출\s*상환|월세/.test(label)) throw new Error('“' + label + '”은(는) ' + D.fmt(D.moveDate()) + ' 돈 흐름(#/money/flow)에 이미 들어 있어 예산에 넣으면 두 번 세져요. 금액을 바꾸려면 자금흐름 화면에서 직접 고치도록 안내하세요.');
        const amount = parseAmount(a.amount, '금액');
        const norm = (s) => String(s || '').replace(/\s+/g, '').toLowerCase();
        const dup = (refund ? fin.budget.refunds : fin.budget.lines).find((x) => x && norm(x.label) === norm(label));
        if (dup) throw new Error('같은 이름의 예산 항목이 이미 있어요 (id ' + dup.id + '). update_budget 으로 고치세요.');
        const paid = has(a, 'paid') ? toBool(a.paid) : false;
        const memo = str(a.memo, 300);
        if (refund && has(a, 'group')) throw new Error('들어올 돈에는 묶음(group)이 없어요.');
        const group = refund ? null : (has(a, 'group') ? parseGroup(a.group) : guessGroup(label));
        const line = refund
          ? { id: MV.uid('rf'), label, amount, got: paid, memo }
          : { id: MV.uid('bl'), label, amount, auto: true, on: true, paid, date: has(a, 'date') ? (parseDate(a.date, '결제일') || '') : '', memo, group, edited: true };
        mutate(ctx, () => MV.store.update((st) => {
          if (refund) { if (!Array.isArray(st.finance.budget.refunds)) st.finance.budget.refunds = []; st.finance.budget.refunds.push(line); }
          else st.finance.budget.lines.push(line);
        }, { log: '🤖 예산 ' + (refund ? '들어올 돈' : '항목') + ' 추가: ' + label + ' ' + krw(amount) }), { section: 'finance' });
        const sum = budgetSummary();
        record(ctx, '💰 예산 ' + (refund ? '들어올 돈' : '항목') + ' 추가: “' + clip(label, 30) + '” ' + krw(amount) + (group ? ' · ' + GROUP_LABEL[group] : '') + (paid ? (refund ? ' (받음)' : ' (냄)') : '') + (sum ? ' · 지금 꼭 드는 비용 기준 ' + verdict(sum.netEssential) : ''), '#/money/budget');
        return { id: line.id, label, amount, kind: refund ? '들어올 돈' : '지출', group: group || undefined, groupLabel: group ? GROUP_LABEL[group] : undefined, summary: sum };
      },
    },
    {
      name: 'get_estimate', label: '견적 보는 중',
      description: '이사 견적: 짐 목록으로 계산한 모델 추정치(기준가·범위·차량·인원·가전 이전비)와 지금까지 넣은 업체 견적 quotes(같은 조건 환산 금액, 모델 대비 %). 금액은 원.',
      run: () => {
        const est = modelEstimate();
        if (!est) throw new Error('짐·견적 화면이 없어 견적을 계산할 수 없어요.');
        return { model: modelView(est), quotes: quotesOf(MV.store.get()).map((q) => quoteView(q, est)), link: '#/stuff/quotes' };
      },
    },
    {
      name: 'add_quote', label: '견적 넣는 중',
      description: '업체 견적 비교에 이사업체 견적을 추가해요. amount 는 견적 총액(원 또는 "210만원"). vatIncluded 기본 true. ladder·aircon·waste·arrange 는 견적에 그 항목이 포함됐는지. visitDone 은 방문견적이면 true. 결과에 모델과의 비교.',
      inputSchema: {
        type: 'object',
        properties: {
          company: { type: 'string' }, amount: S_MONEY, vatIncluded: { type: 'boolean' },
          ladder: { type: 'boolean', description: '사다리차 포함' }, aircon: { type: 'boolean', description: '에어컨 이전 포함' },
          waste: { type: 'boolean', description: '폐기물 처리 포함' }, arrange: { type: 'boolean', description: '정리 인력 포함' },
          tons: { type: 'number' }, crew: { type: 'integer' }, deposit: S_MONEY, date: { type: 'string', description: '견적 받은 날 YYYY-MM-DD' },
          visitDone: { type: 'boolean' }, licenseChecked: { type: 'boolean' }, insuranceChecked: { type: 'boolean' }, note: { type: 'string' },
        },
        required: ['company', 'amount'],
      },
      run: (a, ctx) => {
        if (!has(a, 'company') || !has(a, 'amount')) throw new Error('업체 이름(company)과 금액(amount)이 필요해요.');
        const { p } = quotePatch(a, null, true);
        const norm = (s) => String(s || '').replace(/\s+/g, '').toLowerCase();
        const dup = quotesOf(MV.store.get()).find((q) => norm(q.company) === norm(p.company));
        if (dup) throw new Error('“' + dup.company + '” 견적이 이미 있어요 (id ' + dup.id + ', ' + (num(dup.amount) > 0 ? krw(dup.amount) : '금액 없음') + '). 고치려면 update_quote 를 쓰세요.');
        const q = Object.assign(newQuote(), p);
        mutate(ctx, () => MV.store.update((st) => {
          if (!st.estimate || typeof st.estimate !== 'object' || Array.isArray(st.estimate)) st.estimate = {};
          if (!Array.isArray(st.estimate.quotes)) st.estimate.quotes = [];
          st.estimate.quotes.push(q);
        }, { log: '🤖 업체 견적 추가: ' + q.company + ' ' + krw(q.amount) }), { section: 'estimate' });
        const est = modelEstimate();
        const v = quoteView(q, est);
        const inc = [['ladder', '사다리차'], ['aircon', '에어컨'], ['waste', '폐기물'], ['arrange', '정리']].filter(([k]) => q[k]).map(([, l]) => l);
        record(ctx, '🚚 견적 추가: ' + q.company + ' ' + krw(q.amount) + (q.vatIncluded ? '' : ' (부가세 별도)') + (inc.length ? ' · ' + inc.join('·') + ' 포함' : '') + (v.vsModel ? ' · 모델 대비 ' + v.vsModel : ''), '#/stuff/quotes');
        const n = quotesOf(MV.store.get()).filter((x) => num(x.amount) > 0).length;
        return { id: q.id, quote: v, model: modelView(est), quotesCount: n, hint: n >= 3 ? '견적이 3곳 이상이에요 — 업체 견적 화면에서 "견적으로 보정"을 누르면 모델과 예산이 맞춰져요.' : '방문견적 3곳을 받으면 비교가 정확해져요.' };
      },
    },
    {
      name: 'update_quote', label: '견적 고치는 중',
      description: '이미 넣은 업체 견적 하나를 고쳐요 (금액 조정, 포함 항목, 방문견적·허가·보험 확인 등). id 는 get_estimate 의 quotes[].id. 바꿀 것만 넣으세요.',
      inputSchema: {
        type: 'object',
        properties: {
          id: { type: 'string' }, company: { type: 'string' }, amount: S_MONEY, vatIncluded: { type: 'boolean' },
          ladder: { type: 'boolean' }, aircon: { type: 'boolean' }, waste: { type: 'boolean' }, arrange: { type: 'boolean' },
          tons: { type: 'number' }, crew: { type: 'integer' }, deposit: S_MONEY, date: { type: 'string' },
          visitDone: { type: 'boolean' }, licenseChecked: { type: 'boolean' }, insuranceChecked: { type: 'boolean' }, note: { type: 'string' },
        },
        required: ['id'],
      },
      run: (a, ctx) => {
        const id = str(a.id, 80);
        const q0 = quotesOf(MV.store.get()).find((q) => q.id === id || String(q.company || '').replace(/\s+/g, '') === id.replace(/\s+/g, ''));
        if (!q0) throw new Error('견적 "' + id + '"을(를) 찾지 못했어요. 견적: ' + (quotesOf(MV.store.get()).map((q) => q.id + '(' + (q.company || '이름 없음') + ')').join(', ') || '없음'));
        const { p, diffs } = quotePatch(a, q0, false);
        if (!diffs.length) return { id: q0.id, changed: [], note: '이미 그 값이라 바꾼 것이 없어요.' };
        mutate(ctx, () => MV.store.update((st) => {
          const q = quotesOf(st).find((x) => x.id === q0.id);
          if (q) Object.assign(q, p);
        }, { log: '🤖 업체 견적 수정: ' + (p.company || q0.company) + ' (' + diffs.join(', ') + ')' }), { section: 'estimate' });
        const q1 = quotesOf(MV.store.get()).find((x) => x.id === q0.id) || q0;
        const v = quoteView(q1, modelEstimate());
        record(ctx, '🚚 견적 “' + clip(q1.company, 24) + '” — ' + diffs.join(', '), '#/stuff/quotes');
        return { id: q1.id, changed: diffs, quote: v };
      },
    },
    {
      name: 'get_workplan', label: '워크플랜 보는 중',
      description: '주별 워크플랜(일정): 이번 주부터 이사 다음 주까지 주마다 할 일 수·완료·지연, 미완료 중요 일, 담당자별 미완료 수. 이번 주 전에 기한이 지난 미완료 일도 따로. 일정 점검·밀린 주 찾기에 쓰세요.',
      inputSchema: { type: 'object', properties: { weeks: { type: 'integer', minimum: 1, maximum: 10, description: '보여 줄 주 수 (기본: 이사 다음 주까지)' } } },
      run: (a) => {
        const today = D.today();
        const move = D.moveDate();
        const start = D.weekStart(today);
        const untilMove = Math.max(1, Math.floor(D.diff(start, D.weekStart(move)) / 7) + 2);
        const n = MV.clamp(Math.round(num(a.weeks) || untilMove), 1, 10);
        const items = MV.items.list();
        const brief = (i) => ({ id: i.id, title: clip(i.title, 60), due: i.due, dueFmt: D.fmt(i.due), owner: i.owner || '', priority: i.priority || 'mid' });
        const before = items.filter((i) => !i.done && D.valid(i.due) && i.due < start).sort(byDue);
        const weeks = [];
        for (let k = 0; k < n; k++) {
          const ws = D.add(start, k * 7);
          const we = D.add(ws, 6);
          const inW = items.filter((i) => D.valid(i.due) && i.due >= ws && i.due <= we);
          const open = inW.filter((i) => !i.done).sort(byDue);
          const owners = {};
          open.forEach((i) => { const o = OWNER_LABEL[i.owner || ''] || '미정'; owners[o] = (owners[o] || 0) + 1; });
          weeks.push({
            week: D.fmt(ws) + '~' + D.fmt(we), start: ws, end: we, isMoveWeek: move >= ws && move <= we,
            total: inW.length, done: inW.length - open.length, open: open.length,
            overdue: open.filter((i) => i.due < today).length,
            openByOwner: owners,
            importantOpen: open.filter((i) => i.priority === 'high').slice(0, 8).map(brief),
          });
        }
        return {
          today, moveDate: move, overdueBeforeThisWeek: { count: before.length, items: before.slice(0, 10).map(brief) },
          weeks, openNoDate: items.filter((i) => !i.done && !D.valid(i.due)).length, link: '#/dashboard',
        };
      },
    },
    {
      name: 'get_move_day', label: '당일 순서 보는 중',
      description: '이사 당일 순서: 자금흐름의 그날 돈 보내는 단계(시각·금액·완료)와 이사 전날~다음 날 할 일(이사당일 파트 포함, 설명 요약). 시간대별 순서를 답할 때 쓰세요.',
      run: () => {
        const move = D.moveDate();
        let steps = [];
        try {
          const fs = MV.calc && typeof MV.calc.financeSummary === 'function' ? MV.calc.financeSummary(MV.store.get()) : null;
          if (fs && Array.isArray(fs.steps)) {
            steps = fs.steps.map((s) => ({ time: s.time || '', title: clip(s.title, 80), amount: num(s.amount) ? krw(s.amount) : '', kind: s.kind || '', done: !!s.done }))
              .sort((x, y) => String(x.time).localeCompare(String(y.time)));
          }
        } catch (e) { steps = []; }
        const lo = D.add(move, -1);
        const hi = D.add(move, 1);
        const tasks = MV.items.list((i) => i.partId === 'moveday' || (D.valid(i.due) && i.due >= lo && i.due <= hi))
          .sort((x, y) => byDue(x, y))
          .slice(0, 30)
          .map((i) => ({ id: i.id, part: partName(i.partId), title: clip(i.title, 70), due: i.due, dueFmt: fmtDue(i.due), owner: i.owner || '', done: !!i.done, detail: clip(i.detail, 260) }));
        return { moveDate: move, moveDateFmt: D.fmt(move), moneySteps: steps, tasks, links: { money: '#/money/flow', moveday: '#/checklist/moveday', guide: '#/guide/moveday' } };
      },
    },
    {
      name: 'list_parts', label: '파트 보는 중',
      description: '체크리스트 파트(채널) 목록 [{id, name, group, done, total, overdue}]. add_item 에 쓸 partId 를 고를 때 쓰세요.',
      run: () => MV.parts.list().map((p) => { const s = MV.parts.stats(p.id); return { id: p.id, name: p.name, group: p.group || '', done: s.done, total: s.total, overdue: s.overdue }; }),
    },
    {
      name: 'list_inventory', label: '짐 목록 보는 중',
      description: '짐 목록(가구·가전)을 찾아요. 결과 {total, items:[{id, name, cat, fate, qty, size(가로×깊이×높이), lg, room, roomNew, note}]}. fate: move=가져감, buy=새로 구매, discard=버림, sell=판매·나눔, undecided=미정.',
      inputSchema: {
        type: 'object',
        properties: {
          fate: { type: 'string', enum: ['move', 'buy', 'discard', 'sell', 'undecided'] },
          cat: { type: 'string', enum: MV.inv.CATS.map((c) => c.id) },
          query: { type: 'string' }, limit: { type: 'integer', minimum: 1, maximum: 80 },
        },
      },
      run: (a) => {
        const fate = a.fate ? parseFate(a.fate) : null;
        const cat = a.cat ? parseCat(a.cat) : null;
        const words = str(a.query, 80).toLowerCase().split(/\s+/).filter(Boolean);
        const limit = MV.clamp(Math.round(num(a.limit) || 40), 1, 80);
        const list = MV.inv.list((x) => {
          if (fate && x.fate !== fate) return false;
          if (cat && x.cat !== cat) return false;
          if (words.length) {
            const hay = (x.name + ' ' + (x.note || '') + ' ' + (x.room || '') + ' ' + (x.roomNew || '') + ' ' + (x.tag || '')).toLowerCase();
            if (!words.every((w) => hay.indexOf(w) >= 0)) return false;
          }
          return true;
        });
        return { total: list.length, items: list.slice(0, limit).map(invView), link: '#/stuff/inventory' };
      },
    },
    {
      name: 'update_inventory', label: '짐 고치는 중',
      description: '짐 하나를 고쳐요: name, cat, fate(처리), qty, w·d·h(cm, 실측하면 추정 표시가 없어짐), url, note, lg(LG 서비스로 옮김), room, roomNew. 바꿀 것만 넣으세요.',
      inputSchema: {
        type: 'object',
        properties: {
          id: { type: 'string' }, name: { type: 'string' }, cat: { type: 'string' }, fate: { type: 'string', enum: ['move', 'buy', 'discard', 'sell', 'undecided'] },
          qty: { type: 'integer' }, w: { type: 'number' }, d: { type: 'number' }, h: { type: 'number' },
          url: { type: 'string' }, note: { type: 'string' }, lg: { type: 'boolean' }, room: { type: 'string' }, roomNew: { type: 'string' },
        },
        required: ['id'],
      },
      run: (a, ctx) => {
        const id = str(a.id, 80);
        const x = MV.inv.get(id);
        if (!x) throw new Error('id 가 "' + id + '"인 짐을 찾지 못했어요. list_inventory 로 먼저 찾아 주세요.');
        const { p, diffs } = invPatch(a, x);
        if (!diffs.length) return { id, name: x.name, changed: [], note: '이미 그 값이라 바꾼 것이 없어요.' };
        mutate(ctx, () => MV.inv.update(id, p, '🤖 짐 수정: ' + (p.name || x.name) + ' (' + diffs.join(', ') + ')'), { inventory: [id] });
        const y = MV.inv.get(id) || x;
        record(ctx, '📦 짐 “' + clip(y.name, 30) + '” — ' + diffs.join(', '), '#/stuff/inventory');
        return { id, changed: diffs, item: invView(y) };
      },
    },
    {
      name: 'add_inventory', label: '짐 추가하는 중',
      description: '짐 목록에 가구·가전을 추가해요. 크기(w·d·h, cm)를 모르면 비워 두세요 — 비슷한 규격 프리셋으로 추정하고 "추정"으로 표시해요. fate 기본 move(가져감).',
      inputSchema: {
        type: 'object',
        properties: {
          name: { type: 'string' }, cat: { type: 'string', enum: MV.inv.CATS.map((c) => c.id) }, fate: { type: 'string', enum: ['move', 'buy', 'discard', 'sell', 'undecided'] },
          qty: { type: 'integer' }, w: { type: 'number' }, d: { type: 'number' }, h: { type: 'number' },
          url: { type: 'string' }, note: { type: 'string' }, lg: { type: 'boolean' }, room: { type: 'string' }, roomNew: { type: 'string' },
        },
        required: ['name'],
      },
      run: (a, ctx) => {
        const { p } = invPatch(a, null);
        if (!p.name) throw new Error('짐 이름이 필요해요.');
        const nn = (x) => String(x || '').replace(/\s+/g, '').toLowerCase();
        const twin = MV.inv.list((x) => nn(x.name) === nn(p.name))[0];
        if (twin) throw new Error('“' + twin.name + '”이(가) 짐 목록에 이미 있어요 (id ' + twin.id + ', ' + MV.inv.fate(twin.fate).label + ', 수량 ' + num(twin.qty) + '). 같은 물건이면 update_inventory 로 qty 를 고치고, 다른 물건이면 이름을 구분되게(예: "' + p.name + ' 2") 주세요.');
        const dimsGiven = has(p, 'w') && has(p, 'd') && has(p, 'h');
        let preset = null;
        if (!dimsGiven) {
          preset = catalogMatch(p.name);
          const src = preset || { w: 60, d: 60, h: 60 };
          ['w', 'd', 'h'].forEach((k) => { if (!has(p, k)) p[k] = Math.round(num(src[k])) || 60; });
          p.assumed = true;
          if (preset) {
            if (!has(p, 'cat') && preset.cat) p.cat = preset.cat;
            if (preset.tag) p.tag = preset.tag;
            if (preset.ac && (p.cat || preset.cat) === 'aircon') p.ac = preset.ac;
          }
        } else p.assumed = false;
        if (!has(p, 'fate')) p.fate = 'move';
        if (!has(p, 'qty')) p.qty = 1;
        const it = MV.store.normInv(p);
        mutate(ctx, () => MV.store.update((st) => { if (!Array.isArray(st.inventory)) st.inventory = []; st.inventory.push(it); }, { log: '🤖 짐 추가: ' + it.name }), { inventory: [it.id] });
        record(ctx, '📦 짐 추가: ' + clip(it.name, 30) + ' (' + MV.inv.fate(it.fate).label + ', ' + it.w + '×' + it.d + '×' + it.h + 'cm' + (it.assumed ? ' 추정' : '') + ')', '#/stuff/inventory');
        return { id: it.id, item: invView(it), sizeNote: it.assumed ? (preset ? '규격은 “' + preset.name + '” 프리셋으로 추정했어요 — 실측하면 알려 주세요.' : '규격을 몰라 60×60×60cm 로 넣었어요 — 실측하면 알려 주세요.') : '' };
      },
    },
  ];
  const TOOL_LABEL = {};
  TOOLS.forEach((t) => { TOOL_LABEL[t.name] = t.label.replace(/ (보는|찾는|고치는|추가하는|남기는|넣는) 중$/, ''); });
  TOOL_LABEL.get_overview = '전체 현황'; TOOL_LABEL.list_items = '할 일 목록'; TOOL_LABEL.get_item = '할 일 자세히';
  TOOL_LABEL.get_budget = '예산'; TOOL_LABEL.get_estimate = '견적'; TOOL_LABEL.get_workplan = '워크플랜';
  TOOL_LABEL.get_move_day = '당일 순서'; TOOL_LABEL.list_parts = '파트'; TOOL_LABEL.list_inventory = '짐 목록';

  function buildTools(call, maxCount) {
    const list = maxCount && maxCount > 0 && maxCount < TOOLS.length ? TOOLS.slice(0, maxCount) : TOOLS;
    return list.map((t) => {
      const def = {
        name: t.name,
        description: t.description,
        execute: (input, context) => {
          const signal = context && context.signal;
          if (R.active !== call) throw new Error('이 요청은 이미 끝났어요.');
          if (signal && signal.aborted) throw new Error('중지했어요.');
          call.status = t.label + '…';
          if (call.tools.indexOf(t.name) < 0) call.tools.push(t.name);
          paintStatus(call);
          try {
            const out = t.run(input && typeof input === 'object' && !Array.isArray(input) ? input : {}, { call, signal });
            return capResult(out === undefined ? { ok: true } : out);
          } catch (e) {
            throw (e instanceof Error ? e : new Error(String(e)));
          } finally {
            call.status = '답을 정리하는 중…';
            paintStatus(call);
          }
        },
      };
      if (t.inputSchema) def.inputSchema = t.inputSchema;
      return def;
    });
  }

  /* ======================= 대화 보내기 ======================= */
  function findMsg(id) { return R.chat.msgs.find((m) => m.id === id) || null; }
  function pushMsg(m) {
    own(m);
    R.chat.msgs.push(m);
    if (R.chat.msgs.length > KEEP_MSGS) R.chat.msgs.splice(0, R.chat.msgs.length - KEEP_MSGS);
  }
  /** 대화의 마지막 메시지인지 ('다시 보내기'는 마지막 답에만 — 옛 요청을 다시 실행하지 않게) */
  function isLatest(m) { const l = R.chat.msgs[R.chat.msgs.length - 1]; return !!l && !!m && l.id === m.id; }
  const hasBody = (m) => !!(String(m.text || '').trim() || (m.changes && m.changes.length));
  function turnText(m) {
    let t = String(m.text || '').trim();
    if (m.role === 'assistant' && (m.status === 'error' || m.status === 'stopped')) t += (t ? '\n\n' : '') + '(이 답은 여기서 끊겼어요)';
    if (m.role === 'assistant' && m.changes && m.changes.length) {
      t += '\n\n(이 답에서 앱에 이미 반영한 변경: ' + m.changes.map((c) => c.t).join(' / ') + (m.undo === 'used' ? ' — 이후 사용자가 이 변경을 모두 되돌림' : '') + ')';
    }
    if (t.length > TURN_CHARS) t = t.slice(0, TURN_CHARS) + '…(이하 생략)';
    return t;
  }
  /** 같은 역할이 이어지면 한 턴으로 (끊긴 답 + 다시 보낸 답) */
  function mergeTurns(turns) {
    const out = [];
    turns.forEach((t) => {
      const prev = out[out.length - 1];
      if (prev && prev.role === t.role) prev.content += '\n\n' + t.content;
      else out.push({ role: t.role, content: t.content });
    });
    return out;
  }
  const CONTINUE = '(앞 답이 중간에 끊겼어요. 위에 적힌 "앱에 이미 반영한 변경"은 저장돼 있으니 같은 변경을 다시 하지 마세요 — 필요하면 도구로 지금 상태를 확인하고, 남은 일만 한 뒤 처음 질문에 대한 답을 처음부터 끝까지 다시 써 주세요.)';
  /** 보낼 턴: [지시 턴] + 최근 대화 (cont: 끊긴 답을 이어서 다시 묻는 경우 그 질문에 대한 앞선 답들) */
  function buildInput(userId, withTools, budget, cont) {
    const idx = R.chat.msgs.findIndex((m) => m.id === userId);
    const hist = R.chat.msgs.slice(0, idx + 1).filter((m) => m.status !== 'pending' && hasBody(m));
    let turns = hist.map((m) => ({ role: m.role, content: turnText(m) }));
    if (cont && cont.length) {
      turns = turns.concat(cont.map((m) => ({ role: 'assistant', content: turnText(m) })), [{ role: 'user', content: CONTINUE }]);
    }
    let tail = mergeTurns(turns).slice(-SEND_TURNS);
    const trimHead = () => { while (tail.length > 1 && tail[0].role !== 'user') tail.shift(); };
    trimHead();
    const instr = instruction(withTools);
    const size = () => bytes(instr) + tail.reduce((s, t) => s + bytes(t.content), 0);
    while (tail.length > 1 && size() > budget) { tail.shift(); trimHead(); }
    return [{ role: 'user', content: instr }].concat(tail);
  }

  const TIER_LABEL = { default: '기본', complex: '고급', quick: '빠른' };
  async function send(text, opts) {
    opts = opts || {};
    const sample = sampleFn();
    if (!sample || R.blocked || R.active) return false;
    let userMsg;
    let cont = null;
    if (opts.retryOf) {
      userMsg = findMsg(opts.retryOf);
      if (!userMsg) return false;
      if (opts.cont) cont = R.chat.msgs.filter((m) => m.replyTo === userMsg.id && m.role === 'assistant' && m.status !== 'pending' && hasBody(m));
    } else {
      text = String(text || '').trim().slice(0, MAX_TEXT);
      if (!text) return false;
      userMsg = { id: MV.uid('am'), role: 'user', text, at: MV.nowISO() };
      pushMsg(userMsg);
    }
    const bot = { id: MV.uid('am'), role: 'assistant', text: '', at: MV.nowISO(), status: 'pending', replyTo: userMsg.id, changes: [] };
    if (opts.noTools || R.toolsOff) bot.noTools = true;
    if (opts.retryOf) {
      // 그 질문에 대한 앞선 답들 바로 뒤에 붙임 (실패한 빈 답은 이미 지웠음)
      own(bot);
      const at = R.chat.msgs.findIndex((m) => m.id === userMsg.id);
      let j = at + 1;
      while (j < R.chat.msgs.length && R.chat.msgs[j].replyTo === userMsg.id) j++;
      R.chat.msgs.splice(j, 0, bot);
      if (R.chat.msgs.length > KEEP_MSGS) R.chat.msgs.splice(0, R.chat.msgs.length - KEEP_MSGS);
    } else pushMsg(bot);
    const call = {
      id: MV.uid('call'), ctl: new AbortController(), msgId: bot.id, changes: bot.changes, tools: [], foreign: false,
      pre: { items: {}, inventory: {}, sections: {} }, post: {}, status: null, gotText: false,
    };
    R.active = call;
    saveChat();
    if (opts.retryOf) paintAll(true); else appendMsgs([userMsg, bot]);
    updateComposer();
    updateFab();
    let finished = false;
    try {
      let tools = null;
      if (!bot.noTools) {
        const lim = await getLimits();
        if (lim && lim.tools && !R.toolsOff) tools = buildTools(call, num(lim.tools.maxCount) || TOOLS.length);
        else bot.noTools = true;
      }
      if (call.ctl.signal.aborted) throw { code: 'cancelled' };
      const lim = R.limits;
      const budget = Math.max(16 * 1024, Math.min(INPUT_BUDGET, (lim && num(lim.maxPromptBytes) ? num(lim.maxPromptBytes) - 24 * 1024 : INPUT_BUDGET)));
      const input = buildInput(userMsg.id, !!tools, budget, cont);
      const options = {
        signal: call.ctl.signal,
        cache: false,
        onText: (u) => {
          if (R.active !== call || !u || typeof u.text !== 'string') return;
          bot.text = u.text;
          call.gotText = true;
          paintMsg(bot.id);
        },
      };
      if (tools && tools.length) options.tools = tools;
      if (R.prefs.quick) options.modelTier = 'quick';
      const res = await sample(input, options);
      bot.text = String((res && res.text) || bot.text || '');
      bot.status = 'done';
      if (res && res.truncated) { bot.truncated = true; bot.note = '답이 길이 제한에 걸려 중간에 끊겼어요. 나눠서 물어봐 주세요.'; }
      // ⚡ 빠른 답변을 골랐는데 요금제가 다른 모델을 썼으면 알려 줌
      if (options.modelTier && res && typeof res.modelTierApplied === 'string' && res.modelTierApplied !== options.modelTier) {
        bot.tier = res.modelTierApplied;
        if (!R.tierNote) { R.tierNote = true; MV.ui.toast('이 계정 요금제에서는 ⚡ 빠른 답변을 쓸 수 없어 ' + (TIER_LABEL[bot.tier] || '다른') + ' 모델로 답했어요.', { ms: 6000 }); }
        paintHeadState();
      }
      finished = true;
    } catch (e) {
      handleError(bot, e);
    } finally {
      finalize(call, bot, finished);
    }
    return true;
  }

  function handleError(bot, e) {
    const code = (e && typeof e === 'object' && typeof e.code === 'string') ? e.code : 'upstream_error';
    const partial = e && typeof e.text === 'string' ? e.text : '';
    bot.code = code;
    bot.status = 'error';
    bot.actions = [];
    if (code === 'cancelled') {
      bot.status = 'stopped';
      bot.text = partial || bot.text || '';
      bot.note = '중지했어요.';
      return;
    }
    if (HIDE_CODES.has(code)) {
      bot.text = partial || '';
      bot.note = (BLOCK_COPY[code] || BLOCK_COPY.capability_disabled)[0] + ' — 이 창에서는 AI 비서를 숨겨요.';
      R.blocked = code;
      return;
    }
    if (code === 'refused') {
      bot.text = '';
      bot.note = '이 요청은 처리할 수 없었어요. 묻는 내용을 바꿔서 다시 물어봐 주세요.' + (bot.changes && bot.changes.length ? ' 그 전에 바꾼 것은 아래에 남아 있어요.' : '');
      return;
    }
    bot.text = partial || bot.text || '';
    if (code === 'rate_limited') { bot.note = '요청이 많아요. 잠시 뒤 다시 물어봐 주세요.'; bot.actions = ['retry']; return; }
    if (code === 'session_expired') { bot.note = 'Claude 로그인이 끝났어요. 다시 로그인해 주세요.'; bot.actions = ['retry']; return; }
    if (code === 'prompt_too_large') { bot.note = '대화가 너무 길어요. 대화를 지우고 다시 물어봐 주세요.'; bot.actions = ['clear']; return; }
    if (code === 'tools_unavailable') {
      // 이 보기에서는 도구를 못 씀 → 이 창에서는 다음 질문부터 도구 없이 물음 ('읽기 전용' 표시)
      R.toolsOff = true;
      paintHeadState();
      bot.note = '이 화면에서는 AI가 앱 데이터를 직접 읽고 고칠 수 없어요. 도구 없이 다시 물으면 요약 정보로만 답하고, 다음 질문부터는 처음부터 도구 없이 물어요.';
      bot.actions = ['notools'];
      return;
    }
    if (code === 'empty_completion') { bot.note = '답을 받지 못했어요. 질문을 조금 줄이거나 바꿔서 다시 보내 주세요.'; bot.actions = ['retry']; return; }
    if (code === 'invalid_request' || code === 'transform_error' || code === 'queue_overflow') { bot.note = '요청을 보내지 못했어요 (앱 문제: ' + code + '). 잠시 뒤 다시 보내 주세요.'; bot.actions = ['retry']; return; }
    bot.note = bot.text ? '답이 중간에 끊겼어요 (연결 문제).' : '답을 받지 못했어요 (연결 문제).';
    if (bot.changes && bot.changes.length) bot.note += ' 아래 변경은 이미 반영됐어요 — 다시 보내면 그 변경은 빼고 이어서 답해요.';
    bot.actions = ['retry'];
  }

  function finalize(call, bot, finished) {
    if (R.active === call) R.active = null;
    call.status = null;
    bot.changes = call.changes.slice();
    bot.tools = call.tools.slice();
    if (finished && !String(bot.text || '').trim()) bot.text = '(빈 답)';
    if (bot.status === 'pending') bot.status = 'done';
    const prevUndo = Array.from(R.undos.keys());
    // 앞선 답의 되돌리기는 이번 답이 같은 항목을 고쳤으면 막힘 (다른 항목이면 그대로 둠)
    checkUndo();
    if (bot.changes.length && findMsg(bot.id)) {
      // 답이 끝나기 전에 사람이 AI가 고친 것을 또 고쳤으면, 되돌릴 때 그것도 되돌아감 (확인 창에서 알림)
      const foreign = call.foreign || Object.keys(call.post).some((k) => {
        const i = k.indexOf(':');
        return call.post[k] !== fpValue(valueOf(k.slice(0, i), k.slice(i + 1)));
      });
      R.undos.set(bot.id, { pre: call.pre, fp: undoFingerprint(call.pre), foreign });
      bot.undo = 'avail';
      // 너무 오래된 되돌리기는 정리 (메모리)
      while (R.undos.size > MAX_UNDOS) {
        const oldId = R.undos.keys().next().value;
        R.undos.delete(oldId);
        const om = findMsg(oldId);
        if (om && om.undo === 'avail') { om.undo = 'stale'; om.undoWhy = 'old'; own(om); }
        prevUndo.push(oldId);
      }
    }
    call.pre = null;
    saveChat();
    if (R.blocked) {
      syncAvailability();
      MV.store.emit('caps', MV.sync && MV.sync.cap);
      if (R.view && R.view.root.isConnected && R.view.mode !== 'blocked') { MV.rerender(true); return; }
    }
    // 바뀐 답만 다시 그림 (대화 전체를 다시 그리면 화면 낭독기가 처음부터 다시 읽어요)
    refreshMsgs([bot.id].concat(prevUndo, R.chat.msgs.filter((m) => m.actions && m.actions.length).map((m) => m.id)));
    updateComposer();
    updateFab();
    if (R.view && document.activeElement === document.body && R.composerFocused) focusComposer();
  }

  function retry(botId, noTools) {
    if (R.active) return;
    const bot = findMsg(botId);
    if (!bot || !isLatest(bot)) return;
    const userId = bot.replyTo;
    if (!userId || !findMsg(userId)) return;
    if (!hasBody(bot)) {
      R.removed.add(botId);
      R.chat.msgs = R.chat.msgs.filter((m) => m.id !== botId);
    } else {
      bot.actions = [];
      own(bot);
    }
    // 그 질문에 대한 앞선 답(끊긴 글·이미 바꾼 것)을 같이 보내 같은 변경을 다시 하지 않게
    const cont = R.chat.msgs.some((m) => m.replyTo === userId && m.role === 'assistant' && hasBody(m));
    send('', { retryOf: userId, noTools: !!noTools, cont });
  }
  function stop() {
    if (R.active) { try { R.active.ctl.abort(); } catch (e) { /* 무시 */ } }
  }

  /* ======================= 되돌리기 ======================= */
  /** 되돌리기가 남은 답마다: 그 답이 고친 것이 이후에 또 바뀌었으면 막음 */
  function checkUndo() {
    if (!R.undos.size) return;
    let dirty = false;
    Array.from(R.undos.entries()).forEach(([id, u]) => {
      const m = findMsg(id);
      if (m && undoFingerprint(u.pre) === u.fp) return;
      R.undos.delete(id);
      if (m && m.undo === 'avail') { m.undo = 'stale'; m.undoWhy = 'changed'; own(m); dirty = true; paintMsg(m.id); }
    });
    if (dirty) saveChat();
  }
  const checkUndoSoon = MV.debounce(checkUndo, 300);
  MV.store.on('change', () => { if (R.undos.size) checkUndoSoon(); });
  MV.store.on('flush', () => { if (R.active) saveChat(); });

  /** AI가 고친 것만 고치기 전 값으로 (다른 데이터 — 도면 사진·화면 설정·다른 항목 — 는 그대로) */
  function applyUndo(pre, n) {
    try {
      MV.store.update((st) => {
        ['items', 'inventory'].forEach((kind) => {
          const box = pre[kind] || {};
          Object.keys(box).forEach((id) => {
            if (!Array.isArray(st[kind])) st[kind] = [];
            const list = st[kind];
            const i = list.findIndex((x) => x && x.id === id);
            const old = box[id];
            if (old === NONE) {
              if (i >= 0) list.splice(i, 1);
              if (kind === 'inventory' && st.layouts && typeof st.layouts === 'object') {
                Object.values(st.layouts).forEach((lay) => { if (lay && Array.isArray(lay.placements)) lay.placements = lay.placements.filter((p) => p.invId !== id); });
              }
            } else if (i >= 0) list[i] = MV.clone(old);
            else list.push(MV.clone(old));
          });
        });
        Object.keys(pre.sections || {}).forEach((key) => {
          const old = pre.sections[key];
          if (old === NONE) delete st[key]; else st[key] = MV.clone(old);
        });
      }, { log: '🤖 AI 변경 되돌리기 (' + n + '건)' });
      return true;
    } catch (e) { console.error('[agent] undo', e); return false; }
  }
  function undoChanges(msgId) {
    const m = findMsg(msgId);
    if (!m) return;
    checkUndo();
    const u = R.undos.get(msgId);
    if (!u) {
      if (m.undo === 'avail') { m.undo = 'stale'; own(m); }
      saveChat(); paintMsg(msgId);
      MV.ui.toast('이후에 같은 항목이 또 바뀌어 되돌릴 수 없어요.');
      return;
    }
    const n = m.changes.length;
    const msg = 'AI 비서가 이번 답에서 바꾼 ' + n + '건을 모두 되돌릴까요? 다른 데이터(다른 할 일·도면 사진 등)는 그대로예요.' +
      (u.foreign ? ' AI가 답하는 동안 같은 항목을 직접 고친 것도 함께 되돌아가요.' : '') + ' 되돌린 뒤에는 다시 살릴 수 없어요.';
    MV.ui.confirm(msg, { okLabel: '모두 되돌리기', danger: true, title: '변경 되돌리기' }).then((ok) => {
      if (!ok) return;
      checkUndo();
      if (!R.undos.has(msgId)) { MV.ui.toast('그 사이 같은 항목이 바뀌어 되돌리지 않았어요.'); return; }
      const pre = R.undos.get(msgId).pre;
      R.undos.delete(msgId);
      const done = applyUndo(pre, n);
      m.undo = done ? 'used' : 'stale';
      own(m);
      saveChat();
      MV.ui.toast(done ? 'AI 변경 ' + n + '건을 되돌렸어요.' : '되돌리지 못했어요.');
      paintMsg(msgId);
      // 눌렀던 버튼이 다시 그려져 사라졌으니 키보드 초점을 입력칸으로 (터치 화면은 키보드가 뜨지 않게 그대로)
      if (!document.activeElement || document.activeElement === document.body || !document.activeElement.isConnected) focusComposer();
    });
  }

  function clearChat() {
    if (!R.chat.msgs.length) return;
    /* 답하는 중이면 멈추고, 그 답이 이미 바꾼 것이 있으면 그 질문과 답은 남겨 둠 (변경 목록·되돌리기를 잃지 않게) */
    const liveKeep = () => {
      const c = R.active;
      const bot = c && c.changes.length ? findMsg(c.msgId) : null;
      return bot ? [bot.replyTo, bot.id] : [];
    };
    const keepAtAsk = liveKeep();   // 확인 창이 떠 있는 동안 답이 끝나도 약속대로 남김
    const run = () => {
      const keep = new Set(liveKeep().concat(keepAtAsk));
      stop();
      saveChat();   // 다른 탭에서 온 메시지까지 합친 뒤 지움
      R.chat.msgs.forEach((m) => { if (!keep.has(m.id)) R.removed.add(m.id); });
      R.chat.msgs = R.chat.msgs.filter((m) => keep.has(m.id));
      Array.from(R.undos.keys()).forEach((id) => { if (!keep.has(id)) R.undos.delete(id); });
      saveChat();
      paintAll(true);
      updateComposer();
      focusComposer();
    };
    const call = R.active;
    let extra = '';
    if (call) extra = call.changes.length ? ' 지금 답하는 중인 질문은 멈춰요. 그 답이 이미 바꾼 ' + call.changes.length + '건은 되돌릴 수 있게 그 질문과 답만 남겨 둬요.' : ' 지금 답하는 중인 질문도 멈춰요.';
    else if (R.undos.size) extra = ' 답 아래 ‘변경 되돌리기’도 더는 할 수 없어요 (바뀐 데이터는 그대로예요).';
    MV.ui.confirm('대화 기록을 모두 지울까요? 앱 데이터(체크·예산·견적)는 그대로예요.' + extra, { okLabel: '대화 지우기', danger: true }).then((ok) => { if (ok) run(); });
  }

  /* ======================= 안전한 마크다운 ======================= */
  const LIST_RE = /^(\s*)([-*•+]|\d{1,3}[.)])\s+(.*)$/;
  /* **굵게**(안에 *기울임* 가능) · `코드` · [글](주소 — 괄호 한 겹 허용) · 맨 주소 · #/앱 링크 · ~~취소~~ · *기울임* */
  const INLINE_RE = /\*\*((?:[^*\n]|\*(?!\*))+?)\*\*|`([^`\n]+)`|\[([^\]\n]+)\]\(\s*((?:[^()\s]|\([^()\s]*\))+)\s*\)|(https?:\/\/[^\s<>"'`]+)|(#\/[A-Za-z0-9_~%\-/.]+)|~~([^~\n]+)~~|\*([^*\s][^*\n]*?)\*/g;
  /* '11. 3.(화) 이사 당일' 같은 날짜 줄은 번호 목록이 아님 */
  const DATE_LINE = /^\s*(1[0-2]|0?[1-9])\.\s*([12]\d|3[01]|0?[1-9])\.(?!\d)/;
  const isListLine = (line) => LIST_RE.test(line) && !/^\s*\*\*/.test(line) && !DATE_LINE.test(line);
  /** 맨 주소 끝의 문장부호는 빼고, 닫는 괄호는 짝이 맞을 때만 주소에 포함 */
  function trimUrl(u) {
    let s = u;
    for (;;) {
      const ch = s.slice(-1);
      if (/[.,;:!?'"。、\]}]/.test(ch)) { s = s.slice(0, -1); continue; }
      if (ch === ')' && (s.match(/\(/g) || []).length < (s.match(/\)/g) || []).length) { s = s.slice(0, -1); continue; }
      return s;
    }
  }
  const indentOf = (s) => String(s || '').replace(/\t/g, '    ').length;
  function md(text) {
    const frag = document.createDocumentFragment();
    const lines = String(text || '').replace(/\r\n?/g, '\n').split('\n');
    let para = null;
    const flush = () => {
      if (para && para.length) {
        const p = el('p');
        para.forEach((ln, k) => { if (k) p.appendChild(el('br')); inline(p, ln, 0); });
        frag.appendChild(p);
      }
      para = null;
    };
    let i = 0;
    while (i < lines.length) {
      const line = lines[i];
      if (/^\s*```/.test(line)) {
        flush();
        const buf = [];
        i++;
        while (i < lines.length && !/^\s*```/.test(lines[i])) { buf.push(lines[i]); i++; }
        i++;
        frag.appendChild(el('pre', { class: 'ag-pre' }, el('code', buf.join('\n'))));
        continue;
      }
      if (!line.trim()) { flush(); i++; continue; }
      let m = /^\s{0,3}(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);
      if (m) { flush(); const h = el('p', { class: 'ag-h ag-h' + Math.min(m[1].length, 3) }); inline(h, m[2], 0); frag.appendChild(h); i++; continue; }
      if (/^\s{0,3}([-*_])(\s*\1){2,}\s*$/.test(line)) { flush(); frag.appendChild(el('hr', { class: 'ag-hr' })); i++; continue; }
      if (/^\s*\|.*\|\s*$/.test(line) && i + 1 < lines.length && /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(lines[i + 1])) {
        flush();
        const rows = [];
        rows.push(line);
        i += 2;
        while (i < lines.length && /^\s*\|.*\|?\s*$/.test(lines[i]) && lines[i].trim()) { rows.push(lines[i]); i++; }
        frag.appendChild(table(rows));
        continue;
      }
      if (/^\s*>\s?/.test(line)) {
        flush();
        const buf = [];
        while (i < lines.length && /^\s*>\s?/.test(lines[i])) { buf.push(lines[i].replace(/^\s*>\s?/, '')); i++; }
        const q = el('blockquote', { class: 'ag-quote' });
        q.appendChild(md(buf.join('\n')));
        frag.appendChild(q);
        continue;
      }
      if (isListLine(line)) { flush(); i = list(lines, i, frag); continue; }
      (para = para || []).push(line.trim());
      i++;
    }
    flush();
    return frag;
  }
  function cells(row) {
    let s = row.trim();
    if (s.startsWith('|')) s = s.slice(1);
    if (s.endsWith('|')) s = s.slice(0, -1);
    return s.split('|').map((c) => c.trim());
  }
  function table(rows) {
    const head = cells(rows[0]);
    const tbl = el('table', { class: 'tbl' },
      el('thead', el('tr', head.map((h) => { const th = el('th'); inline(th, h, 0); return th; }))),
      el('tbody', rows.slice(1).map((r) => el('tr', cells(r).slice(0, Math.max(head.length, 1)).map((c) => {
        const td = el('td');
        if (/^[-+−]?[\d,.]+\s*(원|만원|억|%|명|톤|개|건)?$/.test(c)) td.className = 'num';
        inline(td, c, 0);
        return td;
      })))));
    return el('div', { class: 'table-wrap ag-table' }, tbl);
  }
  function list(lines, i, parent) {
    const first = LIST_RE.exec(lines[i]);
    const base = indentOf(first[1]);
    const ordered = /\d/.test(first[2]);
    const delim = first[2].slice(-1);   // '1.' 과 '1)' 은 다른 목록
    const node = el(ordered ? 'ol' : 'ul', { class: 'ag-list' });
    if (ordered) { const n = parseInt(first[2], 10); if (n > 1) node.setAttribute('start', String(n)); }
    let li = null;
    while (i < lines.length) {
      const line = lines[i];
      if (!line.trim()) {
        let j = i + 1;
        while (j < lines.length && !lines[j].trim()) j++;
        const nm = j < lines.length && isListLine(lines[j]) ? LIST_RE.exec(lines[j]) : null;
        if (nm && (indentOf(nm[1]) > base || (indentOf(nm[1]) === base && /\d/.test(nm[2]) === ordered && (!ordered || nm[2].slice(-1) === delim)))) { i = j; continue; }
        break;
      }
      const m = isListLine(line) ? LIST_RE.exec(line) : null;
      if (m) {
        const ind = indentOf(m[1]);
        if (ind < base) break;
        if (ind > base && li) { i = list(lines, i, li); continue; }
        if (/\d/.test(m[2]) !== ordered) break;
        if (ordered && m[2].slice(-1) !== delim) break;
        li = el('li');
        inline(li, m[3], 0);
        node.appendChild(li);
        i++;
        continue;
      }
      if (li && /^\s+\S/.test(line) && indentOf(/^(\s*)/.exec(line)[1]) > base) { li.appendChild(el('br')); inline(li, line.trim(), 0); i++; continue; }
      break;
    }
    parent.appendChild(node);
    return i;
  }
  function linkNode(label, href) {
    const h = String(href || '').trim();
    if (/^https?:\/\//i.test(h)) {
      let ok = false;
      try { const u = new URL(h); ok = u.protocol === 'http:' || u.protocol === 'https:'; } catch (e) { ok = false; }
      if (ok) {
        const a = el('a', { href: h, target: '_blank', rel: 'noopener noreferrer' });
        a.textContent = label;
        return a;
      }
    } else if (/^#\/[A-Za-z0-9_~%\-/.]*$/.test(h)) {
      const a = el('a', { href: h, class: 'ag-in' });
      a.textContent = label;
      return a;
    }
    return document.createTextNode(label);
  }
  function inline(parent, text, depth) {
    const s = String(text == null ? '' : text);
    const re = new RegExp(INLINE_RE.source, 'g');
    let last = 0;
    let m;
    while ((m = re.exec(s))) {
      const start = m.index;
      let node = null;
      let consumed = m[0];
      if (m[1] != null) {
        node = el('strong');
        if (depth < 2) inline(node, m[1], depth + 1); else node.textContent = m[1];
      } else if (m[2] != null) node = el('code', m[2]);
      else if (m[3] != null) node = linkNode(m[3], m[4]);
      else if (m[5] != null) {
        const url = trimUrl(m[5]);
        consumed = url;
        re.lastIndex = start + url.length;
        node = linkNode(url.length > 64 ? url.slice(0, 61) + '…' : url, url);
      } else if (m[6] != null) {
        const prev = start ? s[start - 1] : '';
        if (prev && !/[\s(（[“"'·,:]/.test(prev)) { continue; }
        const h = m[6].replace(/[.,;:!?)]+$/, '');
        consumed = h;
        re.lastIndex = start + h.length;
        node = linkNode(h, h);
      } else if (m[7] != null) node = el('s', m[7]);
      else if (m[8] != null) {
        const prev = start ? s[start - 1] : '';
        if (prev && /[\w*]/.test(prev)) continue;
        node = el('em');
        if (depth < 2) inline(node, m[8], depth + 1); else node.textContent = m[8];
      }
      if (!node) continue;
      if (start > last) parent.appendChild(document.createTextNode(s.slice(last, start)));
      parent.appendChild(node);
      last = start + consumed.length;
    }
    if (last < s.length) parent.appendChild(document.createTextNode(s.slice(last)));
  }

  /* ======================= 그리기 ======================= */
  function isTouch() { try { return window.matchMedia('(hover: none)').matches; } catch (e) { return false; } }
  function nearBottom(box) { return !box || box.scrollHeight - box.scrollTop - box.clientHeight < 90; }
  /* 키가 낮은 화면(가로로 든 폰)에서는 대화가 페이지와 함께 스크롤돼요 (CSS) */
  function logScrolls(v) { try { return getComputedStyle(v.log).overflowY !== 'visible'; } catch (e) { return true; } }
  function atBottom(v) {
    if (logScrolls(v)) return nearBottom(v.log);
    return document.documentElement.scrollHeight - window.scrollY - window.innerHeight < 160;
  }
  function toBottom(v) {
    if (logScrolls(v)) v.log.scrollTop = v.log.scrollHeight;
    else window.scrollTo(0, document.documentElement.scrollHeight);
    v.stick = true;
  }
  function focusComposer() {
    const v = R.view;
    if (!v || !v.ta || !v.ta.isConnected || isTouch()) return;
    try { v.ta.focus({ preventScroll: true }); } catch (e) { /* 무시 */ }
  }

  function changesBox(m) {
    const live = R.active && R.active.msgId === m.id;
    const ch = m.changes || [];
    if (!ch.length) return null;
    const box = el('div', { class: 'ag-changes', role: 'group', 'aria-label': '이 답에서 바꾼 것' },
      el('div', { class: 'ag-changes-h' }, el('span', '🛠 변경 ' + ch.length + '건'),
        m.undo === 'used' ? el('span', { class: 'chip' }, '되돌림') : null,
        live ? el('span', { class: 'chip think' }, '진행 중') : null),
      el('ul', ch.map((c) => el('li', c.href ? el('a', { href: c.href, class: 'ag-in' }, c.t) : c.t))));
    if (live) return box;
    if (m.undo === 'avail') {
      box.appendChild(el('button', { type: 'button', class: 'btn btn-sm btn-danger ag-undo', onclick: () => undoChanges(m.id) }, '↺ 이번 변경 모두 되돌리기'));
    } else if (m.undo === 'stale') {
      box.appendChild(el('div', { class: 'ag-undo-note' },
        el('button', { type: 'button', class: 'btn btn-sm ag-undo', disabled: true }, '↺ 이번 변경 모두 되돌리기'),
        el('span', { class: 'tiny muted' }, (m.undoWhy === 'old' ? '오래된 답이라' : '이후에 같은 항목이 다시 바뀌어') + ' 한 번에 되돌릴 수 없어요 — 링크를 눌러 직접 고쳐 주세요.')));
    } else if (m.undo === 'gone') {
      box.appendChild(el('p', { class: 'tiny muted mb-0 ag-undo-note' }, '한 번에 되돌리기는 답을 받은 창에서만 할 수 있어요 — 링크를 눌러 직접 고쳐 주세요.'));
    }
    return box;
  }
  function buildMsg(m) {
    const user = m.role === 'user';
    const node = el('div', { class: 'ag-msg ' + (user ? 'ag-user' : 'ag-bot'), 'data-id': m.id });
    if (user) {
      node.appendChild(el('div', { class: 'ag-bubble' }, m.text));
      node.appendChild(el('div', { class: 'ag-meta' }, D.time(m.at)));
      return node;
    }
    const pending = m.status === 'pending';
    if (pending) node.setAttribute('aria-busy', 'true');
    const bubble = el('div', { class: 'ag-bubble' });
    if (String(m.text || '').trim()) {
      const body = el('div', { class: 'ag-md' });
      body.appendChild(md(m.text));
      bubble.appendChild(body);
    } else if (pending) {
      bubble.appendChild(el('div', { class: 'ag-thinking' }, el('span', { class: 'ag-dots', 'aria-hidden': 'true' }, el('i'), el('i'), el('i')), '생각하는 중…'));
    }
    if (bubble.childNodes.length) node.appendChild(bubble);
    if (pending) {
      const call = R.active && R.active.msgId === m.id ? R.active : null;
      node.appendChild(el('div', { class: 'ag-status', 'aria-live': 'polite' }, call && call.status ? '🔧 ' + call.status : (call && call.gotText ? '✍️ 쓰는 중…' : '')));
    }
    if (m.note && m.status !== 'pending') {
      const bad = m.status === 'error' && (m.code === 'refused' || HIDE_CODES.has(m.code) || m.code === 'session_expired');
      const box = el('div', { class: 'ag-alert' + (m.status === 'stopped' ? ' ag-soft' : bad ? ' ag-bad' : ''), role: m.status === 'error' ? 'alert' : null }, el('span', m.note));
      // '다시 보내기'·'도구 없이'는 대화의 마지막 답에만 (옛 요청을 다시 실행하지 않게)
      const acts = (m.actions || []).filter((a) => !R.active && (a === 'clear' || isLatest(m)));
      if (acts.length && sampleFn() && !R.blocked) {
        box.appendChild(el('div', { class: 'row ag-acts' }, acts.map((a) => {
          if (a === 'retry') return el('button', { type: 'button', class: 'btn btn-sm', onclick: () => retry(m.id, !!m.noTools) }, '↻ 다시 보내기');
          if (a === 'notools') return el('button', { type: 'button', class: 'btn btn-sm', onclick: () => retry(m.id, true) }, '도구 없이 다시 묻기');
          if (a === 'clear') return el('button', { type: 'button', class: 'btn btn-sm', onclick: clearChat }, '대화 지우기');
          return null;
        })));
      }
      node.appendChild(box);
    }
    const ch = changesBox(m);
    if (ch) node.appendChild(ch);
    if (m.status !== 'pending') {
      const used = (m.tools || []).filter((t) => !/^(update_|add_)/.test(t)).map((t) => TOOL_LABEL[t] || t);
      node.appendChild(el('div', { class: 'ag-meta' },
        el('span', '🤖 ' + D.time(m.at)),
        used.length ? el('span', '· 확인: ' + used.join(', ')) : null,
        m.noTools ? el('span', { title: '이 답은 앱 데이터를 직접 읽거나 바꾸지 않았어요' }, '· 요약만 보고 답함') : null,
        m.tier ? el('span', { title: '⚡ 빠른 답변을 이 요금제에서 쓸 수 없어 다른 모델이 답했어요' }, '· ⚡ 대신 ' + (TIER_LABEL[m.tier] || m.tier) + ' 모델') : null));
    }
    return node;
  }
  function welcome() {
    const box = el('div', { class: 'ag-welcome' },
      el('div', { class: 'ag-hello', 'aria-hidden': 'true' }, '🤖'),
      el('h2', '무엇을 도와드릴까요?'),
      el('p', { class: 'small muted' }, '체크리스트·워크플랜·예산·견적·짐 목록을 보고 답하고, 말하면 바로 체크하고 고쳐요. 바꾼 것은 기록에 🤖로 남고 한 번에 되돌릴 수 있어요.'),
      el('div', { class: 'ag-grid' }, SUGGESTIONS.map((s) => el('button', {
        type: 'button', class: 'ag-sugg', disabled: !!R.active, onclick: () => submit(s.prompt()),
      }, el('span', { class: 'ag-sugg-i', 'aria-hidden': 'true' }, s.icon), el('span', typeof s.label === 'function' ? s.label() : s.label)))),
      el('div', { class: 'ag-ex' },
        el('p', { class: 'tiny muted mb-0' }, '이렇게 말해도 돼요 (눌러서 입력창에 넣기)'),
        el('div', { class: 'ag-ex-list' }, EXAMPLES.map((t) => el('button', {
          type: 'button', class: 'ag-ex-btn', onclick: () => fillComposer(t),
        }, '“' + t + '”')))));
    return box;
  }
  function paintAll(forceScroll) {
    const v = R.view;
    if (!v || !v.log || !v.log.isConnected) return;
    const msgs = R.chat.msgs;
    const stick = atBottom(v);
    const top = v.log.scrollTop;
    v.log.replaceChildren(...(msgs.length ? msgs.map(buildMsg) : [welcome()]));
    v.log.classList.toggle('ag-log-empty', !msgs.length);
    if (v.chips) { v.chips.hidden = !msgs.length; if (v.moreHint) requestAnimationFrame(v.moreHint); }
    if (!msgs.length) v.log.scrollTop = 0;
    else if (forceScroll || stick) toBottom(v);
    else v.log.scrollTop = top;
  }
  function appendMsgs(list) {
    const v = R.view;
    if (!v || !v.log || !v.log.isConnected) return;
    if (v.log.querySelector('.ag-welcome') || (v.chips && v.chips.hidden)) { paintAll(true); return; }
    const keep = new Set(R.chat.msgs.map((m) => m.id));
    MV.$$('.ag-msg', v.log).forEach((n) => { if (!keep.has(n.getAttribute('data-id'))) n.remove(); });
    list.forEach((m) => { if (m && findMsg(m.id)) v.log.appendChild(buildMsg(m)); });
    toBottom(v);
  }
  function refreshMsgs(ids) {
    const seen = new Set();
    ids.forEach((id) => { if (id && !seen.has(id)) { seen.add(id); paintMsg(id); } });
  }
  function paintMsg(id) {
    const v = R.view;
    if (!v || !v.log || !v.log.isConnected) return;
    const m = findMsg(id);
    const old = v.log.querySelector('[data-id="' + (window.CSS && window.CSS.escape ? window.CSS.escape(id) : id) + '"]');
    if (!m) { if (old) old.remove(); return; }
    if (!old) { paintAll(); return; }
    const stick = atBottom(v);
    const node = buildMsg(m);
    old.replaceWith(node);
    if (stick) toBottom(v);
  }
  function paintStatus(call) {
    const v = R.view;
    if (!v || !v.log) return;
    const node = v.log.querySelector('[data-id="' + call.msgId + '"] .ag-status');
    if (node) node.textContent = call.status ? '🔧 ' + call.status : '';
  }
  function paintHeadState() {
    const v = R.view;
    if (!v || !v.ro) return;
    v.ro.hidden = !(R.toolsOff || (R.limits !== undefined && !(R.limits && R.limits.tools)));
    if (v.tier) v.tier.hidden = !(R.tierNote && R.prefs.quick);
  }
  function updateComposer() {
    const v = R.view;
    if (!v || !v.send) return;
    const busy = !!R.active;
    v.send.classList.toggle('btn-primary', !busy);
    v.send.classList.toggle('ag-stop', busy);
    v.send.textContent = busy ? '■ 중지' : '보내기';
    v.send.setAttribute('aria-label', busy ? '답 멈추기' : '보내기');
    v.send.disabled = !busy && !v.ta.value.trim();
    v.ta.placeholder = busy ? '답을 기다리는 중 — 다음 질문을 써 둘 수 있어요' : '무엇이든 물어보세요';
    if (v.chips) MV.$$('button', v.chips).forEach((b) => { b.disabled = busy; });
    MV.$$('.ag-sugg', v.log).forEach((b) => { b.disabled = busy; });
    if (v.clear) v.clear.disabled = !R.chat.msgs.length;
    v.root.classList.toggle('ag-busy', busy);
  }
  function autosize(ta) {
    ta.style.height = 'auto';
    ta.style.height = Math.min(ta.scrollHeight + 2, 168) + 'px';
  }
  function fillComposer(t) {
    const v = R.view;
    if (!v || !v.ta) return;
    v.ta.value = t;
    R.draft = t; saveDraft();
    autosize(v.ta);
    updateComposer();
    try { v.ta.focus({ preventScroll: true }); v.ta.setSelectionRange(t.length, t.length); } catch (e) { /* 무시 */ }
  }
  function submit(text) {
    if (R.active || R.blocked) return;
    const v = R.view;
    const fromBox = text == null;
    const t = String(fromBox ? (v && v.ta ? v.ta.value : '') : text).trim();
    if (!t) return;
    if (fromBox && v && v.ta) {
      v.ta.value = '';
      R.draft = ''; saveDraft(); saveDraft.flush();
      autosize(v.ta);
    }
    send(t);
  }

  /* ---- 화면: 쓸 수 없을 때 ---- */
  function offCard(root, mode) {
    const url = MV.config && MV.config.sharedUrl ? String(MV.config.sharedUrl) : '';
    const can = [
      ['🗓', '“이번 주 할 일 정리해줘”, “지연된 일 뭐 있어?” — 체크리스트·워크플랜을 보고 정리해요'],
      ['💰', '“LG 견적 32만원 받았어, 예산에 반영해줘” — 예산을 고치고 남는 돈을 다시 계산해요'],
      ['🚚', '“이사업체 A 견적 210만원, 사다리차 포함” — 견적 비교에 넣고 모델과 비교해요'],
      ['✅', '“우리은행 질권 확인 끝났어, 체크하고 메모 남겨줘” — 체크·메모·할 일 추가'],
      ['↺', '바꾼 내용은 기록에 🤖로 남고, 답마다 한 번에 되돌릴 수 있어요'],
    ];
    let head; let body;
    if (mode === 'waiting') {
      head = 'AI 비서를 준비하는 중이에요…';
      body = el('p', { class: 'mb-0' }, 'Claude 연결을 확인하고 있어요. 잠시만 기다려 주세요.');
    } else if (mode === 'nocap') {
      head = '이 화면에서는 AI 비서를 쓸 수 없어요';
      body = el('p', { class: 'mb-0' }, 'Claude 연결이 이 보기에서 꺼져 있어요. claude.ai 에서 공유 버전을 직접 열면 쓸 수 있어요.',
        url ? [' ', el('a', { href: url, target: '_blank', rel: 'noopener noreferrer' }, '공유 버전 열기 →')] : null);
    } else {
      head = 'AI 비서는 claude.ai 공유 버전에서 쓸 수 있어요';
      body = url
        ? el('p', { class: 'mb-0' }, '이 주소(GitHub Pages)에서는 기록이 이 브라우저에만 저장되고 AI 기능은 꺼져 있어요. ',
          el('a', { class: 'btn btn-primary btn-sm ag-open', href: url, target: '_blank', rel: 'noopener noreferrer' }, '공유 버전 열기 →'))
        : el('p', { class: 'mb-0' }, '이 주소(GitHub Pages)에서는 기록이 이 브라우저에만 저장되고 AI 기능은 꺼져 있어요. 받은 claude.ai 공유 링크로 열어 주세요.');
    }
    root.appendChild(el('div', { class: 'ag-off' },
      el('div', { class: 'view-head' }, el('div', null, el('h1', '🤖 AI 비서'), el('div', { class: 'sub' }, '말로 묻고 바로 고치는 이사 관리 비서'))),
      el('section', { class: 'card tint-kid' }, el('h2', head), body),
      el('section', { class: 'card' }, el('h3', '공유 버전에서 할 수 있는 일'),
        el('ul', { class: 'ag-can' }, can.map(([i, t]) => el('li', el('span', { class: 'ag-can-i', 'aria-hidden': 'true' }, i), el('span', t))))),
      el('p', { class: 'tiny muted' }, '질문할 때마다 그 사람의 Claude 사용량을 써요. 체크리스트·예산·견적 화면은 어디서나 그대로 쓸 수 있어요.')));
  }

  /* ---- 화면: 대화 ---- */
  function chatView(root, mode, ctx) {
    const blocked = mode === 'blocked';
    const v = { root: null, mode, log: null, ta: null, send: null, chips: null, clear: null, ro: null, tier: null, stick: true };
    const quickBtn = el('button', {
      type: 'button', class: 'btn btn-sm btn-ghost ag-quick' + (R.prefs.quick ? ' ag-on' : ''), 'aria-pressed': R.prefs.quick ? 'true' : 'false',
      title: '빠른 모델로 답해요 — 간단한 체크·추가에 좋아요 (복잡한 점검은 끄는 게 좋아요)',
      onclick: () => {
        R.prefs.quick = !R.prefs.quick;
        lsSet(PREF_KEY, JSON.stringify(R.prefs));
        quickBtn.classList.toggle('ag-on', R.prefs.quick);
        quickBtn.setAttribute('aria-pressed', R.prefs.quick ? 'true' : 'false');
        paintHeadState();
        MV.ui.toast(R.prefs.quick ? (R.tierNote ? '⚡ 빠른 답변을 켰지만, 이 요금제에서는 다른 모델이 답할 수 있어요.' : '⚡ 빠른 답변을 켰어요.') : '꼼꼼한 답변으로 바꿨어요.');
      },
    }, '⚡ 빠른 답변');
    v.clear = el('button', { type: 'button', class: 'btn btn-sm btn-ghost', onclick: clearChat, disabled: !R.chat.msgs.length }, '🗑 대화 지우기');
    v.ro = el('span', { class: 'chip warn', title: '이 화면에서는 AI가 앱 데이터를 직접 바꿀 수 없어요 — 바꿀 것은 화면에서 직접 고쳐 주세요', hidden: true }, '읽기 전용');
    v.tier = el('span', { class: 'chip', title: '요금제가 빠른 모델을 지원하지 않아 다른 모델이 답해요', hidden: true }, '⚡ 이 요금제에선 빠른 답변이 안 돼요');
    const head = el('div', { class: 'ag-head' },
      el('div', { class: 'ag-title' }, el('h1', '🤖 AI 비서'), el('span', { class: 'ag-sub' }, '진척도·비용·일정을 묻고 바로 고쳐요')),
      el('div', { class: 'ag-tools' }, blocked ? null : quickBtn, v.clear),
      el('div', { class: 'ag-note' }, el('span', '⚠ 질문할 때마다 이 계정의 Claude 사용량을 써요'), v.ro, v.tier));
    v.log = el('div', { class: 'ag-log', role: 'log', 'aria-label': 'AI 비서 대화', 'aria-live': 'polite', tabindex: '0' });
    const wrap = el('div', { class: 'ag' + (blocked ? ' ag-blocked' : '') }, head, v.log);
    v.root = wrap;
    if (blocked) {
      const copy = BLOCK_COPY[R.blocked] || BLOCK_COPY.capability_disabled;
      wrap.appendChild(el('section', { class: 'card tint-warn ag-blockcard', role: 'status' }, el('h3', '🤖 ' + copy[0]), el('p', { class: 'small mb-0' }, copy[1])));
    } else {
      v.chips = el('div', { class: 'ag-chips', role: 'toolbar', 'aria-label': '추천 질문' }, SUGGESTIONS.map((s) => el('button', {
        type: 'button', class: 'ag-chip', onclick: () => submit(s.prompt()),
      }, s.icon + ' ' + (typeof s.label === 'function' ? s.label() : s.label))));
      const chips = v.chips;
      const moreHint = () => {
        const max = chips.scrollWidth - chips.clientWidth;
        chips.classList.toggle('ag-more-r', max > 4 && chips.scrollLeft < max - 4);
        chips.classList.toggle('ag-more-l', max > 4 && chips.scrollLeft > 4);
      };
      v.moreHint = moreHint;
      chips.addEventListener('scroll', moreHint, { passive: true });
      chips.addEventListener('wheel', (e) => {
        if (Math.abs(e.deltaY) <= Math.abs(e.deltaX) || chips.scrollWidth <= chips.clientWidth) return;
        chips.scrollLeft += e.deltaY;
        e.preventDefault();
      }, { passive: false });
      window.addEventListener('resize', moreHint, { passive: true });
      ctx.onCleanup(() => window.removeEventListener('resize', moreHint));
      v.ta = el('textarea', {
        class: 'ag-input', rows: '1', maxlength: String(MAX_TEXT), 'aria-label': 'AI 비서에게 보낼 메시지',
        enterkeyhint: 'send', autocomplete: 'off',
      });
      v.ta.value = R.draft || '';
      v.send = el('button', {
        type: 'button', class: 'btn btn-primary ag-send',
        onclick: () => { if (R.active) stop(); else submit(); },
      }, '보내기');
      v.ta.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && R.active && !e.isComposing) { e.preventDefault(); stop(); return; }
        if (e.key !== 'Enter' || e.shiftKey || e.altKey || e.ctrlKey || e.metaKey) return;
        if (e.isComposing || e.keyCode === 229) return;   // 한글 조합 중 Enter 는 글자 확정용
        e.preventDefault();
        if (!R.active) submit();
      });
      v.ta.addEventListener('input', () => {
        R.draft = v.ta.value;
        saveDraft();
        autosize(v.ta);
        if (!R.active) v.send.disabled = !v.ta.value.trim();
      });
      v.ta.addEventListener('focus', () => { R.composerFocused = true; });
      v.ta.addEventListener('blur', () => { setTimeout(() => { if (v.ta.isConnected) R.composerFocused = document.activeElement === v.ta; }, 0); });
      const composer = el('div', { class: 'ag-composer' }, v.ta, v.send);
      wrap.appendChild(v.chips);
      wrap.appendChild(composer);
      wrap.appendChild(el('div', { class: 'ag-hint' }, 'Enter 보내기 · Shift+Enter 줄바꿈 · Esc 중지 · 답은 확인하고 쓰세요'));
    }
    root.appendChild(wrap);
    R.view = v;
    /* 최신 메시지에 붙어 있었는지 기억 → 폰을 돌려 대화가 페이지째 스크롤되는 모양으로 바뀌어도 최신 메시지에 머묾 */
    let resizedAt = 0;
    const track = () => { if (Date.now() - resizedAt > 400 && v.log.isConnected) v.stick = atBottom(v); };
    v.log.addEventListener('scroll', track, { passive: true });
    window.addEventListener('scroll', track, { passive: true });
    const onResize = () => {
      resizedAt = Date.now();
      if (!v.stick || !R.chat.msgs.length) return;
      requestAnimationFrame(() => { if (v.log.isConnected) toBottom(v); });
      setTimeout(() => { if (v.log.isConnected && v.stick) toBottom(v); }, 250);
    };
    window.addEventListener('resize', onResize, { passive: true });
    ctx.onCleanup(() => { window.removeEventListener('scroll', track); window.removeEventListener('resize', onResize); });
    paintAll(true);
    if (!blocked) {
      updateComposer();
      autosize(v.ta);
      getLimits();
      paintHeadState();
      if (!R.active || R.composerFocused) focusComposer();
    }
    return v;
  }

  function render(root, params, ctx) {
    MV.css('ag', STYLE);
    if (syncAvailability()) MV.store.emit('caps', MV.sync && MV.sync.cap);
    const mode = viewMode();
    let alive = true;
    ctx.onCleanup(() => { alive = false; });
    const offCaps = MV.store.on('caps', () => {
      if (!alive) return;
      if (viewMode() !== mode) setTimeout(() => { if (alive && MV.route.name === 'agent' && viewMode() !== mode) MV.rerender(true); }, 0);
    });
    ctx.onCleanup(offCaps);
    let waitTimer = null;
    if (mode === 'waiting') {
      // 연결 확인이 오래 걸리면(약 12초) 다시 판단
      waitTimer = setTimeout(() => { R.capsSeen = true; if (alive && MV.route.name === 'agent') MV.rerender(true); }, 12000);
      ctx.onCleanup(() => clearTimeout(waitTimer));
    }
    ctx.onCleanup(() => {
      if (R.view && R.view.root && !R.view.root.isConnected) R.view = null;
      else if (R.view && R.view.root && root.contains(R.view.root)) R.view = null;
    });
    try {
      if (mode === 'chat' || mode === 'blocked') chatView(root, mode, ctx);
      else offCard(root, mode);
    } catch (e) {
      console.error('[agent]', e);
      root.replaceChildren(el('div', { class: 'card tint-bad' }, el('h2', 'AI 비서 화면을 여는 중 문제가 생겼어요'), el('p', { class: 'small' }, String((e && e.message) || e)),
        el('button', { type: 'button', class: 'btn', onclick: () => MV.rerender() }, '다시 시도')));
    }
    updateFab();
  }

  /* ======================= 스타일 ======================= */
  const STYLE = `
.view[data-view="agent"] { padding-bottom: 16px; }
.ag { --ag-h: calc(100vh - var(--topbar-h) - 36px); height: var(--ag-h); min-height: 460px; max-width: 960px; margin: 0 auto; display: flex; flex-direction: column; gap: 10px; min-width: 0; }
@supports (height: 100dvh) { .ag { --ag-h: calc(100dvh - var(--topbar-h) - 36px); } }
.ag-head { display: flex; align-items: center; gap: 4px 10px; flex-wrap: wrap; flex: none; }
.ag-title { display: flex; align-items: baseline; gap: 4px 12px; flex-wrap: wrap; min-width: 0; flex: 1 1 auto; }
.ag-title h1 { margin: 0; font-size: 1.45rem; white-space: nowrap; }
.ag-sub { color: var(--ink-3); font-size: .88rem; }
.ag-tools { display: flex; gap: 4px; flex: none; margin-left: auto; }
.ag-tools .btn { min-height: 36px; }
.ag-quick.ag-on { background: var(--think-bg); color: var(--think); border-color: color-mix(in srgb, var(--think) 30%, transparent); }
.ag-note { flex-basis: 100%; display: flex; align-items: center; gap: 8px; flex-wrap: wrap; font-size: .76rem; color: var(--ink-3); }
.ag-log { flex: 1 1 auto; min-height: 0; overflow-y: auto; overscroll-behavior: contain; -webkit-overflow-scrolling: touch;
  display: flex; flex-direction: column; gap: 14px; padding: 16px; background: var(--bg-2); border: 1px solid var(--line); border-radius: var(--radius); }
.ag-log:focus-visible { outline-offset: -3px; }
.ag-msg { display: flex; flex-direction: column; gap: 4px; max-width: min(780px, 92%); min-width: 0; }
.ag-user { align-self: flex-end; align-items: flex-end; }
.ag-bot { align-self: flex-start; align-items: stretch; }
.ag-bubble { padding: 10px 14px; border-radius: 18px; line-height: 1.62; font-size: .95rem; min-width: 0; overflow-wrap: anywhere; }
.ag-user .ag-bubble { background: var(--brand-bg); color: var(--ink); border: 1px solid color-mix(in srgb, var(--brand) 22%, var(--line)); border-bottom-right-radius: 6px; white-space: pre-wrap; }
.ag-bot .ag-bubble { background: var(--bg); color: var(--ink); border: 1px solid var(--line); border-bottom-left-radius: 6px; }
.ag-meta { display: flex; gap: 4px; flex-wrap: wrap; padding: 0 8px; font-size: .72rem; color: var(--ink-3); }
.ag-md > :first-child { margin-top: 0; }
.ag-md > :last-child { margin-bottom: 0; }
.ag-md p { margin: 0 0 .6em; }
.ag-md .ag-h { font-weight: 800; margin: .9em 0 .35em; line-height: 1.35; }
.ag-md .ag-h1 { font-size: 1.08rem; }
.ag-md .ag-h2 { font-size: 1.02rem; }
.ag-md .ag-h3 { font-size: .96rem; color: var(--ink-2); }
.ag-md .ag-list { margin: 0 0 .6em; padding-left: 1.35em; }
.ag-md .ag-list .ag-list { margin: .2em 0 .1em; }
.ag-md li + li { margin-top: .2em; }
.ag-md li::marker { color: var(--ink-3); }
.ag-md strong { font-weight: 800; }
.ag-md code { font-size: .86em; }
.ag-md a { word-break: break-all; }
.ag-md a.ag-in, .ag-changes a.ag-in { font-weight: 700; text-decoration: none; border-bottom: 1px solid color-mix(in srgb, var(--brand) 40%, transparent); word-break: keep-all; }
.ag-md a.ag-in:hover, .ag-changes a.ag-in:hover { border-bottom-color: var(--brand); }
.ag-pre { margin: 0 0 .6em; padding: 8px 10px; background: var(--bg-3); border-radius: 8px; overflow-x: auto; font-size: .82rem; line-height: 1.5; }
.ag-pre code { background: none; padding: 0; white-space: pre; }
.ag-quote { margin: 0 0 .6em; padding: 2px 0 2px 12px; border-left: 3px solid var(--line-2); color: var(--ink-2); }
.ag-hr { border: 0; border-top: 1px solid var(--line); margin: .8em 0; }
.ag-table { margin: 0 0 .6em; border: 1px solid var(--line); border-radius: 10px; background: var(--bg-2); }
.ag-table table.tbl { font-size: .84rem; width: auto; min-width: 100%; }
.ag-table table.tbl th, .ag-table table.tbl td { padding: 6px 9px; overflow-wrap: normal; word-break: keep-all; }
.ag-table table.tbl td:first-child { min-width: 4.5em; }
.ag-thinking { display: inline-flex; align-items: center; gap: 8px; color: var(--ink-3); font-size: .92rem; }
.ag-dots { display: inline-flex; gap: 3px; }
.ag-dots i { width: 6px; height: 6px; border-radius: 50%; background: var(--ink-3); animation: ag-blink 1.2s infinite ease-in-out both; }
.ag-dots i:nth-child(2) { animation-delay: .15s; }
.ag-dots i:nth-child(3) { animation-delay: .3s; }
@keyframes ag-blink { 0%, 80%, 100% { opacity: .25; transform: scale(.8); } 40% { opacity: 1; transform: scale(1); } }
.ag-status { font-size: .8rem; color: var(--think); padding: 0 8px; min-height: 1.2em; }
.ag-status:empty { display: none; }
.ag-alert { border-left: 3px solid var(--warn); background: var(--warn-bg); border-radius: 0 12px 12px 0; padding: 8px 12px; font-size: .88rem; color: var(--ink); }
.ag-alert.ag-bad { border-left-color: var(--bad); background: var(--bad-bg); }
.ag-alert.ag-soft { border-left-color: var(--line-2); background: var(--bg-3); color: var(--ink-2); font-size: .82rem; padding: 6px 12px; }
.ag-acts { margin-top: 8px; }
.ag-acts .btn { min-height: 36px; }
.ag-changes { border: 1px solid color-mix(in srgb, var(--good) 35%, var(--line)); background: var(--good-bg); border-radius: 14px; padding: 9px 12px; font-size: .86rem; }
.ag-changes-h { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; font-weight: 800; color: var(--good); }
.ag-changes ul { margin: 4px 0 0; padding-left: 1.2em; color: var(--ink); }
.ag-changes li + li { margin-top: 2px; }
.ag-changes .ag-undo { margin-top: 8px; min-height: 36px; }
.ag-undo-note { display: flex; align-items: center; gap: 4px 10px; flex-wrap: wrap; margin-top: 6px; }
.ag-undo-note .ag-undo { margin-top: 0; }
.ag-welcome { display: flex; flex-direction: column; align-items: center; text-align: center; gap: 8px; padding: 8px 4px; margin: auto 0; }
.ag-welcome h2 { margin: 0; }
.ag-welcome > p { max-width: 560px; margin: 0; }
.ag-hello { font-size: 2.4rem; line-height: 1; }
.ag-grid { width: 100%; max-width: 760px; display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 8px; margin-top: 6px; }
.ag-sugg { display: flex; align-items: center; gap: 10px; min-height: 48px; padding: 8px 14px; text-align: left; border: 1px solid var(--line-2); border-radius: 14px; background: var(--bg); color: var(--ink); font: inherit; font-weight: 700; font-size: .92rem; cursor: pointer; transition: border-color .12s, background .12s; }
.ag-sugg:hover:not(:disabled) { border-color: var(--brand); background: var(--brand-bg); }
.ag-sugg:disabled, .ag-chip:disabled { opacity: .5; cursor: not-allowed; }
.ag-sugg-i { font-size: 1.2rem; }
.ag-ex { width: 100%; max-width: 760px; margin-top: 8px; display: flex; flex-direction: column; gap: 6px; align-items: center; }
.ag-ex-list { display: flex; flex-wrap: wrap; gap: 6px; justify-content: center; }
.ag-ex-btn { min-height: 36px; padding: 4px 12px; border: 1px dashed var(--line-2); border-radius: 999px; background: transparent; color: var(--ink-2); font: inherit; font-size: .82rem; cursor: pointer; text-align: left; }
.ag-ex-btn:hover { border-color: var(--brand); color: var(--brand); }
.ag-chips { flex: none; display: flex; gap: 6px; overflow-x: auto; scrollbar-width: none; padding: 1px; -webkit-overflow-scrolling: touch; }
.ag-chips::-webkit-scrollbar { display: none; }
.ag-chips.ag-more-r { -webkit-mask-image: linear-gradient(to right, #000 calc(100% - 40px), transparent); mask-image: linear-gradient(to right, #000 calc(100% - 40px), transparent); }
.ag-chips.ag-more-l { -webkit-mask-image: linear-gradient(to right, transparent, #000 40px); mask-image: linear-gradient(to right, transparent, #000 40px); }
.ag-chips.ag-more-l.ag-more-r { -webkit-mask-image: linear-gradient(to right, transparent, #000 40px, #000 calc(100% - 40px), transparent); mask-image: linear-gradient(to right, transparent, #000 40px, #000 calc(100% - 40px), transparent); }
body:has(.ag-composer) .toast-wrap { bottom: calc(var(--bottom-h) + 104px + env(safe-area-inset-bottom)); }
.ag-chip { flex: none; min-height: 36px; padding: 0 12px; border: 1px solid var(--line-2); border-radius: 999px; background: var(--bg-2); color: var(--ink-2); font: inherit; font-size: .82rem; font-weight: 700; white-space: nowrap; cursor: pointer; }
.ag-chip:hover:not(:disabled) { border-color: var(--brand); color: var(--brand); }
.ag-composer { flex: none; position: sticky; bottom: calc(var(--bottom-h) + 8px + env(safe-area-inset-bottom)); z-index: 5; display: flex; align-items: flex-end; gap: 8px; padding: 6px 6px 6px 14px; border: 1px solid var(--line-2); border-radius: 18px; background: var(--bg-2); box-shadow: var(--shadow); }
.ag-composer:focus-within { border-color: var(--brand); box-shadow: 0 0 0 3px color-mix(in srgb, var(--brand) 18%, transparent); }
.ag-input { flex: 1 1 auto; min-width: 0; min-height: 42px; max-height: 168px; padding: 9px 0; border: 0; outline: none; resize: none; background: transparent; color: var(--ink); font: inherit; font-size: 1rem; line-height: 1.5; }
.ag-input::placeholder { color: var(--ink-3); }
.ag-send { flex: none; min-height: 42px; min-width: 76px; border-radius: 13px; }
.ag-send.ag-stop { background: var(--bad); border-color: var(--bad); color: var(--on-bad); }
.ag-hint { flex: none; margin-top: -6px; text-align: right; font-size: .72rem; color: var(--ink-3); }
.ag-blockcard { flex: none; margin: 0; }
.ag-blockcard h3 { margin-bottom: 4px; }
.ag-off { max-width: 760px; margin: 0 auto; }
.ag-off .card h2 { font-size: 1.15rem; }
.ag-open { margin-left: 4px; vertical-align: middle; }
.ag-can { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
.ag-can li { display: flex; gap: 10px; align-items: flex-start; }
.ag-can-i { flex: none; width: 1.6em; text-align: center; }
.ag-fab { position: fixed; right: 22px; bottom: calc(var(--bottom-h) + 22px + env(safe-area-inset-bottom)); z-index: 45; width: 56px; height: 56px; border-radius: 50%; border: 0; padding: 0; display: grid; place-items: center; background: var(--brand); color: var(--on-brand); font-size: 1.6rem; line-height: 1; box-shadow: var(--shadow-lg); cursor: pointer; transition: transform .12s, background .12s, bottom .18s ease-out; -webkit-tap-highlight-color: transparent; }
body.ag-fab-pad #view::after { content: ''; display: block; height: 76px; }
.ag-fab:hover { background: var(--brand-2); transform: translateY(-1px); }
.ag-fab:focus-visible { outline: 3px solid color-mix(in srgb, var(--brand) 55%, transparent); outline-offset: 3px; }
.ag-fab-dot { position: absolute; top: 3px; right: 3px; width: 13px; height: 13px; border-radius: 50%; background: var(--good); border: 2px solid var(--bg-2); display: none; }
.ag-fab.ag-busy .ag-fab-dot { display: block; animation: ag-pulse 1.4s infinite ease-in-out; }
@keyframes ag-pulse { 0%, 100% { transform: scale(1); opacity: 1; } 50% { transform: scale(.7); opacity: .6; } }
@media (hover: none) { .ag-hint { display: none; } }
@media (max-width: 860px) {
  .view[data-view="agent"] { padding-bottom: calc(var(--bottom-h) + 8px + env(safe-area-inset-bottom)); }
  .ag { --ag-h: calc(100vh - var(--topbar-h) - 22px - var(--bottom-h) - env(safe-area-inset-bottom)); }
  @supports (height: 100dvh) { .ag { --ag-h: calc(100dvh - var(--topbar-h) - 22px - var(--bottom-h) - env(safe-area-inset-bottom)); } }
  .ag-fab { right: 16px; bottom: calc(var(--bottom-h) + 16px + env(safe-area-inset-bottom)); width: 52px; height: 52px; font-size: 1.45rem; }
}
@media (max-width: 640px) {
  .ag { gap: 8px; min-height: 420px; }
  .ag-title h1 { font-size: 1.2rem; }
  .ag-sub { display: none; }
  .ag-log { padding: 12px 10px; gap: 12px; border-radius: 14px; }
  .ag-msg { max-width: 94%; }
  .ag-bot { max-width: 100%; }
  .ag-bubble { padding: 9px 12px; font-size: .93rem; }
  .ag-grid { grid-template-columns: 1fr 1fr; }
  .ag-sugg { padding: 8px 10px; gap: 6px; font-size: .86rem; min-height: 52px; }
  .ag-composer { padding-left: 12px; }
  .ag-send { min-width: 64px; padding: 0 12px; }
}
@media (max-height: 560px) and (max-width: 1100px) {
  .ag { height: auto; min-height: 0; }
  .ag-log { flex: none; overflow: visible; min-height: 180px; }
  .ag-sub, .ag-hint { display: none; }
}
@media (max-width: 380px) { .ag-quick { padding: 0 6px; } .ag-sugg { font-size: .82rem; padding: 6px 8px; } }
@media print { .ag-fab, .ag-composer, .ag-chips, .ag-hint { display: none !important; } .ag { height: auto; } .ag-log { overflow: visible; border: 0; } }
`;

  /* ======================= 등록 ======================= */
  MV.view('agent', {
    title: 'AI 비서', short: '비서', icon: '🤖', order: 15, nav: false,
    render,
  });
  if (sampleFn()) syncAvailability();

  // 테스트·디버깅용 (화면에는 영향 없음)
  MV.agent = { _debug: { md, overview, instruction, tools: () => TOOLS.map((t) => t.name), state: R, buildInput } };
})();
