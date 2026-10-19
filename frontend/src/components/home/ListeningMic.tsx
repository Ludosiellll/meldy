import { useEffect, useRef } from 'react';

/**
 * The microphone of «Как это работает», step 3, «listening»: its pulse (home.css, .hm-mic rings) runs only while the
 * mic is on screen or about to be, so a page scrolled past it has nothing left moving there. Without an
 * IntersectionObserver it simply runs.
 */
export default function ListeningMic() {
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = root.current;
    if (!el) return undefined;
    if (typeof IntersectionObserver === 'undefined') {
      el.setAttribute('data-live', '');
      return undefined;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        // The attribute is set directly: a scroll past the mic renders nothing.
        const entry = entries[entries.length - 1];
        el.toggleAttribute('data-live', entry.isIntersecting);
      },
      { rootMargin: '48px 0px' },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return (
    <div ref={root} className="hm-mic">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="9" y="3" width="6" height="11" rx="3" />
        <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
      </svg>
    </div>
  );
}
