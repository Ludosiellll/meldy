import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import ExaminerLine, { ExaminerThinking } from './ExaminerLine';
import LiveTranscript from './LiveTranscript';
import TicketCard, { ticketHeading } from './TicketCard';
import { underlinedFinalWords } from '../../lib/oral/rubricMatch';
import { DEMO_RUBRIC } from '../../lib/oral/testing/fixtures';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('<ExaminerLine>', () => {
  it('shows the examiner’s question in quotes and plays it again on request', () => {
    const onRepeat = vi.fn();
    render(
      <ExaminerLine question="А что будет, если взять слишком большую скорость обучения?" onRepeat={onRepeat}>
        <button type="button">Отвечать</button>
      </ExaminerLine>,
    );
    expect(screen.getByRole('region', { name: 'Экзаменатор' })).toBeInTheDocument();
    expect(screen.getByText('«А что будет, если взять слишком большую скорость обучения?»')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Повторить вопрос' }));
    expect(onRepeat).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Отвечать' })).toBeInTheDocument();
  });

  it('stands at the height of the asked row on a desktop, never past the window', () => {
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
    vi.stubGlobal('innerHeight', 900);
    const rect = (top: number, height: number) => ({ top, bottom: top + height, left: 0, right: 0, width: 0, height, x: 0, y: top, toJSON: () => ({}) });
    const spy = vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
      if (this.getAttribute('data-point') === 'p4') return rect(400, 52) as DOMRect;
      if (this.classList.contains('or-examiner')) return rect(100, 200) as DOMRect;
      return rect(0, 0) as DOMRect;
    });
    const { container } = render(
      <div>
        <div data-point="p4" />
        <ExaminerLine question="Вопрос?" alignTo="p4" />
      </div>,
    );
    // 400 − 100 − 18 = 282 px lower, inside the 900 px window: margin 28 + 282.
    expect((container.querySelector('.or-examiner') as HTMLElement).style.marginTop).toBe('310px');
    spy.mockRestore();
  });

  it('says «Экзаменатор слушает ответ…» while the follow-up is chosen', () => {
    render(<ExaminerThinking />);
    expect(screen.getByRole('status')).toHaveTextContent('Экзаменатор слушает ответ…');
  });
});

describe('<LiveTranscript>', () => {
  it('underlines only final words that opened a point and shows interim words apart', () => {
    const finalText = 'Обучение — это подбор весов, которые минимизируют функцию потерь.';
    const named = new Set(['p1']);
    const { container } = render(
      <LiveTranscript
        label="Ваш ответ, 0:18"
        finalText={finalText}
        interimText="сначала прямой проход"
        underlined={underlinedFinalWords(DEMO_RUBRIC.points, named, finalText)}
        seed={7}
      />,
    );
    expect(screen.getByText('Ваш ответ, 0:18')).toBeInTheDocument();
    const underlined = Array.from(container.querySelectorAll('.sf-under')).map((node) => node.textContent);
    // Only the words that opened the point, not every key word (redesign critique 4).
    expect(underlined).toEqual(['потерь']);
    expect(container.querySelector('.or-interim')).toHaveTextContent('сначала прямой проход');
    expect(container.querySelector('.or-said-window')).toHaveAttribute('aria-live', 'off');
  });
});

describe('<TicketCard>', () => {
  it('names a known ticket, a drawn pair and a single question', () => {
    expect(ticketHeading('12', 0, 2, '7')).toEqual({ strong: 'Билет 12', rest: 'вопрос 1 из 2' });
    expect(ticketHeading(null, 1, 2, '7')).toEqual({ strong: 'Случайный билет', rest: 'вопрос 2 из 2' });
    expect(ticketHeading(null, 0, 1, '17')).toEqual({ strong: 'Вопрос 17', rest: '' });
    render(<TicketCard heading={ticketHeading('12', 0, 2, '7')} question="Как обучается нейронная сеть?" />);
    expect(screen.getByRole('heading', { level: 1, name: 'Как обучается нейронная сеть?' })).toBeInTheDocument();
    expect(screen.getByRole('article', { name: 'Билет 12, вопрос 1 из 2' })).toBeInTheDocument();
  });
});
