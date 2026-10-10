import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import type { ContainerSettings, LocalDay, PlanInput } from '../../types/container';
import { saveSettings, containerErrorText } from '../../api/containers';
import { feasibility, windowDays } from '../../lib/containers/plan';
import { dayText } from '../../lib/containers/words';
import { Sheet } from './ui';
import * as copy from './copy';
import { addDay, dayDiff } from './model';

// ─────────────────────────────────────────────── «План по дням» (Concept 1 §3.3 with the critique's rows)

export interface DateGroup {
  date: LocalDay;
  /** Subject names when the exam has several dates (each date says whose exam it is). */
  subjects: string[];
}

export interface DayRow {
  key: string;
  text: string;
}

/**
 * The rows of «План по дням»: the study days at the day's minutes, then for each date its final days («новых нет,
 * только знакомые, сначала ошибки») and the exam itself; equal days are grouped into one row.
 */
export function planDayRows(today: LocalDay, minutes: number, firstPlanDay: LocalDay, groups: DateGroup[]): DayRow[] {
  const ahead = groups.filter((group) => (dayDiff(today, group.date) ?? -1) >= 0).sort((a, b) => (a.date < b.date ? -1 : 1));
  if (ahead.length === 0) return [];
  const rows: DayRow[] = [];
  const windows = ahead.map((group) => ({ group, w: Math.max(0, windowDays(firstPlanDay, group.date)) }));
  const firstWindowStart = addDay(windows[0].group.date, -windows[0].w);
  const studyEnd = addDay(firstWindowStart, -1);
  if ((dayDiff(today, studyEnd) ?? -1) >= 0) {
    rows.push({ key: 'study', text: copy.studyDaysRow(copy.rangeText(dayText(today), dayText(studyEnd)), minutes) });
  }
  const several = ahead.length > 1;
  for (const { group, w } of windows) {
    if (w > 0) {
      const from = addDay(group.date, -w);
      const start = (dayDiff(today, from) ?? 0) > 0 ? from : today;
      const end = addDay(group.date, -1);
      if ((dayDiff(start, end) ?? -1) >= 0) rows.push({ key: `window-${group.date}`, text: copy.windowRow(copy.rangeText(dayText(start), dayText(end))) });
    }
    rows.push({ key: `exam-${group.date}`, text: copy.examDayRow(dayText(group.date), several ? group.subjects.join(', ') : null) });
  }
  return rows;
}

export function PlanByDaysSheet({
  today,
  minutes,
  firstPlanDay,
  groups,
  noDate,
  settingsHref,
  onClose,
  onMinutes,
}: {
  today: LocalDay;
  minutes: number;
  firstPlanDay: LocalDay;
  groups: DateGroup[];
  noDate: boolean;
  settingsHref: string;
  onClose: () => void;
  onMinutes: () => void;
}) {
  const rows = planDayRows(today, minutes, firstPlanDay, groups);
  return (
    <Sheet title={copy.PLAN_BY_DAYS} onClose={onClose}>
      <ul className="ct-days">
        <li>
          {copy.daysMinutesRow(minutes)}
          {copy.SEP}
          <button type="button" className="sf-link" onClick={onMinutes}>
            {copy.CHANGE}
          </button>
        </li>
        {noDate ? (
          <li>
            {copy.NO_DATE_LINE}{' '}
            <Link className="sf-link" to={settingsHref}>
              {copy.SET_DATE}
            </Link>
          </li>
        ) : null}
        {rows.map((row) => (
          <li key={row.key}>{row.text}</li>
        ))}
      </ul>
      <p data-muted="">{copy.SKIP_DAY_NOTE}</p>
    </Sheet>
  );
}

// ─────────────────────────────────────────────── «Время в день»

const OPTIONS = [30, 45, 60, 90] as const;

export function MinutesSheet({
  containerId,
  settings,
  input,
  total,
  dateText,
  onClose,
  onSaved,
}: {
  containerId: string;
  settings: ContainerSettings;
  input: PlanInput | null;
  /** M: what Meldy can check (the shortfall line says «около 700 из 960»). */
  total: number;
  /** The nearest date («к 28 октября»), null without a date. */
  dateText: string | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [value, setValue] = useState(settings.minutes_per_day);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const options = useMemo(() => Array.from(new Set<number>([...OPTIONS, settings.minutes_per_day])).sort((a, b) => a - b), [settings.minutes_per_day]);
  const short = useMemo(() => {
    if (!input || !dateText) return null;
    try {
      const fit = feasibility({ ...input, budgetMin: value });
      if (fit.seenByDateEst >= total) return null;
      return `${copy.shortfallLine(value, dateText, fit.seenByDateEst, total)} ${copy.neededLine(fit.neededMin)}`;
    } catch {
      return null;
    }
  }, [input, dateText, value, total]);

  const save = async () => {
    if (saving) return;
    if (value === settings.minutes_per_day) {
      onClose();
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await saveSettings(containerId, { minutes_per_day: value, study_weekdays: settings.study_weekdays });
      onSaved();
      onClose();
    } catch (failure) {
      setError(containerErrorText(failure) || copy.SAVE_FAILED);
      setSaving(false);
    }
  };

  return (
    <Sheet
      title={copy.MINUTES_TITLE}
      onClose={onClose}
      actions={
        <button type="button" className="sf-primary" aria-busy={saving || undefined} onClick={() => void save()}>
          {copy.SAVE}
        </button>
      }
    >
      <fieldset className="ct-choices">
        <legend className="sr-only">{copy.MINUTES_TITLE}</legend>
        {options.map((option) => (
          <label key={option} className="ct-choice">
            <input type="radio" name="ct-minutes" value={option} checked={value === option} onChange={() => setValue(option)} />
            {copy.minutesOption(option)}
          </label>
        ))}
      </fieldset>
      <p data-muted="">{copy.MINUTES_NOTE}</p>
      {short ? <p>{short}</p> : null}
      {error ? (
        <p className="ct-sheet-error" role="alert">
          {error}
        </p>
      ) : null}
    </Sheet>
  );
}

// ─────────────────────────────────────────────── a topic (Concept 1 §3.4)

export function TopicSheet({
  title,
  keyed,
  twoDays,
  errors,
  count,
  href,
  onClose,
}: {
  title: string;
  keyed: number;
  twoDays: number;
  errors: number;
  /** The questions a block of this topic takes now (≤ 20). */
  count: number;
  href: string;
  onClose: () => void;
}) {
  return (
    <Sheet
      title={title}
      onClose={onClose}
      actions={
        count > 0 ? (
          <Link className="sf-primary" to={href} data-autofocus="">
            {copy.topicStart(count)}
          </Link>
        ) : undefined
      }
    >
      <p data-muted="">{copy.topicSheetMeta({ keyed, twoDays, errors })}</p>
      {count === 0 ? <p>{copy.TOPIC_EMPTY}</p> : null}
    </Sheet>
  );
}
