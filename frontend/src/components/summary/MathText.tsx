import { Fragment, useMemo } from 'react';
import katex from 'katex';
import 'katex/dist/katex.min.css';
import { repairFormula } from '../../lib/mathEscapes';

/** A piece of a lecture fragment: plain text, or a formula written $…$ (inline) or $$…$$ (display). */
export interface TextPiece {
  kind: 'text' | 'math';
  value: string;
  display?: boolean;
  /** Punctuation right after a short inline formula, kept on its line: «$B$, $C$» never leaves «, C» at a line start. */
  tail?: string;
}

/** A formula this short stays on one line with the punctuation after it; a longer one keeps KaTeX's own breaks. */
const SHORT_FORMULA = 24;
const TRAILING_PUNCTUATION = /^[,.;:!?)\]»…]+/;

/** Moves the punctuation that follows a short inline formula into the formula's piece. */
function keepPunctuation(pieces: TextPiece[]): TextPiece[] {
  const out: TextPiece[] = [];
  for (let i = 0; i < pieces.length; i += 1) {
    const piece = pieces[i];
    const next = pieces[i + 1];
    const short = piece.kind === 'math' && !piece.display && piece.value.length <= SHORT_FORMULA;
    const tail = short && next?.kind === 'text' ? TRAILING_PUNCTUATION.exec(next.value)?.[0] : undefined;
    if (!tail || !next) {
      out.push(piece);
      continue;
    }
    out.push({ ...piece, tail });
    const rest = next.value.slice(tail.length);
    if (rest) out.push({ kind: 'text', value: rest });
    i += 1;
  }
  return out;
}

/** Where the formula opened before `from` closes: the next unescaped $, if it can close one; else -1. */
function inlineClose(text: string, from: number): number {
  // «$ 5» or «$» at the end opens nothing.
  if (from >= text.length || /\s|\$/.test(text[from])) return -1;
  for (let i = from; i < text.length; i += 1) {
    const ch = text[i];
    if (ch === '\\') {
      i += 1;
      continue;
    }
    if (ch === '\n' && /^\n[ \t]*\n/.test(text.slice(i, i + 64))) return -1;
    if (ch !== '$') continue;
    // The next $ closes the formula or nothing: a space before it or a digit after it is money («5$ и 10$»).
    return /\s/.test(text[i - 1]) || /\d/.test(text[i + 1] ?? '') ? -1 : i;
  }
  return -1;
}

/** Where the display formula opened before `from` closes ($$), or -1. */
function displayClose(text: string, from: number): number {
  for (let i = from; i < text.length - 1; i += 1) {
    if (text[i] === '\\') {
      i += 1;
      continue;
    }
    if (text[i] === '$' && text[i + 1] === '$') return text.slice(from, i).trim() ? i : -1;
  }
  return -1;
}

/**
 * A fragment of the lecture cut into text and formulas. A page from the web keeps its formulas as LaTeX
 * («$\triangle ABC$», «${\frac {a}{c}}=…\quad…$»), and the fragment panel showed them raw while the конспект drew
 * them (QA 2026-10-11). A $ opens a formula only before a non-space, and the next $ closes it only after a
 * non-space and not before a digit — «цена 5$ и 10$» stays text.
 */
export function splitMath(text: string): TextPiece[] {
  if (!text.includes('$')) return [{ kind: 'text', value: text }];
  const pieces: TextPiece[] = [];
  let plain = '';
  const flush = () => {
    if (plain) pieces.push({ kind: 'text', value: plain });
    plain = '';
  };
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (ch === '\\') {
      plain += text.slice(i, i + 2);
      i += 2;
      continue;
    }
    if (ch === '$' && text[i + 1] === '$') {
      const close = displayClose(text, i + 2);
      if (close > 0) {
        flush();
        pieces.push({ kind: 'math', value: text.slice(i + 2, close), display: true });
        i = close + 2;
        continue;
      }
      plain += '$$';
      i += 2;
      continue;
    }
    if (ch === '$') {
      const close = inlineClose(text, i + 1);
      if (close > 0) {
        flush();
        pieces.push({ kind: 'math', value: text.slice(i + 1, close) });
        i = close + 1;
        continue;
      }
    }
    plain += ch;
    i += 1;
  }
  flush();
  return keepPunctuation(pieces);
}

/** The first `limit` characters of the pieces, cut at a word and never inside a formula, with «…». */
export function shortenPieces(pieces: TextPiece[], limit: number): TextPiece[] {
  const out: TextPiece[] = [];
  let used = 0;
  for (const piece of pieces) {
    if (piece.kind === 'math') {
      // A formula is counted by its source: it is shown whole or not at all.
      const length = piece.value.length + 2 + (piece.tail?.length ?? 0);
      if (used + length > limit) break;
      out.push(piece);
      used += length;
      continue;
    }
    if (used + piece.value.length <= limit) {
      out.push(piece);
      used += piece.value.length;
      continue;
    }
    const head = piece.value.slice(0, limit - used).replace(/\s+\S*$/, '');
    if (head) out.push({ kind: 'text', value: head });
    break;
  }
  out.push({ kind: 'text', value: '…' });
  return out;
}

/** Limits for markup from a lecture: \rule{1pt}{199em} or \kern would stretch the slip (as in ConversationVisual). */
const KATEX_OPTIONS = { throwOnError: true, strict: 'ignore', trust: false, maxSize: 4, maxExpand: 50 } as const;

/** The formula as KaTeX HTML, or null when KaTeX cannot read it: then it is shown as it was written. */
export function formulaHtml(value: string, display = false): string | null {
  try {
    return katex.renderToString(repairFormula(value, display ? 'display' : 'inline'), { ...KATEX_OPTIONS, displayMode: display });
  } catch {
    return null;
  }
}

/** One formula of a fragment, drawn as the конспект draws its formulas. */
export function MathPiece({ piece }: { piece: TextPiece }) {
  const html = useMemo(() => formulaHtml(piece.value, piece.display), [piece.value, piece.display]);
  if (html === null) return <>{`${piece.display ? `$$${piece.value}$$` : `$${piece.value}$`}${piece.tail ?? ''}`}</>;
  const formula = <span className="sv-math" dangerouslySetInnerHTML={{ __html: html }} />;
  if (!piece.tail) return formula;
  return (
    <span className="sv-math-run" style={{ whiteSpace: 'nowrap' }}>
      {formula}
      {piece.tail}
    </span>
  );
}

/** A fragment's text with its formulas drawn. */
export default function MathText({ text }: { text: string }) {
  const pieces = useMemo(() => splitMath(text), [text]);
  return (
    <>
      {pieces.map((piece, index) =>
        piece.kind === 'math' ? <MathPiece key={index} piece={piece} /> : <Fragment key={index}>{piece.value}</Fragment>,
      )}
    </>
  );
}
