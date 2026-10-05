import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { useReducedMotion } from 'framer-motion';
import toast from 'react-hot-toast';
import { Pause, Play, SkipBack, SkipForward, X } from 'lucide-react';
import { useAuth } from '../../hooks/useAuth';
import { useEnergyConfirm } from '../../hooks/useEnergyConfirm';
import { notifyAIUsageChanged } from '../../api/limits';
import { AI_COSTS } from '../../lib/plans';
import { updateQuestProgress } from '../../api/quests';
import {
  forgetTTSFailures,
  getTTSPlaybackRate,
  isTTSSounding,
  isTTSUnavailable,
  pauseTTS,
  playTTS,
  prefetchTTSInOrder,
  resumeTTS,
  setTTSPlaybackRate,
  stopTTS,
  type PlayTTSOptions,
} from '../../utils/tts';
import ConversationVisual from './ConversationVisual';
import {
  assignVoices,
  buildConversation,
  conversationMeta,
  conversationOutline,
  estimateMinutes,
  hasModelVisuals,
  mergeVisualsByIndex,
  parseGeneratedLines,
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
  OutlineItem,
  PodcastLine,
} from './types';
import './conversation.css';
import { track } from '../../lib/telemetry';

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

/** Одна кнопка скорости по кругу (спека 5.7) вместо четырёх чипов. */
export const SPEEDS = [1, 1.25, 1.5, 2] as const;

const AUDIO_MESSAGES: Record<AudioProblem, string> = {
  unavailable: 'Звук недоступен в этом браузере. Реплики можно читать в тексте разговора.',
  timeout: 'Звук не загрузился. Попробуйте ещё раз.',
  failed: 'Не удалось воспроизвести реплику. Попробуйте ещё раз.',
};

/** Сколько ждём звук следующей реплики, прежде чем показать загрузку на кнопке. */
const BUFFERING_DELAY_MS = 400;

/** Звук не пошёл за столько — под плеером «Готовим голос…». */
export const WAIT_NOTE_MS = 600;
/** Не пошёл и за столько — говорим, что звук ещё грузится, а реплику уже можно читать. */
export const SLOW_NOTE_MS = 6000;

type WaitNote = 'wait' | 'slow';

/**
 * «Медленный интернет» — только когда браузер сам так говорит (navigator.connection в Chrome):
 * звук часто задерживает синтез на сервере, а не связь, и винить в этом интернет нечестно.
 */
function slowConnection(): boolean {
  if (typeof navigator === 'undefined') return false;
  const connection = (navigator as Navigator & { connection?: { effectiveType?: string } }).connection;
  return /^(slow-2g|2g|3g)$/.test(connection?.effectiveType ?? '');
}

export function waitMessage(note: WaitNote): string {
  if (note === 'wait') return 'Готовим голос…';
  return slowConnection()
    ? 'Медленный интернет: звук ещё загружается. Реплика уже на экране — её можно читать.'
    : 'Звук загружается дольше обычного. Реплика уже на экране — её можно читать.';
}

/** Звук скольких первых реплик готовим, как только плеер на экране: первое ▶ звучит сразу. */
const WARM_LINES = 2;

/**
 * Голос ведущего не меняется посреди разговора: звук только с сервера (без голоса
 * браузера — лучше честное «Звук не загрузился», чем чужой голос у Макса), и он
 * сохраняется, чтобы повтор и новый визит звучали сразу, без сервера.
 */
const HOST_VOICE: PlayTTSOptions = { fallback: 'none', persist: true };

/** На сколько реплик вперёд готовим звук: по одной, когда текущая уже зазвучала. */
const PREFETCH_AHEAD = 3;

const CREATE_FAILED = 'Не удалось создать разговор. Попробуйте ещё раз.';
const VISUALS_FAILED = 'Не удалось добавить схемы. Попробуйте ещё раз.';

const NBSP = String.fromCharCode(160);

/** «1×», «1,25×», «1,5×», «2×» — с запятой, как пишут по-русски. */
export function speedLabel(rate: number): string {
  return `${String(rate).replace('.', ',')}×`;
}

/** Следующая скорость по кругу. */
export function nextSpeed(rate: number): number {
  const index = SPEEDS.indexOf(rate as (typeof SPEEDS)[number]);
  return SPEEDS[(index + 1) % SPEEDS.length];
}

/** Код: блок ```…``` (язык в первой строке) или `…` в обратных кавычках любой длины. */
const CODE_SPAN = /```(?:[^\n`]*\n)?([\s\S]*?)```|(`+)([\s\S]*?)\2/g;
/** *курсив*, **жирный**, ***оба***: звёздочки снаружи слова, а не внутри (2*3*4 не трогаем). */
const EMPHASIS = /(^|[^\p{L}\p{N}*])(\*{1,3})(?=[^\s*])([^*\n]*?[^\s*])\2(?![\p{L}\p{N}*])/gu;

/** Разметка вне кода: заголовки, маркеры списка, ссылки, зачёркивание, выделение, лишние `. */
function plainMarkup(segment: string): string {
  let plain = segment
    .replace(/^[ \t]{0,3}#{1,6}[ \t]+/gm, '')
    .replace(/^[ \t]*[-*+][ \t]+/gm, '')
    .replace(/!?\[([^\]\n]*)\]\([^)\n]*\)/g, '$1')
    .replace(/~~(?=\S)([^~\n]*?\S)~~/g, '$1');
  // Вложенное выделение (**a *b* c**) снимается слоями.
  for (let pass = 0; pass < 3; pass += 1) {
    const next = plain.replace(EMPHASIS, '$1$3');
    if (next === plain) break;
    plain = next;
  }
  return plain.replace(/`/g, '');
}

/**
 * Реплика без markdown: модель иногда пишет `Read Committed`, **жирный**, *курсив*,
 * # заголовки и [ссылки](…). На экране и в озвучке нужен чистый текст — иначе видны
 * обратные кавычки, а голос читает звёздочки или запинается. Код внутри кавычек
 * остаётся как есть (snake_case, **kwargs); сохранённые реплики не меняются.
 */
export function plainLineText(text: string): string {
  let plain = '';
  let last = 0;
  for (const match of text.matchAll(CODE_SPAN)) {
    const at = match.index ?? 0;
    plain += plainMarkup(text.slice(last, at)) + (match[1] ?? match[3] ?? '').trim();
    last = at + match[0].length;
  }
  plain = (plain + plainMarkup(text.slice(last))).replace(/[ \t]{2,}/g, ' ').trim();
  return plain || text;
}

export interface SheetMetrics {
  /** Высота листа со схемой или графиком, px: столько места (без полей) им отдаём. */
  height: number;
  /** До скольких px лист растёт ради высокого изображения. */
  max: number;
  padTop: number;
  padBottom: number;
}

/**
 * Высота листа «Разговора» для схемы и графика и его поля по размеру окна — те же числа, что
 * в conversation.css (--cv-h, --cv-max): 392 от 1024 px, 360 уже, 336 на телефоне; в низком окне
 * (от 1024, не выше 780) — остаток 100vh под строкой меню, шапкой материала, субтитром в три строки
 * и плеером (не меньше 300 px), и лист не растёт. Разговор из одних терминов и шагов получает лист
 * ниже — по самому высокому своему изображению, но не ниже --cv-min.
 */
export function sheetMetrics(width: number, height: number): SheetMetrics {
  if (width >= 1024 && height <= 780) {
    const low = Math.max(300, height - 376);
    return { height: low, max: low, padTop: 22, padBottom: 18 };
  }
  if (width >= 1024) return { height: 392, max: 520, padTop: 28, padBottom: 26 };
  if (width >= 640) return { height: 360, max: 520, padTop: 28, padBottom: 26 };
  return { height: 336, max: 520, padTop: 16, padBottom: 14 };
}

/** Размер окна (для высоты листа и подгонки субтитра). */
function useViewport(): { width: number; height: number } {
  const read = () =>
    typeof window === 'undefined' ? { width: 1280, height: 800 } : { width: window.innerWidth, height: window.innerHeight };
  const [size, setSize] = useState(read);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onResize = () => setSize(previous => {
      const next = read();
      return next.width === previous.width && next.height === previous.height ? previous : next;
    });
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  return size;
}

function JobError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <p role="alert" className="cv-error">
      <span>{message}</span>
      <button type="button" onClick={onRetry} className="sf-link">
        Повторить
      </button>
    </p>
  );
}

/**
 * «Разговор» (спека интерьера 5.7, шаг А; язык Meldy 2026-10-04): на розовой панели — белое окно-лист с тем,
 * что показывают ведущие, под ним субтитр — имя ведущего и реплика крупно, — и плеер одной строкой:
 * ← ▶ →, сегменты реплик, «Реплика 8 из 14», одна кнопка скорости и ссылка «Текст разговора»,
 * которая открывает расшифровку панелью справа поверх листа.
 */
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
  const transcriptId = `cv-transcript-${useId().replace(/:/g, '')}`;
  const viewport = useViewport();
  const sheet = sheetMetrics(viewport.width, viewport.height);
  const budget = sheet.height - sheet.padTop - sheet.padBottom;

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

  // Текст реплик без markdown — и на экране, и в озвучке; изображения подобраны по исходному тексту.
  const conversation = useMemo(
    () =>
      buildConversation(rawLines, { title, terms, flashcards, sources }).map(line => {
        const text = plainLineText(line.text);
        return text === line.text ? line : { ...line, text };
      }),
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
  // Каждое изображение один раз: по ним лист получает высоту самого большого.
  const layers = useMemo(() => conversation.filter(line => !line.carried), [conversation]);
  // План для заставки начала: какие темы появятся на листе дальше (без вопросов, цитат и повторов).
  const outline = useMemo<OutlineItem[]>(() => {
    const opening = conversation[0]?.visual;
    return conversationOutline(conversation, opening?.type === 'scene' ? opening.title : '');
  }, [conversation]);
  const openingFrom = conversation[0]?.visualFrom;

  const [current, setCurrent] = useState(0);
  const [playback, setPlayback] = useState<Playback>('idle');
  const [finished, setFinished] = useState(false);
  const [rate, setRate] = useState<number>(() => getTTSPlaybackRate());
  const [audioProblem, setAudioProblem] = useState<AudioProblem | null>(null);
  const [transcriptOpen, setTranscriptOpen] = useState(false);
  const [announcement, setAnnouncement] = useState({ text: '', flip: false });
  const [fitStep, setFitStep] = useState(0);
  const [waitNote, setWaitNote] = useState<WaitNote | null>(null);

  const runRef = useRef(0);
  const currentRef = useRef(0);
  const restartOnResumeRef = useRef(false);
  const questCountedRef = useRef(false);
  const bufferingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const waitTimersRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  const warmedRef = useRef<string | null>(null);
  const linesRef = useRef<ConversationLine[]>(conversation);
  linesRef.current = conversation;
  const voicesRef = useRef(voices);
  voicesRef.current = voices;
  const playbackRef = useRef<Playback>(playback);
  playbackRef.current = playback;
  const listRef = useRef<HTMLOListElement | null>(null);
  const rootRef = useRef<HTMLElement | null>(null);
  const sceneRef = useRef<HTMLElement | null>(null);
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const lineRef = useRef<HTMLParagraphElement | null>(null);
  const playRef = useRef<HTMLButtonElement | null>(null);
  const textLinkRef = useRef<HTMLButtonElement | null>(null);
  const revealedRef = useRef(false);

  const total = conversation.length;
  const safeIndex = total ? Math.min(current, total - 1) : 0;
  const active = conversation[safeIndex];

  const clearBuffering = () => {
    if (bufferingTimerRef.current !== null) clearTimeout(bufferingTimerRef.current);
    bufferingTimerRef.current = null;
  };

  const clearWaitNote = () => {
    waitTimersRef.current.forEach(timer => clearTimeout(timer));
    waitTimersRef.current = [];
    setWaitNote(null);
  };

  /** Пока звук реплики не пошёл: через 600 мс «Готовим голос…», через 6 с — что её уже можно читать. */
  const armWaitNote = (run: number) => {
    clearWaitNote();
    const show = (note: WaitNote) => () => {
      if (run === runRef.current) setWaitNote(note);
    };
    waitTimersRef.current = [setTimeout(show('wait'), WAIT_NOTE_MS), setTimeout(show('slow'), SLOW_NOTE_MS)];
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
    clearWaitNote();
    setFinished(false);
    currentRef.current = 0;
    setCurrent(0);
  }, [textsKey]);

  // Останавливаем звук и предзагрузку следующих реплик, когда плеер исчезает со страницы.
  useEffect(
    () => () => {
      runRef.current += 1;
      if (bufferingTimerRef.current !== null) clearTimeout(bufferingTimerRef.current);
      waitTimersRef.current.forEach(timer => clearTimeout(timer));
      stopTTS();
      void Promise.resolve(prefetchTTSInOrder([])).catch(() => undefined);
    },
    [],
  );

  // Как только плеер на экране, готовим звук первых двух реплик (по одной, с сохранением):
  // первое ▶ звучит сразу, а не после загрузки. Уже идущий разговор готовит реплики сам.
  useEffect(() => {
    if (!total || warmedRef.current === textsKey) return;
    const warm = () => {
      if (warmedRef.current === textsKey) return;
      warmedRef.current = textsKey;
      if (playbackRef.current !== 'idle') return;
      const from = currentRef.current;
      const first = linesRef.current
        .slice(from, from + WARM_LINES)
        .map((line, offset) => ({ text: line.text, role: voiceAt(from + offset) }));
      if (first.length) void Promise.resolve(prefetchTTSInOrder(first, { persist: true })).catch(() => undefined);
    };
    const root = rootRef.current;
    if (!root || typeof IntersectionObserver === 'undefined') {
      warm();
      return;
    }
    const observer = new IntersectionObserver(entries => {
      if (!entries.some(entry => entry.isIntersecting)) return;
      observer.disconnect();
      warm();
    });
    observer.observe(root);
    return () => observer.disconnect();
  }, [textsKey, total]);

  // Новое изображение видно с начала: лист не остаётся прокрученным от прошлого (или колесом мыши).
  useLayoutEffect(() => {
    const body = bodyRef.current;
    if (body && body.scrollTop !== 0) body.scrollTop = 0;
  }, [active?.visualFrom, textsKey]);

  // В открытом тексте разговора текущая реплика всегда видна; прокручивается только сам список.
  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const item = list.querySelector<HTMLElement>(`[data-line="${safeIndex}"]`);
    if (!item || list.scrollHeight <= list.clientHeight) return;
    const top = Math.max(0, item.offsetTop - list.clientHeight / 2 + item.offsetHeight / 2);
    if (typeof list.scrollTo === 'function') list.scrollTo({ top, behavior: reduceMotion ? 'auto' : 'smooth' });
    else list.scrollTop = top;
  }, [safeIndex, transcriptOpen, reduceMotion]);

  // Текст разговора открылся — фокус на текущей реплике (Enter её проигрывает, Escape закрывает).
  useEffect(() => {
    if (!transcriptOpen) return;
    const item = listRef.current?.querySelector<HTMLButtonElement>(`[data-line="${currentRef.current}"] button`);
    item?.focus({ preventScroll: true });
  }, [transcriptOpen]);

  // Лист прокручивается внутри, если изображение выше него: низ листа затухает, пока ниже что-то есть.
  useEffect(() => {
    const body = bodyRef.current;
    if (!body) return;
    const update = () => {
      const more = body.scrollHeight - body.clientHeight - body.scrollTop > 2;
      if (more) body.setAttribute('data-more', '');
      else body.removeAttribute('data-more');
    };
    update();
    body.addEventListener('scroll', update, { passive: true });
    let observer: ResizeObserver | null = null;
    if (typeof ResizeObserver !== 'undefined') {
      observer = new ResizeObserver(update);
      observer.observe(body);
      if (body.firstElementChild) observer.observe(body.firstElementChild);
    }
    return () => {
      body.removeEventListener('scroll', update);
      observer?.disconnect();
    };
  }, [total, active?.visualFrom]);

  // Длинная реплика набирается на ступень мельче, чтобы субтитр уместился в отведённые строки
  // и плеер не уехал за край окна проектора.
  useLayoutEffect(() => {
    const element = lineRef.current;
    if (!element || typeof getComputedStyle !== 'function') return;
    const reserved = parseFloat(getComputedStyle(element).minHeight) || 0;
    let step = 0;
    element.setAttribute('data-fit', '0');
    while (reserved > 0 && step < 2 && element.scrollHeight > reserved + 1) {
      step += 1;
      element.setAttribute('data-fit', String(step));
    }
    setFitStep(step);
  }, [active?.text, viewport.width, viewport.height]);

  // Переход по ссылке на разговор: если лист или кнопка ▶ за краем экрана — прокручиваем к плееру.
  useEffect(() => {
    if (!revealOnMount || revealedRef.current || !total) return;
    if (typeof window === 'undefined' || typeof window.requestAnimationFrame !== 'function') return;
    const frame = window.requestAnimationFrame(() => {
      revealedRef.current = true;
      const root = rootRef.current;
      if (!root || typeof root.scrollIntoView !== 'function') return;
      const viewportHeight = window.innerHeight;
      const playBottom = playRef.current?.getBoundingClientRect().bottom ?? 0;
      const sceneTop = sceneRef.current?.getBoundingClientRect().top ?? 0;
      if (playBottom > viewportHeight - 8 || sceneTop > viewportHeight * 0.4) root.scrollIntoView({ block: 'start' });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [revealOnMount, total]);

  const voiceAt = (index: number): HostVoice => {
    const line = linesRef.current[index];
    return (line && voicesRef.current.get(line.speaker)) || 'female';
  };

  /** Звук следующих PREFETCH_AHEAD реплик: по одной, сохраняя для повтора. Новый вызов заменяет очередь. */
  const prefetchAhead = (index: number) => {
    const upcoming = linesRef.current
      .slice(index + 1, index + 1 + PREFETCH_AHEAD)
      .map((line, offset) => ({ text: line.text, role: voiceAt(index + 1 + offset) }));
    if (upcoming.length) void Promise.resolve(prefetchTTSInOrder(upcoming, { persist: true })).catch(() => undefined);
  };

  const speak = (index: number, continuing = false) => {
    const all = linesRef.current;
    const line = all[index];
    if (!line) return;
    const run = ++runRef.current;
    currentRef.current = index;
    restartOnResumeRef.current = false;
    clearBuffering();
    armWaitNote(run);
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

    // Сначала звук текущей реплики; следующие готовим, когда она зазвучала, чтобы не отнимать у неё сервер.
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
            clearWaitNote();
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
          clearWaitNote();
          setPlayback('idle');
          // Сервер не отдал звук и после повторов ('server') или звук не начался ('timeout') — «Звук не загрузился».
          const loading = isTTSUnavailable(error) && (error.reason === 'timeout' || error.reason === 'server');
          setAudioProblem(isTTSUnavailable(error) ? (loading ? 'timeout' : 'unavailable') : 'failed');
        },
        () => {
          if (run !== runRef.current) return;
          clearBuffering();
          clearWaitNote();
          setPlayback('playing');
          prefetchAhead(index);
          // Задание «послушать разговор» засчитывается один раз за прослушивание, когда звук реально пошёл.
          if (!questCountedRef.current && user?.id) {
            questCountedRef.current = true;
            void Promise.resolve(updateQuestProgress(user.id, 'podcast', 1)).catch(() => undefined);
          }
        },
        HOST_VOICE,
      ),
    ).catch(() => undefined);
  };

  const stopAt = (index: number) => {
    runRef.current += 1;
    clearBuffering();
    clearWaitNote();
    stopTTS();
    restartOnResumeRef.current = false;
    currentRef.current = index;
    setCurrent(index);
    setPlayback('idle');
    setFinished(false);
  };

  const togglePlay = () => {
    if (!total) return;
    // Звук загружается: повторное нажатие (и пробел, и K) ничего не отменяет. На кнопке крутится кольцо,
    // под плеером сказано, что происходит, — раньше каждый клик начинал загрузку заново.
    if (playback === 'loading') return;
    if (playback === 'playing' && !isTTSSounding()) {
      // Между репликами (кнопка ещё «Пауза»): останавливаем, а при продолжении начнём реплику заново.
      runRef.current += 1;
      clearBuffering();
      clearWaitNote();
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
    track('conversation_play', { from_start: finished || safeIndex === 0 });
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

  // На телефоне текст разговора закрывает лист: после выбора реплики показываем, что сменилось.
  const revealScene = () => {
    if (typeof window === 'undefined' || window.innerWidth >= 1024) return;
    const scene = sceneRef.current;
    if (!scene || typeof scene.scrollIntoView !== 'function') return;
    if (scene.getBoundingClientRect().top < 64) {
      scene.scrollIntoView({ block: 'start', behavior: reduceMotion ? 'auto' : 'smooth' });
    }
  };

  const cycleRate = () => {
    const next = nextSpeed(rate);
    setTTSPlaybackRate(next);
    setRate(next);
  };

  const closeTranscript = () => {
    setTranscriptOpen(false);
    textLinkRef.current?.focus();
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    const target = event.target as HTMLElement;
    const tag = target.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable) return;
    const key = event.key;
    if (key === 'Escape' && transcriptOpen) {
      event.preventDefault();
      closeTranscript();
    } else if (key === ' ' || key === 'Spacebar') {
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
    return verifyEnergy(userId, action === 'Подбор схем' ? AI_COSTS.visuals : AI_COSTS.conversation, action);
  };

  const chargeEnergy = async (userId: string | undefined) => {
    if (!userId) return;
    try {
      notifyAIUsageChanged(); // единицы списал сервер до модели
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
      <section aria-label="Разговор по материалу" className="cv cv-empty">
        <div className="cv-empty-text">
          <h2>Для этого материала разговор ещё не создан</h2>
          <p>
            Два ведущих, Макс и Софья, обсудят лекцию простыми словами, а на листе рядом будут появляться схемы, графики и
            термины из неё.
          </p>
          {materialId && canEdit ? (
            <>
              <button type="button" onClick={createConversation} disabled={creating} className="sf-primary">
                {creating ? 'Составляем разговор…' : 'Создать разговор'}
              </button>
              {createJob.state === 'error' && <JobError message={createJob.message} onRetry={createConversation} />}
            </>
          ) : (
            <p>
              {materialId
                ? 'Разговор может создать только автор материала.'
                : 'Разговор можно создать на странице материала в библиотеке.'}
            </p>
          )}
        </div>
        {/* The talk card of the prototype, still: a rose panel with the ▶ circle and a window (no words, no motion). */}
        <div className="cv-empty-art" aria-hidden="true">
          <span className="cv-empty-play">
            <Play fill="currentColor" strokeWidth={1.5} />
          </span>
          <span className="cv-empty-window">
            <i />
            <i />
            <i />
          </span>
        </div>
      </section>
    );
  }

  /* ── Плеер ───────────────────────────────────────────────────────────── */

  const isSpeaking = playback === 'playing';
  const isLoading = playback === 'loading';
  const canAddVisuals = Boolean(materialId) && canEdit && !modelVisuals;
  const addingVisuals = visualsJob.state === 'working';
  const playLabel = isLoading ? 'Загружаем звук' : isSpeaking ? 'Пауза' : playback === 'paused' ? 'Продолжить' : 'Слушать';
  const meta = conversationMeta(speakers, total, minutes);

  return (
    <section
      ref={rootRef}
      aria-label="Разговор по материалу"
      aria-keyshortcuts="Space K ArrowLeft ArrowRight"
      tabIndex={0}
      onKeyDown={handleKeyDown}
      className="cv cv-show"
    >
      <h2 className="sr-only">Разговор по материалу</h2>
      <div className="cv-meta-row">
        <p className="cv-meta">{meta}</p>
        {canAddVisuals && (
          <button type="button" onClick={addVisuals} disabled={addingVisuals} className="sf-link">
            {addingVisuals ? 'Подбираем схемы…' : 'Добавить схемы'}
          </button>
        )}
      </div>
      {visualsJob.state === 'error' && canAddVisuals && <JobError message={visualsJob.message} onRetry={addVisuals} />}

      <p className="sr-only" aria-live="polite" aria-atomic="true">
        {announcement.text}
        {announcement.flip ? NBSP : ''}
      </p>

      <div className="cv-stage">
        <section ref={sceneRef} aria-label="Сцена" className="sf-sheet cv-sheet">
          <div ref={bodyRef} className="cv-sheet-body">
            {/*
              Все изображения разговора лежат в одной ячейке сетки невидимыми копиями,
              поэтому лист сразу получает высоту самого большого и не прыгает между репликами.
            */}
            <div className="cv-layers">
              {layers.map(layer => (
                <div key={`measure-${layer.visualFrom}`} aria-hidden="true" data-scene-layer="measure" data-measure="" className="cv-layer">
                  <ConversationVisual
                    visual={layer.visual}
                    origin={layer.origin}
                    provenance={layer.provenance}
                    sources={sources}
                    outline={outline}
                    opening={layer.visualFrom === openingFrom}
                    budget={budget}
                    measure
                  />
                </div>
              ))}
              <div
                key={active.visualFrom}
                data-scene-layer="active"
                data-enter={reduceMotion ? undefined : ''}
                className="cv-layer"
              >
                <ConversationVisual
                  visual={active.visual}
                  origin={active.origin}
                  provenance={active.provenance}
                  sources={sources}
                  outline={outline}
                  opening={active.visualFrom === openingFrom}
                  budget={budget}
                  reveal={!reduceMotion}
                  onSeek={position => {
                    seek(position);
                    // Строка плана исчезает вместе со сценой: фокус остаётся в плеере, клавиши работают.
                    focusPlayer();
                  }}
                />
              </div>
            </div>
          </div>
        </section>

        {transcriptOpen && (
          <aside
            id={transcriptId}
            aria-label="Текст разговора"
            className="sf-sheet cv-panel"
            onKeyDown={event => {
              if (event.key !== 'Escape') return;
              event.preventDefault();
              event.stopPropagation();
              closeTranscript();
            }}
          >
            <div className="cv-panel-head">
              <h3 className="cv-panel-title">Текст разговора</h3>
              <button type="button" className="cv-ico" onClick={closeTranscript} aria-label="Закрыть текст разговора">
                <X aria-hidden="true" strokeWidth={1.75} />
              </button>
            </div>
            <ol ref={listRef} className="cv-panel-list">
              {conversation.map((line, index) => {
                const isActive = index === safeIndex;
                const onScreen = line.carried ? null : `${visualLabel(line.visual, line.provenance)} — ${visualCaption(line.visual)}`;
                return (
                  <li key={line.index} data-line={index}>
                    <button
                      type="button"
                      onClick={() => {
                        seek(index, true);
                        revealScene();
                      }}
                      aria-current={isActive ? 'true' : undefined}
                      title={onScreen ? `На экране: ${onScreen}` : undefined}
                    >
                      <span className="cv-panel-who">{line.speaker || 'Ведущий'}</span>
                      <span className="cv-panel-text">{line.text}</span>
                      {onScreen && <span className="sr-only">{`На экране: ${onScreen}`}</span>}
                    </button>
                  </li>
                );
              })}
            </ol>
          </aside>
        )}
      </div>

      <section aria-label="Субтитры" className="cv-sub">
        <p data-speaker={active.speaker || 'Ведущий'} className="cv-who">
          {active.speaker || 'Ведущий'}
        </p>
        <p ref={lineRef} className="cv-line" data-fit={fitStep}>
          {active.text}
        </p>
      </section>

      <div className="cv-player" role="group" aria-label="Плеер">
        <div className="cv-transport">
          <button
            type="button"
            className="cv-ico"
            onClick={() => seek(safeIndex - 1)}
            disabled={safeIndex === 0}
            aria-label="Предыдущая реплика"
          >
            <SkipBack aria-hidden="true" strokeWidth={1.75} />
          </button>
          {/* Единственная объёмная кнопка вкладки: белый круг с синим ▶ и светлым ореолом (язык Meldy).
              Пока звук грузится, вокруг ▶ крутится кольцо, а нажатия ничего не отменяют. */}
          <button
            ref={playRef}
            type="button"
            className="cv-play"
            onClick={togglePlay}
            aria-label={playLabel}
            aria-busy={isLoading || undefined}
            title="K — пауза"
            data-state={playback}
          >
            {isLoading && <span aria-hidden="true" className="cv-play-ring" />}
            {isSpeaking ? (
              <Pause aria-hidden="true" fill="currentColor" strokeWidth={1.5} />
            ) : (
              <Play aria-hidden="true" fill="currentColor" strokeWidth={1.5} className="ml-0.5" />
            )}
          </button>
          <button
            type="button"
            className="cv-ico"
            onClick={() => seek(safeIndex + 1)}
            disabled={safeIndex >= total - 1}
            aria-label="Следующая реплика"
          >
            <SkipForward aria-hidden="true" strokeWidth={1.75} />
          </button>
        </div>

        <div className="cv-segs" role="group" aria-label="Реплики">
          {conversation.map((line, index) => (
            <button
              key={line.index}
              type="button"
              tabIndex={-1}
              className="cv-seg"
              onClick={() => seek(index)}
              aria-label={`Реплика ${index + 1}`}
              aria-current={index === safeIndex ? 'step' : undefined}
              data-past={index < safeIndex ? '' : undefined}
            >
              <span aria-hidden="true" />
            </button>
          ))}
        </div>

        <span className="cv-pos">
          Реплика {safeIndex + 1} из {total}
        </span>
        <button type="button" className="cv-speed" onClick={cycleRate} aria-label={`Скорость ${speedLabel(rate)}, изменить`}>
          {speedLabel(rate)}
        </button>
        <button
          ref={textLinkRef}
          type="button"
          className="sf-link cv-text-link"
          onClick={() => (transcriptOpen ? closeTranscript() : setTranscriptOpen(true))}
          aria-expanded={transcriptOpen}
          aria-controls={transcriptOpen ? transcriptId : undefined}
        >
          Текст разговора
        </button>

        {/* Отдельной строкой внутри плеера: на телефоне плеер прилипает к низу экрана, и строка видна вместе с ним. */}
        {audioProblem ? (
          <p role="status" className="cv-status">
            <span>{AUDIO_MESSAGES[audioProblem]}</span>
            <button type="button" onClick={retryAudio} className="sf-link">
              Повторить
            </button>
          </p>
        ) : (
          waitNote && (
            <p role="status" className="cv-status">
              {waitMessage(waitNote)}
            </p>
          )
        )}
      </div>
    </section>
  );
}
