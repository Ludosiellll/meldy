import { Link } from 'react-router-dom';
import { Gamepad2 } from 'lucide-react';
import { GAMES, GAMES_PATH, PLAY_PATH } from './copyGames';
import './games.css';

/**
 * «Игры» on «Сегодня» on a phone (owner, 31.10), whose five tabs have no room for a sixth: one compact row under the
 * greeting — the section, and «Войти по коду» a tap away for a student whose teacher has just started a game.
 */
export default function TodayGames() {
  return (
    <div className="td-games" role="group" aria-label={GAMES.title}>
      <Link className="td-games-go" to={GAMES_PATH}>
        <span className="td-games-pic" aria-hidden="true">
          <Gamepad2 strokeWidth={1.9} />
        </span>
        <span className="td-games-words">
          <span className="td-games-t">{GAMES.today.title}</span>
          <span className="td-games-m">{GAMES.today.text}</span>
        </span>
      </Link>
      <Link className="td-games-join" to={PLAY_PATH}>
        {GAMES.joinShort}
      </Link>
    </div>
  );
}
