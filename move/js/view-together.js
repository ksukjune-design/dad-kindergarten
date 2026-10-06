/* ============================================================
   함께 쓰기 화면 (#/together) — 깃허브 페이지 버전에서 부부가 각자 로그인해 같은 기록을 쓰게 하는 설정·상태 화면
   - 연결은 sync-firebase.js(MV.fb) 가, 동기화 규칙은 sync.js(MV.sync) 가 맡습니다. 이 화면은 보여 주고 누르는 것만.
   - 이메일·비밀번호·규칙에 적은 이메일은 이 화면에서만 쓰고 어디에도 저장하지 않습니다
     (로그인 유지는 파이어베이스가 이 브라우저에 따로 기억).
   - 대시보드 아래쪽의 작은 안내 카드(MV.fb.dashHint)도 여기서 만듭니다.
   ============================================================ */
(function (global) {
  'use strict';
  const { el } = MV;
  const HINT_KEY = 'mv:fb:hint-off';

  MV.css('together', `
.tg { max-width: 760px; }
.tg .card { margin-bottom: 14px; }
.tg h2 { font-size: 1.05rem; margin: 0 0 8px; }
.tg-status-line { font-weight: 700; margin: 0 0 6px; overflow-wrap: anywhere; }
.tg-form { display: grid; gap: 10px; margin-top: 10px; }
.tg-form .input { width: 100%; font-size: 16px; min-height: 44px; } /* 16px 아래면 아이폰·카카오톡 브라우저가 누를 때 확대 */
.tg-pw { display: flex; gap: 8px; align-items: stretch; }
.tg-pw .input { flex: 1 1 auto; min-width: 0; }
.tg-pw .btn { flex: 0 0 auto; white-space: nowrap; }
.tg .btn { white-space: nowrap; }
.tg-status-line .nowrap { white-space: nowrap; }
.tg .btn-tall { min-height: 44px; }
.tg-acts { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 10px; }
.tg-msg { margin: 6px 0 0; font-size: .86rem; color: var(--bad); overflow-wrap: anywhere; }
.tg-msg.ok { color: var(--good); }
.tg-msg:empty { display: none; }
.tg-code { width: 100%; min-height: 120px; font-family: var(--mono); font-size: .78rem; line-height: 1.45; white-space: pre; overflow: auto; }
.tg-link { width: 100%; min-height: 64px; font-family: var(--mono); font-size: .76rem; overflow-wrap: anywhere; word-break: break-all; }
.tg-setup > summary, .tg-faq > summary { cursor: pointer; font-weight: 750; min-height: 44px; display: flex; align-items: center; gap: 8px; list-style: none; }
.tg-setup > summary::-webkit-details-marker, .tg-faq > summary::-webkit-details-marker { display: none; }
.tg-setup > summary::before, .tg-faq > summary::before { content: '▸'; display: inline-block; transition: transform .15s; color: var(--ink-3); }
.tg-setup[open] > summary::before, .tg-faq[open] > summary::before { transform: rotate(90deg); }
.tg-steps { margin: 6px 0 12px; padding-left: 1.3em; }
.tg-steps li { margin: 6px 0; line-height: 1.55; overflow-wrap: anywhere; }
.tg-steps code, .tg-faq code { font-family: var(--mono); font-size: .85em; background: var(--bg-3); padding: 0 4px; border-radius: 4px; overflow-wrap: anywhere; }
.tg-sub { font-size: .95rem; margin: 16px 0 6px; }
.tg-two { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
.tg-faq { border-top: 1px solid var(--line); padding: 2px 0; }
.tg-faq:first-of-type { border-top: 0; }
.tg-faq p { margin: 0 0 10px; line-height: 1.55; }
.tg-hint { display: flex; align-items: center; gap: 8px; padding: 8px 10px 8px 14px; font-size: .88rem; }
.tg-hint .tg-hint-txt { flex: 1 1 auto; min-width: 0; color: var(--ink-2); }
.tg-hint .tg-hint-txt b { color: var(--ink); }
@media (pointer: coarse) {
  .tg-hint .btn-sm { min-height: 44px; }
  .tg-hint .btn-icon { min-width: 44px; }
}
@media (max-width: 520px) {
  .tg-two { grid-template-columns: 1fr; }
  .tg-hint { gap: 6px; padding: 6px 6px 6px 12px; font-size: .84rem; line-height: 1.35; }
  .tg-hint .btn-sm { padding: 0 8px; }
}
`);

  /* ---------- 처음 한 번만: 파이어베이스 설정 단계 안내 ----------
     (최신 콘솔 화면에 맞춘 글로 바꿔 넣을 수 있게 이 함수 하나에 모아 둠) */
  function setupStepsHtml() {
    return `
<ol class="tg-steps">
  <li><b>프로젝트 만들기</b> — 구글 계정으로 <a href="https://console.firebase.google.com/" target="_blank" rel="noopener">파이어베이스 콘솔</a>을 열고 '프로젝트 만들기'를 누릅니다. 이름은 아무거나(예: 우리집이사). 구글 애널리틱스는 <b>끄고</b> 만듭니다.</li>
  <li><b>웹 앱 추가 → 설정값 복사</b> — 프로젝트 첫 화면에서 웹 모양 아이콘(&lt;/&gt;)을 눌러 앱을 등록합니다(호스팅은 체크하지 않음). 화면에 나오는 설정값(중괄호 { } 안 내용)을 통째로 복사해 둡니다.</li>
  <li><b>로그인 켜기·계정 2개 만들기</b> — 왼쪽 메뉴 '빌드 → 인증'에서 '시작하기' → 로그인 방법 '이메일/비밀번호'를 사용 설정합니다. '사용자' 탭에서 '사용자 추가'로 나와 아내 계정을 만듭니다(임시 비밀번호 — 나중에 '비밀번호를 잊었어요'로 바꿀 수 있어요). 마지막으로 '설정' 탭의 사용자 작업에서 <b>가입(계정 생성) 허용을 끕니다</b> — 모르는 사람이 계정을 만들 수 없게.</li>
  <li><b>데이터베이스 만들기</b> — '빌드 → 데이터베이스(파이어스토어)'에서 '데이터베이스 만들기' → 위치는 <b>서울</b>(아시아 북동부 3) → <b>프로덕션 모드</b>로 만듭니다.</li>
  <li><b>규칙 붙여 넣기</b> — 같은 화면의 '규칙' 탭 내용을 모두 지우고, 아래 '규칙 만들기'에서 만든 글을 붙여 넣은 뒤 '게시'를 누릅니다. 이 규칙이 두 사람 말고는 아무도 기록을 못 보게 지켜 줍니다.</li>
  <li><b>이 앱에 연결</b> — 아래 칸에 ②에서 복사한 설정값을 붙여 넣고 [저장] → 위 칸에서 내 이메일로 로그인 → [이 기기 기록으로 공유 시작].</li>
  <li><b>아내 초대</b> — '아내 초대하기' 칸의 링크를 카카오톡으로 보내면 끝이에요.</li>
</ol>`;
  }

  const val = { email: '', pw: '', showPw: false, cfg: '', r1: '', r2: '' };
  const fbOk = () => !!(MV.fb && MV.fb.available);

  function statusKey() {
    const F = MV.fb;
    const Y = MV.sync || {};
    return [F.state, F.configured, F.error, F.user && F.user.email, Y.status, Y.empty, Y.readOnly, Y.lastFbCode].join('|');
  }

  /* ---------- 1. 지금 상태 ---------- */
  function statusCard(redraw) {
    const F = MV.fb;
    const Y = MV.sync || { status: 'local' };
    const card = el('section', { class: 'card', 'aria-label': '지금 상태' }, el('h2', '지금 상태'));
    if (!F.configured) {
      card.appendChild(el('p', { class: 'tg-status-line' }, '아직 함께 쓰기를 설정하지 않았어요'));
      card.appendChild(el('p', { class: 'small muted mb-0' }, '지금 기록은 이 기기(이 브라우저)에만 있어요. 아래 \'처음 한 번만\' 안내를 따라 한 번 설정하면, 부부가 각자 로그인해서 같은 기록을 보고 고칠 수 있어요.'));
      return card;
    }
    if (F.state === 'loading' || F.state === 'off') {
      card.appendChild(el('p', { class: 'tg-status-line' }, '⏳ 함께 쓰기를 준비하는 중이에요…'));
      return card;
    }
    if (F.state === 'error') {
      card.classList.add('tint-bad');
      card.appendChild(el('p', { class: 'tg-status-line' }, '⚠ 함께 쓰기를 시작하지 못했어요'));
      card.appendChild(el('p', { class: 'small' }, F.error || '잠시 뒤 다시 시도해 주세요.'));
      card.appendChild(el('p', { class: 'small muted' }, '그동안 바꾼 내용은 이 기기에 저장돼요.' + (MV.sync.willMerge && MV.sync.willMerge() ? ' 다시 연결되면 공유 기록과 합쳐서 올려요.' : '')));
      card.appendChild(el('div', { class: 'tg-acts' }, el('button', { type: 'button', class: 'btn btn-tall', onclick: () => F.retry() }, '다시 시도')));
      return card;
    }
    if (F.state === 'login') {
      card.appendChild(el('p', { class: 'tg-status-line' }, '🔑 로그인하면 부부가 같은 기록을 봐요'));
      card.appendChild(el('p', { class: 'small muted mb-0' }, '파이어베이스에 만들어 둔 내 계정(또는 아내 계정) 이메일·비밀번호로 로그인하세요. 로그인 전에는 이 기기에만 저장돼요'
        + (MV.sync.willMerge && MV.sync.willMerge() ? ' — 로그인하면 그동안 바꾼 내용을 공유 기록과 합쳐서 올려요.' : '.')));
      card.appendChild(loginForm(redraw));
      return card;
    }
    // 로그인됨
    const email = (F.user && F.user.email) || '';
    const st = Y.status;
    const logoutBtn = el('button', { type: 'button', class: 'btn btn-tall', onclick: () => {
      MV.ui.confirm('로그아웃할까요? 이 기기의 기록은 그대로 남아요. 로그아웃한 동안 바꾼 내용은 다시 로그인하면 공유 기록과 합쳐서 올려요.', { okLabel: '로그아웃' }).then((ok) => {
        if (ok) F.logout().then(() => MV.ui.toast('로그아웃했어요. 지금부터는 이 기기에만 저장돼요 (다시 로그인하면 합쳐요).'));
      });
    } }, '로그아웃');
    const acts = el('div', { class: 'tg-acts' });
    if (st === 'connecting' || st === 'login' || st === 'local') {
      card.appendChild(el('p', { class: 'tg-status-line' }, '⏳ ' + email + ' 로 로그인했어요. 공유 기록을 불러오는 중…'));
    } else if (st === 'empty') {
      card.classList.add('tint-kid');
      card.appendChild(el('p', { class: 'tg-status-line' }, '✨ ' + email + ' 로 연결됨 · 공유 저장소가 아직 비어 있어요'));
      card.appendChild(el('p', { class: 'small mb-0' }, '처음 한 번, 이 기기의 체크·메모·짐 목록·도면 배치를 올려 공유를 시작하세요. 아내는 그다음에 로그인하면 같은 기록을 봐요.'));
      acts.appendChild(el('button', { type: 'button', class: 'btn btn-kid btn-tall', onclick: () => {
        MV.ui.confirm('지금 이 기기의 체크·메모·짐 목록으로 공유를 시작할까요?', { okLabel: '공유 시작' }).then((ok) => {
          if (ok && MV.sync.initFromLocal()) MV.ui.toast('공유를 시작했어요. 이제 아내를 초대하세요.');
        });
      } }, '이 기기 기록으로 공유 시작'));
    } else if (st === 'revoked' || st === 'unreachable') {
      card.classList.add('tint-bad');
      card.appendChild(el('p', { class: 'tg-status-line' }, (st === 'revoked' ? '🔒 ' : '⚠ ') + email + ' 로 로그인했지만 공유하지 못했어요'));
      card.appendChild(el('p', { class: 'small mb-0' }, (MV.sync.statusText && MV.sync.statusText(st)) || '지금은 이 기기에만 저장돼요.'));
      acts.appendChild(el('button', { type: 'button', class: 'btn btn-tall', onclick: () => F.retry() }, '다시 시도'));
    } else {
      const TXT = {
        synced: '바꾼 내용이 바로 서로에게 보여요.',
        saving: '공유 저장소에 저장하는 중이에요.',
        offline: '공유 저장소와 잠시 연결이 끊겼어요. 바꾼 내용은 이 기기에 먼저 저장하고, 다시 연결되면 자동으로 올려요.',
        readonly: '보기 전용 권한이에요. 바꾼 내용은 이 기기에만 남아요.',
        partial: (MV.sync.statusText && MV.sync.statusText('partial')) || '일부 기록을 공유하지 못했어요.',
      };
      const icon = st === 'offline' || st === 'partial' ? '⚠' : st === 'readonly' ? '👁' : st === 'saving' ? '⏳' : '🔗';
      if (st === 'offline' || st === 'partial') card.classList.add('tint-warn'); else card.classList.add('tint-good');
      const TAIL = { offline: '· 잠시 끊김', readonly: '· 보기 전용', partial: '· 일부만 공유' };
      card.appendChild(el('p', { class: 'tg-status-line' }, icon + ' ' + email + ' 로 연결됨 ', el('span', { class: 'nowrap' }, TAIL[st] || '· 공유 중')));
      card.appendChild(el('p', { class: 'small mb-0' }, TXT[st] || '부부가 같은 기록을 봐요.'));
    }
    acts.appendChild(logoutBtn);
    card.appendChild(acts);
    return card;
  }

  function loginForm(redraw) {
    const msg = el('p', { class: 'tg-msg', role: 'alert', 'aria-live': 'polite' });
    const email = el('input', { class: 'input', type: 'email', name: 'username', autocomplete: 'username', inputmode: 'email', autocapitalize: 'off', spellcheck: 'false', value: val.email, placeholder: '이메일', 'aria-label': '이메일' });
    const pw = el('input', { class: 'input', type: val.showPw ? 'text' : 'password', name: 'password', autocomplete: 'current-password', value: val.pw, placeholder: '비밀번호', 'aria-label': '비밀번호' });
    email.addEventListener('input', () => { val.email = email.value; });
    pw.addEventListener('input', () => { val.pw = pw.value; });
    const eye = el('button', { type: 'button', class: 'btn btn-tall', 'aria-pressed': val.showPw ? 'true' : 'false', 'aria-label': '비밀번호 보기', onclick: () => {
      val.showPw = !val.showPw;
      pw.type = val.showPw ? 'text' : 'password';
      eye.setAttribute('aria-pressed', val.showPw ? 'true' : 'false');
      eye.textContent = val.showPw ? '숨기기' : '보기';
    } }, val.showPw ? '숨기기' : '보기');
    const submit = el('button', { type: 'submit', class: 'btn btn-primary btn-tall' }, '로그인');
    const forgot = el('button', { type: 'button', class: 'btn btn-ghost btn-tall', onclick: () => {
      msg.textContent = '';
      msg.classList.remove('ok');
      MV.fb.resetPassword(email.value).then(() => {
        msg.classList.add('ok');
        msg.textContent = '비밀번호 재설정 메일을 보냈어요 (계정이 있다면). 메일함·스팸함을 확인하세요.';
      }, (e) => { msg.textContent = MV.ui.errorText(e, '메일을 보내지 못했어요. 잠시 뒤 다시 해 보세요.'); });
    } }, '비밀번호를 잊었어요');
    const form = el('form', { class: 'tg-form', autocomplete: 'on', novalidate: true },
      el('label', { class: 'field' }, el('span', '이메일'), email),
      el('label', { class: 'field' }, el('span', '비밀번호'), el('div', { class: 'tg-pw' }, pw, eye)),
      el('div', { class: 'tg-acts', style: { marginTop: '0' } }, submit, forgot),
      msg);
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      msg.textContent = '';
      msg.classList.remove('ok');
      submit.disabled = true;
      submit.textContent = '로그인하는 중…';
      MV.fb.login(email.value, pw.value).then(() => {
        val.pw = '';
        MV.ui.toast('로그인했어요.');
      }, (err) => {
        submit.disabled = false;
        submit.textContent = '로그인';
        msg.textContent = MV.ui.errorText(err, '로그인하지 못했어요. 잠시 뒤 다시 해 보세요.');
      });
    });
    return form;
  }

  /* ---------- 2. 아내 초대하기 ---------- */
  function inviteCard() {
    const F = MV.fb;
    const link = F.inviteLink();
    const box = el('textarea', { class: 'textarea tg-link', readonly: true, rows: 3, 'aria-label': '초대 링크', hidden: true }, link);
    const showBox = () => { box.hidden = false; box.focus(); box.select(); };
    const copy = el('button', { type: 'button', class: 'btn btn-primary btn-tall', onclick: () => {
      const done = () => MV.ui.toast(F.baked ? '앱 주소를 복사했어요. 카카오톡으로 아내에게 보내세요.' : '초대 링크를 복사했어요. 카카오톡으로 아내에게 보내세요.');
      const failCopy = () => { showBox(); MV.ui.toast('복사가 막혀 있어요 — 아래 글을 길게 눌러 복사하세요.', { ms: 5000 }); };
      try {
        if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(link).then(done, failCopy);
        else failCopy();
      } catch (e) { failCopy(); }
    } }, F.baked ? '앱 주소 복사' : '링크 복사');
    const show = el('button', { type: 'button', class: 'btn btn-ghost btn-tall', onclick: showBox }, '링크 보기');
    return el('section', { class: 'card', 'aria-label': '아내 초대하기' },
      el('h2', '💌 아내 초대하기'),
      F.baked
        ? el('p', { class: 'small mb-0' }, '이 앱에는 설정이 이미 들어 있어요. 아내는 그냥 이 앱 주소를 열고 아내 이메일·비밀번호로 로그인하면 돼요.')
        : el('p', { class: 'small mb-0' }, '카카오톡으로 보내면 아내는 링크를 열고 아내 이메일·비밀번호로 로그인하면 돼요. 카카오톡 안에서 열렸다면 ⋮ → 다른 브라우저로 열기 후 홈 화면에 추가하면 편해요.'),
      el('div', { class: 'tg-acts' }, copy, show),
      box,
      F.baked ? null : el('p', { class: 'tiny muted mt-8 mb-0' }, '링크에는 비밀번호가 들어 있지 않아요 (어느 파이어베이스에 연결할지만 들어 있음). 아내 계정은 파이어베이스 콘솔에서 미리 만들어 두세요.'));
  }

  /* ---------- 3. 처음 한 번만: 설정 ---------- */
  function setupCard() {
    const F = MV.fb;
    const cfgMsg = el('p', { class: 'tg-msg', 'aria-live': 'polite' });
    const ta = el('textarea', { class: 'textarea tg-code', rows: 7, spellcheck: 'false', autocapitalize: 'off', placeholder: '파이어베이스 콘솔에서 복사한 설정값을 그대로 붙여 넣으세요', 'aria-label': '설정값 붙여넣기' }, val.cfg);
    ta.addEventListener('input', () => { val.cfg = ta.value; });
    const save = el('button', { type: 'button', class: 'btn btn-primary btn-tall', onclick: () => {
      cfgMsg.classList.remove('ok');
      const r = F.saveConfig(ta.value);
      if (!r.ok) { cfgMsg.textContent = r.error; return; }
      val.cfg = '';
      ta.value = '';
      cfgMsg.classList.add('ok');
      cfgMsg.textContent = '저장했어요. 위 \'지금 상태\' 칸에서 로그인하세요.';
      MV.ui.toast('설정을 저장했어요. 로그인해 주세요.');
      global.scrollTo(0, 0);
    } }, '저장');
    const clear = (F.configured && !F.baked) ? el('button', { type: 'button', class: 'btn btn-danger btn-tall', onclick: () => {
      MV.ui.confirm('이 기기에서 함께 쓰기 설정을 지울까요? 로그아웃되고, 이 기기 기록은 그대로 남아요. (파이어베이스에 올린 공유 기록은 지워지지 않아요.)', { okLabel: '설정 지우기', danger: true }).then((ok) => {
        if (ok) F.clearConfig();
      });
    } }, '설정 지우기') : null;

    const ruleMsg = el('p', { class: 'tg-msg', 'aria-live': 'polite' });
    const r1 = el('input', { class: 'input', type: 'email', inputmode: 'email', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', placeholder: '내 이메일', 'aria-label': '내 이메일', value: val.r1 });
    const r2 = el('input', { class: 'input', type: 'email', inputmode: 'email', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', placeholder: '아내 이메일', 'aria-label': '아내 이메일', value: val.r2 });
    r1.addEventListener('input', () => { val.r1 = r1.value; });
    r2.addEventListener('input', () => { val.r2 = r2.value; });
    const out = el('textarea', { class: 'textarea tg-code', readonly: true, rows: 9, hidden: true, 'aria-label': '만든 규칙' });
    const copyRules = el('button', { type: 'button', class: 'btn btn-tall', hidden: true, onclick: () => {
      const failCopy = () => { out.focus(); out.select(); MV.ui.toast('복사가 막혀 있어요 — 규칙 글을 길게 눌러 복사하세요.', { ms: 5000 }); };
      try {
        if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(out.value).then(() => MV.ui.toast('규칙을 복사했어요. 파이어베이스 규칙 탭에 붙여 넣고 게시하세요.'), failCopy);
        else failCopy();
      } catch (e) { failCopy(); }
    } }, '규칙 복사');
    const make = el('button', { type: 'button', class: 'btn btn-tall', onclick: () => {
      const r = F.rulesText(r1.value, r2.value);
      if (!r.ok) { ruleMsg.textContent = r.error; out.hidden = true; copyRules.hidden = true; return; }
      ruleMsg.textContent = '';
      out.value = r.text;
      out.hidden = false;
      copyRules.hidden = false;
    } }, '규칙 만들기');

    const det = el('details', { class: 'tg-setup', open: !F.configured },
      el('summary', '🛠 처음 한 번만: 파이어베이스 설정 (약 15분)'),
      el('p', { class: 'small muted' }, '파이어베이스(구글이 운영하는 무료 데이터베이스)에 우리 집 전용 저장소를 만들고, 나와 아내 두 계정만 쓸 수 있게 하는 과정이에요. 남편이 한 번만 하면 돼요.'),
      el('div', { html: setupStepsHtml() }),
      el('h3', { class: 'tg-sub' }, '규칙 만들기 (⑤단계에 씀)'),
      el('p', { class: 'small muted' }, '두 사람의 로그인 이메일을 적으면 붙여 넣을 규칙 글을 만들어 드려요. 이메일은 이 화면에서만 쓰고 어디에도 저장하지 않아요.'),
      el('div', { class: 'tg-two' }, r1, r2),
      el('div', { class: 'tg-acts' }, make, copyRules),
      ruleMsg,
      out,
      el('h3', { class: 'tg-sub' }, '설정값 붙여넣기 (⑥단계)'),
      F.baked ? el('p', { class: 'small' }, '이 앱에는 설정값이 이미 들어 있어요. 따로 붙여 넣지 않아도 돼요.') : null,
      F.baked ? null : ta,
      el('div', { class: 'tg-acts' }, F.baked ? null : save, clear),
      cfgMsg,
      F.configured && F.config ? el('p', { class: 'tiny muted mt-8 mb-0' }, '지금 설정: 프로젝트 ' + F.config.projectId + (F.baked ? ' (앱에 들어 있음)' : ' (이 기기에 저장됨)')) : null);
    return el('section', { class: 'card', 'aria-label': '처음 한 번만 설정' }, det);
  }

  /* ---------- 4. 자주 묻는 것 ---------- */
  function faqCard() {
    const q = (title, ...body) => el('details', { class: 'tg-faq' }, el('summary', title), body.map((b) => el('p', { class: 'small' }, b)));
    return el('section', { class: 'card', 'aria-label': '자주 묻는 것' },
      el('h2', '자주 묻는 것'),
      q('무료인가요?', '네. 파이어베이스의 무료 요금제(스파크)로 충분해요. 하루에 읽기 5만 번·쓰기 2만 번까지 무료인데, 두 사람이 체크·메모를 고치는 데는 넉넉해요. 카드 등록도 필요 없어요.'),
      q('다른 사람이 우리 기록을 볼 수 있나요?', '아니요. 규칙에 적은 두 계정(나·아내)만 읽고 쓸 수 있어요. 이 앱의 코드는 공개돼 있지만, 기록은 우리 파이어베이스에만 저장되고 앱 코드에는 들어가지 않아요. 초대 링크에도 비밀번호는 없어요.'),
      q('클로드 공유 버전과 이어지나요?', '아니요 — 서로 다른 저장소라 이어지지 않아요. 한쪽만 쓰세요. 옮기려면 쓰던 쪽에서 ⋯ → 백업 파일 저장 → 이쪽에서 ⋯ → 백업에서 복원 하면 돼요 (공유 중이면 아내 화면도 함께 바뀌어요).'),
      q('인터넷이 끊기면요?', '바꾼 내용은 이 기기에 먼저 저장되고, 위쪽에 ⚠ 표시가 떠요. 다시 연결되면 자동으로 올려요 — 끊긴 채로 앱을 새로 열었어도 연결되면 그동안 바꾼 내용을 공유 기록과 합쳐서 올려요. 두 사람이 같은 칸을 동시에 고쳤으면 서로의 내용을 합쳐요 (둘 다 다른 값으로 고친 칸은 한쪽 값으로 정해져요).'),
      q('비밀번호를 잊으면요?', '로그인 칸의 \'비밀번호를 잊었어요\'를 누르면 재설정 메일이 와요. 메일이 안 보이면 스팸함을 확인하세요.'),
      q('로그아웃하면 기록이 사라지나요?', '아니요. 이 기기에 있던 기록은 그대로 남아요. 로그아웃한 동안 바꾼 내용도 다시 로그인하면 공유 기록과 합쳐서 올려요. 이 기기에서 처음 로그인할 때만 공유된 기록으로 맞춰지고, 그 전 기록은 ⋯ 메뉴의 \'공유 전 이 기기 기록 받기\'로 받을 수 있어요.'));
  }

  /* ---------- 화면 ---------- */
  function render(root, params, ctx) {
    root.appendChild(el('div', { class: 'view-head' },
      el('h1', '💑 함께 쓰기'),
      el('span', { class: 'sub' }, '아내와 각자 로그인해서 같은 기록을 보고 고쳐요')));
    const wrap = el('div', { class: 'tg' });
    root.appendChild(wrap);
    if (!fbOk()) {
      wrap.appendChild(el('section', { class: 'card tint-kid' },
        el('p', { class: 'mb-0' }, '클로드 공유 버전은 이미 부부가 함께 써요 — 이 화면은 깃허브 페이지 버전용이에요.')));
      return;
    }
    const statusBox = el('div');
    const restBox = el('div');
    wrap.appendChild(statusBox);
    wrap.appendChild(restBox);
    let sKey = '';
    let rKey = '';
    const draw = () => {
      const F = MV.fb;
      const k = statusKey();
      if (k !== sKey) {
        sKey = k;
        const ae = document.activeElement;
        const refocus = ae && statusBox.contains(ae) ? (ae.getAttribute('aria-label') || '') : '';
        statusBox.replaceChildren(statusCard(draw));
        if (refocus) { const f = statusBox.querySelector('[aria-label="' + refocus + '"]'); if (f) f.focus({ preventScroll: true }); }
      }
      const rk = [F.configured, F.baked, F.config && F.config.projectId].join('|');
      if (rk !== rKey) {
        rKey = rk;
        restBox.replaceChildren(...[F.configured ? inviteCard() : null, setupCard(), faqCard()].filter(Boolean));
      }
    };
    draw();
    ctx.onCleanup(MV.fb.on(draw));
    ctx.onCleanup(MV.store.on('sync', draw));
  }
  MV.view('together', { title: '함께 쓰기', icon: '💑', order: 90, nav: false, render });

  /* ---------- 대시보드 아래쪽 작은 안내 (깃허브 버전·설정 없음일 때만) ---------- */
  if (fbOk()) {
    MV.fb.dashHint = function dashHint() {
      if (!MV.fb.available || MV.fb.configured) return null;
      try { if (global.localStorage.getItem(HINT_KEY)) return null; } catch (e) { /* 무시 */ }
      const node = el('section', { class: 'card flat db-span-12 db-late tg-hint', 'aria-label': '함께 쓰기 안내' },
        el('span', { 'aria-hidden': 'true' }, '💑'),
        el('span', { class: 'tg-hint-txt' }, el('b', '아내와 함께 쓰기'), ' — 각자 로그인해서 같은 기록을 고쳐요'),
        el('a', { class: 'btn btn-sm', href: '#/together' }, '설정하기'),
        el('button', { type: 'button', class: 'btn btn-sm btn-ghost btn-icon', 'aria-label': '이 안내 닫기', title: '이 기기에서 이 안내 숨기기', onclick: (e) => {
          try { global.localStorage.setItem(HINT_KEY, '1'); } catch (err) { /* 무시 */ }
          const n = e.currentTarget.closest('.tg-hint');
          if (n) n.remove();
        } }, '✕'));
      return node;
    };
  }

  // 테스트·디버깅용
  MV.together = { _debug: { setupStepsHtml } };
})(window);
