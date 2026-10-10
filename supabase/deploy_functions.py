"""Deploy the Edge Functions named on the newest line of deploy/supabase-functions.md, with the Supabase CLI.

Run by .github/workflows/supabase-functions.yml when deploy/supabase-functions.md changes. The newest line says what to
deploy:

    - 2026-10-10 — deploy: telegram

Each name is a folder under supabase/functions/ (shared code in supabase/functions/_shared/ is bundled by the CLI). Whether
a function checks the caller's JWT comes from supabase/config.toml ([functions.<name>] verify_jwt): the webhook and the
tick of `telegram` check their own HMAC headers, so it has verify_jwt = false there, and a deploy without that section
is refused here. The CLI bundles through the Management API (no Docker). The job prints function names and the CLI's
own output; the access token stays in the environment.

Usage: python supabase/deploy_functions.py [--dry-run]   (env: SUPABASE_ACCESS_TOKEN, PROJECT_REF)
"""
from __future__ import annotations

import os
import re
import subprocess
import sys
import tomllib
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PLAN_FILE = ROOT / 'deploy' / 'supabase-functions.md'
CONFIG = ROOT / 'supabase' / 'config.toml'
LINE = re.compile(r'^\s*-\s+(?P<when>\S+)\s+—\s+deploy:\s*(?P<names>.+?)\s*$')
NAME = re.compile(r'^[a-z0-9][a-z0-9-]{0,62}$')


def newest_names(text: str) -> list[str]:
    """The function names of the newest (last) deploy line; [] when there is none yet."""
    plans = [m for m in (LINE.match(line) for line in text.splitlines()) if m]
    if not plans:
        return []
    names = [part.strip() for part in plans[-1].group('names').split(',') if part.strip()]
    for name in names:
        if not NAME.match(name):
            raise SystemExit(f'not a function name: {name!r}')
    return names


def jwt_setting(name: str) -> bool:
    """verify_jwt of [functions.<name>] in supabase/config.toml; a function without its section is refused."""
    config = tomllib.loads(CONFIG.read_text(encoding='utf-8'))
    section = config.get('functions', {}).get(name)
    if not isinstance(section, dict) or not isinstance(section.get('verify_jwt'), bool):
        raise SystemExit(f'supabase/config.toml has no [functions.{name}] verify_jwt: say it before deploying')
    return section['verify_jwt']


def main() -> int:
    dry = '--dry-run' in sys.argv[1:]
    names = newest_names(PLAN_FILE.read_text(encoding='utf-8'))
    if not names:
        print('deploy/supabase-functions.md has no deploy line yet: nothing to do')
        return 0
    ref = os.environ.get('PROJECT_REF', '')
    if not dry and (not ref or not os.environ.get('SUPABASE_ACCESS_TOKEN')):
        raise SystemExit('PROJECT_REF and SUPABASE_ACCESS_TOKEN are required')
    for name in names:
        if not (ROOT / 'supabase' / 'functions' / name / 'index.ts').is_file():
            raise SystemExit(f'supabase/functions/{name}/index.ts does not exist')
        verify = jwt_setting(name)
        command = ['supabase', 'functions', 'deploy', name, '--project-ref', ref or '<ref>', '--use-api']
        if not verify:
            command.append('--no-verify-jwt')
        print(f'{name}: verify_jwt={str(verify).lower()} → ' + ' '.join(command), flush=True)
        if dry:
            continue
        done = subprocess.run(command, cwd=ROOT, check=False)
        if done.returncode != 0:
            print(f'{name}: deploy failed (exit {done.returncode})', flush=True)
            return done.returncode
        print(f'{name}: deployed', flush=True)
    return 0


if __name__ == '__main__':
    sys.exit(main())
