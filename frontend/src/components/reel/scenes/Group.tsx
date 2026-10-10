import { useRef } from 'react';
import { BOT, GROUP_MEMBERS, GROUP_WORDS } from '../content';
import { blur, opacity, put, text, useEls, useFrame } from '../engine';
import { Cursor, Kinetic, TypeLabel } from '../parts';
import { clamp, ease, mix, pulse, seg } from '../timeline';
import { TgDate, TgMessage, TgPhone, TgToast } from './telegram/TgPhone';

/** «Скопировать» is pressed; the group comes in by the link. */
export const COPY_AT = 1500;
const JOIN_AT = 1850;
const JOIN_MS = 1400;
/** The bot: the phone comes in, the plan arrives at 20:00, «Начать», a question, a right answer. */
const PHONE_AT = 3300;
export const PLAN_MSG_AT = 4100;
export const START_TAP = 5300;
const QUESTION_AT = 5600;
export const OPTION_TAP = 6700;
const LEAVE = 7400;

export const GROUP_CURSOR = [
  { at: 900, x: 1990, y: 1150 },
  { at: COPY_AT - 380, x: 1615, y: 478 },
  { at: COPY_AT + 400, x: 1636, y: 496 },
];

/** The members in the exam at `l`: the link is out, they come in one after another. */
export function membersAt(l: number): number {
  return Math.round(GROUP_MEMBERS * ease.inOut(seg(l, JOIN_AT, JOIN_MS)));
}

const FACES = [
  { letter: 'А', tone: 'blue' },
  { letter: 'М', tone: 'yellow' },
  { letter: 'К', tone: 'green' },
  { letter: 'Д', tone: 'pink' },
  { letter: 'Е', tone: 'grey' },
  { letter: 'С', tone: 'blue' },
  { letter: 'И', tone: 'green' },
  { letter: 'Т', tone: 'yellow' },
] as const;
/** When each face comes in (the count's own pace), and the «+16» after them. */
const FACE_AT = FACES.map((_, index) => JOIN_AT + 60 + index * 130);

/**
 * 9 · Chapter 05, «Группа». «Пригласить группу»: one link for the whole group, «Скопировать», and the group comes in —
 * «В экзамене 24 участника», each with an exam of their own. Then the bot in Telegram: at 20:00 the plan of the day,
 * «Начать: 20 вопросов», a question with its options as buttons, and a right answer that moves the figure.
 */
export default function Group() {
  const root = useRef<HTMLDivElement>(null);
  const heights = useRef<{ plan: number; q: number } | null>(null);
  const { one, all } = useEls(root);

  useFrame((l) => {
    opacity(root.current, seg(l, 60, 260));
    const cam = one('cam');
    const enter = ease.brand(seg(l, 0, 440));
    const push = mix(1, 1.025, ease.sine(seg(l, 400, 7000)));
    const leave = ease.in(seg(l, LEAVE, 400));
    put(cam, 'transform', `scale(${(mix(1.1, 1, enter) * push * mix(1, 1.06, leave)).toFixed(4)})`);
    blur(cam, (1 - enter) * 12 + leave * 10);
    opacity(cam, seg(l, 0, 260));

    // The two lines on the left: the link, then the bot.
    const swap = ease.inOut(seg(l, PHONE_AT + 100, 420));
    const left = one('left-a');
    put(left, 'transform', `translate3d(0,${(-30 * swap).toFixed(1)}px,0)`);
    blur(left, swap * 14);
    opacity(left, 1 - swap);

    // «Пригласить группу» swings in, the link is copied, the group comes in; then it gives way to the phone.
    const card = one('card');
    const swing = (at: number) => ease.brand(seg(at, 150, 1000));
    const p = swing(l);
    const speed = Math.abs(p - swing(l - 16)) * 520;
    const away = ease.in(seg(l, PHONE_AT, 460));
    put(
      card,
      'transform',
      `translate3d(${(mix(560, 0, p) - 260 * away).toFixed(1)}px,${mix(50, 0, p).toFixed(1)}px,0) rotateY(${(mix(-44, -8, p) - 10 * away).toFixed(2)}deg) rotateX(${mix(9, 2.5, p).toFixed(2)}deg)`,
    );
    opacity(card, seg(l, 150, 220) * (1 - away));
    blur(card, Math.min(12, speed * 0.5) + away * 14);

    const copied = seg(l, COPY_AT + 40, 200);
    opacity(one('copy'), 1 - copied);
    opacity(one('copied'), copied);
    put(one('copy-btn'), 'transform', `scale(${(1 - 0.05 * pulse(l, COPY_AT - 60, 260)).toFixed(3)})`);

    const members = membersAt(l);
    text(one('members'), GROUP_WORDS.inExam(Math.max(members, 0)));
    opacity(one('members-line'), seg(l, JOIN_AT - 200, 260));
    all('face').forEach((face, index) => {
      const q = seg(l, FACE_AT[index], 380);
      put(face, 'transform', `scale(${(q <= 0 ? 0.4 : ease.back(q)).toFixed(3)})`);
      opacity(face, clamp(q * 3));
    });
    const more = seg(l, FACE_AT[FACE_AT.length - 1] + 200, 380);
    put(one('more'), 'transform', `scale(${(more <= 0 ? 0.4 : ease.back(more)).toFixed(3)})`);
    opacity(one('more'), clamp(more * 3));

    // The phone comes in from the right.
    const phone = one('phone');
    const inP = ease.brand(seg(l, PHONE_AT + 120, 900));
    put(phone, 'transform', `translate3d(${mix(620, 0, inP).toFixed(1)}px,${mix(30, 0, inP).toFixed(1)}px,0) rotateY(${mix(-28, -4, inP).toFixed(2)}deg)`);
    opacity(phone, seg(l, PHONE_AT + 120, 200));
    blur(phone, (1 - inP) * 10);

    // The chat: the plan at 20:00; «Начать»; the question comes and the chat moves up by its height.
    const planMsg = one('plan-msg');
    const arrive = ease.brand(seg(l, PLAN_MSG_AT, 420));
    put(planMsg, 'transform', `scale(${mix(0.94, 1, arrive).toFixed(3)})`);
    opacity(planMsg, seg(l, PLAN_MSG_AT, 160));
    const qMsg = one('q-msg');
    // The heights are read once: reading them on every frame, after this frame's writes, would lay the page out again.
    if (!heights.current && planMsg && qMsg) heights.current = { plan: planMsg.offsetHeight + 10, q: qMsg.offsetHeight + 10 };
    const { plan: planHeight, q: qHeight } = heights.current ?? { plan: 0, q: 0 };
    const qIn = ease.brand(seg(l, QUESTION_AT, 480));
    // A message comes in at the bottom and moves the chat up, as Telegram does.
    put(one('chat'), 'transform', `translate3d(0,${((1 - arrive) * planHeight + (1 - qIn) * qHeight).toFixed(1)}px,0)`);
    opacity(qMsg, seg(l, QUESTION_AT + 40, 180));

    for (const [name, at] of [
      ['start', START_TAP],
      ['opt', OPTION_TAP],
    ] as const) {
      const key = one(name);
      put(key, 'transform', `scale(${(1 - 0.04 * pulse(l, at - 40, 260)).toFixed(3)})`);
      const touch = one(`${name}-touch`);
      const t = seg(l, at - 80, 520);
      opacity(touch, t > 0 && t < 1 ? Math.sin(Math.PI * t) * 0.9 : 0);
      put(touch, 'transform', `scale(${mix(0.5, 1.15, ease.out(t)).toFixed(3)})`);
    }

    const toast = one('toast');
    const showToast = seg(l, OPTION_TAP + 80, 140);
    put(toast, 'transform', `translate3d(-50%,${mix(-10, 0, ease.brand(showToast)).toFixed(1)}px,0)`);
    opacity(toast, showToast);
  });

  return (
    <div ref={root} className="mr-scene mr-bg-light">
      <div data-a="cam" className="mr-layer">
        <div className="mr-abs" style={{ left: 154, top: 236 }}>
          <TypeLabel text="Группа" at={240} />
        </div>
        <div data-a="left-a" className="mr-g-left">
          <p className="mr-display mr-g-head">
            <Kinetic text={GROUP_WORDS.head[0]} at={380} stagger={110} dur={760} />
            <br />
            <Kinetic text={GROUP_WORDS.head[1]} at={600} stagger={110} dur={760} accentFrom={0} />
          </p>
          <p className="mr-g-note">
            <Kinetic text={GROUP_WORDS.note} at={1100} stagger={90} />
          </p>
        </div>
        <div className="mr-g-left">
          <p className="mr-display mr-g-head">
            <Kinetic text={GROUP_WORDS.botHead[0]} at={PHONE_AT + 380} stagger={110} dur={760} />
            <br />
            <Kinetic text={GROUP_WORDS.botHead[1]} at={PHONE_AT + 600} stagger={110} dur={760} accentFrom={0} />
          </p>
          <p className="mr-g-note">
            <Kinetic text={GROUP_WORDS.botNote} at={PHONE_AT + 1000} stagger={80} />
          </p>
        </div>

        <div className="mr-persp">
          <div data-a="card" className="mr-card mr-g-card" style={{ opacity: 0 }}>
            <div className="mr-g-card-h">
              <b>{GROUP_WORDS.title}</b>
              <svg viewBox="0 0 20 20" aria-hidden="true">
                <path d="M5 5l10 10M15 5L5 15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              </svg>
            </div>
            <p className="mr-g-lede">{GROUP_WORDS.lede}</p>
            <p className="mr-g-label">{GROUP_WORDS.linkLabel}</p>
            <div className="mr-g-row">
              <span className="mr-g-field">{GROUP_WORDS.link}</span>
              <span data-a="copy-btn" className="mr-g-copy">
                <span data-a="copy">{GROUP_WORDS.copy}</span>
                <span data-a="copied" className="mr-g-copied" style={{ opacity: 0 }}>
                  {GROUP_WORDS.copied}
                </span>
              </span>
            </div>
            <p className="mr-g-label">{GROUP_WORDS.textLabel}</p>
            <p className="mr-g-text">{GROUP_WORDS.message}</p>
            <div data-a="members-line" className="mr-g-members" style={{ opacity: 0 }}>
              <span className="mr-g-faces">
                {FACES.map((face, index) => (
                  <i key={index} data-a="face" className={`mr-g-face mr-g-face--${face.tone}`} style={{ opacity: 0 }}>
                    {face.letter}
                  </i>
                ))}
                <i data-a="more" className="mr-g-face mr-g-face--more" style={{ opacity: 0 }}>
                  +{GROUP_MEMBERS - FACES.length}
                </i>
              </span>
              <span className="mr-g-count">
                <b data-a="members">{GROUP_WORDS.inExam(0)}</b>
                <span className="mr-g-who">{GROUP_WORDS.who}</span>
              </span>
            </div>
          </div>

          <div data-a="phone" className="mr-g-phone" style={{ opacity: 0 }}>
            <TgPhone time={BOT.time} name={BOT.name} status={BOT.status}>
              <div data-a="chat" className="mr-tg-col">
                <TgDate>Сегодня</TgDate>
                <TgMessage
                  a="plan-msg"
                  time={BOT.time}
                  keyboard={[[{ text: BOT.start, primary: true, a: 'start' }], [{ text: BOT.oral, url: true }]]}
                >
                  <b>{BOT.plan}</b>
                  {'\n'}
                  {BOT.exam}
                  {'\n'}
                  {BOT.figure}
                </TgMessage>
                <TgMessage
                  a="q-msg"
                  time={BOT.time}
                  keyboard={[
                    ...BOT.question.options.map((option, index) => [{ text: option, a: index === BOT.question.key ? 'opt' : undefined }]),
                    [{ text: BOT.question.dontKnow }, { text: BOT.question.finish }],
                  ]}
                >
                  {BOT.question.header}
                  {'\n\n'}
                  <b>{BOT.question.stem}</b>
                </TgMessage>
              </div>
              <TgToast a="toast">{BOT.toast}</TgToast>
            </TgPhone>
          </div>
        </div>
        <Cursor keys={GROUP_CURSOR} clicks={[COPY_AT]} from={900} to={COPY_AT + 500} />
      </div>
    </div>
  );
}
