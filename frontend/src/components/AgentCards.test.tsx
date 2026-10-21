import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import AgentCards from './AgentCards';
import type { AgentStatus } from '../types';

const agents: AgentStatus[] = [
  { id: 'summarizer', label: 'Конспект', status: 'done', progress: 1 },
  { id: 'flashcards', label: 'Карточки', status: 'failed', progress: 1 },
  { id: 'quiz', label: 'Самопроверка', status: 'running', progress: 0 },
];

afterEach(cleanup);

describe('AgentCards', () => {
  it('shows a plain status per section, including «Не получилось» for a failed one', () => {
    render(<AgentCards agents={agents} phase="analyzing" />);
    const list = screen.getByRole('list', { name: 'Разделы' });
    const rows = within(list).getAllByRole('listitem');
    expect(rows.map(row => row.textContent)).toEqual(['КонспектГотово', 'КарточкиНе получилось', 'СамопроверкаГотовим…']);
    expect(screen.getByRole('heading', { name: 'Готовим конспект, карточки и самопроверку' })).toBeInTheDocument();
    expect(screen.getByText(/Завершено 2 из 3/)).toBeInTheDocument();
  });

  it('says «Читаем текст…» while the text is extracted', () => {
    render(<AgentCards agents={agents.map(agent => ({ ...agent, status: 'idle' }))} phase="extracting" />);
    expect(screen.getByRole('heading', { name: 'Читаем текст…' })).toBeInTheDocument();
    expect(screen.getAllByText('В очереди')).toHaveLength(3);
  });

  it('shows the server note about a long step while extracting', () => {
    render(
      <AgentCards
        agents={agents.map(agent => ({ ...agent, status: 'idle' }))}
        phase="extracting"
        statusNote="Распознаём текст файла. Это может занять несколько минут."
      />,
    );
    expect(screen.getByText('Распознаём текст файла. Это может занять несколько минут.')).toBeInTheDocument();
  });

  it('shows a plain demo line, not an uppercase badge, and no hype copy', () => {
    const { container } = render(<AgentCards agents={agents} phase="analyzing" isDemo />);
    expect(screen.getByText('Демо-текст: лимит не списывается.')).toBeInTheDocument();
    expect(screen.queryByText('ДЕМО')).not.toBeInTheDocument();
    expect(container.innerHTML).not.toMatch(/uppercase|tracking-wider|gradient/);
    expect(container.textContent).not.toMatch(/Интеллектуальн|Нейросетев|успешно/);
  });

  it('renders «Отменить» only with onCancel and calls it', () => {
    const onCancel = vi.fn();
    const { rerender } = render(<AgentCards agents={agents} phase="analyzing" />);
    expect(screen.queryByRole('button', { name: 'Отменить' })).not.toBeInTheDocument();
    rerender(<AgentCards agents={agents} phase="analyzing" onCancel={onCancel} />);
    fireEvent.click(screen.getByRole('button', { name: 'Отменить' }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('exposes the overall progress', () => {
    render(<AgentCards agents={agents} phase="analyzing" />);
    const bar = screen.getByRole('progressbar', { name: 'Ход анализа' });
    expect(Number(bar.getAttribute('aria-valuenow'))).toBeGreaterThan(50);
  });
});
