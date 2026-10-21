/**
 * «Проверка теста»: what is wrong with the test or worth a second look, in plain words that say what to do, each with
 * the block and question it is about, and, when one press can mend it, a `fix` — plain data the canvas applies with
 * `applyFix` (the document's change, the rows to patch, the rows to delete). Pure; the key never leaves the author's
 * page (the checker reads the author's own rows).
 *
 * Levels: 'fix' — the participant would meet a broken or unfair question; 'think' — a pattern worth a look, the author
 * decides.
 */
import { PICTURE_STEM, isPictureWord, type ItemPatch, type TestItem } from '../../types/container';
import type { DocTheme, QuestionBlock, TestDoc } from '../../types/testDoc';
import { draftOf, patchOf, removeOption, LIMITS } from '../../components/containers/keys/editorModel';
import { optionName, shortNorm } from '../../components/containers/model';
import { letter, plural } from '../../components/containers/copyImport';
import { contrast, readableAccent } from './contrast';
import { BLOCK_WORDS, DEFAULT_TITLE, chars, removeBlock } from './doc';
import { STUDIO_PASTE } from '../../components/quick/copyQuick';

export type Fix =
  /** The options are shown in the file's order (container_item_update keep_order). */
  | { kind: 'keep_order'; itemId: string }
  /** One of two equal options removed (its picture and its tick with it). */
  | { kind: 'drop_option'; itemId: string; index: number }
  /** More accepted forms of a short answer. */
  | { kind: 'add_forms'; itemId: string; forms: string[] }
  /** A repeated question: its row deleted and its block taken off the page. */
  | { kind: 'delete_question'; itemId: string; blockId: string }
  /** A block taken off the page (an empty page, a question whose row is gone). */
  | { kind: 'remove_block'; blockId: string }
  /** The theme's accent set to this one. */
  | { kind: 'theme_accent'; value: DocTheme['accent'] }
  /** The question's kind made to fit its key: one answer, or several. */
  | { kind: 'set_kind'; itemId: string; value: 'single' | 'multiple' };

export type HintLevel = 'fix' | 'think';

export interface Hint {
  /** Stable while the problem stays: «no_key:<item id>», «letter», … */
  id: string;
  blockId?: string;
  itemId?: string;
  level: HintLevel;
  message: string;
  fix?: Fix;
}

/** Options that point at other options («все перечисленные», «нет верного», «а и б»): shuffled, they lie. */
const ORDER_WORDS =
  /^(?:все\s+(?:выше)?(?:перечисленн|указанн|названн)|все\s+выше|все\s+(?:ответы|варианты)\s+(?:верн|правильн)|ни\s+один|ни\s+одно|ничего\s+из|нет\s+(?:верн|правильн)|оба(?:\s|$)|[а-е]\s*(?:и|,)\s*[а-е](?:\s*(?:и|,)\s*[а-е])*$|(?:первый|второй|третий)\s+и\s+)/;

/** The option (file index) that only makes sense in its place, or -1. */
export function orderBound(options: readonly string[]): number {
  return options.findIndex((option) => ORDER_WORDS.test(shortNorm(option)));
}

const TRUE_FALSE: ReadonlyArray<readonly [string, string]> = [
  ['верно', 'неверно'],
  ['да', 'нет'],
  ['правда', 'ложь'],
  ['истина', 'ложь'],
];

/** Two options that are «верно / неверно», «да / нет» … in either order. */
export function isTrueFalse(options: readonly string[]): boolean {
  if (options.length !== 2) return false;
  const pair = options.map(shortNorm).sort();
  return TRUE_FALSE.some((words) => {
    const sorted = [...words].sort();
    return pair[0] === sorted[0] && pair[1] === sorted[1];
  });
}

/** Other ways to write a numeric answer: the decimal comma and point swapped, the number without its unit. */
export function numberForms(form: string): string[] {
  const text = form.trim();
  const out: string[] = [];
  if (/\d,\d/.test(text)) out.push(text.replace(/(\d),(\d)/g, '$1.$2'));
  else if (/\d\.\d/.test(text)) out.push(text.replace(/(\d)\.(\d)/g, '$1,$2'));
  // Each differs from the form (a mark swapped, the unit gone) and from the other.
  const unit = /^(-?\d+(?:[.,]\d+)?)\s*[^\d\s.,].*$/.exec(text);
  if (unit) out.push(unit[1]);
  return out;
}

/**
 * The words a question new from the studio's palette starts with (container_items_add needs a valid row: a stem,
 * 2–8 options, a short answer's form). Until the author writes their own, the checker says so.
 */
export const DRAFT_WORDS = {
  stem: 'Новый вопрос',
  statement: 'Новое утверждение',
  option: (n: number) => `Вариант ${n}`,
  form: 'ответ',
} as const;

const DRAFT_OPTION = /^Вариант \d{1,2}$/;

/** The question still holds the palette's words: its stem, all its options or its only form. */
export function isDraftQuestion(item: Pick<TestItem, 'kind' | 'stem' | 'options' | 'answers'>): boolean {
  const stem = item.stem.trim();
  if (stem === DRAFT_WORDS.stem || stem === DRAFT_WORDS.statement) return true;
  if (item.kind === 'short') return item.answers.length === 1 && item.answers[0].trim() === DRAFT_WORDS.form;
  return item.options.length > 0 && item.options.every((option) => DRAFT_OPTION.test(option.trim()));
}

/** Words that ask for several answers in a one-answer question. */
const SEVERAL_WORDS = /(?:отметьте|выберите|укажите)\s+все|все\s+(?:верные|правильные)|несколько\s+(?:верных|правильных)?\s*(?:ответ|вариант)/i;

/** A title nobody wrote: empty, the quiz's own «Контрольная · …», or the words a new page starts with. */
export function draftTitle(title: string): boolean {
  const text = title.replace(/\u00a0/g, ' ').trim();
  return !text || /^Контрольная\s+·/.test(text) || text === DEFAULT_TITLE || text === BLOCK_WORDS.cover;
}

const quote = (text: string, index: number) => `«${optionName(text, index)}»`;
const ofQuestions = (n: number) => `${n} ${plural(n, 'вопроса', 'вопросов', 'вопросов')}`;
const keyed = (item: TestItem) => (item.kind === 'short' ? item.answers.length > 0 : item.correct.length > 0);

interface OnPage {
  block: QuestionBlock;
  item: TestItem;
  /** The question's number on the page (from 1). */
  n: number;
  /** The block's place on the page (from 0). */
  at: number;
}

interface Found extends Hint {
  at: number;
}

function questionHints(entry: OnPage, firstByStem: Map<string, OnPage>, out: Found[]): void {
  const { block, item, n, at } = entry;
  const where = { blockId: block.id, itemId: item.id, at };
  const head = `Вопрос ${n}: `;
  const short = item.kind === 'short';

  const pictureOnly = item.stem.trim() === PICTURE_STEM && !(item.images?.stem?.length);
  if (!item.stem.trim() || pictureOnly) out.push({ ...where, id: `no_stem:${item.id}`, level: 'fix', message: `${head}нет текста — напишите его.` });

  // A question still holding the palette's words is one problem, not two: its line also asks for the key.
  const draft = isDraftQuestion(item);
  if (!keyed(item) && !draft) {
    out.push({ ...where, id: `no_key:${item.id}`, level: 'fix', message: `${head}нет верного ответа — ${short ? 'впишите' : 'отметьте'} его.` });
  }

  if (draft) {
    const words = short ? 'напишите вопрос и принятые ответы' : keyed(item) ? 'напишите вопрос и варианты ответа' : 'напишите вопрос и варианты ответа, отметьте верный';
    out.push({ ...where, id: `draft:${item.id}`, level: 'fix', message: `${head}это заготовка — ${words}.` });
  }

  if (item.kind === 'multiple' && item.correct.length === 1 && !isTrueFalse(item.options)) {
    out.push({
      ...where,
      id: `kind:${item.id}`,
      level: 'think',
      message: `${head}выбран тип «несколько ответов», а верный отмечен один — участник будет искать второй. Отметьте остальные верные или сделайте вопрос с одним ответом.`,
      fix: { kind: 'set_kind', itemId: item.id, value: 'single' },
    });
  } else if (item.kind === 'single' && SEVERAL_WORDS.test(item.stem)) {
    out.push({
      ...where,
      id: `kind:${item.id}`,
      level: 'think',
      message: `${head}в тексте просят отметить все верные, а вопрос с одним ответом — участник сможет выбрать только один вариант.`,
      fix: { kind: 'set_kind', itemId: item.id, value: 'multiple' },
    });
  }

  if (!short) {
    const norms = item.options.map((option) => (isPictureWord(option) ? null : shortNorm(option)));
    norms.forEach((norm, later) => {
      const first = norm === null || norm === '' ? -1 : norms.indexOf(norm);
      if (first < 0 || first === later) return;
      // Keep the ticked one of the two.
      const drop = item.correct.includes(later) && !item.correct.includes(first) ? first : later;
      const fix: Fix | undefined = item.options.length > LIMITS.optionsMin ? { kind: 'drop_option', itemId: item.id, index: drop } : undefined;
      out.push({
        ...where,
        id: `same_option:${item.id}:${later}`,
        level: 'fix',
        message: `${head}вариант ${quote(item.options[later], later)} повторяется — уберите лишний.`,
        ...(fix ? { fix } : {}),
      });
    });

    const bound = orderBound(item.options);
    if (!item.keep_order && bound >= 0) {
      out.push({
        ...where,
        id: `order:${item.id}`,
        level: 'fix',
        message: `${head}вариант ${quote(item.options[bound], bound)} при перемешивании может встать первым — закрепите порядок вариантов.`,
        fix: { kind: 'keep_order', itemId: item.id },
      });
    } else if (!item.keep_order && isTrueFalse(item.options)) {
      out.push({
        ...where,
        id: `true_false:${item.id}`,
        level: 'fix',
        message: `${head}варианты ${quote(item.options[0], 0)} и ${quote(item.options[1], 1)} лучше не перемешивать — закрепите их порядок.`,
        fix: { kind: 'keep_order', itemId: item.id },
      });
    }
  }

  if (short && item.answers.length === 1 && /\d/.test(item.answers[0])) {
    const forms = numberForms(item.answers[0]);
    const only = `«${item.answers[0].trim()}»`;
    out.push({
      ...where,
      id: `short_number:${item.id}`,
      level: 'think',
      message:
        forms.length > 0
          ? `${head}единственный ответ ${only} — число. Добавьте и ${forms.length > 1 ? 'другие записи' : 'другую запись'}: ${forms.map((form) => `«${form}»`).join(', ')}.`
          : `${head}единственный ответ ${only} — число. Подумайте, как ещё его могут записать, и добавьте эти записи.`,
      ...(forms.length > 0 ? { fix: { kind: 'add_forms', itemId: item.id, forms } } : {}),
    });
  }

  const stem = shortNorm(item.stem);
  if (!stem || isPictureWord(item.stem)) return;
  const first = firstByStem.get(stem);
  if (!first) {
    firstByStem.set(stem, entry);
    return;
  }
  const answersOf = (row: TestItem) => (row.kind === 'short' ? row.answers : row.options).map(shortNorm).sort();
  const twin = first.item.kind === item.kind && JSON.stringify(answersOf(first.item)) === JSON.stringify(answersOf(item));
  out.push(
    twin
      ? {
          ...where,
          id: `repeat:${item.id}`,
          level: 'fix',
          message: `${head}повторяет вопрос ${first.n} — удалите повтор.`,
          fix: { kind: 'delete_question', itemId: item.id, blockId: block.id },
        }
      : { ...where, id: `repeat:${item.id}`, level: 'think', message: `${head}такой же текст у вопроса ${first.n} — проверьте, не повтор ли это.` },
  );
}

/** «Верный ответ — самый длинный» in most one-answer questions of three options or more. */
function longestHint(questions: readonly OnPage[], out: Found[]): void {
  const eligible = questions.filter(({ item }) => item.kind !== 'short' && item.correct.length === 1 && item.options.length >= 3 && !item.options.some(isPictureWord));
  const hits = eligible.filter(({ item }) => {
    const right = chars(item.options[item.correct[0]]?.trim() ?? '');
    const others = Math.max(...item.options.filter((_, index) => index !== item.correct[0]).map((option) => chars(option.trim())));
    return right >= others * 1.3 && right - others >= 5;
  }).length;
  if (eligible.length >= 4 && hits * 2 > eligible.length) {
    out.push({
      id: 'longest',
      level: 'think',
      at: Number.MAX_SAFE_INTEGER,
      message: `Верный ответ — самый длинный в ${hits} из ${ofQuestions(eligible.length)}: его можно угадать по длине. Допишите неверные варианты.`,
    });
  }
}

/** The key under one letter in most one-answer questions (8 questions or more; «верно / неверно» left out). */
function letterHint(questions: readonly OnPage[], out: Found[]): void {
  const keys = questions
    .filter(({ item }) => item.kind !== 'short' && item.correct.length === 1 && !isTrueFalse(item.options))
    .map(({ item }) => item.correct[0]);
  if (keys.length < 8) return;
  const counts = new Map<number, number>();
  for (const key of keys) counts.set(key, (counts.get(key) ?? 0) + 1);
  const [top, times] = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0];
  if (times * 2 <= keys.length) return;
  out.push({
    id: 'letter',
    level: 'think',
    at: Number.MAX_SAFE_INTEGER,
    message: `Верный ответ почти всегда под буквой «${letter(top)}» — в ${times} из ${ofQuestions(keys.length)}. Поменяйте варианты местами.`,
  });
}

/**
 * Everything the checker sees on the page, problems first ('fix', then 'think'), each group in page order with the
 * hints about the whole test last. `items` are the exam's rows (the author's, with keys).
 */
export function checkTest(doc: TestDoc, items: readonly TestItem[]): Hint[] {
  const rows = new Map(items.map((item) => [item.id, item]));
  const found: Found[] = [];
  const questions: OnPage[] = [];
  doc.blocks.forEach((block, at) => {
    if (block.type !== 'question') return;
    const item = rows.get(block.item_id);
    if (item) questions.push({ block, item, n: questions.length + 1, at });
    else {
      found.push({
        id: `gone:${block.id}`,
        blockId: block.id,
        level: 'fix',
        at,
        message: 'Вопрос этого блока удалён — уберите блок.',
        fix: { kind: 'remove_block', blockId: block.id },
      });
    }
  });

  const firstByStem = new Map<string, OnPage>();
  for (const entry of questions) questionHints(entry, firstByStem, found);

  // A page with blocks but no question cannot be sent: the check says so first (UX audit of 21.10: Word text pasted as
  // paragraphs left no question, and the check said «ничего не нашла»). Questions without their answer have their own
  // hints above.
  if (doc.blocks.length > 0 && !doc.blocks.some((block) => block.type === 'question')) {
    found.push({ id: 'no_keyed', level: 'fix', at: -2, message: STUDIO_PASTE.checkNoKeyed });
  }

  if (doc.layout === 'pages') {
    doc.blocks.forEach((block, at) => {
      const next = doc.blocks[at + 1];
      if (block.type !== 'page' || (next && next.type !== 'page')) return;
      found.push({
        id: `empty_page:${block.id}`,
        blockId: block.id,
        level: 'fix',
        at,
        message: 'Пустая страница — добавьте на неё блоки или удалите её.',
        fix: { kind: 'remove_block', blockId: block.id },
      });
    });
  }

  // A picture block without its picture, a video block without its link: the page is saved without them (useStudio
  // withoutUnfinished), so after a reload they are gone (live check of 47.4: a failed picture vanished unsaid).
  doc.blocks.forEach((block, at) => {
    const empty = block.type === 'image' ? !block.path : block.type === 'video' ? !block.url : false;
    if (!empty) return;
    found.push({
      id: `unfinished:${block.id}`,
      blockId: block.id,
      level: 'fix',
      at,
      message:
        block.type === 'image'
          ? 'Блок «Картинка» без картинки не сохраняется — загрузите её или уберите блок.'
          : 'Блок «Видео» без ссылки не сохраняется — вставьте ссылку или уберите блок.',
      fix: { kind: 'remove_block', blockId: block.id },
    });
  });

  longestHint(questions, found);
  letterHint(questions, found);

  if (draftTitle(doc.title)) {
    const title = doc.title.trim();
    found.push({
      id: 'title',
      level: 'think',
      at: -1,
      message: title
        ? `Название теста «${title}» — черновое: его увидят участники во вкладке браузера и в ссылке. Назовите тест в настройках страницы.`
        : 'У теста нет названия. Назовите его в настройках страницы.',
    });
  }
  doc.blocks.forEach((block, at) => {
    if (block.type !== 'cover' || !draftTitle(block.title)) return;
    found.push({
      id: `cover_title:${block.id}`,
      blockId: block.id,
      level: 'think',
      at,
      message: `Обложка: название «${block.title.trim()}» — заготовка. Напишите, как называется тест.`,
    });
  });

  const accent = doc.theme.accent;
  if (typeof accent !== 'string' && contrast(accent.custom, '#ffffff') < 4.5) {
    found.push({
      id: 'contrast',
      level: 'fix',
      at: Number.MAX_SAFE_INTEGER,
      message: 'Свой цвет слишком светлый: белый текст на кнопках читается плохо. Возьмите чуть темнее.',
      fix: { kind: 'theme_accent', value: { custom: readableAccent(accent.custom, '#ffffff').color } },
    });
  }

  const rank = (hint: Found) => (hint.level === 'fix' ? 0 : 1);
  return found
    .map((hint, order) => ({ hint, order }))
    .sort((a, b) => rank(a.hint) - rank(b.hint) || a.hint.at - b.hint.at || a.order - b.order)
    .map(({ hint: { at: _at, ...hint } }) => hint);
}

export interface FixResult {
  doc: TestDoc;
  /** container_item_update for each. */
  updates: Array<{ id: string; patch: ItemPatch }>;
  /** Rows to delete. */
  removes: string[];
}

/** What one press of «Исправить» changes: the document (the same one when it does not change) and the rows. */
export function applyFix(fix: Fix, doc: TestDoc, items: readonly TestItem[]): FixResult {
  const none: FixResult = { doc, updates: [], removes: [] };
  switch (fix.kind) {
    case 'remove_block':
      return { ...none, doc: removeBlock(doc, fix.blockId) };
    case 'theme_accent':
      return { ...none, doc: { ...doc, theme: { ...doc.theme, accent: fix.value } } };
    case 'delete_question':
      return items.some((item) => item.id === fix.itemId) ? { doc: removeBlock(doc, fix.blockId), updates: [], removes: [fix.itemId] } : none;
  }
  const item = items.find((entry) => entry.id === fix.itemId);
  if (!item) return none;
  let patch: ItemPatch | null = null;
  if (fix.kind === 'keep_order') patch = item.keep_order ? null : { keep_order: true };
  else if (fix.kind === 'set_kind') {
    const fits = fix.value === 'single' ? item.kind === 'multiple' && item.correct.length <= 1 : item.kind === 'single';
    patch = fits ? { kind: fix.value } : null;
  } else if (fix.kind === 'drop_option') {
    patch = item.kind !== 'short' && fix.index >= 0 && fix.index < item.options.length ? patchOf(item, removeOption(draftOf(item), fix.index)) : null;
  } else {
    const known = new Set(item.answers.map(shortNorm));
    const added = fix.forms.filter((form) => {
      const norm = shortNorm(form);
      if (!norm || known.has(norm)) return false;
      known.add(norm);
      return true;
    });
    const answers = [...item.answers, ...added].slice(0, LIMITS.forms);
    patch = item.kind === 'short' && answers.length > item.answers.length ? { answers } : null;
  }
  return patch ? { ...none, updates: [{ id: item.id, patch }] } : none;
}
