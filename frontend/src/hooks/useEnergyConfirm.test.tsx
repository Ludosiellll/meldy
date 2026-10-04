import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
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

import { useEnergyConfirm, unitsWord } from './useEnergyConfirm';
import { ConfirmProvider } from '../contexts/ConfirmContext';
import TokenInfoModal from '../components/TokenInfoModal';
import { formatLimitReset, nextLimitReset } from '../api/limits';

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

beforeEach(() => {
  h.realConfirm = false;
  h.confirm.mockResolvedValue(true);
  h.alert.mockResolvedValue(undefined);
  h.check.mockResolvedValue({ allowed: true, isPro: false, count: 0, ok: true });
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
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

  it('lets PRO through', async () => {
    h.check.mockResolvedValue({ allowed: true, isPro: true, count: 0, ok: true });
    const host = renderHookHost();
    await expect(host.verify('user-1', 20)).resolves.toBe(true);
    expect(h.confirm).not.toHaveBeenCalled();
    expect(h.alert).not.toHaveBeenCalled();
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
    const everything = JSON.stringify({ ...options, icon: undefined });
    expect(everything).not.toMatch(/PRO|⚡|тариф|энерги/i);
  });

  it('says the limit is exhausted only when nothing is left', async () => {
    h.check.mockResolvedValue({ allowed: false, isPro: false, count: 100, ok: true });
    const host = renderHookHost();
    await expect(host.verify('user-1', 20, 'Анализ материала')).resolves.toBe(false);
    const options = h.alert.mock.calls[0][0];
    expect(options.title).toBe('Дневной лимит исчерпан');
    expect(options.message).toMatch(/^Анализ материала расходует 20 единиц, а на сегодня осталось 0\. Лимит обновится в \d{1,2}:\d{2}\.$/);

    h.alert.mockClear();
    h.check.mockResolvedValue({ allowed: false, isPro: false, count: 130, ok: true }); // старый клиент мог перерасходовать
    await expect(host.verify('user-1', 5, 'Разговор')).resolves.toBe(false);
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
    await host.verify('user-1', 5, 'Разговор');
    expect(getItem).not.toHaveBeenCalledWith('studyforge_hide_energy_confirm');
    expect(removeItem).not.toHaveBeenCalled();
    expect(h.alert).toHaveBeenCalledTimes(1); // флаг больше не прячет сообщение о нехватке
    expect(window.localStorage.getItem('studyforge_hide_energy_confirm')).toBe('true');
  });

  it('with the real dialog: one «Понятно» button, no cancel, resolves false', async () => {
    h.realConfirm = true;
    h.check.mockResolvedValue({ allowed: false, isPro: false, count: 95, ok: true });
    const host = renderHookHost(true);
    let result: boolean | undefined;
    await act(async () => {
      void host.verify('user-1', 10, 'Разметка по лекциям').then(value => {
        result = value;
      });
    });
    expect(await screen.findByText('Не хватает дневного лимита')).toBeInTheDocument();
    expect(screen.queryByText('Дневной лимит исчерпан')).not.toBeInTheDocument();
    expect(screen.getByText(/Разметка по лекциям расходует 10 единиц, а на сегодня осталось 5\. Лимит обновится в \d{1,2}:\d{2}\./)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Отмена|PRO/ })).not.toBeInTheDocument();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Понятно' }));
    });
    expect(result).toBe(false);
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

// Окно «Дневной лимит ИИ» в шапке — та же тема, отдельного файла тестов у него нет.
describe('TokenInfoModal', () => {
  it('shows the remaining units and the local reset time, without upsell or ⚡', () => {
    const { container } = render(<TokenInfoModal isOpen onClose={() => {}} usedTokens={20} />);
    expect(screen.getByRole('dialog', { name: 'Дневной лимит ИИ' })).toBeInTheDocument();
    expect(screen.getByText(/Осталось на сегодня:/).textContent).toBe('Осталось на сегодня: 80 из 100 единиц.');
    expect(screen.getByText(new RegExp(`Лимит обновится в ${formatLimitReset(nextLimitReset())}\\.`))).toBeInTheDocument();
    // Список трат — примеры, а не полный перечень: единицы уходят и на разметку, и на ответ на билет.
    expect(container.textContent).toContain(
      'Единицы расходуются, когда Meldy обращается к ИИ, например: анализ материала, разметка экзамена по лекциям, ответ на билет, разговор, шпаргалка.',
    );
    expect(container.textContent).not.toMatch(/⚡|PRO|тариф|Энергия/);
    expect(container.querySelector('.animate-pulse, [class*="gradient"], [class*="shadow-[0_0"]')).toBeNull();
    expect(screen.getByTestId('limit-bar')).toHaveStyle({ width: '80%' });
  });

  it('clamps an overspent counter at zero', () => {
    render(<TokenInfoModal isOpen onClose={() => {}} usedTokens={130} />);
    expect(screen.getByText(/Осталось на сегодня:/).textContent).toBe('Осталось на сегодня: 0 из 100 единиц.');
    expect(screen.getByText(/На сегодня лимит исчерпан, он обновится в \d{1,2}:\d{2}\./)).toBeInTheDocument();
    expect(screen.queryByText(/^Лимит обновится/)).not.toBeInTheDocument();
    expect(screen.getByTestId('limit-bar')).toHaveStyle({ width: '0%' });
  });

  it('keeps the honest PRO line', () => {
    render(<TokenInfoModal isOpen isPro onClose={() => {}} usedTokens={0} />);
    expect(screen.getByText('У вашего аккаунта PRO: дневной лимит к нему не применяется.')).toBeInTheDocument();
    expect(screen.queryByText(/Осталось на сегодня/)).not.toBeInTheDocument();
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
