import type { CSSProperties, ReactNode } from 'react';
import { LANDING_ORAL } from '../../lib/footage';
import { CTA, HEADLINE, LEAD, NAV, SAMPLE_TEST_URL, TILES, bind } from './copy3';

export function ArrowIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M5 12h14M13 6l6 6-6 6" />
    </svg>
  );
}

/**
 * The landing's first screen (owner, 22.10: the layout «D — Плитки»): the top line, then two tiles, the headline with
 * its two links on white and «Ответ вслух, как на экзамене» on blue, a phone playing a ticket answered aloud.
 *
 * index.html carries the same markup as plain HTML (#static-hero, painted before any script; hero3.test.tsx compares
 * the two), so it is links, text and the phone's poster only: the poster is an <img> with its size, and the page lays
 * the video over it (`oral`, after the window's load event) once it has taken the static screen's place. The page
 * turns the links into the app's navigation by one click handler on its root.
 *
 * The blue tile (owner 19.11): its heading, a whole phone, and under it the step the phone plays now — its number and
 * its name, with the four steps as dots, as the tiles' clips name theirs. All four names are in the page (a list); the
 * one that plays is shown (`step`; the static screen shows the first).
 */
export default function HeroTop({ oral, step = 0, children }: { oral?: ReactNode; step?: number; children?: ReactNode }) {
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
          <div className="h3-hero-text">
            <h1 id="h3-title" className="h3-h1">
              {bind(HEADLINE)}
            </h1>
            <p className="h3-lead">{bind(LEAD)}</p>
            <div className="h3-acts">
              <a className="h3-pill h3-pill--blue" href="/try">
                {CTA.example}
                <i>
                  <ArrowIcon />
                </i>
              </a>
              <a className="h3-textlink" href={SAMPLE_TEST_URL}>
                {CTA.test}
              </a>
            </div>
          </div>
          <div className="h3-oral">
            <div className="h3-oral-text">
              <h2 className="h3-oral-h">{bind(TILES.oral)}</h2>
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
            {/* On a phone the screen keeps the recording's proportions (hero3.css): nothing of its sides is cut. */}
            <div className="h3-oral-phone" aria-hidden="true" style={{ '--oral-ar': `${LANDING_ORAL.width} / ${LANDING_ORAL.height}` } as CSSProperties}>
              <img className="h3-oral-poster" src={LANDING_ORAL.poster} alt="" width={LANDING_ORAL.width} height={LANDING_ORAL.height} decoding="async" />
              {oral}
            </div>
          </div>
        </section>
        {children}
      </main>
    </>
  );
}
