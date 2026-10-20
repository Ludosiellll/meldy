/**
 * Chapters «Вопросы кафедры», «План» and «Занятие»: the department's file read into four subjects (question 7 among
 * the oral ones), the plan by days and «Перенести экзамен», and a «занятие» with one right and one wrong answer —
 * the screens' own words (containers/copy.ts, the session's room).
 */
import { useRef } from 'react';
import { flag, opacity, useEls, useFrame } from '../../reel/engine';
import { EXAMPLE, SAY } from '../../home3/copy3';
import { Count, Cursor, Say, appear, ease, seg, move } from '../kit3';

const SUBJECTS = [
  { title: 'Экономика', meta: '240 вопросов · ключ жирным' },
  { title: 'Право', meta: '240 вопросов · ключ в столбце' },
  { title: 'Базы данных', meta: '240 вопросов · ключ из разметки' },
  { title: 'Микроэкономика', meta: '240 устных вопросов' },
];

export function FileScene() {
  const root = useRef<HTMLDivElement>(null);
  const { one, all } = useEls(root);
  useFrame((l) => {
    appear(one('drop'), l, 100, 400, 16);
    const fall = ease.brand(seg(l, 350, 650));
    const chip = one('chip');
    if (chip) {
      move(chip, 0, -90 * (1 - fall));
    }
    appear(chip, l, 350, 250, 0, 1500);
    flag(one('drop'), 'is-over', l >= 700 && l < 1500);
    appear(one('list'), l, 1250, 420, 18);
    all('row').forEach((row, index) => appear(row, l, 1500 + index * 260, 380, 10));
    appear(one('q7'), l, 3500, 420, 8);
    flag(one('oral'), 'is-lit', l >= 3400);
  });
  return (
    <div ref={root} className="r3-scene is-flip">
      <Say text={SAY.file[0]} at={300} until={3000} />
      <Say text={SAY.file[1]} at={3250} />
      <div className="r3-ui">
        <div data-a="drop" className="r3-card r3-drop" style={{ opacity: 0 }}>
          <p className="r3-h">Новый экзамен</p>
          <p className="r3-meta">Перетащите файлы с вопросами. Word, Excel или TXT.</p>
          <span data-a="chip" className="r3-file" style={{ opacity: 0 }}>
            <i>DOCX</i>Вопросы_сессия.docx
          </span>
        </div>
        <div data-a="list" className="r3-card r3-list" style={{ opacity: 0 }}>
          <p className="r3-h r3-h--s">
            Нашли 4 предмета и <Count from={0} to={960} at={1300} dur={1500} /> вопросов
          </p>
          {SUBJECTS.map((subject, index) => (
            <p key={subject.title} data-a="row" data-oral={index === 3 ? '' : undefined} className="r3-row" style={{ opacity: 0 }}>
              <b>{subject.title}</b>
              <span>{subject.meta}</span>
            </p>
          ))}
          <p data-a="q7" className="r3-q7" style={{ opacity: 0 }}>
            <span data-a="oral">7.</span> {EXAMPLE.question}
          </p>
        </div>
      </div>
    </div>
  );
}

const DAYS = [
  { d: 'Пн', n: 19, a: '90', b: '60' },
  { d: 'Вт', n: 20, a: '95', b: '65' },
  { d: 'Ср', n: 21, a: '90', b: '60' },
  { d: 'Чт', n: 22, a: '95', b: '65' },
  { d: 'Пт', n: 23, a: '90', b: '60' },
  { d: 'Сб', n: 24, a: '60', b: '45' },
  { d: 'Вс', n: 25, a: '—', b: '—' },
];
const MOVED = 3950;

export function PlanScene() {
  const root = useRef<HTMLDivElement>(null);
  const { one, all } = useEls(root);
  useFrame((l) => {
    appear(one('card'), l, 100, 450, 20);
    all('day').forEach((day, index) => appear(day, l, 450 + index * 90, 380, 12));
    appear(one('today'), l, 1300, 380, 8);
    appear(one('move'), l, 1500, 380, 0);
    appear(one('menu'), l, 3300, 260, -6, 4150);
    flag(one('two'), 'is-hover', l >= 3650 && l < 4150);
    // The old dates and counts go, then the new ones come: never both half-seen in one place.
    const gone = ease.inOut(seg(l, MOVED, 220));
    const come = ease.inOut(seg(l, MOVED + 220, 280));
    all('was').forEach((el) => opacity(el, 1 - gone));
    all('now').forEach((el) => opacity(el, come));
    flag(one('card'), 'is-moved', l >= MOVED + 250);
  });
  return (
    <div ref={root} className="r3-scene">
      <Say text={SAY.plan[0]} at={300} until={3300} />
      <Say text={SAY.plan[1]} at={3550} />
      <div className="r3-ui">
        <div data-a="card" className="r3-card r3-plan" style={{ opacity: 0 }}>
          <p className="r3-h">Осенняя сессия</p>
          <p className="r3-meta r3-swap">
            <span data-a="was">Экзамен 6 ноября · через 18 дней</span>
            <span data-a="now" style={{ opacity: 0 }}>
              Экзамен 20 ноября · через 32 дня
            </span>
          </p>
          <span data-a="move" className="r3-link r3-plan-move" style={{ opacity: 0 }}>
            Перенести экзамен
          </span>
          <div className="r3-days">
            {DAYS.map((day, index) => (
              <span key={day.d} data-a="day" className={`r3-day${index === 0 ? ' is-today' : ''}${index === 6 ? ' is-off' : ''}`} style={{ opacity: 0 }}>
                <small>{day.d}</small>
                <small>{day.n}</small>
                <b className="r3-swap">
                  <span data-a="was">{day.a}</span>
                  <span data-a="now" style={{ opacity: 0 }}>
                    {day.b}
                  </span>
                </b>
              </span>
            ))}
          </div>
          <div data-a="today" className="r3-today" style={{ opacity: 0 }}>
            <p className="r3-swap">
              <span data-a="was">
                Сегодня <b>90 вопросов</b>, около 45 минут
              </span>
              <span data-a="now" style={{ opacity: 0 }}>
                Сегодня <b>60 вопросов</b>, около 30 минут
              </span>
            </p>
            <span className="r3-btn">Начать: 20 вопросов</span>
          </div>
          <div data-a="menu" className="r3-menu" style={{ opacity: 0 }}>
            <span>На неделю</span>
            <span data-a="two">На 2 недели</span>
            <span>Другая дата</span>
          </div>
        </div>
        <Cursor
          keys={[
            { t: 2500, x: 300, y: 300 },
            { t: 3150, x: 318, y: 26, press: true },
            { t: 3750, x: 282, y: 96, press: true },
            { t: 4500, x: 330, y: 290 },
          ]}
          until={5600}
        />
      </div>
    </div>
  );
}

const Q2 = {
  stem: 'Что относится к постоянным издержкам фирмы?',
  options: ['Оплата сырья', 'Аренда помещения', 'Сдельная оплата труда'],
};

export function SessionScene() {
  const root = useRef<HTMLDivElement>(null);
  const { one } = useEls(root);
  useFrame((l) => {
    appear(one('top'), l, 100, 350, 8);
    appear(one('card'), l, 150, 450, 20);
    appear(one('q1'), l, 350, 350, 6, 3900);
    appear(one('q2'), l, 4180, 380, 10);
    flag(one('right1'), 'is-right', l >= 1850);
    appear(one('ok1'), l, 1900, 300, 6, 3900);
    flag(one('wrong2'), 'is-wrong', l >= 5050);
    flag(one('key2'), 'is-right', l >= 5050);
    appear(one('no2'), l, 5100, 300, 6);
    appear(one('score'), l, 600, 400, 10);
    flag(one('score'), 'is-up', l >= 2500 && l < 3400);
  });
  return (
    <div ref={root} className="r3-scene is-flip">
      <Say text={SAY.session[0]} at={300} until={2700} />
      <Say text={SAY.session[1]} at={2950} />
      <div className="r3-ui">
        <p data-a="top" className="r3-sess-top" style={{ opacity: 0 }}>
          <span>Микроэкономика · 7 из 20</span>
          <span>Закончить</span>
        </p>
        <div data-a="card" className="r3-card r3-sess" style={{ opacity: 0 }}>
          <div data-a="q1" className="r3-sess-q" style={{ opacity: 0 }}>
            <p className="r3-stem">{EXAMPLE.testStem}</p>
            {EXAMPLE.testOptions.map((option, index) => (
              <span key={option} data-a={index === EXAMPLE.testRight ? 'right1' : undefined} className="r3-opt r3-opt--row">
                <b>{'АБВ'[index]}</b>
                <span>
                  {option}
                  {index === EXAMPLE.testRight ? <small>Ваш ответ</small> : null}
                </span>
              </span>
            ))}
            <p data-a="ok1" className="r3-note" style={{ opacity: 0 }}>
              Верно.
            </p>
          </div>
          <div data-a="q2" className="r3-sess-q" style={{ opacity: 0 }}>
            <p className="r3-stem">{Q2.stem}</p>
            {Q2.options.map((option, index) => (
              <span key={option} data-a={index === 0 ? 'wrong2' : index === 1 ? 'key2' : undefined} className="r3-opt r3-opt--row">
                <b>{'АБВ'[index]}</b>
                <span>
                  {option}
                  {index === 0 ? <small>Ваш ответ</small> : index === 1 ? <small>В файле</small> : null}
                </span>
              </span>
            ))}
            <p data-a="no2" className="r3-note" style={{ opacity: 0 }}>
              Неверно. В файле — Аренда помещения. Вернётся через пару вопросов и в понедельник.
            </p>
          </div>
        </div>
        <p data-a="score" className="r3-score" style={{ opacity: 0 }}>
          <b>
            <Count from={146} to={147} at={2500} dur={300} />
          </b>
          <span>из 960 верно в два разных дня</span>
        </p>
        <Cursor
          keys={[
            { t: 1150, x: 320, y: 318 },
            { t: 1650, x: 200, y: 196, press: true },
            { t: 2300, x: 330, y: 312 },
            { t: 4600, x: 300, y: 300 },
            { t: 4900, x: 160, y: 150, press: true },
            { t: 5600, x: 330, y: 320 },
          ]}
          until={6200}
        />
      </div>
    </div>
  );
}
