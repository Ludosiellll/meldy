import { useId, useState, type ReactNode } from 'react';
import { ArrowLeft } from 'lucide-react';
import MoreMenu from '../../ui/MoreMenu';
import { count, IMPORT, KEYS_AI_WORDS, keyShareLine, nb } from '../copyImport';
import { problemParts, type DraftSubject } from './importModel';

/**
 * One subject's preview (Concept 1 §3.2, a tap on a row): where its name came from, how many questions and topics,
 * the file's numbers and the ones not found, how the key is marked («Отмечен по-другому?»), what needs a look, the
 * topics. Renaming goes through «⋯ → Переименовать» (design critique I16: a tap on a heading is invisible).
 *
 * A subject made of variants in several files (owner, 2026-11-04) says so — «Варианты одного предмета: 12 файлов
 * (Вариант 1 – Вариант 12)», how many repeats of other variants were left out — and offers «Разделить по файлам»; one
 * file of a split group offers «Объединить варианты».
 */


interface Props {
  subject: DraftSubject;
  phone: boolean;
  onBack: () => void;
  onRename: (title: string) => void;
  onRemove: () => void;
  onRestore: () => void;
  onCheck: () => void;
  onKeySource: () => void;
  onMerge: (merged: boolean) => void;
  onFormat: ((format: 'open' | 'test') => void) | null;
  /** Variants of one subject: split them into one subject per file (true) or join them again (false). */
  onSplit?: (split: boolean) => void;
  /** «Подобрать ключи с ИИ» for this subject, its run and its keys to check (ImportPage). */
  aiKeys?: ReactNode;
}

export default function SubjectDetail({ subject, phone, onBack, onRename, onRemove, onRestore, onCheck, onKeySource, onMerge, onFormat, onSplit, aiKeys }: Props) {
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState(subject.title);
  const fieldId = useId();
  const parts = problemParts(subject);
  const totalProblems = parts.reduce((sum, part) => sum + part.n, 0);
  const choice = subject.test.filter((item) => item.kind !== 'short').length;
  const total = subject.test.length + subject.blocked.length + subject.oral.length;
  const from =
    subject.titleFrom === 'heading'
      ? IMPORT.fromHeading
      : subject.titleFrom === 'file'
        ? subject.files.length > 1
          ? IMPORT.fromFiles
          : IMPORT.fromFile(subject.fileName)
        : subject.titleFrom === 'number'
          ? IMPORT.fromNumber
          : null;
  const meta = [
    count(total, 'вопрос', 'вопроса', 'вопросов'),
    subject.topicsTotal > 0 ? IMPORT.topicsLine(subject.topicsTotal) : null,
    subject.numbers ? IMPORT.numbers(subject.numbers.first, subject.numbers.last, subject.numbers.missing, subject.numbers.more) : null,
  ]
    .filter(Boolean)
    .join(' · ');
  const oralOnly = subject.test.length === 0 && subject.blocked.length === 0;
  const startRename = () => {
    setDraft(subject.title);
    setRenaming(true);
  };

  return (
    <section className="im-subject" aria-labelledby={`${fieldId}-h`}>
      <button type="button" className="sf-link im-back" onClick={onBack}>
        <ArrowLeft aria-hidden="true" strokeWidth={1.75} />
        {IMPORT.back}
      </button>
      {renaming ? (
        <form
          className="im-rename"
          onSubmit={(event) => {
            event.preventDefault();
            if (draft.trim()) onRename(draft.trim());
            setRenaming(false);
          }}
        >
          <label className="im-label" htmlFor={fieldId}>
            {IMPORT.renameLabel}
          </label>
          <div className="im-rename-row">
            <input id={fieldId} className="im-input" value={draft} maxLength={200} autoFocus onChange={(event) => setDraft(event.target.value)} />
            <button type="submit" className="im-small">
              {IMPORT.renameDone}
            </button>
          </div>
        </form>
      ) : (
        <div className="im-subject-head">
          <h2 id={`${fieldId}-h`} className="im-subject-h">
            {subject.title}
          </h2>
          {phone ? (
            <MoreMenu
              variant="round"
              label={IMPORT.more(subject.title)}
              items={[
                { key: 'rename', label: IMPORT.rename, onSelect: startRename },
                subject.removed
                  ? { key: 'restore', label: IMPORT.restoreSubject, onSelect: onRestore }
                  : { key: 'remove', label: IMPORT.removeSubject, onSelect: onRemove, danger: true },
              ]}
            />
          ) : (
            <button type="button" className="sf-link" data-muted="" onClick={startRename}>
              {IMPORT.rename}
            </button>
          )}
        </div>
      )}
      {from ? <p className="im-subject-from">{from}</p> : null}
      <p className="im-subject-meta">{nb(meta)}</p>

      {subject.variants && !subject.variants.split ? (
        <>
          <p className="im-line">
            {nb(
              IMPORT.variantsLine(
                subject.files.length,
                subject.files.map((file) => file.variant).filter((variant): variant is number => variant !== null),
              ),
            )}{' '}
            {onSplit ? (
              <button type="button" className="sf-link" data-muted="" onClick={() => onSplit(true)}>
                {IMPORT.variantsSplit}
              </button>
            ) : null}
          </p>
          {subject.variantRepeats > 0 ? (
            <p className="im-line" data-muted="">
              {nb(IMPORT.variantRepeats(subject.variantRepeats))}
            </p>
          ) : null}
        </>
      ) : subject.variants?.split ? (
        <p className="im-line">
          {nb(IMPORT.variantsSplitLine(subject.files[0]?.variant ?? null, subject.variants.files))}{' '}
          {onSplit ? (
            <button type="button" className="sf-link" onClick={() => onSplit(false)}>
              {IMPORT.variantsJoin}
            </button>
          ) : null}
        </p>
      ) : null}

      {subject.restart && !subject.part ? (
        <p className="im-line">
          {subject.merged ? null : `${IMPORT.restart} `}
          <button type="button" className="sf-link" onClick={() => onMerge(!subject.merged)}>
            {subject.merged ? IMPORT.unmerge : IMPORT.merge}
          </button>
        </p>
      ) : null}

      {choice > 0 ? (
        <p className="im-line">
          {nb(keyShareLine(subject.keySource ?? 'none', subject.keyed, subject.test.length))}{' '}
          {subject.source !== 'pdf' ? (
            <button type="button" className="sf-link" data-muted="" onClick={onKeySource}>
              {IMPORT.otherWay}
            </button>
          ) : null}
        </p>
      ) : null}

      {subject.aiKeyed > 0 ? (
        <p className="im-line" data-muted="">
          {nb(KEYS_AI_WORDS.detailAi(subject.aiKeyed))}
        </p>
      ) : null}
      {aiKeys}

      {subject.source === 'pdf' ? <p className="im-line" data-muted="">{IMPORT.pdfNote}</p> : null}

      {totalProblems > 0 ? (
        <p className="im-line">
          {nb(IMPORT.detailProblems(parts))}{' '}
          <button type="button" className="sf-link" onClick={onCheck}>
            {IMPORT.problemsGo}
          </button>
        </p>
      ) : null}

      {subject.topicCounts.length > 0 ? (
        <>
          <h3 className="im-h3">{IMPORT.topicsTitle}</h3>
          <ul className="im-topics">
            {subject.topicCounts.map((topic, index) => (
              <li key={`${index}-${topic.title}`}>
                <span className="im-topic-t">{topic.title}</span>
                <span className="im-topic-n">{topic.items}</span>
              </li>
            ))}
          </ul>
        </>
      ) : oralOnly && subject.oralSections.length > 0 ? (
        <>
          <h3 className="im-h3">{IMPORT.topicsTitle}</h3>
          <ul className="im-topics">
            {subject.oralSections.map((title, index) => (
              <li key={`${index}-${title}`}>
                <span className="im-topic-t">{title}</span>
                <span className="im-topic-n">{subject.oral.filter((question) => question.section === index + 1).length}</span>
              </li>
            ))}
          </ul>
        </>
      ) : null}

      <p className="im-subject-acts">
        {onFormat && subject.source !== 'pdf' ? (
          <button type="button" className="sf-link" data-muted="" onClick={() => onFormat(oralOnly ? 'test' : 'open')}>
            {oralOnly ? IMPORT.readAsTest : IMPORT.readAsOral}
          </button>
        ) : null}
        {!phone ? (
          subject.removed ? (
            <button type="button" className="sf-link" onClick={onRestore}>
              {IMPORT.restoreSubject}
            </button>
          ) : (
            <button type="button" className="sf-link" data-muted="" onClick={onRemove}>
              {IMPORT.removeSubject}
            </button>
          )
        ) : null}
      </p>
    </section>
  );
}
