// The bot's copy of the container's pure modules (spec §6.8, §8.1 «Тексты и план»): it must equal the frontend
// sources (only import paths rewritten) and give the site's plans. Run:
//   node --experimental-strip-types --test supabase/functions/_shared/plan/*.test.ts
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { expectedFiles, ROOT, SOURCES, sourceHash, staleFiles, TARGET_DIR, transform } from '../../../../scripts/sync_bot_plan.mjs';
import { planDay } from './plan.ts';
import { decodePlanInputs } from './planInputs.ts';
import { LINE_KEYS, lineText, planLine } from './words.ts';
import type { DayPlan, PlanInput, PlanInputsWire } from './container.ts';

const read = (file: string) => readFileSync(join(ROOT, file), 'utf8');

test('SOURCE_HASH is the hash of the frontend sources', () => {
  assert.equal(read(`${TARGET_DIR}/SOURCE_HASH`).trim(), sourceHash());
});

test('every copied module equals its frontend source with only the imports rewritten', () => {
  assert.deepEqual(staleFiles(), [], 'run: node scripts/sync_bot_plan.mjs');
  for (const [source, name] of SOURCES as Array<[string, string]>) {
    const copy = read(`${TARGET_DIR}/${name}`);
    const original = read(source);
    const differing = copy.split('\n').filter((line, i) => line !== original.split('\n')[i]);
    assert.ok(differing.every((line) => /^import .* from '\.\/[A-Za-z]+\.ts';$/.test(line)), `${name}: only import lines may differ`);
  }
  assert.equal(expectedFiles().size, SOURCES.length + 1);
});

test('the sync refuses an import the bot cannot load', () => {
  assert.throws(() => transform('frontend/src/lib/containers/plan.ts', "import x from 'react';"), /not a relative module/);
  assert.throws(() => transform('frontend/src/lib/containers/plan.ts', "import { y } from './oralPlan';"), /not copied/);
  assert.equal(transform('frontend/src/lib/containers/planInputs.ts', "import { paceFrom } from './pace';"), "import { paceFrom } from './pace.ts';");
});

test('the copied planDay gives the site\'s stored plans (frontend plan_vectors.json)', () => {
  const file = JSON.parse(read('frontend/src/lib/containers/__fixtures__/plan_vectors.json')) as {
    cases: Array<{ name: string; input: PlanInput; expect: DayPlan }>;
  };
  assert.ok(file.cases.length >= 10);
  for (const c of file.cases) {
    assert.deepEqual(planDay(c.input), c.expect, c.name);
    for (const line of c.expect.lines) {
      assert.ok((LINE_KEYS as readonly string[]).includes(line.key), `${c.name}: ${line.key}`);
      assert.ok(lineText(line).length > 5, `${c.name}: ${line.key}`);
    }
  }
});

test('the copied decoder reads the contract sample of plan_inputs', () => {
  const wire = JSON.parse(read('contracts/container/plan_inputs.json')) as PlanInputsWire;
  const input = decodePlanInputs(wire, { containerId: wire.containers[0].id, tz: 'Europe/Minsk', now: wire.now * 1000, pending: [], oral: [] });
  const plan = planDay(input);
  assert.equal(plan.day, wire.day);
  assert.ok(planLine(plan).startsWith('Сегодня'));
});
