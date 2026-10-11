import { describe, expect, it } from 'vitest';
import { stripSourceMarkers } from './sourceMarkers';
import { stripSourceMarkers as fromFragmentModel } from './fragmentModel';

describe('stripSourceMarkers', () => {
  it('drops single marks, lists and runs of marks with the space before them', () => {
    expect(stripSourceMarkers('Клетка — единица живого [S01].')).toBe('Клетка — единица живого.');
    expect(stripSourceMarkers('Щиты [S01, S02].')).toBe('Щиты.');
    expect(stripSourceMarkers('Энергия [S04], [S05] и белки [S1;S2].')).toBe('Энергия и белки.');
    expect(stripSourceMarkers('[S03] В начале строки')).toBe(' В начале строки');
  });

  it('leaves other brackets and words alone', () => {
    expect(stripSourceMarkers('Массив a[1] и [см. выше], S01 без скобок')).toBe('Массив a[1] и [см. выше], S01 без скобок');
  });

  it('is the one the summary model has used all along', () => {
    expect(fromFragmentModel).toBe(stripSourceMarkers);
  });
});
