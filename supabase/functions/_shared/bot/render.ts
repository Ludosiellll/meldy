/**
 * The «занятие» in chat as messages (spec §4.3 Z1–Z12, §4.8): pure builders of HTML text and keyboards; session.ts
 * sends and edits them. Every message passes lint.ts in the tests (fixtures/snapshots/session.json).
 *
 * - The question (Z1–Z5): a muted line (subject · «7 из 20», a retry «· повтор — не в счёт»), the question in bold,
 *   code in `<pre><code class="language-csharp">` (never inside `<b>`), options on buttons or by letter (question.ts).
 *   No blue button: the answer is the action — except «Ответить» of several correct answers.
 * - After a wrong answer or «Не знаю» (Z7, Z8): the question loses its bold, the answer from the file takes it; only
 *   «В файле» and «Ваш ответ» stay, then the verdict, the notes about the key and «№ 57 · Тема 3. …». «Нажали не
 *   туда?» (Z9), «Сомневаюсь в ключе» (Z11) and the author's «Ключ неверный?» (Z12) are edits of the same message.
 * - The words (container decisions 41, 42, 50 where they override the bot spec's older lines): «повтор — не в счёт»,
 *   «Верных ответов несколько — отметьте все.» The figure in «Верно. Теперь 144 из 960 — …» is the copied words.ts.
 *
 * Question text and options are the student's own (the file's): escaped, never glued or reworded. Comments stay in
 * English: a test reads the Russian strings for forbidden words.
 */
import { encode, type SessionAct } from './codec.ts';
import { b, code as inlineCode, EN_SPACE, esc, lines, pre, t, visibleLength } from './html.ts';
import { LIMITS } from './lint.ts';
import type { Button, Keyboard, Out } from './tg.ts';
import * as W from './words.ts';
import { dayText, figureLines } from '../plan/words.ts';
import {
  fileNumber, flip, isMarked, LETTERS, layoutOf, letterRows, optionLabel, stemParts, type Layout, type QuestionItem,
} from './question.ts';

// ─────────────────────────────────────────── the words of the «занятие» ───────────────────────────────────────────

export const S = {
  dontKnow: 'Не знаю',
  finish: 'Закончить',
  answer: 'Ответить',
  next: 'Дальше',
  misclick: 'Нажали не туда?',
  doubt: 'Сомневаюсь в ключе',
  keyWrong: 'Ключ неверный?',
  mark: 'Отметить',
  cancel: 'Отмена',
  done: 'Готово',
  retryTag: 'повтор — не в счёт',
  /** Container decision 50 (over the bot spec's «Выберите все верные ответы.»). */
  multipleHint: 'Верных ответов несколько — отметьте все.',
  shortHint: 'Напишите ответ сообщением.',
  inFile: 'В файле',
  inFileMany: 'В файле верны',
  yours: 'Ваш ответ',
  right: 'Верно.',
  wrong: 'Неверно.',
  markOne: 'Отметьте хотя бы один вариант.',
  misclickDone: 'Отменили: ошибку не считаем. Ответ вы уже видели — вопрос вернётся завтра.',
  doubtDone: 'Отложено. Когда автор ответит, вопрос вернётся в занятия.',
  manualByAuthor: 'В файле ответ не был выделен — ключ поставил автор.',
  manualByYou: 'В файле ответ не был выделен — ключ поставили вы.',
  moved: 'Занятие продолжено ниже.',
} as const;

/** «Вернётся через пару вопросов и завтра.» while the session still brings it back, else «Вернётся завтра.» */
export const comesBack = (again: boolean) => (again ? 'Вернётся через пару вопросов и завтра.' : 'Вернётся завтра.');
export const doubtAsk = (no: string) =>
  `Сомневаетесь в ключе к № ${no}? Автор экзамена увидит, сколько участников сомневаются, — без имён. Вопрос отложим у вас, пока автор не ответит.`;
export const keyFixedOn = (day: string) => `Ключ исправлен автором ${dayText(day)}.`;
/** «Верно.», «Верно: оба.», «Верно: все 3.» (several correct: the site's verdictRightAll). */
export function rightLine(kind: QuestionItem['kind'], keyCount: number): string {
  if (kind !== 'multiple' || keyCount < 2) return S.right;
  return keyCount === 2 ? 'Верно: оба.' : `Верно: все ${keyCount}.`;
}
/** The line of a right answer (Z6): on the step `two_days` the figure follows, in the plan's words (words.ts). */
export function rightToast(kind: QuestionItem['kind'], keyCount: number, figure: { twoDays: number; inPlan: number } | null): string {
  const head = rightLine(kind, keyCount);
  if (!figure || figure.twoDays <= 0) return head;
  const words = figureLines({ inPlan: figure.inPlan, twoDays: figure.twoDays, seen: 0, errors: 0, selfKnow: 0 }, null);
  return `${head} Теперь ${words.big} ${words.of} — ${words.label}.`;
}
/** «Верно: 32.» — the file's form the typed answer matched (the normalisation shown). */
export const shortRight = (form: string) => `Верно: ${form}.`;

// ─────────────────────────────────────────── what a message shows ───────────────────────────────────────────

/** The question at a position of the session, as the builders need it. */
export interface QuestionView {
  sid: string;
  pos: number;
  /** The subject's title (the student's own words). */
  subject: string;
  n: number;
  of: number;
  /** The session's own retry of a mistake. */
  retry: boolean;
  item: QuestionItem;
  role: 'owner' | 'member';
  containerId: string;
  subjectId: string;
}

/** What was answered at the position, with the key for display (after the answer only). Indices are SHOWN indices. */
export interface Shown {
  dontKnow: boolean;
  key: number[];
  chosen: number[];
  /** A short answer: the file's accepted forms (the first is shown) and the typed text. */
  forms: string[];
  text: string | null;
  /** The mistake comes back in this session (3–5 questions later): the question's retry is under 2. */
  again: boolean;
  /** Already in the answer log (the tick's flush, the doubt): «Нажали не туда?» is no longer possible. */
  recorded?: boolean;
}

export type ReviewStage = 'review' | 'misclick' | 'doubt' | 'doubted';

export interface RenderOptions {
  site: string;
}

const data = (v: Pick<QuestionView, 'sid' | 'pos'>, act: SessionAct) => encode({ kind: 'session', sid: v.sid, pos: v.pos, act });
const row = (button: Button): Button[] => [button];
const oneLine = (text: string) => String(text).replace(/\s*[\r\n]+\s*/g, ' ').trim();
/** The student's own text, escaped, never glued. */
const own = (text: string) => esc(text);
/** A typed answer shown back: at most 200 characters. */
const typedShown = (text: string) => ([...text].length > 200 ? `${[...text].slice(0, 199).join('').trimEnd()}…` : text);

/** «Компьютерные сети · 3 из 20», a retry «… · повтор — не в счёт». */
export function headerText(v: Pick<QuestionView, 'subject' | 'n' | 'of' | 'retry'>): string {
  return `${oneLine(v.subject)} · ${v.n} из ${v.of}${v.retry ? ` · ${S.retryTag}` : ''}`;
}

/**
 * The question's words and code, split as the site splits them (the copied `stemParts`): the words bold before the
 * answer, plain after it (the bold moves to the answer from the file); the code in `<pre>`, never inside `<b>`.
 */
function stemBlock(item: QuestionItem, bold: boolean): string {
  const stem = stemParts(item.stem, item.code);
  const words = (text: string) => (bold ? `<b>${own(text)}</b>` : own(text));
  return lines(stem.before ? words(stem.before) : null, stem.code ? pre(stem.code, 'csharp') : null, stem.after ? words(stem.after) : null);
}

/** «<b>А</b> Изменения…» — one line per option, U+2002 after the letter, code in `<code>`, no empty lines. */
function letterList(item: QuestionItem, layout: Layout): string {
  return item.options
    .map((option, i) => `<b>${LETTERS[i]}</b>${EN_SPACE}${layout.code[i] ? inlineCode(String(option).trim()) : own(oneLine(option))}`)
    .join('\n');
}

/** «№ 57 · Тема 3. Транзакции». */
function numberLine(item: QuestionItem): string {
  const topic = item.topicTitle ? oneLine(item.topicTitle) : '';
  return t(topic ? `№ ${fileNumber(item)} · ${topic}` : `№ ${fileNumber(item)}`);
}

/** Notes above the number: a key the author set by hand; a key the author fixed (members). */
function notes(v: QuestionView): string[] {
  const out: string[] = [];
  if (v.item.keySource === 'manual') out.push(t(v.role === 'owner' ? S.manualByYou : S.manualByAuthor));
  if (v.role !== 'owner' && v.item.keyChangedAt && /^\d{4}-\d{2}-\d{2}/.test(v.item.keyChangedAt)) {
    out.push(t(keyFixedOn(v.item.keyChangedAt.slice(0, 10))));
  }
  return out;
}

/** «Ключи» of the site on this question (the author's «Ключ неверный?», Z12). */
export function keysUrl(site: string, v: Pick<QuestionView, 'containerId' | 'subjectId' | 'item'>): string {
  return `${site}/exams/c/${v.containerId}/keys?s=${encodeURIComponent(v.subjectId)}&no=${encodeURIComponent(fileNumber(v.item))}`;
}

// ─────────────────────────────────────────── Z1–Z5: the question ───────────────────────────────────────────

/** The keyboard of a question: options (marked ones «✓ …» with several correct), «Ответить», «Не знаю · Закончить». */
export function questionKeyboard(v: QuestionView, mask = 0): Keyboard {
  const item = v.item;
  const layout = layoutOf(item);
  const multiple = item.kind === 'multiple';
  const act = (i: number): SessionAct => (multiple ? { a: 'toggle', mask: flip(mask, i) } : { a: 'option', i });
  const label = (i: number, base: string) => (multiple && isMarked(mask, i) ? `✓ ${base}` : base);
  const keyboard: Keyboard = [];
  if (layout.mode === 'buttons') {
    item.options.forEach((option, i) => keyboard.push(row({ text: label(i, optionLabel(option)), data: data(v, act(i)) })));
  } else if (layout.mode === 'letters') {
    for (const indices of letterRows(item.options.length, multiple)) {
      keyboard.push(indices.map((i) => ({ text: label(i, LETTERS[i]), data: data(v, act(i)) })));
    }
  }
  if (multiple) keyboard.push(row({ text: S.answer, data: data(v, { a: 'submit', mask }), style: 'primary' }));
  keyboard.push([{ text: S.dontKnow, data: data(v, { a: 'dont_know' }) }, { text: S.finish, data: data(v, { a: 'finish' }) }]);
  return keyboard;
}

/** Z1–Z5: the question at its position (`mask`: the marks of several correct answers). */
export function questionOut(v: QuestionView, mask = 0): Out {
  const item = v.item;
  const layout = layoutOf(item);
  const text = lines(
    t(headerText(v)),
    '',
    stemBlock(item, true),
    item.kind === 'multiple' ? t(S.multipleHint) : null,
    item.kind === 'short' ? t(S.shortHint) : null,
    layout.mode === 'letters' ? '' : null,
    layout.mode === 'letters' ? letterList(item, layout) : null,
  );
  return { text, keyboard: questionKeyboard(v, mask) };
}

// ─────────────────────────────────────────── Z5, Z7–Z11: after the answer ───────────────────────────────────────────

/** «В файле — …» and «Ваш ответ — …» as the layout shows options (buttons, letters, code; several; short). */
function answerBlock(v: QuestionView, shown: Shown, withYours: boolean): string {
  const item = v.item;
  const layout = layoutOf(item);
  const yours = withYours && !shown.dontKnow;
  if (item.kind === 'short') {
    const form = shown.forms[0] ?? '';
    return lines(
      `${t(`${S.inFile} — `)}<b>${own(oneLine(form))}</b>`,
      yours && shown.text !== null ? `${t(`${S.yours} — `)}${own(typedShown(oneLine(shown.text)))}` : null,
    );
  }
  const key = shown.key.filter((i) => i >= 0 && i < item.options.length);
  const chosen = shown.chosen.filter((i) => i >= 0 && i < item.options.length);
  const multiple = item.kind === 'multiple';
  const keyHead = multiple && key.length > 1 ? `${S.inFileMany}: ` : `${S.inFile} — `;
  const yoursHead = multiple ? `${S.yours}: ` : `${S.yours} — `;
  if (layout.mode === 'buttons') {
    const labels = (indices: number[]) => indices.map((i) => optionLabel(item.options[i])).join(', ');
    return lines(
      `${t(keyHead)}<b>${own(labels(key))}</b>`,
      yours && chosen.length > 0 ? `${t(yoursHead)}${own(labels(chosen))}` : null,
    );
  }
  const letters = (indices: number[]) => indices.map((i) => LETTERS[i]).join(', ');
  const body = (i: number, bold: boolean) => {
    if (layout.code[i]) return inlineCode(String(item.options[i]).trim());
    return bold ? `<b>${own(oneLine(item.options[i]))}</b>` : own(oneLine(item.options[i]));
  };
  const anyCode = key.some((i) => layout.code[i]);
  // Bold may not hold code (api: «except pre and code»): with code options the heading is the bold part.
  const head = anyCode ? b(`${keyHead}${letters(key)}`) : t(`${keyHead}${letters(key)}`);
  const extra = multiple ? chosen.filter((i) => !key.includes(i)) : chosen;
  return lines(
    head,
    ...key.map((i) => body(i, true)),
    yours && chosen.length > 0 ? t(`${yoursHead}${letters(chosen)}`) : null,
    ...(yours ? extra.map((i) => body(i, false)) : []),
  );
}

/** The keyboard after a wrong answer or «Не знаю»: «Дальше», «Нажали не туда?» (not for a typed answer), the key's row. */
function reviewKeyboard(v: QuestionView, shown: Shown, stage: ReviewStage, options: RenderOptions): Keyboard {
  const next = row({ text: S.next, data: data(v, { a: 'next' }), style: 'primary' });
  if (stage === 'misclick' || stage === 'doubted') return [next];
  if (stage === 'doubt') {
    return [row({ text: S.mark, data: data(v, { a: 'doubt_mark' }), style: 'primary' }), row({ text: S.cancel, data: data(v, { a: 'doubt_back' }) })];
  }
  const keyboard: Keyboard = [next];
  // «Нажали не туда?» answers a press while the answer still waits: not a typed answer (Z5) — «Не знаю» on a short
  // question is a press — and not once it is in the log (the tick's flush after 30 minutes).
  if (!shown.recorded && (v.item.kind !== 'short' || shown.dontKnow)) keyboard.push(row({ text: S.misclick, data: data(v, { a: 'misclick' }) }));
  if (v.role === 'owner') keyboard.push(row({ text: S.keyWrong, url: keysUrl(options.site, v) }));
  else keyboard.push(row({ text: S.doubt, data: data(v, { a: 'doubt' }) }));
  return keyboard;
}

/**
 * Z7 (wrong), Z8 («Не знаю»), Z5 (a typed answer, wrong), Z9 («Нажали не туда?»), Z11 (the doubt asked, then done).
 * The question stays without bold; the answer from the file is bold.
 */
export function reviewOut(v: QuestionView, shown: Shown, stage: ReviewStage, options: RenderOptions): Out {
  const no = fileNumber(v.item);
  let verdict: string;
  if (stage === 'misclick') verdict = S.misclickDone;
  else if (stage === 'doubt') verdict = doubtAsk(no);
  else if (stage === 'doubted') verdict = S.doubtDone;
  else verdict = shown.dontKnow ? comesBack(shown.again) : `${S.wrong} ${comesBack(shown.again)}`;
  const text = lines(
    t(headerText(v)),
    '',
    stemBlock(v.item, false),
    '',
    answerBlock(v, shown, stage !== 'misclick'),
    '',
    t(verdict),
    ...(stage === 'review' || stage === 'misclick' ? notes(v) : []),
    stage === 'doubt' ? null : numberLine(v.item),
  );
  return { text, keyboard: reviewKeyboard(v, shown, stage, options) };
}

/** Z5, a typed answer that is right: «Верно: 32.» and «Дальше» (no line pops up for a message). */
export function shortRightOut(v: QuestionView, form: string): Out {
  const line = v.item.kind === 'short' && form.trim() !== '' ? shortRight(oneLine(form)) : S.right;
  const text = lines(t(headerText(v)), '', stemBlock(v.item, false), '', t(line), numberLine(v.item));
  return { text, keyboard: [row({ text: S.next, data: data(v, { a: 'next' }), style: 'primary' })] };
}

// ─────────────────────────────────────────── 4096: what does not fit ───────────────────────────────────────────

/**
 * Whether the question and every edit of it fit Telegram's 4096 characters (Z7: a question up to 4000 characters and
 * options up to 600 may not): the question itself, and the longest review (the two longest options as the key and the
 * answer; every option as the key of several). A question that does not fit is left to the site.
 */
export function fitsTelegram(v: QuestionView, options: RenderOptions): boolean {
  const limit = LIMITS.text;
  if (visibleLength(questionOut(v).text) > limit) return false;
  const n = v.item.options.length;
  const size = (i: number) => [...v.item.options[i]].length;
  const byLength = Array.from({ length: n }, (_, i) => i).sort((a, c) => size(c) - size(a) || a - c);
  let worst: Shown;
  if (v.item.kind === 'short') {
    // The file's forms are at most 200 characters; a typed answer is shown up to 200.
    worst = { dontKnow: false, key: [], chosen: [], forms: ['x'.repeat(200)], text: 'x'.repeat(200), again: true };
  } else if (v.item.kind === 'multiple') {
    worst = { dontKnow: false, key: byLength.slice(0, Math.max(1, n - 1)), chosen: byLength.slice(), forms: [], text: null, again: true };
  } else {
    worst = { dontKnow: false, key: byLength.slice(0, 1), chosen: byLength.slice(1, 2), forms: [], text: null, again: true };
  }
  for (const stage of ['review', 'doubt', 'doubted'] as const) {
    if (visibleLength(reviewOut(v, worst, stage, options).text) > limit) return false;
  }
  return true;
}

// ─────────────────────────────────────────── §4.8: failures and old buttons ───────────────────────────────────────────

/** «Базы данных · 8 из 20» / «Meldy сейчас не отвечает…» with «Повторить» = the same press (the same data, the same answer key). */
export function retryOut(header: string | null, pressData: string): Out {
  return { text: lines(header ? t(header) : null, t(W.DB_DOWN_AGAIN)), keyboard: [row({ text: W.RETRY, data: pressData, style: 'primary' })] };
}

/** «Экзамен «Осенняя сессия» больше недоступен — занятие закрыто.» */
export function examGoneOut(title: string): Out {
  return { text: t(W.examGone(oneLine(title))), keyboard: null };
}

/** The old message after the session moved under a new /today card and could not be deleted (I3). */
export function movedOut(): Out {
  return { text: t(S.moved), keyboard: null };
}

/** The student's own words inside a question view (for the linter). */
export function userWords(v: QuestionView, shown?: Shown | null): string[] {
  const item = v.item;
  const stem = stemParts(item.stem, item.code);
  const words = [v.subject, oneLine(v.subject), item.stem, stem.before, stem.after, ...item.options, ...item.options.map(oneLine), ...item.options.map(optionLabel)];
  if (item.topicTitle) words.push(item.topicTitle, oneLine(item.topicTitle));
  if (shown) {
    words.push(...shown.forms, ...shown.forms.map(oneLine));
    if (shown.text) words.push(shown.text, oneLine(shown.text), typedShown(oneLine(shown.text)));
    const layout = layoutOf(item);
    if (layout.mode === 'buttons') {
      const labels = (indices: number[]) => indices.map((i) => optionLabel(item.options[i])).join(', ');
      words.push(labels(shown.key), labels(shown.chosen));
    }
  }
  return words.filter((w) => typeof w === 'string' && w.trim() !== '');
}
