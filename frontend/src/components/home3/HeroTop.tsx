import type { CSSProperties, ReactNode } from 'react';
import { LANDING_ORAL, STAND_RUN } from '../../lib/footage';
import { CTA, DOORS, HEADLINE, NAV, SAMPLE_TEST_URL, TILES, bind } from './copy3';

export function ArrowIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M5 12h14M13 6l6 6-6 6" />
    </svg>
  );
}

/**
 * The landing's first screen: the top line, then two doors of one size (advice at the final of 20.11; owner, 21.11) —
 * «Я учусь» with a phone answering a ticket aloud, «Я преподаю» with the game on the projector. Each door says who it
 * is for, what they come to do and three things they get, and has one pill and one link. On a phone the doors stand
 * one under the other, and two short links above them lead to each, so a teacher sees theirs without scrolling.
 *
 * index.html carries the same markup as plain HTML (#static-hero, painted before any script; hero3.test.tsx compares
 * the two), so it is links, text and the two posters only: each poster is an <img> with its size, and the page lays
 * its video over it (`oral`, `game`, after the window's load event) once it has taken the static screen's place. The
 * page turns the links into the app's navigation by one click handler on its root.
 *
 * The phone (owner 19.11): under it the step it plays now — its number and its name, with the four steps as dots. All
 * four names are in the page (a list); the one that plays is shown (`step`; the static screen shows the first).
 */
export default function HeroTop({ oral, game, step = 0, children }: { oral?: ReactNode; game?: ReactNode; step?: number; children?: ReactNode }) {
  return (
    <>
      <header className="h3-nav">
        <nav className="h3-wrap h3-nav-in" aria-label="Главное меню">
          <a className="h3-logo" href="/" aria-label="Meldy, главная">
            Meldy
          </a>
          <div className="h3-links">
            {NAV.map((item) => (
              <a key={item.id} href={`#${item.id}`}>
                {item.label}
              </a>
            ))}
          </div>
          <div className="h3-end">
            <a className="h3-pill h3-pill--white h3-pill--sm" href="/login">
              {CTA.signIn}
            </a>
            <a className="h3-pill h3-pill--blue h3-pill--sm" href="/register">
              {CTA.signUp}
            </a>
          </div>
        </nav>
      </header>
      <main>
        <section className="h3-wrap h3-hero" aria-labelledby="h3-title">
          <h1 id="h3-title" className="h3-h1">
            {bind(HEADLINE)}
          </h1>
          {/* A phone's way to each door (hero3.css shows it there only). */}
          <p className="h3-jump">
            <a href="#door-student">{DOORS.student.who}</a>
            <a href="#door-teacher">{DOORS.teacher.who}</a>
          </p>
          <div id="door-student" className="h3-door h3-door--student">
            <div className="h3-door-text">
              <p className="h3-door-who">{DOORS.student.who}</p>
              <h2 className="h3-door-h">{bind(DOORS.student.title)}</h2>
              <ul className="h3-door-pts">
                {DOORS.student.points.map((text) => (
                  <li key={text}>{bind(text)}</li>
                ))}
              </ul>
            </div>
            <div className="h3-acts">
              <a className="h3-pill h3-pill--blue" href="/try">
                {CTA.example}
                <i>
                  <ArrowIcon />
                </i>
              </a>
              <a className="h3-textlink" href={DOORS.student.signUpUrl}>
                {DOORS.student.signUp}
              </a>
            </div>
            <div className="h3-oral">
              <h3 className="h3-oral-h">{bind(TILES.oral)}</h3>
              {/* The screen keeps the recording's proportions (hero3.css): nothing of its sides is cut. */}
              <div className="h3-oral-phone" aria-hidden="true" style={{ '--oral-ar': `${LANDING_ORAL.width} / ${LANDING_ORAL.height}` } as CSSProperties}>
                <img className="h3-oral-poster" src={LANDING_ORAL.poster} alt="" width={LANDING_ORAL.width} height={LANDING_ORAL.height} decoding="async" />
                {oral}
              </div>
              <ol className="h3-oral-steps">
                {TILES.oralSteps.map((text, n) => (
                  <li key={text} data-on={n === step ? '' : undefined}>
                    {bind(text)}
                  </li>
                ))}
              </ol>
              <p className="h3-oral-dots" aria-hidden="true">
                {TILES.oralSteps.map((text, n) => (
                  <i key={text} data-on={n === step ? '' : undefined} />
                ))}
              </p>
            </div>
          </div>
          <div id="door-teacher" className="h3-door h3-door--teacher">
            {/* The game on the projector: decoration, the door's words say what it is. */}
            <div className="h3-proj" aria-hidden="true">
              <img className="h3-proj-poster" src={STAND_RUN.poster} alt="" width={STAND_RUN.width} height={STAND_RUN.height} decoding="async" />
              {game}
            </div>
            <div className="h3-door-text">
              <p className="h3-door-who">{DOORS.teacher.who}</p>
              <h2 className="h3-door-h">{bind(DOORS.teacher.title)}</h2>
              <ul className="h3-door-pts">
                {DOORS.teacher.points.map((text) => (
                  <li key={text}>{bind(text)}</li>
                ))}
              </ul>
            </div>
            <div className="h3-acts">
              <a className="h3-pill h3-pill--white" href={SAMPLE_TEST_URL}>
                {DOORS.teacher.test}
                <i>
                  <ArrowIcon />
                </i>
              </a>
              <a className="h3-textlink" href={DOORS.teacher.signUpUrl}>
                {DOORS.teacher.signUp}
              </a>
            </div>
          </div>
        </section>
        {children}
      </main>
    </>
  );
}
