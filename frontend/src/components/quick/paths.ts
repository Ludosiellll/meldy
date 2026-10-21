/** The addresses of «Быстрая контрольная» and of the tests (UX audit of 21.10). */

/** «Экзамены» showing the tests (the «Экзамены | Тесты» switch). */
export const TESTS_PATH = '/exams?view=tests';
/** «Быстрая контрольная»: the landing's «Собрать свой тест» signs up with /register?next=/tests/quick. */
export const QUICK_PATH = '/tests/quick';

/** The контрольная's link with its QR code, at once after «Получить ссылку» (and from a test's row). */
export function quickLinkPath(containerId: string, quizId: string): string {
  return `/exams/c/${encodeURIComponent(containerId)}/quizzes/${encodeURIComponent(quizId)}/link`;
}
