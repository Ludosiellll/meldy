// Snapshots of the session's messages (spec §8.1 «Снимки всех сообщений §4»): text + keyboard JSON (+ the lines that
// pop up), in fixtures/session/snapshots/<group>.json. UPDATE_SNAPSHOTS=1 writes them; a test fails when one changes.
// The same rules as T2's fixtures/snapshot.ts, in the session package's own folder.
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Keyboard } from '../../tg.ts';

const DIR = join(dirname(fileURLToPath(import.meta.url)), 'snapshots');

export interface Shot { text: string; keyboard: Keyboard | null; toasts?: string[] }

export function matchSnapshots(group: string, shots: Record<string, Shot>): void {
  const file = join(DIR, `${group}.json`);
  const clean: Record<string, Shot> = {};
  for (const [name, shot] of Object.entries(shots)) {
    clean[name] = { text: shot.text, keyboard: shot.keyboard && shot.keyboard.length > 0 ? shot.keyboard : null };
    if (shot.toasts) clean[name].toasts = shot.toasts;
  }
  if (process.env.UPDATE_SNAPSHOTS === '1' || !existsSync(file)) {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, `${JSON.stringify(clean, null, 1)}\n`);
    if (process.env.UPDATE_SNAPSHOTS !== '1') assert.fail(`snapshot ${group}.json was missing and is written now: check it and run again`);
    return;
  }
  const stored = JSON.parse(readFileSync(file, 'utf8')) as Record<string, Shot>;
  assert.deepEqual(Object.keys(clean).sort(), Object.keys(stored).sort(), `${group}: the set of messages changed`);
  for (const name of Object.keys(clean)) assert.deepEqual(clean[name], stored[name], `${group}/${name} changed (UPDATE_SNAPSHOTS=1 to accept)`);
}
