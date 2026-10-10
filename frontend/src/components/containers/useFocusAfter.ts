import { useCallback, useEffect, useState } from 'react';

type Find = () => HTMLElement | null | undefined;

/**
 * Moves the focus once the next render is on screen (usability check m9: every inline confirm left the focus on the page
 * itself). `focusAfter(() => element)` with the change that draws the element: «Отмена» when a confirm opens, the button
 * that opened it when it closes, the row a member moved to. An element that is not there leaves the focus as it is.
 */
export function useFocusAfter(): (find: Find) => void {
  const [request, setRequest] = useState<{ find: Find } | null>(null);
  useEffect(() => {
    request?.find()?.focus();
  }, [request]);
  return useCallback((find: Find) => setRequest({ find }), []);
}
