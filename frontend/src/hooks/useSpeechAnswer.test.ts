import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { RESTART_DELAY_MS, STOP_WAIT_MS, useSpeechAnswer, type RecognitionResultEvent } from './useSpeechAnswer';

class FakeRecognition {
  static instances: FakeRecognition[] = [];
  lang = '';
  continuous = false;
  interimResults = false;
  maxAlternatives = 0;
  onresult: ((event: RecognitionResultEvent) => void) | null = null;
  onerror: ((event: { error: string }) => void) | null = null;
  onend: (() => void) | null = null;
  starts = 0;
  stops = 0;
  aborts = 0;
  running = false;
  failNextStart: Error | null = null;

  constructor() {
    FakeRecognition.instances.push(this);
  }

  start() {
    if (this.failNextStart) {
      const error = this.failNextStart;
      this.failNextStart = null;
      throw error;
    }
    if (this.running) throw new DOMException('already started', 'InvalidStateError');
    this.running = true;
    this.starts += 1;
  }

  stop() {
    this.stops += 1;
  }

  abort() {
    this.aborts += 1;
    this.running = false;
  }

  /** The cumulative results of the session, as Chrome sends them. */
  say(results: Array<[string, boolean]>, resultIndex = 0) {
    const list = results.map(([transcript, isFinal]) => ({ isFinal, length: 1, 0: { transcript } }));
    this.onresult?.({ resultIndex, results: Object.assign(list, { length: list.length }) });
  }

  end() {
    this.running = false;
    this.onend?.();
  }

  fail(code: string) {
    this.onerror?.({ error: code });
  }
}

const latest = () => FakeRecognition.instances[FakeRecognition.instances.length - 1];

describe('useSpeechAnswer', () => {
  beforeEach(() => {
    FakeRecognition.instances = [];
    vi.useFakeTimers();
    vi.stubGlobal('webkitSpeechRecognition', FakeRecognition);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('does not touch the microphone until start() and then listens in Russian, continuously, with interim words', () => {
    const { result } = renderHook(() => useSpeechAnswer());
    expect(result.current.supported).toBe(true);
    expect(result.current.status).toBe('idle');
    expect(FakeRecognition.instances).toHaveLength(0);

    act(() => {
      expect(result.current.start()).toBe(true);
    });
    const rec = latest();
    expect(rec).toMatchObject({ lang: 'ru-RU', continuous: true, interimResults: true, starts: 1 });
    expect(result.current.status).toBe('listening');
  });

  it('assembles final and interim text', () => {
    const { result } = renderHook(() => useSpeechAnswer());
    act(() => void result.current.start());
    const rec = latest();
    act(() => rec.say([['Обучение — это', true], [' подбор весов', false]]));
    expect(result.current.finalText).toBe('Обучение — это');
    expect(result.current.interimText).toBe('подбор весов');
    act(() => rec.say([['Обучение — это', true], [' подбор весов которые минимизируют', true]], 1));
    expect(result.current.finalText).toBe('Обучение — это подбор весов которые минимизируют');
    expect(result.current.interimText).toBe('');
    expect(result.current.snapshot()).toBe('Обучение — это подбор весов которые минимизируют');
  });

  it('restarts 150 ms after the browser ends the session and keeps the words', () => {
    const { result } = renderHook(() => useSpeechAnswer());
    act(() => void result.current.start());
    const rec = latest();
    act(() => rec.say([['Сначала прямой проход', true]]));
    act(() => rec.end());
    expect(rec.starts).toBe(1);
    act(() => void vi.advanceTimersByTime(RESTART_DELAY_MS - 1));
    expect(rec.starts).toBe(1);
    act(() => void vi.advanceTimersByTime(1));
    expect(rec.starts).toBe(2);
    act(() => rec.say([['потом обратное распространение', true]]));
    expect(result.current.finalText).toBe('Сначала прямой проход потом обратное распространение');
  });

  it('ignores no-speech and keeps listening', () => {
    const { result } = renderHook(() => useSpeechAnswer());
    act(() => void result.current.start());
    const rec = latest();
    act(() => {
      rec.fail('no-speech');
      rec.end();
    });
    act(() => void vi.advanceTimersByTime(RESTART_DELAY_MS));
    expect(result.current.status).toBe('listening');
    expect(result.current.error).toBeNull();
    expect(rec.starts).toBe(2);
  });

  it('gives up after three failed restarts within 10 s', () => {
    const { result } = renderHook(() => useSpeechAnswer());
    act(() => void result.current.start());
    const rec = latest();
    act(() => rec.end());
    for (let i = 0; i < 3; i += 1) {
      act(() => void vi.advanceTimersByTime(RESTART_DELAY_MS));
      act(() => rec.end());
    }
    expect(result.current.status).toBe('error');
    expect(result.current.error).toBe('restart-failed');
    act(() => void vi.advanceTimersByTime(1000));
    expect(rec.starts).toBe(4);
  });

  it('does not count restarts that heard something', () => {
    const { result } = renderHook(() => useSpeechAnswer());
    act(() => void result.current.start());
    const rec = latest();
    for (let i = 0; i < 5; i += 1) {
      act(() => rec.say([[`слово ${i}`, true]]));
      act(() => rec.end());
      act(() => void vi.advanceTimersByTime(RESTART_DELAY_MS));
    }
    expect(result.current.status).toBe('listening');
    expect(rec.starts).toBe(6);
  });

  it.each([
    ['not-allowed', 'not-allowed'],
    ['audio-capture', 'audio-capture'],
    ['network', 'network'],
    ['service-not-allowed', 'service-not-allowed'],
    ['language-not-supported', 'other'],
  ])('maps %s to an error state and stops restarting', (code, kind) => {
    const { result } = renderHook(() => useSpeechAnswer());
    act(() => void result.current.start());
    const rec = latest();
    act(() => rec.say([['уже сказано', true]]));
    act(() => {
      rec.fail(code);
      rec.end();
    });
    act(() => void vi.advanceTimersByTime(1000));
    expect(result.current.status).toBe('error');
    expect(result.current.error).toBe(kind);
    expect(result.current.finalText).toBe('уже сказано');
    expect(rec.starts).toBe(1);
  });

  it('does not restart while paused and continues the same answer after start()', () => {
    const { result } = renderHook(() => useSpeechAnswer());
    act(() => void result.current.start());
    const rec = latest();
    act(() => rec.say([['первая часть', true]]));
    act(() => result.current.pause());
    expect(rec.stops).toBe(1);
    act(() => rec.end());
    act(() => void vi.advanceTimersByTime(1000));
    expect(rec.starts).toBe(1);
    expect(result.current.status).toBe('paused');
    act(() => void result.current.start());
    expect(rec.starts).toBe(2);
    act(() => rec.say([['вторая часть', true]]));
    expect(result.current.finalText).toBe('первая часть вторая часть');
  });

  it('stop() waits for the last words and does not double them', async () => {
    const { result } = renderHook(() => useSpeechAnswer());
    act(() => void result.current.start());
    const rec = latest();
    act(() => rec.say([['градиент по каждому', false]]));
    let answer = '';
    await act(async () => {
      const pending = result.current.stop();
      await vi.advanceTimersByTimeAsync(200);
      rec.say([['градиент по каждому весу', true]]);
      rec.end();
      answer = await pending;
    });
    expect(answer).toBe('градиент по каждому весу');
    expect(result.current.status).toBe('stopped');
  });

  it('stop() keeps the last interim words when the browser does not end within 800 ms', async () => {
    const { result } = renderHook(() => useSpeechAnswer());
    act(() => void result.current.start());
    const rec = latest();
    act(() => rec.say([['и оптимизатор адам', false]]));
    let answer = '';
    await act(async () => {
      const pending = result.current.stop();
      await vi.advanceTimersByTimeAsync(STOP_WAIT_MS - 1);
      expect(rec.aborts).toBe(0);
      await vi.advanceTimersByTimeAsync(1);
      answer = await pending;
    });
    expect(answer).toBe('и оптимизатор адам');
    expect(rec.aborts).toBe(1);
    // A late result of the stopped session is not added twice.
    act(() => rec.say([['и оптимизатор адам', true]]));
    expect(result.current.finalText).toBe('и оптимизатор адам');
  });

  it('starts a fresh answer after reset() (the follow-up) and can be started later', () => {
    const { result } = renderHook(() => useSpeechAnswer());
    act(() => void result.current.start());
    act(() => latest().say([['основной ответ', true]]));
    act(() => result.current.reset(''));
    expect(result.current.finalText).toBe('');
    expect(result.current.status).toBe('idle');
    act(() => void vi.advanceTimersByTime(5000));
    act(() => void result.current.start());
    act(() => latest().say([['будут колебания', true]]));
    expect(result.current.finalText).toBe('будут колебания');
  });

  it('reports a browser without the API as unsupported (text mode)', () => {
    vi.stubGlobal('webkitSpeechRecognition', undefined);
    const { result } = renderHook(() => useSpeechAnswer());
    expect(result.current.supported).toBe(false);
    expect(result.current.status).toBe('unsupported');
    let started = true;
    act(() => {
      started = result.current.start();
    });
    expect(started).toBe(false);
  });
});
