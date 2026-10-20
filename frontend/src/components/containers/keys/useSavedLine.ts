import { useCallback, useMemo, useRef } from 'react';
import type { PlanInput, UnitState } from '../../../types/container';
import { KEYS } from '../copyImport';
import { countRestarts } from './editorModel';

/**
 * The line under a question saved in the editor («Вопросы и ключи», «Конструктор»): «Сохранено.», and «Счёт по этому
 * вопросу начнётся заново» only when the save moved the question's rev and somebody's answers to it were counted
 * (editorModel.countRestarts): a member of the exam, or the author's own state of it in the plan. The author's restart
 * is remembered for this visit, so a second save of the same question does not say it again. Phone audit 47.3: a
 * brand-new test's first saves said the count would start again where nothing had been counted.
 */
export function useSavedLine(planInput: PlanInput | null | undefined, group: boolean): (itemId: string, revChanged: boolean) => string {
  const own = useMemo(() => {
    const map = new Map<string, UnitState | undefined>();
    for (const entry of planInput?.items ?? []) if (entry.f === 't') map.set(entry.id, entry.u);
    return map;
  }, [planInput]);
  const restarted = useRef(new Set<string>());
  return useCallback(
    (itemId: string, revChanged: boolean) => {
      if (!revChanged) return KEYS.edited;
      const counted = countRestarts(group, own.get(itemId), restarted.current.has(itemId));
      restarted.current.add(itemId);
      return counted ? KEYS.editedReset(group) : KEYS.edited;
    },
    [group, own],
  );
}
