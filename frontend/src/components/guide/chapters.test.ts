import { describe, expect, it } from 'vitest';
import { GAME_STUDENT, GAME_TEXT, GUIDE_CHAPTERS, PLAY_SITE, mayLeave, routePath } from './chapters';

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
      'Нажмите «Новый экзамен» и загрузите вопросы. Подойдёт один общий файл или по файлу на предмет. Ключ к вариантам Meldy возьмёт из файла. На устные вопросы отвечайте голосом или текстом в «Тянуть билет», и Meldy сверит ответ с вашими лекциями.',
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
    // «Быстрая контрольная» first (UX audit of 21.10), then the studio and the test by its link.
    expect(tests.reels!.map((reel) => [reel.clip, reel.label, reel.title])).toEqual([
      ['quick', 'Контрольная', 'Быстрая контрольная'],
      ['studio', 'Студия', 'Тесты'],
      ['quizLink', 'Глазами ученика', 'Тест по ссылке'],
    ]);
    expect(tests.reels![0].text).toContain('«Быстрая контрольная»');
    expect(tests.text).toContain('«Новый тест»');
    expect(tests.text).toContain('«Оформление»');
    expect(tests.text).toContain('«Отправить по ссылке»');
    expect(tests.reels![2].text).toContain('аккаунт не нужен');
    for (const path of ['/tests/new', '/tests/quick', '/exams/c/abc/quizzes/q1/link', '/exams/c/abc/studio', '/exams/c/abc/build', '/exams/c/abc/quizzes', '/exams/c/abc/quizzes/q1']) {
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

describe('«Игры» (the owner, 21.10: «а где на сайте указать что ты хочешь такую игру? и обучение по тому как ее сделать? где это будет и можно ли с сайта играть, или только в тг?»; 31.10: «может отдельный Блок сверху как "лекции"»)', () => {
  const game = GUIDE_CHAPTERS.find((item) => item.id === 'game')!;

  it('follows «Тесты»: «Открыть раздел» opens «Игры» (/games) and its item lights up in the top line', () => {
    const ids = GUIDE_CHAPTERS.map((item) => item.id);
    expect(ids.indexOf('game')).toBe(ids.indexOf('tests') + 1);
    expect(game).toMatchObject({ tab: 'Игры', title: 'Игры', route: '/games', spot: 'link', text: GAME_TEXT });
    expect(routePath(game.route!)).toBe('/games');
    // Its own clip (real footage of the game, clips.ts GUIDE_FOOTAGE), no step clips.
    expect(game.reels).toBeUndefined();
    // «Игры», the setup and the projector are its pages; the tests' pages stay «Тесты», the phone's /play is outside.
    for (const path of ['/games', '/games/', '/live/new', '/live/abc', '/live']) expect(game.match!.test(path)).toBe(true);
    for (const path of ['/exams', '/exams/c/abc', '/exams/c/abc/quizzes', '/play', '/tg/play', '/lively', '/gamesx']) expect(game.match!.test(path)).toBe(false);
    // Below 1024 px the five tabs have no «Игры»: the card says where it is.
    expect(game.phone).toBe('На телефоне — строка «Игры» на «Сегодня» и в меню аккаунта.');
    // «Дальше» may take the app on to the section: it is a section's page.
    expect(mayLeave('/games', null, false)).toBe(true);
  });

  it('answers the questions plainly: where it starts, the two games, the screen, how students join', () => {
    const text = game.text;
    // Where to start: the section's own button, on a test or an exam.
    expect(text).toMatch(/^В разделе «Игры» нажмите «Начать игру» и выберите тест или экзамен\./);
    // The two games, each named whole after «В игре»: buttons, and the character run to the answer.
    expect(text).toContain('В игре «Битва с монстром» все отвечают кнопками.');
    expect(text).toContain('В игре «Встань на ответ» каждый ведёт героя к ответу.');
    expect(text).not.toMatch(/В «/);
    // A projector or a big screen.
    expect(text).toContain('Нужен проектор или большой экран.');
    // The site with the PIN or the QR code: the site is enough.
    expect(PLAY_SITE).toBe('ludosiel-studyforge.hf.space/play');
    expect(text).toContain(`Ученики входят на ${PLAY_SITE} по PIN или QR-коду.`);
  });

  it('keeps to the plain-words rules: one short sentence a thought, no «—», «:» or «·» chains, none of our own terms', () => {
    for (const text of [game.text, GAME_STUDENT.text]) {
      expect(text).not.toMatch(/\s—\s|:|\s·\s|!|\(/);
      expect(text).not.toMatch(/подтвержд|в сч[её]т|пункт|строк|подсмотр|по правилу|с первого раза|вернутся|сесси|режим|лобби|хост/i);
      for (const sentence of text.split(/(?<=\.)\s+/)) expect(sentence.length, sentence).toBeLessThanOrEqual(90);
      // Six lines on the owner's 1532×734 laptop, the address whole on one of them: «Назад / Дальше» stay in the card.
      expect(text.length).toBeLessThanOrEqual(280);
    }
    expect(game.text.split(/(?<=\.)\s+/)).toHaveLength(5);
  });

  it('a student’s card in the first run says how to get into a teacher’s game, with the button’s own words', () => {
    expect(GAME_STUDENT.title).toBe('Игры');
    expect(GAME_STUDENT.text).toContain('«Войти в игру по коду»');
    expect(GAME_STUDENT.text).toContain('QR-коду');
  });
});
