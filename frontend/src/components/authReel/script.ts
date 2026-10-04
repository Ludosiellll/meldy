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

export const LOGIN_SCRIPT: AuthScript = {
  total: 18000,
  scenes: [
    { id: 'source', from: 0, to: 3800 },
    { id: 'summary', from: 3400, to: 7200 },
    { id: 'recall', from: 6800, to: 10600 },
    { id: 'ticket', from: 10200, to: 14000 },
    { id: 'ready', from: 13600, to: 18000 },
  ],
  poster: 9400,
  corner: [700, 15200],
  caption: 'Ролик: как работает Meldy, 18 секунд, без звука.',
  transcript: [
    'Загрузите лекцию: файл ложится в Meldy, отмечены конспект, карточки и тест.',
    'Конспект со ссылками: «фрагмент 3» открывает место в лекции.',
    'Карточки вовремя: ответ «Помню» — и карточка вернётся через 6 дней.',
    'Отвечайте вслух: билет, ответ голосом, вопрос экзаменатора, «Засчитано».',
    'Всё по вашим лекциям. Meldy.',
  ],
};

export const REGISTER_SCRIPT: AuthScript = {
  total: 19000,
  scenes: [
    { id: 'pile', from: 0, to: 3800 },
    { id: 'sheet', from: 3400, to: 8000 },
    { id: 'week', from: 7600, to: 11800 },
    { id: 'exam', from: 11400, to: 15000 },
    { id: 'ready', from: 14600, to: 19000 },
  ],
  poster: 7400,
  corner: [700, 16200],
  caption: 'Ролик: материал становится планом подготовки, 19 секунд, без звука.',
  transcript: [
    'Всё, что дали на парах: лекции, фото доски, запись пары, методичка, вопросы к экзамену.',
    'Вопросы — по лекциям: список вставлен, «Разметить по лекциям» отмечает, какие вопросы есть в лекциях.',
    'Повторение по дням: карточки разложены по дням недели.',
    'К экзамену — с планом: экзамен через 12 дней, доля билетов, «Тянуть билет».',
    'План готов. Meldy.',
  ],
};

export const SCRIPTS: Record<AuthReelVariant, AuthScript> = { login: LOGIN_SCRIPT, register: REGISTER_SCRIPT };

/** A scene is put on the stage this early, hidden, so its first visible frame is ready. */
export const PREMOUNT = 400;

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
