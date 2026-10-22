/**
 * The landing's tiles under the first screen (owner, 22.10: the layout «D — Плитки»): the lecture and the exam, each a
 * heading, one line and the real screen recorded (lib/footage); then the game in class on a dark tile beside two facts;
 * the constructor (Builder) follows them.
 *
 * Every video is decoration (components/film/Footage: aria-hidden; the tile's words say what it shows). It plays only
 * while on screen and the tab is seen, loads only near the window, and before the window's load event shows its poster
 * alone (`still`), so no part of a video competes with the page's first paint. A phone gets the 4:5 cuts, a wider
 * screen the wide ones: chosen once, when the page opens (Landing3), so only one of the two is ever fetched.
 */
import { useEffect, useState, type ReactNode } from 'react';
import Footage from '../film/Footage';
import { follow } from '../../lib/footageSync';
import {
  LANDING_EXAM_PHONE,
  LANDING_EXAM_WIDE,
  LANDING_LECTURE_PHONE,
  LANDING_LECTURE_WIDE,
  STAND_RUN,
  STAND_RUN_PHONE,
  type Footage as FootageDef,
} from '../../lib/footage';
import { CTA, GAME_SECTION, TILES, bind } from './copy3';
import { withGlyphs } from './glyphs';

/** A section's heading and its line (the constructor's). */
export function SectionHead({ id, title, text, children }: { id: string; title: string; text: string; children?: ReactNode }) {
  return (
    <div className="p3-head">
      <h2 id={id} className="p3-h2">
        {bind(title)}
      </h2>
      <p className="p3-text">{bind(text)}</p>
      {children}
    </div>
  );
}

/** What the tiles get from the page: the phone's cuts or the wide ones, and whether the window has loaded. */
export interface TileProps {
  phone: boolean;
  /** Before the window's load event: posters only, nothing fetched. */
  still: boolean;
}

/** A tile with a recorded screen at its foot, at the cut's own proportions: 16:10 on a computer, 4:5 on a phone. */
function ClipTile({ id, name, title, text, footage, phone, still }: TileProps & { id: string; name: string; title: string; text: string; footage: FootageDef }) {
  return (
    <section id={id} className={`p3-tile p3-clip p3-clip--${name}`} aria-labelledby={`${id}-h`}>
      <div className="p3-tile-head">
        <h2 id={`${id}-h`} className="p3-tile-h">
          {withGlyphs(bind(title))}
        </h2>
        <p className="p3-tile-p">{bind(text)}</p>
      </div>
      <div className="p3-clip-frame" data-variant={phone ? 'phone' : 'wide'} style={{ aspectRatio: `${footage.width} / ${footage.height}` }}>
        <Footage footage={footage} fit="cover" still={still || undefined} />
      </div>
    </section>
  );
}

/* ——— the game in class ——— */

/** «Провести игру»: sign up, then «Тесты», where every test has «Провести игру» (Register honours ?next=). */
export const GAME_URL = `/register?next=${encodeURIComponent('/exams?view=tests')}`;

/** What the projector's picture shows, for those who do not see it. */
export const GAME_ALT = 'Игра «Встань на ответ» на проекторе. Класс бежит к ответам, потом пол под неверными ответами проваливается. Устояли 18 из 30.';

/**
 * «Игра на паре» (owner, 21.10: the real game running, not a drawing; then «в телефоне тупо картинка, нет движения
 * синхронного с экраном главным»; 22.10: «игру оставить как есть»): the recorded game on the projector, the class
 * running to the answers and the floor dropping (lib/footage STAND_RUN, a silent loop while on screen), and one
 * student's phone in the same game: the real phone page drawn from the same recording (STAND_RUN_PHONE). The
 * projector's video leads and the phone's follows its time (lib/footageSync: it starts, stops and loops with it, and a
 * gap of a frame is closed as it opens); with reduced motion both posters, of one moment. Its one link is the only thing
 * to press.
 */
export function GameTile({ still }: { still: boolean }) {
  const [lead, setLead] = useState<HTMLVideoElement | null>(null);
  const [phone, setPhone] = useState<HTMLVideoElement | null>(null);
  useEffect(() => (lead && phone ? follow(lead, phone, STAND_RUN.duration) : undefined), [lead, phone]);
  return (
    <section id="game" className="p3-tile p3-play" aria-labelledby="game-h">
      <div className="p3-play-head">
        <div className="p3-play-words">
          <h2 id="game-h" className="p3-tile-h">
            {bind(GAME_SECTION.title)}
          </h2>
          <p className="p3-tile-p">{bind(GAME_SECTION.text)}</p>
        </div>
        <a className="h3-pill h3-pill--light" href={GAME_URL}>
          {CTA.game}
        </a>
      </div>
      <div className="p3-play-media">
        <div className="p3-proj" role="img" aria-label={GAME_ALT}>
          <Footage ref={setLead} footage={STAND_RUN} fit="cover" still={still || undefined} />
        </div>
        <div className="p3-gphone" aria-hidden="true">
          <div className="p3-gphone-in">
            <Footage ref={setPhone} footage={STAND_RUN_PHONE} play={false} fit="cover" still={still || undefined} />
          </div>
        </div>
      </div>
    </section>
  );
}

/* ——— two facts ——— */

function LinkIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M10 14a4 4 0 0 0 5.66 0l3-3a4 4 0 0 0-5.66-5.66l-1 1" />
      <path d="M14 10a4 4 0 0 0-5.66 0l-3 3a4 4 0 0 0 5.66 5.66l1-1" />
    </svg>
  );
}

function SendIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M21 4 3 11l7 2 2 7 9-16Z" />
    </svg>
  );
}

/** The lecture and the exam; then the game beside the two facts. */
export function Tiles({ phone, still }: TileProps) {
  return (
    <div className="h3-wrap p3-tiles">
      <div className="p3-row">
        <ClipTile
          id="lecture"
          name="lecture"
          title={TILES.lecture.title}
          text={TILES.lecture.text}
          footage={phone ? LANDING_LECTURE_PHONE : LANDING_LECTURE_WIDE}
          phone={phone}
          still={still}
        />
        <ClipTile
          id="exam"
          name="exam"
          title={TILES.exam.title}
          text={TILES.exam.text}
          footage={phone ? LANDING_EXAM_PHONE : LANDING_EXAM_WIDE}
          phone={phone}
          still={still}
        />
      </div>
      <div className="p3-row">
        <GameTile still={still} />
        <div className="p3-facts">
          <div className="p3-fact p3-fact--link">
            <LinkIcon />
            <h2 className="p3-fact-h">{bind(TILES.link)}</h2>
          </div>
          <div className="p3-fact p3-fact--tg">
            <SendIcon />
            <h2 className="p3-fact-h">{bind(TILES.telegram)}</h2>
          </div>
        </div>
      </div>
    </div>
  );
}
