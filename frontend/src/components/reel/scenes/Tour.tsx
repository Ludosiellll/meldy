import { useRef } from 'react';
import { blur, flag, opacity, put, useEls, useFrame } from '../engine';
import { Kinetic, Pill, Status } from '../parts';
import { ease, mix, seg } from '../timeline';

const LINKS = ['Сегодня', 'Экзамены', 'Библиотека', 'Повторение', 'Прогресс'];

/** Which link is lit when: the tour goes Сегодня → Повторение → Экзамены. */
const STOPS = [
  { at: 380, link: 0, page: 0 },
  { at: 1000, link: 3, page: 1 },
  { at: 1650, link: 1, page: 2 },
];
const MOVE = 450;

/**
 * 4 · Inside the app. The wordmark has landed in the top bar; the bar's pill runs over the sections
 * and the pages change under it, then the camera dives into the exam sheet.
 */
export default function Tour() {
  const root = useRef<HTMLDivElement>(null);
  const { one, all } = useEls(root);

  useFrame((l) => {
    const ready = l >= 250 ? 1 : 0;
    opacity(one('bg'), ready);
    opacity(one('logo'), ready);

    // Bar: links and the avatar arrive one after another.
    all('link').forEach((link, index) => {
      const p = ease.brand(seg(l, 120 + index * 50, 600));
      put(link, 'transform', `translate3d(0,${mix(18, 0, p).toFixed(2)}px,0)`);
      opacity(link, p);
    });
    const me = one('me');
    opacity(me, ease.brand(seg(l, 400, 500)));

    // The lit pill: from stop to stop, stretching to the next link's width.
    const links = all('link');
    const hl = one('hl');
    let from = STOPS[0];
    let to = STOPS[0];
    let move = 1;
    for (let i = 0; i < STOPS.length; i += 1) {
      if (l >= STOPS[i].at) {
        from = STOPS[Math.max(0, i - 1)];
        to = STOPS[i];
        move = i === 0 ? 1 : ease.brand(seg(l, STOPS[i].at, MOVE));
      }
    }
    const a = links[from.link];
    const b = links[to.link];
    if (hl && a && b) {
      const left = mix(a.offsetLeft, b.offsetLeft, move);
      const width = mix(a.offsetWidth, b.offsetWidth, move);
      const stretch = 1 + 0.18 * Math.sin(Math.PI * move) * (from.link === to.link ? 0 : 1);
      put(hl, 'transform', `translate3d(${left.toFixed(1)}px,0,0)`);
      put(hl, 'width', `${(width * stretch).toFixed(1)}px`);
      opacity(hl, ease.brand(seg(l, STOPS[0].at, 300)));
      links.forEach((link, index) => flag(link, 'is-on', l >= STOPS[0].at + 120 && index === (move < 0.5 ? from.link : to.link)));
    }

    // Pages: each one rises in block by block and slides away when the next comes.
    all('page').forEach((page, index) => {
      const stop = STOPS[index];
      const enter = index === 0 ? 250 : stop.at + 150;
      const next = STOPS[index + 1];
      const leave = next ? ease.in(seg(l, next.at, 210)) : 0;
      put(page, 'transform', `translate3d(${(-110 * leave).toFixed(1)}px,0,0)`);
      blur(page, leave * 12);
      opacity(page, l >= enter - 10 ? 1 - leave : 0);
      all(`b${index}`).forEach((block, order) => {
        const p = ease.brand(seg(l, enter + order * 65, 620));
        const fromSide = index === 0 ? 0 : 90;
        put(block, 'transform', `translate3d(${mix(fromSide, 0, p).toFixed(1)}px,${mix(index === 0 ? 40 : 0, 0, p).toFixed(1)}px,0)`);
        opacity(block, p);
        blur(block, (1 - p) * 10);
      });
    });

    // The dive: the camera rushes into the exam sheet.
    const dive = ease.in(seg(l, 1960, 400));
    const cam = one('cam');
    put(cam, 'transform', `scale(${mix(1, 2.8, dive).toFixed(3)})`);
    blur(cam, dive * 16);
    opacity(cam, 1 - seg(l, 2250, 150));
  });

  return (
    <div ref={root} className="mr-scene">
      <div data-a="bg" className="mr-layer mr-bg-light" />
      <div data-a="cam" className="mr-layer" style={{ transformOrigin: '543px 730px' }}>
        <div className="mr-tour-nav">
          <span data-a="logo" className="mr-wordmark mr-tour-logo">
            <Kinetic text="Meldy" at={-100000} unit="letter" variant="zoom" />
            <span className="mr-wordmark-dot" />
          </span>
          <div className="mr-tour-links">
            <span data-a="hl" className="mr-tour-hl" />
            {LINKS.map((link) => (
              <span key={link} data-a="link" className="mr-tour-link">
                {link}
              </span>
            ))}
          </div>
          <span data-a="me" className="mr-tour-me">
            А
          </span>
        </div>

        <div className="mr-tour-page">
          <div data-a="page" className="mr-layer">
            <div data-a="b0" className="mr-tour-title">
              Сегодня
            </div>
            <div data-a="b0" className="mr-tour-sub">
              Три дела до экзамена по микроэкономике
            </div>
            <div className="mr-tour-row">
              <div data-a="b0" className="mr-panel">
                <div className="mr-halftone" />
                <div className="mr-win">
                  {[
                    ['Повторить 12 карточек', 'ok'],
                    ['Ответить билет 7 вслух', 'half'],
                    ['Добавить лекцию 9', 'no'],
                  ].map(([title, kind], index) => (
                    <div key={title} className="mr-row">
                      <span className="mr-num">{index + 1}</span>
                      <span className="mr-row-t">{title}</span>
                      <Status kind={kind as 'ok' | 'half' | 'no'} />
                    </div>
                  ))}
                </div>
              </div>
              <div style={{ display: 'grid', gridTemplateRows: '1fr 1fr', gap: 30, height: 560 }}>
                <div data-a="b0" className="mr-skel">
                  <div style={{ fontSize: 22, color: 'var(--muted)' }}>Микроэкономика</div>
                  <div style={{ marginTop: 12, fontSize: 64, fontWeight: 600, letterSpacing: '-0.035em' }}>24 из 40</div>
                  <div style={{ marginTop: 6, fontSize: 22, color: 'var(--muted)' }}>вопросов есть в лекциях</div>
                  <div style={{ marginTop: 22, height: 14, borderRadius: 7, background: '#ecece6', overflow: 'hidden' }}>
                    <div style={{ width: '60%', height: '100%', background: 'var(--blue)', borderRadius: 7 }} />
                  </div>
                </div>
                <div data-a="b0" className="mr-skel">
                  <div style={{ fontSize: 22, color: 'var(--muted)' }}>Экзамен</div>
                  <div style={{ marginTop: 12, fontSize: 64, fontWeight: 600, letterSpacing: '-0.035em' }}>через 12 дней</div>
                  <span className="mr-bar" style={{ width: '72%', marginTop: 24 }} />
                  <span className="mr-bar" style={{ width: '48%' }} />
                </div>
              </div>
            </div>
          </div>

          <div data-a="page" className="mr-layer">
            <div data-a="b1" className="mr-tour-title">
              Повторение
            </div>
            <div data-a="b1" className="mr-tour-sub">
              12 карточек на сегодня
            </div>
            <div className="mr-tour-row">
              <div data-a="b1" className="mr-panel mr-panel--sky">
                <div className="mr-halftone" />
                {[-8, 6, -1].map((turn, index) => (
                  <div
                    key={turn}
                    className="mr-mini"
                    style={{
                      position: 'absolute',
                      left: '50%',
                      top: '50%',
                      width: 520,
                      height: 300,
                      margin: '-150px 0 0 -260px',
                      background: index === 0 ? '#EAF1FD' : index === 1 ? '#FDF3D8' : '#fff',
                      border: 0,
                      borderRadius: 32,
                      boxShadow: '0 24px 50px -26px rgba(0,0,0,.45)',
                      transform: `rotate(${turn}deg) translate(${index === 0 ? -30 : index === 1 ? 28 : 0}px, 6px)`,
                      fontSize: 38,
                      fontWeight: 600,
                      padding: '40px 42px',
                    }}
                  >
                    {index === 2 ? 'Когда спрос эластичен?' : ''}
                    {index === 2 ? <small style={{ fontSize: 22, marginTop: 18 }}>Микроэкономика · лекция 2</small> : null}
                  </div>
                ))}
              </div>
              <div data-a="b1" className="mr-skel" style={{ height: 560 }}>
                {[
                  ['Завтра', '5'],
                  ['Через 3 дня', '7'],
                  ['Через неделю', '9'],
                ].map(([day, count]) => (
                  <div key={day} className="mr-row" style={{ padding: '26px 0' }}>
                    <span className="mr-row-t" style={{ fontSize: 28, fontWeight: 500 }}>
                      {day}
                    </span>
                    <span className="mr-num" style={{ width: 52, height: 52, fontSize: 22 }}>
                      {count}
                    </span>
                  </div>
                ))}
                <span className="mr-bar" style={{ width: '64%', marginTop: 26 }} />
                <span className="mr-bar" style={{ width: '40%' }} />
              </div>
            </div>
          </div>

          <div data-a="page" className="mr-layer">
            <div data-a="b2" className="mr-tour-title">
              Экзамены
            </div>
            <div data-a="b2" className="mr-tour-sub">
              Микроэкономика · 40 вопросов · 12 лекций
            </div>
            <div className="mr-tour-row">
              <div data-a="b2" className="mr-skel" style={{ height: 560 }}>
                {[
                  ['Эластичность спроса и её виды', 'ok'],
                  ['Выручка и эластичность', 'ok'],
                  ['Рыночное равновесие', 'half'],
                  ['Государство на рынке: налоги', 'no'],
                  ['Излишек потребителя', 'ok'],
                ].map(([title, kind], index) => (
                  <div key={title} className="mr-row">
                    <span className="mr-num">{index + 3}</span>
                    <span className="mr-row-t">{title}</span>
                    <Status kind={kind as 'ok' | 'half' | 'no'} />
                  </div>
                ))}
                <div style={{ position: 'absolute', right: 26, bottom: 26 }}>
                  <Pill>Тянуть билет</Pill>
                </div>
              </div>
              <div data-a="b2" className="mr-panel mr-panel--warm">
                <div className="mr-halftone" />
                <div className="mr-ticket" style={{ left: '46%', top: '44%', width: 520, height: 300, margin: '-150px 0 0 -260px', transform: 'rotate(-4deg)', padding: '36px 40px' }}>
                  <b style={{ fontSize: 48 }}>Билет 7</b>
                  <p style={{ fontSize: 26 }}>Почему пекарня может заработать больше, а кофейня — меньше?</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
