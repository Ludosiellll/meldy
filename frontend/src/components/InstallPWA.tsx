import { useState, useEffect } from 'react';
import { Download } from 'lucide-react';
import toast from 'react-hot-toast';

export default function InstallPWA() {
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null);
  const [isIOS, setIsIOS] = useState(false);
  const [isStandalone, setIsStandalone] = useState(false);

  useEffect(() => {
    // Check if already installed
    if (window.matchMedia('(display-mode: standalone)').matches || (window.navigator as any).standalone) {
      setIsStandalone(true);
      return;
    }

    // Detect iOS Safari
    const ua = window.navigator.userAgent;
    const webkit = !!ua.match(/WebKit/i);
    const isIOSDetect = !!ua.match(/iPad/i) || !!ua.match(/iPhone/i);
    const isSafari = isIOSDetect && webkit && !ua.match(/CriOS/i);
    setIsIOS(isSafari);

    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault();
      setDeferredPrompt(e);
    });
  }, []);

  const handleInstallClick = async () => {
    if (deferredPrompt) {
      deferredPrompt.prompt();
      const { outcome } = await deferredPrompt.userChoice;
      if (outcome === 'accepted') {
        setDeferredPrompt(null);
      }
    } else if (isIOS) {
      toast('Чтобы установить: нажмите иконку "Поделиться" внизу экрана (квадрат со стрелочкой) и выберите "На экран Домой"', {
        icon: '📱',
        duration: 8000,
      });
    } else {
      toast('Приложение уже установлено или ваш браузер не поддерживает авто-установку.');
    }
  };

  // Не показываем кнопку если уже установлено или если нет prompt и не iOS
  if (isStandalone || (!deferredPrompt && !isIOS)) return null;

  return (
    <button
      onClick={handleInstallClick}
      className="fixed bottom-6 right-6 z-50 flex items-center gap-2 px-5 py-3 bg-indigo-600 hover:bg-indigo-700 text-white rounded-full shadow-[0_8px_30px_rgb(0,0,0,0.12)] font-bold transition-transform hover:scale-105 active:scale-95"
    >
      <Download className="w-5 h-5" />
      <span className="hidden sm:inline">Установить Приложение</span>
      <span className="sm:hidden">Установить</span>
    </button>
  );
}
