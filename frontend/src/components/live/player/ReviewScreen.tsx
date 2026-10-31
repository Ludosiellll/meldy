/**
 * «Разбор»: the player's own answers and the keys of this game's played questions (CONTRACT §5: `live_review`, the
 * exam's other keys never). A battle's movement round (`stand`, docs/live/MODE_MIXED.md) says so: the answer there is
 * the zone the player stood in («вы стояли тут»). A question of several right answers marks every right option and the
 * own ticks («частично» for a share); a text question shows what was typed and what is accepted, a number question
 * the number typed and the right one with its tolerance and unit (20261102090100_live_numbers.sql); the author's
 * explanation comes under the question (release 47; 20261102090000_live_kinds_teams.sql).
 *
 * «Тренировать ошибки» (CONTRACT §14): the mistakes go to the exam's plan through `live_practice` — a member of the
 * exam (or one the game's quiz offers practice to) gets them back in «Повторить ошибки». A guest is asked to sign in
 * first and comes back to this review (`/play?r=<game>&practice=1`: the token stays in this tab), where it runs again.
 */
import { numberAnswer, typedText } from '../../../lib/live/numbers';
import { questionKind, rightKeys, type Review, type ReviewItem } from '../../../lib/live/types';
import type { PlayerController, PracticeView } from './controller';
import { plural } from './copy';
import { OPTION_STYLES } from './options';

export interface ReviewScreenProps {
  ctl: PlayerController;
  review: Review | null;
  error: string | null;
  /** Opened from a link (Telegram `r_<game>`): no screen behind it, no way back. */
  standalone: boolean;
  /** Where «Назад» goes: the final («итог») after a podium, the «Игра закончилась» screen after an early end. */
  back: 'final' | 'ended';
  /** «Тренировать ошибки»: its state (absent: not offered on this screen). */
  practice?: PracticeView;
  /** The sign-in page with the way back to this review (web), or null where there is none (Telegram). */
  signInHref?: string | null;
}

const PRACTICE = {
  title: 'Тренировать ошибки',
  note: (n: number) => `${n} ${plural(n, 'вопрос вернётся', 'вопроса вернутся', 'вопросов вернутся')} в тренировку экзамена. Meldy будет повторять их, пока вы не запомните.`,
  go: 'Тренировать ошибки',
  busy: 'Сохраняем…',
  done: (n: number) => `Готово: ${n} ${plural(n, 'вопрос', 'вопроса', 'вопросов')} в тренировке экзамена.`,
  open: 'Открыть экзамен',
  signIn: 'Ошибки сохраняются в аккаунте. Войдите, и они вернутся в тренировку.',
  signInGo: 'Войти и тренировать',
  register: 'Создать аккаунт',
  telegram: 'Тренировать ошибки можно на сайте Meldy: играйте там со входом в аккаунт.',
  none: 'Ошибок нет: все ответы верные.',
};

function badge(item: ReviewItem): string {
  if (item.correct) return 'Верно';
  const typedKind = questionKind(item) === 'short' || questionKind(item) === 'number';
  const none = typedKind ? !item.typed : questionKind(item) === 'multiple' ? !(item.picks?.length || item.choice !== null) : item.choice === null;
  if (none) return item.stand ? 'Не встали на ответ' : 'Без ответа';
  if (questionKind(item) === 'multiple' && (item.share ?? 0) > 0) return 'Частично';
  return 'Неверно';
}

function Options({ item }: { item: ReviewItem }) {
  const keys = rightKeys(item);
  const mine = item.picks ?? (item.choice !== null ? [item.choice] : []);
  return (
    <>
      {item.options.map((text, i) => {
        const key = keys.includes(i);
        const own = mine.includes(i);
        return (
          <div key={i} className="lp-rv-opt" data-key={key ? 'true' : 'false'} data-mine={own ? 'true' : 'false'}>
            <span className="lp-ans__l" aria-hidden="true">
              {OPTION_STYLES[i]?.letter}
            </span>
            <span>
              <span className="lp-sr">{OPTION_STYLES[i]?.letter}: </span>
              {text}
            </span>
            {(key || own) && <small>{key && own ? (item.stand ? 'вы стояли тут, верно' : 'ваш ответ, верный') : key ? 'верный ответ' : item.stand ? 'вы стояли тут' : 'ваш ответ'}</small>}
          </div>
        );
      })}
    </>
  );
}

function TextAnswer({ item }: { item: ReviewItem }) {
  return (
    <>
      <div className="lp-rv-opt" data-key={item.correct ? 'true' : 'false'} data-mine="true">
        <span>{item.typed ? `Вы написали: «${item.typed}»` : 'Вы ничего не написали'}</span>
        {item.typed ? <small>{item.correct ? 'верно' : 'неверно'}</small> : null}
      </div>
      {!item.correct && item.forms && item.forms.length > 0 ? (
        <div className="lp-rv-opt" data-key="true" data-mine="false">
          <span>Верный ответ: {item.forms.join(', ')}</span>
        </div>
      ) : null}
    </>
  );
}

function NumberAnswer({ item }: { item: ReviewItem }) {
  const unit = item.unit ?? null;
  return (
    <>
      <div className="lp-rv-opt" data-key={item.correct ? 'true' : 'false'} data-mine="true">
        <span>{item.typed ? `Вы ввели: ${typedText(item.typed, unit)}` : 'Вы ничего не ввели'}</span>
        {item.typed ? <small>{item.correct ? 'верно' : 'неверно'}</small> : null}
      </div>
      {!item.correct && item.forms && item.forms.length > 0 ? (
        <div className="lp-rv-opt" data-key="true" data-mine="false">
          <span>Верный ответ: {numberAnswer(item.forms, item.tolerance, unit)}</span>
        </div>
      ) : null}
    </>
  );
}

export function ReviewScreen({ ctl, review, error, standalone, back, practice, signInHref }: ReviewScreenProps) {
  const right = review ? review.items.filter((i) => i.correct).length : 0;
  const mistakes = review ? review.items.length - right : 0;
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
                  <span>
                    Вопрос {item.qi + 1}
                    {item.stand ? <span className="lp-rv-mini">Мини-игра</span> : null}
                    {questionKind(item) === 'multiple' && !item.stand ? <span className="lp-rv-mini">Несколько верных</span> : null}
                  </span>
                  <span className="lp-rv-badge" data-ok={item.correct ? 'true' : 'false'}>
                    {badge(item)}
                  </span>
                </div>
                <p className="lp-rv-q">{item.text}</p>
                {questionKind(item) === 'short' ? <TextAnswer item={item} /> : questionKind(item) === 'number' ? <NumberAnswer item={item} /> : <Options item={item} />}
                {item.explanation ? (
                  <div className="lp-rv-explain">
                    <b>Пояснение</b>
                    <p>{item.explanation}</p>
                  </div>
                ) : null}
              </li>
            ))}
          </ol>
        )}
        {review && practice ? (
          <section className="lp-card lp-rv-practice" aria-label={PRACTICE.title}>
            <h2>{PRACTICE.title}</h2>
            {mistakes === 0 ? (
              <p>{PRACTICE.none}</p>
            ) : practice.status === 'done' ? (
              <>
                <p role="status">{PRACTICE.done(practice.saved)}</p>
                <a className="lp-btn lp-btn--main" href={`/exams/c/${practice.containerId}`}>
                  {PRACTICE.open}
                </a>
              </>
            ) : practice.status === 'signin' ? (
              signInHref ? (
                <>
                  <p>{PRACTICE.signIn}</p>
                  <a className="lp-btn lp-btn--main" href={signInHref}>
                    {PRACTICE.signInGo}
                  </a>
                </>
              ) : (
                <p>{PRACTICE.telegram}</p>
              )
            ) : (
              <>
                <p>{PRACTICE.note(mistakes)}</p>
                {practice.status === 'refused' && practice.text ? (
                  <p className="lp-error" role="alert">
                    {practice.text}
                  </p>
                ) : null}
                <button type="button" className="lp-btn lp-btn--main" disabled={practice.status === 'busy'} onClick={() => void ctl.practiceMistakes()}>
                  {practice.status === 'busy' ? PRACTICE.busy : PRACTICE.go}
                </button>
              </>
            )}
          </section>
        ) : null}
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
