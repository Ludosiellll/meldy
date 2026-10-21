import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useParams } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({ createContainer: vi.fn(), setContainerKind: vi.fn() }));
vi.mock('../../api/containers', () => ({ createContainer: api.createContainer, setContainerKind: api.setContainerKind }));

import NewTestPage from './NewTestPage';
import { NEW_TEST } from '../../components/test/copyTest';
import { RPC_ERRORS } from '../../components/containers/copyImport';

function Built() {
  const { id } = useParams();
  return <h1>{`Студия ${id}`}</h1>;
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/exams', '/tests/new']} initialIndex={1}>
      <Routes>
        <Route path="/exams" element={<h1>Экзамены</h1>} />
        <Route path="/tests/new" element={<NewTestPage />} />
        <Route path="/exams/c/:id/studio" element={<Built />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  window.sessionStorage.clear();
  api.createContainer.mockReset().mockResolvedValue({ container_id: 'c-new', subjects: [{ id: 's-new', position: 1, title: 'Вопросы' }] });
  api.setContainerKind.mockReset().mockResolvedValue(undefined);
});
afterEach(() => cleanup());

describe('NewTestPage: «Новый тест» (spec 2026-10-18 §47.2)', () => {
  it('creates an exam of one subject «Вопросы» under the name and opens it in «Студия теста» (release 47.2)', async () => {
    renderPage();
    expect(screen.getByRole('heading', { level: 1, name: 'Новый тест' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Экзамены' })).toHaveAttribute('href', '/exams');
    fireEvent.change(screen.getByLabelText(NEW_TEST.name), { target: { value: '  Химия, 9 класс  ' } });
    fireEvent.click(screen.getByRole('button', { name: NEW_TEST.create }));
    expect(await screen.findByRole('heading', { name: 'Студия c-new' })).toBeInTheDocument();
    expect(api.createContainer).toHaveBeenCalledWith('Химия, 9 класс', null, [{ title: 'Вопросы' }]);
    // Release 47.3: a test is its own kind — its page is the test's own, and it stays out of the author's plan.
    expect(api.setContainerKind).toHaveBeenCalledWith('c-new', 'test');
    expect(api.setContainerKind.mock.invocationCallOrder[0]).toBeGreaterThan(api.createContainer.mock.invocationCallOrder[0]);
  });

  it('opens the studio all the same when the kind could not be written (an older database, a lost answer)', async () => {
    api.setContainerKind.mockRejectedValueOnce(Object.assign(new Error('column kind'), { code: 'unknown' }));
    renderPage();
    fireEvent.change(screen.getByLabelText(NEW_TEST.name), { target: { value: 'Химия' } });
    fireEvent.click(screen.getByRole('button', { name: NEW_TEST.create }));
    expect(await screen.findByRole('heading', { name: 'Студия c-new' })).toBeInTheDocument();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('asks for a name before creating anything', () => {
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: NEW_TEST.create }));
    expect(screen.getByRole('alert')).toHaveTextContent(NEW_TEST.nameEmpty);
    expect(screen.getByLabelText(NEW_TEST.name)).toHaveAttribute('aria-invalid', 'true');
    expect(api.createContainer).not.toHaveBeenCalled();
  });

  it('keeps the name within 120 characters and shows the count near the limit', () => {
    renderPage();
    const field = screen.getByLabelText(NEW_TEST.name);
    expect(field).toHaveAttribute('maxLength', '120');
    fireEvent.change(field, { target: { value: 'а'.repeat(110) } });
    expect(screen.getByText('110 / 120')).toBeInTheDocument();
  });

  it('owner 21.10: a reload keeps the name typed in this tab; a made test leaves nothing behind', async () => {
    const first = renderPage();
    fireEvent.change(screen.getByLabelText(NEW_TEST.name), { target: { value: 'Химия, 9 класс' } });
    first.unmount();

    const second = renderPage();
    expect(screen.getByLabelText(NEW_TEST.name)).toHaveValue('Химия, 9 класс');
    fireEvent.click(screen.getByRole('button', { name: NEW_TEST.create }));
    expect(await screen.findByRole('heading', { name: 'Студия c-new' })).toBeInTheDocument();
    second.unmount();

    renderPage();
    expect(screen.getByLabelText(NEW_TEST.name)).toHaveValue('');
  });

  it('says in place why it failed and lets the author try again', async () => {
    api.createContainer.mockRejectedValueOnce(Object.assign(new Error('x'), { code: 'MC007' }));
    renderPage();
    fireEvent.change(screen.getByLabelText(NEW_TEST.name), { target: { value: 'Химия' } });
    fireEvent.click(screen.getByRole('button', { name: NEW_TEST.create }));
    expect(await screen.findByRole('alert')).toHaveTextContent(RPC_ERRORS.MC007);
    const button = screen.getByRole('button', { name: NEW_TEST.create });
    expect(button).toBeEnabled();
    fireEvent.click(button);
    await waitFor(() => expect(api.createContainer).toHaveBeenCalledTimes(2));
    expect(await screen.findByRole('heading', { name: 'Студия c-new' })).toBeInTheDocument();
  });
});
