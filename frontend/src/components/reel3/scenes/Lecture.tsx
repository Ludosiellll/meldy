/**
 * Chapter «Лекция» (0–7 s): the lecture is read («Разбираю лекцию…»), then its five materials one after another —
 * «Конспект» with the quote that answers question 7, «Выжимка», «Тест», «Карточки» and «Поговорить о лекции».
 */
import { useRef } from 'react';
import { flag, put, useEls, useFrame } from '../../reel/engine';
import { EXAMPLE, SAY } from '../../home3/copy3';
import { Say, Wave, appear, ease, seg } from '../kit3';

const TABS = [
  { label: 'Конспект', at: 1500 },
  { label: 'Выжимка', at: 3000, count: '' },
  { label: 'Тест', at: 3900, count: '5' },
  { label: 'Карточки', at: 4800, count: '6' },
  { label: 'Поговорить о лекции', at: 5700 },
] as const;

export function LectureScene() {
  const root = useRef<HTMLDivElement>(null);
  const { one, all } = useEls(root);
  useFrame((l) => {
    appear(one('card'), l, 150, 520, 26);
    appear(one('status'), l, 400, 300, 0, 1500);
    put(one('fill'), 'transform', `scaleX(${ease.inOut(seg(l, 450, 1000)).toFixed(3)})`);
    appear(one('tabs'), l, 1500, 400, 8);
    all('tab').forEach((tab, index) => {
      const next = TABS[index + 1];
      flag(tab, 'is-on', l >= TABS[index].at && (!next || l < next.at));
    });
    all('panel').forEach((panel, index) => {
      const next = TABS[index + 1];
      appear(panel, l, index === 0 ? TABS[0].at + 80 : TABS[index].at + 200, 380, 10, next ? next.at : undefined);
    });
    flag(one('quote'), 'is-lit', l >= 2100);
    const flip = ease.inOut(seg(l, 5150, 420));
    put(one('front'), 'transform', `rotateY(${Math.round(flip * 180)}deg)`);
    put(one('back'), 'transform', `rotateY(${Math.round(flip * 180 - 180)}deg)`);
  });
  return (
    <div ref={root} className="r3-scene">
      <Say text={SAY.lecture[0]} at={300} until={2900} />
      <Say text={SAY.lecture[1]} at={3150} />
      <div className="r3-ui">
        <div data-a="card" className="r3-card r3-lec" style={{ opacity: 0 }}>
          <p className="r3-meta">{EXAMPLE.lectureMeta}</p>
          <p className="r3-h">{EXAMPLE.lecture}</p>
          <div data-a="status" className="r3-lec-status" style={{ opacity: 0 }}>
            <span>Разбираю лекцию…</span>
            <i className="r3-bar">
              <b data-a="fill" />
            </i>
          </div>
          <div data-a="tabs" className="r3-tabs" style={{ opacity: 0 }}>
            {TABS.map((tab) => (
              <span key={tab.label} data-a="tab" className="r3-tab">
                {tab.label}
                {'count' in tab && tab.count ? <em>{tab.count}</em> : null}
              </span>
            ))}
          </div>
          <div className="r3-lec-panels">
            <div data-a="panel" className="r3-panel" style={{ opacity: 0 }}>
              <p className="r3-sum-h">1. Что такое эластичность</p>
              <p className="r3-sum">На сколько процентов изменится спрос, если цена изменится на 1 %.</p>
              <p className="r3-sum-h">2. Эластичность и выручка</p>
              <p data-a="quote" className="r3-quote">
                <span>{EXAMPLE.quoteAt}</span>
                {EXAMPLE.quote}
              </p>
            </div>
            <div data-a="panel" className="r3-panel" style={{ opacity: 0 }}>
              <p className="r3-sum">
                Эластичность показывает, как спрос отвечает на цену. От неё зависит, поднимать цену или снижать, чтобы выручка росла.
              </p>
            </div>
            <div data-a="panel" className="r3-panel" style={{ opacity: 0 }}>
              <p className="r3-meta">Вопрос 1 из 5</p>
              <p className="r3-stem">{EXAMPLE.testStem}</p>
              <div className="r3-opts">
                {EXAMPLE.testOptions.map((option, index) => (
                  <span key={option} className="r3-opt">
                    <b>{'АБВ'[index]}</b>
                    {option}
                  </span>
                ))}
              </div>
            </div>
            <div data-a="panel" className="r3-panel r3-flash-wrap" style={{ opacity: 0 }}>
              <div data-a="front" className="r3-flash">
                <p className="r3-meta">Карточка 3 из 6</p>
                <p className="r3-stem">Как связаны эластичность и выручка?</p>
              </div>
              <div data-a="back" className="r3-flash r3-flash--back">
                <p className="r3-sum">Эластичный спрос: снижение цены увеличивает выручку. Неэластичный: повышение.</p>
                <span className="r3-flash-acts">
                  <span className="r3-mini">Не помню</span>
                  <span className="r3-mini">Знаю</span>
                </span>
              </div>
            </div>
            <div data-a="panel" className="r3-panel" style={{ opacity: 0 }}>
              <div className="r3-talk">
                <p>Как меняется выручка, если спрос эластичный и цену снизили?</p>
              </div>
              <div className="r3-voice">
                <span className="r3-mic">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <rect x="9" y="3" width="6" height="11" rx="3" />
                    <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
                  </svg>
                </span>
                <Wave at={6000} until={7000} bars={16} />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
