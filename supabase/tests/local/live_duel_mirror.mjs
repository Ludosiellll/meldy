// LOCAL ONLY (supabase/tests/local/live_game_run.sh, the duel stage). The numbers of «Дуэль» as the site's mirror counts
// them (frontend/src/lib/duel/rules.ts: scoreSeat, winnerOf), on the grid that live_duel_mirror.sql plays through the
// duel's own close (meldy_private.live_duel_close) and the challenge's live_run_score in phase 0. Prints two lines,
// «points <cases>:<md5>» and «winner <cases>:<md5>»; the runner compares them with the SQL's.
// Run: node --experimental-strip-types --no-warnings supabase/tests/local/live_duel_mirror.mjs
import { register } from 'node:module';
import { createHash } from 'node:crypto';

// The frontend imports its modules without an extension (Vite resolves them); Node's loader is told to try «.ts».
register(
  'data:text/javascript,' +
    encodeURIComponent(
      'export async function resolve(s, c, n) { try { return await n(s, c); } catch (e) { if (/^\\.\\.?\\//.test(s) && !/\\.[a-z]+$/i.test(s)) return n(s + ".ts", c); throw e; } }',
    ),
);
const { scoreSeat, winnerOf } = await import(new URL('../../../frontend/src/lib/duel/rules.ts', import.meta.url).href);

// The grid, in the SQL's order: mode, streak, frozen, the outcome, the time.
const MODES = [
  { name: 'speed', timeS: 20, speed: true, calm: false },
  { name: 'plain', timeS: 10, speed: false, calm: false },
  { name: 'calm', timeS: 30, speed: false, calm: true },
];
const OUTCOMES = [1, 0.5, 1 / 3, 2 / 3, 0, null];
const md5 = (text) => createHash('md5').update(text).digest('hex');
const lines = [];
for (const mode of MODES)
  for (const streak of [0, 1, 3, 5])
    for (const frozen of [false, true])
      for (const share of OUTCOMES)
        for (const elapsed of [0, 999, 7333, 9999]) {
          const seat = { dmg: 0, right: streak, streak, best: streak, frozen, thaws: 0, timeMs: 0 };
          const out = scoreSeat(seat, share === null ? null : { share, elapsedMs: elapsed }, mode);
          const s = out.seat;
          const p = out.points;
          lines.push([p.dmg, p.correct, p.thawed, s.frozen, s.streak, s.best, s.right, s.thaws, s.timeMs].join(':'));
        }
console.log(`points ${lines.length}:${md5(lines.join(','))}`);

// The winner: points, then right answers.
const wins = [];
for (const d1 of [0, 50, 98, 100]) for (const d2 of [0, 50, 98, 100]) for (const r1 of [0, 1, 2]) for (const r2 of [0, 1, 2]) wins.push(String(winnerOf({ dmg: d1, right: r1 }, { dmg: d2, right: r2 }) ?? ''));
console.log(`winner ${wins.length}:${md5(wins.join(','))}`);
