# Live movement games — server core and protocol

Every student moves a character on a shared map from their phone; the teacher's projector shows the whole map. This file
is the contract for the transport and the room core. The game modes (run to the answer zone, escape the monster, …) are
built on top of it. Server: `backend/live_move.py` (the room: simulation, wire format) and `backend/live_move_api.py`
(the WebSocket, auth, limits, room lifecycle). Browser: `frontend/src/lib/live/move/`. The quiz game itself stays
`docs/live/CONTRACT.md`.

## 1. Why our own socket

Supabase Realtime (Free) allows 100 messages a second, and a broadcast counts once plus once per receiver. Thirty phones
sending positions ten times a second are over that at once. Positions therefore go over one WebSocket per phone to the
Space's own FastAPI process, behind its nginx. They also reach phones that only get to Supabase through the `/sb` proxy,
because the socket is on our own domain. Nothing about movement is stored: rooms live in the process's memory. Results
go through the existing `live_*` SQL.

## 2. Connecting

`wss://<site>/api/live/move/ws` (nginx: `location = /api/live/move/ws`, Upgrade/Connection headers, hour-long proxy
timeouts; `connect-src` names `wss://ludosiel-studyforge.hf.space` for Safari).

1. The client opens the socket and sends **hello** as its first text message, within 5 s:
   `{"t":"hello","v":1,"game":"<live_games.id>","token":"<43 chars>","role":"player"|"host"}`.
   The token is the one the device already holds for the `live_*` RPCs: the player token (`meldy.live.player.<game>`),
   or the host token (`meldy.live.host.<game>`). It is never put in the URL, which proxies log.
2. **Token check.** On the first connection of a token, the server calls the existing RPC through PostgREST with the anon
   key, exactly as the browser does: `live_state(p_game, p_token, null)` for a player, or
   `live_host_state(p_game, p_host_token, null)` for the host. Both are SECURITY DEFINER and refuse a wrong token
   (404 `P0002`, 403 `42501` host/kicked). The server reads `state` and `me.player_id`, `name`, `look` from the answer.
   No new SQL function and no migration: one RPC per player per game is negligible for PostgREST (it is not a Realtime
   message), the RPCs are already rehearsed, and their lazy `live_settle` is what every client call does anyway. A room
   remembers `sha256(token) → player`, so a reconnect is not checked again. At most 8 checks run at once; an address
   with 10 failed checks gets one more every 2 s. Tokens are never logged.
3. **Rooms.** The host's connection opens the room of its game (at most 8 rooms per process). A phone that comes before
   the host is closed with 4404 and retries in ~2 s. A game in state `ended` is refused (4410).
4. The server answers **welcome** (§4) and starts sending snapshots. A player whose `live_players.id` is already in the
   room gets the same character back (`resumed: true`). An older socket of the same player is closed with 4001.

### Close codes

| code | meaning | client lib |
|---|---|---|
| 4000 | room closed: the host was gone for more than 60 s | stops |
| 4001 | replaced by a newer socket of the same player | stops |
| 4400 | broke the protocol (bad hello, bad frame, binary from the host) | stops |
| 4401 | unknown game or token | stops |
| 4403 | kicked, or a foreign `Origin` (refused at the handshake: HTTP 403) | stops |
| 4404 | no room yet (the host is not connected) | retries in ~2 s |
| 4408 | no hello in 5 s, or nothing received for 15 s | retries |
| 4409 | room full (60 players) or 3 host screens already | stops |
| 4410 | the live game ended (host `end`, the 60 s state check, the 3 h expiry) | stops |
| 4429 | too many sockets, rate limit, a reader too slow, failed checks from this address | retries, ≥ 3 s |
| 4503 | Supabase did not answer the token check | retries, ≥ 3 s |
| 1009 | a frame over the size limit | stops |

Other codes (1006 network drop, 1001, 1011, …) retry with backoff 0.5 s → 8 s, ±30 % jitter.

## 3. The room

- **Tick** 20 Hz (`TICK_HZ`). **Snapshots** every 2nd tick: 10 Hz (`SNAP_EVERY`).
- **Map units.** The reference map is 1600 × 900, the projector's 16:9. A player is a circle of radius 18 moving at
  most 260 units/s (13 a tick); the chaser monster has radius 26 and moves at 190 units/s. A step is shorter than a
  radius, so nothing passes through a solid.
- **Commands.** A phone makes one command per tick on its own clock: a joystick of signed bytes plus a buttons byte, with
  a seq that starts at 1 on every connection. It sends them in frames at ~15 Hz (1–4 commands each). The room queues
  them and applies **exactly one command per player per tick**. It applies two when more than 4 are queued, or once a
  second when a command has waited through the whole second (standing backlog only adds latency). A full queue (8)
  drops its oldest. A still joystick does not move. A frozen player's commands are acked but do not move them.
- **Ack.** Each snapshot tells the phone the seq of its last applied command. The phone replays its later commands
  through the same movement code (`sim.ts`), so the prediction lands where the server will. Both sides compute the
  same doubles: `contracts/live/move_cases.json` is checked by `test_live_move.py` and `sim.test.ts`.
- **Collision:** circles against rectangles and circles of the map, two passes (rectangles, then circles, in map
  order), then clamped to the map. Players pass through each other.
- **NPC stub:** `{"t":"cmd","op":"npc","on":true,"n":1}` adds a chaser that runs at the nearest connected player who
  is not caught. A catch (circles touch) emits `{"t":"ev","k":"caught","id":<player>,"by":<npc>}` and freezes the
  player for 2 s (the default `RoomHooks.on_catch`). Modes subclass `RoomHooks` (`on_tick`, `can_chase`, `on_catch`).
- **Lifecycle:** opened by the host, closed when no host has been connected for 60 s (4000), when the host sends `end`,
  when the periodic check (every 60 s, through `live_host_state`) finds the game `ended`, or 3 h 10 min after opening
  (4410). A process restart (release, Space sleep) loses every room; the clients reconnect, get 4404 until the host's
  screen reconnects, and the players come back at spawn points.

## 4. Messages

### Binary (little-endian)

Input, phone → server (6 + 3n bytes; n = 1…4, seqs `first … first + n − 1`):

| offset | type | field |
|---|---|---|
| 0 | u8 | 2 |
| 1 | u8 | n |
| 2 | u32 | first seq (≥ 1) |
| 6 + 3i | i8, i8, u8 | jx, jy (−127…127; −128 counts as −127; +y is down), buttons |

Snapshot, server → client (16 + 8 per entity; 60 players + a monster = 504 bytes):

| offset | type | field |
|---|---|---|
| 0 | u8 | 1 |
| 1 | u8 | protocol version (1) |
| 2 | u16 | entity count |
| 4 | u32 | tick |
| 8 | u32 | t: ms since the room opened (= tick × 50) — the interpolation clock |
| 12 | u32 | ack: this phone's last applied command seq (0 for the host) |
| 16 + 8k | u16 ×4 | entity id, x × 10, y × 10, flags |

Flags: bits 0–1 kind (0 player, 1 npc), bit 2 away (the phone is not connected), bit 3 frozen, bit 4 caught,
bits 5–7 the mode's (bit 5 ghost in «Встань на ответ»), bits 8–15 the map zone it stands in (index + 1, 0 = none).

### JSON, server → client

- `welcome`: `{"t":"welcome","v":1,"role","tick","ms","hz":20,"snap":2,"q":10,"speed":260,"r":18,"npc_r":26,
  "map":<Map>,"roster":[[id,kind,pid,name,look]…],"frozen":false}`. A player also gets `"you":<entity id>`,
  `"pid"` and `"resumed"`.
- `add` `{"e":[id,kind,pid,name,look]}` · `del` `{"id"}` · `map` `{"map"}` (everyone respawns) · `freeze` `{"on"}` ·
  `ev` `{"k":"caught","id","by"}` · `say` `{"data"}` (from the host) · `pong` `{"c","tick","ms"}` ·
  `err` `{"code","why"?}`. Host only: `zones` `{"tick","z":{"A":[ids]…}}`, `stats` (§6).
- **Who sees names** (CONTRACT.md §5): the host's roster has `live_players.id`, name and look for everyone. A phone's
  roster has its own full entry and, for everyone else, `[id, 0, null, "", look]`. A monster is `[id, 1, null, kind, null]`.

### JSON, client → server

- `{"t":"ping","c":<client ms>}` every 2 s (both roles). The server closes a socket silent for 15 s.
- Host commands `{"t":"cmd","op":…}`: `npc` (`on`, `n` ≤ 8, `kind`), `freeze` (`on`), `map` (`map`), `respawn`,
  `kick` (`pid`; also call `live_kick` — the room bans the player only in memory), `say` (`data`, ≤ 4 KB, broadcast to
  all), `zones`, `stats` (`reset`), `end`, `sync` (a mode reads the live game's state at once).
- **Modes.** The room takes its mode from the host's `live_host_state` at opening (`settings.mode`,
  `backend/live_move_modes.make_mode`): `"stand"` is «Встань на ответ» (docs/live/MODE_STAND.md: its map, hooks and
  `"t":"stand"` messages); a battle game (`"boss"`) gets the plain room.

### Map

```jsonc
{"w": 1600, "h": 900,                              // 200…6000 each
 "solids": [{"rect": [x, y, w, h]}, {"circle": [x, y, r]}],      // ≤ 64
 "zones":  [{"id": "A", "rect": [x, y, w, h]}],                  // ≤ 16, not solid; the first containing one counts
 "spawns": [[x, y]], "npc_spawns": [[x, y]]}                     // ≤ 64 / 16
```
`live_move.default_map()` is the reference: answer zones A–D in the corners, two walls, two bars and a pillar.

## 5. Limits

| what | limit |
|---|---|
| sockets in the process | 300 (`LIVE_MOVE_MAX_CONNS`) |
| sockets per address | 150 (`LIVE_MOVE_MAX_PER_IP`; the address is `ratelimit.visitor_ip`, the one before HF's proxy) |
| sockets before their hello | 64; hello within 5 s, ≤ 1 KB |
| rooms | 8 (`LIVE_MOVE_MAX_ROOMS`); players a room 60; host screens a room 3 |
| frames | uvicorn refuses > 64 KB (`--ws-max-size`); the room: input ≤ 64 B, a player's text ≤ 256 B, the host's ≤ 64 KB |
| rates per socket | input frames 30/s (burst 20); commands 21/s (burst 12) — no faster than the tick; text 5/s (burst 10); refused frames beyond a burst of 60 (5/s allowed) → 4429 |
| slow readers | snapshots are replaced, never queued; 64 waiting JSON messages → 4429 |
| `Origin` | none (a native client), the page's own host, or `LIVE_MOVE_ORIGINS` |

uvicorn runs without permessage-deflate (Dockerfile). Deflate would halve the snapshot bytes but cost ~25 % more CPU.

## 6. Load test (2026-10-21, this repo's container, 4 × Xeon 2.1 GHz shared with other jobs, load average 3.5–5.9)

`backend/scripts/live_move_load.py` against `scripts/live_move_loadapp.py` (main.app with the token check mocked),
through the repo's `nginx.conf` on a local port. Each phone always moves, sends 20 commands/s in 15 frames/s, pings
every 2 s and reads every snapshot. One projector and one chasing monster per room. Measured after an 8 s warm-up.

| run | server CPU (1 core) | RSS | nginx CPU | tick work p50/p99/max | tick lateness p50/p99/max | input→snapshot p50/p95/p99 |
|---|---|---|---|---|---|---|
| 40 phones, 120 s, shipped flags (no deflate) | 9.4 % (peak 11.0) | 109 MB (+0.3 over the run) | 3.0 % | 0.52 / 1.46 / 5.6 ms | 0.29 / 5.0 / 62 ms | 89 / 148 / 164 ms |
| 40 phones, 120 s, deflate on, gc.freeze | 11.3 % (peak 14.0) | 112 MB | 2.8 % | 0.54 / 2.1 / 9.2 ms | 0.36 / 8.6 / 50 ms | 89 / 151 / 164 ms |
| 40 phones, 120 s, deflate on, before gc.freeze | 10.4 % | 112 MB | 2.5 % | 0.52 / 2.4 / 37 ms | 0.36 / 7.5 / 97 ms | 96 / 155 / 170 ms |
| 3 rooms × 49 phones, 45 s, no deflate | 26.8 % (peak 28.8) | 114 MB | 8.8 % | 0.6 / 2.2 / 9 ms | ≤ 1.1 / ≤ 6.9 / ≤ 12 ms | 92 / 151 / 169 ms |

- No errors, no skipped snapshots, no dropped commands, no overruns in any run. The 3-room run asked for 3 × 60. All
  the load came from 127.0.0.1, so the per-address cap let 147 phones in and closed the rest with 4429, as designed.
- Snapshot payload per phone: 344 bytes × 10/s = **3.4 KB/s** with 40 players (5 KB/s with 60), plus 4 bytes of
  WebSocket header per frame. Deflate would make it ~1.8 KB/s. Text (pongs, events) ~65 B/s. Uplink 15 × 9–12 bytes/s.
- Snapshot arrival gaps at the phone: p50 100 ms, p99 112 ms.
- Input→snapshot is the time from sending a command to the first snapshot whose ack covers it. It is the sum of the
  wait for the next tick (0–50 ms), a queued second command of a 2-command frame (+50 ms), and the wait for the next
  snapshot tick (0–50 ms). The phone does not feel it (prediction). Other players appear ~100 ms + this behind.
  Sending at 20 Hz (one command per frame) would cut ~25 ms.
- The 37 ms worst tick before `gc.freeze()` was a full garbage collection walking ~150 000 import-time objects
  (~115 ms measured alone). `main.py` freezes them at startup. The remaining worst-case lateness (50–62 ms, once in a
  run, with tick work ≤ 6 ms) is the event loop or the shared machine, not the tick.

**What the Space can take (estimate, not measured on HF).** HF CPU Basic has 2 vCPU and 16 GB (meldy-notes
`10_Project/Cost_and_Scale_2026-10-11.md`, from HF's pricing page). Python uses one vCPU, nginx the other. Measured
cost: ~0.2 % of a vCPU per phone in uvicorn and ~0.07 % in nginx. If HF's vCPU is about as fast as this one: 150
phones ≈ 30 %, 300 (the cap) ≈ 60 % of the Python core, beside the rest of the app. If it is twice as slow, 300 phones
is ~120 % and ticks would lag. So plan for **~150–200 phones at once** (3 rooms of 60, or 6 classes of 30) until
`stats` from a real game on the Space says otherwise. Memory is no concern (rooms are a few KB).

## 7. Risks and open items

- **The HF proxy is unverified.** HF documents a single HTTPS port but no WebSocket timeouts. Community reports include
  WebSocket handshakes answered 404 on some Spaces. The first deploy must run
  `LIVE_MOVE_PROBE_HOST_TOKEN=<a host token> python backend/scripts/live_move_load.py --url wss://ludosiel-studyforge.hf.space/api/live/move/ws --probe <game id> --seconds 120`.
  It shows whether the handshake passes and whether the socket survives 2 minutes. The app keeps sockets busy anyway:
  10 snapshots/s down, pings every 2 s up, and uvicorn pings every 20 s.
- **One process, one event loop.** Rooms share the event loop with the rest of the API. Uploads are parsed in threads,
  but pure-Python parsing still takes the GIL and can add a few ms of tick jitter while a lecture is analysed. A
  release or a Space sleep restarts the process and drops every room (clients reconnect; positions restart at spawn).
- **Scaling past one process** needs sticky routing by game, because a room lives in one process. A second uvicorn on
  another port with nginx choosing by a `game` query parameter, or a separate Space for games. Not needed below
  ~150–200 phones.
- **Kicks are two calls.** The host screen calls `live_kick` (the database) and sends `kick` (the room). A kick from
  another screen reaches the room only through the player's next reconnect check, because the room caches the token.
- **Fairness of catches.** A phone shows its own character ~100 ms ahead of the server and others ~190 ms behind. Modes
  with catching or tagging should use a lenient radius or show the server's verdict (`ev caught`) prominently.

## 8. For mode builders

```ts
import { MoveClient } from '../lib/live/move'; // from a page in src/pages/
const client = new MoveClient({ game, token, role: 'player', onEvent, onStatus });
client.connect();
stick.onMove((x, y) => client.setJoystick(x, y));         // [-1, 1], +y down
requestAnimationFrame(function draw() {
  const { me, others } = client.frame();                   // me: predicted; others: 100 ms behind
  // draw client.map (rects, circles, zones), me and others; client.roster gives looks (and names for the host)
  requestAnimationFrame(draw);
});
// host: client.command({ op: 'npc', on: true }) · { op: 'freeze', on: true } · { op: 'zones' } · { op: 'say', data } …
```

- Answer zones: put zones in the map, then read `zones` (host) when the question closes. Flags carry each player's
  zone in every snapshot, so the projector can light the zones live.
- Mode state (question, timer, score) stays in the `live_*` SQL and the host screen. Use `say` to push short mode data
  to the phones; anything authoritative about movement (freeze, respawn, monsters, map) is a host command.
- A new rule that changes movement (speed, a dash button, player-player collision) must change `live_move.py` and
  `sim.ts` together and regenerate `contracts/live/move_cases.json`
  (`python backend/tests/test_live_move.py --write-cases`).
