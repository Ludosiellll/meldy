import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { challengeApi } from '../../lib/challenge/api';
import type { MineItem } from '../../lib/challenge/types';
import { Chevron } from '../containers/ui';
import { dateText } from './copy';
import { CLIST } from './copyAuthor';
import './challengeAuthor.css';

/**
 * The author's «Соревнования по ссылке» (`challenges_mine`, docs/live/CHALLENGE.md): on «Игры» all of them, on a test's
 * page that test's. Each row — the title, open until or over, how many finished and play, the leader — opens the
 * challenge's page with the link and the results. Nothing is shown while it loads or when the server has no such list
 * (a site ahead of the database); `showEmpty` says what the section is for when there is none yet.
 */
export function challengeMeta(item: MineItem): string {
  const parts = [item.state === 'open' ? CLIST.open(dateText(item.deadline)) : CLIST.over, CLIST.finished(item.finished)];
  if (item.playing > 0) parts.push(CLIST.playing(item.playing));
  if (item.leader) parts.push(CLIST.leader(item.leader.name));
  return parts.join(' · ');
}

export default function ChallengeList({ container = null, showEmpty = false, className = '' }: { container?: string | null; showEmpty?: boolean; className?: string }) {
  const [items, setItems] = useState<MineItem[] | null>(null);
  const load = useCallback(() => {
    challengeApi()
      .mine(container)
      .then(setItems, () => setItems(null));
  }, [container]);
  useEffect(() => {
    load();
  }, [load]);
  if (!items || (items.length === 0 && !showEmpty)) return null;
  return (
    <section className={`lcl ${className}`} aria-labelledby="lcl-h">
      <h2 id="lcl-h" className="lcl-h">
        {CLIST.title}
      </h2>
      {items.length === 0 ? (
        <p className="lcl-note">{CLIST.empty}</p>
      ) : (
        <ul className="ct-rows lcl-rows" aria-labelledby="lcl-h">
          {items.map((item) => (
            <li key={item.challenge_id}>
              <Link className="ct-row" to={`/live/challenge/${item.challenge_id}`} data-state={item.state}>
                <span>
                  <span className="ct-row-t">{item.title}</span>
                  <span className="ct-row-m">
                    <span className="lcl-state" data-state={item.state}>
                      {challengeMeta(item)}
                    </span>
                  </span>
                </span>
                <Chevron />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
