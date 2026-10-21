"""LOCAL ONLY. The equivalence of meldy_private.learn_left_facts with the site's line rule: every case of
contracts/learn_left/vectors.json (made by frontend/src/lib/exams/learnFacts.vectors.test.ts from cheatSheet.ts) is fed
to the SQL function on the scratch database and its facts must equal the stored ones, field by field.

Usage: python3 -I learn_left_vectors.py <vectors.json> <database>   (PGHOST, PGPORT, PGUSER from the environment)
Exit 0 when every case agrees; prints each difference otherwise.
"""
from __future__ import annotations

import json
import subprocess
import sys

QUERY = """
select coalesce(json_agg(json_build_object(
         'id', f.question_id, 'kind', f.kind, 'state', f.state, 'named', f.named, 'of', f.deciding,
         'learned_at', floor(extract(epoch from date_trunc('milliseconds', f.learned_at)))::bigint,
         'ready_at', ceil(extract(epoch from date_trunc('milliseconds', f.ready_at)))::bigint,
         'missed', f.missed) order by f.ord), '[]')
  from meldy_private.learn_left_facts($sheet${sheet}$sheet$::jsonb, $events${events}$events$::jsonb,
                                      $now${now}$now$::timestamptz, $tz${tz}$tz$) f;
"""


def run(database: str, sql: str) -> str:
    out = subprocess.run(['psql', '-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1', '-d', database],
                         input=sql, capture_output=True, text=True, check=False)
    if out.returncode != 0:
        raise SystemExit(f'psql failed: {out.stderr.strip()[:400]}')
    return out.stdout.strip()


def main() -> int:
    path, database = sys.argv[1], sys.argv[2]
    data = json.load(open(path, encoding='utf-8'))
    cases = data.get('cases', [])
    if not cases:
        print('no cases in the vectors')
        return 1
    bad = 0
    rows = 0
    for case in cases:
        sql = QUERY.format(sheet=json.dumps(case['sheet'], ensure_ascii=False), events=json.dumps(case['events'], ensure_ascii=False),
                           now=case['now'], tz=case['tz'])
        got = json.loads(run(database, sql))
        want = case['expect']
        rows += len(want)
        if got != want:
            bad += 1
            print(f'  case {case["name"]}: differs')
            for g, w in zip(got, want):
                if g != w:
                    print(f'    sql  {g}\n    site {w}')
            if len(got) != len(want):
                print(f'    {len(got)} rows from SQL, {len(want)} stored')
    print(f'{len(cases)} cases, {rows} questions, {bad} cases differ')
    return 1 if bad else 0


if __name__ == '__main__':
    sys.exit(main())
