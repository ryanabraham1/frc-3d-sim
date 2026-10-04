#!/usr/bin/env python3
"""Render three orthographic views using Onshape's public read-only shadedviews API."""
import base64, concurrent.futures, json, pathlib, re, urllib.parse, urllib.request
ROOT = pathlib.Path(__file__).resolve().parents[1]
OUT = ROOT / 'refs/cad-audit'

def get(url):
    return json.loads(urllib.request.urlopen(url, timeout=90).read())

def render(item):
    robot, cad = item
    m = re.search(r'https://([^/]+)/documents/([^/]+)/([wv])/([^/]+)/e/([^?]+)',cad['url'])
    if not m: return
    host,did,wv,wid,eid = m.groups()
    prefix = f"{robot['year']}-{robot['team']}-{did}"
    try:
        elements=get(f'https://{host}/api/documents/d/{did}/{wv}/{wid}/elements')
        (OUT/f'{prefix}-elements.json').write_text(json.dumps(elements,indent=2))
        element=next(e for e in elements if e['id']==eid)
        kind={'ASSEMBLY':'assemblies','PARTSTUDIO':'partstudios'}.get(element['elementType'])
        if not kind: return
        base=f'https://{host}/api/{kind}/d/{did}/{wv}/{wid}/e/{eid}/shadedviews'
        for view in ['front','right','top']:
            dest=OUT/f'{prefix}-{view}.png'
            if dest.exists(): continue
            query=urllib.parse.urlencode(dict(viewMatrix=view,outputWidth=850,outputHeight=700,pixelSize=0.002,includeWires='false',useAntiAliasing='true'))
            data=get(base+'?'+query)
            dest.write_bytes(base64.b64decode(data['images'][0]))
        print(prefix,'rendered',flush=True)
    except Exception as e: print(prefix,str(e),flush=True)

inventory=json.loads((OUT/'inventory.json').read_text())
jobs=[(r,c) for r in inventory for c in r['cad'] if c.get('preview')]
with concurrent.futures.ThreadPoolExecutor(max_workers=5) as pool:
    list(pool.map(render,jobs))
