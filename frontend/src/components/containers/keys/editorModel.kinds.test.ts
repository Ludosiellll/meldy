import { describe, expect, it } from 'vitest';
import type { TestItem } from '../../../types/container';
import { draftOf, draftProblems, emptyDraft, inputOf, patchOf, resetsProgress, switchKind, type Draft } from './editorModel';

const row = (patch: Partial<TestItem>): TestItem => ({
  id: 'i1', container_id: 'c', subject_id: 's', position: 1, file_no: '1', topic: null, kind: 'single', stem: 'Вопрос',
  options: [], correct: [], answers: [], key_source: 'manual', code: false, keep_order: false, flags: [], rev: 1,
  updated_at: '', images: null, explanation: '', ...patch,
});
const blank = (kind: Parameters<typeof switchKind>[1], patch: Partial<Draft> = {}): Draft => ({ ...switchKind({ ...emptyDraft(), stem: 'Вопрос' }, kind), ...patch });

describe('the editor writes the new kinds', () => {
  it('a number: canonical values, the tolerance and the unit', () => {
    const draft = blank('number', { numbers: '9,8; 9.81', tolerance: '0,05', unit: ' м/с² ' });
    expect(draftProblems(draft)).toEqual([]);
    expect(inputOf(draft, '1', 'r:1')).toMatchObject({ kind: 'number', options: [], correct: [], answers: ['9.8', '9.81'], tolerance: '0.05', unit: 'м/с²' });
    expect(draftProblems(blank('number', { numbers: 'девять' }))).toContain('numbers');
    expect(draftProblems(blank('number', { numbers: '1', tolerance: '-1' }))).toContain('tolerance');
  });
  it('an order: the items in the right order, its key the identity', () => {
    const draft = blank('order', { options: [{ text: 'Один', pictures: [] }, { text: 'Два', pictures: [] }, { text: 'Три', pictures: [] }], partial: true });
    expect(inputOf(draft, '1', 'r:2')).toMatchObject({ kind: 'order', options: ['Один', 'Два', 'Три'], correct: [0, 1, 2], answers: [], partial: true });
  });
  it('a match: the pairs in the order of the left items, then the extras', () => {
    const draft = blank('match', {
      options: [{ text: 'Франция', pictures: [] }, { text: 'Германия', pictures: [] }],
      rights: ['Париж', 'Берлин'], extras: ['Рим', ' '],
    });
    expect(draftProblems(draft)).toEqual([]);
    expect(inputOf(draft, '1', 'r:3')).toMatchObject({ kind: 'match', options: ['Франция', 'Германия'], answers: ['Париж', 'Берлин', 'Рим'] });
    expect(draftProblems({ ...draft, rights: ['Париж', ''] })).toContain('pairs');
    expect(draftProblems({ ...draft, rights: ['Париж', 'париж'] })).toContain('pairs_same');
  });
  it('a cloze: a gap per run of underscores, the forms of each', () => {
    const draft = blank('cloze', { stem: 'Столица — ___, основана в ___ году', gaps: ['Москва; москва-град', '1147'] });
    expect(draftProblems(draft)).toEqual([]);
    expect(inputOf(draft, '1', 'r:4')).toMatchObject({ kind: 'cloze', answers: ['Москва\nмосква-град', '1147'] });
    expect(draftProblems({ ...draft, stem: 'Без пропусков' })).toContain('gaps');
    expect(draftProblems({ ...draft, gaps: ['Москва', ''] })).toContain('gap_forms');
  });
  it('an essay: the lectures, no key', () => {
    const input = inputOf(blank('essay', { materialIds: ['m1'] }), '1', 'r:5');
    expect(input).toMatchObject({ kind: 'essay', options: [], correct: [], answers: [], material_ids: ['m1'], key_source: 'none' });
  });
  it('reads a row back and sends only what changed', () => {
    const item = row({ kind: 'number', answers: ['9.8'], tolerance: 0.1, unit: 'м' });
    const draft = draftOf(item);
    expect(draft).toMatchObject({ kind: 'number', numbers: '9,8', tolerance: '0,1', unit: 'м' });
    expect(patchOf(item, draft)).toBeNull();
    expect(patchOf(item, { ...draft, tolerance: '0,2' })).toEqual({ tolerance: '0.2' });
    const match = row({ kind: 'match', options: ['а', 'б'], answers: ['1', '2', '3'] });
    expect(draftOf(match)).toMatchObject({ rights: ['1', '2'], extras: ['3'] });
    expect(patchOf(match, draftOf(match))).toBeNull();
    const cloze = row({ kind: 'cloze', stem: '___ и ___', answers: ['a\nb', 'c'] });
    expect(draftOf(cloze).gaps).toEqual(['a; b', 'c']);
    expect(patchOf(cloze, draftOf(cloze))).toBeNull();
  });
  it('a switch from a choice to a number sends the whole key', () => {
    const item = row({ kind: 'single', options: ['a', 'b'], correct: [0] });
    const draft = { ...switchKind(draftOf(item), 'number'), numbers: '5' };
    expect(patchOf(item, draft)).toMatchObject({ kind: 'number', options: [], correct: [], answers: ['5'], tolerance: null, unit: null });
  });
  it('partial credit of a multiple question', () => {
    const item = row({ kind: 'multiple', options: ['a', 'b', 'c'], correct: [0, 1] });
    expect(patchOf(item, { ...draftOf(item), partial: true })).toEqual({ partial: true });
    expect(draftOf({ ...item, partial: true }).partial).toBe(true);
    // an old question without partial credit reads and saves exactly as before
    expect('partial' in draftOf(item)).toBe(false);
  });
  it('says when everyone starts again', () => {
    const item = row({ kind: 'order', options: ['a', 'b', 'c'], correct: [0, 1, 2] });
    expect(resetsProgress(item, { options: ['A', 'B', 'C'] })).toBe(false);
    expect(resetsProgress(item, { options: ['b', 'a', 'c'] })).toBe(true);
    const number = row({ kind: 'number', answers: ['9.8'], tolerance: 0.1 });
    expect(resetsProgress(number, { answers: ['9.80'] })).toBe(false);
    expect(resetsProgress(number, { tolerance: '0.2' })).toBe(true);
  });
});
