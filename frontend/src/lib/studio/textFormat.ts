/**
 * «Текст»: the whole test as plain text and back (plan «Doc library», textFormat). One block after another, an empty
 * line between them:
 *
 *   # Заголовок                  ## Заголовок поменьше
 *   ! Заметка                    !совет Совет            !важно Важное   (more lines of the note below it)
 *   ---                          a divider
 *   === Название страницы        a new page («по страницам»)
 *   [обложка] Название           the next line — the subtitle
 *   [картинка] Подпись           a picture already on the page (new pictures are added on the canvas)
 *   [видео](https://…) Подпись   a video of YouTube, RuTube or VK Видео (the link in brackets, the caption after it)
 *   Вопрос (one line or more)
 *   + верный вариант             - неверный вариант      (a long option goes on in lines that start with two spaces)
 *   = ответ; другая запись       a short answer instead of options
 *   > Пояснение                  shown after the answer
 *   any other lines              a text paragraph (**жирный**, *курсив*, [слова](https://…))
 *
 * A line that would read as a mark but is plain text starts with «\»; a line with only «\» is an empty line inside a
 * block. toText writes those itself, so for a normalised document (doc.ts normalizeDoc) whose question blocks all have
 * their rows, fromText(toText(doc)) changes nothing and toText(fromText(toText(doc)).doc) === toText(doc).
 *
 * fromText matches the text's blocks to the page's (equal ones first, wherever they moved; then, between them, the
 * likeliest of the same type), so the result is the fewest changes: the rows to add (ItemInput, their blocks hold the
 * import ref until doc.ts bindRefs), the rows to patch (only what changed, by the question editor's rules), the rows to
 * delete. Problems carry the line (from 1) and plain words; apply only when there are none.
 */
import { isPictureWord, type ItemInput, type ItemPatch, type TestItem } from '../../types/container';
import { DOC_CAPTION_MAX, DOC_MAX_BLOCKS, DOC_TEXT_MAX, DOC_TITLE_MAX, type DocBlock, type TestDoc } from '../../types/testDoc';
import { draftOf, draftProblems, emptyDraft, formsOf, inputOf, LIMITS, patchOf, type Draft, type DraftProblem } from '../../components/containers/keys/editorModel';
import { isTrueFalse, orderBound } from './checker';
import { chars, cryptoFill, freshId, hasWords, newId, oneLine, sameValue, type RandomFill } from './doc';
import { cleanVideoUrl, videoUrlOk } from './video';

// ─────────────────────────────────────────────── lines

type Tone = 'info' | 'tip' | 'warn';
const TONE_MARK: Record<Tone, string> = { info: '!', tip: '!совет', warn: '!важно' };

type Line =
  | { kind: 'blank' }
  | { kind: 'heading'; size: 'l' | 'm'; text: string }
  | { kind: 'note'; tone: Tone; text: string }
  | { kind: 'divider' }
  | { kind: 'page'; title: string }
  | { kind: 'cover'; title: string }
  | { kind: 'image'; caption: string }
  /** `url` null: «[видео]» without a link in brackets after it. */
  | { kind: 'video'; url: string | null; caption: string }
  | { kind: 'option'; right: boolean; text: string }
  | { kind: 'form'; text: string }
  | { kind: 'explain'; text: string }
  /** Release 48: «[соответствие]» — a question of a new kind; its key is edited on the canvas, never in the text. */
  | { kind: 'kindmark'; tag: string }
  | { kind: 'content'; text: string };

/** The tag of each new kind in «Текст» (release 48), and back. */
const KIND_TAGS: Record<string, string> = { number: 'число', order: 'порядок', match: 'соответствие', cloze: 'пропуски', essay: 'развёрнутый ответ' };
const TAG_KINDS: Record<string, string> = Object.fromEntries(Object.entries(KIND_TAGS).map(([kind, tag]) => [tag, kind]));
const KIND_MARK = /^\[(число|порядок|соответствие|пропуски|развёрнутый ответ)\](?:\s|$)/i;
/** The words after a new kind's tag: what the line is for. */
const KIND_MARK_WORDS = 'ключ — на холсте';

/** The words after a mark of `size` characters and the one space after it. */
const rest = (line: string, size: number) => line.slice(size + 1);

function classify(line: string): Line {
  if (/^\s*$/.test(line)) return { kind: 'blank' };
  let match = /^(#{1,2})(?:\s|$)/.exec(line);
  if (match) return { kind: 'heading', size: match[1].length === 1 ? 'l' : 'm', text: rest(line, match[1].length) };
  match = /^!(совет|важно)?(?:\s|$)/.exec(line);
  if (match) return { kind: 'note', tone: match[1] === 'совет' ? 'tip' : match[1] === 'важно' ? 'warn' : 'info', text: rest(line, match[0].trimEnd().length) };
  if (/^-{3,}\s*$/.test(line)) return { kind: 'divider' };
  match = /^(={3,})(?:\s|$)/.exec(line);
  if (match) return { kind: 'page', title: rest(line, match[1].length) };
  if (/^\[обложка\](?:\s|$)/.test(line)) return { kind: 'cover', title: rest(line, 9) };
  if (/^\[картинка\](?:\s|$)/.test(line)) return { kind: 'image', caption: rest(line, 10) };
  if (/^\[видео\](?:[(\s]|$)/.test(line)) {
    match = /^\[видео\]\(([^()\s]*)\)(?:\s(.*))?$/.exec(line);
    return match ? { kind: 'video', url: match[1], caption: match[2] ?? '' } : { kind: 'video', url: null, caption: '' };
  }
  match = KIND_MARK.exec(line);
  if (match) return { kind: 'kindmark', tag: match[1].toLowerCase() };
  match = /^([+-])(?:\s|$)/.exec(line);
  if (match) return { kind: 'option', right: match[1] === '+', text: rest(line, 1) };
  if (/^=(?:\s|$)/.test(line)) return { kind: 'form', text: rest(line, 1) };
  if (/^>(?:\s|$)/.test(line)) return { kind: 'explain', text: rest(line, 1) };
  return { kind: 'content', text: line.startsWith('\\') ? line.slice(1) : line };
}

/** A line of words as text: «\» in front when it would read as a mark, an empty line or start with «\». */
function contentLine(text: string): string {
  return /^\s*$/.test(text) || text.startsWith('\\') || classify(text).kind !== 'content' ? `\\${text}` : text;
}
const contentLines = (text: string) => text.split('\n').map(contentLine);
/** After a mark: the mark alone for no words, else the mark, a space and the words. */
const marked = (mark: string, words: string) => (words ? `${mark} ${words}` : mark);
/** An option: its first line after the mark, the next ones after two spaces. */
function optionLines(mark: '+' | '-', text: string): string[] {
  const [first, ...more] = text.split('\n');
  return [marked(mark, first), ...more.map((line) => `  ${line.startsWith('\\') || /^\s*$/.test(line) ? `\\${line}` : line}`)];
}

// ─────────────────────────────────────────────── the document as text

/** A question as the text shows it (and as fromText reads it back). */
interface QuestionText {
  stem: string;
  /** Release 48: a new kind's question (its tag in the text); only its stem and explanation are text. */
  kind?: string;
  short: boolean;
  options: string[];
  correct: number[];
  forms: string[];
  explanation: string;
}

const sortedSet = (list: readonly number[]) => [...new Set(list)].sort((a, b) => a - b);

function questionOf(item: TestItem): QuestionText {
  if (KIND_TAGS[item.kind]) return { stem: item.stem, kind: item.kind, short: false, options: [], correct: [], forms: [], explanation: item.explanation ?? '' };
  const short = item.kind === 'short';
  return {
    stem: item.stem,
    short,
    options: short ? [] : [...item.options],
    correct: short ? [] : sortedSet(item.correct),
    forms: short ? formsOf(item.answers.join(';')) : [],
    explanation: item.explanation ?? '',
  };
}

function questionText(question: QuestionText): string[] {
  const lines = contentLines(question.stem);
  if (question.kind) lines.push(marked(`[${KIND_TAGS[question.kind]}]`, KIND_MARK_WORDS));
  else if (question.short) lines.push(marked('=', question.forms.join('; ')));
  else question.options.forEach((option, index) => lines.push(...optionLines(question.correct.includes(index) ? '+' : '-', option)));
  if (question.explanation) lines.push(...question.explanation.split('\n').map((line) => marked('>', line)));
  return lines;
}

/**
 * One question in the marks of «Текст» (UX audit of 21.10: the studio's «Сделать вопросами» writes the questions it
 * found in pasted Word text this way, so «Применить» reads them back).
 */
export function questionMarkup(question: { stem: string; options: string[]; correct: number[]; forms: string[] }): string {
  const short = question.options.length === 0;
  return questionText({ ...question, short, correct: sortedSet(question.correct), explanation: '' }).join('\n');
}

function blockText(block: DocBlock, rows: ReadonlyMap<string, TestItem>): string | null {
  switch (block.type) {
    case 'cover':
      return [marked('[обложка]', oneLine(block.title)), ...(block.subtitle ? [contentLine(oneLine(block.subtitle))] : [])].join('\n');
    case 'heading':
      return marked(block.size === 'l' ? '#' : '##', oneLine(block.text));
    case 'text':
      return contentLines(block.text).join('\n');
    case 'image':
      return marked('[картинка]', oneLine(block.caption));
    case 'video':
      return marked(`[видео](${block.url})`, oneLine(block.caption));
    case 'note': {
      const [first, ...more] = block.text.split('\n');
      return [marked(TONE_MARK[block.tone], first), ...more.map(contentLine)].join('\n');
    }
    case 'divider':
      return '---';
    case 'page':
      return marked('===', oneLine(block.title));
    case 'question': {
      const item = rows.get(block.item_id);
      return item ? questionText(questionOf(item)).join('\n') : null;
    }
  }
}

/** The page as text (question blocks whose row is gone are left out). */
export function toText(doc: TestDoc, items: readonly TestItem[]): string {
  const rows = new Map(items.map((item) => [item.id, item]));
  const parts: string[] = [];
  for (const block of doc.blocks) {
    const text = blockText(block, rows);
    if (text !== null) parts.push(text);
  }
  return parts.length > 0 ? `${parts.join('\n\n')}\n` : '';
}

/** The marks for the «Текст» view's help line, in plain words. */
export const TEXT_SYNTAX: ReadonlyArray<{ mark: string; words: string }> = [
  { mark: '# ', words: 'заголовок (## — поменьше)' },
  { mark: '! ', words: 'заметка (!совет, !важно)' },
  { mark: '---', words: 'разделитель' },
  { mark: '===', words: 'новая страница' },
  { mark: '+ ', words: 'верный вариант' },
  { mark: '- ', words: 'неверный вариант' },
  { mark: '= ', words: 'короткий ответ (записи через «;»)' },
  { mark: '> ', words: 'пояснение к ответу' },
  { mark: '[обложка] ', words: 'обложка, на следующей строке — подзаголовок' },
  { mark: '[картинка] ', words: 'подпись картинки' },
  { mark: '[видео](https://…) ', words: 'видео YouTube, RuTube или VK Видео, после ссылки — подпись' },
];

// ─────────────────────────────────────────────── text → blocks

interface Lines {
  first: number;
  options: number[];
  forms: number[];
  explanation: number[];
}

type Parsed =
  | { type: 'cover'; line: number; title: string; subtitle: string }
  | { type: 'heading'; line: number; text: string; size: 'l' | 'm' }
  | { type: 'text'; line: number; text: string }
  | { type: 'image'; line: number; caption: string }
  /** `url`: the link made clean (video.ts cleanVideoUrl) when it can be, else as written; null — no link in brackets. */
  | { type: 'video'; line: number; url: string | null; caption: string }
  | { type: 'note'; line: number; tone: Tone; text: string }
  | { type: 'divider'; line: number }
  | { type: 'page'; line: number; title: string }
  | { type: 'question'; line: number; question: QuestionText; lines: Lines };

type Building =
  | { type: 'text'; line: number; lines: string[] }
  | { type: 'note'; line: number; tone: Tone; lines: string[] }
  | { type: 'cover'; line: number; title: string; subtitle: string | null }
  | {
      type: 'question';
      line: number;
      stem: string[];
      options: Array<{ right: boolean; lines: string[] }>;
      forms: string[];
      explanation: string[];
      at: Lines;
      /** The previous line was an option (or its continuation): two spaces go on with it. */
      open: boolean;
      /** Release 48: the new kind its tag named. */
      kind?: string;
    };

export interface TextProblem {
  line: number;
  message: string;
}

const say = (line: number, words: string): TextProblem => ({ line, message: `Строка ${line}: ${words}` });

function finish(building: Building): Parsed {
  switch (building.type) {
    case 'text':
      return { type: 'text', line: building.line, text: building.lines.join('\n') };
    case 'note':
      return { type: 'note', line: building.line, tone: building.tone, text: building.lines.join('\n') };
    case 'cover':
      return { type: 'cover', line: building.line, title: building.title, subtitle: building.subtitle ?? '' };
    case 'question': {
      const options = building.options.map((option) => option.lines.join('\n'));
      const short = options.length === 0;
      return {
        type: 'question',
        line: building.line,
        question: {
          stem: building.stem.join('\n'),
          ...(building.kind ? { kind: building.kind } : {}),
          short: short && !building.kind,
          options,
          correct: building.options.flatMap((option, index) => (option.right ? [index] : [])),
          forms: short ? formsOf(building.forms.join(';')) : [],
          explanation: building.explanation.join('\n'),
        },
        lines: building.at,
      };
    }
  }
}

function parse(text: string): { blocks: Parsed[]; problems: TextProblem[] } {
  const blocks: Parsed[] = [];
  const problems: TextProblem[] = [];
  let current: Building | null = null;
  const flush = () => {
    if (current) blocks.push(finish(current));
    current = null;
  };
  /** The question the option, form or explanation at `line` belongs to (a text paragraph above becomes its stem). */
  const question = (line: number): Extract<Building, { type: 'question' }> => {
    if (current?.type === 'question') return current;
    const stem = current?.type === 'text' ? current.lines : [];
    const first = current?.type === 'text' ? current.line : line;
    if (current?.type === 'text') current = null;
    else flush();
    const made: Extract<Building, { type: 'question' }> = {
      type: 'question',
      line: first,
      stem,
      options: [],
      forms: [],
      explanation: [],
      at: { first, options: [], forms: [], explanation: [] },
      open: false,
    };
    current = made;
    return made;
  };

  const lines = text.replace(/^\ufeff/, '').replace(/\r\n?/g, '\n').split('\n');
  lines.forEach((raw, index) => {
    const line = index + 1;
    const open = current?.type === 'question' && current.open ? current : null;
    if (open && raw.startsWith('  ') && !/^\s*$/.test(raw)) {
      const words = raw.slice(2);
      open.options[open.options.length - 1].lines.push(words.startsWith('\\') ? words.slice(1) : words);
      return;
    }
    const kind = classify(raw);
    switch (kind.kind) {
      case 'blank':
        flush();
        return;
      case 'heading':
        flush();
        blocks.push({ type: 'heading', line, text: kind.text, size: kind.size });
        return;
      case 'divider':
        flush();
        blocks.push({ type: 'divider', line });
        return;
      case 'page':
        flush();
        blocks.push({ type: 'page', line, title: kind.title });
        return;
      case 'image':
        flush();
        blocks.push({ type: 'image', line, caption: kind.caption });
        return;
      case 'video':
        flush();
        blocks.push({ type: 'video', line, url: kind.url === null ? null : cleanVideoUrl(kind.url) ?? kind.url, caption: kind.caption });
        return;
      case 'note':
        flush();
        current = { type: 'note', line, tone: kind.tone, lines: [kind.text] };
        return;
      case 'cover':
        flush();
        current = { type: 'cover', line, title: kind.title, subtitle: null };
        return;
      case 'option': {
        const target = question(line);
        target.options.push({ right: kind.right, lines: [kind.text] });
        target.at.options.push(line);
        target.open = true;
        return;
      }
      case 'form': {
        const target = question(line);
        target.forms.push(kind.text);
        target.at.forms.push(line);
        target.open = false;
        return;
      }
      case 'kindmark': {
        // release 48: the tag of a new kind ends the question's words; its key stays the canvas's
        const q = question(line);
        q.kind = TAG_KINDS[kind.tag];
        q.open = false;
        return;
      }
      case 'explain':
        if (current?.type !== 'question') {
          problems.push(say(line, 'пояснение «>» ставят сразу после вариантов вопроса. Перенесите его или уберите «>».'));
          return;
        }
        current.explanation.push(kind.text);
        current.at.explanation.push(line);
        current.open = false;
        return;
      case 'content':
        if (current?.type === 'text' || current?.type === 'note') current.lines.push(kind.text);
        else if (current?.type === 'cover' && current.subtitle === null) current.subtitle = kind.text;
        else {
          flush();
          current = { type: 'text', line, lines: [kind.text] };
        }
        return;
    }
  });
  flush();
  return { blocks, problems };
}

// ─────────────────────────────────────────────── matching the text to the page

/** A block as the text shows it: what fromText compares (the page's settings the text does not show are left out). */
type Content =
  | { type: 'cover'; title: string; subtitle: string }
  | { type: 'heading'; text: string; size: 'l' | 'm' }
  | { type: 'text'; text: string }
  | { type: 'image'; caption: string }
  | { type: 'video'; url: string; caption: string }
  | { type: 'note'; tone: Tone; text: string }
  | { type: 'divider' }
  | { type: 'page'; title: string }
  | { type: 'question'; question: QuestionText };

function contentOf(block: DocBlock, rows: ReadonlyMap<string, TestItem>): Content | null {
  switch (block.type) {
    case 'cover':
      return { type: 'cover', title: block.title, subtitle: block.subtitle };
    case 'heading':
      return { type: 'heading', text: block.text, size: block.size };
    case 'text':
      return { type: 'text', text: block.text };
    case 'image':
      return { type: 'image', caption: block.caption };
    case 'video':
      return { type: 'video', url: block.url, caption: block.caption };
    case 'note':
      return { type: 'note', tone: block.tone, text: block.text };
    case 'divider':
      return { type: 'divider' };
    case 'page':
      return { type: 'page', title: block.title };
    case 'question': {
      const item = rows.get(block.item_id);
      return item ? { type: 'question', question: questionOf(item) } : null;
    }
  }
}

function contentOfParsed(parsed: Parsed): Content {
  switch (parsed.type) {
    case 'cover':
      return { type: 'cover', title: parsed.title, subtitle: parsed.subtitle };
    case 'heading':
      return { type: 'heading', text: parsed.text, size: parsed.size };
    case 'text':
      return { type: 'text', text: parsed.text };
    case 'image':
      return { type: 'image', caption: parsed.caption };
    case 'video':
      return { type: 'video', url: parsed.url ?? '', caption: parsed.caption };
    case 'note':
      return { type: 'note', tone: parsed.tone, text: parsed.text };
    case 'divider':
      return { type: 'divider' };
    case 'page':
      return { type: 'page', title: parsed.title };
    case 'question':
      return { type: 'question', question: parsed.question };
  }
}

/** The fields in a fixed order: equal blocks give equal keys. */
function fieldsOf(content: Content): unknown[] {
  switch (content.type) {
    case 'cover':
      return [content.title, content.subtitle];
    case 'heading':
      return [content.text, content.size];
    case 'text':
      return [content.text];
    case 'image':
      return [content.caption];
    case 'video':
      return [content.url, content.caption];
    case 'note':
      return [content.tone, content.text];
    case 'divider':
      return [];
    case 'page':
      return [content.title];
    case 'question': {
      const { stem, short, options, correct, forms, explanation, kind } = content.question;
      return kind ? [stem, kind, explanation] : [stem, short, options, correct, forms, explanation];
    }
  }
}

const keyOf = (content: Content) => JSON.stringify([content.type, ...fieldsOf(content)]);

function wordsOf(content: Content): Set<string> {
  const text = fieldsOf(content)
    .flat()
    .filter((value): value is string => typeof value === 'string')
    .join(' ');
  return new Set(text.toLowerCase().replace(/ё/g, 'е').split(/[^\p{L}\p{N}]+/u).filter(Boolean));
}

function similarity(a: Content, b: Content): number {
  const x = wordsOf(a);
  const y = wordsOf(b);
  if (x.size === 0 && y.size === 0) return 1;
  let both = 0;
  for (const word of x) if (y.has(word)) both += 1;
  return both / (x.size + y.size - both);
}

/** The longest run of pairs whose page places grow (the pairs that stayed in place). */
function anchorsOf(pairs: Array<[number, number]>): Array<[number, number]> {
  const tails: number[] = [];
  const before: number[] = [];
  pairs.forEach(([oldAt], at) => {
    let lo = 0;
    let hi = tails.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (pairs[tails[mid]][0] < oldAt) lo = mid + 1;
      else hi = mid;
    }
    before[at] = lo > 0 ? tails[lo - 1] : -1;
    tails[lo] = at;
  });
  const chain: Array<[number, number]> = [];
  for (let at = tails.length > 0 ? tails[tails.length - 1] : -1; at >= 0; at = before[at]) chain.unshift(pairs[at]);
  return chain;
}

/** For each new block, the old one it is (an index), or -1 for a new block. */
function matchBlocks(olds: readonly Content[], news: readonly Content[]): number[] {
  const toOld = news.map(() => -1);
  const taken = olds.map(() => false);
  const byKey = new Map<string, number[]>();
  olds.forEach((content, at) => {
    const key = keyOf(content);
    byKey.set(key, [...(byKey.get(key) ?? []), at]);
  });
  news.forEach((content, at) => {
    const queue = byKey.get(keyOf(content));
    const oldAt = queue?.shift();
    if (oldAt === undefined) return;
    toOld[at] = oldAt;
    taken[oldAt] = true;
  });
  const pairs = news.flatMap((_, at): Array<[number, number]> => (toOld[at] >= 0 ? [[toOld[at], at]] : []));
  const anchors: Array<[number, number]> = [[-1, -1], ...anchorsOf(pairs), [olds.length, news.length]];
  for (let gap = 1; gap < anchors.length; gap += 1) {
    const oldGap: number[] = [];
    const newGap: number[] = [];
    for (let at = anchors[gap - 1][0] + 1; at < anchors[gap][0]; at += 1) if (!taken[at]) oldGap.push(at);
    for (let at = anchors[gap - 1][1] + 1; at < anchors[gap][1]; at += 1) if (toOld[at] < 0) newGap.push(at);
    if (oldGap.length > 0 && newGap.length > 0) alignGap(olds, news, oldGap, newGap, toOld);
  }
  return toOld;
}

/** Inside one gap: as many pairs of the same type as the order allows, the likeliest ones among them. */
function alignGap(olds: readonly Content[], news: readonly Content[], oldGap: number[], newGap: number[], toOld: number[]): void {
  const score = (a: number, b: number) => {
    const x = olds[oldGap[a]];
    const y = news[newGap[b]];
    return x.type === y.type ? 1000 + Math.round(similarity(x, y) * 999) : -1;
  };
  const rows = oldGap.length + 1;
  const cols = newGap.length + 1;
  const best: number[][] = Array.from({ length: rows }, () => new Array<number>(cols).fill(0));
  for (let a = 1; a < rows; a += 1) {
    for (let b = 1; b < cols; b += 1) {
      const pair = score(a - 1, b - 1);
      best[a][b] = Math.max(best[a - 1][b], best[a][b - 1], pair >= 0 ? best[a - 1][b - 1] + pair : -1);
    }
  }
  for (let a = rows - 1, b = cols - 1; a > 0 && b > 0; ) {
    const pair = score(a - 1, b - 1);
    if (pair >= 0 && best[a][b] === best[a - 1][b - 1] + pair) {
      toOld[newGap[b - 1]] = oldGap[a - 1];
      a -= 1;
      b -= 1;
    } else if (best[a][b] === best[a - 1][b]) a -= 1;
    else b -= 1;
  }
}

// ─────────────────────────────────────────────── checks and changes of one question

const DRAFT_WORDS: Record<DraftProblem, string> = {
  stem: 'у вопроса нет текста. Напишите его перед вариантами.',
  stem_long: 'вопрос длиннее 4000 знаков. Сократите его.',
  option_empty: 'пустой вариант. Напишите его или удалите строку.',
  option_long: 'вариант длиннее 600 знаков. Сократите его.',
  options_few: 'у вопроса один вариант. Добавьте ещё хотя бы один.',
  options_many: 'вариантов больше 8. Оставьте не больше восьми.',
  options_size: 'варианты вместе слишком длинные. Сократите их.',
  forms: 'после «=» напишите верный ответ.',
  form_long: 'ответ длиннее 200 знаков. Сократите его.',
  explanation_long: 'пояснение длиннее 2000 знаков. Сократите его.',
  // release 48: the new kinds are edited on the canvas, never from the text (their block keeps its key)
  numbers: 'у вопроса нет верного числа.',
  tolerance: 'допуск — не число.',
  unit_long: 'единица длиннее 20 знаков.',
  pairs: 'у строки нет пары.',
  pairs_same: 'два одинаковых ответа.',
  pair_long: 'ответ длиннее 200 знаков.',
  pairs_many: 'ответов больше десяти.',
  gaps: 'в тексте нет пропуска.',
  gaps_many: 'пропусков больше десяти.',
  gap_forms: 'у пропуска нет верного ответа.',
  materials_many: 'лекций больше десяти.',
};

function questionProblems(draft: Draft, question: QuestionText, lines: Lines): TextProblem[] {
  const out: TextProblem[] = [];
  // A question with an option problem has options (one without them is a short answer, with forms).
  const optionLine = (test: (option: string) => boolean) => lines.options[Math.max(0, question.options.findIndex(test))];
  if (lines.options.length > 0 && lines.forms.length > 0) {
    out.push(say(lines.forms[0], 'у вопроса и варианты, и ответ «=». Оставьте что-то одно.'));
  }
  for (const problem of draftProblems(draft)) {
    let line = lines.first;
    let words = DRAFT_WORDS[problem];
    if (problem === 'option_empty') line = optionLine((option) => !option.trim());
    else if (problem === 'option_long') line = optionLine((option) => option.trim().length > LIMITS.option);
    else if (problem === 'options_many') line = lines.options[LIMITS.optionsMax];
    else if (problem === 'options_few' || problem === 'options_size') line = optionLine(() => true);
    else if (problem === 'forms' || problem === 'form_long') {
      line = lines.forms[0];
      if (question.forms.length > LIMITS.forms) words = 'верных ответов больше 10. Оставьте не больше десяти.';
    } else if (problem === 'explanation_long') line = lines.explanation[0];
    out.push(say(line, words));
  }
  if (!question.short && question.options.length > 0 && question.correct.length === 0) {
    out.push(say(lines.options[0], 'у вопроса нет верного варианта. Отметьте его «+».'));
  }
  return out;
}

/** The text's question laid over the editor's draft of the row (pictures stay with their place). */
function draftWith(base: Draft, question: QuestionText): Draft {
  // release 48: a new kind takes only its words from the text
  if (question.kind && base.kind === question.kind) return { ...base, stem: question.stem, explanation: question.explanation };
  const pictures = (at: number) => base.options[at]?.pictures ?? [];
  return {
    ...base,
    stem: isPictureWord(question.stem) && base.stemPictures.length > 0 ? '' : question.stem,
    short: question.short,
    options: question.options.map((text, at) => ({ text: isPictureWord(text) && pictures(at).length > 0 ? '' : text, pictures: [...pictures(at)] })),
    correct: [...question.correct],
    forms: question.forms.join('; '),
    explanation: question.explanation,
  };
}

/** The patch of a changed question: the editor's patch without what the editor would change on any save (its tidying). */
function patchFor(item: TestItem, question: QuestionText): ItemPatch | null {
  const patch = patchOf(item, draftWith(draftOf(item), question));
  if (!patch) return null;
  const tidy: Record<string, unknown> = { ...(patchOf(item, draftOf(item)) ?? {}) };
  const kept: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(patch)) if (!(key in tidy) || !sameValue(tidy[key], value)) kept[key] = value;
  return Object.keys(kept).length > 0 ? (kept as ItemPatch) : null;
}

function blockProblems(parsed: Exclude<Parsed, { type: 'question' }>): TextProblem[] {
  const long = (text: string, max: number) => chars(text) > max;
  const at = parsed.line;
  switch (parsed.type) {
    case 'heading':
      if (!hasWords(parsed.text)) return [say(at, 'пустой заголовок. Допишите его или удалите строку.')];
      return long(parsed.text, DOC_TITLE_MAX) ? [say(at, 'заголовок длиннее 200 знаков. Сократите его.')] : [];
    case 'text':
      if (!hasWords(parsed.text)) return [say(at, 'пустой текст. Удалите эту строку.')];
      return long(parsed.text, DOC_TEXT_MAX) ? [say(at, 'текст длиннее 4000 знаков. Разделите его пустой строкой.')] : [];
    case 'note':
      if (!hasWords(parsed.text)) return [say(at, 'пустая заметка. Допишите её или удалите строку.')];
      return long(parsed.text, DOC_TEXT_MAX) ? [say(at, 'заметка длиннее 4000 знаков. Сократите её.')] : [];
    case 'cover': {
      const out: TextProblem[] = [];
      if (!hasWords(parsed.title)) out.push(say(at, 'у обложки нет названия. Напишите его после «[обложка]».'));
      else if (long(parsed.title, DOC_TITLE_MAX)) out.push(say(at, 'название на обложке длиннее 200 знаков. Сократите его.'));
      if (long(parsed.subtitle, DOC_CAPTION_MAX)) out.push(say(at + 1, 'подзаголовок обложки длиннее 300 знаков. Сократите его.'));
      return out;
    }
    case 'image':
      return long(parsed.caption, DOC_CAPTION_MAX) ? [say(at, 'подпись картинки длиннее 300 знаков. Сократите её.')] : [];
    case 'video': {
      const out: TextProblem[] = [];
      if (parsed.url === null) out.push(say(at, 'ссылку на видео пишут в скобках сразу после метки: [видео](https://…).'));
      else if (!videoUrlOk(parsed.url)) out.push(say(at, 'это не ссылка на видео YouTube, RuTube или VK Видео. Проверьте адрес.'));
      if (long(parsed.caption, DOC_CAPTION_MAX)) out.push(say(at, 'подпись видео длиннее 300 знаков. Сократите её.'));
      return out;
    }
    case 'page':
      return long(parsed.title, DOC_TITLE_MAX) ? [say(at, 'название страницы длиннее 200 знаков. Сократите его.')] : [];
    case 'divider':
      return [];
  }
}

/** The block's words from the text; its other settings (alignment, width, picture, points) from the page. */
function blockFrom(parsed: Exclude<Parsed, { type: 'question' | 'image' }>, id: string, old: DocBlock | null): DocBlock {
  switch (parsed.type) {
    case 'cover': {
      const base = old?.type === 'cover' ? old : null;
      return { type: 'cover', id, title: parsed.title, subtitle: parsed.subtitle, image: base?.image ?? null, align: base?.align ?? 'center' };
    }
    case 'heading':
      return { type: 'heading', id, text: parsed.text, size: parsed.size };
    case 'text':
      return { type: 'text', id, text: parsed.text, align: old?.type === 'text' ? old.align : 'left' };
    case 'note':
      return { type: 'note', id, tone: parsed.tone, text: parsed.text };
    case 'divider':
      return { type: 'divider', id };
    case 'page':
      return { type: 'page', id, title: parsed.title };
    case 'video':
      return { type: 'video', id, url: parsed.url ?? '', caption: parsed.caption };
  }
}

// ─────────────────────────────────────────────── text → the document and the rows

export interface TextResult {
  doc: TestDoc;
  /** New rows for container_items_add (refs `<importId>:<n>`); their blocks hold the ref until bindRefs. */
  adds: ItemInput[];
  /** container_item_update for each. */
  updates: Array<{ id: string; patch: ItemPatch }>;
  /** Rows to delete: questions that were on the page and are not in the text. */
  removes: string[];
  problems: TextProblem[];
}

export interface FromTextOptions {
  random?: RandomFill;
  /** The first part of the new rows' refs ([A-Za-z0-9_.-]); a fresh «text-…» by default (a resent batch adds nothing twice). */
  importId?: string;
}

/** The text read back into the page: the document as the text has it and the rows to add, patch and delete. */
export function fromText(text: string, doc: TestDoc, items: readonly TestItem[], options: FromTextOptions = {}): TextResult {
  const random = options.random ?? cryptoFill;
  const rows = new Map(items.map((item) => [item.id, item]));
  const { blocks: parsed, problems } = parse(text);

  const olds: Array<{ block: DocBlock; content: Content; item?: TestItem }> = [];
  for (const block of doc.blocks) {
    const content = contentOf(block, rows);
    if (content) olds.push({ block, content, item: block.type === 'question' ? rows.get(block.item_id) : undefined });
  }
  const toOld = matchBlocks(
    olds.map((entry) => entry.content),
    parsed.map(contentOfParsed),
  );

  const ids = new Set(doc.blocks.map((block) => block.id));
  const importId = options.importId ?? `text-${newId(random)}`;
  let fileNo = 0;
  for (const item of items) if (/^\d+$/.test(item.file_no.trim())) fileNo = Math.max(fileNo, Number(item.file_no.trim()));

  const blocks: DocBlock[] = [];
  const blockLines: number[] = [];
  const adds: ItemInput[] = [];
  const updates: Array<{ id: string; patch: ItemPatch }> = [];
  const put = (block: DocBlock, line: number) => {
    blocks.push(block);
    blockLines.push(line);
  };
  parsed.forEach((entry, at) => {
    const old = toOld[at] >= 0 ? olds[toOld[at]] : null;
    const changed = !old || keyOf(old.content) !== keyOf(contentOfParsed(entry));
    if (entry.type === 'question') {
      // A matched question is always a question of the page (matching keeps to one type), with its row.
      const item = old?.item;
      if (old && item && (entry.question.kind ?? null) !== (KIND_TAGS[item.kind] ? item.kind : null)) {
        // release 48: a kind changes on the canvas, not by its tag
        put(old.block, entry.line);
        if (changed) problems.push(say(entry.line, 'тип вопроса меняют на холсте или в списке. Верните строку как была.'));
        return;
      }
      if (old && item) {
        put(old.block, entry.line);
        if (!changed) return;
        problems.push(...questionProblems(draftWith(draftOf(item), entry.question), entry.question, entry.lines));
        const patch = patchFor(item, entry.question);
        if (patch) updates.push({ id: item.id, patch });
        return;
      }
      if (entry.question.kind) {
        problems.push(say(entry.line, 'вопрос этого типа добавьте на холсте или в списке: его ключ правится там.'));
        return;
      }
      const draft: Draft = {
        ...draftWith(emptyDraft(), entry.question),
        keepOrder: isTrueFalse(entry.question.options) || orderBound(entry.question.options) >= 0,
      };
      problems.push(...questionProblems(draft, entry.question, entry.lines));
      const ref = `${importId}:${adds.length + 1}`;
      fileNo += 1;
      adds.push(inputOf(draft, String(fileNo), ref));
      put({ type: 'question', id: freshId(ids, random), item_id: ref, points: 1, required: false }, entry.line);
      return;
    }
    if (old && !changed) {
      put(old.block, entry.line);
      return;
    }
    problems.push(...blockProblems(entry));
    if (entry.type === 'image') {
      if (old?.block.type === 'image') put({ ...old.block, caption: entry.caption }, entry.line);
      else problems.push(say(entry.line, 'новую картинку добавьте на холсте. В тексте её можно только подписать или переставить.'));
      return;
    }
    put(blockFrom(entry, old ? old.block.id : freshId(ids, random), old?.block ?? null), entry.line);
  });

  const kept = new Set(toOld);
  const removes = olds.flatMap((entry, at) => (!kept.has(at) && entry.block.type === 'question' ? [entry.block.item_id] : []));
  if (blocks.length > DOC_MAX_BLOCKS) problems.push(say(blockLines[DOC_MAX_BLOCKS], 'блоков больше 400. Уберите лишние.'));
  problems.sort((a, b) => a.line - b.line);

  const next: TestDoc = { ...doc, blocks };
  return { doc: sameValue(next, doc) ? doc : next, adds, updates, removes, problems };
}
