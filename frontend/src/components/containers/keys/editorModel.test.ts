import { describe, expect, it } from 'vitest';
import { EXPLANATION_MAX, PICTURE_STEM, type TestItem } from '../../../types/container';
import {
  appendOption,
  draftChanged,
  draftOf,
  draftProblems,
  emptyDraft,
  explanationText,
  formsOf,
  inputOf,
  kindForced,
  kindOf,
  nextFileNo,
  patchOf,
  removeOption,
  resetsProgress,
  searchItems,
  tickOnly,
  toggleTick,
  type Draft,
} from './editorModel';

const C = '11111111-2222-4333-8444-555555555555';
const P1 = `${C}/${'a1'.repeat(32)}.png`;
const P2 = `${C}/${'b2'.repeat(32)}.jpg`;

function item(over: Partial<TestItem> = {}): TestItem {
  return {
    id: 'i1',
    container_id: C,
    subject_id: 's1',
    position: 1,
    file_no: '1',
    topic: null,
    kind: 'single',
    stem: 'Что означает стрелка слева?',
    options: ['Вход', 'Управление', 'Выход'],
    correct: [0],
    answers: [],
    key_source: 'bold',
    code: false,
    keep_order: false,
    flags: [],
    rev: 1,
    updated_at: '2026-10-16T00:00:00Z',
    images: null,
    ...over,
  };
}

describe('draftOf', () => {
  it('keeps the words and the key of a plain question', () => {
    const draft = draftOf(item());
    expect(draft.stem).toBe('Что означает стрелка слева?');
    expect(draft.options.map((option) => option.text)).toEqual(['Вход', 'Управление', 'Выход']);
    expect(draft.correct).toEqual([0]);
    expect(draft.short).toBe(false);
  });

  it('leaves the stand-in words of a picture empty, the picture holds them', () => {
    const draft = draftOf(item({ stem: PICTURE_STEM, options: ['Рисунок А', 'Два'], images: { stem: [P1], options: [[P2], []] } }));
    expect(draft.stem).toBe('');
    expect(draft.stemPictures).toEqual([P1]);
    expect(draft.options[0]).toEqual({ text: '', pictures: [P2] });
  });

  it('gives a short question its forms', () => {
    const draft = draftOf(item({ kind: 'short', options: [], correct: [], answers: ['Шлюз', 'шлюз XOR'] }));
    expect(draft.short).toBe(true);
    expect(draft.forms).toBe('Шлюз; шлюз XOR');
  });

  it('carries the explanation; a question saved before it had one starts empty', () => {
    expect(draftOf(item({ explanation: 'Стрелка слева — вход.\nСверху — управление.' })).explanation).toBe('Стрелка слева — вход.\nСверху — управление.');
    expect(draftOf(item()).explanation).toBe('');
    expect(emptyDraft().explanation).toBe('');
  });
});

describe('removeOption', () => {
  it('moves the key with the options after the removed one', () => {
    const draft = removeOption({ ...draftOf(item({ correct: [2] })), options: [{ text: 'А', pictures: [] }, { text: 'Б', pictures: [P1] }, { text: 'В', pictures: [P2] }] }, 1);
    expect(draft.options).toEqual([{ text: 'А', pictures: [] }, { text: 'В', pictures: [P2] }]);
    expect(draft.correct).toEqual([1]);
  });

  it('drops the key when its own option goes', () => {
    expect(removeOption(draftOf(item({ correct: [1] })), 1).correct).toEqual([]);
  });
});

describe('draftProblems', () => {
  const base = draftOf(item());
  it('needs words or a picture in the stem', () => {
    expect(draftProblems({ ...base, stem: '  ' })).toEqual(['stem']);
    expect(draftProblems({ ...base, stem: '', stemPictures: [P1] })).toEqual([]);
  });
  it('counts the options', () => {
    expect(draftProblems({ ...base, options: [{ text: 'А', pictures: [] }], correct: [0] })).toContain('options_few');
    const nine = Array.from({ length: 9 }, (_, index) => ({ text: `Вариант ${index}`, pictures: [] }));
    expect(draftProblems({ ...base, options: nine })).toContain('options_many');
  });
  it('wants each option to say something', () => {
    expect(draftProblems({ ...base, options: [{ text: 'А', pictures: [] }, { text: ' ', pictures: [] }] })).toContain('option_empty');
    expect(draftProblems({ ...base, options: [{ text: 'А', pictures: [] }, { text: '', pictures: [P1] }] })).toEqual([]);
    expect(draftProblems({ ...base, options: [{ text: 'А', pictures: [] }, { text: 'я'.repeat(601), pictures: [] }] })).toContain('option_long');
  });
  it('checks the forms of a short answer', () => {
    const short: Draft = { ...emptyDraft(), stem: 'Как называется элемент?', short: true, options: [], forms: ' ; ' };
    expect(draftProblems(short)).toEqual(['forms']);
    expect(draftProblems({ ...short, forms: 'шлюз' })).toEqual([]);
    expect(draftProblems({ ...short, forms: 'ш'.repeat(201) })).toEqual(['form_long']);
  });
  it('lets the explanation be empty or up to the limit, spaces around it not counted', () => {
    expect(draftProblems({ ...base, explanation: '' })).toEqual([]);
    expect(draftProblems({ ...base, explanation: `  ${'я'.repeat(EXPLANATION_MAX)}\n\n` })).toEqual([]);
    expect(draftProblems({ ...base, explanation: 'я'.repeat(EXPLANATION_MAX + 1) })).toEqual(['explanation_long']);
    const short: Draft = { ...emptyDraft(), stem: 'Как называется элемент?', short: true, options: [], forms: 'шлюз', explanation: 'я'.repeat(EXPLANATION_MAX + 1) };
    expect(draftProblems(short)).toEqual(['explanation_long']);
  });
});

describe('patchOf', () => {
  it('is null when nothing changed', () => {
    expect(patchOf(item(), draftOf(item()))).toBeNull();
  });
  it('sends only the changed words', () => {
    expect(patchOf(item(), { ...draftOf(item()), stem: 'Что означает стрелка, входящая слева?' })).toEqual({ stem: 'Что означает стрелка, входящая слева?' });
  });
  it('makes two ticked options a question with several answers', () => {
    expect(patchOf(item(), { ...draftOf(item()), correct: [2, 0] })).toEqual({ correct: [0, 2], kind: 'multiple' });
  });
  it('sends the pictures aligned with the options', () => {
    expect(patchOf(item(), { ...draftOf(item()), stemPictures: [P1] })).toEqual({ images: { stem: [P1], options: [[], [], []] } });
  });
  it('clears the pictures with an empty object', () => {
    const pictured = item({ images: { stem: [P1], options: [[], [], []] } });
    expect(patchOf(pictured, { ...draftOf(pictured), stemPictures: [] })).toEqual({ images: {} });
  });
  it('saves a picture-only option with its stand-in words', () => {
    const draft = draftOf(item());
    draft.options = [...draft.options, { text: '', pictures: [P2] }];
    expect(patchOf(item(), draft)).toEqual({ options: ['Вход', 'Управление', 'Выход', 'Рисунок Г'], images: { stem: [], options: [[], [], [], [P2]] } });
  });
  it('sends the forms of a short question', () => {
    const short = item({ kind: 'short', options: [], correct: [], answers: ['Шлюз'] });
    expect(patchOf(short, { ...draftOf(short), forms: 'Шлюз; Gateway' })).toEqual({ answers: ['Шлюз', 'Gateway'] });
  });
  it('sends the explanation only when it changed, trimmed; an emptied one as an empty string', () => {
    expect(patchOf(item(), { ...draftOf(item()), explanation: '  Слева входит то, что блок меняет.\n' })).toEqual({ explanation: 'Слева входит то, что блок меняет.' });
    const explained = item({ explanation: 'Слева — вход.' });
    expect(patchOf(explained, draftOf(explained))).toBeNull();
    expect(patchOf(explained, { ...draftOf(explained), explanation: 'Слева — вход. ' })).toBeNull();
    expect(patchOf(explained, { ...draftOf(explained), explanation: '   ' })).toEqual({ explanation: '' });
    // A question read before the column existed has no explanation at all: an untouched draft sends nothing.
    expect(patchOf(item({ explanation: undefined }), { ...draftOf(item()), explanation: '' })).toBeNull();
  });
  it('sends the explanation beside the other changes', () => {
    expect(patchOf(item(), { ...draftOf(item()), correct: [1], explanation: 'Управление — сверху.' })).toEqual({ correct: [1], explanation: 'Управление — сверху.' });
  });
});

describe('resetsProgress', () => {
  it('follows the rule of the database trigger', () => {
    expect(resetsProgress(item(), { stem: 'Новая формулировка' })).toBe(false);
    expect(resetsProgress(item(), { correct: [1] })).toBe(true);
    expect(resetsProgress(item(), { correct: [0] })).toBe(false);
    expect(resetsProgress(item(), { options: ['Вход', 'Управление', 'Выход (стрелка справа)'] })).toBe(false);
    expect(resetsProgress(item(), { options: ['Вход', 'Управление', 'Выход', 'Механизм'] })).toBe(true);
    expect(resetsProgress(item(), { kind: 'multiple' })).toBe(true);
    const short = item({ kind: 'short', options: [], correct: [], answers: ['Шлюз'] });
    expect(resetsProgress(short, { answers: [' шлюз '] })).toBe(false);
    expect(resetsProgress(short, { answers: ['Шлюз', 'Gateway'] })).toBe(true);
  });
  it('never restarts the question for an explanation', () => {
    expect(resetsProgress(item(), { explanation: 'Стрелка слева — вход.' })).toBe(false);
    expect(resetsProgress(item({ explanation: 'Было' }), { explanation: '' })).toBe(false);
    expect(resetsProgress(item(), patchOf(item(), { ...draftOf(item()), explanation: 'Новое пояснение' })!)).toBe(false);
  });
});

describe('nextFileNo', () => {
  it('follows the largest whole number of the subject', () => {
    const items = ['1', '2', '10', '3a'].map((no, index) => item({ id: `i${index}`, file_no: no }));
    expect(nextFileNo([...items, item({ id: 'x', subject_id: 's2', file_no: '400' })], 's1')).toBe('11');
    expect(nextFileNo([], 's1')).toBe('1');
  });
});

describe('inputOf', () => {
  it('is what container_items_add takes', () => {
    const draft: Draft = { ...emptyDraft(), stem: 'Что такое шлюз?', options: [{ text: 'Узел', pictures: [] }, { text: 'Поток', pictures: [P1] }], correct: [0] };
    expect(inputOf(draft, '161', 'man:1')).toEqual({
      ref: 'man:1',
      stem: 'Что такое шлюз?',
      options: ['Узел', 'Поток'],
      correct: [0],
      kind: 'single',
      file_no: '161',
      key_source: 'manual',
      code: false,
      keep_order: false,
      images: { stem: [], options: [[], [P1]] },
    });
  });
  it('marks a question without a key as such', () => {
    const draft: Draft = { ...emptyDraft(), stem: 'Без ключа', options: [{ text: 'А', pictures: [] }, { text: 'Б', pictures: [] }] };
    expect(inputOf(draft, '1', 'man:2')).toMatchObject({ key_source: 'none', correct: [] });
    expect(inputOf(draft, '1', 'man:2').images).toBeUndefined();
    expect(inputOf(draft, '1', 'man:2').explanation).toBeUndefined();
  });
  it('carries the explanation of a new question, trimmed', () => {
    const draft: Draft = { ...emptyDraft(), stem: 'Что такое шлюз?', short: true, options: [], forms: 'шлюз', explanation: '\n Ромб в BPMN — шлюз. \n' };
    expect(inputOf(draft, '2', 'man:3')).toMatchObject({ kind: 'short', answers: ['шлюз'], explanation: 'Ромб в BPMN — шлюз.' });
  });
});

describe('explanationText', () => {
  it('drops the blank lines and spaces around the words, keeps those inside', () => {
    expect(explanationText({ explanation: '\n  Первое.\n\nВторое.  \n' })).toBe('Первое.\n\nВторое.');
    expect(explanationText({ explanation: ' \n ' })).toBe('');
  });
});

describe('formsOf', () => {
  it('splits on «;» and drops the empty ones', () => {
    expect(formsOf(' Шлюз ;; gateway ; ')).toEqual(['Шлюз', 'gateway']);
  });
});

describe('searchItems', () => {
  const items = [
    item({ id: 'a', stem: 'Какие события относятся к истории ВКЛ?', options: ['Грюнвальдская битва', 'Крещение Руси'] }),
    item({ id: 'b', stem: 'Где живут ежи?', options: ['В лесу', 'В море'] }),
  ];
  it('finds every word in the question or its options', () => {
    expect(searchItems(items, 'грюнвальд битв').map((found) => found.id)).toEqual(['a']);
    expect(searchItems(items, 'ЁЖИ').map((found) => found.id)).toEqual(['b']);
    expect(searchItems(items, 'ежи лес').map((found) => found.id)).toEqual(['b']);
    expect(searchItems(items, 'ежи битва')).toEqual([]);
    expect(searchItems(items, '  ')).toEqual([]);
  });
});

describe('the kind the author chose (release 47, M5)', () => {
  it('keeps «несколько ответов» with one tick or none, and says nothing changed', () => {
    const several = item({ kind: 'multiple', correct: [0, 2] });
    const draft = draftOf(several);
    expect(draft.multiple).toBe(true);
    expect(kindOf({ ...draft, correct: [0] })).toBe('multiple');
    expect(kindOf({ ...draft, correct: [] })).toBe('multiple');
    expect(patchOf(several, { ...draft, correct: [0] })).toEqual({ correct: [0] });
    expect(kindForced({ ...draft, correct: [0] })).toBe(false);
  });

  it('makes a one-answer question one with several at two ticks, and says it was forced', () => {
    const draft = draftOf(item());
    expect(draft.multiple).toBe(false);
    expect(kindOf(draft)).toBe('single');
    expect(kindOf({ ...draft, correct: [0, 1] })).toBe('multiple');
    expect(kindForced({ ...draft, correct: [0, 1] })).toBe(true);
    // Back to one tick: back to the author's one answer.
    expect(kindOf({ ...draft, correct: [1] })).toBe('single');
  });

  it('turns «несколько ответов» back to one answer when the author says so', () => {
    const several = item({ kind: 'multiple', correct: [1] });
    expect(patchOf(several, { ...draftOf(several), multiple: false })).toEqual({ kind: 'single' });
  });

  it('a draft without the flag (an older caller) reads as one answer', () => {
    const older: Draft = { ...draftOf(item()) };
    delete older.multiple;
    expect(kindOf(older)).toBe('single');
    expect(inputOf({ ...older, correct: [0, 1] }, '7', 'man:x').kind).toBe('multiple');
  });

  it('a new question of «несколько ответов» is saved as such with one tick', () => {
    const draft: Draft = { ...emptyDraft(), stem: 'Q', options: [{ text: 'a', pictures: [] }, { text: 'b', pictures: [] }], correct: [1], multiple: true };
    expect(inputOf(draft, '1', 'man:y')).toMatchObject({ kind: 'multiple', correct: [1] });
  });
});

describe('ticks and options', () => {
  it('a tick on and off keeps the key in option order', () => {
    const draft: Draft = { ...emptyDraft(), options: [0, 1, 2].map(() => ({ text: 'x', pictures: [] })) };
    expect(toggleTick({ ...draft, correct: [2] }, 0).correct).toEqual([0, 2]);
    expect(toggleTick({ ...draft, correct: [0, 2] }, 2).correct).toEqual([0]);
  });
  it('«верно / неверно» takes one tick at a time', () => {
    expect(tickOnly({ ...emptyDraft(), correct: [0] }, 1).correct).toEqual([1]);
  });
  it('adds an empty option at the end', () => {
    expect(appendOption(emptyDraft()).options).toEqual([
      { text: '', pictures: [] },
      { text: '', pictures: [] },
      { text: '', pictures: [] },
    ]);
  });
});

describe('draftChanged', () => {
  it('follows patchOf for a question opened from the list', () => {
    expect(draftChanged(item(), draftOf(item()))).toBe(false);
    expect(draftChanged(item(), { ...draftOf(item()), explanation: 'Слева — вход.' })).toBe(true);
    // Spaces after the words are not a change.
    expect(draftChanged(item(), { ...draftOf(item()), stem: 'Что означает стрелка слева?  ' })).toBe(false);
  });
  it('compares a new question of «Вопросы и ключи» with the empty one', () => {
    expect(draftChanged(null, emptyDraft())).toBe(false);
    expect(draftChanged(null, { ...emptyDraft(), short: true })).toBe(false);
    expect(draftChanged(null, { ...emptyDraft(), stem: 'Что такое шлюз?' })).toBe(true);
    expect(draftChanged(null, { ...emptyDraft(), correct: [1] })).toBe(true);
    expect(draftChanged(null, { ...emptyDraft(), short: true, forms: 'Шлюз' })).toBe(true);
  });
});
