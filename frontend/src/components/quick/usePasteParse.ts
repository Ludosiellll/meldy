import { useCallback, useEffect, useRef, useState } from 'react';
import { parsePaste } from '../../api/containers';
import type { BankParseResult } from '../../types/container';

/** A pause in typing this long sends the text; a paste goes at once. */
export const PARSE_PAUSE_MS = 450;

export interface PasteParse {
  /** The last answer; it stays on screen while the next text is read (no flicker). */
  result: BankParseResult | null;
  /** The text `result` is of. */
  parsedText: string;
  reading: boolean;
  failed: boolean;
  /** Reads the text now (a paste with its new text, «Повторить» with none: the current one). */
  now: (value?: string) => void;
}

/**
 * The live read of the quick test's text (POST /api/tests/paste): after a pause in typing, at once after a paste, one
 * request at a time (a newer text stops the older request). An empty text needs no request.
 */
export function usePasteParse(text: string): PasteParse {
  const [result, setResult] = useState<BankParseResult | null>(null);
  const [parsedText, setParsedText] = useState('');
  const [reading, setReading] = useState(false);
  const [failed, setFailed] = useState(false);
  const controller = useRef<AbortController | null>(null);
  const latest = useRef(text);
  latest.current = text;
  const asked = useRef<string | null>(null);

  const read = useCallback((value: string) => {
    if (value === asked.current) return;
    asked.current = value;
    controller.current?.abort();
    if (!value.trim()) {
      controller.current = null;
      setResult(null);
      setParsedText(value);
      setReading(false);
      setFailed(false);
      return;
    }
    const own = new AbortController();
    controller.current = own;
    setReading(true);
    setFailed(false);
    parsePaste(value, own.signal).then(
      (answer) => {
        if (controller.current !== own) return;
        controller.current = null;
        setResult(answer);
        setParsedText(value);
        setReading(false);
      },
      () => {
        if (controller.current !== own) return;
        controller.current = null;
        // The text can be asked again («Повторить», or the next change).
        asked.current = null;
        setReading(false);
        setFailed(true);
      },
    );
  }, []);

  useEffect(() => {
    if (text === asked.current) return undefined;
    const timer = window.setTimeout(() => read(text), text.trim() ? PARSE_PAUSE_MS : 0);
    return () => window.clearTimeout(timer);
  }, [text, read]);

  useEffect(() => () => controller.current?.abort(), []);

  const now = useCallback(
    (value?: string) => {
      asked.current = null;
      read(value ?? latest.current);
    },
    [read],
  );

  return { result, parsedText, reading, failed, now };
}
