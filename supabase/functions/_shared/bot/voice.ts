/**
 * Stage 5 — answers by voice (spec §4.9, decisions 28–29; package T10). OFF unless bot.config.flags has {"voice": true}:
 * with the switch off every bot_voice_* call answers «off», this module sends nothing, and a voice or a text gets the
 * router's own answer (S6, M1) as before the stage.
 *
 * One oral question of the plan's AI-check session (DayPlan.sessions, kind 'ai_check': up to three questions of the
 * subject's oral exam that may count today — the same ids the site opens as /exams/<exam>/ticket?q=a,b,c) goes:
 *   V1  startVoice — a new message: «<предмет> · устный вопрос · 1 из 3», the question in bold, «Этот вопрос может войти
 *       в счёт сегодня…», the price and the units left; [Не знаю] [Проверить себя без Meldy]. No blue: the microphone
 *       is the action.
 *   V2  each voice → a single-use ticket (bot_voice_ticket) → getFile and its bytes (≤ 20 MB) → the Space
 *       (backend/bot_bridge.py: POST /api/bot/voice, header X-Meldy-Ticket) → the recognised text → bot_voice_part →
 *       «Ваш ответ · голосом, 1:42» with the text in an expandable quote, as a reply to the voice, [[Проверить — 4
 *       единицы]] [Сначала]; a later voice edits it.
 *   V3  «Проверить» → a check ticket → the Space (its take charges the units; the site's quick check and protocol at
 *       once) → bot_voice_checked → «Экзаменатор: …» as a reply to the voice, [Не знаю]; the voice to it → the Space's
 *       one-point check → bot_voice_followup.
 *   V4  the site's grade formula (oralGrade.ts) and save payload (oralPersistence.ts) → bot_voice_record (the site's
 *       record_oral_attempt for this user) → a new message: «Сами назвали …» (answerSummary.ts), the units spent,
 *       [[Следующий: 2 из 3]] {Протокол}; V1 loses its keyboard.
 *   Self-check: V1 turns into the points in an expandable quote with [Знаю] [Плаваю] [Не знаю] (bot_voice_self writes a
 *   sheet_peek of every point, as «Показать пункты» on the site); the mark (bot_voice_rate: the site's self_rating)
 *   folds it into «Отмечено: плаваю. Самопроверка в счёт не идёт…»: the points do not stay in the history.
 * Refusals never charge: a typed text, a forwarded voice, too short (the answer's first voice under 5 s by Telegram,
 * under 8 words by the Space), not recognised, the AI limit, the student's ceiling, the shared stop, over 20 MB.
 *
 * The site's pure logic is ported below line for line (oralGrade.ts, answerSummary.ts, oralPersistence.ts) and pinned
 * by voice.test.ts: against the site's modules where they load outside the browser build, against the site's own test
 * vectors where they do not.
 *
 * The bot token serves only getFile's file URL: it never reaches the Space, a log line or an error. A failure writes one
 * log line with a status word or the error's name; never a text, a ticket or an id.
 */
import type { Ctx, Tap } from './router.ts';
import type { Who } from './db.ts';
import { b, esc, lines, t, typo } from './html.ts';
import { errorName, log } from './log.ts';
import { API_BASE, edit, editKeyboard, remove, send, type Button, type FetchLike, type Keyboard, type Out, type TgMessage } from './tg.ts';
import { clockText, localDay } from '../plan/time.ts';
import { glue, plural } from '../plan/words.ts';
import * as W from './words.ts';

// ─────────────────────────────────────────── words (spec §4.9; the site's where the spec is silent) ───────────────────

export const V = {
  ORAL: 'устный вопрос',
  MAY_COUNT: 'Сегодня этот вопрос можно выучить. Ответьте голосовым, как на экзамене.',
  DONT_KNOW: 'Не знаю',
  SELF_CHECK: 'Проверить себя без Meldy',
  MORE_OR_AGAIN: 'Можно добавить ещё голосовое или начать заново.',
  AGAIN: 'Сначала',
  EXAMINER: 'Экзаменатор:',
  PROTOCOL: 'Протокол',
  ANSWER_ON_SITE: 'Ответить на сайте',
  TEXT_REFUSAL: 'Здесь считаем только голосовые ответы. Бот не отличит набранный текст от вставленного. Текстом можно ответить на сайте.',
  TOO_SHORT: 'Голосовое слишком короткое. Запишите ответ ещё раз.',
  NOT_RECOGNIZED: 'Не получилось разобрать речь. Запишите ещё раз ближе к телефону и без музыки рядом.',
  // The site's words for the quick check's limit (backend/oral_api.py CHECK_TOO_LONG_DETAIL).
  TOO_LONG: 'Ответ слишком длинный: для проверки можно до 4000 знаков.',
  // Not in the spec (for the owner's review): the shared stop, a failure, a forwarded voice, a voice over 20 MB.
  STOP: 'Сегодня бот больше не принимает голосовые, общий лимит закончился. Ответить можно на сайте или завтра здесь.',
  FAILED: 'Meldy сейчас не отвечает, голосовое не проверено. Запишите его ещё раз через минуту.',
  FORWARDED: 'Пересланное голосовое не считаем. Запишите ответ здесь.',
  TOO_BIG: 'Голосовое больше 20 МБ, бот не может его скачать. Запишите ответ короче.',
  // The self-check (spec §4.9; the site's «Пункты из ваших лекций» and «Как вы ответили?»).
  POINTS_TITLE: 'Пункты из ваших лекций:',
  HOW_ANSWERED: 'Как вы ответили?',
  KNOW: 'Знаю',
  UNSURE: 'Плаваю',
  SELF_NOTE: 'Отметка решает, когда повторим вопрос. Выученным он от неё не станет.',
};

export const header = (subject: string, n: number, of: number) => `${subject} · ${V.ORAL} · ${n} из ${of}`;
export const questionLine = (label: string, text: string) => `Вопрос ${label}. ${text}`;
export const units = (n: number) => glue(n, 'единица', 'единицы', 'единиц');
/** «стоит 1 единицу», «за 3 единицы». */
const unitsAcc = (n: number) => glue(n, 'единицу', 'единицы', 'единиц');
const left = (n: number) => `${plural(n, 'осталась', 'осталось', 'осталось')} ${n}`;
export const priceLine = (price: number, unitsLeft: number) => `Проверка стоит ${unitsAcc(price)} ИИ. Сегодня ${left(unitsLeft)}.`;
export const checkButton = (price: number) => `Проверить за ${unitsAcc(price)}`;
/** «1:42»: minutes and seconds of the recorded answer. */
export const duration = (seconds: number) => {
  const s = Math.max(0, Math.round(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};
export const answerTitle = (seconds: number) => `Ваш ответ · голосом, ${duration(seconds)}`;
export const spent = (charged: number, unitsLeft: number) => `${plural(charged, 'Списана', 'Списано', 'Списано')} ${units(charged)}, ${left(unitsLeft)}.`;
export const nextButton = (n: number, of: number) => `Следующий: ${n} из ${of}`;
export const ceilingLine = (minutes: number) =>
  `Голосовые на сегодня закончились, в день можно ${glue(minutes, 'минуту', 'минуты', 'минут')} записи. Ответить можно на сайте или завтра здесь.`;

/** «Снова можно завтра в 3:00»: the AI units' next reset (00:00 UTC, ai_quota_status's resets_at) on the student's clock. */
export function limitLine(resetsAt: number | null, now: number, tz: string): string {
  const d = new Date(now);
  const at = resetsAt ?? Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1);
  const when = localDay(at, tz) === localDay(now, tz) ? 'сегодня' : 'завтра';
  return `Проверки ИИ на сегодня закончились. Снова можно ${when} в ${clockText(at, tz)}. Проверить себя без Meldy можно сейчас.`;
}

export type Rating = 'know' | 'unsure' | 'dont_know';
const RATING_WORD: Record<Rating, string> = { know: 'знаю', unsure: 'плаваю', dont_know: 'не знаю' };
export const markedLine = (rating: Rating) => `Отмечено: ${RATING_WORD[rating]}. ${V.SELF_NOTE}`;

// ─────────────────────────────────────────── callback data: v|<aid>|<act> ───────────────────────────────────────────

/**
 * x «Не знаю» under V1 · s «Проверить себя без Meldy» · c «Проверить» · r «Сначала» · y «Не знаю» under V3 · k u d the
 * self-check's «Знаю» «Плаваю» «Не знаю» · n «Следующий». aid: the attempt's 8 base36 characters — client input, every
 * bot_voice_* matches it with the user it resolves from the Telegram id. 12 bytes.
 */
export type VoiceAct = 'x' | 's' | 'c' | 'r' | 'y' | 'k' | 'u' | 'd' | 'n';
const RATING_OF: Record<string, Rating> = { k: 'know', u: 'unsure', d: 'dont_know' };
const DATA_RE = /^v\|([0-9a-z]{8})\|([xscrykudn])$/;

export function encodeVoice(aid: string, act: VoiceAct): string {
  const data = `v|${aid}|${act}`;
  if (!DATA_RE.test(data)) throw new Error('voice: bad callback');
  return data;
}

export function decodeVoice(data: unknown): { aid: string; act: VoiceAct } | null {
  const m = typeof data === 'string' ? DATA_RE.exec(data) : null;
  return m ? { aid: m[1], act: m[2] as VoiceAct } : null;
}

// ─────────────────────────────────────────── what bot_voice_* return ───────────────────────────────────────────

export type Phase = 'asked' | 'answering' | 'followup' | 'ready' | 'self' | 'done' | 'rated' | 'closed';
export type PointStatus = 'covered' | 'partial' | 'missing' | 'wrong' | 'unrated';
export interface RubricPoint { id: string; title: string; essential: boolean; source_quote: string; source_ids: string[] }
export interface Material { key: string; material_id: string; title: string }
export interface Protocol {
  points: Array<{ id: string; status: string; student_quote: string; comment: string }>;
  errors: Array<{ point_id: string; student_quote: string; correction: string }>;
  verdict: string;
}
export interface Followup { point_id: string; question: string; expected: string; status: string | null; student_quote: string; judged_by: 'check' | null }

/** bot.voice_attempt_json: an attempt as the function sees it (no user id, no charge id). */
export interface Attempt {
  aid: string;
  phase: Phase;
  containerId: string;
  subjectId: string;
  subjectTitle: string;
  examId: string;
  questionId: string;
  question: { text: string; label: string; hash: string };
  n: number;
  of: number;
  hasNext: boolean;
  rubricId: string | null;
  evidenceMaterialId: string | null;
  points: RubricPoint[];
  materials: Material[];
  parts: Array<{ text: string; seconds: number }>;
  seconds: number;
  checked: { statuses: Record<string, string>; protocol: Protocol } | null;
  followup: Followup | null;
  charged: number;
  sessionId: string | null;
  messages: { v1: number | null; v2: number | null; v3: number | null; v4: number | null; voice: number | null };
  busy: boolean;
  updatedAt: number | null;
}

export interface Units { left: number; price: number; resetsAt: number | null }
export interface Audio { leftS: number; dayS: number; stop: boolean }

type Raw = Record<string, unknown>;
const obj = (v: unknown): Raw => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Raw) : {});
const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const num = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v)) ? Number(v) : null;
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const PHASES: readonly Phase[] = ['asked', 'answering', 'followup', 'ready', 'self', 'done', 'rated', 'closed'];

function toProtocol(raw: unknown): Protocol {
  const p = obj(raw);
  return {
    points: arr(p.points).map(obj).map((x) => ({ id: str(x.id), status: str(x.status), student_quote: str(x.student_quote), comment: str(x.comment) })),
    errors: arr(p.errors).map(obj).map((x) => ({ point_id: str(x.point_id), student_quote: str(x.student_quote), correction: str(x.correction) })),
    verdict: str(p.verdict),
  };
}

export function toAttempt(raw: unknown): Attempt | null {
  const r = obj(raw);
  const aid = str(r.aid);
  if (!/^[0-9a-z]{8}$/.test(aid)) return null;
  const q = obj(r.question);
  const messages = obj(r.messages);
  const checked = r.checked && typeof r.checked === 'object' ? obj(r.checked) : null;
  const followup = obj(r.followup);
  const updated = Date.parse(str(r.updated_at));
  return {
    aid,
    phase: PHASES.includes(r.phase as Phase) ? (r.phase as Phase) : 'closed',
    containerId: str(r.container_id),
    subjectId: str(r.subject_id),
    subjectTitle: str(r.subject_title),
    examId: str(r.exam_id),
    questionId: str(r.question_id),
    question: { text: str(q.text), label: str(q.label) || String(num(q.position) ?? ''), hash: str(q.hash) },
    n: num(r.n) ?? 1,
    of: num(r.of) ?? 1,
    hasNext: r.has_next === true,
    rubricId: str(r.rubric_id) || null,
    evidenceMaterialId: str(r.evidence_material_id) || null,
    points: arr(r.points).map(obj).map((p) => ({
      id: str(p.id), title: str(p.title), essential: p.essential === true, source_quote: str(p.source_quote),
      source_ids: arr(p.source_ids).filter((s): s is string => typeof s === 'string'),
    })),
    materials: arr(r.materials).map(obj).map((m) => ({ key: str(m.key), material_id: str(m.material_id), title: str(m.title) })),
    parts: arr(r.parts).map(obj).map((p) => ({ text: str(p.text), seconds: num(p.seconds) ?? 0 })),
    seconds: num(r.seconds) ?? 0,
    checked: checked ? { statuses: Object.fromEntries(Object.entries(obj(checked.statuses)).map(([k, v]) => [k, str(v)])), protocol: toProtocol(checked.protocol) } : null,
    followup: str(followup.point_id)
      ? {
          point_id: str(followup.point_id), question: str(followup.question), expected: str(followup.expected),
          status: str(followup.status) || null, student_quote: str(followup.student_quote), judged_by: followup.judged_by === 'check' ? 'check' : null,
        }
      : null,
    charged: num(r.charged) ?? 0,
    sessionId: str(r.session_id) || null,
    messages: { v1: num(messages.v1), v2: num(messages.v2), v3: num(messages.v3), v4: num(messages.v4), voice: num(messages.voice) },
    busy: r.busy === true,
    updatedAt: Number.isFinite(updated) ? updated : null,
  };
}

export function toUnits(raw: unknown): Units {
  const u = obj(raw);
  const resets = Date.parse(str(u.resets_at));
  return { left: num(u.left) ?? 0, price: num(u.price) ?? 4, resetsAt: Number.isFinite(resets) ? resets : null };
}

export function toAudio(raw: unknown): Audio {
  const a = obj(raw);
  return { leftS: num(a.left_s) ?? 0, dayS: num(a.day_s) ?? 1800, stop: a.stop === true };
}

// ─────────────────────────────────────────── ports of the site's pure logic ───────────────────────────────────────────

const isStatus = (v: unknown): v is PointStatus => v === 'covered' || v === 'partial' || v === 'missing' || v === 'wrong' || v === 'unrated';

/** frontend/src/lib/oral/oralGrade.ts gradeFromScore. */
export function gradeFromScore(score: number): 2 | 3 | 4 | 5 {
  if (score >= 85) return 5;
  if (score >= 65) return 4;
  if (score >= 45) return 3;
  return 2;
}

export interface GradeFollowup { point_id: string; status: string; judgedBy?: 'check' | 'keywords' | null }
const CREDIT: Record<Exclude<PointStatus, 'unrated'>, number> = { covered: 1, partial: 0.5, missing: 0, wrong: 0 };
const GRADE_CAPS = { essential_unrecovered: 3, essential_wrong: 4, two_wrong: 3 } as const;
const CAP_ORDER = ['essential_unrecovered', 'two_wrong', 'essential_wrong'] as const;
const UNRECOVERED = new Set<string>(['missing', 'wrong']);

/** frontend/src/lib/oral/oralGrade.ts gradeAnswer (formula v2): the score, the grade and the credits record_oral_attempt takes. */
export function gradeAnswer(points: ReadonlyArray<{ id: string; essential: boolean; status: string }>, followup: GradeFollowup | null): {
  score: number | null; grade: 2 | 3 | 4 | 5 | null; credits: Record<string, number | null>;
} {
  const credits: Record<string, number | null> = {};
  let sumWeights = 0;
  let sumWeighted = 0;
  let essentialWrong = false;
  let wrongs = 0;
  let unrecovered = false;
  for (const point of points) {
    const status: PointStatus = isStatus(point.status) ? point.status : 'unrated';
    if (status === 'wrong') {
      wrongs += 1;
      if (point.essential) essentialWrong = true;
    }
    const asked = followup !== null && followup.point_id === point.id ? followup : null;
    if (asked && point.essential && UNRECOVERED.has(status) && UNRECOVERED.has(String(asked.status))) unrecovered = true;
    if (status === 'unrated') {
      credits[point.id] = null;
      continue;
    }
    const weight = point.essential ? 2 : 1;
    let credit = CREDIT[status];
    if (asked) {
      if (asked.status === 'covered') credit = Math.max(credit, 0.5);
      else if (asked.status === 'partial') credit = Math.max(credit, 0.25);
    }
    credits[point.id] = credit;
    sumWeights += weight;
    sumWeighted += weight * credit;
  }
  if (sumWeights === 0) return { score: null, grade: null, credits };
  const score = Math.floor((100 * sumWeighted) / sumWeights + 0.5);
  const base = gradeFromScore(score);
  const trusted = followup !== null && followup.judgedBy !== 'keywords';
  const applies: Record<(typeof CAP_ORDER)[number], boolean> = {
    essential_unrecovered: unrecovered && trusted,
    essential_wrong: essentialWrong,
    two_wrong: wrongs >= 2,
  };
  let grade: 2 | 3 | 4 | 5 = base;
  for (const cap of CAP_ORDER) if (applies[cap] && GRADE_CAPS[cap] < grade) grade = GRADE_CAPS[cap];
  return { score, grade, credits };
}

/**
 * frontend/src/lib/oral/answerSummary.ts answerSummary + summaryLine: «Сами назвали 2 из 3 главных пунктов, ещё 1 —
 * после вопроса экзаменатора»; null when the check gave no point a verdict.
 */
export function summaryLine(points: ReadonlyArray<{ id: string; essential: boolean; status: string }>, followup: { point_id: string; status: string } | null): string | null {
  const statusOf = (p: { status: string }): PointStatus => (isStatus(p.status) ? p.status : 'unrated');
  const unrated = points.filter((p) => statusOf(p) === 'unrated').length;
  if (points.length === 0 || unrated === points.length) return null;
  const main = points.filter((point) => point.essential);
  const counted = main.length > 0 ? main : points;
  const asked = followup && followup.status === 'covered' ? points.find((point) => point.id === followup.point_id) : undefined;
  const afterQuestion = asked && ['partial', 'missing', 'wrong'].includes(statusOf(asked)) ? 1 : 0;
  const own = counted.filter((point) => statusOf(point) === 'covered').length;
  const total = counted.length;
  const errors = points.filter((p) => statusOf(p) === 'wrong').length;
  const one = (n: number) => n % 10 === 1 && n % 100 !== 11;
  const ofWord = main.length > 0 ? (one(total) ? 'главного пункта' : 'главных пунктов') : one(total) ? 'пункта' : 'пунктов';
  let line = `Сами назвали ${own} из ${total} ${ofWord}`;
  if (afterQuestion > 0) line += `, ещё ${afterQuestion} — после вопроса экзаменатора`;
  if (errors > 0) line += `. ${one(errors) ? `Ошибка в ${errors} пункте` : `Ошибки в ${errors} пунктах`}`;
  return line;
}

const clip = (value: unknown, max: number): string => (typeof value === 'string' ? value.trim().slice(0, max) : '');

/** frontend/src/lib/oral/oralPersistence.ts splitSourceId: «M1:S07» → { key: 'M1', id: 'S07' }. */
export function splitSourceId(value: string): { key: string | null; id: string } {
  const match = /^(?:(M\d{1,2}):)?(S\d{1,4})$/.exec(value.trim());
  if (!match) return { key: null, id: '' };
  return { key: match[1] ?? null, id: match[2] };
}

/** oralPersistence.ts fragmentNumber: «S07» → 7. */
export function fragmentNumber(sourceId: string): number | null {
  const match = /^S0*(\d{1,4})$/.exec(splitSourceId(sourceId).id || sourceId);
  return match ? Number(match[1]) : null;
}

/** oralPersistence.ts fragmentsLabel: «фрагмент 12» or «фрагменты 12, 13». */
export function fragmentsLabel(sourceIds: readonly string[]): string {
  const numbers = Array.from(new Set(sourceIds.map(fragmentNumber).filter((n): n is number => n !== null)));
  if (numbers.length === 0) return '';
  return numbers.length === 1 ? `фрагмент ${numbers[0]}` : `фрагменты ${numbers.join(', ')}`;
}

/** oralPersistence.ts pointSource: the point's lecture, its plain S-ids and «"Лекция", фрагмент N». */
export function pointSource(point: { source_ids: readonly string[] }, materials: readonly Material[]) {
  const parts = point.source_ids.map(splitSourceId).filter((part) => part.id);
  const key = parts[0]?.key ?? null;
  const material = key ? materials.find((item) => item.key === key) ?? null : materials[0] ?? null;
  const ids = parts.filter((part) => part.key === key).map((part) => part.id);
  const fragments = fragmentsLabel(ids);
  const title = material?.title?.trim() ?? '';
  const titled = title ? `«${title.length > 80 ? `${title.slice(0, 79)}…` : title}»` : 'Лекция';
  return { materialId: material?.material_id ?? null, sourceIds: ids.slice(0, 6), label: clip(fragments ? `${titled}, ${fragments}` : titled, 120) };
}

/**
 * oralPersistence.ts buildAttemptPayload for an answer given in the bot (no live marks, no confidence, the follow-up
 * chosen by the check): p_attempt of record_oral_attempt without the attempt's own keys — attempt_id, exam_question_id,
 * rubric_id, local_date, input 'speech', make_card — which bot_voice_record sets. Null when there is no grade to save.
 */
export function attemptPayload(attempt: Attempt, protocol: Protocol, followup: Followup | null) {
  const byId = new Map(protocol.points.map((point) => [point.id, point]));
  const grade = gradeAnswer(
    attempt.points.map((point) => ({ id: point.id, essential: point.essential, status: byId.get(point.id)?.status ?? 'unrated' })),
    followup && followup.status ? { point_id: followup.point_id, status: followup.status, judgedBy: followup.judged_by } : null,
  );
  if (grade.score === null || grade.grade === null) return null;
  const points = attempt.points.map((point) => {
    const evaluated = byId.get(point.id);
    const source = pointSource(point, attempt.materials);
    const credit = grade.credits[point.id];
    const entry: Record<string, unknown> = {
      id: point.id,
      title: clip(point.title, 120),
      essential: point.essential === true,
      status: evaluated?.status ?? 'unrated',
      student_quote: clip(evaluated?.student_quote, 160),
      comment: clip(evaluated?.comment, 200),
      source_ids: source.sourceIds,
      material_id: source.materialId,
      source_quote: clip(point.source_quote, 300),
      source_label: source.label,
      live: false,
    };
    if (typeof credit === 'number') entry.credit = credit;
    return entry;
  });
  return {
    material_id: attempt.evidenceMaterialId ?? attempt.materials[0]?.material_id ?? null,
    duration_seconds: Math.max(0, Math.min(3600, Math.round(attempt.seconds))),
    score: grade.score,
    grade: grade.grade,
    confidence: null,
    verdict: clip(protocol.verdict, 600),
    points,
    followup: followup && followup.status
      ? {
          point_id: followup.point_id,
          question: clip(followup.question, 200),
          expected: clip(followup.expected, 300),
          status: followup.status,
          student_quote: clip(followup.student_quote, 160),
          chosen_by: 'check',
        }
      : null,
    errors: protocol.errors.slice(0, 10).map((error) => ({
      point_id: error.point_id,
      student_quote: clip(error.student_quote, 160),
      correction: clip(error.correction, 160),
    })),
  };
}

/** The site's «не знаю» protocol (backend/oral_api.py dont_know_evaluation, DONT_KNOW_VERDICT): every point missing. */
export const DONT_KNOW_VERDICT = 'Ответ «не знаю»: ни один из пунктов не прозвучал.';
export function dontKnowProtocol(attempt: Attempt): Protocol {
  return { points: attempt.points.map((p) => ({ id: p.id, status: 'missing', student_quote: '', comment: '' })), errors: [], verdict: DONT_KNOW_VERDICT };
}

// ─────────────────────────────────────────── the messages ───────────────────────────────────────────

export const sitePath = {
  /** The site's answer screen for this question (the plan's AI-check link, components/containers/model.ts sessionHref). */
  answer: (a: Attempt) => `/exams/${a.examId}/ticket?q=${a.questionId}&from=c:${a.containerId}`,
  /** The saved answer's protocol (the journal's link). */
  protocol: (a: Attempt, sessionId: string) => `/exams/${a.examId}/ticket?session=${sessionId}`,
};
const button = (text: string, data: string, primary = false): Button => (primary ? { text: typo(text), data, style: 'primary' } : { text: typo(text), data });
const link = (text: string, url: string): Button => ({ text: typo(text), url });

function questionHead(a: Attempt): string {
  return lines(t(header(a.subjectTitle, a.n, a.of)), '', b(questionLine(a.question.label, a.question.text)));
}

/** V1. Its last line: the price — or why a check cannot happen now (the AI limit, the shared stop, the ceiling). */
export function v1(a: Attempt, u: Units, audio: Audio, now: number, tz: string): Out {
  let last = priceLine(u.price, u.left);
  if (u.left < u.price) last = limitLine(u.resetsAt, now, tz);
  else if (audio.stop) last = V.STOP;
  else if (audio.leftS < 10) last = ceilingLine(Math.floor(audio.dayS / 60));
  return {
    text: lines(questionHead(a), '', t(V.MAY_COUNT), t(last)),
    keyboard: [[button(V.DONT_KNOW, encodeVoice(a.aid, 'x'))], [button(V.SELF_CHECK, encodeVoice(a.aid, 's'))]],
  };
}

/** The recognised answer as the quote shows it: the voices in order, one paragraph each, at most 3500 characters. */
function transcript(a: Attempt): string {
  const text = a.parts.map((p) => p.text.trim()).filter(Boolean).join('\n');
  return text.length > 3500 ? `${text.slice(0, 3499).trimEnd()}…` : text;
}

/** V2 — the answer received. */
export function v2(a: Attempt, price: number): Out {
  return {
    text: lines(b(answerTitle(a.seconds)), `<blockquote expandable>${t(transcript(a))}</blockquote>`, t(V.MORE_OR_AGAIN)),
    keyboard: [[button(checkButton(price), encodeVoice(a.aid, 'c'), true)], [button(V.AGAIN, encodeVoice(a.aid, 'r'))]],
  };
}

/** V3 — the examiner's question, as text. */
export function v3(a: Attempt): Out {
  return { text: `<b>${esc(V.EXAMINER)}</b> ${t(a.followup?.question ?? '')}`, keyboard: [[button(V.DONT_KNOW, encodeVoice(a.aid, 'y'))]] };
}

export interface Result { summary: string | null; charged: number; unitsLeft: number; sessionId: string | null }

const protocolRow = (a: Attempt, sessionId: string | null, site: string): Button[] | null =>
  sessionId ? [link(V.PROTOCOL, `${site}${sitePath.protocol(a, sessionId)}`)] : null;

/** V4 — the result: what was named, the units spent. */
export function v4(a: Attempt, r: Result, site: string): Out {
  const keyboard: Keyboard = [];
  if (a.hasNext) keyboard.push([button(nextButton(a.n + 1, a.of), encodeVoice(a.aid, 'n'), true)]);
  const protocol = protocolRow(a, r.sessionId, site);
  if (protocol) keyboard.push(protocol);
  return {
    text: lines(r.summary ? b(`${r.summary}.`) : null, r.charged > 0 ? t(spent(r.charged, r.unitsLeft)) : null),
    keyboard,
  };
}

/** The self-check: V1 becomes the points in an expandable quote and the three marks. */
export function selfCheck(a: Attempt): Out {
  const points = a.points.map((p, i) => `${i + 1}. ${p.title.trim()}`).join('\n');
  return {
    text: lines(questionHead(a), '', t(V.POINTS_TITLE), `<blockquote expandable>${t(points)}</blockquote>`, t(V.HOW_ANSWERED)),
    keyboard: [[button(V.KNOW, encodeVoice(a.aid, 'k')), button(V.UNSURE, encodeVoice(a.aid, 'u')), button(V.DONT_KNOW, encodeVoice(a.aid, 'd'))]],
  };
}

/** …folded after the mark. */
export function selfDone(a: Attempt, rating: Rating): Out {
  return {
    text: lines(t(header(a.subjectTitle, a.n, a.of)), '', t(markedLine(rating))),
    keyboard: a.hasNext ? [[button(nextButton(a.n + 1, a.of), encodeVoice(a.aid, 'n'), true)]] : null,
  };
}

export type Refusal = 'text' | 'too_short' | 'not_recognized' | 'too_long' | 'limit' | 'ceiling' | 'stop' | 'failed' | 'forwarded' | 'too_big';

export function refusal(kind: Refusal, a: Attempt, o: { site: string; units: Units; audio: Audio; now: number; tz: string }): Out {
  const onSite: Keyboard = [[link(V.ANSWER_ON_SITE, `${o.site}${sitePath.answer(a)}`)]];
  switch (kind) {
    case 'text': return { text: t(V.TEXT_REFUSAL), keyboard: onSite };
    case 'too_short': return { text: t(V.TOO_SHORT) };
    case 'not_recognized': return { text: t(V.NOT_RECOGNIZED) };
    case 'too_long': return { text: t(V.TOO_LONG) };
    case 'limit': return { text: t(limitLine(o.units.resetsAt, o.now, o.tz)) };
    case 'ceiling': return { text: t(ceilingLine(Math.floor(o.audio.dayS / 60))), keyboard: onSite };
    case 'stop': return { text: t(V.STOP), keyboard: onSite };
    case 'failed': return { text: t(V.FAILED) };
    case 'forwarded': return { text: t(V.FORWARDED) };
    case 'too_big': return { text: t(V.TOO_BIG) };
  }
}

/** A refusal for a status of bot_voice_ticket / bot_voice_part; null: say nothing (off, gone, busy, duplicate…). */
export function dbRefusal(status: string): Refusal | null {
  return status === 'limit' || status === 'ceiling' || status === 'stop' || status === 'too_long' ? status : null;
}

/** A refusal for the Space's answer; null: say nothing (the switch went off, the question closed). */
export function bridgeRefusal(status: string): Refusal | null {
  switch (status) {
    case 'too_short': case 'not_recognized': case 'limit': case 'ceiling': case 'stop': return status;
    case 'too_large': return 'too_big';
    case 'off': case 'gone': return null;
    default: return 'failed'; // used, expired, invalid, busy, failed, bad_audio, unavailable, unreachable
  }
}

// ─────────────────────────────────────────── the database (bot_voice_*) ───────────────────────────────────────────

interface Call { status: string; raw: Raw; attempt: Attempt | null }

async function rpc(ctx: Ctx, fn: `bot_voice_${string}`, args: Record<string, unknown>): Promise<Call> {
  const raw = obj(await ctx.db.rpc(fn, args));
  return { status: str(raw.status), raw, attempt: raw.attempt ? toAttempt(raw.attempt) : null };
}

interface State { on: boolean; attempt: Attempt | null; units: Units; audio: Audio; tz: string }

async function readState(ctx: Ctx, tgUserId: number): Promise<State> {
  const raw = obj(await ctx.db.rpc('bot_voice_state', { p_tg_user_id: tgUserId }));
  return {
    on: raw.voice === true && raw.linked === true,
    attempt: raw.attempt ? toAttempt(raw.attempt) : null,
    units: toUnits(raw.units),
    audio: toAudio(raw.audio),
    tz: str(raw.tz) || 'Europe/Minsk',
  };
}

/** The bot's message ids of an attempt; losing one costs only a later edit, so it never fails the update. */
async function remember(ctx: Ctx, tgUserId: number, aid: string, which: 'v1' | 'v2' | 'v3' | 'v4' | 'voice', messageId: number | null) {
  await ctx.db.rpc('bot_voice_sent', { p_tg_user_id: tgUserId, p_aid: aid, p_which: which, p_message_id: messageId }).catch(() => null);
}

// ─────────────────────────────────────────── Telegram's file and the Space ───────────────────────────────────────────

export interface VoiceDeps {
  /** TELEGRAM_BOT_TOKEN: only for getFile's file URL (never logged, never sent to the Space). */
  token: string;
  /** The download from Telegram and the call to the Space (tests pass fakes). */
  fetch: FetchLike;
  /** The Space's origin; default ctx.site (the site and its API are one Space). */
  bridgeUrl?: string;
  /** ms: the download, a recognition (transcribe, followup), a check. */
  timeouts?: { download?: number; voice?: number; check?: number };
}

export const MAX_VOICE_BYTES = 20 * 1024 * 1024;
export const MIN_FIRST_VOICE_S = 5;
const FILE_PATH_RE = /^[A-Za-z0-9_./-]{1,256}$/;
const TYPING_EVERY_MS = 4500;

type Download = { ok: true; bytes: Uint8Array } | { ok: false; why: 'too_big' | 'failed'; error: string };

/** getFile, then the bytes from Telegram's file URL (it holds the token: never in an error or a log). */
export async function downloadVoice(ctx: Ctx, deps: VoiceDeps, fileId: string): Promise<Download> {
  let path = '';
  try {
    const file = await ctx.tg.call<{ file_path?: string; file_size?: number }>('getFile', { file_id: fileId });
    if ((file.file_size ?? 0) > MAX_VOICE_BYTES) return { ok: false, why: 'too_big', error: 'too_big' };
    path = typeof file.file_path === 'string' && FILE_PATH_RE.test(file.file_path) && !file.file_path.includes('..') ? file.file_path : '';
  } catch (error) {
    const description = error && typeof error === 'object' && 'description' in error ? String((error as { description: unknown }).description) : '';
    if (/file is too big/i.test(description)) return { ok: false, why: 'too_big', error: 'too_big' };
    return { ok: false, why: 'failed', error: errorName(error) };
  }
  if (!path) return { ok: false, why: 'failed', error: 'no_file_path' };
  try {
    const res = await deps.fetch(`${API_BASE}/file/bot${deps.token}/${path}`, { signal: AbortSignal.timeout(deps.timeouts?.download ?? 20_000) });
    if (!res.ok) return { ok: false, why: 'failed', error: `http_${res.status}` };
    if (Number(res.headers.get('content-length') ?? '0') > MAX_VOICE_BYTES) return { ok: false, why: 'too_big', error: 'too_big' };
    const bytes = new Uint8Array(await res.arrayBuffer());
    if (bytes.length > MAX_VOICE_BYTES) return { ok: false, why: 'too_big', error: 'too_big' };
    return { ok: true, bytes };
  } catch (error) {
    // The name only: the error's message can carry the URL, and the URL carries the token.
    return { ok: false, why: 'failed', error: errorName(error) };
  }
}

export type Bridged = Raw & { status: string };

/** POST <Space>/api/bot/voice with the ticket; any failure is {status: 'unreachable'} (never the URL or the ticket). */
export async function callBridge(deps: VoiceDeps, site: string, ticket: string, body: Uint8Array | null, timeoutMs: number): Promise<Bridged> {
  const headers: Record<string, string> = { 'X-Meldy-Ticket': ticket, Accept: 'application/json' };
  if (body) headers['Content-Type'] = 'audio/ogg';
  try {
    // (A Uint8Array is a fetch body everywhere; the cast only quiets TypeScript 5.7+'s ArrayBufferLike typing.)
    const res = await deps.fetch(`${(deps.bridgeUrl ?? site).replace(/\/+$/, '')}/api/bot/voice`, {
      method: 'POST', headers, body: body ? (body as unknown as BodyInit) : undefined, signal: AbortSignal.timeout(timeoutMs),
    });
    let data: Raw = {};
    try {
      data = obj(await res.json());
    } catch {
      data = {};
    }
    const status = str(data.status);
    return { ...data, status: /^[a-z_]{1,24}$/.test(status) ? status : res.ok ? 'failed' : 'unreachable' };
  } catch {
    return { status: 'unreachable' };
  }
}

// ─────────────────────────────────────────── the flows ───────────────────────────────────────────

/** «Meldy печатает…» until the work is done (Telegram shows one for 5 s); a hint only, never a failure. */
async function withTyping<T>(ctx: Ctx, chatId: number, work: () => Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let stopped = false;
  const beat = () => {
    if (stopped) return;
    ctx.tg.call('sendChatAction', { chat_id: chatId, action: 'typing' }).catch(() => null);
    timer = setTimeout(beat, TYPING_EVERY_MS);
  };
  beat();
  try {
    return await work();
  } finally {
    stopped = true;
    if (timer !== null) clearTimeout(timer);
  }
}

async function post(ctx: Ctx, chatId: number, out: Out, replyTo?: number | null): Promise<number> {
  const m = await send(ctx.tg, { chatId, text: out.text, keyboard: out.keyboard, replyTo: replyTo ?? undefined });
  return m.message_id;
}

const dropKeyboard = (ctx: Ctx, chatId: number, messageId: number | null) =>
  messageId ? editKeyboard(ctx.tg, { chatId, messageId, keyboard: null }).catch(() => null) : Promise.resolve(null);

/** Edits a message, or posts it anew when it is gone. */
async function replace(ctx: Ctx, chatId: number, messageId: number | null, out: Out): Promise<number> {
  if (messageId) {
    const result = await edit(ctx.tg, { chatId, messageId, text: out.text, keyboard: out.keyboard });
    if (result !== 'gone') return messageId;
  }
  return post(ctx, chatId, out);
}

export type StartResult = 'sent' | 'off' | 'empty' | 'gone' | 'not_ready' | 'unlinked' | 'invalid';

/**
 * V1 for the plan's AI-check session: the card's or the session's start calls this with the session plan.ts gave (the
 * subject, its oral exam, the question ids — at most three, as the site's link takes). sent: V1 went out; off: the switch
 * is off (keep «Устные — в Meldy»); empty: no question of the session has written points; the rest: nothing was sent.
 */
export async function startVoice(ctx: Ctx, s: {
  tgUserId: number; chatId: number; containerId: string; subjectId: string; examId: string; subjectTitle: string; ids: string[];
}): Promise<StartResult> {
  const r = await rpc(ctx, 'bot_voice_start', {
    p_tg_user_id: s.tgUserId, p_container_id: s.containerId, p_subject_id: s.subjectId, p_exam_id: s.examId,
    p_subject_title: s.subjectTitle, p_question_ids: s.ids, p_pos: 0,
  });
  if (r.status === 'ok' && r.attempt) {
    await showV1(ctx, s.tgUserId, s.chatId, r);
    return 'sent';
  }
  const known: readonly StartResult[] = ['off', 'empty', 'gone', 'not_ready', 'unlinked', 'invalid'];
  return known.includes(r.status as StartResult) ? (r.status as StartResult) : 'invalid';
}

async function showV1(ctx: Ctx, tgUserId: number, chatId: number, r: Call): Promise<void> {
  const a = r.attempt as Attempt;
  const id = await post(ctx, chatId, v1(a, toUnits(r.raw.units), toAudio(r.raw.audio), ctx.now(), str(r.raw.tz) || 'Europe/Minsk'));
  await remember(ctx, tgUserId, a.aid, 'v1', id);
}

export interface VoiceHandlers {
  /** A voice in a private chat: true when this stage answered it (the router stops there). */
  voice(ctx: Ctx, msg: TgMessage, who: Who): Promise<boolean>;
  /** A v|… press (V1, V2, V3, V4, the self-check). */
  press(ctx: Ctx, tap: Tap): Promise<void>;
  /** A typed text while an oral question waits for a voice: the refusal; true when answered. */
  text(ctx: Ctx, msg: TgMessage, who: Who): Promise<boolean>;
}

const ANSWERING: readonly Phase[] = ['asked', 'answering', 'followup'];
const TEXT_WINDOW_MS = 30 * 60_000;

export function createVoice(deps: VoiceDeps): VoiceHandlers {
  const timeouts = { download: 20_000, voice: 40_000, check: 55_000, ...(deps.timeouts ?? {}) };

  /** Record the answer and post V4 (after the check, the follow-up, or «Не знаю»). */
  async function finish(ctx: Ctx, st: State, tgUserId: number, chatId: number, a: Attempt, how: 'checked' | 'dont_know'): Promise<void> {
    const protocol = how === 'checked' && a.checked ? a.checked.protocol : dontKnowProtocol(a);
    const followup = how === 'checked' ? a.followup : null;
    const payload = attemptPayload(a, protocol, followup);
    if (!payload) {
      log({ route: 'webhook', kind: 'voice', outcome: 'no_grade' });
      await post(ctx, chatId, refusal('failed', a, { site: ctx.site, ...st, now: ctx.now() }));
      return;
    }
    const r = await rpc(ctx, 'bot_voice_record', { p_tg_user_id: tgUserId, p_aid: a.aid, p_attempt: payload, p_how: how });
    if (r.status !== 'ok' || !r.attempt) {
      if (r.status === 'invalid') {
        log({ route: 'webhook', kind: 'voice', outcome: 'record_invalid' });
        await post(ctx, chatId, refusal('failed', a, { site: ctx.site, ...st, now: ctx.now() }));
      }
      return;
    }
    const done = r.attempt;
    const sessionId = str(r.raw.session_id) || null;
    const points = done.points.map((p) => ({ id: p.id, essential: p.essential, status: protocol.points.find((x) => x.id === p.id)?.status ?? 'unrated' }));
    const out = v4(done, {
      summary: summaryLine(points, followup && followup.status ? { point_id: followup.point_id, status: followup.status } : null),
      charged: num(r.raw.charged) ?? 0, unitsLeft: toUnits(r.raw.units).left, sessionId,
    }, ctx.site);
    const id = await post(ctx, chatId, out);
    await remember(ctx, tgUserId, done.aid, 'v4', id);
    await dropKeyboard(ctx, chatId, done.messages.v1);
  }

  /** V2: a reply to the answer's first voice; later voices edit it. */
  async function showV2(ctx: Ctx, tgUserId: number, chatId: number, a: Attempt, price: number, voiceId: number): Promise<void> {
    const out = v2(a, price);
    if (a.messages.v2) {
      const result = await edit(ctx.tg, { chatId, messageId: a.messages.v2, text: out.text, keyboard: out.keyboard });
      if (result !== 'gone') return;
    }
    const id = await post(ctx, chatId, out, voiceId);
    await remember(ctx, tgUserId, a.aid, 'v2', id);
  }

  async function voice(ctx: Ctx, msg: TgMessage, who: Who): Promise<boolean> {
    if (!who.linked || !msg.voice) return false;
    const tgUserId = who.tgUserId;
    const chatId = msg.chat.id;
    const st = await readState(ctx, tgUserId);
    const a = st.attempt;
    if (!st.on || !a || !ANSWERING.includes(a.phase)) return false;
    const o = { site: ctx.site, ...st, now: ctx.now() };
    const say = (why: Refusal | null, more: Partial<typeof o> = {}) => (why ? post(ctx, chatId, refusal(why, a, { ...o, ...more }), msg.message_id) : null);
    const forwarded = msg as TgMessage & { forward_origin?: unknown; forward_date?: number };
    if (forwarded.forward_origin || forwarded.forward_date) {
      await say('forwarded');
      return true;
    }
    const seconds = Math.min(3600, Math.max(1, Math.round(Number(msg.voice.duration) || 0)));
    const job = a.phase === 'followup' ? 'followup' : 'transcribe';
    if (job === 'transcribe' && a.parts.length === 0 && seconds < MIN_FIRST_VOICE_S) {
      await say('too_short');
      return true;
    }
    if ((msg.voice.file_size ?? 0) > MAX_VOICE_BYTES) {
      await say('too_big');
      return true;
    }
    const tk = await rpc(ctx, 'bot_voice_ticket', { p_tg_user_id: tgUserId, p_aid: a.aid, p_job: job, p_seconds: seconds, p_message_id: msg.message_id });
    if (tk.status === 'off') return false;
    if (tk.status === 'duplicate' && tk.attempt) {
      // Telegram delivered this voice again: its text is in already.
      await showV2(ctx, tgUserId, chatId, tk.attempt, st.units.price, msg.message_id);
      return true;
    }
    if (tk.status !== 'ok') {
      await say(dbRefusal(tk.status), { units: tk.raw.units ? toUnits(tk.raw.units) : st.units, audio: tk.raw.audio ? toAudio(tk.raw.audio) : st.audio });
      return true;
    }
    const release = () => (job === 'followup' ? rpc(ctx, 'bot_voice_release', { p_tg_user_id: tgUserId, p_aid: a.aid }).catch(() => null) : null);
    const fileId = msg.voice.file_id;
    const res = await withTyping(ctx, chatId, async (): Promise<Bridged> => {
      const file = await downloadVoice(ctx, deps, fileId);
      if (!file.ok) {
        log({ route: 'webhook', kind: 'voice', outcome: 'download_failed', error_name: file.error });
        return { status: file.why === 'too_big' ? 'too_large' : 'failed' };
      }
      return callBridge(deps, ctx.site, str(tk.raw.ticket), file.bytes, timeouts.voice);
    });
    if (res.status !== 'ok') {
      log({ route: 'webhook', kind: 'voice', outcome: `${job}_${res.status}` });
      await release();
      await say(bridgeRefusal(res.status));
      return true;
    }
    const text = str(res.text);
    if (job === 'transcribe') {
      const part = await rpc(ctx, 'bot_voice_part', { p_tg_user_id: tgUserId, p_aid: a.aid, p_text: text, p_seconds: seconds, p_voice_message_id: msg.message_id });
      if (part.status === 'ok' && part.attempt) await showV2(ctx, tgUserId, chatId, part.attempt, st.units.price, msg.message_id);
      else await say(dbRefusal(part.status));
      return true;
    }
    // The answer to the examiner's question.
    const status = str(res.followup_status);
    const fu = await rpc(ctx, 'bot_voice_followup', {
      p_tg_user_id: tgUserId, p_aid: a.aid, p_status: ['covered', 'partial', 'missing', 'wrong'].includes(status) ? status : 'missing',
      p_quote: text.slice(0, 160), p_judged: res.judged_by === 'check' ? 'check' : null,
    });
    if (fu.status !== 'ok' || !fu.attempt) {
      await release();
      return true;
    }
    await remember(ctx, tgUserId, a.aid, 'voice', msg.message_id);
    await dropKeyboard(ctx, chatId, a.messages.v3);
    await finish(ctx, st, tgUserId, chatId, fu.attempt, 'checked');
    return true;
  }

  /** «Проверить»: one check ticket, the Space's check, then V3 or V4. */
  async function check(ctx: Ctx, tap: Tap, aid: string): Promise<void> {
    const tgUserId = tap.tgUserId;
    const chatId = tap.chatId;
    const st = await readState(ctx, tgUserId);
    const a = st.attempt;
    if (!st.on) return tap.answer();
    if (!a || a.aid !== aid) return tap.answer(W.OLD_BUTTON);
    // A check stored earlier whose answer was not recorded, or whose question was not posted: finish it, no second check.
    if (a.phase === 'ready') {
      await tap.answer();
      return finish(ctx, st, tgUserId, chatId, a, 'checked');
    }
    if (a.phase === 'followup' && a.messages.v3 === null && !a.busy) {
      await tap.answer();
      const id = await post(ctx, chatId, v3(a), a.messages.voice);
      await remember(ctx, tgUserId, aid, 'v3', id);
      return;
    }
    const base = { p_tg_user_id: tgUserId, p_aid: aid };
    const tk = await rpc(ctx, 'bot_voice_ticket', { ...base, p_job: 'check', p_seconds: 0 });
    if (tk.status === 'gone') return tap.answer(W.OLD_BUTTON);
    await tap.answer();
    const o = { site: ctx.site, ...st, now: ctx.now() };
    if (tk.status !== 'ok') {
      const why = dbRefusal(tk.status);
      if (why) await post(ctx, chatId, refusal(why, a, { ...o, units: tk.raw.units ? toUnits(tk.raw.units) : st.units }), a.messages.v2);
      return;
    }
    const res = await withTyping(ctx, chatId, () => callBridge(deps, ctx.site, str(tk.raw.ticket), null, timeouts.check));
    try {
      if (res.status === 'dont_know') {
        // The site never checks «не знаю» with a model: the Space gave the units back; the answer is saved as «не знаю».
        await dropKeyboard(ctx, chatId, a.messages.v2);
        return await finish(ctx, st, tgUserId, chatId, a, 'dont_know');
      }
      if (res.status !== 'ok') {
        log({ route: 'webhook', kind: 'voice', outcome: `check_${res.status}` });
        await rpc(ctx, 'bot_voice_release', base);
        const why = bridgeRefusal(res.status);
        if (why) await post(ctx, chatId, why === 'failed' ? { text: t(W.DB_DOWN_TAP) } : refusal(why, a, o), a.messages.v2);
        return;
      }
      const ck = await rpc(ctx, 'bot_voice_checked', { ...base, p_result: { statuses: obj(res.statuses), ask: res.ask ?? null, protocol: obj(res.protocol) } });
      if (ck.status !== 'ok' || !ck.attempt) {
        if (ck.status === 'invalid') {
          log({ route: 'webhook', kind: 'voice', outcome: 'check_invalid' });
          await rpc(ctx, 'bot_voice_release', base);
          await post(ctx, chatId, { text: t(W.DB_DOWN_TAP) }, a.messages.v2);
        }
        return;
      }
      await dropKeyboard(ctx, chatId, a.messages.v2);
      if (ck.attempt.phase === 'followup') {
        const id = await post(ctx, chatId, v3(ck.attempt), ck.attempt.messages.voice);
        await remember(ctx, tgUserId, aid, 'v3', id);
        return;
      }
      await finish(ctx, st, tgUserId, chatId, ck.attempt, 'checked');
    } catch (error) {
      // Units taken with no stored result go back (bot_voice_release refunds only while nothing is stored).
      log({ route: 'webhook', kind: 'voice', outcome: 'check_failed', error_name: errorName(error) });
      await rpc(ctx, 'bot_voice_release', base).catch(() => null);
      await post(ctx, chatId, { text: t(W.DB_DOWN_TAP) }, a.messages.v2).catch(() => null);
    }
  }

  /** «Не знаю» to the examiner's question: missing, a trustworthy verdict (the site's button), then V4. */
  async function followupDontKnow(ctx: Ctx, tap: Tap, st: State, a: Attempt): Promise<void> {
    const fu = await rpc(ctx, 'bot_voice_followup', { p_tg_user_id: tap.tgUserId, p_aid: a.aid, p_status: 'missing', p_quote: '', p_judged: null });
    if (fu.status !== 'ok' || !fu.attempt) return tap.answer(fu.status === 'gone' ? W.OLD_BUTTON : undefined);
    await tap.answer();
    await dropKeyboard(ctx, tap.chatId, a.messages.v3);
    return finish(ctx, st, tap.tgUserId, tap.chatId, fu.attempt, 'checked');
  }

  /** «Не знаю» under V1 (the whole answer) or under V3 (the examiner's question). */
  async function dontKnow(ctx: Ctx, tap: Tap, aid: string, under: 'v1' | 'v3'): Promise<void> {
    const st = await readState(ctx, tap.tgUserId);
    const a = st.attempt;
    if (!st.on) return tap.answer();
    if (!a || a.aid !== aid) return tap.answer(W.OLD_BUTTON);
    if (a.busy) return tap.answer();
    if (a.phase === 'followup') return followupDontKnow(ctx, tap, st, a);
    if (under === 'v3' || (a.phase !== 'asked' && a.phase !== 'answering')) return tap.answer(W.OLD_BUTTON);
    await tap.answer();
    await dropKeyboard(ctx, tap.chatId, a.messages.v2);
    return finish(ctx, st, tap.tgUserId, tap.chatId, a, 'dont_know');
  }

  async function press(ctx: Ctx, tap: Tap): Promise<void> {
    const cb = decodeVoice(tap.data);
    if (!cb || tap.chatType !== 'private') return tap.answer();
    const tgUserId = tap.tgUserId;
    const chatId = tap.chatId;
    const base = { p_tg_user_id: tgUserId, p_aid: cb.aid };
    const quiet = (status: string) => tap.answer(status === 'gone' ? W.OLD_BUTTON : undefined);
    switch (cb.act) {
      case 'c':
        return check(ctx, tap, cb.aid);
      case 'x':
        return dontKnow(ctx, tap, cb.aid, 'v1');
      case 'y':
        return dontKnow(ctx, tap, cb.aid, 'v3');
      case 'r': {
        const r = await rpc(ctx, 'bot_voice_restart', base);
        if (r.status !== 'ok') return quiet(r.status);
        await tap.answer();
        await remove(ctx.tg, chatId, num(r.raw.v2));
        return;
      }
      case 's': {
        const r = await rpc(ctx, 'bot_voice_self', base);
        if (r.status !== 'ok' || !r.attempt) return quiet(r.status);
        await tap.answer();
        const a = r.attempt;
        await remove(ctx.tg, chatId, a.messages.v2);
        const id = await replace(ctx, chatId, a.messages.v1 ?? tap.messageId, selfCheck(a));
        if (id !== a.messages.v1) await remember(ctx, tgUserId, a.aid, 'v1', id);
        return;
      }
      case 'k': case 'u': case 'd': {
        const rating = RATING_OF[cb.act];
        const r = await rpc(ctx, 'bot_voice_rate', { ...base, p_rating: rating });
        if (r.status !== 'ok' || !r.attempt) return quiet(r.status);
        await tap.answer();
        await replace(ctx, chatId, r.attempt.messages.v1 ?? tap.messageId, selfDone(r.attempt, rating));
        return;
      }
      case 'n': {
        const r = await rpc(ctx, 'bot_voice_next', base);
        const prev = r.raw.prev ? toAttempt(r.raw.prev) : null;
        // «Следующий» goes from the answered question's message; «Протокол» stays.
        const keep = prev ? protocolRow(prev, prev.sessionId, ctx.site) : null;
        const settle = () => (tap.messageId ? editKeyboard(ctx.tg, { chatId, messageId: tap.messageId, keyboard: keep ? [keep] : null }).catch(() => null) : null);
        if (r.status === 'ok' && r.attempt) {
          await tap.answer();
          await settle();
          if (r.raw.again !== true) await showV1(ctx, tgUserId, chatId, r);
          return;
        }
        await quiet(r.status);
        if (r.status === 'end' || r.status === 'empty') await settle();
        return;
      }
    }
  }

  async function text(ctx: Ctx, msg: TgMessage, who: Who): Promise<boolean> {
    if (!who.linked || typeof msg.text !== 'string') return false;
    const st = await readState(ctx, who.tgUserId);
    const a = st.attempt;
    if (!st.on || !a || !ANSWERING.includes(a.phase)) return false;
    // A reply to the question's messages, or a text within half an hour of its last step, is meant as the answer.
    const ids = [a.messages.v1, a.messages.v2, a.messages.v3].filter((id): id is number => id !== null);
    const replyTo = msg.reply_to_message?.message_id;
    const recent = a.updatedAt !== null && ctx.now() - a.updatedAt <= TEXT_WINDOW_MS;
    if (!(replyTo !== undefined && ids.includes(replyTo)) && !recent) return false;
    await post(ctx, msg.chat.id, refusal('text', a, { site: ctx.site, ...st, now: ctx.now() }), msg.message_id);
    return true;
  }

  return { voice, press, text };
}
