import { Fragment, useMemo } from 'react';
import type { ExamQuestion } from '../../api/exams';
import type { SelfRating as Rating } from '../../api/learning';
import { READINESS_LABELS, type Readiness } from '../../lib/learning/readiness';
import { MarginStroke, Mark, TextMark } from '../marks';
import {
  COVERAGE_MARK,
  COVERAGE_MARK_SIZE,
  COVERAGE_WORDS,
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
}

const PHONE_SCALE = 0.88;

function CoverageCell({ examId, row, frame }: { examId: string; row: SheetRowView; frame: FrameSize }) {
  const kind = COVERAGE_MARK[row.coverage];
  const size = kind ? COVERAGE_MARK_SIZE[kind] : null;
  const scale = frame === 's' ? PHONE_SCALE : 1;
  return (
    <span className="ex-cov" data-mark={kind ?? undefined}>
      {kind && size && (
        <Mark
          kind={kind}
          seed={markSeed(examId, row.question.position)}
          width={Math.round(size.width * scale)}
          height={Math.round(size.height * scale)}
          weight={size.weight}
          animate={row.appearance?.animate ?? false}
          delayMs={row.appearance?.delayMs ?? 0}
        />
      )}
      <span className="ex-sr">{COVERAGE_WORDS[row.coverage]}</span>
    </span>
  );
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
          padX={kind === 'ring' ? 7 : undefined}
          padY={kind === 'ring' ? 3 : undefined}
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
 * The department's list as a sheet of paper: an ordered list with the department's numbering in
 * Literata, coverage marks on the left margin, readiness marks on the numbers, the lecture and its
 * fragments on the right margin (or «знаю · плаваю · не знаю» in self-rating mode). A row opens
 * «почему»; the selected row gets a pencil stroke down the margin, never a tint.
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
      <header className="ex-sheet-h">
        <h2>{props.title}</h2>
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
                <CoverageCell examId={examId} row={row} frame={props.frame} />
                <NumberCell examId={examId} row={row} drawIn={Boolean(isPeak && peak?.animate)} />
                {rateMode ? (
                  <span className="ex-open" style={{ cursor: 'default' }}>
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
