import { useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import toast from 'react-hot-toast';
import { X } from 'lucide-react';
import { createAppUpdate, hasTypedText, holdsUpdate, type AppUpdate } from '../lib/appUpdate';
import { registerSW } from '../lib/pwaRegister';

/** One offer at a time: react-hot-toast updates the toast with this id instead of adding another. */
export const UPDATE_TOAST_ID = 'meldy-update';

/**
 * A new release, offered calmly: «Есть новая версия Meldy · Обновить» in the corner, and the page moves
 * to the new release by itself only when nobody is looking (lib/appUpdate.ts says when). On a screen
 * where work may be in progress (holdsUpdate: the draw, the answer, the talk, the analysis, the exam
 * editor) there is neither the offer nor a reload. «Закрыть» puts the offer away for this page; the
 * update still comes unnoticed. Rendered once at the top of App.tsx, inside the router.
 */
export default function PWAUpdater() {
  const { pathname } = useLocation();
  const path = useRef(pathname);
  path.current = pathname;
  const update = useRef<AppUpdate | null>(null);
  const [offered, setOffered] = useState(false);
  const [putAway, setPutAway] = useState(false);

  useEffect(() => {
    if (!('serviceWorker' in navigator)) return undefined;
    const current = createAppUpdate({
      container: navigator.serviceWorker,
      // A file of this page's release: the worker knows whether it precaches it.
      pageFile: import.meta.url,
      pathname: () => path.current,
      hidden: () => document.visibilityState === 'hidden',
      typedText: () => hasTypedText(document),
      online: () => navigator.onLine !== false,
      now: () => Date.now(),
      reload: () => window.location.reload(),
      offer: setOffered,
    });
    update.current = current;
    registerSW({
      immediate: true,
      onRegisteredSW(_url, registration) {
        if (registration) current.attach(registration);
      },
      // The plugin would reload the page as soon as a new worker takes it over; lib/appUpdate.ts decides when instead.
      onNeedReload() {},
    });
    const onVisibility = () => current.visibilityChanged();
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      current.dispose();
      update.current = null;
      toast.dismiss(UPDATE_TOAST_ID);
    };
  }, []);

  const shown = offered && !putAway && !holdsUpdate(pathname);
  useEffect(() => {
    if (!shown) {
      toast.dismiss(UPDATE_TOAST_ID);
      return;
    }
    toast(
      () => (
        <UpdateOffer
          onUpdate={() => {
            toast.dismiss(UPDATE_TOAST_ID);
            update.current?.reloadNow();
          }}
          onClose={() => setPutAway(true)}
        />
      ),
      // On phones and tablets the offer rises above the tab bar and a page's bottom action (layout.css,
      // exams.css: up to about 80 px), so neither is covered while it waits.
      { id: UPDATE_TOAST_ID, duration: Infinity, position: 'bottom-right', className: 'max-lg:mb-[calc(84px+env(safe-area-inset-bottom))]' },
    );
  }, [shown]);

  return null;
}

function UpdateOffer({ onUpdate, onClose }: { onUpdate: () => void; onClose: () => void }) {
  return (
    <div className="flex items-start gap-2">
      {/* One row on phones and tablets, where it shares the bottom with the tab bar. */}
      <div className="flex flex-col gap-1.5 max-lg:flex-row max-lg:items-center max-lg:gap-4">
        <span className="font-medium text-[var(--sf-ink)]">Есть новая версия Meldy</span>
        <button
          type="button"
          onClick={onUpdate}
          className="mt-2 inline-flex h-11 w-full items-center justify-center rounded-full bg-[var(--sf-accent)] px-5 font-medium text-white transition-colors hover:bg-[var(--sf-accent-hover)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--sf-accent)] max-lg:mt-0 max-lg:w-auto max-lg:shrink-0"
        >
          Обновить
        </button>
      </div>
      <button
        type="button"
        onClick={onClose}
        aria-label="Закрыть"
        className="-mr-2 -mt-1.5 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[var(--sf-muted)] transition-colors hover:text-[var(--sf-ink)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--sf-accent)] max-lg:mt-1"
      >
        <X aria-hidden="true" size={18} />
      </button>
    </div>
  );
}
