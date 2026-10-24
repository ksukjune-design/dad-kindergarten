#!/usr/bin/env node
/* 기본 할 일 글을 고친 뒤: 직전 커밋(기본 HEAD)과 비교해 글이 바뀐 항목과 그 '직전 글 지문'을 찍어요.
   → data-seed.js 의 MV.seed.version 을 1 올리고, 파일 끝에 찍힌 블록을 그대로 붙이면
     이미 쓰던 기록에서도 손대지 않은 항목만 새 글로 바뀌어요 (core.js migrateSeed 의 itemsFrom).
   사용: node move/dev/seed-diff.js [커밋]   예) node move/dev/seed-diff.js origin/main */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { execFileSync } = require('child_process');
const JS = path.resolve(__dirname, '..', 'js');
const REV = process.argv[2] || 'HEAD';
const FILES = ['core.js', 'data-seed.js', 'data-plans.js', 'data-layouts.js'];
function boot(read) {
  const store = {};
  const win = { localStorage: { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: (k) => { delete store[k]; } },
    location: { search: '', hash: '' }, addEventListener() {}, document: { addEventListener() {} }, console, setTimeout, clearTimeout, Date, Math, JSON, URLSearchParams };
  win.window = win;
  const ctx = vm.createContext(win);
  FILES.forEach((f) => vm.runInContext(read(f), ctx, { filename: f }));
  return win.MV;
}
const top = execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd: JS }).toString().trim();
const rel = path.relative(top, JS).split(path.sep).join('/');
const OLD = boot((f) => execFileSync('git', ['show', REV + ':' + rel + '/' + f], { cwd: top, maxBuffer: 64 << 20 }).toString());
const NEW = boot((f) => fs.readFileSync(path.join(JS, f), 'utf8'));
const oldItems = new Map(OLD.seed.items.map((x) => [x.id, x]));
const changed = [];
const added = [];
NEW.seed.items.forEach((x) => {
  const o = oldItems.get(x.id);
  if (!o) { added.push(x.id); return; }
  if (OLD.seedItemPrint(o) !== NEW.seedItemPrint(x)) changed.push([x.id, OLD.seedItemPrint(o)]);
});
const removed = OLD.seed.items.filter((x) => !NEW.seed.items.some((y) => y.id === x.id)).map((x) => x.id);
console.log('비교: ' + REV + ' (기본값 버전 ' + OLD.seed.version + ') → 작업 트리 (버전 ' + NEW.seed.version + ')');
console.log('글 바뀜 ' + changed.length + ' · 새 항목 ' + added.length + (added.length ? ' (' + added.join(', ') + ')' : '') + ' · 없어진 항목 ' + removed.length + (removed.length ? ' (' + removed.join(', ') + ' — removeItems 로 처리)' : ''));
if (!changed.length && !added.length && !removed.length) { console.log('바뀐 기본 항목 없음 — 버전을 올리지 않아도 돼요.'); process.exit(0); }
if (NEW.seed.version <= OLD.seed.version) console.log('⚠ MV.seed.version 을 ' + (OLD.seed.version + 1) + ' 로 올리세요 (그대로면 이미 쓰던 기록에는 반영되지 않아요).');
if (changed.length) {
  const to = Math.max(NEW.seed.version, OLD.seed.version + 1);
  const pairs = changed.map(([id, p]) => "'" + id + "': '" + p + "'");
  const lines = [];
  for (let i = 0; i < pairs.length; i += 4) lines.push('      ' + pairs.slice(i, i + 4).join(', ') + ',');
  console.log('\n  MV.seed.migrations.push({\n    to: ' + to + ',\n    itemsFrom: {\n' + lines.join('\n') + '\n    },\n  });');
}
