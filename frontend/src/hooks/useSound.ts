import { useCallback, useRef } from 'react';

export const useSound = () => {
  const audioCtxRef = useRef<AudioContext | null>(null);

  const initAudio = () => {
    if (!audioCtxRef.current) {
      audioCtxRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
    }
    if (audioCtxRef.current.state === 'suspended') {
      audioCtxRef.current.resume();
    }
  };

  const playTone = useCallback((freq: number, type: OscillatorType, duration: number, vol = 0.1) => {
    try {
      initAudio();
      const ctx = audioCtxRef.current!;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = type;
      osc.frequency.setValueAtTime(freq, ctx.currentTime);

      gain.gain.setValueAtTime(vol, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start();
      osc.stop(ctx.currentTime + duration);
    } catch (e) {
      console.error('Audio play error:', e);
    }
  }, []);

  // 1. Звук получения XP (короткий приятный дзинь)
  const playXpSound = useCallback(() => {
    playTone(880, 'sine', 0.3, 0.1); // A5
    setTimeout(() => playTone(1108.73, 'sine', 0.5, 0.1), 100); // C#6
  }, [playTone]);

  // 2. Звук переворота карточки (свуш / глухой стук)
  const playFlipSound = useCallback(() => {
    playTone(150, 'triangle', 0.1, 0.05);
  }, [playTone]);

  // 3. Звук успеха (например, успешное прохождение)
  const playSuccessSound = useCallback(() => {
    playTone(523.25, 'sine', 0.2, 0.1); // C5
    setTimeout(() => playTone(659.25, 'sine', 0.2, 0.1), 150); // E5
    setTimeout(() => playTone(783.99, 'sine', 0.4, 0.1), 300); // G5
    setTimeout(() => playTone(1046.50, 'sine', 0.6, 0.1), 450); // C6
  }, [playTone]);

  // 4. Звук ошибки
  const playErrorSound = useCallback(() => {
    playTone(300, 'sawtooth', 0.2, 0.05);
    setTimeout(() => playTone(250, 'sawtooth', 0.3, 0.05), 100);
  }, [playTone]);

  // 5. Легкий клик
  const playClickSound = useCallback(() => {
    playTone(1000, 'sine', 0.05, 0.02);
  }, [playTone]);

  return {
    playXpSound,
    playFlipSound,
    playSuccessSound,
    playErrorSound,
    playClickSound,
  };
};
