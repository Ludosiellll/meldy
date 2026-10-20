/**
 * Small pieces of the battle: the star a right answer throws (in the player's colour), the burst where it lands, the ice
 * shard of the counter-attack, the boss's debris on defeat. Static SVG; the screens move them with transform.
 */
import type { ColourId } from '../../../lib/live/types';
import { COLOUR_PARTS, OUTLINE } from './parts';

export function Star({ colour, size = 30 }: { colour: ColourId; size?: number }) {
  return (
    <svg viewBox="0 0 30 30" width={size} height={size} aria-hidden="true">
      <path d="M15 2L18.6 10.4L27.6 11.2L20.8 17.2L22.8 26L15 21.4L7.2 26L9.2 17.2L2.4 11.2L11.4 10.4Z" fill={COLOUR_PARTS[colour].value} stroke={OUTLINE} strokeWidth={2.6} strokeLinejoin="round" />
    </svg>
  );
}

export function Burst({ size = 64 }: { size?: number }) {
  return (
    <svg viewBox="0 0 64 64" width={size} height={size} aria-hidden="true">
      {[0, 45, 90, 135, 180, 225, 270, 315].map((a) => {
        const r = (a * Math.PI) / 180;
        return <path key={a} d={`M${32 + 14 * Math.cos(r)} ${32 + 14 * Math.sin(r)}L${32 + 28 * Math.cos(r)} ${32 + 28 * Math.sin(r)}`} stroke={OUTLINE} strokeWidth={4} strokeLinecap="round" />;
      })}
    </svg>
  );
}

export function Shard({ size = 26 }: { size?: number }) {
  return (
    <svg viewBox="0 0 26 26" width={size} height={size} aria-hidden="true">
      <path d="M13 1L24 13L13 25L2 13Z" fill="#CFEAFF" stroke="#3E86C6" strokeWidth={2.6} strokeLinejoin="round" />
    </svg>
  );
}

export type DebrisKind = 'bell' | 'gear' | 'hand' | 'spring';

export function Debris({ kind, size = 60 }: { kind: DebrisKind; size?: number }) {
  return (
    <svg viewBox="0 0 60 60" width={size} height={size} aria-hidden="true">
      {kind === 'bell' && <path d="M6 46A26 26 0 0 1 52 18Z" fill="#F4C45B" stroke={OUTLINE} strokeWidth={4.5} strokeLinejoin="round" />}
      {kind === 'gear' && (
        <>
          <circle cx={30} cy={30} r={14} fill="#FFF6E5" stroke={OUTLINE} strokeWidth={4} />
          {[0, 60, 120, 180, 240, 300].map((a) => (
            <rect key={a} x={26} y={6} width={8} height={10} rx={2} fill="#FFF6E5" stroke={OUTLINE} strokeWidth={3.5} transform={`rotate(${a} 30 30)`} />
          ))}
          <circle cx={30} cy={30} r={5} fill={OUTLINE} />
        </>
      )}
      {kind === 'hand' && <path d="M10 30H50" stroke={OUTLINE} strokeWidth={7} strokeLinecap="round" />}
      {kind === 'spring' && <path d="M12 10Q48 14 14 22T14 34T14 46T48 52" fill="none" stroke={OUTLINE} strokeWidth={4.5} strokeLinecap="round" />}
    </svg>
  );
}

/** The damage label that floats up from a hit: dark pill, white digits (the student's own hit in blue). */
export function DamageLabel({ value, mine = false }: { value: number; mine?: boolean }) {
  return <span className={`lv-dmg${mine ? ' lv-dmg--mine' : ''}`}>−{value}</span>;
}
