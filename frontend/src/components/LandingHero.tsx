import type { MouseEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import PaperHero from './landing/PaperHero';
import { usePrefersReducedMotion } from './landing/usePrefersReducedMotion';
import { ty } from './landing/typo';
import './LandingHero.css';

const HEADLINE = ty('Сессия начинается со списка вопросов');
const DESCRIPTION = ty('Вставьте вопросы к экзамену и загрузите лекции. Meldy покажет, где в лекциях ответ на каждый вопрос, чего в них нет и какую долю билетов они закрывают. Потом тяните билет и отвечайте вслух — экзаменатор спросит о том, что вы пропустили.');
/** The one tactile action of the landing; the final call repeats it. */
export const PRIMARY_LABEL = 'Начать со списка вопросов';
const TICKET_LINK = ty('Как проходит ответ на билет');

export default function LandingHero() {
  const navigate = useNavigate();
  const reduceMotion = usePrefersReducedMotion();

  // The scene shows a card; the secondary action leads to how the answer to a ticket goes.
  const goToTicket = (event: MouseEvent<HTMLAnchorElement>) => {
    const target = document.getElementById('ticket');
    if (!target) return;
    event.preventDefault();
    target.scrollIntoView({ behavior: reduceMotion ? 'instant' : 'smooth', block: 'start' });
  };

  return (
    <section className="sf-hero" aria-labelledby="sf-headline">
      <div className="sf-hero-inner">
        <div className="sf-intro">
          <h1 id="sf-headline">{HEADLINE}</h1>
          <p className="sf-description">{DESCRIPTION}</p>
          <div className="sf-actions">
            <button type="button" className="sf-primary" onClick={() => navigate('/register')}>{PRIMARY_LABEL}</button>
            <a className="sf-watch" href="#ticket" onClick={goToTicket}>{TICKET_LINK}</a>
          </div>
        </div>

        <div className="sf-visual">
          <PaperHero />
        </div>
      </div>
    </section>
  );
}
