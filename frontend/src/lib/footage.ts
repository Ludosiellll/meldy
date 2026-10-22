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

/**
 * The same 10.8 s on one student's phone: the real phone page (/play, 390 × 844, the 3D view) drawn frame by frame from
 * the same recorded game (deck/cf11/media/product/masters/12-game-rec.json, the recording STAND_RUN's projector was
 * drawn from), following Лёва, who runs from the far right across the floor to «А Меркурий» and stands («Вы на ответе»),
 * then the stomp, the floor falling under the others and his «Верно +980». The same two spans of the recording at the
 * same 25 fps, so frame k here is the moment of STAND_RUN's frame k: a page plays the two in step (lib/footageSync).
 * 360 × 780, 370 KB in four parts; the poster is the moment of STAND_RUN's poster. The backdrop is the page's own top
 * and bottom.
 *
 * STAND_RUN's frame k is the projector replay's frame 315 + k (k < 165) or 595 + k, which shows the recording's ms
 * (frame + 1) × 40: 12 640–19 200 and 30 440–34 600. The phone's frames are those ms of
 * `deck/cf11/tools/record/stand_phone_replay.mjs 12-game-rec.json <dir> --follow 12 --end 34600
 * --windows 12640-19200,30440-34600`, in the cut's order, encoded with x264 (High 4.0, CRF 31, a key frame every 4 s,
 * yuv420p, BT.709, faststart, no sound).
 */
export const STAND_RUN_PHONE: Footage = {
  ...files('stand-run-phone', '1897562cbf', 4),
  width: 360,
  height: 780,
  duration: 10.8,
  type: 'video/mp4; codecs="avc1.640028"',
  backdrop: 'linear-gradient(#2a2456 50%, #151535 50%)',
};

/*
 * The landing's tiles (components/home3, the layout «D — Плитки», owner 22.10). Each cut is made by
 * `node scripts/footage-parts.mjs <in.mp4> <poster> <name>`, which prints the definition to paste here.
 *
 * STAND-INS until the new clips are cut: the deck's product recordings (deck/cf11/media/product/08-oral-answer,
 * lecture-materials and 07-exam-plan, H.264 as they are, posters from their .jpg). The phone tiles' cuts are the wide
 * ones for now (a phone shows them cropped to 4:5); the real 4:5 cuts get their own names.
 */

/** «Ответ вслух, как на экзамене»: a ticket answered aloud on the phone page. 608 × 1318, 25.73 s, 500 KB in 6 parts. */
export const LANDING_ORAL: Footage = {
  ...files('landing-oral', '06394255e5', 6),
  width: 608,
  height: 1318,
  duration: 25.73,
  type: 'video/mp4; codecs="avc1.640028"',
  backdrop: 'linear-gradient(#cfd0cd 50%, #cfcfca 50%)',
};

/** «Лекция → конспект, карточки, тест, подкаст» on a computer. 1152 × 568, 30 s, 1244 KB in 14 parts. */
export const LANDING_LECTURE_WIDE: Footage = {
  ...files('landing-lecture-wide', '8b7d6a7f65', 14),
  width: 1152,
  height: 568,
  duration: 30,
  type: 'video/mp4; codecs="avc1.640028"',
  backdrop: 'linear-gradient(#f1f2ee 50%, #dde0e6 50%)',
};

/** The lecture on a phone (4:5). A stand-in: the wide cut. */
export const LANDING_LECTURE_PHONE: Footage = LANDING_LECTURE_WIDE;

/** «Вопросы кафедры → план по дням» on a computer. 1152 × 568, 23.6 s, 631 KB in 7 parts. */
export const LANDING_EXAM_WIDE: Footage = {
  ...files('landing-exam-wide', 'de8548899e', 7),
  width: 1152,
  height: 568,
  duration: 23.6,
  type: 'video/mp4; codecs="avc1.640028"',
  backdrop: 'linear-gradient(#f2f3ee 50%, #f4f4f3 50%)',
};

/** The exam on a phone (4:5). A stand-in: the wide cut. */
export const LANDING_EXAM_PHONE: Footage = LANDING_EXAM_WIDE;

/** Every cut a page uses (the files in public/game/footage/ are exactly these; lib/footage.test.ts). */
export const ALL_FOOTAGE: readonly Footage[] = [
  STAND_RUN,
  STAND_RUN_PHONE,
  LANDING_ORAL,
  LANDING_LECTURE_WIDE,
  LANDING_LECTURE_PHONE,
  LANDING_EXAM_WIDE,
  LANDING_EXAM_PHONE,
];

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
