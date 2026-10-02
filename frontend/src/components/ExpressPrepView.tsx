import { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import 'katex/dist/katex.min.css';
import { FileText, LoaderCircle, Share2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { useAuth } from '../hooks/useAuth';
import { useConfirm } from '../contexts/ConfirmContext';
import { supabase } from '../lib/supabase';
import { incrementAIUsage } from '../api/limits';
import { useEnergyConfirm } from '../hooks/useEnergyConfirm';
import ConversationPlayer from './conversation/ConversationPlayer';
import type { ConversationFlashcard, PodcastLine } from './conversation/types';

export type ExpressTab = 'cheatsheet' | 'podcast';

interface ExpressPrepViewProps {
  summaryJson: any;
  materialId?: string;
  materialTitle?: string;
  originalText?: string;
  /** Карточки материала (flashcards_json.flashcards) — помогают подобрать вопросы к репликам. */
  flashcards?: ConversationFlashcard[] | null;
  onUpdate?: (updatedFields: any) => void;
  /** Начальная вкладка, если компонент управляет вкладками сам. */
  initialTab?: ExpressTab;
  /** Управляемая вкладка (вместе с onTabChange). */
  tab?: ExpressTab;
  onTabChange?: (tab: ExpressTab) => void;
  /** Скрыть переключатель вкладок и «Поделиться», когда их показывает страница. */
  showTabs?: boolean;
  /** Прокрутить к плееру разговора после открытия (переход по ссылке на разговор). */
  revealPlayer?: boolean;
}

const TABS: { id: ExpressTab; label: string }[] = [
  { id: 'cheatsheet', label: 'Шпаргалка' },
  { id: 'podcast', label: 'Разговор' },
];

/** summary_json без служебных полей интерфейса — только то, что можно сохранять. */
function storableSummary(summaryJson: any): Record<string, unknown> {
  const next: Record<string, unknown> = { ...(summaryJson && typeof summaryJson === 'object' ? summaryJson : {}) };
  delete next._startTab;
  return next;
}

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
  initialTab,
  tab: controlledTab,
  onTabChange,
  showTabs = true,
  revealPlayer = false,
}: ExpressPrepViewProps) {
  const { user } = useAuth();
  const { alert } = useConfirm();
  const { verifyEnergy } = useEnergyConfirm();

  const cheatsheet: string = typeof summaryJson?.cheatsheet === 'string' ? summaryJson.cheatsheet : '';
  const podcastLines: unknown[] = Array.isArray(summaryJson?.podcast) ? summaryJson.podcast : [];
  const terms = Array.isArray(summaryJson?.terms) ? summaryJson.terms : undefined;
  const cards: ConversationFlashcard[] | undefined =
    flashcards ?? (Array.isArray(summaryJson?.flashcards?.flashcards) ? summaryJson.flashcards.flashcards : undefined);
  const sources = Array.isArray(summaryJson?.grounding?.sources) ? summaryJson.grounding.sources : undefined;
  const title: string = materialTitle || summaryJson?.title || '';

  const [ownTab, setOwnTab] = useState<ExpressTab>(
    initialTab ?? (summaryJson?._startTab === 'podcast' ? 'podcast' : 'cheatsheet'),
  );
  const tab = controlledTab ?? ownTab;
  const selectTab = (next: ExpressTab) => {
    setOwnTab(next);
    onTabChange?.(next);
  };

  const [isGenerating, setIsGenerating] = useState(false);

  const handleCreateCheatsheet = async () => {
    if (!materialId || isGenerating) return;
    setIsGenerating(true);

    const context = (originalText || summaryJson?.content || '').slice(0, 15000);
    if (!context.trim()) {
      await alert({ title: 'Ошибка', message: 'Недостаточно текста для шпаргалки.', type: 'danger' });
      setIsGenerating(false);
      return;
    }

    if (user?.id) {
      const ok = await verifyEnergy(user.id, 5, 'Создание шпаргалки');
      if (!ok) {
        setIsGenerating(false);
        return;
      }
    }

    try {
      const res = await fetch('/api/quick-prep', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ context }),
      });
      if (!res.ok) throw new Error(`quick-prep ${res.status}`);
      const d = await res.json();
      if (!d.cheatsheet) throw new Error('empty cheatsheet');

      const nextSummary = { ...storableSummary(summaryJson), cheatsheet: d.cheatsheet };
      const { error } = await supabase.from('materials').update({ summary_json: nextSummary }).eq('id', materialId);
      if (error) throw error;

      // Списываем энергию только после успешного сохранения.
      if (user?.id) await incrementAIUsage(user.id, 5);
      onUpdate?.({ summary_json: nextSummary });
    } catch (err) {
      console.error(err);
      await alert({ title: 'Ошибка', message: 'Не удалось создать шпаргалку. Попробуйте ещё раз.', type: 'danger' });
    } finally {
      setIsGenerating(false);
    }
  };

  const handleShare = async () => {
    if (!materialId) return;
    try {
      const { error } = await supabase.from('materials').update({ is_public: true }).eq('id', materialId);
      if (error) throw error;
      const shareUrl = `${window.location.origin}/shared/${materialId}`;
      await navigator.clipboard.writeText(shareUrl);
      toast.success('Ссылка скопирована');
    } catch (err) {
      console.error(err);
      toast.error('Не удалось создать ссылку');
    }
  };

  // Родитель сливает summary_json сам, поэтому передаём только реплики: устаревшая
  // копия остальных полей не должна затереть то, что изменилось за это время.
  const handleLinesUpdate = (lines: PodcastLine[]) => {
    onUpdate?.({ summary_json: { podcast: lines } });
  };

  return (
    <div className="space-y-5">
      {showTabs && (
        <div className="flex items-center justify-between gap-3">
          <div role="tablist" aria-label="Режим" className="flex rounded-lg border border-[var(--sf-line)] p-0.5">
            {TABS.map(item => {
              const selected = tab === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  role="tab"
                  aria-selected={selected}
                  onClick={() => selectTab(item.id)}
                  className={`h-8 rounded-md px-3 text-sm font-medium transition-colors ${
                    selected
                      ? 'bg-[var(--sf-surface-soft)] text-[var(--sf-ink)]'
                      : 'text-[var(--sf-muted)] hover:text-[var(--sf-ink)]'
                  }`}
                >
                  {item.label}
                </button>
              );
            })}
          </div>
          {materialId && (
            <button
              type="button"
              onClick={handleShare}
              className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-[var(--sf-line)] px-3 text-sm font-medium text-[var(--sf-ink)] transition-colors hover:bg-[var(--sf-surface-soft)]"
            >
              <Share2 aria-hidden="true" className="h-4 w-4" />
              Поделиться
            </button>
          )}
        </div>
      )}

      {tab === 'cheatsheet' &&
        (cheatsheet.trim() ? (
          <article className="rounded-xl border border-[var(--sf-line)] bg-[var(--sf-surface)] px-5 py-6 sm:px-8 sm:py-8">
            <header className="mb-5 border-b border-[var(--sf-line)] pb-4">
              <h2 className="text-lg font-semibold text-[var(--sf-ink)]">Шпаргалка</h2>
              <p className="mt-0.5 text-xs text-[var(--sf-muted)]">Главное из материала для быстрого повторения</p>
            </header>
            <div className={MARKDOWN_CLASSES}>
              <ReactMarkdown remarkPlugins={[remarkMath]} rehypePlugins={[rehypeKatex]}>
                {cheatsheet}
              </ReactMarkdown>
            </div>
          </article>
        ) : (
          <section className="rounded-xl border border-[var(--sf-line)] bg-[var(--sf-surface)] px-5 py-10 text-center sm:px-8">
            <FileText aria-hidden="true" strokeWidth={1.5} className="mx-auto h-10 w-10 text-[var(--sf-muted)]" />
            <h2 className="mt-4 text-base font-semibold text-[var(--sf-ink)]">Шпаргалка ещё не создана</h2>
            <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-[var(--sf-muted)]">
              Соберём главное из материала: определения, формулы и частые ошибки на экзамене.
            </p>
            {materialId ? (
              <button
                type="button"
                onClick={handleCreateCheatsheet}
                disabled={isGenerating}
                className="mx-auto mt-6 inline-flex h-10 items-center gap-2 rounded-lg bg-[var(--sf-accent)] px-4 text-sm font-semibold text-white transition-colors hover:bg-[var(--sf-accent-hover)] disabled:cursor-wait disabled:opacity-70"
              >
                {isGenerating && <LoaderCircle aria-hidden="true" className="h-4 w-4 animate-spin motion-reduce:animate-none" />}
                {isGenerating ? 'Составляем шпаргалку…' : 'Создать шпаргалку'}
              </button>
            ) : (
              <p className="mt-5 text-xs text-[var(--sf-muted)]">Шпаргалку можно создать на странице материала в библиотеке.</p>
            )}
          </section>
        ))}

      {tab === 'podcast' && (
        <ConversationPlayer
          lines={podcastLines}
          title={title}
          terms={terms}
          flashcards={cards}
          sources={sources}
          materialId={materialId}
          onLinesUpdate={handleLinesUpdate}
          revealOnMount={revealPlayer}
        />
      )}
    </div>
  );
}
