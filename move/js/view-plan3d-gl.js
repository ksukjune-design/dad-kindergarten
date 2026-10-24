/* ============================================================
   3D 보기 — WebGL 그림 (three.js r147, move/vendor/ 에 같이 둠 · MIT)
   view-plan3d.js 의 창(도구·정보 카드)이 이 그림을 써요. three.js 를 못 불러오거나 WebGL 이 안 되면 CSS 3D 그림으로 보여요.
   가족이 만든 SpacePlanner 3D(10/24, three.js) 방식을 우리 자료(MV.calc.plan3d)에 맞춰 옮겼어요:
     · 가구·가전을 코드로 빚은 모델(냉장고 양문·건조기 둥근 문·통돌이 뚜껑·식탁 의자·서랍·옷장 문·책·옷걸이 옷 …)
     · 그림자(해 + 보조광, ACES 톤), 방 바닥(나무·타일 무늬), 벽 보기(단면 1m · 반투명 · 전체 2.3m), 시점(전체 조감도·방)
     · 문 열림 비율(0 닫힘 ~ 1 열림) — 앞이 막혀 끝까지 못 여는 문·서랍은 열 수 있는 만큼만(주황 테두리)
   단위: 1 = 1m. 세계 X = 도면 x(동), Z = 도면 y(남), Y = 위. 짐 모델은 바닥 가운데가 원점, 정면이 +Z(폭 = X, 깊이 = Z),
         도면 rot(정면 방향 0 남 · 90 서 · 180 북 · 270 동) → rotation.y = −rot.
   제공  MV.plan3dGL = { supported(), load() → Promise<boolean>, create(host, P, opt) → 엔진 }
   ============================================================ */
(function () {
  'use strict';
  const VENDOR = [['vendor/three-r147.min.js', () => !!window.THREE], ['vendor/three-r147-orbit.js', () => !!(window.THREE && window.THREE.OrbitControls)]];
  const CUT = { inner: 0.9, outer: 1.4 };   // 단면 보기 벽 높이 (m) — 안쪽 벽 · 바깥 벽
  const FULL_H = 2.3, DOOR_H = 2.1, WIN_SILL = 0.9, WIN_TOP = 2.1, WALL_T = 0.06;
  const num = (v, d) => { const n = parseFloat(v); return isFinite(n) ? n : d; };
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const deg = (d) => (d * Math.PI) / 180;

  /* ---------------- 불러오기 ---------------- */
  function supported() {
    try {
      const c = document.createElement('canvas');
      return !!(window.WebGLRenderingContext && (c.getContext('webgl2') || c.getContext('webgl')));
    } catch (e) { return false; }
  }
  let loading = null;
  function loadScript(src) {
    return new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = src; s.async = false;
      s.onload = () => res(); s.onerror = () => rej(new Error('불러오기 실패: ' + src));
      document.head.appendChild(s);
    });
  }
  function load() {
    if (VENDOR.every(([, ok]) => ok())) return Promise.resolve(true);
    if (!loading) {
      const run = (async () => {
        for (const [src, ok] of VENDOR) if (!ok()) await loadScript(src);
        return VENDOR.every(([, ok]) => ok());
      })();
      const timeout = new Promise((res) => setTimeout(() => res(false), 15000));
      loading = Promise.race([run, timeout]).catch(() => false).then((ok) => { if (!ok) loading = null; return ok; });
    }
    return loading;
  }

  /* ---------------- 재질 · 모양 도우미 ---------------- */
  function kit(T) {
    const mats = new Map(), geos = new Map(), texs = [];
    const mat = (key, make) => { if (!mats.has(key)) mats.set(key, make()); return mats.get(key); };
    const xkey = (extra) => (extra ? Object.keys(extra).sort().map((k) => { const v = extra[k]; return k + ':' + (v && v.uuid ? v.uuid : v && v.isColor ? v.getHexString() : String(v)); }).join(',') : '');
    const std = (color, rough, metal, extra) => mat('s|' + color + '|' + rough + '|' + metal + '|' + xkey(extra),
      () => new T.MeshStandardMaterial(Object.assign({ color: new T.Color(color), roughness: rough == null ? 0.6 : rough, metalness: metal || 0 }, extra || {})));
    const glass = (color, opacity) => mat('g|' + color + '|' + opacity, () => new T.MeshStandardMaterial({ color: new T.Color(color), roughness: 0.08, metalness: 0.2, transparent: true, opacity: opacity == null ? 0.45 : opacity, depthWrite: false }));
    const line = (color) => mat('l|' + color, () => new T.LineBasicMaterial({ color: new T.Color(color) }));
    const r3 = (v) => Math.round(v * 1000) / 1000;
    const boxGeo = (w, h, d) => { const k = 'b|' + r3(w) + '|' + r3(h) + '|' + r3(d); if (!geos.has(k)) geos.set(k, new T.BoxGeometry(Math.max(0.002, w), Math.max(0.002, h), Math.max(0.002, d))); return geos.get(k); };
    const cylGeo = (rt, rb, h, seg) => { const k = 'c|' + r3(rt) + '|' + r3(rb) + '|' + r3(h) + '|' + (seg || 24); if (!geos.has(k)) geos.set(k, new T.CylinderGeometry(rt, rb, Math.max(0.002, h), seg || 24)); return geos.get(k); };
    const sphGeo = (r, ws, hs) => { const k = 'p|' + r3(r) + '|' + ws + '|' + hs; if (!geos.has(k)) geos.set(k, new T.SphereGeometry(r, ws || 20, hs || 12)); return geos.get(k); };
    const torGeo = (r, t) => { const k = 't|' + r3(r) + '|' + r3(t); if (!geos.has(k)) geos.set(k, new T.TorusGeometry(r, t, 10, 36)); return geos.get(k); };
    const shadow = (m, cast, recv) => { m.castShadow = cast !== false; m.receiveShadow = recv !== false; return m; };
    /** 상자: 가운데 (x, y, z), 크기 w(X)·h(Y)·d(Z) */
    const box = (parent, w, h, d, x, y, z, material, o) => {
      const m = shadow(new T.Mesh(boxGeo(w, h, d), material), !(o && o.noCast), true);
      m.position.set(x, y, z);
      parent.add(m);
      return m;
    };
    /** 바닥에 선 상자: 아래 y0 */
    const slab = (parent, w, h, d, x, y0, z, material, o) => box(parent, w, h, d, x, y0 + h / 2, z, material, o);
    const cyl = (parent, rt, rb, h, x, y, z, material, seg) => { const m = shadow(new T.Mesh(cylGeo(rt, rb, h, seg), material)); m.position.set(x, y, z); parent.add(m); return m; };
    const sph = (parent, r, x, y, z, material, sx, sy, sz) => { const m = shadow(new T.Mesh(sphGeo(r), material)); m.position.set(x, y, z); m.scale.set(sx || 1, sy || 1, sz || 1); parent.add(m); return m; };
    const torus = (parent, r, t, x, y, z, material) => { const m = shadow(new T.Mesh(torGeo(r, t), material)); m.position.set(x, y, z); parent.add(m); return m; };
    /** 테두리 선(주황: 끝까지 못 여는 문·서랍) */
    const edges = (mesh, color) => {
      const g = new T.EdgesGeometry(mesh.geometry);
      const l = new T.LineSegments(g, line(color));
      l.userData.ownGeo = true;
      l.visible = false;
      mesh.add(l);
      return l;
    };
    /** 캔버스 무늬 텍스처 */
    const canvasTex = (w, h, draw, repeat) => {
      const c = document.createElement('canvas');
      c.width = w; c.height = h;
      draw(c.getContext('2d'), w, h);
      const t = new T.CanvasTexture(c);
      if (repeat) { t.wrapS = t.wrapT = T.RepeatWrapping; }
      if (T.sRGBEncoding) t.encoding = T.sRGBEncoding;
      t.anisotropy = 4;
      texs.push(t);
      return t;
    };
    const dispose = () => { mats.forEach((m) => { if (m.map) m.map.dispose(); m.dispose(); }); geos.forEach((g) => g.dispose()); texs.forEach((t) => t.dispose()); mats.clear(); geos.clear(); };
    return { T, std, glass, line, box, slab, cyl, sph, torus, edges, canvasTex, boxGeo, dispose };
  }

  /* 같은 결과가 나오는 가짜 난수 (책 색·높이 등) */
  function rng(seed) {
    let s = 0;
    for (const ch of String(seed)) s = (s * 31 + ch.charCodeAt(0)) >>> 0;
    return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  }

  /* ---------------- 재질 색 (실제 제품 색에 가깝게) ---------------- */
  const C = {
    white: '#f4f3ef', warmWhite: '#efebe4', ivory: '#f7f1e3', steel: '#c9ccd1', chrome: '#e8edf2', dark: '#2a2c31', black: '#17181b',
    oak: '#c8a27a', oakDk: '#a87c55', walnut: '#7a4f31', rubber: '#c49a6c', plywood: '#d9c3a0',
    fabricGray: '#8f9399', fabricGrayLt: '#a6aab0', fabricBeige: '#cdbfa8', linen: '#f5f1ea', duvet: '#c9dbe8', pillow: '#ffffff',
    fridge: '#d6d0c4', fridgeBody: '#bfb9ae', glassDk: '#1d2733', panel: '#2e3440', acWhite: '#f6f7f8', boxLid: '#4c86c6', boxBody: '#e3eef7',
    door: '#e6dccb', counter: '#3b4350', cabinet: '#f1efea', tile: '#cfd6dc', floorWood: '#d4a373', floorRoom: '#e3c07e',
  };

  /* ---------------- 열림 계산 (2D 점검과 같은 값: it.open = { kind, need, free, by, top }) ---------------- */
  const isLimited = (op) => !!op && op.free < op.need - 0.5;
  /** 문짝(길이 lenCm)을 앞이 free 만큼 비었을 때 열 수 있는 각도 — 끝까지면 maxRad */
  function safeAngle(op, lenCm, maxRad) {
    if (!op || !isLimited(op)) return maxRad;
    return Math.min(maxRad, Math.asin(clamp(op.free / Math.max(1, lenCm), 0, 1)));
  }
  /** 서랍을 뺄 수 있는 길이 (m) */
  function safePull(op, wantCm) {
    if (!op) return wantCm / 100;
    return Math.max(0, Math.min(wantCm, isLimited(op) ? op.free : wantCm)) / 100;
  }

  /* ============================================================
     짐 모델 — 정면 +Z, 바닥 가운데 원점. 움직이는 부분은 movers 에 넣어요:
       { rot: 물체, axis: 'x'|'y', sign, max(rad), safe(rad), lim(테두리) } · { slide: 물체, base(z), max(m), safe(m), lim }
     ============================================================ */
  function modelOf(it) {
    const id = it.invId || '', tag = it.tag || '', cat = it.cat || '', name = it.name || '';
    if (tag === 'fridge' || /냉장고/.test(name)) return 'fridge';
    if (tag === 'dryer') return 'dryer';
    if (tag === 'washer' || /세탁기/.test(name)) return 'washer';
    if (id === 'inv-microwave' || /전자레인지/.test(name) && !/수납장/.test(name)) return 'microwave';
    if (id === 'inv-microwave-cabinet' || tag === 'kitchen' || /수납장/.test(name) && /전자레인지/.test(name)) return 'mwcab';
    if (cat === 'aircon' && it.ac !== 'wall') return 'aircon';
    if (tag === 'chair') return 'chair';
    if (tag === 'table') return 'table';
    if (tag === 'desk' && cat === 'kids') return 'kiddesk';
    if (tag === 'desk') return 'desk';
    if (tag === 'vanity') return 'vanity';
    if (tag === 'sofa' || cat === 'sofa') return 'sofa';
    if (tag === 'bed' || cat === 'bed') return 'bed';
    if (tag === 'wardrobe') return 'wardrobe';
    if (tag === 'hanger') return 'hanger';
    if (id === 'inv-toy-storage' || /장난감/.test(name)) return 'toy';
    if (tag === 'drawer') return 'drawers';
    if (tag === 'shelf' || cat === 'shelf') return 'shelf';
    if (/트롤리/.test(name)) return 'trolley';
    if (tag === 'box' || /박스/.test(name)) return 'livingbox';
    if (/쓰레기통/.test(name)) return 'trash';
    if (/빨래바구니|바구니/.test(name)) return 'basket';
    return 'generic';
  }

  function buildModel(K, it) {
    const { T, std, glass, box, slab, cyl, sph, torus, edges } = K;
    const g = new T.Group();
    const w = Math.max(0.05, it.dw / 100), d = Math.max(0.05, it.dd / 100), h = Math.max(0.03, it.hgt / 100);
    const op = it.open || null;
    const movers = [];
    const LIM = '#f08c00';
    const front = d / 2;
    const kind = modelOf(it);

    /** 문짝 하나: 경첩(hx, front) 에서 폭 lw 쪽(dir +1 오른쪽 · −1 왼쪽)으로 — y0~y0+lh, 두께 t */
    function leaf(hx, zf, dir, lw, y0, lh, t, material, maxDeg, extraFn) {
      const pivot = new T.Group();
      pivot.position.set(hx, y0, zf);
      g.add(pivot);
      const m = box(pivot, lw, lh, t, dir * lw / 2, lh / 2, t / 2, material);
      const max = deg(maxDeg);
      const mv = { rot: pivot, axis: 'y', sign: dir > 0 ? -1 : 1, max, safe: safeAngle(op, lw * 100, max), lim: edges(m, LIM) };
      movers.push(mv);
      if (extraFn) extraFn(pivot, m, mv);
      return { pivot, m };
    }
    /** 서랍: 앞판 + 손잡이 + (빼면 보이는) 서랍통 */
    function drawer(x, y, fw, fh, depth, faceMat, pullCm, handleMat, o) {
      const dg = new T.Group();
      dg.position.set(x, y, 0);
      g.add(dg);
      const face = box(dg, fw, fh, 0.018, 0, 0, front - 0.009, faceMat);
      box(dg, fw - 0.03, fh * 0.75, depth * 0.85, 0, -fh * 0.08, front - 0.018 - depth * 0.425, std(o && o.inside || '#e9e2d6', 0.8));
      if (handleMat) box(dg, Math.min(0.12, fw * 0.4), 0.012, 0.016, 0, fh * 0.22, front + 0.008, handleMat);
      movers.push({ slide: dg, base: 0, max: pullCm / 100, safe: safePull(op, pullCm), lim: edges(face, LIM) });
      return dg;
    }

    if (kind === 'fridge') {
      // LG 디오스 오브제컬렉션 양문형 — 몸체 + 문 두 짝(왼쪽 디스펜서), 열면 안쪽 선반
      const bodyD = d * 0.8, bz = -d / 2 + bodyD / 2;
      box(g, w, h, bodyD, 0, h / 2, bz, std(C.fridgeBody, 0.45, 0.25));
      const inner = new T.Group(); g.add(inner);
      box(inner, w - 0.04, h - 0.06, 0.01, 0, h / 2, bz + bodyD / 2 + 0.002, std('#f7f8f8', 0.6));
      for (let i = 1; i < 6; i++) box(inner, w - 0.06, 0.008, 0.08, 0, (h * i) / 6, bz + bodyD / 2 - 0.03, glass('#dfe9ef', 0.7));
      box(inner, 0.012, h - 0.08, 0.06, 0, h / 2, bz + bodyD / 2 - 0.02, std(C.fridgeBody, 0.5));
      const zf = bz + bodyD / 2, dt = d * 0.12, lw = w / 2 - 0.004, doorMat = std(C.fridge, 0.32, 0.35);
      leaf(-w / 2, zf, 1, lw, 0.02, h - 0.03, dt, doorMat, 105, (p) => {
        box(p, 0.022, h * 0.42, 0.03, lw - 0.03, h * 0.5, dt + 0.015, std(C.chrome, 0.2, 0.85));
        box(p, lw * 0.42, h * 0.16, 0.006, lw * 0.5, h * 0.62, dt + 0.003, std(C.panel, 0.25, 0.3));
      });
      leaf(w / 2, zf, -1, lw, 0.02, h - 0.03, dt, doorMat, 105, (p) => {
        box(p, 0.022, h * 0.42, 0.03, -lw + 0.03, h * 0.5, dt + 0.015, std(C.chrome, 0.2, 0.85));
      });
      box(g, w, 0.02, 0.02, 0, h - 0.005, zf + dt, std('#9a958c', 0.4, 0.3), { noCast: true });
    } else if (kind === 'dryer') {
      // 삼성 그랑데 AI 건조기 — 위 조작부 · 둥근 유리문(왼쪽 경첩) · 아래 필터 덮개
      const bodyD = d * 0.9, bz = -d / 2 + bodyD / 2, zf = bz + bodyD / 2;
      box(g, w, h, bodyD, 0, h / 2, bz, std('#e9e8e4', 0.35, 0.15));
      box(g, w * 0.96, h * 0.16, 0.02, 0, h * 0.89, zf + 0.01, std(C.panel, 0.3, 0.3));
      box(g, w * 0.2, h * 0.07, 0.006, w * 0.18, h * 0.89, zf + 0.022, std('#5ad1ff', 0.2, 0, { emissive: new T.Color('#1d6f8f'), emissiveIntensity: 0.6 }));
      cyl(g, 0.022, 0.022, 0.018, -w * 0.3, h * 0.89, zf + 0.025, std(C.chrome, 0.2, 0.8)).rotation.x = Math.PI / 2;
      box(g, w * 0.9, h * 0.1, 0.012, 0, h * 0.08, zf + 0.006, std('#dcdad5', 0.4, 0.1));
      const r = Math.min(w * 0.33, h * 0.33);
      cyl(g, r * 0.92, r * 0.92, 0.01, 0, h * 0.47, zf + 0.003, std('#3a3f47', 0.5, 0.2)).rotation.x = Math.PI / 2;
      leaf(-r, zf + 0.004, 1, 2 * r, h * 0.47 - r, 2 * r, 0.04, std('#dad8d3', 0.25, 0.5), 110, (p, m, mv) => {
        m.visible = false;   // 둥근 문: 사각 판 대신 고리 + 유리
        const ring = torus(p, r * 0.9, r * 0.1, r, r, 0.03, std('#c9ccd1', 0.2, 0.85));
        const gl = cyl(p, r * 0.8, r * 0.8, 0.02, r, r, 0.03, glass('#2b3644', 0.75));
        gl.rotation.x = Math.PI / 2;
        mv.lim = edges(ring, LIM);
      });
    } else if (kind === 'washer') {
      // LG 통돌이 — 몸통 · 뒤 조작부 · 뒤 경첩 유리 뚜껑
      const bodyH = h * 0.9;
      box(g, w, bodyH, d, 0, bodyH / 2, 0, std('#f3f4f5', 0.35, 0.1));
      box(g, w, h - bodyH + 0.02, d * 0.2, 0, bodyH + (h - bodyH) / 2, -d / 2 + d * 0.1, std('#e7e9ec', 0.3, 0.1));
      box(g, w * 0.7, (h - bodyH) * 0.6, 0.006, 0, bodyH + (h - bodyH) / 2, -d / 2 + d * 0.2 + 0.003, std(C.panel, 0.2, 0.3));
      cyl(g, w * 0.36, w * 0.36, 0.01, 0, bodyH + 0.001, d * 0.08, std('#2e3138', 0.5, 0.3));
      const pivot = new T.Group();
      pivot.position.set(0, bodyH + 0.006, -d / 2 + d * 0.2);
      g.add(pivot);
      const ld = d * 0.78;
      const frame = box(pivot, w * 0.94, 0.02, ld, 0, 0.01, ld / 2, std('#d3d7dc', 0.3, 0.2));
      box(pivot, w * 0.62, 0.022, ld * 0.62, 0, 0.012, ld * 0.5, glass('#3b4b5c', 0.7));
      movers.push({ rot: pivot, axis: 'x', sign: -1, max: deg(80), safe: deg(80), lim: edges(frame, LIM) });
    } else if (kind === 'microwave') {
      box(g, w, h, d, 0, h / 2, 0, std('#e9e9e6', 0.4, 0.2));
      box(g, w * 0.26, h * 0.86, 0.006, w * 0.35, h / 2, front + 0.003, std(C.panel, 0.3, 0.2));
      leaf(-w / 2, front, 1, w * 0.72, h * 0.06, h * 0.88, 0.02, std('#d9d9d6', 0.3, 0.2), 100, (p) => {
        box(p, w * 0.5, h * 0.56, 0.004, w * 0.36, h * 0.44, 0.021, glass('#14181d', 0.85));
      });
    } else if (kind === 'mwcab') {
      // 전자레인지 수납장 — 위 판(전자레인지), 가운데 트인 칸, 아래 두 문
      const bodyMat = std(C.white, 0.55, 0.05), t = 0.018;
      box(g, t, h, d, -w / 2 + t / 2, h / 2, 0, bodyMat); box(g, t, h, d, w / 2 - t / 2, h / 2, 0, bodyMat);
      box(g, w, t, d, 0, h - t / 2, 0, bodyMat); box(g, w, t, d, 0, t / 2 + 0.04, 0, bodyMat);
      box(g, w - 2 * t, h - 0.06, 0.008, 0, h / 2, -d / 2 + 0.004, std('#e6e3dc', 0.7));
      box(g, w - 2 * t, t, d - 0.02, 0, h * 0.55, 0.01, bodyMat);
      box(g, w, 0.04, d * 0.9, 0, 0.02, -0.01, std('#d4d0c8', 0.7));
      const dh = h * 0.5 - 0.06;
      [-1, 1].forEach((s) => leaf(s * (w / 2), front, -s, w / 2 - 0.004, 0.045, dh, 0.016, bodyMat, 95, (p) => {
        box(p, 0.012, 0.08, 0.014, -s * (w / 2 - 0.04), dh * 0.8, 0.022, std(C.dark, 0.4, 0.3));
      }));
    } else if (kind === 'table') {
      // 니토리 N컬렉션 식탁 — 상판 · 앞치마 · 다리 4
      const top = 0.032, leg = 0.05, inset = 0.04;
      box(g, w, top, d, 0, h - top / 2, 0, std(C.oak, 0.45, 0.02));
      const ax = w / 2 - inset - leg / 2, az = d / 2 - inset - leg / 2;
      box(g, w - 2 * inset, 0.07, 0.02, 0, h - top - 0.035, az, std(C.oakDk, 0.5)); box(g, w - 2 * inset, 0.07, 0.02, 0, h - top - 0.035, -az, std(C.oakDk, 0.5));
      box(g, 0.02, 0.07, d - 2 * inset, ax, h - top - 0.035, 0, std(C.oakDk, 0.5)); box(g, 0.02, 0.07, d - 2 * inset, -ax, h - top - 0.035, 0, std(C.oakDk, 0.5));
      [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(([sx, sz]) => box(g, leg, h - top, leg, sx * ax, (h - top) / 2, sz * az, std(C.oakDk, 0.5)));
    } else if (kind === 'chair') {
      // 니토리 C-011 팔걸이 의자 — 다리 · 천 방석 · 등받이 · 팔걸이 (넣기/빼기는 바깥 그룹이 움직여요)
      const seatH = Math.min(0.45, h * 0.62), wood = std(C.oakDk, 0.5), leg = 0.035;
      const lx = w / 2 - leg / 2 - 0.01, lz = d / 2 - leg / 2 - 0.01;
      [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(([sx, sz]) => box(g, leg, seatH - 0.04, leg, sx * lx, (seatH - 0.04) / 2, sz * lz, wood));
      box(g, w - 0.02, 0.04, d - 0.04, 0, seatH - 0.02, 0.01, wood);
      box(g, w - 0.06, 0.05, d - 0.1, 0, seatH + 0.025, 0.02, std(C.fabricBeige, 0.9));
      [-1, 1].forEach((sx) => box(g, leg, h - seatH + 0.04, leg, sx * lx, seatH + (h - seatH) / 2 - 0.02, -lz, wood));
      box(g, w - 0.04, 0.12, 0.025, 0, h - 0.08, -lz, wood);
      box(g, w - 0.08, 0.03, 0.02, 0, seatH + 0.14, -lz, wood);
      [-1, 1].forEach((sx) => { box(g, 0.035, 0.03, d * 0.75, sx * lx, seatH + 0.2, -d * 0.08, wood); box(g, 0.03, 0.2, 0.03, sx * lx, seatH + 0.1, d * 0.25, wood); });
    } else if (kind === 'desk' || kind === 'kiddesk') {
      // 데스커 책상(흰 상판 · 철제 다리 · 뒤 가림판) · 어린이 책상 세트(작은 의자 포함)
      const kid = kind === 'kiddesk';
      const deskD = kid ? d * 0.72 : d, dz = kid ? -d / 2 + deskD / 2 : 0, top = 0.025;
      const topMat = std(kid ? '#f6efe2' : '#f3f2ee', 0.45), legMat = std(kid ? '#9fc7a8' : '#3a3d42', 0.4, kid ? 0.05 : 0.6);
      box(g, w, top, deskD, 0, h - top / 2, dz, topMat);
      [-1, 1].forEach((sx) => {
        box(g, 0.03, h - top, 0.03, sx * (w / 2 - 0.035), (h - top) / 2, dz - deskD / 2 + 0.05, legMat);
        box(g, 0.03, h - top, 0.03, sx * (w / 2 - 0.035), (h - top) / 2, dz + deskD / 2 - 0.05, legMat);
        box(g, 0.03, 0.03, deskD - 0.1, sx * (w / 2 - 0.035), 0.04, dz, legMat);
      });
      box(g, w - 0.1, h * 0.35, 0.012, 0, h - top - h * 0.175, dz - deskD / 2 + 0.03, std(kid ? '#f6efe2' : '#e9e8e4', 0.6));
      if (kid) {
        // 작은 의자: 닫힘 = 책상 밑, 열림 = 앞으로 뺌(앞이 막히면 그만큼만)
        const ch = new T.Group(); g.add(ch);
        const cw = Math.min(0.36, w * 0.45), cd = 0.3, sh = h * 0.6, cz = dz + deskD / 2 - cd / 2 + 0.02;
        box(ch, cw, 0.03, cd, 0, sh, cz, std('#f2b8a2', 0.7));
        [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(([sx, sz]) => box(ch, 0.025, sh, 0.025, sx * (cw / 2 - 0.02), sh / 2, cz + sz * (cd / 2 - 0.02), std('#9fc7a8', 0.5)));
        box(ch, cw, 0.18, 0.02, 0, sh + 0.12, cz + cd / 2 - 0.01, std('#f2b8a2', 0.7));
        const want = op ? op.need : 35;
        movers.push({ slide: ch, base: 0, max: want / 100, safe: safePull(op, want), lim: null });
      }
    } else if (kind === 'vanity') {
      // 낮은 좌식 화장대(고무나무) — 몸통 · 서랍 · 뒤 거울
      const bodyH = Math.min(0.38, h * 0.5), wood = std(C.rubber, 0.55);
      box(g, w, 0.025, d, 0, bodyH - 0.0125, 0, wood);
      [-1, 1].forEach((sx) => box(g, 0.025, bodyH - 0.025, d, sx * (w / 2 - 0.0125), (bodyH - 0.025) / 2, 0, wood));
      box(g, w - 0.05, bodyH - 0.025, 0.012, 0, (bodyH - 0.025) / 2, -d / 2 + 0.006, std('#b98d60', 0.6));
      drawer(0, bodyH - 0.09, w - 0.06, 0.1, d - 0.05, std('#cfa77a', 0.5), op ? op.need : 30, std(C.walnut, 0.4));
      const mh = h - bodyH - 0.02;
      box(g, w * 0.6, mh, 0.03, 0, bodyH + mh / 2, -d / 2 + 0.04, wood);
      box(g, w * 0.52, mh * 0.85, 0.006, 0, bodyH + mh / 2, -d / 2 + 0.058, std('#dfe8ee', 0.05, 0.9));
    } else if (kind === 'sofa') {
      // 니토리 코우테이4 3인 패브릭(그레이) — 바닥 틀 · 방석 3 · 등쿠션 3 · 팔걸이 · 나무 다리
      const fab = std(C.fabricGray, 0.95), fabLt = std(C.fabricGrayLt, 0.95), legH = 0.08, arm = Math.min(0.16, w * 0.1);
      [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(([sx, sz]) => box(g, 0.04, legH, 0.04, sx * (w / 2 - 0.06), legH / 2, sz * (d / 2 - 0.06), std(C.walnut, 0.5)));
      box(g, w, h * 0.3, d, 0, legH + h * 0.15, 0, fab);
      const backD = d * 0.24, seatW = (w - 2 * arm) / 3;
      box(g, w, h - legH, backD, 0, legH + (h - legH) / 2, -d / 2 + backD / 2, fab);
      [-1, 1].forEach((sx) => box(g, arm, h * 0.62 - legH, d, sx * (w / 2 - arm / 2), legH + (h * 0.62 - legH) / 2, 0, fab));
      for (let i = 0; i < 3; i++) {
        const x = -w / 2 + arm + seatW * (i + 0.5);
        box(g, seatW - 0.012, 0.13, d - backD - 0.02, x, legH + h * 0.3 + 0.065, backD / 2 + 0.01, fabLt);
        box(g, seatW - 0.02, h * 0.42, 0.14, x, legH + h * 0.3 + 0.13 + h * 0.21, -d / 2 + backD + 0.07, fabLt).rotation.x = -0.12;
      }
    } else if (kind === 'bed') {
      // 라지킹 매트리스(프레임 없음) — 매트리스 · 베개 2 · 이불(아래 60%) · 머리는 뒤(-Z)
      const mat = std(C.linen, 0.85);
      box(g, w, h - 0.03, d, 0, (h - 0.03) / 2, 0, mat);
      box(g, w - 0.03, 0.03, d - 0.03, 0, h - 0.015, 0, std('#fbf8f2', 0.9));
      box(g, w + 0.004, 0.015, d + 0.004, 0, h * 0.5, 0, std('#e8e1d4', 0.8), { noCast: true });
      [-1, 1].forEach((sx) => sph(g, 0.3, sx * w * 0.24, h + 0.05, -d / 2 + 0.24, std(C.pillow, 0.9), w * 0.66, 0.24, 0.6));
      const bl = box(g, w * 0.97, 0.06, d * 0.62, 0, h + 0.03, d / 2 - d * 0.31, std(C.duvet, 0.9));
      bl.scale.set(1, 1, 1);
      box(g, w * 0.97, 0.05, 0.14, 0, h + 0.04, d / 2 - d * 0.62 + 0.07, std('#e9f0f5', 0.9));
    } else if (kind === 'wardrobe') {
      // 마켓비 피도르 캐비닛장 — 몸체 · 받침 · 문 두 짝(손잡이), 열면 안쪽(행어형: 옷걸이 봉·옷 / 수납형: 선반)
      const bodyMat = std(C.white, 0.5, 0.05), bodyD = d - 0.02, bz = -0.01, t = 0.018;
      box(g, t, h, bodyD, -w / 2 + t / 2, h / 2, bz, bodyMat); box(g, t, h, bodyD, w / 2 - t / 2, h / 2, bz, bodyMat);
      box(g, w, t, bodyD, 0, h - t / 2, bz, bodyMat); box(g, w, 0.06, bodyD, 0, 0.03, bz, std('#e4e1da', 0.6));
      box(g, w - 2 * t, h - 0.08, 0.008, 0, h / 2 + 0.02, -d / 2 + 0.006, std('#dcd7cd', 0.8));
      const hanger = /행어|2단 옷장|옷장/.test(it.name || '') && !/수납형/.test(it.name || '');
      if (hanger) {
        box(g, t, h * 0.03, bodyD, 0, h * 0.42, bz, bodyMat);
        cyl(g, 0.01, 0.01, w - 0.06, 0, h * 0.86, bz, std(C.chrome, 0.2, 0.8)).rotation.z = Math.PI / 2;
        cyl(g, 0.01, 0.01, w - 0.06, 0, h * 0.37, bz, std(C.chrome, 0.2, 0.8)).rotation.z = Math.PI / 2;
        const R = rng(it.pid);
        [h * 0.86, h * 0.37].forEach((ry) => {
          for (let i = 0; i < 6; i++) {
            const cl = ['#6b7a8f', '#c9b79c', '#2f3b4c', '#d9d4cc', '#8a5a44', '#9db4a0'][Math.floor(R() * 6)];
            const ch = 0.3 + R() * 0.25;
            box(g, 0.02, ch, bodyD * 0.75, -w / 2 + 0.07 + i * (w - 0.14) / 5, ry - ch / 2 - 0.02, bz, std(cl, 0.95));
          }
        });
      } else {
        for (let i = 1; i < 5; i++) box(g, w - 2 * t, t, bodyD - 0.02, 0, (h * i) / 5, bz, bodyMat);
        const R = rng(it.pid);
        for (let i = 0; i < 4; i++) box(g, w * (0.3 + R() * 0.3), 0.12 + R() * 0.1, bodyD * 0.6, (R() - 0.5) * w * 0.3, (h * i) / 5 + 0.1, bz, std(['#c9b79c', '#e8e1d4', '#9db4a0', '#b8c4d6'][i], 0.9));
      }
      const lw = w / 2 - 0.004, dt = 0.02, zf = d / 2 - dt;
      [-1, 1].forEach((s) => leaf(s * (w / 2), zf, -s, lw, 0.065, h - 0.075, dt, std('#f7f6f2', 0.4, 0.05), 95, (p) => {
        box(p, 0.012, 0.22, 0.02, -s * (lw - 0.04), (h - 0.075) * 0.55, dt + 0.01, std(C.chrome, 0.25, 0.8));
      }));
    } else if (kind === 'drawers') {
      // 서랍장(알렉스 5칸 · 체스트랙 4칸)
      const n = /알렉스|alex/i.test(it.name || '') ? 5 : /체스트/.test(it.name || '') ? 4 : 3;
      const bodyMat = std(/체스트/.test(it.name || '') ? '#f2efe9' : C.white, 0.45, 0.05), t = 0.016;
      box(g, w, h, d - 0.02, 0, h / 2, -0.01, bodyMat);
      const fh = (h - 0.06) / n, want = op ? op.need : d * 70;
      for (let i = 0; i < n; i++) {
        const y = 0.04 + fh * (i + 0.5);
        const top = i === n - 1;
        drawer(0, y, w - 2 * t, fh - 0.008, d - 0.06, std(/체스트/.test(it.name || '') ? '#e9e2d6' : '#fbfbf9', 0.4), top ? want : want * (0.5 + 0.5 * i / n), std('#9aa0a6', 0.3, 0.6));
      }
    } else if (kind === 'toy') {
      // 리바트 프렌즈아이 마카롱 2x5 — 흰 틀 + 파스텔 수납함 10개(맨 위 왼쪽 한 칸을 빼요)
      const bodyMat = std(C.white, 0.5), t = 0.018;
      box(g, t, h, d, -w / 2 + t / 2, h / 2, 0, bodyMat); box(g, t, h, d, w / 2 - t / 2, h / 2, 0, bodyMat); box(g, t, h - 0.04, d, 0, h / 2 + 0.02, 0, bodyMat);
      box(g, w, t, d, 0, h - t / 2, 0, bodyMat); box(g, w, 0.04, d, 0, 0.02, 0, bodyMat);
      box(g, w - 0.02, h - 0.04, 0.006, 0, h / 2, -d / 2 + 0.003, std('#ece9e3', 0.8));
      const cols = ['#f6b5c0', '#a9dfcf', '#fbe39a', '#c9b8ec', '#a7d3f2'];
      const rh = (h - 0.06) / 5, bw = (w - 3 * t) / 2;
      for (let r = 0; r < 5; r++) {
        if (r) box(g, w - 2 * t, 0.012, d - 0.01, 0, 0.04 + rh * r, 0, bodyMat);
        [-1, 1].forEach((sx, ci) => {
          const x = sx * (bw / 2 + t / 2), y = 0.04 + rh * (r + 0.5), mat = std(cols[(r + ci * 2) % 5], 0.6);
          if (r === 4 && ci === 0) drawer(x, y, bw - 0.006, rh - 0.016, d - 0.03, mat, op ? op.need : 30, null, { inside: cols[(r + ci * 2) % 5] });
          else box(g, bw - 0.006, rh - 0.016, d - 0.03, x, y, 0.004, mat);
        });
      }
    } else if (kind === 'shelf') {
      // 한샘 샘 책장(어린이 3단 · 5단) — 옆판 · 선반 · 뒤판 + 알록달록한 책
      const tiers = Math.max(2, Math.round(h / 0.38)), wood = std(C.white, 0.5), t = 0.018;
      box(g, t, h, d, -w / 2 + t / 2, h / 2, 0, wood); box(g, t, h, d, w / 2 - t / 2, h / 2, 0, wood);
      box(g, w - 0.01, h - 0.01, 0.008, 0, h / 2, -d / 2 + 0.004, std('#ebe7df', 0.8));
      const R = rng(it.pid), pal = ['#e76f51', '#2a9d8f', '#e9c46a', '#457b9d', '#9d4edd', '#f4a261', '#ef476f', '#118ab2', '#06d6a0', '#ffd166'];
      const step = (h - 0.05) / tiers;
      for (let i = 0; i <= tiers; i++) box(g, w - 2 * t, t, d - 0.01, 0, i === 0 ? 0.04 : Math.min(h - t / 2, 0.04 + step * i), 0.005, wood);
      for (let i = 0; i < tiers; i++) {
        let x = -w / 2 + t + 0.01;
        const y0 = 0.04 + step * i + t / 2;
        while (x < w / 2 - t - 0.04) {
          const bw = 0.018 + R() * 0.03, bh = Math.min(step - 0.04, 0.15 + R() * 0.12);
          if (R() < 0.08) { x += 0.04; continue; }
          box(g, bw, bh, d * (0.55 + R() * 0.25), x + bw / 2, y0 + bh / 2, 0.01, std(pal[Math.floor(R() * pal.length)], 0.8), { noCast: true });
          x += bw + 0.002;
        }
      }
    } else if (kind === 'trolley') {
      // 이케아 트롤리(바퀴) — 기둥 4 · 칸 · 바퀴
      const tiers = /3단/.test(it.name || '') || h > 0.7 ? 3 : 2, mat = std('#f5f5f2', 0.4, 0.3), legH = 0.06;
      [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(([sx, sz]) => {
        cyl(g, 0.009, 0.009, h - legH, sx * (w / 2 - 0.02), legH + (h - legH) / 2, sz * (d / 2 - 0.02), mat, 10);
        sph(g, 0.022, sx * (w / 2 - 0.03), 0.022, sz * (d / 2 - 0.03), std(C.dark, 0.5));
      });
      for (let i = 0; i < tiers; i++) {
        const y = legH + 0.03 + ((h - legH - 0.08) * i) / Math.max(1, tiers - 1);
        box(g, w - 0.02, 0.012, d - 0.02, 0, y, 0, mat);
        [[0, d / 2 - 0.01, w - 0.02, 0.006], [0, -d / 2 + 0.01, w - 0.02, 0.006]].forEach(([x, z, lw, ld]) => box(g, lw, 0.07, ld, x, y + 0.035, z, mat));
        [[w / 2 - 0.01], [-w / 2 + 0.01]].forEach(([x]) => box(g, 0.006, 0.07, d - 0.02, x, y + 0.035, 0, mat));
        if (i < tiers - 1 || tiers === 2) box(g, w * 0.4, 0.06, d * 0.5, (rng(it.pid + i)() - 0.5) * 0.1, y + 0.036, 0, std(['#f4a261', '#a7d3f2', '#cdb4db'][i % 3], 0.8), { noCast: true });
      }
    } else if (kind === 'hanger') {
      // 이동식 간이 행거 — 바퀴 받침 · 기둥 2 · 위 봉 · 아래 선반 · 걸린 옷
      const metal = std('#e8e8e6', 0.3, 0.6), legH = 0.04;
      [-1, 1].forEach((sx) => {
        box(g, 0.03, 0.03, d, sx * (w / 2 - 0.02), legH, 0, metal);
        [-1, 1].forEach((sz) => sph(g, 0.022, sx * (w / 2 - 0.02), 0.022, sz * (d / 2 - 0.03), std(C.dark, 0.5)));
        cyl(g, 0.012, 0.012, h - legH, sx * (w / 2 - 0.02), legH + (h - legH) / 2, 0, metal, 12);
      });
      cyl(g, 0.012, 0.012, w, 0, h - 0.015, 0, metal, 12).rotation.z = Math.PI / 2;
      box(g, w - 0.04, 0.012, d * 0.7, 0, 0.18, 0, metal);
      const R = rng(it.pid), cols = ['#2f3b4c', '#c9b79c', '#7f8fa6', '#e8e1d4', '#8a5a44', '#9db4a0', '#5b6c8f', '#d8a7a0'];
      const n = Math.max(4, Math.floor(w / 0.1));
      for (let i = 0; i < n; i++) {
        const x = -w / 2 + 0.08 + (i * (w - 0.16)) / (n - 1);
        const ch = 0.55 + R() * 0.45;
        box(g, 0.012, 0.03, d * 0.7, x, h - 0.05, 0, std('#b9a27f', 0.6), { noCast: true });
        box(g, 0.025, Math.min(ch, h - 0.35), d * (0.6 + R() * 0.2), x, h - 0.07 - Math.min(ch, h - 0.35) / 2, 0, std(cols[Math.floor(R() * cols.length)], 0.95));
      }
      for (let i = 0; i < 2; i++) box(g, 0.24, 0.1, 0.26, -w / 4 + i * w / 2, 0.24, 0, std(['#a0a7b3', '#c7b299'][i], 0.8));
    } else if (kind === 'livingbox') {
      // 리빙박스(반투명 몸통 + 색 뚜껑 · 손잡이 홈) — 쌓은 수만큼은 바깥에서 여러 번 그려요
      const lidH = Math.min(0.03, h * 0.12), top = /간이|다이소/.test(it.name || '');
      box(g, w * 0.97, h - lidH, d * 0.97, 0, (h - lidH) / 2, 0, std(top ? '#f2f2ef' : C.boxBody, 0.35, 0.05, { transparent: true, opacity: 0.88 }));
      box(g, w, lidH, d, 0, h - lidH / 2, 0, std(top ? '#9aa3ad' : C.boxLid, 0.4, 0.05));
      [-1, 1].forEach((sx) => box(g, 0.012, 0.035, d * 0.4, sx * (w * 0.485 + 0.004), h * 0.62, 0, std(top ? '#9aa3ad' : C.boxLid, 0.4), { noCast: true }));
    } else if (kind === 'aircon') {
      // 삼성 2in1 무풍 스탠드 — 둥근 모서리 기둥 · 위 둥근 바람문 · 표시창 · 아래 흡입구
      const body = std(C.acWhite, 0.3, 0.1), r = Math.min(w, d) * 0.25;
      box(g, w - 2 * r, h, d, 0, h / 2, 0, body);
      [-1, 1].forEach((sx) => [-1, 1].forEach((sz) => cyl(g, r, r, h, sx * (w / 2 - r), h / 2, sz * (d / 2 - r), body, 20)));
      box(g, w, h, d - 2 * r, 0, h / 2, 0, body);
      [0.82, 0.66].forEach((fy) => {
        const c = cyl(g, w * 0.34, w * 0.34, 0.012, 0, h * fy, front + 0.002, std('#d5dbe1', 0.6, 0.1));
        c.rotation.x = Math.PI / 2;
        const c2 = cyl(g, w * 0.22, w * 0.22, 0.014, 0, h * fy, front + 0.004, std('#bfc6ce', 0.8, 0.1));
        c2.rotation.x = Math.PI / 2;
      });
      box(g, w * 0.3, 0.03, 0.006, 0, h * 0.53, front + 0.003, std('#1d2733', 0.2, 0.2, { emissive: new T.Color('#3aa0ff'), emissiveIntensity: 0.4 }));
      for (let i = 0; i < 6; i++) box(g, w * 0.6, 0.006, 0.006, 0, h * 0.12 + i * 0.03, front + 0.003, std('#c3cad2', 0.6), { noCast: true });
    } else if (kind === 'trash') {
      box(g, w, h * 0.92, d, 0, h * 0.46, 0, std('#e9ebee', 0.4, 0.2));
      box(g, w + 0.006, h * 0.08, d + 0.006, 0, h * 0.96, 0, std('#9aa3ad', 0.4, 0.3));
    } else if (kind === 'basket') {
      const weave = K.canvasTex(64, 64, (c, W, H) => { c.fillStyle = '#d9c6a3'; c.fillRect(0, 0, W, H); c.strokeStyle = 'rgba(120,90,50,.35)'; for (let i = 0; i < W; i += 8) { c.beginPath(); c.moveTo(i, 0); c.lineTo(i, H); c.stroke(); c.beginPath(); c.moveTo(0, i); c.lineTo(W, i); c.stroke(); } }, true);
      const mat = K.std('#ffffff', 0.9, 0, { map: weave });
      const t = 0.012;
      box(g, w, h, t, 0, h / 2, d / 2 - t / 2, mat); box(g, w, h, t, 0, h / 2, -d / 2 + t / 2, mat);
      box(g, t, h, d, w / 2 - t / 2, h / 2, 0, mat); box(g, t, h, d, -w / 2 + t / 2, h / 2, 0, mat);
      box(g, w, 0.01, d, 0, 0.005, 0, mat);
      box(g, w * 0.8, h * 0.5, d * 0.8, 0, h * 0.3, 0, std('#cfd8e3', 0.95), { noCast: true });
    } else {
      // 그 밖의 짐: 색 상자 + 테두리
      const m = box(g, w, h, d, 0, h / 2, 0, std(colorFor(it), 0.6, 0.05));
      const l = edges(m, '#6b7280'); l.visible = true;
    }

    // 쌓은 짐(리빙박스 ×n): 같은 모델을 위로 n−1 번 더
    const n = Math.max(1, Math.round(+it.n || 1));
    if (n > 1) {
      const base = g.children.slice();
      for (let k = 1; k < n; k++) {
        const lv = new T.Group();
        lv.position.y = h * k;
        base.forEach((c) => lv.add(c.clone()));
        g.add(lv);
      }
    }

    // 겉 그룹(도면 자리 · 방향) 안에 모델 그룹 — 의자는 모델 그룹을 앞뒤로 옮겨 넣고 빼요
    const outer = new T.Group();
    outer.add(g);
    outer.position.set((it.x + it.w / 2) / 100, (it.z0 || 0) / 100, (it.y + it.h / 2) / 100);
    outer.rotation.y = -deg(it.rot || 0);
    outer.userData.pid = it.pid;
    outer.traverse((o) => { o.userData.pid = it.pid; });
    let chair = null;
    if (kind === 'chair' && it.tuck > 0) chair = { tuck: it.tuck / 100, dx: (it.tuckDx || 0) / 100, dy: (it.tuckDy || 0) / 100, base: outer.position.clone() };
    const limited = movers.some((m) => m.safe < m.max - 0.01);
    function update(ratio) {
      movers.forEach((m) => {
        const want = ratio * m.max, v = Math.min(want, m.safe);
        if (m.rot) m.rot.rotation[m.axis] = m.sign * v;
        else m.slide.position.z = m.base + v;
        if (m.lim) m.lim.visible = ratio > 0.02 && want > m.safe + 0.01;
      });
      if (chair) {
        // 닫힘(0) = 식탁 밑으로 넣은 모습 · 열림(1) = 도면 자리(빼 둔 모습). 앞으로 넣기는 모델 +Z, 식탁 다리 피해 옆으로 맞추기는 도면 좌표
        const k = 1 - ratio;
        g.position.z = chair.tuck * k;
        outer.position.set(chair.base.x + chair.dx * k, chair.base.y, chair.base.z + chair.dy * k);
      }
    }
    return { obj: outer, update, limited, kind };
  }

  function colorFor(it) {
    const c = it.cat;
    if (c === 'appliance' || c === 'aircon' || c === 'electronics') return C.white;
    if (c === 'bed') return C.linen;
    if (c === 'sofa') return C.fabricGray;
    if (c === 'kids') return '#f2c46d';
    if (c === 'shelf') return C.plywood;
    if (c === 'storage') return C.warmWhite;
    if (c === 'table') return C.oak;
    return '#b9b4ab';
  }

  /* ---------------- 고정물 (조리대·인덕션·욕조·변기·세면대·신발장·실외기) ---------------- */
  function buildFixture(K, f, rooms) {
    const { T, std, glass, box, cyl, sph } = K;
    const k = f.kind || '', name = f.name || '';
    if (k === 'fridge-spot' || k === 'aircon-port' || k === 'tap') return null;
    const g = new T.Group();
    const W = f.w / 100, D = f.h / 100;
    // 앞쪽: 이 고정물이 든 방의 가운데를 보는 쪽 (긴 변이 벽에 붙음)
    const cx = f.x + f.w / 2, cy = f.y + f.h / 2;
    const rm = rooms.find((r) => cx >= r.x && cx <= r.x + r.w && cy >= r.y && cy <= r.y + r.h);
    let rot = 0;
    if (rm) {
      // 가장 가까운 벽에 등을 대고 방 쪽을 봐요 (위 벽 → 정면 남 0 · 오른쪽 벽 → 서 90 · 아래 벽 → 북 180 · 왼쪽 벽 → 동 270)
      const gaps = [[f.y - rm.y, 0], [rm.x + rm.w - f.x - f.w, 90], [rm.y + rm.h - f.y - f.h, 180], [f.x - rm.x, 270]];
      gaps.sort((a, b) => a[0] - b[0]);
      rot = gaps[0][1];
    }
    const q = rot === 90 || rot === 270;
    const w = q ? D : W, d = q ? W : D;   // 모델 폭(X) · 깊이(Z)
    const fr = d / 2;
    if (k === 'sink') {
      const H = 0.85;
      box(g, w, H - 0.1, d - 0.04, 0, (H - 0.1) / 2 + 0.1, -0.02, std(C.cabinet, 0.5));
      box(g, w, 0.1, d - 0.08, 0, 0.05, -0.04, std('#d9d5cd', 0.7));
      const nd = Math.max(1, Math.round(w / 0.5));
      for (let i = 0; i < nd; i++) box(g, w / nd - 0.006, H - 0.16, 0.018, -w / 2 + (w / nd) * (i + 0.5), 0.1 + (H - 0.16) / 2 + 0.01, fr - 0.04, std('#f6f5f1', 0.4));
      box(g, w + 0.01, 0.035, d + 0.01, 0, H + 0.0175, 0, std(C.counter, 0.25, 0.25));
      const bx = 0, bw = Math.min(0.75, w * 0.38);
      box(g, bw, 0.02, d * 0.5, bx, H + 0.03, 0.02, std('#8d969f', 0.15, 0.85));
      const faucet = new T.Group(); g.add(faucet);
      cyl(faucet, 0.014, 0.018, 0.28, 0, H + 0.16, -d / 2 + 0.08, std(C.chrome, 0.1, 0.95));
      const sp = cyl(faucet, 0.012, 0.012, 0.2, 0, H + 0.29, -d / 2 + 0.17, std(C.chrome, 0.1, 0.95)); sp.rotation.x = Math.PI / 2;
    } else if (/인덕션/.test(name)) {
      box(g, w, 0.012, d, 0, 0.85 + 0.041, 0, std('#121417', 0.12, 0.4));
      [[-0.25, -0.2], [0.25, -0.2], [0, 0.25]].forEach(([sx, sz]) => {
        const r = K.torus(g, Math.min(w, d) * 0.17, 0.004, sx * w, 0.85 + 0.048, sz * d, std('#5b6570', 0.4, 0.3));
        r.rotation.x = Math.PI / 2;
      });
    } else if (k === 'bath') {
      const H = 0.55, t = 0.07;
      box(g, w, H, d, 0, H / 2, 0, std('#f8f8f6', 0.25, 0.05));
      box(g, w - 2 * t, 0.02, d - 2 * t, 0, H - 0.005, 0, std('#dbe7ee', 0.15, 0.1));
    } else if (k === 'toilet') {
      box(g, w * 0.9, 0.38, d * 0.28, 0, 0.8, -d / 2 + d * 0.14, std('#f8f8f6', 0.2, 0.05));
      cyl(g, w * 0.36, w * 0.28, 0.4, 0, 0.2, d * 0.12, std('#f8f8f6', 0.2, 0.05));
      const seat = cyl(g, w * 0.4, w * 0.4, 0.03, 0, 0.415, d * 0.12, std('#ffffff', 0.3)); seat.scale.z = 1.25;
    } else if (k === 'basin') {
      box(g, w, 0.04, d, 0, 0.84, 0, std('#f8f8f6', 0.2, 0.05));
      const b = sph(g, Math.min(w, d) * 0.36, 0, 0.84, 0.02, std('#eef2f4', 0.15, 0.05), 1, 0.35, 1);
      b.rotation.x = Math.PI;
      box(g, w * 0.3, 0.7, d * 0.3, 0, 0.42, -d * 0.2, std('#f1f1ee', 0.3));
      cyl(g, 0.012, 0.012, 0.16, 0, 0.92, -d / 2 + 0.06, std(C.chrome, 0.1, 0.95));
    } else if (k === 'shoe') {
      const H = 1.2;
      box(g, w, H, d, 0, H / 2, 0, std('#eceae4', 0.5));
      const n = Math.max(2, Math.round(w / 0.45));
      for (let i = 1; i < n; i++) box(g, 0.004, H - 0.08, 0.004, -w / 2 + (w / n) * i, H / 2, fr + 0.002, std('#c9c5bc', 0.6), { noCast: true });
    } else if (k === 'outdoor-unit') {
      const H = 0.64;
      box(g, w, H, d, 0, H / 2, 0, std('#eef0f2', 0.45, 0.1));
      const r = Math.min(H, w) * 0.36;
      const fan = cyl(g, r, r, 0.01, -w * 0.15, H / 2, fr + 0.004, std('#3d434a', 0.6)); fan.rotation.x = Math.PI / 2;
      for (let i = 1; i < 4; i++) { const ring = K.torus(g, (r * i) / 4, 0.003, -w * 0.15, H / 2, fr + 0.01, std('#a7b0b9', 0.5)); }
    } else if (/튀어나온|기둥|덕트|파이프/.test(name)) {
      return { obj: g, wallLike: true, w, d, rot, x: cx / 100, z: cy / 100 };
    } else {
      box(g, w, 0.4, d, 0, 0.2, 0, std('#d9d4cc', 0.6));
    }
    g.position.set(cx / 100, 0, cy / 100);
    g.rotation.y = -deg(rot);
    return { obj: g };
  }

  /* ---------------- 장면 ---------------- */
  function create(host, P, opt) {
    const T = window.THREE;
    opt = opt || {};
    if (T.ColorManagement && 'legacyMode' in T.ColorManagement) T.ColorManagement.legacyMode = false;
    const K = kit(T);
    const geo = (MV.plan3d && MV.plan3d._geo) || {};
    const B = P.bounds;
    const cx = (B.x + B.w / 2) / 100, cz = (B.y + B.h / 2) / 100;
    let dirty = true, raf = 0, alive = true, tween = null, anim = null;
    const need = () => { dirty = true; };
    const span = Math.max(B.w, B.h) / 100;

    const W0 = Math.max(200, host.clientWidth || 600), H0 = Math.max(200, host.clientHeight || 400);
    let renderer;
    try {
      renderer = new T.WebGLRenderer({ antialias: true, powerPreference: 'high-performance', preserveDrawingBuffer: !!opt.preserve });
    } catch (e) { K.dispose(); return null; }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(W0, H0);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = T.PCFSoftShadowMap;
    renderer.toneMapping = T.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.0;
    if (T.sRGBEncoding) renderer.outputEncoding = T.sRGBEncoding;
    renderer.physicallyCorrectLights = true;
    const canvas = renderer.domElement;
    canvas.className = 'p3gl-canvas';
    canvas.setAttribute('aria-hidden', 'true');
    host.appendChild(canvas);

    const scene = new T.Scene();
    scene.background = new T.Color('#0f172a');
    scene.fog = new T.Fog('#0f172a', span * 2.2, span * 4.5);
    const camera = new T.PerspectiveCamera(45, W0 / H0, 0.05, 120);
    const controls = new T.OrbitControls(camera, canvas);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.maxPolarAngle = Math.PI / 2 - 0.05;
    controls.minDistance = 0.6;
    controls.maxDistance = span * 3;
    controls.screenSpacePanning = true;

    // 빛: 은은한 전체 빛 + 해(그림자) + 푸른 보조광
    scene.add(new T.AmbientLight('#ffffff', 0.32));
    scene.add(new T.HemisphereLight('#fff4e6', '#1e293b', 0.55));
    const sun = new T.DirectionalLight('#fff3e0', 3.1);
    sun.position.set(cx + 4.5, 12, cz + 7);
    sun.target.position.set(cx, 0, cz);
    sun.castShadow = true;
    const small = Math.min(W0, H0) < 520;
    sun.shadow.mapSize.set(small ? 1024 : 2048, small ? 1024 : 2048);
    const sc = sun.shadow.camera;
    sc.near = 1; sc.far = 40; sc.left = -span * 0.75; sc.right = span * 0.75; sc.top = span * 0.75; sc.bottom = -span * 0.75;
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.02;
    scene.add(sun, sun.target);
    const fill = new T.DirectionalLight('#a5c8f5', 0.55);
    fill.position.set(cx - 6, 8, cz - 6);
    scene.add(fill);

    // 땅
    const ground = new T.Mesh(new T.PlaneGeometry(span * 6, span * 6), new T.MeshStandardMaterial({ color: new T.Color('#0b1220'), roughness: 0.95 }));
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(cx, -0.012, cz);
    ground.receiveShadow = true;
    scene.add(ground);
    // 구조체 바탕(집 아래 판)
    K.box(scene, B.w / 100 + 0.3, 0.1, B.h / 100 + 0.3, cx, -0.06, cz, K.std('#1e293b', 0.9), { noCast: true });

    // 바닥 무늬
    const woodTex = K.canvasTex(512, 512, (c, Wd, Hd) => {
      const R = rng('wood');
      const plank = Hd / 8;
      for (let i = 0; i < 8; i++) {
        let x = -R() * 200;
        while (x < Wd) {
          const len = 160 + R() * 220, v = 0.86 + R() * 0.14;
          c.fillStyle = 'rgb(' + Math.round(255 * v) + ',' + Math.round(255 * v * 0.97) + ',' + Math.round(255 * v * 0.92) + ')';
          c.fillRect(x, i * plank, len, plank);
          c.strokeStyle = 'rgba(80,50,20,.18)';
          c.lineWidth = 2;
          c.strokeRect(x, i * plank, len, plank);
          for (let k = 0; k < 4; k++) { c.strokeStyle = 'rgba(120,80,40,' + (0.05 + R() * 0.06) + ')'; c.beginPath(); const yy = i * plank + R() * plank; c.moveTo(x, yy); c.bezierCurveTo(x + len / 3, yy + (R() - 0.5) * 6, x + (2 * len) / 3, yy + (R() - 0.5) * 6, x + len, yy); c.stroke(); }
          x += len;
        }
      }
    }, true);
    const tileTex = K.canvasTex(256, 256, (c, Wd, Hd) => {
      c.fillStyle = '#ffffff'; c.fillRect(0, 0, Wd, Hd);
      c.strokeStyle = 'rgba(40,50,60,.28)'; c.lineWidth = 3;
      for (let i = 0; i <= 4; i++) { c.beginPath(); c.moveTo(i * Wd / 4, 0); c.lineTo(i * Wd / 4, Hd); c.stroke(); c.beginPath(); c.moveTo(0, i * Hd / 4); c.lineTo(Wd, i * Hd / 4); c.stroke(); }
    }, true);
    const floorKind = (kind) => (kind === 'bath' ? ['tile', '#7d8a99', 1.2] : kind === 'utility' || kind === 'balcony' || kind === 'storage' ? ['tile', '#a3adb8', 1.2]
      : kind === 'entrance' ? ['tile', '#4b5563', 1.2] : kind === 'bedroom' ? ['wood', C.floorRoom, 1.6] : ['wood', C.floorWood, 1.6]);
    P.rooms.forEach((r) => {
      if (!(r.w > 0 && r.h > 0)) return;
      const [tk, col, per] = floorKind(r.kind);
      const rw = r.w / 100, rd = r.h / 100;
      const pg = new T.PlaneGeometry(rw, rd);
      const uv = pg.attributes.uv;
      for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * rw / per, uv.getY(i) * rd / per);
      const m = new T.Mesh(pg, K.std(col, tk === 'wood' ? 0.55 : 0.4, 0.02, { map: tk === 'wood' ? woodTex : tileTex }));
      m.userData.ownGeo = true;
      m.rotation.x = -Math.PI / 2;
      m.position.set((r.x + r.w / 2) / 100, 0.001, (r.y + r.h / 2) / 100);
      m.receiveShadow = true;
      scene.add(m);
    });
    // 방 이름 · 남쪽 표시 (바닥 글씨)
    function floorText(text, x, z, size, color) {
      const fs = 64;
      const tmp = document.createElement('canvas').getContext('2d');
      tmp.font = '700 ' + fs + 'px system-ui, sans-serif';
      const tw = Math.ceil(tmp.measureText(text).width) + 24;
      const tex = K.canvasTex(tw, fs + 24, (c, Wd, Hd) => { c.font = '700 ' + fs + 'px system-ui, sans-serif'; c.fillStyle = color; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(text, Wd / 2, Hd / 2 + 2); });
      const mesh = new T.Mesh(new T.PlaneGeometry(size * tw / (fs + 24), size), new T.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false }));
      mesh.userData.ownGeo = true;
      mesh.rotation.x = -Math.PI / 2;
      mesh.position.set(x, 0.004, z);
      mesh.renderOrder = 2;
      scene.add(mesh);
      return mesh;
    }
    P.rooms.forEach((r) => {
      if (r.w < 60 || r.h < 60) return;
      const sz = clamp(Math.min(r.w, r.h) / 100 * 0.16, 0.14, 0.3);
      floorText(r.name, (r.x + r.w / 2) / 100, (r.y + Math.min(r.h / 2, 30)) / 100, sz, 'rgba(255,255,255,0.55)');
    });
    floorText('☀ 남쪽(전면)', cx, (B.y + B.h) / 100 + 0.45, 0.32, 'rgba(251,146,60,0.95)');

    // 고정물
    const wallLike = [];
    P.fixtures.forEach((f) => {
      const r = buildFixture(K, f, P.rooms);
      if (!r) return;
      if (r.wallLike) { wallLike.push(f); return; }
      r.obj.userData.fixture = f.name;
      scene.add(r.obj);
    });

    // 벽 (보기: cut 단면 · glass 반투명 · full 전체) — 바깥 벽은 단면에서 조금 더 높게
    const wallGroup = new T.Group();
    scene.add(wallGroup);
    const inRoom = (x, y) => P.rooms.some((r) => x > r.x + 0.5 && x < r.x + r.w - 0.5 && y > r.y + 0.5 && y < r.y + r.h - 0.5);
    const segs = geo.wallSegments ? geo.wallSegments(P) : [];
    segs.forEach((s) => {
      const m = (s.a + s.b) / 2;
      const p1 = s.v ? [s.at - 8, m] : [m, s.at - 8], p2 = s.v ? [s.at + 8, m] : [m, s.at + 8];
      s.outer = !(inRoom(p1[0], p1[1]) && inRoom(p2[0], p2[1]));
    });
    const voidRects = geo.voids ? geo.voids(P) : [];
    let wallMode = opt.walls || 'cut';
    function wallMats(mode) {
      if (mode === 'glass') return { inner: K.std('#94a3b8', 0.3, 0.05, { transparent: true, opacity: 0.22, depthWrite: false }), outer: K.std('#94a3b8', 0.3, 0.05, { transparent: true, opacity: 0.22, depthWrite: false }), top: null };
      return { inner: K.std('#f1f5f9', 0.75, 0.02), outer: K.std('#cbd5e1', 0.7, 0.03), top: K.std('#475569', 0.6) };
    }
    function buildWalls() {
      while (wallGroup.children.length) wallGroup.remove(wallGroup.children[0]);
      const M = wallMats(wallMode), winMat = K.glass('#93c5fd', wallMode === 'glass' ? 0.2 : 0.38);
      const hOf = (outer) => (wallMode === 'cut' ? (outer ? CUT.outer : CUT.inner) : FULL_H);
      const add = (x, y0, z, w, h, d, mat, cast) => { if (h <= 0.002) return; const mm = K.box(wallGroup, w, h, d, x, y0 + h / 2, z, mat, { noCast: !cast }); return mm; };
      segs.forEach((s) => {
        const len = (s.b - s.a) / 100, mid = (s.a + s.b) / 200, at = s.at / 100;
        const x = s.v ? at : mid, z = s.v ? mid : at, w = s.v ? WALL_T : len, d = s.v ? len : WALL_T;
        const H = hOf(s.outer), mat = s.outer ? M.outer : M.inner;
        if (!s.win) { add(x, 0, z, w, H, d, mat, wallMode !== 'glass'); return; }
        const sill = Math.min(WIN_SILL, H);
        add(x, 0, z, w, sill, d, mat, wallMode !== 'glass');
        const gTop = Math.min(WIN_TOP, H);
        if (gTop > sill) add(x, sill, z, s.v ? 0.02 : w, gTop - sill, s.v ? d : 0.02, winMat, false);
        if (H > gTop) add(x, gTop, z, w, H - gTop, d, mat, wallMode !== 'glass');
      });
      const vh = wallMode === 'cut' ? CUT.inner : FULL_H;
      voidRects.forEach((v) => add((v.x + v.w / 2) / 100, 0, (v.y + v.h / 2) / 100, v.w / 100, vh, v.h / 100, M.inner, wallMode !== 'glass'));
      wallLike.forEach((f) => add((f.x + f.w / 2) / 100, 0, (f.y + f.h / 2) / 100, f.w / 100, vh, f.h / 100, M.inner, wallMode !== 'glass'));
      // 문 위 벽(전체 보기)
      if (wallMode !== 'cut') P.doors.forEach((d) => {
        const r = d.v ? { x: d.x / 100, z: (d.y + d.w / 2) / 100, w: WALL_T, d: d.w / 100 } : { x: (d.x + d.w / 2) / 100, z: d.y / 100, w: d.w / 100, d: WALL_T };
        add(r.x, DOOR_H, r.z, r.w, FULL_H - DOOR_H, r.d, M.inner, false);
      });
      buildDoors();
    }
    // 방 문짝 (닫힘 ↔ 열림, 비율대로)
    const doorObjs = [];
    function buildDoors() {
      doorObjs.splice(0).forEach((o) => wallGroup.remove(o));
      const H = wallMode === 'cut' ? CUT.inner : DOOR_H;
      P.doors.forEach((d) => {
        if (!d.hingeAt || !d.shut || !d.open) return;
        const [hx, hy] = d.hingeAt;
        const a0 = Math.atan2(d.shut[1] - hy, d.shut[0] - hx), a1 = Math.atan2(d.open[1] - hy, d.open[0] - hx);
        const len = Math.hypot(d.shut[0] - hx, d.shut[1] - hy) / 100;
        if (!(len > 0.05)) return;
        const pivot = new T.Group();
        pivot.position.set(hx / 100, 0, hy / 100);
        const leafMat = wallMode === 'glass' ? K.std(C.door, 0.5, 0.02, { transparent: true, opacity: 0.4, depthWrite: false }) : K.std(C.door, 0.5, 0.02);
        const lm = K.box(pivot, len, H, 0.04, len / 2, H / 2, 0, leafMat);
        if (H > 1) K.cyl(lm, 0.012, 0.012, 0.1, len / 2 - 0.07, 0, 0.04, K.std(C.chrome, 0.2, 0.85)).rotation.x = Math.PI / 2;
        let da = a1 - a0;
        while (da > Math.PI) da -= 2 * Math.PI;
        while (da < -Math.PI) da += 2 * Math.PI;
        pivot.userData.door = { a0, da };
        wallGroup.add(pivot);
        doorObjs.push(pivot);
      });
      applyDoors();
    }
    function applyDoors() {
      doorObjs.forEach((p) => { const { a0, da } = p.userData.door; p.rotation.y = -(a0 + da * ratio); });
    }

    // 짐
    const itemObjs = new Map();
    const prep = MV.plan3d && MV.plan3d._prepChairs;
    if (prep) prep(P);
    P.items.forEach((it) => {
      try {
        const m = buildModel(K, it);
        scene.add(m.obj);
        itemObjs.set(it.pid, Object.assign(m, { it }));
      } catch (e) { console.error('[plan3d] 모델', it.name, e); }
    });
    // 다른 짐 위에 올리는 짐: 전자레인지 → 전자레인지 수납장 · 간이박스 → 캐비닛장·어린이 책장 위(한 개씩)
    const extraItems = {};
    const ON_TOP = { 'inv-microwave': ['inv-microwave-cabinet'], 'inv-top-box': ['inv-cabinet', 'inv-cabinet-2', 'inv-bookshelf-kid'] };
    (P.extras || []).forEach((t) => {
      const bases = P.items.filter((b) => (ON_TOP[t.invId] || []).includes(b.invId));
      if (!bases.length) return;
      const qty = Math.max(1, Math.round(num(t.qty, 1)));
      bases.slice(0, t.invId === 'inv-microwave' ? 1 : qty).forEach((base, i) => {
        const dw = Math.min(t.dw, base.dw), dd = Math.min(t.dd, base.dd);
        const it = { pid: 'top-' + t.invId + (i ? '-' + i : ''), invId: t.invId, name: t.name, cat: t.cat, tag: t.tag, fate: t.fate, url: t.url, room: base.room, front: base.front,
          rot: base.rot, dw, dd, hgt: t.hgt, z0: (base.z0 || 0) + base.hgt * Math.max(1, base.n || 1), onTop: base.name, x: base.x + (base.w - (base.rot % 180 ? dd : dw)) / 2, y: base.y + (base.h - (base.rot % 180 ? dw : dd)) / 2,
          w: base.rot % 180 ? dd : dw, h: base.rot % 180 ? dw : dd,
          open: t.invId === 'inv-microwave' ? { kind: 'front-door', need: Math.round(dd * 0.9), free: base.open ? Math.min(Math.round(dd * 0.9), base.open.free) : Math.round(dd * 0.9), by: base.open ? base.open.by : '', top: 0 } : null };
        const m = buildModel(K, it);
        scene.add(m.obj);
        itemObjs.set(it.pid, Object.assign(m, { it }));
        extraItems[it.pid] = it;
      });
    });

    // 비율(0 닫힘 ~ 1 열림)
    let ratio = clamp(num(opt.ratio, 0), 0, 1);
    function applyRatio() { itemObjs.forEach((m) => m.update(ratio)); applyDoors(); need(); }
    buildWalls();
    applyRatio();

    // 고른 짐 테두리
    let selBox = null;
    function select(pid) {
      if (selBox) { scene.remove(selBox); selBox.geometry.dispose(); selBox = null; }
      const m = pid && itemObjs.get(pid);
      if (m) {
        const b3 = new T.Box3().setFromObject(m.obj);
        selBox = new T.Box3Helper(b3, new T.Color('#fb923c'));
        selBox.material.depthTest = false;
        selBox.renderOrder = 5;
        scene.add(selBox);
      }
      need();
    }

    // 이름표 (화면 위 글씨)
    const labelLayer = document.createElement('div');
    labelLayer.className = 'p3gl-labels';
    host.appendChild(labelLayer);
    let labelsOn = !!opt.labels;
    const labels = [];
    itemObjs.forEach((m, pid) => {
      if (pid.startsWith('top-inv-top-box')) return;
      const it = m.it;
      const elx = document.createElement('span');
      elx.className = 'p3gl-label';
      elx.textContent = shortName(it.name, 9) + (it.n > 1 ? ' ×' + it.n : '');
      labelLayer.appendChild(elx);
      labels.push({ el: elx, pos: new T.Vector3((it.x + it.w / 2) / 100, ((it.z0 || 0) + it.hgt * Math.max(1, it.n || 1)) / 100 + 0.08, (it.y + it.h / 2) / 100) });
    });
    const v3 = new T.Vector3();
    function placeLabels() {
      labelLayer.hidden = !labelsOn;
      if (!labelsOn) return;
      const Wd = canvas.clientWidth, Hd = canvas.clientHeight;
      labels.forEach((L) => {
        v3.copy(L.pos).project(camera);
        const vis = v3.z < 1 && Math.abs(v3.x) < 1.05 && Math.abs(v3.y) < 1.05;
        L.el.style.display = vis ? '' : 'none';
        if (vis) L.el.style.transform = 'translate(' + Math.round((v3.x * 0.5 + 0.5) * Wd) + 'px,' + Math.round((-v3.y * 0.5 + 0.5) * Hd) + 'px) translate(-50%,-100%)';
      });
    }

    // 시점 (부드럽게 옮기기)
    function viewTo(pos, target, ms) {
      if (!ms) { camera.position.copy(pos); controls.target.copy(target); controls.update(); need(); return; }
      anim = { t0: performance.now(), ms, p0: camera.position.clone(), t0v: controls.target.clone(), p1: pos, t1: target };
      need();
    }
    function view(id, ms) {
      const T3 = (x, y, z) => new T.Vector3(x, y, z);
      if (!id || id === 'all') return viewTo(T3(cx, span * 0.98, cz + span * 0.52), T3(cx, 0.2, cz + span * 0.03), ms);
      if (id === 'top') return viewTo(T3(cx, span * 1.55, cz + 0.02), T3(cx, 0, cz), ms);
      const r = P.rooms.find((x) => x.id === id);
      if (!r) return;
      // 방이 화면에 꽉 차게: 남쪽 위(약 55°)에서 내려다보는 거리 = 방 가로·세로가 시야에 들어오는 거리 중 큰 쪽
      const rx = (r.x + r.w / 2) / 100, rz = (r.y + r.h / 2) / 100, rw = r.w / 100 + 0.5, rd = r.h / 100 + 0.5;
      const tv = Math.tan(deg(camera.fov / 2)), th = tv * camera.aspect, pitch = deg(55);
      const dist = Math.max(rw / 2 / th, (rd * Math.sin(pitch) + 1.0 * Math.cos(pitch)) / 2 / tv) * 1.12 + 0.6;
      viewTo(T3(rx, 0.5 + dist * Math.sin(pitch), rz + dist * Math.cos(pitch)), T3(rx, 0.5, rz), ms);
    }
    view(opt.view || 'all', 0);

    // 그리기 (바뀔 때만)
    controls.addEventListener('change', need);
    function frame(now) {
      if (!alive) return;
      raf = requestAnimationFrame(frame);
      if (anim) {
        const k = clamp((now - anim.t0) / anim.ms, 0, 1), e = 1 - Math.pow(1 - k, 3);
        camera.position.lerpVectors(anim.p0, anim.p1, e);
        controls.target.lerpVectors(anim.t0v, anim.t1, e);
        if (k >= 1) anim = null;
        dirty = true;
      }
      if (tween) {
        const k = clamp((now - tween.t0) / tween.ms, 0, 1), e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
        ratio = tween.a + (tween.b - tween.a) * e;
        itemObjs.forEach((m) => m.update(ratio)); applyDoors();
        if (k >= 1) { tween = null; if (opt.onRatio) opt.onRatio(ratio); }
        dirty = true;
      }
      if (controls.update()) dirty = true;
      if (!dirty) return;
      dirty = false;
      renderer.render(scene, camera);
      placeLabels();
    }
    raf = requestAnimationFrame(frame);
    function setRatio(r, animate) {
      r = clamp(num(r, 0), 0, 1);
      if (animate && Math.abs(r - ratio) > 0.01) { tween = { t0: performance.now(), ms: 600, a: ratio, b: r }; need(); return; }
      tween = null; ratio = r; applyRatio();
    }

    // 고르기(누르기 — 끌지 않았을 때)
    const ray = new T.Raycaster(), pt = new T.Vector2();
    let down = null;
    canvas.addEventListener('pointerdown', (e) => { down = { x: e.clientX, y: e.clientY }; if (opt.onTouch) opt.onTouch(); });
    canvas.addEventListener('pointerup', (e) => {
      if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 6) { down = null; return; }
      down = null;
      const r = canvas.getBoundingClientRect();
      pt.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      ray.setFromCamera(pt, camera);
      const objs = Array.from(itemObjs.values()).map((m) => m.obj);
      const hit = ray.intersectObjects(objs, true).find((x) => x.object.visible && x.object.isMesh && x.object.userData.pid);
      if (opt.onPick) opt.onPick(hit ? hit.object.userData.pid : null);
    });

    function resize() {
      const Wd = Math.max(50, host.clientWidth), Hd = Math.max(50, host.clientHeight);
      camera.aspect = Wd / Hd;
      camera.updateProjectionMatrix();
      renderer.setSize(Wd, Hd);
      need();
    }
    const ro = window.ResizeObserver ? new ResizeObserver(resize) : null;
    if (ro) ro.observe(host);
    canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); if (opt.onLost) opt.onLost(); });

    function dispose() {
      alive = false;
      cancelAnimationFrame(raf);
      if (ro) ro.disconnect();
      controls.dispose();
      scene.traverse((o) => { if (o.userData && o.userData.ownGeo && o.geometry) o.geometry.dispose(); if (o.isLineSegments && o.geometry) o.geometry.dispose(); if (o.material && o.material.map && o.userData.ownGeo) o.material.map.dispose(); });
      if (selBox) selBox.geometry.dispose();
      ground.geometry.dispose(); ground.material.dispose();
      K.dispose();
      renderer.dispose();
      if (renderer.forceContextLoss) try { renderer.forceContextLoss(); } catch (e) { /* 무시 */ }
      canvas.remove();
      labelLayer.remove();
    }

    return {
      setRatio, view, select,
      setWalls(m) { wallMode = m === 'glass' || m === 'full' ? m : 'cut'; buildWalls(); need(); },
      setLabels(on) { labelsOn = !!on; need(); },
      items: extraItems,
      limitedCount: () => Array.from(itemObjs.values()).filter((m) => m.limited).length,
      ratio: () => ratio,
      resize, dispose,
      snapshot() { renderer.render(scene, camera); return canvas.toDataURL('image/png'); },
    };
  }

  function shortName(s, n) {
    const a = Array.from(String(s || '').replace(/\s*\(.*$/, '').replace(/\s*—.*$/, ''));
    return a.length > n ? a.slice(0, n - 1).join('') + '…' : a.join('');
  }

  MV.plan3dGL = { supported, load, create };
})();
