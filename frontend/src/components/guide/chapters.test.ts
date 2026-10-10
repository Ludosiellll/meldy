import { describe, expect, it } from 'vitest';
import { GUIDE_CHAPTERS } from './chapters';

const text = (id: string) => GUIDE_CHAPTERS.find((chapter) => chapter.id === id)!.text;

/** Words the exam container's copy never uses (spec decision 45, the words table of spec §3). */
const BANNED = /контейнер|(^|[^а-яё])тест|повторени|на проверку|спорн|пробн|засчитан|сгорел|готов на|выучен|сдашь|отстаёте|преподавател|колледж|аккредитац/i;

describe('the guide on «Сегодня» and «Экзамены» (Concept 1 §3.10)', () => {
  it('says «Сегодня» leads with the nearest exam of either kind and its plan, and keeps the first steps for an empty account', () => {
    expect(text('today')).toBe(
      'Главная страница. Ближайший экзамен и план на сегодня: сколько вопросов и минут, кнопка «Начать», у устного экзамена — «Тянуть билет». Пока экзамена нет, здесь первые шаги.',
    );
  });

  it('sends «Экзамены» through one door and tells questions with variants from oral ones', () => {
    const exams = text('exams');
    expect(exams).toBe(
      'Нажмите «Новый экзамен» и загрузите вопросы: один общий файл или по файлу на предмет. Ключ к вариантам Meldy возьмёт из файла. Устные вопросы отвечайте голосом или текстом в «Тянуть билет»: Meldy сверит ответ с вашими лекциями.',
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
