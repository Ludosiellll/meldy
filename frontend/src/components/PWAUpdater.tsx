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
          <div className="flex flex-col gap-2">
            <span className="font-semibold text-slate-900 dark:text-white">Доступно обновление</span>
            <span className="text-sm text-slate-500 dark:text-slate-400">Обновите страницу, чтобы получить последнюю версию.</span>
            <button 
              onClick={() => {
                updateServiceWorker(true);
                toast.dismiss(t.id);
              }}
              className="mt-2 px-4 py-2 bg-cyan-400 hover:bg-cyan-300 text-slate-950 rounded-lg font-semibold w-full transition-colors"
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
