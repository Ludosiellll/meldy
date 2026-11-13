// The deck's «screen film» (the stage copy, 13.11): one recording of the site fills the film's width, a camera moves
// over it to the place the talk is about, a caption under the picture says what happens. A film is a config; this
// file turns it into window.__clip (see render.mjs). Everything is a function of time.
//
//   screenFilm({
//     footage: '../media/gen/footage/<name>/',   // m-0001.jpg …: the master at `fps`, cut by ffmpeg (ignored by git)
//     frames, fps, src: [w, h],                  // the master's frames and their size, px
//     T, seam,                                   // the film's length and the loop's dissolve, s
//     pieces: [{ f0, m0, m1, fade }],            // from film second f0 the master runs m0 → m1 in real time, then
//                                                // holds its last frame; `fade`: it comes in over that long
//     cam0: [x, y, w],                           // the camera at the start: the master's px it shows (the height
//                                                // follows from the window's shape)
//     moves: [{ at, dur, box: [x, y, w] }],      // the camera goes to `box` over `dur` from `at`, film seconds
//     caps: [{ from, to, text }],
//     taps: [{ f, x, y }],                       // a press: film second, the master's px
//     spots: [{ from, to, box: [x, y, w, h], a }], // a lit part of the screen (the rest dims by `a`), the master's px
//     poster,                                    // ms
//   })
window.screenFilm = (cfg) => {
  const { clamp, E, seg, mix } = window.M;
  const W = 1840, WIN_H = 728, H = 808;
  const stage = document.getElementById('stage');
  stage.innerHTML = `
    <div class="win"><img id="fA" alt=""><img id="fB" alt=""><div class="spot" id="spot"></div><div class="tap" id="tap"></div></div>
    <div class="cap" id="capA"><i></i><span></span></div><div class="cap" id="capB"><i></i><span></span></div>`;
  const $ = (id) => document.getElementById(id);
  const [SW] = cfg.src;
  const T = cfg.T, SEAM = cfg.seam ?? 0.5;
  const frameOf = (m) => `m-${String(clamp(Math.round(m * cfg.fps) + 1, 1, cfg.frames)).padStart(4, '0')}.jpg`;
  const shown = { fA: '', fB: '' };
  async function show(id, file) {
    const img = $(id);
    if (shown[id] !== file) { shown[id] = file; img.src = cfg.footage + file; }
    if (!img.complete || img.naturalWidth === 0) await img.decode().catch(() => undefined);
  }
  function footage(t) {
    let i = 0;
    while (i + 1 < cfg.pieces.length && cfg.pieces[i + 1].f0 <= t) i += 1;
    const at = (k) => Math.min(cfg.pieces[k].m0 + Math.max(0, t - cfg.pieces[k].f0), cfg.pieces[k].m1);
    const p = cfg.pieces[i];
    if (p.fade && t < p.f0 + p.fade) return { base: at(i - 1), over: at(i), w: (t - p.f0) / p.fade };
    return { base: at(i), over: null, w: 0 };
  }
  function camera(t) {
    let box = cfg.cam0;
    for (const mv of cfg.moves) {
      if (t <= mv.at) break;
      const p = seg(t, mv.at, mv.at + mv.dur, mv.ease ?? E.inOut3);
      box = box.map((v, k) => mix(v, mv.box[k], p));
    }
    return box;
  }
  const place = (img, [x, y, w]) => {
    const s = W / w;
    img.style.transform = `translate3d(${(-x * s).toFixed(3)}px, ${(-y * s).toFixed(3)}px, 0) scale(${s.toFixed(5)})`;
  };
  const caps = [$('capA'), $('capB')];

  async function seek(ms) {
    const t = (((ms / 1000) % T) + T) % T;
    const seam = t >= T - SEAM ? (t - (T - SEAM)) / SEAM : 0;
    const f = footage(t);
    const box = camera(t);
    await show('fA', frameOf(f.base));
    place($('fA'), box);
    if (seam) {            // the loop: the first frame, under the first camera, comes in over the last one
      await show('fB', frameOf(cfg.pieces[0].m0));
      place($('fB'), cfg.cam0);
      $('fB').style.opacity = String(seam);
    } else if (f.over != null) {
      await show('fB', frameOf(f.over));
      place($('fB'), box);
      $('fB').style.opacity = String(f.w);
    } else $('fB').style.opacity = '0';

    const s = W / box[2];
    const tap = $('tap');
    let tapO = 0;
    for (const tp of cfg.taps ?? []) {
      const x = (t - tp.f) / 0.6;
      if (x < 0 || x > 1) continue;
      tapO = (x < 0.15 ? x / 0.15 : 1 - E.out3((x - 0.15) / 0.85)) * (1 - seam);
      tap.style.transform = `translate3d(${((tp.x - box[0]) * s).toFixed(2)}px, ${((tp.y - box[1]) * s).toFixed(2)}px, 0) scale(${mix(0.4, 1.35, E.out3(x)).toFixed(3)})`;
    }
    tap.style.opacity = String(tapO);

    const spot = $('spot');
    const lit = (cfg.spots ?? []).find((sp) => t >= sp.from && t < sp.to + 0.45);
    if (lit) {
      const a = (lit.a ?? 0.34) * Math.min(seg(t, lit.from, lit.from + 0.6, E.inOut3), 1 - seg(t, lit.to, lit.to + 0.45, E.inOut3)) * (1 - seam);
      const [x, y, w, h] = lit.box;
      Object.assign(spot.style, {
        left: `${((x - box[0]) * s).toFixed(2)}px`, top: `${((y - box[1]) * s).toFixed(2)}px`, width: `${(w * s).toFixed(2)}px`, height: `${(h * s).toFixed(2)}px`,
        borderRadius: `${(lit.radius ?? 28) * s}px`, boxShadow: `0 0 0 3000px rgba(11, 15, 22, ${a.toFixed(4)})`,
      });
    } else spot.style.boxShadow = '0 0 0 3000px rgba(11, 15, 22, 0)';

    const now = cfg.caps.filter((c) => t >= c.from && t < c.to + 0.26);
    caps.forEach((el, k) => {
      const c = now[k];
      if (!c) { el.style.opacity = '0'; return; }
      const inP = seg(t, c.from, c.from + 0.5, E.meldy);
      const out = c.to >= T ? 1 - seam : 1 - clamp((t - c.to) / 0.24);
      el.querySelector('span').textContent = c.text;
      el.style.opacity = String(clamp((t - c.from) / 0.22) * out);
      el.style.transform = `translate3d(0, ${((1 - inP) * 14).toFixed(2)}px, 0)`;
    });
  }
  window.__clip = { T: T * 1000, seek, width: W, height: H, poster: cfg.poster, loop: true, winH: WIN_H, SW };
  seek(cfg.poster);
};
