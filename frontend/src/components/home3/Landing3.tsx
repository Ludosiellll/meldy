/**
 * The landing, the layout «D — Плитки» (owner, 2026-10-22): the first screen as two tiles (the headline with its links,
 * and a phone answering a ticket aloud), then tiles of what Meldy does, each with the real screen recorded: the lecture,
 * the exam, the game in class beside two facts, then the test constructor with a small studio to touch, the end and the
 * footer. The first screen is also in index.html as plain HTML (#static-hero), so it paints before any script; this page
 * takes its place without a visible change.
 */
import { startTransition, useEffect, useLayoutEffect, useState, type MouseEvent, type SyntheticEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth';
import { LANDING_ORAL } from '../../lib/footage';
import { prefetchLink } from '../../lib/prefetch';
import Footage from '../film/Footage';
import Builder from './Builder';
import { CTA, FINAL, FOOTER, FOOTER_NOTE, bind } from './copy3';
import HeroTop, { ArrowIcon } from './HeroTop';
import { Tiles } from './Sections';
import './hero3.css';
import './home3.css';

/** The width at which the page takes the phone's cuts and lays out its phone layout (hero3.css, home3.css). */
export const PHONE_QUERY = '(max-width: 640px)';

/** Whether the screen is a phone's when the page opens: read once, so only one of the two cuts is ever fetched. */
function phoneAtOpen(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia(PHONE_QUERY).matches;
}

/** True once the window's load event has fired: no part of a video is fetched before the page's own files. */
function useWindowLoaded(): boolean {
  const [loaded, setLoaded] = useState(() => typeof document !== 'undefined' && document.readyState === 'complete');
  useEffect(() => {
    if (loaded) return undefined;
    const done = () => setLoaded(true);
    if (document.readyState === 'complete') {
      done();
      return undefined;
    }
    window.addEventListener('load', done, { once: true });
    return () => window.removeEventListener('load', done);
  }, [loaded]);
  return loaded;
}

function FinalSection() {
  return (
    <section className="h3-wrap p3-final" aria-labelledby="final-h">
      <h2 id="final-h" className="p3-final-h">
        {bind(FINAL.title)}
      </h2>
      <a className="h3-pill h3-pill--blue" href="/try">
        {CTA.example}
        <i>
          <ArrowIcon />
        </i>
      </a>
    </section>
  );
}

export default function Landing3() {
  const navigate = useNavigate();
  const { user, requestSession } = useAuth();
  const loaded = useWindowLoaded();
  const [phone] = useState(phoneAtOpen);

  useEffect(() => {
    if (user) navigate('/dashboard');
  }, [user, navigate]);

  // The first screen renders alone; the tiles below it render next, as a transition React splits into short pieces,
  // so building the long page never blocks a frame.
  const [rest, setRest] = useState(false);
  useEffect(() => startTransition(() => setRest(true)), []);
  // An address with a section in it (/#builder) lands on the section once it is there.
  useEffect(() => {
    if (!rest || !window.location.hash) return;
    document.getElementById(decodeURIComponent(window.location.hash.slice(1)))?.scrollIntoView();
  }, [rest]);

  // A guest's session is not read on the landing (contexts/AuthContext); the next screen gets it as before.
  useEffect(() => () => requestSession?.(), [requestSession]);

  // This page takes the static first screen's place in the same frame (same markup, same styles).
  useLayoutEffect(() => {
    document.getElementById('static-hero')?.remove();
    document.documentElement.classList.add('sh-off');
  }, []);

  // The page's links are plain anchors (the static first screen has them too): inner ones go through the router.
  const follow = (event: MouseEvent<HTMLDivElement>) => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const link = (event.target as Element).closest('a');
    const href = link?.getAttribute('href');
    if (!link || !href || !href.startsWith('/') || href.startsWith('//') || link.target) return;
    event.preventDefault();
    if (href === '/') window.scrollTo({ top: 0, behavior: 'smooth' });
    else navigate(href);
  };

  // A screen a link leads to is fetched when the visitor points at, touches or focuses the link (nothing at idle).
  const intent = (event: SyntheticEvent<HTMLDivElement>) => {
    const href = (event.target as Element).closest?.('a')?.getAttribute('href');
    if (href?.startsWith('/') && !href.startsWith('//')) prefetchLink(href);
  };

  // The phone's video goes over the static poster after the window's load event (its own poster is the same file,
  // already there, and the video fades in over it once it plays).
  const oral = loaded ? <Footage footage={LANDING_ORAL} fit="cover" background="transparent" /> : null;

  return (
    <div className="h3" onClick={follow} onPointerOver={intent} onTouchStart={intent} onFocus={intent}>
      <HeroTop oral={oral}>
        {rest ? (
          <>
            <Tiles phone={phone} still={!loaded} />
            <Builder />
            <FinalSection />
          </>
        ) : null}
      </HeroTop>
      {rest ? (
        <footer className="h3-wrap p3-foot">
          <a className="h3-logo" href="/" aria-label="Meldy, наверх">
            Meldy
          </a>
          <span>{FOOTER}</span>
          <p className="p3-foot-note">{FOOTER_NOTE}</p>
        </footer>
      ) : null}
    </div>
  );
}
