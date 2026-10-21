import TipClip, { TipFootage } from './TipClip';
import { TIP_CLIPS, TIP_FOOTAGE } from './scenes';
import { TIPS, type CardTipId } from './tips';

/** The clip of a tip by its id: the player and every tip's scene, in the file clipPart.ts loads. «game» is real footage. */
export default function TipClipFor({ id, active }: { id: CardTipId; active: boolean }) {
  if (id === 'game') return <TipFootage footage={TIP_FOOTAGE[id]} active={active} />;
  return <TipClip clip={TIP_CLIPS[id]} active={active} themed={Boolean(TIPS[id].clip?.themed)} />;
}
