import { forwardRef, type CSSProperties, type ReactNode, type Ref } from 'react';
import { isPictureWord, NEW_KINDS, type TestItem } from '../../types/container';
import type { KindAnswer } from '../../lib/kinds/answer';
import KindBody, { type KindReview } from '../kinds/KindBody';
import QText from '../kinds/QText';
import ReadAloud, { readText } from '../kinds/ReadAloud';
import * as copy from './copy';
import ItemPictures, { storedPictures } from './ItemPictures';
import { leadingSpaces, stemParts } from './stemCode';
import './room.css';

/**
 * One question at a time (Concept 1 §3.7; decisions 41–43, 50, 54): a muted line above it (the subject, «повтор, не в
 * счёт», after the answer «№ 37 · тема 2.12»), the words, the code as the file has it, the options as rows of one card
 * with their letters after the shuffle, or the field of a short answer. After an answer the options say it in words:
 * «Ваш ответ», «В файле» («Верный ответ» for a key the author set: no file says it, release 47), «Верно».
 */

/**
 * Code: one block per source line, so a phone wraps each under its own start and never scrolls sideways. The hanging
 * indent of a line is its own leading spaces (room.css --ct-ind): a wrapped part continues under its line, two
 * characters in, never left of the line's own indentation (usability check m8).
 */
export function CodeBlock({ code }: { code: string }) {
  const lines = code.replace(/\t/g, '    ').split('\n');
  return (
    <pre className="ct-code" translate="no">
      <code>
        {lines.map((line, index) => (
          <span key={index} className="ct-code-line" style={{ '--ct-ind': leadingSpaces(line) } as CSSProperties}>
            {line === '' ? ' ' : line}
          </span>
        ))}
      </code>
    </pre>
  );
}

export interface Answered {
  chosen: number[] | null;
  text: string | null;
  correct: boolean;
  dontKnow: boolean;
}

interface QuestionCardProps {
  item: TestItem;
  /** File indices in the order shown (empty for a short answer). */
  order: number[];
  context: ReactNode;
  mode: 'learn' | 'mock';
  answered: Answered | null;
  /** Several correct, before the answer: the ticked file indices. */
  ticked: number[];
  /** «Как на экзамене»: the chosen file indices (an outline, nothing revealed). */
  picked?: number[] | null;
  text: string;
  textInvalid?: boolean;
  hint?: ReactNode;
  onPick: (place: number) => void;
  onText: (value: string) => void;
  onSubmitText: () => void;
  stemRef?: Ref<HTMLHeadingElement>;
  fileRef?: Ref<HTMLButtonElement>;
  /** Release 48 (docs/kinds/CONTRACT.md): the answer of a new kind, before and after it is given. */
  kindValue?: KindAnswer;
  onKind?: (value: KindAnswer) => void;
  /** After the answer (learn): the key of a new kind on its own fields. */
  kindReview?: KindReview | null;
  /** match: the right items (a session: the row's answers; a quiz: the attempt's own order) and the order to list them in. */
  right?: string[];
  rightOrder?: number[];
  /** «Засчитывается частично» under a question with partial credit (a quiz; a session counts only full answers). */
  partialNote?: boolean;
  /** «Озвучить вопрос». */
  readAloud?: boolean;
}

function Check() {
  return (
    <span className="ct-box" aria-hidden="true">
      <svg viewBox="0 0 16 16">
        <path d="M3.5 8.5l3 3 6-7" />
      </svg>
    </span>
  );
}

/** An option's words and pictures; words that only stand for its picture are for screen readers. */
function OptionWords({ text, paths }: { text: string; paths: string[] | undefined }) {
  const sources = storedPictures(paths);
  if (sources.length === 0) return <QText text={text} />;
  return (
    <>
      <ItemPictures sources={sources} kind="option" />
      {isPictureWord(text) ? <span className="sr-only">{text}</span> : <span className="ct-opt-words"><QText text={text} /></span>}
    </>
  );
}

const QuestionCard = forwardRef<HTMLDivElement, QuestionCardProps>(function QuestionCard(props, ref) {
  const { item, order, context, mode, answered, ticked, picked, text, textInvalid, hint, onPick, onText, onSubmitText, stemRef, fileRef } = props;
  const newKind = NEW_KINDS.includes(item.kind);
  // The flag of the import, and lines that clearly read as code even without it (stemCode.ts, usability check m1).
  const stem = stemParts(item.stem, item.code);
  const multiple = item.kind === 'multiple';
  // Pictures (owner, 2026-10-14): under the words; a stem or an option that is only a picture keeps its stand-in words
  // («Вопрос на картинке», «Рисунок Б») for screen readers only.
  const stemPictures = storedPictures(item.images?.stem);
  const pictureStem = stemPictures.length > 0 && isPictureWord(item.stem);
  const learn = mode === 'learn';

  let body: ReactNode;
  if (newKind) {
    // Release 48: the new kinds' own fields (components/kinds); a cloze shows its stem inside them, with the gaps.
    body = (
      <KindBody
        key={item.id}
        kind={item.kind}
        stem={item.stem}
        options={item.options}
        right={props.right ?? item.answers}
        rightOrder={props.rightOrder}
        initialOrder={order}
        unit={item.unit}
        value={props.kindValue}
        onChange={answered && learn ? undefined : props.onKind}
        onSubmit={onSubmitText}
        invalid={textInvalid}
        review={learn ? props.kindReview ?? null : null}
        partial={props.partialNote && item.partial}
      />
    );
  } else if (item.kind === 'short') {
    const state = answered ? (answered.correct ? 'right' : 'wrong') : undefined;
    body = (
      <form
        key={item.id}
        className="ct-short"
        data-state={state}
        onSubmit={(event) => {
          event.preventDefault();
          onSubmitText();
        }}
      >
        <label htmlFor={`ct-short-${item.id}`}>{copy.SHORT_LABEL}</label>
        <input
          id={`ct-short-${item.id}`}
          type="text"
          inputMode="text"
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
          enterKeyHint="done"
          value={answered && learn ? answered.text ?? '' : text}
          readOnly={Boolean(answered) && learn}
          aria-invalid={textInvalid || undefined}
          onChange={(event) => onText(event.target.value)}
        />
      </form>
    );
  } else {
    // Keyed by the question (owner, 2026-10-20): the next question gets buttons of its own. A kept button kept what the
    // browser holds on it — a phone's sticky :hover after the tap that moved the session on — and, keyed by the file's
    // place only, it was the next question's option at the place of the key just tapped: often its right answer.
    body = (
      <div key={item.id} className="ct-opts" role="group" aria-label="Варианты ответа">
        {order.map((fileIndex, place) => {
          const letter = copy.OPTION_LETTERS[place] ?? String(place + 1);
          const inKey = item.correct.includes(fileIndex);
          let state: string | undefined;
          let tag: string | null = null;
          if (learn && answered) {
            const chosen = answered.chosen?.includes(fileIndex) ?? false;
            if (inKey) {
              state = 'file';
              tag = chosen ? copy.TAG_RIGHT : copy.keyTag(item.key_source);
            } else if (chosen) {
              state = 'wrong';
              tag = copy.TAG_YOURS;
            }
          } else if (!learn && picked?.includes(fileIndex)) {
            state = 'picked';
          }
          const pressed = !answered && multiple ? ticked.includes(fileIndex) : undefined;
          const isFileRef = learn && answered && inKey && !(answered.chosen?.includes(fileIndex) ?? false);
          return (
            <button
              key={`${item.id}:${fileIndex}`}
              ref={isFileRef ? fileRef : undefined}
              type="button"
              className="ct-opt"
              data-multi={multiple ? '' : undefined}
              data-state={state}
              data-ticked={learn && answered && multiple && (answered.chosen?.includes(fileIndex) ?? false) ? '' : undefined}
              aria-pressed={!learn ? Boolean(picked?.includes(fileIndex)) : pressed}
              aria-disabled={learn && answered ? 'true' : undefined}
              onClick={() => {
                if (learn && answered) return;
                onPick(place);
              }}
            >
              {multiple ? <Check /> : null}
              <span className="ct-opt-l">{letter}</span>
              <span className="ct-opt-t">
                <OptionWords text={item.options[fileIndex]} paths={item.images?.options?.[fileIndex]} />
                {tag ? <span className="ct-opt-tag">{tag}</span> : null}
              </span>
            </button>
          );
        })}
      </div>
    );
  }

  return (
    <div ref={ref} className="ct-q">
      <p className="ct-ctx">{context}</p>
      {item.kind === 'cloze' ? (
        <h1 className="sr-only" ref={stemRef} tabIndex={-1}>
          {item.stem.replace(/_{3,}/g, '…')}
        </h1>
      ) : stem.before && !pictureStem ? (
        <h1 className="ct-stem" ref={stemRef} tabIndex={-1}>
          <QText text={stem.before} />
        </h1>
      ) : (
        <h1 className="sr-only" ref={stemRef} tabIndex={-1}>
          {item.stem.split('\n')[0]}
        </h1>
      )}
      <ItemPictures sources={stemPictures} kind="stem" />
      {stem.code && item.kind !== 'cloze' ? <CodeBlock code={stem.code} /> : null}
      {stem.after && item.kind !== 'cloze' ? <p className="ct-stem-after"><QText text={stem.after} /></p> : null}
      {props.readAloud ? (
        <ReadAloud text={readText({ kind: item.kind, stem: item.stem, options: item.options, right: props.right ?? item.answers, unit: item.unit })} />
      ) : null}
      {multiple && (!answered || !learn) ? <p className="ct-hint">{copy.MULTIPLE_HINT}</p> : null}
      {hint}
      {body}
    </div>
  );
});

export default QuestionCard;
