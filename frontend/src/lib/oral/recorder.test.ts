import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  IDLE_RESTART_MS,
  MAX_SEGMENT_MS,
  MIN_SEGMENT_MS,
  RecorderError,
  SILENCE_MS,
  SegmentRecorder,
  pickMimeType,
  recorderSupported,
  rms,
  segmentDecision,
  type RecordedSegment,
} from './recorder';

const limits = { minSegmentMs: MIN_SEGMENT_MS, maxSegmentMs: MAX_SEGMENT_MS, silenceMs: SILENCE_MS };

describe('segmentDecision', () => {
  it('keeps recording while the phrase goes on and cuts at a pause once the piece is long enough', () => {
    const piece = { startedAt: 0, speechMs: 1200, lastSpeechAt: 1900 };
    expect(segmentDecision(2000, piece, limits)).toBeNull(); // shorter than the minimum
    expect(segmentDecision(2600, piece, limits)).toBe('cut'); // 700 ms of silence after 2.5 s
    expect(segmentDecision(2600, { ...piece, lastSpeechAt: 2400 }, limits)).toBeNull(); // still talking
  });

  it('cuts a long monologue at the maximum length', () => {
    expect(segmentDecision(MAX_SEGMENT_MS, { startedAt: 0, speechMs: 20_000, lastSpeechAt: MAX_SEGMENT_MS }, limits)).toBe('cut');
  });

  it('drops pieces without speech instead of sending silence', () => {
    expect(segmentDecision(IDLE_RESTART_MS - 1, { startedAt: 0, speechMs: 0, lastSpeechAt: null }, limits)).toBeNull();
    expect(segmentDecision(IDLE_RESTART_MS, { startedAt: 0, speechMs: 100, lastSpeechAt: 50 }, limits)).toBe('drop');
  });
});

describe('rms', () => {
  it('is zero for silence and the amplitude for a square wave', () => {
    expect(rms(new Float32Array(8))).toBe(0);
    expect(rms(Float32Array.from([0.5, -0.5, 0.5, -0.5]))).toBeCloseTo(0.5);
  });
});

// ── Browser fakes: microphone, analyser, MediaRecorder ─────────────────────────────

let amplitude = 0;
const tracks: Array<{ stopped: boolean; stop: () => void }> = [];

class FakeRecorder {
  static instances: FakeRecorder[] = [];
  static isTypeSupported = (type: string) => type === 'audio/webm;codecs=opus';
  state: 'inactive' | 'recording' = 'inactive';
  mimeType: string;
  ondataavailable: ((event: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  constructor(_stream: unknown, options?: { mimeType?: string }) {
    this.mimeType = options?.mimeType ?? 'audio/webm';
    FakeRecorder.instances.push(this);
  }
  start() {
    this.state = 'recording';
  }
  stop() {
    if (this.state === 'inactive') return;
    this.state = 'inactive';
    // Like browsers: the data first, then stop — both after the call returns.
    queueMicrotask(() => {
      this.ondataavailable?.({ data: new Blob(['opus-bytes'], { type: this.mimeType }) });
      this.onstop?.();
    });
  }
}

class FakeAudioContext {
  state = 'running';
  createMediaStreamSource() {
    return { connect: () => undefined };
  }
  createAnalyser() {
    return {
      fftSize: 1024,
      getFloatTimeDomainData: (buffer: Float32Array) => {
        for (let i = 0; i < buffer.length; i += 1) buffer[i] = i % 2 ? amplitude : -amplitude;
      },
    };
  }
  resume() {
    return Promise.resolve();
  }
  close() {
    this.state = 'closed';
    return Promise.resolve();
  }
}

function installMedia(getUserMedia?: () => Promise<unknown>) {
  vi.stubGlobal('MediaRecorder', FakeRecorder);
  vi.stubGlobal('AudioContext', FakeAudioContext);
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: {
      getUserMedia:
        getUserMedia ??
        (async () => {
          const track = { stopped: false, stop() { this.stopped = true; } };
          tracks.push(track);
          return { getTracks: () => [track] };
        }),
    },
  });
}

describe('SegmentRecorder', () => {
  beforeEach(() => {
    amplitude = 0;
    tracks.length = 0;
    FakeRecorder.instances = [];
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    Reflect.deleteProperty(navigator, 'mediaDevices');
  });

  it('knows when the browser can record and picks opus in webm', () => {
    expect(recorderSupported()).toBe(false);
    installMedia();
    expect(recorderSupported()).toBe(true);
    expect(pickMimeType()).toBe('audio/webm;codecs=opus');
  });

  it('gives a piece after a phrase and a pause, numbered in order, and goes on recording', async () => {
    installMedia();
    const pieces: RecordedSegment[] = [];
    const levels: number[] = [];
    const recorder = new SegmentRecorder({ onSegment: (piece) => pieces.push(piece), onLevel: (level) => levels.push(level) });
    await recorder.start();
    amplitude = 0.2; // speech
    await vi.advanceTimersByTimeAsync(3000);
    amplitude = 0; // pause
    await vi.advanceTimersByTimeAsync(SILENCE_MS + 100);
    expect(pieces).toHaveLength(1);
    expect(pieces[0].index).toBe(0);
    expect(pieces[0].speechMs).toBeGreaterThanOrEqual(2500);
    expect(pieces[0].blob.type).toBe('audio/webm;codecs=opus');
    expect(Math.max(...levels)).toBeGreaterThan(0.5);
    // The next piece is already recording.
    expect(FakeRecorder.instances[FakeRecorder.instances.length - 1]?.state).toBe('recording');
    amplitude = 0.2;
    await vi.advanceTimersByTimeAsync(1000);
    await recorder.stop();
    expect(pieces.map((piece) => piece.index)).toEqual([0, 1]);
    expect(tracks.every((track) => track.stopped)).toBe(true);
  });

  it('never sends a silent piece', async () => {
    installMedia();
    const pieces: RecordedSegment[] = [];
    const recorder = new SegmentRecorder({ onSegment: (piece) => pieces.push(piece) });
    await recorder.start();
    await vi.advanceTimersByTimeAsync(IDLE_RESTART_MS + 500);
    await recorder.stop();
    expect(pieces).toEqual([]);
  });

  it('flush() hands over what was said and keeps listening', async () => {
    installMedia();
    const pieces: RecordedSegment[] = [];
    const recorder = new SegmentRecorder({ onSegment: (piece) => pieces.push(piece) });
    await recorder.start();
    amplitude = 0.2;
    await vi.advanceTimersByTimeAsync(800);
    await recorder.flush();
    expect(pieces).toHaveLength(1);
    expect(recorder.active).toBe(true);
    recorder.release();
    expect(recorder.active).toBe(false);
  });

  it('turns a refused microphone into not-allowed', async () => {
    installMedia(async () => {
      throw new DOMException('denied', 'NotAllowedError');
    });
    const recorder = new SegmentRecorder({ onSegment: () => undefined });
    await expect(recorder.start()).rejects.toMatchObject({ kind: 'not-allowed' });
    await expect(new SegmentRecorder({ onSegment: () => undefined }).start()).rejects.toBeInstanceOf(RecorderError);
  });
});
