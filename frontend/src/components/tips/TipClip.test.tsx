import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import TipClip from './TipClip';
import { TG_CARD, TG_HISTORY, TG_QUESTIONS, TG_STAGE, TG_TIMES, TG_TOTAL, TG_UI, TG_WORDS, TIP_CLIPS } from './scenes';
import { TIPS } from './tips';
import { figureLines, lineText, startLabel } from '../../lib/containers/words';
// The bot's own sources, as text: the clip says and does what they say and do.
import botRender from '../../../../supabase/functions/_shared/bot/render.ts?raw';
import botWords from '../../../../supabase/functions/_shared/bot/words.ts?raw';
import botCard from '../../../../supabase/functions/_shared/bot/card.ts?raw';
import botSession from '../../../../supabase/functions/_shared/bot/session.ts?raw';
import botLink from '../../../../supabase/functions/_shared/bot/link.ts?raw';
import botSetup from '../../../../supabase/functions/_shared/bot/setup.ts?raw';
import botRouter from '../../../../supabase/functions/_shared/bot/router.ts?raw';
import botTg from '../../../../supabase/functions/_shared/bot/tg.ts?raw';

function stubReducedMotion(reduce: boolean) {
  vi.stubGlobal(
    'matchMedia',
    vi.fn((query: string) => ({
      matches: reduce && query.includes('prefers-reduced-motion'),
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  );
}

beforeEach(() => {
  // jsdom lays nothing out: the box is 400 px wide here.
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(400);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('TipClip', () => {
  it('plays the talk clip on its 16:10 stage, scaled to the box, the room in its own words', () => {
    stubReducedMotion(false);
    render(<TipClip clip={TIP_CLIPS.talk} active />);
    const stage = document.querySelector('.tp-stage') as HTMLElement;
    expect(stage).toHaveAttribute('aria-hidden', 'true');
    expect(stage.style.transform).toBe('scale(0.3125)');
    expect(stage.textContent).toContain('Чем исчерпаемые ресурсы отличаются от возобновляемых?');
    expect(stage.textContent).toContain('Ваш ответ');
    expect(stage.textContent).toContain('Вот как сказано в лекции. Скажите своими словами.');
    expect(stage.textContent).toContain('Из лекции, фрагмент 3');
    expect(document.querySelector('.tp-box')).toHaveAttribute('data-playing', 'true');
    fireEvent.click(screen.getByRole('button', { name: 'Пауза' }));
    expect(document.querySelector('.tp-box')).toHaveAttribute('data-playing', 'false');
    expect(screen.getByRole('button', { name: 'Смотреть' })).toBeInTheDocument();
  });

  it('with reduced motion waits on the still frame until «Смотреть»', () => {
    stubReducedMotion(true);
    render(<TipClip clip={TIP_CLIPS.talk} active />);
    expect(document.querySelector('.tp-box')).toHaveAttribute('data-playing', 'false');
    // The poster: the reply and the lecture's words are on the desk.
    const reply = Array.from(document.querySelectorAll<HTMLElement>('[data-a="reply"]'))[0];
    expect(reply.style.opacity).toBe('1');
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Смотреть' }));
    });
    expect(document.querySelector('.tp-box')).toHaveAttribute('data-playing', 'true');
  });

  it('does not play while the tip is not shown', () => {
    stubReducedMotion(false);
    render(<TipClip clip={TIP_CLIPS.talk} active={false} />);
    expect(document.querySelector('.tp-box')).toHaveAttribute('data-playing', 'false');
  });

  it('starts and ends on empty paper, so the loop is seamless', () => {
    stubReducedMotion(false);
    window.__MELDY_TIP_EXPORT__ = true;
    try {
      render(<TipClip clip={TIP_CLIPS.talk} active />);
      const { total, poster } = TIP_CLIPS.talk;
      const ui = document.querySelector('[data-a="ui"]') as HTMLElement;
      const say = document.querySelector('.fm-say') as HTMLElement;
      void window.__meldyTipClip?.seek(0);
      expect(ui.style.opacity).toBe('0');
      void window.__meldyTipClip?.seek(poster);
      expect(ui.style.opacity).toBe('1');
      expect(say.style.opacity).toBe('0');
      void window.__meldyTipClip?.seek(total - 40);
      expect(ui.style.opacity).toBe('0');
      expect(say.style.opacity).toBe('0');
    } finally {
      delete window.__MELDY_TIP_EXPORT__;
    }
  });
});

describe('the Telegram tip’s clip', () => {
  const NB = ' ';
  const plain = (text: string | null | undefined) => (text ?? '').split(NB).join(' ');
  const one = (name: string) => document.querySelector(`[data-a="${name}"]`) as HTMLElement;
  const scaleOf = (el: HTMLElement) => Number(/scale\(([\d.]+)\)/.exec(el.style.transform)?.[1] ?? '1');

  it('is the tip’s own: a phone-wide chat on a square stage, as the tip’s frame says, following the site’s theme', () => {
    // Every card tip has its clip here; the move dialog's tip plays a step clip (components/clips «move»).
    expect(Object.keys(TIP_CLIPS).sort()).toEqual(Object.keys(TIPS).filter((id) => id !== 'move').sort());
    const clip = TIP_CLIPS.telegram;
    expect(clip.total).toBe(TG_TOTAL);
    expect(clip.stage).toEqual(TG_STAGE);
    expect(TG_STAGE.width / TG_STAGE.height).toBe(TIPS.telegram.clip?.ratio);
    expect(TIPS.telegram.clip?.themed).toBe(true);
    // The lecture's clip keeps the usual 16:10 frame.
    expect(TIP_CLIPS.talk.stage).toBeUndefined();
    expect(TIPS.talk.clip).toBeUndefined();
    expect(clip.poster).toBeGreaterThan(TG_TIMES.arrive + 600);
    expect(clip.poster).toBeLessThan(TG_TIMES.start);
  });

  it('draws Telegram’s chat with the bot: the header, the dates, yesterday’s message, the day’s card and the input bar', () => {
    stubReducedMotion(false);
    render(<TipClip clip={TIP_CLIPS.telegram} active themed />);
    const box = document.querySelector('.tp-box') as HTMLElement;
    expect(box).toHaveAttribute('data-themed');
    expect(box).toHaveAttribute('data-play-at', 'top');
    expect(box.style.aspectRatio).toBe('400 / 400');
    const stage = document.querySelector('.tp-stage') as HTMLElement;
    expect(stage).toHaveAttribute('aria-hidden', 'true');
    expect(stage.style.width).toBe('400px');
    expect(stage.style.height).toBe('400px');
    expect(stage.style.transform).toBe('scale(1)');
    const words = plain(stage.textContent);
    // Telegram's own words: the bot's name and «бот», its menu button «Открыть Meldy», «Сообщение», the dates of the two days.
    for (const word of Object.values(TG_UI)) expect(words).toContain(word);
    expect((document.querySelector('.ts-tg-head') as HTMLElement).textContent).toBe(`${TG_UI.name}${TG_UI.subtitle}`);
    expect((document.querySelector('.ts-tg-hint') as HTMLElement).textContent).toBe(TG_UI.field);
    expect((document.querySelector('.ts-tg-menu') as HTMLElement).textContent).toBe(TG_UI.menu);
    // Yesterday: «Готово: план на день — в 20:00.» and the plan's line of a finished day; today the card at 20:00.
    expect(TG_HISTORY.line).toBe(lineText({ key: 'done', n: [65, 31] }));
    expect(plain(TG_HISTORY.line)).toBe('На сегодня всё: 65 вопросов за 31 минуту.');
    expect(plain(TG_CARD.plan)).toBe('Сегодня около 30 минут: 20 новых и 45 знакомых.');
    expect(plain(TG_CARD.exam)).toBe('Микроэкономика · 1 ноября, через 19 дней');
    expect(plain(TG_CARD.figure)).toBe('12 из 400 — верно в два разных дня');
    expect(figureLines({ inPlan: 400, twoDays: 12, seen: 90, errors: 7, selfKnow: 0 }, null).label).toBe('верно в два разных дня');
    expect(TG_CARD.start).toBe(startLabel(20, null, null));
    for (const line of [TG_HISTORY.title, TG_HISTORY.line, TG_HISTORY.time, TG_CARD.plan, TG_CARD.exam, TG_CARD.figure, TG_CARD.start, TG_CARD.time]) {
      expect(words).toContain(plain(line));
    }
    // The «занятие»: «Микроэкономика · 1 из 20», the question, its options on buttons, «Не знаю · Закончить».
    for (const question of TG_QUESTIONS) {
      expect(words).toContain(question.head);
      expect(words).toContain(question.stem);
      for (const option of question.options) expect(option.length).toBeLessThanOrEqual(24);
    }
    const keys = Array.from(stage.querySelectorAll('.ts-tg-key')).map((key) => plain(key.textContent));
    expect(keys).toEqual([plain(TG_CARD.start), ...TG_QUESTIONS[0].options, TG_WORDS.dontKnow, TG_WORDS.finish, ...TG_QUESTIONS[1].options, TG_WORDS.dontKnow, TG_WORDS.finish]);
    // One blue button: the card's «Начать» (style «primary»); the options are the plain kind.
    expect(stage.querySelectorAll('.ts-tg-key--primary')).toHaveLength(1);
    expect(one('start')).toHaveClass('ts-tg-key--primary');
    expect(one('pick').textContent).toBe(TG_QUESTIONS[0].options[TG_QUESTIONS[0].right]);
    // The bot's answer to a tap: its name over «Верно.».
    expect(one('alert').textContent).toBe(`${TG_UI.name}${TG_WORDS.right}`);
    // The time inside the bubbles: yesterday's message, today's card (an edit keeps the time it was sent at).
    expect(Array.from(stage.querySelectorAll('.ts-tg-time')).map((time) => time.textContent)).toEqual([TG_HISTORY.time, TG_CARD.time]);
    expect(words).not.toMatch(/[!"]/);
    expect(words).not.toMatch(/печатает|изм\./);
    // Success is the bot's own «Верно.» and the next question: no stamp, no burst of particles, no pencil, no grade words.
    expect(words).not.toMatch(/проверено|засчитан|зачтено|отлично|молодец|оценка/i);
    expect(document.querySelector('[class*="stamp"], [class*="confetti"], [class*="burst"], [class*="pencil"], [class*="hatch"], [class*="erase"], canvas')).toBeNull();
  });

  it('says and does what the bot says and does (its sources)', () => {
    // render.ts S and the question: the subject · «n из 20», an empty line, the question in bold.
    expect(botRender).toContain(`dontKnow: '${TG_WORDS.dontKnow}'`);
    expect(botRender).toContain(`finish: '${TG_WORDS.finish}'`);
    expect(botRender).toContain(`right: '${TG_WORDS.right}'`);
    expect(botRender).toContain('return `${oneLine(v.subject)} · ${v.n} из ${v.of}');
    expect(botRender).toMatch(/t\(headerText\(v\)\),\s*'',\s*stemBlock\(item, true\),/);
    expect(TG_QUESTIONS.map((q) => q.head)).toEqual(['Микроэкономика · 1 из 20', 'Микроэкономика · 2 из 20']);
    // words.ts: M3's title, the exam's line and its date.
    expect(botWords).toContain('export const m3Title = (time: string) => `Готово: план на день — в ${time}.`;');
    expect(TG_HISTORY.title).toBe('Готово: план на день — в 20:00.');
    expect(botWords).toContain('export const examLine = (title: string, when: string | null) => `${title} · ${when ?? NO_DATE}`;');
    expect(botWords).toContain("return `${dayText(date)}, через ${glue(daysLeft, 'день', 'дня', 'дней')}`;");
    // card.ts: «Начать» is the card's blue button; session.ts: a press on it is answered without a line and the card
    // becomes the session; a right answer is answered with «Верно.» (rightToast) before the next question.
    expect(botCard).toContain("startLabel(first.ids.length, null, null), data: encode({ kind: 'go', cid, mode: 'p' }), style: 'primary'");
    expect(botTg).toContain('if (button.style) out.style = button.style;');
    expect(botSession).toContain('await tap.answer(rightToast(');
    expect(botSession).toMatch(/await tap\.answer\(\);\s*if \(!inPlace && tap\.messageId\)/);
    // link.ts: the bot removes the «/start» it was linked with, so the chat starts with M2 → M3; setup.ts: the
    // menu button opens the Mini App, a web_app button with its own text (words.ts PROFILE.menuButton).
    expect(botLink).toContain('await remove(ctx.tg, chatId, msg.message_id);');
    expect(botSetup).toContain("return { type: 'web_app', text: PROFILE.menuButton, web_app: { url: `${site}${PATH.miniApp()}` } };");
    expect(botWords).toContain(`menuButton: '${TG_UI.menu}'`);
    // No «печатает…» in these steps: only the voice flows send a chat action.
    for (const source of [botCard, botSession, botRouter, botLink]) expect(source).not.toContain('sendChatAction');
  });

  it('brings the day’s card at 20:00, turns it into the first question on «Начать», and moves on after «Верно.»', () => {
    stubReducedMotion(false);
    window.__MELDY_TIP_EXPORT__ = true;
    try {
      render(<TipClip clip={TIP_CLIPS.telegram} active />);
      const seek = (t: number) => void window.__meldyTipClip?.seek(t);
      const T = TG_TIMES;
      // Yesterday's message alone, then the card comes in.
      seek(T.arrive - 100);
      expect(one('arrive').style.opacity).toBe('0');
      seek(T.arrive + 700);
      expect(one('arrive').style.opacity).toBe('1');
      expect(one('text-card').style.opacity).toBe('1');
      expect(one('kb-card').style.opacity).toBe('1');
      expect(one('text-q1').style.opacity).toBe('0');
      // «Начать»: the button dips under the finger with a ripple, springs back, and runs a light round its edge until
      // the bot answers.
      seek(T.start + 90);
      expect(scaleOf(one('start'))).toBeLessThan(0.97);
      expect(one('start-ripple').style.opacity).toBe('1');
      seek(T.startUp + 260);
      expect(Number(one('start-load').style.opacity)).toBeGreaterThan(0.9);
      seek(T.first - 100);
      expect(scaleOf(one('start'))).toBeCloseTo(1, 2);
      // The same message, now the first question with its keyboard.
      seek(T.first + 300);
      expect(one('text-card').style.opacity).toBe('0');
      expect(one('kb-card').style.opacity).toBe('0');
      expect(one('text-q1').style.opacity).toBe('1');
      expect(one('kb-q1').style.opacity).toBe('1');
      expect(one('start-load').style.opacity).toBe('0');
      expect(one('alert').style.opacity).toBe('0');
      // «Дефицит»: pressed, then the bot's «Верно.» and the next question in the same message.
      seek(T.answer + 90);
      expect(scaleOf(one('pick'))).toBeLessThan(0.97);
      seek(T.answerUp + 200);
      expect(Number(one('pick-load').style.opacity)).toBeGreaterThan(0.9);
      seek(T.next + 300);
      expect(one('alert').style.opacity).toBe('1');
      expect(one('text-q1').style.opacity).toBe('0');
      expect(one('text-q2').style.opacity).toBe('1');
      expect(one('kb-q2').style.opacity).toBe('1');
      expect(one('pick-load').style.opacity).toBe('0');
      // The loop starts and ends on empty paper.
      const ui = one('ui');
      seek(0);
      expect(ui.style.opacity).toBe('0');
      seek(TG_TOTAL - 40);
      expect(ui.style.opacity).toBe('0');
    } finally {
      delete window.__MELDY_TIP_EXPORT__;
    }
  });

  it('with reduced motion waits on the day’s card and its «Начать»', () => {
    stubReducedMotion(true);
    render(<TipClip clip={TIP_CLIPS.telegram} active />);
    expect(document.querySelector('.tp-box')).toHaveAttribute('data-playing', 'false');
    expect(one('ui').style.opacity).toBe('1');
    expect(one('arrive').style.opacity).toBe('1');
    expect(one('text-card').style.opacity).toBe('1');
    expect(one('text-q1').style.opacity).toBe('0');
    expect(one('alert').style.opacity).toBe('0');
    expect((document.querySelector('.fm-say') as HTMLElement).style.opacity).toBe('0');
  });
});
