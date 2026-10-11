import warnings
warnings.filterwarnings('ignore')
#!/usr/bin/env python3
"""
Extract the 2026 REBUILT HUB from the official field CAD (FE-2026 REBUILT Playing Field.glb, Onshape export: metres,
Z up, origin at field centre, blue alliance at -x) into what the sim needs:

  src/seasons/2026-rebuilt/hubCad.generated.ts  - per part: hub-local triangles (collision) for the parts FUEL and robots
                                                   touch, plus the fitted plane of the aesthetic net.

Hub-local frame: FIELD axes (x toward the NEUTRAL ZONE for the blue hub, y left, z up) with the origin on the floor at
the hub centre. The red hub is the same structure turned 180 degrees about z.

  python3 tools/prepare-field-cad.py "/path/FE-2026- REBUILT Playing Field.glb"
"""
import json, re, struct, sys
import numpy as np

SRC = sys.argv[1]
OUT_TS = 'src/seasons/2026-rebuilt/hubCad.generated.ts'
HUB_X = -3.645  # blue hub centre in the CAD (field length 16.541 m: 4.6256 m from the blue wall)

# Parts FUEL or robots touch. Each name maps to the collision role the sim gives it.
COLLIDE = {
    'GE-26305: Hub Side Panel': 'shell',
    'GE-26308: Hub Front Panel, Top': 'shell',
    'GE-26328: Hub Front Panel, Bottom': 'shell',
    'GE-26306: Hub Rear Panel, Bottom': 'shell',
    'GE-26309: Hub Front Diffuser': 'shell',
    'GE-26310: Hub Rear Diffuser': 'shell',
    'GE-26311: Hub Side Diffuser': 'shell',
    'GE-26304: Hub Roof Panel': 'pieces',
    'GE-26303-01: Hub Roof Riser, Right': 'pieces',
    'GE-26313-01: Hub Roof Riser, Left': 'pieces',
    'GE-26329: Hub Funnel Side': 'pieces',
    'GE-26315-01: Hub Funnel Base': 'pieces',
    'GE-26331: Hub Internal Wall': 'pieces',
    'GE-26333: Hub Ramp, Large': 'pieces',
    'GE-26332: Hub Ramp, Small': 'pieces',
    'GE-26316-01: Hub Ramp Angle': 'pieces',
    'GE-26312-01: Hub Crossbar': 'pieces',
    # The FUEL counter between the large ramp and the exit slot (GE-264xx): its sloped bottom plate, top plate, side
    # plates, lane dividers, the deflectors that spread balls over the exits, the inlet funnel and the gearbox cover.
    # Its driven 2in wheels are not colliders: the sim drives balls under them and into the four lanes (rules: HUB counter).
    'GE-26401: Counter Side Plate': 'pieces',
    'GE-26402-01: Top Plate': 'pieces',
    'GE-26403-01: Bottom Plate': 'pieces',
    'GE-26404: Counter Middle Divider': 'pieces',
    'GE-26405-01: Ball Deflector': 'pieces',
    'GE-26407-01: Inlet Funnel': 'pieces',
    'GE-26417-01: Gearbox Cover': 'pieces',
}
NET = 'GE-26318: Hub Net (Aesthetic)'

data = open(SRC, 'rb').read()
jlen = struct.unpack('<I', data[12:16])[0]
doc = json.loads(data[20:20 + jlen])
bin_off = 20 + jlen + 8
nodes = doc['nodes']

def accessor(i):
    a = doc['accessors'][i]
    v = doc['bufferViews'][a['bufferView']]
    comp = {5121: np.uint8, 5123: np.uint16, 5125: np.uint32, 5126: np.float32}[a['componentType']]
    n = {'SCALAR': 1, 'VEC3': 3}[a['type']]
    start = bin_off + v.get('byteOffset', 0) + a.get('byteOffset', 0)
    stride = v.get('byteStride')
    if stride and stride != np.dtype(comp).itemsize * n:
        raw = np.frombuffer(data, dtype=np.uint8, count=stride * a['count'], offset=start).reshape(a['count'], stride)
        return raw[:, :np.dtype(comp).itemsize * n].copy().view(comp).reshape(a['count'], n)
    return np.frombuffer(data, dtype=comp, count=a['count'] * n, offset=start).reshape(a['count'], n)

def local_matrix(nd):
    if 'matrix' in nd:
        return np.array(nd['matrix'], dtype=float).reshape(4, 4).T
    m = np.eye(4)
    if 'scale' in nd: m = np.diag([*nd['scale'], 1.0]) @ m
    if 'rotation' in nd:
        x, y, z, w = nd['rotation']
        r = np.eye(4)
        r[:3, :3] = [[1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
                     [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
                     [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)]]
        m = r @ m
    if 'translation' in nd:
        t = np.eye(4); t[:3, 3] = nd['translation']; m = t @ m
    return m

parent = {}
for i, nd in enumerate(nodes):
    for c in nd.get('children', []): parent[c] = i
world = {}
def W(i):
    if i not in world:
        p = parent.get(i)
        world[i] = (W(p) @ local_matrix(nodes[i])) if p is not None else local_matrix(nodes[i])
    return world[i]

def part_name(i):
    k, name = i, nodes[i].get('name', '')
    while (not name or name.startswith('occurrence')) and k in parent:
        k = parent[k]; name = nodes[k].get('name', '')
    return name

def triangles(i):
    """World-space triangles of node i, as (n, 3, 3)."""
    out = []
    for p in doc['meshes'][nodes[i]['mesh']]['primitives']:
        pos = accessor(p['attributes']['POSITION']).astype(float)
        idx = accessor(p['indices']).reshape(-1) if 'indices' in p else np.arange(len(pos))
        hom = np.c_[pos, np.ones(len(pos))] @ W(i).T
        out.append(hom[:, :3][idx.reshape(-1, 3)])
    return np.concatenate(out) if out else np.zeros((0, 3, 3))

parts = {}
net = []
for i, nd in enumerate(nodes):
    if 'mesh' not in nd: continue
    name = part_name(i)
    if name not in COLLIDE and name != NET: continue
    tri = triangles(i)
    c = tri.reshape(-1, 3).mean(0)
    if not (-4.6 < c[0] < -2.6 and abs(c[1]) < 1.0): continue  # blue hub only
    tri = tri - np.array([HUB_X, 0, 0])
    if name == NET: net.append(tri); continue
    parts.setdefault(name, []).append(tri)

def weld(tri, tol=0.01):
    """Vertex clustering on a `tol` grid: plates collapse to one surface (all collision needs), rivet holes and chamfers
    vanish. Returns shared vertices and indices, dropping degenerate and duplicate triangles."""
    flat = tri.reshape(-1, 3)
    keys = np.round(flat / tol).astype(np.int64)
    _, first, inv = np.unique(keys, axis=0, return_index=True, return_inverse=True)
    verts = flat[first]
    idx = inv.reshape(-1, 3)
    keep = (idx[:, 0] != idx[:, 1]) & (idx[:, 1] != idx[:, 2]) & (idx[:, 0] != idx[:, 2])
    idx = idx[keep]
    _, uniq = np.unique(np.sort(idx, axis=1), axis=0, return_index=True)
    idx = idx[np.sort(uniq)]
    used, remap = np.unique(idx, return_inverse=True)
    return verts[used], remap.reshape(-1, 3)

lines = ['/* Generated by tools/prepare-field-cad.py from the official FE-2026 REBUILT field CAD. Do not edit. */',
         '/* Hub-local FIELD frame (m): x toward the NEUTRAL ZONE (blue hub), y left, z up; origin on the floor at the hub centre. */',
         'export interface HubCadPart { name: string; role: \'shell\' | \'pieces\'; vertices: number[]; indices: number[] }',
         'export const HUB_CAD_PARTS: HubCadPart[] = [']
total = 0
for name, tris in sorted(parts.items()):
    for tri in tris:
        verts, idx = weld(tri)
        total += len(idx)
        v = ','.join(f'{x:.4f}'.rstrip('0').rstrip('.') if x else '0' for x in verts.reshape(-1))
        ix = ','.join(str(int(x)) for x in idx.reshape(-1))
        lines.append(f"  {{ name: {json.dumps(name)}, role: '{COLLIDE[name]}', vertices: [{v}], indices: [{ix}] }},")
lines.append('];')

# The aesthetic net: fit its plane (PCA) and report the rectangle it spans, for the flexible NetSheet.
pts = np.concatenate(net).reshape(-1, 3)
centre = pts.mean(0)
_, _, vt = np.linalg.svd(pts - centre, full_matrices=False)
normal = vt[2]
# Width along field y; height along the plane's other axis, pointing up.
ey = np.array([0.0, 1.0, 0.0]); ey -= normal * ey.dot(normal); ey /= np.linalg.norm(ey)
eu = np.cross(normal, ey); eu = eu if eu[2] > 0 else -eu
s = (pts - centre) @ ey; t = (pts - centre) @ eu
corner = centre + ey * s.min() + eu * t.min()
lines.append('/** The aesthetic net behind the opening as a rectangle: corner, edge along y, edge up the slope. */')
lines.append(f'export const HUB_CAD_NET = {{ origin: [{corner[0]:.4f}, {corner[1]:.4f}, {corner[2]:.4f}] as [number, number, number], '
             f'u: [{(ey * (s.max() - s.min()))[0]:.4f}, {(ey * (s.max() - s.min()))[1]:.4f}, {(ey * (s.max() - s.min()))[2]:.4f}] as [number, number, number], '
             f'v: [{(eu * (t.max() - t.min()))[0]:.4f}, {(eu * (t.max() - t.min()))[1]:.4f}, {(eu * (t.max() - t.min()))[2]:.4f}] as [number, number, number] }};')
open(OUT_TS, 'w').write('\n'.join(lines) + '\n')
print(f'{len(parts)} part types, {sum(len(v) for v in parts.values())} parts, {total} triangles -> {OUT_TS}')
print('net plane normal', normal.round(3), 'corner', corner.round(3), 'width', round(s.max() - s.min(), 3), 'height', round(t.max() - t.min(), 3))
