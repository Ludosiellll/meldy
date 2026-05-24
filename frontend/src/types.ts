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

export interface AnalysisState {
  phase: 'upload' | 'extracting' | 'analyzing' | 'done' | 'error';
  agents: AgentStatus[];
  results: AnalysisResults | null;
  settings: AnalysisSettings;
  textLength?: number;

  analysisDuration?: number;
  sourceFileName?: string;
  error?: string;
}

export interface AnalysisResults {
  summarizer: any;
  flashcards: any;
  quiz: any;
  cheatsheet?: any;
  podcast?: any;
  missions?: any;
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
