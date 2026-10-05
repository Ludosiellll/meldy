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

  // 1. Звук переворота карточки (Современный UI Pop)
  const playFlipSound = useCallback(() => {
    try {
      initAudio();
      const ctx = audioCtxRef.current!;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      
      osc.type = 'sine';
      osc.frequency.setValueAtTime(600, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(200, ctx.currentTime + 0.1); // Быстрый спад частоты (Pop)
      
      gain.gain.setValueAtTime(0.2, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.1);
      
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.1);
    } catch (e) {}
  }, []);

  // 2. Звук успеха (Радостный перелив)
  const playSuccessSound = useCallback(() => {
    try {
      initAudio();
      const ctx = audioCtxRef.current!;
      const now = ctx.currentTime;
      
      const playChime = (freq: number, time: number) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'triangle';
        osc.frequency.value = freq;
        gain.gain.setValueAtTime(0.1, time);
        gain.gain.exponentialRampToValueAtTime(0.001, time + 0.4);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(time);
        osc.stop(time + 0.4);
      };

      playChime(440, now);        // A4
      playChime(554.37, now + 0.1); // C#5
      playChime(659.25, now + 0.2); // E5
      playChime(880, now + 0.35);   // A5
    } catch (e) {}
  }, []);

  // 3. Звук ошибки (Мягкий глухой стук, не раздражающий)
  const playErrorSound = useCallback(() => {
    try {
      initAudio();
      const ctx = audioCtxRef.current!;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      
      osc.type = 'sine';
      osc.frequency.setValueAtTime(200, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(50, ctx.currentTime + 0.15);
      
      gain.gain.setValueAtTime(0.2, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.15);
      
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.15);
    } catch (e) {}
  }, []);

  return {
    playFlipSound,
    playSuccessSound,
    playErrorSound,
  };
};
