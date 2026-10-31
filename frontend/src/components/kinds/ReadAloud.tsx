import { useEffect, useState } from 'react';
import type { ItemKind } from '../../types/container';
import { GAP_RE } from '../../lib/kinds/cloze';
import { playTTS, stopTTS } from '../../utils/tts';
import { KINDS } from './copyKinds';

/**
 * «Озвучить вопрос» (release 48, spec: «доступность, как read-aloud у Wayground»): the question and its options read by
 * Meldy's voice (/api/tts); without an account, or when the server cannot, the browser's own voice reads it (playTTS's
 * fallback). A second press stops. Formulas are read as written, without their dollars; a gap is read as «пропуск».
 */

const LETTERS = ['А', 'Б', 'В', 'Г', 'Д', 'Е', 'Ж', 'З'];

/** What is read: the stem, then the options by letter (or the items, the pairs' two columns). */
export function readText(p: { kind: ItemKind; stem: string; options: string[]; right?: string[]; unit?: string | null }): string {
  const clean = (text: string) => text.replace(/\$\$?/g, '').replace(GAP_RE, ' пропуск ').replace(/\s+/g, ' ').trim();
  const parts = [clean(p.stem)];
  if (p.kind === 'single' || p.kind === 'multiple') parts.push(...p.options.map((o, i) => `${LETTERS[i] ?? i + 1}: ${clean(o)}.`));
  else if (p.kind === 'order') parts.push(`Расставьте по порядку: ${p.options.map(clean).join('; ')}.`);
  else if (p.kind === 'match') parts.push(`Строки: ${p.options.map(clean).join('; ')}. Ответы: ${(p.right ?? []).map(clean).join('; ')}.`);
  else if (p.kind === 'number' && p.unit) parts.push(`Ответ — число, в ${clean(p.unit)}.`);
  return parts.filter(Boolean).join(' ');
}

function Speaker() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <path d="M3.5 7.5h3l4-3.5v12l-4-3.5h-3z" />
      <path d="M13.5 7a4 4 0 0 1 0 6M15.8 4.8a7 7 0 0 1 0 10.4" />
    </svg>
  );
}

export default function ReadAloud({ text }: { text: string }) {
  const [playing, setPlaying] = useState(false);
  const [failed, setFailed] = useState(false);
  useEffect(() => () => stopTTS(), []);
  useEffect(() => {
    stopTTS();
    setPlaying(false);
    setFailed(false);
  }, [text]);
  return (
    <>
      <button
        type="button"
        className="kd-read"
        aria-pressed={playing}
        onClick={() => {
          if (playing) {
            stopTTS();
            setPlaying(false);
            return;
          }
          setFailed(false);
          setPlaying(true);
          void playTTS(
            text,
            'female',
            () => setPlaying(false),
            () => {
              setPlaying(false);
              setFailed(true);
            },
          );
        }}
      >
        <Speaker />
        {playing ? KINDS.readStop : KINDS.readAloud}
      </button>
      {failed ? (
        <p className="kd-read-error" role="alert">
          {KINDS.readFailed}
        </p>
      ) : null}
    </>
  );
}
