/* ============================================================
   우리집 이사 관리 — 짐·견적
   짐 목록(MV.inv, 도면 배치 화면과 같은 데이터) + 자동 이사 견적 + 업체 견적 비교 + 가전 이전 비교

   라우트
     #/stuff              → #/stuff/inventory 로 바꿔 보여 줌
     #/stuff/inventory    짐 목록 (요약·필터·표/카드·제조사·옮기는 곳·붙여넣기·업체용 목록)
     #/stuff/estimate     이사 견적 (입력 → 부피 → 톤수·인원 → 금액 범위, 계산 기준 수정)
     #/stuff/quotes       업체 견적 비교 + '견적으로 보정'
     #/stuff/lg           가전 이전 비교 (가전마다 제조사 서비스(LG 또는 삼성) vs 이삿짐센터, 우리 집 계획)

   제조사 서비스: 짐의 lg = true 는 ‘제조사 서비스로 옮김’ (이름은 호환 때문에 그대로).
     제조사 = it.brand('LG'|'삼성'|'기타') → 없으면 이름·링크로 짐작 (brandOf).
     LG → LG 베스트케어 이전설치 / 삼성 → 삼성전자서비스(에어컨·건조기만 요금 조사됨) /
     기타·창문형 에어컨·요금 미조사 삼성 가전 → 이삿짐센터 짐으로 계산 (lgBlocked).

   상태  MV.store.ensure('estimate') → {
           coef:   { 모든 계수 },                 // '기준값으로 되돌리기' 가능
           inputs: { 이사 조건 },
           quotes: [{ id, company, amount, vatIncluded, tons, crew, ladder, aircon, arrange, waste,
                      deposit, date, note, licenseChecked, insuranceChecked, visitDone }],
           calib:  { factor, at, median, n, base, sig }, // 방문견적 중앙값 보정 (factor 1 = 보정 없음, sig = 보정에 쓴 견적 서명)
           lgChecks: { schedule, landlord, brand } }
   계산  MV.calc.moveEstimate(state) → { tons, crew, volume, low, typical, high,
           lines:[{key,label,low,typical,high,detail}], notes:[],
           lgCost: 제조사 서비스(LG + 삼성) 전체 {low,typical,high,count,rows,discount,transport,label,makers,
                   byBrand:{ LG:{low,typical,high,count}, '삼성':{low,typical,high,count} }, vatIncluded:true} | null
                   (이름은 호환 때문에 lgCost — 자금·대시보드·AI 비서가 lgCost.typical/low/high/count 를 읽음)
           makerCost,                     // lgCost 와 같은 객체 (새 이름)
           vatIncl,                       // low/typical/high 가 부가세 포함인지 (‘부가세 포함으로 보기’, 기본 꺼짐 = 리서치 시세 그대로 부가세 별도)
           ex:{low,typical,high},         // 이삿짐센터 부가세 별도 금액 (언제나 별도 — 화면의 보조 숫자)
           lgBlocked:[{id,name,reason}],  // 제조사 서비스 표시가 켜져 있지만 맡길 수 없어(reason 'brand'|'window'|'unpriced') 이삿짐센터 짐으로 계산한 가전
           pay:{low,typical,high},        // 이삿짐센터 ‘실제로 낼 돈’ (언제나 부가세 포함)
           totalPay:{low,typical,high},   // pay + 제조사 서비스 요금(소비자가, 부가세 포함) — 둘을 더할 땐 이 값
           ... }
         순수 함수 — state.inventory + state.estimate 만 읽고, estimate 가 없으면 기본값으로 계산.

   계수 기본값·근거·신뢰도: 리서치 검증본 (movers_verified.json · appliances2_verified.json, 2026-10-06)
             + Gemini(구글 검색) 교차 확인 (gemini_moving-costs.json · gemini_appliances.json).
   견적 모델: V = Σ짐 부피 + 박스×0.07 → T = V÷5 +5% → 차량 등급 {1,2.5,3.5,5,6,7.5,8.5,10}
             → 인원표 → 본비 = 톤×8만 + 인원×21만 → 할증(본비에만) + 부대비 → 기준가, 하한×0.85, 상한×1.25
   CSS 접두사: es-
   ============================================================ */
(function () {
  'use strict';
  const el = MV.el;
  const D = MV.date;
  const F = MV.fmt;

  /* ======================= 작은 도우미 ======================= */
  const isNum = (n) => typeof n === 'number' && isFinite(n);
  const num = (v, d) => { const n = typeof v === 'number' ? v : parseFloat(v); return isFinite(n) ? n : d; };
  /* 수량 상한 — 99999999 같은 값이 들어와도 부피·톤수·LG 대수가 터무니없이 커지지 않게 (입력칸도 같은 상한) */
  const QTY_MAX = 999;
  const qtyOf = (it) => Math.min(QTY_MAX, Math.max(0, Math.round(num(it && it.qty, 0))));
  const r1 = (n) => Math.round(n * 10) / 10;
  const r2 = (n) => Math.round(n * 100) / 100;
  const sum = (arr, f) => arr.reduce((s, x) => s + (f ? f(x) : x), 0);
  const m3 = (n) => (isNum(n) ? r1(n).toFixed(1) : '-') + '㎥';
  const won = (n) => F.krw(Math.round(num(n, 0)));
  const tonsLabel = (t) => (Number.isInteger(t) ? String(t) : String(r1(t))) + '톤';
  const crewLabel = (c) => (!isNum(c) ? '-' : Number.isInteger(c) ? c + '명' : Math.floor(c) + '~' + Math.ceil(c) + '명');
  /* 줄여 보이기: 낱말 중간(예: 'URL' → 'UR…')에서 자르지 않고 띄어쓰기·가운뎃점·쉼표 같은 경계에서 잘라요.
     경계가 너무 앞(절반 미만)이면 글자 단위로 자르되, 끝에 걸친 영문·숫자 덩어리는 통째로 빼요 */
  const clip = (s, n) => {
    s = String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
    if (s.length <= n) return s;
    let cut = s.slice(0, n - 1);
    if (!/[\s·,.;:!?)\]]/.test(s.charAt(n - 1))) {
      const m = cut.match(/^(.*)[\s·,;:\/(\[]/);
      if (m && m[1].length >= Math.floor(n / 2)) cut = m[1];
      else cut = cut.replace(/[A-Za-z0-9.]+$/, '') || cut;
    }
    return cut.replace(/[\s·,;:\/(\[\-–—.]+$/, '') + '…';
  };
  const normDate = (s) => (D.valid(s) ? D.str(D.parse(s)) : null);
  const median = (arr) => {
    const a = arr.filter(isNum).sort((x, y) => x - y);
    if (!a.length) return null;
    const m = a.length >> 1;
    return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
  };
  function safeUrl(u) {
    u = String(u || '').trim();
    if (!u) return null;
    if (/^https?:\/\//i.test(u)) return u;
    if (/^[\w-]+(\.[\w-]+)+(\/|$)/i.test(u)) return 'https://' + u;
    return null;
  }
  const isTyping = (a) => !!a && ((a.tagName === 'INPUT' && !/^(checkbox|radio|button|submit|reset|range|file|color)$/i.test(a.type || '')) || a.tagName === 'TEXTAREA' || a.isContentEditable);
  /* 조사 붙이기: josa('4만원', '은/는') → '4만원은', josa('6톤', '으로/로') → '6톤으로'.
     끝 글자가 숫자면 한국어로 읽은 소리(영·일·이·삼…)로 받침을 판단해요. */
  function josa(word, pair) {
    const w = String(word == null ? '' : word);
    const s = w.replace(/\s*\([^)]*\)\s*$/, '').replace(/[\s'"’”)\]…]+$/, '');
    const ch = s.charAt(s.length - 1);
    const code = ch ? ch.charCodeAt(0) : 0;
    let bat = false; let rieul = false;
    if (code >= 0xAC00 && code <= 0xD7A3) { const j = (code - 0xAC00) % 28; bat = j !== 0; rieul = j === 8; }
    else if (/[0-9]/.test(ch)) { bat = '013678'.includes(ch); rieul = '178'.includes(ch); }
    else if (/[lmnr]/i.test(ch)) { bat = true; rieul = /[lr]/i.test(ch); }
    const [a, b] = String(pair).split('/');
    if (a === '으로') return w + (bat && !rieul ? '으로' : '로');
    return w + (bat ? a : b);
  }
  /* 토스트: core 의 .toast-wrap 이 화면 가운데(left 50%)에 붙어 폭이 반쪽만 남는 탓에 폰에서 '되돌리기'가 두 줄로 꺾여요.
     이 모듈 토스트에만 es-toast 를 붙여 내용 폭만큼 펼치고(최대 화면 폭 − 32px) 버튼은 한 줄로 둡니다. */
  function toast(msg, o) {
    const t = MV.ui.toast(msg, o);
    try { if (t && t.classList) t.classList.add('es-toast'); } catch (e) { /* 무시 */ }
    return t;
  }

  /* ======================= 출처 ======================= */
  const SRC = {
    daum: { label: '2025 포장이사 시세 정리 (다음)', url: 'https://v.daum.net/v/4ul7Nh7vM6' },
    misoCost: { label: '포장이사 비용 (미소)', url: 'https://miso.kr/blog/포장이사-비용' },
    misoSize: { label: '평수별 포장이사 (미소)', url: 'https://miso.kr/blog/포장이사-평수별' },
    ladder: { label: '2025 사다리차 요금표 (아정당)', url: 'https://www.ajd.co.kr/contents/basic-tip/detail/%ED%8F%AC%EC%9E%A5%EC%9D%B4%EC%82%AC_%EC%82%AC%EB%8B%A4%EB%A6%AC%EC%B0%A8_%EB%B9%84%EC%9A%A9_%EC%9A%94%EA%B8%88%ED%91%9C_%ED%95%9C%EB%88%88%EC%97%90_%EB%B3%B4%EA%B8%B0_%EC%89%BD%EA%B2%8C-47059' },
    elev: { label: '사다리차와 엘리베이터 비교 (아정당)', url: 'https://www.ajd.co.kr/contents/basic-tip/detail/이사_사다리차_비용_엘리베이터_사용료_견적_장단점_총정리-92583' },
    soomgo: { label: '에어컨 이전설치 공시가 (숨고 ①)', url: 'https://soomgo.com/profile/users/4199268' },
    soomgo2: { label: '에어컨 이전설치 공시가 (숨고 ②)', url: 'https://soomgo.com/profile/users/6304368' },
    lunar: { label: '한국천문연구원 음력 자료 기준 계산 도구', url: 'https://pypi.org/project/korean-lunar-calendar/' },
    lunarDay: { label: '2026-11-03 음력 확인', url: 'https://datedb.net/calendar/day/20261103/' },
    terms: { label: '이사화물 표준약관 요약 (한국경제)', url: 'https://www.hankyung.com/amp/2002091120971' },
    kca: { label: '소비자원 이사 피해 통계 (경북매일)', url: 'https://kbmaeil.com/article/202412110413641' },
    herald: { label: '이사 추가요금 피해 (헤럴드)', url: 'https://www.heraldk.com/article/2026042021315151980' },
    jjan: { label: '이사업체 자격 확인 (전북일보)', url: 'https://www.jjan.kr/articleAmp/20160301575127' },
    lgCare: { label: 'LG 베스트케어 이전설치', url: 'https://www.lge.co.kr/lg-best-care/service-installation-removal' },
    lgRelease: { label: 'LG 베스트케어 보도자료', url: 'https://www.lg.co.kr/media/release/25552' },
    lxPrice: { label: '판토스(LG 물류 협력사) 이전설치 요금표', url: 'https://move.lxpantos.com/mvinst/priceTable.jsp' },
    lxSvc: { label: '판토스(LG 물류 협력사) LG 가전 설치 안내', url: 'https://www.lxpantos.com/kr/lg-electronics-installation.do' },
    lgAc: { label: 'LG 에어컨 이전설치 요금 (2025-11 기준 정리)', url: 'https://tilnote.io/pages/6a43ec7788a337ba183160e3' },
    ewaste: { label: '폐가전 무상방문수거 1599-0903', url: 'https://www.15990903.or.kr' },
    ssAc: { label: '삼성케어플러스 에어컨 이전설치', url: 'https://www.samsung.com/sec/samsung-care-plus/move-out-ac/AC-TCMACMUU/' },
    ssDryer: { label: '삼성케어플러스 건조기 이전설치', url: 'https://www.samsung.com/sec/samsung-care-plus/move-out-dv/DV-TCMDYSTU/' },
    ssSvc: { label: '삼성전자서비스 이전설치 안내', url: 'https://www.samsungsvc.co.kr/solution/131652' },
    ssPrice: { label: '삼성 에어컨 단가표 정리 (2026-05)', url: 'https://tilnote.io/pages/6a373074478fbed2736ab47c' },
    ssSoomgo: { label: '삼성 에어컨 이전설치 비용 항목 (숨고)', url: 'https://soomgo.com/blog/install-repair/삼성전자에어컨이전설치/' },
    ac2026: { label: '2026 에어컨 이전설치 비용 (숨고)', url: 'https://soomgo.com/blog/install-repair/2026-최신-버전-에어컨-이전-설치-비용의-모든-것/' },
    miso24: { label: '24평 이사비용 (미소)', url: 'https://miso.kr/blog/24평-이사비용' },
    misoDay: { label: '이사비용 저렴한 날 (미소)', url: 'https://miso.kr/blog/이사비용-저렴한날' },
    jpt: { label: '2026 이사비용 정리', url: 'https://www.jptcalc.kr/blog/posts/moving-cost-guide.html' },
    seoulElev: { label: '아파트 승강기 사용료 공개 (서울시)', url: 'https://mediahub.seoul.go.kr/archives/1215461' },
    openapt: { label: '서울시 공동주택 통합정보마당', url: 'https://openapt.seoul.go.kr' },
  };

  /* ======================= 계수 (리서치 근거) =======================
     conf: high 높음 / mid 중간 / low 낮음 — 리서치 검증본의 신뢰도 표기를 따름 */
  const GROUPS = [
    { id: 'base', title: '기본 요금 (본비)', icon: '🚚' },
    { id: 'vol', title: '짐 부피 → 톤수', icon: '📦' },
    { id: 'pack', title: '분류별 적재 계수 (상자 부피 → 트럭 자리)', icon: '🧩' },
    { id: 'crew', title: '차량 등급별 작업 인원', icon: '👷' },
    { id: 'date', title: '날짜 할증 (본비에만 붙음)', icon: '📅' },
    { id: 'lift', title: '사다리차 · 엘리베이터', icon: '🏗️' },
    { id: 'ac', title: '에어컨 이전 (이삿짐센터 협력 기사)', icon: '❄️' },
    { id: 'extra', title: '추가 작업', icon: '🛠️' },
    { id: 'range', title: '범위 · 부가세 · 계약금', icon: '📏' },
    { id: 'lg', title: 'LG 베스트케어 이전설치', icon: '🔌' },
  ];
  const COEFS = [
    // 기본 요금
    { k: 'base_per_ton', g: 'base', label: '본비: 차량·연료·포장재 (톤당)', unit: '원/톤', v: 80000, lo: 70000, hi: 110000, money: true, conf: 'low', basis: '2025 온라인 시세에 맞춘 보정 계수 (근거 약함)', src: ['daum'] },
    { k: 'crew_day_rate', g: 'base', label: '작업 인원 1명 일당 (고객 청구 기준)', unit: '원/명', v: 210000, lo: 180000, hi: 270000, money: true, conf: 'low', basis: '업계 통상치 추정, 출처 없음', src: [] },
    { k: 'half_pct', g: 'base', label: '반포장이사 요금 (포장이사 대비)', unit: '%', v: 85, conf: 'low', basis: '리서치에 없음 — 짐 풀기·정리를 직접 하는 만큼 인건비가 줄어듦 (통상 80~90% 추정)', src: [] },
    { k: 'general_pct', g: 'base', label: '일반이사 요금 (포장이사 대비)', unit: '%', v: 65, conf: 'low', basis: '리서치에 없음 — 포장·정리를 모두 직접 (통상 60~70% 추정)', src: [] },
    { k: 'free_km', g: 'base', label: '거리 추가 없는 기본 거리', unit: 'km', v: 20, conf: 'low', basis: '리서치: 1km 이동은 운송비 영향이 거의 없음. 시내 기본 거리는 추정', src: ['misoCost'] },
    { k: 'per_km', g: 'base', label: '기본 거리 넘는 1km당', unit: '원/km', v: 3000, money: true, conf: 'low', basis: '리서치에 없음 (장거리 요율 미조사) — 추정', src: [] },
    // 부피
    { k: 'm3_per_ton', g: 'vol', label: '1톤에 싣는 실제 짐 부피', unit: '㎥/톤', v: 5, lo: 4.5, hi: 6, step: 0.1, conf: 'low', basis: '리서치 추정 (출처 없음). 22.1㎥ ÷ 5 = 4.4톤 → 5톤 계산에 사용', src: ['misoSize'] },
    { k: 'truck_margin', g: 'vol', label: '톤수 여유분', unit: '%', v: 5, conf: 'low', basis: '리서치 견적 모델: 필요 톤수에 5%를 더해 위 등급 차량으로 올림', src: [] },
    { k: 'm3_per_box', g: 'vol', label: '이사 박스 1개 부피', unit: '㎥', v: 0.07, lo: 0.06, hi: 0.085, step: 0.005, conf: 'low', basis: '이사 바구니 약 60×40×35cm, 우체국 5호(0.062㎥) 기준 추정', src: [] },
    { k: 'boxes_typical', g: 'vol', label: '3인 가족·24평 기준 박스 수', unit: '개', v: 90, lo: 70, hi: 120, conf: 'low', basis: '리서치 추정. 붙박이장 옷이 박스로 바뀌면 +20~30개', src: ['misoSize'] },
    { k: 'box_person_pct', g: 'vol', label: '가구원 1명당 박스 증감', unit: '%', v: 12, conf: 'low', basis: '리서치에 없음 — 3인 기준에서 1명 늘거나 줄 때의 증감 (추정)', src: [] },
    { k: 'misc_m3', g: 'vol', label: '짐 목록에 없는 잡동사니', unit: '㎥', v: 1.5, step: 0.1, conf: 'low', basis: '리서치 품목표의 "기타 1.5㎥" (청소기·화분·자전거·이불 등)', src: [] },
    { k: 'ac_outdoor_m3', g: 'vol', label: '에어컨 실외기 부피 (대당)', unit: '㎥', v: 0.3, step: 0.05, conf: 'low', basis: '리서치: 스탠드 실내기 0.4㎥ + 실외기 0.3㎥', src: [] },
    // 분류별 적재 계수
    { k: 'pack_bed', g: 'pack', label: '침대·매트리스', unit: '배', v: 1.35, step: 0.05, conf: 'low', basis: '퀸 침대 1.8㎥ ÷ 규격 상자 1.34㎥ ≈ 1.34, 슈퍼싱글 1.3 ÷ 0.92 ≈ 1.41 (헤드·프레임 몫)', src: [] },
    { k: 'pack_sofa', g: 'pack', label: '소파·의자', unit: '배', v: 1.25, step: 0.05, conf: 'low', basis: '3인 소파 2.0㎥ ÷ 규격 상자(210×90×85) 1.61㎥ ≈ 1.24', src: [] },
    { k: 'pack_table', g: 'pack', label: '책상·식탁', unit: '배', v: 1.3, step: 0.05, conf: 'low', basis: '4인 식탁+의자 1.2㎥ ÷ 0.84㎥ ≈ 1.43, 책상 0.6 ÷ 0.53 ≈ 1.14의 중간', src: [] },
    { k: 'pack_shelf', g: 'pack', label: '책장·선반', unit: '배', v: 1.05, step: 0.05, conf: 'low', basis: '책장 0.45㎥ ÷ 규격 상자(80×30×180) 0.43㎥ ≈ 1.04', src: [] },
    { k: 'pack_storage', g: 'pack', label: '옷장·수납장', unit: '배', v: 1, step: 0.05, conf: 'low', basis: '옷장 폭 1m당 1.3㎥ ≈ 규격 상자(100×60×220) 1.32㎥ 그대로', src: [] },
    { k: 'pack_appliance', g: 'pack', label: '대형가전', unit: '배', v: 1.05, step: 0.05, conf: 'low', basis: '양문형 냉장고 1.6㎥ ÷ 1.50㎥ ≈ 1.07, 건조기 0.5 ÷ 0.53 ≈ 0.95', src: [] },
    { k: 'pack_aircon', g: 'pack', label: '에어컨 (실내기)', unit: '배', v: 1.1, step: 0.05, conf: 'low', basis: '스탠드 실내기 0.4㎥ ÷ 규격 상자(50×40×180) 0.36㎥ ≈ 1.1 — 실외기는 따로 더함', src: [] },
    { k: 'pack_electronics', g: 'pack', label: 'TV·전자기기', unit: '배', v: 1.5, step: 0.05, conf: 'low', basis: 'TV는 세워서 완충 포장해 자리를 더 차지 (리서치 "TV와 거실장 0.9㎥" 참고, 추정)', src: [] },
    { k: 'pack_kids', g: 'pack', label: '아이 물건', unit: '배', v: 1.2, step: 0.05, conf: 'low', basis: '리서치에 없음 — 모양이 불규칙한 아이 가구·장난감 (추정)', src: [] },
    { k: 'pack_misc', g: 'pack', label: '기타', unit: '배', v: 1, step: 0.05, conf: 'low', basis: '보정 없음 (규격 상자 부피 그대로)', src: [] },
    // 인원표
    { k: 'crew_1', g: 'crew', label: '1톤', unit: '명', v: 2, step: 0.5, conf: 'low', basis: '리서치 견적 모델 인원표', src: [] },
    { k: 'crew_2_5', g: 'crew', label: '2.5톤', unit: '명', v: 3, step: 0.5, conf: 'low', basis: '리서치 견적 모델 인원표 (2.5톤 3명)', src: [] },
    { k: 'crew_3_5', g: 'crew', label: '3.5톤', unit: '명', v: 3.5, step: 0.5, conf: 'low', basis: '리서치 견적 모델 인원표 (3~4명)', src: [] },
    { k: 'crew_5', g: 'crew', label: '5톤', unit: '명', v: 4.5, lo: 4, hi: 5, step: 0.5, conf: 'mid', basis: '20평대 3인 가족 통상 4~5명', src: ['misoSize'] },
    { k: 'crew_6', g: 'crew', label: '6톤', unit: '명', v: 5, step: 0.5, conf: 'low', basis: '리서치 견적 모델 인원표 (6톤 5명)', src: [] },
    { k: 'crew_7_5', g: 'crew', label: '7.5톤', unit: '명', v: 6, step: 0.5, conf: 'low', basis: '리서치 견적 모델 인원표 (7.5톤 6명)', src: [] },
    { k: 'crew_8_5', g: 'crew', label: '8.5톤', unit: '명', v: 6.5, step: 0.5, conf: 'low', basis: '리서치 견적 모델 인원표', src: [] },
    { k: 'crew_10', g: 'crew', label: '10톤', unit: '명', v: 7, step: 0.5, conf: 'low', basis: '리서치 견적 모델 인원표', src: [] },
    // 날짜 할증
    { k: 'sohn_pct', g: 'date', label: '손없는날 할증', unit: '%', v: 20, lo: 10, hi: 30, conf: 'low', basis: '업계 통상치. 11/3은 손없는날이 아니라 해당 없음', src: [] },
    { k: 'weekend_pct', g: 'date', label: '주말·공휴일 할증', unit: '%', v: 15, lo: 10, hi: 20, conf: 'low', basis: '업계 통상치. 11/3은 화요일이라 해당 없음', src: [] },
    { k: 'month_end_pct', g: 'date', label: '월말 할증 (그달 마지막 5일)', unit: '%', v: 10, lo: 5, hi: 20, conf: 'low', basis: '추정', src: [] },
    { k: 'month_start_pct', g: 'date', label: '월초 할증 (1~5일)', unit: '%', v: 5, lo: 0, hi: 10, conf: 'low', basis: '추정 (출처 없는 업계 통상치). 11/3은 월초라 적용', src: [] },
    { k: 'multi_add_pct', g: 'date', label: '할증이 겹칠 때 더하는 몫', unit: '%포인트', v: 5, conf: 'low', basis: '리서치 모델: 여러 개가 겹치면 가장 큰 할증에 5%포인트를 더함', src: [] },
    // 사다리차·엘리베이터
    { k: 'ladder_f2', g: 'lift', label: '사다리차 2~5층 (5톤 기준)', unit: '원/회', v: 150000, lo: 100000, hi: 180000, money: true, conf: 'mid', basis: '2025 요금표 2~5층 15만원 (원문 재확인 못 함)', src: ['ladder'] },
    { k: 'ladder_f6', g: 'lift', label: '사다리차 6~9층', unit: '원/회', v: 165000, money: true, conf: 'low', basis: '요금표 5층(15만)과 10층(18만) 사이 보간 (추정)', src: ['ladder'] },
    { k: 'ladder_f10', g: 'lift', label: '사다리차 10~12층', unit: '원/회', v: 180000, money: true, conf: 'mid', basis: '2025 요금표 10~11층 18만원', src: ['ladder'] },
    { k: 'ladder_f13', g: 'lift', label: '사다리차 13~15층', unit: '원/회', v: 210000, lo: 200000, hi: 300000, money: true, conf: 'mid', basis: '2025 요금표 15층·5톤 21만원. 새 집 동 앞에 사다리차를 세울 수 있는지는 아직 미확인', src: ['ladder'] },
    { k: 'ladder_f16', g: 'lift', label: '사다리차 16~20층', unit: '원/회', v: 280000, money: true, conf: 'mid', basis: '2025 요금표 20층 28만원', src: ['ladder'] },
    { k: 'ladder_f21', g: 'lift', label: '사다리차 21층 이상', unit: '원/회', v: 400000, money: true, conf: 'mid', basis: '2025 요금표 24층 약 40만원', src: ['ladder'] },
    { k: 'ladder_step', g: 'lift', label: '5톤 넘는 차량 등급마다 추가', unit: '원/등급', v: 30000, money: true, conf: 'mid', basis: '요금표 15층: 5톤 21만 → 6톤 24만 → 7.5톤 27만원', src: ['ladder'] },
    { k: 'elev_only', g: 'lift', label: '엘리베이터로만 옮길 때 추가 (14층·5톤 기준)', unit: '원', v: 200000, lo: 100000, hi: 300000, money: true, conf: 'low', basis: '업계 관행 추정. 작업이 2~3시간 늘어남 — 층수·톤수에 비례해 계산', src: ['elev'] },
    { k: 'stairs_per_floor', g: 'lift', label: '계단으로 옮길 때 층당 추가 (5톤 기준)', unit: '원/층', v: 30000, money: true, conf: 'low', basis: '리서치에 없음 — 계단 작업 층당 추가 인건비 관행 (추정)', src: [] },
    // 에어컨 (이삿짐센터)
    { k: 'ac_wall', g: 'ac', label: '벽걸이 이전설치', unit: '원/대', v: 130000, lo: 100000, hi: 150000, money: true, conf: 'mid', basis: '2025 숨고 전문가 공시. 철거·타공·앵글은 별도일 수 있음', src: ['soomgo', 'soomgo2'] },
    { k: 'ac_stand', g: 'ac', label: '스탠드 이전설치', unit: '원/대', v: 170000, lo: 130000, hi: 200000, money: true, conf: 'mid', basis: '2025 숨고 전문가 공시', src: ['soomgo'] },
    { k: 'ac_2in1', g: 'ac', label: '2in1 이전설치 (동배관 5m 포함)', unit: '원/세트', v: 280000, lo: 220000, hi: 350000, money: true, conf: 'mid', basis: '2025 숨고 전문가 공시', src: ['soomgo'] },
    { k: 'ac_pipe_per_m', g: 'ac', label: '동배관 추가 1m당', unit: '원/m', v: 20000, lo: 18000, hi: 25000, money: true, conf: 'mid', basis: '벽걸이 1.8만, 스탠드 2만원', src: ['soomgo'] },
    { k: 'ac_gas_wall', g: 'ac', label: '가스 충전: 벽걸이', unit: '원', v: 50000, lo: 40000, hi: 70000, money: true, conf: 'mid', basis: '숨고 공시', src: ['soomgo'] },
    { k: 'ac_gas_stand', g: 'ac', label: '가스 충전: 스탠드', unit: '원', v: 70000, lo: 50000, hi: 90000, money: true, conf: 'mid', basis: '숨고 공시', src: ['soomgo'] },
    { k: 'ac_gas_2in1', g: 'ac', label: '가스 충전: 2in1', unit: '원', v: 80000, lo: 60000, hi: 100000, money: true, conf: 'mid', basis: '숨고 공시', src: ['soomgo'] },
    { k: 'ac_trip', g: 'ac', label: '에어컨 기사 출장비 (방문 1회)', unit: '원', v: 20000, lo: 0, hi: 30000, money: true, conf: 'mid', basis: '숨고 공시', src: ['soomgo'] },
    // 추가 작업
    { k: 'fridge_large', g: 'extra', label: '양문형·4도어 냉장고 추가비 (도어 탈거 등)', unit: '원/대', v: 50000, lo: 0, hi: 100000, money: true, conf: 'low', basis: '업계 관행 추정', src: [] },
    { k: 'fridge_large_w', g: 'extra', label: '대형 냉장고로 보는 폭', unit: 'cm', v: 85, conf: 'low', basis: '양문형·4도어는 폭 약 90cm — 85cm 이상을 대형으로 봄 (앱 기준)', src: [] },
    { k: 'bed_dis', g: 'extra', label: '침대 분해조립', unit: '원/개', v: 50000, lo: 0, hi: 100000, money: true, conf: 'low', basis: '추정 (특수 구조 침대)', src: [] },
    { k: 'wardrobe_dis', g: 'extra', label: '장롱·시스템행거 해체·설치', unit: '원/식', v: 100000, lo: 50000, hi: 200000, money: true, conf: 'low', basis: '추정', src: [] },
    { k: 'stack', g: 'extra', label: '드럼세탁기·건조기 직렬 해체·설치', unit: '원', v: 70000, lo: 50000, hi: 100000, money: true, conf: 'low', basis: '추정. 건조기만 따로 옮기면 0원 가능', src: [] },
    { k: 'piano', g: 'extra', label: '업라이트 피아노 이동 (시내)', unit: '원/대', v: 200000, lo: 150000, hi: 300000, money: true, conf: 'low', basis: '추정', src: [] },
    { k: 'waste_per_ton', g: 'extra', label: '폐기물 업체 대행 처리 (1톤당)', unit: '원/톤', v: 200000, lo: 150000, hi: 300000, money: true, conf: 'low', basis: '추정. 폐가전은 무상방문수거(1599-0903)를 쓰세요', src: ['ewaste'] },
    { k: 'arrange_person', g: 'extra', label: '정리수납 추가 인력 (1명)', unit: '원/명', v: 210000, money: true, conf: 'low', basis: '리서치에 정리 인력 단가 없음 — 작업 인원 일당(21만원)과 같게 둠 (추정)', src: [] },
    // 범위·부가세
    { k: 'range_low', g: 'range', label: '하한 배수', unit: '배', v: 0.85, step: 0.01, conf: 'low', basis: '리서치 모델: 기준가 × 0.85 (업체마다 인건비·마진 차이)', src: [] },
    { k: 'range_high', g: 'range', label: '상한 배수', unit: '배', v: 1.25, step: 0.01, conf: 'low', basis: '리서치 모델: 기준가 × 1.25', src: [] },
    { k: 'vat_pct', g: 'range', label: '부가세', unit: '%', v: 10, conf: 'high', basis: '부가세 별도 견적이면 10%를 더해 비교. 계약은 "부가세 포함 총액, 결제수단 무관"으로 (카드 수수료 전가는 여신전문금융업법상 금지)', src: [] },
    { k: 'deposit_pct', g: 'range', label: '계약금 비율 관례', unit: '%', v: 10, lo: 5, hi: 20, conf: 'low', basis: '업계 관행 추정. 표준약관 배상이 계약금의 배수라 너무 적으면 불리', src: ['terms'] },
    // LG
    { k: 'lg_ac_wall', g: 'lg', label: 'LG 에어컨 이전설치: 벽걸이', unit: '원/대', v: 226000, lo: 226000, hi: 350000, money: true, conf: 'mid', basis: '2025-11-01 기준 (2차 출처). 2026년 인상 여부 미확인', src: ['lgAc'] },
    { k: 'lg_ac_stand', g: 'lg', label: 'LG 에어컨 이전설치: 스탠드', unit: '원/대', v: 318000, lo: 318000, hi: 450000, money: true, conf: 'mid', basis: '2025-11-01 기준 (2차 출처)', src: ['lgAc'] },
    { k: 'lg_ac_2in1', g: 'lg', label: 'LG 에어컨 이전설치: 2in1', unit: '원/세트', v: 417000, lo: 417000, hi: 600000, money: true, conf: 'mid', basis: '2025-11-01 기준 (2차 출처)', src: ['lgAc'] },
    { k: 'lg_ac_pipe_per_m', g: 'lg', label: 'LG 에어컨 배관 연장 1m당', unit: '원/m', v: 19000, money: true, conf: 'mid', basis: '2차 출처. 실외기 앵글(12~14만)·매립배관 세척(5만)은 별도', src: ['lgAc'] },
    { k: 'lg_fridge', g: 'lg', label: 'LG 냉장고 이전설치 (철거+설치)', unit: '원/대', v: 120000, lo: 60000, hi: 200000, money: true, conf: 'low', basis: '판토스(LG 물류 협력사) 요금표(일반 6만·4도어 10.1만·정수기형 17.9만)가 예전 요금일 수 있어 올려 잡음', src: ['lxPrice'] },
    { k: 'lg_dryer', g: 'lg', label: 'LG 건조기 이전설치 (철거+설치)', unit: '원/대', v: 110000, lo: 73000, hi: 150000, money: true, conf: 'low', basis: '건조기 단가를 못 찾아 세탁기 요금으로 추정', src: ['lxPrice'] },
    { k: 'lg_washer', g: 'lg', label: 'LG 세탁기 이전설치', unit: '원/대', v: 98000, lo: 73000, hi: 130000, money: true, conf: 'low', basis: '예전 요금표 기준 (이번엔 세탁기를 버려서 참고용)', src: ['lxPrice'] },
    { k: 'lg_other', g: 'lg', label: 'LG TV·기타 가전 이전설치', unit: '원/대', v: 100000, lo: 60000, hi: 180000, money: true, conf: 'low', basis: 'TV 등 단가 미조사 — 냉장고·세탁기 요금 범위의 중간값으로 둠. 1544-7777에서 확인', src: ['lgCare'] },
    { k: 'lg_transport', g: 'lg', label: 'LG 운송비 (10km 미만)', unit: '원', v: 40000, lo: 40000, hi: 80000, money: true, conf: 'low', basis: '검색 요약 기준. 제품별인지 건별인지 몰라 상한은 2건분', src: ['lgCare'] },
    { k: 'lg_discount_pct', g: 'lg', label: '2개 이상 맡길 때 철거·설치비 할인', unit: '%', v: 10, conf: 'low', basis: '에어컨·정수기·빌트인 제외 (2차 출처)', src: ['lgCare'] },
    { k: 'lg_visit_fee', g: 'lg', label: 'LG 출장비 (유상수리 때)', unit: '원', v: 20000, lo: 18000, hi: 30000, money: true, ref: true, conf: 'low', basis: '출처 없는 추정. 이전설치 패키지에는 보통 포함 → 계산에 넣지 않음 (예약 때 확인)', src: [] },
  ];
  /* 계수마다 받아 줄 수 있는 범위 — 범위 밖 값(0으로 나누기, 하한 > 상한 등)은 입력 때 막고, 저장된 값이 이상하면 기준값으로 계산 */
  const BOUNDS = {
    half_pct: [10, 100], general_pct: [10, 100], free_km: [0, 500], per_km: [0, 100000],
    m3_per_ton: [1, 15], truck_margin: [0, 50], m3_per_box: [0.01, 0.5], boxes_typical: [0, 500], box_person_pct: [0, 50],
    misc_m3: [0, 30], ac_outdoor_m3: [0, 2], fridge_large_w: [30, 200], multi_add_pct: [0, 50],
    range_low: [0.5, 1], range_high: [1, 3], vat_pct: [0, 20], deposit_pct: [0, 100],
  };
  COEFS.forEach((d) => {
    const b = BOUNDS[d.k] || (d.g === 'pack' ? [0.3, 3] : d.g === 'crew' ? [1, 20] : (d.unit === '%' || d.unit === '%포인트') ? [0, 100] : d.money ? [0, 50000000] : [0, 1e6]);
    d.min = b[0]; d.max = b[1];
  });
  const inBounds = (d, v) => isFinite(v) && v >= d.min - 1e-9 && v <= d.max + 1e-9;
  const COEF_MAP = {};
  const DEF_COEF = {};
  COEFS.forEach((d) => { COEF_MAP[d.k] = d; DEF_COEF[d.k] = d.v; });
  const CONF = { high: { label: '높음', cls: 'good' }, mid: { label: '중간', cls: 'warn' }, low: { label: '낮음', cls: 'bad' } };
  const PACK_CATS = new Set(['bed', 'sofa', 'table', 'shelf', 'storage', 'appliance', 'aircon', 'electronics', 'kids', 'misc']);

  /* ======================= 차량 등급 ======================= */
  const TRUCKS = [
    { t: 1, k: 'crew_1', label: '1톤 1대' },
    { t: 2.5, k: 'crew_2_5', label: '2.5톤 1대' },
    { t: 3.5, k: 'crew_3_5', label: '3.5톤 1대 (또는 2.5톤+1톤)' },
    { t: 5, k: 'crew_5', label: '5톤 1대 (또는 2.5톤 2대)' },
    { t: 6, k: 'crew_6', label: '5톤 + 1톤' },
    { t: 7.5, k: 'crew_7_5', label: '5톤 + 2.5톤' },
    { t: 8.5, k: 'crew_8_5', label: '5톤 + 3.5톤' },
    { t: 10, k: 'crew_10', label: '5톤 2대' },
  ];
  function truckFor(need, c) {
    for (let i = 0; i < TRUCKS.length; i++) {
      if (TRUCKS[i].t >= need - 1e-9) return { idx: i, tons: TRUCKS[i].t, crew: c[TRUCKS[i].k], label: TRUCKS[i].label };
    }
    const n = Math.ceil(need / 5);
    return { idx: TRUCKS.length, tons: n * 5, crew: r1(c.crew_10 * n / 2), label: '5톤 ' + n + '대' };
  }

  /* ======================= 날짜 (음력·손없는날) =======================
     한국천문연구원(KASI) 음력 자료 기반 korean-lunar-calendar 로 계산한 음력 1일 (리서치 검증본과 일치: 11/3 = 음력 9/24) */
  const LUNAR_STARTS = [
    ['2026-07-14', 6], ['2026-08-13', 7], ['2026-09-11', 8], ['2026-10-11', 9], ['2026-11-09', 10], ['2026-12-09', 11],
    ['2027-01-08', 12], ['2027-02-07', 1], ['2027-03-08', 2], ['2027-04-07', 3], ['2027-05-06', 4], ['2027-06-05', 5],
    ['2027-07-04', 6], ['2027-08-02', 7], ['2027-09-01', 8], ['2027-09-30', 9], ['2027-10-29', 10], ['2027-11-28', 11],
    ['2027-12-28', 12], ['2028-01-27', 1],
  ];
  const LUNAR_RANGE = '2026-07 ~ 2028-01';
  /* 2026-08 ~ 2027-12 공휴일 (대체공휴일 포함: 설·추석·어린이날·국경일·부처님오신날·성탄절이 주말과 겹치면 다음 평일) */
  const HOLIDAYS = {
    '2026-08-15': '광복절', '2026-08-17': '광복절 대체공휴일',
    '2026-09-24': '추석 연휴', '2026-09-25': '추석', '2026-09-26': '추석 연휴', '2026-10-03': '개천절',
    '2026-10-05': '개천절 대체공휴일', '2026-10-09': '한글날', '2026-12-25': '성탄절',
    '2027-01-01': '신정', '2027-02-06': '설 연휴', '2027-02-07': '설날', '2027-02-08': '설 연휴', '2027-02-09': '설 대체공휴일',
    '2027-03-01': '삼일절', '2027-05-05': '어린이날', '2027-05-13': '부처님오신날', '2027-06-06': '현충일',
    '2027-08-15': '광복절', '2027-08-16': '광복절 대체공휴일', '2027-09-14': '추석 연휴', '2027-09-15': '추석', '2027-09-16': '추석 연휴',
    '2027-10-03': '개천절', '2027-10-04': '개천절 대체공휴일', '2027-10-09': '한글날', '2027-10-11': '한글날 대체공휴일',
    '2027-12-25': '성탄절', '2027-12-27': '성탄절 대체공휴일',
  };
  const HOLIDAY_RANGE = ['2026-08-01', '2027-12-31'];
  function lunarOf(ds) {
    ds = normDate(ds);
    if (!ds) return null;
    for (let i = 0; i < LUNAR_STARTS.length - 1; i++) {
      if (ds >= LUNAR_STARTS[i][0] && ds < LUNAR_STARTS[i + 1][0]) return { month: LUNAR_STARTS[i][1], day: D.diff(LUNAR_STARTS[i][0], ds) + 1 };
    }
    return null;
  }
  const isSohn = (lunar) => !!lunar && (lunar.day % 10 === 9 || lunar.day % 10 === 0);
  function dateInfo(ds) {
    ds = normDate(ds) || '2026-11-03';
    const d = D.parse(ds);
    const wd = d.getDay();
    const holiday = HOLIDAYS[ds] || '';
    const weekend = wd === 0 || wd === 6 || !!holiday;
    const day = d.getDate();
    const dim = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
    const monthEnd = day > dim - 5;
    const monthStart = day <= 5;
    const lunar = lunarOf(ds);
    const sohn = lunar ? isSohn(lunar) : null;
    const flags = [];
    if (sohn) flags.push('sohn');
    if (weekend) flags.push('weekend');
    if (monthEnd) flags.push('monthEnd'); else if (monthStart) flags.push('monthStart');
    const nearby = [];
    for (let k = -7; k <= 16; k++) {
      const x = D.add(ds, k);
      if (k !== 0 && isSohn(lunarOf(x))) nearby.push(x);
    }
    const holidayKnown = ds >= HOLIDAY_RANGE[0] && ds <= HOLIDAY_RANGE[1];
    return { date: ds, weekday: wd, holiday, holidayKnown, weekend, monthStart, monthEnd, lunar, sohn, flags, nearby };
  }
  const FLAG_PCT = { sohn: 'sohn_pct', weekend: 'weekend_pct', monthEnd: 'month_end_pct', monthStart: 'month_start_pct' };
  function surchargeOf(flags, c) {
    if (!flags || !flags.length) return 0;
    const m = Math.max(...flags.map((f) => num(c[FLAG_PCT[f]], 0)));
    return m + (flags.length > 1 ? num(c.multi_add_pct, 0) : 0);
  }
  function flagsLabel(flags) {
    const parts = [];
    if (flags.includes('sohn')) parts.push('손없는날');
    parts.push(flags.includes('weekend') ? '주말·공휴일' : '평일');
    if (flags.includes('monthStart')) parts.push('월초');
    if (flags.includes('monthEnd')) parts.push('월말');
    return parts.join('·');
  }
  const DATE_MODES = [
    { id: 'auto' },
    { id: 'weekday', flags: [] },
    { id: 'monthStart', flags: ['monthStart'] },
    { id: 'monthEnd', flags: ['monthEnd'] },
    { id: 'weekend', flags: ['weekend'] },
    { id: 'weekendMonthEnd', flags: ['weekend', 'monthEnd'] },
    { id: 'sohn', flags: ['sohn'] },
    { id: 'sohnWeekend', flags: ['sohn', 'weekend'] },
  ];
  function modeFlags(mode, di) { const m = DATE_MODES.find((x) => x.id === mode) || DATE_MODES[0]; return m.id === 'auto' ? di.flags : m.flags; }
  function modeLabel(m, c, di) {
    const flags = m.id === 'auto' ? di.flags : m.flags;
    const p = surchargeOf(flags, c);
    const base = flagsLabel(flags) + ' (' + (p ? '+' + r1(p) + '%' : '할증 없음') + ')';
    return m.id === 'auto' ? base + ' · 이사일 기준 자동' : base;
  }

  /* ======================= 입력 기본값 ======================= */
  function inputDefaults() {
    const plans = MV.plans || {};
    return {
      packType: 'full', dateMode: 'auto', distanceKm: 1,
      fromFloor: Math.round(num(plans.old && plans.old.floor, 2)), fromMethod: 'ladder',
      toFloor: Math.round(num(plans.new && plans.new.floor, 14)), toMethod: 'ladder',
      elevFeeFrom: 50000, elevFeeTo: 50000,
      boxAuto: true, persons: 3, pyeong: 24, reducePct: 10, builtinBoxes: 20, boxes: 100,
      includeUndecided: true,
      acPipeM: 3, acGas: true,
      bedCount: null, fridgeCount: null, stackCount: null, pianoCount: null, wardrobeCount: 0,
      waste: false, wasteM3: null,
      arrange: false, arrangeCount: 1,
      vat: false,
    };
  }
  function defaults() {
    return {
      coef: Object.assign({}, DEF_COEF),
      inputs: inputDefaults(),
      quotes: [],
      calib: { factor: 1, at: null, median: null, n: 0, base: null },
      lgChecks: { schedule: false, landlord: false, brand: false },
    };
  }
  function coefOf(est) {
    const out = Object.assign({}, DEF_COEF);
    const src = est && est.coef;
    if (src && typeof src === 'object') {
      Object.keys(DEF_COEF).forEach((k) => { const v = num(src[k], NaN); if (inBounds(COEF_MAP[k], v)) out[k] = v; });
    }
    return out;
  }
  function inputsOf(est) {
    const def = inputDefaults();
    const src = (est && est.inputs && typeof est.inputs === 'object') ? est.inputs : {};
    const out = Object.assign({}, def);
    Object.keys(def).forEach((k) => {
      const v = src[k];
      if (v === undefined) return;
      const d = def[k];
      if (typeof d === 'boolean') out[k] = !!v;
      else if (typeof d === 'string') out[k] = typeof v === 'string' ? v : d;
      else if (d === null) out[k] = (v === null || v === '') ? null : (isFinite(num(v, NaN)) ? num(v, 0) : null);
      else out[k] = isFinite(num(v, NaN)) ? num(v, d) : d;
    });
    return out;
  }
  function calibOf(est) {
    const c = est && est.calib;
    const f = num(c && c.factor, 1);
    return { factor: f > 0 ? f : 1, at: (c && c.at) || null, median: num(c && c.median, null), n: num(c && c.n, 0), base: num(c && c.base, null), basis: (c && c.basis) || null, sig: (c && typeof c.sig === 'string') ? c.sig : null };
  }
  function quotesOf(est) { return (est && Array.isArray(est.quotes)) ? est.quotes.filter((q) => q && typeof q === 'object') : []; }

  /* ======================= 짐 분류 도우미 ======================= */
  const FATE_IDS = new Set(['move', 'buy', 'discard', 'sell', 'undecided']);
  const nm = (it) => String((it && it.name) || '');
  const isAircon = (it) => it.cat === 'aircon' || it.tag === 'aircon' || /에어컨/.test(nm(it));
  const isFridge = (it) => it.tag === 'fridge' || /냉장고/.test(nm(it));
  const isWasher = (it) => it.tag === 'washer' || /세탁기|통돌이|워시타워/.test(nm(it));
  const isDryer = (it) => it.tag === 'dryer' || /건조기/.test(nm(it));
  const isTv = (it) => it.tag === 'tv' || /(^|[^A-Za-z])TV([^A-Za-z]|$)|티비|텔레비전/i.test(nm(it));
  const isBedFrame = (it) => (it.tag === 'bed' || it.cat === 'bed') && !/매트리스|토퍼|이불|범퍼|패드/.test(nm(it));
  const isPiano = (it) => /피아노/.test(nm(it));
  /* 가구 분류(예: 규격 프리셋 ‘거실장 180’은 tag 'tv')는 tag 만으로 가전으로 보지 않아요 */
  const FURN_CATS = new Set(['bed', 'sofa', 'table', 'shelf', 'storage', 'kids']);
  const isApplianceLike = (it) => it.cat === 'appliance' || it.cat === 'aircon' || isAircon(it) || (!FURN_CATS.has(it.cat) && ['fridge', 'washer', 'dryer', 'aircon', 'tv'].includes(it.tag));
  function isGoing(it, inp) {
    if (!it || qtyOf(it) <= 0) return false;
    if (it.fate === 'move') return true;
    if (it.fate === 'undecided' || !FATE_IDS.has(it.fate)) return !!inp.includeUndecided;
    return false;
  }
  /* 실제로 LG가 옮기는 짐: LG 표시 + 가져감(또는 계산에 넣는 미정) + 가전·에어컨 + LG 이전설치 가능(LG 제품·창문형 아님)
     — 견적 계산·목록·내보내기가 모두 같은 규칙. LG 불가인데 LG 표시만 켜진 짐은 이삿짐센터가 옮기는 것으로 계산해요 */
  function lgActive(it, inp) { return !!it && !!it.lg && isGoing(it, inp) && isApplianceLike(it) && lgEligible(it); }
  function lgBlockedIt(it, inp) { return !!it && !!it.lg && isGoing(it, inp) && isApplianceLike(it) && !lgEligible(it); }
  function rawVol(it) {
    return Math.max(0, num(it.w, 0)) * Math.max(0, num(it.d, 0)) * Math.max(0, num(it.h, 0)) / 1e6 * qtyOf(it);
  }
  function packFactor(it, c) { return num(c['pack_' + (PACK_CATS.has(it.cat) ? it.cat : 'misc')], 1); }
  function effVol(it, c) {
    let v = rawVol(it) * packFactor(it, c);
    if (isAircon(it) && it.ac !== 'window') v += c.ac_outdoor_m3 * qtyOf(it);
    return v;
  }
  const LG_WORDS = /((^|[^a-z])lg(?![a-z])|엘지|트롬|디오스|휘센|오브제|퓨리케어|스타일러|코드제로|올레드|OLED|씽큐|ThinQ|워시타워)/i;
  const OTHER_WORDS = /(삼성|SAMSUNG|비스포크|무풍|그랑데|지펠|하우젠|위니아|딤채|캐리어|대우|클라쎄|쿠쿠|SK매직|코웨이|위닉스|신일|파세코|하이얼|샤오미|다이슨|일렉트로룩스|밀레|보쉬|캐리어)/i;
  function brandOf(it) {
    // 메모는 'LG 제품일 때만…' 같은 조건문이 많아 보지 않고, 이름과 제품 링크만 봄
    const t = nm(it) + ' ' + String(it.url || '');
    if (OTHER_WORDS.test(t)) return 'other';
    if (LG_WORDS.test(t) || /lge\.co\.kr/.test(t)) return 'lg';
    return '';
  }
  /* LG 베스트케어 이전설치를 맡길 수 있는 가전: 창문형 에어컨(이전설치가 필요 없음)과 다른 브랜드로 보이는 제품은 빼요 */
  function lgEligible(it) { return lgKind(it) !== 'ac_window' && brandOf(it) !== 'other'; }
  /* 가전 이름에 가구가 함께 적힌 짐 (예: 'TV + 거실장') — LG는 가구를 안 옮겨요 */
  const FURN_WITH = /(거실장|TV장|티비장|수납장|선반|받침대|테이블|협탁|서랍장)/i;

  /* ======================= 부대비 계산 ======================= */
  function ladderCost(floor, tons, c) {
    if (floor < 2) return 0;
    const base = floor <= 5 ? c.ladder_f2 : floor <= 9 ? c.ladder_f6 : floor <= 12 ? c.ladder_f10 : floor <= 15 ? c.ladder_f13 : floor <= 20 ? c.ladder_f16 : c.ladder_f21;
    const steps = TRUCKS.filter((x) => x.t > 5 && x.t <= tons).length + (tons > 10 ? Math.ceil((tons - 10) / 5) : 0);
    return base + steps * c.ladder_step;
  }
  const floorBracket = (f) => (f <= 5 ? '2~5층' : f <= 9 ? '6~9층' : f <= 12 ? '10~12층' : f <= 15 ? '13~15층' : f <= 20 ? '16~20층' : '21층 이상');
  const METHODS = { ladder: '사다리차', elevator: '엘리베이터', stairs: '계단' };
  function liftCost(floor, method, tons, c) {
    floor = Math.max(0, Math.round(num(floor, 1)));
    const tr = MV.clamp(tons / 5, 0.4, 2);
    if (floor <= 1) return { typical: 0, title: '1층', detail: '1층이라 사다리차·엘리베이터가 필요 없어요', method };
    if (method === 'elevator') {
      const v = c.elev_only * (floor / 14) * tr;
      return { typical: v, title: '엘리베이터 반출입 추가 인력 (' + floor + '층)', detail: won(c.elev_only) + ' × ' + floor + '/14층 × ' + r2(tr) + ' (톤수 비율) — 작업 시간 증가분', method };
    }
    if (method === 'stairs') {
      const v = c.stairs_per_floor * (floor - 1) * tr;
      return { typical: v, title: '계단 작업 추가 (' + floor + '층)', detail: won(c.stairs_per_floor) + ' × ' + (floor - 1) + '개 층 × ' + r2(tr) + ' (톤수 비율)', method };
    }
    const v = ladderCost(floor, tons, c);
    const steps = v - ladderCost(floor, 5, c);
    return { typical: v, title: '사다리차 (' + floor + '층)', detail: floorBracket(floor) + ' 요금 ' + won(v - Math.max(0, steps)) + (steps > 0 ? ' + 차량 등급 추가 ' + won(steps) : '') + (floor >= 13 ? ' · 설치 위치 사전 확인 필요' : ''), method };
  }
  function boxesOf(inp, c) {
    if (!inp.boxAuto) return Math.max(0, Math.round(num(inp.boxes, 0)));
    const base = c.boxes_typical * Math.max(0, num(inp.pyeong, 24)) / 24;
    const per = Math.max(0.2, 1 + (c.box_person_pct / 100) * (Math.max(1, num(inp.persons, 3)) - 3));
    const red = 1 - MV.clamp(num(inp.reducePct, 0), 0, 90) / 100;
    return Math.max(0, Math.round(base * per * red + Math.max(0, num(inp.builtinBoxes, 0))));
  }

  /* ---------- LG 비용 ---------- */
  const LG_KIND = {
    ac_wall: { key: 'lg_ac_wall', label: '벽걸이 에어컨', ac: true },
    ac_stand: { key: 'lg_ac_stand', label: '스탠드 에어컨', ac: true },
    ac_2in1: { key: 'lg_ac_2in1', label: '2in1 에어컨', ac: true },
    ac_window: { key: null, label: '창문형 에어컨', ac: true },
    fridge: { key: 'lg_fridge', label: '냉장고' },
    dryer: { key: 'lg_dryer', label: '건조기' },
    washer: { key: 'lg_washer', label: '세탁기' },
    tv: { key: 'lg_other', label: 'TV' },
    other: { key: 'lg_other', label: '기타 가전' },
  };
  const LG_DOES = {
    ac_wall: '철거(냉매 회수)·운송·재설치. 배관 연장 m당 1.9만, 실외기 앵글 12~14만, 매립배관 세척 5만은 별도',
    ac_stand: '철거(냉매 회수)·운송·재설치. 배관 연장 m당 1.9만, 실외기 앵글 12~14만, 매립배관 세척 5만은 별도',
    ac_2in1: '실내기 2대+실외기 철거·운송·재설치. 배관 연장 m당 1.9만, 매립배관 세척 9만은 별도',
    ac_window: '창문형은 직접 떼고 다는 제품 — 이전설치가 필요 없어요',
    fridge: '철거·운송·설치. 세워서 운반, 설치 후 수평 맞춤 (정수기형은 더 비쌈)',
    dryer: '철거·운송·설치. 눕히지 않고 운반, 설치 후 대기시간 안내',
    washer: '철거·운송·설치 (드럼은 운송볼트 체결)',
    tv: '철거(벽걸이 브라켓)·운송·설치 — 단가 미조사, 예약 때 확인',
    other: 'LG 이전설치 대상인지 1544-7777에서 확인하세요',
  };
  function lgKind(it) {
    if (isAircon(it)) return it.ac === 'wall' ? 'ac_wall' : it.ac === '2in1' ? 'ac_2in1' : it.ac === 'window' ? 'ac_window' : 'ac_stand';
    if (isFridge(it) || /김치/.test(nm(it))) return 'fridge';
    if (isDryer(it)) return 'dryer';
    if (isWasher(it)) return 'washer';
    if (isTv(it)) return 'tv';
    return 'other';
  }
  function ratio(k, which) {
    const d = COEF_MAP[k];
    if (!d || !d.v) return 1;
    const x = which === 'lo' ? d.lo : d.hi;
    return isNum(x) ? x / d.v : 1;
  }
  function lgItemCost(it, c, inp) {
    const kind = lgKind(it);
    const def = LG_KIND[kind];
    const q = qtyOf(it);
    if (!def.key || !q) return { kind, q, fee: { lo: 0, ty: 0, hi: 0 }, pipe: 0, low: 0, typical: 0, high: 0 };
    const ty = c[def.key] * q;
    const fee = { lo: ty * ratio(def.key, 'lo'), ty, hi: ty * ratio(def.key, 'hi') };
    const pipe = def.ac ? Math.max(0, num(inp.acPipeM, 0)) * c.lg_ac_pipe_per_m * q : 0;
    return { kind, q, fee, pipe, low: fee.lo + pipe, typical: fee.ty + pipe, high: fee.hi + pipe };
  }
  function lgCostOf(items, c, inp) {
    if (!items || !items.length) return null;
    const rows = items.map((it) => Object.assign({ id: it.id, name: nm(it) }, lgItemCost(it, c, inp))).filter((r) => r.q > 0);
    if (!rows.length) return null;
    const nonAc = rows.filter((r) => LG_KIND[r.kind].key && !LG_KIND[r.kind].ac);
    const units = sum(nonAc, (r) => r.q);
    const dp = units >= 2 ? c.lg_discount_pct / 100 : 0;
    const discount = { low: sum(nonAc, (r) => r.fee.lo) * dp, typical: sum(nonAc, (r) => r.fee.ty) * dp, high: sum(nonAc, (r) => r.fee.hi) * dp, pct: dp * 100 };
    const billable = rows.some((r) => LG_KIND[r.kind].key);
    const transport = billable ? { low: c.lg_transport * ratio('lg_transport', 'lo'), typical: c.lg_transport, high: c.lg_transport * ratio('lg_transport', 'hi') } : { low: 0, typical: 0, high: 0 };
    const tot = (k) => Math.round(sum(rows, (r) => r[k]) - discount[k] + transport[k]);
    return {
      low: tot('low'), typical: tot('typical'), high: tot('high'),
      rows: rows.map((r) => ({ id: r.id, name: r.name, kind: r.kind, qty: r.q, low: Math.round(r.low), typical: Math.round(r.typical), high: Math.round(r.high), pipe: Math.round(r.pipe) })),
      discount: { low: Math.round(discount.low), typical: Math.round(discount.typical), high: Math.round(discount.high), pct: discount.pct },
      transport: { low: Math.round(transport.low), typical: Math.round(transport.typical), high: Math.round(transport.high) },
      count: sum(rows, (r) => r.q),
      vatIncluded: true, // LG 요금은 소비자가(부가세 포함)
    };
  }

  /* ======================= 견적 계산 (순수 함수) ======================= */
  const AC_T = ['wall', 'stand', '2in1'];
  const AC_LABEL = { wall: '벽걸이', stand: '스탠드', '2in1': '2in1', window: '창문형' };
  const PACK_TYPES = [{ id: 'full', label: '포장이사' }, { id: 'half', label: '반포장' }, { id: 'general', label: '일반이사' }];

  function compute(st, opt) {
    opt = opt || {};
    const est = (st && st.estimate && typeof st.estimate === 'object') ? st.estimate : {};
    const c = coefOf(est);
    const inp = inputsOf(est);
    const invAll = Array.isArray(opt.inventory) ? opt.inventory : (st && Array.isArray(st.inventory) ? st.inventory : []);
    const inv = invAll.filter((x) => x && typeof x === 'object');
    const going = inv.filter((it) => isGoing(it, inp));
    // LG 표시는 가전·에어컨에만 의미가 있어요 (가구에 잘못 켜져 있으면 이삿짐센터가 옮기는 것으로 계산)
    // LG 이전설치는 LG 제품만 — 다른 브랜드로 보이거나 창문형 에어컨이면 LG 표시가 켜져 있어도 이삿짐센터 짐으로 계산 (lgCost 에서 빠짐)
    const viaLg = (it) => !!it.lg && isApplianceLike(it) && lgEligible(it);
    const mover = going.filter((it) => !viaLg(it));
    const lgItems = going.filter(viaLg);
    const lgBlocked = going.filter((it) => !!it.lg && isApplianceLike(it) && !lgEligible(it));

    /* 1) 부피 */
    const furnRaw = sum(mover, rawVol);
    const furnEff = sum(mover, (it) => effVol(it, c));
    const boxes = boxesOf(inp, c);
    const boxM3 = boxes * c.m3_per_box;
    const miscM3 = c.misc_m3;
    const volume = furnEff + boxM3 + miscM3;
    const tonsNeed = volume / c.m3_per_ton;
    const tonsMargin = tonsNeed * (1 + c.truck_margin / 100);
    const truck = truckFor(tonsMargin, c);
    const tons = truck.tons;
    const crew = truck.crew;

    /* 2) 날짜 */
    const moveDate = normDate(st && st.meta && st.meta.moveDate) || '2026-11-03';
    const di = dateInfo(moveDate);
    const flags = modeFlags(inp.dateMode, di);
    const surPct = surchargeOf(flags, c);
    const dateLabel = flagsLabel(flags);

    /* 3) 금액 줄 */
    const packType = PACK_TYPES.find((p) => p.id === inp.packType) || PACK_TYPES[0];
    const packMul = packType.id === 'half' ? c.half_pct / 100 : packType.id === 'general' ? c.general_pct / 100 : 1;
    const packTxt = packMul !== 1 ? ' × ' + packType.label + ' ' + Math.round(packMul * 100) + '%' : '';
    const lines = [];
    const add = (key, label, typical, detail, group) => { lines.push({ key, label, typical: Math.round(Math.max(0, typical)), detail: detail || '', group: group || 'extra' }); };

    const truckCost = tons * c.base_per_ton * packMul;
    const crewCost = crew * c.crew_day_rate * packMul;
    add('truck', '차량·포장재 (' + truck.label + ')', truckCost, tonsLabel(tons) + ' × ' + won(c.base_per_ton) + packTxt, 'base');
    add('crew', '작업 인원 ' + crewLabel(crew), crewCost, crew + '명 × ' + won(c.crew_day_rate) + packTxt, 'base');
    const baseCost = truckCost + crewCost;
    add('date', '날짜 할증 (' + dateLabel + ')', baseCost * surPct / 100,
      surPct ? '본비 ' + won(baseCost) + ' × ' + r1(surPct) + '%' : '손없는날·주말·월말이 아니라 할증이 없어요', 'base');
    const km = Math.max(0, num(inp.distanceKm, 0));
    if (km > c.free_km) add('distance', '거리 추가 (' + r1(km) + 'km)', (km - c.free_km) * c.per_km, r1(km - c.free_km) + 'km × ' + won(c.per_km), 'base');

    const fromFloor = Math.round(num(inp.fromFloor, 2));
    const toFloor = Math.round(num(inp.toFloor, 14));
    const lf = liftCost(fromFloor, inp.fromMethod, tons, c);
    const lt = liftCost(toFloor, inp.toMethod, tons, c);
    if (lf.typical > 0) add('liftFrom', '출발 ' + lf.title, lf.typical, lf.detail, 'lift');
    if (lt.typical > 0) add('liftTo', '도착 ' + lt.title, lt.typical, lt.detail, 'lift');
    const efA = Math.max(0, num(inp.elevFeeFrom, 0));
    const efB = Math.max(0, num(inp.elevFeeTo, 0));
    if (efA + efB > 0) add('elevFee', '엘리베이터 사용료 (양쪽 단지)', efA + efB, '출발 ' + won(efA) + ' + 도착 ' + won(efB) + ' — 관리사무소에 직접 내는 경우가 많아요', 'lift');

    // 에어컨 (이삿짐센터)
    const acCnt = { wall: 0, stand: 0, '2in1': 0, window: 0, unknown: 0 };
    mover.filter(isAircon).forEach((it) => { const t = ['wall', 'stand', '2in1', 'window'].includes(it.ac) ? it.ac : 'unknown'; acCnt[t] += qtyOf(it); });
    const acUnits = { wall: acCnt.wall, stand: acCnt.stand + acCnt.unknown, '2in1': acCnt['2in1'] };
    const acN = acUnits.wall + acUnits.stand + acUnits['2in1'];
    const pipeM = Math.max(0, num(inp.acPipeM, 0));
    let acCost = 0;
    if (acN > 0) {
      const parts = [];
      AC_T.forEach((t) => {
        const n = acUnits[t];
        if (!n) return;
        const unit = c['ac_' + t] + (inp.acGas ? c['ac_gas_' + t] : 0) + pipeM * c.ac_pipe_per_m;
        acCost += n * unit;
        parts.push(AC_LABEL[t] + ' ' + n + '대 × ' + won(unit));
      });
      acCost += c.ac_trip;
      parts.push('출장 ' + won(c.ac_trip));
      add('aircon', '에어컨 이전설치 (' + AC_T.filter((t) => acUnits[t]).map((t) => AC_LABEL[t] + ' ' + acUnits[t] + '대').join(', ') + ')', acCost,
        parts.join(' + ') + ' · 1대당 설치' + (inp.acGas ? '+가스' : '') + (pipeM ? '+배관 ' + r1(pipeM) + 'm' : ''), 'special');
    }
    const cnt = (v, auto) => (v == null ? auto : Math.max(0, Math.round(num(v, 0))));
    const autoBeds = sum(mover.filter(isBedFrame), qtyOf);
    const beds = cnt(inp.bedCount, autoBeds);
    if (beds > 0) add('bed', '침대 분해조립 ' + beds + '개', beds * c.bed_dis, beds + '개 × ' + won(c.bed_dis), 'special');
    const wardrobes = cnt(inp.wardrobeCount, 0);
    if (wardrobes > 0) add('wardrobe', '장롱·시스템행거 해체·설치 ' + wardrobes + '식', wardrobes * c.wardrobe_dis, wardrobes + '식 × ' + won(c.wardrobe_dis), 'special');
    const autoFridges = sum(mover.filter((it) => isFridge(it) && num(it.w, 0) >= c.fridge_large_w), qtyOf);
    const fridges = cnt(inp.fridgeCount, autoFridges);
    if (fridges > 0) add('fridge', '대형 냉장고 ' + fridges + '대', fridges * c.fridge_large, '폭 ' + c.fridge_large_w + 'cm 이상 · ' + fridges + '대 × ' + won(c.fridge_large), 'special');
    const autoStack = (mover.some(isWasher) && mover.some(isDryer)) ? 1 : 0;
    const stack = cnt(inp.stackCount, autoStack);
    if (stack > 0) add('stack', '세탁기·건조기 직렬 해체·설치', stack * c.stack, stack + '세트 × ' + won(c.stack), 'special');
    const autoPiano = sum(mover.filter(isPiano), qtyOf);
    const pianos = cnt(inp.pianoCount, autoPiano);
    if (pianos > 0) add('piano', '피아노 이동 ' + pianos + '대', pianos * c.piano, pianos + '대 × ' + won(c.piano), 'special');
    const wasteSrc = inv.filter((it) => it.fate === 'discard' && qtyOf(it) > 0 && !(it.cat === 'appliance' || it.cat === 'aircon' || it.cat === 'electronics' || isFridge(it) || isWasher(it) || isDryer(it) || isTv(it) || isAircon(it)));
    const autoWasteM3 = sum(wasteSrc, (it) => effVol(it, c));
    const wasteM3 = inp.wasteM3 == null ? autoWasteM3 : Math.max(0, num(inp.wasteM3, 0));
    let wasteCost = 0;
    if (inp.waste && wasteM3 > 0) {
      wasteCost = wasteM3 / c.m3_per_ton * c.waste_per_ton;
      add('waste', '폐기물 처리 (' + m3(wasteM3) + ')', wasteCost, m3(wasteM3) + ' ÷ ' + c.m3_per_ton + '㎥/톤 × ' + won(c.waste_per_ton) + '/톤', 'special');
    }
    const arrangeN = inp.arrange ? Math.max(0, Math.round(num(inp.arrangeCount, 1))) : 0;
    if (arrangeN > 0) add('arrange', '정리수납 추가 인력 ' + arrangeN + '명', arrangeN * c.arrange_person, arrangeN + '명 × ' + won(c.arrange_person), 'special');

    /* 부가세 기준: 리서치 모델의 기준가는 ‘부가세 별도’ 시세예요 (별도 견적이면 ×1.1).
       보정(방문견적 중앙값)은 언제나 부가세 별도 금액에 곱하고, 부가세는 그 위에 붙여요.
       그래서 ‘부가세 포함으로 보기’를 켜고 꺼도 보정 비율은 그대로이고, 업체 견적도 같은 기준으로 바꿔 비교해요. */
    const subtotal = sum(lines, (l) => l.typical);
    const vatRate = c.vat_pct / 100;
    const vatMul = inp.vat ? 1 + vatRate : 1;
    let total = subtotal;
    const typicalRaw = Math.round(subtotal * vatMul);
    const calib = calibOf(est);
    const useCalib = opt.calib !== false && Math.abs(calib.factor - 1) > 1e-6;
    if (useCalib) {
      const v = subtotal * (calib.factor - 1);
      lines.push({ key: 'calib', label: '방문견적 보정 (×' + calib.factor.toFixed(2) + ')', typical: Math.round(v),
        detail: '방문견적 ' + calib.n + '곳 중앙값(부가세 별도로 환산) ' + won(calib.median) + '에 맞춤', group: 'calib' });
      total += v;
    }
    const totalEx = total; // 부가세 별도 (보정 포함)
    if (inp.vat) {
      const v = total * vatRate;
      add('vat', '부가세 ' + r1(c.vat_pct) + '%', v, (useCalib ? '보정한 금액' : '부가세 별도 시세') + ' ' + won(total) + ' × ' + r1(c.vat_pct) + '%', 'tax');
      total += v;
    }
    lines.forEach((l) => { l.low = Math.round(l.typical * c.range_low); l.high = Math.round(l.typical * c.range_high); });
    const typical = Math.round(total);
    const low = Math.round(total * c.range_low);
    const high = Math.round(total * c.range_high);
    /* 실제로 낼 돈(부가세 포함) — ‘부가세 포함으로 보기’가 꺼져 있어도 여기엔 부가세를 더해요 (머리말·히어로·자금은 이 값).
       LG 요금은 소비자가(부가세 포함)라, 이삿짐센터와 LG를 더하거나 비교할 땐 이 값끼리 써요 */
    const payMul = inp.vat ? 1 : 1 + vatRate;
    const pay = { low: Math.round(total * c.range_low * payMul), typical: Math.round(total * payMul), high: Math.round(total * c.range_high * payMul) };
    const ex = { low: Math.round(totalEx * c.range_low), typical: Math.round(totalEx), high: Math.round(totalEx * c.range_high) };
    const lineVal = (k) => sum(lines.filter((l) => l.key === k), (l) => l.typical);
    /* 업체 견적에 빠진 항목을 채울 때 쓰는 모델 금액 — partsEx 는 부가세 별도, parts 는 지금 화면 기준 */
    const partsEx = {
      ladder: (lf.method === 'ladder' ? lineVal('liftFrom') : 0) + (lt.method === 'ladder' ? lineVal('liftTo') : 0),
      aircon: lineVal('aircon'),
      waste: lineVal('waste'),
      arrange: lineVal('arrange'),
    };
    const parts = {};
    Object.keys(partsEx).forEach((k) => { parts[k] = partsEx[k] * vatMul; });

    /* 4) 다음 차량 등급까지 */
    let next = null;
    if (truck.idx < TRUCKS.length - 1) {
      const nt = TRUCKS[truck.idx + 1];
      const cap = tons * c.m3_per_ton / (1 + c.truck_margin / 100);
      const headroom = Math.max(0, cap - volume);
      const nCrew = c[nt.k];
      const dBase = ((nt.t - tons) * c.base_per_ton + (nCrew - crew) * c.crew_day_rate) * packMul * (1 + surPct / 100);
      const dLift = (lf.method === 'ladder' ? ladderCost(fromFloor, nt.t, c) - ladderCost(fromFloor, tons, c) : 0) +
        (lt.method === 'ladder' ? ladderCost(toFloor, nt.t, c) - ladderCost(toFloor, tons, c) : 0);
      next = { tons: nt.t, label: nt.label, crew: nCrew, headroom, boxes: c.m3_per_box > 0 ? Math.ceil(headroom / c.m3_per_box) : 0, delta: Math.round((dBase + dLift) * vatMul * (useCalib ? calib.factor : 1)) };
    }

    /* 5) LG */
    const lgCost = lgCostOf(lgItems, c, inp);
    const totalPay = { low: pay.low + (lgCost ? lgCost.low : 0), typical: pay.typical + (lgCost ? lgCost.typical : 0), high: pay.high + (lgCost ? lgCost.high : 0) };

    /* 6) 안내 문구 */
    const notes = [];
    if (lgBlocked.length) {
      const nb = lgBlocked.map(nm);
      notes.push('LG 표시가 켜진 ' + nb.join(', ') + ' — ' + (lgBlocked.every((it) => lgKind(it) === 'ac_window') ? '창문형 에어컨은 LG 이전설치가 필요 없어요' : 'LG 제품이 아닌 것으로 보여 LG 이전설치를 맡길 수 없어요') +
        '. 이삿짐센터가 옮기는 것으로 계산했어요 — ‘LG·이삿짐센터 비교’ 탭에서 이삿짐센터로 바꾸세요.');
    }
    const assumed = going.filter((it) => it.assumed);
    const undecided = going.filter((it) => it.fate !== 'move');
    if (!inv.length) notes.push('짐 목록이 비어 있어 박스·잡동사니 기본값으로만 계산했어요. 냉장고·침대·소파 같은 큰 짐을 넣어 주세요.');
    else if (!going.length) notes.push('가져갈 짐이 없어 박스·잡동사니 기본값으로만 계산했어요.');
    else if (assumed.length && assumed.length * 2 >= going.length) notes.push('가져갈 짐 ' + going.length + '개 중 ' + assumed.length + '개가 추정 규격이에요. 실제 치수를 재면 더 정확해져요.');
    if (useCalib) notes.push('방문견적 ' + calib.n + '곳의 중앙값에 맞춰 ×' + calib.factor.toFixed(2) + ' 보정한 금액이에요.');
    else notes.push('리서치 계수(대부분 신뢰도 낮음)로 만든 추정치예요. 방문견적 3곳을 받으면 다시 맞추세요.');
    if (next && next.headroom < 1.5) notes.push('짐이 ' + m3(next.headroom) + '(박스 약 ' + next.boxes + '개)만 늘어도 ' + tonsLabel(next.tons) + '으로 올라가 약 ' + won(next.delta) + ' 더 들어요.');
    if (acCnt.unknown) notes.push('종류를 안 적은 에어컨 ' + acCnt.unknown + '대는 스탠드로 계산했어요.');
    if (undecided.length) notes.push('처리 ‘미정’ 짐 ' + undecided.length + '개도 가져가는 것으로 계산했어요.');
    if (inp.dateMode === 'auto' && di.lunar && !di.sohn) notes.push(D.fmt(di.date) + '은 음력 ' + di.lunar.month + '월 ' + di.lunar.day + '일 — 손없는날이 아니에요.');

    return {
      tons, crew, volume: r1(volume), low, typical, high, lines, lgCost, notes,
      typicalRaw, subtotalEx: Math.round(subtotal), vatIncl: !!inp.vat, vatMul: 1 + vatRate, partsEx,
      pay, totalPay, ex, // pay: 이삿짐센터 부가세 포함 / totalPay: pay + LG(부가세 포함) / ex: 이삿짐센터 부가세 별도
      lgBlocked: lgBlocked.map((it) => ({ id: it.id, name: nm(it), reason: lgKind(it) === 'ac_window' ? 'window' : 'brand' })),
      calibFactor: useCalib ? calib.factor : 1, calib,
      truckLabel: truck.label, crewLabel: crewLabel(crew), tonsNeed, tonsMargin,
      volumeParts: { furnRaw, furnEff, boxes, boxM3, miscM3, items: mover.length, units: sum(mover, qtyOf) },
      surchargePct: surPct, dateLabel, dateInfo: di, flags, packType: packType.id,
      counts: { ac: acCnt, acUnits, acN, beds, autoBeds, fridges, autoFridges, stack, autoStack, pianos, autoPiano, wardrobes, wasteM3, autoWasteM3, arrange: arrangeN },
      lifts: { from: lf, to: lt },
      parts, next, coef: c, inputs: inp,
      goingCount: going.length, assumedCount: assumed.length, lgCount: lgItems.length, moverCount: mover.length, undecidedCount: undecided.length,
    };
  }

  /* 업체 견적 → 모델과 같은 조건·같은 부가세 기준으로 환산 (빠진 항목은 모델 금액을 더함)
     ex: 부가세 별도 기준 / inc: 부가세 포함 기준 / amount: 지금 모델 기준(‘부가세 포함으로 보기’ 켜면 inc, 끄면 ex) */
  function normQuote(q, raw) {
    const amt = num(q && q.amount, 0);
    if (!(amt > 0)) return null;
    const c = raw.coef;
    const vm = 1 + c.vat_pct / 100;
    const incl = raw.vatIncl;
    const quoteIncl = q.vatIncluded !== false;
    const exAmt = quoteIncl ? amt / vm : amt;
    const adds = [];
    if (quoteIncl && !incl) adds.push({ label: '부가세 빼기', v: exAmt - amt, vat: true });
    if (!quoteIncl && incl) adds.push({ label: '부가세 ' + r1(c.vat_pct) + '%', v: amt * (vm - 1), vat: true });
    const pe = raw.partsEx || {};
    const missing = [];
    if (!q.ladder && pe.ladder > 0) missing.push(['사다리차', pe.ladder]);
    if (!q.aircon && pe.aircon > 0) missing.push(['에어컨 이전', pe.aircon]);
    if (!q.waste && pe.waste > 0) missing.push(['폐기물', pe.waste]);
    if (!q.arrange && pe.arrange > 0) missing.push(['정리 인력', pe.arrange]);
    missing.forEach(([label, v]) => adds.push({ label, v: v * (incl ? vm : 1) }));
    const ex = exAmt + sum(missing, (m) => m[1]);
    const inc = ex * vm;
    return { amount: Math.round(incl ? inc : ex), ex: Math.round(ex), inc: Math.round(inc), adds, basis: incl ? 'inc' : 'ex' };
  }
  const basisLabel = (incl) => (incl ? '부가세 포함' : '부가세 별도');

  MV.calc.moveEstimate = function moveEstimate(state) { return compute(state || (MV.store && MV.store.get && MV.store.get())); };

  /* ======================= 스타일 ======================= */
  MV.css('es', `
.es-region { display: contents; }
/* 터치 대상 최소 36px */
.es-body .btn-sm, .es-head .btn-sm, .es-pv .btn-sm { min-height: 36px; }
.es-body .btn-sm.btn-icon, .es-pv .btn-sm.btn-icon { width: 36px; }
.es-body { display: flex; flex-direction: column; gap: 14px; }
.es-body .card + .card { margin-top: 0; }
.es-head .sub b { color: var(--ink-2); }
.es-tabs { margin: 0 0 14px; }
.es-tabs button { display: inline-flex; align-items: center; gap: 6px; min-height: 38px; }
.es-tn { min-width: 20px; height: 18px; padding: 0 6px; border-radius: 999px; background: var(--bg-2); color: var(--ink-3); font-size: .7rem; font-weight: 800; display: inline-flex; align-items: center; justify-content: center; font-variant-numeric: tabular-nums; }
.es-tabs button.active .es-tn { background: var(--brand-bg); color: var(--brand); }
.es-ts { display: none; }
@media (max-width: 600px) {
  .es-tl { display: none; } .es-ts { display: inline; }
  .es-tabs button { padding: 6px 10px; flex: 1 0 auto; justify-content: center; gap: 4px; }
  .es-tabs .es-ti { display: none; }
}
.es-h2 { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin: 0 0 10px; font-size: 1.05rem; }
.es-h2 .es-h2-sub { font-size: .8rem; font-weight: 600; color: var(--ink-3); }
.es-h2 .es-h2-act { margin-left: auto; display: flex; gap: 6px; flex-wrap: wrap; }
.card .es-h3, .es-h3 { font-size: .88rem; font-weight: 800; color: var(--ink-2); margin: 18px 0 10px; padding-top: 14px; border-top: 1px solid var(--line); display: flex; align-items: center; gap: 6px; }
.card .es-h3.es-h3-first { margin-top: 4px; padding-top: 0; border-top: 0; }
.es-why .es-h3 { border-top: 0; padding-top: 0; }
.es-muted { color: var(--ink-3); }
.es-srcs { display: inline-flex; flex-wrap: wrap; gap: 4px 8px; margin-left: 4px; }
.es-srcs a { font-size: .74rem; white-space: nowrap; }
.es-disclaimer { display: flex; gap: 10px; align-items: flex-start; }
.es-disclaimer .es-dico { font-size: 1.2rem; line-height: 1.3; }

/* 짐 목록: 요약·필터 */
.es-sumbar { display: flex; flex-direction: column; gap: 8px; }
.es-chiprow { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
.es-fchip { display: inline-flex; align-items: center; gap: 6px; min-height: 36px; padding: 0 12px; border-radius: 999px; border: 1px solid var(--line); background: var(--bg-2); color: var(--ink-2); font: inherit; font-size: .84rem; font-weight: 700; cursor: pointer; -webkit-tap-highlight-color: transparent; }
.es-fchip:hover { border-color: var(--line-2); }
.es-fchip b { font-variant-numeric: tabular-nums; color: var(--ink); }
.es-fchip .es-dot { width: 9px; height: 9px; border-radius: 50%; background: var(--ink-3); flex: none; }
.es-fchip[data-tone="kid"] .es-dot { background: var(--kid); }
.es-fchip[data-tone="good"] .es-dot { background: var(--good); }
.es-fchip[data-tone="bad"] .es-dot { background: var(--bad); }
.es-fchip[data-tone="warn"] .es-dot { background: var(--warn); }
.es-fchip.is-on { background: var(--ink); color: var(--bg); border-color: var(--ink); }
.es-fchip.is-on b { color: var(--bg); }
.es-fchip.es-warnchip { background: var(--warn-bg); color: var(--warn); border-color: color-mix(in srgb, var(--warn) 35%, var(--line)); }
.es-fchip.es-warnchip b { color: var(--warn); }
.es-fchip.es-warnchip.is-on { background: var(--warn); color: var(--bg-2); }
.es-fchip.es-warnchip.is-on b { color: var(--bg-2); }
.es-stat { display: inline-flex; align-items: center; gap: 6px; min-height: 36px; padding: 0 12px; border-radius: 999px; background: var(--kid-bg); color: var(--kid); font-size: .84rem; font-weight: 750; }
.es-stat b { font-variant-numeric: tabular-nums; }
.es-toolbar { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
.es-toolbar .es-search { flex: 1 1 220px; min-width: 0; }
.es-toolbar .select { width: auto; flex: 0 1 auto; min-width: 0; max-width: 100%; }
.es-actions { display: flex; flex-wrap: wrap; gap: 8px; }
.es-presets { display: flex; gap: 6px; flex-wrap: wrap; align-items: center; }
.es-plabel { font-size: .78rem; font-weight: 800; color: var(--ink-3); margin-right: 2px; white-space: nowrap; }
.es-pmore { border-style: solid; color: var(--brand); font-weight: 750; }
.es-pgroups { display: flex; flex-direction: column; gap: 8px; }
.es-pgroup { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
.es-pgroup .es-plabel { min-width: 104px; }
.es-pchip { display: inline-flex; align-items: center; gap: 4px; min-height: 36px; padding: 0 11px; border-radius: 999px; border: 1px dashed var(--line-2); background: transparent; color: var(--ink-2); font: inherit; font-size: .8rem; font-weight: 650; cursor: pointer; white-space: nowrap; }
.es-pchip:hover { background: var(--bg-3); color: var(--ink); }
@media (max-width: 700px) {
  .es-presets { flex-wrap: nowrap; overflow-x: auto; margin: 0 -16px; padding: 2px 16px 6px; scrollbar-width: none; -webkit-overflow-scrolling: touch; }
  .es-presets::-webkit-scrollbar { display: none; }
  .es-toolbar .select { flex: 1 1 140px; }
}
.es-listinfo { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; font-size: .82rem; color: var(--ink-3); margin-bottom: 8px; }

/* 짐 목록: 표 */
.es-tbl td { vertical-align: middle; }
.es-tbl td.es-ico { width: 34px; font-size: 1.15rem; text-align: center; padding-right: 0; }
.es-namebtn { background: none; border: 0; padding: 4px 0; margin: 0; font: inherit; font-weight: 750; color: var(--ink); text-align: left; cursor: pointer; line-height: 1.35; min-height: 36px; }
.es-namebtn:hover { color: var(--brand); text-decoration: underline; text-underline-offset: 3px; }
.es-namecell { min-width: 150px; }
.es-namewrap { display: flex; flex-wrap: wrap; align-items: center; gap: 2px 6px; }
.es-tbl td { padding-top: 6px; padding-bottom: 6px; }
.es-isel { width: auto; min-width: 104px; min-height: 36px; padding: 4px 8px; font-size: .86rem; }
.es-iqty { width: 70px; min-height: 36px; padding: 4px 8px; }
.es-dim { white-space: nowrap; font-variant-numeric: tabular-nums; font-size: .84rem; color: var(--ink-2); }
.es-room { font-size: .84rem; color: var(--ink-2); }
.es-roomwrap { max-width: 150px; line-height: 1.3; }
.es-roomwrap > span { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.es-roomwrap > span + span { color: var(--ink-3); }
.es-memo { font-size: .76rem; color: var(--ink-3); max-width: 260px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; margin-top: -2px; }
.es-tbl td.es-lgcell { white-space: nowrap; }
.es-tbl td.es-lgcell > * { vertical-align: middle; }
.es-tbl td.es-lgcell .es-link { margin-left: 2px; }
.es-tbl th, .es-tbl td { padding-left: 8px; padding-right: 8px; }
.es-link { display: inline-flex; align-items: center; justify-content: center; width: 36px; height: 36px; border-radius: 10px; text-decoration: none; }
.es-link:hover { background: var(--bg-3); }
.es-tbl tr.is-faded td { opacity: .62; }
.es-tbl tr.is-faded td:nth-child(3) { opacity: 1; }

/* 짐 목록: 카드 */
.es-cards { display: grid; gap: 10px; grid-template-columns: repeat(2, minmax(0, 1fr)); }
@media (max-width: 640px) { .es-cards { grid-template-columns: 1fr; } }
.es-icard { background: var(--bg-2); border: 1px solid var(--line); border-radius: 14px; padding: 10px 12px; display: grid; grid-template-columns: 34px minmax(0, 1fr); gap: 2px 8px; }
.es-icard.is-faded { background: var(--bg); }
.es-icard .es-ico { font-size: 1.35rem; line-height: 1.4; text-align: center; padding-top: 2px; }
.es-icard-top { display: flex; align-items: flex-start; gap: 6px; flex-wrap: wrap; }
.es-icard-top .es-namebtn { flex: 1 1 auto; min-width: 0; padding-top: 2px; }
.es-icard-ctl { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; margin-top: 6px; }
.es-icard-ctl .es-isel { flex: 1 1 120px; }
.es-icard-meta { display: flex; flex-wrap: wrap; gap: 4px 10px; margin-top: 6px; font-size: .8rem; color: var(--ink-3); align-items: center; }
.es-icard-meta .es-link { width: 36px; height: 30px; }
.es-qtylab { font-size: .78rem; color: var(--ink-3); font-weight: 700; display: inline-flex; align-items: center; gap: 6px; }
.es-banner { display: flex; align-items: center; gap: 10px 14px; flex-wrap: wrap; }
.es-banner .es-bnum { font-size: 1.3rem; font-weight: 900; letter-spacing: -.02em; font-variant-numeric: tabular-nums; }
.es-banner .btn { margin-left: auto; }

/* 붙여넣기 */
.es-paste-ta { min-height: 132px; font-size: .92rem; }
.es-pv { display: flex; flex-direction: column; gap: 8px; margin-top: 12px; }
.es-pv-head, .es-pv-row { display: grid; gap: 6px; align-items: center; grid-template-columns: minmax(0, 1.7fr) minmax(0, 1.1fr) minmax(0, .9fr) 58px 62px 62px 62px 38px; }
.es-pv-head { font-size: .72rem; font-weight: 800; color: var(--ink-3); padding: 0 2px; }
.es-pv-row { padding: 8px; border: 1px solid var(--line); border-radius: 12px; background: var(--bg); }
.es-pv-row .input, .es-pv-row .select { min-height: 36px; padding: 4px 8px; font-size: .86rem; }
.es-pv-sub { grid-column: 1 / -1; display: flex; gap: 6px; align-items: center; flex-wrap: wrap; font-size: .76rem; color: var(--ink-3); }
.es-pv-sub .input { flex: 1 1 220px; min-height: 32px; font-size: .8rem; }
.es-pv-row .es-pv-name { grid-column: 1; }
@media (max-width: 720px) {
  .es-pv-head { display: none; }
  .es-pv-row { grid-template-columns: repeat(4, minmax(0, 1fr)); }
  .es-pv-row .es-pv-name { grid-column: 1 / span 3; }
  .es-pv-row .es-pv-del { grid-column: 4; grid-row: 1; justify-self: end; }
  .es-pv-row .es-pv-cat { grid-column: 1 / span 2; }
  .es-pv-row .es-pv-fate { grid-column: 3 / span 2; }
}
.es-pv-lab { display: none; font-size: .68rem; color: var(--ink-3); font-weight: 700; }
@media (max-width: 720px) { .es-pv-lab { display: block; } .es-pv-num { display: flex; flex-direction: column; gap: 2px; } }
.es-export-ta { min-height: 300px; font-family: var(--mono); font-size: .8rem; line-height: 1.5; white-space: pre; }

/* 견적: 히어로 */
.es-hero { background: linear-gradient(135deg, var(--brand-bg) 0%, var(--bg-2) 70%); border-color: color-mix(in srgb, var(--brand) 22%, var(--line)); padding: 18px 20px; }
.es-hero-grid { display: grid; grid-template-columns: minmax(0, 1.1fr) minmax(0, 1fr); gap: 14px 28px; align-items: start; }
@media (max-width: 900px) { .es-hero-grid { grid-template-columns: 1fr; } .es-hero { padding: 16px; } }
.es-eyebrow { font-size: .8rem; font-weight: 800; color: var(--brand); }
.es-big { font-size: clamp(2.1rem, 8vw, 3.2rem); font-weight: 900; letter-spacing: -.04em; line-height: 1.05; font-variant-numeric: tabular-nums; margin: 4px 0 2px; }
.es-big small { font-size: .38em; font-weight: 800; color: var(--ink-2); letter-spacing: 0; margin-left: 4px; }
.es-rangetxt { font-size: .92rem; font-weight: 700; color: var(--ink-2); font-variant-numeric: tabular-nums; }
.es-bar { position: relative; height: 10px; border-radius: 999px; margin: 14px 0 4px; background: linear-gradient(90deg, var(--good-bg), var(--warn-bg), var(--bad-bg)); border: 1px solid var(--line); }
.es-bar .es-bar-mid { position: absolute; top: 50%; width: 16px; height: 16px; margin: -8px 0 0 -8px; border-radius: 50%; background: var(--brand); border: 2px solid var(--bg-2); box-shadow: var(--shadow); }
.es-bar .es-bar-q { position: absolute; top: -5px; width: 3px; height: 18px; margin-left: -1.5px; border-radius: 2px; background: var(--think); }
.es-bar-ends { display: flex; justify-content: space-between; font-size: .72rem; color: var(--ink-3); font-variant-numeric: tabular-nums; }
.es-facts { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 10px; }
.es-facts .chip { font-size: .8rem; line-height: 1.9; }
.es-hero-side { display: flex; flex-direction: column; gap: 10px; }
.es-hero-side .callout { margin: 0; font-size: .86rem; }
.es-lgsum { display: flex; flex-wrap: wrap; align-items: baseline; gap: 4px 10px; padding: 10px 12px; border-radius: 12px; background: var(--kid-bg); color: var(--kid); font-size: .88rem; font-weight: 700; }
.es-lgsum b { font-size: 1.05rem; font-variant-numeric: tabular-nums; }
.es-calib { border: 1px solid color-mix(in srgb, var(--think) 30%, var(--line)); background: var(--think-bg); border-radius: 12px; padding: 10px 12px; font-size: .86rem; }
.es-calib .es-calib-top { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.es-calib .es-calib-top b { color: var(--think); }
.es-calib .row { margin-top: 8px; }
.es-calib p { margin: 4px 0 0; }
.es-calib .es-calib-miss { color: var(--warn); font-weight: 650; line-height: 1.45; }
.es-calib .es-calib-info { color: var(--ink-2); line-height: 1.45; }

/* 견적: 레이아웃 */
.es-est-grid { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1.08fr); gap: 14px; align-items: start; }
.es-est-col { display: flex; flex-direction: column; gap: 14px; min-width: 0; }
@media (max-width: 1100px) { .es-est-grid { grid-template-columns: 1fr; } }
.es-fgrid { display: grid; gap: 10px; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); }
.es-fgrid-2 { display: grid; gap: 10px; grid-template-columns: repeat(2, minmax(0, 1fr)); }
@media (max-width: 420px) { .es-fgrid { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
.es-field { min-width: 0; }
.es-field .input, .es-field .select { min-height: 40px; }
/* 금액 칸 아래 안내(예: 260만원)가 입력 직후 생기며 아래 칸을 밀어 터치가 빗나가지 않게 자리를 미리 잡아 둠 */
.es-field .money-input .hint, .es-coef-ctl .money-input .hint { display: block; min-height: 1.3em; }
.es-seg { display: inline-flex; flex-wrap: wrap; gap: 4px; padding: 4px; background: var(--bg-3); border-radius: 12px; max-width: 100%; }
.es-seg-b { border: 0; background: transparent; color: var(--ink-2); font: inherit; font-weight: 700; font-size: .86rem; padding: 6px 12px; min-height: 36px; border-radius: 9px; cursor: pointer; }
.es-seg-b.is-on { background: var(--bg-2); color: var(--ink); box-shadow: var(--shadow); }
.es-seg-b:disabled { opacity: .45; cursor: not-allowed; }
.es-floorrow { display: grid; grid-template-columns: 92px minmax(0, 1fr); gap: 8px 10px; align-items: end; }
.es-field .es-seg { align-self: flex-start; }
@media (max-width: 420px) {
  .es-floorrow { grid-template-columns: 76px minmax(0, 1fr); gap: 8px; }
  .es-floorrow .es-seg-b { padding: 6px 8px; font-size: .82rem; }
}
.es-note { font-size: .8rem; color: var(--ink-3); margin: 6px 0 0; line-height: 1.5; }
.es-note b { color: var(--ink-2); }
.es-datefact { margin-top: 8px; padding: 10px 12px; border-radius: 12px; background: var(--bg); border: 1px solid var(--line); font-size: .84rem; }
.es-datefact .es-sohn { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 6px; }
.es-rangewrap { display: flex; align-items: center; gap: 10px; }
.es-rangewrap input[type=range] { flex: 1; min-width: 0; height: 36px; accent-color: var(--brand); }
.es-rangewrap output { min-width: 44px; text-align: right; font-weight: 800; font-variant-numeric: tabular-nums; }
.es-boxres { margin-top: 8px; padding: 8px 12px; border-radius: 10px; background: var(--brand-bg); color: var(--brand); font-weight: 750; font-size: .88rem; }
.es-boxres small { display: block; font-weight: 600; color: var(--ink-3); font-size: .76rem; }
.es-autorow { display: grid; grid-template-columns: minmax(0, 1fr) 96px; gap: 4px 10px; align-items: center; padding: 8px 0; border-top: 1px dashed var(--line); }
.es-autorow:first-child { border-top: 0; }
.es-autorow .es-al { font-size: .9rem; font-weight: 700; }
.es-autorow .es-ah { grid-column: 1 / -1; font-size: .76rem; color: var(--ink-3); display: flex; gap: 6px; align-items: center; flex-wrap: wrap; }
.es-autorow .es-ah .btn { min-height: 36px; }
.es-checks { display: flex; flex-direction: column; gap: 8px; }
.es-check { min-height: 36px; }
.es-sub { margin: 6px 0 0 26px; }
.es-acbox { padding: 10px 12px; border-radius: 12px; background: var(--bg); border: 1px solid var(--line); font-size: .86rem; }

/* 견적: 금액 표 */
.es-lines td.es-l-label { min-width: 0; }
.es-lines .es-l-detail { display: block; font-size: .74rem; color: var(--ink-3); font-weight: 500; line-height: 1.4; margin-top: 1px; }
.es-lines tr.is-zero td { color: var(--ink-3); }
.es-lines tr.es-l-sec td { background: var(--bg); font-size: .74rem; font-weight: 800; color: var(--ink-3); padding-top: 6px; padding-bottom: 6px; }
.es-lines tfoot td { font-size: 1rem; }
.es-lines td.num.es-l-typ { font-weight: 800; color: var(--ink); }
.es-l-rng { display: none; font-size: .7rem; color: var(--ink-3); font-weight: 600; }
@media (max-width: 560px) {
  .es-lines th.es-l-lohi, .es-lines td.es-l-lohi { display: none; }
  .es-l-rng { display: block; }
  .es-lines th, .es-lines td { padding: 8px 6px; }
}
.es-why ol { margin: 0; padding-left: 1.3em; }
.es-why li { margin-bottom: 8px; line-height: 1.55; font-size: .9rem; }
.es-why li b { font-variant-numeric: tabular-nums; }
.es-tips { margin: 10px 0 0; padding-left: 1.2em; font-size: .85rem; color: var(--ink-2); }
.es-tips li + li { margin-top: 4px; }
.es-why .callout .es-tips { padding-left: 1.05em; }

/* 계산 기준 */
.es-coef-toggle { display: flex; width: 100%; align-items: center; gap: 10px; background: none; border: 0; padding: 4px 0; font: inherit; color: inherit; cursor: pointer; text-align: left; min-height: 40px; }
.es-coef-toggle h2 { margin: 0; font-size: 1.05rem; }
.es-coef-toggle .es-chev { margin-left: auto; color: var(--ink-3); transition: transform .15s; }
.es-coef-toggle[aria-expanded="true"] .es-chev { transform: rotate(180deg); }
.es-coef-inner { margin-top: 10px; }
.es-coef-grp { border: 1px solid var(--line); border-radius: 12px; margin-top: 8px; background: var(--bg-2); }
.es-coef-grp > summary { list-style: none; cursor: pointer; padding: 10px 12px; font-weight: 800; display: flex; align-items: center; gap: 8px; min-height: 44px; }
.es-coef-grp > summary::-webkit-details-marker { display: none; }
.es-coef-grp > summary .es-gn { margin-left: auto; font-size: .74rem; color: var(--ink-3); font-weight: 700; }
.es-coef-grp[open] > summary { border-bottom: 1px solid var(--line); }
.es-coef-row { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 6px 14px; padding: 10px 12px; border-top: 1px dashed var(--line); align-items: start; }
.es-coef-row:first-of-type { border-top: 0; }
.es-coef-row.is-changed { background: color-mix(in srgb, var(--warn-bg) 55%, transparent); }
.es-coef-label { font-weight: 750; font-size: .9rem; display: flex; gap: 6px; flex-wrap: wrap; align-items: center; }
.es-coef-basis { font-size: .78rem; color: var(--ink-3); line-height: 1.5; margin-top: 2px; }
.es-coef-basis .es-bk { font-weight: 800; color: var(--ink-2); }
.es-coef-ctl { display: flex; align-items: flex-start; gap: 6px; flex-wrap: wrap; justify-content: flex-end; }
.es-coef-ctl .money-input { width: 150px; }
.es-coef-ctl .money-input .hint { text-align: right; }
.es-coef-num { display: inline-flex; align-items: center; gap: 6px; }
.es-coef-num .input { width: 96px; }
.es-unit { font-size: .76rem; color: var(--ink-3); white-space: nowrap; }
.es-coef-ctl .chip { margin-top: 8px; }
.es-coef-ctl .btn { min-height: 36px; }
.es-coef-err { grid-column: 1 / -1; color: var(--bad); font-weight: 700; font-size: .8rem; }
.es-coef-row .input[aria-invalid="true"] { border-color: var(--bad); }
@media (max-width: 640px) {
  .es-coef-row { grid-template-columns: 1fr; }
  .es-coef-ctl { justify-content: flex-start; }
}

/* 업체 견적 */
.es-q-grid { display: grid; grid-template-columns: minmax(0, 1fr) 340px; gap: 14px; align-items: start; }
.es-q-main { display: flex; flex-direction: column; gap: 14px; min-width: 0; }
@media (max-width: 1100px) { .es-q-grid { grid-template-columns: 1fr; } }
.es-qref { display: flex; flex-wrap: wrap; gap: 6px 18px; align-items: baseline; }
.es-qref .es-qref-big { font-size: 1.5rem; font-weight: 900; letter-spacing: -.02em; font-variant-numeric: tabular-nums; }
.es-qlist { display: flex; flex-direction: column; gap: 12px; }
.es-qcard { border-left: 4px solid var(--line-2); }
.es-qcard.is-best { border-left-color: var(--good); }
.es-qcard.is-cheap { border-left-color: var(--bad); }
.es-qcard-head { display: flex; gap: 8px; align-items: center; margin-bottom: 10px; }
.es-qcard-head .es-qname { flex: 1; font-weight: 800; font-size: 1rem; }
.es-qchecks { display: flex; flex-wrap: wrap; gap: 4px 14px; margin-top: 10px; }
.es-qchecks .es-qcl { width: 100%; font-size: .74rem; font-weight: 800; color: var(--ink-3); margin-top: 4px; }
.es-qbadges { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 10px; align-items: center; }
.es-qbadges .chip { font-size: .8rem; line-height: 1.9; }
.es-qwarns { margin: 8px 0 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: 4px; }
.es-qwarns li { font-size: .8rem; line-height: 1.45; padding: 5px 10px; border-radius: 8px; background: var(--bg); border-left: 3px solid var(--line-2); }
.es-qwarns li.is-bad { background: var(--bad-bg); border-color: var(--bad); }
.es-qwarns li.is-warn { background: var(--warn-bg); border-color: var(--warn); }
.es-qwarns li.is-info { background: var(--bg); border-color: var(--kid); }
.es-qnorm { font-size: .78rem; color: var(--ink-3); margin-top: 4px; }
.es-qtbl td.es-qbest { font-weight: 800; }
.es-qco { overflow-wrap: anywhere; word-break: break-word; display: -webkit-box; -webkit-line-clamp: 2; line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.es-qtbl td.es-qco-td { max-width: 240px; min-width: 120px; }
.es-qcmp-card .es-qco { -webkit-line-clamp: 2; }
.es-qcard-head .es-qname { min-width: 0; }
.es-qtbl td { vertical-align: top; }
.es-qtbl td .chip { margin-top: 2px; }
.es-qtbl td .es-qbadges { gap: 4px; }
.es-qtbl td:last-child .chip { font-size: .72rem; padding: 0 7px; }
.es-qcmp-cards { display: none; flex-direction: column; gap: 8px; }
@media (max-width: 760px) { .es-qcmp-tbl { display: none; } .es-qcmp-cards { display: flex; } }
.es-qcmp-card { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 2px 10px; padding: 10px 12px; border: 1px solid var(--line); border-radius: 12px; background: var(--bg); }
.es-qcmp-card .es-qc-amt { font-weight: 900; font-variant-numeric: tabular-nums; text-align: right; }
.es-qcmp-card .es-qc-sub { grid-column: 1 / -1; display: flex; flex-wrap: wrap; gap: 4px; font-size: .78rem; color: var(--ink-3); }
.es-ask ol { margin: 10px 0 0; padding-left: 1.35em; }
.es-ask .es-ask-links { margin: 0 0 10px; }
.es-ask li { font-size: .86rem; line-height: 1.5; margin-bottom: 6px; }
.es-ask-card { position: sticky; top: calc(var(--topbar-h) + 12px); max-height: calc(100vh - var(--topbar-h) - 24px); overflow: auto; }
@media (max-width: 1100px) { .es-ask-card { position: static; max-height: none; } }

/* LG */
.es-lg-cols { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px; }
@media (max-width: 760px) { .es-lg-cols { grid-template-columns: 1fr; } }
.es-lg-cols ul { margin: 0; padding-left: 1.15em; font-size: .88rem; }
.es-lg-cols li + li { margin-top: 4px; }
.es-lg-cols h3 { font-size: .92rem; }
.es-scen { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; }
@media (max-width: 860px) { .es-scen { grid-template-columns: 1fr; } }
.es-scen-c { border: 1px solid var(--line); border-radius: 14px; padding: 12px 14px; background: var(--bg); display: flex; flex-direction: column; gap: 4px; }
.es-scen-c.is-cur { border-color: var(--brand); box-shadow: 0 0 0 2px color-mix(in srgb, var(--brand) 20%, transparent); background: var(--bg-2); }
.es-scen-c .es-scen-t { font-weight: 800; font-size: .9rem; display: flex; gap: 6px; align-items: center; flex-wrap: wrap; }
.es-scen-c .es-scen-big { font-size: 1.45rem; font-weight: 900; letter-spacing: -.02em; font-variant-numeric: tabular-nums; }
.es-scen-c .es-scen-l { display: flex; justify-content: space-between; gap: 8px; font-size: .8rem; color: var(--ink-2); font-variant-numeric: tabular-nums; }
.es-scen-c .es-scen-r { font-size: .74rem; color: var(--ink-3); }
.es-lgitems { display: flex; flex-direction: column; gap: 10px; }
.es-lgi { display: grid; grid-template-columns: 36px minmax(0, 1fr) auto; gap: 4px 10px; padding: 12px; border: 1px solid var(--line); border-radius: 14px; background: var(--bg-2); align-items: start; }
.es-lgi.is-lg { border-color: color-mix(in srgb, var(--kid) 45%, var(--line)); background: color-mix(in srgb, var(--kid-bg) 45%, var(--bg-2)); }
.es-lgi .es-ico { font-size: 1.4rem; text-align: center; line-height: 1.3; }
.es-lgi-name { font-weight: 800; display: flex; flex-wrap: wrap; gap: 4px 6px; align-items: center; }
.es-lgi-meta { font-size: .78rem; color: var(--ink-3); margin-top: 2px; }
.es-lgi-costs { grid-column: 2 / -1; display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; margin-top: 6px; }
.es-lgi-cost { border-radius: 10px; padding: 8px 10px; background: var(--bg); border: 1px solid var(--line); font-size: .82rem; }
.es-lgi-cost.is-on { border-color: var(--brand); background: var(--bg-2); }
.es-lgi-cost b { display: block; font-size: 1.02rem; font-variant-numeric: tabular-nums; }
.es-lgi-cost small { display: block; color: var(--ink-3); font-size: .74rem; line-height: 1.4; }
.es-lgi-does { grid-column: 2 / -1; font-size: .78rem; color: var(--ink-2); margin-top: 4px; }
.es-lgi-does.es-lgi-bad { color: var(--bad); font-weight: 650; }
.es-reco .es-reco-fix { margin: 6px 0 12px; }
.es-lgi-name .es-lgi-nb { font-weight: 800; }
@media (max-width: 560px) {
  .es-lgi { grid-template-columns: 30px minmax(0, 1fr); }
  .es-lgi .es-seg { grid-column: 1 / -1; }
  .es-lgi-costs { grid-column: 1 / -1; grid-template-columns: 1fr 1fr; }
  .es-lgi-does { grid-column: 1 / -1; }
}
.es-reco h3 { margin: 0 0 6px; }
.es-conds { list-style: none; margin: 10px 0 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
.es-conds li { display: flex; align-items: flex-start; gap: 8px; font-size: .88rem; }
.es-conds .es-cmark { flex: none; width: 22px; height: 22px; border-radius: 50%; display: inline-flex; align-items: center; justify-content: center; font-size: .78rem; font-weight: 900; margin-top: 1px; }
.es-conds .is-ok .es-cmark { background: var(--good); color: var(--on-good); }
.es-conds .is-no .es-cmark { background: var(--bg-3); color: var(--ink-3); }
.es-conds .is-bad .es-cmark { background: var(--bad); color: var(--on-bad); }
.es-conds li.es-cond-cb .check { min-height: 36px; align-items: flex-start; }
.es-conds li.es-cond-cb .check input { margin: 2px 2px 0 1px; }
.es-conds li.es-cond-cb.is-bad .check span { color: var(--bad); }
.es-caveats ul { margin: 0; padding-left: 1.2em; font-size: .88rem; }
.es-caveats li + li { margin-top: 5px; }
.es-err { font-size: .85rem; }
/* 부가세 표시 · LG 불가 경고 · 에어컨 대당 비교 */
.es-vat { display: inline-flex; align-items: center; padding: 0 7px; border-radius: 999px; background: var(--bg-3); color: var(--ink-2); font-size: .72rem; font-weight: 750; line-height: 1.7; white-space: nowrap; vertical-align: middle; letter-spacing: 0; }
.es-exline { font-size: .82rem; color: var(--ink-3); margin-top: 2px; line-height: 1.45; }
.es-lgfix { border: 0; font: inherit; font-size: .76rem; font-weight: 750; cursor: pointer; min-height: 36px; padding: 2px 10px; white-space: normal; text-align: left; line-height: 1.3; max-width: 100%; }
.es-lgfix:hover { text-decoration: underline; text-underline-offset: 2px; }
.es-fchip.es-badchip { background: var(--bad-bg); color: var(--bad); border-color: color-mix(in srgb, var(--bad) 35%, var(--line)); }
.es-fchip.es-badchip b { color: var(--bad); }
.es-lgblocked { font-size: .86rem; line-height: 1.5; }
.es-lines tr.es-l-pay td { background: var(--brand-bg); font-weight: 800; }
.es-lines tfoot td .es-vat { margin-left: 2px; }
.es-acmp { margin-top: 12px; padding: 10px 12px; border-radius: 12px; background: var(--bg-2); border: 1px solid var(--line); }
.es-acmp-h { display: flex; flex-wrap: wrap; align-items: baseline; gap: 2px 8px; font-size: .9rem; }
.es-acmp-list { list-style: none; margin: 8px 0; padding: 0; display: flex; flex-direction: column; }
.es-acmp-list li { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 12px; font-size: .86rem; padding: 7px 0; border-top: 1px dashed var(--line); }
.es-acmp-list li:first-child { border-top: 0; }
.es-acmp-n { font-weight: 800; display: inline-flex; gap: 6px; align-items: center; flex-wrap: wrap; min-width: 0; }
.es-acmp-v { font-variant-numeric: tabular-nums; color: var(--ink-2); white-space: nowrap; }
@media (max-width: 400px) { .es-tabs { gap: 2px; } .es-tabs button { padding: 6px 5px; gap: 3px; } }
/* 토스트 (core .toast 에 이 모듈이 붙이는 보조 클래스) — 가운데 기준으로 내용 폭만큼, 버튼은 한 줄 */
.toast.es-toast { width: max-content; max-width: calc(100vw - 32px); box-sizing: border-box; }
.toast.es-toast > span { min-width: 0; }
.toast.es-toast > button { white-space: nowrap; flex: none; min-height: 32px; }
`);

  /* ======================= 화면 상태 (모듈 메모리) ======================= */
  const mem = {
    fates: new Set(), cat: '', q: '', sort: 'cat', onlyAssumed: false,
    coefOpen: false, groupsOpen: new Set(['base', 'vol']), presetsAll: false,
    scrollToTabs: false, focusQuote: null,
  };
  const TABS = [
    { id: 'inventory', label: '짐 목록', short: '짐 목록', icon: '📦' },
    { id: 'estimate', label: '이사 견적', short: '견적', icon: '🧮' },
    { id: 'quotes', label: '업체 견적 비교', short: '업체 비교', icon: '📑' },
    { id: 'lg', label: 'LG·이삿짐센터 비교', short: 'LG·이삿짐센터', icon: '🔌' },
  ];

  /* ---------- 상태 읽기·쓰기 ---------- */
  /* 짐 목록 읽기 — 깨진 항목(null 등)은 건너뜀 */
  const invItems = (f) => MV.inv.list((x) => !!x && typeof x === 'object' && (!f || f(x)));
  const stGet = () => MV.store.get();
  const estSt = () => stGet().estimate || {};
  const inpNow = () => inputsOf(estSt());
  const coefNow = () => coefOf(estSt());
  function ensureEst(st) {
    if (!st.estimate || typeof st.estimate !== 'object') st.estimate = defaults();
    const e = st.estimate;
    if (!e.coef || typeof e.coef !== 'object') e.coef = Object.assign({}, DEF_COEF);
    if (!e.inputs || typeof e.inputs !== 'object') e.inputs = inputDefaults();
    if (!Array.isArray(e.quotes)) e.quotes = [];
    if (!e.calib || typeof e.calib !== 'object') e.calib = { factor: 1, at: null, median: null, n: 0, base: null };
    if (!e.lgChecks || typeof e.lgChecks !== 'object') e.lgChecks = { schedule: false, landlord: false, brand: false };
    return e;
  }
  function setInput(key, value) { MV.store.update((st) => { ensureEst(st).inputs[key] = value; }, { source: 'es' }); }
  function setCoef(key, value, log) { MV.store.update((st) => { ensureEst(st).coef[key] = value; }, { source: 'es', log }); }
  function getQuote(id) { return quotesOf(estSt()).find((q) => q.id === id) || null; }
  function updQuote(id, patch, log) {
    MV.store.update((st) => {
      const q = ensureEst(st).quotes.find((x) => x && x.id === id);
      if (q) Object.assign(q, patch);
    }, { source: 'es', log });
  }

  /* ======================= 다시 그리기 장치 =======================
     - region: 저장소가 바뀌면 통째로 다시 그림 (입력 중인 칸이 안에 있으면 포커스가 빠질 때까지 미룸)
     - updater: 한 번 만든 입력 폼의 값·자동 안내만 바꿈 (입력칸을 지우지 않음)
     - 마우스·손가락을 누르고 있는 동안에는 다시 그리기를 미뤄 클릭이 사라지지 않게 함 */
  let R = null;
  const ptr = { down: false, at: 0, timer: null, retry: null, sel: null };
  function region(build, name) {
    const node = el('div', { class: 'es-region', 'data-region': name || '' });
    const reg = { node, build, name: name || '', dirty: false };
    if (R) R.regions.push(reg);
    fillRegion(reg);
    return node;
  }
  /* null·false 를 걸러 자식 바꾸기 (replaceChildren 은 null 을 글자 'null' 로 넣음) */
  function setKids(node, ...kids) {
    node.replaceChildren(...kids.flat(Infinity).filter((k) => k !== null && k !== undefined && k !== false).map((k) => (k instanceof Node ? k : document.createTextNode(String(k)))));
  }
  function fillRegion(reg) {
    let kids;
    try { kids = reg.build(); } catch (e) {
      console.error('[estimate]', e);
      kids = el('div', { class: 'card tint-bad es-err' }, '이 부분을 그리다 문제가 생겼어요: ' + ((e && e.message) || e));
    }
    reg.node.replaceChildren(...[].concat(kids).flat(Infinity).filter((k) => k !== null && k !== undefined && k !== false).map((k) => (k instanceof Node ? k : document.createTextNode(String(k)))));
    reg.dirty = false;
  }
  function upd(fn, node) {
    if (R) R.updaters.push({ fn, node: node || null });
    try { fn(); } catch (e) { console.error('[estimate]', e); }
  }
  function runUpdaters() {
    if (!R) return;
    R.updaters = R.updaters.filter((u) => !u.node || u.node.isConnected);
    R.updaters.slice().forEach((u) => { try { u.fn(); } catch (e) { console.error('[estimate]', e); } });
  }
  function recompute() { if (R) { R.est = compute(stGet()); R.raw = null; } }
  function rawEst() { if (!R) return compute(stGet(), { calib: false }); if (!R.raw) R.raw = compute(stGet(), { calib: false }); return R.raw; }
  function refreshRegion(reg, a) {
    if (!reg.node.isConnected) return;
    a = a || document.activeElement;
    const inside = a && reg.node.contains(a);
    if (inside && (isTyping(a) || (ptr.sel && reg.node.contains(ptr.sel)))) { reg.dirty = true; R.dirty = true; return; }
    const fk = inside && a.dataset ? a.dataset.fk : null;
    fillRegion(reg);
    if (fk) {
      const n = reg.node.querySelector('[data-fk="' + (window.CSS && CSS.escape ? CSS.escape(fk) : fk) + '"]');
      if (n) { try { n.focus({ preventScroll: true }); } catch (e) { /* 무시 */ } }
    }
  }
  function refreshNamed(names) {
    if (!R) return;
    recompute();
    const a = document.activeElement;
    R.regions.forEach((reg) => { if (!names || names.includes(reg.name)) refreshRegion(reg, a); });
  }
  function refreshAll() {
    if (!R) return;
    R.pending = false;
    R.dirty = false;
    recompute();
    const a = document.activeElement;
    R.regions = R.regions.filter((reg) => reg.node.isConnected);
    R.regions.forEach((reg) => refreshRegion(reg, a));
    runUpdaters();
  }
  function requestRefresh() {
    if (!R) return;
    R.pending = true;
    tryFlush();
  }
  function tryFlush() {
    if (!R || !R.pending) return;
    if (ptr.down && Date.now() - ptr.at < 1200) {
      // 누르고 있는 동안은 미룸 — 손을 떼면(releasePtr) 바로 다시 시도, 길게 누르면 최대 1.2초 뒤
      if (!ptr.retry) ptr.retry = setTimeout(() => { ptr.retry = null; tryFlush(); }, 250);
      return;
    }
    ptr.down = false;
    refreshAll();
  }
  function releasePtr(delay) {
    clearTimeout(ptr.timer);
    ptr.timer = setTimeout(() => { ptr.down = false; tryFlush(); }, delay);
  }
  const onPtrDown = (e) => {
    ptr.down = true; ptr.at = Date.now();
    const s = e.target && e.target.closest ? e.target.closest('select') : null;
    ptr.sel = s || null;
  };
  const onPtrUp = () => releasePtr(350);
  /* 한글 조합 중인지 기억 — 조합이 시작되기 전 글자를 남겨 두었다가, 다른 탭 동기화로 화면이 다시 그려지면 그 글자로 되살려요.
     조합 중인 글자까지 옮기면 IME 가 그 글자를 새 칸에 한 번 더 넣어 ‘냉장고고’처럼 겹쳐요 */
  const ime = { el: null, value: '', s: null, e: null };
  const onCompStart = (e) => {
    const t = e.target;
    if (!t || !('value' in t)) return;
    ime.el = t; ime.value = t.value;
    try { ime.s = t.selectionStart; ime.e = t.selectionEnd; } catch (er) { ime.s = ime.e = null; }
  };
  const onCompEnd = () => { ime.el = null; };
  const onClickCap = () => releasePtr(0);
  const onChangeCap = (e) => { if (ptr.sel && e.target === ptr.sel) ptr.sel = null; releasePtr(0); };
  const onFocusOut = (e) => {
    if (ptr.sel && e.target === ptr.sel) ptr.sel = null;
    setTimeout(() => {
      if (!R) return;
      if (R.pending) { tryFlush(); return; }
      if (R.dirty) {
        R.dirty = false;
        const a = document.activeElement;
        R.regions.forEach((reg) => { if (reg.dirty) refreshRegion(reg, a); });
        runUpdaters();
      }
    }, 0);
  };

  /* ======================= 공용 UI 조각 ======================= */
  function srcLinks(keys) {
    const list = (keys || []).map((k) => SRC[k]).filter(Boolean);
    if (!list.length) return null;
    return el('span', { class: 'es-srcs' }, list.map((s) => el('a', { href: s.url, target: '_blank', rel: 'noopener noreferrer' }, '🔗 ' + s.label)));
  }
  function confChip(conf) { const c = CONF[conf] || CONF.low; return el('span', { class: 'chip ' + c.cls, title: '리서치 신뢰도' }, '신뢰도 ' + c.label); }
  /* 계수 표시: 0.085 처럼 소수 셋째 자리까지 있는 리서치 값을 반올림하지 않고 그대로 (최대 넷째 자리) */
  const fmtDec = (v) => (Number.isInteger(v) ? String(v) : String(parseFloat((+v).toFixed(4))));
  function fmtCoef(d, v) { return d.money ? F.krw(v) : fmtDec(v) + (d.unit ? ' ' + d.unit : ''); }
  function sectionHead(icon, title, sub, act) {
    return el('h2', { class: 'es-h2' }, el('span', { 'aria-hidden': 'true' }, icon), title,
      sub ? el('span', { class: 'es-h2-sub' }, sub) : null, act ? el('span', { class: 'es-h2-act' }, act) : null);
  }
  function goTab(id) { mem.scrollToTabs = true; MV.go('#/stuff/' + id); }
  function disclaimer(compact) {
    return el('div', { class: 'callout warn es-disclaimer' },
      el('span', { class: 'es-dico', 'aria-hidden': 'true' }, '⚠️'),
      el('div',
        el('b', '추정치예요. '),
        compact
          ? '계수 대부분이 리서치 신뢰도 ‘낮음’이에요. 방문견적 3곳을 받으면 ‘견적으로 보정’으로 다시 맞추세요.'
          : '계수(톤당 8만원, 1인 21만원, 할증률, 품목 부피 등) 대부분이 리서치 신뢰도 ‘낮음’이에요. 방문견적 3곳을 받아 ‘업체 견적 비교’에 넣고 ‘견적으로 보정’하세요. 업체에 ‘적정가’라고 내미는 근거로 쓰지는 마세요.'));
  }
  /* LG 불가(다른 브랜드·창문형)인데 LG 표시가 켜진 가전 → 이삿짐센터로 (되돌리기 가능).
     견적·자금·대시보드는 이미 이삿짐센터 짐으로 계산하지만, 짐 목록의 표시도 맞춰 두면 업체·LG 예약 때 헷갈리지 않아요 */
  function switchToMover(ids) {
    ids = Array.from(new Set(ids || []));
    if (!ids.length) return;
    const names = invItems((x) => ids.includes(x.id)).map(nm);
    const setLg = (v) => (st) => { (st.inventory || []).forEach((x) => { if (x && ids.includes(x.id)) x.lg = v; }); };
    MV.store.update(setLg(false), { log: 'LG 불가 가전을 이삿짐센터로: ' + names.join(', ') });
    toast(names.length === 1 ? '‘' + clip(names[0], 20) + '’ — 이삿짐센터로 바꿨어요.' : names.length + '개를 이삿짐센터로 바꿨어요.',
      { action: { label: '되돌리기', onClick: () => MV.store.update(setLg(true), { log: 'LG 표시 되돌림: ' + names.join(', ') }) } });
  }
  const blockedWhy = (it) => (lgKind(it) === 'ac_window' ? '창문형 에어컨은 LG 이전설치가 필요 없어요' : '다른 브랜드로 보여요 — LG 이전설치는 LG 제품만 돼요');
  function lgFixChip(it) {
    return el('button', {
      type: 'button', class: 'chip bad es-lgfix', 'data-fk': 'lgfix-' + it.id,
      title: 'LG 표시가 켜져 있지만 ' + blockedWhy(it) + '. 견적은 이삿짐센터가 옮기는 것으로 계산했어요. 눌러서 이삿짐센터로 바꾸세요.',
      onclick: () => switchToMover([it.id]),
    }, '⚠ LG 불가 — 이삿짐센터로 바꾸기');
  }
  function lgBlockedCallout(est) {
    const bl = (est && Array.isArray(est.lgBlocked)) ? est.lgBlocked : [];
    if (!bl.length) return null;
    return el('div', { class: 'callout bad es-lgblocked' },
      el('b', '⚠ LG 불가인데 LG 표시: '), bl.map((b) => b.name).join(', '),
      ' — LG 이전설치를 맡길 수 없어 이삿짐센터 비용에 넣어 계산했어요.',
      el('div', { class: 'mt-8' }, el('button', { type: 'button', class: 'btn btn-sm btn-primary', 'data-fk': 'lgfix-hero', onclick: () => switchToMover(bl.map((b) => b.id)) }, '🚚 ' + bl.length + '개 이삿짐센터로 바꾸기')));
  }
  function copyText(text, ta) {
    const done = () => toast('복사했어요. 문자·카톡에 붙여 넣으세요.');
    const fallback = () => {
      try {
        const t = ta || el('textarea', { style: { position: 'fixed', left: '-9999px', top: '0' } }, text);
        if (!ta) document.body.appendChild(t);
        t.focus(); t.select();
        const ok = document.execCommand('copy');
        if (!ta) t.remove();
        if (ok) done(); else toast('복사하지 못했어요. 글자를 길게 눌러 직접 복사하세요.');
      } catch (e) { toast('복사하지 못했어요. 글자를 길게 눌러 직접 복사하세요.'); }
    };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, fallback);
    else fallback();
  }

  /* ======================= 머리말 + 탭 ======================= */
  function headEl() {
    return region(() => {
      const est = R.est;
      const n = invItems().length;
      // 머리말 숫자는 자금·LG 탭과 같은 ‘부가세 포함’(실제로 낼 돈)으로, 부가세 별도는 보조로
      return el('div', { class: 'view-head es-head' },
        el('div',
          el('h1', '🚚 짐·견적'),
          el('div', { class: 'sub' }, '짐 ', el('b', n + '개'), ' · 예상 이사비 ', el('b', '약 ' + won(est.pay.typical)), ' ', el('span', { class: 'es-vat' }, '부가세 포함'),
            ' (' + won(est.pay.low) + '~' + won(est.pay.high) + ') · 부가세 별도 약 ' + won(est.ex.typical) + ' · 추정치')),
        R.tab === 'inventory' ? null : el('div', { class: 'actions' },
          el('button', { type: 'button', class: 'btn btn-sm', onclick: openExport }, '📋 업체에 보낼 짐 목록')));
    }, 'head');
  }
  function tabsEl(cur) {
    const est = estSt();
    const counts = { inventory: invItems().length, quotes: quotesOf(est).length };
    const bar = el('div', { class: 'tabs es-tabs', role: 'tablist', 'aria-label': '짐·견적 화면' },
      TABS.map((t) => el('button', {
        type: 'button', role: 'tab', class: t.id === cur ? 'active' : '', 'aria-selected': String(t.id === cur),
        'data-tab': t.id, title: t.label,
        onclick: () => { if (t.id !== cur) goTab(t.id); },
      }, el('span', { class: 'es-ti', 'aria-hidden': 'true' }, t.icon), el('span', { class: 'es-tl' }, t.label), el('span', { class: 'es-ts' }, t.short),
      counts[t.id] ? el('span', { class: 'es-tn' }, String(counts[t.id])) : null)));
    upd(() => {
      const e = estSt();
      const cs = { inventory: invItems().length, quotes: quotesOf(e).length };
      bar.querySelectorAll('button[data-tab]').forEach((b) => {
        const id = b.dataset.tab;
        let tn = b.querySelector('.es-tn');
        if (cs[id]) { if (!tn) { tn = el('span', { class: 'es-tn' }); b.appendChild(tn); } tn.textContent = String(cs[id]); } else if (tn) tn.remove();
      });
    });
    return bar;
  }

  /* ======================= 1) 짐 목록 ======================= */
  function fateCounts(inv) {
    const m = {};
    MV.inv.FATES.forEach((f) => { m[f.id] = 0; });
    inv.forEach((it) => { const f = FATE_IDS.has(it.fate) ? it.fate : 'undecided'; m[f]++; });
    return m;
  }
  function invFiltered() {
    const q = mem.q.trim().toLowerCase();
    let list = invItems((it) => {
      const f = FATE_IDS.has(it.fate) ? it.fate : 'undecided';
      if (mem.fates.size && !mem.fates.has(f)) return false;
      if (mem.cat && it.cat !== mem.cat) return false;
      if (mem.onlyAssumed && !it.assumed) return false;
      if (q) {
        const hay = [it.name, it.note, it.room, it.roomNew, MV.inv.cat(it.cat).label, MV.inv.fate(it.fate).label].join(' ').toLowerCase();
        if (!q.split(/\s+/).every((w) => hay.includes(w))) return false;
      }
      return true;
    });
    const catIdx = (id) => { const i = MV.inv.CATS.findIndex((c) => c.id === id); return i < 0 ? 99 : i; };
    const fateIdx = (id) => { const i = MV.inv.FATES.findIndex((c) => c.id === id); return i < 0 ? 99 : i; };
    const byName = (a, b) => String(a.name).localeCompare(String(b.name), 'ko');
    const sorts = {
      cat: (a, b) => catIdx(a.cat) - catIdx(b.cat) || byName(a, b),
      room: (a, b) => (a.room ? 0 : 1) - (b.room ? 0 : 1) || String(a.room).localeCompare(String(b.room), 'ko') || catIdx(a.cat) - catIdx(b.cat) || byName(a, b),
      vol: (a, b) => rawVol(b) - rawVol(a) || byName(a, b),
      fate: (a, b) => fateIdx(a.fate) - fateIdx(b.fate) || catIdx(a.cat) - catIdx(b.cat) || byName(a, b),
      name: byName,
    };
    list.sort(sorts[mem.sort] || sorts.cat);
    return list;
  }
  function filtersActive() { return mem.fates.size || mem.cat || mem.onlyAssumed || mem.q.trim(); }
  function clearFilters() {
    mem.fates.clear(); mem.cat = ''; mem.onlyAssumed = false; mem.q = '';
    if (R && R.searchInput) R.searchInput.value = '';
    if (R && R.catSelect) R.catSelect.value = '';
    refreshNamed(['invsum', 'invlist']);
  }

  function invSummary() {
    const inv = invItems();
    const fc = fateCounts(inv);
    const moveVol = sum(inv.filter((it) => it.fate === 'move'), rawVol);
    const assumed = inv.filter((it) => it.assumed).length;
    const inpS = inpNow();
    const lg = sum(inv.filter((it) => lgActive(it, inpS)), qtyOf);
    const blocked = inv.filter((it) => lgBlockedIt(it, inpS));
    const fchips = MV.inv.FATES.map((f) => el('button', {
      type: 'button', class: 'es-fchip' + (mem.fates.has(f.id) ? ' is-on' : ''), 'data-tone': f.cls || '',
      'aria-pressed': String(mem.fates.has(f.id)), 'data-fk': 'fate-filter-' + f.id,
      title: f.label + '만 보기 (여러 개 고를 수 있어요)',
      onclick: () => { if (mem.fates.has(f.id)) mem.fates.delete(f.id); else mem.fates.add(f.id); refreshNamed(['invsum', 'invlist']); },
    }, el('span', { class: 'es-dot', 'aria-hidden': 'true' }), f.label, el('b', String(fc[f.id] || 0))));
    return el('section', { class: 'card es-sumbar', 'aria-label': '짐 요약' },
      el('div', { class: 'es-chiprow' },
        el('span', { class: 'es-stat', title: '처리가 ‘가져감’인 짐의 가로×깊이×높이 합 (수량 포함)' }, '📦 가져갈 짐 ', el('b', m3(moveVol))),
        el('span', { class: 'es-stat', style: { background: 'var(--bg-3)', color: 'var(--ink-2)' } }, '전체 ', el('b', inv.length + '개')),
        lg ? el('span', { class: 'es-stat', title: 'LG 서비스로 따로 옮길 가전 (처리 ‘미정’ 포함 여부는 견적 설정을 따름)' }, '🔌 LG ', el('b', lg + '대')) : null,
        assumed ? el('button', {
          type: 'button', class: 'es-fchip es-warnchip' + (mem.onlyAssumed ? ' is-on' : ''), 'aria-pressed': String(mem.onlyAssumed),
          'data-fk': 'assumed-filter', title: '규격이 추정치인 짐만 보기',
          onclick: () => { mem.onlyAssumed = !mem.onlyAssumed; refreshNamed(['invsum', 'invlist']); },
        }, '⚠ 규격 확인 필요 ', el('b', assumed + '개')) : null,
        blocked.length ? el('button', {
          type: 'button', class: 'es-fchip es-warnchip es-badchip', 'data-fk': 'lgfix-all',
          title: blocked.map(nm).join(', ') + ' — LG 표시가 켜져 있지만 LG 이전설치를 맡길 수 없어요. 눌러서 이삿짐센터로 바꾸세요.',
          onclick: () => switchToMover(blocked.map((it) => it.id)),
        }, '⚠ LG 불가 ', el('b', blocked.length + '개'), ' — 이삿짐센터로 바꾸기') : null),
      el('div', { class: 'es-chiprow', role: 'group', 'aria-label': '처리별 보기' }, fchips));
  }

  function invToolbar() {
    const search = el('input', { class: 'input es-search', type: 'search', placeholder: '이름·메모·위치로 찾기', value: mem.q, 'aria-label': '짐 검색', 'data-fk': 'inv-search' });
    const deb = MV.debounce(() => refreshNamed(['invlist']), 160);
    search.addEventListener('input', () => { mem.q = search.value; deb(); });
    search.addEventListener('keydown', (e) => { if (e.key === 'Escape' && search.value) { e.preventDefault(); search.value = ''; mem.q = ''; refreshNamed(['invlist']); } });
    const counts = {};
    invItems().forEach((it) => { counts[it.cat] = (counts[it.cat] || 0) + 1; });
    const cat = el('select', { class: 'select', 'aria-label': '분류', 'data-fk': 'inv-cat' },
      el('option', { value: '' }, '모든 분류'),
      MV.inv.CATS.map((c) => el('option', { value: c.id, selected: mem.cat === c.id }, c.icon + ' ' + c.label + (counts[c.id] ? ' (' + counts[c.id] + ')' : ''))));
    cat.addEventListener('change', () => { mem.cat = cat.value; refreshNamed(['invsum', 'invlist']); });
    const sort = el('select', { class: 'select', 'aria-label': '정렬', 'data-fk': 'inv-sort' },
      [['cat', '분류순'], ['room', '지금 방순'], ['vol', '부피 큰 순'], ['fate', '처리순'], ['name', '이름순']].map(([v, l]) => el('option', { value: v, selected: mem.sort === v }, '정렬: ' + l)));
    sort.addEventListener('change', () => { mem.sort = sort.value; refreshNamed(['invlist']); });
    if (R) { R.searchInput = search; R.catSelect = cat; }
    upd(() => {
      const cs = {};
      invItems().forEach((it) => { cs[it.cat] = (cs[it.cat] || 0) + 1; });
      Array.from(cat.options).forEach((o) => {
        if (!o.value) return;
        const cc = MV.inv.cat(o.value);
        const t = cc.icon + ' ' + cc.label + (cs[o.value] ? ' (' + cs[o.value] + ')' : '');
        if (o.textContent !== t) o.textContent = t;
      });
    });
    return el('section', { class: 'card flat', 'aria-label': '짐 추가·찾기' },
      el('div', { class: 'es-actions' },
        el('button', { type: 'button', class: 'btn btn-primary', onclick: () => MV.inv.editor(null) }, '+ 짐 추가'),
        el('button', { type: 'button', class: 'btn', onclick: openPaste }, '📝 여러 개 붙여넣기'),
        el('button', { type: 'button', class: 'btn', onclick: openExport }, '📋 업체에 보낼 짐 목록')),
      presetRow(),
      el('div', { class: 'es-toolbar mt-12' }, search, cat, sort));
  }
  function presetRow() {
    const cat = MV.catalog || [];
    if (!cat.length) return null;
    const wrap = el('div', { class: 'es-presetwrap mt-12' });
    const chip = (c, i) => el('button', {
      type: 'button', class: 'es-pchip', title: c.name + ' (' + c.w + '×' + c.d + '×' + c.h + 'cm) 규격으로 추가',
      onclick: () => MV.inv.editor(null, { preset: i }),
    }, MV.inv.cat(c.cat).icon + ' ' + c.name);
    const draw = () => {
      const toggle = cat.length > 10 ? el('button', { type: 'button', class: 'es-pchip es-pmore', 'aria-expanded': String(mem.presetsAll), onclick: () => { mem.presetsAll = !mem.presetsAll; draw(); } },
        mem.presetsAll ? '접기 ▴' : '모든 규격 ' + cat.length + '개 ▾') : null;
      if (!mem.presetsAll || cat.length <= 10) {
        // 분류마다 첫 번째 규격 하나씩 (최대 10개)
        const seen = new Set();
        const picks = [];
        MV.inv.CATS.forEach((cc) => { const i = cat.findIndex((p) => p.cat === cc.id); if (i >= 0 && !seen.has(i)) { seen.add(i); picks.push(i); } });
        cat.forEach((p, i) => { if (picks.length < 10 && !seen.has(i)) { seen.add(i); picks.push(i); } });
        wrap.replaceChildren(el('div', { class: 'es-presets', role: 'group', 'aria-label': '많이 쓰는 규격으로 추가' },
          el('span', { class: 'es-plabel' }, '빠른 추가'), picks.slice(0, 10).map((i) => chip(cat[i], i)), toggle));
        return;
      }
      const groups = MV.inv.CATS.map((cc) => ({ cc, idx: cat.map((p, i) => (p.cat === cc.id ? i : -1)).filter((i) => i >= 0) })).filter((g) => g.idx.length);
      const other = cat.map((p, i) => (MV.inv.CATS.some((cc) => cc.id === p.cat) ? -1 : i)).filter((i) => i >= 0);
      wrap.replaceChildren(el('div', { class: 'es-pgroups', role: 'group', 'aria-label': '모든 규격' },
        groups.map((g) => el('div', { class: 'es-pgroup' }, el('span', { class: 'es-plabel' }, g.cc.icon + ' ' + g.cc.label), g.idx.map((i) => chip(cat[i], i)))),
        other.length ? el('div', { class: 'es-pgroup' }, el('span', { class: 'es-plabel' }, '기타'), other.map((i) => chip(cat[i], i))) : null,
        el('div', toggle)));
    };
    draw();
    return wrap;
  }
  /* 표는 화면(뷰) 폭이 충분할 때만 — 뷰 폭으로 판단해서 왼쪽 메뉴가 있는 1024px 데스크톱·갤럭시탭 가로처럼
     표가 잘리는 폭에서는 카드로 보여 줘요 (가로 스크롤로 LG·링크 칸이 숨지 않게) */
  const TABLE_MIN_VIEW = 1020;
  function viewWidth() { return (R && R.root && R.root.clientWidth) || document.documentElement.clientWidth || window.innerWidth || 1280; }
  const tableMode = () => viewWidth() >= TABLE_MIN_VIEW;
  function fateSelect(it) {
    const s = el('select', { class: 'select es-isel', 'aria-label': nm(it) + ' 처리', 'data-fk': 'fate-' + it.id },
      MV.inv.FATES.map((f) => el('option', { value: f.id, selected: f.id === it.fate }, f.label)));
    if (!FATE_IDS.has(it.fate)) s.value = 'undecided';
    s.addEventListener('change', () => {
      const f = s.value;
      // 버림·판매·새로 구매로 바꾸면 LG가 옮길 일이 없으니 LG 표시도 함께 꺼요
      const dropLg = !!it.lg && (f === 'discard' || f === 'sell' || f === 'buy');
      MV.inv.update(it.id, dropLg ? { fate: f, lg: false } : { fate: f }, '짐 처리 변경: ' + nm(it) + ' → ' + MV.inv.fate(f).label + (dropLg ? ' (LG 표시 끔)' : ''));
      if (dropLg) toast('‘' + clip(nm(it), 20) + '’ — ' + josa(MV.inv.fate(f).label, '으로/로') + ' 바꿔 LG 표시도 껐어요.');
    });
    return s;
  }
  function qtyInput(it) {
    const q = el('input', { class: 'input num es-iqty', type: 'number', min: '0', max: String(QTY_MAX), step: '1', inputmode: 'numeric', value: String(qtyOf(it)), 'aria-label': nm(it) + ' 수량', 'data-fk': 'qty-' + it.id });
    q.addEventListener('change', () => {
      const v0 = Math.max(0, Math.round(num(q.value, NaN)));
      if (!isFinite(v0)) { q.value = String(qtyOf(it)); return; }
      const v = Math.min(QTY_MAX, v0);
      if (v !== v0) { q.value = String(v); toast('수량은 ' + QTY_MAX + '개까지 넣을 수 있어요.'); }
      if (v !== qtyOf(it)) MV.inv.update(it.id, { qty: v }, '짐 수량: ' + nm(it) + ' ' + v + '개');
    });
    q.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); q.blur(); } });
    return q;
  }
  function linkEl(it) {
    const u = safeUrl(it.url);
    return u ? el('a', { class: 'es-link', href: u, target: '_blank', rel: 'noopener noreferrer', title: u, 'aria-label': nm(it) + ' 제품 링크 열기' }, '🔗') : null;
  }
  const dimTxt = (it) => Math.round(num(it.w, 0)) + '×' + Math.round(num(it.d, 0)) + '×' + Math.round(num(it.h, 0));
  const roomTxt = (it) => (it.room || '—') + ' → ' + (it.roomNew || '—');
  function nameBtn(it) {
    return el('button', { type: 'button', class: 'es-namebtn', 'data-fk': 'name-' + it.id, title: '눌러서 고치기', onclick: () => MV.inv.editor(it.id) }, nm(it) || '이름 없는 짐');
  }
  function invList() {
    const all = invItems();
    if (!all.length) {
      return el('section', { class: 'card' }, el('div', { class: 'empty' },
        el('span', { class: 'big', 'aria-hidden': 'true' }, '📦'),
        el('p', '아직 짐 목록이 비어 있어요. 큰 가구·가전부터 넣으면 이사비가 자동으로 계산돼요.'),
        el('div', { class: 'row', style: { justifyContent: 'center' } },
          el('button', { type: 'button', class: 'btn btn-primary', onclick: () => MV.inv.editor(null) }, '+ 짐 추가'),
          el('button', { type: 'button', class: 'btn', onclick: openPaste }, '📝 여러 개 붙여넣기'))));
    }
    const list = invFiltered();
    const info = el('div', { class: 'es-listinfo' },
      el('span', filtersActive() ? list.length + '개 표시 (전체 ' + all.length + '개)' : '전체 ' + all.length + '개 · 이름을 누르면 고칠 수 있어요'),
      filtersActive() ? el('button', { type: 'button', class: 'btn btn-sm btn-ghost', onclick: clearFilters }, '✕ 필터 지우기') : null);
    if (!list.length) {
      return el('section', { class: 'card' }, info, el('div', { class: 'empty' }, el('span', { class: 'big', 'aria-hidden': 'true' }, '🔍'), '조건에 맞는 짐이 없어요.'));
    }
    const faded = (it) => it.fate !== 'move' && it.fate !== 'undecided';
    const inpL = inpNow();
    if (R) R.tableMode = tableMode();
    if (R ? R.tableMode : tableMode()) {
      const tbl = el('table', { class: 'tbl es-tbl' },
        el('thead', el('tr',
          el('th', { 'aria-label': '분류' }, ''), el('th', '이름 · 메모'), el('th', '처리'), el('th', { class: 'num' }, '수량'),
          el('th', { title: '가로×깊이×높이' }, '크기 (cm)'), el('th', { class: 'num' }, '부피'), el('th', '지금 → 새 집'),
          el('th', { class: 'center' }, 'LG · 링크'))),
        el('tbody', list.map((it) => el('tr', { class: faded(it) ? 'is-faded' : '' },
          el('td', { class: 'es-ico', title: MV.inv.cat(it.cat).label }, MV.inv.cat(it.cat).icon),
          el('td', { class: 'es-namecell' }, el('div', { class: 'es-namewrap' }, nameBtn(it),
            it.assumed ? el('span', { class: 'chip warn', title: '규격을 아직 재지 않은 추정치' }, '추정치') : null,
            isAircon(it) && it.ac ? el('span', { class: 'chip' }, AC_LABEL[it.ac] || it.ac) : null,
            lgBlockedIt(it, inpL) ? lgFixChip(it) : null),
            it.note ? el('div', { class: 'es-memo', title: it.note }, clip(it.note, 80)) : null),
          el('td', fateSelect(it)),
          el('td', { class: 'num' }, qtyInput(it)),
          el('td', { class: 'es-dim', title: '가로×깊이×높이' }, dimTxt(it)),
          el('td', { class: 'num' }, m3(rawVol(it))),
          el('td', { class: 'es-room', title: '지금 집: ' + (it.room || '—') + ' → 새 집: ' + (it.roomNew || '—') },
            el('div', { class: 'es-roomwrap' }, el('span', it.room || '—'), el('span', '→ ' + (it.roomNew || '—')))),
          el('td', { class: 'center es-lgcell' },
            lgActive(it, inpL) ? el('span', { class: 'chip kid', title: 'LG 서비스로 옮김' }, 'LG ✓') : null,
            linkEl(it),
            !lgActive(it, inpL) && !safeUrl(it.url) ? el('span', { class: 'es-muted' }, '—') : null)))));
      return el('section', { class: 'card' }, info, el('div', { class: 'table-wrap' }, tbl));
    }
    const cards = el('div', { class: 'es-cards' }, list.map((it) => el('article', { class: 'es-icard' + (faded(it) ? ' is-faded' : '') },
      el('div', { class: 'es-ico', 'aria-hidden': 'true' }, MV.inv.cat(it.cat).icon),
      el('div',
        el('div', { class: 'es-icard-top' }, nameBtn(it),
          it.assumed ? el('span', { class: 'chip warn' }, '추정치') : null,
          lgActive(it, inpL) ? el('span', { class: 'chip kid' }, 'LG ✓') : null,
          lgBlockedIt(it, inpL) ? lgFixChip(it) : null),
        el('div', { class: 'es-icard-ctl' }, fateSelect(it), el('label', { class: 'es-qtylab' }, '수량', qtyInput(it))),
        el('div', { class: 'es-icard-meta' },
          el('span', { class: 'es-dim' }, dimTxt(it) + 'cm'),
          el('span', m3(rawVol(it))),
          el('span', roomTxt(it)),
          isAircon(it) && it.ac ? el('span', AC_LABEL[it.ac] || it.ac) : null,
          linkEl(it)),
        it.note ? el('div', { class: 'es-icard-meta', title: it.note }, clip(it.note, 90)) : null))));
    return el('section', { class: 'card' }, info, cards);
  }
  function invBanner() {
    const est = R.est;
    return el('section', { class: 'card tint-brand es-banner' },
      el('div',
        el('div', { class: 'small strong' }, '이 짐 목록으로 계산한 예상 이사비 (이삿짐센터)'),
        el('div', el('span', { class: 'es-bnum' }, '약 ' + won(est.pay.typical)), ' ', el('span', { class: 'es-vat' }, '부가세 포함'),
          el('span', { class: 'small es-muted' }, ' · ' + won(est.pay.low) + '~' + won(est.pay.high))),
        el('div', { class: 'small es-muted' }, '부가세 별도 약 ' + won(est.ex.typical) + ' · ' + tonsLabel(est.tons) + ' · ' + est.crewLabel + ' · 짐 ' + m3(est.volume))),
      el('button', { type: 'button', class: 'btn btn-primary', onclick: () => goTab('estimate') }, '이사 견적 자세히 →'));
  }
  function renderInventory(body) {
    body.appendChild(region(invSummary, 'invsum'));
    body.appendChild(invToolbar());
    body.appendChild(region(invList, 'invlist'));
    body.appendChild(region(invBanner, 'invbanner'));
  }

  /* ---------- 여러 개 붙여넣기 ---------- */
  const TAG_WORDS = {
    fridge: /냉장고|김치/, washer: /세탁기|통돌이|드럼/, dryer: /건조기/, aircon: /에어컨/, bed: /침대|매트리스/,
    sofa: /소파|쇼파/, table: /식탁|테이블/, desk: /책상/, shelf: /책장|선반|책꽂이/, wardrobe: /옷장|장롱|행거/, tv: /TV|티비|텔레비/i,
  };
  const CAT_WORDS = [
    ['aircon', /에어컨/], ['appliance', /냉장고|김치|세탁기|통돌이|건조기|식기세척기|식세기|오븐|전자레인지|정수기|스타일러|청소기/],
    ['bed', /침대|매트리스|토퍼/], ['sofa', /소파|쇼파|의자|안락/], ['shelf', /책장|선반|책꽂이|랙/],
    ['storage', /옷장|장롱|행거|서랍|수납|수납장|붙박이|화장대|신발장|거실장|TV장|티비장/i], ['table', /책상|식탁|테이블|좌탁/],
    ['electronics', /TV|티비|모니터|컴퓨터|PC|프린터|오디오|스피커/i], ['kids', /아이|키즈|어린이|유아|장난감|놀이|아기/],
  ];
  /* 규격 프리셋 고르기 — 낱말 단위로만 맞춤 (예전: '건조'가 '빨래 건조대'에 부분 일치해 세탁기로 잘못 분류)
     · 같은 낱말 → 낱말 길이만큼 점수
     · 이름 낱말이 프리셋 낱말로 끝남(합성어의 머리말: '퀸침대'⊃'침대') → 점수
     · 이름 낱말이 3글자 이상이고 프리셋 낱말의 앞부분('매트리스' → '매트리스만') → 점수
     · 이름 낱말이 프리셋 낱말(3글자 이상)로 시작 → 점수.  2글자 앞부분 일치('건조' → '건조대')는 인정하지 않음 */
  const tokensOf = (s) => String(s || '').toLowerCase().split(/[\s+·,()\/\[\]{}:;~\-_|]+/).filter(Boolean);
  function presetWords(p) {
    return String(p.name || '').toLowerCase()
      .replace(/\d+(?:\.\d+)?\s*(?:kg|형|인용|인|단|l|리터|인치)?/gi, ' ')
      .split(/[\s+·,()\/]+/)
      .map((w) => (w.length > 2 ? w.replace(/(만|용|형)$/, '') : w))
      .filter(Boolean);
  }
  function wordScore(w, toks) {
    let best = 0;
    toks.forEach((t) => {
      let sc = 0;
      if (t === w) sc = w.length;
      else if (w.length >= 2 && t.endsWith(w)) sc = w.length;
      else if (t.length >= 3 && w.startsWith(t)) sc = t.length;
      else if (w.length >= 3 && t.startsWith(w)) sc = w.length;
      if (sc > best) best = sc;
    });
    return best;
  }
  const numsIn = (x) => (String(x || '').match(/\d+/g) || []).map(Number);
  /* 이름의 분류: 끝 낱말 기준(‘전자레인지 선반’ → 선반), 끝 낱말로 모르면 이름 전체 */
  function headCat(name) {
    const toks = tokensOf(name).filter((t) => !/^\d/.test(t));
    const last = toks.length ? guessCat(toks[toks.length - 1]) : 'misc';
    return last !== 'misc' ? last : guessCat(name);
  }
  function matchPreset(name) {
    const cat = MV.catalog || [];
    const toks = tokensOf(name);
    if (!toks.length) return null;
    const nameCat = headCat(name);
    const nameNums = new Set(numsIn(name));
    let best = null, bestScore = 0;
    cat.forEach((p) => {
      if (!p || !p.name) return;
      const words = presetWords(p);
      let score = 0;
      const unmatched = [];
      words.forEach((w) => { const sc = wordScore(w, toks); score += sc; if (!sc) unmatched.push(w); });
      if (score <= 0) return;
      // 다른 분류의 물건을 담는 가구 프리셋(예: ‘전자레인지 수납장’)은 이름에 그 가구 낱말이 없으면 건너뜀 (‘전자레인지’ → 180cm 수납장 방지)
      if (nameCat !== 'misc' && p.cat !== nameCat && unmatched.some((w) => CAT_WORDS.some(([, re]) => re.test(w)))) return;
      // ‘매트리스만 (퀸)’ 같은 ‘~만’ 프리셋은 이름에 같은 분류의 다른 물건(예: ‘침대’)이 있으면 건너뜀
      if (/[가-힣]{2,}만(\s|\(|$)/.test(p.name)) {
        const own = new Set(words);
        const catRe = (CAT_WORDS.find(([id]) => id === p.cat) || [])[1];
        const others = new Set();
        cat.forEach((o) => { if (o && o !== p && o.cat === p.cat) presetWords(o).forEach((w) => { if (!own.has(w) && catRe && catRe.test(w)) others.add(w); }); });
        if (Array.from(others).some((w) => wordScore(w, toks) > 0)) return;
      }
      const kw = TAG_WORDS[p.tag];
      if (kw && kw.test(name)) score += 1;
      // 크기 숫자가 같으면 더 가깝게 (예: ‘65인치 TV’ → ‘TV 65형’, ‘책상 120’ → ‘책상 120’)
      if (numsIn(p.name).some((n) => nameNums.has(n))) score += 3;
      if (score > bestScore) { bestScore = score; best = p; }
    });
    return bestScore >= 2 ? best : null;
  }
  function guessCat(name) { const f = CAT_WORDS.find(([, re]) => re.test(name)); return f ? f[0] : 'misc'; }
  /* 엑셀 머리줄('이름 가로 깊이 높이 수량')은 짐이 아니라 건너뜀 */
  const HEADER_WORD = /^(이름|품목|물품|항목|품명|가로|세로|폭|너비|깊이|높이|수량|개수|링크|url|주소|메모|비고|위치|방|분류|처리|w|d|h|cm|크기|규격)$/i;
  function isHeaderLine(s) {
    if (/\d/.test(s)) return false;
    const toks = s.split(/[\t,，;|]+|\s{2,}|\s+/).map((t) => t.trim().replace(/\s*\([^)]*\)\s*$/, '')).filter(Boolean);
    return toks.length >= 2 && toks.filter((t) => HEADER_WORD.test(t)).length >= 2;
  }
  /* '안방:' '[거실]' 같은 위치 머리말 — 방 이름처럼 보일 때만 위치로 (예: '냉장고: LG 디오스'는 이름으로) */
  const ROOM_WORD = /(방|거실|주방|부엌|베란다|발코니|현관|드레스룸|서재|욕실|화장실|다용도실|창고|복도|침실|팬트리|세탁실|알파룸)\s*\d*$/;
  function planRoomNames() {
    const plans = MV.plans || {};
    const out = new Set();
    [plans.old, plans.new].forEach((pl) => { ((pl && pl.rooms) || []).forEach((r) => { if (r && r.name) out.add(String(r.name).trim()); }); });
    return out;
  }
  const UNIT_SCALE = { cm: 1, 센티: 1, 센치: 1, mm: 0.1, 미리: 0.1, m: 100, 미터: 100 };
  const DIM_N = '(\\d+(?:\\.\\d+)?)';
  const DIM_U = '(?:\\s*(cm|mm|m(?![a-z])|센티|센치|미리|미터))?'; // 단위가 있을 때만 앞 공백을 먹음 (‘160x200 x2’의 띄어쓰기를 구분에 남김)
  const DIM_X = '(\\s*[x×X*✕]\\s*)';
  /* 그룹: 1 가로, 2 단위, 3 구분, 4 깊이, 5 단위, 6 구분, 7 높이, 8 단위 */
  const DIM_RE = new RegExp(DIM_N + DIM_U + DIM_X + DIM_N + DIM_U + '(?:' + DIM_X + DIM_N + DIM_U + ')?', 'i');
  const QX = '[x×X✕*]';
  function parseLine(line) {
    let s = String(line || '').replace(/ /g, ' ').trim();
    if (!s) return null;
    if (isHeaderLine(s)) return null;
    s = s.replace(/^\s*(?:[-•·*▪◦]|\d+[.)])\s+/, '');
    const out = { name: '', qty: 1, w: null, d: null, h: null, url: '', room: '', fate: 'move', note: '' };
    /* 링크: 공백까지 통째로 (쿼리의 쉼표 ‘?id=1,2’ 포함). 단, 쉼표·탭으로 칸을 나눈 줄이면 첫 쉼표까지가 링크 */
    const um = s.match(/https?:\/\/\S+/i);
    if (um) {
      let u = um[0];
      if (/[,，;\t]/.test(s.slice(0, um.index))) u = u.split(/[,，;]/)[0];
      u = u.replace(/[.,，;]+$/, '');
      if (/\)$/.test(u) && !/\(/.test(u)) u = u.slice(0, -1);
      out.url = u;
      s = s.slice(0, um.index) + ' ' + s.slice(um.index + u.length);
    }
    let rm = s.match(/^\[([^\]]{1,12})\]\s*/);
    if (rm) { out.room = rm[1].trim(); s = s.slice(rm[0].length); }
    else {
      const m2 = s.match(/^([가-힣A-Za-z0-9][가-힣A-Za-z0-9 ]{0,9}?)\s*[:：]\s*/);
      if (m2) {
        const cand = m2[1].trim();
        if (ROOM_WORD.test(cand) || planRoomNames().has(cand)) { out.room = cand; s = s.slice(m2[0].length); }
      }
    }
    const fateWords = [['discard', /[(\[]?\s*(버림|버릴 것|버리기|폐기|처분)\s*[)\]]?/], ['buy', /[(\[]?\s*(새로 ?구매|구매 ?예정|살 것|새로 살 것)\s*[)\]]?/], ['sell', /[(\[]?\s*(판매|나눔)\s*[)\]]?/], ['undecided', /[(\[]?\s*(미정|고민)\s*[)\]]?/]];
    for (const [f, re] of fateWords) { const m = s.match(re); if (m) { out.fate = f; s = s.replace(m[0], ' '); break; } }
    // 수량 ‘2개’·‘×2개’·‘x 2대’ (앞의 x·×도 함께 지움)
    const qm = s.match(new RegExp('(?:' + QX + '\\s*)?(\\d+)\\s*(개|대|EA|ea|세트|set|짝|pcs)(?![가-힣A-Za-z])'));
    let qtySet = false;
    if (qm) { out.qty = Math.max(0, parseInt(qm[1], 10)); s = s.replace(qm[0], ' '); qtySet = true; }
    let dims = null;
    let units = [];
    const dm = s.match(DIM_RE);
    if (dm) {
      dims = [dm[1], dm[4], dm[7]].map((x) => (x == null ? null : parseFloat(x)));
      units = [dm[2], dm[5], dm[8]].map((u) => (u ? u.toLowerCase() : null));
      /* ‘160x200 x2’: 앞 두 숫자는 붙여 쓰고 세 번째만 띄운 작은 수(20 이하, 단위 없음)는 높이가 아니라 수량 */
      if (dm[7] != null && !dm[8] && /^\d{1,2}$/.test(dm[7]) && +dm[7] <= 20 && +dm[1] > 20 && +dm[4] > 20 && /^\s/.test(dm[6] || '') && !/\s/.test(dm[3] || '')) {
        if (!qtySet) { out.qty = parseInt(dm[7], 10); qtySet = true; }
        dims[2] = null; units[2] = null;
      }
      const before = s.slice(0, dm.index);
      let after = s.slice(dm.index + dm[0].length);
      // 크기 바로 뒤의 맨 숫자·x숫자(예: '책장 80x30x180 3', '80*30*180, 2', '80x30x180cm x3')는 수량
      if (!qtySet) {
        const tq = after.match(new RegExp('^\\s*[,，;]?\\s*(?:' + QX + '\\s*)?(\\d{1,3})(?![\\d.]|\\s*(?:cm|mm|m(?![a-z])|형|인|단|kg|l\\b|리터|평|층|%|년|월|일|시))', 'i'));
        if (tq) { out.qty = parseInt(tq[1], 10); qtySet = true; after = after.slice(tq[0].length); }
      }
      s = before + ' ' + after;
      // 줄 맨 끝의 맨 숫자도 수량 (예: '80x30x180 책장 3')
      if (!qtySet) {
        const te = s.match(/(?:^|\s)(\d{1,3})\s*$/);
        if (te) { out.qty = parseInt(te[1], 10); qtySet = true; s = s.slice(0, te.index); }
      }
    }
    // 크기가 없어도 줄 끝의 ‘x2’·‘× 3’은 수량 (예: '1인 소파 x 2')
    if (!qtySet) {
      const xm = s.match(new RegExp('(?:^|[\\s,，;])' + QX + '\\s*(\\d{1,3})\\s*$'));
      if (xm) { out.qty = parseInt(xm[1], 10); qtySet = true; s = s.slice(0, xm.index); }
    }
    if (!dims) {
      const lab = {};
      [['w', /(?:가로|폭|너비|W)\s*[:=]?\s*(\d+(?:\.\d+)?)/i], ['d', /(?:깊이|세로|D)\s*[:=]?\s*(\d+(?:\.\d+)?)/i], ['h', /(?:높이|H)\s*[:=]?\s*(\d+(?:\.\d+)?)/i]].forEach(([k, re]) => {
        const m = s.match(re); if (m) { lab[k] = parseFloat(m[1]); s = s.replace(m[0], ' '); }
      });
      if (Object.keys(lab).length >= 2) dims = [lab.w == null ? null : lab.w, lab.d == null ? null : lab.d, lab.h == null ? null : lab.h];
    }
    if (!dims) {
      const toks = s.split(/[,\t，;]+/).map((t) => t.trim()).filter(Boolean);
      let nums = [];
      let words = [];
      if (toks.length >= 2) {
        toks.forEach((t) => { if (/^\d+(?:\.\d+)?\s*(cm)?$/i.test(t)) nums.push(parseFloat(t)); else words.push(t); });
      } else {
        const loose = s.match(/(?:^|\s)(\d+(?:\.\d+)?)(?=\s|$)/g) || [];
        if (loose.length >= 3) { nums = loose.map((x) => parseFloat(x)); words = [s.replace(/(?:^|\s)\d+(?:\.\d+)?(?=\s|$)/g, ' ')]; }
      }
      if (nums.length) {
        if (nums.length >= 5) nums = nums.slice(nums.length - 4);
        if (nums.length >= 3) { dims = nums.slice(0, 3); if (nums.length >= 4 && !qtySet) { out.qty = Math.max(0, Math.round(nums[3])); qtySet = true; } } else if (nums.length === 2) dims = [nums[0], nums[1], null];
        else if (!qtySet) { out.qty = Math.max(0, Math.round(nums[0])); qtySet = true; }
        s = words.join(' ');
      }
    }
    // 크기 없는 줄 끝의 작은 맨 숫자(10 이하)는 수량 (예: '서랍장 3', '냉장고 2'). ‘책상 120’·‘TV 55’ 같은 큰 수는 규격이라 이름에 둠
    if (!dims && !qtySet) {
      const te = s.match(/(?:^|\s)(\d{1,2})\s*$/);
      if (te && +te[1] <= 10 && /[가-힣A-Za-z]/.test(s.slice(0, te.index))) { out.qty = parseInt(te[1], 10); qtySet = true; s = s.slice(0, te.index); }
    }
    out.qty = Math.min(QTY_MAX, out.qty);
    if (dims) {
      // 단위: 숫자마다 붙은 단위 → 없으면 마지막에 적힌 단위(예: '80x30x180cm', '1.6x2.1x0.4m') → 없으면 크기로 짐작
      const lastU = units.filter(Boolean).pop() || null;
      const known = units.some(Boolean);
      dims = dims.map((x, i) => (x == null ? null : x * (UNIT_SCALE[units[i] || lastU] || 1)));
      if (!known) {
        const vals = dims.filter((x) => x != null);
        if (vals.some((x) => x > 400)) dims = dims.map((x) => (x == null ? null : x / 10));
        else if (vals.length && vals.every((x) => x > 0 && x < 4) && vals.some((x) => x % 1 !== 0)) dims = dims.map((x) => (x == null ? null : x * 100));
      }
      [out.w, out.d, out.h] = dims.map((x) => (x == null ? null : Math.round(x)));
    }
    out.name = s.replace(/[()[\]{}]/g, ' ').replace(/\s*[,，;:：]\s*/g, ' ').replace(/\s+/g, ' ').replace(/^[-–·\s]+|[-–·\s]+$/g, '').trim();
    if (!out.name) out.name = '이름 없는 짐';
    const preset = matchPreset(out.name);
    out.cat = preset ? preset.cat : headCat(out.name);
    out.tag = preset ? (preset.tag || '') : '';
    if (!out.tag) { const t = Object.keys(TAG_WORDS).find((k) => TAG_WORDS[k].test(out.name)); if (t) out.tag = t; }
    out.ac = out.cat === 'aircon' ? (/벽걸이/.test(out.name) ? 'wall' : /2\s?in\s?1|투인원/i.test(out.name) ? '2in1' : /창문/.test(out.name) ? 'window' : /스탠드/.test(out.name) ? 'stand' : (preset && preset.ac) || null) : null;
    // 비어 있던 규격(0이나 빈 값 포함)은 프리셋·기본값으로 채우고 ‘추정치’로 표시
    out.missing = ['w', 'd', 'h'].filter((k) => !(out[k] > 0));
    out.assumed = out.missing.length > 0;
    out.presetName = '';
    if (out.assumed) {
      if (preset) { out.missing.forEach((k) => { out[k] = preset[k]; }); out.presetName = preset.name; }
      else out.missing.forEach((k) => { out[k] = 50; });
    }
    return out;
  }
  function openPaste() {
    let rows = [];
    let m = null;
    const ta = el('textarea', { class: 'textarea es-paste-ta', placeholder: '한 줄에 하나씩 적거나 엑셀·메모에서 붙여 넣으세요.\n예) 퀸 침대 160×210×40 1개 (뒤에 제품 링크를 붙여도 돼요)\n예) 책장, 80, 30, 180, 3\n예) 안방: 키즈 책상', 'aria-label': '붙여 넣을 짐 목록' });
    const pv = el('div', { class: 'es-pv' });
    const readBtn = el('button', { type: 'button', class: 'btn btn-primary' }, '↓ 읽어 오기');
    const status = el('span', { class: 'small es-muted' }, '');
    const syncFoot = () => {
      const btn = m && m.root ? m.root.querySelector('.modal-foot .btn-primary') : null;
      if (btn) { btn.textContent = rows.length ? rows.length + '개 추가' : '추가'; btn.disabled = !rows.length; }
    };
    const draw = () => {
      pv.replaceChildren();
      if (!rows.length) { syncFoot(); return; }
      pv.appendChild(el('div', { class: 'es-pv-head', 'aria-hidden': 'true' }, el('span', '이름'), el('span', '분류'), el('span', '처리'), el('span', '수량'), el('span', '가로'), el('span', '깊이'), el('span', '높이'), el('span', '')));
      rows.forEach((r, i) => {
        const nameI = el('input', { class: 'input es-pv-name', value: r.name, 'aria-label': (i + 1) + '번 이름' });
        nameI.addEventListener('input', () => { r.name = nameI.value; });
        const catS = el('select', { class: 'select es-pv-cat', 'aria-label': (i + 1) + '번 분류' }, MV.inv.CATS.map((c) => el('option', { value: c.id, selected: c.id === r.cat }, c.icon + ' ' + c.label)));
        catS.addEventListener('change', () => { r.cat = catS.value; });
        const fateS = el('select', { class: 'select es-pv-fate', 'aria-label': (i + 1) + '번 처리' }, MV.inv.FATES.map((f) => el('option', { value: f.id, selected: f.id === r.fate }, f.label)));
        fateS.addEventListener('change', () => { r.fate = fateS.value; });
        /* 칸을 비우거나 0을 넣으면(규격) 앞의 값을 그대로 두고, 칸을 떠날 때 그 값으로 되돌림.
           추정치 표시는 비어 있던 규격을 모두 직접 넣었을 때만 사라짐 */
        const numI = (k, lab) => {
          const x = el('input', { class: 'input num', type: 'number', min: k === 'qty' ? '0' : '1', max: k === 'qty' ? String(QTY_MAX) : null, step: '1', inputmode: 'numeric', value: String(r[k]), 'aria-label': (i + 1) + '번 ' + lab });
          x.addEventListener('input', () => {
            const raw = x.value.trim();
            if (raw === '') return;
            const v = Math.round(num(raw, NaN));
            if (!isFinite(v) || v < 0) return;
            if (k === 'qty') { r.qty = Math.min(QTY_MAX, v); return; }
            if (v > 0) { r[k] = v; r.missing = (r.missing || []).filter((m) => m !== k); r.assumed = r.missing.length > 0; syncChip(); }
          });
          x.addEventListener('change', () => { const v = num(x.value, NaN); if (x.value.trim() === '' || !isFinite(v) || v < 0 || (k !== 'qty' && v <= 0) || (k === 'qty' && v > QTY_MAX)) x.value = String(r[k]); });
          return el('label', { class: 'es-pv-num' }, el('span', { class: 'es-pv-lab' }, lab), x);
        };
        const urlI = el('input', { class: 'input', type: 'url', value: r.url, placeholder: '제품 링크 (선택)', 'aria-label': (i + 1) + '번 링크' });
        urlI.addEventListener('input', () => { r.url = urlI.value.trim(); });
        const chip = el('span', { class: 'chip warn', hidden: !r.assumed });
        const DIM_LAB = { w: '가로', d: '깊이', h: '높이' };
        const syncChip = () => {
          chip.hidden = !r.assumed;
          const miss = (r.missing || []).map((m) => DIM_LAB[m]).join('·');
          chip.textContent = (r.presetName ? '규격 추정 — ‘' + r.presetName + '’ 기준' : '규격 추정 — 기본값 50cm') + (miss && (r.missing || []).length < 3 ? ' (' + miss + ')' : '');
        };
        syncChip();
        pv.appendChild(el('div', { class: 'es-pv-row' },
          nameI, catS, fateS, numI('qty', '수량'), numI('w', '가로'), numI('d', '깊이'), numI('h', '높이'),
          el('button', { type: 'button', class: 'btn btn-sm btn-ghost btn-icon es-pv-del', 'aria-label': (i + 1) + '번 빼기', onclick: () => { rows.splice(i, 1); draw(); } }, '✕'),
          el('div', { class: 'es-pv-sub' }, chip, r.room ? el('span', { class: 'chip' }, '📍 ' + r.room) : null, urlI)));
      });
      syncFoot();
    };
    readBtn.addEventListener('click', () => {
      rows = ta.value.split(/\r?\n/).map(parseLine).filter(Boolean);
      status.textContent = rows.length ? rows.length + '줄을 읽었어요. 아래에서 고친 뒤 추가하세요.' : '읽을 줄이 없어요.';
      draw();
    });
    const body = el('div', { class: 'stack' },
      el('p', { class: 'small es-muted mb-0' }, '한 줄 = 짐 하나. 이름, 크기(가로×깊이×높이 — cm가 기본, 1.6m·1600미리도 돼요), 수량(‘2개’ 또는 크기 뒤 숫자), 링크를 알아서 읽어요. 크기가 없으면 비슷한 규격을 넣고 ‘추정치’로 표시해요. 줄 앞에 ‘안방:’처럼 쓰면 지금 위치로 넣어요. 엑셀 머리줄(이름·가로…)은 건너뛰어요.'),
      ta,
      el('div', { class: 'row' }, readBtn, status),
      pv);
    m = MV.ui.modal({
      title: '여러 개 붙여넣기', wide: true, body,
      actions: [
        { label: '취소', kind: 'ghost' },
        { label: '추가', kind: 'primary', onClick: () => {
          if (!rows.length) { toast('먼저 ‘읽어 오기’를 눌러 주세요.'); return false; }
          const items = rows.map((r) => ({
            id: MV.uid('inv'), name: String(r.name || '').trim() || '이름 없는 짐', cat: r.cat, fate: r.fate, qty: Math.min(QTY_MAX, Math.max(0, Math.round(num(r.qty, 1)))),
            w: Math.max(0, num(r.w, 0)), d: Math.max(0, num(r.d, 0)), h: Math.max(0, num(r.h, 0)),
            url: r.url || '', room: r.room || '', roomNew: '', lg: false, ac: r.cat === 'aircon' ? (r.ac || null) : null,
            tag: r.tag || '', note: '', assumed: !!r.assumed, seed: false,
          }));
          MV.store.update((st) => { st.inventory = st.inventory || []; items.forEach((it) => st.inventory.push(it)); }, { log: '짐 ' + items.length + '개를 붙여넣기로 추가' });
          toast('짐 ' + items.length + '개를 추가했어요.');
          return undefined;
        } },
      ],
    });
    syncFoot();
  }

  /* ---------- 업체에 보낼 짐 목록 ---------- */
  function placeName(p, fallback) {
    const n = (p && p.name) || fallback;
    return String(n).replace(/^[^·]*·\s*/, '').replace(/\s*\([^)]*\)\s*$/, '').trim() || fallback;
  }
  /* 업체에 보낼 메모: 앱이 가족에게 하는 안내(‘~해 주세요’, LG 표시 켜고 끄기, 요금 비교, 추정·실측 메모)는 빼고
     짐 자체에 대한 설명만 남김 (문장 단위, 최대 100자에서 문장 경계로 자름) */
  const FAMILY_ONLY = /(주세요|하세요|보세요|세요\.?$|집주인|LG 서비스로 옮김|LG 제품일 때만|LG 제품이면|이 표시|LG 요금|추정|실측|만원|배치해 보고|목표|지워|바꿔)/;
  function vendorNote(it) {
    const t = String((it && it.note) || '').trim();
    if (!t) return '';
    const sents = t.split(/(?<=[.!?。])\s+|\n+/).map((x) => x.trim()).filter(Boolean);
    const keep = sents.filter((x) => !FAMILY_ONLY.test(x));
    let out = '';
    for (const x of keep) { const nx = out ? out + ' ' + x : x; if (nx.length > 100) break; out = nx; }
    if (!out && keep.length) out = clip(keep[0], 100);
    return out;
  }
  function exportData() {
    const st = stGet();
    const inv = (st.inventory || []).filter((x) => x && typeof x === 'object');
    const est = compute(st);
    const inp = est.inputs;
    const plans = MV.plans || {};
    const line = (it) => {
      const parts = ['- ' + nm(it), qtyOf(it) + '개', '(' + dimTxt(it) + 'cm' + (it.assumed ? ', 규격 추정' : '') + ')'];
      if (isAircon(it) && it.ac) parts.push('[' + (AC_LABEL[it.ac] || it.ac) + ']');
      if (lgActive(it, inp)) parts.push('※ LG 서비스로 별도 이동 — 견적 제외');
      if (it.roomNew && it.roomNew !== it.room) parts.push('→ 새 집 ' + it.roomNew);
      const vn = vendorNote(it);
      if (vn) parts.push('· ' + vn);
      return parts.join(' ');
    };
    const out = [];
    out.push('[이사 짐 목록] ' + D.fmtLong(D.moveDate()));
    out.push('출발: ' + placeName(plans.old, '지금 집') + ' ' + inp.fromFloor + '층 (' + (METHODS[inp.fromMethod] || '') + ') → 도착: ' + placeName(plans.new, '새 집') + ' ' + inp.toFloor + '층 (' + (METHODS[inp.toMethod] || '') + ')');
    out.push('이사 형태: ' + (PACK_TYPES.find((p) => p.id === inp.packType) || PACK_TYPES[0]).label + ' · 예상 박스 약 ' + est.volumeParts.boxes + '개' + (inp.boxAuto && inp.builtinBoxes ? ' (붙박이장 옷 포함)' : ''));
    if (est.counts.acN) out.push('에어컨 이전 요청: ' + AC_T.filter((t) => est.counts.acUnits[t]).map((t) => AC_LABEL[t] + ' ' + est.counts.acUnits[t] + '대').join(', '));
    const lgList = inv.filter((it) => lgActive(it, inp));
    if (lgList.length) out.push('LG 서비스로 따로 옮길 가전 (견적 제외): ' + lgList.map((it) => nm(it)).join(', '));
    out.push('');
    const moving = inv.filter((it) => it.fate === 'move' && qtyOf(it) > 0);
    const order = ((plans.old && plans.old.rooms) || []).map((r) => r.name);
    const groups = new Map();
    moving.forEach((it) => { const k = it.room || '위치 미정'; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(it); });
    const keys = Array.from(groups.keys()).sort((a, b) => {
      const ia = order.indexOf(a), ib = order.indexOf(b);
      if (a === '위치 미정') return 1; if (b === '위치 미정') return -1;
      return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a.localeCompare(b, 'ko');
    });
    out.push('■ 가져갈 짐 (' + moving.length + '종, ' + sum(moving, qtyOf) + '개)');
    keys.forEach((k) => { out.push('[' + k + ']'); groups.get(k).forEach((it) => out.push(line(it))); });
    const sec = (fate, title) => {
      const xs = inv.filter((it) => it.fate === fate && qtyOf(it) > 0);
      if (!xs.length) return;
      out.push('');
      out.push('■ ' + title + ' (' + xs.length + '종)');
      xs.forEach((it) => out.push(line(it)));
    };
    sec('discard', '버릴 짐 — 옮기지 않음');
    sec('sell', '판매·나눔 예정 — 옮기지 않음');
    sec('buy', '새로 살 것 — 새 집으로 따로 배송');
    sec('undecided', '아직 미정 — 방문견적 때 함께 상의');
    out.push('');
    out.push('요청: 부가세 포함 총액(결제수단 무관)으로, ‘가전 포함’과 ‘LG 가전 제외’ 금액을 함께 문자나 PDF로 부탁드립니다.');
    const csvRows = [['처리', '분류', '이름', '수량', '가로cm', '깊이cm', '높이cm', '부피㎥', '지금 위치', '새 집 위치', 'LG 서비스', '규격 추정', '링크', '메모']];
    inv.forEach((it) => csvRows.push([MV.inv.fate(it.fate).label, MV.inv.cat(it.cat).label, nm(it), qtyOf(it), num(it.w, 0), num(it.d, 0), num(it.h, 0), r2(rawVol(it)), it.room || '', it.roomNew || '', lgActive(it, inp) ? 'O' : '', it.assumed ? 'O' : '', it.url || '', vendorNote(it)]));
    const csv = csvRows.map((r) => r.map((v) => { const s = String(v == null ? '' : v); return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }).join(',')).join('\r\n');
    return { text: out.join('\n'), csv };
  }
  function openExport() {
    const data = exportData();
    const ta = el('textarea', { class: 'textarea es-export-ta', readonly: true, 'aria-label': '업체에 보낼 짐 목록', spellcheck: 'false' }, data.text);
    const body = el('div', { class: 'stack' },
      el('p', { class: 'small es-muted mb-0' }, '방문견적 업체 3곳에 똑같이 보내세요. 버릴 짐과 LG가 옮길 가전은 따로 표시돼요. 메모는 앱 안내 문구(‘~해 주세요’ 등)를 빼고 짐 설명만 넣었어요.'),
      el('div', { class: 'row' },
        el('button', { type: 'button', class: 'btn btn-primary', onclick: () => copyText(ta.value, ta) }, '📋 복사'),
        el('button', { type: 'button', class: 'btn', onclick: () => { MV.ui.download('move-inventory-' + D.today() + '.csv', '﻿' + data.csv, 'text/csv;charset=utf-8'); toast('CSV 파일을 저장했어요.'); } }, '⬇ CSV 저장')),
      ta);
    MV.ui.modal({ title: '업체에 보낼 짐 목록', wide: true, body, actions: [{ label: '닫기', kind: 'ghost' }] });
  }

  /* ======================= 2) 이사 견적 ======================= */
  function rangeBar(est, quotes) {
    const pts = (quotes || []).filter(isNum);
    const lo = Math.min(est.low, ...pts);
    const hi = Math.max(est.high, ...pts);
    const span = Math.max(1, hi - lo);
    const pos = (v) => Math.round(MV.clamp((v - lo) / span, 0, 1) * 1000) / 10 + '%';
    return [
      el('div', { class: 'es-bar', role: 'img', 'aria-label': '하한 ' + won(est.low) + ', 기준 ' + won(est.typical) + ', 상한 ' + won(est.high) },
        pts.map((v) => el('i', { class: 'es-bar-q', style: { left: pos(v) }, title: '업체 견적 ' + won(v) })),
        el('i', { class: 'es-bar-mid', style: { left: pos(est.typical) } })),
      el('div', { class: 'es-bar-ends', 'aria-hidden': 'true' }, el('span', '하한 ' + won(est.low)), pts.length ? el('span', { style: { color: 'var(--think)' } }, '| 업체 견적') : null, el('span', '상한 ' + won(est.high))),
    ];
  }
  /* basis 'inc' → 부가세 포함 환산 금액 (히어로의 범위 막대는 언제나 부가세 포함) */
  function quotePoints(basis) {
    const raw = rawEst();
    return quotesOf(estSt()).map((q) => normQuote(q, raw)).filter(Boolean).map((n) => (basis === 'inc' ? n.inc : n.amount));
  }
  /* 보정 비율은 부가세 별도 금액끼리 나눠요 (견적 중앙값 ÷ 모델 기준가) — ‘부가세 포함으로 보기’를 켜고 꺼도 같은 값 */
  function calibTarget(raw, est) {
    const nq = quotesOf(est).map((q) => normQuote(q, raw)).filter(Boolean);
    const medEx = median(nq.map((n) => n.ex));
    const med = median(nq.map((n) => n.amount));
    return { nq, ns: nq.map((n) => n.amount), med, medEx, f: medEx && raw.subtotalEx ? medEx / raw.subtotalEx : null };
  }
  /* 보정에 쓴 견적의 ‘서명’ — 견적 자체(금액·부가세·포함 항목)가 바뀌었는지만 봐요.
     짐·조건이 바뀌면 같은 견적이라도 ‘같은 조건 환산’ 금액이 달라지므로, 그걸로 ‘견적이 바뀌었다’고 하면 안 돼요 */
  function quoteSig(est) {
    return quotesOf(est).filter((q) => num(q.amount, 0) > 0)
      .map((q) => [q.id, Math.round(num(q.amount, 0)), q.vatIncluded === false ? 0 : 1, q.ladder ? 1 : 0, q.aircon ? 1 : 0, q.waste ? 1 : 0, q.arrange ? 1 : 0].join(':'))
      .sort().join('|');
  }
  /* 업체 견적에 ‘포함’ 체크가 안 돼 모델 금액을 더한 항목 (보정 비율이 크게 흔들리는 원인) */
  function missingAdds(raw, est) {
    const qs = quotesOf(est).filter((q) => num(q.amount, 0) > 0);
    const pe = raw.partsEx || {};
    const vm = raw.vatIncl ? raw.vatMul : 1;
    return [['ladder', '사다리차'], ['aircon', '에어컨 이전'], ['waste', '폐기물'], ['arrange', '정리 인력']]
      .filter(([k]) => pe[k] > 0)
      .map(([k, label]) => ({ k, label, n: qs.filter((q) => !q[k]).length, v: pe[k] * vm }))
      .filter((x) => x.n > 0);
  }
  function missingNote(raw, est) {
    const ms = missingAdds(raw, est);
    if (!ms.length) return null;
    return el('p', { class: 'small es-calib-miss' }, '⚠ ' + ms.map((m) => '견적 ' + m.n + '곳에 ‘' + m.label + '’ 포함이 체크되지 않아 모델 금액 약 ' + won(m.v) + '을 더해 비교했어요').join(' · ') +
      '. 견적에 들어 있다면 ‘업체 견적 비교’에서 체크하세요 — 보정 비율이 크게 달라져요.');
  }
  function calibBox(compact) {
    const raw = rawEst();
    const est0 = estSt();
    const t = calibTarget(raw, est0);
    const ns = t.ns;
    const cal = calibOf(est0);
    const applied = Math.abs(cal.factor - 1) > 1e-6;
    const med = t.med;
    const f = t.f;
    const bl = basisLabel(raw.vatIncl);
    const box = el('div', { class: 'es-calib', 'aria-label': '견적으로 보정' });
    box.appendChild(el('div', { class: 'es-calib-top' }, el('b', '🎯 견적으로 보정'),
      applied ? el('span', { class: 'chip think' }, '적용 중 ×' + cal.factor.toFixed(2)) : el('span', { class: 'chip' }, '보정 없음')));
    if (applied) {
      const shownMed = isNum(cal.median) ? cal.median * (raw.vatIncl ? raw.vatMul : 1) : null;
      box.appendChild(el('p', (cal.at ? MV.date.time(cal.at) + ' · ' : '') + '방문견적 ' + cal.n + '곳 중앙값' + (shownMed ? ' ' + won(shownMed) + '(' + bl + ' 기준)' : '') + '에 맞춰 모델 금액을 ×' + cal.factor.toFixed(2) + ' 했어요. 짐이나 조건을 바꾸면 같은 비율로 따라가고, 부가세 포함·별도 보기를 바꿔도 비율은 그대로예요.'));
      if (!ns.length) box.appendChild(el('p', { class: 'small', style: { color: 'var(--bad)', fontWeight: '700' } }, '⚠ 보정에 쓴 견적이 지금은 하나도 없어요. 보정을 해제하는 게 좋아요.'));
      // 견적 자체가 바뀌었을 때만 ‘다시 맞추기’를 권해요 (예전 보정은 서명이 없어 견적 수로만 판단)
      const quotesChanged = ns.length > 0 && (cal.sig != null ? quoteSig(est0) !== cal.sig : cal.n !== ns.length);
      const condChanged = !quotesChanged && ns.length > 0 && isNum(cal.base) && cal.base > 0 && raw.subtotalEx > 0 && Math.abs(raw.subtotalEx - cal.base) / cal.base > 0.005;
      const mn1 = ns.length ? missingNote(raw, est0) : null;
      if (mn1) box.appendChild(mn1);
      if (condChanged) {
        const vm = raw.vatIncl ? raw.vatMul : 1;
        box.appendChild(el('p', { class: 'small es-calib-info' }, 'ℹ️ 보정한 뒤 짐·조건이 바뀌었어요 (보정 전 모델 ' + won(cal.base * vm) + ' → ' + won(raw.subtotalEx * vm) + '). 비율 ×' + cal.factor.toFixed(2) +
          '는 그대로 따라가요. 업체가 바뀐 짐으로 견적을 다시 주면 그 금액을 고친 뒤 다시 맞추세요.'));
      }
      box.appendChild(el('div', { class: 'row' },
        quotesChanged && f ? el('button', { type: 'button', class: 'btn btn-sm btn-primary', onclick: applyCalibration }, '견적이 바뀌었어요 — 다시 맞추기 (×' + MV.clamp(f, 0.5, 2).toFixed(2) + ')') : null,
        el('button', { type: 'button', class: 'btn btn-sm' + (!ns.length ? ' btn-primary' : ''), onclick: clearCalibration }, '보정 해제')));
    } else if (!ns.length) {
      box.appendChild(el('p', '방문견적을 1곳 이상 ‘업체 견적 비교’에 넣으면, 모델의 기준가를 실제 견적 중앙값에 맞출 수 있어요. 언제든 해제할 수 있어요.'));
      if (compact) box.appendChild(el('div', { class: 'row' }, el('button', { type: 'button', class: 'btn btn-sm', onclick: () => goTab('quotes') }, '업체 견적 넣으러 가기 →')));
    } else {
      const diff = f - 1;
      box.appendChild(el('p', '견적 ' + ns.length + '곳(같은 조건·' + bl + ' 환산) 중앙값 ', el('b', won(med)), (Math.abs(diff) < 0.005 ? ' — 지금 모델 기준가 ' + josa(won(raw.typical), '과/와') + ' 거의 같아요.' : ' — 지금 모델 기준가 ' + won(raw.typical) + '보다 ' + Math.abs(Math.round(diff * 100)) + '%' + (diff > 0 ? ' 높아요.' : ' 낮아요.')) +
        (ns.length < 3 ? ' 견적이 3곳 모이면 더 믿을 만해요.' : '')));
      const mn2 = missingNote(raw, est0);
      if (mn2) box.appendChild(mn2);
      if (f < 0.5 || f > 2) box.appendChild(el('p', { class: 'small', style: { color: 'var(--bad)' } }, '차이가 너무 커요(×' + f.toFixed(2) + '). 금액·포함 항목을 다시 확인하세요. 보정은 ×0.5~×2 사이로만 해요.'));
      box.appendChild(el('div', { class: 'row' }, el('button', { type: 'button', class: 'btn btn-sm btn-primary', onclick: applyCalibration }, '모델을 견적에 맞추기 (×' + MV.clamp(f, 0.5, 2).toFixed(2) + ')')));
    }
    return box;
  }
  function applyCalibration() {
    const st = stGet();
    const raw = compute(st, { calib: false });
    const t = calibTarget(raw, st.estimate);
    if (!t.medEx || !raw.subtotalEx) { toast('금액이 들어간 견적이 없어요.'); return; }
    const factor = Math.round(MV.clamp(t.f, 0.5, 2) * 1000) / 1000;
    const prev = MV.clone(calibOf(st.estimate));
    const sig = quoteSig(st.estimate);
    MV.store.update((s) => { ensureEst(s).calib = { factor, at: MV.nowISO(), median: Math.round(t.medEx), n: t.nq.length, base: raw.subtotalEx, basis: 'ex', sig }; },
      { log: '이사 견적 모델을 방문견적 ' + t.nq.length + '곳 중앙값(' + won(t.med) + ', ' + basisLabel(raw.vatIncl) + ')에 맞춤 ×' + factor.toFixed(2) });
    toast('견적에 맞췄어요 ×' + factor.toFixed(2), { action: { label: '되돌리기', onClick: () => MV.store.update((s) => { ensureEst(s).calib = prev; }, { log: '견적 보정 되돌림' }) } });
  }
  function clearCalibration() {
    const prev = MV.clone(calibOf(estSt()));
    MV.store.update((s) => { ensureEst(s).calib = { factor: 1, at: null, median: null, n: 0, base: null }; }, { log: '이사 견적 보정 해제' });
    toast('보정을 해제했어요.', { action: { label: '되돌리기', onClick: () => MV.store.update((s) => { ensureEst(s).calib = prev; }, { log: '견적 보정 다시 적용' }) } });
  }
  function heroCard() {
    const est = R.est;
    const qp = quotePoints('inc');
    const lg = est.lgCost;
    const acInc = est.counts.acN > 0;
    const pay = est.pay;
    return el('section', { class: 'card es-hero', 'aria-label': '예상 이사비' },
      el('div', { class: 'es-hero-grid' },
        el('div',
          el('div', { class: 'es-eyebrow' }, '이삿짐센터 예상 비용 · 추정치' + (est.calibFactor !== 1 ? ' (방문견적 보정)' : '')),
          el('div', { class: 'es-big', title: F.won(pay.typical) + ' (부가세 포함)' }, '약 ' + won(pay.typical), el('small', '부가세 포함')),
          el('div', { class: 'es-rangetxt' }, '범위 ' + won(pay.low) + ' ~ ' + won(pay.high)),
          el('div', { class: 'es-exline' }, '부가세 별도 약 ' + won(est.ex.typical) + ' (' + won(est.ex.low) + ' ~ ' + won(est.ex.high) + ') — 업체 견적이 ‘부가세 별도’면 이 숫자와 비교하세요'),
          rangeBar(pay, qp),
          el('div', { class: 'es-facts' },
            el('span', { class: 'chip' }, '📦 짐 ' + m3(est.volume)),
            el('span', { class: 'chip brand' }, '🚚 ' + est.truckLabel),
            el('span', { class: 'chip' }, '👷 ' + est.crewLabel),
            el('span', { class: 'chip' + (est.surchargePct ? ' warn' : ' good') }, '📅 ' + est.dateLabel + (est.surchargePct ? ' +' + r1(est.surchargePct) + '%' : ' 할증 없음')),
            el('span', { class: 'chip' }, '❄️ 에어컨 ' + (acInc ? '포함 (' + est.counts.acN + '대)' : '제외')))),
        el('div', { class: 'es-hero-side' },
          lgBlockedCallout(est),
          lg && lg.typical > 0 ? el('div', { class: 'es-lgsum' }, '🔌 LG로 옮기는 가전 ' + lg.count + '대 별도 ', el('b', '약 ' + won(lg.typical)),
            el('span', '→ 이사 전체 약 ' + won(est.totalPay.typical) + ' (부가세 포함' + (est.vatIncl ? '' : ' — 이삿짐센터 ' + won(est.pay.typical) + ' + LG') + ')')) : null,
          disclaimer(true),
          calibBox(true))));
  }

  /* ---------- 입력 카드 ---------- */
  function fieldWrap(label, control, hint, tag) {
    return el(tag || 'label', { class: 'field es-field' }, el('span', label), control, hint ? el('small', { class: 'hint' }, hint) : null);
  }
  function numInput(key, o) {
    o = o || {};
    const input = el('input', {
      class: 'input num', type: 'number', inputmode: o.decimal ? 'decimal' : 'numeric',
      min: o.min != null ? String(o.min) : '0', max: o.max != null ? String(o.max) : null, step: String(o.step || 1),
      'data-fk': 'in-' + key, placeholder: o.placeholder || null, 'aria-label': o.aria || null,
    });
    const mn = o.min != null ? o.min : 0;
    const shown = () => { const v = inpNow()[key]; return v == null ? '' : String(v); };
    /* final=true(칸을 떠날 때): 비웠거나 범위를 넘으면 실제 계산에 쓰는 값으로 칸을 되돌려 화면과 계산이 어긋나지 않게 */
    const commit = (final) => {
      const raw = input.value.trim();
      if (raw === '') {
        if (o.nullable) { if (inpNow()[key] !== null) setInput(key, null); }
        else if (final) input.value = shown();
        return;
      }
      let v = parseFloat(raw);
      if (!isFinite(v)) { if (final) input.value = shown(); return; }
      v = Math.max(mn, v);
      if (o.max != null) v = Math.min(o.max, v);
      v = o.decimal ? Math.round(v * 100) / 100 : Math.round(v);
      if (inpNow()[key] !== v) setInput(key, v);
      if (final && input.value !== String(v)) input.value = String(v);
    };
    const deb = MV.debounce(() => commit(false), 350);
    input.addEventListener('input', deb);
    input.addEventListener('change', () => { deb.flush(); commit(true); });
    input.addEventListener('blur', () => { deb.flush(); commit(true); });
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); input.blur(); } });
    upd(() => { if (document.activeElement !== input) { const v = inpNow()[key]; input.value = v == null ? '' : String(v); } });
    return input;
  }
  function segField(key, options, label) {
    const wrap = el('div', { class: 'es-seg', role: 'group', 'aria-label': label });
    const btns = options.map((o) => el('button', { type: 'button', class: 'es-seg-b', 'data-fk': 'seg-' + key + '-' + o.id, onclick: () => setInput(key, o.id) }, o.label));
    btns.forEach((b) => wrap.appendChild(b));
    upd(() => { const v = inpNow()[key]; btns.forEach((b, i) => { const on = options[i].id === v; b.classList.toggle('is-on', on); b.setAttribute('aria-pressed', String(on)); }); });
    return wrap;
  }
  function checkField(key, label, onSync) {
    const cb = el('input', { type: 'checkbox', 'data-fk': 'cb-' + key });
    cb.addEventListener('change', () => setInput(key, cb.checked));
    upd(() => { const v = !!inpNow()[key]; cb.checked = v; if (onSync) onSync(v); });
    return el('label', { class: 'check es-check' }, cb, el('span', label));
  }
  function moneyField(key, label, hint) {
    const w = MV.ui.moneyInput(inpNow()[key], (v) => setInput(key, Math.max(0, v)), { placeholder: '예: 5만' });
    w.input.dataset.fk = 'in-' + key;
    w.input.setAttribute('aria-label', label);
    upd(() => {
      if (document.activeElement === w.input) return;
      const v = inpNow()[key];
      w.input.value = F.num(v);
      const h = w.querySelector('.hint'); if (h) h.textContent = F.krw(v);
    });
    return el('div', { class: 'field es-field' }, el('span', label), w, hint ? el('small', { class: 'hint' }, hint) : null);
  }
  function autoRow(key, label, autoFn, unitTxt) {
    const input = numInput(key, { nullable: true, aria: label });
    const hint = el('span');
    const btn = el('button', { type: 'button', class: 'btn btn-sm btn-ghost', onclick: () => { input.value = ''; setInput(key, null); } }, '↺ 자동으로');
    upd(() => {
      const v = inpNow()[key];
      const a = autoFn(R.est);
      input.placeholder = '자동 ' + a;
      hint.textContent = v == null ? '짐 목록에서 자동: ' + a + unitTxt + ' (숫자를 넣으면 직접 입력)' : '직접 입력 중 · 짐 목록 기준이면 ' + a + unitTxt;
      btn.hidden = v == null;
    });
    return el('div', { class: 'es-autorow' }, el('span', { class: 'es-al', 'aria-hidden': 'true' }, label), input, el('div', { class: 'es-ah' }, hint, btn));
  }
  function inputsCard() {
    const card = el('section', { class: 'card es-inputs', 'aria-label': '이사 조건 입력' });
    card.appendChild(sectionHead('✏️', '이사 조건', '바꾸면 금액이 바로 다시 계산돼요',
      el('button', { type: 'button', class: 'btn btn-sm btn-ghost', onclick: () => {
        MV.ui.confirm('이사 조건 입력을 처음 기본값으로 되돌릴까요? (계산 기준·업체 견적은 그대로예요)', { okLabel: '되돌리기' }).then((ok) => {
          if (ok) MV.store.update((st) => { ensureEst(st).inputs = inputDefaults(); }, { log: '이사 조건 입력을 기본값으로 되돌림' });
        });
      } }, '↺ 입력 기본값')));

    // 이사 형태·날짜
    card.appendChild(el('h3', { class: 'es-h3 es-h3-first' }, '📅 이사 형태 · 날짜'));
    card.appendChild(fieldWrap('이사 형태', segField('packType', PACK_TYPES, '이사 형태'), '포장이사: 포장·정리까지 / 반포장: 짐 풀기는 직접 / 일반: 포장도 직접', 'div'));
    const dsel = el('select', { class: 'select', 'data-fk': 'in-dateMode', 'aria-label': '날짜 유형' }, DATE_MODES.map((m) => el('option', { value: m.id }, m.id)));
    dsel.addEventListener('change', () => setInput('dateMode', dsel.value));
    const dfact = el('div', { class: 'es-datefact' });
    upd(() => {
      const c = coefNow();
      const di = R.est.dateInfo;
      Array.from(dsel.options).forEach((o, i) => { const t = modeLabel(DATE_MODES[i], c, di); if (o.textContent !== t) o.textContent = t; });
      if (document.activeElement !== dsel) dsel.value = inpNow().dateMode;
      const lun = di.lunar;
      setKids(dfact,
        el('div', el('b', D.fmtLong(di.date)), ' — ',
          lun ? '음력 ' + lun.month + '월 ' + lun.day + '일 → ' : '음력 정보 없음 → ',
          lun ? el('b', { style: { color: di.sohn ? 'var(--bad)' : 'var(--good)' } }, di.sohn ? '손없는날이에요 (할증·예약 경쟁 큼)' : '손없는날이 아니에요') : '날짜 유형을 직접 고르세요',
          di.holiday ? ' · ' + di.holiday : '', di.monthStart ? ' · 월초' : di.monthEnd ? ' · 월말' : ''),
        el('div', { class: 'es-note' }, di.date === '2026-11-03'
          ? '근거: 한국천문연구원 음력 자료 기준으로 다시 계산했어요 (신뢰도 높음). 11/2(월)은 음력 9월 23일이에요. 일부 블로그·중국 기준 음력은 11월 손없는날을 하루씩 틀리게 안내해요.'
          : '앱에 넣은 음력표(한국천문연구원 음력 자료 기준, ' + LUNAR_RANGE + ')와 공휴일표(대체공휴일 포함, 2026-08 ~ 2027-12)로 계산했어요.' +
            (di.holidayKnown ? '' : ' 이 날짜는 공휴일표 밖이라 공휴일이면 날짜 유형을 ‘주말·공휴일’로 직접 고르세요.'), ' ', srcLinks(['lunar', 'lunarDay'])),
        di.nearby.length ? el('div', { class: 'es-sohn' }, el('span', { class: 'small strong' }, '가까운 손없는날:'),
          di.nearby.map((x) => el('span', { class: 'chip bad', title: '손없는날은 +' + r1(c.sohn_pct) + '% 안팎 비싸고 예약이 빨리 차요' }, D.fmt(x)))) : null,
        di.date === '2026-11-03' ? el('div', { class: 'es-note' }, '11/3은 평일이라 가격은 유리하지만 월초·가을 이사철이 겹쳐 인기 업체와 사다리차가 빨리 마감돼요. 10/17까지 계약을 권해요.') : null);
    });
    card.appendChild(el('div', { class: 'mt-12' }, fieldWrap('날짜 유형 (할증)', dsel, null)));
    card.appendChild(dfact);
    card.appendChild(el('div', { class: 'es-fgrid mt-12' },
      fieldWrap('거리 (km)', numInput('distanceKm', { decimal: true, step: 0.5, max: 500 }), '같은 동네 1km — 거리 할증 거의 없음')));

    // 층·반출입
    card.appendChild(el('h3', { class: 'es-h3' }, '🏗️ 층 · 사다리차'));
    const methodsFrom = [{ id: 'ladder', label: '사다리차' }, { id: 'elevator', label: '엘리베이터' }, { id: 'stairs', label: '계단' }];
    const methodsTo = [{ id: 'ladder', label: '사다리차' }, { id: 'elevator', label: '엘리베이터' }];
    card.appendChild(el('div', { class: 'es-floorrow' },
      fieldWrap('출발 층', numInput('fromFloor', { min: 0, max: 80 })),
      fieldWrap('반출 방법', segField('fromMethod', methodsFrom, '출발 반출 방법'), null, 'div')));
    const fromTip = el('p', { class: 'es-note' });
    card.appendChild(fromTip);
    card.appendChild(el('div', { class: 'es-floorrow mt-8' },
      fieldWrap('도착 층', numInput('toFloor', { min: 0, max: 80 })),
      fieldWrap('반입 방법', segField('toMethod', methodsTo, '도착 반입 방법'), null, 'div')));
    const toTip = el('p', { class: 'es-note' });
    card.appendChild(toTip);
    upd(() => {
      const est = R.est;
      const inp = est.inputs;
      const c = est.coef;
      const lf = est.lifts.from;
      if (inp.fromMethod === 'ladder' && inp.fromFloor >= 2 && inp.fromFloor <= 3) {
        const alt = liftCost(inp.fromFloor, 'elevator', est.tons, c);
        fromTip.textContent = '💡 ' + inp.fromFloor + '층은 엘리베이터·계단으로 반출하면 사다리차 ' + won(lf.typical) + ' 대신 약 ' + won(alt.typical) + ' — 업체에 가능한지 물어보세요.';
      } else fromTip.textContent = lf.typical ? lf.title + ': ' + won(lf.typical) : lf.detail || '';
      const lt = est.lifts.to;
      toTip.textContent = inp.toMethod === 'ladder' && inp.toFloor >= 13
        ? '⚠ ' + inp.toFloor + '층은 일반 사다리차가 닿는 높이지만, 새 집 동의 설치 위치·지하주차장 상판·수목·전선 간섭은 아직 미확인이에요. 사전방문 때 관리사무소에 확인하세요.'
        : (inp.toMethod === 'elevator' ? '엘리베이터만 쓰면 작업이 2~3시간 늘어 추가 인력비 약 ' + josa(won(lt.typical), '이/가') + ' 붙어요 (추정). 냉장고·소파가 들어가는지 엘리베이터 크기를 재 보세요.' : (lt.typical ? lt.title + ': ' + won(lt.typical) : ''));
    });
    card.appendChild(el('div', { class: 'es-fgrid-2 mt-12' },
      moneyField('elevFeeFrom', '엘리베이터 사용료 · 출발 단지', '리서치 추정 5만원 (무료~10만원) — 관리사무소에 확인'),
      moneyField('elevFeeTo', '엘리베이터 사용료 · 도착 단지', '보양·보증금 조건도 함께 물어보세요')));

    // 박스
    card.appendChild(el('h3', { class: 'es-h3' }, '📦 이삿짐 박스'));
    const autoBox = el('div', { class: 'stack' });
    const manBox = el('div');
    card.appendChild(checkField('boxAuto', '가구원 수·평형으로 자동 추정', (v) => { autoBox.hidden = !v; manBox.hidden = v; }));
    const range = el('input', { type: 'range', min: '0', max: '40', step: '5', 'aria-label': '짐 줄이기 정도 (%)', 'data-fk': 'in-reducePct' });
    const rout = el('output', { class: 'es-range-out' });
    const rDeb = MV.debounce(() => { const v = Math.round(num(range.value, 0)); if (inpNow().reducePct !== v) setInput('reducePct', v); }, 200);
    range.addEventListener('input', () => { rout.textContent = range.value + '%'; rDeb(); });
    range.addEventListener('change', () => rDeb.flush());
    upd(() => { if (document.activeElement !== range) range.value = String(inpNow().reducePct); rout.textContent = range.value + '%'; });
    autoBox.appendChild(el('div', { class: 'es-fgrid' },
      fieldWrap('가구원 수', numInput('persons', { min: 1, max: 12 })),
      fieldWrap('지금 집 평형 (평)', numInput('pyeong', { min: 5, max: 100 })),
      fieldWrap('붙박이장 옷·이불 박스', numInput('builtinBoxes', { min: 0, max: 200 }), '새 집엔 붙박이장이 없어요 (+20~30개)')));
    autoBox.appendChild(fieldWrap('짐 줄이기 정도 (버리기·정리로 줄일 만큼)', el('div', { class: 'es-rangewrap' }, range, rout), null, 'div'));
    const boxRes = el('div', { class: 'es-boxres' });
    autoBox.appendChild(boxRes);
    manBox.appendChild(fieldWrap('박스 수 (직접)', numInput('boxes', { min: 0, max: 1000 }), '방문견적에서 들은 숫자가 있으면 넣으세요'));
    card.appendChild(autoBox);
    card.appendChild(manBox);
    upd(() => {
      const est = R.est;
      const inp = est.inputs;
      const c = est.coef;
      const b = est.volumeParts.boxes;
      setKids(boxRes,'→ 박스 약 ' + b + '개 (' + m3(b * c.m3_per_box) + ')',
        el('small', '= 기준 ' + c.boxes_typical + '개 × ' + inp.pyeong + '/24평 × ' + inp.persons + '명 보정 × (1−' + inp.reducePct + '%) + 붙박이장 ' + inp.builtinBoxes + '개' +
          (est.next && est.next.headroom < 3 ? ' · 박스 ' + est.next.boxes + '개 더 늘면 ' + tonsLabel(est.next.tons) : '')));
    });

    // 특수 작업
    card.appendChild(el('h3', { class: 'es-h3' }, '🛠️ 특수 작업'));
    const acBox = el('div', { class: 'es-acbox' });
    upd(() => {
      const est = R.est;
      const u = est.counts.acUnits;
      const lgAc = invItems((it) => isAircon(it) && lgActive(it, est.inputs)).reduce((s, it) => s + qtyOf(it), 0);
      setKids(acBox,
        el('div', el('b', '❄️ 에어컨 이전 (짐 목록에서 자동): '),
          est.counts.acN ? AC_T.filter((t) => u[t]).map((t) => AC_LABEL[t] + ' ' + u[t] + '대').join(', ') + ' — 이삿짐센터 협력 기사' : '이삿짐센터가 옮길 에어컨 없음'),
        el('div', { class: 'es-note' }, lgAc ? 'LG 서비스로 옮기는 에어컨 ' + lgAc + '대는 빠져 있어요. ' : '', '누가 옮길지는 ‘LG·이삿짐센터 비교’ 탭에서 정해요.'),
        el('div', { class: 'mt-8' }, el('button', { type: 'button', class: 'btn btn-sm', onclick: () => goTab('lg') }, '🔌 누가 옮길지 정하기 →')));
    });
    card.appendChild(acBox);
    card.appendChild(el('div', { class: 'es-fgrid mt-8' },
      fieldWrap('배관 추가 길이 (대당, m)', numInput('acPipeM', { decimal: true, step: 0.5, max: 30 }), '리서치 계산은 3m 기준')));
    card.appendChild(el('div', { class: 'mt-8' }, checkField('acGas', '에어컨 가스 충전 포함 (5~8만원)')));
    card.appendChild(el('div', { class: 'mt-8' },
      autoRow('bedCount', '침대 분해조립', (e) => e.counts.autoBeds, '개'),
      autoRow('fridgeCount', '대형 냉장고 (폭 85cm 이상)', (e) => e.counts.autoFridges, '대'),
      autoRow('stackCount', '세탁기·건조기 직렬 해체·설치', (e) => e.counts.autoStack, '세트'),
      autoRow('pianoCount', '피아노', (e) => e.counts.autoPiano, '대'),
      el('div', { class: 'es-autorow' }, el('span', { class: 'es-al', 'aria-hidden': 'true' }, '장롱·시스템행거 해체·설치 (식)'), numInput('wardrobeCount', { min: 0, max: 20, aria: '장롱·시스템행거 해체·설치 개수' }),
        el('div', { class: 'es-ah' }, '붙박이장은 못 가져가요. 시스템행거·조립식 장롱이 있으면 개수를 넣으세요.'))));

    // 기타
    card.appendChild(el('h3', { class: 'es-h3' }, '🧺 기타'));
    const wasteSub = el('div', { class: 'es-sub' });
    const arrSub = el('div', { class: 'es-sub' });
    const wasteHint = el('small', { class: 'hint' });
    wasteSub.appendChild(fieldWrap('폐기물 부피 (㎥) — 비우면 자동', numInput('wasteM3', { decimal: true, step: 0.1, nullable: true, max: 100 }), null));
    wasteSub.appendChild(wasteHint);
    upd(() => {
      const est = R.est;
      const inp2 = wasteSub.querySelector('input');
      if (inp2) inp2.placeholder = '자동 ' + r1(est.counts.autoWasteM3);
      wasteHint.textContent = '‘버림’ 짐(폐가전 제외) 부피 ' + m3(est.counts.autoWasteM3) + '. 고장 세탁기 같은 폐가전은 1599-0903 무상방문수거로 따로 처리하세요.';
    });
    arrSub.appendChild(fieldWrap('추가 인원 (명)', numInput('arrangeCount', { min: 1, max: 10 })));
    // 부가세율은 계산 기준에서 바꿀 수 있어 글자도 그 값을 따라감
    /* 머리말·히어로는 언제나 부가세 포함(실제로 낼 돈)이에요. 이 체크는 금액 내역 표·업체 견적 비교의 기준만 바꿔요 */
    const vatField = checkField('vat', '금액 내역·업체 비교도 부가세 포함으로 보기 (부가세 10%)');
    upd(() => { const sp = vatField.querySelector('span'); if (sp) sp.textContent = '금액 내역·업체 비교도 부가세 포함으로 보기 (부가세 ' + fmtDec(coefNow().vat_pct) + '%)'; }, vatField);
    card.appendChild(el('div', { class: 'es-checks' },
      checkField('waste', '폐기물을 이삿짐센터에 맡기기', (v) => { wasteSub.hidden = !v; }), wasteSub,
      checkField('arrange', '정리수납 추가 인력 요청', (v) => { arrSub.hidden = !v; }), arrSub,
      checkField('includeUndecided', '처리 ‘미정’ 짐도 가져가는 것으로 계산'),
      vatField));
    return card;
  }

  /* ---------- 금액 표 ---------- */
  const GROUP_TITLE = { base: '기본 운반·포장', lift: '사다리차·엘리베이터', special: '특수 작업', extra: '기타', tax: '세금', calib: '보정' };
  function linesCard() {
    const est = R.est;
    const rows = [];
    let lastG = null;
    est.lines.forEach((l) => {
      if (l.group !== lastG) { lastG = l.group; rows.push(el('tr', { class: 'es-l-sec' }, el('td', { colspan: '4' }, GROUP_TITLE[l.group] || ''))); }
      rows.push(el('tr', { class: l.typical === 0 ? 'is-zero' : '' },
        el('td', { class: 'es-l-label' }, l.label, l.detail ? el('span', { class: 'es-l-detail' }, l.detail) : null),
        el('td', { class: 'num es-l-lohi' }, won(l.low)),
        el('td', { class: 'num es-l-typ' }, (l.typical < 0 ? '−' + won(-l.typical) : won(l.typical)), el('span', { class: 'es-l-rng' }, won(l.low) + '~' + won(l.high))),
        el('td', { class: 'num es-l-lohi' }, won(l.high))));
    });
    return el('section', { class: 'card es-linescard', 'aria-label': '금액 내역' },
      sectionHead('🧾', '금액 내역', '하한 ×' + est.coef.range_low + ' · 상한 ×' + est.coef.range_high),
      el('div', { class: 'table-wrap' }, el('table', { class: 'tbl es-lines' },
        el('thead', el('tr', el('th', '항목'), el('th', { class: 'num es-l-lohi' }, '하한'), el('th', { class: 'num' }, '기준'), el('th', { class: 'num es-l-lohi' }, '상한'))),
        el('tbody', rows),
        el('tfoot',
          el('tr', el('td', '합계 ', el('span', { class: 'es-vat' }, basisLabel(est.vatIncl))), el('td', { class: 'num es-l-lohi' }, won(est.low)),
            el('td', { class: 'num es-l-typ' }, won(est.typical), el('span', { class: 'es-l-rng' }, won(est.low) + '~' + won(est.high))),
            el('td', { class: 'num es-l-lohi' }, won(est.high))),
          // 부가세 별도로 보는 중이면 실제로 낼 돈(부가세 포함)을 한 줄 더 — 머리말·히어로·자금 화면과 같은 숫자
          est.vatIncl ? null : el('tr', { class: 'es-l-pay' }, el('td', '실제로 낼 돈 ', el('span', { class: 'es-vat' }, '부가세 ' + fmtDec(est.coef.vat_pct) + '% 포함')), el('td', { class: 'num es-l-lohi' }, won(est.pay.low)),
            el('td', { class: 'num es-l-typ' }, won(est.pay.typical), el('span', { class: 'es-l-rng' }, won(est.pay.low) + '~' + won(est.pay.high))),
            el('td', { class: 'num es-l-lohi' }, won(est.pay.high)))))),
      est.lgCost && est.lgCost.typical > 0 ? el('p', { class: 'small es-muted mt-8 mb-0' }, '🔌 LG 서비스로 옮길 가전 ' + est.lgCost.count + '대(약 ' + won(est.lgCost.typical) + ', 부가세 포함 소비자가)는 위 금액에 없어요 — LG에 따로 내요. 둘을 더한 이사 전체는 부가세 포함 약 ' + won(est.totalPay.typical) + '이에요.') : null);
  }
  function whyCard() {
    const est = R.est;
    const c = est.coef;
    const vp = est.volumeParts;
    const base = sum(est.lines.filter((l) => l.key === 'truck' || l.key === 'crew'), (l) => l.typical);
    const extras = est.lines.filter((l) => !['truck', 'crew', 'date', 'vat', 'calib'].includes(l.key));
    const tips = [];
    if (est.next) tips.push('짐이 ' + m3(est.next.headroom) + '(박스 약 ' + est.next.boxes + '개) 넘게 늘면 ' + est.next.label + ' · ' + crewLabel(est.next.crew) + '으로 올라가 약 ' + won(est.next.delta) + ' 더 들어요. 버리기·정리로 줄이면 그만큼 아껴요.');
    if (est.inputs.fromMethod === 'ladder' && est.inputs.fromFloor <= 3 && est.inputs.fromFloor >= 2) tips.push('출발지 ' + est.inputs.fromFloor + '층 사다리차를 빼면 약 ' + won(est.lifts.from.typical - liftCost(est.inputs.fromFloor, 'elevator', est.tons, c).typical) + ' 줄일 수 있어요 (업체에 문의).');
    if (est.counts.acN) tips.push('에어컨을 LG에 맡기면 이 표에서 빠지고 LG 요금이 따로 들어요 — ‘LG·이삿짐센터 비교’ 탭에서 대당 요금을 비교하세요.');
    tips.push('방문견적은 3곳에서 같은 조건표(‘업체에 보낼 짐 목록’)로 받고, 부가세 포함 총액으로 비교하세요.');
    return el('section', { class: 'card es-why', 'aria-label': '왜 이 금액인가요' },
      sectionHead('💬', '왜 이 금액인가요?'),
      el('ol',
        el('li', el('b', '짐 부피 ' + m3(est.volume)), ' = 가구·가전 ' + vp.units + '개 (규격 상자 ' + m3(vp.furnRaw) + ' → 모양·틈 보정 ' + m3(vp.furnEff) + ') + 박스 ' + vp.boxes + '개 × ' + c.m3_per_box + '㎥ (' + m3(vp.boxM3) + ') + 목록 밖 잡동사니 ' + m3(vp.miscM3) + '.' +
          (est.lgCount ? ' LG가 옮길 가전 ' + est.lgCount + '개는 빠져요.' : '')),
        el('li', el('b', '필요 톤수'), ' = ' + m3(est.volume) + ' ÷ ' + c.m3_per_ton + '㎥/톤 = ' + r2(est.tonsNeed) + '톤, 여유 ' + c.truck_margin + '% 더해 ' + r2(est.tonsMargin) + '톤 → 위 등급인 ', el('b', est.truckLabel), ', 인원 ', el('b', est.crewLabel), '.'),
        el('li', el('b', '본비 ' + won(base)), ' = ' + tonsLabel(est.tons) + ' × ' + won(c.base_per_ton) + ' + ' + est.crew + '명 × ' + won(c.crew_day_rate) + (est.packType !== 'full' ? ' (' + (PACK_TYPES.find((p) => p.id === est.packType) || {}).label + ' 비율 적용)' : '') + '. 차량·연료·포장재와 인건비예요.'),
        el('li', el('b', '날짜 할증 ' + (est.surchargePct ? '+' + r1(est.surchargePct) + '%' : '없음')), ' — ' + est.dateLabel + '. 할증은 본비에만 붙어요 (손없는날 ' + c.sohn_pct + '%, 주말 ' + c.weekend_pct + '%, 월말 ' + c.month_end_pct + '%, 월초 ' + c.month_start_pct + '%; 겹치면 가장 큰 값 + ' + c.multi_add_pct + '%포인트).'),
        el('li', el('b', '부대비 ' + won(sum(extras, (l) => l.typical))), extras.length ? ' = ' + extras.map((l) => l.label.replace(/\s*\(.*\)$/, '') + ' ' + won(l.typical)).join(', ') + '.' : ' — 없음.'),
        el('li', el('b', '기준가 ' + won(est.typical) + ' (' + basisLabel(est.vatIncl) + ')'), ' — 하한은 × ' + c.range_low + ' (' + won(est.low) + '), 상한은 × ' + c.range_high + ' (' + won(est.high) + '). 업체마다 인건비·마진·당일 사정이 달라서 범위로 봐요.' + (est.calibFactor !== 1 ? ' 방문견적 중앙값에 맞춘 보정 ' + josa('×' + est.calibFactor.toFixed(2), '이/가') + ' 들어 있어요.' : '')),
        est.vatIncl ? null : el('li', el('b', '실제로 낼 돈 ' + won(est.pay.typical) + ' (부가세 포함)'), ' = 기준가 × ' + fmtDec(1 + est.coef.vat_pct / 100) + ' (부가세 ' + fmtDec(est.coef.vat_pct) + '%). 범위 ' + won(est.pay.low) + ' ~ ' + won(est.pay.high) + '. 리서치 시세는 부가세 별도라 더했어요 — 머리말·자금 화면은 이 숫자를 써요.')),
      el('h3', { class: 'es-h3' }, '💡 이렇게 하면 달라져요'),
      el('ul', { class: 'es-tips' }, tips.map((t) => el('li', t))),
      est.notes.length ? el('div', { class: 'callout mt-12' }, el('ul', { class: 'es-tips', style: { marginTop: 0 } }, est.notes.map((n) => el('li', n)))) : null);
  }

  /* ---------- 계산 기준 (계수) ---------- */
  function coefRow(d) {
    const cur = () => coefNow()[d.k];
    let input;
    let ctl;
    const err = el('small', { class: 'es-coef-err', role: 'alert', hidden: true });
    const rangeTxt = fmtCoef(d, d.min) + ' ~ ' + fmtCoef(d, d.max);
    /* 범위 밖 값(예: 박스 부피 0, 하한 배수 1.5)은 저장하지 않고 원래 값으로 되돌림 */
    const reject = () => {
      input.value = d.money ? F.num(cur()) : String(cur());
      if (d.money) { const h = ctl.querySelector('.hint'); if (h) h.textContent = F.krw(cur()); }
      input.setAttribute('aria-invalid', 'true');
      err.textContent = rangeTxt + ' 사이로 넣어 주세요. 원래 값으로 되돌렸어요.';
      err.hidden = false;
    };
    const accept = (v) => { input.removeAttribute('aria-invalid'); err.hidden = true; if (Math.abs(v - cur()) > 1e-12) setCoef(d.k, v); };
    if (d.money) {
      ctl = MV.ui.moneyInput(cur(), (v) => { if (inBounds(d, v)) accept(v); else reject(); }, { placeholder: F.num(d.v) });
      input = ctl.input;
    } else {
      input = el('input', { class: 'input num', type: 'number', min: String(d.min), max: String(d.max), step: String(d.step || 1), inputmode: 'decimal', value: String(cur()) });
      input.addEventListener('change', () => {
        if (input.value.trim() === '') { input.value = String(cur()); return; }
        const v = parseFloat(input.value);
        if (inBounds(d, v)) accept(v); else reject();
      });
      input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); input.blur(); } });
      ctl = el('span', { class: 'es-coef-num' }, input, d.unit ? el('span', { class: 'es-unit' }, d.unit) : null);
    }
    input.setAttribute('aria-label', d.label);
    input.dataset.fk = 'coef-' + d.k;
    const changed = el('span', { class: 'chip warn' }, '수정됨');
    const resetBtn = el('button', { type: 'button', class: 'btn btn-sm btn-ghost', 'aria-label': d.label + ' 기준값으로', title: '기준값 ' + josa(fmtCoef(d, d.v), '으로/로'), onclick: () => { err.hidden = true; input.removeAttribute('aria-invalid'); setCoef(d.k, d.v); } }, '↺');
    const range = (isNum(d.lo) && isNum(d.hi)) ? ' · 리서치 범위 ' + fmtCoef(d, d.lo) + ' ~ ' + fmtCoef(d, d.hi) : '';
    const row = el('div', { class: 'es-coef-row' },
      el('div',
        el('div', { class: 'es-coef-label' }, d.label, d.money && d.unit ? el('span', { class: 'es-unit' }, d.unit) : null, d.ref ? el('span', { class: 'chip' }, '참고용 · 계산 제외') : null),
        el('div', { class: 'es-coef-basis' }, el('span', { class: 'es-bk' }, '근거 '), d.basis, range, ' · 기준값 ' + fmtCoef(d, d.v), srcLinks(d.src))),
      el('div', { class: 'es-coef-ctl' }, ctl, confChip(d.conf), changed, resetBtn),
      err);
    upd(() => {
      const v = cur();
      if (document.activeElement !== input) {
        input.value = d.money ? F.num(v) : String(v);
        if (d.money) { const h = ctl.querySelector('.hint'); if (h) h.textContent = F.krw(v); }
      }
      const ch = Math.abs(v - d.v) > 1e-9;
      changed.hidden = !ch; resetBtn.hidden = !ch;
      row.classList.toggle('is-changed', ch);
    }, row);
    return row;
  }
  function coefCard() {
    const card = el('section', { class: 'card es-coef', 'aria-label': '계산 기준' });
    const count = el('span', { class: 'chip' });
    const toggle = el('button', { type: 'button', class: 'es-coef-toggle', 'aria-expanded': String(mem.coefOpen), 'aria-controls': 'es-coef-inner' },
      el('span', { 'aria-hidden': 'true' }, '🔧'), el('h2', '계산 기준 보기·수정'), count, el('span', { class: 'es-chev', 'aria-hidden': 'true' }, '▾'));
    const inner = el('div', { class: 'es-coef-inner', id: 'es-coef-inner', hidden: !mem.coefOpen });
    const build = () => {
      inner.dataset.built = '1';
      inner.appendChild(el('p', { class: 'small es-muted' }, '모든 계수는 리서치 검증본(2026-10-06)에서 왔어요. 각 줄의 ‘근거’와 ‘신뢰도’를 보고, 방문견적에서 들은 값이 있으면 바꾸세요. 바꾼 값은 저장되고 언제든 되돌릴 수 있어요.'));
      inner.appendChild(el('div', { class: 'row' },
        el('button', { type: 'button', class: 'btn btn-danger btn-sm', onclick: () => {
          MV.ui.confirm('계산 기준(계수)을 모두 리서치 기준값으로 되돌릴까요? 견적 보정·입력값은 그대로예요.', { okLabel: '기준값으로 되돌리기', danger: true }).then((ok) => {
            if (ok) { MV.store.update((st) => { ensureEst(st).coef = Object.assign({}, DEF_COEF); }, { log: '이사 견적 계산 기준을 기준값으로 되돌림' }); toast('기준값으로 되돌렸어요.'); }
          });
        } }, '↺ 기준값으로 되돌리기')));
      GROUPS.forEach((g) => {
        const defs = COEFS.filter((d) => d.g === g.id);
        const det = el('details', { class: 'es-coef-grp', open: mem.groupsOpen.has(g.id) });
        const gn = el('span', { class: 'es-gn' });
        det.appendChild(el('summary', el('span', { 'aria-hidden': 'true' }, g.icon), g.title, gn));
        det.addEventListener('toggle', () => { if (det.open) mem.groupsOpen.add(g.id); else mem.groupsOpen.delete(g.id); });
        defs.forEach((d) => det.appendChild(coefRow(d)));
        upd(() => { const c = coefNow(); const n = defs.filter((d) => Math.abs(c[d.k] - d.v) > 1e-9).length; gn.textContent = defs.length + '개' + (n ? ' · ' + n + '개 수정' : ''); });
        inner.appendChild(det);
      });
    };
    toggle.addEventListener('click', () => {
      mem.coefOpen = !mem.coefOpen;
      toggle.setAttribute('aria-expanded', String(mem.coefOpen));
      inner.hidden = !mem.coefOpen;
      if (mem.coefOpen && !inner.dataset.built) build();
    });
    if (mem.coefOpen) build();
    upd(() => { const c = coefNow(); const n = COEFS.filter((d) => Math.abs(c[d.k] - d.v) > 1e-9).length; count.textContent = n ? n + '개 수정됨' : '리서치 기준값'; count.className = 'chip' + (n ? ' warn' : ''); });
    card.appendChild(toggle);
    card.appendChild(inner);
    return card;
  }
  function renderEstimate(body) {
    body.appendChild(region(heroCard, 'hero'));
    const grid = el('div', { class: 'es-est-grid' });
    const left = el('div', { class: 'es-est-col' });
    left.appendChild(inputsCard());
    const right = el('div', { class: 'es-est-col' });
    right.appendChild(region(linesCard, 'lines'));
    right.appendChild(region(whyCard, 'why'));
    grid.appendChild(left);
    grid.appendChild(right);
    body.appendChild(grid);
    body.appendChild(coefCard());
  }

  /* ======================= 3) 업체 견적 비교 ======================= */
  const ASK = [
    '차량 톤수·대수와 작업 인원(남·여, 정리 인력)은요?',
    '사다리차 2회(출발 2층·도착 14층)가 포함인가요? 도착지 설치 위치를 확인했나요?',
    '양쪽 단지 엘리베이터 사용료·보양이 포함인가요?',
    '에어컨 철거·이전설치(대수·배관 m·가스·출장비)가 포함인가요? 직접 하나요, 하청 기사인가요?',
    '침대·장롱 분해조립, 대형 냉장고 도어 탈거가 포함인가요?',
    '폐기물 처리는 포함인가요? 따로면 얼마인가요?',
    '부가세 포함 총액인가요? 카드·현금 상관없이 같은 금액인가요? (카드 수수료 전가는 불법)',
    '계약금은 얼마이고, 잔금은 하차·점검이 끝난 뒤 내도 되나요?',
    '화물자동차 운송주선사업 허가증과 사업자등록증 사본을 받을 수 있나요?',
    '적재물배상보험 증권(보험사·사고당 보상한도)을 볼 수 있나요? (법정 최저 500만원 수준 → 1천만원 이상인지)',
    '견적 온 회사가 직접 작업하나요(재하청 여부)? 현장 책임자 이름·연락처는요?',
    '하차는 잔금·열쇠 인수 뒤 13시 전후인데, 대기비 없이 가능한가요?',
    '‘사전 동의 없는 추가요금 없음’ 특약을 계약서에 넣을 수 있나요?',
    '‘가전 포함’과 ‘LG로 옮길 가전 제외’ 금액을 둘 다 문자나 PDF로 받을 수 있나요?',
    '파손 때 사고확인서를 바로 써 주나요? 이사화물 표준약관을 적용하나요?',
  ];
  function newQuote() {
    return { id: MV.uid('qt'), company: '', date: '', amount: null, vatIncluded: true, tons: null, crew: null, ladder: false, aircon: false, arrange: false, waste: false, deposit: null, licenseChecked: false, insuranceChecked: false, visitDone: false, note: '' };
  }
  /* 견적 3곳 이상이면 '다른 업체 중앙값' 기준으로, 그보다 적으면 모델 범위 기준으로 너무 싸거나 비싼지 봄 */
  function peerMedian(raw) {
    const ns = quotesOf(estSt()).map((x) => normQuote(x, raw)).filter(Boolean).map((x) => x.amount);
    return ns.length >= 3 ? median(ns) : null;
  }
  function quoteEval(q, est, raw, peerMed) {
    const n = normQuote(q, raw);
    const out = { n, badges: [], warns: [], tooCheap: false, tooHigh: false, diff: null };
    if (!n) { out.warns.push({ t: '금액을 넣으면 모델과 비교해요.', k: 'info' }); return out; }
    const c = raw.coef;
    const pm = peerMed === undefined ? peerMedian(raw) : peerMed;
    out.diff = n.amount / est.typical - 1;
    const peerDiff = pm ? n.amount / pm - 1 : null;
    out.tooCheap = pm ? (peerDiff < -0.15 || n.amount < est.typical * 0.6) : n.amount < est.low;
    out.tooHigh = pm ? peerDiff > 0.25 : n.amount > est.high;
    const dTxt = Math.abs(out.diff) < 0.005 ? '모델과 거의 같음' : '모델보다 ' + Math.abs(Math.round(out.diff * 100)) + '% ' + (out.diff < 0 ? '낮음' : '높음');
    out.badges.push({ t: dTxt, cls: out.tooCheap ? 'bad' : out.tooHigh ? 'warn' : (pm || Math.abs(out.diff) <= 0.15) ? 'good' : '' });
    if (pm && Math.abs(peerDiff) >= 0.005) out.badges.push({ t: '다른 견적 중앙값보다 ' + Math.abs(Math.round(peerDiff * 100)) + '% ' + (peerDiff < 0 ? '낮음' : '높음'), cls: out.tooCheap ? 'bad' : out.tooHigh ? 'warn' : '' });
    if (out.tooCheap) out.warns.push({ t: (pm ? '다른 견적들보다 눈에 띄게 싸요' : '모델 하한(' + won(est.low) + ')보다 싸요') + ' — 당일 ‘짐이 많다’며 증차·증원 추가요금을 요구할 위험이 있어요. 포함 항목을 서면으로 받으세요.', k: 'bad' });
    else if (out.tooHigh) out.warns.push({ t: (pm ? '다른 견적들보다 눈에 띄게 비싸요' : '모델 상한(' + won(est.high) + ')보다 비싸요') + ' — 포함 항목을 다시 확인하고 협상해 보세요.', k: 'warn' });
    else if (!pm && out.diff < -0.15) out.warns.push({ t: '모델 범위 안이지만 꽤 낮은 편이에요. 모델은 신뢰도 낮은 추정치라 견적 3곳이 모이면 서로 비교해 판단하세요.', k: 'info' });
    if (!q.ladder && raw.parts.ladder > 0) out.warns.push({ t: '사다리차 미포함(또는 미확인) — 약 ' + won(raw.parts.ladder) + ' 더 들 수 있어요 (환산에 더했어요).', k: 'warn' });
    if (!q.aircon && raw.parts.aircon > 0) out.warns.push({ t: '에어컨 이전 미포함(또는 미확인) — 약 ' + won(raw.parts.aircon) + ' (환산에 더했어요).', k: 'warn' });
    if (!q.waste && raw.parts.waste > 0) out.warns.push({ t: '폐기물 처리 미포함 — 약 ' + won(raw.parts.waste) + ' (환산에 더했어요).', k: 'warn' });
    if (!q.arrange && raw.parts.arrange > 0) out.warns.push({ t: '정리 인력 미포함 — 약 ' + won(raw.parts.arrange) + ' (환산에 더했어요).', k: 'warn' });
    if (q.vatIncluded === false) {
      out.warns.push({ t: (raw.vatIncl ? '부가세 별도 견적 → ' + r1(c.vat_pct) + '%를 더해 비교했어요.' : '부가세 별도 견적 — 모델도 부가세 별도라 그대로 비교했어요. 실제로 낼 돈은 약 ' + won(num(q.amount, 0) * raw.vatMul) + '(부가세 포함)이에요.') +
        ' 계약은 ‘부가세 포함 총액, 결제수단 무관’으로 하세요.', k: 'info' });
    }
    const qt = num(q.tons, 0);
    if (qt > 0 && qt < est.tons) out.warns.push({ t: '차량 ' + tonsLabel(qt) + '은 모델(' + tonsLabel(est.tons) + ')보다 작아요 — 당일 증차 요구 위험.', k: 'warn' });
    const qc = num(q.crew, 0);
    if (qc > 0 && qc < Math.floor(est.crew)) out.warns.push({ t: '인원 ' + qc + '명은 모델(' + est.crewLabel + ')보다 적어요 — 작업이 길어질 수 있어요.', k: 'warn' });
    const dep = num(q.deposit, 0);
    if (dep > 0) {
      const p = dep / num(q.amount, 1);
      if (p < 0.05) out.warns.push({ t: '계약금이 총액의 ' + Math.round(p * 100) + '%예요. 업체가 어기면 받는 배상(계약금의 배수)도 작아져요 — ' + c.deposit_pct + '% 안팎을 권해요.', k: 'warn' });
      else if (p > 0.2) out.warns.push({ t: '계약금이 총액의 ' + Math.round(p * 100) + '%로 많아요 — ' + c.deposit_pct + '% 안팎을 권해요.', k: 'warn' });
    }
    if (!q.licenseChecked) out.warns.push({ t: '허가증(화물자동차 운송주선사업) 사본 확인 전이에요.', k: 'info' });
    if (!q.insuranceChecked) out.warns.push({ t: '적재물배상보험 증권 확인 전 — 법정 최저는 사고당 500만원 수준이라 1천만원 이상인지 보세요.', k: 'info' });
    if (!q.visitDone) out.warns.push({ t: '방문견적 전 금액이에요 — 전화·플랫폼 견적은 당일 추가요금 위험이 커요.', k: 'info' });
    return out;
  }
  function bestQuote(est, raw) {
    const pm = peerMedian(raw);
    const scored = quotesOf(estSt()).map((q) => ({ q, ev: quoteEval(q, est, raw, pm) })).filter((x) => x.ev.n);
    if (scored.length < 2) return null;
    const rangeTxt = pm ? '너무 싸지 않은 견적 중' : '모델 범위 안에서';
    let pool = scored.filter((x) => !x.ev.tooCheap && x.q.licenseChecked && x.q.insuranceChecked);
    let basis = '허가·보험 확인 + ' + rangeTxt + ' 가장 저렴';
    if (!pool.length) { pool = scored.filter((x) => !x.ev.tooCheap); basis = rangeTxt + ' 가장 저렴 (허가·보험 확인 전)'; }
    if (!pool.length) return null;
    pool.sort((a, b) => a.ev.n.amount - b.ev.n.amount);
    return { id: pool[0].q.id, basis };
  }
  function quotesTop() {
    const est = R.est;
    return el('section', { class: 'card', 'aria-label': '모델 기준' },
      sectionHead('🧮', '모델 기준', '같은 조건으로 계산한 추정치',
        el('button', { type: 'button', class: 'btn btn-sm btn-ghost', onclick: () => goTab('estimate') }, '조건 바꾸기 →')),
      el('div', { class: 'es-qref' },
        el('span', { class: 'es-qref-big' }, '약 ' + won(est.typical)), el('span', { class: 'es-vat' }, basisLabel(est.vatIncl)),
        est.vatIncl ? null : el('span', { class: 'small strong' }, '부가세 포함 약 ' + won(est.pay.typical)),
        el('span', { class: 'small es-muted' }, won(est.low) + ' ~ ' + won(est.high) + ' · ' + est.truckLabel + ' · ' + est.crewLabel +
          ' · 사다리차 ' + (est.parts.ladder > 0 ? '포함' : '없음') + ' · 에어컨 ' + (est.counts.acN ? est.counts.acN + '대 포함' : '제외'))),
      el('div', { class: 'mt-12' }, calibBox(false)),
      el('p', { class: 'small es-muted mt-8 mb-0' }, '업체 견적에 빠진 항목(사다리차·에어컨 등)은 모델 금액을 더해 ‘같은 조건 환산’으로 비교해요. 부가세도 모델과 같은 기준으로 맞춰요 — 지금 모델은 ',
        el('b', basisLabel(est.vatIncl)), est.vatIncl ? ' 금액이라 ‘부가세 별도’ 견적에 ' + r1(est.coef.vat_pct) + '%를 더해요.' : ' 시세라 ‘부가세 포함’ 견적에서 부가세를 빼고 비교해요. 부가세 포함으로 비교하려면 ‘이사 견적’ 탭의 ‘금액 내역·업체 비교도 부가세 포함으로 보기’를 켜세요.'));
  }
  function quotesCompare() {
    const est = R.est;
    const raw = rawEst();
    const qs = quotesOf(estSt());
    if (!qs.length) {
      return el('section', { class: 'card' }, el('div', { class: 'empty' },
        el('span', { class: 'big', 'aria-hidden': 'true' }, '📑'),
        el('p', '아직 받은 견적이 없어요. 방문견적을 받을 때마다 넣으면 모델과 비교하고 ‘견적으로 보정’할 수 있어요.'),
        el('p', { class: 'small' }, '권장: 플랫폼 2곳 + 지인 추천 1~2곳 → 후보 5곳 중 3곳 방문견적'),
        el('button', { type: 'button', class: 'btn btn-primary', onclick: addQuote }, '+ 견적 추가')));
    }
    const best = bestQuote(est, raw);
    const pm = peerMedian(raw);
    const rows = qs.map((q) => ({ q, ev: quoteEval(q, est, raw, pm) }))
      .sort((a, b) => (a.ev.n ? a.ev.n.amount : Infinity) - (b.ev.n ? b.ev.n.amount : Infinity));
    const incl = (q) => [['ladder', '사다리차'], ['aircon', '에어컨'], ['arrange', '정리'], ['waste', '폐기물']].filter(([k]) => q[k]).map(([, l]) => l);
    const checks = (q) => [['visitDone', '방문'], ['licenseChecked', '허가'], ['insuranceChecked', '보험']].map(([k, l]) => el('span', { class: 'chip ' + (q[k] ? 'good' : ''), title: q[k] ? l + ' 확인함' : l + ' 확인 전' }, (q[k] ? '✓ ' : '') + l));
    const tbl = el('table', { class: 'tbl es-qtbl' },
      el('thead', el('tr', el('th', '업체'), el('th', { class: 'num' }, '같은 조건 환산', el('span', { class: 'tiny es-muted', style: { display: 'block', fontWeight: '600' } }, basisLabel(raw.vatIncl))), el('th', '모델·다른 견적 대비'), el('th', '포함 · 확인'))),
      el('tbody', rows.map(({ q, ev }) => el('tr',
        el('td', { class: 'es-qco-td' + (best && best.id === q.id ? ' es-qbest' : '') }, el('div', { class: 'es-qco', title: q.company || '' }, q.company || '이름 없는 업체'),
          best && best.id === q.id ? el('span', { class: 'chip good' }, '⭐ 추천') : null,
          el('div', { class: 'tiny es-muted' }, (num(q.tons, 0) ? tonsLabel(num(q.tons, 0)) : '톤 —') + ' · ' + (num(q.crew, 0) ? q.crew + '명' : '인원 —') + (q.date ? ' · ' + D.fmt(q.date) : ''))),
        el('td', { class: 'num' }, el('b', ev.n ? won(ev.n.amount) : '—'), el('div', { class: 'tiny es-muted' }, '견적 ' + (num(q.amount, 0) > 0 ? won(q.amount) : '—'))),
        el('td', el('div', { class: 'es-qbadges', style: { marginTop: 0 } }, ev.badges.map((b) => el('span', { class: 'chip ' + b.cls }, b.t)))),
        el('td', el('div', { class: 'small' }, incl(q).length ? '포함: ' + incl(q).join('·') : '포함 항목 미확인'), el('div', { class: 'es-qbadges', style: { marginTop: '4px' } }, checks(q)))))));
    const cards = el('div', { class: 'es-qcmp-cards' }, rows.map(({ q, ev }) => el('div', { class: 'es-qcmp-card' },
      el('div', { class: 'strong', style: { minWidth: '0' } }, el('span', { class: 'es-qco', title: q.company || '' }, q.company || '이름 없는 업체'), best && best.id === q.id ? el('span', { class: 'chip good', style: { marginLeft: '6px' } }, '⭐ 추천') : null),
      el('div', { class: 'es-qc-amt' }, ev.n ? won(ev.n.amount) : '—'),
      el('div', { class: 'es-qc-sub' }, ev.badges.map((b) => el('span', { class: 'chip ' + b.cls }, b.t)),
        el('span', '견적 ' + (num(q.amount, 0) > 0 ? won(q.amount) : '—') + ' · ' + (num(q.tons, 0) ? tonsLabel(num(q.tons, 0)) : '톤 —') + ' · ' + (num(q.crew, 0) ? q.crew + '명' : '인원 —'))))));
    return el('section', { class: 'card', 'aria-label': '견적 비교표' },
      sectionHead('📊', '견적 비교', '같은 조건·' + basisLabel(raw.vatIncl) + ' 환산 금액 순'),
      el('div', { class: 'table-wrap es-qcmp-tbl' }, tbl), cards,
      best ? el('p', { class: 'small mt-8 mb-0' }, '⭐ 추천 기준: ' + best.basis + '. 가장 싼 곳이 아니라 ‘빠진 것 없이 믿을 만한 곳’을 고르세요.') : null);
  }
  function textCommit(input, fn) {
    const deb = MV.debounce(() => fn(input.value), 400);
    input.addEventListener('input', deb);
    input.addEventListener('change', () => { deb.flush(); });
    input.addEventListener('blur', () => deb.flush());
  }
  function quoteCard(id) {
    const q0 = getQuote(id) || newQuote();
    const card = el('article', { class: 'card es-qcard', 'data-qid': id, 'aria-label': '업체 견적' });
    const company = el('input', { class: 'input es-qname', value: q0.company || '', placeholder: '업체명 (예: ○○익스프레스)', 'aria-label': '업체명', 'data-fk': 'q-' + id + '-company' });
    textCommit(company, (v) => updQuote(id, { company: v.trim() }));
    const del = el('button', { type: 'button', class: 'btn btn-ghost btn-icon', 'aria-label': '이 견적 지우기', title: '지우기', onclick: () => {
      const q = getQuote(id);
      MV.ui.confirm('“' + clip((q && q.company) || '이름 없는 업체', 40) + '” 견적을 지울까요?', { danger: true, okLabel: '지우기' }).then((ok) => {
        if (!ok) return;
        const before = MV.clone(quotesOf(estSt()));
        const prevCal = MV.clone(calibOf(estSt()));
        let cleared = false;
        MV.store.update((st) => {
          const e = ensureEst(st);
          e.quotes = e.quotes.filter((x) => x && x.id !== id);
          // 보정 근거였던 견적(금액 있는 것)이 하나도 안 남으면 보정도 함께 해제 — 되돌리기로 둘 다 복구
          const left = e.quotes.filter((x) => x && num(x.amount, 0) > 0).length;
          if (!left && Math.abs(calibOf(e).factor - 1) > 1e-6) { e.calib = { factor: 1, at: null, median: null, n: 0, base: null }; cleared = true; }
        }, { log: '업체 견적 삭제: ' + clip((q && q.company) || '이름 없는 업체', 40) + (cleared ? ' (남은 견적이 없어 보정도 해제)' : '') });
        const undo = { label: '되돌리기', onClick: () => MV.store.update((st) => { const e = ensureEst(st); e.quotes = before; if (cleared) e.calib = prevCal; }, { log: '견적 삭제 되돌림' }) };
        toast(cleared ? '견적을 지우고, 남은 견적이 없어 보정도 해제했어요.' : '견적을 지웠어요.', { action: undo });
      });
    } }, '🗑');
    const date = el('input', { class: 'input', type: 'date', value: q0.date || '', 'aria-label': '방문견적일', 'data-fk': 'q-' + id + '-date' });
    date.addEventListener('change', () => updQuote(id, { date: date.value }));
    /* 금액을 지우면 core 입력칸은 '0'·'0원'을 보여 주지만 저장값은 null(금액 없음) — 칸도 비워 맞춤 */
    const blankIfNone = (w, v) => { if (!(v > 0)) { w.input.value = ''; const h = w.querySelector('.hint'); if (h) h.textContent = ''; } };
    const amount = MV.ui.moneyInput(isNum(q0.amount) ? q0.amount : null, (v) => { blankIfNone(amount, v); updQuote(id, { amount: Math.max(0, v) || null }); }, { placeholder: '예: 210만' });
    amount.input.setAttribute('aria-label', '견적 금액'); amount.input.dataset.fk = 'q-' + id + '-amount';
    const deposit = MV.ui.moneyInput(isNum(q0.deposit) ? q0.deposit : null, (v) => { blankIfNone(deposit, v); updQuote(id, { deposit: Math.max(0, v) || null }); }, { placeholder: '예: 20만' });
    deposit.input.setAttribute('aria-label', '계약금'); deposit.input.dataset.fk = 'q-' + id + '-deposit';
    const vat = el('select', { class: 'select', 'aria-label': '부가세', 'data-fk': 'q-' + id + '-vat' },
      el('option', { value: 'in' }, '부가세 포함'), el('option', { value: 'ex' }, '부가세 별도'));
    vat.value = q0.vatIncluded === false ? 'ex' : 'in';
    vat.addEventListener('change', () => updQuote(id, { vatIncluded: vat.value !== 'ex' }));
    const numF = (key, label, step) => {
      const x = el('input', { class: 'input num', type: 'number', min: '0', step: String(step), inputmode: 'decimal', value: isNum(q0[key]) ? String(q0[key]) : '', 'aria-label': label, 'data-fk': 'q-' + id + '-' + key, placeholder: '—' });
      x.addEventListener('change', () => { const v = parseFloat(x.value); updQuote(id, { [key]: isFinite(v) && v > 0 ? v : null }); });
      x.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); x.blur(); } });
      return x;
    };
    const cb = (key, label) => {
      const x = el('input', { type: 'checkbox', checked: !!q0[key], 'data-fk': 'q-' + id + '-' + key });
      x.addEventListener('change', () => updQuote(id, { [key]: x.checked }));
      return el('label', { class: 'check es-check' }, x, el('span', label));
    };
    const note = el('textarea', { class: 'textarea', rows: '2', placeholder: '메모 (담당자, 특약 가능 여부, 느낌 등)', 'aria-label': '메모', 'data-fk': 'q-' + id + '-note' }, q0.note || '');
    textCommit(note, (v) => updQuote(id, { note: v }));
    const badges = el('div', { class: 'es-qbadges' });
    const normTxt = el('div', { class: 'es-qnorm' });
    const warns = el('ul', { class: 'es-qwarns' });
    card.append(
      el('div', { class: 'es-qcard-head' }, company, del),
      el('div', { class: 'es-fgrid' },
        el('label', { class: 'field es-field' }, el('span', '방문견적일'), date),
        el('div', { class: 'field es-field' }, el('span', '견적 금액'), amount),
        el('label', { class: 'field es-field' }, el('span', '부가세'), vat),
        el('label', { class: 'field es-field' }, el('span', '차량 (톤)'), numF('tons', '차량 톤수', 0.5)),
        el('label', { class: 'field es-field' }, el('span', '인원 (명)'), numF('crew', '작업 인원', 0.5)),
        el('div', { class: 'field es-field' }, el('span', '계약금'), deposit)),
      el('div', { class: 'es-qchecks' },
        el('span', { class: 'es-qcl' }, '견적에 포함된 것'),
        cb('ladder', '사다리차'), cb('aircon', '에어컨 이전'), cb('arrange', '정리 인력'), cb('waste', '폐기물'),
        el('span', { class: 'es-qcl' }, '확인한 것'),
        cb('visitDone', '방문견적 받음'), cb('licenseChecked', '관허(허가증) 확인'), cb('insuranceChecked', '적재물배상보험 확인')),
      el('div', { class: 'mt-8' }, note),
      badges, normTxt, warns);
    upd(() => {
      const q = getQuote(id);
      if (!q) return;
      const est = R.est;
      const raw = rawEst();
      const ev = quoteEval(q, est, raw);
      const best = bestQuote(est, raw);
      card.classList.toggle('is-best', !!best && best.id === id);
      card.classList.toggle('is-cheap', ev.tooCheap);
      badges.replaceChildren(...ev.badges.map((b) => el('span', { class: 'chip ' + b.cls }, b.t)),
        ...(best && best.id === id ? [el('span', { class: 'chip good' }, '⭐ 추천')] : []));
      normTxt.textContent = ev.n ? '같은 조건 환산 ' + won(ev.n.amount) + ' (' + basisLabel(raw.vatIncl) + ' 기준' +
        (ev.n.adds.length ? ' = 견적 ' + won(q.amount) + ev.n.adds.map((a) => (a.v < 0 ? ' − ' : ' + ') + a.label.replace(/ 빼기$/, '') + ' ' + won(Math.abs(a.v))).join('') : '') + ') · 모델 기준 ' + won(est.typical) : '';
      warns.replaceChildren(...ev.warns.map((w) => el('li', { class: 'is-' + w.k }, w.t)));
      if (document.activeElement !== company && company.value !== (q.company || '')) company.value = q.company || '';
      ['ladder', 'aircon', 'arrange', 'waste', 'visitDone', 'licenseChecked', 'insuranceChecked'].forEach((k) => {
        const x = card.querySelector('[data-fk="q-' + id + '-' + k + '"]'); if (x && x.checked !== !!q[k]) x.checked = !!q[k];
      });
    }, card);
    return card;
  }
  let lastAddAt = 0;
  function addQuote() {
    // 두 번 빠르게 누르면(빈 화면 → 다시 그린 머리말의 ‘+ 견적 추가’ 위로 두 번째 탭이 떨어짐) 하나만 추가
    if (Date.now() - lastAddAt < 700) return;
    lastAddAt = Date.now();
    const q = newQuote();
    mem.focusQuote = q.id;
    MV.store.update((st) => { ensureEst(st).quotes.push(q); }, { log: '업체 견적 칸 추가' });
  }
  function quotesEditor() {
    const wrap = el('section', { class: 'es-qlist', 'aria-label': '업체 견적 입력' });
    const list = el('div', { class: 'es-qlist' });
    const addBtn = el('button', { type: 'button', class: 'btn btn-primary', onclick: addQuote }, '+ 견적 추가');
    let sig = null;
    const rebuild = () => {
      const qs = quotesOf(estSt());
      sig = qs.map((q) => q.id).join(',');
      list.replaceChildren(...qs.map((q) => quoteCard(q.id)));
      if (mem.focusQuote) {
        const n = list.querySelector('[data-fk="q-' + mem.focusQuote + '-company"]');
        mem.focusQuote = null;
        if (n) { n.focus({ preventScroll: true }); n.scrollIntoView({ block: 'center', behavior: 'smooth' }); }
      }
    };
    const headRow = el('div', { class: 'row' }, el('h2', { class: 'es-h2', style: { margin: 0 } }, '✍️ 받은 견적 입력'), el('span', { class: 'spacer' }), addBtn);
    upd(() => {
      const s = quotesOf(estSt()).map((q) => q.id).join(',');
      headRow.hidden = !s;
      if (s === sig) return;
      const a = document.activeElement;
      if (a && list.contains(a) && isTyping(a)) { if (R) R.dirty = true; return; }
      rebuild();
    });
    wrap.append(headRow, list);
    return wrap;
  }
  function askCard() {
    const text = '[방문견적 때 물어볼 것]\n' + ASK.map((t, i) => (i + 1) + '. ' + t).join('\n');
    return el('aside', { class: 'card es-ask es-ask-card', 'aria-label': '방문견적 질문 목록' },
      sectionHead('❓', '방문견적 때 물어볼 것', null, el('button', { type: 'button', class: 'btn btn-sm', onclick: () => copyText(text) }, '📋 복사')),
      // 가이드 링크는 맨 위에 — 데스크톱에서 이 칸이 따로 스크롤돼 아래쪽이 잘 안 보여요
      el('div', { class: 'row es-ask-links' },
        el('a', { class: 'btn btn-sm', href: '#/guide/mover' }, '📘 업체 고르는 법 가이드 →'),
        srcLinks(['jjan', 'terms'])),
      el('div', { class: 'callout warn small' }, '견적은 꼭 문자·PDF 같은 서면으로 받고, 버릴 것과 LG가 옮길 것은 현장에서 실물로 표시하세요. 2021~2023 포장이사 피해 중 약 70%가 파손이었어요.', ' ', srcLinks(['kca', 'herald'])),
      el('ol', ASK.map((t) => el('li', t))));
  }
  function renderQuotes(body) {
    body.appendChild(region(quotesTop, 'qtop'));
    const grid = el('div', { class: 'es-q-grid' });
    const main = el('div', { class: 'es-q-main' });
    main.appendChild(region(quotesCompare, 'qcmp'));
    main.appendChild(quotesEditor());
    grid.appendChild(main);
    grid.appendChild(askCard());
    body.appendChild(grid);
  }

  /* ======================= 4) LG·이삿짐센터 비교 ======================= */
  /* 견적 계산(isGoing)과 같은 규칙: ‘가져감’ + (‘미정도 가져가는 것으로 계산’이 켜져 있으면) ‘미정’ — lgCost 와 목록이 늘 같은 가전 */
  function lgCandidates() { const inp = inpNow(); return invItems((it) => isGoing(it, inp) && isApplianceLike(it)); }
  function lgScenarios() {
    const st = stGet();
    const inv = (st.inventory || []).filter((x) => x && typeof x === 'object');
    const ids = new Set(lgCandidates().map((it) => it.id));
    const withLg = (fn) => inv.map((it) => (ids.has(it.id) ? Object.assign({}, it, { lg: fn(it) }) : it));
    return {
      ids, inv, st,
      cur: R.est,
      allMover: compute(st, { inventory: withLg(() => false) }),
      allLg: compute(st, { inventory: withLg((it) => lgEligible(it)) }),
    };
  }
  /* LG 비교는 언제나 ‘실제로 낼 돈(부가세 포함)’ 기준 — 이삿짐센터 시세(부가세 별도일 수 있음)에 부가세를 맞춰 LG 소비자가와 더해요 */
  const payK = (e, k) => (e.pay ? e.pay[k] : e[k]);
  const toPay = (e, v) => (e.vatIncl ? v : v * e.vatMul);
  const tot = (e, k) => payK(e, k) + (e.lgCost ? e.lgCost[k] : 0);
  function lgInfoCard() {
    return el('section', { class: 'card', 'aria-label': 'LG 이전설치가 하는 일' },
      sectionHead('🔌', 'LG 베스트케어 이전설치란?', '1544-7777 · LG전자 홈페이지 · ThinQ 앱'),
      el('div', { class: 'es-lg-cols' },
        el('div',
          el('h3', '✅ LG가 해 주는 것'),
          el('ul',
            el('li', '철거 → 운송 → 재설치를 한 번에 (실제 작업은 LG 물류 협력사인 판토스의 설치 기사)'),
            el('li', '대상: 에어컨, TV, 냉장고, 세탁기, 건조기, 워시타워, 정수기, 빌트인'),
            el('li', 'LG가 직접 운송하니 이삿짐센터는 그 가전을 안 옮겨요 → 견적에서 빠져요'),
            el('li', '2개 이상이면 철거·설치비 10% 할인 (에어컨·정수기·빌트인 제외, 2차 출처)'))),
        el('div',
          el('h3', '❌ LG가 안 하는 것'),
          el('ul',
            el('li', el('b', 'LG 제품만'), ' 돼요 — 삼성 등 다른 브랜드는 그 제조사 서비스나 이삿짐센터로'),
            el('li', '가구·박스·다른 짐은 안 옮겨요 (이삿짐센터는 그대로 필요)'),
            el('li', '사다리차가 필요하면 요금이 따로 붙어요'),
            el('li', '에어컨 배관 연장(m당 1.9만)·실외기 앵글(12~14만)·매립배관 세척(5만)은 별도'),
            el('li', '벽 타공·앵글 설치는 집주인 동의가 필요해요 (월세 → 나갈 때 원상복구)'),
            el('li', '다른 업체가 옮기다 생긴 충격 손상은 무상보증이 안 될 수 있어요 (추정)')))),
      el('p', { class: 'small es-muted mt-8 mb-0' }, '모든 LG 요금은 2차 출처·예전 요금표 기준이에요. 예약 전에 1544-7777에서 2026년 단가로 문자 견적을 받으세요. ', srcLinks(['lgCare', 'lxPrice', 'lgAc', 'lxSvc'])));
  }
  function scenCard(title, e, isCur, sub) {
    const lgc = e.lgCost ? e.lgCost.typical : 0;
    return el('div', { class: 'es-scen-c' + (isCur ? ' is-cur' : '') },
      el('div', { class: 'es-scen-t' }, title, isCur ? el('span', { class: 'chip brand' }, '지금 선택') : null),
      el('div', { class: 'es-scen-big' }, '약 ' + won(tot(e, 'typical'))),
      el('div', { class: 'es-scen-l' }, el('span', '🚚 이삿짐센터'), el('span', won(payK(e, 'typical')))),
      el('div', { class: 'es-scen-l' }, el('span', '🔌 LG 서비스'), el('span', lgc ? won(lgc) : '0원')),
      el('div', { class: 'es-scen-r' }, '범위 ' + won(tot(e, 'low')) + ' ~ ' + won(tot(e, 'high')) + ' · ' + tonsLabel(e.tons) + ' · ' + e.crewLabel),
      sub ? el('div', { class: 'es-scen-r' }, sub) : null);
  }
  /* LG 표시가 실제로 쓰이는지 (LG 표시 + LG 이전설치 가능) — 견적 계산(viaLg)과 같은 규칙 */
  const lgOn = (it) => !!it.lg && lgEligible(it);
  function lgTotalsCard() {
    const items = lgCandidates();
    if (!items.length) {
      return el('section', { class: 'card' }, el('div', { class: 'empty' },
        el('span', { class: 'big', 'aria-hidden': 'true' }, '🧊'),
        el('p', '‘가져감’' + (inpNow().includeUndecided ? '·‘미정’' : '') + '으로 표시된 가전·에어컨이 짐 목록에 없어요.'),
        el('button', { type: 'button', class: 'btn btn-primary', onclick: () => goTab('inventory') }, '짐 목록에서 가전 추가하기 →')));
    }
    const s = lgScenarios();
    const cur = s.cur;
    const nLg = items.filter(lgOn).length;
    const isAllMover = nLg === 0;
    const isAllLg = items.every((it) => lgOn(it) || !lgEligible(it));
    const diff = tot(cur, 'typical') - tot(s.allMover, 'typical');
    const saveMover = payK(s.allMover, 'typical') - payK(cur, 'typical');
    const nBlock = items.filter((it) => !lgEligible(it)).length;
    return el('section', { class: 'card', 'aria-label': '세 가지 방법 합계' },
      sectionHead('⚖️', '세 가지 방법 비교', '이삿짐센터 + LG 합계 (기준가 · 부가세 포함)'),
      el('div', { class: 'es-scen' },
        scenCard('🚚 전부 이삿짐센터', s.allMover, isAllMover, '가전도 이삿짐센터가 옮김 (에어컨은 협력 기사)'),
        isAllMover || isAllLg ? scenCard('🔀 지금 선택 (혼합)', cur, false, '아래에서 품목마다 고르면 바뀌어요') : scenCard('🔀 지금 선택 (혼합)', cur, true, 'LG ' + nLg + '개 · 이삿짐센터 ' + (items.length - nLg) + '개'),
        scenCard('🔌 LG 가능한 가전 전부 LG', s.allLg, isAllLg && !isAllMover, nBlock ? 'LG 불가 가전 ' + nBlock + '개와 가구·박스는 이삿짐센터' : '이삿짐센터는 가구·박스만')),
      el('p', { class: 'small es-muted mt-8 mb-0' }, '🧾 모두 부가세 포함(실제로 낼 돈) 기준이에요. ' + (cur.vatIncl ? '' : '이삿짐센터 시세는 부가세 별도라 ' + r1(cur.coef.vat_pct) + '%를 더했고, ') + 'LG 요금은 소비자가(부가세 포함)예요.'),
      el('p', { class: 'small mt-12 mb-0' }, nLg
        ? '지금 선택하면 이삿짐센터 비용이 약 ' + won(Math.max(0, saveMover)) + ' 줄고 LG에 약 ' + josa(won(cur.lgCost ? cur.lgCost.typical : 0), '이/가') + ' 들어, 전부 이삿짐센터보다 합계가 ' + (diff >= 0 ? '약 ' + won(diff) + ' 더 들어요.' : '약 ' + won(-diff) + ' 덜 들어요.')
        : '지금은 가전도 모두 이삿짐센터가 옮기는 것으로 계산 중이에요. 아래에서 품목마다 ‘LG 서비스’를 고르면 합계가 바뀌어요.'));
  }
  function lgItemsCard() {
    const items = lgCandidates();
    if (!items.length) return null;
    const st = stGet();
    const inv = (st.inventory || []).filter((x) => x && typeof x === 'object');
    const c = R.est.coef;
    const inp = R.est.inputs;
    const rows = items.map((it) => {
      const kind = lgKind(it);
      /* 이삿짐센터가 이 가전을 옮길 때 더 드는 돈 = (이 가전을 이삿짐센터가 옮김) − (이 가전이 없음).
         LG가 옮기면 이삿짐센터 짐에서 빠지는 것과 같아서, LG 불가 가전도 같은 식으로 실제 몫을 보여 줘요 */
      const a = compute(st, { inventory: inv.map((x) => (x.id === it.id ? Object.assign({}, x, { lg: false }) : x)) });
      const b = compute(st, { inventory: inv.filter((x) => x.id !== it.id) });
      const moverDelta = Math.max(0, payK(a, 'typical') - payK(b, 'typical')); // 부가세 포함 (LG 소비자가와 같은 기준)
      const lgc = lgItemCost(it, c, inp);
      const brand = brandOf(it);
      const isWin = kind === 'ac_window';
      const blockLg = !lgEligible(it);
      const onLg = lgOn(it);
      const furn = FURN_WITH.test(nm(it)) ? (nm(it).match(FURN_WITH) || [])[1] : null;
      const parts = [];
      if (a.counts.acN !== b.counts.acN) parts.push('에어컨 이전설치');
      if (a.counts.fridges !== b.counts.fridges) parts.push('대형 냉장고 추가비');
      if (a.tons !== b.tons) parts.push('차량 ' + tonsLabel(b.tons) + '→' + tonsLabel(a.tons));
      if (!parts.length) parts.push('짐량 안에 포함 (차량 등급 변화 없음)');
      const segBtn = (v, label) => el('button', {
        type: 'button', class: 'es-seg-b' + (onLg === v ? ' is-on' : ''), 'aria-pressed': String(onLg === v), 'data-fk': 'lg-' + it.id + '-' + (v ? 'lg' : 'mv'),
        disabled: v && blockLg ? true : null,
        title: v && blockLg ? (isWin ? '창문형 에어컨은 직접 떼고 다는 제품이라 LG 이전설치가 필요 없어요' : '다른 브랜드로 보여요 — LG 베스트케어 이전설치는 LG 제품만 돼요. LG 제품이면 이름을 고치세요') : null,
        onclick: () => {
          if (v && blockLg) { toast(isWin ? '창문형 에어컨은 LG 이전설치가 필요 없어요.' : '다른 브랜드 제품은 LG 이전설치를 맡길 수 없어요. LG 제품이면 이름을 고쳐 주세요.'); return; }
          // LG 불가인데 남아 있던 LG 표시도 ‘이삿짐센터’를 누르면 꺼요
          if (!!it.lg !== v) MV.inv.update(it.id, { lg: v }, (v ? 'LG 서비스로 옮김: ' : '이삿짐센터로 옮김: ') + nm(it));
        },
      }, label);
      return el('div', { class: 'es-lgi' + (onLg ? ' is-lg' : '') },
        el('div', { class: 'es-ico', 'aria-hidden': 'true' }, MV.inv.cat(it.cat).icon),
        el('div',
          el('div', { class: 'es-lgi-name' }, el('button', { type: 'button', class: 'es-namebtn es-lgi-nb', 'data-fk': 'lgname-' + it.id, title: '눌러서 이름·브랜드 고치기', onclick: () => MV.inv.editor(it.id) }, nm(it) || '이름 없는 가전'),
            qtyOf(it) > 1 ? el('span', { class: 'chip' }, qtyOf(it) + '대') : null,
            brand === 'lg' ? el('span', { class: 'chip good' }, 'LG 제품') : brand === 'other' ? el('span', { class: 'chip bad', title: 'LG 이전설치는 LG 제품만 가능' }, '다른 브랜드 — LG 불가') : el('span', { class: 'chip warn', title: '이름에 브랜드(예: LG 디오스)를 적거나 제품 링크를 넣어 두세요' }, '브랜드 확인 필요'),
            it.assumed ? el('span', { class: 'chip warn' }, '규격 추정') : null,
            it.fate !== 'move' ? el('span', { class: 'chip', title: '처리가 ‘미정’이지만 ‘미정 짐도 가져가는 것으로 계산’이 켜져 있어 견적에 넣었어요' }, '처리 미정') : null,
            furn ? el('span', { class: 'chip warn', title: 'LG는 가구를 옮기지 않아요. 짐 목록에서 ‘' + furn + '’을 따로 나눠 적으면 이삿짐센터 짐량에 들어가요' }, '가구(' + furn + ') 포함 — 따로 나누세요') : null,
            it.lg && blockLg ? lgFixChip(it) : null),
          el('div', { class: 'es-lgi-meta' }, LG_KIND[kind].label + ' · ' + dimTxt(it) + 'cm · ' + roomTxt(it))),
        el('div', { class: 'es-seg', role: 'group', 'aria-label': nm(it) + ' 누가 옮길지' }, segBtn(true, '🔌 LG 서비스'), segBtn(false, '🚚 이삿짐센터')),
        el('div', { class: 'es-lgi-costs' },
          el('div', { class: 'es-lgi-cost' + (onLg ? ' is-on' : '') }, el('small', 'LG 서비스'),
            isWin ? el('b', '0원') : blockLg ? el('b', 'LG 불가') : el('b', '약 ' + won(lgc.typical)),
            el('small', isWin ? '직접 떼고 달기' : blockLg ? 'LG 제품만 맡길 수 있어요' : won(lgc.low) + ' ~ ' + won(lgc.high) + (lgc.pipe ? ' · 배관 ' + r1(inp.acPipeM) + 'm 포함' : '') + ' · 운송비 ' + josa(won(c.lg_transport), '은/는') + ' 1건당 합계에 한 번')),
          el('div', { class: 'es-lgi-cost' + (!onLg ? ' is-on' : '') }, el('small', '이삿짐센터 (부가세 포함)'),
            el('b', moverDelta ? '+' + won(moverDelta) : '추가 0원'),
            el('small', parts.join(' · ')))),
        brand === 'other' && !isWin ? el('div', { class: 'es-lgi-does es-lgi-bad' }, '⛔ 이름이나 링크에 다른 브랜드가 있어 LG 서비스를 고를 수 없어요' + (it.lg ? ' — 견적은 이삿짐센터가 옮기는 것으로 계산했어요' : '') + '. LG 제품이라면 이름을 눌러 고치세요.') : null,
        el('div', { class: 'es-lgi-does' }, '🔧 ' + LG_DOES[kind]));
    });
    return el('section', { class: 'card', 'aria-label': '가전별 선택' },
      sectionHead('🧊', '가전별로 고르기', '고르면 짐 목록의 ‘LG’ 표시와 견적이 함께 바뀌어요'),
      el('div', { class: 'es-lgitems' }, rows),
      R.est.lgCost && R.est.lgCost.discount.typical > 0 ? el('p', { class: 'small es-muted mt-8 mb-0' }, '🔖 LG 2개 이상 할인 ' + R.est.lgCost.discount.pct + '% (에어컨 제외): 약 −' + won(R.est.lgCost.discount.typical) + ' 합계에 반영') : null);
  }

  /* LG 판단 기준 — 가전 가이드·체크리스트와 같아요: LG ‘냉장고 + 건조기’ 견적(운송비 포함)이 약 30만원 이하 + 일정 + 집주인 동의 → LG.
     에어컨·TV는 이 기준에 넣지 않고, 에어컨은 대당 LG 요금과 이삿짐센터(협력 기사) 요금을 따로 비교해요 */
  const LG_RULE_MAX = 300000;
  const LG_CORE = ['fridge', 'dryer', 'washer'];
  function lgCoreCost(lgc) {
    if (!lgc || !Array.isArray(lgc.rows)) return null;
    const rows = lgc.rows.filter((r) => LG_CORE.includes(r.kind));
    if (!rows.length) return null;
    const dp = ((lgc.discount && lgc.discount.pct) || 0) / 100; // 2개 이상 할인은 에어컨을 뺀 가전에만 붙어요
    const t = (k) => Math.round(sum(rows, (r) => r[k]) * (1 - dp) + ((lgc.transport && lgc.transport[k]) || 0));
    return { low: t('low'), typical: t('typical'), high: t('high'), kinds: Array.from(new Set(rows.map((r) => r.kind))) };
  }
  const coreLabel = (kinds) => {
    const k = kinds || [];
    const parts = ['fridge', 'dryer', 'washer'].filter((x) => k.includes(x)).map((x) => LG_KIND[x].label);
    return parts.length >= 2 ? parts.join(' + ') : '냉장고 + 건조기';
  };
  /* 에어컨 대당 비교 (부가세 포함, 배관 같은 길이): LG 이전설치+배관 · 이삿짐센터 협력 기사 설치+가스+배관 (출장비는 방문 1회 따로) */
  function acCompare(items, est) {
    const c = est.coef;
    const inp = est.inputs;
    const pipeM = Math.max(0, num(inp.acPipeM, 0));
    return items.filter((it) => isAircon(it) && lgEligible(it)).map((it) => {
      const kind = lgKind(it);
      const t = kind === 'ac_wall' ? 'wall' : kind === 'ac_2in1' ? '2in1' : 'stand';
      const lgU = c['lg_ac_' + t] + pipeM * c.lg_ac_pipe_per_m;
      const mvU = (c['ac_' + t] + (inp.acGas ? c['ac_gas_' + t] : 0) + pipeM * c.ac_pipe_per_m) * est.vatMul;
      return { it, t, q: qtyOf(it), lgU: Math.round(lgU), mvU: Math.round(mvU), on: lgOn(it) };
    });
  }
  function lgRecoCard() {
    const items = lgCandidates();
    if (!items.length) return null;
    const est = R.est;
    const lgc = est.lgCost;
    const checks = Object.assign({ schedule: false, landlord: false, brand: false }, estSt().lgChecks || {});
    const nLg = items.filter(lgOn).length;
    const core = nLg ? lgCoreCost(lgc) : null;
    const coreUnder = !!core && core.typical <= LG_RULE_MAX;
    const cl = coreLabel(core && core.kinds);
    const nonCore = lgc ? Math.max(0, lgc.typical - (core ? core.typical : 0)) : 0;
    const blocked = items.filter((it) => it.lg && !lgEligible(it));
    const cbx = (key, label) => {
      const x = el('input', { type: 'checkbox', checked: !!checks[key], 'data-fk': 'lgchk-' + key });
      x.addEventListener('change', () => MV.store.update((st) => { const e = ensureEst(st); e.lgChecks = Object.assign({}, e.lgChecks, { [key]: x.checked }); }));
      return el('label', { class: 'check' }, x, el('span', label));
    };
    const condsOk = nLg > 0 && (!core || coreUnder) && checks.schedule && checks.landlord && checks.brand && !blocked.length;
    let savingTxt = '리서치: 에어컨을 뺀 가전만 LG로 먼저 옮기면 차량 등급이 잘 안 바뀌어 이사비는 0~20만원 정도만 줄어요. ';
    if (nLg) {
      const st = stGet();
      const ids = new Set(items.map((it) => it.id));
      const allMover = compute(st, { inventory: (st.inventory || []).filter((x) => x && typeof x === 'object').map((it) => (ids.has(it.id) ? Object.assign({}, it, { lg: false }) : it)) });
      const save = Math.max(0, payK(allMover, 'typical') - payK(est, 'typical'));
      const acPart = Math.max(0, toPay(est, allMover.parts.aircon - est.parts.aircon));
      savingTxt = '이 짐 목록이면 지금 선택으로 이삿짐센터 비용이 부가세 포함 약 ' + won(save) + ' 줄어요' + (acPart > 0 ? ' (그중 에어컨 이전설치 몫 약 ' + won(acPart) + ')' : '') +
        (allMover.tons !== est.tons ? ', 차량도 ' + tonsLabel(allMover.tons) + ' → ' + josa(tonsLabel(est.tons), '으로/로') + ' ' + (est.tons < allMover.tons ? '내려가요' : '바뀌어요') + '. ' : '. ') +
        '리서치는 에어컨을 뺀 가전만 따지면 0~20만원 정도라고 봤어요. ';
    }
    let verdict;
    if (blocked.length) {
      const last = nm(blocked[blocked.length - 1]);
      verdict = el('div',
        el('p', { style: { color: 'var(--bad)' } }, el('b', '⚠ ' + blocked.map(nm).join(', ')), josa(last, '은/는').slice(last.length) + ' ' + (blocked.every((it) => lgKind(it) === 'ac_window') ? '창문형 에어컨이라 LG 이전설치가 필요 없어요' : blocked.some((it) => lgKind(it) === 'ac_window') ? '다른 브랜드이거나 창문형이라 LG 이전설치를 맡길 수 없어요' : '다른 브랜드로 보여 LG 이전설치를 맡길 수 없어요') + '. 지금은 이삿짐센터가 옮기는 것으로 계산했어요 — 짐 목록의 LG 표시도 이삿짐센터로 바꾸세요.'),
        el('div', { class: 'row es-reco-fix' }, el('button', { type: 'button', class: 'btn btn-sm btn-primary', 'data-fk': 'lgfix-reco', onclick: () => switchToMover(blocked.map((it) => it.id)) }, '🚚 ' + blocked.length + '개 이삿짐센터로 바꾸기')));
    } else if (!nLg) verdict = el('p', '지금은 모두 이삿짐센터로 계산 중이에요. 냉장고·건조기부터 LG 견적(1544-7777)을 받아 30만원 기준과 비교해 보세요. 에어컨은 아래에서 대당 요금을 따로 비교해요.');
    else if (condsOk) verdict = el('p', el('b', '✅ LG 이용을 권해요.'), ' 조건을 모두 채웠어요. 이삿짐센터 계약서에 ‘LG가 옮기는 가전(목록)은 제외’ 특약을 넣으세요.');
    else if (core && !coreUnder) verdict = el('p', el('b', 'LG ' + cl + ' 견적이 약 ' + josa(won(core.typical), '으로/로') + ' 30만원을 넘어요.'), ' 이삿짐센터 일괄(가전 특약)도 같이 비교해 보세요. 에어컨은 아래에서 따로 정해요.');
    else verdict = el('p', el('b', '조건 확인 중이에요.'), ' 아래 항목을 모두 확인하면 LG를 쓰고, 하나라도 안 되면 이삿짐센터에 일괄로 맡기세요.');
    const acs = acCompare(items, est);
    const acBlock = acs.length ? el('div', { class: 'es-acmp' },
      el('div', { class: 'es-acmp-h' }, el('b', '❄️ 에어컨은 따로 비교해요'), el('span', { class: 'small es-muted' }, ' 30만원 기준에 넣지 않아요 · 대당 요금, 부가세 포함, 배관 ' + r1(Math.max(0, num(est.inputs.acPipeM, 0))) + 'm 포함')),
      el('ul', { class: 'es-acmp-list' }, acs.map((r) => {
        const d = r.lgU - r.mvU;
        return el('li',
          el('span', { class: 'es-acmp-n' }, nm(r.it) + (r.q > 1 ? ' (' + r.q + '대)' : ''), r.on ? el('span', { class: 'chip kid' }, '지금 LG') : el('span', { class: 'chip' }, '지금 이삿짐센터')),
          el('span', { class: 'es-acmp-v' }, '🔌 LG 약 ' + won(r.lgU)),
          el('span', { class: 'es-acmp-v' }, '🚚 이삿짐센터 약 ' + won(r.mvU)),
          el('span', { class: 'chip ' + (Math.abs(d) < 10000 ? '' : 'good') }, Math.abs(d) < 10000 ? '비슷해요' : (d > 0 ? '이삿짐센터가 대당 약 ' + won(d) + ' 저렴' : 'LG가 대당 약 ' + won(-d) + ' 저렴')));
      })),
      el('p', { class: 'small es-muted mb-0' }, '이삿짐센터 쪽은 협력 기사 공시가(설치' + (est.inputs.acGas ? '+가스' : '') + '+배관)이고, 출장비(방문 1회) ' + josa(won(est.coef.ac_trip), '이/가') + ' 따로 붙어요. LG는 냉매 회수부터 재설치까지 책임이 한 곳이에요. 어느 쪽이든 에어컨은 한 곳으로 책임을 모으고, 늦어도 10/20(화)까지 정하세요.')) : null;
    return el('section', { class: 'card es-reco tint-kid', 'aria-label': '추천' },
      sectionHead('🧭', '어떻게 할까요?'),
      verdict,
      el('p', { class: 'small' }, savingTxt, 'LG 사전 이전은 ‘비용 절감’보다 ‘가전 파손 위험 분리’ 목적으로 보세요 (지난번 세탁기 고장 경험). 정수기형 냉장고·히트펌프 건조기·에어컨·벽걸이 TV는 전문기사에게 맡길 가치가 커요.'),
      el('ul', { class: 'es-conds' },
        el('li', { class: !core ? 'is-no' : coreUnder ? 'is-ok' : 'is-bad' }, el('span', { class: 'es-cmark', 'aria-hidden': 'true' }, !core ? '·' : coreUnder ? '✓' : '✕'),
          el('span', 'LG ' + cl + ' 견적 약 30만원 이하 (운송비 포함) — 지금 ' + (core ? '약 ' + won(core.typical) + ' (' + won(core.low) + '~' + won(core.high) + ')' : 'LG로 고른 냉장고·건조기 없음'))),
        nonCore > 0 ? el('li', { class: 'is-no' }, el('span', { class: 'es-cmark', 'aria-hidden': 'true' }, '·'),
          el('span', '에어컨·TV는 이 기준에 넣지 않아요 — LG로 고른 에어컨·TV 약 ' + won(nonCore) + ' (아래에서 따로 비교)')) : null,
        el('li', { class: 'es-cond-cb' }, cbx('schedule', '11/2 또는 11/3에 LG 일정이 된다 (11/4 설치 대안 포함)')),
        el('li', { class: 'es-cond-cb' }, cbx('landlord', '집주인(C) 동의를 문자로 받았다 (11/2 선반입 시)')),
        el('li', { class: 'es-cond-cb' + (blocked.length ? ' is-bad' : '') }, cbx('brand', '옮길 가전이 모두 LG 제품인지 명판으로 확인했다'))),
      acBlock,
      el('p', { class: 'small es-muted mt-8 mb-0' }, '판단 기준은 가전 가이드와 같아요: LG 냉장고 + 건조기 견적(운송비 포함) 약 30만원 이하 + 11/2(또는 11/3 오후) 일정 + 집주인(C) 동의 → LG, 하나라도 안 되면 이삿짐센터 일괄(가전 특약). 에어컨은 대당 요금과 책임을 따로 따져 한 곳에 맡겨요. ',
        el('a', { href: '#/guide/appliance/lg' }, '가전이사 가이드 →')));
  }
  function lgCaveatsCard() {
    return el('section', { class: 'card tint-warn es-caveats', 'aria-label': '11월 2일 선이동 주의' },
      sectionHead('📌', '11/2(월) 가전 선이동 주의사항'),
      el('ul',
        el('li', el('b', '잔금 전 임시 반입이에요.'), ' 집주인 C의 동의를 중개사를 통해 문자·카톡으로 받아 남기고, 현 거주자 퇴거와 도배·장판 수리 일정을 먼저 확인하세요.'),
        el('li', el('b', '양쪽 관리사무소에 11/2 엘리베이터를 예약'), '하고, 새 집 전기를 쓸 수 있는지 확인하세요. 반입 전 실내 사진·영상을 찍어 두세요.'),
        el('li', el('b', '11/2 밤엔 지금 집에 냉장고가 없어요.'), ' 아이스박스·아이스팩을 준비하고 11/1~11/2 식단을 줄이세요.'),
        el('li', '가전을 먼저 들여놓는다고 대항력(입주+전입신고)이 생기지 않아요. 11/3 잔금·전입신고는 따로 챙기세요.'),
        el('li', el('b', '플랜B 판단 기한 10/23(금):'), ' 동의를 못 받으면 ① 11/3 오전 철거 → 잔금 뒤 오후 설치, 또는 ② 11/3 이삿짐센터 운반 → 11/4 LG 설치로 바꾸세요.'),
        el('li', '이삿짐센터 계약서에 ‘LG가 11/2 옮기는 가전(목록)은 제외, LG 일정이 취소되면 ○일까지 알리면 ○원에 포함’ 특약을 넣으세요.'),
        el('li', 'LG 예약 때 문자 견적, 운송비가 제품별인지 건별인지, 10% 할인 적용, 파손 책임, 설치 후 하자 보증 기간을 물어보세요.')),
      el('p', { class: 'small es-muted mt-8 mb-0' }, srcLinks(['lgCare', 'lgRelease'])));
  }
  function renderLg(body) {
    body.appendChild(lgInfoCard());
    body.appendChild(region(lgTotalsCard, 'lgtot'));
    body.appendChild(region(lgItemsCard, 'lgitems'));
    body.appendChild(region(lgRecoCard, 'lgreco'));
    body.appendChild(lgCaveatsCard());
  }

  /* ======================= 등록 ======================= */
  const TAB_RENDER = { inventory: renderInventory, estimate: renderEstimate, quotes: renderQuotes, lg: renderLg };
  function render(root, params, ctx) {
    const tabId = TABS.some((t) => t.id === params[0]) ? params[0] : 'inventory';
    if (params[0] !== tabId) { try { history.replaceState(null, '', '#/stuff/' + tabId); } catch (e) { /* 무시 */ } }
    MV.store.ensure('estimate', defaults);
    R = { root, tab: tabId, regions: [], updaters: [], est: null, raw: null, pending: false, dirty: false };
    const myR = R;
    recompute();
    root.appendChild(headEl());
    const tabs = tabsEl(tabId);
    root.appendChild(tabs);
    const body = el('div', { class: 'es-body' });
    root.appendChild(body);
    try { TAB_RENDER[tabId](body); } catch (e) {
      console.error('[estimate]', e);
      body.appendChild(el('div', { class: 'card tint-bad es-err' }, el('h2', '이 화면을 그리다 문제가 생겼어요'), el('pre', { class: 'small' }, String((e && e.stack) || e))));
    }
    ctx.subscribe((e) => { if (R !== myR) return; if (e && e.reset) return; requestRefresh(); });
    document.addEventListener('pointerdown', onPtrDown, true);
    document.addEventListener('pointerup', onPtrUp, true);
    document.addEventListener('pointercancel', onPtrUp, true);
    document.addEventListener('click', onClickCap, true);
    document.addEventListener('change', onChangeCap, true);
    root.addEventListener('focusout', onFocusOut);
    ime.el = null;
    root.addEventListener('compositionstart', onCompStart, true);
    root.addEventListener('compositionend', onCompEnd, true);
    let ro = null;
    if (tabId === 'inventory' && window.ResizeObserver) {
      ro = new ResizeObserver(() => { if (R === myR && R.tableMode !== undefined && tableMode() !== R.tableMode) refreshNamed(['invlist']); });
      ro.observe(root);
    }
    ctx.onCleanup(() => {
      /* 다른 탭에서 저장하면 core 가 {reset:true} 로 화면 전체를 다시 그려요(app.js). 그때 입력 중이던 칸과 글자를 기억해 두었다가
         새 화면에서 같은 칸(data-fk)에 되살려, 포커스와 입력이 사라지지 않게 함 */
      try {
        const a = document.activeElement;
        if (R === myR && a && root.contains(a) && isTyping(a) && a.dataset && a.dataset.fk) {
          const composing = ime.el === a;
          mem.restore = composing
            ? { fk: a.dataset.fk, value: ime.value, s: ime.s, e: ime.e, tab: tabId, at: Date.now() }
            : { fk: a.dataset.fk, value: a.value, s: a.selectionStart, e: a.selectionEnd, tab: tabId, at: Date.now() };
        }
      } catch (e) { /* 무시 */ }
      document.removeEventListener('pointerdown', onPtrDown, true);
      document.removeEventListener('pointerup', onPtrUp, true);
      document.removeEventListener('pointercancel', onPtrUp, true);
      document.removeEventListener('click', onClickCap, true);
      document.removeEventListener('change', onChangeCap, true);
      root.removeEventListener('focusout', onFocusOut);
      root.removeEventListener('compositionstart', onCompStart, true);
      root.removeEventListener('compositionend', onCompEnd, true);
      if (ro) ro.disconnect();
      clearTimeout(ptr.timer); clearTimeout(ptr.retry); ptr.retry = null;
      ptr.down = false; ptr.sel = null;
      if (R === myR) R = null;
    });
    // 다른 탭 동기화로 다시 그려졌으면 입력 중이던 칸·글자를 되살림
    const rs = mem.restore;
    mem.restore = null;
    if (rs && rs.tab === tabId && Date.now() - rs.at < 2000) {
      const n = root.querySelector('[data-fk="' + (window.CSS && CSS.escape ? CSS.escape(rs.fk) : rs.fk) + '"]');
      if (n && (n.tagName === 'INPUT' || n.tagName === 'TEXTAREA')) {
        if (n.value !== rs.value) { n.value = rs.value; n.dispatchEvent(new Event('input', { bubbles: true })); }
        try { n.focus({ preventScroll: true }); if (rs.s != null) n.setSelectionRange(rs.s, rs.e); } catch (e) { /* 무시 */ }
      }
    }
    // 탭 버튼을 보이게, 탭을 바꿨으면 탭 위치로
    const act = tabs.querySelector('button.active');
    if (act) tabs.scrollLeft = Math.max(0, act.offsetLeft - 12);
    if (mem.scrollToTabs) {
      mem.scrollToTabs = false;
      requestAnimationFrame(() => {
        const top = tabs.getBoundingClientRect().top + window.scrollY - (parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--topbar-h')) || 56) - 8;
        if (window.scrollY > top) window.scrollTo(0, Math.max(0, top));
      });
    }
  }

  MV.view('stuff', { title: '짐·견적', short: '견적', icon: '🚚', order: 40, render });
})();
