/**
 * The sign-in reel, «Как работает Meldy», in the film style (components/film): the student's exam is where they left
 * it — today's plan on «Сегодня»; then a question of the session, an oral answer that closes a topic of «Осталось
 * выучить» (StoryScenes), the group's one link with the plan of the day in Telegram, and «Продолжите с того же места».
 * The yellow dot opens the loop and closes it.
 */
import { useRef } from 'react';
import { opacity, place, put, useEls, useFrame } from '../reel/engine';
import { clamp, ease, mix, seg } from '../reel/timeline';
import { Arrow, Statement, focusIn, pressDepth, slideIn } from '../film/kit';
import { EXAM_TITLE, FIGURE, INVITE_WORDS, START_LABEL, TELEGRAM_WORDS, exampleWords } from '../../data/containerExample';
import { HOME, Ready } from './Ready';
import { LOGIN_SCRIPT, leaveOf } from './script';
import { Oral, REEL_TODAY, Session, withLeave } from './StoryScenes';
import { shot } from './camera';

const WORDS = exampleWords(REEL_TODAY);

// ---------------------------------------------------------------------------------------------
// 1 · «960 вопросов. Один план.» — the dot opens on «Сегодня»: the exam's card with today's step, the blue pill and
// the figure; it moves aside for the words, turning away.

const TODAY_LEAVE = leaveOf(LOGIN_SCRIPT, 'today');

function Today() {
  const root = useRef<HTMLDivElement>(null);
  const { one } = useEls(root);
  useFrame((l) => {
    // The dot of the last loop dissolves as the card comes into focus around it.
    place(one('home'), HOME.x - HOME.size / 2, HOME.y - HOME.size / 2, 1 - ease.in(seg(l, 300, 380)));
    opacity(one('home'), 1 - seg(l, 600, 120));

    const aside = ease.inOut(seg(l, 1650, 800));
    const out = ease.in(seg(l, TODAY_LEAVE, 520));
    const card = one('card');
    put(
      card,
      'transform',
      `perspective(2600px) translate3d(${(mix(0, 440, aside) - 1100 * out).toFixed(1)}px,${mix(0, 16, aside).toFixed(1)}px,0) rotateY(${mix(0, -16, aside).toFixed(2)}deg) scale(${mix(1, 0.84, aside).toFixed(4)})`,
    );
    put(card, 'filter', `blur(${(16 * (1 - ease.out(seg(l, 250, 800))) + 18 * out).toFixed(2)}px)`);
    opacity(card, clamp(seg(l, 250, 300) * 3) * (1 - clamp((out - 0.5) / 0.5)));
    put(one('pill'), 'transform', `scale(${(1 - 0.05 * pressDepth(l, 3000)).toFixed(4)})`);
  });
  return (
    <div ref={root} className="mr-scene">
      <div data-a="card" className="fm-card ar-today" style={{ opacity: 0 }}>
        <span className="fm-flag fm-flag--line ar-today-flag">{WORDS.flag}</span>
        <p className="fm-h1 ar-today-h">{EXAM_TITLE}</p>
        <p className="ar-today-meta">{WORDS.todayMeta}</p>
        <p className="ar-today-line">{`${WORDS.planTitle}.`}</p>
        <span data-a="pill" className="fm-btn fm-btn--blue ar-today-pill">
          {START_LABEL}
          <i>
            <Arrow />
          </i>
        </span>
        <p className="ar-today-fig">
          <b>{FIGURE.big}</b>
          <span>{`${FIGURE.of} ${FIGURE.label}`}</span>
        </p>
      </div>
      <i data-a="home" className="fm-brand-dot ar-home" style={{ transform: `translate3d(${HOME.x - HOME.size / 2}px,${HOME.y - HOME.size / 2}px,0)` }} />
      <Statement lines={['960 вопросов', 'в одном плане.']} at={1900} out={TODAY_LEAVE} className="ar-say" />
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// 4 · «Вся группа — по одной ссылке.» — «Пригласить группу»: the link is copied, the text for the group's chat is
// there; the plan of the day in Telegram comes up beside it.

/** An example link of the group (the real one is made for each exam and stays on the author's device). */
export const GROUP_URL = 'ludosiel-studyforge.hf.space/g/k7Qm2xZp9tWa';
const COPIED = 1350;

function Group({ leave }: { leave: number }) {
  const root = useRef<HTMLDivElement>(null);
  const { one } = useEls(root);
  useFrame((l) => {
    shot(one('invite'), l, leave);
    put(one('copy'), 'transform', `scale(${(1 - 0.06 * pressDepth(l, COPIED - 80)).toFixed(4)})`);
    opacity(one('copyA'), 1 - seg(l, COPIED, 140));
    opacity(one('copyB'), seg(l, COPIED + 60, 180));
    focusIn(one('msg'), l, 900, 600, 10);
    slideIn(one('tg'), l, 1900, { dy: 90, dur: 680, smear: 12 });
  });
  return (
    <div ref={root} className="mr-scene">
      <div data-a="invite" className="ar-invite" style={{ opacity: 0 }}>
        <div className="fm-card ar-invite-card">
          <p className="fm-h1 ar-invite-h">{INVITE_WORDS.title}</p>
          <p className="ar-invite-lede">{INVITE_WORDS.lede}</p>
          <p className="ar-invite-label">{INVITE_WORDS.linkLabel}</p>
          <div className="ar-invite-row">
            <span className="ar-invite-field">{GROUP_URL}</span>
            <span data-a="copy" className="fm-btn fm-btn--ink ar-invite-copy">
              <span data-a="copyA">{INVITE_WORDS.copy}</span>
              <span data-a="copyB" className="ar-invite-copied" style={{ opacity: 0 }}>
                {INVITE_WORDS.copied}
              </span>
            </span>
          </div>
          <p className="ar-invite-label">{INVITE_WORDS.textLabel}</p>
          <p data-a="msg" className="ar-invite-msg" style={{ opacity: 0 }}>
            {INVITE_WORDS.message(`https://${GROUP_URL}`)}
          </p>
        </div>
        <div data-a="tg" className="fm-card ar-tg" style={{ opacity: 0 }}>
          <b>{TELEGRAM_WORDS.title}</b>
          <span>{TELEGRAM_WORDS.about}</span>
        </div>
      </div>
      <Statement lines={['Одна ссылка', 'на всю группу.']} at={350} out={leave} className="ar-say" />
    </div>
  );
}

function LoginReady() {
  return <Ready lines={['Продолжите', 'с того же места']} />;
}

export const LOGIN_SCENES = {
  today: Today,
  session: withLeave(Session, leaveOf(LOGIN_SCRIPT, 'session')),
  oral: withLeave(Oral, leaveOf(LOGIN_SCRIPT, 'oral')),
  group: withLeave(Group, leaveOf(LOGIN_SCRIPT, 'group')),
  ready: LoginReady,
};
