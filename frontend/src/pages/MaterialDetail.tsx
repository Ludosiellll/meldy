import type { AnalysisResults, CoreSectionName, Material, SectionStates } from '../types';
import { useCallback, useState, useEffect, useMemo, useRef, type KeyboardEvent } from 'react';
import { Link, useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowLeft, ArrowRight, Globe, MoreHorizontal } from 'lucide-react';
import { format } from 'date-fns';
import { ru } from 'date-fns/locale';
import toast from 'react-hot-toast';
import ResultsPanel from '../components/ResultsPanel';
import ExpressPrepView from '../components/ExpressPrepView';
import { useAuth } from '../hooks/useAuth';
import { useConfirm } from '../contexts/ConfirmContext';
import { getMaterialById, updateMaterialSubject, setMaterialVisibility, updateMaterialTitle } from '../api/materials';
import { parseSections, sectionHasContent } from '../utils/analysisSections';
import '../styles/paper.css';
import './MaterialDetail.css';
import { displayMaterialTitle } from '../utils/materialTitle';

type Mode = 'full' | 'express' | 'podcast';

const PANEL_ID = 'material-mode-panel';
const tabId = (mode: Mode) => `material-mode-${mode}`;
const MODE_LABELS: Record<Mode, string> = { full: 'Материал', express: 'Кратко', podcast: 'Разговор' };
/**
 * What opening a material means, said plainly: the link shows the title and the summary without an account
 * (public.shared_material — never the lecture's own text). There is no public feed of materials any more.
 */
export const PUBLISH_MESSAGE =
  'По ссылке любой сможет открыть название и конспект этого материала, без входа в Meldy. Исходный текст лекции по ссылке не показывается. Закрыть доступ можно в любой момент.';
/** Spec 4.6: nothing for the first 300 ms, then one quiet line instead of a spinner. */
const LOADING_LINE_MS = 300;

/** «13 сентября, 23:16»: when the lecture was added, in words. */
export function addedAt(iso: string | null | undefined): string {
  const date = iso ? new Date(iso) : null;
  return date && !Number.isNaN(date.getTime()) ? format(date, 'd MMMM, H:mm', { locale: ru }) : '';
}

/**
 * One meta line under the title (design critique 12, spec 5.2) instead of chips and «13.09.2026, 23:16»:
 * «Экономика · только для меня · 3 октября, 20:35».
 */
export function materialMeta(input: { subject?: string | null; isPublic: boolean; own: boolean; createdAt: string | null | undefined }): string {
  const line = [
    typeof input.subject === 'string' ? input.subject.trim() : '',
    input.own ? (input.isPublic ? 'открыт по ссылке' : 'только для меня') : 'материал другого автора',
    addedAt(input.createdAt),
  ]
    .filter(Boolean)
    .join(' · ');
  return line.charAt(0).toUpperCase() + line.slice(1);
}

function hasSavedCheatsheet(summary: Record<string, unknown>): boolean {
  return sectionHasContent('cheatsheet', { content: summary.cheatsheet });
}

/**
 * Статусы разделов для панели. Анализ записал их в момент запуска, а шпаргалку и
 * разговор могли создать позже в «Кратко» и «Разговоре»: если они сохранены, раздел есть,
 * что бы ни было записано тогда. Так панель не пишет о сбое того, что уже создано.
 */
function panelSections(summary: Record<string, unknown>): SectionStates | undefined {
  const saved = parseSections(summary.sections);
  if (!saved) return undefined;
  const next: SectionStates = { ...saved };
  if (next.cheatsheet && hasSavedCheatsheet(summary)) next.cheatsheet = { status: 'ok' };
  if (next.podcast && sectionHasContent('podcast', { podcast: summary.podcast })) next.podcast = { status: 'ok' };
  return next;
}

/**
 * Поля, которые «Создать … заново» записало в материал (ResultsPanel, persistSection):
 * созданный раздел, статусы и фрагменты. Остальное (другие разделы, шпаргалка, разговор)
 * могло измениться, пока раздел создавался, поэтому в состояние страницы попадает только это.
 */
function recreatedFields(materialId: string, next: AnalysisResults, section: CoreSectionName) {
  const summaryJson: Record<string, unknown> = { sections: next.sections };
  if (next.grounding) summaryJson.grounding = next.grounding;
  if (section === 'summarizer') {
    const summary = (next.summarizer ?? {}) as unknown as Record<string, unknown>;
    summaryJson.content = summary.content;
    summaryJson.terms = summary.terms;
    summaryJson.source_ids = summary.source_ids;
    return { id: materialId, summary_json: summaryJson };
  }
  if (section === 'flashcards') return { id: materialId, flashcards_json: next.flashcards, summary_json: summaryJson };
  return { id: materialId, quiz_json: next.quiz, summary_json: summaryJson };
}

interface MaterialMenuProps {
  open: boolean;
  isPublic: boolean;
  hasSubject: boolean;
  onToggle: () => void;
  onClose: () => void;
  onRename: () => void;
  onSubject: () => void;
  onShare: () => void;
  onCloseAccess: () => void;
}

/**
 * «⋯» of the lecture (spec 5.2): rename, subject, share, close access. Only the author sees it.
 * Arrows move between items, Escape closes and returns focus to «⋯».
 */
function MaterialMenu({ open, isPublic, hasSubject, onToggle, onClose, onRename, onSubject, onShare, onCloseAccess }: MaterialMenuProps) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!open) return;
    rootRef.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus();
    const onPointer = (event: MouseEvent) => {
      if (rootRef.current && event.target instanceof Node && !rootRef.current.contains(event.target)) onClose();
    };
    document.addEventListener('mousedown', onPointer);
    return () => document.removeEventListener('mousedown', onPointer);
  }, [open, onClose]);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape' && open) {
      event.preventDefault();
      onClose();
      buttonRef.current?.focus();
      return;
    }
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    const items = Array.from(rootRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? []);
    if (items.length === 0) return;
    event.preventDefault();
    const at = items.indexOf(document.activeElement as HTMLButtonElement);
    const next = event.key === 'ArrowDown' ? (at + 1) % items.length : (at - 1 + items.length) % items.length;
    items[next].focus();
  };

  // A field opens for rename and subject and takes the focus; other actions give it back to «⋯».
  const pick = (action: () => void, refocus: boolean) => () => {
    onClose();
    if (refocus) buttonRef.current?.focus();
    action();
  };

  return (
    <div className="sf-head-more" ref={rootRef} onKeyDown={onKeyDown}>
      <button
        ref={buttonRef}
        type="button"
        className="sf-more md-round"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Действия с лекцией"
        onClick={onToggle}
      >
        <MoreHorizontal aria-hidden="true" strokeWidth={1.75} />
      </button>
      {open ? (
        <div className="sf-menu md-menu" role="menu" aria-label="Действия с лекцией">
          <button type="button" role="menuitem" onClick={pick(onRename, false)}>
            Переименовать
          </button>
          <button type="button" role="menuitem" onClick={pick(onSubject, false)}>
            {hasSubject ? 'Изменить предмет' : 'Указать предмет'}
          </button>
          <div className="sf-menu-sep" role="separator" />
          <button type="button" role="menuitem" onClick={pick(onShare, true)}>
            Поделиться
          </button>
          {isPublic ? (
            <button type="button" role="menuitem" onClick={pick(onCloseAccess, true)}>
              Закрыть доступ
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export default function MaterialDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  // «Прогресс» links straight to a tab of the material: ?section=quiz | flashcards | summary.
  const sectionValue = searchParams.get('section');
  const sectionParam = sectionValue === 'quiz' || sectionValue === 'flashcards' || sectionValue === 'summary' ? sectionValue : undefined;
  const { user } = useAuth();
  const { confirm } = useConfirm();
  const tabRefs = useRef<Partial<Record<Mode, HTMLButtonElement | null>>>({});
  const [material, setMaterial] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [loadingLine, setLoadingLine] = useState(false);
  const [editingSubject, setEditingSubject] = useState(false);
  const [subjectInput, setSubjectInput] = useState('');
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleInput, setTitleInput] = useState('');
  const [menuOpen, setMenuOpen] = useState(false);
  const [mode, setMode] = useState<Mode>(
    searchParams.get('mode') === 'express'
      ? (searchParams.get('tab') === 'podcast' ? 'podcast' : 'express')
      : 'full'
  );
  // Ссылки «Повторить за 5 минут» ведут сюда и без шпаргалки: тогда вкладка «Кратко»
  // остаётся видна, чтобы шпаргалку можно было создать.
  const [expressRequested] = useState(() => searchParams.get('mode') === 'express' && searchParams.get('tab') !== 'podcast');
  // Ссылка прямо на разговор: один раз показываем плеер целиком, дальше прокрутку не трогаем.
  const [revealPlayer, setRevealPlayer] = useState(() => searchParams.get('mode') === 'express' && searchParams.get('tab') === 'podcast');
  const closeMenu = useCallback(() => setMenuOpen(false), []);

  useEffect(() => {
    if (!id) return;
    getMaterialById(id)
      .then(data => {
        setMaterial(data);
        setSubjectInput(data.subject || '');
        setTitleInput(data.title || '');
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [id]);

  useEffect(() => {
    if (!loading) return;
    const timer = window.setTimeout(() => setLoadingLine(true), LOADING_LINE_MS);
    return () => window.clearTimeout(timer);
  }, [loading]);

  const saveSubject = async () => {
    if (!id) return;
    try {
      await updateMaterialSubject(id, subjectInput);
    } catch (err) {
      console.error(err);
      toast.error('Не удалось сохранить предмет. Попробуйте ещё раз.');
      return;
    }
    setMaterial((prev: Material) => ({ ...prev, subject: subjectInput }));
    setEditingSubject(false);
  };

  const saveTitle = async () => {
    if (!id || !titleInput.trim()) return;
    try {
      await updateMaterialTitle(id, titleInput.trim());
    } catch (err) {
      console.error(err);
      toast.error('Не удалось сохранить название. Попробуйте ещё раз.');
      return;
    }
    setMaterial((prev: Material) => ({ ...prev, title: titleInput.trim() }));
    setEditingTitle(false);
  };

  const cancelTitle = () => {
    setEditingTitle(false);
    setTitleInput(material?.title || '');
  };

  const cancelSubject = () => {
    setEditingSubject(false);
    setSubjectInput(material?.subject || '');
  };

  /**
   * Открыть материал всем — заметное решение: открытый материал читается без входа,
   * поэтому полный текст, конспект и карточки сможет открыть и скопировать любой, у кого
   * есть ссылка («другие студенты» это преуменьшало, записка жюри, п. 13). Поэтому сначала
   * спрашиваем, а ссылку копируем и «В открытых материалах» показываем только после удачной записи.
   */
  const confirmPublish = () =>
    confirm({
      title: 'Открыть материал по ссылке?',
      message: PUBLISH_MESSAGE,
      confirmText: 'Открыть',
      cancelText: 'Отмена',
      type: 'warning',
      icon: Globe,
    });

  const publish = async (): Promise<boolean> => {
    if (!id) return false;
    if (!(await confirmPublish())) return false;
    try {
      await setMaterialVisibility(id, true);
    } catch (err) {
      console.error(err);
      toast.error('Не удалось открыть доступ. Попробуйте ещё раз.');
      return false;
    }
    setMaterial((prev: Material) => ({ ...prev, is_public: true }));
    return true;
  };

  const shareMaterial = async () => {
    if (!id || !material) return;
    const wasPublic = Boolean(material.is_public);
    if (!wasPublic && !(await publish())) return;
    const shareUrl = `${window.location.origin}/shared/${id}`;
    try {
      await navigator.clipboard.writeText(shareUrl);
      toast.success(wasPublic ? 'Ссылка скопирована' : 'Доступ открыт, ссылка скопирована');
    } catch (err) {
      console.error(err);
      toast(`Доступ открыт. Ссылка: ${shareUrl}`);
    }
  };

  const closeAccess = async () => {
    if (!id || !material?.is_public) return;
    try {
      await setMaterialVisibility(id, false);
      setMaterial((prev: Material) => ({ ...prev, is_public: false }));
    } catch (err) {
      console.error(err);
      toast.error('Не удалось закрыть доступ. Попробуйте ещё раз.');
    }
  };

  // Результат для панели: статусы разделов и «только текст» берутся из summary_json.
  // Шпаргалка передаётся, чтобы строка о её сбое смотрела на сохранённый текст; разговор
  // панель здесь не показывает (у него свой режим), поэтому его реплики не передаются.
  const panelResults = useMemo<AnalysisResults | null>(() => {
    if (!material) return null;
    const summary = material.summary_json && typeof material.summary_json === 'object' ? material.summary_json : {};
    return {
      summarizer: summary,
      flashcards: material.flashcards_json,
      quiz: material.quiz_json,
      cheatsheet: { content: typeof summary.cheatsheet === 'string' ? summary.cheatsheet : '' },
      grounding: summary.grounding,
      sections: panelSections(summary),
      text_only: summary.text_only === true,
    };
  }, [material]);

  if (loading) {
    return (
      <div className="sf-page md-page">
        <p className="sf-lede sf-loading-line" aria-live="polite">
          {loadingLine ? 'Загружаем лекцию…' : ' '}
        </p>
        {loadingLine ? (
          // The shape of the page while the lecture loads: a title, the tabs and the white sheet.
          <div className="md-skeleton" aria-hidden="true">
            <i className="md-skel-title" />
            <i className="md-skel-tabs" />
            <div className="md-skel-card">
              <i />
              <i />
              <i />
              <i />
            </div>
          </div>
        ) : null}
      </div>
    );
  }

  if (!material) {
    return (
      <div className="sf-page md-page">
        <div className="sf-state md-state">
          <h1 className="sf-h2">Лекция не найдена</h1>
          <p className="sf-state-text">Возможно, её удалили или ссылка неполная.</p>
          <p className="md-state-acts">
            <Link className="sf-secondary md-pill md-pill-back" to="/library">
              <span className="md-dot" aria-hidden="true">
                <ArrowLeft strokeWidth={2} />
              </span>
              Лекции
            </Link>
          </p>
        </div>
      </div>
    );
  }

  const summaryJson: Record<string, unknown> =
    material.summary_json && typeof material.summary_json === 'object' ? material.summary_json : {};
  const hasCheatsheet = hasSavedCheatsheet(summaryJson);
  // Шпаргалку просили при анализе, а её нет: «Материал» пишет о сбое, «Кратко» предлагает создать.
  const cheatsheetMissing = Boolean(parseSections(summaryJson.sections)?.cheatsheet) && !hasCheatsheet;
  // Менять материал (создавать шпаргалку и разговор, открывать доступ) может только автор:
  // назначенные преподавателем и чужие открытые материалы только для чтения.
  const canEdit = Boolean(user?.id) && material.user_id === user?.id;
  const cardCount = Array.isArray(material.flashcards_json)
    ? material.flashcards_json.length
    : Array.isArray(material.flashcards_json?.flashcards)
      ? material.flashcards_json.flashcards.length
      : 0;
  // «Разговор» доступен всегда: если его ещё нет, там можно его создать.
  const showExpress = hasCheatsheet || expressRequested || cheatsheetMissing;
  const modes: Mode[] = ['full', ...(showExpress ? (['express'] as const) : []), 'podcast'];

  const selectMode = (next: Mode) => {
    setRevealPlayer(false);
    setMode(next);
  };

  // Вкладки по образцу WAI-ARIA: стрелки, Home и End переключают и переносят фокус.
  const handleTabKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    let next = -1;
    if (event.key === 'ArrowRight') next = (index + 1) % modes.length;
    else if (event.key === 'ArrowLeft') next = (index - 1 + modes.length) % modes.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = modes.length - 1;
    if (next < 0) return;
    event.preventDefault();
    const target = modes[next];
    selectMode(target);
    tabRefs.current[target]?.focus();
  };

  const updateMaterialFields = (updatedFields: any) => {
    setMaterial((prev: any) => {
      if (!prev) return prev;
      // Работа модели могла закончиться, когда на странице уже другой материал: её результат не для него.
      if (updatedFields?.id && updatedFields.id !== prev.id) return prev;
      return {
        ...prev,
        ...updatedFields,
        summary_json: {
          ...prev.summary_json,
          ...(updatedFields.summary_json || {})
        }
      };
    });
  };

  return (
    // On «Разговор» a low window (1280×720 projector) folds the crumb and the meta line and shrinks the title, so the
    // sheet, the subtitle and the player fit without page scroll (components/conversation/conversation.css).
    <div className="sf-page md-page" data-tab={mode === 'podcast' ? 'talk' : undefined}>
      {/* Spec 5.2, critique 12 and the Meldy prototype (Material.dc.html): a crumb pill, the big title, one meta line;
          «Повторить карточки» as the white pill with the black circle and «⋯» as a round button on the right.
          No chips and no second filled button. */}
      <header className="sf-head sf-detail-head md-head">
        <div className="sf-detail-main">
          <Link to="/library" className="sf-crumb md-crumb">
            <ArrowLeft aria-hidden="true" strokeWidth={2} />
            Лекции
          </Link>
          {editingTitle ? (
            <form
              className="sf-inline-edit"
              onSubmit={event => {
                event.preventDefault();
                void saveTitle();
              }}
            >
              <input
                className="sf-input sf-inline-title"
                aria-label="Название лекции"
                value={titleInput}
                onChange={event => setTitleInput(event.target.value)}
                onKeyDown={event => {
                  if (event.key === 'Escape') cancelTitle();
                }}
                autoFocus
              />
              <button type="submit" className="md-small-pill">
                Сохранить
              </button>
              <button type="button" className="sf-link" data-muted="" onClick={cancelTitle}>
                Отмена
              </button>
            </form>
          ) : (
            <h1 className="sf-h1 sf-h1-serif md-title [overflow-wrap:anywhere]">{displayMaterialTitle(material.title)}</h1>
          )}
          {editingSubject ? (
            <form
              className="sf-inline-edit"
              onSubmit={event => {
                event.preventDefault();
                void saveSubject();
              }}
            >
              <input
                className="sf-input"
                aria-label="Предмет"
                placeholder="Предмет"
                value={subjectInput}
                onChange={event => setSubjectInput(event.target.value)}
                onKeyDown={event => {
                  if (event.key === 'Escape') cancelSubject();
                }}
                autoFocus
              />
              <button type="submit" className="md-small-pill">
                Сохранить
              </button>
              <button type="button" className="sf-link" data-muted="" onClick={cancelSubject}>
                Отмена
              </button>
            </form>
          ) : (
            <p className="sf-lede">
              {materialMeta({ subject: material.subject, isPublic: Boolean(material.is_public), own: canEdit, createdAt: material.created_at })}
            </p>
          )}
        </div>
        {cardCount > 0 || canEdit ? (
          <div className="sf-head-actions md-acts">
            {cardCount > 0 && (
              <Link className="sf-secondary md-pill" to={`/review?material=${encodeURIComponent(material.id)}`}>
                Повторить карточки
                <span className="md-dot" aria-hidden="true">
                  <ArrowRight strokeWidth={2} />
                </span>
              </Link>
            )}
            {canEdit && (
              <MaterialMenu
                open={menuOpen}
                isPublic={Boolean(material.is_public)}
                hasSubject={Boolean(material.subject)}
                onToggle={() => setMenuOpen(value => !value)}
                onClose={closeMenu}
                onRename={() => {
                  setTitleInput(material.title || '');
                  setEditingTitle(true);
                }}
                onSubject={() => {
                  setSubjectInput(material.subject || '');
                  setEditingSubject(true);
                }}
                onShare={() => void shareMaterial()}
                onCloseAccess={() => void closeAccess()}
              />
            )}
          </div>
        ) : null}
      </header>

      {/* Режимы: вкладки-пилюли в белой капсуле, текущая — тёмная пилюля (язык Meldy). */}
      <div role="tablist" aria-label="Режим" className="sf-viewtabs md-tabs">
        {modes.map((item, index) => {
          const selected = mode === item;
          return (
            <button
              key={item}
              ref={element => {
                tabRefs.current[item] = element;
              }}
              id={tabId(item)}
              type="button"
              role="tab"
              aria-selected={selected}
              aria-controls={PANEL_ID}
              tabIndex={selected ? 0 : -1}
              onClick={() => selectMode(item)}
              onKeyDown={event => handleTabKeyDown(event, index)}
            >
              {MODE_LABELS[item]}
            </button>
          );
        })}
      </div>

      {/* Контент в зависимости от выбранного режима */}
      <div role="tabpanel" id={PANEL_ID} aria-labelledby={tabId(mode)} className="md-panel">
      {mode === 'full' ? (
        <ResultsPanel
          results={panelResults as AnalysisResults}
          onReset={() => navigate('/analyze')}
          textLength={material.original_text?.length || material.summary_json?.content?.length || 0}
          sourceFileName={material.title}
          materialId={material.id}
          originalText={material.original_text || ''}
          canEdit={canEdit}
          onResultsChange={(next, section) => updateMaterialFields(recreatedFields(material.id, next, section))}
          embedded
          initialTab={sectionParam}
        />
      ) : (
        <ExpressPrepView
          materialId={material.id}
          materialTitle={displayMaterialTitle(material.title)}
          originalText={material.original_text || ''}
          summaryJson={material.summary_json}
          flashcards={Array.isArray(material.flashcards_json) ? material.flashcards_json : material.flashcards_json?.flashcards}
          tab={mode === 'podcast' ? 'podcast' : 'cheatsheet'}
          revealPlayer={revealPlayer}
          onUpdate={updateMaterialFields}
          canEdit={canEdit}
        />
      )}
      </div>
    </div>
  );
}
