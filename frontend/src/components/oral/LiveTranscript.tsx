import { useLayoutEffect, useRef, useState } from 'react';
import { PencilUnder } from '../marks';
import { markedRuns } from '../../lib/oral/rubricMatch';

/** Within this distance of the bottom the window still counts as «at the newest line». */
export const FOLLOW_SLACK_PX = 32;

interface LiveTranscriptProps {
  /** «Ваш ответ, 0:18» */
  label: string;
  finalText: string;
  interimText: string;
  /** Indexes into words(finalText) that opened a point: underlined in pencil. */
  underlined: ReadonlySet<number>;
  seed: number;
  /** Said when nothing has been recognised yet. */
  emptyText?: string;
  className?: string;
  /**
   * Draw a new underline in (250 ms) when a point gets named. Lines already there when the
   * transcript first appears (a restored answer) are simply there; reduced motion shows them at once.
   */
  drawNew?: boolean;
}

/**
 * What was said, on the answer sheet (redesign spec 5.11): the last three lines, older ones fading
 * out at the top. Final words in ink, the words still being recognised in the muted paper colour
 * (no fake italic). Only final words are underlined — interim words may still change. The text is
 * aria-live off: the rubric rows announce what matters.
 *
 * Below 1024 px the window is a scrolling box (oral.css): it stays on the newest line as words
 * arrive, unless the student has scrolled up to reread — then it stays where they are until they
 * scroll back down.
 */
export default function LiveTranscript({ label, finalText, interimText, underlined, seed, emptyText, className = '', drawNew = false }: LiveTranscriptProps) {
  const windowRef = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLParagraphElement>(null);
  const followRef = useRef(true);
  const [overflow, setOverflow] = useState(false);
  /** Underlines present on the first render: drawn still. */
  const stillRef = useRef<Set<string> | null>(null);

  useLayoutEffect(() => {
    const frame = windowRef.current;
    const text = textRef.current;
    if (!frame || !text) return;
    // Top overflow of a flex-end column is not in scrollHeight: compare the text with its window.
    const next = text.offsetHeight > frame.clientHeight + 1;
    setOverflow((previous) => (previous === next ? previous : next));
    // A scrolling window (phone, tablet) follows the new words; on a desktop there is nothing to scroll.
    if (followRef.current && frame.scrollHeight > frame.clientHeight) frame.scrollTop = frame.scrollHeight;
  }, [finalText, interimText]);

  const onScroll = () => {
    const frame = windowRef.current;
    if (!frame) return;
    followRef.current = frame.scrollHeight - frame.scrollTop - frame.clientHeight <= FOLLOW_SLACK_PX;
  };

  // Keys by text offset: the final text only grows, so a line keeps its key (and its shape) as words arrive.
  let offset = 0;
  const runs = (finalText ? markedRuns(finalText, underlined) : []).map((run) => {
    const at = offset;
    offset += run.text.length;
    return { ...run, at, key: `${run.marked ? 'u' : 't'}${at}` };
  });
  if (stillRef.current === null) stillRef.current = new Set(runs.filter((run) => run.marked).map((run) => run.key));
  const still = stillRef.current;
  const empty = !finalText && !interimText;
  return (
    <div className={`or-said ${className}`.trim()}>
      <p className="or-said-label">{label}</p>
      <div ref={windowRef} className="or-said-window" data-overflow={overflow ? '' : undefined} aria-live="off" onScroll={onScroll}>
        <p ref={textRef} className="or-said-text">
          {empty && emptyText ? <span className="or-said-empty">{emptyText}</span> : null}
          {runs.map((run) =>
            run.marked ? (
              <PencilUnder key={run.key} seed={seed + run.at * 7} animate={drawNew && !still.has(run.key)}>
                {run.text}
              </PencilUnder>
            ) : (
              <span key={run.key}>{run.text}</span>
            ),
          )}
          {interimText ? (
            <>
              {finalText ? ' ' : null}
              <span className="or-interim">{interimText}</span>
            </>
          ) : null}
        </p>
      </div>
    </div>
  );
}
