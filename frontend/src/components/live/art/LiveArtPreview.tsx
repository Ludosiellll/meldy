/**
 * Every part of the live game's art on one page, for W2 and W3 to look at and copy from (dev only: /dev/live-art).
 * Sizes 40 / 64 / 168 px: the projector's crowd, the phone's own character, the builder's preview.
 */
import { useState, type ReactNode } from 'react';
import type { BossPhase, Expression, Look } from '../../../lib/live/types';
import { BODIES, COLOURS, EYES, HATS } from '../../../lib/live/rules';
import { Boss, type BossMove } from './Boss';
import { Character, type CharacterMove } from './Character';
import { Burst, DamageLabel, Debris, Shard, Star } from './Fx';
import { BODY_PARTS, COLOUR_PARTS, EYE_PARTS, HAT_PARTS } from './parts';

const ME: Look = { body: 'cloud', colour: 'orange', eyes: 'round', hat: 'phones' };
const FACES: Expression[] = ['idle', 'happy', 'hurt', 'frozen'];
const MOVES: CharacterMove[] = ['idle', 'bounce', 'hit', 'cheer', 'none'];
const BOSS_MOVES: BossMove[] = ['idle', 'hit', 'roar', 'fall', 'none'];

const row = { display: 'flex', flexWrap: 'wrap' as const, gap: 22, alignItems: 'flex-end', padding: '12px 0 28px' };
const label = { font: '500 13px/1.3 system-ui, sans-serif', color: '#4B515B', marginTop: 6, textAlign: 'center' as const };

function Cell({ children, text }: { children: ReactNode; text: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
      {children}
      <div style={label}>{text}</div>
    </div>
  );
}

export default function LiveArtPreview() {
  const [move, setMove] = useState<CharacterMove>('idle');
  const [bossMove, setBossMove] = useState<BossMove>('idle');
  const [phase, setPhase] = useState<BossPhase>(0);
  const [hurt, setHurt] = useState(false);
  const [flash, setFlash] = useState(0);
  return (
    <main style={{ background: '#F3F3F0', color: '#0B121C', minHeight: '100vh', padding: '24px max(16px, env(safe-area-inset-left, 0px))', fontFamily: 'Onest, system-ui, sans-serif' }}>
      <h1 style={{ font: '700 28px/1.1 Onest, system-ui, sans-serif', margin: 0 }}>Живая игра: персонажи и монстр</h1>
      <p style={{ color: '#4B515B', margin: '8px 0 20px' }}>Части из docs/live/CONTRACT.md §10. Движение — только transform и opacity.</p>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {MOVES.map((m) => (
          <button key={m} type="button" onClick={() => setMove(m)} aria-pressed={move === m} style={{ padding: '8px 14px', borderRadius: 999, border: '1.5px solid #E3E3DD', background: move === m ? '#0B121C' : '#fff', color: move === m ? '#fff' : '#0B121C' }}>
            {m}
          </button>
        ))}
      </div>

      <h2>Тела · 168 px</h2>
      <div style={row}>
        {BODIES.map((b, i) => (
          <Cell key={b} text={BODY_PARTS[b].name}>
            <Character look={{ ...ME, body: b, colour: COLOURS[i] }} size={168} move={move} phaseMs={i * 170} />
          </Cell>
        ))}
      </div>

      <h2>Цвета · 64 px</h2>
      <div style={row}>
        {COLOURS.map((c) => (
          <Cell key={c} text={`${COLOUR_PARTS[c].name}${COLOUR_PARTS[c].lock ? ' · закрыт' : ''}`}>
            <Character look={{ ...ME, colour: c }} size={64} move={move} />
          </Cell>
        ))}
      </div>

      <h2>Глаза и выражения · 96 px</h2>
      <div style={row}>
        {EYES.map((e) => (
          <Cell key={e} text={EYE_PARTS[e].name}>
            <Character look={{ ...ME, eyes: e }} size={96} move={move} />
          </Cell>
        ))}
        {FACES.map((f) => (
          <Cell key={f} text={f}>
            <Character look={ME} size={96} face={f} frozen={f === 'frozen'} move={move} />
          </Cell>
        ))}
      </div>

      <h2>Шапки · 64 px</h2>
      <div style={row}>
        {HATS.map((h, i) => (
          <Cell key={h} text={`${HAT_PARTS[h].name}${HAT_PARTS[h].lock ? ' · закрыта' : ''}`}>
            <Character look={{ ...ME, hat: h, body: BODIES[i % BODIES.length] }} size={64} move={move} />
          </Cell>
        ))}
      </div>

      <h2>Класс на проекторе · 40 px</h2>
      <div style={{ ...row, gap: 14 }}>
        {Array.from({ length: 24 }, (_, i) => (
          <Character key={i} look={{ body: BODIES[i % 5], colour: COLOURS[(i * 3) % 8], eyes: EYES[(i * 2) % 5], hat: HATS[(i * 7) % 7] }} size={40} move={move} phaseMs={(i * 137) % 800} name={String(i + 1)} />
        ))}
      </div>

      <h2>Дедлайн</h2>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
        {[0, 1, 2].map((p) => (
          <button key={p} type="button" onClick={() => setPhase(p as BossPhase)} aria-pressed={phase === p} style={{ padding: '8px 14px', borderRadius: 999 }}>
            фаза {p}
          </button>
        ))}
        <button type="button" onClick={() => setHurt((h) => !h)} aria-pressed={hurt} style={{ padding: '8px 14px', borderRadius: 999 }}>
          удар
        </button>
        <button type="button" onClick={() => setFlash((f) => f + 1)} style={{ padding: '8px 14px', borderRadius: 999 }}>
          вспышка
        </button>
        {BOSS_MOVES.map((m) => (
          <button key={m} type="button" onClick={() => setBossMove(m)} aria-pressed={bossMove === m} style={{ padding: '8px 14px', borderRadius: 999 }}>
            {m}
          </button>
        ))}
      </div>
      <div style={row}>
        <Boss size={300} phase={phase} hurt={hurt} move={bossMove} flashKey={flash} />
        <Boss size={58} phase={phase} hurt={hurt} move={bossMove} />
      </div>

      <h2>Удары</h2>
      <div style={row}>
        <Star colour="orange" />
        <Star colour="blue" size={44} />
        <Burst />
        <Shard />
        <Debris kind="bell" />
        <Debris kind="gear" />
        <Debris kind="hand" />
        <Debris kind="spring" />
        <DamageLabel value={142} />
        <DamageLabel value={196} mine />
      </div>
    </main>
  );
}
