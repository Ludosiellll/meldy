/**
 * The sound's worker: the instruments and effects (synth.ts) are rendered here, on a thread of their own, so the
 * projector's page never stops drawing the game for them. sound.ts asks for the whole set once, after the first
 * gesture; each answer hands its samples over (transferred, not copied). A failure is answered as such, and the page
 * renders that one itself.
 */
import { renderNote, renderSamples, type BufferName, type NoteVoice } from './synth';

export type SynthJob = { key: string; rate: number } & ({ name: BufferName } | { voice: NoteVoice; midi: number });
export type SynthAnswer = { key: string; rate: number; data: Float32Array } | { key: string; failed: true };

// A worker's own scope (the project's types are the page's: only what is used here).
const scope = self as unknown as {
  onmessage: ((event: MessageEvent<SynthJob[]>) => void) | null;
  postMessage: (answer: SynthAnswer, transfer?: Transferable[]) => void;
};

scope.onmessage = (event) => {
  for (const job of event.data) {
    try {
      const data = 'name' in job ? renderSamples(job.name, job.rate) : renderNote(job.voice, job.midi, job.rate);
      scope.postMessage({ key: job.key, rate: job.rate, data }, [data.buffer]);
    } catch {
      scope.postMessage({ key: job.key, failed: true });
    }
  }
};
