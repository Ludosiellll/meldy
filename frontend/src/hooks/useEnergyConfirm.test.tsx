import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  realConfirm: false,
  confirm: vi.fn(),
  alert: vi.fn(),
  check: vi.fn(),
}));

vi.mock('../contexts/ConfirmContext', async importOriginal => {
  const actual = await importOriginal<typeof import('../contexts/ConfirmContext')>();
  return {
    ...actual,
    useConfirm: () => (h.realConfirm ? actual.useConfirm() : { confirm: h.confirm, alert: h.alert }),
  };
});

vi.mock('../api/limits', async importOriginal => {
  const actual = await importOriginal<typeof import('../api/limits')>();
  return { ...actual, checkAILimit: (...args: unknown[]) => h.check(...args) };
});

import { AILimitDialogHost, refusalMessage, useEnergyConfirm, unitsWord } from './useEnergyConfirm';
import { ConfirmProvider } from '../contexts/ConfirmContext';
import TokenInfoModal from '../components/TokenInfoModal';
import { formatLimitReset, nextLimitReset, reportAILimit, resetAILimitReportsForTests } from '../api/limits';
import { AI_COSTS, EXAM_MAPPING_QUESTIONS_PER_CHARGE, OCR_PAGES_PER_CHARGE, OPEN_PRO_EVENT } from '../lib/plans';
import { WITHOUT_UNITS } from '../components/pro/planCopy';

type Verify = ReturnType<typeof useEnergyConfirm>['verifyEnergy'];

function renderHookHost(withProvider = false) {
  const holder: { verify?: Verify } = {};
  function Host() {
    holder.verify = useEnergyConfirm().verifyEnergy;
    return null;
  }
  // Без Router: хук больше не вызывает useNavigate и никуда не переводит.
  render(withProvider ? <ConfirmProvider><Host /></ConfirmProvider> : <Host />);
  return holder as { verify: Verify };
}

let proOpened: unknown[] = [];
const onOpenPro = (event: Event) => proOpened.push((event as CustomEvent).detail);

beforeEach(() => {
  proOpened = [];
  window.addEventListener(OPEN_PRO_EVENT, onOpenPro);
  resetAILimitReportsForTests();
  h.realConfirm = false;
  h.confirm.mockResolvedValue(true);
  h.alert.mockResolvedValue(undefined);
  h.check.mockResolvedValue({ allowed: true, isPro: false, count: 0, ok: true });
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  window.removeEventListener(OPEN_PRO_EVENT, onOpenPro);
  cleanup();
  try {
    window.localStorage.clear();
  } catch {
    /* ignore */
  }
});

describe('verifyEnergy', () => {
  it('lets an allowed action through with no dialog at all', async () => {
    h.check.mockResolvedValue({ allowed: true, isPro: false, count: 80, ok: true });
    const host = renderHookHost();
    await expect(host.verify('user-1', 20, 'Анализ материала')).resolves.toBe(true);
    expect(h.check).toHaveBeenCalledWith('user-1', 20);
    expect(h.confirm).not.toHaveBeenCalled();
    expect(h.alert).not.toHaveBeenCalled();
  });

  it('lets PRO through while its 1000 units a day cover the action', async () => {
    h.check.mockResolvedValue({ allowed: true, isPro: true, count: 0, ok: true, limit: 1000 });
    const host = renderHookHost();
    await expect(host.verify('user-1', 20)).resolves.toBe(true);
    expect(h.confirm).not.toHaveBeenCalled();
    expect(h.alert).not.toHaveBeenCalled();
  });

  it('stops PRO at its daily 1000 too, without offering PRO', async () => {
    h.check.mockResolvedValue({ allowed: false, isPro: true, count: 995, ok: true, limit: 1000 });
    const host = renderHookHost();
    await expect(host.verify('user-1', 20, 'Анализ материала')).resolves.toBe(false);
    const options = h.alert.mock.calls[0][0];
    expect(options.title).toBe('Не хватает дневного лимита');
    expect(options.message).toMatch(/^Анализ материала расходует 20 единиц, а на сегодня осталось 5\./);
    expect(options.secondaryText).toBeUndefined();
  });

  it('lets the action through when the balance could not be read', async () => {
    h.check.mockResolvedValue({ allowed: true, isPro: false, count: 0, ok: false });
    const host = renderHookHost();
    await expect(host.verify('user-1', 20)).resolves.toBe(true);
    h.check.mockRejectedValue(new Error('offline'));
    await expect(host.verify('user-1', 20)).resolves.toBe(true);
    expect(h.alert).not.toHaveBeenCalled();
  });

  it('shows one plain alert and refuses when the remaining units are not enough', async () => {
    h.check.mockResolvedValue({ allowed: false, isPro: false, count: 90, ok: true });
    const host = renderHookHost();
    await expect(host.verify('user-1', 20, 'Анализ материала')).resolves.toBe(false);
    expect(h.confirm).not.toHaveBeenCalled();
    expect(h.alert).toHaveBeenCalledTimes(1);
    const options = h.alert.mock.calls[0][0];
    const resetAt = formatLimitReset(nextLimitReset());
    expect(resetAt).toMatch(/^\d{1,2}:\d{2}$/);
    // Осталось 10 из 100: лимит не «исчерпан», его не хватает на это действие.
    expect(options.title).toBe('Не хватает дневного лимита');
    expect(options.message).toBe(`Анализ материала расходует 20 единиц, а на сегодня осталось 10. Лимит обновится в ${resetAt}.`);
    expect(options.confirmText).toBe('Понятно');
    // The second, quieter button opens the «Что даёт PRO» window (no payment on this screen).
    expect(options.secondaryText).toBe('Что даёт PRO');
    options.onSecondary();
    expect(proOpened).toEqual([{ reason: 'limit' }]);
    const everything = JSON.stringify({ ...options, icon: undefined, secondaryText: undefined });
    expect(everything).not.toMatch(/PRO|⚡|тариф|энерги/i);
  });

  it('says the limit is exhausted only when nothing is left', async () => {
    h.check.mockResolvedValue({ allowed: false, isPro: false, count: 100, ok: true });
    const host = renderHookHost();
    await expect(host.verify('user-1', 20, 'Анализ материала')).resolves.toBe(false);
    const options = h.alert.mock.calls[0][0];
    expect(options.title).toBe('Дневной лимит исчерпан');
    expect(options.message).toMatch(/^Анализ материала расходует 20 единиц, а на сегодня осталось 0\. Лимит обновится в \d{1,2}:\d{2}\. /);
    // A spent day also says what still works without units.
    expect(options.message.endsWith(` ${WITHOUT_UNITS}`)).toBe(true);

    h.alert.mockClear();
    h.check.mockResolvedValue({ allowed: false, isPro: false, count: 130, ok: true }); // старый клиент мог перерасходовать
    await expect(host.verify('user-1', 5, 'Подкаст')).resolves.toBe(false);
    expect(h.alert.mock.calls[0][0].title).toBe('Дневной лимит исчерпан');
    expect(h.alert.mock.calls[0][0].message).toMatch(/осталось 0\./);
  });

  it('does not check or warn for a free action, even when the day is overspent', async () => {
    h.check.mockResolvedValue({ allowed: false, isPro: false, count: 130, ok: true });
    const host = renderHookHost();
    await expect(host.verify('user-1', 0, 'Досоздать')).resolves.toBe(true);
    expect(h.check).not.toHaveBeenCalled();
    expect(h.alert).not.toHaveBeenCalled();
  });

  it('never reads or deletes the old «Больше не спрашивать» flag', async () => {
    window.localStorage.setItem('studyforge_hide_energy_confirm', 'true');
    const getItem = vi.spyOn(Storage.prototype, 'getItem');
    const removeItem = vi.spyOn(Storage.prototype, 'removeItem');
    h.check.mockResolvedValue({ allowed: false, isPro: false, count: 100, ok: true });
    const host = renderHookHost();
    await host.verify('user-1', 5, 'Подкаст');
    expect(getItem).not.toHaveBeenCalledWith('studyforge_hide_energy_confirm');
    expect(removeItem).not.toHaveBeenCalled();
    expect(h.alert).toHaveBeenCalledTimes(1); // флаг больше не прячет сообщение о нехватке
    expect(window.localStorage.getItem('studyforge_hide_energy_confirm')).toBe('true');
  });

  it('with the real dialog: «Понятно» and «Что даёт PRO», no cancel, resolves false', async () => {
    h.realConfirm = true;
    h.check.mockResolvedValue({ allowed: false, isPro: false, count: 95, ok: true });
    const host = renderHookHost(true);
    let result: boolean | undefined;
    await act(async () => {
      void host.verify('user-1', 10, 'Сверка с лекциями').then(value => {
        result = value;
      });
    });
    expect(await screen.findByText('Не хватает дневного лимита')).toBeInTheDocument();
    expect(screen.queryByText('Дневной лимит исчерпан')).not.toBeInTheDocument();
    expect(screen.getByText(/Сверка с лекциями расходует 10 единиц, а на сегодня осталось 5\. Лимит обновится в \d{1,2}:\d{2}\./)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Отмена/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Понятно' })).toHaveFocus();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Что даёт PRO' }));
    });
    expect(result).toBe(false);
    expect(proOpened).toEqual([{ reason: 'limit' }]);
    await waitFor(() => expect(screen.queryByText('Не хватает дневного лимита')).not.toBeInTheDocument());
  });

  it('with the real dialog: Escape only closes, it never opens PRO', async () => {
    h.realConfirm = true;
    h.check.mockResolvedValue({ allowed: false, isPro: false, count: 100, ok: true });
    const host = renderHookHost(true);
    let result: boolean | undefined;
    await act(async () => {
      void host.verify('user-1', 4, 'Ответ на билет').then(value => {
        result = value;
      });
    });
    const dialog = await screen.findByRole('dialog');
    await act(async () => {
      fireEvent.keyDown(dialog, { key: 'Escape' });
    });
    expect(result).toBe(false);
    expect(proOpened).toEqual([]);
  });
});

describe('unitsWord', () => {
  it('agrees with the number', () => {
    expect([1, 2, 4, 5, 11, 12, 14, 20, 21, 22, 25, 101, 111, 112].map(n => `${n} ${unitsWord(n)}`)).toEqual([
      '1 единицу',
      '2 единицы',
      '4 единицы',
      '5 единиц',
      '11 единиц',
      '12 единиц',
      '14 единиц',
      '20 единиц',
      '21 единицу',
      '22 единицы',
      '25 единиц',
      '101 единицу',
      '111 единиц',
      '112 единиц',
    ]);
  });
});

// Окно «Дневной лимит ИИ» (счётчик в верхней строке) — та же тема, отдельного файла тестов у него нет.
describe('TokenInfoModal', () => {
  it('shows what is left, when it comes back and what the main actions cost — the numbers of lib/plans.ts', () => {
    const { container } = render(<TokenInfoModal isOpen onClose={() => {}} usedTokens={20} />);
    expect(screen.getByRole('dialog', { name: 'Дневной лимит ИИ' })).toBeInTheDocument();
    expect(screen.getByText(/Осталось на сегодня:/).textContent).toBe('Осталось на сегодня: 80 из 100 единиц.');
    expect(screen.getByText(new RegExp(`Лимит обновится в ${formatLimitReset(nextLimitReset())}\\.`))).toBeInTheDocument();
    // Цены — из lib/plans.ts; списывает сервер, при сбое ИИ единицы возвращаются.
    expect(screen.getByText('Единицы списываются, когда Meldy обращается к ИИ:')).toBeInTheDocument();
    const rows = Array.from(container.querySelectorAll('.ac-cost')).map((row) => [
      row.querySelector('dt')?.textContent,
      row.querySelector('dd')?.textContent,
    ]);
    expect(rows).toEqual([
      [`Анализ лекциискан PDF — ещё ${AI_COSTS.scanPages} за каждые ${OCR_PAGES_PER_CHARGE} страниц`, String(AI_COSTS.lecture)],
      ['Проверка ответа на билет', String(AI_COSTS.answer)],
      ['Пункты ответа к новому вопросуодин раз на вопрос', String(AI_COSTS.answerPoints)],
      [`Сверка списка вопросовза каждые ${EXAM_MAPPING_QUESTIONS_PER_CHARGE} новых вопросов`, String(AI_COSTS.examMapping)],
      ['Подкаст по лекциидва ведущих обсуждают лекцию', String(AI_COSTS.conversation)],
      ['«Поговорить о лекции»за каждый ответ репетитора', String(AI_COSTS.tutorTurn)],
      // Under «Ещё: …»: the rarer actions, so every action that spends units has its price here.
      ['Выжимка лекции', String(AI_COSTS.cheatsheet)],
      ['Схемы к подкасту', String(AI_COSTS.visuals)],
      ['Работа над ошибками', String(AI_COSTS.mistakesPractice)],
      ['Оценки по фото', String(AI_COSTS.gradebookScan)],
      ['Раздел анализа заново' + 'раздел, который не получился при анализе, — бесплатно', String(AI_COSTS.analysisSection)],
    ]);
    // One row per priced action of lib/plans.ts (scan pages are the note under the analysis): a new
    // price there fails here until the window lists it.
    expect(rows).toHaveLength(Object.keys(AI_COSTS).length - 1);
    expect(container.querySelector('details.ac-costs-more > summary')).toHaveTextContent('Ещё: выжимка, схемы, работа над ошибками, оценки по фото');
    expect(screen.getByText('Если ИИ не справился, единицы возвращаются.')).toBeInTheDocument();
    expect(screen.getByText(WITHOUT_UNITS)).toBeInTheDocument();
    // What PRO gives, in the same numbers; no price, no checkout here.
    expect(screen.getByText('С PRO — 1000 единиц ИИ в день.')).toBeInTheDocument();
    expect(container.textContent).not.toMatch(/⚡|Энергия|₽|оплат/);
    expect(container.querySelector('.animate-pulse, [class*="gradient"], [class*="shadow-[0_0"]')).toBeNull();
    expect(screen.getByTestId('limit-bar')).toHaveStyle({ width: '80%' });
  });

  it('offers «Что даёт PRO» next to «Понятно» when it can open the PRO window', () => {
    const onOpenPro = vi.fn();
    const { rerender } = render(<TokenInfoModal isOpen onClose={() => {}} usedTokens={20} onOpenPro={onOpenPro} />);
    fireEvent.click(screen.getByRole('button', { name: 'Что даёт PRO' }));
    expect(onOpenPro).toHaveBeenCalledTimes(1);
    rerender(<TokenInfoModal isOpen onClose={() => {}} usedTokens={20} />);
    expect(screen.queryByRole('button', { name: 'Что даёт PRO' })).not.toBeInTheDocument();
  });

  it('counts the day the server gave (the limit prop), not only the plan default', () => {
    render(<TokenInfoModal isOpen isPro limit={1000} onClose={() => {}} usedTokens={40} />);
    expect(screen.getByText(/Осталось на сегодня:/).textContent).toBe('Осталось на сегодня: 960 из 1000 единиц.');
    expect(screen.getByTestId('limit-bar')).toHaveStyle({ width: '96%' });
  });

  it('clamps an overspent counter at zero', () => {
    render(<TokenInfoModal isOpen onClose={() => {}} usedTokens={130} />);
    expect(screen.getByText(/Осталось на сегодня:/).textContent).toBe('Осталось на сегодня: 0 из 100 единиц.');
    expect(screen.getByText(/На сегодня лимит исчерпан, он обновится в \d{1,2}:\d{2}\./)).toBeInTheDocument();
    expect(screen.queryByText(/^Лимит обновится/)).not.toBeInTheDocument();
    expect(screen.getByTestId('limit-bar')).toHaveStyle({ width: '0%' });
  });

  it('tells PRO the truth: up to 1000 units a day, counted like everyone else, and offers nothing', () => {
    const { container } = render(<TokenInfoModal isOpen isPro onClose={() => {}} usedTokens={250} onOpenPro={() => {}} />);
    expect(screen.getByText(/Осталось на сегодня:/).textContent).toBe('Осталось на сегодня: 750 из 1000 единиц.');
    expect(container.textContent).toContain('У аккаунта PRO — до 1000 единиц в день.');
    expect(container.textContent).not.toMatch(/не применяется|С PRO —/);
    expect(screen.queryByRole('button', { name: 'Что даёт PRO' })).not.toBeInTheDocument();
    expect(screen.getByTestId('limit-bar')).toHaveStyle({ width: '75%' });
  });

  it('closes by the button and by Escape; renders nothing when closed', () => {
    const onClose = vi.fn();
    const { rerender, container } = render(<TokenInfoModal isOpen onClose={onClose} usedTokens={0} />);
    fireEvent.click(screen.getByRole('button', { name: 'Понятно' }));
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(2);
    rerender(<TokenInfoModal isOpen={false} onClose={onClose} usedTokens={0} />);
    expect(container).toBeEmptyDOMElement();
  });
});

// Отказ сервера (429 ai_limit) из любого запроса: то же окно, что у проверки перед действием.
describe('AILimitDialogHost', () => {
  function renderHost() {
    h.realConfirm = true;
    render(
      <ConfirmProvider>
        <AILimitDialogHost />
      </ConfirmProvider>,
    );
  }

  it('opens the limit dialog with the reset time and «Что даёт PRO» when the server refuses', async () => {
    renderHost();
    const resetsAt = new Date('2026-10-05T00:00:00Z');
    await act(async () => {
      reportAILimit({ used: 100, limit: 100, units: 20, resetsAt, pro: false });
    });
    expect(await screen.findByText('Дневной лимит исчерпан')).toBeInTheDocument();
    expect(
      screen.getByText(`Единицы ИИ на сегодня закончились. Лимит обновится в ${formatLimitReset(resetsAt)}. ${WITHOUT_UNITS}`),
    ).toBeInTheDocument();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Что даёт PRO' }));
    });
    expect(proOpened).toEqual([{ reason: 'limit' }]);
  });

  it('says what the action needed when some units are left, and offers PRO only without it', async () => {
    renderHost();
    await act(async () => {
      reportAILimit({ used: 990, limit: 1000, units: 20, resetsAt: new Date('2026-10-05T00:00:00Z'), pro: true });
    });
    expect(await screen.findByText('Не хватает дневного лимита')).toBeInTheDocument();
    expect(screen.getByText(/^Действие расходует 20 единиц, а на сегодня осталось 10\. Лимит обновится в \d{1,2}:\d{2}\.$/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Что даёт PRO' })).not.toBeInTheDocument();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Понятно' }));
    });
    expect(proOpened).toEqual([]);
  });

  it('builds the refusal text from the server numbers only', () => {
    const resetsAt = new Date('2026-10-05T00:00:00Z');
    expect(refusalMessage({ used: null, limit: null, units: null, resetsAt, pro: false }).remaining).toBe(0);
    expect(refusalMessage({ used: 95, limit: 100, units: null, resetsAt, pro: false }).message).toMatch(
      /^На это действие не хватает дневного лимита: на сегодня осталось 5\./,
    );
  });
});
