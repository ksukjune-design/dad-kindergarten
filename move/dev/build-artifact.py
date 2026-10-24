"""move/index.html → 클로드 공유 버전 페이지(page.html) + 함께 올릴 파일 목록(files.json).
페이지에는 doctype/html/head/body 를 넣지 않습니다(게시할 때 감쌈). css/js/icon 은 같은 경로로 함께 게시.
사용: python3 move/dev/build-artifact.py <출력 폴더>"""
import json, os, re, sys
ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
OUT = os.path.abspath(sys.argv[1] if len(sys.argv) > 1 else '/tmp/move-artifact')
src = open(os.path.join(ROOT, 'index.html'), encoding='utf-8').read()
title = re.search(r'<title>(.*?)</title>', src, re.S).group(1).strip()
body = re.search(r'<body>(.*)</body>', src, re.S).group(1)
scripts = re.findall(r'<script src="\./(js/[^"]+)"></script>', body)
body = re.sub(r'\s*<script src="\./js/[^"]+"></script>', '', body).strip()
page = '\n'.join([f'<title>{title}</title>', '<link rel="stylesheet" href="css/app.css">', body, *[f'<script src="{s}"></script>' for s in scripts]]) + '\n'
os.makedirs(OUT, exist_ok=True)
open(os.path.join(OUT, 'page.html'), 'w', encoding='utf-8').write(page)
files = {'css/app.css': os.path.join(ROOT, 'css/app.css'), 'icon.svg': os.path.join(ROOT, 'icon.svg')}
for s in scripts:
    files[s] = os.path.join(ROOT, s)
# 3D 보기가 처음 열 때 불러오는 three.js (move/vendor/)
for v in ('vendor/three-r147.min.js', 'vendor/three-r147-orbit.js'):
    files[v] = os.path.join(ROOT, v)
for k, v in files.items():
    assert os.path.exists(v), v
json.dump(files, open(os.path.join(OUT, 'files.json'), 'w'), ensure_ascii=False, indent=1)
print('page', os.path.join(OUT, 'page.html'), 'files', len(files), 'bytes', sum(os.path.getsize(v) for v in files.values()))
