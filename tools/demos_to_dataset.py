#!/usr/bin/env python3
"""Match logs (JSONL from src/engine/telemetry) -> behaviour-cloning dataset (.npz).

    python3 tools/demos_to_dataset.py data/demos/*.jsonl -o data/bc.npz

Only rows whose `src` is human (0) become samples: bots and autopilot rows are context, not demonstrations.
Observation (all in the robot's own frame, so one policy works from either alliance and any heading):
  ego:   vx, vy (robot frame, / maxSpeed), omega (/ maxOmega), sin/cos yaw, x/y to the nearest walls (/ field size),
         held / capacity, climb phase one-hot(5), climb level, tipped
  other: 3 nearest teammates + 3 nearest opponents -> (dx, dy, vx, vy) in robot frame (/ 10 m, / maxSpeed), 0 if absent
  pieces: 6 nearest loose pieces -> (dx, dy) robot frame (/ 10 m), from the latest 2 Hz keyframe, 0 if absent
  archetype: the robot's own mechanism features (shooter none/fixed/pivot/turret one-hot, auto-align, ground/station
         intake, intake rate, capacity, placement level, climb level, blocker, shots/s, speed) so ONE policy can be
         conditioned on what it is driving; the label (preset / team robot id) is saved as `*_arch` for stratified eval
  match: time fraction, mode one-hot (auto, teleop, other), score diff (own - opp) / 100 from score events
Action (what the driver commanded, robot frame): vx, vy (/ maxSpeed), omega (/ maxOmega), intake, shoot, pass,
  climb request (-1 none else level), descend, scoring level, block, aim.
Hold-out: whole files, never frames of the same match (`--val-frac`).
"""
import argparse, glob, json, math
import numpy as np

K_TEAM, K_OPP, K_PIECE = 3, 3, 6
SHOOTERS = ['none', 'fixed', 'pivot', 'turret']


def arch_vector(a):
    f = a['features']
    onehot = [1.0 if f['shooter'] == s else 0.0 for s in SHOOTERS]
    return onehot + [
        float(f['autoAlign']), min(f['exits'], 6) / 6, f['shotsPerSecond'] / 20, float(f['groundIntake']), float(f['stationIntake']),
        1.0 if f['intakeSide'] == 'back' else 0.0, f['intakeRate'] / 20, f['capacity'] / 100, f['placementMaxLevel'] / 4,
        f['climbMaxLevel'] / 3, float(f['shotBlocker']), 1.0 if f['drive'] == 'swerve' else 0.0, f['maxSpeed'] / 6,
    ]

MODES = {'auto': 0, 'teleop': 1}


def load(path):
    with open(path) as f:
        return [json.loads(l) for l in f if l.strip()]


def samples(lines):
    head = lines[0]
    RF, CF = head['robotFields'], head['commandFields']
    ri = {n: i for i, n in enumerate(RF)}
    ci = {n: i for i, n in enumerate(CF)}
    info = {r['id']: r for r in head['robots']}
    L, W = head['fieldLength'], head['fieldWidth']
    end = next((l for l in lines if l['type'] == 'end'), {'t': 1.0})
    match_len = max(end.get('t', 1.0), 1e-6)
    pieces = np.zeros((0, 2))
    mode, score = 'other', {'red': 0, 'blue': 0}
    X, Y, A = [], [], []
    arch = {r['id']: r.get('archetype') for r in head['robots']}
    avec = {i: arch_vector(a) for i, a in arch.items() if a}
    for l in lines[1:]:
        k = l['type']
        if k == 'period':
            mode = l['mode']
        elif k == 'score':
            score[l['alliance']] += l['points']
        elif k == 'pieces':
            pieces = np.array(l['p'], dtype=float).reshape(-1, 3)[:, :2]
        elif k == 'frame':
            rows = {r['r'][0]: r for r in l['rows']}
            for rid, row in rows.items():
                r, c = row['r'], row.get('c')
                if c is None or r[ri['src']] != 0:
                    continue
                me = info[rid]
                x, y, yaw = r[ri['x']], r[ri['y']], r[ri['yaw']]
                cs, sn = math.cos(yaw), math.sin(yaw)

                def rot(dx, dy):  # field -> robot frame
                    return cs * dx + sn * dy, -sn * dx + cs * dy

                ms, mo = max(me['maxSpeed'], 1e-6), max(me['maxOmega'], 1e-6)
                evx, evy = rot(r[ri['vx']], r[ri['vy']])
                phase = [0.0] * 5
                phase[int(r[ri['climbPhase']])] = 1.0
                ego = [evx / ms, evy / ms, r[ri['omega']] / mo, sn, cs, x / L, (L - x) / L, y / W, (W - y) / W,
                       r[ri['held']] / max(me['capacity'], 1), *phase, r[ri['climbLevel']], r[ri['tipped']]]
                others = []
                for ally in (True, False):
                    cand = []
                    for oid, orow in rows.items():
                        if oid == rid or (info[oid]['alliance'] == me['alliance']) != ally:
                            continue
                        o = orow['r']
                        dx, dy = rot(o[ri['x']] - x, o[ri['y']] - y)
                        ovx, ovy = rot(o[ri['vx']], o[ri['vy']])
                        cand.append((dx * dx + dy * dy, [dx / 10, dy / 10, ovx / ms, ovy / ms]))
                    cand.sort(key=lambda t: t[0])
                    n = K_TEAM if ally else K_OPP
                    for _, f in cand[:n]:
                        others += f
                    others += [0.0] * 4 * (n - min(n, len(cand)))
                near = []
                if len(pieces):
                    d = pieces - np.array([x, y])
                    for i in np.argsort((d ** 2).sum(1))[:K_PIECE]:
                        near += [v / 10 for v in rot(*d[i])]
                near += [0.0] * 2 * (K_PIECE - len(near) // 2)
                opp = 'red' if me['alliance'] == 'blue' else 'blue'
                m = [l['t'] / match_len, mode == 'auto', mode == 'teleop', (score[me['alliance']] - score[opp]) / 100]
                cvx, cvy = rot(c[ci['vx']], c[ci['vy']])
                act = [cvx / ms, cvy / ms, c[ci['omega']] / mo, c[ci['intake']], c[ci['shoot']], c[ci['pass']],
                       c[ci['climb']], c[ci['descend']], c[ci['level']], c[ci['block']], c[ci['aim']]]
                X.append(ego + avec.get(rid, [0.0] * 17) + others + near + m)
                A.append(arch[rid]['label'] if arch.get(rid) else 'unknown')
                Y.append(act)
    return np.array(X, dtype=np.float32), np.array(Y, dtype=np.float32), A


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('files', nargs='+')
    ap.add_argument('-o', '--out', default='data/bc.npz')
    ap.add_argument('--val-frac', type=float, default=0.15)
    a = ap.parse_args()
    paths = sorted(p for g in a.files for p in glob.glob(g))
    nval = int(len(paths) * a.val_frac)
    parts = {'train': [], 'val': []}
    for i, p in enumerate(paths):
        X, Y, A = samples(load(p))
        if len(X):
            parts['val' if i >= len(paths) - nval else 'train'].append((X, Y, A))
        print(f'{p}: {len(X)} samples')
    out = {}
    for split, ps in parts.items():
        if ps:
            out[f'{split}_x'] = np.concatenate([p[0] for p in ps])
            out[f'{split}_y'] = np.concatenate([p[1] for p in ps])
            out[f'{split}_arch'] = np.array([a for p in ps for a in p[2]])
    np.savez_compressed(a.out, **out)
    print({k: v.shape for k, v in out.items()}, '->', a.out)


if __name__ == '__main__':
    main()
