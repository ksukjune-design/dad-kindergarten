/* ============================================================
   도면 데이터 — 두 집 추정 도면 + 가구·가전 규격 프리셋 + 두 집 비교
   (근거: 도면 리서치 검증본. 실제 평면도 이미지는 구하지 못해 모두 '추정'입니다)

   MV.plans = { old: Plan, new: Plan }
   Plan = {
     id, name, short, floor, exclusive_m2,
     width, depth,                // cm, 원점 좌상단, x→오른쪽, y→아래 (벽 중심선 기준)
     front: 'top'|'bottom'|'left'|'right',   // 남향 창/전면 발코니 쪽
     rooms:    [{ id, name, kind, x, y, w, h, note }]
               // kind: living|kitchen|bedroom|bath|entrance|balcony|utility|dressroom|storage|hall|other
               // 방끼리 겹치지 않음. 다용도실은 kind 'utility' (세탁기·건조기 점검 대상)
     doors:    [{ x, y, width, orientation: 'h'|'v', swing: 'up'|'down'|'left'|'right', hinge: 'start'|'end', room, note }]
               // orientation h: 개구부가 y 위치의 가로벽에서 x..x+width / v: x 위치의 세로벽에서 y..y+width
               // swing: 문짝이 열리며 쓸고 가는 쪽, hinge: 경첩이 개구부의 시작/끝 중 어디
               // room: 문짝이 열려 들어가는 방 id (문이 놓인 벽은 그 방의 가장자리)
     openings: [{ x, y, width, orientation: 'h'|'v', rooms: [id, id], note }]
               // 문짝 없이 트인 곳(주방↔식당, 거실↔식당, 현관↔복도). 좌표 규칙은 doors 와 같음.
               // 문짝·열림 범위가 없으므로 가구 배치를 막지 않음 (화면은 벽을 비워 그리면 됨)
     windows:  [{ x, y, length, orientation: 'h'|'v', note }]   // 방 가장자리 위. 분합문(미닫이 유리문)도 창으로 표시
     fixtures: [{ name, x, y, w, h, kind, note }]
               // kind: sink|bath|toilet|basin|tap|drain|boiler|aircon-port|outdoor-unit|shoe|fridge-spot|other
               // 반드시 어느 한 방 안에 있음. 가로·세로가 모두 30cm 이상이면 배치 때 장애물로 취급됨
               // (그래서 냉장고 자리·수전·배관구는 얇게 표시)
     builtins: [{ name, x, y, w, h, note }]  // 붙박이장 (지금 집에만 있고 새 집에는 없음). fixtures 에 넣지 않음
     confidence: 'high'|'medium'|'low',
     basis: 문자열 (도면을 어떻게 추정했는지),
     sources: [URL 문자열], images: [URL 문자열],
     measureFirst: [문자열] 현장에서 먼저 잴 것, logistics: [문자열] 이사 동선·반입,
     complex: { name, built, households, structure, heating, floors }   // 화면에 글자 그대로 보임
     unit:    { exclusive_m2, supply_m2, rooms, baths, bays, ceiling_cm } // 숫자 (bays·ceiling_cm 은 추정)
   }
   MV.planLabels = { <complex/unit 키>: '한국어 이름' }  — 도면 정보 표에서 키 대신 보여 줄 이름
   MV.catalog = [{ name, cat, tag, w, d, h, ac }]  — 규격 프리셋 (cm, 가로 W × 깊이 D × 높이 H)
               // cat: MV.inv.CATS id (appliance|aircon|bed|storage|table|sofa|shelf|electronics|kids|misc)
               // tag: fridge|kimchi|washer|dryer|styler|dishwasher|aircon|tv|sofa|table|chair|desk|shelf|
               //      drawer|wardrobe|bedding|hanger|vanity|bed|mattress|toybox|shoe|bike|stroller|scooter|
               //      piano|treadmill|purifier|box|kitchen
               // ac: 에어컨일 때만 'wall'|'stand'|'2in1'|'window'
               // 세탁기 이름에는 '통돌이' 또는 '드럼'을 넣음 (다용도실 점검이 종류를 이름으로 구분)
   MV.planCompare = [{ title, detail, level: 'info'|'warn'|'bad'|'good' }] — 두 집 차이 요약
   ============================================================ */
(function () {
  'use strict';

  MV.plans = {
    /* ---------------- 지금 집: 등촌우성 2층 (78A 타입 추정, 2베이 가정) ---------------- */
    old: {
      id: 'old', name: '지금 집 · 등촌우성 (2층)', short: '지금 집', floor: 2, exclusive_m2: 66.9,
      width: 740, depth: 1165, front: 'bottom',
      rooms: [
        { id: 'utility', name: '다용도실', kind: 'utility', x: 260, y: 0, w: 240, h: 130, note: '추정 약 2.4×1.3m. 가스보일러와 세탁 수전이 있을 것으로 추정해요. 건조기가 나갈 길을 확인하세요' },
        { id: 'small2', name: '작은방2', kind: 'bedroom', x: 0, y: 130, w: 260, h: 270, note: '추정 약 2.6×2.7m(7.0㎡). 북쪽 창' },
        { id: 'kitchen', name: '주방', kind: 'kitchen', x: 260, y: 130, w: 240, h: 270, note: '추정 약 2.4×2.7m. 일자형 싱크대 추정. 식당 쪽은 트여 있어요' },
        { id: 'small1', name: '작은방1', kind: 'bedroom', x: 500, y: 130, w: 240, h: 270, note: '추정 약 2.4×2.7m(6.5㎡). 북쪽 창' },
        { id: 'bath', name: '욕실', kind: 'bath', x: 0, y: 400, w: 170, h: 220, note: '추정 약 1.7×2.2m. 욕조형 추정' },
        { id: 'dining', name: '식당·복도', kind: 'hall', x: 170, y: 400, w: 450, h: 220, note: '추정 약 4.5×2.2m. 주방·거실과 트인 공간이고 각 방으로 가는 길이에요' },
        { id: 'entry', name: '현관', kind: 'entrance', x: 620, y: 400, w: 120, h: 220, note: '추정. 계단실 쪽 옆벽에 현관문, 붙박이 신발장' },
        { id: 'master', name: '안방', kind: 'bedroom', x: 0, y: 620, w: 330, h: 415, note: '추정 약 3.3×4.15m(13.7㎡). 서쪽 벽에 붙박이장(약 3.4m 추정) — 새 집엔 없어요' },
        { id: 'living', name: '거실', kind: 'living', x: 330, y: 620, w: 410, h: 415, note: '추정 약 4.1×4.15m(17.0㎡). 전면 발코니와 분합문으로 이어져요' },
        { id: 'balcony', name: '전면 발코니', kind: 'balcony', x: 0, y: 1035, w: 740, h: 130, note: '추정 깊이 약 1.3m(약 9.6㎡). 확장 여부 미확인. 사다리차로 짐을 내보내는 창' },
      ],
      doors: [
        { x: 740, y: 470, width: 90, orientation: 'v', swing: 'left', hinge: 'end', room: 'entry', note: '세대 현관문(계단실 쪽). 그림은 안쪽으로 열리게 그렸지만 실제로는 바깥으로 열리는 경우가 많아요. 유효 폭 실측' },
        { x: 515, y: 400, width: 80, orientation: 'h', swing: 'up', hinge: 'start', room: 'small1', note: '작은방1 문' },
        { x: 175, y: 400, width: 80, orientation: 'h', swing: 'up', hinge: 'end', room: 'small2', note: '작은방2 문' },
        { x: 170, y: 450, width: 70, orientation: 'v', swing: 'left', hinge: 'start', room: 'bath', note: '욕실 문' },
        { x: 235, y: 620, width: 85, orientation: 'h', swing: 'down', hinge: 'end', room: 'master', note: '안방 문' },
        { x: 405, y: 130, width: 75, orientation: 'h', swing: 'up', hinge: 'end', room: 'utility', note: '주방 → 다용도실 문' },
      ],
      openings: [
        { x: 275, y: 400, width: 210, orientation: 'h', rooms: ['kitchen', 'dining'], note: '주방과 식당 사이(문 없음)' },
        { x: 345, y: 620, width: 260, orientation: 'h', rooms: ['living', 'dining'], note: '거실과 식당 사이(트인 구간)' },
        { x: 620, y: 450, width: 150, orientation: 'v', rooms: ['entry', 'dining'], note: '현관 → 복도(중문 없음 추정)' },
      ],
      windows: [
        { x: 270, y: 0, length: 220, orientation: 'h', note: '다용도실 바깥 창' },
        { x: 40, y: 130, length: 180, orientation: 'h', note: '작은방2 북쪽 창' },
        { x: 530, y: 130, length: 180, orientation: 'h', note: '작은방1 북쪽 창' },
        { x: 40, y: 1035, length: 240, orientation: 'h', note: '안방 창(발코니 쪽)' },
        { x: 380, y: 1035, length: 300, orientation: 'h', note: '거실 분합문(미닫이) — 발코니로 나가는 문' },
        { x: 10, y: 1165, length: 720, orientation: 'h', note: '발코니 바깥 창(사다리차 반출 창)' },
      ],
      fixtures: [
        { name: '싱크대', x: 260, y: 140, w: 60, h: 250, kind: 'sink', note: '일자형(개수대·가스레인지) 추정' },
        { name: '욕조', x: 0, y: 545, w: 150, h: 75, kind: 'bath' },
        { name: '변기', x: 10, y: 405, w: 40, h: 65, kind: 'toilet' },
        { name: '세면대', x: 70, y: 400, w: 50, h: 40, kind: 'basin' },
        { name: '보일러(추정)', x: 460, y: 10, w: 40, h: 30, kind: 'boiler', note: '벽걸이 가스보일러 추정(개별난방)' },
        { name: '세탁 수전', x: 275, y: 3, w: 20, h: 12, kind: 'tap', note: '세탁기 자리 추정. 다용도실·전면 발코니·욕실 중 실제 위치 확인' },
        { name: '배수구', x: 305, y: 85, w: 12, h: 12, kind: 'drain', note: '바닥 배수구 추정' },
        { name: '신발장', x: 620, y: 400, w: 120, h: 40, kind: 'shoe', note: '현관 붙박이' },
        { name: '에어컨 배관구', x: 715, y: 1025, w: 20, h: 10, kind: 'aircon-port', note: '거실(추정)' },
        { name: '에어컨 배관구', x: 5, y: 1025, w: 20, h: 10, kind: 'aircon-port', note: '안방(추정)' },
        { name: '실외기 자리', x: 640, y: 1095, w: 95, h: 65, kind: 'outdoor-unit', note: '전면 발코니(추정)' },
      ],
      builtins: [
        { name: '붙박이장(안방)', x: 0, y: 660, w: 60, h: 340, note: '위치·폭 추정: 안방 서쪽 벽 약 3.4m(1자≈30cm로 치면 11자 정도), 깊이 약 60cm. 칸 수·행거봉 길이·선반·서랍 수를 실측하세요. 작은방에도 1~2칸이 더 있을 수 있어요. 새 집엔 붙박이장이 없어요' },
      ],
      confidence: 'low',
      basis: '평면도 이미지를 구하지 못해 면적·연식·구조로 추정한 도면이에요. 1990년대 초 계단식 24평형(78A 타입, 방3·욕실1)에 흔한 2베이 판상형으로 가정했고, 방 크기 합(발코니·다용도실 제외 약 67.0㎡)이 전용 66.9㎡와 맞도록 잡았어요. 문·창·설비·붙박이장 위치도 모두 가정값이라 실측으로 고쳐야 해요. 3베이(전면에 작은방-거실-안방)라면 외곽이 약 9.6×7m로 바뀌어 배치가 크게 달라져요. 78A인지 79B인지도 건축물대장으로 확인이 필요해요.',
      sources: [
        'https://hogangnono.com/apt/11re9',
        'https://kbland.kr/se/c/463',
        'https://www.zigbang.com/home/apt/danjis/4197',
        'https://zippoom.com/%EB%B6%80%EB%8F%99%EC%82%B0/%EC%84%9C%EC%9A%B8-%EA%B0%95%EC%84%9C%EA%B5%AC-%EB%93%B1%EC%B4%8C%EB%8F%99-%EC%9A%B0%EC%84%B1%EC%95%84%ED%8C%8C%ED%8A%B8/zxyfst',
        'https://dapt.kr/apt/AdA084.html',
      ],
      images: [],
      measureFirst: [
        '붙박이장: 칸 수, 총 폭, 높이, 깊이, 행거봉 길이, 선반·서랍 수, 방별 위치 — 새 집 옷장을 얼마나 살지 정하는 가장 중요한 값이에요',
        '진짜 평면 확인: 관리사무소에 평면도를 요청하거나 네이버부동산 앱 단지정보 > 평면도(78A)를 캡처하세요. 정부24 건축물대장(전유부, 무료)으로 면적과 타입(78A/79B)을 대조하세요',
        '베이 수(2베이/3베이)와 우리 집이 건물 끝 세대인지(옆벽 창 유무) — 이 도면 전체가 이 가정에 달려 있어요',
        '가져갈 가구·가전 실측(가로×깊이×높이): 냉장고, 김치냉장고, 건조기, 에어컨, TV, 침대, 소파, 책장, 책상, 장난감 수납장',
        '현관문 유효 폭·높이, 중문 유무, 방문 폭 — 큰 가구와 양문형 냉장고가 나갈 수 있는지',
        '발코니 창이 열리는 폭·높이, 방충망·방범창 떼기, 건물 앞 화단·나무·전선 — 2층에 사다리차를 세울 수 있는지',
        '계단 폭과 계단참 크기, 엘리베이터 안쪽 크기와 문 폭',
        '다용도실 실제 크기, 보일러·세탁 수전 위치(다용도실·전면 발코니·욕실 중 어디인지), 건조기가 나갈 길',
        '방·거실의 벽에서 벽까지 가로×세로, 창 위치·높이, 콘센트 위치',
        '에어컨 배관 위치와 실외기 거치 방식, 떼어 낸 뒤 배관 구멍 마감 상태',
        '원상복구 대비 사진·영상: 벽지, 바닥, 붙박이장, 문짝, 욕실 실리콘, 못 자국',
      ],
      logistics: [
        '2층이라 사다리차는 가장 싼 구간이에요(2~5층 약 15만원 내외, 2025년 전후 시세 — 2026년 견적으로 다시 확인). 계단식이라 계단으로 들어 내리는 것도 가능해요. 계단·엘리베이터로만 내리면 사다리차 1회(약 15만원)를 줄일 수 있는지 업체에 물어보세요',
        '건물 앞 화단·나무·1층 방범창·전선 때문에 사다리를 못 세울 수 있어요. 견적 방문 때 꼭 확인하세요',
        '엘리베이터(계단실마다 1대 추정)는 1992년식이라 작을 수 있어요. 큰 가구는 사다리차나 계단으로 내려요. 사용료·보호재 의무는 관리사무소에 확인하세요(단지마다 0~10만원)',
        '주차: 지하주차장 없이 지상 약 81대(세대당 약 0.6대)뿐이라 트럭(2.5~5톤)과 사다리차 세울 자리가 관건이에요. 관리사무소에 주차 협조(콘 설치·차량 이동 안내)를 미리 요청하세요',
        '관리사무소: 이사 날짜·시간 신고, 11/3 기준 관리비 중간정산, 장기수선충당금 납부확인서 발급(나갈 때 집주인에게 돌려받는 돈 — 부동산을 통해 정리)',
        '11/2(월) LG 가전 선이동을 하면 2층이라 반출은 쉬워요. 그날 밤엔 냉장고가 없으니 음식 보관 계획을 세우세요',
        '고장 난 세탁기는 이사 전에 지금 집에서 폐가전 무상방문수거(1599-0903, https://www.15990903.or.kr)로 처리하세요. 이사철이라 예약이 밀릴 수 있으니 일찍 신청하세요',
        '에어컨: 배관 철거·구멍 마감·실외기 분리를 이사업체나 전문업체에 미리 예약하세요',
        '도시가스 사용 중지·정산, 전기·수도 검침, 인터넷·TV 이전은 11/3 오전 짐 반출 직후로 맞추세요',
        '11/3 순서: 짐 반출 → 관리비·가스·전기·수도 정산 → A(지금 집 집주인)의 3.78억 입금 확인 → 열쇠·비밀번호 넘기기 → 새 집 잔금. 보증금이 들어온 것을 확인하기 전에는 열쇠·비밀번호를 넘기지 마세요',
      ],
      complex: {
        name: '등촌우성 (포털 표기 등촌동 우성)',
        built: '1992년 5월 (2026년 기준 34년차)',
        households: '134세대 (우리 동 기준 · 포털은 2개동 244세대로 표기)',
        structure: '계단식',
        heating: '개별난방 (도시가스 보일러)',
        floors: '최고 14층 (우리 집 2층)',
      },
      unit: { exclusive_m2: 66.9, supply_m2: 78.46, rooms: 3, baths: 1, bays: 2, ceiling_cm: 230 },
    },

    /* ---------------- 새 집: 등촌마을서광 14층 (79A 타입 추정, 2베이 가정) ---------------- */
    new: {
      id: 'new', name: '새 집 · 서광등촌마을 (14층)', short: '새 집', floor: 14, exclusive_m2: 59.67,
      width: 720, depth: 1105, front: 'bottom',
      rooms: [
        { id: 'utility', name: '다용도실', kind: 'utility', x: 240, y: 0, w: 220, h: 140, note: '추정 약 2.2×1.4m(실측 필요). 지역난방이라 보일러는 없을 것으로 보여요. 통돌이+건조기를 나란히 두려면 연속 벽 150cm 이상, 깊이 85~90cm가 필요해요' },
        { id: 'rearbalcony', name: '뒷발코니', kind: 'balcony', x: 460, y: 0, w: 260, h: 140, note: '추정 약 2.6×1.4m. 수납이나 건조기 대안 자리로 쓸 수 있는지(콘센트·배수) 확인' },
        { id: 'small2', name: '작은방2', kind: 'bedroom', x: 0, y: 140, w: 240, h: 280, note: '추정 약 2.4×2.8m(6.7㎡). 북쪽 방이라 결로·곰팡이 확인' },
        { id: 'kitchen', name: '주방', kind: 'kitchen', x: 240, y: 140, w: 230, h: 280, note: '추정 약 2.3×2.8m. 왼쪽 벽에 일자형 싱크대, 오른쪽 벽에 냉장고 자리 — 사이 통로 약 80cm' },
        { id: 'small1', name: '작은방1', kind: 'bedroom', x: 470, y: 140, w: 250, h: 280, note: '추정 약 2.5×2.8m(7.0㎡). 특약의 작은방 벽 도배 일부 수리가 어느 방인지 확인' },
        { id: 'bath', name: '욕실', kind: 'bath', x: 0, y: 420, w: 160, h: 200, note: '추정 약 1.6×2.0m. 욕조형 추정, 창 없음' },
        { id: 'dining', name: '식당·복도', kind: 'hall', x: 160, y: 420, w: 400, h: 200, note: '추정 약 4.0×2.0m. 식탁 자리 겸 통로 — 4인 식탁(140×80) 정도가 알맞아요' },
        { id: 'entry', name: '현관', kind: 'entrance', x: 560, y: 420, w: 160, h: 200, note: '추정 약 1.6×2.0m. 계단실 쪽 옆벽에 현관문, 신발장 있음. 중문은 없을 것으로 추정' },
        { id: 'master', name: '안방', kind: 'bedroom', x: 0, y: 620, w: 330, h: 355, note: '추정 약 3.3×3.55m(11.7㎡). 붙박이장 없음 → 옷장 놓을 벽 길이 실측' },
        { id: 'living', name: '거실', kind: 'living', x: 330, y: 620, w: 390, h: 355, note: '추정 약 3.9×3.55m(13.8㎡), 비확장 기준. 거실 장판 일부는 집주인 수리 특약' },
        { id: 'balcony', name: '전면 발코니', kind: 'balcony', x: 0, y: 975, w: 720, h: 130, note: '추정 깊이 약 1.3m(약 9.4㎡). 확장 여부·수전 확인. 사다리차로 짐을 들이는 창' },
      ],
      doors: [
        { x: 720, y: 470, width: 90, orientation: 'v', swing: 'left', hinge: 'end', room: 'entry', note: '세대 현관문(계단실 쪽, 위치 추정). 그림은 안쪽으로 열리게 그렸지만 실제로는 바깥으로 열리는 경우가 많아요. 폭·높이 실측' },
        { x: 162, y: 420, width: 75, orientation: 'h', swing: 'up', hinge: 'end', room: 'small2', note: '작은방2 문' },
        { x: 480, y: 420, width: 75, orientation: 'h', swing: 'up', hinge: 'start', room: 'small1', note: '작은방1 문' },
        { x: 160, y: 500, width: 70, orientation: 'v', swing: 'left', hinge: 'start', room: 'bath', note: '욕실 문' },
        { x: 200, y: 620, width: 80, orientation: 'h', swing: 'down', hinge: 'end', room: 'master', note: '안방 문' },
        { x: 390, y: 140, width: 70, orientation: 'h', swing: 'up', hinge: 'end', room: 'utility', note: '주방 → 다용도실 문. 안쪽으로 열리면 세탁기·건조기 놓을 벽이 줄어요 — 열리는 방향 확인' },
        { x: 630, y: 140, width: 75, orientation: 'h', swing: 'up', hinge: 'end', room: 'rearbalcony', note: '작은방1 → 뒷발코니 문(추정)' },
        { x: 240, y: 975, width: 80, orientation: 'h', swing: 'down', hinge: 'start', room: 'balcony', note: '안방 → 전면 발코니 문(창호형)' },
      ],
      openings: [
        { x: 300, y: 420, width: 165, orientation: 'h', rooms: ['kitchen', 'dining'], note: '주방과 식당 사이(문 없음)' },
        { x: 340, y: 620, width: 215, orientation: 'h', rooms: ['living', 'dining'], note: '거실과 식당 사이(트인 구간)' },
        { x: 560, y: 470, width: 130, orientation: 'v', rooms: ['entry', 'dining'], note: '현관 → 복도(중문 없음 추정)' },
      ],
      windows: [
        { x: 250, y: 0, length: 200, orientation: 'h', note: '다용도실 바깥 창 — 창틀 높이와 통돌이 뚜껑 열림 높이(약 140~155cm 추정)를 비교하세요' },
        { x: 470, y: 0, length: 240, orientation: 'h', note: '뒷발코니 바깥 창' },
        { x: 40, y: 140, length: 160, orientation: 'h', note: '작은방2 북쪽 창' },
        { x: 285, y: 140, length: 85, orientation: 'h', note: '주방 → 다용도실 쪽 창' },
        { x: 480, y: 140, length: 140, orientation: 'h', note: '작은방1 → 뒷발코니 쪽 창' },
        { x: 20, y: 975, length: 200, orientation: 'h', note: '안방 창(발코니 쪽)' },
        { x: 350, y: 975, length: 350, orientation: 'h', note: '거실 분합문(미닫이) — 발코니로 나가는 문' },
        { x: 10, y: 1105, length: 700, orientation: 'h', note: '발코니 바깥 창(사다리차 반입 창)' },
      ],
      fixtures: [
        { name: '싱크대', x: 240, y: 150, w: 60, h: 260, kind: 'sink', note: '일자형 상하부장, 가스레인지 포함 추정' },
        { name: '냉장고 자리', x: 445, y: 240, w: 25, h: 90, kind: 'fridge-spot', note: '폭 90cm 기준 추정. 폭·깊이·높이와 앞 통로를 실측' },
        { name: '욕조', x: 0, y: 420, w: 160, h: 70, kind: 'bath', note: '추정' },
        { name: '세면대', x: 60, y: 575, w: 50, h: 45, kind: 'basin' },
        { name: '변기', x: 5, y: 550, w: 45, h: 65, kind: 'toilet' },
        { name: '분배기(추정)', x: 240, y: 95, w: 20, h: 40, kind: 'other', note: '지역난방 분배기·온수 계량기. 다용도실 벽 아래, 싱크대 아래, 신발장 아래 중 어디인지 확인' },
        { name: '세탁 수전', x: 255, y: 3, w: 20, h: 12, kind: 'tap', note: '추정 위치. 사전방문 때 사진' },
        { name: '배수구', x: 320, y: 100, w: 15, h: 15, kind: 'drain', note: '다용도실 바닥 배수구 추정' },
        { name: '신발장', x: 570, y: 420, w: 150, h: 40, kind: 'shoe', note: '현관 붙박이' },
        { name: '에어컨 배관구', x: 700, y: 940, w: 20, h: 30, kind: 'aircon-port', note: '거실(추정)' },
        { name: '에어컨 배관구', x: 0, y: 940, w: 20, h: 30, kind: 'aircon-port', note: '안방(추정)' },
        { name: '실외기 자리', x: 630, y: 1060, w: 90, h: 45, kind: 'outdoor-unit', note: '전면 발코니(추정)' },
        { name: '발코니 수전(확인)', x: 5, y: 980, w: 20, h: 20, kind: 'tap', note: '전면 발코니 수전 — 있을 수도 있어요. 확인하세요' },
      ],
      builtins: [],
      confidence: 'low',
      basis: '평면도 이미지를 구하지 못해 면적·연식·구조로 추정한 도면이에요. 1990년대 후반 서울 계단식 24평형(79A 타입 추정, 방3·욕실1)에 흔한 2베이 판상형으로 가정했고, 방 크기 합(발코니·다용도실 제외 약 60.1㎡)이 전용 59.67㎡와 비슷하도록 잡았어요(벽 중심 기준이라 실제 안쪽 치수는 5~10% 작아요). 문·창·설비 위치도 모두 가정값이라 사전방문 때 실측으로 고쳐야 해요. 79A/79B 중 하나가 3베이일 수 있고, 그러면 방 배치가 완전히 달라져요.',
      sources: [
        'https://hogangnono.com/apt/11nb3',
        'https://m.richgo.ai/realty/danji/a8bXfuX',
        'https://www.apartsearcher.ai/apartment/2623',
        'https://dapt.kr/apt/AdA039.html',
        'https://www.lge.co.kr/washing-machines/kx21en-20en',
        'https://www.lge.co.kr/product/dryers/rh18wtwn',
        'https://www.ajd.co.kr/contents/basic-tip/detail/%ED%8F%AC%EC%9E%A5%EC%9D%B4%EC%82%AC_%EC%82%AC%EB%8B%A4%EB%A6%AC%EC%B0%A8_%EB%B9%84%EC%9A%A9_%EC%9A%94%EA%B8%88%ED%91%9C_%ED%95%9C%EB%88%88%EC%97%90_%EB%B3%B4%EA%B8%B0_%EC%89%BD%EA%B2%8C-47059',
      ],
      images: [],
      measureFirst: [
        '실제 평면: 2베이인지 3베이인지, 현관 위치, 방·욕실·주방 배치, 79A/79B 타입(관리사무소·부동산에 확인). 방마다 가로·세로를 재고 사진을 남기세요',
        '다용도실: 안쪽 폭·깊이·천장 높이, 문 폭과 열리는 방향, 분배기·세탁 수전·배수구 위치, 바닥 턱, 콘센트 수·위치, 창틀 높이 → 통돌이+건조기 나란히 가능한지 판정(연속 벽 150~160cm, 깊이 85~90cm, 통돌이 위 바닥에서 약 155cm까지 비어 있기 — 뚜껑 열림 높이는 약 140~155cm 추정이라 살 모델의 사양으로 확인)',
        '안방·작은방: 옷장 놓을 순수 벽 길이(문·창·콘센트·스위치 제외)와 천장고(옷장 높이를 정해요)',
        '냉장고 자리: 폭·깊이·높이, 싱크대와 사이 통로(추정 약 80cm), 김치냉장고 놓을 자리',
        '거실: TV·소파 놓을 벽 길이, 에어컨 배관구(거실·안방) 위치, 실외기 자리와 배수',
        '전면 발코니: 확장 여부, 창이 열리는 폭·높이, 난간 구조(사다리차 반입 가능한지), 수전 유무',
        '엘리베이터 안쪽 크기와 문 폭·높이, 현관문 폭·높이 — 옷장·냉장고·소파가 들어가는지',
        '뒷발코니: 크기, 콘센트·배수 — 건조기 대안 자리로 쓸 수 있는지',
        '장판·벽지 상태(특약 수리 범위: 작은방 벽 도배 일부, 거실 장판 일부), 북쪽 방 결로·곰팡이, 욕실·다용도실 누수 흔적을 사진으로 남기기',
      ],
      logistics: [
        '14층(약 36~38m)은 일반 사다리차로 작업할 수 있는 높이예요. 2025년 공개 요금표 기준 5톤 약 20만~21만원(15층 구간 21만원) — 2026년 11월 실제 견적은 다를 수 있어요',
        '새 집 동 앞 지상에 사다리차를 펼 공간(화단·나무·지상주차·전선)이 있는지 사전방문 때 확인하세요',
        '엘리베이터는 코어당 1대로 추정해요. 안쪽 크기와 문 폭(약 90cm 추정)을 재서 큰 짐이 들어가는지 확인하세요',
        '관리사무소에 이사일 등록, 이사 가능 시간, 같은 라인 다른 이사와 겹치는지 확인하세요. 10/9(금)은 한글날 공휴일이니 10/8까지 연락하세요. 승강기 사용료·보호재 의무·예치금, 11/2(가전 선반입)와 11/3 이틀을 쓰면 두 번 내는지도 물어보세요',
        '관리사무소 02-2668-7449 (검색 결과 기준 — 통화해서 맞는지 확인)',
        '지하주차장은 높이 제한 때문에 트럭이 못 들어갈 가능성이 커요. 동 앞 지상에 정차 공간을 잡고 주차 차량 이동 협조를 요청하세요(단지 주차 455대, 세대당 약 1.05대)',
        '지역난방이라 보일러 개통은 필요 없을 가능성이 커요. 입주일 기준 난방·온수 검침을 관리사무소에 요청하고, 가스레인지를 쓰면 취사용 도시가스 개통을 예약하세요',
        '11/2 가전 선반입: 현 거주자 퇴거 시점과 출입 방법을 부동산을 통해 C(새 집 집주인)에게 확인하고, 동의는 문자로 남기세요. 들이기 전에 집 상태 사진을 찍으세요',
        '11/3 짐 내리기는 잔금을 보내고 열쇠를 받은 뒤(13시 전후)로 업체와 맞추세요',
        '새로 살 통돌이·옷장은 사전방문 실측 뒤에 주문하고, 배송은 짐 반입이 끝난 뒤(통돌이는 11/4~11/6 무렵)로 잡으세요',
      ],
      complex: {
        name: '등촌마을서광 (서광등촌마을)',
        built: '1999년 4월 입주 (2026년 기준 28년차)',
        households: '430세대 · 6개동',
        structure: '계단식',
        heating: '지역난방(열병합) — 세대 안 보일러 없음, 가스는 취사용',
        floors: '최고 19층 (우리 집 14층)',
      },
      unit: { exclusive_m2: 59.67, supply_m2: 79, rooms: 3, baths: 1, bays: 2, ceiling_cm: 230 },
    },
  };

  /* 도면 정보 표에서 complex/unit 키 대신 보여 줄 이름 */
  MV.planLabels = {
    name: '단지', built: '준공', households: '세대수', structure: '구조', heating: '난방', floors: '층수',
    exclusive_m2: '전용면적(㎡)', supply_m2: '공급면적(㎡)', rooms: '방', baths: '욕실', bays: '베이(추정)', ceiling_cm: '천장고(cm, 추정)',
  };

  /* ---------------- 규격 프리셋 (흔한 제품 기준 근사값, cm) ---------------- */
  MV.catalog = [
    // 냉장고
    { name: '양문형 냉장고', cat: 'appliance', tag: 'fridge', w: 91, d: 92, h: 179 },
    { name: '4도어 냉장고', cat: 'appliance', tag: 'fridge', w: 91, d: 93, h: 186 },
    { name: '일반 냉장고 (2도어)', cat: 'appliance', tag: 'fridge', w: 60, d: 68, h: 170 },
    { name: '김치냉장고 스탠드형', cat: 'appliance', tag: 'kimchi', w: 70, d: 80, h: 185 },
    { name: '김치냉장고 뚜껑형', cat: 'appliance', tag: 'kimchi', w: 94, d: 66, h: 86 },
    // 세탁·건조·의류
    { name: '통돌이 세탁기 16kg', cat: 'appliance', tag: 'washer', w: 63, d: 66, h: 102 },
    { name: '통돌이 세탁기 21kg', cat: 'appliance', tag: 'washer', w: 69, d: 72, h: 109 },
    { name: '통돌이 세탁기 25kg', cat: 'appliance', tag: 'washer', w: 69, d: 72, h: 109 },
    { name: '드럼 세탁기 21kg', cat: 'appliance', tag: 'washer', w: 70, d: 83, h: 99 },
    { name: '건조기 20kg (히트펌프)', cat: 'appliance', tag: 'dryer', w: 70, d: 80, h: 99 },
    { name: '건조기 소형 10kg', cat: 'appliance', tag: 'dryer', w: 60, d: 66, h: 85 },
    { name: '워시타워 (드럼+건조 일체형)', cat: 'appliance', tag: 'washer', w: 70, d: 83, h: 189 },
    { name: '워시타워 컴팩트 (드럼)', cat: 'appliance', tag: 'washer', w: 60, d: 66, h: 172 },
    { name: '스타일러', cat: 'appliance', tag: 'styler', w: 45, d: 59, h: 185 },
    // 주방
    { name: '식기세척기 12인용', cat: 'appliance', tag: 'dishwasher', w: 60, d: 60, h: 85 },
    { name: '전자레인지 수납장', cat: 'shelf', tag: 'kitchen', w: 80, d: 45, h: 180 },
    // 에어컨
    { name: '스탠드 에어컨', cat: 'aircon', tag: 'aircon', ac: 'stand', w: 40, d: 40, h: 185 },
    { name: '벽걸이 에어컨', cat: 'aircon', tag: 'aircon', ac: 'wall', w: 90, d: 25, h: 30 },
    { name: '2in1 에어컨 (스탠드 크기)', cat: 'aircon', tag: 'aircon', ac: '2in1', w: 40, d: 40, h: 185 },
    // TV·거실
    { name: 'TV 55형 (받침대 포함)', cat: 'electronics', tag: 'tv', w: 123, d: 25, h: 78 },
    { name: 'TV 65형 (받침대 포함)', cat: 'electronics', tag: 'tv', w: 145, d: 29, h: 90 },
    { name: 'TV 75형 (받침대 포함)', cat: 'electronics', tag: 'tv', w: 168, d: 34, h: 103 },
    { name: '거실장 180', cat: 'storage', tag: 'tv', w: 180, d: 40, h: 45 },
    { name: '공기청정기', cat: 'electronics', tag: 'purifier', w: 40, d: 40, h: 85 },
    // 소파
    { name: '1인 소파', cat: 'sofa', tag: 'sofa', w: 85, d: 90, h: 95 },
    { name: '2인 소파', cat: 'sofa', tag: 'sofa', w: 160, d: 85, h: 85 },
    { name: '3인 소파', cat: 'sofa', tag: 'sofa', w: 210, d: 90, h: 85 },
    { name: '4인 소파', cat: 'sofa', tag: 'sofa', w: 260, d: 95, h: 85 },
    // 식탁·책상·의자
    { name: '식탁 2인', cat: 'table', tag: 'table', w: 80, d: 65, h: 75 },
    { name: '식탁 4인', cat: 'table', tag: 'table', w: 140, d: 80, h: 75 },
    { name: '식탁 6인', cat: 'table', tag: 'table', w: 180, d: 90, h: 75 },
    { name: '식탁 의자', cat: 'sofa', tag: 'chair', w: 45, d: 52, h: 85 },
    { name: '책상 100', cat: 'table', tag: 'desk', w: 100, d: 60, h: 73 },
    { name: '책상 120', cat: 'table', tag: 'desk', w: 120, d: 60, h: 73 },
    { name: '아이 책상 (높이 조절)', cat: 'kids', tag: 'desk', w: 110, d: 65, h: 76 },
    { name: '책상 의자', cat: 'sofa', tag: 'chair', w: 65, d: 65, h: 105 },
    // 책장·서랍장
    { name: '책장 60 (5단)', cat: 'shelf', tag: 'shelf', w: 60, d: 30, h: 180 },
    { name: '책장 80 (5단)', cat: 'shelf', tag: 'shelf', w: 80, d: 30, h: 180 },
    { name: '책장 120 (5단)', cat: 'shelf', tag: 'shelf', w: 120, d: 30, h: 180 },
    { name: '서랍장 3단', cat: 'storage', tag: 'drawer', w: 80, d: 45, h: 75 },
    { name: '서랍장 5단', cat: 'storage', tag: 'drawer', w: 80, d: 45, h: 120 },
    // 옷 수납 (새 집 천장고 약 230cm 추정 → 216cm 이하)
    { name: '옷장 80', cat: 'storage', tag: 'wardrobe', w: 80, d: 60, h: 216 },
    { name: '옷장 100', cat: 'storage', tag: 'wardrobe', w: 100, d: 60, h: 216 },
    { name: '옷장 120', cat: 'storage', tag: 'wardrobe', w: 120, d: 60, h: 216 },
    { name: '시스템행거 120', cat: 'storage', tag: 'wardrobe', w: 120, d: 50, h: 200 },
    { name: '시스템행거 160', cat: 'storage', tag: 'wardrobe', w: 160, d: 50, h: 200 },
    { name: '이불장', cat: 'storage', tag: 'bedding', w: 80, d: 60, h: 190 },
    { name: '이동식 행거', cat: 'storage', tag: 'hanger', w: 100, d: 45, h: 160 },
    { name: '화장대 (거울 포함)', cat: 'storage', tag: 'vanity', w: 80, d: 40, h: 140 },
    // 침대
    { name: '침대 슈퍼싱글', cat: 'bed', tag: 'bed', w: 115, d: 210, h: 45 },
    { name: '침대 퀸', cat: 'bed', tag: 'bed', w: 165, d: 215, h: 45 },
    { name: '침대 킹', cat: 'bed', tag: 'bed', w: 185, d: 215, h: 45 },
    { name: '아이 침대 (슈퍼싱글·가드)', cat: 'bed', tag: 'bed', w: 118, d: 210, h: 60 },
    { name: '2층 침대', cat: 'bed', tag: 'bed', w: 115, d: 210, h: 160 },
    { name: '매트리스만 (퀸)', cat: 'bed', tag: 'mattress', w: 160, d: 200, h: 28 },
    { name: '매트리스만 (슈퍼싱글)', cat: 'bed', tag: 'mattress', w: 110, d: 200, h: 25 },
    // 아이 물건
    { name: '장난감 수납장', cat: 'kids', tag: 'toybox', w: 100, d: 35, h: 90 },
    { name: '아이 자전거 (16인치)', cat: 'kids', tag: 'bike', w: 120, d: 55, h: 75 },
    { name: '킥보드', cat: 'kids', tag: 'scooter', w: 65, d: 30, h: 85 },
    { name: '유모차 (접은 상태)', cat: 'kids', tag: 'stroller', w: 50, d: 40, h: 95 },
    // 기타
    { name: '신발장', cat: 'storage', tag: 'shoe', w: 80, d: 35, h: 120 },
    { name: '자전거', cat: 'misc', tag: 'bike', w: 170, d: 60, h: 100 },
    { name: '피아노 (업라이트)', cat: 'misc', tag: 'piano', w: 150, d: 60, h: 125 },
    { name: '런닝머신', cat: 'misc', tag: 'treadmill', w: 75, d: 165, h: 130 },
    { name: '리빙박스 70L', cat: 'misc', tag: 'box', w: 60, d: 44, h: 35 },
  ];

  /* ---------------- 두 집 차이 요약 (도면 추정값 기준) ---------------- */
  MV.planCompare = [
    {
      level: 'warn', title: '전용면적이 7.2㎡(약 11%) 줄어요',
      detail: '66.9㎡ → 59.67㎡, 약 2.2평 차이예요. 둘 다 "24평형"으로 불리고 공급면적도 78~79㎡로 비슷하지만, 실제로 쓰는 면적은 줄어요. 짐을 지금의 90% 이하로 줄인다고 생각하고 정리하세요.',
    },
    {
      level: 'bad', title: '3베이일 수도 있어요 → 실측 전엔 큰 가구 구매 보류',
      detail: '두 도면 모두 2베이로 가정한 추정이에요. 3베이라면 전면에 작은방-거실-안방이 나란히 놓여 방 크기와 벽 길이가 모두 달라져요. 옷장·소파·식탁·통돌이는 사전방문 실측 뒤에 주문하세요. 가장 빠른 확인 방법은 네이버부동산 앱 단지정보 > 평면도를 캡처하거나 관리사무소·부동산에 평면도를 받는 거예요.',
    },
    {
      level: 'bad', title: '거실이 가장 많이 줄어요 (추정 −3.2㎡)',
      detail: '4.1×4.15m → 3.9×3.55m(추정). 깊이가 약 60cm 짧아져요. 거실장(깊이 40cm)과 소파(깊이 90cm)를 마주 놓으면 사이가 약 2.2m 남아요. 4인 소파나 긴 거실장은 실측 뒤에 정하세요.',
    },
    {
      level: 'warn', title: '안방은 약 2㎡ 작아지고 붙박이장이 없어요',
      detail: '3.3×4.15m → 3.3×3.55m(추정). 새 집엔 붙박이장이 없어서 옷장(깊이 약 60cm)을 따로 들여 같은 벽에 세워야 해요. 그러면 침대 옆 통로가 지금보다 좁아져요. 퀸 침대(약 165×215)와 옷장을 함께 놓을 수 있는지 새 집 배치에서 놓아 보세요.',
    },
    {
      level: 'bad', title: '붙박이장(추정 약 3.4m) 대신 옷장이 필요해요',
      detail: '지금 안방 붙박이장만큼 옷을 걸려면 120cm 옷장 3개(3.6m) 정도가 필요한 셈이에요. 먼저 붙박이장 칸 수와 행거봉 길이를 재고, 옷을 줄인 뒤 모자란 만큼만 사세요. 옷장 주문은 새 집 벽 길이를 잰 뒤에 하세요.',
    },
    {
      level: 'warn', title: '천장고 약 230cm(추정) → 옷장은 216cm 이하로',
      detail: '두 집 다 1990년대 아파트라 천장이 낮을 가능성이 커요. 240cm짜리 키 큰 장이나 천장까지 닿는 장은 안 들어갈 수 있어요. 216cm 옷장도 눕혀서 조립한 뒤 세울 때 대각선이 약 224cm라 여유가 6cm 정도예요. 새 집 천장고를 꼭 재세요.',
    },
    {
      level: 'good', title: '지역난방이라 다용도실에 보일러가 없어요 (추정)',
      detail: '지금 집은 개별난방(가스보일러), 새 집은 지역난방이에요. 보일러가 차지하던 벽을 세탁기·건조기·선반에 쓸 수 있어요. 대신 난방 분배기·온수 계량기가 다용도실 벽 아래나 싱크대 아래에 있을 수 있으니 위치를 확인하세요. 보일러 개통은 필요 없을 가능성이 크고, 가스레인지를 쓰면 취사용 가스만 개통하면 돼요. 관리사무소에 한 번 확인하세요.',
    },
    {
      level: 'warn', title: '다용도실 통돌이+건조기 나란히: 실측해야 확정',
      detail: '다용도실은 약 2.2×1.4m로 추정돼요. 통돌이(폭 약 69cm)+건조기(약 70cm)+틈을 합쳐 연속 벽이 최소 145~150cm 필요해요(문 열림·창틀·분배기·수전 자리는 빼고 재세요). 통돌이는 뚜껑이 위로 열려 건조기를 위에 쌓을 수 없어요. 깊이는 기기 약 80cm+호스 10cm라, 다용도실 깊이가 1.4m면 앞에 약 50cm, 1.2m면 30cm만 남아 빨래를 꺼내기 빠듯해요. 안 되면 건조기를 뒷발코니에 두거나(콘센트·배수, 겨울 얼지 않는지 확인), 드럼+건조기 직렬·워시타워 컴팩트로 바꾸거나, 건조기를 처분하는 방법이 있어요.',
    },
    {
      level: 'good', title: '뒷발코니가 하나 더 있어요 (추정 2.6×1.4m)',
      detail: '작은방1 뒤에 지금 집엔 없는 뒷발코니가 있을 것으로 보여요. 리빙박스·계절용품을 두거나, 콘센트·배수가 있으면 건조기 자리로 쓸 수 있어요. 현관도 조금 넓어져요(2.6 → 3.2㎡, 추정).',
    },
    {
      level: 'info', title: '식당은 약 1.9㎡ 줄고 주방 통로가 좁아요',
      detail: '식당 4.5×2.2m → 4.0×2.0m(추정)라 4인 식탁(140×80)이 알맞고 6인 식탁은 빠듯해요. 주방은 싱크대와 냉장고 사이 통로가 약 80cm로 좁을 수 있어요. 냉장고 자리 폭(약 90cm 추정)이 양문형(약 91cm)에 빠듯하니 꼭 재세요. 작은방 2개는 지금과 비슷해요(6.5·7.0㎡ → 7.0·6.7㎡).',
    },
    {
      level: 'good', title: '반출은 쉬워요: 지금 집 2층',
      detail: '사다리차 최저 요금 구간(2~5층 약 15만원 내외, 2025년 시세)이고 계단으로도 나를 수 있어요. 다만 건물 앞 화단·나무·전선, 지상주차 차량 때문에 사다리차를 못 세울 수 있으니 견적 방문 때 확인하세요.',
    },
    {
      level: 'warn', title: '반입은 14층: 사다리차·엘리베이터 확인',
      detail: '14층(약 36~38m)은 일반 사다리차로 올릴 수 있어요(2025년 요금표 기준 5톤 약 20만~21만원). 엘리베이터 안쪽 크기와 문 폭을 재고, 사용료·보호재·11/2와 11/3 이틀 사용을 관리사무소에 확인하세요. 동 앞에 사다리차를 펼 자리가 있는지도 보세요.',
    },
  ];
})();
