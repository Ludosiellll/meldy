import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import SummaryView, { stripSourceMarkers } from './SummaryView';

afterEach(cleanup);

describe('stripSourceMarkers', () => {
  it('drops the fragment labels the model copied from its input, and nothing else', () => {
    expect(stripSourceMarkers('Выходной слой выдаёт результат. [S02]')).toBe('Выходной слой выдаёт результат.');
    expect(stripSourceMarkers('Градиент [S01][S03] и шаг [S04], [S05] обучения.')).toBe('Градиент и шаг обучения.');
    expect(stripSourceMarkers('Массив [i] и ссылка [Source] остаются.')).toBe('Массив [i] и ссылка [Source] остаются.');
  });
});

describe('<SummaryView>', () => {
  it('shows sections without «01» counters and without raw [S02] labels', () => {
    render(
      <SummaryView
        data={{ content: '## Архитектура\n\nТри типа слоёв. [S02]\n\n## Обучение\n\nОбратное распространение [S03].', terms: [], source_ids: ['S02', 'S03'] } as never}
        sources={[
          { id: 'S02', text: 'Типичная сеть включает три типа слоёв.' },
          { id: 'S03', text: 'Ошибка распространяется назад.' },
        ]}
      />,
    );
    expect(screen.getByRole('heading', { level: 2, name: 'Архитектура' })).toBeInTheDocument();
    expect(screen.getByText('Три типа слоёв.')).toBeInTheDocument();
    expect(screen.getByText('Обратное распространение.')).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/\[S\d+\]/);
    expect(document.body.textContent).not.toMatch(/\b01\b/);
    // The fragments are named in words: «фрагменты 2, 3».
    expect(screen.getByRole('button', { name: /Ближайшие фрагменты лекции/ })).toHaveTextContent('фрагменты 2, 3');
  });
});
