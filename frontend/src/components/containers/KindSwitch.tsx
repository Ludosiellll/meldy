import { useId, useState } from 'react';
import type { ContainerKind, Uuid } from '../../types/container';
import { containerErrorText, setContainerKind } from '../../api/containers';
import { track } from '../../lib/telemetry';
import { KIND } from '../test/copyTest';
import './kindSwitch.css';

/**
 * «Это экзамен» / «Это тест» in the author's «Настройки» (release 47.3): two choices, saved as one is made (the exam's
 * own row, containers.kind), with what each means under them and a line that says it is saved. A test opens as the
 * test's own page and stays out of the author's plan («Сегодня», the bot); an exam is studied. `onSaved` reads the
 * page again.
 */
export default function KindSwitch({ containerId, kind, onSaved }: { containerId: Uuid; kind: ContainerKind; onSaved: () => void }) {
  const ids = useId();
  const [value, setValue] = useState<ContainerKind>(kind);
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState<{ text: string; error?: boolean } | null>(null);

  const choose = async (next: ContainerKind) => {
    if (busy || next === value) return;
    const before = value;
    setValue(next);
    setBusy(true);
    setSaid(null);
    try {
      await setContainerKind(containerId, next);
      track('container.kind_set', { kind: next });
      setSaid({ text: next === 'test' ? KIND.savedTest : KIND.savedExam });
      onSaved();
    } catch (error) {
      setValue(before);
      setSaid({ text: containerErrorText(error), error: true });
    } finally {
      setBusy(false);
    }
  };

  return (
    <fieldset className="im-field ks-set" id="settings-kind" aria-describedby={`${ids}-hint`} aria-busy={busy || undefined}>
      <legend className="im-label ks-legend">{KIND.label}</legend>
      <div className="ks-chips">
        {(['exam', 'test'] as const).map((entry) => (
          <label key={entry} className="ks-chip">
            <input type="radio" name={`${ids}-kind`} value={entry} checked={value === entry} onChange={() => void choose(entry)} />
            <span>{entry === 'test' ? KIND.test : KIND.exam}</span>
          </label>
        ))}
      </div>
      <p className="im-hint" data-muted="" id={`${ids}-hint`}>
        {value === 'test' ? KIND.testHint : KIND.examHint}
      </p>
      <p className="im-hint ks-said" data-error={said?.error ? '' : undefined} role="status">
        {busy ? KIND.saving : said?.text ?? ''}
      </p>
    </fieldset>
  );
}
