// Название материала для показа. В базе часто лежит имя файла
// («22_Тема_4_3_Использование_роли_пользователей.pdf»): без пробелов его нельзя
// перенести, и на карточке оно вылезает за край. Здесь оно становится обычной
// строкой («Тема 4.3 Использование роли пользователей»). Сохранённое название
// не меняется — только то, что видит человек.

const FILE_EXTENSIONS = /\.(pdf|docx?|txt|md|markdown|rtf|odt|pptx?|xlsx?|csv|html?|mp3|m4a|wav|ogg|oga|opus|flac|aac|mp4|webm|mov|mkv|png|jpe?g|webp|heic)$/i;
const NUMBERED_PARTS = /(^|\s)(тема|лекция|глава|раздел|модуль|часть|урок|занятие|семинар|topic|lecture|chapter|section|unit|part)\s+(\d{1,3})\s+(\d{1,3})(?:\s+(\d{1,3}))?(?=\s|$)/giu;

export function displayMaterialTitle(raw?: string | null, fallback = 'Без названия'): string {
  if (typeof raw !== 'string') return fallback;
  let title = raw.trim().replace(FILE_EXTENSIONS, '');
  if (/_/.test(title)) title = title.replace(/_+/g, ' ');
  title = title.replace(/\s+/g, ' ').trim();
  // «Тема 4 3» из имени файла — это «Тема 4.3».
  title = title.replace(NUMBERED_PARTS, (_m, lead: string, word: string, a: string, b: string, c?: string) =>
    `${lead}${word} ${a}.${b}${c ? `.${c}` : ''}`,
  );
  // Порядковый номер файла в начале («22 Тема …») ничего не говорит человеку.
  title = title.replace(/^\d{1,3}[\s.)-]+(?=\p{L})/u, '');
  title = title.trim();
  if (!title) return fallback;
  return title.charAt(0).toLocaleUpperCase('ru-RU') + title.slice(1);
}
