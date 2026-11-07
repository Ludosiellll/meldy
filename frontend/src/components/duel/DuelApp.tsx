/**
 * The screens of «Дуэль» (/d/<code>, docs/live/DUEL.md): the controller's snapshot picks the screen, the seat's stage the
 * duel's part. Both characters face each other over a board with both names, scores and a track per question; the
 * question with the timer bar and the live player's A–Е buttons, ticks, text field or keypad; the reveal under the
 * question (on a phone a bottom sheet hid the options and the marks of who picked what): both verdicts and points, the
 * key, the explanation, «Дальше»; the wait for a seat away; the final («Победа», «Поражение», «Ничья»), «Разбор и
 * ошибки», «Ещё раз», «Выйти»; the review with both answers and «Тренировать ошибки». The live player's surface
 * (player.css), the site's tokens for light and dark, Onest. On a computer the board runs across the top, the question under it.
 *
 * Smoothness (the player's rule): the time bar moves by transform only; the seconds are a text node.
 */
import { memo, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Builder } from '../live/player/Builder';
import { Answer, Countdown, type AnsLook } from '../live/player/Battle';
import { NumberPad } from '../live/player/NumberPad';
import { LiveChar, reducedMotion } from '../live/player/art';
import { KINDS, multText, nb } from '../live/player/copy';
import { OPTION_STYLES, questionSize } from '../live/player/options';
import { numberAnswer, padReady, typedText } from '../../lib/live/numbers';
import { qrCode } from '../../lib/quizzes/qr';
import { copyText } from '../../lib/clipboard';
import { useFocusAfterSwap } from '../../lib/useFocusAfterSwap';
import type { AnswerInput, Look } from '../../lib/live/types';
import type { DuelReviewItem, DuelSide, DuelState, TrackMark } from '../../lib/duel/types';
import type { DuelController, DuelSnapshot } from './controller';
import { DU, NBSP, clockText } from './copy';
import '../live/player/player.css';
import './duel.css';

export interface DuelAppProps {
  ctl: DuelController;
  /** The sign-in page with the way back to the review and «Тренировать ошибки». */
  signInHref: string;
  /** «Выйти»: where the duel's page is left for. */
  exitHref: string;
}

/** A re-render every `ms` while `on` (the countdowns' text). */
function useTick(ms: number, on: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!on) return undefined;
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms, on]);
  return now;
}

export function DuelApp({ ctl, signInHref, exitHref }: DuelAppProps) {
  const s = useSyncExternalStore(ctl.subscribe, ctl.getSnapshot, ctl.getSnapshot);
  const title = s.state ? `${s.state.duel.title} · ${DU.name}` : s.info ? `${s.info.title} · ${DU.name}` : DU.name;
  useEffect(() => {
    document.title = `${title} — Meldy`;
  }, [title]);

  let screen: ReactNode;
  const st = s.state;
  // A new screen (the step, the stage, the question) takes the focus that went with the old one (A11Y-4).
  const rootRef = useRef<HTMLElement | null>(null);
  useFocusAfterSwap(rootRef, `${s.step}:${st?.duel.stage ?? ''}:${st?.question?.qi ?? ''}`);
  if (s.step === 'loading') screen = <Message text={s.backoff > 0 ? DU.loadingBusy : DU.loading} status />;
  else if (s.step === 'gone')
    screen = <Message title={s.gone?.title} text={s.gone?.text} exitHref={exitHref} exitLabel={exitHref === '/games' ? DU.gone.toGames : DU.gone.toStart} alert />;
  else if (s.step === 'full')
    screen = (
      <>
        <div className="lp-page du-msg">
          <h1 className="lp-h1">{DU.full.title}</h1>
          <p className="lp-sub" role="alert">
            {DU.full.text}
          </p>
        </div>
        <div className="lp-bar">
          <button type="button" className="lp-btn lp-btn--second" onClick={() => ctl.retryFull()}>
            {DU.full.retry}
          </button>
          <Link className="lp-btn lp-btn--quiet" to={exitHref}>
            {DU.final.exit}
          </Link>
        </div>
      </>
    );
  else if (s.step === 'intro') screen = <Intro ctl={ctl} s={s} />;
  else if (s.step === 'builder')
    screen = (
      <Builder
        ctl={ctl}
        name={s.name}
        fromTelegram={false}
        look={s.look}
        unlocked={s.unlocked}
        lockedTap={s.lockedTap}
        from="join"
        busy={s.busy}
        error={s.error}
        guest
        backText={DU.builder.back}
      />
    );
  else if (s.step === 'review' && st) screen = <ReviewScreen ctl={ctl} s={s} st={st} signInHref={signInHref} />;
  else if (s.step === 'duel' && st) {
    if (st.duel.stage === 'lobby') screen = <Lobby ctl={ctl} s={s} st={st} />;
    else if (st.duel.stage === 'final') screen = <Final ctl={ctl} s={s} st={st} exitHref={exitHref} />;
    else screen = <Play key={st.question?.qi ?? -1} ctl={ctl} s={s} st={st} />;
  } else screen = <div className="lp-page" />;

  return (
    <main ref={rootRef} className="lp du" data-step={s.step} data-stage={st?.duel.stage} aria-label={DU.name}>
      <div className="du-col">{screen}</div>
    </main>
  );
}

function Message({ title, text, exitHref, exitLabel, status, alert }: { title?: string; text?: string; exitHref?: string; exitLabel?: string; status?: boolean; alert?: boolean }) {
  return (
    <>
      <div className="lp-page du-msg">
        {title ? <h1 className="lp-h1">{title}</h1> : null}
        <p className="lp-sub" role={alert ? 'alert' : status ? 'status' : undefined}>
          {text}
        </p>
      </div>
      {exitHref ? (
        <div className="lp-bar">
          <Link className="lp-btn lp-btn--second" to={exitHref}>
            {exitLabel ?? DU.final.exit}
          </Link>
        </div>
      ) : null}
    </>
  );
}

// ─────────────────────────────────────────── the invite ───────────────────────────────────────────

function Intro({ ctl, s }: { ctl: DuelController; s: DuelSnapshot }) {
  const info = s.info!;
  const host = info.players.find((p) => p.seat === 1);
  return (
    <>
      <div className="lp-page">
        <p className="du-kicker">{DU.intro.kicker}</p>
        <h1 className="lp-h1">{host ? DU.intro.who(host.name) : DU.name}</h1>
        <p className="lp-sub">
          {info.title} · {DU.intro.meta(info.q_count, info.time_s)}
        </p>
        <div className="du-stage" aria-hidden="true">
          {host ? <LiveChar look={host.look} size={104} face="happy" /> : null}
          <span className="du-stage-vs">{DU.board.vs}</span>
          <span className="du-face-left">
            <LiveChar look={s.look} size={104} face="idle" />
          </span>
        </div>
        <ul className="du-rules">
          {DU.intro.rules.map((r) => (
            <li key={r}>{r}</li>
          ))}
          <li>{info.calm ? DU.intro.calm : DU.intro.speed}</li>
        </ul>
        {s.error ? (
          <p className="lp-error" role="alert">
            {s.error}
          </p>
        ) : null}
      </div>
      <div className="lp-bar">
        <button type="button" className="lp-btn lp-btn--main" onClick={() => ctl.begin()}>
          {DU.intro.go}
        </button>
      </div>
    </>
  );
}

// ─────────────────────────────────────────── the board ───────────────────────────────────────────

/** The marks of each question for one seat: closed ones by their verdict, the current one, the rest to come. */
function trackOf(st: DuelState, side: 'me' | 'other'): Array<TrackMark | 'now' | null> {
  const out: Array<TrackMark | 'now' | null> = Array.from({ length: st.duel.q_count }, () => null);
  for (const row of st.track) out[row.qi] = row[side];
  const q = st.question;
  if (st.duel.stage === 'play' && q && !q.closed_at && out[q.qi] === null) out[q.qi] = 'now';
  return out;
}

const MARK_WORD: Record<TrackMark | 'now', string> = { right: 'верно', part: 'частично', wrong: 'неверно', none: 'без ответа', now: 'сейчас' };

const Track = memo(function Track({ marks, label }: { marks: Array<TrackMark | 'now' | null>; label: string }) {
  return (
    <ol className="du-track" aria-label={label}>
      {marks.map((m, i) => (
        <li key={i} data-mark={m ?? undefined} aria-label={`${i + 1}: ${m ? MARK_WORD[m] : 'впереди'}`} />
      ))}
    </ol>
  );
});

function Board({ st, otherPresent, compact = false }: { st: DuelState; otherPresent: boolean | null; compact?: boolean }) {
  const o = st.other;
  const q = st.question;
  const open = st.duel.stage === 'play' && !!q && !q.closed_at && !q.soon;
  const away = o && otherPresent === false;
  const size = compact ? 54 : 76;
  const meFace = st.me.frozen ? 'frozen' : st.result?.me?.correct ? 'happy' : st.result && !st.result.me?.correct ? 'hurt' : 'idle';
  const otherFace = o?.frozen ? 'frozen' : st.result?.other?.correct ? 'happy' : st.result && !st.result.other?.correct ? 'hurt' : 'idle';
  return (
    <section className="du-board" data-compact={compact ? 'true' : undefined} aria-label="Счёт">
      <div className="du-side" data-side="me">
        <LiveChar look={st.me.look} size={size} face={meFace} frozen={st.me.frozen} move="idle" />
        <div className="du-side-text">
          <span className="du-name">
            {st.me.name}
            <small> · {DU.q.me}</small>
          </span>
          <span className="du-score" aria-label={`Ваши очки: ${st.me.dmg}`}>
            {nb(st.me.dmg)}
          </span>
          <Track marks={trackOf(st, 'me')} label={`Ответы: ${st.me.name}`} />
          {open ? (
            <span className="du-state" data-done={st.answer ? 'true' : undefined}>
              {st.answer ? DU.q.meAnswered : st.me.frozen ? DU.reveal.frozen : DU.q.meThinking}
            </span>
          ) : null}
        </div>
      </div>
      <div className="du-side" data-side="other" data-away={away ? 'true' : undefined}>
        {o ? (
          <>
            <span className="du-face-left">
              <LiveChar look={o.look} size={size} face={otherFace} frozen={o.frozen} move="idle" />
            </span>
            <div className="du-side-text">
              <span className="du-name">
                {o.name}
                {away ? <small className="du-away"> · {DU.lobby.away}</small> : null}
              </span>
              <span className="du-score" aria-label={`Очки соперника: ${o.dmg}`}>
                {nb(o.dmg)}
              </span>
              <Track marks={trackOf(st, 'other')} label={DU.board.track(o.name)} />
              {open ? (
                <span className="du-state" data-done={o.answered ? 'true' : undefined} role="status">
                  {o.answered ? DU.q.otherAnswered : DU.q.otherThinking}
                </span>
              ) : null}
            </div>
          </>
        ) : (
          <div className="du-side-text">
            <span className="du-empty">{DU.lobby.waitingOther}</span>
          </div>
        )}
      </div>
    </section>
  );
}

// ─────────────────────────────────────────── the lobby ───────────────────────────────────────────

const QUIET = 2;
function Qr({ url }: { url: string }) {
  const code = useMemo(() => qrCode(url), [url]);
  const outer = code.size + QUIET * 2;
  return (
    <svg className="du-qr" viewBox={`${-QUIET} ${-QUIET} ${outer} ${outer}`} role="img" aria-label="QR-код ссылки" shapeRendering="crispEdges">
      <rect x={-QUIET} y={-QUIET} width={outer} height={outer} fill="#fff" />
      <path d={code.path} fill="#0b121c" />
    </svg>
  );
}

function siteUrl(st: DuelState): string {
  if (typeof window !== 'undefined' && window.location?.origin) return `${window.location.origin}${st.duel.path}`;
  return st.duel.url;
}

function Lobby({ ctl, s, st }: { ctl: DuelController; s: DuelSnapshot; st: DuelState }) {
  const o = st.other;
  const url = siteUrl(st);
  const [copied, setCopied] = useState(false);
  const copy = useCallback(async () => {
    if (await copyText(url)) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }, [url]);
  const expires = st.duel.expires_at ? new Date(st.duel.expires_at).toLocaleString('ru-RU', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' }) : null;
  return (
    <>
      <div className="lp-page du-lobby">
        <p className="du-kicker">
          {st.duel.round > 1 ? `${DU.lobby.round(st.duel.round)} · ${DU.final.match(st.match.me, st.match.other)}` : DU.lobby.title}
        </p>
        <h1 className="lp-h1">{st.duel.title}</h1>
        <p className="lp-sub">{DU.intro.meta(st.duel.q_count, st.duel.time_s)}</p>
        <Board st={st} otherPresent={s.otherPresent} />
        {!o ? (
          <section className="du-invite" aria-label={DU.lobby.invite}>
            <div className="du-invite-text">
              <h2>{DU.lobby.invite}</h2>
              <p>{DU.lobby.inviteText}</p>
              <p className="du-link">
                <a href={url}>{url.replace(/^https?:\/\//, '')}</a>
              </p>
              <button type="button" className="lp-btn lp-btn--second du-copy" onClick={() => void copy()}>
                {copied ? DU.lobby.copied : DU.lobby.copy}
              </button>
              {expires ? <p className="du-note">{DU.lobby.expires(expires)}</p> : null}
            </div>
            <Qr url={url} />
          </section>
        ) : (
          <div className="du-ready-line" role="status">
            <span>
              {st.me.name}: {st.me.ready ? DU.lobby.otherReady : DU.lobby.otherNotReady}
            </span>
            <span>
              {o.name}: {s.otherPresent === false ? DU.lobby.away : o.ready ? DU.lobby.otherReady : DU.lobby.otherNotReady}
            </span>
          </div>
        )}
        {o ? <p className="du-note">{DU.lobby.both}</p> : null}
        {s.error ? (
          <p className="lp-error" role="alert">
            {s.error}
          </p>
        ) : null}
      </div>
      <div className="lp-bar">
        <button type="button" className="lp-btn lp-btn--main" disabled={st.me.ready || s.busy} onClick={() => void ctl.ready()}>
          {st.me.ready ? DU.lobby.readyDone : DU.lobby.ready}
        </button>
      </div>
    </>
  );
}

// ─────────────────────────────────────────── a question and its reveal ───────────────────────────────────────────

function kindOf(q: { kind?: string } | null): 'single' | 'multiple' | 'short' | 'number' {
  return q?.kind === 'multiple' || q?.kind === 'short' || q?.kind === 'number' ? q.kind : 'single';
}

/** The picks of an answer (the own one or a side of the result). */
function picksOf(a: { choice?: number; picks?: number[] } | null | undefined): number[] {
  if (!a) return [];
  if (Array.isArray(a.picks)) return a.picks;
  return typeof a.choice === 'number' ? [a.choice] : [];
}

function Play({ ctl, s, st }: { ctl: DuelController; s: DuelSnapshot; st: DuelState }) {
  const q = st.question;
  const off = s.offsetMs;
  const closed = !!q?.closed_at;
  const soon = !!q?.soon;
  const result = closed && st.result && q && st.result.qi === q.qi ? st.result : null;
  const kind = kindOf(q);
  const T = st.duel.time_s * 1000;
  const opensLocal = q ? Date.parse(q.opens_at) - off : 0;
  const closesLocal = q ? Date.parse(q.closes_at) - off : 0;
  const [openNow, setOpenNow] = useState(() => Date.now() >= opensLocal);
  const [timeUp, setTimeUp] = useState(() => Date.now() >= closesLocal);
  const [marked, setMarked] = useState<number[]>([]);
  const [draft, setDraft] = useState('');
  const bar = useRef<HTMLElement>(null);
  const sec = useRef<HTMLSpanElement>(null);
  const answered = st.answer;
  const isOpen = !!q && !soon && !closed && openNow && !timeUp;
  const canSend = isOpen && !answered && !s.sending;
  const waiting = st.duel.stage === 'wait';
  const now = useTick(250, closed || waiting || soon);

  useEffect(() => {
    if (!q || openNow || closed) return undefined;
    const t = setTimeout(() => setOpenNow(true), Math.max(0, opensLocal - Date.now()));
    return () => clearTimeout(t);
  }, [q, openNow, closed, opensLocal]);

  // the time bar (WAAPI scaleX) and the seconds (a text node)
  useEffect(() => {
    const el = bar.current;
    const sc = sec.current;
    if (!el || !sc || !q) return undefined;
    if (closed || soon) {
      el.getAnimations?.().forEach((a) => a.pause());
      el.style.transform = closed ? 'scaleX(0)' : 'scaleX(1)';
      sc.textContent = closed ? '' : String(st.duel.time_s);
      return undefined;
    }
    if (!openNow) {
      el.style.transform = 'scaleX(1)';
      sc.textContent = String(st.duel.time_s);
      return undefined;
    }
    const left = Math.max(0, closesLocal - Date.now());
    let anim: Animation | null = null;
    if (typeof el.animate === 'function' && !reducedMotion()) {
      anim = el.animate([{ transform: `scaleX(${Math.min(1, left / T)})` }, { transform: 'scaleX(0)' }], { duration: left, easing: 'linear', fill: 'forwards' });
    } else el.style.transform = `scaleX(${Math.min(1, left / T)})`;
    let shown = -1;
    const tick = () => {
      const n = Math.max(0, Math.ceil((closesLocal - Date.now()) / 1000));
      if (n === shown) return;
      shown = n;
      sc.textContent = String(Math.min(n, st.duel.time_s));
      if (n === 0) setTimeUp(true);
    };
    tick();
    const iv = setInterval(tick, 250);
    return () => {
      clearInterval(iv);
      anim?.pause();
    };
  }, [q, closed, soon, openNow, closesLocal, T, st.duel.time_s]);

  // at the phone's zero what is ticked or typed goes by itself (the server takes it up to 1.5 s after the end)
  const autoSent = useRef(false);
  useEffect(() => {
    if (!timeUp || closed || answered || s.sending || autoSent.current) return;
    if (kind === 'multiple' && marked.length > 0) {
      autoSent.current = true;
      void ctl.answer({ picks: marked });
    } else if (kind === 'short' && draft.trim()) {
      autoSent.current = true;
      void ctl.answer({ text: draft });
    } else if (kind === 'number' && padReady(draft)) {
      autoSent.current = true;
      void ctl.answer({ text: draft });
    }
  }, [timeUp, closed, answered, s.sending, kind, marked, draft, ctl]);

  const send = useCallback((input: AnswerInput) => void ctl.answer(input), [ctl]);
  const onPick = useMemo(
    () => (kind === 'multiple' ? (i: number) => setMarked((m) => (m.includes(i) ? m.filter((x) => x !== i) : [...m, i].sort((a, b) => a - b))) : (i: number) => send({ choice: i })),
    [kind, send],
  );

  if (!q) return <div className="lp-page" />;
  const options = q.options ?? [];
  const mine = answered ? picksOf(answered) : s.sending && kind === 'multiple' ? marked : [];
  const theirs = result ? picksOf(result.other) : [];
  const keys = result ? (result.keys ?? (result.key >= 0 ? [result.key] : [])) : [];
  const looks: AnsLook[] = options.map((_, i) =>
    closed ? (keys.includes(i) || mine.includes(i) || theirs.includes(i) ? 'idle' : 'dim') : mine.includes(i) ? 'chosen' : answered || s.sending || closed ? 'dim' : 'idle',
  );
  const marks = options.map((_, i) => (!result ? null : keys.includes(i) ? ('key' as const) : mine.includes(i) ? ('wrong' as const) : null));

  let line: ReactNode;
  if (soon) line = DU.q.soon;
  else if (s.sending) line = <b>{DU.q.sending}</b>;
  else if (closed) line = null;
  else if (answered) line = DU.q.sent;
  else if (timeUp) line = <><b>{DU.q.up}.</b> {DU.q.upWait}</>;
  else if (st.me.frozen) line = DU.q.frozen;
  else if (st.duel.calm) line = DU.q.calm;
  else if (st.me.streak > 0) line = `Серия ${st.me.streak} · очки ${multText(st.me.streak + 1)}`;
  else line = DU.q.fast;

  const other = st.other;
  return (
    <div className="du-play" data-closed={closed ? 'true' : undefined} data-up={timeUp && !closed ? 'true' : undefined}>
      <div className="lp-top du-top">
        <span className="lp-count" aria-label={DU.q.count(q.qi + 1, st.duel.q_count)}>
          {q.qi + 1}/{st.duel.q_count}
        </span>
        <span className="lp-time" aria-hidden="true">
          <i ref={bar} />
        </span>
        <span ref={sec} className="lp-sec" aria-label={closed ? undefined : 'Секунд осталось'} aria-hidden={closed ? true : undefined}>
          {closed ? '' : st.duel.time_s}
        </span>
      </div>
      <div className="du-grid">
        <div className="du-aside">
          <Board st={st} otherPresent={s.otherPresent} compact />
        </div>
        <div className="du-main">
          {soon ? (
            <div className="du-soon" role="status">
              <p>{DU.q.soon}</p>
            </div>
          ) : (
            <>
              <h2 className="lp-q du-q" data-size={questionSize(q.text ?? '')}>
                {q.text}
              </h2>
              {!openNow && !closed ? <Countdown untilMs={opensLocal - Date.now()} /> : null}
              {kind === 'number' || kind === 'short' ? (
                <TypedAnswer kind={kind} q={q} st={st} draft={draft} setDraft={setDraft} canSend={canSend} isOpen={isOpen} sending={s.sending} send={send} waitOpen={!openNow && !closed} />
              ) : (
                <div className="lp-answers du-answers" data-n={options.length} data-wait={!openNow && !closed ? 'true' : 'false'} data-multi={kind === 'multiple' ? '' : undefined}>
                  {kind === 'multiple' && q.multi && !closed ? <p className="lp-multi">{KINDS.multi(q.multi)}</p> : null}
                  {options.map((text, i) => (
                    <div key={i} className="du-opt">
                      <Answer
                        index={i}
                        text={text}
                        disabled={!canSend}
                        look={looks[i]}
                        mark={marks[i]}
                        tick={kind === 'multiple' && !answered && !closed && !s.sending ? marked.includes(i) : undefined}
                        onPick={onPick}
                      />
                      {closed && (mine.includes(i) || theirs.includes(i)) ? (
                        <span className="du-tags">
                          {mine.includes(i) && theirs.includes(i) ? (
                            <span className="du-tag" data-who="both">{DU.reveal.both}</span>
                          ) : mine.includes(i) ? (
                            <span className="du-tag" data-who="me">{DU.reveal.mine}</span>
                          ) : (
                            <span className="du-tag" data-who="other">{other ? DU.reveal.theirs(other.name) : ''}</span>
                          )}
                        </span>
                      ) : null}
                    </div>
                  ))}
                  {kind === 'multiple' && !closed ? (
                    <button type="button" className="lp-btn lp-btn--main lp-send" disabled={!canSend || marked.length === 0} onClick={() => send({ picks: marked })}>
                      {answered ? KINDS.sentPicks(mine.length) : KINDS.send}
                    </button>
                  ) : null}
                </div>
              )}
            </>
          )}
          {!closed ? (
            <p className="du-line" role="status" aria-live="polite">
              {line}
            </p>
          ) : null}
          {s.error ? (
            <p className="lp-error" role="alert">
              {s.error}
            </p>
          ) : null}
          {/* the wait for a seat away takes the reveal's place: «Дальше» means nothing while one seat is gone */}
          {waiting ? <Wait st={st} now={now} offsetMs={off} /> : result ? <Reveal ctl={ctl} st={st} busy={s.busy} now={now} offsetMs={off} /> : null}
        </div>
      </div>
    </div>
  );
}

function TypedAnswer(props: {
  kind: 'short' | 'number';
  q: NonNullable<DuelState['question']>;
  st: DuelState;
  draft: string;
  setDraft: (v: string) => void;
  canSend: boolean;
  isOpen: boolean;
  sending: boolean;
  send: (a: AnswerInput) => void;
  waitOpen: boolean;
}) {
  const { kind, q, st, draft, setDraft, canSend, isOpen, sending, send, waitOpen } = props;
  const answered = st.answer;
  const closed = !!q.closed_at;
  if (answered || closed) {
    return (
      <div className="lp-textans du-typed" data-wait="false">
        <p className="lp-textans__sent">
          {answered?.typed ? (kind === 'number' ? KINDS.sentNumber(typedText(answered.typed, q.unit ?? null)) : KINDS.sentText(answered.typed)) : closed ? DU.reveal.none : ''}
        </p>
      </div>
    );
  }
  if (kind === 'number') {
    return (
      <div className="lp-textans lp-numans" data-wait={waitOpen ? 'true' : 'false'}>
        <NumberPad value={draft} unit={q.unit ?? null} enabled={canSend} onChange={setDraft} onSend={() => send({ text: draft })} />
      </div>
    );
  }
  return (
    <form
      className="lp-textans"
      data-wait={waitOpen ? 'true' : 'false'}
      onSubmit={(e) => {
        e.preventDefault();
        if (canSend && draft.trim()) send({ text: draft });
      }}
    >
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
        disabled={!isOpen || sending}
        onChange={(e) => setDraft(e.target.value)}
      />
      <button type="submit" className="lp-btn lp-btn--main lp-send" disabled={!canSend || !draft.trim()}>
        {KINDS.send}
      </button>
    </form>
  );
}

/** «Верно · +98», «Частично · +49», «Неверно · во льду», «Без ответа». */
function verdict(side: DuelSide | null, calm: boolean): { word: string; tone: 'ok' | 'part' | 'bad' | 'none'; points: number } {
  if (!side || side.none) return { word: DU.reveal.none, tone: 'none', points: 0 };
  if (side.thawed) return { word: DU.reveal.thawed, tone: 'ok', points: 0 };
  if (side.correct) return { word: DU.reveal.right, tone: 'ok', points: side.dmg };
  if (side.share > 0) return { word: DU.reveal.partial, tone: 'part', points: side.dmg };
  return { word: calm ? DU.reveal.wrong : `${DU.reveal.wrong} · ${DU.reveal.frozen}`, tone: 'bad', points: 0 };
}

function typedLine(side: DuelSide | null, kind: 'short' | 'number', unit: string | null): string {
  if (!side || side.none) return DU.reveal.noAnswer;
  if (side.masked) return DU.reveal.masked;
  if (!side.typed) return DU.reveal.noAnswer;
  return kind === 'number' ? typedText(side.typed, unit) : `«${side.typed}»`;
}

function Reveal({ ctl, st, busy, now, offsetMs }: { ctl: DuelController; st: DuelState; busy: boolean; now: number; offsetMs: number }) {
  const r = st.result!;
  const q = st.question!;
  const kind = kindOf(q);
  const calm = !!st.duel.calm;
  const me = verdict(r.me, calm);
  const other = st.other ? verdict(r.other, calm) : null;
  const last = q.qi >= st.duel.q_count - 1;
  const until = q.reveal_until ? Date.parse(q.reveal_until) - offsetMs : null;
  const left = until !== null ? Math.max(0, Math.ceil((until - now) / 1000)) : null;
  let key: string | null = null;
  if (kind === 'short') key = `${KINDS.rightText}: ${(r.forms ?? []).join(', ')}`;
  else if (kind === 'number') key = `${KINDS.rightText}: ${numberAnswer(r.forms, r.tolerance, r.unit ?? q.unit ?? null)}`;
  else {
    const keys = r.keys ?? (r.key >= 0 ? [r.key] : []);
    key = `${keys.length > 1 ? DU.reveal.rightMany : DU.reveal.rightText}: ${keys.map((k) => `${OPTION_STYLES[k]?.letter ?? ''}${NBSP}·${NBSP}${q.options?.[k] ?? ''}`).join(', ')}`;
  }
  const nextRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const t = setTimeout(() => nextRef.current?.focus({ preventScroll: true }), 400);
    return () => clearTimeout(t);
  }, []);
  return (
    <section className="du-reveal" aria-labelledby="du-reveal-h">
      <h2 id="du-reveal-h" className="lp-sr">
        Итог вопроса
      </h2>
      <div className="du-verdicts">
        <div className="du-verdict" data-tone={me.tone} role="status">
          <span className="du-verdict-who">{DU.q.me}</span>
          <b>{me.word}</b>
          {me.points > 0 ? <span className="du-plus">+{nb(me.points)}</span> : null}
          {kind === 'short' || kind === 'number' ? <span className="du-typed-line">{typedLine(r.me, kind, q.unit ?? null)}</span> : null}
        </div>
        {other && st.other ? (
          <div className="du-verdict" data-tone={other.tone}>
            <span className="du-verdict-who">{st.other.name}</span>
            <b>{other.word}</b>
            {other.points > 0 ? <span className="du-plus">+{nb(other.points)}</span> : null}
            {kind === 'short' || kind === 'number' ? <span className="du-typed-line">{typedLine(r.other, kind, q.unit ?? null)}</span> : null}
          </div>
        ) : null}
      </div>
      {key && !(r.me?.correct && kind !== 'short' && kind !== 'number') ? <p className="du-key">{key}</p> : null}
      {r.explanation ? (
        <div className="du-explain">
          <b>{DU.reveal.explanation}</b>
          <p>{r.explanation}</p>
        </div>
      ) : null}
      <div className="du-reveal-bar">
        <button ref={nextRef} type="button" className="lp-btn lp-btn--main du-next" disabled={busy || st.me.next} onClick={() => void ctl.next()}>
          {st.me.next ? DU.reveal.waitOther : last ? DU.reveal.final : DU.reveal.next}
        </button>
        <span className="du-reveal-note" aria-live="polite">
          {st.other?.next && !st.me.next ? DU.reveal.otherNext : left !== null ? DU.reveal.auto(left) : ''}
        </span>
      </div>
    </section>
  );
}

function Wait({ st, now, offsetMs }: { st: DuelState; now: number; offsetMs: number }) {
  const until = st.duel.wait_until ? Date.parse(st.duel.wait_until) - offsetMs : now;
  return (
    <section className="du-wait" role="status" aria-live="polite">
      <h2>{DU.wait.title}</h2>
      <p>{st.duel.wait_open ? DU.wait.openText : DU.wait.text}</p>
      <p className="du-wait-clock">{DU.wait.left(clockText(until - now))}</p>
    </section>
  );
}

// ─────────────────────────────────────────── the final ───────────────────────────────────────────

function Card({ name, look, dmg, right, of, won, me }: { name: string; look: Look; dmg: number; right: number; of: number; won: boolean; me: boolean }) {
  return (
    <div className="du-card" data-won={won ? 'true' : undefined} data-me={me ? 'true' : undefined}>
      <span className={me ? undefined : 'du-face-left'}>
        <LiveChar look={look} size={86} face={won ? 'happy' : 'idle'} move={won && !reducedMotion() ? 'bounce' : 'idle'} />
      </span>
      <span className="du-card-name">
        {name}
        {me ? <small> · {DU.q.me}</small> : null}
      </span>
      <span className="du-card-points">{nb(dmg)}</span>
      <span className="du-card-sub">
        {DU.final.points} · {`${right}${NBSP}из${NBSP}${of}`} {DU.final.right}
      </span>
    </div>
  );
}

function Final({ ctl, s, st, exitHref }: { ctl: DuelController; s: DuelSnapshot; st: DuelState; exitHref: string }) {
  const f = st.final!;
  const o = st.other;
  const asked = st.track.length;
  let title: string;
  if (f.reason === 'expired') title = DU.final.expired;
  else if (f.winner === 'me') title = DU.final.won;
  else if (f.winner === 'other') title = DU.final.lost;
  else if (f.reason === 'gone') title = DU.final.none;
  else title = DU.final.draw;
  const reason =
    f.reason === 'left' ? (f.winner === 'me' ? DU.final.reason.leftWon : DU.final.reason.leftLost) : f.reason === 'gone' ? DU.final.reason.gone : f.reason === 'expired' ? DU.final.reason.expired : null;
  const rm = st.rematch;
  const showMatch = st.duel.round > 1 || !!rm?.code;
  return (
    <>
      <div className="lp-page du-final">
        <p className="du-kicker">{st.duel.round > 1 ? `${DU.lobby.round(st.duel.round)} · ${st.duel.title}` : st.duel.title}</p>
        <h1 className="lp-h1 du-final-h">{title}</h1>
        {reason ? <p className="lp-sub">{reason}</p> : null}
        {f.reason !== 'expired' ? (
          <div className="du-cards">
            <Card name={st.me.name} look={st.me.look} dmg={st.me.dmg} right={st.me.right} of={asked} won={f.winner === 'me'} me />
            {o ? <Card name={o.name} look={o.look} dmg={o.dmg} right={o.right} of={asked} won={f.winner === 'other'} me={false} /> : null}
          </div>
        ) : null}
        {showMatch ? (
          <p className="du-match">
            {DU.final.match(st.match.me, st.match.other)}
            {st.match.draws > 0 ? ` · ${DU.final.draws(st.match.draws)}` : ''}
          </p>
        ) : null}
        {rm?.code ? (
          <p className="du-next-link">
            {DU.final.next}: <Link to={`/d/${rm.code}`}>{`/d/${rm.code}`}</Link>
          </p>
        ) : rm && !rm.possible ? (
          <p className="du-note">{DU.final.againLast}</p>
        ) : rm?.other && !rm.me ? (
          <p className="du-note" role="status">
            {DU.final.againOther}
          </p>
        ) : null}
        {s.error ? (
          <p className="lp-error" role="alert">
            {s.error}
          </p>
        ) : null}
      </div>
      <div className="lp-bar du-final-bar">
        {f.reason !== 'expired' ? (
          <button type="button" className="lp-btn lp-btn--main" onClick={() => void ctl.openReview()}>
            {DU.final.review}
          </button>
        ) : null}
        {rm && rm.possible ? (
          <button type="button" className="lp-btn lp-btn--second" disabled={rm.me || s.busy || !!s.moving} onClick={() => void ctl.again()}>
            {s.moving ? DU.final.moving : rm.me ? DU.final.againWait : DU.final.again}
          </button>
        ) : null}
        <Link className="lp-btn lp-btn--quiet" to={exitHref}>
          {DU.final.exit}
        </Link>
      </div>
    </>
  );
}

// ─────────────────────────────────────────── the review ───────────────────────────────────────────

const PRACTICE = {
  note: 'Неверные и пропущенные вопросы вернутся в тренировку экзамена. Meldy будет повторять их, пока вы не запомните.',
  busy: 'Сохраняем…',
  done: (n: number) => `Готово: ${n} в тренировке экзамена.`,
  open: 'Открыть экзамен',
  signIn: 'Ошибки сохраняются в аккаунте. Войдите, и они вернутся в тренировку.',
  signInGo: 'Войти и тренировать',
  none: 'Ошибок нет: все ответы верные.',
};

function sideMark(item: DuelReviewItem, i: number, other: DuelSide | null): { key: boolean; mine: boolean; theirs: boolean } {
  const keys = item.keys ?? (item.key >= 0 ? [item.key] : []);
  const mine = item.picks ?? (item.choice !== null && item.choice !== undefined ? [item.choice] : []);
  const theirs = picksOf(other);
  return { key: keys.includes(i), mine: mine.includes(i), theirs: theirs.includes(i) };
}

function badge(correct: boolean, none: boolean, share: number): string {
  if (correct) return DU.reveal.right;
  if (none) return DU.reveal.none;
  return share > 0 ? DU.reveal.partial : DU.reveal.wrong;
}

function ReviewScreen({ ctl, s, st, signInHref }: { ctl: DuelController; s: DuelSnapshot; st: DuelState; signInHref: string }) {
  const items = s.review?.items ?? null;
  const right = items ? items.filter((x) => x.correct).length : 0;
  const mistakes = items ? items.filter((x) => !x.correct).length : 0;
  const otherName = st.other?.name ?? '';
  const p = s.practice;
  return (
    <>
      <div className="lp-page du-review">
        <p className="du-kicker">{st.duel.title}</p>
        <h1 className="lp-h1">{DU.review.title}</h1>
        {items ? <p className="lp-sub">{DU.review.lead(right, items.length)}</p> : null}
        {!items && !s.reviewError ? (
          <p className="lp-sub" role="status">
            Загружаем разбор…
          </p>
        ) : null}
        {s.reviewError ? (
          <p className="lp-error" role="alert">
            {s.reviewError}
          </p>
        ) : null}
        {items?.map((item) => {
          const kind = kindOf(item);
          return (
            <article key={item.qi} className="du-rv">
              <header>
                <span className="du-rv-n">{item.qi + 1}</span>
                <span className="du-rv-badge" data-tone={item.correct ? 'ok' : item.none ? 'none' : (item.share ?? 0) > 0 ? 'part' : 'bad'}>
                  {DU.q.me}: {badge(item.correct, item.none, item.share ?? 0).toLowerCase()}
                </span>
                {item.other ? (
                  <span className="du-rv-badge" data-tone={item.other.correct ? 'ok' : item.other.none ? 'none' : item.other.share > 0 ? 'part' : 'bad'}>
                    {otherName}: {badge(item.other.correct, item.other.none, item.other.share).toLowerCase()}
                  </span>
                ) : null}
              </header>
              <h2 className="du-rv-q">{item.text}</h2>
              {kind === 'short' || kind === 'number' ? (
                <dl className="du-rv-typed">
                  <div>
                    <dt>{KINDS.rightText}</dt>
                    <dd>{kind === 'number' ? numberAnswer(item.forms, item.tolerance, item.unit ?? null) : (item.forms ?? []).join(', ')}</dd>
                  </div>
                  <div>
                    <dt>{DU.review.yours}</dt>
                    <dd>{item.typed ? (kind === 'number' ? typedText(item.typed, item.unit ?? null) : `«${item.typed}»`) : DU.reveal.noAnswer}</dd>
                  </div>
                  <div>
                    <dt>{DU.review.theirs(otherName)}</dt>
                    <dd>{typedLine(item.other, kind, item.unit ?? null)}</dd>
                  </div>
                </dl>
              ) : (
                <div className="du-rv-opts">
                  {item.options.map((text, i) => {
                    const m = sideMark(item, i, item.other);
                    return (
                      <div key={i} className="du-rv-opt" data-key={m.key ? 'true' : 'false'} data-mine={m.mine ? 'true' : 'false'}>
                        <span className="lp-ans__l" aria-hidden="true">
                          {OPTION_STYLES[i]?.letter}
                        </span>
                        <span className="du-rv-text">
                          <span className="lp-sr">{OPTION_STYLES[i]?.letter}: </span>
                          {text}
                        </span>
                        <span className="du-rv-tags">
                          {m.key ? <small data-who="key">{DU.reveal.key}</small> : null}
                          {m.mine ? <small data-who="me">{DU.reveal.mine}</small> : null}
                          {m.theirs ? <small data-who="other">{DU.reveal.theirs(otherName)}</small> : null}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
              {item.explanation ? (
                <div className="du-explain">
                  <b>{DU.reveal.explanation}</b>
                  <p>{item.explanation}</p>
                </div>
              ) : null}
            </article>
          );
        })}
        {items ? (
          <section className="du-practice" aria-label={DU.review.practice}>
            <h2>{DU.review.practice}</h2>
            {mistakes === 0 ? (
              <p>{PRACTICE.none}</p>
            ) : p.status === 'done' ? (
              <p role="status">
                {PRACTICE.done(p.saved)} <Link to={`/exams/c/${p.containerId}`}>{PRACTICE.open}</Link>
              </p>
            ) : p.status === 'signin' ? (
              <>
                <p>{PRACTICE.signIn}</p>
                <Link className="lp-btn lp-btn--second" to={signInHref}>
                  {PRACTICE.signInGo}
                </Link>
              </>
            ) : p.status === 'refused' ? (
              <p role="alert">{p.text}</p>
            ) : (
              <>
                <p>{PRACTICE.note}</p>
                <button type="button" className="lp-btn lp-btn--second" disabled={p.status === 'busy'} onClick={() => void ctl.practiceMistakes()}>
                  {p.status === 'busy' ? PRACTICE.busy : DU.review.practice}
                </button>
              </>
            )}
          </section>
        ) : null}
      </div>
      <div className="lp-bar">
        <button type="button" className="lp-btn lp-btn--main" onClick={() => ctl.closeReview()}>
          {DU.review.back}
        </button>
      </div>
    </>
  );
}

