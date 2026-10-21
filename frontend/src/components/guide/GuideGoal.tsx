import type { RefObject } from 'react';
import { GOAL, GUIDE_START } from '../quick/copyQuick';
import type { Goal } from '../quick/goal';
import './guideGoal.css';

function CloseIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <path d="M5.5 5.5l9 9M14.5 5.5l-9 9" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function ArrowIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <path d="M4 10h11M11 5.5 15.5 10 11 14.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/**
 * The first run's first card (UX audit of 21.10, P4; mockup m5): «Что вы хотите сделать?» with two goals, each a press
 * that starts its short way (firstRun.ts), «Показать все разделы» for the whole guide, and «Пропустить знакомство» and ×
 * to end it (Escape too, GuidePanel). No clip: the card is small on the owner's 1536 × 734 laptop.
 */
export default function GuideGoal({
  panelRef,
  titleId,
  textId,
  phone,
  onChoose,
  onSkip,
}: {
  panelRef: RefObject<HTMLElement>;
  titleId: string;
  textId: string;
  phone: boolean;
  onChoose: (goal: Goal | null) => void;
  onSkip: () => void;
}) {
  const option = (goal: Goal, steps: string) => (
    <li>
      <button type="button" className="gg-option" data-goal={goal} onClick={() => onChoose(goal)}>
        <span className="gg-option-text">
          <span className="gg-option-t">{GOAL[goal].title}</span>
          <span className="gg-option-p">{steps}</span>
        </span>
        <i aria-hidden="true">
          <ArrowIcon />
        </i>
      </button>
    </li>
  );
  return (
    <section ref={panelRef} className="gd gg" role="dialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={textId} data-mandatory="" tabIndex={-1}>
      <div className="gd-top">
        <p className="gd-kick">{GUIDE_START.kicker}</p>
        <button type="button" className="gd-x" onClick={onSkip} aria-label={GUIDE_START.close}>
          <CloseIcon />
        </button>
      </div>
      <h2 id={titleId} className="gd-h gg-h">
        {GUIDE_START.title}
      </h2>
      <p id={textId} className="gd-p">
        {phone ? GUIDE_START.ledePhone : GUIDE_START.lede}
      </p>
      <ul className="gg-options">
        {option('exam', GUIDE_START.examSteps)}
        {option('test', GUIDE_START.testSteps)}
      </ul>
      <div className="gg-foot">
        <button type="button" className="gd-quiet" onClick={onSkip}>
          {GUIDE_START.skip}
        </button>
        <button type="button" className="sf-link gg-all" onClick={() => onChoose(null)}>
          {GUIDE_START.all}
        </button>
      </div>
    </section>
  );
}
