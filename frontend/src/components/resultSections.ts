import type { AnalysisResults, SectionName } from '../types';
import { SECTION_LABELS, sectionHasContent, sectionPayload } from '../utils/analysisSections';

/**
 * The sections of an analysis result as tabs: «Конспект · Карточки 6 · Тест 5» (and «Выжимка» and «Подкаст» on the
 * analysis page). ResultsPanel draws them in its own row; the lecture page on a phone draws them in its one row of tabs
 * next to its own «Выжимка» and «Подкаст» (10_Project/Phone_Declutter_2026-10-08), so both read the list from here.
 */
export type ResultTab = 'summary' | 'flashcards' | 'quiz' | 'cheatsheet' | 'podcast';

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
  /**
   * The analysis page shows the выжимка as a tab (QA 2026-10-11: it was made and nowhere on the result screen); the
   * lecture page has a mode of its own for it, under the same name.
   */
  showCheatsheet?: boolean;
}

const TAB_SECTION: Record<ResultTab, SectionName> = {
  summary: 'summarizer',
  flashcards: 'flashcards',
  quiz: 'quiz',
  cheatsheet: 'cheatsheet',
  podcast: 'podcast',
};

function counts(view: AnalysisResults) {
  return {
    flashcards: view.flashcards?.flashcards?.length || 0,
    quiz: view.quiz?.quiz?.length || 0,
    summary: Boolean(view.summarizer?.content || (view.summarizer as { raw?: string } | undefined)?.raw),
    cheatsheet: sectionHasContent('cheatsheet', view.cheatsheet),
  };
}

/** A section that was asked for, did not come and has nothing to show: its tab says so and offers it again. */
export function resultSectionFailed(view: AnalysisResults, name: SectionName, { showConversation = false, conversationCount = 0 }: ResultTabOptions = {}): boolean {
  const state = view.sections?.[name];
  if (!state || state.status === 'ok') return false;
  if (name === 'podcast') return showConversation && conversationCount === 0;
  return !sectionHasContent(name, sectionPayload(view, name));
}

/**
 * The tabs of a result: a section with content or with a failure to report. None for a text-only material. The
 * выжимка has a tab only with its text: a failed one is a line under the header (ResultsPanel).
 */
export function resultTabs(view: AnalysisResults, options: ResultTabOptions = {}): ResultTabInfo[] {
  const { showConversation = false, conversationCount = 0, showCheatsheet = false } = options;
  if (view.text_only === true) return [];
  const n = counts(view);
  const failed = (id: ResultTab) => resultSectionFailed(view, TAB_SECTION[id], options);
  const all: ResultTabInfo[] = [
    { id: 'summary', label: SECTION_LABELS.summarizer },
    { id: 'flashcards', label: SECTION_LABELS.flashcards, count: n.flashcards },
    { id: 'quiz', label: SECTION_LABELS.quiz, count: n.quiz },
    { id: 'cheatsheet', label: SECTION_LABELS.cheatsheet },
    { id: 'podcast', label: SECTION_LABELS.podcast, count: conversationCount },
  ];
  return all.filter((tab) => {
    if (tab.id === 'summary') return n.summary || failed('summary');
    if (tab.id === 'flashcards') return n.flashcards > 0 || failed('flashcards');
    if (tab.id === 'quiz') return n.quiz > 0 || failed('quiz');
    if (tab.id === 'cheatsheet') return showCheatsheet && n.cheatsheet;
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
    id === 'summary'
      ? n.summary
      : id === 'flashcards'
        ? n.flashcards > 0
        : id === 'quiz'
          ? n.quiz > 0
          : id === 'cheatsheet'
            ? n.cheatsheet
            : conversationCount > 0;
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
