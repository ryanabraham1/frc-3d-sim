#!/usr/bin/env python3
"""
Gather reference photos for a real team robot before modeling it (docs/ROBOT-MODELS.md, step 1).

  python3 tools/robot-refs.py tba 118 2024              # The Blue Alliance robot photos for team 118 in 2024
  python3 tools/robot-refs.py search "1690 2025 robot"  # Chief Delphi topic search (reveals, CAD/binder releases)
  python3 tools/robot-refs.py topic 492064              # a Chief Delphi topic: first posts' text, links, photos
  python3 tools/robot-refs.py binder 118-2024.pdf       # render a technical-binder PDF to a page contact sheet

Everything lands in refs/<name>/ (git-ignored) with a contact sheet `sheet.jpg` you can open with the Read tool.
Needs Pillow; `binder` also needs poppler (`pdftoppm`, `pdftotext`). Dead imgur links are skipped.
"""
import html, json, os, re, subprocess, sys, urllib.parse, urllib.request

UA = {'User-Agent': 'Mozilla/5.0 (frc-3d-sim robot-refs)'}
OUT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'refs')


def get(url: str) -> bytes:
    return urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=60).read()


def sheet(folder: str, size: int = 560) -> None:
    from PIL import Image
    files = sorted(f for f in os.listdir(folder) if f.lower().endswith(('.jpg', '.jpeg', '.png')) and f != 'sheet.jpg')
    ims = []
    for f in files:
        try:
            im = Image.open(os.path.join(folder, f)).convert('RGB')
            if im.width < 200 and im.height < 120:
                continue  # imgur's "image no longer available" placeholder
            im.thumbnail((size, size))
            ims.append(im)
        except Exception:
            pass
    if not ims:
        print('no images in', folder)
        return
    cols = 2 if len(ims) > 1 else 1
    rows = (len(ims) + cols - 1) // cols
    s = Image.new('RGB', (size * cols, size * rows), 'white')
    for k, im in enumerate(ims):
        s.paste(im, ((k % cols) * size, (k // cols) * size))
    s.save(os.path.join(folder, 'sheet.jpg'))
    print(f'{len(ims)} images → {folder}/sheet.jpg')


def tba(team: str, year: str) -> None:
    d = os.path.join(OUT, f'{team}-{year}')
    os.makedirs(d, exist_ok=True)
    page = get(f'https://www.thebluealliance.com/team/{team}/{year}').decode('utf8', 'ignore')
    ids = sorted(set(re.findall(r'i\.imgur\.com/([A-Za-z0-9]{7})\.(?:jpe?g|png)', page)))
    for i in ids:
        try:
            open(os.path.join(d, f'{i}.jpg'), 'wb').write(get(f'https://i.imgur.com/{i}.jpeg'))
        except Exception as e:
            print('skip', i, e)
    for k, u in enumerate(sorted(set(re.findall(r'(https://www\.chiefdelphi\.com/uploads/default/(?:original|optimized)/[^"\']+\.(?:jpe?g|png))', page)))[:4]):
        open(os.path.join(d, f'cd{k}.jpg'), 'wb').write(get(u))
    sheet(d)


def search(q: str) -> None:
    d = json.loads(get('https://www.chiefdelphi.com/search.json?q=' + urllib.parse.quote(q)))
    for t in d.get('topics', [])[:12]:
        print(t['id'], t['title'])


def topic(tid: str, posts: int = 6) -> None:
    d = json.loads(get(f'https://www.chiefdelphi.com/t/{tid}.json'))
    folder = os.path.join(OUT, f'cd-{tid}')
    os.makedirs(folder, exist_ok=True)
    print(d['title'])
    imgs = []
    for p in d['post_stream']['posts'][:posts]:
        c = p['cooked']
        print('---', p['username'], ':', html.unescape(re.sub(r'\s+', ' ', re.sub(r'<[^>]+>', ' ', c)))[:2000])
        for u in re.findall(r'href="([^"]+)"', c):
            if '.pdf' in u or 'youtu' in u or 'grabcad' in u or 'onshape' in u or 'short-url' in u:
                print('LINK', u if u.startswith('http') else 'https://www.chiefdelphi.com' + u)
        imgs += [u for u in re.findall(r'<img[^>]+src="([^"]+)"', c) if 'emoji' not in u and 'avatar' not in u]
        for v in re.findall(r'youtube\.com/watch\?v=([\w-]{11})|youtu\.be/([\w-]{11})', c):
            imgs.append(f'https://i.ytimg.com/vi/{v[0] or v[1]}/maxresdefault.jpg')  # video thumbnail
    for i, u in enumerate(imgs[:12]):
        try:
            open(os.path.join(folder, f'{i:02d}.jpg'), 'wb').write(get(u if u.startswith('http') else 'https://www.chiefdelphi.com' + u))
        except Exception as e:
            print('skip', u, e)
    sheet(folder)


def binder(pdf: str) -> None:
    name = os.path.splitext(os.path.basename(pdf))[0]
    folder = os.path.join(OUT, f'binder-{name}')
    os.makedirs(folder, exist_ok=True)
    text = subprocess.run(['pdftotext', '-layout', pdf, '-'], capture_output=True, text=True).stdout
    open(os.path.join(folder, 'text.txt'), 'w').write(text)
    print(f'{len(text.split())} words of text → {folder}/text.txt (empty = scanned/image-only: read the pages)')
    subprocess.run(['pdftoppm', '-r', '30', '-png', pdf, os.path.join(folder, 'p')], check=True)
    sheet(folder, 400)
    print(f'zoom a page: pdftoppm -r 80 -png -f N -l N {pdf} {folder}/hi')


if __name__ == '__main__':
    cmd, *args = sys.argv[1:] or ['help']
    if cmd == 'tba': tba(*args)
    elif cmd == 'search': search(' '.join(args))
    elif cmd == 'topic': topic(*args)
    elif cmd == 'binder': binder(*args)
    else: print(__doc__)
