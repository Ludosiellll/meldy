import ReactMarkdown from 'react-markdown';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import 'katex/dist/katex.min.css';
import { AlertCircle, LoaderCircle } from 'lucide-react';
import { useAuth } from '../hooks/useAuth';
import { notifyAIUsageChanged } from '../api/limits';
import { AI_COSTS } from '../lib/plans';
import { useEnergyConfirm } from '../hooks/useEnergyConfirm';
import ConversationPlayer from './conversation/ConversationPlayer';
import { stripSourceMarkers } from './summary/fragmentModel';
import { ConversationError, postJson, saveCheatsheet } from './conversation/persistence';
import { runJob, useJobStatus } from './conversation/jobs';
import type { ConversationFlashcard, PodcastLine } from './conversation/types';
import './ExpressPrepView.css';

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
        if (userId && !(await verifyEnergy(userId, AI_COSTS.cheatsheet, 'Создание шпаргалки'))) return;
        begin();
        const payload = (await postJson('/api/quick-prep', { context })) as { cheatsheet?: unknown } | null;
        const next = typeof payload?.cheatsheet === 'string' ? payload.cheatsheet.trim() : '';
        if (!next) throw new ConversationError(CHEATSHEET_FAILED);
        // Меняется только cheatsheet: разговор, сохранённый за это время, остаётся.
        await saveCheatsheet(id, next);
        // Единицы списал сервер до модели (и вернул бы при сбое): обновляем остаток на экране.
        notifyAIUsageChanged();
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
      <article className="xp-sheet">
        <header className="xp-sheet-head">
          <h2>Шпаргалка</h2>
          <p>Главное из материала для быстрого повторения</p>
        </header>
        <div className="xp-md">
          <ReactMarkdown remarkPlugins={[remarkMath]} rehypePlugins={[rehypeKatex]}>
            {stripSourceMarkers(cheatsheet)}
          </ReactMarkdown>
        </div>
      </article>
    );
  }

  return (
    <section className="xp-empty">
      <div className="xp-empty-text">
        <h2>Шпаргалка ещё не создана</h2>
        <p className="xp-empty-p">Соберём главное из материала: определения, формулы и частые ошибки на экзамене.</p>
        {materialId && canEdit ? (
          <div className="xp-empty-acts">
            <button type="button" onClick={handleCreateCheatsheet} disabled={isGenerating} className="sf-primary xp-create" aria-busy={isGenerating || undefined}>
              {isGenerating && <LoaderCircle aria-hidden="true" className="xp-spin" />}
              {isGenerating ? 'Составляем шпаргалку…' : 'Создать шпаргалку'}
            </button>
            {cheatsheetJob.state === 'error' && (
              <div role="alert" className="xp-error">
                <span className="xp-error-text">
                  <AlertCircle aria-hidden="true" />
                  {cheatsheetJob.message}
                </span>
                <button type="button" onClick={handleCreateCheatsheet} className="xp-retry">
                  Повторить
                </button>
              </div>
            )}
          </div>
        ) : (
          <p className="xp-empty-note">
            {materialId ? 'Шпаргалку может создать только автор материала.' : 'Шпаргалку можно создать на странице материала в библиотеке.'}
          </p>
        )}
      </div>
      {/* A sheet of the main points on a warm panel (no words, no numbers). */}
      <div className="xp-art" aria-hidden="true">
        <span className="xp-art-sheet">
          <i />
          <i />
          <i />
          <i />
          <i />
        </span>
      </div>
    </section>
  );
}
