import './marks.css';
import { HAND_DATES, type HandPhrase } from '../landing/handDates';

/**
 * The pencil writes letters only for four phrases of the landing, and only when the phrase is true
 * (redesign spec 3.8, rule 2): «завтра» for 1 day, «через 6 дней» for 6, «через 2 недели» for 13–16,
 * «через 6 недель» for 40–45. Any other interval is typed as a note («через 9 дней»).
 */
export function handPhraseFor(days: number): HandPhrase | null {
  if (!Number.isFinite(days)) return null;
  if (days === 1) return HAND_DATES[0];
  if (days === 6) return HAND_DATES[1];
  if (days >= 13 && days <= 16) return HAND_DATES[2];
  if (days >= 40 && days <= 45) return HAND_DATES[3];
  return null;
}

interface HandPhraseMarkProps {
  phrase: HandPhrase;
  /** Height of the letters (the phrase's font size), 26–28 px on a card. */
  px?: number;
  className?: string;
}

/** A handwritten phrase in the landing's hand, blue pencil, aria-hidden (say it next to it in words). */
export function HandPhraseMark({ phrase, px = 26, className = '' }: HandPhraseMarkProps) {
  const scale = px / 100;
  const pad = 3;
  const width = (phrase.bbox.x2 - phrase.bbox.x) * scale + pad * 2;
  const height = (phrase.bbox.y2 - phrase.bbox.y) * scale + pad * 2;
  return (
    <svg
      className={`sf-hand ${className}`.trim()}
      width={width.toFixed(1)}
      height={height.toFixed(1)}
      aria-hidden="true"
      focusable="false"
    >
      <g transform={`translate(${(pad - phrase.bbox.x * scale).toFixed(2)} ${(pad - phrase.bbox.y * scale).toFixed(2)}) scale(${scale})`}>
        {phrase.paths.map((d, index) => (
          <path key={index} d={d} strokeWidth={(1.6 / scale).toFixed(2)} />
        ))}
      </g>
    </svg>
  );
}
