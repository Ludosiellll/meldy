import { createContext, useContext, useEffect, useId, useState, useRef, ReactNode, type KeyboardEvent } from 'react';
import { lazyPart, useLazyPart } from '../lib/lazyPart';

/**
 * The dialog's markup and framer-motion are a file of their own (ConfirmDialog.tsx): the provider
 * mounts it the first time a dialog opens, or earlier, once the idle prefetch has fetched it.
 */
export const confirmDialogPart = lazyPart(() => import('./ConfirmDialog').then((module) => module.default));

export interface ConfirmOptions {
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
  /**
   * A notice (alert) with a second, quieter button left of the main one (e.g. «Что даёт PRO»):
   * it closes the dialog like the main button and then runs onSecondary. Escape and the backdrop
   * only close.
   */
  secondaryText?: string;
  onSecondary?: () => void;
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

  const handleSecondary = () => {
    const action = options?.onSecondary;
    close(false);
    action?.();
  };

  // Its file failed to load: the question is answered «no» (a notice is closed), so no caller waits forever.
  const Dialog = useLazyPart(confirmDialogPart, isOpen, {
    immediate: true,
    onError: (error) => {
      console.error('Не удалось загрузить окно подтверждения:', error);
      close(false);
    },
  });

  // Focus moves into the dialog: the safe choice for a question («Отмена»), the only button for a notice.
  // Dialog is a dependency: the first time, the dialog appears once its file has arrived.
  useEffect(() => {
    if (!isOpen) return;
    const node = dialogRef.current;
    if (!node) return;
    const target = node.querySelector<HTMLElement>('[data-autofocus]') ?? node;
    target.focus();
  }, [isOpen, options, Dialog]);

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

      {Dialog ? (
        <Dialog
          isOpen={isOpen}
          options={options}
          isAlert={isAlert}
          isChecked={isChecked}
          onCheckedChange={setIsChecked}
          titleId={titleId}
          messageId={messageId}
          dialogRef={dialogRef}
          onKeyDown={handleKeyDown}
          onCancel={handleCancel}
          onConfirm={handleConfirm}
          onSecondary={handleSecondary}
        />
      ) : null}
    </ConfirmContext.Provider>
  );
}

export function useConfirm() {
  const context = useContext(ConfirmContext);
  if (!context) throw new Error('useConfirm must be used within ConfirmProvider');
  return context;
}
