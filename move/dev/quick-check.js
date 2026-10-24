#!/usr/bin/env node
/* 빠른 점검 (약 1분) — 고친 뒤 배포 전에 한 번 돌려요.
   1) js 문법   2) 기본값·이전 규칙(새 기기 · 한 버전 전 기록 · 두 번 돌려도 같음)   3) 주요 화면 (1280 · 390 터치):
      콘솔 오류 · 가로 넘침 · 화면에 '사용자' 글자 · 체크 한 번 눌러 저장되는지
   사용: node move/dev/quick-check.js            (Playwright 경로: PW=/opt/node22/lib/node_modules/playwright)
         node move/dev/quick-check.js --no-ui    (1·2만, 몇 초) */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const http = require('http');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');            // move/
const JS = path.join(ROOT, 'js');
const NO_UI = process.argv.includes('--no-ui');
let fails = 0;
const ok = (c, msg, extra) => { if (!c) fails++; console.log((c ? '  ✓ ' : '  ✗ ') + msg + (!c && extra !== undefined ? '  ' + JSON.stringify(extra).slice(0, 400) : '')); };
const t0 = Date.now();

// 1) 문법
console.log('1) 문법');
const files = fs.readdirSync(JS).filter((f) => f.endsWith('.js'));
const bad = files.filter((f) => { try { execFileSync(process.execPath, ['--check', path.join(JS, f)], { stdio: 'pipe' }); return false; } catch (e) { return true; } });
ok(!bad.length, 'node --check ' + files.length + '개', bad);

// 2) 기본값·이전 규칙 (브라우저 없이)
console.log('2) 기본값·이전 규칙');
function boot(store) {
  const win = { localStorage: { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: (k) => { delete store[k]; } },
    location: { search: '', hash: '' }, addEventListener() {}, document: { addEventListener() {} }, console, setTimeout, clearTimeout, Date, Math, JSON, URLSearchParams };
  win.window = win;
  const ctx = vm.createContext(win);
  ['core.js', 'data-seed.js', 'data-plans.js', 'data-layouts.js'].forEach((f) => vm.runInContext(fs.readFileSync(path.join(JS, f), 'utf8'), ctx, { filename: f }));
  return win.MV;
}
try {
  const MV = boot({});
  const st = MV.store.load();
  const ids = st.items.map((x) => x.id);
  ok(st.seedVersion === MV.seed.version, '새 기기: 기본값 버전 ' + MV.seed.version + ' · 할 일 ' + st.items.length + ' · 짐 ' + st.inventory.length);
  ok(new Set(ids).size === ids.length, '할 일 id 겹침 없음');
  const vers = (MV.seed.migrations || []).map((m) => m.to);
  ok(vers.every((v) => v <= MV.seed.version), '이전 규칙 버전이 기본값 버전 이하', vers);
  // 한 버전 전 기록처럼: 버전만 낮춘 새 기록에 이전 규칙을 다시 돌려도 아무것도 깨지지 않고, 두 번 돌려도 같음
  const store = {};
  const M2 = boot(store);
  const s0 = M2.store.load();
  s0.seedVersion = MV.seed.version - 1;
  store['mv:state:v1'] = JSON.stringify(s0);
  const M3 = boot(store);
  const a = M3.store.load();
  const M4 = boot(store);
  const b = M4.store.load();
  const strip = (s) => { const c = JSON.parse(JSON.stringify(s)); delete c.activity; if (c.meta) { delete c.meta.updatedAt; delete c.meta.createdAt; } return JSON.stringify(c); };
  ok(a.seedVersion === MV.seed.version && strip(a) === strip(b), '한 버전 전 기록 → 지금 버전, 두 번 열어도 같음');
} catch (e) { ok(false, '기본값을 불러오다 오류', String(e && e.stack || e)); }

if (NO_UI) finish();
else ui().then(finish, (e) => { ok(false, '화면 점검 오류', String(e && e.stack || e)); finish(); });

function finish() {
  console.log((fails ? '✗ 실패 ' + fails + '개' : '✓ 모두 통과') + ' (' + ((Date.now() - t0) / 1000).toFixed(1) + '초)');
  process.exit(fails ? 1 : 0);
}

// 3) 화면
async function ui() {
  console.log('3) 화면');
  const pw = require(process.env.PW || '/opt/node22/lib/node_modules/playwright');
  const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.json': 'application/json', '.webmanifest': 'application/manifest+json' };
  const server = http.createServer((req, res) => {
    const u = decodeURIComponent(req.url.split('?')[0]);
    let f = path.join(ROOT, u === '/' ? 'index.html' : u);
    if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream', 'cache-control': 'no-store' });
    fs.createReadStream(f).pipe(res);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + server.address().port + '/index.html';
  const browser = await pw.chromium.launch();
  const ROUTES = ['#/', '#/checklist', '#/stuff/inventory', '#/stuff/estimate', '#/stuff/quotes', '#/plan', '#/money', '#/money/flow', '#/guide', '#/guide/mover', '#/together'];
  try {
    for (const vp of [{ name: '1280', viewport: { width: 1280, height: 800 } }, { name: '390 터치', viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true }]) {
      const ctx = await browser.newContext(Object.assign({ colorScheme: 'light' }, vp));
      // 바깥 CDN(파이어베이스 SDK 등)은 막고 시험
      await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.abort());
      const page = await ctx.newPage();
      const errs = [];
      page.on('pageerror', (e) => errs.push('pageerror ' + e.message));
      page.on('console', (m) => { if (m.type() === 'error' && !/ERR_FAILED|net::|Failed to load resource/.test(m.text())) errs.push(m.text()); });
      const issues = [];
      for (const r of ROUTES) {
        await page.goto(base + r, { waitUntil: 'load' });
        await page.waitForTimeout(250);
        const info = await page.evaluate(() => ({
          over: document.documentElement.scrollWidth - window.innerWidth,
          user: location.hash !== '#/together' && /사용자/.test(document.body.innerText), // 함께 쓰기 화면은 파이어베이스 콘솔 메뉴 이름이라 예외
          empty: !(document.querySelector('main, #app, .view') || document.body).innerText.trim(),
        }));
        if (info.over > 1) issues.push(r + ' 가로 넘침 ' + info.over + 'px');
        if (info.user) issues.push(r + " 화면에 '사용자'");
        if (info.empty) issues.push(r + ' 빈 화면');
      }
      ok(!issues.length, vp.name + ': 화면 ' + ROUTES.length + '개 (넘침·사용자·빈 화면)', issues);
      // 체크 한 번 → 새로 열어도 남는지 (이 브라우저 저장)
      await page.goto(base + '#/checklist', { waitUntil: 'load' });
      await page.waitForTimeout(300);
      const id = await page.evaluate(() => { const it = MV.store.get().items.find((x) => !x.done); return it && it.id; });
      const row = page.locator('[data-fkey="cb:' + id + '"]').first();
      let clicked = false;
      if (id && await row.count()) {
        try { await row.scrollIntoViewIfNeeded({ timeout: 3000 }); await row.click({ timeout: 3000 }); clicked = true; } catch (e) { await row.evaluate((b) => b.click()); clicked = true; }
      } else if (id) { await page.evaluate((i) => MV.items.toggle(i), id); }
      await page.waitForTimeout(500);
      await page.reload({ waitUntil: 'load' });
      await page.waitForTimeout(300);
      const kept = await page.evaluate((i) => { const it = MV.store.get().items.find((x) => x.id === i); return !!(it && it.done); }, id);
      ok(kept, vp.name + ': 체크(' + (clicked ? '누름' : '직접') + ') 뒤 새로 열어도 남음 · ' + id);
      // 함께 쓰기 연결 전이면 '이 브라우저에만' 칩
      const chip = await page.evaluate(() => { const c = document.getElementById('sync-chip'); return c ? c.dataset.status : null; });
      ok(chip === 'local', vp.name + ": 연결 전 '이 브라우저에만' 칩", chip);
      ok(!errs.length, vp.name + ': 콘솔 오류 없음', errs.slice(0, 5));
      await ctx.close();
    }
  } finally {
    await browser.close();
    server.close();
  }
}
