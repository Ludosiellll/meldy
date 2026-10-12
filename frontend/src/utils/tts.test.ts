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

  describe("a host's line keeps its voice (fallback: 'none')", () => {
    const HOST = { fallback: 'none' } as const;
    const failing = async () => ({ ok: false, status: 502, headers: new Headers(), blob: async () => new Blob() });
    const working = async () => ({ ok: true, status: 200, blob: async () => new Blob(['mp3']) });
    const synth = () => window.speechSynthesis as unknown as ReturnType<typeof makeSynth>;

    it('never switches to the browser voice: three server tries with pauses, then an honest error', async () => {
      vi.useFakeTimers();
      fetchMock.mockImplementation(failing);
      const tts = await loadTts();
      const onEnd = vi.fn();
      const onError = vi.fn();
      const onStart = vi.fn();
      void tts.playTTS('Макс спрашивает', 'male', onEnd, onError, onStart, HOST);
      await vi.advanceTimersByTimeAsync(0);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(999);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(1);
      expect(fetchMock).toHaveBeenCalledTimes(2);
      await vi.advanceTimersByTimeAsync(2999);
      expect(onError).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);
      expect(fetchMock).toHaveBeenCalledTimes(3);
      expect(onError).toHaveBeenCalledTimes(1);
      expect(tts.isTTSUnavailable(onError.mock.calls[0][0])).toBe(true);
      expect(onError.mock.calls[0][0].reason).toBe('server');
      expect(synth().speak).not.toHaveBeenCalled();
      expect(FakeAudio.instances).toHaveLength(0);
      expect(onEnd).not.toHaveBeenCalled();
      expect(onStart).not.toHaveBeenCalled();
      // No late «timeout» on top of the honest error, and no fourth request.
      await vi.advanceTimersByTimeAsync(60_000);
      expect(onError).toHaveBeenCalledTimes(1);
      expect(fetchMock).toHaveBeenCalledTimes(3);
    });

    it('plays the server voice when a retry succeeds', async () => {
      vi.useFakeTimers();
      fetchMock.mockImplementationOnce(failing).mockImplementation(working);
      const tts = await loadTts();
      const onError = vi.fn();
      const onStart = vi.fn();
      void tts.playTTS('Софья отвечает', 'female', undefined, onError, onStart, HOST);
      await vi.advanceTimersByTimeAsync(1000);
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(FakeAudio.instances).toHaveLength(1);
      FakeAudio.instances[0].emit('playing');
      expect(onStart).toHaveBeenCalledTimes(1);
      expect(onError).not.toHaveBeenCalled();
      expect(synth().speak).not.toHaveBeenCalled();
    });

    it('asks the server even while failures of other lines paused it, and retries a line whose prefetch failed', async () => {
      let down = true;
      fetchMock.mockImplementation(() => (down ? failing() : working()));
      const tts = await loadTts();
      await tts.prefetchTTS('Первая', 'male');
      await tts.prefetchTTS('Вторая', 'male');
      // With a browser voice in reserve this line would now be spoken by the browser without asking the server.
      down = false;
      const onStart = vi.fn();
      await tts.playTTS('Вторая', 'male', undefined, vi.fn(), onStart, HOST);
      expect(fetchMock).toHaveBeenCalledTimes(3);
      expect(FakeAudio.instances).toHaveLength(1);
      FakeAudio.instances[0].emit('playing');
      expect(onStart).toHaveBeenCalledTimes(1);
      expect(synth().speak).not.toHaveBeenCalled();
    });

    it('waits for a slow server instead of failing at eight seconds; the eight seconds start once the clip is ready', async () => {
      vi.useFakeTimers();
      fetchMock.mockImplementation(() => new Promise(resolve => setTimeout(() => resolve(working()), 12_000)));
      const tts = await loadTts();
      const onError = vi.fn();
      void tts.playTTS('Длинная реплика', 'female', undefined, onError, vi.fn(), HOST);
      await vi.advanceTimersByTimeAsync(11_000);
      expect(onError).not.toHaveBeenCalled();
      expect(FakeAudio.instances).toHaveLength(0);
      await vi.advanceTimersByTimeAsync(1_000);
      expect(FakeAudio.instances).toHaveLength(1);
      // The clip is here but never starts playing: that is still reported after eight seconds.
      await vi.advanceTimersByTimeAsync(7_900);
      expect(onError).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(200);
      expect(onError).toHaveBeenCalledTimes(1);
      expect(onError.mock.calls[0][0].reason).toBe('timeout');
      expect(synth().speak).not.toHaveBeenCalled();
    });

    it('does not retry a text the server will never voice', async () => {
      vi.useFakeTimers();
      fetchMock.mockImplementation(async () => ({ ok: false, status: 413, headers: new Headers(), blob: async () => new Blob() }));
      const tts = await loadTts();
      const onError = vi.fn();
      void tts.playTTS('Слишком длинно', 'male', undefined, onError, vi.fn(), HOST);
      await vi.advanceTimersByTimeAsync(10_000);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(onError).toHaveBeenCalledTimes(1);
      expect(onError.mock.calls[0][0].reason).toBe('server');
      expect(synth().speak).not.toHaveBeenCalled();
    });

    it('throws away a clip that does not play, so that «Повторить» asks the server again', async () => {
      const tts = await loadTts();
      const onError = vi.fn();
      await tts.playTTS('Битый звук', 'male', undefined, onError, vi.fn(), HOST);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      FakeAudio.instances[0].onerror?.();
      expect(onError).toHaveBeenCalledTimes(1);
      expect(tts.isTTSUnavailable(onError.mock.calls[0][0])).toBe(false);
      expect(synth().speak).not.toHaveBeenCalled();
      expect(await tts.isTTSReady('Битый звук', 'male')).toBe(false);

      tts.forgetTTSFailures();
      await tts.playTTS('Битый звук', 'male', undefined, onError, vi.fn(), HOST);
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(FakeAudio.instances).toHaveLength(2);
    });

    it('treats an empty answer from the server as a failed try', async () => {
      vi.useFakeTimers();
      fetchMock.mockImplementationOnce(async () => ({ ok: true, status: 200, blob: async () => new Blob() })).mockImplementation(working);
      const tts = await loadTts();
      void tts.playTTS('Пустой ответ', 'female', undefined, vi.fn(), vi.fn(), HOST);
      await vi.advanceTimersByTimeAsync(1000);
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(FakeAudio.instances).toHaveLength(1);
    });
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
    let cache: {
      match: ReturnType<typeof vi.fn>;
      put: ReturnType<typeof vi.fn>;
      keys: ReturnType<typeof vi.fn>;
      delete: ReturnType<typeof vi.fn>;
    };

    beforeEach(() => {
      stored = new Map();
      cache = {
        match: vi.fn(async (url: string) => stored.get(String(url))),
        // Like the Cache API: a key written again moves to the end of keys().
        put: vi.fn(async (url: string, response: FakeResponse) => {
          stored.delete(String(url));
          stored.set(String(url), response);
        }),
        keys: vi.fn(async () => Array.from(stored.keys())),
        delete: vi.fn(async (url: string) => stored.delete(String(url))),
      };
      openCache = vi.fn(async () => cache);
      vi.stubGlobal('caches', { open: openCache });
      vi.stubGlobal('Response', FakeResponse);
    });

    const spoken = () => fetchMock.mock.calls.map(call => JSON.parse(String((call[1] as RequestInit).body)).text);
    const HOST = { fallback: 'none', persist: true } as const;

    it("saves a host's line and replays it after a reload without the server", async () => {
      let tts = await loadTts();
      await tts.playTTS('Софья объясняет', 'female', undefined, vi.fn(), vi.fn(), HOST);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      await vi.waitFor(() => expect(stored.size).toBe(1));
      expect(Array.from(stored.keys())[0]).toMatch(/^\/__tts\/female\/[0-9a-f]{64}$/);

      tts = await loadTts();
      expect(await tts.isTTSReady('Софья объясняет', 'female')).toBe(true);
      const onStart = vi.fn();
      await tts.playTTS('Софья объясняет', 'female', undefined, vi.fn(), onStart, HOST);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(FakeAudio.instances).toHaveLength(2);
      FakeAudio.instances[1].emit('playing');
      expect(onStart).toHaveBeenCalledTimes(1);
    });

    it('removes a saved clip that does not play, so the next try asks the server', async () => {
      let tts = await loadTts();
      await tts.prefetchTTS('Макс шутит', 'male', { persist: true });
      expect(stored.size).toBe(1);

      tts = await loadTts();
      const onError = vi.fn();
      await tts.playTTS('Макс шутит', 'male', undefined, onError, vi.fn(), HOST);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      FakeAudio.instances[0].onerror?.();
      expect(onError).toHaveBeenCalledTimes(1);
      await vi.waitFor(() => expect(stored.size).toBe(0));

      await tts.playTTS('Макс шутит', 'male', undefined, onError, vi.fn(), HOST);
      expect(fetchMock).toHaveBeenCalledTimes(2);
      // The fresh clip from the server is saved in place of the broken one.
      await vi.waitFor(() => expect(stored.size).toBe(1));
    });

    it('keeps at most 300 saved clips and drops the oldest first', async () => {
      for (let i = 0; i < 300; i += 1) stored.set(`/__tts/male/old-${i}`, new FakeResponse(new Blob(['mp3'])));
      const tts = await loadTts();
      await tts.prefetchTTS('Свежая реплика', 'female', { persist: true });
      expect(stored.size).toBe(300);
      expect(stored.has('/__tts/male/old-0')).toBe(false);
      expect(stored.has('/__tts/male/old-1')).toBe(true);
      expect(await tts.isTTSReady('Свежая реплика', 'female')).toBe(true);
    });

    it('prefetches lines one request at a time, in order; a new list replaces the rest of the old one', async () => {
      const release: Array<() => void> = [];
      fetchMock.mockImplementation(
        () =>
          new Promise(resolve => {
            release.push(() => resolve({ ok: true, status: 200, blob: async () => new Blob(['mp3']) }));
          }),
      );
      const tts = await loadTts();
      const first = tts.prefetchTTSInOrder(
        [
          { text: 'Реплика 2', role: 'female' },
          { text: 'Реплика 3', role: 'male' },
          { text: 'Реплика 4', role: 'female' },
        ],
        { persist: true },
      );
      await vi.waitFor(() => expect(release).toHaveLength(1));
      expect(spoken()).toEqual(['Реплика 2']);
      release.shift()?.();
      await vi.waitFor(() => expect(release).toHaveLength(1));
      expect(spoken()).toEqual(['Реплика 2', 'Реплика 3']);

      // The player moved on: the new list waits for the request in flight, then replaces the old list.
      const second = tts.prefetchTTSInOrder(
        [
          { text: 'Реплика 4', role: 'female' },
          { text: 'Реплика 5', role: 'male' },
        ],
        { persist: true },
      );
      await flush();
      expect(release).toHaveLength(1);
      release.shift()?.();
      await vi.waitFor(() => expect(release).toHaveLength(1));
      expect(spoken()).toEqual(['Реплика 2', 'Реплика 3', 'Реплика 4']);
      release.shift()?.();
      await vi.waitFor(() => expect(release).toHaveLength(1));
      release.shift()?.();
      await Promise.all([first, second]);
      // Every line asked once, never two at a time, and every clip saved for a replay.
      expect(spoken()).toEqual(['Реплика 2', 'Реплика 3', 'Реплика 4', 'Реплика 5']);
      expect(stored.size).toBe(4);

      // A replay of the same lines needs no server at all.
      await tts.prefetchTTSInOrder([{ text: 'Реплика 3', role: 'male' }], { persist: true });
      await tts.playTTS('Реплика 2', 'female', undefined, vi.fn(), vi.fn(), HOST);
      expect(fetchMock).toHaveBeenCalledTimes(4);
    });

    it('stops prefetching when given an empty list and skips lines whose server just failed', async () => {
      const release: Array<() => void> = [];
      fetchMock.mockImplementation(
        (_url: string, init: RequestInit) =>
          new Promise(resolve => {
            const { text } = JSON.parse(String(init.body));
            if (text === 'Сломанная') {
              resolve({ ok: false, status: 502, headers: new Headers(), blob: async () => new Blob() });
              return;
            }
            release.push(() => resolve({ ok: true, status: 200, blob: async () => new Blob(['mp3']) }));
          }),
      );
      const tts = await loadTts();
      await tts.prefetchTTSInOrder([{ text: 'Сломанная', role: 'male' }]);
      expect(spoken()).toEqual(['Сломанная']);
      // A background prefetch does not hammer a line the server has just failed on.
      const again = tts.prefetchTTSInOrder([
        { text: 'Сломанная', role: 'male' },
        { text: 'Целая', role: 'female' },
        { text: 'Лишняя', role: 'male' },
      ]);
      await vi.waitFor(() => expect(release).toHaveLength(1));
      expect(spoken()).toEqual(['Сломанная', 'Целая']);
      const stop = tts.prefetchTTSInOrder([]);
      release.shift()?.();
      await Promise.all([again, stop]);
      await flush();
      expect(spoken()).toEqual(['Сломанная', 'Целая']);
    });

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

  describe('the line the student waits for goes first (QA 2026-10-11: the first ▶ after an analysis)', () => {
    const HOST = { fallback: 'none' } as const;
    const asked = () => fetchMock.mock.calls.map(call => JSON.parse(String((call[1] as RequestInit).body)).text as string);
    const answer = (status: number, headers: Record<string, string> = {}) =>
      status === 200
        ? { ok: true, status, headers: new Headers(headers), blob: async () => new Blob(['mp3']) }
        : { ok: false, status, headers: new Headers(headers), blob: async () => new Blob() };

    it('starts no read-ahead request while the played line is loading, and goes on once it is in', async () => {
      const release: Array<() => void> = [];
      fetchMock.mockImplementation(
        () =>
          new Promise(resolve => {
            release.push(() => resolve(answer(200)));
          }),
      );
      const tts = await loadTts();
      const onStart = vi.fn();
      void tts.playTTS('Первая реплика', 'male', undefined, vi.fn(), onStart, HOST);
      await vi.waitFor(() => expect(release).toHaveLength(1));
      // The player moved on and plans the next lines while the first is still loading: they wait.
      const ahead = tts.prefetchTTSInOrder([
        { text: 'Вторая реплика', role: 'female' },
        { text: 'Третья реплика', role: 'male' },
      ]);
      await flush();
      await flush();
      expect(asked()).toEqual(['Первая реплика']);

      release.shift()?.();
      await vi.waitFor(() => expect(FakeAudio.instances).toHaveLength(1));
      await vi.waitFor(() => expect(asked()).toEqual(['Первая реплика', 'Вторая реплика']));
      release.shift()?.();
      await vi.waitFor(() => expect(asked()).toEqual(['Первая реплика', 'Вторая реплика', 'Третья реплика']));
      release.shift()?.();
      await ahead;
    });

    it('waits through the played line\'s retries too, then reads ahead', async () => {
      vi.useFakeTimers();
      let calls = 0;
      fetchMock.mockImplementation(async () => {
        calls += 1;
        return calls === 1 ? answer(502) : answer(200);
      });
      const tts = await loadTts();
      void tts.playTTS('Первая реплика', 'male', undefined, vi.fn(), vi.fn(), HOST);
      await vi.advanceTimersByTimeAsync(0);
      void tts.prefetchTTSInOrder([{ text: 'Вторая реплика', role: 'female' }]);
      // The 502, the second try a second later: nothing for the second line in between.
      await vi.advanceTimersByTimeAsync(999);
      expect(asked()).toEqual(['Первая реплика']);
      await vi.advanceTimersByTimeAsync(1);
      await vi.advanceTimersByTimeAsync(0);
      expect(asked()).toEqual(['Первая реплика', 'Первая реплика', 'Вторая реплика']);
    });

    it('ends the read-ahead at a line the server has just failed on; a later plan asks for it again', async () => {
      const status: Record<string, number> = { 'Вторая реплика': 502 };
      fetchMock.mockImplementation(async (_url: string, init: RequestInit) => {
        const { text } = JSON.parse(String(init.body));
        // Retry-After: 1, as /api/tts sends with its 502 (the server has already tried three times).
        return answer(status[text] ?? 200, status[text] ? { 'Retry-After': '1' } : {});
      });
      const tts = await loadTts();
      await tts.prefetchTTSInOrder([
        { text: 'Вторая реплика', role: 'female' },
        { text: 'Третья реплика', role: 'male' },
        { text: 'Четвёртая реплика', role: 'female' },
      ]);
      // The second line failed: the third and the fourth are not asked of a server that is failing right now.
      expect(asked()).toEqual(['Вторая реплика']);

      // A second later (Retry-After) the next plan asks for the failed line again, and goes on when it comes.
      delete status['Вторая реплика'];
      await new Promise(resolve => setTimeout(resolve, 1050));
      await tts.prefetchTTSInOrder([
        { text: 'Вторая реплика', role: 'female' },
        { text: 'Третья реплика', role: 'male' },
      ]);
      expect(asked()).toEqual(['Вторая реплика', 'Вторая реплика', 'Третья реплика']);
    });

    it('tells the player whose failure a retry follows: the server\'s for a 502, nobody\'s answer for a dropped request', async () => {
      vi.useFakeTimers();
      const outcomes: Array<() => Promise<unknown>> = [
        async () => answer(502),
        async () => {
          throw new TypeError('Failed to fetch');
        },
        async () => answer(200),
      ];
      fetchMock.mockImplementation(() => (outcomes.shift() ?? (async () => answer(200)))());
      const tts = await loadTts();
      const onRetry = vi.fn();
      const onStart = vi.fn();
      void tts.playTTS('Макс спрашивает', 'male', undefined, vi.fn(), onStart, { ...HOST, onRetry });
      await vi.advanceTimersByTimeAsync(0);
      expect(onRetry).toHaveBeenCalledTimes(1);
      expect(onRetry).toHaveBeenLastCalledWith('server');
      await vi.advanceTimersByTimeAsync(1000);
      expect(onRetry).toHaveBeenCalledTimes(2);
      expect(onRetry).toHaveBeenLastCalledWith('network');
      await vi.advanceTimersByTimeAsync(3000);
      expect(FakeAudio.instances).toHaveLength(1);
      FakeAudio.instances[0].emit('playing');
      expect(onStart).toHaveBeenCalledTimes(1);
      // No retry after the sound came.
      expect(onRetry).toHaveBeenCalledTimes(2);
    });

    it('says nothing about retries of a line that was stopped', async () => {
      vi.useFakeTimers();
      fetchMock.mockImplementation(async () => answer(502));
      const tts = await loadTts();
      const onRetry = vi.fn();
      void tts.playTTS('Остановленная', 'male', undefined, vi.fn(), vi.fn(), { ...HOST, onRetry });
      tts.stopTTS();
      await vi.advanceTimersByTimeAsync(5000);
      expect(onRetry).not.toHaveBeenCalled();
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
  });

  describe('ready files of the lines (setTTSVoiceFiles: the /try/lecture example, open without an account)', () => {
    const FILES = [
      { text: 'Макс спрашивает', role: 'male', src: '/example/lecture/podcast/01.mp3' },
      { text: 'Софья объясняет', role: 'female', src: '/example/lecture/podcast/02.mp3' },
    ] as const;
    const HOST = { fallback: 'none', persist: true } as const;
    const urls = () => fetchMock.mock.calls.map(call => String(call[0]));
    let openCache: ReturnType<typeof vi.fn>;

    beforeEach(() => {
      openCache = vi.fn(async () => ({ match: vi.fn(), put: vi.fn(), keys: vi.fn(async () => []), delete: vi.fn() }));
      vi.stubGlobal('caches', { open: openCache });
    });

    it("plays a host's line from its file: the server is not asked and nothing goes to the Cache API", async () => {
      const tts = await loadTts();
      tts.setTTSVoiceFiles(FILES);
      const onStart = vi.fn();
      await tts.playTTS('Макс спрашивает', 'male', undefined, vi.fn(), onStart, HOST);
      expect(urls()).toEqual(['/example/lecture/podcast/01.mp3']);
      // A plain request of the site's file: no method, no body.
      expect(fetchMock.mock.calls[0][1]).not.toHaveProperty('method');
      expect(FakeAudio.instances[0].src).toBe('blob:audio-1');
      FakeAudio.instances[0].emit('playing');
      expect(onStart).toHaveBeenCalledTimes(1);
      await flush();
      expect(openCache).not.toHaveBeenCalled();
    });

    it('readies the lines ahead from their files, one by one, and plays them without asking again', async () => {
      const tts = await loadTts();
      tts.setTTSVoiceFiles(FILES);
      await tts.prefetchTTSInOrder(
        FILES.map(file => ({ text: file.text, role: file.role })),
        { persist: true },
      );
      expect(urls()).toEqual(['/example/lecture/podcast/01.mp3', '/example/lecture/podcast/02.mp3']);
      expect(await tts.isTTSReady('Софья объясняет', 'female')).toBe(true);
      await tts.playTTS('Софья объясняет', 'female', undefined, vi.fn(), vi.fn(), HOST);
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(openCache).not.toHaveBeenCalled();
    });

    it('gives a line without a file no voice and asks nobody for it', async () => {
      vi.useFakeTimers();
      const tts = await loadTts();
      tts.setTTSVoiceFiles(FILES);
      expect(await tts.prefetchTTS('Чужая реплика', 'male', { persist: true })).toBeNull();
      const onError = vi.fn();
      void tts.playTTS('Чужая реплика', 'male', undefined, onError, vi.fn(), HOST);
      await vi.advanceTimersByTimeAsync(5000);
      expect(onError).toHaveBeenCalledTimes(1);
      expect(onError.mock.calls[0][0].reason).toBe('server');
      expect(fetchMock).not.toHaveBeenCalled();
      const synth = window.speechSynthesis as unknown as ReturnType<typeof makeSynth>;
      expect(synth.speak).not.toHaveBeenCalled();
    });

    it('gives the voice back to the server once the files are taken away, and forgets their clips', async () => {
      const tts = await loadTts();
      tts.setTTSVoiceFiles(FILES);
      expect(await tts.prefetchTTS('Макс спрашивает', 'male')).toBe('blob:audio-1');
      tts.setTTSVoiceFiles(null);
      expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:audio-1');
      expect(await tts.prefetchTTS('Макс спрашивает', 'male')).toBe('blob:audio-2');
      expect(urls()).toEqual(['/example/lecture/podcast/01.mp3', '/api/tts']);
      expect(JSON.parse(String((fetchMock.mock.calls[1][1] as RequestInit).body))).toEqual({ text: 'Макс спрашивает', role: 'male' });
    });

    it('does not keep a file that arrives after the page took its files away', async () => {
      let release: () => void = () => undefined;
      fetchMock.mockImplementation(
        () =>
          new Promise(resolve => {
            release = () => resolve({ ok: true, status: 200, blob: async () => new Blob(['mp3']) });
          }),
      );
      const tts = await loadTts();
      tts.setTTSVoiceFiles(FILES);
      const late = tts.prefetchTTS('Софья объясняет', 'female');
      await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
      tts.setTTSVoiceFiles(null);
      release();
      expect(await late).toBeNull();
      expect(URL.createObjectURL).not.toHaveBeenCalled();
    });

    it('stops the read-ahead planned for the other source when the files change', async () => {
      const tts = await loadTts();
      let release: () => void = () => undefined;
      fetchMock.mockImplementationOnce(
        () =>
          new Promise(resolve => {
            release = () => resolve({ ok: true, status: 200, blob: async () => new Blob(['mp3']) });
          }),
      );
      tts.setTTSVoiceFiles(FILES);
      const ahead = tts.prefetchTTSInOrder(FILES.map(file => ({ text: file.text, role: file.role })), { persist: true });
      await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
      // The page goes: the second line is not asked of the server.
      tts.setTTSVoiceFiles(null);
      release();
      await ahead;
      expect(urls()).toEqual(['/example/lecture/podcast/01.mp3']);
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
