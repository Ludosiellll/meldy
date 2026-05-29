import { useState, useEffect } from 'react';
import toast from 'react-hot-toast';

export function useInstallPWA() {
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null);
  const [isIOS, setIsIOS] = useState(false);
  const [isStandalone, setIsStandalone] = useState(false);
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    if (window.matchMedia('(display-mode: standalone)').matches || (window.navigator as any).standalone) {
      setIsStandalone(true);
      return;
    }

    const ua = window.navigator.userAgent;
    setIsMobile(/Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(ua));

    const webkit = !!ua.match(/WebKit/i);
    const isIOSDetect = !!ua.match(/iPad/i) || !!ua.match(/iPhone/i);
    const isSafari = isIOSDetect && webkit && !ua.match(/CriOS/i);
    setIsIOS(isSafari);

    const handleBeforeInstallPrompt = (e: any) => {
      e.preventDefault();
      setDeferredPrompt(e);
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    return () => window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
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
        id: 'pwa-install-toast-ios',
        icon: '📱',
        duration: 8000,
      });
    } else {
      toast('Чтобы установить: откройте меню браузера (три точки / линии) и найдите пункт «Добавить на главный экран» или «Установить приложение»', {
        id: 'pwa-install-toast',
        icon: '💡',
        duration: 8000,
      });
    }
  };

  return { handleInstallClick, isStandalone, isMobile, showInstall: isMobile && !isStandalone };
}
