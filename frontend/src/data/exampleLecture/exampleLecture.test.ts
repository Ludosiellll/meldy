import { describe, expect, it } from 'vitest';
import { EXAMPLE_LECTURE_FILE, EXAMPLE_LECTURE_RESULTS, EXAMPLE_LECTURE_SOURCE, exampleLectureVoiceFile } from '.';
import { exampleLectureVoice } from '../../components/example/ExampleLecture';
import { resultTabs } from '../../components/resultSections';
import { SECTION_NAMES } from '../../utils/analysisSections';
import resultsSource from './results.json?raw';
import podcastVoice from './podcast-voice.json';

/**
 * The example of a lecture's result (/try/lecture) is shown as Meldy's real output: it must stay the analysis of the
 * exam example's own lecture, in the result screen's shape, with a voice file for every line of its podcast that says
 * that line, small enough for the Space (it refuses a pushed binary file over 100 KB) and for a phone.
 */
interface NodeFs {
  readFileSync(path: string): Uint8Array;
  readdirSync(path: string): string[];
}
// A specifier TypeScript does not resolve: the project has no Node types, and the test only runs in Node.
const NODE_FS: string = 'node:fs';
const nodeFs = async (): Promise<NodeFs> => (await import(/* @vite-ignore */ NODE_FS)) as NodeFs;
const HERE = decodeURIComponent(import.meta.url.replace(/^file:\/\//, ''));
const PODCAST_DIR = `${HERE.slice(0, HERE.lastIndexOf('/src/'))}/public/example/lecture/podcast/`;

describe('the example of a lecture’s result', () => {
  it('is the analysis of the exam example’s first lecture: its fragments are the lecture’s own paragraphs', () => {
    expect(EXAMPLE_LECTURE_SOURCE.title).toBe('Спрос и предложение');
    expect(EXAMPLE_LECTURE_FILE).toBe('Спрос и предложение.txt');
    const sources = EXAMPLE_LECTURE_RESULTS.grounding?.sources ?? [];
    expect(sources).toEqual(EXAMPLE_LECTURE_SOURCE.fragments.map((fragment) => ({ id: fragment.id, text: fragment.text })));
    expect(EXAMPLE_LECTURE_RESULTS.grounding?.source_count).toBe(7);
    // Every fragment a material points at is one of them.
    const known = new Set(sources.map((source) => source.id));
    const cited = [
      ...(EXAMPLE_LECTURE_RESULTS.summarizer.source_ids ?? []),
      ...(EXAMPLE_LECTURE_RESULTS.summarizer.terms ?? []).flatMap((term) => term.source_ids ?? []),
      ...EXAMPLE_LECTURE_RESULTS.flashcards.flashcards.flatMap((card) => card.source_ids ?? []),
      ...EXAMPLE_LECTURE_RESULTS.quiz.quiz.flatMap((question) => question.source_ids ?? []),
      ...(EXAMPLE_LECTURE_RESULTS.podcast?.podcast ?? []).flatMap((line) => line.source_ids ?? []),
    ];
    expect(cited.filter((id) => !known.has(id))).toEqual([]);
  });

  it('has all five materials, each made, in the shape the result screen takes', () => {
    expect(SECTION_NAMES.map((name) => EXAMPLE_LECTURE_RESULTS.sections?.[name]?.status)).toEqual(['ok', 'ok', 'ok', 'ok', 'ok']);
    expect(EXAMPLE_LECTURE_RESULTS.flashcards.flashcards).toHaveLength(6);
    expect(EXAMPLE_LECTURE_RESULTS.quiz.quiz).toHaveLength(5);
    expect(EXAMPLE_LECTURE_RESULTS.podcast?.podcast).toHaveLength(16);
    expect(EXAMPLE_LECTURE_RESULTS.cheatsheet?.content).toMatch(/Ключевые понятия/);
    const tabs = resultTabs(EXAMPLE_LECTURE_RESULTS, { showConversation: true, conversationCount: 16, showCheatsheet: true });
    expect(tabs.map((tab) => tab.id)).toEqual(['summary', 'flashcards', 'quiz', 'cheatsheet', 'podcast']);
  });

  it('carries nothing of the account it was made on', () => {
    expect(resultsSource).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
    expect(resultsSource).not.toMatch(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/);
    expect(resultsSource).not.toMatch(/"(receipt|user_id|original_text)"/);
  });

  it('has the voice of every podcast line, made for that very text and voice', () => {
    // podcast-voice.json is what the files were made from: a line whose words change needs its file made again.
    expect(exampleLectureVoice()).toEqual(podcastVoice);
    expect(exampleLectureVoiceFile(0)).toBe('/example/lecture/podcast/01.mp3');
  });

  it('keeps the voice files small: under 100 KB each (the Space) and about 1.5 MB in all', async () => {
    const fs = await nodeFs();
    const names = fs.readdirSync(PODCAST_DIR).sort();
    expect(names).toEqual(podcastVoice.map((line) => line.src.split('/').pop()));
    let total = 0;
    for (const name of names) {
      const bytes = fs.readFileSync(PODCAST_DIR + name);
      total += bytes.length;
      expect(bytes.length, name).toBeLessThan(100 * 1024);
      // MPEG audio: an ID3 tag or a frame sync at the start.
      const id3 = bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33;
      expect(id3 || (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0), name).toBe(true);
    }
    expect(total).toBeLessThan(1.5 * 1024 * 1024);
  });
});
