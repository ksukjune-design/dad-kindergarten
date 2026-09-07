# GitHub Pages 배포 — 남은 두 줄

이 폴더는 이미 git 저장소이고 커밋까지 끝나 있습니다.
`gh` CLI 와 GitHub 로그인 정보가 이 PC 에 없어서 푸시만 직접 하셔야 합니다.

## 1. GitHub 에서 빈 저장소를 하나 만듭니다

https://github.com/new
- 이름: `dad-kindergarten` (원하는 이름 아무거나)
- **Public** — Pages 무료 플랜은 공개 저장소여야 합니다
- README·.gitignore·license 는 **체크하지 마세요** (비어 있어야 합니다)

## 2. 이 폴더에서 두 줄

```
cd D:\AI_EDUCATION\dist\gh-pages
git remote add origin https://github.com/<사용자명>/dad-kindergarten.git
git push -u origin main
```

처음 푸시할 때 브라우저가 열리면서 GitHub 로그인을 물어봅니다. 한 번만 하면 됩니다.

## 3. Pages 켜기

저장소 → **Settings → Pages**
- Source: **Deploy from a branch**
- Branch: **main** / 폴더: **/ (root)** → Save

1~2분 뒤 열립니다:

    https://<사용자명>.github.io/dad-kindergarten/

## 다음부터 갱신할 때

```
cd D:\AI_EDUCATION
node tools/bundle.js
node tools/package-ghpages.js
cd dist\gh-pages
git add -A
git commit -m "업데이트"
git push
```

`package-ghpages.js` 는 매번 `dist/gh-pages/` 를 새로 만들지만 `.git` 폴더는 지우지 않으니
원격 주소와 이력은 그대로 유지됩니다.

## 갤럭시탭에서 쓰는 법

크롬으로 위 주소를 열고 **⋮ → 홈 화면에 추가**.
주소창이 사라져 세로를 80~100px 더 씁니다. 세로가 귀한 앱이라 차이가 큽니다.

## 알아두실 것

- **공개됩니다.** 링크를 아는 누구나 열 수 있습니다. 프로그램만 공개되고,
  아이가 쓴 글은 그 브라우저 안에만 남아 저장소로 올라가지 않습니다.
- **AI 는 서버가 없어 기본 꺼짐**입니다. 쓰시려면 화면의 ⚙ AI 설정에 제미나이 키를
  직접 넣으세요. 키는 그 브라우저에만 저장됩니다. AI 를 꺼도 8편 전부 진행됩니다.
- 빌드 때마다 키 유출 검사(`AIza…` 패턴)가 돌고, 걸리면 빌드가 중단됩니다.
