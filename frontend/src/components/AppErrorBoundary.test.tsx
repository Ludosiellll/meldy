import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { AppErrorBoundary } from './AppErrorBoundary';
import { installTelemetry, queuedTelemetryForTests, resetTelemetryForTests } from '../lib/telemetry';

function Boom({ when }: { when: boolean }) {
  if (when) throw new TypeError('lecture is undefined');
  return <p>Сегодня</p>;
}

const originalLocation = window.location;
// React's development build replays a render error as a window 'error' event; handled here, jsdom stays quiet.
const quiet = (event: ErrorEvent) => event.preventDefault();

beforeEach(() => {
  resetTelemetryForTests();
  installTelemetry();
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  window.addEventListener('error', quiet);
});

afterEach(() => {
  window.removeEventListener('error', quiet);
  cleanup();
  resetTelemetryForTests();
  Object.defineProperty(window, 'location', { configurable: true, value: originalLocation });
  document.documentElement.classList.remove('dark');
  vi.restoreAllMocks();
});

describe('AppErrorBoundary', () => {
  it('renders the app while nothing fails, and reports nothing', () => {
    render(
      <AppErrorBoundary>
        <Boom when={false} />
      </AppErrorBoundary>,
    );
    expect(screen.getByText('Сегодня')).toBeInTheDocument();
    expect(queuedTelemetryForTests().filter((event) => event.kind === 'client_error')).toEqual([]);
  });

  it('shows one calm card with the reload button and reports the error with the component stack', () => {
    render(
      <AppErrorBoundary>
        <Boom when />
      </AppErrorBoundary>,
    );
    expect(screen.getByRole('heading', { level: 1, name: 'Что-то пошло не так' })).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('Страница остановилась из-за ошибки. Перезагрузите её, чтобы продолжить.');
    expect(screen.queryByText('Сегодня')).not.toBeInTheDocument();
    // React's development build also replays a render error on window (window_error); production does not.
    const errors = queuedTelemetryForTests().filter((event) => event.kind === 'client_error' && event.name !== 'window_error');
    expect(errors).toHaveLength(1);
    expect(errors[0].name).toBe('react_app');
    expect(errors[0].message).toBe('TypeError: lecture is undefined');
    expect(errors[0].stack).toContain('--- components ---');
    expect(errors[0].stack).toContain('Boom');
  });

  it('reloads the page from the button', () => {
    const reload = vi.fn();
    Object.defineProperty(window, 'location', { configurable: true, value: { ...originalLocation, reload } });
    render(
      <AppErrorBoundary>
        <Boom when />
      </AppErrorBoundary>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Перезагрузить страницу' }));
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('uses the theme tokens, so the dark theme needs no extra markup', () => {
    document.documentElement.classList.add('dark');
    const { container } = render(
      <AppErrorBoundary>
        <Boom when />
      </AppErrorBoundary>,
    );
    expect(container.querySelector('main.app-crash > section.app-crash-card')).not.toBeNull();
    expect(container.querySelector('button.app-crash-btn')).not.toBeNull();
  });
});
