import { forwardRef, useCallback, useEffect, useRef, useState } from 'react';
import { AI_USAGE_EVENT, checkAILimit, formatLimitReset, nextLimitReset } from '../api/limits';
import './quotaMeter.css';

/**
 * The daily AI limit in the top line (owner, 2026-10-05: «лимит ИИ нужно вынести чтобы его было видно»):
 * a ring of what is left today and the number of units left; «Лимит ИИ» next to them where the line has
 * room. The full sentence («Лимит ИИ: осталось 80 из 100, обновится в 3:00») is its accessible name and,
 * on hover or keyboard focus, a tooltip. The shell decides what a click does (Layout.tsx): explain the
 * limit, read it again, or open the PRO window when the day is spent.
 */

export type QuotaLevel = 'loading' | 'unknown' | 'ok' | 'low' | 'empty';

/** At or below this share of the day left, the meter turns yellow. */
export const LOW_SHARE = 0.2;

/** What the meter shows: still reading, could not read, plenty, little (≤ 20 %), nothing left. */
export function quotaLevel(remaining: number | null, limit: number, loaded: boolean): QuotaLevel {
  if (remaining === null || !Number.isFinite(remaining)) return loaded ? 'unknown' : 'loading';
  if (remaining <= 0) return 'empty';
  return remaining <= limit * LOW_SHARE ? 'low' : 'ok';
}

/** The meter's sentence: its accessible name and its tooltip. */
export function quotaSentence(
  level: QuotaLevel,
  remaining: number | null,
  limit: number,
  isPro: boolean,
  resetAt: string = formatLimitReset(nextLimitReset()),
): string {
  const name = isPro ? 'Лимит ИИ (PRO)' : 'Лимит ИИ';
  if (level === 'loading') return `${name}: загружаем остаток`;
  if (level === 'unknown') return `${name}: остаток не удалось загрузить. Нажмите, чтобы проверить ещё раз`;
  return `${name}: осталось ${Math.max(0, remaining ?? 0)} из ${limit}, обновится в ${resetAt}`;
}

export interface QuotaState {
  /** Units used today; null while unknown (not read yet, or the counter could not be read). */
  used: number | null;
  /** The account's day as the server counts it (100, or 1000 with PRO); null until read. */
  limit: number | null;
  /** PRO as the quota answer says; null until read. */
  pro: boolean | null;
  /** The first answer (or failure) has come. */
  loaded: boolean;
}

/** Back to the tab after this long: read again (another tab may have spent units). */
const STALE_MS = 60_000;

/**
 * Today's units of the signed-in account, read with checkAILimit(…, 0) and read again after every AI
 * action (AI_USAGE_EVENT), after a plan change (the PRO window sends the same event), just after the
 * nightly reset, and when the tab comes back after a minute away.
 */
export function useAIQuota(userId: string | undefined): QuotaState & { refetch: () => void } {
  const [state, setState] = useState<QuotaState>({ used: null, limit: null, pro: null, loaded: false });
  const refetchRef = useRef<() => void>(() => undefined);

  useEffect(() => {
    if (!userId) return undefined;
    let request = 0;
    let alive = true;
    let lastRead = 0;
    let resetTimer: ReturnType<typeof setTimeout> | undefined;

    const read = () => {
      const current = ++request;
      lastRead = Date.now();
      checkAILimit(userId, 0)
        .then((res) => {
          if (!alive || current !== request) return;
          const limit = res.ok && Number.isFinite(res.limit) && res.limit > 0 ? res.limit : null;
          setState((previous) => ({
            used: res.ok ? res.count : null,
            limit: limit ?? previous.limit,
            pro: res.ok ? res.isPro : previous.pro,
            loaded: true,
          }));
        })
        .catch(() => {
          if (alive && current === request) setState((previous) => ({ ...previous, used: null, loaded: true }));
        });
    };
    // The counter starts a new day at 00:00 UTC: read it again a few seconds after.
    const planReset = () => {
      clearTimeout(resetTimer);
      const wait = nextLimitReset().getTime() - Date.now() + 5_000;
      resetTimer = setTimeout(() => {
        read();
        planReset();
      }, Math.max(5_000, wait));
    };
    const onVisible = () => {
      if (document.visibilityState === 'visible' && Date.now() - lastRead > STALE_MS) read();
    };

    read();
    planReset();
    refetchRef.current = read;
    window.addEventListener(AI_USAGE_EVENT, read);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      alive = false;
      clearTimeout(resetTimer);
      refetchRef.current = () => undefined;
      window.removeEventListener(AI_USAGE_EVENT, read);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [userId]);

  const refetch = useCallback(() => refetchRef.current(), []);
  return { ...state, refetch };
}

interface MeterProps {
  remaining: number | null;
  limit: number;
  isPro: boolean;
  loaded: boolean;
  onClick: () => void;
  /** The guide talks about the meter: it is lit like a menu item. */
  spot?: boolean;
}

/** The phone's open gauge: 92 % of the circle, the gap of 8 % centred at the top. */
const OPEN = 92;
const OPEN_TURN = `rotate(${-90 + ((100 - OPEN) / 2) * 3.6} 20 20)`;

/** The ring, the number and «Лимит ИИ». The ring and the words are drawn; the sentence is the name. */
const QuotaMeter = forwardRef<HTMLButtonElement, MeterProps>(function QuotaMeter({ remaining, limit, isPro, loaded, onClick, spot }, ref) {
  const level = quotaLevel(remaining, limit, loaded);
  const sentence = quotaSentence(level, remaining, limit, isPro);
  const left = remaining === null ? null : Math.max(0, remaining);
  const share = left === null || limit <= 0 ? 0 : Math.min(100, (left / limit) * 100);
  const number = level === 'unknown' ? '—' : left === null ? '' : String(left);
  return (
    <button
      ref={ref}
      type="button"
      className="sf-quota"
      data-level={level}
      data-digits={number.length}
      data-pro={isPro ? '' : undefined}
      data-guide-spot={spot ? '' : undefined}
      data-testid="quota-meter"
      aria-label={sentence}
      aria-busy={level === 'loading' ? 'true' : undefined}
      onClick={onClick}
    >
      <svg className="sf-quota-ring" viewBox="0 0 40 40" aria-hidden="true" focusable="false">
        <circle className="sf-quota-track sf-quota-full" cx="20" cy="20" r="17.5" />
        <circle
          className="sf-quota-arc sf-quota-full"
          cx="20"
          cy="20"
          r="17.5"
          pathLength={100}
          strokeDasharray={`${share.toFixed(2)} 100`}
          transform="rotate(-90 20 20)"
        />
        {/* A phone draws an open gauge, a gap at the top (quotaMeter.css): read as what is left, not as a second
            avatar next to the account button. */}
        <circle className="sf-quota-track sf-quota-open" cx="20" cy="20" r="17.5" pathLength={100} strokeDasharray={`${OPEN} 100`} transform={OPEN_TURN} />
        <circle
          className="sf-quota-arc sf-quota-open"
          cx="20"
          cy="20"
          r="17.5"
          pathLength={100}
          strokeDasharray={`${((share * OPEN) / 100).toFixed(2)} 100`}
          transform={OPEN_TURN}
        />
      </svg>
      <span className="sf-quota-t" aria-hidden="true">
        Лимит ИИ
      </span>
      <span className="sf-quota-n" aria-hidden="true">
        {number}
      </span>
      <span className="sf-quota-tip" aria-hidden="true">
        {sentence}
      </span>
    </button>
  );
});

export default QuotaMeter;
