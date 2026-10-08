import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import '../styles/paper.css';
import '../components/oral/oral.css';
import '../components/example/example.css';
import './Check.css';
import TryBar from '../components/example/TryBar';
import MicLevel from '../components/oral/MicLevel';
import type { LevelFeed } from '../hooks/useVoiceAnswer';
import { useAuth } from '../hooks/useAuth';
import { recognitionConstructor, useSpeechAnswer } from '../hooks/useSpeechAnswer';
import { RecorderError, SegmentRecorder, recorderSupported } from '../lib/oral/recorder';
import { TranscribeError, transcribeAudio } from '../lib/oral/transcribe';
import { supabase } from '../lib/supabase';
import { useDocumentTitle } from '../lib/useDocumentTitle';
import { isTTSUnavailable, playTTS, stopTTS } from '../utils/tts';
import {
  CHECK_ORDER,
  CHECK_TITLES,
  STT_SIGNED_OUT,
  VOICE_LINE,
  VOICE_SIGNED_OUT,
  deepView,
  micError,
  micIdle,
  micVerdict,
  result,
  serverResult,
  siteResult,
  speechIdle,
  speechVerdict,
  sttVerdict,
  summarize,
  supabaseResult,
  voiceVerdict,
  type CheckId,
  type CheckResult,
  type CheckState,
  type DeepRow,
  type FetchOutcome,
  type MicPermission,
} from './checkModel';

/**
 * «Проверка перед показом» (/check): before going on stage, on the venue's network and the laptop
 * that will show the app. Public, no sign-in needed. The site, the server (/api/health) and Supabase
 * as this network reaches it are checked at once; the AI on the server (/api/health/deep, cached for
 * 10 minutes there), the microphone, speech recognition in the browser and on the server, and the
 * examiner's voice by their own buttons. Every result says what to do when something is wrong; the
 * summary on top says whether the demo can go ahead. Nothing is saved.
 */

const MIC_SECONDS = 6;
const SPEECH_SECONDS = 5;
const STT_SECONDS = 4;
/** The recorder's speech detector fires every 50 ms while it hears a voice (lib/oral/recorder TICK_MS). */
const SPEECH_TICK_MS = 50;
const SAY_THIS = 'Спрос зависит от цены';

const STATE_LABELS: Record<CheckState, string> = {
  idle: 'Не проверено',
  running: 'Проверяется',
  ok: 'Работает',
  warn: 'Есть замечание',
  fail: 'Проблема',
  skip: 'Нужен вход',
};

async function timedFetch(url: string, init: RequestInit, timeoutMs: number, readJson = false): Promise<FetchOutcome> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const started = performance.now();
  try {
    const response = await fetch(url, { ...init, cache: 'no-store', signal: controller.signal });
    const ms = performance.now() - started;
    let body: unknown;
    try {
      body = readJson ? await response.json() : await response.text();
    } catch {
      body = undefined;
    }
    return { kind: 'response', status: response.status, ms, body };
  } catch {
    return { kind: 'error', timedOut: controller.signal.aborted, ms: performance.now() - started };
  } finally {
    clearTimeout(timer);
  }
}

/** Where the app's Supabase client goes: the build's VITE_* values (lib/supabase falls back to the same project). */
function supabaseTarget(): { url: string; key: string } | null {
  const client = supabase as unknown as { supabaseUrl?: unknown; supabaseKey?: unknown };
  const env = import.meta.env as Record<string, string | undefined>;
  const url = (env.VITE_SUPABASE_URL || (typeof client.supabaseUrl === 'string' ? client.supabaseUrl : '') || '').replace(/\/+$/, '');
  const key = env.VITE_SUPABASE_ANON_KEY || (typeof client.supabaseKey === 'string' ? client.supabaseKey : '') || '';
  return url && key ? { url, key } : null;
}

async function micPermission(): Promise<MicPermission> {
  try {
    const status = await navigator.permissions?.query({ name: 'microphone' as PermissionName });
    const state = status?.state;
    return state === 'granted' || state === 'prompt' || state === 'denied' ? state : 'unknown';
  } catch {
    return 'unknown'; // Firefox and Safari do not know the «microphone» permission name
  }
}

function errorName(error: unknown): string {
  return error && typeof error === 'object' && 'name' in error ? String((error as { name: unknown }).name) : '';
}

function initialResults(): Record<CheckId, CheckResult> {
  return {
    site: result('running', 'Проверяем…'),
    server: result('running', 'Проверяем…'),
    supabase: result('running', 'Проверяем…'),
    ai: result('idle', 'Сервер по-настоящему спросит Gemini и Groq, озвучит одно слово и обратится к Supabase.'),
    mic: micIdle('unknown', recorderSupported()),
    speech: speechIdle(recognitionConstructor() !== null),
    stt: result('idle', 'Проверяем вход…'),
    voice: result('idle', 'Проверяем вход…'),
  };
}

export default function Check() {
  useDocumentTitle('Проверка перед показом');
  const { user, loading: authLoading } = useAuth();
  const signedIn = Boolean(user);
  const [results, setResults] = useState<Record<CheckId, CheckResult>>(initialResults);
  const [deepRows, setDeepRows] = useState<DeepRow[]>([]);
  const [deepNote, setDeepNote] = useState<string | null>(null);
  /** The check that holds the microphone, the speaker or the AI request right now. */
  const [busy, setBusy] = useState<CheckId | null>(null);
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);

  const mountedRef = useRef(true);
  const autoRunRef = useRef(0);
  const recorderRef = useRef<SegmentRecorder | null>(null);
  const stopWaitRef = useRef<(() => void) | null>(null);
  const listenersRef = useRef(new Set<(level: number) => void>());
  const speech = useSpeechAnswer();
  const speechRef = useRef(speech);
  speechRef.current = speech;

  const level = useMemo<LevelFeed>(
    () => ({
      subscribe: (listener) => {
        listenersRef.current.add(listener);
        return () => {
          listenersRef.current.delete(listener);
        };
      },
    }),
    [],
  );
  const emitLevel = useCallback((value: number) => {
    listenersRef.current.forEach((listener) => listener(value));
  }, []);

  const put = useCallback((id: CheckId, value: CheckResult) => {
    if (mountedRef.current) setResults((current) => ({ ...current, [id]: value }));
  }, []);

  /** Waits `seconds`, counting down on the card; «Остановить» (or an error) ends the wait early. */
  const countDown = useCallback(
    (seconds: number) =>
      new Promise<void>((resolve) => {
        let left = seconds;
        setSecondsLeft(left);
        const timer = setInterval(() => {
          left -= 1;
          if (left > 0) {
            setSecondsLeft(left);
            return;
          }
          finish();
        }, 1000);
        const finish = () => {
          clearInterval(timer);
          stopWaitRef.current = null;
          if (mountedRef.current) setSecondsLeft(null);
          resolve();
        };
        stopWaitRef.current = finish;
      }),
    [],
  );

  // ── Checked at once: the site, the server, Supabase from this network ──
  const runAuto = useCallback(async () => {
    const run = ++autoRunRef.current;
    const running = result('running', 'Проверяем…');
    setResults((current) => ({ ...current, site: running, server: running, supabase: running }));
    const target = supabaseTarget();
    const [site, server, base] = await Promise.all([
      timedFetch(`/?check=${Date.now()}`, {}, 15_000),
      timedFetch('/api/health', {}, 15_000, true),
      target ? timedFetch(`${target.url}/auth/v1/health`, { headers: { apikey: target.key } }, 10_000) : Promise.resolve(null),
    ]);
    // supabase.co closed: the app's fallback way through this site (backend/supabase_proxy.py).
    const viaSite =
      target && base?.kind === 'error'
        ? await timedFetch('/sb/auth/v1/health', { headers: { apikey: target.key } }, 10_000)
        : null;
    if (!mountedRef.current || run !== autoRunRef.current) return;
    const online = typeof navigator === 'undefined' || navigator.onLine !== false;
    setResults((current) => ({
      ...current,
      site: siteResult(site, online),
      server: serverResult(server),
      supabase: supabaseResult(base, viaSite),
    }));
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    void runAuto();
    void micPermission().then((permission) => {
      if (!mountedRef.current) return;
      setResults((current) => (current.mic.state === 'idle' || current.mic.state === 'fail' ? { ...current, mic: micIdle(permission, recorderSupported()) } : current));
    });
    return () => {
      mountedRef.current = false;
      stopWaitRef.current?.();
      recorderRef.current?.release();
      recorderRef.current = null;
      speechRef.current.reset('');
      stopTTS();
    };
  }, [runAuto]);

  // Server recognition and the voice need an account: they wait for the session to be known.
  useEffect(() => {
    if (authLoading) return;
    setResults((current) => {
      const next = { ...current };
      const fresh = (value: CheckResult) => value.state === 'idle' || value.state === 'skip';
      if (fresh(current.stt)) {
        next.stt = signedIn ? result('idle', `Запишем ${STT_SECONDS} секунды и отправим на сервер. Скажите, например: «${SAY_THIS}».`) : STT_SIGNED_OUT;
      }
      if (fresh(current.voice)) {
        next.voice = signedIn ? result('idle', 'Проиграем короткую фразу голосом экзаменатора. Сделайте звук погромче.') : VOICE_SIGNED_OUT;
      }
      return next;
    });
  }, [authLoading, signedIn]);

  // A browser recognition error ends the 5-second test at once.
  useEffect(() => {
    if (busy === 'speech' && speech.status === 'error') stopWaitRef.current?.();
  }, [busy, speech.status]);

  // ── ИИ и сервисы на сервере ──
  const runAi = async () => {
    if (busy) return;
    setBusy('ai');
    put('ai', result('running', 'Сервер спрашивает Gemini и Groq, озвучивает слово и обращается к Supabase. Это занимает до 20 секунд.'));
    const outcome = await timedFetch('/api/health/deep', {}, 45_000, true);
    if (!mountedRef.current) return;
    const view = deepView(outcome);
    setDeepRows(view.rows);
    setDeepNote(view.note);
    put('ai', view.result);
    setBusy(null);
  };

  // ── Микрофон ──
  const openRecorder = async (id: CheckId, onSegment: (blob: Blob) => void): Promise<{ recorder: SegmentRecorder; speechMs: () => number } | null> => {
    let heard = 0;
    const recorder = new SegmentRecorder({
      onSegment: (segment) => onSegment(segment.blob),
      onLevel: emitLevel,
      onSpeech: () => {
        heard += SPEECH_TICK_MS;
      },
      // One piece for the whole recording: no cut on a pause.
      minSegmentMs: 60_000,
      maxSegmentMs: 60_000,
    });
    recorderRef.current = recorder;
    try {
      await recorder.start();
    } catch (error) {
      recorder.release();
      recorderRef.current = null;
      put(id, micError(error instanceof RecorderError ? error.kind : 'other'));
      return null;
    }
    return { recorder, speechMs: () => heard };
  };

  const runMic = async () => {
    if (busy) return;
    setBusy('mic');
    put('mic', result('running', 'Скажите пару слов — столбики должны двигаться.'));
    const opened = await openRecorder('mic', () => undefined);
    if (opened) {
      await countDown(MIC_SECONDS);
      opened.recorder.release();
      recorderRef.current = null;
      put('mic', micVerdict(opened.speechMs()));
    }
    if (mountedRef.current) setBusy(null);
  };

  // ── Распознавание речи в браузере ──
  const runSpeech = async () => {
    if (busy) return;
    const current = speechRef.current;
    current.reset('');
    if (!current.start()) {
      put('speech', speechIdle(false));
      return;
    }
    setBusy('speech');
    put('speech', result('running', `Скажите фразу, например: «${SAY_THIS}».`));
    await countDown(SPEECH_SECONDS);
    const text = await speechRef.current.stop();
    if (!mountedRef.current) return;
    put('speech', speechVerdict(text, speechRef.current.error));
    setBusy(null);
  };

  // ── Распознавание речи на сервере ──
  const runStt = async () => {
    if (busy || !signedIn) return;
    setBusy('stt');
    put('stt', result('running', `Говорите: «${SAY_THIS}».`));
    const pieces: Blob[] = [];
    const opened = await openRecorder('stt', (blob) => pieces.push(blob));
    if (!opened) {
      if (mountedRef.current) setBusy(null);
      return;
    }
    await countDown(STT_SECONDS);
    await opened.recorder.stop();
    recorderRef.current = null;
    if (!mountedRef.current) return;
    if (pieces.length === 0) {
      put('stt', sttVerdict({ heard: false }));
      setBusy(null);
      return;
    }
    put('stt', result('running', 'Распознаём на сервере…'));
    try {
      const text = await transcribeAudio(pieces[0]);
      put('stt', sttVerdict({ heard: true, text }));
    } catch (error) {
      put(
        'stt',
        sttVerdict({
          heard: true,
          status: error instanceof TranscribeError ? error.status : null,
          code: error instanceof TranscribeError ? error.code : null,
        }),
      );
    }
    if (mountedRef.current) setBusy(null);
  };

  // ── Голос экзаменатора ──
  const runVoice = () => {
    if (busy || !signedIn) return;
    setBusy('voice');
    put('voice', result('running', 'Готовим звук…'));
    const browserVoice = typeof window !== 'undefined' && 'speechSynthesis' in window;
    const done = (value: CheckResult) => {
      put('voice', value);
      if (mountedRef.current) setBusy(null);
    };
    void playTTS(
      VOICE_LINE,
      'professor',
      () => done(voiceVerdict('ended', browserVoice)),
      (error) => done(voiceVerdict(isTTSUnavailable(error) ? 'server' : errorName(error) === 'NotAllowedError' ? 'not-allowed' : 'playback', browserVoice)),
      () => put('voice', result('running', 'Играет…')),
      { fallback: 'none' },
    );
  };

  const stopEarly = () => stopWaitRef.current?.();

  const summary = summarize(results);
  const live = busy === 'speech' ? [speech.finalText, speech.interimText].filter(Boolean).join(' ') : '';

  const cards: Record<CheckId, { extra?: ReactNode; actions?: ReactNode }> = {
    site: {},
    server: {},
    supabase: {},
    ai: {
      extra:
        deepRows.length > 0 ? (
          <ul className="ck-rows">
            {deepRows.map((row) => (
              <li key={row.id} data-ok={row.ok ? 'true' : 'false'}>
                {row.text}
              </li>
            ))}
          </ul>
        ) : null,
      actions: (
        <>
          <button type="button" className="sf-secondary" onClick={() => void runAi()} disabled={busy !== null}>
            Проверить ИИ
          </button>
          {deepNote ? <p className="ck-note">{deepNote}</p> : null}
        </>
      ),
    },
    mic: {
      extra:
        busy === 'mic' ? (
          <p className="ck-live">
            <MicLevel feed={level} />
            <span>{secondsLeft !== null ? `Осталось ${secondsLeft} с` : 'Включаем микрофон…'}</span>
          </p>
        ) : null,
      actions:
        busy === 'mic' ? (
          <button type="button" className="sf-link" data-muted="" onClick={stopEarly}>
            Остановить
          </button>
        ) : (
          <button type="button" className="sf-secondary" onClick={() => void runMic()} disabled={busy !== null || !recorderSupported()}>
            {results.mic.state === 'idle' ? 'Включить микрофон' : 'Проверить ещё раз'}
          </button>
        ),
    },
    speech: {
      extra:
        busy === 'speech' ? (
          <p className="ck-live">
            <span>{secondsLeft !== null ? `Слушаем: осталось ${secondsLeft} с` : 'Слушаем…'}</span>
            {live ? <q className="ck-heard">{live}</q> : null}
          </p>
        ) : null,
      actions:
        busy === 'speech' ? (
          <button type="button" className="sf-link" data-muted="" onClick={stopEarly}>
            Остановить
          </button>
        ) : speech.supported ? (
          <button type="button" className="sf-secondary" onClick={() => void runSpeech()} disabled={busy !== null}>
            {results.speech.state === 'idle' ? 'Скажите фразу' : 'Проверить ещё раз'}
          </button>
        ) : null,
    },
    stt: {
      extra:
        busy === 'stt' && secondsLeft !== null ? (
          <p className="ck-live">
            <MicLevel feed={level} />
            <span>{`Запись: осталось ${secondsLeft} с`}</span>
          </p>
        ) : null,
      actions: !signedIn ? (
        authLoading ? null : (
          <Link className="sf-secondary" to="/login">
            Войти
          </Link>
        )
      ) : busy === 'stt' ? null : (
        <button type="button" className="sf-secondary" onClick={() => void runStt()} disabled={busy !== null || !recorderSupported()}>
          {results.stt.state === 'idle' ? `Записать ${STT_SECONDS} секунды` : 'Проверить ещё раз'}
        </button>
      ),
    },
    voice: {
      actions: !signedIn ? (
        authLoading ? null : (
          <Link className="sf-secondary" to="/login">
            Войти
          </Link>
        )
      ) : busy === 'voice' ? null : (
        <>
          <button type="button" className="sf-secondary" onClick={runVoice} disabled={busy !== null}>
            {results.voice.state === 'idle' ? 'Проиграть фразу' : 'Проиграть ещё раз'}
          </button>
          {results.voice.state === 'ok' ? (
            <button type="button" className="sf-link" data-muted="" onClick={() => put('voice', voiceVerdict('not-heard', true))}>
              Не слышно
            </button>
          ) : null}
        </>
      ),
    },
  };

  return (
    <div className="tx-shell ck-shell">
      <TryBar where="Проверка перед показом" />
      <main className="sf-page ck-page">
        <header className="sf-head ck-head">
          <div>
            <h1 className="sf-h1">Проверка перед показом</h1>
            <p className="sf-lede ck-lede">
              Откройте эту страницу на том ноутбуке и в той сети, где будете показывать. У каждой проверки — результат и что сделать,
              если что-то не так. Записи и ответы нигде не сохраняются.
            </p>
          </div>
        </header>

        <section className="ck-summary" data-tone={summary.tone} aria-live="polite" aria-labelledby="ck-summary-title">
          <h2 className="ck-summary-title" id="ck-summary-title">
            {summary.title}
          </h2>
          {summary.lines.map((line) => (
            <p key={line} className="ck-summary-line">
              {line}
            </p>
          ))}
          <div className="ck-summary-actions">
            <button type="button" className="sf-primary" onClick={() => void runAuto()}>
              Проверить ещё раз
            </button>
            <p className="ck-summary-hint">Сайт, сервер и Supabase проверяются сами, остальное — кнопками в карточках.</p>
          </div>
        </section>

        <ol className="ck-list">
          {CHECK_ORDER.map((id) => {
            const value = results[id];
            const card = cards[id];
            return (
              <li key={id} className="ck-card" data-check={id} data-state={value.state} aria-labelledby={`ck-${id}-title`}>
                <div className="ck-card-top">
                  <h3 className="ck-title" id={`ck-${id}-title`}>
                    {CHECK_TITLES[id]}
                  </h3>
                  <span className="ck-state" data-state={value.state}>
                    {STATE_LABELS[value.state]}
                  </span>
                </div>
                <p className="ck-text">{value.text}</p>
                {card.extra}
                {value.fix ? (
                  <p className="ck-fix">
                    <b>Что сделать.</b> {value.fix}
                  </p>
                ) : null}
                {card.actions ? <div className="ck-actions">{card.actions}</div> : null}
              </li>
            );
          })}
        </ol>

        {/* Since the example's answers are checked by the AI (audit 2026-10-08, PUB-27), it is not «без ИИ» any more. */}
        <p className="ck-foot">
          Пример экзамена без входа — <Link to="/try">/try</Link>: ответы там проверяет ИИ, а если он не отвечает — ключевые слова. Если
          сайт не открывается совсем, показывайте запасное видео.
        </p>
      </main>
    </div>
  );
}
