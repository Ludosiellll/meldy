import {
  SCENE_ICONS,
  type ChartPoint,
  type CompareSide,
  type ConversationContext,
  type ConversationLine,
  type DiagramEdge,
  type DiagramNode,
  type FormulaLegendItem,
  type PodcastLine,
  type SceneIcon,
  type TimelineEvent,
  type Visual,
  type VisualOrigin,
} from './types';

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
  latex = latex.replace(/\s+/g, ' ').replace(/(?<!\\)%/g, '\\%');
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

/** Достаёт из summary_json.podcast реплики с текстом, сохраняя исходные индексы. */
export function normalizeLines(raw: unknown): NormalizedLine[] {
  if (!Array.isArray(raw)) return [];
  const result: NormalizedLine[] = [];
  raw.forEach((item, index) => {
    if (!isRecord(item) || typeof item.text !== 'string' || !item.text.trim()) return;
    const speaker = typeof item.speaker === 'string' ? item.speaker.trim() : '';
    const sourceIds = Array.isArray(item.source_ids)
      ? item.source_ids.filter((id): id is string => typeof id === 'string' && id.trim() !== '').map(id => id.trim())
      : [];
    result.push({ index, speaker, text: item.text.trim(), sourceIds, rawVisual: item.visual });
  });
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
  return { type: 'scene', title: clean ?? 'Разговор по материалу', icon: 'book', caption: '' };
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
 * Принимает { visuals: (Visual | null)[] }, { visuals: [{ index, visual }] }
 * или { podcast | lines: [{ visual }] }. Сами реплики не меняются и не теряются.
 */
export function mergeVisualsByIndex(rawLines: unknown, payload: unknown): { lines: unknown[]; added: number } {
  const lines = Array.isArray(rawLines) ? [...rawLines] : [];
  const byIndex = new Map<number, Visual>();

  const list = isRecord(payload)
    ? ([payload.visuals, payload.podcast, payload.lines].find(Array.isArray) as unknown[] | undefined)
    : Array.isArray(payload)
      ? payload
      : undefined;

  (list ?? []).forEach((entry, position) => {
    if (isRecord(entry) && typeof entry.index === 'number' && Number.isInteger(entry.index) && 'visual' in entry) {
      const visual = sanitizeVisual(entry.visual);
      if (visual) byIndex.set(entry.index, visual);
      return;
    }
    if (isRecord(entry) && 'visual' in entry && typeof entry.type !== 'string') {
      const visual = sanitizeVisual(entry.visual);
      if (visual) byIndex.set(position, visual);
      return;
    }
    const visual = sanitizeVisual(entry);
    if (visual) byIndex.set(position, visual);
  });

  let added = 0;
  const merged = lines.map((line, index) => {
    const visual = byIndex.get(index);
    if (!visual || !isRecord(line)) return line;
    added += 1;
    return { ...line, visual };
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

export function voiceForSpeaker(speaker: string): 'male' | 'female' {
  return speaker === 'Макс' ? 'male' : 'female';
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
  scene: 'Иллюстрация',
};

/** Короткая подпись изображения для списка реплик и подсказок. */
export function visualCaption(visual: Visual): string {
  switch (visual.type) {
    case 'term':
      return visual.term;
    case 'question':
      return visual.question;
    default:
      return visual.title;
  }
}
