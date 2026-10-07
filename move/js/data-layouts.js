/* ============================================================
   도면 기본 배치 — 짐을 두 집 도면에 미리 놓아 둔 상태 (+ 옛 기록용 배치 이전 규칙)
   MV.seedLayouts = { old: { placements: [...] }, new: { placements: [...] } }
   placement = { id, invId, x, y, rot }
     x,y = 놓인 사각형의 왼쪽 위 (cm, 도면 원점 기준, 회전 반영 외곽)
     rot = 정면(쓰임 공간 front 가 열리는 쪽) 방향: 0 = 아래(남, +y) · 90 = 왼쪽(서, −x) · 180 = 위(북, −y) · 270 = 오른쪽(동, +x)
           바닥 크기는 0·180 이 가로 w × 깊이 d, 90·270 이 d × w (옛 기록의 0·90 은 뜻이 그대로예요)
     개수가 여럿인 짐(의자 4·캐비닛장 ① 2·어린이책장 3)은 같은 invId 로 배치를 여러 개 둠 (도면 화면도 같은 방식)
   - 처음 여는 기기: core.js freshState 가 MV.seedLayouts 를 그대로 씀.
   - 이미 쓰던 기록: 이 파일 끝에서 MV.seed.migrations 에 { to: 8, layouts } 를 더함 (core migrateSeed 의 layouts 규칙)
       · move: 그 배치가 아직 v7 기본 자리(from)에 있을 때만 새 자리(set)로 — 사용자가 옮긴 배치는 그대로
       · add: 같은 id 배치가 없고, 그 짐의 배치 수가 개수(qty)보다 적고, 다른 배치와 겹치지 않을 때만
              + clear(그 짐의 쓰임 공간 앞, 방 안으로 자름)에 다른 짐이 없고, 이미 있는 초안 배치의 clear 를 막지 않을 때만
       · ifInv: 짐 크기가 v8 기본값일 때만 (사용자가 크기를 고친 짐은 좌표가 안 맞아 건드리지 않음)
       배치 id 가 고정이라 두 기기가 같이 올려도 같은 배치가 두 번 생기지 않아요.
   - invId 는 짐 목록(data-seed.js inventory)의 id, 크기·쓰임 공간(use)도 짐 목록(version 8)을 따릅니다.
   - 좌표는 data-plans.js 의 '추정' 도면 기준이에요(실측 전). 10/10 실측 뒤 도면을 고치고 끌어서 옮기면 돼요.

   ── 새 집 배치 초안 (10/7, 실제 가구 규격 + 같은 날 사용자 요청) — 근거 ─────────────────────
     규칙(10/7 ★★★★★ '모든 가구에 10cm 이격 · 쓰임 공간'): 모든 가구 몸체를 벽(방 경계선)·다른 가구 몸체·고정물·
       방문 열림 범위에서 10cm 이상 띄움(의자↔식탁만 예외). 쓰임 공간(짐 use: 서랍·여닫이 문 앞, 앉는 자리, 바람 앞 등)이
       벽·다른 가구 몸체·고정물과 겹치지 않게 정면(rot)을 정함. 몸체는 문 앞 45cm·트인 곳 통로 60cm를 막지 않음.
       방 지정(사용자): 책장 4개 전부 작은방1, 데스커 책상·알렉스 서랍은 작은방2, 안방에 옷장(캐비닛장·간이옷장) 없음,
       식탁+의자와 소파는 자리를 맞바꿈. 검사: scratchpad realspec/tests-a/geom.js (위반 0 이 아니면 문제 목록에 적음).
     주방(240~470 × 140~420): 냉장고(91.3×73.5) 정면 왼쪽(90), 오른쪽 벽 '냉장고 자리'(y 240~330, 폭 90 추정)에 뒤 10cm →
           x 386.5~460, y 239.4~330.7. 문 앞 90cm 를 두면 싱크대(x 300)와 3.5cm 겹침 — 문제 목록(주방 폭 실측).
     다용도실(240~460 × 0~140): 위쪽 벽 뒤 10cm, 정면 아래(0). 통돌이 x 250~313.2(수전 쪽, 왼쪽 벽 10cm) + 5cm + 건조기
           x 318.2~386.8, 다용도실 문 열림 범위(사각형 x 390~)까지 3.2cm(문짝이 도는 원까지는 약 14.6cm). 10cm씩 띄우려면
           161.8cm 필요 > 150cm(11.8 모자람), 건조기 앞 42.4cm(필요 90, 문 열림 약 55) — 정면을 옆으로 돌려도 안 들어가 문제 목록.
     거실(330~720 × 620~975) — 식탁·소파 맞바꿈: 식탁(135×80)을 왼쪽(안방 쪽) 벽에서 10cm, x 340~475, y 745~825,
           의자 4개는 긴 변 위·아래에 2개씩(정면이 식탁 쪽: 위 0 · 아래 180, 사이 10cm, 뒤로 빼는 30cm 포함 위는 거실 입구에서
           44.5cm, 아래는 발코니 창까지 69.5cm). 소파(173×85)는 오른쪽 벽 위쪽, 정면 왼쪽(90) x 625~710, y 630~803
           (예전 식탁 자리). 소파 앞 60cm 와 식탁 사이 통로 90cm. 장난감장(작은방1 벽이 모자라 거실로)은 소파 아래 오른쪽 벽,
           정면 왼쪽(90) x 670.5~710, y 813~879.5. 에어컨 스탠드는 배관구(x 664~678) 바로 오른쪽 구석, 정면 왼쪽(90) —
           x 685.4~710, y 929~965, 바람 앞 150cm(x 535.4~685.4)는 발코니 창 앞을 따라 비어 있음(정면 위(180)면 소파와 겹침).
     안방(0~330 × 620~975) — 옷장 없음: 매트리스(200×200)는 머리를 왼쪽 벽 쪽으로(정면=발치 오른쪽, 270) x 10~210,
           y 765~965 — 발치 50·위쪽 옆 50 비움(아래쪽 옆은 창 벽). 화장대(100×50, 낮은 좌식) x 10~110, 체스트랙 x 120~165는
           위쪽 벽(욕실 쪽)에서 10cm, 정면 아래(0) — 앉는 자리·서랍 앞 60·50cm 가 매트리스 전에 끝남. 안방 문 열림 범위까지 35cm.
     작은방2(0~240 × 140~420): 캐비닛장 3종을 왼쪽 벽에 10cm 띄워 나란히(정면 오른쪽 270, 사이 10cm → 248cm / 벽 260cm) —
           ② 3단 수납형(169cm)을 창 쪽 위(y 156~232), ① 2단 행어형 ×2 를 아래(y 242~318, 328~404). 문 앞 70cm(x 60~130).
           데스커 책상(120×60)은 오른쪽 벽(주방 쪽)에 정면 왼쪽(90) x 170~230, y 201~321(앉는 자리 75cm 가 방 가운데),
           알렉스 서랍은 그 위 창 쪽 x 172~230, y 155~191(정면 왼쪽, 서랍 앞 60). 방문 열림 범위(y 345~)까지 24cm.
     작은방1(470~720 × 140~420, 아이 방) — 책장 4개 전부: 오른쪽 벽에 책장 5단(y 195~275)·어린이책장(y 285~365), 정면 왼쪽(90),
           뒷발코니 문 앞(y 185까지)은 비움. 왼쪽 벽(주방 쪽)에 어린이책장 2개(y 165~245, 255~335), 정면 오른쪽(270) —
           방문 열림 범위(y 345~)까지 10cm. 간이옷장(스탠드 행거 82×40)은 아래쪽 벽 x 575~657, y 370~410, 정면 위(180).
           가운데 약 173×185cm 가 놀이 바닥으로 남음(책장 앞 쓰임 공간과 겹침). 창(x 480~620) 왼쪽 끝 앞을 어린이책장(118cm)이 28.5cm 가림 — 문제 목록.
     놓지 않은 것: 간이박스 6개(캐비닛장·책장 위), 리빙박스 5개, 고장 세탁기(버림), 이사 뒤 살 옷장(선택 — 남는 벽이 거의 없음).
   ── 지금 집 ── 냉장고·스탠드만 새 크기에 맞게 옮김 (냉장고 뒤 10cm, 스탠드 구석 3cm · 정면은 거실 쪽 위(180)). 다용도실 보일러·문 열림 범위를 비움.
   ============================================================ */
(function () {
  'use strict';
  const P = (id, invId, x, y, rot) => ({ id, invId, x, y, rot: rot || 0 });
  // 새 집 배치 초안 (version 8) — [배치, v8 짐 크기 { w, d }]
  const NEW = [
    // 주방: 냉장고 자리, 정면 왼쪽(90) — 오른쪽 벽에서 뒤 10cm (LG 설치 기준 뒤 10cm 이상 = 오차 여유 10cm).
    // 문 앞은 싱크대까지 86.5cm (쓰임 90cm 에 3.5cm 모자람 — 문 한 짝 약 45.7cm 는 열림, 주방 폭 170 < 173.5 라 피할 수 없음)
    [P('pl-new-fridge', 'inv-fridge', 386.5, 239.4, 90), { w: 91.3, d: 73.5 }],
    // 다용도실 위쪽 벽(뒤 10cm, 정면 아래): 수전 쪽에 통돌이(왼쪽 벽 10cm), 5cm 띄워 건조기(오차 여유를 줄인 곳 ②).
    // 건조기 ~ 문 열림 범위(사각형 x 390~)는 3.2cm 지만, 문짝이 실제로 도는 원(경첩 x 460, 반지름 70)까지는 약 14.6cm
    [P('pl-new-washer', 'inv-washer-new', 250, 10, 0), { w: 63.2, d: 67 }],
    [P('pl-new-dryer', 'inv-dryer', 318.2, 10, 0), { w: 68.6, d: 87.6 }],
    // 거실 발코니 쪽 오른쪽 구석, 스탠드 배관구(추정) 바로 오른쪽 — 정면 왼쪽(90), 바람은 발코니 창 앞을 따라
    [P('pl-new-ac', 'inv-ac-stand', 685.4, 929, 90), { w: 36, d: 24.6 }],
    // 거실 오른쪽 벽 위쪽(예전 식탁 자리): 소파 정면 왼쪽(90)
    [P('pl-new-sofa', 'inv-sofa', 625, 630, 90), { w: 173, d: 85 }],
    // 거실 왼쪽(안방 쪽) 벽(예전 소파 자리): 식탁 + 의자 4 (긴 변 위·아래 2개씩, 정면이 식탁 쪽)
    [P('pl-new-dining', 'inv-dining', 340, 745, 0), { w: 135, d: 80 }],
    [P('pl-new-chair-1', 'inv-dining-chair', 351.5, 694.5, 0), { w: 51, d: 50.5 }],
    [P('pl-new-chair-2', 'inv-dining-chair', 412.5, 694.5, 0), { w: 51, d: 50.5 }],
    [P('pl-new-chair-3', 'inv-dining-chair', 351.5, 825, 180), { w: 51, d: 50.5 }],
    [P('pl-new-chair-4', 'inv-dining-chair', 412.5, 825, 180), { w: 51, d: 50.5 }],
    // 거실 오른쪽 벽, 소파 아래: 장난감장 정면 왼쪽(90)
    [P('pl-new-toy', 'inv-toy-storage', 670.5, 813, 90), { w: 66.5, d: 39.5 }],
    // 안방(옷장 없음): 매트리스 머리는 왼쪽 벽, 발치 오른쪽(270) · 화장대·체스트랙은 위쪽 벽, 정면 아래(0)
    [P('pl-new-bed', 'inv-bed-master', 10, 765, 270), { w: 200, d: 200 }],
    [P('pl-new-vanity', 'inv-vanity', 10, 630, 0), { w: 100, d: 50 }],
    [P('pl-new-chest', 'inv-chest-rack', 120, 630, 0), { w: 45, d: 43 }],
    // 작은방2: 캐비닛장 3종은 왼쪽 벽에 나란히(정면 오른쪽 270) · 책상·알렉스는 오른쪽 벽(정면 왼쪽 90)
    [P('pl-new-cabinet2', 'inv-cabinet-2', 10, 156, 270), { w: 76, d: 50 }],
    [P('pl-new-cabinet-1', 'inv-cabinet', 10, 242, 270), { w: 76, d: 50 }],
    [P('pl-new-cabinet-2', 'inv-cabinet', 10, 328, 270), { w: 76, d: 50 }],
    [P('pl-new-alex', 'inv-desk-drawer', 172, 155, 90), { w: 36, d: 58 }],
    [P('pl-new-desk', 'inv-desk-adult', 170, 201, 90), { w: 120, d: 60 }],
    // 작은방1(아이 방): 책장 5단·어린이책장 1은 오른쪽 벽(90), 어린이책장 2는 왼쪽 벽(270), 간이옷장은 아래쪽 벽(180)
    [P('pl-new-bookshelf', 'inv-bookshelf', 681.5, 195, 90), { w: 80, d: 28.5 }],
    [P('pl-new-kidshelf-1', 'inv-bookshelf-kid', 681.5, 285, 90), { w: 80, d: 28.5 }],
    [P('pl-new-kidshelf-2', 'inv-bookshelf-kid', 480, 165, 270), { w: 80, d: 28.5 }],
    [P('pl-new-kidshelf-3', 'inv-bookshelf-kid', 480, 255, 270), { w: 80, d: 28.5 }],
    [P('pl-new-hanger', 'inv-hanger', 575, 370, 180), { w: 82, d: 40 }],
  ];
  const OLD = [
    // 주방 오른쪽 벽, 뒤 10cm (x 416.5~490)
    [P('pl-old-fridge', 'inv-fridge', 416.5, 215, 90), { w: 91.3, d: 73.5 }],
    // 다용도실 위쪽 벽: 수전 쪽에 고장 세탁기, 그 옆 건조기 (보일러 x 460~, 문 열림 범위 x 405~ 는 비움)
    [P('pl-old-washer', 'inv-washer-old', 263, 0, 0), null],
    [P('pl-old-dryer', 'inv-dryer', 326, 0, 0), null],
    // 거실 발코니 쪽 오른쪽 구석, 스탠드 배관구(추정) 바로 옆 (x 701~737, y 1007.4~1032) — 등을 발코니 쪽 벽에 대고 정면 위(180)
    [P('pl-old-ac', 'inv-ac-stand', 701, 1007.4, 180), { w: 36, d: 24.6 }],
  ];
  MV.seedLayouts = {
    new: { placements: NEW.map(([p]) => Object.assign({}, p)) },
    old: { placements: OLD.map(([p]) => Object.assign({}, p)) },
  };

  /* 옛 기록(v7 이하) → v8: v7 기본 배치 자리(from)에 그대로 있으면 새 자리로, 나머지는 새로 더함 */
  const V7_AT = {
    new: { 'pl-new-fridge': { x: 378.2, y: 239, rot: 90 }, 'pl-new-washer': { x: 243, y: 0, rot: 0 }, 'pl-new-dryer': { x: 309.2, y: 0, rot: 0 },
      'pl-new-ac': { x: 680, y: 944, rot: 0 }, 'pl-new-hanger': { x: 190, y: 200, rot: 90 } },
    old: { 'pl-old-fridge': { x: 408.2, y: 215, rot: 90 }, 'pl-old-ac': { x: 700, y: 1004, rot: 0 } },
  };
  /* 더할 배치의 '쓰임 공간 앞'(서랍·문 앞, 앉는 자리 등 use.front) 사각형 — 그 방 안으로 자름.
     옛 기록에 사용자가 이미 다른 짐을 그 앞에 놓았으면 core 가 이 배치를 더하지 않아요(서랍이 막힌 초안을 만들지 않게). */
  function clearOf(p, size, key) {
    const it = MV.seed && Array.isArray(MV.seed.inventory) ? MV.seed.inventory.find((x) => x.id === p.invId) : null;
    const F = it && it.use ? +it.use.front || 0 : 0;
    if (!size || !(F > 0)) return undefined;
    const q = p.rot === 90 || p.rot === 270;
    const r = { x: p.x, y: p.y, w: q ? size.d : size.w, h: q ? size.w : size.d };
    let z = p.rot === 180 ? { x: r.x, y: r.y - F, w: r.w, h: F } : p.rot === 90 ? { x: r.x - F, y: r.y, w: F, h: r.h }
      : p.rot === 270 ? { x: r.x + r.w, y: r.y, w: F, h: r.h } : { x: r.x, y: r.y + r.h, w: r.w, h: F };
    const plan = MV.plans && MV.plans[key];
    const cx = r.x + r.w / 2, cy = r.y + r.h / 2;
    const rm = plan && Array.isArray(plan.rooms) ? plan.rooms.find((m) => cx >= m.x && cx <= m.x + m.w && cy >= m.y && cy <= m.y + m.h) : null;
    if (rm) {
      const x0 = Math.max(z.x, rm.x), y0 = Math.max(z.y, rm.y), x1 = Math.min(z.x + z.w, rm.x + rm.w), y1 = Math.min(z.y + z.h, rm.y + rm.h);
      if (x1 - x0 < 1 || y1 - y0 < 1) return undefined;
      z = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
    }
    const r1 = (v) => Math.round(v * 10) / 10;
    return { x: r1(z.x), y: r1(z.y), w: r1(z.w), h: r1(z.h) };
  }
  function rules(list, key) {
    const out = { add: [], move: {} };
    list.forEach(([p, size]) => {
      const was = V7_AT[key][p.id];
      if (was) {
        if (was.x !== p.x || was.y !== p.y || was.rot !== p.rot) out.move[p.id] = { from: was, set: { x: p.x, y: p.y, rot: p.rot }, ifInv: size || undefined };
      } else if (key === 'new') {
        const clear = clearOf(p, size, key);
        out.add.push(Object.assign({}, p, size ? { ifInv: size } : {}, clear ? { clear } : {}));
      }
    });
    return out;
  }
  if (MV.seed && Array.isArray(MV.seed.migrations)) {
    MV.seed.migrations.push({ to: 8, layouts: { new: rules(NEW, 'new'), old: rules(OLD, 'old') } });
  }
})();
