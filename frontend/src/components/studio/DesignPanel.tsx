import { useEffect, useId, useMemo, useState, type CSSProperties } from 'react';
import { ACCENTS, FONT_STACKS, readableAccent } from '../../lib/studio/contrast';
import { emptyDoc } from '../../lib/studio/doc';
import { typingKey } from '../../lib/studio/history';
import { READY_THEMES } from '../../lib/studio/templates';
import { QUIZ_ACCENTS, type QuizAccent } from '../../types/quiz';
import type { DocTheme, TestDoc } from '../../types/testDoc';
import Choice from './Choice';
import { STUDIO } from './copyStudio';
import DocView from './DocView';
import { gradeDoc, type DocItem } from './docRun';
import { LAYOUT_OPTIONS } from './BlockPanel';
import PictureField from './PictureField';
import type { Studio } from './useStudio';
import type { SideApi } from './Workspace';

/**
 * «Оформление» (spec §47.6 «Тема»): a sample of the page in its theme at the top (answerable), the four ready themes,
 * the colour (Meldy's six or the author's own — nudged until white text reads on it: «Цвет чуть поправлен для
 * читаемости»), the background (plain, soft, a picture with its darkening — «Картинка» opens the author's own upload
 * first and the six ready pictures after it; the page keeps its background until a picture is there), the font, the
 * corners, the density, the answers as a list or tiles, the buttons, and how the page is gone through.
 */

const SAMPLE_ITEM: DocItem = { id: 'sample', kind: 'single', stem: STUDIO.sampleStem, options: [...STUDIO.sampleOptions], code: false, correct: [0] };
const SAMPLE_ITEMS = new Map([[SAMPLE_ITEM.id, SAMPLE_ITEM]]);

function sampleDoc(doc: TestDoc): TestDoc {
  const cover = doc.blocks.find((block) => block.type === 'cover');
  return {
    ...emptyDoc(doc.title),
    theme: doc.theme,
    layout: 'one_page',
    blocks: [
      ...(cover ? [{ ...cover, image: null }] : []),
      { type: 'question', id: 'samplequestion', item_id: SAMPLE_ITEM.id, points: 1, required: false },
    ],
    results: doc.results,
  };
}

function Swatch({ color }: { color: string }) {
  return <span className="st-swatch-dot" style={{ background: color }} aria-hidden="true" />;
}

export default function DesignPanel({ studio, dark, api, onPreview }: { studio: Studio; dark: boolean; api: SideApi; onPreview: () => void }) {
  const colorId = useId();
  const dimId = useId();
  const { doc } = studio;
  const theme = doc.theme;
  const set = (patch: Partial<DocTheme>, key: string | null = null) => studio.change((current) => ({ ...current, theme: { ...current.theme, ...patch } }), key);
  const custom = typeof theme.accent === 'string' ? null : theme.accent.custom;
  const fill = typeof theme.accent === 'string' ? ACCENTS[theme.accent].light.fill : theme.accent.custom;
  const sample = useMemo(() => sampleDoc(doc), [doc]);
  // The colour as the author picked it (the field shows it), and whether the page's colour had to move from it.
  const [picked, setPicked] = useState<string | null>(null);
  const nudged = custom !== null && picked !== null && picked !== custom;

  const pickColor = (hex: string) => {
    const made = readableAccent(hex, '#ffffff');
    setPicked(hex.toLowerCase());
    set({ accent: { custom: made.color } }, typingKey('theme', 'accent'));
  };

  const accentTone: QuizAccent = typeof theme.accent === 'string' ? theme.accent : 'blue';
  // «Картинка» chosen before there is a picture: the field shows, the page waits for the author's file or a ready one.
  // Any change of the background itself (a picture uploaded, a ready theme, Ctrl+Z) says what is chosen again.
  const [wantPicture, setWantPicture] = useState(false);
  useEffect(() => setWantPicture(false), [theme.background]);
  const backgroundKind = theme.background.kind === 'image' || wantPicture ? 'image' : theme.background.kind;

  return (
    <div className="st-panel-body st-design">
      <div className="st-sample">
        <p className="st-field-label">{STUDIO.sample}</p>
        <div className="st-sample-frame" data-tour="design-sample">
          <DocView mode="answer" doc={sample} items={SAMPLE_ITEMS} dark={dark} onSubmit={(answers) => gradeDoc(sample, SAMPLE_ITEMS, answers)} onRestart={() => undefined} className="st-sample-doc" />
        </div>
        <button type="button" className="sf-link st-sample-link" onClick={onPreview}>
          {STUDIO.preview}
        </button>
      </div>

      <div className="st-group">
        <p className="st-field-label">{STUDIO.readyThemes}</p>
        <ul className="st-themes">
          {READY_THEMES.map((ready) => {
            const on = JSON.stringify(ready.theme) === JSON.stringify({ ...theme, background: theme.background.kind === 'image' ? theme.background : theme.background });
            const tone = typeof ready.theme.accent === 'string' ? ACCENTS[ready.theme.accent].light.fill : '#2869dd';
            return (
              <li key={ready.id}>
                <button type="button" className="st-theme" aria-pressed={on} onClick={() => set({ ...ready.theme, background: { ...ready.theme.background } })}>
                  <span className="st-theme-pic" data-bg={ready.theme.background.kind} style={{ '--st-tone': tone, fontFamily: FONT_STACKS[ready.theme.font] } as CSSProperties}>
                    <span className="st-theme-card" data-radius={ready.theme.radius}>
                      Аа
                    </span>
                    <span className="st-theme-btn" data-buttons={ready.theme.buttons} />
                  </span>
                  <span className="st-theme-name">{ready.title}</span>
                </button>
              </li>
            );
          })}
        </ul>
      </div>

      <div className="st-group">
        <p className="st-field-label" id={`${colorId}-label`}>
          {STUDIO.accent}
        </p>
        <div className="st-swatches" role="group" aria-labelledby={`${colorId}-label`}>
          {QUIZ_ACCENTS.map((accent) => (
            <button
              key={accent}
              type="button"
              className="st-swatch"
              aria-pressed={theme.accent === accent}
              aria-label={STUDIO.accents[accent]}
              title={STUDIO.accents[accent]}
              onClick={() => {
                setPicked(null);
                set({ accent, background: theme.background.kind === 'soft' ? { kind: 'soft', tone: accent } : theme.background });
              }}
            >
              <Swatch color={ACCENTS[accent].light.fill} />
            </button>
          ))}
          <label className="st-swatch st-swatch-custom" data-on={custom ? '' : undefined} title={STUDIO.customColor}>
            <input id={colorId} type="color" value={custom && picked ? picked : fill} aria-label={STUDIO.customColor} onChange={(event) => pickColor(event.target.value)} />
            <span className="st-swatch-word">{STUDIO.customColor}</span>
          </label>
        </div>
        {nudged ? (
          <p className="st-note st-nudged" role="status">
            <span className="st-nudge-pair" aria-hidden="true">
              <span style={{ background: picked ?? undefined }} />
              <span style={{ background: custom ?? undefined }} />
            </span>
            {STUDIO.nudged}
          </p>
        ) : null}
      </div>

      <div className="st-group">
        <Choice
          label={STUDIO.background}
          options={[
            { value: 'plain', label: STUDIO.backgrounds.plain },
            { value: 'soft', label: STUDIO.backgrounds.soft },
            { value: 'image', label: STUDIO.backgrounds.image },
          ]}
          value={backgroundKind}
          onChange={(kind) => {
            setWantPicture(kind === 'image');
            if (kind === 'plain') set({ background: { kind: 'plain' } });
            else if (kind === 'soft') set({ background: { kind: 'soft', tone: accentTone } });
          }}
        />
        {backgroundKind === 'image' ? (
          <PictureField
            label={STUDIO.picture}
            path={theme.background.kind === 'image' ? theme.background.path : null}
            target={{ kind: 'background' }}
            api={api}
            presets="background"
            onRemove={() => {
              setWantPicture(false);
              set({ background: { kind: 'plain' } });
            }}
          />
        ) : null}
        {theme.background.kind === 'image' ? (
          <>
            <label className="st-range" htmlFor={dimId}>
              <span className="st-field-label">{STUDIO.dim}</span>
              <span className="st-range-row">
                <input
                  id={dimId}
                  type="range"
                  min={0}
                  max={80}
                  step={5}
                  value={theme.background.dim}
                  onChange={(event) => {
                    const background = theme.background;
                    if (background.kind === 'image') set({ background: { ...background, dim: Number(event.target.value) } }, typingKey('theme', 'dim'));
                  }}
                />
                <output htmlFor={dimId}>{STUDIO.dimValue(theme.background.dim)}</output>
              </span>
            </label>
          </>
        ) : null}
      </div>

      <Choice
        label={STUDIO.font}
        options={(['onest', 'serif', 'mono'] as const).map((value) => ({ value, label: STUDIO.fonts[value], style: { fontFamily: FONT_STACKS[value] } }))}
        value={theme.font}
        onChange={(font) => set({ font })}
      />
      <Choice
        label={STUDIO.radius}
        options={(['soft', 'round', 'square'] as const).map((value) => ({ value, label: STUDIO.radii[value], icon: <span className="st-shape" data-radius={value} /> }))}
        value={theme.radius}
        onChange={(radius) => set({ radius })}
      />
      <Choice label={STUDIO.density} options={(['airy', 'compact'] as const).map((value) => ({ value, label: STUDIO.densities[value] }))} value={theme.density} onChange={(density) => set({ density })} />
      <Choice
        label={STUDIO.answers}
        options={[
          { value: 'list', label: STUDIO.answerViews.list, icon: <span className="st-answers-ico" data-view="list" /> },
          { value: 'grid', label: STUDIO.answerViews.grid, icon: <span className="st-answers-ico" data-view="grid" /> },
        ]}
        value={theme.answers}
        onChange={(answers) => set({ answers })}
      />
      <Choice
        label={STUDIO.buttons}
        options={(['pill', 'rounded', 'square'] as const).map((value) => ({ value, label: STUDIO.buttonShapes[value], icon: <span className="st-btn-shape" data-buttons={value} /> }))}
        value={theme.buttons}
        onChange={(buttons) => set({ buttons })}
      />
      <Choice label={STUDIO.layout} options={LAYOUT_OPTIONS} value={doc.layout} wide onChange={(layout) => studio.change((current) => ({ ...current, layout }))} />
    </div>
  );
}
