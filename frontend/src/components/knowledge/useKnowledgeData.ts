import { useCallback, useEffect, useState } from 'react';
import { listExamShelves, normalizeQuestion, type ExamQuestion } from '../../api/exams';
import { fetchQuestionEvents } from '../../api/learning';
import { statesByHash, type QuestionState } from '../../lib/learning/readiness';
import { supabase } from '../../lib/supabase';
import type { KnowledgeInput, RawExam, RawMaterial, RawMistake, RawQuestion } from './model';

/**
 * Everything the knowledge map reads, in parallel and read-only: the lectures (title, subject, date,
 * the glossary of the summary), the mistake diary, the exams with their lectures and questions, the
 * answer journal of those questions and the review cards that are due. Only the lectures are
 * required; when anything else cannot be read the map is drawn without it and says so.
 */

export type LoadStatus = 'loading' | 'ready' | 'error';

export interface KnowledgeData {
  status: LoadStatus;
  input: KnowledgeInput | null;
  /** What could not be read (the map is drawn without it). */
  missing: Array<'exams' | 'answers' | 'mistakes' | 'cards'>;
  retry: () => void;
}

const QUESTION_COLUMNS = 'id, exam_id, position, label, section, text, question_hash, coverage, coverage_method, evidence, nearest, created_at';

async function readMaterials(userId: string): Promise<RawMaterial[]> {
  const { data, error } = await supabase.from('materials').select('id, title, subject, created_at, summary_json').eq('user_id', userId);
  if (error) throw error;
  return (Array.isArray(data) ? data : []) as RawMaterial[];
}

async function readMistakes(userId: string): Promise<RawMistake[]> {
  const { data, error } = await supabase.from('mistake_diary').select('*').eq('user_id', userId);
  if (error) throw error;
  return (Array.isArray(data) ? data : []) as RawMistake[];
}

async function readExams(userId: string): Promise<{ exams: RawExam[]; questions: RawQuestion[] }> {
  const shelves = await listExamShelves(userId);
  if (shelves.length === 0) return { exams: [], questions: [] };
  const { data, error } = await supabase
    .from('exam_questions')
    .select(QUESTION_COLUMNS)
    .in('exam_id', shelves.map((shelf) => shelf.id))
    .order('position', { ascending: true })
    .limit(5000);
  if (error) throw error;
  const questions = (Array.isArray(data) ? data : [])
    .map(normalizeQuestion)
    .filter((row): row is ExamQuestion => row !== null)
    .map((row) => ({
      id: row.id,
      exam_id: row.exam_id,
      position: row.position,
      label: row.label,
      text: row.text,
      question_hash: row.question_hash,
      coverage: row.coverage,
      coverage_method: row.coverage_method,
      evidence: row.evidence,
    }));
  return {
    exams: shelves.map((shelf) => ({ id: shelf.id, title: shelf.title, kind: shelf.kind, exam_date: shelf.exam_date, created_at: shelf.created_at, materials: shelf.materials })),
    questions,
  };
}

async function readDueCards(userId: string): Promise<Map<string, number>> {
  const { data, error } = await supabase
    .from('flashcard_progress')
    .select('id, material_id')
    .eq('user_id', userId)
    .lte('next_review', new Date().toISOString())
    .limit(5000);
  if (error) throw error;
  const due = new Map<string, number>();
  for (const row of Array.isArray(data) ? data : []) {
    const materialId = (row as { material_id?: unknown }).material_id;
    if (typeof materialId === 'string') due.set(materialId, (due.get(materialId) ?? 0) + 1);
  }
  return due;
}

export function useKnowledgeData(userId: string | undefined): KnowledgeData {
  const [state, setState] = useState<Omit<KnowledgeData, 'retry'>>({ status: 'loading', input: null, missing: [] });
  const [attempt, setAttempt] = useState(0);
  const retry = useCallback(() => setAttempt((value) => value + 1), []);

  useEffect(() => {
    if (!userId) {
      setState({ status: 'ready', input: { materials: [], mistakes: [], exams: [], questions: [], states: new Map(), dueByMaterial: new Map() }, missing: [] });
      return;
    }
    let cancelled = false;
    setState((previous) => ({ ...previous, status: 'loading' }));
    const missing: KnowledgeData['missing'] = [];
    const soft = <T,>(promise: Promise<T>, what: KnowledgeData['missing'][number], fallback: T): Promise<T> =>
      promise.catch((error) => {
        console.error(`Knowledge map: ${what} could not be read`, error);
        missing.push(what);
        return fallback;
      });
    (async () => {
      try {
        const [materials, mistakes, examData, due] = await Promise.all([
          readMaterials(userId),
          soft(readMistakes(userId), 'mistakes', [] as RawMistake[]),
          soft(readExams(userId), 'exams', { exams: [] as RawExam[], questions: [] as RawQuestion[] }),
          soft(readDueCards(userId), 'cards', new Map<string, number>()),
        ]);
        const hashes = Array.from(new Set(examData.questions.map((question) => question.question_hash).filter((hash): hash is string => Boolean(hash))));
        let states = new Map<string, QuestionState>();
        if (hashes.length > 0) {
          const events = await soft(fetchQuestionEvents(hashes), 'answers', []);
          states = statesByHash(events);
        }
        if (cancelled) return;
        setState({
          status: 'ready',
          input: { materials, mistakes, exams: examData.exams, questions: examData.questions, states, dueByMaterial: due },
          missing,
        });
      } catch (error) {
        console.error('Knowledge map data load failed:', error);
        if (!cancelled) setState({ status: 'error', input: null, missing: [] });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [userId, attempt]);

  return { ...state, retry };
}
