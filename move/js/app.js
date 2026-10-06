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
        const text = String(r.result);
        let info = '';
        try {
          const peek = JSON.parse(text);
          if (peek && peek.meta) info = (peek._exportedAt ? ' (' + MV.date.time(peek._exportedAt) + ' 에 저장한 파일, 할 일 ' + ((peek.items || []).length) + '개)' : '');
        } catch (e) { /* importJSON 이 한국어로 알려줌 */ }
        MV.ui.confirm('지금 기록을 모두 이 백업 파일 내용으로 바꿀까요?' + info + (MV.sync && MV.sync.mode === 'shared' && !MV.sync.readOnly ? ' 공유 중이라 배우자 화면도 함께 바뀌어요.' : ''), { okLabel: '복원하기', danger: true }).then((ok) => {
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
      r.onerror = () => MV.ui.toast('파일을 읽지 못했어요.');
      r.readAsText(f);
    });
    const theme = document.documentElement.dataset.theme || '';
    const stamp = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    const fname = 'move-backup-' + stamp.getFullYear() + pad(stamp.getMonth() + 1) + pad(stamp.getDate()) + '-' + pad(stamp.getHours()) + pad(stamp.getMinutes()) + '.json';
    const Y = MV.sync || { mode: 'local', status: 'local' };
    const shared = Y.mode === 'shared' && !Y.readOnly;
    const SYNC_TEXT = {
      synced: '🔗 공유 중이에요. 부부가 같은 기록을 보고, 바꾼 내용이 바로 서로에게 보여요.',
      saving: '⏳ 공유 저장소에 저장하는 중이에요.',
      empty: '✨ 공유 저장소가 아직 비어 있어요. 아래 버튼으로 이 기기의 기록을 올려 공유를 시작하세요.',
      readonly: '👁 보기 전용 권한이에요. 바꾼 내용은 이 기기에만 남아요.',
      offline: '⚠ 공유 저장소와 잠시 연결이 끊겼어요. 자동으로 다시 시도해요.',
      connecting: '⏳ 공유 저장소에 연결하는 중이에요.',
    };
    const extraText = (typeof Y.statusText === 'function') ? Y.statusText() : '';
    const syncCard = (Y.mode !== 'local' || Y.status === 'offline' || (!SYNC_TEXT[Y.status] && extraText)) ? el('div', { class: 'card flat tint-kid' },
      el('h3', '함께 쓰기'),
      el('p', { class: 'small' }, SYNC_TEXT[Y.status] || extraText || '이 기기에만 저장돼요.'),
      Y.empty && !Y.readOnly ? el('button', { class: 'btn btn-kid', type: 'button', onclick: () => {
        MV.ui.confirm('지금 이 기기의 체크·메모·짐 목록으로 공유를 시작할까요?', { okLabel: '공유 시작' }).then((ok) => {
          if (ok && Y.initFromLocal()) { m.close(); MV.ui.toast('공유를 시작했어요.'); }
        });
      } }, '이 기기 기록으로 공유 시작') : null,
      Y.localBackup && Y.localBackup() ? el('button', { class: 'btn btn-sm btn-ghost mt-8', type: 'button', onclick: () => {
        MV.ui.download('move-before-share.json', Y.localBackup());
      } }, '공유 전 이 기기 기록 받기') : null) : null;
    const body = el('div', { class: 'stack' },
      el('p', { class: 'small muted' }, shared
        ? '기록은 공유 저장소와 이 브라우저에 함께 저장돼요. 혹시 모르니 중요한 날 전에는 백업 파일도 받아 두세요.'
        : '모든 기록은 이 브라우저 안에만 저장됩니다 (서버로 나가지 않음). 다른 기기·배우자와 맞추려면 백업 파일을 보내고 그쪽에서 복원하세요.'),
      syncCard,
      el('div', { class: 'card flat' },
        el('h3', '백업 · 복원'),
        el('div', { class: 'row' },
          el('button', { class: 'btn btn-primary', type: 'button', onclick: () => {
            Promise.resolve(MV.ui.download(fname, MV.store.exportJSON())).then((ok) => { if (ok !== false) MV.ui.toast('백업 파일을 저장했어요.'); });
          } }, '⬇ 백업 파일 저장'),
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
        el('p', { class: 'small' }, shared
          ? '체크·메모·짐 목록·도면 배치를 모두 지우고 기본값으로 되돌립니다. 공유 중이라 배우자 화면에서도 지워져요. 먼저 백업하세요.'
          : '체크·메모·짐 목록·도면 배치를 모두 지우고 기본값으로 되돌립니다. 먼저 백업하세요.'),
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
    MV.store.on('caps', () => renderNav());
    if (!location.hash) history.replaceState(null, '', '#/dashboard');
    onRoute();
    // 날짜가 바뀌면(자정) D-day 갱신
    setInterval(renderTop, 60 * 1000);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
