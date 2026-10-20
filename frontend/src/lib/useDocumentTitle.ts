import { useEffect } from 'react';

/** The site's own title (index.html): what a page without a name of its own shows. */
export const SITE_TITLE = 'Meldy — тренажёр экзамена по вопросам вашей кафедры';

/** «Вход — Meldy». An empty name keeps the site's title. */
export function pageTitle(name: string | null | undefined): string {
  const clean = (name ?? '').replace(/\s+/g, ' ').trim();
  return clean ? `${clean} — Meldy` : SITE_TITLE;
}

/**
 * Names the browser tab after the page while it is open, so tabs, history and bookmarks can be told apart.
 * On leaving, the previous title comes back; the next page sets its own.
 */
export function useDocumentTitle(name: string | null | undefined): void {
  const title = pageTitle(name);
  useEffect(() => {
    if (typeof document === 'undefined') return;
    const previous = document.title;
    document.title = title;
    return () => {
      document.title = previous;
    };
  }, [title]);
}
