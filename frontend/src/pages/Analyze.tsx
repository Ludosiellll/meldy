import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import UploadZone, { type UploadOptions, type UploadTab } from '../components/UploadZone';
import AgentCards from '../components/AgentCards';
import ResultsPanel from '../components/ResultsPanel';
import { DEFAULT_SETTINGS } from '../types';
import type { AgentStatus, AnalysisResults, AnalysisSettings, AnalysisState, Flashcard, SectionName } from '../types';
import { DEMO_SETTINGS, DEMO_TEXT, DEMO_TEXT_ID, DEMO_TITLE, isDemoText } from '../data/demo';
import { supabase } from '../lib/supabase';
import { useAuth } from '../hooks/useAuth';
import { syncFlashcards } from '../api/flashcards';
import { recordStudyActivity } from '../api/quests';
import { hasBadWords } from '../utils/moderation';
import { AI_USAGE_EVENT, FREE_DAILY_LIMIT, checkAILimit, formatLimitReset, incrementAIUsage, nextLimitReset } from '../api/limits';
import { useEnergyConfirm } from '../hooks/useEnergyConfirm';
import { ANALYZE_MESSAGES, AnalyzeError, runAnalyzeStream, type AnalyzeEndpoint } from '../api/analyzeStream';
import {
  SECTION_LABELS,
  SECTION_NAMES,
  buildMaterialRow,
  flashcardsOf,
  isSectionName,
  requestedSections,
} from '../utils/analysisSections';
import './Analyze.css';

const ANALYSIS_COST = 20;

const initAgents: AgentStatus[] = SECTION_NAMES.map(id => ({ id, label: SECTION_LABELS[id], status: 'idle', progress: 0 }));

/** Что запускали: этим же «Повторить» отправит запрос ещё раз. */
interface RunRequest {
  file: File | null;
  url?: string;
  /** Имя источника для названия материала, если модель не предложит своё. */
  sourceName: string;
  /** Вставленный текст: по нему решается, демо ли это. */
  text?: string;
  /** Настройки панели на момент запуска (для демо не используются). */
  settings: AnalysisSettings;
}

interface SaveContext {
  results: AnalysisResults;
  extractedText: string;
  sourceName: string;
  demo: boolean;
}

interface SaveInfo {
  status: 'idle' | 'saving' | 'saved' | 'failed' | 'existing';
  materialId?: string;
  /** Карточки не дошли до повторения: их можно отправить ещё раз. */
  cardsFailed?: { materialId: string; cards: Flashcard[] };
}

const IDLE_SAVE: SaveInfo = { status: 'idle' };

function enabledSections(settings: AnalysisSettings): SectionName[] {
  // Пустой список бэкенд понимает как «все агенты», включая миссии, поэтому подставляем набор по умолчанию.
  const selected = requestedSections(settings.enabledAgents || []);
  return selected.length > 0 ? selected : requestedSections(DEFAULT_SETTINGS.enabledAgents);
}

function endpointFor(request: RunRequest): AnalyzeEndpoint {
  if (request.url) return '/api/analyze/url';
  const type = request.file?.type || '';
  const isMedia = type.startsWith('video/') || type.startsWith('audio/') || type.startsWith('image/');
  return isMedia ? '/api/analyze/media' : '/api/analyze';
}

function buildFormData(request: RunRequest, settings: AnalysisSettings, requested: SectionName[]): FormData {
  const fd = new FormData();
  if (request.file) fd.append('file', request.file);
  if (request.url) fd.append('url', request.url);
  fd.append('summary_detail', settings.summaryDetail);
  fd.append('flashcard_count', String(settings.flashcardCount));
  fd.append('quiz_count', String(settings.quizCount));
  fd.append('quiz_difficulty', settings.quizDifficulty);
  fd.append('quiz_type', settings.quizType);
  fd.append('enabled_agents', JSON.stringify(requested));
  return fd;
}

interface QuotaState {
  ok: boolean;
  isPro: boolean;
  count: number;
}

/**
 * Строка о расходе дневного лимита под кнопкой запуска. Читается при открытии
 * страницы и после каждого списания (событие AI_USAGE_EVENT). Если прочитать не
 * удалось, число не показываем; у PRO строки нет.
 */
function useAnalysisQuota(userId: string | undefined, cost: number): { costNote?: string; startDisabledReason?: string } {
  const [quota, setQuota] = useState<QuotaState | null>(null);

  useEffect(() => {
    if (!userId) {
      setQuota(null);
      return;
    }
    let cancelled = false;
    const load = () => {
      checkAILimit(userId, 0)
        .then(result => {
          if (!cancelled) setQuota({ ok: result.ok !== false, isPro: Boolean(result.isPro), count: Number(result.count) || 0 });
        })
        .catch(() => {
          if (!cancelled) setQuota({ ok: false, isPro: false, count: 0 });
        });
    };
    load();
    window.addEventListener(AI_USAGE_EVENT, load);
    return () => {
      cancelled = true;
      window.removeEventListener(AI_USAGE_EVENT, load);
    };
  }, [userId]);

  if (!quota || quota.isPro) return {};
  if (!quota.ok) return { costNote: `Анализ расходует ${cost} единиц дневного лимита (${FREE_DAILY_LIMIT} в сутки).` };
  const remaining = Math.max(0, FREE_DAILY_LIMIT - quota.count);
  const resetAt = formatLimitReset(nextLimitReset());
  if (remaining < cost) {
    return { startDisabledReason: `На сегодня лимит исчерпан, он обновится в ${resetAt}. Демо-текст доступен без лимита.` };
  }
  return {
    costNote: `Анализ расходует ${cost} из ${FREE_DAILY_LIMIT} единиц дневного лимита. Осталось ${remaining}, лимит обновится в ${resetAt}.`,
  };
}

const INLINE_ACTION =
  'min-h-[44px] font-semibold text-[var(--sf-accent-fg)] underline-offset-4 enabled:hover:underline disabled:opacity-60';

export default function Analyze() {
  const [state, setState] = useState<AnalysisState>({
    phase: 'upload', agents: initAgents, results: null, settings: DEFAULT_SETTINGS,
  });
  // Источник управляется здесь: ошибка и «Повторить» не теряют вкладку, текст и ссылку.
  const [uploadTab, setUploadTab] = useState<UploadTab>('file');
  const [pastedText, setPastedText] = useState('');
  // Текст пользователя, который заменил демо-текст: его можно вернуть одной кнопкой.
  const [replacedText, setReplacedText] = useState<string | null>(null);
  const [sourceUrl, setSourceUrl] = useState('');
  const [starting, setStarting] = useState(false);
  // Сообщение сервера о долгом шаге (расшифровка медиа, загрузка страницы).
  const [statusNote, setStatusNote] = useState<string | undefined>(undefined);
  const [save, setSave] = useState<SaveInfo>(IDLE_SAVE);
  const [saveBusy, setSaveBusy] = useState(false);

  const { user } = useAuth();
  const navigate = useNavigate();
  const { verifyEnergy } = useEnergyConfirm();

  const inFlightRef = useRef(false);
  // Номер нажатия «Запустить»/«Повторить»: «Назад» и «Отменить» отзывают запуск, который ещё ждёт проверки лимита.
  const startTicketRef = useRef(0);
  const controllerRef = useRef<AbortController | null>(null);
  const runIdRef = useRef(0);
  const mountedRef = useRef(true);
  const lastRequestRef = useRef<RunRequest | null>(null);
  const lastSaveRef = useRef<{ runId: number; context: SaveContext } | null>(null);
  const savedRunsRef = useRef(new Set<number>());
  // Сохранение идёт по своему запуску: долгое сохранение прошлого запуска не мешает новому.
  const savingRunsRef = useRef(new Set<number>());

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      // Уход со страницы останавливает запрос: ничего не сохраняется и не списывается в фоне.
      mountedRef.current = false;
      runIdRef.current += 1;
      controllerRef.current?.abort();
      controllerRef.current = null;
      inFlightRef.current = false;
    };
  }, []);

  const demoReady = uploadTab === 'text' && isDemoText(pastedText);
  const quota = useAnalysisQuota(user?.id, ANALYSIS_COST);

  const isCurrent = (runId: number) => mountedRef.current && runIdRef.current === runId;

  /** Сохраняет годный результат один раз: материал, затем списание, карточки и активность. */
  const saveRun = async (runId: number, context: SaveContext) => {
    const userId = user?.id;
    if (!userId || savedRunsRef.current.has(runId) || savingRunsRef.current.has(runId)) return;
    savingRunsRef.current.add(runId);
    if (isCurrent(runId)) {
      setSaveBusy(true);
      setSave({ status: 'saving' });
    }
    try {
      if (context.demo) {
        const { data: existing, error: lookupError } = await supabase
          .from('materials')
          .select('id')
          .eq('user_id', userId)
          .eq('summary_json->>demo_text_id', DEMO_TEXT_ID)
          .limit(1);
        const existingId = !lookupError && Array.isArray(existing) ? (existing[0] as { id?: string } | undefined)?.id : undefined;
        if (existingId) {
          savedRunsRef.current.add(runId);
          // На экране результат этого запуска, а в библиотеке прежний материал: экран в него не пишет
          // (savedMaterialId не ставится, панель в режиме просмотра).
          if (isCurrent(runId)) {
            setState(prev => ({ ...prev, demoMaterialId: existingId }));
            setSave({ status: 'existing', materialId: existingId });
          }
          return;
        }
      }

      const row = buildMaterialRow({
        userId,
        results: context.results,
        extractedText: context.extractedText,
        sourceName: context.sourceName,
        demoTextId: context.demo ? DEMO_TEXT_ID : null,
      });
      const { data: inserted, error } = await supabase.from('materials').insert(row).select('id').single();
      const materialId = (inserted as { id?: string } | null)?.id;
      if (error || !materialId) {
        console.error('Supabase insert error:', error);
        if (isCurrent(runId)) setSave({ status: 'failed' });
        return;
      }
      savedRunsRef.current.add(runId);
      if (isCurrent(runId)) setState(prev => ({ ...prev, savedMaterialId: materialId }));

      // Энергия списывается только после сохранения и никогда за демо-текст.
      if (!context.demo) await incrementAIUsage(userId, ANALYSIS_COST);

      const cards = flashcardsOf(context.results);
      let cardsFailed: SaveInfo['cardsFailed'];
      if (cards.length > 0) {
        try {
          await syncFlashcards(userId, materialId, cards);
        } catch (syncError) {
          console.error('Flashcards sync error:', syncError);
          cardsFailed = { materialId, cards };
        }
      }
      await recordStudyActivity(userId, 0, 1);
      if (isCurrent(runId)) setSave({ status: 'saved', materialId, cardsFailed });
    } catch (saveError) {
      console.error('Save error:', saveError);
      if (isCurrent(runId) && !savedRunsRef.current.has(runId)) setSave({ status: 'failed' });
    } finally {
      savingRunsRef.current.delete(runId);
      if (isCurrent(runId)) setSaveBusy(false);
    }
  };

  const retrySave = () => {
    const last = lastSaveRef.current;
    if (last) void saveRun(last.runId, last.context);
  };

  const retryCardSync = async () => {
    const pending = save.cardsFailed;
    const userId = user?.id;
    if (!pending || !userId || saveBusy) return;
    setSaveBusy(true);
    try {
      await syncFlashcards(userId, pending.materialId, pending.cards);
      setSave(prev => ({ ...prev, cardsFailed: undefined }));
    } catch (syncError) {
      console.error('Flashcards sync error:', syncError);
    } finally {
      if (mountedRef.current) setSaveBusy(false);
    }
  };

  const handleStreamEvent = (runId: number, event: Record<string, unknown>) => {
    if (runIdRef.current !== runId) return;
    if (event.type === 'status') {
      const message = typeof event.message === 'string' ? event.message.trim() : '';
      if (message && message.length <= 160 && /[А-Яа-яЁё]/.test(message)) setStatusNote(message);
    } else if (event.type === 'text_extracted') {
      if (typeof event.text === 'string' && hasBadWords(event.text)) {
        throw new AnalyzeError('bad_request', 'Текст содержит недопустимые материалы (мат или неприемлемый контент).', false);
      }
      const length = typeof event.length === 'number' ? event.length : undefined;
      setState(prev => ({ ...prev, phase: 'analyzing', textLength: length ?? prev.textLength }));
    } else if (event.type === 'agent_start' && isSectionName(event.agent)) {
      setState(prev => ({
        ...prev,
        phase: prev.phase === 'extracting' ? 'analyzing' : prev.phase,
        agents: prev.agents.map(agent => (agent.id === event.agent ? { ...agent, status: 'running' } : agent)),
      }));
    } else if (event.type === 'agent_done' && isSectionName(event.agent)) {
      const ok = event.status === undefined || event.status === 'ok';
      const progress =
        typeof event.progress === 'number' && typeof event.total === 'number' && event.total > 0 ? event.progress / event.total : 1;
      setState(prev => ({
        ...prev,
        agents: prev.agents.map(agent => (agent.id === event.agent ? { ...agent, status: ok ? 'done' : 'failed', progress } : agent)),
      }));
    }
  };

  const startRun = async (request: RunRequest) => {
    // Защита от двойного запуска ставится до проверки лимита.
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    const ticket = ++startTicketRef.current;
    setStarting(true);

    const demo = request.text !== undefined && isDemoText(request.text);
    const settings = demo ? DEMO_SETTINGS : request.settings;

    if (!demo && user?.id) {
      let allowed = true;
      try {
        allowed = await verifyEnergy(user.id, ANALYSIS_COST, 'Анализ материала');
      } catch {
        allowed = true;
      }
      // Пока шла проверка, пользователь ушёл со страницы или вернулся к выбору источника:
      // этот запуск отозван, флаги уже сброшены тем, кто его отозвал.
      if (!mountedRef.current || startTicketRef.current !== ticket) return;
      if (!allowed) {
        inFlightRef.current = false;
        setStarting(false);
        return;
      }
    }

    lastRequestRef.current = request;
    lastSaveRef.current = null;
    const runId = ++runIdRef.current;
    const controller = new AbortController();
    // Прежний запрос, если он почему-то ещё идёт, не должен продолжаться в фоне.
    controllerRef.current?.abort();
    controllerRef.current = controller;
    const requested = enabledSections(settings);
    const startedAt = Date.now();

    setSave(IDLE_SAVE);
    setSaveBusy(false);
    setStarting(false);
    setStatusNote(undefined);
    setState(prev => ({
      phase: 'extracting',
      agents: initAgents.filter(agent => requested.includes(agent.id as SectionName)),
      results: null,
      settings: prev.settings,
      sourceFileName: request.sourceName,
      isDemo: demo,
    }));

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!isCurrent(runId)) return;
      if (!session?.access_token) throw new AnalyzeError('auth', 'Сессия истекла. Войдите снова.', false);

      const outcome = await runAnalyzeStream({
        endpoint: endpointFor(request),
        body: buildFormData(request, settings, requested),
        token: session.access_token,
        requested,
        onEvent: event => handleStreamEvent(runId, event),
        signal: controller.signal,
      });
      if (outcome.kind === 'aborted' || !isCurrent(runId)) return;

      const duration = Math.round((Date.now() - startedAt) / 1000);
      const context: SaveContext = {
        results: outcome.results,
        extractedText: outcome.extractedText,
        sourceName: request.sourceName,
        demo,
      };
      lastSaveRef.current = { runId, context };
      setState(prev => ({
        ...prev,
        phase: 'done',
        results: outcome.results,
        partial: outcome.kind === 'partial',
        textLength: outcome.textLength || prev.textLength,
        analysisDuration: duration || undefined,
      }));
      inFlightRef.current = false;
      controllerRef.current = null;
      // Сохраняется только годный результат и только один раз (saveRun сам ловит свои ошибки).
      void saveRun(runId, context);
    } catch (error) {
      controller.abort();
      if (!isCurrent(runId)) return;
      if (!(error instanceof AnalyzeError)) console.error('Analyze error:', error);
      const failure = error instanceof AnalyzeError ? error : new AnalyzeError('server', ANALYZE_MESSAGES.server, true);
      setState(prev => ({
        ...prev,
        phase: 'error',
        error: { kind: failure.kind, message: failure.message, retryable: failure.retryable },
      }));
    } finally {
      if (runIdRef.current === runId) {
        inFlightRef.current = false;
        if (controllerRef.current === controller) controllerRef.current = null;
      }
    }
  };

  const handleUpload = (file: File | null, url?: string, options?: UploadOptions) => {
    const text = options?.text;
    const demo = text !== undefined && isDemoText(text);
    const sourceName = demo ? `${DEMO_TITLE}.txt` : options?.sourceName || file?.name || url || 'Без названия';
    void startRun({ file, url, sourceName, text, settings: state.settings });
  };

  const handleDemo = () => {
    if (pastedText.trim() && !isDemoText(pastedText)) setReplacedText(pastedText);
    setUploadTab('text');
    setPastedText(DEMO_TEXT);
  };

  const restoreText = () => {
    if (replacedText === null) return;
    setPastedText(replacedText);
    setReplacedText(null);
  };

  /** Остановить анализ: назад к загрузке, без ошибки, без сохранения. */
  const handleCancel = () => {
    runIdRef.current += 1;
    startTicketRef.current += 1;
    controllerRef.current?.abort();
    controllerRef.current = null;
    inFlightRef.current = false;
    setStarting(false);
    setState(prev => ({ phase: 'upload', agents: initAgents, results: null, settings: prev.settings }));
  };

  /** Назад к выбору источника: настройки, вкладка, текст и ссылка остаются; ждущий запуск отзывается. */
  const backToUpload = () => {
    runIdRef.current += 1;
    startTicketRef.current += 1;
    controllerRef.current?.abort();
    controllerRef.current = null;
    inFlightRef.current = false;
    setStarting(false);
    setSave(IDLE_SAVE);
    setState(prev => ({ phase: 'upload', agents: initAgents, results: null, settings: prev.settings }));
  };

  /** «Новый анализ» после результата: чистый лист, настройки остаются. */
  const startOver = () => {
    setPastedText('');
    setReplacedText(null);
    setSourceUrl('');
    backToUpload();
  };

  const handleRetry = () => {
    const last = lastRequestRef.current;
    if (last) void startRun(last);
  };

  /**
   * Раздел, созданный заново, относится к запуску, на результатах которого его создали.
   * Если на экране уже другой запуск (или страница загрузки), его результат не трогаем:
   * раздел уже сохранён в свой материал.
   */
  const handleResultsChange = (runId: number | undefined, next: AnalysisResults) => {
    const last = lastSaveRef.current;
    if (runId === undefined || !last || last.runId !== runId || !isCurrent(runId)) return;
    setState(prev => ({ ...prev, results: next }));
    lastSaveRef.current = { ...last, context: { ...last.context, results: next } };
  };

  const lastRequest = lastRequestRef.current;
  const chooseAnotherLabel = lastRequest?.text !== undefined
    ? 'Изменить текст'
    : lastRequest?.url
      ? 'Изменить ссылку'
      : 'Выбрать другой файл';

  const notices = (
    <>
      {state.isDemo && save.status === 'saved' && <p>Демо-текст: лимит не списан.</p>}
      {save.status === 'existing' && save.materialId && (
        <p>
          Этот результат не сохранён: демо-материал уже есть в библиотеке.{' '}
          <Link to={`/library/${save.materialId}`} className="font-semibold text-[var(--sf-accent-fg)] underline-offset-4 hover:underline">
            Открыть его
          </Link>
        </p>
      )}
      {save.status === 'failed' && (
        <p role="alert" className="flex flex-wrap items-center gap-x-3">
          Результат не сохранён в библиотеку.
          <button type="button" onClick={retrySave} disabled={saveBusy} className={INLINE_ACTION}>
            Сохранить ещё раз
          </button>
        </p>
      )}
      {save.cardsFailed && (
        <p role="status" className="flex flex-wrap items-center gap-x-3">
          Карточки не добавлены в повторение.
          <button type="button" onClick={() => void retryCardSync()} disabled={saveBusy} className={INLINE_ACTION}>
            Повторить
          </button>
        </p>
      )}
    </>
  );
  const hasNotices = (state.isDemo && save.status === 'saved') || save.status === 'existing' || save.status === 'failed' || Boolean(save.cardsFailed);
  // Результаты на экране принадлежат этому запуску: «Создать … заново» вернёт раздел только ему.
  const shownRunId = lastSaveRef.current?.runId;

  return (
    <div className="az" data-phase={state.phase}>
      <AnimatePresence mode="wait">
        {state.phase === 'upload' && (
          <motion.div key="upload" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -12 }}>
            <UploadZone
              settings={state.settings}
              onSettingsChange={settings => setState(prev => ({ ...prev, settings }))}
              onUpload={handleUpload}
              onDemo={handleDemo}
              onRestoreText={replacedText !== null ? restoreText : undefined}
              tab={uploadTab}
              onTabChange={setUploadTab}
              text={pastedText}
              onTextChange={setPastedText}
              url={sourceUrl}
              onUrlChange={setSourceUrl}
              costNote={demoReady ? undefined : quota.costNote}
              startDisabledReason={demoReady ? undefined : quota.startDisabledReason}
              busy={starting}
            />
          </motion.div>
        )}
        {(state.phase === 'extracting' || state.phase === 'analyzing') && (
          <motion.div key="analyzing" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <AgentCards agents={state.agents} phase={state.phase} isDemo={state.isDemo} onCancel={handleCancel} statusNote={statusNote} />
          </motion.div>
        )}
        {state.phase === 'done' && state.results && (
          <motion.div key="results" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
            <ResultsPanel
              results={state.results}
              onReset={startOver}
              textLength={state.textLength}
              analysisDuration={state.analysisDuration}
              sourceFileName={state.sourceFileName}
              materialId={state.savedMaterialId}
              originalText={lastSaveRef.current?.context.extractedText}
              canEdit
              preview={save.status === 'existing'}
              partial={state.partial}
              onResultsChange={next => handleResultsChange(shownRunId, next)}
              analysisSettings={state.isDemo ? DEMO_SETTINGS : lastRequest?.settings}
              notices={hasNotices ? notices : undefined}
            />
            <div className="az-after">
              <button type="button" onClick={() => navigate('/library')} className="sf-secondary az-pill2">
                Открыть библиотеку
                <span className="az-pill2-dot" aria-hidden="true">
                  <svg viewBox="0 0 24 24" focusable="false">
                    <path d="M5 12h14M13 6l6 6-6 6" />
                  </svg>
                </span>
              </button>
            </div>
          </motion.div>
        )}
        {state.phase === 'error' && state.error && (
          <motion.section
            key="error"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            aria-labelledby="analysis-error-heading"
            className="az-fail"
          >
            <div className="az-fail-art" aria-hidden="true">
              <span className="az-fail-sheet">
                <i />
                <i />
                <i />
              </span>
            </div>
            <div className="az-fail-body">
              <h2 id="analysis-error-heading" className="az-fail-h">
                Анализ не завершён
              </h2>
              <p role="alert" className="az-fail-text">
                {state.error.message}
              </p>
              <div className="az-fail-acts">
                {state.error.kind === 'auth' ? (
                  <Link to="/login" className="sf-primary">
                    Войти
                  </Link>
                ) : state.error.retryable ? (
                  <button type="button" onClick={handleRetry} disabled={starting} aria-busy={starting || undefined} className="sf-primary">
                    Повторить
                  </button>
                ) : null}
                <button type="button" onClick={backToUpload} className="sf-secondary az-back">
                  {chooseAnotherLabel}
                </button>
              </div>
            </div>
          </motion.section>
        )}
      </AnimatePresence>
    </div>
  );
}
