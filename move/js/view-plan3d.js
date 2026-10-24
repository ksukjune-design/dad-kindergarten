/* ============================================================
   3D 보기 — 도면 화면의 '🧊 3D로 보기'
   고치기는 2D 도면(view-floorplan.js)에서만 하고, 여기서는 지금 배치를 입체로 돌려 보기만 해요.
   자료  MV.calc.plan3d(key) — 2D 와 같은 값(실측 수정·배치·짐 크기)
   그림  CSS 3D (WebGL 없음): 면 하나 = div 하나, matrix3d 로 자리·방향을 잡아요.
         세계 좌표: x 동(오른쪽) · y 남(아래) · z 위, 1cm = 1px. 위에서 내려다보면 2D 도면과 같은 모양이에요.
         면 = 원점 O + 가로 방향 U · 세로 방향 V (둘 다 단위 벡터), 바깥 법선 N = U × V
   사진  짐마다 인터넷 상품 사진(PHOTOS, 같은·비슷한 모델) — 정면에 붙여요. 못 불러오면(차단·없는 주소) 색 상자로 보여요.
         claude.ai 공유 버전은 바깥 이미지를 막아서 색 상자만 보여요.
   조작  끌기: 돌리기 · 휠/두 손가락: 확대 · 쉬프트+끌기(마우스 오른쪽·두 손가락 끌기): 옮기기 · 짐 누르기: 정보
   제공  MV.plan3d.open(key)
   ============================================================ */
(function () {
  'use strict';
  const { el } = MV;

  /* ---------------- 상수 ---------------- */
  const WALL_H = { full: 230, low: 100, none: 0 };   // 벽 높이: 천장까지 · 낮게 · 숨기기 (cm)
  const WALL_T = 6;           // 붙은 방 사이 벽 두께 (그림용, cm)
  const WIN_SILL = 90, WIN_TOP = 210, DOOR_H = 210;
  const PITCH_MIN = 0, PITCH_MAX = 82;
  /** 짐 사진 (10/24 찾음 — 같은 모델 또는 비슷한 모델의 대표 사진, 쇼핑몰 사정으로 안 보일 수 있어요) */
  const PHOTOS = {
    'inv-fridge': 'https://img.danawa.com/prod_img/500000/485/497/img/16497485_1.jpg',
    'inv-dryer': 'https://img.danawa.com/prod_img/500000/248/808/img/14808248_1.jpg',
    'inv-washer-new': 'https://img.danawa.com/prod_img/500000/177/539/img/18539177_1.jpg',
    'inv-ac-stand': 'https://img.danawa.com/prod_img/500000/662/961/img/77961662_1.jpg',
    'inv-sofa': 'https://www.nitori-net.jp/ecstatic/image/product/2110300049338/211030004933801.jpg',
    'inv-dining': 'https://www.nitori-net.jp/ecstatic/image/product/4008047/400804701.jpg',
    'inv-dining-chair': 'https://www.nitori-net.jp/ecstatic/image/product/2110100015403/211010001540301.jpg',
    'inv-cabinet': 'https://img.danawa.com/prod_img/500000/700/836/img/14836700_1.jpg',
    'inv-cabinet-2': 'https://img.danawa.com/prod_img/500000/239/649/img/14649239_1.jpg',
    'inv-chest-rack': 'https://www.nitori-net.jp/ecstatic/image/product/2190500002241/219050000224101.jpg',
    'inv-hanger': 'https://image.gsshop.com/image/10/70/1070447503_L1.jpg',
    'inv-bookshelf-kid': 'https://image.hanssem.com/hsimg/gds/550/539/539395_A1.jpg',
    'inv-bookshelf': 'https://img.danawa.com/prod_img/500000/979/267/img/6267979_1.jpg',
    'inv-desk-adult': 'https://img.danawa.com/prod_img/500000/910/977/img/8977910_1.jpg',
    'inv-desk-drawer': 'https://www.ikea.com/kr/ko/images/products/alex-drawer-unit-white__0977775_pe813763_s5.jpg',
    'inv-trolley-3': 'https://www.ikea.com/kr/ko/images/products/raskog-trolley-white__1366882_pe957173_s5.jpg',
    'inv-trolley-2': 'https://www.ikea.com/kr/ko/images/products/nissafors-trolley-white__0914715_pe784257_s5.jpg',
    'inv-bed-master': 'https://www.ikea.com/kr/ko/images/products/asvang-foam-mattress-firm-white__0986619_pe818095_s5.jpg',
  };
  /** 바닥에 안 놓고 다른 짐 위에 올리는 짐 → 받침 짐 */
  const ON_TOP = { 'inv-microwave': 'inv-microwave-cabinet' };
  const PRESETS = [['top', '위에서', 0, 0], ['tilt', '비스듬히', 52, -24], ['south', '앞(남)에서', 66, 0], ['north', '뒤(북)에서', 66, 180]];
  const SIDE_SHADE = { top: 0, s: 0.06, w: 0.12, e: 0.18, n: 0.24 };

  const num = (v, d) => { const n = parseFloat(v); return isFinite(n) ? n : d; };
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const r2 = (n) => Math.round(n * 100) / 100;
  const shortName = (s, n) => { const a = Array.from(String(s || '').replace(/\s*\(.*$/, '').replace(/\s*—.*$/, '')); return a.length > n ? a.slice(0, n - 1).join('') + '…' : a.join(''); };

  /* ---------------- 재질 색 ---------------- */
  function colorOf(it) {
    const t = it.tag, c = it.cat;
    if (t === 'chair') return 'var(--p3-wood-dk)';
    if (t === 'table' || t === 'desk' || t === 'vanity') return 'var(--p3-wood)';
    if (t === 'box') return 'var(--p3-box)';
    if (c === 'appliance' || c === 'aircon' || c === 'electronics') return 'var(--p3-white)';
    if (c === 'bed') return 'var(--p3-bed)';
    if (c === 'sofa') return 'var(--p3-fabric)';
    if (c === 'kids') return 'var(--p3-kids)';
    if (c === 'shelf') return 'var(--p3-wood-lt)';
    if (c === 'storage') return t === 'wardrobe' ? 'var(--p3-steel)' : 'var(--p3-wood-lt)';
    return 'var(--p3-misc)';
  }
  const floorOf = (kind) => (kind === 'bath' || kind === 'utility' ? 'var(--p3-wet)' : kind === 'balcony' ? 'var(--p3-balc)' : 'var(--p3-floor)');

  /* ---------------- 면 만들기 ---------------- */
  const M3 = (U, V, O) => {
    const N = [U[1] * V[2] - U[2] * V[1], U[2] * V[0] - U[0] * V[2], U[0] * V[1] - U[1] * V[0]];
    return 'matrix3d(' + [U[0], U[1], U[2], 0, V[0], V[1], V[2], 0, N[0], N[1], N[2], 0, r2(O[0]), r2(O[1]), r2(O[2]), 1].join(',') + ')';
  };
  function face(cls, w, h, U, V, O, o) {
    o = o || {};
    const f = el('div', { class: 'p3-f ' + cls });
    f.style.width = r2(w) + 'px';
    f.style.height = r2(h) + 'px';
    f.style.transform = M3(U, V, O);
    if (o.bg) f.style.background = o.bg;
    if (o.shade) f.style.setProperty('--sh', String(o.shade));
    return f;
  }
  /** 축에 맞춘 상자 (x,y 왼쪽 위 · w 동서 · d 남북 · z0~z1 높이) → 위 + 네 옆면. sides: 그릴 옆면('nsew'), photo: { side, url } */
  function box(world, b, o) {
    o = o || {};
    const { x, y, w, d, z0, z1 } = b;
    const H = z1 - z0;
    const out = [];
    const sides = o.sides || 'nsew';
    const add = (f, side) => { if (o.cls) o.cls.split(' ').forEach((c) => c && f.classList.add(c)); if (o.pid) f.dataset.pid = o.pid; world.appendChild(f); out.push(f); f.dataset.side = side; return f; };
    if (o.top !== false && w > 0 && d > 0) add(face('p3-top', w, d, [1, 0, 0], [0, 1, 0], [x, y, z1], { bg: o.topBg || o.bg, shade: SIDE_SHADE.top }), 'top');
    if (H > 0.2) {
      if (sides.includes('s')) add(face('p3-side', w, H, [1, 0, 0], [0, 0, -1], [x, y + d, z1], { bg: o.bg, shade: SIDE_SHADE.s }), 's');
      if (sides.includes('n')) add(face('p3-side', w, H, [-1, 0, 0], [0, 0, -1], [x + w, y, z1], { bg: o.bg, shade: SIDE_SHADE.n }), 'n');
      if (sides.includes('e')) add(face('p3-side', d, H, [0, -1, 0], [0, 0, -1], [x + w, y + d, z1], { bg: o.bg, shade: SIDE_SHADE.e }), 'e');
      if (sides.includes('w')) add(face('p3-side', d, H, [0, 1, 0], [0, 0, -1], [x, y, z1], { bg: o.bg, shade: SIDE_SHADE.w }), 'w');
    }
    return out;
  }
  /** 바닥(또는 높이 z)에 눕힌 글자 */
  function floorText(world, text, cx, cy, z, size, cls) {
    const w = Math.max(40, Array.from(text).length * size * 1.05 + 10), h = size * 1.6;
    const f = face('p3-label ' + (cls || ''), w, h, [1, 0, 0], [0, 1, 0], [cx - w / 2, cy - h / 2, z]);
    f.style.fontSize = r2(size) + 'px';
    f.textContent = text;
    world.appendChild(f);
    return f;
  }

  /* ---------------- 짐 모양 ---------------- */
  // 짐 안쪽 좌표: lx = 정면에서 볼 때 왼쪽→오른쪽(0..dw), ly = 뒤→앞(0..dd). rot 별로 세계 좌표로 바꿔요.
  const FRONT_SIDE = { 0: 's', 90: 'w', 180: 'n', 270: 'e' };
  function toWorld(it, lx, ly) {
    const { x, y, rot, dw, dd } = it;
    if (rot === 180) return [x + dw - lx, y + dd - ly];
    if (rot === 90) return [x + (dd - ly), y + lx];
    if (rot === 270) return [x + ly, y + (dw - lx)];
    return [x + lx, y + ly];
  }
  /** 짐 안쪽 상자(lx, ly, lw, ld) → 세계 상자 */
  function localBox(it, lx, ly, lw, ld, z0, z1) {
    const a = toWorld(it, lx, ly), b = toWorld(it, lx + lw, ly + ld);
    return { x: Math.min(a[0], b[0]), y: Math.min(a[1], b[1]), w: Math.abs(b[0] - a[0]), d: Math.abs(b[1] - a[1]), z0, z1 };
  }
  function shapeOf(it) {
    const t = it.tag, n = it.name || '';
    if (t === 'chair' || /의자/.test(n) && it.cat === 'sofa' && it.dw <= 70) return 'chair';
    if (t === 'table' || t === 'desk') return 'table';
    if (t === 'sofa' || (it.cat === 'sofa' && it.dw > 100)) return 'sofa';
    if (t === 'bed' || it.cat === 'bed') return 'bed';
    return 'box';
  }
  function photoOf(it) {
    const u = it.img || PHOTOS[it.invId] || '';
    return /^https:\/\//.test(u) ? u : '';
  }
  /** 정면에 사진 붙이기 — 못 불러오면 사진만 빼요(색 상자 그대로) */
  function putPhoto(f, url, fit) {
    if (!f || !url) return;
    const img = el('img', { class: 'p3-photo', alt: '', loading: 'lazy', decoding: 'async', referrerpolicy: 'no-referrer', draggable: 'false' });
    if (fit) img.style.objectFit = fit;
    img.addEventListener('error', () => { img.remove(); f.classList.remove('has-photo'); }, { once: true });
    img.src = url;
    f.classList.add('has-photo');
    f.appendChild(img);
  }
  /* ---------------- 문·서랍 열기 (열림 보기) ----------------
     it.open = { kind, need(정면 쓰임 공간 cm), free(벽·다른 가구·설비에 닿기 전까지 열 수 있는 cm), by(처음 닿는 것), top }
     · 여닫이(hinged)·앞문(front-door): 문짝을 경첩에서 바깥으로 — 앞이 free 만큼만 비면 그만큼만(조금) 열어요(θ = asin(free / 문짝 폭))
       문짝 수: 정면 쓰임 공간이 폭의 절반보다 크면 한 짝(건조기), 아니면 두 짝(옷장·냉장고 양문)
     · 서랍(drawer): 위 서랍 하나를 free 만큼 빼요(장난감장은 수납함 한 칸)
     · 뚜껑(lid): 통돌이 뚜껑을 뒤쪽 경첩에서 위로
     · 의자(seat): 닫힘은 식탁 밑으로 넣은 모습, 열림은 빼 둔 모습(도면 자리 그대로)
     · 어린이 책상 세트: 의자를 책상 밑에 넣음 / free 만큼 뺌 */
  const DOOR_KINDS = ['hinged', 'front-door'];
  const openAmount = (op) => (op ? Math.max(0, Math.min(op.free, op.need)) : 0);
  const limited = (op) => !!op && op.free < op.need - 0.5;
  function tagFace(f, o, extra) {
    if (o.cls) o.cls.split(' ').forEach((c) => c && f.classList.add(c));
    if (extra) f.classList.add(extra);
    if (o.pid) f.dataset.pid = o.pid;
    return f;
  }
  /** 문짝 하나: 정면 선(ly = dd) 위 경첩 hx 에서 dir(+1: 오른쪽으로 닫힘 · −1: 왼쪽으로 닫힘) 쪽 문짝을 θ 만큼 앞으로 연 모습 */
  function leaf(world, it, o, hx, dir, len, theta, z0, z1, cls) {
    const a = toWorld(it, hx, it.dd), b = toWorld(it, hx + dir * len * Math.cos(theta), it.dd + len * Math.sin(theta));
    const dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy) || 1;
    const f = face('p3-leaf', len, Math.max(1, z1 - z0), [dx / L, dy / L, 0], [0, 0, -1], [a[0], a[1], z1], { bg: o.bg });
    world.appendChild(tagFace(f, o, cls));
    return f;
  }
  /** 뚜껑: 뒤(ly = 3) 경첩에서 위로 θ 만큼 연 판 */
  function lid(world, it, o, theta, zTop) {
    const p0 = toWorld(it, 3, 3), px = toWorld(it, 4, 3), py = toWorld(it, 3, 4);
    const U = [px[0] - p0[0], px[1] - p0[1], 0], ly = [py[0] - p0[0], py[1] - p0[1]];
    const V = [ly[0] * Math.cos(theta), ly[1] * Math.cos(theta), Math.sin(theta)];
    const f = face('p3-leaf p3-lid', Math.max(1, it.dw - 6), Math.max(1, it.dd - 6), U, V, [p0[0], p0[1], zTop + 0.6], { bg: 'var(--p3-glass)' });
    world.appendChild(tagFace(f, o));
    return f;
  }
  function addOpen(world, it, o, faces, ctx) {
    const op = it.open;
    if (!op) return [];
    const z0 = it.z0 || 0, H = Math.max(3, it.hgt);
    const amt = openAmount(op);
    const cls = limited(op) ? 'is-limited' : '';
    const out = [];
    const front = faces.find((f) => f.dataset.side === FRONT_SIDE[it.rot]);
    if (DOOR_KINDS.includes(op.kind)) {
      const single = op.need > it.dw / 2 + 8;
      const len = single ? Math.min(op.need, it.dw - 4) : it.dw / 2 - 1;
      const theta = Math.asin(Math.min(1, amt / Math.max(1, len)));
      // 세탁기·건조기 둥근 문은 가운데 높이만, 나머지는 거의 전체 높이
      const za = single && it.cat === 'appliance' ? z0 + H * 0.18 : z0 + 2, zb = single && it.cat === 'appliance' ? z0 + H * 0.82 : z0 + H - 2;
      if (front && theta > 0.02) { front.classList.add('is-inside'); const img = front.querySelector('.p3-photo'); if (img) img.remove(); }
      if (single) out.push(leaf(world, it, o, 2, 1, len, theta, za, zb, cls));
      else { out.push(leaf(world, it, o, 1, 1, len, theta, za, zb, cls)); out.push(leaf(world, it, o, it.dw - 1, -1, len, theta, za, zb, cls)); }
    } else if (op.kind === 'drawer' && amt > 0.5) {
      const two = /2x5|2×5/.test(it.name || '');
      const w = two ? it.dw / 2 - 4 : it.dw - 6;
      const za = z0 + H * 0.66, zb = z0 + H * 0.84;
      box(world, localBox(it, 3, it.dd, w, amt, za, zb), Object.assign({}, o, { bg: 'var(--p3-drawer)' })).forEach((f) => { if (cls) f.classList.add(cls); out.push(f); });
    } else if (op.kind === 'lid') {
      out.push(lid(world, it, o, (78 * Math.PI) / 180, z0 + H));
    }
    return out;
  }
  /** 정보 카드 한 줄: 문·서랍을 열 때 필요한 앞 공간과, 이 자리에서 실제로 열 수 있는 만큼 */
  const OPEN_WORD = { hinged: '문을 열면', 'front-door': '문을 열면', drawer: '서랍을 빼면', lid: '뚜껑을 열면', table: '의자를 빼고 앉으면',
    seat: '앉으면', open: '물건을 꺼낼 때', bed: '오르내릴 때', airflow: '바람 앞' };
  function openLine(it) {
    if (shapeOf(it) === 'chair') return it.tuck ? '문 닫힘 보기: 식탁 밑으로 넣은 모습 · 문 열림 보기: 빼 둔 모습(식탁에서 ' + Math.round(it.dd) + 'cm)' : '';
    const op = it.open;
    if (!op) return '';
    if (op.kind === 'lid') return '뚜껑을 열면 위로 약 ' + Math.round(op.top || 0) + 'cm 더 필요해요' + (op.need > 0.5 ? ' · 앞 ' + Math.round(op.need) + 'cm' : '');
    const head = (OPEN_WORD[op.kind] || '쓸 때') + ' 앞 ' + Math.round(op.need) + 'cm';
    if (!limited(op)) return head + ' — 이 자리에서 다 돼요';
    return head + ' — 이 자리에서는 ' + Math.round(op.free) + 'cm만 돼요' + (op.by ? '(「' + op.by + '」에 닿아요)' : '');
  }
  function drawItem(world, it, ctx) {
    const col = colorOf(it);
    const pid = it.pid;
    const o = { bg: col, pid, cls: 'p3-item' + (it.fate === 'buy' ? ' is-buy' : '') };
    const z0 = it.z0 || 0;
    const H = Math.max(3, it.hgt);
    const shape = shapeOf(it);
    const fs = FRONT_SIDE[it.rot];
    const url = ctx.photos ? photoOf(it) : '';
    let parts = [];
    if (shape === 'table') {
      const top = Math.min(4, H * 0.1), leg = Math.min(6, it.dw / 8, it.dd / 6);
      parts = parts.concat(box(world, { x: it.x, y: it.y, w: it.w, d: it.h, z0: z0 + H - top, z1: z0 + H }, o));
      [[0, 0], [it.dw - leg, 0], [0, it.dd - leg], [it.dw - leg, it.dd - leg]].forEach(([lx, ly]) => {
        parts = parts.concat(box(world, localBox(it, lx, ly, leg, leg, z0, z0 + H - top), Object.assign({}, o, { top: false })));
      });
      // 책상 뒤쪽 가림판
      if (it.tag === 'desk') parts = parts.concat(box(world, localBox(it, leg, 0, it.dw - 2 * leg, 2, z0 + H * 0.45, z0 + H - top), Object.assign({}, o, { top: false })));
      // 어린이 책상 세트: 의자 — 닫힘은 책상 밑, 열림은 앞으로 뺀 만큼
      if (it.tag === 'desk' && it.cat === 'kids') {
        const cw = Math.min(36, it.dw * 0.45), cd = Math.min(32, it.dd * 0.5), cx = (it.dw - cw) / 2;
        const ly0 = it.dd - cd + (ctx.open ? openAmount(it.open) : 0);
        const co = Object.assign({}, o, { bg: 'var(--p3-kids)' });
        parts = parts.concat(box(world, localBox(it, cx, ly0, cw, cd, z0 + H * 0.52, z0 + H * 0.58), co));
        parts = parts.concat(box(world, localBox(it, cx, ly0 + cd - 3, cw, 3, z0 + H * 0.58, z0 + H * 1.05), co));
        [[cx, ly0], [cx + cw - 3, ly0], [cx, ly0 + cd - 3], [cx + cw - 3, ly0 + cd - 3]].forEach(([lx, ly]) => {
          parts = parts.concat(box(world, localBox(it, lx, ly, 3, 3, z0, z0 + H * 0.52), Object.assign({}, co, { top: false })));
        });
      }
    } else if (shape === 'chair') {
      // 닫힘: 식탁 밑으로 넣은 모습(it.tuck — 식탁 쪽으로 의자 깊이 − 12cm) · 열림: 빼 둔 모습(도면 자리)
      const sh = !ctx.open && it.tuck ? it.tuck : 0;
      const seatZ = Math.min(45, H * 0.62), leg = 4, back = Math.min(7, it.dd * 0.16);
      const lb = (lx, ly, lw, ld, za, zb) => localBox(it, lx, ly + sh, lw, ld, za, zb);
      parts = parts.concat(box(world, lb(0, 0, it.dw, it.dd, z0 + seatZ - 5, z0 + seatZ), o));
      [[1, 1], [it.dw - leg - 1, 1], [1, it.dd - leg - 1], [it.dw - leg - 1, it.dd - leg - 1]].forEach(([lx, ly]) => {
        parts = parts.concat(box(world, lb(lx, ly, leg, leg, z0, z0 + seatZ - 5), Object.assign({}, o, { top: false })));
      });
      parts = parts.concat(box(world, lb(0, 0, it.dw, back, z0 + seatZ, z0 + H), o));
      if (/팔걸이/.test(it.name || '')) {
        [0, it.dw - 4].forEach((lx) => { parts = parts.concat(box(world, lb(lx, back, 4, it.dd * 0.7, z0 + seatZ, z0 + seatZ + 20), o)); });
      }
    } else if (shape === 'sofa') {
      const seatZ = Math.min(42, H * 0.55), backD = Math.min(22, it.dd * 0.28), arm = Math.min(16, it.dw * 0.1);
      const base = box(world, localBox(it, 0, backD, it.dw, it.dd - backD, z0, z0 + seatZ), o);
      parts = parts.concat(base);
      const backFaces = box(world, localBox(it, 0, 0, it.dw, backD, z0, z0 + H), o);
      parts = parts.concat(backFaces);
      [0, it.dw - arm].forEach((lx) => { parts = parts.concat(box(world, localBox(it, lx, backD, arm, it.dd - backD, z0, z0 + Math.min(H, seatZ + 18)), o)); });
      // 사진은 등받이 앞면(정면 쪽)에
      if (url) putPhoto(backFaces.find((f) => f.dataset.side === fs), url, 'cover');
    } else if (shape === 'bed') {
      const mat = box(world, { x: it.x, y: it.y, w: it.w, d: it.h, z0, z1: z0 + H }, Object.assign({}, o, { topBg: 'var(--p3-sheet)' }));
      parts = parts.concat(mat);
      // 베개: 머리 쪽(뒤)
      const pw = Math.min(70, it.dw * 0.38), pd = Math.min(45, it.dd * 0.2);
      [it.dw * 0.25 - pw / 2, it.dw * 0.75 - pw / 2].forEach((lx) => {
        parts = parts.concat(box(world, localBox(it, lx, 8, pw, pd, z0 + H, z0 + H + 12), Object.assign({}, o, { bg: 'var(--p3-pillow)' })));
      });
      // 이불 (발치 쪽 2/3)
      parts = parts.concat(box(world, localBox(it, 4, it.dd * 0.36, it.dw - 8, it.dd * 0.62, z0 + H, z0 + H + 4), Object.assign({}, o, { bg: 'var(--p3-duvet)' })));
      if (url) putPhoto(mat.find((f) => f.dataset.side === fs), url, 'cover');
    } else {
      const faces = box(world, { x: it.x, y: it.y, w: it.w, d: it.h, z0, z1: z0 + H }, o);
      parts = parts.concat(faces);
      const front = faces.find((f) => f.dataset.side === fs);
      if (url) putPhoto(front, url);
      else if (front) front.classList.add('is-front');   // 사진이 없을 때: 정면에 손잡이 줄
      if (ctx.open) parts = parts.concat(addOpen(world, it, o, faces, ctx));
    }
    // 이름표 (위 면)
    const top = parts.find((f) => f.dataset.side === 'top');
    if (top && ctx.labels) {
      const tfs = Math.min(ctx.font * 0.72, Math.max(it.w, it.h) / 3);
      const lab = el('span', { class: 'p3-tag' }, shortName(it.name, Math.max(3, Math.min(12, Math.floor(Math.max(it.w, it.h) / tfs) * 2))));
      lab.style.fontSize = r2(tfs) + 'px';
      top.appendChild(lab);
    }
    return parts;
  }

  /* ---------------- 벽 ---------------- */
  /** 같은 선 위 구간 합치기 */
  function union(iv) {
    iv = iv.filter(([a, b]) => b - a > 0.5).sort((p, q) => p[0] - q[0]);
    const out = [];
    iv.forEach(([a, b]) => { const l = out[out.length - 1]; if (l && a <= l[1] + 0.5) l[1] = Math.max(l[1], b); else out.push([a, b]); });
    return out;
  }
  function subtract(iv, cuts) {
    let cur = iv.map((x) => x.slice());
    cuts.forEach(([c0, c1]) => {
      const nx = [];
      cur.forEach(([a, b]) => {
        if (c1 <= a || c0 >= b) { nx.push([a, b]); return; }
        if (c0 > a) nx.push([a, c0]);
        if (c1 < b) nx.push([c1, b]);
      });
      cur = nx;
    });
    return cur.filter(([a, b]) => b - a > 0.5);
  }
  const key1 = (v) => String(Math.round(v * 2) / 2);
  /** 방 가장자리 → 벽 조각 { v, at, a, b } (문·트인 곳은 뚫고, 창은 따로 표시) */
  function wallSegments(P) {
    const lines = { h: {}, v: {} };
    const push = (o, at, a, b) => { const k = key1(at); (lines[o][k] = lines[o][k] || { at, iv: [] }).iv.push([a, b]); };
    P.rooms.forEach((r) => {
      push('h', r.y, r.x, r.x + r.w); push('h', r.y + r.h, r.x, r.x + r.w);
      push('v', r.x, r.y, r.y + r.h); push('v', r.x + r.w, r.y, r.y + r.h);
    });
    const gaps = (o, at) => {
      const g = [];
      const near = (v) => Math.abs(v - at) < 3;
      P.doors.forEach((d) => { if ((o === 'v') === d.v && near(d.v ? d.x : d.y)) g.push(d.v ? [d.y, d.y + d.w] : [d.x, d.x + d.w]); });
      P.openings.forEach((d) => { if ((o === 'v') === d.v && near(d.v ? d.x : d.y)) g.push(d.v ? [d.y, d.y + d.w] : [d.x, d.x + d.w]); });
      return g;
    };
    const wins = (o, at) => P.windows.filter((w) => (o === 'v') === w.v && Math.abs((w.v ? w.x : w.y) - at) < 3).map((w) => (w.v ? [w.y, w.y + w.w] : [w.x, w.x + w.w]));
    const out = [];
    ['h', 'v'].forEach((o) => Object.keys(lines[o]).forEach((k) => {
      const L = lines[o][k];
      const solid = subtract(union(L.iv), gaps(o, L.at));
      const W = union(wins(o, L.at));
      solid.forEach(([a, b]) => {
        // 창 구간은 창(win: true)으로 나눠요
        let rest = [[a, b]];
        W.forEach(([w0, w1]) => {
          const nx = [];
          rest.forEach(([p, q]) => {
            if (w1 <= p || w0 >= q) { nx.push([p, q]); return; }
            if (w0 > p) nx.push([p, w0]);
            out.push({ v: o === 'v', at: L.at, a: Math.max(p, w0), b: Math.min(q, w1), win: true });
            if (w1 < q) nx.push([w1, q]);
          });
          rest = nx;
        });
        rest.forEach(([p, q]) => { if (q - p > 0.5) out.push({ v: o === 'v', at: L.at, a: p, b: q, win: false }); });
      });
    }));
    return out;
  }
  /** 방이 아닌 곳(설비 통로·두꺼운 벽) — 1cm 격자로 칠해서 사각형으로 묶어요 */
  function voids(P) {
    const B = P.bounds;
    const X0 = Math.floor(B.x), Y0 = Math.floor(B.y), W = Math.ceil(B.w), H = Math.ceil(B.h);
    if (W * H > 4e6) return [];
    const g = new Uint8Array(W * H);
    P.rooms.forEach((r) => {
      const x0 = clamp(Math.round(r.x) - X0, 0, W), x1 = clamp(Math.round(r.x + r.w) - X0, 0, W);
      const y0 = clamp(Math.round(r.y) - Y0, 0, H), y1 = clamp(Math.round(r.y + r.h) - Y0, 0, H);
      for (let yy = y0; yy < y1; yy++) g.fill(1, yy * W + x0, yy * W + x1);
    });
    const rects = [];
    let open = new Map();   // "x0,x1" → rect
    for (let yy = 0; yy <= H; yy++) {
      const runs = new Map();
      if (yy < H) {
        let x = 0;
        while (x < W) {
          if (g[yy * W + x]) { x++; continue; }
          const s = x;
          while (x < W && !g[yy * W + x]) x++;
          runs.set(s + ',' + x, [s, x]);
        }
      }
      const next = new Map();
      runs.forEach((r, k) => { const o = open.get(k); if (o) { o.h++; next.set(k, o); } else next.set(k, { x: r[0] + X0, y: yy + Y0, w: r[1] - r[0], h: 1 }); });
      open.forEach((o, k) => { if (!next.has(k)) rects.push(o); });
      open = next;
    }
    return rects.filter((r) => r.w >= 3 && r.h >= 3);
  }

  /* ---------------- 장면 ---------------- */
  function build(world, P, opt) {
    world.textContent = '';
    const wallH = WALL_H[opt.walls] != null ? WALL_H[opt.walls] : WALL_H.low;
    const B = P.bounds;
    const ctx = { photos: opt.photos, labels: true, font: opt.font, open: !!opt.open };
    // 바탕(구조체) + 방 바닥
    world.appendChild(face('p3-base', B.w + 40, B.h + 40, [1, 0, 0], [0, 1, 0], [B.x - 20, B.y - 20, -1]));
    P.rooms.forEach((r) => {
      const f = face('p3-floor', r.w, r.h, [1, 0, 0], [0, 1, 0], [r.x, r.y, 0], { bg: floorOf(r.kind) });
      world.appendChild(f);
      floorText(world, r.name, r.x + r.w / 2, r.y + Math.min(r.h / 2, 26), 0.6, Math.min(opt.font * 1.25, r.w / Math.max(3, Array.from(r.name).length + 1)), 'p3-room');
    });
    // 남쪽 표시
    floorText(world, '☀ 남쪽(전면)', B.x + B.w / 2, B.y + B.h + 34, 0, opt.font * 1.1, 'p3-south');
    // 방이 아닌 곳 = 두꺼운 벽·설비 통로
    const vh = Math.max(wallH, 3);
    voids(P).forEach((v) => box(world, { x: v.x, y: v.y, w: v.w, d: v.h, z0: 0, z1: vh }, { bg: 'var(--p3-wall)', topBg: 'var(--p3-wall-top)', cls: 'p3-wall' }));
    // 벽
    const t = WALL_T;
    wallSegments(P).forEach((s) => {
      const r = s.v ? { x: s.at - t / 2, y: s.a, w: t, d: s.b - s.a } : { x: s.a, y: s.at - t / 2, w: s.b - s.a, d: t };
      if (wallH <= 0) { box(world, Object.assign({}, r, { z0: 0, z1: 3 }), { bg: s.win ? 'var(--p3-glass)' : 'var(--p3-wall)', cls: 'p3-wall' }); return; }
      if (!s.win) { box(world, Object.assign({}, r, { z0: 0, z1: wallH }), { bg: 'var(--p3-wall)', topBg: 'var(--p3-wall-top)', cls: 'p3-wall' }); return; }
      const sill = Math.min(WIN_SILL, wallH - 6);
      box(world, Object.assign({}, r, { z0: 0, z1: sill }), { bg: 'var(--p3-wall)', topBg: 'var(--p3-wall-top)', cls: 'p3-wall' });
      const gTop = Math.min(WIN_TOP, wallH);
      box(world, Object.assign({}, r, s.v ? { x: s.at - 1.5, w: 3 } : { y: s.at - 1.5, d: 3 }, { z0: sill, z1: gTop }), { bg: 'var(--p3-glass)', cls: 'p3-glass' });
      if (wallH > gTop + 1) box(world, Object.assign({}, r, { z0: gTop, z1: wallH }), { bg: 'var(--p3-wall)', topBg: 'var(--p3-wall-top)', cls: 'p3-wall' });
    });
    // 문 위 벽(천장까지일 때) · 문짝 — 열림 보기는 활짝 연 모습, 닫힘 보기는 닫은 모습
    P.doors.forEach((d) => {
      const r = d.v ? { x: d.x - t / 2, y: d.y, w: t, d: d.w } : { x: d.x, y: d.y - t / 2, w: d.w, d: t };
      if (wallH > DOOR_H + 1) box(world, Object.assign({}, r, { z0: DOOR_H, z1: wallH }), { bg: 'var(--p3-wall)', topBg: 'var(--p3-wall-top)', cls: 'p3-wall' });
      const end = opt.open ? d.open : d.shut;
      if (wallH <= 0 || !d.hingeAt || !end) return;
      const [hx, hy] = d.hingeAt, [ox, oy] = end;
      const len = Math.hypot(ox - hx, oy - hy);
      if (!(len > 5)) return;
      const U = [(ox - hx) / len, (oy - hy) / len, 0];
      const hh = Math.min(DOOR_H, wallH);
      const leaf = face('p3-door', len, hh, U, [0, 0, -1], [hx, hy, hh]);
      world.appendChild(leaf);
    });
    // 설비 (조리대·욕조·신발장 등)
    P.fixtures.forEach((f) => {
      const k = f.kind, n = f.name || '';
      let z0 = 0, z1 = 0, bg = 'var(--p3-fixture)';
      if (k === 'fridge-spot' || k === 'aircon-port' || k === 'tap') return;
      if (k === 'sink') z1 = 85;
      else if (/인덕션/.test(n)) { z0 = 85; z1 = 86.5; bg = 'var(--p3-dark)'; }
      else if (k === 'bath') z1 = 55;
      else if (k === 'toilet') z1 = 42;
      else if (k === 'basin') { z0 = 70; z1 = 86; }
      else if (k === 'shoe') z1 = 120;
      else if (k === 'outdoor-unit') { z1 = 80; bg = 'var(--p3-white)'; }
      else if (/튀어나온|기둥|덕트|파이프/.test(n)) { z1 = Math.max(vh, 3); bg = 'var(--p3-wall)'; }
      else z1 = 40;
      const parts = box(world, { x: f.x, y: f.y, w: f.w, d: f.h, z0, z1 }, { bg, cls: 'p3-fx' });
      parts.forEach((p) => { p.title = n; });
    });
    // 짐 — 식탁 앞에 붙은 의자는 닫힘 보기에서 식탁 밑으로 넣어요(it.tuck)
    const tables = P.items.filter((x) => x.tag === 'table');
    P.items.forEach((it) => {
      if (shapeOf(it) !== 'chair') return;
      const d = 4, b = it.rot === 180 ? { x: it.x, y: it.y - d, w: it.w, h: d } : it.rot === 90 ? { x: it.x - d, y: it.y, w: d, h: it.h }
        : it.rot === 270 ? { x: it.x + it.w, y: it.y, w: d, h: it.h } : { x: it.x, y: it.y + it.h, w: it.w, h: d };
      const hit = tables.some((t) => b.x < t.x + t.w && t.x < b.x + b.w && b.y < t.y + t.h && t.y < b.y + b.h);
      it.tuck = hit ? Math.max(0, it.dd - 12) : 0;
    });
    const byInv = {};
    P.items.forEach((it) => {
      const parts = drawItem(world, it, ctx);
      parts.forEach((p) => { p.dataset.pid = it.pid; });
      byInv[it.invId] = byInv[it.invId] || it;
    });
    // 다른 짐 위에 올리는 짐 (전자레인지 → 전자레인지 수납장 위) — 정면은 받침 짐과 같은 쪽, 열림 보기에서는 문도 열어요
    (P.extras || []).forEach((t) => {
      const base = byInv[ON_TOP[t.invId]];
      if (!base) return;
      const dw = Math.min(t.dw, base.dw), dd = Math.min(t.dd, base.dd);
      const lx = (base.dw - dw) / 2, ly = base.dd - dd;
      const a = toWorld(base, lx, ly), b = toWorld(base, lx + dw, ly + dd);
      const need = t.use && t.use.front > 0.5 ? t.use.front : Math.round(dd * 0.9);
      const it = { pid: 'top-' + t.invId, invId: t.invId, name: t.name, cat: t.cat, tag: t.tag, fate: t.fate, url: t.url, room: base.room, front: base.front,
        rot: base.rot, dw, dd, hgt: t.hgt, z0: (base.z0 || 0) + base.hgt, onTop: base.name,
        x: Math.min(a[0], b[0]), y: Math.min(a[1], b[1]), w: Math.abs(b[0] - a[0]), h: Math.abs(b[1] - a[1]),
        // 전자레인지 문: 한 짝(왼쪽 경첩), 받침 짐 앞이 막혔으면 그만큼만
        open: { kind: 'front-door', need, free: base.open ? Math.min(need, base.open.free) : need, by: base.open ? base.open.by : '', top: 0 } };
      const parts = drawItem(world, it, ctx);
      parts.forEach((p) => { p.dataset.pid = it.pid; });
      opt.extra[it.pid] = it;
    });
  }

  /* ---------------- 창 ---------------- */
  let cur = null;
  function open(key) {
    if (cur) cur.close();
    key = key === 'old' ? 'old' : 'new';
    const P = MV.calc && MV.calc.plan3d ? MV.calc.plan3d(key) : null;
    if (!P) { if (MV.ui && MV.ui.toast) MV.ui.toast('도면 자료를 불러오지 못했어요.'); return; }
    injectCss();
    const prefs = loadPrefs();
    const st = { yaw: -24, pitch: 52, zoom: 1, cx: P.bounds.x + P.bounds.w / 2, cy: P.bounds.y + P.bounds.h / 2, walls: prefs.walls, photos: prefs.photos, open: prefs.open };
    const items = {};
    P.items.forEach((it) => { items[it.pid] = it; });
    const extra = {};

    const world = el('div', { class: 'p3-world' });
    const cam = el('div', { class: 'p3-cam' }, world);
    const stage = el('div', { class: 'p3-stage', tabindex: '0', 'aria-label': '3D 도면 — 끌어서 돌리고 휠이나 두 손가락으로 확대해요' }, cam);
    const card = el('div', { class: 'p3-card', hidden: true, role: 'region', 'aria-live': 'polite', 'aria-label': '고른 짐 정보' });
    stage.appendChild(card);
    const hint = el('div', { class: 'p3-hint' }, '끌어서 돌리고 · 휠이나 두 손가락으로 확대 · 쉬프트+끌기(두 손가락 끌기)로 옮기기 · 짐을 누르면 정보가 나와요. 「문 열림」은 문·서랍·뚜껑을 연 모습이고, 앞이 막혀 끝까지 못 여는 것은 열 수 있는 만큼만 열고 주황 테두리로 보여요. 고치기는 2D 도면에서 해요.');
    stage.appendChild(hint);

    const presetBtns = PRESETS.map(([id, label, pitch, yaw]) => el('button', { type: 'button', class: 'btn p3-b', 'data-preset': id, onclick: () => { st.pitch = pitch; st.yaw = yaw; apply(true); } }, label));
    const selWalls = el('select', { class: 'select p3-sel', 'aria-label': '벽 높이' },
      el('option', { value: 'low' }, '벽 낮게'), el('option', { value: 'full' }, '벽 천장까지'), el('option', { value: 'none' }, '벽 숨기기'));
    selWalls.value = st.walls;
    selWalls.addEventListener('change', () => { st.walls = selWalls.value; savePrefs({ walls: st.walls }); rebuild(); });
    const selRoom = el('select', { class: 'select p3-sel', 'aria-label': '방 가까이 보기' },
      el('option', { value: '' }, '집 전체'),
      P.rooms.filter((r) => r.w >= 60 && r.h >= 60).map((r) => el('option', { value: r.id }, r.name)));
    selRoom.addEventListener('change', () => focusRoom(selRoom.value));
    // 문 닫힘 / 열림 — 두 모습을 바꿔 봐요 (의자는 닫힘: 식탁 밑으로 넣음 · 열림: 빼 둠)
    const bShut = el('button', { type: 'button', class: 'btn p3-b', 'aria-pressed': String(!st.open), onclick: () => setOpen(false) }, '🚪 문 닫힘');
    const bOpen = el('button', { type: 'button', class: 'btn p3-b', 'aria-pressed': String(st.open), onclick: () => setOpen(true) }, '🚪 문 열림');
    const openGrp = el('div', { class: 'p3-grp', role: 'group', 'aria-label': '가구·가전 문' }, bShut, bOpen);
    function setOpen(v) {
      st.open = !!v;
      savePrefs({ open: st.open });
      bShut.setAttribute('aria-pressed', String(!st.open));
      bOpen.setAttribute('aria-pressed', String(st.open));
      rebuild();
    }
    const bPhoto = el('button', { type: 'button', class: 'btn p3-b', 'aria-pressed': String(st.photos), onclick: () => { st.photos = !st.photos; savePrefs({ photos: st.photos }); bPhoto.setAttribute('aria-pressed', String(st.photos)); rebuild(); } }, '🖼 상품 사진');
    const zoomBtns = el('div', { class: 'p3-grp' },
      el('button', { type: 'button', class: 'btn p3-b btn-icon', 'aria-label': '축소', onclick: () => { st.zoom = clamp(st.zoom / 1.25, 0.35, 6); apply(); } }, '−'),
      el('button', { type: 'button', class: 'btn p3-b btn-icon', 'aria-label': '확대', onclick: () => { st.zoom = clamp(st.zoom * 1.25, 0.35, 6); apply(); } }, '+'));
    const head = el('div', { class: 'p3-head' },
      el('h2', { class: 'p3-title' }, '🧊 ' + (P.name || '새 집') + ' 3D 보기'),
      el('button', { type: 'button', class: 'btn btn-ghost btn-icon p3-x', 'aria-label': '3D 보기 닫기', onclick: () => close() }, '✕'));
    const tools = el('div', { class: 'p3-tools', role: 'toolbar', 'aria-label': '3D 보기 도구' }, openGrp, el('div', { class: 'p3-grp' }, presetBtns), zoomBtns, selRoom, selWalls, bPhoto);
    const foot = el('p', { class: 'p3-foot' }, '상품 사진은 인터넷에서 찾은 같은·비슷한 모델 사진이라 실제와 다를 수 있어요. 사진이 안 뜨면 색 상자로 보여요(공유 버전은 바깥 사진을 막아서 늘 색 상자예요). 크기·자리는 2D 도면과 같아요.');
    const panel = el('div', { class: 'p3', role: 'dialog', 'aria-modal': 'true', 'aria-label': (P.name || '새 집') + ' 3D 보기' }, head, tools, stage, foot);
    const back = el('div', { class: 'p3-back' }, panel);
    document.body.appendChild(back);
    document.body.classList.add('p3-lock');
    const prevFocus = document.activeElement;

    let fit = 1;
    function measure() {
      const W = stage.clientWidth || 600, H = stage.clientHeight || 400;
      // 돌려 봐도 화면 밖으로 덜 나가게 — 가로는 대각선의 3/4 기준
      const diag = Math.hypot(P.bounds.w, P.bounds.h);
      fit = Math.min(W / (Math.max(P.bounds.w, diag * 0.75) + 60), H / (P.bounds.h + 110));
      stage.style.perspective = Math.round(Math.max(W, H) * 1.7) + 'px';
      return fit;
    }
    function rebuild() {
      measure();
      build(world, P, { walls: st.walls, photos: st.photos, open: st.open, font: clamp(13 / fit, 12, 60), extra });
      apply();
      if (selPid) select(selPid);
    }
    function apply(anim) {
      const s = fit * st.zoom;
      cam.classList.toggle('is-anim', !!anim);
      cam.style.transform = 'scale3d(' + r2(s * 1000) / 1000 + ',' + r2(s * 1000) / 1000 + ',' + r2(s * 1000) / 1000 + ') rotateX(' + r2(st.pitch) + 'deg) rotateZ(' + r2(st.yaw) + 'deg) translate3d(' + r2(-st.cx) + 'px,' + r2(-st.cy) + 'px,-40px)';
      presetBtns.forEach((b) => { const p = PRESETS.find((x) => x[0] === b.dataset.preset); b.setAttribute('aria-pressed', String(Math.abs(p[2] - st.pitch) < 1 && Math.abs(((p[3] - st.yaw) % 360 + 540) % 360 - 180) < 1)); });
    }
    function focusRoom(id) {
      const r = P.rooms.find((x) => x.id === id);
      if (!r) { st.cx = P.bounds.x + P.bounds.w / 2; st.cy = P.bounds.y + P.bounds.h / 2; st.zoom = 1; apply(true); return; }
      st.cx = r.x + r.w / 2; st.cy = r.y + r.h / 2;
      st.zoom = clamp(Math.min((P.bounds.w + 90) / (r.w + 120), (P.bounds.h + 110) / (r.h + 140)), 1, 5);
      apply(true);
    }

    // 짐 고르기 → 정보 카드
    let selPid = null;
    function select(pid) {
      world.querySelectorAll('.p3-item.is-sel').forEach((f) => f.classList.remove('is-sel'));
      const it = items[pid] || extra[pid];
      selPid = it ? pid : null;
      if (!it) { card.hidden = true; card.textContent = ''; return; }
      world.querySelectorAll('[data-pid="' + CSS.escape(pid) + '"]').forEach((f) => f.classList.add('is-sel'));
      const fate = MV.inv && MV.inv.fate ? MV.inv.fate(it.fate) : null;
      const url = photoOf(it);
      const img = url ? el('img', { class: 'p3-card-img', alt: '', referrerpolicy: 'no-referrer', src: url }) : null;
      if (img) img.addEventListener('error', () => img.remove(), { once: true });
      card.textContent = '';
      card.append(
        img || '',
        el('div', { class: 'p3-card-body' },
          el('strong', { class: 'p3-card-name' }, it.name),
          el('div', { class: 'tiny muted num' }, Math.round(it.dw) + ' × ' + Math.round(it.dd) + ' × ' + Math.round(it.hgt) + 'cm' + (fate ? ' · ' + fate.label : '') + (it.room ? ' · ' + it.room : '')),
          it.onTop ? el('div', { class: 'tiny muted' }, '「' + shortName(it.onTop, 14) + '」 위에 올려요') : el('div', { class: 'tiny muted' }, '정면(문·서랍·앉는 쪽): ' + (it.front || '')),
          openLine(it) ? el('div', { class: 'tiny' + (limited(it.open) ? ' p3-card-warn' : '') }, openLine(it)) : '',
          it.url ? el('a', { class: 'tiny', href: it.url, target: '_blank', rel: 'noopener noreferrer' }, '상품 보기 ↗') : ''),
        el('button', { type: 'button', class: 'btn btn-ghost btn-icon p3-card-x', 'aria-label': '정보 닫기', onclick: () => select(null) }, '✕'));
      card.hidden = false;
    }

    // 끌기·확대
    const pts = new Map();
    let drag = null, pinch = null, moved = false;
    const panBy = (dx, dy) => {
      const s = fit * st.zoom, a = st.yaw * Math.PI / 180;
      const sy = dy / Math.max(0.25, Math.cos(st.pitch * Math.PI / 180));
      st.cx -= (dx * Math.cos(a) + sy * Math.sin(a)) / s;
      st.cy -= (-dx * Math.sin(a) + sy * Math.cos(a)) / s;
    };
    stage.addEventListener('pointerdown', (e) => {
      if (e.target.closest('.p3-card')) return;
      stage.setPointerCapture && stage.setPointerCapture(e.pointerId);
      pts.set(e.pointerId, [e.clientX, e.clientY]);
      moved = false;
      if (pts.size === 1) drag = { x: e.clientX, y: e.clientY, pan: e.shiftKey || e.button === 2 || e.button === 1, target: e.target };
      else if (pts.size === 2) { const [a, b] = Array.from(pts.values()); pinch = { d: Math.hypot(a[0] - b[0], a[1] - b[1]), z: st.zoom, mx: (a[0] + b[0]) / 2, my: (a[1] + b[1]) / 2 }; drag = null; }
    });
    stage.addEventListener('pointermove', (e) => {
      if (!pts.has(e.pointerId)) return;
      pts.set(e.pointerId, [e.clientX, e.clientY]);
      if (pinch && pts.size >= 2) {
        const [a, b] = Array.from(pts.values());
        const d = Math.hypot(a[0] - b[0], a[1] - b[1]);
        st.zoom = clamp(pinch.z * d / Math.max(10, pinch.d), 0.35, 6);
        const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2;
        panBy(mx - pinch.mx, my - pinch.my);
        pinch.mx = mx; pinch.my = my;
        moved = true;
        apply();
        return;
      }
      if (!drag) return;
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      if (!moved && Math.hypot(dx, dy) < 5) return;
      moved = true;
      drag.x = e.clientX; drag.y = e.clientY;
      if (drag.pan) panBy(dx, dy);
      else { st.yaw = ((st.yaw + dx * 0.4) % 360 + 360) % 360; if (st.yaw > 180) st.yaw -= 360; st.pitch = clamp(st.pitch - dy * 0.3, PITCH_MIN, PITCH_MAX); }
      apply();
    });
    const up = (e) => {
      if (!pts.has(e.pointerId)) return;
      pts.delete(e.pointerId);
      if (drag && !moved && e.type === 'pointerup') {
        const f = drag.target && drag.target.closest ? drag.target.closest('[data-pid]') : null;
        select(f ? f.dataset.pid : null);
      }
      if (pts.size < 2) pinch = null;
      if (pts.size === 0) drag = null;
      else if (pts.size === 1) { const [p] = Array.from(pts.values()); drag = { x: p[0], y: p[1], pan: true, target: null }; }
    };
    stage.addEventListener('pointerup', up);
    stage.addEventListener('pointercancel', up);
    stage.addEventListener('contextmenu', (e) => e.preventDefault());
    stage.addEventListener('wheel', (e) => {
      e.preventDefault();
      st.zoom = clamp(st.zoom * Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.0015)), 0.35, 6);
      apply();
    }, { passive: false });
    stage.addEventListener('keydown', (e) => {
      const k = e.key;
      if (k === 'ArrowLeft') st.yaw -= 10;
      else if (k === 'ArrowRight') st.yaw += 10;
      else if (k === 'ArrowUp') st.pitch = clamp(st.pitch + 6, PITCH_MIN, PITCH_MAX);
      else if (k === 'ArrowDown') st.pitch = clamp(st.pitch - 6, PITCH_MIN, PITCH_MAX);
      else if (k === '+' || k === '=') st.zoom = clamp(st.zoom * 1.2, 0.35, 6);
      else if (k === '-') st.zoom = clamp(st.zoom / 1.2, 0.35, 6);
      else return;
      e.preventDefault();
      apply();
    });

    const onKey = (e) => { if (e.key === 'Escape') { if (!card.hidden) select(null); else close(); } };
    const onHash = () => close();
    const onResize = () => { measure(); apply(); };
    document.addEventListener('keydown', onKey);
    window.addEventListener('hashchange', onHash);
    window.addEventListener('resize', onResize);
    let closed = false;
    function close() {
      if (closed) return;
      closed = true;
      back.remove();
      document.body.classList.remove('p3-lock');
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('hashchange', onHash);
      window.removeEventListener('resize', onResize);
      if (cur && cur.close === close) cur = null;
      if (prevFocus && prevFocus.focus) try { prevFocus.focus({ preventScroll: true }); } catch (err) { /* 무시 */ }
    }
    cur = { close };
    rebuild();
    setTimeout(() => { try { stage.focus({ preventScroll: true }); } catch (err) { /* 무시 */ } }, 30);
    return cur;
  }

  /* ---------------- 보기 설정 (이 기기에만) ---------------- */
  const PREF_KEY = 'mv:plan3d';
  function loadPrefs() {
    let p = {};
    try { p = JSON.parse(localStorage.getItem(PREF_KEY) || '{}') || {}; } catch (e) { p = {}; }
    return { walls: WALL_H[p.walls] != null ? p.walls : 'low', photos: p.photos !== false, open: p.open === true };
  }
  function savePrefs(patch) {
    try { localStorage.setItem(PREF_KEY, JSON.stringify(Object.assign(loadPrefs(), patch))); } catch (e) { /* 저장 못 해도 보기는 그대로 */ }
  }

  /* ---------------- 스타일 ---------------- */
  function injectCss() {
    MV.css('p3', `
:root { --p3-floor:#f4efe6; --p3-wet:#dde9ee; --p3-balc:#e9e4da; --p3-base:#8a8178; --p3-wall:#e8e2d8; --p3-wall-top:#5b544c;
  --p3-glass:rgba(125,185,220,.45); --p3-fixture:#d9d4cc; --p3-dark:#2b2a2e; --p3-white:#f7f7f5; --p3-wood:#b98b62; --p3-wood-dk:#8a5a3b;
  --p3-wood-lt:#dcc6a6; --p3-steel:#c9ccd1; --p3-fabric:#9aa5b5; --p3-bed:#f3efe8; --p3-sheet:#fbf9f5; --p3-pillow:#ffffff; --p3-duvet:#cfe0ec;
  --p3-kids:#f2c46d; --p3-box:rgba(200,222,238,.92); --p3-misc:#b9b4ab; --p3-door:rgba(185,139,98,.55); --p3-stage:#ece7de; --p3-label:#4a443d;
  --p3-inside:#d8d2c8; --p3-drawer:#e6d7bf; --p3-limit:#f08c00; }
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { --p3-floor:#3a3833; --p3-inside:#4a4640; --p3-drawer:#6b5c49; --p3-limit:#ffa94d; --p3-wet:#2f3d44; --p3-balc:#35322d; --p3-base:#121115;
  --p3-wall:#59544e; --p3-wall-top:#cfc7bb; --p3-fixture:#5d5953; --p3-stage:#1b1a1f; --p3-label:#e8e2d8; --p3-bed:#d9d4cc; --p3-sheet:#e5e1da; } }
:root[data-theme="dark"] { --p3-floor:#3a3833; --p3-inside:#4a4640; --p3-drawer:#6b5c49; --p3-limit:#ffa94d; --p3-wet:#2f3d44; --p3-balc:#35322d; --p3-base:#121115;
  --p3-wall:#59544e; --p3-wall-top:#cfc7bb; --p3-fixture:#5d5953; --p3-stage:#1b1a1f; --p3-label:#e8e2d8; --p3-bed:#d9d4cc; --p3-sheet:#e5e1da; }
body.p3-lock { overflow: hidden; }
.p3-back { position: fixed; inset: 0; z-index: 80; background: rgba(20,18,16,.55); display: flex; align-items: stretch; justify-content: center;
  padding: max(12px, env(safe-area-inset-top)) 12px max(12px, env(safe-area-inset-bottom)); }
.p3 { background: var(--bg-2, #fff); color: var(--ink, #222); border-radius: var(--radius-lg, 20px); box-shadow: var(--shadow-lg, none);
  width: min(1280px, 100%); display: flex; flex-direction: column; gap: 8px; padding: 12px 14px; min-width: 0; min-height: 0; }
.p3-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.p3-title { font-size: 1.05rem; margin: 0; text-wrap: balance; }
.p3-tools { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
.p3-grp { display: inline-flex; gap: 4px; flex-wrap: wrap; }
.p3-b { padding: 6px 10px; font-size: .85rem; min-height: 34px; }
.p3-b[aria-pressed="true"] { background: var(--ink, #222); color: var(--bg-2, #fff); border-color: var(--ink, #222); }
.p3-sel { width: auto; min-height: 34px; padding: 4px 8px; font-size: .85rem; }
.p3-stage { position: relative; flex: 1 1 auto; min-height: 280px; overflow: hidden; border-radius: var(--radius, 14px); background: var(--p3-stage);
  touch-action: none; cursor: grab; user-select: none; -webkit-user-select: none; outline: none; }
.p3-stage:focus-visible { box-shadow: inset 0 0 0 2px var(--brand, #c2410c); }
.p3-stage:active { cursor: grabbing; }
.p3-cam { position: absolute; left: 50%; top: 50%; width: 0; height: 0; transform-style: preserve-3d; }
.p3-cam.is-anim { transition: transform .45s cubic-bezier(.2,.7,.2,1); }
.p3-world { position: absolute; left: 0; top: 0; transform-style: preserve-3d; }
.p3-f { position: absolute; left: 0; top: 0; transform-origin: 0 0; box-sizing: border-box; overflow: hidden; }
.p3-f::after { content: ''; position: absolute; inset: 0; background: rgba(0,0,0,var(--sh,0)); pointer-events: none; }
.p3-base { background: var(--p3-base); }
.p3-floor { box-shadow: inset 0 0 0 1px rgba(0,0,0,.08); }
.p3-wall.p3-top, .p3-wall[data-side="top"] { background: var(--p3-wall-top) !important; }
.p3-glass { opacity: .9; }
.p3-door { background: var(--p3-door); border: 1px solid rgba(120,80,50,.6); backface-visibility: visible; }
.p3-label { display: flex; align-items: center; justify-content: center; color: var(--p3-label); font-weight: 700; white-space: nowrap; pointer-events: none; opacity: .75; }
.p3-south { color: var(--brand, #c2410c); opacity: .9; }
.p3-item { border: 1px solid rgba(0,0,0,.18); cursor: pointer; }
.p3-item.is-buy { opacity: .78; border-style: dashed; }
.p3-item.is-sel { outline: 3px solid var(--brand, #c2410c); outline-offset: -3px; }
.p3-item.is-front::before { content: ''; position: absolute; left: 12%; right: 12%; top: 10%; height: 3px; background: rgba(0,0,0,.28); border-radius: 2px; }
.p3-leaf { border: 1px solid rgba(0,0,0,.28); backface-visibility: visible; cursor: pointer; }
.p3-lid { opacity: .85; }
.p3-item.is-inside { background: var(--p3-inside) !important; }
.p3-item.is-inside::before { content: ''; position: absolute; left: 6%; right: 6%; top: 8%; bottom: 8%; pointer-events: none;
  background: repeating-linear-gradient(to bottom, transparent 0 22%, rgba(0,0,0,.18) 22% 24%); }
.p3-item.is-limited, .p3-leaf.is-limited { outline: 3px solid var(--p3-limit); outline-offset: -2px; }
.p3-card-warn { color: var(--warn, #a16207); font-weight: 600; }
.p3-photo { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: contain; background: #fff; pointer-events: none; }
.p3-tag { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; text-align: center; padding: 2px;
  color: #2b2724; font-weight: 700; line-height: 1.1; word-break: keep-all; overflow: hidden; pointer-events: none; }
.p3-hint { position: absolute; left: 10px; right: 10px; top: 8px; font-size: .78rem; color: var(--ink-3, #777); pointer-events: none; text-wrap: balance; }
.p3-card { position: absolute; left: 10px; right: 10px; bottom: 10px; max-width: 460px; display: flex; gap: 10px; align-items: flex-start;
  background: var(--bg-2, #fff); color: var(--ink, #222); border: 1px solid var(--line, #ddd); border-radius: var(--radius-sm, 10px);
  box-shadow: var(--shadow, none); padding: 10px 40px 10px 10px; cursor: default; }
.p3-card-img { width: 84px; height: 84px; object-fit: contain; background: #fff; border-radius: 8px; flex: 0 0 auto; border: 1px solid var(--line, #ddd); }
.p3-card-body { display: flex; flex-direction: column; gap: 3px; min-width: 0; }
.p3-card-name { font-size: .92rem; overflow-wrap: anywhere; }
.p3-card-x { position: absolute; right: 4px; top: 4px; }
.p3-foot { margin: 0; font-size: .76rem; color: var(--ink-3, #777); }
@media (max-width: 640px) {
  .p3-back { padding: 0; }
  .p3 { border-radius: 0; padding: 10px 10px max(10px, env(safe-area-inset-bottom)); }
  .p3-hint { display: none; }
  .p3-b { padding: 6px 8px; }
}
@media (prefers-reduced-motion: reduce) { .p3-cam.is-anim { transition: none; } }
`);
  }

  MV.plan3d = { open };
})();
