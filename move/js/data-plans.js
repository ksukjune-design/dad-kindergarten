/* ============================================================
   도면 데이터 (PROVISIONAL — 리서치 결과로 교체 예정)
   MV.plans = { old: Plan, new: Plan }
   Plan = {
     id, name, short, floor, exclusive_m2,
     width, depth,                // cm, 원점 좌상단, x→오른쪽, y→아래
     front: 'top'|'bottom'|'left'|'right',   // 남향 창/전면 발코니 쪽
     rooms:    [{ id, name, kind, x, y, w, h, note }]
               // kind: living|kitchen|bedroom|bath|entrance|balcony|utility|dressroom|storage|hall|other
     doors:    [{ x, y, width, orientation: 'h'|'v', swing: 'up'|'down'|'left'|'right', hinge: 'start'|'end', room, note }]
               // orientation h: 개구부가 y 위치의 가로벽에서 x..x+width / v: x 위치의 세로벽에서 y..y+width
               // swing: 문짝이 열리며 쓸고 가는 쪽, hinge: 경첩이 개구부의 시작/끝 중 어디
     windows:  [{ x, y, length, orientation: 'h'|'v' }]
     fixtures: [{ name, x, y, w, h, kind }]  // 싱크대·욕조·변기·세면대·수전·배수구·보일러·배관구 등 고정물
     builtins: [{ name, x, y, w, h, note }]  // 붙박이장 등 (지금 집에만 있고 새 집에는 없음)
     confidence: 'high'|'medium'|'low', basis, sources[], images[], measureFirst[], logistics[],
     complex: {...}, unit: {...}
   }
   MV.catalog = [{ name, cat, tag, w, d, h, ac }]  — 규격 프리셋
   MV.planCompare = [{ title, detail, level: 'info'|'warn'|'bad'|'good' }] — 두 집 차이 요약
   ============================================================ */
(function () {
  'use strict';
  MV.plans = {
    old: {
      id: 'old', name: '지금 집 · 등촌우성 (2층)', short: '지금 집', floor: 2, exclusive_m2: 66.9,
      width: 1000, depth: 820, front: 'bottom',
      rooms: [
        { id: 'living', name: '거실', kind: 'living', x: 330, y: 300, w: 380, h: 370 },
        { id: 'kitchen', name: '주방·식당', kind: 'kitchen', x: 330, y: 0, w: 380, h: 300 },
        { id: 'master', name: '안방', kind: 'bedroom', x: 710, y: 300, w: 290, h: 370 },
        { id: 'room2', name: '작은방1', kind: 'bedroom', x: 0, y: 300, w: 330, h: 370 },
        { id: 'room3', name: '작은방2', kind: 'bedroom', x: 0, y: 0, w: 330, h: 300 },
        { id: 'bath', name: '욕실', kind: 'bath', x: 710, y: 0, w: 170, h: 220 },
        { id: 'entry', name: '현관', kind: 'entrance', x: 880, y: 0, w: 120, h: 220 },
        { id: 'hall', name: '복도', kind: 'hall', x: 710, y: 220, w: 290, h: 80 },
        { id: 'balcony', name: '전면 발코니', kind: 'balcony', x: 0, y: 670, w: 1000, h: 150 },
      ],
      doors: [
        { x: 900, y: 220, width: 90, orientation: 'h', swing: 'down', hinge: 'start', room: 'entry' },
        { x: 740, y: 300, width: 80, orientation: 'h', swing: 'down', hinge: 'start', room: 'master' },
        { x: 330, y: 400, width: 80, orientation: 'v', swing: 'left', hinge: 'start', room: 'room2' },
      ],
      windows: [
        { x: 40, y: 820, length: 920, orientation: 'h' },
      ],
      fixtures: [
        { name: '싱크대', x: 340, y: 0, w: 240, h: 60, kind: 'sink' },
        { name: '욕조', x: 710, y: 0, w: 70, h: 150, kind: 'bath' },
      ],
      builtins: [
        { name: '붙박이장', x: 710, y: 610, w: 290, h: 60, note: '이사 가면 없어짐' },
      ],
      confidence: 'low', basis: '임시 도면 — 리서치 반영 전', sources: [], images: [], measureFirst: [], logistics: [],
    },
    new: {
      id: 'new', name: '새 집 · 서광등촌마을 (14층)', short: '새 집', floor: 14, exclusive_m2: 59.67,
      width: 960, depth: 780, front: 'bottom',
      rooms: [
        { id: 'living', name: '거실', kind: 'living', x: 320, y: 280, w: 360, h: 340 },
        { id: 'kitchen', name: '주방·식당', kind: 'kitchen', x: 320, y: 0, w: 360, h: 280 },
        { id: 'master', name: '안방', kind: 'bedroom', x: 680, y: 280, w: 280, h: 340 },
        { id: 'room2', name: '작은방1', kind: 'bedroom', x: 0, y: 280, w: 320, h: 340 },
        { id: 'room3', name: '작은방2', kind: 'bedroom', x: 0, y: 0, w: 320, h: 280 },
        { id: 'bath', name: '욕실', kind: 'bath', x: 680, y: 0, w: 160, h: 210 },
        { id: 'entry', name: '현관', kind: 'entrance', x: 840, y: 0, w: 120, h: 210 },
        { id: 'hall', name: '복도', kind: 'hall', x: 680, y: 210, w: 280, h: 70 },
        { id: 'balcony', name: '전면 발코니', kind: 'balcony', x: 0, y: 620, w: 800, h: 160 },
        { id: 'utility', name: '다용도실', kind: 'utility', x: 800, y: 620, w: 160, h: 160 },
      ],
      doors: [
        { x: 860, y: 210, width: 90, orientation: 'h', swing: 'down', hinge: 'start', room: 'entry' },
        { x: 700, y: 280, width: 80, orientation: 'h', swing: 'down', hinge: 'start', room: 'master' },
      ],
      windows: [
        { x: 40, y: 780, length: 740, orientation: 'h' },
      ],
      fixtures: [
        { name: '싱크대', x: 330, y: 0, w: 240, h: 60, kind: 'sink' },
        { name: '세탁 수전', x: 900, y: 760, w: 20, h: 20, kind: 'tap' },
      ],
      builtins: [],
      confidence: 'low', basis: '임시 도면 — 리서치 반영 전', sources: [], images: [], measureFirst: [], logistics: [],
    },
  };

  MV.catalog = [
    { name: '양문형 냉장고', cat: 'appliance', tag: 'fridge', w: 91, d: 92, h: 179 },
    { name: '4도어 냉장고', cat: 'appliance', tag: 'fridge', w: 91, d: 93, h: 186 },
    { name: '통돌이 세탁기 21kg', cat: 'appliance', tag: 'washer', w: 70, d: 72, h: 105 },
    { name: '드럼 세탁기 21kg', cat: 'appliance', tag: 'washer', w: 70, d: 83, h: 99 },
    { name: '건조기 20kg', cat: 'appliance', tag: 'dryer', w: 70, d: 76, h: 99 },
    { name: '스탠드 에어컨', cat: 'aircon', tag: 'aircon', ac: 'stand', w: 50, d: 40, h: 180 },
    { name: '벽걸이 에어컨', cat: 'aircon', tag: 'aircon', ac: 'wall', w: 90, d: 25, h: 30 },
    { name: '퀸 침대', cat: 'bed', tag: 'bed', w: 160, d: 210, h: 40 },
    { name: '슈퍼싱글 침대', cat: 'bed', tag: 'bed', w: 110, d: 210, h: 40 },
    { name: '3인 소파', cat: 'sofa', tag: 'sofa', w: 210, d: 90, h: 85 },
    { name: '4인 식탁', cat: 'table', tag: 'table', w: 140, d: 80, h: 75 },
    { name: '책상', cat: 'table', tag: 'desk', w: 120, d: 60, h: 73 },
    { name: '5단 책장 80', cat: 'shelf', tag: 'shelf', w: 80, d: 30, h: 180 },
    { name: '옷장 120', cat: 'storage', tag: 'wardrobe', w: 120, d: 60, h: 216 },
    { name: '65형 TV + 거실장', cat: 'electronics', tag: 'tv', w: 180, d: 45, h: 50 },
  ];

  MV.planCompare = [];
})();
