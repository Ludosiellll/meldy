import { Fragment } from 'react';
import type { SelfRating as Rating } from '../../api/learning';
import { SELF_RATING_LABELS } from '../../lib/learning/readiness';
import { seedFrom, TextMark } from '../marks';

export const SELF_RATING_ORDER: Rating[] = ['know', 'unsure', 'dont_know'];

interface SelfRatingProps {
  value: Rating | null;
  onChange: (rating: Rating) => void;
  /** «вопрос 17»: names the group for screen readers. */
  questionLabel: string;
  /** Seeds the graphite line under the chosen word. */
  seedKey: string;
  pending?: boolean;
  error?: string | null;
}

/**
 * «знаю · плаваю · не знаю»: the student's own one-tap estimate of a question (self-rating mode of
 * the sheet). The chosen word is underlined in graphite, the student's hand. It is stored in the
 * journal as a self-rating, never counts as an answer and never moves the pencil marks; a rating
 * can be changed but not removed (the journal only grows).
 */
export default function SelfRating({ value, onChange, questionLabel, seedKey, pending = false, error = null }: SelfRatingProps) {
  return (
    <span className="ex-rate" role="group" aria-label={`Самооценка, ${questionLabel}`}>
      {SELF_RATING_ORDER.map((rating, index) => {
        const active = value === rating;
        const word = SELF_RATING_LABELS[rating];
        return (
          <Fragment key={rating}>
            {index > 0 && (
              <span className="ex-dot" aria-hidden="true">
                ·
              </span>
            )}
            <button
              type="button"
              aria-pressed={active}
              disabled={pending}
              onClick={() => {
                if (!active) onChange(rating);
              }}
            >
              {active ? (
                <TextMark kind="under" seed={seedFrom(seedKey, rating)} hand="graphite" weight={2}>
                  {word}
                </TextMark>
              ) : (
                word
              )}
            </button>
          </Fragment>
        );
      })}
      {error && (
        <span className="ex-rate-error" role="alert">
          {error}
        </span>
      )}
    </span>
  );
}
