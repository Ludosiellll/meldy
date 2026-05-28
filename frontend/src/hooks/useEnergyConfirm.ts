import { useConfirm } from '../contexts/ConfirmContext';
import { checkAILimit, FREE_DAILY_LIMIT } from '../api/limits';
import { useNavigate } from 'react-router-dom';
import { Zap } from 'lucide-react';

export function useEnergyConfirm() {
  const { confirm } = useConfirm();
  const navigate = useNavigate();

  const verifyEnergy = async (userId: string, cost: number, actionName: string = 'Это действие'): Promise<boolean> => {
    try {
      const { allowed, isPro, count } = await checkAILimit(userId, cost);

      if (isPro) {
        return true; // PRO users do not need to confirm or care about limits
      }

      const remaining = Math.max(0, FREE_DAILY_LIMIT - count);

      if (!allowed) {
        const wantsPro = await confirm({
          title: 'Энергия ИИ исчерпана',
          message: `${actionName} требует ${cost} ⚡, но у вас осталось только ${remaining} ⚡. Перейдите на тариф PRO для безлимитного использования ИИ!`,
          type: 'danger',
          icon: Zap,
          confirmText: 'Подключить PRO',
          cancelText: 'Позже'
        });
        
        if (wantsPro) {
          navigate('/pricing');
        }
        return false;
      }

      // Check if user disabled confirmations globally
      const hideConfirm = localStorage.getItem('studyforge_hide_energy_confirm') === 'true';
      if (hideConfirm) {
        return true;
      }

      // Show confirmation modal
      const confirmed = await confirm({
        title: 'Запуск ИИ',
        message: `${actionName} спишет ${cost} ⚡ энергии ИИ. У вас останется ${remaining - cost} ⚡ до конца дня. Продолжить?`,
        type: 'warning',
        icon: Zap,
        confirmText: 'Запустить',
        cancelText: 'Отмена',
        checkboxLabel: 'Больше не спрашивать',
        onCheckboxChange: (checked) => {
          if (checked) {
            localStorage.setItem('studyforge_hide_energy_confirm', 'true');
          }
        }
      });

      return confirmed;
    } catch (err) {
      console.error('Ошибка проверки энергии:', err);
      return true; // fail-safe open
    }
  };

  return { verifyEnergy };
}
