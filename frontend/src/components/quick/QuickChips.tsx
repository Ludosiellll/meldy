import PaperSelect from '../ui/PaperSelect';
import { QUICK } from './copyQuick';
import { QUICK_ATTEMPTS, QUICK_DAYS, QUICK_MINUTES, QUICK_REVIEWS, type QuickReview, type QuickSettings, type QuickWho } from './quickModel';

/** A list that allows «нет»: PaperSelect takes numbers, so null is 0. */
const nz = (value: number | null) => value ?? 0;
const zn = (value: number) => (value === 0 ? null : value);

/**
 * The few settings of «Быстрая контрольная» as pills, each a short list: who writes (without signing in by default),
 * the time, how long it stays open, the attempts, when the right answers show. The rest is in the full form, behind
 * «Ещё настройки».
 */
export default function QuickChips({
  value,
  onChange,
  disabled = false,
}: {
  value: QuickSettings;
  onChange: (next: QuickSettings) => void;
  disabled?: boolean;
}) {
  const set = <K extends keyof QuickSettings>(key: K, next: QuickSettings[K]) => onChange({ ...value, [key]: next });
  return (
    <div className="qk-chips" role="group" aria-label={QUICK.settings}>
      <PaperSelect<QuickWho>
        className="qk-chip"
        ariaLabel={QUICK.who.label}
        value={value.who}
        disabled={disabled}
        options={[
          { value: 'guests', label: QUICK.who.guests },
          { value: 'link', label: QUICK.who.link },
        ]}
        onChange={(next) => set('who', next)}
      />
      <PaperSelect<number>
        className="qk-chip"
        ariaLabel={QUICK.time.label}
        value={nz(value.minutes)}
        disabled={disabled}
        options={QUICK_MINUTES.map((minutes) => ({ value: nz(minutes), label: minutes === null ? QUICK.time.none : QUICK.time.some(minutes) }))}
        onChange={(next) => set('minutes', zn(next))}
      />
      <PaperSelect<number>
        className="qk-chip"
        ariaLabel={QUICK.open.label}
        value={nz(value.days)}
        disabled={disabled}
        options={QUICK_DAYS.map((days) => ({ value: nz(days), label: days === null ? QUICK.open.never : QUICK.open.days(days) }))}
        onChange={(next) => set('days', zn(next))}
      />
      <PaperSelect<number>
        className="qk-chip"
        ariaLabel={QUICK.tries.label}
        value={nz(value.attempts)}
        disabled={disabled}
        options={QUICK_ATTEMPTS.map((tries) => ({ value: nz(tries), label: tries === null ? QUICK.tries.any : QUICK.tries.some(tries) }))}
        onChange={(next) => set('attempts', zn(next))}
      />
      <PaperSelect<QuickReview>
        className="qk-chip"
        ariaLabel={QUICK.review.label}
        value={value.review}
        disabled={disabled}
        options={QUICK_REVIEWS.map((review) => ({ value: review, label: review === 'answers' ? QUICK.review.now : QUICK.review.later }))}
        onChange={(next) => set('review', next)}
      />
    </div>
  );
}
