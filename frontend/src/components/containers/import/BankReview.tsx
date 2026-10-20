import { useId, type ReactNode } from 'react';
import type { BankItem, BankParseResult, BankSourceLine } from '../../../types/container';
import { KEY_WORDS, REVIEW, letter, lettersText, nb } from '../copyImport';
import { altDifference, fragmentOf, hasKey, looksLikeStem, needsLook, type ReviewOp } from './reviewModel';
import { useBankReview, type BankReview as ReviewState, type ShownItem } from './useBankReview';
import './bankReview.css';

/**
 * «Сомнительные места» of one file: each question the importer is unsure of, next to the lines of the file it came
 * from, with one-press fixes (the key, «Соединить со следующим», «Это вариант вопроса выше», «Отсюда новый вопрос», «Это
 * не вопрос», «Оставить как есть», the other version after the model pass). On top: the counts, the filter and the model
 * pass with its price.
 *
 * Reusable: `BankReview` takes a parse and gives back the fixed one (onDone); `BankReviewView` draws a state of
 * `useBankReview` for a page that keeps the state itself.
 */

interface Props {
  result: BankParseResult;
  fileName: string;
  /** Reads the file again with the model; absent — the pass is not offered. */
  runAi?: () => Promise<BankParseResult>;
  onDone: (result: BankParseResult) => void;
  onBack: () => void;
}

export default function BankReview({ result, fileName, runAi, onDone, onBack }: Props) {
  const review = useBankReview(result, { runAi });
  return <BankReviewView review={review} fileName={fileName} onDone={() => onDone(review.result)} onBack={onBack} />;
}

/** A piece of a line with the file's formatting: the key's mark (bold, underline, highlight…) shows as in the file. */
function Run({ text, marks }: { text: string; marks: string }) {
  const set = new Set(marks.split(' ').filter(Boolean));
  let node: ReactNode = text;
  if (set.has('code')) node = <code>{node}</code>;
  if (set.has('s')) node = <s>{node}</s>;
  if (set.has('i')) node = <em>{node}</em>;
  if (set.has('u')) node = <u>{node}</u>;
  if (set.has('b')) node = <strong>{node}</strong>;
  if (set.has('color')) node = <span className="br-color">{node}</span>;
  if (set.has('hl') || set.has('shade')) node = <mark data-kind={set.has('hl') ? 'hl' : 'shade'}>{node}</mark>;
  return <>{node}</>;
}

export function SourceLines({ lines }: { lines: BankSourceLine[] }) {
  if (lines.length === 0) return <p className="br-src-none">{REVIEW.noFragment}</p>;
  return (
    <ol className="br-src-lines">
      {lines.map((line) => (
        <li key={line.n} className="br-src-line" value={line.n}>
          <span className="br-src-n" aria-hidden="true">
            {line.n}
          </span>
          <span className="br-src-t">
            {line.cell ? <span className="br-src-cell">{REVIEW.cell(line.cell)}</span> : null}
            {line.checkbox === true ? '☑ ' : line.checkbox === false ? '☐ ' : null}
            {line.runs.map((run, index) => (
              <Run key={index} text={run.t} marks={run.m} />
            ))}
            {line.images > 0 ? <span className="br-src-pic"> {REVIEW.picture}</span> : null}
          </span>
        </li>
      ))}
    </ol>
  );
}

function keyWords(evidence: string): string {
  if (evidence === 'checkbox') return 'ключ флажком';
  return KEY_WORDS[evidence] ?? '';
}

function reasons(item: BankItem): string[] {
  const out: string[] = [];
  for (const doubt of item.doubts ?? []) {
    if (doubt === 'key') {
      out.push(item.flags.includes('no_key') && item.flags.filter((flag) => flag !== 'no_key' && flag !== 'ai_key_rejected').length === 0 ? REVIEW.doubts.no_key : REVIEW.doubts.key);
    } else if (REVIEW.doubts[doubt]) out.push(REVIEW.doubts[doubt]);
  }
  if (item.flags.includes('ai_key_rejected')) out.push(REVIEW.keyRejected);
  return [...new Set(out)];
}

const cut = (text: string) => (text.length > 90 ? `${text.slice(0, 88)}…` : text);
const keyOf = (version: { correct: number[]; answer: string | null }) =>
  version.correct.length ? lettersText(version.correct) : version.answer ? `«${version.answer}»` : '';

/** «Другая версия: …» — what the other reading changes: its key alone, its options, or its words. */
function otherLine(item: BankItem): string | null {
  const alt = item.alt;
  if (!alt) return null;
  switch (altDifference(item)) {
    case 'key':
      return REVIEW.otherKey(alt.correct.length ? 'ключ' : 'ответ', keyOf(alt), keyOf(item));
    case 'options':
      return REVIEW.otherOptions(cut(alt.options.map((option, index) => `${letter(index)}) ${option}`).join('; ')));
    default:
      return REVIEW.other(cut(alt.text));
  }
}

function sourceBadge(item: BankItem): string | null {
  if (item.flags.includes('ai_only')) return REVIEW.modelOnly;
  if (item.flags.includes('ai_disagrees')) return REVIEW.differ;
  if (item.source === 'ai') return REVIEW.fromModel;
  if (item.source === 'both') return REVIEW.same;
  return null;
}

interface CardProps {
  entry: ShownItem;
  result: BankParseResult;
  apply: (op: ReviewOp) => void;
}

function ReviewCard({ entry, result, apply }: CardProps) {
  const { id, item, hasNext, hasPrev } = entry;
  const headId = useId();
  const choice = item.kind === 'single' || item.kind === 'multiple' || item.kind === 'truefalse';
  const many = item.kind === 'multiple';
  const why = reasons(item);
  const badge = sourceBadge(item);
  const lines = fragmentOf(result, item);
  const merged = (item.doubts ?? []).includes('option_merged');
  const pick = (index: number) => {
    if (!many) return apply({ op: 'key', id, correct: [index] });
    const next = item.correct.includes(index) ? item.correct.filter((at) => at !== index) : [...item.correct, index];
    return apply({ op: 'key', id, correct: next });
  };
  const keyLine = hasKey(item)
    ? [`${REVIEW.answer} ${item.correct.length ? item.correct.map(letter).join(', ') : item.answer ?? ''}`, keyWords(item.evidence)].filter(Boolean).join(' · ')
    : REVIEW.noAnswer;
  return (
    <li className="br-card" data-look={needsLook(item) ? '' : undefined} data-checked={item.reviewed ? '' : undefined} aria-labelledby={headId}>
      <div className="br-q">
        <p className="br-num" id={headId}>
          {/* the model's question goes by its place in the list: the number it gives is often a line of the file */}
          <span>{nb(REVIEW.number(item.source === 'ai' ? '' : item.label, item.position))}</span>
          {badge ? <span className="br-badge" data-ai={item.source === 'ai' ? '' : undefined}>{badge}</span> : null}
          {item.reviewed ? <span className="br-badge" data-done="">{REVIEW.checked}</span> : null}
        </p>
        {why.length > 0 ? (
          <ul className="br-why">
            {why.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        ) : null}
        <p className="br-stem">{item.text || '—'}</p>
        {item.options.length > 0 ? (
          <>
            {choice ? <p className="br-hint">{many ? REVIEW.pickKeys : REVIEW.pickKey}</p> : null}
            <ol className="br-opts">
              {item.options.map((option, index) => (
                <li key={index} className="br-opt-row">
                  {choice ? (
                    <button type="button" className="br-opt" aria-pressed={item.correct.includes(index)} onClick={() => pick(index)}>
                      <span className="br-opt-l" aria-hidden="true">
                        {letter(index)}
                      </span>
                      <span className="br-opt-t">{option || '—'}</span>
                    </button>
                  ) : (
                    <p className="br-opt" data-static="">
                      <span className="br-opt-l" aria-hidden="true">
                        {letter(index)}
                      </span>
                      <span className="br-opt-t">{option || '—'}</span>
                    </p>
                  )}
                  {index > 0 && (looksLikeStem(option) || (merged && option.length > 40)) ? (
                    <button type="button" className="sf-link br-split" onClick={() => apply({ op: 'split', id, at: index })}>
                      {REVIEW.splitHere}
                    </button>
                  ) : null}
                </li>
              ))}
            </ol>
          </>
        ) : null}
        <p className="br-key">{keyLine}</p>
        {item.alt ? <p className="br-alt">{otherLine(item)}</p> : null}
      </div>
      <figure className="br-src">
        <figcaption className="br-src-h">{REVIEW.inFile}</figcaption>
        <SourceLines lines={lines} />
      </figure>
      <div className="br-acts">
        {item.alt ? (
          <button type="button" className="br-act" onClick={() => apply({ op: 'alt', id })}>
            {item.alt.source === 'ai' ? REVIEW.takeModel : REVIEW.takeRules}
          </button>
        ) : null}
        {hasPrev && item.options.length === 0 && !/[?:…]\s*$/.test(item.text) ? (
          <button type="button" className="br-act" onClick={() => apply({ op: 'up', id })}>
            {REVIEW.joinUp}
          </button>
        ) : null}
        {hasNext ? (
          <button type="button" className="br-act" onClick={() => apply({ op: 'merge', id })}>
            {REVIEW.mergeNext}
          </button>
        ) : null}
        <button type="button" className="br-act" onClick={() => apply({ op: 'drop', id })}>
          {REVIEW.notQuestion}
        </button>
        {!item.reviewed ? (
          <button type="button" className="br-act" data-quiet="" onClick={() => apply({ op: 'keep', id })}>
            {REVIEW.keep}
          </button>
        ) : null}
      </div>
    </li>
  );
}

function AiBlock({ review }: { review: ReviewState }) {
  const { ai } = review;
  if (ai.status === 'done') {
    return (
      <p className="br-ai-line" role="status">
        {REVIEW.aiDone(ai.spent)}
      </p>
    );
  }
  if (!ai.run || !ai.offer) return null;
  const running = ai.status === 'running';
  return (
    <div className="br-ai" data-worth={ai.offer.worth ? '' : undefined}>
      <button type="button" className={ai.offer.worth ? 'sf-primary br-ai-go' : 'br-act br-ai-go'} disabled={running} onClick={() => void ai.run?.()}>
        {REVIEW.aiButton}
      </button>
      <p className="br-ai-note">
        {running ? REVIEW.aiRunning : REVIEW.aiNote(ai.offer.units)}
        {!running && review.ops.length > 0 ? ` ${REVIEW.aiResets}` : null}
      </p>
      {ai.error ? (
        <p className="br-ai-error" role="alert">
          {ai.error}
        </p>
      ) : null}
    </div>
  );
}

export function BankReviewView({ review, fileName, onDone, onBack }: { review: ReviewState; fileName: string; onDone: () => void; onBack: () => void }) {
  const filterId = useId();
  const { counts, shown } = review;
  return (
    <section className="br" aria-label={REVIEW.title}>
      <header className="br-head">
        <button type="button" className="sf-link br-back" onClick={onBack}>
          {REVIEW.back}
        </button>
        <h1 className="br-title">{REVIEW.title}</h1>
        <p className="br-file">{REVIEW.file(fileName)}</p>
        <p className="br-counts" role="status">
          {REVIEW.counts(counts.total, counts.doubtful, counts.checked)}
        </p>
      </header>
      <AiBlock review={review} />
      <div className="br-filter">
        <input id={filterId} type="checkbox" checked={review.only} onChange={(event) => review.setOnly(event.target.checked)} />
        <label htmlFor={filterId}>{REVIEW.onlyDoubtful}</label>
      </div>
      {shown.length === 0 ? (
        <p className="br-empty">{counts.checked > 0 ? REVIEW.allChecked : REVIEW.none}</p>
      ) : (
        <ol className="br-list">
          {shown.map((entry) => (
            <ReviewCard key={entry.id} entry={entry} result={review.result} apply={review.apply} />
          ))}
        </ol>
      )}
      <footer className="br-foot">
        {review.ops.length > 0 ? (
          <button type="button" className="br-act" data-quiet="" onClick={review.undo}>
            {REVIEW.undo}
          </button>
        ) : null}
        <button type="button" className="sf-primary br-done" onClick={onDone}>
          {REVIEW.done}
        </button>
      </footer>
    </section>
  );
}
