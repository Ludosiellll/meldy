import { forwardRef, useCallback, useEffect, useRef, useState, type ForwardedRef, type RefObject } from 'react';
import { canPlayFootage, loadFootage, type Footage as FootageDef } from '../../lib/footage';
import { usePageVisible } from '../landing/usePageVisible';
import { usePrefersReducedMotion } from '../landing/usePrefersReducedMotion';
import './footage.css';

export interface FootageProps {
  footage: FootageDef;
  /**
   * Plays while true, the player is on screen and the tab is visible; stays on its frame otherwise. True by default.
   * False for a reel that drives the video's `currentTime` itself through the ref.
   */
  play?: boolean;
  /** The poster alone, nothing fetched. By default: the reduced-motion setting. False plays anyway (a «Смотреть» pressed). */
  still?: boolean;
  /** `contain` (default): the whole frame, centred, the rest in `background`. `cover`: the box filled, the frame cropped. */
  fit?: 'contain' | 'cover';
  /** What shows around the frame (any CSS background): the footage's own backdrop by default. */
  background?: string;
  className?: string;
  /** The video has its first frame (it may be sought now). */
  onReady?: (video: HTMLVideoElement) => void;
}

/** The parts start to load this far before the player comes into the window. */
const NEAR = '300px';

/**
 * True while the box is within `margin` of the window: false until the observer has looked (a player far down a page
 * loads nothing on mount), always true where IntersectionObserver is missing.
 */
function useOnScreen(box: RefObject<HTMLElement>, margin: string): boolean {
  const [on, setOn] = useState(() => typeof IntersectionObserver === 'undefined');
  useEffect(() => {
    const el = box.current;
    if (!el || typeof IntersectionObserver === 'undefined') return undefined;
    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[entries.length - 1];
        if (entry) setOn(entry.isIntersecting);
      },
      { rootMargin: margin },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [box, margin]);
  return on;
}

function forward<T>(ref: ForwardedRef<T>, value: T | null) {
  if (typeof ref === 'function') ref(value);
  else if (ref) ref.current = value;
}

/**
 * Real footage of the app (lib/footage.ts): a silent looping `<video>` over its poster. The parts are fetched once the
 * player is near the window (never with reduced motion), and the poster stays until the video shows a frame; if the
 * browser cannot play it or a part fails, the poster simply stays. It plays while on screen and the tab is visible, and
 * pauses otherwise. Decoration (aria-hidden): the words next to it say what it shows.
 *
 * The ref is the `<video>` once the footage has loaded (null before, and with the poster alone): a reel can set its
 * `currentTime` itself with `play={false}`.
 */
const Footage = forwardRef<HTMLVideoElement, FootageProps>(function Footage(
  { footage, play = true, still, fit = 'contain', background, className, onReady },
  ref,
) {
  const box = useRef<HTMLDivElement>(null);
  const reduce = usePrefersReducedMotion();
  const posterOnly = still ?? reduce;
  const tabVisible = usePageVisible();
  const near = useOnScreen(box, NEAR);
  const inView = useOnScreen(box, '0px');
  const [video, setVideo] = useState<HTMLVideoElement | null>(null);
  const [source, setSource] = useState<{ footage: FootageDef; url: string } | null>(null);
  const [failed, setFailed] = useState<FootageDef | null>(null);
  /** The video element that has shown a frame (a new element starts on the poster again). */
  const [shownOn, setShownOn] = useState<HTMLVideoElement | null>(null);
  const outer = useRef(ref);
  outer.current = ref;

  const url = source?.footage === footage ? source.url : null;
  const broken = failed === footage;
  const wanted = !posterOnly && near && !broken && !url;

  useEffect(() => {
    if (!wanted) return undefined;
    if (!canPlayFootage(footage)) {
      setFailed(footage);
      return undefined;
    }
    let alive = true;
    loadFootage(footage).then(
      (next) => {
        if (alive) setSource({ footage, url: next });
      },
      () => {
        if (alive) setFailed(footage);
      },
    );
    return () => {
      alive = false;
    };
  }, [wanted, footage]);

  // Stable, so a parent's inline ref does not detach and attach the video on every render.
  const attach = useCallback((el: HTMLVideoElement | null) => {
    if (el) {
      // Set as properties too: React does not always write `muted`, and only a muted video may start on its own.
      el.muted = true;
      el.defaultMuted = true;
      // No cast button over the picture (Chrome on Android draws one on a video without controls).
      el.disableRemotePlayback = true;
    }
    setVideo(el);
    forward(outer.current, el);
  }, []);

  const running = play && inView && tabVisible;
  useEffect(() => {
    if (!video) return;
    if (running) {
      const started = video.play();
      // Refused (a power saver, a browser that will not start a video by itself): the poster stays.
      if (started && typeof started.catch === 'function') started.catch(() => undefined);
    } else if (!video.paused) {
      video.pause();
    }
  }, [video, running]);

  const showVideo = !posterOnly && !broken && url !== null;
  const shown = showVideo && video !== null && shownOn === video;
  const reveal = (event: { currentTarget: HTMLVideoElement }) => setShownOn(event.currentTarget);

  return (
    <div
      ref={box}
      className={className ? `fo ${className}` : 'fo'}
      data-fit={fit}
      data-shown={shown ? '' : undefined}
      style={{ background: background ?? footage.backdrop }}
      aria-hidden="true"
    >
      {/* Lazy: a player far below the fold (the landing's) does not fetch its poster with the first screen. */}
      <img
        className="fo-poster"
        src={footage.poster}
        alt=""
        width={footage.width}
        height={footage.height}
        loading="lazy"
        decoding="async"
        draggable={false}
      />
      {showVideo ? (
        <video
          ref={attach}
          className="fo-video"
          src={url}
          width={footage.width}
          height={footage.height}
          muted
          loop
          playsInline
          preload="auto"
          onLoadedData={(event) => onReady?.(event.currentTarget)}
          onPlaying={reveal}
          onSeeked={reveal}
          onError={() => setFailed(footage)}
        />
      ) : null}
    </div>
  );
});

export default Footage;
