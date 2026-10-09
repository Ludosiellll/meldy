import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ATTACHED_EXAMS_KEY,
  CONTAINER_TITLES_EVENT,
  CONTAINER_TITLES_KEY,
  containerOfExam,
  containerTitle,
  onContainerTitles,
  rememberAttachedExams,
  rememberContainerTitle,
} from './titleCache';

const C1 = 'f4881273-7331-4c39-96d7-f2ce4a31a1c0';
const C2 = '0b6f3c2e-9a1d-4e7b-8c5a-2d4e6f8a0b1c';
const ORAL = 'c0390f9c-787d-4d0e-a82d-9efa069bfe11';
const ORAL2 = '5d1e7a9c-3b2f-4c6d-9e8a-1f0b2c3d4e5f';

beforeEach(() => {
  window.sessionStorage.clear();
  window.localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('container titles (this tab)', () => {
  it('remembers a title in sessionStorage and gives it back', () => {
    expect(containerTitle(C1)).toBeNull();
    rememberContainerTitle(C1, '  Зимняя сессия ');
    expect(containerTitle(C1)).toBe('Зимняя сессия');
    expect(JSON.parse(window.sessionStorage.getItem(CONTAINER_TITLES_KEY)!)).toEqual({ [C1]: 'Зимняя сессия' });
    expect(window.localStorage.getItem(CONTAINER_TITLES_KEY)).toBeNull();
    rememberContainerTitle(C1, 'Сессия, январь');
    expect(containerTitle(C1)).toBe('Сессия, январь');
  });

  it('ignores an empty id or title and cuts a long title', () => {
    rememberContainerTitle('', 'Зимняя сессия');
    rememberContainerTitle(C1, '   ');
    expect(window.sessionStorage.getItem(CONTAINER_TITLES_KEY)).toBeNull();
    rememberContainerTitle(C1, 'Э'.repeat(500));
    expect(containerTitle(C1)).toHaveLength(200);
    expect(containerTitle('')).toBeNull();
  });

  it('keeps the 50 latest titles', () => {
    for (let n = 0; n < 60; n += 1) rememberContainerTitle(`container-${n}`, `Экзамен ${n}`);
    expect(Object.keys(JSON.parse(window.sessionStorage.getItem(CONTAINER_TITLES_KEY)!))).toHaveLength(50);
    expect(containerTitle('container-9')).toBeNull();
    expect(containerTitle('container-10')).toBe('Экзамен 10');
    expect(containerTitle('container-59')).toBe('Экзамен 59');
    // Seen again, an old title moves to the end and stays.
    rememberContainerTitle('container-10', 'Экзамен 10, снова');
    for (let n = 60; n < 75; n += 1) rememberContainerTitle(`container-${n}`, `Экзамен ${n}`);
    expect(containerTitle('container-10')).toBe('Экзамен 10, снова');
  });

  it('reads nothing from what it did not write', () => {
    window.sessionStorage.setItem(CONTAINER_TITLES_KEY, '{not json');
    expect(containerTitle(C1)).toBeNull();
    window.sessionStorage.setItem(CONTAINER_TITLES_KEY, JSON.stringify([C1, 'Зимняя сессия']));
    expect(containerTitle(C1)).toBeNull();
    window.sessionStorage.setItem(CONTAINER_TITLES_KEY, JSON.stringify({ [C1]: 42 }));
    expect(containerTitle(C1)).toBeNull();
    rememberContainerTitle(C1, 'Зимняя сессия');
    expect(containerTitle(C1)).toBe('Зимняя сессия');
  });
});

describe('oral exams inside containers', () => {
  const MAP = {
    [ORAL]: { containerId: C1, title: 'Зимняя сессия' },
    [ORAL2]: { containerId: C2, title: 'Микроэкономика и Статистика' },
  };

  it('remembers the map in sessionStorage and a copy in localStorage', () => {
    rememberAttachedExams(MAP);
    expect(containerOfExam(ORAL)).toEqual({ containerId: C1, title: 'Зимняя сессия' });
    expect(containerOfExam(ORAL2)).toEqual({ containerId: C2, title: 'Микроэкономика и Статистика' });
    expect(containerOfExam('exam-outside')).toBeNull();
    expect(JSON.parse(window.sessionStorage.getItem(ATTACHED_EXAMS_KEY)!)).toEqual(MAP);
    expect(JSON.parse(window.localStorage.getItem(ATTACHED_EXAMS_KEY)!)).toEqual(MAP);
  });

  it('knows them in a new tab, from the device’s copy', () => {
    rememberAttachedExams(MAP);
    window.sessionStorage.clear();
    expect(containerOfExam(ORAL)).toEqual({ containerId: C1, title: 'Зимняя сессия' });
  });

  it('replaces the whole map each time: an exam no longer in a container is forgotten', () => {
    rememberAttachedExams(MAP);
    rememberAttachedExams({ [ORAL2]: MAP[ORAL2] });
    expect(containerOfExam(ORAL)).toBeNull();
    expect(containerOfExam(ORAL2)).toEqual(MAP[ORAL2]);
    rememberAttachedExams({});
    expect(containerOfExam(ORAL2)).toBeNull();
    // This tab's own empty map wins over an older copy on the device.
    window.localStorage.setItem(ATTACHED_EXAMS_KEY, JSON.stringify(MAP));
    expect(containerOfExam(ORAL)).toBeNull();
  });

  it('skips entries without a container or a title', () => {
    rememberAttachedExams({
      [ORAL]: { containerId: '', title: 'Зимняя сессия' },
      [ORAL2]: { containerId: C2, title: '  ' },
      'exam-3': { containerId: C1, title: 'Зимняя сессия' },
    });
    expect(containerOfExam(ORAL)).toBeNull();
    expect(containerOfExam(ORAL2)).toBeNull();
    expect(containerOfExam('exam-3')).toEqual({ containerId: C1, title: 'Зимняя сессия' });
  });

  it('lends its titles to containerTitle; a title the container’s page remembered comes first', () => {
    rememberAttachedExams(MAP);
    expect(containerTitle(C1)).toBe('Зимняя сессия');
    rememberContainerTitle(C1, 'Зимняя сессия 2027');
    expect(containerTitle(C1)).toBe('Зимняя сессия 2027');
    window.sessionStorage.clear();
    expect(containerTitle(C2)).toBe('Микроэкономика и Статистика');
  });
});

describe('storage that fails', () => {
  it('never throws when storage is blocked: nothing is known, nothing breaks', () => {
    const blocked = () => {
      throw new DOMException('The operation is insecure.', 'SecurityError');
    };
    vi.spyOn(window, 'sessionStorage', 'get').mockImplementation(blocked);
    vi.spyOn(window, 'localStorage', 'get').mockImplementation(blocked);
    expect(() => rememberContainerTitle(C1, 'Зимняя сессия')).not.toThrow();
    expect(() => rememberAttachedExams({ [ORAL]: { containerId: C1, title: 'Зимняя сессия' } })).not.toThrow();
    expect(containerTitle(C1)).toBeNull();
    expect(containerOfExam(ORAL)).toBeNull();
  });

  it('keeps working when the device copy cannot be written (full)', () => {
    const setItem = Storage.prototype.setItem;
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key: string, value: string) {
      if (this === window.localStorage) throw new DOMException('Quota exceeded', 'QuotaExceededError');
      setItem.call(this, key, value);
    });
    expect(() => rememberAttachedExams({ [ORAL]: { containerId: C1, title: 'Зимняя сессия' } })).not.toThrow();
    expect(containerOfExam(ORAL)).toEqual({ containerId: C1, title: 'Зимняя сессия' });
    expect(window.localStorage.getItem(ATTACHED_EXAMS_KEY)).toBeNull();
  });
});

describe('telling the top line', () => {
  it('fires an event on every change, and the listener can stop', () => {
    const listener = vi.fn();
    const stop = onContainerTitles(listener);
    rememberContainerTitle(C1, 'Зимняя сессия');
    rememberContainerTitle(C1, 'Зимняя сессия'); // the same title: nothing changed
    rememberAttachedExams({ [ORAL]: { containerId: C1, title: 'Зимняя сессия' } });
    expect(listener).toHaveBeenCalledTimes(2);
    stop();
    rememberContainerTitle(C2, 'Летняя сессия');
    expect(listener).toHaveBeenCalledTimes(2);
    const direct = vi.fn();
    window.addEventListener(CONTAINER_TITLES_EVENT, direct);
    rememberContainerTitle(C2, 'Летняя сессия, июнь');
    window.removeEventListener(CONTAINER_TITLES_EVENT, direct);
    expect(direct).toHaveBeenCalledTimes(1);
  });
});
