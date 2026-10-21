/**
 * /live/new?c=<test> — «Провести игру» (prototype host-01): which game — «Битва с монстром» (`mode: 'boss'`) or
 * «Встань на ответ» (`mode: 'stand'`, docs/live/MODE_STAND.md §1: its boss, the alarm clock or the skeleton, and
 * 15, 20 or 30 s), time per question, speed points, who may join, and — only when a Telegram chat is bound to the exam —
 * whether the bot names the top three there; the questions that do not fit are counted, their list folded. «Открыть
 * комнату» stays in view at the bottom of the window: it creates the game (`live_create`, CONTRACT §8), keeps the host
 * token in this tab and opens /live/:id.
 */
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';
import { Link, Navigate, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth';
import { liveApi, liveFakeWanted } from '../../lib/live/api';
import { LiveError, type BossKind, type GameMode, type Settings } from '../../lib/live/types';
import { bossPictureUrl } from '../../lib/live/three/thumbs';
import { BOSSES, STAND } from '../../components/live/stand/copy';
import { loginFor } from '../../lib/returnTo';
import { useDocumentTitle } from '../../lib/useDocumentTitle';
import { Boss } from '../../components/live/art/Boss';
import { Character } from '../../components/live/art/Character';
import { MODE, SETUP, nb } from '../../components/live/host/copy';
import { fakeKnobs, saveHostInfo, saveHostToken } from '../../components/live/host/hostSession';
import { MAX_GAME_QUESTIONS, MIN_GAME_QUESTIONS, amountChoices, fakeSource, loadSource, type SourcePreview } from '../../components/live/host/source';
import { useBoundChats } from '../../components/live/host/TelegramPost';
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
      <div className="lvs-mode-art">
        <Boss size={112} phase={0} />
        <Character look={{ body: 'round', colour: 'blue', eyes: 'round', hat: 'none' }} size={46} style={{ left: 10, top: 74 }} />
        <Character look={{ body: 'drop', colour: 'yellow', eyes: 'round', hat: 'antenna' }} size={46} style={{ left: 168, top: 70 }} phaseMs={300} />
      </div>
    </div>
  );
}

const TIMES: Record<GameMode, readonly Settings['time_s'][]> = { boss: [10, 20, 30], stand: [15, 20, 30] };
const DEFAULT_TIME: Record<GameMode, Settings['time_s']> = { boss: 20, stand: 15 };

function StandPicture() {
  return (
    <div className="lvs-mode-pic lvs-mode-pic--stand" aria-hidden="true">
      <img src={bossPictureUrl('clock')} alt="" width={112} height={112} />
    </div>
  );
}

/** «Битва с монстром» or «Встань на ответ»: two cards, one picked. */
function ModeChoice({ value, onChange }: { value: GameMode; onChange: (m: GameMode) => void }) {
  const cards: Array<{ mode: GameMode; name: string; about: string; pic: ReactNode }> = [
    { mode: 'boss', name: MODE.name, about: MODE.about, pic: <ModePicture /> },
    { mode: 'stand', name: STAND.name, about: STAND.about, pic: <StandPicture /> },
  ];
  return (
    <div className="lvs-modes" role="radiogroup" aria-label={SETUP.game}>
      {cards.map((c) => (
        <button key={c.mode} type="button" role="radio" aria-checked={value === c.mode} className="lvs-mode lvs-mode--card" onClick={() => onChange(c.mode)}>
          {c.pic}
          <span className="lvs-mode-body">
            <b>{c.name}</b>
            <span>{c.about}</span>
          </span>
        </button>
      ))}
    </div>
  );
}

/** The stand game's boss, with its picture. */
function BossChoice({ value, onChange }: { value: BossKind; onChange: (b: BossKind) => void }) {
  return (
    <div className="lvs-seg lvs-bosses" role="radiogroup" aria-label={SETUP.boss}>
      {(['clock', 'skeleton'] as const).map((b) => (
        <button key={b} type="button" role="radio" aria-checked={value === b} onClick={() => onChange(b)}>
          <img src={bossPictureUrl(b)} alt="" width={40} height={40} />
          {BOSSES[b].name}
        </button>
      ))}
    </div>
  );
}

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
  const [mode, setModeState] = useState<GameMode>(() => (params.get('mode') === 'stand' ? 'stand' : 'boss'));
  const [boss, setBoss] = useState<BossKind>('clock');
  const [time, setTime] = useState<Settings['time_s']>(() => DEFAULT_TIME[params.get('mode') === 'stand' ? 'stand' : 'boss']);
  const setMode = useCallback((m: GameMode) => {
    setModeState(m);
    // each game starts from its own default (stand: 15 s, MODE_STAND §1)
    setTime(DEFAULT_TIME[m]);
  }, []);
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
  // «Показывать имена тройки в чате» means something only with a chat bound to the exam
  // (asked only for a signed-in teacher: signed out, the page goes to the sign-in first — no 401 on the way)
  const { load: chatsLoad } = useBoundChats(fake || user ? (source?.containerId ?? containerId) : null, fake);
  const hasChat = chatsLoad.kind === 'ready' && chatsLoad.chats.length > 0;

  const open = useCallback(async () => {
    if (!source || opening || tooFew) return;
    // this click is the gesture that lets the game's screen make sound (the room's loop is there as it opens)
    hostSound().unlock();
    setOpening(true);
    setError(null);
    const settings: Settings = { mode, time_s: time, speed, who, chat_names: hasChat && names, ...(mode === 'stand' ? { boss } : {}) };
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
  }, [api, source, opening, tooFew, mode, boss, time, speed, who, names, hasChat, chosen, search, navigate]);

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
            <ModeChoice value={mode} onChange={setMode} />
            <div className="lvs-rows">
              {mode === 'stand' ? (
                <Row label={SETUP.boss}>
                  <BossChoice value={boss} onChange={setBoss} />
                </Row>
              ) : null}
              <Row label={SETUP.time}>
                <Seg label={SETUP.time} value={time} options={TIMES[mode].map((t) => ({ value: t, text: SETUP.timeOption(t) }))} onChange={setTime} />
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
              {hasChat ? (
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
              ) : null}
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
              <details className="lvs-skipped">
                <summary>
                  <b>{SETUP.skippedHead(skipped.length)}</b>
                  <span>{SETUP.skippedWhy}</span>
                  <ChevronDown className="lvs-chev" size={20} strokeWidth={2.4} aria-hidden="true" />
                </summary>
                <ul>
                  {skipped.slice(0, 30).map((q) => (
                    <li key={q.id}>
                      {q.text} <span>— {SETUP.reason[q.skip!]}</span>
                    </li>
                  ))}
                  {skipped.length > 30 ? <li>…</li> : null}
                </ul>
              </details>
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
              <div className="lvs-foot-in">
                <p>{SETUP.foot}</p>
                <button type="button" className="lvh-btn" onClick={() => void open()} disabled={opening || tooFew}>
                  {opening ? SETUP.opening : SETUP.open}
                </button>
              </div>
            </div>
          </>
        )}
      </main>
    </div>
  );
}
