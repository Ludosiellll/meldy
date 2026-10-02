import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import toast from 'react-hot-toast';
import { AlertCircle, ChevronDown, LoaderCircle, Pause, Play, Shapes, SkipBack, SkipForward } from 'lucide-react';
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
import ConversationVisual, { type OutlineItem } from './ConversationVisual';
import {
  assignVoices,
  buildConversation,
  estimateMinutes,
  hasModelVisuals,
  mergeVisualsByIndex,
  parseGeneratedLines,
  pluralLines,
  visualCaption,
  visualLabel,
  type HostVoice,
} from './visuals';
import {
  conversationContext,
  conversationTerms,
  ConversationError,
  loadMaterialSnapshot,
  postJson,
  saveConversationLines,
  VISUALS_CONTEXT_LIMIT,
  VISUALS_MAX_LINES,
} from './persistence';
import { isJobRunning, publishLines, runJob, useJobStatus, useLinesFeed } from './jobs';
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
  /**
   * Можно ли менять материал: создавать разговор и добавлять схемы. Чужой
   * материал (назначенный преподавателем, открытый) сохранить нельзя, поэтому
   * платную работу модели для него не предлагаем.
   */
  canEdit?: boolean;
}

type Playback = 'idle' | 'loading' | 'playing' | 'paused';
type AudioProblem = 'unavailable' | 'timeout' | 'failed';

const SPEEDS = [1, 1.25, 1.5, 2] as const;

const AUDIO_MESSAGES: Record<AudioProblem, string> = {
  unavailable: 'Звук недоступен в этом браузере. Реплики можно читать в тексте разговора.',
  timeout: 'Звук не загрузился. Попробуйте ещё раз.',
  failed: 'Не удалось воспроизвести реплику. Попробуйте ещё раз.',
};

/** Сколько ждём звук следующей реплики, прежде чем показать загрузку на кнопке. */
const BUFFERING_DELAY_MS = 400;

const CREATE_FAILED = 'Не удалось создать разговор. Попробуйте ещё раз.';
const VISUALS_FAILED = 'Не удалось добавить схемы. Попробуйте ещё раз.';

const NBSP = String.fromCharCode(160);

/** Цвет ведущего: один и тот же у имени над субтитрами и в тексте разговора. */
const VOICE_COLORS: Record<HostVoice, string> = {
  male: 'var(--sf-voice-a)',
  female: 'var(--sf-voice-b)',
};

function speedLabel(rate: number): string {
  return `${String(rate).replace('.', ',')}×`;
}

/** Полоски голоса — только пока звук идёт; место под них занято всегда, чтобы имя не прыгало. */
function Waveform({ speaking, reduceMotion }: { speaking: boolean; reduceMotion: boolean }) {
  const heights = [5, 9, 12, 8, 6];
  return (
    <span aria-hidden="true" data-waveform={speaking ? 'on' : 'off'} className={`flex h-3 items-center gap-[2px] ${speaking ? '' : 'invisible'}`}>
      {heights.map((height, index) =>
        speaking && !reduceMotion ? (
          <motion.span
            key={index}
            className="block w-[2px] rounded-full bg-current"
            style={{ height: 12 }}
            initial={{ scaleY: height / 12 }}
            animate={{ scaleY: [height / 12, 1, 0.4, 0.85, height / 12] }}
            transition={{ duration: 0.9 + index * 0.13, repeat: Infinity, ease: 'easeInOut' }}
          />
        ) : (
          <span key={index} className="block w-[2px] rounded-full bg-current" style={{ height }} />
        ),
      )}
    </span>
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
  canEdit = true,
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
  // Работа, запущенная до того, как этот плеер открылся (например, на другой вкладке), отдаёт реплики сюда.
  useLinesFeed(materialId, next => setLocalLines(next));
  const rawLines: readonly unknown[] = localLines ?? (Array.isArray(lines) ? lines : []);

  const createJob = useJobStatus('create', materialId);
  const visualsJob = useJobStatus('visuals', materialId);

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
    return unique;
  }, [conversation]);
  const voices = useMemo(() => assignVoices(speakers), [speakers]);
  const voiceOf = (line: ConversationLine): HostVoice => voices.get(line.speaker) ?? 'female';
  // Каждое изображение один раз: по ним сцена получает высоту самого большого.
  const layers = useMemo(() => conversation.filter(line => !line.carried), [conversation]);
  // План для заставки начала: что появится на экране дальше.
  const outline = useMemo<OutlineItem[]>(
    () =>
      conversation
        .map((line, position) => ({ line, position }))
        .filter(({ line }) => !line.carried && line.visual.type !== 'scene')
        .slice(0, 5)
        .map(({ line, position }) => ({ position, caption: visualCaption(line.visual) })),
    [conversation],
  );
  const openingFrom = conversation[0]?.visualFrom;

  const [current, setCurrent] = useState(0);
  const [playback, setPlayback] = useState<Playback>('idle');
  const [finished, setFinished] = useState(false);
  const [rate, setRate] = useState<number>(() => getTTSPlaybackRate());
  const [audioProblem, setAudioProblem] = useState<AudioProblem | null>(null);
  const [transcriptOpen, setTranscriptOpen] = useState(false);
  const [announcement, setAnnouncement] = useState({ text: '', flip: false });

  const runRef = useRef(0);
  const currentRef = useRef(0);
  const restartOnResumeRef = useRef(false);
  const questCountedRef = useRef(false);
  const bufferingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const linesRef = useRef<ConversationLine[]>(conversation);
  linesRef.current = conversation;
  const voicesRef = useRef(voices);
  voicesRef.current = voices;
  const playbackRef = useRef<Playback>(playback);
  playbackRef.current = playback;
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

  /** Сообщение для программ чтения с экрана; одинаковый текст подряд тоже должен прозвучать. */
  const announce = (text: string) => setAnnouncement(previous => ({ text, flip: !previous.flip }));

  const describeLine = (index: number, withText: boolean): string => {
    const all = linesRef.current;
    const line = all[index];
    if (!line) return '';
    const parts = [`Реплика ${index + 1} из ${all.length}.`];
    if (withText) parts.push(`${line.speaker || 'Ведущий'}: ${line.text}`);
    if (!line.carried) parts.push(`На экране: ${visualLabel(line.visual, line.provenance)} — ${visualCaption(line.visual)}.`);
    return parts.join(' ');
  };

  useEffect(() => {
    if (current >= total && total > 0) {
      currentRef.current = 0;
      setCurrent(0);
    }
  }, [current, total]);

  // Другие реплики (не только новые схемы к тем же): то, что звучало, к ним уже не относится.
  const textsKey = useMemo(() => JSON.stringify(conversation.map(line => line.text)), [conversation]);
  const textsKeyRef = useRef(textsKey);
  useEffect(() => {
    if (textsKeyRef.current === textsKey) return;
    textsKeyRef.current = textsKey;
    if (playbackRef.current !== 'idle') {
      runRef.current += 1;
      clearBuffering();
      stopTTS();
      setPlayback('idle');
    }
    setFinished(false);
    currentRef.current = 0;
    setCurrent(0);
  }, [textsKey]);

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

  const voiceAt = (index: number): HostVoice => {
    const line = linesRef.current[index];
    return (line && voicesRef.current.get(line.speaker)) || 'female';
  };

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

    // Сначала запрос текущей реплики, потом предзагрузка следующей.
    void Promise.resolve(
      playTTS(
        line.text,
        voiceAt(index),
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
            announce('Разговор закончился.');
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

    const next = all[index + 1];
    if (next) void Promise.resolve(prefetchTTS(next.text, voiceAt(index + 1))).catch(() => undefined);
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

  /**
   * Переход к реплике по выбору пользователя. Пока звук идёт, голос сам прочитает
   * реплику — программе чтения с экрана достаточно сказать, где мы и что на экране.
   */
  const seek = (index: number, forcePlay = false) => {
    if (!total) return;
    const target = Math.max(0, Math.min(total - 1, index));
    if (forcePlay || playback === 'playing' || playback === 'loading') {
      speak(target);
      announce(describeLine(target, false));
    } else {
      stopAt(target);
      announce(describeLine(target, true));
    }
  };

  const focusPlayer = () => {
    rootRef.current?.focus({ preventScroll: true });
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

  /* ── Работа с моделью ───────────────────────────────────────────────────
   * Состояние работ живёт в jobs.ts, а не в этом плеере: вкладку можно закрыть
   * и открыть снова, а работа продолжится, не запустится второй раз и отдаст
   * реплики тому плееру, который будет на экране. Чужой звук работа не трогает. */

  const conversationJobRunning = () => isJobRunning('create', materialId) || isJobRunning('visuals', materialId);

  /** Проверка энергии ИИ — та же, что у шпаргалки. При отказе общее окно уже показано. */
  const energyAllows = async (userId: string | undefined, action: string) => {
    if (!userId) return true;
    return verifyEnergy(userId, 5, action);
  };

  const chargeEnergy = async (userId: string | undefined) => {
    if (!userId) return;
    try {
      await incrementAIUsage(userId, 5);
    } catch (error) {
      // Разговор уже сохранён: ошибка учёта энергии не должна выглядеть как неудача.
      console.warn('incrementAIUsage failed', error);
    }
  };

  const createConversation = () => {
    if (!materialId || !canEdit || conversationJobRunning()) return;
    const id = materialId;
    const userId = user?.id;
    const deliver = onLinesUpdate;
    const materialTitle = title || '';
    const fallbackTerms = terms;
    void runJob(
      'create',
      id,
      async begin => {
        if (!(await energyAllows(userId, 'Создание разговора'))) return;
        begin();
        const snapshot = await loadMaterialSnapshot(id);
        const context = conversationContext(snapshot);
        if (!context) throw new ConversationError('В материале слишком мало текста, чтобы составить разговор.');
        const payload = await postJson('/api/podcast/generate', {
          context,
          title: materialTitle,
          terms: conversationTerms(snapshot, fallbackTerms),
        });
        const generated = parseGeneratedLines(payload);
        if (!generated.length) throw new ConversationError('Не получилось составить разговор. Попробуйте ещё раз.');
        await saveConversationLines(id, generated);
        // Энергию списываем только после успешного сохранения.
        await chargeEnergy(userId);
        publishLines(id, generated);
        deliver?.(generated);
        toast.success('Разговор готов');
      },
      CREATE_FAILED,
    );
  };

  const addVisuals = () => {
    if (!materialId || !canEdit || conversationJobRunning()) return;
    const id = materialId;
    const userId = user?.id;
    const deliver = onLinesUpdate;
    const shownLines = [...rawLines];
    const fallbackTerms = terms;
    void runJob(
      'visuals',
      id,
      async begin => {
        if (!(await energyAllows(userId, 'Подбор схем'))) return;
        begin();
        const snapshot = await loadMaterialSnapshot(id);
        const stored = Array.isArray(snapshot.summaryJson.podcast) ? (snapshot.summaryJson.podcast as unknown[]) : [];
        const base = stored.length ? stored : shownLines;
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
          terms: conversationTerms(snapshot, fallbackTerms),
        });
        const { lines: merged, added } = mergeVisualsByIndex(base, payload);
        if (!added) throw new ConversationError('Не получилось подобрать схемы. Попробуйте ещё раз.');
        await saveConversationLines(id, merged);
        await chargeEnergy(userId);
        publishLines(id, merged);
        deliver?.(merged as PodcastLine[]);
        toast.success('Схемы добавлены');
      },
      VISUALS_FAILED,
    );
  };

  /* ── Пустое состояние ─────────────────────────────────────────────────── */

  if (!total || !active) {
    const creating = createJob.state === 'working';
    return (
      <section
        aria-label="Разговор по материалу"
        className="rounded-xl border border-[var(--sf-line)] bg-[var(--sf-surface)] px-6 py-8 text-[var(--sf-ink)]"
      >
        <h2 className="text-lg font-semibold leading-snug">Для этого материала разговор ещё не создан</h2>
        <p className="mt-2 max-w-[56ch] text-sm leading-relaxed text-[var(--sf-muted)]">
          Два ведущих, Макс и Софья, обсудят материал простыми словами, а на экране будут появляться схемы, графики и
          термины из него.
        </p>
        {materialId && canEdit ? (
          <div className="mt-6 flex flex-col items-start gap-4">
            <button
              type="button"
              onClick={createConversation}
              disabled={creating}
              className="inline-flex h-10 items-center gap-2 rounded-lg bg-[var(--sf-accent)] px-4 text-sm font-semibold text-white transition-colors hover:bg-[var(--sf-accent-hover)] disabled:cursor-wait disabled:opacity-70"
            >
              {creating ? (
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
          <p className="mt-5 text-sm text-[var(--sf-muted)]">
            {materialId
              ? 'Разговор может создать только автор материала.'
              : 'Разговор можно создать на странице материала в библиотеке.'}
          </p>
        )}
      </section>
    );
  }

  /* ── Плеер ───────────────────────────────────────────────────────────── */

  const isSpeaking = playback === 'playing';
  const isLoading = playback === 'loading';
  const canAddVisuals = Boolean(materialId) && canEdit && !modelVisuals;
  const addingVisuals = visualsJob.state === 'working';
  const playLabel = isLoading ? 'Загружаем звук' : isSpeaking ? 'Пауза' : playback === 'paused' ? 'Продолжить' : 'Слушать';
  const activeColor = VOICE_COLORS[voiceOf(active)];
  const meta = [
    speakers.length ? speakers.slice(0, 3).join(' и ') : null,
    pluralLines(total),
    minutes ? `около ${minutes} мин` : null,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <section
      ref={rootRef}
      aria-label="Разговор по материалу"
      aria-keyshortcuts="Space K ArrowLeft ArrowRight"
      tabIndex={0}
      onKeyDown={handleKeyDown}
      className="group/player scroll-mt-4 overflow-clip rounded-xl border border-[var(--sf-line)] bg-[var(--sf-surface)] text-[var(--sf-ink)] outline-none [--sf-voice-a:#0868b2] [--sf-voice-b:#a84a22] focus-visible:ring-2 focus-visible:ring-[var(--sf-accent-fg)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--sf-canvas)] dark:[--sf-voice-a:#6cb0e6] dark:[--sf-voice-b:#e5936d]"
    >
      <header className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-b border-[var(--sf-line)] px-4 py-2.5 sm:px-5">
        <h2 className="sr-only">Разговор по материалу</h2>
        <p className="min-w-0 text-[13px] leading-8 text-[var(--sf-muted)]">{meta}</p>
        {canAddVisuals && (
          <button
            type="button"
            onClick={addVisuals}
            disabled={addingVisuals}
            className={`${SECONDARY_BUTTON} disabled:cursor-wait disabled:opacity-70`}
          >
            {addingVisuals ? <Spinner /> : <Shapes aria-hidden="true" className="h-4 w-4" />}
            {addingVisuals ? 'Подбираем схемы…' : 'Добавить схемы'}
          </button>
        )}
      </header>

      {visualsJob.state === 'error' && canAddVisuals && (
        <div className="border-b border-[var(--sf-line)] px-4 py-2.5 sm:px-5">
          <JobError message={visualsJob.message} onRetry={addVisuals} />
        </div>
      )}

      <p className="sr-only" aria-live="polite" aria-atomic="true">
        {announcement.text}
        {announcement.flip ? NBSP : ''}
      </p>

      <div className="grid lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0 lg:border-r lg:border-[var(--sf-line)]">
          <section ref={sceneRef} aria-label="Сцена" className="scroll-mt-3 px-4 py-5 sm:px-6 sm:py-6">
            {/*
              Все изображения разговора лежат в одной ячейке сетки невидимыми копиями,
              поэтому сцена сразу получает высоту самого большого и не прыгает между репликами.
              Изображения прижаты к верху: заголовок каждого стоит на одном месте.
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
                    provenance={layer.provenance}
                    sources={sources}
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
                  provenance={active.provenance}
                  sources={sources}
                  outline={outline}
                  opening={active.visualFrom === openingFrom}
                  onSeek={position => {
                    seek(position);
                    // Строка плана исчезает вместе со сценой: фокус остаётся в плеере, клавиши работают.
                    focusPlayer();
                  }}
                />
              </motion.div>
            </div>
          </section>

          <section aria-label="Субтитры" className="border-t border-[var(--sf-line)] px-4 py-4 sm:px-6">
            <p data-speaker={active.speaker || 'Ведущий'} className="flex items-center gap-2 text-[13px] font-semibold leading-5" style={{ color: activeColor }}>
              <span>{active.speaker || 'Ведущий'}</span>
              <Waveform speaking={isSpeaking} reduceMotion={reduceMotion} />
            </p>
            <p className="mt-1.5 min-h-[calc(4*1.6*1.0625rem)] max-w-[62ch] text-[17px] leading-[1.6] text-[var(--sf-ink)] sm:min-h-[calc(3*1.6*1.25rem)] sm:text-xl">
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
                          ? 'h-1 bg-[color-mix(in_srgb,var(--sf-ink)_30%,var(--sf-surface))]'
                          : 'h-1 bg-[var(--sf-line)] [@media(hover:hover)]:group-hover/seg:bg-[color-mix(in_srgb,var(--sf-ink)_30%,var(--sf-surface))]'
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
              {/* Главное действие плеера — с ощутимым нажатием, как у главных кнопок приложения. */}
              <button
                ref={playRef}
                type="button"
                onClick={togglePlay}
                aria-label={playLabel}
                title="K — пауза"
                className="grid h-12 w-12 place-items-center rounded-full bg-[var(--sf-accent)] text-white shadow-[0_3px_0_color-mix(in_srgb,var(--sf-accent)_72%,#111)] transition-[transform,box-shadow,background-color] duration-100 hover:bg-[var(--sf-accent-hover)] active:translate-y-[2px] active:shadow-[0_1px_0_color-mix(in_srgb,var(--sf-accent)_72%,#111)] motion-reduce:transition-none motion-reduce:active:translate-y-0 dark:shadow-[0_2px_0_color-mix(in_srgb,var(--sf-accent)_60%,var(--sf-canvas))] dark:active:shadow-none"
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
              const color = VOICE_COLORS[voiceOf(line)];
              const onScreen = line.carried ? null : `${visualLabel(line.visual, line.provenance)} — ${visualCaption(line.visual)}`;
              return (
                <li key={line.index} data-line={index} className="border-b border-[var(--sf-line)] last:border-b-0">
                  <button
                    type="button"
                    onClick={() => {
                      seek(index, true);
                      revealScene();
                    }}
                    aria-current={isActive ? 'true' : undefined}
                    title={onScreen ? `На экране: ${onScreen}` : undefined}
                    className={`block w-full border-l-2 px-4 py-3 text-left transition-colors ${
                      isActive
                        ? 'bg-[var(--sf-surface-soft)]'
                        : 'border-transparent [@media(hover:hover)]:hover:bg-[var(--sf-surface-soft)]'
                    }`}
                    style={isActive ? { borderLeftColor: color } : undefined}
                  >
                    <span className="block text-xs font-semibold" style={{ color }}>
                      {line.speaker || 'Ведущий'}
                    </span>
                    <span className="mt-0.5 block text-sm leading-relaxed text-[var(--sf-ink)]">{line.text}</span>
                    {onScreen && <span className="sr-only">{`На экране: ${onScreen}`}</span>}
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
