import { Clock } from 'lucide-react';
import { useConfirm } from '../contexts/ConfirmContext';
import { checkAILimit, formatLimitReset, FREE_DAILY_LIMIT, nextLimitReset } from '../api/limits';

/** «1 единицу», «2 единицы», «5 единиц» (винительный падеж после «расходует»). */
export function unitsWord(n: number): string {
  const abs = Math.abs(Math.trunc(n));
  const mod10 = abs % 10;
  const mod100 = abs % 100;
  if (mod10 === 1 && mod100 !== 11) return 'единицу';
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return 'единицы';
  return 'единиц';
}

/**
 * Проверка дневного лимита ИИ перед действием.
 *
 * Окно появляется только тогда, когда остатка не хватает: одно сообщение со временем
 * сброса и кнопкой «Понятно» («Дневной лимит исчерпан», если не осталось ничего,
 * иначе «Не хватает дневного лимита»). Если лимита хватает, у пользователя PRO или остаток
 * прочитать не удалось, действие запускается сразу, без вопросов. Ключ
 * studyforge_hide_energy_confirm больше не читается (и не удаляется: его пишет живой клиент).
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

    if (status.isPro || status.ok === false || status.allowed) return true;

    const remaining = Math.max(0, FREE_DAILY_LIMIT - (Number(status.count) || 0));
    const resetAt = formatLimitReset(nextLimitReset());
    try {
      await alert({
        // «Исчерпан» — только когда не осталось ничего; иначе заголовок спорил бы с «осталось 10».
        title: remaining === 0 ? 'Дневной лимит исчерпан' : 'Не хватает дневного лимита',
        message: `${actionName} расходует ${cost} ${unitsWord(cost)}, а на сегодня осталось ${remaining}. Лимит обновится в ${resetAt}.`,
        type: 'info',
        icon: Clock,
        confirmText: 'Понятно',
      });
    } catch (err) {
      console.error('Не удалось показать сообщение о лимите ИИ:', err);
    }
    return false;
  };

  return { verifyEnergy };
}
