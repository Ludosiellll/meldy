import { useCallback, useEffect, useRef, useState, type ComponentType, type ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth';
import { fetchTelegramState } from '../../api/telegram';
import { lazyPart, useLazyPart } from '../../lib/lazyPart';
import type { ContainerSummary, DayPlan } from '../../types/container';
import type { PlanTip } from '../containers/PlanCard';
import { Sheet } from '../containers/ui';
import TipCard from '../tips/TipCard';
import { TIPS } from '../tips/tips';
import { tipSeenHere, useFirstUseTip } from '../tips/useFirstUseTip';

/**
 * The Telegram bot's first-use tip on the exam's page (tips.ts `telegram`): «План на день в Telegram», its clip (the
 * bot's chat as Telegram for Android draws it: the day's card at 20:00, «Начать», a question answered with a button,
 * «Верно.»; a square frame beside the words on a computer, none on a phone), pointing at today's plan on the page — the
 * plan the bot sends. Once
 * (useFirstUseTip: «Не сейчас» or the action put it away for good, and so do two visits that only showed it), and only
 * where it is true and useful:
 * - the site has the bot (`telegram_link_state` exists: not isTelegramMissing) and this account is not linked yet; an
 *   account found linked has the feature in use, and the tip is put away without being shown;
 * - this exam has questions with variants (what the bot asks in the chat) and the student has answered some of them —
 *   so never on the first visit right after the import — and it still has days to plan (not on its day, not after it);
 * - the guide is not open and its first run is behind (useFirstUseTip);
 * - never on the example (/try).
 *
 * Its action opens the profile's link window here, in a sheet (TelegramCard TelegramLinkWindow): the code is asked at
 * once; a phone gets «Открыть Telegram», which opens the bot's chat in the app, a computer the QR code for the phone and
 * «Открыть Telegram на компьютере». That is one press to the bot's «Запустить» on both, and the student stays on the
 * exam; /profile#telegram would add a page and a second «Подключить Telegram» there. The sheet is a bottom sheet on a
 * phone (room for the full-width button above the page's own bar) and a card on a computer (room for the code beside the
 * words), which the tip's own card, a narrow card or a sheet over the «Начать» bar, has not.
 */

/** The tip's moment on the page's side: an exam the bot can plan and ask, answered in already, with days ahead. */
export function telegramTipWorthy(summary: ContainerSummary | null | undefined, plan: DayPlan | null | undefined): boolean {
  if (!summary || !plan) return false;
  if (plan.state !== 'study' && plan.state !== 'done' && plan.state !== 'nothing') return false;
  const withVariants = summary.subjects.some((subject) => subject.keyed > 0);
  const answered = summary.answers_today > 0 || summary.subjects.some((subject) => subject.seen > 0);
  return withVariants && answered;
}

const onExample = (pathname: string) => /^\/try(\/|$)/.test(pathname);

/**
 * The link window lives with the profile's card (its QR code, its link's life): a file the exam page does not carry,
 * fetched when the tip comes and shown on its press.
 */
export const telegramWindowPart = lazyPart<ComponentType<{ onClose: () => void }>>(() =>
  import('./TelegramCard').then((module) => module.TelegramLinkWindow),
);

type Known = 'unknown' | 'unlinked' | 'linked' | 'none';

/** What the site knows of this account's Telegram, read once a visit while `ask` holds: 'none' when the bot is not there or the read failed. */
function useTelegramKnown(userId: string | null, ask: boolean): Known {
  const [known, setKnown] = useState<Known>('unknown');
  useEffect(() => {
    if (!ask || !userId || known !== 'unknown') return undefined;
    const controller = new AbortController();
    fetchTelegramState(controller.signal).then(
      (state) => {
        if (!controller.signal.aborted) setKnown(state === null ? 'none' : state.linked ? 'linked' : 'unlinked');
      },
      () => {
        if (!controller.signal.aborted) setKnown('none');
      },
    );
    return () => controller.abort();
  }, [ask, userId, known]);
  return known;
}

export interface ExamTelegramTip {
  /** For the plan card: its title's words are the anchor, the card comes after them (null while no tip is shown). */
  tip: PlanTip | null;
  /** The link window, while it is open. */
  window: ReactNode;
}

export function useExamTelegramTip({ summary, plan }: { summary: ContainerSummary | null | undefined; plan: DayPlan | null | undefined }): ExamTelegramTip {
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const { pathname } = useLocation();
  const anchor = useRef<HTMLElement>(null);
  const [linking, setLinking] = useState(false);
  const worthy = Boolean(userId) && !onExample(pathname) && telegramTipWorthy(summary, plan);
  const known = useTelegramKnown(userId, worthy && !tipSeenHere('telegram'));
  const tip = useFirstUseTip('telegram', { enabled: worthy && known === 'unlinked' });

  // Linked already (here, on another device, from the bot's own link): the feature is in use; the tip is not needed.
  const { done } = tip;
  useEffect(() => {
    if (known === 'linked') done();
  }, [known, done]);

  // The window's file comes with the tip, so its press opens the window at once.
  useEffect(() => {
    if (tip.show) void telegramWindowPart.load().catch(() => undefined);
  }, [tip.show]);
  const LinkWindow = useLazyPart(telegramWindowPart, linking, {
    immediate: true,
    onError: (error) => console.error('Окно Telegram не загрузилось:', error),
  });

  const open = useCallback(() => {
    done();
    setLinking(true);
  }, [done]);
  const close = useCallback(() => {
    setLinking(false);
    // The tip that opened the window is gone: the focus goes to today's plan, which it was about.
    document.querySelector<HTMLElement>('.ct-plan-t')?.focus({ preventScroll: true });
  }, []);

  // The whole plan card is what the tip is about: the card hangs right under it, over the page (no row of the plan's own
  // controls lies between them to step over).
  const card = tip.show ? <TipCard tip={TIPS.telegram} anchor={anchor} controlBand={0} onAction={open} onDismiss={tip.dismiss} /> : null;
  return {
    tip: card ? { anchor, card } : null,
    window: linking ? (
      <Sheet title={TIPS.telegram.title} onClose={close}>
        {LinkWindow ? <LinkWindow onClose={close} /> : <div className="tg-window" aria-busy="true" />}
      </Sheet>
    ) : null,
  };
}
