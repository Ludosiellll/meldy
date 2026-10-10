import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ContainersOverview } from '../../../types/container';

const api = vi.hoisted(() => ({ listExams: vi.fn() }));
vi.mock('../../../api/exams', () => ({ listExams: api.listExams }));

import { OLD_EXAMS_SHOWN, fetchOldExams, ownContainers, plainExams, targetOptions, type OldExam } from './targets';

const plain = (text: string) => text.replace(/ /g, ' ');
const labels = (options: Array<{ label: string }>) => options.map((option) => plain(option.label));
const TODAY = '2026-10-10';

const exam = (id: string, title: string, over: Partial<OldExam> = {}): OldExam => ({
  id, title, exam_date: '2026-10-21', questions: 20, created_at: '2026-10-07T12:00:00Z', ...over,
});

function overview(containers: Array<Partial<ContainersOverview['containers'][number]>>, attached: string[] = []): ContainersOverview {
  return {
    v: 1,
    day: TODAY,
    attached_exam_ids: attached,
    containers: containers.map((container, index) => ({
      id: `c${index}`, title: 'Экзамен', exam_date: null, created_at: '2026-10-01T12:00:00Z', role: 'owner', items: 0, items_updated_at: null,
      subjects: [], answers_today: 0, settings: null, ...container,
    })),
  };
}

beforeEach(() => api.listExams.mockReset());

describe('«Куда добавить» (spec decision 22; usability check 2026-10-10, m4)', () => {
  it('reads every oral exam with its number of questions as «Экзамены» counts them, newest first; never throws', async () => {
    api.listExams.mockResolvedValue([
      { id: 'a', title: ' Базы данных ', exam_date: '2026-10-21', total: 20, created_at: '2026-10-07T12:00:00Z' },
      { id: 'b', title: 'Право', exam_date: null, total: 60, created_at: '2026-10-09T12:00:00Z' },
      { id: 'c', title: 'Сети', exam_date: 'not a day', total: 5, created_at: '2026-10-08T12:00:00Z' },
    ]);
    expect(await fetchOldExams('user-1')).toEqual([
      { id: 'b', title: 'Право', exam_date: null, questions: 60, created_at: '2026-10-09T12:00:00Z' },
      { id: 'c', title: 'Сети', exam_date: null, questions: 5, created_at: '2026-10-08T12:00:00Z' },
      { id: 'a', title: 'Базы данных', exam_date: '2026-10-21', questions: 20, created_at: '2026-10-07T12:00:00Z' },
    ]);
    expect(api.listExams).toHaveBeenCalledWith('user-1');
    api.listExams.mockRejectedValueOnce(new Error('offline'));
    expect(await fetchOldExams('user-1')).toEqual([]);
  });

  it('names alone while they differ; two of one name get their date and size, copies equal in both the day made', () => {
    const one = targetOptions([], [exam('a', 'Базы данных'), exam('b', 'Право', { exam_date: null, questions: 60 })], [], TODAY);
    expect(labels(one)).toEqual(['Новый экзамен', 'К «Базы данных»', 'К «Право»']);
    expect(one.map((option) => option.value)).toEqual(['new', 'old:a', 'old:b']);
    // The QA's list: two copies of «Базы данных» (both 21 October, 20 questions), made on different days.
    const copies = targetOptions([], [exam('new', 'Базы данных', { created_at: '2026-10-09T12:00:00Z' }), exam('old', 'Базы данных')], [], TODAY);
    expect(labels(copies)).toEqual([
      'Новый экзамен',
      'К «Базы данных» · 21 октября · 20 вопросов · создан 9 октября',
      'К «Базы данных» · 21 октября · 20 вопросов · создан 7 октября',
    ]);
    // the date or the size tells them apart: no more than that
    const sizes = targetOptions([], [exam('x', 'Базы данных', { questions: 21, exam_date: null }), exam('y', 'базы данных')], [], TODAY);
    expect(labels(sizes)).toEqual(['Новый экзамен', 'К «Базы данных» · дата не указана · 21 вопрос', 'К «базы данных» · 21 октября · 20 вопросов']);
    // made the same day: its time too
    const first = '2026-10-07T09:05:00Z';
    const second = '2026-10-07T09:40:00Z';
    const time = (iso: string) => {
      const at = new Date(iso);
      return `${at.getHours()}:${String(at.getMinutes()).padStart(2, '0')}`;
    };
    const twins = targetOptions([], [exam('p', 'Базы данных', { created_at: second }), exam('q', 'Базы данных', { created_at: first })], [], TODAY);
    const dayOf = (iso: string) => new Date(iso).getDate();
    expect(labels(twins)).toEqual([
      'Новый экзамен',
      `К «Базы данных» · 21 октября · 20 вопросов · создан ${dayOf(second)} октября в ${time(second)}`,
      `К «Базы данных» · 21 октября · 20 вопросов · создан ${dayOf(first)} октября в ${time(first)}`,
    ]);
  });

  it('an exam with subjects of the same name as an oral exam: its date ahead and its size with its oral parts', () => {
    const containers = ownContainers(
      overview(
        [
          {
            id: 'box', title: 'Базы данных', exam_date: '2026-10-21', items: 34,
            subjects: [
              { id: 's1', position: 1, title: 'Базы данных', exam_date: null, oral_exam_id: 'inside', has_oral: true, keyed: 0, no_key: 0, seen: 0, two_days: 0, open_errors: 0, seen_today: 0, doubted: 0, stale: 0 },
              { id: 's2', position: 2, title: 'C#', exam_date: '2026-10-05', oral_exam_id: null, has_oral: false, keyed: 34, no_key: 0, seen: 0, two_days: 0, open_errors: 0, seen_today: 0, doubted: 0, stale: 0 },
            ],
          },
          { id: 'theirs', title: 'Чужой', role: 'member' },
        ],
        ['inside'],
      ),
    );
    expect(containers.map((container) => container.id)).toEqual(['box']);
    expect(containers[0]).toMatchObject({ subjects: 2, items: 34, dates: ['2026-10-05', '2026-10-21'], oralExamIds: ['inside'] });
    const options = targetOptions(containers, [exam('inside', 'Базы данных'), exam('copy', 'Базы данных', { questions: 20 })], ['inside'], TODAY);
    // the exam's size is the one its page says: 34 with variants and 20 oral; its nearest date ahead
    expect(labels(options)).toEqual(['Новый экзамен', 'К «Базы данных» · 21 октября · 54 вопроса', 'К «Базы данных» · 21 октября · 20 вопросов']);
    expect(options.map((option) => option.value)).toEqual(['new', 'c:box', 'old:copy']);
  });

  it('an oral exam inside an exam is not offered, and at most 50 are', () => {
    const many = Array.from({ length: OLD_EXAMS_SHOWN + 5 }, (_, i) => exam(`e${i}`, `Экзамен ${i}`));
    expect(plainExams(many, ['e0', 'e3'])).toHaveLength(OLD_EXAMS_SHOWN);
    expect(plainExams(many, ['e0', 'e3']).map((item) => item.id)).not.toContain('e3');
    expect(targetOptions([], many, ['e0'], TODAY)).toHaveLength(1 + OLD_EXAMS_SHOWN);
  });
});
