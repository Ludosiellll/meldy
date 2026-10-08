import { useEffect, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import '@fontsource-variable/onest/wght.css';
import { useAuth } from '../hooks/useAuth';
import HeroSheet, { SHEET_REPLAY_EVENT } from '../components/home/HeroSheet';
import { SheetText } from '../components/exams/sheet/SheetText';
import { jumpToReel, type ReelChapter } from '../components/home/reelJump';
import { usePrefersReducedMotion } from '../components/landing/usePrefersReducedMotion';
import { ty } from '../components/landing/typo';
import { lazyPart, useLazyPart } from '../lib/lazyPart';
import '../components/home/home.css';
import { TELEMETRY_NOTE } from '../lib/telemetry';

/**
 * The reel is a file of its own, fetched once the page is up. Until it arrives its place holds the
 * same empty frame; the page does not wait for it (a Suspense boundary here held the whole first
 * screen back while the reel was still on its way).
 */
const meldyReelPart = lazyPart(() => import('../components/reel/MeldyReel').then((module) => module.default));

export { EYEBROW, HEADLINE, TRY_LABEL } from '../components/home/landingCopy';
import { EYEBROW, HEADLINE, TRY_LABEL } from '../components/home/landingCopy';

export const LEAD =
  'Вставьте список вопросов кафедры и загрузите свои лекции. Meldy сверит с ними каждый вопрос, спросит билет вслух и переспросит о том, что вы пропустили.';
/** Sign-up, to start with one's own list of questions; the final call repeats it. */
export const START_LABEL = 'Начать со своего списка';
/** The honest result (Ф1): Meldy gives no mark, in the words of the answer's protocol. */
export const RESULT_TITLE = 'Отметку ставит преподаватель';
export const RESULT_NOTE = 'Meldy проверяет только, назвали ли вы пункты из своих лекций.';

/** «Как это работает», in the order of the promise: the list, the lectures, the ticket aloud, the sheet. */
export const STEPS: ReadonlyArray<{ flag: string; title: string; text: string; panel: 'blue' | 'warm' | 'sky' | 'rose'; color: 'sky' | 'yellow' | 'green' | 'pink' }> = [
  {
    flag: 'Список кафедры',
    title: 'Вопросы — из списка вашей кафедры',
    text: 'Вставьте список как есть — текстом или файлом: DOCX, PDF, TXT, MD, сканы тоже. Meldy найдёт вопросы, разделы и билеты.',
    panel: 'blue',
    color: 'sky',
  },
  {
    flag: 'Ваши лекции',
    title: 'Ответы — цитатами из ваших лекций',
    text: 'Каждый вопрос Meldy сверяет с лекциями и показывает цитату с ответом. Чего в лекциях нет, так и помечено.',
    panel: 'warm',
    color: 'yellow',
  },
  {
    flag: 'Ответ вслух',
    title: 'Билет — вслух, с переспросом',
    text: 'Тяните билет и отвечайте голосом или текстом — готовый текст не вставить. Экзаменатор переспросит о пункте, который вы пропустили.',
    panel: 'sky',
    color: 'green',
  },
  {
    flag: 'Шпаргалка',
    title: 'Строки стирают только ответы в разные дни',
    text: 'Кнопки «знаю» нет. Назвали пункт — строка стёрлась наполовину, назвали снова в другой день — совсем, не назвали потом — вернулась.',
    panel: 'rose',
    color: 'pink',
  },
];

/** Questions from sample courses; the tone gives each number a colour. */
const QUESTIONS: Array<{ n: number; text: string; tone?: 'y' | 'g' | 'p' }> = [
  { n: 1, text: 'Что такое нейронная сеть и из каких слоёв она состоит?' },
  { n: 12, text: 'Как обучается нейронная сеть?', tone: 'y' },
  { n: 21, text: 'Денежный рынок и его инструменты', tone: 'g' },
  { n: 25, text: 'Денежный мультипликатор', tone: 'p' },
  { n: 31, text: 'Ключевая ставка ЦБ и её влияние на инфляцию' },
  { n: 34, text: 'Инфляция: виды и причины', tone: 'y' },
  { n: 36, text: 'Кривая Филлипса', tone: 'g' },
  { n: 9, text: 'Переобучение и способы борьбы с ним', tone: 'p' },
];

const METHOD = [
  {
    k: 'Сначала вопрос',
    big: 'Каждая попытка вспомнить закрепляет ответ',
    p: 'Даже неудачная — если потом свериться с ответом. Психологи называют это эффектом тестирования.',
  },
  {
    k: 'Потом — реже',
    big: 'Стёртая строка проступает всё реже',
    p: 'Через 5\u00a0дней она проступает: пора проверить. Назвали — следующая проверка через 12\u00a0дней, потом через 25 и\u00a050.',
  },
  {
    k: 'Разные дни',
    big: 'Одного удачного ответа мало',
    p: 'Поэтому строка стирается, только когда вы назвали пункт в два разных дня, не раньше чем через 20\u00a0часов.',
  },
];

function Arrow() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M5 12h14M13 6l6 6-6 6" />
    </svg>
  );
}

function Pill({ tone, small, onClick, children }: { tone: 'blue' | 'white' | 'ghost'; small?: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" className={`hm-pill hm-pill--${tone}${small ? ' hm-pill--sm' : ''}`} onClick={onClick}>
      {children}
      {small ? null : (
        <span className="hm-dot">
          <Arrow />
        </span>
      )}
    </button>
  );
}

/** The yellow hand-drawn line under a phrase. */
function Mark({ children, path = 'M4 15 C 80 7, 170 5, 250 9 S 360 16, 396 8' }: { children: ReactNode; path?: string }) {
  return (
    <span className="hm-mark">
      {children}
      <svg viewBox="0 0 400 24" preserveAspectRatio="none" aria-hidden="true">
        <path pathLength={1} d={path} />
      </svg>
    </span>
  );
}

export default function Landing() {
  const navigate = useNavigate();
  const { user } = useAuth();

  useEffect(() => {
    if (user) navigate('/dashboard');
  }, [user, navigate]);

  return (
    <div className="hm">
      <Navbar />
      <main>
        <Hero />
        <HowSection />
        <ResultAndGroup />
        <ReelSection />
        <Ticker />
        <MethodSection />
        <FinalCall />
      </main>
      <Footer />
    </div>
  );
}

function Navbar() {
  const navigate = useNavigate();
  return (
    <header className="hm-nav">
      <nav className="hm-wrap hm-nav-in" aria-label="Главное меню">
        <button type="button" className="hm-logo" onClick={() => navigate('/')}>
          Meldy
        </button>
        <div className="hm-links">
          <a href="#how">Как это работает</a>
          <a href="#reel">Ролик</a>
          <a href="#method">Подход</a>
        </div>
        <div className="hm-end">
          <Pill tone="white" small onClick={() => navigate('/login')}>
            Войти
          </Pill>
          <Pill tone="blue" small onClick={() => navigate('/register')}>
            Начать
          </Pill>
        </div>
      </nav>
    </header>
  );
}

function Hero() {
  const navigate = useNavigate();
  // The hand-drawn line goes under «спрашивает»; ty() keeps a short word off a line's end («за | вас»).
  const [before, after] = HEADLINE.split('спрашивает');
  return (
    <section className="hm-wrap hm-hero" aria-labelledby="hm-hero-h">
      <div className="hm-hero-text">
        <p className="hm-eyebrow hm-rise">{ty(EYEBROW)}</p>
        <h1 id="hm-hero-h" className="hm-h1 hm-rise hm-d1">
          {ty(before)}
          <Mark path="M4 14 C 90 6, 190 6, 280 10 S 370 15, 396 9">спрашивает</Mark>
          {after}
        </h1>
        <p className="hm-lead hm-rise hm-d2">{ty(LEAD)}</p>
        <div className="hm-acts hm-rise hm-d3">
          {/* A ready example exam, no account needed (/try): the jury's QR code leads there too. */}
          <Pill tone="blue" onClick={() => navigate('/try')}>
            {TRY_LABEL}
          </Pill>
          <Pill tone="white" onClick={() => navigate('/register')}>
            {START_LABEL}
          </Pill>
        </div>
        <p className="hm-also hm-rise hm-d3">Пример открывается без регистрации.</p>
      </div>
      <div className="hm-hero-sheet hm-rise hm-d2">
        <HeroSheet />
      </div>
    </section>
  );
}

function More({ chapter, children }: { chapter: ReelChapter; children?: ReactNode }) {
  const reduce = usePrefersReducedMotion();
  return (
    <button type="button" className="hm-more" onClick={() => jumpToReel(chapter, !reduce)}>
      {children ?? 'Смотреть в ролике'}
      <Arrow />
    </button>
  );
}

/** The pictures of the four steps: things of the app, always light (they are pictures of it). */
function StepArt({ index }: { index: number }) {
  switch (index) {
    case 0:
      return (
        <div className="hm-doc">
          <p className="hm-doc-h">Вопросы к экзамену по микроэкономике</p>
          {[
            'Спрос. Закон спроса и кривая спроса.',
            'Неценовые факторы спроса. Движение вдоль кривой спроса и её сдвиг.',
            'Предложение. Закон предложения и факторы предложения.',
            'Рыночное равновесие. Дефицит и излишек.',
          ].map((text, n) => (
            <p key={text} className="hm-doc-r">
              <b>{n + 1}.</b> {text}
            </p>
          ))}
        </div>
      );
    case 1:
      return (
        <div className="hm-quote">
          <p className="hm-quote-q">
            <span>7. Эластичность спроса и выручка продавца</span>
            <span className="hm-st hm-st--ok">
              <i />
              есть в лекциях
            </span>
          </p>
          <blockquote>«Если спрос эластичный, снижение цены увеличивает выручку»</blockquote>
          <p className="hm-quote-src">Лекция «Эластичность спроса» · фрагмент 5</p>
        </div>
      );
    case 2:
      return (
        <>
          <div className="hm-ticket">
            <b>Билет</b>
            <p>7. Эластичность спроса и выручка продавца.</p>
          </div>
          <div className="hm-ask">
            <b>Экзаменатор</b>А если спрос неэластичный, как продавцу увеличить выручку?
          </div>
          <div className="hm-mic">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="9" y="3" width="6" height="11" rx="3" />
              <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
            </svg>
          </div>
        </>
      );
    default:
      return (
        <div className="hm-mini">
          {(
            [
              ['цена ниже равновесной → дефицит', 'erased', '•'],
              ['цена выше равновесной → излишек', 'rubbed', '•'],
              ['цена сама → равновесие', 'fresh', '–'],
            ] as const
          ).map(([text, state, bullet]) => (
            <p key={text} className="hm-mini-l" data-state={state}>
              <span className="hm-mini-b">{bullet}</span>
              <span className="hm-mini-t">
                <SheetText text={text} seedBase={`landing:step:${text}`} />
              </span>
            </p>
          ))}
          <span className="hm-eraser" />
        </div>
      );
  }
}

/** Back to the first screen's sheet, and the answer plays on it again. */
function ShowOnSheet() {
  const reduce = usePrefersReducedMotion();
  const show = () => {
    document.querySelector('.hs')?.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'center' });
    window.dispatchEvent(new CustomEvent(SHEET_REPLAY_EVENT));
  };
  return (
    <button type="button" className="hm-more" onClick={show}>
      Показать на шпаргалке
      <Arrow />
    </button>
  );
}

function HowSection() {
  const navigate = useNavigate();
  return (
    <section id="how" className="hm-wrap hm-sec" aria-labelledby="how-h">
      <h2 id="how-h" className="hm-h2 hm-reveal">
        Как это работает
      </h2>
      <p className="hm-sub hm-reveal">{ty('Цель — пустая шпаргалка: на листе остаются только вопросы кафедры.')}</p>
      <ol className="hm-steps">
        {STEPS.map((step, index) => (
          <li key={step.flag} className="hm-step hm-reveal">
            <div className={`hm-panel hm-panel--${step.panel}`} aria-hidden="true">
              <div className="hm-dots" />
              <StepArt index={index} />
            </div>
            <div className="hm-card-body">
              <span className={`hm-flag hm-flag--${step.color}`}>
                <b>{index + 1}</b>
                {step.flag}
              </span>
              <h3 className="hm-h3">{ty(step.title)}</h3>
              <p className="hm-p">{ty(step.text)}</p>
              {index === 0 && <More chapter="tickets" />}
              {index === 1 && (
                <button type="button" className="hm-more" onClick={() => navigate('/try')}>
                  Открыть пример
                  <Arrow />
                </button>
              )}
              {index === 2 && <More chapter="oral" />}
              {index === 3 && <ShowOnSheet />}
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}

/** The honest result and the group link: two things a newcomer asks about next. */
function ResultAndGroup() {
  return (
    <section className="hm-wrap hm-duo" aria-label="Итог и группа">
      <article className="hm-card hm-reveal" aria-labelledby="result-h">
        <div className="hm-panel hm-panel--green" aria-hidden="true">
          <div className="hm-dots" />
          <div className="hm-proto">
            <span className="hm-proto-tag">Пример</span>
            <p className="hm-proto-l">Назвали сами 3 из 4 главных · после вопроса 1</p>
            <p className="hm-proto-s">На шпаргалке: 1 строка стёрлась, 2 — наполовину</p>
          </div>
        </div>
        <div className="hm-card-body">
          <span className="hm-flag hm-flag--green">Итог ответа</span>
          <h2 id="result-h" className="hm-h3">
            {RESULT_TITLE}
          </h2>
          <p className="hm-p">{ty(`${RESULT_NOTE} Итог ответа — сколько главных пунктов вы назвали сами и сколько после вопроса экзаменатора.`)}</p>
        </div>
      </article>
      <article className="hm-card hm-reveal" aria-labelledby="group-h">
        <div className="hm-panel hm-panel--blue" aria-hidden="true">
          <div className="hm-dots" />
          <div className="hm-chat">
            <p>
              Готовимся к экзамену «Микроэкономика» в Meldy. По ссылке у каждого будет своя копия: вопросы, лекции и шпаргалка с пунктами
              ответа.
            </p>
            <span className="hm-chat-link">…/join/…</span>
          </div>
        </div>
        <div className="hm-card-body">
          <span className="hm-flag hm-flag--sky">Группа</span>
          <h2 id="group-h" className="hm-h3">
            Одна ссылка на всю группу
          </h2>
          <p className="hm-p">
            {ty('Соберите экзамен один раз и отправьте ссылку в беседу группы. У каждого будет своя копия: вопросы, лекции и шпаргалка. Ответы каждого видит только он сам.')}
          </p>
        </div>
      </article>
    </section>
  );
}

/** «Meldy за 48 секунд»: the motion reel (loaded after the first screen). Its end leads to the example, as the hero's first button does. */
function ReelSection() {
  const navigate = useNavigate();
  const MeldyReel = useLazyPart(meldyReelPart, true, {
    onError: (error) => console.error('Ролик не загрузился:', error),
  });
  return (
    <section id="reel" className="hm-wrap hm-sec" aria-labelledby="reel-heading">
      <div className="hm-reel-head">
        <h2 id="reel-heading" className="hm-h2">
          Meldy за 48 секунд
        </h2>
        <p className="hm-sub">{ty('От списка вопросов до пустой шпаргалки. Ролик без звука — главы можно листать.')}</p>
      </div>
      {MeldyReel ? <MeldyReel onCta={() => navigate('/try')} /> : <div className="hm-reel-wait" aria-hidden="true" />}
    </section>
  );
}

function Ticker() {
  const reduce = usePrefersReducedMotion();
  // The track holds the list twice so the loop is seamless; the copy is hidden from readers.
  const items = reduce ? QUESTIONS : [...QUESTIONS, ...QUESTIONS];
  return (
    <section className="hm-ticker" aria-label="Примеры вопросов">
      <p className="hm-ticker-cap">Вопросы, с которых начинается сессия</p>
      <div className="hm-marquee">
        <ul className="hm-track">
          {items.map((question, index) => (
            <li key={index} className={`hm-q${question.tone ? ` hm-q--${question.tone}` : ''}`} aria-hidden={index >= QUESTIONS.length ? true : undefined}>
              <i>{question.n}</i>
              {question.text}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

function MethodSection() {
  return (
    <section id="method" className="hm-wrap hm-sec" aria-labelledby="method-heading">
      <h2 id="method-heading" className="hm-h2 hm-reveal">
        <Mark path="M4 14 C 90 6, 190 6, 280 10 S 370 15, 396 9">Вспоминать</Mark> полезнее,{' '}
        <br />
        чем перечитывать
      </h2>
      <div className="hm-grid3">
        {METHOD.map((item) => (
          <div key={item.k} className="hm-tint hm-reveal">
            <span className="hm-tint-k">{item.k}</span>
            <p className="hm-tint-big">{ty(item.big)}</p>
            <p className="hm-p">{ty(item.p)}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

function FinalCall() {
  const navigate = useNavigate();
  return (
    <section id="start" className="hm-wrap" aria-labelledby="final-heading">
      <div className="hm-final hm-reveal">
        <svg className="hm-final-art" viewBox="0 0 520 520" aria-hidden="true">
          <defs>
            <pattern id="hm-f-dw" width="9" height="9" patternUnits="userSpaceOnUse">
              <circle cx="4.5" cy="4.5" r="2" fill="#A9C8F7" />
            </pattern>
            <radialGradient id="hm-f-g" cx="0.5" cy="0.5" r="0.5">
              <stop offset="0" stopColor="#FFFFFF" />
              <stop offset="1" stopColor="#000000" />
            </radialGradient>
            <mask id="hm-f-m">
              <rect width="520" height="520" fill="url(#hm-f-g)" />
            </mask>
          </defs>
          <circle cx="260" cy="260" r="250" fill="url(#hm-f-dw)" mask="url(#hm-f-m)" opacity="0.7" />
          <circle cx="330" cy="200" r="70" fill="#F4C45B" />
          <circle cx="210" cy="330" r="46" fill="#F3A9C4" />
          <circle cx="380" cy="350" r="26" fill="#FFFFFF" opacity="0.9" />
        </svg>
        <h2 id="final-heading" className="hm-h2">
          Начните со списка вопросов
        </h2>
        <p className="hm-lead">
          {ty('Список кафедры — текстом или файлом, лекции — файлами или текстом. Хотите сначала посмотреть — откройте готовый пример, без регистрации.')}
        </p>
        <div className="hm-acts">
          <Pill tone="white" onClick={() => navigate('/register')}>
            {START_LABEL}
          </Pill>
          <Pill tone="ghost" onClick={() => navigate('/try')}>
            {TRY_LABEL}
          </Pill>
        </div>
      </div>
    </section>
  );
}

function Footer() {
  return (
    <footer className="hm-wrap hm-foot">
      <a className="hm-logo" href="#" aria-label="Meldy, наверх">
        Meldy
      </a>
      <span>Тренажёр устного экзамена по билетам кафедры · © {new Date().getFullYear()}</span>
      <a href="#">Наверх</a>
      <p className="hm-foot-note">{ty(TELEMETRY_NOTE)}</p>
    </footer>
  );
}
