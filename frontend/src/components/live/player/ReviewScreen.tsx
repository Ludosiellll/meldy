/**
 * «Разбор»: the player's own answers and the keys of this game's played questions (CONTRACT §5: `live_review`, the
 * exam's other keys never).
 */
import type { Review } from '../../../lib/live/types';
import type { PlayerController } from './controller';
import { OPTION_STYLES } from './options';

export interface ReviewScreenProps {
  ctl: PlayerController;
  review: Review | null;
  error: string | null;
  /** Opened from a link (Telegram `r_<game>`): no screen behind it, no way back. */
  standalone: boolean;
  /** Where «Назад» goes: the final («итог») after a podium, the «Игра закончилась» screen after an early end. */
  back: 'final' | 'ended';
}

export function ReviewScreen({ ctl, review, error, standalone, back }: ReviewScreenProps) {
  const right = review ? review.items.filter((i) => i.correct).length : 0;
  return (
    <>
      <div className="lp-page">
        <h1 className="lp-h1">Разбор</h1>
        {review && (
          <p className="lp-sub">
            Верно {right} из {review.items.length}. Ключи&nbsp;— только вопросов этой игры.
          </p>
        )}
        {!review && !error && (
          <p className="lp-sub" role="status">
            Загружаем ваши ответы…
          </p>
        )}
        {error && (
          <p className="lp-error" role="alert">
            {error}
          </p>
        )}
        {review && (
          <ol className="lp-rv-list" style={{ listStyle: 'none', padding: 0 }}>
            {review.items.map((item) => (
              <li key={item.qi} className="lp-rv-item">
                <div className="lp-rv-top">
                  <span>Вопрос {item.qi + 1}</span>
                  <span className="lp-rv-badge" data-ok={item.correct ? 'true' : 'false'}>
                    {item.correct ? 'Верно' : item.choice === null ? 'Без ответа' : 'Неверно'}
                  </span>
                </div>
                <p className="lp-rv-q">{item.text}</p>
                {item.options.map((text, i) => {
                  const key = i === item.key;
                  const mine = i === item.choice;
                  return (
                    <div key={i} className="lp-rv-opt" data-key={key ? 'true' : 'false'} data-mine={mine ? 'true' : 'false'}>
                      <span className="lp-ans__l" aria-hidden="true">
                        {OPTION_STYLES[i]?.letter}
                      </span>
                      <span>
                        <span className="lp-sr">{OPTION_STYLES[i]?.letter}: </span>
                        {text}
                      </span>
                      {(key || mine) && <small>{key && mine ? 'ваш ответ, верный' : key ? 'верный ответ' : 'ваш ответ'}</small>}
                    </div>
                  );
                })}
              </li>
            ))}
          </ol>
        )}
      </div>
      {!standalone && (
        <div className="lp-bar">
          <button type="button" className="lp-btn lp-btn--second" onClick={() => ctl.closeReview()}>
            {back === 'final' ? 'Назад к итогу' : 'Назад'}
          </button>
        </div>
      )}
    </>
  );
}
