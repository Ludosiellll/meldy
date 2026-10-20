import type { ReactNode } from 'react';
import { CTA, HEADLINE, LEAD, NAV, SAMPLE_TEST_URL, bind } from './copy3';

export function ArrowIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M5 12h14M13 6l6 6-6 6" />
    </svg>
  );
}

/**
 * The landing's first screen: the top line and the hero. index.html carries the same markup as plain HTML
 * (#static-hero, painted before any script; hero3.test.tsx compares the two), so it is links and text only: the
 * page turns its links into the app's navigation by one click handler on its root.
 */
export default function HeroTop({ reel, children }: { reel: ReactNode; children?: ReactNode }) {
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
              <ArrowIcon />
            </a>
          </div>
        </div>
        <div className="h3-reel-slot">{reel}</div>
      </section>
      {children}
      </main>
    </>
  );
}
