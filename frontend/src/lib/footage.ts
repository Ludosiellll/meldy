/**
 * Real footage of the app (a screen recording) played in a page, where a drawn clip would only be a picture of it: the
 * guide's «Игра в классе» and the test page's first-use tip show the class running to the answers on the projector.
 *
 * The video is one MP4 file (H.264, no sound) cut into parts of under 100 KB: the Hugging Face Space refuses a pushed
 * binary file over 100 KB (backend/tests/test_space_binaries.py). The page fetches the parts, joins them in order into
 * one Blob and plays it from an object URL (the CSP's media-src has blob:). Every name carries the first ten hex digits
 * of the whole video's SHA-256, so nginx keeps the files for a year (nginx.conf, location ~ ^/game/footage/) and a new
 * cut gets new names. The player is components/film/Footage.tsx.
 */

export interface Footage {
  /** The video's parts in order: joined, they are the MP4 file. */
  parts: readonly string[];
  /** A still of the footage at the same frame size: shown until the video plays, and alone with reduced motion. */
  poster: string;
  /** The frame (px). */
  width: number;
  height: number;
  /** The length (s). */
  duration: number;
  /** The MIME type with its codecs: a browser that cannot play it is not sent the parts. */
  type: string;
  /** The colour of the frame's edges (any CSS background): bars around the frame in it read as part of the picture. */
  backdrop: string;
}

const DIR = `${import.meta.env.BASE_URL ?? '/'}game/footage/`;

/** A cut's files: `<name>-<hash>-1.bin` … `-<count>.bin` and `<name>-<hash>-poster.webp`. */
function files(name: string, hash: string, count: number) {
  return {
    parts: Array.from({ length: count }, (_, at) => `${DIR}${name}-${hash}-${at + 1}.bin`),
    poster: `${DIR}${name}-${hash}-poster.webp`,
  };
}

/**
 * «Встань на ответ» on the projector (the real 3D screen, a recorded game with 30 players):
 * 6.6 s of the class running from the boss to the four answers («Какая планета ближе всего к Солнцу?»), then 4.2 s of
 * the boss's stomp, the wrong floor falling and «Устояли 18 из 30». 800 × 450, 25 fps, 465 KB in five parts.
 * The backdrop is the scene's own dark violet, sampled from the frame's top and bottom rows.
 */
export const STAND_RUN: Footage = {
  ...files('stand-run', '46f8c5a7ae', 5),
  width: 800,
  height: 450,
  duration: 10.8,
  type: 'video/mp4; codecs="avc1.640028"',
  backdrop: 'linear-gradient(#2a2356 50%, #28224e 50%)',
};

/** Whether this browser says it can play the footage (asked before anything is fetched). */
export function canPlayFootage(footage: Footage): boolean {
  if (typeof document === 'undefined') return false;
  try {
    return document.createElement('video').canPlayType(footage.type) !== '';
  } catch {
    return false;
  }
}

async function fetchPart(url: string): Promise<Blob> {
  const response = await fetch(url, { credentials: 'same-origin' });
  // A missing file comes back as the app's own page (the SPA fallback answers 200 with index.html).
  const kind = response.headers.get('content-type') ?? '';
  if (!response.ok || kind.includes('text/html')) throw new Error(`footage part ${url}: HTTP ${response.status} ${kind}`);
  return response.blob();
}

/** A part, asked for again once if the first try fails. */
async function part(url: string): Promise<Blob> {
  try {
    return await fetchPart(url);
  } catch {
    return fetchPart(url);
  }
}

/** The loads by footage (its parts' names): one per page life, shared by every player. */
const loads = new Map<string, Promise<string>>();

/**
 * The footage as an object URL: its parts fetched (all at once, joined in their order) into one `video/mp4` Blob. The
 * URL is kept for the rest of the page's life, so a second player, or the same chapter shown again, starts at once.
 * Rejects when a part fails twice; the next call then tries again (the caller keeps the poster meanwhile).
 */
export function loadFootage(footage: Footage): Promise<string> {
  const key = footage.parts.join('\n');
  const known = loads.get(key);
  if (known) return known;
  const load = Promise.all(footage.parts.map(part)).then((blobs) =>
    URL.createObjectURL(new Blob(blobs, { type: footage.type.split(';')[0].trim() })),
  );
  loads.set(key, load);
  load.catch(() => {
    if (loads.get(key) === load) loads.delete(key);
  });
  return load;
}
