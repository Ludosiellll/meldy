import { Fragment, useMemo, type ReactNode } from 'react';
import type { ExamQuestion } from '../../api/exams';
import type { SelfRating as Rating } from '../../api/learning';
import { READINESS_LABELS, type Readiness } from '../../lib/learning/readiness';
import { MarginStroke, Mark, TextMark } from '../marks';
import {
  COVERAGE_MARK,
  COVERAGE_MARK_SIZE,
  COVERAGE_PILL_WORDS,
  COVERAGE_WORDS,
  PILL_MARK_SCALE,
  READINESS_MARK,
  markSeed,
  readinessSeed,
  selectionSeed,
  type SheetCoverage,
} from './marks';
import { glue, marginNotes, type Footnote, type NoteView } from './sheetModel';
import SelfRating from './SelfRating';
import type { FrameSize } from './useFrame';

export interface MarkAppearanceView {
  /** Draw the stroke in (a live result of the current run); stored marks appear at once. */
  animate: boolean;
  delayMs: number;
}

export interface SheetRowView {
  question: ExamQuestion;
  number: string;
  coverage: SheetCoverage;
  readiness: Readiness;
  /**
   * What a screen reader hears after the number: «подтверждено 2 дня назад», «подтверждено 16 дней
   * назад, пора проверить»; the readiness label when absent.
   */
  readinessWords?: string;
  selfRating: Rating | null;
  footnote: Footnote | null;
  appearance: MarkAppearanceView | null;
}

export interface SheetPeak {
  questionId: string;
  /** Draw the new readiness mark in. */
  animate: boolean;
  because: string;
  /** Phones: «Подтверждено ответами: 1 из 40, было 0.» under the row — the column is above, out of view. */
  count?: string;
}

interface ExamSheetProps {
  examId: string;
  /** «Микроэкономика: вопросы к экзамену» — from the exam's title and kind, nothing invented. */
  title: string;
  rows: SheetRowView[];
  sectionTitles: string[];
  selectedId: string | null;
  rateMode: boolean;
  /** The page frame's width class (the rows reflow by the sheet's own width now; kept for the page). */
  frame: FrameSize;
  whyId: string;
  onOpen: (questionId: string) => void;
  onRate: (row: SheetRowView, rating: Rating) => void;
  onRateDone: () => void;
  ratingPending: ReadonlySet<string>;
  ratingErrors: Readonly<Record<string, string>>;
  peak: SheetPeak | null;
  dim: boolean;
  emptyText: string | null;
  /**
   * One line under the list's heading (a phone: the rows have no line of their lecture and fragment, so it says that a
   * tap opens them).
   */
  hint?: string | null;
  /** A quiet link at the end of that line (a phone: «Обозначения», the key to the number circles). */
  hintAction?: ReactNode;
  /** What the link opens, under the line. */
  hintPanel?: ReactNode;
}

/**
 * The row's status pill: the pencil mark and the legend's word («есть в лекциях», «частично», «нет ни в
 * одной»…) in the status colour; on a narrow sheet only its round badge. It stands at the top right of the
 * question, which runs on under it (owner's example of 2026-10-08: as a column of its own it held 176 px beside
 * every line of the question). The pill is for the eye (aria-hidden: it sits inside the row's button, whose name
 * is the question); a screen reader hears the long words before the number (CoverageWords).
 */
function CoveragePill({ examId, row }: { examId: string; row: SheetRowView }) {
  const kind = COVERAGE_MARK[row.coverage];
  const size = kind ? COVERAGE_MARK_SIZE[kind] : null;
  return (
    <span className="ex-cov" data-mark={kind ?? undefined} aria-hidden="true">
      {kind && size && (
        <Mark
          kind={kind}
          seed={markSeed(examId, row.question.position)}
          width={Math.round(size.width * PILL_MARK_SCALE)}
          height={Math.round(size.height * PILL_MARK_SCALE)}
          weight={size.weight}
          animate={row.appearance?.animate ?? false}
          delayMs={row.appearance?.delayMs ?? 0}
        />
      )}
      <span className="ex-cov-word">{COVERAGE_PILL_WORDS[row.coverage]}</span>
    </span>
  );
}

/** The row's status in the long words, for a screen reader, first in the row as before. */
function CoverageWords({ row }: { row: SheetRowView }) {
  return <span className="ex-sr ex-cov-sr">{COVERAGE_WORDS[row.coverage]}</span>;
}

function NumberCell({ examId, row, drawIn }: { examId: string; row: SheetRowView; drawIn: boolean }) {
  const kind = READINESS_MARK[row.readiness];
  const seed = readinessSeed(examId, row.question.position);
  return (
    <span className="ex-qn">
      {kind ? (
        <TextMark
          kind={kind}
          seed={seed}
          className="ex-qn-box"
          animate={drawIn}
          // The number stands in a circle: the ring goes round it evenly, the line and the wave under it.
          padX={kind === 'ring' ? 5 : undefined}
          padY={kind === 'ring' ? 5 : undefined}
          dy={kind === 'ring' ? undefined : 5}
          weight={kind === 'wave' ? 2.4 : undefined}
        >
          {row.number}
        </TextMark>
      ) : (
        <span className="ex-qn-box">{row.number}</span>
      )}
      {row.readiness !== 'untested' && <span className="ex-sr">, {row.readinessWords || READINESS_LABELS[row.readiness]}</span>}
    </span>
  );
}

/**
 * The department's list as a card: an ordered list with the department's numbering in circles (the
 * readiness marks on them), the question, its status pill with the pencil mark, the lecture and its
 * fragments under the question (or «знаю · плаваю · не знаю» in self-rating mode). A row opens
 * «почему»; the selected row is tinted and keeps a pencil stroke down its edge.
 */
/** A first mention this short stays on one line: «Инфляция, фрагмент 1». */
const ONE_LINE_NOTE = 22;

/**
 * The right-margin note. The first mention of a lecture names it (at most two lines, the full name is
 * in title and in «почему») and gives its fragment on the line under it, so a long name never cuts
 * the fragment off; while the lecture stays the same the note is one line, «там же, фрагмент 4».
 */
function MarginNote({ footnote, note, appearance }: { footnote: Footnote; note: NoteView; appearance: MarkAppearanceView | null }) {
  const full = footnote.fragments ? `${footnote.title}, ${footnote.fragments}` : footnote.title;
  const short = `${note.lead}, ${note.fragments}`.length <= ONE_LINE_NOTE;
  return (
    <span
      className="ex-qnote sf-pnote"
      style={{ pointerEvents: 'none', animationDelay: appearance?.animate ? `${appearance.delayMs}ms` : undefined }}
      data-manual={footnote.manual ? '' : undefined}
      data-same={!note.named && !footnote.manual ? '' : undefined}
      data-short={note.named && short ? '' : undefined}
      data-fresh={appearance?.animate ? '' : undefined}
      title={full}
    >
      {note.named && note.fragments ? (
        <>
          <span className="ex-qnote-lead">{`${note.lead},`}</span> <span className="ex-qnote-frag">{note.fragments}</span>
        </>
      ) : (
        `${note.lead}${note.fragments ? `, ${note.fragments}` : ''}`
      )}
    </span>
  );
}

export default function ExamSheet(props: ExamSheetProps) {
  const { examId, rows, rateMode, peak, selectedId } = props;
  let previousSection: number | null = null;
  // «Нейронные сети и глубокое обучение, фрагмент 3» on the first mention, «там же, фрагмент 4» after.
  const notes = useMemo(() => marginNotes(rows.map((row) => ({ section: row.question.section, footnote: row.footnote }))), [rows]);

  return (
    <article
      className="sf-sheet ex-sheet"
      aria-label="Список вопросов кафедры с пометками"
      data-dim={props.dim ? '' : undefined}
      data-rate={rateMode ? '' : undefined}
    >
      <header className="ex-sheet-h" data-hint={props.hint || props.hintAction ? '' : undefined}>
        <h2>{props.title}</h2>
        {props.hint || props.hintAction ? (
          <p className="ex-sheet-hint">
            {props.hint}
            {props.hint && props.hintAction ? ' ' : null}
            {props.hintAction}
          </p>
        ) : null}
        {props.hintPanel}
      </header>
      {rateMode && (
        <p className="ex-rate-intro">
          <span>Отметьте, насколько уверенно вы ответили бы на каждый вопрос.</span>
          <button type="button" className="sf-link" onClick={props.onRateDone}>
            Готово
          </button>
        </p>
      )}
      {rows.length === 0 && props.emptyText && <p className="ex-rate-intro">{props.emptyText}</p>}
      <ol className="ex-qs">
        {rows.map((row, index) => {
          const note = notes[index];
          const { question } = row;
          const section = question.section;
          const heading =
            section !== null && section !== previousSection
              ? props.sectionTitles[section - 1]?.trim() || `Раздел ${section}`
              : null;
          if (section !== null) previousSection = section;
          const selected = selectedId === question.id;
          const isPeak = peak?.questionId === question.id;
          const label = `вопрос ${row.number}`;
          return (
            <Fragment key={question.id}>
              {heading && (
                <li className="ex-sec">{heading}</li>
              )}
              <li
                className="ex-q"
                id={`exam-q-${question.id}`}
                data-selected={selected ? '' : undefined}
                data-peak={isPeak ? '' : undefined}
                data-coverage={row.coverage}
                data-readiness={row.readiness}
              >
                <CoverageWords row={row} />
                <NumberCell examId={examId} row={row} drawIn={Boolean(isPeak && peak?.animate)} />
                {rateMode ? (
                  <span className="ex-open" style={{ cursor: 'default' }}>
                    <CoveragePill examId={examId} row={row} />
                    {question.text}
                  </span>
                ) : (
                  <button
                    type="button"
                    className="ex-open"
                    aria-expanded={selected}
                    aria-controls={selected ? props.whyId : undefined}
                    onClick={() => props.onOpen(question.id)}
                  >
                    <CoveragePill examId={examId} row={row} />
                    {question.text}
                  </button>
                )}
                {rateMode ? (
                  <SelfRating
                    value={row.selfRating}
                    questionLabel={label}
                    seedKey={`${examId}:${question.position}`}
                    pending={props.ratingPending.has(question.id)}
                    error={props.ratingErrors[question.id] ?? null}
                    onChange={(rating) => props.onRate(row, rating)}
                  />
                ) : (
                  row.footnote && note && <MarginNote footnote={row.footnote} note={note} appearance={row.appearance} />
                )}
                {isPeak && peak?.because && <span className="ex-because">{glue(peak.because)}</span>}
                {isPeak && peak?.count && <span className="ex-because ex-because-count">{glue(peak.count)}</span>}
                {(selected || isPeak) && <MarginStroke seed={selectionSeed(examId, question.position)} animate={isPeak} />}
              </li>
            </Fragment>
          );
        })}
      </ol>
    </article>
  );
}
