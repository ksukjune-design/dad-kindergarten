/* ============================================================
   도면 기본 배치 — 큰 가전을 두 집 도면에 미리 놓아 둔 상태
   MV.seedLayouts = { old: { placements: [...] }, new: { placements: [...] } }
   placement = { id, invId, x, y, rot }
     x,y = 놓인 사각형의 왼쪽 위 (cm, 도면 원점 기준) · rot 0|90 (90이면 가로·깊이가 바뀜)
   - 처음 여는 사람에게만 들어갑니다 (core.js freshState). 이미 쓰던 기록은 건드리지 않아요.
   - invId 는 짐 목록(data-seed.js inventory)의 id, 크기도 짐 목록 규격을 따릅니다:
       inv-fridge     LG 870L 4도어 91.4×91.8 (rot 90 → 바닥 91.8×91.4)
       inv-dryer      삼성 그랑데 20kg 68.6×87.2
       inv-washer-new 새 통돌이 17kg급 63.2×67 (새 집에만) / inv-washer-old 고장 세탁기 60×65 (지금 집에만)
       inv-ac-stand   삼성 2in1 스탠드 실내기 약 40×31 (벽걸이·실외기는 같은 세트라 따로 놓지 않음)
   - 좌표는 data-plans.js 의 추정 도면 기준이고, 벽·문 열림 범위·문 앞·고정물과 겹치지 않게 잡았어요.
     새 집: 냉장고는 주방 오른쪽 벽 '냉장고 자리'(폭 90cm 추정이라 실측 필요), 세탁기·건조기는
     다용도실 위쪽 벽에 틈 3cm씩 두고 나란히(수전 쪽에 통돌이, 다용도실 문 열림 범위는 비움),
     스탠드는 거실 발코니 쪽 오른쪽 구석 '스탠드 배관구(추정)' 바로 옆.
     지금 집도 같은 방식(다용도실 보일러·문 열림 범위를 비움).
   - 실측 뒤 도면에서 끌어서 옮기면 됩니다.
   ============================================================ */
(function () {
  'use strict';
  MV.seedLayouts = {
    new: {
      placements: [
        // 주방 오른쪽 벽 '냉장고 자리' — 90° 돌려 벽에 붙임 (x 378.2~470, 싱크대와 통로 약 78cm)
        { id: 'pl-new-fridge', invId: 'inv-fridge', x: 378.2, y: 239, rot: 90 },
        // 다용도실 위쪽 벽: 수전 쪽(왼쪽)에 새 통돌이, 3cm 띄워 건조기 (x 243~377.8, 문 열림 범위 x 390~ 는 비움)
        { id: 'pl-new-washer', invId: 'inv-washer-new', x: 243, y: 0, rot: 0 },
        { id: 'pl-new-dryer', invId: 'inv-dryer', x: 309.2, y: 0, rot: 0 },
        // 거실 발코니 쪽 오른쪽 구석, 스탠드 배관구(추정) 바로 옆 (x 680~720, y 944~975)
        { id: 'pl-new-ac', invId: 'inv-ac-stand', x: 680, y: 944, rot: 0 },
      ],
    },
    old: {
      placements: [
        // 주방 오른쪽 벽 (x 408.2~500, 싱크대와 통로 약 88cm)
        { id: 'pl-old-fridge', invId: 'inv-fridge', x: 408.2, y: 215, rot: 90 },
        // 다용도실 위쪽 벽: 수전 쪽에 고장 세탁기, 그 옆 건조기 (보일러 x 460~, 문 열림 범위 x 405~ 는 비움)
        { id: 'pl-old-washer', invId: 'inv-washer-old', x: 263, y: 0, rot: 0 },
        { id: 'pl-old-dryer', invId: 'inv-dryer', x: 326, y: 0, rot: 0 },
        // 거실 발코니 쪽 오른쪽 구석, 스탠드 배관구(추정) 바로 옆 (x 700~740, y 1004~1035)
        { id: 'pl-old-ac', invId: 'inv-ac-stand', x: 700, y: 1004, rot: 0 },
      ],
    },
  };
})();
