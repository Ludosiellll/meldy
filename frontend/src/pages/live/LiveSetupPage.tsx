/**
 * /live/new?c=<test> — «Провести игру» (prototype host-01): the game — «Битва с монстром» with or without its
 * «Мини-игра с движением» every 3, 5 or 10 questions, or every question as «Встань на ответ» (the one picker of
 * docs/live/MODE_MIXED.md §1 and §8: `miniGameSettings`; the stand game's boss and 15, 20 or 30 s, the battle's 10, 20 or
 * 30 s, the boss again whenever there is an arena), speed points, who may join, and — only when a Telegram chat is bound
 * to the exam — whether the bot names the top three there; the questions that do not fit are counted, their list
 * folded. «Открыть комнату» stays in view at the bottom of the window: it creates the game (`live_create`, CONTRACT §8),
 * keeps the host token in this tab and opens /live/:id.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { Link, Navigate, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth';
import { liveApi, liveFakeWanted } from '../../lib/live/api';
import { DEFAULT_STAND_EVERY, LiveError, MINI_GAMES, TEAMS, miniGameSettings, type BossKind, type GameMode, type MiniGame, type Settings, type Teams } from '../../lib/live/types';
import { standRounds } from '../../lib/live/rules';
import { bossPictureUrl } from '../../lib/live/three/thumbs';
import { BOSSES, STAND } from '../../components/live/stand/copy';
import { loginFor } from '../../lib/returnTo';
import { useDocumentTitle } from '../../lib/useDocumentTitle';
import { Boss } from '../../components/live/art/Boss';
import { Character } from '../../components/live/art/Character';
import { MODE, SETUP, nb } from '../../components/live/host/copy';
import { fakeKnobs, saveHostInfo, saveHostToken } from '../../components/live/host/hostSession';
import { MAX_GAME_QUESTIONS, MIN_GAME_QUESTIONS, amountChoices, fakeSource, loadSource, type SourcePreview, type SourceQuestion } from '../../components/live/host/source';
import { useBoundChats } from '../../components/live/host/TelegramPost';
import { hostSound } from '../../components/live/host/sound';
import '../../components/live/host/host.css';
import { Row, Seg } from './setupParts';
import { CHALLENGE_ENTRY } from '../../components/challenge/copyAuthor';

/** The battle's picture; with an arena (a mini-game) the arena boss's picture in its corner. */
function ModePicture({ arena = null }: { arena?: BossKind | null }) {
  return (
    <div className="lvs-mode-pic" aria-hidden="true">
      <div className="lvs-mode-art">
        <Boss size={112} phase={0} />
        <Character look={{ body: 'round', colour: 'blue', eyes: 'round', hat: 'none' }} size={46} style={{ left: 10, top: 74 }} />
        <Character look={{ body: 'drop', colour: 'yellow', eyes: 'round', hat: 'antenna' }} size={46} style={{ left: 168, top: 70 }} phaseMs={300} />
      </div>
      {arena ? <img className="lvs-mode-sticker" src={bossPictureUrl(arena)} alt="" width={56} height={56} /> : null}
    </div>
  );
}

const TIMES: Record<GameMode, readonly Settings['time_s'][]> = { boss: [10, 20, 30], stand: [15, 20, 30] };
const DEFAULT_TIME: Record<GameMode, Settings['time_s']> = { boss: 20, stand: 15 };

function StandPicture({ boss }: { boss: BossKind }) {
  return (
    <div className="lvs-mode-pic lvs-mode-pic--stand" aria-hidden="true">
      <img src={bossPictureUrl(boss)} alt="" width={112} height={112} />
    </div>
  );
}

/** The pick of the address: `mode=stand` (a stand game's «Ещё раз»), `mini=none|3|5|10|all`, else every 5th question. */
export function pickOf(params: URLSearchParams): MiniGame {
  if (params.get('mode') === 'stand') return 'all';
  const m = params.get('mini');
  const found = MINI_GAMES.find((g) => String(g) === m);
  return found ?? (DEFAULT_STAND_EVERY === 0 ? 'none' : DEFAULT_STAND_EVERY);
}

/**
 * The game, told and picked in one place: its picture, name and one line (which questions are the mini-game), and the
 * picker «Мини-игра с движением». «Все вопросы» is «Встань на ответ»; «Нет» the plain battle.
 */
function GameChoice({ pick, count, boss, onChange }: { pick: MiniGame; count: number; boss: BossKind; onChange: (p: MiniGame) => void }) {
  const stand = pick === 'all';
  const about = stand ? STAND.about : pick === 'none' ? MODE.about : SETUP.mixedAbout(pick, standRounds(pick, count));
  return (
    <section className="lvs-game" aria-labelledby="lvs-game-name" data-pick={String(pick)}>
      {stand ? <StandPicture boss={boss} /> : <ModePicture arena={pick === 'none' ? null : boss} />}
      <div className="lvs-game-text">
        <h2 id="lvs-game-name">{stand ? STAND.name : MODE.name}</h2>
        <p>{about}</p>
      </div>
      <div className="lvs-game-pick">
        <span className="lvs-game-label" aria-hidden="true">
          {SETUP.mini}
        </span>
        <Seg label={SETUP.mini} value={pick} options={MINI_GAMES.map((g) => ({ value: g, text: SETUP.miniOption[String(g)] }))} onChange={onChange} />
      </div>
    </section>
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
  const [pick, setPickState] = useState<MiniGame>(() => pickOf(params));
  const mode: GameMode = pick === 'all' ? 'stand' : 'boss';
  const [boss, setBoss] = useState<BossKind>('clock');
  const [time, setTime] = useState<Settings['time_s']>(() => DEFAULT_TIME[pickOf(params) === 'all' ? 'stand' : 'boss']);
  const setPick = useCallback(
    (p: MiniGame) => {
      // each game starts from its own times (stand: 15 s, MODE_STAND §1); the battle's picks share theirs
      if ((pick === 'all') !== (p === 'all')) setTime(DEFAULT_TIME[p === 'all' ? 'stand' : 'boss']);
      setPickState(p);
    },
    [pick],
  );
  const [speed, setSpeed] = useState(true);
  // «Без спешки» (20261106090000_live_calm.sql): off unless the teacher picks it; a battle only
  const [calm, setCalm] = useState(false);
  const [teams, setTeams] = useState<Teams>(0);
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

  // every game takes five or six options and pictures (the arena has six zones and the board shows the pictures)
  // several right answers and text answers play too (20261102090000_live_kinds_teams.sql); a text answer has no zone
  const stand = pick === 'all';
  const kinds = !!source && source.questions.some((q) => q.playSkip !== undefined);
  const skipOf = (q: SourceQuestion) => (q.playSkip === undefined ? q.wideSkip : stand ? (q.standSkip ?? null) : q.playSkip);
  const playable = source ? source.questions.filter((q) => !skipOf(q)).length : 0;
  const skipped = source ? source.questions.filter((q) => skipOf(q)) : [];
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
    // the arena's boss whenever there is an arena (a stand game, or a battle's mini-games)
    const settings: Settings = {
      ...miniGameSettings(pick),
      time_s: time,
      speed: speed && !(calm && pick !== 'all'),
      ...(calm && pick !== 'all' ? { calm: true } : {}),
      who,
      chat_names: hasChat && names,
      ...(pick !== 'none' ? { boss } : {}),
      ...(teams && pick !== 'all' ? { teams } : {}),
    };
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
  }, [api, source, opening, tooFew, pick, boss, time, speed, calm, who, names, hasChat, chosen, search, navigate, teams]);

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
            {/* The same test without a projector: each person alone, before a deadline (docs/live/CHALLENGE.md). */}
            {!fake && containerId ? (
              <p className="lvs-alt">
                <Link to={`/live/challenge?c=${containerId}`}>{CHALLENGE_ENTRY.setupLink}</Link>
              </p>
            ) : null}
            <GameChoice pick={pick} count={Math.min(chosen, cap)} boss={boss} onChange={setPick} />
            <div className="lvs-rows">
              {pick !== 'none' ? (
                <Row label={SETUP.boss}>
                  <BossChoice value={boss} onChange={setBoss} />
                </Row>
              ) : null}
              <Row label={SETUP.time}>
                <Seg label={SETUP.time} value={time} options={TIMES[mode].map((t) => ({ value: t, text: SETUP.timeOption(t) }))} onChange={setTime} />
              </Row>
              {pick !== 'all' ? (
                <Row label={SETUP.calm} hint={SETUP.calmHint}>
                  <Seg
                    label={SETUP.calm}
                    value={calm}
                    options={[
                      { value: false, text: SETUP.calmOff },
                      { value: true, text: SETUP.calmOn },
                    ]}
                    onChange={setCalm}
                  />
                </Row>
              ) : null}
              {calm && pick !== 'all' ? null : (
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
              )}
              {pick !== 'all' ? (
                <Row label={SETUP.teams} hint={SETUP.teamsHint}>
                  <Seg label={SETUP.teams} value={teams} options={TEAMS.map((n) => ({ value: n, text: SETUP.teamsOption(n) }))} onChange={setTeams} />
                </Row>
              ) : null}
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
                  <span>{kinds ? (stand ? SETUP.skippedWhyStand : SETUP.skippedWhyKinds) : SETUP.skippedWhyWide}</span>
                  <ChevronDown className="lvs-chev" size={20} strokeWidth={2.4} aria-hidden="true" />
                </summary>
                <ul>
                  {skipped.slice(0, 30).map((q) => (
                    <li key={q.id}>
                      {q.text} <span>{skipOf(q) === 'options' ? SETUP.reasonOptionsWide : SETUP.reason[skipOf(q)!]}</span>
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
