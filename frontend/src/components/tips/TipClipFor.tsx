import TipClip from './TipClip';
import { TIP_CLIPS } from './scenes';
import { TIPS, type TipId } from './tips';

/** The clip of a tip by its id: the player and every tip's scene, in the file clipPart.ts loads. */
export default function TipClipFor({ id, active }: { id: TipId; active: boolean }) {
  return <TipClip clip={TIP_CLIPS[id]} active={active} themed={Boolean(TIPS[id].clip?.themed)} />;
}
