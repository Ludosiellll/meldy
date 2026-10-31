/**
 * The player's screens of «Соревнование в своё время» (/s/<code>, docs/live/CHALLENGE.md): the controller's snapshot
 * picks the screen. The battle's look without the arena — the phone's own boss and its HP, the timer bar, the A–Е
 * buttons, the keypad of a number, the result sheet — with what a run alone needs: the explanation after each question,
 * «Дальше» when the person is ready, the final with the place, the table by the link, the review and «Тренировать
 * ошибки». On a computer the same column, centred.
 *
 * Smoothness (the player's rule): the time bar and the HP bar move by transform only; the seconds are a text node.
 */
import { memo, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { Builder } from '../live/player/Builder';
import { ReviewScreen } from '../live/player/ReviewScreen';
import { Answer, Countdown, HpBar, type AnsLook } from '../live/player/Battle';
import { NumberPad } from '../live/player/NumberPad';
import { LiveBoss, LiveChar, reducedMotion } from '../live/player/art';
import { KINDS, multText, nb } from '../live/player/copy';
import { OPTION_STYLES, questionSize } from '../live/player/options';
import { numberAnswer, padReady, typedText } from '../../lib/live/numbers';
import type { AnswerInput } from '../../lib/live/types';
import type { BoardRow, RunState } from '../../lib/challenge/types';
import type { ChallengeController, ChallengeSnapshot } from './controller';
import { CH, NBSP, dateText, pointsText, timeText } from './copy';
import '../live/player/player.css';
import './challenge.css';

export interface ChallengeAppProps {
  ctl: ChallengeController;
  /** The sign-in page with the way back to the review and «Тренировать ошибки». */
  signInHref: string;
}

export function ChallengeApp({ ctl, signInHref }: ChallengeAppProps) {
  const s = useSyncExternalStore(ctl.subscribe, ctl.getSnapshot, ctl.getSnapshot);
  const title = s.info ? `${s.info.title} · ${CH.name}` : CH.name;
  useEffect(() => {
    document.title = `${title} — Meldy`;
  }, [title]);

  let screen: ReactNode;
  if (s.step === 'loading')
    screen = (
      <div className="lp-page lc-center">
        <LiveBoss size={110} phase={0} />
        <p className="lp-sub" role="status">
          Открываем соревнование…
        </p>
      </div>
    );
  else if (s.step === 'gone')
    screen = (
      <div className="lp-page">
        <h1 className="lp-h1">{s.gone?.title}</h1>
        <p className="lp-sub" role="alert">
          {s.gone?.text}
        </p>
      </div>
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
        backText={CH.builder.back}
      />
    );
  else if (s.step === 'ready' && s.state) screen = <Ready ctl={ctl} s={s} st={s.state} />;
  else if (s.step === 'question' && s.state?.question) screen = <QuestionScreen key={s.state.question.qi} ctl={ctl} s={s} st={s.state} />;
  else if (s.step === 'final' && s.state) screen = <Final ctl={ctl} st={s.state} top={s.board?.top ?? null} />;
  else if (s.step === 'board') screen = <BoardScreen ctl={ctl} s={s} />;
  else if (s.step === 'review')
    screen = (
      <ReviewScreen
        ctl={ctl}
        review={s.review}
        error={s.reviewError}
        standalone={false}
        back="final"
        practice={s.practice}
        signInHref={signInHref}
        lead={CH.review.lead}
        backText={CH.review.back}
      />
    );
  else screen = <div className="lp-page" />;

  return (
    <main className="lp lc" data-step={s.step} aria-label={CH.name}>
      <div className="lc-col">{screen}</div>
    </main>
  );
}

// ─────────────────────────────────────────── the intro ───────────────────────────────────────────

function Rules({ calm }: { calm: boolean }) {
  return (
    <ul className="lc-rules">
      <li>{calm ? CH.intro.calm : CH.intro.speed}</li>
      <li>{calm ? CH.intro.calmBoss : CH.intro.boss}</li>
      <li>{CH.intro.once}</li>
    </ul>
  );
}

function Intro({ ctl, s }: { ctl: ChallengeController; s: ChallengeSnapshot }) {
  const info = s.info!;
  const over = info.state === 'over';
  return (
    <>
      <div className="lp-page">
        <p className="lc-kicker">{CH.intro.kicker}</p>
        <h1 className="lp-h1">{info.title}</h1>
        <p className="lp-sub">{CH.intro.meta(info.q_count, info.time_s)}</p>
        <div className="lc-stage" aria-hidden="true">
          <LiveBoss size={120} phase={over ? 2 : 0} move={over ? 'none' : 'idle'} />
          <LiveChar look={s.look} size={84} face="happy" className="lc-stage-me" />
        </div>
        {over ? (
          <div className="lp-card lc-over" role="status">
            <b>{CH.intro.overTitle}</b>
            <span>{info.over === 'closed' ? CH.intro.overClosed : CH.intro.overDeadline}</span>
          </div>
        ) : (
          <>
            <p className="lc-until">{CH.intro.until(dateText(info.deadline))}</p>
            <div className="lp-card">
              <Rules calm={!!info.calm} />
            </div>
            <p className="lc-played">{CH.intro.played(info.finished)}</p>
          </>
        )}
        {s.error ? (
          <p className="lp-error" role="alert">
            {s.error}
          </p>
        ) : null}
      </div>
      <div className="lp-bar">
        {over ? (
          <button type="button" className="lp-btn lp-btn--main" onClick={() => void ctl.openBoard('intro')}>
            {CH.intro.board}
          </button>
        ) : (
          <>
            <button type="button" className="lp-btn lp-btn--main" onClick={() => ctl.begin()}>
              {CH.intro.start}
            </button>
            <button type="button" className="lp-btn lp-btn--quiet" onClick={() => void ctl.openBoard('intro')}>
              {CH.intro.board}
            </button>
          </>
        )}
      </div>
    </>
  );
}

function Ready({ ctl, s, st }: { ctl: ChallengeController; s: ChallengeSnapshot; st: RunState }) {
  const [one, two] = CH.ready.lines(st.challenge.q_count, st.challenge.time_s);
  return (
    <>
      <div className="lp-page">
        <h1 className="lp-h1">{CH.ready.title}</h1>
        <p className="lp-sub">{st.challenge.title}</p>
        <div className="lc-stage lc-stage--duel" aria-hidden="true">
          <LiveChar look={st.run.look} size={110} face="happy" />
          <span className="lc-vs">×</span>
          <LiveBoss size={120} phase={0} />
        </div>
        <div className="lp-card">
          <p className="lc-p">{one}</p>
          <p className="lc-p">{two}</p>
          <p className="lc-p">{st.challenge.calm ? CH.intro.calm : CH.intro.speed}</p>
        </div>
        {s.error ? (
          <p className="lp-error" role="alert">
            {s.error}
          </p>
        ) : null}
      </div>
      <div className="lp-bar">
        <button type="button" className="lp-btn lp-btn--main" disabled={s.busy} onClick={() => void ctl.next()}>
          {CH.ready.go}
        </button>
        <button type="button" className="lp-btn lp-btn--quiet" onClick={() => void ctl.openBoard('ready')}>
          {CH.ready.board}
        </button>
      </div>
    </>
  );
}

// ─────────────────────────────────────────── a question ───────────────────────────────────────────

/** Which kind the question asks for. */
function kindOf(q: { kind?: string }): 'single' | 'multiple' | 'short' | 'number' {
  return q.kind === 'multiple' || q.kind === 'short' || q.kind === 'number' ? q.kind : 'single';
}

function QuestionScreen({ ctl, s, st }: { ctl: ChallengeController; s: ChallengeSnapshot; st: RunState }) {
  const q = st.question!;
  const result = st.result && st.result.qi === q.qi ? st.result : null;
  const kind = kindOf(q);
  const T = st.challenge.time_s * 1000;
  const opensLocal = Date.parse(q.opens_at) - s.offsetMs;
  const closesLocal = Date.parse(q.closes_at) - s.offsetMs;
  const [openNow, setOpenNow] = useState(() => Date.now() >= opensLocal);
  const [timeUp, setTimeUp] = useState(() => Date.now() >= closesLocal);
  const [marked, setMarked] = useState<number[]>([]);
  const [draft, setDraft] = useState('');
  const bar = useRef<HTMLElement>(null);
  const sec = useRef<HTMLSpanElement>(null);
  const closed = !!result;
  const isOpen = !closed && openNow && !timeUp;
  const answered = st.answer;

  useEffect(() => {
    if (openNow || closed) return undefined;
    const t = setTimeout(() => setOpenNow(true), Math.max(0, opensLocal - Date.now()));
    return () => clearTimeout(t);
  }, [openNow, closed, opensLocal]);

  // the time bar (WAAPI scaleX) and the seconds (a text node)
  useEffect(() => {
    const el = bar.current;
    const sc = sec.current;
    if (!el || !sc) return undefined;
    if (closed) {
      el.getAnimations?.().forEach((a) => a.pause());
      sc.textContent = '';
      return undefined;
    }
    if (!openNow) {
      el.style.transform = 'scaleX(1)';
      sc.textContent = String(st.challenge.time_s);
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
      sc.textContent = String(Math.min(n, st.challenge.time_s));
      if (n === 0) setTimeUp(true);
    };
    tick();
    const iv = setInterval(tick, 250);
    return () => {
      clearInterval(iv);
      anim?.pause();
    };
  }, [closed, openNow, closesLocal, T, st.challenge.time_s]);

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

  // the hit lands: the boss shakes and the HP bar moves from where it was
  const [impact, setImpact] = useState(false);
  const [flash, setFlash] = useState(0);
  useEffect(() => {
    if (!result) return undefined;
    const t = setTimeout(() => {
      setImpact(true);
      if (result.dmg > 0) setFlash((f) => f + 1);
    }, reducedMotion() ? 0 : 420);
    return () => clearTimeout(t);
  }, [result]);
  const boss = st.run.boss;
  // the boss fell before this question (or this result came without the HP before it): it stays down, no animation
  const downBefore = boss.defeated && (!result || s.hpFrom === null || s.hpFrom === 0);
  const hpShown = result && s.hpFrom !== null && !impact ? s.hpFrom : boss.hp;
  const k = boss.hp_max > 0 ? hpShown / boss.hp_max : 0;

  const mine = answered ? (answered.picks ?? (answered.choice !== undefined ? [answered.choice] : [])) : s.sending && kind === 'multiple' ? marked : [];
  const keys = result ? (result.keys ?? [result.key]) : [];
  const looks: AnsLook[] = q.options.map((_, i) => (closed ? (keys.includes(i) || mine.includes(i) ? 'idle' : 'dim') : mine.includes(i) ? 'chosen' : answered || s.sending ? 'dim' : 'idle'));
  const marks = q.options.map((_, i) => (!result ? null : keys.includes(i) ? ('key' as const) : mine.includes(i) ? ('wrong' as const) : null));
  const canSend = isOpen && !answered && !s.sending;

  const calm = !!st.challenge.calm;
  let line: ReactNode;
  if (s.sending) line = <b>{CH.q.sending}</b>;
  else if (timeUp && !closed) line = <><b>{CH.q.up}.</b> {CH.q.upWait}</>;
  else if (st.run.frozen && !closed) line = CH.q.frozen;
  else if (calm) line = CH.q.calm;
  else if (st.run.streak > 0) line = `${CH.q.streak(st.run.streak)} · очки ${multText(st.run.streak + 1)}`;
  else line = CH.q.fast;
  const rule = calm ? null : q.phase === 1 ? CH.q.angry : q.phase === 2 ? CH.q.last : null;

  return (
    <div className="lp-battle lc-battle" data-up={timeUp && !closed ? 'true' : undefined}>
      <div className="lp-top">
        <span className="lp-count" aria-label={CH.q.count(q.qi + 1, st.challenge.q_count)}>
          {q.qi + 1}/{st.challenge.q_count}
        </span>
        <span className="lp-time" aria-hidden="true">
          <i ref={bar} />
        </span>
        <span ref={sec} className="lp-sec" aria-label={closed ? undefined : 'Секунд осталось'} aria-hidden={closed ? true : undefined}>
          {closed ? '' : st.challenge.time_s}
        </span>
      </div>
      <div className="lp-boss" data-down={downBefore ? 'true' : undefined}>
        <LiveBoss
          size={58}
          phase={boss.phase}
          hurt={!!result && impact && result.dmg > 0 && !downBefore}
          move={downBefore ? 'none' : result && impact && result.dmg > 0 ? (boss.defeated ? 'fall' : 'hit') : 'idle'}
          flashKey={flash}
          className={downBefore ? 'lc-boss-down' : undefined}
        />
        <div className="lp-hp">
          <div className="lp-hp-row">
            <span>{CH.q.boss}</span>
            <span>
              {downBefore ? (
                CH.q.down
              ) : (
                <>
                  {Math.max(0, Math.round(k * 100))}
                  {NBSP}%
                </>
              )}
            </span>
          </div>
          <HpBar k={k} />
        </div>
        <span className="lc-points" aria-label={`Ваши очки: ${st.run.dmg}`}>
          {nb(st.run.dmg)}
        </span>
      </div>
      {rule && !closed ? <p className="lp-rule">{rule}</p> : null}
      <div className="lp-mid">
        <h2 className="lp-q" data-size={questionSize(q.text)}>
          {q.text}
        </h2>
        {!openNow && !closed ? <Countdown untilMs={opensLocal - Date.now()} /> : null}
      </div>
      <div className="lp-me">
        <LiveChar look={st.run.look} size={52} frozen={st.run.frozen && !closed} face={st.run.frozen && !closed ? 'frozen' : answered ? 'happy' : 'idle'} move="idle" />
        <div className="lp-me-text" data-tone={st.run.frozen && !closed ? 'ice' : undefined} role="status" aria-live="polite">
          {line}
        </div>
      </div>
      {s.error ? (
        <p className="lp-error lc-qerror" role="alert">
          {s.error}
        </p>
      ) : null}
      {kind === 'number' ? (
        <div className="lp-textans lp-numans" data-wait={!openNow && !closed ? 'true' : 'false'}>
          {answered || closed ? (
            <p className="lp-textans__sent" data-mark={result ? (result.correct ? 'key' : 'wrong') : undefined}>
              {answered?.typed ? KINDS.sentNumber(typedText(answered.typed, q.unit ?? null)) : result ? `${KINDS.rightText}: ${numberAnswer(result.forms, result.tolerance, result.unit ?? q.unit ?? null)}` : ''}
            </p>
          ) : (
            <NumberPad value={draft} unit={q.unit ?? null} enabled={canSend} onChange={setDraft} onSend={() => send({ text: draft })} />
          )}
        </div>
      ) : kind === 'short' ? (
        <form
          className="lp-textans"
          data-wait={!openNow && !closed ? 'true' : 'false'}
          onSubmit={(e) => {
            e.preventDefault();
            if (canSend && draft.trim()) send({ text: draft });
          }}
        >
          {answered || closed ? (
            <p className="lp-textans__sent" data-mark={result ? (result.correct ? 'key' : 'wrong') : undefined}>
              {answered?.typed ? KINDS.sentText(answered.typed) : result?.forms?.[0] ? `${KINDS.rightText}: ${result.forms[0]}` : ''}
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
                disabled={!isOpen || s.sending}
                onChange={(e) => setDraft(e.target.value)}
              />
              <button type="submit" className="lp-btn lp-btn--main lp-send" disabled={!canSend || !draft.trim()}>
                {KINDS.send}
              </button>
            </>
          )}
        </form>
      ) : (
        <div className="lp-answers" data-n={q.options.length} data-wait={!openNow && !closed ? 'true' : 'false'} data-multi={kind === 'multiple' ? '' : undefined}>
          {kind === 'multiple' && q.multi && !closed ? <p className="lp-multi">{KINDS.multi(q.multi)}</p> : null}
          {q.options.map((text, i) => (
            <Answer
              key={i}
              index={i}
              text={text}
              disabled={!canSend}
              look={looks[i]}
              mark={marks[i]}
              tick={kind === 'multiple' && !answered && !closed && !s.sending ? marked.includes(i) : undefined}
              onPick={onPick}
            />
          ))}
          {kind === 'multiple' && !closed ? (
            <button type="button" className="lp-btn lp-btn--main lp-send" disabled={!canSend || marked.length === 0} onClick={() => send({ picks: marked })}>
              {answered ? KINDS.sentPicks(mine.length) : KINDS.send}
            </button>
          ) : null}
        </div>
      )}
      {result ? <Sheet ctl={ctl} st={st} busy={s.busy} felled={boss.defeated && s.hpFrom !== null && s.hpFrom > 0} /> : null}
    </div>
  );
}

/** «Верный ответ: Б · текст» / the accepted forms / the number with its tolerance. */
function keyLine(st: RunState): { label: string; text: string } {
  const r = st.result!;
  const q = st.question!;
  const kind = kindOf(q);
  if (kind === 'short') return { label: KINDS.rightText, text: (r.forms ?? []).join(', ') };
  if (kind === 'number') return { label: KINDS.rightText, text: numberAnswer(r.forms, r.tolerance, r.unit ?? q.unit ?? null) };
  const keys = r.keys ?? [r.key];
  return {
    label: keys.length > 1 ? KINDS.rightMany : 'Верный ответ',
    text: keys.map((key) => `${OPTION_STYLES[key]?.letter ?? ''}${NBSP}·${NBSP}${q.options[key] ?? ''}`).join(', '),
  };
}

const Sheet = memo(function Sheet({ ctl, st, busy, felled }: { ctl: ChallengeController; st: RunState; busy: boolean; felled: boolean }) {
  const r = st.result!;
  const calm = !!st.challenge.calm;
  const partial = !r.correct && !r.none && (r.share ?? 0) > 0;
  const hit = (r.correct && !r.thawed) || (partial && r.dmg > 0);
  const last = st.run.finished;
  const key = keyLine(st);
  const typed = st.answer?.typed ?? null;
  const kind = kindOf(st.question!);
  const nextRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const t = setTimeout(() => nextRef.current?.focus({ preventScroll: true }), 500);
    return () => clearTimeout(t);
  }, []);
  let title: string;
  if (r.thawed) title = CH.sheet.thawed;
  else if (r.correct) title = CH.sheet.right;
  else if (partial) title = CH.sheet.partial;
  else if (r.none) title = CH.sheet.none;
  else title = CH.sheet.wrong;
  const lines: string[] = [];
  if (r.thawed) lines.push(CH.sheet.thawedLine);
  else if (!r.correct && !partial) lines.push(calm ? CH.sheet.calmMiss : r.frozen ? (st.run.frozen && r.none ? CH.sheet.frozenStill : CH.sheet.frozenNow) : r.none ? CH.sheet.noneLine : CH.sheet.calmMiss);
  // the boss down: said once, on the hit that felled it; no phase news after that
  const down = st.run.boss.defeated;
  if (r.healed > 0) lines.push(CH.sheet.healed(r.healed));
  if (felled) lines.push(CH.sheet.defeated);
  else if (!down && r.phase_changed === 1) lines.push(calm ? CH.sheet.phase1Calm : CH.sheet.phase1);
  else if (!down && r.phase_changed === 2) lines.push(CH.sheet.phase2);
  return (
    <section className={`lp-sheet lc-sheet ${hit || r.thawed ? 'lp-sheet--ok' : 'lp-sheet--bad'}`} aria-labelledby="lc-sheet-title">
      <div className="lc-sheet-scroll">
        <div className="lc-sheet-head">
          <div>
            <h2 id="lc-sheet-title" role="status">
              {title}
            </h2>
            {hit ? (
              <div className="lc-sheet-points">
                <span className="lp-big">{CH.sheet.points(r.dmg)}</span>
                <span>{CH.sheet.pointsWord(r.dmg)}</span>
              </div>
            ) : null}
          </div>
          <div className="lc-sheet-me" aria-hidden="true">
            <LiveChar look={st.run.look} size={84} face={hit || r.thawed ? 'happy' : r.frozen ? 'frozen' : 'hurt'} frozen={r.frozen} move={hit ? 'bounce' : 'idle'} />
          </div>
        </div>
        {hit ? (
          <div className="lp-pills">
            {calm ? <span className="lp-pill">{CH.sheet.calmPill}</span> : null}
            {!calm && r.correct ? <span className="lp-pill">{CH.sheet.streak(st.run.streak)}</span> : null}
            {!calm && r.correct && st.run.streak > 1 ? <span className="lp-pill">{multText(st.run.streak)} за серию</span> : null}
            {!calm && st.challenge.speed && r.elapsed_ms !== null ? <span className="lp-pill">{CH.sheet.seconds(r.elapsed_ms)}</span> : null}
            {partial ? <span className="lp-pill">{KINDS.partial}</span> : null}
          </div>
        ) : null}
        {typed && !r.correct ? (
          <p className="lp-wide">
            {kind === 'number' ? `${KINDS.mineNumber}: ${typedText(typed, st.question!.unit ?? null)}` : `${KINDS.mine}: «${typed}»`}
          </p>
        ) : null}
        {!r.correct || kind === 'short' || kind === 'number' ? (
          <p className="lp-wide">
            {key.label}: <b>{key.text}</b>
          </p>
        ) : null}
        {lines.map((l) => (
          <p key={l} className="lp-wide">
            {l}
          </p>
        ))}
        {r.explanation ? (
          <div className="lc-explain">
            <b>{CH.sheet.explanation}</b>
            <p>{r.explanation}</p>
          </div>
        ) : null}
      </div>
      <button ref={nextRef} type="button" className="lp-btn lc-next" disabled={busy} onClick={() => (last ? ctl.showFinal() : void ctl.next())}>
        {last ? CH.sheet.final : CH.sheet.next}
      </button>
    </section>
  );
});

// ─────────────────────────────────────────── the final ───────────────────────────────────────────

function Final({ ctl, st, top }: { ctl: ChallengeController; st: RunState; top: BoardRow[] | null }) {
  const run = st.run;
  const won = run.boss.defeated;
  const asked = run.qi + 1;
  return (
    <>
      <div className="lp-page">
        <p className="lc-kicker">{st.challenge.title}</p>
        <h1 className="lp-h1">{won ? CH.final.won : CH.final.lost}</h1>
        <div className="lc-stage lc-stage--final" aria-hidden="true">
          <LiveChar look={run.look} size={120} face={won ? 'happy' : 'idle'} move={won ? 'bounce' : 'idle'} />
          <LiveBoss size={won ? 92 : 112} phase={run.boss.phase} move={won ? 'none' : 'idle'} className={won ? 'lc-boss-down' : undefined} />
        </div>
        <div className="lp-card lp-result lc-result">
          <div className="lp-result__place">
            {run.place ? (
              <>
                <b>{CH.final.place(run.place)}</b>
                <span>{CH.final.of(st.challenge.finished)}</span>
              </>
            ) : (
              <span>{CH.final.noPlace}</span>
            )}
          </div>
        </div>
        <dl className="lp-stats3">
          <div>
            <dt>{CH.final.points}</dt>
            <dd>{nb(run.dmg)}</dd>
          </div>
          <div>
            <dt>{CH.final.rightLabel}</dt>
            <dd>{CH.final.right(run.right, Math.max(asked, 0))}</dd>
          </div>
          <div>
            <dt>{CH.final.time}</dt>
            <dd>{timeText(run.time_ms)}</dd>
          </div>
        </dl>
        {top && top.length > 0 ? (
          <section className="lc-final-top" aria-label={CH.final.top}>
            <h2>{CH.final.top}</h2>
            <ol className="lc-board">
              {top.slice(0, 3).map((row, i) => (
                <Row key={`${i}:${row.name}`} row={row} />
              ))}
            </ol>
          </section>
        ) : null}
        <p className="lc-played">{st.challenge.state === 'open' ? CH.final.note : CH.board.over}</p>
      </div>
      <div className="lp-bar lp-bar--row">
        <button type="button" className="lp-btn lp-btn--main" onClick={() => void ctl.openReview()}>
          {CH.final.review}
        </button>
        <button type="button" className="lp-btn lp-btn--second" onClick={() => void ctl.openBoard('final')}>
          {CH.final.board}
        </button>
      </div>
    </>
  );
}

// ─────────────────────────────────────────── the table ───────────────────────────────────────────

const Row = memo(function Row({ row }: { row: BoardRow }) {
  return (
    <li className="lc-row" data-me={row.me ? 'true' : undefined} data-place={row.place <= 3 ? row.place : undefined}>
      <span className="lc-place">{row.place}</span>
      <LiveChar look={row.look} size={34} move="none" />
      <span className="lc-who">
        {row.name}
        {row.me ? <small> · {CH.board.me}</small> : null}
      </span>
      <span className="lc-num" aria-label={pointsText(row.dmg)}>
        {nb(row.dmg)}
      </span>
      <span className="lc-sub-num">
        {row.right} · {timeText(row.time_ms)}
      </span>
    </li>
  );
});

function BoardScreen({ ctl, s }: { ctl: ChallengeController; s: ChallengeSnapshot }) {
  const b = s.board;
  const info = b?.challenge ?? s.info;
  const meOutside = b?.me && !b.top.some((r) => r.me);
  return (
    <>
      <div className="lp-page">
        <p className="lc-kicker">{info?.title}</p>
        <h1 className="lp-h1">{CH.board.title}</h1>
        {info ? (
          <p className="lp-sub">
            {info.state === 'over' ? CH.board.over : CH.board.until(dateText(info.deadline))}
            {' · '}
            {CH.board.finished(info.finished)}
            {info.playing > 0 ? ` · ${CH.board.playing(info.playing)}` : ''}
          </p>
        ) : null}
        {!b && !s.boardError ? (
          <p className="lp-sub" role="status">
            {CH.board.loading}
          </p>
        ) : null}
        {s.boardError ? (
          <p className="lp-error" role="alert">
            {s.boardError}
          </p>
        ) : null}
        {b && b.top.length === 0 ? <p className="lp-card lc-empty">{CH.board.empty}</p> : null}
        {b && b.top.length > 0 ? (
          <>
            <div className="lc-head" aria-hidden="true">
              <span>{CH.board.points}</span>
              <span>
                {CH.board.right} · {CH.board.time}
              </span>
            </div>
            <ol className="lc-board" aria-label={CH.board.title}>
              {b.top.map((row, i) => (
                <Row key={`${i}:${row.name}`} row={row} />
              ))}
            </ol>
          </>
        ) : null}
        {b?.me && (meOutside || !b.me.finished) ? (
          <p className="lp-card lc-mine" role="status">
            {b.me.finished ? CH.board.mine(b.me.place) : CH.board.mine(null)}
            {b.me.finished ? ` · ${pointsText(b.me.dmg)}` : ''}
          </p>
        ) : null}
      </div>
      <div className="lp-bar">
        {s.boardFrom === 'intro' && info?.state === 'open' && !s.state ? (
          <button type="button" className="lp-btn lp-btn--main" onClick={() => ctl.begin()}>
            {CH.board.play}
          </button>
        ) : null}
        <button type="button" className={`lp-btn ${s.boardFrom === 'intro' && info?.state === 'open' && !s.state ? 'lp-btn--quiet' : 'lp-btn--second'}`} onClick={() => ctl.closeBoard()}>
          {CH.board.back}
        </button>
      </div>
    </>
  );
}
