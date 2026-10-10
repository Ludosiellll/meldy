#!/usr/bin/env node
/**
 * Copies the exam container's pure modules into supabase/functions/_shared/plan/ for the Telegram bot (spec
 * Telegram_Bot_Spec_2026-10-09 §6.8): the bot plans the day with the same code as «Сегодня» and never re-implements it.
 *
 * The copy is byte-exact except for import specifiers, which are rewritten to explicit `.ts` paths inside the flat
 * folder (`'./pace'` → `'./pace.ts'`, `'../../types/container'` → `'./container.ts'`). Any other import (npm, another
 * folder) stops the script: the bot runs in Deno without a bundler, so such a module needs a change in the frontend.
 * SOURCE_HASH is the sha256 of the frontend sources; supabase/functions/_shared/plan/copy.test.ts fails when it, or
 * a copy, no longer matches them.
 *
 *   node scripts/sync_bot_plan.mjs          write the copies and SOURCE_HASH
 *   node scripts/sync_bot_plan.mjs --check  exit 1 when the copy is stale (writes nothing)
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, posix, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const TARGET_DIR = 'supabase/functions/_shared/plan';

/** [frontend source, file name in the copy]. plan.ts needs pace.ts; the bot decodes plan_inputs with planInputs.ts. */
export const SOURCES = [
  ['frontend/src/lib/containers/rule.ts', 'rule.ts'],
  ['frontend/src/lib/containers/time.ts', 'time.ts'],
  ['frontend/src/lib/containers/pace.ts', 'pace.ts'],
  ['frontend/src/lib/containers/plan.ts', 'plan.ts'],
  ['frontend/src/lib/containers/planInputs.ts', 'planInputs.ts'],
  ['frontend/src/lib/containers/session.ts', 'session.ts'],
  ['frontend/src/lib/containers/words.ts', 'words.ts'],
  ['frontend/src/lib/containers/group.ts', 'group.ts'],
  ['frontend/src/types/container.ts', 'container.ts'],
  // T11: the oral plan's pure core (the bot reads the same sheet and journal as the site, through bot_oral_inputs).
  ['frontend/src/lib/containers/oralParts.ts', 'oralParts.ts'],
  ['frontend/src/lib/exams/cheatSheet.ts', 'cheatSheet.ts'],
  ['frontend/src/lib/exams/sheetResponse.ts', 'sheetResponse.ts'],
  ['frontend/src/lib/learning/readiness.ts', 'readiness.ts'],
  ['frontend/src/types/learning.ts', 'learning.ts'],
  // A question's words apart from its code, as the site splits them (QuestionCard, «Ключи»): the bot's «занятие» and
  // the group's «Вопрос дня» show the same code block.
  ['frontend/src/lib/containers/codeLines.ts', 'codeLines.ts'],
  ['frontend/src/lib/containers/stemCode.ts', 'stemCode.ts'],
];

const IMPORT_RE = /(\bfrom\s+|\bimport\s*\(\s*|\bimport\s+)(['"])([^'"]+)\2/g;

/** The copy's specifier for a source specifier, or an Error naming what the bot cannot load. */
function rewriteSpecifier(fromFile, spec) {
  if (!spec.startsWith('.')) return new Error(`${fromFile}: imports '${spec}' (not a relative module)`);
  const target = posix.normalize(posix.join(posix.dirname(fromFile), spec));
  const withTs = target.endsWith('.ts') ? target : `${target}.ts`;
  const hit = SOURCES.find(([source]) => source === withTs);
  if (!hit) return new Error(`${fromFile}: imports '${spec}', which is not copied (${withTs})`);
  return `./${hit[1]}`;
}

/** The copied text of one source: only the import specifiers change. */
export function transform(fromFile, text) {
  const problems = [];
  const out = text.replace(IMPORT_RE, (whole, head, quote, spec) => {
    const next = rewriteSpecifier(fromFile, spec);
    if (next instanceof Error) {
      problems.push(next.message);
      return whole;
    }
    return `${head}${quote}${next}${quote}`;
  });
  if (problems.length > 0) throw new Error(`sync_bot_plan: the bot cannot load these imports:\n- ${problems.join('\n- ')}`);
  return out;
}

const sha256 = (text) => createHash('sha256').update(text).digest('hex');

/** sha256 over «path\nsha256(content)\n» of every source, in path order. */
export function sourceHash(read = (file) => readFileSync(join(ROOT, file), 'utf8')) {
  const parts = [...SOURCES].map(([source]) => source).sort().map((source) => `${source}\n${sha256(read(source))}\n`);
  return sha256(parts.join(''));
}

/** Every file of the copy as it should be: name → text. */
export function expectedFiles(read = (file) => readFileSync(join(ROOT, file), 'utf8')) {
  const files = new Map();
  for (const [source, name] of SOURCES) files.set(name, transform(source, read(source)));
  files.set('SOURCE_HASH', `${sourceHash(read)}\n`);
  return files;
}

/** Names of the copied files that differ from what the sources give (missing ones included). */
export function staleFiles() {
  const stale = [];
  for (const [name, text] of expectedFiles()) {
    const path = join(ROOT, TARGET_DIR, name);
    if (!existsSync(path) || readFileSync(path, 'utf8') !== text) stale.push(name);
  }
  return stale;
}

function main() {
  if (process.argv.includes('--check')) {
    const stale = staleFiles();
    if (stale.length > 0) {
      process.stderr.write(`The bot's plan copy is stale: ${stale.join(', ')}. Run: node scripts/sync_bot_plan.mjs\n`);
      process.exit(1);
    }
    process.stdout.write('The bot\'s plan copy matches the frontend sources.\n');
    return;
  }
  mkdirSync(join(ROOT, TARGET_DIR), { recursive: true });
  for (const [name, text] of expectedFiles()) writeFileSync(join(ROOT, TARGET_DIR, name), text);
  process.stdout.write(`Copied ${SOURCES.length} modules to ${TARGET_DIR}; SOURCE_HASH ${sourceHash()}\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
