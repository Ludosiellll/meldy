import {
  SCENE_ICONS,
  type ChartPoint,
  type CompareSide,
  type ConversationContext,
  type ConversationLine,
  type DiagramEdge,
  type DiagramNode,
  type FormulaLegendItem,
  type OutlineItem,
  type PodcastLine,
  type Provenance,
  type SceneIcon,
  type TimelineEvent,
  type Visual,
  type VisualOrigin,
} from './types';
import { chartSourceIds, timelineSourceIds } from './grounding';

/* ────────────────────────────────────────────────────────────────────────────
 * Ограничения (зеркало серверной проверки)
 * ──────────────────────────────────────────────────────────────────────────── */

export const VISUAL_LIMITS = {
  title: 80,
  label: 80,
  item: 120,
  text: 280,
  latex: 200,
  unit: 24,
  nodeId: 40,
} as const;

const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;

/** Обрезает строку до max символов, по возможности по границе слова. */
export function truncateText(value: string, max: number): string {
  if (value.length <= max) return value;
  const hard = value.slice(0, Math.max(1, max - 1));
  const lastSpace = hard.lastIndexOf(' ');
  const cut = lastSpace >= hard.length - 24 && lastSpace > max / 2 ? hard.slice(0, lastSpace) : hard;
  return `${cut.replace(/[\s,.;:–—-]+$/u, '')}…`;
}

function cleanText(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  const text = value.replace(CONTROL_CHARS, '').replace(/\s+/g, ' ').trim();
  if (!text) return null;
  return truncateText(text, max);
}

function cleanList(value: unknown, min: number, max: number, itemMax: number): string[] | null {
  if (!Array.isArray(value)) return null;
  const items = value
    .map(item => cleanText(item, itemMax))
    .filter((item): item is string => item !== null)
    .slice(0, max);
  return items.length >= min ? items : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Конечное число или простая числовая строка («12,5», «40%», «12 500»), как на сервере.
 * «12,500» и «1,234,567» — разделители тысяч; одна запятая в остальных случаях — десятичная.
 */
export function toFiniteNumber(value: unknown): number | null {
  let parsed: number;
  if (typeof value === 'number') {
    parsed = value;
  } else if (typeof value === 'string') {
    let cleaned = value.trim().replace(/[\s\u00a0\u202f]/g, '');
    if (cleaned.endsWith('%')) cleaned = cleaned.slice(0, -1);
    cleaned = /^[-+]?\d{1,3}(,\d{3})+$/.test(cleaned) ? cleaned.replace(/,/g, '') : cleaned.replace(',', '.');
    if (!/^[-+]?(\d+(\.\d*)?|\.\d+)([eE][-+]?\d+)?$/.test(cleaned)) return null;
    parsed = Number(cleaned);
  } else {
    return null;
  }
  return Number.isFinite(parsed) && Math.abs(parsed) <= 1e15 ? parsed : null;
}

function cleanLatex(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  let latex = value.replace(CONTROL_CHARS, '').trim();
  for (const [open, close] of [['$$', '$$'], ['\\[', '\\]'], ['\\(', '\\)'], ['$', '$']] as const) {
    if (latex.length >= open.length + close.length && latex.startsWith(open) && latex.endsWith(close)) {
      latex = latex.slice(open.length, latex.length - close.length).trim();
      break;
    }
  }
  // Неэкранированный % в KaTeX начинает комментарий и молча обрезает формулу.
  latex = latex.replace(/\s+/g, ' ').replace(/\\?%/g, match => (match === '%' ? '\\%' : match));
  // Обрезанная формула превращается в бессмыслицу, поэтому длинную не показываем.
  return latex && latex.length <= VISUAL_LIMITS.latex ? latex : null;
}

function lowerKey(value: unknown): string {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function cleanCompareSide(value: unknown): CompareSide | null {
  if (!isRecord(value)) return null;
  const label = cleanText(value.label, VISUAL_LIMITS.label);
  const points = cleanList(value.points, 1, 4, VISUAL_LIMITS.item);
  if (!label || !points) return null;
  return { label, points };
}

const SCENE_ICON_SET = new Set<string>(SCENE_ICONS);

/**
 * Проверяет изображение из ответа модели. Возвращает чистую копию без лишних
 * ключей или null, если изображение показать нельзя (тогда реплика остаётся,
 * а пропадает только изображение).
 */
export function sanitizeVisual(raw: unknown): Visual | null {
  if (!isRecord(raw)) return null;

  switch (lowerKey(raw.type)) {
    case 'term': {
      const term = cleanText(raw.term, VISUAL_LIMITS.title);
      const definition = cleanText(raw.definition, VISUAL_LIMITS.text);
      return term && definition ? { type: 'term', term, definition } : null;
    }

    case 'steps': {
      const title = cleanText(raw.title, VISUAL_LIMITS.title);
      const items = cleanList(raw.items, 2, 6, VISUAL_LIMITS.item);
      return title && items ? { type: 'steps', title, items } : null;
    }

    case 'compare': {
      const title = cleanText(raw.title, VISUAL_LIMITS.title);
      const left = cleanCompareSide(raw.left);
      const right = cleanCompareSide(raw.right);
      return title && left && right ? { type: 'compare', title, left, right } : null;
    }

    case 'formula': {
      const title = cleanText(raw.title, VISUAL_LIMITS.title);
      const latex = cleanLatex(raw.latex);
      if (!title || !latex) return null;
      const visual: Visual = { type: 'formula', title, latex };
      if (Array.isArray(raw.legend)) {
        const legend = raw.legend
          .map((item): FormulaLegendItem | null => {
            if (!isRecord(item)) return null;
            const symbol = cleanText(item.symbol, VISUAL_LIMITS.title);
            const meaning = cleanText(item.meaning, VISUAL_LIMITS.item);
            return symbol && meaning ? { symbol, meaning } : null;
          })
          .filter((item): item is FormulaLegendItem => item !== null)
          .slice(0, 5);
        if (legend.length > 0) visual.legend = legend;
      }
      return visual;
    }

    case 'chart': {
      const title = cleanText(raw.title, VISUAL_LIMITS.title);
      if (!title || !Array.isArray(raw.data)) return null;
      const data: ChartPoint[] = [];
      for (const point of raw.data.slice(0, 8)) {
        if (!isRecord(point)) return null;
        const label = cleanText(point.label, VISUAL_LIMITS.label);
        const value = toFiniteNumber(point.value);
        // Графики строятся только из настоящих чисел: одна плохая точка — и график не показываем.
        if (!label || value === null) return null;
        data.push({ label, value });
      }
      if (data.length < 2) return null;
      const visual: Visual = { type: 'chart', title, kind: lowerKey(raw.kind) === 'line' ? 'line' : 'bar', data };
      const unit = cleanText(raw.unit, VISUAL_LIMITS.unit);
      if (unit) visual.unit = unit;
      return visual;
    }

    case 'timeline': {
      const title = cleanText(raw.title, VISUAL_LIMITS.title);
      if (!title || !Array.isArray(raw.events)) return null;
      const events = raw.events
        .map((event): TimelineEvent | null => {
          if (!isRecord(event)) return null;
          const date = cleanText(event.date, VISUAL_LIMITS.title);
          const label = cleanText(event.label, VISUAL_LIMITS.item);
          return date && label ? { date, label } : null;
        })
        .filter((event): event is TimelineEvent => event !== null)
        .slice(0, 6);
      return events.length >= 2 ? { type: 'timeline', title, events } : null;
    }

    case 'diagram': {
      const title = cleanText(raw.title, VISUAL_LIMITS.title);
      if (!title || !Array.isArray(raw.nodes) || !Array.isArray(raw.edges)) return null;
      const nodes: DiagramNode[] = [];
      const ids = new Set<string>();
      for (const node of raw.nodes) {
        if (!isRecord(node)) continue;
        const id = cleanText(typeof node.id === 'number' ? String(node.id) : node.id, VISUAL_LIMITS.nodeId);
        const label = cleanText(node.label, VISUAL_LIMITS.label);
        if (!id || !label || ids.has(id)) continue;
        ids.add(id);
        nodes.push({ id, label });
        if (nodes.length === 7) break;
      }
      if (nodes.length < 2) return null;
      const edges: DiagramEdge[] = [];
      const seen = new Set<string>();
      for (const edge of raw.edges) {
        if (!isRecord(edge)) continue;
        const from = cleanText(typeof edge.from === 'number' ? String(edge.from) : edge.from, VISUAL_LIMITS.nodeId);
        const to = cleanText(typeof edge.to === 'number' ? String(edge.to) : edge.to, VISUAL_LIMITS.nodeId);
        // Связь должна вести между существующими узлами.
        if (!from || !to || from === to || !ids.has(from) || !ids.has(to)) continue;
        const key = `${from}\u0000${to}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const label = cleanText(edge.label, VISUAL_LIMITS.label);
        edges.push(label ? { from, to, label } : { from, to });
        if (edges.length === 10) break;
      }
      return edges.length >= 1 ? { type: 'diagram', title, nodes, edges } : null;
    }

    case 'fact': {
      const title = cleanText(raw.title, VISUAL_LIMITS.title);
      const text = cleanText(raw.text, VISUAL_LIMITS.text);
      return title && text ? { type: 'fact', title, text } : null;
    }

    case 'question': {
      const question = cleanText(raw.question, VISUAL_LIMITS.text);
      const answer = cleanText(raw.answer, VISUAL_LIMITS.text);
      return question && answer ? { type: 'question', question, answer } : null;
    }

    case 'scene': {
      const title = cleanText(raw.title, VISUAL_LIMITS.title);
      const icon = lowerKey(raw.icon);
      if (!title || !SCENE_ICON_SET.has(icon)) return null;
      const caption = cleanText(raw.caption, VISUAL_LIMITS.text) ?? '';
      return { type: 'scene', title, icon: icon as SceneIcon, caption };
    }

    default:
      return null;
  }
}

/* ────────────────────────────────────────────────────────────────────────────
 * Реплики
 * ──────────────────────────────────────────────────────────────────────────── */

interface NormalizedLine {
  index: number;
  speaker: string;
  text: string;
  sourceIds: string[];
  rawVisual: unknown;
}

/** Те же пределы, что у сервера: старые, скопированные и чужие разговоры проходят через них же. */
export const LINE_LIMITS = { lines: 40, text: 2000, speaker: 40, sourceIds: 5 } as const;

// Голос выбирается по имени, поэтому латиница и другой регистр приводятся к именам ведущих.
const SPEAKER_ALIASES: Record<string, string> = {
  макс: 'Макс',
  max: 'Макс',
  maks: 'Макс',
  софья: 'Софья',
  софия: 'Софья',
  sofia: 'Софья',
  sofya: 'Софья',
  sophia: 'Софья',
  sofiya: 'Софья',
};

/** «Max», «макс:», « MAX » → «Макс»; прочие имена — как есть, без лишних пробелов. */
export function normalizeSpeaker(value: unknown): string {
  if (typeof value !== 'string') return '';
  const name = value
    .replace(CONTROL_CHARS, '')
    .replace(/\s+/g, ' ')
    .replace(/[:：]+\s*$/u, '')
    .trim()
    .slice(0, LINE_LIMITS.speaker);
  return SPEAKER_ALIASES[name.toLowerCase()] ?? name;
}

/** Идентификаторы фрагментов вида S01: регистр и скобки не важны, без повторов, не больше пяти. */
export function cleanSourceIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const ids: string[] = [];
  for (const item of value) {
    if (typeof item !== 'string') continue;
    const id = item.trim().replace(/^\[+|\]+$/g, '').trim().toUpperCase();
    if (/^S\d{1,3}$/.test(id) && !ids.includes(id)) ids.push(id);
    if (ids.length === LINE_LIMITS.sourceIds) break;
  }
  return ids;
}

function clampLineText(text: string): string {
  return text.length > LINE_LIMITS.text ? `${text.slice(0, LINE_LIMITS.text - 1).trimEnd()}…` : text;
}

/** Достаёт из summary_json.podcast реплики с текстом (не больше 40), сохраняя исходные индексы. */
export function normalizeLines(raw: unknown): NormalizedLine[] {
  if (!Array.isArray(raw)) return [];
  const result: NormalizedLine[] = [];
  for (let index = 0; index < raw.length && result.length < LINE_LIMITS.lines; index += 1) {
    const item = raw[index];
    if (!isRecord(item) || typeof item.text !== 'string') continue;
    const text = item.text.replace(CONTROL_CHARS, '').trim();
    if (!text) continue;
    result.push({
      index,
      speaker: normalizeSpeaker(item.speaker),
      text: clampLineText(text),
      sourceIds: cleanSourceIds(item.source_ids),
      rawVisual: item.visual,
    });
  }
  return result;
}

/** Есть ли хотя бы у одной реплики корректное изображение от модели. */
export function hasModelVisuals(raw: unknown): boolean {
  return normalizeLines(raw).some(line => sanitizeVisual(line.rawVisual) !== null);
}

/* ────────────────────────────────────────────────────────────────────────────
 * Подбор изображений для старых разговоров (детерминированно)
 * ──────────────────────────────────────────────────────────────────────────── */

/** Нижний регистр, ё → е, всё кроме букв и цифр — пробел. */
export function normalizeForMatch(value: string): string {
  return value
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

// Самые частые окончания русских слов, от длинных к коротким.
const ENDINGS = [
  'иями', 'ями', 'ами', 'ого', 'его', 'ому', 'ему', 'ыми', 'ими', 'ией',
  'ой', 'ей', 'ий', 'ый', 'ая', 'яя', 'ое', 'ее', 'ие', 'ые', 'ия', 'ию', 'ью',
  'ом', 'ем', 'ам', 'ям', 'ах', 'ях', 'ов', 'ев',
  'ы', 'и', 'а', 'я', 'о', 'е', 'у', 'ю', 'ь', 'й',
];

const SHORT_WORD_ENDINGS = ['а', 'я', 'о', 'е', 'у', 'ю', 'ы', 'и', 'ь', 'й'];

/**
 * Грубая основа слова: срезаем окончание, если остаётся не меньше 4 букв.
 * У слов из 4 букв срезаем только одну гласную («фаза» → «фаз», чтобы нашлась «фазе»).
 */
export function wordStem(word: string): string {
  if (word.length < 4) return word;
  if (word.length === 4) {
    return SHORT_WORD_ENDINGS.includes(word.slice(-1)) ? word.slice(0, -1) : word;
  }
  for (const ending of ENDINGS) {
    if (word.endsWith(ending) && word.length - ending.length >= 4) {
      return word.slice(0, -ending.length);
    }
  }
  return word;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function termRegExp(normalizedTerm: string): RegExp {
  const pattern = normalizedTerm
    .split(' ')
    .map(word => `${escapeRegExp(wordStem(word))}[\\p{L}\\p{N}]*`)
    .join(' ');
  // Совпадение только с начала слова: «ток» не найдётся внутри «поток».
  return new RegExp(`(?:^| )${pattern}(?= |$)`, 'u');
}

function findTerm(text: string, terms: ConversationContext['terms']): Visual | null {
  if (!terms?.length) return null;
  let best: { position: number; length: number; visual: Visual } | null = null;
  for (const item of terms) {
    if (!isRecord(item)) continue;
    const normalizedTerm = normalizeForMatch(typeof item.term === 'string' ? item.term : '');
    if (normalizedTerm.length < 4) continue;
    const match = termRegExp(normalizedTerm).exec(text);
    if (!match) continue;
    const position = match.index + (match[0].startsWith(' ') ? 1 : 0);
    const visual = sanitizeVisual({ type: 'term', term: item.term, definition: item.definition });
    if (!visual) continue;
    if (
      !best ||
      position < best.position ||
      (position === best.position && normalizedTerm.length > best.length)
    ) {
      best = { position, length: normalizedTerm.length, visual };
    }
  }
  return best?.visual ?? null;
}

function longWordStems(text: string): Set<string> {
  return new Set(
    normalizeForMatch(text)
      .split(' ')
      .filter(word => word.length >= 5)
      .map(wordStem),
  );
}

function findFlashcard(text: string, flashcards: ConversationContext['flashcards']): Visual | null {
  if (!flashcards?.length) return null;
  const lineStems = longWordStems(text);
  let best: { shared: number; visual: Visual } | null = null;
  for (const card of flashcards) {
    if (!isRecord(card) || typeof card.question !== 'string') continue;
    let shared = 0;
    for (const stem of longWordStems(card.question)) {
      if (lineStems.has(stem)) shared += 1;
    }
    if (shared < 2 || (best && shared <= best.shared)) continue;
    const visual = sanitizeVisual({ type: 'question', question: card.question, answer: card.answer });
    if (visual) best = { shared, visual };
  }
  return best?.visual ?? null;
}

/** Цитата из фрагмента исходника по source_ids реплики; вместе с id фрагмента, откуда она взята. */
function findSourceFact(
  sourceIds: string[],
  sources: ConversationContext['sources'],
): { visual: Visual; sourceId: string } | null {
  if (!sourceIds.length || !sources?.length) return null;
  for (const id of sourceIds) {
    const source = sources.find(
      item => isRecord(item) && typeof item.id === 'string' && item.id.trim().toLowerCase() === id.toLowerCase(),
    );
    if (!source || typeof source.text !== 'string') continue;
    const sourceId = source.id.trim();
    const visual = sanitizeVisual({ type: 'fact', title: `Из источника ${sourceId}`, text: source.text });
    if (visual) return { visual, sourceId };
  }
  return null;
}

/** Заставка первой реплики: только название материала, без выдуманной подписи. */
function openingScene(title: string | undefined): Visual {
  const clean = cleanText(title, VISUAL_LIMITS.title);
  return { type: 'scene', title: clean ?? 'Подкаст по лекции', icon: 'book', caption: '' };
}

/** Короче этого совпадение ещё не цитата. */
const QUOTE_MIN_CHARS = 12;

/**
 * Фрагменты исходника, из которых цитата взята слово в слово, или [] — тогда это
 * пересказ. Регистр, ё/е и знаки препинания не важны, многоточие может пропускать
 * слова, цитата может переходить из одного фрагмента в соседний. Та же проверка,
 * что у сервера (quote_source_ids).
 */
export function quoteSourceIds(text: string, sources: ConversationContext['sources']): string[] {
  if (!sources?.length) return [];
  const parts = text
    .split(/…|\.{3}/)
    .map(normalizeForMatch)
    .filter(Boolean);
  if (parts.reduce((sum, part) => sum + part.length, 0) < QUOTE_MIN_CHARS) return [];
  const spans: { start: number; end: number; id: string }[] = [];
  let joined = '';
  for (const source of sources) {
    if (!isRecord(source) || typeof source.id !== 'string' || typeof source.text !== 'string') continue;
    const normalized = normalizeForMatch(source.text);
    if (!normalized) continue;
    if (joined) joined += ' ';
    spans.push({ start: joined.length, end: joined.length + normalized.length, id: source.id.trim() });
    joined += normalized;
  }
  let start = -1;
  let position = 0;
  for (const part of parts) {
    const found = joined.indexOf(part, position);
    if (found < 0) return [];
    if (start < 0) start = found;
    position = found + part.length;
  }
  return spans.filter(span => span.start < position && span.end > start).map(span => span.id);
}

const NO_PROVENANCE: Provenance = { kind: 'none' };

/** Что честно сказать об источнике изображения (см. Provenance в types.ts). */
function provenanceFor(
  visual: Visual,
  origin: VisualOrigin,
  sourceIds: string[],
  sources: ConversationContext['sources'],
): Provenance {
  if (origin === 'cover') return NO_PROVENANCE;
  if (origin === 'auto') {
    if (visual.type === 'term') return { kind: 'summary' };
    if (visual.type === 'question') return { kind: 'cards' };
    if (visual.type === 'fact') return { kind: 'quote', ids: sourceIds };
    return NO_PROVENANCE;
  }
  // Числа графиков и даты хронологий сервер сверяет с исходником, прежде чем сохранить;
  // номер фрагмента показываем, только если числа или даты в нём действительно есть.
  if (visual.type === 'chart') return { kind: 'numbers', ids: chartSourceIds(visual, sourceIds, sources) };
  if (visual.type === 'timeline') return { kind: 'dates', ids: timelineSourceIds(visual, sourceIds, sources) };
  if (visual.type === 'fact') {
    const ids = quoteSourceIds(visual.text, sources);
    return ids.length ? { kind: 'quote', ids } : NO_PROVENANCE;
  }
  return NO_PROVENANCE;
}

/**
 * Готовит реплики к показу. Для каждой реплики выбирается изображение:
 *   1. корректное изображение от модели (origin: 'model');
 *   иначе подбор по тексту (origin: 'auto'):
 *   a. термин из конспекта, который встречается в реплике;
 *   b. карточка, с которой у реплики не меньше двух общих слов от 5 букв;
 *   c. фрагмент исходника по source_ids реплики;
 *   d. изображение предыдущей реплики;
 *   e. для первой реплики — заставка с названием материала (origin: 'cover').
 */
export function buildConversation(raw: unknown, ctx: ConversationContext = {}): ConversationLine[] {
  const lines = normalizeLines(raw);
  const result: ConversationLine[] = [];
  let previous: ConversationLine | null = null;

  for (const line of lines) {
    const normalizedText = normalizeForMatch(line.text);
    let visual: Visual | null = sanitizeVisual(line.rawVisual);
    let origin: VisualOrigin = 'model';
    let carried = false;
    let visualFrom = line.index;
    let visualSourceIds: string[] = visual ? line.sourceIds : [];
    let provenance: Provenance | null = null;

    if (!visual) {
      origin = 'auto';
      visual = findTerm(normalizedText, ctx.terms) ?? findFlashcard(line.text, ctx.flashcards);
      if (!visual) {
        const fact = findSourceFact(line.sourceIds, ctx.sources);
        if (fact) {
          visual = fact.visual;
          visualSourceIds = [fact.sourceId];
        }
      }
    }

    if (!visual && previous) {
      visual = previous.visual;
      origin = previous.origin;
      carried = true;
      visualFrom = previous.visualFrom;
      visualSourceIds = previous.visualSourceIds;
      provenance = previous.provenance;
    }

    if (!visual) {
      visual = openingScene(ctx.title);
      origin = 'cover';
      visualSourceIds = [];
    }

    const resolved: ConversationLine = {
      index: line.index,
      speaker: line.speaker,
      text: line.text,
      sourceIds: line.sourceIds,
      visual,
      origin,
      carried,
      visualFrom,
      visualSourceIds,
      provenance: provenance ?? provenanceFor(visual, origin, visualSourceIds, ctx.sources),
    };
    result.push(resolved);
    previous = resolved;
  }

  return result;
}

/* ────────────────────────────────────────────────────────────────────────────
 * Ответы сервера
 * ──────────────────────────────────────────────────────────────────────────── */

/** Достаёт реплики из ответа /api/podcast/generate. */
export function parseGeneratedLines(payload: unknown): PodcastLine[] {
  const candidates: unknown[] = [];
  if (Array.isArray(payload)) candidates.push(payload);
  if (isRecord(payload)) {
    candidates.push(payload.podcast, payload.lines);
    if (isRecord(payload.podcast)) candidates.push(payload.podcast.podcast);
  }
  const list = candidates.find(Array.isArray) as unknown[] | undefined;
  if (!list) return [];
  return normalizeLines(list).map(line => {
    const result: PodcastLine = { speaker: line.speaker || 'Софья', text: line.text };
    if (line.sourceIds.length) result.source_ids = line.sourceIds;
    const visual = sanitizeVisual(line.rawVisual);
    if (visual) result.visual = visual;
    return result;
  });
}

/**
 * Вливает изображения из ответа /api/podcast/visuals в реплики по индексу.
 * Принимает { visuals: (Visual | null)[] }, { visuals: [{ index, visual, source_ids? }] }
 * или { podcast | lines: [{ visual }] }. Текст реплик не меняется и не теряется.
 *
 * Сервер присылает source_ids для графиков, хронологий и цитат — фрагменты, где
 * он нашёл их числа, даты или текст. Они заменяют старые source_ids реплики,
 * подобранные по словам. Если для графика или хронологии фрагментов нет, старые
 * id убираются: иначе под числами стоял бы чужой фрагмент.
 */
export function mergeVisualsByIndex(rawLines: unknown, payload: unknown): { lines: unknown[]; added: number } {
  const lines = Array.isArray(rawLines) ? [...rawLines] : [];
  const byIndex = new Map<number, { visual: Visual; sourceIds?: string[] }>();

  const list = isRecord(payload)
    ? ([payload.visuals, payload.podcast, payload.lines].find(Array.isArray) as unknown[] | undefined)
    : Array.isArray(payload)
      ? payload
      : undefined;

  (list ?? []).forEach((entry, position) => {
    if (isRecord(entry) && typeof entry.index === 'number' && Number.isInteger(entry.index) && 'visual' in entry) {
      const visual = sanitizeVisual(entry.visual);
      const sourceIds = Array.isArray(entry.source_ids) ? cleanSourceIds(entry.source_ids) : undefined;
      if (visual) byIndex.set(entry.index, { visual, sourceIds });
      return;
    }
    if (isRecord(entry) && 'visual' in entry && typeof entry.type !== 'string') {
      const visual = sanitizeVisual(entry.visual);
      if (visual) byIndex.set(position, { visual });
      return;
    }
    const visual = sanitizeVisual(entry);
    if (visual) byIndex.set(position, { visual });
  });

  let added = 0;
  const merged = lines.map((line, index) => {
    const found = byIndex.get(index);
    if (!found || !isRecord(line)) return line;
    added += 1;
    const next: Record<string, unknown> = { ...line, visual: found.visual };
    if (found.sourceIds) next.source_ids = found.sourceIds;
    else if (found.visual.type === 'chart' || found.visual.type === 'timeline') delete next.source_ids;
    return next;
  });
  return { lines: merged, added };
}

/* ────────────────────────────────────────────────────────────────────────────
 * Мелочи для плеера
 * ──────────────────────────────────────────────────────────────────────────── */

const WORDS_PER_MINUTE = 150;

export function countWords(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

/** Примерная длительность разговора в минутах (~150 слов в минуту). */
export function estimateMinutes(lines: { text: string }[]): number {
  const words = lines.reduce((sum, line) => sum + countWords(line.text), 0);
  if (words === 0) return 0;
  return Math.max(1, Math.round(words / WORDS_PER_MINUTE));
}

/** «1 реплика», «3 реплики», «12 реплик». */
export function pluralLines(count: number): string {
  return `${count} ${pluralRu(count, ['реплика', 'реплики', 'реплик'])}`;
}

/** Форма слова для числа: ['карточка', 'карточки', 'карточек']. */
export function pluralRu(count: number, forms: readonly [string, string, string]): string {
  const mod10 = Math.abs(count) % 10;
  const mod100 = Math.abs(count) % 100;
  if (mod10 === 1 && mod100 !== 11) return forms[0];
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return forms[1];
  return forms[2];
}

export type HostVoice = 'male' | 'female';

/** Макс говорит мужским голосом, Софья и все остальные — женским. */
export function voiceForSpeaker(speaker: string): HostVoice {
  return normalizeSpeaker(speaker) === 'Макс' ? 'male' : 'female';
}

/**
 * Голоса ведущих разговора: Макс — мужской, Софья — женский, остальные имена
 * получают голоса по очереди появления, чтобы два ведущих не звучали одинаково.
 */
export function assignVoices(speakers: readonly string[]): Map<string, HostVoice> {
  const voices = new Map<string, HostVoice>();
  const others: string[] = [];
  for (const name of speakers) {
    const normalized = normalizeSpeaker(name);
    if (normalized === 'Макс') voices.set(name, 'male');
    else if (normalized === 'Софья') voices.set(name, 'female');
    else if (!others.includes(name)) others.push(name);
  }
  const taken = new Set(voices.values());
  let next: HostVoice = taken.has('male') && !taken.has('female') ? 'female' : 'male';
  for (const name of others) {
    voices.set(name, next);
    next = next === 'male' ? 'female' : 'male';
  }
  return voices;
}

export const VISUAL_TYPE_LABELS: Record<Visual['type'], string> = {
  term: 'Термин',
  steps: 'Шаги',
  compare: 'Сравнение',
  formula: 'Формула',
  chart: 'График',
  timeline: 'Хронология',
  diagram: 'Схема',
  fact: 'Цитата',
  question: 'Проверьте себя',
  scene: 'Тема',
};

/** Подпись над изображением: цитатой называется только то, что найдено в исходнике слово в слово. */
export function visualLabel(visual: Visual, provenance: Provenance): string {
  if (visual.type === 'fact' && provenance.kind !== 'quote') return 'Пересказ';
  return VISUAL_TYPE_LABELS[visual.type];
}

/** «фрагмент 3», «фрагменты 3 и 4», «фрагменты 2, 3 и 5» для S03, S04… */
export function fragmentWords(ids: readonly string[]): string {
  const numbers = ids.map(id => id.replace(/^S0*/i, '') || '0');
  if (numbers.length === 1) return `фрагмент ${numbers[0]}`;
  return `фрагменты ${numbers.slice(0, -1).join(', ')} и ${numbers[numbers.length - 1]}`;
}

/** Подпись под изображением о его источнике, или null, если сказать нечего. */
export function provenanceLead(provenance: Provenance): string | null {
  switch (provenance.kind) {
    case 'numbers':
      return 'Числа — из материала';
    case 'dates':
      return 'Даты — из материала';
    case 'quote':
      return 'Из материала';
    case 'summary':
      return 'Из конспекта';
    case 'cards':
      return 'Из карточек';
    default:
      return null;
  }
}

/**
 * Заметка-источник в правом углу листа (спека 5.7, .sf-pnote): «Числа — из лекции, фрагмент 4»,
 * «Из лекции, фрагмент 3». Говорит только то, что проверено (см. Provenance); null — сказать нечего.
 */
export function sourceNote(provenance: Provenance): string | null {
  const ids = 'ids' in provenance ? provenance.ids : [];
  const where = ids.length ? `, ${fragmentWords(ids)}` : '';
  switch (provenance.kind) {
    case 'numbers':
      return `Числа — из лекции${where}`;
    case 'dates':
      return `Даты — из лекции${where}`;
    case 'quote':
      return `Из лекции${where}`;
    case 'summary':
      return 'Из конспекта';
    case 'cards':
      return 'Из карточек';
    default:
      return null;
  }
}

/** «около минуты», «около 3 минут», «около 21 минуты». */
export function minutesPhrase(minutes: number): string {
  if (minutes <= 1) return 'около минуты';
  return `около ${minutes} ${pluralRu(minutes, ['минуты', 'минут', 'минут'])}`;
}

/**
 * Строка над листом: «Макс и Софья обсуждают лекцию · 14 реплик, около минуты».
 * Имена — как в репликах, не больше трёх.
 */
export function conversationMeta(speakers: readonly string[], lineCount: number, minutes: number): string {
  const names = speakers.filter(Boolean).slice(0, 3);
  const who =
    names.length === 0
      ? 'Подкаст по лекции'
      : names.length === 1
        ? `${names[0]} рассказывает о лекции`
        : `${names.slice(0, -1).join(', ')} и ${names[names.length - 1]} обсуждают лекцию`;
  const length = minutes > 0 ? `${pluralLines(lineCount)}, ${minutesPhrase(minutes)}` : pluralLines(lineCount);
  return `${who} · ${length}`;
}

/** Короткая подпись изображения для списка реплик и подсказок. */
export function visualCaption(visual: Visual): string {
  switch (visual.type) {
    case 'term':
      return visual.term;
    case 'question':
      return visual.question;
    case 'fact':
      // «Из источника S03» — служебное название подобранной цитаты: показываем начало самой цитаты.
      return /^из источника(\s+S\d+)?$/i.test(visual.title.trim()) ? truncateText(visual.text, 60) : visual.title;
    default:
      return visual.title;
  }
}

/* ────────────────────────────────────────────────────────────────────────────
 * План разговора на первой реплике
 * ──────────────────────────────────────────────────────────────────────────── */

/** Сколько тем в плане: план — это «что дальше», а не оглавление каждой реплики. */
export const OUTLINE_LIMIT = 4;
/** Длиннее этого название темы уже предложение, а не тема. */
export const OUTLINE_TITLE_MAX = 60;

/**
 * Ключ темы для сравнения: регистр, ё/е, знаки и окончания не важны —
 * «Эластичный спрос», «эластичный спрос!» и «Эластичного спроса» — одна тема.
 */
export function topicKey(text: string): string {
  return normalizeForMatch(text).split(' ').filter(Boolean).map(wordStem).join(' ');
}

/**
 * Название темы не длиннее OUTLINE_TITLE_MAX: «Эластичность спроса: как цена меняет выручку
 * у пекарни и у кофейни» → «Эластичность спроса»; без такой границы — обрезка по слову с «…».
 */
export function outlineTitle(title: string): string {
  const text = title.replace(/\s+/g, ' ').trim();
  if (text.length <= OUTLINE_TITLE_MAX) return text;
  const head = /^(.{3,60}?)(?::\s|\s[—–-]\s)/u.exec(text);
  return head ? head[1].trim() : truncateText(text, OUTLINE_TITLE_MAX);
}

/**
 * Темы для плана на первой реплике: что появится на листе дальше. Только темы —
 * без вопросов для самопроверки ('question', иначе план читается как тест с
 * вариантами ответа) и без цитат и пересказов ('fact'); каждая тема один раз
 * (см. topicKey), без повтора заголовка самого плана; не больше OUTLINE_LIMIT.
 * Меньше двух тем — плана нет, на первой реплике остаётся сама заставка.
 */
export function conversationOutline(lines: readonly ConversationLine[], heading = ''): OutlineItem[] {
  const opening = lines[0];
  if (!opening) return [];
  const seen = new Set<string>();
  const headingKey = topicKey(heading);
  if (headingKey) seen.add(headingKey);
  const items: OutlineItem[] = [];
  for (let position = 0; position < lines.length && items.length < OUTLINE_LIMIT; position += 1) {
    const line = lines[position];
    if (line.carried || line.visualFrom === opening.visualFrom) continue;
    if (line.visual.type === 'question' || line.visual.type === 'fact') continue;
    const caption = outlineTitle(visualCaption(line.visual));
    const key = topicKey(caption);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    items.push({ position, caption });
  }
  return items.length >= 2 ? items : [];
}
