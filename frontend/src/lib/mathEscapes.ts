/**
 * LaTeX that lost its backslash on the way from the model (finding LIB-2, 2026-10-08).
 *
 * The model wrote formulas into JSON with one backslash, and json.loads on the server read `\text` as a TAB
 * and «ext», `\frac` as a form feed and «rac», `\beta` as a backspace, `\rho` as a carriage return, `\neq`
 * as a new line and «eq». The server keeps the backslash now (backend utils.repair_latex_escapes); lectures
 * analysed before that keep the control characters in their summaries, cards and tests, and KaTeX showed
 * «extCOUNT». repairMathEscapes puts the backslash back — only inside formulas ($…$ and $$…$$, never in
 * code), so the text around them, its real line breaks included, is not touched:
 *
 * - TAB, form feed, backspace, carriage return before a letter → \t, \f, \b, \r;
 * - a new line before letters that spell exactly a LaTeX command that begins with \n (\neq, \nu, \nabla…) →
 *   \n…; \ne and \ni (too short to tell from a line that starts with «e» or «i») only inside $…$, not right
 *   after the opening $.
 *
 * The same names as the server's list. Pure, no DOM.
 */

const N_COMMANDS = new Set([
  'nu', 'neq', 'neg', 'not', 'notin', 'nabla', 'natural', 'nearrow', 'nwarrow', 'newline', 'nolimits',
  'nonumber', 'notag', 'nexists', 'nleq', 'ngeq', 'nleqslant', 'ngeqslant', 'nsubseteq', 'nsupseteq',
  'nparallel', 'nshortparallel', 'nrightarrow', 'nleftarrow', 'nleftrightarrow', 'nRightarrow',
  'nLeftarrow', 'nLeftrightarrow', 'nvdash', 'nvDash', 'nVdash',
]);
const N_INLINE = new Set(['ne', 'ni']);
const LOST: Record<string, string> = { '\t': '\\t', '\f': '\\f', '\b': '\\b', '\r': '\\r' };

/** Characters a lost backslash leaves; without one of them (and a dollar sign) nothing is done. */
const MARKS = /[\t\f\b\r\n]/;

type FormulaKind = 'inline' | 'display';

/** One formula's text with the backslashes back. */
export function repairFormula(body: string, kind: FormulaKind = 'display'): string {
  return body
    .replace(/[\t\f\b\r](?=[A-Za-z])/g, (mark) => LOST[mark])
    .replace(/\n([A-Za-z]+)/g, (whole, rest: string, offset: number) => {
      // The new line was the «\n» of the command: «\neq» is a new line and «eq».
      const name = `n${rest}`;
      return N_COMMANDS.has(name) || (kind === 'inline' && offset > 0 && N_INLINE.has(name)) ? `\\${name}` : whole;
    });
}

/** Where the inline formula that opens at `from` (after its $) closes, or -1: the next lone $ before a blank line. */
function inlineEnd(text: string, from: number): number {
  for (let i = from; i < text.length; i += 1) {
    const ch = text[i];
    if (ch === '\\') {
      i += 1;
      continue;
    }
    if (ch === '\n' && /^\n[ \t]*\n/.test(text.slice(i, i + 64))) return -1;
    if (ch === '$') return text[i + 1] === '$' ? -1 : i;
  }
  return -1;
}

/** Where the display formula that opens at `from` (after its $$) closes, or -1. */
function displayEnd(text: string, from: number): number {
  for (let i = from; i < text.length - 1; i += 1) {
    if (text[i] === '\\') {
      i += 1;
      continue;
    }
    if (text[i] === '$' && text[i + 1] === '$') return i;
  }
  return -1;
}

/** The end of a fenced code block that opens at `from` (a line starting with ``` or ~~~), past its closing fence. */
function fenceEnd(text: string, from: number): number {
  const fence = text.slice(from, from + 3);
  const lineEnd = text.indexOf('\n', from);
  if (lineEnd < 0) return text.length;
  const close = text.indexOf(`\n${fence}`, lineEnd);
  if (close < 0) return text.length;
  const after = text.indexOf('\n', close + 1 + fence.length);
  return after < 0 ? text.length : after;
}

/**
 * The Markdown of a summary, a card or a test with the lost backslashes back inside its formulas.
 * A text without formulas or without the marks comes back as it is (the same string).
 */
export function repairMathEscapes(text: string): string {
  if (typeof text !== 'string' || !text.includes('$') || !MARKS.test(text)) return text;
  let out = '';
  let i = 0;
  while (i < text.length) {
    const lineStart = i === 0 || text[i - 1] === '\n';
    const fence = lineStart ? /^( {0,3})(```|~~~)/.exec(text.slice(i, i + 6)) : null;
    if (fence) {
      const end = fenceEnd(text, i + fence[1].length);
      out += text.slice(i, end);
      i = end;
      continue;
    }
    const ch = text[i];
    if (ch === '`') {
      let run = 1;
      while (text[i + run] === '`') run += 1;
      const ticks = '`'.repeat(run);
      const close = text.indexOf(ticks, i + run);
      const end = close < 0 ? i + run : close + run;
      out += text.slice(i, end);
      i = end;
      continue;
    }
    if (ch === '\\') {
      out += text.slice(i, i + 2);
      i += 2;
      continue;
    }
    if (ch === '$') {
      const display = text[i + 1] === '$';
      const open = display ? 2 : 1;
      const close = display ? displayEnd(text, i + 2) : inlineEnd(text, i + 1);
      if (close < 0) {
        out += text.slice(i, i + open);
        i += open;
        continue;
      }
      out += text.slice(i, i + open) + repairFormula(text.slice(i + open, close), display ? 'display' : 'inline') + text.slice(close, close + open);
      i = close + open;
      continue;
    }
    out += ch;
    i += 1;
  }
  return out === text ? text : out;
}
