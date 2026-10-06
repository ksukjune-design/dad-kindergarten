/* ============================================================
   도면 기본 배치 — 큰 가전을 두 집 도면에 미리 놓아 둔 상태
   MV.seedLayouts = { old: { placements: [...] }, new: { placements: [...] } }
   placement = { id, invId, x, y, rot }  (x,y = 왼쪽 위 cm, rot 0|90 — 90이면 가로·깊이가 바뀜)
   - 처음 여는 사람에게만 들어갑니다 (core.js freshState). 이미 쓰던 기록은 건드리지 않음.
   - 크기는 짐 목록(data-seed.js)의 실제 가전 규격을 따릅니다:
       냉장고 LG 870L 4도어 91.4×91.8 / 건조기 삼성 20kg 68.6×87.2
       새 통돌이(예: LG 17kg) 63.2×67 / 에어컨 스탠드 약 40×31
   - 좌표는 data-plans.js 의 추정 도면 기준입니다. 실측 후 도면에서 끌어서 옮기면 됩니다.
   ============================================================ */
(function () {
  'use strict';
  MV.seedLayouts = {
    new: {
      placements: [
        // 주방 오른쪽 벽 '냉장고 자리' — 90° 돌려 벽에 붙임 (싱크대와 통로 약 78cm)
        { id: 'pl-new-fridge', invId: 'inv-fridge', x: 378, y: 240, rot: 90 },
        // 다용도실: 수전 쪽에 새 통돌이, 그 옆에 건조기 (나란히, 문 열림 범위는 비움)
        { id: 'pl-new-washer', invId: 'inv-washer-new', x: 240, y: 0, rot: 0 },
        { id: 'pl-new-dryer', invId: 'inv-dryer', x: 312, y: 0, rot: 0 },
        // 거실 에어컨 배관구 옆 스탠드 실내기
        { id: 'pl-new-ac', invId: 'inv-ac-stand', x: 650, y: 930, rot: 0 },
      ],
    },
    old: {
      placements: [
        { id: 'pl-old-fridge', invId: 'inv-fridge', x: 408, y: 215, rot: 90 },
        { id: 'pl-old-washer', invId: 'inv-washer-old', x: 262, y: 0, rot: 0 },
        { id: 'pl-old-dryer', invId: 'inv-dryer', x: 326, y: 0, rot: 0 },
        { id: 'pl-old-ac', invId: 'inv-ac-stand', x: 660, y: 985, rot: 0 },
      ],
    },
  };
})();
