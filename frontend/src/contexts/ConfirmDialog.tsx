import type { ChangeEvent, KeyboardEvent, RefObject } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import type { ConfirmOptions } from './ConfirmContext';

export interface ConfirmDialogProps {
  isOpen: boolean;
  options: ConfirmOptions | null;
  isAlert: boolean;
  isChecked: boolean;
  onCheckedChange: (checked: boolean) => void;
  titleId: string;
  messageId: string;
  dialogRef: RefObject<HTMLDivElement>;
  onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => void;
  onCancel: () => void;
  onConfirm: () => void;
  onSecondary: () => void;
}

/**
 * The confirm/alert dialog itself (ConfirmContext keeps its state). It sits in a file of its own
 * with framer-motion, so the first screen does not carry them: ConfirmProvider mounts it the first
 * time a dialog opens, or earlier, once the idle prefetch has fetched it.
 */
export default function ConfirmDialog({
  isOpen,
  options,
  isAlert,
  isChecked,
  onCheckedChange,
  titleId,
  messageId,
  dialogRef,
  onKeyDown,
  onCancel,
  onConfirm,
  onSecondary,
}: ConfirmDialogProps) {
  return (
    <AnimatePresence>
      {isOpen && options && (
        <div key="confirm-modal-container" className="fixed inset-0 z-[100] flex items-center justify-center p-4">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            onClick={onCancel}
            aria-hidden="true"
            // On the dark page a light dimming left the window hard to tell from the cards (dialog audit 2026-10-07):
            // as dark as under the PRO and limit windows.
            className="absolute inset-0 bg-black/30 dark:bg-black/60"
          />
          <motion.div
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            aria-describedby={messageId}
            tabIndex={-1}
            onKeyDown={onKeyDown}
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
                  onChange={(e: ChangeEvent<HTMLInputElement>) => onCheckedChange(e.target.checked)}
                />
                <span className="select-none text-[15px] text-[var(--sf-ink)]">{options.checkboxLabel}</span>
              </label>
            )}
            <div className="mt-6 flex flex-wrap items-center justify-end gap-x-6 gap-y-2">
              {isAlert && options.secondaryText && (
                <button
                  type="button"
                  onClick={onSecondary}
                  className="inline-flex min-h-11 items-center text-base font-medium text-[var(--sf-ink)] underline decoration-1 underline-offset-[5px] [text-decoration-color:color-mix(in_srgb,currentColor_32%,transparent)] hover:[text-decoration-color:currentColor]"
                >
                  {options.secondaryText}
                </button>
              )}
              {!isAlert && (
                <button
                  type="button"
                  data-autofocus
                  onClick={onCancel}
                  className="inline-flex min-h-11 items-center text-base font-medium text-[var(--sf-ink)] underline decoration-1 underline-offset-[5px] [text-decoration-color:color-mix(in_srgb,currentColor_32%,transparent)] hover:[text-decoration-color:currentColor]"
                >
                  {options.cancelText || 'Отмена'}
                </button>
              )}
              <button
                type="button"
                data-autofocus={isAlert ? true : undefined}
                onClick={onConfirm}
                className="inline-flex min-h-11 items-center justify-center rounded-full bg-[var(--sf-accent)] px-6 text-base font-semibold text-white transition-colors hover:bg-[var(--sf-accent-hover)]"
              >
                {options.confirmText || 'ОК'}
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
