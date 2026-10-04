import { describe, expect, it } from 'vitest';
import { displayMaterialTitle } from './materialTitle';

describe('displayMaterialTitle', () => {
  it('turns a file name with underscores into readable words', () => {
    expect(displayMaterialTitle('22_Тема_4_3_Использование_роли_пользователей_и_формальные_цели_Демонстрация')).toBe(
      'Тема 4.3 Использование роли пользователей и формальные цели Демонстрация',
    );
  });

  it('drops known file extensions but keeps dotted numbers', () => {
    expect(displayMaterialTitle('Лекция_2_1_Спрос.pdf')).toBe('Лекция 2.1 Спрос');
    expect(displayMaterialTitle('Тема 4.3 Эластичность')).toBe('Тема 4.3 Эластичность');
    expect(displayMaterialTitle('Модель OSI v2.1')).toBe('Модель OSI v2.1');
  });

  it('leaves ordinary titles alone and capitalises the first letter', () => {
    expect(displayMaterialTitle('Эластичность спроса')).toBe('Эластичность спроса');
    expect(displayMaterialTitle('основы нейронных сетей')).toBe('Основы нейронных сетей');
  });

  it('falls back for empty values', () => {
    expect(displayMaterialTitle('')).toBe('Без названия');
    expect(displayMaterialTitle(null)).toBe('Без названия');
    expect(displayMaterialTitle('  ', 'Лекция')).toBe('Лекция');
  });

  it('does not strip a number that is the whole title', () => {
    expect(displayMaterialTitle('1984')).toBe('1984');
  });
});
