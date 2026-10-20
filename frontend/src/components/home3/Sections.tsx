/**
 * The landing v3's sections after the first screen, in the reel's order: the lecture, the exam (file, plan, session,
 * ticket aloud, cheat sheet), the group and Telegram. The pictures are Meldy's own screens drawn small and light in
 * both themes (they are pictures of the app); the plan and the session answer to a press.
 */
import { useState, type ReactNode } from 'react';
import { Q7 } from '../../data/sheetExample';
import { EXAMPLE, EXAM_SECTION, GROUP_SECTION, LECTURE_SECTION, bind } from './copy3';
import { withGlyphs } from './glyphs';

export function SectionHead({ id, title, text, children }: { id: string; title: string; text: string; children?: ReactNode }) {
  return (
    <div className="p3-head">
      <h2 id={id} className="p3-h2">
        {bind(title)}
      </h2>
      <p className="p3-text">{bind(text)}</p>
      {children}
    </div>
  );
}

const PANELS: ReactNode[] = [
  <div key="sum" className="p3-panel">
    <p className="p3-sum-h">1. Что такое эластичность</p>
    <p className="p3-sum">На сколько процентов изменится спрос, если цена изменится на 1 %.</p>
    <p className="p3-sum-h">2. Эластичность и выручка</p>
    <p className="p3-quote">
      <span>{EXAMPLE.quoteAt}</span>
      {EXAMPLE.quote}
    </p>
  </div>,
  <div key="short" className="p3-panel">
    <p className="p3-sum">
      Эластичность показывает, как спрос отвечает на цену. От неё зависит, поднимать цену или снижать, чтобы выручка росла.
    </p>
  </div>,
  <div key="test" className="p3-panel">
    <p className="p3-meta">Вопрос 1 из 5</p>
    <p className="p3-stem">{EXAMPLE.testStem}</p>
    {EXAMPLE.testOptions.map((option, index) => (
      <span key={option} className="p3-opt">
        <b>{'АБВ'[index]}</b>
        {option}
      </span>
    ))}
  </div>,
  <div key="cards" className="p3-panel">
    <div className="p3-flash">
      <p className="p3-meta">Карточка 3 из 6</p>
      <p className="p3-stem">Как связаны эластичность и выручка?</p>
      <span className="p3-flash-acts">
        <span className="p3-mini">Не помню</span>
        <span className="p3-mini">Знаю</span>
      </span>
    </div>
  </div>,
  <div key="talk" className="p3-panel">
    <p className="p3-bubble">Как меняется выручка, если спрос эластичный и цену снизили?</p>
    <p className="p3-bubble p3-bubble--me">Выручка растёт: количество растёт сильнее, чем падает цена.</p>
    <span className="p3-voice">
      <span className="p3-mic" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="9" y="3" width="6" height="11" rx="3" />
          <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
        </svg>
      </span>
      Разговор голосом по этой лекции
    </span>
  </div>,
];

export function LectureSection() {
  const [tab, setTab] = useState(0);
  return (
    <section id="lecture" className="h3-wrap p3-sec p3-split" aria-labelledby="lecture-h">
      <SectionHead id="lecture-h" title={LECTURE_SECTION.title} text={LECTURE_SECTION.text} />
      <div className="p3-pic">
        <p className="p3-meta">{EXAMPLE.lectureMeta}</p>
        <p className="p3-pic-h">{EXAMPLE.lecture}</p>
        <div className="p3-tabs" role="tablist" aria-label="Материалы лекции">
          {LECTURE_SECTION.tabs.map((label, index) => (
            <button
              key={label}
              type="button"
              role="tab"
              aria-selected={tab === index}
              className={`p3-tab${tab === index ? ' is-on' : ''}`}
              onClick={() => setTab(index)}
            >
              {label}
              {index === 2 ? <em>5</em> : index === 3 ? <em>6</em> : null}
            </button>
          ))}
        </div>
        <div role="tabpanel" className="p3-panels">
          {PANELS[tab]}
        </div>
      </div>
    </section>
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

function PlanPicture() {
  const [moved, setMoved] = useState(false);
  return (
    <div className="p3-pic p3-plan">
      <p className="p3-pic-h">Осенняя сессия</p>
      <p className="p3-meta" aria-live="polite">
        {moved ? 'Экзамен 20 ноября · через 32 дня' : 'Экзамен 6 ноября · через 18 дней'}
      </p>
      <div className="p3-days">
        {DAYS.map((day, index) => (
          <span key={day.d} className={`p3-day${index === 0 ? ' is-today' : ''}${index === 6 ? ' is-off' : ''}`}>
            <small>
              {day.d} {day.n}
            </small>
            <b>{moved ? day.b : day.a}</b>
          </span>
        ))}
      </div>
      <p className="p3-today">
        Сегодня <b>{moved ? '60 вопросов' : '90 вопросов'}</b>, {moved ? 'около 30 минут' : 'около 45 минут'}
      </p>
      <button type="button" className="p3-action" onClick={() => setMoved((value) => !value)}>
        {moved ? EXAM_SECTION.plan.back : EXAM_SECTION.plan.move}
      </button>
    </div>
  );
}

const WRONG = `Неверно. В файле — ${EXAMPLE.testOptions[EXAMPLE.testRight]}. Вернётся через пару вопросов и в понедельник.`;
const SESSION_REPLY = [WRONG, 'Верно.', WRONG];

function SessionPicture() {
  const [picked, setPicked] = useState<number | null>(null);
  const [score, setScore] = useState(146);
  const pick = (index: number) => {
    if (picked !== null) return;
    setPicked(index);
    if (index === EXAMPLE.testRight) setScore(147);
  };
  return (
    <div className="p3-pic p3-session">
      <p className="p3-meta p3-row">
        <span>Микроэкономика · 7 из 20</span>
        <span>Закончить</span>
      </p>
      <p className="p3-stem">{EXAMPLE.testStem}</p>
      <div className="p3-opts">
        {EXAMPLE.testOptions.map((option, index) => {
          const state = picked === null ? '' : index === EXAMPLE.testRight ? ' is-right' : index === picked ? ' is-wrong' : '';
          return (
            <button key={option} type="button" className={`p3-opt p3-opt--btn${state}`} onClick={() => pick(index)} disabled={picked !== null && index !== picked && index !== EXAMPLE.testRight}>
              <b>{'АБВ'[index]}</b>
              {option}
            </button>
          );
        })}
      </div>
      <p className="p3-note" aria-live="polite">
        {picked === null ? 'Нажмите ответ.' : SESSION_REPLY[picked]}
      </p>
      <p className="p3-score">
        <b>{score}</b> из 960 верно в два разных дня
      </p>
      {picked !== null ? (
        <button type="button" className="p3-textbtn" onClick={() => setPicked(null)}>
          Ещё раз
        </button>
      ) : null}
    </div>
  );
}

const SUBJECTS = [
  { title: 'Экономика', meta: '240 вопросов · ключ жирным' },
  { title: 'Право', meta: '240 вопросов · ключ в столбце' },
  { title: 'Базы данных', meta: '240 вопросов · ключ из разметки' },
  { title: 'Микроэкономика', meta: '240 устных вопросов' },
];

const LINE_STATE = ['gone', 'once', 'fresh', 'once'] as const;

export function ExamSection() {
  return (
    <section id="exam" className="h3-wrap p3-sec" aria-labelledby="exam-h">
      <SectionHead id="exam-h" title={EXAM_SECTION.title} text={EXAM_SECTION.text} />
      <div className="p3-grid">
        <article className="p3-card">
          <h3 className="p3-h3">{EXAM_SECTION.file.title}</h3>
          <p className="p3-p">{bind(EXAM_SECTION.file.text)}</p>
          <div className="p3-pic">
            <p className="p3-pic-h p3-pic-h--s">Нашли 4 предмета и 960 вопросов</p>
            {SUBJECTS.map((subject) => (
              <p key={subject.title} className="p3-line">
                <b>{subject.title}</b>
                <span>{subject.meta}</span>
              </p>
            ))}
          </div>
        </article>
        <article className="p3-card">
          <h3 className="p3-h3">{EXAM_SECTION.plan.title}</h3>
          <p className="p3-p">{bind(EXAM_SECTION.plan.text)}</p>
          <PlanPicture />
        </article>
        <article className="p3-card">
          <h3 className="p3-h3">{EXAM_SECTION.session.title}</h3>
          <p className="p3-p">{bind(EXAM_SECTION.session.text)}</p>
          <SessionPicture />
        </article>
        <article className="p3-card p3-card--wide">
          <div>
            <h3 className="p3-h3">{EXAM_SECTION.ticket.title}</h3>
            <p className="p3-p">{bind(EXAM_SECTION.ticket.text)}</p>
          </div>
          <div className="p3-pic p3-ticket">
            <span className="p3-flag">Билет 7</span>
            <p className="p3-stem">{EXAMPLE.question}</p>
            {Q7.lines.map((line, index) => (
              <p key={line.text} className={`p3-pt${index === 2 ? ' is-after' : ' is-ok'}`}>
                <i />
                {withGlyphs(line.text)}
              </p>
            ))}
            <p className="p3-ask">
              <b>Экзаменатор</b>
              {EXAMPLE.examinerAsk}
            </p>
            <p className="p3-proto">{EXAMPLE.protocol}</p>
          </div>
        </article>
        <article className="p3-card">
          <h3 className="p3-h3">{EXAM_SECTION.sheet.title}</h3>
          <p className="p3-p">{bind(EXAM_SECTION.sheet.text)}</p>
          <div className="p3-pic">
            <p className="p3-sheet-count">
              <b>739</b> строк осталось из 898
            </p>
            <p className="p3-stem">7. {EXAMPLE.question}</p>
            {Q7.lines.map((line, index) => (
              <p key={line.text} className={`p3-sl is-${LINE_STATE[index]}`}>
                <i />
                <span>{withGlyphs(line.text)}</span>
              </p>
            ))}
          </div>
        </article>
      </div>
    </section>
  );
}

export function GroupSection() {
  return (
    <section className="h3-wrap p3-sec p3-split" aria-labelledby="group-h">
      <SectionHead id="group-h" title={GROUP_SECTION.title} text={GROUP_SECTION.text} />
      <div className="p3-duo">
        <div className="p3-pic">
          <p className="p3-pic-h p3-pic-h--s">Пригласить группу</p>
          <p className="p3-meta">По ссылке каждый получит весь экзамен: 4 предмета, 960 вопросов. Прогресс у каждого свой.</p>
          <p className="p3-field">
            <span>…/g/k4Rm7Qx2</span>
            <b>Скопировать</b>
          </p>
          <p className="p3-meta">В экзамене 24 участника</p>
        </div>
        <div className="p3-phone" aria-hidden="true">
          <div className="p3-phone-in">
            <p className="p3-tg-top">
              <b>Meldy</b>
              <small>бот</small>
            </p>
            <span className="p3-tg-time">20:00</span>
            <p className="p3-tg-b">
              <b>Сегодня около 45 минут:</b> 60 новых и 30 знакомых.
              <br />
              Осенняя сессия · 6 ноября, через 18 дней.
            </p>
            <span className="p3-tg-btn p3-tg-btn--blue">Начать: 20 вопросов</span>
            <span className="p3-tg-btn">Открыть Meldy</span>
          </div>
        </div>
      </div>
    </section>
  );
}
