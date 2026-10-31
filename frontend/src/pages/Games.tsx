import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import Footage from '../components/film/Footage';
import { Boss } from '../components/live/art/Boss';
import { Character } from '../components/live/art/Character';
import GamePicker from '../components/games/GamePicker';
import { GAMES, PLAY_PATH } from '../components/games/copyGames';
import { liveGameOpen } from '../components/test/gameEntry';
import { STAND_RUN, STAND_RUN_PHONE } from '../lib/footage';
import { follow } from '../lib/footageSync';
import { bossPictureUrl } from '../lib/live/three/thumbs';
import { useDocumentTitle } from '../lib/useDocumentTitle';
import run from '../components/home3/game/run.webp';
import '../styles/paper.css';
import '../components/games/games.css';

/**
 * «Игры» (/games; owner, 31.10: «есть ли обучение о том что эти мини-игры есть, да и в целом может отдельный Блок сверху
 * как "лекции"»): the live game in one place. What it is — the real game on the projector and one student's phone in the
 * same moment (lib/footage STAND_RUN and STAND_RUN_PHONE, kept in step as on the landing); «Начать игру» — the user's own
 * tests and exams (GamePicker), each to the game's setup /live/new; the three games in plain words; and for a student
 * «Войти в игру по коду», the phone's page /play. The games a teacher played are not listed: the server keeps no list a
 * page can read (live_games is closed to the client), and the tab that ran a game forgets it when closed.
 *
 * A section of the top line on a computer (Layout DESK_LINKS); on a phone, whose five tabs have no room for a sixth, a row
 * on «Сегодня» and a line in the account menu.
 */
export default function Games() {
  useDocumentTitle(GAMES.title);
  const [picking, setPicking] = useState(false);
  const [lead, setLead] = useState<HTMLVideoElement | null>(null);
  const [follower, setFollower] = useState<HTMLVideoElement | null>(null);
  useEffect(() => (lead && follower ? follow(lead, follower, STAND_RUN.duration) : undefined), [lead, follower]);
  const open = liveGameOpen();

  return (
    // «?» here opens the guide on its chapter (chapters.ts «game»).
    <div className="sf-page gm-page" data-guide-chapter="game">
      <header className="gm-head">
        <div className="gm-head-words">
          <h1 className="sf-h1 gm-h1">{GAMES.title}</h1>
          <p className="gm-lede">{GAMES.lede}</p>
        </div>
        {/* For a student: the phone's page, where the PIN or the projector's QR code lets them in. */}
        <Link className="sf-secondary gm-pill" to={PLAY_PATH}>
          {GAMES.join}
          <span className="gm-dot" aria-hidden="true">
            <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
              <path d="M5 12h14M13 6l6 6-6 6" />
            </svg>
          </span>
        </Link>
      </header>

      <section className="gm-hero" aria-labelledby="gm-hero-h">
        <div className="gm-hero-words">
          <h2 id="gm-hero-h" className="gm-hero-h">
            {GAMES.hero.title}
          </h2>
          <p className="gm-hero-p">{GAMES.hero.text}</p>
          {open ? (
            <button type="button" className="sf-primary gm-start" onClick={() => setPicking(true)} aria-haspopup="dialog">
              {GAMES.hero.start}
            </button>
          ) : null}
        </div>
        <div className="gm-media">
          <div className="gm-proj" role="img" aria-label={GAMES.hero.alt}>
            <Footage ref={setLead} footage={STAND_RUN} fit="cover" />
          </div>
          <div className="gm-phone" aria-hidden="true">
            <div className="gm-phone-in">
              <Footage ref={setFollower} footage={STAND_RUN_PHONE} play={false} fit="cover" />
            </div>
          </div>
        </div>
      </section>

      <section className="gm-modes" aria-labelledby="gm-modes-h">
        <h2 id="gm-modes-h" className="gm-h2">
          {GAMES.modesTitle}
        </h2>
        <ul className="gm-mode-list">
          {GAMES.modes.map((mode) => (
            <li key={mode.id} className="gm-mode" data-mode={mode.id}>
              <ModePicture id={mode.id} />
              <h3 className="gm-mode-h">{mode.name}</h3>
              <p className="gm-mode-p">{mode.text}</p>
            </li>
          ))}
        </ul>
        <p className="gm-note">{GAMES.modesNote}</p>
      </section>

      {picking ? <GamePicker onClose={() => setPicking(false)} /> : null}
    </div>
  );
}

/** Each game's picture: the battle as the setup draws it, the stand game's real frame, the boss that hunts. */
function ModePicture({ id }: { id: string }) {
  if (id === 'stand') {
    return (
      <div className="gm-mode-pic" data-pic="stand" aria-hidden="true">
        <img src={run} alt="" width={800} height={450} loading="lazy" decoding="async" />
      </div>
    );
  }
  if (id === 'chase') {
    return (
      <div className="gm-mode-pic" data-pic="chase" aria-hidden="true">
        <img className="gm-chase-boss" src={bossPictureUrl('clock')} alt="" width={200} height={200} loading="lazy" decoding="async" />
        <Character look={{ body: 'drop', colour: 'green', eyes: 'round', hat: 'none' }} size={44} className="gm-runner" style={{ left: '12%', bottom: 14 }} />
        <Character look={{ body: 'round', colour: 'pink', eyes: 'round', hat: 'antenna' }} size={40} className="gm-runner" style={{ right: '10%', bottom: 22 }} phaseMs={300} />
      </div>
    );
  }
  return (
    <div className="gm-mode-pic" data-pic="battle" aria-hidden="true">
      <div className="gm-battle">
        <Boss size={112} phase={0} />
        <Character look={{ body: 'round', colour: 'blue', eyes: 'round', hat: 'none' }} size={46} style={{ left: 10, top: 74 }} />
        <Character look={{ body: 'drop', colour: 'yellow', eyes: 'round', hat: 'antenna' }} size={46} style={{ left: 168, top: 70 }} phaseMs={300} />
      </div>
    </div>
  );
}
