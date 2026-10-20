import { useMemo, useRef } from 'react';
import { ORAL, ORAL_WORDS } from '../content';
import { blur, flag, opacity, put, useEls, useFrame } from '../engine';
import { Kinetic, TypeLabel } from '../parts';
import { clamp, ease, mix, rng, seg } from '../timeline';
import HintsSheet from './hints/HintsSheet';
import { NAMED_AT, SHEET_AT, wordAt } from './hints/model';

const WORDS = ORAL.answer.split(' ');
const SPOKEN_UNTIL = wordAt(WORDS.length - 1) + 380;
/** The chapter leaves for the group. */
const LEAVE = 7580;

const WAVE = Array.from({ length: 22 }, (_, index) => index);
/** Which point a word of the answer names (the words the check matched), for its highlight. */
const MATCHED_BY = new Map<number, number>(ORAL.matched.flatMap((words, point) => words.map((word) => [word, point] as [number, number])));
/** The answer as runs of words: a matched phrase is one run (kept whole on its line). */
const PHRASES: Array<{ point: number | null; words: number[] }> = WORDS.reduce<Array<{ point: number | null; words: number[] }>>((runs, _, index) => {
  const point = MATCHED_BY.get(index) ?? null;
  const last = runs[runs.length - 1];
  if (last && last.point === point && point !== null) last.words.push(index);
  else runs.push({ point, words: [index] });
  return runs;
}, []);

/**
 * 8 · Chapter 04, «Шпаргалка». An open question of «Философия» answered aloud: the words come as they are said, the
 * points from the student's lectures light up as the answer names them.
 * Then the cheat sheet (./hints): the question's lines get a stroke and fade to «named once»; on another day they go;
 * the days run to the exam and the map of the sheet empties.
 */
export default function Hints() {
  const root = useRef<HTMLDivElement>(null);
  const { one, all } = useEls(root);
  const waveSeed = useMemo(() => {
    const random = rng(62);
    return WAVE.map(() => ({ a: random() * 6, b: 0.004 + random() * 0.006, c: random() * 6 }));
  }, []);

  useFrame((l) => {
    opacity(root.current, seg(l, 60, 260));
    const cam = one('cam');
    const enter = ease.brand(seg(l, 0, 440));
    const leave = ease.in(seg(l, LEAVE, 400));
    const push = mix(1, 1.025, ease.sine(seg(l, 400, 6800)));
    put(cam, 'transform', `translate3d(${(-120 * leave).toFixed(1)}px,0,0) scale(${(mix(1.1, 1, enter) * push).toFixed(4)})`);
    blur(cam, (1 - enter) * 12 + leave * 12);
    opacity(cam, seg(l, 0, 260) * (1 - leave));

    // The answer, word by word: grey while it is being recognised, ink once it is settled.
    all('w').forEach((word, index) => {
      const shown = l >= wordAt(index);
      opacity(word, shown ? clamp((l - wordAt(index)) / 90) : 0);
      flag(word, 'is-interim', shown && l < wordAt(index) + 380);
      flag(word, 'is-last', shown && l < SPOKEN_UNTIL && (index === WORDS.length - 1 || l < wordAt(index + 1)));
    });

    // The microphone listens while the answer is said.
    const listening = l >= wordAt(0) - 250 && l < SPOKEN_UNTIL;
    all('ring').forEach((ring, index) => {
      const cycle = ((l + index * 600) % 1200) / 1200;
      put(ring, 'transform', `scale(${(1 + cycle * 0.9).toFixed(3)})`);
      opacity(ring, listening ? (1 - cycle) * 0.6 : 0);
    });
    all('bar').forEach((bar, index) => {
      const seed = waveSeed[index];
      const level = listening ? 0.25 + 0.75 * Math.abs(Math.sin(l * seed.b + seed.a) * Math.cos(l * seed.b * 0.7 + seed.c)) : 0.12;
      put(bar, 'transform', `scaleY(${level.toFixed(3)})`);
    });

    // The points light up as they are named: the fill runs in, the dot turns yellow.
    all('pt-fill').forEach((fill, index) => {
      const at = NAMED_AT[index];
      put(fill, 'transform', `scaleX(${(at === null ? 0 : ease.brand(seg(l, at, 520))).toFixed(4)})`);
    });
    all('pt-dot').forEach((dot, index) => {
      const at = NAMED_AT[index];
      const p = at === null ? 0 : seg(l, at + 80, 360);
      opacity(dot, p);
      put(dot, 'transform', `scale(${(p <= 0 ? 0.4 : 1 + 0.5 * Math.sin(Math.PI * p)).toFixed(3)})`);
    });

    // The cut to the sheet: the answer steps back, the sheet comes forward.
    const out = ease.inOut(seg(l, SHEET_AT - 120, 380));
    const answer = one('answer');
    put(answer, 'transform', `scale(${mix(1, 0.965, out).toFixed(4)})`);
    blur(answer, out * 10);
    opacity(answer, 1 - out);
    const into = ease.brand(seg(l, SHEET_AT, 600));
    const sheet = one('sheet');
    put(sheet, 'transform', `scale(${mix(1.035, 1, into).toFixed(4)})`);
    blur(sheet, (1 - into) * 10);
    opacity(sheet, seg(l, SHEET_AT, 260));
  });

  return (
    <div ref={root} className="mr-scene mr-bg-light">
      <div data-a="cam" className="mr-layer">
        <div className="mr-label-at">
          <TypeLabel text="Шпаргалка" at={240} />
        </div>
        <h3 className="mr-display mr-head">
          <Kinetic text="Строки стирают только ответы." at={380} unit="letter" variant="drop" stagger={19} dur={620} accentFrom={2} />
        </h3>

        <div data-a="answer" className="mr-layer" style={{ transformOrigin: '960px 640px' }}>
          <div className="mr-card mr-h-oral">
            <div className="mr-h-oral-top">
              <span className="mr-h-ctx">
                {ORAL_WORDS.context}
                <i>{ORAL_WORDS.number}</i>
              </span>
              <span className="mr-wave" style={{ marginLeft: 'auto' }}>
                {WAVE.map((index) => (
                  <i key={index} data-a="bar" />
                ))}
              </span>
              <span className="mr-mic">
                <span data-a="ring" className="mr-mic-ring" />
                <span data-a="ring" className="mr-mic-ring" />
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <rect x="8.5" y="3" width="7" height="12" rx="3.5" fill="currentColor" />
                  <path d="M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v3" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                </svg>
              </span>
            </div>
            <div className="mr-h-stem">{ORAL.question}</div>
            <div className="mr-h-said">
              {PHRASES.map((phrase) =>
                phrase.point === null ? (
                  phrase.words.map((index) => (
                    <span key={index} data-a="w" className="mr-said-w">
                      {WORDS[index]}
                    </span>
                  ))
                ) : (
                  // The words the check matched to a point, kept whole: their point lights up on the right as it is named.
                  <span key={phrase.words[0]} className="mr-mark mr-h-hit">
                    {phrase.words.map((index) => (
                      <span key={index} data-a="w" className="mr-said-w">
                        {WORDS[index]}
                      </span>
                    ))}
                  </span>
                ),
              )}
            </div>
          </div>

          <div className="mr-card mr-h-points">
            <div className="mr-points-h">{ORAL_WORDS.points}</div>
            {ORAL.points.map((point) => (
              <div key={point.text} className={`mr-h-pt${point.main ? '' : ' mr-h-pt--detail'}`}>
                <span data-a="pt-fill" className="mr-h-pt-fill" style={{ transform: 'scaleX(0)' }} />
                <span className="mr-h-pdot">
                  <i />
                  <i data-a="pt-dot" className="mr-h-pdot-y" style={{ opacity: 0 }} />
                </span>
                <span className="mr-h-pt-t">{point.text}</span>
              </div>
            ))}
          </div>
        </div>

        <div data-a="sheet" className="mr-layer" style={{ opacity: 0, transformOrigin: '960px 640px' }}>
          <HintsSheet />
        </div>
      </div>
    </div>
  );
}
