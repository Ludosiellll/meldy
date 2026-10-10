/**
 * The message linter (spec §3, §8.1 «Снимки … и линт»): every message the bot builds passes it in the tests.
 *
 * Telegram's limits: allowed tags only, well nested, no `<code>`/`<pre>` inside `<b>`; 1–4096 visible characters;
 * `callback_data` 1–64 bytes; toasts ≤ 200. The house rules: at most one blue button and only in a private chat,
 * red only for «Отключить»; button widths and rows (§3); no emoji, «!», capitals, «не X, а Y»; the forbidden words
 * of the container's table; no-break spaces after numbers and one-letter words. Copy rules skip code and the user's
 * own content (exam and subject names, question text), passed in `user`.
 */
import type { Button, Keyboard } from './tg.ts';
import { NBSP, typo, visibleText } from './html.ts';

export const LIMITS = {
  text: 4096,
  callbackBytes: 64,
  toast: 200,
  name: 64,
  shortDescription: 120,
  description: 512,
  commandDescription: 256,
};

/** §3: an option button ≤ 24, another full-width button ≤ 26; two in a row ≤ 12 each, three ≤ 8, four ≤ 5; letters up to 5 a row. */
export const WIDTH = { option: 24, full: 26, two: 12, three: 8, four: 5, letter: 1 };

/** The container's table (spec §3 of the container, §16 #45) and the bot spec's own (§8.1). */
export const FORBIDDEN: ReadonlyArray<readonly [string, RegExp]> = [
  ['«тест» for the exam', /(^|[^а-яё])тест(а|у|ом|е|ы|ов|ам|ами|ах)?([^а-яё]|$)/iu],
  ['контейнер', /контейнер/iu],
  ['преподавател', /преподавател/iu],
  ['колледж', /колледж/iu],
  ['аккредитац', /аккредитац/iu],
  ['пробн', /пробн/iu],
  ['правильный ответ', /правильн(ый|ого|ым|ые) ответ/iu],
  ['засчит', /засчит/iu],
  ['сгорел / сгорит', /сгор(ел|ит|ело|ают)/iu],
  ['повторени', /повторени/iu],
  ['на проверку', /на проверку/iu],
  ['спорн', /спорн/iu],
  ['готов на', /готов(ы)? на/iu],
  ['выучен', /выучен/iu],
  ['сдашь', /сдашь/iu],
  ['отстаёте', /отста[её]те/iu],
  ['сессия / тренировка (it is «занятие»)', /(^|[^а-яё])(сесси|тренировк)/iu],
  ['вместо (the budget is hard)', /(^|[^а-яё])вместо([^а-яё]|$)/iu],
];

const EMOJI = /\p{Extended_Pictographic}/u;
const CAPS = /(^|[^А-ЯЁа-яё])[А-ЯЁ]{4,}(?![А-ЯЁа-яё])/u;
const NOT_X_BUT_Y = /(^|[\s(])не [^.,;:!?\n]{1,40}, а /iu;

export interface LintInput {
  text: string;
  keyboard?: Keyboard | null;
  chat?: 'private' | 'group';
  /** Callback answers this message may show (lines and windows). */
  toasts?: string[];
  /** The user's own content inside the text or buttons (exam and subject names, question text and options). */
  user?: string[];
  /** Button texts that are answer options (≤ 24 instead of 26). */
  options?: string[];
}

interface Tag { name: string; attrs: string; closing: boolean }

function parseTag(raw: string): Tag | null {
  const m = /^<(\/?)([a-zA-Z][a-zA-Z0-9-]*)((?:\s[^>]*)?)>$/.exec(raw);
  if (!m) return null;
  return { closing: m[1] === '/', name: m[2].toLowerCase(), attrs: m[3].trim() };
}

/** Tag and entity problems of Telegram HTML. */
export function htmlProblems(html: string): string[] {
  const problems: string[] = [];
  const stack: string[] = [];
  const re = /<[^<>]*>|&[a-zA-Z0-9#]+;|[<>&]/g;
  for (const m of html.matchAll(re)) {
    const token = m[0];
    if (token === '<' || token === '>' || token === '&') {
      problems.push(`unescaped «${token}»`);
      continue;
    }
    if (token.startsWith('&')) {
      if (!/^&(lt|gt|amp|quot);$/.test(token)) problems.push(`entity ${token}`);
      continue;
    }
    const tag = parseTag(token);
    if (!tag) {
      problems.push(`bad tag ${token}`);
      continue;
    }
    if (tag.closing) {
      const top = stack.pop();
      if (top !== tag.name) problems.push(`</${tag.name}> closes <${top ?? 'nothing'}>`);
      continue;
    }
    const inside = stack[stack.length - 1];
    switch (tag.name) {
      case 'b':
        if (tag.attrs) problems.push('<b> with attributes');
        if (stack.includes('b')) problems.push('<b> inside <b>');
        break;
      case 'code':
        if (tag.attrs && !(inside === 'pre' && /^class="language-[a-z0-9+#-]{1,20}"$/.test(tag.attrs))) problems.push(`<code ${tag.attrs}>`);
        break;
      case 'pre':
        if (tag.attrs) problems.push('<pre> with attributes');
        break;
      case 'a':
        if (!/^href="(https:\/\/|tg:\/\/)[^"\s]+"$/.test(tag.attrs)) problems.push(`<a ${tag.attrs}>`);
        break;
      case 'blockquote':
        if (tag.attrs && tag.attrs !== 'expandable') problems.push(`<blockquote ${tag.attrs}>`);
        break;
      default:
        problems.push(`tag <${tag.name}> is not allowed`);
    }
    if ((tag.name === 'code' || tag.name === 'pre') && stack.includes('b')) problems.push(`<${tag.name}> inside <b>`);
    if (inside === 'code' || (inside === 'pre' && tag.name !== 'code')) problems.push(`<${tag.name}> inside <${inside}>`);
    stack.push(tag.name);
  }
  if (stack.length > 0) problems.push(`unclosed <${stack.join('>, <')}>`);
  return problems;
}

/** The visible text without code and without the user's own content: what the copy rules read. */
function ownText(html: string, user: readonly string[]): string {
  let text = visibleText(html.replace(/<pre>[\s\S]*?<\/pre>/g, ' ').replace(/<code>[\s\S]*?<\/code>/g, ' '));
  const parts = [...user].filter(Boolean).flatMap((u) => [u, typo(u)]).sort((a, b) => b.length - a.length);
  for (const part of parts) text = text.split(part).join(' ');
  return text;
}

/** Copy rules on the bot's own words. */
export function copyProblems(text: string, where: string): string[] {
  const problems: string[] = [];
  if (EMOJI.test(text)) problems.push(`${where}: emoji`);
  if (text.includes('!')) problems.push(`${where}: «!»`);
  if (CAPS.test(text)) problems.push(`${where}: capitals`);
  if (NOT_X_BUT_Y.test(text)) problems.push(`${where}: «не X, а Y»`);
  for (const [name, re] of FORBIDDEN) if (re.test(text)) problems.push(`${where}: forbidden «${name}»`);
  return problems;
}

/** No-break spaces the renderer must have put (spec §3). */
export function spaceProblems(text: string, where: string): string[] {
  const problems: string[] = [];
  const number = /\d (?=[^\s\d—–-])/.exec(text);
  if (number) problems.push(`${where}: a plain space after a number («${text.slice(Math.max(0, number.index - 8), number.index + 10)}»)`);
  const letter = /(^|[\s(«])[вксуоиаяВКСУОИАЯ] (?=\S)/u.exec(text);
  if (letter) problems.push(`${where}: a plain space after a one-letter word («${text.slice(Math.max(0, letter.index - 8), letter.index + 10)}»)`);
  return problems;
}

function buttonProblems(button: Button, rowSize: number, options: ReadonlySet<string>): string[] {
  const problems: string[] = [];
  const label = button.text;
  const size = [...label].length;
  if (size === 0) problems.push('button without text');
  const hasData = typeof button.data === 'string';
  const hasUrl = typeof button.url === 'string';
  const hasWebApp = typeof button.webApp === 'string';
  if (Number(hasData) + Number(hasUrl) + Number(hasWebApp) !== 1) problems.push(`«${label}»: exactly one of callback data, url and web_app`);
  if (hasData) {
    const bytes = new TextEncoder().encode(button.data as string).length;
    if (bytes < 1 || bytes > LIMITS.callbackBytes) problems.push(`«${label}»: callback_data ${bytes} bytes`);
  }
  if (hasUrl && !/^(https:\/\/|tg:\/\/)\S+$/.test(button.url as string)) problems.push(`«${label}»: url ${button.url}`);
  // A Mini App opens only from an https address (Bot API WebAppInfo).
  if (hasWebApp && !/^https:\/\/\S+$/.test(button.webApp as string)) problems.push(`«${label}»: web_app ${button.webApp}`);
  if (button.style === 'danger' && label !== 'Отключить') problems.push(`«${label}»: red is only for «Отключить»`);
  let limit: number;
  if (rowSize === 1) limit = options.has(label) ? WIDTH.option : WIDTH.full;
  else if (rowSize === 2) limit = WIDTH.two;
  else if (rowSize === 3) limit = WIDTH.three;
  else if (rowSize === 4) limit = WIDTH.four;
  else if (rowSize === 5) limit = WIDTH.letter;
  else limit = 0;
  if (size > limit) problems.push(`«${label}»: ${size} characters in a row of ${rowSize} (limit ${limit})`);
  return problems;
}

/** Every problem of one message; [] when it is fine. */
export function lintMessage(input: LintInput): string[] {
  const problems = htmlProblems(input.text);
  const visible = visibleText(input.text);
  if (visible.trim().length === 0) problems.push('empty text');
  if (visible.length > LIMITS.text) problems.push(`${visible.length} visible characters (limit ${LIMITS.text})`);
  const user = input.user ?? [];
  const own = ownText(input.text, user);
  problems.push(...copyProblems(own, 'text'), ...spaceProblems(own, 'text'));

  const keyboard = input.keyboard ?? [];
  const options = new Set(input.options ?? []);
  let blue = 0;
  for (const row of keyboard) {
    if (row.length === 0) problems.push('empty row');
    for (const button of row) {
      problems.push(...buttonProblems(button, row.length, options));
      if (button.style === 'primary') blue += 1;
      const label = user.includes(button.text) || options.has(button.text) ? '' : button.text;
      if (label) problems.push(...copyProblems(label, `button «${label}»`));
    }
  }
  if (blue > 1) problems.push(`${blue} blue buttons`);
  if (input.chat === 'group' && blue > 0) problems.push('a blue button in a group');
  // Bot API: a web_app button is «available only in private chats between a user and the bot».
  if (input.chat === 'group' && keyboard.some((row) => row.some((button) => typeof button.webApp === 'string'))) problems.push('a web_app button in a group');

  for (const toast of input.toasts ?? []) {
    if ([...toast].length > LIMITS.toast) problems.push(`toast of ${[...toast].length} characters`);
    let own = toast;
    for (const u of user) own = own.split(u).join(' ');
    problems.push(...copyProblems(own, 'toast'));
  }
  return problems;
}

export interface ProfileInput {
  name: string;
  shortDescription: string;
  description: string;
  commands: Array<{ command: string; description: string }>;
}

/** The profile set by /setup (spec §5): Telegram's limits and the copy rules. */
export function lintProfile(profile: ProfileInput): string[] {
  const problems: string[] = [];
  const len = (s: string) => [...s].length;
  if (len(profile.name) < 1 || len(profile.name) > LIMITS.name) problems.push(`name ${len(profile.name)}`);
  if (len(profile.shortDescription) > LIMITS.shortDescription) problems.push(`short description ${len(profile.shortDescription)}`);
  if (len(profile.description) > LIMITS.description) problems.push(`description ${len(profile.description)}`);
  for (const c of profile.commands) {
    if (!/^[a-z0-9_]{1,32}$/.test(c.command)) problems.push(`command ${c.command}`);
    if (len(c.description) < 1 || len(c.description) > LIMITS.commandDescription) problems.push(`command ${c.command}: description ${len(c.description)}`);
    problems.push(...copyProblems(c.description, `command ${c.command}`));
  }
  if (profile.commands.length > 100) problems.push('more than 100 commands');
  problems.push(...copyProblems(profile.name, 'name'), ...copyProblems(profile.shortDescription, 'short description'),
    ...copyProblems(profile.description, 'description'));
  return problems;
}

export { NBSP };
