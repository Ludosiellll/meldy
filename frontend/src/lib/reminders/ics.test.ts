import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  LINE_OCTETS,
  REMINDER_SUMMARY,
  clock,
  dailyReminderIcs,
  deviceZone,
  endTime,
  escapeText,
  firstStart,
  foldLine,
  formatTime,
  localStamp,
  offsetText,
  parseTime,
  reminderDescription,
  reminderUid,
  sequenceOf,
  utcStamp,
  utf8Length,
  type DailyReminderInput,
} from './ics';

const MINSK = { tzid: 'Europe/Minsk', offsetMinutes: 180 };
const URL_TODAY = 'https://ludosiel-studyforge.hf.space/dashboard';
/** 7 October 2026, 14:30 on the wall clock of the test's zone. */
const NOW = new Date(2026, 9, 7, 14, 30, 12);

function input(overrides: Partial<DailyReminderInput> = {}): DailyReminderInput {
  return { time: { hour: 20, minute: 0 }, now: NOW, uid: reminderUid('user-1', 'exam-1'), url: URL_TODAY, zone: MINSK, ...overrides };
}

/** RFC 5545 3.1: unfold (CRLF + one space or tab), then split into content lines. */
function unfold(text: string): string[] {
  return text.replace(/\r\n[ \t]/g, '').split('\r\n').slice(0, -1);
}

interface ContentLine {
  name: string;
  params: Record<string, string>;
  value: string;
}

/** name *(";" param "=" value) ":" value, for the plain values this file writes. */
function parse(line: string): ContentLine {
  const match = /^([A-Z][A-Z0-9-]*)((?:;[A-Z0-9-]+=[^;:"]+)*):(.*)$/.exec(line);
  if (!match) throw new Error(`Not a content line: ${line}`);
  const params: Record<string, string> = {};
  for (const part of match[2].split(';').filter(Boolean)) {
    const [key, value] = part.split('=');
    params[key] = value;
  }
  return { name: match[1], params, value: match[3] };
}

interface Component {
  name: string;
  props: ContentLine[];
  children: Component[];
}

/** The tree of BEGIN/END components; throws on a component that is not closed by its own END. */
function tree(text: string): Component {
  const root: Component = { name: 'ROOT', props: [], children: [] };
  const stack = [root];
  for (const line of unfold(text).map(parse)) {
    const top = stack[stack.length - 1];
    if (line.name === 'BEGIN') {
      const child = { name: line.value, props: [], children: [] };
      top.children.push(child);
      stack.push(child);
    } else if (line.name === 'END') {
      if (top.name !== line.value) throw new Error(`END:${line.value} closes ${top.name}`);
      stack.pop();
    } else top.props.push(line);
  }
  if (stack.length !== 1) throw new Error('A component is not closed');
  expect(root.children).toHaveLength(1);
  return root.children[0];
}

const props = (component: Component, name: string) => component.props.filter((prop) => prop.name === name);
const one = (component: Component, name: string) => {
  const found = props(component, name);
  expect(found, `${component.name} has one ${name}`).toHaveLength(1);
  return found[0];
};
const child = (component: Component, name: string) => {
  const found = component.children.filter((item) => item.name === name);
  expect(found, `${component.name} has one ${name}`).toHaveLength(1);
  return found[0];
};

/** RFC 5545 3.3.11, read back. */
function unescapeText(value: string): string {
  return value.replace(/\\([\\;,nN])/g, (_, char: string) => (char === 'n' || char === 'N' ? '\n' : char));
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('the calendar file (RFC 5545)', () => {
  it('ends every line with CRLF and has no bare CR or LF', () => {
    const text = dailyReminderIcs(input());
    expect(text.endsWith('\r\n')).toBe(true);
    expect(text.replace(/\r\n/g, '')).not.toMatch(/[\r\n]/);
    expect(text.startsWith('BEGIN:VCALENDAR\r\n')).toBe(true);
    expect(text.endsWith('END:VCALENDAR\r\n')).toBe(true);
  });

  it('folds lines at 75 octets with CRLF and a space, never inside a UTF-8 character, and unfolds back', () => {
    const text = dailyReminderIcs(input());
    const physical = text.split('\r\n').slice(0, -1);
    for (const line of physical) expect(utf8Length(line)).toBeLessThanOrEqual(LINE_OCTETS);
    // The Russian description is long: it is folded, and every continuation starts with one space.
    const continuations = physical.filter((line) => line.startsWith(' '));
    expect(continuations.length).toBeGreaterThan(3);
    // Each physical line is whole UTF-16 (no half of a surrogate pair) and survives a UTF-8 round trip.
    for (const line of physical) expect(new TextDecoder('utf-8', { fatal: true }).decode(new TextEncoder().encode(line))).toBe(line);
    const description = unfold(text).find((line) => line.startsWith('DESCRIPTION:'))!;
    expect(unescapeText(description.slice('DESCRIPTION:'.length))).toBe(reminderDescription(URL_TODAY));
  });

  it('folds by octets: 75 on the first line, a space and 74 after it', () => {
    expect(foldLine('A'.repeat(75))).toBe('A'.repeat(75));
    expect(foldLine('A'.repeat(76))).toBe(`${'A'.repeat(75)}\r\n A`);
    expect(foldLine('A'.repeat(75 + 74 + 1))).toBe(`${'A'.repeat(75)}\r\n ${'A'.repeat(74)}\r\n A`);
    // Cyrillic is two octets: 37 letters fill 74, the 38th would make 76.
    const cyrillic = foldLine(`X${'ж'.repeat(40)}`);
    const [first, second] = cyrillic.split('\r\n');
    expect(utf8Length(first)).toBe(75);
    expect(second).toBe(` ${'ж'.repeat(3)}`);
    // A four-octet character is never cut in two.
    const emoji = foldLine(`${'A'.repeat(73)}😀😀`);
    expect(emoji.split('\r\n')).toEqual([`${'A'.repeat(73)}`, ' 😀😀']);
    expect(foldLine('')).toBe('');
  });

  it('escapes TEXT values: backslash, semicolon, comma and new lines; drops other control characters', () => {
    expect(escapeText('a\\b;c,d\ne\r\nf\rg')).toBe('a\\\\b\\;c\\,d\\ne\\nf\\ng');
    expect(escapeText('tab\tstays\u0007bell')).toBe('tab\tstaysbell');
    expect(escapeText('Время: 20:00')).toBe('Время: 20:00');
    for (const sample of ['«Экзамен; часть 1», вопрос 2\nстрока \\n', 'просто текст', ',;\\']) {
      expect(unescapeText(escapeText(sample))).toBe(sample);
    }
    // No unescaped comma or semicolon reaches a TEXT value of the file.
    const event = child(tree(dailyReminderIcs(input())), 'VEVENT');
    for (const name of ['SUMMARY', 'DESCRIPTION']) expect(one(event, name).value).not.toMatch(/(^|[^\\])(\\\\)*[,;]/);
  });

  it('has the calendar, one daily event of 15 minutes, its alarm at the start and the address of «Сегодня»', () => {
    const calendar = tree(dailyReminderIcs(input()));
    expect(calendar.name).toBe('VCALENDAR');
    expect(one(calendar, 'VERSION').value).toBe('2.0');
    expect(one(calendar, 'PRODID').value).toBe('-//Meldy//Daily reminder//RU');
    expect(one(calendar, 'METHOD').value).toBe('PUBLISH');
    const event = child(calendar, 'VEVENT');
    expect(one(event, 'RRULE').value).toBe('FREQ=DAILY');
    expect(one(event, 'DURATION').value).toBe('PT15M');
    expect(props(event, 'DTEND')).toHaveLength(0);
    expect(unescapeText(one(event, 'SUMMARY').value)).toBe('Meldy: ответить на билет');
    expect(one(event, 'URL').value).toBe(URL_TODAY);
    expect(unescapeText(one(event, 'DESCRIPTION').value)).toContain(`Ответить на билет: ${URL_TODAY}`);
    expect(unescapeText(one(event, 'DESCRIPTION').value)).toContain('в два разных дня');
    // The reminder no longer describes the cheat sheet (owner, 2026-10-10).
    expect(unescapeText(one(event, 'DESCRIPTION').value)).not.toMatch(/шпаргал/i);
    expect(one(event, 'TRANSP').value).toBe('TRANSPARENT');
    const alarm = child(event, 'VALARM');
    expect(one(alarm, 'ACTION').value).toBe('DISPLAY');
    expect(one(alarm, 'TRIGGER').value).toBe('PT0S');
    expect(unescapeText(one(alarm, 'DESCRIPTION').value)).toBe(REMINDER_SUMMARY);
  });

  it('starts in Minsk time with a VTIMEZONE of UTC+3 and no daylight saving', () => {
    const calendar = tree(dailyReminderIcs(input()));
    const event = child(calendar, 'VEVENT');
    const start = one(event, 'DTSTART');
    expect(start.params).toEqual({ TZID: 'Europe/Minsk' });
    expect(start.value).toBe('20261007T200000');
    const zone = child(calendar, 'VTIMEZONE');
    expect(one(zone, 'TZID').value).toBe(start.params.TZID);
    expect(zone.children.map((item) => item.name)).toEqual(['STANDARD']);
    const standard = child(zone, 'STANDARD');
    expect(one(standard, 'DTSTART').value).toBe('19700101T000000');
    expect(one(standard, 'TZOFFSETFROM').value).toBe('+0300');
    expect(one(standard, 'TZOFFSETTO').value).toBe('+0300');
    expect(one(standard, 'TZNAME').value).toBe('+03');
    // The zone is defined before the event that uses it.
    const text = dailyReminderIcs(input());
    expect(text.indexOf('BEGIN:VTIMEZONE')).toBeLessThan(text.indexOf('BEGIN:VEVENT'));
  });

  it('uses a floating local time, and no VTIMEZONE, for a zone with daylight saving', () => {
    const calendar = tree(dailyReminderIcs(input({ zone: null, time: { hour: 21, minute: 30 } })));
    const start = one(child(calendar, 'VEVENT'), 'DTSTART');
    expect(start.params).toEqual({});
    expect(start.value).toBe('20261007T213000');
    expect(start.value.endsWith('Z')).toBe(false);
    expect(calendar.children.map((item) => item.name)).toEqual(['VEVENT']);
  });

  it('stamps the file in UTC and gives a later file the higher SEQUENCE', () => {
    const event = child(tree(dailyReminderIcs(input())), 'VEVENT');
    expect(one(event, 'DTSTAMP').value).toBe(utcStamp(NOW));
    expect(one(event, 'DTSTAMP').value).toMatch(/^\d{8}T\d{6}Z$/);
    expect(one(event, 'LAST-MODIFIED').value).toBe(one(event, 'DTSTAMP').value);
    const later = child(tree(dailyReminderIcs(input({ now: new Date(NOW.getTime() + 5 * 60_000) }))), 'VEVENT');
    expect(Number(one(later, 'SEQUENCE').value)).toBe(Number(one(event, 'SEQUENCE').value) + 5);
    expect(sequenceOf(new Date(Date.UTC(2026, 0, 1, 1, 0)))).toBe(60);
    expect(sequenceOf(new Date(Date.UTC(2025, 0, 1)))).toBe(0);
  });

  it('keeps one UID per student and exam that says nothing about either', () => {
    const uid = reminderUid('3f1c2a9e-0000-4000-8000-00000000a001', 'e1d2c3b4-a596-4877-8899-aabbccddeeff');
    expect(uid).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(reminderUid('3f1c2a9e-0000-4000-8000-00000000a001', 'e1d2c3b4-a596-4877-8899-aabbccddeeff')).toBe(uid);
    expect(reminderUid('3f1c2a9e-0000-4000-8000-00000000a001', 'another-exam')).not.toBe(uid);
    expect(reminderUid('another-user', 'e1d2c3b4-a596-4877-8899-aabbccddeeff')).not.toBe(uid);
    expect(reminderUid('3f1c2a9e-0000-4000-8000-00000000a001', null)).not.toBe(uid);
    expect(uid).not.toContain('3f1c2a9e');
    expect(uid).not.toContain('e1d2c3b4');
    // The file carries the UID as given, and a file for the same pair with another time keeps it.
    const first = one(child(tree(dailyReminderIcs(input({ uid }))), 'VEVENT'), 'UID').value;
    const changed = one(child(tree(dailyReminderIcs(input({ uid, time: { hour: 21, minute: 0 } }))), 'VEVENT'), 'UID').value;
    expect(first).toBe(uid);
    expect(changed).toBe(uid);
  });

  it('refuses what would break the file', () => {
    expect(() => dailyReminderIcs(input({ uid: 'bad uid\r\nX-EVIL:1' }))).toThrow(RangeError);
    expect(() => dailyReminderIcs(input({ url: 'https://x.test/a\r\nX:1' }))).toThrow(RangeError);
    expect(() => dailyReminderIcs(input({ url: 'javascript:alert(1)' }))).toThrow(RangeError);
    expect(() => dailyReminderIcs(input({ zone: { tzid: 'Europe/Minsk:X', offsetMinutes: 180 } }))).toThrow(RangeError);
    expect(() => dailyReminderIcs(input({ time: { hour: 24, minute: 0 } }))).toThrow(RangeError);
  });
});

describe('the first day and the time', () => {
  it('starts today while the time is ahead, else tomorrow, across the end of a month and a year', () => {
    expect(localStamp(firstStart(new Date(2026, 9, 7, 19, 59), { hour: 20, minute: 0 }))).toBe('20261007T200000');
    expect(localStamp(firstStart(new Date(2026, 9, 7, 20, 0), { hour: 20, minute: 0 }))).toBe('20261008T200000');
    expect(localStamp(firstStart(new Date(2026, 9, 31, 21, 0), { hour: 20, minute: 0 }))).toBe('20261101T200000');
    expect(localStamp(firstStart(new Date(2026, 11, 31, 23, 0), { hour: 8, minute: 5 }))).toBe('20270101T080500');
  });

  it('reads and writes the time as Russian clocks show it', () => {
    expect(parseTime('20:00')).toEqual({ hour: 20, minute: 0 });
    expect(parseTime('08:05')).toEqual({ hour: 8, minute: 5 });
    expect(parseTime(' 7:30 ')).toEqual({ hour: 7, minute: 30 });
    for (const bad of ['24:00', '20:60', '20', '', 'утро', null, 2000]) expect(parseTime(bad)).toBeNull();
    expect(formatTime({ hour: 8, minute: 5 })).toBe('8:05');
    expect(clock('08:05')).toBe('8:05');
    expect(formatTime(endTime({ hour: 20, minute: 0 }))).toBe('20:15');
    expect(formatTime(endTime({ hour: 23, minute: 50 }))).toBe('0:05');
    expect(offsetText(180)).toBe('+0300');
    expect(offsetText(-210)).toBe('-0330');
    expect(offsetText(0)).toBe('+0000');
  });
});

describe('the device’s zone', () => {
  function zoneOf(name: string, offsets: (moment: Date) => number) {
    vi.spyOn(Intl.DateTimeFormat.prototype, 'resolvedOptions').mockReturnValue({ timeZone: name } as Intl.ResolvedDateTimeFormatOptions);
    vi.spyOn(Date.prototype, 'getTimezoneOffset').mockImplementation(function (this: Date) {
      return offsets(this);
    });
  }

  it('names Minsk with its fixed UTC+3', () => {
    zoneOf('Europe/Minsk', () => -180);
    expect(deviceZone(new Date(2026, 9, 7))).toEqual({ tzid: 'Europe/Minsk', offsetMinutes: 180 });
  });

  it('gives a floating time to a zone with daylight saving, or one without a name', () => {
    zoneOf('Europe/Warsaw', (moment) => (moment.getMonth() >= 3 && moment.getMonth() <= 9 ? -120 : -60));
    expect(deviceZone(new Date(2026, 9, 7))).toBeNull();
    vi.restoreAllMocks();
    zoneOf('UTC', () => 0);
    expect(deviceZone(new Date(2026, 9, 7))).toBeNull();
  });
});
