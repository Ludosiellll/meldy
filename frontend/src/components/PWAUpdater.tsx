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
        // Проверяем обновления каждые 15 секунд (специально для презентации)
        setInterval(() => {
          r.update();
        }, 15000);
      }
    },
  });

  useEffect(() => {
    if (needRefresh) {
      toast(
        (t) => (
          <div className="flex flex-col gap-2">
            <span className="font-bold text-slate-900 dark:text-white">Доступна новая версия!</span>
            <span className="text-sm text-slate-500 dark:text-slate-400">Нажмите кнопку ниже, чтобы применить изменения немедленно.</span>
            <button 
              onClick={() => {
                updateServiceWorker(true);
                toast.dismiss(t.id);
              }}
              className="mt-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg font-bold w-full transition"
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
