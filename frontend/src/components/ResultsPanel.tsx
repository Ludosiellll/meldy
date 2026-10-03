import { useState, useEffect, useMemo, useRef, type ReactNode } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Copy, Download, RotateCcw, Edit3, Check, X } from 'lucide-react';
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
import FlashcardsView from './FlashcardsView';
import QuizView from './QuizView';
import toast from 'react-hot-toast';
import { updateMaterialTitle } from '../api/materials';
import { syncFlashcards } from '../api/flashcards';
import { httpErrorFromResponse, StreamError, STREAM_MESSAGES } from '../api/sseStream';
import { supabase } from '../lib/supabase';
import { useAuth } from '../hooks/useAuth';
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

type Tab = 'summary' | 'flashcards' | 'quiz' | 'podcast' | 'shorts';

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

function buildHtmlExport(results: AnalysisResults, displayTitle: string): string {
  const date = new Date().toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' });
  const time = new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  
  const cleanSummary = extractCleanContent(results.summarizer);
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
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: 'Inter', 'Segoe UI', system-ui, sans-serif;
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
    font-size: 13px; font-weight: 700;
    color: #0f766e; letter-spacing: 0.05em;
    text-transform: uppercase; margin: 0;
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
const TEXT_ONLY_NOTICE = 'Только текст, конспекта нет. Материал участвует в разметке экзаменов.';
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

/** POST /api/analyze/section: один раздел по исходному тексту, без списания энергии. */
async function requestSection(section: CoreSection, text: string, settings?: AnalysisSettings) {
  let response: Response;
  try {
    response = await fetch('/api/analyze/section', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ section, text: text.slice(0, SECTION_TEXT_LIMIT), settings: settingsBody(settings) }),
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
    <div className="max-w-[36em] text-[var(--sf-ink)]">
      <p className="text-[17px] leading-[26px]">{sectionFailureSentence(section, state)}</p>
      {core && canEdit && onRecreate && (
        <div className="mt-2 flex flex-col items-start gap-1">
          <button type="button" onClick={onRecreate} disabled={!materialId || !hasText || busy} className="sf-link">
            {running ? RECREATE_RUNNING[section as CoreSection] : RECREATE_LABEL[section as CoreSection]}
          </button>
          {!materialId && (
            <p className="text-[15px] leading-[22px] text-[var(--sf-muted)]">Станет доступно, когда материал сохранится в библиотеке.</p>
          )}
          {materialId && !hasText && <p className="text-[15px] leading-[22px] text-[var(--sf-muted)]">У материала нет исходного текста.</p>}
          {error && (
            <p role="alert" className="text-[15px] leading-[22px] text-[var(--sf-ink)]">
              {error}
            </p>
          )}
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
    const withContent = tabs.find(t =>
      t.id === 'summary' ? summaryHasContent : t.id === 'flashcards' ? flashcardCount > 0 : t.id === 'quiz' ? quizCount > 0 : conversationCount > 0,
    );
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

  /** «Создать … заново»: раздел по исходному тексту, сохранение в материал, без списания. */
  const recreateSection = async (section: CoreSection) => {
    const targetId = materialId;
    if (!targetId || runningRef.current || !canEdit || !originalText?.trim()) return;
    runningRef.current = true;
    setRunning(section);
    setSectionErrors(prev => ({ ...prev, [section]: undefined }));
    try {
      const { result, grounding } = await requestSection(section, originalText, analysisSettings);
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
  // У шпаргалки нет вкладки здесь: о сбое говорит строка под заголовком.
  const cheatsheetFailed = isFailed('cheatsheet');
  const hasText = Boolean(originalText?.trim());

  const getContent = () => {
    if (tab === 'summary') return view.summarizer?.content || (view.summarizer as any)?.raw || '';
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

  return (
    <div className={embedded ? 'pb-6' : 'py-4 md:py-6'}>
      {/* У материала «только текст» на странице материала в шапке нечего показать. */}
      {embedded ? (
        // На странице материала (критика 12): строка о недостающем разделе, строка о фрагментах и «Экспорт»
        // ссылкой справа. «Новый анализ» здесь не нужен: «Добавить лекцию» есть в верхней строке, а заливная
        // кнопка на экране одна.
        !(textOnly && !showPartialNotice && !notices) && (
          <header className="no-print flex flex-wrap items-start justify-between gap-x-6 gap-y-1 pt-5">
            <div className="min-w-0 flex-1 space-y-1 text-[15px] leading-[22px] text-[var(--sf-muted)]">
              {!allRequestedOk && <p className="font-medium text-[var(--sf-ink)]">{statusLabel}</p>}
              {/* Ссылки на фрагменты подобраны по совпадению слов, а не проверены: «наиболее похожий фрагмент». */}
              {!textOnly && groundingText ? <p>{groundingText}</p> : null}
              {showPartialNotice && <p role="status">{PARTIAL_NOTICE}</p>}
              {cheatsheetFailed && <p>{sectionFailureSentence('cheatsheet', sections?.cheatsheet)}</p>}
              {notices}
            </div>
            {!textOnly && (
              <div
                // The link keeps its 44 px tap height; the negative margin lines its text up with the first line.
                className="export-menu-container relative -my-[11px] flex"
                onKeyDown={event => {
                  if (event.key === 'Escape' && showExport) {
                    event.preventDefault();
                    setShowExport(false);
                    exportButtonRef.current?.focus();
                  }
                }}
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
                {showExport && (
                  <div className="sf-menu" role="menu" aria-label="Экспорт">
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
                )}
              </div>
            )}
          </header>
        )
      ) : (
        !(embedded && textOnly && !showPartialNotice && !notices) && (
          <header className="border-b border-slate-200 dark:border-slate-800 pb-5 md:pb-6 no-print">
            <div className={`flex flex-col gap-5 ${embedded ? `sm:flex-row sm:items-center ${allRequestedOk ? 'sm:justify-end' : 'sm:justify-between'}` : 'lg:flex-row lg:items-start lg:justify-between'}`}>
              {/* На странице материала названия здесь нет, но о недостающем разделе говорим и здесь:
                  строка без значка, только когда сохранённый статус запрошенного раздела не «готово». */}
              {embedded && !allRequestedOk && (
                <p className="text-base font-medium text-[var(--sf-ink)]">{statusLabel}</p>
              )}
              {!embedded && (
                <div className="min-w-0 flex-1">
                  <div className="mb-2 flex items-center gap-2 text-sm font-medium text-[var(--sf-muted)]">
                    <span
                      className={`h-1.5 w-1.5 rounded-full ${allRequestedOk ? 'bg-emerald-500' : 'bg-[var(--sf-muted)]'}`}
                      aria-hidden="true"
                    />
                    {statusLabel}
                  </div>

                  {isEditing ? (
                    <div className="flex max-w-2xl items-center gap-2">
                      <input
                        type="text"
                        value={editVal}
                        onChange={event => setEditVal(event.target.value)}
                        onKeyDown={event => {
                          if (event.key === 'Enter') saveManualTitle();
                          if (event.key === 'Escape') setIsEditing(false);
                        }}
                        className="min-w-0 flex-1 rounded-lg border border-slate-300 bg-white px-3 py-2 text-lg font-semibold text-slate-900 outline-none focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                        placeholder="Название материала"
                        aria-label="Название материала"
                        autoFocus
                      />
                      <button onClick={saveManualTitle} className="inline-flex h-10 w-10 items-center justify-center rounded-lg bg-teal-600 text-white transition hover:bg-teal-500" aria-label="Сохранить название">
                        <Check className="h-4 w-4" />
                      </button>
                      <button onClick={() => setIsEditing(false)} className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-slate-300 text-slate-500 transition hover:bg-slate-100 dark:border-slate-700 dark:hover:bg-slate-800" aria-label="Отменить изменение">
                        <X className="h-4 w-4" />
                      </button>
                    </div>
                  ) : (
                    <div className="group flex min-w-0 items-start gap-2">
                      <h1 className="max-w-3xl text-balance text-2xl font-semibold leading-tight tracking-[-0.02em] text-slate-950 dark:text-slate-50 md:text-3xl">
                        {currentTitle}
                      </h1>
                      {materialId && canEdit && (
                        <button
                          onClick={() => { setEditVal(currentTitle); setIsEditing(true); }}
                          className="mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-slate-400 opacity-70 transition hover:bg-slate-100 hover:text-teal-700 focus-visible:opacity-100 dark:hover:bg-slate-800 dark:hover:text-teal-300 md:opacity-0 md:group-hover:opacity-100"
                          aria-label="Изменить название"
                        >
                          <Edit3 className="h-4 w-4" />
                        </button>
                      )}
                    </div>
                  )}

                  <div className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-500 dark:text-slate-400">
                    {textLength ? <span>{charactersLabel(textLength)}</span> : null}
                    {textLength && readingMinutes ? <span aria-hidden="true">·</span> : null}
                    {readingMinutes ? <span>около {readingMinutes} мин чтения</span> : null}
                    {exerciseCount > 0 ? <span aria-hidden="true">·</span> : null}
                    {exerciseCount > 0 ? <span>{exerciseCount} {pluralRu(exerciseCount, ['задание', 'задания', 'заданий'])} для практики</span> : null}
                    {!textLength && analysisDuration ? <span>{analysisDuration} сек на обработку</span> : null}
                  </div>
                </div>
              )}

              {!textOnly && (
              <div className="flex w-full items-center gap-2 sm:w-auto sm:justify-end">
                <div className="relative export-menu-container">
                  <button
                    onClick={() => setShowExport(value => !value)}
                    className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-slate-300 bg-transparent px-3 text-sm font-medium text-slate-700 transition hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
                    aria-expanded={showExport}
                  >
                    <Download className="h-4 w-4" />
                    <span>Экспорт</span>
                  </button>

                  <AnimatePresence>
                    {showExport && (
                      <motion.div
                        initial={{ opacity: 0, y: 6 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: 6 }}
                        transition={{ duration: 0.12 }}
                        className="absolute right-0 top-full z-50 mt-2 flex w-56 flex-col gap-1 rounded-lg border border-slate-200 bg-white p-1.5 shadow-xl dark:border-slate-700 dark:bg-slate-850"
                      >
                        <button onClick={() => { handleCopy(); setShowExport(false); }} className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm text-slate-700 transition hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800">
                          <Copy className="h-4 w-4" />{copied ? 'Скопировано' : 'Копировать'}
                        </button>
                        {(tab === 'summary' || tab === 'flashcards' || tab === 'quiz') && (
                          <button onClick={() => { handlePrintPdf(); setShowExport(false); }} className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm text-slate-700 transition hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800">
                            <Download className="h-4 w-4" />Печать или PDF
                          </button>
                        )}
                        {tab === 'flashcards' && flashcardCount > 0 && (
                          <button onClick={() => { handleExportAnki(); setShowExport(false); }} className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm text-slate-700 transition hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800">
                            <Download className="h-4 w-4" />Файл для Anki
                          </button>
                        )}
                        {(tab === 'summary' || tab === 'flashcards' || tab === 'quiz') && (
                          <button onClick={() => { handleDownloadHtml(); setShowExport(false); }} className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm text-slate-700 transition hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800">
                            <Download className="h-4 w-4" />Скачать HTML
                          </button>
                        )}
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>

                <button onClick={onReset} className="inline-flex h-10 flex-1 items-center justify-center gap-2 whitespace-nowrap rounded-lg bg-cyan-400 px-4 text-sm font-semibold text-slate-950 transition hover:bg-cyan-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300 focus-visible:ring-offset-2 focus-visible:ring-offset-white dark:focus-visible:ring-offset-slate-950 sm:flex-none">
                  <RotateCcw className="h-4 w-4" />Новый анализ
                </button>
              </div>
              )}
            </div>

            {/* Ссылки на фрагменты подобраны по совпадению слов, а не проверены: «наиболее похожий фрагмент». */}
            {!textOnly && view.grounding?.source_count ? (
              <p className="mt-4 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-500 dark:text-slate-400">
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
              <div className="mt-4 space-y-1.5 text-sm leading-relaxed text-[var(--sf-muted)]">
                {showPartialNotice && <p role="status">{PARTIAL_NOTICE}</p>}
                {cheatsheetFailed && <p>{sectionFailureSentence('cheatsheet', sections?.cheatsheet)}</p>}
                {notices}
              </div>
            )}
          </header>
        )
      )}

      {textOnly ? (
        <p className="mt-6 max-w-[36em] text-[17px] leading-[26px] text-[var(--sf-ink)]">
          {TEXT_ONLY_NOTICE}
        </p>
      ) : (
        <>
          {tabs.length > 1 && (
            <nav className={`sf-sectabs no-print ${embedded ? 'mt-2' : 'mt-4'}`} aria-label="Разделы результата">
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
          )}

          <motion.div key={tab} initial={{ opacity: 0 }} animate={{ opacity: 1 }} className={`${tabs.length > 1 ? 'pt-6' : 'pt-7'} min-h-[260px] printable-section`}>
            {tab === 'summary' && (
              isFailed('summarizer') ? (
                <SectionFailure {...failureProps('summarizer')} />
              ) : (
                <article className="max-w-[820px]">
                  <SummaryView data={view.summarizer} sources={view.grounding?.sources} />
                </article>
              )
            )}
            {tab === 'flashcards' && (
              isFailed('flashcards') ? (
                <SectionFailure {...failureProps('flashcards')} />
              ) : (
                <>
                  {cardSync && cardSync.materialId === materialId && (
                    <p className="mb-4 flex flex-wrap items-center gap-x-3 text-sm text-[var(--sf-muted)]" role="status">
                      {CARDS_SYNC_FAILED}
                      <button
                        type="button"
                        disabled={cardSyncRunning}
                        onClick={() => void syncCards(cardSync.materialId, cardSync.cards)}
                        className="min-h-[44px] font-semibold text-[var(--sf-accent-fg)] underline-offset-4 enabled:hover:underline disabled:opacity-60"
                      >
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
                {isFailed('podcast') && (
                  <p className="mb-4 text-base text-[var(--sf-ink)]">{sectionFailureSentence('podcast', sections?.podcast)}</p>
                )}
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
