// The oral plan's pure core in plain Node, the way the Telegram bot runs it (package T11): no npm, no Vite, no browser,
// no Supabase client — node --experimental-strip-types only. No database needed:
//   node --experimental-strip-types --no-warnings --test supabase/tests/local/oral_plan_core_node.test.mjs
// 1. frontend/src/lib/containers/oralParts.ts loads as it is, and every file it reaches imports only relative .ts files;
// 2. a flat copy made with scripts/sync_bot_plan.mjs's rule (the bot's supabase/functions/_shared/plan/) loads and
//    gives the same parts;
// 3. `today`: in UTC (the Edge Function's zone) with the plan's day passed in, the parts equal those a device in the
//    plan's zone computes without it — for zones east and west of UTC, around midnight, near the exam.
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, posix, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), '../../../frontend/src');
const CORE = 'lib/containers/oralParts.ts';
const IMPORT_RE = /(\bfrom\s+|\bimport\s*\(\s*|\bimport\s+)(['"])([^'"]+)\2/g;

/** Every file the core reaches through its imports (static and type-only), frontend/src-relative. */
function reach(start) {
  const seen = new Set();
  const stack = [start];
  while (stack.length > 0) {
    const file = stack.pop();
    if (seen.has(file)) continue;
    seen.add(file);
    for (const [, , , spec] of readFileSync(join(SRC, file), 'utf8').matchAll(IMPORT_RE)) {
      assert.ok(spec.startsWith('./') || spec.startsWith('../'), `${file} imports '${spec}' (not a relative module)`);
      assert.ok(spec.endsWith('.ts'), `${file} imports '${spec}' without .ts (plain Node cannot resolve it)`);
      stack.push(posix.normalize(posix.join(posix.dirname(file), spec)));
    }
  }
  return [...seen].sort();
}

const REACHED = [
  'lib/containers/oralParts.ts', 'lib/containers/time.ts', 'lib/exams/cheatSheet.ts', 'lib/exams/sheetResponse.ts',
  'lib/learning/readiness.ts', 'types/container.ts', 'types/learning.ts',
];

test('the core reaches only pure files with explicit .ts imports', () => {
  assert.deepEqual(reach(CORE), REACHED);
  for (const file of REACHED) {
    const text = readFileSync(join(SRC, file), 'utf8');
    for (const forbidden of [/\bfrom\s+['"]@?supabase/, /\b(window|document|localStorage|sessionStorage|navigator|indexedDB)\s*[.[]/, /\bfetch\s*\(/,
      /\bimport\.meta\.env\b/, /\brequire\s*\(/]) {
      assert.equal(forbidden.test(text), false, `${file}: ${forbidden}`);
    }
  }
});

// ── a small sheet (the invented «Осенняя сессия»): written lines, a twin, a peek, an erased line near the exam ──
const hash = (n) => String(n).repeat(32).slice(0, 32);
const RUBRIC = '11111111-1111-4111-8111-111111111111';
const point = (id, title, essential = false) => ({ id, title, short: '', essential, source_quote: 'цитата', source_ids: ['M1:S1'] });
const question = (n, extra) => ({
  question_id: `${n}0000000-0000-4000-8000-00000000000${n}`, position: n, label: String(n), section: 1, text: `Вопрос ${n}`,
  question_hash: hash(n), coverage: 'full', coverage_method: 'llm', coverage_reason: '', missing_note: '', rubric: null, ...extra,
});
const rubric = (id, points) => ({ rubric_id: id, built_at: null, coverage: 'full', coverage_note: '', materials: [], points });
const SHEET = {
  exam_id: 'e0000000-0000-4000-8000-000000000001', mapping_state: 'done', to_write: 1, units: 1, unwritable: 0, job: null,
  questions: [
    question(1, { rubric: rubric(RUBRIC, [point('p1', 'Спрос равен предложению', true), point('p2', 'Цена уравновешивает рынок')]) }),
    question(2, { rubric: rubric('22222222-2222-4222-8222-222222222222', [point('p1', 'Закон спроса'), point('p2', 'Товары Гиффена')]) }),
    question(3, {}),
    question(4, { coverage: null, coverage_method: null }),
  ],
};
let id = 0;
const event = (kind, n, at, day, extra = {}) => {
  id += 1;
  return {
    id: `00000000-0000-4000-8000-${String(id).padStart(12, '0')}`, created_at: at, local_date: day, material_id: null, kind,
    item_key: kind === 'oral_point' ? `oral:${RUBRIC}:p1` : `q:${hash(n)}`, correct: kind === 'oral_point' ? true : null,
    score: null, confidence: kind === 'self_rating' ? 3 : null, source_ids: [], session_id: null, payload: {}, ...extra,
  };
};
const named = (n, title, at, day, extra = {}) =>
  event('oral_point', n, at, day, { session_id: `5e550000-0000-4000-8000-${String(id + 1).padStart(12, '0')}`,
    payload: { question_hash: hash(n), rubric_id: RUBRIC, point_id: 'p1', title, status: 'covered' }, ...extra });
const peek = (n, title, at, day) =>
  event('sheet_peek', n, at, day, { item_key: `peek:${RUBRIC}:p1`, payload: { question_hash: hash(n), rubric_id: RUBRIC, point_id: 'p1', title } });
// Device days as a device in Europe/Minsk (+3) or Asia/Vladivostok (+10) would write them.
const LINE_EVENTS = [
  named(1, 'Спрос равен предложению', '2026-12-14T19:30:00Z', '2026-12-14'),
  named(1, 'Спрос равен предложению', '2026-12-15T17:40:00Z', '2026-12-15'),
  named(2, 'Закон спроса', '2026-12-20T21:30:00Z', '2026-12-21'),
  peek(2, 'Товары Гиффена', '2026-12-21T21:10:00Z', '2026-12-22'),
  peek(2, 'Закон спроса', '2026-12-21T23:10:00Z', '2026-12-22'),
];
const META_EVENTS = [event('self_rating', 1, '2026-12-18T10:00:00Z', '2026-12-18'), event('exam_answer', 3, '2026-12-19T10:00:00Z', '2026-12-19')];
const WIRE = { linked: true, cap: 300, parts: [
  { container_id: 'c0000000-0000-4000-8000-000000000001', subject_id: 's0000000-0000-4000-8000-000000000001', exam_id: SHEET.exam_id,
    exam_date: '2026-12-23', questions: 4, capped: false, sheet: SHEET, line_events: LINE_EVENTS, meta_events: META_EVENTS },
  // The same exam again (the first part wins), a capped part, a part without a subject.
  { container_id: 'c0000000-0000-4000-8000-000000000001', subject_id: 's0000000-0000-4000-8000-000000000009', exam_id: SHEET.exam_id,
    exam_date: null, questions: 4, capped: false, sheet: SHEET, line_events: [], meta_events: [] },
  { container_id: 'c0000000-0000-4000-8000-000000000002', subject_id: 's0000000-0000-4000-8000-000000000002',
    exam_id: 'e0000000-0000-4000-8000-000000000002', exam_date: null, questions: 301, capped: true, sheet: null, line_events: [], meta_events: [] },
  { container_id: 'c0000000-0000-4000-8000-000000000002', subject_id: '', exam_id: 'e0000000-0000-4000-8000-000000000003',
    exam_date: null, questions: 1, capped: false, sheet: SHEET, line_events: [], meta_events: [] },
] };

function inZone(zone, run) {
  const before = process.env.TZ;
  process.env.TZ = zone;
  try {
    return run();
  } finally {
    if (before === undefined) delete process.env.TZ;
    else process.env.TZ = before;
  }
}

test('the core from frontend/src and its flat copy give the same parts', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'oral-core-'));
  try {
    // scripts/sync_bot_plan.mjs's rule: one flat folder, every relative specifier → './<file>.ts'.
    for (const file of REACHED) {
      const text = readFileSync(join(SRC, file), 'utf8').replace(IMPORT_RE, (whole, head, quote, spec) => {
        const target = posix.normalize(posix.join(posix.dirname(file), spec));
        assert.ok(REACHED.includes(target), `${file} imports ${target}, which is not copied`);
        return `${head}${quote}./${posix.basename(target)}${quote}`;
      });
      writeFileSync(join(dir, posix.basename(file)), text);
    }
    const site = await import(pathToFileURL(join(SRC, CORE)).href);
    const bot = await import(pathToFileURL(join(dir, 'oralParts.ts')).href);
    const now = Date.parse('2026-12-21T15:00:00Z');
    const a = inZone('Europe/Minsk', () => site.oralPartsFromInputs(WIRE, now));
    const b = inZone('Europe/Minsk', () => bot.oralPartsFromInputs(WIRE, now));
    assert.deepEqual(b, a);
    assert.deepEqual(a.map((p) => [p.examId, p.subjectId, p.items.length, p.withoutPoints, p.examDate]),
      [[SHEET.exam_id, 's0000000-0000-4000-8000-000000000001', 3, 1, '2026-12-23']]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('today: in UTC with the plan\'s day passed in = a device in that zone', async () => {
  const core = await import(pathToFileURL(join(SRC, CORE)).href);
  const time = await import(pathToFileURL(join(SRC, 'lib/containers/time.ts')).href);
  const zones = ['Europe/Minsk', 'Asia/Vladivostok', 'America/New_York', 'Pacific/Kiritimati', 'Pacific/Pago_Pago', 'Asia/Kolkata', 'UTC'];
  const moments = ['2026-12-21T15:00:00Z', '2026-12-21T21:30:00Z', '2026-12-21T23:59:59.999Z', '2026-12-22T00:00:00Z',
    '2026-12-22T10:30:00Z', '2026-12-23T13:00:00Z', '2026-12-28T09:00:00Z'];
  let differs = 0;
  for (const zone of zones) {
    for (const iso of moments) {
      const now = Date.parse(iso);
      const device = inZone(zone, () => core.oralPartsFromInputs(WIRE, now));
      const server = inZone('UTC', () => core.oralPartsFromInputs(WIRE, now, { today: time.localDay(now, zone) }));
      assert.deepEqual(server, device, `${zone} at ${iso}`);
      const plain = inZone('UTC', () => core.oralPartsFromInputs(WIRE, now));
      if (JSON.stringify(plain) !== JSON.stringify(device)) differs += 1;
      // The device's own day as `today` changes nothing.
      assert.deepEqual(inZone(zone, () => core.oralPartsFromInputs(WIRE, now, { today: time.localDay(now, zone) })), device);
    }
  }
  // Without `today` a UTC server would read some of these days wrong: the fixture does exercise the day.
  assert.ok(differs > 0, 'no case depends on the zone');
});
