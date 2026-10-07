/**
 * «Напоминать каждый день» (plan 2026-10-07, week 2: «ICS „каждый день в 20:00“»): one calendar event that
 * repeats every day at the time the student picked, 15 minutes long, with an alarm at its start. Push is not an
 * option here: subscriptions live in a file of the container that every release resets. A calendar keeps the
 * event on the student's own device, and Meldy never sees or changes it.
 *
 * The RFC 5545 rules this file relies on (each one has a test in ics.test.ts):
 * - CRLF ends every line (3.1); a line longer than 75 octets is folded by CRLF and one space, never inside a
 *   UTF-8 character (3.1);
 * - TEXT values escape «\», «;», «,» and new lines (3.3.11), and carry no other control characters;
 * - VCALENDAR has VERSION and PRODID (3.6); VEVENT has UID and DTSTAMP (in UTC) and DTSTART (3.6.1); DURATION,
 *   not DTEND (3.6.1); RRULE:FREQ=DAILY (3.3.10);
 * - a DTSTART with TZID names a VTIMEZONE of the same file, which has STANDARD with DTSTART, TZOFFSETFROM and
 *   TZOFFSETTO (3.6.5); a time without TZID and without «Z» is a floating local time (3.3.5);
 * - VALARM with ACTION:DISPLAY has DESCRIPTION and TRIGGER (3.6.6); TRIGGER:PT0S rings at the start;
 * - a file with the same UID and a higher SEQUENCE is the same event, updated (reported for Google Calendar and
 *   Outlook; Calendar on iPhone is reported to keep the first one and add nothing).
 *
 * The time zone. The device's own zone when it has no daylight saving (Belarus: TZID=Europe/Minsk, UTC+3), with
 * its VTIMEZONE: the reminder rings at 20:00 of that zone in every calendar. That covers the app's students
 * (Belarus, Russia, Kazakhstan). A zone with daylight saving gets a floating local time instead («20:00
 * wherever the phone is»): one fixed offset would move the reminder by an hour twice a year there, and this
 * file does not carry a zone's rules. Google Calendar is reported to read floating times as UTC, so such a
 * student checks the time after the import (dailyReminder.ts says so after the download).
 */
import { sha256Hex } from '../sha256';

export interface ReminderTime {
  hour: number;
  minute: number;
}

/** The device's zone without daylight saving: the name the file uses and its offset from UTC in minutes. */
export interface IcsZone {
  tzid: string;
  offsetMinutes: number;
}

export interface DailyReminderInput {
  time: ReminderTime;
  /** When the file is made: DTSTAMP, SEQUENCE and the first day of the event. */
  now: Date;
  uid: string;
  /** «Сегодня» of the app, absolute: https://…/dashboard. */
  url: string;
  /** null: a floating local time. */
  zone: IcsZone | null;
}

export const REMINDER_SUMMARY = 'Meldy: ответить на билет';
export const REMINDER_MINUTES = 15;
export const PRODID = '-//Meldy//Daily reminder//RU';
/** The first line of a fold holds 75 octets; every next one a space and 74. */
export const LINE_OCTETS = 75;

const TIME_RE = /^([01]?\d|2[0-3]):([0-5]\d)$/;
const TZID_RE = /^[A-Za-z][A-Za-z0-9_+-]*(?:\/[A-Za-z0-9_+-]+)+$/;
const UID_RE = /^[A-Za-z0-9@._-]{8,120}$/;
/** SEQUENCE counts minutes from here: a later file always has the higher one. */
const SEQUENCE_FROM = Date.UTC(2026, 0, 1);

/** «20:00» → {20, 0}; null for anything else. */
export function parseTime(value: unknown): ReminderTime | null {
  if (typeof value !== 'string') return null;
  const match = TIME_RE.exec(value.trim());
  return match ? { hour: Number(match[1]), minute: Number(match[2]) } : null;
}

/** {20, 0} → «20:00»; {8, 5} → «8:05», as Russian clocks are written. */
export function formatTime(time: ReminderTime): string {
  return `${time.hour}:${String(time.minute).padStart(2, '0')}`;
}

/** «20:00» → «20:00», «08:05» → «8:05». */
export function clock(value: string): string {
  const time = parseTime(value);
  return time ? formatTime(time) : value;
}

/** «20:15» — the end of the event. */
export function endTime(time: ReminderTime, minutes: number = REMINDER_MINUTES): ReminderTime {
  const total = (time.hour * 60 + time.minute + minutes) % (24 * 60);
  return { hour: Math.floor(total / 60), minute: total % 60 };
}

const pad = (value: number, size = 2) => String(value).padStart(size, '0');

/** A TEXT value (RFC 5545 3.3.11): «\», «;», «,» and new lines escaped; other control characters dropped. */
export function escapeText(value: string): string {
  return value
    .replace(/\r\n?/g, '\n')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '')
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\n/g, '\\n');
}

function octets(char: string): number {
  const code = char.codePointAt(0) ?? 0;
  if (code < 0x80) return 1;
  if (code < 0x800) return 2;
  if (code < 0x10000) return 3;
  return 4;
}

/** The UTF-8 length of a text. */
export function utf8Length(text: string): number {
  let total = 0;
  for (const char of text) total += octets(char);
  return total;
}

/**
 * One content line folded at 75 octets (RFC 5545 3.1): CRLF and a space before each continuation, which counts
 * towards that line's 75. Cuts fall between characters, so no UTF-8 sequence is split.
 */
export function foldLine(line: string): string {
  const rows: string[] = [];
  let row = '';
  let size = 0;
  let limit = LINE_OCTETS;
  for (const char of line) {
    const width = octets(char);
    if (size + width > limit) {
      rows.push(row);
      row = '';
      size = 0;
      limit = LINE_OCTETS - 1;
    }
    row += char;
    size += width;
  }
  rows.push(row);
  return rows.join('\r\n ');
}

/** The first moment of the event: today at that time while it is ahead, else tomorrow (local wall clock). */
export function firstStart(now: Date, time: ReminderTime): Date {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate(), time.hour, time.minute, 0, 0);
  if (today.getTime() > now.getTime()) return today;
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, time.hour, time.minute, 0, 0);
}

/** 20261007T200000: a local date and time (floating, or in the zone of a TZID). */
export function localStamp(moment: Date): string {
  return `${pad(moment.getFullYear(), 4)}${pad(moment.getMonth() + 1)}${pad(moment.getDate())}T${pad(moment.getHours())}${pad(moment.getMinutes())}${pad(moment.getSeconds())}`;
}

/** 20261007T113000Z: a moment in UTC. */
export function utcStamp(moment: Date): string {
  return `${pad(moment.getUTCFullYear(), 4)}${pad(moment.getUTCMonth() + 1)}${pad(moment.getUTCDate())}T${pad(moment.getUTCHours())}${pad(moment.getUTCMinutes())}${pad(moment.getUTCSeconds())}Z`;
}

/** +0300 (TZOFFSETTO), −0330 … */
export function offsetText(minutes: number): string {
  const sign = minutes < 0 ? '-' : '+';
  const abs = Math.abs(minutes);
  return `${sign}${pad(Math.floor(abs / 60))}${pad(abs % 60)}`;
}

/** +03 (TZNAME, as the time zone database names Minsk), +0530 when the offset has minutes. */
function zoneName(minutes: number): string {
  const text = offsetText(minutes);
  return text.endsWith('00') ? text.slice(0, 3) : text;
}

/** Minutes since 2026-01-01 (UTC): a file made later carries the higher SEQUENCE. */
export function sequenceOf(now: Date): number {
  return Math.max(0, Math.floor((now.getTime() - SEQUENCE_FROM) / 60_000));
}

/**
 * The event's UID for a student and an exam (null: none): the same pair gives the same UID, so the next file
 * replaces the event instead of adding a second one. A UUID (version 8, RFC 9562) made from a SHA-256 of the
 * pair: no account or exam id is in the student's calendar (RFC 7986 asks UIDs not to carry such data).
 */
export function reminderUid(userId: string, examId: string | null): string {
  const hex = sha256Hex(`meldy:daily-reminder:${userId}:${examId ?? '-'}`).slice(0, 32).split('');
  hex[12] = '8';
  hex[16] = ((parseInt(hex[16], 16) & 0x3) | 0x8).toString(16);
  const text = hex.join('');
  return `${text.slice(0, 8)}-${text.slice(8, 12)}-${text.slice(12, 16)}-${text.slice(16, 20)}-${text.slice(20, 32)}`;
}

/**
 * The device's zone when it has no daylight saving (the same offset in January, July and now): Europe/Minsk,
 * Europe/Moscow, Asia/Almaty… null for a zone with daylight saving or one the browser does not name.
 */
export function deviceZone(now: Date = new Date()): IcsZone | null {
  let name = '';
  try {
    name = Intl.DateTimeFormat().resolvedOptions().timeZone ?? '';
  } catch {
    return null;
  }
  if (!TZID_RE.test(name)) return null;
  const year = now.getFullYear();
  const january = -new Date(year, 0, 1, 12).getTimezoneOffset();
  const july = -new Date(year, 6, 1, 12).getTimezoneOffset();
  const current = -now.getTimezoneOffset();
  if (january !== july || current !== january || !Number.isFinite(current)) return null;
  return { tzid: name, offsetMinutes: current };
}

/** What the event says, in plain words: why every day, where to answer, how to stop it. */
export function reminderDescription(url: string): string {
  return [
    'Строки шпаргалки в Meldy стирают только ответы в разные дни: назвали пункт — строка стёрлась наполовину, назвали снова в другой день — совсем.',
    `Ответить на билет: ${url}`,
    'Чтобы напоминания прекратились, удалите это событие со всеми повторами.',
  ].join('\n\n');
}

function vtimezone(zone: IcsZone): string[] {
  const offset = offsetText(zone.offsetMinutes);
  return [
    'BEGIN:VTIMEZONE',
    `TZID:${zone.tzid}`,
    'BEGIN:STANDARD',
    'DTSTART:19700101T000000',
    `TZOFFSETFROM:${offset}`,
    `TZOFFSETTO:${offset}`,
    `TZNAME:${zoneName(zone.offsetMinutes)}`,
    'END:STANDARD',
    'END:VTIMEZONE',
  ];
}

/** The calendar file: one VEVENT every day at `time`, with CRLF line ends and folded lines. */
export function dailyReminderIcs(input: DailyReminderInput): string {
  const { time, now, uid, url, zone } = input;
  if (!Number.isInteger(time.hour) || time.hour < 0 || time.hour > 23 || !Number.isInteger(time.minute) || time.minute < 0 || time.minute > 59) {
    throw new RangeError('A reminder needs a time of day.');
  }
  if (!UID_RE.test(uid)) throw new RangeError('A reminder needs a plain UID.');
  if (!/^https?:\/\/[^\s"<>\\]+$/.test(url)) throw new RangeError('A reminder needs an absolute address.');
  if (zone && (!TZID_RE.test(zone.tzid) || !Number.isInteger(zone.offsetMinutes) || Math.abs(zone.offsetMinutes) > 18 * 60)) {
    throw new RangeError('A reminder needs a named zone.');
  }
  const start = localStamp(firstStart(now, time));
  const stamp = utcStamp(now);
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    `PRODID:${PRODID}`,
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    ...(zone ? vtimezone(zone) : []),
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `DTSTAMP:${stamp}`,
    `LAST-MODIFIED:${stamp}`,
    `SEQUENCE:${sequenceOf(now)}`,
    zone ? `DTSTART;TZID=${zone.tzid}:${start}` : `DTSTART:${start}`,
    `DURATION:PT${REMINDER_MINUTES}M`,
    'RRULE:FREQ=DAILY',
    `SUMMARY:${escapeText(REMINDER_SUMMARY)}`,
    `DESCRIPTION:${escapeText(reminderDescription(url))}`,
    `URL:${url}`,
    // A reminder, not a meeting: the time stays free in the calendar.
    'TRANSP:TRANSPARENT',
    'BEGIN:VALARM',
    'ACTION:DISPLAY',
    `DESCRIPTION:${escapeText(REMINDER_SUMMARY)}`,
    'TRIGGER:PT0S',
    'END:VALARM',
    'END:VEVENT',
    'END:VCALENDAR',
  ];
  return `${lines.map(foldLine).join('\r\n')}\r\n`;
}
