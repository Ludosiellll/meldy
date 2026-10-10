/**
 * The learning journal's shapes (`public.learning_events`, contracts §1.2 and §6.5). Types only: the journal's reads and
 * writes (api/learning.ts) and the pure modules that read its events (lib/learning/readiness.ts, lib/exams/cheatSheet.ts,
 * lib/containers/oralParts.ts) share them, so a pure module never imports the network layer. api/learning.ts re-exports
 * them, so every import of them from there keeps working.
 */
export type LearningKind = 'quiz_answer' | 'card_review' | 'exam_answer' | 'oral_point' | 'self_rating' | 'sheet_peek';

export interface LearningEvent {
  id: string;
  created_at: string;
  local_date: string;
  material_id: string | null;
  kind: LearningKind;
  item_key: string;
  correct: boolean | null;
  score: number | null;
  confidence: 1 | 2 | 3 | null;
  source_ids: string[];
  session_id: string | null;
  payload: Record<string, unknown>;
}

/** The self-rating «знаю · плаваю · не знаю» (stored in `confidence` of a self_rating event as 3 · 2 · 1). */
export type SelfRating = 'know' | 'unsure' | 'dont_know';
