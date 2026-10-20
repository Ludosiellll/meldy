/**
 * Chapter «Группа»: «Пригласить группу» — the link copied and the group filling in; then at 20:00 the bot's day card
 * in Telegram and «Открыть Meldy» opening the Mini App on the day's first question. The bot's words: bot/card.ts
 * planSentence, as the old reel showed them.
 */
import { useRef } from 'react';
import { flag, useEls, useFrame } from '../../reel/engine';
import { EXAMPLE, SAY } from '../../home3/copy3';
import { Count, Cursor, Say, appear, ease, seg, move } from '../kit3';

const AVATARS = ['А', 'М', 'К', 'Д', 'Е', 'С', 'И', 'Т'];
const TONES = ['#e8effc', '#fcefc9', '#e2f2e5', '#fbe3ec', '#e8effc', '#fcefc9', '#e2f2e5', '#fbe3ec'];

const members = (n: number) => {
  const last = n % 10;
  const word = n % 100 > 10 && n % 100 < 20 ? 'участников' : last === 1 ? 'участник' : last >= 2 && last <= 4 ? 'участника' : 'участников';
  return `В экзамене ${n} ${word}`;
};

export function GroupScene() {
  const root = useRef<HTMLDivElement>(null);
  const { one, all } = useEls(root);
  useFrame((l) => {
    appear(one('invite'), l, 100, 450, 18, 3150);
    flag(one('copy'), 'is-done', l >= 1150);
    all('av').forEach((av, index) => appear(av, l, 1500 + index * 120, 300, 6));
    const rise = ease.brand(seg(l, 3420, 700));
    // The phone comes up once the invite card has gone from the same place (no half-seen card under it).
    appear(one('phone'), l, 3420, 300, 0);
    move(one('phone'), 0, 80 * (1 - rise));
    appear(one('bubble'), l, 3800, 400, 10);
    appear(one('btns'), l, 4100, 380, 6);
    const app = ease.brand(seg(l, 5350, 600));
    appear(one('app'), l, 5350, 200, 0);
    move(one('app'), 0, 200 * (1 - app));
  });
  return (
    <div ref={root} className="r3-scene">
      <Say text={SAY.group[0]} at={300} until={3300} />
      <Say text={SAY.group[1]} at={3550} />
      <div className="r3-ui">
        <div data-a="invite" className="r3-card r3-invite" style={{ opacity: 0 }}>
          <p className="r3-h">Пригласить группу</p>
          <p className="r3-meta">По ссылке каждый получит весь экзамен: 4 предмета, 960 вопросов. Прогресс у каждого свой.</p>
          <div className="r3-linkrow">
            <span className="r3-field">…/g/k4Rm7Qx2</span>
            <span data-a="copy" className="r3-copy">
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
        <div data-a="phone" className="r3-phone" style={{ opacity: 0 }}>
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
              <span className="r3-tg-btn">Открыть Meldy</span>
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
        <Cursor
          keys={[
            { t: 600, x: 250, y: 220 },
            { t: 1000, x: 312, y: 116, press: true },
            { t: 1600, x: 340, y: 250 },
            { t: 4600, x: 300, y: 300 },
            { t: 5050, x: 190, y: 236, press: true },
            { t: 5600, x: 320, y: 300 },
          ]}
          until={6400}
        />
      </div>
    </div>
  );
}
