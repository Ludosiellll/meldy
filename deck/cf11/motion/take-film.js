// The stage deck's films of TODAY's app (13.11, the owner's review: «ролики нужны актуальные», «хотелось бы, чтобы
// больше видно было, а потом уже приближал к нужному»). A film is cut from a take of the local copy of the app
// (tools/record/local.cjs, take_footage.py): its frames at a constant rate and take.js with the marks, the boxes of
// each beat, the presses and the pointer's way. The take is shot at the film's own shape (1840 × 728 CSS px), so the
// whole screen fills the picture: every film opens on it and the camera then goes to the part the talk is about.
// The pointer is drawn by the film (the screencast has none), with a ring where it presses.
//
//   takeFilm({
//     footage: '../media/gen/footage/<name>/',  // m-0001.jpg … and take.js (window.TAKE), loaded before this call
//     T, seam,                                  // the film's length and the loop's dissolve, s
//     pieces: [{ f0, m0, m1, fade }],           // from film second f0 the take runs m0 → m1 (its seconds) in real time,
//                                               // then holds its last frame; `fade`: it comes in over that long
//     cam0: [x, y, w],                          // the camera's first view, CSS px of the page (default: the whole screen)
//     moves: [{ at, dur, box, ease }],          // the camera goes to `box` over `dur` from film second `at`
//     caps: [{ from, to, text }],
//     spots: [{ from, to, box: [x0, y0, x1, y1], a, radius }],
//     pointer: true,                            // draw the pointer (false for a phone)
//     poster,                                   // ms; 0 by default: PowerPoint shows the poster before the film starts,
//                                               // so it must be the film's first frame
//   })
// Helpers for a film's config: takeFilm.whole() (the whole screen), takeFilm.fit(rect, { pad, minW, maxW }) (the
// camera's box around a rectangle of the page, inside the screen), takeFilm.mark(name), takeFilm.box(name).
(() => {
  const W = 1840, WIN_H = 728, H = 808, ASPECT = W / WIN_H;
  const take = () => window.TAKE;
  const whole = () => [0, 0, take().view[0]];
  const mark = (name) => { const v = take().marks[name]; if (v == null) throw new Error(`no mark ${name}`); return v; };
  const box = (name) => { const v = take().boxes[name]; if (!v) throw new Error(`no box ${name}`); return v; };
  function fit(rect, { pad = 48, minW = 760, maxW = Infinity } = {}) {
    const [vw, vh] = take().view;
    const [x0, y0, x1, y1] = rect;
    let w = Math.max(minW, x1 - x0 + 2 * pad, (y1 - y0 + 2 * pad) * ASPECT);
    w = Math.min(w, maxW, vw, vh * ASPECT);
    const h = w / ASPECT;
    const x = Math.min(Math.max((x0 + x1) / 2 - w / 2, 0), vw - w);
    const y = Math.min(Math.max((y0 + y1) / 2 - h / 2, 0), vh - h);
    return [x, y, w];
  }

  window.takeFilm = (cfg) => {
    const { clamp, E, seg, mix } = window.M;
    const TK = take();
    const K = TK.k;
    const stage = document.getElementById('stage');
    stage.innerHTML = `
      <div class="win"><img id="fA" alt=""><img id="fB" alt=""><div class="spot" id="spot"></div><div class="tap" id="tap"></div>
        <svg class="ptr" id="ptr" viewBox="0 0 28 40"><path d="M3 2 L3 31 L10.6 24.4 L15.4 36.2 L20.6 34 L15.8 22.6 L25.6 22.6 Z" fill="#0b121c" stroke="#fff" stroke-width="2.4" stroke-linejoin="round"/></svg></div>
      <div class="cap" id="capA"><i></i><span></span></div><div class="cap" id="capB"><i></i><span></span></div>`;
    const $ = (id) => document.getElementById(id);
    const T = cfg.T, SEAM = cfg.seam ?? 0.5;
    const cam0 = cfg.cam0 ?? whole();
    const frameOf = (m) => `m-${String(clamp(Math.round(m * TK.fps) + 1, 1, TK.frames)).padStart(4, '0')}.jpg`;
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
      if (p.fade && t < p.f0 + p.fade) return { base: at(i - 1), over: at(i), w: (t - p.f0) / p.fade, live: at(i) };
      return { base: at(i), over: null, w: 0, live: at(i) };
    }
    function camera(t) {
      let b = cam0;
      for (const mv of cfg.moves ?? []) {
        if (t <= mv.at) break;
        const p = seg(t, mv.at, mv.at + mv.dur, mv.ease ?? E.inOut3);
        b = b.map((v, k) => mix(v, mv.box[k], p));
      }
      return b;
    }
    const place = (img, [x, y, w]) => {
      const s = W / (w * K);
      img.style.transform = `translate3d(${(-x * K * s).toFixed(3)}px, ${(-y * K * s).toFixed(3)}px, 0) scale(${s.toFixed(5)})`;
    };
    /** The pointer at take second m: between the two logged points around it. */
    const path = TK.path ?? [];
    function pointerAt(m) {
      if (!path.length || m < path[0][0]) return null;
      let lo = 0, hi = path.length - 1;
      while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (path[mid][0] <= m) lo = mid; else hi = mid - 1; }
      const a = path[lo], b = path[Math.min(lo + 1, path.length - 1)];
      const p = b[0] > a[0] ? clamp((m - a[0]) / (b[0] - a[0])) : 0;
      return [mix(a[1], b[1], p), mix(a[2], b[2], p)];
    }
    const caps = [$('capA'), $('capB')];

    async function seek(ms) {
      const t = (((ms / 1000) % T) + T) % T;
      const seam = t >= T - SEAM ? (t - (T - SEAM)) / SEAM : 0;
      const f = footage(t);
      const b = camera(t);
      await show('fA', frameOf(f.base));
      place($('fA'), b);
      if (seam) {              // the loop: the first frame under the first camera comes in over the last one
        await show('fB', frameOf(cfg.pieces[0].m0));
        place($('fB'), cam0);
        $('fB').style.opacity = String(seam);
      } else if (f.over != null) {
        await show('fB', frameOf(f.over));
        place($('fB'), b);
        $('fB').style.opacity = String(f.w);
      } else $('fB').style.opacity = '0';

      const s = W / b[2];
      const toWin = (x, y) => [(x - b[0]) * s, (y - b[1]) * s];
      const m = f.live;

      const ptr = $('ptr');
      const at = cfg.pointer === false ? null : pointerAt(m);
      if (at) {
        const [px, py] = toWin(at[0], at[1]);
        ptr.style.transform = `translate3d(${px.toFixed(2)}px, ${py.toFixed(2)}px, 0)`;
        ptr.style.opacity = String((1 - seam) * (f.over != null ? clamp(f.w * 2 - 1) : 1));
      } else ptr.style.opacity = '0';

      const tap = $('tap');
      let tapO = 0;
      for (const pr of [...(TK.presses ?? []), ...(TK.taps ?? [])]) {
        const x = (m - pr.t) / 0.6;
        if (x < 0 || x > 1) continue;
        const [px, py] = toWin(pr.x, pr.y);
        tapO = (x < 0.15 ? x / 0.15 : 1 - E.out3((x - 0.15) / 0.85)) * (1 - seam);
        tap.style.transform = `translate3d(${px.toFixed(2)}px, ${py.toFixed(2)}px, 0) scale(${mix(0.4, 1.35, E.out3(x)).toFixed(3)})`;
      }
      tap.style.opacity = String(tapO);

      const spot = $('spot');
      const lit = (cfg.spots ?? []).find((sp) => t >= sp.from && t < sp.to + 0.45);
      if (lit) {
        const a = (lit.a ?? 0.14) * Math.min(seg(t, lit.from, lit.from + 0.6, E.inOut3), 1 - seg(t, lit.to, lit.to + 0.45, E.inOut3)) * (1 - seam);
        const [x0, y0, x1, y1] = lit.box;
        const [lx, ly] = toWin(x0, y0);
        Object.assign(spot.style, {
          left: `${lx.toFixed(2)}px`, top: `${ly.toFixed(2)}px`, width: `${((x1 - x0) * s).toFixed(2)}px`, height: `${((y1 - y0) * s).toFixed(2)}px`,
          borderRadius: `${(lit.radius ?? 24) * s}px`, boxShadow: `0 0 0 4000px rgba(11, 15, 22, ${a.toFixed(4)})`,
        });
      } else spot.style.boxShadow = '0 0 0 4000px rgba(11, 15, 22, 0)';

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
    window.__clip = { T: T * 1000, seek, width: W, height: H, poster: cfg.poster ?? 0, loop: true };
    seek(window.__clip.poster);
  };
  Object.assign(window.takeFilm ?? {}, {});
  window.takeFilmTools = { whole, fit, mark, box, ASPECT };
})();
