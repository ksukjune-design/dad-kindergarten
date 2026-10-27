/* ============================================================
   3D 보기 — WebGL 그림 (three.js r147, move/vendor/ 에 같이 둠 · MIT)
   view-plan3d.js 의 창(도구·정보 카드)이 이 그림을 써요. three.js 를 못 불러오거나 WebGL 이 안 되면 CSS 3D 그림으로 보여요.
   가족이 만든 SpacePlanner 3D(10/24, three.js) 방식을 우리 자료(MV.calc.plan3d)에 맞춰 옮겼어요:
     · 가구·가전을 코드로 빚은 모델(냉장고 양문·건조기 둥근 문·통돌이 뚜껑·식탁 의자·서랍·옷장 문·책·옷걸이 옷 …)
     · 그림자(해 + 보조광, ACES 톤) + 은은한 주변 반사(환경광), 방 바닥(나무·타일 무늬), 벽 보기(단면 1m · 반투명 · 전체 2.3m),
       시점(전체 조감도·방), 문 열림 비율(0 닫힘 ~ 1 열림) — 앞이 막혀 끝까지 못 여는 문·서랍은 열 수 있는 만큼만(주황 테두리)
   단위: 1 = 1m. 세계 X = 도면 x(동), Z = 도면 y(남), Y = 위. 짐 모델은 바닥 가운데가 원점, 정면이 +Z(폭 = X, 깊이 = Z),
         도면 rot(정면 방향 0 남 · 90 서 · 180 북 · 270 동) → rotation.y = −rot.
   빠르게(보이는 그림은 그대로):
     · 움직이지 않는 조각은 짐·고정물·벽·바닥마다 재질별로 한 모양으로 합쳐 그려요(전체 조감도 그리기 930번 → 470번쯤). 여닫는 문·서랍·반투명한 것,
       같은 재질끼리 겹치며 면을 나눠 갖는 조각(모서리)은 따로 — 그래야 모서리 픽셀까지 전과 같아요.
     · 바뀔 때만 그려요(가만히 있으면 화면 갱신 요청도 멈춰요). 그림자는 장면이 바뀔 때만 다시.
     · 손가락으로 쓰는 촘촘한 화면(휴대폰·태블릿)은 돌리는 동안만 픽셀을 덜 쓰고, 멈추면 바로 원래 선명도로 다시 그려요(마우스로 쓰는 컴퓨터는 늘 그대로).
     · 창을 닫아도 그림판(셰이더)·환경광·무늬·재질·모양을 잠시(3분) 남겨 다시 열 때 빨리 떠요. 화면을 숨기거나 3분이 지나면 돌려줘요.
   제공  MV.plan3dGL = { supported(), load() → Promise<boolean>, create(host, P, opt) → 엔진, TABLE, PIDOR(피도르 캐비닛 색 — CSS 3D 도 같은 색) }
   ============================================================ */
(function () {
  'use strict';
  const VENDOR = [['vendor/three-r147.min.js', () => !!window.THREE], ['vendor/three-r147-orbit.js', () => !!(window.THREE && window.THREE.OrbitControls)]];
  const CUT = { inner: 0.9, outer: 1.4 };   // 단면 보기 벽 높이 (m) — 안쪽 벽 · 바깥 벽
  const FULL_H = 2.3, DOOR_H = 2.1, WIN_SILL = 0.9, WIN_TOP = 2.1, WALL_T = 0.06;
  const TABLE = { inset: 4, leg: 5 };      // 식탁 다리: 가장자리에서 들어온 거리 · 굵기 (cm) — 의자 넣기(view-plan3d.js)와 같은 값
  const LIM = '#f08c00';                   // 끝까지 못 여는 문·서랍 테두리
  const num = (v, d) => { const n = parseFloat(v); return isFinite(n) ? n : d; };
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const deg = (d) => (d * Math.PI) / 180;

  /* ---------------- 불러오기 ---------------- */
  let sup = null;
  function supported() {
    if (sup != null) return sup;
    try {
      const c = document.createElement('canvas');
      const gl = c.getContext('webgl2') || c.getContext('webgl');
      sup = !!(window.WebGLRenderingContext && gl);
      const lose = gl && gl.getExtension('WEBGL_lose_context');
      if (lose) lose.loseContext();   // 검사용 문맥은 바로 돌려줘요
    } catch (e) { sup = false; }
    return sup;
  }
  // 받는 중인 파일은 끝까지 기다려요(같은 파일을 두 번 넣지 않아요 — three.js 가 두 번 돌면 안 돼요). 못 받은 파일만 다음에 새로 받아요
  const scripts = {};
  function loadScript(src) {
    if (scripts[src]) return scripts[src];
    return (scripts[src] = new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = src; s.async = false;
      s.onload = () => res();
      s.onerror = () => { delete scripts[src]; s.remove(); rej(new Error('불러오기 실패: ' + src)); };
      document.head.appendChild(s);
    }));
  }
  let loading = null;
  /** three.js 받기 → 다 됐으면 true. 부를 때마다 15초까지만 기다려요(느리면 이번 창은 CSS 그림, 받기는 계속 — 다음에 열 때 씀) */
  function load() {
    if (VENDOR.every(([, ok]) => ok())) return Promise.resolve(true);
    if (!loading) {
      loading = (async () => {
        for (const [src, ok] of VENDOR) if (!ok()) await loadScript(src);
        return VENDOR.every(([, ok]) => ok());
      })().catch(() => false).then((ok) => { loading = null; return ok; });
    }
    const timeout = new Promise((res) => setTimeout(() => res(false), 15000));
    return Promise.race([loading, timeout]);
  }

  /* ---------------- 재질 · 모양 도우미 ---------------- */
  /** 둥근 모서리 상자 (three.js examples RoundedBoxGeometry r147 방식 · MIT) — 가운데 칸이 평평한 면, 나머지 칸이 둥근 모서리 */
  function roundedBoxGeometry(T, width, height, depth, segments, radius) {
    segments = segments * 2 + 1;
    radius = Math.min(width / 2, height / 2, depth / 2, radius);
    const base = new T.BoxGeometry(1, 1, 1, segments, segments, segments);
    const g = base.toNonIndexed();
    base.dispose();
    const pos = g.attributes.position.array, nor = g.attributes.normal.array;
    const p = new T.Vector3(), n = new T.Vector3();
    const box = new T.Vector3(width, height, depth).divideScalar(2).subScalar(radius);
    const half = 0.5 / segments;
    for (let i = 0; i < pos.length; i += 3) {
      p.fromArray(pos, i);
      n.copy(p);
      n.x -= Math.sign(n.x) * half; n.y -= Math.sign(n.y) * half; n.z -= Math.sign(n.z) * half;
      n.normalize();
      pos[i] = box.x * Math.sign(p.x) + n.x * radius;
      pos[i + 1] = box.y * Math.sign(p.y) + n.y * radius;
      pos[i + 2] = box.z * Math.sign(p.z) + n.z * radius;
      nor[i] = n.x; nor[i + 1] = n.y; nor[i + 2] = n.z;
    }
    // 무늬 좌표: BoxGeometry 의 면 순서(+x −x +y −y +z −z)대로 면마다 평평하게 다시 — 원래 좌표는 가운데 칸(1/7)만 써서 무늬가 뭉개져요
    const uv = g.attributes.uv.array, per = segments * segments * 6, TILE = 0.6;
    for (let i = 0, v = 0; i < pos.length; i += 3, v++) {
      const side = Math.floor(v / per), x = pos[i], y = pos[i + 1], z = pos[i + 2];
      let u, w;
      if (side < 2) { u = side === 0 ? -z : z; w = y; }
      else if (side < 4) { u = x; w = side === 2 ? -z : z; }
      else { u = side === 4 ? x : -x; w = y; }
      uv[v * 2] = u / TILE + 0.5; uv[v * 2 + 1] = w / TILE + 0.5;
    }
    g.attributes.position.needsUpdate = true;
    g.attributes.normal.needsUpdate = true;
    g.attributes.uv.needsUpdate = true;
    return g;
  }

  /** 재질·모양 모음 — 같은 값이면 하나를 같이 써요. 다시 열 때도 그대로 쓰고(셰이더·올린 모양 재사용), 장면을 다 만든 뒤 이번에 안 쓴 것은 버려요(sweep) */
  function kit(T) {
    const mats = new Map(), geos = new Map(), usedM = new Set(), usedG = new Set();
    const mat = (key, make) => { usedM.add(key); let m = mats.get(key); if (!m) { m = make(); mats.set(key, m); } return m; };
    const xkey = (extra) => (extra ? Object.keys(extra).sort().map((k) => { const v = extra[k]; return k + ':' + (v && v.uuid ? v.uuid : v && v.isColor ? v.getHexString() : String(v)); }).join(',') : '');
    const std = (color, rough, metal, extra) => mat('s|' + color + '|' + rough + '|' + metal + '|' + xkey(extra),
      () => new T.MeshStandardMaterial(Object.assign({ color: new T.Color(color), roughness: rough == null ? 0.6 : rough, metalness: metal || 0, envMapIntensity: 0.7 }, extra || {})));
    const glass = (color, opacity) => mat('g|' + color + '|' + opacity, () => new T.MeshStandardMaterial({ color: new T.Color(color), roughness: 0.06, metalness: 0.1, envMapIntensity: 1.2, transparent: true, opacity: opacity == null ? 0.45 : opacity, depthWrite: false }));
    const line = (color) => mat('l|' + color, () => new T.LineBasicMaterial({ color: new T.Color(color) }));
    const r3 = (v) => Math.round(v * 1000) / 1000;
    const cache = (k, make) => { usedG.add(k); let g = geos.get(k); if (!g) { g = make(); geos.set(k, g); } return g; };
    const boxGeo = (w, h, d) => cache('b|' + r3(w) + '|' + r3(h) + '|' + r3(d), () => new T.BoxGeometry(Math.max(0.002, w), Math.max(0.002, h), Math.max(0.002, d)));
    const rboxGeo = (w, h, d, r) => cache('r|' + r3(w) + '|' + r3(h) + '|' + r3(d) + '|' + r3(r), () => roundedBoxGeometry(T, Math.max(0.004, w), Math.max(0.004, h), Math.max(0.004, d), 3, r));
    const cylGeo = (rt, rb, h, seg) => cache('c|' + r3(rt) + '|' + r3(rb) + '|' + r3(h) + '|' + (seg || 24), () => new T.CylinderGeometry(rt, rb, Math.max(0.002, h), seg || 24));
    const sphGeo = (r, ws, hs) => cache('p|' + r3(r) + '|' + ws + '|' + hs, () => new T.SphereGeometry(r, ws || 20, hs || 12));
    const torGeo = (r, t) => cache('t|' + r3(r) + '|' + r3(t), () => new T.TorusGeometry(r, t, 10, 36));
    const shadow = (m, cast, recv) => { m.castShadow = cast !== false; m.receiveShadow = recv !== false; return m; };
    const put = (parent, geo, material, x, y, z, o) => { const m = shadow(new T.Mesh(geo, material), !(o && o.noCast), true); m.position.set(x, y, z); parent.add(m); return m; };
    /** 상자: 가운데 (x, y, z), 크기 w(X)·h(Y)·d(Z) */
    const box = (parent, w, h, d, x, y, z, material, o) => put(parent, boxGeo(w, h, d), material, x, y, z, o);
    /** 둥근 모서리 상자 (r = 모서리 반지름 m) */
    const rbox = (parent, w, h, d, r, x, y, z, material, o) => put(parent, rboxGeo(w, h, d, r), material, x, y, z, o);
    const cyl = (parent, rt, rb, h, x, y, z, material, seg) => put(parent, cylGeo(rt, rb, h, seg), material, x, y, z);
    const sph = (parent, r, x, y, z, material, sx, sy, sz) => { const m = put(parent, sphGeo(r), material, x, y, z); m.scale.set(sx || 1, sy || 1, sz || 1); return m; };
    const torus = (parent, r, t, x, y, z, material) => put(parent, torGeo(r, t), material, x, y, z);
    /** 테두리 선(주황: 끝까지 못 여는 문·서랍) */
    const edges = (mesh, color) => {
      const gg = mesh.geometry;
      if (!gg.boundingBox) gg.computeBoundingBox();
      const sz = gg.boundingBox.getSize(new T.Vector3()), c = gg.boundingBox.getCenter(new T.Vector3());
      const bg = new T.BoxGeometry(sz.x * 1.01 + 0.002, sz.y * 1.01 + 0.002, sz.z * 1.01 + 0.002);
      const eg = new T.EdgesGeometry(bg);
      bg.dispose();
      eg.translate(c.x, c.y, c.z);
      const l = new T.LineSegments(eg, line(color));
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
      return t;
    };
    /** 옷 한 벌(어깨선 있는 몸판) — 봉과 직각(폭 = Z), 위 끝(목)이 원점 */
    const garmentGeo = (len, wid) => cache('gar|' + r3(len) + '|' + r3(wid), () => {
      const s = new T.Shape();
      const sh = Math.min(0.07, len * 0.12), hw = wid / 2;
      s.moveTo(-0.05, 0); s.lineTo(-hw, -sh); s.lineTo(-hw * 0.92, -len); s.lineTo(hw * 0.92, -len); s.lineTo(hw, -sh); s.lineTo(0.05, 0); s.lineTo(-0.05, 0);
      const g = new T.ExtrudeGeometry(s, { depth: 0.02, bevelEnabled: true, bevelThickness: 0.006, bevelSize: 0.006, bevelSegments: 2 });
      g.translate(0, 0, -0.01);
      g.rotateY(Math.PI / 2);
      return g;
    });
    let texCache = null;
    /** 무늬 텍스처(나무결·천·대리석·바구니·바닥) — 한 번 만들어 계속 써요 */
    const tex = () => texCache || (texCache = textures(K));
    const begin = () => { usedM.clear(); usedG.clear(); };
    const sweep = () => {
      mats.forEach((m, k) => { if (!usedM.has(k)) { m.dispose(); mats.delete(k); } });
      geos.forEach((g, k) => { if (!usedG.has(k)) { g.dispose(); geos.delete(k); } });
    };
    const dispose = () => {
      mats.forEach((m) => m.dispose()); geos.forEach((g) => g.dispose()); mats.clear(); geos.clear();
      if (texCache) Object.keys(texCache).forEach((k) => texCache[k].dispose());
      texCache = null;
    };
    const K = { T, std, glass, line, box, rbox, cyl, sph, torus, edges, canvasTex, garmentGeo, boxGeo, put, tex, begin, sweep, dispose };
    return K;
  }

  /** 움직이지 않는 조각을 재질(+그림자 설정)별로 한 모양으로 합쳐요 — 그리기 횟수가 줄고, 위치·면 방향·무늬 좌표는 그대로라 그림은 같아요.
      빼는 것: skip 안(여닫는 문·서랍·의자) · 반투명 · 자식이 있는 조각(테두리 선) · 숨긴 조각 · 뒤집힌(거울) 변환 · 그리는 순서를 정한 것.
      합친 모양의 상자(boundingBox)는 조각마다 상자를 옮겨 합친 것 — 고른 짐 테두리(Box3.setFromObject)가 전과 똑같아요 */
  const _mm = { m: null, inv: null, nm: null, b: null };
  function mergeStatic(T, root, skip) {
    if (!_mm.m) { _mm.m = new T.Matrix4(); _mm.inv = new T.Matrix4(); _mm.nm = new T.Matrix3(); _mm.b = new T.Box3(); }
    const { m, inv, nm, b } = _mm;
    root.updateMatrixWorld(true);
    inv.copy(root.matrixWorld).invert();
    const groups = new Map();
    const ok = (o) => o.isMesh && !o.isInstancedMesh && !o.isSkinnedMesh && o.visible && !o.children.length && o.renderOrder === 0 && !Array.isArray(o.material)
      && !o.material.transparent && o.geometry && o.geometry.attributes.position && o.geometry.attributes.normal && o.geometry.attributes.uv && !o.geometry.morphAttributes.position;
    (function walk(o) {
      for (const c of o.children) {
        if (skip && skip.has(c)) continue;
        if (!c.visible) continue;
        if (ok(c)) {
          m.multiplyMatrices(inv, c.matrixWorld);
          if (m.determinant() <= 0) continue;
          const k = c.material.uuid + '|' + c.castShadow + '|' + c.receiveShadow;
          let g = groups.get(k);
          if (!g) groups.set(k, g = []);
          g.push(c);
        } else if (!c.isMesh && !c.isLine && !c.isPoints && !c.isSprite) walk(c);
      }
    })(root);
    groups.forEach((all) => {
      if (all.length < 2) return;
      // 같은 재질 조각이 겹치면서 같은 평면의 면을 나눠 가지면(옷장 옆판·윗판 모서리 등) 따로 둬요 — 그런 면은 카메라 거리 순서로 보이는 쪽이
      // 정해지는데, 합치면 순서가 고정돼 모서리 몇 픽셀이 달라져요. 그냥 서로 꿰뚫는 것(의자 다리·틀)은 깊이로 정해져서 합쳐도 같아요
      const E = 1e-5;
      const bb = all.map((o) => {
        const g = o.geometry; if (!g.boundingBox) g.computeBoundingBox();
        m.multiplyMatrices(inv, o.matrixWorld);
        const e = m.elements, axis = [0, 4, 8].every((c) => [0, 1, 2].filter((r) => Math.abs(e[c + r]) > 1e-6).length === 1);   // 90° 단위로만 돌았는지
        const b2 = g.boundingBox.clone().applyMatrix4(m); b2.axis = axis; return b2;
      });
      const near = (a, b) => Math.abs(a - b) < E;
      const hit = (p, q) => p.min.x < q.max.x - E && q.min.x < p.max.x - E && p.min.y < q.max.y - E && q.min.y < p.max.y - E && p.min.z < q.max.z - E && q.min.z < p.max.z - E
        && (!p.axis || !q.axis || near(p.min.x, q.min.x) || near(p.max.x, q.max.x) || near(p.min.y, q.min.y) || near(p.max.y, q.max.y) || near(p.min.z, q.min.z) || near(p.max.z, q.max.z));
      const list = all.filter((o, i) => !bb.some((q, j) => j !== i && hit(bb[i], q)));
      if (list.length < 2) return;
      let nv = 0, ni = 0;
      list.forEach((o) => { const g = o.geometry; nv += g.attributes.position.count; ni += g.index ? g.index.count : g.attributes.position.count; });
      const pos = new Float32Array(nv * 3), nor = new Float32Array(nv * 3), uv = new Float32Array(nv * 2);
      const idx = nv > 65535 ? new Uint32Array(ni) : new Uint16Array(ni);
      const box = new T.Box3();
      let vo = 0, io = 0;
      const flat = (a, n) => (!a.isInterleavedBufferAttribute && a.itemSize === n && !a.normalized && a.array.length >= a.count * n ? a.array : null);
      list.forEach((o) => {
        const g = o.geometry, P = g.attributes.position, N = g.attributes.normal, U = g.attributes.uv;
        m.multiplyMatrices(inv, o.matrixWorld);
        nm.getNormalMatrix(m);
        const e = m.elements, q = nm.elements, pa = flat(P, 3), na = flat(N, 3), ua = flat(U, 2);
        for (let i = 0; i < P.count; i++) {
          const x = pa ? pa[i * 3] : P.getX(i), y = pa ? pa[i * 3 + 1] : P.getY(i), z = pa ? pa[i * 3 + 2] : P.getZ(i), j = (vo + i) * 3;
          pos[j] = e[0] * x + e[4] * y + e[8] * z + e[12]; pos[j + 1] = e[1] * x + e[5] * y + e[9] * z + e[13]; pos[j + 2] = e[2] * x + e[6] * y + e[10] * z + e[14];
          const u0 = na ? na[i * 3] : N.getX(i), u1 = na ? na[i * 3 + 1] : N.getY(i), u2 = na ? na[i * 3 + 2] : N.getZ(i);
          const nx = q[0] * u0 + q[3] * u1 + q[6] * u2, ny = q[1] * u0 + q[4] * u1 + q[7] * u2, nz = q[2] * u0 + q[5] * u1 + q[8] * u2;
          const len = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
          nor[j] = nx / len; nor[j + 1] = ny / len; nor[j + 2] = nz / len;
          uv[(vo + i) * 2] = ua ? ua[i * 2] : U.getX(i); uv[(vo + i) * 2 + 1] = ua ? ua[i * 2 + 1] : U.getY(i);
        }
        if (g.index) { const I = g.index, ia = I.array; for (let k = 0; k < I.count; k++) idx[io++] = ia[k] + vo; }
        else for (let k = 0; k < P.count; k++) idx[io++] = vo + k;
        if (!g.boundingBox) g.computeBoundingBox();
        box.union(b.copy(g.boundingBox).applyMatrix4(m));
        vo += P.count;
      });
      const geo = new T.BufferGeometry();
      geo.setAttribute('position', new T.BufferAttribute(pos, 3));
      geo.setAttribute('normal', new T.BufferAttribute(nor, 3));
      geo.setAttribute('uv', new T.BufferAttribute(uv, 2));
      geo.setIndex(new T.BufferAttribute(idx, 1));
      geo.boundingBox = box;
      geo.boundingSphere = box.getBoundingSphere(new T.Sphere());   // 상자를 감싸는 공(넉넉하게) — 화면 밖 거르기·누르기 검사용, 꼭짓점을 다시 훑지 않아요
      const first = list[0];
      const mesh = new T.Mesh(geo, first.material);
      mesh.castShadow = first.castShadow; mesh.receiveShadow = first.receiveShadow;
      mesh.userData = Object.assign({}, first.userData, { ownGeo: true, merged: list.length });
      // 합친 모양은 root 기준 좌표 — 첫 조각 자리에 끼워 둬요(그리는 순서가 전과 비슷하게)
      const at = root.children.indexOf(first);
      list.forEach((o) => { if (o.userData.ownGeo) o.geometry.dispose(); o.parent.remove(o); });
      mesh.parent = root;
      if (at >= 0) root.children.splice(Math.min(at, root.children.length), 0, mesh); else root.children.push(mesh);
      mesh.dispatchEvent({ type: 'added' });
    });
    return root;
  }

  /* 같은 결과가 나오는 가짜 난수 (책 색·높이 등) */
  function rng(seed) {
    let s = 0;
    for (const ch of String(seed)) s = (s * 31 + ch.charCodeAt(0)) >>> 0;
    return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  }

  /* ---------------- 재질 색 (실제 제품 색에 가깝게) ---------------- */
  const C = {
    white: '#f4f3ef', warmWhite: '#efebe4', ivory: '#f7f1e3', steel: '#c9ccd1', chrome: '#dfe4ea', dark: '#2a2c31', black: '#17181b',
    oak: '#caa37b', oakDk: '#a87c55', walnut: '#7a4f31', rubber: '#c49a6c', plywood: '#d9c3a0',
    fabricGray: '#8f9399', fabricGrayLt: '#a9adb3', fabricBeige: '#cdbfa8', linen: '#f5f1ea', duvet: '#c9dbe8', pillow: '#ffffff',
    fridge: '#d8d2c6', fridgeBody: '#c4beb3', panel: '#2e3440', acWhite: '#f6f7f8', boxLid: '#4c86c6', boxBody: '#e3eef7',
    door: '#e6dccb', counter: '#e9e7e2', cabinet: '#f1efea', floorWood: '#d4a373', floorRoom: '#e3c07e',
  };
  /* ---------------- 짐별 실제 제품 색 ----------------
     부분마다 [색, 거칠기(0 반짝 ~ 1 무광), 금속감(0 ~ 1)] — 장면 빛에 맞춰 살짝 부드럽게(완전한 검정·흰색은 피해요).
     BASE = 모델 종류별 기본 색(짐 목록에 없는 짐·가족이 더한 짐은 전과 똑같이 보여요),
     LOOK = 우리 짐(invId)마다 제품 정보(10/27 제품 페이지 검색 결과 — 사진을 직접 보지는 못했어요)에 맞춘 색 — BASE 위에 덮어써요.
     '추정' = 제품 정보로 색을 확정하지 못한 것. 가족이 색을 알려 주면 그 줄만 고쳐요. */
  const BASE = {
    fridge: { door: [C.fridge, 0.3, 0.25], body: [C.fridgeBody, 0.45, 0.2], handle: [C.chrome, 0.2, 0.85], panel: [C.panel, 0.25, 0.3], magic: null },
    dryer: { body: ['#e9e8e4', 0.35, 0.1], panel: [C.panel, 0.3, 0.3], dial: [C.chrome, 0.2, 0.8], filter: ['#dcdad5', 0.4, 0.1], back: ['#3a3f47', 0.5, 0.2],
      ring: ['#c9ccd1', 0.2, 0.85], ringT: 0.1, glass: ['#2b3644', 0.75] },
    washer: { body: ['#f3f4f5', 0.35, 0.1], deck: ['#e7e9ec', 0.3, 0.1], panel: [C.panel, 0.2, 0.3], drum: ['#2e3138', 0.5, 0.3], pulsator: null,
      frame: ['#d3d7dc', 0.3, 0.2], glass: ['#1f2a36', 0.55] },
    microwave: { body: ['#e9e9e6', 0.4, 0.2], column: [C.panel, 0.3, 0.2], display: null, door: ['#d9d9d6', 0.3, 0.2] },
    aircon: { body: [C.acWhite, 0.3, 0.05], outlet: ['#d5dbe1', 0.6, 0.1], blade: ['#bfc6ce', 0.8, 0.1], seam: null, display: ['#1d2733', 0.2, 0.2], grille: ['#c3cad2', 0.6] },
    table: { top: [C.oak, 0.45], frame: [C.oakDk] },
    chair: { frame: [C.oakDk], seat: [C.fabricBeige, 0.95, 0] },
    desk: { top: ['#f3f2ee', 0.45], leg: ['#3a3d42', 0.4, 0.5], back: ['#e9e8e4', 0.6] },
    vanity: { body: [C.rubber], back: ['#b98d60', 0.6], front: ['#cfa77a', 0.5], handle: [C.walnut, 0.4] },
    sofa: { fabric: [C.fabricGray, 0.95, 0], cushion: [C.fabricGrayLt, 0.95, 0], leg: [C.walnut, 0.5] },
    wardrobe: { body: [C.white, 0.5, 0.05], plinth: ['#e4e1da', 0.6], back: ['#dcd7cd', 0.8], door: ['#f7f6f2', 0.4, 0.05], handle: [C.chrome, 0.25, 0.8] },
    drawers: { body: [C.white, 0.45, 0.05], face: ['#fbfbf9', 0.4], inside: '#e9e2d6', handle: ['#9aa0a6', 0.3, 0.6], slot: false, grain: false },
    chest: { body: ['#f2efe9', 0.45, 0.05], face: ['#e9e2d6', 0.4], inside: '#e9e2d6', handle: ['#9aa0a6', 0.3, 0.6], slot: false, grain: false },
    toy: { boxes: ['#f6b5c0', '#a9dfcf', '#fbe39a', '#c9b8ec', '#a7d3f2'] },
    shelf: { body: [C.white, 0.5], back: ['#ebe7df', 0.8] },
    trolley: { frame: ['#f5f5f2', 0.4, 0.3], wheel: [C.dark, 0.5] },
    hanger: { frame: ['#e8e8e6', 0.3, 0.5], wheel: [C.dark, 0.5] },
    livingbox: { body: [C.boxBody, 0.35, 0.05], op: 0.9, lid: [C.boxLid, 0.4, 0.05], grip: [C.boxLid, 0.4], hatch: null },
    topbox: { body: ['#f2f2ef', 0.35, 0.05], op: 0.9, lid: ['#9aa3ad', 0.4, 0.05], grip: ['#9aa3ad', 0.4], hatch: null },
    basket: { body: ['#ffffff', 0.9] },
    trash: { body: ['#e9ebee', 0.4, 0.2], lid: ['#9aa3ad', 0.4, 0.3] },
  };
  /** 마켓비 피도르 철제 캐비닛 색 3가지 — 겉·안 한 색 철판(분체 도장): c = 몸통·문, in = 안쪽 뒤판·받침(그늘이라 조금 짙게), handle = 무광 스틸 손잡이(추정).
      가족 것은 화이트로 추정(캐비닛장 ①·② 같은 색). 색을 알면 PIDOR_COLOR 한 줄만 바꿔요('white' · 'lightgray' · 'darkgray') —
      3D(WebGL)의 몸통·문·안쪽·받침·손잡이와 CSS 3D(view-plan3d.js, MV.plan3dGL.PIDOR 로 받아요) 색이 함께 바뀌어요 */
  const PIDOR = {
    white: { c: '#edeeec', in: '#e6e7e5', handle: '#bfc3c7' },
    lightgray: { c: '#c6c9ca', in: '#bfc2c3', handle: '#a2a6aa' },
    darkgray: { c: '#4b4e52', in: '#45484c', handle: '#a9adb1', dark: true },
  };
  const PIDOR_COLOR = 'white';
  const PD = PIDOR[PIDOR_COLOR] || PIDOR.white;
  const PIDOR_LOOK = { body: [PD.c, 0.45, 0.1], door: [PD.c, 0.45, 0.1], plinth: [PD.in, 0.6], back: [PD.in, 0.6], handle: [PD.handle, 0.3, 0.6] };
  const SAM_LOOK = { body: ['#efe9dd', 0.5], back: ['#e7e0d3', 0.8] };   // 한샘 샘 책장 크림화이트(어린이 3단 · 5단 같은 색)
  const TROLLEY_LOOK = { frame: ['#f0f0ee', 0.5, 0.1], wheel: ['#c4c7ca', 0.5] };   // 이케아 흰 분체 도장 철제, 연회색 바퀴(바퀴 색은 추정)
  const LOOK = {
    // LG 디오스 오브제컬렉션 652L S634BB35Q — 베이지 미스트(무광) 글라스 양문, 디스펜서 없음, 오른쪽 문에 매직스페이스(가는 이음선 네모)
    'inv-fridge': { door: ['#e2d9c9', 0.5, 0.02], body: ['#d6cdbd', 0.45, 0.05], handle: ['#cbc7bf', 0.35, 0.5], panel: null, magic: ['#cbc1b0', 0.6, 0.02] },
    // 삼성 그랑데 AI 건조기 19kg(2021) — 화이트로 추정(그레이지·블랙캐비어도 있어요), 검은 유리 조작부 · 은색 다이얼 · 틴트 유리 둥근 문
    'inv-dryer': { body: ['#ededeb', 0.35, 0.05], panel: ['#1e2024', 0.22, 0.2], dial: ['#c3c6ca', 0.3, 0.6], filter: ['#e2e2df', 0.4, 0.05], back: ['#2f3236', 0.5, 0.2],
      ring: ['#b7bbbf', 0.3, 0.6], ringT: 0.07, glass: ['#34383e', 0.8] },
    // LG 통돌이 T17MX3 — 미드 블랙(진회색) 몸통 · 검은 유리 조작부 · 투명 유리 뚜껑 너머 스텐 세탁조
    'inv-washer-new': { body: ['#505257', 0.45, 0.2], deck: ['#46484c', 0.4, 0.2], panel: ['#1c1d21', 0.2, 0.3], drum: ['#b8bcc0', 0.35, 0.7], pulsator: ['#9ea3a8', 0.5, 0.2],
      frame: ['#34363a', 0.4, 0.1], glass: ['#dde3e6', 0.22] },
    // 전자레인지(모델 모름) — 흰 몸통·검은 창으로 추정, 오른쪽 조작부는 흰색에 작은 검은 표시창
    'inv-microwave': { body: ['#efefec', 0.4, 0.05], column: ['#e7e7e4', 0.4, 0.05], display: ['#1a1c1f', 0.25, 0.1], door: ['#ebebe8', 0.35, 0.05] },
    // 삼성 AI Q9000 스탠드(블레이드 화이트) — 흰 기둥, 둥근 회오리 바람문 2개(날개 이음선), 아래는 매끈
    'inv-ac-stand': { body: ['#f2f2f0', 0.3, 0.05], outlet: ['#e3e4e5', 0.5, 0.05], blade: ['#d3d5d7', 0.6, 0.05], seam: ['#c4c6c8', 0.6], display: ['#1a1c20', 0.2, 0.2], grille: null },
    // 니토리 N컬렉션 T-01 NA · C-011 NA/BE — 밝은 너도밤나무(내추럴) 한 색, 의자 방석은 베이지 천
    'inv-dining': { top: ['#d8b38a', 0.45], frame: ['#d0a87d'] },
    'inv-dining-chair': { frame: ['#d0a87d'] },
    // 데스커 DSAD612P — 흰 상판 + 흰 철제 다리로 추정(화이트+화이트 · 메이플+화이트 · 빈티지블랙 세 가지뿐)
    'inv-desk-adult': { leg: ['#e8e9e7', 0.45, 0.15] },
    // 까르엠 헤이븐 고무나무 원목 — 밝은 고무나무색, 나무 손잡이(추정)
    'inv-vanity': { body: ['#d4b083'], back: ['#c9a274', 0.6], front: ['#d9b78b', 0.5], handle: ['#b48a5c', 0.45] },
    // 니토리 코우테이4 GY — 푸른 기 없는 보통 회색 천
    'inv-sofa': { fabric: ['#8c8b88', 0.95, 0], cushion: ['#979692', 0.95, 0] },
    'inv-cabinet': PIDOR_LOOK,
    'inv-cabinet-2': PIDOR_LOOK,
    // 이케아 알렉스 화이트 — 튀어나온 손잡이 대신 서랍 앞판 위쪽에 손을 넣는 홈
    'inv-desk-drawer': { body: ['#f3f3f1', 0.45, 0.05], face: ['#f6f6f4', 0.4], handle: ['#4a4a48', 0.9], slot: true },
    // 니토리 체스트랙 40CR MBR — 미들브라운 나뭇결
    'inv-chest-rack': { body: ['#8b6545', 0.6], face: ['#916a49', 0.5], inside: '#a8875f', grain: true },
    // 리바트 프렌즈아이 마카롱 — 흰 틀 + 수납함은 자리 표시용 파스텔(추정). 시리즈의 마카롱 색(핑크·그린·옐로우·퍼플·블루)을 돌려 쓴 것이라 실제 판매 색 조합과는 달라요.
    // 가족이 수납함 색을 알려 주면 그 색으로 바꿔요(기본 '화이트' 조합이면 작은 통 '#f1f0ec', 중·대 통 '#c8cacb')
    'inv-toy-storage': { boxes: ['#f3c6cd', '#bfe0cc', '#f5e3a0', '#d4c8e9', '#bcd7ee'] },
    'inv-bookshelf-kid': SAM_LOOK,
    'inv-bookshelf': SAM_LOOK,
    'inv-trolley-3': TROLLEY_LOOK,
    'inv-trolley-2': TROLLEY_LOOK,
    // 일루일루 마르 스탠드 행거 — 흰 분체 도장 철제로 추정(번쩍이는 크롬이 아니에요)
    'inv-hanger': { frame: ['#efefed', 0.45, 0.15] },
    // 리빙박스 — 반투명 몸통이 조금 더 비치게(파란 뚜껑은 그대로)
    'inv-living-box': { op: 0.78 },
    // 다이소 다용도 정리함 특대 45L — 투명 몸통, 옅은 회색빛 반투명 뚜껑(뚜껑 위 작은 덮개) — 흰 캐비닛·책장 위에서도 상자로 보이게 뚜껑·손잡이를 살짝 짙게
    'inv-top-box': { body: ['#e8edef', 0.25, 0.05], op: 0.55, lid: ['#cad1d7', 0.35, 0.05], grip: ['#b8bfc6', 0.4], hatch: ['#b8bfc6', 0.4] },
    'inv-laundry-basket': { body: ['#f3f1ec', 0.9] },
    'inv-trash': { body: ['#e9ebee', 0.4, 0.05], lid: ['#9aa3ad', 0.4, 0.05] },
  };
  /** 이 짐의 부분별 색: 종류 기본(BASE[base]) 위에 짐별 실제 색(LOOK[invId]) */
  const look = (it, base) => Object.assign({}, BASE[base], LOOK[it.invId] || {});
  const BOOKS = ['#a4553f', '#3f6e8c', '#c2a14d', '#5d7f5a', '#7d6a8f', '#d6c7ad', '#2f3b4c', '#b88a6a', '#8c4b52', '#6a8a99'];
  const CLOTHES = ['#2f3b4c', '#c9b79c', '#7f8fa6', '#e8e1d4', '#8a5a44', '#9db4a0', '#5b6c8f', '#d8a7a0', '#4a4f57', '#b7c4cf'];

  /* ---------------- 열림 계산 (2D 점검과 같은 값: it.open = { kind, need, free, by, top }) ---------------- */
  const isLimited = (op) => !!op && op.free < op.need - 0.5;
  /** 문짝(길이 lenCm)을 앞이 free 만큼 비었을 때 열 수 있는 각도 — 문짝 폭만큼 비면 끝까지(maxRad) */
  function safeAngle(op, lenCm, maxRad) {
    if (!op || !isLimited(op) || op.free >= lenCm) return maxRad;
    return Math.min(maxRad, Math.asin(clamp(op.free / Math.max(1, lenCm), 0, 1)));
  }
  /** 서랍을 뺄 수 있는 길이 (m) */
  function safePull(op, wantCm) {
    if (!op) return wantCm / 100;
    return Math.max(0, Math.min(wantCm, isLimited(op) ? op.free : wantCm)) / 100;
  }

  /* ============================================================
     짐 모델 — 정면 +Z, 바닥 가운데 원점. 움직이는 부분은 movers 에 넣어요:
       { rot: 물체, axis: 'x'|'y', sign, max(rad), safe(rad), lim(테두리), warn } · { slide: 물체, base(z), max(m), safe(m), lim, warn }
       warn = 2D 점검에서 앞 공간이 모자란 짐(끝까지 열려도 주황 테두리 — 2D 경고와 같게)
     ============================================================ */
  function modelOf(it) {
    const id = it.invId || '', tag = it.tag || '', cat = it.cat || '', name = it.name || '';
    if (tag === 'fridge' || /냉장고/.test(name)) return 'fridge';
    if (tag === 'dryer') return 'dryer';
    if (tag === 'washer' || /세탁기/.test(name)) return 'washer';
    if (id === 'inv-microwave' || /전자레인지/.test(name) && !/수납장/.test(name)) return 'microwave';
    if (id === 'inv-microwave-cabinet' || tag === 'kitchen' || /수납장/.test(name) && /전자레인지/.test(name)) return 'mwcab';
    if (cat === 'aircon') return it.wall ? 'wallac' : 'aircon';
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

  function buildModel(K, it, tex) {
    const { T, std, glass, box, rbox, cyl, sph, torus, edges } = K;
    const g = new T.Group();
    const w = Math.max(0.05, it.dw / 100), d = Math.max(0.05, it.dd / 100), h = Math.max(0.03, it.hgt / 100);
    const op = it.open || null;
    const warn = isLimited(op);
    const movers = [];
    const front = d / 2;
    const kind = modelOf(it);
    const wood = (color, rough) => std(color, rough == null ? 0.55 : rough, 0, { map: tex.grain });

    /** 문짝 하나: 경첩은 문짝 바깥 앞면 모서리(hx, zf + t) — 끝까지 열어도 몸체 옆선 안에 머물러요.
        dir +1 = 문짝이 경첩에서 오른쪽(+X)으로, −1 = 왼쪽으로. extraFn(inner, mesh, mover) 의 좌표는 문짝 뒷면 기준(z 0 = 뒷면) */
    function leaf(hx, zf, dir, lw, y0, lh, t, material, maxDeg, extraFn) {
      const pivot = new T.Group();
      pivot.position.set(hx, y0, zf + t);
      g.add(pivot);
      const inner = new T.Group();
      inner.position.z = -t;
      pivot.add(inner);
      const m = rbox(inner, lw, lh, t, Math.min(0.006, t * 0.3), dir * lw / 2, lh / 2, t / 2, material);
      const max = deg(maxDeg);
      const mv = { rot: pivot, axis: 'y', sign: dir > 0 ? -1 : 1, max, safe: safeAngle(op, lw * 100, max), lim: edges(m, LIM), warn };
      movers.push(mv);
      if (extraFn) extraFn(inner, m, mv);
      return { pivot, m };
    }
    /** 서랍: 앞판 + 손잡이 + (빼면 보이는) 서랍통 — 빼는 길이는 서랍통 길이까지(몸체 안에 5cm 남김), 앞이 막히면 그만큼만 */
    function drawer(x, y, fw, fh, depth, faceMat, pullCm, handleMat, o) {
      const dg = new T.Group();
      dg.position.set(x, y, 0);
      g.add(dg);
      const face = rbox(dg, fw, fh, 0.018, 0.004, 0, 0, front - 0.009, faceMat);
      const boxD = depth * 0.85;
      box(dg, fw - 0.03, fh * 0.75, boxD, 0, -fh * 0.08, front - 0.018 - boxD / 2, std(o && o.inside || '#e9e2d6', 0.8));
      if (handleMat && o && o.slot) box(dg, Math.min(0.09, fw * 0.4), Math.min(0.02, fh * 0.2), 0.002, 0, fh * 0.32, front + 0.0005, handleMat);   // 손 넣는 홈(앞판에 붙은 어두운 틈)
      else if (handleMat) rbox(dg, Math.min(0.12, fw * 0.4), 0.014, 0.018, 0.005, 0, fh * 0.22, front + 0.009, handleMat);
      const travel = Math.max(0, Math.min(pullCm / 100, boxD - 0.05));
      movers.push({ slide: dg, base: 0, max: travel, safe: Math.min(travel, safePull(op, pullCm)), lim: edges(face, LIM), warn });
      return dg;
    }

    if (kind === 'fridge') {
      // LG 디오스 오브제컬렉션 양문형 — 몸체 + 문 두 짝(기본 모델은 왼쪽 디스펜서 · 우리 냉장고는 오른쪽 매직스페이스), 열면 안쪽 선반
      const L = look(it, 'fridge');
      const dt = d * 0.12, bodyD = d - dt - 0.03, bz = -d / 2 + bodyD / 2, zf = bz + bodyD / 2, sh = 0.03;
      const bm = std(...L.body), inMat = std('#f3f5f6', 0.55);
      [-1, 1].forEach((sx) => rbox(g, sh, h, bodyD, 0.006, sx * (w / 2 - sh / 2), h / 2, bz, bm));
      box(g, w - 2 * sh, sh, bodyD, 0, h - sh / 2, bz, bm);
      box(g, w - 2 * sh, 0.06, bodyD, 0, 0.03, bz, bm);
      const ih = h - sh - 0.06, iy = 0.06 + ih / 2, back = -d / 2;
      box(g, w - 2 * sh, ih, sh, 0, iy, back + sh / 2, bm);
      box(g, w - 2 * sh, ih, 0.006, 0, iy, back + sh + 0.003, inMat);   // 안쪽 뒤판(밝게)
      [-1, 1].forEach((sx) => box(g, 0.004, ih, bodyD - sh, sx * (w / 2 - sh - 0.002), iy, bz + sh / 2, inMat, { noCast: true }));
      box(g, 0.014, ih, bodyD - sh - 0.01, 0, iy, bz + sh / 2 - 0.005, inMat);   // 가운데 칸막이(냉동 | 냉장)
      const cw = w / 2 - sh - 0.012, sdp = bodyD - sh - 0.06;
      for (let i = 1; i < 6; i++) [-1, 1].forEach((sx) => box(g, cw, 0.008, sdp, sx * (sh / 2 + 0.003 + cw / 2 + 0.004), 0.06 + (ih * i) / 6, back + sh + 0.008 + sdp / 2, glass('#dfe9ef', 0.6), { noCast: true }));
      const lw = w / 2 - 0.004, doorMat = std(...L.door), hm = std(...L.handle);
      const bins = (p, x0) => { for (let i = 0; i < 4; i++) box(p, lw - 0.08, 0.06, 0.05, x0, h * (0.2 + i * 0.19), -0.025, std('#e4eaee', 0.4, 0, { transparent: true, opacity: 0.85 }), { noCast: true }); };
      leaf(-w / 2, zf, 1, lw, 0.02, h - 0.03, dt, doorMat, 105, (p) => {
        rbox(p, 0.022, h * 0.42, 0.03, 0.008, lw - 0.03, h * 0.5, dt + 0.015, hm);
        if (L.panel) rbox(p, lw * 0.42, h * 0.16, 0.006, 0.004, lw * 0.5, h * 0.62, dt + 0.003, std(...L.panel));   // 디스펜서·표시창
        bins(p, lw / 2);   // 문 안쪽 칸
      });
      leaf(w / 2, zf, -1, lw, 0.02, h - 0.03, dt, doorMat, 105, (p) => {
        rbox(p, 0.022, h * 0.42, 0.03, 0.008, -lw + 0.03, h * 0.5, dt + 0.015, hm);
        if (L.magic) {
          // 매직스페이스(문 속 작은 문): 가는 이음선만 보이는 네모 — 이음선 색 판 위에 문과 같은 판을 조금 작게
          const mw = lw * 0.62, mh = h * 0.3, mx = -lw * 0.5, my = h * 0.6;
          box(p, mw, mh, 0.002, mx, my, dt + 0.001, std(...L.magic));
          rbox(p, mw - 0.008, mh - 0.008, 0.002, 0.0015, mx, my, dt + 0.002, doorMat);
        }
        bins(p, -lw / 2);
      });
    } else if (kind === 'dryer') {
      // 삼성 그랑데 AI 건조기 — 위 조작부 · 둥근 유리문(왼쪽 경첩) · 아래 필터 덮개
      const L = look(it, 'dryer');
      const bodyD = d - 0.05, bz = -d / 2 + bodyD / 2, zf = bz + bodyD / 2;
      rbox(g, w, h, bodyD, 0.015, 0, h / 2, bz, std(...L.body));
      rbox(g, w * 0.96, h * 0.16, 0.02, 0.005, 0, h * 0.89, zf + 0.01, std(...L.panel));
      box(g, w * 0.2, h * 0.07, 0.006, w * 0.18, h * 0.89, zf + 0.022, std('#5ad1ff', 0.2, 0, { emissive: new T.Color('#1d6f8f'), emissiveIntensity: 0.6 }));
      cyl(g, 0.022, 0.022, 0.018, -w * 0.3, h * 0.89, zf + 0.025, std(...L.dial)).rotation.x = Math.PI / 2;
      box(g, w * 0.9, h * 0.1, 0.012, 0, h * 0.08, zf + 0.006, std(...L.filter));
      const r = Math.min(w * 0.33, h * 0.33);
      cyl(g, r * 0.92, r * 0.92, 0.01, 0, h * 0.47, zf + 0.003, std(...L.back)).rotation.x = Math.PI / 2;
      leaf(-r, zf + 0.004, 1, 2 * r, h * 0.47 - r, 2 * r, 0.04, std('#dad8d3', 0.25, 0.5), 110, (p, m, mv) => {
        m.visible = false;   // 둥근 문: 사각 판 대신 고리 + 유리
        const ring = torus(p, r * 0.9, r * L.ringT, r, r, 0.03, std(...L.ring));
        const gl = cyl(p, r * 0.8, r * 0.8, 0.02, r, r, 0.03, glass(...L.glass));
        gl.rotation.x = Math.PI / 2;
        mv.lim = edges(ring, LIM);
      });
    } else if (kind === 'washer') {
      // LG 통돌이 — 몸통 · 뒤 조작부 · 뒤 경첩 유리 뚜껑(뚜껑 너머 세탁조)
      const L = look(it, 'washer');
      const bodyH = h * 0.9;
      rbox(g, w, bodyH, d, 0.018, 0, bodyH / 2, 0, std(...L.body));
      rbox(g, w, h - bodyH + 0.02, d * 0.2, 0.012, 0, bodyH + (h - bodyH) / 2, -d / 2 + d * 0.1, std(...L.deck));
      box(g, w * 0.7, (h - bodyH) * 0.6, 0.006, 0, bodyH + (h - bodyH) / 2, -d / 2 + d * 0.2 + 0.003, std(...L.panel));
      cyl(g, w * 0.36, w * 0.36, 0.01, 0, bodyH + 0.001, d * 0.08, std(...L.drum));
      if (L.pulsator) cyl(g, w * 0.16, w * 0.16, 0.004, 0, bodyH + 0.008, d * 0.08, std(...L.pulsator));   // 세탁조 바닥 회전판
      const pivot = new T.Group();
      pivot.position.set(0, bodyH + 0.006, -d / 2 + d * 0.2);
      g.add(pivot);
      const ld = d * 0.78;
      const fm = std(...L.frame), fw = w * 0.94, gw = w * 0.62, gd = ld * 0.62, rim = (ld - gd) / 2;
      const frame = rbox(pivot, fw, 0.02, rim, 0.006, 0, 0.01, rim / 2, fm);
      rbox(pivot, fw, 0.02, rim, 0.006, 0, 0.01, ld - rim / 2, fm);
      [-1, 1].forEach((sx) => rbox(pivot, (fw - gw) / 2, 0.02, gd, 0.004, sx * (fw + gw) / 4, 0.01, ld / 2, fm));
      box(pivot, gw, 0.008, gd, 0, 0.01, ld / 2, glass(...L.glass));
      movers.push({ rot: pivot, axis: 'x', sign: -1, max: deg(80), safe: deg(80), lim: edges(frame, LIM), warn });
    } else if (kind === 'microwave') {
      const L = look(it, 'microwave');
      rbox(g, w, h, d, 0.01, 0, h / 2, 0, std(...L.body));
      box(g, w * 0.64, h * 0.74, 0.004, -w * 0.13, h / 2, front + 0.001, std('#2a2d33', 0.8));   // 문 뒤 안쪽
      box(g, w * 0.26, h * 0.86, 0.006, w * 0.35, h / 2, front + 0.003, std(...L.column));   // 오른쪽 조작부
      if (L.display) box(g, w * 0.18, h * 0.12, 0.002, w * 0.35, h * 0.78, front + 0.007, std(...L.display));   // 작은 표시창
      leaf(-w / 2, front, 1, w * 0.72, h * 0.06, h * 0.88, 0.02, std(...L.door), 100, (p) => {
        box(p, w * 0.5, h * 0.56, 0.004, w * 0.36, h * 0.44, 0.021, glass('#14181d', 0.85));
      });
    } else if (kind === 'mwcab') {
      // 전자레인지 수납장 — 위 판(전자레인지), 가운데 트인 칸, 아래 두 문
      const bodyMat = std(C.white, 0.55, 0.05), t = 0.018;
      box(g, t, h, d, -w / 2 + t / 2, h / 2, 0, bodyMat); box(g, t, h, d, w / 2 - t / 2, h / 2, 0, bodyMat);
      box(g, w, t, d, 0, h - t / 2, 0, bodyMat); box(g, w, t, d, 0, t / 2 + 0.04, 0, bodyMat);
      box(g, w - 2 * t, h - 0.06, 0.008, 0, h / 2, -d / 2 + 0.004, std('#e6e3dc', 0.7));
      box(g, w - 2 * t, t, d - 0.02, 0, h * 0.55, 0.01, bodyMat);
      box(g, w - 2 * t, 0.04, d * 0.9 - 0.02, 0, 0.02, -0.02, std('#d4d0c8', 0.7));
      const dh = h * 0.5 - 0.06;
      [-1, 1].forEach((s) => leaf(s * (w / 2), front - 0.016, -s, w / 2 - 0.004, 0.045, dh, 0.016, bodyMat, 90, (p) => {
        rbox(p, 0.012, 0.08, 0.014, 0.004, -s * (w / 2 - 0.04), dh * 0.8, 0.022, std(C.dark, 0.4, 0.3));
      }));
    } else if (kind === 'table') {
      // 니토리 N컬렉션 식탁 — 상판(나무결) · 앞치마(의자 팔걸이 위) · 다리 4
      const L = look(it, 'table');
      const top = 0.032, leg = TABLE.leg / 100, inset = TABLE.inset / 100, ap = 0.045, fr = wood(...L.frame);
      rbox(g, w, top, d, 0.008, 0, h - top / 2, 0, wood(...L.top));
      const ax = w / 2 - inset - leg / 2, az = d / 2 - inset - leg / 2;
      box(g, w - 2 * inset - leg, ap, 0.02, 0, h - top - ap / 2, az, fr); box(g, w - 2 * inset - leg, ap, 0.02, 0, h - top - ap / 2, -az, fr);
      box(g, 0.02, ap, d - 2 * inset - leg, ax, h - top - ap / 2, 0, fr); box(g, 0.02, ap, d - 2 * inset - leg, -ax, h - top - ap / 2, 0, fr);
      [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(([sx, sz]) => box(g, leg, h - top, leg, sx * ax, (h - top) / 2, sz * az, fr));
    } else if (kind === 'chair') {
      // 니토리 C-011 팔걸이 의자 — 다리 · 천 방석 · 등받이 · 팔걸이(식탁 앞치마 아래로 지나가게 낮게). 넣기/빼기는 바깥 그룹이 움직여요
      const L = look(it, 'chair');
      const seatH = Math.min(0.45, h * 0.62), wd = wood(...L.frame), leg = 0.035;
      const lx = w / 2 - leg / 2 - 0.01, lz = d / 2 - leg / 2 - 0.01;
      [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(([sx, sz]) => box(g, leg, seatH - 0.04, leg, sx * lx, (seatH - 0.04) / 2, sz * lz, wd));
      box(g, w - 0.02, 0.04, d - 0.04, 0, seatH - 0.02, 0.01, wd);
      rbox(g, w - 0.06, 0.05, d - 0.1, 0.018, 0, seatH + 0.025, 0.02, std(...L.seat, { map: tex.fabric }));
      [-1, 1].forEach((sx) => box(g, leg, h - seatH + 0.04, leg, sx * lx, seatH + (h - seatH) / 2 - 0.02, -lz, wd));
      rbox(g, w - 0.04, 0.12, 0.025, 0.008, 0, h - 0.08, -lz, wd);
      box(g, w - 0.08, 0.03, 0.02, 0, seatH + 0.14, -lz, wd);
      const armY = Math.min(seatH + 0.2, 0.56);
      [-1, 1].forEach((sx) => {
        rbox(g, 0.035, 0.03, d * 0.75, 0.01, sx * lx, armY, -d * 0.08, wd);
        box(g, 0.03, armY - seatH, 0.03, sx * lx, seatH + (armY - seatH) / 2, d * 0.25, wd);
      });
    } else if (kind === 'desk' || kind === 'kiddesk') {
      // 데스커 책상(흰 상판 · 철제 다리 · 뒤 가림판) · 어린이 책상 세트(작은 의자 포함)
      const kid = kind === 'kiddesk', L = kid ? null : look(it, 'desk');
      const deskD = kid ? d - 0.03 : d, dz = kid ? -d / 2 + deskD / 2 : 0, top = 0.025;
      const topMat = kid ? std('#f6efe2', 0.45) : std(...L.top), legMat = kid ? std('#9fc7a8', 0.4, 0.05) : std(...L.leg);
      rbox(g, w, top, deskD, 0.006, 0, h - top / 2, dz, topMat);
      [-1, 1].forEach((sx) => {
        box(g, 0.03, h - top, 0.03, sx * (w / 2 - 0.035), (h - top) / 2, dz - deskD / 2 + 0.05, legMat);
        box(g, 0.03, h - top, 0.03, sx * (w / 2 - 0.035), (h - top) / 2, dz + deskD / 2 - 0.05, legMat);
        box(g, 0.03, 0.03, deskD - 0.1, sx * (w / 2 - 0.035), 0.04, dz, legMat);
      });
      box(g, w - 0.1, h * 0.35, 0.012, 0, h - top - h * 0.175, dz - deskD / 2 + 0.03, kid ? std('#f6efe2', 0.6) : std(...L.back));
      if (kid) {
        // 작은 의자: 닫힘 = 책상 밑, 열림 = 앞으로 뺌 — 의자 앞이 책상 모서리에 닿을 만큼(앞이 막히면 그만큼만)
        const ch = new T.Group(); g.add(ch);
        const cw = Math.min(0.36, w * 0.45), cd = Math.min(0.32, d * 0.5), sh = h * 0.6, cz = d / 2 - cd / 2;
        const seat = rbox(ch, cw, 0.03, cd, 0.01, 0, sh, cz, std('#f2b8a2', 0.7));
        [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(([sx, sz]) => { const lh = sz > 0 ? sh + 0.2 : sh; box(ch, 0.025, lh, 0.025, sx * (cw / 2 - 0.02), lh / 2, cz + sz * (cd / 2 - 0.02), std('#9fc7a8', 0.5)); });
        rbox(ch, cw, 0.16, 0.02, 0.008, 0, sh + 0.115, cz + cd / 2 - 0.02, std('#f2b8a2', 0.7));
        const want = op && op.need > 0 ? op.need : 35;   // 의자 등이 2D 의 '앞 공간' 끝까지
        movers.push({ slide: ch, base: 0, max: want / 100, safe: safePull(op, want), lim: edges(seat, LIM), warn });
      }
    } else if (kind === 'vanity') {
      // 낮은 좌식 화장대(고무나무) — 몸통 · 서랍 · 뒤 거울
      const L = look(it, 'vanity');
      const bodyH = Math.min(0.38, h * 0.5), wd = wood(...L.body);
      rbox(g, w, 0.025, d, 0.006, 0, bodyH - 0.0125, 0, wd);
      [-1, 1].forEach((sx) => box(g, 0.025, bodyH - 0.025, d, sx * (w / 2 - 0.0125), (bodyH - 0.025) / 2, 0, wd));
      box(g, w - 0.05, bodyH - 0.025, 0.012, 0, (bodyH - 0.025) / 2, -d / 2 + 0.006, wood(...L.back));
      drawer(0, bodyH - 0.09, w - 0.06, 0.1, d - 0.05, wood(...L.front), op ? op.need : 30, std(...L.handle));
      const mh = h - bodyH - 0.02;
      rbox(g, w * 0.6, mh, 0.03, 0.012, 0, bodyH + mh / 2, -d / 2 + 0.04, wd);
      box(g, w * 0.52, mh * 0.85, 0.006, 0, bodyH + mh / 2, -d / 2 + 0.058, std('#d3dee6', 0.05, 0.8, { envMapIntensity: 1.4 }));
    } else if (kind === 'sofa') {
      // 니토리 코우테이4 3인 패브릭(그레이) — 바닥 틀 · 방석 3 · 등쿠션 3 · 팔걸이 · 나무 다리 (둥근 모서리 · 천 무늬)
      const L = look(it, 'sofa');
      const fab = std(...L.fabric, { map: tex.fabric }), fabLt = std(...L.cushion, { map: tex.fabric });
      const legH = 0.08, arm = Math.min(0.16, w * 0.1);
      [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(([sx, sz]) => box(g, 0.04, legH, 0.04, sx * (w / 2 - 0.06), legH / 2, sz * (d / 2 - 0.06), std(...L.leg)));
      rbox(g, w, h * 0.3, d, 0.03, 0, legH + h * 0.15, 0, fab);
      const backD = d * 0.24, seatW = (w - 2 * arm) / 3;
      rbox(g, w, h - legH, backD, 0.04, 0, legH + (h - legH) / 2, -d / 2 + backD / 2, fab);
      [-1, 1].forEach((sx) => rbox(g, arm, h * 0.62 - legH, d, 0.045, sx * (w / 2 - arm / 2), legH + (h * 0.62 - legH) / 2, 0, fab));
      for (let i = 0; i < 3; i++) {
        const x = -w / 2 + arm + seatW * (i + 0.5);
        rbox(g, seatW - 0.012, 0.13, d - backD - 0.02, 0.04, x, legH + h * 0.3 + 0.065, backD / 2 + 0.01, fabLt);
        rbox(g, seatW - 0.02, h * 0.42, 0.14, 0.045, x, legH + h * 0.3 + 0.13 + h * 0.21, -d / 2 + backD + 0.07, fabLt).rotation.x = -0.12;
      }
    } else if (kind === 'bed') {
      // 라지킹 매트리스(프레임 없음) — 매트리스(둥근 모서리) · 베개 2 · 이불(아래 60%, 옆으로 내려옴) · 머리는 뒤(-Z)
      // 이불이 옆·발끝으로 내려와도 도면 자리(w×d) 안에 머물게 매트리스를 조금 작게(벽에 붙은 침대가 벽 속으로 안 들어가요)
      const mw = w - 0.05, md = d - 0.025, mz = -0.0125;
      rbox(g, mw, h, md, 0.05, 0, h / 2, mz, std(C.linen, 0.85));
      box(g, mw + 0.004, 0.012, md + 0.004, 0, h * 0.5, mz, std('#e8e1d4', 0.8), { noCast: true });
      [-1, 1].forEach((sx) => rbox(g, mw * 0.36, 0.13, 0.44, 0.055, sx * mw * 0.235, h + 0.06, -d / 2 + 0.28, std(C.pillow, 0.9)));
      const dl = md * 0.62, dz = mz + md / 2 - dl / 2, duv = std(C.duvet, 0.92, 0, { map: tex.fabric });
      rbox(g, w - 0.002, 0.06, dl, 0.025, 0, h + 0.025, dz, duv);
      [-1, 1].forEach((sx) => box(g, 0.022, 0.16, dl, sx * (w / 2 - 0.012), h - 0.055, dz, duv));
      box(g, w - 0.002, 0.16, 0.022, 0, h - 0.055, d / 2 - 0.012, duv);
      rbox(g, mw * 0.98, 0.05, 0.14, 0.02, 0, h + 0.04, dz - dl / 2 + 0.07, std('#e9f0f5', 0.9));
    } else if (kind === 'wardrobe') {
      // 마켓비 피도르 캐비닛장 — 몸체 · 받침 · 문 두 짝(손잡이), 열면 안쪽(행어형: 옷걸이 봉·옷 / 수납형: 선반·상자)
      const L = look(it, 'wardrobe');
      const bodyMat = std(...L.body), dt = 0.02, bodyD = d - dt, bz = -dt / 2, t = 0.018;
      box(g, t, h, bodyD, -w / 2 + t / 2, h / 2, bz, bodyMat); box(g, t, h, bodyD, w / 2 - t / 2, h / 2, bz, bodyMat);
      box(g, w, t, bodyD, 0, h - t / 2, bz, bodyMat); box(g, w - 2 * t, 0.06, bodyD - 0.01, 0, 0.03, bz - 0.005, std(...L.plinth));
      box(g, w - 2 * t, h - 0.08, 0.008, 0, h / 2 + 0.02, -d / 2 + 0.006, std(...L.back));
      const hanger = /행어|2단 옷장|옷장/.test(it.name || '') && !/수납형/.test(it.name || '');
      const R = rng(it.pid);
      if (hanger) {
        box(g, w - 2 * t, h * 0.02, bodyD - 0.01, 0, h * 0.44, bz, bodyMat);
        [h * 0.86, h * 0.4].forEach((ry) => {
          cyl(g, 0.01, 0.01, w - 0.06, 0, ry, bz, std(C.chrome, 0.25, 0.7)).rotation.z = Math.PI / 2;
          hangClothes(g, -w / 2 + 0.07, w / 2 - 0.07, ry, Math.min(bodyD * 0.85, 0.42), bz, Math.min(0.4, ry - (ry > h * 0.5 ? h * 0.46 : 0.08)), R, 6);
        });
      } else {
        for (let i = 1; i < 5; i++) box(g, w - 2 * t, t, bodyD - 0.02, 0, (h * i) / 5, bz, bodyMat);
        for (let i = 0; i < 5; i++) {
          const bh = 0.12 + R() * 0.1, y0 = i === 0 ? 0.06 : (h * i) / 5 + t / 2;
          rbox(g, w * (0.3 + R() * 0.3), bh, bodyD * 0.6, 0.01, (R() - 0.5) * w * 0.3, y0 + bh / 2, bz, std(['#c9b79c', '#e8e1d4', '#9db4a0', '#b8c4d6', '#d9c6a3'][i], 0.9));
        }
      }
      const lw = w / 2 - 0.004, zf = d / 2 - dt;
      const dm = std(...L.door), hm = std(...L.handle);
      [-1, 1].forEach((s) => leaf(s * (w / 2), zf, -s, lw, 0.065, h - 0.075, dt, dm, 90, (p) => {
        rbox(p, 0.012, 0.22, 0.02, 0.005, -s * (lw - 0.04), (h - 0.075) * 0.55, dt + 0.01, hm);
      }));
    } else if (kind === 'drawers') {
      // 서랍장(알렉스 5칸 · 체스트랙 4칸)
      const n = /알렉스|alex/i.test(it.name || '') ? 5 : /체스트/.test(it.name || '') ? 4 : 3;
      const chest = /체스트/.test(it.name || ''), t = 0.016;
      const L = look(it, chest ? 'chest' : 'drawers'), mk = (p) => (L.grain ? wood(p[0], p[1]) : std(...p));
      rbox(g, w, h, d - 0.02, 0.006, 0, h / 2, -0.01, mk(L.body));
      const fh = (h - 0.06) / n, want = op ? op.need : d * 70, face = mk(L.face), hm = std(...L.handle);
      for (let i = 0; i < n; i++) {
        const y = 0.04 + fh * (i + 0.5);
        drawer(0, y, w - 2 * t, fh - 0.008, d - 0.06, face, i === n - 1 ? want : want * (0.5 + 0.5 * i / n), hm, { inside: L.inside, slot: L.slot });
      }
    } else if (kind === 'toy') {
      // 리바트 프렌즈아이 마카롱 2x5 — 흰 틀 + 파스텔 수납함 10개(맨 위 왼쪽 한 칸을 빼요)
      const bodyMat = std(C.white, 0.5), t = 0.018;
      box(g, t, h, d, -w / 2 + t / 2, h / 2, 0, bodyMat); box(g, t, h, d, w / 2 - t / 2, h / 2, 0, bodyMat); box(g, t, h - 0.04, d, 0, h / 2 + 0.02, 0, bodyMat);
      box(g, w, t, d, 0, h - t / 2, 0, bodyMat); box(g, w, 0.04, d, 0, 0.02, 0, bodyMat);
      box(g, w - 0.02, h - 0.04, 0.006, 0, h / 2, -d / 2 + 0.003, std('#ece9e3', 0.8));
      const cols = look(it, 'toy').boxes;
      const rh = (h - 0.06) / 5, bw = (w - 3 * t) / 2;
      for (let r = 0; r < 5; r++) {
        if (r) box(g, w - 2 * t, 0.012, d - 0.01, 0, 0.04 + rh * r, 0, bodyMat);
        [-1, 1].forEach((sx, ci) => {
          const x = sx * (bw / 2 + t / 2), y = 0.04 + rh * (r + 0.5), mat = std(cols[(r + ci * 2) % 5], 0.6);
          if (r === 4 && ci === 0) drawer(x, y, bw - 0.006, rh - 0.016, d - 0.03, mat, op ? op.need : 30, null, { inside: cols[(r + ci * 2) % 5] });
          else rbox(g, bw - 0.006, rh - 0.016, d - 0.03, 0.01, x, y, 0.004, mat);
        });
      }
    } else if (kind === 'shelf') {
      // 한샘 샘 책장(어린이 3단 · 5단) — 옆판 · 선반 · 뒤판 + 차분한 색 책
      const L = look(it, 'shelf');
      const tiers = Math.max(2, Math.round(h / 0.38)), wh = std(...L.body), t = 0.018;
      box(g, t, h, d, -w / 2 + t / 2, h / 2, 0, wh); box(g, t, h, d, w / 2 - t / 2, h / 2, 0, wh);
      box(g, w - 0.01, h - 0.01, 0.008, 0, h / 2, -d / 2 + 0.004, std(...L.back));
      const R = rng(it.pid);
      const step = (h - 0.05) / tiers;
      for (let i = 0; i <= tiers; i++) box(g, w - 2 * t, t, d - 0.01, 0, i === 0 ? 0.04 : Math.min(h - t / 2, 0.04 + step * i), 0.005, wh);
      for (let i = 0; i < tiers; i++) {
        let x = -w / 2 + t + 0.01;
        const y0 = 0.04 + step * i + t / 2;
        while (x < w / 2 - t - 0.04) {
          const bw = 0.018 + R() * 0.03, bh = Math.min(step - 0.04, 0.15 + R() * 0.12);
          if (R() < 0.08) { x += 0.04; continue; }
          const b = box(g, bw, bh, d * (0.55 + R() * 0.25), x + bw / 2, y0 + bh / 2, 0.01, std(BOOKS[Math.floor(R() * BOOKS.length)], 0.8), { noCast: true });
          if (R() < 0.06) { b.rotation.z = 0.18; b.position.x += 0.01; }
          x += bw + 0.002;
        }
      }
    } else if (kind === 'trolley') {
      // 이케아 트롤리(바퀴) — 기둥 4 · 칸 · 바퀴
      const L = look(it, 'trolley');
      const tiers = /3단/.test(it.name || '') || h > 0.7 ? 3 : 2, mat = std(...L.frame), legH = 0.06;
      [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(([sx, sz]) => {
        cyl(g, 0.009, 0.009, h - legH, sx * (w / 2 - 0.02), legH + (h - legH) / 2, sz * (d / 2 - 0.02), mat, 10);
        sph(g, 0.022, sx * (w / 2 - 0.03), 0.022, sz * (d / 2 - 0.03), std(...L.wheel));
      });
      for (let i = 0; i < tiers; i++) {
        const y = legH + 0.03 + ((h - legH - 0.08) * i) / Math.max(1, tiers - 1);
        rbox(g, w - 0.02, 0.012, d - 0.02, 0.004, 0, y, 0, mat);
        [d / 2 - 0.01, -d / 2 + 0.01].forEach((z) => box(g, w - 0.02, 0.07, 0.006, 0, y + 0.035, z, mat));
        [w / 2 - 0.01, -w / 2 + 0.01].forEach((x) => box(g, 0.006, 0.07, d - 0.02, x, y + 0.035, 0, mat));
        if (i < tiers - 1 || tiers === 2) rbox(g, w * 0.4, 0.06, d * 0.5, 0.01, (rng(it.pid + i)() - 0.5) * 0.1, y + 0.036, 0, std(['#e6b98f', '#a7c4dc', '#c9b8d6'][i % 3], 0.8), { noCast: true });
      }
    } else if (kind === 'hanger') {
      // 이동식 간이 행거 — 바퀴 받침 · 기둥 2 · 위 봉 · 아래 선반 · 옷걸이에 걸린 옷
      const L = look(it, 'hanger');
      const metal = std(...L.frame), legH = 0.04;
      [-1, 1].forEach((sx) => {
        rbox(g, 0.03, 0.03, d, 0.008, sx * (w / 2 - 0.02), legH, 0, metal);
        [-1, 1].forEach((sz) => sph(g, 0.022, sx * (w / 2 - 0.02), 0.022, sz * (d / 2 - 0.03), std(...L.wheel)));
        cyl(g, 0.012, 0.012, h - legH, sx * (w / 2 - 0.02), legH + (h - legH) / 2, 0, metal, 12);
      });
      cyl(g, 0.012, 0.012, w, 0, h - 0.015, 0, metal, 12).rotation.z = Math.PI / 2;
      rbox(g, w - 0.04, 0.012, d * 0.7, 0.004, 0, 0.18, 0, metal);
      hangClothes(g, -w / 2 + 0.08, w / 2 - 0.08, h - 0.015, d * 0.85, 0, h - 0.35, rng(it.pid), Math.max(4, Math.floor(w / 0.1)));
      for (let i = 0; i < 2; i++) rbox(g, 0.24, 0.1, 0.26, 0.02, -w / 4 + i * w / 2, 0.24, 0, std(['#a0a7b3', '#c7b299'][i], 0.8));
    } else if (kind === 'livingbox') {
      // 리빙박스(반투명 몸통 + 색 뚜껑 · 손잡이 홈) — 쌓은 수만큼은 아래에서 여러 번 그려요
      const lidH = Math.min(0.03, h * 0.12), top = /간이|다이소/.test(it.name || '');
      const L = look(it, top ? 'topbox' : 'livingbox'), grip = std(...L.grip);
      rbox(g, w * 0.97, h - lidH, d * 0.97, 0.015, 0, (h - lidH) / 2, 0, std(...L.body, { transparent: true, opacity: L.op }));
      rbox(g, w, lidH, d, 0.008, 0, h - lidH / 2, 0, std(...L.lid));
      [-1, 1].forEach((sx) => box(g, 0.012, 0.035, d * 0.4, sx * (w * 0.485 + 0.004), h * 0.62, 0, grip, { noCast: true }));
      if (L.hatch) box(g, w * 0.42, 0.002, d * 0.36, 0, h + 0.001, 0, std(...L.hatch), { noCast: true });   // 뚜껑 위 작은 덮개(이음선)
    } else if (kind === 'aircon') {
      // 삼성 AI Q9000 스탠드 — 둥근 모서리 기둥 · 위 둥근 바람문 2개(날개 이음선) · 표시창 · (기본 모델은) 아래 흡입구
      const L = look(it, 'aircon');
      rbox(g, w, h, d, Math.min(w, d) * 0.3, 0, h / 2, 0, std(...L.body));
      const seam = L.seam ? std(...L.seam) : null;
      [0.82, 0.66].forEach((fy) => {
        const c = cyl(g, w * 0.34, w * 0.34, 0.012, 0, h * fy, front + 0.002, std(...L.outlet));
        c.rotation.x = Math.PI / 2;
        const c2 = cyl(g, w * 0.22, w * 0.22, 0.014, 0, h * fy, front + 0.004, std(...L.blade));
        c2.rotation.x = Math.PI / 2;
        // 회오리 바람문 날개: 가운데에서 비스듬히 퍼지는 가는 이음선 8개 (서로 겹치지 않아 한 번에 그려요)
        if (seam) for (let k = 0; k < 8; k++) {
          const a0 = (k / 8) * Math.PI * 2, a1 = a0 + 0.45, r0 = w * 0.22 * 0.36, r1 = w * 0.22 * 0.94;
          const x0 = Math.cos(a0) * r0, y0 = Math.sin(a0) * r0, x1 = Math.cos(a1) * r1, y1 = Math.sin(a1) * r1;
          const s = box(g, Math.hypot(x1 - x0, y1 - y0), 0.0025, 0.001, (x0 + x1) / 2, h * fy + (y0 + y1) / 2, front + 0.0115, seam, { noCast: true });
          s.rotation.z = Math.atan2(y1 - y0, x1 - x0);
        }
      });
      box(g, w * 0.3, 0.03, 0.006, 0, h * 0.53, front + 0.003, std(...L.display, { emissive: new T.Color('#3aa0ff'), emissiveIntensity: 0.4 }));
      if (L.grille) for (let i = 0; i < 6; i++) box(g, w * 0.6, 0.006, 0.006, 0, h * 0.12 + i * 0.03, front + 0.003, std(...L.grille), { noCast: true });
    } else if (kind === 'wallac') {
      // 벽걸이 에어컨 — 벽 높은 곳(아래 바람문 띠)
      rbox(g, w, h, d, 0.03, 0, h / 2, 0, std(C.acWhite, 0.3, 0.05));
      box(g, w * 0.86, h * 0.18, 0.006, 0, h * 0.15, front + 0.002, std('#c3cad2', 0.6), { noCast: true });
    } else if (kind === 'trash') {
      const L = look(it, 'trash');
      rbox(g, w, h * 0.92, d, 0.02, 0, h * 0.46, 0, std(...L.body));
      rbox(g, w + 0.006, h * 0.08, d + 0.006, 0.01, 0, h * 0.96, 0, std(...L.lid));
    } else if (kind === 'basket') {
      const L = look(it, 'basket');
      const mat = std(L.body[0], L.body[1], 0, { map: tex.weave });
      const t = 0.012;
      box(g, w, h, t, 0, h / 2, d / 2 - t / 2, mat); box(g, w, h, t, 0, h / 2, -d / 2 + t / 2, mat);
      box(g, t, h, d, w / 2 - t / 2, h / 2, 0, mat); box(g, t, h, d, -w / 2 + t / 2, h / 2, 0, mat);
      box(g, w, 0.01, d, 0, 0.005, 0, mat);
      rbox(g, w * 0.8, h * 0.5, d * 0.8, 0.04, 0, h * 0.3, 0, std('#cfd8e3', 0.95, 0, { map: tex.fabric }), { noCast: true });
    } else {
      // 그 밖의 짐: 색 상자 + 테두리
      const m = rbox(g, w, h, d, 0.01, 0, h / 2, 0, std(colorFor(it), 0.6, 0.05));
      const l = edges(m, '#6b7280'); l.visible = true;
    }

    /** 봉(높이 rodY, x0~x1)에 옷걸이와 옷 n벌 — 옷 폭 wid(깊이 방향), 길이는 maxLen 까지 */
    function hangClothes(parent, x0, x1, rodY, wid, z, maxLen, R, n) {
      for (let i = 0; i < n; i++) {
        const x = x0 + ((x1 - x0) * (i + 0.5)) / n + (R() - 0.5) * 0.015;
        const len = Math.max(0.2, Math.min(maxLen, (0.55 + R() * 0.45) * maxLen));
        const hook = torus(parent, 0.018, 0.0025, x, rodY + 0.004, z, std('#b9a27f', 0.5, 0.2));
        hook.rotation.y = Math.PI / 2;
        box(parent, 0.006, 0.01, wid * 0.92, x, rodY - 0.035, z, std('#b9a27f', 0.5), { noCast: true });
        const gm = K.put(parent, K.garmentGeo(len, wid * 0.95), std(CLOTHES[Math.floor(R() * CLOTHES.length)], 1, 0, { map: tex.fabric }), x, rodY - 0.04, z);
        gm.rotation.y = (R() - 0.5) * 0.24;
      }
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
    // 움직이지 않는 조각 합치기 (여닫는 문·서랍·의자 그룹은 그대로 따로)
    mergeStatic(T, g, new Set(movers.map((mv) => mv.rot || mv.slide)));

    // 겉 그룹(도면 자리 · 방향) 안에 모델 그룹 — 의자는 모델 그룹을 앞뒤로 옮겨 넣고 빼요
    const outer = new T.Group();
    outer.add(g);
    const y0 = kind === 'wallac' ? FULL_H - 0.15 - h : (it.z0 || 0) / 100;
    outer.position.set((it.x + it.w / 2) / 100, y0, (it.y + it.h / 2) / 100);
    outer.rotation.y = -deg(it.rot || 0);
    outer.traverse((o) => { o.userData.pid = it.pid; });
    let chair = null;
    if (kind === 'chair' && it.tuck > 0) chair = { tuck: it.tuck / 100, dx: (it.tuckDx || 0) / 100, dy: (it.tuckDy || 0) / 100, base: outer.position.clone() };
    const limited = movers.length > 0 && (warn || movers.some((m) => m.safe < m.max - 0.01));   // 여닫는 데가 있는 짐만(주황 테두리가 보이는 것)
    function update(ratio) {
      movers.forEach((m) => {
        const want = ratio * m.max, v = Math.min(want, m.safe);
        if (m.rot) m.rot.rotation[m.axis] = m.sign * v;
        else m.slide.position.z = m.base + v;
        if (m.lim) m.lim.visible = ratio > 0.02 && (want > m.safe + 0.01 || (m.warn && v >= m.safe - 0.001));
      });
      if (chair) {
        // 닫힘(0) = 식탁 밑으로 넣은 모습 · 열림(1) = 도면 자리(빼 둔 모습). 앞으로 넣기는 모델 +Z, 식탁 다리 피해 옆으로 맞추기는 도면 좌표
        const k = 1 - ratio;
        g.position.z = chair.tuck * k;
        outer.position.set(chair.base.x + chair.dx * k, chair.base.y, chair.base.z + chair.dy * k);
      }
    }
    return { obj: outer, inner: g, update, limited, kind, top: h * n };
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
  function buildFixture(K, f, rooms, tex) {
    const { T, std, glass, box, rbox, cyl, sph } = K;
    const k = f.kind || '', name = f.name || '';
    if (k === 'fridge-spot' || k === 'aircon-port' || k === 'tap') return null;
    const g = new T.Group();
    const W = f.w / 100, D = f.h / 100;
    const cx = f.x + f.w / 2, cy = f.y + f.h / 2;
    if (/튀어나온|기둥|덕트|파이프/.test(name)) return { obj: g, wallLike: true };
    // 앞쪽: 가장 가까운 벽에 등을 대고 방 쪽을 봐요 (위 벽 → 정면 남 0 · 오른쪽 벽 → 서 90 · 아래 벽 → 북 180 · 왼쪽 벽 → 동 270)
    //       거리가 같으면 긴 변이 붙은 벽을 골라요 (조리대처럼 구석에 놓인 긴 고정물)
    const rm = rooms.find((r) => cx >= r.x && cx <= r.x + r.w && cy >= r.y && cy <= r.y + r.h);
    let rot = 0;
    if (rm) {
      const gaps = [[f.y - rm.y, 0], [rm.x + rm.w - f.x - f.w, 90], [rm.y + rm.h - f.y - f.h, 180], [f.x - rm.x, 270]];
      const longV = f.h > f.w * 1.2, longH = f.w > f.h * 1.2;
      const pen = (r) => ((longV && (r === 0 || r === 180)) || (longH && (r === 90 || r === 270)) ? 30 : 0);
      gaps.sort((a, b) => (a[0] + pen(a[1])) - (b[0] + pen(b[1])));
      rot = gaps[0][1];
    }
    const q = rot === 90 || rot === 270;
    const w = q ? D : W, d = q ? W : D;   // 모델 폭(X) · 깊이(Z)
    const fr = d / 2;
    const white = std('#f8f8f6', 0.2, 0.05);
    if (k === 'sink') {
      // 하부장(문짝) · 상판(구멍) · 움푹한 개수대 · 수전
      const H = 0.85, top = 0.035, sd = 0.18;
      const bw = Math.min(0.8, w * 0.38), bd = Math.min(0.45, d * 0.62), bx = w * 0.12, bz = 0.01;
      const cab = std(C.cabinet, 0.5), low = H + top - sd - 0.012;
      box(g, w, low - 0.1, d - 0.04, 0, (low - 0.1) / 2 + 0.1, -0.02, cab);
      const lw = w / 2 + bx - bw / 2, rw = w / 2 - bx - bw / 2;
      box(g, lw, H - low, d - 0.04, -w / 2 + lw / 2, (H + low) / 2, -0.02, cab);
      box(g, rw, H - low, d - 0.04, w / 2 - rw / 2, (H + low) / 2, -0.02, cab);
      box(g, bw, H - low, 0.02, bx, (H + low) / 2, fr - 0.05, cab);
      box(g, w, 0.1, d - 0.08, 0, 0.05, -0.04, std('#d9d5cd', 0.7));
      const nd = Math.max(1, Math.round(w / 0.5));
      for (let i = 0; i < nd; i++) rbox(g, w / nd - 0.006, H - 0.16, 0.018, 0.004, -w / 2 + (w / nd) * (i + 0.5), 0.1 + (H - 0.16) / 2 + 0.01, fr - 0.04, std('#f6f5f1', 0.4));
      const cm = std(C.counter, 0.3, 0, { map: tex.marble });
      const ty = H + top / 2;
      box(g, bx - bw / 2 + w / 2, top, d, (-w / 2 + bx - bw / 2) / 2, ty, 0, cm);
      box(g, w / 2 - bx - bw / 2, top, d, (w / 2 + bx + bw / 2) / 2, ty, 0, cm);
      box(g, bw, top, d / 2 - bz - bd / 2, bx, ty, (d / 2 + bz + bd / 2) / 2, cm);
      box(g, bw, top, d / 2 + bz - bd / 2, bx, ty, (-d / 2 + bz - bd / 2) / 2, cm);
      const st = std('#a9b1b9', 0.25, 0.85), wh = sd - 0.004, wy = H + top - sd / 2 - 0.002;
      box(g, bw, 0.01, bd, bx, H + top - sd, bz, st);
      [[bx - bw / 2, bz, 0.01, bd], [bx + bw / 2, bz, 0.01, bd]].forEach(([x, z, ww, dd]) => box(g, ww, wh, dd, x, wy, z, st));
      [[bz - bd / 2], [bz + bd / 2]].forEach(([z]) => box(g, bw, wh, 0.01, bx, wy, z, st));
      cyl(g, 0.025, 0.025, 0.004, bx, H + top - sd + 0.007, bz, std('#3b4048', 0.5, 0.4));
      const fz = -d / 2 + 0.06;
      cyl(g, 0.016, 0.02, 0.3, bx, H + top + 0.15, fz, std(C.chrome, 0.15, 0.8));
      const sp = cyl(g, 0.012, 0.012, 0.2, bx, H + top + 0.29, fz + 0.1, std(C.chrome, 0.15, 0.8)); sp.rotation.x = Math.PI / 2;
    } else if (/인덕션/.test(name)) {
      rbox(g, w, 0.012, d, 0.004, 0, 0.85 + 0.041, 0, std('#121417', 0.12, 0.3));
      [[-0.25, -0.2], [0.25, -0.2], [0, 0.25]].forEach(([sx, sz]) => {
        const r = K.torus(g, Math.min(w, d) * 0.17, 0.004, sx * w, 0.85 + 0.048, sz * d, std('#5b6570', 0.4, 0.3));
        r.rotation.x = Math.PI / 2;
      });
    } else if (k === 'bath') {
      const H = 0.55, t = 0.07;
      rbox(g, w, H, d, 0.03, 0, H / 2, 0, white);
      rbox(g, w - 2 * t, 0.02, d - 2 * t, 0.05, 0, H - 0.005, 0, std('#dbe7ee', 0.15, 0.1));
    } else if (k === 'toilet') {
      // 물탱크(벽 쪽, 바닥부터) · 몸통 · 타원 시트 · 뚜껑
      const tz = -d / 2 + d * 0.12;
      rbox(g, w * 0.85, 0.78, d * 0.24, 0.02, 0, 0.39, tz, white);
      const tankD = d * 0.24, br = w * 0.4, half = (d - tankD) / 2 - 0.01, bz2 = -d / 2 + tankD + half, sz = half / br;
      const body = cyl(g, br, br * 0.8, 0.38, 0, 0.19, bz2, white, 28); body.scale.z = sz;
      const seat = K.torus(g, br * 0.92, 0.028, 0, 0.4, bz2, std('#ffffff', 0.3)); seat.rotation.x = Math.PI / 2; seat.scale.y = sz;
      const lid = cyl(g, br, br, 0.015, 0, 0.415, bz2, std('#fbfbfa', 0.3), 28); lid.scale.z = sz;
    } else if (k === 'basin') {
      // 상판 + 움푹한 그릇(아래 반구) + 받침 + 수전
      const br = Math.min(w, d) * 0.36;
      const sh = new T.Shape();
      sh.moveTo(-w / 2, -d / 2); sh.lineTo(w / 2, -d / 2); sh.lineTo(w / 2, d / 2); sh.lineTo(-w / 2, d / 2); sh.lineTo(-w / 2, -d / 2);
      const hole = new T.Path();
      hole.absellipse(0, -0.02, br, br * 0.85, 0, Math.PI * 2, true);
      sh.holes.push(hole);
      const tg = new T.ExtrudeGeometry(sh, { depth: 0.04, bevelEnabled: false, curveSegments: 28 });
      tg.rotateX(-Math.PI / 2);   // 모양 y → −z, 두께는 위로 (0.82~0.86m)
      K.put(g, tg, white, 0, 0.82, 0).userData.ownGeo = true;
      const bowl = K.put(g, new T.SphereGeometry(br, 24, 12, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), std('#eef2f4', 0.15, 0.05, { side: T.DoubleSide }), 0, 0.859, 0.02);
      bowl.userData.ownGeo = true; bowl.scale.set(1, 0.6, 0.85);
      cyl(g, 0.018, 0.018, 0.004, 0, 0.859 - br * 0.6 + 0.004, 0.02, std('#3b4048', 0.5, 0.4));
      const ph = 0.859 - br * 0.6 - 0.012;   // 받침은 그릇 바닥 아래까지만(그릇 안에 안 보이게)
      box(g, w * 0.3, ph, d * 0.3, 0, ph / 2, -d * 0.2, std('#f1f1ee', 0.3));
      cyl(g, 0.012, 0.012, 0.16, 0, 0.92, -d / 2 + 0.06, std(C.chrome, 0.15, 0.8));
    } else if (k === 'shoe') {
      const H = num(f.hgt, 0) > 0 ? f.hgt / 100 : 1.2;
      rbox(g, w, H, d, 0.006, 0, H / 2, 0, std('#eceae4', 0.5));
      const n = Math.max(2, Math.round(w / 0.45));
      for (let i = 1; i < n; i++) box(g, 0.004, H - 0.08, 0.004, -w / 2 + (w / n) * i, H / 2, fr + 0.002, std('#c9c5bc', 0.6), { noCast: true });
    } else if (k === 'outdoor-unit') {
      const H = 0.64;
      rbox(g, w, H, d, 0.015, 0, H / 2, 0, std('#eef0f2', 0.45, 0.1));
      const r = Math.min(H, w) * 0.36;
      const fan = cyl(g, r, r, 0.01, -w * 0.15, H / 2, fr + 0.004, std('#3d434a', 0.6)); fan.rotation.x = Math.PI / 2;
      for (let i = 1; i < 4; i++) K.torus(g, (r * i) / 4, 0.003, -w * 0.15, H / 2, fr + 0.01, std('#a7b0b9', 0.5));
    } else {
      rbox(g, w, 0.4, d, 0.01, 0, 0.2, 0, std('#d9d4cc', 0.6));
    }
    mergeStatic(T, g);
    g.position.set(cx / 100, 0, cy / 100);
    g.rotation.y = -deg(rot);
    return { obj: g };
  }

  /* ---------------- 무늬 텍스처 (나무결 · 천 · 대리석 · 바구니 · 바닥) ---------------- */
  function textures(K) {
    const grain = K.canvasTex(256, 256, (c, W, H) => {
      const R = rng('grain');
      c.fillStyle = '#ffffff'; c.fillRect(0, 0, W, H);
      for (let i = 0; i < 70; i++) {
        c.strokeStyle = 'rgba(110,70,30,' + (0.04 + R() * 0.08) + ')'; c.lineWidth = 1 + R() * 2;
        const y = R() * H; c.beginPath(); c.moveTo(0, y);
        c.bezierCurveTo(W / 3, y + (R() - 0.5) * 14, (2 * W) / 3, y + (R() - 0.5) * 14, W, y + (R() - 0.5) * 6); c.stroke();
      }
    }, true);
    const fabric = K.canvasTex(128, 128, (c, W, H) => {
      const R = rng('fabric');
      c.fillStyle = '#ffffff'; c.fillRect(0, 0, W, H);
      for (let y = 0; y < H; y += 2) for (let x = 0; x < W; x += 2) { const v = 232 + Math.floor(R() * 23); c.fillStyle = 'rgb(' + v + ',' + v + ',' + v + ')'; c.fillRect(x, y, 2, 2); }
    }, true);
    fabric.repeat.set(3, 3);
    const marble = K.canvasTex(256, 256, (c, W, H) => {
      const R = rng('marble');
      c.fillStyle = '#ffffff'; c.fillRect(0, 0, W, H);
      for (let i = 0; i < 14; i++) {
        c.strokeStyle = 'rgba(120,128,140,' + (0.08 + R() * 0.15) + ')'; c.lineWidth = 0.6 + R() * 1.6;
        c.beginPath(); let x = R() * W, y = 0; c.moveTo(x, y);
        while (y < H) { x += (R() - 0.5) * 30; y += 12 + R() * 20; c.lineTo(x, y); }
        c.stroke();
      }
    }, true);
    const weave = K.canvasTex(64, 64, (c, W, H) => { c.fillStyle = '#d9c6a3'; c.fillRect(0, 0, W, H); c.strokeStyle = 'rgba(120,90,50,.35)'; for (let i = 0; i < W; i += 8) { c.beginPath(); c.moveTo(i, 0); c.lineTo(i, H); c.stroke(); c.beginPath(); c.moveTo(0, i); c.lineTo(W, i); c.stroke(); } }, true);
    const wood = K.canvasTex(512, 512, (c, Wd, Hd) => {
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
    const tile = K.canvasTex(256, 256, (c, Wd, Hd) => {
      c.fillStyle = '#ffffff'; c.fillRect(0, 0, Wd, Hd);
      c.strokeStyle = 'rgba(40,50,60,.28)'; c.lineWidth = 3;
      for (let i = 0; i <= 4; i++) { c.beginPath(); c.moveTo(i * Wd / 4, 0); c.lineTo(i * Wd / 4, Hd); c.stroke(); c.beginPath(); c.moveTo(0, i * Hd / 4); c.lineTo(Wd, i * Hd / 4); c.stroke(); }
    }, true);
    return { grain, fabric, marble, weave, wood, tile };
  }

  /* ---------------- 다시 열 때 쓰려고 남겨 두는 그림 도구 ----------------
     그림판(WebGL 문맥)과 그 안의 셰이더 · 환경광 · 무늬 · 재질 · 모양. 창을 닫으면 장면만 버리고 이것들은 KEEP_MS 동안 남겨 둬요.
     다시 열면 셰이더를 새로 만들지 않아(가장 오래 걸리는 일) 금방 떠요. 그 사이 문맥을 잃었으면 새로 만들어요. */
  const KEEP_MS = 180000;
  let pool = null;
  const isLost = (r) => { try { return r.getContext().isContextLost(); } catch (e) { return true; } };
  function freeSet(s) {
    clearTimeout(s.timer);
    const lost = isLost(s.renderer);
    try { s.K.dispose(); if (s.envRT) s.envRT.dispose(); s.renderer.dispose(); if (!lost && s.renderer.forceContextLoss) s.renderer.forceContextLoss(); } catch (e) { /* 무시 */ }
  }
  function releasePool() {
    if (!pool || pool.inUse) return;
    const s = pool;
    pool = null;
    freeSet(s);
  }
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') releasePool(); });
  /** 그림판 하나 빌리기 — 남겨 둔 것이 있으면 그대로, 없으면 새로 (이미 하나를 쓰는 중이면 이번 것만 따로 만들고 닫을 때 바로 돌려줘요) */
  function acquire(T, opt) {
    if (pool && !pool.inUse && (pool.preserve !== !!opt.preserve || isLost(pool.renderer))) releasePool();
    if (pool && !pool.inUse) { clearTimeout(pool.timer); pool.inUse = true; return pool; }
    let renderer;
    try {
      renderer = new T.WebGLRenderer({ antialias: true, powerPreference: 'high-performance', preserveDrawingBuffer: !!opt.preserve });
    } catch (e) { return null; }
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = T.PCFSoftShadowMap;
    renderer.shadowMap.autoUpdate = false;   // 그림자는 장면이 바뀔 때만 다시 (돌려 보기만 할 때는 그대로)
    renderer.toneMapping = T.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.0;
    if (T.sRGBEncoding) renderer.outputEncoding = T.sRGBEncoding;
    renderer.physicallyCorrectLights = true;
    const s = { renderer, K: kit(T), envRT: null, preserve: !!opt.preserve, inUse: true, timer: 0 };
    // 남겨 둔 사이에 문맥을 잃으면(GPU 재시작·절전 뒤 깨어남 등) 바로 돌려줘요 — 되살아나도 환경광이 빈 채라 그대로 쓰면 어둡게 그려져요.
    // 창이 열려 있을 때 잃은 것은 장면 쪽(onRestored)이 환경광을 다시 만들고, 못 살리고 닫으면 dispose 가 돌려줘요
    renderer.domElement.addEventListener('webglcontextlost', () => { if (pool === s && !s.inUse) releasePool(); });
    if (!pool) pool = s;
    return s;
  }

  /* ---------------- 장면 ---------------- */
  function create(host, P, opt) {
    const T = window.THREE;
    opt = opt || {};
    if (T.ColorManagement && 'legacyMode' in T.ColorManagement) T.ColorManagement.legacyMode = false;
    const set = acquire(T, opt);
    if (!set) return null;
    const undo = [];   // 장면을 만들다 멈추면 그때까지 시작한 것(그리기·조작·이름표·크기 감시)을 거둬요
    try { return scene3d(T, set, host, P, opt, undo); } catch (e) {
      // 만들다 멈추면 빌린 그림판을 돌려줘요(부른 쪽이 CSS 그림으로 바꿔요)
      undo.forEach((f) => { try { f(); } catch (er) { /* 무시 */ } });
      set.inUse = false;
      if (set === pool) pool = null;
      freeSet(set);
      if (set.renderer.domElement.parentNode) set.renderer.domElement.remove();
      throw e;
    }
  }
  function scene3d(T, set, host, P, opt, undo) {
    const K = set.K, renderer = set.renderer;
    K.begin();
    const geo = (MV.plan3d && MV.plan3d._geo) || {};
    const B = P.bounds;
    const cx = (B.x + B.w / 2) / 100, cz = (B.y + B.h / 2) / 100;
    let dirty = true, raf = 0, alive = true, tween = null, anim = null, lastView = opt.view || 'all';
    undo.push(() => { alive = false; cancelAnimationFrame(raf); raf = 0; });   // 만들다 멈추면 깨워 둔 그리기를 멈춰요(돌려준 그림판에 그리지 않게)
    /** 다시 그려 달라고 표시하고, 쉬고 있던 그리기를 깨워요 (shadows: 그림자도 다시) */
    const need = (shadows) => { dirty = true; if (shadows) renderer.shadowMap.needsUpdate = true; kick(); };
    const span = Math.max(B.w, B.h) / 100;

    const W0 = Math.max(200, host.clientWidth || 600), H0 = Math.max(200, host.clientHeight || 400);
    // 픽셀 비율: 멈춰 있을 때는 늘 원래대로(최대 2). 손가락으로 만지는 촘촘한 화면(휴대폰·태블릿)에서 시점이 움직이는 동안만 조금 낮춰요
    // (마우스로 쓰는 컴퓨터는 고해상도 화면이어도 그대로)
    const fullPR = Math.min(window.devicePixelRatio || 1, 2);
    let coarse = false;
    try { coarse = !!(window.matchMedia && window.matchMedia('(pointer: coarse)').matches); } catch (e) { /* 그대로 */ }
    const movePR = coarse && fullPR > 1 ? Math.max(1, Math.round(fullPR * 0.6 * 100) / 100) : fullPR;
    let curPR = fullPR, lastMove = -1e9, tail = 0, interacting = false, coasting = false;
    renderer.setPixelRatio(fullPR);
    renderer.setSize(W0, H0);
    renderer.shadowMap.needsUpdate = true;
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
    undo.push(() => controls.dispose());

    // 주변 반사(환경광): 위는 밝고 아래는 따뜻한 회색인 하늘 공 → 금속·거울·유리가 실제처럼 비쳐요 (한 번 만들어 다시 열 때도 써요)
    function makeEnv() {
      try {
      const pm = new T.PMREMGenerator(renderer);
      const es = new T.Scene();
      const sky = K.canvasTex(16, 256, (c, Wd, Hd) => { const gr = c.createLinearGradient(0, 0, 0, Hd); gr.addColorStop(0, '#ffffff'); gr.addColorStop(0.45, '#eef0f2'); gr.addColorStop(0.55, '#d8d0c4'); gr.addColorStop(1, '#6b5e4e'); c.fillStyle = gr; c.fillRect(0, 0, Wd, Hd); });
      const sg = new T.SphereGeometry(10, 32, 16);
      const sm = new T.MeshBasicMaterial({ map: sky, side: T.BackSide });
      es.add(new T.Mesh(sg, sm));
      set.envRT = pm.fromScene(es, 0.04);
      scene.environment = set.envRT.texture;
      pm.dispose(); sg.dispose(); sm.dispose(); sky.dispose();
      } catch (e) { set.envRT = null; }
    }
    if (set.envRT) scene.environment = set.envRT.texture;
    else makeEnv();
    const envRT = set.envRT;

    // 빛: 은은한 전체 빛 + 해(그림자) + 푸른 보조광
    scene.add(new T.AmbientLight('#ffffff', envRT ? 0.18 : 0.32));
    scene.add(new T.HemisphereLight('#fff4e6', '#1e293b', envRT ? 0.3 : 0.55));
    const sun = new T.DirectionalLight('#fff3e0', envRT ? 2.4 : 3.1);
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
    const fill = new T.DirectionalLight('#a5c8f5', 0.45);
    fill.position.set(cx - 6, 8, cz - 6);
    scene.add(fill);

    // 땅 · 구조체 바탕(집 아래 판)
    const ground = new T.Mesh(new T.PlaneGeometry(span * 6, span * 6), new T.MeshStandardMaterial({ color: new T.Color('#0b1220'), roughness: 0.95, envMapIntensity: 0.2 }));
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(cx, -0.012, cz);
    ground.receiveShadow = true;
    scene.add(ground);
    K.box(scene, B.w / 100 + 0.3, 0.1, B.h / 100 + 0.3, cx, -0.06, cz, K.std('#1e293b', 0.9), { noCast: true });

    const tex = K.tex();
    // 바닥 무늬 — 방마다가 아니라 집 전체 좌표로 이어지게 (주방·복도·거실 경계에서 나무 판 줄이 이어져요)
    const floorKind = (kind) => (kind === 'bath' ? ['tile', '#7d8a99', 1.2] : kind === 'utility' || kind === 'balcony' || kind === 'storage' ? ['tile', '#a3adb8', 1.2]
      : kind === 'entrance' ? ['tile', '#4b5563', 1.2] : kind === 'bedroom' ? ['wood', C.floorRoom, 1.6] : ['wood', C.floorWood, 1.6]);
    const floorGroup = new T.Group();
    scene.add(floorGroup);
    P.rooms.forEach((r) => {
      if (!(r.w > 0 && r.h > 0)) return;
      const [tk, col, per] = floorKind(r.kind);
      const rw = r.w / 100, rd = r.h / 100, x0 = r.x / 100, z0 = r.y / 100;
      const pg = new T.PlaneGeometry(rw, rd);
      const uv = pg.attributes.uv;
      for (let i = 0; i < uv.count; i++) uv.setXY(i, (x0 + uv.getX(i) * rw) / per, (-z0 - (1 - uv.getY(i)) * rd) / per);
      const m = new T.Mesh(pg, K.std(col, tk === 'wood' ? 0.55 : 0.4, 0, { map: tk === 'wood' ? tex.wood : tex.tile, envMapIntensity: 0.35 }));
      m.userData.ownGeo = true;
      m.rotation.x = -Math.PI / 2;
      m.position.set((r.x + r.w / 2) / 100, 0.001, (r.y + r.h / 2) / 100);
      m.receiveShadow = true;
      floorGroup.add(m);
    });
    mergeStatic(T, floorGroup);
    // 방 이름 · 남쪽 표시 (바닥 글씨 — 짐·고정물에 덜 가리는 빈 자리에, 테두리 있는 흰 글씨). 카메라 쪽에서 바로 읽히게 90°씩 돌려요
    const floorTexts = [];
    let textTurn = 0;
    function turnFloorTexts() {
      const dx = controls.target.x - camera.position.x, dz = controls.target.z - camera.position.z;
      if (Math.hypot(dx, dz) < 0.3) return;   // 거의 바로 위에서 볼 땐 그대로
      const q = Math.round(Math.atan2(-dx, -dz) / (Math.PI / 2)) * (Math.PI / 2);
      if (Math.abs(q - textTurn) < 0.01) return;
      textTurn = q;
      floorTexts.forEach((m) => { m.rotation.z = q; });
    }
    function floorText(text, x, z, size, color) {
      const fs = 64;
      const tmp = document.createElement('canvas').getContext('2d');
      tmp.font = '700 ' + fs + 'px system-ui, sans-serif';
      const tw = Math.ceil(tmp.measureText(text).width) + 28;
      const tx = K.canvasTex(tw, fs + 28, (c, Wd, Hd) => {
        c.font = '700 ' + fs + 'px system-ui, sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
        c.lineWidth = 8; c.strokeStyle = 'rgba(15,23,42,.45)'; c.strokeText(text, Wd / 2, Hd / 2 + 2);
        c.fillStyle = color; c.fillText(text, Wd / 2, Hd / 2 + 2);
      });
      const mesh = new T.Mesh(new T.PlaneGeometry(size * tw / (fs + 28), size), new T.MeshBasicMaterial({ map: tx, transparent: true, depthWrite: false }));
      mesh.userData.ownGeo = true;
      mesh.userData.ownMat = true;   // 글씨 무늬·재질은 이 장면 것 — 닫을 때 버려요
      mesh.rotation.x = -Math.PI / 2;
      mesh.position.set(x, 0.004, z);
      mesh.renderOrder = 2;
      scene.add(mesh);
      floorTexts.push(mesh);
      return { mesh, w: size * tw / (fs + 28) };
    }
    const blocks = P.items.map((it) => ({ x: it.x, y: it.y, w: it.w, h: it.h })).concat(P.fixtures.map((f) => ({ x: f.x, y: f.y, w: f.w, h: f.h })));
    const hitArea = (a) => blocks.reduce((s, b) => s + Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y)), 0);
    P.rooms.forEach((r) => {
      if (r.w < 60 || r.h < 60) return;
      const sz = clamp(Math.min(r.w, r.h) / 100 * 0.16, 0.14, 0.3);
      const tw = Array.from(r.name).length * sz * 100 * 0.95 + 20, th = sz * 100 + 10;
      const cand = [[0, 0], [0, -0.25], [0, 0.25], [-0.25, 0], [0.25, 0], [-0.25, -0.25], [0.25, 0.25], [0.25, -0.25], [-0.25, 0.25]]
        .map(([fx, fy]) => ({ x: r.x + r.w / 2 + fx * r.w, y: r.y + r.h / 2 + fy * r.h }));
      let best = cand[0], bestA = Infinity;
      cand.forEach((p) => { const a = hitArea({ x: p.x - tw / 2, y: p.y - th / 2, w: tw, h: th }); if (a < bestA - 1) { best = p; bestA = a; } });
      floorText(r.name, best.x / 100, best.y / 100, sz, 'rgba(255,255,255,0.8)');
    });
    floorText('☀ 남쪽(전면)', cx, (B.y + B.h) / 100 + 0.45, 0.32, 'rgba(251,146,60,0.95)');

    // 고정물
    const wallLike = [], fxObjs = [];
    P.fixtures.forEach((f) => {
      const r = buildFixture(K, f, P.rooms, tex);
      if (!r) return;
      if (r.wallLike) { wallLike.push(f); return; }
      r.obj.userData.fixture = f.name;
      scene.add(r.obj);
      fxObjs.push(r.obj);
    });

    // 벽 (보기: cut 단면 · glass 반투명 · full 전체) — 바깥 벽은 단면에서 조금 더 높게, 바깥쪽으로 반 두께 비켜 세워요(방 안쪽 크기 그대로)
    const wallGroup = new T.Group();
    scene.add(wallGroup);
    const inRoom = (x, y) => P.rooms.some((r) => x > r.x + 0.5 && x < r.x + r.w - 0.5 && y > r.y + 0.5 && y < r.y + r.h - 0.5);
    const segs = geo.wallSegments ? geo.wallSegments(P) : [];
    segs.forEach((s) => {
      const m = (s.a + s.b) / 2;
      const p1 = s.v ? [s.at - 8, m] : [m, s.at - 8], p2 = s.v ? [s.at + 8, m] : [m, s.at + 8];
      const in1 = inRoom(p1[0], p1[1]), in2 = inRoom(p2[0], p2[1]);
      s.outer = !(in1 && in2);
      s.shift = s.outer && in1 !== in2 ? (in1 ? 1 : -1) * WALL_T / 2 : 0;   // 방이 없는 쪽으로
      if (s.win) {
        const w = P.windows.find((x) => x.v === s.v && Math.abs((x.v ? x.x : x.y) - s.at) < 3 && (x.v ? x.y : x.x) <= s.a + 1 && (x.v ? x.y : x.x) + x.w >= s.b - 1);
        s.door = !!w && /분합문|미닫이|나가는 문|바닥까지 문/.test(w.note || '') && !/인지 확인/.test(w.note || '');   // 확인 전인 창은 보통 창(턱 0.9m)
      }
    });
    const voidRects = geo.voids ? geo.voids(P) : [];
    /** 바깥 벽 위 문(현관)은 벽과 같이 방이 없는 쪽으로 반 두께 옮겨요 (m) */
    const doorShift = (dr) => {
      const m = dr.v ? dr.y + dr.w / 2 : dr.x + dr.w / 2, at = dr.v ? dr.x : dr.y;
      const a = dr.v ? inRoom(at - 8, m) : inRoom(m, at - 8), b = dr.v ? inRoom(at + 8, m) : inRoom(m, at + 8);
      return a !== b ? (a ? 1 : -1) * WALL_T / 2 : 0;
    };
    let wallMode = opt.walls || 'cut';
    function wallMats(mode) {
      if (mode === 'glass') { const m = K.std('#94a3b8', 0.3, 0.05, { transparent: true, opacity: 0.22, depthWrite: false }); return { inner: m, outer: m }; }
      return { inner: K.std('#f1f5f9', 0.75, 0, { envMapIntensity: 0.4 }), outer: K.std('#cbd5e1', 0.7, 0, { envMapIntensity: 0.4 }) };
    }
    function buildWalls() {
      while (wallGroup.children.length) {
        const o = wallGroup.children[0];
        wallGroup.remove(o);
        if (o.userData.ownGeo && o.geometry) o.geometry.dispose();   // 합친 벽 모양(이 벽 보기에서만 쓴 것)
      }
      doorObjs.length = 0;
      const M = wallMats(wallMode), winMat = K.glass('#93c5fd', wallMode === 'glass' ? 0.2 : 0.38);
      const hOf = (outer) => (wallMode === 'cut' ? (outer ? CUT.outer : CUT.inner) : FULL_H);
      const add = (x, y0, z, w, h, d, mat, cast) => { if (h <= 0.002) return null; return K.box(wallGroup, w, h, d, x, y0 + h / 2, z, mat, { noCast: !cast }); };
      const solid = wallMode !== 'glass';
      segs.forEach((s) => {
        const len = (s.b - s.a) / 100, mid = (s.a + s.b) / 200, at = s.at / 100 + s.shift;
        const x = s.v ? at : mid, z = s.v ? mid : at, w = s.v ? WALL_T : len, d = s.v ? len : WALL_T;
        const H = hOf(s.outer), mat = s.outer ? M.outer : M.inner;
        if (!s.win) { add(x, 0, z, w, H, d, mat, solid); return; }
        // 창: 턱(0.9m) + 유리(~2.1m) — 바닥까지 내려오는 문(거실 분합문)은 바닥부터 유리
        const sill = s.door ? 0 : Math.min(WIN_SILL, H);
        add(x, 0, z, w, sill, d, mat, solid);
        const gTop = s.door ? Math.min(DOOR_H, Math.max(H, CUT.inner)) : Math.min(WIN_TOP, H);
        if (gTop > sill) add(x, sill, z, s.v ? 0.02 : w, gTop - sill, s.v ? d : 0.02, winMat, false);
        if (s.door && gTop > sill) add(x, gTop - 0.03, z, w, 0.03, d, K.std('#9aa4ae', 0.4, 0.3), false);   // 문틀
        if (H > gTop) add(x, gTop, z, w, H - gTop, d, mat, solid);
      });
      const vh = wallMode === 'cut' ? CUT.inner : FULL_H;
      voidRects.forEach((v) => add((v.x + v.w / 2) / 100, 0, (v.y + v.h / 2) / 100, v.w / 100, vh, v.h / 100, M.inner, solid));
      wallLike.forEach((f) => add((f.x + f.w / 2) / 100, 0, (f.y + f.h / 2) / 100, f.w / 100, vh, f.h / 100, M.inner, solid));
      // 문 위 벽(전체 보기)
      if (wallMode !== 'cut') P.doors.forEach((dr) => {
        const sh = doorShift(dr);
        const r = dr.v ? { x: dr.x / 100 + sh, z: (dr.y + dr.w / 2) / 100, w: WALL_T, d: dr.w / 100 } : { x: (dr.x + dr.w / 2) / 100, z: dr.y / 100 + sh, w: dr.w / 100, d: WALL_T };
        add(r.x, DOOR_H, r.z, r.w, FULL_H - DOOR_H, r.d, M.inner, false);
      });
      mergeStatic(T, wallGroup);   // 벽 조각도 재질별로 (겹치는 모서리 조각은 따로 · 문짝은 아래에서 따로)
      buildDoors();
      need(true);
    }
    // 방 문짝 (닫힘 ↔ 열림, 비율대로)
    const doorObjs = [];
    function buildDoors() {
      const H = wallMode === 'cut' ? CUT.inner : DOOR_H;
      P.doors.forEach((dr) => {
        if (!dr.hingeAt || !dr.shut || !dr.open) return;
        const [hx, hy] = dr.hingeAt;
        const sh = doorShift(dr);
        const a0 = Math.atan2(dr.shut[1] - hy, dr.shut[0] - hx), a1 = Math.atan2(dr.open[1] - hy, dr.open[0] - hx);
        const len = Math.hypot(dr.shut[0] - hx, dr.shut[1] - hy) / 100;
        if (!(len > 0.05)) return;
        const pivot = new T.Group();
        pivot.position.set(hx / 100 + (dr.v ? sh : 0), 0, hy / 100 + (dr.v ? 0 : sh));
        const leafMat = wallMode === 'glass' ? K.std(C.door, 0.5, 0, { transparent: true, opacity: 0.4, depthWrite: false }) : K.std(C.door, 0.5, 0, { map: tex.grain });
        const lm = K.rbox(pivot, len, H, 0.04, 0.006, len / 2, H / 2, 0, leafMat);
        if (H > 1) K.cyl(lm, 0.012, 0.012, 0.1, len / 2 - 0.07, 0, 0.04, K.std(C.chrome, 0.2, 0.8)).rotation.x = Math.PI / 2;
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
        const m = buildModel(K, it, tex);
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
        const topBox = t.invId === 'inv-top-box';
        const dw = Math.min(t.dw, base.dw), dd = topBox ? t.dd : Math.min(t.dd, base.dd);
        const q = base.rot % 180 !== 0, bw = q ? dd : dw, bh = q ? dw : dd;
        // 뒤에 붙이기(간이박스) 또는 앞에 맞추기(전자레인지) — 정면 0 남 · 90 서 · 180 북 · 270 동
        const back = topBox;
        const x = base.rot === 90 ? (back ? base.x + base.w - bw : base.x) : base.rot === 270 ? (back ? base.x : base.x + base.w - bw) : base.x + (base.w - bw) / 2;
        const y = base.rot === 0 ? (back ? base.y : base.y + base.h - bh) : base.rot === 180 ? (back ? base.y + base.h - bh : base.y) : base.y + (base.h - bh) / 2;
        const it = { pid: 'top-' + t.invId + (i ? '-' + i : ''), invId: t.invId, name: t.name, cat: t.cat, tag: t.tag, fate: t.fate, url: t.url, room: base.room, front: base.front,
          rot: base.rot, dw, dd, hgt: t.hgt, z0: (base.z0 || 0) + base.hgt * Math.max(1, base.n || 1), onTop: base.name, x, y,
          w: bw, h: bh,
          open: t.invId === 'inv-microwave' ? { kind: 'front-door', need: Math.round(dd * 0.9), free: base.open ? Math.min(Math.round(dd * 0.9), base.open.free) : Math.round(dd * 0.9), by: base.open ? base.open.by : '', top: 0 } : null };
        try {
          const m = buildModel(K, it, tex);
          scene.add(m.obj);
          itemObjs.set(it.pid, Object.assign(m, { it }));
          extraItems[it.pid] = it;
        } catch (e) { console.error('[plan3d] 위에 올린 짐', t.name, e); }
      });
    });

    // 비율(0 닫힘 ~ 1 열림)
    let ratio = clamp(num(opt.ratio, 0), 0, 1);
    function applyRatio() { itemObjs.forEach((m) => m.update(ratio)); applyDoors(); refreshSel(); need(true); }

    // 고른 짐 테두리 (비율이 바뀌면 다시 맞춰요)
    let selBox = null, selPid = null;
    function refreshSel() {
      const m = selPid && itemObjs.get(selPid);
      if (selBox && m) { m.obj.updateMatrixWorld(true); selBox.box.setFromObject(m.obj); }
    }
    function select(pid) {
      if (selBox) { scene.remove(selBox); selBox.geometry.dispose(); selBox.material.dispose(); selBox = null; }
      selPid = pid || null;
      const m = selPid && itemObjs.get(selPid);
      if (m) {
        m.obj.updateMatrixWorld(true);
        selBox = new T.Box3Helper(new T.Box3().setFromObject(m.obj), new T.Color('#fb923c'));
        selBox.material.depthTest = false;
        selBox.renderOrder = 5;
        scene.add(selBox);
      }
      need();
    }

    buildWalls();
    applyRatio();
    K.sweep();   // 지난번에 쓰고 이번 장면에는 없는 재질·모양은 버려요(남겨 둔 것이 쌓이지 않게)

    // 이름표 (화면 위 글씨) — 짐을 따라 움직이고(의자 넣기·빼기), 겹치면 키 큰 짐 것만 보여요. 같은 짐 여러 개(의자 4)는 하나로
    const labelLayer = document.createElement('div');
    labelLayer.className = 'p3gl-labels';
    host.appendChild(labelLayer);
    undo.push(() => labelLayer.remove());
    let labelsOn = !!opt.labels;
    const labels = [];
    const seenInv = {};
    itemObjs.forEach((m, pid) => {
      if (pid.startsWith('top-inv-top-box')) return;
      const it = m.it;
      const same = P.items.filter((x) => x.invId === it.invId);
      if (same.length > 1 && seenInv[it.invId]) return;
      seenInv[it.invId] = true;
      const total = same.length ? same.reduce((s, x) => s + Math.max(1, x.n || 1), 0) : Math.max(1, it.n || 1);   // 쌓은 개수까지 (리빙박스 5+5 → ×10)
      const elx = document.createElement('span');
      elx.className = 'p3gl-label';
      elx.textContent = shortName(it.name, 9) + (total > 1 ? ' ×' + total : '');
      labelLayer.appendChild(elx);
      labels.push({ el: elx, pid, anchor: m.inner, y: m.obj.position.y + m.top + 0.08, rank: m.top, w: 0, h: 0 });
    });
    labels.sort((a, b) => b.rank - a.rank);
    const v3 = new T.Vector3();
    function placeLabels() {
      labelLayer.hidden = !labelsOn;
      if (!labelsOn) return;
      const Wd = canvas.clientWidth, Hd = canvas.clientHeight;
      const taken = [];
      labels.forEach((L) => {
        L.anchor.getWorldPosition(v3);
        v3.y = L.y;
        v3.project(camera);
        let vis = v3.z < 1 && Math.abs(v3.x) < 1.05 && Math.abs(v3.y) < 1.05;
        let sx = (v3.x * 0.5 + 0.5) * Wd, sy = (-v3.y * 0.5 + 0.5) * Hd;
        if (vis) {
          if (!L.w) { L.el.style.display = ''; L.w = L.el.offsetWidth || 60; L.h = L.el.offsetHeight || 18; }
          sx = clamp(sx, L.w / 2 + 2, Wd - L.w / 2 - 2); sy = clamp(sy, L.h + 2, Hd - 2);   // 가장자리에서 잘리지 않게 안으로
          const r = { x: sx - L.w / 2, y: sy - L.h, w: L.w, h: L.h };
          if (taken.some((t) => r.x < t.x + t.w + 2 && t.x < r.x + r.w + 2 && r.y < t.y + t.h + 1 && t.y < r.y + r.h + 1)) vis = false;
          else taken.push(r);
        }
        L.el.style.display = vis ? '' : 'none';
        if (vis) L.el.style.transform = 'translate(' + Math.round(sx) + 'px,' + Math.round(sy) + 'px) translate(-50%,-100%)';
      });
    }

    // 시점 (부드럽게 옮기기)
    function viewTo(pos, target, ms) {
      if (!ms) { anim = null; camera.position.copy(pos); controls.target.copy(target); controls.update(); need(); return; }
      anim = { t0: performance.now(), ms, p0: camera.position.clone(), t0v: controls.target.clone(), p1: pos, t1: target };
      need();
    }
    /** 내려다보는 각도 pitch(°), 바라보는 쪽(dir: 카메라가 있는 쪽 0 남 · 90 서 · 180 북 · 270 동)에서 가로 aw·세로 ad(m)가 화면에 다 들어오는 자리 */
    const fitCam = new T.PerspectiveCamera(), fitV = new T.Vector3();
    function fitView(tx, tz, aw, ad, pitchDeg, dir, hgt) {
      const tv = Math.tan(deg(camera.fov / 2)), th = tv * camera.aspect, pitch = deg(pitchDeg);
      const side = dir === 90 || dir === 270;
      const across = side ? ad : aw, along = side ? aw : ad;
      let dist = Math.max(across / 2 / th, (along * Math.sin(pitch) + hgt * Math.cos(pitch)) / 2 / tv) * 1.08 + 0.4;
      const a = deg(dir), ox = -Math.sin(a), oz = Math.cos(a);   // 0 → +Z(남), 90 → −X(서), 180 → −Z(북), 270 → +X(동)
      const at = (d) => new T.Vector3(tx + ox * d * Math.cos(pitch), d * Math.sin(pitch), tz + oz * d * Math.cos(pitch));
      // 카메라 가까운 쪽 모서리는 더 크게 보여서(원근), 상자 꼭짓점 8개가 화면 안(±0.94)에 다 들어올 때까지 물러나요 — 좁은 휴대폰 화면
      fitCam.fov = camera.fov; fitCam.aspect = camera.aspect; fitCam.near = camera.near; fitCam.far = camera.far; fitCam.updateProjectionMatrix();
      const tgt = new T.Vector3(tx, 0, tz);
      for (let i = 0; i < 24; i++) {
        fitCam.position.copy(at(dist)); fitCam.lookAt(tgt); fitCam.updateMatrixWorld(true);
        let mx = 0;
        [-1, 1].forEach((sx) => [-1, 1].forEach((sz) => [0, hgt].forEach((yy) => {
          fitV.set(tx + sx * aw / 2, yy, tz + sz * ad / 2).project(fitCam);
          mx = Math.max(mx, Math.abs(fitV.x), Math.abs(fitV.y));
        })));
        if (mx <= 0.94) break;
        dist *= 1 + Math.min(0.25, (mx - 0.94) * 0.6 + 0.02);
      }
      return [at(dist), tgt];
    }
    function view(id, ms) {
      lastView = id || 'all';
      if (!id || id === 'all') {
        const [p, t] = fitView(cx, cz, B.w / 100 + 0.6, B.h / 100 + 0.9, 58, 0, 1.4);
        return viewTo(p, t, ms);
      }
      if (id === 'top') { const [p, t] = fitView(cx, cz, B.w / 100 + 0.4, B.h / 100 + 0.4, 89, 0, 0); return viewTo(p, t, ms); }
      const r = P.rooms.find((x) => x.id === id);
      if (!r) return;
      // 방 가까이: 카메라 쪽 벽 언저리(방 안 70cm ~ 벽 너머 150cm)에 키 큰 짐(1.2m 넘음)이 가장 적은 쪽에서 내려다봐요 (같으면 남쪽)
      const tall = P.items.filter((it) => (it.z0 || 0) + it.hgt * Math.max(1, it.n || 1) > 120);
      const near = (dir) => tall.reduce((s, it) => {
        const side = dir % 180 !== 0;   // 90·270: 동·서 벽
        const span = side ? Math.min(it.y + it.h, r.y + r.h) - Math.max(it.y, r.y) : Math.min(it.x + it.w, r.x + r.w) - Math.max(it.x, r.x);
        if (span <= 0) return s;
        const wall = dir === 0 ? r.y + r.h : dir === 180 ? r.y : dir === 90 ? r.x : r.x + r.w, out = dir === 0 || dir === 270 ? 1 : -1;
        const lo = side ? it.x : it.y, hi = side ? it.x + it.w : it.y + it.h;
        const bLo = Math.min(wall - out * 70, wall + out * 150), bHi = Math.max(wall - out * 70, wall + out * 150);
        return s + (hi > bLo && lo < bHi ? ((it.z0 || 0) + it.hgt * Math.max(1, it.n || 1)) * span : 0);
      }, 0);
      const dirs = [0, 270, 90, 180].map((dr) => [dr, near(dr) + (dr === 0 ? 0 : 1)]).sort((a, b) => a[1] - b[1]);
      const pitch = r.w * r.h < 60000 ? 64 : 55;
      const [p, t] = fitView((r.x + r.w / 2) / 100, (r.y + r.h / 2) / 100, r.w / 100 + 0.9, r.h / 100 + 0.9, pitch, dirs[0][0], 1.2);
      t.y = 0.5; p.y += 0.5;
      viewTo(p, t, ms);
    }
    view(lastView, 0);

    // 그리기 (바뀔 때만 — 그림자는 장면이 바뀔 때만 다시). 할 일이 없으면 화면 갱신 요청도 멈추고, need()·조작이 다시 깨워요
    controls.addEventListener('change', () => need());
    function kick() { if (!raf && alive) raf = requestAnimationFrame(frame); }
    function frame(now) {
      raf = 0;
      if (!alive) return;
      let moved = false;
      if (anim) {
        const k = clamp((now - anim.t0) / anim.ms, 0, 1), e = 1 - Math.pow(1 - k, 3);
        camera.position.lerpVectors(anim.p0, anim.p1, e);
        controls.target.lerpVectors(anim.t0v, anim.t1, e);
        if (k >= 1) anim = null;
        dirty = true; moved = true;
      }
      if (tween) {
        const k = clamp((now - tween.t0) / tween.ms, 0, 1), e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
        ratio = tween.a + (tween.b - tween.a) * e;
        itemObjs.forEach((m) => m.update(ratio)); applyDoors(); refreshSel();
        renderer.shadowMap.needsUpdate = true;
        if (k >= 1) { tween = null; if (opt.onRatio) opt.onRatio(ratio); }
        dirty = true;
      }
      const camMoved = controls.update();   // 끌기·관성(damping)
      if (camMoved) { dirty = true; lastMove = now; }
      if (camMoved || anim || interacting) tail = 90;   // 관성이 아주 작게 남은 것까지 1.5초쯤 더 풀어 줘요(그릴 것이 없으면 그리지 않아요)
      else if (tail > 0) tail--;
      if (!camMoved && !interacting) coasting = false;
      // 손으로 돌리는 중·놓은 뒤 미끄러지는 중·시점 옮기는 중에만 픽셀 비율을 낮추고(촘촘한 화면만), 멈추면 바로 원래 비율로 다시 그려요
      const low = moved || ((interacting || coasting) && now - lastMove < 100);
      const pr = low ? movePR : fullPR;
      if (pr !== curPR) { curPR = pr; renderer.setPixelRatio(pr); dirty = true; }
      if (dirty) {
        dirty = false;
        turnFloorTexts();
        renderer.render(scene, camera);
        placeLabels();
      }
      if (anim || tween || tail > 0 || curPR !== fullPR) kick();
    }
    controls.addEventListener('start', () => { interacting = true; coasting = false; });
    controls.addEventListener('end', () => { interacting = false; coasting = true; kick(); });
    kick();
    function setRatio(r, animate) {
      r = clamp(num(r, 0), 0, 1);
      if (animate && Math.abs(r - ratio) > 0.01) { tween = { t0: performance.now(), ms: 600, a: ratio, b: r }; need(); return; }
      tween = null; ratio = r; applyRatio();
    }

    // 고르기(누르기 — 끌지 않았을 때): 짐·고정물·벽 가운데 처음 맞은 불투명한 것이 짐일 때만 (가려진 짐은 안 골라요)
    // 두 손가락(확대·옮기기)을 뗄 때는 고르지 않아요. 이름표를 누르면 그 짐을 골라요
    const ray = new T.Raycaster(), pt = new T.Vector2();
    let down = null, multi = false;
    const act = new Set();
    const onDown = (e) => {
      act.add(e.pointerId);
      if (act.size > 1) multi = true;
      down = act.size === 1 ? { x: e.clientX, y: e.clientY, id: e.pointerId } : null;
      if (opt.onTouch) opt.onTouch();
    };
    // 손가락 끌기가 취소되면(스크롤·제스처로 넘어감 등) 돌리기 조작은 'end' 없이 끝나요 → 놓았을 때처럼 마무리해야 그리기가 다시 쉬어요
    const onCancel = (e) => {
      act.delete(e.pointerId); down = null;
      if (!act.size) { multi = false; if (interacting) { interacting = false; coasting = true; kick(); } }
    };
    const onUp = (e) => {
      act.delete(e.pointerId);
      const wasMulti = multi;
      if (!act.size) multi = false;
      if (wasMulti || !down || down.id !== e.pointerId || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 6) { down = null; viewBeforeDrag = null; return; }
      down = null;
      if (viewBeforeDrag) lastView = viewBeforeDrag;   // 누르기만 했으면 시점은 그대로(창 크기가 바뀌면 다시 맞춰요)
      viewBeforeDrag = null;
      if (labelsOn) {
        for (const L of labels) {
          if (L.el.style.display === 'none') continue;
          const b = L.el.getBoundingClientRect();
          if (e.clientX >= b.left && e.clientX <= b.right && e.clientY >= b.top && e.clientY <= b.bottom) { if (opt.onPick) opt.onPick(L.pid); return; }
        }
      }
      const r = canvas.getBoundingClientRect();
      pt.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      ray.setFromCamera(pt, camera);
      const objs = Array.from(itemObjs.values()).map((m) => m.obj).concat(fxObjs, [wallGroup]);
      const hit = ray.intersectObjects(objs, true).find((x) => x.object.visible && x.object.isMesh && (x.object.userData.pid || !(x.object.material && x.object.material.transparent)));
      if (opt.onPick) opt.onPick(hit && hit.object.userData.pid ? hit.object.userData.pid : null);
    };
    canvas.addEventListener('pointerdown', onDown);
    canvas.addEventListener('pointerup', onUp);
    canvas.addEventListener('pointercancel', onCancel);

    function resize() {
      const Wd = Math.max(50, host.clientWidth), Hd = Math.max(50, host.clientHeight);
      const changed = Math.abs(camera.aspect - Wd / Hd) > 0.01;
      camera.aspect = Wd / Hd;
      camera.updateProjectionMatrix();
      renderer.setSize(Wd, Hd);
      if (changed && !anim && lastView) view(lastView, 0);   // 화면 비율이 바뀌면 같은 시점을 다시 맞춰요
      need();
    }
    const ro = window.ResizeObserver ? new ResizeObserver(resize) : null;
    if (ro) ro.observe(host);
    undo.push(() => { if (ro) ro.disconnect(); });
    // 그림 문맥을 잃으면(기기 메모리 부족 등) 브라우저가 되살릴 때까지 3초 기다리고, 안 돌아오면 알려요. 돌아오면 환경광·그림자를 다시
    let lostT = 0;
    const onLost = (e) => { e.preventDefault(); clearTimeout(lostT); if (alive && opt.onLost) lostT = setTimeout(() => { if (alive) opt.onLost(); }, 3000); };
    const onRestored = () => { clearTimeout(lostT); if (!alive) return; set.envRT = null; makeEnv(); need(true); };   // 잃은 문맥의 옛 환경광은 이미 사라져서 버리기만
    canvas.addEventListener('webglcontextlost', onLost);
    canvas.addEventListener('webglcontextrestored', onRestored);
    // 손으로 돌리면 '마지막 시점'은 잊어요(창 크기가 바뀌어도 손으로 맞춘 시점을 지켜요)
    let viewBeforeDrag = null;
    controls.addEventListener('start', () => { viewBeforeDrag = lastView; lastView = null; anim = null; });
    const onWheel = () => { viewBeforeDrag = null; };   // 휠 확대는 손으로 맞춘 시점
    canvas.addEventListener('wheel', onWheel, { passive: true });

    function dispose() {
      alive = false;
      cancelAnimationFrame(raf);
      raf = 0;
      if (ro) ro.disconnect();
      clearTimeout(lostT);
      canvas.removeEventListener('webglcontextlost', onLost);
      canvas.removeEventListener('webglcontextrestored', onRestored);
      canvas.removeEventListener('pointercancel', onCancel);
      canvas.removeEventListener('wheel', onWheel);
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointerup', onUp);
      controls.dispose();
      // 이 장면에서만 쓴 것: 합친 모양 · 테두리 선 · 바닥 글씨(무늬·재질) · 고른 짐 테두리 · 땅 · 그림자 지도
      scene.traverse((o) => {
        if (o.userData && o.userData.ownGeo && o.geometry) o.geometry.dispose();
        if (o.isLineSegments && o.geometry) o.geometry.dispose();
        if (o.userData && o.userData.ownMat && o.material) { if (o.material.map) o.material.map.dispose(); o.material.dispose(); }
      });
      if (selBox) { selBox.geometry.dispose(); selBox.material.dispose(); }
      ground.geometry.dispose(); ground.material.dispose();
      sun.dispose();
      canvas.remove();
      labelLayer.remove();
      // 그림판·셰이더·환경광·재질·모양은 다시 열 때 쓰려고 잠시 남겨요 (따로 만든 것이거나 문맥을 잃었으면 바로 돌려줘요)
      set.inUse = false;
      if (set !== pool || isLost(renderer)) { if (set === pool) pool = null; freeSet(set); return; }
      renderer.renderLists.dispose();
      renderer.setSize(1, 1, false);   // 큰 그림 버퍼는 돌려줘요
      set.timer = setTimeout(releasePool, KEEP_MS);
    }

    // 키보드: ←→ 돌리기 · ↑↓ 위아래 각도 · +− 확대 (CSS 그림과 같은 키)
    const sph = new T.Spherical(), off = new T.Vector3();
    function nudge(k) {
      off.copy(camera.position).sub(controls.target);
      sph.setFromVector3(off);
      if (k === 'ArrowLeft') sph.theta -= deg(10);
      else if (k === 'ArrowRight') sph.theta += deg(10);
      else if (k === 'ArrowUp') sph.phi = clamp(sph.phi - deg(6), 0.05, controls.maxPolarAngle);
      else if (k === 'ArrowDown') sph.phi = clamp(sph.phi + deg(6), 0.05, controls.maxPolarAngle);
      else if (k === '+' || k === '=') sph.radius = clamp(sph.radius / 1.2, controls.minDistance, controls.maxDistance);
      else if (k === '-') sph.radius = clamp(sph.radius * 1.2, controls.minDistance, controls.maxDistance);
      else return false;
      off.setFromSpherical(sph);
      camera.position.copy(controls.target).add(off);
      anim = null; lastView = null; viewBeforeDrag = null;
      controls.update(); need();
      return true;
    }
    const limitedItems = () => Array.from(itemObjs.values()).filter((m) => m.limited);
    return {
      setRatio, view, select, nudge,
      setWalls(m) { wallMode = m === 'glass' || m === 'full' ? m : 'cut'; buildWalls(); },
      setLabels(on) { labelsOn = !!on; need(); },
      items: extraItems,
      limitedCount: () => limitedItems().length,
      tuckedChairs: () => Array.from(itemObjs.values()).filter((m) => m.kind === 'chair' && m.it.tuck > 0).length,
      ratio: () => ratio,
      resize, dispose,
      snapshot() { renderer.render(scene, camera); return canvas.toDataURL('image/png'); },
      _debug: { scene, camera, itemObjs, renderer },
    };
  }

  function shortName(s, n) {
    const a = Array.from(String(s || '').replace(/\s*\(.*$/, '').replace(/\s*—.*$/, ''));
    return a.length > n ? a.slice(0, n - 1).join('') + '…' : a.join('');
  }

  MV.plan3dGL = { supported, load, create, TABLE, PIDOR: { bg: PD.c, dark: !!PD.dark } };
})();
