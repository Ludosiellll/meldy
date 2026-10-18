/**
 * The text of a text block, a note or a result band (types/testDoc.ts RichText): plain text with three marks only —
 * **bold**, *italic* and [words](https://…). Never HTML: the renderer gets runs of plain text with flags and puts them
 * in elements as text, so whatever else the author typed shows as typed. A link is https only and is shown with its
 * address (`linkAddress`); any other «[words](address)» stays plain text, address and all.
 *
 * The marks follow CommonMark's emphasis rules for `*` (flanking, the rule of three), so `2*3*4` or `* list` read the
 * way they do in any Markdown editor. A backslash keeps a mark as a plain character: `\*`, `\[`, `\]`, `\(`, `\)`, `\\`.
 */
import { DOC_URL_MAX } from '../../types/testDoc';
import { chars } from './doc';

/** A link in the text: https, no spaces, at most 300 characters (stricter than the result screen's link). */
const linkOk = (href: string) => /^https:\/\/\S+$/.test(href) && chars(href) <= DOC_URL_MAX;

export interface RichRun {
  text: string;
  bold: boolean;
  italic: boolean;
  /** https only; null — not a link. */
  href: string | null;
}

interface Delim {
  kind: 'delim';
  count: number;
  readonly size: number;
  readonly open: boolean;
  readonly close: boolean;
}
type Node =
  | { kind: 'text'; text: string }
  | Delim
  | { kind: 'em'; children: Node[] }
  | { kind: 'strong'; children: Node[] }
  | { kind: 'link'; href: string; children: Node[] };

const ESCAPABLE = '\\*[]()';
const SPACE = /\s/;
const PUNCT = /[\p{P}\p{S}]/u;

/** «[words](https://…)» starting at `start`: its words, address and end; null when it is not one. */
function matchLink(src: string, start: number): { words: string; href: string; end: number } | null {
  let at = start + 1;
  while (at < src.length && src[at] !== ']') {
    if (src[at] === '[' || src[at] === '\n') return null;
    at += src[at] === '\\' ? 2 : 1;
  }
  if (at >= src.length || src[at + 1] !== '(') return null;
  const words = src.slice(start + 1, at);
  const close = src.indexOf(')', at + 2);
  if (close < 0 || !words.trim()) return null;
  const href = src.slice(at + 2, close);
  return linkOk(href) ? { words, href, end: close + 1 } : null;
}

function lex(src: string, links: boolean): Node[] {
  const nodes: Node[] = [];
  let buffer = '';
  const flush = () => {
    if (buffer) nodes.push({ kind: 'text', text: buffer });
    buffer = '';
  };
  let at = 0;
  while (at < src.length) {
    const char = src[at];
    if (char === '\\' && at + 1 < src.length && ESCAPABLE.includes(src[at + 1])) {
      buffer += src[at + 1];
      at += 2;
      continue;
    }
    const link = char === '[' && links ? matchLink(src, at) : null;
    if (link) {
      flush();
      nodes.push({ kind: 'link', href: link.href, children: lex(link.words, false) });
      at = link.end;
      continue;
    }
    if (char === '*') {
      let end = at;
      while (src[end] === '*') end += 1;
      const before = at > 0 ? src[at - 1] : ' ';
      const after = end < src.length ? src[end] : ' ';
      const spaceBefore = SPACE.test(before);
      const spaceAfter = SPACE.test(after);
      const punctBefore = PUNCT.test(before);
      const punctAfter = PUNCT.test(after);
      flush();
      nodes.push({
        kind: 'delim',
        count: end - at,
        size: end - at,
        open: !spaceAfter && (!punctAfter || spaceBefore || punctBefore),
        close: !spaceBefore && (!punctBefore || spaceAfter || punctAfter),
      });
      at = end;
      continue;
    }
    buffer += char;
    at += 1;
  }
  flush();
  return emphasis(nodes);
}

/** CommonMark's «process emphasis» on one level: matched star runs wrap what lies between them. */
function emphasis(nodes: Node[]): Node[] {
  const list = [...nodes];
  let closerAt = 0;
  while (closerAt < list.length) {
    const closer = list[closerAt];
    if (closer.kind !== 'delim' || !closer.close || closer.count === 0) {
      closerAt += 1;
      continue;
    }
    let openerAt = -1;
    for (let at = closerAt - 1; at >= 0; at -= 1) {
      const opener = list[at];
      if (opener.kind !== 'delim' || !opener.open || opener.count === 0) continue;
      // The rule of three: «*a**b*» is not «a» in italics followed by «b**».
      if ((opener.close || closer.open) && (opener.size + closer.size) % 3 === 0 && !(opener.size % 3 === 0 && closer.size % 3 === 0)) continue;
      openerAt = at;
      break;
    }
    if (openerAt < 0) {
      closerAt += 1;
      continue;
    }
    const opener = list[openerAt] as Delim;
    const use = opener.count >= 2 && closer.count >= 2 ? 2 : 1;
    opener.count -= use;
    closer.count -= use;
    const children = list.slice(openerAt + 1, closerAt);
    const wrapped: Node = use === 2 ? { kind: 'strong', children } : { kind: 'em', children };
    list.splice(openerAt + 1, closerAt - openerAt - 1, wrapped);
    closerAt = openerAt + 2;
  }
  return list;
}

function flatten(nodes: Node[], style: Omit<RichRun, 'text'>, out: RichRun[]): void {
  const push = (text: string) => {
    if (!text) return;
    const last = out[out.length - 1];
    if (last && last.bold === style.bold && last.italic === style.italic && last.href === style.href) last.text += text;
    else out.push({ text, ...style });
  };
  for (const node of nodes) {
    if (node.kind === 'text') push(node.text);
    else if (node.kind === 'delim') push('*'.repeat(node.count));
    else if (node.kind === 'em') flatten(node.children, { ...style, italic: true }, out);
    else if (node.kind === 'strong') flatten(node.children, { ...style, bold: true }, out);
    else flatten(node.children, { ...style, href: node.href }, out);
  }
}

/** The text as runs to render: neighbours with the same marks are joined; no run is empty. */
export function parseRich(text: string): RichRun[] {
  const runs: RichRun[] = [];
  flatten(lex(text, true), { bold: false, italic: false, href: null }, runs);
  return runs;
}

/** The words without the marks (a link gives its words): for screen readers, search and the checks. */
export function plainOf(text: string): string {
  return parseRich(text)
    .map((run) => run.text)
    .join('');
}

/** Plain words made safe to put into rich text: every mark character kept as it is. plainOf(escapeRich(x)) === x. */
export function escapeRich(plain: string): string {
  return plain.replace(/[\\*[\]]/g, '\\$&');
}

export const LINK_ADDRESS_MAX = 48;

/** The address a link is shown with: without «https://» and a final «/», the host always whole, a long path cut with «…». */
export function linkAddress(href: string): string {
  const rest = href.replace(/^https:\/\//, '').replace(/\/$/, '');
  if (rest.length <= LINK_ADDRESS_MAX) return rest;
  const slash = rest.indexOf('/');
  const host = slash < 0 ? rest : rest.slice(0, slash);
  if (host.length >= LINK_ADDRESS_MAX) return slash < 0 ? host : `${host}/…`;
  return `${rest.slice(0, LINK_ADDRESS_MAX - 1)}…`;
}
