/**
 * The two short reels of the sign-in pages (owner, 2026-10-04: «анимацию покруче … в виде видоса
 * (как ты делал для главного экрана) но похожий но чуть другой»). They run on the landing reel's
 * engine (components/reel: one clock, scenes as pure functions of time on a 1920 × 1080 stage) with
 * their own scenes, and loop: the last scene wipes back to the paper the first one starts on.
 */

export type AuthReelVariant = 'login' | 'register';

export interface AuthScene {
  id: string;
  /** First moment on the stage; the entrance overlaps the previous scene's exit. */
  from: number;
  to: number;
}

export interface AuthChapter {
  /** The scene it belongs to. */
  id: string;
  label: string;
}

export interface AuthScript {
  total: number;
  scenes: readonly AuthScene[];
  /** One per scene, in order: the HUD label and the dots. */
  chapters: readonly AuthChapter[];
  /** The still frame shown when motion is reduced. */
  poster: number;
  /** When the corner labels turn white (1, over dark and blue scenes) or ink (0); eased over 350 ms. */
  hud: readonly { at: number; light: number }[];
  caption: string;
  /** What the reel shows, for screen readers (the stage is hidden from them). */
  transcript: readonly string[];
}

export const LOGIN_SCRIPT: AuthScript = {
  total: 16000,
  scenes: [
    { id: 'upload', from: 0, to: 4400 },
    { id: 'mark', from: 4000, to: 8400 },
    { id: 'recall', from: 8000, to: 12600 },
    { id: 'ready', from: 12200, to: 16000 },
  ],
  chapters: [
    { id: 'upload', label: 'Лекция' },
    { id: 'mark', label: 'Главное' },
    { id: 'recall', label: 'Проверка' },
    { id: 'ready', label: 'Готово' },
  ],
  poster: 12180,
  hud: [
    { at: 0, light: 0 },
    { at: 8150, light: 1 },
    { at: 15250, light: 0 },
  ],
  caption: 'Ролик: как работает Meldy, 16 секунд, без звука.',
  transcript: [
    'Загрузите лекцию: PDF, DOCX, фото или запись.',
    'Найдите главное: маркер выделяет главную мысль, конспект ссылается на фрагмент лекции.',
    'Проверьте себя: карточка с вопросом, ответ «Помню» — и повторение завтра, через три дня и через неделю.',
    'Вспоминайте, а не перечитывайте. Meldy.',
  ],
};

export const REGISTER_SCRIPT: AuthScript = {
  total: 16000,
  scenes: [
    { id: 'pile', from: 0, to: 4400 },
    { id: 'plan', from: 4000, to: 8400 },
    { id: 'week', from: 8000, to: 12600 },
    { id: 'exam', from: 12200, to: 16000 },
  ],
  chapters: [
    { id: 'pile', label: 'Материалы' },
    { id: 'plan', label: 'План' },
    { id: 'week', label: 'Неделя' },
    { id: 'exam', label: 'Экзамен' },
  ],
  poster: 7000,
  hud: [
    { at: 0, light: 0 },
    { at: 8150, light: 1 },
    { at: 15250, light: 0 },
  ],
  caption: 'Ролик: материал становится планом подготовки, 16 секунд, без звука.',
  transcript: [
    'Всё, что дали на парах: лекции, фото доски, запись, методичка.',
    'Meldy собирает из них план: конспект, карточки, тест и разговор по лекции.',
    'Повторение по дням: карточки возвращаются, когда пора вспомнить.',
    'К экзамену — с планом. Meldy.',
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

/** The chapter playing at `t`: the latest scene that has started. */
export function chapterIndexAt(script: AuthScript, t: number): number {
  let index = 0;
  script.scenes.forEach((scene, i) => {
    if (t >= scene.from + 200) index = i;
  });
  return index;
}

/** 1 = white corner labels, 0 = ink, at reel time `t`. */
export function hudLight(script: AuthScript, t: number): number {
  let value = script.hud[0]?.light ?? 0;
  for (let i = 1; i < script.hud.length; i += 1) {
    const key = script.hud[i];
    if (t < key.at) break;
    const p = Math.min(1, (t - key.at) / 350);
    value = value + (key.light - value) * p;
  }
  return value;
}
