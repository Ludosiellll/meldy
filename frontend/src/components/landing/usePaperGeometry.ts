import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { buildGeometry, type MeasuredText, type PaperGeometry, type PaperLine, type Variant } from './paperTimeline';

/* ------------------------------------------------------------------ */
/* Measuring words (shared with the «Попробуйте сами» sheet)           */
/* ------------------------------------------------------------------ */

const PHONE_QUERY = '(max-width: 639px)';
/** Same ranges as the compact canvas in PaperHero.css. */
const COMPACT_QUERY = '(min-width: 640px) and (max-width: 767px), (min-width: 1024px) and (max-width: 1279px)';

export function readVariant(): Variant {
  if (typeof window === 'undefined') return 'desktop';
  if (typeof window.matchMedia === 'function') {
    if (window.matchMedia(PHONE_QUERY).matches) return 'phone';
    return window.matchMedia(COMPACT_QUERY).matches ? 'compact' : 'desktop';
  }
  const w = window.innerWidth;
  if (w <= 639) return 'phone';
  return (w <= 767 || (w >= 1024 && w <= 1279)) ? 'compact' : 'desktop';
}

/**
 * Distance from the top of an inline box's content area to its baseline in `host`'s font.
 * A temporary «Ж» with a zero-size inline-block marker sits at the baseline; it is appended
 * after the words (never inside them, where it would create a line-break opportunity).
 */
export function measureAscent(host: HTMLElement) {
  const probe = document.createElement('span');
  probe.textContent = 'Ж';
  const mark = document.createElement('i');
  mark.style.cssText = 'display:inline-block;width:0;height:0;vertical-align:baseline';
  probe.appendChild(mark);
  host.appendChild(probe);
  const ascent = mark.getBoundingClientRect().top - probe.getBoundingClientRect().top;
  probe.remove();
  return Number.isFinite(ascent) ? ascent : 0;
}

export interface WordBox { text: string; x: number; y: number; w: number; h: number; baseline: number }

/** Word boxes relative to `origin`, grouped into lines by baseline (|Δ| < 3 px). */
export function measureWordLines(words: HTMLElement[], origin: DOMRect, ascent: number) {
  const boxes: WordBox[] = words.map(el => {
    const r = el.getBoundingClientRect();
    const y = r.top - origin.top;
    return { text: el.textContent ?? '', x: r.left - origin.left, y, w: r.width, h: r.height, baseline: y + ascent };
  });
  const lines: Array<PaperLine & { words: WordBox[] }> = [];
  for (const box of boxes) {
    let line = lines.find(l => Math.abs(l.baseline - box.baseline) < 3);
    if (!line) {
      line = { x0: box.x, x1: box.x + box.w, baseline: box.baseline, top: box.y, text: '', words: [] };
      lines.push(line);
    }
    line.x0 = Math.min(line.x0, box.x);
    line.x1 = Math.max(line.x1, box.x + box.w);
    line.top = Math.min(line.top, box.y);
    line.words.push(box);
  }
  lines.sort((a, b) => a.baseline - b.baseline);
  for (const line of lines) line.text = line.words.map(w => w.text).join(' ');
  return { boxes, lines };
}

/** Transforms are visual only; drop ours while reading layout boxes, then put them back. */
export function withoutTransforms<T>(elements: Array<HTMLElement | SVGElement | null | undefined>, read: () => T): T {
  const saved = elements.map(el => (el ? el.style.transform : ''));
  elements.forEach(el => { if (el) el.style.transform = 'none'; });
  try {
    return read();
  } finally {
    elements.forEach((el, i) => { if (el) el.style.transform = saved[i]; });
  }
}

/** Baseline offset inside a `.ph-ln` line (line-height 1) at the given font size. */
function measureLineBaseline(host: HTMLElement, fontPx: number) {
  const probe = document.createElement('span');
  probe.className = 'ph-ln';
  probe.style.fontSize = `${fontPx}px`;
  probe.style.visibility = 'hidden';
  const mark = document.createElement('i');
  mark.style.cssText = 'display:inline-block;width:0;height:0;vertical-align:baseline';
  probe.appendChild(mark);
  probe.appendChild(document.createTextNode('Ж'));
  host.appendChild(probe);
  const offset = mark.getBoundingClientRect().top - probe.getBoundingClientRect().top;
  probe.remove();
  return Number.isFinite(offset) ? offset : fontPx * 0.8;
}

/* ------------------------------------------------------------------ */
/* Hero geometry                                                        */
/* ------------------------------------------------------------------ */

export interface PaperRefs {
  fit: RefObject<HTMLDivElement>;
  scene: RefObject<HTMLElement>;
  page: RefObject<HTMLDivElement>;
  pageText: RefObject<HTMLDivElement>;
  key: RefObject<HTMLParagraphElement>;
}

export interface PaperMeasure {
  geo: PaperGeometry;
  /** Baseline offset inside a `.ph-ln` line of the slip (page size). */
  baseline: number;
}

function measurePaper(refs: PaperRefs): PaperMeasure | null {
  const fit = refs.fit.current;
  const scene = refs.scene.current;
  const page = refs.page.current;
  const pageText = refs.pageText.current;
  const key = refs.key.current;
  if (!fit || !scene || !page || !pageText || !key) return null;
  const variant = readVariant();
  const dpr = window.devicePixelRatio || 1;
  const { text, pageH } = withoutTransforms([scene, page], () => {
    const origin = pageText.getBoundingClientRect();
    const words = Array.from(key.querySelectorAll<HTMLElement>('[data-kw]'));
    const ascent = measureAscent(key);
    const { boxes, lines } = measureWordLines(words, origin, ascent);
    const commaWord = boxes.find(b => /,$/.test(b.text));
    const commaLine = commaWord ? lines.findIndex(l => l.words.includes(commaWord)) : -1;
    const measured: MeasuredText = {
      lines: lines.map(({ x0, x1, baseline, top, text: lineText }) => ({ x0, x1, baseline, top, text: lineText })),
      commaLine,
      commaRight: commaWord ? commaWord.x + commaWord.w : 0,
      fs: parseFloat(getComputedStyle(key).fontSize) || 17,
      paraLeft: key.getBoundingClientRect().left - origin.left,
    };
    return { text: measured, pageH: page.getBoundingClientRect().height || page.offsetHeight };
  });
  const geo = buildGeometry(text, { variant, pageH, dpr });
  return { geo, baseline: measureLineBaseline(fit, text.fs) };
}

const same = (a: PaperMeasure | null, b: PaperMeasure | null) => JSON.stringify(a) === JSON.stringify(b);

/**
 * Measures the key sentence on mount, when fonts arrive, on width changes and across the
 * canvas breakpoints (640, 768, 1024, 1280 px). Every frame is a function of (t, geometry), so the caller just renders
 * again with the new geometry and keeps its clock.
 */
export function usePaperGeometry(refs: PaperRefs, fontsReady: boolean, onResize: () => void) {
  const [measure, setMeasure] = useState<PaperMeasure | null>(null);
  const onResizeRef = useRef(onResize);
  onResizeRef.current = onResize;
  // Measuring a fallback serif would size the canvas for the wrong font and shift the
  // layout when Literata arrives; until then the caller sizes the stage from the design canvas.
  const fontsReadyRef = useRef(fontsReady);
  fontsReadyRef.current = fontsReady;

  const remeasure = useCallback(() => {
    if (fontsReadyRef.current) {
      const next = measurePaper(refs);
      if (next) setMeasure(prev => (same(prev, next) ? prev : next));
    }
    onResizeRef.current();
    // refs are stable objects created by the caller
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useLayoutEffect(() => {
    remeasure();
  }, [fontsReady, remeasure]);

  useEffect(() => {
    const fonts = typeof document !== 'undefined' ? document.fonts : undefined;
    let alive = true;
    fonts?.ready?.then(() => { if (alive) remeasure(); }).catch(() => {});
    return () => { alive = false; };
  }, [remeasure]);

  useEffect(() => {
    const fit = refs.fit.current;
    if (!fit || typeof ResizeObserver === 'undefined') return;
    let width = fit.clientWidth;
    let dpr = window.devicePixelRatio || 1;
    const observer = new ResizeObserver(() => {
      const nextWidth = fit.clientWidth;
      const nextDpr = window.devicePixelRatio || 1;
      // Height-only changes (a phone toolbar collapsing) never re-fit the scene.
      if (nextWidth === width && nextDpr === dpr) return;
      width = nextWidth;
      dpr = nextDpr;
      remeasure();
    });
    observer.observe(fit);
    return () => observer.disconnect();
  }, [refs.fit, remeasure]);

  return measure;
}
