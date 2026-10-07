/**
 * «Напоминать каждый день» around the calendar file (lib/reminders/ics.ts): the time picked on this device,
 * the download itself, and what to do with the file on each kind of device.
 *
 * The choice is kept in localStorage (meldy_daily_reminder_<user id>: the time, the exam whose event it is, when
 * the file was made), so «Сегодня» and «Профиль» read «Напоминание в 20:00 — изменить». Every read and write is
 * guarded: in a private window the choice lasts for the page.
 */
import type { DeviceOs, InAppApp } from '../inAppBrowser';
import { inAppName } from '../inAppBrowser';
import { dailyReminderIcs, deviceZone, parseTime, reminderUid, type IcsZone } from './ics';

/** The time offered first. */
export const DEFAULT_TIME = '20:00';
/** The times offered as buttons; any other one is «Другое». */
export const PRESET_TIMES = ['19:00', '20:00', '21:00'] as const;
export const REMINDER_FILE = 'meldy-reminder.ics';
export const REMINDER_PREFIX = 'meldy_daily_reminder_';
/** The address the event opens when the page has no http(s) origin of its own. */
export const SITE = 'https://ludosiel-studyforge.hf.space';

export interface ReminderChoice {
  /** «20:00», «08:05»: as an <input type="time"> holds it. */
  time: string;
  /** The exam whose event it is (its UID); null: none. */
  exam: string | null;
  /** When the file was made (ISO). */
  at: string;
}

/** «8:05» → «08:05»: the value of an <input type="time">; null when it is not a time. */
export function timeValue(value: unknown): string | null {
  const time = parseTime(value);
  return time ? `${String(time.hour).padStart(2, '0')}:${String(time.minute).padStart(2, '0')}` : null;
}

export function isPreset(value: string): boolean {
  return (PRESET_TIMES as readonly string[]).includes(value);
}

export function readReminder(userId: string | null | undefined): ReminderChoice | null {
  if (!userId) return null;
  try {
    const raw = window.localStorage.getItem(REMINDER_PREFIX + userId);
    if (!raw) return null;
    const value = JSON.parse(raw) as Partial<ReminderChoice> | null;
    const time = timeValue(value?.time);
    if (!value || !time) return null;
    return {
      time,
      exam: typeof value.exam === 'string' && value.exam.length <= 64 ? value.exam : null,
      at: typeof value.at === 'string' ? value.at : '',
    };
  } catch {
    return null;
  }
}

/** False when the browser does not keep it (private mode): the page still shows the choice until it is left. */
export function writeReminder(userId: string, choice: ReminderChoice): boolean {
  try {
    window.localStorage.setItem(REMINDER_PREFIX + userId, JSON.stringify(choice));
    return true;
  } catch {
    return false;
  }
}

/** «Сегодня» of this site, absolute: what the event opens. */
export function todayUrl(origin: string | null | undefined = typeof window === 'undefined' ? null : window.location.origin): string {
  return typeof origin === 'string' && /^https?:\/\/[^\s/"<>\\]+$/.test(origin) ? `${origin}/dashboard` : `${SITE}/dashboard`;
}

export interface ReminderFile {
  text: string;
  uid: string;
  /** null: a floating local time (a zone with daylight saving). */
  zone: IcsZone | null;
}

/** The calendar file for this device: its zone, now. */
export function reminderFile(options: { userId: string; examId: string | null; time: string; now?: Date; origin?: string | null }): ReminderFile {
  const time = parseTime(options.time);
  if (!time) throw new RangeError('A reminder needs a time of day.');
  const now = options.now ?? new Date();
  const zone = deviceZone(now);
  const uid = reminderUid(options.userId, options.examId);
  const text = dailyReminderIcs({ time, now, uid, url: todayUrl(options.origin), zone });
  return { text, uid, zone };
}

/**
 * Hands the file to the browser as a download (a typed Blob and a link with `download`): Safari on iPhone shows
 * it as an event to add to Calendar, Chrome on Android and computers save it to the downloads. False when the
 * browser cannot (no Blob or object URLs).
 */
export function saveCalendarFile(text: string, name: string = REMINDER_FILE): boolean {
  try {
    if (typeof Blob === 'undefined' || typeof URL.createObjectURL !== 'function') return false;
    const url = URL.createObjectURL(new Blob([text], { type: 'text/calendar;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = name;
    link.rel = 'noopener';
    link.style.display = 'none';
    document.body.appendChild(link);
    link.click();
    link.remove();
    // Safari reads the file after the click returns: the address lives a minute.
    window.setTimeout(() => {
      try {
        URL.revokeObjectURL(url);
      } catch {
        // nothing to free
      }
    }, 60_000);
    return true;
  } catch {
    return false;
  }
}

/** Before the download, in a messenger's own browser: a file often does not download there. */
export function inAppWarning(app: InAppApp | null): string | null {
  if (!app) return null;
  const name = inAppName(app);
  return `${name ? `Во встроенном браузере ${name}` : 'Во встроенном браузере приложения'} файл может не скачаться. Откройте Meldy в Chrome или Safari.`;
}

/**
 * What to do once the file is downloaded, by device. `again`: an earlier file may have added the event already
 * (Calendar on iPhone does not update it). `floating`: the device's zone has daylight saving, and Google Calendar
 * may read the time as UTC.
 */
export function nextSteps(os: DeviceOs, options: { again?: boolean; floating?: boolean } = {}): string[] {
  const steps: string[] = [];
  if (os === 'ios') {
    steps.push('На iPhone откроется окно Календаря — добавьте в нём событие. Если окно не появилось, откройте файл в приложении «Файлы», в папке «Загрузки».');
  } else if (os === 'android') {
    steps.push('Откройте файл из уведомления о загрузке или из папки «Загрузки» — календарь телефона предложит добавить событие.');
    steps.push('Если файл не открывается, добавьте его в Google Календарь на компьютере: «Настройки» → «Импорт и экспорт».');
  } else {
    steps.push('Откройте файл из загрузок — его добавят Outlook, Календарь на Mac и другие календари. В Google Календаре: «Настройки» → «Импорт и экспорт».');
  }
  if (options.floating) steps.push('Проверьте в календаре время события: в вашем часовом поясе часы переводят, и Google Календарь может сдвинуть его.');
  if (options.again) steps.push('Если в календаре осталось прежнее время, удалите старое событие и откройте файл снова.');
  return steps;
}

export { reminderUid };
