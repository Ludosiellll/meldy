import { useEffect, useId, useRef, useState } from 'react';
import { urlOk } from '../../lib/studio/doc';
import { typingKey } from '../../lib/studio/history';
import { linkAddress } from '../../lib/studio/richText';
import { DOC_MAX_BANDS, DOC_TEXT_MAX, DOC_TITLE_MAX, DOC_URL_MAX, type ResultBand, type TestDoc } from '../../types/testDoc';
import { STUDIO } from './copyStudio';
import PictureField from './PictureField';
import type { Studio } from './useStudio';
import type { SideApi } from './Workspace';

/**
 * «Результат» (spec §47.6 «Экран результата тоже собирается»): up to six messages by the percent of points — from–to,
 * a title, a text with the three marks, a picture — checked as they are typed (two ranges may not share a percent; a
 * range nobody covers is said too), and «Ссылка дальше»: words and an https address, shown as the participant will
 * see it.
 */

export interface BandIssue {
  /** Which band (index) the line stands under. */
  at: number;
  message: string;
  bad: boolean;
}

/** What is wrong with the bands as typed: a start after its end, two ranges sharing percents, a title missing; gaps as a thought. */
export function bandIssues(bands: readonly ResultBand[]): BandIssue[] {
  const out: BandIssue[] = [];
  bands.forEach((band, at) => {
    if (band.from > band.to) out.push({ at, bad: true, message: STUDIO.bandOrder(STUDIO.band(band.from, band.to)) });
    if (!band.title.trim()) out.push({ at, bad: true, message: STUDIO.bandNoTitle });
    for (let other = 0; other < at; other += 1) {
      const a = bands[other];
      if (a.from <= band.to && band.from <= a.to) out.push({ at, bad: true, message: STUDIO.bandOverlap(STUDIO.band(a.from, a.to), STUDIO.band(band.from, band.to)) });
    }
  });
  if (bands.length > 0 && !out.some((issue) => issue.bad)) {
    const sorted = [...bands].sort((a, b) => a.from - b.from);
    let next = 0;
    for (const band of sorted) {
      if (band.from > next) out.push({ at: bands.indexOf(band), bad: false, message: STUDIO.bandGap(next, band.from - 1) });
      next = Math.max(next, band.to + 1);
    }
    if (next <= 100) out.push({ at: bands.indexOf(sorted[sorted.length - 1]), bad: false, message: STUDIO.bandGap(next, 100) });
  }
  return out;
}

/** The range a new band takes: the first free one, else the last tenth. */
export function freeRange(bands: readonly ResultBand[]): { from: number; to: number } {
  const sorted = [...bands].sort((a, b) => a.from - b.from);
  let next = 0;
  for (const band of sorted) {
    if (band.from > next) return { from: next, to: band.from - 1 };
    next = Math.max(next, band.to + 1);
  }
  return next <= 100 ? { from: next, to: 100 } : { from: 90, to: 100 };
}

function Percent({ label, value, onChange }: { label: string; value: number; onChange: (value: number) => void }) {
  const [text, setText] = useState(String(value));
  useEffect(() => setText(String(value)), [value]);
  return (
    <label className="st-pct">
      <span className="st-field-sub">{label}</span>
      <input
        className="st-input st-input-num"
        inputMode="numeric"
        value={text}
        onChange={(event) => {
          const next = event.target.value.replace(/[^\d]/g, '').slice(0, 3);
          setText(next);
          if (next !== '' && Number(next) <= 100) onChange(Number(next));
        }}
        onBlur={() => setText(String(value))}
      />
    </label>
  );
}

function CtaField({ doc, studio }: { doc: TestDoc; studio: Studio }) {
  const id = useId();
  const cta = doc.results.cta;
  const [label, setLabel] = useState(cta?.label ?? '');
  const [url, setUrl] = useState(cta?.url ?? '');
  // The link this field wrote last: the page coming back with it is not a reason to replace what is being typed.
  const wrote = useRef(JSON.stringify(cta));
  useEffect(() => {
    const seen = JSON.stringify(cta);
    if (seen === wrote.current) return;
    wrote.current = seen;
    setLabel(cta?.label ?? '');
    setUrl(cta?.url ?? '');
  }, [cta]);
  const put = (nextLabel: string, nextUrl: string) => {
    const words = nextLabel.replace(/\s*\n\s*/g, ' ');
    const address = nextUrl.trim();
    const value = words.trim() && urlOk(address) && !/\s/.test(address) ? { label: words, url: address } : null;
    wrote.current = JSON.stringify(value);
    studio.change((current) => ({ ...current, results: { ...current.results, cta: value } }), typingKey('results', 'cta'));
  };
  const addressBad = url.trim() !== '' && (!urlOk(url.trim()) || /\s/.test(url.trim()));
  return (
    <div className="st-group">
      <h3 className="st-panel-h">{STUDIO.cta}</h3>
      <p className="st-field-hint">{STUDIO.ctaLead}</p>
      <label className="st-field-label" htmlFor={`${id}-label`}>
        {STUDIO.ctaLabel}
      </label>
      <input
        id={`${id}-label`}
        className="st-input"
        value={label}
        maxLength={DOC_TITLE_MAX}
        placeholder={STUDIO.ctaLabelExample}
        onChange={(event) => {
          setLabel(event.target.value);
          put(event.target.value, url);
        }}
      />
      <label className="st-field-label" htmlFor={`${id}-url`}>
        {STUDIO.ctaUrl}
      </label>
      <input
        id={`${id}-url`}
        className="st-input"
        type="url"
        inputMode="url"
        value={url}
        maxLength={DOC_URL_MAX + 20}
        placeholder="https://"
        aria-invalid={addressBad || undefined}
        aria-describedby={`${id}-shown`}
        onChange={(event) => {
          setUrl(event.target.value);
          put(label, event.target.value);
        }}
      />
      <p id={`${id}-shown`} className="st-note" data-bad={addressBad ? '' : undefined}>
        {addressBad ? STUDIO.ctaBad : cta ? STUDIO.ctaShown(linkAddress(cta.url)) : null}
      </p>
      {cta ? (
        <button
          type="button"
          className="sf-link"
          data-muted=""
          onClick={() => {
            setLabel('');
            setUrl('');
            wrote.current = JSON.stringify(null);
            studio.change((current) => ({ ...current, results: { ...current.results, cta: null } }));
          }}
        >
          {STUDIO.ctaRemove}
        </button>
      ) : null}
    </div>
  );
}

export default function ResultPanel({ studio, api, onPreviewBand }: { studio: Studio; api: SideApi; onPreviewBand: (percent: number) => void }) {
  const { doc } = studio;
  const bands = doc.results.bands;
  const issues = bandIssues(bands);
  const setBands = (next: ResultBand[], key: string | null = null) => studio.change((current) => ({ ...current, results: { ...current.results, bands: next } }), key);
  const setBand = (at: number, patch: Partial<ResultBand>, field: string) => setBands(bands.map((band, index) => (index === at ? { ...band, ...patch } : band)), typingKey(`band${at}`, field));

  return (
    <div className="st-panel-body st-result">
      <h3 className="st-panel-h">{STUDIO.result}</h3>
      <p className="st-lead">{STUDIO.resultLead}</p>
      <ol className="st-bands">
        {bands.map((band, at) => (
          <li key={at} className="st-band">
            <div className="st-band-head">
              <Percent label={STUDIO.bandFrom} value={band.from} onChange={(from) => setBand(at, { from }, 'from')} />
              <span className="st-band-dash" aria-hidden="true">
                –
              </span>
              <Percent label={STUDIO.bandTo} value={band.to} onChange={(to) => setBand(at, { to }, 'to')} />
              <span className="st-band-acts">
                <button type="button" className="sf-link" onClick={() => onPreviewBand(Math.round((band.from + band.to) / 2))}>
                  {STUDIO.bandPreview}
                </button>
                <button type="button" className="sf-link" data-muted="" onClick={() => setBands(bands.filter((_, index) => index !== at))}>
                  {STUDIO.bandRemove}
                </button>
              </span>
            </div>
            <label className="st-label-block">
              <span className="st-field-sub">{STUDIO.bandTitle}</span>
              <input className="st-input" value={band.title} maxLength={DOC_TITLE_MAX} onChange={(event) => setBand(at, { title: event.target.value.replace(/\s*\n\s*/g, ' ') }, 'title')} />
            </label>
            <label className="st-label-block">
              <span className="st-field-sub">{STUDIO.bandText}</span>
              <textarea className="st-input st-textarea" rows={2} value={band.text} maxLength={DOC_TEXT_MAX} onChange={(event) => setBand(at, { text: event.target.value }, 'text')} />
            </label>
            <PictureField label={STUDIO.picture} path={band.image} target={{ kind: 'band', index: at }} api={api} onRemove={() => setBand(at, { image: null }, 'image')} />
            {issues
              .filter((issue) => issue.at === at)
              .map((issue, index) => (
                <p key={index} className="st-note" data-bad={issue.bad ? '' : undefined} role={issue.bad ? 'alert' : undefined}>
                  {issue.message}
                </p>
              ))}
          </li>
        ))}
      </ol>
      {bands.length < DOC_MAX_BANDS ? (
        <button
          type="button"
          className="st-pill"
          onClick={() => {
            const range = freeRange(bands);
            const words = STUDIO.bandDefaults[Math.min(STUDIO.bandDefaults.length - 1, Math.floor(range.from / 34))];
            setBands([...bands, { ...range, title: words, text: '', image: null }].sort((a, b) => a.from - b.from));
          }}
        >
          {STUDIO.bandAdd}
        </button>
      ) : (
        <p className="st-field-hint">{STUDIO.bandsMax}</p>
      )}
      <CtaField doc={doc} studio={studio} />
    </div>
  );
}
