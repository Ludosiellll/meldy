/**
 * The landing v3 «Один вопрос» (owner, 2026-10-19): one ticket question goes through the whole of Meldy in the reel,
 * and the page follows the reel's order — the lecture, the exam, the group, then the test constructor, the longest
 * part, with a small studio to touch. The first screen is also in index.html as plain HTML (#static-hero), so it paints
 * before any script; this page takes its place without a visible change.
 */
import { startTransition, useEffect, useLayoutEffect, useState, type MouseEvent, type SyntheticEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth';
import { lazyPart, useLazyPart } from '../../lib/lazyPart';
import { prefetchLink } from '../../lib/prefetch';
import { TELEMETRY_NOTE } from '../../lib/telemetry';
import Builder from './Builder';
import { CTA, FINAL, FOOTER, SAMPLE_TEST_URL, bind } from './copy3';
import HeroTop, { ArrowIcon } from './HeroTop';
import { ExamSection, GroupSection, LectureSection } from './Sections';
import './hero3.css';
import './home3.css';

/** The reel: its own file, fetched once the page has loaded (the largest paint is the headline, not the reel). */
const reelPart = lazyPart(() => import('../reel3/Reel3').then((module) => module.default));

function ReelSlot({ onCta }: { onCta: () => void }) {
  useEffect(() => {
    const load = () => void reelPart.load().catch((error) => console.error('Ролик не загрузился:', error));
    if (document.readyState === 'complete') {
      load();
      return undefined;
    }
    window.addEventListener('load', load, { once: true });
    return () => window.removeEventListener('load', load);
  }, []);
  const Reel = useLazyPart(reelPart, true);
  return Reel ? <Reel onCta={onCta} /> : <div className="h3-reel-wait" aria-hidden="true" />;
}

function FinalSection() {
  return (
    <section className="h3-wrap p3-sec" aria-labelledby="final-h">
      <div className="p3-final">
        <h2 id="final-h" className="p3-h2">
          {bind(FINAL.title)}
        </h2>
        <p className="p3-text">{bind(FINAL.text)}</p>
        <div className="p3-final-acts">
          <a className="h3-pill h3-pill--blue" href="/try">
            {CTA.example}
            <i>
              <ArrowIcon />
            </i>
          </a>
          <a className="h3-pill h3-pill--white" href={SAMPLE_TEST_URL}>
            {CTA.test}
            <i>
              <ArrowIcon />
            </i>
          </a>
          <a className="h3-textlink" href="/register">
            {CTA.signUp}
            <ArrowIcon />
          </a>
        </div>
      </div>
    </section>
  );
}

export default function Landing3() {
  const navigate = useNavigate();
  const { user, requestSession } = useAuth();

  useEffect(() => {
    if (user) navigate('/dashboard');
  }, [user, navigate]);

  // The first screen renders alone; the sections below it render next, as a transition React splits into short
  // pieces, so building the long page never blocks a frame (phone check ×4: one 280 ms task without this).
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

  return (
    <div className="h3" onClick={follow} onPointerOver={intent} onTouchStart={intent} onFocus={intent}>
      <HeroTop reel={<ReelSlot onCta={() => navigate('/try')} />}>
        {rest ? (
          <>
            <LectureSection />
            <ExamSection />
            <GroupSection />
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
          <p className="p3-foot-note">{TELEMETRY_NOTE}</p>
        </footer>
      ) : null}
    </div>
  );
}
