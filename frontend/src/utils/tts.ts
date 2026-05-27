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

// ── Браузерное character-index отслеживание для надёжной паузы ─────────────────

let currentParaText = '';
let currentParaOffset = 0;
let currentParaLastCharIndex = 0;
let currentRole: VoiceRole = 'female';
let currentOnEnd: (() => void) | undefined = undefined;
let currentOnError: ((e: any) => void) | undefined = undefined;
let isBrowserSpeaking = false;
let isBrowserPaused = false;

export const pauseBrowserTTS = () => {
  if (!window.speechSynthesis) return;
  isBrowserPaused = true;
  window.speechSynthesis.cancel();
  currentParaOffset += currentParaLastCharIndex;
  currentParaLastCharIndex = 0;
};

export const resumeBrowserTTS = () => {
  if (!window.speechSynthesis || !isBrowserSpeaking) return;
  isBrowserPaused = false;
  speakBrowserCurrentSegment();
};

export const stopBrowserTTS = () => {
  if (!window.speechSynthesis) return;
  isBrowserSpeaking = false;
  isBrowserPaused = false;
  currentParaText = '';
  currentParaOffset = 0;
  currentParaLastCharIndex = 0;
  window.speechSynthesis.cancel();
};

export const pauseTTS = () => {
  if (currentAudio && !currentAudio.paused) {
    currentAudio.pause();
  } else {
    pauseBrowserTTS();
  }
};

export const resumeTTS = () => {
  if (currentAudio && currentAudio.paused) {
    currentAudio.play().catch(console.error);
  } else {
    resumeBrowserTTS();
  }
};

export const stopTTS = () => {
  if (currentAudio) {
    currentAudio.pause();
    currentAudio.currentTime = 0;
    currentAudio = null;
  }
  stopBrowserTTS();
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

const speakBrowserCurrentSegment = async () => {
  if (!window.speechSynthesis) return;

  window.speechSynthesis.cancel();

  // Slicing to resume exactly from the last spoken word index
  const remainingText = currentParaText.slice(currentParaOffset + currentParaLastCharIndex);

  if (remainingText.trim() === '') {
    isBrowserSpeaking = false;
    if (currentOnEnd) currentOnEnd();
    return;
  }

  const voices = await ensureVoicesLoaded();
  const ruVoices = voices.filter(v => v.lang.startsWith('ru'));
  const naturalVoices = ruVoices.filter(v =>
    v.name.toLowerCase().includes('natural') ||
    v.name.toLowerCase().includes('google') ||
    v.name.toLowerCase().includes('siri')
  );
  const pool = naturalVoices.length > 0 ? naturalVoices : ruVoices;

  const utterance = new SpeechSynthesisUtterance(remainingText);
  utterance.lang = 'ru-RU';

  if (currentRole === 'professor') {
    const voice = pool.find(v => v.name.toLowerCase().includes('male') || v.name.toLowerCase().includes('dmitry'));
    if (voice) utterance.voice = voice;
    utterance.pitch = 0.85;
    utterance.rate = 1.15; // Increased Dmitry speed (0.95 -> 1.15)
  } else if (currentRole === 'male') {
    const voice = pool.find(v => v.name.toLowerCase().includes('male') || v.name.toLowerCase().includes('pavel'));
    if (voice) utterance.voice = voice;
    utterance.pitch = 0.95;
    utterance.rate = 1.20; // Increased Pavel speed (1.0 -> 1.20)
  } else {
    const voice = pool.find(v => v.name.toLowerCase().includes('female') || v.name.toLowerCase().includes('milena') || v.name.toLowerCase().includes('svetlana'));
    if (voice) utterance.voice = voice;
    utterance.pitch = 1.15;
    utterance.rate = 1.25; // Increased Svetlana speed (1.05 -> 1.25)
  }

  utterance.onboundary = (e) => {
    if (e.name === 'word') {
      currentParaLastCharIndex = e.charIndex;
    }
  };

  utterance.onend = () => {
    if (!isBrowserPaused) {
      isBrowserSpeaking = false;
      if (currentOnEnd) currentOnEnd();
    }
  };

  utterance.onerror = (e) => {
    if (e.error === 'interrupted') {
      // OS or browser interrupted/paused speech (e.g. screen lock, tab background, focus loss)
      currentParaOffset += currentParaLastCharIndex;
      currentParaLastCharIndex = 0;
      isBrowserPaused = true;
      return;
    }
    console.error('Browser TTS error:', e);
    isBrowserSpeaking = false;
    if (currentOnError) currentOnError(e);
  };

  window.speechSynthesis.speak(utterance);
};

const playBrowserTTS = async (
  text: string,
  role: VoiceRole,
  onEnd?: () => void,
  onError?: (e: any) => void
) => {
  // Check if we are resuming the exact same message that was paused or interrupted
  if (isBrowserSpeaking && isBrowserPaused && currentParaText === text) {
    isBrowserPaused = false;
    await speakBrowserCurrentSegment();
    return;
  }

  currentParaText = text;
  currentParaOffset = 0;
  currentParaLastCharIndex = 0;
  currentRole = role;
  currentOnEnd = onEnd;
  currentOnError = onError;
  isBrowserSpeaking = true;
  isBrowserPaused = false;

  await speakBrowserCurrentSegment();
};
