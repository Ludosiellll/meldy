import { Fragment, memo } from 'react';
import { linkAddress, parseRich } from '../../lib/studio/richText';

/**
 * Rich text of a studio page (types/testDoc.ts RichText) as React text nodes: bold, italic and https links, each link
 * followed by its address in brackets so the participant sees where it leads. Never HTML: every run is put in as
 * text, whatever the author typed. Line breaks stay (the parent sets white-space: pre-line).
 */
function Rich({ text }: { text: string }) {
  const runs = parseRich(text);
  return (
    <>
      {runs.map((run, at) => {
        let node = <>{run.text}</>;
        if (run.italic) node = <em>{node}</em>;
        if (run.bold) node = <strong>{node}</strong>;
        if (run.href) {
          return (
            <Fragment key={at}>
              <a className="dv-link" href={run.href} target="_blank" rel="noopener noreferrer nofollow ugc">
                {node}
              </a>
              <span className="dv-addr"> ({linkAddress(run.href)})</span>
            </Fragment>
          );
        }
        return <Fragment key={at}>{node}</Fragment>;
      })}
    </>
  );
}

/** The same words, the same runs: no work (memo). */
export default memo(Rich);
