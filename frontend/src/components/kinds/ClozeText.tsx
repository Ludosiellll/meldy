import { Fragment } from 'react';
import { gapPieces } from '../../lib/kinds/cloze';
import { KINDS } from './copyKinds';
import QText from './QText';

/**
 * «Пропуски в тексте» (release 48): the stem with a field in place of each gap (a run of three or more underscores).
 * Each field is labelled «Пропуск 2 из 3» for screen readers and grows with what is typed. After the answer
 * (`review`) each field says whether it is right and, when the forms are shown, what the gap takes.
 */

export interface ClozeReview {
  right: boolean[] | null;
  forms: string[][] | null;
}

interface Props {
  stem: string;
  value: string[];
  onChange?: (next: string[]) => void;
  onSubmit?: () => void;
  disabled?: boolean;
  review?: ClozeReview | null;
  id?: string;
  stemRef?: React.Ref<HTMLParagraphElement>;
}

export const GAP_INPUT_MAX = 200;

export default function ClozeText({ stem, value, onChange, onSubmit, disabled = false, review = null, id, stemRef }: Props) {
  const pieces = gapPieces(stem);
  const gaps = pieces.length - 1;
  const locked = disabled || Boolean(review) || !onChange;
  return (
    <div className="kd-cloze-wrap">
      <p className="kd-cloze" id={id} ref={stemRef} tabIndex={-1}>
        {pieces.map((piece, index) => {
          const text = value[index] ?? '';
          const right = review?.right ? review.right[index] : undefined;
          return (
            <Fragment key={index}>
              <QText text={piece} />
              {index < gaps ? (
                <span className="kd-gap-box" data-state={right === undefined ? undefined : right ? 'right' : 'wrong'}>
                  <input
                    className="kd-gap"
                    type="text"
                    value={text}
                    size={Math.max(6, Math.min(28, [...text].length + 1))}
                    maxLength={GAP_INPUT_MAX}
                    readOnly={locked}
                    autoComplete="off"
                    autoCapitalize="off"
                    spellCheck={false}
                    enterKeyHint={index === gaps - 1 ? 'done' : 'next'}
                    aria-label={KINDS.gapLabel(index + 1, gaps)}
                    aria-invalid={right === false || undefined}
                    onChange={(event) => {
                      if (!onChange) return;
                      const next = Array.from({ length: gaps }, (_, k) => value[k] ?? '');
                      next[index] = event.target.value;
                      onChange(next);
                    }}
                    onKeyDown={(event) => {
                      if (event.key !== 'Enter') return;
                      event.preventDefault();
                      const fields = (event.currentTarget.closest('.kd-cloze') as HTMLElement | null)?.querySelectorAll<HTMLInputElement>('.kd-gap');
                      const next = fields?.[index + 1];
                      if (next) next.focus();
                      else onSubmit?.();
                    }}
                  />
                </span>
              ) : null}
            </Fragment>
          );
        })}
      </p>
      {review ? (
        <ul className="kd-gap-list">
          {Array.from({ length: gaps }, (_, index) => {
            const right = review.right ? review.right[index] : undefined;
            const forms = review.forms?.[index] ?? [];
            const typed = (value[index] ?? '').trim();
            return (
              <li key={index} data-state={right === undefined ? undefined : right ? 'right' : 'wrong'}>
                <span className="kd-gap-n">{KINDS.gapLabel(index + 1, gaps)}</span>
                <span>{typed === '' ? KINDS.gapEmpty : typed}</span>
                {right ? (
                  <span className="kd-tag" data-tone="right">
                    {KINDS.gapRight}
                  </span>
                ) : forms.length > 0 ? (
                  <span className="kd-tag">{KINDS.gapWrong(forms.join(' / '))}</span>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}
