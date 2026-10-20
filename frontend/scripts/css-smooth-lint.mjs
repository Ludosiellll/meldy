#!/usr/bin/env node
/**
 * Smoothness lint of the app's CSS (owner's rule of 20.10: no jank anywhere, the look unchanged). It fails on
 *   1. an endless animation (animation-iteration-count infinite) whose keyframes change a property the compositor
 *      cannot animate on its own: box-shadow, filter, backdrop-filter, background-position, width, height, left, top,
 *      right, bottom, inset — the page is repainted (or laid out) on every frame for as long as it runs;
 *   2. :has() around :active, :hover or :focus — a press, a hover or a focus then restyles the whole subtree the rule
 *      could match (keyboard-only :focus-visible is allowed);
 *   3. a transition of box-shadow, of a size (width, height) or of a position (left, top, right, bottom, inset), or of
 *      `all`, that is not in the baseline below: those repaint or lay out on every frame of the transition. The ones
 *      that were there on 20.10 are listed in css-smooth-baseline.json; the list may only get shorter.
 *
 * The exceptions of 1 and 2 are in css-smooth-baseline.json too, each with the reason and the owner who will fix it.
 *
 * node scripts/css-smooth-lint.mjs            → prints the findings, exit 1 on a new one
 * node scripts/css-smooth-lint.mjs --update   → writes the transitions found now as the baseline (keeps the
 *                                                allowlist of 1 and 2 as it is)
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(here, '../src');
const BASELINE = path.join(here, 'css-smooth-baseline.json');

const PAINT_PROPS = new Set([
  'box-shadow', 'filter', 'backdrop-filter', '-webkit-backdrop-filter', 'background-position', 'background-position-x',
  'background-position-y', 'width', 'height', 'left', 'top', 'right', 'bottom', 'inset',
]);
const TRANSITION_PROPS = new Set(['box-shadow', 'width', 'height', 'left', 'top', 'right', 'bottom', 'inset', 'all']);

function cssFiles(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...cssFiles(full));
    else if (entry.name.endsWith('.css')) out.push(full);
  }
  return out.sort();
}

/** Comments out, strings kept (their length too, so the offsets keep their lines). */
function stripComments(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, (comment) => comment.replace(/[^\n]/g, ' '));
}

/**
 * The style rules of a stylesheet, flattened (at-rules' blocks are walked into): { selector, body, line } per rule,
 * and the keyframes: name → the properties their steps set.
 */
function parse(text) {
  const rules = [];
  const keyframes = new Map();
  const lineAt = (offset) => text.slice(0, offset).split('\n').length;
  const walk = (start, end) => {
    let index = start;
    while (index < end) {
      const open = text.indexOf('{', index);
      if (open < 0 || open >= end) return;
      const head = text.slice(index, open).trim();
      // the matching close
      let depth = 1;
      let close = open + 1;
      while (close < end && depth > 0) {
        if (text[close] === '{') depth += 1;
        else if (text[close] === '}') depth -= 1;
        close += 1;
      }
      const inner = [open + 1, close - 1];
      const keyframesHead = /^@(?:-webkit-)?keyframes\s+([\w-]+)/.exec(head.replace(/^[;\s]+/, ''));
      if (keyframesHead) {
        const props = new Set();
        const body = text.slice(inner[0], inner[1]);
        for (const match of body.matchAll(/([\w-]+)\s*:/g)) props.add(match[1].toLowerCase());
        keyframes.set(keyframesHead[1], props);
      } else if (head.replace(/^[;\s]+/, '').startsWith('@')) {
        walk(inner[0], inner[1]);
      } else {
        const selector = head.replace(/^[^{}]*;/, '').trim();
        const body = text.slice(inner[0], inner[1]);
        if (body.includes('{')) walk(inner[0], inner[1]);
        else rules.push({ selector, body, line: lineAt(open) });
      }
      index = close;
    }
  };
  walk(0, text.length);
  return { rules, keyframes };
}

function declarations(body) {
  const out = [];
  for (const part of body.split(';')) {
    const colon = part.indexOf(':');
    if (colon < 0) continue;
    out.push([part.slice(0, colon).trim().toLowerCase(), part.slice(colon + 1).trim()]);
  }
  return out;
}

/** The arguments of each :has( … ) of a selector, nested parentheses kept. */
function hasArguments(selector) {
  const out = [];
  let at = selector.indexOf(':has(');
  while (at >= 0) {
    let depth = 1;
    let index = at + 5;
    while (index < selector.length && depth > 0) {
      if (selector[index] === '(') depth += 1;
      else if (selector[index] === ')') depth -= 1;
      index += 1;
    }
    out.push(selector.slice(at + 5, index - 1));
    at = selector.indexOf(':has(', index);
  }
  return out;
}

const norm = (selector) => selector.replace(/\s+/g, ' ').trim();

export function lint(root = SRC) {
  const all = { infinite: [], has: [], transitions: [] };
  const sheets = cssFiles(root).map((file) => ({ file: path.relative(root, file).split(path.sep).join('/'), ...parse(stripComments(fs.readFileSync(file, 'utf8'))) }));
  const keyframes = new Map();
  for (const sheet of sheets) for (const [name, props] of sheet.keyframes) keyframes.set(name, new Set([...(keyframes.get(name) ?? []), ...props]));
  for (const { file, rules } of sheets) {
    for (const { selector, body, line } of rules) {
      const decls = declarations(body);
      // 1. endless animations of a property the compositor does not animate
      const animation = decls.filter(([name]) => name === 'animation' || name === 'animation-name' || name === 'animation-iteration-count');
      const endless = animation.some(([, value]) => /\binfinite\b/.test(value));
      if (endless) {
        const names = animation.flatMap(([, value]) => value.split(/[\s,]+/)).filter((word) => keyframes.has(word));
        for (const name of names) {
          const bad = [...keyframes.get(name)].filter((prop) => PAINT_PROPS.has(prop));
          if (bad.length) all.infinite.push({ file, line, selector: norm(selector), animation: name, props: bad });
        }
      }
      // 2. :has() around a press, a hover or a focus
      for (const argument of hasArguments(selector)) {
        if (/:(?:active|hover|focus)(?![\w-])/.test(argument)) all.has.push({ file, line, selector: norm(selector) });
      }
      // 3. transitions of box-shadow, sizes, positions or all
      for (const [name, value] of decls) {
        if (name !== 'transition' && name !== 'transition-property') continue;
        for (const item of value.split(',')) {
          const prop = item.trim().split(/\s+/)[0]?.toLowerCase();
          if (prop && TRANSITION_PROPS.has(prop)) all.transitions.push({ file, line, selector: norm(selector), prop });
        }
      }
    }
  }
  return all;
}

const keyOf = {
  infinite: (item) => `${item.file} :: ${item.selector} :: ${item.animation}`,
  has: (item) => `${item.file} :: ${item.selector}`,
  transitions: (item) => `${item.file} :: ${item.selector} :: ${item.prop}`,
};

export function check(root = SRC, baselineFile = BASELINE) {
  const found = lint(root);
  const baseline = JSON.parse(fs.readFileSync(baselineFile, 'utf8'));
  const allowed = {
    infinite: new Set(Object.keys(baseline.infinite ?? {})),
    has: new Set(Object.keys(baseline.has ?? {})),
    transitions: new Set(baseline.transitions ?? []),
  };
  const problems = [];
  for (const kind of ['infinite', 'has', 'transitions']) {
    for (const item of found[kind]) if (!allowed[kind].has(keyOf[kind](item))) problems.push({ kind, ...item });
  }
  return { found, problems };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  if (process.argv.includes('--update')) {
    const found = lint();
    const old = fs.existsSync(BASELINE) ? JSON.parse(fs.readFileSync(BASELINE, 'utf8')) : {};
    const next = {
      _: old._ ?? 'Smoothness lint baseline (scripts/css-smooth-lint.mjs). infinite and has: allowed exceptions with their owner and reason. transitions: the box-shadow, size and position transitions there were on 20.10; the list may only get shorter.',
      owners: old.owners ?? {},
      infinite: old.infinite ?? {},
      has: old.has ?? {},
      transitions: [...new Set(found.transitions.map(keyOf.transitions))].sort(),
    };
    fs.writeFileSync(BASELINE, JSON.stringify(next, null, 2) + '\n');
    console.log(`baseline: ${next.transitions.length} transitions`);
  } else {
    const { found, problems } = check();
    if (process.argv.includes('--all')) console.log(JSON.stringify(found, null, 1));
    for (const p of problems) console.log(`${p.kind}: ${p.file}:${p.line} ${p.selector}${p.animation ? ` (animation ${p.animation}: ${p.props.join(', ')})` : ''}${p.prop ? ` (transition ${p.prop})` : ''}`);
    console.log(problems.length ? `css-smooth-lint: ${problems.length} new problem(s)` : 'css-smooth-lint: ok');
    process.exit(problems.length ? 1 : 0);
  }
}
