import { forwardRef, useImperativeHandle, useLayoutEffect, useRef, type TextareaHTMLAttributes } from 'react';

/**
 * A read-only text to copy, as tall as the text itself: the message for the group's chat is read whole, without a
 * scrollbar of its own (owner, 2026-10-07: «почему нельзя пошире сделать это окно чтобы не приходилось прокручивать
 * экран?»). Measured after each change of the text, of the field's width (the window grew or the dialog went to two
 * columns) and once the fonts are in. `rows` stays the height before the first measure and without layout (tests).
 */
type Props = Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'value'> & { value: string };

const FitTextarea = forwardRef<HTMLTextAreaElement, Props>(function FitTextarea({ value, ...rest }, outer) {
  const inner = useRef<HTMLTextAreaElement>(null);
  useImperativeHandle(outer, () => inner.current as HTMLTextAreaElement, []);

  useLayoutEffect(() => {
    const field = inner.current;
    if (!field) return undefined;
    const fit = () => {
      // From nothing: a textarea's scrollHeight is never below its own box, so 'auto' (= rows) would keep it tall.
      field.style.height = '0px';
      const height = field.scrollHeight;
      if (height <= 0) {
        // Not laid out (hidden, or no layout at all): the rows decide.
        field.style.removeProperty('height');
        return;
      }
      const style = window.getComputedStyle(field);
      const borders = (parseFloat(style.borderTopWidth) || 0) + (parseFloat(style.borderBottomWidth) || 0);
      field.style.height = `${height + borders}px`;
    };
    fit();
    let alive = true;
    void document.fonts?.ready.then(() => {
      if (alive) fit();
    });
    let width = field.clientWidth;
    const observer =
      typeof ResizeObserver === 'function'
        ? new ResizeObserver(() => {
            // Only a new width changes the lines; the height set here is not a reason to measure again.
            if (field.clientWidth === width) return;
            width = field.clientWidth;
            fit();
          })
        : null;
    observer?.observe(field);
    return () => {
      alive = false;
      observer?.disconnect();
    };
  }, [value]);

  return <textarea ref={inner} value={value} {...rest} />;
});

export default FitTextarea;
