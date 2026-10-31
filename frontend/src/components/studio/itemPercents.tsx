import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { itemPercents } from '../../api/quizzes';
import { nb, plural } from '../containers/copyImport';
import type { ItemPercent } from '../../types/quiz';
import './itemPercents.css';

/** The chip's words (kept here: the studio's copy file is shared with other work of release 49). */
export const STUDIO_PERCENT = {
  percent: (n: number) => `верно ${n} %`,
  few: (right: number, shown: number) => `верно ${String(right).replace('.', ',')} из ${shown}`,
  title: (shown: number) => `По контрольным этого теста: ${shown} ${plural(shown, 'ответ', 'ответа', 'ответов')}, ваши попытки не считаем.`,
  label: (words: string, shown: number) => `${words[0].toUpperCase()}${words.slice(1)}, ${shown} ${plural(shown, 'ответ', 'ответа', 'ответов')} в контрольных.`,
} as const;

/**
 * «Процент верных — прямо на холсте студии» (release 49, spec «Выпуск 49»): each question block of the canvas says how
 * many got it right over the test's quizzes (test_item_percents, 20261105090000_quiz_stats: finished attempts of
 * others, the author's own tries left out). Read once when the canvas opens; nothing while nobody has written. A read
 * that fails shows nothing: the canvas works as before.
 */
const PercentsContext = createContext<ReadonlyMap<string, ItemPercent> | null>(null);

/** Under this many answers the chip says «2 из 3», not a percent. */
export const PERCENT_FROM = 5;

export function ItemPercentsProvider({ containerId, children }: { containerId: string; children: ReactNode }) {
  const [map, setMap] = useState<ReadonlyMap<string, ItemPercent> | null>(null);
  useEffect(() => {
    if (!containerId) return undefined;
    let live = true;
    itemPercents(containerId).then(
      (list) => {
        if (live && list.length > 0) setMap(new Map(list.map((row) => [row.item_id, row])));
      },
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [containerId]);
  return <PercentsContext.Provider value={map}>{children}</PercentsContext.Provider>;
}

/** The words of a question's chip: «верно 64 %» from PERCENT_FROM answers, else «верно 2 из 3». */
export function percentWords(stat: Pick<ItemPercent, 'shown' | 'credit'>): string {
  const right = Math.round(stat.credit * 10) / 10;
  return stat.shown >= PERCENT_FROM ? STUDIO_PERCENT.percent(Math.round((100 * stat.credit) / stat.shown)) : STUDIO_PERCENT.few(right, stat.shown);
}

/** The chip of one question block (nothing while nobody answered it). */
export function PercentChip({ itemId }: { itemId: string | null }) {
  const map = useContext(PercentsContext);
  const stat = itemId ? map?.get(itemId) : undefined;
  if (!stat || stat.shown <= 0) return null;
  return (
    <p className="st-percent" title={STUDIO_PERCENT.title(stat.shown)}>
      <span aria-hidden="true">{nb(percentWords(stat))}</span>
      <span className="sr-only">{STUDIO_PERCENT.label(percentWords(stat), stat.shown)}</span>
    </p>
  );
}
