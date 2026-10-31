/**
 * The tick's step «quiz» (migration 20261105090100_quiz_telegram.sql; release 49, spec Test_Builder_Spec_2026-10-18
 * «Выпуск 49»: «автору — «Иванов сдал: 17 из 20» и итог по закрытию; ссылку на контрольную — в группу одной кнопкой»).
 *
 * Each tick `bot_quiz_notices` hands the messages due (the database holds the author's rules: their choice per quiz —
 * each finish, a digest or nothing; at most three single messages in 10 minutes, then a digest; nothing to a link that
 * is off, blocked or paused, nothing between 22:00 and 08:00 in its zone; the close summary once; a share the author
 * asked for on the site). Four messages:
 *   one    — to the author: «Контрольная «…»» and «Новая работа: Иванов Иван — 17 из 20 (85 %).», «Результаты»;
 *   digest — to the author: the new finishes (up to 30 names), «и ещё N», how many in all, «Результаты»;
 *   close  — to the author: people, the average, who reached the pass mark, the three hardest questions, «Разбор»;
 *   share  — to the group chat bound to the exam: the quiz, its questions, timer and deadline, «Открыть контрольную».
 * At most once, as T1's deliveries: `bot_delivery_sending` right before the call → sendMessage → `bot_delivery_done`;
 * a 429 puts the row back (`bot_delivery_retry`) and stops the step; a 400/403 closes it as failed (403 in a private
 * chat: the author blocked the bot, `bot_chat_event(blocked)`); a timeout leaves it in sending (it becomes unknown).
 * Rows not reached before the tick's deadline stay claimed; the database hands them again after a minute. Without the
 * migration the step answers «missing». Names are the participants' own words: always escaped.
 */
import { DbError } from './db.ts';
import { b, lines, t } from './html.ts';
import { errorName, log } from './log.ts';
import type { Ctx, QuizPort } from './router.ts';
import type { StepStats, TickTools } from './tick.ts';
import { isBlocked, isRateLimited, send, TelegramError, type Keyboard, type TgMessage } from './tg.ts';

/** Rows a tick asks for. */
export const QUIZ_LIMIT = 20;

interface Base {
  deliveryId: number;
  chatId: number;
  quizId: string;
  containerId: string;
  title: string;
  passPercent: number | null;
}
export type QuizRow =
  | (Base & { kind: 'one'; name: string; score: number; max: number })
  | (Base & { kind: 'digest'; people: Array<{ name: string; score: number; max: number }>; count: number; done: number })
  | (Base & { kind: 'close'; people: number; avgPercent: number | null; passed: number | null; hardest: Array<{ no: string; percent: number }> })
  | (Base & { kind: 'share'; code: string; closesAt: string | null; itemCount: number; timeLimitS: number | null; guests: boolean; tz: string });

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const CODE_RE = /^[0-9a-hjkmnp-tv-z]{12}$/;

const num = (value: unknown): number | null => (typeof value === 'number' && Number.isFinite(value) ? value : typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value)) ? Number(value) : null);
const str = (value: unknown): string | null => (typeof value === 'string' ? value : null);

/** The rows of bot_quiz_notices; a row that is not one of the four is left out (counted as `bad`). */
export function parseRows(raw: unknown): { rows: QuizRow[]; bad: number } {
  const list = raw && typeof raw === 'object' && Array.isArray((raw as { rows?: unknown }).rows) ? ((raw as { rows: unknown[] }).rows) : [];
  const rows: QuizRow[] = [];
  let bad = 0;
  for (const item of list) {
    const r = (item && typeof item === 'object' ? item : {}) as Record<string, unknown>;
    const deliveryId = num(r.delivery_id);
    const chatId = num(r.chat_id);
    const quizId = str(r.quiz_id) ?? '';
    const containerId = str(r.container_id) ?? '';
    if (deliveryId === null || chatId === null || !UUID_RE.test(quizId) || !UUID_RE.test(containerId)) {
      bad += 1;
      continue;
    }
    const base: Base = { deliveryId, chatId, quizId, containerId, title: str(r.title) ?? '', passPercent: num(r.pass_percent) };
    if (r.kind === 'one') {
      rows.push({ ...base, kind: 'one', name: str(r.name) ?? '', score: num(r.score) ?? 0, max: num(r.max) ?? 0 });
    } else if (r.kind === 'digest') {
      const people = (Array.isArray(r.people) ? r.people : []).map((p) => {
        const x = (p && typeof p === 'object' ? p : {}) as Record<string, unknown>;
        return { name: str(x.name) ?? '', score: num(x.score) ?? 0, max: num(x.max) ?? 0 };
      });
      rows.push({ ...base, kind: 'digest', people, count: num(r.count) ?? people.length, done: num(r.done) ?? 0 });
    } else if (r.kind === 'close') {
      const hardest = (Array.isArray(r.hardest) ? r.hardest : []).map((h) => {
        const x = (h && typeof h === 'object' ? h : {}) as Record<string, unknown>;
        return { no: str(x.no) ?? '', percent: num(x.percent) ?? 0 };
      }).filter((h) => h.no !== '');
      rows.push({ ...base, kind: 'close', people: num(r.people) ?? 0, avgPercent: num(r.avg_percent), passed: num(r.passed), hardest });
    } else if (r.kind === 'share' && CODE_RE.test(str(r.code) ?? '')) {
      rows.push({
        ...base, kind: 'share', code: str(r.code) as string, closesAt: str(r.closes_at), itemCount: num(r.item_count) ?? 0,
        timeLimitS: num(r.time_limit_s), guests: r.guests === true, tz: str(r.tz) ?? 'Europe/Minsk',
      });
    } else {
      bad += 1;
    }
  }
  return { rows, bad };
}

// ─────────────────────────────────────────── words ───────────────────────────────────────────

const plural = (n: number, one: string, few: string, many: string) => {
  const a = Math.abs(n) % 100;
  const c = a % 10;
  if (a > 10 && a < 20) return many;
  if (c === 1) return one;
  if (c >= 2 && c <= 4) return few;
  return many;
};
/** «17», «16,5». */
const score = (n: number) => String(Math.round(n * 100) / 100).replace('.', ',');
const percent = (got: number, max: number) => (max > 0 ? Math.round((100 * got) / max) : 0);
/** A participant's name, as they typed it (never empty in the message). */
const who = (name: string) => (name.trim() ? name.trim() : 'Участник');

export const QW = {
  title: (title: string) => `Контрольная «${title}»`,
  closedTitle: (title: string) => `Контрольная «${title}» закрыта`,
  one: (name: string, got: number, max: number) => `Новая работа: ${who(name)} — ${score(got)} из ${score(max)} (${percent(got, max)} %).`,
  digestHead: (n: number) => `${plural(n, 'Новая работа', 'Новые работы', 'Новые работы')}: ${n}.`,
  person: (name: string, got: number, max: number) => `${who(name)} — ${score(got)} из ${score(max)}`,
  more: (n: number) => `и ещё ${n}`,
  done: (n: number) => `Всего сдали: ${n}.`,
  nobody: 'Никто не сдал.',
  people: (n: number, avg: number | null) =>
    `Сдали: ${n} ${plural(n, 'человек', 'человека', 'человек')}.${avg === null ? '' : ` Средний результат — ${avg} %.`}`,
  passed: (passed: number, people: number) => `Набрали проходной балл: ${passed} из ${people}.`,
  hardest: (list: Array<{ no: string; percent: number }>) => `Труднее всего: ${list.map((h) => `№ ${h.no} — ${h.percent} %`).join(', ')}.`,
  facts: (items: number, minutes: number | null, until: string | null) =>
    [`${items} ${plural(items, 'вопрос', 'вопроса', 'вопросов')}`, minutes ? `${minutes} ${plural(minutes, 'минута', 'минуты', 'минут')}` : null, until ? `до ${until}` : null]
      .filter(Boolean)
      .join(' · '),
  guests: 'Пройти можно без входа в Meldy: имя — и вперёд.',
  results: 'Результаты',
  review: 'Разбор вопросов',
  open: 'Открыть контрольную',
} as const;

/** «23 октября, 20:59» in the chat's zone (the group's, as bound). */
function untilText(iso: string | null, tz: string): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  try {
    const day = new Intl.DateTimeFormat('ru-RU', { timeZone: tz, day: 'numeric', month: 'long' }).format(date);
    const time = new Intl.DateTimeFormat('ru-RU', { timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false }).format(date);
    return `${day}, ${time}`;
  } catch {
    return null;
  }
}

export interface Out {
  text: string;
  keyboard: Keyboard | null;
}

const resultsUrl = (site: string, row: Base, tab?: string) =>
  `${site}/exams/c/${row.containerId}/quizzes/${row.quizId}${tab ? `?tab=${tab}` : ''}`;

/** The message of a row. */
export function render(row: QuizRow, site: string): Out {
  if (row.kind === 'one') {
    return { text: lines(b(QW.title(row.title)), t(QW.one(row.name, row.score, row.max))), keyboard: [[{ text: QW.results, url: resultsUrl(site, row) }]] };
  }
  if (row.kind === 'digest') {
    const shown = row.people.map((p) => t(QW.person(p.name, p.score, p.max)));
    const more = row.count - row.people.length;
    return {
      text: lines(b(QW.title(row.title)), t(QW.digestHead(row.count)), ...shown, more > 0 ? t(QW.more(more)) : null, '', t(QW.done(row.done))),
      keyboard: [[{ text: QW.results, url: resultsUrl(site, row) }]],
    };
  }
  if (row.kind === 'close') {
    return {
      text: lines(
        b(QW.closedTitle(row.title)),
        row.people === 0 ? t(QW.nobody) : t(QW.people(row.people, row.avgPercent)),
        row.people > 0 && row.passed !== null ? t(QW.passed(row.passed, row.people)) : null,
        row.people > 0 && row.hardest.length > 0 ? t(QW.hardest(row.hardest)) : null,
      ),
      keyboard: [[{ text: QW.review, url: resultsUrl(site, row, 'questions') }]],
    };
  }
  const minutes = row.timeLimitS ? Math.round(row.timeLimitS / 60) : null;
  return {
    text: lines(b(QW.title(row.title)), t(QW.facts(row.itemCount, minutes, untilText(row.closesAt, row.tz))), row.guests ? t(QW.guests) : null),
    keyboard: [[{ text: QW.open, url: `${site}/k/${row.code}` }]],
  };
}

// ─────────────────────────────────────────── the step ───────────────────────────────────────────

const add = (stats: StepStats, key: string, n = 1) => {
  stats[key] = (stats[key] ?? 0) + n;
};
/** A 400 or 403 from Telegram (it refused; nothing happened); a 429 and anything transient are not. */
const refused = (error: unknown) => error instanceof TelegramError && error.failure === 'api' && (error.code === 400 || error.code === 403);
const errorWord = (error: unknown) => (error instanceof TelegramError ? String(error.code) : 'error');

async function deliver(ctx: Ctx, stats: StepStats, row: QuizRow, pace: () => Promise<void>): Promise<'ok' | 'stop'> {
  if (!(await ctx.db.deliverySending(row.deliveryId))) {
    add(stats, 'taken');
    return 'ok';
  }
  const out = render(row, ctx.site);
  let sent: TgMessage;
  try {
    await pace();
    sent = await send(ctx.tg, { chatId: row.chatId, text: out.text, keyboard: out.keyboard });
  } catch (error) {
    if (isRateLimited(error)) {
      // Telegram did nothing: back to claimed for a later tick (or closed by the database when out of tries).
      const back = await ctx.db.deliveryRetry(row.deliveryId).catch(() => false);
      add(stats, 'rate_limited');
      add(stats, back ? 'requeued' : 'not_requeued');
      return 'stop';
    }
    if (refused(error)) {
      // The author blocked the bot in their private chat; a group that removed the bot is the group step's business.
      if (row.chatId > 0 && isBlocked(error)) await ctx.db.chatEvent(row.chatId, 'blocked').catch(() => undefined);
      await ctx.db.deliveryDone(row.deliveryId, 'failed', null, errorWord(error)).catch(() => undefined);
      add(stats, 'failed');
      return 'ok';
    }
    add(stats, 'unknown'); // a timeout or a 5xx: left in sending, it becomes unknown — never sent twice
    return 'ok';
  }
  // Out of the try: if the database fails here, the row stays in sending and becomes unknown — never sent twice.
  await ctx.db.deliveryDone(row.deliveryId, 'sent', sent.message_id);
  add(stats, row.kind);
  return 'ok';
}

export function createQuizNotices(options: { limit?: number } = {}): QuizPort {
  const limit = options.limit ?? QUIZ_LIMIT;
  return {
    async tick(ctx: Ctx, tools: TickTools): Promise<StepStats> {
      const stats: StepStats = {};
      let raw: unknown;
      try {
        raw = await ctx.db.rpc<unknown>('bot_quiz_notices', { p_limit: limit });
      } catch (error) {
        // The migration is not applied yet: no author has chosen anything.
        if (error instanceof DbError && (error.code === 'PGRST202' || error.status === 404)) return { missing: 1 };
        throw error;
      }
      const { rows, bad } = parseRows(raw);
      if (bad > 0) add(stats, 'bad', bad);
      for (const row of rows) {
        if (ctx.now() > tools.deadline) {
          add(stats, 'left'); // still claimed: handed again after a minute
          continue;
        }
        try {
          if ((await deliver(ctx, stats, row, tools.pace)) === 'stop') break;
        } catch (error) {
          add(stats, 'error');
          log({ route: 'tick', kind: 'quiz', outcome: 'failed', error_name: errorName(error) });
        }
      }
      return stats;
    },
  };
}
