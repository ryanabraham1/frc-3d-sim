#!/usr/bin/env python3
"""Summarize REBUILT JSONL.gz logs in a zip, separating human shots from feeds.

Usage: python3 tools/analyze_rebuilt_archive.py /path/to/2026-rebuilt.zip -o /tmp/analysis.json
Scores remain alliance totals: old score events have no robot or piece id.
Launch labels use the last command within two sampled frames; transitions remain uncertain.
"""
import argparse
import collections
import gzip
import json
import math
import statistics
import zipfile


def analyze(lines, name):
    header = lines[0]
    if not header.get('robotFields'):
        return None
    ix = {field: i for i, field in enumerate(header['robotFields'])}
    ci = {field: i for i, field in enumerate(header['commandFields'])}
    robots = {r['id']: dict(meta=r, sources=collections.Counter(), launches=collections.Counter(),
                            seconds=0, emptySeconds=0, slowSeconds=0, pickupIncreases=0,
                            distance=0, endHeld=0, lastHeld=None, command=None, commandTime=0)
              for r in header['robots']}
    points = collections.defaultdict(collections.Counter)
    fouls = []
    end = {}
    previous_t = None
    for event in lines[1:]:
        kind = event['type']
        if kind == 'end':
            end = event
        elif kind == 'score':
            points[event['alliance']][event['category']] += event['points']
        elif kind == 'foul':
            fouls.append(event)
        elif kind == 'launch' and event['id'] in robots:
            robot = robots[event['id']]
            command = robot['command']
            label = 'unclassified'
            if command is not None and 0 <= event['t'] - robot['commandTime'] <= 2 / header['hz']:
                label = 'shot' if command[ci['shoot']] else 'feed' if command[ci['pass']] else 'transition'
            robot['launches'][label] += 1
            robot['launches']['auto' if event['t'] < 20 else 'afterAuto'] += 1
        elif kind == 'frame':
            t = event['t']
            dt = min(0.1, max(0, t - previous_t)) if previous_t is not None else 0
            previous_t = t
            for row in event['rows']:
                values = row['r']
                robot = robots[values[ix['id']]]
                robot['sources'][values[ix['src']]] += 1
                if 'c' in row:
                    robot['command'] = row['c']
                    robot['commandTime'] = t
                held = values[ix['held']]
                robot['endHeld'] = held
                if t >= 23 and t < 163:
                    v = math.hypot(values[ix['vx']], values[ix['vy']])
                    robot['seconds'] += dt
                    robot['distance'] += dt * v
                    robot['emptySeconds'] += dt * (held == 0)
                    robot['slowSeconds'] += dt * (v < 0.3)
                    if robot['lastHeld'] is not None:
                        robot['pickupIncreases'] += max(0, held - robot['lastHeld'])
                robot['lastHeld'] = held
    for robot in robots.values():
        for key in ('lastHeld', 'command', 'commandTime'):
            del robot[key]
        robot['control'] = 'human' if 0 in robot['sources'] else 'bot' if 2 in robot['sources'] else 'autopilot'
    return dict(file=name, createdAt=header.get('createdAt'), mode=header.get('mode'),
                skills=header.get('extra', {}).get('aiSkill'), duration=end.get('t', 0),
                longRun=end.get('t', 0) >= 155, robots=list(robots.values()), points=dict(points), fouls=fouls)


def summarize(matches):
    long = [m for m in matches if m['longRun']]
    local = [m for m in long if m['mode'] == 'local']
    versus = [m for m in local if len(m['robots']) > 1 and m['robots'][0]['control'] == 'human']
    rates = {}
    for control in ('human', 'bot'):
        rows = [r for m in versus for r in m['robots'] if r['control'] == control]
        rates[control] = {k: statistics.mean(r[k] for r in rows) if rows else 0
                          for k in ('seconds', 'emptySeconds', 'slowSeconds', 'pickupIncreases', 'distance')}
        rates[control]['samples'] = len(rows)
    solo = [m for m in local if len(m['robots']) == 1 and m['robots'][0]['control'] == 'human']
    solo.sort(key=lambda m: m['createdAt'] or '')
    return dict(logs=len(matches), longRuns=len(long), localVersusBots=len(versus), localSolo=len(solo),
                sameMatchMetrics=rates, recentSolo=solo[-6:],
                limitations=['A long run is >=155 seconds, not proof of a normally finished match.',
                             'Human shots/feeds are classified from sampled commands; transitions remain uncertain.',
                             'Bot commands were not logged, so bot launches cannot be split into shots and feeds.',
                             'Score events identify the alliance, not the robot. Solo totals are attributable to the only robot.',
                             'Pickup increases miss simultaneous collection and launch, and include transfers; they are a lower bound on flow.',
                             'Different builds, manual AUTO, old code versions, and possible practice boosts prevent a controlled skill rating.'])


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('archive')
    parser.add_argument('-o', '--output')
    args = parser.parse_args()
    matches = []
    with zipfile.ZipFile(args.archive) as archive:
        for name in archive.namelist():
            if not name.endswith('.jsonl.gz'):
                continue
            lines = [json.loads(line) for line in gzip.decompress(archive.read(name)).splitlines() if line.strip()]
            match = analyze(lines, name)
            if match is not None:
                matches.append(match)
    result = dict(summary=summarize(matches), matches=matches)
    if args.output:
        with open(args.output, 'w') as output:
            json.dump(result, output, indent=2)
    summary = result['summary']
    print(json.dumps({k: v for k, v in summary.items() if k != 'recentSolo'}, indent=2))
    for match in summary['recentSolo']:
        robot = match['robots'][0]
        print(match['createdAt'], robot['meta'].get('team'), dict(robot['launches']), dict(match['points']))


if __name__ == '__main__':
    main()
