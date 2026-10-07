import { useState, useEffect, useMemo, useRef, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react';
import { motion } from 'framer-motion';
import { Download, Edit3, Check, X } from 'lucide-react';
import type {
  AnalysisResults,
  AnalysisSettings,
  CoreSectionName,
  Flashcard,
  GroundingInfo,
  QuizQuestion,
  SectionName,
  SectionState,
  SectionStates,
  SummaryInfo,
} from '../types';
import SummaryView from './SummaryView';
import { stripSourceMarkers } from './summary/fragmentModel';
import FlashcardsView from './FlashcardsView';
import QuizView from './QuizView';
import toast from 'react-hot-toast';
import { updateMaterialTitle } from '../api/materials';
import { syncFlashcards } from '../api/flashcards';
import { httpErrorFromResponse, StreamError, STREAM_MESSAGES } from '../api/sseStream';
import { supabase } from '../lib/supabase';
import { useAuth } from '../hooks/useAuth';
import { useKeepInView } from '../hooks/useKeepInView';
import { getResultDisplayTitle } from '../utils/resultPresentation';
import {
  PARTIAL_NOTICE,
  SECTION_LABELS,
  flashcardsOf,
  parseGrounding,
  sectionFailureSentence,
  sectionHasContent,
  sectionPayload,
} from '../utils/analysisSections';
import { charactersLabel } from '../utils/pastedText';
import { pluralRu } from './conversation/visuals';
import ConversationPlayer from './conversation/ConversationPlayer';
import { ConversationError, NOT_OWNER_MESSAGE, patchSummaryJson } from './conversation/persistence';
import './ResultsPanel.css';

type Tab = 'summary' | 'flashcards' | 'quiz' | 'podcast';

function extractCleanContent(data: any): string {
  let raw = data?.content || (data as any)?.raw || '';
  if (typeof raw === 'string' && raw.trimStart().startsWith('{')) {
    try {
      const parsed = JSON.parse(raw);
      if (parsed?.content) raw = parsed.content;
    } catch {
      const match = raw.match(/"content"\s*:\s*"([\s\S]*?)(?:"\s*[,}])/);
      if (match) raw = match[1].replace(/\\n/g, '\n').replace(/\\"/g, '"');
    }
  }
  if (!raw && typeof data === 'string') {
    raw = data;
    if (raw.trimStart().startsWith('{')) {
      try {
        const parsed = JSON.parse(raw);
        if (parsed?.content) raw = parsed.content;
      } catch {}
    }
  }
  const jsonTailIdx = raw.search(/\s*[,"]?\s*"terms"\s*:/);
  if (jsonTailIdx > 0) raw = raw.slice(0, jsonTailIdx);
  return raw.trim();
}

function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function parseMarkdownToHtml(md: string): string {
  if (!md) return '';
  let html = escapeHtml(md).replace(/\r\n/g, '\n');
  
  // Headers
  html = html.replace(/^### (.*$)/gim, '<h3>$1</h3>');
  html = html.replace(/^## (.*$)/gim, '<h2>$1</h2>');
  html = html.replace(/^# (.*$)/gim, '<h1>$1</h1>');
  
  // Bold
  html = html.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
  
  // Italic
  html = html.replace(/\*(.*?)\*/g, '<em>$1</em>');
  
  // Bullet lists & numbered lists line-by-line
  let lines = html.split('\n');
  let inList = false;
  let inOrderedList = false;
  
  for (let i = 0; i < lines.length; i++) {
    let line = lines[i].trim();
    if (line.startsWith('* ') || line.startsWith('- ')) {
      let content = line.substring(2);
      if (!inList) {
        lines[i] = '<ul>\n<li>' + content + '</li>';
        inList = true;
      } else {
        lines[i] = '<li>' + content + '</li>';
      }
    } else if (/^\d+\.\s/.test(line)) {
      let content = line.replace(/^\d+\.\s/, '');
      if (!inOrderedList) {
        lines[i] = '<ol>\n<li>' + content + '</li>';
        inOrderedList = true;
      } else {
        lines[i] = '<li>' + content + '</li>';
      }
    } else {
      let extra = '';
      if (inList) {
        extra += '</ul>\n';
        inList = false;
      }
      if (inOrderedList) {
        extra += '</ol>\n';
        inOrderedList = false;
      }
      
      if (line !== '' && !line.startsWith('<h') && !line.startsWith('<ul') && !line.startsWith('<ol') && !line.startsWith('<li')) {
        lines[i] = extra + '<p>' + line + '</p>';
      } else {
        lines[i] = extra + lines[i];
      }
    }
  }
  
  html = lines.join('\n');
  if (inList) html += '\n</ul>';
  if (inOrderedList) html += '\n</ol>';
  
  return html;
}

/**
 * The «Скачать HTML» / «Печать или PDF» document. Self-contained: no web fonts (the print window
 * inherits the page's CSP and a saved file would call Google), the system font stack instead.
 */
export function buildHtmlExport(results: AnalysisResults, displayTitle: string): string {
  const date = new Date().toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' });
  const time = new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  
  const cleanSummary = stripSourceMarkers(extractCleanContent(results.summarizer));
  const summaryHtml = parseMarkdownToHtml(cleanSummary) || '<p style="color:#94a3b8">Нет данных</p>';
  
  const flashcards = results.flashcards?.flashcards || [];
  const quiz = results.quiz?.quiz || [];

  const flashcardsHtml = flashcards.map((c: Flashcard, i: number) =>
    `<div class="card">
      <p class="card-q">Карточка ${i+1}: ${escapeHtml(c.question)}</p>
      <p class="card-a">${escapeHtml(c.answer)}</p>
    </div>`
  ).join('\n');

  const quizHtml = quiz.map((q: QuizQuestion, i: number) => {
    const options = (q.options || []).map((o: string) => {
      const isCorrect = o.startsWith(q.correct);
      return `<li class="${isCorrect ? 'correct' : ''}">${escapeHtml(o)}${isCorrect ? ' ✓' : ''}</li>`;
    }).join('\n');
    return `<div class="card">
      <p class="card-q">${i+1}. ${escapeHtml(q.question)}</p>
      <ul class="opt-list">${options}</ul>
      ${q.explanation ? `<p class="explanation">Пояснение: ${escapeHtml(q.explanation)}</p>` : ''}
    </div>`;
  }).join('\n');

  return `<!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Meldy — ${escapeHtml(displayTitle)}</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
    color: #1e293b;
    line-height: 1.7;
    max-width: 760px;
    margin: 0 auto;
    padding: 48px 32px 64px;
    background: #fff;
    font-size: 15px;
  }
  /* Header */
  .doc-header {
    display: flex;
    align-items: center;
    gap: 12px;
    padding-bottom: 20px;
    margin-bottom: 28px;
    border-bottom: 1px solid #e2e8f0;
  }
  .doc-logo {
    width: 36px; height: 36px;
    background: #0f766e;
    border-radius: 8px;
    display: flex; align-items: center; justify-content: center;
    color: white; font-weight: 900; font-size: 16px;
    letter-spacing: -1px; flex-shrink: 0;
  }
  .doc-header-text h1 {
    font-size: 17px; font-weight: 650;
    color: #20201e; letter-spacing: -0.02em;
    margin: 0;
  }
  .doc-header-text p {
    font-size: 12px; color: #94a3b8; margin: 0;
  }
  /* Material title */
  .doc-title {
    font-size: 22px;
    font-weight: 800;
    color: #0f172a;
    line-height: 1.3;
    margin-bottom: 6px;
  }
  .doc-meta {
    color: #94a3b8;
    font-size: 13px;
    margin-bottom: 36px;
  }
  /* Section headings */
  h2 {
    font-size: 17px;
    font-weight: 700;
    margin: 36px 0 16px;
    padding-bottom: 10px;
    border-bottom: 2px solid #0f766e;
    color: #0f172a;
  }
  h3 {
    font-size: 14px;
    font-weight: 700;
    margin: 18px 0 8px;
    color: #334155;
  }
  p { margin-bottom: 12px; color: #334155; }
  ul, ol { margin-bottom: 16px; padding-left: 22px; color: #334155; }
  li { margin-bottom: 5px; }
  strong { color: #0f172a; font-weight: 600; }
  .section { margin-bottom: 24px; }

  /* Cards (flashcards, quiz) */
  .card {
    margin-bottom: 14px;
    padding: 16px;
    border: 1px solid #e2e8f0;
    border-radius: 10px;
    page-break-inside: avoid;
  }
  .card-q {
    font-weight: 600;
    color: #0f172a;
    margin-bottom: 8px;
    font-size: 14px;
  }
  .card-a {
    color: #334155;
    border-top: 1px solid #f1f5f9;
    padding-top: 8px;
    font-size: 14px;
  }
  .opt-list {
    list-style: none;
    padding: 0;
    margin: 6px 0 0;
  }
  .opt-list li {
    padding: 6px 12px;
    margin: 4px 0;
    border-radius: 6px;
    font-size: 13px;
    background: #f8fafc;
    color: #334155;
  }
  .opt-list li.correct {
    background: #d1fae5;
    font-weight: 600;
    color: #065f46;
  }
  .explanation {
    margin-top: 8px;
    font-style: italic;
    color: #64748b;
    font-size: 13px;
    border-top: 1px solid #f1f5f9;
    padding-top: 8px;
  }
  @media print {
    body { padding: 0 24px; }
    .doc-header { page-break-after: avoid; }
    h2 { page-break-after: avoid; }
    .section { page-break-inside: avoid; }
    .card { page-break-inside: avoid; }
  }
</style>
</head>
<body>
<div class="doc-header">
  <div class="doc-logo">M</div>
  <div class="doc-header-text">
    <h1>Meldy</h1>
    <p>Материал подготовлен ${date}, ${time}</p>
  </div>
</div>

<h2 class="doc-title" style="border:none;margin-top:0;padding-bottom:0;font-size:22px">${escapeHtml(displayTitle)}</h2>
<p class="doc-meta">${date}</p>

<div class="section">
<h2>Конспект</h2>
<div style="line-height:1.8">${summaryHtml}</div>
</div>

${flashcards.length > 0 ? `<div class="section">
<h2>Карточки (${flashcards.length})</h2>
${flashcardsHtml}
</div>` : ''}

${quiz.length > 0 ? `<div class="section">
<h2>Тест (${quiz.length})</h2>
${quizHtml}
</div>` : ''}

</body>
</html>`;
}

type CoreSection = CoreSectionName;

const RECREATE_LABEL: Record<CoreSection, string> = {
  summarizer: 'Создать конспект заново',
  flashcards: 'Создать карточки заново',
  quiz: 'Создать тест заново',
};

const RECREATE_RUNNING: Record<CoreSection, string> = {
  summarizer: 'Создаём конспект…',
  flashcards: 'Создаём карточки…',
  quiz: 'Создаём тест…',
};

/** Сервер принимает до 300 000 символов: столько же видел и сам анализ. */
const SECTION_TEXT_LIMIT = 300_000;
const SECTION_SAVE_ERROR = 'Раздел создан, но сохранить его не удалось. Попробуйте ещё раз.';
const TEXT_ONLY_NOTICE = 'Только текст, конспекта нет. Материал участвует в сверке экзаменов с лекциями.';
const CARDS_SYNC_FAILED = 'Карточки не добавлены в повторение.';

/** Ответы ИИ-сервиса с кодом (AIError): 5xx-тексты сервера не показываются, но код говорит, что случилось. */
const AI_ERROR_MESSAGES: Record<string, string> = {
  ai_busy: 'Сервис ИИ сейчас занят. Подождите минуту и попробуйте ещё раз.',
  ai_failed: 'ИИ-сервис сейчас не ответил. Попробуйте ещё раз.',
  ai_timeout: 'ИИ-сервис не ответил вовремя. Попробуйте ещё раз.',
  ai_unconfigured: 'ИИ-сервис временно недоступен.',
};

function sectionErrorMessage(error: unknown): string {
  if (error instanceof StreamError && error.code && AI_ERROR_MESSAGES[error.code]) return AI_ERROR_MESSAGES[error.code];
  if (error instanceof StreamError || error instanceof ConversationError || error instanceof Error) return error.message;
  return 'Не удалось создать раздел. Попробуйте ещё раз.';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function settingsBody(settings?: AnalysisSettings) {
  if (!settings) return undefined;
  return {
    summary_detail: settings.summaryDetail,
    flashcard_count: settings.flashcardCount,
    quiz_count: settings.quizCount,
    quiz_difficulty: settings.quizDifficulty,
    quiz_type: settings.quizType,
  };
}

/**
 * POST /api/analyze/section: один раздел по исходному тексту. Раздел, который не получился в анализе
 * своего материала, сервер создаёт бесплатно по сохранённому тексту (по material_id); иначе — по цене
 * AI_COSTS.analysisSection (lib/plans.ts).
 */
async function requestSection(section: CoreSection, text: string, materialId: string, settings?: AnalysisSettings) {
  let response: Response;
  try {
    response = await fetch('/api/analyze/section', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        section,
        text: text.slice(0, SECTION_TEXT_LIMIT),
        material_id: materialId,
        settings: settingsBody(settings),
      }),
    });
  } catch {
    throw new Error(STREAM_MESSAGES.network);
  }
  if (!response.ok) throw await httpErrorFromResponse(response);
  let data: unknown;
  try {
    data = await response.json();
  } catch {
    throw new Error('Сервер вернул непонятный ответ. Попробуйте ещё раз.');
  }
  if (!isRecord(data) || !sectionHasContent(section, data.result)) {
    throw new Error('Модель вернула пустой ответ. Попробуйте ещё раз.');
  }
  return { result: data.result as Record<string, unknown>, grounding: parseGrounding(data.grounding) };
}

/** Запись раздела в materials: сначала содержимое, затем статус в summary_json.sections. */
async function persistSection(
  materialId: string,
  section: CoreSection,
  result: Record<string, unknown>,
  sections: SectionStates,
  grounding?: GroundingInfo,
) {
  const extra: Record<string, unknown> = grounding ? { grounding } : {};
  if (section === 'summarizer') {
    await patchSummaryJson(
      materialId,
      {
        content: typeof result.content === 'string' ? result.content : '',
        terms: Array.isArray(result.terms) ? result.terms : [],
        source_ids: Array.isArray(result.source_ids) ? result.source_ids : [],
        sections,
        ...extra,
      },
      SECTION_SAVE_ERROR,
    );
    return;
  }
  const column = section === 'flashcards' ? 'flashcards_json' : 'quiz_json';
  const { data, error } = await supabase.from('materials').update({ [column]: result }).eq('id', materialId).select('id');
  if (error) throw new Error(SECTION_SAVE_ERROR);
  if (Array.isArray(data) && data.length === 0) throw new Error(NOT_OWNER_MESSAGE);
  try {
    await patchSummaryJson(materialId, { sections, ...extra }, SECTION_SAVE_ERROR);
  } catch (statusError) {
    // Содержимое уже сохранено и показывается; статус раздела обновится при следующей записи.
    console.warn('Не удалось обновить статус раздела', statusError);
  }
}

function SectionFailure({
  section,
  state,
  canEdit,
  materialId,
  hasText,
  running,
  busy,
  error,
  onRecreate,
}: {
  section: SectionName;
  state?: SectionState;
  canEdit: boolean;
  materialId?: string;
  hasText: boolean;
  running: boolean;
  busy: boolean;
  error?: string;
  onRecreate?: () => void;
}) {
  const core = section === 'summarizer' || section === 'flashcards' || section === 'quiz';
  // Spec 4.6: the failure sits on the page, left-aligned, without a card, red or a spinner; the link says what it does.
  return (
    <div className="rp-failure">
      <p>{sectionFailureSentence(section, state)}</p>
      {core && canEdit && onRecreate && (
        <div className="rp-failure-acts">
          <button type="button" onClick={onRecreate} disabled={!materialId || !hasText || busy} className="sf-link">
            {running ? RECREATE_RUNNING[section as CoreSection] : RECREATE_LABEL[section as CoreSection]}
          </button>
          {!materialId && <p>Станет доступно, когда материал сохранится в библиотеке.</p>}
          {materialId && !hasText && <p>У материала нет исходного текста.</p>}
          {error && <p role="alert">{error}</p>}
        </div>
      )}
    </div>
  );
}

export default function ResultsPanel({
  results,
  onReset,
  textLength,
  analysisDuration,
  sourceFileName,
  materialId: savedMaterialId,
  embedded = false,
  originalText,
  canEdit: ownerCanEdit = true,
  preview = false,
  partial = false,
  onResultsChange,
  analysisSettings,
  notices,
  initialTab,
}: {
  results: AnalysisResults;
  onReset: () => void;
  textLength?: number;
  analysisDuration?: number;
  sourceFileName?: string;
  materialId?: string;
  /**
   * Панель на странице материала: шапка без названия, а у разговора там свой режим
   * «Разговор», поэтому своей вкладки «Разговор» и строки о нём панель не показывает.
   */
  embedded?: boolean;
  /** Исходный текст материала: по нему «Создать … заново» просит раздел у сервера. */
  originalText?: string;
  /** Менять материал может только автор; иначе кнопки «заново» не показываются. */
  canEdit?: boolean;
  /**
   * Результат не сохранён и не будет сохранён (повторный демо-запуск: демо-материал уже
   * в библиотеке). Панель ничего никуда не пишет: ни разделы, ни название, ни попытки теста.
   */
  preview?: boolean;
  /** Связь прервалась: показаны только разделы, которые успели прийти. */
  partial?: boolean;
  /**
   * Раздел section создан заново и сохранён: родитель обновляет свои данные. Вызывается и
   * после ухода с панели; в results у остальных разделов то, что было на экране при нажатии.
   */
  onResultsChange?: (results: AnalysisResults, section: CoreSectionName) => void;
  /** Настройки запуска для повторного запроса раздела (если известны). */
  analysisSettings?: AnalysisSettings;
  /** Строки о сохранении под заголовком (их показывает страница анализа). */
  notices?: ReactNode;
  /** Вкладка, с которой открыть панель (ссылки из «Прогресса»), если в ней есть содержимое. */
  initialTab?: 'summary' | 'flashcards' | 'quiz';
}) {
  const { user } = useAuth();
  // В режиме просмотра у результата нет материала, в который можно писать.
  const materialId = preview ? undefined : savedMaterialId;
  const canEdit = ownerCanEdit && !preview;
  // На странице материала разговор живёт в своём режиме «Разговор».
  const showConversation = !embedded;
  // Раздел, созданный заново, показывается сразу, даже если родитель не обновил результат.
  const [override, setOverride] = useState<AnalysisResults | null>(null);
  useEffect(() => setOverride(null), [results]);
  const view = override ?? results;
  const sections = view.sections;
  const textOnly = view.text_only === true;
  // Ответ модели может прийти, когда панели уже нет на экране: тогда без её состояния и тостов.
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const [running, setRunning] = useState<CoreSection | null>(null);
  const runningRef = useRef(false);
  const [sectionErrors, setSectionErrors] = useState<Partial<Record<CoreSection, string>>>({});
  const [cardSync, setCardSync] = useState<{ materialId: string; cards: Flashcard[] } | null>(null);
  const [cardSyncRunning, setCardSyncRunning] = useState(false);

  const [copied, setCopied] = useState(false);
  const [showExport, setShowExport] = useState(false);
  const exportButtonRef = useRef<HTMLButtonElement | null>(null);
  // On a phone «Экспорт» stands at the left of its row: the menu, laid along its right edge, comes back on screen.
  const exportMenuRef = useRef<HTMLDivElement>(null);
  useKeepInView(exportMenuRef, showExport);

  const derivedTitle = useMemo(
    () => getResultDisplayTitle(view, sourceFileName),
    [view, sourceFileName],
  );
  const [currentTitle, setCurrentTitle] = useState(derivedTitle);
  const [isEditing, setIsEditing] = useState(false);
  const [editVal, setEditVal] = useState(derivedTitle);

  const flashcardCount = view.flashcards?.flashcards?.length || 0;
  const quizCount = view.quiz?.quiz?.length || 0;
  // Реплики разговора после «Добавить схемы» живут здесь, пока результат на экране.
  const [conversationOverride, setConversationOverride] = useState<unknown[] | null>(null);
  useEffect(() => setConversationOverride(null), [view.podcast]);
  // Схемы, подобранные для прежнего результата, не должны попасть в новый.
  const materialIdRef = useRef(materialId);
  materialIdRef.current = materialId;
  const handleConversationLines = (lines: unknown[]) => {
    if (materialIdRef.current !== materialId) return;
    setConversationOverride(lines);
  };
  const conversationLines: unknown[] = conversationOverride
    ?? (Array.isArray(view.podcast?.podcast) ? view.podcast.podcast : []);
  const conversationCount = conversationLines.filter(
    line => typeof line === 'object' && line !== null && typeof (line as { text?: unknown }).text === 'string',
  ).length;
  const exerciseCount = flashcardCount + quizCount;
  const readingMinutes = textLength ? Math.max(1, Math.round(textLength / 800)) : null;

  /** Раздел запрошен, не получился и содержимого нет — показываем строку о сбое. */
  const isFailed = (name: SectionName): boolean => {
    const state = sections?.[name];
    if (!state || state.status === 'ok') return false;
    if (name === 'podcast') return showConversation && conversationCount === 0;
    return !sectionHasContent(name, sectionPayload(view, name));
  };
  const summaryHasContent = Boolean(view.summarizer?.content || (view.summarizer as { raw?: string })?.raw);

  const tabs = useMemo(() => {
    const rawTabs: { id: Tab; label: string; count?: number }[] = [
      { id: 'summary', label: 'Конспект' },
      { id: 'flashcards', label: 'Карточки', count: flashcardCount },
      { id: 'quiz', label: 'Тест', count: quizCount },
      { id: 'podcast', label: 'Разговор', count: conversationCount },
    ];
    if (textOnly) return [];
    return rawTabs.filter(t => {
      if (t.id === 'summary') return summaryHasContent || isFailed('summarizer');
      if (t.id === 'flashcards') return flashcardCount > 0 || isFailed('flashcards');
      if (t.id === 'quiz') return quizCount > 0 || isFailed('quiz');
      if (t.id === 'podcast') return showConversation && (conversationCount > 0 || isFailed('podcast'));
      return true;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, flashcardCount, quizCount, conversationCount, summaryHasContent, textOnly, showConversation]);

  // Первой открывается вкладка с содержимым, а не строка о сбое.
  const [tab, setTab] = useState<Tab>(() => {
    const hasContent = (id: Tab) =>
      id === 'summary' ? summaryHasContent : id === 'flashcards' ? flashcardCount > 0 : id === 'quiz' ? quizCount > 0 : conversationCount > 0;
    if (initialTab && tabs.some(t => t.id === initialTab) && hasContent(initialTab)) return initialTab;
    const withContent = tabs.find(t => hasContent(t.id));
    return withContent?.id ?? tabs[0]?.id ?? 'summary';
  });

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (!(e.target as Element).closest('.export-menu-container')) {
        setShowExport(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    if (tabs.length > 0 && !tabs.find(t => t.id === tab)) {
      setTab(tabs[0].id);
    }
  }, [tab, tabs]);

  useEffect(() => {
    setCurrentTitle(derivedTitle);
    setEditVal(derivedTitle);
  }, [derivedTitle]);

  const saveManualTitle = async () => {
    if (!materialId || !editVal.trim()) return;
    try {
      await updateMaterialTitle(materialId, editVal.trim());
      setCurrentTitle(editVal.trim());
      setIsEditing(false);
      toast.success('Название сохранено');
    } catch (e) {
      toast.error('Не удалось сохранить название');
    }
  };

  const syncCards = async (targetId: string, cards: Flashcard[]) => {
    if (!user?.id || cards.length === 0) return;
    setCardSyncRunning(true);
    try {
      await syncFlashcards(user.id, targetId, cards);
      setCardSync(null);
    } catch (syncError) {
      console.error(syncError);
      setCardSync({ materialId: targetId, cards });
    } finally {
      setCardSyncRunning(false);
    }
  };

  /** «Создать … заново»: раздел по исходному тексту, сохранение в материал (починка — без списания). */
  const recreateSection = async (section: CoreSection) => {
    const targetId = materialId;
    if (!targetId || runningRef.current || !canEdit || !originalText?.trim()) return;
    runningRef.current = true;
    setRunning(section);
    setSectionErrors(prev => ({ ...prev, [section]: undefined }));
    try {
      const { result, grounding } = await requestSection(section, originalText, targetId, analysisSettings);
      const nextSections: SectionStates = { ...(view.sections ?? {}), [section]: { status: 'ok' } };
      const missingGrounding = !view.grounding && grounding ? grounding : undefined;
      await persistSection(targetId, section, result, nextSections, missingGrounding);
      // Панель уже показывает другой материал: этот раздел сохранён в своём, здесь его не показываем.
      if (materialIdRef.current !== targetId) return;

      const merged: AnalysisResults = { ...view, sections: nextSections };
      if (missingGrounding) merged.grounding = missingGrounding;
      if (section === 'summarizer') {
        merged.summarizer = {
          ...view.summarizer,
          content: typeof result.content === 'string' ? result.content : '',
          terms: Array.isArray(result.terms) ? (result.terms as SummaryInfo['terms']) : [],
          source_ids: Array.isArray(result.source_ids) ? (result.source_ids as string[]) : [],
          subject: view.summarizer?.subject || (typeof result.subject === 'string' ? result.subject : ''),
        };
      } else if (section === 'flashcards') {
        merged.flashcards = result as unknown as AnalysisResults['flashcards'];
      } else {
        merged.quiz = result as unknown as AnalysisResults['quiz'];
      }
      if (mountedRef.current) {
        setOverride(merged);
        setTab(section === 'summarizer' ? 'summary' : section);
        toast.success(`${SECTION_LABELS[section]} ${section === 'flashcards' ? 'готовы' : 'готов'}`);
      }
      // Родитель решает сам, относится ли результат к тому, что он сейчас показывает.
      onResultsChange?.(merged, section);

      // Карточки сохранённого раздела попадают в повторение, даже если панель уже закрыта.
      if (section === 'flashcards') await syncCards(targetId, flashcardsOf(merged));
    } catch (sectionError) {
      setSectionErrors(prev => ({ ...prev, [section]: sectionErrorMessage(sectionError) }));
    } finally {
      runningRef.current = false;
      setRunning(null);
    }
  };

  const allRequestedOk = !sections || (Object.keys(sections) as SectionName[]).every(name => !isFailed(name));
  const statusLabel = allRequestedOk ? 'Материал обработан' : 'Обработан частично';
  // Строка об обрыве связи нужна, пока какого-то раздела не хватает.
  const showPartialNotice = partial && !allRequestedOk;
  // У выжимки нет вкладки здесь: о сбое говорит строка под заголовком.
  const cheatsheetFailed = isFailed('cheatsheet');
  const hasText = Boolean(originalText?.trim());

  const getContent = () => {
    if (tab === 'summary') return stripSourceMarkers(view.summarizer?.content || (view.summarizer as any)?.raw || '');
    if (tab === 'flashcards') return JSON.stringify(view.flashcards?.flashcards || view.flashcards, null, 2);
    if (tab === 'podcast') {
      return conversationLines
        .map(line => line as { speaker?: unknown; text?: unknown })
        .filter(line => typeof line.text === 'string')
        .map(line => `${typeof line.speaker === 'string' && line.speaker ? `${line.speaker}: ` : ''}${line.text}`)
        .join('\n\n');
    }
    return JSON.stringify(view.quiz?.quiz || view.quiz, null, 2);
  };

  const handleCopy = () => { navigator.clipboard.writeText(getContent()); setCopied(true); setTimeout(() => setCopied(false), 2000); };

  const handleDownloadHtml = () => {
    const baseName = currentTitle.replace(/[\\/:*?"<>|]+/g, '_');
    const dateStr = new Date().toISOString().slice(0, 10);
    const html = buildHtmlExport(view, currentTitle);
    const b = new Blob([html], { type: 'text/html' });
    const u = URL.createObjectURL(b);
    const a = document.createElement('a');
    a.href = u;
    a.download = `meldy_${baseName}_${dateStr}.html`;
    a.click();
    URL.revokeObjectURL(u);
  };

  const handleExportAnki = () => {
    try {
      const cards = view.flashcards?.flashcards || view.flashcards || [];
      const tsv = cards.map((c: any) => `${c.question.replace(/\n/g, ' ')}\t${c.answer.replace(/\n/g, '<br>')}`).join('\n');
      
      const b = new Blob([tsv], { type: 'text/tab-separated-values;charset=utf-8' });
      const u = URL.createObjectURL(b);
      const a = document.createElement('a');
      a.href = u;
      const baseName = (sourceFileName || 'deck').replace(/\.[^.]+$/, '');
      a.download = `meldy_${baseName}.txt`;
      a.click();
      URL.revokeObjectURL(u);
    } catch (err) {
      console.error(err);
      toast.error('Ошибка при экспорте Anki');
    }
  };

  const handlePrintPdf = () => {
    // Build a standalone printable HTML page in isolation so that none of the
    // app's UI (sidebar, header, audio players, etc.) leaks into the PDF.
    const html = buildHtmlExport(view, currentTitle);
    const win = window.open('', '_blank', 'width=900,height=700');
    if (!win) {
      toast.error('Разрешите открытие всплывающих окон в браузере для печати.');
      return;
    }
    win.document.write(html);
    win.document.close();
    // Small delay to allow fonts/styles to load before printing
    setTimeout(() => {
      win.focus();
      win.print();
    }, 600);
  };

  // Попытка теста попадает в журнал этого материала (QuizView: materialId, topic, surface).
  // null — материал ещё сохраняется; в режиме просмотра журнала нет вовсе (materialId не передаётся).
  // «Основано на 22 фрагментах исходника · у 3 пунктов есть ссылка на наиболее похожий фрагмент».
  const sourceCount = view.grounding?.source_count ?? 0;
  const citable = view.grounding?.citable_items ?? 0;
  const groundingText = sourceCount
    ? `Основано на ${sourceCount} ${sourceCount % 10 === 1 && sourceCount % 100 !== 11 ? 'фрагменте' : 'фрагментах'} исходника${
        citable > 0 ? ` · у ${citable} ${pluralRu(citable, ['пункта', 'пунктов', 'пунктов'])} есть ссылка на наиболее похожий фрагмент` : ''
      }`
    : '';

  const quizJournal: { materialId?: string | null; topic: string; surface: 'analysis' | 'material' } = {
    materialId: preview ? undefined : materialId ?? null,
    topic: view.summarizer?.subject || currentTitle,
    surface: embedded ? 'material' : 'analysis',
  };

  const failureProps = (section: CoreSection) => ({
    section,
    state: sections?.[section],
    canEdit,
    materialId,
    hasText,
    running: running === section,
    busy: running !== null,
    error: sectionErrors[section],
    onRecreate: () => void recreateSection(section),
  });

  // On the material page «Экспорт» stands at the end of the tab row when there is one: a row of its own just for
  // the link pushed the summary 50 px down (1280×720 projector).
  const exportInTabs = embedded && !textOnly && tabs.length > 1;
  const headerHasText = Boolean(
    !allRequestedOk || (!textOnly && groundingText && tab !== 'summary') || showPartialNotice || cheatsheetFailed || notices,
  );
  const exportMenu = showExport && (
    <div ref={exportMenuRef} className="sf-menu rp-export-menu" role="menu" aria-label="Экспорт">
      <button type="button" role="menuitem" onClick={() => { handleCopy(); setShowExport(false); }}>
        {copied ? 'Скопировано' : 'Копировать'}
      </button>
      {(tab === 'summary' || tab === 'flashcards' || tab === 'quiz') && (
        <button type="button" role="menuitem" onClick={() => { handlePrintPdf(); setShowExport(false); }}>
          Печать или PDF
        </button>
      )}
      {tab === 'flashcards' && flashcardCount > 0 && (
        <button type="button" role="menuitem" onClick={() => { handleExportAnki(); setShowExport(false); }}>
          Файл для Anki
        </button>
      )}
      {(tab === 'summary' || tab === 'flashcards' || tab === 'quiz') && (
        <button type="button" role="menuitem" onClick={() => { handleDownloadHtml(); setShowExport(false); }}>
          Скачать HTML
        </button>
      )}
    </div>
  );
  const closeExportOnEscape = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape' && showExport) {
      event.preventDefault();
      setShowExport(false);
      exportButtonRef.current?.focus();
    }
  };
  // On the material page «Экспорт» is a quiet link (one filled button per screen); on the analysis page a white pill.
  const exportControl = (
    <div
      // The link keeps its 44 px tap height; next to the header text the negative margin lines it up with the first line.
      className={`export-menu-container relative flex ${exportInTabs ? '' : '-my-[11px]'}`}
      onKeyDown={closeExportOnEscape}
    >
      <button
        ref={exportButtonRef}
        type="button"
        className="sf-link"
        data-muted=""
        aria-haspopup="menu"
        aria-expanded={showExport}
        onClick={() => setShowExport(value => !value)}
      >
        Экспорт
      </button>
      {exportMenu}
    </div>
  );

  return (
    <div className={embedded ? 'pb-6' : 'py-4 md:py-6'}>
      {/* У материала «только текст» на странице материала в шапке нечего показать. */}
      {embedded ? (
        // На странице материала (критика 12): строка о недостающем разделе, строка о фрагментах и «Экспорт»
        // ссылкой справа. «Новый анализ» здесь не нужен: «Разобрать лекцию» есть в верхней строке, а заливная
        // кнопка на экране одна.
        (textOnly ? Boolean(showPartialNotice || notices) : headerHasText || !exportInTabs) && (
          <header className="no-print rp-head">
            <div className="rp-notes">
              {!allRequestedOk && <p className="rp-status">{statusLabel}</p>}
              {/* Ссылки на фрагменты подобраны по совпадению слов, а не проверены: «наиболее похожий фрагмент». */}
              {/* On «Конспект» the fragments stand next to the sections and say so themselves. */}
              {!textOnly && groundingText && tab !== 'summary' ? <p>{groundingText}</p> : null}
              {showPartialNotice && <p role="status">{PARTIAL_NOTICE}</p>}
              {cheatsheetFailed && <p>{sectionFailureSentence('cheatsheet', sections?.cheatsheet)}</p>}
              {notices}
            </div>
            {!textOnly && !exportInTabs && exportControl}
          </header>
        )
      ) : (
        // На странице анализа: статус пилюлей с точкой, крупное название, одна строка о тексте; «Экспорт» и «Новый анализ».
        <header className="rp-result-head no-print">
          <div className="rp-result-top">
            <div className="rp-result-main">
              <p className="rp-status" data-tone={allRequestedOk ? 'ok' : 'partial'}>
                {statusLabel}
              </p>

              {isEditing ? (
                <div className="rp-title-edit">
                  <input
                    type="text"
                    value={editVal}
                    onChange={event => setEditVal(event.target.value)}
                    onKeyDown={event => {
                      if (event.key === 'Enter') saveManualTitle();
                      if (event.key === 'Escape') setIsEditing(false);
                    }}
                    placeholder="Название материала"
                    aria-label="Название материала"
                    autoFocus
                  />
                  <button type="button" onClick={saveManualTitle} className="rp-round" data-tone="ok" aria-label="Сохранить название">
                    <Check aria-hidden="true" strokeWidth={2} />
                  </button>
                  <button type="button" onClick={() => setIsEditing(false)} className="rp-round" aria-label="Отменить изменение">
                    <X aria-hidden="true" strokeWidth={2} />
                  </button>
                </div>
              ) : (
                <div className="rp-title-row">
                  <h1 className="rp-title">{currentTitle}</h1>
                  {materialId && canEdit && (
                    <button
                      type="button"
                      onClick={() => { setEditVal(currentTitle); setIsEditing(true); }}
                      className="rp-edit"
                      aria-label="Изменить название"
                    >
                      <Edit3 aria-hidden="true" strokeWidth={1.75} />
                    </button>
                  )}
                </div>
              )}

              <div className="rp-meta">
                {textLength ? <span>{charactersLabel(textLength)}</span> : null}
                {textLength && readingMinutes ? <span aria-hidden="true">·</span> : null}
                {readingMinutes ? <span>около {readingMinutes} мин чтения</span> : null}
                {exerciseCount > 0 ? <span aria-hidden="true">·</span> : null}
                {exerciseCount > 0 ? <span>{exerciseCount} {pluralRu(exerciseCount, ['задание', 'задания', 'заданий'])} для практики</span> : null}
                {!textLength && analysisDuration ? <span>{analysisDuration} сек на обработку</span> : null}
              </div>
            </div>

            {!textOnly && (
              <div className="rp-result-acts">
                <div className="export-menu-container relative" onKeyDown={closeExportOnEscape}>
                  <button
                    ref={exportButtonRef}
                    type="button"
                    className="rp-export-pill"
                    aria-haspopup="menu"
                    aria-expanded={showExport}
                    onClick={() => setShowExport(value => !value)}
                  >
                    <Download aria-hidden="true" strokeWidth={1.75} />
                    Экспорт
                  </button>
                  {exportMenu}
                </div>
                <button type="button" onClick={onReset} className="sf-primary">
                  Новый анализ
                </button>
              </div>
            )}
          </div>

          {/* Ссылки на фрагменты подобраны по совпадению слов, а не проверены: «наиболее похожий фрагмент». */}
          {!textOnly && view.grounding?.source_count ? (
            <p className="rp-grounding">
              <span>
                Основано на {view.grounding.source_count}{' '}
                {view.grounding.source_count % 10 === 1 && view.grounding.source_count % 100 !== 11 ? 'фрагменте' : 'фрагментах'} исходника
              </span>
              {view.grounding.citable_items > 0 ? (
                <>
                  <span aria-hidden="true">·</span>
                  <span>
                    у {view.grounding.citable_items} {pluralRu(view.grounding.citable_items, ['пункта', 'пунктов', 'пунктов'])} есть
                    ссылка на наиболее похожий фрагмент
                  </span>
                </>
              ) : null}
            </p>
          ) : null}

          {(showPartialNotice || cheatsheetFailed || notices) && (
            <div className="rp-result-notes">
              {showPartialNotice && <p role="status">{PARTIAL_NOTICE}</p>}
              {cheatsheetFailed && <p>{sectionFailureSentence('cheatsheet', sections?.cheatsheet)}</p>}
              {notices}
            </div>
          )}
        </header>
      )}

      {textOnly ? (
        <p className="rp-text-only">{TEXT_ONLY_NOTICE}</p>
      ) : (
        <>
          {tabs.length > 1 && (
            <div className="no-print rp-tabsrow" data-tight={embedded && headerHasText ? '' : undefined}>
              <nav className="sf-sectabs" aria-label="Разделы результата">
                {tabs.map(item => {
                  const isActive = tab === item.id;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => setTab(item.id)}
                      aria-current={isActive ? 'page' : undefined}
                    >
                      <span className="sf-sectab-label">{item.label}</span>
                      {item.count ? <span className="sf-tabs-n">{item.count}</span> : null}
                    </button>
                  );
                })}
              </nav>
              {exportInTabs && exportControl}
            </div>
          )}

          <motion.div
            key={tab}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="rp-body printable-section"
            data-single={tabs.length > 1 ? undefined : ''}
          >
            {tab === 'summary' && (
              isFailed('summarizer') ? (
                <SectionFailure {...failureProps('summarizer')} />
              ) : (
                <article>
                  <SummaryView data={view.summarizer} sources={view.grounding?.sources} card />
                </article>
              )
            )}
            {tab === 'flashcards' && (
              isFailed('flashcards') ? (
                <SectionFailure {...failureProps('flashcards')} />
              ) : (
                <>
                  {cardSync && cardSync.materialId === materialId && (
                    <p className="rp-sync" role="status">
                      {CARDS_SYNC_FAILED}
                      <button type="button" disabled={cardSyncRunning} onClick={() => void syncCards(cardSync.materialId, cardSync.cards)}>
                        Повторить
                      </button>
                    </p>
                  )}
                  <FlashcardsView data={view.flashcards} sources={view.grounding?.sources} />
                </>
              )
            )}
            {tab === 'quiz' && (
              isFailed('quiz') ? (
                <SectionFailure {...failureProps('quiz')} />
              ) : (
                <QuizView data={view.quiz} sources={view.grounding?.sources} {...quizJournal} />
              )
            )}
            {tab === 'podcast' && (
              <>
                {isFailed('podcast') && <p className="rp-podcast-failed">{sectionFailureSentence('podcast', sections?.podcast)}</p>}
                <ConversationPlayer
                  lines={conversationLines}
                  title={currentTitle}
                  terms={view.summarizer?.terms}
                  flashcards={view.flashcards?.flashcards}
                  sources={view.grounding?.sources}
                  materialId={materialId}
                  onLinesUpdate={handleConversationLines}
                  canEdit={canEdit}
                />
              </>
            )}
          </motion.div>
        </>
      )}
    </div>
  );
}
