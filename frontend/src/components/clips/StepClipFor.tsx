import StepClip from './StepClip';
import { STEP_CLIPS } from './index';
import type { StepClipId } from './types';

/** A how-to clip by its id: the player and every clip's scene, in the file clipPart.ts loads. */
export default function StepClipFor({ id, active, compact = false }: { id: StepClipId; active: boolean; compact?: boolean }) {
  return <StepClip clip={STEP_CLIPS[id]} active={active} compact={compact} />;
}
