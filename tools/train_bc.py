#!/usr/bin/env python3
"""Behaviour cloning: fit a small MLP policy to the human demonstrations from tools/demos_to_dataset.py.

    python3 tools/train_bc.py data/bc.npz -o data/policy.json --epochs 60

Numpy only (no torch needed), so it runs anywhere. The exported JSON is {layers: [{w, b}], act: 'tanh', head: {...}}
for a TypeScript inference module later; it is also the starting point for RL fine-tuning (swap in torch then).
Outputs: drive axes (vx, vy, omega) and scoring level are regressed (MSE); the buttons intake, shoot, pass,
climb-requested, descend, block, aim are independent sigmoids (BCE). Column indices follow the dataset's action order.
"""
import argparse, json
import numpy as np

CONT = [0, 1, 2, 8]            # vx, vy, omega, scoring level
BIN = [3, 4, 5, 6, 7, 9, 10]   # intake, shoot, pass, climb (>=0), descend, block, aim
LEVEL_SCALE = 4.0


def targets(y):
    cont = y[:, CONT].copy()
    cont[:, 3] /= LEVEL_SCALE
    b = y[:, BIN].copy()
    b[:, 3] = (b[:, 3] >= 0).astype(np.float32)
    return cont, b


def init(sizes, rng):
    return [(rng.normal(0, np.sqrt(1 / a), (a, b)).astype(np.float32), np.zeros(b, np.float32)) for a, b in zip(sizes, sizes[1:])]


def forward(layers, x):
    acts = [x]
    for i, (w, b) in enumerate(layers):
        x = x @ w + b
        if i < len(layers) - 1:
            x = np.tanh(x)
        acts.append(x)
    return acts


def split_out(o):
    return o[:, :len(CONT)], o[:, len(CONT):]


def loss_and_grad(layers, x, yc, yb):
    acts = forward(layers, x)
    pc, lb = split_out(acts[-1])
    pb = 1 / (1 + np.exp(-lb))
    n = len(x)
    loss = ((pc - yc) ** 2).mean() + (-(yb * np.log(pb + 1e-7) + (1 - yb) * np.log(1 - pb + 1e-7))).mean()
    g = np.concatenate([2 * (pc - yc) / (n * yc.shape[1]), (pb - yb) / (n * yb.shape[1])], axis=1)
    grads = []
    for i in reversed(range(len(layers))):
        gw = acts[i].T @ g
        gb = g.sum(0)
        grads.append((gw, gb))
        if i:
            g = (g @ layers[i][0].T) * (1 - acts[i] ** 2)
    return loss, grads[::-1]


def evaluate(layers, x, y):
    yc, yb = targets(y)
    pc, lb = split_out(forward(layers, x)[-1])
    pb = 1 / (1 + np.exp(-lb))
    return float(((pc - yc) ** 2).mean()), float(((pb > 0.5) == (yb > 0.5)).mean())


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('data')
    ap.add_argument('-o', '--out', default='data/policy.json')
    ap.add_argument('--epochs', type=int, default=60)
    ap.add_argument('--hidden', type=int, nargs='+', default=[128, 128])
    ap.add_argument('--lr', type=float, default=2e-3)
    ap.add_argument('--batch', type=int, default=256)
    ap.add_argument('--seed', type=int, default=0)
    a = ap.parse_args()
    d = np.load(a.data)
    x, y = d['train_x'], d['train_y']
    yc, yb = targets(y)
    rng = np.random.default_rng(a.seed)
    layers = init([x.shape[1], *a.hidden, len(CONT) + len(BIN)], rng)
    m = [(np.zeros_like(w), np.zeros_like(b)) for w, b in layers]
    v = [(np.zeros_like(w), np.zeros_like(b)) for w, b in layers]
    step = 0
    for ep in range(a.epochs):
        order = rng.permutation(len(x))
        total = 0.0
        for s in range(0, len(x), a.batch):
            idx = order[s:s + a.batch]
            loss, grads = loss_and_grad(layers, x[idx], yc[idx], yb[idx])
            total += loss * len(idx)
            step += 1
            for i, (gw, gb) in enumerate(grads):  # Adam
                for j, g in enumerate((gw, gb)):
                    m[i][j][...] = 0.9 * m[i][j] + 0.1 * g
                    v[i][j][...] = 0.999 * v[i][j] + 0.001 * g * g
                    mh, vh = m[i][j] / (1 - 0.9 ** step), v[i][j] / (1 - 0.999 ** step)
                    layers[i][j][...] -= a.lr * mh / (np.sqrt(vh) + 1e-8)
        if ep % 10 == 0 or ep == a.epochs - 1:
            msg = f'epoch {ep:3d} train loss {total / len(x):.4f}'
            if 'val_x' in d:
                mse, acc = evaluate(layers, d['val_x'], d['val_y'])
                msg += f' | val drive/level MSE {mse:.4f} button acc {acc:.3f}'
            print(msg)
    json.dump({'inputs': int(x.shape[1]), 'cont': CONT, 'bin': BIN, 'levelScale': LEVEL_SCALE, 'act': 'tanh',
               'layers': [{'w': w.tolist(), 'b': b.tolist()} for w, b in layers]}, open(a.out, 'w'))
    print('saved', a.out)


if __name__ == '__main__':
    main()
