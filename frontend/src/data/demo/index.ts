/**
 * Встроенный демо-текст для страницы анализа.
 *
 * Запуск считается демо, только если анализируемый текст совпадает с DEMO_TEXT
 * (без пробелов по краям): лимит не списывается, настройки всегда по умолчанию,
 * а в библиотеку материал попадает один раз (summary_json.demo_text_id).
 * Заголовки в lecture.txt стоят строкой выше своего абзаца, поэтому ни один
 * фрагмент источника не состоит из одного заголовка. Если текст поменяется,
 * увеличьте DEMO_TEXT_ID.
 */
import lecture from './lecture.txt?raw';
import { DEFAULT_SETTINGS, type AnalysisSettings } from '../../types';

export const DEMO_TEXT: string = lecture.trim();
export const DEMO_TEXT_ID = 'demo-v1';
export const DEMO_TITLE = 'Нейронные сети и глубокое обучение';
export const DEMO_SETTINGS: AnalysisSettings = DEFAULT_SETTINGS;

/** Это встроенный демо-текст (пробелы по краям не важны). */
export function isDemoText(text: string | null | undefined): boolean {
  return typeof text === 'string' && text.trim() === DEMO_TEXT;
}
