import type { ComponentType } from 'react';
import { lazyPart } from '../../lib/lazyPart';
import type { GuideChapterId } from './chapters';

export interface GuideClipProps {
  chapter: GuideChapterId;
  active: boolean;
}

/**
 * The guide's clips (their scenes and the reel engine that plays them) are a file of their own: the
 * signed-in shell opens without them, and the guide's card keeps the clip's frame until they arrive.
 * Fetched when the guide opens, as soon as a first run is likely (GuideContext), or once the first
 * screen is idle (lib/prefetch.ts).
 */
export const guideClipPart = lazyPart<ComponentType<GuideClipProps>>(() => import('./GuideClip').then((module) => module.default));
