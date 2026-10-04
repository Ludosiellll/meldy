import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import '@fontsource-variable/onest/wght.css';
import '@fontsource-variable/literata/opsz.css';
import { useAuth } from '../hooks/useAuth';
import LandingHero, { PRIMARY_LABEL } from '../components/LandingHero';
import InteractiveDemo from '../components/landing/InteractiveDemo';
import LectureDesk from '../components/landing/LectureDesk';
import ScheduleCard from '../components/landing/ScheduleCard';
import TicketAnswer from '../components/landing/TicketAnswer';
import { ty } from '../components/landing/typo';
import '../components/landing/LandingSections.css';

const COPY = {
  tryHeading: ty('Из каждой лекции — ещё и это'),
  tryLead: ty('Та же лекция: конспект со ссылками на источник и вопрос теста.'),
  method: [
    ty('Каждая попытка достать ответ из памяти закрепляет его — даже неудачная, если потом свериться с ответом. Психологи называют это эффектом тестирования.'),
    ty('Поэтому Meldy сначала спрашивает, а ответ показывает потом. И возвращает карточку всё реже: помните — она придёт позже, забыли — снова завтра.'),
    ty('Вопрос засчитывается в готовность, когда вы дважды, в разные дни, хорошо на него ответили.'),
  ],
  finalHeading: ty('Начните со списка вопросов'),
  final: ty('Список вопросов кафедры — текстом или файлом. Лекции — PDF, DOCX, TXT, MD или аудио. Списка пока нет — начните с лекции: карточки и тест Meldy сделает и по ней.'),
};

/** The navbar's anchors, in the order of the sections on the page. */
const NAV_LINKS = [
  { href: '#ticket', label: 'Ответ на билет' },
  { href: '#try', label: 'Пример' },
  { href: '#method', label: 'Подход' },
] as const;

export default function Landing() {
  const navigate = useNavigate();
  const { user } = useAuth();

  useEffect(() => {
    if (user) navigate('/dashboard');
  }, [user, navigate]);

  return (
    <div className="landing-shell lp-root min-h-screen overflow-hidden selection:bg-blue-100 selection:text-slate-950">
      <Navbar />
      <main>
        <LandingHero />
        <TicketSection />
        <TryItSection />
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
    <nav className="landing-nav lp-nav fixed inset-x-0 top-0 z-50" aria-label="Главное меню">
      <div className="lp-nav-in">
        <button type="button" className="lp-wordmark" onClick={() => navigate('/')}>Meldy</button>

        <div className="landing-nav-links lp-nav-links hidden lg:flex">
          {NAV_LINKS.map(link => <a key={link.href} href={link.href}>{link.label}</a>)}
        </div>

        <div className="lp-nav-right">
          <button type="button" className="landing-login lp-login" onClick={() => navigate('/login')}>
            Войти
          </button>
          <button type="button" className="landing-nav-cta sf-nav-cta" onClick={() => navigate('/register')}>
            Попробовать
          </button>
        </div>
      </div>
    </nav>
  );
}

/** «Ответ на билет»: right after the hero, the answer the session ends with. */
function TicketSection() {
  return (
    <section id="ticket" className="lp-section lp-ticket" aria-labelledby="ticket-heading">
      <div className="lp-wrap">
        <TicketAnswer />
      </div>
    </section>
  );
}

/** «Из каждой лекции — ещё и это»: the summary and the quiz, then the conversation and the map. */
function TryItSection() {
  return (
    <section id="try" className="lp-section lp-try" aria-labelledby="try-heading">
      <div className="lp-wrap">
        <h2 id="try-heading" className="lp-h2">{COPY.tryHeading}</h2>
        <div className="lp-try-grid">
          <p className="lp-lead lp-try-lead">{COPY.tryLead}</p>
          <InteractiveDemo />
        </div>
        <LectureDesk />
      </div>
    </section>
  );
}

function MethodSection() {
  return (
    <section id="method" className="lp-section lp-method-section" aria-labelledby="method-heading">
      <div className="lp-wrap lp-method">
        <div className="lp-method-copy">
          <h2 id="method-heading" className="lp-h2">Вспоминать полезнее, чем перечитывать</h2>
          {COPY.method.map(text => <p key={text}>{text}</p>)}
        </div>
        <ScheduleCard />
      </div>
    </section>
  );
}

function FinalCall() {
  const navigate = useNavigate();
  return (
    <section className="lp-section lp-final" aria-labelledby="final-heading">
      <div className="lp-wrap">
        <h2 id="final-heading" className="lp-h2">{COPY.finalHeading}</h2>
        <p className="lp-lead">{COPY.final}</p>
        <button type="button" className="sf-primary lp-final-cta" onClick={() => navigate('/register')}>{PRIMARY_LABEL}</button>
      </div>
    </section>
  );
}

function Footer() {
  return (
    <footer className="landing-footer lp-footer">
      <div className="lp-wrap lp-footer-in">
        <span className="lp-wordmark">Meldy</span>
        <span>© {new Date().getFullYear()}</span>
        <a href="#" className="lp-footer-top">Наверх</a>
      </div>
    </footer>
  );
}
