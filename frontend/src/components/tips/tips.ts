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
export type TipId = 'talk';

export interface TipDef {
  id: TipId;
  title: string;
  /** One or two sentences: what the feature does, in its own words. */
  text: string;
  /** The primary action: does the thing. */
  action: string;
  /** The quiet one: the tip goes away for good. */
  later: string;
}

export const TIPS: Record<TipId, TipDef> = {
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
};

/** Remembered on this device as soon as the tip is dismissed or used. */
export const TIP_KEY_PREFIX = 'meldy_tip_';

/** The profile's `onboarding_status` key (other devices). */
export function tipProfileKey(id: TipId): string {
  return `tip_${id}`;
}
