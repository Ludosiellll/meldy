import { useId, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import type { ContainerSettings, PlanInput, Tempo, Uuid } from '../../types/container';
import { containerErrorText, saveSettings } from '../../api/containers';
import { ALL_QUESTIONS_MIN } from '../../lib/containers/plan';
import { track } from '../../lib/telemetry';
import { Sheet } from './ui';
import { minutesLines } from './import/minutesLines';
import { IMPORT, nb, SETTINGS } from './copyImport';
import * as copy from './copy';
import './minutes.css';

/**
 * «Время в день» on the exam's page (release 47.3, owner 18.10: the item only led to «Настройки»): the settings' own
 * choices — 30 / 45 / 60 / 90 minutes or «Все вопросы», and how the new questions come — as two rows of chips in a
 * dialog. A choice is saved as it is made (the user's own `container_plans` row, the days of the week kept), the page's
 * plan is read again (`onSaved`) and a line says so; the line under the minutes is the settings' own (minutesLines).
 * Several quick choices are saved one after another, the last one wins.
 */
export const MINUTE_CHOICES = [30, 45, 60, 90, ALL_QUESTIONS_MIN] as const;
const TEMPOS: readonly Tempo[] = ['date', 'fast'];

export default function MinutesDialog({
  containerId,
  settings,
  planInput,
  settingsHref,
  onClose,
  onSaved,
}: {
  containerId: Uuid;
  settings: ContainerSettings;
  planInput: PlanInput | null;
  settingsHref: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const ids = useId();
  const [minutes, setMinutes] = useState(settings.minutes_per_day);
  const [tempo, setTempo] = useState<Tempo>(settings.tempo === 'fast' ? 'fast' : 'date');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{ text: string; error?: boolean; at: number } | null>(null);
  const latest = useRef({ minutes, tempo, what: 'minutes' as 'minutes' | 'tempo' });
  const running = useRef(false);
  const again = useRef(false);
  // A value the settings page set outside the four (an older choice) stays a choice of its own.
  const choices = useMemo(
    () => (MINUTE_CHOICES.some((value) => value === settings.minutes_per_day) ? [...MINUTE_CHOICES] : [...MINUTE_CHOICES, settings.minutes_per_day].sort((a, b) => a - b)),
    [settings.minutes_per_day],
  );
  const lines = useMemo(() => {
    try {
      return minutesLines(planInput, minutes, tempo);
    } catch {
      return null;
    }
  }, [planInput, minutes, tempo]);

  const save = async (next: { minutes: number; tempo: Tempo; what: 'minutes' | 'tempo' }) => {
    latest.current = next;
    if (running.current) {
      again.current = true;
      return;
    }
    running.current = true;
    setBusy(true);
    try {
      let value = latest.current;
      do {
        again.current = false;
        value = latest.current;
        await saveSettings(containerId, { minutes_per_day: value.minutes, study_weekdays: settings.study_weekdays, tempo: value.tempo });
      } while (again.current);
      if (value.what === 'minutes') track('container.minutes_set', { minutes: value.minutes, from: 'page' });
      else track('container.tempo_set', { tempo: value.tempo, from: 'page' });
      setStatus((current) => ({ text: value.what === 'minutes' ? copy.minutesSaved(value.minutes) : copy.TEMPO_SAVED, at: (current?.at ?? 0) + 1 }));
      onSaved();
    } catch (error) {
      setStatus((current) => ({ text: containerErrorText(error) || copy.SAVE_FAILED, error: true, at: (current?.at ?? 0) + 1 }));
    } finally {
      running.current = false;
      setBusy(false);
    }
  };

  const statusId = `${ids}-status`;
  return (
    <Sheet
      title={copy.MINUTES_TITLE}
      onClose={onClose}
      className="md-sheet"
      actions={
        <button type="button" className="sf-primary" onClick={onClose}>
          {copy.MINUTES_DONE}
        </button>
      }
    >
      <fieldset className="md-set" aria-describedby={lines ? `${ids}-line` : undefined} aria-busy={busy || undefined}>
        {/* The sheet's title says it already: the group keeps its name for screen readers. */}
        <legend className="sr-only">{SETTINGS.minutes}</legend>
        <div className="md-chips">
          {choices.map((value) => (
            <label key={value} className="md-chip">
              <input
                type="radio"
                name={`${ids}-minutes`}
                value={value}
                checked={minutes === value}
                data-autofocus={minutes === value ? '' : undefined}
                onChange={() => {
                  setMinutes(value);
                  void save({ minutes: value, tempo, what: 'minutes' });
                }}
              />
              <span>{IMPORT.minuteOption(value)}</span>
            </label>
          ))}
        </div>
      </fieldset>
      <fieldset className="md-set" aria-busy={busy || undefined}>
        <legend className="md-legend">{IMPORT.tempo}</legend>
        <div className="md-chips">
          {TEMPOS.map((value) => (
            <label key={value} className="md-chip">
              <input
                type="radio"
                name={`${ids}-tempo`}
                value={value}
                checked={tempo === value}
                onChange={() => {
                  setTempo(value);
                  void save({ minutes, tempo: value, what: 'tempo' });
                }}
              />
              <span>{IMPORT.tempoOption(value)}</span>
            </label>
          ))}
        </div>
      </fieldset>
      {lines ? (
        <p className="md-line" id={`${ids}-line`}>
          {nb(lines.line)}
        </p>
      ) : null}
      <p className="md-status" data-error={status?.error && !busy ? '' : undefined} id={statusId} role="status">
        {busy ? copy.MINUTES_SAVING : status ? status.text : ''}
      </p>
      <p className="md-more">
        <Link className="sf-link" data-muted="" to={`${settingsHref}#days`}>
          {copy.MINUTES_MORE}
        </Link>
      </p>
    </Sheet>
  );
}
