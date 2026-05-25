export interface AgentStatus {
  id: string;
  label: string;
  status: 'idle' | 'running' | 'done';
  progress: number;
}

export interface AnalysisSettings {
  summaryDetail: 'brief' | 'medium' | 'detailed';
  flashcardCount: number;
  quizCount: number;
  quizDifficulty: 'easy' | 'medium' | 'hard' | 'mixed';
  quizType: 'multiple' | 'truefalse';
}

export interface Flashcard {
  question: string;
  answer: string;
}

export interface QuizQuestion {
  id: number;
  question: string;
  options: string[];
  correct: string;
  explanation?: string;
}

export interface Mission {
  id: number;
  title: string;
  explanation: string;
  question: string;
  options: string[];
  correct: string;
  hint: string;
}

export interface PodcastSegment {
  speaker: string;
  text: string;
}

export interface Term {
  term: string;
  definition: string;
}

export interface SummaryInfo {
  subject?: string;
  content: string;
  terms?: Term[];
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
  error?: string;
  savedMaterialId?: string;
}

export interface AnalysisResults {
  summarizer: SummaryInfo;
  flashcards: FlashcardsInfo;
  quiz: QuizInfo;
  cheatsheet?: CheatsheetInfo;
  podcast?: PodcastInfo;
  missions?: MissionsInfo;
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
