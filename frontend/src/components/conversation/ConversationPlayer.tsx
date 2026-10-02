import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import toast from 'react-hot-toast';
import {
  AlertCircle,
  ChevronDown,
  LoaderCircle,
  MessagesSquare,
  Pause,
  Play,
  Shapes,
  SkipBack,
  SkipForward,
} from 'lucide-react';
import { useAuth } from '../../hooks/useAuth';
import { useEnergyConfirm } from '../../hooks/useEnergyConfirm';
import { incrementAIUsage } from '../../api/limits';
import { updateQuestProgress } from '../../api/quests';
import {
  forgetTTSFailures,
  getTTSPlaybackRate,
  isTTSSounding,
  isTTSUnavailable,
  pauseTTS,
  playTTS,
  prefetchTTS,
  resumeTTS,
  setTTSPlaybackRate,
  stopTTS,
} from '../../utils/tts';
import ConversationVisual, { visualTypeIcon, type OutlineItem } from './ConversationVisual';
import {
  buildConversation,
  estimateMinutes,
  hasModelVisuals,
  mergeVisualsByIndex,
  parseGeneratedLines,
  pluralLines,
  VISUAL_TYPE_LABELS,
  visualCaption,
  voiceForSpeaker,
} from './visuals';
import {
  conversationContext,
  conversationTerms,
  ConversationError,
  errorMessage,
  loadMaterialSnapshot,
  postJson,
  saveConversationLines,
  VISUALS_CONTEXT_LIMIT,
  VISUALS_MAX_LINES,
} from './persistence';
import type {
  ConversationFlashcard,
  ConversationLine,
  ConversationSource,
  ConversationTerm,
  PodcastLine,
} from './types';

export interface ConversationPlayerProps {
  /** summary_json.podcast как есть (старые реплики тоже подходят). */
  lines: readonly unknown[] | null | undefined;
  title?: string;
  terms?: ConversationTerm[] | null;
  flashcards?: ConversationFlashcard[] | null;
  sources?: ConversationSource[] | null;
  materialId?: string;
  onLinesUpdate?: (lines: PodcastLine[]) => void;
  /** Прокрутить к плееру после открытия, если кнопка «Слушать» не видна (переход по ссылке на разговор). */
  revealOnMount?: boolean;
}

type Playback = 'idle' | 'loading' | 'playing' | 'paused';
type AudioProblem = 'unavailable' | 'timeout' | 'failed';
type Job = { state: 'idle' } | { state: 'working' } | { state: 'error'; message: string };

const SPEEDS = [1, 1.25, 1.5, 2] as const;

const AUDIO_MESSAGES: Record<AudioProblem, string> = {
  unavailable: 'Звук недоступен в этом браузере. Реплики можно читать в тексте разговора.',
  timeout: 'Звук не загрузился. Попробуйте ещё раз.',
  failed: 'Не удалось воспроизвести реплику. Попробуйте ещё раз.',
};

/** Сколько ждём звук следующей реплики, прежде чем показать загрузку на кнопке. */
const BUFFERING_DELAY_MS = 400;

function speedLabel(rate: number): string {
  return `${String(rate).replace('.', ',')}×`;
}

function Waveform({ active, reduceMotion }: { active: boolean; reduceMotion: boolean }) {
  const heights = [6, 11, 15, 10, 7];
  return (
    <span aria-hidden="true" className="flex h-4 items-center gap-[2px]">
      {heights.map((height, index) =>
        active && !reduceMotion ? (
          <motion.span
            key={index}
            className="block w-[3px] rounded-full bg-[var(--sf-accent-fg)]"
            style={{ height: 15 }}
            initial={{ scaleY: height / 15 }}
            animate={{ scaleY: [height / 15, 1, 0.4, 0.85, height / 15] }}
            transition={{ duration: 0.9 + index * 0.13, repeat: Infinity, ease: 'easeInOut' }}
          />
        ) : (
          <span
            key={index}
            className="block w-[3px] rounded-full bg-[var(--sf-accent-fg)] opacity-60"
            style={{ height }}
          />
        ),
      )}
    </span>
  );
}

function SpeakerRow({
  speakers,
  activeSpeaker,
  speaking,
  reduceMotion,
}: {
  speakers: string[];
  activeSpeaker: string;
  speaking: boolean;
  reduceMotion: boolean;
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
      {speakers.map(name => {
        const active = name === activeSpeaker;
        return (
          <div key={name} className="flex items-center gap-2" aria-current={active ? 'true' : undefined}>
            <span
              aria-hidden="true"
              className={`grid h-8 w-8 place-items-center rounded-full border text-sm font-semibold transition-colors ${
                active
                  ? 'border-[var(--sf-accent-fg)] bg-[var(--sf-accent-soft)] text-[var(--sf-ink)]'
                  : 'border-[var(--sf-line)] text-[var(--sf-muted)]'
              }`}
            >
              {(name.trim()[0] || '?').toUpperCase()}
            </span>
            <span className={`text-sm ${active ? 'font-medium text-[var(--sf-ink)]' : 'text-[var(--sf-muted)]'}`}>{name}</span>
            {active && <Waveform active={speaking} reduceMotion={reduceMotion} />}
          </div>
        );
      })}
    </div>
  );
}

function Spinner({ className = 'h-4 w-4' }: { className?: string }) {
  return <LoaderCircle aria-hidden="true" className={`${className} animate-spin motion-reduce:animate-none`} />;
}

const SECONDARY_BUTTON =
  'inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg border border-[var(--sf-line)] px-3 text-sm font-medium text-[var(--sf-ink)] transition-colors [@media(hover:hover)]:hover:bg-[var(--sf-surface-soft)]';

function JobError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div role="alert" className="flex flex-wrap items-center gap-x-3 gap-y-2 text-sm text-[var(--sf-ink)]">
      <span className="inline-flex items-center gap-1.5">
        <AlertCircle aria-hidden="true" className="h-4 w-4 shrink-0 text-[var(--sf-muted)]" />
        {message}
      </span>
      <button type="button" onClick={onRetry} className={SECONDARY_BUTTON}>
        Повторить
      </button>
    </div>
  );
}

export default function ConversationPlayer({
  lines,
  title,
  terms,
  flashcards,
  sources,
  materialId,
  onLinesUpdate,
  revealOnMount = false,
}: ConversationPlayerProps) {
  const { user } = useAuth();
  const { verifyEnergy } = useEnergyConfirm();
  const reduceMotion = Boolean(useReducedMotion());

  // Локальная копия реплик после создания разговора или добавления схем,
  // пока родитель не передаст обновлённые реплики.
  const [localLines, setLocalLines] = useState<unknown[] | null>(null);
  const propsKey = useMemo(() => JSON.stringify(lines ?? []), [lines]);
  useEffect(() => {
    setLocalLines(null);
  }, [propsKey]);
  const rawLines: readonly unknown[] = localLines ?? (Array.isArray(lines) ? lines : []);

  const conversation = useMemo(
    () => buildConversation(rawLines, { title, terms, flashcards, sources }),
    [rawLines, title, terms, flashcards, sources],
  );
  const modelVisuals = useMemo(() => hasModelVisuals(rawLines), [rawLines]);
  const minutes = useMemo(() => estimateMinutes(conversation), [conversation]);
  const speakers = useMemo(() => {
    const unique: string[] = [];
    conversation.forEach(line => {
      if (line.speaker && !unique.includes(line.speaker)) unique.push(line.speaker);
    });
    return unique.slice(0, 2);
  }, [conversation]);
  // Каждое изображение один раз: по ним сцена получает высоту самого большого.
  const layers = useMemo(() => conversation.filter(line => !line.carried), [conversation]);
  // План для заставки начала: что появится на экране дальше.
  const outline = useMemo<OutlineItem[]>(
    () =>
      conversation
        .map((line, position) => ({ line, position }))
        .filter(({ line }) => !line.carried && line.visual.type !== 'scene')
        .slice(0, 5)
        .map(({ line, position }) => ({ position, type: line.visual.type, caption: visualCaption(line.visual) })),
    [conversation],
  );
  const openingFrom = conversation[0]?.visualFrom;

  const [current, setCurrent] = useState(0);
  const [playback, setPlayback] = useState<Playback>('idle');
  const [finished, setFinished] = useState(false);
  const [rate, setRate] = useState<number>(() => getTTSPlaybackRate());
  const [audioProblem, setAudioProblem] = useState<AudioProblem | null>(null);
  const [transcriptOpen, setTranscriptOpen] = useState(false);
  const [createJob, setCreateJob] = useState<Job>({ state: 'idle' });
  const [visualsJob, setVisualsJob] = useState<Job>({ state: 'idle' });

  const runRef = useRef(0);
  const currentRef = useRef(0);
  const restartOnResumeRef = useRef(false);
  const questCountedRef = useRef(false);
  const busyRef = useRef(false);
  const bufferingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const linesRef = useRef<ConversationLine[]>(conversation);
  linesRef.current = conversation;
  const listRef = useRef<HTMLOListElement | null>(null);
  const rootRef = useRef<HTMLElement | null>(null);
  const sceneRef = useRef<HTMLElement | null>(null);
  const playRef = useRef<HTMLButtonElement | null>(null);
  const revealedRef = useRef(false);

  const total = conversation.length;
  const safeIndex = total ? Math.min(current, total - 1) : 0;
  const active = conversation[safeIndex];

  const clearBuffering = () => {
    if (bufferingTimerRef.current !== null) clearTimeout(bufferingTimerRef.current);
    bufferingTimerRef.current = null;
  };

  useEffect(() => {
    if (current >= total && total > 0) {
      currentRef.current = 0;
      setCurrent(0);
    }
  }, [current, total]);

  // Останавливаем звук, когда плеер исчезает со страницы.
  useEffect(
    () => () => {
      runRef.current += 1;
      if (bufferingTimerRef.current !== null) clearTimeout(bufferingTimerRef.current);
      stopTTS();
    },
    [],
  );

  // Активная реплика всегда видна в списке; прокручивается только сам список.
  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const item = list.querySelector<HTMLElement>(`[data-line="${safeIndex}"]`);
    if (!item || list.scrollHeight <= list.clientHeight) return;
    const top = Math.max(0, item.offsetTop - list.clientHeight / 2 + item.offsetHeight / 2);
    if (typeof list.scrollTo === 'function') list.scrollTo({ top, behavior: reduceMotion ? 'auto' : 'smooth' });
    else list.scrollTop = top;
  }, [safeIndex, transcriptOpen, reduceMotion]);

  // Переход по ссылке на разговор: если сцена или кнопка «Слушать» за краем экрана — прокручиваем к плееру.
  useEffect(() => {
    if (!revealOnMount || revealedRef.current || !total) return;
    if (typeof window === 'undefined' || typeof window.requestAnimationFrame !== 'function') return;
    const frame = window.requestAnimationFrame(() => {
      revealedRef.current = true;
      const root = rootRef.current;
      if (!root || typeof root.scrollIntoView !== 'function') return;
      const viewport = window.innerHeight;
      const playBottom = playRef.current?.getBoundingClientRect().bottom ?? 0;
      const sceneTop = sceneRef.current?.getBoundingClientRect().top ?? 0;
      if (playBottom > viewport - 8 || sceneTop > viewport * 0.4) root.scrollIntoView({ block: 'start' });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [revealOnMount, total]);

  const speak = (index: number, continuing = false) => {
    const all = linesRef.current;
    const line = all[index];
    if (!line) return;
    const run = ++runRef.current;
    currentRef.current = index;
    restartOnResumeRef.current = false;
    clearBuffering();
    setCurrent(index);
    setFinished(false);
    setAudioProblem(null);
    if (continuing) {
      // Между репликами кнопка не мигает: загрузку показываем, только если звук задерживается.
      setPlayback('playing');
      bufferingTimerRef.current = setTimeout(() => {
        if (run === runRef.current) setPlayback(state => (state === 'playing' ? 'loading' : state));
      }, BUFFERING_DELAY_MS);
    } else {
      setPlayback('loading');
    }

    const next = all[index + 1];
    if (next) void Promise.resolve(prefetchTTS(next.text, voiceForSpeaker(next.speaker))).catch(() => undefined);

    void Promise.resolve(
      playTTS(
        line.text,
        voiceForSpeaker(line.speaker),
        () => {
          if (run !== runRef.current) return;
          if (index + 1 < linesRef.current.length) {
            speak(index + 1, true);
          } else {
            runRef.current += 1;
            clearBuffering();
            setPlayback('idle');
            setFinished(true);
            questCountedRef.current = false;
          }
        },
        error => {
          if (run !== runRef.current) return;
          runRef.current += 1;
          clearBuffering();
          setPlayback('idle');
          setAudioProblem(isTTSUnavailable(error) ? (error.reason === 'timeout' ? 'timeout' : 'unavailable') : 'failed');
        },
        () => {
          if (run !== runRef.current) return;
          clearBuffering();
          setPlayback('playing');
          // Задание «послушать разговор» засчитывается один раз за прослушивание, когда звук реально пошёл.
          if (!questCountedRef.current && user?.id) {
            questCountedRef.current = true;
            void Promise.resolve(updateQuestProgress(user.id, 'podcast', 1)).catch(() => undefined);
          }
        },
      ),
    ).catch(() => undefined);
  };

  const stopAt = (index: number) => {
    runRef.current += 1;
    clearBuffering();
    stopTTS();
    restartOnResumeRef.current = false;
    currentRef.current = index;
    setCurrent(index);
    setPlayback('idle');
    setFinished(false);
  };

  const togglePlay = () => {
    if (!total) return;
    if (playback === 'loading' || (playback === 'playing' && !isTTSSounding())) {
      // Звук ещё загружается: останавливаем, а при продолжении начнём реплику заново.
      runRef.current += 1;
      clearBuffering();
      stopTTS();
      restartOnResumeRef.current = true;
      setPlayback('paused');
      return;
    }
    if (playback === 'playing') {
      pauseTTS();
      setPlayback('paused');
      return;
    }
    if (playback === 'paused') {
      if (restartOnResumeRef.current) {
        speak(currentRef.current);
      } else {
        resumeTTS();
        setPlayback('playing');
      }
      return;
    }
    speak(finished ? 0 : safeIndex);
  };

  const retryAudio = () => {
    forgetTTSFailures();
    speak(currentRef.current);
  };

  const seek = (index: number, forcePlay = false) => {
    if (!total) return;
    const target = Math.max(0, Math.min(total - 1, index));
    if (forcePlay || playback === 'playing' || playback === 'loading') speak(target);
    else stopAt(target);
  };

  // На телефоне список реплик ниже сцены: после нажатия показываем, что сменилось на экране.
  const revealScene = () => {
    if (typeof window === 'undefined' || window.innerWidth >= 1024) return;
    const scene = sceneRef.current;
    if (!scene || typeof scene.scrollIntoView !== 'function') return;
    if (scene.getBoundingClientRect().top < 64) {
      scene.scrollIntoView({ block: 'start', behavior: reduceMotion ? 'auto' : 'smooth' });
    }
  };

  const changeRate = (next: number) => {
    setTTSPlaybackRate(next);
    setRate(next);
  };

  const cycleRate = () => {
    const index = SPEEDS.indexOf(rate as (typeof SPEEDS)[number]);
    changeRate(SPEEDS[(index + 1) % SPEEDS.length]);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    const target = event.target as HTMLElement;
    const tag = target.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable) return;
    const key = event.key;
    if (key === ' ' || key === 'Spacebar') {
      // На кнопке пробел нажимает саму кнопку.
      if (tag === 'BUTTON') return;
      event.preventDefault();
      togglePlay();
    } else if (key === 'k' || key === 'K' || key === 'л' || key === 'Л') {
      event.preventDefault();
      togglePlay();
    } else if (key === 'ArrowLeft') {
      event.preventDefault();
      seek(safeIndex - 1);
    } else if (key === 'ArrowRight') {
      event.preventDefault();
      seek(safeIndex + 1);
    }
  };

  const applyNewLines = (next: unknown[]) => {
    runRef.current += 1;
    clearBuffering();
    stopTTS();
    setPlayback('idle');
    setFinished(false);
    currentRef.current = 0;
    setCurrent(0);
    setLocalLines(next);
    onLinesUpdate?.(next as PodcastLine[]);
  };

  /** Проверка энергии ИИ — та же, что у шпаргалки. При отказе общее окно уже показано. */
  const energyAllows = async (action: string) => {
    if (!user?.id) return true;
    return verifyEnergy(user.id, 5, action);
  };

  const createConversation = async () => {
    if (!materialId || busyRef.current) return;
    busyRef.current = true;
    try {
      if (!(await energyAllows('Создание разговора'))) return;
      setCreateJob({ state: 'working' });
      const snapshot = await loadMaterialSnapshot(materialId);
      const context = conversationContext(snapshot);
      if (!context) throw new ConversationError('В материале слишком мало текста, чтобы составить разговор.');
      const payload = await postJson('/api/podcast/generate', {
        context,
        title: title || '',
        terms: conversationTerms(snapshot, terms),
      });
      const generated = parseGeneratedLines(payload);
      if (!generated.length) throw new ConversationError('Не получилось составить разговор. Попробуйте ещё раз.');
      await saveConversationLines(materialId, generated);
      // Энергию списываем только после успешного сохранения.
      if (user?.id) await incrementAIUsage(user.id, 5);
      applyNewLines(generated);
      setCreateJob({ state: 'idle' });
      toast.success('Разговор готов');
    } catch (error) {
      setCreateJob({ state: 'error', message: errorMessage(error, 'Не удалось создать разговор. Попробуйте ещё раз.') });
    } finally {
      busyRef.current = false;
    }
  };

  const addVisuals = async () => {
    if (!materialId || busyRef.current) return;
    busyRef.current = true;
    try {
      if (!(await energyAllows('Подбор схем'))) return;
      setVisualsJob({ state: 'working' });
      const snapshot = await loadMaterialSnapshot(materialId);
      const stored = Array.isArray(snapshot.summaryJson.podcast) ? (snapshot.summaryJson.podcast as unknown[]) : [];
      const base = stored.length ? stored : [...rawLines];
      const payload = await postJson('/api/podcast/visuals', {
        // Сервер принимает до 40 реплик; индексы первых 40 совпадают с исходными.
        lines: base.slice(0, VISUALS_MAX_LINES).map(item => {
          const line = (typeof item === 'object' && item !== null ? item : {}) as Record<string, unknown>;
          const out: Record<string, unknown> = {
            speaker: typeof line.speaker === 'string' ? line.speaker : '',
            text: typeof line.text === 'string' ? line.text : '',
          };
          if (Array.isArray(line.source_ids)) out.source_ids = line.source_ids;
          return out;
        }),
        context: conversationContext(snapshot, VISUALS_CONTEXT_LIMIT),
        terms: conversationTerms(snapshot, terms),
      });
      const { lines: merged, added } = mergeVisualsByIndex(base, payload);
      if (!added) throw new ConversationError('Не получилось подобрать схемы. Попробуйте ещё раз.');
      await saveConversationLines(materialId, merged);
      if (user?.id) await incrementAIUsage(user.id, 5);
      applyNewLines(merged);
      setVisualsJob({ state: 'idle' });
      toast.success('Схемы добавлены');
    } catch (error) {
      setVisualsJob({ state: 'error', message: errorMessage(error, 'Не удалось добавить схемы. Попробуйте ещё раз.') });
    } finally {
      busyRef.current = false;
    }
  };

  /* ── Пустое состояние ─────────────────────────────────────────────────── */

  if (!total || !active) {
    return (
      <section
        aria-label="Разговор по материалу"
        className="rounded-xl border border-[var(--sf-line)] bg-[var(--sf-surface)] px-5 py-10 text-center sm:px-8"
      >
        <MessagesSquare aria-hidden="true" strokeWidth={1.5} className="mx-auto h-10 w-10 text-[var(--sf-muted)]" />
        <h2 className="mt-4 text-base font-semibold text-[var(--sf-ink)]">Для этого материала разговор ещё не создан</h2>
        <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-[var(--sf-muted)]">
          Два ведущих обсудят материал простыми словами, а на экране будут появляться схемы, термины и факты из
          источника.
        </p>
        {materialId ? (
          <div className="mt-6 flex flex-col items-center gap-4">
            <button
              type="button"
              onClick={createConversation}
              disabled={createJob.state === 'working'}
              className="inline-flex h-10 items-center gap-2 rounded-lg bg-[var(--sf-accent)] px-4 text-sm font-semibold text-white transition-colors hover:bg-[var(--sf-accent-hover)] disabled:cursor-wait disabled:opacity-70"
            >
              {createJob.state === 'working' ? (
                <>
                  <Spinner />
                  Составляем разговор…
                </>
              ) : (
                'Создать разговор'
              )}
            </button>
            {createJob.state === 'error' && <JobError message={createJob.message} onRetry={createConversation} />}
          </div>
        ) : (
          <p className="mt-5 text-xs text-[var(--sf-muted)]">Разговор можно создать на странице материала в библиотеке.</p>
        )}
      </section>
    );
  }

  /* ── Плеер ───────────────────────────────────────────────────────────── */

  const isSpeaking = playback === 'playing';
  const isLoading = playback === 'loading';
  const canAddVisuals = Boolean(materialId) && !modelVisuals;
  const playLabel = isLoading ? 'Загружаем звук' : isSpeaking ? 'Пауза' : playback === 'paused' ? 'Продолжить' : 'Слушать';

  return (
    <section
      ref={rootRef}
      aria-label="Разговор по материалу"
      aria-keyshortcuts="Space K ArrowLeft ArrowRight"
      tabIndex={0}
      onKeyDown={handleKeyDown}
      className="group/player scroll-mt-4 overflow-clip rounded-xl border border-[var(--sf-line)] bg-[var(--sf-surface)] text-[var(--sf-ink)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--sf-accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--sf-canvas)]"
    >
      <header className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-b border-[var(--sf-line)] px-4 py-2.5 sm:px-5">
        <div className="min-w-0">
          <h2 className="text-base font-semibold text-[var(--sf-ink)]">Разговор по материалу</h2>
          <p className="mt-0.5 text-xs text-[var(--sf-muted)]">
            {pluralLines(total)}
            {minutes ? ` · около ${minutes} мин` : ''}
          </p>
        </div>
        {canAddVisuals && (
          <button
            type="button"
            onClick={addVisuals}
            disabled={visualsJob.state === 'working'}
            className={`${SECONDARY_BUTTON} disabled:cursor-wait disabled:opacity-70`}
          >
            {visualsJob.state === 'working' ? <Spinner /> : <Shapes aria-hidden="true" className="h-4 w-4" />}
            {visualsJob.state === 'working' ? 'Подбираем схемы…' : 'Добавить схемы'}
          </button>
        )}
      </header>

      {visualsJob.state === 'error' && (
        <div className="border-b border-[var(--sf-line)] px-4 py-2.5 sm:px-5">
          <JobError message={visualsJob.message} onRetry={addVisuals} />
        </div>
      )}

      <div className="grid lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0 lg:border-r lg:border-[var(--sf-line)]">
          <section ref={sceneRef} aria-label="Сцена" className="scroll-mt-3 px-4 py-5 sm:px-6 sm:py-6">
            {/*
              Все изображения разговора лежат в одной ячейке сетки невидимыми копиями,
              поэтому сцена сразу получает высоту самого большого и не прыгает между репликами.
            */}
            <div className="grid grid-cols-1 grid-rows-1">
              {layers.map(layer => (
                <div
                  key={`measure-${layer.visualFrom}`}
                  aria-hidden="true"
                  data-scene-layer="measure"
                  className="invisible col-start-1 row-start-1 min-w-0"
                >
                  <ConversationVisual
                    visual={layer.visual}
                    origin={layer.origin}
                    sourceIds={layer.visualSourceIds}
                    outline={outline}
                    opening={layer.visualFrom === openingFrom}
                    measure
                  />
                </div>
              ))}
              <motion.div
                key={active.visualFrom}
                data-scene-layer="active"
                className="col-start-1 row-start-1 min-w-0"
                initial={reduceMotion ? false : { opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: reduceMotion ? 0 : 0.2, ease: 'easeOut' }}
              >
                <ConversationVisual
                  visual={active.visual}
                  origin={active.origin}
                  sourceIds={active.visualSourceIds}
                  outline={outline}
                  opening={active.visualFrom === openingFrom}
                  onSeek={position => seek(position)}
                />
              </motion.div>
            </div>
          </section>

          <section aria-label="Субтитры" className="border-t border-[var(--sf-line)] px-4 py-4 sm:px-6">
            <SpeakerRow
              speakers={speakers}
              activeSpeaker={active.speaker}
              speaking={isSpeaking}
              reduceMotion={reduceMotion}
            />
            <p className="mt-3 min-h-[calc(4*1.6*1.0625rem)] max-w-[62ch] text-[17px] leading-[1.6] text-[var(--sf-ink)] sm:min-h-[calc(3*1.6*1.25rem)] sm:text-xl">
              {active.text}
            </p>
          </section>

          {/*
            На телефоне кнопки управления прилипают к низу экрана над нижним меню
            (<main> уже оставляет под него отступ), поэтому «Слушать» всегда под рукой.
          */}
          <div className="sticky bottom-[env(safe-area-inset-bottom)] z-10 border-t border-[var(--sf-line)] bg-[var(--sf-surface)] px-4 pb-3 pt-1.5 sm:px-6 md:bottom-0 lg:static">
            <div className="flex h-6 items-center gap-[3px]" role="group" aria-label="Реплики">
              {conversation.map((line, index) => (
                <button
                  key={line.index}
                  type="button"
                  tabIndex={-1}
                  onClick={() => seek(index)}
                  aria-label={`Реплика ${index + 1}`}
                  aria-current={index === safeIndex ? 'step' : undefined}
                  className="group/seg flex h-6 min-w-[3px] flex-1 items-center"
                >
                  <span
                    className={`block w-full rounded-full transition-colors ${
                      index === safeIndex
                        ? 'h-1.5 bg-[var(--sf-accent-fg)]'
                        : index < safeIndex
                          ? 'h-1 bg-[var(--sf-muted)]'
                          : 'h-1 bg-[color-mix(in_srgb,var(--sf-muted)_30%,var(--sf-surface))] [@media(hover:hover)]:group-hover/seg:bg-[color-mix(in_srgb,var(--sf-muted)_65%,var(--sf-surface))]'
                    }`}
                  />
                </button>
              ))}
            </div>

            <div className="mt-1.5 flex items-center gap-2">
              <button
                type="button"
                onClick={() => seek(safeIndex - 1)}
                disabled={safeIndex === 0}
                aria-label="Предыдущая реплика"
                className="grid h-10 w-10 place-items-center rounded-full text-[var(--sf-ink)] transition-colors disabled:opacity-40 [@media(hover:hover)]:hover:bg-[var(--sf-surface-soft)] [@media(hover:hover)]:disabled:hover:bg-transparent"
              >
                <SkipBack aria-hidden="true" className="h-5 w-5" />
              </button>
              <button
                ref={playRef}
                type="button"
                onClick={togglePlay}
                aria-label={playLabel}
                title="K — пауза"
                className="grid h-12 w-12 place-items-center rounded-full bg-[var(--sf-accent)] text-white shadow-[0_3px_0_color-mix(in_srgb,var(--sf-accent)_70%,#000)] transition-[transform,box-shadow,background-color] duration-100 hover:bg-[var(--sf-accent-hover)] active:translate-y-[2px] active:shadow-[0_1px_0_color-mix(in_srgb,var(--sf-accent)_70%,#000)] motion-reduce:transition-none motion-reduce:active:translate-y-0"
              >
                {isLoading ? (
                  <Spinner className="h-5 w-5" />
                ) : isSpeaking ? (
                  <Pause aria-hidden="true" className="h-5 w-5 fill-current" />
                ) : (
                  <Play aria-hidden="true" className="ml-0.5 h-5 w-5 fill-current" />
                )}
              </button>
              <button
                type="button"
                onClick={() => seek(safeIndex + 1)}
                disabled={safeIndex >= total - 1}
                aria-label="Следующая реплика"
                className="grid h-10 w-10 place-items-center rounded-full text-[var(--sf-ink)] transition-colors disabled:opacity-40 [@media(hover:hover)]:hover:bg-[var(--sf-surface-soft)] [@media(hover:hover)]:disabled:hover:bg-transparent"
              >
                <SkipForward aria-hidden="true" className="h-5 w-5" />
              </button>

              {/* На телефоне скорость — одна кнопка по кругу, на широком экране — переключатель. */}
              <button
                type="button"
                onClick={cycleRate}
                aria-label={`Скорость ${speedLabel(rate)}, изменить`}
                className="ml-auto h-9 min-w-[3.25rem] rounded-lg border border-[var(--sf-line)] px-2 text-sm font-medium tabular-nums text-[var(--sf-ink)] lg:hidden"
              >
                {speedLabel(rate)}
              </button>
              <div
                role="group"
                aria-label="Скорость"
                className="ml-auto hidden rounded-lg border border-[var(--sf-line)] p-0.5 lg:flex"
              >
                {SPEEDS.map(speed => (
                  <button
                    key={speed}
                    type="button"
                    onClick={() => changeRate(speed)}
                    aria-pressed={rate === speed}
                    aria-label={`Скорость ${speedLabel(speed)}`}
                    className={`h-8 rounded-md px-2 text-xs font-medium tabular-nums transition-colors ${
                      rate === speed
                        ? 'bg-[var(--sf-surface-soft)] text-[var(--sf-ink)]'
                        : 'text-[var(--sf-muted)] hover:text-[var(--sf-ink)]'
                    }`}
                  >
                    {speedLabel(speed)}
                  </button>
                ))}
              </div>
            </div>

            <div className="mt-1.5 flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-xs text-[var(--sf-muted)]">
              <span className="tabular-nums">
                Реплика {safeIndex + 1} из {total}
              </span>
              <span className="hidden lg:group-focus-within/player:inline">K — пауза · ← → — реплики</span>
            </div>
            {audioProblem && (
              <div role="status" className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-2 text-sm text-[var(--sf-ink)]">
                <span className="inline-flex items-start gap-1.5">
                  <AlertCircle aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-[var(--sf-muted)]" />
                  {AUDIO_MESSAGES[audioProblem]}
                </span>
                <button type="button" onClick={retryAudio} className={SECONDARY_BUTTON}>
                  Повторить
                </button>
              </div>
            )}
          </div>
        </div>

        <aside aria-label="Текст разговора" className="border-t border-[var(--sf-line)] lg:relative lg:border-t-0">
          <button
            type="button"
            onClick={() => setTranscriptOpen(open => !open)}
            aria-expanded={transcriptOpen}
            className="flex w-full items-center justify-between px-4 py-3 text-sm font-medium text-[var(--sf-ink)] lg:hidden"
          >
            Текст разговора
            <ChevronDown
              aria-hidden="true"
              className={`h-4 w-4 text-[var(--sf-muted)] transition-transform motion-reduce:transition-none ${transcriptOpen ? 'rotate-180' : ''}`}
            />
          </button>
          <p className="hidden border-b border-[var(--sf-line)] px-4 py-3 text-xs font-medium text-[var(--sf-muted)] lg:block">
            Текст разговора
          </p>
          <ol
            ref={listRef}
            className={`relative max-h-[420px] overflow-y-auto overscroll-contain border-t border-[var(--sf-line)] lg:absolute lg:inset-x-0 lg:bottom-0 lg:top-[41px] lg:block lg:max-h-none lg:border-t-0 ${
              transcriptOpen ? 'block' : 'hidden'
            }`}
          >
            {conversation.map((line, index) => {
              const isActive = index === safeIndex;
              const VisualIcon = visualTypeIcon(line.visual.type);
              return (
                <li key={line.index} data-line={index} className="border-b border-[var(--sf-line)] last:border-b-0">
                  <button
                    type="button"
                    onClick={() => {
                      seek(index, true);
                      revealScene();
                    }}
                    aria-current={isActive ? 'true' : undefined}
                    className={`flex w-full items-start gap-3 border-l-2 px-4 py-3 text-left transition-colors ${
                      isActive
                        ? 'border-[var(--sf-accent-fg)] bg-[var(--sf-accent-soft)]'
                        : 'border-transparent [@media(hover:hover)]:hover:bg-[var(--sf-surface-soft)]'
                    }`}
                  >
                    <span className="min-w-0 flex-1">
                      <span
                        className={`block text-xs font-semibold ${
                          isActive ? 'text-[var(--sf-ink)]' : 'text-[var(--sf-muted)]'
                        }`}
                      >
                        {line.speaker || 'Ведущий'}
                      </span>
                      <span className="mt-0.5 block text-sm leading-relaxed text-[var(--sf-ink)]">{line.text}</span>
                    </span>
                    {!line.carried && (
                      <span
                        className="mt-0.5 shrink-0 text-[var(--sf-muted)]"
                        title={`На экране: ${VISUAL_TYPE_LABELS[line.visual.type]} — ${visualCaption(line.visual)}`}
                      >
                        <VisualIcon aria-hidden={true} className="h-4 w-4" strokeWidth={1.75} />
                        <span className="sr-only">{`На экране: ${VISUAL_TYPE_LABELS[line.visual.type]}`}</span>
                      </span>
                    )}
                  </button>
                </li>
              );
            })}
          </ol>
        </aside>
      </div>
    </section>
  );
}
