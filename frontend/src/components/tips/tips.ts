/**
 * First-use tips: a short card that points at a feature the first time it is in reach — a clip of
 * the feature in the film style of the guide, a title, a sentence or two, «Попробовать» and «Не
 * сейчас». The guide shows the app as a whole on the first run; a tip shows one feature on the page
 * where it is used. Once dismissed or used a tip never comes back (useFirstUseTip).
 *
 * The words are the screen's own (check every claim against what the feature does). The clips live in
 * a file of their own with the reel engine (clipPart.ts, clips.ts), so this list costs a page nothing.
 */

/**
 * The exam's cheat sheet had a tip of its own until 2026-10-07: the exam page's status block now says what
 * erases the lines and the one next step, and a second card with its own «Тянуть билет» only repeated it.
 */
export type TipId = 'talk' | 'telegram' | 'move' | 'game';
/** The tips shown as a card under their anchor (TipCard) with a clip of tips/scenes; «move» lives in its dialog. */
export type CardTipId = Exclude<TipId, 'move'>;

export interface TipDef {
  id: TipId;
  title: string;
  /** One or two sentences: what the feature does, in its own words. */
  text: string;
  /** The primary action: does the thing. */
  action: string;
  /** The quiet one: the tip goes away for good. */
  later: string;
  /**
   * The clip's frame when it is not the usual 16:10: its width to its height (its stage in scenes TIP_CLIPS, or its footage in TIP_FOOTAGE, has that shape),
   * and whether it follows the site's dark theme (the Telegram chat is drawn in Telegram's night colours there).
   */
  clip?: { ratio: number; themed: boolean };
}

export const TIPS: { [K in TipId]: TipDef & { id: K } } = {
  // The voice tutor (pages/LectureTalk.tsx): it asks the lecture's cards («Meldy задаст 4 вопроса по карточкам
  // этой лекции»), climbs hints (a hint, then the lecture's own words on a slip «Из лекции, фрагмент N»), and the
  // student answers by voice or in writing. The title is the button's own name, word for word.
  talk: {
    id: 'talk',
    title: 'Поговорить о лекции',
    text: 'Meldy задаст вопросы по карточкам этой лекции, подскажет и покажет нужный фрагмент. Отвечайте голосом или текстом.',
    action: 'Попробовать',
    later: 'Не сейчас',
  },
  // The Telegram bot, on the exam's page (components/telegram/ExamTelegramTip): the title, the words and the action are
  // the profile card's own (TelegramCard TELEGRAM_COPY: title, about — set as the card sets it, short words held to the
  // next one — and connect), so the tip and «Профиль» say the same. The bot sends the day's plan once a day and asks the
  // exam's questions with variants in the chat, 20 a session.
  telegram: {
    id: 'telegram',
    title: 'План на день в Telegram',
    text: 'Раз в\u00a0день бот пришлёт план на\u00a0сегодня. Вопросы экзамена можно решать прямо в\u00a0чате, по\u00a020\u00a0за\u00a0раз.',
    action: 'Подключить Telegram',
    later: 'Не сейчас',
    // The bot's chat as Telegram draws it: a phone's width, from the header to the input bar — a square.
    clip: { ratio: 1, themed: true },
  },
  // «Провести игру» on the test's own page (TestHome): the first time a test can be played, a card under the button with
  // the footage the guide's «Игра в классе» shows (lib/footage.ts STAND_RUN: the real game on the projector, the class
  // running to the answers, the floor dropping), in its own 16:9 frame. Its action is the button's own; using the button
  // puts the tip away too.
  game: {
    id: 'game',
    title: 'Игра в классе',
    text: 'Вопросы теста идут на проекторе. Ученики играют с телефонов, на сайте или в Telegram.',
    action: 'Провести игру',
    later: 'Не сейчас',
    clip: { ratio: 16 / 9, themed: false },
  },
  // «Перенести экзамен» (MoveExamDialog): the first time the dialog opens, a compact card at its top with the clip of a
  // move (components/clips «move»: the exam's day, the dialog, «Экзамен перенесён на 25 октября.» and the plan made
  // again). Its action is the dialog's own «Перенести» (MoveExamTip marks the tip used when the form is sent).
  move: {
    id: 'move',
    title: 'План пересчитается сам',
    text: 'После переноса Meldy заново разложит вопросы по дням до новой даты.',
    action: 'Перенести',
    later: 'Не сейчас',
  },
};

/** A tip shown as a card under its anchor (TipCard). */
export type CardTipDef = TipDef & { id: CardTipId };

/** Remembered on this device as soon as the tip is dismissed or used. */
export const TIP_KEY_PREFIX = 'meldy_tip_';

/** The profile's `onboarding_status` key (other devices). */
export function tipProfileKey(id: TipId): string {
  return `tip_${id}`;
}
