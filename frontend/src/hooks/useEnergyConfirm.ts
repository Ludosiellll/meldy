import { useEffect } from 'react';
import { Clock } from 'lucide-react';
import { useConfirm } from '../contexts/ConfirmContext';
import { AI_LIMIT_EVENT, checkAILimit, formatLimitReset, nextLimitReset, remainingUnits, type AILimitInfo } from '../api/limits';
import { dailyUnits, openProWindow } from '../lib/plans';
import { track } from '../lib/telemetry';

/** «1 единицу», «2 единицы», «5 единиц» (винительный падеж после «расходует»). */
export function unitsWord(n: number): string {
  const abs = Math.abs(Math.trunc(n));
  const mod10 = abs % 10;
  const mod100 = abs % 100;
  if (mod10 === 1 && mod100 !== 11) return 'единицу';
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return 'единицы';
  return 'единиц';
}

type AlertFn = ReturnType<typeof useConfirm>['alert'];

/**
 * Окно дневного лимита — одно на всё приложение: заголовок («Дневной лимит исчерпан», если не
 * осталось ничего, иначе «Не хватает дневного лимита»), время сброса, «Понятно» и — для аккаунта
 * без PRO — «Что даёт PRO» (окно PRO по событию openProWindow('limit')).
 */
export async function showLimitDialog(
  alert: AlertFn,
  { remaining, isPro, message }: { remaining: number; isPro: boolean; message: string },
): Promise<void> {
  try {
    await alert({
      title: remaining <= 0 ? 'Дневной лимит исчерпан' : 'Не хватает дневного лимита',
      message,
      type: 'info',
      icon: Clock,
      confirmText: 'Понятно',
      ...(isPro ? {} : { secondaryText: 'Что даёт PRO', onSecondary: () => openProWindow('limit') }),
    });
  } catch (err) {
    console.error('Не удалось показать сообщение о лимите ИИ:', err);
  }
}

/** Текст окна для отказа сервера (429 ai_limit): числа — из ответа сервера. */
export function refusalMessage(info: AILimitInfo): { remaining: number; message: string } {
  const resetAt = formatLimitReset(info.resetsAt);
  const remaining = remainingUnits(info);
  if (remaining > 0) {
    const need = info.units !== null && info.units > 0 ? `Действие расходует ${info.units} ${unitsWord(info.units)}, а` : 'На это действие не хватает дневного лимита:';
    return {
      remaining,
      message: `${need} на сегодня осталось ${remaining}. Лимит обновится в ${resetAt}.`,
    };
  }
  return { remaining: 0, message: `Единицы ИИ на сегодня закончились. Лимит обновится в ${resetAt}.` };
}

/**
 * Проверка дневного лимита ИИ перед действием.
 *
 * Окно появляется только тогда, когда остатка не хватает. Если лимита хватает или остаток прочитать
 * не удалось, действие запускается сразу: списывает единицы сервер, и он же откажет (429 ai_limit),
 * если их не хватит, — тогда то же окно показывает AILimitDialogHost. У PRO лимит 1000 единиц в
 * сутки. Ключ studyforge_hide_energy_confirm больше не читается (и не удаляется: его пишет живой клиент).
 */
export function useEnergyConfirm() {
  const { alert } = useConfirm();

  const verifyEnergy = async (userId: string, cost: number, actionName: string = 'Это действие'): Promise<boolean> => {
    if (!(cost > 0)) return true; // бесплатное действие лимит не проверяет
    let status: Awaited<ReturnType<typeof checkAILimit>>;
    try {
      status = await checkAILimit(userId, cost);
    } catch (err) {
      console.error('Ошибка проверки лимита ИИ:', err);
      return true; // остаток неизвестен — не блокируем работу
    }

    if (status.ok === false || status.allowed) return true;

    track('ai_limit_hit', { kind: 'check', pro: Boolean(status.isPro), units: cost });
    const dayLimit = Number(status.limit) || dailyUnits(Boolean(status.isPro));
    const remaining = Math.max(0, dayLimit - (Number(status.count) || 0));
    const resetAt = formatLimitReset(status.resetsAt instanceof Date ? status.resetsAt : nextLimitReset());
    await showLimitDialog(alert, {
      remaining,
      isPro: status.isPro,
      message: `${actionName} расходует ${cost} ${unitsWord(cost)}, а на сегодня осталось ${remaining}. Лимит обновится в ${resetAt}.`,
    });
    return false;
  };

  return { verifyEnergy };
}

/**
 * Окно лимита для отказа сервера из любого запроса: lib/apiAuth (ответ 429 ai_limit) и потоки
 * (событие error с code ai_limit) сообщают reportAILimit(), здесь — то же окно, что у проверки.
 * Стоит один раз внутри ConfirmProvider.
 */
export function AILimitDialogHost(): null {
  const { alert } = useConfirm();
  useEffect(() => {
    const onLimit = (event: Event) => {
      const info = (event as CustomEvent<AILimitInfo>).detail;
      if (!info) return;
      track('ai_limit_hit', { kind: 'server', pro: info.pro, units: info.units });
      const { remaining, message } = refusalMessage(info);
      void showLimitDialog(alert, { remaining, isPro: info.pro, message });
    };
    window.addEventListener(AI_LIMIT_EVENT, onLimit);
    return () => window.removeEventListener(AI_LIMIT_EVENT, onLimit);
  }, [alert]);
  return null;
}
