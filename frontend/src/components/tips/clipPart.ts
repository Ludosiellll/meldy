import type { ComponentType } from 'react';
import { lazyPart } from '../../lib/lazyPart';
import type { CardTipId } from './tips';

export interface TipClipForProps {
  id: CardTipId;
  active: boolean;
}

/**
 * The tips' clips (their scenes and the reel engine that plays them) are a file of their own: a page
 * with a tip opens without them, and the tip's card keeps the clip's frame until they arrive. Fetched
 * when a tip is about to be shown.
 */
export const tipClipPart = lazyPart<ComponentType<TipClipForProps>>(() => import('./TipClipFor').then((module) => module.default));
