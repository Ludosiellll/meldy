/**
 * The sign-up reel, «От файла с вопросами до плана на каждый день», in the film style: the department's file goes into
 * a new exam and Meldy finds its subjects and questions; the plan by days to the exam; a question of the session; an
 * oral answer that strikes a line off the cheat sheet (StoryScenes); «Начните со списка». The example is
 * data/containerExample.ts; the screens' own words.
 */
import { useRef } from 'react';
import { opacity, place, put, useEls, useFrame } from '../reel/engine';
import { clamp, ease, mix, seg } from '../reel/timeline';
import { Arrow, Statement, slideIn } from '../film/kit';
import { EXAM_TITLE, IMPORT_WORDS, PLAN_LABEL, START_LABEL, SUBJECTS, exampleWords, importRow } from '../../data/containerExample';
import { HOME, Ready } from './Ready';
import { REGISTER_SCRIPT, leaveOf } from './script';
import { Oral, REEL_TODAY, Session, withLeave } from './StoryScenes';
import { shot } from './camera';

const WORDS = exampleWords(REEL_TODAY);

/** A row coming into focus from `at`. */
function focusRow(row: HTMLElement, l: number, at: number) {
  const p = ease.out(seg(l, at, 380));
  opacity(row, clamp(seg(l, at, 380) * 2.5));
  put(row, 'filter', p >= 1 ? 'none' : `blur(${(8 * (1 - p)).toFixed(2)}px)`);
}

// ---------------------------------------------------------------------------------------------
// 1 · «Один файл — 960 вопросов.» — the dot opens on «Новый экзамен»: the department's file goes in, Meldy reads it
// and finds the subjects; the page moves aside for the words.

const FILE_LEAVE = leaveOf(REGISTER_SCRIPT, 'file');
/** The file lands in the drop zone; Meldy has read it (scene time). */
export const DROP = 1450;
export const FOUND = 1900;

function File() {
  const root = useRef<HTMLDivElement>(null);
  const { one, all } = useEls(root);
  useFrame((l) => {
    place(one('home'), HOME.x - HOME.size / 2, HOME.y - HOME.size / 2, 1 - ease.in(seg(l, 300, 380)));
    opacity(one('home'), 1 - seg(l, 600, 120));

    const aside = ease.inOut(seg(l, 2250, 800));
    const out = ease.in(seg(l, FILE_LEAVE, 520));
    const win = one('win');
    put(
      win,
      'transform',
      `perspective(2600px) translate3d(${(mix(0, 520, aside) - 1100 * out).toFixed(1)}px,${mix(0, 24, aside).toFixed(1)}px,0) rotateY(${mix(0, -18, aside).toFixed(2)}deg) scale(${mix(1, 0.84, aside).toFixed(4)})`,
    );
    put(win, 'filter', `blur(${(16 * (1 - ease.out(seg(l, 250, 800))) + 18 * out).toFixed(2)}px)`);
    opacity(win, clamp(seg(l, 250, 300) * 3) * (1 - clamp((out - 0.5) / 0.5)));

    // The department's file comes in and goes into the drop zone; Meldy reads it and the subjects appear in its place.
    const file = one('file');
    if (l < DROP) slideIn(file, l, 700, { dx: -1100, dur: 760, smear: 24 });
    else {
      const drop = ease.in(seg(l, DROP, 260));
      put(file, 'transform', `translate3d(0,${(30 * drop).toFixed(1)}px,0) scale(${mix(1, 0.86, drop).toFixed(4)})`);
      put(file, 'filter', 'none');
      opacity(file, 1 - drop);
    }
    put(one('drop'), 'box-shadow', l >= DROP - 250 && l < DROP + 200 ? 'inset 0 0 0 4px #0b121c' : 'inset 0 0 0 2px #e4e4de');
    opacity(one('drop'), 1 - seg(l, FOUND - 200, 200));
    opacity(one('reading'), seg(l, DROP, 150) * (1 - seg(l, FOUND - 150, 150)));
    // What Meldy found takes the drop zone's place: the heading, the card of subjects, then its rows one by one.
    opacity(one('found'), seg(l, FOUND - 120, 200));
    focusRow(one('found-h') as HTMLElement, l, FOUND);
    all('row').forEach((row, index) => focusRow(row, l, FOUND + 140 + index * 70));
  });
  return (
    <div ref={root} className="mr-scene">
      <div data-a="win" className="fm-win ar-new" style={{ opacity: 0 }}>
        <div className="ar-new-in">
          <p className="fm-h1 ar-new-h">{IMPORT_WORDS.title}</p>
          <p className="ar-new-sub fm-muted">{IMPORT_WORDS.lede}</p>
          <div className="ar-new-body">
            <div data-a="drop" className="ar-new-drop">
              <p className="ar-new-drop-h">{IMPORT_WORDS.drop}</p>
              <p className="ar-new-drop-p fm-muted">{IMPORT_WORDS.dropLede}</p>
              <p data-a="reading" className="ar-new-reading" style={{ opacity: 0 }}>
                {IMPORT_WORDS.reading}
              </p>
            </div>
            <div data-a="found" className="ar-new-found" style={{ opacity: 0 }}>
              <p data-a="found-h" className="ar-new-found-h" style={{ opacity: 0 }}>
                {IMPORT_WORDS.found}
              </p>
              <div className="ar-new-rows">
                {SUBJECTS.map((subject) => (
                  <p key={subject.title} data-a="row" className="ar-new-row" style={{ opacity: 0 }}>
                    <b>{subject.title}</b>
                    <span>{importRow(subject)}</span>
                  </p>
                ))}
              </div>
            </div>
          </div>
        </div>
        <div data-a="file" className="fm-file ar-new-file" style={{ opacity: 0 }}>
          <span className="fm-sheet-ico" />
          <span>
            {IMPORT_WORDS.file}
            <small>DOCX · от кафедры</small>
          </span>
        </div>
      </div>
      <i data-a="home" className="fm-brand-dot ar-home" style={{ transform: `translate3d(${HOME.x - HOME.size / 2}px,${HOME.y - HOME.size / 2}px,0)` }} />
      <Statement lines={['В одном файле', '960 вопросов.']} at={2500} out={FILE_LEAVE} className="ar-say" />
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// 2 · «Каждый день — понемногу.» — the exam's page: today's step and its pill, then «План по дням» to the exam.

function Plan({ leave }: { leave: number }) {
  const root = useRef<HTMLDivElement>(null);
  const { one, all } = useEls(root);
  useFrame((l) => {
    shot(one('page'), l, leave);
    all('day').forEach((row, index) => focusRow(row, l, 950 + index * 170));
    opacity(one('days-h'), seg(l, 850, 300));
  });
  return (
    <div ref={root} className="mr-scene">
      <div data-a="page" className="ar-plan" style={{ opacity: 0 }}>
        <p className="fm-h1 ar-plan-h">{EXAM_TITLE}</p>
        <p className="ar-plan-meta">{WORDS.meta}</p>
        <div className="fm-card ar-plan-card">
          <p className="ar-plan-title">{WORDS.planTitle}</p>
          <p className="ar-plan-detail">{WORDS.planDetail}</p>
          <span className="fm-btn fm-btn--blue ar-plan-pill">
            {START_LABEL}
            <i>
              <Arrow />
            </i>
          </span>
        </div>
        <div className="fm-card ar-days">
          <p data-a="days-h" className="ar-days-h" style={{ opacity: 0 }}>
            {PLAN_LABEL}
          </p>
          {WORDS.days.map((row) => (
            <p key={row} data-a="day" className="ar-day" style={{ opacity: 0 }}>
              {row}
            </p>
          ))}
        </div>
      </div>
      <Statement lines={['Около 45 минут', 'в день.']} at={350} out={leave} className="ar-say" />
    </div>
  );
}

function RegisterReady() {
  return <Ready lines={['Начните', 'со списка']} />;
}

export const REGISTER_SCENES = {
  file: File,
  plan: withLeave(Plan, leaveOf(REGISTER_SCRIPT, 'plan')),
  session: withLeave(Session, leaveOf(REGISTER_SCRIPT, 'session')),
  oral: withLeave(Oral, leaveOf(REGISTER_SCRIPT, 'oral')),
  ready: RegisterReady,
};
