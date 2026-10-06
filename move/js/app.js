/* ============================================================
   우리집 이사 관리 — 앱 셸 (내비게이션, 상단바, 데이터 메뉴, 부팅)
   마지막에 로드됩니다. 뷰들은 이미 MV.view(...) 로 등록되어 있습니다.
   ============================================================ */
(function () {
  'use strict';
  const { el } = MV;

  function navItems() {
    return Object.values(MV.views).filter((v) => v.nav !== false).sort((a, b) => a.order - b.order);
  }

  function renderNav() {
    const nav = document.getElementById('nav');
    if (!nav) return;
    nav.innerHTML = '';
    navItems().forEach((v) => {
      let badge = null;
      try {
        const n = v.badge ? v.badge() : 0;
        if (n) badge = el('span', { class: 'badge', title: '기한 지난 항목' }, String(n));
      } catch (e) { /* 무시 */ }
      nav.appendChild(el('a', {
        href: '#/' + v.name,
        class: MV.route.name === v.name ? 'active' : '',
        'aria-current': MV.route.name === v.name ? 'page' : null,
      }, el('span', { class: 'ico', 'aria-hidden': 'true' }, v.icon), el('span', { class: 'lbl' }, v.short || v.title), badge));
    });
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
  }

  function openMenu() {
    const st = MV.store.get();
    const fileInput = el('input', { type: 'file', accept: 'application/json,.json', hidden: true });
    fileInput.addEventListener('change', () => {
      const f = fileInput.files && fileInput.files[0];
      if (!f) return;
      const r = new FileReader();
      r.onload = () => {
        try {
          MV.store.importJSON(String(r.result));
          m.close();
          MV.ui.toast('백업에서 복원했어요.');
        } catch (e) {
          MV.ui.toast('복원 실패: ' + e.message);
        }
      };
      r.readAsText(f);
    });
    const theme = document.documentElement.dataset.theme || '';
    const stamp = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    const fname = 'move-backup-' + stamp.getFullYear() + pad(stamp.getMonth() + 1) + pad(stamp.getDate()) + '-' + pad(stamp.getHours()) + pad(stamp.getMinutes()) + '.json';
    const body = el('div', { class: 'stack' },
      el('p', { class: 'small muted' },
        '모든 기록은 이 브라우저 안에만 저장됩니다 (서버로 나가지 않음). 다른 기기·배우자와 맞추려면 백업 파일을 보내고 그쪽에서 복원하세요.'),
      el('div', { class: 'card flat' },
        el('h3', '백업 · 복원'),
        el('div', { class: 'row' },
          el('button', { class: 'btn btn-primary', type: 'button', onclick: () => { MV.ui.download(fname, MV.store.exportJSON()); MV.ui.toast('백업 파일을 저장했어요.'); } }, '⬇ 백업 파일 저장'),
          el('button', { class: 'btn', type: 'button', onclick: () => fileInput.click() }, '⬆ 백업에서 복원'),
          fileInput),
        el('p', { class: 'tiny muted mt-8 mb-0' }, '마지막 저장: ' + MV.date.time(st.meta.updatedAt) + (MV.store.storageOK ? '' : ' · ⚠ 브라우저 저장소 사용 불가'))),
      el('div', { class: 'card flat' },
        el('h3', '화면'),
        el('div', { class: 'row' },
          ['', 'light', 'dark'].map((t) => el('button', {
            class: 'btn btn-sm' + (theme === t ? ' btn-primary' : ''), type: 'button',
            onclick: () => {
              if (t) document.documentElement.dataset.theme = t; else delete document.documentElement.dataset.theme;
              try { localStorage.setItem('mv:theme', t); } catch (e) { /* 무시 */ }
              m.close();
            },
          }, t === '' ? '시스템 따라가기' : t === 'light' ? '밝게' : '어둡게')))),
      el('div', { class: 'card flat tint-bad' },
        el('h3', '처음부터 다시'),
        el('p', { class: 'small' }, '체크·메모·짐 목록·도면 배치를 모두 지우고 기본값으로 되돌립니다. 먼저 백업하세요.'),
        el('button', { class: 'btn btn-danger', type: 'button', onclick: () => {
          MV.ui.confirm('정말 모든 기록을 지우고 처음 상태로 돌릴까요?', { danger: true, okLabel: '모두 지우기' }).then((ok) => {
            if (ok) { MV.store.reset(); m.close(); MV.ui.toast('초기화했어요.'); }
          });
        } }, '초기화')));
    const m = MV.ui.modal({ title: '데이터 · 설정', body });
  }

  function boot() {
    try {
      const t = localStorage.getItem('mv:theme');
      if (t) document.documentElement.dataset.theme = t;
    } catch (e) { /* 무시 */ }
    MV.store.load();
    const menu = document.getElementById('topbar-menu');
    if (menu) menu.addEventListener('click', openMenu);
    const onRoute = () => { MV.rerender(); renderNav(); renderTop(); };
    window.addEventListener('hashchange', onRoute);
    MV.store.on('change', (e) => {
      renderNav(); renderTop();
      if (e && e.reset) MV.rerender(true);
    });
    if (!location.hash) history.replaceState(null, '', '#/dashboard');
    onRoute();
    // 날짜가 바뀌면(자정) D-day 갱신
    setInterval(renderTop, 60 * 1000);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
