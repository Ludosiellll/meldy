/**
 * A game the host ended before its podium (or one that ran out of time): the server sends `ended` with no `final` and
 * no question (live_player_json: `final` only when the game was won or lost). The phone says the game is over, shows
 * what the player did so far — damage, place, right answers of the closed questions (from `live_review`) — and offers
 * «Разбор» when at least one question closed, and «Войти по PIN». The same in Telegram (PlayerApp is shared).
 */
import type { Look, PlayerState, Review } from '../../../lib/live/types';
import { LiveChar } from './art';
import { closedOf, type PlayerController } from './controller';
import { NBSP, nb } from './copy';

export interface EndedProps {
  ctl: PlayerController;
  st: PlayerState;
  look: Look;
  review: Review | null;
  /** The review could not be read: the right answers are left out. */
  reviewFailed: boolean;
}

export function Ended({ ctl, st, look, review, reviewFailed }: EndedProps) {
  const closed = closedOf(st);
  const right = review ? review.items.filter((i) => i.correct).length : null;
  const asked = review ? review.items.length : closed;
  return (
    <>
      <div className="lp-page lp-ended">
        <h1 className="lp-h1">Игра закончилась</h1>
        <p className="lp-sub">
          {closed > 0 ? 'Ведущий закончил игру до итогов. Вот что вы успели.' : 'Ведущий закончил игру до первого вопроса.'}
        </p>
        <div className="lp-ended__me">
          <div className="lp-floor" />
          <LiveChar look={look} size={132} face={st.me.dmg > 0 ? 'happy' : 'idle'} title="Ваш персонаж" />
        </div>
        {closed > 0 && (
          <dl className="lp-stats3">
            <div>
              <dt>урона</dt>
              <dd>{nb(st.me.dmg)}</dd>
            </div>
            {st.me.place > 0 && (
              <div>
                <dt>место из {st.players}</dt>
                <dd>{st.me.place}-е</dd>
              </div>
            )}
            {!(right === null && reviewFailed) && (
              <div>
                <dt>верных</dt>
                <dd>{right === null ? '…' : `${right}${NBSP}из${NBSP}${asked}`}</dd>
              </div>
            )}
          </dl>
        )}
      </div>
      <div className="lp-bar">
        {closed > 0 && (
          <button type="button" className="lp-btn lp-btn--second" onClick={() => void ctl.openReview()}>
            Разбор
          </button>
        )}
        <button type="button" className="lp-btn lp-btn--main" onClick={() => ctl.restart()}>
          Войти по PIN
        </button>
      </div>
    </>
  );
}
