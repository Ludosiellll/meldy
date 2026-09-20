import type { AnalysisResults } from '../types';

const GENERIC_TITLES = new Set([
  'без названия',
  'введение',
  'введение в тему',
  'конспект',
  'лекция',
  'материал',
  'новый материал',
  'результат анализа',
  'учебный материал',
  'unknown',
]);

export function stripFileExtension(value = ''): string {
  return value.replace(/\.[^/.]+$/, '').trim();
}

export function cleanTitleCandidate(value?: string | null): string {
  if (!value) return '';

  return value
    .replace(/^[#*_`\s«»"'–—-]+/, '')
    .replace(/[#*_`\s«»"'–—-]+$/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function isGenericMaterialTitle(value?: string | null): boolean {
  const title = cleanTitleCandidate(stripFileExtension(value || ''));
  if (!title) return true;

  const lower = title.toLocaleLowerCase('ru-RU');
  return (
    GENERIC_TITLES.has(lower) ||
    /^\d+(?:[_\s-]\d+)*$/.test(lower) ||
    /^(img|image|screenshot|whatsapp|photo|video|audio|file|doc|document|scan|temp)[_\s-]/.test(lower) ||
    lower.includes('снимок экрана') ||
    lower.includes('безымянн') ||
    /^https?:\/\//.test(lower)
  );
}

function titleFromSummaryContent(content?: string): string {
  if (!content) return '';

  const headings = content
    .split('\n')
    .map(line => line.match(/^#{1,3}\s+(.+)$/)?.[1])
    .filter((line): line is string => Boolean(line))
    .map(cleanTitleCandidate);

  return headings.find(title => title.length <= 80 && !isGenericMaterialTitle(title)) || '';
}

export function getResultDisplayTitle(results: AnalysisResults, sourceFileName?: string): string {
  const generatedTitle = cleanTitleCandidate(results.summarizer?.title);
  if (generatedTitle && generatedTitle.length <= 90 && !isGenericMaterialTitle(generatedTitle)) {
    return generatedTitle;
  }

  const fileTitle = cleanTitleCandidate(stripFileExtension(sourceFileName || ''));
  if (fileTitle && fileTitle.length <= 90 && !isGenericMaterialTitle(fileTitle)) {
    return fileTitle;
  }

  const contentTitle = titleFromSummaryContent(
    results.summarizer?.content || (results.summarizer as { raw?: string })?.raw,
  );
  if (contentTitle) return contentTitle;

  const subject = cleanTitleCandidate(results.summarizer?.subject);
  if (subject && !isGenericMaterialTitle(subject)) return subject;

  return 'Учебный материал';
}
