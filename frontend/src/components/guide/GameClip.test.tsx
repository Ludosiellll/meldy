import { cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import GuideClip from './GuideClip';
import { GUIDE_CLIPS } from './clips';
import { PLAY_SITE } from './chapters';
import { CLIP } from './scenes';
import { GAME_CLIP, GAME_EXAMPLE, GAME_PLAYERS, GAME_POSTER, GAME_STAGE, GAME_STOOD, GM, playersAt } from './scenes/game';
import { TIP_CLIPS } from '../tips/scenes';
import { TIPS } from '../tips/tips';
import { TEST_HOME } from '../test/copyTest';
import { ENTRY, MODE, SETUP, pinText } from '../live/host/copy';

/* The guide's «Игра в классе» clip, also the test page's first-use tip: from «Провести игру» to the floor that drops. */

const NB = ' ';
const plain = (text: string | null | undefined) => (text ?? '').split(NB).join(' ');
const stage = () => document.querySelector('.gd-stage') as HTMLElement;
const one = (name: string) => document.querySelector(`[data-a="${name}"]`) as HTMLElement;
const all = (name: string) => Array.from(document.querySelectorAll<HTMLElement>(`[data-a="${name}"]`));
const seen = (el: HTMLElement) => el.style.opacity === '1';
const gone = (el: HTMLElement) => el.style.opacity === '0';

function renderExport() {
  window.__MELDY_GUIDE_EXPORT__ = true;
  render(<GuideClip chapter="game" active />);
  return (t: number) => {
    void window.__meldyGuideClip?.seek(t);
  };
}

beforeEach(() => {
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(480);
  vi.stubGlobal('matchMedia', (query: string) => ({ matches: false, media: query, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }));
});
afterEach(() => {
  cleanup();
  delete window.__MELDY_GUIDE_EXPORT__;
  vi.unstubAllGlobals();
});

describe('the «Игра в классе» clip', () => {
  it('is the chapter’s own, longer than a usual chapter: a whole round, its still frame after the drop', () => {
    const clip = GUIDE_CLIPS.game;
    expect(clip.total).toBe(GAME_CLIP);
    expect(clip.total).toBeGreaterThan(CLIP);
    expect(clip.poster).toBe(GAME_POSTER);
    expect(clip.poster).toBeGreaterThan(GM.result + 500);
    expect(clip.poster).toBeLessThan(clip.total - 760);
    // The moments in their order: the button, the setup, the game picked, the room, the phones, the question, the drop.
    const order = [GM.focus, GM.press, GM.setup, GM.pick, GM.open, GM.lobby, GM.phones, GM.joinSite, GM.joinTg, GM.crowd, GM.question, GM.run, GM.drop, GM.result];
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it('shows the screens’ own words: the test’s page, the setup, the projector, the site and Telegram', () => {
    render(<GuideClip chapter="game" active />);
    expect(stage()).toHaveAttribute('aria-hidden', 'true');
    expect(stage().style.transform).toBe(`scale(${480 / 1440})`);
    const words = plain(stage().textContent);
    for (const line of [
      TEST_HOME.studio,
      TEST_HOME.send,
      ENTRY.host,
      SETUP.top,
      SETUP.title(GAME_EXAMPLE.test),
      SETUP.lead(GAME_EXAMPLE.questions),
      MODE.name,
      'Встань на ответ',
      SETUP.open,
      'Заходите на',
      PLAY_SITE,
      `PIN ${pinText(GAME_EXAMPLE.pin)}`,
      'Или наведите камеру телефона на код.',
      'PIN игры',
      'Играть',
      'Встаньте на верный ответ. Остальной пол провалится.',
      GAME_EXAMPLE.question,
      ...GAME_EXAMPLE.answers,
      'Верный ответ',
    ]) {
      expect(words).toContain(plain(line));
    }
    // No notes about the clip on screen: only what the screens say.
    expect(words).not.toMatch(/шаг \d|нажмите сюда|здесь учитель|→|←/i);
  });

  it('goes from the button to the setup, the room, the phones and the floor that drops', () => {
    const seek = renderExport();
    seek(GM.press - 200);
    expect(one('host').style.background).toBe('rgb(255, 255, 255)');
    seek(GM.press + 200);
    expect(one('host').style.background).toBe('rgb(11, 18, 28)');
    // The setup: «Битва с монстром» is picked, then «Встань на ответ».
    seek(GM.pick - 100);
    expect(all('tick').map(seen)).toEqual([true, false]);
    seek(GM.pick + 100);
    expect(all('tick').map(seen)).toEqual([false, true]);
    // The room: the PIN and the QR code, nobody yet; the site's phone comes in first, then Telegram's.
    seek(GM.lobby + 900);
    expect(seen(one('proj'))).toBe(true);
    expect(seen(one('lobbyboard'))).toBe(true);
    expect(one('count').textContent).toBe('0');
    seek(GM.joinTg);
    expect(one('count').textContent).toBe('1');
    seek(GM.crowd - 10);
    expect(one('count').textContent).toBe('2');
    seek(GM.question - 100);
    expect(one('count').textContent).toBe(String(GAME_PLAYERS));
    // The question: the phones go, the answers are named on the floor.
    seek(GM.run + 300);
    expect(gone(one('lobbyboard'))).toBe(true);
    expect(seen(one('qboard'))).toBe(true);
    expect(all('answer').every(seen)).toBe(true);
    // The drop: three zones go, the right one stays, and so do the 18 who stood on it.
    seek(GAME_POSTER);
    const zones = all('zone');
    expect(zones.map(gone)).toEqual([false, true, true, true]);
    expect(all('kid').filter(seen)).toHaveLength(GAME_STOOD);
    expect(seen(one('rboard'))).toBe(true);
    expect(plain(one('stood').textContent)).toBe(`Устояли ${GAME_STOOD} из ${GAME_PLAYERS}`);
  });

  it('counts the class right: 24 come in, 18 stand on the right answer', () => {
    expect(GAME_PLAYERS).toBe(24);
    expect(GAME_STOOD).toBe(18);
    expect(playersAt(GM.lobby)).toBe(0);
    expect(playersAt(GM.question)).toBe(GAME_PLAYERS);
  });
});

describe('the test page’s first-use tip «Игра в классе»', () => {
  it('plays the same clip on the same 4:3 stage', () => {
    expect(TIP_CLIPS.game).toMatchObject({ total: GAME_CLIP, poster: GAME_POSTER, stage: GAME_STAGE });
    expect(TIP_CLIPS.game.Scene).toBe(GUIDE_CLIPS.game.Scene);
    expect(TIPS.game.clip).toEqual({ ratio: 4 / 3, themed: false });
    expect(GAME_STAGE.width / GAME_STAGE.height).toBe(4 / 3);
  });

  it('says it in plain words, and its button is the page’s own', () => {
    expect(TIPS.game).toMatchObject({ title: 'Игра в классе', action: ENTRY.host, later: 'Не сейчас' });
    expect(TIPS.game.text).toBe('Вопросы теста идут на проекторе. Ученики играют с телефонов, на сайте или в Telegram.');
    expect(TIPS.game.text).not.toMatch(/\s—\s|:|!/);
  });
});
