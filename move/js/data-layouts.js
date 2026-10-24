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
     v8~v13 기본 자리(V8_AT)에 그대로 있는 배치만 v14 자리로 옮겨요(to: 14 move 규칙 — 사용자가 옮긴 배치는 그대로).
   - v15(같은 날 저녁 가족 실측표 + 배치 가이드): v14 초안 자리(V14_AT)에 그대로 있는 배치만 아래 새 자리로 옮기고(move),
     v15 에 처음 생긴 배치(전자레인지 수납장·쓰레기통·빨래바구니·트롤리 2개·어린이 책상 세트·리빙박스 등)는 더해요(add).
   - v16(10/24 저녁 가족 배치): 가족이 공유 버전에서 직접 옮긴 배치(공유 기록 그대로)를 기본 배치(NEW16)로 쓰고 틈·쓰임 공간만 미세 조정.
     to: 16 move 규칙 두 개 — v15 초안 자리(NEW15)에 그대로 있는 배치는 v16 자리로, 가족이 옮긴 자리(FAMILY_AT)에 그대로 있는 배치는
     미세 조정한 자리로 옮겨요(사용자가 다르게 옮긴 배치는 그대로). NEW15 는 v8·v14·v15 규칙이 쓰는 목록이라 얼려 둬요(고치지 않음).
   - v17(10/24 밤 가족 배치 + 작은방1·작은방2 가구 맞바꿈): 가족이 다시 옮긴 배치를 미세 조정 없이 그대로 쓰고, 가족 요청으로 두 작은방
     가구를 맞바꿨어요(NEW = NEW16 + V17). to: 17 move 규칙 — v16 기본 자리(NEW16)에 그대로 있는 배치만 v17 자리로. NEW16 도 얼려 둬요.

   ── 새 집 기본 배치 v17 (10/24 밤 가족 배치 + 작은방1·작은방2 가구 맞바꿈) — 근거 ─────────────────────
     규칙(v15 그대로, 가족 말 '이제 정확한 실측값이라 10cm씩 띄울 필요 없어'): 오차 여유 없이 벽·다른 가구에 붙여도 돼요.
       제조사·쓰임에 필요한 틈(냉장고 뒤 약 5cm, 통돌이·건조기 뒤 10cm(호스·배기), 에어컨 옆 10cm)은 권장값 — v17 은 가족 자리 그대로라
       냉장고·통돌이 뒤와 에어컨 옆이 벽에 붙어 있어요(설치 때 기사와 확인 — 냉장고를 띄우면 그만큼 식탁 쪽으로 나와요).
       쓰임 공간(앞) = 가족 실측표 둘째 칸(문·서랍을 연 앞뒤 전체 길이) − 몸체 깊이: 캐비닛장 39, 화장대 30, 체스트랙 38, 장난감장 43,
       알렉스 56, 간이 행거 68, 냉장고 50, 건조기 55, 전자레인지 수납장 34, 어린이 책상 세트 55(의자 빼면). 식탁 의자는 놓인 50cm가 곧 빼는 자리.
       가족이 다시 옮긴 자리(v16 → v17, 미세 조정 없음): 건조기 x 10 → 20 · 전자레인지 수납장 x 190 → 185 · 통돌이 x 315 → 325(오른쪽 벽에 붙임) ·
       냉장고 x 338 → 343(뒤 벽에 붙임), y 352 → 345(식탁 모서리와 통로 57) · 에어컨 y 843 → 853(아래 벽에 붙임) ·
       안방 체스트랙 ↔ 캐비닛장 ② 맞바꿈(캐비닛장 ① y 669·745 → 660·740). 소파 y 663 · 트롤리 3단 y 618 · 리빙박스 줄은 v16 그대로.
       그 뒤 가족 요청으로 작은방1 ↔ 작은방2 가구 맞바꿈 — 두 방은 문이 반대쪽이라 좌우를 뒤집어 옮겼어요(벽에서 떨어진 거리는 그대로).
     세탁 발코니(0~395 × 0~125): 깊이 125라 위 벽에 나란히 두면 건조기(깊이 90) 앞이 약 35cm → 건조기는 옆으로. 냉장고는 여기 없어요.
           건조기 왼쪽 끝, 정면 오른쪽(270 = 주방 문 쪽) x 20~110, y 20~90 — 뒤(왼쪽 벽) 20 배기·호스, 앞 전자레인지 수납장까지 75(문 열림 55) ·
           전자레인지 수납장 창 쪽 벽, 정면 아래(0 = 주방 문 쪽) x 185~245, y 0~41 — 앞 34, 위에 전자레인지 ·
           통돌이 70x73 칸(튀어나온 곳 위), 정면 왼쪽(90) x 325~395, y 0~64 — 오른쪽 벽에 붙임(뒤 호스 자리 0 — 권장 10이라 배송·설치 때
           기사와 확인하고 필요하면 10cm쯤 앞으로), 앞(왼쪽)은 전자레인지 수납장까지 약 80.
     주방(218~438 × 125~398): 냉장고 조리대(싱크대) 끝에 같은 방향, 정면 왼쪽(90 = 식탁 쪽) x 343~438, y 345~436 — 뒤 벽에 붙임, 조리대와 10 띄움.
           식탁 모서리 ↔ 냉장고 통로 약 57cm(주방·세탁 발코니로 드나드는 유일한 길). 복도 쪽으로 약 38cm 나와요(복도 약 1.3m 남음).
           식탁 긴 변을 왼쪽 벽에(90) x 218~298, y 175~310 · 의자 ㄷ자 — 위 1(0) x 218~263, y 125~175 · 통로 쪽 2(90) x 298~348, y 190~235·250~295 ·
           아래 1(180) x 218~263, y 310~360 — 가족 배치대로 왼쪽 벽 쪽: 빼 두면 작은방2 문 앞을 막고, 식사 뒤 식탁 밑에 넣으면 문 앞에 약 17cm만.
           왼쪽 벽 막힘 없는 길이 130 < 식탁 135 → 식탁 모서리 5cm가 작은방2 문 앞. 쓰레기통 오른쪽 위 구석(0) x 341~368, y 125~142.
     복도: 빨래바구니 욕실 문 바로 위 벽(270) x 218~253, y 465~505.
     거실(340~670 × 563~893): 왼쪽(안방 쪽) 벽, 정면 오른쪽(270) x 340~369 — 어린이 책장 3개 y 563·645·730 + 맨 아래 책장 5단 y 813~893
           (4개 320cm — 왼쪽 벽 실측 320, 그림 330이라 꼭 맞는지 확인) · 오른쪽 벽 위에서부터(정면 왼쪽 90) 트롤리 3단 x 637~670, y 618~663 ·
           소파 x 587~670, y 663~833 · 에어컨 스탠드 x 640~670, y 853~893(아래 벽에 붙임 — 옆 10 없음, 소파와 20) — 바람은 분합문을 따라 왼쪽.
           스탠드 배관구(추정, 거실 왼쪽 아래 x 366, y 881)에서 약 2.6m → 배관 연장 비용·배관 구멍 위치는 설치 기사에게.
     안방(0~340 × 593~893): 왼쪽 벽 한 줄(270) 위에서부터 체스트랙 x 0~40, y 593~655 · 캐비닛장 ① y 660~736·740~816 · 캐비닛장 ② y 817~893
           (x 0~52, 아래 벽에 붙음 — 벽걸이 배관구(추정, x 0, y 881)는 캐비닛장 ② 뒤) ·
           매트리스 오른쪽·아래 벽에 붙여(180) x 135~340, y 688~893, 머리는 창 쪽 — 발치가 안방 문 열림 범위와 겹쳐요(문짝은 5cm 떨어져 닫힘).
     작은방1(457~670 × 125~398, 현관 쪽): 오른쪽(바깥) 벽 위에서부터(정면 왼쪽 90) 화장대 x 623~670, y 145~230 · 알렉스 x 611~670, y 230~267 ·
           데스커 책상 x 610~670, y 278~398(의자 빼는 자리(앞 75)가 문 열림 범위와 15cm — 문을 활짝 열 때 의자를 조금 당김) ·
           이동식 간이 행거(지금 쓰는 간이옷장, 85×47×147.6 — 높이는 가족 확인, 일루일루 마르 스탠드 행거) 왼쪽 위(창 쪽 끝),
           정면 오른쪽(270) x 457~504, y 135~220 — 창에서 10cm(겨울 결로), 앞 68. 키 147.6이라 창 왼쪽 끝 약 24cm를 가려요
           (위 발코니로 나가는 창이 바닥까지 문인지 확인 — 리빙박스를 넣고 빼는 길).
     작은방2(0~218 × 125~395, 욕실 쪽 — 아이 방): 오른쪽(주방) 벽 위에서부터(정면 왼쪽 90) 장난감장 x 177~218, y 125~192 ·
           어린이 책상 세트 x 158~218, y 195~275(가로 80 × 깊이 60 — 가족이 고친 크기, 의자 빼면 앞 55) ·
           왼쪽 아래 구석 트롤리 2단, 정면 위(180) x 0~45, y 362~395. 장난감장(높이 110)이 창 오른쪽 끝 약 33cm를 가려요.
     위 발코니(453~670 × 0~125): 리빙박스 10개를 쌓아요(v17) — 왼쪽 벽 x 453~493 · 오른쪽 벽 x 630~670, 둘 다 y 36~89, 5개씩(높이 약 150cm, n = 5).
     전면 발코니·다용도실: 짐 없음(실외기 자리만 — data-plans.js 고정물).
     점검 결과: ⛔ 0 · ⚠️ 7 — ① 냉장고가 주방 경계를 넘어 복도로(가족 선택) ② 식탁 모서리 5cm ↔ 작은방2 문 앞 ③ 아래 식탁 의자 ↔ 작은방2 문 앞
           (빼 둘 때 — 식탁 밑에 넣으면 괜찮음) ④ 통돌이 뒤 호스 자리 10cm 없음(벽에 붙임) ⑤ 에어컨 스탠드 옆 10cm 없음(아래 벽에 붙임)
           ⑥ 매트리스 발치 ↔ 안방 문 열림 범위 ⑦ 데스커 책상 의자 빼는 자리 ↔ 작은방1 문 열림 범위 15cm.
           💡 에어컨 스탠드가 배관구에서 약 2.6m.
     이사 날 순서: 건조기·전자레인지 수납장을 식탁·냉장고보다 먼저 세탁 발코니에(그 뒤엔 주방 통로 약 57 < 건조기 폭 70).
           통돌이 배송 날(11/4~11/6)은 식탁·의자를 잠깐 옆으로 비켜요(세탁기 폭 64).
     놓지 않은 것: 이사 뒤 살 간이 옷장(inv-wardrobe-new, 선택), 간이박스 6개(캐비닛장·어린이 책장 위에 얹음), 전자레인지(수납장 위),
           고장 세탁기(버림).
   ── 지금 집 ── 냉장고·스탠드만 새 크기에 맞게 옮김 (냉장고 뒤 10cm, 스탠드 구석 3cm · 정면은 거실 쪽 위(180)). 다용도실 보일러·문 열림 범위를 비움.
   ============================================================ */
(function () {
  'use strict';
  const P = (id, invId, x, y, rot) => ({ id, invId, x, y, rot: rot || 0 });
  // 새 집 배치 초안 v15 (10/24 실측 도면 + 같은 날 가족 실측표·배치 가이드) — [배치, 짐 크기 { w, d }]
  // v8·v14·v15 이전 규칙이 쓰는 목록이라 그대로 둬요 (지금 기본 배치는 아래 NEW — v17)
  const NEW15 = [
    // 세탁 발코니 왼쪽 끝 옆벽: 냉장고 정면 오른쪽(270) — 가족 말 '세탁기·건조기를 넣어도 발코니에 들어가면 발코니'. 창 쪽 옆 10cm
    [P('pl-new-fridge', 'inv-fridge', 5, 10, 270), { w: 91, d: 95 }],
    // 세탁 발코니 가운데: 건조기 정면 오른쪽(주방 문 쪽) — 주방 문(x 245~) 왼쪽에서 끝
    [P('pl-new-dryer', 'inv-dryer', 155, 0, 270), { w: 70, d: 90 }],
    // 70x73 칸(튀어나온 곳 위): 통돌이 정면 왼쪽, 뒤 호스 10cm 남기려 칸보다 10cm 앞으로
    [P('pl-new-washer', 'inv-washer-new', 315, 0, 90), { w: 64, d: 70 }],
    // 주방 왼쪽 벽에 식탁 긴 변(가족 가이드) — 의자는 ㄷ자(위 1·통로 쪽 2·아래 1). 가족 말: 의자는 식탁에서 최대 50cm(의자 폭) — 통로 150 = 식탁 80 + 의자 50 + 조리대까지 20
    [P('pl-new-dining', 'inv-dining', 218, 175, 90), { w: 135, d: 80 }],
    [P('pl-new-chair-1', 'inv-dining-chair', 218, 125, 0), { w: 45, d: 50 }],
    [P('pl-new-chair-2', 'inv-dining-chair', 298, 190, 90), { w: 45, d: 50 }],
    [P('pl-new-chair-3', 'inv-dining-chair', 298, 250, 90), { w: 45, d: 50 }],
    [P('pl-new-chair-4', 'inv-dining-chair', 263, 310, 180), { w: 45, d: 50 }],
    // 70x75 칸: 전자레인지 수납장을 조리대 줄에 이어 정면 왼쪽(냉장고가 발코니로 가서)
    [P('pl-new-mwcab', 'inv-microwave-cabinet', 397, 335, 90), { w: 60, d: 41 }],
    // 주방 오른쪽 위 구석(인덕션 앞 귀퉁이 — 걸리면 옮겨요)
    [P('pl-new-trash', 'inv-trash', 341, 125, 0), { w: 27, d: 17 }],
    // 복도: 욕실 문 바로 위 벽
    [P('pl-new-basket', 'inv-laundry-basket', 218, 465, 270), { w: 40, d: 35 }],
    // 거실 왼쪽(안방) 벽: 어린이책장 3개, 정면 오른쪽
    [P('pl-new-kidshelf-1', 'inv-bookshelf-kid', 340, 563, 270), { w: 80, d: 29 }],
    [P('pl-new-kidshelf-2', 'inv-bookshelf-kid', 340, 643, 270), { w: 80, d: 29 }],
    [P('pl-new-kidshelf-3', 'inv-bookshelf-kid', 340, 723, 270), { w: 80, d: 29 }],
    // 거실 왼쪽 아래 구석(가족 가이드), 바람은 분합문을 따라 오른쪽
    [P('pl-new-ac', 'inv-ac-stand', 340, 843, 270), { w: 40, d: 30 }],
    // 거실 오른쪽 벽: 위에서부터 책장 5단 · 소파 · 트롤리 3단(정면 왼쪽)
    [P('pl-new-bookshelf', 'inv-bookshelf', 641, 563, 90), { w: 80, d: 29 }],
    [P('pl-new-sofa', 'inv-sofa', 587, 643, 90), { w: 170, d: 83 }],
    [P('pl-new-trolley3', 'inv-trolley-3', 637, 813, 90), { w: 45, d: 33 }],
    // 안방 왼쪽 벽 한 줄: 캐비닛장 3개 + 체스트랙(정면 오른쪽) · 매트리스는 오른쪽·아래 벽에 붙여 머리는 창 쪽
    [P('pl-new-cabinet2', 'inv-cabinet-2', 0, 593, 270), { w: 76, d: 52 }],
    [P('pl-new-cabinet-1', 'inv-cabinet', 0, 669, 270), { w: 76, d: 52 }],
    [P('pl-new-cabinet-2', 'inv-cabinet', 0, 745, 270), { w: 76, d: 52 }],
    [P('pl-new-chest', 'inv-chest-rack', 0, 831, 270), { w: 62, d: 40 }],
    [P('pl-new-bed', 'inv-bed-master', 135, 688, 180), { w: 205, d: 205 }],
    [P('pl-new-vanity', 'inv-vanity', 171, 125, 90), { w: 85, d: 47 }],
    [P('pl-new-hanger', 'inv-hanger', 0, 310, 270), { w: 85, d: 47 }],
    [P('pl-new-trolley2', 'inv-trolley-2', 637, 297, 90), { w: 45, d: 33 }],
    // 작은방2: 데스커 책상·알렉스는 왼쪽 벽, 화장대는 창 아래 오른쪽, 간이옷장은 왼쪽 아래
    [P('pl-new-desk', 'inv-desk-adult', 0, 125, 270), { w: 120, d: 60 }],
    [P('pl-new-alex', 'inv-desk-drawer', 0, 245, 270), { w: 37, d: 59 }],
    // 작은방1: 어린이 책상 세트는 창에서 떨어진 왼쪽 벽(정면 오른쪽), 장난감장·트롤리 2단은 오른쪽 벽
    [P('pl-new-kid-desk', 'inv-kid-desk', 457, 185, 270), { w: 60, d: 80 }],
    [P('pl-new-toy', 'inv-toy-storage', 629, 230, 90), { w: 67, d: 41 }],
    // 위 발코니(가족 말 '우측 상단 발코니'): 리빙박스 10개 — 4 + 4 + 2 줄
    [P('pl-new-box-1', 'inv-living-box', 455, 0, 0), { w: 53, d: 40 }],
    [P('pl-new-box-2', 'inv-living-box', 508, 0, 0), { w: 53, d: 40 }],
    [P('pl-new-box-3', 'inv-living-box', 561, 0, 0), { w: 53, d: 40 }],
    [P('pl-new-box-4', 'inv-living-box', 614, 0, 0), { w: 53, d: 40 }],
    [P('pl-new-box-5', 'inv-living-box', 455, 40, 0), { w: 53, d: 40 }],
    [P('pl-new-box-6', 'inv-living-box', 508, 40, 0), { w: 53, d: 40 }],
    [P('pl-new-box-7', 'inv-living-box', 561, 40, 0), { w: 53, d: 40 }],
    [P('pl-new-box-8', 'inv-living-box', 614, 40, 0), { w: 53, d: 40 }],
    [P('pl-new-box-9', 'inv-living-box', 455, 80, 0), { w: 53, d: 40 }],
    [P('pl-new-box-10', 'inv-living-box', 508, 80, 0), { w: 53, d: 40 }],
  ];
  // 새 집 배치 v16 — 가족이 공유 버전에서 직접 옮긴 배치(10/24 저녁 그림·공유 기록)를 그대로 쓰고 쓰임 공간만 미세 조정
  // (v16 이전 규칙이 쓰는 목록이라 얼려 둬요 — 지금 기본 배치는 아래 NEW = v17)
  const NEW16 = [
    // 세탁 발코니: 건조기 왼쪽(정면 오른쪽) — 뒤 배기·호스 10cm 띄움(가족 배치 x 0 → 10) · 전자레인지 수납장 가운데 창 쪽 벽(정면 아래) ·
    // 통돌이 70x73 칸(정면 왼쪽, 뒤 호스 10cm)
    [P('pl-new-dryer', 'inv-dryer', 10, 20, 270), { w: 70, d: 90 }],
    [P('pl-new-mwcab', 'inv-microwave-cabinet', 190, 0, 0), { w: 60, d: 41 }],
    [P('pl-new-washer', 'inv-washer-new', 315, 0, 90), { w: 64, d: 70 }],
    // 주방: 냉장고는 조리대(싱크대) 끝에 붙여 같은 방향(정면 왼쪽) — 뒤 5cm(가족 배치 x 343 → 338), 식탁 모서리와 냉장고 사이 통로 58cm
    // (가족 배치 y 345 → 352 — 주방·세탁 발코니로 드나드는 유일한 길). 복도 쪽으로 약 45cm 나와요
    [P('pl-new-fridge', 'inv-fridge', 338, 352, 90), { w: 91, d: 95 }],
    // 식탁은 왼쪽 벽에 긴 변, 의자 ㄷ자(위 1·통로 쪽 2·아래 1 — 아래 의자는 가족 배치대로 왼쪽 벽 쪽: 작은방2 문 앞이라 식사 뒤엔 식탁 밑으로)
    [P('pl-new-dining', 'inv-dining', 218, 175, 90), { w: 135, d: 80 }],
    [P('pl-new-chair-1', 'inv-dining-chair', 218, 125, 0), { w: 45, d: 50 }],
    [P('pl-new-chair-2', 'inv-dining-chair', 298, 190, 90), { w: 45, d: 50 }],
    [P('pl-new-chair-3', 'inv-dining-chair', 298, 250, 90), { w: 45, d: 50 }],
    [P('pl-new-chair-4', 'inv-dining-chair', 218, 310, 180), { w: 45, d: 50 }],
    [P('pl-new-trash', 'inv-trash', 341, 125, 0), { w: 27, d: 17 }],
    // 복도: 빨래바구니 욕실 문 바로 위 벽
    [P('pl-new-basket', 'inv-laundry-basket', 218, 465, 270), { w: 40, d: 35 }],
    // 거실 왼쪽(안방 쪽) 벽: 어린이 책장 3개 + 맨 아래 책장 5단(정면 오른쪽)
    [P('pl-new-kidshelf-1', 'inv-bookshelf-kid', 340, 563, 270), { w: 80, d: 29 }],
    [P('pl-new-kidshelf-2', 'inv-bookshelf-kid', 340, 645, 270), { w: 80, d: 29 }],
    [P('pl-new-kidshelf-3', 'inv-bookshelf-kid', 340, 730, 270), { w: 80, d: 29 }],
    [P('pl-new-bookshelf', 'inv-bookshelf', 340, 813, 270), { w: 80, d: 29 }],
    // 거실 오른쪽 벽(정면 왼쪽): 위에서부터 트롤리 3단 · 소파 · 에어컨 스탠드(아래 벽에서 10cm — 가족 배치 y 853 → 843, 소파·트롤리도 그만큼 위로)
    [P('pl-new-trolley3', 'inv-trolley-3', 637, 618, 90), { w: 45, d: 33 }],
    [P('pl-new-sofa', 'inv-sofa', 587, 663, 90), { w: 170, d: 83 }],
    [P('pl-new-ac', 'inv-ac-stand', 640, 843, 90), { w: 40, d: 30 }],
    // 안방 왼쪽 벽 한 줄: 캐비닛장 3개 + 체스트랙(정면 오른쪽) · 매트리스 오른쪽·아래 벽(머리는 창 쪽)
    [P('pl-new-cabinet2', 'inv-cabinet-2', 0, 593, 270), { w: 76, d: 52 }],
    [P('pl-new-cabinet-1', 'inv-cabinet', 0, 669, 270), { w: 76, d: 52 }],
    [P('pl-new-cabinet-2', 'inv-cabinet', 0, 745, 270), { w: 76, d: 52 }],
    [P('pl-new-chest', 'inv-chest-rack', 0, 831, 270), { w: 62, d: 40 }],
    [P('pl-new-bed', 'inv-bed-master', 135, 688, 180), { w: 205, d: 205 }],
    // 작은방2 왼쪽 벽(정면 오른쪽): 위에서부터 화장대 · 알렉스 · 데스커 책상 · 오른쪽 위(창 쪽 끝) 이동식 간이 행거(정면 왼쪽)
    [P('pl-new-vanity', 'inv-vanity', 0, 145, 270), { w: 85, d: 47 }],
    [P('pl-new-alex', 'inv-desk-drawer', 0, 230, 270), { w: 37, d: 59 }],
    [P('pl-new-desk', 'inv-desk-adult', 0, 275, 270), { w: 120, d: 60 }],
    [P('pl-new-hanger', 'inv-hanger', 171, 135, 90), { w: 85, d: 47 }],   // 창(작은방2 위 벽)에서 10cm — 겨울 결로
    // 작은방1: 왼쪽 벽 위에서부터 장난감장 · 어린이 책상 세트(가로 80 × 깊이 60 — 가족이 고친 크기) · 오른쪽 아래 구석 트롤리 2단(정면 위)
    [P('pl-new-toy', 'inv-toy-storage', 457, 125, 270), { w: 67, d: 41 }],
    [P('pl-new-kid-desk', 'inv-kid-desk', 457, 195, 270), { w: 80, d: 60 }],
    [P('pl-new-trolley2', 'inv-trolley-2', 625, 365, 180), { w: 45, d: 33 }],
    // 위 발코니(가족 말 '우측 상단 발코니'): 리빙박스 10개 — 4 + 4 + 2 줄
    [P('pl-new-box-1', 'inv-living-box', 455, 0, 0), { w: 53, d: 40 }],
    [P('pl-new-box-2', 'inv-living-box', 508, 0, 0), { w: 53, d: 40 }],
    [P('pl-new-box-3', 'inv-living-box', 561, 0, 0), { w: 53, d: 40 }],
    [P('pl-new-box-4', 'inv-living-box', 614, 0, 0), { w: 53, d: 40 }],
    [P('pl-new-box-5', 'inv-living-box', 455, 40, 0), { w: 53, d: 40 }],
    [P('pl-new-box-6', 'inv-living-box', 508, 40, 0), { w: 53, d: 40 }],
    [P('pl-new-box-7', 'inv-living-box', 561, 40, 0), { w: 53, d: 40 }],
    [P('pl-new-box-8', 'inv-living-box', 614, 40, 0), { w: 53, d: 40 }],
    [P('pl-new-box-9', 'inv-living-box', 455, 80, 0), { w: 53, d: 40 }],
    [P('pl-new-box-10', 'inv-living-box', 508, 80, 0), { w: 53, d: 40 }],
  ];
  /* 새 집 배치 v17 — 10/24 밤 가족이 공유 버전에서 다시 옮긴 배치(그림·공유 기록 그대로, 미세 조정 없음). v16 에서 바뀐 자리만 적어요:
     세탁 발코니 — 건조기 뒤(왼쪽 벽) 20cm · 전자레인지 수납장 x 185 · 통돌이는 70x73 칸 오른쪽 벽에 붙여(뒤 호스 자리 없음 — 설치 때 확인)
     주방 — 냉장고 x 343, y 345(뒤 벽에 붙임, 조리대와 10cm, 복도 쪽으로 38cm, 식탁 모서리와 통로 약 57cm)
     거실 — 에어컨 스탠드 아래 벽에 붙임(y 853, 소파와 20cm)
     안방 왼쪽 벽 위에서부터 — 체스트랙 · 캐비닛장 ① · 캐비닛장 ① · 캐비닛장 ②(아래 벽에 붙임)
     작은방1 ↔ 작은방2 가구 맞바꿈(가족 요청) — 두 방은 문이 서로 반대쪽이라 좌우를 뒤집어 옮겨요(벽에서 떨어진 거리는 그대로):
       작은방1(현관 쪽) ← 화장대·알렉스·데스커 책상(오른쪽 벽, 정면 왼쪽, 위에서부터) · 이동식 간이 행거(왼쪽 위, 창에서 10, 정면 오른쪽)
       작은방2(욕실 쪽) ← 장난감장·어린이 책상 세트(오른쪽 벽 위에서부터, 정면 왼쪽) · 트롤리 2단(왼쪽 아래 구석, 정면 위) */
  const V17 = {
    'pl-new-dryer': [20, 20, 270], 'pl-new-mwcab': [185, 0, 0], 'pl-new-washer': [325, 0, 90], 'pl-new-fridge': [343, 345, 90], 'pl-new-ac': [640, 853, 90],
    'pl-new-chest': [0, 593, 270], 'pl-new-cabinet-1': [0, 660, 270], 'pl-new-cabinet-2': [0, 740, 270], 'pl-new-cabinet2': [0, 817, 270],
    'pl-new-vanity': [623, 145, 90], 'pl-new-alex': [611, 230, 90], 'pl-new-desk': [610, 278, 90], 'pl-new-hanger': [457, 135, 270],
    'pl-new-toy': [177, 125, 90], 'pl-new-kid-desk': [158, 195, 90], 'pl-new-trolley2': [0, 362, 180],
  };
  /* 리빙박스 10개는 쌓아요(가족 말: 7개씩까지 쌓을 수 있어요) — 위 발코니 왼쪽·오른쪽 벽 가운데에 5개씩(높이 약 150cm).
     위 벽 바깥 창과 아래 벽 작은방1 창(문일 수도)을 피해 벽 가운데에 둬요. 배치 하나에 쌓은 개수 n (core·도면이 개수로 세요) */
  const STACK17 = {
    'pl-new-box-1': { at: [453, 36, 270], merge: ['pl-new-box-2', 'pl-new-box-3', 'pl-new-box-4', 'pl-new-box-5'] },
    'pl-new-box-6': { at: [630, 36, 90], merge: ['pl-new-box-7', 'pl-new-box-8', 'pl-new-box-9', 'pl-new-box-10'] },
  };
  const MERGED17 = new Set(Object.keys(STACK17).reduce((a, k) => a.concat(STACK17[k].merge), []));
  const NEW = NEW16.filter(([p]) => !MERGED17.has(p.id)).map(([p, size]) => {
    const v = V17[p.id], sk = STACK17[p.id];
    if (sk) return [Object.assign(P(p.id, p.invId, sk.at[0], sk.at[1], sk.at[2]), { n: 1 + sk.merge.length }), size];
    return [v ? P(p.id, p.invId, v[0], v[1], v[2]) : p, size];
  });
  /* 10/24 저녁 가족이 공유 버전에서 직접 옮긴 자리(공유 기록 그대로) — v16 에서 이 자리에 그대로 있는 배치만 미세 조정한 자리로 옮겨요 */
  const FAMILY_AT = {
    'pl-new-dryer': [0, 20, 270], 'pl-new-fridge': [343, 345, 90], 'pl-new-ac': [640, 853, 90], 'pl-new-sofa': [587, 675, 90],
    'pl-new-trolley3': [637, 625, 90], 'pl-new-box-10': [510, 85, 0], 'pl-new-hanger': [171, 125, 90],
  };
  /* v14 기본 자리 (실측 도면 첫 초안) — v15 에서 이 자리에 그대로 있는 배치만 새 초안 자리로 옮겨요 */
  const V14_AT = {
    'pl-new-fridge': [223, 175, 270], 'pl-new-washer': [318, 3, 90], 'pl-new-dryer': [10, 3, 270], 'pl-new-ac': [340, 847, 270],
    'pl-new-sofa': [585, 613, 90], 'pl-new-dining': [340, 686.5, 0], 'pl-new-chair-1': [351.5, 636, 0], 'pl-new-chair-2': [412.5, 636, 0],
    'pl-new-chair-3': [351.5, 766.5, 180], 'pl-new-chair-4': [412.5, 766.5, 180], 'pl-new-toy': [630.5, 786, 90], 'pl-new-bed': [0, 693, 270],
    'pl-new-vanity': [290, 683, 90], 'pl-new-chest': [297, 783, 90], 'pl-new-cabinet2': [0, 167, 270], 'pl-new-cabinet-1': [0, 243, 270],
    'pl-new-cabinet-2': [0, 319, 270], 'pl-new-alex': [160, 125, 90], 'pl-new-desk': [158, 161, 90], 'pl-new-bookshelf': [641.5, 205, 90],
    'pl-new-kidshelf-1': [641.5, 125, 90], 'pl-new-kidshelf-2': [457, 125, 270], 'pl-new-kidshelf-3': [457, 205, 270], 'pl-new-hanger': [588, 358, 180],
  };
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
    MV.seed.migrations.push({ to: 8, layouts: { new: rules(NEW15, 'new'), old: rules(OLD, 'old') } });
  }
  /* v14: 새 집 도면을 10/24 실측으로 다시 그림 → v8 초안 자리에 그대로 있는 배치만 새 자리로 (사용자가 옮긴 배치·크기를 고친 짐은 그대로) */
  if (MV.seed && Array.isArray(MV.seed.migrations)) {
    const move = {};
    NEW15.forEach(([p, size]) => {
      const was = V8_AT[p.id];
      if (!was) return;
      move[p.id] = { from: { x: was[0], y: was[1], rot: was[2] }, set: { x: p.x, y: p.y, rot: p.rot }, ifInv: size || undefined };
    });
    MV.seed.migrations.push({ to: 14, layouts: { new: { add: [], move } } });
  }
  /* v15: 10/24 가족 실측표(가구 크기)·배치 가이드로 초안을 다시 짬 → v14 초안 자리에 그대로 있는 배치만 새 자리로, 새 짐은 더해요
     (크기는 같은 버전의 짐 목록 이전 규칙(data-seed.js to: 15, fact)이 먼저 새 값으로 맞춰서 ifInv 는 새 크기) */
  if (MV.seed && Array.isArray(MV.seed.migrations)) {
    const move = {}, add = [];
    NEW15.forEach(([p, size]) => {
      const was = V14_AT[p.id];
      const clear = clearOf(p, size, 'new');
      if (was) {
        if (was[0] !== p.x || was[1] !== p.y || was[2] !== p.rot) move[p.id] = Object.assign({ from: { x: was[0], y: was[1], rot: was[2] }, set: { x: p.x, y: p.y, rot: p.rot }, ifInv: size || undefined }, clear ? { clear } : {});
      } else {
        add.push(Object.assign({}, p, size ? { ifInv: size } : {}, clear ? { clear } : {}, NEEDS[p.id] ? { needs: NEEDS[p.id] } : {}));
      }
    });
    MV.seed.migrations.push({ to: 15, layouts: { new: { add, move } } });
  }
  /* v16: 가족이 직접 옮긴 배치를 기본으로 — ① v15 초안 자리에 그대로 있는 배치는 v16 자리로, ② 가족이 옮긴 자리 그대로인 배치는
     미세 조정한 자리로(냉장고 뒤 5 · 건조기 뒤 10 · 에어컨 옆 10 · 소파·트롤리 3단 · 리빙박스 줄). 크기는 같은 버전의 짐 목록 규칙(fact)이
     먼저 맞춰서 ifInv 는 v16 크기(어린이 책상 세트 80×60). 사용자가 다르게 옮긴 배치는 그대로 둬요 */
  if (MV.seed && Array.isArray(MV.seed.migrations)) {
    const at15 = {};
    NEW15.forEach(([p]) => { at15[p.id] = [p.x, p.y, p.rot]; });
    const moveFrom = (AT) => {
      const move = {};
      NEW16.forEach(([p, size]) => {
        const was = AT[p.id];
        if (!was || (was[0] === p.x && was[1] === p.y && was[2] === p.rot)) return;
        move[p.id] = { from: { x: was[0], y: was[1], rot: was[2] }, set: { x: p.x, y: p.y, rot: p.rot }, ifInv: size || undefined };
      });
      return move;
    };
    MV.seed.migrations.push({ to: 16, layouts: { new: { add: [], move: moveFrom(at15) } } });
    MV.seed.migrations.push({ to: 16, layouts: { new: { add: [], move: moveFrom(FAMILY_AT) } } });
  }
  /* v17: 10/24 밤 가족이 다시 옮긴 배치를 그대로 기본으로 — v16 기본 자리(NEW16)에 그대로 있는 배치만 v17 자리로 옮겨요
     (안방 왼쪽 벽 체스트랙 ↔ 캐비닛장 ②, 작은방1 ↔ 작은방2 가구처럼 서로 자리를 바꾸는 배치도 core 가 후보끼리는 옮긴 뒤 자리로 비교해서 함께 옮겨져요).
     사용자가 다르게 옮긴 배치는 그대로 둬요 */
  if (MV.seed && Array.isArray(MV.seed.migrations)) {
    const at16 = {};
    NEW16.forEach(([p]) => { at16[p.id] = [p.x, p.y, p.rot]; });
    const move = {}, stack = {};
    const at = (id) => ({ x: at16[id][0], y: at16[id][1], rot: at16[id][2] });
    NEW.forEach(([p, size]) => {
      const was = at16[p.id];
      if (!was) return;
      // 리빙박스: 기본 자리에 그대로 있는 10개를 두 무더기로 쌓아요 (하나라도 옮겼으면 그대로)
      if (STACK17[p.id]) {
        const merge = {};
        STACK17[p.id].merge.forEach((id) => { merge[id] = at(id); });
        stack[p.id] = { from: at(p.id), set: { x: p.x, y: p.y, rot: p.rot }, merge, ifInv: size || undefined };
        return;
      }
      if (was[0] === p.x && was[1] === p.y && was[2] === p.rot) return;
      move[p.id] = { from: at(p.id), set: { x: p.x, y: p.y, rot: p.rot }, ifInv: size || undefined };
    });
    MV.seed.migrations.push({ to: 17, layouts: { new: { add: [], move, stack } } });
  }
})();
