import { useEffect, useState } from 'react';

/** «Экзамены» with no exam yet draws its empty card (pages/Exams.tsx EmptyExams: «Выбрать файлы»). */
const EMPTY = '.ex-list-page .ex-empty';

/**
 * Whether «Экзамены» is on screen empty, while `watch` (the guide shows the «Экзамены» chapter): the chapter then names
 * «Выбрать файлы», the button that is there, not «Новый экзамен» (UX audit of 21.10, P4). The page arrives after the
 * guide moves to it, so the page is watched until the guide leaves the chapter.
 */
export function useExamsEmpty(watch: boolean): boolean {
  const [empty, setEmpty] = useState(false);
  useEffect(() => {
    if (!watch || typeof document === 'undefined') return undefined;
    const read = () => setEmpty(Boolean(document.querySelector(EMPTY)));
    read();
    if (typeof MutationObserver === 'undefined') return undefined;
    const observer = new MutationObserver(read);
    const root = document.querySelector('.sf-main') ?? document.body;
    observer.observe(root, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [watch]);
  return watch && empty;
}
