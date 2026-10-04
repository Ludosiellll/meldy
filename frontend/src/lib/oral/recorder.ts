/**
 * Запись устного ответа кусками для распознавания на сервере — запасной путь, когда браузер
 * речь не распознаёт (нет Web Speech API, сеть до Google закрыта, распознавание молчит).
 *
 * - Микрофон открывается один раз (getUserMedia), уровень звука считается анализатором
 *   каждые 50 мс: по нему видна полоска громкости и находятся паузы.
 * - Кусок записи заканчивается на паузе ≥ silenceMs, если он уже длиннее minSegmentMs, и в
 *   любом случае на maxSegmentMs — так распознанный текст появляется после каждой фразы,
 *   а не в конце ответа. Сразу начинается следующий кусок.
 * - Кусок без речи (меньше 250 мс громче шума) не отправляется: Whisper на тишине выдумывает титры.
 * - Шумовой фон оценивается на лету (медленно растущий минимум), порог речи — в 3 раза выше фона.
 */

export type RecorderErrorKind = 'not-allowed' | 'audio-capture' | 'unsupported' | 'other';

export class RecorderError extends Error {
  readonly kind: RecorderErrorKind;
  constructor(kind: RecorderErrorKind, message = kind) {
    super(message);
    this.name = 'RecorderError';
    this.kind = kind;
  }
}

export interface RecordedSegment {
  blob: Blob;
  index: number;
  /** Сколько миллисекунд в куске было громче шума. */
  speechMs: number;
  durationMs: number;
}

export interface SegmentRecorderOptions {
  onSegment: (segment: RecordedSegment) => void;
  /** Громкость 0…1 примерно раз в 50 мс (для полоски уровня). */
  onLevel?: (level: number) => void;
  /** Момент, когда слышна речь (для подсказки «Говорите — я слушаю»). */
  onSpeech?: (at: number) => void;
  minSegmentMs?: number;
  maxSegmentMs?: number;
  silenceMs?: number;
}

export const MIN_SEGMENT_MS = 2500;
export const MAX_SEGMENT_MS = 25_000;
export const SILENCE_MS = 700;
export const MIN_SPEECH_MS = 250;
/** Кусок без речи дольше этого начинается заново, чтобы не копить тишину. */
export const IDLE_RESTART_MS = 8000;
const TICK_MS = 50;
const FLOOR_START = 0.004;
const FLOOR_RISE = 1.0015;
const SPEECH_RATIO = 3;
const SPEECH_MIN_RMS = 0.012;

const MIME_CANDIDATES = ['audio/webm;codecs=opus', 'audio/ogg;codecs=opus', 'audio/mp4', 'audio/webm'];

type AudioContextCtor = new () => AudioContext;

function audioContextCtor(): AudioContextCtor | null {
  if (typeof window === 'undefined') return null;
  const host = window as unknown as { AudioContext?: AudioContextCtor; webkitAudioContext?: AudioContextCtor };
  return host.AudioContext ?? host.webkitAudioContext ?? null;
}

/** Есть ли в браузере всё для записи: микрофон и MediaRecorder. */
export function recorderSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof (window as unknown as { MediaRecorder?: unknown }).MediaRecorder !== 'undefined' &&
    typeof navigator !== 'undefined' &&
    Boolean(navigator.mediaDevices && typeof navigator.mediaDevices.getUserMedia === 'function')
  );
}

/** Формат записи, который понимает и браузер, и сервер распознавания. */
export function pickMimeType(): string {
  const Recorder = (window as unknown as { MediaRecorder?: { isTypeSupported?: (type: string) => boolean } }).MediaRecorder;
  for (const type of MIME_CANDIDATES) {
    try {
      if (Recorder?.isTypeSupported?.(type)) return type;
    } catch {
      // некоторые браузеры бросают на незнакомый тип
    }
  }
  return '';
}

function errorKindOf(caught: unknown): RecorderErrorKind {
  const name = caught && typeof caught === 'object' && 'name' in caught ? String((caught as { name: unknown }).name) : '';
  if (name === 'NotAllowedError' || name === 'SecurityError' || name === 'PermissionDeniedError') return 'not-allowed';
  if (name === 'NotFoundError' || name === 'NotReadableError' || name === 'OverconstrainedError' || name === 'DevicesNotFoundError') {
    return 'audio-capture';
  }
  return 'other';
}

/** Среднеквадратичная громкость кадра. */
export function rms(samples: Float32Array): number {
  if (!samples.length) return 0;
  let sum = 0;
  for (let i = 0; i < samples.length; i += 1) sum += samples[i] * samples[i];
  return Math.sqrt(sum / samples.length);
}

/**
 * Решение о конце куска по времени и паузе. Вынесено отдельно, чтобы его можно было проверить
 * без браузера: 'cut' — отдать кусок, 'drop' — начать заново без отправки, null — писать дальше.
 */
export function segmentDecision(
  now: number,
  segment: { startedAt: number; speechMs: number; lastSpeechAt: number | null },
  limits: { minSegmentMs: number; maxSegmentMs: number; silenceMs: number },
): 'cut' | 'drop' | null {
  const length = now - segment.startedAt;
  if (segment.speechMs < MIN_SPEECH_MS) {
    if (length >= IDLE_RESTART_MS) return 'drop';
    if (length >= limits.maxSegmentMs) return 'drop';
    return null;
  }
  if (length >= limits.maxSegmentMs) return 'cut';
  if (length >= limits.minSegmentMs && segment.lastSpeechAt !== null && now - segment.lastSpeechAt >= limits.silenceMs) return 'cut';
  return null;
}

export class SegmentRecorder {
  private readonly options: Required<Omit<SegmentRecorderOptions, 'onLevel' | 'onSpeech'>> &
    Pick<SegmentRecorderOptions, 'onLevel' | 'onSpeech'>;
  private stream: MediaStream | null = null;
  private context: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private samples: Float32Array | null = null;
  /** The piece being recorded: its own recorder and chunks (the next piece starts before this one's data arrives). */
  private current: { recorder: MediaRecorder; chunks: Blob[] } | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private floor = FLOOR_START;
  private index = 0;
  private segment = { startedAt: 0, speechMs: 0, lastSpeechAt: null as number | null };
  private running = false;
  private mime = '';
  private stopping: Promise<void> | null = null;

  constructor(options: SegmentRecorderOptions) {
    this.options = {
      minSegmentMs: MIN_SEGMENT_MS,
      maxSegmentMs: MAX_SEGMENT_MS,
      silenceMs: SILENCE_MS,
      ...options,
    };
  }

  get active(): boolean {
    return this.running;
  }

  /**
   * Открывает микрофон и начинает запись. AudioContext создаётся сразу (в том же нажатии кнопки:
   * Safari иначе оставит его на паузе), разрешение на микрофон спрашивается потом.
   */
  async start(): Promise<void> {
    if (this.running) return;
    if (!recorderSupported()) throw new RecorderError('unsupported');
    const Ctx = audioContextCtor();
    if (!this.context && Ctx) {
      try {
        this.context = new Ctx();
      } catch {
        this.context = null;
      }
    }
    if (!this.stream) {
      try {
        this.stream = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        });
      } catch (caught) {
        throw new RecorderError(errorKindOf(caught));
      }
    }
    if (this.context && !this.analyser) {
      try {
        if (this.context.state === 'suspended') await this.context.resume();
        const source = this.context.createMediaStreamSource(this.stream);
        this.analyser = this.context.createAnalyser();
        this.analyser.fftSize = 1024;
        source.connect(this.analyser);
        this.samples = new Float32Array(this.analyser.fftSize);
      } catch {
        this.analyser = null;
      }
    }
    this.mime = pickMimeType();
    this.running = true;
    this.beginSegment();
    this.timer = setInterval(() => this.tick(), TICK_MS);
  }

  /** Остановиться, отдав последний кусок; микрофон закрывается (откроется снова при start). */
  async stop(): Promise<void> {
    if (this.stopping) return this.stopping;
    this.running = false;
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
    this.stopping = this.endSegment(true).finally(() => {
      this.release();
      this.stopping = null;
    });
    return this.stopping;
  }

  /** Отдать текущий кусок сейчас и писать дальше (нужно, когда сказанное понадобилось целиком). */
  flush(): Promise<void> {
    if (!this.running) return Promise.resolve();
    return this.endSegment(false);
  }

  /** Закрыть всё сразу, ничего не отдавая (уход со страницы, «Начать заново»). */
  release(): void {
    this.running = false;
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
    const current = this.current;
    this.current = null;
    if (current) {
      current.recorder.ondataavailable = null;
      current.recorder.onstop = null;
      try {
        if (current.recorder.state !== 'inactive') current.recorder.stop();
      } catch {
        // уже остановлен
      }
    }
    this.stream?.getTracks().forEach((track) => {
      try {
        track.stop();
      } catch {
        // уже остановлен
      }
    });
    this.stream = null;
    this.analyser = null;
    this.samples = null;
    const context = this.context;
    this.context = null;
    if (context && context.state !== 'closed') void context.close().catch(() => undefined);
    this.options.onLevel?.(0);
  }

  private beginSegment(): void {
    if (!this.stream) return;
    let recorder: MediaRecorder;
    try {
      recorder = this.mime ? new MediaRecorder(this.stream, { mimeType: this.mime }) : new MediaRecorder(this.stream);
    } catch {
      recorder = new MediaRecorder(this.stream);
    }
    const chunks: Blob[] = [];
    recorder.ondataavailable = (event: BlobEvent) => {
      if (event.data && event.data.size > 0) chunks.push(event.data);
    };
    this.current = { recorder, chunks };
    this.segment = { startedAt: Date.now(), speechMs: 0, lastSpeechAt: null };
    recorder.start();
  }

  /** Заканчивает текущий кусок; отдаёт его, если в нём была речь. */
  private endSegment(final: boolean, drop = false): Promise<void> {
    const current = this.current;
    if (!current || current.recorder.state === 'inactive') return Promise.resolve();
    const { recorder, chunks } = current;
    const segment = { ...this.segment };
    const keep = !drop && segment.speechMs >= MIN_SPEECH_MS;
    // The number is taken now, in recording order, though the data arrives later.
    const index = keep ? this.index++ : -1;
    const type = recorder.mimeType || this.mime || 'audio/webm';
    this.current = null;
    return new Promise<void>((resolve) => {
      recorder.onstop = () => {
        const durationMs = Date.now() - segment.startedAt;
        if (keep && chunks.length > 0) this.options.onSegment({ blob: new Blob(chunks, { type }), index, speechMs: segment.speechMs, durationMs });
        resolve();
      };
      try {
        recorder.stop();
      } catch {
        resolve();
      }
      if (!final && this.running) this.beginSegment();
    });
  }

  private tick(): void {
    if (!this.running) return;
    const now = Date.now();
    let speaking = false;
    if (this.analyser && this.samples) {
      this.analyser.getFloatTimeDomainData(this.samples);
      const level = rms(this.samples);
      this.floor = Math.max(0.0005, Math.min(this.floor * FLOOR_RISE, level));
      speaking = level > Math.max(SPEECH_MIN_RMS, this.floor * SPEECH_RATIO);
      this.options.onLevel?.(Math.min(1, Math.sqrt(level / 0.25)));
    } else {
      // Без анализатора паузы не видны: считаем, что говорят всё время, и режем по длине.
      speaking = true;
    }
    if (speaking) {
      this.segment.speechMs += TICK_MS;
      this.segment.lastSpeechAt = now;
      this.options.onSpeech?.(now);
    }
    const decision = segmentDecision(now, this.segment, this.options);
    if (decision === 'cut') void this.endSegment(false);
    else if (decision === 'drop') void this.endSegment(false, true);
  }
}
