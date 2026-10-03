import type { Visual } from '../components/conversation/types';

export type { Visual } from '../components/conversation/types';

export interface AgentStatus {
  id: string;
  label: string;
  /** failed — раздел пришёл со статусом не «ok» (пусто, занято, сбой, не успел). */
  status: 'idle' | 'running' | 'done' | 'failed';
  progress: number;
}

/** Разделы анализа, как их называет сервер. */
export type SectionName = 'summarizer' | 'flashcards' | 'quiz' | 'cheatsheet' | 'podcast';

/** Основные разделы: только их можно создать заново («Создать … заново»). */
export type CoreSectionName = 'summarizer' | 'flashcards' | 'quiz';

/**
 * Итог одного раздела. ok — есть годное содержимое; empty — модель ответила пустым;
 * busy — сервис ИИ был перегружен (429); failed — модель не ответила; timeout — не успела;
 * missing — связь прервалась до этого раздела (только клиент).
 */
export type SectionStatus = 'ok' | 'empty' | 'busy' | 'failed' | 'timeout' | 'missing';

export interface SectionState {
  status: SectionStatus;
  message?: string;
}

/** Статусы только запрошенных разделов (results.sections, summary_json.sections). */
export type SectionStates = Partial<Record<SectionName, SectionState>>;

export type AnalysisErrorKind =
  | 'incomplete'
  | 'network'
  | 'timeout'
  | 'server'
  | 'busy'
  | 'empty'
  | 'rate_limited'
  | 'too_large'
  | 'unavailable'
  | 'auth'
  | 'bad_request';

export interface AnalysisError {
  kind: AnalysisErrorKind;
  message: string;
  retryable: boolean;
}

export interface AnalysisSettings {
  summaryDetail: 'brief' | 'medium' | 'detailed';
  flashcardCount: number;
  quizCount: number;
  quizDifficulty: 'easy' | 'medium' | 'hard' | 'mixed';
  quizType: 'multiple' | 'truefalse';
  enabledAgents: string[];
}

export interface Flashcard {
  question: string;
  answer: string;
  source_ids?: string[];
}

export interface QuizQuestion {
  id: number;
  question: string;
  options: string[];
  correct: string;
  explanation?: string;
  source_ids?: string[];
}

export interface Mission {
  id: number;
  title: string;
  explanation: string;
  question: string;
  options: string[];
  correct: string;
  hint: string;
  source_ids?: string[];
}

/** Реплика «Разговора» (summary_json.podcast). visual — что показать на экране. */
export interface PodcastSegment {
  speaker: string;
  text: string;
  source_ids?: string[];
  visual?: Visual;
}

export interface Term {
  term: string;
  definition: string;
  source_ids?: string[];
}

export interface GroundingInfo {
  source_count: number;
  citable_items: number;
  sources: { id: string; text: string }[];
}

export interface SummaryInfo {
  title?: string;
  subject?: string;
  content: string;
  terms?: Term[];
  source_ids?: string[];
  grounding?: GroundingInfo;
  /** summary_json.sections: статусы запрошенных разделов (нет у старых материалов). */
  sections?: SectionStates;
  /** summary_json.text_only: материал импортирован только текстом, без конспекта. */
  text_only?: boolean;
  /** summary_json.origin = 'demo' и demo_text_id — результат анализа встроенного демо-текста. */
  origin?: string;
  demo_text_id?: string;
}

export interface CheatsheetInfo {
  content: string;
}

export interface PodcastInfo {
  podcast: PodcastSegment[];
}

export interface FlashcardsInfo {
  flashcards: Flashcard[];
}

export interface QuizInfo {
  quiz: QuizQuestion[];
}

export interface MissionsInfo {
  missions: Mission[];
}

export interface AnalysisState {
  phase: 'upload' | 'extracting' | 'analyzing' | 'done' | 'error';
  agents: AgentStatus[];
  results: AnalysisResults | null;
  settings: AnalysisSettings;
  textLength?: number;

  analysisDuration?: number;
  sourceFileName?: string;
  error?: AnalysisError;
  savedMaterialId?: string;
  /** Связь прервалась: показаны только разделы, которые успели прийти. */
  partial?: boolean;
  /** Запуск на встроенном демо-тексте: без списания энергии, с настройками по умолчанию. */
  isDemo?: boolean;
  /** Демо-материал, который уже был в библиотеке (повторный демо-запуск ничего не добавляет). */
  demoMaterialId?: string;
}

export interface AnalysisResults {
  summarizer: SummaryInfo;
  flashcards: FlashcardsInfo;
  quiz: QuizInfo;
  cheatsheet?: CheatsheetInfo;
  podcast?: PodcastInfo;
  missions?: MissionsInfo;
  warnings?: { agent: string; message: string }[];
  grounding?: GroundingInfo;
  /** Статусы запрошенных разделов. Нет у старых материалов — тогда строк о сбоях нет. */
  sections?: SectionStates;
  /** Материал импортирован только текстом (summary_json.text_only). */
  text_only?: boolean;
}

export interface HistoryItem {
  id: string;
  date: string;
  fileName: string;
  textLength: number;
  duration: number;
  results: AnalysisResults;
  settings: AnalysisSettings;
}

export const DEFAULT_SETTINGS: AnalysisSettings = {
  summaryDetail: 'medium',
  flashcardCount: 6,
  quizCount: 5,
  quizDifficulty: 'mixed',
  quizType: 'multiple',
  enabledAgents: ['summarizer', 'flashcards', 'quiz'],
};

// Database specific types
export interface StudySession {
  date: string;
  cards_reviewed?: number;
}

export interface ExamResult {
  date: string;
  score: number;
}

export interface Mistake {
  topic?: string;
  mistake_id?: string;
  question?: string;
}

export interface Achievement {
  achievement_id: string;
}

export interface Material {
  id: string;
  title: string;
  subject: string;
  created_at: string;
  user_id: string;
  is_public: boolean;
  summary_json: SummaryInfo;
  flashcards_json: { flashcards: Flashcard[] };
  quiz_json: { quiz: QuizQuestion[] };
}
