import { describe, expect, it } from 'vitest';
import vectors from '../../test/fixtures/oral_match_vectors.json';
import { browserCandidate, chooseFollowup, decideFollowup } from './followup';

function pointsOf(statuses: Record<string, string>, essential: string[]) {
  return Object.keys(statuses)
    .sort((a, b) => Number(a.slice(1)) - Number(b.slice(1)))
    .map((id) => ({ id, essential: essential.includes(id) }));
}

const followupVectors = vectors.followup as Array<{ essential: string[]; statuses: Record<string, string>; ask: string | null }>;

describe('follow-up rule (contracts §7.5, shared vectors)', () => {
  it.each(followupVectors)('ask for %#', ({ essential, statuses, ask }) => {
    expect(chooseFollowup(pointsOf(statuses, essential), statuses)).toBe(ask);
  });

  it('ignores unrated points', () => {
    expect(chooseFollowup([{ id: 'p1', essential: true }], { p1: 'unrated' })).toBeNull();
  });
});

describe('browser candidate', () => {
  const demo = vectors.points[0];
  const anchors = demo.anchors as Record<string, string[][]>;
  const points = ['p1', 'p2', 'p3', 'p4', 'p5'].map((id) => ({ id, essential: id !== 'p5', anchors: anchors[id] }));

  it('is the first essential point with an explicit miss (the demo answer → p4)', () => {
    expect(browserCandidate(points, demo.transcript)).toBe('p4');
  });

  it('skips non-essential points and returns null when nothing is explicitly missed', () => {
    expect(browserCandidate(points.map((point) => ({ ...point, essential: point.id === 'p1' })), demo.transcript)).toBeNull();
  });
});

describe('«Готово» decision table (contracts §7.2)', () => {
  it('keeps the candidate when the model confirms a gap', () => {
    for (const status of ['missing', 'partial', 'wrong']) {
      expect(decideFollowup('p4', { statuses: { p4: status }, ask: 'p2' })).toEqual({ pointId: 'p4', chosenBy: 'check' });
    }
  });

  it('switches to the point the model names when the candidate was covered', () => {
    expect(decideFollowup('p4', { statuses: { p4: 'covered', p2: 'wrong' }, ask: 'p2' })).toEqual({ pointId: 'p2', chosenBy: 'check' });
  });

  it('asks the model’s point when the browser had no candidate', () => {
    expect(decideFollowup(null, { statuses: { p3: 'partial' }, ask: 'p3' })).toEqual({ pointId: 'p3', chosenBy: 'check' });
  });

  it('asks nothing when the model says everything is covered', () => {
    expect(decideFollowup('p4', { statuses: { p4: 'covered' }, ask: null })).toBeNull();
  });

  it('falls back to the browser candidate on a timeout and to nothing without one', () => {
    expect(decideFollowup('p4', null)).toEqual({ pointId: 'p4', chosenBy: 'client' });
    expect(decideFollowup(null, null)).toBeNull();
  });
});

describe('saysDontKnow', () => {
  it('takes a short «не знаю» said or typed as the button', async () => {
    const { saysDontKnow } = await import('./followup');
    for (const text of ['не знаю', 'Не знаю.', 'я не знаю', 'Ну, не знаю…', 'не помню', 'Затрудняюсь ответить', 'забыла', 'НЕ ЗНАЮ!']) {
      expect(saysDontKnow(text), text).toBe(true);
    }
  });

  it('leaves real answers to the check', async () => {
    const { saysDontKnow } = await import('./followup');
    for (const text of ['', 'не знаю точно, но колебания растут', 'знаю: колебания', 'не знаю как сказать, выручка падает', 'нет']) {
      expect(saysDontKnow(text), text).toBe(false);
    }
  });
});
