/**
 * «Студия теста»: the test document as pure functions (plan docs/superpowers/plans/2026-10-18-studio.md, «Doc library»;
 * the shape is types/testDoc.ts). A new document and new blocks, the server's check mirrored (meldy_private.test_doc_ok:
 * the same rule names, first broken rule first), a raw document made safe to show, and the question blocks kept in step
 * with the exam's questions.
 *
 * Question blocks only point at test_items rows. A row deleted elsewhere leaves its block «dangling»: the canvas shows
 * it as gone, the checker offers to remove it, and `withoutDangling` drops it before a save (the server refuses a
 * document that points at a row it does not have). New questions made from text or a template sit in the document
 * under their import ref (`item_id` = the ItemInput's ref) until container_items_add answers; `bindRefs` puts the ids in.
 */
import type { TestItem } from '../../types/container';
import { QUIZ_ACCENTS, type QuizAccent } from '../../types/quiz';
import {
  BLOCK_ID_RE,
  DOC_BLOCK_TYPES,
  DOC_CAPTION_MAX,
  DOC_IMAGE_RE,
  DOC_MAX_BANDS,
  DOC_MAX_BLOCKS,
  DOC_MAX_BYTES,
  DOC_TEXT_MAX,
  DOC_TITLE_MAX,
  DOC_URL_MAX,
  HEX_RE,
  TEST_DOC_VERSION,
  type DocAnswers,
  type DocBackground,
  type DocBlock,
  type DocBlockType,
  type DocButtons,
  type DocDensity,
  type DocFont,
  type DocLayout,
  type DocRadius,
  type DocResults,
  type DocTheme,
  type ResultBand,
  type TestDoc,
} from '../../types/testDoc';

// ─────────────────────────────────────────────── small shared helpers

/** A source of random bytes shaped like crypto.getRandomValues (tests pass a fixed one). */
export type RandomFill = (bytes: Uint8Array) => Uint8Array;
export const cryptoFill: RandomFill = (bytes) => crypto.getRandomValues(bytes);

export type BlockOf<T extends DocBlockType> = Extract<DocBlock, { type: T }>;
/** A block without its id (each type keeps its own fields). */
export type BlockBody = DocBlock extends infer B ? (B extends DocBlock ? Omit<B, 'id'> : never) : never;

export const isObj = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** Characters as the database counts them (code points, not UTF-16 units). */
export const chars = (text: string): number => Array.from(text).length;
export const cut = (text: string, max: number): string => (chars(text) <= max ? text : Array.from(text).slice(0, max).join(''));
/** A one-line field: line breaks (and the spaces around them) become one space. */
export const oneLine = (text: string): string => text.replace(/[ \t]*(?:\r\n?|\n)\s*/g, ' ');

/** Equal as data: the same values under the same keys, in any key order (an undefined field counts as absent). */
export function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a)) return Array.isArray(b) && a.length === b.length && a.every((entry, at) => sameValue(entry, b[at]));
  if (!isObj(a) || !isObj(b)) return false;
  const keys = Object.keys(a).filter((key) => a[key] !== undefined);
  return keys.length === Object.keys(b).filter((key) => b[key] !== undefined).length && keys.every((key) => sameValue(a[key], b[key]));
}

// ─────────────────────────────────────────────── ids

export const BLOCK_ID_LENGTH = 12;
const ID_ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';

/** A block id: 12 characters of [a-z0-9] (BLOCK_ID_RE), from unbiased random bytes. */
export function newId(random: RandomFill = cryptoFill): string {
  let id = '';
  for (let round = 0; round < 64 && id.length < BLOCK_ID_LENGTH; round += 1) {
    for (const byte of random(new Uint8Array(BLOCK_ID_LENGTH * 2))) {
      // 252 = 7 × 36: bytes above it would make the first letters likelier.
      if (byte < 252 && id.length < BLOCK_ID_LENGTH) id += ID_ALPHABET[byte % ID_ALPHABET.length];
    }
  }
  if (id.length < BLOCK_ID_LENGTH) throw new Error('studio: the random source gives no usable bytes');
  return id;
}

/** A new id that is not among `taken` (added to it). */
export function freshId(taken: Set<string>, random: RandomFill = cryptoFill): string {
  let id = newId(random);
  while (taken.has(id)) id = newId(random);
  taken.add(id);
  return id;
}

// ─────────────────────────────────────────────── a new document, new blocks

export const DEFAULT_TITLE = 'Новый тест';
export const DEFAULT_THEME: DocTheme = {
  accent: 'blue',
  background: { kind: 'plain' },
  font: 'onest',
  radius: 'soft',
  density: 'airy',
  answers: 'list',
  buttons: 'pill',
};
export const DEFAULT_LAYOUT: DocLayout = 'one_by_one';

export const LAYOUTS: readonly DocLayout[] = ['one_by_one', 'one_page', 'pages'];
export const FONTS: readonly DocFont[] = ['onest', 'serif', 'mono'];
export const RADII: readonly DocRadius[] = ['soft', 'round', 'square'];
export const DENSITIES: readonly DocDensity[] = ['airy', 'compact'];
export const ANSWER_VIEWS: readonly DocAnswers[] = ['list', 'grid'];
export const BUTTON_SHAPES: readonly DocButtons[] = ['pill', 'rounded', 'square'];
export const DIM_MAX = 80;
export const POINTS_MAX = 100;

const ALIGNS = ['left', 'center'] as const;
const SIZES = ['l', 'm'] as const;
const WIDTHS = ['narrow', 'wide', 'full'] as const;
const TONES = ['info', 'tip', 'warn'] as const;

/** A document with nothing on it yet (the canvas shows the templates and the question types then). */
export function emptyDoc(title: string): TestDoc {
  const clean = cut(oneLine(title).trim(), DOC_TITLE_MAX);
  return {
    v: TEST_DOC_VERSION,
    title: clean || DEFAULT_TITLE,
    theme: { ...DEFAULT_THEME, background: { kind: 'plain' } },
    layout: DEFAULT_LAYOUT,
    blocks: [],
    results: { bands: [], cta: null },
  };
}

/** The words a new block starts with (valid as they are: a block saved untouched is still a good block). */
export const BLOCK_WORDS = {
  cover: 'Название теста',
  heading: 'Заголовок',
  text: 'Текст',
  note: 'Заметка',
} as const;

function blockWith(type: DocBlockType, id: string, itemId: string): DocBlock {
  switch (type) {
    case 'cover':
      return { type, id, title: BLOCK_WORDS.cover, subtitle: '', image: null, align: 'center' };
    case 'heading':
      return { type, id, text: BLOCK_WORDS.heading, size: 'l' };
    case 'text':
      return { type, id, text: BLOCK_WORDS.text, align: 'left' };
    case 'image':
      // The path comes from the upload; until then the block is not savable (docProblems: `image`).
      return { type, id, path: '', caption: '', width: 'wide' };
    case 'note':
      return { type, id, tone: 'info', text: BLOCK_WORDS.note };
    case 'divider':
      return { type, id };
    case 'page':
      return { type, id, title: '' };
    case 'question':
      return { type, id, item_id: itemId, points: 1, required: false };
  }
}

/** A new block of that type with a fresh id; a question block points at `itemId`. */
export function newBlock<T extends DocBlockType>(type: T, itemId = '', random: RandomFill = cryptoFill): BlockOf<T> {
  return blockWith(type, newId(random), itemId) as BlockOf<T>;
}

// ─────────────────────────────────────────────── the server's check, mirrored

/** jsonb's text as Postgres prints it (`{"a": 1, "b": [1, 2]}`): the table keeps octet_length(doc::text) ≤ 200 KB. */
export function jsonbTextBytes(value: unknown): number {
  const json = JSON.stringify(value);
  if (json === undefined) return 0;
  return new TextEncoder().encode(json).length + separators(value);
}

function separators(value: unknown): number {
  if (Array.isArray(value)) return value.reduce<number>((sum, entry) => sum + separators(entry), Math.max(0, value.length - 1));
  if (!isObj(value)) return 0;
  const kept = Object.values(value).filter((entry) => entry !== undefined && typeof entry !== 'function');
  // «: » after each key, «, » between members.
  return kept.reduce<number>((sum, entry) => sum + separators(entry), kept.length + Math.max(0, kept.length - 1));
}

const isText = (value: unknown, max: number, min = 1): value is string =>
  typeof value === 'string' && chars(value) <= max && (min === 0 || value.trim().length > 0);
const isInt = (value: unknown, lo: number, hi: number): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= lo && value <= hi;
const oneOf = <T extends string>(list: readonly T[], value: unknown): value is T => typeof value === 'string' && (list as readonly string[]).includes(value);

/** An image path of the bucket (and of this exam's folder when the exam is known). */
export function imageOk(path: unknown, containerId?: string): path is string {
  return typeof path === 'string' && DOC_IMAGE_RE.test(path) && (!containerId || path.startsWith(`${containerId.toLowerCase()}/`));
}

const HTTPS_RE = /^https:\/\/[^\s]+$/;
export const urlOk = (url: unknown): url is string => typeof url === 'string' && HTTPS_RE.test(url) && chars(url) <= DOC_URL_MAX;

function accentOk(accent: unknown): boolean {
  if (oneOf(QUIZ_ACCENTS, accent)) return true;
  return isObj(accent) && typeof accent.custom === 'string' && HEX_RE.test(accent.custom);
}

function backgroundOk(background: unknown, containerId?: string): boolean {
  if (!isObj(background)) return false;
  if (background.kind === 'plain') return true;
  if (background.kind === 'soft') return oneOf(QUIZ_ACCENTS, background.tone);
  return background.kind === 'image' && imageOk(background.path, containerId) && isInt(background.dim, 0, DIM_MAX);
}

function themeOk(theme: unknown, containerId?: string): boolean {
  return (
    isObj(theme) &&
    accentOk(theme.accent) &&
    backgroundOk(theme.background, containerId) &&
    oneOf(FONTS, theme.font) &&
    oneOf(RADII, theme.radius) &&
    oneOf(DENSITIES, theme.density) &&
    oneOf(ANSWER_VIEWS, theme.answers) &&
    oneOf(BUTTON_SHAPES, theme.buttons)
  );
}

function bandOk(band: unknown, containerId?: string): band is ResultBand {
  return (
    isObj(band) &&
    isInt(band.from, 0, 100) &&
    isInt(band.to, band.from, 100) &&
    isText(band.title, DOC_TITLE_MAX) &&
    isText(band.text, DOC_TEXT_MAX, 0) &&
    (band.image === null || imageOk(band.image, containerId))
  );
}

function resultsOk(results: unknown, containerId?: string): boolean {
  if (!isObj(results) || !Array.isArray(results.bands) || results.bands.length > DOC_MAX_BANDS) return false;
  const bands: ResultBand[] = [];
  for (const band of results.bands) {
    if (!bandOk(band, containerId)) return false;
    bands.push(band);
  }
  const sorted = [...bands].sort((a, b) => a.from - b.from);
  for (let at = 1; at < sorted.length; at += 1) if (sorted[at].from <= sorted[at - 1].to) return false;
  const cta = results.cta;
  return cta === null || (isObj(cta) && isText(cta.label, DOC_TITLE_MAX) && urlOk(cta.url));
}

interface BlockScope {
  ids: Set<string>;
  items: Set<string>;
  onPage: Set<string>;
  containerId?: string;
}

/** The first broken rule of one block, or null. */
function blockRule(block: unknown, scope: BlockScope): string | null {
  if (!isObj(block) || !oneOf(DOC_BLOCK_TYPES, block.type)) return 'type';
  if (typeof block.id !== 'string' || !BLOCK_ID_RE.test(block.id) || scope.ids.has(block.id)) return 'id';
  scope.ids.add(block.id);
  switch (block.type) {
    case 'cover':
      if (!isText(block.title, DOC_TITLE_MAX)) return 'title';
      if (!isText(block.subtitle, DOC_CAPTION_MAX, 0)) return 'subtitle';
      if (block.image !== null && !imageOk(block.image, scope.containerId)) return 'image';
      return oneOf(ALIGNS, block.align) ? null : 'align';
    case 'heading':
      if (!isText(block.text, DOC_TITLE_MAX)) return 'text';
      return oneOf(SIZES, block.size) ? null : 'size';
    case 'text':
      if (!isText(block.text, DOC_TEXT_MAX)) return 'text';
      return oneOf(ALIGNS, block.align) ? null : 'align';
    case 'image':
      if (!imageOk(block.path, scope.containerId)) return 'image';
      if (!isText(block.caption, DOC_CAPTION_MAX, 0)) return 'caption';
      return oneOf(WIDTHS, block.width) ? null : 'width';
    case 'note':
      if (!oneOf(TONES, block.tone)) return 'tone';
      return isText(block.text, DOC_TEXT_MAX) ? null : 'text';
    case 'divider':
      return null;
    case 'page':
      return isText(block.title, DOC_TITLE_MAX, 0) ? null : 'title';
    case 'question': {
      if (typeof block.item_id !== 'string' || !scope.items.has(block.item_id)) return 'item';
      if (scope.onPage.has(block.item_id)) return 'duplicate_item';
      scope.onPage.add(block.item_id);
      if (!isInt(block.points, 1, POINTS_MAX)) return 'points';
      return typeof block.required === 'boolean' ? null : 'required';
    }
  }
}

/**
 * What meldy_private.test_doc_ok would refuse, in its order: `version`, `title`, `theme`, `layout`, `blocks`,
 * `block:<n>:<rule>` (n from 1; one rule per block: `type`, `id`, `title`, `subtitle`, `image`, `align`, `text`, `size`,
 * `caption`, `width`, `tone`, `item`, `duplicate_item`, `points`, `required`), `results`. The first entry is the name
 * the server answers with (22023); [] — the server takes it. One more name the function itself never gives: `size`, the
 * table's CHECK (octet_length(doc::text) ≤ 200 KB). `containerId` adds the rule that pictures live in the exam's folder.
 */
export function docProblems(doc: unknown, itemIds: Iterable<string>, containerId?: string): string[] {
  if (!isObj(doc)) return ['version'];
  const problems: string[] = [];
  if (doc.v !== TEST_DOC_VERSION) problems.push('version');
  if (!isText(doc.title, DOC_TITLE_MAX)) problems.push('title');
  if (!themeOk(doc.theme, containerId)) problems.push('theme');
  if (!oneOf(LAYOUTS, doc.layout)) problems.push('layout');
  if (!Array.isArray(doc.blocks) || doc.blocks.length > DOC_MAX_BLOCKS) problems.push('blocks');
  else {
    const scope: BlockScope = { ids: new Set(), items: new Set(itemIds), onPage: new Set(), containerId };
    doc.blocks.forEach((block, index) => {
      const rule = blockRule(block, scope);
      if (rule) problems.push(`block:${index + 1}:${rule}`);
    });
  }
  if (!resultsOk(doc.results, containerId)) problems.push('results');
  if (jsonbTextBytes(doc) > DOC_MAX_BYTES) problems.push('size');
  return problems;
}

/** A rule name in plain words, for the line under the canvas when a save is refused. */
export function ruleMessage(rule: string): string {
  const block = /^block:(\d+):([a-z_]+)$/.exec(rule);
  if (block) {
    const at = `Блок ${block[1]}: `;
    switch (block[2]) {
      case 'type':
      case 'id':
        return `${at}сломан — удалите его и добавьте заново.`;
      case 'text':
        return `${at}текст пустой или слишком длинный — поправьте его.`;
      case 'title':
        return `${at}заголовок пустой или длиннее 200 знаков — поправьте его.`;
      case 'subtitle':
      case 'caption':
        return `${at}подпись длиннее 300 знаков — сократите её.`;
      case 'image':
        return `${at}картинка не загружена — загрузите её заново.`;
      case 'item':
        return `${at}этого вопроса больше нет — уберите блок.`;
      case 'duplicate_item':
        return `${at}этот вопрос уже есть на странице — уберите копию.`;
      case 'points':
        return `${at}баллы — целое число от 1 до 100.`;
      default:
        return `${at}настройки заданы неверно — выберите их заново.`;
    }
  }
  switch (rule) {
    case 'version':
      return 'Тест сохранён в другой версии — обновите страницу.';
    case 'title':
      return 'Название теста пустое или длиннее 200 знаков — поправьте его.';
    case 'theme':
      return 'Оформление задано неверно — выберите его заново.';
    case 'layout':
      return 'Не выбрано, как проходить тест, — выберите в «Оформлении».';
    case 'blocks':
      return 'Блоков больше 400 — уберите лишние.';
    case 'results':
      return 'Экран результата задан неверно — проверьте диапазоны баллов и ссылку.';
    case 'size':
      return 'Тест больше 200 КБ — сократите тексты или уберите блоки.';
    default:
      return 'Тест не сохранился — обновите страницу.';
  }
}

// ─────────────────────────────────────────────── a raw document made safe

const str = (value: unknown): string => (typeof value === 'string' ? value : '');
const clampInt = (value: unknown, lo: number, hi: number, fallback: number): number =>
  typeof value === 'number' && Number.isFinite(value) ? Math.min(hi, Math.max(lo, Math.round(value))) : fallback;
const pick = <T extends string>(list: readonly T[], value: unknown, fallback: T): T => (oneOf(list, value) ? value : fallback);
const line = (value: unknown, max: number): string => cut(oneLine(str(value)), max);
const filled = (text: string) => text.trim().length > 0;

function accentOf(value: unknown): DocTheme['accent'] {
  if (oneOf(QUIZ_ACCENTS, value)) return value;
  if (isObj(value) && typeof value.custom === 'string' && HEX_RE.test(value.custom.toLowerCase())) return { custom: value.custom.toLowerCase() };
  return DEFAULT_THEME.accent;
}

function backgroundOf(value: unknown): DocBackground {
  if (isObj(value) && value.kind === 'soft') return { kind: 'soft', tone: pick<QuizAccent>(QUIZ_ACCENTS, value.tone, 'blue') };
  if (isObj(value) && value.kind === 'image' && imageOk(value.path)) return { kind: 'image', path: value.path, dim: clampInt(value.dim, 0, DIM_MAX, 40) };
  return { kind: 'plain' };
}

export function normalizeTheme(value: unknown): DocTheme {
  const theme = isObj(value) ? value : {};
  return {
    accent: accentOf(theme.accent),
    background: backgroundOf(theme.background),
    font: pick(FONTS, theme.font, DEFAULT_THEME.font),
    radius: pick(RADII, theme.radius, DEFAULT_THEME.radius),
    density: pick(DENSITIES, theme.density, DEFAULT_THEME.density),
    answers: pick(ANSWER_VIEWS, theme.answers, DEFAULT_THEME.answers),
    buttons: pick(BUTTON_SHAPES, theme.buttons, DEFAULT_THEME.buttons),
  };
}

/** One raw block without its id: null when it cannot be kept (unknown type, no words where words are needed). */
function blockBody(raw: Record<string, unknown>, title: string, onPage: Set<string>): BlockBody | null {
  switch (raw.type) {
    case 'cover': {
      const cover = line(raw.title, DOC_TITLE_MAX);
      return {
        type: 'cover',
        title: filled(cover) ? cover : title,
        subtitle: line(raw.subtitle, DOC_CAPTION_MAX),
        image: imageOk(raw.image) ? raw.image : null,
        align: pick(ALIGNS, raw.align, 'center'),
      };
    }
    case 'heading': {
      const text = line(raw.text, DOC_TITLE_MAX);
      return filled(text) ? { type: 'heading', text, size: pick(SIZES, raw.size, 'l') } : null;
    }
    case 'text': {
      const text = cut(str(raw.text), DOC_TEXT_MAX);
      return filled(text) ? { type: 'text', text, align: pick(ALIGNS, raw.align, 'left') } : null;
    }
    case 'image':
      return imageOk(raw.path) ? { type: 'image', path: raw.path, caption: line(raw.caption, DOC_CAPTION_MAX), width: pick(WIDTHS, raw.width, 'wide') } : null;
    case 'note': {
      const text = cut(str(raw.text), DOC_TEXT_MAX);
      return filled(text) ? { type: 'note', tone: pick(TONES, raw.tone, 'info'), text } : null;
    }
    case 'divider':
      return { type: 'divider' };
    case 'page':
      return { type: 'page', title: line(raw.title, DOC_TITLE_MAX) };
    case 'question': {
      const itemId = str(raw.item_id);
      if (!itemId || onPage.has(itemId)) return null;
      onPage.add(itemId);
      return { type: 'question', item_id: itemId, points: clampInt(raw.points, 1, POINTS_MAX, 1), required: raw.required === true };
    }
    default:
      return null;
  }
}

function resultsOf(value: unknown): DocResults {
  const results = isObj(value) ? value : {};
  const bands: ResultBand[] = [];
  for (const raw of Array.isArray(results.bands) ? results.bands : []) {
    if (!isObj(raw)) continue;
    const title = line(raw.title, DOC_TITLE_MAX);
    if (!filled(title)) continue;
    const a = clampInt(raw.from, 0, 100, 0);
    const b = clampInt(raw.to, 0, 100, 100);
    bands.push({ from: Math.min(a, b), to: Math.max(a, b), title, text: cut(str(raw.text), DOC_TEXT_MAX), image: imageOk(raw.image) ? raw.image : null });
  }
  bands.sort((a, b) => a.from - b.from);
  const kept: ResultBand[] = [];
  for (const band of bands) {
    if (kept.length < DOC_MAX_BANDS && (kept.length === 0 || band.from > kept[kept.length - 1].to)) kept.push(band);
  }
  const cta = isObj(results.cta) ? results.cta : null;
  const label = cta ? line(cta.label, DOC_TITLE_MAX) : '';
  return { bands: kept, cta: cta && filled(label) && urlOk(cta.url) ? { label, url: cta.url } : null };
}

export interface NormalizedDoc {
  doc: TestDoc;
  /** Ids of question blocks whose row is not among `itemIds` (kept on the page, shown as gone). */
  dangling: string[];
}

/**
 * Any stored or pasted document made into a TestDoc the canvas can show: unknown fields dropped, broken values set to
 * their defaults, one-line fields (titles, captions, the cover's subtitle, a band's title, the link's words) on one
 * line, blocks without words or without a picture dropped, repeated or bad block ids renewed, a question shown at most
 * once, result bands sorted without overlaps. The result passes docProblems except for dangling question blocks,
 * which stay (listed in `dangling` when `itemIds` is given), pictures of another exam's folder (only the bucket's
 * pattern is known here) and the 200 KB size. Normalising twice changes nothing more.
 */
export function normalizeDoc(raw: unknown, itemIds?: Iterable<string>, random: RandomFill = cryptoFill): NormalizedDoc {
  const source = isObj(raw) ? raw : {};
  const title = line(source.title, DOC_TITLE_MAX);
  const docTitle = filled(title) ? title : DEFAULT_TITLE;
  const ids = new Set<string>();
  const onPage = new Set<string>();
  const blocks: DocBlock[] = [];
  for (const entry of Array.isArray(source.blocks) ? source.blocks : []) {
    if (blocks.length >= DOC_MAX_BLOCKS) break;
    if (!isObj(entry)) continue;
    const body = blockBody(entry, docTitle, onPage);
    if (!body) continue;
    const kept = typeof entry.id === 'string' && BLOCK_ID_RE.test(entry.id) && !ids.has(entry.id);
    const id = kept ? (entry.id as string) : freshId(ids, random);
    ids.add(id);
    // Keys in the order the types list them (type, id, the fields).
    const { type, ...fields } = body;
    blocks.push({ type, id, ...fields } as DocBlock);
  }
  const doc: TestDoc = {
    v: TEST_DOC_VERSION,
    title: docTitle,
    theme: normalizeTheme(source.theme),
    layout: pick(LAYOUTS, source.layout, DEFAULT_LAYOUT),
    blocks,
    results: resultsOf(source.results),
  };
  const known = itemIds ? new Set(itemIds) : null;
  const dangling = known ? blocks.filter((block) => block.type === 'question' && !known.has(block.item_id)).map((block) => block.id) : [];
  return { doc, dangling };
}

// ─────────────────────────────────────────────── the page and the exam's questions

/** The question rows on the page, in page order. */
export function questionIds(doc: TestDoc): string[] {
  const ids: string[] = [];
  for (const block of doc.blocks) if (block.type === 'question') ids.push(block.item_id);
  return ids;
}

/**
 * The exam's questions that are not on the page yet, appended as question blocks at the end (a question added in
 * «Список» or by an import shows up on the canvas), in the order given, while the page has room (DOC_MAX_BLOCKS).
 * The same document back when nothing is missing.
 */
export function syncQuestions(doc: TestDoc, items: readonly Pick<TestItem, 'id'>[], random: RandomFill = cryptoFill): TestDoc {
  const onPage = new Set(questionIds(doc));
  const ids = new Set(doc.blocks.map((block) => block.id));
  const added: DocBlock[] = [];
  for (const item of items) {
    if (onPage.has(item.id) || doc.blocks.length + added.length >= DOC_MAX_BLOCKS) continue;
    onPage.add(item.id);
    added.push(blockWith('question', freshId(ids, random), item.id));
  }
  return added.length === 0 ? doc : { ...doc, blocks: [...doc.blocks, ...added] };
}

/** The ids of question blocks whose row is not among `itemIds`. */
export function danglingBlocks(doc: TestDoc, itemIds: Iterable<string>): string[] {
  const known = new Set(itemIds);
  return doc.blocks.filter((block) => block.type === 'question' && !known.has(block.item_id)).map((block) => block.id);
}

/** The document without question blocks whose row is gone — what a save sends. The same document when there are none. */
export function withoutDangling(doc: TestDoc, itemIds: Iterable<string>): TestDoc {
  const gone = new Set(danglingBlocks(doc, itemIds));
  return gone.size === 0 ? doc : { ...doc, blocks: doc.blocks.filter((block) => !gone.has(block.id)) };
}

/** New questions saved: each question block that held an import ref gets the row's id (container_items_add's answer). */
export function bindRefs(doc: TestDoc, added: ReadonlyArray<{ ref: string; id: string }>): TestDoc {
  const ids = new Map(added.map((entry) => [entry.ref, entry.id]));
  let changed = false;
  const blocks = doc.blocks.map((block) => {
    const id = block.type === 'question' ? ids.get(block.item_id) : undefined;
    if (block.type !== 'question' || id === undefined) return block;
    changed = true;
    return { ...block, item_id: id };
  });
  return changed ? { ...doc, blocks } : doc;
}

// ─────────────────────────────────────────────── block edits (the canvas's moves, pure)

export function findBlock(doc: TestDoc, id: string): DocBlock | null {
  return doc.blocks.find((block) => block.id === id) ?? null;
}

/** `block` put at `index` (0 = first; past the end or omitted = last). */
export function insertBlock(doc: TestDoc, block: DocBlock, index = doc.blocks.length): TestDoc {
  const at = Math.max(0, Math.min(doc.blocks.length, Math.trunc(index)));
  return { ...doc, blocks: [...doc.blocks.slice(0, at), block, ...doc.blocks.slice(at)] };
}

export function removeBlock(doc: TestDoc, id: string): TestDoc {
  const blocks = doc.blocks.filter((block) => block.id !== id);
  return blocks.length === doc.blocks.length ? doc : { ...doc, blocks };
}

/** The block moved to `index` of the page as it is after the move (clamped); the same document when it does not move. */
export function moveBlock(doc: TestDoc, id: string, index: number): TestDoc {
  const from = doc.blocks.findIndex((block) => block.id === id);
  if (from < 0) return doc;
  const rest = doc.blocks.filter((block) => block.id !== id);
  const to = Math.max(0, Math.min(rest.length, Math.trunc(index)));
  if (to === from) return doc;
  return { ...doc, blocks: [...rest.slice(0, to), doc.blocks[from], ...rest.slice(to)] };
}

/** The block replaced by `block` (same id); the same document when it is not there or nothing changed. */
export function replaceBlock(doc: TestDoc, block: DocBlock): TestDoc {
  const at = doc.blocks.findIndex((entry) => entry.id === block.id);
  if (at < 0 || sameValue(doc.blocks[at], block)) return doc;
  const blocks = [...doc.blocks];
  blocks[at] = block;
  return { ...doc, blocks };
}

/**
 * «Копия»: the block copied right after itself with a new id. Not for a question block (a question is on the page once:
 * the canvas copies the row first, then inserts newBlock('question', newRowId)) — the same document then.
 */
export function duplicateBlock(doc: TestDoc, id: string, random: RandomFill = cryptoFill): TestDoc {
  const at = doc.blocks.findIndex((block) => block.id === id);
  if (at < 0 || doc.blocks[at].type === 'question' || doc.blocks.length >= DOC_MAX_BLOCKS) return doc;
  const copy = { ...doc.blocks[at], id: freshId(new Set(doc.blocks.map((block) => block.id)), random) } as DocBlock;
  return insertBlock(doc, copy, at + 1);
}
