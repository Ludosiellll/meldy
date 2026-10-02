import type { MouseEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowDown, ArrowUpRight } from 'lucide-react';
import StudyKitHero, { usePrefersReducedMotion } from './landing/StudyKitHero';
import './LandingHero.css';

export default function LandingHero() {
  const navigate = useNavigate();
  const reduceMotion = usePrefersReducedMotion();

  // The hero visual already plays next to the headline, so the secondary action
  // leads to the hands-on example below instead of restarting it.
  const goToExample = (event: MouseEvent<HTMLAnchorElement>) => {
    const target = document.getElementById('try');
    if (!target) return;
    event.preventDefault();
    target.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' });
  };

  return (
    <section className="sf-hero" aria-labelledby="sf-headline">
      <div className="sf-hero-inner">
        <div className="sf-intro">
          <div className="sf-eyebrow"><span /> ВАШ МАТЕРИАЛ. ВАШ ТЕМП.</div>
          <h1 id="sf-headline">Разобраться.<br />Запомнить.<br />Ответить.</h1>
          <p className="sf-description">
            Загрузите лекцию — Meldy выделит главное и соберёт из неё конспект, карточки, тест, карту понятий и разговор двух ведущих.
            <span className="sf-desc-more"> Проверьте себя и вернитесь к тому, что пока не запомнили.</span>
          </p>
          <div className="sf-actions">
            <button type="button" className="sf-primary" onClick={() => navigate('/register')}>Начать с моей лекции <ArrowUpRight size={19} /></button>
            <a className="sf-watch" href="#try" onClick={goToExample}><ArrowDown size={15} /> Попробовать на примере</a>
          </div>
          <p className="sf-formats">PDF, DOCX, TXT, MD · аудиозаписи</p>
        </div>

        <div className="sf-visual" id="hero-visual">
          <StudyKitHero />
        </div>
      </div>
    </section>
  );
}
