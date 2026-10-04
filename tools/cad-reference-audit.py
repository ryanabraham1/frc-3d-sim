#!/usr/bin/env python3
"""Match existing season robots to a saved Spectrum sheet read and fetch public CAD previews."""
import concurrent.futures, json, pathlib, re, urllib.request

ROOT = pathlib.Path(__file__).resolve().parents[1]
OUT = ROOT / 'refs' / 'cad-audit'
OUT.mkdir(parents=True, exist_ok=True)
rows = json.loads((ROOT / 'refs/cad-sheet-2024-2026.json').read_text())
robots = []
for source in sorted((ROOT / 'src/seasons').glob('*/*.ts')):
    year = source.parent.name[:4]
    if year not in ('2024', '2025', '2026'): continue
    for model, team, name in re.findall(r"id:\s*'([^']+)',\s*team:\s*(\d+),\s*name:\s*'([^']+)'", source.read_text()):
        robots.append(dict(year=int(year), team=int(team), model=model, name=name, source=str(source.relative_to(ROOT))))

def get(url):
    return urllib.request.urlopen(urllib.request.Request(url, headers={'User-Agent':'frc-3d-sim CAD reference audit'}), timeout=35).read()

def inspect(robot):
    matches = [r for r in rows if r['v'][0] == str(robot['team']) and r['v'][1] == str(robot['year'])]
    robot['entries'] = matches
    robot['cad'] = []
    for row in matches:
        for url in re.findall(r'https?://[^ ,]+', row['v'][4]):
            m = re.search(r'https?://([^/]+)/documents/([a-f0-9]+)', url)
            if not m: continue
            host, did = m.groups()
            result = dict(url=url, row=row['row'], description=row['v'][2])
            try:
                doc = json.loads(get(f'https://{host}/api/documents/{did}'))
                result.update(document=doc['name'], anonymousExport=doc.get('anonymousAllowsExport'))
                (OUT / f"{robot['year']}-{robot['team']}-{did}.json").write_text(json.dumps(doc,indent=2))
                sizes = (doc.get('thumbnail') or {}).get('sizes', [])
                size = next((s for s in sizes if s['size']=='600x340'), sizes[-1] if sizes else None)
                if size:
                    dest = OUT / f"{robot['year']}-{robot['team']}-{did}.png"
                    dest.write_bytes(get(size['href']))
                    result['preview'] = str(dest.relative_to(ROOT))
            except Exception as e: result['error'] = str(e)
            robot['cad'].append(result)
    return robot

with concurrent.futures.ThreadPoolExecutor(max_workers=5) as pool:
    robots = list(pool.map(inspect, robots))
(OUT / 'inventory.json').write_text(json.dumps(robots,indent=2))
for robot in robots:
    print(robot['year'],robot['team'],robot['name'], len(robot['entries']), [(c.get('document'), c.get('preview'),c.get('error')) for c in robot['cad']])
