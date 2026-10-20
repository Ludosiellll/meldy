import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import Landing3 from './Landing3';
import { BUILDER_SECTION, CTA, EXAMPLE, EXAM_SECTION, GROUP_SECTION, HEADLINE, LEAD, LECTURE_SECTION, SAMPLE_TEST_URL, bind } from './copy3';

const auth = vi.hoisted(() => ({ requestSession: vi.fn() }));
vi.mock('../../hooks/useAuth', () => ({
  useAuth: () => ({ user: null, requestSession: auth.requestSession }),
}));

class SilentObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords() {
    return [];
  }
}

function Where() {
  const { pathname } = useLocation();
  return <p>Адрес: {pathname}</p>;
}

function renderLanding() {
  return render(
    <MemoryRouter initialEntries={['/']}>
      <Routes>
        <Route path="/" element={<Landing3 />} />
        <Route path="*" element={<Where />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.stubGlobal('IntersectionObserver', SilentObserver);
  vi.stubGlobal('ResizeObserver', SilentObserver);
  vi.stubGlobal(
    'matchMedia',
    vi.fn((query: string) => ({ matches: false, media: query, addEventListener: vi.fn(), removeEventListener: vi.fn(), addListener: vi.fn(), removeListener: vi.fn() })),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  document.documentElement.classList.remove('sh-off');
  document.getElementById('static-hero')?.remove();
});

describe('the landing v3', () => {
  it('says the headline and the lead and offers the example and the public test first', () => {
    renderLanding();
    expect(screen.getByRole('heading', { level: 1, name: bind(HEADLINE) })).toBeInTheDocument();
    expect(screen.getByText((_, element) => element?.tagName === 'P' && element.textContent === bind(LEAD))).toBeInTheDocument();
    const hero = screen.getByRole('heading', { level: 1 }).closest('section')!;
    expect(within(hero).getByRole('link', { name: CTA.example })).toHaveAttribute('href', '/try');
    expect(within(hero).getByRole('link', { name: CTA.test })).toHaveAttribute('href', SAMPLE_TEST_URL);
  });

  it('takes the static first screen’s place and unhides the app', () => {
    const shell = document.createElement('div');
    shell.id = 'static-hero';
    document.body.appendChild(shell);
    renderLanding();
    expect(document.getElementById('static-hero')).toBeNull();
    expect(document.documentElement.classList.contains('sh-off')).toBe(true);
  });

  it('follows its inner links through the router', () => {
    renderLanding();
    const hero = screen.getByRole('heading', { level: 1 }).closest('section')!;
    fireEvent.click(within(hero).getByRole('link', { name: CTA.example }));
    expect(screen.getByText('Адрес: /try')).toBeInTheDocument();
  });

  it('has the sections in the reel’s order, the constructor last before the end', () => {
    renderLanding();
    const titles = screen.getAllByRole('heading', { level: 2 }).map((heading) => heading.textContent);
    expect(titles.slice(0, 4)).toEqual([LECTURE_SECTION.title, EXAM_SECTION.title, GROUP_SECTION.title, BUILDER_SECTION.title].map(bind));
  });

  it('switches the lecture’s materials', () => {
    renderLanding();
    fireEvent.click(screen.getByRole('tab', { name: /Тест/ }));
    expect(screen.getByRole('tab', { name: /Тест/ })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getAllByText(EXAMPLE.testStem).length).toBeGreaterThan(0);
  });

  it('moves the exam by two weeks and back', () => {
    renderLanding();
    fireEvent.click(screen.getByRole('button', { name: EXAM_SECTION.plan.move }));
    expect(screen.getByText('Экзамен 20 ноября · через 32 дня')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: EXAM_SECTION.plan.back }));
    expect(screen.getByText('Экзамен 6 ноября · через 18 дней')).toBeInTheDocument();
  });

  it('answers a press in the session: the right one counts, a wrong one names the key', () => {
    renderLanding();
    const session = screen.getByText('Микроэкономика · 7 из 20').closest('.p3-pic') as HTMLElement;
    fireEvent.click(within(session).getByRole('button', { name: /Вырастет/ }));
    expect(within(session).getByText('Верно.')).toBeInTheDocument();
    expect(within(session).getByText('147')).toBeInTheDocument();
    fireEvent.click(within(session).getByRole('button', { name: 'Ещё раз' }));
    fireEvent.click(within(session).getByRole('button', { name: /Снизится/ }));
    expect(within(session).getByText(/Неверно\. В файле — Вырастет\./)).toBeInTheDocument();
  });
});

describe('the session on the landing', () => {
  it('asks for the session when the visitor leaves the landing, not before', () => {
    auth.requestSession.mockClear();
    renderLanding();
    expect(auth.requestSession).not.toHaveBeenCalled();
    fireEvent.click(screen.getAllByRole('link', { name: CTA.signIn })[0]);
    expect(screen.getByText('Адрес: /login')).toBeInTheDocument();
    expect(auth.requestSession).toHaveBeenCalledTimes(1);
  });
});
