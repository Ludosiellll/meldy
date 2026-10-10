import type { ReactNode, RefObject } from 'react';
import { Mark } from './ui';

/**
 * Today's step first (decision 46): a white status card, as on today's oral exam page — the title with the screen's one
 * yellow line («Сегодня 90 вопросов, около 45 минут»), one muted line («30 новых и 60 знакомых. План по дням»), the
 * plan's own lines (a skipped day, the final days, the minutes that fall short) and, on a computer, the one blue pill
 * on the card's right. A phone and a tablet carry the pill in the bar at the bottom.
 */
export interface PlanCardProps {
  id: string;
  title: ReactNode;
  sub?: ReactNode;
  links?: ReactNode;
  notes?: ReactNode[];
  action?: ReactNode;
  /**
   * A first-use tip about today's plan (the exam page's Telegram tip, components/telegram/ExamTelegramTip): the card is
   * its anchor (`anchor`, ringed while the tip is shown), and the tip comes right after it, so Tab goes from the card's
   * controls to the tip.
   */
  tip?: PlanTip | null;
}

export interface PlanTip {
  anchor: RefObject<HTMLElement>;
  card: ReactNode;
}

export default function PlanCard({ id, title, sub, links, notes = [], action, tip }: PlanCardProps) {
  const shown = notes.filter(Boolean);
  return (
    <>
      {/* With a tip the card can take the focus back from it («Не сейчас», Escape): it is what the tip was about. */}
      <section
        ref={tip?.anchor}
        className="ct-plan"
        aria-labelledby={`${id}-t`}
        data-quiet={action ? undefined : ''}
        tabIndex={tip ? -1 : undefined}
      >
        <div className="ct-plan-body">
          <h2 className="ct-plan-t" id={`${id}-t`} tabIndex={-1}>
            {title}
          </h2>
          {sub ? <p className="ct-plan-sub">{sub}</p> : null}
          {links ? <p className="ct-plan-links">{links}</p> : null}
          {shown.length > 0 ? <div className="ct-plan-notes">{shown}</div> : null}
        </div>
        {action ? <div className="ct-plan-act">{action}</div> : null}
      </section>
      {tip?.card ?? null}
    </>
  );
}

/** The words that carry the yellow line: today's number of questions («90 вопросов»). */
const MARKED = /\d+[\u00a0 ]вопрос(?:а|ов)?/;

/** «Сегодня 90 вопросов, около 45 минут» (the plan's words, lib/containers/words.ts planTitle) with the yellow line under «90 вопросов». */
export function PlanTitle({ text }: { text: string }) {
  const match = MARKED.exec(text);
  if (!match) return <>{text}</>;
  return (
    <>
      {text.slice(0, match.index)}
      <Mark>{match[0]}</Mark>
      {text.slice(match.index + match[0].length)}
    </>
  );
}
