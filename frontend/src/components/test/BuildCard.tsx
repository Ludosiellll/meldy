import { useId, type CSSProperties, type ReactNode } from 'react';
import { isPictureWord, type TestItem } from '../../types/container';
import { EDITOR, KEYS, letter, QUEUE } from '../containers/copyImport';
import ItemPictures, { storedPictures, type PictureSource } from '../containers/ItemPictures';
import { leadingSpaces, stemParts } from '../containers/stemCode';
import { isKeyed, typeOf } from './buildModel';
import { BUILD } from './copyTest';

/**
 * One question of the builder (spec 2026-10-18 §47.2): its number and kind, the question (code shown as typed, each
 * line wrapping under its own indentation, as «Вопросы и ключи» shows it), the options with the key said in a word,
 * the accepted forms of a short answer, the explanation when there is one, and what the author can do with it.
 */

export type CardAction = 'edit' | 'copy' | 'delete' | 'up' | 'down';

interface Props {
  item: TestItem;
  number: number;
  first: boolean;
  last: boolean;
  /** This question's request is on its way. */
  busy: boolean;
  /** Some request of the page is on its way: the actions wait (they keep focus, so they are not disabled). */
  locked: boolean;
  /** False while the card asks whether to delete it: its own buttons step aside for the answer. */
  showActions?: boolean;
  onAction: (action: CardAction) => void;
  /** Under the question: a line after a change, the delete question. */
  children?: ReactNode;
}

function Stem({ text, code, pictures }: { text: string; code: boolean; pictures: PictureSource[] }) {
  const parts = stemParts(text, code);
  if (!parts.code) {
    return (
      <div className="tb-stem">
        {isPictureWord(text) && pictures.length > 0 ? <span className="sr-only">{text}</span> : <p className="tb-stem-lead">{text}</p>}
        <ItemPictures sources={pictures} kind="stem" />
      </div>
    );
  }
  return (
    <div className="tb-stem">
      {parts.before ? <p className="tb-stem-lead">{parts.before}</p> : null}
      <div className="tb-code" role="group" aria-label={QUEUE.code}>
        {parts.code.replace(/\t/g, '    ').split('\n').map((line, index) => (
          <span key={index} className="tb-code-line" style={{ '--tb-ind': leadingSpaces(line) } as CSSProperties}>
            {line || ' '}
          </span>
        ))}
      </div>
      {parts.after ? <p className="tb-stem-lead">{parts.after}</p> : null}
      <ItemPictures sources={pictures} kind="stem" />
    </div>
  );
}

function Arrow({ dir }: { dir: 'up' | 'down' }) {
  return (
    <svg className="tb-arrow" viewBox="0 0 20 20" aria-hidden="true">
      <path d={dir === 'up' ? 'M10 15V5M5.5 9.5 10 5l4.5 4.5' : 'M10 5v10M5.5 10.5 10 15l4.5-4.5'} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export default function BuildCard({ item, number, first, last, busy, locked, showActions = true, onAction, children }: Props) {
  const headId = useId();
  const type = typeOf(item);
  const keyed = isKeyed(item);
  const pictures = item.images ? storedPictures(item.images.stem) : [];
  const explanation = (item.explanation ?? '').trim();

  const act = (action: CardAction, label: ReactNode, extra: { muted?: boolean; disabled?: boolean; className?: string } = {}) => (
    <button
      type="button"
      className={`sf-link tb-act${extra.className ? ` ${extra.className}` : ''}`}
      data-act={`${action}:${item.id}`}
      data-muted={extra.muted ? '' : undefined}
      disabled={extra.disabled}
      aria-disabled={!extra.disabled && locked ? 'true' : undefined}
      onClick={() => {
        if (!locked) onAction(action);
      }}
    >
      {label}
    </button>
  );

  return (
    <article className="tb-card" aria-labelledby={headId} aria-busy={busy || undefined}>
      <header className="tb-card-head">
        <h2 id={headId} className="tb-card-no">
          {BUILD.number(number)}
        </h2>
        <span className="tb-flag">{BUILD.types[type]}</span>
      </header>

      <Stem text={item.stem} code={item.code} pictures={pictures} />

      {item.kind === 'short' ? (
        item.answers.length > 0 ? (
          <div className="tb-forms">
            <p className="tb-forms-label">{BUILD.forms}</p>
            <ul className="tb-forms-list">
              {item.answers.map((form, index) => (
                <li key={index}>{form}</li>
              ))}
            </ul>
          </div>
        ) : (
          <p className="tb-warn">{KEYS.noKeyNow}</p>
        )
      ) : (
        <ol className="tb-options">
          {item.options.map((option, index) => {
            const right = item.correct.includes(index);
            const optionPictures = storedPictures(item.images?.options?.[index]);
            const pictureOnly = optionPictures.length > 0 && (option.trim() === '' || isPictureWord(option));
            return (
              <li key={index} className="tb-option" data-key={right ? '' : undefined} data-code={item.code ? '' : undefined}>
                <span className="tb-letter" aria-hidden="true">
                  {letter(index)}
                </span>
                <span className="tb-text">
                  <span className="sr-only">{`${letter(index)}. `}</span>
                  <ItemPictures sources={optionPictures} kind="option" />
                  {pictureOnly ? <span className="sr-only">{option}</span> : option.trim() === '' ? QUEUE.emptyText : option}
                </span>
                {right ? <span className="tb-tag">{BUILD.rightWord}</span> : null}
              </li>
            );
          })}
        </ol>
      )}
      {item.kind !== 'short' && !keyed ? <p className="tb-warn">{EDITOR.noKey}</p> : null}

      {explanation ? (
        <div className="tb-expl">
          <p className="tb-expl-label">{BUILD.explanation}</p>
          <p className="tb-expl-text">{explanation}</p>
        </div>
      ) : null}

      {children}

      {showActions ? (
        <div className="tb-actions">
          <span className="tb-actions-main">
            {act('edit', KEYS.edit)}
            {act('copy', BUILD.copy)}
            {act('delete', BUILD.remove, { muted: true })}
          </span>
          <span className="tb-actions-move">
            {act(
              'up',
              <>
                <Arrow dir="up" />
                <span className="tb-move-word">{BUILD.up}</span>
              </>,
              { disabled: first, className: 'tb-move' },
            )}
            {act(
              'down',
              <>
                <Arrow dir="down" />
                <span className="tb-move-word">{BUILD.down}</span>
              </>,
              { disabled: last, className: 'tb-move' },
            )}
          </span>
        </div>
      ) : null}
    </article>
  );
}
