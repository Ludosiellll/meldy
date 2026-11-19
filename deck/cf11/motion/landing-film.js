// The landing page's clips of the app (frontend/src/lib/footage.ts LANDING_*_WIDE), cut from the same takes as the
// stage deck's films (take-film.js: tools/record/local.cjs, take_footage.py). The owner, 19.11, on the clips that
// stood there: «там все резко и ничего не понятно» — a 1280 × 800 page shrunk into a tile, six or seven hard cuts in
// fourteen seconds. Here a clip is three or four steps, each numbered and named under the picture; the camera stays
// close (a tile shows the clip at half its size, so a word is legible only when the page is enlarged), moves with an
// eased push, and one step dissolves into the next.
//
//   landingFilm({
//     footage: '../media/gen/footage/<name>/',  // m-0001.jpg … and take.js (window.TAKE), loaded before this call
//     stage: [W, H],                            // the clip's frame, px
//     win: [x, y, w, h],                        // the recording's window in it; its shape is the camera's
//     T, seam,                                  // the clip's length and the loop's dissolve, s
//     pieces: [{ f0, m0, m1, fade }],           // as in take-film.js (cuts() makes them)
//     cam0: [x, y, w], moves: [{ at, dur, box, ease }],
//     steps: [{ from, to, text }],              // the numbered captions, in order
//     spots: [{ from, to, box: [x0, y0, x1, y1], a, radius }],
//   })
// Helpers: landingFilmTools(win) → { box(x, y, w) checked against the screen, mark, cuts }.
(() => {
  const take = () => window.TAKE;
  const mark = (name) => { const v = take().marks[name]; if (v == null) throw new Error(`no mark ${name}`); return v; };
  function cuts(list) {
    const pieces = [];
    let at = 0;
    for (const [m0, m1, fade] of list) {
      const f0 = fade ? at - fade : at;
      pieces.push({ f0, m0, m1, fade });
      at = f0 + (m1 - m0);
    }
    return { pieces, end: at, F: (i, m) => pieces[i].f0 + (m - pieces[i].m0) };
  }
  window.landingFilmTools = (win) => {
    const aspect = win[2] / win[3];
    /** A camera box that lies inside the recorded screen (an error names one that does not). */
    const box = (x, y, w) => {
      const [vw, vh] = take().view;
      const h = w / aspect;
      if (x < 0 || y < 0 || x + w > vw + 0.01 || y + h > vh + 0.01) throw new Error(`box [${x}, ${y}, ${w}] (h ${h.toFixed(0)}) leaves the ${vw}×${vh} screen`);
      return [x, y, w];
    };
    return { box, mark, cuts, aspect };
  };

  window.landingFilm = (cfg) => {
    const { clamp, E, seg, mix } = window.M;
    const TK = take();
    const K = TK.k;
    const [W, H] = cfg.stage;
    const [wx, wy, ww, wh] = cfg.win;
    const stage = document.getElementById('stage');
    stage.style.width = `${W}px`;
    stage.style.height = `${H}px`;
    const capY = wy + wh + (H - wy - wh) / 2;
    stage.innerHTML = `
      <div class="win" style="left:${wx}px;top:${wy}px;width:${ww}px;height:${wh}px"><img id="fA" alt=""><img id="fB" alt=""><div class="spot" id="spot"></div><div class="tap" id="tap"></div>
        <svg class="ptr" id="ptr" viewBox="0 0 28 40"><path d="M3 2 L3 31 L10.6 24.4 L15.4 36.2 L20.6 34 L15.8 22.6 L25.6 22.6 Z" fill="#0b121c" stroke="#fff" stroke-width="2.4" stroke-linejoin="round"/></svg></div>
      <div class="cap" id="capA" style="left:${wx + 8}px;top:${capY}px"><b></b><span></span></div>
      <div class="cap" id="capB" style="left:${wx + 8}px;top:${capY}px"><b></b><span></span></div>
      <div class="dots" id="dots" style="right:${W - wx - ww + 10}px;top:${capY}px">${cfg.steps.map(() => '<i></i>').join('')}</div>`;
    const $ = (id) => document.getElementById(id);
    const T = cfg.T, SEAM = cfg.seam ?? 0.5;
    const cam0 = cfg.cam0;
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
    /** The camera at t; `cut: true` on a move makes it the view of everything from `at` on (a new step's own first view). */
    function camera(t) {
      let b = cam0;
      for (const mv of cfg.moves ?? []) {
        if (t <= mv.at) break;
        const p = mv.cut ? 1 : seg(t, mv.at, mv.at + mv.dur, mv.ease ?? E.inOut3);
        b = b.map((v, k) => mix(v, mv.box[k], p));
      }
      return b;
    }
    /** The view a dissolve comes from: the camera just before the cut move at the new piece's start. */
    function cameraBefore(t, piece) {
      const cutMove = (cfg.moves ?? []).find((mv) => mv.cut && Math.abs(mv.at - piece.f0) < 0.001);
      return cutMove ? camera(cutMove.at) : camera(t);
    }
    const place = (img, [x, y, w]) => {
      const s = ww / (w * K);
      img.style.transform = `translate3d(${(-x * K * s).toFixed(3)}px, ${(-y * K * s).toFixed(3)}px, 0) scale(${s.toFixed(5)})`;
    };
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
    const dots = [...$('dots').children];

    async function seek(ms) {
      const t = (((ms / 1000) % T) + T) % T;
      const seam = t >= T - SEAM ? (t - (T - SEAM)) / SEAM : 0;
      const f = footage(t);
      let i = 0;
      while (i + 1 < cfg.pieces.length && cfg.pieces[i + 1].f0 <= t) i += 1;
      const b = camera(t);
      if (seam) {              // the loop: the first frame under the first camera comes in over the last one
        await show('fA', frameOf(f.base));
        place($('fA'), b);
        await show('fB', frameOf(cfg.pieces[0].m0));
        place($('fB'), cam0);
        $('fB').style.opacity = String(seam);
      } else if (f.over != null) {   // a dissolve: the step before under its own last view, the new one over it
        await show('fA', frameOf(f.base));
        place($('fA'), cameraBefore(t, cfg.pieces[i]));
        await show('fB', frameOf(f.over));
        place($('fB'), b);
        $('fB').style.opacity = String(E.inOut3(f.w));
      } else {
        await show('fA', frameOf(f.base));
        place($('fA'), b);
        $('fB').style.opacity = '0';
      }

      const s = ww / b[2];
      const toWin = (x, y) => [(x - b[0]) * s, (y - b[1]) * s];
      const m = f.live;
      const fresh = f.over != null ? clamp(f.w * 2 - 1) : 1;   // what belongs to the new step shows in the dissolve's second half

      const ptr = $('ptr');
      const at = cfg.pointer === false ? null : pointerAt(m);
      if (at) {
        const [px, py] = toWin(at[0], at[1]);
        ptr.style.transform = `translate3d(${px.toFixed(2)}px, ${py.toFixed(2)}px, 0)`;
        ptr.style.opacity = String((1 - seam) * fresh);
      } else ptr.style.opacity = '0';

      const tap = $('tap');
      let tapO = 0;
      for (const pr of [...(TK.presses ?? []), ...(TK.taps ?? [])]) {
        const x = (m - pr.t) / 0.6;
        if (x < 0 || x > 1) continue;
        const [px, py] = toWin(pr.x, pr.y);
        tapO = (x < 0.15 ? x / 0.15 : 1 - E.out3((x - 0.15) / 0.85)) * (1 - seam) * fresh;
        tap.style.transform = `translate3d(${px.toFixed(2)}px, ${py.toFixed(2)}px, 0) scale(${mix(0.4, 1.35, E.out3(x)).toFixed(3)})`;
      }
      tap.style.opacity = String(tapO);

      const spot = $('spot');
      const lit = (cfg.spots ?? []).find((sp) => t >= sp.from && t < sp.to + 0.45);
      if (lit) {
        const a = (lit.a ?? 0.16) * Math.min(seg(t, lit.from, lit.from + 0.6, E.inOut3), 1 - seg(t, lit.to, lit.to + 0.45, E.inOut3)) * (1 - seam);
        const [x0, y0, x1, y1] = lit.box;
        const [lx, ly] = toWin(x0, y0);
        Object.assign(spot.style, {
          left: `${lx.toFixed(2)}px`, top: `${ly.toFixed(2)}px`, width: `${((x1 - x0) * s).toFixed(2)}px`, height: `${((y1 - y0) * s).toFixed(2)}px`,
          borderRadius: `${(lit.radius ?? 24) * s}px`, boxShadow: `0 0 0 4000px rgba(11, 15, 22, ${a.toFixed(4)})`,
        });
      } else spot.style.boxShadow = '0 0 0 4000px rgba(11, 15, 22, 0)';

      // the numbered captions: one goes out as the next comes in; the dots at the right say which step of how many
      const now = cfg.steps.map((c, n) => ({ ...c, n })).filter((c) => t >= c.from && t < c.to + 0.26);
      caps.forEach((el, k) => {
        const c = now[k];
        if (!c) { el.style.opacity = '0'; return; }
        const inP = seg(t, c.from, c.from + 0.5, E.meldy);
        const out = c.to >= T ? 1 - seam : 1 - clamp((t - c.to) / 0.24);
        el.querySelector('b').textContent = String(c.n + 1);
        el.querySelector('span').textContent = c.text;
        el.style.opacity = String(clamp((t - c.from) / 0.22) * out);
        el.style.transform = `translate3d(0, ${((1 - inP) * 12).toFixed(2)}px, 0) translateY(-50%)`;
      });
      const active = cfg.steps.reduce((last, c, n) => (t >= c.from ? n : last), 0);
      dots.forEach((dot, n) => {
        const on = n === active ? (seam ? 1 - seam : clamp((t - cfg.steps[n].from) / 0.3)) : n === 0 && seam ? seam : 0;
        dot.style.width = `${mix(10, 30, E.inOut3(on)).toFixed(2)}px`;
        dot.style.background = on > 0.5 ? '#2869dd' : n < active ? 'rgba(11, 18, 28, .38)' : 'rgba(11, 18, 28, .16)';
      });
    }
    window.__clip = { T: T * 1000, seek, width: W, height: H, poster: cfg.poster ?? 0, loop: true };
    seek(window.__clip.poster);
  };
})();
