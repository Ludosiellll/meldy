import { Check } from 'lucide-react';
import './authStory.css';

/**
 * The white windows of the sign-in panels, alive while the page is open (owner, 2026-10-04: «анимаций
 * нет никаких постоянных во время нахождения на этой странице, регистрация тем более»).
 *
 * Sign-in: three scenes loop over 12 s, one per step — a lecture file uploads, a marker underlines
 * the main line and a fragment-linked note slides out, a card flips and gets «Помню»; the step under
 * the scene lights up with a filling bar. Sign-up: the four parts of the plan tick one by one, the bar
 * fills, the header becomes «План готов».
 *
 * CSS only (authStory.css): every moving part shares one cycle and is phased by a negative delay, so
 * nothing drifts out of step and there is no timer to clean up. The lists stay real lists for screen
 * readers; the scenes are decoration (aria-hidden). With reduced motion the scenes are hidden and the
 * steps read as a plain list; the plan shows every part ticked.
 */

const STEPS = [
  { title: 'Загрузите материал', text: 'PDF, DOCX, текст, изображение или запись лекции.' },
  { title: 'Разберите главное', text: 'Конспект со ссылками на исходные фрагменты.' },
  { title: 'Проверьте себя', text: 'Карточки и короткий тест по теме.' },
] as const;

export function LoginStory() {
  return (
    <div className="au-deck as-deck">
      <div className="au-win as-win" data-story="login">
        <div className="as-stage" aria-hidden="true">
          <div className="as-scene as-s1">
            <div className="as-file">
              <span className="as-file-icon">
                <i />
                <i />
                <i />
              </span>
              <span className="as-file-body">
                <span className="as-file-name">Лекция 4. Эластичность.pdf</span>
                <span className="as-file-bar">
                  <i />
                </span>
              </span>
              <span className="as-file-ok">
                <Check />
              </span>
            </div>
          </div>
          <div className="as-scene as-s2">
            <div className="as-sheet">
              <span className="as-sheet-h" />
              <span className="as-line" />
              <span className="as-line as-line--key">
                <i className="as-marker" />
              </span>
              <span className="as-line as-line--short" />
              <span className="as-line" />
            </div>
            <div className="as-slip">
              <span className="as-slip-line" />
              <span className="as-slip-line as-slip-line--short" />
              <span className="as-chip">фрагмент 3</span>
            </div>
          </div>
          <div className="as-scene as-s3">
            <div className="as-card">
              <div className="as-card-face as-card-front">Когда спрос эластичен?</div>
              <div className="as-card-face as-card-back">Объём меняется сильнее цены</div>
            </div>
            <span className="as-recall">
              <Check />
              Помню
            </span>
          </div>
        </div>
        <ol className="as-steps">
          {STEPS.map((step, index) => (
            <li key={step.title} className="as-step" style={{ ['--i' as string]: index }}>
              <span className="as-step-n" aria-hidden="true">
                {index + 1}
              </span>
              <span className="as-step-t">{step.title}</span>
              <span className="as-step-d">{step.text}</span>
              <span className="as-step-bar" aria-hidden="true">
                <i />
              </span>
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}

const PLAN = ['Конспект с привязкой к источнику', 'Карточки для активного повторения', 'Тест для проверки понимания', 'История материалов и прогресса'] as const;

export function RegisterStory() {
  return (
    <div className="au-deck as-deck">
      <div className="au-win as-win" data-story="register">
        <div className="as-plan-head" aria-hidden="true">
          <span className="as-plan-title">
            <span className="as-plan-t1">План подготовки</span>
            <span className="as-plan-t2">План готов</span>
          </span>
          <span className="as-plan-count">
            {PLAN.map((_, index) => (
              <span key={index} className="as-plan-n" style={{ ['--i' as string]: index }}>
                {index + 1} из {PLAN.length}
              </span>
            ))}
          </span>
        </div>
        <span className="as-plan-bar" aria-hidden="true">
          <i />
        </span>
        <ul className="as-plan">
          {PLAN.map((item, index) => (
            <li key={item} className="as-plan-item" style={{ ['--i' as string]: index }}>
              <span className="as-tick" aria-hidden="true">
                <svg viewBox="0 0 24 24">
                  <path d="M6 12.5l4 4 8-9" />
                </svg>
              </span>
              <span className="as-plan-text">{item}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
