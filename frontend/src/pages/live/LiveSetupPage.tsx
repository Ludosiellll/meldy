/**
 * /live/new?c=<test> — «Провести игру» (prototype host-01): the mode, time per question, speed points, who may join,
 * whether the bot names the top three in the group chat; the questions that do not fit are named and left out. «Открыть
 * комнату» creates the game (`live_create`, CONTRACT §8), keeps the host token in this tab and opens /live/:id.
 */
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link, Navigate, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth';
import { liveApi, liveFakeWanted } from '../../lib/live/api';
import { LiveError, type Settings } from '../../lib/live/types';
import { loginFor } from '../../lib/returnTo';
import { useDocumentTitle } from '../../lib/useDocumentTitle';
import { Boss } from '../../components/live/art/Boss';
import { Character } from '../../components/live/art/Character';
import { MODE, SETUP, nb } from '../../components/live/host/copy';
import { fakeKnobs, saveHostInfo, saveHostToken } from '../../components/live/host/hostSession';
import { MAX_GAME_QUESTIONS, MIN_GAME_QUESTIONS, amountChoices, fakeSource, loadSource, type SourcePreview } from '../../components/live/host/source';
import { hostSound } from '../../components/live/host/sound';
import '../../components/live/host/host.css';

interface SegProps<T extends string | number | boolean> {
  label: string;
  value: T;
  options: ReadonlyArray<{ value: T; text: string }>;
  onChange: (v: T) => void;
}

function Seg<T extends string | number | boolean>({ label, value, options, onChange }: SegProps<T>) {
  return (
    <div className="lvs-seg" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button key={String(o.value)} type="button" role="radio" aria-checked={o.value === value} onClick={() => onChange(o.value)}>
          {o.text}
        </button>
      ))}
    </div>
  );
}

function Row({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="lvs-row">
      <span className="lvs-row-label">
        {label}
        {hint ? <span className="lvs-hint">{hint}</span> : null}
      </span>
      {children}
    </div>
  );
}

function ModePicture() {
  return (
    <div className="lvs-mode-pic" aria-hidden="true">
      <Boss size={156} phase={0} />
      <Character look={{ body: 'round', colour: 'blue', eyes: 'round', hat: 'none' }} size={58} style={{ left: 18, top: 128 }} />
      <Character look={{ body: 'drop', colour: 'yellow', eyes: 'round', hat: 'antenna' }} size={58} style={{ left: 244, top: 124 }} phaseMs={300} />
    </div>
  );
}

const TIMES = [10, 20, 30] as const;

export default function LiveSetupPage() {
  const [params] = useSearchParams();
  const { pathname, search } = useLocation();
  const navigate = useNavigate();
  const containerId = params.get('c');
  const fake = liveFakeWanted();
  const { user, loading, requestSession } = useAuth();
  const api = useMemo(() => liveApi(fake ? fakeKnobs(search) : undefined), []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!fake) requestSession?.();
  }, [fake, requestSession]);

  const [source, setSource] = useState<SourcePreview | null>(null);
  const [failed, setFailed] = useState(false);
  const [time, setTime] = useState<Settings['time_s']>(20);
  const [speed, setSpeed] = useState(true);
  const [who, setWho] = useState<Settings['who']>('pin');
  const [names, setNames] = useState(false);
  const [amount, setAmount] = useState<number | null>(null);
  const [opening, setOpening] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const needsSignIn = !fake && !loading && !user;
  const load = useCallback(() => {
    setFailed(false);
    setSource(null);
    if (fake) {
      setSource(fakeSource());
      return;
    }
    if (!containerId) {
      setFailed(true);
      return;
    }
    loadSource(containerId).then(setSource, () => setFailed(true));
  }, [fake, containerId]);
  useEffect(() => {
    if (fake || user) load();
  }, [fake, user, load]);

  useDocumentTitle(source ? SETUP.title(source.title) : SETUP.top);

  const playable = source ? source.questions.filter((q) => !q.skip).length : 0;
  const skipped = source ? source.questions.filter((q) => q.skip) : [];
  const choices = amountChoices(playable);
  const cap = Math.min(playable, MAX_GAME_QUESTIONS);
  const chosen = amount !== null && choices.includes(amount) ? amount : cap > 10 ? 10 : cap;
  const tooFew = !!source && cap < MIN_GAME_QUESTIONS;

  const open = useCallback(async () => {
    if (!source || opening || tooFew) return;
    // this click is the gesture that lets the game's screen make sound (the room's loop is there as it opens)
    hostSound().unlock();
    setOpening(true);
    setError(null);
    const settings: Settings = { mode: 'boss', time_s: time, speed, who, chat_names: names };
    try {
      const gameSource = { container_id: source.containerId, subject_ids: source.subjectIds, count: chosen };
      const created = await api.create(gameSource, settings);
      saveHostToken(created.game_id, created.host_token);
      saveHostInfo(created.game_id, { title: source.title, joinUrl: created.join_url, containerId: source.containerId, quizId: null, source: gameSource, settings });
      const keep = new URLSearchParams(search);
      keep.delete('c');
      keep.delete('quiz');
      const q = keep.toString();
      navigate(`/live/${created.game_id}${q ? `?${q}` : ''}`);
    } catch (e) {
      const code = e instanceof LiveError ? e.code : 'other';
      setError(SETUP.error[code] ?? SETUP.error.other);
      setOpening(false);
    }
  }, [api, source, opening, tooFew, time, speed, who, names, chosen, search, navigate]);

  if (needsSignIn) return <Navigate to={loginFor(pathname, search)} replace />;

  const back = containerId ? `/exams/c/${containerId}` : '/exams';
  return (
    <div className="lvs">
      <header className="lvs-top">
        <Link to={back} className="lvh-logo" aria-label="Meldy">
          Meldy<i />
        </Link>
        <span>{SETUP.top}</span>
      </header>
      <main className="lvs-main">
        <h1>{source ? SETUP.title(source.title) : SETUP.titleNone}</h1>
        {failed ? (
          <p className="lvs-state" role="alert">
            {SETUP.failed}{' '}
            <button type="button" onClick={load}>
              {SETUP.retry}
            </button>
          </p>
        ) : !source ? (
          <p className="lvs-state" role="status">
            {SETUP.loading}
          </p>
        ) : (
          <>
            <p className="lvs-lead">{SETUP.lead(Math.min(chosen, cap))}</p>
            <section className="lvs-mode" aria-label={MODE.name}>
              <ModePicture />
              <div className="lvs-mode-body">
                <h2>{MODE.name}</h2>
                <p>{MODE.about}</p>
              </div>
            </section>
            <div className="lvs-rows">
              <Row label={SETUP.time}>
                <Seg label={SETUP.time} value={time} options={TIMES.map((t) => ({ value: t, text: SETUP.timeOption(t) }))} onChange={setTime} />
              </Row>
              <Row label={SETUP.speed}>
                <Seg
                  label={SETUP.speed}
                  value={speed}
                  options={[
                    { value: true, text: SETUP.speedOn },
                    { value: false, text: SETUP.speedOff },
                  ]}
                  onChange={setSpeed}
                />
              </Row>
              <Row label={SETUP.who}>
                <Seg
                  label={SETUP.who}
                  value={who}
                  options={[
                    { value: 'pin' as const, text: SETUP.whoPin },
                    { value: 'members' as const, text: SETUP.whoMembers },
                  ]}
                  onChange={setWho}
                />
              </Row>
              <Row label={SETUP.names} hint={SETUP.namesHint}>
                <Seg
                  label={SETUP.names}
                  value={names}
                  options={[
                    { value: false, text: SETUP.namesOff },
                    { value: true, text: SETUP.namesOn },
                  ]}
                  onChange={setNames}
                />
              </Row>
              {choices.length > 1 ? (
                <Row label={SETUP.amount}>
                  <Seg
                    label={SETUP.amount}
                    value={chosen}
                    options={choices.map((n) => ({ value: n, text: n === cap && n === playable ? SETUP.amountAll(n) : nb(n) }))}
                    onChange={setAmount}
                  />
                </Row>
              ) : null}
            </div>
            {skipped.length > 0 ? (
              <section className="lvs-skipped" aria-label={SETUP.skippedHead(skipped.length)}>
                <h3>{SETUP.skippedHead(skipped.length)}</h3>
                <p>{SETUP.skippedWhy}</p>
                <ul>
                  {skipped.slice(0, 30).map((q) => (
                    <li key={q.id}>
                      {q.text} <span>— {SETUP.reason[q.skip!]}</span>
                    </li>
                  ))}
                  {skipped.length > 30 ? <li>…</li> : null}
                </ul>
              </section>
            ) : null}
            {tooFew ? (
              <p className="lvs-error" role="alert">
                {SETUP.tooFew}
              </p>
            ) : null}
            {error ? (
              <p className="lvs-error" role="alert">
                {error}
              </p>
            ) : null}
            <div className="lvs-foot">
              <p>{SETUP.foot}</p>
              <button type="button" className="lvh-btn" onClick={() => void open()} disabled={opening || tooFew}>
                {opening ? SETUP.opening : SETUP.open}
              </button>
            </div>
          </>
        )}
      </main>
    </div>
  );
}
