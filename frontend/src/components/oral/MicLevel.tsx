import { useEffect, useRef } from 'react';
import type { LevelFeed } from '../../hooks/useVoiceAnswer';

/**
 * Пять столбиков громкости микрофона: видно, что микрофон слышит. Рисуется через CSS-переменную
 * на самом элементе, без React-состояния — страница билета не перерисовывается 20 раз в секунду.
 */
export default function MicLevel({ feed, label = 'Громкость микрофона' }: { feed: LevelFeed; label?: string }) {
  const ref = useRef<HTMLSpanElement | null>(null);
  useEffect(() => {
    const element = ref.current;
    if (!element) return undefined;
    let frame = 0;
    let latest = 0;
    const unsubscribe = feed.subscribe((level) => {
      latest = level;
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        element.style.setProperty('--or-level', latest.toFixed(3));
      });
    });
    return () => {
      unsubscribe();
      if (frame) cancelAnimationFrame(frame);
      element.style.setProperty('--or-level', '0');
    };
  }, [feed]);
  return (
    <span ref={ref} className="or-level" role="img" aria-label={label}>
      <i />
      <i />
      <i />
      <i />
      <i />
    </span>
  );
}
