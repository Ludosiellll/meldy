import { describe, expect, it } from 'vitest';
import { EXAMPLE_LECTURES, EXAMPLE_QUESTIONS } from '../../data/example';
import { Q7 } from '../../data/ticketExample';
import { buildTopics, isClosed, learnLeftLine, tally, topicClosedLine, type LearnLeftExam, type Step } from '../../lib/containers/topics';
import {
  COUNTED_AT,
  FILL_AT,
  LEARNED_AT,
  LEFT_WORDS,
  MARK_AT,
  MARKED,
  ORAL_AT,
  PICK,
  POP,
  Q7_STATUSES,
  Q7_TEXT,
  RESULT_IN,
  RESULT_LINE,
  SUM_AT,
  TOPICS_AFTER,
  TOPICS_BEFORE,
  TOPIC_AFTER,
  TOPIC_BEFORE,
} from './StoryScenes';
import { LOGIN_SCRIPT, REGISTER_SCRIPT, leaveOf } from './script';

const example = (number: number) => EXAMPLE_QUESTIONS.find((question) => question.number === number)!;
const plain = (text: string) => text.replace(/ /g, ' ');
const STATE: Record<Step, 0 | 1 | 3> = { none: 0, started: 1, done: 3 };

/** The example exam as `learn_left` would send it, each question at the step the reel's topics give it. */
function exampleExam(topics: typeof TOPICS_BEFORE): LearnLeftExam {
  const step = new Map(topics.flatMap((topic) => topic.questions.map((q) => [Number(q.n), q.step] as const)));
  return {
    examId: 'example',
    title: 'Микроэкономика',
    mappingState: 'done',
    lectures: EXAMPLE_LECTURES.map((lecture) => ({ id: lecture.materialId, title: lecture.title })),
    sectionTitles: [],
    toWrite: 0,
    units: 0,
    questions: EXAMPLE_QUESTIONS.map((question) => {
      const at = step.get(question.number) ?? 'none';
      // Question 7 before the answer: every main point named the day before, waiting for another day.
      const state = question.number === 7 && at === 'started' ? 2 : STATE[at];
      return {
        id: `q${question.number}`,
        position: question.number,
        label: String(question.number),
        section: null,
        lecture: question.lecture ? EXAMPLE_LECTURES.findIndex((lecture) => lecture.key === question.lecture) : null,
        kind: question.lecture && question.points.length > 0 ? 'lines' : 'none',
        state,
        named: 0,
        of: question.points.filter((point) => point.essential).length,
        learnedAt: null,
        readyAt: null,
        missed: false,
      };
    }),
  };
}

const shape = (topics: typeof TOPICS_BEFORE) => topics.map((topic) => [topic.title, topic.questions.map((q) => [q.n, q.step])]);

describe('the oral example of the sign-in reels', () => {
  it('is /try\'s question 7, word for word', () => {
    expect(Q7_TEXT).toBe(example(7).text);
    expect(Q7.points.map((point) => point.text)).toEqual(example(7).points.map((point) => point.short));
  });

  it('names every main point in the answer itself, so the answer can make the question learned', () => {
    expect(Q7_STATUSES).toHaveLength(Q7.points.length);
    Q7.points.forEach((point, index) => {
      if (point.essential) expect(Q7_STATUSES[index]).toBe('covered');
    });
    // The protocol's own line for these points.
    expect(plain(RESULT_LINE)).toBe('Сами назвали 3 из 3 главных пунктов');
  });
});

describe('«Осталось выучить» in the reel', () => {
  it('groups the example exam as the app does: a topic a lecture, question 12 (in no lecture) left out', () => {
    const before = buildTopics({ oral: exampleExam(TOPICS_BEFORE) });
    expect(before.sources).toEqual(['lectures']);
    expect(before.out.map((q) => q.n)).toEqual(['12']);
    expect(shape(TOPICS_BEFORE)).toEqual(shape(before.topics));
  });

  it('closes «Эластичность спроса» with question 7, its last open question, and only that', () => {
    expect(TOPIC_BEFORE.title).toBe(EXAMPLE_LECTURES.find((lecture) => lecture.key === example(7).lecture)!.title);
    expect(TOPIC_BEFORE.questions.filter((q) => q.step !== 'done').map((q) => q.n)).toEqual(['7']);
    expect(isClosed(TOPIC_BEFORE)).toBe(false);
    expect(isClosed(TOPIC_AFTER)).toBe(true);
    // The other topics do not move.
    expect(shape(TOPICS_AFTER).filter((_, index) => index !== 1)).toEqual(shape(TOPICS_BEFORE).filter((_, index) => index !== 1));
    // The same as the app's grouping once question 7 is learned.
    const after = buildTopics({ oral: exampleExam(TOPICS_AFTER) });
    expect(shape(TOPICS_AFTER)).toEqual(shape(after.topics));
  });

  it('says it in the app\'s words: the count of topics left, the topic\'s line, «Тема выучена»', () => {
    expect(LEFT_WORDS.title).toBe('Осталось выучить');
    expect(LEFT_WORDS.count).toEqual([3, 2]);
    expect(LEFT_WORDS.of.map(plain)).toEqual(['темы из 3', 'темы из 3']);
    expect(LEFT_WORDS.row.map(plain)).toEqual(['Остался 1 вопрос из 4', 'Все 4 вопроса выучены.']);
    expect(LEFT_WORDS.learned).toBe('Тема выучена');
  });

  it('tells screen readers the same: the protocol\'s line, the topic learned, the topics left', () => {
    const after = tally(TOPICS_AFTER);
    for (const script of [LOGIN_SCRIPT, REGISTER_SCRIPT]) {
      const index = script.scenes.findIndex((scene) => scene.id === 'oral');
      const line = script.transcript[index];
      expect(line).toContain(plain(RESULT_LINE));
      expect(line).toContain(plain(topicClosedLine(TOPIC_AFTER)));
      expect(line).toContain(plain(learnLeftLine(after.left, after.total)));
    }
  });
});

describe('the timing of the oral beat', () => {
  it('comes forward after the voice, marks the points one by one, then the line, the bar, the topic and the count', () => {
    expect(RESULT_IN).toBeLessThan(ORAL_AT);
    expect(MARK_AT(0)).toBe(ORAL_AT);
    for (let index = 1; index < Q7.points.length; index += 1) expect(MARK_AT(index)).toBeGreaterThan(MARK_AT(index - 1));
    expect(SUM_AT).toBeGreaterThan(MARK_AT(Q7.points.length - 1));
    expect(FILL_AT).toBeGreaterThan(SUM_AT);
    // The topic is learned once its bar is full, the count goes down after it.
    expect(LEARNED_AT).toBeGreaterThanOrEqual(FILL_AT + 380);
    expect(COUNTED_AT).toBeGreaterThan(LEARNED_AT);
  });

  it('plays inside its beat in both reels, with time to read the end; the session beat too', () => {
    for (const script of [LOGIN_SCRIPT, REGISTER_SCRIPT]) {
      expect(COUNTED_AT + POP + 600).toBeLessThan(leaveOf(script, 'oral'));
      expect(MARKED + 260 + 620).toBeLessThan(leaveOf(script, 'session'));
    }
    expect(PICK).toBeLessThan(MARKED);
  });
});
