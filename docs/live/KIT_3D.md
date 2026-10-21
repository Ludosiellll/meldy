# The 3D kit of the movement games

Characters and bosses for the classroom movement games, drawn with three.js on the projector. The look was chosen by
the owner on 21.10 from a style board: players are **KayKit Adventurers** (Kay Lousberg, CC0) in their own clothes
colour with a small accessory; the boss «Дедлайн» is the teacher's pick, **`skeleton`** (KayKit Skeleton Warrior with an
alarm clock on its chest and red eyes) or **`clock`** (our own alarm-clock brute). Code: `frontend/src/lib/live/three/`.
Files: `frontend/public/game/` (licences there, `LICENSES.md`). The server and the wire format: `MOVE.md`.

**Phones** (owner, 21.10: the phone shows the projector's game, the camera on the own hero): during a question the
phone draws the same arena with this kit (`components/live/stand/phone/scene3d.ts`): the projector's 3/4 view from the
front at the same tilt (52°) and perspective, closer (about 40 % of the arena's width across a 390 px phone), following
the own hero left and right; the arena's whole depth sits between the question card and the stick (`camera.ts`, a lens
shift: `CameraSpec.shift`). The own hero wears «Вы» and a white ring (`player.setOwn`). The signs are 0.7 of the
projector's and the tiles simpler (`createArena(map, shape, { signScale: 0.7, tileSegments: 1 })`). It draws lighter than
the projector: no outlines, at most 1.25 pixels a point, and its own ladder (`phone/quality.ts`) lowers the glows, then
the resolution, and at last caps it at 30 frames a second (`view.setMaxFps`): the light view is still 3D. Only a phone
without WebGL 2 plays the flat view: the pictures of §6 as sprites from above (`sprites.ts`). The hero picker shows the
pictures (§6).

## 1. Use

```ts
import { loadKit } from '../../lib/live/three';      // this module has no three.js in it

const kit = await loadKit({ boss: 'skeleton' });     // fetches the 3D chunk and the models (cached for a year)
const view = kit.mount(canvas);                       // pixel ratio ≤ 1.5, adaptive quality, pauses on a hidden tab
const arena = kit.createArena(map, { floor, stage }); // the server's map (welcome.map); mode A: the hello's floor and stage
arena.setZoneLabels({ A: 'Меркурий', B: 'Венера', C: 'Марс', D: 'Земля' });
const boss = kit.createBoss('skeleton');              // stands on its stage (arena.stage)
const players = new Map(roster.map(([id, , , name, look]) => [id, kit.createPlayer(look, name)]));
await view.warmUp();                                  // compiles every shader before the round: no hitch later

view.start((dt, now) => {
  for (const e of snapshot) {                         // interpolated server positions
    const p = players.get(e.id)!;
    p.setPosition(e.x, e.y, arena.floorAt(e.x, e.y));
    p.setFacing(Math.atan2(e.vx, e.vy));
    p.setPose(e.moving ? 'run' : 'idle');
  }
});

// the stomp: the boss jumps, the floor drops from under the stage when it lands
boss.setPhase('stomp');
arena.collapse('A', kit.now() + boss.stompImpactS);
// a player whose tile drops: setPose('fall') and z = arena.floorAt(x, y); later setGhost(true)
// next question: arena.restore(); boss.setPhase('idle')

kit.dispose();                                        // on unmount: stops the loop, frees the GPU
```

One kit draws one scene on one canvas. `loadKit` returns a new kit each call; the files come from the browser's cache.

## 2. API

```ts
loadKit(options?: { boss?: 'skeleton' | 'clock' }): Promise<Kit>
prefetchKit(): void                                   // start fetching the 3D chunk early

interface Kit {
  createPlayer(look: PlayerLook, name: string): Player
  createBoss(kind: 'skeleton' | 'clock', options?: { height?: number }): Boss   // metres; the skeleton needs loadKit({ boss: 'skeleton' }) or loadBoss first
  loadBoss(kind: BossKind): Promise<void>
  createArena(map: MoveMap, shape?: { floor?: FloorGrid; stage?: [x, y, r] }, look?: ArenaLook): Arena
                                                      // look: { signScale?: 0.3…1 (default 1), tileSegments?: 1 | 2 (default 2) }
  mount(canvas: HTMLCanvasElement, options?: ViewOptions): View
  now(): number                                       // seconds of the kit's clock: real seconds (the loop advances it)
  update(dt: number): void                            // the loop calls it with the real time between frames, however
                                                      // long; call it yourself only without view.start
  dispose(): void
}
interface Player {
  readonly look: PlayerLook; readonly name: string; readonly pose: Pose
  setPose(pose: 'idle' | 'run' | 'jump' | 'fall' | 'cheer' | 'hit' | 'lie' | 'wave'): void
  setGhost(on: boolean): void
  setIce(on: boolean, instant?: boolean): void        // the battle's freeze: a block of ice grows round it / breaks
  setAway(on: boolean): void                          // the name tag fades (the phone is away)
  setOwn(on: boolean): void                           // a white ring with a dark edge round the feet (the phone's own hero)
  setFacing(rad: number, instant?: boolean): void     // map angle: 0 faces +y (down the map, to the viewer), π/2 faces +x
  setPosition(x: number, y: number, z?: number): void // map units; z = height over the floor (negative: falling)
  update(dt: number): void                            // done by the kit each frame unless you call it first
  dispose(): void
}
interface Boss {
  readonly kind: BossKind; readonly phase: BossPhase
  readonly stompImpactS: number                       // setPhase('stomp') → blow on the floor: skeleton 0.7 s, clock 0.85 s
  setPhase(phase: 'idle' | 'warn' | 'stomp' | 'roar' | 'stunned' | 'chase'): void
  setPosition(x: number, y: number): void             // default: the arena's stage
  setFacing(rad: number): void
  update(dt: number): void; dispose(): void
}
interface Arena {
  readonly map: MoveMap; readonly stage: { x: number; y: number }
  setZoneLabels(labels: Partial<Record<string, string>>): void   // by zone id; A–D show as А–Г
  setClosedZones(ids: readonly string[]): void                   // zones that take no answer now: plain tiles, no sign
  collapse(correctZoneId: string, tStart?: number): void         // tStart in kit.now() seconds (default: now)
  restore(): void
  floorAt(x: number, y: number, at?: number): number  // map units: 0 intact, negative while the tile falls; at kit
                                                      // second `at` (default now: a slow frame asks for its draw time)
  fallsAt(x: number, y: number): number               // kit.now() second the tile starts to drop, Infinity if it stays
  update(dt: number): void; dispose(): void
}
interface View {
  start(onFrame?: (dt: number, now: number) => void): void; stop(): void
  setCamera(spec: { arena?: MoveMap; margins?: {top?, bottom?, left?, right?}; tilt?: degrees; eye?; target?; fov?;
                    shift?: { x?, y? } }): void         // shift: moves an eye/target picture by shares of the view (a lens shift)
  shake(strength?: number): void
  warmUp(): Promise<void>
  setQuality(level: 'auto' | number): void            // 0 best … 5 cheapest
  setMaxFps(fps: number): void                        // draw at most fps frames a second (0: every frame); also ViewOptions.maxFps
  stats(): FrameStats                                  // fps, frame time and JS time (mean, p95), draw calls, level
  resize(): void; dispose(): void
}
```

Poses: `idle`, `run`, `fall`, `cheer`, `wave` loop; `jump` and `hit` play once and go back to the last looping pose
asked for (asking for `run` every frame does not cut a hit short); `lie` falls down and stays; a pose already shown is
not restarted. Bosses: `warn` rings the bells and glows, `stomp` jumps once and returns to `idle` by itself, `stunned`
makes the skeleton fall apart (it gets up when the phase changes) and the clock reel, `chase` runs.

`createArena` frames the camera on the whole floor and the stage; `view.setCamera({ arena: map, margins: { top: 0.11 } })`
keeps the top 11 % free for the question board. The fit takes the floor's corners, the boss's top, the tops of the
upright signs and the corners of the labels lying on the floor, as close as they fit between the margins, then shifts
the lens so they sit in the middle of the free part (`camera.setViewOffset`; the perspective does not change). `tilt`
is how steeply the camera looks down (default 27°; the projector of mode A uses 52°, so the boss on its central stage
hides little behind it).

Name tags never cover each other: each frame a tag that would overlap one already placed is left out (shown in the
last frame first, so names do not blink; the living before ghosts; nearer before farther). `ViewOptions.tagDeclutter`
(default true) switches it; the placement is `lib/live/three/declutter.ts` (pure, no three.js: any screen that draws
labels over a crowd can use it).

## 3. The look (the wardrobe's own ids)

`PlayerLook = { body, colour, hat }` uses the ids of `CONTRACT.md` §10, so a wardrobe `Look` (with its `eyes`, ignored)
goes in as it is and a player's choice carries over between games. `toPlayerLook(raw)` turns anything off the network
into a valid look (unknown parts fall back to the first option).

| body | KayKit model | picker name |
|---|---|---|
| `square` | Knight | Рыцарь |
| `drop` | Mage | Маг |
| `round` | Barbarian | Силач |
| `bean` | Rogue | Следопыт |
| `cloud` | Rogue_Hooded | В капюшоне |

Clothes (`COLOUR_OPTIONS`, projector-tuned): the 8 free colours `blue yellow green pink sky orange violet teal` (`PALETTE`),
then the locked `graphite` and `snow`. A test keeps the 8 at least 90 RGB units apart and saturated.

Accessories (`HAT_OPTIONS`): `none` (the model's own helmet or hat), the wardrobe's `cap beanie phones flower antenna bow`
and the locked `crown grad horns`, plus three the kit has but the server does not accept yet (`wardrobe: false`):
`party` (колпак), `propeller`, `tophat`. Adding them to the wardrobe needs `rules.ts`/SQL `checkLook` to list them.

## 4. Mode A: the arena

The floor is laid on the server's map: tiles of ~100 map units (16 × 9 on 1600 × 900), each zone's tiles in its colour
(А red, Б blue, В yellow, Г green), the zone's letter and answer on a sign on legs behind the zone (zones in the top half)
or on the floor (bottom half). The boss's stage is centred 160 units beyond the far edge (`arena.stage`).

**On the server's map (`createArena(welcome.map, { floor: hello.floor, stage: hello.stage })`, MODE_STAND.md §3).** The
tiles are the server's grid (60 units from (20, 160), 26 × 12: every tile edge on a zone edge), the map's wall
rectangles are the frame, and the stage is the solid circle in the middle (800, 520, r 80): a round column that stays
standing when the floor around it drops, with the boss on it (the projector draws the clock 4.6 m and the skeleton
4.4 m tall so their feet stay on it). Tiles under the stage are never drawn and never drop; the collapse ripples out
from the stage's centre. Players can never walk where nothing is drawn, nor stop at an invisible wall: the frame and
the column are exactly the server's solids. The projector and the phone both create it this way and draw the boss at
`STAGE_BOSS_HEIGHT` (clock 4.6 m, skeleton 4.4 m), so both screens show the same arena.

`player.setAway(on)` fades a player's name tag as a ghost's (the room's `F_AWAY`); the body is drawn as usual (a
see-through body for one player would need a sorted transparent pass of its own).

`player.setIce(on, instant?)` draws the battle's freeze in a mixed game's movement round (MODE_MIXED.md, the room's
`F_ICE`): a pale faceted block round the character grows past its size and settles in 0.38 s; switched off, it swells
and shrinks to nothing in 0.42 s and throws six chips. `instant` shows it as it is (a state seen late, the arena coming
back after the button questions). The block is hidden while the character is a ghost or falls. Every block and chip of
the scene is one instance of one transparent InstancedMesh drawn after the solid bodies (`internal/ice.ts`): no draw
call while nobody is frozen, one otherwise; `view.warmUp()` compiles it with the rest. The screens choose when to call
it: the projector (`stand/scene.ts`, `mixed: true`) breaks the ice on the right zone at the boss's blow and forms it on
the fallen when the floor brings them back; frozen characters slide in their block (the idle pose), they do not run.

`?fps=1` on the projector page and the phone's play page shows a corner readout: frames a second, the slowest 5 % of
frames in ms and the 3D quality level (`2D` for the phone's flat view). Never shown by default; it is how a real
laptop or phone is checked, since this container has no GPU.

`collapse(id, t)`: every tile outside zone `id` shakes for 0.3 s, then drops with gravity (1300 units/s²) at
`t + 0.12 s + 0.0009 s × distance from the impact point + up to 0.1 s` (a seeded jitter): a ripple from under the stage
that crosses the 1600 × 900 floor in ~1.5 s. A shock ring and a camera jolt mark `t`. `restore()` brings the tiles back up
in ~0.5 s. The timing is pure and tested (`arenaPlan.ts`; `collapseDownAfter` is when the whole gap is down, ~1.3 s on
the stand arena). A projector turns a server time into the kit's clock with `kit.now() + (serverT − serverNow) / 1000`.

The kit's clock is real time. Each frame advances it, the boss and every character by the real time since the last
frame, however long (`onFrame(dt, now)`: the frame is drawn at `now + dt`). Until 47.23 a frame advanced it by at most
0.1 s: on a projector without a GPU (1–2 frames a second) the stomp, the blow and the drop ran at a tenth of real time,
and the room's `floor: up`, 4 real seconds after the result, restored the floor before the drop was ever drawn (live
check 21.10, three games and the stand check of 47.19: no frame showed the gap). The phone's quality ladder still judges
frames capped at 100 ms, as it was tuned.

## 5. Performance budgets (owner, 21.10: «чтобы лагов не было ни на телефоне ни на ноуте»)

| budget | how the kit meets it | measured |
|---|---|---|
| 40 players + boss + arena at 60 fps on a weak laptop; frame p95 ≤ 16.7 ms on real hardware | see below; adaptive quality steps down when frames run late | real hardware: not measured here (no GPU); `?fps` shows it on the laptop |
| JS per frame ≤ 6 ms for 40 players (headless) | clips baked into a bone texture: a player costs a few floats per frame, no AnimationMixer; only the used part of each instance buffer is uploaded | mean 0.9–1.2 ms, p95 3.6–4.0 ms (§5.1) |
| draw calls ≤ 150 | one InstancedMesh per body model and per accessory (players of a kind share one call), shared materials, one tag atlas | 58–61 for 30–40 players with outlines; 73 at most mid-collapse with ghosts |
| no real-time shadows | blob shadows and the colour rings: one call for everyone | — |
| pixel ratio ≤ 1.5, adaptive | levels: outlines off → glows and shock ring off → render scale 0.85, 0.72, 0.6; back up after 6 s of calm, twice as long after each failure | `quality.test.ts` |
| far/small characters | not needed: skinning runs on the GPU from the baked texture, so a player's animation costs the CPU nothing | — |
| no per-frame allocation | scratch vectors and matrices, arrays not Sets, tag sorting in place | — |
| name tags without layout | drawn once into a canvas atlas, all tags one instanced draw sorted far to near | — |
| hidden tab | the loop stops on `visibilitychange` | — |
| first frame without a hitch | `view.warmUp()`: compileAsync on every material, one render with every batch visible | — |
| phone: the same 3D game, lighter; flat only without WebGL | pixel ratio ≤ 1.25, no outlines, simpler tiles (a third of the floor's triangles); the phone's own ladder (`phone/quality.ts`): glows off, resolution 0.85 → 0.72 → 0.6, then 30 fps; the first 1.5 s of each question are not judged, the slowest fifth of the frames is left out, a phone far over the budget drops two levels at once | §5.3 |
| load ≤ 2 s | 3D chunk (628 KB, 166 KB gz) only on game routes, not in the service worker's precache; models 0.43 MB gz without the skeleton, 0.59 MB with it; immutable caching | 1.1–2.3 s to the first frame locally (§5.1) |

### 5.1 Measured

2026-10-21, this repo's container (4 shared cores, load average 8–18 from other jobs: the p95 and max columns are
mostly that noise; p50 is the steady cost). Bench scene, outlines on (quality pinned at 0), JavaScript per frame in ms:

| players | boss | CPU | mean | p50 | p95 | of it the kit's update (mean) | draw calls | triangles |
|---|---|---|---|---|---|---|---|---|
| 40 | skeleton | 1× | 1.24 | 0.8 | 4.0 | 0.14 | 61 | 467 k |
| 40 | clock | 1× | 0.92 | 0.5 | 3.6 | 0.12 | 58 | 464 k |
| 40 | skeleton | 4× slower | 4.06 | 3.5 | 11.0 | 0.52 | 61 | 467 k |
| 40 | clock | 4× slower | 4.95 | 3.3 | 17.6 | 0.37 | 58 | 464 k |
| 30 | skeleton | 1× | 0.73 | 0.7 | 1.3 | 0.10 | 61 | 366 k |
| 30 | clock | 1× | 2.20 | 0.9 | 5.0 | 0.83 | 58 | 363 k |

Most of a frame's JavaScript is three.js handing ~60 draw calls over; the kit's own update for 40 players is about
0.1 ms. Load to the first frame (Vite dev server on the same machine, shaders compiled on the CPU by SwiftShader):
1.1–2.3 s. Over the network the arena needs the 3D chunk (166 KB gz) and the models (0.43 MB gz, 0.59 MB with the
skeleton): about 0.6 s at 10 Mbit/s.

The harness: `cd frontend && NODE_PATH=<playwright> node scripts/game-kit.mjs perf 30 40`. It opens the bench scene
(players run about, the boss stomps, the floor drops and comes back every 6 s, outlines on) in Chromium with SwiftShader,
and for 120 frames waits for the GPU (`gl.finish`) and then times one frame's JavaScript: the game's script, the kit's
update and handing the draw calls over. With `Emulation.setCPUThrottlingRate` 4 it does the same on a CPU four times
slower. SwiftShader is a GPU emulated on the CPU, so the frame rate it reaches says nothing about a real GPU; the real
check is `/scripts/game-preview.html?scene=bench&players=40&fps` in `npm run dev` on the projector laptop.

### 5.2 Not measured here

- Frame time on a real GPU: there is none in the container. Open `?scene=bench&players=40&fps` on the projector laptop.
- The 4× CPU numbers come from Chromium's `Emulation.setCPUThrottlingRate` in headless mode on a busy machine; they
  vary by ±50 % between runs.

### 5.3 The phone (21.10, owner: «чтобы лагов не было ни на телефоне»)

Same scene before and after the phone's rework (2026-10-21). The phone's page replayed frame by frame from slide 12's
recorded game (30 players, the clock boss, following Лиза; 390 × 844 at 2×, Chromium on Mesa llvmpipe; draw calls and
triangles counted on the WebGL context; JavaScript is everything the page runs in a frame, render call included), in
two windows: the class running (16.5–21 s) and the floor dropping with ghosts (31.2–34 s).

| phone page | canvas pixels | frames a second | draw calls (mean, max) | triangles | JS ms a frame, p50 (p95) |
|---|---|---|---|---|---|
| before, its best level | 487 × 1055 (0.51 M) | every frame | 29.6, 32 / 28.9, 34 | 254 k / 253 k | 1.2 (3.6) / 1.5 (4.5) |
| after, best level | 487 × 1055 (0.51 M) | every frame | 29.1, 32 / 31.8, 38 | 194 k / 194 k | 1.3 (3.9) / 1.7 (5.2) |
| after, light level (5) | 292 × 633 (0.18 M) | 30 at most | 28.1, 31 / 29.6, 37 | 194 k / 194 k | 1.4 (3.7) / 1.7 (4.1) |
| flat view (no WebGL) | 488 × 1055, 2D canvas | every frame | 0 | 0 | 0.4 (0.7) |

The kit's bench on the server's grid, 40 players, level 1, 390 × 844 (`?scene=bench&grid&q=1`, then `&look=phone`;
SwiftShader, 120 frames each):

| boss | draw calls | triangles: before → after | JS ms a frame, p50: before → after (1× CPU / 4× slower) |
|---|---|---|---|
| clock | 36 | 305 k → 245 k | 0.4 → 0.4 / 2.0 → 1.0 |
| skeleton | 39 | 306 k → 246 k | 0.4 → 0.4 / 0.7 → 1.8 |

What changed: the floor's tiles draw a third of their triangles (60 k fewer, a quarter of the phone's picture), draw
calls stay the same (the own hero's ring rides in the blobs' call; the extra calls at the drop are the falling heroes,
who now stay solid until their tile goes, as on the projector), and the light level draws 36 % of the pixels at half
the frames. The JavaScript numbers were taken on a machine with a load average of 5 to 30 from other jobs: before and
after are the same within that noise (the camera adds a few multiplications a frame). Frame time on a real phone GPU is
not measured here: open the play page with `?fps=1` on the phone (the readout shows the level: `3D 0` best … `3D 5`
light, `2D` the flat view).

## 6. The phone's picture

The two bosses' pictures for the game's setup: `bossPictureUrl(kind)` → `/game/boss/<kind>-<hash>.webp` (200 × 200,
transparent, about 10 KB each; `node scripts/game-kit.mjs bosses` renders them from the kit and writes `bosses.gen.ts`).

`thumbUrl(body, hat)` → `/game/thumbs/<hash>/<model>-<hat>.webp`: 65 files (5 bodies × 13), 320 × 160, 246 KB in all and 5 KB at most each: the left half is
the character with white clothes, the right half a mask, opaque where the clothes are. Paint the player's colour with
`paintThumb(canvas, img, colour)` or in CSS:

```css
.thumb { position: relative; background: url(…) 0 0 / 200% 100%; }
.thumb::after { content: ''; position: absolute; inset: 0; background: var(--clothes); mix-blend-mode: multiply;
  -webkit-mask: url(…) 100% 0 / 200% 100%; mask: url(…) 100% 0 / 200% 100%; }
```

Re-render after a model or accessory change: `node scripts/game-kit.mjs thumbs` (writes the folder and `thumbs.gen.ts`).

## 7. Files and caching

| file | what | raw | gz |
|---|---|---|---|
| `kaykit-<body>-*.gltf/.bin/.png` × 5 | the bodies: six skinned parts, cape, own hat; no weapons | 0.82 MB | 0.38 MB |
| `kaykit-anims-*` | the rig and the 8 clips all bodies share | 0.25 MB | 0.04 MB |
| `kaykit-skeleton-*` | the skeleton boss and its 7 clips (loaded only if picked) | 0.50 MB | 0.16 MB |

Every name carries a hash of its content (`scripts/game_assets.py`, which also writes `assets.gen.ts`); nginx serves them
for a year, gzipped (`location ~ ^/game/…`); the 3D chunk (`game3d-*.js`) is left out of the service worker's precache, so
only game screens fetch it. No binary file is over 96 KB: the Space refuses pushed binaries over 100 KB
(`backend/tests/test_space_binaries.py`), so a model is a .gltf with several .bin buffers. Rebuild them with
`python3 -I frontend/scripts/game_assets.py <KayKit Adventurers dir> <KayKit Skeletons dir>`.

## 8. Dev preview

`npm run dev`, then `/scripts/game-preview.html?scene=lineup` (8 characters and both bosses), `?scene=arena&boss=clock`
(30 players, the stomp, the collapse, ghosts), `?scene=hats` (every body with every hat), `?scene=bench&players=40&fps`.
Screenshots: `node scripts/game-kit.mjs shots <dir>`. None of it is in the build.
