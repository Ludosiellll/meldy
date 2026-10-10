"""Apply repository migrations to the live project and run read-only contract checks, through the Management API.

Run by .github/workflows/supabase-migrate.yml when deploy/supabase-migrate.md changes. The newest line of that file says
what to do:

    - 2026-10-10 — apply: supabase/migrations/A.sql, supabase/migrations/B.sql; check: supabase/tests/x.sql, …

Each migration file is sent whole as one request (no file manages its own transaction, so it applies entirely or not at
all) unless its version is already in supabase_migrations.schema_migrations; after a successful apply its version, name
and text are recorded there. Each check file runs read-only; a check that returns rows must return one JSON object that
reports `contract_ok: true` (anything else fails), a check that is a DO block passes when it raises nothing. The job
prints file names, HTTP statuses, `contract_ok` and `failed` — never row data, never the token.

Usage: python supabase/migrate.py [--dry-run]   (env: SUPABASE_ACCESS_TOKEN, PROJECT_REF)
"""
from __future__ import annotations

import json
import os
import re
import secrets
import sys
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PLAN_FILE = ROOT / 'deploy' / 'supabase-migrate.md'
API = 'https://api.supabase.com/v1/projects/{ref}/database/query'
LINE = re.compile(r'^\s*-\s+(?P<when>\S+)\s+—\s+apply:\s*(?P<apply>[^;]*);\s*check:\s*(?P<check>.*)$')
MIGRATION = re.compile(r'^supabase/migrations/(?P<version>\d{14})_(?P<name>[a-z0-9_]+)\.sql$')
CHECK = re.compile(r'^supabase/tests/[a-z0-9_]+\.sql$')


def newest_plan(text: str) -> tuple[list[str], list[str]]:
    """The apply and check lists of the newest (last) plan line."""
    plans = [m for m in (LINE.match(line) for line in text.splitlines()) if m]
    if not plans:
        raise SystemExit('deploy/supabase-migrate.md has no line «- <date> — apply: …; check: …»')
    last = plans[-1]
    split = lambda part: [p.strip() for p in part.split(',') if p.strip()]
    apply, check = split(last['apply']), split(last['check'])
    for path in apply:
        if not MIGRATION.match(path):
            raise SystemExit(f'not a migration file: {path}')
    for path in check:
        if not CHECK.match(path):
            raise SystemExit(f'not a check file: {path}')
    for path in apply + check:
        if not (ROOT / path).is_file():
            raise SystemExit(f'missing file: {path}')
    return apply, check


def run_sql(query: str, token: str, ref: str) -> tuple[int, object]:
    request = urllib.request.Request(
        API.format(ref=ref),
        data=json.dumps({'query': query}).encode('utf-8'),
        headers={'Authorization': f'Bearer {token}', 'Content-Type': 'application/json', 'User-Agent': 'meldy-migrate'},
        method='POST',
    )
    try:
        with urllib.request.urlopen(request, timeout=300) as response:
            body = response.read().decode('utf-8') or 'null'
            return response.status, json.loads(body)
    except urllib.error.HTTPError as error:
        body = error.read().decode('utf-8', 'replace')
        try:
            message = json.loads(body).get('message', body)
        except (ValueError, AttributeError):
            message = body
        return error.code, str(message)[:600]


def contract_report(rows: object) -> dict | None:
    """The report of a check that returns one row with one JSON column holding contract_ok, else None."""
    if not (isinstance(rows, list) and len(rows) == 1 and isinstance(rows[0], dict) and len(rows[0]) == 1):
        return None
    value = next(iter(rows[0].values()))
    if isinstance(value, str):
        try:
            value = json.loads(value)
        except ValueError:
            return None
    return value if isinstance(value, dict) and 'contract_ok' in value else None


def dollar_quote(text: str) -> str:
    while True:
        tag = f'$m{secrets.token_hex(6)}$'
        if tag not in text:
            return f'{tag}{text}{tag}'


def record_sql(version: str, name: str, sql: str) -> str:
    """The row that marks a migration applied (version and name are already checked by MIGRATION)."""
    return (
        'insert into supabase_migrations.schema_migrations (version, name, statements, created_by) '
        f"values ('{version}', '{name}', array[{dollar_quote(sql)}], 'github-actions supabase-migrate') "
        'on conflict (version) do nothing'
    )


def main() -> int:
    dry = '--dry-run' in sys.argv
    apply, check = newest_plan(PLAN_FILE.read_text(encoding='utf-8'))
    print('plan: apply', apply or '—', '| check', check or '—')
    if dry:
        return 0
    token, ref = os.environ.get('SUPABASE_ACCESS_TOKEN', ''), os.environ.get('PROJECT_REF', '')
    if not token or not ref:
        print('::error::SUPABASE_ACCESS_TOKEN and PROJECT_REF are required')
        return 1

    versions = [MIGRATION.match(p)['version'] for p in apply]
    done: set[str] = set()
    if versions:
        listed = ', '.join(f"'{v}'" for v in versions)
        status, rows = run_sql(f'select version from supabase_migrations.schema_migrations where version in ({listed})', token, ref)
        if status >= 300:
            print(f'::error::reading schema_migrations failed ({status}): {rows}')
            return 1
        done = {row['version'] for row in rows or []}

    for path in apply:
        match = MIGRATION.match(path)
        version, name = match['version'], match['name']
        if version in done:
            print(f'{path}: already applied, skipped')
            continue
        sql = (ROOT / path).read_text(encoding='utf-8')
        status, result = run_sql(sql, token, ref)
        if status >= 300:
            print(f'::error::{path}: failed ({status}): {result}')
            return 1
        status, result = run_sql(record_sql(version, name, sql), token, ref)
        if status >= 300:
            print(f'::error::{path}: applied, but recording the version failed ({status}): {result}')
            return 1
        print(f'{path}: applied and recorded as {version}')

    failed_checks = 0
    for path in check:
        status, rows = run_sql((ROOT / path).read_text(encoding='utf-8'), token, ref)
        if status >= 300:
            print(f'::error::{path}: failed ({status}): {rows}')
            failed_checks += 1
            continue
        if not rows:
            print(f'{path}: ran without errors')
            continue
        report = contract_report(rows)
        if report is None:
            print(f'::error::{path}: returned rows that are not one contract_ok report')
            failed_checks += 1
            continue
        ok = report.get('contract_ok') is True
        print(f"{path}: contract_ok={report.get('contract_ok')} failed={json.dumps(report.get('failed'), ensure_ascii=False)}")
        failed_checks += 0 if ok else 1
    if failed_checks:
        print(f'::error::{failed_checks} check(s) failed')
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(main())
