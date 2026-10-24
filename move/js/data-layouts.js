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
       · move 도 새 자리에 다른 배치가 있으면 옮기지 않고 활동 기록에 남겨요
       · add: 같은 id 배치가 없고, 그 짐의 배치 수가 개수(qty)보다 적고, 다른 배치와 겹치지 않을 때만
              + clear(그 짐의 쓰임 공간 앞, 방 안으로 자름)에 다른 짐이 없고, 이미 있는 초안 배치의 clear 를 막지 않을 때만
              + needs(의자 → 식탁): 함께 놓일 배치가 초안 자리에 있을 때만
       · fixFront: v8 전 배치의 rot 0·90 은 '돌렸나'만 뜻했어요 → 아래 벽에 등을 댄 0 은 180, 왼쪽 벽에 등을 댄 90 은 270 으로
       · ifInv: 짐 크기가 v8 기본값일 때만 (사용자가 크기를 고친 짐은 좌표가 안 맞아 건드리지 않음)
       배치 id 가 고정이라 두 기기가 같이 올려도 같은 배치가 두 번 생기지 않아요.
   - invId 는 짐 목록(data-seed.js inventory)의 id, 크기·쓰임 공간(use)도 짐 목록(version 8)을 따릅니다.
   - 좌표는 data-plans.js 도면 기준이에요. 새 집은 10/24 가족 실측 도면(방마다 안쪽 치수)으로 다시 그렸고(v14),
     v8~v13 기본 자리(V8_AT)에 그대로 있는 배치만 아래 새 초안 자리로 옮겨요(to: 14 move 규칙 — 사용자가 옮긴 배치는 그대로).

   ── 새 집 배치 초안 (10/24 실측 도면, 10/7 방 지정 + 가족 가이드) — 근거 ─────────────────────
     규칙(10/24 가족 말 '이제 정확한 실측값이라 10cm씩 띄울 필요 없어'): 오차 여유 없이 벽·다른 가구에 붙여도 돼요.
       대신 제조사·쓰임에 필요한 틈은 그대로 — 냉장고 뒤 5cm, 통돌이·건조기 뒤 10cm(호스·배기), 에어컨 옆 10cm.
       쓰임 공간(서랍·문 앞, 앉는 자리 등)은 벽·다른 가구 몸체·고정물과 겹치지 않게, 몸체는 문 앞 45cm·트인 곳 통로(앞뒤 50cm)를 막지 않게.
       방 지정(10/7): 책장 4개·간이옷장은 작은방1(아이 방, 현관 쪽), 캐비닛장 3종·데스커 책상·알렉스는 작은방2(욕실 쪽),
       안방에 옷장 없음, 식탁+의자와 소파는 거실(10/7 맞바꾼 자리 그대로: 식탁 왼쪽 벽, 소파 오른쪽 벽 위쪽).
     세탁 발코니(0~395 × 0~125): 깊이 125라 건조기(87.6)를 위·아래 벽에 붙이면 문 앞 37cm → 건조기는 왼쪽 끝에 옆으로
           (정면 오른쪽 270, 뒤 10) x 10~97.6, y 3~71.6 · 통돌이는 오른쪽 끝 튀어나온 곳(x 325~395, y 73~125) 위 73cm 자리에
           옆으로(정면 왼쪽 90, 뒤 10) x 318~385, y 3~66.2, 앞 60cm. 주방 문(트인 곳 x 245~325) 앞 50cm 는 비움. 수전 위치는 모름.
     주방(218~438 × 125~398): 냉장고 왼쪽 벽, 정면 오른쪽(270), 뒤 5 → x 223~296.5, y 175~266.3. 위쪽 50cm는 세탁 발코니 문 앞,
           아래는 작은방2 문 앞(y 305~)까지 38.7cm. 앞 90cm 를 두면 조리대(x 368)와 18.5cm 겹침 — 통로 150 이라 피할 수 없음(문제 목록).
     거실(340~670 × 563~893): 소파 정면 왼쪽(90) x 585~670, y 613~786 (현관·복도에서 들어오는 트인 곳 앞 50cm 비움) ·
           장난감장 그 아래 정면 왼쪽 x 630.5~670, y 786~852.5 · 식탁 왼쪽 벽에 붙여 x 340~475, y 686.5~766.5,
           의자 위 2개(정면 아래 0) y 636~686.5, 아래 2개(정면 위 180) y 766.5~817 — 뒤로 빼는 30cm 포함 y 606~847 ·
           에어컨 스탠드 아래 왼쪽 구석 정면 오른쪽(270) x 340~364.6, y 847~883(아래 벽 10cm), 바람 앞 150cm 는 분합문 앞을 따라 비어 있음.
           오른쪽 아래 구석은 장난감장 때문에 스탠드(옆 10cm 포함 56cm)가 5.5cm 모자라 왼쪽으로 옮겼어요 — 배관구도 그쪽으로 추정.
     안방(0~340 × 593~893): 깊이 300 이라 위 벽에 화장대(50+앞 60)를 두면 매트리스와 10cm 겹침 → 화장대·체스트랙은 오른쪽 벽
           (안방 문 열리는 자리 y 683 아래), 정면 왼쪽(90): 화장대 x 290~340, y 683~783 · 체스트랙 x 297~340, y 783~828.
           매트리스 머리 왼쪽 벽, 발치 오른쪽(270) x 0~200, y 693~893 — 발치 앞 90cm, 위쪽 옆 50cm 비움(아래쪽 옆은 창 벽).
     작은방2(0~218 × 125~395): 캐비닛장 3종 왼쪽 벽, 정면 오른쪽(270) — 창 쪽 위를 비우고 아래로 붙여 ②3단 y 167~243,
           ①2단 y 243~319, 319~395 · 문 열림 범위(x 128~)까지 앞 70cm 가 닿지 않음. 알렉스 x 160~218, y 125~161,
           책상 x 158~218, y 161~281 (오른쪽 벽, 정면 왼쪽 90 — 작은방2 문(y 305~) 위).
     작은방1(457~670 × 125~398, 아이 방): 왼쪽 벽 어린이책장 2개(정면 오른쪽 270) y 125~285 — 문 열림 범위(y 305~)까지 20cm ·
           오른쪽 벽 어린이책장 y 125~205, 책장 5단 y 205~285 (정면 왼쪽 90) · 간이옷장 아래 벽 문 오른쪽 x 588~670, y 358~398(정면 위 180).
           가운데 약 156×233cm 가 놀이 바닥.
     놓지 않은 것: 간이박스 6개(캐비닛장·책장 위), 리빙박스 5개(위 발코니·다용도실), 고장 세탁기(버림), 이사 뒤 살 옷장(선택).
   ── 지금 집 ── 냉장고·스탠드만 새 크기에 맞게 옮김 (냉장고 뒤 10cm, 스탠드 구석 3cm · 정면은 거실 쪽 위(180)). 다용도실 보일러·문 열림 범위를 비움.
   ============================================================ */
(function () {
  'use strict';
  const P = (id, invId, x, y, rot) => ({ id, invId, x, y, rot: rot || 0 });
  // 새 집 배치 초안 (version 14 — 10/24 실측 도면) — [배치, 짐 크기 { w, d }]
  const NEW = [
    // 주방 왼쪽 벽: 냉장고 정면 오른쪽(270), 뒤 5cm. 세탁 발코니 문 앞 50cm 아래부터 (조리대까지 71.5cm — 문 한 짝은 다 열림)
    [P('pl-new-fridge', 'inv-fridge', 223, 175, 270), { w: 91.3, d: 73.5 }],
    // 세탁 발코니: 통돌이는 오른쪽 끝 튀어나온 곳 위(정면 왼쪽 90, 뒤 10) · 건조기는 왼쪽 끝(정면 오른쪽 270, 뒤 10)
    [P('pl-new-washer', 'inv-washer-new', 318, 3, 90), { w: 63.2, d: 67 }],
    [P('pl-new-dryer', 'inv-dryer', 10, 3, 270), { w: 68.6, d: 87.6 }],
    // 거실 아래 왼쪽 구석(배관구 추정 옆): 스탠드 정면 오른쪽(270) — 바람은 분합문 앞을 따라
    [P('pl-new-ac', 'inv-ac-stand', 340, 847, 270), { w: 36, d: 24.6 }],
    // 거실 오른쪽 벽 위쪽(현관 앞 통로 50cm 아래): 소파 정면 왼쪽(90)
    [P('pl-new-sofa', 'inv-sofa', 585, 613, 90), { w: 173, d: 85 }],
    // 거실 왼쪽(안방 쪽) 벽: 식탁 + 의자 4 (긴 변 위·아래 2개씩, 정면이 식탁 쪽)
    [P('pl-new-dining', 'inv-dining', 340, 686.5, 0), { w: 135, d: 80 }],
    [P('pl-new-chair-1', 'inv-dining-chair', 351.5, 636, 0), { w: 51, d: 50.5 }],
    [P('pl-new-chair-2', 'inv-dining-chair', 412.5, 636, 0), { w: 51, d: 50.5 }],
    [P('pl-new-chair-3', 'inv-dining-chair', 351.5, 766.5, 180), { w: 51, d: 50.5 }],
    [P('pl-new-chair-4', 'inv-dining-chair', 412.5, 766.5, 180), { w: 51, d: 50.5 }],
    // 거실 오른쪽 벽, 소파 아래: 장난감장 정면 왼쪽(90)
    [P('pl-new-toy', 'inv-toy-storage', 630.5, 786, 90), { w: 66.5, d: 39.5 }],
    // 안방(옷장 없음): 매트리스 머리는 왼쪽 벽, 발치 오른쪽(270) · 화장대·체스트랙은 오른쪽 벽, 정면 왼쪽(90)
    [P('pl-new-bed', 'inv-bed-master', 0, 693, 270), { w: 200, d: 200 }],
    [P('pl-new-vanity', 'inv-vanity', 290, 683, 90), { w: 100, d: 50 }],
    [P('pl-new-chest', 'inv-chest-rack', 297, 783, 90), { w: 45, d: 43 }],
    // 작은방2: 캐비닛장 3종은 왼쪽 벽 아래로 나란히(정면 오른쪽 270) · 책상·알렉스는 오른쪽 벽(정면 왼쪽 90)
    [P('pl-new-cabinet2', 'inv-cabinet-2', 0, 167, 270), { w: 76, d: 50 }],
    [P('pl-new-cabinet-1', 'inv-cabinet', 0, 243, 270), { w: 76, d: 50 }],
    [P('pl-new-cabinet-2', 'inv-cabinet', 0, 319, 270), { w: 76, d: 50 }],
    [P('pl-new-alex', 'inv-desk-drawer', 160, 125, 90), { w: 36, d: 58 }],
    [P('pl-new-desk', 'inv-desk-adult', 158, 161, 90), { w: 120, d: 60 }],
    // 작은방1(아이 방): 오른쪽 벽 어린이책장·책장 5단(90), 왼쪽 벽 어린이책장 2(270), 간이옷장은 아래 벽 문 오른쪽(180)
    [P('pl-new-bookshelf', 'inv-bookshelf', 641.5, 205, 90), { w: 80, d: 28.5 }],
    [P('pl-new-kidshelf-1', 'inv-bookshelf-kid', 641.5, 125, 90), { w: 80, d: 28.5 }],
    [P('pl-new-kidshelf-2', 'inv-bookshelf-kid', 457, 125, 270), { w: 80, d: 28.5 }],
    [P('pl-new-kidshelf-3', 'inv-bookshelf-kid', 457, 205, 270), { w: 80, d: 28.5 }],
    [P('pl-new-hanger', 'inv-hanger', 588, 358, 180), { w: 82, d: 40 }],
  ];
  /* v8~v13 기본 자리 (추정 도면 위 초안) — v14 에서 이 자리에 그대로 있는 배치만 새 초안 자리로 옮겨요 */
  const V8_AT = {
    'pl-new-fridge': [386.5, 239.4, 90], 'pl-new-washer': [250, 10, 0], 'pl-new-dryer': [318.2, 10, 0], 'pl-new-ac': [685.4, 929, 90],
    'pl-new-sofa': [625, 630, 90], 'pl-new-dining': [340, 745, 0], 'pl-new-chair-1': [351.5, 694.5, 0], 'pl-new-chair-2': [412.5, 694.5, 0],
    'pl-new-chair-3': [351.5, 825, 180], 'pl-new-chair-4': [412.5, 825, 180], 'pl-new-toy': [670.5, 813, 90], 'pl-new-bed': [10, 765, 270],
    'pl-new-vanity': [10, 630, 0], 'pl-new-chest': [120, 630, 0], 'pl-new-cabinet2': [10, 156, 270], 'pl-new-cabinet-1': [10, 242, 270],
    'pl-new-cabinet-2': [10, 328, 270], 'pl-new-alex': [172, 155, 90], 'pl-new-desk': [170, 201, 90], 'pl-new-bookshelf': [681.5, 195, 90],
    'pl-new-kidshelf-1': [681.5, 285, 90], 'pl-new-kidshelf-2': [480, 165, 270], 'pl-new-kidshelf-3': [480, 255, 270], 'pl-new-hanger': [575, 370, 180],
  };
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
  /* 함께 놓여야 하는 배치: 의자는 식탁(pl-new-dining)이 초안 자리에 있을 때만 더해요 (식탁 없이 의자만 거실에 떠 있지 않게) */
  const NEEDS = { 'pl-new-chair-1': 'pl-new-dining', 'pl-new-chair-2': 'pl-new-dining', 'pl-new-chair-3': 'pl-new-dining', 'pl-new-chair-4': 'pl-new-dining' };
  function rules(list, key) {
    // fixFront: v8 전에 놓은 배치(초안이 옮기지 않은 것)의 rot 0·90 을 등을 댄 벽을 보고 정면으로 한 번 정해요 (core frontFromWall)
    const out = { add: [], move: {}, fixFront: true };
    list.forEach(([p, size]) => {
      const was = V7_AT[key][p.id];
      const clear = clearOf(p, size, key);
      if (was) {
        // move 도 새 자리에 다른 배치가 있으면 옮기지 않아요 (core). clear 는 뒤에 더하는 초안이 이 짐의 앞을 막지 않게 하는 데 써요
        if (was.x !== p.x || was.y !== p.y || was.rot !== p.rot) out.move[p.id] = Object.assign({ from: was, set: { x: p.x, y: p.y, rot: p.rot }, ifInv: size || undefined }, clear ? { clear } : {});
      } else if (key === 'new') {
        out.add.push(Object.assign({}, p, size ? { ifInv: size } : {}, clear ? { clear } : {}, NEEDS[p.id] ? { needs: NEEDS[p.id] } : {}));
      }
    });
    return out;
  }
  if (MV.seed && Array.isArray(MV.seed.migrations)) {
    MV.seed.migrations.push({ to: 8, layouts: { new: rules(NEW, 'new'), old: rules(OLD, 'old') } });
  }
  /* v14: 새 집 도면을 10/24 실측으로 다시 그림 → v8 초안 자리에 그대로 있는 배치만 새 자리로 (사용자가 옮긴 배치·크기를 고친 짐은 그대로) */
  if (MV.seed && Array.isArray(MV.seed.migrations)) {
    const move = {};
    NEW.forEach(([p, size]) => {
      const was = V8_AT[p.id];
      if (!was) return;
      move[p.id] = { from: { x: was[0], y: was[1], rot: was[2] }, set: { x: p.x, y: p.y, rot: p.rot }, ifInv: size || undefined };
    });
    MV.seed.migrations.push({ to: 14, layouts: { new: { add: [], move } } });
  }
})();
