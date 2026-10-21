/**
 * Saving «Быстрая контрольная» (UX audit of 21.10, P1), the way «Новый тест» and «Отправить по ссылке» already save:
 * the test (container_create with one subject «Вопросы», marked a test), its questions (container_items_add, refs
 * make a resent batch a no-op), then the контрольная of all its keyed questions (quiz_create). No new table and no new
 * call: the test is an ordinary test, open in the studio and on «Экзамены».
 *
 * Resumable: what is saved is kept in `QuickSave`, so «Получить ссылку» pressed again after a failure goes on from the
 * step that failed and never makes a second test. «Ещё настройки» saves the test and its questions and stops before the
 * контрольная: the full form makes it.
 */
import { addItems, createContainer, setContainerKind } from '../../api/containers';
import { createQuiz } from '../../api/quizzes';
import { rememberContainerTitle } from '../../lib/containers/titleCache';
import type { ItemInput } from '../../types/container';
import type { QuizRow, QuizSettings } from '../../types/quiz';
import { NEW_TEST, TEST_TITLE_MAX } from '../test/copyTest';

export interface QuickSave {
  containerId: string | null;
  subjectId: string | null;
  itemsDone: boolean;
  quiz: QuizRow | null;
}

export const freshQuickSave = (): QuickSave => ({ containerId: null, subjectId: null, itemsDone: false, quiz: null });

export interface QuickSaveInput {
  title: string;
  items: ItemInput[];
  /** The quiz's settings once the subject is known; absent — the test only («Ещё настройки»). */
  settings?: (subjectId: string) => QuizSettings;
}

/** Saves what is not saved yet; `state` is updated in place as each step lands (a failure keeps the steps before). */
export async function saveQuick(input: QuickSaveInput, state: QuickSave): Promise<QuickSave> {
  const title = input.title.trim().slice(0, TEST_TITLE_MAX);
  if (!state.containerId || !state.subjectId) {
    const created = await createContainer(title, null, [{ title: NEW_TEST.subject }]);
    const subject = created.subjects[0];
    if (!subject) throw new Error('container_create gave no subject');
    state.containerId = created.container_id;
    state.subjectId = subject.id;
    rememberContainerTitle(created.container_id, title);
    try {
      await setContainerKind(created.container_id, 'test');
    } catch {
      // An older database or a lost answer: the test is made all the same (as on «Новый тест»).
    }
  }
  if (!state.itemsDone) {
    if (input.items.length > 0) await addItems(state.subjectId, input.items);
    state.itemsDone = true;
  }
  if (input.settings && !state.quiz) {
    state.quiz = await createQuiz(state.containerId, input.settings(state.subjectId));
  }
  return state;
}
