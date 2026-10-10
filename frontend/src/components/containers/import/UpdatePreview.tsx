import PaperSelect from '../../ui/PaperSelect';
import type { SummarySubject } from '../../../types/container';
import { IMPORT, lettersText, nb } from '../copyImport';
import { sameText, type UpdatePlan, type UpdateSource } from './updateModel';

/**
 * The preview of «Обновить из файла» (updateModel.ts): what the file brings to the subject, as rows of one card with
 * counts — new (added), already in the subject, a different key in the file, in the subject but not in the file, open
 * questions (not added here) — then the questions whose key differs, by number, with the file's letters and the
 * subject's (in the order «Ключи» shows them). A file of several subjects asks which one is this subject.
 */

const SHOWN = 6;

interface Props {
  subject: SummarySubject;
  sources: UpdateSource[];
  source: UpdateSource | null;
  onSource: (key: string) => void;
  plan: UpdatePlan;
  locked: boolean;
}

/** «№ 12: в файле Б, сейчас В», letters in the subject's order of options (the sets are the same). */
function keyLine({ item, saved }: UpdatePlan['keyDiffers'][number]): string {
  const no = saved.file_no || item.label;
  if (item.kind === 'short' || saved.kind === 'short') return IMPORT.updateKeyShort(no);
  const at = new Map(saved.options.map((option, index) => [sameText(option), index]));
  const file = item.correct
    .map((index) => at.get(sameText(item.options[index] ?? '')))
    .filter((index): index is number => index !== undefined)
    .sort((a, b) => a - b);
  return IMPORT.updateKeyItem(no, lettersText(file), saved.correct.length ? lettersText([...saved.correct].sort((a, b) => a - b)) : null);
}

export default function UpdatePreview({ subject, sources, source, onSource, plan, locked }: Props) {
  const oral = source?.oral ?? 0;
  const rows = [
    { key: 'new', label: IMPORT.updateRowNew, n: plan.add.length, shown: true },
    { key: 'same', label: IMPORT.updateRowSame, n: plan.same, shown: true },
    { key: 'key', label: IMPORT.updateRowKey, n: plan.keyDiffers.length, shown: plan.keyDiffers.length > 0 },
    { key: 'gone', label: IMPORT.updateRowGone, n: plan.notInFile, shown: plan.notInFile > 0 },
    { key: 'oral', label: IMPORT.updateRowOral, n: oral, shown: oral > 0 },
  ];
  const listed = plan.keyDiffers.slice(0, SHOWN);
  const rest = plan.keyDiffers.length - listed.length;
  return (
    <>
      {sources.length > 1 ? (
        <div className="im-field im-update-which">
          <span className="im-label">{IMPORT.updateWhich}</span>
          <PaperSelect
            ariaLabel={IMPORT.updateWhich}
            value={source?.key ?? sources[0].key}
            options={sources.map((entry) => ({ value: entry.key, label: entry.title }))}
            onChange={onSource}
            disabled={locked}
          />
        </div>
      ) : null}
      <ul className="im-topics im-update-rows" aria-label={subject.title}>
        {rows
          .filter((row) => row.shown)
          .map((row) => (
            <li key={row.key}>
              <span className="im-topic-t">{row.label}</span>
              <span className="im-topic-n">{row.n}</span>
            </li>
          ))}
      </ul>
      {plan.keyDiffers.length > 0 ? (
        <div className="im-update-keys">
          <p className="im-line">{IMPORT.updateKeyLine}</p>
          <ul>
            {listed.map((entry) => (
              <li key={entry.item.uid}>{nb(keyLine(entry))}</li>
            ))}
          </ul>
          {rest > 0 ? <p className="im-line" data-muted="">{nb(IMPORT.updateKeyMore(rest))}</p> : null}
        </div>
      ) : null}
      {plan.notInFile > 0 ? (
        <p className="im-line" data-muted="">
          {IMPORT.updateGoneLine}
        </p>
      ) : null}
    </>
  );
}
