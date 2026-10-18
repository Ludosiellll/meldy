import type { ComponentType } from 'react';
import { lazyPart } from '../../lib/lazyPart';
import type { GuideChapterId } from './chapters';
import type { StepClipId } from '../clips/types';

export interface GuideClipProps {
  chapter: GuideChapterId;
  /** A step clip of the chapter (its `reels`) in place of the chapter's own clip. */
  reel?: StepClipId | null;
  active: boolean;
}

/**
 * The guide's clips (their scenes and the reel engine that plays them) are a file of their own: the
 * signed-in shell opens without them, and the guide's card keeps the clip's frame until they arrive.
 * Fetched as soon as a first run is likely (with the shell for a new account, lib/prefetch.ts; once
 * the profile says so, GuideContext), when the guide opens, or once the first screen is idle.
 */
export const guideClipPart = lazyPart<ComponentType<GuideClipProps>>(() => import('./GuideClip').then((module) => module.default));

/** Remembered on this device as soon as the guide is closed (the profile keeps it for other devices). */
export const GUIDE_SEEN_KEY = 'meldy_guide_seen';

/** The guide was closed on this device (GuideContext). Read before the shell arrives, too (lib/prefetch.ts). */
export function guideSeenHere(): boolean {
  try {
    return window.localStorage.getItem(GUIDE_SEEN_KEY) === '1';
  } catch {
    return false;
  }
}

/** An account this young has most likely not seen the guide yet. */
const NEW_ACCOUNT_MS = 3 * 24 * 60 * 60 * 1000;

export function isNewAccount(createdAt: string | null | undefined): boolean {
  const at = createdAt ? Date.parse(createdAt) : Number.NaN;
  return Number.isFinite(at) && Date.now() - at < NEW_ACCOUNT_MS;
}
