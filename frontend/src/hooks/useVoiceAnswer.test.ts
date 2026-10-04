import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import type { RecognitionResultEvent } from './useSpeechAnswer';

// ── The recorder is replaced: the test hands out pieces itself ──
const recorders: FakeSegmentRecorder[] = [];
let recorderSupportedValue = true;
let startFailure: unknown = null;

class FakeSegmentRecorder {
  active = false;
  options: { onSegment: (piece: { blob: Blob; index: number; speechMs: number; durationMs: number }) => void; onSpeech?: (at: number) => void };
  next = 0;
  flushes = 0;
  constructor(options: FakeSegmentRecorder['options']) {
    this.options = options;
    recorders.push(this);
  }
  async start() {
    if (startFailure) throw startFailure;
    this.active = true;
  }
  piece() {
    this.options.onSegment({ blob: new Blob(['opus'], { type: 'audio/webm' }), index: this.next++, speechMs: 1000, durationMs: 3000 });
  }
  async flush() {
    this.flushes += 1;
  }
  async stop() {
    this.active = false;
  }
  release() {
    this.active = false;
  }
}

vi.mock('../lib/oral/recorder', () => ({
  SegmentRecorder: function SegmentRecorder(this: unknown, options: FakeSegmentRecorder['options']) {
    return new FakeSegmentRecorder(options);
  },
  RecorderError: class RecorderError extends Error {
    kind: string;
    constructor(kind: string) {
      super(kind);
      this.kind = kind;
    }
  },
  recorderSupported: () => recorderSupportedValue,
}));

// ── The server: the test answers each piece ──
const transcripts: Array<{ resolve: (text: string) => void; reject: (error: unknown) => void; hint?: string }> = [];
vi.mock('../lib/oral/transcribe', () => ({
  transcribeAudio: (_blob: Blob, options: { hint?: string }) =>
    new Promise<string>((resolve, reject) => transcripts.push({ resolve, reject, hint: options.hint })),
}));

import { NO_RESULT_MS, VOICE_ENGINE_KEY, useVoiceAnswer } from './useVoiceAnswer';

class FakeRecognition {
  static instances: FakeRecognition[] = [];
  lang = '';
  continuous = false;
  interimResults = false;
  maxAlternatives = 0;
  onresult: ((event: RecognitionResultEvent) => void) | null = null;
  onerror: ((event: { error: string }) => void) | null = null;
  onend: (() => void) | null = null;
  running = false;
  constructor() {
    FakeRecognition.instances.push(this);
  }
  start() {
    this.running = true;
  }
  stop() {
    this.running = false;
    this.onend?.();
  }
  abort() {
    this.running = false;
  }
  say(results: Array<[string, boolean]>) {
    const list = results.map(([transcript, isFinal]) => ({ isFinal, length: 1, 0: { transcript } }));
    this.onresult?.({ resultIndex: 0, results: Object.assign(list, { length: list.length }) });
  }
  fail(code: string) {
    this.onerror?.({ error: code });
  }
}

const recognition = () => FakeRecognition.instances[FakeRecognition.instances.length - 1];
const answer = async (index: number, text: string) => {
  await act(async () => {
    transcripts[index].resolve(text);
    await Promise.resolve();
  });
};

describe('useVoiceAnswer', () => {
  beforeEach(() => {
    recorders.length = 0;
    transcripts.length = 0;
    recorderSupportedValue = true;
    startFailure = null;
    FakeRecognition.instances = [];
    window.localStorage.clear();
    vi.stubGlobal('webkitSpeechRecognition', FakeRecognition);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('listens in the browser first, like before', () => {
    const { result } = renderHook(() => useVoiceAnswer());
    expect(result.current.engine).toBe('browser');
    act(() => {
      result.current.start();
    });
    act(() => recognition().say([['спрос растёт', true]]));
    expect(result.current.finalText).toBe('спрос растёт');
    expect(recorders).toHaveLength(0);
  });

  it('moves to the server when the browser fails, keeps the words and never shows the error', async () => {
    const { result } = renderHook(() => useVoiceAnswer({ hint: 'Что такое эластичность?' }));
    act(() => {
      result.current.start();
    });
    act(() => recognition().say([['эластичность это', true]]));
    act(() => recognition().fail('network'));
    expect(result.current.status).toBe('listening');
    expect(result.current.error).toBeNull();
    expect(result.current.engine).toBe('server');
    expect(result.current.switchedBecause).toBe('network');
    expect(window.localStorage.getItem(VOICE_ENGINE_KEY)).toBe('server');
    expect(recorders).toHaveLength(1);
    expect(result.current.finalText).toBe('эластичность это');
    // The pieces come back in any order and are joined in the order they were said.
    act(() => {
      recorders[0].piece();
      recorders[0].piece();
    });
    expect(result.current.pending).toBe(2);
    expect(transcripts[0].hint).toBe('Что такое эластичность?');
    await answer(1, 'сильнее, чем цена.');
    await answer(0, 'когда покупки меняются');
    expect(result.current.pending).toBe(0);
    expect(result.current.finalText).toBe('эластичность это когда покупки меняются сильнее, чем цена.');
  });

  it('does not move to the server when the microphone itself is refused', () => {
    const { result } = renderHook(() => useVoiceAnswer());
    act(() => {
      result.current.start();
    });
    act(() => recognition().fail('not-allowed'));
    expect(result.current.engine).toBe('browser');
    expect(result.current.status).toBe('error');
    expect(result.current.error).toBe('not-allowed');
  });

  it('moves to the server by itself after a silent stretch without a single word', () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useVoiceAnswer());
    act(() => {
      result.current.start();
    });
    act(() => {
      vi.advanceTimersByTime(NO_RESULT_MS - 100);
    });
    expect(result.current.engine).toBe('browser');
    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(result.current.engine).toBe('server');
    expect(result.current.switchedBecause).toBe('silence');
    expect(result.current.status).toBe('listening');
    expect(recorders).toHaveLength(1);
    expect(recognition().running).toBe(false);
  });

  it('only says it is stuck when there is no server recording to move to', () => {
    vi.useFakeTimers();
    recorderSupportedValue = false;
    const { result } = renderHook(() => useVoiceAnswer());
    act(() => {
      result.current.start();
    });
    act(() => {
      vi.advanceTimersByTime(NO_RESULT_MS + 10);
    });
    expect(result.current.stuck).toBe(true);
    expect(result.current.engine).toBe('browser');
  });

  it('is not stuck when words come', () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useVoiceAnswer());
    act(() => {
      result.current.start();
    });
    act(() => {
      vi.advanceTimersByTime(2000);
      recognition().say([['издержки', false]]);
      vi.advanceTimersByTime(NO_RESULT_MS);
    });
    expect(result.current.stuck).toBe(false);
  });

  it('records on the server from the start when there is no Web Speech', () => {
    vi.unstubAllGlobals();
    const { result } = renderHook(() => useVoiceAnswer());
    expect(result.current.supported).toBe(true);
    expect(result.current.engine).toBe('server');
  });

  it('is unsupported with neither recognition nor recording', () => {
    vi.unstubAllGlobals();
    recorderSupportedValue = false;
    const { result } = renderHook(() => useVoiceAnswer());
    expect(result.current.supported).toBe(false);
    expect(result.current.status).toBe('unsupported');
  });

  it('settle() waits for the pieces in flight; stop() returns the whole answer', async () => {
    window.localStorage.setItem(VOICE_ENGINE_KEY, 'server');
    const { result } = renderHook(() => useVoiceAnswer());
    act(() => {
      result.current.start();
    });
    act(() => recorders[0].piece());
    let settled: string | null = null;
    let settling: Promise<void> = Promise.resolve();
    act(() => {
      settling = result.current.settle().then((text) => {
        settled = text;
      });
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(recorders[0].flushes).toBe(1);
    expect(settled).toBeNull();
    await answer(0, 'Постоянные издержки не зависят от выпуска.');
    await act(async () => {
      await settling;
    });
    expect(settled).toBe('Постоянные издержки не зависят от выпуска.');
    let stopped = '';
    await act(async () => {
      stopped = await result.current.stop();
    });
    expect(stopped).toBe('Постоянные издержки не зависят от выпуска.');
    expect(result.current.status).toBe('stopped');
  });

  it('reset() drops the answers of pieces said before it', async () => {
    window.localStorage.setItem(VOICE_ENGINE_KEY, 'server');
    const { result } = renderHook(() => useVoiceAnswer());
    act(() => {
      result.current.start();
    });
    act(() => recorders[0].piece());
    act(() => result.current.reset(''));
    await answer(0, 'старый ответ');
    expect(result.current.finalText).toBe('');
    expect(result.current.pending).toBe(0);
  });

  it('reports a refused microphone on the server path as not-allowed', async () => {
    window.localStorage.setItem(VOICE_ENGINE_KEY, 'server');
    startFailure = Object.assign(new Error('not-allowed'), { kind: 'not-allowed' });
    const { RecorderError } = await import('../lib/oral/recorder');
    startFailure = new (RecorderError as unknown as new (kind: string) => Error)('not-allowed');
    const { result } = renderHook(() => useVoiceAnswer());
    await act(async () => {
      result.current.start();
      await Promise.resolve();
    });
    expect(result.current.status).toBe('error');
    expect(result.current.error).toBe('not-allowed');
  });

  it('two failed pieces in a row with nothing recognised is a network error', async () => {
    window.localStorage.setItem(VOICE_ENGINE_KEY, 'server');
    const { result } = renderHook(() => useVoiceAnswer());
    act(() => {
      result.current.start();
    });
    act(() => {
      recorders[0].piece();
      recorders[0].piece();
    });
    await act(async () => {
      transcripts[0].reject(new Error('offline'));
      transcripts[1].reject(new Error('offline'));
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(result.current.lost).toBe(2);
    expect(result.current.status).toBe('error');
    expect(result.current.error).toBe('network');
  });
});
