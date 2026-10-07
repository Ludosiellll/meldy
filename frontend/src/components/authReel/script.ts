/**
 * The two short reels of the sign-in pages (owner, 2026-10-04: «анимацию покруче … в виде видоса»;
 * then, with a reference promo: «мне не нравятся эти надписи по углам, только Meldy можно оставить,
 * а также менее иишно … делай все видосы в вот таком стиле»). They run on the reel engine
 * (components/reel: one clock, scenes as pure functions of time on a 1920 × 1080 stage) in the film
 * style (components/film), and loop: the last beat ends on the yellow dot the first one starts from.
 */

export type AuthReelVariant = 'login' | 'register';

export interface AuthScene {
  id: string;
  /** First moment on the stage; the entrance overlaps the previous scene's exit. */
  from: number;
  to: number;
}

export interface AuthScript {
  total: number;
  scenes: readonly AuthScene[];
  /** The still frame shown when motion is reduced. */
  poster: number;
  /** The small «Meldy» in the corner: shown from the first moment, gone from the second (the big wordmark). */
  corner: readonly [number, number];
  caption: string;
  /** What the reel shows, for screen readers (the stage is hidden from them). */
  transcript: readonly string[];
}

/**
 * Sign-in: the student comes back to the sheet as they left it, then the four steps of the landing
 * (Release 29): the department's questions with quotes from their lectures, the ticket aloud with the
 * examiner's follow-up, and lines that only answers erase — the line named again on another day goes
 * at the end. Example: «Микроэкономика» of /try, question 7 (data/example/questions.ts).
 */
export const LOGIN_SCRIPT: AuthScript = {
  total: 18000,
  scenes: [
    { id: 'back', from: 0, to: 3800 },
    { id: 'answers', from: 3400, to: 7000 },
    { id: 'ticket', from: 6600, to: 10200 },
    { id: 'erase', from: 9800, to: 14000 },
    { id: 'ready', from: 13600, to: 18000 },
  ],
  poster: 13000,
  corner: [700, 15200],
  caption: 'Ролик: как работает Meldy, 18 секунд, без звука.',
  transcript: [
    'Шпаргалка на месте: экзамен «Микроэкономика», у вопроса 6 главные строки стёрты, у вопроса 7 одна строка стёрта наполовину.',
    'Ответы — из лекций: вопросы кафедры сверены с вашими лекциями, у вопроса 7 — цитата из лекции «Эластичность спроса».',
    'Билет — вслух: вопрос 7, ответ голосом, по ключевым словам названо 3 пункта из 4. Экзаменатор переспрашивает: «А если спрос неэластичный, как продавцу увеличить выручку?»',
    'Стирают только ответы: после ответа в другой день 1 строка стёрлась, 2 — наполовину, а строка, названная только после вопроса экзаменатора, не стёрлась.',
    'Цель — пустая шпаргалка. Meldy — тренажёр устного экзамена по билетам кафедры.',
  ],
};

/** Sign-up: the same four steps from the start — the department's list goes in first. */
export const REGISTER_SCRIPT: AuthScript = {
  total: 19000,
  scenes: [
    { id: 'list', from: 0, to: 4000 },
    { id: 'answers', from: 3600, to: 7400 },
    { id: 'ticket', from: 7000, to: 10800 },
    { id: 'erase', from: 10400, to: 15000 },
    { id: 'ready', from: 14600, to: 19000 },
  ],
  poster: 13700,
  corner: [700, 16200],
  caption: 'Ролик: от списка вопросов до шпаргалки, 19 секунд, без звука.',
  transcript: [
    'Список кафедры: в новый экзамен добавлен файл со списком вопросов, распознано 12 вопросов.',
    'Ответы — из лекций: вопросы кафедры сверены с вашими лекциями, у вопроса 7 — цитата из лекции «Эластичность спроса».',
    'Билет — вслух: вопрос 7, ответ голосом, по ключевым словам названо 3 пункта из 4. Экзаменатор переспрашивает: «А если спрос неэластичный, как продавцу увеличить выручку?»',
    'Стирают только ответы: после ответа в другой день 1 строка стёрлась, 2 — наполовину, а строка, названная только после вопроса экзаменатора, не стёрлась.',
    'Начните со списка. Meldy — тренажёр устного экзамена по билетам кафедры.',
  ],
};

export const SCRIPTS: Record<AuthReelVariant, AuthScript> = { login: LOGIN_SCRIPT, register: REGISTER_SCRIPT };

/** A scene is put on the stage this early, hidden, so its first visible frame is ready. */
export const PREMOUNT = 400;

/** A screen leaves over this long, ending as its scene ends (the next one is already coming in). */
export const EXIT = 440;

/** When a scene's screen and words start to leave (its own time). */
export function leaveOf(script: AuthScript, id: string): number {
  const scene = script.scenes.find((item) => item.id === id);
  if (!scene) throw new Error(`Unknown scene ${id}`);
  return scene.to - scene.from - EXIT;
}

/**
 * The scenes on the stage at `t` (with the hidden premount lead), in story order. The first scene is
 * also premounted at the end of the loop, so the wrap to 0 needs no render.
 */
export function scenesAt(script: AuthScript, t: number): string[] {
  return script.scenes
    .filter((scene) => (t >= scene.from - PREMOUNT && t < scene.to) || (scene.from === 0 && t >= script.total - PREMOUNT))
    .map((scene) => scene.id);
}

/** A scene shows only inside its own window (a premounted one waits hidden). */
export function sceneVisible(scene: AuthScene, t: number): boolean {
  return t >= scene.from && t < scene.to;
}

/** How much of the corner «Meldy» shows at `t`: it fades in and out over 300 ms. */
export function cornerOpacity(script: AuthScript, t: number): number {
  const [from, to] = script.corner;
  const fadeIn = Math.min(1, Math.max(0, (t - from) / 300));
  const fadeOut = 1 - Math.min(1, Math.max(0, (t - to) / 300));
  return Math.min(fadeIn, fadeOut);
}
