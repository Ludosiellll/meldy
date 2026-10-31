import { useId, type Ref } from 'react';
import type { ItemKind } from '../../types/container';
import type { EssayMark } from '../../types/quiz';
import type { KindAnswer } from '../../lib/kinds/answer';
import { gapCount } from '../../lib/kinds/cloze';
import ClozeText, { type ClozeReview } from './ClozeText';
import { KINDS } from './copyKinds';
import MatchBoard, { type MatchReview } from './MatchBoard';
import OrderList, { type OrderReview } from './OrderList';
import QText from './QText';
import { EssayField, NumberField } from './TextFields';
import './kinds.css';

/**
 * The answer of a question of a new kind (release 48) on any screen: a session, «Как на экзамене», a контрольная one
 * question at a time or on the studio's page. Indices are those of the lists given: a session gives file indices, a quiz
 * the attempt's shown ones. An order question shows `initialOrder` until the participant moves a row or keeps the order
 * as it is (only then is it answered). After the answer `review` turns the fields into the answer and its key.
 */

export interface KindReview {
  order?: OrderReview;
  match?: MatchReview;
  cloze?: ClozeReview;
  /** number: right or not (the field's colour). */
  right?: boolean | null;
}

export interface KindBodyProps {
  kind: ItemKind;
  stem: string;
  options: string[];
  right?: string[];
  rightOrder?: number[];
  initialOrder?: number[];
  unit?: string | null;
  value: KindAnswer | undefined;
  onChange?: (value: KindAnswer) => void;
  onSubmit?: () => void;
  invalid?: boolean;
  review?: KindReview | null;
  partial?: boolean;
  stemRef?: Ref<HTMLParagraphElement>;
  fieldRef?: Ref<HTMLTextAreaElement>;
}

const identity = (n: number) => Array.from({ length: n }, (_, i) => i);

export default function KindBody(props: KindBodyProps) {
  const { kind, stem, options, value, onChange, onSubmit, invalid, review, partial } = props;
  const id = useId();
  const locked = Boolean(review) || !onChange;
  let body: React.ReactNode = null;
  if (kind === 'number') {
    body = (
      <NumberField
        id={`${id}-n`}
        value={typeof value === 'string' ? value : ''}
        unit={props.unit}
        readOnly={locked}
        invalid={invalid}
        state={review ? (review.right ? 'right' : 'wrong') : undefined}
        onChange={onChange ? (text) => onChange(text === '' ? null : text) : undefined}
        onSubmit={onSubmit}
      />
    );
  } else if (kind === 'essay') {
    body = (
      <EssayField
        id={`${id}-e`}
        value={typeof value === 'string' ? value : ''}
        readOnly={locked}
        invalid={invalid}
        fieldRef={props.fieldRef}
        onChange={onChange ? (text) => onChange(text === '' ? null : text) : undefined}
      />
    );
  } else if (kind === 'order') {
    const start = props.initialOrder && props.initialOrder.length === options.length ? props.initialOrder : identity(options.length);
    const current = Array.isArray(value) && value.length === options.length ? (value as number[]) : start;
    body = (
      <>
        <OrderList items={options} value={current} onChange={locked ? undefined : (next) => onChange?.(next)} review={review?.order ?? null} />
        {!locked && !Array.isArray(value) ? (
          <div className="kd-keep">
            <button type="button" className="sf-link" onClick={() => onChange?.([...current])}>
              {KINDS.orderKeep}
            </button>
          </div>
        ) : null}
      </>
    );
  } else if (kind === 'match') {
    const right = props.right ?? [];
    const current = Array.isArray(value) && value.length === options.length ? (value as number[]) : options.map(() => -1);
    body = (
      <>
        <MatchBoard
          left={options}
          right={right}
          rightOrder={props.rightOrder}
          value={current}
          onChange={locked ? undefined : (next) => onChange?.(next.some((v) => v >= 0) ? next : null)}
          review={review?.match ?? null}
        />
        {!locked && right.length > options.length ? <p className="kd-note">{KINDS.matchExtra}</p> : null}
      </>
    );
  } else if (kind === 'cloze') {
    const gaps = gapCount(stem);
    const current = Array.isArray(value) ? (value as string[]) : Array.from({ length: gaps }, () => '');
    body = (
      <ClozeText
        stem={stem}
        value={current}
        stemRef={props.stemRef}
        onChange={locked ? undefined : (next) => onChange?.(next.some((t) => t.trim() !== '') ? next : null)}
        onSubmit={onSubmit}
        review={review?.cloze ?? null}
      />
    );
  }
  return (
    <div className="kd-body" data-kind={kind}>
      {kind === 'cloze' && !locked ? <p className="kd-hint">{KINDS.clozeHint(gapCount(stem))}</p> : null}
      {body}
      {partial && !review ? <p className="kd-note">{KINDS.partialNote}</p> : null}
    </div>
  );
}

/** An essay's mark under it: «Частично» with the lecture's quote; «Ответ ещё не проверен» while it waits. */
export function EssayMarkLine({ mark, pending }: { mark: EssayMark | null | undefined; pending?: boolean }) {
  if (!mark) return pending ? <p className="kd-mark" data-tone="wait">{KINDS.essayWait}</p> : null;
  return (
    <div className="kd-mark" data-verdict={mark.verdict}>
      <p className="kd-mark-v">
        <span className="kd-mark-pill">{KINDS.verdicts[mark.verdict]}</span> {KINDS.verdictLine[mark.verdict]}
        <span className="kd-mark-src"> · {mark.source === 'ai' ? KINDS.byCheck : KINDS.byAuthor}</span>
      </p>
      {mark.quote ? (
        <blockquote className="kd-quote">
          <span className="kd-quote-lead">{KINDS.quoteLead}</span> <QText text={mark.quote} />
        </blockquote>
      ) : null}
    </div>
  );
}

/** A number's answer and key under the field: «Верный ответ — 9,8 ± 0,1 м/с²». */
export function NumberKeyLine({ answers, tolerance, unit }: { answers: string[]; tolerance?: number | string | null; unit?: string | null }) {
  if (answers.length === 0) return null;
  return (
    <p className="kd-keyline">
      {KINDS.right} — <b>{KINDS.numberRight(answers, tolerance, unit)}</b>
    </p>
  );
}

/** The right arrangement of an order question in words (a session's review, the author's view). */
export function OrderKeyLine({ items, keyOrder }: { items: string[]; keyOrder: number[] }) {
  return (
    <div className="kd-keyline">
      <p className="kd-keyline-h">{KINDS.rightOrder}</p>
      <ol className="kd-keylist">
        {keyOrder.map((index) => (
          <li key={index}>
            <QText text={items[index] ?? ''} />
          </li>
        ))}
      </ol>
    </div>
  );
}
