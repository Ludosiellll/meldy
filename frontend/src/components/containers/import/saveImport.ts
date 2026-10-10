/**
 * Saving the import (package D3a), resumable: a failed step is tried again with what is already saved kept in
 * `SaveState`, so nothing is created twice — oral exams and the container are remembered, a batch of items carries
 * refs (`<import id>:<position>`), and the database inserts a resent ref once.
 *
 * - One oral list (one subject, only open questions, ≤ 150) is today's oral exam: the existing createExam
 *   (api/exams.ts), then its lectures, /exams/:id/edit#lectures (spec decision 21).
 * - Otherwise: each subject's oral part is an oral exam (createExam), then container_create with every subject (an old
 *   exam first when the student adds to it: decision 22) or container_subject_add for each one (?from=c:<id>), then
 *   the questions with variants in batches (addItems), then the minutes a day.
 */
import { addItems, addSubject, createContainer, saveSettings } from '../../../api/containers';
import { createExam, type ExamDraft } from '../../../api/exams';
import type { CreateSubjectInput } from '../../../types/container';
import { rememberContainerTitle } from '../../../lib/containers/titleCache';
import { type DraftSubject, isSingleOralList, itemInputs } from './importModel';

export type SaveTarget =
  | { kind: 'new' }
  | { kind: 'old'; examId: string; title: string }
  | { kind: 'container'; containerId: string; title: string };

export interface SaveInput {
  userId: string;
  target: SaveTarget;
  title: string;
  date: string | null;
  perSubject: boolean;
  minutes: number | null;
  subjects: DraftSubject[];
  importIds: Record<string, string>;
}

export interface SaveState {
  oralExamIds: Record<string, string>;
  containerId: string | null;
  subjectIds: Record<string, string>;
  itemsDone: Record<string, boolean>;
  settingsDone: boolean;
}

export const freshSaveState = (): SaveState => ({ oralExamIds: {}, containerId: null, subjectIds: {}, itemsDone: {}, settingsDone: false });

export interface SaveProgress {
  done: number;
  total: number;
}

const subjectDate = (input: SaveInput, subject: DraftSubject) => (input.perSubject ? subject.date : input.date);

/** The oral part of a subject as today's editor would save it. */
export function oralDraft(subject: DraftSubject, title: string, date: string | null): ExamDraft {
  return {
    title: title.slice(0, 200),
    kind: 'exam',
    examDate: date,
    sourceKind: subject.source === 'paste' ? 'paste' : 'file',
    sourceText: subject.oral.map((question) => (question.label ? `${question.label}. ${question.text}` : question.text)).join('\n'),
    layoutMode: 'random',
    perTicket: 2,
    sectionTitles: subject.oralSections,
    questions: subject.oral.map((question) => ({
      key: question.uid,
      id: null,
      label: question.label.slice(0, 16),
      section: question.section,
      text: question.text,
    })),
    tickets: [],
    materialIds: [],
  };
}

function subjectInput(input: SaveInput, state: SaveState, subject: DraftSubject): CreateSubjectInput {
  return {
    title: subject.title.slice(0, 200),
    exam_date: input.target.kind === 'container' ? null : input.perSubject ? subject.date : null,
    exam_id: state.oralExamIds[subject.key] ?? null,
    topics: subject.topics,
  };
}

/** Saves what is not saved yet and returns the address to open. Throws on the first failure; call again to go on. */
export async function saveImport(input: SaveInput, state: SaveState, onProgress?: (progress: SaveProgress) => void): Promise<string> {
  const { subjects, target, userId } = input;
  if (subjects.length === 0) throw new Error('nothing to save');

  if (target.kind === 'new' && isSingleOralList(subjects)) {
    const subject = subjects[0];
    let examId = state.oralExamIds[subject.key];
    if (!examId) {
      examId = (await createExam(userId, oralDraft(subject, input.title.trim() || subject.title, input.date))).examId;
      state.oralExamIds[subject.key] = examId;
    }
    return `/exams/${examId}/edit#lectures`;
  }

  for (const subject of subjects) {
    if (subject.oral.length === 0 || state.oralExamIds[subject.key]) continue;
    const { examId } = await createExam(userId, oralDraft(subject, subject.title, subjectDate(input, subject)));
    state.oralExamIds[subject.key] = examId;
  }

  let containerId: string;
  let title: string;
  if (target.kind === 'container') {
    containerId = target.containerId;
    title = target.title;
    for (const subject of subjects) {
      if (state.subjectIds[subject.key]) continue;
      const added = await addSubject(containerId, subjectInput(input, state, subject));
      state.subjectIds[subject.key] = added.id;
    }
  } else {
    title = input.title.trim();
    if (!state.containerId) {
      const first: CreateSubjectInput[] = target.kind === 'old' ? [{ title: target.title.slice(0, 200), exam_id: target.examId }] : [];
      const created = await createContainer(title, input.perSubject ? null : input.date, [
        ...first,
        ...subjects.map((subject) => subjectInput(input, state, subject)),
      ]);
      state.containerId = created.container_id;
      const byPosition = new Map(created.subjects.map((subject) => [subject.position, subject.id]));
      subjects.forEach((subject, index) => {
        const position = index + 1 + first.length;
        const id = byPosition.get(position) ?? created.subjects[position - 1]?.id;
        if (id) state.subjectIds[subject.key] = id;
      });
    }
    containerId = state.containerId;
  }

  const total = subjects.reduce((sum, subject) => sum + subject.test.length, 0);
  let done = subjects.reduce((sum, subject) => sum + (state.itemsDone[subject.key] ? subject.test.length : 0), 0);
  onProgress?.({ done, total });
  for (const subject of subjects) {
    if (subject.test.length === 0 || state.itemsDone[subject.key]) continue;
    const subjectId = state.subjectIds[subject.key];
    if (!subjectId) throw new Error('subject not created');
    const before = done;
    await addItems(subjectId, itemInputs(subject, input.importIds[subject.fileId] ?? 'imp'), (batchDone) =>
      onProgress?.({ done: before + batchDone, total }),
    );
    done = before + subject.test.length;
    state.itemsDone[subject.key] = true;
    onProgress?.({ done, total });
  }

  if (target.kind !== 'container' && input.minutes && !state.settingsDone) {
    try {
      await saveSettings(containerId, { minutes_per_day: input.minutes, study_weekdays: 127 });
    } catch {
      // The plan then takes the default (60 minutes); «Настройки» change it any time.
    }
    state.settingsDone = true;
  }
  if (title) rememberContainerTitle(containerId, title);
  return `/exams/c/${containerId}`;
}
