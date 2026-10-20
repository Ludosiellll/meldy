/**
 * The fake server lives in the page, so it never loses the network. This wrapper makes it obey the browser's offline
 * switch (navigator.onLine), so the lost-network screens are tried against the fake exactly as against the real
 * server: every call refuses with the network error while offline.
 */
import { LiveError, type LiveApi } from '../../../lib/live/types';

const offline = () => typeof navigator !== 'undefined' && navigator.onLine === false;

export function obeyOffline(api: LiveApi): LiveApi {
  if (api.kind !== 'fake') return api;
  const guard =
    <A extends unknown[], R>(fn: (...args: A) => Promise<R>) =>
    (...args: A): Promise<R> =>
      offline() ? Promise.reject(new LiveError('network', null, 0)) : fn(...args);
  return {
    kind: api.kind,
    create: guard(api.create.bind(api)),
    hostState: guard(api.hostState.bind(api)),
    next: guard(api.next.bind(api)),
    kick: guard(api.kick.bind(api)),
    end: guard(api.end.bind(api)),
    tgPost: guard(api.tgPost.bind(api)),
    join: guard(api.join.bind(api)),
    setLook: guard(api.setLook.bind(api)),
    answer: guard(api.answer.bind(api)),
    state: guard(api.state.bind(api)),
    review: guard(api.review.bind(api)),
    subscribe: api.subscribe.bind(api),
  };
}
