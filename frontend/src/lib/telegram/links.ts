/**
 * The bot's links, the browser's zone and the computer test of the site's Telegram card (package T3; Telegram bot spec
 * decisions 9 and 32, §6.3 «Сайт»).
 *
 * - `linkUrl`: `https://t.me/Meldyteach_bot?start=L<32 hex>`, the one-time code of `telegram_link_start` (15 minutes).
 *   Telegram sends the bot `/start L…` when the student presses «Запустить» in that chat.
 * - `chatUrl`: the bot's chat without a code.
 * - `browserZone`: the zone the reminder time is counted in; it reaches the bot with the code (decision 32).
 * - `onComputer`: a computer shows the link as a QR code for the phone (`linkQr`); a phone or tablet opens Telegram.
 * - `zoneWords`: «по Минску» for the frequent zones, else the IANA name (spec S1).
 */
import { detectInAppBrowser } from '../inAppBrowser';
import { encodeQr, qrPath } from './qr';

/** The bot (spec §5; the server's `bot_username` wins when it is a bot's name). */
export const BOT_USERNAME = 'Meldyteach_bot';
/** The bot's zone when the browser cannot name one (spec §6.2, `bot.links.tz`). */
export const DEFAULT_ZONE = 'Europe/Minsk';

/** A bot's username: 5–32 letters, digits and «_», from a letter, ending in «bot». */
const BOT_NAME = /^[A-Za-z][A-Za-z0-9_]{1,28}[Bb][Oo][Tt]$/;
/** The code of `telegram_link_start`: «L» and 32 hex digits (spec decision 9), or the 32 digits alone. */
const LINK_CODE = /^L?([0-9A-Fa-f]{32})$/;

/** The server's bot name when it is one, else @Meldyteach_bot. */
export function botName(fromServer?: string | null): string {
  const name = typeof fromServer === 'string' ? fromServer.trim().replace(/^@/, '') : '';
  return BOT_NAME.test(name) ? name : BOT_USERNAME;
}

/** «L<32 hex>», the `start` parameter of the link, or null when the code is not one. The digits keep their case. */
export function linkPayload(code: unknown): string | null {
  if (typeof code !== 'string') return null;
  const match = LINK_CODE.exec(code.trim());
  return match ? `L${match[1]}` : null;
}

/** https://t.me/Meldyteach_bot?start=L<32 hex>, or null for a code that is not one. */
export function linkUrl(code: unknown, bot?: string | null): string | null {
  const payload = linkPayload(code);
  return payload ? `https://t.me/${botName(bot)}?start=${payload}` : null;
}

/** The bot's chat, without a code. */
export function chatUrl(bot?: string | null): string {
  return `https://t.me/${botName(bot)}`;
}

/** True for a zone this engine knows by name (the server checks it again in pg_timezone_names). */
export function knownZone(zone: unknown): zone is string {
  if (typeof zone !== 'string' || !/^[A-Za-z][A-Za-z0-9_+-]*(\/[A-Za-z0-9_+-]+)*$/.test(zone) || zone === 'Etc/Unknown') return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

/** The browser's IANA zone (`Intl.DateTimeFormat().resolvedOptions().timeZone`), else Europe/Minsk. */
export function browserZone(): string {
  try {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (knownZone(zone)) return zone;
  } catch {
    // An engine without zones: the bot's default.
  }
  return DEFAULT_ZONE;
}

/**
 * A computer: not Android, iOS or iPadOS (Safari on an iPad calls itself a Mac with a touch screen), not a «Mobile»
 * browser. There the QR code is the way to the phone's Telegram; elsewhere the link opens the app.
 */
export function onComputer(
  userAgent: string = typeof navigator === 'undefined' ? '' : navigator.userAgent,
  touchPoints: number = typeof navigator === 'undefined' ? 0 : navigator.maxTouchPoints ?? 0,
): boolean {
  const { os } = detectInAppBrowser(userAgent);
  if (os !== 'other') return false;
  if (/Macintosh/.test(userAgent) && touchPoints > 1) return false;
  return !/Mobi|Tablet|KAIOS|HarmonyOS/i.test(userAgent);
}

/** The QR code of a link, ready for one SVG path on a light plate. */
export function linkQr(url: string): { d: string; box: number } {
  return qrPath(encodeQr(url, { level: 'M' }));
}

const CITIES: Record<string, string> = {
  'Europe/Minsk': 'по Минску',
  'Europe/Moscow': 'по Москве',
  'Europe/Kaliningrad': 'по Калининграду',
  'Europe/Vilnius': 'по Вильнюсу',
  'Europe/Riga': 'по Риге',
  'Europe/Warsaw': 'по Варшаве',
  'Europe/Kyiv': 'по Киеву',
  'Europe/Kiev': 'по Киеву',
  'Europe/Berlin': 'по Берлину',
  'Europe/London': 'по Лондону',
  'Asia/Yekaterinburg': 'по Екатеринбургу',
  'Asia/Novosibirsk': 'по Новосибирску',
  'Asia/Vladivostok': 'по Владивостоку',
  'Asia/Tashkent': 'по Ташкенту',
  'Asia/Tbilisi': 'по Тбилиси',
};

/** «по Минску», or «по Asia/Almaty» for a zone without a city here. */
export function zoneWords(zone: string): string {
  return CITIES[zone] ?? `по ${zone}`;
}
