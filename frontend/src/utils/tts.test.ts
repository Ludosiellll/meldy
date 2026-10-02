import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type Listener = () => void;

class FakeAudio {
  static instances: FakeAudio[] = [];
  /** Если true, play() ждёт, пока его не завершат вручную или не прервут pause(). */
  static holdPlay = false;
  src: string;
  paused = true;
  playbackRate = 1;
  currentTime = 0;
  onended: (() => void) | null = null;
  onerror: ((event?: unknown) => void) | null = null;
  private listeners = new Map<string, Listener[]>();
  private pending: { resolve: () => void; reject: (error: unknown) => void } | null = null;

  constructor(src: string) {
    this.src = src;
    FakeAudio.instances.push(this);
  }

  addEventListener(type: string, listener: Listener) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }

  emit(type: string) {
    (this.listeners.get(type) ?? []).forEach(listener => listener());
  }

  play(): Promise<void> {
    this.paused = false;
    if (!FakeAudio.holdPlay) return Promise.resolve();
    return new Promise((resolve, reject) => {
      this.pending = { resolve, reject };
    });
  }

  pause() {
    this.paused = true;
    if (this.pending) {
      const { reject } = this.pending;
      this.pending = null;
      reject(new DOMException('The play() request was interrupted by a call to pause().', 'AbortError'));
    }
  }
}

class FakeUtterance {
  text: string;
  lang = '';
  rate = 1;
  pitch = 1;
  voice: unknown = null;
  onstart: (() => void) | null = null;
  onend: (() => void) | null = null;
  onerror: ((event: { error: string }) => void) | null = null;
  onboundary: ((event: { name: string; charIndex: number }) => void) | null = null;
  constructor(text: string) {
    this.text = text;
  }
}

const ruVoice = { name: 'Google русский', lang: 'ru-RU' };

function makeSynth(voices: unknown[] = [ruVoice]) {
  const spoken: FakeUtterance[] = [];
  return {
    voices,
    spoken,
    getVoices: vi.fn(() => voices),
    speak: vi.fn((utterance: FakeUtterance) => spoken.push(utterance)),
    cancel: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  };
}

let urlCounter = 0;
const flush = () => new Promise(resolve => setTimeout(resolve, 0));

async function loadTts() {
  vi.resetModules();
  return import('./tts');
}

describe('tts', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    FakeAudio.instances = [];
    FakeAudio.holdPlay = false;
    urlCounter = 0;
    fetchMock = vi.fn(async () => ({ ok: true, blob: async () => new Blob(['mp3']) }));
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('Audio', FakeAudio);
    vi.stubGlobal('SpeechSynthesisUtterance', FakeUtterance);
    URL.createObjectURL = vi.fn(() => `blob:audio-${++urlCounter}`);
    URL.revokeObjectURL = vi.fn();
    Object.defineProperty(window, 'speechSynthesis', { value: makeSynth(), configurable: true, writable: true });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    Reflect.deleteProperty(window, 'speechSynthesis');
  });

  it('plays a prefetched line without asking the server again and reports when sound starts', async () => {
    const tts = await loadTts();
    const url = await tts.prefetchTTS('Привет', 'male');
    expect(url).toBe('blob:audio-1');
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const onStart = vi.fn();
    const onEnd = vi.fn();
    await tts.playTTS('Привет', 'male', onEnd, undefined, onStart);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const audio = FakeAudio.instances[0];
    expect(audio.src).toBe('blob:audio-1');
    expect(onStart).not.toHaveBeenCalled();
    audio.emit('playing');
    audio.emit('playing');
    expect(onStart).toHaveBeenCalledTimes(1);
    audio.onended?.();
    expect(onEnd).toHaveBeenCalledTimes(1);
  });

  it('revokes evicted audio but never the one that is playing', async () => {
    const tts = await loadTts();
    await tts.playTTS('Первая', 'female');
    for (const text of ['Вторая', 'Третья', 'Четвёртая', 'Пятая', 'Шестая']) {
      await tts.prefetchTTS(text, 'female');
    }
    const revoked = (URL.revokeObjectURL as ReturnType<typeof vi.fn>).mock.calls.map(call => call[0]);
    expect(revoked).not.toContain('blob:audio-1');
    expect(revoked).toEqual(['blob:audio-2', 'blob:audio-3']);
  });

  it('remembers a failed line and falls back to the browser voice with one server call', async () => {
    fetchMock.mockImplementation(async () => ({ ok: false, status: 502, blob: async () => new Blob() }));
    const tts = await loadTts();
    expect(await tts.prefetchTTS('Строка', 'female')).toBeNull();

    await tts.playTTS('Строка', 'female');
    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const synth = window.speechSynthesis as unknown as ReturnType<typeof makeSynth>;
    expect(synth.speak).toHaveBeenCalledTimes(1);

    tts.forgetTTSFailures();
    await tts.prefetchTTS('Строка', 'female');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('applies the chosen speed to the browser voice', async () => {
    fetchMock.mockImplementation(async () => ({ ok: false, status: 502, blob: async () => new Blob() }));
    const tts = await loadTts();
    tts.setTTSPlaybackRate(1.5);
    await tts.playTTS('Медленно', 'male');
    await flush();
    const synth = window.speechSynthesis as unknown as ReturnType<typeof makeSynth>;
    expect(synth.spoken[0].rate).toBeCloseTo(1.8);
    tts.setTTSPlaybackRate(2);
    await flush();
    // Скорость меняется сразу: фраза продолжается заново, но не быстрее 2×.
    expect(synth.spoken[synth.spoken.length - 1].rate).toBe(2);
  });

  it('does not switch to the browser voice when a loading line is stopped or paused', async () => {
    FakeAudio.holdPlay = true;
    const tts = await loadTts();
    const onError = vi.fn();
    const synth = window.speechSynthesis as unknown as ReturnType<typeof makeSynth>;

    const stopped = tts.playTTS('Остановим', 'male', undefined, onError);
    await flush();
    tts.stopTTS();
    await stopped;
    await flush();

    const paused = tts.playTTS('Пауза', 'male', undefined, onError);
    await flush();
    tts.pauseTTS();
    await paused;
    await flush();

    expect(synth.speak).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('ignores the end of a line that was replaced', async () => {
    fetchMock.mockImplementation(async () => ({ ok: false, status: 502, blob: async () => new Blob() }));
    const tts = await loadTts();
    const synth = window.speechSynthesis as unknown as ReturnType<typeof makeSynth>;
    const firstEnd = vi.fn();
    const secondEnd = vi.fn();
    await tts.playTTS('Первая', 'male', firstEnd);
    await flush();
    const first = synth.spoken[0];
    await tts.playTTS('Вторая', 'female', secondEnd);
    await flush();
    first.onend?.();
    expect(firstEnd).not.toHaveBeenCalled();
    expect(secondEnd).not.toHaveBeenCalled();
    synth.spoken[1].onend?.();
    expect(secondEnd).toHaveBeenCalledTimes(1);
  });

  it('reports missing speech synthesis as unavailable', async () => {
    fetchMock.mockImplementation(async () => ({ ok: false, status: 502, blob: async () => new Blob() }));
    Reflect.deleteProperty(window, 'speechSynthesis');
    const tts = await loadTts();
    const onError = vi.fn();
    await tts.playTTS('Текст', 'female', undefined, onError);
    await flush();
    expect(onError).toHaveBeenCalledTimes(1);
    expect(tts.isTTSUnavailable(onError.mock.calls[0][0])).toBe(true);
    expect(onError.mock.calls[0][0].reason).toBe('no-synthesis');
  });

  it('stops waiting for browser voices after two seconds', async () => {
    vi.useFakeTimers();
    fetchMock.mockImplementation(async () => ({ ok: false, status: 502, blob: async () => new Blob() }));
    Object.defineProperty(window, 'speechSynthesis', { value: makeSynth([]), configurable: true, writable: true });
    const tts = await loadTts();
    const onError = vi.fn();
    await tts.playTTS('Текст', 'female', undefined, onError);
    await vi.advanceTimersByTimeAsync(1900);
    expect(onError).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(200);
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0][0].reason).toBe('no-voices');
  });

  it('gives up when sound does not start in eight seconds', async () => {
    vi.useFakeTimers();
    fetchMock.mockImplementation(() => new Promise(() => undefined));
    const tts = await loadTts();
    const onError = vi.fn();
    void tts.playTTS('Текст', 'female', undefined, onError);
    await vi.advanceTimersByTimeAsync(7900);
    expect(onError).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(200);
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0][0].reason).toBe('timeout');
  });
});
