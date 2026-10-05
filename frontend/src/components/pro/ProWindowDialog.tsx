import {
  Component,
  Suspense,
  lazy,
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from 'react';
import { Link } from 'react-router-dom';
import { Check, X } from 'lucide-react';
import { useAuth } from '../../hooks/useAuth';
import { formatLimitReset, nextLimitReset } from '../../api/limits';
import { FREE_DAILY_UNITS, PRO_DAILY_UNITS, type ProReason } from '../../lib/plans';
import { track } from '../../lib/telemetry';
import { proGainLine, proLede, unitsPerDay } from './planCopy';
import { ProDemoClosedError, announcePlanChange, loadProState, startProDemo, stopProDemo, type ProState } from './proPlan';
import './proWindow.css';

/** The reel loads with the first opening: the rest of the app does not carry it. */
const ProReel = lazy(() => import('./ProReel'));

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Without the reel (its file did not load) the window still says everything in words. */
class ReelBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: unknown) {
    console.error('Ролик PRO не загрузился:', error);
  }

  render() {
    return this.state.failed ? null : this.props.children;
  }
}

function ledeFor(reason: ProReason): string {
  if (reason === 'limit') return `Дневной лимит на сегодня исчерпан. Он обновится в ${formatLimitReset(nextLimitReset())}.`;
  return proLede();
}

/** The arrow in the dark circle of the main button (the language's primary pill). */
function ArrowIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <path d="M4 10h11M11 5.5 15.5 10 11 14.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** The honest line under the action: there is no payment, PRO is switched on for free. */
export const DEMO_NOTE = 'Демо: оплата не подключена — PRO включится бесплатно и сразу.';

export interface WindowProps {
  reason: ProReason;
  onClose: () => void;
}

/**
 * «PRO»: what the plan changes, in plain words and the real numbers of lib/plans.ts, under a reel
 * that shows it. Payment is not connected, so «Купить PRO» is a demo (owner, 2026-10-05: «нажимаешь на
 * купить и тебе ее выдаст просто бесплатно»): it switches PRO on at once and for free and says so under
 * the button — no price, no card, no imitated payment. With PRO the window says so and offers «Отключить
 * PRO», so the demo can be taken again. The top line's limit meter follows at once (proPlan.ts).
 */
export default function ProWindow({ reason, onClose }: WindowProps) {
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const titleId = useId();
  const ledeId = useId();
  const card = useRef<HTMLDivElement>(null);
  const doneLine = useRef<HTMLParagraphElement>(null);
  const buyButton = useRef<HTMLButtonElement>(null);
  const [pro, setPro] = useState<ProState | null>(userId ? null : { isPro: null });
  const [busy, setBusy] = useState<'buy' | 'cancel' | null>(null);
  const [failed, setFailed] = useState<'buy' | 'closed' | 'cancel' | null>(null);
  const [done, setDone] = useState<'bought' | 'cancelled' | null>(null);
  // Bumped after a purchase: the reel jumps to its PRO beat.
  const [reelJump, setReelJump] = useState(0);

  useEffect(() => {
    if (!userId) {
      setPro({ isPro: null });
      return undefined;
    }
    let current = true;
    setPro(null);
    void loadProState(userId).then((next) => {
      if (current) setPro(next);
    });
    return () => {
      current = false;
    };
  }, [userId]);

  // The focus moves into the window and stays there; Escape closes it.
  useEffect(() => {
    card.current?.focus({ preventScroll: true });
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      onClose();
    };
    const onFocusIn = (event: FocusEvent) => {
      const node = card.current;
      if (node && event.target instanceof Node && !node.contains(event.target)) node.focus({ preventScroll: true });
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('focusin', onFocusIn);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('focusin', onFocusIn);
    };
  }, [onClose]);

  // The page under the window holds still (the scrollbar's room is kept, so nothing jumps).
  useEffect(() => {
    const root = document.documentElement;
    const body = document.body;
    const gap = root.clientWidth > 0 ? window.innerWidth - root.clientWidth : 0;
    const previous = { root: root.style.overflow, body: body.style.overflow, pad: body.style.paddingRight };
    root.style.overflow = 'hidden';
    body.style.overflow = 'hidden';
    if (gap > 0 && gap < 40) body.style.paddingRight = `${gap}px`;
    return () => {
      root.style.overflow = previous.root;
      body.style.overflow = previous.body;
      body.style.paddingRight = previous.pad;
    };
  }, []);

  const trap = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Tab') return;
    const node = card.current;
    if (!node) return;
    const focusable = Array.from(node.querySelectorAll<HTMLElement>(FOCUSABLE));
    if (focusable.length === 0) {
      event.preventDefault();
      return;
    }
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const active = document.activeElement;
    if (event.shiftKey && (active === first || active === node)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  };

  // «Купить PRO»: the demo switches PRO on; the meter in the top line and the reel follow at once.
  const buy = async () => {
    if (!userId || busy) return;
    setBusy('buy');
    setFailed(null);
    try {
      await startProDemo();
      track('pro_demo_bought', { reason });
      setPro({ isPro: true });
      setDone('bought');
      setReelJump((count) => count + 1);
      announcePlanChange();
    } catch (error) {
      if (error instanceof ProDemoClosedError) {
        setFailed('closed');
      } else {
        console.error('Не удалось включить PRO:', error);
        setFailed('buy');
      }
    } finally {
      setBusy(null);
    }
  };

  // «Отключить PRO»: back to the free day, so the demo can be repeated.
  const cancel = async () => {
    if (!userId || busy) return;
    setBusy('cancel');
    setFailed(null);
    try {
      await stopProDemo();
      track('pro_demo_cancelled', { reason });
      setPro({ isPro: false });
      setDone('cancelled');
      announcePlanChange();
    } catch (error) {
      console.error('Не удалось отключить PRO:', error);
      setFailed('cancel');
    } finally {
      setBusy(null);
    }
  };

  // The control that was pressed is gone after the change: the focus goes to what replaced it.
  useEffect(() => {
    if (done === 'bought') doneLine.current?.focus();
    if (done === 'cancelled') buyButton.current?.focus();
  }, [done]);

  const loading = pro === null;
  const isPro = pro?.isPro === true;
  const proDay = unitsPerDay(PRO_DAILY_UNITS);
  const announcement =
    done === 'bought' ? `Готово — у вас PRO. Дневной лимит теперь — ${proDay}.` : done === 'cancelled' ? 'PRO отключён.' : '';

  return (
    <div className="pw">
      <div className="pw-dim" aria-hidden="true" onClick={onClose} />
      <div
        ref={card}
        className="pw-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={ledeId}
        tabIndex={-1}
        onKeyDown={trap}
      >
        <div className="pw-x-row">
          <button type="button" className="pw-x" onClick={onClose} aria-label="Закрыть">
            <X aria-hidden="true" />
          </button>
        </div>

        <div className="pw-reel">
          <ReelBoundary>
            <Suspense fallback={<div className="pw-reel-wait" aria-hidden="true" />}>
              <ProReel jump={reelJump} />
            </Suspense>
          </ReelBoundary>
        </div>

        <div className="pw-body">
          <h2 id={titleId} className="pw-h">
            PRO
          </h2>
          <p id={ledeId} className="pw-lede" data-reason={done === 'bought' ? undefined : reason}>
            {done === 'bought' ? proLede() : ledeFor(reason)}
          </p>
          <p className="pw-gain">{proGainLine()}</p>

          {!userId ? (
            <>
              <Link className="pw-buy" to="/login">
                Войти
                <i>
                  <ArrowIcon />
                </i>
              </Link>
              <p className="pw-pay">После входа PRO включится бесплатно: это демо, оплата не подключена.</p>
            </>
          ) : loading ? (
            <div className="pw-wait" role="status" aria-label="Проверяем тариф" />
          ) : isPro ? (
            <>
              <p ref={doneLine} className="pw-status" tabIndex={-1}>
                <span className="pw-pill">
                  <Check aria-hidden="true" />
                  {done === 'bought' ? 'Готово — у вас PRO' : 'У вас PRO'}
                </span>
              </p>
              <p className="pw-now">{done === 'bought' ? `Дневной лимит теперь — ${proDay}.` : `Дневной лимит — ${proDay}.`}</p>
              <p className="pw-pay">Демо: оплата не подключена, PRO включён бесплатно.</p>
              <button
                type="button"
                className="pw-quiet"
                aria-disabled={busy ? 'true' : undefined}
                aria-busy={busy === 'cancel' ? 'true' : undefined}
                onClick={() => void cancel()}
              >
                {busy === 'cancel' ? 'Отключаем…' : 'Отключить PRO'}
              </button>
              {failed === 'cancel' ? (
                <p className="pw-error" role="alert">
                  Не удалось отключить PRO. Проверьте подключение и нажмите ещё раз.
                </p>
              ) : null}
            </>
          ) : (
            <>
              {pro?.isPro === false ? (
                <p className="pw-status">
                  {done === 'cancelled' ? 'PRO отключён. ' : ''}Сейчас у вас бесплатный тариф: {unitsPerDay(FREE_DAILY_UNITS)}.
                </p>
              ) : null}
              {failed === 'closed' ? (
                <p className="pw-status pw-closed" role="alert">
                  Бесплатное демо PRO закрыто.
                </p>
              ) : (
                <>
                  <button
                    ref={buyButton}
                    type="button"
                    className="pw-buy"
                    aria-disabled={busy ? 'true' : undefined}
                    aria-busy={busy === 'buy' ? 'true' : undefined}
                    onClick={() => void buy()}
                  >
                    {busy === 'buy' ? 'Включаем PRO…' : 'Купить PRO'}
                    <i>
                      <ArrowIcon />
                    </i>
                  </button>
                  <p className="pw-pay">{DEMO_NOTE}</p>
                  {failed === 'buy' ? (
                    <p className="pw-error" role="alert">
                      Не удалось включить PRO. Проверьте подключение и нажмите ещё раз.
                    </p>
                  ) : null}
                </>
              )}
            </>
          )}
          <p className="sr-only" aria-live="polite">
            {announcement}
          </p>
        </div>
      </div>
    </div>
  );
}
