import { describe, expect, it } from 'vitest';
import { withMode } from './LiveHostPage';

describe('the join link of a stand game says so', () => {
  it('adds mode=stand once, keeping the PIN and the address', () => {
    expect(withMode('https://ludosiel-studyforge.hf.space/play?pin=482913', 'stand')).toBe('https://ludosiel-studyforge.hf.space/play?pin=482913&mode=stand');
    expect(withMode('https://meldy.ru/play?pin=1&mode=boss', 'stand')).toBe('https://meldy.ru/play?pin=1&mode=stand');
    expect(withMode('/play?pin=482913', 'stand')).toBe('/play?pin=482913&mode=stand');
  });
});
