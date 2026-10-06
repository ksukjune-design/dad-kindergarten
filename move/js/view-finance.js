/* ============================================================
   우리집 이사 관리 — 자금흐름 (11/3 잔금일 돈 흐름 · 예산 · 세금 · 보증금 지키기)

   라우트
     #/money              마지막으로 본 탭 (처음엔 11/3 돈 흐름)
     #/money/flow         11/3 시간순 돈 흐름 (단계·잔액·이체한도·비상계획·당일 시트)
     #/money/sources      돈의 출처와 쓰임 (검산, 아버지 돈이 지금 어디 있는지)
     #/money/budget       이사 비용 예산 (자동/직접 항목, 부족분과 대응)
     #/money/father       아버지 차용금 · 증여세 계산기
     #/money/tax          중개보수 · 월세 세액공제 · 주택자금 소득공제
     #/money/protect      보증금 지키기 (체크리스트 항목과 연결)
   탭 이동은 history.pushState 로 처리해 위쪽 요약은 그대로 둡니다.

   상태   MV.store.ensure('finance', defaults) — 화면의 모든 숫자는 고칠 수 있고 '기본값으로 되돌리기' 가능
          finance.links { 'prot-키' | 'prep-키' | 'doc-키': 체크리스트 항목 id } — 한 줄은 늘 항목 하나에만 연결
          금액 칸은 저장 전에 검사(음수·'1억abc' 거부), 1회 한도 초과 이체는 단계 카드에 빨간 경고
   계산   MV.calc.financeSummary(state) → { inflow, outflow, leftover, expensesTotal(아직 낼 이사비),
          expensesAll, expensesPaid, refunds, net, warnings:[{text, level}] } — 순수 함수 (대시보드가 호출)
   근거   리서치 검증본 finance_verified.json (2026-10-06). 규칙·요율 옆에 신뢰도와 짧은 근거,
          신뢰도가 높지 않으면 '세무사·은행 확인 권장' 표시.
   다시 그리기
          값 변경 → 계산 결과만 갱신(live), 구조 변경 → 탭 내용만 다시 그림.
          입력 중인 칸은 절대 지우지 않고(포커스가 떠난 뒤 반영), 포커스는 data-fk 로 되살립니다.
   CSS 접두사: fn-
   ============================================================ */
(function () {
  'use strict';
  const el = MV.el;
  const D = MV.date;
  const F = MV.fmt;
  const SRC = 'finance-view';

  /* ======================= 작은 도우미 ======================= */
  const isNum = (n) => typeof n === 'number' && isFinite(n);
  const num = (v) => {
    if (isNum(v)) return v;
    if (typeof v === 'string' && v.trim() !== '' && isFinite(+v)) return +v;
    return 0;
  };
  const pos = (v) => (isNum(v) && v > 0 ? v : null);
  const nn = (v) => Math.max(0, num(v)); /* 음수가 될 수 없는 금액 */
  /* 전각 숫자·기호(일부 한글 자판이 만드는 '１２０만', '１．３')를 보통 숫자로 */
  const halfwidth = (s) => String(s == null ? '' : s).replace(/[０-９．，－％]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xFEE0));
  /* 나눠 보내는 횟수 — 한도를 잘못 넣어 수억 번이 나오면 숫자 대신 '100번 넘게' */
  const timesTxt = (n) => (n > 99 ? '100번 넘게' : n + '번');
  /* 금액 입력 검사 — core parseMoney 는 '1억abc'·'-100만'도 읽어 버려서, 저장 전에 모양을 엄격히 확인 */
  const MONEY_RE = /^(?:\d+(?:\.\d+)?억)?(?:\d+(?:\.\d+)?천만)?(?:\d+(?:\.\d+)?만)?(?:\d+(?:\.\d+)?)?$/;
  function moneyCheck(raw, o) {
    o = o || {};
    const s = halfwidth(raw).replace(/[\s,원₩]/g, '');
    if (!s) return { ok: true, v: 0, empty: true };
    if (/^[-−]/.test(s)) return { ok: false, msg: '0원보다 작은 금액은 넣을 수 없어요' };
    if (/\d천$/.test(s)) return { ok: false, msg: '천만 단위는 "5천만"처럼, 천 원 단위는 "5,000"처럼 써 주세요' };
    if (!MONEY_RE.test(s)) return { ok: false, msg: '숫자로 읽을 수 없어요 (예: 3.78억 / 120만 / 1,200,000)' };
    const v = MV.parseMoney(s);
    if (!isNum(v)) return { ok: false, msg: '숫자로 읽을 수 없어요 (예: 3.78억 / 120만 / 1,200,000)' };
    if (v > (o.max || 1e11)) return { ok: false, msg: '금액이 너무 커요 (' + F.krw(o.max || 1e11) + ' 이하) — 다시 확인하세요' };
    return { ok: true, v };
  }
  const sum = (arr, f) => arr.reduce((s, x) => s + (f ? num(f(x)) : num(x)), 0);
  const won = (n) => F.won(n);
  const krw = (n) => F.krw(n);
  const eok = (n) => F.eok(n);
  const signedKrw = (n) => (n > 0 ? '+' : n < 0 ? '−' : '') + F.krw(Math.abs(n));
  const signedEok = (n) => (n > 0 ? '+' : n < 0 ? '−' : '') + F.eok(Math.abs(n));
  const signedWon = (n) => (n > 0 ? '+' : n < 0 ? '−' : '') + F.won(Math.abs(n));
  const pctTxt = (x, d) => {
    if (!isNum(x)) return '-';
    let s = x.toFixed(d == null ? 2 : d);
    if (s.indexOf('.') >= 0) s = s.replace(/\.?0+$/, '');
    return s + '%';
  };
  const moveDateOf = (state) => (state && state.meta && D.valid(state.meta.moveDate) ? state.meta.moveDate : '2026-11-03');
  function addMonths(s, n) {
    const d = D.parse(s);
    if (!d) return s;
    const day = d.getDate();
    d.setDate(1);
    d.setMonth(d.getMonth() + n);
    const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
    d.setDate(Math.min(day, last));
    return D.str(d);
  }
  /* s 가 속한 달 + plus 개월의 말일 (증여세 신고기한 = 증여일이 속한 달 말일부터 3개월) */
  function monthEnd(s, plus) {
    const d = D.parse(s);
    if (!d) return null;
    return D.str(new Date(d.getFullYear(), d.getMonth() + 1 + (plus || 0), 0));
  }
  function flatKids(k) {
    return [].concat(k == null ? [] : k).flat(Infinity)
      .filter((x) => x !== null && x !== undefined && x !== false)
      .map((x) => (x instanceof Node ? x : document.createTextNode(String(x))));
  }
  function isTextEntry(n) {
    if (!n || !n.tagName) return false;
    if (n.tagName === 'TEXTAREA') return true;
    if (n.tagName !== 'INPUT') return false;
    const t = (n.getAttribute('type') || 'text').toLowerCase();
    return ['text', 'search', 'email', 'tel', 'url', 'number', 'password', 'date', 'time'].indexOf(t) >= 0;
  }
  function cssEsc(s) {
    try { return CSS.escape(s); } catch (e) { return String(s).replace(/["\\]/g, '\\$&'); }
  }
  function refocus(container, fk, selectAll) {
    if (!fk || !container) return;
    const t = container.querySelector('[data-fk="' + cssEsc(fk) + '"]');
    if (!t || document.activeElement === t) return;
    try {
      t.focus({ preventScroll: true });
      if (selectAll && t.select) t.select();
    } catch (e) { /* 무시 */ }
  }

  /* 마지막 Tab 키 (Shift 여부) — 다시 그리기로 포커스를 잃었을 때 어디로 보낼지 */
  let navKey = null;
  let lastFocus = null;
  const FOCUSABLE = 'input:not([type=hidden]):not([disabled]), select:not([disabled]), textarea:not([disabled]), button:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])';
  const focusables = (scope) => Array.from((scope || document.body).querySelectorAll(FOCUSABLE)).filter((n) => n.tabIndex >= 0 && n.getClientRects().length > 0);
  /* (다시 그리기 전 화면에서) from 다음/앞 칸 */
  function nextFocusable(from, back) {
    if (!from || !from.isConnected) return null;
    const all = focusables(from.closest('.fn-page') || document.body);
    const i = all.indexOf(from);
    if (i < 0) return null;
    return all[back ? i - 1 : i + 1] || null;
  }
  function rescueFocus(node, intentFk) {
    if (!navKey || Date.now() - navKey.t > 1500) return; // 마우스·터치로 떠난 경우는 그대로
    const back = navKey.shift;
    // 대신 갈 칸은 지금(다시 그린 직후) 정해 두고, 탭 전체가 다시 그려져도 data-fk 로 다시 찾음
    const scope = node.closest('.fn-page') || document.body;
    const all = focusables(scope);
    const side = all.filter((n) => !node.contains(n) && (node.compareDocumentPosition(n) & (back ? Node.DOCUMENT_POSITION_PRECEDING : Node.DOCUMENT_POSITION_FOLLOWING)));
    const fb = back ? side[side.length - 1] : side[0];
    const fbFk = fb ? fb.getAttribute('data-fk') : null;
    const find = (fk) => (fk ? document.querySelector('.fn-page [data-fk="' + cssEsc(fk) + '"]') : null);
    setTimeout(() => {
      const ae = document.activeElement;
      if (ae && ae !== document.body && ae.isConnected) return; // 브라우저나 다른 코드가 이미 옮김
      const t = find(intentFk) || (fb && fb.isConnected ? fb : find(fbFk));
      if (t) { try { t.focus({ preventScroll: false }); } catch (e) { /* 무시 */ } }
    }, 0);
  }

  /* ======================= 근거·출처 ======================= */
  const LINK = {
    seoulFee: { label: '서울시 중개보수 요율', url: 'https://land.seoul.go.kr/land/broker/brokerageCommission.do' },
    ydpFee: { label: '영등포구 중개보수 안내', url: 'https://www.ydp.go.kr/www/contents.do?key=2725&' },
    wooriLoan: { label: '우리은행 우리전세론', url: 'https://spib.wooribank.com/pib/Dream?withyou=PSLON0275' },
    loanInfo: { label: '우리전세론 상품 정리', url: 'https://bankserch.com/%EC%9A%B0%EB%A6%AC%EC%9D%80%ED%96%89-%EC%A0%84%EC%84%B8%EC%9E%90%EA%B8%88%EB%8C%80%EC%B6%9C-%EC%9A%B0%EB%A6%AC%EC%A0%84%EC%84%B8%EB%A1%A0%EC%A3%BC%ED%83%9D%EA%B8%88%EC%9C%B5%EB%B3%B4%EC%A6%9D/' },
    hf: { label: '주택금융공사 전세자금보증', url: 'https://www.hf.go.kr/ko/sub02/sub02_01_02.do' },
    taxlyRate: { label: '가족 차용 최저 이자율 (taxly)', url: 'https://taxly.kr/post/1667-증여세-가족-등-타인으로부터-차용시-세법상-문제가-없는-가장-낮은-이자율-적용방법' },
    taxlyLoan: { label: '가족 간 전세금 차용 상담 (taxly)', url: 'https://taxly.kr/qna/140409-가족간-전세금-차용시-기간-및-이자율-문의' },
    taxlyGift: { label: '가족 간 전세자금 차용과 증여세 (taxly)', url: 'https://taxly.kr/qna/16208-가족간-전세자금-차용시-증여세-문제' },
    taxlyNote: { label: '부모 차용증 이자 설정 (taxly)', url: 'https://taxly.kr/qna/133077-부모자식간-차용증-이자-설정에-관하여' },
    transtax: { label: '차용 이자율 계산 사례', url: 'https://m.cafe.daum.net/transtax/PpOm/289' },
    hugCompare: { label: 'HF·SGI 보증료 비교', url: 'https://safehomes.kr/insights/kn-20260713-1608-hf-전세보증금반환보증-sgi서울보증과-보증료-비교/' },
    hug: { label: 'HUG 주택도시보증공사', url: 'https://www.khug.or.kr' },
    rtms: { label: '부동산거래관리시스템 (임대차 신고)', url: 'https://rtms.molit.go.kr' },
    iros: { label: '인터넷등기소', url: 'https://www.iros.go.kr' },
    hometax: { label: '홈택스', url: 'https://www.hometax.go.kr' },
    lawLease: { label: '주택임대차보호법', url: 'https://www.law.go.kr/법령/주택임대차보호법' },
    lawGift: { label: '상속세 및 증여세법', url: 'https://www.law.go.kr/법령/상속세및증여세법' },
    lawSpecial: { label: '조세특례제한법', url: 'https://www.law.go.kr/법령/조세특례제한법' },
    lawReport: { label: '부동산 거래신고법', url: 'https://www.law.go.kr/법령/부동산거래신고등에관한법률' },
    lawCollect: { label: '국세징수법', url: 'https://www.law.go.kr/법령/국세징수법' },
  };
  const CONF = {
    high: { label: '신뢰도 높음', cls: 'good' },
    mid: { label: '신뢰도 중간', cls: 'warn' },
    low: { label: '신뢰도 낮음 (추정)', cls: 'think' },
  };
  function basis(conf, text, links, check, compact) {
    const c = CONF[conf] || CONF.mid;
    if (compact) {
      return el('details', { class: 'fn-why' },
        el('summary', null, el('span', { class: 'chip ' + c.cls }, c.label), ' 근거 보기'),
        el('div', { class: 'fn-basis' },
          el('span', { class: 'fn-basis-txt' }, text),
          (links || []).map((l) => el('a', { class: 'fn-src', href: l.url, target: '_blank', rel: 'noopener noreferrer' }, l.label + ' ↗')),
          conf !== 'high' ? el('span', { class: 'fn-verify' }, '⚠ ' + (check || '세무사·은행 확인 권장')) : null));
    }
    return el('div', { class: 'fn-basis' },
      el('span', { class: 'chip ' + c.cls }, c.label),
      el('span', { class: 'fn-basis-txt' }, '근거: ' + text),
      (links || []).map((l) => el('a', { class: 'fn-src', href: l.url, target: '_blank', rel: 'noopener noreferrer' }, l.label + ' ↗')),
      conf !== 'high' ? el('span', { class: 'fn-verify' }, '⚠ ' + (check || '세무사·은행 확인 권장')) : null);
  }

  /* ======================= 규칙·표 (리서치 검증본) ======================= */
  /* 서울시 주택 임대차 중개보수 상한 (2021-10-19 개정 요율) */
  const SEOUL_LEASE = [
    { max: 50000000, rate: 0.005, limit: 200000, label: '5천만원 미만', rateTxt: '0.5% (한도 20만원)' },
    { max: 100000000, rate: 0.004, limit: 300000, label: '5천만~1억원 미만', rateTxt: '0.4% (한도 30만원)' },
    { max: 600000000, rate: 0.003, limit: null, label: '1억~6억원 미만', rateTxt: '0.3%' },
    { max: 1200000000, rate: 0.004, limit: null, label: '6억~12억원 미만', rateTxt: '0.4%' },
    { max: 1500000000, rate: 0.005, limit: null, label: '12억~15억원 미만', rateTxt: '0.5%' },
    { max: Infinity, rate: 0.006, limit: null, label: '15억원 이상', rateTxt: '0.6%' },
  ];
  const VAT = {
    general: { label: '일반과세자 (+10%)', rate: 0.10 },
    simple: { label: '간이과세자 (+약 4%)', rate: 0.04 },
    none: { label: '부가세 없음', rate: 0 },
  };
  const BANDS = {
    low: { label: '5,500만원 이하 (17%)', rate: 0.17 },
    mid: { label: '5,500만~8,000만원 (15%)', rate: 0.15 },
    none: { label: '8,000만원 초과 (대상 아님)', rate: 0 },
  };
  const MARGINAL = [
    [0.066, '6.6% (과세표준 1,400만원 이하)'],
    [0.165, '16.5% (1,400만~5,000만원)'],
    [0.264, '26.4% (5,000만~8,800만원)'],
    [0.385, '38.5% (8,800만~1.5억원)'],
  ];
  const HUG_RATES = [
    [0.115, '연 0.115% (부채비율 낮음)'],
    [0.122, '연 0.122% (중간값)'],
    [0.128, '연 0.128% (부채비율 높음)'],
  ];
  /* LG 이전설치 단가 (appliances_verified, 2025 기준·신뢰도 낮음) — 이사 견적 화면이 없을 때만 씀 */
  const LG_PRICE = { fridge: 120000, dryer: 110000, washer: 98000, tv: 100000 };
  const LG_AC = { wall: 226000, stand: 318000, '2in1': 417000 };

  /* ======================= 기본값 ======================= */
  const DEFAULT_TIMES = { bankA: '09:20', recv: '09:30', keys: '09:45', registry: '10:00', toC: '10:15', broker: '10:40', bank: '11:00', movein: '14:00' };
  const LINE_META = {
    mover: { auto: 'mover', low: 1500000, high: 2800000, conf: 'low', basis: '서울 20평대 3인 포장이사 150만~280만원, 모델 기준가 197만원(에어컨 제외). 방문견적 3곳으로 다시 맞추기' },
    lg: { auto: 'lg', low: 300000, high: 800000, conf: 'low', basis: 'LG 이전설치: 냉장고 약 12만·건조기 약 11만(2개 이상 10% 할인)·운송비 약 4만원, 스탠드 에어컨 31.8만원(2025-11 기준). 1544-7777 확인' },
    clean: { low: 300000, high: 450000, conf: 'low', basis: '입주청소 30만~45만원 (24평 안팎)' },
    wardrobe: { low: 500000, high: 2000000, conf: 'low', basis: '옷장 50만~200만원 — 붙박이장이 없어져 필요. 이사 후 실측하고 사도 돼요' },
    washer: { low: 600000, high: 1100000, conf: 'low', basis: '통돌이 세탁기 60만~110만원. 고장 세탁기는 폐가전 무상방문수거(1599-0903)' },
    waste: { auto: 'waste', low: 0, high: 100000, conf: 'low', basis: '대형폐기물 스티커 품목당 약 1.5만원(강서구 단가표 확인). 폐가전은 무상수거' },
    elevator: { auto: 'elevator', low: 0, high: 200000, conf: 'low', basis: '단지당 0~10만원, 관리사무소마다 달라요 — 두 관리사무소에 확인' },
    internet: { low: 0, high: 50000, conf: 'low', basis: '통신사 이전설치비(보통 수만원 이내) — 통신사에 확인' },
    hug: { auto: 'hug', optional: true, low: 736000, high: 819200, conf: 'mid', basis: 'HUG 아파트 요율 연 약 0.115~0.128% × 2년 (3.2억이면 약 74만~82만원). 2025~2026 개편 여부는 신청 화면에서 확인' },
    deco: { low: 200000, high: 600000, conf: 'low', basis: '커튼·소품 20만~60만원' },
    reserve: { low: 0, high: 500000, conf: 'low', basis: '예상 못 한 지출 대비 (배관 연장, 실외기 앵글, 추가 인력 등)' },
  };
  const REFUND_META = {
    jangsu: { conf: 'mid', basis: '공동주택관리법 시행령 제31조 — 세입자가 낸 장기수선충당금은 소유자에게 돌려받을 수 있어요(약 20만~50만원 추정). 관리사무소 납부확인서로 금액 확정' },
    hfFee: { conf: 'low', basis: 'HF 보증 해지 때 남은 기간 보증료가 돌려받는지 은행에 확인' },
  };
  function normLine(l) {
    const o = Object.assign({ id: MV.uid('bl'), label: '새 항목', amount: 0, auto: true, on: true, paid: false, date: '', memo: '' }, l && typeof l === 'object' ? l : {});
    o.amount = num(o.amount);
    o.label = String(o.label == null ? '' : o.label);
    return o;
  }
  function normRefund(l) {
    const o = Object.assign({ id: MV.uid('rf'), label: '들어올 돈', amount: 0, got: false, memo: '' }, l && typeof l === 'object' ? l : {});
    o.amount = num(o.amount);
    o.label = String(o.label == null ? '' : o.label);
    return o;
  }
  function defaultLines() {
    return [
      { id: 'mover', label: '이사업체 (포장이사)', amount: 1970000 },
      { id: 'lg', label: 'LG 가전 이전설치', amount: 565000 },
      { id: 'clean', label: '입주청소', amount: 380000 },
      { id: 'wardrobe', label: '옷장 구매', amount: 1000000 },
      { id: 'washer', label: '통돌이 세탁기 구매', amount: 850000 },
      { id: 'waste', label: '대형폐기물 스티커', amount: 50000 },
      { id: 'elevator', label: '엘리베이터 사용료 (두 단지)', amount: 100000 },
      { id: 'internet', label: '인터넷 이전설치', amount: 20000 },
      { id: 'hug', label: '전세보증금반환보증 보증료 (HUG 2년)', amount: 780800 },
      { id: 'deco', label: '커튼·소품', amount: 400000 },
      { id: 'reserve', label: '예비비', amount: 300000 },
    ].map(normLine);
  }
  function defaultRefunds() {
    return [
      { id: 'jangsu', label: '장기수선충당금 반환 (A에게 청구)', amount: 300000 },
      { id: 'hfFee', label: 'HF 보증료 미경과분 환급 (있으면)', amount: 0 },
    ].map(normRefund);
  }
  function defaults() {
    return {
      v: 2,
      old: { deposit: 420000000, early: 42000000, receive: 378000000 },
      loan: { original: 100000000, prepaid: 22000000, payoff: 78130000, lien: 'unknown' },
      newHome: {
        deposit: 320000000, contract: 25000000, contractFromEarly: 20000000, contractFromWife: 5000000,
        balance: 295000000, rent: 700000, rentOnMoveDay: true, rentConfirmed: false, extraToC: 0,
        memoTotal: 295770000, memoAck: false, memoAckDiff: null, contractDate: '2026-07-13',
      },
      broker: { planned: 1200000, vat: 'general', agreed: false },
      flow: { times: Object.assign({}, DEFAULT_TIMES), done: {}, memo: {}, limits: { perTx: null, daily: null }, prep: {} },
      contacts: { A: '', C: '', broker: '', oldBroker: '', bank: '', mover: '' },
      budget: { lines: defaultLines(), refunds: defaultRefunds() },
      father: { principal: 300000000, actualRate: 0, properRate: 4.6, planRate: 1.3, startDate: '2024-11-18', priorGifts: 0, checks: {} },
      tax: { band: 'mid', marginal: 0.165, subscription: 0, checks: {} },
      protect: { rentReport: 'unknown', checks: {}, hugRate: 0.122, hugYears: 2 },
      links: {}, /* 화면의 할 일 → 체크리스트 항목 id (한 번 연결되면 고정) */
    };
  }
  /* 저장된 값 위에 빠진 기본값만 채움 (새 객체, 원본은 건드리지 않음) */
  function fill(target, defs) {
    if (Array.isArray(defs)) return Array.isArray(target) ? target : MV.clone(defs);
    if (defs && typeof defs === 'object') {
      const t = (target && typeof target === 'object' && !Array.isArray(target)) ? target : {};
      const out = {};
      Object.keys(defs).forEach((k) => { out[k] = fill(t[k], defs[k]); });
      Object.keys(t).forEach((k) => { if (!(k in out)) out[k] = t[k]; });
      return out;
    }
    return target === undefined ? defs : target;
  }
  function withDefaults(fin) {
    const f = fill(fin, defaults());
    f.budget = Object.assign({}, f.budget);
    f.budget.lines = (Array.isArray(f.budget.lines) ? f.budget.lines : []).filter((x) => x && typeof x === 'object').map(normLine);
    f.budget.refunds = (Array.isArray(f.budget.refunds) ? f.budget.refunds : []).filter((x) => x && typeof x === 'object').map(normRefund);
    ['times', 'done', 'memo', 'prep'].forEach((k) => { if (!f.flow[k] || typeof f.flow[k] !== 'object') f.flow[k] = k === 'times' ? Object.assign({}, DEFAULT_TIMES) : {}; });
    if (!f.links || typeof f.links !== 'object' || Array.isArray(f.links)) f.links = {};
    return f;
  }
  function ensureState() {
    MV.store.ensure('finance', defaults);
    const st = MV.store.get();
    const stored = st.finance && typeof st.finance === 'object' ? st.finance : null;
    const wasV = stored ? num(stored.v) : 2;
    const filled = withDefaults(st.finance);
    if (wasV < 2) {
      /* v1 → v2: 예전엔 '신고 상태'만 바꾸고 연결된 체크리스트 항목은 그대로 두는 버그가 있었음.
         그때 고른 상태(신고돼 있음/지금 신고함)를 체크리스트 항목에도 한 번만 맞춰 줌 */
      filled.v = 2;
      MV.store.update((s) => {
        s.finance = filled;
        if (['done', 'late'].indexOf(filled.protect.rentReport) < 0) return;
        const items = Array.isArray(s.items) ? s.items : [];
        const row = protectRows(moveDateOf(s), filled, D.today()).find((r) => r.key === 'report');
        [[row, 'prot-report'], [REPORT_FOLLOW, 'prot-reportNow']].forEach(([def, key]) => {
          const it = def ? findLinked(def, items, filled.links, 'prot-').item : null;
          if (!it) return;
          filled.links[key] = it.id;
          setItemDone(s, it.id, true);
        });
      }, { silent: true, source: SRC });
    } else if (JSON.stringify(filled) !== JSON.stringify(st.finance)) {
      MV.store.update((s) => { s.finance = filled; }, { silent: true, source: SRC });
    }
    return MV.store.get().finance;
  }
  /* 체크리스트 항목 완료 표시 (MV.store.update 안에서 — core MV.items.toggle 과 같은 필드) */
  function setItemDone(st, id, done) {
    const it = st && Array.isArray(st.items) ? st.items.find((x) => x && x.id === id) : null;
    if (!it) return false;
    if (!!it.done !== !!done) {
      const now = MV.nowISO();
      it.done = !!done;
      it.doneAt = done ? now : null;
      it.updatedAt = now;
    }
    return true;
  }

  /* ======================= 계산 (순수) ======================= */
  const STEP_KIND = { bankA: 'ext', recv: 'in', keys: 'task', registry: 'task', toC: 'out', broker: 'out', bank: 'out', movein: 'task' };

  /* 1회 한도로 나눠 보내기: 횟수 n, 한 번에 보낼 돈 size, 마지막 last (모두 한도 이하).
     횟수가 많으면(> SPLIT_LIST) 목록 대신 요약만 씀 */
  const SPLIT_LIST = 10;
  function splitInfo(amount, lim) {
    if (!(amount > 0) || !(lim > 0) || amount <= lim) return { n: amount > 0 ? 1 : 0, size: amount, last: amount, chunks: [amount] };
    const n = Math.ceil(amount / lim);
    const last = amount - lim * (n - 1);
    let chunks = null;
    if (n <= SPLIT_LIST) { chunks = []; for (let i = 0; i < n - 1; i++) chunks.push(lim); chunks.push(last); }
    return { n, size: lim, last, chunks };
  }
  function splitSummary(sp) {
    if (!sp || sp.n <= 1) return '';
    if (sp.chunks) return sp.chunks.map((a) => eok(a)).join(' + ');
    if (sp.n > 99) return eok(sp.size) + '씩 ' + timesTxt(sp.n) + ' — 창구 이체를 권해요';
    return eok(sp.size) + ' × ' + (sp.n - 1) + '번' + (sp.last !== sp.size ? ' + 마지막 ' + eok(sp.last) : ' + 1번 더');
  }

  function computeFlow(f) {
    const direct = f.loan.lien === 'exists';
    const payoff = nn(f.loan.payoff);
    const receive = nn(f.old.receive);
    const rentPart = f.newHome.rentOnMoveDay ? nn(f.newHome.rent) : 0;
    const cTotal = nn(f.newHome.balance) + rentPart + nn(f.newHome.extraToC);
    const broker = nn(f.broker.planned);
    const perTx = pos(f.flow.limits && f.flow.limits.perTx);
    const daily = pos(f.flow.limits && f.flow.limits.daily);
    const txLimit = perTx || 100000000;
    const ids = direct
      ? ['bankA', 'recv', 'keys', 'registry', 'toC', 'broker', 'movein']
      : ['recv', 'keys', 'registry', 'toC', 'broker', 'bank', 'movein'];
    const amountOf = {
      bankA: payoff, recv: direct ? receive - payoff : receive, toC: cTotal, broker, bank: payoff,
    };
    let bal = 0, inSum = 0, outSum = 0, maxOut = 0, doneCount = 0;
    const steps = ids.map((id) => {
      const tv = f.flow.times ? f.flow.times[id] : undefined;
      const s = {
        id, kind: STEP_KIND[id], amount: amountOf[id] != null ? amountOf[id] : null,
        /* 사용자가 비운 시각('')은 그대로 비워 둠 — 저장된 값이 없을 때만 기본 시각 */
        time: typeof tv === 'string' ? tv : (DEFAULT_TIMES[id] || ''),
        done: !!(f.flow.done && f.flow.done[id]), warnings: [], chunks: null, split: null, splitN: 1,
      };
      if (s.done) doneCount++;
      if (s.kind === 'in') {
        if (s.amount < 0) s.warnings.push({ level: 'bad', text: '받을 돈이 0원보다 적어요 — 대출 완제액이 A가 줄 돈보다 커요. 금액을 다시 확인하세요.' });
        bal += s.amount; inSum += s.amount;
      } else if (s.kind === 'out') {
        bal -= s.amount; outSum += s.amount; maxOut = Math.max(maxOut, s.amount);
        s.split = splitInfo(s.amount, txLimit);
        s.splitN = s.split.n;
        s.chunks = s.split.chunks;
        if (bal < 0) s.warnings.push({ level: 'bad', text: '이 단계에서 잔액이 ' + won(-bal) + ' 모자라요 — 보내기 전에 입금부터 확인하세요.' });
        if (perTx && s.amount > perTx) {
          s.warnings.push({ level: 'bad', split: true, text: '한 번에 못 보내요: 1회 한도(' + krw(perTx) + ')보다 ' + won(s.amount - perTx) + ' 많아요 → ' + timesTxt(s.splitN) + ' 나눠 보내세요 (매번 ' + krw(perTx) + ' 이하).' });
          if (s.splitN > SPLIT_LIST) s.warnings.push({ level: 'warn', split: true, text: (s.splitN > 99 ? '100번 넘게' : s.splitN + '번이나') + ' 나눠 보내면 실수·지연 위험이 커요 → 1회 한도를 1억(OTP 보안1등급)으로 올리거나 창구(평일 09~16시)에서 한 번에 보내세요.' });
        } else if (!perTx && s.amount > txLimit) s.warnings.push({ level: 'info', text: '1회 한도를 아직 몰라서 1억 기준으로 나눴어요 (OTP 보안1등급 기준).' });
        if (daily && outSum > daily && outSum - s.amount <= daily) s.warnings.push({ level: 'bad', text: '여기서 1일 이체한도(' + krw(daily) + ')를 넘어요 — 한도를 올리거나 창구에서 이체하세요.' });
      }
      s.balance = bal;
      return s;
    });
    let prev = '';
    steps.forEach((s) => {
      if (s.time && prev && s.time < prev) s.warnings.push({ level: 'warn', text: '앞 단계(' + prev + ')보다 시각이 빨라요 — 순서를 확인하세요.' });
      if (s.time) prev = s.time;
    });
    const principalLeft = num(f.loan.original) - num(f.loan.prepaid);
    const memoDiff = num(f.newHome.memoTotal) ? num(f.newHome.memoTotal) - (nn(f.newHome.balance) + nn(f.newHome.rent) + nn(f.newHome.extraToC)) : 0;
    /* '확인했어요'는 그때의 차액에만 적용 — 차액이 바뀌면 다시 보여 줌 */
    const memoOpen = !!memoDiff && !(f.newHome.memoAck && f.newHome.memoAckDiff === memoDiff);
    return {
      direct, steps, ids, payoff, receive, cTotal, rentPart, broker, perTx, daily, txLimit,
      inflow: inSum, outflow: outSum, leftover: inSum - outSum, maxOut, doneCount,
      principalLeft, interest: payoff - principalLeft,
      memoDiff, memoOpen,
    };
  }

  function lgFallback(state) {
    const inv = state && Array.isArray(state.inventory) ? state.inventory : [];
    let ac = 0, other = 0, otherCount = 0, n = 0;
    inv.forEach((x) => {
      if (!x || !x.lg || x.fate !== 'move') return;
      const q = Math.max(0, Math.round(num(x.qty)));
      if (!q) return;
      n += q;
      if (x.cat === 'aircon' || x.tag === 'aircon') ac += (LG_AC[x.ac] || LG_AC.stand) * q;
      else { other += (LG_PRICE[x.tag] || 100000) * q; otherCount += q; }
    });
    if (otherCount >= 2) other = Math.round(other * 0.9);
    const transport = otherCount ? 40000 : 0;
    return { value: Math.round((ac + other + transport) / 1000) * 1000, count: n };
  }
  function hugPremium(f) {
    const dep = Math.max(0, num(f.newHome.deposit));
    const years = Math.max(0, num(f.protect.hugYears)) || 2;
    const rate = num(f.protect.hugRate) || 0.122;
    return {
      value: Math.round(dep * rate / 100 * years / 100) * 100,
      low: Math.round(dep * 0.00115 * years / 100) * 100,
      high: Math.round(dep * 0.00128 * years / 100) * 100,
      years, rate, dep,
    };
  }
  function autoAmount(kind, f, state, est) {
    if (kind === 'mover') {
      if (est && isNum(est.typical) && est.typical > 0) {
        return { value: Math.round(est.typical / 1000) * 1000, src: 'est', note: '짐·견적 화면 계산값' + (isNum(est.low) && isNum(est.high) ? ' (범위 ' + krw(est.low) + '~' + krw(est.high) + ')' : '') };
      }
      return { value: 1970000, src: 'research', note: '리서치 모델 기준가 (에어컨 제외) — 짐·견적 계산이 생기면 자동으로 바뀌어요' };
    }
    if (kind === 'lg') {
      const c = est && est.lgCost;
      if (c && isNum(c.typical)) return { value: Math.round(c.typical / 1000) * 1000, src: 'est', note: '짐·견적 화면의 LG 이전 계산값' };
      const fb = lgFallback(state);
      if (!fb.count) return { value: 0, src: 'inv', note: '짐 목록에 LG 서비스로 옮길 가전이 아직 없어요' };
      return { value: fb.value, src: 'inv', note: '짐 목록의 LG 이전 가전 ' + fb.count + '개 × 리서치 단가' };
    }
    if (kind === 'waste') {
      const inv = state && Array.isArray(state.inventory) ? state.inventory : [];
      const n = sum(inv.filter((x) => x && x.fate === 'discard' && ['appliance', 'aircon', 'electronics'].indexOf(x.cat) < 0), (x) => Math.max(0, Math.round(num(x.qty))));
      if (n > 0) return { value: n * 15000, src: 'inv', note: '짐 목록의 버릴 가구 ' + n + '개 × 약 1.5만원' };
      return { value: 50000, src: 'research', note: '짐 목록에 버릴 가구가 아직 없어 리서치 평균(약 5만원)' };
    }
    if (kind === 'elevator') {
      const line = est && Array.isArray(est.lines) ? est.lines.find((l) => l && /엘리베이터/.test(String(l.label || ''))) : null;
      if (line && isNum(line.typical) && line.typical > 0) return { value: 0, src: 'est', note: '이사 견적에 이미 들어 있어요 (' + krw(line.typical) + ') — 두 번 세지 않아요' };
      return { value: 100000, src: 'research', note: '두 단지 각 약 5만원으로 가정 (관리사무소 확인)' };
    }
    if (kind === 'hug') {
      const h = hugPremium(f);
      return { value: h.value, src: 'calc', note: '보증금 ' + eok(h.dep) + ' × ' + pctTxt(h.rate, 3) + ' × ' + h.years + '년 (보증금 지키기 탭에서 요율 변경)' };
    }
    return null;
  }
  function computeBudget(f, state, est) {
    const lines = f.budget.lines.map((l) => {
      const meta = LINE_META[l.id] || null;
      const a = meta && meta.auto ? autoAmount(meta.auto, f, state, est) : null;
      const isAuto = !!(a && l.auto !== false);
      return Object.assign({}, l, { meta, autoInfo: a, isAuto, value: isAuto ? a.value : num(l.amount), on: l.on !== false });
    });
    const active = lines.filter((l) => l.on);
    const total = sum(active, (l) => l.value);
    const paid = sum(active.filter((l) => l.paid), (l) => l.value);
    const refunds = f.budget.refunds;
    return {
      lines, total, paid, unpaid: total - paid, count: active.length,
      refunds, refundsTotal: sum(refunds, (r) => r.amount), refundsPending: sum(refunds.filter((r) => !r.got), (r) => r.amount),
    };
  }
  function computeBroker(f) {
    const dep = Math.max(0, num(f.newHome.deposit));
    const rent = Math.max(0, num(f.newHome.rent));
    let conv = dep + rent * 100;
    let used70 = false;
    if (conv < 50000000) { conv = dep + rent * 70; used70 = true; }
    const tierIdx = SEOUL_LEASE.findIndex((t) => conv < t.max);
    const tier = SEOUL_LEASE[tierIdx];
    let cap = Math.floor(conv * tier.rate);
    if (tier.limit) cap = Math.min(cap, tier.limit);
    const vat = VAT[f.broker.vat] || VAT.general;
    const maxWithVat = Math.round(cap * (1 + vat.rate));
    const planned = num(f.broker.planned);
    let verdict = 'ok';
    if (planned > maxWithVat) verdict = 'over';
    else if (planned < maxWithVat) verdict = 'under';
    return { dep, rent, conv, used70, tier, tierIdx, cap, vat, maxWithVat, planned, verdict, diff: planned - maxWithVat };
  }
  function giftTax(base) {
    const B = [[1e8, 0.1, 0], [5e8, 0.2, 1e7], [1e9, 0.3, 6e7], [3e9, 0.4, 1.6e8], [Infinity, 0.5, 4.6e8]];
    for (let i = 0; i < B.length; i++) if (base <= B[i][0]) return Math.max(0, Math.round(base * B[i][1] - B[i][2]));
    return 0;
  }
  function withholding(interest) {
    const income = Math.floor(interest * 0.25 / 10) * 10;
    const local = Math.floor(income * 0.1 / 10) * 10;
    return { income, local, total: income + local, net: interest - income - local };
  }
  function computeGift(f, today) {
    const g = f.father;
    const P = Math.max(0, num(g.principal));
    const proper = Math.max(0, num(g.properRate));
    const actual = Math.max(0, num(g.actualRate));
    const plan = Math.max(0, num(g.planRate));
    const properInt = Math.round(P * proper / 100);
    const actualInt = Math.round(P * actual / 100);
    const benefit = Math.max(0, properInt - actualInt);
    const taxable = benefit >= 10000000;
    let minRate = null;
    if (P > 0) {
      const x = proper - 1e9 / P;
      minRate = x <= 0 ? 0 : Math.ceil((x + 1e-9) * 100) / 100;
    }
    const monthly = (r) => Math.round(P * r / 100 / 12);
    const start = D.valid(g.startDate) ? D.str(D.parse(g.startDate)) : null;
    const startFuture = !!(start && D.diff(start, today) < 0);
    const years = start && !startFuture ? Math.max(0, D.diff(start, today) / 365.25) : 0;
    /* 기간을 안 정한 대출은 1년 단위로 매년 새로 빌린 것으로 봄 → 1년분 이익이 각 1년 단위가 시작될 때 통째로 계산돼요.
       그래서 '경과 연수 × 이익'이 아니라 '시작된 1년 단위 수 × 이익' */
    let periods = 0;
    if (start && !startFuture) { while (periods < 60 && D.diff(addMonths(start, 12 * periods), today) >= 0) periods++; }
    const nextPeriod = start && !startFuture ? addMonths(start, 12 * periods) : null;
    const deduction = Math.max(0, 50000000 - Math.max(0, num(g.priorGifts)));
    const base = Math.max(0, P - deduction);
    const tax = giftTax(base);
    const deadline = start ? monthEnd(start, 3) : null;
    const lateDays = deadline ? Math.max(0, D.diff(deadline, today)) : 0;
    const noReport = Math.round(tax * 0.2);
    const lateFee = Math.round(tax * 0.00022 * lateDays);
    const planMonthly = monthly(plan);
    return {
      P, proper, actual, plan, properInt, actualInt, benefit, taxable, minRate,
      minMonthly: minRate != null ? monthly(minRate) : 0,
      rec: [1.3, 1.5].map((r) => ({ r, m: monthly(r) })),
      planMonthly, planAnnual: Math.round(P * plan / 100), wh: withholding(planMonthly),
      start, startFuture, years, periods, nextPeriod, deduction, cumulative: taxable ? benefit * periods : 0,
      yearsToExhaust: taxable && benefit > 0 ? deduction / benefit : null,
      coveredPeriods: taxable && benefit > 0 ? Math.floor(deduction / benefit) : 0,
      base, tax, deadline, lateDays, noReport, lateFee, worst: tax + noReport + lateFee,
    };
  }
  function computeRentCredit(f, move) {
    const rent = Math.max(0, num(f.newHome.rent));
    const band = BANDS[f.tax.band] || BANDS.mid;
    const first = f.newHome.rentOnMoveDay ? move : addMonths(move, 1);
    const year = (D.parse(move) || new Date()).getFullYear();
    const dates = [];
    for (let i = 0; i < 13; i++) {
      const d = addMonths(first, i);
      const p = D.parse(d);
      if (!p || p.getFullYear() !== year) break;
      dates.push(d);
    }
    const cap = 10000000;
    const paid = rent * dates.length;
    const annualRent = rent * 12;
    return {
      rent, band, year, dates, first, paid,
      credit: Math.round(Math.min(paid, cap) * band.rate),
      annualRent, annual: Math.round(Math.min(annualRent, cap) * band.rate),
      annualLow: Math.round(Math.min(annualRent, cap) * 0.15), annualHigh: Math.round(Math.min(annualRent, cap) * 0.17),
    };
  }
  function computeHousing(f) {
    const original = Math.max(0, num(f.loan.original));
    const repaid = original;
    const capLeft = Math.max(0, 4000000 - Math.max(0, num(f.tax.subscription)));
    const deduction = Math.min(Math.round(repaid * 0.4), capLeft);
    const rate = num(f.tax.marginal) || 0.165;
    return { repaid, prepaid: Math.min(original, Math.max(0, num(f.loan.prepaid))), capLeft, deduction, rate, saving: Math.round(deduction * rate), low: Math.round(deduction * 0.066), high: Math.round(deduction * 0.264) };
  }
  function computeRecon(f, flow) {
    const o = f.old, l = f.loan, n = f.newHome;
    const checks = [
      { key: 'old', label: '구집 보증금 = 먼저 받은 돈 + 11/3 받을 돈', left: num(o.deposit), right: num(o.early) + num(o.receive),
        hint: 'A에게 받을 돈 합계가 보증금과 다르면 A와 금액을 문자로 다시 확인하세요.' },
      { key: 'early', label: '먼저 받은 돈 = 대출 미리 갚음 + 새 집 계약금 중 선지급분', left: num(o.early), right: num(l.prepaid) + num(n.contractFromEarly),
        hint: '먼저 받은 4,200만원이 어디에 쓰였는지 숫자가 맞지 않아요.' },
      { key: 'newdep', label: '새 집 보증금 = 계약금 + 잔금', left: num(n.deposit), right: num(n.contract) + num(n.balance),
        hint: '계약서의 보증금·계약금·잔금을 다시 확인하세요.' },
      { key: 'contract', label: '계약금 = A 선지급분 + 아내 주식 자금', left: num(n.contract), right: num(n.contractFromEarly) + num(n.contractFromWife),
        hint: '계약금을 낸 돈의 출처가 다 적히지 않았어요.' },
      { key: 'loan', label: '대출 원금 = 미리 갚은 돈 + 11/3 남은 원금', left: num(l.original), right: num(l.prepaid) + flow.principalLeft, info: true,
        hint: '' },
    ];
    checks.forEach((c) => { c.diff = c.left - c.right; c.ok = c.info || c.diff === 0; });
    const inflow = [
      { label: 'A가 먼저 준 돈 (매매 계약금 일부)', amount: num(o.early) },
      { label: '11/3 A가 돌려줄 돈', amount: num(o.receive), sub: flow.direct ? '그중 ' + krw(flow.payoff) + '은 A가 은행에 직접' : '' },
      { label: '아내 주식 자금 (계약금 일부)', amount: num(n.contractFromWife) },
    ];
    const inTotal = sum(inflow, (x) => x.amount);
    const uses = [
      { label: '우리전세론 미리 갚음', amount: num(l.prepaid) },
      { label: '우리전세론 11/3 완제', amount: flow.payoff, sub: '원금 ' + krw(flow.principalLeft) + (flow.interest ? (flow.interest > 0 ? ' + 이자 ' : ' − 환급 ') + krw(Math.abs(flow.interest)) : '') },
      { label: '새 집 계약금 (7/13)', amount: num(n.contract) },
      { label: '새 집 잔금 (11/3)', amount: num(n.balance) },
    ];
    if (flow.rentPart) uses.push({ label: '첫 월세 (11/3 함께 지급)', amount: flow.rentPart });
    if (num(n.extraToC)) uses.push({ label: 'C에게 함께 보내는 기타 금액', amount: num(n.extraToC) });
    uses.push({ label: '중개보수', amount: flow.broker });
    const usedTotal = sum(uses, (x) => x.amount);
    const remain = inTotal - usedTotal;
    const ourOld = num(o.deposit) - num(l.original) - num(f.father.principal);
    const ourNew = num(n.deposit) - num(f.father.principal) - num(n.contractFromWife);
    return { checks, inflow, inTotal, uses, usedTotal, remain, flowLeft: flow.leftover, gap: remain - flow.leftover, ourOld, ourNew };
  }

  /* 보증금 지키기 — 체크리스트 항목과 연결.
     패턴은 한 항목만 맞도록 좁게 쓰고(예: '전입신고 때 아이 알리기'와 구분), 한 번 체크하면 그 항목 id 를
     finance.links 에 저장해 늘 같은 항목을 가리킴. 없으면 '+ 체크리스트에 추가' 또는 이 화면에만 체크. */
  function protectRows(move, f, today) {
    const cd = f && D.valid(f.newHome.contractDate) ? f.newHome.contractDate : '2026-07-13';
    const reportDl = D.add(cd, 30);
    const reportDue = today && D.diff(today, reportDl) < 0 ? D.add(today, 1) : reportDl;
    const recvAmt = f ? (f.loan.lien === 'exists' ? Math.max(0, nn(f.old.receive) - nn(f.loan.payoff)) : nn(f.old.receive)) : 378000000;
    const recvTxt = eok(recvAmt);
    return [
      { key: 'report', part: 'admin', re: [/임대차\s*신고\s*(됐|되었|여부)|임대차\s*신고.*확인/], due: reportDue, conf: 'mid', urgent: true,
        title: '[긴급] 새 계약 주택임대차 신고 여부 확인 (신고필증)',
        detail: '수도권에서 보증금 6천만원 초과 또는 월세 30만원 초과 계약은 계약일부터 30일 안에 신고해야 해요(' + eok(nn(f ? f.newHome.deposit : 320000000)) + '·월세 ' + krw(nn(f ? f.newHome.rent : 700000)) + ' → 대상). 한쪽이 양쪽 서명 계약서로 신고하면 공동신고로 보고 확정일자도 자동으로 붙어요.',
        links: [LINK.rtms, LINK.lawReport] },
      { key: 'tax', part: 'admin', re: [/납세\s*증명/, /미납\s*(국세|세금)/], anyDone: true, due: move, conf: 'mid',
        title: '집주인 C 미납 국세·지방세 확인 (납세증명서 또는 세무서 열람)',
        detail: '보증금 1천만원 초과 임차인은 임대차 시작일(' + D.fmt(move) + ')까지 C 동의 없이 세무서 민원실에서 미납 국세를 열람할 수 있어요(신분증·계약서). 더 쉬운 길: 주임법 제3조의7에 따라 C에게 납세증명서와 확정일자 부여현황을 보여 달라고 중개사를 통해 요청. 지방세는 강서구청에 확인.',
        links: [LINK.lawCollect, LINK.lawLease] },
      { key: 'household', part: 'admin', re: [/전입\s*세대\s*확인/], due: D.add(move, -1), conf: 'mid',
        title: '전입세대확인서로 이전 거주자 전입이 빠졌는지 확인',
        detail: '잔금 전날~당일에 발급해 이전 거주자의 전입이 남아 있지 않은지 확인하세요. 남아 있으면 그 사람이 우리보다 앞선 대항력을 가질 수 있어요.',
        links: [] },
      { key: 'registry', part: 'admin', re: [/등기부.*(다시|재열람).*잔금|잔금.*등기부/, /등기부\s*재열람/], due: move, conf: 'high',
        title: '잔금 직전 새 집 등기부 다시 열람',
        detail: '잔금 보내기 직전 인터넷등기소(700원)로 소유자가 C인지, 새 근저당·가압류·신탁이 없는지 확인. 변동이 있으면 송금을 멈추고 중개사와 확인하세요.',
        links: [LINK.iros] },
      { key: 'movein', part: 'admin', re: [/전입\s*신고\s*[·+,및와\s]*\s*확정\s*일자/], due: move, conf: 'high',
        title: '전입신고 + 확정일자 (' + D.fmt(move) + ' 같은 날)',
        detail: '대항력은 집을 넘겨받고 전입신고한 다음날 0시부터, 우선변제권은 대항력+확정일자를 함께 갖춰야 생겨요. 확정일자는 주민센터 600원·인터넷등기소 500원. 구집 돈(' + recvTxt + ')을 받은 뒤에 전입하세요.',
        links: [LINK.lawLease] },
      { key: 'keys', part: 'money', re: [/입금.*열쇠|열쇠.*(넘기|인계|인도)/], due: move, conf: 'high',
        title: '구집: ' + recvTxt + '이 잔액으로 확인된 뒤에만 열쇠·비밀번호 인계',
        detail: '문자 알림이 아니라 통장 잔액으로 확인. 끝내 못 받으면 전입을 유지하고 서울남부지방법원에 임차권등기명령 → 등기부 기재 확인 후 전출.',
        links: [] },
      { key: 'hug', part: 'money', re: [/반환\s*보증/, /보증\s*보험/], due: '2026-11-20', conf: 'mid',
        title: 'HUG 전세보증금반환보증 가입',
        detail: '전입·확정일자를 마친 뒤, 계약기간 1/2이 지나기 전까지 신청(11월 중 권장). 반전세는 보증금 부분만 보증해요.',
        links: [LINK.hug, LINK.hugCompare] },
      { key: 'jangsu', part: 'money', re: [/장기\s*수선.*(돌려|반환|청구)/], due: move, conf: 'mid',
        title: '구집 장기수선충당금 반환 청구 (A에게)',
        detail: '관리사무소에서 납부확인서를 받아 소유자에게 청구하세요(약 20만~50만원 추정). 예산 탭의 "들어올 돈"에 금액이 있어요.',
        links: [] },
      { key: 'oldReport', part: 'admin', re: [/(해제|변경)\s*신고|구\s*계약.*신고/], due: D.add(move, 2), conf: 'low',
        title: '구 계약(2024) 해제·변경 신고가 필요한지 주민센터에 문의',
        detail: '2024년 구 계약이 임대차 신고돼 있었다면 조기종료가 해제 신고(30일 이내) 대상인지 확인하세요. 중도 해지는 대상이 아니라는 해석이 많지만 확인하지 못했어요.',
        links: [LINK.lawReport] },
    ];
  }
  /* 연결 항목 찾기 (순수): ① 저장된 id 가 살아 있으면 그것 ② 아니면 패턴 순서대로, 완료 여부와 무관하게
     같은 파트 → 마감일 → 목록 순서로 하나를 고름 (체크할 때마다 다른 항목으로 옮겨 가지 않게) */
  function findLinked(row, items, links, ns) {
    const key = (ns || '') + row.key;
    const saved = links && links[key];
    if (saved) {
      const it = items.find((x) => x && x.id === saved);
      if (it) return { item: it, count: 1, all: [it], saved: true };
    }
    const re = row.re || [];
    for (let i = 0; i < re.length; i++) {
      const hits = items.map((it, idx) => ({ it, idx })).filter((h) => h.it && re[i].test(String(h.it.title || '')));
      if (hits.length) {
        hits.sort((a, b) => ((a.it.partId === row.part ? 0 : 1) - (b.it.partId === row.part ? 0 : 1))
          || String(a.it.due || '9999').localeCompare(String(b.it.due || '9999')) || (a.idx - b.idx));
        return { item: hits[0].it, count: hits.length, all: hits.map((h) => h.it), saved: false };
      }
    }
    return { item: null, count: 0, all: [] };
  }
  function computeProtect(f, state, move) {
    const items = state && Array.isArray(state.items) ? state.items : [];
    const rows = protectRows(move, f, D.today()).map((r) => {
      const link = findLinked(r, items, f.links, 'prot-');
      let done = link.item ? !!link.item.done : !!(f.protect.checks && f.protect.checks[r.key]);
      const others = r.anyDone ? items.filter((it) => it && r.re.some((re) => re.test(String(it.title || '')))) : [];
      if (r.anyDone && !done) done = others.some((it) => it.done);
      const extra = {};
      if (r.key === 'report') {
        /* 신고 상태(select)와 줄·체크리스트 항목은 한 몸: 연결된 항목이 있으면 그 항목이 기준,
           없으면 이 화면의 체크·신고 상태가 기준. 보이는 신고 상태는 늘 줄의 완료 여부와 맞춤 */
        const st = ['done', 'late'].indexOf(f.protect.rentReport) >= 0 ? f.protect.rentReport : 'unknown';
        if (!link.item && st !== 'unknown') done = true;
        // 확인은 했는데(줄·항목 체크) 결과를 아직 안 고른 상태 = 'checked' — 결과를 가정하지 않음
        extra.reportState = done ? (st === 'unknown' ? 'checked' : st) : 'unknown';
        const follow = findLinked(REPORT_FOLLOW, items, f.links, 'prot-');
        extra.follow = follow.item;
        const cd = D.valid(f.newHome.contractDate) ? f.newHome.contractDate : '2026-07-13';
        extra.deadline = D.add(cd, 30);
        extra.contractDate = cd;
        extra.overDays = D.diff(extra.deadline, D.today());
      }
      return Object.assign(r, { linked: link.item, linkedCount: link.count, alts: others, done }, extra);
    });
    const byKey = {};
    rows.forEach((r) => { byKey[r.key] = r; });
    return { rows, byKey, doneCount: rows.filter((r) => r.done).length };
  }
  /* '[신고 안 됐으면] 바로 임대차 신고하기' 같은 후속 항목 — 신고 상태를 정하면 같이 정리 */
  const REPORT_FOLLOW = { key: 'reportNow', part: 'admin', re: [/신고\s*안\s*(됐|되었)\s*으면|바로\s*임대차\s*신고/] };

  /* 11/3 단계 ↔ 보증금 지키기 줄 ↔ 체크리스트 항목: 같은 일은 한 곳에서 체크하면 모두 바뀜 */
  const STEP_PROT = { keys: 'keys', registry: 'registry', movein: 'movein' };
  const PROT_STEP = { keys: 'keys', registry: 'registry', movein: 'movein' };
  const STEP_ITEM = {
    broker: { key: 'broker', part: 'money', re: [/중개\s*보수\s*(보내|송금|이체|지급)/] },
    bank: { key: 'bank', part: 'money', re: [/완제\s*하기/, /대출.*상환\s*하기/] },
  };
  STEP_ITEM.bankA = STEP_ITEM.bank;
  function linkSteps(c, state) {
    const items = state && Array.isArray(state.items) ? state.items : [];
    c.flow.steps.forEach((s) => {
      s.link = null;
      const pk = STEP_PROT[s.id];
      const pr = pk && c.protect.byKey[pk];
      if (pr) { s.done = !!pr.done; s.link = { kind: 'prot', key: pk, item: pr.linked || null }; return; }
      const def = STEP_ITEM[s.id];
      if (!def) return;
      const l = findLinked(def, items, c.f.links, 'step-');
      if (l.item) { s.done = !!l.item.done; s.link = { kind: 'item', key: def.key, item: l.item }; }
    });
    c.flow.doneCount = c.flow.steps.filter((s) => s.done).length;
  }

  function computeAlerts(c, today) {
    const f = c.f, A = [];
    const rep = c.protect.byKey.report;
    if (rep && !rep.done) {
      const dl = D.add(D.valid(f.newHome.contractDate) ? f.newHome.contractDate : '2026-07-13', 30);
      const over = D.diff(dl, today);
      A.push({ id: 'report', level: over > 0 ? 'bad' : 'warn', overdue: over > 0, tab: 'protect', anchor: 'fn-p-report',
        text: '새 계약 임대차 신고 기한(' + D.fmt(dl) + ')' + (over > 0 ? '이 ' + over + '일 지났을 수 있어요 — 신고필증부터 확인하고, 안 됐으면 바로 신고하세요.' : '까지 신고 여부를 확인하세요.') });
    } else if (rep && rep.reportState === 'checked') {
      A.push({ id: 'reportResult', level: 'info', tab: 'protect', anchor: 'fn-p-report',
        text: '임대차 신고를 확인했다면 결과(신고돼 있음 / 안 돼 있어서 지금 신고함)도 골라 주세요 — 안 돼 있었다면 바로 신고해야 해요.' });
    }
    if (c.broker.verdict === 'over') {
      A.push({ id: 'brokerOver', level: 'bad', tab: 'tax', anchor: 'fn-broker',
        text: '중개보수 계획 ' + won(c.broker.planned) + '이 법정 상한(' + c.broker.vat.label.replace(/ \(.+\)/, '') + ' 기준 ' + won(c.broker.maxWithVat) + ')보다 많아요.' });
    }
    /* 잔액 부족·1일 한도 초과는 🚨, 1회 한도 초과(나눠 보내면 되는 일)는 단계 카드에선 빨강이지만 위 목록에선 ⚠ */
    const badStep = c.flow.steps.find((s) => s.warnings.some((w) => w.level === 'bad' && !w.split));
    if (badStep) {
      const w = badStep.warnings.find((x) => x.level === 'bad' && !x.split);
      A.push({ id: 'flowBad', level: 'bad', tab: 'flow', anchor: 'fn-step-' + badStep.id, text: D.fmt(c.move) + ' 돈 흐름: ' + w.text });
    }
    const splitSteps = c.flow.steps.filter((s) => s.warnings.some((w) => w.split));
    if (splitSteps.length) {
      A.push({ id: 'flowSplit', level: 'warn', tab: 'flow', anchor: 'fn-step-' + splitSteps[0].id,
        text: '1회 이체한도(' + krw(c.flow.perTx) + ')보다 큰 이체가 있어요: ' + splitSteps.map((s) => stepWho(s.id).replace('나 → ', '') + ' ' + timesTxt(s.splitN)).join(', ') + ' 나눠 보내야 해요.' });
    }
    if (f.loan.lien === 'unknown') {
      A.push({ id: 'lien', level: 'warn', tab: 'flow', anchor: 'fn-lien', text: '우리은행에 질권·채권양도 여부와 11/3 기준 완제금액을 확인하세요 (상환 순서가 달라져요).' });
    }
    if (!c.flow.perTx || !c.flow.daily) {
      A.push({ id: 'limits', level: 'warn', tab: 'flow', anchor: 'fn-limits', text: '이체한도 확인: ' + D.fmt(c.move) + ' 내 통장에서 ' + krw(c.flow.outflow) + '이 나가요 → OTP 보안1등급(보통 1회 1억·1일 5억) 준비.' });
    }
    const tx = c.protect.byKey.tax;
    if (tx && !tx.done) {
      const dd = D.dday(c.move);
      A.push({ id: 'taxView', level: 'warn', tab: 'protect', anchor: 'fn-p-tax',
        text: '집주인 C 미납 국세 단독 열람은 ' + D.fmt(c.move) + '까지예요' + (dd.n != null && dd.n >= 0 ? ' (' + dd.label + ')' : '') + ' — 또는 C에게 납세증명서를 요청하세요.' });
    }
    if (!f.newHome.rentConfirmed) {
      A.push({ id: 'rent', level: 'warn', tab: 'flow', anchor: 'fn-rent',
        text: '계약서는 "월세 매월 3일 후불" — 그러면 첫 월세는 ' + D.fmt(addMonths(c.move, 1)) + '예요. ' + D.fmt(c.move) + '에 ' + krw(nn(f.newHome.rent)) + '을 줄지 중개사·C와 확정하세요.' });
    }
    if (c.flow.memoOpen) {
      A.push({ id: 'memo', level: 'warn', tab: 'flow', anchor: 'fn-memo',
        text: '처음 메모한 C 송금액 ' + won(num(f.newHome.memoTotal)) + '과 계산값이 ' + won(Math.abs(c.flow.memoDiff)) + ' 달라요 — 계약서 금액을 확인하세요.' });
    }
    const badChecks = c.recon.checks.filter((x) => !x.ok);
    if (badChecks.length) {
      A.push({ id: 'recon', level: 'warn', tab: 'sources', anchor: 'fn-recon', text: '돈의 출처·쓰임 검산에서 ' + badChecks.length + '곳이 맞지 않아요: ' + badChecks[0].label });
    }
    if (c.net < 0) {
      A.push({ id: 'budget', level: 'warn', tab: 'budget', anchor: 'fn-budget-sum', text: '이사비까지 내면 ' + krw(-c.net) + ' 부족해요 — 예산 탭에서 메우는 방법을 보세요.' });
    }
    if (c.broker.verdict === 'under' && !f.broker.agreed) {
      A.push({ id: 'brokerUnder', level: 'info', tab: 'tax', anchor: 'fn-broker',
        text: '중개보수는 최대 ' + won(c.broker.maxWithVat) + '까지 청구될 수 있어요 (계획 ' + won(c.broker.planned) + ') — 금액을 문자로 미리 확정하세요.' });
    }
    const rank = { bad: 0, warn: 1, info: 2 };
    return A.sort((a, b) => rank[a.level] - rank[b.level]);
  }

  function compute(state) {
    state = state || {};
    const f = withDefaults(state.finance);
    const today = D.today();
    const move = moveDateOf(state);
    let est = null;
    try { est = (MV.calc && typeof MV.calc.moveEstimate === 'function') ? MV.calc.moveEstimate(state) : null; } catch (e) { est = null; }
    if (est && typeof est !== 'object') est = null;
    const flow = computeFlow(f);
    const budget = computeBudget(f, state, est);
    const c = { f, est, today, move, flow, budget, net: flow.leftover - budget.unpaid };
    c.broker = computeBroker(f);
    c.gift = computeGift(f, today);
    c.rentCredit = computeRentCredit(f, move);
    c.housing = computeHousing(f);
    c.recon = computeRecon(f, flow);
    c.protect = computeProtect(f, state, move);
    linkSteps(c, state);
    c.alerts = computeAlerts(c, today);
    return c;
  }

  /* 대시보드 등에서 쓰는 요약 (순수) */
  MV.calc.financeSummary = function financeSummary(state) {
    const c = compute(state || MV.store.get());
    return {
      inflow: c.flow.inflow,
      outflow: c.flow.outflow,
      leftover: c.flow.leftover,
      expensesTotal: c.budget.unpaid,
      expensesAll: c.budget.total,
      expensesPaid: c.budget.paid,
      refunds: c.budget.refundsTotal,
      net: c.net,
      netWithRefunds: c.net + c.budget.refundsTotal,
      mode: c.flow.direct ? 'direct' : 'self',
      steps: c.flow.steps.map((s) => ({ id: s.id, kind: s.kind, title: stepTitle(s.id, c), amount: s.amount, time: s.time, done: s.done, balance: s.balance })),
      warnings: c.alerts.filter((a) => a.level !== 'info').map((a) => ({ text: a.text, level: a.level })),
    };
  };

  /* ======================= 단계 문구 ======================= */
  const KIND_CHIP = { in: 'good', out: 'brand', ext: 'think', task: '' };
  function stepWho(id) {
    return { bankA: 'A → 우리은행', recv: 'A → 나', keys: '구집', registry: '확인', toC: '나 → 임대인 C', broker: '나 → 중개사', bank: '나 → 우리은행', movein: '주민센터' }[id] || '';
  }
  function stepTitle(id, c) {
    switch (id) {
      case 'bankA': return 'A가 은행에 대출 직접 상환';
      case 'recv': return c.flow.direct ? 'A가 나머지 입금 → 잔액으로 확인' : '보증금 잔액 입금 → 잔액으로 확인';
      case 'keys': return '열쇠·비밀번호·카드키 인계';
      case 'registry': return '새 집 등기부 다시 열람';
      case 'toC': return '새 집 잔금 보내기';
      case 'broker': return '중개보수 보내기';
      case 'bank': return '우리전세론 완제';
      case 'movein': return '전입신고 + 확정일자';
      default: return id;
    }
  }
  function stepNotes(id, c) {
    const fl = c.flow;
    switch (id) {
      case 'bankA': return [
        '은행이 알려 준 "11/3 기준 완제금액"을 원 단위까지 A에게 미리 문자로 전달',
        'A가 보낸 뒤 우리은행에 대출 잔액 0원(완제)인지 확인하고 완제확인서 받기',
        '질권·채권양도가 있으면 이 순서가 고정이에요',
      ];
      case 'recv': return [
        '문자 알림이 아니라 통장 앱의 "잔액"으로 확인',
        '확인 전에는 열쇠·비밀번호를 넘기지 않고, 전입도 옮기지 않기',
        'A의 1일 이체한도가 ' + krw(fl.receive) + ' 이상인지 미리 확인 요청' + (fl.direct ? ' (은행 상환분 포함)' : ''),
      ];
      case 'keys': return [
        '잔액 확인 뒤에만 비밀번호·카드키·주차카드 인계',
        '관리사무소 이사정산·도시가스 정산, 장기수선충당금 납부확인서 받기',
      ];
      case 'registry': return [
        '인터넷등기소 700원 — 소유자가 C인지, 새 근저당·가압류·신탁이 없는지',
        '변동이 있으면 송금을 멈추고 중개사와 확인',
      ];
      case 'toC': return [
        '계약서 특약에 적힌 C 본인 명의 계좌로만',
        '계좌를 바꾸자는 연락이 오면 무조건 멈추고 C와 직접 통화',
        '보증금 잔금과 월세를 나눠 적은 영수증 받기',
        '처음 보내는 계좌라 이상거래탐지로 보류될 수 있어요 → 전날 예금주 조회',
      ];
      case 'broker': return [
        '문자로 미리 확정한 금액 (법정 상한 안에서 협의)',
        '현금영수증 발급 확인 (중개업은 10만원 이상 의무발행)',
        '구집 매매 중개사에게는 낼 돈이 없어요',
      ];
      case 'bank': return [
        '같은 날, 늦어도 다음 영업일(11/4)까지 완제 (HF 보증 대출은 전출하면 상환이 원칙)',
        '완제확인서 · 주택자금 상환증명서(연말정산용) · HF 보증료 환급 여부 받기',
      ];
      case 'movein': return [
        '구집 돈을 다 받은 뒤 주민센터에서 전입신고와 확정일자를 함께',
        '대항력은 다음날(11/4) 0시부터 — 그래서 "잔금 다음날까지 권리 설정 금지" 특약이 중요해요',
        '임대차 신고 때 확정일자가 이미 붙었으면 전입신고만',
      ];
      default: return [];
    }
  }
  const MEMO_LABEL = { recv: '내가 받을 계좌', bankA: '대출 상환 계좌 (A에게 전달)', toC: 'C 계좌 (계약서 특약)', broker: '중개사 계좌', bank: '대출 상환 계좌' };

  /* ======================= 스타일 ======================= */
  const CSS = `
.fn-page { min-width: 0; }
.fn-page .view-head .sub b { color: var(--brand); }
.fn-hero { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 10px; margin: 0 0 12px; }
.fn-stat { background: var(--bg-2); border: 1px solid var(--line); border-radius: var(--radius); padding: 12px 14px; box-shadow: var(--shadow); min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.fn-stat-k { font-size: .78rem; font-weight: 700; color: var(--ink-3); }
.fn-stat-v { font-size: 1.38rem; font-weight: 800; letter-spacing: -.02em; line-height: 1.25; font-variant-numeric: tabular-nums; }
.fn-stat-s { font-size: .74rem; color: var(--ink-3); line-height: 1.4; }
.fn-stat.is-in .fn-stat-v { color: var(--good); }
.fn-stat.is-final { background: var(--good-bg); border-color: color-mix(in srgb, var(--good) 35%, var(--line)); }
.fn-stat.is-final .fn-stat-v { color: var(--good); font-size: 1.55rem; }
.fn-stat.is-final.is-neg { background: var(--bad-bg); border-color: color-mix(in srgb, var(--bad) 35%, var(--line)); }
.fn-stat.is-final.is-neg .fn-stat-v { color: var(--bad); }
@media (max-width: 1180px) { .fn-hero { grid-template-columns: repeat(3, minmax(0, 1fr)); } .fn-stat.is-final { grid-column: span 2; } }
@media (max-width: 640px) {
  .fn-hero { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
  .fn-stat { padding: 10px 12px; }
  .fn-stat-v { font-size: 1.12rem; }
  .fn-stat.is-final { grid-column: 1 / -1; }
  .fn-stat.is-final .fn-stat-v { font-size: 1.4rem; }
}

.fn-alerts { margin: 0 0 10px; }
.fn-alert { display: grid; width: 100%; grid-template-columns: auto minmax(0, 1fr) auto; gap: 4px 10px; align-items: center; min-height: 40px; padding: 7px 12px; border-radius: var(--radius-sm); background: var(--warn-bg); border: 1px solid color-mix(in srgb, var(--warn) 30%, var(--line)); color: var(--ink); font: inherit; text-align: left; cursor: pointer; }
.fn-alert:hover { border-color: var(--warn); }
.fn-alert.is-bad:hover { border-color: var(--bad); }
.fn-alert-go { font-weight: 800; color: var(--ink-2); white-space: nowrap; font-size: .9rem; }
.fn-alert + .fn-alert { margin-top: 5px; }
.fn-alert.is-bad { background: var(--bad-bg); border-color: color-mix(in srgb, var(--bad) 40%, var(--line)); }
.fn-alert.is-info { background: var(--bg-2); border-color: var(--line); }
div.fn-alert { cursor: default; }
.fn-alert-ico { font-size: 1.05rem; line-height: 1.4; align-self: start; }
.fn-alert-txt { font-size: .88rem; font-weight: 600; line-height: 1.5; }
.fn-alert.is-bad .fn-alert-txt b { color: var(--bad); }
.fn-alerts-more { margin-top: 6px; }
@media (max-width: 640px) {
  .fn-alert { gap: 4px 8px; padding: 7px 10px; }
  .fn-alert-txt { font-size: .85rem; }
  .fn-alert-go-t { display: none; }
  .fn-alert-go { font-size: 1.2rem; }
}

.fn-tabbar { position: sticky; top: var(--topbar-h); z-index: 12; margin: 0 -4px 12px; padding: 6px 4px 8px; background: color-mix(in srgb, var(--bg) 92%, transparent); backdrop-filter: blur(8px); }
.fn-tabbar .tabs button { min-height: 36px; }
/* 탭이 화면보다 길면 오른쪽(왼쪽)에 '더 있어요' 그림자와 화살표 */
.fn-tabbar::before, .fn-tabbar::after { content: ''; position: absolute; top: 6px; bottom: 8px; width: 40px; pointer-events: none; display: none; align-items: center; font-weight: 800; color: var(--ink-2); font-size: 1.1rem; z-index: 1; }
.fn-tabbar::after { content: '›'; right: 4px; justify-content: flex-end; padding-right: 8px; border-radius: 0 12px 12px 0; background: linear-gradient(to right, transparent, var(--bg-3) 65%); }
.fn-tabbar::before { content: '‹'; left: 4px; justify-content: flex-start; padding-left: 8px; border-radius: 12px 0 0 12px; background: linear-gradient(to left, transparent, var(--bg-3) 65%); }
.fn-tabbar.fn-more-r::after, .fn-tabbar.fn-more-l::before { display: flex; }
.fn-panel { min-width: 0; }
.fn-panel > * + * { margin-top: 12px; }
.fn-page .grid > .card + .card, .fn-recon > .card + .card { margin-top: 0; }
.fn-groups { display: grid; gap: 12px; }
.fn-fieldset { border: 1px solid var(--line); border-radius: var(--radius-sm); padding: 8px 12px 12px; margin: 0; min-width: 0; }
.fn-fieldset > legend { padding: 0 6px; color: var(--ink-2); }
.fn-anchor { scroll-margin-top: calc(var(--topbar-h) + 72px); }
.fn-flash { animation: fn-flash 1.6s ease-out; }
@keyframes fn-flash { 0%, 30% { box-shadow: 0 0 0 4px color-mix(in srgb, var(--brand) 45%, transparent); } 100% { box-shadow: var(--shadow); } }

.fn-sec-head { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; margin: 4px 0 4px; }
.fn-sec-head h2 { margin: 0; }
.fn-sec-meta { display: inline-flex; align-items: center; gap: 8px; font-size: .85rem; color: var(--ink-2); font-weight: 650; }
.fn-sec-meta .progress { width: 120px; }
.fn-card-h { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-bottom: 8px; }
.fn-card-h h3, .fn-card-h h2 { margin: 0; }
.fn-card-h .spacer { flex: 1; }

.fn-basis { display: block; margin-top: 10px; font-size: .78rem; color: var(--ink-3); line-height: 1.6; }
.fn-basis > * { margin-right: 6px; }
.fn-basis .chip { font-size: .7rem; padding: 0 7px; line-height: 1.6; vertical-align: 1px; }
.fn-src { font-weight: 650; white-space: nowrap; }
.fn-verify { color: var(--warn); font-weight: 700; white-space: nowrap; }

.fn-seg { display: flex; flex-wrap: wrap; gap: 4px; padding: 4px; background: var(--bg-3); border-radius: 12px; }
.fn-seg-btn { flex: 1 1 auto; min-height: 38px; border: 0; border-radius: 9px; background: transparent; color: var(--ink-2); font: inherit; font-weight: 700; font-size: .88rem; padding: 6px 12px; cursor: pointer; }
.fn-seg-btn.is-on { background: var(--bg-2); color: var(--ink); box-shadow: var(--shadow); }
.fn-seg-btn.is-on.is-alt { color: var(--warn); }

.fn-two { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
.fn-fields { display: grid; gap: 10px; grid-template-columns: repeat(auto-fill, minmax(190px, 1fr)); }
@media (max-width: 420px) { .fn-two { grid-template-columns: 1fr; } }
.fn-suffix { display: flex; align-items: center; gap: 6px; }
.fn-suffix > em { font-style: normal; color: var(--ink-3); font-weight: 700; white-space: nowrap; flex: none; }
.fn-suffix > .input { flex: 1 1 auto; min-width: 0; }
.fn-note { font-size: .82rem; color: var(--ink-3); }
.fn-chk { min-height: 36px; padding: 4px 0; }
.fn-chk span { line-height: 1.45; }
.fn-mini-btn { min-height: 36px; }

/* --- 단계 --- */
.fn-steps { list-style: none; margin: 10px 0 0; padding: 0; }
.fn-step { display: grid; grid-template-columns: 40px minmax(0, 1fr); gap: 10px; }
.fn-rail { display: flex; flex-direction: column; align-items: center; padding-top: 12px; }
.fn-num { width: 34px; height: 34px; flex: none; border-radius: 50%; display: grid; place-items: center; font-weight: 800; font-size: .95rem; background: var(--bg-3); color: var(--ink-2); border: 2px solid var(--line-2); }
.fn-line { position: relative; flex: 1; width: 2px; min-height: 18px; margin: 4px 0 2px; background: var(--line-2); }
.fn-line::after { content: ''; position: absolute; left: 50%; bottom: -2px; transform: translateX(-50%); border-left: 6px solid transparent; border-right: 6px solid transparent; border-top: 8px solid var(--line-2); }
.fn-step.k-in .fn-num { background: var(--good-bg); color: var(--good); border-color: color-mix(in srgb, var(--good) 45%, var(--line)); }
.fn-step.k-out .fn-num { background: var(--brand-bg); color: var(--brand); border-color: color-mix(in srgb, var(--brand) 45%, var(--line)); }
.fn-step.k-ext .fn-num { background: var(--think-bg); color: var(--think); border-color: color-mix(in srgb, var(--think) 45%, var(--line)); }
.fn-step.is-done .fn-num { background: var(--good); color: var(--on-good); border-color: var(--good); }
.fn-step.k-result .fn-num { background: var(--ink); color: var(--bg); border-color: var(--ink); }
.fn-step-card { margin-bottom: 12px; padding: 12px 14px; min-width: 0; }
.card.fn-step-card + .card { margin-top: 0; }
.fn-step.is-done .fn-step-card { background: color-mix(in srgb, var(--good-bg) 55%, var(--bg-2)); }
.fn-step-head { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.fn-step-name { flex: 1 1 220px; min-width: 0; display: flex; flex-wrap: wrap; align-items: center; gap: 4px 8px; }
.fn-step-name .chip { flex: none; }
.fn-step-title { margin: 0; font-size: 1.02rem; min-width: 0; }
.fn-time { width: 136px; min-height: 36px; padding: 4px 8px; font-variant-numeric: tabular-nums; }
.fn-done { margin-left: auto; padding: 4px 10px; border-radius: 999px; border: 1px solid var(--line-2); min-height: 36px; font-weight: 700; }
.fn-step.is-done .fn-done { background: var(--good-bg); border-color: color-mix(in srgb, var(--good) 45%, var(--line)); color: var(--good); }
.fn-step-body { margin-top: 8px; }
.fn-step-body > * + * { margin-top: 8px; }
.fn-notes { margin: 0; padding-left: 1.15em; font-size: .86rem; color: var(--ink-2); }
.fn-notes li + li { margin-top: 2px; }
.fn-amt-grid { display: grid; gap: 10px; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); align-items: start; }
.fn-big { max-width: 340px; }
.fn-big .input { font-size: 1.2rem; font-weight: 800; min-height: 44px; letter-spacing: -.01em; }
.fn-step.k-in .fn-big .input { color: var(--good); }
.fn-step.k-out .fn-big .input { color: var(--brand); }
.fn-amt { font-size: 1.3rem; font-weight: 800; font-variant-numeric: tabular-nums; letter-spacing: -.01em; }
.fn-amt.is-in { color: var(--good); }
.fn-amt.is-out { color: var(--brand); }
.fn-amt.is-ext { color: var(--think); }
.fn-amt.is-neg { color: var(--bad); }
.fn-total { display: flex; align-items: baseline; flex-wrap: wrap; gap: 4px 10px; padding: 8px 12px; border-radius: var(--radius-sm); background: var(--bg-3); }
.fn-total > span { font-size: .85rem; font-weight: 700; color: var(--ink-2); }
.fn-chunks { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
.fn-warn { font-size: .86rem; font-weight: 650; padding: 6px 10px; border-radius: var(--radius-sm); background: var(--warn-bg); color: var(--ink); border-left: 3px solid var(--warn); }
.fn-warn.is-bad { background: var(--bad-bg); border-left-color: var(--bad); color: var(--bad); }
.fn-warn.is-info { background: var(--bg-3); border-left-color: var(--line-2); color: var(--ink-2); font-weight: 600; }
.fn-warn.is-good { background: var(--good-bg); border-left-color: var(--good); color: var(--good); }
.fn-bal { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; flex-wrap: wrap; padding-top: 8px; border-top: 1px dashed var(--line-2); font-size: .86rem; color: var(--ink-3); }
.fn-bal b { font-size: 1.05rem; color: var(--ink); font-variant-numeric: tabular-nums; }
.fn-bal.is-neg b { color: var(--bad); }
.fn-rentbox { margin: 0; }
.fn-rentbox .row { margin-top: 6px; }
.fn-rentbox .money-input { max-width: 180px; }
.fn-inline-money { display: inline-flex; align-items: flex-start; gap: 8px; min-width: 0; }
.fn-inline-money > span:first-child { line-height: 40px; white-space: nowrap; }
.fn-result { background: var(--bg-2); }
.fn-result-k { font-size: .85rem; font-weight: 700; color: var(--ink-3); }
.fn-result-v { font-size: 1.9rem; font-weight: 800; letter-spacing: -.02em; font-variant-numeric: tabular-nums; line-height: 1.2; color: var(--good); }
.fn-result-v.is-neg { color: var(--bad); }
.fn-memo-input .input { min-height: 36px; font-size: .88rem; }
@media (max-width: 640px) {
  .fn-step { grid-template-columns: 30px minmax(0, 1fr); gap: 8px; }
  .fn-num { width: 28px; height: 28px; font-size: .82rem; }
  .fn-step-card { padding: 10px 12px; }
  .fn-time { width: 128px; }
  .fn-step-name { order: 3; flex-basis: 100%; }
  .fn-result-v { font-size: 1.55rem; }
}

/* --- 목록·체크 --- */
.fn-list { list-style: none; margin: 0; padding: 0; }
.fn-list > li { padding: 8px 0; border-bottom: 1px solid var(--line); display: flex; gap: 8px; align-items: flex-start; flex-wrap: wrap; }
.fn-list > li:last-child { border-bottom: 0; }
.fn-list .check { flex: 1 1 240px; align-items: flex-start; }
.fn-list .check input { margin-top: 3px; flex: none; }
.fn-list li.is-done .check span { color: var(--ink-3); text-decoration: line-through; }
.fn-ul { margin: 0; padding-left: 1.2em; }
.fn-ul li + li { margin-top: 4px; }
.fn-kv { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 4px 12px; font-size: .9rem; }
.fn-kv > .v { text-align: right; font-weight: 700; font-variant-numeric: tabular-nums; white-space: nowrap; }
.fn-kv > .k { color: var(--ink-2); min-width: 0; }
.fn-kv > .sep { grid-column: 1 / -1; border-top: 1px solid var(--line-2); margin: 2px 0; }
.fn-kv > .v.is-good { color: var(--good); } .fn-kv > .v.is-bad { color: var(--bad); }
.fn-cl-link, .fn-guide { display: inline-flex; align-items: center; min-height: 36px; font-size: .8rem; font-weight: 650; white-space: nowrap; }
/* 터치 화면: 글 속 링크·접기 버튼도 누르는 곳 36px 이상 */
@media (pointer: coarse), (any-pointer: coarse), (max-width: 1024px) {
  .fn-page a:not(.btn) { display: inline-flex; align-items: center; min-height: 36px; vertical-align: middle; }
  .fn-page details:not(.fn-why) > summary { padding: 8px 0; min-height: 36px; }
}
/* 터치 화면인데 브라우저가 pointer:coarse 를 알려 주지 않는 경우 (가로 태블릿 등) — JS 로 붙인 fn-touch */
.fn-page.fn-touch a:not(.btn) { display: inline-flex; align-items: center; min-height: 36px; vertical-align: middle; }
.fn-page.fn-touch details:not(.fn-why) > summary { padding: 8px 0; min-height: 36px; }
.fn-card-h .fn-guide { margin-left: auto; }
.fn-contacts { display: grid; gap: 10px; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); }

/* --- 출처·쓰임 --- */
.fn-check-row { display: grid; grid-template-columns: auto minmax(0, 1fr) auto; gap: 4px 10px; align-items: start; padding: 8px 0; border-bottom: 1px solid var(--line); font-size: .9rem; }
.fn-check-row:last-child { border-bottom: 0; }
.fn-check-ico { font-weight: 800; width: 1.4em; text-align: center; }
.fn-check-row.is-ok .fn-check-ico { color: var(--good); }
.fn-check-row.is-bad .fn-check-ico { color: var(--bad); }
.fn-check-row.is-info .fn-check-ico { color: var(--kid); }
.fn-check-val { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; font-weight: 700; }
.fn-check-row .fn-note { grid-column: 2 / -1; }
.fn-recon { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
@media (max-width: 860px) { .fn-recon { grid-template-columns: 1fr; } }
.fn-recon table.tbl td.num { font-weight: 700; }
.fn-recon tfoot td { font-size: .95rem; }
.fn-sub { display: block; font-size: .76rem; color: var(--ink-3); font-weight: 500; }
.fn-tr-left td { background: var(--good-bg); }
.fn-bar { display: flex; height: 30px; border-radius: 8px; overflow: hidden; background: var(--bg-3); }
.fn-bar > i { display: block; height: 100%; min-width: 3px; }
.fn-bar > i + i { box-shadow: -2px 0 0 var(--bg-2); }
.fn-c-father { background: var(--think); }
.fn-c-ours { background: var(--kid); }
.fn-c-loan { background: var(--warn); }
.fn-c-wife { background: var(--brand); }
.fn-legend { display: flex; flex-wrap: wrap; gap: 4px 14px; margin-top: 6px; font-size: .84rem; }
.fn-legend span { display: inline-flex; align-items: center; gap: 6px; }
.fn-legend i { width: 12px; height: 12px; border-radius: 3px; display: inline-block; }
.fn-bars > * + * { margin-top: 14px; }
.fn-bar-h { display: flex; justify-content: space-between; gap: 8px; flex-wrap: wrap; font-weight: 700; font-size: .92rem; margin-bottom: 6px; }
.fn-chain { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
.fn-chain-node { padding: 6px 10px; border-radius: var(--radius-sm); background: var(--bg-3); font-size: .85rem; font-weight: 650; line-height: 1.35; }
.fn-chain-node small { display: block; font-weight: 500; color: var(--ink-3); font-size: .74rem; }
.fn-chain-arrow { color: var(--ink-3); font-weight: 800; }

/* --- 예산 --- */
.fn-bstats { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 10px; }
.fn-bstat { padding: 10px 12px; border-radius: var(--radius-sm); background: var(--bg-3); min-width: 0; }
.fn-bstat .k { font-size: .76rem; color: var(--ink-3); font-weight: 700; }
.fn-bstat .v { font-size: 1.15rem; font-weight: 800; font-variant-numeric: tabular-nums; }
@media (max-width: 860px) { .fn-bstats { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
.fn-verdict { margin-top: 12px; padding: 12px 14px; border-radius: var(--radius-sm); display: flex; flex-wrap: wrap; align-items: baseline; gap: 4px 12px; }
.fn-verdict.is-good { background: var(--good-bg); }
.fn-verdict.is-bad { background: var(--bad-bg); }
.fn-verdict .k { font-weight: 700; }
.fn-verdict .v { font-size: 1.5rem; font-weight: 800; font-variant-numeric: tabular-nums; }
.fn-verdict.is-good .v { color: var(--good); }
.fn-verdict.is-bad .v { color: var(--bad); }
.fn-cmp { margin-top: 12px; display: grid; gap: 6px; }
.fn-cmp-row { display: grid; grid-template-columns: 110px minmax(0, 1fr) auto; gap: 8px; align-items: center; font-size: .84rem; }
.fn-cmp-track { height: 14px; border-radius: 999px; background: var(--bg-3); overflow: hidden; }
.fn-cmp-track > i { display: block; height: 100%; border-radius: inherit; }
.fn-cmp-track .is-left { background: var(--good); }
.fn-cmp-track .is-cost { background: var(--brand); }
.fn-cmp-row b { font-variant-numeric: tabular-nums; }
.fn-blist { container-type: inline-size; min-width: 0; }
/* 기본(좁은 칸·컨테이너 쿼리 미지원): 세로로 쌓기 → 칸 너비가 넉넉할 때만 한 줄로 */
.fn-bl-head { display: none; font-size: .76rem; color: var(--ink-3); font-weight: 700; padding: 0 0 6px; border-bottom: 1px solid var(--line-2); gap: 8px 10px; }
.fn-bl, .fn-rf { display: grid; gap: 8px 10px; align-items: start; padding: 10px 0; border-bottom: 1px solid var(--line); min-width: 0; }
.fn-bl { grid-template-columns: minmax(0, 1fr) auto; grid-template-areas: "label del" "amount amount" "date paid" "memo memo"; }
.fn-rf { grid-template-columns: minmax(0, 1fr) auto; grid-template-areas: "label del" "amount paid" "memo memo"; }
.fn-blist > .fn-bl:last-child, .fn-blist > .fn-rf:last-child { border-bottom: 0; }
@container (min-width: 560px) {
  .fn-bl { grid-template-columns: minmax(0, 1.3fr) minmax(0, 1fr) auto; grid-template-areas: "label label del" "amount date paid" "memo memo memo"; }
}
@container (min-width: 940px) {
  .fn-bl-head { display: grid; }
  .fn-bl-head, .fn-bl { grid-template-columns: minmax(0, 1.45fr) minmax(190px, 1fr) 150px 64px minmax(0, .9fr) 40px; grid-template-areas: "label amount date paid memo del"; }
}
@container (min-width: 700px) {
  .fn-rf { grid-template-columns: minmax(0, 1.4fr) minmax(170px, 1fr) auto minmax(0, 1fr) 40px; grid-template-areas: "label amount paid memo del"; }
}
.fn-bl-label { grid-area: label; min-width: 0; }
.fn-bl-amount { grid-area: amount; min-width: 0; }
.fn-bl-date { grid-area: date; min-width: 0; }
.fn-bl-paid { grid-area: paid; align-self: start; padding-top: 1px; }
.fn-bl-memo { grid-area: memo; min-width: 0; }
.fn-bl-del { grid-area: del; }
.fn-bl .input, .fn-rf .input { min-height: 38px; }
.fn-bl-label .fn-basis { margin-top: 4px; font-size: .74rem; }
.fn-bl-auto { display: flex; flex-direction: column; gap: 2px; }
.fn-bl-auto b { font-size: 1.05rem; font-variant-numeric: tabular-nums; }
.fn-bl-auto small { color: var(--ink-3); font-size: .74rem; line-height: 1.4; }
.fn-bl-actions { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 4px; align-items: center; }
.fn-bl.is-paid .fn-bl-label .input, .fn-rf.is-paid .fn-bl-label .input { text-decoration: line-through; color: var(--ink-3); }
.fn-bl.is-off { opacity: .55; }
.fn-range { display: flex; flex-wrap: wrap; align-items: baseline; gap: 2px 10px; margin-top: 4px; font-size: .76rem; color: var(--ink-3); }
.fn-why { font-size: .76rem; color: var(--ink-3); min-width: 0; }
.fn-why > summary { cursor: pointer; list-style: none; display: inline-flex; align-items: center; gap: 4px; min-height: 36px; font-weight: 650; white-space: nowrap; }
.fn-why > summary::-webkit-details-marker { display: none; }
.fn-why > summary::after { content: '▾'; font-size: .8em; }
.fn-why[open] > summary::after { content: '▴'; }
.fn-why .chip { font-size: .7rem; padding: 0 7px; }
.fn-why .fn-basis { margin-top: 2px; }
.fn-range .fn-why[open] { flex-basis: 100%; }
.fn-bad-hint { color: var(--bad) !important; font-weight: 700; }
.fn-page .input[aria-invalid="true"] { border-color: var(--bad); box-shadow: 0 0 0 2px color-mix(in srgb, var(--bad) 22%, transparent); }
.fn-bad-hint:empty, .fn-num-msg:empty { display: none; }
.fn-warn-hint { color: var(--warn) !important; font-weight: 700; }
.fn-memo-total { max-width: 240px; margin: 0; }
.fn-memo-row { align-items: flex-end; }

/* --- 계산기 공통 --- */
.fn-calc-out { margin-top: 12px; padding: 12px 14px; border-radius: var(--radius-sm); background: var(--bg-3); }
.fn-calc-out > * + * { margin-top: 8px; }
.fn-big-num { font-size: 1.5rem; font-weight: 800; font-variant-numeric: tabular-nums; letter-spacing: -.02em; line-height: 1.25; }
.fn-big-num.is-good { color: var(--good); } .fn-big-num.is-bad { color: var(--bad); } .fn-big-num.is-brand { color: var(--brand); }
.fn-qa-q { font-size: 1.05rem; font-weight: 800; }
.fn-qa-a { font-size: 1.25rem; font-weight: 800; color: var(--good); margin: 4px 0 8px; }
.fn-tier-row.is-cur td { background: var(--brand-bg); font-weight: 700; }
.fn-formula { font-variant-numeric: tabular-nums; font-size: .88rem; color: var(--ink-2); }

/* --- 보증금 지키기 --- */
.fn-prot { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 4px 12px; padding: 12px 0; border-bottom: 1px solid var(--line); }
.fn-prot:last-child { border-bottom: 0; }
.fn-prot-cb { display: flex; align-items: center; justify-content: center; width: 36px; height: 36px; margin: -5px -7px 0; cursor: pointer; }
.fn-prot-cb > input[type=checkbox] { width: 22px; height: 22px; margin: 0; accent-color: var(--good); cursor: pointer; }
.fn-prot-title { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; font-weight: 750; }
.fn-prot-title label { cursor: pointer; }
.fn-prot.is-done .fn-prot-title label { color: var(--ink-3); text-decoration: line-through; }
.fn-prot-body { grid-column: 2; font-size: .88rem; color: var(--ink-2); }
.fn-prot-body > * + * { margin-top: 6px; }
.fn-prot-body .fn-kv, .fn-prot-body .fn-total { max-width: 560px; }
.fn-prot-body .field { max-width: 380px; }
.fn-prot-body .fn-fields { max-width: 560px; }
.fn-prot-link { display: flex; flex-wrap: wrap; gap: 4px 12px; align-items: center; font-size: .82rem; }
.fn-prot-chips { display: inline-flex; flex-wrap: wrap; gap: 6px; align-items: center; }
.fn-step-link { gap: 2px 10px; }

/* --- 당일 시트 --- */
.fn-sheet h3 { margin: 14px 0 6px; }
.fn-sheet-sum { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; margin: 8px 0 12px; }
.fn-sheet-sum > div { padding: 8px 10px; border: 1px solid var(--line-2); border-radius: var(--radius-sm); }
.fn-sheet-sum b { display: block; font-size: 1.05rem; font-variant-numeric: tabular-nums; }
.fn-sheet-sum span { font-size: .76rem; color: var(--ink-3); font-weight: 700; }
.fn-sheet-row { display: grid; grid-template-columns: 30px 54px minmax(0, 1fr) auto; gap: 4px 10px; align-items: start; padding: 8px 0; border-bottom: 1px solid var(--line); break-inside: avoid; }
.fn-sheet-row input[type=checkbox] { width: 22px; height: 22px; margin: 2px 0 0; accent-color: var(--good); }
.fn-sheet-time { font-weight: 800; font-variant-numeric: tabular-nums; white-space: nowrap; }
.fn-sheet-what b { display: block; }
.fn-sheet-what small { display: block; color: var(--ink-3); font-size: .78rem; }
.fn-sheet-amt { text-align: right; font-weight: 800; font-variant-numeric: tabular-nums; white-space: nowrap; }
.fn-sheet-amt small { display: block; font-weight: 600; color: var(--ink-3); font-size: .74rem; }
.fn-sheet-contacts { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 4px 16px; font-size: .9rem; }
@media (max-width: 560px) {
  .fn-sheet-sum { grid-template-columns: 1fr; gap: 4px; }
  .fn-sheet-sum > div { display: flex; justify-content: space-between; align-items: baseline; gap: 8px; padding: 5px 10px; }
  .fn-sheet-row { grid-template-columns: 26px 50px minmax(0, 1fr); gap: 4px 8px; }
  .fn-sheet-amt { grid-column: 3; text-align: left; }
  .fn-sheet-contacts { grid-template-columns: 1fr; }
}
@media print {
  /* html 까지 밝은 색으로 (어두운 화면에서 인쇄해도 아래쪽이 검게 나오지 않게). :root[data-theme] 보다 우선하도록 html:root */
  html:root.fn-print-mode, body.fn-print-mode {
    --bg: #ffffff; --bg-2: #ffffff; --bg-3: #f1efea; --ink: #111111; --ink-2: #333333; --ink-3: #555555;
    --line: #bbbbbb; --line-2: #888888; --good: #15803d; --good-bg: #ffffff; --brand: #9a3412; --bad: #b91c1c; --warn: #854d0e;
    --brand-bg: #ffffff; --warn-bg: #ffffff; --bad-bg: #ffffff; --kid-bg: #ffffff; --think-bg: #ffffff;
    background: #ffffff !important; color: #111111; color-scheme: light;
  }
  body.fn-print-mode .app, body.fn-print-mode .toast-wrap { display: none !important; }
  body.fn-print-mode .modal-back { position: static !important; inset: auto !important; display: block !important; padding: 0 !important; background: none !important; animation: none !important; }
  body.fn-print-mode .modal { width: 100% !important; max-height: none !important; box-shadow: none !important; border-radius: 0 !important; overflow: visible !important; }
  body.fn-print-mode .modal-head .btn, body.fn-print-mode .modal-foot, body.fn-print-mode .fn-no-print { display: none !important; }
  body.fn-print-mode .modal-body { overflow: visible !important; padding: 0 !important; }
  body.fn-print-mode .fn-sheet-row { grid-template-columns: 28px 54px minmax(0, 1fr) auto; }
  body.fn-print-mode .fn-sheet-amt { grid-column: auto; text-align: right; }
  body.fn-print-mode .fn-sheet-sum { grid-template-columns: repeat(3, 1fr); }
  body.fn-print-mode .fn-sheet-contacts { grid-template-columns: 1fr 1fr; }
}
`;

  /* ======================= 입력 도우미 ======================= */
  let structNext = false;
  function upd(fn, opts) {
    MV.store.update((st) => { if (!st.finance) st.finance = withDefaults(null); fn(st.finance); }, Object.assign({ source: SRC }, opts || {}));
  }
  function updStruct(fn, opts) { structNext = true; upd(fn, opts); }
  function updSilent(fn) {
    MV.store.update((st) => { if (!st.finance) st.finance = withDefaults(null); fn(st.finance); }, { silent: true, source: SRC });
  }
  function moneyField(label, value, onChange, o) {
    o = o || {};
    const mi = MV.ui.moneyInput(isNum(value) ? value : null, onChange, { placeholder: o.placeholder, noHint: o.noHint });
    if (o.fk) mi.input.setAttribute('data-fk', o.fk);
    /* 저장 전 검사: 음수·'1억abc' 같은 입력은 저장하지 않고 빨간 안내 (core 의 저장 처리보다 먼저, capture 단계) */
    const errHint = o.noHint ? el('small', { class: 'hint fn-bad-hint', role: 'alert' }) : null;
    if (errHint) mi.appendChild(errHint);
    mi.addEventListener('change', (e) => {
      if (e.target !== mi.input) return;
      // 전각 숫자('１２０만')는 core 가 읽기 전에 보통 숫자로 바꿔 둠
      const hw = halfwidth(mi.input.value);
      if (hw !== mi.input.value) mi.input.value = hw;
      const r = moneyCheck(mi.input.value, { max: o.max });
      const hint = errHint || mi.querySelector('.hint');
      if (!r.ok) {
        e.stopPropagation();
        mi.input.setAttribute('aria-invalid', 'true');
        if (hint) { hint.textContent = '⚠ ' + r.msg; hint.classList.add('fn-bad-hint'); }
        return;
      }
      if (hint) hint.classList.remove('fn-bad-hint');
      if (errHint) errHint.textContent = '';
    }, true);
    if (o.emptyZero) {
      // 비우면(0) 빈칸으로 둠 — '모름' 상태
      mi.input.addEventListener('change', () => {
        if (MV.parseMoney(mi.input.value) === 0) { mi.input.value = ''; const h = mi.querySelector('.hint'); if (h) h.textContent = ''; }
      });
    }
    // 한글 '억·만' 입력(IME 조합) 중 Enter 는 조합 확정에 쓰이도록 막음
    mi.addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.isComposing || e.keyCode === 229)) e.stopPropagation(); }, true);
    if (o.bare) { mi.input.setAttribute('aria-label', label); if (o.cls) mi.classList.add(o.cls); return mi; }
    return el('label', { class: 'field fn-money ' + (o.cls || '') }, el('span', label), mi, o.hint ? el('small', { class: 'hint' }, o.hint) : null);
  }
  function numField(label, value, onChange, o) {
    o = o || {};
    const input = el('input', { class: 'input num', type: 'text', inputmode: 'decimal', value: isNum(value) ? String(value) : '', placeholder: o.placeholder || '', 'data-fk': o.fk || null, autocomplete: 'off' });
    /* 이 칸들(이자율 %, 기간 년)은 천 단위 숫자가 없어서 '1,3'은 소수점(1.3)으로 읽고, 못 읽으면 이유를 적어 줌 */
    const msg = el('small', { class: 'hint fn-num-msg', role: 'alert' });
    const unit = (o.suffix || '').replace(/\s*\/.*$/, '');
    const fail = (t) => { input.setAttribute('aria-invalid', 'true'); msg.classList.add('fn-bad-hint'); msg.textContent = '⚠ ' + t + ' — 저장하지 않았어요'; };
    const commit = () => {
      let raw = halfwidth(input.value).replace(/[\s%년]/g, '');
      if (/^\d+,\d{1,2}$/.test(raw)) raw = raw.replace(',', '.');
      if (raw === '') {
        if (o.allowEmpty) { input.removeAttribute('aria-invalid'); msg.textContent = ''; onChange(null); return; }
        fail('비워 둘 수 없어요. 없으면 0을 넣으세요');
        return;
      }
      if (/^[-−]/.test(raw)) { fail('0보다 작은 값은 넣을 수 없어요'); return; }
      if (!/^\d+(\.\d+)?$|^\.\d+$/.test(raw)) { fail('숫자로 읽을 수 없어요 (예: ' + (o.example || '1.3') + ')'); return; }
      let v = parseFloat(raw);
      if (!isFinite(v)) { fail('숫자로 읽을 수 없어요 (예: ' + (o.example || '1.3') + ')'); return; }
      let note = '';
      if (o.min != null && v < o.min) { v = o.min; note = o.min + unit + ' 이상만 넣을 수 있어서 ' + o.min + '(으)로 바꿨어요'; }
      if (o.max != null && v > o.max) { v = o.max; note = o.max + unit + ' 이하만 넣을 수 있어서 ' + o.max + '(으)로 바꿨어요'; }
      input.removeAttribute('aria-invalid');
      msg.classList.remove('fn-bad-hint');
      msg.textContent = note ? 'ℹ ' + note : '';
      input.value = String(v);
      onChange(v);
    };
    input.addEventListener('change', commit);
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.isComposing && e.keyCode !== 229) { e.preventDefault(); input.blur(); } });
    return el('label', { class: 'field' }, el('span', label), el('span', { class: 'fn-suffix' }, input, o.suffix ? el('em', o.suffix) : null), msg, o.hint ? el('small', { class: 'hint' }, o.hint) : null);
  }
  function textField(label, value, onInput, o) {
    o = o || {};
    const input = el('input', { class: 'input', type: 'text', value: value || '', placeholder: o.placeholder || '', 'data-fk': o.fk || null, autocomplete: 'off', 'aria-label': o.bare ? label : null });
    input.addEventListener('input', () => onInput(input.value));
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.isComposing && e.keyCode !== 229) { e.preventDefault(); input.blur(); } });
    if (o.bare) return input;
    return el('label', { class: 'field ' + (o.cls || '') }, el('span', label), input);
  }
  function dateField(label, value, onChange, o) {
    o = o || {};
    const input = el('input', { class: 'input', type: 'date', value: D.valid(value) ? D.str(D.parse(value)) : '', 'data-fk': o.fk || null, 'aria-label': o.bare ? label : null });
    input.addEventListener('change', () => onChange(input.value));
    if (o.bare) return input;
    return el('label', { class: 'field' }, el('span', label), input, o.hint ? el('small', { class: 'hint' }, o.hint) : null);
  }
  function selectField(label, value, options, onChange, o) {
    o = o || {};
    const s = el('select', { class: 'select', 'data-fk': o.fk || null, 'aria-label': o.bare ? label : null },
      options.map(([v, l]) => el('option', { value: String(v), selected: String(v) === String(value) }, l)));
    s.addEventListener('change', () => onChange(s.value));
    if (o.bare) return s;
    return el('label', { class: 'field' }, el('span', label), s, o.hint ? el('small', { class: 'hint' }, o.hint) : null);
  }
  function checkbox(label, checked, onChange, o) {
    o = o || {};
    const cb = el('input', { type: 'checkbox', checked: !!checked, 'data-fk': o.fk || null });
    cb.addEventListener('change', () => onChange(cb.checked));
    return el('label', { class: 'check fn-chk ' + (o.cls || '') }, cb, el('span', label));
  }
  function chip(text, cls) { return el('span', { class: 'chip ' + (cls || '') }, text); }

  /* ======================= 뷰 ======================= */
  let lastTab = 'flow';
  const TABS = [
    { id: 'flow', label: '🗓 11/3 돈 흐름' },
    { id: 'sources', label: '🧮 출처·쓰임' },
    { id: 'budget', label: '🧾 이사 예산' },
    { id: 'father', label: '👨‍👦 아버지 차용금' },
    { id: 'tax', label: '📑 복비·세금' },
    { id: 'protect', label: '🛡 보증금 지키기' },
  ];
  const validTab = (t) => (TABS.some((x) => x.id === t) ? t : null);
  let alertsOpen = false;

  function render(root, params, ctx) {
    MV.css('fn', CSS);
    ensureState();
    const P = {
      root, tab: validTab(params && params[0]) || lastTab || 'flow',
      c: compute(MV.store.get()),
      shell: [], panelBinds: [], target: null, panel: null, tabbar: null, focusAfter: null, deferred: false, sheet: null,
    };
    lastTab = P.tab;
    P.target = P.shell;
    P.bind = (fn) => {
      const run = () => { try { fn(); } catch (e) { console.error('[money]', e); } };
      run();
      P.target.push(run);
    };
    P.live = (tag, cls, fn) => {
      const node = el(tag, { class: cls || null });
      const run = () => {
        const ae = document.activeElement;
        const inNode = !!(ae && ae !== document.body && node.contains(ae));
        // Tab 을 누르면 브라우저가 포커스를 먼저 빼고(body) change 를 보내요 → 직전에 포커스가 있던 칸으로 판단
        const lost = !inNode && (!ae || ae === document.body) && !!lastFocus && node.contains(lastFocus);
        const had = inNode || lost;
        const fk = inNode ? ae.getAttribute('data-fk') : null;
        const intent = lost && navKey && navKey.kind === 'tab' && Date.now() - navKey.t < 1500 ? nextFocusable(lastFocus, navKey.shift) : null;
        const intentFk = intent && node.contains(intent) ? intent.getAttribute('data-fk') : null;
        let kids;
        try { kids = fn(); } catch (e) {
          console.error('[money]', e);
          kids = el('p', { class: 'small muted mb-0' }, '이 부분을 계산하다 문제가 생겼어요: ' + ((e && e.message) || e));
        }
        node.replaceChildren(...flatKids(kids));
        if (fk) refocus(node, fk);
        // 포커스가 있던 칸이 사라졌으면(예: 차이가 0이 돼 안내 상자가 닫힘) Tab 으로 가던 다음 칸으로
        if (had && !node.contains(document.activeElement)) rescueFocus(node, intentFk);
      };
      run();
      P.target.push(run);
      return node;
    };
    P.goTo = (tab, anchor) => {
      if (tab && tab !== P.tab) switchTab(tab);
      if (!anchor) return;
      requestAnimationFrame(() => {
        const t = document.getElementById(anchor);
        if (!t) return;
        t.classList.add('fn-anchor');
        try { t.scrollIntoView({ block: 'start', behavior: 'smooth' }); } catch (e) { t.scrollIntoView(); }
        t.classList.remove('fn-flash');
        void t.offsetWidth;
        t.classList.add('fn-flash');
        setTimeout(() => t.classList.remove('fn-flash'), 1700);
      });
    };
    P.tabLink = (tab, anchor) => (e) => { if (e) e.preventDefault(); P.goTo(tab, anchor); };

    function refresh() {
      P.c = compute(MV.store.get());
      P.shell.forEach((run) => run());
      P.panelBinds.forEach((run) => run());
    }
    function rebuildPanel(o) {
      o = o || {};
      const ae = document.activeElement;
      if (!o.force && ae && P.panel.contains(ae) && isTextEntry(ae)) {
        // 입력 중인 칸은 지우지 않음: 포커스가 떠난 뒤 다시 그림
        if (!P.deferred) {
          P.deferred = true;
          const arm = (target) => target.addEventListener('blur', () => setTimeout(() => {
            if (!root.isConnected || !P.deferred) return;
            // 아직 이 탭의 다른 입력 칸(또는 다시 그려진 같은 칸)에 있으면 계속 기다림 —
            // 여기서 다시 그리면 그 칸이 또 바뀌고 blur 가 또 와서 끝없이 다시 그리게 돼요
            const now = document.activeElement;
            if (now && now !== target && now.isConnected && P.panel.contains(now) && isTextEntry(now)) { arm(now); return; }
            P.deferred = false;
            P.c = compute(MV.store.get());
            rebuildPanel();
          }, 0), { once: true });
          arm(ae);
        }
        P.panelBinds.forEach((run) => run());
        return;
      }
      P.deferred = false;
      const fk = ae && P.panel.contains(ae) ? ae.getAttribute('data-fk') : null;
      P.panelBinds = [];
      P.target = P.panelBinds;
      let content;
      try { content = buildTab(P); } catch (e) {
        console.error('[money]', e);
        content = el('div', { class: 'card tint-bad' }, el('h3', '이 탭을 그리다 문제가 생겼어요'), el('p', { class: 'small' }, String((e && e.message) || e)));
      }
      P.panel.replaceChildren(content);
      P.target = P.shell;
      const want = P.focusAfter || fk;
      if (want) refocus(P.panel, want, !!P.focusAfter);
      P.focusAfter = null;
    }
    function rebuildAll() {
      P.c = compute(MV.store.get());
      P.shell.forEach((run) => run());
      rebuildPanel();
    }
    P.rebuildPanel = rebuildPanel;
    function updateTabButtons() {
      MV.$$('button[data-tab]', P.tabbar).forEach((b) => {
        const on = b.dataset.tab === P.tab;
        b.classList.toggle('active', on);
        b.setAttribute('aria-selected', String(on));
        b.tabIndex = on ? 0 : -1;
      });
    }
    function switchTab(id, o) {
      id = validTab(id) || 'flow';
      o = o || {};
      if (id === P.tab && !o.force) return;
      P.tab = id;
      lastTab = id;
      const hash = '#/money/' + id;
      if (location.hash !== hash) {
        try { history[o.replace ? 'replaceState' : 'pushState'](history.state, '', hash); } catch (e) { /* 무시 */ }
      }
      MV.route = { name: 'money', params: [id] };
      updateTabButtons();
      rebuildPanel({ force: true });
      const top = P.tabbar.getBoundingClientRect().top;
      const topbarH = (document.querySelector('.topbar') || { offsetHeight: 56 }).offsetHeight;
      if (top <= topbarH + 1) {
        const y = window.scrollY + P.panel.getBoundingClientRect().top - topbarH - P.tabbar.offsetHeight - 8;
        window.scrollTo(0, Math.max(0, y));
      }
      revealTab(id);
    }
    P.switchTab = switchTab;
    /* 고른 탭이 탭 줄 양 끝의 '더 있어요' 그림자(40px)에 가리지 않게 가로 스크롤 */
    function revealTab(id) {
      const tabs = P.tabbar && P.tabbar.querySelector('.tabs');
      const btn = tabs && tabs.querySelector('button[data-tab="' + id + '"]');
      if (!btn) return;
      const max = tabs.scrollWidth - tabs.clientWidth;
      if (max <= 0) return;
      const pad = 48;
      const left = btn.getBoundingClientRect().left - tabs.getBoundingClientRect().left + tabs.scrollLeft;
      const right = left + btn.offsetWidth;
      let x = tabs.scrollLeft;
      if (btn.offsetWidth + pad * 2 > tabs.clientWidth || left - pad < x) x = left - pad;
      else if (right + pad > x + tabs.clientWidth) x = right + pad - tabs.clientWidth;
      x = Math.max(0, Math.min(max, Math.round(x)));
      if (x !== tabs.scrollLeft) tabs.scrollLeft = x;
      if (P.moreHint) P.moreHint();
    }

    /* ---- 셸: 머리글 · 요약 · 확인할 것 · 탭 ---- */
    const dd = D.dday(P.c.move);
    let touch = false;
    try { touch = (navigator.maxTouchPoints || 0) > 0 || 'ontouchstart' in window; } catch (e) { touch = false; }
    root.appendChild(el('div', { class: 'fn-page' + (touch ? ' fn-touch' : '') },
      el('div', { class: 'view-head' },
        el('div', null,
          el('h1', '💰 자금흐름'),
          el('div', { class: 'sub' }, D.fmt(P.c.move) + ' 잔금·이사일 ', dd.n != null ? el('b', dd.label) : null, ' · 금액·시각은 눌러서 고칠 수 있어요')),
        el('div', { class: 'actions' },
          el('button', { class: 'btn btn-primary', type: 'button', onclick: () => openSheet(P) }, '🖨 11/3 당일 시트'),
          el('button', { class: 'btn', type: 'button', onclick: () => resetAll(P) }, '↺ 기본값으로 되돌리기'))),
      P.live('section', 'fn-hero', () => heroTiles(P)),
      P.live('section', 'fn-alerts', () => alertList(P)),
      (P.tabbar = el('div', { class: 'fn-tabbar' },
        el('div', { class: 'tabs', role: 'tablist', 'aria-label': '자금흐름 탭' },
          TABS.map((t) => el('button', {
            type: 'button', role: 'tab', 'data-tab': t.id, 'data-fk': 'tab-' + t.id,
            onclick: () => switchTab(t.id),
            onkeydown: (e) => {
              if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
              e.preventDefault();
              const i = TABS.findIndex((x) => x.id === P.tab);
              const n = TABS[(i + (e.key === 'ArrowRight' ? 1 : TABS.length - 1)) % TABS.length];
              switchTab(n.id);
              const b = P.tabbar.querySelector('button[data-tab="' + n.id + '"]');
              if (b) b.focus();
            },
          }, t.label))))),
      (P.panel = el('div', { class: 'fn-panel', role: 'tabpanel' }))));
    updateTabButtons();
    rebuildPanel({ force: true });
    /* 탭 줄이 넘치면 양 끝에 '더 있어요' 표시 */
    const tabsEl = P.tabbar.querySelector('.tabs');
    const moreHint = () => {
      if (!tabsEl || !root.isConnected) return;
      const max = tabsEl.scrollWidth - tabsEl.clientWidth;
      P.tabbar.classList.toggle('fn-more-r', max > 4 && tabsEl.scrollLeft < max - 4);
      P.tabbar.classList.toggle('fn-more-l', max > 4 && tabsEl.scrollLeft > 4);
    };
    P.moreHint = moreHint;
    if (tabsEl) {
      tabsEl.addEventListener('scroll', moreHint, { passive: true });
      window.addEventListener('resize', moreHint);
      ctx.onCleanup(() => window.removeEventListener('resize', moreHint));
      requestAnimationFrame(() => { revealTab(P.tab); moreHint(); });
    }
    // 키보드 Tab 으로 칸을 옮기다 그 칸이 다시 그려져 사라지면 다음 칸으로 (rescueFocus)
    const onNavKey = (e) => {
      if (e.key === 'Tab') navKey = { kind: 'tab', shift: !!e.shiftKey, t: Date.now() };
      // 키보드로 버튼·체크를 눌러 그 칸이 사라질 때(예: '확인했어요')도 다음 칸으로
      else if ((e.key === 'Enter' || e.key === ' ') && e.target && (e.target.tagName === 'BUTTON' || (e.target.tagName === 'INPUT' && e.target.type === 'checkbox'))) navKey = { kind: 'act', shift: false, t: Date.now() };
    };
    const onFocusIn = (e) => { lastFocus = e.target; };
    document.addEventListener('keydown', onNavKey, true);
    document.addEventListener('focusin', onFocusIn, true);
    ctx.onCleanup(() => {
      document.removeEventListener('keydown', onNavKey, true);
      document.removeEventListener('focusin', onFocusIn, true);
      lastFocus = null;
    });
    if (!(params && params[0]) || params[0] !== P.tab) {
      // 탭이 없거나 모르는 탭(#/money/xyz)이면 주소를 실제로 보이는 탭으로 고침
      try { history.replaceState(history.state, '', '#/money/' + P.tab); } catch (e) { /* 무시 */ }
      MV.route = { name: 'money', params: [P.tab] };
    }

    ctx.subscribe((e) => {
      if (!root.isConnected) return;
      if (e && e.reset) return; // app.js 가 화면 전체를 다시 그림
      try { ensureState(); } catch (err) { /* 무시 */ }
      if (structNext || !e || e.source !== SRC) { structNext = false; rebuildAll(); } else refresh();
    });
    ctx.onCleanup(() => {
      if (P.sheet) { try { P.sheet.close(); } catch (e) { /* 무시 */ } }
      printMode(false);
    });
  }

  /* ---------- 요약 타일 ---------- */
  function heroTiles(P) {
    const c = P.c, fl = c.flow, b = c.budget;
    const tile = (cls, k, v, s, title) => el('div', { class: 'fn-stat ' + cls },
      el('span', { class: 'fn-stat-k' }, k), el('span', { class: 'fn-stat-v', title: title || '' }, v), s ? el('span', { class: 'fn-stat-s' }, s) : null);
    return [
      tile('is-in', D.fmt(c.move) + ' 받을 돈', eok(fl.inflow), fl.direct ? 'A가 대출을 직접 갚고 남은 돈' : 'A → 내 통장', won(fl.inflow)),
      tile('is-out', D.fmt(c.move) + ' 보낼 돈', eok(fl.outflow), fl.direct ? 'C 잔금 · 중개보수' : 'C 잔금 · 중개보수 · 대출 완제', won(fl.outflow)),
      tile('', '그날 남는 돈', krw(fl.leftover), '받을 돈 − 보낼 돈', won(fl.leftover)),
      tile('', '이사비 (아직 낼 돈)', krw(b.unpaid), '예산 ' + krw(b.total) + (b.paid ? ' 중 ' + krw(b.paid) + ' 냄' : ''), won(b.unpaid)),
      tile('is-final' + (c.net < 0 ? ' is-neg' : ''), c.net < 0 ? '⚠ 최종 부족' : '최종 여유', krw(Math.abs(c.net)),
        '남는 돈 − 이사비' + (b.refundsTotal ? ' · 들어올 돈 ' + krw(b.refundsTotal) + ' 별도' : ''), won(c.net)),
    ];
  }

  /* ---------- 지금 확인할 것 ---------- */
  function alertList(P) {
    const list = P.c.alerts;
    if (!list.length) return el('div', { class: 'fn-alert is-info' }, el('span', { class: 'fn-alert-ico', 'aria-hidden': 'true' }, '✅'), el('span', { class: 'fn-alert-txt' }, '지금 급하게 확인할 것은 없어요.'));
    let LIMIT = 4;
    try { if (window.matchMedia('(max-width: 640px)').matches) LIMIT = 2; } catch (e) { /* 무시 */ }
    const shown = alertsOpen ? list : list.slice(0, LIMIT);
    const out = shown.map((a) => el('button', {
      class: 'fn-alert is-' + a.level, type: 'button', 'data-fk': 'alert-' + a.id,
      'aria-label': a.text + ' — 자세히 보기', onclick: () => P.goTo(a.tab, a.anchor),
    },
      el('span', { class: 'fn-alert-ico', 'aria-hidden': 'true' }, a.level === 'bad' ? '🚨' : a.level === 'warn' ? '⚠️' : 'ℹ️'),
      el('span', { class: 'fn-alert-txt' }, a.text),
      el('span', { class: 'fn-alert-go', 'aria-hidden': 'true' }, el('span', { class: 'fn-alert-go-t' }, '보기 '), '›')));
    if (list.length > LIMIT) {
      out.push(el('div', { class: 'fn-alerts-more' }, el('button', {
        class: 'btn btn-ghost btn-sm fn-mini-btn', type: 'button', 'data-fk': 'alert-more', 'aria-expanded': String(alertsOpen),
        onclick: () => { alertsOpen = !alertsOpen; P.shell.forEach((run) => run()); },
      }, alertsOpen ? '접기 ▲' : '확인할 것 ' + (list.length - LIMIT) + '개 더 ▼')));
    }
    return out;
  }

  function buildTab(P) {
    switch (P.tab) {
      case 'sources': return tabSources(P);
      case 'budget': return tabBudget(P);
      case 'father': return tabFather(P);
      case 'tax': return tabTax(P);
      case 'protect': return tabProtect(P);
      default: return tabFlow(P);
    }
  }

  /* ======================= 탭 1: 11/3 돈 흐름 ======================= */
  function tabFlow(P) {
    return el('div', { class: 'fn-panel' },
      el('div', { class: 'grid grid-2' }, lienCard(P), limitsCard(P)),
      stepsSection(P),
      el('div', { class: 'grid grid-2' }, prepCard(P), contingencyCard(P)),
      contactsCard(P));
  }

  function lienCard(P) {
    const f = P.c.f;
    const opts = [['unknown', '확인 전'], ['none', '없음 (은행 확인)'], ['exists', '있음 → A가 직접 상환']];
    const msg = {
      unknown: el('div', { class: 'callout warn' },
        el('p', el('b', '우리은행에 이렇게 물어보세요: '), '"제 우리전세론에 질권설정이나 채권양도 통지가 있나요? 11/3 기준 완제금액(원 단위), 상환 계좌, 마감 시각도 알려 주세요."'),
        el('p', { class: 'small' }, '지금은 "없음"으로 가정해 순서를 짰어요 (가능성이 높음).')),
      none: el('div', { class: 'callout good' },
        el('p', el('b', '추천 순서: '), 'A 입금 잔액 확인 → 열쇠 인계 → 등기부 재열람 → C 잔금 → 중개보수 → 우리은행 완제 → 전입신고·확정일자. 은행 상환은 같은 날, 늦어도 11/4까지.')),
      exists: el('div', { class: 'callout warn' },
        el('p', el('b', '순서가 고정돼요: '), 'A가 은행에 완제금액(' + krw(nn(f.loan.payoff)) + ')을 먼저 직접 보내고 → 나머지(약 ' + eok(Math.max(0, nn(f.old.receive) - nn(f.loan.payoff))) + ')를 우리에게 → 우리가 C에게. 완제금액(원 단위)과 상환 계좌를 A에게 미리 문자로 알려 주세요.')),
    }[f.loan.lien] || null;
    return el('section', { class: 'card fn-anchor', id: 'fn-lien' },
      el('div', { class: 'fn-card-h' }, el('h3', '대출 상환 방식'), chip('질권·채권양도', f.loan.lien === 'unknown' ? 'warn' : f.loan.lien === 'exists' ? 'think' : 'good'), guideLink('loan-lien')),
      el('div', { class: 'fn-seg', role: 'group', 'aria-label': '질권·채권양도 여부' },
        opts.map(([v, l]) => el('button', {
          type: 'button', class: 'fn-seg-btn' + (f.loan.lien === v ? ' is-on' : '') + (v === 'exists' ? ' is-alt' : ''),
          'aria-pressed': String(f.loan.lien === v), 'data-fk': 'lien-' + v,
          onclick: () => { if (P.c.f.loan.lien !== v) updStruct((fin) => { fin.loan.lien = v; }, { log: '자금흐름: 대출 질권 여부 → ' + l }); },
        }, l))),
      msg,
      basis('mid', '우리전세론은 주택금융공사(HF) 보증서 담보 상품이라 집주인에게 질권·채권양도 통지가 없을 가능성이 높아요. A가 4,200만원을 우리에게 직접 줬고 우리가 그중 2,200만원을 직접 갚은 것도 그 정황이에요.', [LINK.wooriLoan, LINK.hf], '우리은행에 꼭 확인'));
  }

  function limitsCard(P) {
    const lim = P.c.f.flow.limits;
    const setLim = (k) => (v) => upd((fin) => { fin.flow.limits[k] = v > 0 ? v : null; });
    return el('section', { class: 'card fn-anchor', id: 'fn-limits' },
      el('div', { class: 'fn-card-h' }, el('h3', '내 이체한도'), el('span', { class: 'small muted' }, '모르면 비워 두세요'), guideLink('transfer')),
      el('div', { class: 'fn-two' },
        moneyField('1회 한도', lim.perTx, setLim('perTx'), { placeholder: '예: 1억', fk: 'lim-tx', emptyZero: true }),
        moneyField('1일 한도', lim.daily, setLim('daily'), { placeholder: '예: 5억', fk: 'lim-day', emptyZero: true })),
      P.live('div', 'fn-step-body', () => {
        const fl = P.c.flow;
        const out = [el('div', { class: 'fn-kv' },
          el('span', { class: 'k' }, '11/3 내 통장에서 나갈 돈'), el('span', { class: 'v' }, won(fl.outflow)),
          el('span', { class: 'k' }, '가장 큰 1건'), el('span', { class: 'v' }, won(fl.maxOut)))];
        if (fl.perTx && fl.perTx < 1000000) {
          out.push(el('div', { class: 'fn-warn is-bad' }, '1회 한도를 ' + won(fl.perTx) + '으로 넣었어요 — 맞나요? 보통 1천만원(보안2등급)이나 1억원(OTP)이에요. 이렇게 낮으면 앱으로는 못 보내니 창구(평일 09~16시)를 이용하세요.'));
        }
        if (!fl.perTx || !fl.daily) {
          out.push(el('div', { class: 'fn-warn' }, '한도를 아직 모르면: OTP를 발급받고 한도를 1회 1억·1일 5억(보안1등급)으로 올리세요. 보안카드·모바일 간편인증은 보통 훨씬 낮아요(1회 1천만·1일 5천만원 수준).'));
        } else if (fl.daily < fl.outflow) {
          out.push(el('div', { class: 'fn-warn is-bad' }, '1일 한도(' + krw(fl.daily) + ')가 나갈 돈보다 적어요 — 한도를 올리거나 일부는 창구(평일 09~16시)에서 보내세요.'));
        } else {
          const n = fl.steps.filter((s) => s.kind === 'out' && s.splitN > 1);
          out.push(el('div', { class: 'fn-warn is-good' }, '1일 한도 안이에요.' + (n.length ? ' 1회 한도 때문에 ' + n.map((s) => stepWho(s.id).replace('나 → ', '') + ' ' + timesTxt(s.splitN)).join(', ') + ' 나눠 보내요.' : '')));
          const many = n.filter((s) => s.splitN > SPLIT_LIST);
          if (many.length) out.push(el('div', { class: 'fn-warn is-bad' }, '이체 횟수가 너무 많아요(' + many.map((s) => timesTxt(s.splitN)).join(', ') + ') — OTP로 1회 한도를 1억까지 올리거나 창구에서 보내세요.'));
        }
        return out;
      }),
      basis('mid', '전자금융감독규정 시행세칙상 개인 이체한도는 OTP(보안1등급) 1회 1억·1일 5억, 보안2등급 1회 1천만·1일 5천만원 수준이에요. 실제 한도는 은행마다 달라요.', [], '은행 앱·창구에서 확인'));
  }

  function stepsSection(P) {
    const steps = P.c.flow.steps;
    const ol = el('ol', { class: 'fn-steps', 'aria-label': '11/3 돈 흐름 단계' });
    steps.forEach((s, i) => ol.appendChild(stepItem(P, s, i)));
    ol.appendChild(resultItem(P));
    return el('section', { class: 'fn-sec' },
      el('div', { class: 'fn-sec-head' },
        el('h2', D.fmt(P.c.move) + ' 시간순 돈 흐름'),
        P.live('span', 'fn-sec-meta', () => {
          const fl = P.c.flow;
          return [MV.ui.progress(fl.doneCount / fl.steps.length), '당일 체크 ' + fl.doneCount + '/' + fl.steps.length];
        })),
      el('p', { class: 'small muted mb-0' }, '금액(예: 3.78억, 120만)과 시각은 눌러서 고칠 수 있어요. 단계마다 그 뒤 내 통장 잔액이 바로 계산돼요.'),
      ol);
  }

  function stepItem(P, s0, i) {
    const id = s0.id;
    const f = P.c.f;
    const kind = s0.kind;
    const cur = () => P.c.flow.steps.find((x) => x.id === id) || s0;
    const li = el('li', { class: 'fn-step k-' + kind + ' fn-anchor', id: 'fn-step-' + id });
    P.bind(() => li.classList.toggle('is-done', !!cur().done));
    const time = el('input', { type: 'time', class: 'input fn-time', value: s0.time || '', 'aria-label': (i + 1) + '단계 시각', 'data-fk': 'time-' + id });
    time.addEventListener('change', () => upd((fin) => { fin.flow.times[id] = time.value || ''; }));
    const title = stepTitle(id, P.c);
    const doneBox = checkbox('완료', s0.done, (v) => setStepDone(P, id, v), { fk: 'done-' + id, cls: 'fn-done' });
    const doneCb = doneBox.querySelector('input');
    P.bind(() => { const d = !!cur().done; if (doneCb.checked !== d) doneCb.checked = d; });
    const body = el('div', { class: 'fn-step-body' });
    amountBlock(P, id, body);
    body.appendChild(el('ul', { class: 'fn-notes' }, stepNotes(id, P.c).map((t) => el('li', t))));
    const lk = s0.link;
    if (lk) {
      body.appendChild(el('div', { class: 'fn-prot-link fn-step-link' },
        el('span', { class: 'muted' }, '완료를 체크하면 같이 바뀌어요:'),
        lk.kind === 'prot' ? el('a', { class: 'fn-cl-link', href: '#/money/protect', onclick: P.tabLink('protect', 'fn-p-' + lk.key) }, '🛡 보증금 지키기') : null,
        lk.item ? el('a', { class: 'fn-cl-link', href: itemHref(lk.item), title: '체크리스트: ' + lk.item.title, 'aria-label': '체크리스트 항목 보기: ' + lk.item.title }, '📋 체크리스트') : null));
    }
    if (kind !== 'task') body.appendChild(P.live('div', 'fn-step-body', () => stepLive(P, id)));
    if (MEMO_LABEL[id]) {
      body.appendChild(el('div', { class: 'fn-memo-input' }, textField(MEMO_LABEL[id], (f.flow.memo || {})[id], (v) => updSilent((fin) => { fin.flow.memo[id] = v; }),
        { fk: 'memo-' + id, placeholder: '은행 · 계좌번호 · 예금주' })));
    }
    li.append(
      el('div', { class: 'fn-rail', 'aria-hidden': 'true' }, el('span', { class: 'fn-num' }, String(i + 1)), el('span', { class: 'fn-line' })),
      el('div', { class: 'card fn-step-card' },
        el('div', { class: 'fn-step-head' },
          time,
          el('div', { class: 'fn-step-name' }, chip(stepWho(id), KIND_CHIP[kind]), el('h3', { class: 'fn-step-title' }, title)),
          doneBox),
        body));
    return li;
  }

  function amountBlock(P, id, body) {
    const f = P.c.f;
    if (id === 'recv') {
      if (P.c.flow.direct) {
        body.appendChild(el('div', { class: 'fn-amt-grid' },
          moneyField('A가 줄 돈 전체', f.old.receive, (v) => upd((fin) => { fin.old.receive = v; }), { fk: 'amt-receive' }),
          P.live('div', 'fn-total', () => {
            const fl = P.c.flow;
            return [el('span', '내 통장에 들어올 돈'), el('b', { class: 'fn-amt ' + (fl.inflow < 0 ? 'is-neg' : 'is-in') }, signedEok(fl.inflow)),
              el('span', { class: 'fn-formula' }, eok(fl.receive) + ' − 은행 직접 상환 ' + eok(fl.payoff))];
          })));
      } else {
        body.appendChild(moneyField('A에게 받을 돈', f.old.receive, (v) => upd((fin) => { fin.old.receive = v; }), { fk: 'amt-receive', cls: 'fn-big' }));
      }
      return;
    }
    if (id === 'bankA' || id === 'bank') {
      body.appendChild(el('div', { class: 'fn-amt-grid' },
        moneyField(id === 'bankA' ? 'A가 은행에 보낼 완제금액' : '11/3 기준 완제금액', f.loan.payoff, (v) => upd((fin) => { fin.loan.payoff = v; }), { fk: 'amt-payoff', cls: 'fn-big' }),
        P.live('div', 'fn-total', () => {
          const fl = P.c.flow;
          return [el('span', '구성'), el('span', { class: 'fn-formula' }, '남은 원금 ' + won(fl.principalLeft) + (fl.interest > 0 ? ' + 일할이자 ' + won(fl.interest) : fl.interest < 0 ? ' − 환급 ' + won(-fl.interest) : ''))];
        })));
      body.appendChild(basis('mid', '은행 가계대출 이자는 보통 후취예요. 그러면 11/3 상환 때 환급이 아니라 약 16일치 일할이자(금리 3.3~4.5%면 약 11만~15만원)가 붙어요. 중도상환해약금은 면제 가능성이 높고, 붙어도 1만원 미만이에요. 11/2에 완제금액을 원 단위로 받아 두세요.', [LINK.wooriLoan, LINK.loanInfo], '우리은행 확인'));
      return;
    }
    if (id === 'toC') {
      body.appendChild(el('div', { class: 'fn-amt-grid' },
        moneyField('보증금 잔금', f.newHome.balance, (v) => upd((fin) => { fin.newHome.balance = v; }), { fk: 'amt-balance' }),
        moneyField('기타 (있으면)', f.newHome.extraToC, (v) => upd((fin) => { fin.newHome.extraToC = v; }), { fk: 'amt-extra', placeholder: '예: 관리비 정산', hint: '관리비 정산 등 C에게 함께 보낼 돈' })));
      const rentBox = el('div', { class: 'callout fn-rentbox fn-anchor', id: 'fn-rent' },
        P.live('p', null, () => [el('b', '📌 월세 지급일 확인 — '), '계약서상 후불이면 첫 월세는 ' + D.fmt(addMonths(P.c.move, 1)) + '. ' + D.fmt(P.c.move) + '에 ' + krw(nn(P.c.f.newHome.rent)) + '을 함께 줄지 중개사·임대인과 확인하고, 주면 영수증/문자로 남기기']),
        el('div', { class: 'row' },
          checkbox(D.fmt(P.c.move) + '에 첫 월세 함께 지급', f.newHome.rentOnMoveDay, (v) => upd((fin) => { fin.newHome.rentOnMoveDay = v; }, { log: '자금흐름: 11/3 첫 월세 ' + (v ? '함께 지급' : '지급 안 함 (12/3부터)') }), { fk: 'rent-on' }),
          el('label', { class: 'fn-inline-money' }, el('span', { class: 'small strong' }, '월세'),
            moneyField('월세', f.newHome.rent, (v) => upd((fin) => { fin.newHome.rent = v; }), { fk: 'amt-rent', bare: true, noHint: true }))),
        checkbox('중개사·C와 확인 완료 (몇 월분인지, 다음 지급일, 마지막 달 처리 — 문자로 남김)', f.newHome.rentConfirmed, (v) => upd((fin) => { fin.newHome.rentConfirmed = v; }), { fk: 'rent-ok' }));
      P.bind(() => {
        const ok = !!P.c.f.newHome.rentConfirmed;
        rentBox.classList.toggle('good', ok);
        rentBox.classList.toggle('warn', !ok);
      });
      body.appendChild(rentBox);
      body.appendChild(P.live('div', 'fn-step-body', () => {
        const fl = P.c.flow, fn = P.c.f.newHome;
        const parts = [won(num(fn.balance))];
        if (fl.rentPart) parts.push('월세 ' + won(fl.rentPart));
        if (num(fn.extraToC)) parts.push('기타 ' + won(num(fn.extraToC)));
        const out = [el('div', { class: 'fn-total' }, el('span', 'C에게 보낼 돈 합계'), el('b', { class: 'fn-amt is-out' }, won(fl.cTotal)), el('span', { class: 'fn-formula' }, parts.join(' + ')))];
        if (fl.memoOpen) {
          out.push(el('div', { class: 'callout warn fn-anchor', id: 'fn-memo' },
            el('p', '처음 메모한 합계 ' + won(num(fn.memoTotal)) + '은 잔금 ' + eok(num(fn.balance)) + ' + 월세 ' + krw(num(fn.rent)) + (num(fn.extraToC) ? ' + 기타 ' + krw(num(fn.extraToC)) : '') + ' (= ' + won(num(fn.balance) + num(fn.rent) + num(fn.extraToC)) + ')보다 ',
              el('b', won(Math.abs(fl.memoDiff)) + ' ' + (fl.memoDiff > 0 ? '많아요' : '적어요')), '. 계약서 금액을 다시 보고, 차이가 실제로 낼 돈(예: 관리비 정산)이면 "기타" 칸에 넣으세요.'),
            el('div', { class: 'row fn-memo-row' },
              moneyField('처음 메모한 합계 (틀렸으면 고치기)', fn.memoTotal, (v) => upd((fin) => { fin.newHome.memoTotal = v; fin.newHome.memoAck = false; fin.newHome.memoAckDiff = null; }), { fk: 'memo-total', noHint: true, cls: 'fn-memo-total' }),
              el('button', { class: 'btn btn-sm fn-mini-btn', type: 'button', 'data-fk': 'memo-ack', onclick: () => upd((fin) => { fin.newHome.memoAck = true; fin.newHome.memoAckDiff = P.c.flow.memoDiff; }) }, '확인했어요'))));
        }
        return out;
      }));
      return;
    }
    if (id === 'broker') {
      body.appendChild(el('div', { class: 'fn-amt-grid' },
        moneyField('중개보수 (합의 금액)', f.broker.planned, (v) => upd((fin) => { fin.broker.planned = v; }), { fk: 'amt-broker', cls: 'fn-big' }),
        P.live('div', 'fn-total', () => {
          const b = P.c.broker;
          return [el('span', '법정 상한'), el('b', won(b.cap)), el('span', { class: 'fn-formula' }, '부가세 포함 최대 ' + won(b.maxWithVat)),
            el('a', { class: 'fn-cl-link', href: '#/money/tax', onclick: P.tabLink('tax', 'fn-broker') }, '계산 보기 →')];
        })));
    }
  }

  function stepLive(P, id) {
    const s = P.c.flow.steps.find((x) => x.id === id);
    if (!s) return null;
    const out = [];
    if (s.kind === 'out' && s.split && s.splitN > 1) {
      out.push(s.chunks
        ? el('div', { class: 'fn-chunks' }, el('span', { class: 'small strong' }, timesTxt(s.splitN) + ' 나눠 보내기:'),
          s.chunks.map((a, k) => chip((k + 1) + '회 ' + eok(a), 'brand')))
        : el('div', { class: 'fn-chunks' }, el('span', { class: 'small strong' }, timesTxt(s.splitN) + ' 나눠 보내기:'),
          chip(eok(s.split.size) + ' × ' + timesTxt(s.split.last !== s.split.size ? s.splitN - 1 : s.splitN), 'brand'),
          s.split.last !== s.split.size ? chip('마지막 1번 ' + eok(s.split.last), 'brand') : null));
    }
    s.warnings.forEach((w) => out.push(el('div', { class: 'fn-warn is-' + w.level, role: w.level === 'bad' ? 'alert' : null }, w.text)));
    if (s.kind === 'ext') {
      out.push(el('div', { class: 'fn-bal' }, el('span', '내 통장은 그대로 (A → 은행 직접)'), el('b', eok(s.balance))));
    } else {
      const delta = s.kind === 'in' ? s.amount : -s.amount;
      out.push(el('div', { class: 'fn-bal' + (s.balance < 0 ? ' is-neg' : '') },
        el('span', signedWon(delta) + ' → 이 단계 뒤 내 통장'),
        el('b', { title: won(s.balance) }, eok(s.balance))));
    }
    return out;
  }

  function resultItem(P) {
    return el('li', { class: 'fn-step k-result' },
      el('div', { class: 'fn-rail', 'aria-hidden': 'true' }, el('span', { class: 'fn-num' }, '=')),
      P.live('div', 'card fn-step-card fn-result', () => {
        const c = P.c, fl = c.flow;
        return [
          el('div', { class: 'fn-result-k' }, '모두 끝나면 남는 돈'),
          el('div', { class: 'fn-result-v' + (fl.leftover < 0 ? ' is-neg' : ''), title: won(fl.leftover) }, eok(fl.leftover)),
          el('div', { class: 'fn-formula' }, '받을 돈 ' + won(fl.inflow) + ' − 보낼 돈 ' + won(fl.outflow) + ' = ' + won(fl.leftover)),
          el('p', { class: 'small mb-0 mt-8' }, '아직 낼 이사비 ' + krw(c.budget.unpaid) + '까지 빼면 ',
            el('b', { style: { color: c.net < 0 ? 'var(--bad)' : 'var(--good)' } }, (c.net < 0 ? '부족 ' : '여유 ') + krw(Math.abs(c.net))),
            ' · ', el('a', { href: '#/money/budget', onclick: P.tabLink('budget', 'fn-budget-sum') }, '예산 보기 →')),
        ];
      }));
  }

  function prepCard(P) {
    const move = P.c.move;
    const PREP = [
      { key: 'otp', re: [/OTP|이체\s*한도/], off: -20, text: 'OTP 발급 + 이체한도 1회 1억·1일 5억으로 증액 (영업점 방문이 필요할 수 있어요)' },
      { key: 'aSend', re: [/A의\s*송금/], off: -18, text: 'A에게 송금 시각·1일 이체한도(' + eok(nn(P.c.f.old.receive)) + ' 이상) 확인 요청, 우리 수취계좌는 문자로 전달' },
      { key: 'delay', off: -10, text: '지연이체·안심이체(입금계좌지정)가 켜져 있으면 해제하거나 C·중개사·대출 상환계좌를 미리 등록' },
      { key: 'limitAcct', off: -10, text: '받는 통장이 한도제한계좌(1일 100만원 안팎)가 아닌지 확인' },
      { key: 'payoff', re: [/완제\s*금액/], off: -1, text: '우리은행에서 11/3 기준 완제금액(원 단위)·상환계좌·마감시각 받기' },
      { key: 'payee', re: [/예금주/], off: -1, text: 'C·중개사·상환계좌 예금주 조회 — 처음 보내는 계좌는 이상거래탐지(FDS)로 보류될 수 있어요' },
      { key: 'registry1', re: [/전입\s*세대\s*확인/], off: -1, text: '새 집 등기부 1차 열람 + 전입세대확인서 발급' },
      { key: 'kit', off: -1, text: '신분증·OTP·휴대폰 충전, 은행 콜센터 번호 저장 (앱이 막히면 창구 이체: 평일 09~16시)' },
    ];
    PREP.forEach((p) => { p.due = D.add(move, p.off); });
    const L = linkedChecklist(P, PREP, P.c.f.flow.prep || {}, (k, v) => updStruct((fin) => { fin.flow.prep[k] = v; }), 'prep-', true);
    return el('section', { class: 'card fn-anchor', id: 'fn-prep' },
      el('div', { class: 'fn-card-h' }, el('h3', '11/3 전에 준비할 것'), el('span', { class: 'spacer' }), chip(L.doneN + '/' + L.total, L.doneN === L.total ? 'good' : '')),
      L.list,
      basis('mid', '전자금융 이체한도·이상거래탐지·한도제한계좌는 은행마다 운영이 달라요.', [], '거래 은행에 확인'));
  }

  /* 체크리스트에 같은 할 일이 있으면 그 항목과 연결 (체크하면 체크리스트도 바뀜), 없으면 이 화면에만 저장 */
  const itemHref = (it) => '#/checklist/' + encodeURIComponent(it.partId || '_') + '/' + encodeURIComponent(it.id);
  function linkedChecklist(P, rows, local, setLocal, fkPrefix, withDue) {
    const items = (MV.store.get().items) || [];
    const links = P.c.f.links || {};
    const resolved = rows.map((r) => {
      const link = r.re ? findLinked(r, items, links, fkPrefix) : { item: null };
      return Object.assign({}, r, { linked: link.item, done: link.item ? !!link.item.done : !!local[r.key] });
    });
    const list = el('ul', { class: 'fn-list' }, resolved.map((r) => {
      const li = el('li', { class: r.done ? 'is-done' : '' },
        checkbox(r.text, r.done, (v) => {
          li.classList.toggle('is-done', v);
          const it = r.linked && MV.items.get(r.linked.id);
          if (it) {
            rememberLink(fkPrefix + r.key, it.id);
            if (!!it.done !== v) MV.items.toggle(it.id);
          } else setLocal(r.key, v);
        }, { fk: fkPrefix + r.key }),
        withDue && r.due ? MV.ui.dueChip(r.due, r.done) : null,
        r.linked ? el('a', { class: 'fn-cl-link', href: itemHref(r.linked), title: '체크리스트: ' + r.linked.title, 'aria-label': '체크리스트 항목 보기: ' + r.linked.title }, '📋 체크리스트') : null);
      return li;
    }));
    return { list, doneN: resolved.filter((r) => r.done).length, total: rows.length };
  }
  /* 연결된 체크리스트 항목 id 를 고정 저장 (조용히 — 바로 뒤 체크리스트 변경이 다시 그림) */
  function rememberLink(key, itemId) {
    const cur = (MV.store.get().finance || {}).links || {};
    if (cur[key] === itemId) return;
    updSilent((fin) => { if (!fin.links || typeof fin.links !== 'object') fin.links = {}; fin.links[key] = itemId; });
  }

  /* 자금흐름 상태와 체크리스트 항목을 한 번에 바꿈 (저장·다시 그리기 한 번) */
  function updAll(fn, opts) {
    MV.store.update((st) => {
      if (!st.finance) st.finance = withDefaults(null);
      const fin = st.finance;
      if (!fin.links || typeof fin.links !== 'object' || Array.isArray(fin.links)) fin.links = {};
      if (!fin.flow || typeof fin.flow !== 'object') fin.flow = withDefaults(null).flow;
      if (!fin.flow.done || typeof fin.flow.done !== 'object') fin.flow.done = {};
      if (!fin.protect || typeof fin.protect !== 'object') fin.protect = withDefaults(null).protect;
      if (!fin.protect.checks || typeof fin.protect.checks !== 'object') fin.protect.checks = {};
      fn(fin, st);
    }, Object.assign({ source: SRC }, opts || {}));
  }
  const doneLog = (v, title) => (v ? '✅ 완료: ' : '↩︎ 다시 열기: ') + title;
  const liveItem = (it) => (it && MV.items.get(it.id) ? MV.items.get(it.id) : null);

  /* 보증금 지키기 한 줄 체크 → 연결된 체크리스트 항목(없으면 이 화면)과 같은 일을 하는 11/3 단계까지 */
  function setProtDone(P, r, v, o) {
    o = o || {};
    if (!r) return;
    if (r.key === 'report') {
      const cur = P.c.f.protect.rentReport;
      setReportState(P, v ? (cur === 'done' || cur === 'late' ? cur : 'checked') : 'unknown', o);
      return;
    }
    const linked = liveItem(r.linked);
    if (o.struct) structNext = true;
    updAll((fin, st) => {
      if (PROT_STEP[r.key]) fin.flow.done[PROT_STEP[r.key]] = v;
      if (linked) {
        fin.links['prot-' + r.key] = linked.id;
        // '둘 중 하나만 해도 됨' 줄을 끄면 같은 일을 하는 다른 항목(대안)도 함께 미완료로
        if (!v && r.anyDone) (r.alts || []).forEach((it) => { if (it.id !== linked.id) setItemDone(st, it.id, false); });
        setItemDone(st, linked.id, v);
      } else {
        fin.protect.checks[r.key] = v;
      }
    }, { log: linked ? doneLog(v, linked.title) : (v ? '✅ ' : '↩︎ ') + '자금흐름: ' + r.title });
  }

  /* 임대차 신고 상태 ↔ 줄 체크 ↔ 체크리스트 '[긴급] … 신고됐는지 확인'·'[신고 안 됐으면] 바로 신고' 항목 */
  const REPORT_LABEL = { unknown: '모름 — 확인 필요', checked: '확인함 (결과 고르기 전)', done: '신고돼 있음', late: '지금 신고함' };
  /* state: 'unknown' 모름 → 두 항목 모두 미완료
            'checked' 확인만 함(줄·항목 체크) → 확인 항목만 완료, '[신고 안 됐으면] 바로 신고' 항목은 그대로
            'done' 신고돼 있음 · 'late' 지금 신고함 → 두 항목 모두 완료 (결과를 직접 고른 경우에만 후속 항목을 닫음) */
  function setReportState(P, state, o) {
    o = o || {};
    if (!REPORT_LABEL[state]) state = 'unknown';
    const row = P.c.protect.byKey.report;
    const main = row ? liveItem(row.linked) : null;
    const follow = row ? liveItem(row.follow) : null;
    const done = state !== 'unknown';
    const closeFollow = state === 'done' || state === 'late';
    // 후속 항목은 결과를 고를 때 닫고, '모름'으로 되돌릴 때는 우리가 닫았던 경우에만 다시 엶
    const prevKnown = ['done', 'late'].indexOf(P.c.f.protect.rentReport) >= 0;
    const touchFollow = !!follow && (closeFollow || (state === 'unknown' && prevKnown));
    const changed = [];
    if (main && !!main.done !== done) changed.push(main.title);
    if (touchFollow && !!follow.done !== closeFollow) changed.push(follow.title);
    structNext = true;
    updAll((fin, st) => {
      fin.protect.rentReport = closeFollow ? state : 'unknown';
      if (main) { fin.links['prot-report'] = main.id; setItemDone(st, main.id, done); }
      fin.protect.checks.report = done;
      if (touchFollow) { fin.links['prot-reportNow'] = follow.id; setItemDone(st, follow.id, closeFollow); }
    }, { log: '자금흐름: 임대차 신고 상태 → ' + REPORT_LABEL[state] + (changed.length ? ' (체크리스트 ' + changed.length + '개 ' + (done ? '완료' : '다시 열기') + ')' : '') });
    if (state === 'checked') {
      MV.ui.toast('확인했어요. 아래 "신고 상태"에서 결과(신고돼 있음 / 지금 신고함)도 골라 주세요');
    } else if (changed.length && !o.quiet) {
      MV.ui.toast('체크리스트도 ' + (done ? '완료로' : '미완료로') + ' 바꿨어요: ' + changed.map((t) => '“' + t + '”').join(', '));
    }
  }

  /* 11/3 단계 완료 → 연결된 보증금 지키기 줄·체크리스트 항목까지 */
  function setStepDone(P, id, v) {
    const s = P.c.flow.steps.find((x) => x.id === id);
    const title = stepTitle(id, P.c);
    if (s && s.link && s.link.kind === 'prot') {
      setProtDone(P, P.c.protect.byKey[s.link.key], v);
      return;
    }
    const it = s && s.link && s.link.kind === 'item' ? liveItem(s.link.item) : null;
    updAll((fin, st) => {
      fin.flow.done[id] = v;
      if (it) { fin.links['step-' + s.link.key] = it.id; setItemDone(st, it.id, v); }
    }, { log: it ? doneLog(v, it.title) : (v ? '✅ ' : '↩︎ ') + D.fmt(P.c.move) + ' ' + title });
  }
  function guideLink(anchor, label) {
    return el('a', { class: 'fn-guide', href: '#/guide/money' + (anchor ? '/' + anchor : '') }, '📖 ' + (label || '가이드') + ' →');
  }

  function contingencyCard(P) {
    return el('section', { class: 'card tint-warn fn-anchor', id: 'fn-plan-b' },
      el('div', { class: 'fn-card-h' }, el('h3', '🧯 A의 돈이 늦어지면'), guideLink('delay')),
      el('p', { class: 'small' }, 'A가 B에게서 받는 매매 잔금(B의 대출 포함)이 들어와야 우리 돈이 들어오는 연쇄 구조일 가능성이 커요.'),
      el('ul', { class: 'fn-ul small' },
        el('li', el('b', '열쇠·비밀번호는 넘기지 않기'), ' — 잔액으로 확인될 때까지. 전입도 옮기지 않기(구집 전입 유지).'),
        el('li', el('b', '미리 합의: '), 'C와 "잔금이 늦어지면 몇 시까지 기다리고 짐은 어떻게 할지"를 중개사를 통해 문자로.'),
        el('li', el('b', '이사업체: '), '대기비·보관이사 단가를 계약 때 미리 확인.'),
        el('li', el('b', '브릿지 자금 후보: '), '잠깐 메울 돈(예: 마이너스통장)을 미리 생각해 두기.'),
        el('li', el('b', '임대인이 바뀔 수 있어요: '), 'B가 소유권이전등기를 먼저 마치면 반환 의무자가 B로 바뀔 수 있어요(주임법 제3조 제4항). 조기종료 합의서에 A·B·우리 3자가 서명하고 누가·언제·어느 계좌로·얼마를 보내는지 적기.'),
        el('li', el('b', '끝내 못 받으면: '), '전입 유지 + 서울남부지방법원에 임차권등기명령 → 등기부 기재 확인 후 전출.'),
        el('li', el('b', '이체가 막히면: '), '이상거래 보류는 은행 콜센터, 앱 오류는 창구(평일 09~16시). 계좌를 바꾸자는 연락은 무조건 멈추고 직접 통화.')),
      basis('mid', '리서치 검증본(주택임대차보호법 제3조, 임차권등기명령 2023-07-19 개정).', [LINK.lawLease], '중개사·법률 상담으로 확인'));
  }

  function contactsCard(P) {
    const ct = P.c.f.contacts || {};
    const fields = [
      ['A', '구집 임대인 A'], ['C', '새 집 임대인 C'], ['broker', '새 집 중개사'], ['oldBroker', '구집 중개사'], ['bank', '우리은행 (지점·콜센터)'], ['mover', '이사업체'],
    ];
    return el('section', { class: 'card' },
      el('div', { class: 'fn-card-h' }, el('h3', '📞 당일 연락처'), el('span', { class: 'small muted' }, '당일 시트에 함께 인쇄돼요 · 이 기기에만 저장')),
      el('div', { class: 'fn-contacts' }, fields.map(([k, l]) => textField(l, ct[k], (v) => updSilent((fin) => { fin.contacts[k] = v; }), { fk: 'ct-' + k, placeholder: '이름 · 전화번호' }))));
  }

  /* ======================= 탭 2: 돈의 출처와 쓰임 ======================= */
  function tabSources(P) {
    const f = P.c.f;
    const set = (path) => (v) => upd((fin) => { const [a, b] = path.split('.'); fin[a][b] = v; });
    const group = (title, fields) => el('fieldset', { class: 'fn-fieldset' }, el('legend', { class: 'strong small' }, title), el('div', { class: 'fn-fields' }, fields));
    const facts = el('section', { class: 'card' },
      el('div', { class: 'fn-card-h' }, el('h3', '기본 숫자'), el('span', { class: 'small muted' }, '계약서·통장 기준으로 고치면 모든 계산이 따라 바뀌어요')),
      el('div', { class: 'fn-groups' },
        group('🏠 구집 (임대인 A)', [
          moneyField('보증금', f.old.deposit, set('old.deposit'), { fk: 's-old-dep' }),
          moneyField('먼저 받은 돈 (A 선지급)', f.old.early, set('old.early'), { fk: 's-old-early' }),
          moneyField('11/3에 받을 돈', f.old.receive, set('old.receive'), { fk: 's-old-recv' })]),
        group('🏦 우리전세론', [
          moneyField('대출 원금', f.loan.original, set('loan.original'), { fk: 's-loan-orig' }),
          moneyField('미리 갚은 돈', f.loan.prepaid, set('loan.prepaid'), { fk: 's-loan-pre' }),
          moneyField('11/3 완제 예상액', f.loan.payoff, set('loan.payoff'), { fk: 's-loan-pay', hint: '원금 + 일할이자 (은행에 확인)' })]),
        group('🏢 새 집 (임대인 C)', [
          moneyField('보증금', f.newHome.deposit, set('newHome.deposit'), { fk: 's-new-dep' }),
          moneyField('계약금 (7/13 지급)', f.newHome.contract, set('newHome.contract'), { fk: 's-new-con' }),
          moneyField('계약금 중 A 선지급분', f.newHome.contractFromEarly, set('newHome.contractFromEarly'), { fk: 's-new-early' }),
          moneyField('계약금 중 아내 주식 자금', f.newHome.contractFromWife, set('newHome.contractFromWife'), { fk: 's-new-wife' }),
          moneyField('잔금 (11/3)', f.newHome.balance, set('newHome.balance'), { fk: 's-new-bal' }),
          moneyField('월세', f.newHome.rent, set('newHome.rent'), { fk: 's-new-rent' }),
          dateField('계약일', f.newHome.contractDate, (v) => upd((fin) => { fin.newHome.contractDate = D.valid(v) ? v : '2026-07-13'; }), { fk: 's-new-date', hint: '임대차 신고기한(30일) 계산에 써요' }),
          moneyField('처음 메모한 C 송금 합계', f.newHome.memoTotal, (v) => upd((fin) => { fin.newHome.memoTotal = v; fin.newHome.memoAck = false; fin.newHome.memoAckDiff = null; }), { fk: 's-new-memo', hint: '계산값과 다르면 11/3 돈 흐름에서 알려 줘요 (비우면 비교 안 함)' })]),
        group('👨‍👦 아버지 차용금 (2024)', [
          moneyField('빌린 원금', f.father.principal, set('father.principal'), { fk: 's-father' })])));
    return el('div', { class: 'fn-panel' },
      P.live('section', 'card fn-anchor', () => reconChecks(P)),
      P.live('div', 'fn-recon', () => reconTables(P)),
      P.live('section', 'card', () => originBars(P)),
      chainCard(P),
      facts);
  }

  function reconChecks(P) {
    const r = P.c.recon;
    const bad = r.checks.filter((x) => !x.ok).length;
    return [
      el('div', { class: 'fn-card-h', id: 'fn-recon' }, el('h3', '검산 — 숫자가 서로 맞나요?'), el('span', { class: 'spacer' }),
        chip(bad ? '⚠ ' + bad + '곳 확인 필요' : '✓ 모두 맞아요', bad ? 'warn' : 'good')),
      r.checks.map((x) => el('div', { class: 'fn-check-row ' + (x.info ? 'is-info' : x.ok ? 'is-ok' : 'is-bad') },
        el('span', { class: 'fn-check-ico', 'aria-hidden': 'true' }, x.info ? 'ℹ' : x.ok ? '✓' : '!'),
        el('span', x.label),
        el('span', { class: 'fn-check-val' }, x.info ? '' : x.ok ? eok(x.left) : (x.diff > 0 ? '+' : '−') + won(Math.abs(x.diff))),
        x.info
          ? el('span', { class: 'fn-note' }, '11/3 완제액 ' + won(P.c.flow.payoff) + ' = 남은 원금 ' + won(P.c.flow.principalLeft) + (P.c.flow.interest ? (P.c.flow.interest > 0 ? ' + 이자 ' : ' − 환급 ') + won(Math.abs(P.c.flow.interest)) : ''))
          : (!x.ok ? el('span', { class: 'fn-note' }, '왼쪽 ' + won(x.left) + ' / 오른쪽 ' + won(x.right) + ' — ' + x.hint) : null))),
    ];
  }

  function reconTables(P) {
    const r = P.c.recon;
    const row = (x) => el('tr', null, el('td', null, x.label, x.sub ? el('span', { class: 'fn-sub' }, x.sub) : null), el('td', { class: 'num' }, won(x.amount)));
    const ok = r.gap === 0;
    return [
      el('section', { class: 'card' },
        el('h3', '들어오는 돈 (2026)'),
        el('div', { class: 'table-wrap' }, el('table', { class: 'tbl' },
          el('tbody', null, r.inflow.map(row)),
          el('tfoot', null, el('tr', null, el('td', '합계'), el('td', { class: 'num' }, won(r.inTotal))))))),
      el('section', { class: 'card' },
        el('h3', '쓰이는 곳'),
        el('div', { class: 'table-wrap' }, el('table', { class: 'tbl' },
          el('tbody', null, r.uses.map(row),
            el('tr', { class: 'fn-tr-left' }, el('td', null, el('b', '남는 돈'), el('span', { class: 'fn-sub' }, '들어온 돈 − 위 합계')), el('td', { class: 'num' }, won(r.remain)))),
          el('tfoot', null, el('tr', null, el('td', '합계'), el('td', { class: 'num' }, won(r.usedTotal + r.remain)))))),
        el('div', { class: 'fn-warn ' + (ok ? 'is-good' : '') + ' mt-8' }, ok
          ? '✓ 전체로 계산한 남는 돈(' + won(r.remain) + ')이 11/3 흐름의 남는 돈과 같아요. 균형이 맞아요.'
          : '전체로 계산한 남는 돈(' + won(r.remain) + ')과 11/3 흐름의 남는 돈(' + won(r.flowLeft) + ')이 ' + won(Math.abs(r.gap)) + ' 달라요 — 위 검산의 ! 항목을 확인하세요.')),
    ];
  }

  function originBars(P) {
    const f = P.c.f, r = P.c.recon;
    const father = Math.max(0, num(f.father.principal));
    const loan = Math.max(0, num(f.loan.original));
    const wife = Math.max(0, num(f.newHome.contractFromWife));
    const oldDep = Math.max(1, num(f.old.deposit));
    const newDep = Math.max(1, num(f.newHome.deposit));
    const seg = (cls, v, total, label) => (v > 0 ? el('i', { class: cls, style: { width: (v / total * 100).toFixed(2) + '%' }, title: label + ' ' + won(v) }) : null);
    const legend = (items) => el('div', { class: 'fn-legend' }, items.filter((x) => x[1] > 0).map(([cls, v, l]) => el('span', el('i', { class: cls }), l + ' ' + krw(v))));
    const ourOld = Math.max(0, r.ourOld), ourNew = Math.max(0, r.ourNew);
    const out = [
      el('div', { class: 'fn-card-h' }, el('h3', '아버지 돈은 지금 어디에 있나요?')),
      el('div', { class: 'fn-bars' },
        el('div', null,
          el('div', { class: 'fn-bar-h' }, el('span', '2024년 구집 보증금'), el('span', eok(num(f.old.deposit)))),
          el('div', { class: 'fn-bar', role: 'img', 'aria-label': '구집 보증금 구성: 아버지 차용금 ' + krw(father) + ', 우리 돈 ' + krw(ourOld) + ', 우리전세론 ' + krw(loan) },
            seg('fn-c-father', father, oldDep, '아버지 차용금'), seg('fn-c-ours', ourOld, oldDep, '우리 돈'), seg('fn-c-loan', loan, oldDep, '우리전세론')),
          legend([['fn-c-father', father, '아버지 차용금'], ['fn-c-ours', ourOld, '우리 돈'], ['fn-c-loan', loan, '우리전세론 (11/3에 모두 갚아 0원)']])),
        el('div', null,
          el('div', { class: 'fn-bar-h' }, el('span', '2026년 새 집 보증금'), el('span', eok(num(f.newHome.deposit)))),
          el('div', { class: 'fn-bar', role: 'img', 'aria-label': '새 집 보증금 구성: 아버지 차용금 ' + krw(father) + ', 우리 돈 ' + krw(ourNew) + ', 아내 주식 자금 ' + krw(wife) },
            seg('fn-c-father', Math.min(father, newDep), newDep, '아버지 차용금'), seg('fn-c-ours', ourNew, newDep, '우리 돈'), seg('fn-c-wife', wife, newDep, '아내 주식 자금')),
          legend([['fn-c-father', Math.min(father, newDep), '아버지 차용금'], ['fn-c-ours', ourNew, '우리 돈'], ['fn-c-wife', wife, '아내 주식 자금']]))),
      el('div', { class: 'callout kid mt-12' },
        el('p', el('b', '아버지께 빌린 ' + eok(father) + '은 새 집 보증금 안에 그대로 있어요. '),
          '구집 보증금 → 11/3 A가 돌려줌 → 새 집 보증금으로 옮겨가요. 아버지께 갚을 채무도 그대로 남아요(새 집 보증금을 돌려받을 때 갚는 구조). 대출 ' + eok(loan) + '은 11/3에 모두 갚아 0원이 돼요.')),
    ];
    if (r.ourNew < 0) out.push(el('div', { class: 'fn-warn is-bad' }, '새 집 보증금이 아버지 차용금 + 아내 자금보다 적어요 (' + won(r.ourNew) + ') — 숫자를 확인하세요.'));
    if (r.ourOld < 0) out.push(el('div', { class: 'fn-warn is-bad' }, '구집 보증금이 아버지 차용금 + 대출보다 적어요 (' + won(r.ourOld) + ') — 숫자를 확인하세요.'));
    return out;
  }

  function chainCard(P) {
    const node = (t, s) => el('span', { class: 'fn-chain-node' }, t, s ? el('small', s) : null);
    const arrow = () => el('span', { class: 'fn-chain-arrow', 'aria-hidden': 'true' }, '→');
    return el('section', { class: 'card' },
      el('div', { class: 'fn-card-h' }, el('h3', '증빙 흐름 — 이대로 보존하세요')),
      el('div', { class: 'fn-chain' },
        node('2024 아버지 → 나', eok(nn(P.c.f.father.principal)) + ' 이체 (차용)'), arrow(),
        node('나 → A', '구집 보증금'), arrow(),
        node(D.fmt(P.c.move) + ' A → 나', '보증금 반환'), arrow(),
        node(D.fmt(P.c.move) + ' 나 → C', '새 집 보증금')),
      el('p', { class: 'small mt-8 mb-0' }, '아버지 통장을 거쳐 왕복 송금할 필요가 없어요. 이 이체내역들과 "차용금이 새 보증금으로 옮겨갔다"는 확인서(기존 차용 약정 보완)면 충분해요. ',
        el('a', { href: '#/money/father', onclick: P.tabLink('father', 'fn-qa') }, '왜 그런지 보기 →')),
      basis('high', '세무상 쟁점은 2024년 3억이 대여인지 증여인지이고, 11/3 돈이 어떤 길로 움직이는지가 아니에요.', [LINK.taxlyLoan, LINK.taxlyGift]));
  }

  /* ======================= 탭 3: 이사 비용 예산 ======================= */
  function tabBudget(P) {
    const f = P.c.f;
    const lines = P.c.budget.lines;
    const linesCard = el('section', { class: 'card' },
      el('div', { class: 'fn-card-h' }, el('h3', '지출 항목'), el('span', { class: 'spacer' }),
        el('span', { class: 'small muted' }, '중개보수·첫 월세는 11/3 돈 흐름에 이미 들어 있어요')),
      el('div', { class: 'fn-blist' },
        el('div', { class: 'fn-bl-head', 'aria-hidden': 'true' }, el('span', '항목'), el('span', '금액'), el('span', '결제일'), el('span', '냄'), el('span', '메모'), el('span', '')),
        lines.map((l) => budgetRow(P, l))),
      el('div', { class: 'row mt-12' },
        el('button', { class: 'btn', type: 'button', onclick: () => {
          const nl = normLine({ id: MV.uid('bl'), label: '새 항목', amount: 0 });
          P.focusAfter = 'bl-label-' + nl.id;
          updStruct((fin) => { fin.budget.lines.push(nl); });
        } }, '+ 항목 추가')));
    const refunds = el('section', { class: 'card' },
      el('div', { class: 'fn-card-h' }, el('h3', '들어올 돈'), el('span', { class: 'small muted' }, '받으면 ✓ — 최종 계산에는 따로 표시해요')),
      el('div', { class: 'fn-blist' }, f.budget.refunds.map((r) => refundRow(P, r))),
      el('div', { class: 'row mt-12' },
        el('button', { class: 'btn', type: 'button', onclick: () => {
          const nr = normRefund({ id: MV.uid('rf'), label: '들어올 돈', amount: 0 });
          P.focusAfter = 'rf-label-' + nr.id;
          updStruct((fin) => { fin.budget.refunds.push(nr); });
        } }, '+ 들어올 돈 추가')));
    return el('div', { class: 'fn-panel' },
      P.live('section', 'card fn-anchor', () => budgetSummary(P)),
      linesCard,
      el('div', { class: 'grid grid-2' }, P.live('section', 'card', () => budgetAdvice(P)), el('div', null, refunds, P.live('section', 'card', () => monthlyCard(P)))));
  }

  function budgetSummary(P) {
    const c = P.c, b = c.budget, fl = c.flow;
    const max = Math.max(1, fl.leftover, b.unpaid);
    const bar = (cls, v) => el('div', { class: 'fn-cmp-track' }, el('i', { class: cls, style: { width: Math.max(0, Math.min(100, v / max * 100)).toFixed(1) + '%' } }));
    return [
      el('div', { class: 'fn-card-h', id: 'fn-budget-sum' }, el('h3', '이사 비용 한눈에')),
      el('div', { class: 'fn-bstats' },
        el('div', { class: 'fn-bstat' }, el('div', { class: 'k' }, '예산 합계 (' + b.count + '개)'), el('div', { class: 'v' }, krw(b.total))),
        el('div', { class: 'fn-bstat' }, el('div', { class: 'k' }, '이미 낸 돈'), el('div', { class: 'v' }, krw(b.paid))),
        el('div', { class: 'fn-bstat' }, el('div', { class: 'k' }, '앞으로 낼 돈'), el('div', { class: 'v' }, krw(b.unpaid))),
        el('div', { class: 'fn-bstat' }, el('div', { class: 'k' }, D.fmt(c.move) + ' 뒤 남는 돈'), el('div', { class: 'v' }, krw(fl.leftover)))),
      el('div', { class: 'fn-cmp' },
        el('div', { class: 'fn-cmp-row' }, el('span', '남는 돈'), bar('is-left', Math.max(0, fl.leftover)), el('b', krw(fl.leftover))),
        el('div', { class: 'fn-cmp-row' }, el('span', '앞으로 낼 돈'), bar('is-cost', b.unpaid), el('b', krw(b.unpaid)))),
      el('div', { class: 'fn-verdict ' + (c.net < 0 ? 'is-bad' : 'is-good') },
        el('span', { class: 'k' }, c.net < 0 ? '추가로 필요한 돈' : '여유'),
        el('span', { class: 'v', title: won(c.net) }, krw(Math.abs(c.net))),
        b.refundsTotal ? el('span', { class: 'small' }, '들어올 돈 ' + krw(b.refundsTotal) + '까지 넣으면 ' + (c.net + b.refundsTotal < 0 ? '부족 ' : '여유 ') + krw(Math.abs(c.net + b.refundsTotal))) : null),
      basis('low', '리서치 추정: 남는 돈 약 281만~318만원 vs 추가 지출 약 410만~870만원 → 110만~590만원 부족 가능. 견적이 확정되면 다시 계산하세요.', [], '견적·영수증으로 다시 계산'),
    ];
  }

  function budgetRow(P, l) {
    const meta = l.meta;
    const row = el('div', { class: 'fn-bl', role: 'group', 'aria-label': l.label || '지출 항목' });
    const curLine = () => P.c.budget.lines.find((x) => x.id === l.id) || l;
    P.bind(() => {
      const x = curLine();
      row.classList.toggle('is-paid', !!x.paid);
      row.classList.toggle('is-off', x.on === false);
    });
    const setLine = (fn, struct) => (struct ? updStruct : upd)((fin) => { const x = fin.budget.lines.find((y) => y.id === l.id); if (x) fn(x); });
    // 항목명
    const labelCell = el('div', { class: 'fn-bl-label' },
      textField('항목 이름', l.label, (v) => updSilent((fin) => { const x = fin.budget.lines.find((y) => y.id === l.id); if (x) x.label = v; }), { fk: 'bl-label-' + l.id, bare: true }),
      meta ? el('div', { class: 'fn-range' }, el('span', '보통 ' + (meta.low ? krw(meta.low) : '0원') + ' ~ ' + krw(meta.high)),
        basis(meta.conf, meta.basis, meta.auto === 'hug' ? [LINK.hug] : [], meta.conf === 'mid' ? 'HUG에 확인' : '견적·영수증으로 확인', true)) : null);
    // 금액
    const amountCell = el('div', { class: 'fn-bl-amount' });
    if (meta && meta.auto) {
      if (l.isAuto) {
        amountCell.appendChild(P.live('div', 'fn-bl-auto', () => {
          const x = curLine();
          const a = x.autoInfo || { value: 0, note: '' };
          return [el('b', won(a.value)), el('small', a.note)];
        }));
        amountCell.appendChild(el('div', { class: 'fn-bl-actions' }, chip('자동', 'kid'),
          el('button', { class: 'btn btn-sm fn-mini-btn', type: 'button', 'data-fk': 'bl-manual-' + l.id, onclick: () => {
            const v = curLine().value;
            P.focusAfter = 'bl-amt-' + l.id;
            setLine((x) => { x.auto = false; x.amount = v; }, true);
          } }, '직접 입력'),
          meta.auto === 'mover' || meta.auto === 'lg' ? el('a', { class: 'small', href: '#/stuff/estimate' }, '짐·견적 →') : null));
      } else {
        amountCell.appendChild(moneyField('금액', l.value, (v) => setLine((x) => { x.amount = v; }), { fk: 'bl-amt-' + l.id, bare: true }));
        amountCell.appendChild(el('div', { class: 'fn-bl-actions' }, chip('직접', ''),
          el('button', { class: 'btn btn-sm fn-mini-btn', type: 'button', 'data-fk': 'bl-auto-' + l.id, onclick: () => setLine((x) => { x.auto = true; }, true) }, '자동 계산으로')));
      }
      if (meta.optional) {
        amountCell.appendChild(checkbox('가입 예정 (예산에 넣기)', l.on !== false, (v) => setLine((x) => { x.on = v; }), { fk: 'bl-on-' + l.id }));
      }
    } else {
      amountCell.appendChild(moneyField('금액', l.value, (v) => setLine((x) => { x.amount = v; }), { fk: 'bl-amt-' + l.id, bare: true }));
    }
    const dateCell = el('div', { class: 'fn-bl-date' }, dateField('결제일', l.date, (v) => updSilent((fin) => { const x = fin.budget.lines.find((y) => y.id === l.id); if (x) x.date = v; }), { fk: 'bl-date-' + l.id, bare: true }));
    const paidCell = el('div', { class: 'fn-bl-paid' }, checkbox('냄', l.paid, (v) => setLine((x) => { x.paid = v; }), { fk: 'bl-paid-' + l.id }));
    const memoCell = el('div', { class: 'fn-bl-memo' }, textField('메모', l.memo, (v) => updSilent((fin) => { const x = fin.budget.lines.find((y) => y.id === l.id); if (x) x.memo = v; }), { fk: 'bl-memo-' + l.id, bare: true, placeholder: '메모 (업체·견적 등)' }));
    const delCell = el('div', { class: 'fn-bl-del' }, !meta ? el('button', {
      class: 'btn btn-ghost btn-icon', type: 'button', 'aria-label': (l.label || '항목') + ' 삭제', title: '삭제', 'data-fk': 'bl-del-' + l.id,
      onclick: () => {
        const snapshot = MV.clone(MV.store.get().finance.budget.lines.find((y) => y.id === l.id));
        const idx = MV.store.get().finance.budget.lines.findIndex((y) => y.id === l.id);
        updStruct((fin) => { fin.budget.lines = fin.budget.lines.filter((y) => y.id !== l.id); });
        MV.ui.toast('“' + (snapshot && snapshot.label || '항목') + '” 삭제했어요', { action: { label: '되돌리기', onClick: () => {
          if (snapshot) updStruct((fin) => { fin.budget.lines.splice(Math.max(0, idx), 0, snapshot); });
        } } });
      },
    }, '✕') : null);
    row.append(labelCell, amountCell, dateCell, paidCell, memoCell, delCell);
    return row;
  }

  function refundRow(P, r) {
    const meta = REFUND_META[r.id];
    const row = el('div', { class: 'fn-rf', role: 'group', 'aria-label': r.label || '들어올 돈' });
    P.bind(() => {
      const x = P.c.f.budget.refunds.find((y) => y.id === r.id);
      row.classList.toggle('is-paid', !!(x && x.got));
    });
    const setR = (fn, struct) => (struct ? updStruct : upd)((fin) => { const x = fin.budget.refunds.find((y) => y.id === r.id); if (x) fn(x); });
    row.append(
      el('div', { class: 'fn-bl-label' },
        textField('항목 이름', r.label, (v) => updSilent((fin) => { const x = fin.budget.refunds.find((y) => y.id === r.id); if (x) x.label = v; }), { fk: 'rf-label-' + r.id, bare: true }),
        meta ? el('div', { class: 'fn-range' }, basis(meta.conf, meta.basis, [], '관리사무소·은행 확인', true)) : null),
      el('div', { class: 'fn-bl-amount' }, moneyField('금액', r.amount, (v) => setR((x) => { x.amount = v; }), { fk: 'rf-amt-' + r.id, bare: true })),
      el('div', { class: 'fn-bl-paid' }, checkbox('받음', r.got, (v) => setR((x) => { x.got = v; }), { fk: 'rf-got-' + r.id })),
      el('div', { class: 'fn-bl-memo' }, textField('메모', r.memo, (v) => updSilent((fin) => { const x = fin.budget.refunds.find((y) => y.id === r.id); if (x) x.memo = v; }), { fk: 'rf-memo-' + r.id, bare: true, placeholder: '메모' })),
      el('div', { class: 'fn-bl-del' }, !meta ? el('button', {
        class: 'btn btn-ghost btn-icon', type: 'button', 'aria-label': (r.label || '항목') + ' 삭제', title: '삭제', 'data-fk': 'rf-del-' + r.id,
        onclick: () => {
          const list = MV.store.get().finance.budget.refunds;
          const idx = list.findIndex((y) => y.id === r.id);
          const snapshot = idx >= 0 ? MV.clone(list[idx]) : null;
          updStruct((fin) => { fin.budget.refunds = fin.budget.refunds.filter((y) => y.id !== r.id); });
          MV.ui.toast('“' + (snapshot && snapshot.label || '들어올 돈') + '” 삭제했어요', { action: { label: '되돌리기', onClick: () => {
            if (snapshot) updStruct((fin) => { if (!fin.budget.refunds.some((y) => y.id === snapshot.id)) fin.budget.refunds.splice(Math.max(0, idx), 0, snapshot); });
          } } });
        },
      }, '✕') : null));
    return row;
  }

  function budgetAdvice(P) {
    const c = P.c;
    const refundBack = c.rentCredit.credit + c.housing.saving;
    if (c.net >= 0) {
      return [
        el('div', { class: 'fn-card-h' }, el('h3', '💡 여유가 있어요')),
        el('p', { class: 'small' }, '남는 돈으로 이사비를 낼 수 있어요. 남는 ' + krw(c.net) + '은 예비비로 두고, 견적이 확정되면 다시 확인하세요.'),
        el('ul', { class: 'fn-ul small' },
          el('li', '방문견적 3곳을 받아 "부가세 포함 총액"으로 계약하기 (카드 수수료 전가는 금지)'),
          el('li', '옷장·커튼은 새 집 실측 후 사도 늦지 않아요')),
      ];
    }
    return [
      el('div', { class: 'fn-card-h' }, el('h3', '💡 ' + krw(-c.net) + '을 메우는 방법'), guideLink('budget-cut')),
      el('ol', { class: 'fn-ul small' },
        el('li', el('b', '장기수선충당금 돌려받기'), ' — 약 20만~50만원. 구집 관리사무소 납부확인서로 A에게 청구.'),
        el('li', el('b', '카드 무이자 할부'), '로 옷장·세탁기 결제 시기를 나누기.'),
        el('li', el('b', '안 쓰는 물건 중고 판매'), ' — 붙박이장에서 나온 물건·책·장난감.'),
        el('li', el('b', '이사업체 단가 협상'), ' — 11/3(화)은 평일이고 손없는날이 아니라 할증이 없어요. 견적 3곳 비교.'),
        el('li', el('b', '급하지 않은 구매 미루기'), ' — 옷장·커튼·소품은 이사 후 실측하고 천천히.'),
        el('li', el('b', '연말정산 환급'), ' — 2027년 2월 약 ' + krw(refundBack) + ' (월세 공제 ' + krw(c.rentCredit.credit) + ' + 주택자금 공제 ' + krw(c.housing.saving) + '). 시기는 나중이라 당장 현금은 아니에요.')),
      basis('low', '리서치 예산 조언(finance_verified F16). 금액은 추정이에요.', [], '견적 확정 후 다시 계산'),
    ];
  }

  function monthlyCard(P) {
    const c = P.c;
    const rent = num(c.f.newHome.rent);
    const interest = c.gift.planMonthly;
    return [
      el('div', { class: 'fn-card-h' }, el('h3', '📆 매달 고정지출이 이렇게 늘어요')),
      el('div', { class: 'fn-kv' },
        el('span', { class: 'k' }, '새 집 월세 (매월 3일)'), el('span', { class: 'v' }, won(rent)),
        el('span', { class: 'k' }, '아버지 이자 (연 ' + pctTxt(c.gift.plan) + ' 계획)'), el('span', { class: 'v' }, won(interest)),
        el('span', { class: 'sep' }),
        el('span', { class: 'k strong' }, '합계'), el('span', { class: 'v' }, won(rent + interest))),
      el('p', { class: 'small muted mt-8 mb-0' }, '아버지 이자율은 "아버지 차용금" 탭에서 바꿀 수 있어요.'),
    ];
  }

  /* ======================= 탭 4: 아버지 차용금 ======================= */
  function tabFather(P) {
    const g = P.c.f.father;
    const setG = (k) => (v) => upd((fin) => { fin.father[k] = v; });
    const qa = el('section', { class: 'card tint-good fn-anchor', id: 'fn-qa' },
      el('div', { class: 'fn-qa-q' }, 'Q. 11/3에 돈을 아버지 통장으로 보냈다가 다시 받아야 하나요?'),
      el('div', { class: 'fn-qa-a' }, 'A. 아니요. 필요 없고, 하지 않는 편이 나아요.'),
      el('ol', { class: 'fn-ul' },
        el('li', '세금 쟁점은 2024년에 받은 3억이 "빌린 돈"인지 "받은 돈(증여)"인지예요. 11/3에 돈이 어떤 길로 움직이는지가 아니에요. 11/3에 A에게 받는 돈은 내 보증금이 돌아오는 것이고, 아버지께 갚을 3억은 그대로 남아요.'),
        el('li', '왕복하면 "갚고 다시 빌림"이 돼 새 차용 약정이 필요하고, 2026년에 "아버지 → 나 3억" 이체 기록이 새로 생겨 오히려 증여로 오해받을 근거가 돼요.'),
        el('li', '당일 이체가 약 6억 더 늘어 한도·시간·사고 위험만 커져요. 세금 혜택은 없어요.')),
      el('p', { class: 'mb-0' }, el('b', '대신 할 일: '), '2024 이체 → 구집 보증금 → 11/3 반환 → 새 보증금의 이체내역을 보존하고, 차용 약정서·이자 이체 기록·상환 계획을 갖추세요.'),
      basis('high', '가족 간 차용은 차용 사실(약정서)·이자 지급·상환 기록으로 판단해요. 돈의 경로를 바꾼다고 달라지지 않아요.', [LINK.taxlyLoan, LINK.taxlyGift]));
    const calc = el('section', { class: 'card' },
      el('div', { class: 'fn-card-h' }, el('h3', '🧮 증여세 계산기 (상증법 제41조의4 — 무이자·저리 대출)')),
      el('div', { class: 'fn-fields' },
        moneyField('빌린 원금', g.principal, setG('principal'), { fk: 'g-principal' }),
        numField('실제 약정 이자율', g.actualRate, setG('actualRate'), { suffix: '% / 년', min: 0, max: 30, fk: 'g-actual', hint: '지금 실제로 이자를 내고 있으면 그 이자율' }),
        numField('적정이자율 (세법)', g.properRate, setG('properRate'), { suffix: '% / 년', min: 0, max: 30, fk: 'g-proper', hint: '상증법 시행규칙 제10조의5: 4.6%' }),
        dateField('빌린 날 (2024)', g.startDate, setG('startDate'), { fk: 'g-start', hint: '이체내역의 날짜로 고치세요 (가정값)' }),
        moneyField('10년 안에 부모님께 받은 다른 증여', g.priorGifts, setG('priorGifts'), { fk: 'g-prior', hint: '성년 자녀 공제 5천만원에서 빠져요' })),
      P.live('div', 'fn-calc-out', () => giftOut(P)),
      basis('mid', '적정이자율 4.6%로 계산한 이자와 실제 이자의 차액이 연 1천만원 이상이면 차액 전체가 증여재산, 1천만원 미만이면 과세하지 않아요. 기간이 정해지지 않았으면 1년 단위로 매년 다시 계산해요. 4.6%는 2016년 이후 같은 값이며 2026년 변경 여부는 원문으로 다시 확인하지 못했어요.', [LINK.taxlyRate, LINK.transtax, LINK.lawGift], '세무사 확인 권장'));
    const plan = el('section', { class: 'card' },
      el('div', { class: 'fn-card-h' }, el('h3', '💸 아버지께 드릴 이자 계획')),
      el('div', { class: 'fn-fields' },
        numField('계획 이자율', g.planRate, setG('planRate'), { suffix: '% / 년', min: 0, max: 30, fk: 'g-plan', hint: '권장 1.3~1.5%' })),
      P.live('div', 'fn-calc-out', () => planOut(P)),
      basis('mid', '개인 간 이자(비영업대금의 이익)는 원칙상 이자를 주는 사람이 27.5%(소득세 25% + 지방소득세 2.5%)를 원천징수하고 다음 달 10일까지 신고·납부해요. 아버지의 이자·배당 소득이 연 2천만원 이하이면 이것으로 과세가 끝나요(분리과세).', [LINK.taxlyNote], '세무사와 처리 방법 확정'));
    const worst = P.live('section', 'card tint-warn', () => worstOut(P));
    const docs = docsCard(P);
    return el('div', { class: 'fn-panel' },
      qa,
      el('div', { class: 'grid grid-2' }, calc, el('div', null, plan, worst)),
      docs,
      el('div', { class: 'callout' },
        el('p', el('b', '세무사 확인 권장 — '), '이 계산은 법령 지식(2025년 기준)으로 점검한 참고용이에요. 실제 신고·이자 처리는 세무사와 정하세요. ',
          el('a', { href: '#/guide/money/father' }, '가이드: 아버지 차용금 정리 →'))));
  }

  function giftOut(P) {
    const g = P.c.gift;
    const out = [
      el('div', { class: 'fn-kv' },
        el('span', { class: 'k' }, '적정 이자 (원금 × ' + pctTxt(g.proper) + ')'), el('span', { class: 'v' }, won(g.properInt) + ' / 년'),
        el('span', { class: 'k' }, '실제 이자 (원금 × ' + pctTxt(g.actual) + ')'), el('span', { class: 'v' }, won(g.actualInt) + ' / 년'),
        el('span', { class: 'sep' }),
        el('span', { class: 'k strong' }, '연간 이익 (차액)'), el('span', { class: 'v ' + (g.taxable ? 'is-bad' : 'is-good') }, won(g.benefit))),
      g.taxable
        ? el('div', { class: 'fn-warn is-bad' }, '1천만원 이상 → 차액 ' + won(g.benefit) + ' 전체가 매년 증여재산이 돼요.')
        : el('div', { class: 'fn-warn is-good' }, '1천만원 미만 → 이 조건이 유지되는 동안 증여세 과세 대상이 아니에요. (실제로 이자를 낸 기록이 있어야 해요)'),
    ];
    if (g.minRate != null) {
      out.push(el('div', null,
        el('div', { class: 'small strong' }, '증여로 안 보려면 최소 이자율'),
        el('div', { class: 'fn-big-num is-brand' }, '연 ' + pctTxt(g.minRate) + ' · 월 ' + won(g.minMonthly)),
        el('div', { class: 'small muted' }, g.minRate === 0 ? '원금이 작아서 무이자여도 차액이 1천만원 미만이에요.' : '경계값이라 여유를 두고 ' + g.rec.map((x) => pctTxt(x.r) + '(월 ' + won(x.m) + ')').join(' ~ ') + '를 권해요.')));
    }
    if (!g.start) {
      out.push(el('div', { class: 'fn-warn' }, '빌린 날(2024년 이체 날짜)을 넣으면 지금까지 쌓인 금액과 신고기한을 계산해요.'));
    } else if (g.startFuture) {
      out.push(el('div', { class: 'fn-warn is-bad' }, '빌린 날(' + D.fmtLong(g.start) + ')이 오늘보다 뒤예요 — 2024년 실제 이체 날짜로 고쳐 주세요.'));
    } else if (g.taxable && g.periods > 0) {
      out.push(deemedGiftNote(g));
    }
    return out;
  }
  /* 1년 단위 의제 증여 누적과 공제 (상증법 제41조의4: 기간 미정이면 1년마다 새로 빌린 것으로 봄) */
  function deemedGiftNote(g) {
    const how = g.actual === 0 ? '무이자면' : '지금 이자율(' + pctTxt(g.actual) + ')이면';
    const starts = [];
    const ymd = (x) => { const d = D.parse(x); return d ? d.getFullYear() + '.' + (d.getMonth() + 1) + '.' + d.getDate() : ''; };
    for (let i = 0; i < Math.min(g.periods, 3); i++) starts.push(ymd(addMonths(g.start, 12 * i)));
    const startTxt = g.periods <= 3 ? ' (' + starts.join(', ') + ' 시작분)' : '';
    const head = how + ' 1년 단위마다 차액 ' + krw(g.benefit) + '이 통째로 증여로 계산돼요. 지금까지 ' + g.periods + '번' + startTxt + ' → 누적 ' + krw(g.cumulative) + '. ';
    const excess = Math.max(0, g.cumulative - g.deduction);
    let mid;
    if (g.deduction <= 0) {
      mid = '10년 안에 받은 다른 증여로 성년 자녀 공제 5,000만원을 이미 다 써서, 이 금액이 모두 과세 대상이 될 수 있어요 (세율 10%면 약 ' + krw(giftTax(g.cumulative)) + ' + 가산세). ';
    } else if (excess > 0) {
      mid = '남은 성년 자녀 공제 ' + krw(g.deduction) + '을 넘은 ' + krw(excess) + '이 과세 대상이 될 수 있어요 (세율 10%면 약 ' + krw(giftTax(excess)) + ' + 가산세). ';
    } else {
      mid = '성년 자녀 공제 ' + krw(g.deduction) + ' 안이라 아직 낼 세금은 없지만 신고는 필요할 수 있어요(공제로 ' + (g.coveredPeriods > 0 ? g.coveredPeriods + '번째 1년분, 약 ' + g.yearsToExhaust.toFixed(1) + '년분까지' : '1년분도 다') + ' 흡수). ';
    }
    const next = g.nextPeriod ? '다음 1년분은 ' + D.fmtLong(g.nextPeriod).replace(/ \(.\)$/, '') + ' 무렵부터 — 그 전에 연 ' + pctTxt(g.minRate || 0) + ' 이상 이자를 약정하고 실제로 주세요. ' : '';
    return el('div', { class: 'fn-warn' + (g.deduction <= 0 || excess > 0 ? ' is-bad' : '') }, head + mid + next + '진짜 위험은 아래 "원금 전체가 증여로 판정"되는 경우예요.');
  }

  function planOut(P) {
    const g = P.c.gift;
    const warn = g.minRate != null && g.plan < g.minRate;
    return [
      el('div', { class: 'fn-big-num ' + (warn ? 'is-bad' : 'is-good') }, '월 ' + won(g.planMonthly)),
      el('div', { class: 'fn-kv' },
        el('span', { class: 'k' }, '연 이자'), el('span', { class: 'v' }, won(g.planAnnual)),
        el('span', { class: 'k' }, '원천징수 소득세 25%'), el('span', { class: 'v' }, won(g.wh.income) + ' / 월'),
        el('span', { class: 'k' }, '지방소득세 2.5%'), el('span', { class: 'v' }, won(g.wh.local) + ' / 월'),
        el('span', { class: 'sep' }),
        el('span', { class: 'k strong' }, '아버지 실제 입금액'), el('span', { class: 'v' }, won(g.wh.net) + ' / 월')),
      warn
        ? el('div', { class: 'fn-warn is-bad' }, '계획 이자율이 최소 ' + pctTxt(g.minRate) + '보다 낮아요 — 차액이 1천만원을 넘어 증여로 볼 수 있어요.')
        : el('div', { class: 'fn-warn is-good' }, '최소 이자율(' + pctTxt(g.minRate == null ? 0 : g.minRate) + ') 이상이에요. 매달 같은 날 "차용금 이자" 메모로 자동이체하세요.'),
    ];
  }

  function worstOut(P) {
    const g = P.c.gift;
    return [
      el('div', { class: 'fn-card-h' }, el('h3', '⚠ 최악의 경우: 원금 전체가 증여로 판정되면')),
      el('div', { class: 'fn-kv' },
        el('span', { class: 'k' }, '과세표준 (원금 − 공제 ' + krw(g.deduction) + ')'), el('span', { class: 'v' }, won(g.base)),
        el('span', { class: 'k' }, '증여세 (1억까지 10%, 초과분 20% …)'), el('span', { class: 'v' }, won(g.tax)),
        el('span', { class: 'k' }, '무신고가산세 20%'), el('span', { class: 'v' }, won(g.noReport)),
        el('span', { class: 'k' }, g.start && !g.startFuture ? '납부지연가산세 (하루 0.022% × ' + g.lateDays + '일)' : '납부지연가산세 (빌린 날을 넣으면 계산)'), el('span', { class: 'v' }, g.start && !g.startFuture ? won(g.lateFee) : '-'),
        el('span', { class: 'sep' }),
        el('span', { class: 'k strong' }, '합계 (오늘 기준)'), el('span', { class: 'v is-bad' }, won(g.worst))),
      el('p', { class: 'small mt-8 mb-0' }, g.start && !g.startFuture
        ? '신고기한 ' + D.fmtLong(g.deadline) + ' (빌린 날이 속한 달 말일부터 3개월) 기준. 차용 약정서·이자 이체·상환 기록이 이 위험을 막는 핵심이에요.'
        : '아버지 차용금 계산기에 빌린 날(2024년 이체 날짜)을 넣으면 신고기한과 가산세를 계산해요. 차용 약정서·이자 이체·상환 기록이 이 위험을 막는 핵심이에요.'),
      basis('mid', '과세표준 2.5억 → 4,000만원, 무신고가산세 800만원, 납부지연가산세 약 500만원대 → 약 5,300만원(리서치 재계산).', [LINK.lawGift], '세무사 확인 권장'),
    ];
  }

  function docsCard(P) {
    const g = P.c.f.father;
    const checks = g.checks || {};
    const DOCS = [
      { key: 'note', text: '차용 약정서 — 원금·실제 차용일·이자율·지급일과 방법(계좌이체)·만기·상환 방법·서명. 2024년에 안 썼다면 날짜를 소급하지 말고 오늘 날짜로 "2024년 3억 대여 사실 확인 및 조건 약정서" 작성' },
      { key: 'date', re: [/약정서.*날짜/], text: '작성일 고정 — 공증, 공증사무소 사문서 확정일자, 내용증명 중 하나' },
      { key: 'auto', re: [/이자\s*자동이체/], text: '이자 매월 자동이체 — 메모 "차용금 이자" (1.3%면 월 ' + won(Math.round(num(g.principal) * 0.013 / 12)) + ')' },
      { key: 'wh', text: '원천징수 처리 방법을 세무사와 결정 (27.5%, 다음 달 10일까지 신고·납부)' },
      { key: 'repay', text: '상환 계획 정하기 — 일부라도 갚으면 이체 메모 "원금 상환"' },
      { key: 'move', text: '"차용금이 새 집 보증금으로 옮겨갔다" 확인서 (기존 약정 보완)' },
      { key: 'keep', text: '증빙 보관 — 2024 이체내역, 구집 계약서, 새 계약서, 11/3 이체내역, 이자 이체내역' },
      { key: 'cpa', re: [/세무사/], text: '세무사 상담 — 2024~2026 못 낸 이자 처리, 이자율, 원천징수, 상환 계획, 10년 내 증여 합산, 소명 서류 묶음' },
    ];
    const L = linkedChecklist(P, DOCS, checks, (k, v) => updStruct((fin) => { fin.father.checks[k] = v; }), 'doc-', false);
    return el('section', { class: 'card' },
      el('div', { class: 'fn-card-h' }, el('h3', '📂 갖춰 둘 서류'), el('span', { class: 'spacer' }), chip(L.doneN + '/' + L.total, L.doneN === L.total ? 'good' : '')),
      L.list,
      el('p', { class: 'small muted mt-8 mb-0' }, '아내의 주식 자금 500만원은 배우자 증여재산공제(6억) 범위라 문제없어요.'),
      basis('mid', '리서치 검증본: 차용증 요건·작성일 입증·원천징수·상담 포인트.', [LINK.taxlyNote, LINK.transtax], '세무사 확인 권장'));
  }

  /* ======================= 탭 5: 중개보수 · 세금 ======================= */
  function tabTax(P) {
    const f = P.c.f;
    const broker = el('section', { class: 'card fn-anchor', id: 'fn-broker' },
      el('div', { class: 'fn-card-h' }, el('h3', '🤝 새 집 중개보수 계산기'), guideLink('broker')),
      el('div', { class: 'fn-fields' },
        moneyField('보증금', f.newHome.deposit, (v) => upd((fin) => { fin.newHome.deposit = v; }), { fk: 't-dep' }),
        moneyField('월세', f.newHome.rent, (v) => upd((fin) => { fin.newHome.rent = v; }), { fk: 't-rent' }),
        selectField('중개사 과세유형', f.broker.vat, Object.keys(VAT).map((k) => [k, VAT[k].label]), (v) => upd((fin) => { fin.broker.vat = v; }), { fk: 't-vat', hint: '홈택스 사업자 상태 조회로 확인' }),
        moneyField('합의(예정) 금액', f.broker.planned, (v) => upd((fin) => { fin.broker.planned = v; }), { fk: 't-planned' })),
      checkbox('금액을 중개사와 문자로 확정했어요', f.broker.agreed, (v) => upd((fin) => { fin.broker.agreed = v; }), { fk: 't-agreed' }),
      P.live('div', 'fn-calc-out', () => brokerOut(P)),
      basis('high', '서울시 주택 임대차 요율: 환산보증금 = 보증금 + 월세×100 (5천만원 미만이면 ×70). 1억~6억 미만은 0.3%가 상한이고 상한 안에서 협의해요. 부가세는 별도(간이과세자 약 4%는 관행).', [LINK.seoulFee, LINK.ydpFee, LINK.hometax]));
    const rent = el('section', { class: 'card' },
      el('div', { class: 'fn-card-h' }, el('h3', '🏠 월세 세액공제 계산기'), guideLink('tax-rent')),
      el('div', { class: 'fn-fields' },
        selectField('공제받을 사람의 총급여', f.tax.band, Object.keys(BANDS).map((k) => [k, BANDS[k].label]), (v) => upd((fin) => { fin.tax.band = v; }), { fk: 't-band', hint: '종합소득이면 7천만원 이하' })),
      P.live('div', 'fn-calc-out', () => rentOut(P)),
      checksList(P, 'tax', [
        { key: 'homeless', text: '무주택 세대주 (세대주가 주택자금 공제를 안 받으면 세대원도 가능, 배우자 명의 계약도 인정)' },
        { key: 'salary', text: '총급여 8천만원 이하 (종합소득 7천만원 이하)' },
        { key: 'size', text: '국민주택규모(85㎡ 이하) 또는 기준시가 4억 이하 — 새 집 전용 59.67㎡라 충족' },
        { key: 'address', text: '전입신고 (계약서 주소 = 주민등록 주소)' },
        { key: 'transfer', text: '월세는 계좌이체로, 메모 "월세" (C 본인 계좌)' },
        { key: 'copy', text: '임대차계약서 사본 보관' },
      ]),
      basis('mid', '조특법 제95조의2 (2024 귀속 이후): 총급여 5,500만원 이하 17%, 8,000만원 이하 15%, 월세 한도 연 1,000만원.', [LINK.lawSpecial], '연말정산 전 세법 개정 확인'));
    const housing = el('section', { class: 'card' },
      el('div', { class: 'fn-card-h' }, el('h3', '🏦 주택임차차입금 원리금 소득공제 (2026년이 마지막 해)'), guideLink('tax-loan')),
      el('div', { class: 'fn-fields' },
        moneyField('같은 해 주택청약 소득공제액 (있으면)', f.tax.subscription, (v) => upd((fin) => { fin.tax.subscription = v; }), { fk: 't-sub', hint: '둘을 합쳐 400만원 한도' }),
        selectField('한계세율 (지방세 포함)', String(f.tax.marginal), MARGINAL.map(([v, l]) => [String(v), l]), (v) => upd((fin) => { fin.tax.marginal = +v; }), { fk: 't-marginal' })),
      P.live('div', 'fn-calc-out', () => housingOut(P)),
      checksList(P, 'tax', [
        { key: 'loanTiming', text: '대출을 입주(전입)일 전후 3개월 안에 받았음 (2024년 구집)' },
        { key: 'loanDirect', text: '대출금이 임대인(A) 계좌로 직접 입금됐음' },
        { key: 'certificate', text: '우리은행 "주택자금 상환증명서" 받기 (2,200만원 중도상환분 포함)' },
      ]),
      basis('mid', '상환액의 40%, 주택청약 공제와 합산 연 400만원 한도. 대출을 다 갚는 2026년이 마지막 공제 해예요. 월세 세액공제와 함께 받을 수 있어요.', [LINK.lawSpecial], '연말정산 전 확인'));
    return el('div', { class: 'fn-panel' },
      broker,
      el('div', { class: 'grid grid-2' }, rent, housing),
      P.live('section', 'card tint-good', () => {
        const c = P.c;
        return [
          el('div', { class: 'fn-card-h' }, el('h3', (c.rentCredit.year + 1) + '년 2월 연말정산 예상 환급 (' + c.rentCredit.year + '년 귀속)')),
          el('div', { class: 'fn-big-num is-good' }, '약 ' + krw(c.rentCredit.credit + c.housing.saving)),
          el('div', { class: 'fn-formula' }, '월세 세액공제 ' + won(c.rentCredit.credit) + ' + 주택자금 소득공제 절세 ' + won(c.housing.saving)),
        ];
      }));
  }

  function brokerOut(P) {
    const b = P.c.broker;
    const rows = SEOUL_LEASE.map((t, i) => el('tr', { class: 'fn-tier-row' + (i === b.tierIdx ? ' is-cur' : '') },
      el('td', t.label), el('td', { class: 'num' }, t.rateTxt)));
    const out = [
      el('div', { class: 'fn-formula' }, '환산보증금 = ' + eok(b.dep) + ' + ' + krw(b.rent) + ' × ' + (b.used70 ? '70' : '100') + ' = ', el('b', eok(b.conv))),
      el('div', { class: 'fn-kv' },
        el('span', { class: 'k' }, '요율 구간 (' + b.tier.label + ')'), el('span', { class: 'v' }, b.tier.rateTxt),
        el('span', { class: 'k' }, '법정 상한 (부가세 별도)'), el('span', { class: 'v' }, won(b.cap)),
        el('span', { class: 'k' }, '부가세 (' + b.vat.label.replace(/ \(.+\)/, '') + ')'), el('span', { class: 'v' }, won(b.maxWithVat - b.cap)),
        el('span', { class: 'sep' }),
        el('span', { class: 'k strong' }, '최대로 낼 수 있는 돈'), el('span', { class: 'v' }, won(b.maxWithVat)),
        el('span', { class: 'k' }, '합의(예정) 금액'), el('span', { class: 'v ' + (b.verdict === 'over' ? 'is-bad' : 'is-good') }, won(b.planned))),
    ];
    if (b.verdict === 'over') out.push(el('div', { class: 'fn-warn is-bad' }, '법정 상한보다 ' + won(b.diff) + ' 많아요 — 상한을 넘는 금액은 받을 수 없어요. 금액을 다시 협의하세요.'));
    else if (b.verdict === 'under') out.push(el('div', { class: 'fn-warn' + (P.c.f.broker.agreed ? ' is-good' : '') }, P.c.f.broker.agreed
      ? '상한 안이에요. 확정한 금액(' + won(b.planned) + ')대로 보내고 현금영수증을 받으세요.'
      : '중개사가 최대 ' + won(b.maxWithVat) + '까지 청구할 수 있어요(예산보다 ' + won(-b.diff) + ' 많음). 금액을 문자로 미리 확정하세요.'));
    else out.push(el('div', { class: 'fn-warn is-good' }, '딱 상한(부가세 포함)이에요. 상한 안에서 협의할 수 있어요.'));
    out.push(el('details', null, el('summary', { class: 'small strong' }, '서울시 주택 임대차 요율표 보기'),
      el('div', { class: 'table-wrap mt-8' }, el('table', { class: 'tbl' }, el('thead', null, el('tr', null, el('th', '환산보증금'), el('th', { class: 'num' }, '상한 요율'))), el('tbody', null, rows)))));
    out.push(el('p', { class: 'small muted mb-0' }, '중개업은 현금영수증 의무발행업종이라 10만원 이상이면 발급해야 해요. 구집(A→B 매매·조기종료)은 우리가 의뢰한 거래가 아니라 낼 돈이 없어요.'));
    return out;
  }

  function rentOut(P) {
    const r = P.c.rentCredit;
    const dates = r.dates.map((d) => D.fmt(d)).join(', ') || '없음';
    return [
      el('div', { class: 'fn-kv' },
        el('span', { class: 'k' }, r.year + '년에 내는 월세 (' + r.dates.length + '번: ' + dates + ')'), el('span', { class: 'v' }, won(r.paid)),
        el('span', { class: 'k strong' }, r.year + '년분 세액공제 (' + pctTxt(r.band.rate * 100, 0) + ')'), el('span', { class: 'v is-good' }, won(r.credit)),
        el('span', { class: 'sep' }),
        el('span', { class: 'k' }, (r.year + 1) + '년 1년치 월세 (' + won(r.rent) + ' × 12)'), el('span', { class: 'v' }, won(r.annualRent)),
        el('span', { class: 'k strong' }, (r.year + 1) + '년분 세액공제'), el('span', { class: 'v is-good' }, won(r.annual))),
      r.band.rate === 0 ? el('div', { class: 'fn-warn is-bad' }, '총급여 8,000만원 초과면 월세 세액공제를 받을 수 없어요.') : null,
      el('p', { class: 'small muted mb-0' }, P.c.f.newHome.rentOnMoveDay
        ? D.fmt(P.c.move) + '에 첫 월세를 함께 내면 ' + r.year + '년분이 ' + r.dates.length + '번이에요. 계약서대로 후불(' + D.fmt(addMonths(P.c.move, 1)) + ' 첫 지급)이면 ' + Math.max(0, r.dates.length - 1) + '번(' + won(Math.round(Math.min(r.rent * Math.max(0, r.dates.length - 1), 10000000) * r.band.rate)) + ')으로 줄어요.'
        : '계약서대로 후불이면 ' + r.year + '년에는 ' + D.fmt(addMonths(P.c.move, 1)) + ' 한 번만 내요. ' + D.fmt(P.c.move) + '에 함께 내면 2번으로 늘어요.'),
    ];
  }

  function housingOut(P) {
    const h = P.c.housing;
    return [
      el('div', { class: 'fn-kv' },
        el('span', { class: 'k' }, P.c.rentCredit.year + '년 갚는 원금 (' + krw(h.prepaid) + ' + ' + krw(h.repaid - h.prepaid) + ')'), el('span', { class: 'v' }, won(h.repaid)),
        el('span', { class: 'k' }, '× 40% (한도 ' + krw(h.capLeft) + ')'), el('span', { class: 'v' }, won(h.deduction)),
        el('span', { class: 'sep' }),
        el('span', { class: 'k strong' }, '절세액 (한계세율 ' + pctTxt(h.rate * 100, 1) + ')'), el('span', { class: 'v is-good' }, won(h.saving))),
      el('p', { class: 'small muted mb-0' }, '세율 구간에 따라 약 ' + krw(h.low) + ' ~ ' + krw(h.high) + '. 상환증명서가 없으면 못 받으니 꼭 챙기세요.'),
    ];
  }

  function checksList(P, scope, items) {
    const checks = (P.c.f[scope] && P.c.f[scope].checks) || {};
    return el('ul', { class: 'fn-list mt-12' }, items.map((it) => {
      const li = el('li', { class: checks[it.key] ? 'is-done' : '' }, checkbox(it.text, checks[it.key], (v) => {
        li.classList.toggle('is-done', v);
        upd((fin) => { fin[scope].checks = fin[scope].checks || {}; fin[scope].checks[it.key] = v; });
      }, { fk: scope + '-chk-' + it.key }));
      return li;
    }));
  }

  /* ======================= 탭 6: 보증금 지키기 ======================= */
  function tabProtect(P) {
    const rows = P.c.protect.rows;
    const list = el('section', { class: 'card' },
      el('div', { class: 'fn-card-h' }, el('h3', '🛡 새 보증금 ' + eok(num(P.c.f.newHome.deposit)) + ' 지키기'), el('span', { class: 'spacer' }),
        P.live('span', null, () => chip(P.c.protect.doneCount + '/' + P.c.protect.rows.length + ' 완료', P.c.protect.doneCount === P.c.protect.rows.length ? 'good' : ''))),
      el('p', { class: 'small muted' }, '체크리스트에 같은 할 일이 있으면 거기와 연결돼요 (여기서 체크하면 체크리스트도 같이 바뀌어요). ',
        el('a', { href: '#/checklist/money' }, '통장업무 →'), ' · ', el('a', { href: '#/checklist/admin' }, '행정·주소이전 →'), ' · ', guideLink('protect', '보증금 지키기 가이드')),
      rows.map((r) => protectRow(P, r)));
    return el('div', { class: 'fn-panel' }, list);
  }

  function protectRow(P, r) {
    const cur = () => (P.c.protect.byKey && P.c.protect.byKey[r.key]) || r;
    const box = el('div', { class: 'fn-prot fn-anchor' + (r.done ? ' is-done' : ''), id: 'fn-p-' + r.key });
    const cbId = 'fn-pcb-' + r.key;
    const cb = el('input', { type: 'checkbox', id: cbId, checked: !!r.done, 'data-fk': 'prot-' + r.key });
    // 이 줄은 늘 같은 체크리스트 항목 하나만 바꿈 (id 고정 저장) — 같은 일을 하는 11/3 단계도 함께
    cb.addEventListener('change', () => setProtDone(P, cur(), cb.checked, { struct: true }));
    P.bind(() => {
      const d = !!cur().done;
      box.classList.toggle('is-done', d);
      if (cb.checked !== d) cb.checked = d;
    });
    const body = el('div', { class: 'fn-prot-body' }, P.live('p', 'mb-0', () => cur().detail));
    if (r.key === 'report') body.appendChild(reportExtra(P, cur));
    if (r.key === 'hug') body.appendChild(hugExtra(P));
    if (r.key === 'tax') {
      const dd = D.dday(P.c.move);
      body.appendChild(el('div', { class: 'fn-warn' + (dd.n != null && dd.n <= 7 ? ' is-bad' : '') }, '임차인 단독 열람 마감: ' + D.fmtLong(P.c.move) + (dd.n != null ? ' (' + dd.label + ')' : '') + ' — 10월 안에 끝내는 게 안전해요.'));
    }
    const itemLink = (it, more) => el('a', { href: itemHref(it) }, '📋 체크리스트: ' + it.title + (more > 1 ? ' 외 ' + (more - 1) + '개' : '') + ' →');
    body.appendChild(el('div', { class: 'fn-prot-link' },
      r.linked ? itemLink(r.linked, r.linkedCount) : el('button', { class: 'btn btn-sm fn-mini-btn', type: 'button', 'data-fk': 'prot-add-' + r.key, onclick: () => addToChecklist(P, r) }, '+ 체크리스트에 추가'),
      r.key === 'report' && r.follow ? itemLink(r.follow, 1) : null,
      PROT_STEP[r.key] ? el('a', { href: '#/money/flow', onclick: P.tabLink('flow', 'fn-step-' + PROT_STEP[r.key]) }, '🗓 11/3 돈 흐름 단계 →') : null));
    body.appendChild(basis(r.conf, r.key === 'report' ? '부동산거래신고법 제6조의2·제6조의5, 과태료는 2025-06-01 이후 기준(구간표 원문 미확인).' : r.key === 'hug' ? 'HUG 요건(2023-05 개편): 수도권 보증금 7억 이하, (보증금+선순위채권) ≤ 주택가격의 90%.' : r.key === 'tax' ? '국세징수법 제109조(2023-04-01), 주임법 제3조의7(2023-04-18).' : '리서치 검증본.', r.links,
      r.key === 'hug' ? 'HUG에 확인' : r.key === 'tax' || r.key === 'report' ? '주민센터·세무서에 확인' : '주민센터·관리사무소에 확인'));
    box.append(el('label', { class: 'fn-prot-cb', title: r.title }, cb),
      el('div', { class: 'fn-prot-title' }, el('label', { for: cbId }, r.title),
        P.live('span', 'fn-prot-chips', () => {
          const x = cur();
          // 신고기한이 이미 지났으면 'D-1' 같은 할 일 기한 대신 '기한 지남 · 바로 확인'
          if (x.key === 'report' && !x.done && x.overDays > 0) return chip('신고기한 ' + D.fmt(x.deadline) + ' 지남 · 바로 확인', 'bad');
          return [MV.ui.dueChip(x.due, x.done), x.urgent && !x.done ? chip('긴급', 'bad') : null];
        })),
      body);
    return box;
  }

  function reportExtra(P, cur) {
    const f = P.c.f;
    const state = el('label', { class: 'field' }, el('span', '신고 상태'));
    const sel = el('select', { class: 'select', 'data-fk': 'p-report-state' },
      [['unknown', '모름 — 확인 필요'], ['checked', '확인함 — 결과를 골라 주세요'], ['done', '신고돼 있음 (신고필증 확인)'], ['late', '안 돼 있었음 → 지금 신고함']].map(([v, l]) => el('option', { value: v, selected: v === cur().reportState }, l)));
    const optChecked = sel.querySelector('option[value="checked"]');
    sel.addEventListener('change', () => setReportState(P, sel.value));
    const hint = el('small', { class: 'hint' });
    state.append(sel, hint);
    P.bind(() => {
      const want = cur().reportState || 'unknown';
      optChecked.hidden = want !== 'checked';
      if (sel.value !== want && document.activeElement !== sel) sel.value = want;
      hint.textContent = want === 'checked'
        ? '결과를 고르면 "[신고 안 됐으면] 바로 신고하기" 항목도 같이 정리돼요'
        : '고르면 체크리스트의 신고 확인 항목도 같이 바뀌어요';
      hint.classList.toggle('fn-warn-hint', want === 'checked');
    });
    return el('div', { class: 'fn-step-body' },
      P.live('div', 'fn-kv', () => {
        const x = cur();
        const over = x.overDays;
        return [
          el('span', { class: 'k' }, '계약일 → 법정 신고기한'), el('span', { class: 'v' }, D.fmt(x.contractDate) + ' → ' + D.fmt(x.deadline)),
          el('span', { class: 'k' }, '오늘 기준'), el('span', { class: 'v ' + (over > 0 && !x.done ? 'is-bad' : '') }, over > 0 ? over + '일 지남' : over === 0 ? '오늘까지' : 'D-' + (-over)),
          el('span', { class: 'k' }, '과태료 (지연신고)'), el('span', { class: 'v' }, '약 2만~30만원'),
          el('span', { class: 'k' }, '거짓신고'), el('span', { class: 'v' }, '100만원'),
        ];
      }),
      el('div', { class: 'fn-fields' },
        dateField('새 집 계약일', f.newHome.contractDate, (v) => upd((fin) => { fin.newHome.contractDate = D.valid(v) ? v : '2026-07-13'; }), { fk: 'p-contract-date', hint: '계약서의 계약일 — 신고기한(30일)이 여기서 계산돼요' }),
        state),
      el('ul', { class: 'fn-ul small' },
        el('li', '확인: 중개사와 C에게 신고필증 사본을 요청 (신고됐다면 확정일자 부여일도)'),
        el('li', '안 됐으면: 주민센터나 부동산거래관리시스템(rtms)에서 양쪽 서명 계약서를 첨부해 바로 신고 — 지연기간이 짧을수록 과태료가 낮아요'),
        el('li', '과태료는 임대인·임차인 모두에게 나올 수 있으니 C와 함께 정리'),
        el('li', '전입신고 때 계약서를 내면 신고로 간주되지만, 그때까지 지연기간만 길어져요')),
      guideLink('report', '임대차 신고 가이드'));
  }

  function hugExtra(P) {
    const f = P.c.f;
    const hugLine = f.budget.lines.find((l) => l.id === 'hug');
    return el('div', { class: 'fn-step-body' },
      el('div', { class: 'fn-fields' },
        selectField('보증료율 (아파트)', String(f.protect.hugRate), HUG_RATES.map(([v, l]) => [String(v), l]), (v) => upd((fin) => { fin.protect.hugRate = +v; }), { fk: 'p-hug-rate' }),
        numField('보증 기간', f.protect.hugYears, (v) => upd((fin) => { fin.protect.hugYears = v; }), { suffix: '년', min: 1, max: 4, fk: 'p-hug-years' })),
      P.live('div', 'fn-total', () => {
        const h = hugPremium(P.c.f);
        return [el('span', '예상 보증료'), el('b', won(h.value)), el('span', { class: 'fn-formula' }, '범위 ' + won(h.low) + ' ~ ' + won(h.high))];
      }),
      hugLine ? checkbox('가입 예정 — 예산에 보증료 넣기', hugLine.on !== false, (v) => upd((fin) => { const x = fin.budget.lines.find((l) => l.id === 'hug'); if (x) x.on = v; }), { fk: 'p-hug-on' }) : null,
      el('ul', { class: 'fn-ul small' },
        el('li', '요건: 수도권 보증금 7억 이하, (보증금 + 선순위채권)이 시세의 90% 이하 — 59㎡ 아파트·보증금 3.2억이면 큰 근저당만 없으면 가능성이 높아요'),
        el('li', '가입하면 HUG가 임대인 C에게 보증금 반환채권 양도를 통지해요. 동의는 필요 없지만, 멀리 사는 C가 놀라지 않게 중개사를 통해 미리 알려 두세요'),
        el('li', 'HF 전세지킴보증, SGI 상품과 보증료·조건을 비교해 보세요')));
  }

  function addToChecklist(P, r) {
    const partOk = MV.parts.get(r.part);
    const part = partOk ? r.part : ((MV.parts.list()[0] || {}).id || '');
    const wasDone = !!r.done;
    const it = MV.items.add({ partId: part, title: r.title, detail: r.detail, due: r.due, priority: r.urgent ? 'high' : r.conf === 'low' ? 'low' : 'high', owner: '나', done: wasDone, doneAt: wasDone ? MV.nowISO() : null });
    updStruct((fin) => { if (!fin.links || typeof fin.links !== 'object') fin.links = {}; fin.links['prot-' + r.key] = it.id; });
    MV.ui.toast('체크리스트에 추가했어요', { action: { label: '보기', onClick: () => MV.go('#/checklist/' + encodeURIComponent(it.partId || '_') + '/' + encodeURIComponent(it.id)) } });
  }

  /* ======================= 기본값 · 당일 시트 ======================= */
  function resetAll(P) {
    MV.ui.confirm('자금흐름 화면의 숫자·체크·메모·연락처를 모두 처음 값으로 되돌릴까요? (체크리스트·짐 목록은 그대로예요)', { okLabel: '기본값으로', danger: true }).then((ok) => {
      if (!ok) return;
      updStruct((fin) => {
        const d = defaults();
        Object.keys(fin).forEach((k) => { delete fin[k]; });
        Object.assign(fin, d);
      }, { log: '자금흐름 값을 기본값으로 되돌렸어요' });
      MV.ui.toast('기본값으로 되돌렸어요');
    });
  }

  function printMode(on) {
    document.body.classList.toggle('fn-print-mode', !!on);
    document.documentElement.classList.toggle('fn-print-mode', !!on);
  }
  function openSheet(P) {
    if (P.sheet) { try { P.sheet.close(); } catch (e) { /* 무시 */ } }
    P.c = compute(MV.store.get()); // 조용히 저장된 메모·연락처까지 반영
    printMode(true);
    const body = el('div', { class: 'fn-sheet' }, sheetContent(P));
    P.sheet = MV.ui.modal({
      title: D.fmtLong(P.c.move) + ' 당일 시트',
      body, wide: true,
      actions: [
        { label: '닫기', kind: 'ghost' },
        { label: '🖨 인쇄하기', kind: 'primary', onClick: () => { try { window.print(); } catch (e) { /* 무시 */ } return false; } },
      ],
      onClose: () => { printMode(false); P.sheet = null; },
    });
  }

  function sheetContent(P) {
    const c = P.c, fl = c.flow, f = c.f;
    const memo = f.flow.memo || {};
    const rows = fl.steps.map((s) => {
      const cb = el('input', { type: 'checkbox', checked: !!s.done, 'aria-label': stepTitle(s.id, c) + ' 완료' });
      cb.addEventListener('change', () => setStepDone(P, s.id, cb.checked));
      const extra = [];
      if (s.splitN > 1) extra.push(timesTxt(s.splitN) + ' 나눠: ' + splitSummary(s.split));
      if (memo[s.id]) extra.push('계좌: ' + memo[s.id]);
      if (s.id === 'recv') extra.push('잔액으로 확인한 뒤에만 열쇠 인계');
      if (s.id === 'toC') extra.push('계약서 특약의 C 본인 계좌만 · 잔금/월세 나눈 영수증');
      if (s.id === 'broker') extra.push('현금영수증 확인');
      if (s.id === 'bank') extra.push('완제확인서 · 상환증명서 받기');
      if (s.id === 'registry') extra.push('소유자 C · 새 근저당·가압류·신탁 없음');
      return el('label', { class: 'fn-sheet-row' },
        cb,
        el('span', { class: 'fn-sheet-time' }, s.time || '—'),
        el('span', { class: 'fn-sheet-what' }, el('b', stepWho(s.id) + ' · ' + stepTitle(s.id, c)), extra.map((t) => el('small', t))),
        s.amount != null
          ? el('span', { class: 'fn-sheet-amt' }, s.kind === 'in' ? signedWon(s.amount) : s.kind === 'out' ? signedWon(-s.amount) : won(Math.abs(s.amount)), s.kind !== 'ext' ? el('small', '잔액 ' + won(s.balance)) : el('small', '내 통장 변화 없음'))
          : el('span', { class: 'fn-sheet-amt' }, ''));
    });
    const ct = f.contacts || {};
    const CT = [['A', '구집 임대인 A'], ['C', '새 집 임대인 C'], ['broker', '새 집 중개사'], ['oldBroker', '구집 중개사'], ['bank', '우리은행'], ['mover', '이사업체']];
    return [
      el('p', { class: 'small muted fn-no-print' }, '체크하면 자금흐름 화면에도 바로 반영돼요. "인쇄하기"로 종이에 뽑아 들고 다니세요.'),
      el('div', { class: 'fn-sheet-sum' },
        el('div', null, el('span', '받을 돈'), el('b', won(fl.inflow))),
        el('div', null, el('span', '보낼 돈'), el('b', won(fl.outflow))),
        el('div', null, el('span', '남는 돈'), el('b', won(fl.leftover)))),
      el('p', { class: 'small mb-0' }, el('b', '대출 상환 방식: '), fl.direct ? '질권 있음 — A가 은행에 직접 상환' : f.loan.lien === 'none' ? '질권 없음(은행 확인) — 내가 직접 완제' : '질권 확인 전 — 내가 직접 완제로 가정'),
      el('h3', '순서'),
      rows,
      el('h3', '멈춤 규칙'),
      el('ul', { class: 'fn-ul small' },
        el('li', eok(fl.inflow) + (fl.direct ? '(은행 직접 상환 뒤 나머지)' : '') + '이 잔액으로 확인되기 전에는 열쇠·비밀번호를 넘기지 않기 (전입도 그대로)'),
        el('li', '등기부에 새 근저당·가압류·신탁이 보이면 송금을 멈추고 중개사와 확인'),
        el('li', '계좌를 바꾸자는 연락 → 무조건 멈추고 C와 직접 통화'),
        el('li', '이체가 보류되면 은행 콜센터, 앱이 막히면 창구 (평일 09~16시)'),
        el('li', 'A 돈이 늦으면: 열쇠 미인도 · 전입 유지 · C와 미리 합의한 대기시간 확인')),
      el('h3', '연락처'),
      el('div', { class: 'fn-sheet-contacts' }, CT.map(([k, l]) => el('div', null, el('b', l + ': '), ct[k] ? ct[k] : '________________'))),
    ];
  }

  /* ======================= 등록 ======================= */
  MV.view('money', {
    title: '자금흐름', short: '자금', icon: '💰', order: 50,
    badge() {
      try {
        const c = compute(MV.store.get());
        return c.alerts.filter((a) => a.overdue).length;
      } catch (e) { return 0; }
    },
    render,
  });
})();
