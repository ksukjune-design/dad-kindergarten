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
.tg-steps .tg-steps { margin: 4px 0 6px; padding-left: 1.1em; list-style: disc; }
.tg-steps > li > strong { display: block; margin-top: 4px; }
.tg-steps > li > p.small { margin: 2px 0 14px; line-height: 1.55; overflow-wrap: anywhere; }
.tg-steps-lead { margin: 0 0 6px; line-height: 1.55; }
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
     (최신 콘솔 화면에 맞춘 글로 바꿔 넣을 수 있게 이 함수 하나에 모아 둠)
     - 2026-10 공식 문서 기준. 콘솔 메뉴 이름은 영어 문서로만 확인된 것이 있어 '화면에 따라 다를 수 있어요'를 붙임.
     - 앱 동작과 맞춘 점: 이메일·비밀번호 로그인만 씀(sync-firebase.js login) · 설정값은 글 조각 통째로 붙여도 해석함(parseConfig)
       · 규칙은 homes/ 아래만 두 이메일에게 엶(rulesText) · 기본 데이터베이스만 씀(app.firestore()) · 계정은 콘솔에서만 만듦(가입 기능 없음)
       · 재설정 메일은 한국어로 보냄(auth.languageCode) · 승인된 도메인은 이메일·비밀번호 로그인에 꼭 필요하지 않아 '권장'으로 둠
     - 영어는 콘솔에서 영어로만 보이는 이름(인증·파이어스토어 메뉴)과 사람이 고를 값(서울 지역 이름)에만 씀 */
  function setupStepsHtml() {
    let host = '';
    try { host = String(global.location.hostname || '').replace(/[^A-Za-z0-9.-]/g, ''); } catch (e) { host = ''; }
    const hostLine = host
      ? `지금 이 앱 주소의 도메인 <code>${host}</code> 를 적고`
      : '이 앱을 여는 주소의 도메인(앞의 주소 머리와 뒤의 경로는 빼고)을 적고';
    return `
<p class="small tg-steps-lead">휴대폰보다 <b>컴퓨터</b>에서 하는 게 훨씬 편해요. 화면이 넓어야 콘솔 메뉴가 다 보여요. ⑥단계만 지금까지 기록해 온 기기에서 해요.</p>
<ol class="tg-steps">
  <li><strong>프로젝트 만들기 (무료)</strong>
    <ul class="tg-steps">
      <li>컴퓨터에서 구글 계정으로 <a href="https://console.firebase.google.com/" target="_blank" rel="noopener">파이어베이스 콘솔</a>을 엽니다.</li>
      <li><b>프로젝트 만들기</b>를 누릅니다. '새 파이어베이스 프로젝트 만들기'나 '프로젝트 추가'로 보일 수도 있어요.</li>
      <li>프로젝트 이름을 적습니다. 아무 이름이나 괜찮지만 영문 소문자·숫자로 짧게 지으면 편해요. 약관 동의에 체크하고 <b>계속</b>을 누릅니다.</li>
      <li>인공지능 도우미(제미나이) 화면이 나오면 켜든 끄든 상관없어요. 이 앱과는 관계가 없어요. <b>계속</b>을 누릅니다.</li>
      <li>구글 애널리틱스 화면에서 '이 프로젝트에서 애널리틱스 사용 설정' 스위치를 <b>끕니다</b>(화면에 따라 이름이 조금 다를 수 있어요). <b>프로젝트 만들기</b>를 누르고, 준비가 끝나면 <b>계속</b>을 누릅니다.</li>
    </ul>
    <p class="small muted">새 프로젝트는 무료 요금제(스파크)로 시작해요. 카드를 등록하지 않아도 돼요. '업그레이드', '블레이즈', '무료 크레딧' 안내가 떠도 누르지 마세요. 무료 요금제에서는 한도를 넘어도 돈이 나가지 않고, 그날만 멈췄다가 한국 시간 오후 4~5시쯤 다시 돼요.</p>
  </li>

  <li><strong>웹 앱 등록 → 설정값 복사</strong>
    <ul class="tg-steps">
      <li>프로젝트 첫 화면(프로젝트 개요) 가운데에 있는 웹 모양 아이콘 <b>&lt;/&gt;</b> 를 누릅니다. 아이콘이 안 보이면 <b>앱 추가</b>를 누르고 웹을 고르세요.</li>
      <li><b>앱 닉네임</b>에 아무 이름이나 적습니다. '파이어베이스 호스팅도 설정합니다'에는 체크하지 <b>않고</b> <b>앱 등록</b>을 누릅니다.</li>
      <li>다음 화면에 중괄호 <code>{ }</code> 로 둘러싸인 설정값 글이 나와요. 그 글 상자의 복사 단추를 누르거나 글을 통째로 골라 복사해서, 메모장이나 카카오톡 '나와의 채팅'에 붙여 둡니다. 앞뒤 줄이 조금 더 붙어도 앱이 알아서 골라 읽어요. 그다음 <b>콘솔로 이동</b>을 누릅니다.</li>
    </ul>
    <p class="small muted">설정값은 비밀번호가 아니에요. 공식 문서에도 앱 코드에 넣어도 된다고 나와 있어요. 우리 기록은 ⑤단계 규칙이 지켜 줘요. 나중에 설정값을 다시 보려면 왼쪽 위 톱니바퀴 → <b>프로젝트 설정</b> → <b>일반</b> 탭 → 아래쪽 <b>내 앱</b> 칸에서 <b>구성</b>을 고르세요(화면에 따라 이름이 조금 다를 수 있어요).</p>
  </li>

  <li><strong>로그인 켜기 · 계정 2개 만들기 · 가입 막기</strong>
    <ul class="tg-steps">
      <li>왼쪽 메뉴에서 인증(Authentication)을 누릅니다. 새 화면에서는 '보안' 묶음 안에, 예전 화면에서는 '빌드' 묶음 안에 있어요(화면에 따라 이름이 조금 다를 수 있어요). 찾기 어려우면 <a href="https://console.firebase.google.com/project/_/authentication/providers" target="_blank" rel="noopener">인증 바로 가기</a>를 누르고, 프로젝트를 고르라고 하면 방금 만든 프로젝트를 누르세요. 처음이면 <b>시작하기</b>를 누릅니다.</li>
      <li><b>로그인 방법</b> 탭에서 <b>이메일/비밀번호</b>를 누릅니다(목록에 없으면 제공업체를 더하는 단추(<b>새 제공업체 추가</b> 등, 화면에 따라 이름이 다를 수 있어요)를 누른 뒤 고르세요). 첫 번째 스위치 <b>사용 설정</b>을 켭니다. 아래 '이메일 링크(비밀번호가 없는 로그인)' 스위치는 끈 채로 두고 <b>저장</b>을 누릅니다. 이 앱은 이메일·비밀번호 로그인만 써요.</li>
      <li><b>사용자</b> 탭에서 <b>사용자 추가</b>를 누릅니다. 내 이메일과 비밀번호(6자 이상)를 적고 <b>사용자 추가</b>를 누릅니다. 한 번 더 해서 아내 이메일과 임시 비밀번호로 계정을 만듭니다.</li>
      <li><b>설정</b> 탭 → <b>사용자 작업</b>에서 '생성(가입) 사용 설정' 체크를 <b>풀고</b> <b>저장</b>을 누릅니다(화면에 따라 이름이 조금 다를 수 있어요). 이제 모르는 사람이 계정을 만들 수 없어요. 콘솔에서 사용자를 추가하는 것은 계속 돼요.</li>
      <li>(권장) 같은 <b>설정</b> 탭 → <b>승인된 도메인</b>에서 <b>도메인 추가</b>를 누르고, ${hostLine} <b>추가</b>를 누릅니다. (<a href="https://console.firebase.google.com/project/_/authentication/settings" target="_blank" rel="noopener">설정 탭 바로 가기</a>)</li>
    </ul>
    <p class="small muted">계정 이메일은 실제로 메일을 받을 수 있는 주소여야 해요. 아내는 ⑦단계에서 재설정 메일로 자기 비밀번호를 정해요. 가입 끄기 칸이 끝내 안 보여도 괜찮아요. 이 앱에는 가입 기능이 없고, ⑤단계 규칙이 두 이메일만 기록을 열어 줘요. 승인된 도메인은 이메일·비밀번호 로그인에 꼭 필요하지는 않지만 1분이면 되니 해 두세요.</p>
  </li>

  <li><strong>데이터베이스 만들기 (서울, 프로덕션 모드)</strong>
    <ul class="tg-steps">
      <li>왼쪽 메뉴에서 파이어스토어(Firestore)를 누릅니다. 새 화면에서는 '데이터베이스 및 스토리지' 묶음 안에, 예전 화면에서는 '빌드' 묶음 안에 있어요(화면에 따라 이름이 조금 다를 수 있어요). 찾기 어려우면 <a href="https://console.firebase.google.com/project/_/firestore" target="_blank" rel="noopener">파이어스토어 바로 가기</a>를 누르세요.</li>
      <li><b>데이터베이스 만들기</b>를 누릅니다.</li>
      <li>버전을 고르는 화면이 나오면 <b>표준</b>(Standard) 버전을 고르고 <b>다음</b>을 누릅니다. 엔터프라이즈 버전은 고르지 마세요.</li>
      <li>데이터베이스 아이디는 처음 채워진 기본값 그대로 둡니다. 바꾸면 앱이 데이터베이스를 찾지 못해요. <b>위치</b>는 서울(<code>asia-northeast3</code>)을 고르고 <b>다음</b>을 누릅니다.</li>
      <li>보안 규칙 시작 모드는 <b>프로덕션 모드</b>를 고르고 <b>만들기</b>를 누릅니다. 1분쯤 기다리면 빈 데이터 화면이 나와요.</li>
    </ul>
    <p class="small muted">위치는 만든 뒤에 바꿀 수 없어요. 미국 같은 처음 값으로 두지 말고 꼭 서울을 고르세요. 위치를 고를 수 없게 막혀 있으면 이미 정해진 것이니 그대로 진행해도 돼요. '테스트 모드'는 고르지 마세요. 30일 동안 누구나 기록을 읽고 고칠 수 있게 열려요.</p>
  </li>

  <li><strong>규칙 붙여 넣기 → 게시</strong>
    <ul class="tg-steps">
      <li>이 화면 바로 아래 '규칙 만들기' 칸에 ③단계에서 만든 두 계정의 이메일을 적습니다. <b>규칙 만들기</b>를 누르고 <b>규칙 복사</b>를 누릅니다.</li>
      <li>파이어베이스의 파이어스토어 화면 위쪽에서 <b>규칙</b> 탭을 누릅니다. 편집 칸 안을 누르고 글을 모두 골라 지웁니다. 복사한 규칙을 붙여 넣고 <b>게시</b>를 누릅니다.</li>
    </ul>
    <p class="small muted">규칙에 적은 두 이메일만 기록을 읽고 쓸 수 있어요. 대소문자는 상관없지만 철자는 ③단계 계정과 똑같아야 해요. 규칙이 적용되기까지 1분쯤, 이미 열려 있는 화면은 최대 10분쯤 걸릴 수 있어요. 빨간 오류 표시가 나오면 글이 잘린 것이니 다시 복사해 붙여 넣으세요.</p>
  </li>

  <li><strong>이 앱에 연결 → 로그인 → 공유 시작</strong>
    <ul class="tg-steps">
      <li>지금까지 체크·메모를 해 온 기기(그 브라우저)에서 이 화면을 엽니다. 그 기기가 휴대폰이면 ②단계에서 카카오톡 '나와의 채팅'에 붙여 둔 설정값을 휴대폰에서 복사하면 돼요.</li>
      <li>아래 '설정값 붙여넣기' 칸에 설정값을 그대로 붙여 넣고 <b>저장</b>을 누릅니다. 앱에 설정값이 이미 들어 있다고 나오면 이 줄은 건너뛰세요.</li>
      <li>맨 위 '지금 상태' 칸에서 내 이메일과 비밀번호를 적고 <b>로그인</b>을 누릅니다.</li>
      <li>'공유 저장소가 아직 비어 있어요'가 나오면 <b>이 기기 기록으로 공유 시작</b>을 누르고, 확인 창에서 <b>공유 시작</b>을 누릅니다.</li>
    </ul>
    <p class="small muted">공유 시작은 기록이 가장 많은 기기에서 처음 한 번만 하면 돼요. 아내 기기에서는 누르지 않아도 돼요(로그인하면 공유 기록이 그대로 보여요). 내 비밀번호를 바꾸고 싶으면 로그아웃한 뒤 '비밀번호를 잊었어요'를 쓰세요.</p>
  </li>

  <li><strong>아내 초대</strong>
    <ul class="tg-steps">
      <li>⑥단계를 마치면 이 화면 위쪽에 생기는 '아내 초대하기' 칸에서 <b>링크 복사</b>(또는 <b>앱 주소 복사</b>)를 누르고 카카오톡으로 아내에게 보냅니다.</li>
      <li>아내는 링크를 엽니다. 카카오톡 안에서 열렸으면 점 세 개 메뉴 → <b>다른 브라우저로 열기</b>(아이폰은 '사파리로 열기')를 누르세요(화면에 따라 이름이 조금 다를 수 있어요). 로그인 칸에 아내 이메일을 적고 <b>비밀번호를 잊었어요</b>를 누릅니다.</li>
      <li>메일함에 온 비밀번호 재설정 메일의 링크를 열고 새 비밀번호(6자 이상)를 정합니다. 앱으로 돌아와 아내 이메일과 새 비밀번호로 <b>로그인</b>하면 끝이에요.</li>
    </ul>
    <p class="small muted">재설정 메일은 <code>firebaseapp.com</code> 으로 끝나는 주소에서 와요. 스팸함으로 갈 수 있으니 안 보이면 스팸함(네이버 '스팸메일함', 지메일 '스팸')을 꼭 확인하세요. 메일 링크는 시간이 지나면 만료될 수 있으니 받자마자 여세요. 앱은 이메일 철자가 틀려도 '보냈어요'라고만 나와요(보안 기능). 메일이 끝내 안 오면 이메일 철자가 ③단계에서 만든 계정과 같은지 확인하세요.</p>
  </li>
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
