import type { Hint } from '../../lib/studio/checker';
import BlockPanel from './BlockPanel';
import CheckPanel from './CheckPanel';
import { STUDIO, type Panel } from './copyStudio';
import DesignPanel from './DesignPanel';
import ResultPanel from './ResultPanel';
import type { Studio } from './useStudio';
import type { SideApi } from './Workspace';

/**
 * The settings beside the page: «Блок» (the selected block, or the page), «Оформление», «Результат» and «Проверка»
 * with the number of things to look at. One at a time; the top bar's «Проверка теста» opens the last one.
 */

export interface SideProps {
  studio: Studio;
  api: SideApi;
  panel: Panel;
  onPanel: (panel: Panel) => void;
  selected: string | null;
  numbers: ReadonlyMap<string, number>;
  containerId: string;
  group: boolean;
  dark: boolean;
  hints: readonly Hint[];
  onShow: (blockId: string) => void;
  onPreview: () => void;
  onPreviewBand: (percent: number) => void;
  onEditorDirty: (dirty: boolean) => void;
  unsaved: string | null;
  onDiscard: () => void;
  onSaved: () => void;
  /** In a sheet the tabs stay; the sheet's own title says where. */
  tabs?: boolean;
}

/** «Проверка» has its own button in the top bar (with the number of things to look at). */
const PANELS: Panel[] = ['block', 'design', 'result'];

export default function Side(props: SideProps) {
  const { studio, api, panel, onPanel, hints, tabs = true } = props;
  return (
    <div className="st-side-in">
      {tabs ? (
        <div className="st-tabs" role="tablist" aria-label={STUDIO.panelsLabel}>
          {PANELS.map((name) => (
            <button
              key={name}
              type="button"
              role="tab"
              id={`st-tab-${name}`}
              aria-selected={panel === name}
              aria-controls="st-tabpanel"
              className="st-tab"
              onClick={() => onPanel(name)}
            >
              {STUDIO.panels[name]}
            </button>
          ))}
        </div>
      ) : null}
      <div
        className="st-panel"
        id="st-tabpanel"
        role={panel === 'check' ? 'region' : 'tabpanel'}
        aria-labelledby={panel === 'check' ? undefined : `st-tab-${panel}`}
        aria-label={panel === 'check' ? STUDIO.check : undefined}
      >
        {panel === 'block' ? (
          <BlockPanel
            studio={studio}
            selected={props.selected}
            containerId={props.containerId}
            group={props.group}
            api={api}
            numbers={props.numbers}
            onDirty={props.onEditorDirty}
            unsaved={props.unsaved}
            onDiscard={props.onDiscard}
            onSaved={props.onSaved}
          />
        ) : panel === 'design' ? (
          <DesignPanel studio={studio} dark={props.dark} api={api} onPreview={props.onPreview} />
        ) : panel === 'result' ? (
          <ResultPanel studio={studio} api={api} onPreviewBand={props.onPreviewBand} />
        ) : (
          <CheckPanel studio={studio} hints={hints} onShow={props.onShow} />
        )}
      </div>
    </div>
  );
}
