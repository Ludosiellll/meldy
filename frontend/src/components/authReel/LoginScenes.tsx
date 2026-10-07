/**
 * The sign-in reel, «Как работает Meldy», in the film style (components/film): the student's cheat
 * sheet is where they left it; then the four steps of the landing — the department's questions with
 * quotes from the lectures, the ticket aloud with the examiner's follow-up, and the sheet that only
 * answers erase (StoryScenes). The yellow dot opens the loop and closes it.
 */
import { useRef } from 'react';
import { opacity, place, put, useEls, useFrame } from '../reel/engine';
import { clamp, ease, mix, seg } from '../reel/timeline';
import { Statement } from '../film/kit';
import { HOME, Ready } from './Ready';
import { LOGIN_SCRIPT, leaveOf } from './script';
import { Answers, Erase, Q6, SHEET_W, SheetCard, Ticket, q7, withLeave } from './StoryScenes';

// ---------------------------------------------------------------------------------------------
// 1 · «Шпаргалка на месте.» — the dot opens on the sheet as it was left: question 6 all but erased,
// question 7 with the line named the day before rubbed half-way.

const BACK_LEAVE = leaveOf(LOGIN_SCRIPT, 'back');
const BACK_QUESTIONS = [Q6, q7(null)];
const BACK_DATES = [{ at: -1, text: '7 окт.' }];

function Back() {
  const root = useRef<HTMLDivElement>(null);
  const { one } = useEls(root);
  useFrame((l) => {
    // The dot of the last loop dissolves as the sheet comes into focus around it.
    place(one('home'), HOME.x - HOME.size / 2, HOME.y - HOME.size / 2, 1 - ease.in(seg(l, 300, 380)));
    opacity(one('home'), 1 - seg(l, 600, 120));

    // The sheet focuses in where the dot was, then moves aside for the words, turning away.
    const aside = ease.inOut(seg(l, 1650, 800));
    const out = ease.in(seg(l, BACK_LEAVE, 520));
    const card = one('card');
    put(
      card,
      'transform',
      `perspective(2600px) translate3d(${(mix(0, 430, aside) - 1100 * out).toFixed(1)}px,${mix(0, 20, aside).toFixed(1)}px,0) rotateY(${mix(0, -16, aside).toFixed(2)}deg) scale(${mix(1, 0.86, aside).toFixed(4)})`,
    );
    put(card, 'filter', `blur(${(16 * (1 - ease.out(seg(l, 250, 800))) + 18 * out).toFixed(2)}px)`);
    opacity(card, clamp(seg(l, 250, 300) * 3) * (1 - clamp((out - 0.5) / 0.5)));
  });
  return (
    <div ref={root} className="mr-scene">
      <SheetCard name="card" className="ar-back" questions={BACK_QUESTIONS} dates={BACK_DATES} width={SHEET_W} zoom={1.8} />
      <i data-a="home" className="fm-brand-dot ar-home" style={{ transform: `translate3d(${HOME.x - HOME.size / 2}px,${HOME.y - HOME.size / 2}px,0)` }} />
      <Statement lines={['Шпаргалка', 'на месте.']} at={1900} out={BACK_LEAVE} className="ar-say" />
    </div>
  );
}

function LoginReady() {
  return <Ready lines={['Цель —', 'пустая шпаргалка']} />;
}

export const LOGIN_SCENES = {
  back: Back,
  answers: withLeave(Answers, leaveOf(LOGIN_SCRIPT, 'answers')),
  ticket: withLeave(Ticket, leaveOf(LOGIN_SCRIPT, 'ticket')),
  erase: withLeave(Erase, leaveOf(LOGIN_SCRIPT, 'erase')),
  ready: LoginReady,
};
