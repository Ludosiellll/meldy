import { describe, expect, it } from 'vitest';
import { shortNorm as screens } from '../../components/containers/model';
import { shortNorm } from './norm';

describe('shortNorm of the kinds', () => {
  it('equals the screens’ shortNorm', () => {
    for (const s of ['Москва.', '  ЁЛКА  ', 'a b c', 'Ответ. ', '', 'x\n\ny', 'Итак...']) {
      expect(shortNorm(s)).toBe(screens(s));
    }
  });
});
