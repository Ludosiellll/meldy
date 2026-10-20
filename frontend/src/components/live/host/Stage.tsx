/**
 * The stage: 900 units high, scaled to the window as one piece (transform, set on resize only). Text is rasterised at
 * the final size, so it stays sharp on a projector; nothing inside reads its own size back.
 */
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { STAGE_H, stageFit, type StageFit } from './layout';

function windowFit(): StageFit {
  if (typeof window === 'undefined') return stageFit(1600, 900);
  return stageFit(window.innerWidth, window.innerHeight);
}

export function useStageFit(): StageFit {
  const [fit, setFit] = useState(windowFit);
  useEffect(() => {
    let frame = 0;
    const on = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const next = windowFit();
        setFit((f) => (f.scale === next.scale && f.width === next.width && f.left === next.left && f.top === next.top ? f : next));
      });
    };
    window.addEventListener('resize', on);
    return () => {
      window.removeEventListener('resize', on);
      cancelAnimationFrame(frame);
    };
  }, []);
  return fit;
}

const WidthContext = createContext(1600);

/** The stage's width in units. */
export const useStageWidth = () => useContext(WidthContext);

export function Stage({ fit, children, label }: { fit: StageFit; children: ReactNode; label: string }) {
  return (
    <div className="lvh lvh-viewport">
      <main
        className="lvh-stage"
        aria-label={label}
        style={{ width: fit.width, height: STAGE_H, transform: `translate(${fit.left}px, ${fit.top}px) scale(${fit.scale})` }}
      >
        <WidthContext.Provider value={fit.width}>{children}</WidthContext.Provider>
      </main>
    </div>
  );
}
