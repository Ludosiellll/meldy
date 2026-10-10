/**
 * `callback_data` (spec §6.5): fields joined with `|`, at most 64 bytes (the longest, `go|<uuid>|p`, is 41).
 * It is client input: no secrets or keys in it; the owner, position and range are checked in SQL.
 *
 * - session `s|<sid>|<pos>|<act>`: option `<i>` (shown index 0–7), «Не знаю» `x`, «Дальше» `n`, «Нажали не туда?» `m`,
 *   doubt `d` → «Отметить» `D` / «Отмена» `b`, mark `t<mask>`, «Ответить» `a<mask>` (mask of shown indices, 0–255),
 *   «Закончить» `f`, «Продолжить» `c`, «Готово» `g`; «Повторить» repeats the original data;
 * - card: `go|<cid>|p` (plan), `go|<cid>|e` (mistakes), `go|<cid>|x` (20 more new); `ex|<cid>` another exam's card,
 *   `ex|l` the list of exams;
 * - settings: `st|time` / `st|pause` / `st|off` / `st|back`; time `t|1930` (`t|other`), `…|s` when chosen in settings
 *   (S2) instead of right after linking (M2); pause `p|1`, `p|3`, `p|mon`, `p|date`, `p|off`; `off|y`;
 * - K2: `ask|y`, `ask|p`, `ask|n`; the group: `g|<post base36>|<i>`.
 */

export type SessionAct =
  | { a: 'option'; i: number }
  | { a: 'dont_know' }
  | { a: 'next' }
  | { a: 'misclick' }
  | { a: 'doubt' }
  | { a: 'doubt_mark' }
  | { a: 'doubt_back' }
  | { a: 'toggle'; mask: number }
  | { a: 'submit'; mask: number }
  | { a: 'finish' }
  | { a: 'continue' }
  | { a: 'done' };

export type GoMode = 'p' | 'e' | 'x';
export type PauseChoice = '1' | '3' | 'mon' | 'date' | 'off';
export type SettingsScreen = 'time' | 'pause' | 'off' | 'back';

export type Callback =
  | { kind: 'session'; sid: string; pos: number; act: SessionAct }
  | { kind: 'go'; cid: string; mode: GoMode }
  | { kind: 'exam'; cid: string | null }
  | { kind: 'settings'; screen: SettingsScreen }
  | { kind: 'time'; minutes: number | null; from: 'link' | 'settings' }
  | { kind: 'pause'; choice: PauseChoice }
  | { kind: 'unlink' }
  | { kind: 'ask'; answer: 'y' | 'p' | 'n' }
  | { kind: 'group'; post: string; i: number };

export const MAX_BYTES = 64;
export const SID_RE = /^[0-9a-z]{8}$/;
export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const POST_RE = /^[0-9a-z]{1,13}$/;
const MAX_POS = 999;
const MAX_OPTIONS = 8;

function actText(act: SessionAct): string {
  switch (act.a) {
    case 'option': return String(act.i);
    case 'dont_know': return 'x';
    case 'next': return 'n';
    case 'misclick': return 'm';
    case 'doubt': return 'd';
    case 'doubt_mark': return 'D';
    case 'doubt_back': return 'b';
    case 'toggle': return `t${act.mask}`;
    case 'submit': return `a${act.mask}`;
    case 'finish': return 'f';
    case 'continue': return 'c';
    case 'done': return 'g';
  }
}

function minutesText(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, '0')}${String(m).padStart(2, '0')}`;
}

function validMask(mask: number): boolean {
  return Number.isInteger(mask) && mask >= 0 && mask < 2 ** MAX_OPTIONS;
}

/** The data for a button; throws on a value the decoder would refuse or over 64 bytes. */
export function encode(cb: Callback): string {
  let data: string;
  switch (cb.kind) {
    case 'session': {
      if (!SID_RE.test(cb.sid)) throw new Error('codec: sid');
      if (!Number.isInteger(cb.pos) || cb.pos < 0 || cb.pos > MAX_POS) throw new Error('codec: pos');
      if (cb.act.a === 'option' && !(Number.isInteger(cb.act.i) && cb.act.i >= 0 && cb.act.i < MAX_OPTIONS)) throw new Error('codec: option');
      if ((cb.act.a === 'toggle' || cb.act.a === 'submit') && !validMask(cb.act.mask)) throw new Error('codec: mask');
      data = `s|${cb.sid}|${cb.pos}|${actText(cb.act)}`;
      break;
    }
    case 'go':
      if (!UUID_RE.test(cb.cid)) throw new Error('codec: cid');
      data = `go|${cb.cid}|${cb.mode}`;
      break;
    case 'exam':
      if (cb.cid !== null && !UUID_RE.test(cb.cid)) throw new Error('codec: cid');
      data = `ex|${cb.cid ?? 'l'}`;
      break;
    case 'settings':
      data = `st|${cb.screen}`;
      break;
    case 'time': {
      if (cb.minutes !== null && !(Number.isInteger(cb.minutes) && cb.minutes >= 0 && cb.minutes < 24 * 60)) throw new Error('codec: time');
      const value = cb.minutes === null ? 'other' : minutesText(cb.minutes);
      data = cb.from === 'settings' ? `t|${value}|s` : `t|${value}`;
      break;
    }
    case 'pause':
      data = `p|${cb.choice}`;
      break;
    case 'unlink':
      data = 'off|y';
      break;
    case 'ask':
      data = `ask|${cb.answer}`;
      break;
    case 'group':
      if (!POST_RE.test(cb.post) || !(Number.isInteger(cb.i) && cb.i >= 0 && cb.i < MAX_OPTIONS)) throw new Error('codec: group');
      data = `g|${cb.post}|${cb.i}`;
      break;
  }
  if (new TextEncoder().encode(data).length > MAX_BYTES) throw new Error('codec: over 64 bytes');
  return data;
}

function decodeAct(text: string): SessionAct | null {
  if (/^[0-7]$/.test(text)) return { a: 'option', i: Number(text) };
  const simple: Record<string, SessionAct> = {
    x: { a: 'dont_know' }, n: { a: 'next' }, m: { a: 'misclick' }, d: { a: 'doubt' }, D: { a: 'doubt_mark' },
    b: { a: 'doubt_back' }, f: { a: 'finish' }, c: { a: 'continue' }, g: { a: 'done' },
  };
  if (Object.prototype.hasOwnProperty.call(simple, text)) return simple[text];
  const mask = /^([ta])(0|[1-9]\d{0,2})$/.exec(text);
  if (mask && validMask(Number(mask[2]))) return mask[1] === 't' ? { a: 'toggle', mask: Number(mask[2]) } : { a: 'submit', mask: Number(mask[2]) };
  return null;
}

/** The button a press came from, or null for anything malformed (old, foreign or forged data). */
export function decode(data: unknown): Callback | null {
  if (typeof data !== 'string' || data.length === 0 || new TextEncoder().encode(data).length > MAX_BYTES) return null;
  const parts = data.split('|');
  switch (parts[0]) {
    case 's': {
      if (parts.length !== 4 || !SID_RE.test(parts[1]) || !/^(0|[1-9]\d{0,2})$/.test(parts[2])) return null;
      const act = decodeAct(parts[3]);
      return act ? { kind: 'session', sid: parts[1], pos: Number(parts[2]), act } : null;
    }
    case 'go':
      if (parts.length !== 3 || !UUID_RE.test(parts[1]) || !['p', 'e', 'x'].includes(parts[2])) return null;
      return { kind: 'go', cid: parts[1], mode: parts[2] as GoMode };
    case 'ex':
      if (parts.length !== 2) return null;
      if (parts[1] === 'l') return { kind: 'exam', cid: null };
      return UUID_RE.test(parts[1]) ? { kind: 'exam', cid: parts[1] } : null;
    case 'st':
      if (parts.length !== 2 || !['time', 'pause', 'off', 'back'].includes(parts[1])) return null;
      return { kind: 'settings', screen: parts[1] as SettingsScreen };
    case 't': {
      if (parts.length < 2 || parts.length > 3 || (parts.length === 3 && parts[2] !== 's')) return null;
      const from = parts.length === 3 ? 'settings' : 'link';
      if (parts[1] === 'other') return { kind: 'time', minutes: null, from };
      const m = /^([01]\d|2[0-3])([0-5]\d)$/.exec(parts[1]);
      return m ? { kind: 'time', minutes: Number(m[1]) * 60 + Number(m[2]), from } : null;
    }
    case 'p':
      if (parts.length !== 2 || !['1', '3', 'mon', 'date', 'off'].includes(parts[1])) return null;
      return { kind: 'pause', choice: parts[1] as PauseChoice };
    case 'off':
      return parts.length === 2 && parts[1] === 'y' ? { kind: 'unlink' } : null;
    case 'ask':
      if (parts.length !== 2 || !['y', 'p', 'n'].includes(parts[1])) return null;
      return { kind: 'ask', answer: parts[1] as 'y' | 'p' | 'n' };
    case 'g':
      if (parts.length !== 3 || !POST_RE.test(parts[1]) || !/^[0-7]$/.test(parts[2])) return null;
      return { kind: 'group', post: parts[1], i: Number(parts[2]) };
    default:
      return null;
  }
}
