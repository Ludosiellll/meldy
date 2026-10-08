import type { AnalysisResults, SectionName } from '../types';
import { sectionHasContent, sectionPayload } from '../utils/analysisSections';

/**
 * The sections of an analysis result as tabs: «Конспект · Карточки 6 · Тест 5» (and «Подкаст» on the analysis
 * page). ResultsPanel draws them in its own row; the lecture page on a phone draws them in its one row of tabs
 * next to its own «Подкаст» (10_Project/Phone_Declutter_2026-10-08), so both read the list from here.
 */
export type ResultTab = 'summary' | 'flashcards' | 'quiz' | 'podcast';

export interface ResultTabInfo {
  id: ResultTab;
  label: string;
  count?: number;
}

export interface ResultTabOptions {
  /** The analysis page shows the podcast as a tab; the lecture page has a mode of its own for it. */
  showConversation?: boolean;
  /** Lines of the podcast with text. */
  conversationCount?: number;
}

const TAB_SECTION: Record<ResultTab, SectionName> = {
  summary: 'summarizer',
  flashcards: 'flashcards',
  quiz: 'quiz',
  podcast: 'podcast',
};

function counts(view: AnalysisResults) {
  return {
    flashcards: view.flashcards?.flashcards?.length || 0,
    quiz: view.quiz?.quiz?.length || 0,
    summary: Boolean(view.summarizer?.content || (view.summarizer as { raw?: string } | undefined)?.raw),
  };
}

/** A section that was asked for, did not come and has nothing to show: its tab says so and offers it again. */
export function resultSectionFailed(view: AnalysisResults, name: SectionName, { showConversation = false, conversationCount = 0 }: ResultTabOptions = {}): boolean {
  const state = view.sections?.[name];
  if (!state || state.status === 'ok') return false;
  if (name === 'podcast') return showConversation && conversationCount === 0;
  return !sectionHasContent(name, sectionPayload(view, name));
}

/** The tabs of a result: a section with content or with a failure to report. None for a text-only material. */
export function resultTabs(view: AnalysisResults, options: ResultTabOptions = {}): ResultTabInfo[] {
  const { showConversation = false, conversationCount = 0 } = options;
  if (view.text_only === true) return [];
  const n = counts(view);
  const failed = (id: ResultTab) => resultSectionFailed(view, TAB_SECTION[id], options);
  const all: ResultTabInfo[] = [
    { id: 'summary', label: 'Конспект' },
    { id: 'flashcards', label: 'Карточки', count: n.flashcards },
    { id: 'quiz', label: 'Тест', count: n.quiz },
    { id: 'podcast', label: 'Подкаст', count: conversationCount },
  ];
  return all.filter((tab) => {
    if (tab.id === 'summary') return n.summary || failed('summary');
    if (tab.id === 'flashcards') return n.flashcards > 0 || failed('flashcards');
    if (tab.id === 'quiz') return n.quiz > 0 || failed('quiz');
    return showConversation && (conversationCount > 0 || failed('podcast'));
  });
}

/**
 * The tab a result opens on: the one a link asks for (?section=quiz from «Прогресс») when it has content, else the
 * first with content — never a failure line first.
 */
export function openingResultTab(tabs: ResultTabInfo[], view: AnalysisResults, initialTab?: ResultTab, conversationCount = 0): ResultTab {
  const n = counts(view);
  const hasContent = (id: ResultTab) =>
    id === 'summary' ? n.summary : id === 'flashcards' ? n.flashcards > 0 : id === 'quiz' ? n.quiz > 0 : conversationCount > 0;
  if (initialTab && tabs.some((tab) => tab.id === initialTab) && hasContent(initialTab)) return initialTab;
  const withContent = tabs.find((tab) => hasContent(tab.id));
  return withContent?.id ?? tabs[0]?.id ?? 'summary';
}

/** One item of «Экспорт» (Копировать, Печать или PDF, Файл для Anki, Показать тест на экране, Скачать HTML). */
export interface ResultExportItem {
  key: string;
  label: string;
  run: () => void;
}
