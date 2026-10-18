import type { ComponentType } from 'react';
import { lazyPart } from '../../lib/lazyPart';
import type { StepClipId } from './types';

export interface StepClipForProps {
  id: StepClipId;
  active: boolean;
  compact?: boolean;
}

/**
 * The how-to clips (their scenes and the reel engine that plays them) are a file of their own: the studio's tour and the
 * move dialog open without them and keep the clip's frame (Placeholder.tsx) until they arrive. The guide plays them from
 * its own clip part (guide/clipPart.ts), which holds the same scenes.
 */
export const stepClipPart = lazyPart<ComponentType<StepClipForProps>>(() => import('./StepClipFor').then((module) => module.default));
