import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import HeroTop from './HeroTop';
import { TILES } from './copy3';

/** The step shown in the blue tile's markup: the list item and the dot that carry data-on. */
function shown(markup: string): { step: number; dot: number; items: number } {
  // the steps' own list: the doors have lists of their own (what each one gets)
  const steps = markup.match(/<ol class="h3-oral-steps">([\s\S]*?)<\/ol>/)?.[1] ?? '';
  const items = [...steps.matchAll(/<li( data-on="")?>/g)].map((match) => Boolean(match[1]));
  const dots = [...(markup.match(/<p class="h3-oral-dots" aria-hidden="true">([\s\S]*?)<\/p>/)?.[1] ?? '').matchAll(/<i( data-on="")?><\/i>/g)].map((match) => Boolean(match[1]));
  return { step: items.indexOf(true), dot: dots.indexOf(true), items: items.length };
}

describe('the first screen’s blue tile: the steps of an answer aloud (owner 19.11)', () => {
  it('names all four steps in the page and shows the first until the phone plays', () => {
    const markup = renderToStaticMarkup(<HeroTop />);
    expect(shown(markup)).toEqual({ step: 0, dot: 0, items: TILES.oralSteps.length });
    expect(TILES.oralSteps).toHaveLength(4);
    for (const text of TILES.oralSteps) expect(markup.replace(/ /g, ' ')).toContain(`>${text}</li>`);
  });

  it('shows the step the phone plays, one at a time', () => {
    for (let step = 0; step < TILES.oralSteps.length; step += 1) {
      const markup = renderToStaticMarkup(<HeroTop step={step} />);
      expect(shown(markup)).toMatchObject({ step, dot: step });
      expect(markup.match(/<li data-on="">/g)).toHaveLength(1);
    }
  });
});
