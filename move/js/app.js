/* ============================================================
   우리집 이사 관리 — 앱 셸 (내비게이션, 상단바, 데이터 메뉴, 부팅)
   마지막에 로드됩니다. 뷰들은 이미 MV.view(...) 로 등록되어 있습니다.
   기기 편의 저장(공유·백업 대상 아님): mv:theme(화면 밝기), mv:lastBackup(이 기기에서 마지막으로 받은 백업 파일 시각)
   ============================================================ */
(function () {
  'use strict';
  const { el } = MV;

  function navItems() {
    return Object.values(MV.views).filter((v) => v.nav !== false).sort((a, b) => a.order - b.order);
  }

  /** 탭바 링크 주소: 뷰 정의의 navHref()가 '#/…' 글자를 돌려주면 그 주소, 없거나 오류면 '#/이름' (계약 — core.js 머리말) */
  function navHref(v) {
    if (typeof v.navHref === 'function') {
      try {
        const h = v.navHref();
        if (typeof h === 'string' && h.indexOf('#/') === 0) return h;
      } catch (e) { console.warn('[nav] navHref', v.name, e); }
    }
    return '#/' + v.name;
  }

  /* 탭바: 링크는 처음 한 번(또는 보이는 탭이 바뀔 때 — 비서 탭처럼)만 만들고, 그 뒤에는 주소·active·aria-current·배지만 바꿔요.
     눌러 둔 링크의 포커스와 다른 화면이 링크에 붙인 class(바쁨 점 등)가 그대로 남아요 */
  function renderNav() {
    const nav = document.getElementById('nav');
    if (!nav) return;
    const items = navItems();
    let links = Array.from(nav.querySelectorAll(':scope > a[data-view]'));
    if (links.length !== items.length || links.some((a, i) => a.dataset.view !== items[i].name)) {
      nav.innerHTML = '';
      links = items.map((v) => nav.appendChild(el('a', { href: navHref(v), 'data-view': v.name },
        el('span', { class: 'ico', 'aria-hidden': 'true' }, v.icon), el('span', { class: 'lbl' }, v.short || v.title))));
    }
    items.forEach((v, i) => {
      const a = links[i];
      const href = navHref(v);
      if (a.getAttribute('href') !== href) a.setAttribute('href', href);
      const on = MV.route.name === v.name;
      a.classList.toggle('active', on);
      if (on) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
      let n = 0;
      try { n = v.badge ? v.badge() : 0; } catch (e) { n = 0; }
      let b = a.querySelector(':scope > .badge');
      if (n) {
        if (!b) b = a.appendChild(el('span', { class: 'badge', 'aria-hidden': 'true' }));
        b.textContent = String(n);
        b.title = '기한 지남 ' + n + '개';
        a.setAttribute('aria-label', (v.short || v.title) + ', 기한 지남 ' + n + '개');
      } else {
        if (b) b.remove();
        a.removeAttribute('aria-label');
      }
    });
  }
  // 탭바에서 키보드(Enter)로 화면을 옮기면 새 화면 본문(#view)으로 포커스 — 다음 Tab 이 본문 첫 항목부터
  let navKeyAt = 0;
  function wireNavKeys() {
    const nav = document.getElementById('nav');
    if (nav) nav.addEventListener('click', (e) => {
      const a = e.target && e.target.closest ? e.target.closest('a[href]') : null;
      if (a && e.detail === 0 && a.getAttribute('href') !== location.hash) navKeyAt = Date.now();
    });
    // '본문으로 건너뛰기': 주소(#view)를 바꾸면 화면 이동으로 읽히니 바꾸지 않고 포커스만
    const skip = document.querySelector('.skip-link');
    if (skip) skip.addEventListener('click', (e) => { e.preventDefault(); focusView(false); });
  }
  function focusView(noScroll) {
    const v = document.getElementById('view');
    if (v) try { v.focus({ preventScroll: !!noScroll }); } catch (e) { /* 무시 */ }
  }

  function renderTop() {
    const dd = MV.date.dday(MV.date.moveDate());
    const box = document.getElementById('topbar-dday');
    if (box) {
      box.innerHTML = '';
      box.appendChild(el('span', { class: 'dday-n' }, dd.n === 0 ? '오늘 이사!' : '이사 ' + dd.label));
      box.appendChild(el('span', { class: 'dday-date' }, ' · ' + MV.date.fmt(MV.date.moveDate())));
      box.title = '이사일 ' + MV.date.fmtLong(MV.date.moveDate());
    }
    renderStoreWarn();
  }

  /* 브라우저 저장소가 막혔을 때(사생활 보호 창·저장 공간 가득) 상단바에 '⚠ 저장 안 됨' — 누르면 ⋯ 메뉴(백업).
     공유 저장소에 연결돼 있으면 기록은 거기에 남으니 띄우지 않아요 (core 의 경고 토스트와 같은 기준) */
  function renderStoreWarn() {
    const top = document.querySelector('.topbar');
    if (!top) return;
    const bad = MV.store.storageOK === false && !(MV.sync && MV.sync.mode === 'shared');
    top.classList.toggle('is-nostore', bad);
    const chip = document.getElementById('store-warn');
    if (!bad) { if (chip) chip.remove(); return; }
    if (chip) return;
    const tip = '이 브라우저에 저장되지 않아요. 창을 닫으면 기록이 사라져요 — 눌러서 백업 파일을 저장하세요';
    const menu = document.getElementById('topbar-menu');
    top.insertBefore(el('button', { type: 'button', id: 'store-warn', class: 'btn btn-ghost btn-sm store-warn', title: tip, 'aria-label': tip, onclick: openMenu }, '⚠ 저장 안 됨'),
      menu && menu.parentNode === top ? menu : null);
  }

  /* 화면 밝기: '' 시스템 따라가기 · 'light' · 'dark' (기기마다 — localStorage mv:theme) */
  function applyTheme(t) {
    if (t) document.documentElement.dataset.theme = t; else delete document.documentElement.dataset.theme;
    syncThemeColor();
  }
  // 안드로이드 상단 띠·홈 화면 앱 상태줄 색을 지금 화면 바탕색에 맞춰요
  function syncThemeColor() {
    const m = document.querySelector('meta[name="theme-color"]');
    if (!m || !document.body) return;
    try {
      const c = getComputedStyle(document.body).backgroundColor;
      if (c && m.getAttribute('content') !== c) m.setAttribute('content', c);
    } catch (e) { /* 무시 */ }
  }

  /* 마지막으로 받은 백업 파일 시각 (이 기기에만) */
  const BACKUP_KEY = 'mv:lastBackup';
  function lastBackup() {
    try { const v = localStorage.getItem(BACKUP_KEY); return v && !isNaN(Date.parse(v)) ? v : null; } catch (e) { return null; }
  }
  function noteBackup() {
    try { localStorage.setItem(BACKUP_KEY, new Date().toISOString()); } catch (e) { /* 무시 */ }
  }
  function backupLine() {
    const at = lastBackup();
    if (!at) return '아직 이 기기에서 백업 파일을 받은 적 없어요.';
    const n = MV.date.diff(MV.date.str(new Date(at)), MV.date.today());
    return '마지막 백업 파일: ' + MV.date.time(at) + ' (' + (n <= 0 ? '오늘' : n === 1 ? '어제' : n + '일 전') + ')';
  }
  function backupName() {
    const d = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    return 'move-backup-' + d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) + '-' + pad(d.getHours()) + pad(d.getMinutes()) + '.json';
  }

  function openMenu() {
    const st = MV.store.get();
    const Y = MV.sync || { mode: 'local', status: 'local' };
    const shared = Y.mode === 'shared' && !Y.readOnly;
    const fileInput = el('input', { type: 'file', accept: 'application/json,.json', hidden: true });
    fileInput.addEventListener('change', () => {
      const f = fileInput.files && fileInput.files[0];
      if (!f) return;
      const r = new FileReader();
      r.onload = () => {
        const text = String(r.result);
        // 먼저 파일만 살펴봐요 — 이 앱의 백업 파일이 아니면 '바꿀까요?'를 묻지 않고 바로 알려요
        const peek = MV.store.checkBackup ? MV.store.checkBackup(text) : { ok: true };
        if (!peek.ok) {
          fileInput.value = '';
          MV.ui.toast(peek.why || '이 앱에서 저장한 백업 파일이 아니에요.', { ms: 6000 });
          return;
        }
        const info = [peek.exportedAt ? MV.date.time(peek.exportedAt) + '에 저장한 파일' : '', typeof peek.items === 'number' ? '할 일 ' + peek.items + '개' : ''].filter(Boolean).join(', ');
        MV.ui.confirm('지금 기록을 모두 이 백업 파일 내용으로 바꿀까요?' + (info ? ' (' + info + ')' : '') + (shared ? ' 공유 중이라 가족 화면도 함께 바뀌어요.' : ''),
          { okLabel: '복원하기', danger: true, title: '백업에서 복원' }).then((ok) => {
          fileInput.value = '';
          if (!ok) return;
          try {
            MV.store.importJSON(text);
            m.close();
            MV.ui.toast('백업에서 복원했어요.');
          } catch (e) {
            console.error('[복원]', e);
            const why = MV.ui.errorText ? MV.ui.errorText(e, '백업 파일 내용을 이 앱에서 읽을 수 없어요. 이 앱에서 저장한 백업 파일인지 확인해 주세요.') : '이 앱에서 저장한 백업 파일인지 확인해 주세요.';
            MV.ui.toast('복원하지 못했어요. ' + why, { ms: 6000 });
          }
        });
      };
      r.onerror = () => { fileInput.value = ''; MV.ui.toast('파일을 읽지 못했어요.'); };
      r.readAsText(f);
    });
    const theme = document.documentElement.dataset.theme || '';
    const SYNC_TEXT = {
      synced: '🔗 공유 중이에요. 바꾼 내용이 바로 가족 화면에도 보여요.',
      saving: '⏳ 공유 저장소에 저장하는 중이에요.',
      empty: '✨ 공유 저장소가 아직 비어 있어요. 아래 단추로 이 기기의 기록을 올려 공유를 시작하세요.',
      readonly: '👁 보기 전용 권한이에요. 바꾼 내용은 이 기기에만 남아요.',
      offline: '⚠ 공유 저장소와 잠시 연결이 끊겼어요. 자동으로 다시 시도해요.',
      connecting: '⏳ 공유 저장소에 연결하는 중이에요.',
    };
    // 화면 글 용어는 '가족' (sync.js statusText 의 옛 '부부가' 글도 여기서 맞춰 보여요)
    const extraText = String(((typeof Y.statusText === 'function') ? Y.statusText() : '') || '').replace(/부부가/g, '가족이');
    const startShareBtn = (cls) => el('button', { class: 'btn btn-kid' + (cls ? ' ' + cls : ''), type: 'button', onclick: () => {
      MV.ui.confirm('지금 이 기기의 체크·메모·짐 목록으로 공유를 시작할까요?', { okLabel: '공유 시작' }).then((ok) => {
        if (ok) Y.initFromLocal().then((res) => { m.close(); if (res) MV.ui.toast('공유를 시작했어요.'); });
      });
    } }, '이 기기 기록으로 공유 시작');
    const localBackupBtn = (cls) => el('button', { class: 'btn btn-sm btn-ghost' + (cls ? ' ' + cls : ''), type: 'button', onclick: () => {
      MV.ui.download('move-before-share.json', Y.localBackup());
    } }, '공유 전 이 기기 기록 받기');
    // 깃허브 페이지 버전: 함께 쓰기(파이어베이스) — 설정 전에는 한 줄 + 접힌 설명, 설정 뒤에는 상태 + 함께 쓰기 화면 열기
    const FB = MV.fb && MV.fb.available ? MV.fb : null;
    const goTogether = () => { m.close(); MV.go('#/together'); };
    const fbText = () => {
      if (FB.state === 'error') return '⚠ ' + (FB.error || '함께 쓰기를 시작하지 못했어요.') + ' 그동안 바꾼 내용은 이 기기에 저장돼요.';
      if (FB.state === 'loading' || FB.state === 'off') return '⏳ 함께 쓰기를 준비하는 중이에요.';
      if (FB.state === 'login') return extraText || '🔑 로그인하면 가족이 같은 기록을 봐요.';
      const who = FB.user && FB.user.email ? ' (' + FB.user.email + ')' : '';
      if (Y.status === 'synced') return '🔗 공유 중이에요' + who + '. 바꾼 내용이 바로 가족 화면에도 보여요.';
      return SYNC_TEXT[Y.status] || extraText || '이 기기에만 저장돼요.';
    };
    const fbCard = FB ? el('div', { class: 'card flat tint-kid' },
      el('h3', '함께 쓰기'),
      el('p', { class: 'small mb-0' }, FB.configured ? fbText() : '💾 지금은 이 기기에만 저장돼요. 가족과 같은 기록을 쓰려면 함께 쓰기를 설정하세요.'),
      FB.configured ? null : el('details', { class: 'mv-more' }, el('summary', '자세히'),
        el('p', { class: 'small mb-0' }, '체크·메모한 것은 이 브라우저에만 저장되고 공유 기록에는 올라가지 않아요. 다른 기기에서 쓰던 공유 기록을 보려면 \'함께 쓰기 설정\'에서 초대 링크로 열거나 설정값을 붙여 넣고 로그인하세요.')),
      FB.configured && Y.empty && !Y.readOnly && Y.mode === 'shared' ? startShareBtn('mt-8') : null,
      el('div', { class: 'row mt-8' },
        el('button', { class: 'btn' + (FB.configured ? '' : ' btn-kid'), type: 'button', onclick: goTogether }, FB.configured ? '함께 쓰기 화면 열기' : '함께 쓰기 설정'),
        Y.localBackup && Y.localBackup() ? localBackupBtn() : null)) : null;
    const syncCard = FB ? fbCard : (Y.mode !== 'local' || Y.status === 'offline' || (!SYNC_TEXT[Y.status] && extraText)) ? el('div', { class: 'card flat tint-kid' },
      el('h3', '함께 쓰기'),
      el('p', { class: 'small mb-0' }, SYNC_TEXT[Y.status] || extraText || '이 기기에만 저장돼요.'),
      Y.empty && !Y.readOnly ? startShareBtn('mt-8') : null,
      Y.localBackup && Y.localBackup() ? localBackupBtn('mt-8') : null) : null;
    // 백업 · 복원 (가장 자주 쓰는 것 — 맨 위)
    const backupAt = el('p', { class: 'small mt-8 mb-0' }, backupLine());
    const backupCard = el('div', { class: 'card flat' },
      el('h3', '백업 · 복원'),
      el('div', { class: 'row' },
        el('button', { class: 'btn btn-primary', type: 'button', onclick: () => {
          Promise.resolve(MV.ui.download(backupName(), MV.store.exportJSON())).then((ok) => {
            if (ok === false) return;
            noteBackup();
            backupAt.textContent = backupLine();
            MV.ui.toast('백업 파일을 저장했어요.');
          });
        } }, '⬇ 백업 파일 저장'),
        el('button', { class: 'btn', type: 'button', onclick: () => fileInput.click() }, '⬆ 백업에서 복원'),
        fileInput),
      backupAt,
      el('p', { class: 'tiny muted mt-8 mb-0' }, '기록 마지막 변경: ' + MV.date.time(st.meta.updatedAt) + (MV.store.storageOK ? '' : ' · ⚠ 이 브라우저에 저장되지 않아요')),
      !FB && !shared && Y.mode === 'local' ? el('p', { class: 'tiny muted mt-8 mb-0' }, '기록은 이 브라우저 안에만 저장돼요(서버로 보내지 않아요). 다른 기기와 맞추려면 백업 파일을 보내고 그쪽에서 복원하세요.') : null);
    // 화면 밝기: 고르면 바로 바뀌고 창은 그대로
    const segBtns = [];
    const themeCard = el('div', { class: 'card flat' },
      el('h3', '화면'),
      el('div', { class: 'mv-seg', role: 'group', 'aria-label': '화면 밝기' },
        [['', '시스템 따라가기'], ['light', '밝게'], ['dark', '어둡게']].map(([t, label]) => {
          const b = el('button', { type: 'button', class: 'mv-seg-b', 'aria-pressed': String(theme === t), onclick: () => {
            applyTheme(t);
            try { localStorage.setItem('mv:theme', t); } catch (e) { /* 무시 */ }
            segBtns.forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
          } }, label);
          segBtns.push(b);
          return b;
        })));
    const resetCard = el('div', { class: 'card flat tint-bad' },
      el('h3', '처음부터 다시'),
      el('p', { class: 'small' }, shared
        ? '체크·메모·짐 목록·도면 배치를 모두 지우고 기본값으로 되돌려요. 공유 중이라 가족 화면에서도 지워져요. 먼저 백업하세요.'
        : '체크·메모·짐 목록·도면 배치를 모두 지우고 기본값으로 되돌려요. 먼저 백업하세요.'),
      el('button', { class: 'btn btn-danger', type: 'button', onclick: () => {
        MV.ui.confirm('정말 모든 기록을 지우고 처음 상태로 돌릴까요?', { danger: true, okLabel: '모두 지우기' }).then((ok) => {
          if (ok) { MV.store.reset(); m.close(); MV.ui.toast('초기화했어요.'); }
        });
      } }, '초기화'));
    const body = el('div', { class: 'stack mv-menu' }, backupCard, syncCard, themeCard, resetCard);
    const m = MV.ui.modal({ title: '데이터 · 설정', body });
  }

  /* 자금(finance.v)·견적(estimate.v) 버전 이전은 원래 그 화면을 열 때 저장돼요. 대시보드만 여는 기기에서도 공유 기록(클로드가 읽는 db 포함)과
     AI 비서가 확정값(10/8 이사업체 계약·에어컨 설치)을 보도록, 저장된 문서가 옛 버전이면 화면을 그리기 전·공유 기록을 받은 뒤에 한 번 이전해 저장해요.
     문서가 없으면 만들지 않아요. 공유 기록에 다시 붙기 전이면 sync.migrateDoc 이 맞추기 전·뒤를 남겨 늦게 여는 기기의 결과가 먼저 연 기기에서 고친 것을 덮지 않게 해요 */
  function migrateSections() {
    [MV.calc && MV.calc.ensureFinance, MV.calc && MV.calc.ensureEstimate].forEach((fn) => {
      if (typeof fn !== 'function') return;
      try { fn({ onlyOld: true }); } catch (e) { console.warn('[app] 이전', e); }
    });
  }
  function boot() {
    try {
      const t = localStorage.getItem('mv:theme');
      if (t) document.documentElement.dataset.theme = t;
    } catch (e) { /* 무시 */ }
    MV.store.load();
    migrateSections();
    syncThemeColor();
    try {
      const mq = window.matchMedia('(prefers-color-scheme: dark)');
      if (mq.addEventListener) mq.addEventListener('change', syncThemeColor); else if (mq.addListener) mq.addListener(syncThemeColor);
    } catch (e) { /* 무시 */ }
    const menu = document.getElementById('topbar-menu');
    if (menu) menu.addEventListener('click', openMenu);
    wireNavKeys();
    const onRoute = () => {
      const byKey = Date.now() - navKeyAt < 1500;
      navKeyAt = 0;
      MV.rerender(); renderNav(); renderTop();
      const view = document.getElementById('view');
      if (byKey && view && !view.contains(document.activeElement)) focusView(true);
    };
    window.addEventListener('hashchange', onRoute);
    MV.store.on('change', (e) => {
      if (e && (e.reset || e.source === 'remote')) migrateSections(); // 받은 공유 기록이 옛 버전이면 (조용히 저장 — 다시 그리기는 아래대로)
      renderNav(); renderTop();
      if (e && e.reset) MV.rerender(true);
    });
    MV.store.on('caps', () => renderNav());
    if (Array.isArray(MV.store.afterPersist)) MV.store.afterPersist.push(renderStoreWarn);   // 저장이 막히거나 다시 되면 상단 칩
    if (!location.hash) history.replaceState(null, '', '#/dashboard');
    onRoute();
    // 날짜가 바뀌면(자정이 지나도 켜 둔 화면, 밤새 뒤에 있던 탭·홈 화면 앱) 상단바·탭바 배지·지금 화면을 오늘 기준으로 다시 그려요
    shownDay = MV.date.today();
    setInterval(() => { renderTop(); checkDay(); }, 60 * 1000);
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') checkDay(); });
    window.addEventListener('pageshow', () => checkDay());
  }

  /* 날짜 바뀜 감지 — 다시 그리면 입력 중인 글이 사라질 때(열린 창, 화면 안 입력칸에 글이 있을 때)는 미뤘다가 다음 확인(1분마다·화면 복귀)에 해요 */
  let shownDay = null;
  function busyEditing() {
    if (document.querySelector('.modal-back')) return true;
    const a = document.activeElement;
    const view = document.getElementById('view');
    if (!a || !view || !view.contains(a)) return false;
    if (a.isContentEditable) return true;
    return /^(INPUT|TEXTAREA)$/.test(a.tagName) && !/^(checkbox|radio|button|submit|range|file|color)$/i.test(a.type || '') && !!a.value;
  }
  // 날짜를 보여 주지 않는 화면(도면·3D — 다시 그리면 보던 시점·선택이 처음으로 돌아감)은 뷰 정의에 dayRerender:false 가 없어도 여기서 빼요
  const NO_DAY_RERENDER = { plan: true, together: true };
  function checkDay() {
    const t = MV.date.today();
    if (!shownDay || t === shownDay) return;
    if (busyEditing()) { renderNav(); renderTop(); return; }   // 탭바 배지·상단바만 먼저
    shownDay = t;
    renderNav(); renderTop();
    const v = MV.views[MV.route.name];
    if (v && (v.dayRerender === false || (v.dayRerender === undefined && NO_DAY_RERENDER[v.name]))) return;
    MV.rerender(true);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
