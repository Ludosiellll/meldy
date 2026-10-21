# Licences of the live games' recorded sounds

Checked on 2026-10-21 on the authors' own pages and in the licence file of each download. Nothing here needs
payment. CC0 needs no credit; we credit the authors anyway.

These files are imported by `../sound.ts`; the build copies them to `/assets/<name>-<hash>.mp3` (a year in the
cache, nginx `location /assets/`). Each is under 96 KB (the Space refuses a pushed binary over 100 KB,
`backend/tests/test_space_binaries.py`). MP3 because every browser decodes it in WebAudio, Safari included.

| File | Used for | Source file | Author | Licence | Source |
|---|---|---|---|---|---|
| `punch.mp3` (8.3 KB) | the blow on the bar; the boss landing in «Встань на ответ» | `impactPunch_heavy_000.ogg` | Kenney (www.kenney.nl) | CC0 1.0 | Impact Sounds 1.0, https://kenney.nl/assets/impact-sounds |
| `rock1.mp3` (11.7 KB) | the floor collapsing (debris), the monster's fall | `impactMining_000.ogg` | Kenney | CC0 1.0 | Impact Sounds 1.0 |
| `rock2.mp3` (11.1 KB) | the same, a second stone | `impactMining_001.ogg` | Kenney | CC0 1.0 | Impact Sounds 1.0 |
| `plank.mp3` (9.8 KB) | the floor's tiles settling back | `impactPlank_medium_000.ogg` | Kenney | CC0 1.0 | Impact Sounds 1.0 |
| `glass.mp3` (5.9 KB) | the ice: freezing, shattering | `impactGlass_heavy_001.ogg` | Kenney | CC0 1.0 | Impact Sounds 1.0 |
| `bell.mp3` (18.1 KB) | «Время вышло» | `impactBell_heavy_000.ogg` | Kenney | CC0 1.0 | Impact Sounds 1.0 |
| `applause.mp3` (40.8 KB) | the cheer for those who stood, the fanfare | `applause-clapping-church-crowd-immersive.wav`, 6.0–9.4 s | eXpl0it3r | CC0 1.0 | https://opengameart.org/content/applause-in-a-large-hall-or-church |

What we changed: the Kenney sounds mixed to mono, the silence before the hit cut, the peak set to −1 dBFS, a short
fade at the end, encoded as 96 kbps MP3 (ffmpeg, libmp3lame, 44.1 kHz). The applause: 3.4 s cut from the steady
middle of the recording, a 60 ms fade in and a 1.5 s fade out, stereo 96 kbps MP3.

Everything else the games play — the music, the drums and instruments, the boss's jump, the floor's rumble, the
ghosts, the alarm clock — is made on the device by `../synth.ts`, `../music.ts` and `../sound.ts`: our own work.

## Licence lines, quoted

- Kenney Impact Sounds, `License.txt` in the download: "License: (Creative Commons Zero, CC0)
  http://creativecommons.org/publicdomain/zero/1.0/ This content is free to use in personal, educational and
  commercial projects. Support us by crediting Kenney or www.kenney.nl (this is not mandatory)". The asset page says
  "Creative Commons CC0".
- OpenGameArt, «Applause in a large hall or church» by eXpl0it3r: the page's licence field reads "CC0". Its
  description: "Immersive applause by a crowd inside a church shortly before the beginning of a concert."
