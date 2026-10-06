/* ============================================================
   우리집 이사 관리 — 공간설계 (view: plan)
   두 집 도면(MV.plans.old / MV.plans.new) 위에 짐 목록(MV.inv)의 가구·가전을
   끌어다 놓아 보며 "어디에 들어가나 / 무엇을 버리고 무엇을 살까"를 정합니다.

   라우트   #/plan → #/plan/new · #/plan/old · #/plan/compare
   상태     layouts   = { old: { placements: [] }, new: { placements: [] } }
                        placement = { id, invId, x, y, rot }  (cm, 회전 반영 외곽의 좌상단, rot 0|90)
            planEdits = { old: PlanEdit, new: PlanEdit }   (MV.plans 는 절대 수정하지 않음)
                        PlanEdit = {
                          rooms:   { <roomId>: {x,y,w,h,name,kind?} }   원래 방 치수·이름·종류 덮어쓰기 (예전 자료 그대로 호환)
                          added:   [{ id, name, kind, x, y, w, h }]     직접 그린 방
                          deleted: [roomId]                             지운 원래 방 (그 방에만 붙은 문·창·고정물도 숨김)
                          size:    { width, depth } | 없음              전체 크기 (외곽·치수선·화면 맞춤이 따라감)
                          doorsAdded:   [{ id, x, y, width, orientation, swing, hinge, room }]   room 을 지우면 숨김 (그린 방이면 함께 지움 · 되돌리기 가능)
                          doorsDeleted: ['x,y,o']                       지운 원래 문 (x·y·방향으로 만든 고정 키)
                        }
                        병합 도면 = 원래 − 지운 방 + 그린 방 + 덮어쓰기 + 전체 크기 (점검·자동 배치·비교·면적 모두 이것을 씀)
            planBg    = { old: Bg|null, new: Bg|null }   평면도 사진 (백업 파일에 함께 들어감)
                        Bg = { src: 'data:image/jpeg;base64,…'(긴 변 1600px 이하), natW, natH (px),
                               cmPerPx, x, y (cm, 회전 반영 외곽의 좌상단), opacity 0.15–1, rot 0|90|180|270,
                               show, fade (도면 칸 흐리게), calibrated, aligned (축척 뒤 위치까지 맞췄는지 — false 면 '위치 맞추기' 안내) }
            ui.plan   = { grid, snap, zoom:{new,old}, filter, infoOpen, laundryRoom, bgPanel }
   조작     끌기(마우스·터치·펜, 도면 밖으로는 못 나감 · 가장자리에서 자동 스크롤) · 두 손가락 확대/축소(도면만)
            키보드 단축키는 도면에 초점이 있거나 마우스가 도면 위에 있을 때만 (방향키·R·Delete·Esc)
            ✏️ 치수 수정 도구: 방 고치기(누르기) · 방 그리기(끌기) · 문 추가(벽 누르기) · 문 삭제(문 누르기) · 전체 크기
            🖼 평면도 사진: 고르기 → 📏 축척 맞추기(두 점 + 실제 길이 → 왼쪽 위 모서리) · ✋ 위치 옮기기 · 돌리기 · 진하기
   제공     MV.calc.planSummary() → { new:{placed,needed,bad,warn}, old:{...}, closet:{...} }
   ============================================================ */
(function () {
  'use strict';
  const { el, svg } = MV;

  /* ---------------- 상수 ---------------- */
  const KEYS = ['new', 'old'];
  const WALL = 11;      // 벽 두께 (cm, 그림용)
  const MARGIN = 72;    // viewBox 여백 (치수·방위·축척 표시용)
  const GRID = 50;      // 격자 간격 (cm)
  const SNAP = 5;       // 끌기 스냅 (cm)
  const PASS_D = 50;    // 트인 곳(문 없는 통로) 양쪽으로 살피는 깊이 (cm)
  const PASS_MIN = 60;  // 배치 점검: 트인 곳에 남아야 할 최소 통로 폭 (cm)
  const PASS_KEEP = 80; // 자동 배치·놓기: 트인 곳에 남겨 둘 통로 폭 (cm)
  const DOOR_FRONT = 45; // 문이 열리지 않는 쪽 문 앞 (드나드는 자리) 깊이 (cm)
  const FATES_FOR = { new: ['move', 'buy', 'undecided'], old: ['move', 'discard', 'sell', 'undecided'] };
  const CAT_COLOR = {
    appliance: 'var(--kid)', aircon: 'var(--think)', bed: 'var(--brand)', storage: 'var(--warn)',
    table: 'var(--good)', sofa: 'var(--brand)', shelf: 'var(--warn)', electronics: 'var(--think)',
    kids: 'var(--good)', misc: 'var(--ink-3)',
  };
  const TABS = [['new', '새 집 배치'], ['old', '지금 집'], ['compare', '두 집 비교']];
  const PLAN_LABEL = { new: '새 집', old: '지금 집' };
  const KIND_WORDS = [
    ['다용도', 'utility'], ['세탁', 'utility'], ['보일러', 'utility'], ['주방', 'kitchen'], ['부엌', 'kitchen'],
    ['식당', 'kitchen'], ['거실', 'living'], ['현관', 'entrance'], ['욕실', 'bath'], ['화장실', 'bath'],
    ['발코니', 'balcony'], ['베란다', 'balcony'], ['드레스', 'dressroom'], ['파우더', 'dressroom'],
    ['창고', 'storage'], ['팬트리', 'storage'], ['복도', 'hall'], ['안방', 'bedroom'], ['침실', 'bedroom'], ['방', 'bedroom'],
  ];
  /** 방 종류 (방 고치기·그리기 창의 '종류' 고르기) */
  const ROOM_KINDS = [['living', '거실'], ['kitchen', '주방'], ['bedroom', '방'], ['bath', '욕실'], ['entrance', '현관'], ['hall', '복도'],
    ['balcony', '발코니'], ['utility', '다용도실'], ['dressroom', '드레스룸'], ['storage', '창고'], ['other', '기타']];
  const kindLabel = (k) => { const f = ROOM_KINDS.find(([id]) => id === k); return f ? f[1] : '기타'; };
  const NEW_DOOR_W = 90;     // 문 추가: 기본 문 폭 (cm)
  const MIN_ROOM = 30;       // 방 그리기: 가장 작은 변 (cm)
  const BG_MAX_SIDE = 1600;  // 평면도 사진: 긴 변 최대 (px)
  const BG_QUALITY = 0.82;   // JPEG 품질
  const BG_WARN_BYTES = 900 * 1024;  // 이보다 크면 잘라서(크롭) 올리라고 알림
  const STATE_KEY = 'mv:state:v1';   // core.js 저장 키 — 사진을 넣기 전에 저장 공간이 되는지 미리 써 봄
  const CLOSET_EXCLUDE = /신발|현관|주방|싱크|욕실|선반|팬트리|창고|수납장/;
  const EXPORT_PROPS = ['fill', 'fill-opacity', 'stroke', 'stroke-width', 'stroke-opacity', 'stroke-dasharray',
    'stroke-linejoin', 'stroke-linecap', 'opacity', 'font-family', 'font-size', 'font-weight', 'text-anchor',
    'dominant-baseline', 'paint-order'];

  /* ---------------- 작은 유틸 ---------------- */
  const num = (v, d) => { const n = parseFloat(v); return isFinite(n) ? n : d; };
  const r1 = (n) => Math.round(n * 10) / 10;
  const r2 = (n) => Math.round(n * 100) / 100;
  const area = (r) => (r.w * r.h) / 10000;
  const fmtA = (m2) => (Math.round(m2 * 10) / 10).toFixed(1) + '㎡';
  const fmtD = (m2) => { const v = Math.round(m2 * 10) / 10; return (v > 0 ? '+' : v < 0 ? '−' : '±') + Math.abs(v).toFixed(1) + '㎡'; };
  const norm = (s) => String(s || '').toLowerCase().replace(/[\s·.,()[\]\-_/~]/g, '');
  const shortName = (s, n) => { const a = Array.from(String(s || '')); n = n || 16; return a.length > n ? a.slice(0, n - 1).join('') + '…' : a.join(''); };
  const qtyOf = (it) => Math.max(0, Math.round(num(it && it.qty, 1)));
  const fateOf = (it) => (MV.inv.FATES.some((f) => f.id === (it && it.fate)) ? it.fate : 'undecided');
  const eligible = (key, it) => !!it && FATES_FOR[key].includes(fateOf(it));
  const roomField = (key) => (key === 'new' ? 'roomNew' : 'room');
  const wallMounted = (it) => !!it && it.cat === 'aircon' && it.ac === 'wall';
  const nameNote = (it) => String((it && it.name) || '') + ' ' + String((it && it.note) || '');
  const txtOf = (x) => {
    if (x == null) return '';
    if (typeof x !== 'object') return String(x);
    return String(x.label || x.title || x.text || x.name || x.what || Object.values(x).filter((v) => typeof v !== 'object').join(' · '));
  };
  /** 받침 유무로 조사 고르기: jo('침대', '과', '와') → '와' */
  // 숫자로 끝나면 읽는 소리로 받침 판단 (영·일·삼·육·칠·팔 = 받침 있음, 일·칠·팔 = ㄹ 받침)
  const DIGIT_JONG = { 0: 21, 1: 8, 2: 0, 3: 16, 4: 0, 5: 0, 6: 1, 7: 8, 8: 8, 9: 0 };
  function jong(word) {
    const a = Array.from(String(word || '').replace(/[\s)\]」』"'…]+$/, ''));
    const ch = a.length ? a[a.length - 1] : '';
    const c = ch ? ch.codePointAt(0) : 0;
    if (c >= 0xac00 && c <= 0xd7a3) return (c - 0xac00) % 28;
    if (/[0-9]/.test(ch)) return DIGIT_JONG[ch];
    return -1;
  }
  function jo(word, withBatchim, without) {
    const j = jong(word);
    if (j >= 0) return j ? withBatchim : without;
    return withBatchim + '(' + without + ')';
  }
  /** '(으)로': 받침이 있으면 '으로' (단, ㄹ 받침은 '로') */
  function joRo(word) {
    const j = jong(word);
    if (j >= 0) return j && j !== 8 ? '으로' : '로';
    return '(으)로';
  }
  const q = (it) => '「' + shortName(it.name, 14) + '」';
  /** null/false 를 건너뛰는 append (Element.append 는 null 을 "null" 글자로 넣음) */
  const put = (node, ...kids) => { kids.flat(Infinity).forEach((k) => { if (k !== null && k !== undefined && k !== false) node.append(k); }); return node; };

  /** 대략적인 글자 폭 (em 단위 × 글자 크기) */
  function textW(s, fs) {
    let w = 0;
    for (const ch of String(s)) {
      const c = ch.codePointAt(0);
      if ((c >= 0x1100 && c <= 0x11ff) || (c >= 0x2e80 && c <= 0x9fff) || (c >= 0xac00 && c <= 0xd7af) || (c >= 0xf900 && c <= 0xfaff) || (c >= 0xff00 && c <= 0xffef)) w += 1;
      else if (c > 0x2000) w += 1.1;
      else if (ch === ' ') w += 0.3;
      else if (/[A-Z0-9%]/.test(ch)) w += 0.62;
      else w += 0.52;
    }
    return w * fs;
  }
  /** maxW 안에 들어가도록 글자 크기를 줄이고, 그래도 넘치면 말줄임 */
  function fitText(str, maxW, fs, minFs) {
    str = String(str || '');
    if (!str || maxW <= 0) return null;
    let w = textW(str, fs);
    if (w > maxW) { fs = Math.max(minFs, (fs * maxW) / w); w = textW(str, fs); }
    if (w > maxW) {
      const a = Array.from(str);
      while (a.length && textW(a.join('') + '…', fs) > maxW) a.pop();
      if (!a.length) return null;
      str = a.join('') + '…';
      w = textW(str, fs);
    }
    return { text: str, fs, w };
  }

  /* ---------------- 기하 ---------------- */
  function inter(a, b) {
    const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
    const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
    return w > 0 && h > 0 ? { w, h } : null;
  }
  function hit(a, b, tol) { const i = inter(a, b); tol = tol == null ? 1 : tol; return !!i && i.w > tol && i.h > tol; }
  function within(a, b, tol) {
    tol = tol == null ? 1 : tol;
    return a.x >= b.x - tol && a.y >= b.y - tol && a.x + a.w <= b.x + b.w + tol && a.y + a.h <= b.y + b.h + tol;
  }
  const hasPt = (r, x, y) => x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;
  const fxRect = (f) => ({ x: num(f.x, 0), y: num(f.y, 0), w: Math.max(0, num(f.w, 0)), h: Math.max(0, num(f.h, 0)) });
  /** 한 축에서 길이 size 인 것을 [lo, lo+span] 안으로 (더 크면 가운데 정렬) */
  const clampAxis = (v, size, lo, span) => (size <= span ? MV.clamp(v, lo, lo + span - size) : lo + (span - size) / 2);
  /** 사각형 r(x,y,w,h)을 region 안으로 밀어 넣은 좌상단 {x,y} */
  const clampInto = (r, region) => ({ x: clampAxis(r.x, r.w, region.x, region.w), y: clampAxis(r.y, r.h, region.y, region.h) });
  const fitsIn = (f, region) => f.w <= region.w + 0.5 && f.h <= region.h + 0.5;

  /** 문: 개구부(gap) · 문짝이 쓸고 가는 영역(swing) · 경첩/닫힌 끝/열린 끝 좌표 */
  function doorGeom(d) {
    const w = Math.max(10, num(d.width, 80));
    const x = num(d.x, 0), y = num(d.y, 0);
    if (d.orientation === 'v') {
      const dir = d.swing === 'left' ? -1 : 1;
      const hy = d.hinge === 'end' ? y + w : y, fy = d.hinge === 'end' ? y : y + w;
      return { w, gap: { x: x - WALL / 2 - 1, y, w: WALL + 2, h: w }, swing: { x: dir < 0 ? x - w : x, y, w, h: w },
        front: { x: dir < 0 ? x : x - DOOR_FRONT, y, w: DOOR_FRONT, h: w },
        hinge: [x, hy], free: [x, fy], open: [x + dir * w, hy] };
    }
    const dir = d.swing === 'up' ? -1 : 1;
    const hx = d.hinge === 'end' ? x + w : x, fx = d.hinge === 'end' ? x : x + w;
    return { w, gap: { x, y: y - WALL / 2 - 1, w, h: WALL + 2 }, swing: { x, y: dir < 0 ? y - w : y, w, h: w },
      front: { x, y: dir < 0 ? y : y - DOOR_FRONT, w, h: DOOR_FRONT },
      hinge: [hx, y], free: [fx, y], open: [hx, y + dir * w] };
  }
  /** 트인 곳(문짝 없는 통로): 통로 선(lo..hi) · 양쪽으로 PASS_D 만큼의 살필 영역(zone) */
  function openingGeom(op) {
    const L = Math.max(0, num(op.width, 0)), x = num(op.x, 0), y = num(op.y, 0);
    const v = op.orientation === 'v';
    return { op, L, v, x, y, lo: v ? y : x, hi: (v ? y : x) + L,
      zone: v ? { x: x - PASS_D, y, w: PASS_D * 2, h: L } : { x, y: y - PASS_D, w: L, h: PASS_D * 2 } };
  }
  /** 트인 곳에서 막히지 않고 남은 가장 넓은 폭 (cm). rects = 장애물 사각형 */
  function openingFree(g, rects) {
    const iv = [];
    rects.forEach((r) => {
      if (!r || !hit(r, g.zone, 0.5)) return;
      const a = Math.max(g.lo, g.v ? r.y : r.x), b = Math.min(g.hi, g.v ? r.y + r.h : r.x + r.w);
      if (b > a) iv.push([a, b]);
    });
    iv.sort((p, q2) => p[0] - q2[0]);
    let best = 0, at = g.lo;
    iv.forEach(([a, b]) => { if (a > at) best = Math.max(best, a - at); at = Math.max(at, b); });
    return Math.max(best, g.hi - at);
  }
  /** 방(region) 가장자리 중 문·트인 곳으로 뚫린 구간 { T, B, L, R: [[a,b]...] } — 그곳은 '벽'이 아님 */
  function edgeGaps(plan, region) {
    const g = { T: [], B: [], L: [], R: [] };
    const add = (o, L) => {
      if (!(L > 0)) return;
      const x = num(o.x, 0), y = num(o.y, 0);
      if (o.orientation === 'v') {
        if (Math.abs(x - region.x) < 3) g.L.push([y, y + L]);
        if (Math.abs(x - region.x - region.w) < 3) g.R.push([y, y + L]);
      } else {
        if (Math.abs(y - region.y) < 3) g.T.push([x, x + L]);
        if (Math.abs(y - region.y - region.h) < 3) g.B.push([x, x + L]);
      }
    };
    plan.openings.forEach((o) => add(o, num(o.width, 0)));
    plan.doors.forEach((d) => add(d, Math.max(10, num(d.width, 80))));
    return g;
  }
  /** a..b 구간 중 실제 벽(문·트인 곳이 아닌 곳)의 비율 */
  function wallFrac(gaps, a, b) {
    if (!(b > a)) return 0;
    let cov = 0;
    gaps.forEach(([s0, e0]) => { cov += Math.max(0, Math.min(b, e0) - Math.max(a, s0)); });
    return Math.max(0, 1 - cov / (b - a));
  }
  /** 문이 차지하는 자리 (열림 범위 + 벽 틈) — 문 삭제 도구에서 누르는 칸 */
  function doorBox(d) {
    const g = doorGeom(d);
    const x0 = Math.min(g.swing.x, g.gap.x), y0 = Math.min(g.swing.y, g.gap.y);
    return { x: x0, y: y0, w: Math.max(g.swing.x + g.swing.w, g.gap.x + g.gap.w) - x0, h: Math.max(g.swing.y + g.swing.h, g.gap.y + g.gap.h) - y0 };
  }
  const DOOR_TAP = 44;   // 문 삭제: 누르는 칸의 최소 크기 (화면 px)
  /** 누르는 칸: 문 자리를 가운데 두고 가로·세로 minS(cm) 이상으로 넓힘 */
  function doorPad(d, minS) {
    const b = doorBox(d);
    const w = Math.max(b.w, minS), h = Math.max(b.h, minS);
    return { x: b.x + b.w / 2 - w / 2, y: b.y + b.h / 2 - h / 2, w, h };
  }
  /** (x,y)를 누르면 지울 문: 누르는 칸에 든 문 중 실제 문 자리에서 가장 가까운 것 (같으면 가운데가 더 가까운 것) */
  function doorAtPt(plan, x, y, minS) {
    let best = null;
    plan.doors.forEach((d) => {
      if (!hasPt(doorPad(d, minS), x, y)) return;
      const b = doorBox(d);
      const dist = Math.hypot(Math.max(b.x - x, 0, x - b.x - b.w), Math.max(b.y - y, 0, y - b.y - b.h));
      const cd = Math.hypot(b.x + b.w / 2 - x, b.y + b.h / 2 - y);
      if (!best || dist < best.dist - 0.01 || (Math.abs(dist - best.dist) <= 0.01 && cd < best.cd)) best = { d, dist, cd };
    });
    return best ? best.d : null;
  }
  /** 문이 열리는 쪽을 반대로 (경첩 자리는 그대로) */
  const flipSwing = (d) => (d.orientation === 'v' ? (d.swing === 'left' ? 'right' : 'left') : (d.swing === 'up' ? 'down' : 'up'));
  /**
   * 방을 옮기거나 크기를 바꾸면 그 방에 직접 단 문(doorsAdded, room = 방 id)도 같은 벽을 따라 옮김 (st 안에서 호출).
   * from·to = 바꾸기 전·후 방 {x,y,w,h}. 벽 위의 자리(벽 시작에서 떨어진 거리)는 그대로, 벽이 짧아지면 안으로 당기고 문 폭도 줄임 → 옮긴 문 개수
   */
  function moveRoomDoors(E, rid, from, to) {
    let n = 0;
    E.doorsAdded.forEach((d) => {
      if (!d || typeof d !== 'object' || String(d.room) !== String(rid)) return;
      const v = d.orientation === 'v';
      const x = num(d.x, 0), y = num(d.y, 0), w0 = Math.max(10, num(d.width, NEW_DOOR_W));
      let side = '';
      if (v) side = Math.abs(x - from.x) < 3 ? 'L' : Math.abs(x - from.x - from.w) < 3 ? 'R' : '';
      else side = Math.abs(y - from.y) < 3 ? 'T' : Math.abs(y - from.y - from.h) < 3 ? 'B' : '';
      if (!side) return;   // 이 방 벽 위에 있지 않던 문은 건드리지 않음
      const len = v ? to.h : to.w, start = v ? to.y : to.x;
      const w = w0 > len - 10 && len >= 50 ? Math.max(40, Math.floor((len - 10) / SNAP) * SNAP) : w0;
      const at = r1(MV.clamp(start + (v ? y - from.y : x - from.x), start, Math.max(start, start + len - w)));
      const nx = v ? r1(side === 'L' ? to.x : to.x + to.w) : at;
      const ny = v ? at : r1(side === 'T' ? to.y : to.y + to.h);
      if (Math.abs(nx - x) > 0.05 || Math.abs(ny - y) > 0.05 || w !== w0) { d.x = nx; d.y = ny; d.width = w; n++; }
    });
    return n;
  }
  /**
   * 이 화면에서 연 창(방·크기·확인·짐 편집)을 기억했다가 화면을 떠나면(뒤로 가기·다른 메뉴) 함께 닫음
   * → 다른 화면 위에 창이 남아 엉뚱한 도면을 고치지 않게. 닫을 땐 창의 ✕ 를 눌러 확인 창은 '취소'로 끝남
   */
  function modalTracker(ctx) {
    const mine = new Set();
    const track = (open) => {
      const before = new Set(document.querySelectorAll('.modal-back'));
      const ret = open();
      mine.forEach((b) => { if (!b.isConnected) mine.delete(b); });
      document.querySelectorAll('.modal-back').forEach((b) => { if (!before.has(b)) mine.add(b); });
      return ret;
    };
    ctx.onCleanup(() => {
      mine.forEach((b) => {
        if (!b.isConnected) return;
        const x = b.querySelector('.modal-head button');
        try { if (x) x.click(); else b.remove(); } catch (e) { b.remove(); }
      });
      mine.clear();
    });
    return {
      modal: (o) => track(() => MV.ui.modal(o)),
      confirm: (msg, o) => track(() => MV.ui.confirm(msg, o)),
      invEditor: (id, o) => track(() => MV.inv.editor(id, o)),
    };
  }
  /** 원래 문을 가리키는 고정 키 (자료 순서가 바뀌어도 같은 문을 가리키도록 x·y·방향으로) */
  const doorKey = (d) => Math.round(num(d.x, 0)) + ',' + Math.round(num(d.y, 0)) + ',' + (d.orientation === 'v' ? 'v' : 'h');
  /** 선분(문·창·트인 곳: x,y,길이 L,방향)이 방 r 의 네 변 중 하나 위에 통째로 놓였는지 */
  function segOnRect(o, L, r, tol) {
    tol = tol == null ? 3 : tol;
    const x = num(o.x, 0), y = num(o.y, 0);
    if (o.orientation === 'v') {
      if (!(Math.abs(x - r.x) < tol || Math.abs(x - r.x - r.w) < tol)) return false;
      return y >= r.y - tol && y + L <= r.y + r.h + tol;
    }
    if (!(Math.abs(y - r.y) < tol || Math.abs(y - r.y - r.h) < tol)) return false;
    return x >= r.x - tol && x + L <= r.x + r.w + tol;
  }
  const segLen = (o) => (o && o.length != null ? Math.max(0, num(o.length, 0)) : Math.max(0, num(o && o.width, 0)));

  /* ---------------- 평면도 사진 기하 ----------------
     사진 픽셀 (u, v) → 도면 cm: 크기 cmPerPx 로 늘린 뒤 rot 만큼 시계 방향으로 돌리고, 돌린 외곽의 좌상단을 (x, y) 에 둠 */
  function bgDims(bg) {
    const W = bg.natW * bg.cmPerPx, H = bg.natH * bg.cmPerPx;
    const q = bg.rot === 90 || bg.rot === 270;
    return { W, H, bw: q ? H : W, bh: q ? W : H };
  }
  const bgBox = (bg) => { const d = bgDims(bg); return { x: bg.x, y: bg.y, w: d.bw, h: d.bh }; };
  function bgToPlan(bg, u, v) {
    const { W, H } = bgDims(bg);
    const a = u * bg.cmPerPx, b = v * bg.cmPerPx;
    let px = a, py = b;
    if (bg.rot === 90) { px = H - b; py = a; } else if (bg.rot === 180) { px = W - a; py = H - b; } else if (bg.rot === 270) { px = b; py = W - a; }
    return { x: bg.x + px, y: bg.y + py };
  }
  function planToBg(bg, X, Y) {
    const { W, H } = bgDims(bg);
    const px = X - bg.x, py = Y - bg.y;
    let a = px, b = py;
    if (bg.rot === 90) { a = py; b = H - px; } else if (bg.rot === 180) { a = W - px; b = H - py; } else if (bg.rot === 270) { a = W - py; b = px; }
    return { u: a / bg.cmPerPx, v: b / bg.cmPerPx };
  }
  /** SVG <image> 의 transform (회전 뒤 외곽 좌상단이 x,y 에 오도록) */
  function bgTransform(bg, x, y) {
    const { W, H } = bgDims(bg);
    const t = bg.rot === 90 ? [H, 0] : bg.rot === 180 ? [W, H] : bg.rot === 270 ? [0, W] : [0, 0];
    return 'translate(' + r2(x + t[0]) + ' ' + r2(y + t[1]) + ')' + (bg.rot ? ' rotate(' + bg.rot + ')' : '');
  }
  const LEN_MIN = 20, LEN_MAX = 5000;   // 축척 맞추기: 받아 주는 실제 길이 (cm)
  /**
   * 실제 길이 글자 → cm. '3300mm' '3.3m' '330' '330cm' '3,300' '1,200' '3,3m' '3.3미터'
   * unit: 'auto' | 'cm' | 'mm' | 'm' (단위 고르기). est: 지금 사진 크기로 잰 길이(cm, 없으면 0)
   * 단위 없는 숫자(단위 자동)는:
   *  - 천 단위 쉼표('1,200' '3,300')가 있으면 도면 치수 → mm
   *  - 아니면 기본(1500 이상 mm · 20 미만 m · 그 밖 cm)으로 읽되, 사진 크기로 잰 길이(est)가 다른 읽기(cm/mm/m)에
   *    훨씬(2배 넘게) 가까우면 그쪽으로 — 예: 사진에서 약 80cm 인 곳에 '1200' → 120cm(mm)
   * → { cm, how, unit, guessed, alts:[{unit, cm}] } 또는 null
   */
  function parseLen(text, unit, est) {
    let s = String(text == null ? '' : text).trim().toLowerCase().replace(/\s+/g, '');
    let grouped = false;
    const mc = /^(\d+(?:,\d+)+)(.*)$/.exec(s);
    if (mc) {
      if (/^\d{1,3}(,\d{3})+$/.test(mc[1])) { grouped = true; s = mc[1].replace(/,/g, '') + mc[2]; }   // 1,200 · 10,500 (천 단위)
      else if (/^\d+,\d{1,2}$/.test(mc[1])) s = mc[1].replace(',', '.') + mc[2];                          // 3,3m (소수점 쉼표)
      else return null;
    }
    const m = /^(\d+(?:\.\d+)?|\.\d+)(mm|cm|m|밀리|미리|밀리미터|센티|센치|센티미터|미터)?$/.exec(s);
    if (!m) return null;
    const v = parseFloat(m[1]);
    if (!(v > 0)) return null;
    let u = m[2] || '';
    if (/^(밀리|미리|밀리미터)$/.test(u)) u = 'mm'; else if (/^(센티|센치|센티미터)$/.test(u)) u = 'cm'; else if (u === '미터') u = 'm';
    const toCm = (uu) => (uu === 'mm' ? v / 10 : uu === 'm' ? v * 100 : v);
    let how = '', guessed = false;
    if (!u) {
      if (unit === 'cm' || unit === 'mm' || unit === 'm') u = unit;
      else if (grouped) { u = 'mm'; how = '도면 치수(mm)로 봤어요'; guessed = true; }
      else {
        guessed = true;
        u = v >= 1500 ? 'mm' : v < LEN_MIN ? 'm' : 'cm';
        how = u === 'mm' ? '숫자가 커서 mm로 봤어요' : u === 'm' ? '작은 숫자라 m로 봤어요' : 'cm로 봤어요';
        if (est > 0) {
          const dist = (uu) => Math.abs(Math.log(toCm(uu) / est));
          const cands = ['cm', 'mm', 'm'].filter((uu) => (uu !== 'm' || v < 50) && toCm(uu) >= LEN_MIN && toCm(uu) <= LEN_MAX);
          const near = cands.slice().sort((a, b) => dist(a) - dist(b))[0];
          if (near && near !== u && dist(near) + Math.LN2 < dist(u)) {
            u = near;
            how = '사진에서 잰 길이(약 ' + Math.round(est) + 'cm)와 가까워 ' + u + '로 봤어요';
          }
        }
      }
    }
    const alts = guessed ? ['mm', 'cm', 'm'].filter((uu) => uu !== u && (uu !== 'm' || v < 50) && toCm(uu) >= LEN_MIN && toCm(uu) <= LEN_MAX).map((uu) => ({ unit: uu, cm: toCm(uu) })) : [];
    return { cm: toCm(u), how, unit: u, guessed, alts };
  }
  /** data URL → Blob (긴 data URL 을 매번 그리지 않도록 blob: 주소로 바꿔 씀) */
  function dataUrlToBlob(u) {
    const i = u.indexOf(',');
    const meta = u.slice(5, i);
    const mime = meta.split(';')[0] || 'image/jpeg';
    const raw = /;base64/i.test(meta) ? atob(u.slice(i + 1)) : decodeURIComponent(u.slice(i + 1));
    const a = new Uint8Array(raw.length);
    for (let j = 0; j < raw.length; j++) a[j] = raw.charCodeAt(j);
    return new Blob([a], { type: mime });
  }
  const bgUrls = {};   // key → { src, url } (같은 사진이면 같은 blob: 주소를 다시 씀)
  function bgHref(key, src) {
    const c = bgUrls[key];
    if (c && c.src === src) return c.url;
    if (c && c.url !== c.src) { try { URL.revokeObjectURL(c.url); } catch (e) { /* 무시 */ } }
    let url = src;
    try { url = URL.createObjectURL(dataUrlToBlob(src)); } catch (e) { url = src; }
    bgUrls[key] = { src, url };
    return url;
  }

  /* ---------------- 상태 접근 ---------------- */
  function layoutsOf(st) {
    if (!st.layouts || typeof st.layouts !== 'object' || Array.isArray(st.layouts)) st.layouts = {};
    KEYS.forEach((k) => {
      const L = st.layouts[k];
      if (!L || typeof L !== 'object') st.layouts[k] = { placements: [] };
      else if (!Array.isArray(L.placements)) L.placements = [];
    });
    return st.layouts;
  }
  function editsOf(st) {
    if (!st.planEdits || typeof st.planEdits !== 'object' || Array.isArray(st.planEdits)) st.planEdits = {};
    KEYS.forEach((k) => {
      let E = st.planEdits[k];
      if (!E || typeof E !== 'object' || Array.isArray(E)) E = st.planEdits[k] = { rooms: {} };
      if (!E.rooms || typeof E.rooms !== 'object' || Array.isArray(E.rooms)) E.rooms = {};
      // 새 항목은 예전 자료에 없을 수 있음 → 비어 있는 것으로
      ['added', 'deleted', 'doorsAdded', 'doorsDeleted'].forEach((f) => { if (!Array.isArray(E[f])) E[f] = []; });
      if (E.size != null && (typeof E.size !== 'object' || Array.isArray(E.size))) delete E.size;
    });
    return st.planEdits;
  }
  /** 평면도 사진 상태 (잘못된 값은 버림) */
  function bgsOf(st) {
    if (!st.planBg || typeof st.planBg !== 'object' || Array.isArray(st.planBg)) st.planBg = { old: null, new: null };
    KEYS.forEach((k) => { if (st.planBg[k] === undefined) st.planBg[k] = null; });
    return st.planBg;
  }
  const BG_SRC_RE = /^data:image\/(jpeg|jpg|png|webp|gif);base64,/i;
  /** 쓸 수 있는 사진이면 값을 다듬은 사본, 아니면 null */
  function bgOf(key) {
    const b = bgsOf(MV.store.get())[key];
    if (!b || typeof b !== 'object' || typeof b.src !== 'string' || !BG_SRC_RE.test(b.src)) return null;
    const natW = num(b.natW, 0), natH = num(b.natH, 0), cmPerPx = num(b.cmPerPx, 0);
    if (!(natW > 0 && natH > 0 && cmPerPx > 0)) return null;
    const rot = [0, 90, 180, 270].includes(+b.rot) ? +b.rot : 0;
    // aligned: 축척을 맞춘 뒤 3단계(왼쪽 위 모서리 맞추기)까지 끝냈는지 — 예전 자료(값 없음)는 끝낸 것으로
    return { src: b.src, natW, natH, cmPerPx, x: num(b.x, 0), y: num(b.y, 0), rot,
      opacity: MV.clamp(num(b.opacity, 0.5), 0.15, 1), show: b.show !== false, fade: b.fade !== false, calibrated: !!b.calibrated, aligned: b.aligned !== false };
  }
  function prefsOf(st) {
    if (!st.ui || typeof st.ui !== 'object') st.ui = {};
    let p = st.ui.plan;
    if (!p || typeof p !== 'object') p = st.ui.plan = {};
    if (typeof p.grid !== 'boolean') p.grid = true;
    if (typeof p.snap !== 'boolean') p.snap = true;
    if (!p.zoom || typeof p.zoom !== 'object') p.zoom = { new: 1, old: 1 };
    if (!['all', 'todo', 'done'].includes(p.filter)) p.filter = 'all';
    if (typeof p.infoOpen !== 'boolean') p.infoOpen = false;
    if (typeof p.laundryRoom !== 'string') p.laundryRoom = '';
    if (typeof p.bgPanel !== 'boolean') p.bgPanel = true;
    return p;
  }
  function initState() {
    MV.store.ensure('layouts', () => ({ old: { placements: [] }, new: { placements: [] } }));
    MV.store.ensure('planEdits', () => ({ old: { rooms: {} }, new: { rooms: {} } }));
    MV.store.ensure('planBg', { old: null, new: null });
    MV.store.ensure('ui', {});
    const st = MV.store.get();
    layoutsOf(st); editsOf(st); prefsOf(st); bgsOf(st);
  }
  const pls = (key) => layoutsOf(MV.store.get())[key].placements;
  const prefs = () => prefsOf(MV.store.get());
  const setPref = (k, v) => MV.store.update((st) => { prefsOf(st)[k] = v; }, { silent: true });

  function invMap() {
    const m = new Map();
    (MV.store.get().inventory || []).forEach((i) => { if (i && i.id) m.set(i.id, i); });
    return m;
  }
  function foot(it, rot) {
    const w = Math.max(5, num(it && it.w, 60)), d = Math.max(5, num(it && it.d, 60));
    return rot === 90 ? { w: d, h: w } : { w, h: d };
  }
  const rectOf = (p, it) => { const f = foot(it, p.rot === 90 ? 90 : 0); return { x: num(p.x, 0), y: num(p.y, 0), w: f.w, h: f.h }; };
  function placedCount(key) {
    const c = {};
    pls(key).forEach((p) => { c[p.invId] = (c[p.invId] || 0) + 1; });
    return c;
  }

  /* ---------------- 도면 (원본 + 실측 수정 병합) ---------------- */
  const validKind = (k) => (typeof k === 'string' && k.trim() ? k.trim() : 'other');
  function getPlan(key) {
    const base = MV.plans && MV.plans[key];
    if (!base || typeof base !== 'object') return null;
    const E = editsOf(MV.store.get())[key];
    const edits = E.rooms;
    const deleted = new Set(E.deleted.map(String));
    const seen = new Set();
    const all = (Array.isArray(base.rooms) ? base.rooms : []).filter((r) => r && typeof r === 'object').map((r, i) => {
      let rid = r.id != null && r.id !== '' ? String(r.id) : 'room' + i;
      if (seen.has(rid)) rid = rid + '#' + i;
      seen.add(rid);
      const orig = { x: num(r.x, 0), y: num(r.y, 0), w: Math.max(0, num(r.w, 0)), h: Math.max(0, num(r.h, 0)), name: String(r.name || '방 ' + (i + 1)), kind: validKind(r.kind) };
      const m = Object.assign({}, orig, { id: rid, note: r.note || '', orig, edited: false, added: false });
      const e = edits[rid];
      if (e && typeof e === 'object') {
        ['x', 'y', 'w', 'h'].forEach((k) => { if (isFinite(parseFloat(e[k]))) m[k] = k === 'w' || k === 'h' ? Math.max(1, +e[k]) : +e[k]; });
        if (e.name && String(e.name).trim()) m.name = String(e.name).trim();
        if (typeof e.kind === 'string' && e.kind.trim()) m.kind = e.kind.trim();
        // 원래 값 그대로 저장된 수정(예전 버전에서 '저장'만 누른 경우)은 수정으로 치지 않음
        m.edited = ['x', 'y', 'w', 'h'].some((k) => Math.abs(m[k] - orig[k]) > 0.05) || m.name !== orig.name || m.kind !== orig.kind;
      }
      return m;
    });
    const kept = all.filter((r) => !deleted.has(r.id));
    const removed = all.filter((r) => deleted.has(r.id));
    // 직접 그린 방
    const added = [];
    E.added.forEach((a, i) => {
      if (!a || typeof a !== 'object') return;
      const w = num(a.w, 0), h = num(a.h, 0);
      if (!(w > 0 && h > 0)) return;
      let id = a.id != null && a.id !== '' ? String(a.id) : 'added' + i;
      if (seen.has(id)) id = id + '#a' + i;
      seen.add(id);
      const r = { x: num(a.x, 0), y: num(a.y, 0), w: Math.max(1, w), h: Math.max(1, h), name: String(a.name || '').trim() || kindLabel(a.kind) + ' ' + (i + 1), kind: validKind(a.kind) };
      added.push(Object.assign({}, r, { id, srcId: a.id, note: '직접 그린 방', orig: Object.assign({}, r), edited: false, added: true }));
    });
    const rooms = kept.concat(added);
    const arr = (a) => (Array.isArray(a) ? a.filter((x) => x && typeof x === 'object') : []);
    // 지운 방에만 붙은 문·창·트인 곳·고정물은 숨김 (남은 방 — 원래 방·직접 그린 방 — 의 벽에도 걸쳐 있으면 그대로 둠)
    const liveRooms = rooms.filter((r) => r.w > 0 && r.h > 0);
    const deadRooms = removed.filter((r) => r.w > 0 && r.h > 0);
    const onLive = (o, L) => liveRooms.some((r) => segOnRect(o, L, r));
    const segHidden = (o) => {
      if (!deadRooms.length) return false;
      const L = segLen(o);
      return deadRooms.some((d) => segOnRect(o, L, d)) && !onLive(o, L);
    };
    const rectHidden = (f) => {
      if (!deadRooms.length) return false;
      const r = fxRect(f);
      return deadRooms.some((d) => within(r, d, 3)) && !liveRooms.some((k) => hasPt(k, r.x + r.w / 2, r.y + r.h / 2));
    };
    const delDoors = new Set(E.doorsDeleted.map(String));
    const baseDoors = arr(base.doors).map((d) => Object.assign({}, d, { _key: 'b:' + doorKey(d), _base: true }));
    const doorsGone = baseDoors.filter((d) => delDoors.has(doorKey(d)));
    const doors = baseDoors.filter((d) => !delDoors.has(doorKey(d)) && !segHidden(d));
    const doorsAdded = [];
    // 직접 추가한 문: 그 문을 단 방(room)이 지워졌거나(원래 방) 없어졌으면(그린 방) 숨김 — 남은 방의 벽 위에도 있으면 그대로 둠
    const liveIds = new Set(rooms.map((r) => r.id));
    let doorsHidden = 0;
    E.doorsAdded.forEach((d, i) => {
      if (!d || typeof d !== 'object') return;
      const id = d.id != null ? String(d.id) : 'door' + i;
      const door = { x: num(d.x, 0), y: num(d.y, 0), width: Math.max(10, num(d.width, NEW_DOOR_W)), orientation: d.orientation === 'v' ? 'v' : 'h',
        swing: ['up', 'down', 'left', 'right'].includes(d.swing) ? d.swing : (d.orientation === 'v' ? 'right' : 'down'),
        hinge: d.hinge === 'end' ? 'end' : 'start', room: d.room != null ? String(d.room) : '', note: '직접 추가한 문', _key: 'a:' + id, _added: true, id };
      const ownerGone = !!door.room && !liveIds.has(door.room);
      if ((ownerGone || segHidden(door)) && !onLive(door, door.width)) { doorsHidden++; return; }
      doorsAdded.push(door);
    });
    // 남은 문이 지운 방 쪽으로 열리면 (예: 다용도실을 지웠는데 주방→다용도실 문) 남은 방 쪽으로 열리게 뒤집음 — 그쪽도 빈 곳이면 그대로
    const swingIn = (d, rs) => { const g = doorGeom(d); const cx = g.swing.x + g.swing.w / 2, cy = g.swing.y + g.swing.h / 2; return rs.some((r) => hasPt(r, cx, cy)); };
    const flipDead = (d) => {
      if (!deadRooms.length || !swingIn(d, deadRooms) || swingIn(d, liveRooms)) return d;
      const nd = Object.assign({}, d, { swing: flipSwing(d), _flipped: true });
      return swingIn(nd, liveRooms) ? nd : d;
    };
    const p = Object.assign({}, base, {
      key, rooms, doors: doors.concat(doorsAdded).map(flipDead),
      windows: arr(base.windows).filter((w) => !segHidden(w)),
      fixtures: arr(base.fixtures).filter((f) => !rectHidden(f)),
      // 붙박이장은 옷 수납 길이 비교에 쓰이므로 방을 지워도 남김 (실측으로 따로 확인)
      builtins: arr(base.builtins),
      name: String(base.name || PLAN_LABEL[key]), short: String(base.short || PLAN_LABEL[key]),
    });
    // 전체 크기
    const bw0 = Math.max(0, num(base.width, 0)), bd0 = Math.max(0, num(base.depth, 0));
    const sz = E.size && num(E.size.width, 0) >= 50 && num(E.size.depth, 0) >= 50 ? { width: +E.size.width, depth: +E.size.depth } : null;
    p.baseSize = { width: bw0, depth: bd0 };
    p.width = sz ? sz.width : bw0;
    p.depth = sz ? sz.depth : bd0;
    p.sizeEdited = !!sz && (Math.abs(sz.width - bw0) > 0.05 || Math.abs(sz.depth - bd0) > 0.05);
    p.sizeSet = !!sz;   // 전체 크기를 직접 넣었으면 치수선도 그 크기로 (방이 더 커도)
    p.doorsHidden = doorsHidden;
    p.removed = removed;
    p.edits = { rooms: kept.filter((r) => r.edited).length, added: added.length, deleted: removed.length, size: p.sizeEdited,
      doorsAdded: doorsAdded.length, doorsDeleted: doorsGone.length };
    p.edited = !!(p.edits.rooms || p.edits.added || p.edits.deleted || p.edits.size || p.edits.doorsAdded || p.edits.doorsDeleted);
    let x0 = 0, y0 = 0, x1 = p.width, y1 = p.depth;
    const grow = (r) => { if (r.w <= 0 || r.h <= 0) return; x0 = Math.min(x0, r.x); y0 = Math.min(y0, r.y); x1 = Math.max(x1, r.x + r.w); y1 = Math.max(y1, r.y + r.h); };
    rooms.forEach(grow); p.fixtures.forEach((f) => grow(fxRect(f))); p.builtins.forEach((f) => grow(fxRect(f)));
    if (x1 - x0 < 50) x1 = x0 + 100;
    if (y1 - y0 < 50) y1 = y0 + 100;
    p.bounds = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
    p.vb = { x: x0 - MARGIN, y: y0 - MARGIN, w: x1 - x0 + 2 * MARGIN, h: y1 - y0 + 2 * MARGIN };
    p.openings = arr(base.openings).filter((o) => !segHidden(o));
    return p;
  }
  /** 수정 내용 한 줄 요약 (칩 설명·정보 카드) */
  function editSummary(plan) {
    const e = plan.edits || {};
    const out = [];
    if (e.rooms) out.push('방 ' + e.rooms + '개 치수·이름 수정');
    if (e.added) out.push('그린 방 ' + e.added + '개');
    if (e.deleted) out.push('지운 방 ' + e.deleted + '개');
    if (e.size) out.push('전체 크기 ' + Math.round(plan.width) + '×' + Math.round(plan.depth) + 'cm');
    if (e.doorsAdded) out.push('문 추가 ' + e.doorsAdded);
    if (e.doorsDeleted) out.push('문 삭제 ' + e.doorsDeleted);
    return out.join(' · ');
  }
  /** 그림 범위: 도면 + (예전 자료 등으로) 도면 밖에 놓인 짐까지 보이게 넓힘 → 보이지 않는 짐이 생기지 않도록.
      extra = 함께 보여 줄 사각형 (평면도 사진 외곽 — 도면 크기의 3배 안쪽까지만) */
  function viewBoxFor(plan, items, extra) {
    const vb = plan.vb;
    let x0 = vb.x, y0 = vb.y, x1 = vb.x + vb.w, y1 = vb.y + vb.h;
    (items || []).forEach(({ r }) => {
      if (!r) return;
      x0 = Math.min(x0, r.x - 24); y0 = Math.min(y0, r.y - 24);
      x1 = Math.max(x1, r.x + r.w + 24); y1 = Math.max(y1, r.y + r.h + 24);
    });
    if (extra && extra.w > 0 && extra.h > 0) {
      const b = plan.bounds, cap = 3 * Math.max(b.w, b.h);
      x0 = Math.min(x0, Math.max(extra.x - 16, b.x - cap)); y0 = Math.min(y0, Math.max(extra.y - 16, b.y - cap));
      x1 = Math.max(x1, Math.min(extra.x + extra.w + 16, b.x + b.w + cap)); y1 = Math.max(y1, Math.min(extra.y + extra.h + 16, b.y + b.h + cap));
    }
    return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  }
  /**
   * 방 이름이 바뀌면 그 방을 가리키던 짐의 room/roomNew 도 함께 바꿈 (st 안에서 호출). 바꾼 짐 개수.
   * changes = [{ rid, from, to }] — 모두 '바꾸기 전' 값으로 한꺼번에 계산 (A→B, B→C 가 연쇄로 섞이지 않게).
   * plan = 바꾸기 전 병합 도면. 같은 이름을 쓰는 다른 방이 있으면 이름만으론 어느 방 짐인지 모르므로
   * 그 방 안에 실제로 놓인 짐만 바꿈 (다른 방 짐을 끌고 가지 않게).
   */
  function remapRoomRefs(st, key, plan, changes) {
    const field = roomField(key);
    const inv = (st.inventory || []).filter((i) => i && typeof i === 'object');
    const P = layoutsOf(st)[key].placements;
    const next = new Map();
    changes.forEach(({ rid, from, to }) => {
      const f = norm(from);
      if (!f || !to || f === norm(to)) return;
      let only = null;
      if (plan && plan.rooms.some((r) => r.id !== rid && norm(r.name) === f)) {
        const room = plan.rooms.find((r) => r.id === rid);
        only = new Set();
        if (room) P.forEach((p) => {
          const it = inv.find((i) => i.id === p.invId);
          if (!it) return;
          const r = rectOf(p, it);
          if (hasPt(room, r.x + r.w / 2, r.y + r.h / 2)) only.add(it.id);
        });
      }
      inv.forEach((it) => { if (!next.has(it) && norm(it[field]) === f && (!only || only.has(it.id))) next.set(it, to); });
    });
    next.forEach((to, it) => { it[field] = to; });
    return next.size;
  }
  /** 다른 방이 이미 쓰는 이름인지 (공백·기호 무시) → 그 방 */
  function nameClash(plan, rid, name) {
    const n = norm(name);
    return n ? plan.rooms.find((r) => r.id !== rid && norm(r.name) === n) || null : null;
  }
  const validRooms = (plan) => plan.rooms.filter((r) => r.w > 0 && r.h > 0);
  function roomAt(plan, x, y) {
    let best = null;
    validRooms(plan).forEach((r) => { if (hasPt(r, x, y) && (!best || area(r) < area(best))) best = r; });
    return best;
  }
  /** 짐의 room/roomNew 문자열 → 도면의 방 (이름 일치 → 포함 → 종류 추정) */
  function findRoom(plan, name) {
    const qn = norm(name);
    if (!qn || !plan) return null;
    const rs = validRooms(plan);
    let r = rs.find((x) => norm(x.name) === qn);
    if (r) return r;
    r = rs.find((x) => { const n = norm(x.name); return n && (n.includes(qn) || qn.includes(n)); });
    if (r) return r;
    const kw = KIND_WORDS.find(([w]) => qn.includes(w));
    if (!kw) return null;
    const cand = rs.filter((x) => x.kind === kw[1]).sort((a, b) => area(b) - area(a));
    if (!cand.length) return null;
    if (kw[1] === 'bedroom' && !/안방|침실/.test(qn) && cand.length > 1) return cand[1];
    return cand[0];
  }
  function statics(plan) {
    const out = [];
    plan.doors.forEach((d) => { const g = doorGeom(d); out.push({ r: g.swing, type: 'door', name: '문' }, { r: g.front, type: 'doorway', name: '문 앞' }); });
    plan.fixtures.forEach((f) => { const r = fxRect(f); if (r.w >= 30 && r.h >= 30) out.push({ r, type: 'fixture', name: String(f.name || '고정물') }); });
    plan.builtins.forEach((b) => out.push({ r: fxRect(b), type: 'builtin', name: String(b.name || '붙박이') }));
    return out;
  }
  const passages = (plan) => plan.openings.map(openingGeom).filter((g) => g.L > 0);
  /** 트인 곳 이름: '거실↔식당·복도' (rooms 가 없으면 메모) */
  function passName(plan, g) {
    const ids = Array.isArray(g.op.rooms) ? g.op.rooms : [];
    const names = ids.map((id) => { const r = plan.rooms.find((x) => x.id === String(id)); return r ? r.name : null; }).filter(Boolean);
    if (names.length >= 2) return names.join('↔') + ' 사이 트인 곳';
    return g.op.note ? String(g.op.note).replace(/\(.*?\)/g, '').trim() || '트인 곳' : '트인 곳';
  }
  /** 식탁·탁자처럼 방 가운데 둬도 되는 짐 (나머지는 벽에 붙여 놓음) */
  const floatable = (it) => !!it && (it.tag === 'table' || /식탁|테이블|탁자|러그/.test(it.name || ''));

  /* ---------------- 자리 찾기 · 놓기 · 자동 배치 ---------------- */
  function steps(a, b, s) {
    const out = [];
    if (b < a - 0.01) return out;
    for (let v = a; v <= b + 0.01; v += s) out.push(r1(v));
    if (Math.abs(out[out.length - 1] - b) > 0.05) out.push(r1(b));
    return out;
  }
  /**
   * region 안에서 다른 짐·문 열림·문 앞·고정물과 겹치지 않고, 트인 곳의 통로(PASS_KEEP)를 남기는 자리.
   * mode 'wall' = 실제 벽(문·트인 곳 제외)에 붙은 자리만 (식탁·탁자만 가운데도 허용) · 'center' = 가운데 가까이
   */
  function findSpot(plan, it, region, mode, occupied, stat) {
    const wm = wallMounted(it);
    const f0 = foot(it, 0);
    const rots = f0.w === f0.h ? [0] : [0, 90];
    const rcx = region.x + region.w / 2, rcy = region.y + region.h / 2;
    const near = { x: region.x - 30, y: region.y - 30, w: region.w + 60, h: region.h + 60 };
    const doorPts = plan.doors.map(doorGeom).filter((g) => hit(g.swing, near, 0)).map((g) => [g.swing.x + g.swing.w / 2, g.swing.y + g.swing.h / 2]);
    const gaps = edgeGaps(plan, region);
    const fxs = stat.filter((o) => o.type === 'fixture' || o.type === 'builtin').map((o) => o.r);
    // 이 방 근처의 트인 곳: 이미 있는 짐·고정물만으로 남은 폭을 미리 계산
    const ogs = wm ? [] : passages(plan).filter((g) => hit(g.zone, near, 0)).map((g) => {
      const obs = fxs.concat(occupied).filter((r) => hit(r, g.zone, 0.5));
      return { g, obs, need: Math.min(PASS_KEEP, openingFree(g, obs)) - 0.5 };
    });
    const mustWall = mode === 'wall' && !floatable(it);
    let best = null;
    rots.forEach((rot) => {
      const f = foot(it, rot);
      if (f.w > region.w + 0.5 || f.h > region.h + 0.5) return;
      const xs = steps(region.x, region.x + region.w - f.w, 10);
      const ys = steps(region.y, region.y + region.h - f.h, 10);
      if (mode === 'center') { xs.push(r1(rcx - f.w / 2)); ys.push(r1(rcy - f.h / 2)); }
      for (const x of xs) {
        for (const y of ys) {
          const r = { x, y, w: f.w, h: f.h };
          if (!wm && occupied.some((o) => hit(r, o, 0.5))) continue;
          if (stat.some((o) => hit(r, o.r, 0.5))) continue;
          if (ogs.some((o) => hit(r, o.g.zone, 0.5) && openingFree(o.g, o.obs.concat([r])) < o.need)) continue;
          let score;
          if (mode === 'wall') {
            const L = Math.abs(x - region.x) < 1 && wallFrac(gaps.L, y, y + f.h) >= 0.5;
            const R = Math.abs(x + f.w - region.x - region.w) < 1 && wallFrac(gaps.R, y, y + f.h) >= 0.5;
            const T = Math.abs(y - region.y) < 1 && wallFrac(gaps.T, x, x + f.w) >= 0.5;
            const B = Math.abs(y + f.h - region.y - region.h) < 1 && wallFrac(gaps.B, x, x + f.w) >= 0.5;
            const n = (L ? 1 : 0) + (R ? 1 : 0) + (T ? 1 : 0) + (B ? 1 : 0);
            if (mustWall && !n) continue;
            const back = rot === 0 ? (T ? 'T' : B ? 'B' : null) : (L ? 'L' : R ? 'R' : null);
            const cx = x + f.w / 2, cy = y + f.h / 2;
            let dd = 400;
            doorPts.forEach(([px, py]) => { dd = Math.min(dd, Math.hypot(cx - px, cy - py)); });
            score = (back ? 100 : 0) + (n ? 25 : 0) + Math.min(n, 2) * 5 + dd / 20 - (rot ? 1 : 0);
            // 앞쪽 50cm 에 다른 짐이 있으면 (문·서랍을 못 엶) 덜 좋은 자리
            if (back && !wm) {
              const fr = back === 'T' ? { x, y: y + f.h, w: f.w, h: 50 } : back === 'B' ? { x, y: y - 50, w: f.w, h: 50 }
                : back === 'L' ? { x: x + f.w, y, w: 50, h: f.h } : { x: x - 50, y, w: 50, h: f.h };
              if (occupied.some((o) => hit(fr, o, 0.5))) score -= 30;
            }
          } else {
            score = -Math.hypot(x + f.w / 2 - rcx, y + f.h / 2 - rcy) - (rot ? 40 : 0);
          }
          if (!best || score > best.score) best = { x, y, rot, score };
        }
      }
    });
    return best;
  }
  function occupiedRects(key, inv, exceptPid) {
    return pls(key).filter((p) => p.id !== exceptPid).map((p) => {
      const it = inv.get(p.invId);
      return it && !wallMounted(it) ? rectOf(p, it) : null;
    }).filter(Boolean);
  }
  /** 짐 하나를 놓을 자리 계산 (저장은 호출한 쪽에서) */
  function planPlacement(key, invId) {
    const plan = getPlan(key);
    const inv = invMap();
    const it = inv.get(invId);
    if (!plan || !it) return null;
    const occ = occupiedRects(key, inv);
    const stat = statics(plan);
    let room = findRoom(plan, it[roomField(key)]);
    let spot = null;
    // 냉장고·옷장·책장처럼 벽에 붙여 쓰는 짐은 벽 쪽에, 식탁·탁자는 방 가운데에
    const tryRoom = (rm) => (!floatable(it) && findSpot(plan, it, rm, 'wall', occ, stat)) || findSpot(plan, it, rm, 'center', occ, stat);
    if (room) spot = tryRoom(room);
    else {
      const b = plan.bounds;
      room = roomAt(plan, b.x + b.w / 2, b.y + b.h / 2);
      if (room) spot = tryRoom(room);
      if (!spot) spot = findSpot(plan, it, b, 'center', occ, stat);
    }
    if (!spot) {
      const reg = room || plan.bounds;
      const f = foot(it, 0);
      spot = { x: reg.x + reg.w / 2 - f.w / 2, y: reg.y + reg.h / 2 - f.h / 2, rot: 0 };
    }
    const pl = { id: MV.uid('pl'), invId, x: r1(spot.x), y: r1(spot.y), rot: spot.rot === 90 ? 90 : 0 };
    const r = rectOf(pl, it);
    return { pl, it, room: roomAt(plan, r.x + r.w / 2, r.y + r.h / 2) };
  }
  function commitPlacement(key, res, opts) {
    MV.store.update((st) => {
      layoutsOf(st)[key].placements.push(res.pl);
      const it = (st.inventory || []).find((i) => i.id === res.pl.invId);
      if (it && res.room && !String(it[roomField(key)] || '').trim()) it[roomField(key)] = res.room.name;
    }, opts);
  }
  function runAutoLayout(key) {
    const plan = getPlan(key);
    if (!plan) return null;
    const inv = invMap();
    const cnt = placedCount(key);
    const todo = [];
    MV.inv.list((it) => eligible(key, it)).forEach((it) => {
      for (let i = cnt[it.id] || 0; i < qtyOf(it); i++) todo.push(it);
    });
    todo.sort((a, b) => { const fa = foot(a, 0), fb = foot(b, 0); return fb.w * fb.h - fa.w * fa.h; });
    const occ = occupiedRects(key, inv);
    const stat = statics(plan);
    const res = { placed: [], noFit: [], noRoom: [], newPls: [] };
    todo.forEach((it) => {
      const room = findRoom(plan, it[roomField(key)]);
      if (!room) { res.noRoom.push({ it }); return; }
      const spot = findSpot(plan, it, room, 'wall', occ, stat);
      if (!spot) { res.noFit.push({ it, room }); return; }
      const pl = { id: MV.uid('pl'), invId: it.id, x: r1(spot.x), y: r1(spot.y), rot: spot.rot === 90 ? 90 : 0 };
      res.newPls.push(pl);
      if (!wallMounted(it)) occ.push(rectOf(pl, it));
      res.placed.push({ it, room });
    });
    if (res.newPls.length) {
      MV.store.update((st) => { layoutsOf(st)[key].placements.push(...res.newPls); },
        { log: '📐 ' + PLAN_LABEL[key] + ' 도면 자동 배치: ' + res.newPls.length + '개' });
    }
    res.total = todo.length;
    return res;
  }

  /* ---------------- 배치 점검 ---------------- */
  function validate(plan, key, inv) {
    const list = pls(key).map((p) => ({ p, it: inv.get(p.invId) })).filter((o) => o.it);
    list.forEach((o) => { o.r = rectOf(o.p, o.it); });
    const lv = {};
    const msgs = [];
    const add = (level, text, ...pids) => {
      const m = { pid: pids[0], level, text };
      msgs.push(m);
      pids.forEach((id) => { if (id && lv[id] !== 'bad') lv[id] = level; });
      return m;
    };
    const b = plan.bounds;
    const stat = statics(plan);
    const rooms = validRooms(plan);
    const count = {};
    list.forEach((o) => {
      const { p, it, r } = o;
      const nm = q(it);
      count[it.id] = (count[it.id] || 0) + 1;
      if (count[it.id] > qtyOf(it)) add('warn', nm + ' 수량(' + qtyOf(it) + '개)보다 많이 놓였어요', p.id);
      if (key === 'new' && (it.fate === 'discard' || it.fate === 'sell')) add('warn', nm + jo(it.name, '은', '는') + ' “' + MV.inv.fate(it.fate).label + '”' + joRo(MV.inv.fate(it.fate).label) + ' 정한 짐이에요', p.id);
      if (key === 'old' && it.fate === 'buy') add('warn', nm + jo(it.name, '은', '는') + ' 새로 살 물건이라 지금 집엔 없어요', p.id);
      if (!within(r, b, 1)) {
        const big = !fitsIn(r, b) && !fitsIn({ w: r.h, h: r.w }, b);
        add('bad', nm + jo(it.name, '이', '가') + (big ? ' 도면 전체보다 커요 — 규격을 확인하세요' : ' 도면 밖으로 나갔어요'), p.id).fix = big ? null : 'in';
        o.out = true;
        return;
      }
      if (!rooms.some((rm) => within(r, rm, 1))) {
        const c = roomAt(plan, r.x + r.w / 2, r.y + r.h / 2);
        const S = nm + jo(it.name, '이', '가') + ' ';
        if (c && !fitsIn(r, c)) {
          const turn = fitsIn({ w: r.h, h: r.w }, c);
          add('warn', S + c.name + '(' + Math.round(c.w) + '×' + Math.round(c.h) + 'cm)보다 커요' + (turn ? ' — 돌리면 들어가요' : ''), p.id).fix = turn ? 'turn' : null;
        } else add('warn', c ? S + '벽/방 경계를 넘어요 (' + c.name + ')' : S + '방이 아닌 곳에 놓였어요', p.id).fix = c ? 'room' : null;
      }
      if (!wallMounted(it)) {
        if (stat.some((s) => s.type === 'door' && hit(r, s.r, 1))) add('warn', nm + jo(it.name, '이', '가') + ' 문 열림 범위를 막아요', p.id);
        else if (stat.some((s) => s.type === 'doorway' && hit(r, s.r, 1))) add('warn', nm + jo(it.name, '이', '가') + ' 문 앞을 막아요 (드나들 자리)', p.id);
        stat.filter((s) => (s.type === 'fixture' || s.type === 'builtin') && hit(r, s.r, 1)).forEach((s) => add('warn', nm + jo(it.name, '이', '가') + ' ' + s.name + ' 자리와 겹쳐요', p.id));
      }
    });
    // 트인 곳(문 없는 통로): 양쪽 가구 때문에 지나갈 폭이 PASS_MIN 보다 좁아지면
    const fxs = stat.filter((s) => s.type === 'fixture' || s.type === 'builtin').map((s) => s.r);
    passages(plan).forEach((g) => {
      const near = list.filter((o) => !o.out && !wallMounted(o.it) && hit(o.r, g.zone, 0.5)
        && Math.min(g.hi, g.v ? o.r.y + o.r.h : o.r.x + o.r.w) - Math.max(g.lo, g.v ? o.r.y : o.r.x) > 0.5);
      if (!near.length) return;
      const fx = fxs.filter((r) => hit(r, g.zone, 0.5));
      const need = Math.min(PASS_MIN, openingFree(g, fx));
      const free = openingFree(g, fx.concat(near.map((o) => o.r)));
      if (free >= need - 0.5) return;
      near.sort((a, b) => (b.r.w * b.r.h) - (a.r.w * a.r.h));
      const names = near.slice(0, 3).map((o) => q(o.it)).join('·') + (near.length > 3 ? ' 외 ' + (near.length - 3) + '개' : '');
      const lastIt = near[Math.min(near.length, 3) - 1].it;
      add('warn', names + jo(near.length > 3 ? '개' : lastIt.name, '이', '가') + ' ' + passName(plan, g) + jo(passName(plan, g), '을', '를') + ' 막아요 — 지나갈 폭 ' + Math.max(0, Math.round(free)) + 'cm (' + PASS_MIN + 'cm 넘게 비워 두세요)', ...near.map((o) => o.p.id));
    });
    for (let i = 0; i < list.length; i++) {
      const a = list[i];
      if (a.out || wallMounted(a.it)) continue;
      for (let j = i + 1; j < list.length; j++) {
        const c = list[j];
        if (c.out || wallMounted(c.it)) continue;
        if (hit(a.r, c.r, 1)) add('bad', q(a.it) + jo(a.it.name, '과', '와') + ' ' + q(c.it) + jo(c.it.name, '이', '가') + ' 겹쳐요', a.p.id, c.p.id);
      }
    }
    msgs.sort((x, y) => (x.level === y.level ? 0 : x.level === 'bad' ? -1 : 1));
    return { lv, msgs, bad: msgs.filter((m) => m.level === 'bad').length, warn: msgs.filter((m) => m.level === 'warn').length, list };
  }

  /* ---------------- 다용도실 세탁기·건조기 점검 ---------------- */
  const isWasher = (it) => it.tag === 'washer' || (!it.tag && /세탁기/.test(it.name || '') && !/건조기/.test(it.name || ''));
  const isDryer = (it) => it.tag === 'dryer' || (!it.tag && /건조기/.test(it.name || ''));
  function pickBy(pred, order) {
    const c = MV.inv.list((i) => pred(i) && order.includes(fateOf(i)));
    for (const f of order) { const x = c.find((i) => fateOf(i) === f); if (x) return x; }
    return null;
  }
  const pickWasher = () => pickBy(isWasher, ['buy', 'move', 'undecided']);
  const pickDryer = () => pickBy(isDryer, ['move', 'buy', 'undecided']);
  function washerType(w) {
    const s = nameNote(w);
    if (/통돌이|일반\s*세탁기|전자동|top\s*-?load/i.test(s)) return 'top';
    if (/드럼|drum|front\s*-?load/i.test(s)) return 'drum';
    return '';
  }
  function laundryRooms(plan) {
    const rs = validRooms(plan);
    const util = rs.filter((r) => r.kind === 'utility');
    if (util.length) return util;
    const byName = rs.filter((r) => /다용도|세탁|보일러/.test(r.name));
    if (byName.length) return byName;
    const balc = rs.filter((r) => r.kind === 'balcony');
    if (balc.length > 1) { const maxA = Math.max(...balc.map(area)); return balc.filter((r) => area(r) < maxA); }
    return [];
  }
  const tapRe = /수전|배수|tap|drain|세탁/i;
  function tapIn(plan, room) {
    const zone = { x: room.x - 15, y: room.y - 15, w: room.w + 30, h: room.h + 30 };
    return plan.fixtures.find((f) => { const r = fxRect(f); return tapRe.test(String(f.name || '') + ' ' + String(f.kind || '')) && hasPt(zone, r.x + r.w / 2, r.y + r.h / 2); }) || null;
  }
  /**
   * 세탁기·건조기를 한 벽에 나란히(틈 3cm×3) 놓을 실제 자리. 고정물·붙박이·문 앞·문 열림 범위와 겹치지 않고,
   * 트인 곳 통로를 막지 않는 자리 중 (다른 짐과 안 겹침 > 앞 60cm 비어 있음 > 수전 가까움) 순으로 고름. 없으면 null
   */
  function laundrySpot(plan, room, washer, dryer, occ) {
    occ = occ || [];
    const stat = statics(plan);
    const gaps = edgeGaps(plan, room);
    const fxs = stat.filter((o) => o.type === 'fixture' || o.type === 'builtin').map((o) => o.r);
    const ogs = passages(plan).filter((g) => hit(g.zone, room, 0)).map((g) => {
      const obs = fxs.filter((r) => hit(r, g.zone, 0.5));
      return { g, obs, need: Math.min(PASS_MIN, openingFree(g, obs)) - 0.5 };
    });
    const tap = tapIn(plan, room);
    const tc = tap ? (() => { const r = fxRect(tap); return [r.x + r.w / 2, r.y + r.h / 2]; })() : null;
    let best = null;
    [0, 90].forEach((rot) => {
      const fW = foot(washer, rot), fD = foot(dryer, rot);
      const along = rot === 0;   // 0: 두 대가 가로로 나란히 (위·아래 벽에 등), 90: 세로로 (왼쪽·오른쪽 벽)
      const len = (along ? fW.w + fD.w : fW.h + fD.h) + 9;
      const dep = Math.max(along ? fW.h : fW.w, along ? fD.h : fD.w);
      const span = along ? room.w : room.h, cross = along ? room.h : room.w;
      if (len > span + 0.5 || dep + 10 > cross + 0.5) return;
      (along ? ['T', 'B'] : ['L', 'R']).forEach((side) => {
        steps(0, span - len, 5).forEach((off) => {
          const b0 = (along ? room.x : room.y) + off;
          const near = side === 'T' || side === 'L';
          const block = along ? { x: b0, y: near ? room.y : room.y + room.h - dep - 10, w: len, h: dep + 10 }
            : { x: near ? room.x : room.x + room.w - dep - 10, y: b0, w: dep + 10, h: len };
          if (wallFrac(gaps[side], b0, b0 + len) < 0.6) return;
          if (stat.some((o) => hit(block, o.r, 0.5))) return;
          if (ogs.some((o) => hit(block, o.g.zone, 0.5) && openingFree(o.g, o.obs.concat([block])) < o.need)) return;
          const fr = along ? { x: b0, y: near ? block.y + block.h : block.y - 60, w: len, h: 60 } : { x: near ? block.x + block.w : block.x - 60, y: b0, w: 60, h: len };
          const front = inter(fr, room) ? { x: Math.max(fr.x, room.x), y: Math.max(fr.y, room.y), w: Math.min(fr.x + fr.w, room.x + room.w) - Math.max(fr.x, room.x), h: Math.min(fr.y + fr.h, room.y + room.h) - Math.max(fr.y, room.y) } : null;
          const frontFree = !front || !stat.some((o) => hit(front, o.r, 0.5));
          [0, 1].forEach((order) => {
            let a = b0 + 3;
            const pos = (order ? [[dryer, fD], [washer, fW]] : [[washer, fW], [dryer, fD]]).map(([it, f]) => {
              const fd = along ? f.h : f.w;
              const x = along ? a : (near ? room.x : room.x + room.w - fd);
              const y = along ? (near ? room.y : room.y + room.h - fd) : a;
              a += (along ? f.w : f.h) + 3;
              return { it, x: r1(x), y: r1(y), r: { x, y, w: f.w, h: f.h } };
            });
            const occFree = !occ.some((o) => pos.some((p2) => hit(p2.r, o, 0.5)));
            const frontOcc = !front || !occ.some((o) => hit(front, o, 0.5));
            const wp = pos.find((p2) => p2.it === washer).r;
            const tapD = tc ? Math.hypot(wp.x + wp.w / 2 - tc[0], wp.y + wp.h / 2 - tc[1]) : 0;
            const score = (occFree ? 400 : 0) + (frontFree ? 200 : 0) + (frontOcc ? 50 : 0) - tapD / 5 - order;
            if (!best || score > best.score) best = { score, rot, pos, occFree, frontFree, side };
          });
        });
      });
    });
    return best;
  }
  /** 점검 문구용: 이 공간 안·가장자리의 장애물 이름 */
  function roomObstacles(plan, room) {
    const zone = { x: room.x - 2, y: room.y - 2, w: room.w + 4, h: room.h + 4 };
    const out = [];
    statics(plan).forEach((o) => {
      if (!hit(o.r, zone, 1)) return;
      const nm = o.type === 'door' ? '문 열림 범위' : o.type === 'doorway' ? '문 앞 통로' : o.name;
      if (!out.includes(nm)) out.push(nm);
    });
    if (passages(plan).some((g) => hit(g.zone, room, 1))) out.push('트인 통로');
    return out;
  }
  function laundryCheck(plan, room, washer, dryer) {
    const checks = [];
    const sugg = [];
    const long = Math.round(Math.max(room.w, room.h)), short = Math.round(Math.min(room.w, room.h));
    const ww = Math.round(num(washer.w, 70)), wd = Math.round(num(washer.d, 72)), wh = Math.round(num(washer.h, 105));
    const dw = Math.round(num(dryer.w, 70)), dd = Math.round(num(dryer.d, 76)), dh = Math.round(num(dryer.h, 99));
    const needW = ww + dw + 9;
    const slackW = long - needW;
    if (slackW >= 5) checks.push({ lv: 'ok', t: '나란히 놓기 — 폭 충분', d: '필요 ' + needW + 'cm (세탁기 ' + ww + ' + 건조기 ' + dw + ' + 틈 3cm×3) ≤ 방 긴 쪽 ' + long + 'cm · 여유 ' + slackW + 'cm' });
    else if (slackW >= 0) checks.push({ lv: 'warn', t: '나란히 놓기 — 빠듯해요', d: '필요 ' + needW + 'cm, 방 긴 쪽 ' + long + 'cm · 여유 ' + slackW + 'cm뿐이에요. 벽 몰딩·배관 때문에 안 들어갈 수 있으니 꼭 실측하세요.' });
    else checks.push({ lv: 'bad', t: '나란히 놓기 — 폭이 ' + (-slackW) + 'cm 모자라요', d: '필요 ' + needW + 'cm (세탁기 ' + ww + ' + 건조기 ' + dw + ' + 틈 9cm) > 방 긴 쪽 ' + long + 'cm' });
    const maxD = Math.max(wd, dd);
    const needD = maxD + 10 + 60;
    if (needD <= short) checks.push({ lv: 'ok', t: '깊이·앞 공간 충분', d: '기기 ' + maxD + ' + 호스 10 + 앞 공간 60 = ' + needD + 'cm ≤ 방 짧은 쪽 ' + short + 'cm' });
    else if (maxD + 10 <= short) checks.push({ lv: 'warn', t: '들어가지만 앞 공간이 좁아요', d: '기기 앞에 ' + (short - maxD - 10) + 'cm만 남아요 (60cm 권장) — 문 여닫기·빨래 꺼내기가 불편할 수 있어요.' });
    else checks.push({ lv: 'bad', t: '깊이가 ' + (maxD + 10 - short) + 'cm 모자라요', d: '기기 ' + maxD + ' + 호스 10 = ' + (maxD + 10) + 'cm > 방 짧은 쪽 ' + short + 'cm' });
    const obsAt = checks.length;   // 장애물 점검 결과는 폭·깊이 바로 다음에 보여 줌
    const type = washerType(washer);
    if (type === 'top') {
      checks.push({ lv: 'bad', t: '통돌이 위에는 건조기를 바로 올릴 수 없어요 (뚜껑이 위로 열림)', d: '나란히 두거나 건조기를 다른 곳에 두세요. 거치대(선반형)를 쓰면 뚜껑 열림 높이 위로 올려야 해서 약 ' + (wh + 45 + dh) + 'cm 높이가 필요해요.' });
      checks.push({ lv: 'info', t: '뚜껑 열림 높이 약 ' + (wh + 45) + 'cm 필요', d: '세탁기 높이 ' + wh + 'cm + 뚜껑 약 45cm. 위쪽 선반·수납장·창틀·빨래건조대가 이보다 높은지 현장에서 재세요.' });
    } else if (type === 'drum') {
      checks.push({ lv: 'info', t: '드럼이면 건조기를 위에 올릴 수 있어요 (직렬 키트)', d: '쌓으면 높이 약 ' + (wh + dh + 5) + 'cm — 천장·창틀 높이를 확인하세요.' });
    } else {
      checks.push({ lv: 'warn', t: '세탁기 종류(통돌이/드럼)를 알 수 없어요', d: '짐 이름이나 메모에 “통돌이” 또는 “드럼”을 적으면 쌓기·뚜껑 높이까지 점검해 드려요.' });
    }
    const tap = tapIn(plan, room);
    if (tap) checks.push({ lv: 'ok', t: '도면에 ' + (tap.name || '세탁 수전') + ' 표시 있음', d: '세탁기를 수전·배수구 가까운 쪽에 두면 호스가 짧아져요.' });
    else checks.push({ lv: 'warn', t: '도면에 세탁 수전·배수구 위치가 없어요', d: '사전방문 때 수전·배수구·콘센트 위치를 사진으로 남겨 두세요.' });
    const failW = slackW < 0, failD = maxD + 10 > short;
    // 폭·깊이 숫자만이 아니라 문 열림·문 앞·고정물(신발장·욕조 등)·트인 통로를 피해 실제로 둘 벽이 있는지
    let spot = null, failObs = false, frontHit = false;
    if (!failW && !failD) {
      spot = laundrySpot(plan, room, washer, dryer, []);
      const obs = roomObstacles(plan, room);
      let oc;
      if (!spot) {
        failObs = true;
        oc = ({ lv: 'bad', t: '문·고정물 때문에 나란히 둘 벽이 없어요', d: (obs.length ? obs.slice(0, 4).join('·') + jo(obs[Math.min(obs.length, 4) - 1], '을', '를') + ' 피해서 ' : '') + needW + 'cm 연속 벽(깊이 ' + (maxD + 10) + 'cm)을 찾지 못했어요. 숫자로는 들어가도 실제로는 못 놓아요.' });
      } else if (!spot.frontFree) {
        frontHit = true;
        oc = ({ lv: 'warn', t: '놓을 벽은 있지만 앞 공간이 문 열림·고정물과 겹쳐요', d: '세탁기 앞 60cm 안에 ' + (obs.length ? obs.slice(0, 3).join('·') : '다른 것') + jo(obs.length ? obs[Math.min(obs.length, 3) - 1] : '것', '이', '가') + ' 있어요 — 문과 세탁기 문을 동시에 못 열 수 있어요.' });
      } else {
        oc = ({ lv: 'ok', t: '문·고정물을 피해 놓을 벽 있음', d: ({ T: '위쪽', B: '아래쪽', L: '왼쪽', R: '오른쪽' })[spot.side] + ' 벽(도면 기준)에 나란히 둘 수 있어요' + (obs.length ? ' · 피한 것: ' + obs.slice(0, 4).join(', ') : '') + '.' });
      }
      checks.splice(obsAt, 0, oc);
    }
    if (failW || failD || slackW < 5 || failObs) {
      sugg.push('폭이 좁은 세탁기 고르기 (통돌이 15~16kg급은 폭 60~64cm 정도)');
      sugg.push('건조기는 다른 곳(전면 발코니·욕실 앞 등)에 두기');
      sugg.push(type === 'top' ? '세탁기 위 건조기 거치대(선반형) — 통돌이는 뚜껑 열림 높이 때문에 거치대가 높아져요' : '세탁기 위 건조기 거치대 또는 직렬 키트');
    }
    if (failObs || frontHit) sugg.push('문이 어느 쪽으로 열리는지, 고정물을 옮길 수 있는지 현장에서 확인하기');
    sugg.push('사전방문 때 ' + room.name + ' 폭·깊이·출입문 폭을 꼭 실측하고 “✏️ 치수 수정”으로 반영하기');
    const worst = failW || failD || failObs ? 'bad' : (slackW < 5 || needD > short || frontHit) ? 'warn' : 'ok';
    return { checks, sugg, worst, needW, needD, long, short, spot };
  }

  /* ---------------- 옷 수납 길이 ---------------- */
  const isCloset = (it) => !!it && (it.tag === 'wardrobe' || /옷장|장롱|붙박이/.test(it.name || '') || (it.cat === 'storage' && num(it.h, 0) >= 150));
  function closetCompare() {
    const inv = invMap();
    const oldP = getPlan('old');
    const builtins = oldP ? oldP.builtins.filter((b) => !CLOSET_EXCLUDE.test(String(b.name || ''))) : [];
    const bLen = Math.round(builtins.reduce((s, b) => s + Math.max(num(b.w, 0), num(b.h, 0)), 0));
    const sumPl = (key) => Math.round(pls(key).reduce((s, p) => { const it = inv.get(p.invId); return isCloset(it) ? s + Math.max(0, num(it.w, 0)) : s; }, 0));
    const oldFree = sumPl('old'), newLen = sumPl('new');
    const cnt = placedCount('new');
    const unplaced = MV.inv.list((it) => isCloset(it) && eligible('new', it) && (cnt[it.id] || 0) < qtyOf(it));
    return { builtins, bLen, oldFree, oldTotal: bLen + oldFree, newLen, shortfall: bLen + oldFree - newLen, unplaced };
  }

  /* ---------------- 면적 비교 ---------------- */
  function areaRows(oldP, newP) {
    const oldRooms = validRooms(oldP), newRooms = validRooms(newP);
    const used = new Set();
    const rows = [];
    const pending = [];
    oldRooms.forEach((o, i) => {
      const n = newRooms.find((x) => !used.has(x) && norm(x.name) === norm(o.name));
      if (n) { used.add(n); rows.push({ o, n, ord: i }); } else pending.push(o);
    });
    const bySize = (a) => a.slice().sort((x, y) => area(y) - area(x));
    bySize(pending).forEach((o) => {
      const n = bySize(newRooms.filter((x) => !used.has(x) && x.kind === o.kind))[0];
      if (n) used.add(n);
      rows.push({ o, n: n || null, ord: oldRooms.indexOf(o) });
    });
    newRooms.filter((x) => !used.has(x)).forEach((n, i) => rows.push({ o: null, n, ord: 1000 + i }));
    rows.sort((a, b) => a.ord - b.ord);
    return rows;
  }
  const interior = (plan) => validRooms(plan).filter((r) => r.kind !== 'balcony').reduce((s, r) => s + area(r), 0);
  const balconyArea = (plan) => validRooms(plan).filter((r) => r.kind === 'balcony').reduce((s, r) => s + area(r), 0);

  /* ---------------- SVG 도면 그리기 ---------------- */
  let svgSeq = 0;
  const roomFill = (kind) => (kind === 'bath' || kind === 'utility' ? 'var(--plan-wet)' : kind === 'balcony' ? 'var(--plan-balc)' : 'var(--plan-floor)');
  const NS = { 'vector-effect': 'non-scaling-stroke' };

  /**
   * o = { s: px/cm, interactive, edit, grid, sel, issues:{pid:'bad'|'warn'}, items:[{p,it,r}], fontScale, compact,
   *       bg: { href, bg } 평면도 사진 · bgFade 도면 칸 흐리게 · wiz 축척 맞추기 중 · tool 치수 수정 도구 }
   */
  function buildSVG(plan, key, o) {
    const s = o.s;
    const k = (o.fontScale || 1) / s;            // 화면 px → cm
    const fz = (pxv) => pxv * k;
    const vb = o.vb || plan.vb, b = plan.bounds;
    const uid = 'fpsvg' + (++svgSeq);
    const W = Math.max(1, Math.floor(vb.w * s)), H = Math.max(1, Math.floor(vb.h * s));
    const live = !!o.interactive;
    const tool = o.edit ? (o.tool || 'room') : '';
    const root = svg('svg', {
      class: 'fp-svg' + (live ? ' is-live' : '') + (o.edit ? ' is-edit is-tool-' + tool : '') + (o.bg && o.bgFade ? ' is-bgfade' : '') + (o.wiz ? ' is-wiz' : ''),
      viewBox: [r1(vb.x), r1(vb.y), r1(vb.w), r1(vb.h)].join(' '), width: W, height: H,
      role: live || o.edit ? 'group' : 'img', 'aria-label': plan.name + ' 배치도',
    });
    const T = (x, y, str, fs, attrs) => svg('text', Object.assign({ x: r1(x), y: r1(y), 'font-size': r2(fs), 'text-anchor': 'middle', 'dominant-baseline': 'central' }, attrs || {}), str);
    const line = (x1, y1, x2, y2, attrs) => svg('line', Object.assign({ x1: r1(x1), y1: r1(y1), x2: r1(x2), y2: r1(y2) }, NS, attrs || {}));

    root.appendChild(svg('defs', svg('pattern', { id: uid + 'h', patternUnits: 'userSpaceOnUse', width: 10, height: 10, patternTransform: 'rotate(45)' },
      svg('rect', { width: 10, height: 10, fill: 'var(--bg-3)' }),
      svg('line', { x1: 2, y1: 0, x2: 2, y2: 10, stroke: 'var(--ink-3)', 'stroke-width': 2.2, 'stroke-opacity': 0.55 }))));

    // 0) 평면도 사진 (방 아래, <image> 하나)
    if (o.bg && o.bg.bg && o.bg.href) {
      const bg = o.bg.bg, d = bgDims(bg);
      root.appendChild(svg('g', { class: 'fp-bg' }, svg('image', {
        href: o.bg.href, x: 0, y: 0, width: r2(d.W), height: r2(d.H), preserveAspectRatio: 'none',
        transform: bgTransform(bg, bg.x, bg.y), opacity: r2(bg.opacity),
      })));
    }

    // 1) 바닥
    const gRooms = svg('g', { class: 'fp-rooms' });
    validRooms(plan).forEach((r) => {
      const rr = svg('rect', { class: 'fp-room' + (r.edited ? ' is-edited' : '') + (r.added ? ' is-added' : ''), 'data-rid': r.id, x: r1(r.x), y: r1(r.y), width: r1(r.w), height: r1(r.h), fill: roomFill(r.kind) },
        svg('title', r.name + ' ' + Math.round(r.w) + '×' + Math.round(r.h) + 'cm'));
      if (o.edit) { rr.setAttribute('tabindex', '0'); rr.setAttribute('role', 'button'); rr.setAttribute('aria-label', r.name + ' 고치기 (치수·이름·종류·삭제)'); }
      gRooms.appendChild(rr);
    });
    root.appendChild(gRooms);

    const deco = svg('g', { class: 'fp-deco' });
    root.appendChild(deco);
    // 2) 격자
    if (o.grid) {
      const g = svg('g', { class: 'fp-grid' });
      for (let x = Math.ceil(b.x / GRID) * GRID; x <= b.x + b.w + 0.1; x += GRID) g.appendChild(line(x, b.y, x, b.y + b.h, { stroke: 'var(--plan-grid)', 'stroke-width': x % 100 === 0 ? 2 : 1 }));
      for (let y = Math.ceil(b.y / GRID) * GRID; y <= b.y + b.h + 0.1; y += GRID) g.appendChild(line(b.x, y, b.x + b.w, y, { stroke: 'var(--plan-grid)', 'stroke-width': y % 100 === 0 ? 2 : 1 }));
      deco.appendChild(g);
    }
    // 3) 붙박이장 (빗금)
    plan.builtins.forEach((bi) => {
      const r = fxRect(bi);
      if (r.w <= 0 || r.h <= 0) return;
      deco.appendChild(svg('rect', Object.assign({ x: r.x, y: r.y, width: r.w, height: r.h, fill: 'url(#' + uid + 'h)', stroke: 'var(--ink-3)', 'stroke-width': 1 }, NS)));
      const vert = r.h > r.w * 1.4;
      const label = String(bi.name || '붙박이장') + ' ' + Math.round(Math.max(r.w, r.h)) + 'cm';
      const t = fitText(label, (vert ? r.h : r.w) - fz(4), fz(9.5), fz(7));
      if (t && t.fs < (vert ? r.w : r.h) * 0.95) {
        const cx = r.x + r.w / 2, cy = r.y + r.h / 2;
        deco.appendChild(T(cx, cy, t.text, t.fs, { 'data-fit': r1((vert ? r.h : r.w) - fz(4)), fill: 'var(--ink)', 'font-weight': 700, 'paint-order': 'stroke', stroke: 'var(--bg-3)', 'stroke-width': r2(t.fs * 0.3), 'stroke-linejoin': 'round', transform: vert ? 'rotate(-90 ' + r1(cx) + ' ' + r1(cy) + ')' : null }));
      }
    });
    // 4) 고정물
    plan.fixtures.forEach((f) => {
      const r = fxRect(f);
      if (r.w <= 0 || r.h <= 0) return;
      deco.appendChild(svg('rect', Object.assign({ x: r.x, y: r.y, width: r.w, height: r.h, rx: Math.min(4, r.w / 4, r.h / 4), fill: 'var(--bg-3)', stroke: 'var(--line-2)', 'stroke-width': 1 }, NS), svg('title', String(f.name || '고정물'))));
      const vert = r.h > r.w * 1.4;
      const t = fitText(String(f.name || ''), (vert ? r.h : r.w) - fz(2), fz(8.5), fz(7));
      if (t && t.fs < (vert ? r.w : r.h) * 1.05) {
        const cx = r.x + r.w / 2, cy = r.y + r.h / 2;
        deco.appendChild(T(cx, cy, t.text, t.fs, { 'data-fit': r1((vert ? r.h : r.w) - fz(2)), fill: 'var(--ink-3)', transform: vert ? 'rotate(-90 ' + r1(cx) + ' ' + r1(cy) + ')' : null }));
      }
    });
    // 5) 벽
    validRooms(plan).forEach((r) => {
      deco.appendChild(svg('rect', { x: r1(r.x), y: r1(r.y), width: r1(r.w), height: r1(r.h), fill: 'none', stroke: 'var(--plan-wall)', 'stroke-width': r.kind === 'balcony' ? 6 : WALL }));
    });
    // 6) 창문 (벽 위의 옅은 겹선)
    plan.windows.forEach((w) => {
      const L = Math.max(0, num(w.length, 0));
      if (!L) return;
      const x = num(w.x, 0), y = num(w.y, 0);
      const rect = w.orientation === 'v' ? { x: x - WALL / 2, y, width: WALL, height: L } : { x, y: y - WALL / 2, width: L, height: WALL };
      deco.appendChild(svg('rect', Object.assign(rect, { fill: 'var(--plan-floor)', stroke: 'var(--kid)', 'stroke-width': 1.2 }, NS)));
    });
    // 6-1) 트인 곳 (문짝 없는 개구부: 벽을 비우고 점선으로 경계만)
    plan.openings.forEach((op) => {
      const L = Math.max(0, num(op.width, 0));
      if (!L) return;
      const x = num(op.x, 0), y = num(op.y, 0), v = op.orientation === 'v';
      deco.appendChild(svg('rect', v ? { x: r1(x - WALL / 2 - 1), y: r1(y), width: WALL + 2, height: r1(L), fill: 'var(--plan-floor)' }
        : { x: r1(x), y: r1(y - WALL / 2 - 1), width: r1(L), height: WALL + 2, fill: 'var(--plan-floor)' }, svg('title', String(op.note || '트인 곳'))));
      deco.appendChild(line(x, y, v ? x : x + L, v ? y + L : y, { stroke: 'var(--ink-3)', 'stroke-width': 1, 'stroke-dasharray': '2 4', 'stroke-opacity': 0.7 }));
    });
    // 7) 문 (개구부 + 문짝 + 열림 호)
    plan.doors.forEach((d) => {
      const g = doorGeom(d);
      const [hx, hy] = g.hinge, [fx, fy] = g.free, [ox, oy] = g.open;
      const cross = (fx - hx) * (oy - hy) - (fy - hy) * (ox - hx);
      const sweep = cross > 0 ? 1 : 0;
      deco.appendChild(svg('rect', { x: r1(g.gap.x), y: r1(g.gap.y), width: r1(g.gap.w), height: r1(g.gap.h), fill: 'var(--plan-floor)' }));
      deco.appendChild(svg('path', { d: 'M' + r1(hx) + ' ' + r1(hy) + ' L' + r1(fx) + ' ' + r1(fy) + ' A' + g.w + ' ' + g.w + ' 0 0 ' + sweep + ' ' + r1(ox) + ' ' + r1(oy) + ' Z', fill: 'var(--ink)', 'fill-opacity': 0.045, stroke: 'none' }));
      deco.appendChild(svg('path', Object.assign({ d: 'M' + r1(fx) + ' ' + r1(fy) + ' A' + g.w + ' ' + g.w + ' 0 0 ' + sweep + ' ' + r1(ox) + ' ' + r1(oy), fill: 'none', stroke: 'var(--ink-3)', 'stroke-width': 1, 'stroke-dasharray': '4 3' }, NS)));
      deco.appendChild(line(hx, hy, ox, oy, { stroke: d._added ? 'var(--brand)' : 'var(--ink-2)', 'stroke-width': 2.2, 'stroke-linecap': 'round' }));
    });
    // 7-1) 전체 크기 외곽 (직접 넣었거나 치수 수정 중일 때)
    if ((plan.sizeSet || o.edit) && plan.width > 0 && plan.depth > 0) {
      deco.appendChild(svg('rect', Object.assign({ class: 'fp-outline', x: 0, y: 0, width: r1(plan.width), height: r1(plan.depth), fill: 'none',
        stroke: o.edit ? 'var(--brand)' : 'var(--ink-3)', 'stroke-width': 1.2, 'stroke-dasharray': '10 5', 'stroke-opacity': o.edit ? 0.8 : 0.6 }, NS)));
    }
    // 8) 방 이름 + 치수 + 면적
    // 방 위에 겹쳐 그린 방이 있으면 그 자리와, 먼저 놓인 다른 방 이름표를 피해서 놓음 (글자끼리 겹치지 않게)
    const vrs = validRooms(plan);
    const labelBoxes = [];
    vrs.forEach((r, ri) => {
      if (r.edited || r.added) deco.appendChild(svg('rect', Object.assign({ x: r1(r.x + 9), y: r1(r.y + 9), width: Math.max(0, r1(r.w - 18)), height: Math.max(0, r1(r.h - 18)), fill: 'none', stroke: 'var(--brand)', 'stroke-width': 1.2, 'stroke-dasharray': '6 4' }, NS)));
      if (r.w < 20 || r.h < 20) return;
      const maxW = r.w * 0.88;
      const nm = fitText(r.name, maxW, fz(12.5), fz(8));
      if (!nm) return;
      const dims = Math.round(r.w) + '×' + Math.round(r.h);
      let sub = dims + ' · ' + fmtA(area(r));
      let sfs = fz(10);
      if (textW(sub, sfs) > maxW) { sub = dims; sfs = Math.max(fz(8), Math.min(sfs, (sfs * maxW) / textW(sub, sfs))); }
      if (textW(sub, sfs) > maxW) sub = null;
      const h1 = nm.fs * 1.2, h2 = sfs * 1.2;
      if (sub && h1 + h2 > r.h * 0.9) sub = null;
      if (h1 > r.h * 0.95) return;
      // 가구와 겹치지 않는 자리를 우선 (가운데 → 위/아래 → 좌우 → 모서리)
      const lw = Math.max(nm.w, sub ? textW(sub, sfs) : 0), lh = sub ? h1 + h2 : h1;
      const pad = Math.min(6, r.w * 0.04);
      const rects = (o.items || []).map((it) => it.r).concat(plan.builtins.map(fxRect), plan.fixtures.map(fxRect).filter((fr) => fr.w >= 30 && fr.h >= 30));
      vrs.slice(ri + 1).forEach((o2) => { const i = inter(r, o2); if (i) rects.push({ x: Math.max(r.x, o2.x), y: Math.max(r.y, o2.y), w: i.w, h: i.h }); });
      let best = null;
      [[0.5, 0.5], [0.5, 0.27], [0.5, 0.73], [0.3, 0.5], [0.7, 0.5], [0.3, 0.27], [0.7, 0.27], [0.3, 0.73], [0.7, 0.73], [0.5, 0.12], [0.5, 0.88]].some(([fx, fy]) => {
        const x = MV.clamp(r.x + fx * r.w, r.x + lw / 2 + pad, r.x + r.w - lw / 2 - pad);
        const y = MV.clamp(r.y + fy * r.h, r.y + lh / 2 + pad, r.y + r.h - lh / 2 - pad);
        const box = { x: x - lw / 2, y: y - lh / 2, w: lw, h: lh };
        let ov = 0;
        rects.forEach((rr) => { const i = inter(box, rr); if (i) ov += i.w * i.h; });
        labelBoxes.forEach((rr) => { const i = inter(box, rr); if (i) ov += 4 * i.w * i.h; });
        if (!best || ov < best.ov) best = { x, y, ov };
        return ov === 0;
      });
      const cx = best ? best.x : r.x + r.w / 2, cy = best ? best.y : r.y + r.h / 2;
      const top = cy - lh / 2;
      labelBoxes.push({ x: cx - lw / 2, y: top, w: lw, h: lh });
      const halo = { 'paint-order': 'stroke', stroke: roomFill(r.kind), 'stroke-linejoin': 'round' };
      deco.appendChild(T(cx, top + h1 / 2, nm.text, nm.fs, Object.assign({ 'data-fit': r1(maxW), fill: 'var(--ink)', 'font-weight': 800, 'stroke-width': r2(nm.fs * 0.28) }, halo)));
      if (sub) deco.appendChild(T(cx, top + h1 + h2 / 2, sub, sfs, Object.assign({ 'data-fit': r1(maxW), class: 'num', fill: 'var(--ink-3)', 'font-weight': 600, 'stroke-width': r2(sfs * 0.28) }, halo)));
    });
    // 9) 치수선 · 방위 · 축척
    const front = ['top', 'bottom', 'left', 'right'].includes(plan.front) ? plan.front : null;
    const dimFs = fz(10);
    if (!o.compact) {
      // 치수선: 전체 크기를 직접 넣었으면 그 크기(외곽선)를, 아니면 그림 범위를 잼. 선 자리는 그림 범위 바깥(방과 겹치지 않게)
      const db = plan.sizeSet && plan.width > 0 && plan.depth > 0 ? { x: 0, y: 0, w: plan.width, h: plan.depth } : b;
      const dimY = front === 'top' ? b.y + b.h + MARGIN * 0.3 : b.y - MARGIN * 0.3;
      const tY = front === 'top' ? dimY + dimFs * 0.9 : dimY - dimFs * 0.9;
      const tick = fz(4);
      deco.appendChild(line(db.x, dimY, db.x + db.w, dimY, { stroke: 'var(--ink-3)', 'stroke-width': 1 }));
      deco.appendChild(line(db.x, dimY - tick, db.x, dimY + tick, { stroke: 'var(--ink-3)', 'stroke-width': 1 }));
      deco.appendChild(line(db.x + db.w, dimY - tick, db.x + db.w, dimY + tick, { stroke: 'var(--ink-3)', 'stroke-width': 1 }));
      deco.appendChild(T(db.x + db.w / 2, tY, Math.round(db.w) + 'cm', dimFs, { fill: 'var(--ink-2)', 'font-weight': 600, class: 'num' }));
      const dimX = front === 'left' ? b.x + b.w + MARGIN * 0.3 : b.x - MARGIN * 0.3;
      const tX = front === 'left' ? dimX + dimFs * 0.9 : dimX - dimFs * 0.9;
      deco.appendChild(line(dimX, db.y, dimX, db.y + db.h, { stroke: 'var(--ink-3)', 'stroke-width': 1 }));
      deco.appendChild(line(dimX - tick, db.y, dimX + tick, db.y, { stroke: 'var(--ink-3)', 'stroke-width': 1 }));
      deco.appendChild(line(dimX - tick, db.y + db.h, dimX + tick, db.y + db.h, { stroke: 'var(--ink-3)', 'stroke-width': 1 }));
      const cyy = db.y + db.h / 2;
      deco.appendChild(T(tX, cyy, Math.round(db.h) + 'cm', dimFs, { fill: 'var(--ink-2)', 'font-weight': 600, class: 'num', transform: 'rotate(-90 ' + r1(tX) + ' ' + r1(cyy) + ')' }));
    }
    if (front) {
      const fs = fz(11);
      const label = '☀ 남쪽(전면)';
      let x, y, rot = null;
      if (front === 'bottom') { x = b.x + b.w / 2; y = b.y + b.h + MARGIN * 0.5; }
      else if (front === 'top') { x = b.x + b.w / 2; y = b.y - MARGIN * 0.5; }
      else if (front === 'left') { x = b.x - MARGIN * 0.5; y = b.y + b.h / 2; rot = -90; }
      else { x = b.x + b.w + MARGIN * 0.5; y = b.y + b.h / 2; rot = 90; }
      deco.appendChild(T(x, y, label, fs, { fill: 'var(--brand)', 'font-weight': 800, transform: rot ? 'rotate(' + rot + ' ' + r1(x) + ' ' + r1(y) + ')' : null }));
    }
    {
      const sbY = front === 'top' ? b.y + b.h + MARGIN * 0.55 : b.y + b.h + MARGIN * 0.5;
      const sx = b.x;
      const tk = fz(4);
      deco.appendChild(line(sx, sbY, sx + 100, sbY, { stroke: 'var(--ink-2)', 'stroke-width': 2 }));
      deco.appendChild(line(sx, sbY - tk, sx, sbY + tk, { stroke: 'var(--ink-2)', 'stroke-width': 1.5 }));
      deco.appendChild(line(sx + 100, sbY - tk, sx + 100, sbY + tk, { stroke: 'var(--ink-2)', 'stroke-width': 1.5 }));
      deco.appendChild(T(sx + 100 + fz(5), sbY, '1m', fz(10), { fill: 'var(--ink-2)', 'font-weight': 700, 'text-anchor': 'start' }));
    }

    // 10) 가구·가전
    const gItems = svg('g', { class: 'fp-items' });
    (o.items || []).forEach(({ p, it, r }) => {
      const color = CAT_COLOR[it.cat] || 'var(--ink-3)';
      const issue = o.issues && o.issues[p.id];
      const isSel = o.sel === p.id;
      const fate = fateOf(it);
      const g = svg('g', {
        class: 'fp-item' + (isSel ? ' is-sel' : '') + (issue ? ' is-' + issue : '') + ' is-' + fate,
        'data-pid': p.id, transform: 'translate(' + r1(r.x) + ' ' + r1(r.y) + ')',
        tabindex: live ? '0' : null, role: live ? 'button' : null,
        'aria-label': live ? it.name + ' ' + Math.round(r.w) + '×' + Math.round(r.h) + 'cm' + (issue === 'bad' ? ' (문제 있음)' : issue === 'warn' ? ' (주의)' : '') : null,
      });
      g.appendChild(svg('title', it.name + ' · ' + Math.round(num(it.w, 0)) + '×' + Math.round(num(it.d, 0)) + '×' + Math.round(num(it.h, 0)) + 'cm · ' + MV.inv.fate(fate).label));
      if (live) {
        const hw = Math.max(r.w, 26 / s), hh = Math.max(r.h, 26 / s);
        g.appendChild(svg('rect', { class: 'fp-hit', x: r1((r.w - hw) / 2), y: r1((r.h - hh) / 2), width: r1(hw), height: r1(hh), fill: 'transparent' }));
      }
      g.appendChild(svg('rect', Object.assign({
        class: 'fp-body', width: r1(r.w), height: r1(r.h), rx: r1(Math.min(6, r.w / 5, r.h / 5)),
        fill: color, 'fill-opacity': fate === 'buy' ? 0.13 : fate === 'discard' || fate === 'sell' ? 0.1 : 0.24,
        stroke: color, 'stroke-width': 1.6,
        'stroke-dasharray': fate === 'buy' ? '6 4' : fate === 'discard' || fate === 'sell' ? '2 3' : null,
      }, NS)));
      if (isSel) {
        const off = fz(3);
        g.appendChild(svg('rect', Object.assign({ class: 'fp-selring', x: r1(-off), y: r1(-off), width: r1(r.w + off * 2), height: r1(r.h + off * 2), rx: r1(Math.min(8, r.w / 4)), fill: 'none', stroke: 'var(--brand)', 'stroke-width': 1.6, 'stroke-dasharray': '5 3' }, NS)));
      }
      // 이름표
      const pad = fz(3);
      let nm = fitText(it.name, r.w - pad * 2, fz(11), fz(8));
      let vert = false;
      if ((!nm || (nm.text.endsWith('…') && Array.from(nm.text).length <= 4)) && r.h > r.w * 1.3) {
        const v = fitText(it.name, r.h - pad * 2, fz(11), fz(8));
        if (v && v.fs * 1.1 <= r.w) { nm = v; vert = true; }
      }
      if (nm && nm.fs * 1.35 > (vert ? r.w : r.h)) nm = null;
      if (nm) {
        const dimT = Math.round(num(it.w, 0)) + '×' + Math.round(num(it.d, 0));
        const dfs = fz(9.5);
        const showDim = !vert && (isSel || (r.h >= (nm.fs + dfs) * 1.35 && textW(dimT, dfs) <= r.w - pad * 2)) && r.h >= (nm.fs + dfs) * 1.2 && textW(dimT, dfs) <= r.w;
        const cx = r.w / 2, cy = r.h / 2;
        const fitW = r1(Math.max(1, (vert ? r.h : r.w) - pad * 2));
        if (vert) {
          g.appendChild(T(cx, cy, nm.text, nm.fs, { 'data-fit': fitW, fill: 'var(--ink)', 'font-weight': 700, transform: 'rotate(-90 ' + r1(cx) + ' ' + r1(cy) + ')' }));
        } else if (showDim) {
          const tot = nm.fs * 1.15 + dfs * 1.15;
          g.appendChild(T(cx, cy - tot / 2 + nm.fs * 0.575, nm.text, nm.fs, { 'data-fit': fitW, fill: 'var(--ink)', 'font-weight': 700 }));
          g.appendChild(T(cx, cy + tot / 2 - dfs * 0.575, dimT, dfs, { 'data-fit': r1(r.w), fill: 'var(--ink-2)', class: 'num' }));
        } else {
          g.appendChild(T(cx, cy, nm.text, nm.fs, { 'data-fit': fitW, fill: 'var(--ink)', 'font-weight': 700 }));
        }
      }
      gItems.appendChild(g);
    });
    root.appendChild(gItems);

    // 11) 문 삭제 도구: 누를 수 있는 문 자리 (열림 범위 + 벽 틈)
    if (tool === 'doorDel') {
      const gd = svg('g', { class: 'fp-doorhits' });
      // 손가락으로 누르기 쉽게 화면에서 44px 이상인 투명한 칸을 먼저 깔고 (겹치면 누른 곳에서 가장 가까운 문을 고름), 그 위에 보이는 칸
      const minS = DOOR_TAP / s;
      plan.doors.forEach((d) => {
        const p = doorPad(d, minS);
        gd.appendChild(svg('rect', { class: 'fp-doorpad', 'data-door': d._key, x: r1(p.x), y: r1(p.y), width: r1(p.w), height: r1(p.h), fill: 'transparent' }));
      });
      plan.doors.forEach((d) => {
        const bx = doorBox(d);
        gd.appendChild(svg('rect', Object.assign({ class: 'fp-doorhit', 'data-door': d._key, x: r1(bx.x), y: r1(bx.y), width: r1(bx.w), height: r1(bx.h), rx: 4,
          tabindex: '0', role: 'button', 'aria-label': (d.note ? String(d.note).split(/[.(]/)[0] : '문') + ' 지우기' }, NS), svg('title', String(d.note || '문'))));
      });
      root.appendChild(gd);
    }
    return root;
  }

  /* ---------------- PNG 저장 ---------------- */
  function downloadBlob(blob, name) {
    const url = URL.createObjectURL(blob);
    const a = el('a', { href: url, download: name });
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 1500);
  }
  function inlineStyles(src, dst) {
    const a = [src].concat(Array.from(src.querySelectorAll('*')));
    const b = [dst].concat(Array.from(dst.querySelectorAll('*')));
    a.forEach((n, i) => {
      const d = b[i];
      if (!d || !d.style) return;
      const cs = getComputedStyle(n);
      EXPORT_PROPS.forEach((p) => { const v = cs.getPropertyValue(p); if (v) d.style.setProperty(p, v); });
    });
  }
  function exportPlanPNG(plan, key, o) {
    return new Promise((resolve, reject) => {
      const vb = viewBoxFor(plan, o.items);
      const scale = MV.clamp(2400 / vb.w, 1.2, 3);
      const node = buildSVG(plan, key, { s: scale, vb, interactive: false, edit: false, grid: o.grid, sel: null, issues: o.issues, items: o.items, fontScale: 1.9 });
      const holder = el('div', { 'aria-hidden': 'true', style: { position: 'fixed', left: '-30000px', top: '0', pointerEvents: 'none' } }, node);
      document.body.appendChild(holder);
      let xml;
      try {
        const clone = node.cloneNode(true);
        inlineStyles(node, clone);
        // 그림(img)으로 그릴 때는 글꼴·굵기 대체가 달라 글자가 넓어질 수 있음 → 화면에서 잰 폭(상자 폭 이하)으로 고정
        const srcT = node.querySelectorAll('text'), dstT = clone.querySelectorAll('text');
        srcT.forEach((t, i) => {
          const d = dstT[i];
          if (!d) return;
          let L = 0;
          try { L = t.getComputedTextLength(); } catch (e) { L = 0; }
          const fit = parseFloat(t.getAttribute('data-fit'));
          if (isFinite(fit) && fit > 0) L = L > 0 ? Math.min(L, fit) : 0;
          if (L > 0) { d.setAttribute('textLength', r2(L)); d.setAttribute('lengthAdjust', 'spacingAndGlyphs'); }
          d.removeAttribute('data-fit');
        });
        clone.setAttributeNS('http://www.w3.org/XML/1998/namespace', 'xml:lang', 'ko');
        xml = new XMLSerializer().serializeToString(clone);
      } catch (e) { holder.remove(); reject(e); return; }
      holder.remove();
      const W = +node.getAttribute('width'), H = +node.getAttribute('height');
      const rs = getComputedStyle(document.documentElement);
      const tok = (n, d) => (rs.getPropertyValue(n) || '').trim() || d;
      const font = getComputedStyle(document.body).fontFamily || 'sans-serif';
      const img = new Image();
      img.onload = () => {
        try {
          const head = 96;
          const c = document.createElement('canvas');
          c.width = W; c.height = H + head;
          const g = c.getContext('2d');
          g.fillStyle = tok('--bg-2', '#ffffff'); g.fillRect(0, 0, c.width, c.height);
          g.fillStyle = tok('--ink', '#21201d'); g.font = '800 34px ' + font; g.textBaseline = 'alphabetic';
          g.fillText(plan.name, 40, 52);
          g.fillStyle = tok('--ink-3', '#78726a'); g.font = '600 20px ' + font;
          g.fillText('우리집 이사 · 공간설계 · ' + MV.date.fmtLong(MV.date.today()) + (o.grid ? ' · 격자 50cm' : '') + (plan.edited ? ' · 실측 반영' : ''), 40, 82);
          g.drawImage(img, 0, head, W, H);
          c.toBlob((blob) => {
            if (!blob) { reject(new Error('이미지 변환 실패')); return; }
            downloadBlob(blob, 'move-plan-' + key + '-' + MV.date.today().replace(/-/g, '') + '.png');
            resolve();
          }, 'image/png');
        } catch (e) { reject(e); }
      };
      img.onerror = () => reject(new Error('도면을 그림으로 바꾸지 못했어요'));
      img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(xml);
    });
  }

  /* ---------------- 스타일 ---------------- */
  MV.css('fp', `
.fp-tabs { width: fit-content; max-width: 100%; margin-bottom: 12px; }
.fp-tabs button { min-height: 36px; }
.fp-headrow { display: flex; flex-wrap: wrap; gap: 8px 14px; align-items: center; margin-bottom: 10px; }
.fp-headrow > .fp-tabs, .fp-headrow > .fp-tb { margin-bottom: 0; }
.fp-tb { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; margin-bottom: 10px; }
@media (max-height: 860px) and (min-width: 1000px) {
  .fp-vh { margin-bottom: 10px; }
  .fp-vh .sub { display: none; }
}
.fp-tb .fp-grp { display: inline-flex; align-items: center; gap: 2px; background: var(--bg-3); border-radius: 12px; padding: 2px; }
.fp-tb .fp-grp .btn { border-color: transparent; background: transparent; }
.fp-tb .fp-grp .btn:hover { background: var(--bg-2); }
.fp-b { min-height: 36px; padding: 0 11px; font-size: .86rem; }
.fp-b.btn-icon { width: 36px; padding: 0; }
.fp-b[aria-pressed="true"] { background: var(--brand-bg); border-color: color-mix(in srgb, var(--brand) 45%, var(--line)); color: var(--brand); }
.fp-zoomv { min-width: 3.4em; text-align: center; font-size: .78rem; font-weight: 700; color: var(--ink-3); font-variant-numeric: tabular-nums; }
.fp-wrap { display: grid; gap: 12px; grid-template-columns: minmax(0, 1fr); grid-template-areas: "main" "side" "more"; }
.fp-main { grid-area: main; min-width: 0; }
.fp-side { grid-area: side; min-width: 0; }
.fp-more { grid-area: more; min-width: 0; }
@media (min-width: 1100px) {
  .fp-wrap { grid-template-columns: minmax(0, 1fr) 340px; grid-template-areas: "main side" "more side"; align-items: start; }
  .fp-side { position: sticky; top: calc(var(--topbar-h) + 12px); max-height: calc(100vh - var(--topbar-h) - 24px); overflow: auto; }
}
.fp-plan { padding: 10px; }
.fp-chips { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; margin: 0 2px 8px; }
.fp-chips .fp-title { font-weight: 800; font-size: .95rem; margin-right: 2px; }
.fp-editbar { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin: 0 0 8px; font-size: .88rem; }
.fp-editbar .spacer { flex: 1; }
.fp-scroll { overflow: auto; max-height: calc(100vh - 150px); -webkit-overflow-scrolling: touch; border-radius: var(--radius-sm); touch-action: pan-x pan-y; }
.fp-stage { position: relative; margin: 0 auto; }
.fp-svg { display: block; user-select: none; -webkit-user-select: none; -webkit-touch-callout: none; font-family: var(--font); }
.fp-svg text, .fp-svg .fp-deco { pointer-events: none; }
.fp-svg.is-live .fp-item { cursor: grab; touch-action: none; }
.fp-svg.is-dragging, .fp-svg.is-dragging .fp-item { cursor: grabbing; }
.fp-svg .fp-item:focus { outline: none; }
.fp-svg .fp-item.is-sel .fp-body { stroke-width: 2.6px; fill-opacity: .34; }
.fp-svg .fp-item.is-warn .fp-body { stroke: var(--warn); stroke-width: 2.6px; }
.fp-svg .fp-item.is-bad .fp-body { stroke: var(--bad); stroke-width: 2.8px; }
.fp-svg .fp-item:focus-visible .fp-body { stroke: var(--brand); stroke-width: 3.2px; }
.fp-svg.is-dragging .fp-item.is-sel { opacity: .85; }
.fp-svg.is-edit .fp-room { cursor: pointer; }
.fp-svg.is-edit .fp-room:hover, .fp-svg.is-edit .fp-room:focus { fill: var(--brand-bg); outline: none; }
.fp-svg.is-edit .fp-items { opacity: .3; pointer-events: none; }
.fp-selbar { position: absolute; z-index: 5; display: flex; flex-direction: column; gap: 4px; padding: 6px; background: var(--bg-2); color: var(--ink); border: 1px solid var(--line-2); border-radius: 12px; box-shadow: var(--shadow-lg); width: max-content; max-width: min(360px, 100%); }
.fp-selinfo { font-size: .8rem; padding: 0 4px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.fp-selinfo strong { margin-right: 4px; }
.fp-selbtns { display: flex; gap: 4px; flex-wrap: wrap; }
.fp-selbtns .btn { min-height: 36px; padding: 0 10px; font-size: .84rem; gap: 4px; }
@media (max-width: 600px) {
  .fp-selbar { padding: 4px; gap: 2px; border-radius: 10px; max-width: 182px; }
  .fp-selinfo { font-size: .72rem; padding: 0 2px; }
  .fp-selinfo strong { display: block; overflow: hidden; text-overflow: ellipsis; }
  .fp-selbtns { flex-wrap: nowrap; gap: 3px; }
  .fp-selbtns .btn { padding: 0; width: 38px; min-width: 38px; font-size: 1rem; }
  .fp-selbtns .btn .fp-bl { display: none; }
}
.fp-legend { display: flex; flex-wrap: wrap; gap: 4px 14px; font-size: .75rem; color: var(--ink-3); margin: 8px 4px 0; align-items: center; }
.fp-legend span { display: inline-flex; align-items: center; gap: 5px; }
.fp-legend svg { width: 22px; height: 12px; flex: none; }
.fp-hint { font-size: .75rem; color: var(--ink-3); margin: 4px 4px 0; }
.fp-card-head { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-bottom: 8px; }
.fp-card-head h2 { margin: 0; font-size: 1.08rem; }
.fp-card-head .spacer { flex: 1; }
.fp-side-actions { display: flex; gap: 6px; flex-wrap: wrap; margin: 4px 0 10px; }
.fp-side-actions .btn { flex: 1 1 auto; }
.fp-filter { margin-bottom: 8px; width: fit-content; max-width: 100%; }
.fp-filter button { min-height: 36px; padding: 4px 12px; }
.fp-group + .fp-group { margin-top: 12px; }
.fp-group-h { display: flex; align-items: center; gap: 6px; font-size: .8rem; font-weight: 800; color: var(--ink-2); padding: 4px 0; border-bottom: 1px solid var(--line); }
.fp-dot { width: 11px; height: 11px; border-radius: 3px; display: inline-block; flex: none; border: 1.5px solid; }
.fp-row { display: grid; grid-template-columns: 1.5em minmax(0, 1fr) auto auto; gap: 6px; align-items: center; padding: 7px 0; border-bottom: 1px dashed var(--line); }
.fp-row:last-child { border-bottom: 0; }
.fp-row-ico { text-align: center; }
.fp-row-name { font-weight: 650; font-size: .9rem; line-height: 1.35; display: block; overflow-wrap: anywhere; }
.fp-link { background: none; border: 0; padding: 0; color: inherit; font: inherit; cursor: pointer; text-align: left; text-decoration: underline dotted; text-underline-offset: 3px; }
.fp-row-name.fp-link { padding: 9px 0; margin: -9px 0; min-height: 36px; }
.toast.fp-toast { width: max-content; max-width: min(520px, calc(100vw - 32px)); border-radius: 18px; }
.toast.fp-toast > span { min-width: 0; line-height: 1.4; }
.toast.fp-toast > button { flex: none; white-space: nowrap; min-height: 32px; padding: 0 2px; }
.fp-cmp-tbl td:first-child { word-break: keep-all; overflow-wrap: anywhere; min-width: 6.5em; }
.fp-link:hover { color: var(--brand); }
.fp-row-meta { display: flex; gap: 4px; flex-wrap: wrap; align-items: center; margin-top: 3px; }
.fp-row-meta .chip { font-size: .7rem; padding: 0 7px; }
.fp-row-count { font-size: .8rem; font-weight: 800; color: var(--ink-3); font-variant-numeric: tabular-nums; }
.fp-row.is-done .fp-row-count { color: var(--good); }
.fp-row-count.is-over { color: var(--bad); }
.fp-row-btns { display: flex; gap: 4px; }
.fp-row-btns .btn { min-height: 36px; }
.fp-row-btns .btn-icon { width: 36px; }
.fp-msgs { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 5px; }
.fp-msgrow { display: flex; gap: 6px; align-items: stretch; }
.fp-msgrow .fp-msg { flex: 1 1 auto; min-width: 0; }
.fp-fix { flex: none; min-height: 36px; white-space: nowrap; align-self: center; }
.fp-msg { width: 100%; display: flex; gap: 8px; align-items: flex-start; text-align: left; background: var(--bg); border: 1px solid var(--line); border-radius: 10px; padding: 7px 10px; font: inherit; font-size: .87rem; color: var(--ink); cursor: pointer; min-height: 36px; line-height: 1.45; }
.fp-msg.is-bad { border-color: color-mix(in srgb, var(--bad) 40%, var(--line)); background: var(--bad-bg); }
.fp-msg.is-warn { border-color: color-mix(in srgb, var(--warn) 40%, var(--line)); background: var(--warn-bg); }
.fp-msg:hover { filter: brightness(.98); }
.fp-wd { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; margin: 8px 0; }
.fp-wd > div { background: var(--bg); border: 1px solid var(--line); border-radius: 10px; padding: 8px 10px; font-size: .85rem; min-width: 0; }
.fp-wd .fp-wd-h { font-size: .75rem; color: var(--ink-3); font-weight: 700; }
.fp-wd .fp-wd-n { font-weight: 700; overflow-wrap: anywhere; }
.fp-verdicts { list-style: none; margin: 8px 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
.fp-verdict { display: grid; grid-template-columns: 1.6em minmax(0, 1fr); gap: 4px 6px; padding: 8px 10px; border-radius: 10px; background: var(--bg); border: 1px solid var(--line); font-size: .87rem; line-height: 1.45; }
.fp-verdict.is-ok { background: var(--good-bg); border-color: color-mix(in srgb, var(--good) 30%, var(--line)); }
.fp-verdict.is-warn { background: var(--warn-bg); border-color: color-mix(in srgb, var(--warn) 35%, var(--line)); }
.fp-verdict.is-bad { background: var(--bad-bg); border-color: color-mix(in srgb, var(--bad) 35%, var(--line)); }
.fp-verdict .fp-vd { color: var(--ink-2); font-size: .82rem; }
.fp-sugg { margin: 6px 0 0; padding-left: 1.2em; font-size: .85rem; }
.fp-sugg li + li { margin-top: 2px; }
.fp-roomsel { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
.fp-roomsel .select { width: auto; flex: 1 1 200px; min-width: 0; }
.fp-details > summary { cursor: pointer; list-style: none; display: flex; align-items: center; gap: 8px; flex-wrap: wrap; min-height: 36px; }
.fp-details > summary::-webkit-details-marker { display: none; }
.fp-details > summary::before { content: '▸'; color: var(--ink-3); transition: transform .15s; }
.fp-details[open] > summary::before { transform: rotate(90deg); }
.fp-details h3 { font-size: .92rem; margin: 14px 0 4px; }
.fp-details ul { margin: 0; padding-left: 1.2em; font-size: .88rem; }
.fp-details li + li { margin-top: 2px; }
.fp-kv { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 2px 12px; font-size: .86rem; margin: 6px 0 0; }
.fp-kv dt { color: var(--ink-3); }
.fp-kv dd { margin: 0; overflow-wrap: anywhere; }
.fp-cmp-plans { display: grid; gap: 14px; grid-template-columns: repeat(2, minmax(0, 1fr)); align-items: start; }
@media (max-width: 700px) { .fp-cmp-plans { grid-template-columns: 1fr; } }
.fp-cmp-cell { min-width: 0; }
.fp-cmp-cell h3 { margin: 0 0 2px; font-size: 1rem; }
.fp-cmp-svg { margin-top: 6px; overflow: hidden; }
.fp-cmp-grid { display: grid; gap: 12px; grid-template-columns: repeat(2, minmax(0, 1fr)); margin-top: 12px; align-items: start; }
.fp-cmp-grid > .card { margin-top: 0; }
@media (max-width: 900px) { .fp-cmp-grid { grid-template-columns: 1fr; } }
.fp-up { color: var(--good); font-weight: 700; }
.fp-down { color: var(--bad); font-weight: 700; }
.fp-bars { display: flex; flex-direction: column; gap: 10px; margin: 10px 0; }
.fp-barrow { display: grid; grid-template-columns: 4.6em minmax(0, 1fr) auto; gap: 8px; align-items: center; font-size: .86rem; }
.fp-bar { height: 14px; border-radius: 999px; background: var(--bg-3); overflow: hidden; }
.fp-bar > i { display: block; height: 100%; border-radius: inherit; background: var(--kid); }
.fp-bar.is-new > i { background: var(--brand); }
.fp-miss { list-style: none; margin: 0; padding: 0; }
.fp-miss li { display: flex; align-items: center; gap: 8px; padding: 7px 0; border-bottom: 1px dashed var(--line); flex-wrap: wrap; }
.fp-miss li:last-child { border-bottom: 0; }
.fp-miss .fp-mname { flex: 1 1 160px; min-width: 0; font-weight: 650; }
.fp-area-prev { font-size: .9rem; margin-top: 10px; padding: 8px 10px; border-radius: 10px; background: var(--bg-3); }
.fp-area-prev.is-bad { background: var(--bad-bg); color: var(--ink); border: 1px solid color-mix(in srgb, var(--bad) 35%, var(--line)); }
.fp-prev-warn { margin-top: 6px; font-size: .84rem; color: var(--ink-2); display: flex; flex-direction: column; gap: 2px; }
@media (max-width: 860px) {
  .fp-scroll { max-height: calc(100vh - var(--bottom-h) - 150px); }
}
/* ---- 평면도 사진 · 축척 맞추기 · 방 그리기 ---- */
.fp-svg .fp-bg, .fp-svg .fp-bg image { pointer-events: none; }
:root[data-theme="dark"] .fp-svg .fp-bg image { filter: invert(1) hue-rotate(180deg); }
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) .fp-svg .fp-bg image { filter: invert(1) hue-rotate(180deg); } }
.fp-svg.is-bgfade .fp-room { fill-opacity: .16; }
.fp-svg.is-bgfade .fp-deco { opacity: .82; }
.fp-svg.is-bgfade.is-edit .fp-room:hover, .fp-svg.is-bgfade.is-edit .fp-room:focus { fill-opacity: .4; }
.fp-svg.is-wiz { cursor: crosshair; }
.fp-svg.is-wiz .fp-room { fill-opacity: .07; pointer-events: none; }
.fp-svg.is-wiz .fp-deco { opacity: .45; }
.fp-svg.is-wiz .fp-items { opacity: .2; pointer-events: none; }
.fp-svg.is-tool-draw { cursor: crosshair; }
.fp-svg.is-tool-draw .fp-room, .fp-svg.is-tool-doorDel .fp-room { pointer-events: none; }
.fp-svg.is-tool-doorAdd .fp-room { cursor: copy; }
.fp-svg .fp-doorhit { fill: var(--bad); fill-opacity: .1; stroke: var(--bad); stroke-width: 1.4; stroke-dasharray: 4 3; cursor: pointer; }
.fp-svg .fp-doorhit:hover, .fp-svg .fp-doorhit:focus { fill-opacity: .28; outline: none; }
.fp-svg .fp-wizpt { cursor: grab; touch-action: none; }
.fp-stage.is-capture, .fp-stage.is-capture .fp-svg { touch-action: none; }
.fp-stage.is-move .fp-svg { cursor: move; }
.fp-bgbar { display: flex; flex-direction: column; gap: 8px; margin: 0 0 8px; padding: 6px 10px; border: 1px solid var(--line); border-radius: 12px; background: var(--bg); font-size: .86rem; }
.fp-bgrow { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; min-width: 0; }
.fp-bgrow > .fp-bglabel { font-weight: 800; margin-right: 2px; }
.fp-bgdesc { flex: 1 1 120px; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.fp-bgclose { margin-left: auto; }
.fp-bgbody { display: flex; flex-direction: column; gap: 8px; padding-top: 8px; border-top: 1px dashed var(--line); }
.fp-bgmore { gap: 2px; }
.fp-bgrow .spacer { flex: 1; }
.fp-range { display: flex; align-items: center; gap: 8px; flex: 1 1 220px; min-width: 0; font-size: .8rem; color: var(--ink-2); font-weight: 700; }
.fp-range input[type=range] { flex: 1 1 auto; min-width: 90px; height: 36px; accent-color: var(--brand); margin: 0; }
.fp-range output { min-width: 2.8em; text-align: right; font-variant-numeric: tabular-nums; }
.fp-help { flex: 0 1 auto; min-width: 0; }
.fp-help[open] { flex: 1 1 100%; }
.fp-help > summary { cursor: pointer; list-style: none; display: inline-flex; align-items: center; gap: 6px; min-height: 36px; padding: 0 6px; border-radius: 10px; font-weight: 700; font-size: .84rem; color: var(--ink-2); }
.fp-help > summary:hover { background: var(--bg-3); }
.fp-help > summary::-webkit-details-marker { display: none; }
.fp-help > summary::before { content: '▸'; color: var(--ink-3); transition: transform .15s; }
.fp-help[open] > summary::before { transform: rotate(90deg); }
.fp-help ol { margin: 4px 0 2px; padding-left: 1.3em; font-size: .84rem; line-height: 1.5; }
.fp-help li + li { margin-top: 4px; }
.fp-wizbar { position: sticky; top: calc(var(--topbar-h) + 6px); z-index: 6; margin: 0 0 8px; box-shadow: var(--shadow); display: flex; flex-direction: column; gap: 6px; font-size: .88rem; }
.fp-wizbar .fp-wizt { font-weight: 800; }
.fp-wizbar .fp-wizd { font-size: .8rem; color: var(--ink-2); line-height: 1.45; }
.fp-wizrow { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
.fp-wizrow .spacer { flex: 1; }
.fp-lenin { display: flex; gap: 6px; align-items: center; flex: 1 1 200px; min-width: 0; }
.fp-ws { display: none; }
.fp-lenin .input { flex: 1 1 120px; min-width: 0; text-align: right; }
.fp-lenin .select { flex: 0 0 auto; width: auto; }
.fp-lenout { font-size: .8rem; font-weight: 700; color: var(--ink-2); }
.fp-lenout.is-bad { color: var(--bad); }
.fp-lenalt { display: flex; flex-wrap: wrap; gap: 4px 6px; align-items: center; margin-top: 4px; font-weight: 600; }
.fp-lenalt .btn { min-height: 36px; padding: 0 10px; font-size: .8rem; }
.fp-lenwarn { margin-top: 4px; color: var(--ink); background: var(--warn-bg); border-radius: 8px; padding: 4px 8px; }
.fp-wizhelpbtn { display: none; }
.fp-nudge { display: inline-flex; gap: 2px; }
.fp-nudge .btn { width: 38px; padding: 0; }
.fp-tools { display: inline-flex; flex-wrap: wrap; gap: 2px; background: var(--bg-2); border: 1px solid var(--line); border-radius: 12px; padding: 2px; }
.fp-tools .btn { border-color: transparent; background: transparent; min-height: 36px; padding: 0 10px; font-size: .84rem; }
.fp-tools .btn[aria-pressed="true"] { background: var(--brand); color: var(--on-brand); }
.fp-editrow { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; width: 100%; }
.fp-edittip { flex: 1 1 220px; min-width: 0; font-size: .82rem; color: var(--ink-2); }
.fp-kindsel { display: flex; flex-wrap: wrap; gap: 4px; }
.fp-kindsel button { min-height: 36px; padding: 0 10px; border-radius: 999px; border: 1px solid var(--line-2); background: var(--bg-2); color: var(--ink); font: inherit; font-size: .84rem; font-weight: 650; cursor: pointer; }
.fp-kindsel button[aria-pressed="true"] { background: var(--brand-bg); border-color: var(--brand); color: var(--brand); }
.fp-del-list { list-style: none; margin: 4px 0 0; padding: 0; }
.fp-del-list li { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; padding: 4px 0; font-size: .88rem; }
@media (max-width: 600px) {
  .fp-bgbar { padding: 6px 8px; }
  .fp-bgdesc { display: none; }
  .fp-tools { width: 100%; display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .fp-tools .btn { padding: 0 6px; }
  .fp-bgscale { display: none; }
  .fp-wizbar { top: calc(var(--topbar-h) + 4px); padding: 8px 10px; }
  /* 폰: 안내 띠를 낮게 (설명은 '설명 보기'로), 길이를 넣는 2단계는 띠가 따라오지 않게 (자판과 함께 찍은 점을 가리지 않게) */
  .fp-wizhelpbtn { display: inline-flex; }
  .fp-wizrow { gap: 4px; }
  .fp-wizrow > .btn { padding: 0 8px; }
  .fp-wizbar:not(.is-help) .fp-wizhelp { display: none; }
  .fp-wizbar.is-typing { position: static; }
  /* 폰: 짧은 글자로 바꿔 단추 줄이 한 줄에 들어가게 */
  .fp-wl { display: none; }
  .fp-ws { display: inline; }
  .fp-lenin { flex-basis: 150px; }
}
`);

  /* ---------------- 공용 조각 ---------------- */
  /** 이 화면의 알림은 쌓지 않고 바꿔 끼움 (여러 번 눌러도 알림이 화면을 덮지 않도록) */
  let lastToast = null;
  function toast(msg, o) {
    if (lastToast && lastToast.isConnected) lastToast.remove();
    lastToast = MV.ui.toast(msg, o);
    // 폰에서 알림 폭이 화면 절반으로 줄어 '보기' 단추가 한 글자씩 꺾이지 않도록 (fp-toast 스타일)
    if (lastToast && lastToast.classList) lastToast.classList.add('fp-toast');
    return lastToast;
  }
  const btn = (label, onClick, o) => el('button', Object.assign({ type: 'button', class: 'btn fp-b', onclick: onClick }, o || {}), label);
  const verdictIcon = (lv) => (lv === 'ok' ? '✅' : lv === 'warn' ? '⚠️' : lv === 'bad' ? '❌' : '📏');
  function confidenceChip(plan) {
    const c = plan.confidence;
    if (c === 'high') return el('span', { class: 'chip good', title: '자료 신뢰도 높음' }, '도면 확인됨');
    return el('span', { class: 'chip warn', title: c === 'medium' ? '자료 신뢰도 보통 — 실측으로 확인하세요' : '자료 신뢰도 낮음 — 실측으로 확인하세요' }, '추정 도면' + (c === 'medium' ? ' (보통)' : ''));
  }
  function legend() {
    const sw = (dash, op) => svg('svg', { viewBox: '0 0 22 12', 'aria-hidden': 'true' },
      svg('rect', { x: 1, y: 1, width: 20, height: 10, rx: 2, fill: 'var(--kid)', 'fill-opacity': op, stroke: 'var(--kid)', 'stroke-width': 1.4, 'stroke-dasharray': dash || null }));
    return el('div', { class: 'fp-legend' },
      el('span', sw(null, 0.24), '가져감'),
      el('span', sw('4 2.5', 0.13), '새로 구매'),
      el('span', sw('1.5 2', 0.1), '버림·판매'),
      el('span', el('span', { class: 'fp-dot', style: { borderColor: 'var(--bad)', background: 'var(--bad-bg)' } }), '문제'),
      el('span', el('span', { class: 'fp-dot', style: { borderColor: 'var(--warn)', background: 'var(--warn-bg)' } }), '주의'),
      el('span', '1칸 = 50cm'));
  }
  function emptyCard(msg) {
    return el('div', { class: 'card empty' }, el('span', { class: 'big', 'aria-hidden': 'true' }, '📐'), msg);
  }

  /* ============================================================
     편집 화면 (#/plan/new · #/plan/old)
     ============================================================ */
  function renderEditor(root, key, ctx, headRow) {
    let sel = null;           // 선택된 배치 id
    let editMode = false;     // ✏️ 치수 수정
    let drag = null;
    let pinch = null;         // 두 손가락 확대·축소
    let pending = false;
    let lastUp = 0;
    let cur = null;           // { plan, inv, items, v, s, vb }
    let svgEl = null;
    let lastW = 0;
    let lastPtr = null;       // 마지막 마우스 위치 (키보드 단축키가 도면 위에서만 동작하도록)
    let tool = 'room';        // 치수 수정 도구: room 방 고치기 · draw 방 그리기 · doorAdd 문 추가 · doorDel 문 삭제
    let wiz = null;           // 평면도 사진 맞추기: { step: 'pts'|'origin'|'move', pts: [{x,y}], snap, onlyMove }
    let gest = null;          // 사진 끌기·점 옮기기·방 그리기 중인 손가락/마우스
    let preview = null;       // 방 그리기: 그린 네모 (창이 열려 있는 동안 보여 줌)
    let helpOpen = false;     // '사진으로 도면 고치는 법' 펼침
    let toolsOpen = null;     // 평면도 사진 도구 펼침 (null = 축척을 안 맞췄으면 펼침)

    // ---- 뼈대 ----
    const zoomV = el('span', { class: 'fp-zoomv', 'aria-live': 'polite' }, '100%');
    const bGrid = btn('▦ 격자', () => { setPref('grid', !prefs().grid); refresh(); }, { 'aria-pressed': 'true', title: '50cm 격자 보이기' });
    const bSnap = btn('🧲 스냅 5cm', () => { setPref('snap', !prefs().snap); syncToolbar(); }, { 'aria-pressed': 'true', title: '끌 때 5cm 단위·벽에 맞춤' });
    const bEdit = btn('✏️ 치수 수정', () => {
      if (wiz) finishWiz(true);
      editMode = !editMode; sel = null; tool = 'room'; preview = null;
      syncStageMode(); refresh();
    }, { 'aria-pressed': 'false', title: '방 치수 고치기 · 방 그리기/삭제 · 문 추가/삭제 · 전체 크기' });
    const bExport = btn('⬇ 이미지 저장', () => doExport(), { title: 'PNG 그림으로 저장' });
    const bBg = btn('🖼 평면도 사진', () => { setPref('bgPanel', !prefs().bgPanel); drawBgBar(true); syncToolbar(); if (prefs().bgPanel) revealEl(bgBar); },
      { 'aria-pressed': 'true', title: '진짜 평면도 사진을 깔고 축척 맞추기' });
    const tb = el('div', { class: 'fp-tb', role: 'toolbar', 'aria-label': '도면 도구' },
      el('div', { class: 'fp-grp' },
        btn('−', () => setZoom(curZoom() / 1.25), { class: 'btn fp-b btn-icon', 'aria-label': '축소' }),
        btn('맞춤', () => setZoom(1), { title: '화면에 맞추기' }),
        btn('+', () => setZoom(curZoom() * 1.25), { class: 'btn fp-b btn-icon', 'aria-label': '확대' }),
        zoomV),
      bGrid, bSnap, bEdit, bBg, bExport);
    if (headRow) headRow.appendChild(tb);
    const chips = el('div', { class: 'fp-chips' });
    const bgBar = el('div', { class: 'fp-bgbar', role: 'region', 'aria-label': PLAN_LABEL[key] + ' 평면도 사진' });
    const wizBar = el('div', { class: 'callout fp-wizbar', hidden: true, role: 'region', 'aria-label': '평면도 사진 맞추기 안내' });
    const editBar = el('div', { class: 'callout fp-editbar', hidden: true });
    const fileIn = el('input', { type: 'file', accept: 'image/*', class: 'fp-bgfile', hidden: true, 'aria-label': '평면도 사진 파일 고르기' });
    fileIn.addEventListener('change', () => { const f = fileIn.files && fileIn.files[0]; fileIn.value = ''; if (f) loadBgFile(f); });
    const stage = el('div', { class: 'fp-stage' });
    const selBar = el('div', { class: 'fp-selbar', hidden: true, role: 'toolbar', 'aria-label': '선택한 짐' });
    stage.appendChild(selBar);
    const scroll = el('div', { class: 'fp-scroll' }, stage);
    const mm = (qq) => !!(window.matchMedia && window.matchMedia(qq).matches);
    const coarse = mm('(pointer: coarse)') || (navigator.maxTouchPoints > 0 && !mm('(hover: hover)'));
    const hint = el('p', { class: 'fp-hint' }, coarse
      ? '짐을 손가락으로 끌어 옮기고, 톡 누르면 돌리기·빼기 메뉴가 나와요. 빈 곳을 끌면 화면이 움직이고, 두 손가락으로 벌리면 도면이 커져요.'
      : '짐을 끌어서 옮기고, 눌러서 선택하면 돌리기·빼기를 할 수 있어요. 키보드(도면 위에서): 방향키 1cm(Shift 10cm) · R 회전 · Delete 빼기 · Esc 해제 · Ctrl+휠 확대');
    const planCard = el('section', { class: 'card fp-plan', 'aria-label': PLAN_LABEL[key] + ' 도면' }, chips, bgBar, wizBar, editBar, scroll, legend(), hint, fileIn);
    const side = el('aside', { class: 'card fp-side', 'aria-label': '배치할 짐 목록' });
    const checks = el('section', { class: 'card fp-checks', 'aria-label': '배치 점검' });
    const laundry = key === 'new' ? el('section', { class: 'card fp-laundry', 'aria-label': '다용도실 세탁기·건조기 점검' }) : null;
    const info = el('section', { class: 'card fp-info' });
    root.appendChild(el('div', { class: 'fp-wrap' },
      el('div', { class: 'fp-main' }, headRow ? null : tb, planCard), side, el('div', { class: 'fp-more' }, checks, laundry, info)));

    const curZoom = () => MV.clamp(num(prefs().zoom[key], 1), 0.5, 5);
    const curSel = () => (sel && cur ? cur.items.find((o) => o.p.id === sel) : null) || null;
    // 입력이 바뀐 카드만 다시 그리기 (짐을 끌 때마다 목록·점검 카드를 새로 만들지 않도록)
    const sigs = {};
    const changed = (k, val) => { const sg = JSON.stringify(val); if (sigs[k] === sg) return false; sigs[k] = sg; return true; };
    let selRaf = 0;
    ctx.onCleanup(() => cancelAnimationFrame(selRaf));

    // ---- 다시 그리기 ----
    function refresh() {
      if (drag || pinch || gest) { pending = true; return; }
      pending = false;
      const plan = getPlan(key);
      if (!plan) return;
      const inv = invMap();
      const items = pls(key).map((p) => ({ p, it: inv.get(p.invId) })).filter((o) => o.it);
      items.forEach((o) => { o.r = rectOf(o.p, o.it); });
      if (sel && !items.some((o) => o.p.id === sel)) sel = null;
      cur = { plan, inv, items, v: validate(plan, key, inv), bg: bgOf(key) };
      // 다른 창에서 사진을 지웠으면 맞추기 안내를 닫음
      if (wiz && !cur.bg) { wiz = null; drawWizBar(); syncStageMode(); }
      [drawPlan, drawChips, syncToolbar, () => drawBgBar(false), () => drawSide(false), drawChecks, () => drawLaundry(false), () => drawInfo(false)]
        .forEach((fn) => { try { fn(); } catch (e) { console.error('[plan]', e); } });
    }
    function drawPlan() {
      const { plan, items, v } = cur;
      if (!lastW) lastW = scroll.clientWidth;
      const cw = lastW || planCard.clientWidth || 340;
      // 도면 창의 CSS 최대 높이와 맞춰야 100%(맞춤)에서 창 안쪽 스크롤이 생기지 않음 (생기면 첫 손가락 쓸기가 페이지 대신 도면 창을 굴림)
      const cssMax = parseFloat(getComputedStyle(scroll).maxHeight);
      const maxH = Math.max(300, Math.min(window.innerHeight - 190, isFinite(cssMax) ? cssMax - 2 : Infinity));
      const bg = bgOf(key);
      const showBg = !!bg && bg.show;
      // 사진 전체가 보여야 할 때(맞추는 중·치수 수정 중·아직 축척을 안 맞춤)만 사진 외곽까지 그림 범위를 넓힘
      const vb = viewBoxFor(plan, items, showBg && (editMode || wiz || !bg.calibrated || !bg.aligned) ? bgBox(bg) : null);
      const fitS = Math.max(0.08, Math.min(cw / vb.w, maxH / vb.h));
      const s = fitS * curZoom();
      const ae = document.activeElement;
      const focusPid = ae && svgEl && svgEl.contains(ae) && ae.getAttribute && ae.getAttribute('data-pid');
      const focusRid = ae && svgEl && svgEl.contains(ae) && ae.getAttribute && ae.getAttribute('data-rid');
      const focusBtn = ae && selBar.contains(ae) && ae.getAttribute && ae.getAttribute('data-act');
      const node = buildSVG(plan, key, { s, vb, interactive: !editMode && !wiz, edit: editMode && !wiz, tool, grid: prefs().grid, sel, issues: v.lv, items,
        bg: showBg ? { bg, href: bgHref(key, bg.src) } : null, bgFade: showBg && bg.fade, wiz: !!wiz });
      if (svgEl && svgEl.parentNode === stage) stage.replaceChild(node, svgEl); else stage.insertBefore(node, stage.firstChild);
      svgEl = node;
      const W = +node.getAttribute('width'), H = +node.getAttribute('height');
      cur.s = Math.min(W / vb.w, H / vb.h);
      cur.vb = vb;
      stage.style.width = W + 'px';
      stage.style.height = H + 'px';
      if (focusPid) { const g = node.querySelector('[data-pid="' + CSS.escape(focusPid) + '"]'); if (g) g.focus({ preventScroll: true }); }
      if (focusRid) { const g = node.querySelector('[data-rid="' + CSS.escape(focusRid) + '"]'); if (g) g.focus({ preventScroll: true }); }
      drawOverlay();
      drawSelBar();
      // 선택 도구 단추를 누른 뒤 다시 그려져도 키보드 초점이 사라지지 않게
      if (focusBtn) {
        const b2 = selBar.querySelector('[data-act="' + focusBtn + '"]');
        const g = sel && node.querySelector('[data-pid="' + CSS.escape(sel) + '"]');
        if (b2 && !selBar.hidden) b2.focus({ preventScroll: true }); else if (g) g.focus({ preventScroll: true });
      }
    }
    function drawSelBar() {
      const o = curSel();
      if (!o || editMode || wiz || !cur) { selBar.hidden = true; selBar.textContent = ''; return; }
      const { plan, s } = cur;
      const room = roomAt(plan, o.r.x + o.r.w / 2, o.r.y + o.r.h / 2);
      const out = !within(o.r, plan.bounds, 1);
      const sb = (act, ico, label, onclick, o2) => el('button', Object.assign({ type: 'button', class: 'btn', 'data-act': act, onclick, 'aria-label': label }, o2 || {}),
        el('span', { 'aria-hidden': 'true' }, ico), el('span', { class: 'fp-bl', 'aria-hidden': 'true' }, ' ' + ((o2 && o2.short) || label)));
      selBar.textContent = '';
      put(selBar,
        el('div', { class: 'fp-selinfo' }, el('strong', shortName(o.it.name, 20)),
          el('span', { class: 'muted num' }, Math.round(o.r.w) + '×' + Math.round(o.r.h) + 'cm' + (out ? ' · 도면 밖' : room ? ' · ' + room.name : ' · 방 밖'))),
        el('div', { class: 'fp-selbtns' },
          out ? sb('in', '↩', '도면 안으로', () => fixPlacement(o.p.id, 'in'), { class: 'btn btn-primary', short: '안으로', title: '도면 안으로 가져오기' }) : null,
          sb('rot', '↻', '90도 돌리기', rotateSel, { short: '90°', title: '90° 돌리기 (R)' }),
          sb('spec', '✎', '규격 수정', () => editSpec(o.it.id), { short: '규격', title: '가로·깊이·높이 고치기' }),
          sb('del', '🗑', '도면에서 빼기', removeSel, { class: 'btn btn-danger', short: '빼기', title: '도면에서 빼기 (Delete)' }),
          el('button', { type: 'button', class: 'btn btn-ghost btn-icon', 'data-act': 'close', onclick: () => { sel = null; refresh(); }, 'aria-label': '선택 해제' }, '✕')));
      selBar.hidden = false;
      selBar.style.opacity = '0';   // 자리 잡기 전 한 프레임 숨김 (visibility 와 달리 초점은 받을 수 있음)
      const vb = cur.vb || plan.vb;
      const x0 = (o.r.x - vb.x) * s, y0 = (o.r.y - vb.y) * s, w0 = o.r.w * s, h0 = o.r.h * s;
      const pid = o.p.id;
      // 크기 측정은 다음 프레임에 한 번만 (강제 레이아웃 방지)
      cancelAnimationFrame(selRaf);
      selRaf = requestAnimationFrame(() => {
        if (selBar.hidden || sel !== pid) return;
        const bw = selBar.offsetWidth, bh = selBar.offsetHeight;
        const sw = stage.offsetWidth, sh = stage.offsetHeight;
        let top = y0 - bh - 8;
        if (top < 0) top = y0 + h0 + 8;
        if (top + bh > sh) top = Math.max(0, y0 - bh - 8);
        const left = MV.clamp(x0 + w0 / 2 - bw / 2, 0, Math.max(0, sw - bw));
        selBar.style.left = Math.round(left) + 'px';
        selBar.style.top = Math.round(top) + 'px';
        selBar.style.opacity = '';
      });
    }
    function drawChips() {
      const { plan, items, v } = cur;
      chips.textContent = '';
      put(chips, 
        el('span', { class: 'fp-title', title: plan.name }, plan.short || PLAN_LABEL[key]),
        plan.exclusive_m2 ? el('span', { class: 'chip' }, '전용 ' + plan.exclusive_m2 + '㎡') : null,
        plan.floor ? el('span', { class: 'chip' }, plan.floor + '층') : null,
        confidenceChip(plan),
        plan.edited ? el('span', { class: 'chip brand', title: editSummary(plan) || '실측으로 고친 곳이 있어요' }, '📏 실측 반영됨') : null,
        cur.bg ? (() => {
          const ok = cur.bg.calibrated && cur.bg.aligned;
          return el('span', { class: 'chip ' + (ok ? 'good' : 'warn'), title: ok ? '평면도 사진 축척·위치를 맞췄어요' : cur.bg.calibrated ? '축척은 맞췄고, 도면 왼쪽 위 모서리(위치)를 아직 안 맞췄어요' : '평면도 사진 축척을 아직 안 맞췄어요' },
            '🖼 사진' + (ok ? ' · 축척 맞춤' : cur.bg.calibrated ? ' · 위치 미확인' : ' · 축척 미확인'));
        })() : null,
        el('span', { class: 'chip kid' }, '놓은 짐 ' + items.length + '개'),
        v.bad ? el('span', { class: 'chip bad' }, '문제 ' + v.bad) : null,
        v.warn ? el('span', { class: 'chip warn' }, '주의 ' + v.warn) : null);
      drawEditBar();
    }
    const TOOL_TIPS = {
      room: '방을 누르면 치수·이름·종류를 고치거나 방을 지울 수 있어요.',
      draw: '도면 위를 끌어서 새 방을 네모로 그리세요 (5cm 단위, 옆 방 벽에 붙어요). 그리는 동안엔 손가락으로 도면이 움직이지 않아요.',
      doorAdd: '문을 달 방의 벽(가장자리) 가까이를 누르세요 — 90cm 문이 그 방 안쪽으로 열리게 달려요.',
      doorDel: '지울 문(빨간 점선 칸)을 누르세요.',
    };
    function drawEditBar() {
      // 사진 맞추기 중엔 안내 띠만 (도구를 눌러도 도면 누르기는 맞추기가 받으므로 헷갈리지 않게 숨김)
      editBar.hidden = !editMode || !!wiz;
      if (!editMode || wiz) { editBar.textContent = ''; return; }
      const plan = cur.plan;
      // 도구 단추에 초점이 있었으면 다시 그린 뒤에도 같은 단추에
      const ae = document.activeElement;
      const fTool = ae && editBar.contains(ae) && ae.getAttribute && ae.getAttribute('data-tool');
      editBar.textContent = '';
      const T = (id, label) => el('button', { type: 'button', class: 'btn fp-b', 'data-tool': id, 'aria-pressed': String(tool === id), onclick: () => setTool(id) }, label);
      put(editBar,
        el('div', { class: 'fp-editrow' },
          el('div', { class: 'fp-tools', role: 'group', 'aria-label': '치수 수정 도구' },
            T('room', '✏️ 방 고치기'), T('draw', '＋ 방 그리기'), T('doorAdd', '🚪 문 추가'), T('doorDel', '🚪 문 삭제')),
          el('button', { type: 'button', class: 'btn btn-sm fp-b', 'data-tool': 'size', onclick: openSizeEditor, title: '도면 전체 가로·세로 (cm)' }, '📐 전체 크기 ' + Math.round(plan.width) + '×' + Math.round(plan.depth))),
        el('div', { class: 'fp-editrow' },
          el('div', { class: 'fp-edittip', 'aria-live': 'polite' }, TOOL_TIPS[tool] + ' 짐은 잠시 잠겨요.'),
          plan.edited ? el('button', { type: 'button', class: 'btn btn-sm btn-danger fp-b', onclick: resetAllRooms }, '도면 전체 원래대로') : null,
          el('button', { type: 'button', class: 'btn btn-sm btn-primary fp-b', onclick: () => { editMode = false; tool = 'room'; preview = null; syncStageMode(); refresh(); } }, '완료')));
      if (fTool) { const b = editBar.querySelector('[data-tool="' + fTool + '"]'); if (b) b.focus({ preventScroll: true }); }
    }
    function setTool(id) {
      tool = id;
      preview = null;
      syncStageMode();
      refresh();
    }
    /** 끌어서 그리기·사진 옮기기 중에는 손가락이 도면을 굴리지 않게 (그 밖엔 평소처럼 쓸어서 화면 이동) */
    function syncStageMode() {
      stage.classList.toggle('is-capture', !!((editMode && !wiz && tool === 'draw') || (wiz && wiz.step === 'move')));
      stage.classList.toggle('is-move', !!(wiz && wiz.step === 'move'));
    }
    function syncToolbar() {
      const p = prefs();
      bGrid.setAttribute('aria-pressed', String(!!p.grid));
      bSnap.setAttribute('aria-pressed', String(!!p.snap));
      bEdit.setAttribute('aria-pressed', String(editMode));
      bBg.setAttribute('aria-pressed', String(!!p.bgPanel));
      zoomV.textContent = Math.round(curZoom() * 100) + '%';
    }
    /** 요소가 화면 밖(위 막대·아래 메뉴 뒤 포함)이면 부드럽게 보이는 곳으로 — 아래가 잘렸으면 위끝이 가려지지 않는 만큼만 올림 */
    function revealEl(node) {
      requestAnimationFrame(() => {
        if (!node || !node.isConnected || node.hidden) return;
        const r = node.getBoundingClientRect();
        const top = pxv('--topbar-h', 56) + 8, bot = window.innerHeight - pxv('--bottom-h', 0) - 8;
        let dy = 0;
        if (r.top < top || r.top > bot - 60) dy = r.top - top - 8;
        else if (r.bottom > bot) dy = Math.min(r.bottom - bot + 8, r.top - top - 8);
        if (Math.abs(dy) > 1) window.scrollBy({ top: dy, behavior: 'smooth' });
      });
    }

    /* ---- 평면도 사진 ---- */
    function setBg(patch, log) {
      MV.store.update((st) => { const b = bgsOf(st)[key]; if (b && typeof b === 'object') Object.assign(b, patch); }, { log });
    }
    function helpDetails() {
      const d = el('details', { class: 'fp-help' },
        el('summary', '📖 사진으로 도면 고치는 법'),
        el('ol',
          el('li', el('strong', '사진 준비 — '), '네이버 부동산 앱 › 단지정보 › 평면도를 캡처하거나, 관리사무소 종이 도면을 위에서 반듯하게 찍어요. 도면 부분만 남게 잘라(크롭) 두면 더 정확하고 가벼워요.'),
          el('li', el('strong', '📷 사진 고르기 — '), '발코니(남쪽)가 아래로 오도록 “↻ 90°”로 돌려요.'),
          el('li', el('strong', '📏 축척 맞추기 — '), '길이를 아는 두 점(전체 가로 양 끝, 또는 “3,300”처럼 치수가 적힌 선의 양 끝)을 누르고 실제 길이를 넣은 뒤, 도면 왼쪽 위 모서리를 눌러 위치를 맞춰요.'),
          el('li', el('strong', '✏️ 치수 수정 — '), '사진 선을 따라 방을 눌러 고치고, “＋ 방 그리기”·방 삭제·“🚪 문 추가/삭제”·“📐 전체 크기”로 맞춰요. 사전방문 때 줄자로 잰 숫자로 마무리하면 끝!')));
      d.open = helpOpen;
      d.addEventListener('toggle', () => { helpOpen = d.open; });
      return d;
    }
    function drawBgBar(force) {
      const bg = cur.bg;
      const open = prefs().bgPanel;
      // 사진 도구 펼침: 직접 펼치거나 접기 전까지는 '축척을 아직 안 맞췄으면 펼침'
      const toolsOn = bg ? (toolsOpen == null ? !bg.calibrated || !bg.aligned : toolsOpen) : false;
      const sg = [open, !!bg, bg ? [bg.show, bg.fade, bg.rot, bg.calibrated, bg.aligned, Math.round(bg.cmPerPx * 1e4), bg.natW, bg.natH, bg.src.length] : null, !!wiz, toolsOn];
      if (!changed('bgbar', sg) && !force) { syncOpacity(); return; }
      // 맞추는 동안엔 안내 띠가 대신하므로 사진 도구는 접어 둠
      bgBar.hidden = !open || !!wiz;
      bgBar.textContent = '';
      if (!open || wiz) return;
      if (!bg) {
        put(bgBar,
          el('div', { class: 'fp-bgrow' },
            el('span', { class: 'fp-bglabel' }, '🖼 평면도 사진'),
            el('span', { class: 'small muted fp-bgdesc', title: '진짜 평면도를 캡처해서 깔면, 그 위에서 방·문을 맞춰 도면을 고칠 수 있어요' }, '진짜 평면도를 깔고 그 위에서 도면 고치기'),
            btn('📷 사진 고르기', () => fileIn.click(), { class: 'btn fp-b btn-primary' }),
            helpDetails(),
            btn('✕', () => { setPref('bgPanel', false); drawBgBar(true); syncToolbar(); try { bBg.focus({ preventScroll: true }); } catch (e) { /* 무시 */ } },
              { class: 'btn fp-b btn-ghost btn-icon fp-bgclose', 'aria-label': '평면도 사진 줄 닫기', title: '닫기 — 위의 “🖼 평면도 사진” 단추로 다시 열어요' })));
        return;
      }
      const range = el('input', { type: 'range', min: '15', max: '100', step: '5', value: String(Math.round(bg.opacity * 100)), 'aria-label': '사진 진하기', class: 'fp-opacity' });
      const out = el('output', Math.round(bg.opacity * 100) + '%');
      range.addEventListener('input', () => {
        const v = MV.clamp(+range.value / 100, 0.15, 1);
        out.textContent = Math.round(v * 100) + '%';
        const im = svgEl && svgEl.querySelector('.fp-bg image');
        if (im) im.setAttribute('opacity', r2(v));
        MV.store.update((st) => { const b = bgsOf(st)[key]; if (b) b.opacity = v; }, { silent: true });
      });
      const tg = (label, on, onClick, title) => btn(label, onClick, { 'aria-pressed': String(!!on), title });
      const bodyId = 'fpbgtools-' + key;
      // 축척만 맞추고 3단계(위치)를 못 끝냈으면 (다른 탭으로 갔다 오는 등) 이어서 하도록 안내
      const needPos = bg.calibrated && !bg.aligned;
      put(bgBar,
        el('div', { class: 'fp-bgrow' },
          el('span', { class: 'fp-bglabel' }, '🖼 평면도 사진'),
          el('span', { class: 'chip ' + (bg.calibrated && !needPos ? 'good' : 'warn') }, !bg.calibrated ? '축척을 맞춰 주세요' : needPos ? '위치를 맞춰 주세요' : '축척 맞춤 ✓'),
          bg.calibrated ? el('span', { class: 'tiny muted num fp-bgscale' }, '1px ≈ ' + (Math.round(bg.cmPerPx * 100) / 100) + 'cm') : null,
          needPos ? btn('📍 위치 맞추기', () => startWiz('origin'), { class: 'btn fp-b btn-primary', 'data-act': 'origin', title: '축척은 맞췄어요 — 사진에서 도면 왼쪽 위 모서리를 눌러 위치를 맞춰요 (3/3)' }) : null,
          el('span', { class: 'spacer' }),
          tg('👁 보이기', bg.show, () => setBg({ show: !bg.show }), '사진 보이기/숨기기'),
          el('button', { type: 'button', class: 'btn fp-b fp-bgmore', 'aria-expanded': String(toolsOn), 'aria-controls': bodyId, 'data-act': 'tools',
            onclick: () => { toolsOpen = !toolsOn; drawBgBar(true); const b2 = bgBar.querySelector('[data-act="tools"]'); if (b2) b2.focus({ preventScroll: true }); } },
          '사진 도구 ', el('span', { 'aria-hidden': 'true' }, toolsOn ? '▴' : '▾'))),
        toolsOn ? el('div', { class: 'fp-bgbody', id: bodyId },
          el('div', { class: 'fp-bgrow' },
            el('label', { class: 'fp-range' }, el('span', '진하기'), range, out),
            tg('▤ 도면 칸 흐리게', bg.fade, () => setBg({ fade: !bg.fade }), '방 칸을 옅게 해서 사진 선이 보이게')),
          el('div', { class: 'fp-bgrow' },
            btn('📏 축척 맞추기', () => startWiz('pts'), { class: 'btn fp-b' + (bg.calibrated ? '' : ' btn-primary'), title: '두 점과 실제 길이로 사진 크기 맞추기 → 위치 맞추기' }),
            btn('✋ 위치 옮기기', () => startWiz('move'), { title: '사진을 끌어서 도면 선에 맞추기' }),
            btn('↻ 90°', rotateBg, { 'aria-label': '사진 90도 돌리기', title: '사진 90도 돌리기' }),
            btn('사진 바꾸기', () => fileIn.click()),
            btn('🗑 사진 지우기', deleteBg, { class: 'btn fp-b btn-danger' }),
            helpDetails())) : null);
    }
    function syncOpacity() {
      const r = bgBar.querySelector('.fp-opacity');
      if (!r || !cur.bg || document.activeElement === r) return;
      const v = String(Math.round(cur.bg.opacity * 100));
      if (r.value !== v) { r.value = v; const o = r.parentNode.querySelector('output'); if (o) o.textContent = v + '%'; }
    }
    const loadImg = (file) => new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const im = new Image();
      im.onload = () => { URL.revokeObjectURL(url); resolve(im); };
      im.onerror = () => { URL.revokeObjectURL(url); reject(new Error('decode')); };
      im.src = url;
    });
    /** 긴 변 maxSide 이하로 줄여 JPEG data URL 로 (투명한 곳은 흰색) */
    function encodeImg(im, maxSide, quality) {
      try {
        const w0 = im.naturalWidth || im.width, h0 = im.naturalHeight || im.height;
        if (!(w0 > 0 && h0 > 0)) return null;
        const k = Math.min(1, maxSide / Math.max(w0, h0));
        const w = Math.max(1, Math.round(w0 * k)), h = Math.max(1, Math.round(h0 * k));
        const c = document.createElement('canvas');
        c.width = w; c.height = h;
        const g = c.getContext('2d');
        g.fillStyle = '#ffffff'; g.fillRect(0, 0, w, h);
        g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high';
        g.drawImage(im, 0, 0, w, h);
        const src = c.toDataURL('image/jpeg', quality);
        return /^data:image\/jpeg/.test(src) ? { src, natW: w, natH: h } : null;
      } catch (e) { return null; }
    }
    /** 저장 공간에 들어가는지 먼저 써 보고 넣음 → 'ok' | 'nostore'(저장소 못 씀: 이 창에서만) | 'quota'(자리 없음: 넣지 않음) */
    function saveBg(entry, log) {
      const st = MV.store.get();
      if (MV.store.storageOK) {
        try {
          const next = Object.assign({}, st, { planBg: Object.assign({}, bgsOf(st), { [key]: entry }), meta: Object.assign({}, st.meta, { updatedAt: MV.nowISO() }) });
          window.localStorage.setItem(STATE_KEY, JSON.stringify(next));
        } catch (e) { return 'quota'; }
      }
      MV.store.update((s) => { bgsOf(s)[key] = entry; }, { log });
      return MV.store.storageOK ? 'ok' : 'nostore';
    }
    const kb = (n) => (n >= 1024 * 1024 ? (Math.round(n / 1024 / 1024 * 10) / 10) + 'MB' : Math.round(n / 1024) + 'KB');
    async function loadBgFile(file) {
      if (file.type && !/^image\//.test(file.type)) { toast('사진(이미지) 파일을 골라 주세요'); return; }
      toast('사진을 줄이는 중…');
      let im;
      try { im = await loadImg(file); } catch (e) {
        toast('이 사진은 열 수 없어요. 화면 캡처(PNG·JPG)로 다시 골라 주세요', { ms: 5000 });
        return;
      }
      if (!root.isConnected) return;
      const prev = bgOf(key);
      const plan = getPlan(key);
      const b = plan ? plan.bounds : { x: 0, y: 0, w: 700, h: 1000 };
      const tries = [[BG_MAX_SIDE, BG_QUALITY], [1280, 0.7], [1024, 0.6], [800, 0.55]];
      let first = null, used = null, res = 'quota';
      for (const [side, qy] of tries) {
        const e = encodeImg(im, side, qy);
        if (!e) continue;
        if (!first) first = e;
        // 처음엔 사진 가로를 도면 가로에 맞춰 깔아 둠 (축척 맞추기 전 대략)
        const entry = { src: e.src, natW: e.natW, natH: e.natH, cmPerPx: b.w / e.natW, x: r1(b.x), y: r1(b.y), rot: 0,
          opacity: prev ? prev.opacity : 0.5, show: true, fade: prev ? prev.fade : true, calibrated: false, aligned: false };
        res = saveBg(entry, '🖼 ' + PLAN_LABEL[key] + ' 평면도 사진 ' + (prev ? '바꿈' : '올림') + ' (' + e.natW + '×' + e.natH + 'px, ' + kb(e.src.length) + ')');
        if (res !== 'quota') { used = e; break; }
      }
      if (!first) { toast('사진을 줄이지 못했어요. 다른 사진(캡처)으로 해 보세요', { ms: 5000 }); return; }
      if (!used) {
        toast('저장 공간이 모자라 사진을 넣지 못했어요. 도면 부분만 잘라서(크롭) 다시 올리거나, 다른 집 사진을 지운 뒤 해 보세요', { ms: 7000 });
        return;
      }
      if (!prefs().bgPanel) setPref('bgPanel', true);
      const notes = [];
      if (first.src.length > BG_WARN_BYTES) notes.push('사진이 ' + kb(first.src.length) + '로 커요 — 도면 부분만 잘라서(크롭) 올리면 저장이 가벼워져요');
      if (used !== first) notes.push('저장 공간이 빠듯해 사진을 ' + used.natW + '×' + used.natH + 'px로 더 줄였어요');
      if (res === 'nostore') notes.push('이 브라우저는 저장이 안 돼서 창을 닫으면 사진이 사라져요');
      startWiz('pts');
      // 다음 할 일은 안내 띠가 알려 주므로, 알림은 주의할 점이 있을 때만 (도면 위를 가리지 않게)
      if (lastToast && lastToast.isConnected) lastToast.remove();
      if (notes.length) toast('사진을 깔았어요. ' + notes.join(' · '), { ms: 7000 });
    }
    function rotateBg() {
      const bg = bgOf(key);
      if (!bg) return;
      const box = bgBox(bg);
      const nb = Object.assign({}, bg, { rot: (bg.rot + 90) % 360 });
      const d = bgDims(nb);
      // 축척을 맞춘 사진을 돌리면 도면과 어긋나므로 위치를 다시 맞추도록 (축척은 그대로)
      setBg(Object.assign({ rot: nb.rot, x: r1(box.x + box.w / 2 - d.bw / 2), y: r1(box.y + box.h / 2 - d.bh / 2) }, bg.calibrated ? { aligned: false } : {}),
        '🖼 ' + PLAN_LABEL[key] + ' 평면도 사진 90° 돌림');
      if (bg.calibrated) toast('사진을 돌렸어요 — 도면 왼쪽 위 모서리를 눌러 위치를 다시 맞춰 주세요', { action: { label: '위치 맞추기', onClick: () => startWiz('origin') }, ms: 5000 });
    }
    function deleteBg() {
      MV.ui.confirm(PLAN_LABEL[key] + ' 평면도 사진을 지울까요? 고친 도면(방·문·크기)은 그대로 남아요.', { danger: true, okLabel: '사진 지우기', title: '사진 지우기' }).then((ok) => {
        if (!ok) return;
        wiz = null;
        MV.store.update((st) => { bgsOf(st)[key] = null; }, { log: '🖼 ' + PLAN_LABEL[key] + ' 평면도 사진 지움' });
        drawWizBar(); syncStageMode();
        toast('사진을 지웠어요');
      });
    }

    /* ---- 축척 맞추기 · 위치 옮기기 ---- */
    const GEO = ['cmPerPx', 'x', 'y', 'rot', 'calibrated', 'aligned', 'show'];
    function startWiz(step) {
      const bg = bgOf(key);
      if (!bg) { toast('먼저 평면도 사진을 골라 주세요'); return; }
      sel = null;
      const raw = bgsOf(MV.store.get())[key];
      const snap = {};
      GEO.forEach((k2) => { snap[k2] = raw[k2]; });
      wiz = { step, pts: [], snap, onlyMove: step === 'move' };
      if (!bg.show) setBg({ show: true });
      drawWizBar(); syncStageMode(); refresh();
      revealEl(wizBar);
    }
    function setWizStep(step) {
      if (!wiz) return;
      wiz.step = step; wiz.pts = [];
      drawWizBar(); syncStageMode(); refresh();
    }
    /** 취소: 맞추기 전으로 되돌림 */
    function cancelWiz() {
      if (!wiz) return;
      const w = wiz;
      wiz = null;
      const b = bgsOf(MV.store.get())[key];
      const changedGeo = b && GEO.some((k2) => b[k2] !== w.snap[k2]);
      drawWizBar(); syncStageMode();
      if (changedGeo) setBg(Object.assign({}, w.snap)); else refresh();
      toast('사진 맞추기를 취소했어요');
    }
    /** 맞추기 끝. quiet = 다른 일(치수 수정 등)로 넘어가며 조용히 닫음 → 위치를 못 맞췄으면 '위치 맞추기' 안내가 남음 */
    function finishWiz(quiet) {
      if (!wiz) return;
      const w = wiz;
      wiz = null;
      drawWizBar(); syncStageMode();
      // 3단계에서 '건너뛰기'·끌어서 맞춘 뒤 '완료'를 누르면 위치도 맞춘 것으로
      const b = !quiet && bgOf(key);
      if (b && b.calibrated && !b.aligned) setBg({ aligned: true }); else refresh();
      if (quiet) return;
      if (w.onlyMove) { toast('사진 위치를 옮겼어요'); return; }
      toast('사진 축척·위치를 맞췄어요 — 이제 사진 선을 따라 방을 고쳐 보세요', { action: editMode ? null : { label: '✏️ 치수 수정', onClick: () => { editMode = true; tool = 'room'; sel = null; syncStageMode(); refresh(); } }, ms: 6000 });
    }
    function wizDist() {
      if (!wiz || wiz.pts.length < 2) return 0;
      const [a, b] = wiz.pts;
      return Math.hypot(b.x - a.x, b.y - a.y);
    }
    /** 폰 2단계: 제자리에 있는 안내 띠가 보이게 하되, 찍은 두 점이 아래 메뉴 뒤로 숨으면 띠가 화면 위에 남는 만큼 더 올림 */
    function revealWizLen() {
      requestAnimationFrame(() => {
        if (!wiz || wiz.step !== 'pts' || wiz.pts.length < 2 || wizBar.hidden || !svgEl || !svgEl.isConnected) return;
        const top = pxv('--topbar-h', 56) + 6, bot = window.innerHeight - pxv('--bottom-h', 0) - 8;
        const br = wizBar.getBoundingClientRect();
        const m = svgEl.getScreenCTM();
        let dy = 0;
        if (br.top < top) dy = br.top - top;
        else if (br.bottom > bot) dy = Math.min(br.bottom - bot + 8, br.top - top);
        if (m && dy >= 0) {
          const low = Math.max(...wiz.pts.map((p) => p.x * m.b + p.y * m.d + m.f));
          if (low + 30 > bot) dy = Math.max(dy, Math.min(low + 30 - bot, br.top - top));
        }
        if (Math.abs(dy) > 1) window.scrollBy({ top: dy, behavior: 'smooth' });
      });
    }
    /** 점을 옮기거나 되돌린 뒤 안내 띠의 '약 ○○cm'·단위 풀이를 지금 점에 맞춤 */
    function syncWizDist() {
      if (!wiz) return;
      if (wiz.distEl) wiz.distEl.textContent = Math.round(wizDist()) + 'cm';
      if (wiz.lenOut) updLen();
    }
    function drawWizBar() {
      wizBar.hidden = !wiz;
      wizBar.textContent = '';
      if (!wiz) { wizBar.className = 'callout fp-wizbar'; return; }
      const typing = wiz.step === 'pts' && wiz.pts.length >= 2;
      // 폰: 설명은 '설명 보기'로 접어 두고(띠가 낮아져 사진을 덜 가림), 길이를 넣는 2단계는 띠가 따라오지 않게(자판과 함께 도면을 덮지 않게)
      wizBar.className = 'callout fp-wizbar' + (typing ? ' is-typing' : '') + (wiz.help ? ' is-help' : '');
      const cancel = btn('취소', cancelWiz, { class: 'btn fp-b btn-ghost', title: '맞추기 전으로 되돌리기' });
      const helpId = 'fpwizhelp-' + key;
      const helpBtn = () => el('button', { type: 'button', class: 'btn fp-b btn-ghost fp-wizhelpbtn', 'aria-expanded': String(!!wiz.help), 'aria-controls': helpId,
        'aria-label': wiz.help ? '설명 접기' : '설명 보기', title: wiz.help ? '설명 접기' : '설명 보기',
        onclick: () => { wiz.help = !wiz.help; drawWizBar(); const b2 = wizBar.querySelector('.fp-wizhelpbtn'); if (b2) b2.focus({ preventScroll: true }); } }, '설명 ', el('span', { 'aria-hidden': 'true' }, wiz.help ? '▴' : '▾'));
      const T = (t, d) => [el('div', { class: 'fp-wizt' }, t), d ? el('div', { class: 'fp-wizd fp-wizhelp', id: helpId }, d) : null];
      // '다시 찍기'는 점을 찍기 전에도 자리를 잡아 둠 (첫 점을 찍을 때 단추가 생기며 줄이 꺾여 사진이 밀려 내려가지 않게)
      const redo = () => btn('다시 찍기', () => { wiz.pts = []; drawOverlay(); drawWizBar(); }, { disabled: !wiz.pts.length, title: '찍은 점을 지우고 처음부터' });
      if (wiz.step === 'pts' && wiz.pts.length < 2) {
        put(wizBar, T('📏 축척 맞추기 1/3 · 길이를 아는 두 점을 누르세요',
          '사진 속 전체 가로 양 끝이나, “3,300”처럼 치수가 적힌 선의 양 끝을 차례로 누르세요. 두 손가락으로 벌려 확대하면 더 정확하고, 찍은 점은 끌어서 옮길 수 있어요.'),
        el('div', { class: 'fp-wizrow' }, el('span', { class: 'chip brand fp-wizcnt', 'aria-live': 'polite' }, el('span', { class: 'fp-wl' }, '찍은 '), '점 ' + wiz.pts.length + '/2'), el('span', { class: 'spacer' }),
          redo(), helpBtn(), cancel));
      } else if (wiz.step === 'pts') {
        if (!wiz.lenIn) {
          wiz.lenIn = el('input', { class: 'input num', type: 'text', inputmode: 'decimal', autocomplete: 'off', placeholder: mm('(max-width: 600px)') ? '예: 3300 · 330' : '예: 330 · 3300mm · 3.3m', 'aria-label': '두 점 사이 실제 길이' });
          wiz.unitSel = el('select', { class: 'select', 'aria-label': '길이 단위' },
            el('option', { value: 'auto' }, '단위 자동'), el('option', { value: 'cm' }, 'cm'), el('option', { value: 'mm' }, 'mm'), el('option', { value: 'm' }, 'm'));
          wiz.lenIn.addEventListener('input', updLen);
          wiz.unitSel.addEventListener('change', updLen);
          wiz.lenIn.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); applyScale(); } });
        }
        wiz.lenOut = el('div', { class: 'fp-lenout', 'aria-live': 'polite' });
        wiz.distEl = el('span', { class: 'num' }, Math.round(wizDist()) + 'cm');
        // 폰: 제목 한 줄 · 길이 칸과 '다음'을 한 줄에 (띠가 낮아야 찍은 두 점이 함께 보임)
        put(wizBar, el('div', { class: 'fp-wizt' }, el('span', { class: 'fp-wl' }, '📏 축척 맞추기 2/3 · 두 점 사이 실제 길이를 넣으세요'), el('span', { class: 'fp-ws' }, '📏 2/3 · 두 점 사이 실제 길이는?')),
          el('div', { class: 'fp-wizd fp-wizhelp', id: helpId }, '지금 사진 크기로는 약 ', wiz.distEl, '예요. 도면에 적힌 숫자(“3,300”·“1,200”처럼 보통 mm)를 그대로 넣어도 돼요.'),
          el('div', { class: 'fp-wizrow fp-lenrow' }, el('label', { class: 'fp-lenin' }, wiz.lenIn, wiz.unitSel), btn('다음 →', applyScale, { class: 'btn fp-b btn-primary', 'data-act': 'next' })),
          wiz.lenOut,
          el('div', { class: 'fp-wizrow' }, redo(), el('span', { class: 'spacer' }), helpBtn(), cancel));
        updLen();
        if (!coarse) setTimeout(() => { if (wiz && wiz.lenIn && wiz.lenIn.isConnected) wiz.lenIn.focus({ preventScroll: true }); }, 30);
        // 폰에선 이 단계의 띠가 제자리에 있으므로, 띠와 찍은 두 점이 함께 보이게
        if (mm('(max-width: 600px)')) revealWizLen();
      } else if (wiz.step === 'origin') {
        put(wizBar, T('📏 축척 맞추기 3/3 · 도면 왼쪽 위 모서리를 누르세요',
          '사진에서 바깥벽 왼쪽 위 모서리를 누르면, 그 점이 도면의 (0,0) — 주황 십자 자리 — 로 옮겨져요. 끌어서 맞춰도 돼요.'),
        el('div', { class: 'fp-wizrow' }, btn(['✋ 끌어서', el('span', { class: 'fp-wl' }, ' 맞추기')], () => setWizStep('move'), { title: '사진을 끌어서 위치 맞추기' }),
          btn('건너뛰기', () => finishWiz(), { title: '위치는 지금 그대로 두기' }), el('span', { class: 'spacer' }), helpBtn(), cancel));
      } else if (wiz.step === 'move') {
        const nb = (label, dx, dy) => btn(label, () => nudgeBg(dx, dy), { class: 'btn fp-b btn-icon', 'aria-label': '사진 ' + ({ '◀': '왼쪽', '▶': '오른쪽', '▲': '위', '▼': '아래' })[label] + '으로 2cm' });
        put(wizBar, T('✋ 사진 위치 옮기기 · 사진을 끌어서 도면 선에 맞추세요',
          '손가락이나 마우스로 끌어요. 화살표 단추는 2cm씩 (키보드 방향키 1cm · Shift 10cm). 옮기는 동안엔 도면 위를 쓸어도 화면이 움직이지 않아요 — 화면을 움직이려면 도면 바깥(이 안내 띠·여백)을 쓸거나, 사진을 화면 끝까지 끌면 따라 움직여요.'),
        el('div', { class: 'fp-wizrow' }, el('span', { class: 'fp-nudge', role: 'group', 'aria-label': '사진 조금씩 옮기기' }, nb('◀', -2, 0), nb('▲', 0, -2), nb('▼', 0, 2), nb('▶', 2, 0)),
          el('span', { class: 'spacer' }), helpBtn(), btn('완료', () => finishWiz(), { class: 'btn fp-b btn-primary' }), cancel));
      }
    }
    const fmtLen = (cm) => (Math.round(cm * 10) / 10) + 'cm';
    function updLen() {
      if (!wiz || !wiz.lenOut) return;
      const t = wiz.lenIn.value;
      const est = wizDist();
      const r = parseLen(t, wiz.unitSel.value, est);
      const out = wiz.lenOut;
      out.className = 'fp-lenout';
      out.textContent = '';
      if (!String(t).trim()) {
        put(out, el('span', { class: 'fp-wl' }, '숫자만 넣으면 단위를 알아서 짐작해요 (“3,300”처럼 쉼표가 있으면 mm).'),
          el('span', { class: 'fp-ws' }, '사진에서 약 ' + Math.round(est) + 'cm · 숫자만 넣어도 돼요'));
        return;
      }
      if (!r) { out.className = 'fp-lenout is-bad'; out.textContent = '숫자로 읽을 수 없어요 (예: 330 · 3300mm · 3.3m)'; return; }
      const bad = r.cm < LEN_MIN || r.cm > LEN_MAX;
      out.className = 'fp-lenout' + (bad ? ' is-bad' : '');
      put(out, el('div', '= ' + fmtLen(r.cm) + ' (' + (Math.round(r.cm) / 100) + 'm)' + (r.how ? ' · ' + r.how : '') + (bad ? ' — 20cm~50m 사이로 넣어 주세요' : '')));
      // 단위를 짐작했으면 다르게 읽는 단추 (한 번 누르면 그 단위로 고정 — '단위 자동'으로 되돌릴 수 있음)
      if (r.alts.length) {
        const raw = String(t).trim();
        put(out, el('div', { class: 'fp-lenalt' }, el('span', { class: 'tiny muted' }, '다르게 읽기:'),
          r.alts.map((a) => el('button', { type: 'button', class: 'btn btn-sm fp-b', 'data-unit': a.unit,
            onclick: () => { wiz.unitSel.value = a.unit; updLen(); try { wiz.unitSel.focus({ preventScroll: true }); } catch (e) { /* 무시 */ } } },
          (a.unit === 'cm' ? raw.replace(/,/g, '') + 'cm' : raw + a.unit + ' = ' + fmtLen(a.cm)) + '로'))));
      }
      // 사진에서 잰 길이와 5배 넘게 다르면 숫자·단위를 한 번 더 보게
      if (!bad && est > 0 && (r.cm / est > 5 || r.cm / est < 0.2)) {
        put(out, el('div', { class: 'fp-lenwarn' }, '⚠️ 사진에서 잰 길이(약 ' + Math.round(est) + 'cm)와 많이 달라요 — 숫자·단위를 확인하세요'));
      }
    }
    function applyScale() {
      if (!wiz || wiz.pts.length < 2) return;
      const bg = bgOf(key);
      if (!bg) return;
      const r = parseLen(wiz.lenIn.value, wiz.unitSel.value, wizDist());
      if (!r || r.cm < LEN_MIN || r.cm > LEN_MAX) { updLen(); if (!r) { wiz.lenOut.className = 'fp-lenout is-bad'; wiz.lenOut.textContent = '실제 길이를 넣어 주세요 (예: 330 · 3300mm · 3.3m)'; } try { wiz.lenIn.focus(); } catch (e) { /* 무시 */ } return; }
      const dPx = wizDist() / bg.cmPerPx;
      if (dPx < 8) { wiz.lenOut.className = 'fp-lenout is-bad'; wiz.lenOut.textContent = '두 점이 너무 가까워요 — 확대해서 더 멀리 떨어진 두 점을 찍어 주세요'; return; }
      const k2 = r.cm / dPx;
      // 첫 번째 점 자리를 그대로 두고 크기만 바꿈 (사진이 엉뚱한 곳으로 튀지 않게)
      const A = wiz.pts[0];
      const uv = planToBg(bg, A.x, A.y);
      const at0 = bgToPlan(Object.assign({}, bg, { cmPerPx: k2, x: 0, y: 0 }), uv.u, uv.v);
      wiz.step = 'origin'; wiz.pts = [];
      drawWizBar(); syncStageMode();
      setBg({ cmPerPx: k2, x: r2(A.x - at0.x), y: r2(A.y - at0.y), calibrated: true, aligned: false },
        '📏 ' + PLAN_LABEL[key] + ' 평면도 사진 축척 맞춤 (두 점 ' + (Math.round(r.cm * 10) / 10) + 'cm)');
    }
    function setOrigin(P) {
      const bg = bgOf(key);
      if (!bg) return;
      setBg({ x: r2(bg.x - P.x), y: r2(bg.y - P.y), aligned: true }, '🖼 ' + PLAN_LABEL[key] + ' 평면도 사진 위치 맞춤');
      finishWiz();
    }
    function nudgeBg(dx, dy) {
      const bg = bgOf(key);
      if (!bg) return;
      setBg({ x: r2(bg.x + dx), y: r2(bg.y + dy) });
    }
    /** 도면 위 덧그림: 축척 점·선, (0,0) 표시, 그리는 중인 방 */
    function drawOverlay() {
      if (!svgEl || !cur) return;
      const old = svgEl.querySelector('.fp-ovl');
      if (old) old.remove();
      const s = cur.s || 1;
      const px = (v) => v / s;
      const g = svg('g', { class: 'fp-ovl' });
      const label = (x, y, str, fs, anchor) => svg('text', { x: r1(x), y: r1(y), 'font-size': r2(fs), 'text-anchor': anchor || 'middle', 'dominant-baseline': 'central',
        fill: 'var(--brand)', 'font-weight': 800, 'paint-order': 'stroke', stroke: 'var(--bg-2)', 'stroke-width': r2(fs * 0.3), 'stroke-linejoin': 'round' }, str);
      if (wiz && wiz.step === 'pts') {
        const P = wiz.pts;
        if (P.length === 2) {
          g.appendChild(svg('line', Object.assign({ x1: r1(P[0].x), y1: r1(P[0].y), x2: r1(P[1].x), y2: r1(P[1].y), stroke: 'var(--brand)', 'stroke-width': 2.5 }, NS)));
          // 길이 글자는 선과 수직으로, A·B 이름표(점의 오른쪽 위)와 반대쪽에 (가까운 두 점에서도 겹치지 않게)
          const mx = (P[0].x + P[1].x) / 2, my = (P[0].y + P[1].y) / 2;
          const L0 = Math.max(1e-6, wizDist());
          let nx = -(P[1].y - P[0].y) / L0, ny = (P[1].x - P[0].x) / L0;
          if (nx - ny > 0) { nx = -nx; ny = -ny; }
          g.appendChild(label(mx + nx * px(24), my + ny * px(24), '약 ' + Math.round(wizDist()) + 'cm', px(12)));
        }
        P.forEach((p, i) => {
          g.appendChild(svg('line', Object.assign({ x1: r1(p.x - px(11)), y1: r1(p.y), x2: r1(p.x + px(11)), y2: r1(p.y), stroke: 'var(--brand)', 'stroke-width': 1.5 }, NS)));
          g.appendChild(svg('line', Object.assign({ x1: r1(p.x), y1: r1(p.y - px(11)), x2: r1(p.x), y2: r1(p.y + px(11)), stroke: 'var(--brand)', 'stroke-width': 1.5 }, NS)));
          g.appendChild(svg('circle', Object.assign({ cx: r1(p.x), cy: r1(p.y), r: r2(px(6)), fill: 'var(--brand-bg)', 'fill-opacity': 0.6, stroke: 'var(--brand)', 'stroke-width': 2 }, NS)));
          g.appendChild(label(p.x + px(14), p.y - px(12), i ? 'B' : 'A', px(12), 'start'));
          g.appendChild(svg('circle', { class: 'fp-wizpt', 'data-i': String(i), cx: r1(p.x), cy: r1(p.y), r: r2(px(22)), fill: 'transparent' }, svg('title', '점 ' + (i ? 'B' : 'A') + ' — 끌어서 옮기기')));
        });
      } else if (wiz && wiz.step === 'origin') {
        const L = px(22);
        g.appendChild(svg('line', Object.assign({ x1: r1(-L), y1: 0, x2: r1(L), y2: 0, stroke: 'var(--brand)', 'stroke-width': 2.5 }, NS)));
        g.appendChild(svg('line', Object.assign({ x1: 0, y1: r1(-L), x2: 0, y2: r1(L), stroke: 'var(--brand)', 'stroke-width': 2.5 }, NS)));
        g.appendChild(svg('circle', Object.assign({ cx: 0, cy: 0, r: r2(px(7)), fill: 'none', stroke: 'var(--brand)', 'stroke-width': 2 }, NS)));
        g.appendChild(label(px(12), -px(14), '(0,0) 도면 왼쪽 위', px(11.5), 'start'));
      }
      const pr = (gest && gest.type === 'draw' && gest.rect) || preview;
      if (pr && pr.w > 0 && pr.h > 0) {
        const ok = pr.w >= MIN_ROOM && pr.h >= MIN_ROOM;
        g.appendChild(svg('rect', Object.assign({ x: r1(pr.x), y: r1(pr.y), width: r1(pr.w), height: r1(pr.h), fill: ok ? 'var(--brand)' : 'var(--bad)', 'fill-opacity': 0.14,
          stroke: ok ? 'var(--brand)' : 'var(--bad)', 'stroke-width': 2, 'stroke-dasharray': '8 4' }, NS)));
        const t = Math.round(pr.w) + '×' + Math.round(pr.h) + 'cm';
        const fs = Math.min(px(14), pr.w / 5 + px(6));
        g.appendChild(label(pr.x + pr.w / 2, pr.y + pr.h / 2, t, Math.max(px(10), fs)));
      }
      if (g.childNodes.length) svgEl.appendChild(g);
    }

    // ---- 짐 목록 ----
    let sideTop = 0;   // 목록 스크롤 위치 (읽기로 레이아웃을 강제하지 않도록 이벤트로 추적)
    side.addEventListener('scroll', () => { sideTop = side.scrollTop; }, { passive: true });
    function drawSide(force) {
      const cnt = {};
      cur.items.forEach((o) => { cnt[o.it.id] = (cnt[o.it.id] || 0) + 1; });
      const all = MV.inv.list((it) => eligible(key, it));
      const sg = [prefs().filter, all.map((it) => [it.id, it.name, it.fate, it.cat, it.qty, it.w, it.d, it.h, it.assumed, it[roomField(key)], cnt[it.id] || 0])];
      if (!changed('side', sg) && !force) return;
      const listTop = sideTop;
      side.textContent = '';
      const need = all.reduce((s, it) => s + qtyOf(it), 0);
      const placed = all.reduce((s, it) => s + Math.min(qtyOf(it), cnt[it.id] || 0), 0);
      const todo = all.filter((it) => (cnt[it.id] || 0) < qtyOf(it));
      const done = all.filter((it) => (cnt[it.id] || 0) > 0);
      const f = prefs().filter;
      const shown = f === 'todo' ? todo : f === 'done' ? done : all;
      put(side, 
        el('div', { class: 'fp-card-head' }, el('h2', '배치할 짐'), el('span', { class: 'chip ' + (need && placed >= need ? 'good' : 'kid') }, placed + '/' + need + ' 놓음')),
        el('p', { class: 'tiny muted mb-0' }, key === 'new' ? '가져갈·새로 살·미정인 짐이에요. 버릴 짐은 “지금 집” 탭에서 보여요.' : '지금 집에 있는 짐이에요 (새로 살 물건 제외).'),
        el('div', { class: 'fp-side-actions' },
          btn('+ 짐 추가', addItem),
          btn('✨ 자동 배치 제안', autoLayout, { class: 'btn fp-b btn-kid', disabled: !todo.length, title: '아직 안 놓은 짐을 방 이름에 맞춰 벽 쪽으로' })));
      if (!all.length) {
        side.appendChild(el('div', { class: 'empty' }, el('span', { class: 'big', 'aria-hidden': 'true' }, '📦'),
          el('p', { class: 'small' }, '짐 목록이 비어 있어요.'), el('p', { class: 'tiny' }, '“+ 짐 추가”로 냉장고·침대 같은 큰 짐부터 넣어 보세요.')));
        return;
      }
      side.appendChild(el('div', { class: 'tabs fp-filter', role: 'group', 'aria-label': '목록 거르기' },
        [['all', '전체', all.length], ['todo', '미배치', todo.length], ['done', '배치됨', done.length]].map(([id, label, n]) =>
          el('button', { type: 'button', class: f === id ? 'active' : '', 'aria-pressed': String(f === id), onclick: () => { setPref('filter', id); drawSide(true); } }, label + ' ' + n))));
      if (!shown.length) {
        side.appendChild(el('p', { class: 'small muted' }, f === 'todo' ? '모든 짐을 놓았어요 👍' : '아직 놓은 짐이 없어요.'));
        return;
      }
      MV.inv.CATS.concat([{ id: '__other', label: '기타', icon: '📦' }]).forEach((c) => {
        const rows = shown.filter((it) => (c.id === '__other' ? !MV.inv.CATS.some((x) => x.id === it.cat) : it.cat === c.id));
        if (!rows.length) return;
        const color = CAT_COLOR[c.id] || 'var(--ink-3)';
        side.appendChild(el('div', { class: 'fp-group' },
          el('div', { class: 'fp-group-h' }, el('span', { class: 'fp-dot', style: { borderColor: color, background: 'color-mix(in srgb, ' + color + ' 25%, transparent)' } }), c.icon + ' ' + c.label, el('span', { class: 'muted' }, rows.length)),
          rows.map((it) => itemRow(it, cnt[it.id] || 0))));
      });
      side.scrollTop = listTop;
    }
    function itemRow(it, k) {
      const qn = qtyOf(it);
      const fate = MV.inv.fate(fateOf(it));
      const dims = Math.round(num(it.w, 0)) + '×' + Math.round(num(it.d, 0)) + '×' + Math.round(num(it.h, 0));
      const where = String(it[roomField(key)] || '').trim();
      return el('div', { class: 'fp-row' + (qn && k >= qn ? ' is-done' : '') },
        el('span', { class: 'fp-row-ico', 'aria-hidden': 'true' }, MV.inv.cat(it.cat).icon),
        el('div', { style: { minWidth: '0' } },
          k ? el('button', { type: 'button', class: 'fp-row-name fp-link', title: '도면에서 찾기', onclick: () => selectInv(it.id) }, it.name)
            : el('span', { class: 'fp-row-name' }, it.name),
          el('div', { class: 'fp-row-meta' },
            el('span', { class: 'chip ' + fate.cls }, fate.label),
            it.assumed ? el('span', { class: 'chip warn', title: '대략적인 규격이에요. ✎ 로 실제 치수를 넣어 주세요' }, '추정 규격') : null,
            el('span', { class: 'tiny muted num' }, dims),
            where ? el('span', { class: 'tiny muted' }, '· ' + where) : null)),
        el('span', { class: 'fp-row-count' + (k > qn ? ' is-over' : ''), title: '놓은 개수 / 수량' }, k + '/' + qn),
        el('div', { class: 'fp-row-btns' },
          el('button', { type: 'button', class: 'btn btn-sm fp-b', disabled: k >= qn, onclick: () => placeOne(it.id), 'aria-label': it.name + ' 도면에 놓기' }, '+ 놓기'),
          el('button', { type: 'button', class: 'btn btn-ghost btn-sm btn-icon fp-b', onclick: () => editSpec(it.id), 'aria-label': it.name + ' 규격 수정' }, '✎')));
    }

    // ---- 배치 점검 ----
    function drawChecks() {
      const v = cur.v;
      checks.textContent = '';
      checks.appendChild(el('div', { class: 'fp-card-head' }, el('h2', '배치 점검'),
        v.bad ? el('span', { class: 'chip bad' }, '문제 ' + v.bad) : null,
        v.warn ? el('span', { class: 'chip warn' }, '주의 ' + v.warn) : null));
      if (!cur.items.length) {
        checks.appendChild(el('p', { class: 'muted small mb-0' }, '아직 놓은 짐이 없어요. 짐 목록에서 “+ 놓기”나 “✨ 자동 배치 제안”을 눌러 보세요.'));
        return;
      }
      if (!v.msgs.length) {
        checks.appendChild(el('div', { class: 'callout good mb-0' }, el('strong', '문제 없음 👍'), el('div', { class: 'small' }, '겹치거나 문을 막거나 방 밖으로 나간 짐이 없어요.')));
      } else {
        const LIMIT = 40;
        const FIX = { in: ['↩ 도면 안으로', '도면 안으로 가져오기'], room: ['↩ 방 안으로', '방 안으로 밀어 넣기'], turn: ['↻ 돌려 넣기', '90도 돌려서 방 안에 넣기'] };
        checks.appendChild(el('ul', { class: 'fp-msgs' }, v.msgs.slice(0, LIMIT).map((m) => el('li', { class: 'fp-msgrow' },
          el('button', { type: 'button', class: 'fp-msg is-' + m.level, onclick: () => { sel = m.pid; editMode = false; refresh(); revealSel(); } },
            el('span', { 'aria-hidden': 'true' }, m.level === 'bad' ? '⛔' : '⚠️'), el('span', m.text)),
          m.fix && FIX[m.fix] ? el('button', { type: 'button', class: 'btn btn-sm fp-b fp-fix', title: FIX[m.fix][1], 'aria-label': FIX[m.fix][1],
            onclick: () => { sel = m.pid; editMode = false; fixPlacement(m.pid, m.fix); revealSel(); } }, FIX[m.fix][0]) : null))));
        if (v.msgs.length > LIMIT) checks.appendChild(el('p', { class: 'tiny muted' }, '외 ' + (v.msgs.length - LIMIT) + '개'));
      }
      checks.appendChild(el('p', { class: 'tiny muted mt-8 mb-0' }, '도면은 추정치라 벽·문 위치가 실제와 다를 수 있어요. 사전방문 때 재고 “✏️ 치수 수정”으로 고치면 점검이 정확해져요.'));
    }

    // ---- 다용도실 세탁기·건조기 ----
    function drawLaundry(force) {
      if (!laundry) return;
      const plan = cur.plan;
      const cands = laundryRooms(plan);
      const pref = prefs().laundryRoom;
      const chosen = validRooms(plan).find((r) => r.id === pref) || null;   // 직접 고른 곳 (없으면 자동 = 추천 1순위)
      const room = chosen || cands[0] || null;
      const washer = pickWasher(), dryer = pickDryer();
      const pick = (it) => (it ? [it.id, it.name, it.note, it.w, it.d, it.h, it.fate] : null);
      const sg = [validRooms(plan).map((r) => [r.id, r.name, r.kind, r.x, r.y, r.w, r.h]), room && room.id, !!chosen, pick(washer), pick(dryer), cands.map((r) => r.id),
        plan.fixtures.map((f) => [f.x, f.y, f.w, f.h]), plan.doors.map((d) => d._key + d.width + d.swing), plan.openings.length];
      if (!changed('laundry', sg) && !force) return;
      laundry.textContent = '';
      const res = room && washer && dryer ? laundryCheck(plan, room, washer, dryer) : null;
      laundry.appendChild(el('div', { class: 'fp-card-head' }, el('h2', '🧺 다용도실 세탁기·건조기 점검'),
        res ? el('span', { class: 'chip ' + (res.worst === 'ok' ? 'good' : res.worst === 'warn' ? 'warn' : 'bad') }, res.worst === 'ok' ? '나란히 OK' : res.worst === 'warn' ? '빠듯함' : '안 들어감') : null));
      const roomSel = el('select', { class: 'select', 'aria-label': '세탁기·건조기를 둘 곳' },
        el('option', { value: '', selected: !chosen }, cands[0] ? '자동 — 추천: ' + cands[0].name + ' (' + Math.round(cands[0].w) + '×' + Math.round(cands[0].h) + ')' : '— 둘 곳을 고르세요 —'),
        validRooms(plan).map((r) => el('option', { value: r.id, selected: !!chosen && r.id === chosen.id }, r.name + ' (' + Math.round(r.w) + '×' + Math.round(r.h) + ')' + (cands.includes(r) ? ' · 추천' : ''))));
      roomSel.addEventListener('change', () => { setPref('laundryRoom', roomSel.value); drawLaundry(true); const n = laundry.querySelector('select'); if (n) n.focus(); });
      laundry.appendChild(el('div', { class: 'fp-roomsel' }, el('span', { class: 'small strong' }, '둘 곳'), roomSel));
      if (!cands.length && !room) laundry.appendChild(el('p', { class: 'small muted' }, '도면에서 다용도실을 찾지 못했어요. 세탁기를 둘 곳을 직접 골라 주세요.'));
      const appliance = (it, label, preset) => el('div',
        el('div', { class: 'fp-wd-h' }, label),
        it ? [el('div', { class: 'fp-wd-n' }, it.name),
          el('div', { class: 'tiny muted num' }, Math.round(num(it.w, 0)) + '×' + Math.round(num(it.d, 0)) + '×' + Math.round(num(it.h, 0)) + 'cm · ' + MV.inv.fate(fateOf(it)).label),
          el('button', { type: 'button', class: 'btn btn-sm btn-ghost fp-b', onclick: () => editSpec(it.id), 'aria-label': label + ' 규격 수정' }, '✎ 규격')]
          : [el('div', { class: 'small muted' }, '짐 목록에 없어요'),
            el('button', { type: 'button', class: 'btn btn-sm fp-b', onclick: () => MV.inv.editor(null, { defaults: preset }) }, '+ ' + label + ' 추가')]);
      laundry.appendChild(el('div', { class: 'fp-wd' },
        appliance(washer, '세탁기', { name: '통돌이 세탁기 (구매 예정)', cat: 'appliance', tag: 'washer', fate: 'buy', w: 70, d: 72, h: 105, roomNew: room ? room.name : '다용도실' }),
        appliance(dryer, '건조기', { name: '건조기', cat: 'appliance', tag: 'dryer', fate: 'move', w: 70, d: 76, h: 99, roomNew: room ? room.name : '다용도실' })));
      if (!room) return;
      if (!res) { laundry.appendChild(el('p', { class: 'small muted mb-0' }, '세탁기와 건조기가 모두 짐 목록에 있어야 점검할 수 있어요.')); return; }
      laundry.appendChild(el('p', { class: 'small muted mb-0' }, room.name + ' ' + Math.round(room.w) + '×' + Math.round(room.h) + 'cm 기준' + (room.added ? ' (직접 그린 방)' : room.edited ? ' (실측 반영)' : ' (도면 추정치)')));
      laundry.appendChild(el('ul', { class: 'fp-verdicts' }, res.checks.map((c) => el('li', { class: 'fp-verdict is-' + c.lv },
        el('span', { 'aria-hidden': 'true' }, verdictIcon(c.lv)),
        el('div', el('div', { class: 'strong' }, c.t), el('div', { class: 'fp-vd' }, c.d))))));
      laundry.appendChild(el('div', { class: 'small strong mt-8' }, '💡 이렇게 해 보세요'));
      laundry.appendChild(el('ul', { class: 'fp-sugg' }, res.sugg.map((s) => el('li', s))));
      const noSpot = !res.spot;
      laundry.appendChild(el('div', { class: 'row mt-12' },
        el('button', { type: 'button', class: 'btn fp-b ' + (noSpot ? '' : 'btn-primary'), onclick: () => placeLaundry(room, washer, dryer) }, '📐 ' + room.name + '에 ' + (noSpot ? '그래도 ' : '') + '놓아보기'),
        noSpot ? el('span', { class: 'tiny muted' }, '자리가 없어 겹쳐 놓일 수 있어요') : null));
    }
    /** 예전 방식(벽 쪽 한 줄로 단순 배치) — 문·고정물 때문에 laundrySpot 이 자리를 못 찾을 때만 */
    function simplePair(plan, room, washer, dryer) {
      const horiz = room.w >= room.h;
      const rot = horiz ? 0 : 90;
      const fW = foot(washer, rot), fD = foot(dryer, rot);
      const tap = tapIn(plan, room);
      const tc = tap ? (() => { const r = fxRect(tap); return [r.x + r.w / 2, r.y + r.h / 2]; })() : null;
      const ds = plan.doors.map(doorGeom);
      const depth = Math.max(horiz ? fW.h : fW.w, horiz ? fD.h : fD.w);
      if (horiz) {
        let atTop = true;
        if (tc) atTop = tc[1] - room.y < room.h / 2;
        else {
          const topS = { x: room.x, y: room.y, w: room.w, h: depth }, botS = { x: room.x, y: room.y + room.h - depth, w: room.w, h: depth };
          if (ds.some((g) => hit(g.swing, topS, 1)) && !ds.some((g) => hit(g.swing, botS, 1))) atTop = false;
        }
        const fromLeft = tc ? tc[0] - room.x < room.w / 2 : true;
        const yW = atTop ? room.y : room.y + room.h - fW.h, yD = atTop ? room.y : room.y + room.h - fD.h;
        const xW = fromLeft ? room.x + 3 : room.x + room.w - 3 - fW.w;
        const xD = fromLeft ? xW + fW.w + 3 : xW - 3 - fD.w;
        return { rot, pos: [[washer, xW, yW], [dryer, xD, yD]] };
      }
      let atLeft = true;
      if (tc) atLeft = tc[0] - room.x < room.w / 2;
      else {
        const lS = { x: room.x, y: room.y, w: depth, h: room.h }, rS = { x: room.x + room.w - depth, y: room.y, w: depth, h: room.h };
        if (ds.some((g) => hit(g.swing, lS, 1)) && !ds.some((g) => hit(g.swing, rS, 1))) atLeft = false;
      }
      const fromTop = tc ? tc[1] - room.y < room.h / 2 : true;
      const xW = atLeft ? room.x : room.x + room.w - fW.w, xD = atLeft ? room.x : room.x + room.w - fD.w;
      const yW = fromTop ? room.y + 3 : room.y + room.h - 3 - fW.h;
      const yD = fromTop ? yW + fW.h + 3 : yW - 3 - fD.h;
      return { rot, pos: [[washer, xW, yW], [dryer, xD, yD]] };
    }
    function placeLaundry(room, washer, dryer) {
      const plan = cur.plan;
      // 이미 놓인 세탁기·건조기 첫 번째 자리는 옮길 것이므로 장애물에서 뺌
      const mine = new Set();
      [washer, dryer].forEach((it) => { const o = cur.items.find((x) => x.it.id === it.id); if (o) mine.add(o.p.id); });
      const occ = cur.items.filter((o) => !mine.has(o.p.id) && !wallMounted(o.it)).map((o) => o.r);
      const spot = laundrySpot(plan, room, washer, dryer, occ);
      let pos, rot;
      if (spot) { rot = spot.rot; pos = spot.pos.map((p2) => [p2.it, p2.x, p2.y]); }
      else ({ rot, pos } = simplePair(plan, room, washer, dryer));
      let firstId = null;
      MV.store.update((st) => {
        const P = layoutsOf(st).new.placements;
        pos.forEach(([it, x, y]) => {
          let p = P.find((z) => z.invId === it.id);
          if (p) Object.assign(p, { x: r1(x), y: r1(y), rot });
          else { p = { id: MV.uid('pl'), invId: it.id, x: r1(x), y: r1(y), rot }; P.push(p); }
          if (!firstId) firstId = p.id;
          const iv = (st.inventory || []).find((z) => z.id === it.id);
          if (iv) iv.roomNew = room.name;
        });
        sel = firstId;
      }, { log: '📐 세탁기·건조기를 ' + room.name + '에 나란히 배치' });
      const msg = !spot ? '자리가 마땅치 않아 ' + room.name + '에 겹쳐 놓았어요 — 배치 점검을 보세요'
        : !spot.occFree ? room.name + '에 놓았지만 다른 짐과 겹쳐요' : room.name + '에 세탁기·건조기를 나란히 놓았어요';
      toast(msg, { action: window.innerWidth < 1100 ? { label: '보기', onClick: revealSel } : null, ms: spot && spot.occFree ? undefined : 5000 });
      if (window.innerWidth >= 1100) revealSel();
    }

    // ---- 도면 정보 ----
    function drawInfo(force) {
      const plan = cur.plan;
      if (!changed('info', [plan.name, plan.confidence, plan.rooms.filter((r) => r.edited || r.added).map((r) => [r.id, r.name, r.kind, r.w, r.h]),
        plan.removed.map((r) => [r.id, r.name]), editSummary(plan)]) && !force) return;
      info.textContent = '';
      const det = el('details', { class: 'fp-details', open: prefs().infoOpen });
      det.addEventListener('toggle', () => { if (prefs().infoOpen !== det.open) setPref('infoOpen', det.open); });
      const list = (arr) => el('ul', arr.map((x) => el('li', MV.linkify(txtOf(x)))));
      const measure = Array.isArray(plan.measureFirst) ? plan.measureFirst.filter(Boolean) : [];
      const logi = Array.isArray(plan.logistics) ? plan.logistics.filter(Boolean) : [];
      const sources = Array.isArray(plan.sources) ? plan.sources.filter(Boolean) : [];
      const images = Array.isArray(plan.images) ? plan.images.filter(Boolean) : [];
      const kv = [];
      const pushObj = (o, prefix) => {
        if (!o || typeof o !== 'object') return;
        const LB = MV.planLabels && typeof MV.planLabels === 'object' ? MV.planLabels : {};
        Object.entries(o).forEach(([k2, v2]) => { if (v2 != null && v2 !== '' && typeof v2 !== 'object') kv.push([prefix + (LB[k2] || k2), String(v2)]); });
      };
      pushObj(plan.complex, ''); pushObj(plan.unit, '');
      const edited = plan.rooms.filter((r) => r.edited);
      const addedRooms = plan.rooms.filter((r) => r.added);
      put(det, 
        el('summary', el('strong', '📄 도면 정보 · 현장에서 잴 것'), confidenceChip(plan), measure.length ? el('span', { class: 'chip' }, '실측 ' + measure.length) : null),
        el('div', { class: 'mt-8' },
          el('p', { class: 'small mb-0' }, el('strong', plan.name),
            plan.exclusive_m2 ? ' · 전용 ' + plan.exclusive_m2 + '㎡' : '', ' · 그림 범위 ' + Math.round(plan.bounds.w) + '×' + Math.round(plan.bounds.h) + 'cm'),
          plan.basis ? el('p', { class: 'small muted mt-8' }, MV.linkify(txtOf(plan.basis))) : null,
          plan.confidence !== 'high' ? el('div', { class: 'callout warn small' }, '이 도면은 공개 자료로 추정한 것이에요. 큰 가구를 사기 전엔 꼭 실측하세요.') : null,
          measure.length ? [el('h3', '📏 현장에서 먼저 잴 것'), list(measure)] : null,
          logi.length ? [el('h3', '🚚 이사 동선·반입'), list(logi)] : null,
          kv.length ? [el('h3', '🏢 단지·세대'), el('dl', { class: 'fp-kv' }, kv.map(([a, c]) => [el('dt', a), el('dd', c)]))] : null,
          sources.length ? [el('h3', '🔗 출처'), el('ul', sources.map((s2) => {
            const url = typeof s2 === 'object' ? s2.url : (/^https?:/.test(String(s2)) ? String(s2) : '');
            const label = typeof s2 === 'object' ? (s2.label || s2.title || s2.url) : String(s2);
            return el('li', url ? el('a', { href: url, target: '_blank', rel: 'noopener noreferrer' }, label) : label);
          }))] : null,
          images.length ? [el('h3', '🖼️ 참고 이미지'), el('ul', images.map((im) => {
            const url = typeof im === 'object' ? (im.url || im.src) : String(im);
            const label = typeof im === 'object' ? (im.label || im.caption || im.title || url) : String(im);
            return el('li', url && /^https?:/.test(url) ? el('a', { href: url, target: '_blank', rel: 'noopener noreferrer' }, label) : label);
          }))] : null,
          edited.length ? [el('h3', '📏 실측으로 고친 방'), el('ul', edited.map((r) => el('li', (r.name !== r.orig.name ? r.orig.name + ' → ' : '') + r.name + ': ' + Math.round(r.orig.w) + '×' + Math.round(r.orig.h) + ' → ' + Math.round(r.w) + '×' + Math.round(r.h) + 'cm'
            + (r.kind !== r.orig.kind ? ' · 종류 ' + kindLabel(r.orig.kind) + ' → ' + kindLabel(r.kind) : ''))))] : null,
          addedRooms.length ? [el('h3', '➕ 직접 그린 방'), el('ul', addedRooms.map((r) => el('li', r.name + ' (' + kindLabel(r.kind) + ') ' + Math.round(r.w) + '×' + Math.round(r.h) + 'cm · ' + fmtA(area(r)))))] : null,
          plan.removed.length ? [el('h3', '🗑 지운 방'), el('ul', { class: 'fp-del-list' }, plan.removed.map((r) => el('li', el('span', r.name + ' ' + Math.round(r.w) + '×' + Math.round(r.h) + 'cm'),
            el('button', { type: 'button', class: 'btn btn-sm fp-b', onclick: () => restoreRoom(r), 'aria-label': r.name + ' 되살리기' }, '↩ 되살리기')))),
          el('p', { class: 'tiny muted mb-0' }, '지운 방에만 붙어 있던 문·창·고정물은 도면에서 숨겨져요.')] : null,
          plan.sizeEdited ? [el('h3', '📐 전체 크기'), el('p', { class: 'small mb-0' }, Math.round(plan.baseSize.width) + '×' + Math.round(plan.baseSize.depth) + ' → ' + Math.round(plan.width) + '×' + Math.round(plan.depth) + 'cm')] : null,
          plan.edits.doorsAdded || plan.edits.doorsDeleted ? [el('h3', '🚪 문'), el('p', { class: 'small mb-0' }, [plan.edits.doorsAdded ? '추가 ' + plan.edits.doorsAdded + '개' : '', plan.edits.doorsDeleted ? '삭제 ' + plan.edits.doorsDeleted + '개' : ''].filter(Boolean).join(' · '))] : null,
          plan.edited ? el('button', { type: 'button', class: 'btn btn-sm btn-danger fp-b mt-8', onclick: resetAllRooms }, '도면 전체 원래대로') : null));
      info.appendChild(det);
    }

    // ---- 동작 ----
    function revealSel() {
      requestAnimationFrame(() => {
        const g = sel && svgEl && svgEl.querySelector('[data-pid="' + CSS.escape(sel) + '"]');
        if (!g) return;
        const r = g.getBoundingClientRect();
        const vh = window.innerHeight;
        if (r.top < 70 || r.bottom > vh - 80) planCard.scrollIntoView({ behavior: 'smooth', block: 'start' });
        const sr = scroll.getBoundingClientRect();
        if (r.left < sr.left || r.right > sr.right || r.top < sr.top || r.bottom > sr.bottom) {
          scroll.scrollTo({ left: scroll.scrollLeft + (r.left + r.width / 2) - (sr.left + sr.width / 2), top: scroll.scrollTop + (r.top + r.height / 2) - (sr.top + sr.height / 2), behavior: 'smooth' });
        }
      });
    }
    function selectInv(invId) {
      const o = cur.items.find((x) => x.it.id === invId);
      if (!o) return;
      sel = o.p.id; editMode = false;
      refresh(); revealSel();
    }
    function placeOne(invId) {
      const res = planPlacement(key, invId);
      if (!res) return;
      sel = res.pl.id;
      editMode = false;
      commitPlacement(key, res);
      const narrow = window.innerWidth < 1100;
      toast(q(res.it) + jo(res.it.name, '을', '를') + ' ' + (res.room ? res.room.name : '도면 가운데') + '에 놓았어요', narrow ? { action: { label: '보기', onClick: revealSel } } : undefined);
    }
    function addItem() {
      MV.inv.editor(null, { defaults: { fate: 'move' }, onSave: (saved) => {
        if (!saved || !eligible(key, saved)) return;
        setTimeout(() => toast(q(saved) + jo(saved.name, '을', '를') + ' 짐 목록에 넣었어요', { action: { label: '도면에 놓기', onClick: () => placeOne(saved.id) } }), 50);
      } });
    }
    function autoLayout() {
      const cnt = placedCount(key);
      const n = MV.inv.list((it) => eligible(key, it)).reduce((s, it) => s + Math.max(0, qtyOf(it) - (cnt[it.id] || 0)), 0);
      if (!n) { toast('놓을 짐이 없어요 — 모두 배치됐어요'); return; }
      MV.ui.confirm('아직 놓지 않은 짐 ' + n + '개를 “' + (key === 'new' ? '새 집 위치' : '지금 집 위치') + '”에 적힌 방에 맞춰 벽 쪽으로 자동 배치할까요? 문 앞과 트인 통로는 비워 두고, 이미 놓은 짐은 그대로 둬요.', { okLabel: '자동 배치', title: '자동 배치 제안' }).then((ok) => {
        if (!ok) return;
        const res = runAutoLayout(key);
        if (!res) return;
        const group = (arr) => {
          const m = new Map();
          arr.forEach((x) => { const k2 = x.it.id; const e = m.get(k2) || { it: x.it, room: x.room, n: 0 }; e.n++; m.set(k2, e); });
          return Array.from(m.values()).map((e) => e.it.name + (e.n > 1 ? ' ×' + e.n : '') + (e.room ? ' (' + e.room.name + ')' : ''));
        };
        if (!res.noFit.length && !res.noRoom.length) { toast('짐 ' + res.placed.length + '개를 자동으로 놓았어요 👍'); return; }
        MV.ui.modal({
          title: '자동 배치 결과',
          body: el('div', { class: 'stack' },
            el('p', { class: 'mb-0' }, '놓은 짐 ' + res.placed.length + '개'),
            res.placed.length ? el('p', { class: 'small muted' }, group(res.placed).join(', ')) : null,
            res.noFit.length ? el('div', { class: 'callout bad' }, el('strong', '안 들어가는 짐: '), group(res.noFit).join(', '),
              el('div', { class: 'small' }, '그 방 벽 쪽에 빈자리가 없거나 너무 커요 (문 앞·트인 통로는 비워 둬요). 다른 방으로 옮기거나, 버릴지·작은 걸로 바꿀지 정해 보세요.')) : null,
            res.noRoom.length ? el('div', { class: 'callout warn' }, el('strong', '방 이름이 도면과 안 맞아 건너뛴 짐: '), group(res.noRoom).join(', '),
              el('div', { class: 'small' }, '✎ 로 “' + (key === 'new' ? '새 집 위치' : '지금 집 위치') + '”를 도면의 방 이름(' + validRooms(cur.plan).map((r) => r.name).slice(0, 8).join(', ') + ' …)으로 적어 주세요.')) : null),
          actions: [{ label: '확인', kind: 'primary' }],
        });
      });
    }
    function mutatePl(pid, fn, opts) {
      MV.store.update((st) => {
        const p = layoutsOf(st)[key].placements.find((x) => x.id === pid);
        if (p) fn(p, st);
      }, opts);
    }
    /** 위치 저장 + 놓인 방 이름을 짐의 room/roomNew 에 조용히 반영 */
    function commitPos(pid, x, y, rot) {
      const plan = cur.plan;
      mutatePl(pid, (p, st) => {
        p.x = r1(x); p.y = r1(y);
        if (rot === 0 || rot === 90) p.rot = rot;
        const it = (st.inventory || []).find((i) => i.id === p.invId);
        if (!it) return;
        const r = rectOf(p, it);
        const room = roomAt(plan, r.x + r.w / 2, r.y + r.h / 2);
        if (room) it[roomField(key)] = room.name;
      });
    }
    function rotateSel() {
      const o = curSel();
      if (!o) return;
      const nr = o.p.rot === 90 ? 0 : 90;
      const f = foot(o.it, nr);
      let x = o.r.x + o.r.w / 2 - f.w / 2, y = o.r.y + o.r.h / 2 - f.h / 2;
      if (prefs().snap) { x = Math.round(x / SNAP) * SNAP; y = Math.round(y / SNAP) * SNAP; }
      ({ x, y } = clampInto({ x, y, w: f.w, h: f.h }, cur.plan.bounds));
      mutatePl(o.p.id, (p) => { p.rot = nr; p.x = r1(x); p.y = r1(y); });
    }
    function nearestRoom(plan, r) {
      const cx = r.x + r.w / 2, cy = r.y + r.h / 2;
      let best = null, bd = Infinity;
      validRooms(plan).forEach((rm) => {
        const dx = Math.max(rm.x - cx, 0, cx - rm.x - rm.w), dy = Math.max(rm.y - cy, 0, cy - rm.y - rm.h);
        const d = Math.hypot(dx, dy);
        if (d < bd || (d === bd && best && area(rm) < area(best))) { bd = d; best = rm; }
      });
      return best;
    }
    /** 점검 메시지의 바로잡기: 'in' 도면 안으로 · 'room' 방 안으로 · 'turn' 돌려서 방 안으로 */
    function fixPlacement(pid, mode) {
      const o = cur && cur.items.find((x) => x.p.id === pid);
      if (!o) return;
      const plan = cur.plan;
      let rot = o.p.rot === 90 ? 90 : 0;
      let f = foot(o.it, rot);
      const cx = o.r.x + o.r.w / 2, cy = o.r.y + o.r.h / 2;
      if (mode === 'turn') { rot = rot ? 0 : 90; f = foot(o.it, rot); }
      const r = { x: cx - f.w / 2, y: cy - f.h / 2, w: f.w, h: f.h };
      if (mode !== 'turn') { r.x = o.r.x; r.y = o.r.y; }
      Object.assign(r, clampInto(r, plan.bounds));
      const room = roomAt(plan, r.x + r.w / 2, r.y + r.h / 2) || nearestRoom(plan, r);
      if (room && fitsIn(r, room)) Object.assign(r, clampInto(r, room));
      sel = pid;
      commitPos(pid, r.x, r.y, rot);
    }
    /** 짐 크기를 바꾼 뒤: 붙어 있던 벽은 그대로, 아니면 가운데 기준으로 — 방(안 되면 도면) 안에 머물게 */
    function refit(o, f, room, plan) {
      const reg = room || plan.bounds;
      const ax = (p0, s0, s1, lo, span) => {
        const a = Math.abs(p0 - lo) < 2, z = Math.abs(p0 + s0 - (lo + span)) < 2;
        if (a && !z) return p0;
        if (z && !a) return p0 + s0 - s1;
        return p0 + s0 / 2 - s1 / 2;
      };
      const r = { x: ax(o.x, o.w, f.w, reg.x, reg.w), y: ax(o.y, o.h, f.h, reg.y, reg.h), w: f.w, h: f.h };
      if (room && fitsIn(f, room)) Object.assign(r, clampInto(r, room));
      Object.assign(r, clampInto(r, plan.bounds));
      return r;
    }
    /** 규격 수정 (도면에 놓인 짐이면 저장 뒤 자리를 다시 맞춤) */
    function editSpec(invId) {
      const before = cur ? cur.items.filter((o) => o.it.id === invId).map((o) => ({
        pid: o.p.id, r: Object.assign({}, o.r), rot: o.p.rot === 90 ? 90 : 0, room: roomAt(cur.plan, o.r.x + o.r.w / 2, o.r.y + o.r.h / 2),
      })) : [];
      MV.inv.editor(invId, { onSave: (saved) => {
        if (!saved || !before.length) return;
        const plan = getPlan(key);
        if (!plan) return;
        const moves = [];
        let tooBig = null;
        before.forEach((b) => {
          const f = foot(saved, b.rot);
          if (Math.abs(f.w - b.r.w) < 0.5 && Math.abs(f.h - b.r.h) < 0.5) return;
          const r = refit(b.r, f, b.room, plan);
          moves.push([b.pid, r.x, r.y]);
          if (b.room && !fitsIn(f, b.room) && !tooBig) tooBig = { room: b.room, turn: fitsIn({ w: f.h, h: f.w }, b.room) };
        });
        if (moves.length) {
          MV.store.update((st) => {
            const P = layoutsOf(st)[key].placements;
            moves.forEach(([pid, x, y]) => { const p = P.find((z) => z.id === pid); if (p) { p.x = r1(x); p.y = r1(y); } });
          });
        }
        if (tooBig) {
          const rm = tooBig.room;
          setTimeout(() => toast(q(saved) + jo(saved.name, '이', '가') + ' ' + rm.name + '(' + Math.round(rm.w) + '×' + Math.round(rm.h) + 'cm)보다 커요' + (tooBig.turn ? ' — 돌리면 들어가요' : ''), { ms: 4500 }), 30);
        }
      } });
    }
    function removeSel() {
      const o = curSel();
      if (!o) return;
      const copy = MV.clone(o.p);
      const name = o.it.name;
      sel = null;
      MV.store.update((st) => { const L = layoutsOf(st)[key]; L.placements = L.placements.filter((x) => x.id !== copy.id); });
      toast(q({ name }) + jo(name, '을', '를') + ' 도면에서 뺐어요', { action: { label: '되돌리기', onClick: () => {
        // 그 사이 짐 목록에서 지워졌으면 보이지 않는 배치가 남지 않게 되돌리지 않음
        if (!MV.inv.get(copy.invId)) { setTimeout(() => toast('짐 목록에서 지워진 짐이라 되돌릴 수 없어요'), 30); return; }
        sel = copy.id;
        MV.store.update((st) => { const P = layoutsOf(st)[key].placements; if (!P.some((x) => x.id === copy.id)) P.push(copy); });
      } } });
    }
    function nudge(dx, dy) {
      const o = curSel();
      if (!o) return;
      const p = clampInto({ x: o.r.x + dx, y: o.r.y + dy, w: o.r.w, h: o.r.h }, cur.plan.bounds);
      if (Math.abs(p.x - o.r.x) < 0.01 && Math.abs(p.y - o.r.y) < 0.01) return;
      commitPos(o.p.id, p.x, p.y);
    }
    /** 화면 좌표 → 도면 좌표(cm) */
    function toPlan(clientX, clientY) {
      const r = stage.getBoundingClientRect();
      const vb = cur.vb || cur.plan.vb;
      return { x: (clientX - r.left) / cur.s + vb.x, y: (clientY - r.top) / cur.s + vb.y };
    }
    /** 확대·축소. at = 고정할 화면 위치(없으면 도면 창 가운데), pt = 그 자리에 둘 도면 좌표 */
    function setZoom(z, at, pt) {
      z = MV.clamp(z, 0.5, 5);
      if (!cur) return;
      const sr = scroll.getBoundingClientRect();
      const ax = at ? MV.clamp(at.x - sr.left, 0, scroll.clientWidth) : scroll.clientWidth / 2;
      const ay = at ? MV.clamp(at.y - sr.top, 0, scroll.clientHeight) : scroll.clientHeight / 2;
      const p = pt || toPlan(sr.left + ax, sr.top + ay);
      MV.store.update((st) => { prefsOf(st).zoom[key] = Math.round(z * 1000) / 1000; }, { silent: true });
      drawPlan(); syncToolbar();
      const r = stage.getBoundingClientRect();
      const offL = r.left - sr.left + scroll.scrollLeft, offT = r.top - sr.top + scroll.scrollTop;
      scroll.scrollLeft = offL + (p.x - cur.vb.x) * cur.s - ax;
      scroll.scrollTop = offT + (p.y - cur.vb.y) * cur.s - ay;
      drawSelBar();
    }
    function doExport() {
      if (!cur) return;
      bExport.disabled = true;
      exportPlanPNG(cur.plan, key, { grid: prefs().grid, items: cur.items, issues: cur.v.lv })
        .then(() => toast('도면 그림(PNG)을 저장했어요'))
        .catch((e) => toast('그림 저장 실패: ' + (e && e.message ? e.message : e)))
        .finally(() => { bExport.disabled = false; });
    }

    // ---- 방 고치기 · 그리기 · 지우기 ----
    /** 다른 방과 겹치지 않는 이름: '방' → '방 2' … */
    function uniqName(plan, base, exceptId) {
      const b0 = String(base || '방').trim() || '방';
      const used = (n) => plan.rooms.some((r) => r.id !== exceptId && norm(r.name) === norm(n));
      if (!used(b0)) return b0;
      for (let i = 2; i < 100; i++) if (!used(b0 + ' ' + i)) return b0 + ' ' + i;
      return b0 + ' ' + (Date.now() % 1000);
    }
    /** 방 창 — rid: 고칠 방 (원래 방·그린 방) / rect: 방금 그린 네모 (새 방) */
    function openRoomEditor(rid, rect) {
      const plan = getPlan(key);
      if (!plan) return;
      const isNew = !!rect;
      const r = isNew ? null : plan.rooms.find((x) => x.id === rid);
      if (!isNew && !r) { preview = null; drawOverlay(); return; }
      const isAdded = !isNew && r.added;
      // 말이 되는 범위: 원래 도면 크기를 기준으로 (오타 하나로 도면 전체가 망가지지 않게)
      const os = validRooms(plan).map((x) => x.orig).filter((x) => x.w > 0 && x.h > 0);
      const ob = { x0: Math.min(0, ...os.map((x) => x.x)), y0: Math.min(0, ...os.map((x) => x.y)),
        x1: Math.max(plan.width, plan.baseSize.width, ...os.map((x) => x.x + x.w)), y1: Math.max(plan.depth, plan.baseSize.depth, ...os.map((x) => x.y + x.h)) };
      const maxDim = Math.max(1200, Math.round(Math.max(ob.x1 - ob.x0, ob.y1 - ob.y0) * 1.5 / 10) * 10);
      const PAD = 500;
      const start = isNew ? { name: uniqName(plan, '방'), kind: 'bedroom', x: rect.x, y: rect.y, w: rect.w, h: rect.h } : r;
      const f = {};
      const numIn = (v) => el('input', { class: 'input num', type: 'number', inputmode: 'decimal', min: '0', step: '1', value: String(Math.round(v * 10) / 10) });
      f.name = el('input', { class: 'input', value: start.name, placeholder: '예: 안방' });
      const kinds = ROOM_KINDS.slice();
      if (!kinds.some(([id]) => id === start.kind)) kinds.push([start.kind, '기타 (' + start.kind + ')']);
      f.kind = el('select', { class: 'select' }, kinds.map(([id, label]) => el('option', { value: id, selected: id === start.kind }, label)));
      f.w = numIn(start.w); f.h = numIn(start.h); f.x = numIn(start.x); f.y = numIn(start.y);
      f.w.max = f.h.max = String(maxDim); f.w.min = f.h.min = String(MIN_ROOM);
      // 새 방: 이름을 직접 안 고쳤으면 종류를 바꿀 때 이름도 따라감
      let nameTouched = !isNew;
      f.name.addEventListener('input', () => { nameTouched = true; });
      const prev = el('div', { class: 'fp-area-prev', 'aria-live': 'polite' });
      const read = () => ({ name: f.name.value.trim(), kind: f.kind.value, w: parseFloat(f.w.value), h: parseFloat(f.h.value), x: parseFloat(f.x.value), y: parseFloat(f.y.value) });
      const fallbackName = (v) => v.name || (isNew ? uniqName(plan, kindLabel(v.kind)) : r.orig.name);
      /** 막아야 할 오류 → [{input, msg}] */
      const errorsOf = (v) => {
        const out = [];
        // 같은 이름의 방이 둘이면 짐의 '위치' 이름이 어느 방인지 알 수 없어져서 막음 (이름을 안 바꾼 경우는 그대로 둠)
        const nm = fallbackName(v);
        const clash = isNew ? nameClash(plan, null, nm) : norm(nm) !== norm(r.name) ? nameClash(plan, rid, nm) : null;
        if (clash) out.push([f.name, '「' + nm + '」' + jo(nm, '은', '는') + ' 이미 다른 방 이름이에요 — 다른 이름을 넣어 주세요 (예: ' + nm + ' 2)']);
        if (!isFinite(v.w)) out.push([f.w, '가로를 넣어 주세요']); else if (v.w < MIN_ROOM || v.w > maxDim) out.push([f.w, '가로 ' + Math.round(v.w) + 'cm — ' + MIN_ROOM + '~' + maxDim + 'cm 사이로 넣어 주세요']);
        if (!isFinite(v.h)) out.push([f.h, '세로를 넣어 주세요']); else if (v.h < MIN_ROOM || v.h > maxDim) out.push([f.h, '세로 ' + Math.round(v.h) + 'cm — ' + MIN_ROOM + '~' + maxDim + 'cm 사이로 넣어 주세요']);
        const okW = v.w >= MIN_ROOM && v.w <= maxDim, okH = v.h >= MIN_ROOM && v.h <= maxDim;
        if (!isFinite(v.x)) out.push([f.x, 'X를 넣어 주세요']); else if (v.x < ob.x0 - PAD || (okW && v.x + v.w > ob.x1 + PAD)) out.push([f.x, 'X 위치가 도면에서 너무 멀어요 (' + Math.round(ob.x0 - PAD) + '~' + Math.round(ob.x1 + PAD) + 'cm 안)']);
        if (!isFinite(v.y)) out.push([f.y, 'Y를 넣어 주세요']); else if (v.y < ob.y0 - PAD || (okH && v.y + v.h > ob.y1 + PAD)) out.push([f.y, 'Y 위치가 도면에서 너무 멀어요 (' + Math.round(ob.y0 - PAD) + '~' + Math.round(ob.y1 + PAD) + 'cm 안)']);
        return out;
      };
      const upd = () => {
        const v = read();
        const errs = errorsOf(v);
        [f.name, f.w, f.h, f.x, f.y].forEach((i) => { if (errs.some(([j]) => j === i)) i.setAttribute('aria-invalid', 'true'); else i.removeAttribute('aria-invalid'); });
        prev.textContent = '';
        prev.className = 'fp-area-prev' + (errs.length ? ' is-bad' : '');
        if (errs.length) { put(prev, errs.map(([, msg]) => el('div', '⛔ ' + msg))); return; }
        const a = (v.w * v.h) / 10000;
        if (isNew || isAdded) put(prev, el('strong', Math.round(v.w) + '×' + Math.round(v.h) + 'cm = ' + fmtA(a)), el('span', { class: 'muted' }, ' · ' + kindLabel(v.kind) + (isNew ? ' · 새로 그린 방' : ' · 직접 그린 방')));
        else {
          const a0 = area(r.orig);
          put(prev, el('strong', Math.round(v.w) + '×' + Math.round(v.h) + 'cm = ' + fmtA(a)),
            el('span', { class: 'muted' }, ' · 원래 도면 ' + Math.round(r.orig.w) + '×' + Math.round(r.orig.h) + ' (' + fmtA(a0) + ', ' + fmtD(r1(a) - r1(a0)) + ')'));
        }
        const me = { x: v.x, y: v.y, w: v.w, h: v.h };
        const ov = validRooms(plan).filter((o) => isNew || o.id !== rid).map((o) => ({ o, i: inter(me, o) })).filter((z) => z.i && z.i.w > 2 && z.i.h > 2);
        const warns = [];
        if (!isNew && !isAdded) {
          const a0 = area(r.orig);
          if (a0 > 0 && (a / a0 > 2 || a / a0 < 0.5)) warns.push('원래 도면보다 ' + (a > a0 ? '2배 넘게 커졌어요' : '절반 아래로 작아졌어요') + ' — 숫자를 다시 확인하세요');
        }
        ov.slice(0, 3).forEach(({ o, i }) => warns.push('옆 공간 「' + o.name + '」' + jo(o.name, '과', '와') + ' ' + Math.round(i.w) + '×' + Math.round(i.h) + 'cm 겹쳐요 — ' + (isNew ? '겹친 방을 지우거나 줄여 주세요' : '실측이 맞다면 그 방도 고쳐 주세요')));
        if (warns.length) put(prev, el('div', { class: 'fp-prev-warn' }, warns.map((w) => el('div', '⚠️ ' + w))));
      };
      f.kind.addEventListener('change', () => { if (!nameTouched) f.name.value = uniqName(plan, kindLabel(f.kind.value)); upd(); });
      [f.name, f.w, f.h, f.x, f.y].forEach((i) => i.addEventListener('input', upd));
      upd();
      const field = (label, input, hint2) => el('label', { class: 'field' }, el('span', label), input, hint2 ? el('small', { class: 'hint' }, hint2) : null);
      const save = () => {
        const v = read();
        const errs = errorsOf(v);
        if (errs.length) { upd(); try { errs[0][0].focus(); } catch (e) { /* 무시 */ } return false; }
        const newName = fallbackName(v);
        const nv = { x: r1(v.x), y: r1(v.y), w: r1(v.w), h: r1(v.h), name: newName, kind: v.kind };
        if (isNew) {
          const entry = Object.assign({ id: MV.uid('rm') }, nv);
          MV.store.update((st) => { editsOf(st)[key].added.push(entry); },
            { log: '➕ ' + PLAN_LABEL[key] + ' 방 그리기: ' + newName + ' ' + Math.round(v.w) + '×' + Math.round(v.h) + 'cm' });
          toast('「' + shortName(newName, 12) + '」' + jo(newName, '을', '를') + ' 그렸어요', { action: { label: '되돌리기', onClick: () => {
            MV.store.update((st) => { const E = editsOf(st)[key]; E.added = E.added.filter((a) => !a || a.id !== entry.id); }, { log: '↩ 방 그리기 되돌림: ' + newName });
          } } });
          return true;
        }
        const same = (o) => ['x', 'y', 'w', 'h'].every((k2) => Math.abs(nv[k2] - r1(o[k2])) < 0.05) && nv.name === o.name && nv.kind === o.kind;
        if (same(r)) return true;                     // 바뀐 게 없으면 저장하지 않음 (실측 반영 표시도 안 생김)
        const before = getPlan(key);
        let moved = 0;
        if (isAdded) {
          MV.store.update((st) => {
            const a = editsOf(st)[key].added.find((z) => z && String(z.id) === String(r.srcId));
            if (a) Object.assign(a, nv);
            moved = remapRoomRefs(st, key, before, [{ rid, from: r.name, to: newName }]);
          }, { log: '✏️ ' + PLAN_LABEL[key] + ' 그린 방 수정: ' + newName + ' ' + Math.round(v.w) + '×' + Math.round(v.h) + 'cm' });
        } else {
          const backToOrig = same(r.orig);             // 원래 값으로 되돌린 경우는 수정 기록을 지움
          MV.store.update((st) => {
            if (backToOrig) delete editsOf(st)[key].rooms[rid];
            else editsOf(st)[key].rooms[rid] = nv;
            moved = remapRoomRefs(st, key, before, [{ rid, from: r.name, to: newName }]);
          }, { log: '📏 ' + PLAN_LABEL[key] + (backToOrig ? ' 치수 원래대로: ' + newName : ' 실측 반영: ' + newName + ' ' + Math.round(v.w) + '×' + Math.round(v.h) + 'cm') });
        }
        if (moved) toast('짐 ' + moved + '개의 “' + (key === 'new' ? '새 집 위치' : '지금 집 위치') + '”도 「' + newName + '」' + joRo(newName) + ' 바꿨어요');
        return true;
      };
      let m = null;
      [f.name, f.w, f.h, f.x, f.y].forEach((i) => i.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); if (save() && m) m.close(); } }));
      const actions = [];
      if (!isNew) actions.push({ label: '🗑 방 삭제', kind: 'danger', onClick: (close) => { deleteRoom(r).then((ok) => { if (ok) close(); }); return false; } });
      if (!isNew && !isAdded && r.edited) actions.push({ label: '원래대로', kind: 'danger', onClick: () => {
        const before = getPlan(key);
        const clash = r.name !== r.orig.name ? nameClash(before, rid, r.orig.name) : null;
        if (clash) {
          // 원래 이름을 다른 방이 쓰고 있으면 되돌리면 이름이 겹침 → 그 방 이름부터 바꾸게 안내
          prev.className = 'fp-area-prev is-bad';
          prev.textContent = '⛔ 원래 이름 「' + r.orig.name + '」' + jo(r.orig.name, '을', '를') + ' 지금 다른 방(' + Math.round(clash.w) + '×' + Math.round(clash.h) + ')이 쓰고 있어요. 그 방 이름을 먼저 바꾼 뒤 되돌려 주세요.';
          return false;
        }
        let moved = 0;
        MV.store.update((st) => { delete editsOf(st)[key].rooms[rid]; moved = remapRoomRefs(st, key, before, [{ rid, from: r.name, to: r.orig.name }]); }, { log: '📏 ' + PLAN_LABEL[key] + ' 치수 원래대로: ' + r.orig.name });
        if (moved) toast('짐 ' + moved + '개의 위치 이름도 「' + r.orig.name + '」' + joRo(r.orig.name) + ' 되돌렸어요');
        return true;
      } });
      actions.push({ label: '취소', kind: 'ghost' });
      actions.push({ label: isNew ? '추가' : '저장', kind: 'primary', onClick: () => save() });
      m = MV.ui.modal({
        title: isNew ? '＋ 새 방' : (isAdded ? '✏️ ' : '📏 ') + r.name + ' 고치기',
        body: el('div', { class: 'stack' },
          el('p', { class: 'small muted mb-0' }, isNew
            ? '그린 네모의 이름과 종류를 정하세요. 숫자(cm)로 더 정확히 고칠 수 있어요. X·Y는 도면 왼쪽 위에서부터의 위치예요.'
            : '벽 안쪽 기준 실측값(cm)을 넣으세요. X·Y는 도면 왼쪽 위에서부터의 위치예요. 옆 방은 자동으로 바뀌지 않아요. 이름을 바꾸면 이 방에 둔 짐의 위치 이름도 함께 바뀌어요.'),
          el('div', { class: 'form-grid' }, field('방 이름', f.name), field('종류', f.kind, '다용도실이면 세탁기 점검, 발코니면 면적 따로')),
          el('div', { class: 'form-grid' }, field('가로 W (cm)', f.w), field('세로 H (cm)', f.h), field('X (cm)', f.x), field('Y (cm)', f.y)),
          prev),
        actions,
        onClose: () => { if (isNew) { preview = null; drawOverlay(); } },
      });
    }
    /** 방 지우기 (원래 방은 '지운 방' 목록에, 그린 방은 목록에서 뺌) → Promise<지웠는지> */
    function deleteRoom(r) {
      const placedIn = cur ? cur.items.filter((o) => hasPt(r, o.r.x + o.r.w / 2, o.r.y + o.r.h / 2)).length : 0;
      const ownDoors = cur ? cur.plan.doors.filter((d) => d._added && d.room === r.id).length : 0;
      return MV.ui.confirm('「' + r.name + '」' + jo(r.name, '을', '를') + ' 도면에서 지울까요?'
        + (r.added ? (ownDoors ? ' 이 방에 단 문도 함께 지워져요.' : '') : ' 이 방에만 붙은 문·창·고정물도 함께 숨겨져요.')
        + (placedIn ? ' 이 방에 놓인 짐 ' + placedIn + '개는 그 자리에 그대로 남아요.' : ''), { danger: true, okLabel: '방 지우기', title: '방 삭제' }).then((ok) => {
        if (!ok) return false;
        let snap = null;
        MV.store.update((st) => {
          const E = editsOf(st)[key];
          if (r.added) {
            const i = E.added.findIndex((a) => a && String(a.id) === String(r.srcId));
            if (i >= 0) {
              snap = { i, entry: MV.clone(E.added[i]), doors: [] };
              E.added.splice(i, 1);
              // 그린 방은 되살릴 곳이 없으므로, 이 방에 단 문 중 (다른 방 벽에도 걸치지 않아) 이제 숨겨질 문은 함께 지움 — 되돌리기로 다시 살림
              const after = getPlan(key);
              const shown = new Set(after ? after.doors.filter((d) => d._added).map((d) => d.id) : []);
              E.doorsAdded = E.doorsAdded.filter((d, j) => {
                if (!d || typeof d !== 'object' || String(d.room) !== r.id) return true;
                if (shown.has(d.id != null ? String(d.id) : 'door' + j)) return true;
                snap.doors.push({ j, entry: MV.clone(d) });
                return false;
              });
            }
          } else if (!E.deleted.map(String).includes(r.id)) E.deleted.push(r.id);
        }, { log: '🗑 ' + PLAN_LABEL[key] + ' 방 삭제: ' + r.name });
        toast('「' + shortName(r.name, 12) + '」' + jo(r.name, '을', '를') + ' 지웠어요', { action: { label: '되돌리기', onClick: () => restoreRoom(r, snap) } });
        return true;
      });
    }
    function restoreRoom(r, snap) {
      MV.store.update((st) => {
        const E = editsOf(st)[key];
        if (r.added) {
          if (snap && !E.added.some((a) => a && String(a.id) === String(snap.entry.id))) {
            E.added.splice(Math.min(snap.i, E.added.length), 0, snap.entry);
            // 함께 지웠던 문도 원래 자리(순서)로
            (snap.doors || []).forEach(({ j, entry }) => {
              if (!E.doorsAdded.some((z) => z && entry.id != null && z.id === entry.id)) E.doorsAdded.splice(Math.min(j, E.doorsAdded.length), 0, entry);
            });
          }
        } else E.deleted = E.deleted.filter((id) => String(id) !== r.id);
      }, { log: '↩ ' + PLAN_LABEL[key] + ' 방 되살림: ' + r.name });
      const plan = getPlan(key);
      const clash = plan ? nameClash(plan, r.id, r.name) : null;
      setTimeout(() => toast(clash ? '「' + shortName(r.name, 12) + '」' + jo(r.name, '과', '와') + ' 이름이 같은 방이 있어요 — ✏️ 방 고치기로 한쪽 이름을 바꿔 주세요'
        : '「' + shortName(r.name, 12) + '」' + jo(r.name, '을', '를') + ' 되살렸어요', { ms: clash ? 5500 : undefined }), 30);
    }

    // ---- 전체 크기 ----
    function openSizeEditor() {
      const plan = getPlan(key);
      if (!plan) return;
      const rs = validRooms(plan);
      const ext = rs.length ? { w: Math.max(...rs.map((r) => r.x + r.w)), h: Math.max(...rs.map((r) => r.y + r.h)) } : { w: plan.width, h: plan.depth };
      const up5 = (v) => Math.ceil(v / SNAP - 0.001) * SNAP;
      const numIn = (v) => el('input', { class: 'input num', type: 'number', inputmode: 'decimal', min: '100', max: '3000', step: '1', value: String(Math.round(v * 10) / 10) });
      const fW = numIn(plan.width), fD = numIn(plan.depth);
      const prev = el('div', { class: 'fp-area-prev', 'aria-live': 'polite' });
      const read = () => ({ w: parseFloat(fW.value), d: parseFloat(fD.value) });
      const errorsOf = (v) => {
        const out = [];
        if (!isFinite(v.w) || v.w < 100 || v.w > 3000) out.push([fW, '가로는 100~3000cm 사이로 넣어 주세요']);
        if (!isFinite(v.d) || v.d < 100 || v.d > 3000) out.push([fD, '세로(깊이)는 100~3000cm 사이로 넣어 주세요']);
        return out;
      };
      const upd = () => {
        const v = read();
        const errs = errorsOf(v);
        [fW, fD].forEach((i) => { if (errs.some(([j]) => j === i)) i.setAttribute('aria-invalid', 'true'); else i.removeAttribute('aria-invalid'); });
        prev.textContent = '';
        prev.className = 'fp-area-prev' + (errs.length ? ' is-bad' : '');
        if (errs.length) { put(prev, errs.map(([, msg]) => el('div', '⛔ ' + msg))); return; }
        put(prev, el('strong', Math.round(v.w) + '×' + Math.round(v.d) + 'cm'), el('span', { class: 'muted' }, ' · 원래 도면 ' + Math.round(plan.baseSize.width) + '×' + Math.round(plan.baseSize.depth) + 'cm'));
        const outside = rs.filter((r) => r.x + r.w > v.w + 1 || r.y + r.h > v.d + 1 || r.x < -1 || r.y < -1);
        if (outside.length) put(prev, el('div', { class: 'fp-prev-warn' }, el('div', '⚠️ 방 ' + outside.length + '개가 이 크기 밖으로 나가요 (' + outside.slice(0, 4).map((r) => r.name).join(', ') + (outside.length > 4 ? ' …' : '') + ') — 그 방도 고치거나 지워 주세요')));
      };
      [fW, fD].forEach((i) => i.addEventListener('input', upd));
      upd();
      const save = () => {
        const v = read();
        const errs = errorsOf(v);
        if (errs.length) { upd(); try { errs[0][0].focus(); } catch (e) { /* 무시 */ } return false; }
        const w = r1(v.w), d = r1(v.d);
        const back = Math.abs(w - plan.baseSize.width) < 0.05 && Math.abs(d - plan.baseSize.depth) < 0.05;
        if (Math.abs(w - plan.width) < 0.05 && Math.abs(d - plan.depth) < 0.05) return true;
        MV.store.update((st) => { const E = editsOf(st)[key]; if (back) delete E.size; else E.size = { width: w, depth: d }; },
          { log: '📐 ' + PLAN_LABEL[key] + ' 전체 크기 ' + (back ? '원래대로' : Math.round(w) + '×' + Math.round(d) + 'cm') });
        toast('전체 크기를 ' + Math.round(w) + '×' + Math.round(d) + 'cm로 맞췄어요');
        return true;
      };
      let m = null;
      [fW, fD].forEach((i) => i.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); if (save() && m) m.close(); } }));
      const field = (label, input, hint2) => el('label', { class: 'field' }, el('span', label), input, hint2 ? el('small', { class: 'hint' }, hint2) : null);
      const actions = [];
      if (plan.sizeEdited) actions.push({ label: '원래 크기', kind: 'danger', onClick: () => {
        MV.store.update((st) => { delete editsOf(st)[key].size; }, { log: '📐 ' + PLAN_LABEL[key] + ' 전체 크기 원래대로' });
        toast('전체 크기를 원래 도면대로 되돌렸어요');
      } });
      actions.push({ label: '취소', kind: 'ghost' });
      actions.push({ label: '저장', kind: 'primary', onClick: () => save() });
      m = MV.ui.modal({
        title: '📐 ' + PLAN_LABEL[key] + ' 전체 크기',
        body: el('div', { class: 'stack' },
          el('p', { class: 'small muted mb-0' }, '집 바깥벽 기준 전체 가로·세로(cm)예요. 외곽선·치수선·화면 맞춤이 이 크기를 따라가요. 방 크기는 따로 고쳐야 해요.'),
          el('div', { class: 'form-grid' }, field('전체 가로 (cm)', fW), field('전체 세로·깊이 (cm)', fD)),
          el('div', { class: 'row' }, el('button', { type: 'button', class: 'btn fp-b', onclick: () => { fW.value = String(up5(ext.w)); fD.value = String(up5(ext.h)); upd(); } },
            '방에 맞추기 (' + up5(ext.w) + '×' + up5(ext.h) + ')')),
          prev),
        actions,
      });
    }

    // ---- 문 추가 · 삭제 ----
    function addDoorAt(P) {
      const plan = cur.plan;
      const thr = Math.max(25, 30 / cur.s);
      let best = null;
      validRooms(plan).forEach((r) => {
        const inside = hasPt(r, P.x, P.y);
        [['T', Math.abs(P.y - r.y)], ['B', Math.abs(P.y - r.y - r.h)], ['L', Math.abs(P.x - r.x)], ['R', Math.abs(P.x - r.x - r.w)]].forEach(([side, dist]) => {
          const horiz = side === 'T' || side === 'B';
          const along = horiz ? P.x >= r.x - 5 && P.x <= r.x + r.w + 5 : P.y >= r.y - 5 && P.y <= r.y + r.h + 5;
          if (!along || dist > thr) return;
          const score = dist + (inside ? 0 : thr);   // 누른 곳이 들어 있는 방을 먼저
          if (!best || score < best.score) best = { r, side, score };
        });
      });
      if (!best) { toast('문을 달 방의 벽(가장자리) 가까이를 눌러 주세요'); return; }
      const { r, side } = best;
      const horiz = side === 'T' || side === 'B';
      const len = horiz ? r.w : r.h;
      if (len < 50) { toast('이 벽은 너무 짧아 문을 달 수 없어요'); return; }
      const w = Math.max(40, Math.min(NEW_DOOR_W, Math.floor((len - 10) / SNAP) * SNAP));
      const lo = (horiz ? r.x : r.y) + 5, hi = Math.max(lo, (horiz ? r.x + r.w : r.y + r.h) - 5 - w);
      let at = Math.round(((horiz ? P.x : P.y) - w / 2) / SNAP) * SNAP;
      at = r1(MV.clamp(at, lo, hi));
      const d = { id: MV.uid('dr'), x: horiz ? at : r1(side === 'L' ? r.x : r.x + r.w), y: horiz ? r1(side === 'T' ? r.y : r.y + r.h) : at, width: w,
        orientation: horiz ? 'h' : 'v', swing: side === 'T' ? 'down' : side === 'B' ? 'up' : side === 'L' ? 'right' : 'left', hinge: 'start', room: r.id };
      const g = doorGeom(d);
      const clash = plan.doors.some((o) => o.orientation === d.orientation && hit(doorGeom(o).gap, g.gap, 2));
      if (clash) { toast('그 자리엔 이미 문이 있어요 — 조금 옆을 눌러 주세요'); return; }
      MV.store.update((st) => { editsOf(st)[key].doorsAdded.push(d); }, { log: '🚪 ' + PLAN_LABEL[key] + ' 문 추가: ' + r.name + ' (' + w + 'cm)' });
      toast(shortName(r.name, 12) + '에 문(' + w + 'cm)을 달았어요', { action: { label: '되돌리기', onClick: () => {
        MV.store.update((st) => { const E = editsOf(st)[key]; E.doorsAdded = E.doorsAdded.filter((z) => !z || z.id !== d.id); }, { log: '↩ 문 추가 되돌림' });
      } } });
    }
    function askDeleteDoor(dk) {
      const d = cur && cur.plan.doors.find((x) => x._key === dk);
      if (!d) return;
      const label = d._added ? '직접 추가한 문' : (d.note ? String(d.note).split(/[.(]/)[0].trim() : '') || '문';
      // 어느 문을 골랐는지 도면에 진하게 표시 (확인 창 뒤로 보임)
      const mark = (on) => { if (svgEl) svgEl.querySelectorAll('.fp-doorhit').forEach((n) => n.classList.toggle('is-pick', on && n.getAttribute('data-door') === dk)); };
      mark(true);
      ui.confirm('「' + label + '」' + jo(label, '을', '를') + ' 도면에서 지울까요? 문이 없어진 자리는 벽으로 그려져요.', { danger: true, okLabel: '문 지우기', title: '문 삭제' }).then((ok) => {
        mark(false);
        if (!ok) return;
        let snap = null;
        const k0 = doorKey(d);
        MV.store.update((st) => {
          const E = editsOf(st)[key];
          if (d._added) {
            const i = E.doorsAdded.findIndex((z) => z && String(z.id) === d.id);
            if (i >= 0) { snap = { i, entry: MV.clone(E.doorsAdded[i]) }; E.doorsAdded.splice(i, 1); }
          } else if (!E.doorsDeleted.includes(k0)) E.doorsDeleted.push(k0);
        }, { log: '🚪 ' + PLAN_LABEL[key] + ' 문 삭제: ' + label });
        toast('문을 지웠어요', { action: { label: '되돌리기', onClick: () => {
          MV.store.update((st) => {
            const E = editsOf(st)[key];
            if (d._added) { if (snap && !E.doorsAdded.some((z) => z && z.id === snap.entry.id)) E.doorsAdded.splice(Math.min(snap.i, E.doorsAdded.length), 0, snap.entry); }
            else E.doorsDeleted = E.doorsDeleted.filter((z) => z !== k0);
          }, { log: '↩ 문 삭제 되돌림' });
        } } });
      });
    }
    function resetAllRooms() {
      MV.ui.confirm(PLAN_LABEL[key] + ' 도면에서 고친 것(방 치수·이름·종류, 그린 방, 지운 방, 전체 크기, 문 추가·삭제)을 모두 지우고 원래 도면으로 되돌릴까요? 평면도 사진은 그대로 둬요.', { danger: true, okLabel: '원래대로', title: '도면 전체 원래대로' }).then((ok) => {
        if (!ok) return;
        const plan = getPlan(key);
        // 짐의 '위치' 이름 되돌리기: 이름을 바꾼 원래 방(지운 방 포함) → 원래 이름, 직접 그린 방 → 그 자리의 원래 방 이름
        const changes = [];
        if (plan) {
          const all = plan.rooms.concat(plan.removed);
          all.filter((x) => !x.added && x.edited && x.name !== x.orig.name).forEach((x) => changes.push({ rid: x.id, from: x.name, to: x.orig.name }));
          const origs = all.filter((x) => !x.added && x.orig.w > 0 && x.orig.h > 0).map((x) => x.orig);
          all.filter((x) => x.added).forEach((a) => {
            const cx = a.x + a.w / 2, cy = a.y + a.h / 2;
            let best = null;
            origs.forEach((o2) => { if (hasPt(o2, cx, cy) && (!best || area(o2) < area(best))) best = o2; });
            if (best) changes.push({ rid: a.id, from: a.name, to: best.name });
          });
        }
        let moved = 0;
        MV.store.update((st) => {
          const E = editsOf(st)[key];
          E.rooms = {}; E.added = []; E.deleted = []; E.doorsAdded = []; E.doorsDeleted = [];
          delete E.size;
          // 모든 이름을 '바꾸기 전' 기준으로 한꺼번에 되돌림 (작은방1→서재, 서재→옷방 같은 연쇄도 안전하게)
          if (plan && changes.length) moved = remapRoomRefs(st, key, plan, changes);
        }, { log: '📏 ' + PLAN_LABEL[key] + ' 도면 전체 원래대로' });
        toast('원래 도면으로 되돌렸어요' + (moved ? ' · 짐 ' + moved + '개의 “' + (key === 'new' ? '새 집 위치' : '지금 집 위치') + '”도 원래 방 이름으로' : ''));
      });
    }

    // ---- 포인터(마우스·터치·펜) 끌기 ----
    function magnet(x, y, w, h) {
      const thr = Math.max(4, 10 / cur.s);
      let bx = null, bdx = thr, by = null, bdy = thr;
      validRooms(cur.plan).forEach((r) => {
        if (y < r.y + r.h && y + h > r.y) {
          [r.x, r.x + r.w].forEach((ex) => {
            const d1 = Math.abs(x - ex), d2 = Math.abs(x + w - ex);
            if (d1 < bdx) { bdx = d1; bx = ex; }
            if (d2 < bdx) { bdx = d2; bx = ex - w; }
          });
        }
        if (x < r.x + r.w && x + w > r.x) {
          [r.y, r.y + r.h].forEach((ey) => {
            const d1 = Math.abs(y - ey), d2 = Math.abs(y + h - ey);
            if (d1 < bdy) { bdy = d1; by = ey; }
            if (d2 < bdy) { bdy = d2; by = ey - h; }
          });
        }
      });
      return [bx != null ? bx : x, by != null ? by : y];
    }
    /** 끄는 중인 짐 위치 계산: 화면·도면 창 스크롤까지 반영, 스냅·벽 자석, 도면 밖으로는 못 나가게 */
    function dragPos() {
      const d = drag;
      const dxp = d.cx - d.sx + (scroll.scrollLeft - d.sl0) + (window.scrollX - d.wx0);
      const dyp = d.cy - d.sy + (scroll.scrollTop - d.st0) + (window.scrollY - d.wy0);
      let x = d.x0 + dxp / cur.s, y = d.y0 + dyp / cur.s;
      if (prefs().snap) {
        x = Math.round(x / SNAP) * SNAP; y = Math.round(y / SNAP) * SNAP;
        [x, y] = magnet(x, y, d.w, d.h);
      }
      ({ x, y } = clampInto({ x, y, w: d.w, h: d.h }, cur.plan.bounds));
      d.x = r1(x); d.y = r1(y);
      d.g.setAttribute('transform', 'translate(' + d.x + ' ' + d.y + ')');
    }
    // 가장자리 가까이 끌면 도면 창(확대 시)과 화면을 자동으로 굴림
    let autoRaf = 0;
    const stopAuto = () => { if (autoRaf) cancelAnimationFrame(autoRaf); autoRaf = 0; };
    ctx.onCleanup(stopAuto);
    const pxv = (name, d) => { const v = parseFloat(getComputedStyle(document.documentElement).getPropertyValue(name)); return isFinite(v) ? v : d; };
    /** 손가락·마우스(cx, cy)가 도면 창·화면 가장자리 가까이 있으면 한 번 굴림 → { moved: 실제로 굴렀는지, go: 계속 살필지 }.
        topEdge = 화면 위쪽 한계 (기본: 위 막대 아래 — 사진 맞추기 안내 띠가 떠 있으면 그 아래) */
    function edgeScroll(cx, cy, topEdge) {
      const E = 44;
      const sp = (dist) => Math.round(MV.clamp(2 + dist * 0.25, 2, 16));
      const sr = scroll.getBoundingClientRect();
      let vx = 0, vy = 0, wy = 0;
      if (scroll.scrollWidth > scroll.clientWidth + 1) {
        if (cx < sr.left + E) vx = -sp(sr.left + E - cx); else if (cx > sr.right - E) vx = sp(cx - sr.right + E);
      }
      if (scroll.scrollHeight > scroll.clientHeight + 1) {
        if (cy < sr.top + E) vy = -sp(sr.top + E - cy); else if (cy > sr.bottom - E) vy = sp(cy - sr.bottom + E);
      }
      const topLim = (topEdge == null ? pxv('--topbar-h', 56) : topEdge) + E, botLim = window.innerHeight - pxv('--bottom-h', 0) - E;
      if (cy < topLim && sr.top < topLim - E) wy = -sp(topLim - cy);
      else if (cy > botLim && sr.bottom > botLim + E) wy = sp(cy - botLim);
      let moved = false, movedY = false;
      if (vx || vy) {
        const l0 = scroll.scrollLeft, t0 = scroll.scrollTop;
        scroll.scrollLeft = l0 + vx; scroll.scrollTop = t0 + vy;
        movedY = scroll.scrollTop !== t0;
        moved = scroll.scrollLeft !== l0 || movedY;
      }
      // 화면(페이지)은 도면 창이 더 굴러가지 않을 때만 — 둘이 함께 굴러 너무 빨라지지 않게
      if (wy && !movedY) { const y0 = window.scrollY; window.scrollBy(0, wy); moved = moved || window.scrollY !== y0; }
      return { moved, go: !!(moved || vx || vy || wy) };
    }
    function autoTick() {
      autoRaf = 0;
      if (!drag || !drag.moved || !root.isConnected) return;
      const r = edgeScroll(drag.cx, drag.cy);
      if (r.moved) dragPos();
      if (r.go) autoRaf = requestAnimationFrame(autoTick);
    }
    // 사진 옮기기·점 옮기기·방 그리기도 가장자리에서 화면이 따라가게 (손가락이 도면을 굴리지 못하는 동안 길이 막히지 않도록)
    let gestRaf = 0;
    const stopGestAuto = () => { if (gestRaf) cancelAnimationFrame(gestRaf); gestRaf = 0; };
    ctx.onCleanup(stopGestAuto);
    function gestTick() {
      gestRaf = 0;
      if (!gest || !gest.moved || !root.isConnected) return;
      const top = pxv('--topbar-h', 56);
      const wb = !wizBar.hidden && getComputedStyle(wizBar).position === 'sticky' ? wizBar.getBoundingClientRect().bottom : 0;
      const r = edgeScroll(gest.cx, gest.cy, Math.max(top, wb));
      if (r.moved) applyGest();
      if (r.go) gestRaf = requestAnimationFrame(gestTick);
    }
    /** 끌기 취소 (두 번째 손가락이 닿아 확대로 바뀔 때). 다시 그리면 터치 대상이 사라지므로 제자리로만 돌려 놓음 */
    function cancelDrag() {
      if (!drag) return;
      const d = drag;
      drag = null;
      stopAuto();
      try { stage.releasePointerCapture(d.id); } catch (err) { /* 무시 */ }
      if (svgEl) svgEl.classList.remove('is-dragging');
      d.g.setAttribute('transform', 'translate(' + r1(d.x0) + ' ' + r1(d.y0) + ')');
      lastUp = Date.now();
    }
    stage.addEventListener('pointerdown', (e) => {
      if (editMode || wiz || gest || !cur || !svgEl || drag || pinch) return;
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      const g = e.target.closest && e.target.closest('.fp-item');
      if (!g || !svgEl.contains(g)) return;
      const o = cur.items.find((x) => x.p.id === g.getAttribute('data-pid'));
      if (!o) return;
      e.preventDefault();
      drag = { pid: o.p.id, id: e.pointerId, sx: e.clientX, sy: e.clientY, cx: e.clientX, cy: e.clientY, x0: o.r.x, y0: o.r.y, x: o.r.x, y: o.r.y, w: o.r.w, h: o.r.h, g, moved: false, type: e.pointerType,
        sl0: scroll.scrollLeft, st0: scroll.scrollTop, wx0: window.scrollX, wy0: window.scrollY };
      try { stage.setPointerCapture(e.pointerId); } catch (err) { /* 무시 */ }
      svgEl.querySelectorAll('.fp-item.is-sel').forEach((n) => { if (n !== g) n.classList.remove('is-sel'); });
      g.classList.add('is-sel');
      g.parentNode.appendChild(g);  // 맨 위로
      try { g.focus({ preventScroll: true }); } catch (err) { /* 무시 */ }
    });
    stage.addEventListener('pointermove', (e) => {
      if (!drag || e.pointerId !== drag.id) return;
      drag.cx = e.clientX; drag.cy = e.clientY;
      if (!drag.moved) {
        if (Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy) < (drag.type === 'mouse' ? 3 : 6)) return;
        drag.moved = true;
        svgEl.classList.add('is-dragging');
        selBar.hidden = true;
      }
      e.preventDefault();
      dragPos();
      if (!autoRaf) autoRaf = requestAnimationFrame(autoTick);
    });
    const endDrag = (e) => {
      if (!drag || e.pointerId !== drag.id) return;
      const d = drag;
      drag = null;
      stopAuto();
      try { stage.releasePointerCapture(e.pointerId); } catch (err) { /* 무시 */ }
      if (svgEl) svgEl.classList.remove('is-dragging');
      lastUp = Date.now();
      sel = d.pid;
      if (d.moved && (d.x !== d.x0 || d.y !== d.y0)) commitPos(d.pid, d.x, d.y);
      else refresh();
    };
    stage.addEventListener('pointerup', endDrag);
    stage.addEventListener('pointercancel', endDrag);
    // 손가락으로 짐·축척 점을 끌 때 화면이 대신 움직이지 않게 (SVG 안 요소의 touch-action 은 브라우저마다 안 먹을 수 있어 직접 막음)
    stage.addEventListener('touchstart', (e) => {
      if (e.touches.length !== 1 || !e.target.closest) return;
      if (!editMode && !wiz && e.target.closest('.fp-item')) e.preventDefault();
      else if (wiz && wiz.step === 'pts' && e.target.closest('.fp-wizpt')) e.preventDefault();
    }, { passive: false });

    // ---- 사진 끌기 · 축척 점 옮기기 · 방 그리기 (마우스·터치·펜) ----
    /** 방 그리기 점: 5cm 단위, 스냅이 켜져 있으면 가까운 방 벽·외곽에 붙음 (붙는 거리는 화면 10px, 많아야 12cm — 폰에서 크게 튀지 않게) */
    function snapPt(P) {
      let x = Math.round(P.x / SNAP) * SNAP, y = Math.round(P.y / SNAP) * SNAP;
      if (prefs().snap && cur) {
        const thr = Math.max(4, Math.min(12, 10 / cur.s));
        const xs = [0, cur.plan.width], ys = [0, cur.plan.depth];
        validRooms(cur.plan).forEach((r) => { xs.push(r.x, r.x + r.w); ys.push(r.y, r.y + r.h); });
        let bd = thr;
        xs.forEach((v) => { const d = Math.abs(P.x - v); if (d < bd) { bd = d; x = v; } });
        bd = thr;
        ys.forEach((v) => { const d = Math.abs(P.y - v); if (d < bd) { bd = d; y = v; } });
      }
      return { x: r1(x), y: r1(y) };
    }
    const rectFrom = (a, b) => ({ x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: r1(Math.abs(b.x - a.x)), h: r1(Math.abs(b.y - a.y)) });
    /** 지금 손가락 위치(gest.cx, cy)로 끄는 중인 것을 다시 그림 — 화면이 굴러가도 맞도록 매번 도면 좌표로 바꿔 계산 */
    function applyGest() {
      const g = gest;
      if (!g || !cur) return;
      const P = toPlan(g.cx, g.cy);
      if (g.type === 'bgmove') {
        g.x = r1(g.x0 + P.x - g.P0.x);
        g.y = r1(g.y0 + P.y - g.P0.y);
        const im = svgEl && svgEl.querySelector('.fp-bg image');
        if (im) im.setAttribute('transform', bgTransform(g.bg, g.x, g.y));
      } else if (g.type === 'pt') {
        if (!wiz) return;
        wiz.pts[g.i] = P;
        drawOverlay();
        syncWizDist();
      } else if (g.type === 'draw') {
        g.rect = rectFrom(g.a, snapPt(P));
        drawOverlay();
      }
    }
    function cancelGest() {
      if (!gest) return;
      const g = gest;
      gest = null;
      stopGestAuto();
      try { stage.releasePointerCapture(g.id); } catch (err) { /* 무시 */ }
      lastUp = Date.now();
      if (g.type === 'bgmove') { const im = svgEl && svgEl.querySelector('.fp-bg image'); if (im) im.setAttribute('transform', bgTransform(g.bg, g.x0, g.y0)); }
      if (g.type === 'pt' && wiz && g.p0) { wiz.pts[g.i] = g.p0; syncWizDist(); }
      drawOverlay();
    }
    stage.addEventListener('pointerdown', (e) => {
      if (!cur || !svgEl || drag || pinch || gest) return;
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      const base = { id: e.pointerId, sx: e.clientX, sy: e.clientY, cx: e.clientX, cy: e.clientY, moved: false, ptype: e.pointerType };
      if (wiz) {
        if (wiz.step === 'move') {
          const bg = bgOf(key);
          if (!bg) return;
          e.preventDefault();
          gest = Object.assign(base, { type: 'bgmove', bg, x0: bg.x, y0: bg.y, x: bg.x, y: bg.y, P0: toPlan(e.clientX, e.clientY) });
        } else if (wiz.step === 'pts') {
          const t = e.target.closest && e.target.closest('.fp-wizpt');
          if (!t) return;
          const i = +t.getAttribute('data-i');
          if (!wiz.pts[i]) return;
          e.preventDefault();
          gest = Object.assign(base, { type: 'pt', i, p0: Object.assign({}, wiz.pts[i]) });
        } else return;
      } else if (editMode && tool === 'draw') {
        e.preventDefault();
        const a = snapPt(toPlan(e.clientX, e.clientY));
        preview = null;
        gest = Object.assign(base, { type: 'draw', a, rect: null });
      } else return;
      try { stage.setPointerCapture(e.pointerId); } catch (err) { /* 무시 */ }
    });
    stage.addEventListener('pointermove', (e) => {
      if (!gest || e.pointerId !== gest.id) return;
      gest.cx = e.clientX; gest.cy = e.clientY;
      if (!gest.moved) {
        if (Math.hypot(e.clientX - gest.sx, e.clientY - gest.sy) < (gest.ptype === 'mouse' ? 3 : 6)) return;
        gest.moved = true;
      }
      e.preventDefault();
      applyGest();
      if (!gestRaf) gestRaf = requestAnimationFrame(gestTick);
    });
    const endGest = (e) => {
      if (!gest || e.pointerId !== gest.id) return;
      if (e.type === 'pointercancel') { cancelGest(); if (pending) refresh(); return; }
      const g = gest;
      gest = null;
      stopGestAuto();
      try { stage.releasePointerCapture(e.pointerId); } catch (err) { /* 무시 */ }
      lastUp = Date.now();
      if (g.type === 'bgmove') {
        if (g.moved && (g.x !== g.x0 || g.y !== g.y0)) setBg({ x: g.x, y: g.y });
        else if (pending) refresh();
      } else if (g.type === 'pt') {
        if (pending) refresh();
      } else if (g.type === 'draw') {
        const rc = g.rect;
        if (!g.moved || !rc || rc.w < MIN_ROOM || rc.h < MIN_ROOM) {
          preview = null;
          drawOverlay();
          if (pending) refresh();
          toast(g.moved ? '너무 작아요 — 가로·세로 ' + MIN_ROOM + 'cm 넘게 끌어 주세요' : '도면 위를 끌어서 네모를 그려 주세요');
          return;
        }
        preview = rc;
        drawOverlay();
        if (pending) refresh();
        openRoomEditor(null, rc);
      }
    };
    stage.addEventListener('pointerup', endGest);
    stage.addEventListener('pointercancel', endGest);

    stage.addEventListener('click', (e) => {
      if (Date.now() - lastUp < 350) return;
      // 선택 도구 단추는 누르자마자 다시 그려져 문서에서 떨어져 나가므로 경로로 판단
      if (!e.target.isConnected || e.composedPath().includes(selBar)) return;
      if (wiz) {
        if (!cur) return;
        const P = toPlan(e.clientX, e.clientY);
        if (wiz.step === 'pts') {
          // 2단계(길이 넣기)에선 도면을 눌러도 찍은 점을 버리지 않음 (자판을 닫으려고 누르거나 잘못 닿은 손가락)
          if (wiz.pts.length >= 2) {
            if (!wiz.tapTip) { wiz.tapTip = true; toast('찍은 점은 끌어서 옮길 수 있어요 · 처음부터 다시 찍으려면 “다시 찍기”를 누르세요', { ms: 3500 }); }
            return;
          }
          wiz.pts.push(P);
          drawOverlay(); drawWizBar();
        } else if (wiz.step === 'origin') setOrigin(P);
        return;
      }
      if (editMode) {
        if (tool === 'doorAdd') { addDoorAt(toPlan(e.clientX, e.clientY)); return; }
        if (tool === 'doorDel') {
          // 문끼리 가까워 누르는 칸이 겹치면 누른 곳에서 가장 가까운 문 (칸 밖이어도 손가락 크기 안이면)
          const P = toPlan(e.clientX, e.clientY);
          const d = doorAtPt(cur.plan, P.x, P.y, DOOR_TAP / cur.s);
          if (d) askDeleteDoor(d._key); else toast('지울 문(빨간 점선 칸)을 눌러 주세요');
          return;
        }
        if (tool === 'draw') return;
        const rr = e.target.closest && e.target.closest('[data-rid]');
        if (rr) openRoomEditor(rr.getAttribute('data-rid'));
        return;
      }
      if (e.target.closest && e.target.closest('.fp-item')) return;
      if (sel) { sel = null; refresh(); }
    });
    scroll.addEventListener('wheel', (e) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      setZoom(curZoom() * (e.deltaY < 0 ? 1.1 : 1 / 1.1), { x: e.clientX, y: e.clientY });
    }, { passive: false });

    // ---- 두 손가락으로 확대·축소 (태블릿·폰): 페이지 전체가 아니라 도면만 ----
    const tDist = (t) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
    const tMid = (t) => ({ x: (t[0].clientX + t[1].clientX) / 2, y: (t[0].clientY + t[1].clientY) / 2 });
    // 손가락 이동·뗌은 문서 전체에서 받음 (터치를 시작한 요소가 다시 그려져 문서에서 빠져도 계속 받도록) — 확대 중에만 등록
    const onPinchMove = (e) => {
      if (!pinch || e.touches.length < 2) return;
      if (e.cancelable) e.preventDefault();
      pinch.ratio = MV.clamp(tDist(e.touches) / pinch.d0, 0.5 / pinch.z0, 5 / pinch.z0);
      stage.style.transform = 'scale(' + r2(pinch.ratio) + ')';
    };
    const unhookPinch = () => {
      document.removeEventListener('touchmove', onPinchMove, { passive: false });
      document.removeEventListener('touchend', endPinch);
      document.removeEventListener('touchcancel', endPinch);
    };
    function endPinch(e) {
      if (!pinch || (e && e.touches && e.touches.length >= 2)) return;
      const p = pinch;
      pinch = null;
      unhookPinch();
      lastUp = Date.now();
      stage.style.transform = ''; stage.style.transformOrigin = ''; stage.style.willChange = '';
      if (Math.abs(p.ratio - 1) > 0.03) setZoom(p.z0 * p.ratio, p.at, p.pt);
      else if (pending) refresh();
      else drawSelBar();
    }
    ctx.onCleanup(() => { pinch = null; unhookPinch(); });
    scroll.addEventListener('touchstart', (e) => {
      if (e.touches.length !== 2 || !cur || !svgEl || pinch) return;
      if (e.cancelable) e.preventDefault();
      if (drag) cancelDrag();
      if (gest) cancelGest();
      const m = tMid(e.touches);
      const r = stage.getBoundingClientRect();
      pinch = { d0: Math.max(12, tDist(e.touches)), z0: curZoom(), at: m, pt: toPlan(m.x, m.y), ratio: 1 };
      selBar.hidden = true;
      stage.style.transformOrigin = Math.round(m.x - r.left) + 'px ' + Math.round(m.y - r.top) + 'px';
      stage.style.willChange = 'transform';
      document.addEventListener('touchmove', onPinchMove, { passive: false });
      document.addEventListener('touchend', endPinch);
      document.addEventListener('touchcancel', endPinch);
    }, { passive: false });
    // 마지막 마우스 위치 (키보드 단축키 범위 판단용)
    const onPtr = (e) => { if (e.pointerType === 'mouse') lastPtr = { x: e.clientX, y: e.clientY }; };
    document.addEventListener('pointermove', onPtr, { passive: true });
    document.addEventListener('pointerdown', onPtr, { passive: true });
    ctx.onCleanup(() => { document.removeEventListener('pointermove', onPtr); document.removeEventListener('pointerdown', onPtr); });

    // ---- 키보드 ----
    const onKey = (e) => {
      if (!root.isConnected || drag) return;
      if (document.querySelector('.modal-back')) return;
      const ae = document.activeElement;
      if (ae && (ae.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(ae.tagName))) return;
      if (e.altKey || e.ctrlKey || e.metaKey || e.isComposing) return;
      const inSvg = ae && svgEl && svgEl.contains(ae);
      if (inSvg && (e.key === 'Enter' || e.key === ' ')) {
        const rid = editMode && ae.getAttribute('data-rid');
        const dk = editMode && ae.getAttribute('data-door');
        const pid = !editMode && ae.getAttribute('data-pid');
        if (dk) { e.preventDefault(); askDeleteDoor(dk); return; }
        if (rid) { e.preventDefault(); openRoomEditor(rid); return; }
        if (pid) { e.preventDefault(); sel = pid; refresh(); return; }
      }
      // 단축키는 도면(또는 선택한 짐)에 초점이 있거나, 초점 없이 마우스가 도면 위에 있을 때만.
      // 다른 곳을 보고 있을 때 방향키는 평소처럼 화면을 굴리고, Backspace 로 짐이 지워지지 않게.
      const inStage = !!ae && ((planCard.contains(ae) && !bgBar.contains(ae)) || tb.contains(ae));
      const bodyish = !ae || ae === document.body || ae === document.documentElement;
      if (wiz) {
        if (gest) return;
        if (e.key === 'Escape' && (inStage || bodyish)) { e.preventDefault(); cancelWiz(); return; }
        const AR = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
        if (wiz.step === 'move' && AR[e.key] && (inStage || bodyish)) {
          const k3 = e.shiftKey ? 10 : 1;
          e.preventDefault();
          nudgeBg(AR[e.key][0] * k3, AR[e.key][1] * k3);
        }
        return;
      }
      if (editMode && tool !== 'room' && e.key === 'Escape' && (inStage || bodyish)) { e.preventDefault(); if (gest) cancelGest(); setTool('room'); return; }
      if (!sel || editMode) return;
      if (e.key === 'Escape') {
        if (inStage || bodyish) { sel = null; refresh(); e.preventDefault(); }
        return;
      }
      let over = false;
      if (!inStage && bodyish && lastPtr) {
        const t = document.elementFromPoint(lastPtr.x, lastPtr.y);
        over = !!t && scroll.contains(t);
      }
      if (!inStage && !over) return;
      const g = svgEl && svgEl.querySelector('[data-pid="' + CSS.escape(sel) + '"]');
      if (!g) return;
      const gr = g.getBoundingClientRect(), sr = scroll.getBoundingClientRect();
      const vis = gr.right > Math.max(0, sr.left) && gr.left < Math.min(window.innerWidth, sr.right)
        && gr.bottom > Math.max(0, sr.top) && gr.top < Math.min(window.innerHeight, sr.bottom);
      if (!vis) return;   // 화면에 안 보이는 짐은 건드리지 않음
      const st = e.shiftKey ? 10 : 1;
      switch (e.key) {
        case 'ArrowLeft': nudge(-st, 0); break;
        case 'ArrowRight': nudge(st, 0); break;
        case 'ArrowUp': nudge(0, -st); break;
        case 'ArrowDown': nudge(0, st); break;
        case 'Delete': case 'Backspace': removeSel(); break;
        default:
          if (e.code === 'KeyR' || e.key === 'r' || e.key === 'R' || e.key === 'ㄱ') { rotateSel(); break; }
          return;
      }
      e.preventDefault();
    };
    document.addEventListener('keydown', onKey);
    ctx.onCleanup(() => document.removeEventListener('keydown', onKey));

    // ---- 크기 변화 ----
    const relayout = MV.debounce(() => { if (cur && !drag && root.isConnected) drawPlan(); }, 120);
    let ro = null;
    if (window.ResizeObserver) {
      ro = new ResizeObserver(() => { const w = scroll.clientWidth; if (Math.abs(w - lastW) > 4) { lastW = w; relayout(); } });
      ro.observe(scroll);
    }
    let lastH = window.innerHeight;
    const onResize = () => { if (Math.abs(window.innerHeight - lastH) > 40) { lastH = window.innerHeight; relayout(); } };
    window.addEventListener('resize', onResize);
    ctx.onCleanup(() => { if (ro) ro.disconnect(); window.removeEventListener('resize', onResize); });

    ctx.subscribe(() => refresh());
    refresh();
  }

  /* ============================================================
     비교 화면 (#/plan/compare)
     ============================================================ */
  function renderCompare(root, ctx) {
    const box = el('div', { class: 'fp-cmp' });
    root.appendChild(box);
    let plansGrid = null;
    let lastW = 0;

    function drawMinis() {
      if (!plansGrid) return;
      const oldP = getPlan('old'), newP = getPlan('new');
      const cells = Array.from(plansGrid.querySelectorAll('.fp-cmp-svg'));
      if (!oldP || !newP || cells.length < 2) return;
      const cw = Math.max(200, cells[0].clientWidth || 300);
      const s = Math.min(cw / oldP.vb.w, cw / newP.vb.w);
      const inv = invMap();
      [[oldP, 'old', cells[0]], [newP, 'new', cells[1]]].forEach(([plan, key, cell]) => {
        const items = pls(key).map((p) => ({ p, it: inv.get(p.invId) })).filter((o) => o.it).map((o) => Object.assign(o, { r: rectOf(o.p, o.it) }));
        cell.textContent = '';
        cell.appendChild(buildSVG(plan, key, { s, interactive: false, grid: false, items, compact: true, fontScale: 0.92 }));
      });
      lastW = cw;
    }
    function draw() {
      box.textContent = '';
      const oldP = getPlan('old'), newP = getPlan('new');
      if (!oldP || !newP) { box.appendChild(emptyCard('두 집 도면 데이터가 아직 없어요.')); plansGrid = null; return; }
      const inv = invMap();
      const cntOld = placedCount('old'), cntNew = placedCount('new');

      // (1) 같은 축척 도면
      plansGrid = el('div', { class: 'fp-cmp-plans' }, [[oldP, 'old'], [newP, 'new']].map(([p, key]) => el('div', { class: 'fp-cmp-cell' },
        el('div', { class: 'row' }, el('h3', p.short), p.exclusive_m2 ? el('span', { class: 'chip' }, '전용 ' + p.exclusive_m2 + '㎡') : null,
          confidenceChip(p), p.edited ? el('span', { class: 'chip brand' }, '📏 실측 반영됨') : null,
          el('a', { class: 'btn btn-sm btn-ghost fp-b', href: '#/plan/' + key }, '편집 →')),
        el('div', { class: 'fp-cmp-svg' }))));
      box.appendChild(el('section', { class: 'card' },
        el('div', { class: 'fp-card-head' }, el('h2', '같은 축척으로 나란히'), el('span', { class: 'tiny muted' }, '아래 1m 막대 길이가 두 도면에서 같아요')),
        plansGrid));

      // (2) 면적 비교
      const rows = areaRows(oldP, newP);
      const dCell = (d) => el('td', { class: 'num ' + (d > 0.05 ? 'fp-up' : d < -0.05 ? 'fp-down' : '') }, fmtD(d));
      const roomCell = (r) => (r ? el('td', { class: 'num' }, fmtA(area(r)), el('div', { class: 'tiny muted' }, Math.round(r.w) + '×' + Math.round(r.h))) : el('td', { class: 'num muted' }, '—'));
      const inOld = interior(oldP), inNew = interior(newP);
      const bOld = balconyArea(oldP), bNew = balconyArea(newP);
      const areaCard = el('section', { class: 'card' },
        el('div', { class: 'fp-card-head' }, el('h2', '방별 면적'), el('span', { class: 'chip ' + (inNew < inOld ? 'warn' : 'good') }, '실내 ' + fmtD(r1(inNew) - r1(inOld)))),
        el('div', { class: 'table-wrap' }, el('table', { class: 'tbl fp-cmp-tbl' },
          el('thead', el('tr', el('th', '공간'), el('th', { class: 'num' }, '지금 집'), el('th', { class: 'num' }, '새 집'), el('th', { class: 'num' }, '차이'))),
          el('tbody', rows.map(({ o, n }) => el('tr',
            el('td', o && n ? (norm(o.name) === norm(n.name) ? o.name : o.name + ' → ' + n.name) : (o ? o.name : n.name), o && !n ? el('div', { class: 'tiny muted' }, '새 집엔 없음') : null, !o && n ? el('div', { class: 'tiny muted' }, '새 집에만 있음') : null),
            roomCell(o), roomCell(n), dCell(r1(n ? area(n) : 0) - r1(o ? area(o) : 0))))),
          el('tfoot',
            el('tr', el('td', '실내 합계 (발코니 제외)'), el('td', { class: 'num' }, fmtA(inOld)), el('td', { class: 'num' }, fmtA(inNew)), dCell(r1(inNew) - r1(inOld))),
            el('tr', el('td', '발코니'), el('td', { class: 'num' }, fmtA(bOld)), el('td', { class: 'num' }, fmtA(bNew)), dCell(r1(bNew) - r1(bOld))),
            oldP.exclusive_m2 && newP.exclusive_m2 ? el('tr', el('td', '전용면적 (공부상)'), el('td', { class: 'num' }, (+oldP.exclusive_m2).toFixed(2) + '㎡'), el('td', { class: 'num' }, (+newP.exclusive_m2).toFixed(2) + '㎡'), dCell(r2(newP.exclusive_m2) - r2(oldP.exclusive_m2))) : null))),
        el('p', { class: 'tiny muted mt-8 mb-0' }, '도면에서 계산한 값이라 실제와 다를 수 있어요. 이름이 같은 방끼리, 없으면 같은 종류의 큰 방끼리 짝지었어요.'));

      // (3) 옷 수납 길이
      const cc = closetCompare();
      const maxL = Math.max(cc.oldTotal, cc.newLen, 1);
      const sfMsg = cc.oldTotal === 0 && cc.newLen === 0
        ? el('div', { class: 'callout' }, '지금 집 도면에 붙박이장이나 옷장이 없어요. “지금 집” 탭에 옷장을 놓으면 비교돼요.')
        : cc.shortfall > 0
          ? el('div', { class: 'callout warn' }, el('strong', '옷걸이 공간이 ' + cc.shortfall + 'cm 부족해요 → 옷 정리 또는 옷장 추가'),
            el('div', { class: 'small' }, '대략 옷 ' + Math.round(cc.shortfall / 4) + '벌 분량이에요 (옷걸이 1벌 ≈ 4cm). 120cm 옷장이면 ' + Math.ceil(cc.shortfall / 120) + '개가 더 필요해요.'))
          : el('div', { class: 'callout good' }, el('strong', '옷 수납 길이는 충분해요 👍'), el('div', { class: 'small' }, '새 집 옷장이 지금보다 ' + (-cc.shortfall) + 'cm 더 길어요.'));
      const clothesPart = MV.parts && MV.parts.list ? MV.parts.list().find((p) => p.id === 'sort-clothes' || /옷정리/.test(p.name || '')) : null;
      const buyPart = MV.parts && MV.parts.list ? MV.parts.list().find((p) => p.id === 'buy' || /가구구매/.test(p.name || '')) : null;
      const closetCard = el('section', { class: 'card' },
        el('div', { class: 'fp-card-head' }, el('h2', '👕 옷 수납 길이')),
        el('p', { class: 'small muted mb-0' }, '지금 집은 붙박이장이 있고, 새 집엔 없어요. 옷장 가로 길이(행거 길이)로 비교해요.'),
        el('div', { class: 'fp-bars' },
          el('div', { class: 'fp-barrow' }, el('span', { class: 'strong' }, '지금 집'), el('div', { class: 'fp-bar' }, el('i', { style: { width: Math.round((cc.oldTotal / maxL) * 100) + '%' } })), el('span', { class: 'num strong' }, cc.oldTotal + 'cm')),
          el('div', { class: 'fp-barrow' }, el('span', { class: 'strong' }, '새 집'), el('div', { class: 'fp-bar is-new' }, el('i', { style: { width: Math.round((cc.newLen / maxL) * 100) + '%' } })), el('span', { class: 'num strong' }, cc.newLen + 'cm'))),
        el('p', { class: 'tiny muted' }, '지금 집: 붙박이장 ' + cc.bLen + 'cm' + (cc.builtins.length ? ' (' + cc.builtins.map((b) => (b.name || '붙박이장') + ' ' + Math.round(Math.max(num(b.w, 0), num(b.h, 0)))).join(', ') + ')' : '') + (cc.oldFree ? ' + 도면에 놓은 옷장 ' + cc.oldFree + 'cm' : '') + ' · 새 집: 도면에 놓은 옷장·키 큰 수납장 ' + cc.newLen + 'cm'),
        sfMsg,
        cc.unplaced.length ? el('p', { class: 'small' }, '짐 목록엔 있지만 새 집 도면에 아직 안 놓은 옷장: ', cc.unplaced.map((it) => it.name + ' ' + Math.round(num(it.w, 0)) + 'cm').join(', '), ' → ', el('a', { href: '#/plan/new' }, '새 집 배치에서 놓기')) : null,
        el('div', { class: 'row mt-8' },
          el('button', { type: 'button', class: 'btn btn-sm fp-b', onclick: () => MV.inv.editor(null, { defaults: { name: '옷장 (구매 예정)', cat: 'storage', tag: 'wardrobe', fate: 'buy', w: 120, d: 60, h: 216, roomNew: '안방' } }) }, '+ 옷장 추가 (구매 예정)'),
          clothesPart && MV.views.checklist ? el('a', { class: 'btn btn-sm btn-ghost fp-b', href: '#/checklist/' + encodeURIComponent(clothesPart.id) }, (clothesPart.emoji || '👕') + ' ' + clothesPart.name + ' 체크리스트') : null,
          buyPart && MV.views.checklist ? el('a', { class: 'btn btn-sm btn-ghost fp-b', href: '#/checklist/' + encodeURIComponent(buyPart.id) }, (buyPart.emoji || '🛒') + ' ' + buyPart.name) : null));
      box.appendChild(el('div', { class: 'fp-cmp-grid' }, areaCard, closetCard));

      // (4) 차이 요약
      const ins = Array.isArray(MV.planCompare) ? MV.planCompare.filter((x) => x && (x.title || x.detail)) : [];
      const LV = { info: 'kid', warn: 'warn', bad: 'bad', good: 'good' };
      box.appendChild(el('section', { class: 'card mt-12' },
        el('div', { class: 'fp-card-head' }, el('h2', '🔎 두 집 차이 요약')),
        ins.length ? ins.map((c) => el('div', { class: 'callout ' + (LV[c.level] || '') }, c.title ? el('strong', c.title) : null, c.detail ? el('div', { class: 'small' }, MV.linkify(String(c.detail))) : null))
          : el('p', { class: 'small muted mb-0' }, '도면 리서치가 반영되면 두 집의 차이(수납·동선·채광 등)가 여기에 정리돼요.')));

      // (5) 새 집에 아직 자리 없는 짐
      const miss = MV.inv.list((it) => fateOf(it) === 'move' && (cntOld[it.id] || 0) > 0 && !(cntNew[it.id] || 0));
      const notAnywhere = MV.inv.list((it) => fateOf(it) === 'move' && !(cntOld[it.id] || 0) && !(cntNew[it.id] || 0));
      box.appendChild(el('section', { class: 'card mt-12' },
        el('div', { class: 'fp-card-head' }, el('h2', '📦 새 집에 아직 자리 없는 짐'), miss.length ? el('span', { class: 'chip warn' }, miss.length + '개') : null),
        !Object.keys(cntOld).length ? el('p', { class: 'small muted' }, '“지금 집” 탭에 지금 짐을 놓아 두면, 새 집에 자리가 없는 짐을 여기서 찾아 줘요.')
          : !miss.length ? el('div', { class: 'callout good' }, '지금 집에 놓은 “가져갈” 짐은 모두 새 집에 자리가 있어요 👍')
            : el('ul', { class: 'fp-miss' }, miss.map((it) => el('li',
              el('span', { 'aria-hidden': 'true' }, MV.inv.cat(it.cat).icon),
              el('span', { class: 'fp-mname' }, it.name, el('span', { class: 'tiny muted num' }, ' ' + Math.round(num(it.w, 0)) + '×' + Math.round(num(it.d, 0)) + '×' + Math.round(num(it.h, 0)))),
              el('button', { type: 'button', class: 'btn btn-sm fp-b', onclick: () => {
                const res = planPlacement('new', it.id);
                if (!res) return;
                commitPlacement('new', res);
                toast(q(it) + jo(it.name, '을', '를') + ' 새 집 ' + (res.room ? res.room.name : '가운데') + '에 놓았어요', { action: { label: '새 집 배치 보기', onClick: () => MV.go('#/plan/new') } });
              } }, '+ 새 집에 놓기'),
              el('button', { type: 'button', class: 'btn btn-sm btn-ghost fp-b', onclick: () => MV.inv.editor(it.id), 'aria-label': it.name + ' 수정 (버리기·판매로 바꾸기)' }, '✎')))),
        notAnywhere.length ? el('p', { class: 'tiny muted mt-8 mb-0' }, '“가져감” 짐 중 ' + notAnywhere.length + '개는 아직 어느 도면에도 안 놓였어요: ' + notAnywhere.slice(0, 6).map((it) => it.name).join(', ') + (notAnywhere.length > 6 ? ' …' : '')) : null));

      drawMinis();
    }
    draw();
    ctx.subscribe(() => draw());
    if (window.ResizeObserver) {
      const ro = new ResizeObserver(() => { const c = plansGrid && plansGrid.querySelector('.fp-cmp-svg'); const w = c ? c.clientWidth : 0; if (w && Math.abs(w - lastW) > 4) drawMinis(); });
      ro.observe(box);
      ctx.onCleanup(() => ro.disconnect());
    }
  }

  /* ============================================================
     뷰 등록
     ============================================================ */
  MV.view('plan', {
    title: '공간설계', short: '도면', icon: '📐', order: 30,
    render(root, params, ctx) {
      initState();
      let tab = params && params[0];
      if (!TABS.some(([id]) => id === tab)) {
        tab = 'new';
        try { history.replaceState(null, '', '#/plan/new'); } catch (e) { /* 무시 */ }
      }
      const spacePart = MV.parts && MV.parts.list ? MV.parts.list().find((p) => p.id === 'space' || /공간설계/.test(p.name || '')) : null;
      root.appendChild(el('div', { class: 'view-head fp-vh' },
        el('div', el('h1', '📐 공간설계'), el('div', { class: 'sub' }, '두 집 도면에 우리 짐을 놓아 보고, 버릴 것·살 것을 정해요')),
        spacePart && MV.views.checklist ? el('div', { class: 'actions' }, el('a', { class: 'btn btn-sm btn-ghost fp-b', href: '#/checklist/' + encodeURIComponent(spacePart.id) }, (spacePart.emoji || '📐') + ' ' + spacePart.name + ' 체크리스트')) : null));
      const headRow = el('div', { class: 'fp-headrow' }, el('div', { class: 'tabs fp-tabs', role: 'tablist', 'aria-label': '도면 선택' },
        TABS.map(([id, label]) => el('button', {
          type: 'button', role: 'tab', 'aria-selected': String(id === tab), class: id === tab ? 'active' : '',
          onclick: () => MV.go('#/plan/' + id),
        }, label))));
      root.appendChild(headRow);
      if (!MV.plans || typeof MV.plans !== 'object') { root.appendChild(emptyCard('도면 데이터(MV.plans)가 아직 없어요.')); return; }
      if (tab === 'compare') { renderCompare(root, ctx); return; }
      if (!MV.plans[tab]) { root.appendChild(emptyCard(PLAN_LABEL[tab] + ' 도면 데이터가 아직 없어요.')); return; }
      renderEditor(root, tab, ctx, headRow);
    },
  });

  /* ---------------- 다른 화면용 요약 ---------------- */
  MV.calc = MV.calc || {};
  MV.calc.planSummary = function planSummary() {
    const out = {};
    try {
      initState();
      const inv = invMap();
      KEYS.forEach((key) => {
        const plan = getPlan(key);
        if (!plan) return;
        const v = validate(plan, key, inv);
        const cnt = placedCount(key);
        const elig = MV.inv.list((it) => eligible(key, it));
        out[key] = {
          placed: elig.reduce((s, it) => s + Math.min(qtyOf(it), cnt[it.id] || 0), 0),
          needed: elig.reduce((s, it) => s + qtyOf(it), 0),
          bad: v.bad, warn: v.warn, edited: plan.edited,
        };
      });
      const cc = closetCompare();
      out.closet = { old: cc.oldTotal, new: cc.newLen, shortfall: cc.shortfall };
    } catch (e) { console.error('[plan] summary', e); }
    return out;
  };
})();
