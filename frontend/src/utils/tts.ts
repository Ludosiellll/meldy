export type VoiceRole = 'professor' | 'male' | 'female';

let currentAudio: HTMLAudioElement | null = null;

/**
 * Запрашивает озвучку с бэкенда (ElevenLabs) и воспроизводит её.
 * Если ElevenLabs недоступен — автоматически падает на браузерный синтез.
 */
export const playTTS = async (
  text: string,
  role: VoiceRole,
  onEnd?: () => void,
  onError?: (e: any) => void
): Promise<void> => {
  stopTTS();

  try {
    const resp = await fetch('/api/tts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, role }),
    });

    if (!resp.ok) {
      throw new Error(`TTS backend error: ${resp.status}`);
    }

    const blob = await resp.blob();
    const url = URL.createObjectURL(blob);

    const audio = new Audio(url);
    currentAudio = audio;

    audio.onended = () => {
      URL.revokeObjectURL(url);
      currentAudio = null;
      if (onEnd) onEnd();
    };

    audio.onerror = (e) => {
      URL.revokeObjectURL(url);
      currentAudio = null;
      console.error('Audio playback error:', e);
      if (onError) onError(e);
    };

    await audio.play();
  } catch (err) {
    console.warn('ElevenLabs TTS failed, falling back to browser speech synthesis:', err);
    // Fallback — браузерный синтез
    playBrowserTTS(text, role, onEnd, onError);
  }
};

export const pauseTTS = () => {
  if (currentAudio && !currentAudio.paused) {
    currentAudio.pause();
  } else if (window.speechSynthesis) {
    window.speechSynthesis.pause();
  }
};

export const resumeTTS = () => {
  if (currentAudio && currentAudio.paused) {
    currentAudio.play().catch(console.error);
  } else if (window.speechSynthesis) {
    window.speechSynthesis.resume();
  }
};

export const stopTTS = () => {
  if (currentAudio) {
    currentAudio.pause();
    currentAudio.currentTime = 0;
    currentAudio = null;
  }
  if (window.speechSynthesis) {
    window.speechSynthesis.cancel();
  }
};

// ── Браузерный fallback ──────────────────────────────────────────────────────

const ensureVoicesLoaded = (): Promise<SpeechSynthesisVoice[]> =>
  new Promise((resolve) => {
    const voices = window.speechSynthesis?.getVoices() ?? [];
    if (voices.length > 0) return resolve(voices);
    const handler = () => {
      window.speechSynthesis.removeEventListener('voiceschanged', handler);
      resolve(window.speechSynthesis.getVoices());
    };
    window.speechSynthesis?.addEventListener('voiceschanged', handler);
  });

const playBrowserTTS = async (
  text: string,
  role: VoiceRole,
  onEnd?: () => void,
  onError?: (e: any) => void
) => {
  if (!window.speechSynthesis) {
    if (onError) onError(new Error('speechSynthesis not supported'));
    return;
  }

  window.speechSynthesis.cancel();

  const voices = await ensureVoicesLoaded();
  const ruVoices = voices.filter(v => v.lang.startsWith('ru'));
  const naturalVoices = ruVoices.filter(v =>
    v.name.toLowerCase().includes('natural') ||
    v.name.toLowerCase().includes('google') ||
    v.name.toLowerCase().includes('siri')
  );
  const pool = naturalVoices.length > 0 ? naturalVoices : ruVoices;

  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = 'ru-RU';

  if (role === 'professor') {
    const voice = pool.find(v => v.name.toLowerCase().includes('male') || v.name.toLowerCase().includes('dmitry'));
    if (voice) utterance.voice = voice;
    utterance.pitch = 0.85;
    utterance.rate = 0.95;
  } else if (role === 'male') {
    const voice = pool.find(v => v.name.toLowerCase().includes('male') || v.name.toLowerCase().includes('pavel'));
    if (voice) utterance.voice = voice;
    utterance.pitch = 0.95;
    utterance.rate = 1.0;
  } else {
    const voice = pool.find(v => v.name.toLowerCase().includes('female') || v.name.toLowerCase().includes('milena') || v.name.toLowerCase().includes('svetlana'));
    if (voice) utterance.voice = voice;
    utterance.pitch = 1.15;
    utterance.rate = 1.05;
  }

  if (onEnd) utterance.onend = onEnd;
  utterance.onerror = (e) => {
    console.error('Browser TTS error:', e);
    if (onError) onError(e);
  };

  window.speechSynthesis.speak(utterance);
};
