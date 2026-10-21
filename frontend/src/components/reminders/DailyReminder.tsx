import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { useAuth } from '../../hooks/useAuth';
import { detectInAppBrowser, type DeviceOs } from '../../lib/inAppBrowser';
import { leadingExamId } from '../../lib/exams/leading';
import { REMINDER_SUMMARY, clock, endTime, formatTime, parseTime } from '../../lib/reminders/ics';
import {
  DEFAULT_TIME,
  PRESET_TIMES,
  inAppWarning,
  isPreset,
  nextSteps,
  readReminder,
  reminderFile,
  saveCalendarFile,
  timeValue,
  writeReminder,
  type ReminderChoice,
} from '../../lib/reminders/dailyReminder';
import { glue } from '../exams/sheetModel';
import { track } from '../../lib/telemetry';
import { usePhone } from '../../lib/usePhone';
import './reminder.css';

/**
 * «Напоминать каждый день» (plan 2026-10-07, week 2): the student picks a time and gets a calendar file — one
 * event every day, «Meldy: ответить на билет», with an alarm at its start and «Сегодня» as its address
 * (lib/reminders/ics.ts). A quiet action, not a setting Meldy runs: the calendar on the student's device reminds,
 * and Meldy never sees it. After the download the window says what to do with the file on this kind of device;
 * the choice stays on the device, so the line reads «Напоминание в 20:00 — изменить».
 *
 * - `today`: a line in the exam card of «Сегодня», under «Можно стереть: N вопросов» (the sheet erases lines only
 *   with answers on different days, so the student has to come back);
 * - `profile`: a row of «Уведомления» in «Профиль».
 * The event's UID is one per student and exam: the exam of the first file stays its exam, so a new time replaces
 * the event instead of adding a second one.
 */

export type ReminderVariant = 'today' | 'profile';

interface Props {
  variant: ReminderVariant;
  /** The exam the event is for; undefined: the leading exam of «Сегодня», read here. */
  examId?: string | null;
}

type Phase = { kind: 'pick'; failed: boolean } | { kind: 'done'; steps: string[] };

/** iPadOS Safari calls itself a Mac: a Mac with a touch screen is an iPad. */
function deviceOs(): { os: DeviceOs; app: ReturnType<typeof detectInAppBrowser>['app'] } {
  const ua = typeof navigator === 'undefined' ? '' : navigator.userAgent;
  const { os, app } = detectInAppBrowser(ua);
  const touchMac = os === 'other' && /Macintosh/.test(ua) && typeof navigator !== 'undefined' && navigator.maxTouchPoints > 1;
  return { os: touchMac ? 'ios' : os, app };
}

function CalendarIcon() {
  return (
    <svg className="rm-ic" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <rect x="3.5" y="5" width="17" height="15.5" rx="3.5" />
      <path d="M8 3v4M16 3v4M3.5 10h17" />
      <path d="M12 13v2.6l1.8 1.2" />
    </svg>
  );
}

function DownIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M12 5v13M6 12.5l6 6 6-6" />
    </svg>
  );
}

/** The event as a calendar will list it: the time, the title, every day. */
function EventPreview({ time }: { time: string }) {
  const parsed = parseTime(time);
  if (!parsed) return null;
  return (
    <div className="rm-event">
      <p className="rm-event-time">
        <span className="sr-only">В календаре: </span>
        {`${formatTime(parsed)}–${formatTime(endTime(parsed))}`}
      </p>
      <p className="rm-event-t">{REMINDER_SUMMARY}</p>
      <p className="rm-event-r">{glue(`Каждый день · уведомление в ${formatTime(parsed)}`)}</p>
    </div>
  );
}

/**
 * The row's description in «Профиль»: on a phone one line (10_Project/Phone_Declutter_2026-10-08); that the calendar
 * reminds and Meldy never sees it is said in the window, over «Скачать файл календаря».
 */
export function profileReminderNote(chosen: boolean, phone: boolean): string {
  if (chosen) return phone ? 'Каждый день в календаре будет событие.' : 'Каждый день в вашем календаре будет событие.';
  return phone ? 'Событие в вашем календаре.' : 'Ваш календарь будет каждый день в выбранное время напоминать ответить на билет.';
}

export default function DailyReminder({ variant, examId }: Props) {
  const { user } = useAuth();
  const phone = usePhone();
  const userId = user?.id ?? null;
  const ids = useId();
  const panelId = `${ids}-panel`;
  const radios = `${ids}-time`;
  const openerRef = useRef<HTMLButtonElement>(null);
  const doneRef = useRef<HTMLParagraphElement>(null);
  const [choice, setChoice] = useState<ReminderChoice | null>(() => readReminder(userId));
  const [open, setOpen] = useState(false);
  const [time, setTime] = useState(() => choice?.time ?? DEFAULT_TIME);
  const [custom, setCustom] = useState(() => !isPreset(choice?.time ?? DEFAULT_TIME));
  const [phase, setPhase] = useState<Phase>({ kind: 'pick', failed: false });
  // The leading exam, for a page that does not know it («Профиль»), before the first file only.
  const [leading, setLeading] = useState<string | null | undefined>(undefined);
  const device = useMemo(deviceOs, []);

  useEffect(() => {
    setChoice(readReminder(userId));
  }, [userId]);

  useEffect(() => {
    if (examId !== undefined || choice || !userId) return undefined;
    let alive = true;
    leadingExamId(userId).then(
      (id) => {
        if (alive) setLeading(id);
      },
      () => {
        if (alive) setLeading(null);
      },
    );
    return () => {
      alive = false;
    };
  }, [examId, choice, userId]);

  useEffect(() => {
    if (phase.kind === 'done') doneRef.current?.focus();
  }, [phase.kind]);

  if (!userId) return null;

  const examForEvent = choice ? choice.exam : examId !== undefined ? examId : leading;
  const waitingForExam = examForEvent === undefined;
  const parsed = parseTime(time);
  const warning = inAppWarning(device.app);

  const show = () => {
    const start = choice?.time ?? DEFAULT_TIME;
    setTime(start);
    setCustom(!isPreset(start));
    setPhase({ kind: 'pick', failed: false });
    setOpen(true);
  };

  const close = () => {
    setOpen(false);
    window.setTimeout(() => openerRef.current?.focus(), 0);
  };

  const toggle = () => (open ? close() : show());

  const download = () => {
    const value = timeValue(time);
    if (!value || waitingForExam) return;
    const now = new Date();
    let file;
    try {
      file = reminderFile({ userId, examId: examForEvent ?? null, time: value, now });
    } catch {
      setPhase({ kind: 'pick', failed: true });
      return;
    }
    if (!saveCalendarFile(file.text)) {
      setPhase({ kind: 'pick', failed: true });
      return;
    }
    const again = choice !== null;
    const next: ReminderChoice = { time: value, exam: examForEvent ?? null, at: now.toISOString() };
    writeReminder(userId, next);
    setChoice(next);
    setPhase({ kind: 'done', steps: nextSteps(device.os, { again, floating: file.zone === null }) });
    track('reminder_downloaded', { from: variant, time: isPreset(value) ? value : 'custom', again, zone: file.zone ? 'fixed' : 'floating' });
  };

  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Escape') return;
    event.stopPropagation();
    close();
  };

  const opener = {
    ref: openerRef,
    'aria-expanded': open,
    'aria-controls': open ? panelId : undefined,
    onClick: toggle,
  } as const;

  const window_ = open ? (
    <div className="rm-window" id={panelId} role="group" aria-label="Напоминать каждый день" onKeyDown={onKeyDown}>
      {phase.kind === 'done' ? (
        <>
          <p className="rm-done-h" ref={doneRef} tabIndex={-1}>
            Файл скачан
          </p>
          <div className="rm-steps" role="status">
            {phase.steps.map((step) => (
              <p key={step} className="rm-step">
                {glue(step)}
              </p>
            ))}
          </div>
          <div className="rm-acts">
            <button type="button" className="rm-pill" data-plain="" onClick={close}>
              Готово
            </button>
          </div>
        </>
      ) : (
        <>
          <fieldset className="rm-field">
            <legend className="rm-legend">Во сколько напоминать</legend>
            <div className="rm-times">
              {PRESET_TIMES.map((value) => (
                <label key={value} className="rm-time">
                  <input
                    type="radio"
                    name={radios}
                    value={value}
                    checked={!custom && time === value}
                    onChange={() => {
                      setCustom(false);
                      setTime(value);
                    }}
                  />
                  <span>{clock(value)}</span>
                </label>
              ))}
              <label className="rm-time">
                <input type="radio" name={radios} value="custom" checked={custom} onChange={() => setCustom(true)} />
                <span>Другое</span>
              </label>
            </div>
          </fieldset>
          {custom ? (
            <label className="rm-custom">
              <span className="rm-custom-l">Своё время</span>
              <input
                className="rm-input"
                type="time"
                step={300}
                required
                value={time}
                onChange={(event) => setTime(event.target.value)}
                aria-invalid={parsed ? undefined : true}
              />
            </label>
          ) : null}
          {parsed ? <EventPreview time={time} /> : <p className="rm-warn">Укажите время: часы и минуты.</p>}
          {warning ? <p className="rm-warn">{glue(warning)}</p> : null}
          {phase.failed ? (
            <p className="rm-warn" role="alert">
              Не получилось скачать файл. Откройте Meldy в Chrome или Safari и попробуйте ещё раз.
            </p>
          ) : null}
          <div className="rm-acts">
            <button type="button" className="rm-pill" onClick={download} disabled={!parsed || waitingForExam}>
              Скачать файл календаря
              <span className="rm-dot" aria-hidden="true">
                <DownIcon />
              </span>
            </button>
            <button type="button" className="sf-link" data-muted="" onClick={close}>
              Отмена
            </button>
          </div>
          <p className="rm-fine">
            {glue('Напоминает календарь на вашем телефоне или компьютере, Meldy его не видит. Удалите событие в календаре — и напоминания прекратятся.')}
          </p>
        </>
      )}
    </div>
  ) : null;

  if (variant === 'profile') {
    return (
      <div className="rm" data-variant="profile">
        <div className="ac-row">
          <span className={`ac-row-i ${choice ? 'ac-row-i--on' : ''}`} aria-hidden="true">
            <CalendarIcon />
          </span>
          <div className="ac-row-text">
            <p className="ac-row-t" id={`${ids}-title`}>
              {choice ? `Напоминание в ${clock(choice.time)}` : 'Напоминать каждый день'}
            </p>
            <p className="ac-row-d">{glue(profileReminderNote(choice !== null, phone))}</p>
          </div>
          <button type="button" className="ac-btn ac-row-btn" aria-describedby={`${ids}-title`} {...opener}>
            {choice ? 'Изменить' : 'Выбрать время'}
          </button>
        </div>
        {window_}
      </div>
    );
  }

  return (
    <div className="rm" data-variant="today">
      {choice ? (
        <p className="rm-line">
          <CalendarIcon />
          {/* One run of text beside the mark; «в 20:00 — изменить» holds together, so on a narrow card the line
              breaks after «Напоминание» and the action stays with its time. */}
          <span className="rm-line-t">
            {'Напоминание '}
            <span className="rm-keep">
              {`в ${clock(choice.time)} `}
              <span className="rm-dash" aria-hidden="true">
                —
              </span>{' '}
              <button type="button" className="rm-change" aria-label="Изменить время напоминания" {...opener}>
                изменить
              </button>
            </span>
          </span>
        </p>
      ) : (
        <button type="button" className="rm-open" {...opener}>
          <CalendarIcon />
          <span>Напоминать каждый день</span>
        </button>
      )}
      {window_}
    </div>
  );
}
