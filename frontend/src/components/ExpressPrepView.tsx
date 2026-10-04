import ReactMarkdown from 'react-markdown';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import 'katex/dist/katex.min.css';
import { AlertCircle, LoaderCircle } from 'lucide-react';
import { useAuth } from '../hooks/useAuth';
import { incrementAIUsage } from '../api/limits';
import { useEnergyConfirm } from '../hooks/useEnergyConfirm';
import ConversationPlayer from './conversation/ConversationPlayer';
import { stripSourceMarkers } from './summary/fragmentModel';
import { ConversationError, postJson, saveCheatsheet } from './conversation/persistence';
import { runJob, useJobStatus } from './conversation/jobs';
import type { ConversationFlashcard, PodcastLine } from './conversation/types';

export type ExpressTab = 'cheatsheet' | 'podcast';

interface ExpressPrepViewProps {
  summaryJson: any;
  materialId?: string;
  materialTitle?: string;
  originalText?: string;
  /** Карточки материала (flashcards_json.flashcards) — помогают подобрать вопросы к репликам. */
  flashcards?: ConversationFlashcard[] | null;
  /**
   * Родитель сливает summary_json сам, поэтому сюда приходят только изменённые
   * ключи ({ id, summary_json: { cheatsheet } } или { id, summary_json: { podcast } }).
   * id — материал, для которого работа делалась: страница могла уже показать другой.
   */
  onUpdate?: (updatedFields: any) => void;
  /** Вкладка, которую выбрала страница («Кратко» или «Разговор»). */
  tab: ExpressTab;
  /** Прокрутить к плееру разговора после открытия (переход по ссылке на разговор). */
  revealPlayer?: boolean;
  /** Можно ли менять материал (создавать шпаргалку и разговор): только у своего материала. */
  canEdit?: boolean;
}

const CHEATSHEET_FAILED = 'Не удалось создать шпаргалку. Попробуйте ещё раз.';

const MARKDOWN_CLASSES = [
  'text-[15px] leading-relaxed text-[var(--sf-ink)]',
  '[&>*:first-child]:mt-0',
  '[&_h1]:mb-3 [&_h1]:mt-7 [&_h1]:text-xl [&_h1]:font-semibold',
  '[&_h2]:mb-2 [&_h2]:mt-7 [&_h2]:border-b [&_h2]:border-[var(--sf-line)] [&_h2]:pb-1.5 [&_h2]:text-lg [&_h2]:font-semibold',
  '[&_h3]:mb-1.5 [&_h3]:mt-5 [&_h3]:text-base [&_h3]:font-semibold',
  '[&_p]:my-2.5',
  '[&_ul]:my-2.5 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:my-2.5 [&_ol]:list-decimal [&_ol]:pl-5 [&_li]:my-1',
  '[&_li::marker]:text-[var(--sf-muted)]',
  '[&_strong]:font-semibold',
  '[&_code]:rounded [&_code]:bg-[var(--sf-surface-soft)] [&_code]:px-1 [&_code]:py-px [&_code]:text-[0.9em]',
  '[&_blockquote]:my-3 [&_blockquote]:border-l-2 [&_blockquote]:border-[var(--sf-line)] [&_blockquote]:pl-4 [&_blockquote]:text-[var(--sf-muted)]',
  '[&_hr]:my-6 [&_hr]:border-[var(--sf-line)]',
  '[&_table]:my-3 [&_table]:w-full [&_table]:border-collapse [&_td]:border [&_td]:border-[var(--sf-line)] [&_td]:px-2 [&_td]:py-1 [&_th]:border [&_th]:border-[var(--sf-line)] [&_th]:px-2 [&_th]:py-1 [&_th]:text-left',
  '[&_.katex-display]:overflow-x-auto [&_.katex-display]:overflow-y-hidden [&_.katex-display]:py-1',
].join(' ');

export default function ExpressPrepView({
  summaryJson,
  materialId,
  materialTitle,
  originalText,
  flashcards,
  onUpdate,
  tab,
  revealPlayer = false,
  canEdit = true,
}: ExpressPrepViewProps) {
  const { user } = useAuth();
  const { verifyEnergy } = useEnergyConfirm();
  // Шпаргалка составляется 10–30 секунд, а вкладку можно сменить: состояние работы живёт вне компонента.
  const cheatsheetJob = useJobStatus('cheatsheet', materialId);
  const isGenerating = cheatsheetJob.state === 'working';

  const cheatsheet: string = typeof summaryJson?.cheatsheet === 'string' ? summaryJson.cheatsheet : '';
  const podcastLines: unknown[] = Array.isArray(summaryJson?.podcast) ? summaryJson.podcast : [];
  const terms = Array.isArray(summaryJson?.terms) ? summaryJson.terms : undefined;
  const cards: ConversationFlashcard[] | undefined =
    flashcards ?? (Array.isArray(summaryJson?.flashcards?.flashcards) ? summaryJson.flashcards.flashcards : undefined);
  const sources = Array.isArray(summaryJson?.grounding?.sources) ? summaryJson.grounding.sources : undefined;
  const title: string = materialTitle || summaryJson?.title || '';

  const handleCreateCheatsheet = () => {
    if (!materialId || !canEdit) return;
    const id = materialId;
    const userId = user?.id;
    const context = (originalText || summaryJson?.content || '').slice(0, 15000);
    const deliver = onUpdate;
    void runJob(
      'cheatsheet',
      id,
      async begin => {
        if (!context.trim()) throw new ConversationError('Недостаточно текста для шпаргалки.');
        if (userId && !(await verifyEnergy(userId, 5, 'Создание шпаргалки'))) return;
        begin();
        const payload = (await postJson('/api/quick-prep', { context })) as { cheatsheet?: unknown } | null;
        const next = typeof payload?.cheatsheet === 'string' ? payload.cheatsheet.trim() : '';
        if (!next) throw new ConversationError(CHEATSHEET_FAILED);
        // Меняется только cheatsheet: разговор, сохранённый за это время, остаётся.
        await saveCheatsheet(id, next);
        // Списываем энергию только после успешного сохранения.
        if (userId) {
          try {
            await incrementAIUsage(userId, 5);
          } catch (error) {
            console.warn('incrementAIUsage failed', error);
          }
        }
        deliver?.({ id, summary_json: { cheatsheet: next } });
      },
      CHEATSHEET_FAILED,
    );
  };

  // Родитель сливает summary_json сам, поэтому передаём только реплики: устаревшая
  // копия остальных полей не должна затереть то, что изменилось за это время.
  const handleLinesUpdate = (lines: PodcastLine[]) => {
    onUpdate?.({ id: materialId, summary_json: { podcast: lines } });
  };

  if (tab === 'podcast') {
    return (
      <ConversationPlayer
        lines={podcastLines}
        title={title}
        terms={terms}
        flashcards={cards}
        sources={sources}
        materialId={materialId}
        onLinesUpdate={handleLinesUpdate}
        revealOnMount={revealPlayer}
        canEdit={canEdit}
      />
    );
  }

  if (cheatsheet.trim()) {
    return (
      <article className="rounded-xl border border-[var(--sf-line)] bg-[var(--sf-surface)] px-5 py-6 sm:px-8 sm:py-8">
        <header className="mb-5 border-b border-[var(--sf-line)] pb-4">
          <h2 className="text-lg font-semibold text-[var(--sf-ink)]">Шпаргалка</h2>
          <p className="mt-0.5 text-[13px] text-[var(--sf-muted)]">Главное из материала для быстрого повторения</p>
        </header>
        <div className={MARKDOWN_CLASSES}>
          <ReactMarkdown remarkPlugins={[remarkMath]} rehypePlugins={[rehypeKatex]}>
            {stripSourceMarkers(cheatsheet)}
          </ReactMarkdown>
        </div>
      </article>
    );
  }

  return (
    <section className="rounded-xl border border-[var(--sf-line)] bg-[var(--sf-surface)] px-6 py-8 text-[var(--sf-ink)]">
      <h2 className="text-lg font-semibold leading-snug">Шпаргалка ещё не создана</h2>
      <p className="mt-2 max-w-[56ch] text-sm leading-relaxed text-[var(--sf-muted)]">
        Соберём главное из материала: определения, формулы и частые ошибки на экзамене.
      </p>
      {materialId && canEdit ? (
        <div className="mt-6 flex flex-col items-start gap-4">
          <button
            type="button"
            onClick={handleCreateCheatsheet}
            disabled={isGenerating}
            className="inline-flex h-10 items-center gap-2 rounded-lg bg-[var(--sf-accent)] px-4 text-sm font-semibold text-white transition-colors hover:bg-[var(--sf-accent-hover)] disabled:cursor-wait disabled:opacity-70"
          >
            {isGenerating && <LoaderCircle aria-hidden="true" className="h-4 w-4 animate-spin motion-reduce:animate-none" />}
            {isGenerating ? 'Составляем шпаргалку…' : 'Создать шпаргалку'}
          </button>
          {cheatsheetJob.state === 'error' && (
            <div role="alert" className="flex flex-wrap items-center gap-x-3 gap-y-2 text-sm text-[var(--sf-ink)]">
              <span className="inline-flex items-center gap-1.5">
                <AlertCircle aria-hidden="true" className="h-4 w-4 shrink-0 text-[var(--sf-muted)]" />
                {cheatsheetJob.message}
              </span>
              <button
                type="button"
                onClick={handleCreateCheatsheet}
                className="inline-flex h-8 items-center rounded-lg border border-[var(--sf-line)] px-3 text-sm font-medium text-[var(--sf-ink)] transition-colors [@media(hover:hover)]:hover:bg-[var(--sf-surface-soft)]"
              >
                Повторить
              </button>
            </div>
          )}
        </div>
      ) : (
        <p className="mt-5 text-sm text-[var(--sf-muted)]">
          {materialId ? 'Шпаргалку может создать только автор материала.' : 'Шпаргалку можно создать на странице материала в библиотеке.'}
        </p>
      )}
    </section>
  );
}
