/* ============================================================
   기본 데이터 (PROVISIONAL — 리서치 결과로 교체 예정)
   MV.seed = { version, moveDate, parts[], items[], inventory[] }
   - id 는 고정 문자열. 새 버전에서 version 을 올리면 사용자 기록은 유지한 채
     없는 항목만 추가됩니다 (core.js mergeSeed).
   ============================================================ */
(function () {
  'use strict';
  MV.seed = {
    version: 1,
    moveDate: '2026-11-03',
    parts: [
      { id: 'money', name: '통장업무', emoji: '💰', group: '돈·계약', desc: '11/3 보증금 수령·대출 상환·잔금·복비, 증여세 주의', guide: 'money' },
      { id: 'admin', name: '행정·주소이전', emoji: '🏛️', group: '돈·계약', desc: '전입신고·확정일자·임대차 신고·공과금·학교', guide: 'admin' },
      { id: 'space', name: '사전공간설계', emoji: '📐', group: '공간', desc: '두 집 도면 비교, 가구·가전 배치', guide: 'space' },
      { id: 'previsit', name: '사전방문', emoji: '🔍', group: '공간', desc: '새 집 실측·하자 사진·청소 상태·수리 확인', guide: 'previsit' },
      { id: 'mover', name: '업체소통', emoji: '🚚', group: '업체', desc: '이사업체 선정 → 방문견적 → 계약 → 잔금', guide: 'mover' },
      { id: 'appliance', name: '가전이사', emoji: '🔌', group: '업체', desc: 'LG 서비스센터 이전설치 + 집주인 양해(11/2 선입주)', guide: 'appliance' },
      { id: 'sort-clothes', name: '옷정리', emoji: '👕', group: '짐정리', desc: '붙박이장이 없어지는 만큼 옷 부피 줄이기', guide: 'sort#clothes' },
      { id: 'sort-misc', name: '잡동사니', emoji: '📦', group: '짐정리', desc: '서랍·수납장 속 잡동사니 비우기', guide: 'sort#misc' },
      { id: 'sort-books', name: '책정리', emoji: '📚', group: '짐정리', desc: '판매·기증·보관 분류', guide: 'sort#books' },
      { id: 'sort-toys', name: '장난감정리', emoji: '🧸', group: '짐정리', desc: '아이와 함께 고르고 나누기', guide: 'sort#toys' },
      { id: 'sort-utility', name: '다용도실정리', emoji: '🧺', group: '짐정리', desc: '세제·공구·계절용품 정리', guide: 'sort#utility' },
      { id: 'discard', name: '버리기', emoji: '🗑️', group: '버리고 사기', desc: '고장난 세탁기, 대형폐기물, 헌옷·책 처분', guide: 'discard' },
      { id: 'buy', name: '가구구매', emoji: '🛒', group: '버리고 사기', desc: '옷장 추가, 통돌이 세탁기 등 새로 살 것', guide: 'buy' },
      { id: 'moveday', name: '이사당일', emoji: '📅', group: 'D-day', desc: '11/2 가전 선이동 · 11/3 시간표', guide: 'moveday' },
    ],
    items: [
      { id: 'money-01', partId: 'money', title: '우리은행에 전세대출 상환 절차 확인 (질권·채권양도 여부)', detail: '임대인이 대출분을 은행에 직접 갚아야 하는지 확인', due: '2026-10-10', priority: 'high', owner: '나' },
      { id: 'money-02', partId: 'money', title: '이체한도 상향 (1일 3억 이상)', detail: 'OTP 기준 한도 확인', due: '2026-10-24', priority: 'high', owner: '나' },
      { id: 'mover-01', partId: 'mover', title: '이사업체 후보 3곳 방문견적 예약', detail: '', due: '2026-10-11', priority: 'high', owner: '함께' },
      { id: 'appliance-01', partId: 'appliance', title: 'LG전자 서비스 이전설치 문의', detail: '1544-7777', due: '2026-10-12', priority: 'high', owner: '나' },
      { id: 'sort-clothes-01', partId: 'sort-clothes', title: '현재 옷 부피 재기 (행거 길이·서랍 수)', detail: '', due: '2026-10-11', priority: 'mid', owner: '아내' },
      { id: 'discard-01', partId: 'discard', title: '고장난 세탁기 폐가전 무상수거 예약', detail: '1599-0903', due: '2026-10-20', priority: 'mid', owner: '나' },
      { id: 'buy-01', partId: 'buy', title: '옷장 규격·예산 결정', detail: '', due: '2026-10-20', priority: 'mid', owner: '함께' },
      { id: 'previsit-01', partId: 'previsit', title: '새 집 사전방문 일정 잡기 (중개사 통해)', detail: '', due: '2026-10-10', priority: 'high', owner: '나' },
      { id: 'moveday-01', partId: 'moveday', title: '11/3 오전 보증금 수령 확인', detail: '', due: '2026-11-03', priority: 'high', owner: '나' },
      { id: 'admin-01', partId: 'admin', title: '전입신고 + 확정일자 (11/3 당일)', detail: '', due: '2026-11-03', priority: 'high', owner: '나' },
      { id: 'space-01', partId: 'space', title: '두 집 도면 비교 확인', detail: '', due: '2026-10-12', priority: 'mid', owner: '함께' },
    ],
    inventory: [
      { id: 'inv-fridge', name: '냉장고 (양문형)', cat: 'appliance', tag: 'fridge', fate: 'move', qty: 1, w: 91, d: 92, h: 179, room: '주방', roomNew: '주방', lg: true, assumed: true },
      { id: 'inv-washer-old', name: '고장난 세탁기', cat: 'appliance', tag: 'washer', fate: 'discard', qty: 1, w: 60, d: 65, h: 85, room: '다용도실', assumed: true },
      { id: 'inv-dryer', name: '건조기', cat: 'appliance', tag: 'dryer', fate: 'move', qty: 1, w: 70, d: 76, h: 99, room: '다용도실', roomNew: '다용도실', lg: true, assumed: true },
      { id: 'inv-washer-new', name: '통돌이 세탁기 (구매 예정)', cat: 'appliance', tag: 'washer', fate: 'buy', qty: 1, w: 70, d: 72, h: 105, roomNew: '다용도실', assumed: true },
      { id: 'inv-wardrobe-new', name: '옷장 (구매 예정)', cat: 'storage', tag: 'wardrobe', fate: 'buy', qty: 1, w: 120, d: 60, h: 216, roomNew: '안방', assumed: true },
      { id: 'inv-bed-master', name: '퀸 침대', cat: 'bed', tag: 'bed', fate: 'move', qty: 1, w: 160, d: 210, h: 40, room: '안방', roomNew: '안방', assumed: true },
      { id: 'inv-sofa', name: '3인 소파', cat: 'sofa', tag: 'sofa', fate: 'move', qty: 1, w: 210, d: 90, h: 85, room: '거실', roomNew: '거실', assumed: true },
      { id: 'inv-ac-stand', name: '스탠드 에어컨', cat: 'aircon', tag: 'aircon', ac: 'stand', fate: 'move', qty: 1, w: 50, d: 40, h: 180, room: '거실', roomNew: '거실', lg: true, assumed: true },
    ],
  };
})();
