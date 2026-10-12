import { useEffect, useLayoutEffect } from 'react';
import { Link } from 'react-router-dom';
import ResultsPanel from '../ResultsPanel';
import { conversationVoiceLines } from '../conversation/ConversationPlayer';
import { glue } from '../exams/sheetModel';
import TryBar, { TRY_LECTURE_WHERE } from './TryBar';
import {
  EXAMPLE_LECTURE_FILE,
  EXAMPLE_LECTURE_RESULTS,
  EXAMPLE_LECTURE_SOURCE,
  exampleLectureVoiceFile,
} from '../../data/exampleLecture';
import { setTTSVoiceFiles, type TTSVoiceFile } from '../../utils/tts';
import { track } from '../../lib/telemetry';
import { useDocumentTitle } from '../../lib/useDocumentTitle';
import '../../pages/Analyze.css';
import './exampleLecture.css';

/** What the page is, on top of it. */
export const LECTURE_EXAMPLE_NOTE = `Пример: так Meldy разобрал лекцию «${EXAMPLE_LECTURE_SOURCE.title}» из примера экзамена.`;

/** The podcast's voice: each line's own file, with the text and the host's voice the player gives it. */
export function exampleLectureVoice(): TTSVoiceFile[] {
  return conversationVoiceLines(EXAMPLE_LECTURE_RESULTS.podcast?.podcast ?? []).map((line, index) => ({
    ...line,
    src: exampleLectureVoiceFile(index),
  }));
}

/**
 * «Разбор лекции» of the example (/try/lecture): the result screen a student sees after «Разобрать лекцию»
 * (components/ResultsPanel, as on the analysis page) with one real analysis of the exam example's first lecture
 * (data/exampleLecture). Nothing is asked of a server: the panel shows a result that is not saved (`preview`: no
 * renaming, no «Создать … заново», no journal of the test), it has no «Новый анализ», «Экспорт» makes its files in the
 * browser, and the podcast plays the voice of its lines from files beside the page instead of /api/tts.
 */
export default function ExampleLecture() {
  useDocumentTitle('Разбор лекции · пример');
  useEffect(() => track('try_lecture_opened'), []);
  // Before the panel's own effects: as soon as it is on screen it asks for the voice of the podcast's first lines.
  useLayoutEffect(() => {
    setTTSVoiceFiles(exampleLectureVoice());
    return () => setTTSVoiceFiles(null);
  }, []);

  return (
    <>
      <TryBar where={TRY_LECTURE_WHERE} back="/try" />
      <main className="sf-page az tl-page" data-phase="done">
        <p className="ex-note tl-note">
          {glue(LECTURE_EXAMPLE_NOTE)}{' '}
          {/* On a computer the top line has the way back. */}
          <Link className="sf-link tx-narrow-only" to="/try">
            К примеру экзамена
          </Link>
        </p>
        <ResultsPanel
          results={EXAMPLE_LECTURE_RESULTS}
          textLength={EXAMPLE_LECTURE_SOURCE.text.length}
          sourceFileName={EXAMPLE_LECTURE_FILE}
          preview
        />
      </main>
    </>
  );
}
