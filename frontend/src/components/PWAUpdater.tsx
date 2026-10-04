// @ts-ignore
import { useRegisterSW } from 'virtual:pwa-register/react';
import { useEffect } from 'react';
import toast from 'react-hot-toast';

export default function PWAUpdater() {
  const {
    needRefresh: [needRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegistered(r: any) {
      if (r) {
        window.setTimeout(() => {
          r.update();
        }, 60_000);
      }
    },
  });

  useEffect(() => {
    if (needRefresh) {
      toast(
        (t) => (
          <div className="flex flex-col gap-1.5">
            <span className="font-medium text-[var(--sf-ink)]">Доступно обновление</span>
            <span className="text-sm text-[var(--sf-muted)]">Обновите страницу, чтобы получить последнюю версию.</span>
            <button
              onClick={() => {
                updateServiceWorker(true);
                toast.dismiss(t.id);
              }}
              className="mt-2 inline-flex h-11 w-full items-center justify-center rounded-full bg-[var(--sf-accent)] px-5 font-medium text-white transition-colors hover:bg-[var(--sf-accent-hover)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--sf-accent)]"
            >
              Обновить сейчас
            </button>
          </div>
        ),
        { duration: Infinity, position: 'bottom-right' }
      );
    }
  }, [needRefresh, updateServiceWorker]);

  return null;
}
