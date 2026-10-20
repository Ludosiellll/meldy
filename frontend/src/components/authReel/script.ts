/**
 * The two short reels of the sign-in pages (owner, 2026-10-04: «анимацию покруче … в виде видоса»;
 * then, with a reference promo: «мне не нравятся эти надписи по углам, только Meldy можно оставить,
 * а также менее иишно … делай все видосы в вот таком стиле»). They run on the reel engine
 * (components/reel: one clock, scenes as pure functions of time on a 1920 × 1080 stage) in the film
 * style (components/film), and loop: the last beat ends on the yellow dot the first one starts from.
 *
 * Since 2026-10-10 they tell the exam as it is now (decision 2026-10-09, the universal exam): one exam for the whole
 * preparation — the department's file, a plan by days, a mistake back the next day, oral questions aloud against the
 * student's own lectures with the cheat sheet in Meldy's own look (decision 2026-10-10), one link for the group. The
 * example is «Осенняя сессия» (data/containerExample.ts) with /try's «Микроэкономика» as its oral part.
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

/** The beats both reels share, as screen readers hear them. */
const SESSION_LINE =
  'Ошибка вернётся завтра: в занятии по базам данных выбран неверный вариант, Meldy показывает ответ из файла — «Неверно. В файле — SERIALIZABLE. Вернётся через пару вопросов и завтра».';
const ORAL_LINE =
  'Ответ вслух по вашим лекциям: вопрос 7 по микроэкономике, ответ голосом. На шпаргалке строка, названная в другой день, зачёркивается, две строки названы впервые и отмечены жёлтым, а строка, названная только после вопроса экзаменатора, остаётся. На карте шпаргалки становится на один пустой квадрат больше.';

/**
 * Sign-in: the student comes back to today's plan of the exam, then a question of the day's session, an oral answer
 * that strikes a line off the sheet, the group's one link — and «Продолжите с того же места».
 */
export const LOGIN_SCRIPT: AuthScript = {
  total: 19200,
  scenes: [
    { id: 'today', from: 0, to: 3800 },
    { id: 'session', from: 3400, to: 7200 },
    { id: 'oral', from: 6800, to: 11800 },
    { id: 'group', from: 11400, to: 15200 },
    { id: 'ready', from: 14800, to: 19200 },
  ],
  poster: 10800,
  corner: [700, 16400],
  caption: 'Ролик: как работает Meldy, 19 секунд, без звука.',
  transcript: [
    '960 вопросов в одном плане: экзамен «Осенняя сессия» через 18 дней, пять предметов и 960 вопросов. Сегодня 90 вопросов, около 45 минут; верно в два разных дня — 143 из 960.',
    SESSION_LINE,
    ORAL_LINE,
    'Одна ссылка на всю группу: по ней каждый получит весь экзамен, а план на день может приходить в Telegram.',
    'Продолжите с того же места. Meldy — подготовка к экзамену и конструктор тестов.',
  ],
};

/** Sign-up: from the start — the department's file goes in, the plan by days, a session, an oral answer. */
export const REGISTER_SCRIPT: AuthScript = {
  total: 19200,
  scenes: [
    { id: 'file', from: 0, to: 3800 },
    { id: 'plan', from: 3400, to: 7200 },
    { id: 'session', from: 6800, to: 10600 },
    { id: 'oral', from: 10200, to: 15200 },
    { id: 'ready', from: 14800, to: 19200 },
  ],
  poster: 14200,
  corner: [700, 16400],
  caption: 'Ролик: от файла с вопросами до плана на каждый день, 19 секунд, без звука.',
  transcript: [
    'В одном файле 960 вопросов: в новый экзамен добавлен файл кафедры, Meldy нашёл 5 предметов и 960 вопросов, ключ взят из оформления файла.',
    'Около 45 минут в день: план по дням до экзамена, в последние три дня новых вопросов нет, только знакомые.',
    SESSION_LINE,
    ORAL_LINE,
    'Начните со списка. Meldy — подготовка к экзамену и конструктор тестов.',
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
