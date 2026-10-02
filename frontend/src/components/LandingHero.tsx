import type { MouseEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import PaperHero from './landing/PaperHero';
import { usePrefersReducedMotion } from './landing/usePrefersReducedMotion';
import { ty } from './landing/typo';
import './LandingHero.css';

const HEADLINE = ty('Запомнить лекцию, а не перечитывать её в пятый раз');
const DESCRIPTION = ty('Загрузите лекцию — Meldy подчеркнёт главное, сделает из него карточки и спросит вас о нём завтра.');

export default function LandingHero() {
  const navigate = useNavigate();
  const reduceMotion = usePrefersReducedMotion();

  // The hero scene already shows a card being made, so the secondary action leads to the
  // hands-on example below instead of restarting it.
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
          <h1 id="sf-headline">{HEADLINE}</h1>
          <p className="sf-description">{DESCRIPTION}</p>
          <div className="sf-actions">
            <button type="button" className="sf-primary" onClick={() => navigate('/register')}>Попробовать на своей лекции</button>
            <a className="sf-watch" href="#try" onClick={goToExample}>Пройти пример без регистрации</a>
          </div>
        </div>

        <div className="sf-visual">
          <PaperHero />
        </div>
      </div>
    </section>
  );
}
