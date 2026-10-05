import { useEffect, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import '@fontsource-variable/onest/wght.css';
import { useAuth } from '../hooks/useAuth';
import HeroMosaic from '../components/home/HeroMosaic';
import { jumpToReel, type ReelChapter } from '../components/home/reelJump';
import { usePrefersReducedMotion } from '../components/landing/usePrefersReducedMotion';
import { ty } from '../components/landing/typo';
import { lazyPart, useLazyPart } from '../lib/lazyPart';
import '../components/home/home.css';

/**
 * The reel is a file of its own, fetched once the page is up. Until it arrives its place holds the
 * same empty frame; the page does not wait for it (a Suspense boundary here held the whole first
 * screen back while the reel was still on its way).
 */
const meldyReelPart = lazyPart(() => import('../components/reel/MeldyReel').then((module) => module.default));

/** The one primary action of the landing; the final call repeats it. */
export const PRIMARY_LABEL = 'Начать со списка вопросов';
export const HEADLINE = 'Сессия начинается со списка вопросов';
/** The second action of the first screen: the example exam (/try), no account needed. */
export const TRY_LABEL = 'Попробовать на примере';

const KINDS = [
  { id: 'exam', label: 'экзамену' },
  { id: 'credit', label: 'зачёту' },
  { id: 'colloquium', label: 'коллоквиуму' },
] as const;
type Kind = (typeof KINDS)[number]['id'];

const FORMATS = ['PDF', 'DOCX', 'TXT', 'MD', 'Аудио'];

/** Questions from the sample course; the tone gives each number a colour. */
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
  { k: 'Потом — реже', big: 'Карточка возвращается всё реже', p: 'Помните — она придёт позже, забыли — снова завтра.' },
  {
    k: 'Готовность',
    big: 'Засчитано дважды, в разные дни',
    p: 'Вопрос готов, когда вы дважды, в разные дни, хорошо на него ответили.',
  },
];

function Arrow() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M5 12h14M13 6l6 6-6 6" />
    </svg>
  );
}

function Pill({ tone, small, onClick, children }: { tone: 'blue' | 'white'; small?: boolean; onClick: () => void; children: ReactNode }) {
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
        <ReelSection />
        <Ticker />
        <HowSection />
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
          <a href="#reel">Ролик</a>
          <a href="#how">Как это работает</a>
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
  const reduce = usePrefersReducedMotion();
  const [kind, setKind] = useState<Kind>('exam');
  const word = KINDS.find((item) => item.id === kind)?.label ?? 'экзамену';
  return (
    <section className="hm-wrap hm-hero" aria-labelledby="hm-hero-h">
      <div>
        <div className="hm-seg hm-rise" role="group" aria-label="К чему готовитесь">
          <span className="hm-seg-l">Готовлюсь к…</span>
          {KINDS.map((item) => (
            <button key={item.id} type="button" aria-pressed={kind === item.id} onClick={() => setKind(item.id)}>
              {item.label}
            </button>
          ))}
        </div>
        <h1 id="hm-hero-h" className="hm-h1 hm-rise hm-d1">
          Сессия начинается со <Mark>списка вопросов</Mark>
        </h1>
        <p className="hm-lead hm-rise hm-d2">
          {ty(
            `Вставьте вопросы к ${word} и загрузите лекции. Meldy покажет, где в лекциях ответ на каждый вопрос и какую долю билетов они закрывают. Потом тяните билет и отвечайте вслух — экзаменатор спросит о том, что вы пропустили.`,
          )}
        </p>
        <div className="hm-acts hm-rise hm-d3">
          <Pill tone="blue" onClick={() => navigate('/register')}>
            {PRIMARY_LABEL}
          </Pill>
          {/* A ready example exam, no account needed (/try): the jury's QR code leads there too. */}
          <Pill tone="white" onClick={() => navigate('/try')}>
            {TRY_LABEL}
          </Pill>
        </div>
        <p className="hm-also hm-rise hm-d3">
          <button type="button" className="hm-more" onClick={() => jumpToReel('oral', !reduce)}>
            Как проходит ответ
            <Arrow />
          </button>
        </p>
        <div className="hm-formats hm-rise hm-d4">
          <span>Лекции</span>
          {FORMATS.map((format) => (
            <b key={format}>{format}</b>
          ))}
        </div>
      </div>
      <HeroMosaic />
    </section>
  );
}

/** «Meldy за 35 секунд»: the motion reel right under the first screen (loaded after it). */
function ReelSection() {
  const navigate = useNavigate();
  const MeldyReel = useLazyPart(meldyReelPart, true, {
    onError: (error) => console.error('Ролик не загрузился:', error),
  });
  return (
    <section id="reel" className="hm-wrap hm-sec" aria-labelledby="reel-heading" style={{ paddingTop: 40 }}>
      <div className="hm-reel-head">
        <h2 id="reel-heading" className="hm-h2">
          Meldy за 35 секунд
        </h2>
        <p className="hm-sub">{ty('От списка вопросов до ответа вслух. Ролик без звука — главы можно листать.')}</p>
      </div>
      {MeldyReel ? <MeldyReel onCta={() => navigate('/register')} /> : <div className="hm-reel-wait" aria-hidden="true" />}
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

function More({ chapter, children }: { chapter: ReelChapter; children?: ReactNode }) {
  const reduce = usePrefersReducedMotion();
  return (
    <button type="button" className="hm-more" onClick={() => jumpToReel(chapter, !reduce)}>
      {children ?? 'Смотреть в ролике'}
      <Arrow />
    </button>
  );
}

function HowSection() {
  const navigate = useNavigate();
  return (
    <section id="how" className="hm-wrap hm-sec" aria-labelledby="how-h">
      <h2 id="how-h" className="hm-h2 hm-reveal">
        От списка вопросов —{' '}
        <br />
        до ответа вслух
      </h2>
      <p className="hm-sub hm-reveal">{ty('Всё по вашим лекциям: Meldy не придумывает ответы, а показывает, где они у вас уже есть.')}</p>
      <div className="hm-grid2">
        <article className="hm-card hm-reveal">
          <div className="hm-panel" aria-hidden="true">
            <div className="hm-dots" />
            <div className="hm-win">
              <div className="hm-win-h">
                <span>Цифровая экономика · 40 вопросов</span>
                <span>сверка с лекциями</span>
              </div>
              {[
                [1, 'Что такое нейронная сеть и из каких слоёв она состоит?', 'ok', 'есть в лекциях'],
                [3, 'Глубина сети и неглубокие сети', 'half', 'частично'],
                [5, 'Метод опорных векторов: ядра и зазор', 'no', 'нет в лекциях'],
                [12, 'Как обучается нейронная сеть?', 'ok', 'есть в лекциях'],
              ].map(([n, text, kind, label]) => (
                <div key={n} className="hm-row">
                  <span className="hm-n">{n}</span>
                  <span className="hm-t">{text}</span>
                  <span className={`hm-st hm-st--${kind}`}>
                    <i />
                    {label}
                  </span>
                </div>
              ))}
            </div>
          </div>
          <div className="hm-card-body">
            <span className="hm-flag hm-flag--g">Билеты</span>
            <h3 className="hm-h3">Где в лекциях ответ на каждый вопрос</h3>
            <p className="hm-p">{ty('Meldy сверяет список кафедры с вашими лекциями: что в них есть, чего нет и какую долю билетов они закрывают.')}</p>
            <More chapter="tickets" />
          </div>
        </article>

        <article className="hm-card hm-reveal">
          <div className="hm-panel hm-panel--warm" aria-hidden="true">
            <div className="hm-dots" />
            <div className="hm-ticket">
              <b>Билет № 12</b>
              <p>
                <i>12</i>Как обучается нейронная сеть?
              </p>
              <p>
                <i>36</i>Кривая Филлипса.
              </p>
            </div>
            <div className="hm-said">…ошибка распространяется назад, и веса сдвигаются…</div>
            <div className="hm-mic">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="9" y="3" width="6" height="11" rx="3" />
                <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
              </svg>
            </div>
          </div>
          <div className="hm-card-body">
            <span className="hm-flag hm-flag--y">Ответ вслух</span>
            <h3 className="hm-h3">Тяните билет и отвечайте вслух</h3>
            <p className="hm-p">{ty('Экзаменатор переспросит о пункте, который вы пропустили. Протокол покажет, что засчитано.')}</p>
            <More chapter="oral" />
          </div>
        </article>

        <article className="hm-card hm-reveal">
          <div className="hm-panel hm-panel--sky" aria-hidden="true">
            <div className="hm-dots" />
            <div className="hm-stack">
              <div className="hm-fc hm-fc--1" />
              <div className="hm-fc hm-fc--2" />
              <div className="hm-fc hm-fc--3">
                Что делает функция активации?
                <small>Пропущено в ответе на билет № 12</small>
                <span className="hm-when">Вернётся завтра</span>
              </div>
            </div>
          </div>
          <div className="hm-card-body">
            <span className="hm-flag hm-flag--b">Повторение</span>
            <h3 className="hm-h3">Что пропустили — вернётся завтра</h3>
            <p className="hm-p">{ty('Пункт, который вы не назвали, становится карточкой. Помните — она придёт позже, забыли — снова завтра.')}</p>
            <More chapter="review" />
          </div>
        </article>

        <article className="hm-card hm-reveal">
          <div className="hm-panel hm-panel--rose" aria-hidden="true">
            <div className="hm-dots" />
            <div className="hm-talk">
              <div className="hm-bub">
                <b>Макс</b>Значит, сеть просто подбирает веса?
              </div>
              <div className="hm-bub hm-bub--r">
                <b>Софья</b>Да: ошибка идёт назад от выходного слоя, и каждый вес чуть сдвигается.
              </div>
            </div>
            <div className="hm-wave">
              {Array.from({ length: 30 }, (_, index) => (
                <i key={index} style={{ animationDelay: `${((index * 0.09) % 1.6).toFixed(2)}s` }} />
              ))}
            </div>
          </div>
          <div className="hm-card-body">
            <span className="hm-flag hm-flag--p">Разговор</span>
            <h3 className="hm-h3">Лекция голосами двух ведущих</h3>
            <p className="hm-p">{ty('Макс и Софья обсуждают лекцию, а на схеме появляются понятия и связи между ними.')}</p>
            <button type="button" className="hm-more" onClick={() => navigate('/register')}>
              Попробовать
              <Arrow />
            </button>
          </div>
        </article>
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
          {ty('Список вопросов кафедры — текстом или файлом. Лекции — PDF, DOCX, PPTX, TXT, MD или аудио, сканы тоже. Списка пока нет — начните с лекции: карточки и тест Meldy сделает и по ней.')}
        </p>
        <div className="hm-acts">
          <Pill tone="white" onClick={() => navigate('/register')}>
            {PRIMARY_LABEL}
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
      <span>Подготовка к экзаменам по вашим лекциям · © {new Date().getFullYear()}</span>
      <a href="#">Наверх</a>
    </footer>
  );
}
