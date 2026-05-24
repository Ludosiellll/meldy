import { useEffect } from 'react';
import confetti from 'canvas-confetti';

interface Props {
  trigger: boolean;
  type?: 'quest' | 'exam5' | 'achievement' | 'level';
}

export default function ConfettiCelebration({ trigger, type = 'quest' }: Props) {
  useEffect(() => {
    if (!trigger) return;

    const defaults = { startVelocity: 30, spread: 360, ticks: 60, zIndex: 9999 };

    if (type === 'level') {
      // Мощный залп для повышения уровня
      const duration = 3000;
      const end = Date.now() + duration;
      const frame = () => {
        confetti({ ...defaults, particleCount: 7, origin: { x: Math.random(), y: Math.random() * 0.6 } });
        if (Date.now() < end) requestAnimationFrame(frame);
      };
      frame();
    } else if (type === 'exam5') {
      // Двойной залп по бокам для пятёрки
      confetti({ particleCount: 100, angle: 60, spread: 55, origin: { x: 0 }, colors: ['#4f46e5', '#7c3aed', '#06b6d4'] });
      confetti({ particleCount: 100, angle: 120, spread: 55, origin: { x: 1 }, colors: ['#4f46e5', '#7c3aed', '#06b6d4'] });
    } else if (type === 'achievement') {
      confetti({ particleCount: 80, spread: 80, origin: { y: 0.6 }, colors: ['#f59e0b', '#fbbf24', '#fcd34d'] });
    } else {
      // Обычный квест — лёгкий
      confetti({ particleCount: 60, spread: 70, origin: { y: 0.6 }, colors: ['#4f46e5', '#10b981', '#f59e0b'] });
    }
  }, [trigger, type]);

  return null;
}
