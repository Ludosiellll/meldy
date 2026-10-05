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
import { FREE_DAILY_UNITS, type ProReason } from '../../lib/plans';
import { track } from '../../lib/telemetry';
import { proGainLine, proLede, unitsPerDay } from './planCopy';
import { loadProState, recordProInterest, type ProState } from './proInterest';
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

export interface WindowProps {
  reason: ProReason;
  onClose: () => void;
}

/**
 * «PRO»: what the plan changes, in plain words and the real numbers of lib/plans.ts, under a reel
 * that shows it. Payment is not connected, so the window sells nothing: it shows the account's
 * plan and lets a student ask to be told when payment works (a row in pro_interest).
 */
export default function ProWindow({ reason, onClose }: WindowProps) {
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const titleId = useId();
  const ledeId = useId();
  const card = useRef<HTMLDivElement>(null);
  const [pro, setPro] = useState<ProState | null>(userId ? null : { isPro: null, interested: false });
  const [sending, setSending] = useState(false);
  const [failed, setFailed] = useState(false);
  const [noted, setNoted] = useState(false);

  useEffect(() => {
    if (!userId) {
      setPro({ isPro: null, interested: false });
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

  const interested = Boolean(pro?.interested) || noted;
  const notify = async () => {
    if (!userId || sending || interested) return;
    setSending(true);
    setFailed(false);
    try {
      await recordProInterest(userId, reason);
      track('pro_interest_sent', { reason });
      setNoted(true);
    } catch (error) {
      console.error('Не удалось записать просьбу сообщить о PRO:', error);
      setFailed(true);
    } finally {
      setSending(false);
    }
  };

  const loading = pro === null;
  const isPro = pro?.isPro === true;

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
              <ProReel />
            </Suspense>
          </ReelBoundary>
        </div>

        <div className="pw-body">
          <h2 id={titleId} className="pw-h">
            PRO
          </h2>
          <p id={ledeId} className="pw-lede" data-reason={reason}>
            {ledeFor(reason)}
          </p>
          <p className="pw-gain">{proGainLine()}</p>

          {!userId ? (
            <>
              <p className="pw-pay">Оплата пока не подключена — стоимость появится вместе с ней.</p>
              <p className="pw-status">Войдите, и мы сообщим, когда оплата заработает.</p>
              <Link className="pw-notify" to="/login">
                Войти
              </Link>
            </>
          ) : loading ? (
            <div className="pw-wait" role="status" aria-label="Проверяем тариф" />
          ) : isPro ? (
            <p className="pw-status">
              <span className="pw-pill">
                <Check aria-hidden="true" />У вас PRO
              </span>
            </p>
          ) : (
            <>
              {pro?.isPro === false ? <p className="pw-status">Сейчас у вас бесплатный тариф: {unitsPerDay(FREE_DAILY_UNITS)}.</p> : null}
              <p className="pw-pay">Оплата пока не подключена — стоимость появится вместе с ней.</p>
              <button
                type="button"
                className="pw-notify"
                data-done={interested ? '' : undefined}
                aria-disabled={interested || sending ? 'true' : undefined}
                aria-busy={sending ? 'true' : undefined}
                onClick={() => void notify()}
              >
                {interested ? (
                  <>
                    <Check aria-hidden="true" />
                    Сообщим, когда оплата заработает
                  </>
                ) : (
                  'Сообщить, когда появится'
                )}
              </button>
              {failed ? (
                <p className="pw-error" role="alert">
                  Не удалось записать. Проверьте подключение и нажмите ещё раз.
                </p>
              ) : null}
              <p className="sr-only" aria-live="polite">
                {noted ? 'Записали: сообщим, когда оплата заработает.' : ''}
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
