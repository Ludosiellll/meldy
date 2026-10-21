import { describe, expect, it } from 'vitest';
import { GUIDE_CHAPTERS } from './chapters';

const text = (id: string) => GUIDE_CHAPTERS.find((chapter) => chapter.id === id)!.text;

/** Words the exam container's copy never uses (spec decision 45, the words table of spec §3). */
const BANNED = /контейнер|(^|[^а-яё])тест|повторени|на проверку|спорн|пробн|засчитан|сгорел|готов на|сдашь|отстаёте|преподавател|колледж|аккредитац/i;

describe('the guide on «Сегодня» and «Экзамены» (Concept 1 §3.10)', () => {
  it('says «Сегодня» leads with the nearest exam of either kind and its plan, and keeps the first steps for an empty account', () => {
    expect(text('today')).toBe(
      'Главная страница. Ближайший экзамен и план на сегодня: сколько вопросов и минут, кнопка «Начать», а у устного экзамена «Тянуть билет». Пока экзамена нет, здесь первые шаги.',
    );
  });

  it('sends «Экзамены» through one door and tells questions with variants from oral ones', () => {
    const exams = text('exams');
    expect(exams).toBe(
      'Нажмите «Выбрать файлы», а если экзамены уже есть, «Новый экзамен». Подойдёт один файл на всё или по файлу на предмет. Ключ к вариантам Meldy возьмёт из файла. На устные вопросы отвечайте в «Тянуть билет».',
    );
    // The old way in («Вставьте список вопросов») is gone: every way in is «Новый экзамен».
    expect(exams).not.toMatch(/Вставьте список/);
  });

  it('uses none of the container’s banned words and at most one dash a chapter (design critique N1)', () => {
    for (const id of ['today', 'exams']) {
      expect(text(id)).not.toMatch(BANNED);
      expect((text(id).match(/ — /g) ?? []).length).toBeLessThanOrEqual(1);
    }
  });
});

describe('the chapters with more than one clip (the owner, 18.10: «для новых функций тоже нужно сделать обучение с видео»)', () => {
  const chapter = (id: string) => GUIDE_CHAPTERS.find((item) => item.id === id)!;

  it('«Экзамены» keeps its own clip first and adds «Перенести экзамен» and «Экзамены в Telegram»', () => {
    const reels = chapter('exams').reels!;
    expect(reels.map((reel) => [reel.clip, reel.label, reel.title])).toEqual([
      [null, 'Новый экзамен', 'Экзамены'],
      ['move', 'Перенести', 'Перенести экзамен'],
      ['botExams', 'В Telegram', 'Экзамены в Telegram'],
    ]);
    expect(reels[0].text).toBe(text('exams'));
    expect(reels[1].text).toContain('«Перенести экзамен»');
    expect(reels[2].text).toContain('/settings, затем «Экзамены»');
    expect(reels[2].text).toContain('«Перенести на неделю»');
    // The container's words: the move and the bot say neither «тест» nor «повторение».
    for (const reel of reels) expect(reel.text).not.toMatch(BANNED);
  });

  it('«Тесты» follows «Экзамены»: the studio, then «Как это видит ученик», on «Экзамены»’s page (the door «Новый тест» is there)', () => {
    const ids = GUIDE_CHAPTERS.map((item) => item.id);
    expect(ids.indexOf('tests')).toBe(ids.indexOf('exams') + 1);
    const tests = chapter('tests');
    expect(tests).toMatchObject({ tab: 'Тесты', title: 'Тесты', route: '/exams', spot: 'link' });
    expect(tests.reels!.map((reel) => [reel.clip, reel.label, reel.title])).toEqual([
      ['studio', 'Свой тест', 'Тесты'],
      ['quizLink', 'Как это видит ученик', 'Тест по ссылке'],
    ]);
    expect(tests.text).toContain('«Новый тест»');
    expect(tests.text).toContain('«Оформление»');
    expect(tests.text).toContain('«Отправить по ссылке»');
    expect(tests.reels![1].text).toContain('аккаунт не нужен');
    for (const path of ['/tests/new', '/exams/c/abc/studio', '/exams/c/abc/build', '/exams/c/abc/quizzes', '/exams/c/abc/quizzes/q1']) {
      expect(tests.match!.test(path)).toBe(true);
      expect(chapter('exams').match!.test(path)).toBe(false);
    }
    for (const path of ['/exams', '/exams/c/abc', '/exams/c/abc/keys', '/exams/import']) expect(chapter('exams').match!.test(path)).toBe(true);
  });

  it('give every clip a short button (one row on a phone) and at most four lines of text: «Назад / Дальше» stay in the card at 734 px', () => {
    for (const item of GUIDE_CHAPTERS) {
      if (!item.reels) continue;
      expect(item.reels.map((reel) => reel.label).join('').length).toBeLessThanOrEqual(36);
      for (const reel of item.reels) {
        expect(reel.text).not.toMatch(/!/);
        if (reel.clip) expect(reel.text.length).toBeLessThanOrEqual(180);
      }
    }
  });
});
