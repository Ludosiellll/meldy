/**
 * The sign-up reel, «От списка вопросов до шпаргалки», in the film style: the four steps of the landing
 * from the start — the department's list goes into a new exam, the questions are checked against the
 * lectures, the ticket is answered aloud with the examiner's follow-up, and only answers erase the
 * sheet (StoryScenes). Example: /try's «Микроэкономика»; the screens' own words.
 */
import { useRef } from 'react';
import { opacity, place, put, useEls, useFrame } from '../reel/engine';
import { clamp, ease, mix, seg } from '../reel/timeline';
import { Statement, slideIn } from '../film/kit';
import { HOME, Ready } from './Ready';
import { REGISTER_SCRIPT, leaveOf } from './script';
import { Answers, Erase, Ticket, withLeave } from './StoryScenes';

// ---------------------------------------------------------------------------------------------
// 1 · «Список кафедры.» — the dot opens on «Новый экзамен»: the department's file goes in, Meldy reads
// the list, and the page moves aside for the words.

const LIST_LEAVE = leaveOf(REGISTER_SCRIPT, 'list');
/** The department's list as the file has it (data/example/questions.ts, questions 1–4 of 12). */
export const LIST_LINES = [
  'Вопросы к экзамену по микроэкономике',
  '1. Спрос. Закон спроса и кривая спроса.',
  '2. Неценовые факторы спроса. Движение вдоль кривой спроса и её сдвиг.',
  '3. Предложение. Закон предложения и факторы предложения.',
  '4. Рыночное равновесие. Дефицит и излишек.',
  '…',
];
const DROP = 1450;

function List() {
  const root = useRef<HTMLDivElement>(null);
  const { one, all } = useEls(root);
  useFrame((l) => {
    place(one('home'), HOME.x - HOME.size / 2, HOME.y - HOME.size / 2, 1 - ease.in(seg(l, 300, 380)));
    opacity(one('home'), 1 - seg(l, 600, 120));

    const aside = ease.inOut(seg(l, 2150, 800));
    const out = ease.in(seg(l, LIST_LEAVE, 520));
    const win = one('win');
    put(
      win,
      'transform',
      `perspective(2600px) translate3d(${(mix(0, 430, aside) - 1100 * out).toFixed(1)}px,${mix(0, 24, aside).toFixed(1)}px,0) rotateY(${mix(0, -18, aside).toFixed(2)}deg) scale(${mix(1, 0.84, aside).toFixed(4)})`,
    );
    put(win, 'filter', `blur(${(16 * (1 - ease.out(seg(l, 250, 800))) + 18 * out).toFixed(2)}px)`);
    opacity(win, clamp(seg(l, 250, 300) * 3) * (1 - clamp((out - 0.5) / 0.5)));

    // The department's file comes in and goes into the field; the list appears in its place.
    const file = one('file');
    if (l < DROP) slideIn(file, l, 700, { dx: -1100, dur: 760, smear: 24 });
    else {
      const drop = ease.in(seg(l, DROP, 260));
      put(file, 'transform', `translate3d(0,${(30 * drop).toFixed(1)}px,0) scale(${mix(1, 0.86, drop).toFixed(4)})`);
      put(file, 'filter', 'none');
      opacity(file, 1 - drop);
    }
    put(one('field'), 'box-shadow', l >= DROP - 250 && l < DROP + 200 ? 'inset 0 0 0 4px #0b121c' : 'inset 0 0 0 2px #e4e4de');
    opacity(one('hint'), 1 - seg(l, DROP - 200, 200));
    all('row').forEach((row, index) => focusRow(row, l, DROP + 220 + index * 70));
    opacity(one('reading'), seg(l, DROP, 150) * (1 - seg(l, 1980, 150)));
    opacity(one('read'), seg(l, 2030, 250));
  });
  return (
    <div ref={root} className="mr-scene">
      <div data-a="win" className="fm-win ar-new" style={{ opacity: 0 }}>
        <div className="ar-new-in">
          <p className="fm-h1 ar-new-h">Новый экзамен</p>
          <p className="ar-new-h2">Вставьте список вопросов</p>
          <p className="ar-new-sub fm-muted">Скопируйте его из файла кафедры как есть — или перетащите сюда сам файл.</p>
          <div data-a="field" className="ar-new-field">
            <span data-a="hint" className="ar-new-hint">
              Вопросы к экзамену
              <br />
              1. Предмет и метод экономической теории.
              <br />…
            </span>
            {LIST_LINES.map((line, index) => (
              <span key={line} data-a="row" className={`ar-new-row${index === 0 ? ' ar-new-row--h' : ''}`} style={{ opacity: 0 }}>
                {line}
              </span>
            ))}
          </div>
          <p className="ar-new-status">
            <span data-a="reading" className="fm-muted" style={{ opacity: 0 }}>
              Распознаём список…
            </span>
            <span data-a="read" style={{ opacity: 0 }}>
              Распознано 12 вопросов
            </span>
          </p>
        </div>
        <div data-a="file" className="fm-file ar-new-file" style={{ opacity: 0 }}>
          <span className="fm-sheet-ico" />
          <span>
            Вопросы к экзамену.docx
            <small>DOCX · от кафедры</small>
          </span>
        </div>
      </div>
      <i data-a="home" className="fm-brand-dot ar-home" style={{ transform: `translate3d(${HOME.x - HOME.size / 2}px,${HOME.y - HOME.size / 2}px,0)` }} />
      <Statement lines={['Список', 'кафедры.']} at={2400} out={LIST_LEAVE} className="ar-say" />
    </div>
  );
}

/** A row of the pasted list: in focus from `at`. */
function focusRow(row: HTMLElement, l: number, at: number) {
  const p = ease.out(seg(l, at, 380));
  opacity(row, clamp(seg(l, at, 380) * 2.5));
  put(row, 'filter', p >= 1 ? 'none' : `blur(${(8 * (1 - p)).toFixed(2)}px)`);
}

function RegisterReady() {
  return <Ready lines={['Начните', 'со списка']} />;
}

export const REGISTER_SCENES = {
  list: List,
  answers: withLeave(Answers, leaveOf(REGISTER_SCRIPT, 'answers')),
  ticket: withLeave(Ticket, leaveOf(REGISTER_SCRIPT, 'ticket')),
  erase: withLeave(Erase, leaveOf(REGISTER_SCRIPT, 'erase')),
  ready: RegisterReady,
};
