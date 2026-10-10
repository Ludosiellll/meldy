// LOCAL ONLY; NEVER AGAINST THE LIVE PROJECT. The TS side of the T11 equivalence (oral_plan_inputs_equivalence.sh), on the
// scratch cluster the .sh prepared (the fixture of oral_plan_inputs_equivalence.py) and the Space's sheets it wrote:
//   1. the site: frontend/src/lib/containers/oralPlan.ts loadOralPlanItems, unchanged, in plain Node — GET
//      /api/oral/sheet answered with the Space's own JSON (the .py's `sheets`), its journal reads (api/learning.ts
//      fetchSheetEvents, fetchQuestionEvents) and the exams' dates through a PostgREST stand-in (oral_plan_inputs_hooks.mjs:
//      psql as role authenticated, the user's JWT sub, the policies on), the device's zone = TZ;
//   2. the bot: public.bot_oral_inputs as the service role, through a flat copy of the core made the way
//      scripts/sync_bot_plan.mjs copies the plan (relative imports rewritten to './<file>.ts'), in UTC as the Edge Function
//      runs, with `today` = the local day of the plan's zone (time.ts localDay);
//   3. compared per user, exam (container), moment and zone: the OralPlanPart lists deep-equal; the events of
//      bot_oral_inputs equal the real fetchers' answers for the same hashes; meldy_private.oral_events_json (over
//      oral_events_for) equals the two fetchers for any hash list (with the fetchers' own trimming, case and validation);
//      the day plans (decodePlanInputs + the oral dates, planDay) deep-equal.
// Usage: node --experimental-strip-types --no-warnings oral_plan_inputs_equivalence.mjs <work dir>
// Env: T11_DB (the database), PGHOST / PGPORT / PGUSER. Reads <work dir>/sheets.json; writes the copy to <work dir>/plan/.
// Prints one line per check, exits 1 when anything differs.
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { register } from 'node:module';
import { dirname, join, posix, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { isDeepStrictEqual } from 'node:util';

register('./oral_plan_inputs_hooks.mjs', import.meta.url);

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = resolve(HERE, '../../../frontend/src');
const WORK = resolve(process.argv[2] ?? '.');
const DB = process.env.T11_DB;
if (!DB) throw new Error('T11_DB is not set');

let fails = 0;
const ok = (name, detail = '') => console.log(`  ok    ${name.padEnd(66)} ${detail}`);
const bad = (name, detail = '') => {
  fails += 1;
  console.log(`  FAIL  ${name.padEnd(66)} ${detail}`);
};

// ── psql ──
const lit = (v) => (v === null || v === undefined ? 'null' : `'${String(v).replace(/'/g, "''")}'`);
function psql(script) {
  return execFileSync('psql', ['-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1', '-d', DB, '-f', '-'], { input: script, encoding: 'utf8' });
}
const json = (sql) => JSON.parse(psql(`${sql};\n`));
const asService = (sql) =>
  JSON.parse(psql(`begin;\nset local role service_role;\nselect set_config('request.jwt.claims', '{"role":"service_role"}', true) \\g /dev/null\n${sql};\ncommit;\n`));

// ── the bot's copy (scripts/sync_bot_plan.mjs's rule: a flat folder, relative specifiers → './<name>.ts') ──
export const BOT_FILES = [
  // T11 (to add to scripts/sync_bot_plan.mjs SOURCES):
  ['lib/containers/oralParts.ts', 'oralParts.ts'],
  ['lib/exams/cheatSheet.ts', 'cheatSheet.ts'],
  ['lib/exams/sheetResponse.ts', 'sheetResponse.ts'],
  ['lib/learning/readiness.ts', 'readiness.ts'],
  ['types/learning.ts', 'learning.ts'],
  // already in T2's SOURCES:
  ['lib/containers/time.ts', 'time.ts'],
  ['lib/containers/rule.ts', 'rule.ts'],
  ['lib/containers/pace.ts', 'pace.ts'],
  ['lib/containers/plan.ts', 'plan.ts'],
  ['lib/containers/planInputs.ts', 'planInputs.ts'],
  ['types/container.ts', 'container.ts'],
];
const IMPORT_RE = /(\bfrom\s+|\bimport\s*\(\s*|\bimport\s+)(['"])([^'"]+)\2/g;
function flatCopy(dir) {
  mkdirSync(dir, { recursive: true });
  for (const [source, name] of BOT_FILES) {
    const text = readFileSync(join(SRC, source), 'utf8').replace(IMPORT_RE, (whole, head, quote, spec) => {
      if (!spec.startsWith('.')) throw new Error(`${source}: imports '${spec}' (not a relative module)`);
      const target = posix.normalize(posix.join(posix.dirname(source), spec));
      const withTs = target.endsWith('.ts') ? target : `${target}.ts`;
      const hit = BOT_FILES.find(([file]) => file === withTs);
      if (!hit) throw new Error(`${source}: imports '${spec}', which is not copied (${withTs})`);
      return `${head}${quote}./${hit[1]}${quote}`;
    });
    writeFileSync(join(dir, name), text);
  }
}

function firstDifference(a, b, path = '$') {
  if (Object.is(a, b)) return null;
  if (typeof a !== typeof b || a === null || b === null || typeof a !== 'object') return `${path}: ${JSON.stringify(a)} vs ${JSON.stringify(b)}`;
  if (Array.isArray(a) !== Array.isArray(b)) return `${path}: array vs object`;
  if (Array.isArray(a)) {
    if (a.length !== b.length) return `${path}: ${a.length} vs ${b.length} items`;
    for (let i = 0; i < a.length; i += 1) {
      const d = firstDifference(a[i], b[i], `${path}[${i}]`);
      if (d) return d;
    }
    return null;
  }
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const key of keys) {
    if (!(key in a) || !(key in b)) return `${path}.${key}: missing on one side`;
    const d = firstDifference(a[key], b[key], `${path}.${key}`);
    if (d) return d;
  }
  return null;
}

// ── the fixture's users (oral_plan_inputs_equivalence.py) ──
const USERS = [
  { name: 'A (author)', id: 'a1000000-0000-4000-8000-000000000001', tg: 70001 },
  { name: 'B (member)', id: 'b1000000-0000-4000-8000-000000000002', tg: 70002 },
];
const NOWS = ['2026-12-18T23:59:59.999Z', '2026-12-21T15:00:00Z', '2026-12-21T22:30:00Z', '2026-12-22T21:30:00Z', '2026-12-26T09:00:00Z'];
const ZONES = ['Europe/Minsk', 'Asia/Vladivostok', 'America/New_York', 'UTC', 'Asia/Kolkata', 'Pacific/Kiritimati', 'Pacific/Pago_Pago'];

async function main() {
  const sheets = JSON.parse(readFileSync(join(WORK, 'sheets.json'), 'utf8'));
  const space = new Map(Object.entries(sheets).map(([key, value]) => [key, value.space]));

  // The site's modules, as they are (Vite's resolution and the Supabase client through the hooks).
  const site = await import(pathToFileURL(join(SRC, 'lib/containers/oralPlan.ts')).href);
  const learning = await import(pathToFileURL(join(SRC, 'api/learning.ts')).href);
  const siteSheet = await import(pathToFileURL(join(SRC, 'lib/exams/sheetResponse.ts')).href);
  const siteCheat = await import(pathToFileURL(join(SRC, 'lib/exams/cheatSheet.ts')).href);
  const sitePlanInputs = await import(pathToFileURL(join(SRC, 'lib/containers/planInputs.ts')).href);
  const sitePlan = await import(pathToFileURL(join(SRC, 'lib/containers/plan.ts')).href);
  const siteTime = await import(pathToFileURL(join(SRC, 'lib/containers/time.ts')).href);
  // The bot's copy.
  const planDir = join(WORK, 'plan');
  flatCopy(planDir);
  const bot = await import(pathToFileURL(join(planDir, 'oralParts.ts')).href);
  const botPlanInputs = await import(pathToFileURL(join(planDir, 'planInputs.ts')).href);
  const botPlan = await import(pathToFileURL(join(planDir, 'plan.ts')).href);
  const botTime = await import(pathToFileURL(join(planDir, 'time.ts')).href);
  ok('the bot\'s flat copy loads in plain Node', `${BOT_FILES.length} files in ${planDir}`);

  // GET /api/oral/sheet → the Space's JSON for this user (404 for an exam that is not theirs).
  globalThis.fetch = async (url) => {
    const m = /\/api\/oral\/sheet\?exam_id=([^&]+)$/.exec(String(url));
    const body = m ? space.get(`${globalThis.__T11_USER__}|${decodeURIComponent(m[1])}`) : undefined;
    if (!body) return new Response(JSON.stringify({ detail: 'Экзамен не найден' }), { status: 404, headers: { 'Content-Type': 'application/json' } });
    return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };

  let parts = 0;
  let items = 0;
  let compared = 0;
  let plans = 0;
  let withoutToday = 0;
  let fetcherLists = 0;
  let cappedSeen = 0;
  for (const user of USERS) {
    globalThis.__T11_USER__ = user.id;
    process.env.TZ = 'UTC';
    const raw = asService(`select public.bot_oral_inputs(${user.tg})`);
    if (raw.linked !== true || !Array.isArray(raw.parts)) {
      bad(`bot_oral_inputs ${user.name}`, JSON.stringify(raw).slice(0, 200));
      continue;
    }
    const containers = json(`select coalesce(json_agg(c.id order by c.exam_date nulls last, c.created_at desc, c.id), '[]') from public.containers c
                               where c.id in (select x.id from meldy_private.container_ids_of(${lit(user.id)}) as x(id))`);
    const containerOf = new Map(raw.parts.map((part) => [part.subject_id, part.container_id]));
    const capped = new Set(raw.parts.filter((part) => part.capped).map((part) => part.exam_id));

    // 2. The journal: the bot's events = the real fetchers' answers for the hashes the site reads.
    for (const part of raw.parts.filter((p) => !p.capped)) {
      const parsed = siteSheet.parseSheetResponse(part.sheet);
      const lineHashes = siteCheat.sheetHashes(parsed.questions);
      const plan = bot.oralSheetPlan(parsed, [], Date.parse(NOWS[1]), part.exam_date ?? null);
      const siteLines = lineHashes.length > 0 ? await learning.fetchSheetEvents(lineHashes) : [];
      const siteMeta = plan.metaHashes.length > 0 ? await learning.fetchQuestionEvents(plan.metaHashes, ['exam_answer', 'self_rating']) : [];
      const dl = firstDifference(siteLines, part.line_events);
      const dm = firstDifference(siteMeta, part.meta_events);
      if (dl || dm) bad(`bot_oral_inputs events = the site's reads (${user.name}, ${part.exam_id.slice(0, 8)})`, dl ?? dm);
      else ok(`bot_oral_inputs events = the site's reads (${user.name}, ${part.exam_id.slice(0, 8)})`, `${siteLines.length} line events, ${siteMeta.length} self-checks and AI checks`);
      // oral_events_for = fetchSheetEvents ∪ fetchQuestionEvents for any list, as the fetchers read it.
      const hashes = [...new Set(parsed.questions.map((q) => q.question_hash).filter(Boolean))];
      const junk = hashes.slice(0, 3).flatMap((h) => [` ${h.toUpperCase()} `, `\u3000${h}\ufeff`, `${h}\n`, h.slice(1), `${h}0`, `${h.slice(0, 31)}g`]);
      for (const list of [hashes, [...hashes, ...junk], junk, []]) {
        const expected = {
          line_events: list.length ? await learning.fetchSheetEvents(list) : [],
          meta_events: list.length ? await learning.fetchQuestionEvents(list) : [],
        };
        const got = json(`select meldy_private.oral_events_json(${lit(user.id)}, array[${list.map(lit).join(', ')}]::text[],
                            array[${list.map(lit).join(', ')}]::text[])`);
        const d = firstDifference(expected, got);
        if (d) bad(`oral_events_json = fetchSheetEvents, fetchQuestionEvents (${user.name}, ${list.length} hashes)`, d);
        fetcherLists += 1;
      }
    }

    // 1 and 3. The parts and the plans, per moment and zone.
    for (const nowIso of NOWS) {
      const now = Date.parse(nowIso);
      for (const zone of ZONES) {
        const day = siteTime.localDay(now, zone);
        // The site: one container at a time (useContainerData), parts from container_summary (hooks.ts oralParts), the
        // device's zone = the plan's zone.
        process.env.TZ = zone;
        const siteParts = new Map();
        const siteInputs = new Map();
        for (const containerId of containers) {
          const summary = json(`select meldy_private.container_summary_for(${lit(user.id)}, ${lit(containerId)}, ${lit(day)}::date)`);
          const want = [];
          for (const subject of summary.subjects) if (subject.oral?.exam_id) want.push({ examId: subject.oral.exam_id, subjectId: subject.id });
          let got;
          try {
            got = want.length > 0 ? await site.loadOralPlanItems(want, now, zone) : [];
          } catch (error) {
            // The site keeps its last oral parts then; the bot leaves such a part out (a capped part in this fixture).
            got = { error: error?.code ?? String(error) };
          }
          siteParts.set(containerId, got);
          if (!Array.isArray(got)) continue;
          const wire = json(`select meldy_private.plan_inputs_for(${lit(user.id)}, ${lit(day)}::date, ${lit(containerId)})`);
          // hooks.ts buildData: the oral items, and an oral-only subject takes its oral exam's date.
          const input = sitePlanInputs.decodePlanInputs(wire, { containerId, tz: zone, now, pending: [], oral: got.flatMap((p) => p.items) });
          const withTests = new Set(input.items.filter((i) => i.f === 't').map((i) => i.s));
          const oralDates = new Map(got.map((p) => [p.subjectId, p.examDate]));
          input.subjects = input.subjects.map((s) => {
            const oralDate = oralDates.get(s.id);
            return !withTests.has(s.id) && oralDate ? { ...s, date: oralDate } : s;
          });
          siteInputs.set(containerId, input);
        }
        // The bot: one read, in UTC, the plan's day passed in.
        process.env.TZ = 'UTC';
        const botParts = bot.oralPartsFromInputs(raw, now, { today: botTime.localDay(now, zone) });
        const plain = bot.oralPartsFromInputs(raw, now);
        const wireAll = json(`select meldy_private.plan_inputs_for(${lit(user.id)}, ${lit(day)}::date)`);
        for (const containerId of containers) {
          const mine = botParts.filter((p) => containerOf.get(p.subjectId) === containerId);
          const theirs = siteParts.get(containerId);
          const label = `${user.name}, ${containerId.slice(0, 8)}, ${nowIso.slice(5, 16)}, ${zone}`;
          if (!Array.isArray(theirs)) {
            bad(`parts (${label})`, `the site's read failed: ${JSON.stringify(theirs)}`);
            continue;
          }
          // A part over the bot's cap (more questions than any list the site makes) is left out by the bot.
          const kept = theirs.filter((p) => !capped.has(p.examId));
          cappedSeen += theirs.length - kept.length;
          const d = firstDifference(kept, mine);
          if (d) {
            bad(`OralPlanPart: site (Space JSON) = bot (SQL JSON) (${label})`, d);
            continue;
          }
          compared += 1;
          parts += mine.length;
          items += mine.reduce((sum, p) => sum + p.items.length, 0);
          if (!isDeepStrictEqual(plain.filter((p) => containerOf.get(p.subjectId) === containerId), mine)) withoutToday += 1;
          // The day plan of the exam, from both sides.
          const botInput = bot.withOralDates(
            botPlanInputs.decodePlanInputs(wireAll, { containerId, tz: zone, now, pending: [], oral: botParts.flatMap((p) => p.items) }),
            botParts,
          );
          const dp = firstDifference(sitePlan.planDay(siteInputs.get(containerId)), botPlan.planDay(botInput));
          if (dp) bad(`planDay: site = bot (${label})`, dp);
          else plans += 1;
        }
      }
    }
  }
  if (fails === 0) {
    ok('OralPlanPart: site (Space JSON) = bot (SQL JSON)', `${compared} comparisons (users × exams × ${NOWS.length} moments × ${ZONES.length} zones), ${parts} parts, ${items} items`);
    ok('planDay: site = bot (oral items, oral dates, tests)', `${plans} day plans`);
    ok('oral_events_for → oral_events_json = fetchSheetEvents, fetchQuestionEvents', `${fetcherLists} hash lists (with padded, upper-case, invalid hashes)`);
    ok('the bot without `today` (UTC days) would differ', `${withoutToday} of ${compared} comparisons: the zone matters, \`today\` fixes it`);
    ok('a part over the cap (301 questions) is left out by the bot', `${cappedSeen} times; the site plans none of its questions here (no lectures)`);
  }
  console.log(fails === 0 ? 'TS EQUIVALENCE GREEN' : `${fails} TS CHECK(S) FAILED`);
  process.exit(fails === 0 ? 0 : 1);
}

main().catch((error) => {
  console.log(`  FAIL  the TS side crashed: ${error?.stack ?? error}`);
  process.exit(1);
});
