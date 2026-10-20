import { memo } from 'react';
import Markdown from 'react-markdown';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';

/**
 * Markdown with formulas (remark-math + KaTeX), kept per text: a piece of text is parsed and its formulas typeset
 * once, and drawn again from what was made (smoothness audit 20.10: opening a lecture rendered each section's
 * Markdown four times, and coming back to «Конспект» parsed every section and its formulas anew). The element tree
 * react-markdown makes is plain data, so the same tree serves every later mount; the plugin lists are made once.
 */
const REMARK = [remarkMath];
const REHYPE = [rehypeKatex];
const LIMIT = 400;
const made = new Map<string, ReturnType<typeof Markdown>>();

export function mathMarkdown(text: string): ReturnType<typeof Markdown> {
  const kept = made.get(text);
  if (kept) {
    // The most recent last: the oldest goes first when the store is full.
    made.delete(text);
    made.set(text, kept);
    return kept;
  }
  const tree = Markdown({ children: text, remarkPlugins: REMARK, rehypePlugins: REHYPE });
  made.set(text, tree);
  if (made.size > LIMIT) made.delete(made.keys().next().value as string);
  return tree;
}

/** One piece of Markdown with formulas; drawn again only when its text changes. */
export const MathMarkdown = memo(function MathMarkdown({ text }: { text: string }) {
  return mathMarkdown(text);
});
