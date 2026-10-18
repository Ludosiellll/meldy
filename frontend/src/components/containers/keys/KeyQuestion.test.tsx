import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../lib/supabase', () => ({ supabase: { storage: { from: vi.fn() } } }));

import KeyQuestion, { Explanation } from './KeyQuestion';
import { EDITOR } from '../copyImport';

afterEach(cleanup);

const question = (explanation?: string | null) =>
  render(
    <KeyQuestion
      context="Вариант 1 · № 116"
      stem="Что означает стрелка слева?"
      options={['Вход', 'Управление', 'Выход']}
      kind="single"
      current={[0]}
      tapMode="none"
      explanation={explanation}
    />,
  );

describe('KeyQuestion: the explanation (release 47)', () => {
  it('shows «Пояснение» and the words under the options, line breaks kept', () => {
    question('Слева входит то, что блок меняет.\nСверху — управление.');
    const heading = screen.getByText(EDITOR.explanationShown);
    const block = heading.closest('.kq-explain') as HTMLElement;
    expect(block).not.toBeNull();
    expect(block.querySelector('.kq-explain-t')?.textContent).toBe('Слева входит то, что блок меняет.\nСверху — управление.');
    // After the options, inside the question's card.
    const options = document.querySelector('.kq-options')!;
    expect(options.compareDocumentPosition(block) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(block.closest('.kq')).not.toBeNull();
  });

  it('shows nothing without an explanation', () => {
    question(null);
    expect(screen.queryByText(EDITOR.explanationShown)).toBeNull();
    cleanup();
    question('   \n ');
    expect(screen.queryByText(EDITOR.explanationShown)).toBeNull();
    cleanup();
    question(undefined);
    expect(document.querySelector('.kq-explain')).toBeNull();
  });

  it('a short answer shows it too', () => {
    render(<KeyQuestion context="№ 5" stem="В каком году заключена Люблинская уния?" options={[]} kind="short" answers={['1569']} tapMode="none" explanation="Люблинский сейм, 1569 год." />);
    expect(screen.getByText('Люблинский сейм, 1569 год.')).toBeInTheDocument();
  });
});

describe('Explanation', () => {
  it('trims the blank lines around the words', () => {
    render(<Explanation text={'\n  Первое.\n\nВторое.  \n'} />);
    expect(document.querySelector('.kq-explain-t')?.textContent).toBe('Первое.\n\nВторое.');
  });
});
