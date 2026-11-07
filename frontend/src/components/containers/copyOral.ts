/**
 * The oral part's way in, said where it is (UX audit 06.11; owner 07.11: «устный экзамен вот хрен знает где он»). The
 * oral part keeps its own page (decision 23: the list, the tickets, the cheat sheet); the exam's page and the subject's
 * page show the draw itself, so an oral exam is found where the exam is.
 */
export const DRAW_TICKET = 'Тянуть билет';

/** The draw of an oral part, back to the exam by ?from=c: (the draw's top line leads there). */
export function drawHref(oralExamId: string, containerId: string): string {
  return `/exams/${oralExamId}/draw?from=c:${containerId}`;
}
