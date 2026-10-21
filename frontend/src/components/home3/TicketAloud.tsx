/**
 * «Билет вслух» as a loop (ticketLoop.ts has the timeline): ticket 7 with the four parts of its answer, the talk
 * beside it under the microphone line. Every line and state is in the markup from the start and only its opacity or
 * transform changes, so nothing around the card moves while it plays. It plays only on screen and in a visible tab;
 * with less motion asked for it stands on the last frame; the button on the microphone line stops and starts it.
 */
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { EXAMPLE, TICKET_TALK } from './copy3';
import { FINAL_FRAME, LOOP_MS, ticketFrame, untilNextCue } from './ticketLoop';
import Swap from './Swap';
import { prefersStill, useInView } from './useInView';

const TALK: Array<{ who: 'you' | 'examiner'; text: string }> = [
  ...TICKET_TALK.said.map((text) => ({ who: 'you' as const, text })),
  { who: 'examiner', text: EXAMPLE.examinerAsk },
  { who: 'you', text: TICKET_TALK.answer },
];

const BARS = 40;

function Words({ text }: { text: string }) {
  return (
    <>
      {text.split(' ').map((word, index) => (
        <span key={index} style={{ '--w': index } as CSSProperties}>
          {word}{' '}
        </span>
      ))}
    </>
  );
}

function usePageVisible(): boolean {
  const [visible, setVisible] = useState(() => typeof document === 'undefined' || document.visibilityState !== 'hidden');
  useEffect(() => {
    const update = () => setVisible(document.visibilityState !== 'hidden');
    document.addEventListener('visibilitychange', update);
    return () => document.removeEventListener('visibilitychange', update);
  }, []);
  return visible;
}

export default function TicketAloud() {
  const stage = useRef<HTMLDivElement>(null);
  const onScreen = useInView(stage, { once: false, margin: '0px' });
  const pageVisible = usePageVisible();
  const [still] = useState(prefersStill);
  const [stopped, setStopped] = useState(false);
  const [time, setTime] = useState(0);
  const timeRef = useRef(0);
  const playing = onScreen && pageVisible && !still && !stopped;

  // Wake at each cue (a dozen times a loop), never per frame; resume from the frame on screen.
  useEffect(() => {
    if (!playing) return undefined;
    const start = performance.now() - timeRef.current;
    let timer = 0;
    const wake = () => {
      const now = (performance.now() - start) % LOOP_MS;
      timeRef.current = now;
      setTime(now);
      timer = window.setTimeout(wake, untilNextCue(now) + 4);
    };
    timer = window.setTimeout(wake, untilNextCue(timeRef.current));
    return () => window.clearTimeout(timer);
  }, [playing]);

  const frame = still ? FINAL_FRAME : ticketFrame(time);
  const label = frame.speaker === 'examiner' ? 1 : frame.speaker === null && frame.protocol ? 2 : 0;

  return (
    <div
      ref={stage}
      className="p3-stage p3-stage--ink p3-tk-stage"
      data-speaker={frame.speaker ?? 'none'}
      data-playing={playing ? '' : undefined}
      data-fading={frame.fading ? '' : undefined}
    >
      <div className="p3-tk">
        <div className="p3-win p3-tk-card p3-l">
          <span className="p3-flag">Билет 7</span>
          <p className="p3-stem">{EXAMPLE.question}</p>
          <ul className="p3-tk-pts">
            {TICKET_TALK.parts.map((part, index) => (
              <li key={part} className={`p3-tk-pt is-${frame.points[index]}`}>
                <i aria-hidden="true">
                  <svg viewBox="0 0 16 16">
                    <path d="M3.5 8.5l3 3 6-7" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </i>
                <span>{part}</span>
              </li>
            ))}
          </ul>
          <p className={`p3-tk-proto${frame.protocol ? ' is-on' : ''}`}>{TICKET_TALK.result}</p>
        </div>
        <div className="p3-tk-talk p3-l" style={{ '--d': 160 } as CSSProperties}>
          <div className="p3-tk-mic">
            <span className="p3-tk-mic-i" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="9" y="3" width="6" height="11" rx="3" />
                <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
              </svg>
            </span>
            <span className="p3-tk-wave" aria-hidden="true">
              {Array.from({ length: BARS }, (_, index) => (
                <i key={index} style={{ '--b': (index * 7) % 11 } as CSSProperties} />
              ))}
            </span>
            <Swap items={[TICKET_TALK.speaking, TICKET_TALK.asking, TICKET_TALK.done]} at={label} className="p3-tk-who" />
            {still ? null : (
              <button type="button" className="p3-tk-stop" onClick={() => setStopped((value) => !value)} aria-label={stopped ? TICKET_TALK.play : TICKET_TALK.pause}>
                <svg viewBox="0 0 16 16" aria-hidden="true">
                  {stopped ? <path d="M5 3.5v9l7.5-4.5z" fill="currentColor" /> : <path d="M5 3.5v9M11 3.5v9" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />}
                </svg>
              </button>
            )}
          </div>
          <ol className="p3-tk-lines">
            {TALK.map((line, index) => (
              <li key={line.text} className={`p3-tk-line p3-tk-line--${line.who}${frame.lines > index ? ' is-on' : ''}${frame.lines === index + 1 ? ' is-now' : ''}`}>
                <b>{line.who === 'examiner' ? TICKET_TALK.examiner : TICKET_TALK.you}</b>
                <Words text={line.text} />
              </li>
            ))}
          </ol>
        </div>
      </div>
    </div>
  );
}
