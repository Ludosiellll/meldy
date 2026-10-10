import { IMPORT, KEY_WORDS, nb } from '../copyImport';
import type { DraftSubject } from './importModel';

/**
 * The preview's subjects (Concept 1 §3.2 with the design critique I11): rows of one card, the name and one line —
 * «240 вопросов · ключ жирным», «80 устных вопросов», «30 вопросов · ключ жирным · 20 устных», a part of a long oral
 * list «150 устных вопросов · вопросы 1–150». The whole row opens the subject's preview.
 */

export function rowMeta(subject: DraftSubject): string {
  const parts: string[] = [];
  const test = subject.test.length + subject.blocked.length;
  if (test > 0) {
    parts.push(IMPORT.rowTest(test));
    parts.push(subject.keyed > 0 ? KEY_WORDS[subject.keySource ?? 'none'] ?? KEY_WORDS.none : IMPORT.rowNoKey);
  }
  if (subject.oral.length > 0) parts.push(test > 0 ? IMPORT.rowOralTail(subject.oral.length) : IMPORT.rowOral(subject.oral.length));
  if (subject.oralRange) parts.push(IMPORT.rowRange(subject.oralRange[0], subject.oralRange[1]));
  return parts.join(' · ');
}

interface Props {
  subjects: DraftSubject[];
  disabled: boolean;
  onOpen: (key: string) => void;
}

export default function SubjectRows({ subjects, disabled, onOpen }: Props) {
  return (
    <ul className="im-rows">
      {subjects.map((subject) => (
        <li key={subject.key}>
          <button type="button" className="im-row" disabled={disabled} onClick={() => onOpen(subject.key)}>
            <span className="im-row-title">{subject.title}</span>
            <span className="im-row-meta">{nb(rowMeta(subject))}</span>
            <svg className="im-row-go" viewBox="0 0 20 20" aria-hidden="true">
              <path d="M8 5l5 5-5 5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        </li>
      ))}
    </ul>
  );
}
