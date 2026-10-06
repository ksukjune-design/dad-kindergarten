/* ============================================================
   가이드 콘텐츠 A (PROVISIONAL — 리서치 결과로 교체 예정)
   MV.guides 배열에 push 합니다. 항목 형식:
   { id, partIds: ['money'], title, icon, summary, updated: 'YYYY-MM-DD',
     html: '<h2 id="...">…</h2>…',           // app.css 의 callout / tbl / chip 클래스 사용 가능
     sources: [{ label, url }] }
   체크 항목의 guide 필드 'money#loan' → id 'money' 가이드의 id="loan" 앵커.
   ============================================================ */
(function () {
  'use strict';
  MV.guides = MV.guides || [];
  MV.guides.push(
    { id: 'money', partIds: ['money'], title: '통장업무 — 11/3 돈 흐름과 주의사항', icon: '💰', summary: '임시 내용', updated: '2026-10-06',
      html: '<h2 id="flow">11/3 돈 흐름</h2><p>임시 내용입니다.</p><div class="callout warn">리서치 반영 전</div>', sources: [] },
  );
})();
