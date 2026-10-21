import { describe, expect, it } from 'vitest';
import * as COPY from './copy3';
import { BUILDER_SECTION, CHAPTER_LABELS, CTA, EXAM_SECTION, FACE, FINAL, GAME, GAME_SECTION, GROUP_SECTION, HEADLINE, LEAD, LECTURE_SECTION, SAMPLE_TEST_URL, SAY, SITE_TITLE_V3, bind } from './copy3';

/** Every string of the landing's words, nested objects and arrays included. */
function strings(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.flatMap(strings);
  if (value && typeof value === 'object') return Object.values(value).flatMap(strings);
  return [];
}

const ALL = strings(COPY);
const HEADINGS = [
  HEADLINE,
  LECTURE_SECTION.title,
  EXAM_SECTION.title,
  EXAM_SECTION.file.title,
  EXAM_SECTION.plan.title,
  EXAM_SECTION.session.title,
  EXAM_SECTION.ticket.title,
  EXAM_SECTION.left.title,
  GROUP_SECTION.title,
  GAME_SECTION.title,
  BUILDER_SECTION.title,
  BUILDER_SECTION.tryTitle,
  BUILDER_SECTION.sendTitle,
  BUILDER_SECTION.statsTitle,
  FINAL.title,
  ...Object.values(CHAPTER_LABELS),
];
const STATEMENTS = Object.values(SAY).flat();

describe('the landing v3 words (owner, 2026-10-19: plain, no AI-looking lines)', () => {
  it('have no exclamation marks, no wavy-line words, no disclaimers and no inflated words', () => {
    for (const text of ALL) {
      expect(text, text).not.toMatch(/!/);
      expect(text, text).not.toMatch(/не придумывает|не выдумывает|уникальн|революц|мощн|идеальн|волшебн|магия|лучш|невероятн|умн(ый|ая|ое) /i);
    }
  });

  it('on the page itself are plain: short sentences, no chains through «—», «:» or «·», none of our own terms', () => {
    // The owner, 2026-10-21: «бесят эти надписи, ты когда их читаешь нихуя не понятно». What a student says aloud in
    // the ticket's loop is speech and keeps its dash; the reel's words (SAY, CHAPTER_LABELS, EXAMPLE) are the reel's.
    const { said, answer, ...ticket } = COPY.TICKET_TALK;
    expect([...said, answer].length).toBe(4);
    const page = strings([
      COPY.LEAD,
      COPY.CTA,
      COPY.NAV,
      COPY.LECTURE_SECTION,
      COPY.EXAM_SECTION,
      ticket,
      COPY.GROUP_SECTION,
      COPY.GAME_SECTION,
      COPY.GAME,
      COPY.BUILDER_SECTION,
      COPY.PICTURES,
      COPY.FINAL,
      COPY.FOOTER,
      COPY.FOOTER_NOTE,
    ]);
    expect(page.length).toBeGreaterThan(60);
    for (const text of page) {
      expect(text, text).not.toMatch(/\s—\s|:|\s·\s/);
      expect(text, text).not.toMatch(/подтвержд|в сч[её]т|пункт|строк|подсмотр|по правилу|с первого раза|вернутся|вернётся|сесси|обработан|ключ/i);
      for (const sentence of text.split(/(?<=[.?])\s+/)) expect(sentence.length, sentence).toBeLessThanOrEqual(90);
    }
  });

  it('say «Осталось выучить», never «шпаргалка» (owner, 2026-10-21: what is left is a part of the exam)', () => {
    for (const text of ALL) expect(text, text).not.toMatch(/шпаргалк/i);
    expect(EXAM_SECTION.left.title).toBe('Осталось выучить');
  });

  it('build no heading or statement around an em dash and no «не X, а Y» / «X не …, он …» contrast', () => {
    for (const text of [...HEADINGS, ...STATEMENTS]) {
      expect(text, text).not.toMatch(/\s—\s/);
      expect(text, text).not.toMatch(/(^|\s)не\s[^.]*,\s*(а|он|она|оно|они)(\s|$)/i);
    }
  });

  it('keep the statements of the reel short sentences, several of them with the example’s real numbers', () => {
    for (const line of STATEMENTS) {
      expect(line.length, line).toBeLessThanOrEqual(70);
      expect(line, line).not.toMatch(/[.!?]$/);
    }
    const withNumbers = STATEMENTS.filter((line) => /\d/.test(line));
    expect(withNumbers.length).toBeGreaterThanOrEqual(5);
  });

  it('give the constructor the most of the reel’s sentences', () => {
    const builder = [...SAY.build, ...SAY.media, ...SAY.look, ...SAY.send, ...SAY.take, ...SAY.stats];
    expect(builder.length).toBeGreaterThanOrEqual(8);
  });

  it('name the page one way: the headline covers the exam and the tests, the title says the face', () => {
    expect(HEADLINE).toBe('Готовьтесь к экзамену и собирайте свои тесты');
    expect(SITE_TITLE_V3).toBe('Meldy — подготовка к экзамену и конструктор тестов');
    expect(FACE).toBe('Подготовка к экзамену и конструктор тестов');
    expect(LEAD).toMatch(/лекци/);
    expect(LEAD).toMatch(/по ссылке/);
  });

  it('tell the game in class plainly: where it is played, what happens at zero, a verb on its button (owner, 21.10)', () => {
    expect(GAME_SECTION.title).toBe('Игра в классе');
    expect(CHAPTER_LABELS.game).toBe(GAME_SECTION.title);
    // One thought a sentence, each short: the projector, the phone, the fall, the site and Telegram.
    const sentences = GAME_SECTION.text.split(/(?<=\.)\s+/);
    expect(sentences).toHaveLength(4);
    for (const sentence of sentences) expect(sentence.length, sentence).toBeLessThanOrEqual(50);
    expect(GAME_SECTION.text).toMatch(/проектор/);
    expect(GAME_SECTION.text).toMatch(/Telegram/);
    expect(CTA.game).toBe('Провести игру');
    // The reel says it in two lines: where the class plays, and who falls.
    expect(SAY.game).toHaveLength(2);
    expect(SAY.game[0]).toMatch(/Telegram/);
    expect(SAY.game[1]).toMatch(/провалива/);
    // The bot's post is the stand game's own (supabase/functions/_shared/bot/live.ts), with the PIN the recorded
    // projector shows in its lobby and corner (the footage loops through it on the page); the PIN never splits.
    expect(GAME.post.join(' ')).toContain('Заходите по PIN\u00a0123\u00a0456.');
    expect(GAME.mode).toBe('Встань на ответ');
    // No game words of our own on the page: no «режим», «раунд», «лобби», «зона», «босс».
    for (const text of strings([GAME_SECTION, GAME, SAY.game])) expect(text, text).not.toMatch(/режим|раунд|лобби|зон[аеуы]|босс/i);
  });

  it('send «Пройти тест без входа» to the public example test on this site', () => {
    expect(SAMPLE_TEST_URL).toMatch(/^\/k\/[a-z0-9]{12}$/);
  });
});

describe('bind', () => {
  it('keeps a word of one or two letters with the word after it, and nothing else', () => {
    expect(bind('Готовьтесь к экзамену и собирайте свои тесты')).toBe('Готовьтесь к\u00a0экзамену и\u00a0собирайте свои тесты');
    expect(bind('по дням до экзамена')).toBe('по\u00a0дням до\u00a0экзамена');
    expect(bind('и в лекции')).toBe('и\u00a0в\u00a0лекции');
    expect(bind('Meldy делает тест')).toBe('Meldy делает тест');
  });
});
