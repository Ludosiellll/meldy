// LOCAL ONLY (supabase/tests/local/live_game_run.sh, the challenge stage). The numbers of «Соревнование в своё время» as
// the site's mirror counts them (frontend/src/lib/challenge/rules.ts: scoreAnswer, board), on the grid that
// live_challenge_mirror.sql plays through meldy_private.live_run_score and live_challenge_board_json. Prints two lines,
// «score <cases>:<md5>» and «board <rows>:<md5>»; the runner compares them with the SQL's.
// Run: node --experimental-strip-types --no-warnings supabase/tests/local/live_challenge_mirror.mjs
import { register } from 'node:module';
import { createHash } from 'node:crypto';

// The frontend imports its modules without an extension (Vite resolves them); Node's loader is told to try «.ts».
register(
  'data:text/javascript,' +
    encodeURIComponent(
      'export async function resolve(s, c, n) { try { return await n(s, c); } catch (e) { if (/^\\.\\.?\\//.test(s) && !/\\.[a-z]+$/i.test(s)) return n(s + ".ts", c); throw e; } }',
    ),
);
const { scoreAnswer, board } = await import(new URL('../../../frontend/src/lib/challenge/rules.ts', import.meta.url).href);

// The grid, in the SQL's order: mode, streak, frozen, the question's phase, the outcome, the time, the boss's HP.
const MODES = [
  { name: 'speed', timeS: 20, speed: true, calm: false },
  { name: 'plain', timeS: 10, speed: false, calm: false },
  { name: 'calm', timeS: 30, speed: false, calm: true },
];
const OUTCOMES = [
  ['right', 1],
  ['half', 0.5],
  ['third', 1 / 3],
  ['twothirds', 2 / 3],
  ['wrong', 0],
  ['none', null],
];
const lines = [];
for (const mode of MODES)
  for (const streak of [0, 1, 3, 5])
    for (const frozen of [false, true])
      for (const qPhase of [0, 1, 2])
        for (const [, share] of OUTCOMES)
          for (const elapsed of [0, 999, 7333, 19999])
            for (const hp of [550, 120, 5]) {
              const run = { dmg: 0, right: streak, streak, best: streak, frozen, thaws: 0, hp, hpMax: 550, phase: qPhase, timeMs: 0 };
              const out = scoreAnswer(run, share === null ? null : { share, elapsedMs: elapsed }, qPhase, mode);
              const r = out.run;
              const x = out.result;
              lines.push([x.dmg, x.correct, x.thawed, r.frozen, x.healed, r.hp, r.phase, r.streak, r.best, r.thaws, r.right, r.timeMs, x.phaseChanged ?? ''].join(':'));
            }
const md5 = (text) => createHash('md5').update(text).digest('hex');
console.log(`score ${lines.length}:${md5(lines.join(','))}`);

// The table: 120 finished runs with many ties (the SQL makes the same rows), its first 50 with their places.
const rows = Array.from({ length: 120 }, (_, k) => {
  const i = k + 1;
  return { id: String(i), dmg: 100 * (i % 7), right: i % 4, timeMs: 1000 * (i % 5), finishedAt: -i };
});
const top = board(rows).map((r) => `${r.place}:${r.dmg}:${r.right}:${r.timeMs}`);
console.log(`board ${top.length}:${md5(top.join(','))}`);
