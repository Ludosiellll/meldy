/**
 * Chapter «Группа»: «Пригласить группу» — the link copied and the group filling in; then at 20:00 the bot's day card
 * in Telegram and «Открыть Meldy» opening the Mini App on the day's first question. The bot's words: bot/card.ts
 * planSentence, as the old reel showed them.
 */
import { useRef } from 'react';
import { flag, useEls, useFrame } from '../../reel/engine';
import { EXAMPLE, SAY } from '../../home3/copy3';
import { Count, Say, appear, ease, seg, move } from '../kit3';
import { Cursor, pressAt, usePointer, type CursorKey } from '../pointer3';

const AVATARS = ['А', 'М', 'К', 'Д', 'Е', 'С', 'И', 'Т'];
const TONES = ['#e8effc', '#fcefc9', '#e2f2e5', '#fbe3ec', '#e8effc', '#fcefc9', '#e2f2e5', '#fbe3ec'];

const members = (n: number) => {
  const last = n % 10;
  const word = n % 100 > 10 && n % 100 < 20 ? 'участников' : last === 1 ? 'участник' : last >= 2 && last <= 4 ? 'участника' : 'участников';
  return `В экзамене ${n} ${word}`;
};

/** «Скопировать» under the invite card, then «Открыть Meldy» in the bot's message; the pointer waits beside them. */
export const GROUP_KEYS: readonly CursorKey[] = [
  { t: 600, aim: 'invite', fx: 0.82, fy: 1, dy: 26 },
  { t: 1100, aim: 'copy', press: true },
  { t: 1800, aim: 'invite', fx: 0.82, fy: 1, dy: 26 },
  { t: 2800, hide: true },
  { t: 5100, aim: 'open', press: true },
  { t: 5800, aim: 'phone', fx: 1, fy: 0.78, dx: 28 },
  { t: 6500, hide: true },
];
const COPIED = pressAt(GROUP_KEYS, 'copy');
/** The Mini App comes up as «Открыть Meldy» is let go. */
const OPENED = pressAt(GROUP_KEYS, 'open') + 250;

export function GroupScene() {
  const root = useRef<HTMLDivElement>(null);
  const { one, all } = useEls(root);
  const pointer = usePointer(GROUP_KEYS);
  useFrame((l) => {
    appear(one('invite'), l, 100, 450, 18, 3150);
    flag(one('copy'), 'is-done', l >= COPIED);
    all('av').forEach((av, index) => appear(av, l, 1500 + index * 120, 300, 6));
    const rise = ease.brand(seg(l, 3420, 700));
    // The phone comes up once the invite card has gone from the same place (no half-seen card under it).
    appear(one('phone'), l, 3420, 300, 0);
    move(one('phone'), 0, 80 * (1 - rise));
    appear(one('bubble'), l, 3800, 400, 10);
    appear(one('btns'), l, 4100, 380, 6);
    const app = ease.brand(seg(l, OPENED, 600));
    appear(one('app'), l, OPENED, 200, 0);
    move(one('app'), 0, 200 * (1 - app));
  });
  return (
    <div ref={root} className="r3-scene">
      <Say text={SAY.group[0]} at={300} until={3300} />
      <Say text={SAY.group[1]} at={3550} />
      <div className="r3-ui">
        <div data-a="invite" data-aim="invite" className="r3-card r3-invite" style={{ opacity: 0 }}>
          <p className="r3-h">Пригласить группу</p>
          <p className="r3-meta">По ссылке каждый получит весь экзамен: 4 предмета, 960 вопросов. Прогресс у каждого свой.</p>
          <div className="r3-linkrow">
            <span className="r3-field">…/g/k4Rm7Qx2</span>
            <span data-a="copy" data-aim="copy" data-aim-on="is-done" className="r3-copy">
              <span>Скопировать</span>
              <span>Скопировано</span>
            </span>
          </div>
          <div className="r3-avs">
            {AVATARS.map((letter, index) => (
              <span key={index} data-a="av" style={{ opacity: 0, background: TONES[index] }}>
                {letter}
              </span>
            ))}
            <p className="r3-meta">
              <Count from={1} to={24} at={1500} dur={1300} format={members} />
            </p>
          </div>
        </div>
        <div data-a="phone" data-aim="phone" className="r3-phone" style={{ opacity: 0 }}>
          <div className="r3-phone-in">
            <p className="r3-tg-top">
              <b>Meldy</b>
              <small>бот</small>
            </p>
            <span className="r3-tg-time">20:00</span>
            <p data-a="bubble" className="r3-tg-b" style={{ opacity: 0 }}>
              <b>Сегодня около 45 минут:</b> 60 новых и 30 знакомых.
              <br />
              Осенняя сессия · 6 ноября, через 18 дней.
            </p>
            <div data-a="btns" className="r3-tg-btns" style={{ opacity: 0 }}>
              <span className="r3-tg-btn r3-tg-btn--blue">Начать: 20 вопросов</span>
              <span data-aim="open" className="r3-tg-btn">
                Открыть Meldy
              </span>
            </div>
            <div data-a="app" className="r3-tg-app" style={{ opacity: 0 }}>
              <p className="r3-tg-app-top">
                <b>Meldy</b>
                <small>мини-приложение</small>
              </p>
              <p className="r3-meta">{EXAMPLE.subject} · 1 из 20</p>
              <p className="r3-stem r3-stem--s">{EXAMPLE.testStem}</p>
              {EXAMPLE.testOptions.map((option, index) => (
                <span key={option} className="r3-opt r3-opt--s">
                  <b>{'АБВ'[index]}</b>
                  {option}
                </span>
              ))}
            </div>
          </div>
        </div>
        <Cursor pointer={pointer} />
      </div>
    </div>
  );
}
