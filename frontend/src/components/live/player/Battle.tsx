/**
 * One question on the phone, from «приготовьтесь» to the place after it: countdown (text and options visible, the
 * buttons wait), open (the buttons take one tap, the time bar runs), the wait after the tap (the order of the own
 * answer, how many answered, the streak), «Время вышло» while the server closes the question, reveal (the key, the own
 * result sheet, the hit or the freeze), leaderboard (the top five, the own place and the gap to the next one). Mounted
 * once per question (keyed by qi).
 *
 * Smoothness (owner's rule): only transform and opacity move — the time bar, the answered bar and the HP bar are scaleX,
 * the countdown digits are CSS animations with delays, the star and the shard are WAAPI transforms. Nothing is measured
 * in a handler: the one read (where the star starts and lands) runs in a timer after the sheet has settled, when layout
 * is clean. The tap sets one snapshot field; the wait's panel comes with the server's ack, a frame or more later; the
 * seconds counter writes a text node, not React state.
 */
import { memo, useCallback, useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react';
import { sharedPlaces, shownPlace } from '../../../lib/live/rules';
import { TeamsMini } from './TeamLine';
import { questionKind, rightKeys, teamsOf, type BossPhase, type Look, type Me, type PlayerResult, type PlayerState, type Question, type QuestionKind, type TopRow } from '../../../lib/live/types';
import { numberAnswer, padReady, typedText } from '../../../lib/live/numbers';
import { NumberPad } from './NumberPad';
import { Shard, Star } from '../art/Fx';
import { LiveBoss, LiveChar, reducedMotion } from './art';
import type { Pick, PlayerController } from './controller';
import { KINDS, NBSP, multText, nb, orderText, seconds } from './copy';
import { OPTION_STYLES, optionLabel, optionSize, questionSize, type OptionShape } from './options';
import type { HapticKind } from './platform';
import { useLivePictures, type ShownPicture } from '../../../lib/live/pictures';

// ─────────────────────────────────────────── pieces ───────────────────────────────────────────

const SHAPES: Record<OptionShape, ReactNode> = {
  triangle: <path d="M11 3L20 19H2Z" />,
  diamond: <path d="M11 1.5L20.5 11L11 20.5L1.5 11Z" />,
  circle: <circle cx="11" cy="11" r="9" />,
  square: <rect x="3" y="3" width="16" height="16" rx="2" />,
  pentagon: <path d="M11 1.5L20.5 8.4L16.9 19.5H5.1L1.5 8.4Z" />,
  hexagon: <path d="M6 2.5H16L21 11L16 19.5H6L1 11Z" />,
};

function Shape({ shape, light }: { shape: OptionShape; light: boolean }) {
  return (
    <svg className="lp-ans__shape" viewBox="0 0 22 22" aria-hidden="true" fill={light ? '#fff' : '#0b121c'}>
      {SHAPES[shape]}
    </svg>
  );
}

const Check = () => (
  <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true">
    <path d="M4 10.5L8.5 15L16.5 6" fill="none" stroke="#0B121C" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);
const Cross = () => (
  <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
    <path d="M4 4L14 14M14 4L4 14" fill="none" stroke="#0B121C" strokeWidth="3" strokeLinecap="round" />
  </svg>
);

type AnsLook = 'idle' | 'chosen' | 'dim';
interface AnswerProps {
  index: number;
  text: string;
  disabled: boolean;
  look: AnsLook;
  mark: 'key' | 'wrong' | null;
  /** A question of several right answers, before «Ответить»: this option is ticked (true) or not (false). */
  tick?: boolean;
  /** The option's picture: a URL, null while it loads, false when it did not come; undefined — none. */
  picture?: ShownPicture;
  onPick: (index: number) => void;
}

const Answer = memo(function Answer({ index, text, disabled, look, mark, tick, picture, onPick }: AnswerProps) {
  const o = OPTION_STYLES[index];
  const status = mark === 'key' ? ', верный ответ' : mark === 'wrong' ? ', ваш ответ, неверный' : look === 'chosen' ? ', ваш ответ' : tick ? ', отмечен' : '';
  // aria-disabled, not disabled: disabling the button the finger is on makes the browser move focus (a forced style
  // and layout) and React put it back (another) — 10–25 ms at ×4 CPU on the tap. A tap that does not count is ignored.
  return (
    <button
      type="button"
      className={`lp-ans lp-ans--${index}`}
      data-size={optionSize(text)}
      data-look={look}
      data-mark={mark ?? undefined}
      data-tick={tick ? '' : undefined}
      aria-disabled={disabled}
      aria-pressed={tick === undefined ? undefined : tick}
      aria-label={`${optionLabel(index, text, picture !== undefined)}${status}`}
      data-pic={picture !== undefined ? '' : undefined}
      onClick={disabled ? undefined : () => onPick(index)}
    >
      <span className="lp-ans__l" aria-hidden="true">
        {o.letter}
      </span>
      {picture !== undefined ? (
        <span className="lp-ans__pic" aria-hidden="true">
          {picture ? <img src={picture} alt="" decoding="async" /> : picture === false ? <i>нет рисунка</i> : null}
        </span>
      ) : null}
      <span className="lp-ans__t">{text}</span>
      <Shape shape={o.shape} light={index === 0} />
      <span className="lp-ans__mark" aria-hidden="true">
        {mark === 'wrong' ? <Cross /> : <Check />}
      </span>
    </button>
  );
});

/**
 * The question's picture (a real test's diagram or photo): as wide as the screen allows, a tap opens it whole. While it
 * loads, a box of its place; when it did not come, a line that says so (the projector shows it too).
 */
function StemPicture({ url, onZoom }: { url: ShownPicture; onZoom: () => void }) {
  if (url === false) return <p className="lp-pic lp-pic--none">Рисунок не загрузился. Посмотрите на экран.</p>;
  if (url === null) return <div className="lp-pic lp-pic--wait" aria-hidden="true" />;
  return (
    <button type="button" className="lp-pic" onClick={onZoom} aria-label="Рисунок к вопросу. Нажмите, чтобы увеличить">
      <img src={url} alt="" decoding="async" />
    </button>
  );
}

/** The picture over the whole screen; a tap anywhere or Escape closes it. */
function PictureZoom({ url, onClose }: { url: string; onClose: () => void }) {
  const close = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    close.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="lp-zoom" role="dialog" aria-modal="true" aria-label="Рисунок к вопросу" onClick={onClose}>
      <img src={url} alt="Рисунок к вопросу" />
      <button ref={close} type="button" className="lp-zoom__close" onClick={onClose}>
        Закрыть
      </button>
    </div>
  );
}

/** The boss's health: scaleX of two bars (the light one follows a beat later). */
const HpBar = memo(function HpBar({ k }: { k: number }) {
  const scale = `scaleX(${Math.max(0, Math.min(1, k))})`;
  return (
    <div className="lp-hp-bar" role="progressbar" aria-label="Здоровье Дедлайна" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(k * 100)}>
      <i className="lp-lag" style={{ transform: scale, transition: 'transform 0.5s ease-in-out 0.6s' }} />
      <i style={{ transform: scale, transition: 'transform 0.6s cubic-bezier(0.16, 1, 0.3, 1)' }} />
    </div>
  );
});

/** 3 · 2 · 1 before the buttons open: each digit a delayed CSS animation, the delays fixed at mount. */
const Countdown = memo(function Countdown({ untilMs }: { untilMs: number }) {
  const [start] = useState(() => untilMs);
  const [still] = useState(reducedMotion);
  const [at] = useState(() => Date.now());
  const [now, setNow] = useState(() => Math.ceil(start / 1000));
  // Reduced motion: no animation, so the digit changes by a timer instead (three renders of one span).
  useEffect(() => {
    if (!still) return undefined;
    const t = setInterval(() => setNow(Math.max(1, Math.ceil((start - (Date.now() - at)) / 1000))), 250);
    return () => clearInterval(t);
  }, [still, start, at]);
  return (
    <div className="lp-cd" aria-hidden="true">
      {[3, 2, 1].map((n) => (
        <span key={n} data-now={n === now ? 'true' : undefined} style={{ animationDelay: `${Math.round(start - n * 1000)}ms` }}>
          {n}
        </span>
      ))}
    </div>
  );
});

function Fly({ refEl, kind, colour }: { refEl: RefObject<HTMLDivElement>; kind: 'star' | 'shard'; colour: Look['colour'] }) {
  return (
    <div ref={refEl} className="lp-fly" style={{ opacity: 0 }} aria-hidden="true">
      {kind === 'star' ? <Star colour={colour} size={34} /> : <Shard size={30} />}
    </div>
  );
}

/** Centre of an element (viewport): read only when layout is settled. */
function centre(el: Element | null): { x: number; y: number } | null {
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}

function fly(el: HTMLDivElement | null, from: { x: number; y: number }, to: { x: number; y: number }, kind: 'star' | 'shard', onDone: () => void): void {
  if (!el || typeof el.animate !== 'function') {
    onDone();
    return;
  }
  const half = kind === 'star' ? 17 : 15;
  const mx = (from.x + to.x) / 2 + (kind === 'star' ? 60 : -40);
  const my = (from.y + to.y) / 2;
  const t = (x: number, y: number, extra: string) => `translate(${Math.round(x - half)}px, ${Math.round(y - half)}px) ${extra}`;
  const frames =
    kind === 'star'
      ? [
          { transform: t(from.x, from.y, 'scale(0.7) rotate(0deg)'), opacity: 1 },
          { transform: t(mx, my, 'scale(1.4) rotate(200deg)'), opacity: 1 },
          { transform: t(to.x, to.y, 'scale(1) rotate(400deg)'), opacity: 1 },
        ]
      : [
          { transform: t(from.x, from.y, 'scale(0.6) rotate(0deg)'), opacity: 1 },
          { transform: t(mx, my, 'scale(1.2) rotate(180deg)'), opacity: 1 },
          { transform: t(to.x, to.y, 'scale(1) rotate(360deg)'), opacity: 1 },
        ];
  const anim = el.animate(frames, { duration: kind === 'star' ? 560 : 520, easing: 'linear', fill: 'forwards' });
  anim.onfinish = () => {
    el.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 120, fill: 'forwards' });
    onDone();
  };
}

/**
 * The gap to the next place up (Kahoot's «150 points behind»), from the top five of the leaderboard: the name above
 * when this player is 2nd to 6th, the lead when 1st; null further down (the state has no one else's damage there).
 * The number always comes after a colon («разница по урону: 21»), so no noun has to agree with it (1, 2, 5, 21, 150).
 * Equal damage is the same place on every list («1, 2, 2, 4»): the one beside says it shares the place.
 */
export function gapLine(top: readonly TopRow[] | null, me: Pick2<Me, 'player_id' | 'place' | 'dmg'>): string | null {
  if (!top || top.length === 0 || me.place < 1) return null;
  if (me.place === 1) {
    const next = top[1];
    if (!next || top[0]?.player_id !== me.player_id) return null;
    const lead = me.dmg - next.dmg;
    return lead > 0 ? `Отрыв по урону:${NBSP}${nb(lead)}` : `${next.name} делит с вами первое место`;
  }
  const above = top[me.place - 2];
  if (!above || above.player_id === me.player_id) return null;
  const gap = above.dmg - me.dmg;
  return gap > 0 ? `${above.name} впереди, разница по урону:${NBSP}${nb(gap)}` : `${above.name} делит с вами место`;
}
type Pick2<T, K extends keyof T> = { [P in K]: T[P] };

// ─────────────────────────────────────────── the result sheet ───────────────────────────────────────────

interface SheetProps {
  result: PlayerResult;
  options: string[];
  /** What the question asked for (questionKind): one right option, several, a text, a number. */
  kind: QuestionKind;
  /** A number question: the unit (null: none). */
  unit: string | null;
  look: Look;
  frozenBefore: boolean;
  /** This player joined during the question: the server counted nothing for them (no answer, no freeze). */
  sitOut: boolean;
  qPhase: BossPhase;
  elapsedMs: number | null;
  speed: boolean;
  streak: number;
  showPlace: boolean;
  place: number;
  players: number;
  dmgTotal: number;
  gap: string | null;
  bossEl: RefObject<HTMLDivElement>;
  haptic: (kind: HapticKind) => void;
  onImpact: () => void;
  /** «Без спешки»: no streak, speed or ice in the sheet's words. */
  calm: boolean;
}

/**
 * The sheet's words for a miss: a button question «Не успели» / «Неверно», a movement round of a mixed game «Не встали
 * на ответ» / «Мимо» (MODE_MIXED §8), and what the freeze means for the player.
 */
export function missWords(r: { none: boolean; frozen: boolean; stand?: boolean }, newlyFrozen: boolean, calm = false): { title: string; line: string } {
  const stand = !!r.stand;
  const title = stand ? (r.none ? 'Не встали на ответ' : 'Мимо') : r.none ? 'Не успели' : 'Неверно';
  // «Без спешки» (20261106090000_live_calm.sql): nobody freezes
  if (calm) return { title, line: CALM.miss };
  const line = newlyFrozen
    ? stand
      ? 'Вы заморожены. Ответьте верно на следующий вопрос, чтобы оттаять.'
      : r.none
        ? 'Дедлайн злится и замораживает тех, кто не успел. Ответьте верно на следующий вопрос, чтобы оттаять.'
        : 'Дедлайн заморозил вас. Ответьте верно на следующий вопрос, чтобы оттаять.'
    : r.frozen
      ? 'Вы всё ещё заморожены. Ответьте верно на следующий вопрос, чтобы оттаять.'
      : 'Серия начнётся заново со следующего верного ответа.';
  return { title, line };
}

const ResultSheet = memo(function ResultSheet(p: SheetProps) {
  const r = p.result;
  const right = r.correct && !r.thawed;
  const keys = rightKeys(r);
  // several right answers, some of them ticked: a share of the damage (CONTRACT §3)
  const partial = p.kind === 'multiple' && !r.correct && !r.none && (r.share ?? 0) > 0;
  const hit = right || (partial && r.dmg > 0);
  const newlyFrozen = r.frozen && !p.frozenBefore;
  const meEl = useRef<HTMLDivElement>(null);
  const star = useRef<HTMLDivElement>(null);
  const shard = useRef<HTMLDivElement>(null);
  const seen = p.sitOut && r.none && !r.frozen;
  // a movement round that did not count (MODE_MIXED §6): nothing happened to anyone
  const voided = !!(r.stand && r.void);
  const [face, setFace] = useState<'idle' | 'happy' | 'hurt' | 'frozen'>(seen ? 'idle' : voided ? (r.frozen ? 'frozen' : 'idle') : r.correct || hit ? 'happy' : r.frozen && !newlyFrozen ? 'frozen' : 'hurt');
  const [ice, setIce] = useState(r.thawed || (r.frozen && !newlyFrozen));
  const [move, setMove] = useState<'idle' | 'bounce' | 'hit'>('idle');
  const { haptic, onImpact, bossEl } = p;

  useEffect(() => {
    const timers: ReturnType<typeof setTimeout>[] = [];
    const at = (ms: number, fn: () => void) => timers.push(setTimeout(fn, ms));
    const still = reducedMotion();
    if (hit) {
      at(20, () => haptic('success'));
      at(420, () => setMove('bounce'));
      at(still ? 60 : 650, () => {
        const from = centre(meEl.current);
        const to = centre(bossEl.current);
        const impact = () => {
          haptic('hit');
          onImpact();
        };
        if (still || !from || !to) impact();
        else fly(star.current, from, to, 'star', impact);
      });
    } else {
      at(300, onImpact);
      if (r.thawed) {
        at(20, () => haptic('success'));
        at(500, () => setIce(false));
      } else if (newlyFrozen) {
        at(20, () => haptic('error'));
        at(still ? 60 : 650, () => {
          const from = centre(bossEl.current);
          const to = centre(meEl.current);
          const freeze = () => {
            setFace('frozen');
            setIce(true);
            setMove('hit');
            haptic('freeze');
          };
          if (still || !from || !to) freeze();
          else fly(shard.current, from, to, 'shard', freeze);
        });
      } else if (!r.correct && !seen && !voided) at(20, () => haptic(r.none ? 'warning' : 'error'));
    }
    return () => timers.forEach(clearTimeout);
    // Once per question: the sheet is keyed by it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const numberQ = p.kind === 'number';
  const unit = r.unit ?? p.unit;
  const keyText =
    p.kind === 'short'
      ? (r.forms?.[0] ?? '')
      : numberQ
        ? numberAnswer(r.forms, r.tolerance, unit)
        : keys.map((k) => `${OPTION_STYLES[k]?.letter ?? ''}${NBSP}·${NBSP}${p.options[k] ?? ''}`).join(', ');
  const keyLabel = p.kind === 'short' || numberQ ? KINDS.rightText : keys.length > 1 ? KINDS.rightMany : 'Верный ответ';
  const typed = (p.kind === 'short' || numberQ) && typeof r.typed === 'string' && r.typed ? r.typed : null;
  const tops = (p.kind === 'short' || numberQ) && Array.isArray(r.tops) && r.tops.length > 0 ? r.tops : null;
  let title: string;
  let body: ReactNode;
  if (voided) {
    title = 'Мини-игра не засчитана';
    body = <p>Связь с ареной пропала. Урон и лёд не изменились.</p>;
  } else if (r.thawed) {
    title = `Верно${NBSP}— оттаяли`;
    body = (
      <>
        <p>Урона в этом вопросе нет: вы были заморожены. Со следующего вопроса бьёте как все.</p>
        <div className="lp-pills">
          <span className="lp-pill">Серия 1</span>
        </div>
      </>
    );
  } else if (seen) {
    title = 'Вы вошли позже';
    body = (
      <>
        <p>
          {keyLabel}: <b>{keyText}</b>
        </p>
        <p>Этот вопрос шёл без вас. Следующий{NBSP}— ваш.</p>
      </>
    );
  } else if (partial) {
    const picks = r.picks ?? [];
    const got = picks.filter((k) => keys.includes(k)).length;
    title = KINDS.partial;
    body =
      r.dmg > 0 ? (
        <>
          <span className="lp-big">−{nb(r.dmg)}</span>
          <p>урона Дедлайну</p>
          <div className="lp-pills">
            <span className="lp-pill">{KINDS.partialOf(got, keys.length, picks.length - got)}</span>
          </div>
          <p className="lp-wide">
            {keyLabel}: <b>{keyText}</b>
          </p>
        </>
      ) : (
        <>
          <p>{KINDS.partialFrozen}</p>
          <p className="lp-wide">
            {keyLabel}: <b>{keyText}</b>
          </p>
        </>
      );
  } else if (r.correct) {
    title = 'Верно';
    body = (
      <>
        <span className="lp-big">−{nb(r.dmg)}</span>
        <p>урона Дедлайну</p>
        {p.calm ? (
          <div className="lp-pills">
            <span className="lp-pill">{CALM.pill}</span>
          </div>
        ) : (
          <div className="lp-pills">
            <span className="lp-pill">Серия {p.streak}</span>
            {p.streak > 1 && <span className="lp-pill">{multText(p.streak)} за серию</span>}
            {/* The server's seconds (the ack), the ones the damage was counted with; unknown → none. */}
            {p.speed && p.elapsedMs !== null && <span className="lp-pill">{seconds(p.elapsedMs)}</span>}
          </div>
        )}
      </>
    );
  } else {
    const miss = missWords(r, newlyFrozen, p.calm);
    title = miss.title;
    body = (
      <>
        {typed !== null ? (
          <p>
            {numberQ ? (
              <>
                {KINDS.mineNumber}: {typedText(typed, unit)}
              </>
            ) : (
              <>
                {KINDS.mine}: «{typed}»
              </>
            )}
          </p>
        ) : null}
        <p>
          {keyLabel}: <b>{keyText}</b>
        </p>
        <p>{miss.line}</p>
      </>
    );
  }
  const healed = r.healed > 0;
  return (
    <section className={`lp-sheet ${seen || voided ? 'lp-sheet--seen' : r.correct || hit ? 'lp-sheet--ok' : 'lp-sheet--bad'}`} aria-labelledby="lp-sheet-title">
      <h2 id="lp-sheet-title" role="status">
        {title}
      </h2>
      {body}
      {tops ? (
        <p className="lp-wide lp-tops">
          {numberQ
            ? `${KINDS.near}: ${tops.map((t) => `${typedText(t.text, unit)}${NBSP}— ${KINDS.topN(t.n)}`).join(', ')}`
            : `${KINDS.tops}: ${tops.map((t) => `«${t.text}» ${KINDS.topN(t.n)}`).join(', ')}`}
        </p>
      ) : null}
      {healed && <p className="lp-wide">Мало верных ответов: Дедлайн восстановил силы.</p>}
      {p.showPlace && (
        <div className="lp-place">
          <div className="lp-place__row">
            <span>
              Вы {p.place}-й по урону из {p.players}
            </span>
            <span>{nb(p.dmgTotal)}</span>
          </div>
          {p.gap && <p className="lp-place__gap">{p.gap}</p>}
        </div>
      )}
      <div ref={meEl} className="lp-sheet-me">
        <LiveChar look={p.look} size={92} face={face} frozen={ice} move={move} />
      </div>
      <Fly refEl={star} kind="star" colour={p.look.colour} />
      <Fly refEl={shard} kind="shard" colour={p.look.colour} />
    </section>
  );
});

// ─────────────────────────────────────────── the top five ───────────────────────────────────────────

const Top5 = memo(function Top5({ top, meId }: { top: TopRow[]; meId: string }) {
  // equal damage, the same place («1, 2, 2, 4»)
  const places = sharedPlaces(top.map((r) => r.dmg));
  return (
    <div className="lp-top5">
      <h3>Больше всех урона</h3>
      <ol>
        {top.map((row, i) => (
          <li key={row.player_id} data-me={row.player_id === meId ? 'true' : 'false'}>
            <span className="lp-n">{places[i]}</span>
            <LiveChar look={row.look} size={30} move="none" />
            <span className="lp-who">{row.player_id === meId ? `${row.name} (вы)` : row.name}</span>
            <span>{nb(row.dmg)}</span>
            <span className="lp-move" aria-label={row.move > 0 ? `выше на ${row.move}` : row.move < 0 ? `ниже на ${-row.move}` : 'на месте'}>
              {row.move > 0 ? `↑${row.move}` : row.move < 0 ? `↓${-row.move}` : ''}
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
});

// ─────────────────────────────────────────── the wait after the tap ───────────────────────────────────────────

interface WaitProps {
  /** 'answered': the ack came; 'up': the time is over (or everyone answered), the result is on its way; 'late': this
   * player joined during the question. */
  mode: 'answered' | 'up' | 'late';
  allIn: boolean;
  order: number | null;
  answered: number;
  players: number;
  streak: number;
  frozen: boolean;
}

/**
 * The wait (up to ~18 s after a fast tap): what the server already knows — the order of the own answer, how many of
 * the class answered (a bar, scaleX), the streak at stake; then «Время вышло» and a short beat until the result.
 * Plain DOM, no characters: it comes a frame after the ack and costs a few nodes.
 */
const Wait = memo(function Wait({ mode, allIn, order, answered, players, streak, frozen }: WaitProps) {
  const k = players > 0 ? Math.min(1, answered / players) : 0;
  let head: string;
  if (mode === 'up') head = allIn ? 'Все ответили' : 'Время вышло';
  else if (mode === 'late') head = `Следующий вопрос${NBSP}— ваш`;
  else head = order !== null ? `Ваш ответ пришёл ${orderText(order)}` : 'Ждём остальных';
  let foot: ReactNode = null;
  if (mode === 'up')
    foot = (
      <span className="lp-wait__dots" aria-hidden="true">
        Считаем удары <i />
        <i />
        <i />
      </span>
    );
  else if (mode === 'answered') foot = frozen ? 'Верный ответ разморозит вас' : streak > 0 ? `Серия ${streak} · если верно, урон ${multText(streak + 1)}` : null;
  return (
    <div className="lp-wait" data-mode={mode}>
      <b className="lp-wait__h">{head}</b>
      <div className="lp-wait__bar" aria-hidden="true">
        <i style={{ transform: `scaleX(${k})` }} />
      </div>
      <span className="lp-wait__n">
        Ответили {Math.min(answered, players)} из {players}
      </span>
      {foot && <span className="lp-wait__foot">{foot}</span>}
    </div>
  );
});

// ─────────────────────────────────────────── the question ───────────────────────────────────────────

export interface BattleProps {
  ctl: PlayerController;
  st: PlayerState;
  question: Question;
  pick: Pick | null;
  answered: number | null;
  hpFrom: number | null;
  frozenBefore: boolean;
  /** This player joined while this question was open: no answer to it. */
  late: boolean;
  offsetMs: number;
  look: Look;
  haptic: (kind: HapticKind) => void;
}

/** «Без спешки» (20261106090000_live_calm.sql): the phone's words. */
export const CALM = {
  pill: 'Без спешки',
  line: 'Отвечайте спокойно: очки только за верные ответы',
  miss: 'Без спешки никто не замерзает. Следующий вопрос — новый шанс.',
  angry: { title: 'Дедлайн злится', text: 'Без спешки это ничего не меняет: никто не замерзает.' },
};

const PHASE_TEXT: Record<1 | 2, { title: string; text: string }> = {
  1: { title: 'Дедлайн злится', text: 'Теперь замораживает и тех, кто не успел ответить.' },
  2: { title: 'Последняя минута', text: 'Если верных ответов меньше двух третей, Дедлайн восстанавливает силы.' },
};

export function Battle({ ctl, st, question: q, pick, answered, hpFrom, frozenBefore, late, offsetMs, look, haptic }: BattleProps) {
  const closed = st.state === 'reveal' || st.state === 'leaderboard';
  const result = closed ? st.result : null;
  const kind = questionKind(q);
  // several right answers: the options ticked before «Ответить»; a text answer: what is typed so far
  const [marked, setMarked] = useState<number[]>([]);
  const [draft, setDraft] = useState('');
  const pics = useLivePictures(q.pictures, ctl.picture);
  const [zoom, setZoom] = useState(false);
  const closeZoom = useCallback(() => setZoom(false), []);
  // the key and the result sheet come over the answers: the picture steps back for them
  useEffect(() => {
    if (closed) setZoom(false);
  }, [closed]);
  const T = st.time_s * 1000;
  const opensLocal = Date.parse(q.opens_at) - offsetMs;
  const closesLocal = Date.parse(q.closes_at) - offsetMs;
  const [openNow, setOpenNow] = useState(() => st.state === 'open' || Date.now() >= opensLocal);
  const isOpen = !closed && (openNow || st.state === 'open');
  const bar = useRef<HTMLElement>(null);
  const sec = useRef<HTMLSpanElement>(null);
  const bossEl = useRef<HTMLDivElement>(null);
  const [impact, setImpact] = useState(false);
  const [bossMove, setBossMove] = useState<'idle' | 'hit' | 'fall' | 'roar'>('idle');
  const [flash, setFlash] = useState(0);
  const [hurt, setHurt] = useState(false);
  const [banner, setBanner] = useState<{ title: string; text: string } | null>(null);
  /** The phone's clock reached the question's end: «Время вышло» until the server's result comes. */
  const [timeUp, setTimeUp] = useState(() => !closed && st.state === 'open' && Date.now() >= closesLocal);
  const [hop, setHop] = useState(false);

  // The buttons open at the server's opens_at.
  useEffect(() => {
    if (closed || openNow) return undefined;
    const t = setTimeout(() => {
      setOpenNow(true);
      haptic('go');
    }, Math.max(0, opensLocal - Date.now()));
    return () => clearTimeout(t);
  }, [closed, openNow, opensLocal, haptic]);

  // The time bar (WAAPI scaleX) and the seconds (a text node). Closed: no number at all, never a stale one.
  useEffect(() => {
    const el = bar.current;
    const s = sec.current;
    if (!el || !s) return undefined;
    if (closed) {
      el.getAnimations?.().forEach((a) => a.pause());
      s.textContent = '';
      return undefined;
    }
    if (!isOpen) {
      el.style.transform = 'scaleX(1)';
      s.textContent = String(st.time_s);
      return undefined;
    }
    const left = Math.max(0, closesLocal - Date.now());
    const k = Math.min(1, left / T);
    let anim: Animation | null = null;
    if (typeof el.animate === 'function' && !reducedMotion()) {
      anim = el.animate([{ transform: `scaleX(${k})` }, { transform: 'scaleX(0)' }], { duration: left, easing: 'linear', fill: 'forwards' });
    } else el.style.transform = `scaleX(${k})`;
    let shown = -1;
    let iv: ReturnType<typeof setInterval> | null = null;
    const tick = () => {
      const n = Math.max(0, Math.ceil((closesLocal - Date.now()) / 1000));
      if (n === shown) return;
      shown = n;
      s.textContent = String(Math.min(n, st.time_s));
      if (n === 0) {
        if (reducedMotion()) el.style.transform = 'scaleX(0)';
        if (iv) clearInterval(iv);
        iv = null;
        setTimeUp(true);
      }
    };
    tick();
    if (shown > 0) iv = setInterval(tick, 250);
    return () => {
      if (iv) clearInterval(iv);
      anim?.pause();
    };
  }, [closed, isOpen, closesLocal, T, st.time_s]);

  // Time is up: the boss winds up once (a transform), the beat before the result.
  const upNow = timeUp && !closed;
  useEffect(() => {
    if (!upNow) return undefined;
    setBossMove('roar');
    const t = setTimeout(() => setBossMove((m) => (m === 'roar' ? 'idle' : m)), 460);
    return () => clearTimeout(t);
  }, [upNow]);

  // The own character hops once when the server takes the answer.
  const acked = !!pick && pick.qi === q.qi && pick.status === 'accepted' && pick.order !== null;
  useEffect(() => {
    if (!acked) return undefined;
    setHop(true);
    const t = setTimeout(() => setHop(false), 450);
    return () => clearTimeout(t);
  }, [acked]);

  // The hit (or the others' hits) lands: the boss shakes, the HP bar moves, then the phase or the defeat.
  const latest = useRef(st);
  latest.current = st;
  const after = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (after.current) clearTimeout(after.current);
    },
    [],
  );
  const onImpact = useCallback(() => {
    setImpact(true);
    setFlash((f) => f + 1);
    setHurt(true);
    setBossMove('hit');
    after.current = setTimeout(() => {
      const now = latest.current;
      const res = now.result;
      setHurt(false);
      setBossMove(now.boss.defeated ? 'fall' : 'idle');
      if (now.boss.defeated) {
        setBanner({ title: 'Дедлайн повержен', text: `Класс победил. Сейчас${NBSP}— итог игры.` });
        haptic('success');
      } else if (res?.phase_changed === 1 || res?.phase_changed === 2) {
        setBanner(res.phase_changed === 1 && now.calm ? CALM.angry : PHASE_TEXT[res.phase_changed]);
        haptic('warning');
      }
    }, 420);
  }, [haptic]);

  const hpMax = Math.max(1, st.boss.hp_max);
  const kNow = st.boss.hp / hpMax;
  const k = closed && result && hpFrom !== null && !impact ? hpFrom / hpMax : kNow;
  const pct = Math.max(0, Math.round(k * 100));

  const picked = pick && pick.qi === q.qi ? pick : null;
  const sitOut = late && !picked && !closed;
  const missed = upNow && !picked;
  const mine = picked ? (picked.picks ?? (picked.choice >= 0 ? [picked.choice] : [])) : [];
  const keys = rightKeys(result);
  const looks: AnsLook[] = q.options.map((_, i) => (picked ? (mine.includes(i) ? 'chosen' : 'dim') : sitOut || missed ? 'dim' : 'idle'));
  const marks = q.options.map((_, i) => {
    if (!result) return null;
    if (keys.includes(i)) return 'key' as const;
    if (mine.includes(i)) return 'wrong' as const;
    return null;
  });
  const closedLooks: AnsLook[] = q.options.map((_, i) => (marks[i] ? 'idle' : 'dim'));
  const ticking = kind === 'multiple' && !picked && !closed;
  const onPick = useMemo(
    () =>
      kind === 'multiple'
        ? (i: number) => {
            haptic('tap');
            setMarked((m) => (m.includes(i) ? m.filter((x) => x !== i) : [...m, i].sort((a, b) => a - b)));
          }
        : (i: number) => ctl.answer(i),
    [ctl, kind, haptic],
  );
  // At the phone's zero what is ticked or typed goes by itself (the server takes it up to 1.5 s after the end).
  const autoSent = useRef(false);
  useEffect(() => {
    if (!upNow || picked || sitOut || autoSent.current) return;
    if (kind === 'multiple' && marked.length > 0) {
      autoSent.current = true;
      ctl.answerPicks(marked);
    } else if (kind === 'short' && draft.trim()) {
      autoSent.current = true;
      ctl.answerText(draft);
    } else if (kind === 'number' && padReady(draft)) {
      autoSent.current = true;
      ctl.answerText(draft);
    }
  }, [upNow, picked, sitOut, kind, marked, draft, ctl]);
  const canSend = isOpen && !picked && !closed && !sitOut && !upNow;

  // «Ответили N»: the larger of the ack's count and the last state's, at least this answer.
  const known = Math.max(answered ?? 0, st.answered);
  const count = Math.min(st.players, Math.max(known + (picked && picked.status === 'sending' ? 1 : 0), picked ? 1 : 0));
  // Everyone answered by the server's count (not the tap's guess): the question closes at once.
  const allIn = isOpen && st.players > 0 && known >= st.players;

  // The line beside the own character.
  let line: ReactNode;
  let tone: 'ice' | undefined;
  const frozen = st.me.frozen;
  if (closed && result) line = `Верно ответили ${result.right} из ${st.players}`;
  else if (sitOut) line = <><b>Вы вошли во время вопроса</b>{NBSP}— играете со следующего</>;
  else if (picked) {
    if (picked.status === 'retrying') line = <><b>Отправляем ответ…</b> Нет связи, пробуем ещё раз.</>;
    else if (picked.status === 'late') line = <><b>Ответ не успел.</b> Время вышло.</>;
    // The count is in the wait's panel (after the ack); here only that the tap counted.
    else line = <><b>Ответ принят.</b>{upNow || allIn ? null : ' Ждём остальных.'}</>;
  } else if (missed) line = 'В этот раз без ответа';
  else if (frozen) {
    tone = 'ice';
    line = isOpen ? 'Заморожены: ответьте верно, чтобы оттаять' : 'Вы заморожены. Ответьте верно, чтобы оттаять. Урона в этом вопросе не будет.';
  } else if (st.calm) line = CALM.line;
  else if (st.me.streak > 0) line = `Серия ${st.me.streak} · урон ${multText(st.me.streak + 1)} за верный`;
  else line = st.speed ? `Отвечайте быстрее${NBSP}— урон больше` : `Верный ответ${NBSP}— удар по Дедлайну`;

  const rule = q.phase === 1 && st.calm ? null : q.phase === 1 ? `Дедлайн злится: кто не успел${NBSP}— тоже замёрзнет.` : q.phase === 2 ? `Последняя минута: мало верных${NBSP}— Дедлайн лечится.` : null;
  const showTop = st.state === 'leaderboard' && st.top && st.top.length > 0;
  // The wait's panel: after the ack (never on the tap's own frame), at the end of the time, or for a late joiner.
  const waitMode: WaitProps['mode'] | null = closed || !isOpen ? null : upNow || allIn ? 'up' : sitOut ? 'late' : picked && picked.status === 'accepted' ? 'answered' : null;
  const gap = st.state === 'leaderboard' ? gapLine(st.top, st.me) : null;

  return (
    <div className="lp-battle" data-up={upNow ? 'true' : undefined}>
      <div className="lp-top">
        <span className="lp-count" aria-label={`Вопрос ${q.qi + 1} из ${st.q_count}`}>
          {q.qi + 1}/{st.q_count}
        </span>
        <span className="lp-time" aria-hidden="true">
          <i ref={bar} />
        </span>
        <span ref={sec} className="lp-sec" aria-label={closed ? undefined : 'Секунд осталось'} aria-hidden={closed ? true : undefined}>
          {closed ? '' : st.time_s}
        </span>
      </div>
      <div className="lp-boss">
        <div ref={bossEl}>
          <LiveBoss size={58} phase={st.boss.phase} hurt={hurt} move={bossMove} flashKey={flash} />
        </div>
        <div className="lp-hp">
          <div className="lp-hp-row">
            <span>Дедлайн</span>
            <span>{pct}&nbsp;%</span>
          </div>
          <HpBar k={k} />
        </div>
      </div>
      {rule && !closed && <p className="lp-rule">{rule}</p>}
      <div className="lp-mid">
        {showTop ? (
          <>
            {teamsOf(st) ? <TeamsMini teams={teamsOf(st)!} mine={st.me.team} /> : null}
            <Top5 top={st.top as TopRow[]} meId={st.me.player_id} />
          </>
        ) : (
          <>
            <h2 className="lp-q" data-size={questionSize(q.text)}>
              {q.text}
            </h2>
            {pics.stem !== undefined ? <StemPicture url={pics.stem} onZoom={() => setZoom(true)} /> : null}
            {!isOpen && !closed && <Countdown untilMs={opensLocal - Date.now()} />}
            {waitMode && (
              <Wait mode={waitMode} allIn={allIn} order={picked?.order ?? null} answered={count} players={st.players} streak={st.me.streak} frozen={frozen} />
            )}
          </>
        )}
      </div>
      <div className="lp-me">
        <LiveChar look={look} size={52} frozen={frozen} face={frozen ? 'frozen' : picked ? 'happy' : 'idle'} move={hop ? 'bounce' : 'idle'} />
        <div className="lp-me-text" data-tone={tone} role="status" aria-live="polite">
          {line}
        </div>
      </div>
      {kind === 'number' ? (
        <div className="lp-textans lp-numans" data-wait={!isOpen && !closed ? 'true' : 'false'}>
          {picked || closed ? (
            <p className="lp-textans__sent" data-mark={result ? (result.correct ? 'key' : 'wrong') : undefined}>
              {picked?.text
                ? KINDS.sentNumber(typedText(picked.text, q.unit ?? null))
                : result && result.forms?.[0]
                  ? `${KINDS.rightText}: ${numberAnswer(result.forms, result.tolerance, result.unit ?? q.unit ?? null)}`
                  : ''}
            </p>
          ) : (
            <NumberPad value={draft} unit={q.unit ?? null} enabled={canSend} onChange={setDraft} onSend={() => ctl.answerText(draft)} onKey={() => haptic('tap')} />
          )}
        </div>
      ) : kind === 'short' ? (
        <form
          className="lp-textans"
          data-wait={!isOpen && !closed ? 'true' : 'false'}
          onSubmit={(e) => {
            e.preventDefault();
            if (canSend) ctl.answerText(draft);
          }}
        >
          {picked || closed ? (
            <p className="lp-textans__sent" data-mark={result ? (result.correct ? 'key' : 'wrong') : undefined}>
              {picked?.text ? KINDS.sentText(picked.text) : result ? (result.forms?.[0] ? `${KINDS.rightText}: ${result.forms[0]}` : '') : ''}
            </p>
          ) : (
            <>
              <input
                className="lp-textans__in"
                type="text"
                value={draft}
                maxLength={200}
                placeholder={KINDS.textPlaceholder}
                aria-label={KINDS.textLabel}
                autoComplete="off"
                autoCorrect="off"
                spellCheck={false}
                enterKeyHint="send"
                disabled={!isOpen || sitOut || upNow}
                onChange={(e) => setDraft(e.target.value)}
              />
              <button type="submit" className="lp-btn lp-btn--main lp-send" disabled={!canSend || !draft.trim()}>
                {KINDS.send}
              </button>
            </>
          )}
        </form>
      ) : (
        <div className="lp-answers" data-n={q.options.length} data-wait={!isOpen && !closed ? 'true' : 'false'} data-multi={kind === 'multiple' ? '' : undefined}>
          {kind === 'multiple' && q.multi && !closed ? <p className="lp-multi">{KINDS.multi(q.multi)}</p> : null}
          {q.options.map((text, i) => (
            <Answer
              key={i}
              index={i}
              text={text}
              disabled={!isOpen || !!picked || closed || sitOut || upNow}
              look={closed ? closedLooks[i] : looks[i]}
              mark={marks[i]}
              tick={ticking ? marked.includes(i) : undefined}
              picture={pics.options[i]}
              onPick={onPick}
            />
          ))}
          {kind === 'multiple' && !closed ? (
            <button type="button" className="lp-btn lp-btn--main lp-send" disabled={!canSend || marked.length === 0} onClick={() => ctl.answerPicks(marked)}>
              {picked ? KINDS.sentPicks(mine.length) : KINDS.send}
            </button>
          ) : null}
        </div>
      )}
      {zoom && typeof pics.stem === 'string' ? <PictureZoom url={pics.stem} onClose={closeZoom} /> : null}
      {banner && (
        <div className="lp-phase" role="status">
          <b>{banner.title}</b>
          <span>{banner.text}</span>
        </div>
      )}
      {result && (
        <ResultSheet
          result={result}
          options={q.options}
          kind={kind}
          unit={q.unit ?? null}
          look={look}
          frozenBefore={frozenBefore}
          sitOut={late}
          qPhase={q.phase}
          elapsedMs={picked?.elapsedMs ?? null}
          speed={st.speed}
          streak={st.me.streak}
          showPlace={st.state === 'leaderboard'}
          place={shownPlace(st.top ? st.top.map((r) => ({ id: r.player_id, points: r.dmg })) : null, { id: st.me.player_id, points: st.me.dmg, place: st.me.place })}
          players={st.players}
          dmgTotal={st.me.dmg}
          gap={gap}
          bossEl={bossEl}
          haptic={haptic}
          onImpact={onImpact}
          calm={!!st.calm}
        />
      )}
    </div>
  );
}
