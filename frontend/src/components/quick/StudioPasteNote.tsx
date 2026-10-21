import { useState } from 'react';
import { parsePaste } from '../../api/containers';
import { STUDIO_PASTE } from './copyQuick';
import { replaceParagraphs, studioMarkup, type StudioQuestions } from './studioPaste';
import './studioPaste.css';

/**
 * «Вопросов не нашлось» in the studio's «Текст» (UX audit of 21.10, P3; mockup m6): the paragraphs «Применить» was about
 * to add read like questions from Word. «Сделать вопросами» reads them with the quick test's parse and hands the text
 * back with the questions in the marks of «Текст»; «Оставить текстом» applies the paragraphs as they are.
 */
export default function StudioPasteNote({
  text,
  paragraphs,
  onMade,
  onKeep,
}: {
  text: string;
  paragraphs: string[];
  onMade: (text: string, made: StudioQuestions) => void;
  onKeep: () => void;
}) {
  const [phase, setPhase] = useState<'ask' | 'making' | 'none' | 'failed'>('ask');
  const make = async () => {
    setPhase('making');
    try {
      const result = await parsePaste(paragraphs.join('\n\n'));
      const made = studioMarkup(result);
      if (made.found === 0) {
        setPhase('none');
        return;
      }
      onMade(replaceParagraphs(text, paragraphs, made.markup), made);
    } catch {
      setPhase('failed');
    }
  };
  return (
    <div className="sp-note" role="region" aria-label={STUDIO_PASTE.noneTitle}>
      <p className="sp-note-t">{STUDIO_PASTE.noneTitle}</p>
      <p className="sp-note-p" role={phase === 'none' || phase === 'failed' ? 'alert' : undefined}>
        {phase === 'none' ? STUDIO_PASTE.notFound : phase === 'failed' ? STUDIO_PASTE.failed : STUDIO_PASTE.noneText}
      </p>
      <p className="sp-note-acts">
        {phase === 'none' ? null : (
          <button type="button" className="sf-primary sp-make" disabled={phase === 'making'} aria-busy={phase === 'making' || undefined} onClick={() => void make()}>
            {phase === 'making' ? STUDIO_PASTE.making : STUDIO_PASTE.make}
          </button>
        )}
        <button type="button" className="sf-link" data-muted="" disabled={phase === 'making'} onClick={onKeep}>
          {STUDIO_PASTE.asText}
        </button>
      </p>
    </div>
  );
}
