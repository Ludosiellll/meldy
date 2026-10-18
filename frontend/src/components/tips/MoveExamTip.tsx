import { useEffect, useId, useRef } from 'react';
import { useLazyPart } from '../../lib/lazyPart';
import { stepClipPart } from '../clips/clipPart';
import StepClipPlaceholder from '../clips/Placeholder';
import { TIPS } from './tips';
import { tipSeenHere, useFirstUseTip } from './useFirstUseTip';
import './moveExamTip.css';

const onExample = () => typeof window !== 'undefined' && /^\/try(\/|$)/.test(window.location.pathname);

/**
 * The move dialog's first-use tip (tips.ts `move`): the first time «Перенести экзамен» opens, a compact card at the top
 * of its form — the clip of a move (components/clips «move»: the exam's day, the dialog, «Экзамен перенесён на 25
 * октября.» and the plan made again) beside «План пересчитается сам», and «Не сейчас». It never takes the focus (the
 * dialog's first choice keeps it). Once (useFirstUseTip): «Не сейчас» or a move sent from the dialog put it away for
 * good, and so do two visits that only showed it. While the profile is being read its room is kept, so the choices
 * under it never jump; never on the example (/try).
 */
export default function MoveExamTip() {
  const box = useRef<HTMLElement>(null);
  const titleId = useId();
  const tip = useFirstUseTip('move', { enabled: !onExample(), settle: 0 });
  const held = tip.pending && !tipSeenHere('move');
  const visible = tip.show || held;
  const Clip = useLazyPart(stepClipPart, visible, {
    onError: (error) => console.error('Ролик подсказки не загрузился:', error),
  });

  // A move sent from this dialog: the tip did its job.
  const { show, done } = tip;
  useEffect(() => {
    const form = box.current?.closest('form');
    if (!show || !form) return undefined;
    const sent = () => done();
    form.addEventListener('submit', sent);
    return () => form.removeEventListener('submit', sent);
  }, [show, done]);

  if (!visible) return null;
  const later = () => {
    // The focus goes to the dialog's choices, not to the page under it.
    const first = box.current?.closest('form')?.querySelector<HTMLElement>('input:checked, input');
    tip.dismiss();
    first?.focus({ preventScroll: true });
  };
  return (
    <section ref={box} className="mvt" aria-labelledby={titleId}>
      {Clip ? <Clip id="move" active={tip.show} compact /> : <StepClipPlaceholder compact />}
      <div className="mvt-words">
        <h3 id={titleId} className="mvt-t">
          {TIPS.move.title}
        </h3>
        <p className="mvt-p">{TIPS.move.text}</p>
        <button type="button" className="sf-link mvt-later" data-muted="" onClick={later}>
          {TIPS.move.later}
        </button>
      </div>
    </section>
  );
}
