/**
 * Where a mistake of the diary came from, in the diary's own words (pages/MistakeDiary.tsx keeps the
 * same mapping; it is repeated here so the map does not load the diary page).
 */
export function mistakeOriginWords(origin: string | null | undefined): string {
  if (origin === 'quiz') return 'Тест';
  if (origin === 'oral_ticket') return 'Ответ на билет';
  return 'Устный экзамен';
}
