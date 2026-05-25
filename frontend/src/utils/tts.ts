export type VoiceRole = 'professor' | 'male' | 'female';

let currentUtterance: SpeechSynthesisUtterance | null = null;

export const ensureVoicesLoaded = (): Promise<SpeechSynthesisVoice[]> => {
  return new Promise((resolve) => {
    let voices = window.speechSynthesis.getVoices();
    if (voices.length > 0) {
      resolve(voices);
      return;
    }
    
    // Некоторые браузеры загружают голоса асинхронно
    const voicesChanged = () => {
      window.speechSynthesis.removeEventListener('voiceschanged', voicesChanged);
      resolve(window.speechSynthesis.getVoices());
    };
    window.speechSynthesis.addEventListener('voiceschanged', voicesChanged);
  });
};

const getBestVoice = (voices: SpeechSynthesisVoice[], role: VoiceRole): SpeechSynthesisVoice | null => {
  const ruVoices = voices.filter(v => v.lang.startsWith('ru'));
  
  if (ruVoices.length === 0) return null;

  // Ищем премиум-голоса (Natural в Edge/Windows, Siri в macOS, Google в Chrome)
  const naturalVoices = ruVoices.filter(v => 
    v.name.toLowerCase().includes('natural') || 
    v.name.toLowerCase().includes('google') || 
    v.name.toLowerCase().includes('siri')
  );

  const targetVoices = naturalVoices.length > 0 ? naturalVoices : ruVoices;

  if (role === 'professor' || role === 'male') {
    const maleVoice = targetVoices.find(v => 
      v.name.toLowerCase().includes('male') || 
      v.name.toLowerCase().includes('dmitry') || 
      v.name.toLowerCase().includes('pavel')
    );
    return maleVoice || targetVoices[0];
  } else {
    const femaleVoice = targetVoices.find(v => 
      v.name.toLowerCase().includes('female') || 
      v.name.toLowerCase().includes('milena') || 
      v.name.toLowerCase().includes('katya') ||
      v.name.toLowerCase().includes('svetlana')
    );
    return femaleVoice || targetVoices[0];
  }
};

export const playTTS = async (
  text: string, 
  role: VoiceRole, 
  onEnd?: () => void, 
  onError?: (e: any) => void
) => {
  if (!window.speechSynthesis) {
    if (onError) onError(new Error("speechSynthesis is not supported"));
    return;
  }

  // Останавливаем предыдущую озвучку
  stopTTS();

  const voices = await ensureVoicesLoaded();
  const voice = getBestVoice(voices, role);

  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = 'ru-RU';
  if (voice) utterance.voice = voice;

  if (role === 'professor') {
    utterance.pitch = 0.85; // Низкий, солидный
    utterance.rate = 0.95;  // Чуть медленнее, вдумчивый
  } else if (role === 'male') {
    utterance.pitch = 0.95; 
    utterance.rate = 1.0;
  } else if (role === 'female') {
    utterance.pitch = 1.15; // Более звонкий
    utterance.rate = 1.05;  // Бодрый темп
  }

  if (onEnd) utterance.onend = onEnd;
  utterance.onerror = (e) => {
    console.error('Speech synthesis error:', e);
    if (onError) onError(e);
  };

  currentUtterance = utterance;
  window.speechSynthesis.speak(utterance);
};

export const pauseTTS = () => {
  if (window.speechSynthesis) window.speechSynthesis.pause();
};

export const resumeTTS = () => {
  if (window.speechSynthesis) window.speechSynthesis.resume();
};

export const stopTTS = () => {
  if (window.speechSynthesis) {
    window.speechSynthesis.cancel();
  }
  currentUtterance = null;
};
