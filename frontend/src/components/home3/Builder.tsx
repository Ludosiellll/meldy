/**
 * «Конструктор тестов», the page's longest section: the small studio to touch (its own file, fetched when the section
 * comes near), the link with its QR code and «Пройти тест без входа» (the public example test), and the author's
 * results as the results page shows them.
 */
import { useEffect, useRef, useState, type ComponentType } from 'react';
import { lazyPart, useLazyPart } from '../../lib/lazyPart';
import { BUILDER_SECTION, CTA, EXAMPLE, PICTURES, SAMPLE_TEST_URL, SITE, bind } from './copy3';
import { ArrowIcon } from './HeroTop';
import { SectionHead } from './Sections';
import Swap from './Swap';

/** «Собрать свой тест»: sign up, then straight into the quick test (Register honours ?next=). */
export const BUILD_URL = '/register?next=/tests/quick';

/** The small studio and the QR code: one file, fetched when the section comes near (the QR library goes with it). */
const partsPart = lazyPart(() => import('./MiniStudio').then((module) => ({ MiniStudio: module.default, Qr: module.TestQr })));

function SendCard({ Qr }: { Qr: ComponentType | null }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(`${SITE}${SAMPLE_TEST_URL}`);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };
  return (
    <article className="p3-card">
      <div className="p3-card-text">
        <h3 className="p3-h3">{BUILDER_SECTION.sendTitle}</h3>
        <p className="p3-p">{bind(BUILDER_SECTION.sendText)}</p>
        <div className="p3-ctas">
          <a className="h3-pill h3-pill--blue p3-test" href={SAMPLE_TEST_URL}>
            {CTA.test}
            <i>
              <ArrowIcon />
            </i>
          </a>
          {/* The quick test after sign-up (the UX audit 21.10: the landing showed the builder, with no way into it). */}
          <a className="h3-pill h3-pill--white p3-build" href={BUILD_URL}>
            {CTA.build}
          </a>
        </div>
        <p className="p3-p p3-game">{bind(BUILDER_SECTION.game)}</p>
      </div>
      <div className="p3-stage">
        <div className="p3-win p3-send">
          {Qr ? <Qr /> : <span className="p3-qr" aria-hidden="true" />}
          <div className="p3-send-side">
            <p className="p3-meta">{PICTURES.linkLabel}</p>
            <p className="p3-link">{EXAMPLE.link}</p>
            <button type="button" className="p3-action" onClick={copy}>
              <Swap items={PICTURES.copyLink} at={copied ? 1 : 0} />
            </button>
          </div>
        </div>
      </div>
    </article>
  );
}

const PEOPLE = [
  { name: 'Анна К.', status: '3 из 5', time: '', live: true },
  { name: 'Дмитрий С.', guest: true, status: '5 из 5', time: '6 мин' },
  { name: 'Мария Л.', status: '4 из 5', time: '8 мин' },
  { name: 'Илья П.', guest: true, status: '3 из 5', time: '9 мин' },
];

function StatsCard() {
  return (
    <article className="p3-card">
      <div className="p3-card-text">
        <h3 className="p3-h3">{BUILDER_SECTION.statsTitle}</h3>
        <p className="p3-p">{bind(BUILDER_SECTION.statsText)}</p>
      </div>
      <div className="p3-stage">
      <div className="p3-win">
        <p className="p3-meta">{PICTURES.results}</p>
        <p className="p3-stats">{PICTURES.resultsLine}</p>
        {PEOPLE.map((person) => (
          <p key={person.name} className={`p3-person${person.live ? ' is-live' : ''}`}>
            <b>
              {person.name}
              {person.guest ? <small>{PICTURES.noAccount}</small> : null}
            </b>
            <span>{person.status}</span>
            <span>{person.live ? PICTURES.writing : person.time}</span>
          </p>
        ))}
        <p className="p3-meta p3-hard">{PICTURES.hardest}</p>
        <p className="p3-qline">
          <span>{PICTURES.hardestQuestion}</span>
          <i>
            <b style={{ width: '38%' }} />
          </i>
          <em>{PICTURES.hardestRight}</em>
        </p>
      </div>
      </div>
    </article>
  );
}

export default function Builder() {
  const slot = useRef<HTMLDivElement>(null);
  const [near, setNear] = useState(false);
  useEffect(() => {
    const el = slot.current;
    if (!el || typeof IntersectionObserver === 'undefined') {
      setNear(true);
      return undefined;
    }
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        setNear(true);
        observer.disconnect();
      }
    }, { rootMargin: '900px 0px' });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (near) void partsPart.load().catch(() => undefined);
  }, [near]);
  const parts = useLazyPart(partsPart, near);
  const MiniStudio = parts?.MiniStudio ?? null;
  return (
    <section id="builder" className="p3-band" aria-labelledby="builder-h">
      <div className="h3-wrap">
      <SectionHead id="builder-h" title={BUILDER_SECTION.title} text={BUILDER_SECTION.text} />
      <div className="p3-try">
        <h3 className="p3-h3">{BUILDER_SECTION.tryTitle}</h3>
        <p className="p3-p">{bind(BUILDER_SECTION.tryText)}</p>
        <div ref={slot} className="p3-studio-slot">
          {MiniStudio ? <MiniStudio /> : <div className="p3-studio-wait" aria-hidden="true" />}
        </div>
      </div>
      <div className="p3-grid p3-grid--2">
        <SendCard Qr={parts?.Qr ?? null} />
        <StatsCard />
      </div>
      </div>
    </section>
  );
}
