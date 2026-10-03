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

  it('keeps ten clips and revokes evicted audio but never the one that is playing', async () => {
    const tts = await loadTts();
    expect(tts.PREFETCH_LIMIT).toBe(10);
    await tts.playTTS('Первая', 'female');
    for (let i = 2; i <= 12; i += 1) {
      await tts.prefetchTTS(`Реплика ${i}`, 'female');
    }
    const revoked = (URL.revokeObjectURL as ReturnType<typeof vi.fn>).mock.calls.map(call => call[0]);
    expect(revoked).not.toContain('blob:audio-1');
    expect(revoked).toEqual(['blob:audio-2', 'blob:audio-3']);
    expect(await tts.isTTSReady('Реплика 2', 'female')).toBe(false);
    expect(await tts.isTTSReady('Реплика 12', 'female')).toBe(true);
  });

  it('gives a line whose prefetch failed one more server try when it plays, then remembers the failure', async () => {
    fetchMock.mockImplementation(async () => ({ ok: false, status: 502, blob: async () => new Blob() }));
    const tts = await loadTts();
    expect(await tts.prefetchTTS('Строка', 'female')).toBeNull();

    await tts.playTTS('Строка', 'female');
    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const synth = window.speechSynthesis as unknown as ReturnType<typeof makeSynth>;
    expect(synth.speak).toHaveBeenCalledTimes(1);

    // Сыграть не удалось и самой реплике: до «Повторить» сервер за ней не ходим.
    await tts.prefetchTTS('Строка', 'female');
    await tts.playTTS('Строка', 'female');
    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(2);

    tts.forgetTTSFailures();
    await tts.prefetchTTS('Строка', 'female');
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('does not pin a line to the browser voice after one busy answer from the server', async () => {
    let busy = true;
    fetchMock.mockImplementation(async () => {
      if (busy) {
        busy = false;
        return { ok: false, status: 429, headers: new Headers(), blob: async () => new Blob() };
      }
      return { ok: true, status: 200, blob: async () => new Blob(['mp3']) };
    });
    const tts = await loadTts();
    expect(await tts.prefetchTTS('Вторая реплика.', 'female')).toBeNull();

    const onStart = vi.fn();
    await tts.playTTS('Вторая реплика.', 'female', undefined, undefined, onStart);
    const synth = window.speechSynthesis as unknown as ReturnType<typeof makeSynth>;
    expect(synth.speak).not.toHaveBeenCalled();
    expect(FakeAudio.instances).toHaveLength(1);
    FakeAudio.instances[0].emit('playing');
    expect(onStart).toHaveBeenCalledTimes(1);
  });

  it('forgets temporary failures after a minute and never retries a permanent one', async () => {
    vi.useFakeTimers();
    const status: Record<string, number> = { 'Длинная': 413, 'Занята': 502 };
    fetchMock.mockImplementation(async (_url: string, init: RequestInit) => {
      const { text } = JSON.parse(String(init.body));
      const code = status[text];
      return code ? { ok: false, status: code, headers: new Headers(), blob: async () => new Blob() } : { ok: true, status: 200, blob: async () => new Blob(['mp3']) };
    });
    const tts = await loadTts();
    await tts.prefetchTTS('Длинная', 'male');
    await tts.prefetchTTS('Занята', 'male');
    expect(fetchMock).toHaveBeenCalledTimes(2);

    await tts.prefetchTTS('Занята', 'male');
    await tts.prefetchTTS('Длинная', 'male');
    expect(fetchMock).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(61_000);
    delete status['Занята'];
    expect(await tts.prefetchTTS('Занята', 'male')).toMatch(/^blob:/);
    expect(await tts.prefetchTTS('Длинная', 'male')).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('lets the browser voice speak for half a minute when the server fails twice in a row', async () => {
    vi.useFakeTimers();
    let down = true;
    fetchMock.mockImplementation(async () =>
      down ? { ok: false, status: 502, headers: new Headers(), blob: async () => new Blob() } : { ok: true, status: 200, blob: async () => new Blob(['mp3']) },
    );
    const tts = await loadTts();
    await tts.prefetchTTS('Первая', 'male');
    await tts.prefetchTTS('Вторая', 'male');
    expect(await tts.prefetchTTS('Третья', 'male')).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(2);

    down = false;
    await vi.advanceTimersByTimeAsync(31_000);
    expect(await tts.prefetchTTS('Третья', 'male')).toMatch(/^blob:/);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('does not time out while a line is paused before its sound started', async () => {
    vi.useFakeTimers();
    const tts = await loadTts();
    await tts.prefetchTTS('Следующая реплика', 'female');
    const onError = vi.fn();
    const onStart = vi.fn();
    await tts.playTTS('Следующая реплика', 'female', undefined, onError, onStart);
    const audio = FakeAudio.instances[0];
    expect(tts.isTTSSounding()).toBe(true);

    tts.pauseTTS();
    await vi.advanceTimersByTimeAsync(20_000);
    expect(onError).not.toHaveBeenCalled();

    tts.resumeTTS();
    expect(audio.paused).toBe(false);
    audio.emit('playing');
    expect(onStart).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(20_000);
    expect(onError).not.toHaveBeenCalled();
  });

  it('waits for the sound again after resuming a line that never started', async () => {
    vi.useFakeTimers();
    const tts = await loadTts();
    const onError = vi.fn();
    await tts.playTTS('Тишина', 'female', undefined, onError);
    tts.pauseTTS();
    await vi.advanceTimersByTimeAsync(10_000);
    tts.resumeTTS();
    await vi.advanceTimersByTimeAsync(7_900);
    expect(onError).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(200);
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0][0].reason).toBe('timeout');
  });

  it('does not time out while browser speech is paused before it started', async () => {
    vi.useFakeTimers();
    fetchMock.mockImplementation(async () => ({ ok: false, status: 502, headers: new Headers(), blob: async () => new Blob() }));
    const tts = await loadTts();
    const onError = vi.fn();
    await tts.playTTS('Браузерный голос', 'male', undefined, onError, vi.fn());
    await vi.advanceTimersByTimeAsync(0);
    const synth = window.speechSynthesis as unknown as ReturnType<typeof makeSynth>;
    expect(synth.speak).toHaveBeenCalledTimes(1);
    tts.pauseTTS();
    await vi.advanceTimersByTimeAsync(9_000);
    expect(onError).not.toHaveBeenCalled();
  });

  it('ends a line through onEnd when it fails and the caller has no onError', async () => {
    vi.useFakeTimers();
    fetchMock.mockImplementation(() => new Promise(() => undefined));
    const tts = await loadTts();
    const onEnd = vi.fn();
    void tts.playTTS('Вопрос экзамена', 'professor', onEnd);
    await vi.advanceTimersByTimeAsync(8_100);
    expect(onEnd).toHaveBeenCalledTimes(1);
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

  describe('persisted examiner lines (Cache API meldy-tts-v1)', () => {
    /** A Cache API stand-in that survives vi.resetModules(): the store lives in the test. */
    class FakeResponse {
      constructor(private readonly body: Blob) {}
      async blob() {
        return this.body;
      }
    }
    let stored: Map<string, FakeResponse>;
    let openCache: ReturnType<typeof vi.fn>;

    beforeEach(() => {
      stored = new Map();
      const cache = {
        match: vi.fn(async (url: string) => stored.get(String(url))),
        put: vi.fn(async (url: string, response: FakeResponse) => {
          stored.set(String(url), response);
        }),
      };
      openCache = vi.fn(async () => cache);
      vi.stubGlobal('caches', { open: openCache });
      vi.stubGlobal('Response', FakeResponse);
    });

    const spoken = () => fetchMock.mock.calls.map(call => JSON.parse(String((call[1] as RequestInit).body)).text);

    it('stores a persisted clip under /__tts/<role>/<sha256> and finds it after a module reset', async () => {
      let tts = await loadTts();
      expect(await tts.isTTSReady('Так…', 'professor')).toBe(false);
      await tts.prefetchTTS('Так…', 'professor', { persist: true });
      expect(openCache).toHaveBeenCalledWith('meldy-tts-v1');
      const [key] = Array.from(stored.keys());
      expect(key).toMatch(/^\/__tts\/professor\/[0-9a-f]{64}$/);

      tts = await loadTts();
      expect(await tts.isTTSReady('Так…', 'professor')).toBe(true);
      await tts.playTTS('Так…', 'professor');
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(FakeAudio.instances).toHaveLength(1);
    });

    it('runs persisted prefetches one at a time in call order and skips ready clips', async () => {
      const release: Array<() => void> = [];
      fetchMock.mockImplementation(
        () =>
          new Promise(resolve => {
            release.push(() => resolve({ ok: true, status: 200, blob: async () => new Blob(['mp3']) }));
          }),
      );
      let tts = await loadTts();
      // «Хорошо, по существу всё» is ready from an earlier visit.
      const ready = tts.prefetchTTS('Хорошо, по существу всё', 'professor', { persist: true });
      await vi.waitFor(() => expect(release).toHaveLength(1));
      release.shift()?.();
      await ready;
      fetchMock.mockClear();

      tts = await loadTts();
      const lines = ['Так…', 'А что будет, если?', 'Почему так?', 'Хорошо, по существу всё', 'Не расслышал ответ'];
      const all = Promise.all(lines.map(line => tts.prefetchTTS(line, 'professor', { persist: true })));
      for (let served = 0; served < 4; served += 1) {
        await vi.waitFor(() => expect(release).toHaveLength(1));
        expect(fetchMock).toHaveBeenCalledTimes(served + 1);
        release.shift()?.();
      }
      await all;
      expect(spoken()).toEqual(['Так…', 'А что будет, если?', 'Почему так?', 'Не расслышал ответ']);
    });

    it('plays a persisted clip without the network even after the memory cache dropped it', async () => {
      const tts = await loadTts();
      await tts.prefetchTTS('А что будет, если?', 'professor', { persist: true });
      for (let i = 0; i < 12; i += 1) await tts.prefetchTTS(`Другая ${i}`, 'male');
      const calls = fetchMock.mock.calls.length;
      expect(await tts.isTTSReady('А что будет, если?', 'professor')).toBe(true);
      await tts.playTTS('А что будет, если?', 'professor');
      expect(fetchMock).toHaveBeenCalledTimes(calls);
      expect(FakeAudio.instances).toHaveLength(1);
    });

    it('keeps persisted clips in memory when the Cache API is unavailable', async () => {
      vi.stubGlobal('caches', undefined);
      const tts = await loadTts();
      await tts.prefetchTTS('Так…', 'professor', { persist: true });
      for (let i = 0; i < 12; i += 1) await tts.prefetchTTS(`Другая ${i}`, 'male');
      const calls = fetchMock.mock.calls.length;
      expect(await tts.isTTSReady('Так…', 'professor')).toBe(true);
      await tts.playTTS('Так…', 'professor');
      expect(fetchMock).toHaveBeenCalledTimes(calls);
    });

    it('does not persist a clip the server could not voice', async () => {
      fetchMock.mockImplementation(async () => ({ ok: false, status: 502, headers: new Headers(), blob: async () => new Blob() }));
      const tts = await loadTts();
      expect(await tts.prefetchTTS('Так…', 'professor', { persist: true })).toBeNull();
      expect(stored.size).toBe(0);
      expect(await tts.isTTSReady('Так…', 'professor')).toBe(false);
    });
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
