import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import KeySource from './KeySource';
import type { ImportFile } from './importModel';

/** A file whose key Meldy found by «+», with two more marks in it. */
function file(over: Partial<ImportFile> = {}, result: Record<string, unknown> = {}): ImportFile {
  return {
    id: 'f1',
    name: 'Вопросы.txt',
    importId: 'imp-1',
    source: 'text',
    format: 'txt',
    keyText: '',
    keyFileName: null,
    result: {
      items: [
        { options: ['а', 'б'], evidence: 'marker' },
        { options: ['а', 'б'], evidence: 'marker' },
      ],
      warnings: [],
      key_source: { marker: 2 },
      format_signals: { bold: { one: 5, many: 0 } },
      ...result,
    },
    ...over,
  } as unknown as ImportFile;
}

function show(props: Partial<Parameters<typeof KeySource>[0]> = {}) {
  const handlers = { onSignal: vi.fn(), onKeyText: vi.fn(), onKeyFile: vi.fn(), onKeySection: vi.fn(), onClose: vi.fn() };
  render(<KeySource file={file()} signal="auto" busy={false} focusKeyText={false} {...handlers} {...props} />);
  return handlers;
}

describe('KeySource: «Где в файле верные ответы?» (owner 19.11)', () => {
  afterEach(cleanup);

  it('asks one question, says in a sentence what Meldy found, and has «Готово» right under the choice', () => {
    const handlers = show();
    expect(screen.getByRole('heading', { name: 'Где в файле верные ответы?' })).toBeInTheDocument();
    expect(document.querySelector('.im-keysrc-lede')?.textContent?.replace(/ /g, ' ')).toBe(
      'Meldy считает верным вариант со знаком «+». Если это не так, выберите, как на самом деле.',
    );
    const radios = screen.getAllByRole('radio').map((radio) => radio.closest('label')?.textContent?.replace(/ /g, ' '));
    expect(radios).toEqual(['Как нашёл Meldy', 'Жирным — в 5 вопросах', 'Верный всегда первый вариант', 'В файле ответы не отмечены']);
    // the button stands before the block of the key kept apart, not under it
    const done = screen.getByRole('button', { name: 'Готово' });
    const apart = document.querySelector('details.im-apart') as HTMLDetailsElement;
    expect(done.compareDocumentPosition(apart) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    fireEvent.click(done);
    expect(handlers.onClose).toHaveBeenCalledTimes(1);
  });

  it('a choice goes to the page at once', () => {
    const handlers = show();
    fireEvent.click(screen.getByRole('radio', { name: 'Верный всегда первый вариант' }));
    expect(handlers.onSignal).toHaveBeenCalledWith('first_option');
  });

  it('the key kept apart is shut until asked for; open when the page came for the list or a key is there already', () => {
    show();
    expect((document.querySelector('details.im-apart') as HTMLDetailsElement).open).toBe(false);
    expect(screen.getByText('Ответы лежат отдельно: в другом файле или списком')).toBeInTheDocument();
    cleanup();
    show({ focusKeyText: true });
    expect((document.querySelector('details.im-apart') as HTMLDetailsElement).open).toBe(true);
    expect(document.activeElement).toBe(screen.getByLabelText('Или вставьте ответы списком'));
    cleanup();
    show({ file: file({ keyText: '1 – а' }) });
    expect((document.querySelector('details.im-apart') as HTMLDetailsElement).open).toBe(true);
  });

  it('the list: an empty one says what to paste, a filled one goes to the importer', () => {
    const handlers = show({ focusKeyText: true });
    fireEvent.click(screen.getByRole('button', { name: 'Применить список' }));
    expect(handlers.onKeyText).not.toHaveBeenCalled();
    expect(screen.getByText('Вставьте ключ: номер вопроса и букву ответа.')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Или вставьте ответы списком'), { target: { value: '1 – б, 2 – а' } });
    fireEvent.click(screen.getByRole('button', { name: 'Применить список' }));
    expect(handlers.onKeyText).toHaveBeenCalledWith('1 – б, 2 – а');
  });

  it('a file without a found key says so', () => {
    show({ file: file({}, { key_source: {}, format_signals: {} }) });
    expect(document.querySelector('.im-keysrc-lede')?.textContent?.replace(/ /g, ' ')).toBe(
      'Meldy не нашёл в файле отмеченных ответов. Выберите, как они отмечены.',
    );
  });
});
