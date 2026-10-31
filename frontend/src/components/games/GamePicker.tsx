import { Link } from 'react-router-dom';
import { useContainersOverview } from '../../lib/containers/hooks';
import type { OverviewContainer } from '../../types/container';
import { Chevron, Sheet } from '../containers/ui';
import { challengePath, keyCounts, liveGamePath } from '../test/gameEntry';
import { QUICK_PATH } from '../quick/paths';
import { GAMES, pickMeta } from './copyGames';
import '../containers/containers.css';
import './games.css';

/**
 * The tests and exams a game can be played on: the user's own (live_create takes only the author's, CONTRACT §8), tests
 * first, then exams, the newest first in each. One with a question that has its answer opens the game's setup
 * (/live/new?c=…, the same address as «Провести игру» of the test's page); one without is shown, not pressed, with what
 * it lacks.
 */
export function playableOf(containers: readonly OverviewContainer[]): Array<{ container: OverviewContainer; kind: 'test' | 'exam'; questions: number; playable: boolean }> {
  return containers
    .filter((container) => container.role === 'owner')
    .map((container) => {
      const { total, keyed } = keyCounts(container.subjects);
      const kind: 'test' | 'exam' = container.kind === 'test' ? 'test' : 'exam';
      return { container, kind, questions: total, playable: keyed > 0 };
    })
    .sort((a, b) => (a.kind === b.kind ? b.container.created_at.localeCompare(a.container.created_at) : a.kind === 'test' ? -1 : 1));
}

/**
 * «Начать игру»: the sheet with the list; `challenge`: the same list for «Соревнование по ссылке» (its setup,
 * /live/challenge?c=…, docs/live/CHALLENGE.md).
 */
export default function GamePicker({ onClose, mode = 'game' }: { onClose: () => void; mode?: 'game' | 'challenge' }) {
  const pathOf = mode === 'challenge' ? challengePath : liveGamePath;
  const overview = useContainersOverview();
  const rows = overview.data ? playableOf(overview.data.containers) : null;
  let body;
  if (!overview.data && overview.loading) {
    body = (
      <p className="gm-pick-note" role="status">
        {GAMES.pick.loading}
      </p>
    );
  } else if (!rows) {
    body = (
      <p className="gm-pick-note" role="alert">
        {GAMES.pick.failed}{' '}
        <button type="button" className="sf-link" onClick={overview.reload}>
          {GAMES.pick.retry}
        </button>
      </p>
    );
  } else if (rows.length === 0) {
    body = (
      <>
        <p className="gm-pick-note">{GAMES.pick.empty}</p>
        <Link className="sf-primary gm-pick-quick" to={QUICK_PATH} data-autofocus="">
          {GAMES.pick.quick}
        </Link>
      </>
    );
  } else {
    body = (
      <>
        <p className="gm-pick-note" data-muted="">
          {mode === 'challenge' ? GAMES.pick.challengeLede : GAMES.pick.lede}
        </p>
        <ul className="ct-rows gm-pick-rows">
          {rows.map(({ container, kind, questions, playable }, index) => (
            <li key={container.id}>
              {playable ? (
                <Link className="ct-row" to={pathOf(container.id)} data-autofocus={index === 0 ? '' : undefined}>
                  <span>
                    <span className="ct-row-t">{container.title}</span>
                    <span className="ct-row-m">{pickMeta(kind, questions)}</span>
                  </span>
                  <Chevron />
                </Link>
              ) : (
                <div className="ct-row gm-pick-off" aria-disabled="true">
                  <span>
                    <span className="ct-row-t">{container.title}</span>
                    <span className="ct-row-m">{questions > 0 ? `${pickMeta(kind, questions)} · ${GAMES.pick.noKey}` : pickMeta(kind, 0)}</span>
                  </span>
                </div>
              )}
            </li>
          ))}
        </ul>
      </>
    );
  }
  return (
    <Sheet title={mode === 'challenge' ? GAMES.pick.challengeTitle : GAMES.pick.title} onClose={onClose} className="gm-pick">
      {body}
    </Sheet>
  );
}
