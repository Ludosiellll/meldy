import { createContext, useContext, useEffect, useId, useState, useRef, ReactNode, type KeyboardEvent } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

interface ConfirmOptions {
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  /** Kept for callers; the dialog no longer paints danger or warning colours (redesign spec 3.6). */
  type?: 'danger' | 'warning' | 'info';
  /** Kept for callers; the dialog shows no icon tile. */
  icon?: React.ElementType;
  checkboxLabel?: string;
  onCheckboxChange?: (checked: boolean) => void;
}

interface ConfirmContextType {
  confirm: (options: ConfirmOptions) => Promise<boolean>;
  alert: (options: Omit<ConfirmOptions, 'cancelText'>) => Promise<void>;
}

const ConfirmContext = createContext<ConfirmContextType | null>(null);

const FOCUSABLE = 'button:not([disabled]), input:not([disabled]), [href], [tabindex]:not([tabindex="-1"])';

/** Returns focus to whatever opened the dialog, if it is still on the page. */
function restoreFocus(target: HTMLElement | null) {
  if (!target || !target.isConnected || typeof target.focus !== 'function') return;
  try {
    target.focus({ preventScroll: true });
  } catch {
    target.focus();
  }
}

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);
  const [isAlert, setIsAlert] = useState(false);
  const [isChecked, setIsChecked] = useState(false);
  const [options, setOptions] = useState<ConfirmOptions | null>(null);
  const resolvePromiseRef = useRef<((value: boolean) => void) | null>(null);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  const titleId = useId();
  const messageId = useId();

  const open = (opts: ConfirmOptions, alertMode: boolean) => {
    // The element that had focus before the dialog gets it back on close.
    if (!isOpen) {
      const active = typeof document !== 'undefined' ? document.activeElement : null;
      openerRef.current = active instanceof HTMLElement && active !== document.body ? active : null;
    }
    setOptions(opts);
    setIsAlert(alertMode);
    setIsChecked(false);
    setIsOpen(true);
  };

  const confirm = (opts: ConfirmOptions) => {
    open(opts, false);
    return new Promise<boolean>((resolve) => {
      resolvePromiseRef.current = resolve;
    });
  };

  const alert = (opts: Omit<ConfirmOptions, 'cancelText'>) => {
    open(opts, true);
    return new Promise<void>((resolve) => {
      resolvePromiseRef.current = resolve as any;
    });
  };

  const close = (value: boolean) => {
    setIsOpen(false);
    const opener = openerRef.current;
    openerRef.current = null;
    // Focus goes back first; the caller's continuation runs after and may move it elsewhere.
    restoreFocus(opener);
    if (resolvePromiseRef.current) {
      resolvePromiseRef.current(value);
      resolvePromiseRef.current = null;
    }
  };

  const handleConfirm = () => {
    if (options?.onCheckboxChange) {
      options.onCheckboxChange(isChecked);
    }
    close(true);
  };

  const handleCancel = () => close(false);

  // Focus moves into the dialog: the safe choice for a question («Отмена»), the only button for a notice.
  useEffect(() => {
    if (!isOpen) return;
    const node = dialogRef.current;
    if (!node) return;
    const target = node.querySelector<HTMLElement>('[data-autofocus]') ?? node;
    target.focus();
  }, [isOpen, options]);

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      handleCancel();
      return;
    }
    if (event.key !== 'Tab') return;
    const node = dialogRef.current;
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

  return (
    <ConfirmContext.Provider value={{ confirm, alert }}>
      {children}

      <AnimatePresence>
        {isOpen && options && (
          <div key="confirm-modal-container" className="fixed inset-0 z-[100] flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.15 }}
              onClick={handleCancel}
              aria-hidden="true"
              className="absolute inset-0 bg-black/30"
            />
            <motion.div
              ref={dialogRef}
              role="dialog"
              aria-modal="true"
              aria-labelledby={titleId}
              aria-describedby={messageId}
              tabIndex={-1}
              onKeyDown={handleKeyDown}
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.15 }}
              className="relative w-full max-w-[440px] rounded-lg bg-[var(--sf-surface)] p-6 text-left text-[var(--sf-ink)] outline-none"
              style={{ boxShadow: 'var(--sf-pop-shadow, 0 0 0 1px var(--sf-line), 0 18px 36px -22px rgba(30, 24, 16, .32))' }}
            >
              <h2 id={titleId} className="text-xl font-semibold leading-[1.3] text-[var(--sf-ink)]">
                {options.title}
              </h2>
              <p id={messageId} className="mt-2 text-base leading-relaxed text-[var(--sf-muted)]">
                {options.message}
              </p>
              {options.checkboxLabel && !isAlert && (
                <label className="mt-4 flex min-h-11 cursor-pointer items-center gap-3 text-left">
                  <input
                    type="checkbox"
                    className="h-5 w-5 shrink-0 accent-[var(--sf-ink)]"
                    checked={isChecked}
                    onChange={(e) => setIsChecked(e.target.checked)}
                  />
                  <span className="select-none text-[15px] text-[var(--sf-ink)]">{options.checkboxLabel}</span>
                </label>
              )}
              <div className="mt-6 flex flex-wrap items-center justify-end gap-x-6 gap-y-2">
                {!isAlert && (
                  <button
                    type="button"
                    data-autofocus
                    onClick={handleCancel}
                    className="inline-flex min-h-11 items-center text-base font-medium text-[var(--sf-ink)] underline decoration-1 underline-offset-[5px] [text-decoration-color:color-mix(in_srgb,currentColor_32%,transparent)] hover:[text-decoration-color:currentColor]"
                  >
                    {options.cancelText || 'Отмена'}
                  </button>
                )}
                <button
                  type="button"
                  data-autofocus={isAlert ? true : undefined}
                  onClick={handleConfirm}
                  className="inline-flex min-h-11 items-center justify-center rounded-full bg-[var(--sf-accent)] px-6 text-base font-semibold text-white transition-colors hover:bg-[var(--sf-accent-hover)]"
                >
                  {options.confirmText || 'ОК'}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </ConfirmContext.Provider>
  );
}

export function useConfirm() {
  const context = useContext(ConfirmContext);
  if (!context) throw new Error('useConfirm must be used within ConfirmProvider');
  return context;
}
