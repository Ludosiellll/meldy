import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import '@fontsource-variable/onest/wght.css';
import '@fontsource-variable/literata/opsz.css';
import { useAuth } from '../hooks/useAuth';
import LandingHero from '../components/LandingHero';
import InteractiveDemo from '../components/landing/InteractiveDemo';
import LectureDesk from '../components/landing/LectureDesk';
import ScheduleCard from '../components/landing/ScheduleCard';
import { ty } from '../components/landing/typo';
import '../components/landing/LandingSections.css';

const COPY = {
  tryLead: ty('Та же лекция: конспект со ссылками на источник и вопрос теста.'),
  method: [
    ty('Каждая попытка достать ответ из памяти закрепляет его — даже неудачная, если потом свериться с ответом. Психологи называют это эффектом тестирования.'),
    ty('Поэтому Meldy сначала спрашивает, а ответ показывает потом. И возвращает карточку всё реже: помните — она придёт позже, забыли — снова завтра.'),
  ],
  formats: ty('PDF, DOCX, TXT, MD или аудиозапись лекции.'),
};

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
        <TryItSection />
        <OutputsSection />
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
          <a href="#try">Пример</a>
          <a href="#possibilities">Возможности</a>
          <a href="#method">Подход</a>
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

function TryItSection() {
  return (
    <section id="try" className="lp-section lp-try" aria-labelledby="try-heading">
      <div className="lp-wrap lp-try-grid">
        <div className="lp-try-intro">
          <h2 id="try-heading" className="lp-h2">Ваша очередь</h2>
          <p className="lp-lead">{COPY.tryLead}</p>
        </div>
        <InteractiveDemo />
      </div>
    </section>
  );
}

function OutputsSection() {
  return (
    <section id="possibilities" className="lp-section lp-outputs" aria-labelledby="possibilities-heading">
      <div className="lp-wrap">
        <h2 id="possibilities-heading" className="lp-h2">{ty('Что ещё получится из этой лекции')}</h2>
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
        <h2 id="final-heading" className="lp-h2">Начните со своей лекции</h2>
        <p className="lp-lead">{COPY.formats}</p>
        <button type="button" className="sf-primary lp-final-cta" onClick={() => navigate('/register')}>Попробовать на своей лекции</button>
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
