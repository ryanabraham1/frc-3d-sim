#!/usr/bin/env python3
"""How do players beat the bots? Summarise match logs (docs/MATCH-LOGS.md) by season and bot difficulty.

    python3 tools/analyze_match_logs.py data/demos/*.jsonl            # local files (.jsonl or .jsonl.gz)
    SUPABASE_URL=... SUPABASE_SERVICE_KEY=... python3 tools/analyze_match_logs.py --supabase [--limit 200]

Per match with at least one human driver: the human alliance's margin against the bots, fouls the bots gave away,
how much the humans defended bots (a human within 1.5 m of an opposing bot) and how long bots sat slowed down next
to a human (blocked / pinned), plus each human robot's share of its alliance's points. Grouped by season and the
difficulty of the bots the humans played against (header `extra.aiSkill`, logged since this tool was added; older
logs show as `?`).
"""
import argparse, gzip, json, math, os, statistics, sys, urllib.request
from collections import defaultdict

SRC_HUMAN, SRC_BOT = 0, 2


def read_lines(path=None, data=None):
    if data is None:
        with open(path, 'rb') as f:
            data = f.read()
    if data[:2] == b'\x1f\x8b':
        data = gzip.decompress(data)
    return [json.loads(l) for l in data.decode('utf-8').splitlines() if l.strip()]


def analyze(lines):
    header = lines[0]
    if header.get('type') != 'header':
        return None
    fields = header['robotFields']
    ix = {k: i for i, k in enumerate(fields)}
    robots = {r['id']: r for r in header['robots']}
    src = defaultdict(set)
    near_def = defaultdict(float)      # human id -> s within 1.5 m of an opposing bot
    bot_blocked = defaultdict(float)   # bot id -> s slow (< 0.3 m/s) within 1.3 m of an opposing human
    teleop_s = 0.0
    dt = 1.0 / header.get('hz', 30)
    mode = 'auto'
    fouls, totals, end = [], None, None
    for l in lines[1:]:
        t = l.get('type')
        if t == 'period':
            mode = l.get('mode', mode)
        elif t == 'foul':
            fouls.append(l)
        elif t == 'end':
            end = l
            totals = l.get('totals')
        elif t == 'frame' and mode == 'teleop':
            teleop_s += dt
            rows = [r['r'] for r in l['rows']]
            for row in rows:
                src[row[ix['id']]].add(row[ix['src']])
            humans = [r for r in rows if r[ix['src']] == SRC_HUMAN]
            bots = [r for r in rows if r[ix['src']] == SRC_BOT]
            for h in humans:
                ha = robots[h[ix['id']]]['alliance']
                for b in bots:
                    if robots[b[ix['id']]]['alliance'] == ha:
                        continue
                    d = math.hypot(h[ix['x']] - b[ix['x']], h[ix['y']] - b[ix['y']])
                    if d < 1.5:
                        near_def[h[ix['id']]] += dt
                    if d < 1.3 and math.hypot(b[ix['vx']], b[ix['vy']]) < 0.3:
                        bot_blocked[b[ix['id']]] += dt
    humans = [i for i, s in src.items() if SRC_HUMAN in s]
    if not humans or not totals:
        return None
    alliances = {robots[i]['alliance'] for i in humans}
    if len(alliances) != 1:
        return None  # humans on both sides: not a player-vs-bot match
    ha = alliances.pop()
    ba = 'red' if ha == 'blue' else 'blue'
    skill = (header.get('extra') or {}).get('aiSkill', {}).get(ba, '?')
    bot_ids = [i for i, s in src.items() if s == {SRC_BOT} and robots[i]['alliance'] == ba]
    gifted = sum(15 if f['kind'] == 'major' else 5 for f in fouls if f['alliance'] == ba)
    taken = sum(15 if f['kind'] == 'major' else 5 for f in fouls if f['alliance'] == ha)
    return {
        'season': header['seasonId'], 'skill': skill, 'margin': totals[ha] - totals[ba], 'human': totals[ha], 'bots': totals[ba],
        'botFoulPts': gifted, 'humanFoulPts': taken, 'botFoulRules': [f['rule'] for f in fouls if f['alliance'] == ba],
        'defendShare': sum(near_def[i] for i in humans) / max(1, teleop_s * len(humans)),
        'botsBlockedS': sum(bot_blocked[i] for i in bot_ids), 'humans': len(humans), 'complete': bool(end and end.get('frames')),
    }


def fetch_supabase(limit):
    url, key = os.environ['SUPABASE_URL'].rstrip('/'), os.environ['SUPABASE_SERVICE_KEY']
    auth = {'apikey': key, 'authorization': f'Bearer {key}'}
    req = urllib.request.Request(f'{url}/rest/v1/match_logs?select=path&human_robots=gt.0&order=created_at.desc&limit={limit}', headers=auth)
    rows = json.load(urllib.request.urlopen(req))
    for row in rows:
        req = urllib.request.Request(f"{url}/storage/v1/object/match-logs/{row['path']}", headers=auth)
        yield row['path'], urllib.request.urlopen(req).read()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('files', nargs='*')
    ap.add_argument('--supabase', action='store_true', help='read logs from the match-logs bucket (needs SUPABASE_URL and SUPABASE_SERVICE_KEY)')
    ap.add_argument('--limit', type=int, default=200)
    ap.add_argument('--json', action='store_true', help='print one JSON line per match instead of the summary')
    a = ap.parse_args()
    sources = fetch_supabase(a.limit) if a.supabase else ((p, None) for p in a.files)
    results = []
    for name, data in sources:
        try:
            r = analyze(read_lines(name if data is None else None, data))
        except (ValueError, KeyError, OSError) as e:
            print(f'skip {name}: {e}', file=sys.stderr)
            continue
        if r:
            results.append(r)
            if a.json:
                print(json.dumps({'file': name, **r}))
    if a.json:
        return
    groups = defaultdict(list)
    for r in results:
        groups[(r['season'], r['skill'])].append(r)
    if not groups:
        print('No player-vs-bot matches found.')
    for (season, skill), rs in sorted(groups.items()):
        wins = sum(r['margin'] > 0 for r in rs)
        rules = defaultdict(int)
        for r in rs:
            for x in r['botFoulRules']:
                rules[x] += 1
        mean = lambda k: statistics.mean(r[k] for r in rs)
        print(f'{season} vs {skill} bots: {len(rs)} matches, players won {wins} ({100 * wins / len(rs):.0f}%)')
        print(f'  margin {mean("margin"):+.0f} (median {statistics.median(r["margin"] for r in rs):+.0f}), players {mean("human"):.0f} vs bots {mean("bots"):.0f}')
        print(f'  foul points the bots gave away {mean("botFoulPts"):.0f}/match ({dict(rules)}); players gave away {mean("humanFoulPts"):.0f}')
        print(f'  players spent {100 * mean("defendShare"):.0f}% of TELEOP within 1.5 m of a bot; bots sat blocked by a player {mean("botsBlockedS"):.0f} s/match')


if __name__ == '__main__':
    main()
