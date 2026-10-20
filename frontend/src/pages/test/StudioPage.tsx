import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth';
import { rememberContainerTitle } from '../../lib/containers/titleCache';
import { useDocumentTitle } from '../../lib/useDocumentTitle';
import { checkTest } from '../../lib/studio/checker';
import { useFrame } from '../../components/exams/useFrame';
import { KEYS } from '../../components/containers/copyImport';
import { useSavedLine } from '../../components/containers/keys/useSavedLine';
import { TO_EXAMS } from '../../components/containers/copy';
import { goneWords } from '../../components/test/copyTest';
import { useBuild } from '../../components/test/useBuild';
import { STUDIO, type Panel, type StudioView } from '../../components/studio/copyStudio';
import EmptyStart from '../../components/studio/EmptyStart';
import { UiIcon } from '../../components/studio/icons';
import ListView from '../../components/studio/ListView';
import { bottomBarShown, hasBottomBar, sendWords, useTyping } from '../../components/studio/phone';
import Preview from '../../components/studio/Preview';
import Side from '../../components/studio/Side';
import TextView from '../../components/studio/TextView';
import Tour, { tourSeen } from '../../components/studio/Tour';
import { useDark } from '../../components/studio/useDark';
import { useStudio, type SaveState } from '../../components/studio/useStudio';
import Workspace from '../../components/studio/Workspace';
import type { Uuid } from '../../types/container';
import '../../components/exams/exams.css';
import '../../components/studio/studio.css';

/**
 * /exams/c/:id/studio — «Студия теста» (spec meldy-notes 10_Project/Test_Builder_Spec_2026-10-18.md §47.6; plan
 * docs/superpowers/plans/2026-10-18-studio.md, «Canvas UI»): the test built like a site. Three views of one page —
 * «Холст» (the page as the participant sees it, edited in place: Workspace), «Список» (the release-47 cards: ListView)
 * and «Текст» (TextView) — over one document that saves itself (useStudio). The top bar: the views, a phone or a
 * computer for the canvas, «Отменить / Повторить» (Ctrl+Z, Ctrl+Shift+Z, Ctrl+Y), «Проверка теста», «Посмотреть как
 * участник» and «Отправить по ссылке» (the quiz setup with every question of the page, «как в студии»).
 */

const VIEWS: StudioView[] = ['canvas', 'list', 'text'];

function SaveLine({ save, onRetry, onReload }: { save: SaveState; onRetry: () => void; onReload: () => void }) {
  switch (save.kind) {
    case 'idle':
      return <span className="st-save" />;
    case 'saving':
      return (
        <span className="st-save">
          <span className="st-save-t">{STUDIO.saving}</span>
        </span>
      );
    case 'saved':
      return (
        <span className="st-save" data-ok="">
          <UiIcon name="check" />
          <span className="st-save-t">{STUDIO.saved}</span>
        </span>
      );
    case 'offline':
    case 'failed':
      return (
        <span className="st-save" data-bad="">
          <span className="st-save-t">{save.kind === 'offline' ? STUDIO.offline : `${STUDIO.failed}: ${save.message}`}</span>
          <button type="button" className="st-save-btn" onClick={onRetry}>
            {STUDIO.retry}
          </button>
        </span>
      );
    case 'invalid':
      return (
        <span className="st-save" data-bad="" title={save.problems[0]?.message}>
          <span className="st-save-t">{`${STUDIO.invalid}: ${save.problems[0]?.message ?? ''}`}</span>
        </span>
      );
    case 'stale':
      return (
        <span className="st-save" data-bad="">
          <span className="st-save-t">{STUDIO.stale}</span>
          <button type="button" className="st-save-btn" onClick={onReload}>
            {STUDIO.reload}
          </button>
        </span>
      );
  }
}

export default function StudioPage() {
  const params = useParams();
  const navigate = useNavigate();
  const [search] = useSearchParams();
  const containerId = (params.id ?? '') as Uuid;
  const frame = useFrame<HTMLDivElement>();
  const phone = frame.size === 's';
  /** Below a computer's width the palette and the settings are sheets, opened from the bottom bar. */
  const narrow = hasBottomBar(frame.size);
  /** A field of the page takes the keyboard: the bottom bar steps away (it would stand over the field). */
  const mainRef = useRef<HTMLElement>(null);
  const typing = useTyping(mainRef);
  const build = useBuild(containerId);
  const { data, summary, owner, group } = build;
  /** «Счёт… начнётся заново» only where somebody's answers were counted (not on a new test's first saves). */
  const savedLine = useSavedLine(data.data?.planInput, group);
  const studio = useStudio(containerId, build);
  const { user } = useAuth();
  const dark = useDark();
  useDocumentTitle(summary ? `${STUDIO.docTitle} · ${summary.title}` : STUDIO.docTitle);
  useEffect(() => {
    if (summary) rememberContainerTitle(summary.id, summary.title);
  }, [summary]);

  const initialView = search.get('view');
  const [view, setView] = useState<StudioView>(VIEWS.includes(initialView as StudioView) ? (initialView as StudioView) : 'canvas');
  const [device, setDevice] = useState<'desktop' | 'phone'>('desktop');
  const [selected, setSelected] = useState<string | null>(null);
  const [panel, setPanel] = useState<Panel>('block');
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [sideOpen, setSideOpen] = useState(false);
  const [preview, setPreview] = useState<{ device: 'phone' | 'desktop'; percent: number | null } | null>(null);
  const [textStart, setTextStart] = useState<{ text: string; round: number } | null>(null);
  const [touring, setTouring] = useState(false);
  const [editorDirty, setEditorDirty] = useState(false);
  const [waitingSelect, setWaitingSelect] = useState<{ id: string | null } | null>(null);
  const [sendNote, setSendNote] = useState<string | null>(null);

  const items = build.items;
  const hints = useMemo(() => (studio.phase === 'ready' ? checkTest(studio.doc, items) : []), [studio.phase, studio.doc, items]);
  const numbers = useMemo(() => {
    const out = new Map<string, number>();
    for (const block of studio.doc.blocks) if (block.type === 'question' && studio.rows.has(block.item_id)) out.set(block.id, out.size + 1);
    return out;
  }, [studio.doc.blocks, studio.rows]);

  // The first visit's tour, once the page is there.
  useEffect(() => {
    if (studio.phase === 'ready' && user?.id && !tourSeen(user.id)) setTouring(true);
  }, [studio.phase, user?.id]);

  // Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y: the page's steps (the question editor and the text field keep their own).
  const { undo, redo } = studio;
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
      const key = event.key.toLowerCase();
      const isZ = event.code === 'KeyZ' || key === 'z' || key === 'я';
      const isY = event.code === 'KeyY' || key === 'y' || key === 'н';
      if (!isZ && !isY) return;
      const target = event.target instanceof Element ? event.target : null;
      if (target?.closest('.qe, .st-textview, .st-menu, .st-preview, .st-listview')) return;
      event.preventDefault();
      if (isY || event.shiftKey) redo();
      else undo();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [undo, redo]);

  /** A block chosen on the page: waits while the question editor holds changes not saved. */
  const select = (id: string | null) => {
    if (id === selected) return;
    const current = selected ? studio.doc.blocks.find((block) => block.id === selected) : null;
    if (editorDirty && current?.type === 'question' && panel === 'block') {
      setWaitingSelect({ id });
      return;
    }
    setSelected(id);
  };
  const goOn = () => {
    const waiting = waitingSelect;
    setWaitingSelect(null);
    setEditorDirty(false);
    if (waiting) setSelected(waiting.id);
  };

  const showBlock = (blockId: string) => {
    setView('canvas');
    select(blockId);
    window.setTimeout(() => {
      const node = document.querySelector<HTMLElement>(`[data-block="${blockId}"]`);
      node?.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
      node?.focus({ preventScroll: true });
    }, 0);
  };

  const send = async () => {
    setSendNote(null);
    const ok = await studio.flush();
    if (!ok && studio.save.kind !== 'idle') {
      setSendNote(STUDIO.failed);
      return;
    }
    navigate(`/exams/c/${containerId}/quizzes/new?all=1&design=1`);
  };

  // ───────────────────────────── screens before the studio ─────────────────────────────

  const simple = (children: React.ReactNode) => (
    <div className="sf-page st-page st-page-simple" ref={frame.ref} data-frame={frame.size}>
      <header className="ex-head">
        <p className="ex-crumb">
          <Link to="/exams">{TO_EXAMS}</Link>
        </p>
        <h1 className="ex-h1">{summary ? summary.title : STUDIO.docTitle}</h1>
      </header>
      {children}
    </div>
  );

  if (data.loading && !data.data) {
    return simple(
      <p className="tb-wait" role="status">
        {STUDIO.loading}
      </p>,
    );
  }
  if (!data.data || !summary || studio.phase === 'gone') {
    // The kind is known when the summary was read (the test went away while its studio was open).
    const gone = goneWords(summary ? summary.kind ?? 'exam' : null);
    return simple(
      data.gone || studio.phase === 'gone' ? (
        <p className="ex-note">
          {gone.title}. {gone.text}{' '}
          <Link className="sf-link" to="/exams">
            {TO_EXAMS}
          </Link>
        </p>
      ) : (
        <p className="ex-note" role="alert">
          {data.error && /[а-яё]/i.test(data.error) ? data.error : KEYS.loadFailed}{' '}
          <button type="button" className="sf-link" onClick={data.reload}>
            {KEYS.retry}
          </button>
        </p>
      ),
    );
  }
  if (!owner) {
    return simple(
      <>
        <p className="tb-lede">{KEYS.authorOnly}</p>
        <p>
          <Link className="sf-link" to={`/exams/c/${containerId}`}>
            {KEYS.toExam}
          </Link>
        </p>
      </>,
    );
  }
  if (studio.phase === 'error') {
    return simple(
      <p className="ex-note" role="alert">
        {STUDIO.loadFailed} {studio.loadError}{' '}
        <button type="button" className="sf-link" onClick={studio.retryLoad}>
          {KEYS.retry}
        </button>
      </p>,
    );
  }
  if (studio.phase === 'loading') {
    return simple(
      <p className="tb-wait" role="status">
        {STUDIO.loading}
      </p>,
    );
  }

  // ───────────────────────────── the studio ─────────────────────────────

  const keyed = build.keyed;
  const empty = (
    <EmptyStart
      busy={studio.busy === 'template' || studio.busy === 'question'}
      onTemplate={(id) => void studio.applyTemplate(id)}
      onPaste={() => {
        setTextStart({ text: STUDIO.textExample, round: (textStart?.round ?? 0) + 1 });
        setView('text');
      }}
      onQuestion={(type) =>
        void studio.addQuestion(type, studio.doc.blocks.length).then((block) => {
          if (!block) return;
          setSelected(block.id);
          setPanel('block');
          if (narrow) setSideOpen(true);
        })
      }
    />
  );
  const fixes = hints.filter((hint) => hint.level === 'fix').length;
  const selectedNumber = selected ? numbers.get(selected) ?? 0 : 0;

  const side = (api: Parameters<React.ComponentProps<typeof Workspace>['side']>[0]) => (
    <Side
      studio={studio}
      api={api}
      panel={panel}
      onPanel={(next) => {
        setPanel(next);
      }}
      selected={selected}
      numbers={numbers}
      containerId={containerId}
      group={group}
      dark={dark}
      hints={hints}
      savedLine={savedLine}
      tabs={!(narrow && panel === 'check')}
      onShow={(blockId) => {
        showBlock(blockId);
        if (narrow) setSideOpen(false);
      }}
      onPreview={() => setPreview({ device: phone ? 'phone' : device, percent: null })}
      onPreviewBand={(percent) => setPreview({ device: phone ? 'phone' : device, percent })}
      onEditorDirty={setEditorDirty}
      unsaved={waitingSelect ? STUDIO.editorUnsaved(selectedNumber) : null}
      onDiscard={goOn}
      onSaved={() => {
        if (waitingSelect) goOn();
      }}
    />
  );

  const sendButton = (
    <button
      type="button"
      className="sf-primary st-send"
      disabled={keyed === 0}
      title={keyed === 0 ? STUDIO.sendWhy : undefined}
      aria-label={STUDIO.send}
      aria-describedby={keyed === 0 ? 'st-send-why' : undefined}
      onClick={() => void send()}
    >
      {/* A phone narrower than 400 px: «Отправить» (19.10: «Отправить по ссылке» did not fit at 375 and 360). */}
      {narrow ? sendWords(frame.width) : STUDIO.send}
    </button>
  );

  return (
    <div className="sf-page tb-page st-page" ref={frame.ref} data-frame={frame.size} data-view={view}>
      <header className="st-bar">
        <div className="st-bar-start">
          {phone ? null : (
            <Link className="st-back" to={`/exams/c/${containerId}`} aria-label={summary.title} title={summary.title}>
              <UiIcon name="back" />
            </Link>
          )}
          <div className="st-name">
            <h1 className="st-title">{summary.title}</h1>
            <SaveLine save={studio.save} onRetry={studio.retrySave} onReload={studio.reloadDoc} />
          </div>
        </div>

        <div className="st-seg st-views" role="group" aria-label={STUDIO.viewsLabel}>
          {VIEWS.map((name) => (
            <button key={name} type="button" className="st-seg-btn" aria-pressed={view === name} onClick={() => setView(name)}>
              <UiIcon name={name} />
              <span>{STUDIO.views[name]}</span>
            </button>
          ))}
        </div>

        <div className="st-bar-tools">
          {view === 'canvas' && !narrow ? (
            <div className="st-seg st-seg-icons" role="group" aria-label={STUDIO.deviceLabel}>
              {(['phone', 'desktop'] as const).map((name) => (
                <button key={name} type="button" className="st-seg-btn" aria-pressed={device === name} aria-label={STUDIO.device[name]} title={STUDIO.device[name]} onClick={() => setDevice(name)}>
                  <UiIcon name={name} />
                </button>
              ))}
            </div>
          ) : null}
          <button type="button" className="st-icon-btn" aria-label={STUDIO.undo} title={`${STUDIO.undo} · ${STUDIO.undoKeys}`} disabled={!studio.canUndo} onClick={studio.undo}>
            <UiIcon name="undo" />
          </button>
          <button type="button" className="st-icon-btn" aria-label={STUDIO.redo} title={`${STUDIO.redo} · ${STUDIO.redoKeys}`} disabled={!studio.canRedo} onClick={studio.redo}>
            <UiIcon name="redo" />
          </button>
          <button
            type="button"
            className="st-tool"
            aria-pressed={view === 'canvas' && panel === 'check' && (!narrow || sideOpen)}
            aria-label={narrow ? STUDIO.check : undefined}
            onClick={() => {
              setView('canvas');
              setPanel('check');
              if (narrow) setSideOpen(true);
            }}
          >
            <span className="st-tool-word st-check-long">{STUDIO.check}</span>
            <span className="st-tool-word st-check-short" aria-hidden="true">
              {STUDIO.checkShort}
            </span>
            {hints.length > 0 ? (
              <span className="st-badge" data-fix={fixes > 0 ? '' : undefined}>
                {hints.length}
              </span>
            ) : null}
          </button>
          {/* Narrow screens show its eye alone (studio.css): the name is always there. */}
          <button type="button" className="st-tool" data-tour="preview" onClick={() => setPreview({ device: phone ? 'phone' : device, percent: null })} aria-label={STUDIO.preview} title={STUDIO.preview}>
            <UiIcon name="eye" />
            <span className="st-tool-word st-preview-long">{STUDIO.preview}</span>
            <span className="st-tool-word st-preview-short" aria-hidden="true">
              {STUDIO.previewShort}
            </span>
          </button>
          {narrow ? null : sendButton}
        </div>
      </header>

      {studio.save.kind === 'stale' ? (
        <p className="st-line" data-bad="" role="alert">
          <strong>{STUDIO.stale}.</strong> {STUDIO.staleMore}{' '}
          <button type="button" className="sf-link" onClick={studio.reloadDoc}>
            {STUDIO.reload}
          </button>
        </p>
      ) : null}
      {studio.overflow > 0 ? <p className="st-line">{STUDIO.cap}</p> : null}
      {keyed === 0 ? (
        <p id="st-send-why" className="sr-only">
          {STUDIO.sendWhy}
        </p>
      ) : null}
      {sendNote ? (
        <p className="st-line" data-bad="" role="alert">
          {sendNote}
        </p>
      ) : null}

      <main ref={mainRef} className="st-main" data-view={view}>
        {view === 'canvas' ? (
          <Workspace
            studio={studio}
            containerId={containerId}
            dark={dark}
            device={device}
            phone={narrow}
            selected={selected}
            onSelect={select}
            panel={panel}
            onPanel={setPanel}
            side={side}
            empty={empty}
            paletteOpen={paletteOpen}
            onPaletteOpen={setPaletteOpen}
            sideOpen={sideOpen}
            onSideOpen={setSideOpen}
          />
        ) : view === 'list' ? (
          <div className="st-scrollpage">
            <ListView studio={studio} build={build} containerId={containerId} group={group} savedLine={savedLine} />
          </div>
        ) : (
          <TextView key={textStart?.round ?? 0} studio={studio} items={items} start={textStart?.text ?? null} />
        )}
      </main>

      {narrow ? (
        <div className="st-phonebar" hidden={!bottomBarShown(frame.size, typing)}>
          {view === 'canvas' ? (
            <>
              <button type="button" className="st-tool" data-tour="palette-phone" onClick={() => setPaletteOpen(true)}>
                <UiIcon name="plus" />
                <span className="st-tool-word">{STUDIO.palette}</span>
              </button>
              <button
                type="button"
                className="st-tool st-tool-icon"
                aria-label={STUDIO.panelsLabel}
                title={STUDIO.panelsLabel}
                onClick={() => {
                  // «Проверка теста» has its own button: «Настройки» opens the settings themselves.
                  if (panel === 'check') setPanel('block');
                  setSideOpen(true);
                }}
              >
                <UiIcon name="sliders" />
              </button>
            </>
          ) : null}
          {keyed > 0 || !phone ? sendButton : null}
        </div>
      ) : null}

      <p className="sr-only" role="status" aria-live="polite">
        {studio.notice}
      </p>

      {preview ? <Preview doc={studio.doc} items={studio.rows} dark={dark} device={preview.device} percent={preview.percent} onClose={() => setPreview(null)} /> : null}
      {touring && user?.id && view === 'canvas' ? <Tour userId={user.id} phone={narrow} onDone={() => setTouring(false)} /> : null}
    </div>
  );
}
