/**
 * Форматы лекций и строки о распознавании сканов — одни на загрузку материала и на импорт
 * «только текст». Сервер читает PPTX (backend/parser.py), а скан PDF без текста и фото
 * страниц распознаёт Gemini (backend/ocr.py); ответ тогда несёт ocr: true и pages.
 */

/** MIME-тип PPTX: по нему поле выбора файла показывает презентации и на телефонах. */
export const PPTX_MIME = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';

/** Старый двоичный .ppt сервер не читает; тот же текст отвечает сервер (parser.PPT_LEGACY_DETAIL). */
export const PPT_LEGACY_MESSAGE =
  'Старый формат PowerPoint (.ppt) не читается. Сохраните презентацию как PPTX или PDF и загрузите снова.';

/** Строка там, где появился текст, распознанный со скана (как ocr.OCR_NOTICE на сервере). */
export const OCR_NOTICE = 'Текст распознан со скана — сверьте формулы и числа с оригиналом.';

/** То же для фото страницы. */
export const OCR_PHOTO_NOTICE = 'Текст распознан с фото — сверьте формулы и числа с оригиналом.';

export function isLegacyPpt(fileName: string): boolean {
  return /\.ppt$/i.test(fileName.trim());
}
