// Deck motion preview: draws one scene (the transition into a slide, its builds, the hold) at any time t, the way
// PowerPoint is expected to play the file. Deterministic (no clocks): window.__load(scene) then
// window.__seek(t, {overlay, label}) draws the frame at t ms; window.__clip = { T, seek } like motion/render.mjs.
// Scenes come from preview/scene.py (read back from the built PPTX); see preview/README.md for what is emulated.
(() => {
  'use strict';
  const SW = 1920, SH = 1080;
  const canvas = document.getElementById('stage');
  const ctx = canvas.getContext('2d');
  let S = null;                        // the scene
  let scale = 1;
  const ready = new Map();             // src -> decoded image
  const pending = new Map();           // src -> promise
  const order = [];                    // LRU of on-demand frames
  const offs = [];                     // offscreen canvases (crossfades, slide composites)

  // ------------------------------------------------------------------ images
  const url = (p) => (p.startsWith('file:') ? p : 'file://' + encodeURI(p));
  function load(src) {
    if (ready.has(src)) return Promise.resolve(ready.get(src));
    if (pending.has(src)) return pending.get(src);
    const im = new Image();
    const pr = new Promise((res) => {
      im.onload = () => im.decode().then(() => res(im), () => res(im));
      im.onerror = () => res(null);
    }).then((x) => { ready.set(src, x); pending.delete(src); return x; });
    im.src = url(src);
    pending.set(src, pr);
    return pr;
  }
  function remember(src) {
    order.push(src);
    while (order.length > 240) { const old = order.shift(); if (!order.includes(old)) ready.delete(old); }
  }
  function offscreen(i) {
    if (!offs[i]) { const c = document.createElement('canvas'); offs[i] = { c, x: c.getContext('2d') }; }
    const o = offs[i];
    if (o.c.width !== canvas.width || o.c.height !== canvas.height) { o.c.width = canvas.width; o.c.height = canvas.height; }
    o.x.setTransform(1, 0, 0, 1, 0, 0);
    o.x.clearRect(0, 0, o.c.width, o.c.height);
    o.x.setTransform(scale, 0, 0, scale, 0, 0);
    o.x.imageSmoothingQuality = 'high';
    return o;
  }

  // ------------------------------------------------------------------ maths
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, p) => a + (b - a) * p;
  // SMIL 2.0 time manipulations: accelerate a / decelerate d (fractions of the simple duration)
  function smil(u, a, d) {
    if (!a && !d) return u;
    const r = 1 / (1 - a / 2 - d / 2);
    if (a && u < a) return (r * u * u) / (2 * a);
    if (u <= 1 - d) return r * (u - a / 2);
    const v = 1 - u;
    return 1 - (r * v * v) / (2 * d);
  }
  // Morph's own curve is not documented: a symmetric ease-in-out (cubic) is assumed
  const easeInOut = (p) => (p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2);

  // PowerPoint animation formulas: numbers, #ppt_x/y/w/h (and without #), + - * / ^, ( ), $, pi, e, sin cos tan
  // abs sqrt min max
  function formula(src, vars) {
    if (src == null) return NaN;
    const s = String(src).trim();
    if (/^-?(\d+\.?\d*|\.\d+)(e-?\d+)?$/i.test(s)) return parseFloat(s);
    let i = 0;
    const peek = () => s[i];
    const ws = () => { while (i < s.length && /\s/.test(s[i])) i++; };
    function primary() {
      ws();
      const c = peek();
      if (c === '(') { i++; const v = expr(); ws(); i++; return v; }
      if (c === '-') { i++; return -primary(); }
      if (c === '+') { i++; return primary(); }
      const num = s.slice(i).match(/^(\d+\.?\d*|\.\d+)(e-?\d+)?/i);
      if (num) { i += num[0].length; return parseFloat(num[0]); }
      const id = s.slice(i).match(/^#?[A-Za-z_$][\w.$]*/);
      if (id) {
        i += id[0].length;
        const name = id[0].replace(/^#/, '');
        ws();
        if (peek() === '(') {
          i++;
          const args = [];
          ws();
          if (peek() !== ')') { args.push(expr()); ws(); while (peek() === ',') { i++; args.push(expr()); ws(); } }
          i++;
          const f = { sin: Math.sin, cos: Math.cos, tan: Math.tan, abs: Math.abs, sqrt: Math.sqrt, min: Math.min,
            max: Math.max, atan: Math.atan, asin: Math.asin, acos: Math.acos, ln: Math.log, rand: () => 0.5 }[name];
          return f ? f(...args) : NaN;
        }
        if (name === 'pi') return Math.PI;
        if (name === 'e') return Math.E;
        if (name in vars) return vars[name];
        return NaN;
      }
      i++;
      return NaN;
    }
    function power() { let v = primary(); ws(); while (peek() === '^') { i++; v = Math.pow(v, primary()); ws(); } return v; }
    function term() {
      let v = power(); ws();
      while (peek() === '*' || peek() === '/') { const op = s[i++]; const r = power(); v = op === '*' ? v * r : v / r; ws(); }
      return v;
    }
    function expr() {
      let v = term(); ws();
      while (peek() === '+' || peek() === '-') { const op = s[i++]; const r = term(); v = op === '+' ? v + r : v - r; ws(); }
      return v;
    }
    const v = expr();
    return Number.isFinite(v) ? v : NaN;
  }

  // ------------------------------------------------------------------ geometry
  function roundRectPath(c, w, h, radii) {
    const m = Math.min(w, h) / 2;
    const [tl, tr, br, bl] = radii.map((r) => clamp(r, 0, m));
    c.moveTo(tl, 0);
    c.lineTo(w - tr, 0); if (tr) c.arc(w - tr, tr, tr, -Math.PI / 2, 0);
    c.lineTo(w, h - br); if (br) c.arc(w - br, h - br, br, 0, Math.PI / 2);
    c.lineTo(bl, h); if (bl) c.arc(bl, h - bl, bl, Math.PI / 2, Math.PI);
    c.lineTo(0, tl); if (tl) c.arc(tl, tl, tl, Math.PI, Math.PI * 1.5);
    c.closePath();
  }
  function customPath(c, paths, sx, sy) {
    for (const cmds of paths) {
      let x = 0, y = 0;
      for (const [op, ...a] of cmds) {
        if (op === 'moveTo') { x = a[0] * sx; y = a[1] * sy; c.moveTo(x, y); }
        else if (op === 'lnTo') { x = a[0] * sx; y = a[1] * sy; c.lineTo(x, y); }
        else if (op === 'arcTo') {
          const rx = a[0] * sx, ry = a[1] * sy, st = (a[2] * Math.PI) / 180, sw = (a[3] * Math.PI) / 180;
          const cx = x - rx * Math.cos(st), cy = y - ry * Math.sin(st);
          c.ellipse(cx, cy, Math.max(rx, 0.001), Math.max(ry, 0.001), 0, st, st + sw, sw < 0);
          x = cx + rx * Math.cos(st + sw); y = cy + ry * Math.sin(st + sw);
        } else if (op === 'cubicBezTo') {
          c.bezierCurveTo(a[0] * sx, a[1] * sy, a[2] * sx, a[3] * sy, a[4] * sx, a[5] * sy); x = a[4] * sx; y = a[5] * sy;
        } else if (op === 'quadBezTo') {
          c.quadraticCurveTo(a[0] * sx, a[1] * sy, a[2] * sx, a[3] * sy); x = a[2] * sx; y = a[3] * sy;
        } else if (op === 'close') c.closePath();
      }
    }
  }
  // a geometry g = {kind: 'radii'|'ellipse'|'path'|'poly'|'rect', radii, path, bw, bh, poly}
  function geomOf(o) {
    if (o.radii) return { kind: 'radii', radii: o.radii.slice() };
    if (o.geom === 'ellipse') return { kind: 'ellipse' };
    if (o.path) return { kind: 'path', path: o.path, bw: o.w, bh: o.h };
    return { kind: 'rect' };
  }
  function tracePath(c, g, w, h) {
    c.beginPath();
    if (g.kind === 'radii') roundRectPath(c, w, h, g.radii);
    else if (g.kind === 'ellipse') c.ellipse(w / 2, h / 2, Math.max(w / 2, 0.001), Math.max(h / 2, 0.001), 0, 0, Math.PI * 2);
    else if (g.kind === 'path') customPath(c, g.path, w / Math.max(g.bw, 0.001), h / Math.max(g.bh, 0.001));
    else if (g.kind === 'poly') { g.poly.forEach(([px, py], k) => (k ? c.lineTo(px * w, py * h) : c.moveTo(px * w, py * h))); c.closePath(); }
    else c.rect(0, 0, w, h);
  }
  // outline sampled at N angles around the centre, in box fractions (for morphing unlike geometries)
  const N = 180;
  function outline(g, w, h) {
    const dense = [];
    const push = (x, y) => dense.push([x, y]);
    if (g.kind === 'ellipse') {
      for (let k = 0; k < 720; k++) { const a = (k / 720) * Math.PI * 2; push(w / 2 + (w / 2) * Math.cos(a), h / 2 + (h / 2) * Math.sin(a)); }
    } else if (g.kind === 'radii' || g.kind === 'rect') {
      const r = g.kind === 'rect' ? [0, 0, 0, 0] : g.radii.map((v) => clamp(v, 0, Math.min(w, h) / 2));
      const corner = (cx, cy, rad, a0) => { for (let k = 0; k <= 24; k++) { const a = a0 + (k / 24) * (Math.PI / 2); push(cx + rad * Math.cos(a), cy + rad * Math.sin(a)); } };
      const edge = (x0, y0, x1, y1) => { for (let k = 0; k <= 40; k++) push(lerp(x0, x1, k / 40), lerp(y0, y1, k / 40)); };
      edge(r[0], 0, w - r[1], 0); corner(w - r[1], r[1], r[1], -Math.PI / 2);
      edge(w, r[1], w, h - r[2]); corner(w - r[2], h - r[2], r[2], 0);
      edge(w - r[2], h, r[3], h); corner(r[3], h - r[3], r[3], Math.PI / 2);
      edge(0, h - r[3], 0, r[0]); corner(r[0], r[0], r[0], Math.PI);
    } else if (g.kind === 'path') {
      const sx = w / Math.max(g.bw, 0.001), sy = h / Math.max(g.bh, 0.001);
      for (const cmds of g.path) {
        let x = 0, y = 0;
        for (const [op, ...a] of cmds) {
          if (op === 'moveTo' || op === 'lnTo') {
            const nx = a[0] * sx, ny = a[1] * sy;
            if (op === 'lnTo') for (let k = 1; k <= 20; k++) push(lerp(x, nx, k / 20), lerp(y, ny, k / 20)); else push(nx, ny);
            x = nx; y = ny;
          } else if (op === 'arcTo') {
            const rx = a[0] * sx, ry = a[1] * sy, st = (a[2] * Math.PI) / 180, sw = (a[3] * Math.PI) / 180;
            const cx = x - rx * Math.cos(st), cy = y - ry * Math.sin(st);
            for (let k = 1; k <= 24; k++) { const t = st + (sw * k) / 24; push(cx + rx * Math.cos(t), cy + ry * Math.sin(t)); }
            x = cx + rx * Math.cos(st + sw); y = cy + ry * Math.sin(st + sw);
          }
        }
      }
    } else if (g.kind === 'poly') {
      return g.poly.map(([px, py]) => [px, py]);
    }
    // resample by angle from the centre (shapes here are convex)
    const cx = w / 2, cy = h / 2;
    const pts = dense.map(([x, y]) => ({ a: Math.atan2(y - cy, x - cx), x, y })).sort((p, q) => p.a - q.a);
    const out = [];
    for (let k = 0; k < N; k++) {
      const a = -Math.PI / 2 + (k / N) * Math.PI * 2;
      const aa = a > Math.PI ? a - 2 * Math.PI : a;
      let j = pts.findIndex((p) => p.a >= aa);
      if (j < 0) j = 0;
      const p1 = pts[j], p0 = pts[(j - 1 + pts.length) % pts.length];
      let span = p1.a - p0.a; if (span <= 0) span += Math.PI * 2;
      let f = aa - p0.a; if (f < 0) f += Math.PI * 2;
      const t = span > 1e-9 ? clamp(f / span, 0, 1) : 0;
      out.push([lerp(p0.x, p1.x, t) / w, lerp(p0.y, p1.y, t) / h]);
    }
    return out;
  }
  function lerpGeom(ga, gb, a, b, st, p) {
    if (ga.kind === 'radii' && gb.kind === 'radii') return { kind: 'radii', radii: ga.radii.map((r, k) => lerp(r, gb.radii[k], p)) };
    if (ga.kind === 'rect' && gb.kind === 'radii') return { kind: 'radii', radii: gb.radii.map((r) => lerp(0, r, p)) };
    if (ga.kind === 'radii' && gb.kind === 'rect') return { kind: 'radii', radii: ga.radii.map((r) => lerp(r, 0, p)) };
    if (ga.kind === gb.kind && ga.kind !== 'path') return { ...gb };
    if (p <= 0) return ga;
    if (p >= 1) return gb;
    const oa = outline(ga, a.w, a.h), ob = outline(gb, b.w, b.h);
    return { kind: 'poly', poly: oa.map(([x, y], k) => [lerp(x, ob[k][0], p), lerp(y, ob[k][1], p)]) };
  }
  const DASH = { dash: [4, 3], sysDash: [3, 1], sysDot: [1, 1], dot: [1, 3], lgDash: [8, 3], dashDot: [4, 3, 1, 3],
    lgDashDot: [8, 3, 1, 3], lgDashDotDot: [8, 3, 1, 3, 1, 3], sysDashDot: [3, 1, 1, 1], sysDashDotDot: [3, 1, 1, 1, 1, 1] };
  const rgba = (c, k = 1) => (c ? `rgba(${c[0]},${c[1]},${c[2]},${clamp(c[3] * k, 0, 1)})` : null);
  function lerpColor(a, b, p) {
    if (!a && !b) return null;
    const A = a || [b[0], b[1], b[2], 0], B = b || [a[0], a[1], a[2], 0];
    return [lerp(A[0], B[0], p), lerp(A[1], B[1], p), lerp(A[2], B[2], p), lerp(A[3], B[3], p)];
  }

  // ------------------------------------------------------------------ states
  // a drawable state: box (x,y,w,h), rot, flips, geometry, fill, line, opacity, wipe, and the content sources
  function baseState(o) {
    return { x: o.x, y: o.y, w: o.w, h: o.h, rot: o.rot || 0, flipH: !!o.flipH, flipV: !!o.flipV, g: geomOf(o),
      fill: o.fill, line: o.line, opacity: 1, wipe: null, o };
  }
  // the effects of the main sequence on one object at time t
  function effectState(o, t) {
    const st = baseState(o);
    const list = S.byTarget.get(o.key) || [];
    let visible = !o.buildsIn;
    if (o.buildsIn) {
      const first = list.find((x) => x.b.type === 'set' && x.b.attr.includes('style.visibility'))
        || list.slice().sort((p, q) => p.b.begin - q.b.begin)[0];
      visible = first ? t >= first.b.begin : true;
    }
    if (!visible) { st.hidden = true; return st; }
    const vars = { ppt_x: (o.x + o.w / 2) / SW, ppt_y: (o.y + o.h / 2) / SH, ppt_w: o.w / SW, ppt_h: o.h / SH };
    const cur = { ppt_x: vars.ppt_x, ppt_y: vars.ppt_y, ppt_w: vars.ppt_w, ppt_h: vars.ppt_h };
    let sx = 1, sy = 1;
    for (const { b, e } of list) {                          // list is sorted by begin: later ones override
      if (t < b.begin) continue;
      const p = progress(b, e, t);
      if (b.type === 'animEffect') {
        const f = (b.filter || '').trim();
        const k = b.transition === 'out' ? 1 - p : p;
        if (/^fade/.test(f)) st.opacity *= k;
        const m = f.match(/^wipe\((\w+)\)/);
        if (m) st.wipe = { dir: m[1], p: k };
      } else if (b.type === 'anim' && b.tav && b.tav.length) {
        for (const attr of b.attr) {
          if (!(attr in cur)) continue;
          const v = tavValue(b.tav, p, { ...vars, ...prefixed(vars) });
          if (Number.isFinite(v)) cur[attr] = v;
        }
      } else if (b.type === 'animScale') {
        const fr = b.from || [1, 1], to = b.to || (b.by ? [b.by[0], b.by[1]] : [1, 1]);
        sx = lerp(fr[0], to[0], p); sy = lerp(fr[1], to[1], p);
      }
    }
    const nw = cur.ppt_w * SW * sx, nh = cur.ppt_h * SH * sy;
    st.x = cur.ppt_x * SW - nw / 2; st.y = cur.ppt_y * SH - nh / 2; st.w = nw; st.h = nh;
    return st;
  }
  const prefixed = (v) => Object.fromEntries(Object.entries(v).map(([k, x]) => ['#' + k, x]));
  function tavValue(tav, p, vars) {
    const val = (k) => {
      const [, raw, fm] = tav[k];
      const v = formula(raw, vars);
      return fm ? formula(fm, { ...vars, $: v }) : v;
    };
    if (tav.length === 1) return val(0);
    for (let k = 0; k < tav.length - 1; k++) {
      const t0 = tav[k][0], t1 = tav[k + 1][0];
      if (p <= t1 || k === tav.length - 2) {
        const f = t1 > t0 ? clamp((p - t0) / (t1 - t0), 0, 1) : 1;
        const fm = tav[k][2];
        if (fm) return formula(fm, { ...vars, $: lerp(formula(tav[k][1], vars), formula(tav[k + 1][1], vars), f) });
        return lerp(val(k), val(k + 1), f);
      }
    }
    return val(tav.length - 1);
  }
  function progress(b, e, t) {
    let tt = t;
    if (e && (e.accel || e.decel) && e.dur > 0) {
      const u = clamp((t - e.begin) / e.dur, 0, 1);
      tt = e.begin + smil(u, e.accel, e.decel) * e.dur;
    }
    if (!(b.dur > 1)) return tt >= b.begin ? 1 : 0;
    return smil(clamp((tt - b.begin) / b.dur, 0, 1), b.accel, b.decel);
  }

  // ------------------------------------------------------------------ media clocks
  function mediaFor(list, key) { return (list || []).find((m) => m.key === key); }
  function videoSrc(o, m, clock) {
    if (!o.video || !m || clock < m.play) return o.img ? o.img.src : null;
    const v = o.video;
    let k = Math.floor(((clock - m.play) / 1000 + (m.from || 0)) * v.fps);
    k = m.loop ? ((k % v.n) + v.n) % v.n : Math.min(Math.max(k, 0), v.n - 1);
    return `${v.dir}/f${String(k + 1).padStart(5, '0')}.jpg`;
  }
  function gifSrc(o, clock) {
    const g = o.gif;
    let t = ((clock % g.total) + g.total) % g.total;
    for (let k = 0; k < g.frames.length; k++) { if (t < g.delays[k]) return g.frames[k]; t -= g.delays[k]; }
    return g.frames[g.frames.length - 1];
  }
  // which picture an object shows: side = 'cur' | 'prev'
  function pictureSrc(o, side, t) {
    if (o.video) {
      if (side === 'prev') return videoSrc(o, mediaFor(S.prevMedia, o.key), S.prevClock);   // frozen at the slide's end
      return videoSrc(o, mediaFor(S.media, o.key), t);
    }
    if (o.gif) return gifSrc(o, side === 'prev' ? S.prevClock + t : t);
    return o.img ? o.img.src : null;
  }

  // ------------------------------------------------------------------ drawing
  function local(c, st) {
    c.translate(st.x + st.w / 2, st.y + st.h / 2);
    if (st.rot) c.rotate((st.rot * Math.PI) / 180);
    c.scale(st.flipH ? -1 : 1, st.flipV ? -1 : 1);
    c.translate(-st.w / 2, -st.h / 2);
  }
  function wipeRect(st) {
    const w = st.wipe; if (!w) return null;
    const p = clamp(w.p, 0, 1);
    if (w.dir === 'left') return [0, 0, st.w * p, st.h];
    if (w.dir === 'right') return [st.w * (1 - p), 0, st.w * p, st.h];
    if (w.dir === 'up') return [0, 0, st.w, st.h * p];
    if (w.dir === 'down') return [0, st.h * (1 - p), st.w, st.h * p];
    return null;
  }
  function drawShape(c, st, alpha) {
    if (!st.fill && !st.line) return;
    c.save();
    c.globalAlpha = alpha;
    local(c, st);
    const wr = wipeRect(st);
    if (wr) { c.beginPath(); c.rect(...wr); c.clip(); }
    tracePath(c, st.g, st.w, st.h);
    if (st.fill) { c.fillStyle = rgba(st.fill); c.fill(); }
    if (st.line && st.line.w > 0) {
      c.lineWidth = st.line.w;
      c.strokeStyle = rgba(st.line.rgba);
      c.lineJoin = st.line.join === 'miter' ? 'miter' : 'round';
      const d = DASH[st.line.dash];
      c.setLineDash(d ? d.map((v) => v * st.line.w) : []);
      c.stroke();
    }
    c.restore();
  }
  function drawPicture(c, st, src, crop, alpha) {
    const im = src && ready.get(src);
    if (!im) return;
    c.save();
    c.globalAlpha = alpha;
    local(c, st);
    const wr = wipeRect(st);
    if (wr) { c.beginPath(); c.rect(...wr); c.clip(); }
    if (st.g.kind !== 'rect') { tracePath(c, st.g, st.w, st.h); c.clip(); }
    const iw = im.naturalWidth, ih = im.naturalHeight;
    const k = crop || { l: 0, t: 0, r: 0, b: 0 };
    const sx = k.l * iw, sy = k.t * ih, sw = Math.max(1, (1 - k.l - k.r) * iw), sh = Math.max(1, (1 - k.t - k.b) * ih);
    c.drawImage(im, sx, sy, sw, sh, 0, 0, st.w, st.h);
    c.restore();
  }
  // the text layer is a slide-space bitmap: map it from the object's own box to the box it is drawn in now.
  // uniform (Morph pairs): the glyphs scale with the box height only, as text does when its size changes; the text
  // keeps its relative place in the box. Otherwise (effects) the object's own scaling applies.
  function drawText(c, o, st, alpha, uniform = false) {
    const tl = o.textLayer;
    if (!tl) return;
    const im = ready.get(tl.src);
    if (!im) return;
    const kx = st.w / Math.max(o.w, 0.001), ky = st.h / Math.max(o.h, 0.001);
    const x = st.x + (tl.x - o.x) * kx, y = st.y + (tl.y - o.y) * ky;
    const w = tl.w * (uniform ? ky : kx), h = tl.h * ky;
    c.save();
    c.globalAlpha = alpha;
    const wr = wipeRect(st);
    if (wr) { c.beginPath(); c.rect(st.x + wr[0], st.y + wr[1], wr[2], wr[3]); c.clip(); }
    c.drawImage(im, x, y, w, h);
    c.restore();
  }
  function drawObject(c, o, st, alpha, side, t) {
    if (st.hidden) return;
    const a = alpha * st.opacity;
    if (a <= 0.002) return;
    drawShape(c, st, a);
    const src = pictureSrc(o, side, t);
    if (src) drawPicture(c, st, src, o.img ? o.img.crop : null, a * (o.img ? o.img.alpha : 1));
    drawText(c, o, st, a);
  }
  function lerpState(sa, sb, p) {
    return { x: lerp(sa.x, sb.x, p), y: lerp(sa.y, sb.y, p), w: lerp(sa.w, sb.w, p), h: lerp(sa.h, sb.h, p),
      rot: lerp(sa.rot, sb.rot, p), flipH: p < 0.5 ? sa.flipH : sb.flipH, flipV: p < 0.5 ? sa.flipV : sb.flipV,
      g: lerpGeom(sa.g, sb.g, sa, sb, null, p), fill: lerpColor(sa.fill, sb.fill, p),
      line: (sa.line || sb.line) ? { w: lerp(sa.line ? sa.line.w : 0, sb.line ? sb.line.w : 0, p),
        rgba: lerpColor(sa.line && sa.line.rgba, sb.line && sb.line.rgba, p),
        dash: (sb.line || sa.line).dash, join: (sb.line || sa.line).join } : null,
      opacity: 1, wipe: null };
  }
  const sameCrop = (a, b) => JSON.stringify(a || null) === JSON.stringify(b || null);
  function drawPair(c, A, B, p, t) {
    const sa = baseState(A), sb = baseState(B);
    const st = lerpState(sa, sb, p);
    drawShape(c, st, 1);
    const srcA = pictureSrc(A, 'prev', t), srcB = pictureSrc(B, 'cur', t);
    const hasContent = srcA || srcB || A.textLayer || B.textLayer;
    if (!hasContent) return;
    const samePic = srcA && srcA === srcB && !A.textLayer && !B.textLayer;
    if (samePic) {
      // the same picture: the box and the crop move
      const ca = A.img.crop || { l: 0, t: 0, r: 0, b: 0 }, cb = B.img.crop || { l: 0, t: 0, r: 0, b: 0 };
      const crop = { l: lerp(ca.l, cb.l, p), t: lerp(ca.t, cb.t, p), r: lerp(ca.r, cb.r, p), b: lerp(ca.b, cb.b, p) };
      drawPicture(c, st, srcB, crop, lerp(A.img.alpha, B.img.alpha, p));
      return;
    }
    // different content: a true crossfade of the two contents, both mapped into the moving box
    const o = offscreen(0);
    const stA = { ...st, g: st.g }, stB = { ...st, g: st.g };
    o.x.globalCompositeOperation = 'source-over';
    if (srcA) drawPicture(o.x, stA, srcA, A.img ? A.img.crop : null, (1 - p) * (A.img ? A.img.alpha : 1));
    drawTextMapped(o.x, A, st, 1 - p);
    o.x.globalCompositeOperation = 'lighter';
    if (srcB) drawPicture(o.x, stB, srcB, B.img ? B.img.crop : null, p * (B.img ? B.img.alpha : 1));
    drawTextMapped(o.x, B, st, p);
    o.x.globalCompositeOperation = 'source-over';
    c.save();
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.drawImage(o.c, 0, 0);
    c.restore();
  }
  function drawTextMapped(c, o, st, alpha) { if (o.textLayer) drawText(c, o, st, alpha, true); }

  // one whole slide, in its start state (transition) or with its builds at time t
  function drawSlide(c, objs, side, t, withEffects) {
    for (const o of objs) {
      const st = withEffects ? effectState(o, t) : (o.buildsIn && side === 'cur' ? { hidden: true } : baseState(o));
      drawObject(c, o, st, 1, side, t);
    }
  }

  function render(t) {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    ctx.imageSmoothingQuality = 'high';
    const tr = S.transition, D = tr.dur || 0;
    if (t < D && tr.kind === 'fade') {
      const p = clamp(t / D, 0, 1);
      if (S.prev) drawSlide(ctx, S.prev, 'prev', t, false);
      const o = offscreen(1);
      drawSlide(o.x, S.cur, 'cur', t, false);
      ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = p; ctx.drawImage(o.c, 0, 0); ctx.restore();
      return;
    }
    if (t < D && tr.kind === 'morph' && S.prev) {
      const p = easeInOut(clamp(t / D, 0, 1));
      for (const it of S.draw) {
        if (it.kind === 'pair') drawPair(ctx, S.byKey.get(it.a), S.byKey.get(it.b), p, t);
        else if (it.kind === 'gone') { const o = S.byKey.get(it.a); drawObject(ctx, o, baseState(o), 1 - p, 'prev', t); }
        else if (it.kind === 'new') { const o = S.byKey.get(it.b); drawObject(ctx, o, baseState(o), p, 'cur', t); }
      }
      return;
    }
    drawSlide(ctx, S.cur, 'cur', t, true);
  }

  function overlayPairs() {
    // the incoming slide's start dimmed, then: name pairs blue, automatic pairs orange, out red, in green,
    // built-in-later purple; an arrow runs from where a paired object was to where it lands
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    ctx.fillStyle = 'rgba(8,10,14,0.62)';
    ctx.fillRect(0, 0, SW, SH);
    const box = (o, color, dash, width = 4) => {
      ctx.save(); ctx.strokeStyle = color; ctx.lineWidth = width; ctx.setLineDash(dash);
      ctx.strokeRect(o.x, o.y, Math.max(o.w, 4), Math.max(o.h, 4)); ctx.restore();
    };
    const label = (txt, x, y, color) => {
      ctx.save(); ctx.font = '600 22px "DejaVu Sans", sans-serif';
      const w = ctx.measureText(txt).width + 14;
      const lx = clamp(x, 4, SW - w - 4), ly = clamp(y, 26, SH - 6);
      ctx.fillStyle = 'rgba(0,0,0,0.78)'; ctx.fillRect(lx, ly - 22, w, 28);
      ctx.fillStyle = color; ctx.fillText(txt, lx + 7, ly - 1); ctx.restore();
    };
    const arrow = (x0, y0, x1, y1, color) => {
      ctx.save(); ctx.strokeStyle = color; ctx.fillStyle = color; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
      const a = Math.atan2(y1 - y0, x1 - x0), L = 16;
      if (Math.hypot(x1 - x0, y1 - y0) > 20) {
        ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x1 - L * Math.cos(a - 0.4), y1 - L * Math.sin(a - 0.4));
        ctx.lineTo(x1 - L * Math.cos(a + 0.4), y1 - L * Math.sin(a + 0.4)); ctx.closePath(); ctx.fill();
      }
      ctx.restore();
    };
    const name = (o) => (o.name.startsWith('!!') ? o.name : (o.text ? `«${o.text.split('\n')[0].slice(0, 18)}»` : o.label.split(' [')[0]));
    for (const it of S.draw) {
      if (it.kind === 'gone') { const o = S.byKey.get(it.a); box(o, '#ff6b6b', [10, 8]); }
      else if (it.kind === 'new') { const o = S.byKey.get(it.b); box(o, '#69db7c', []); }
      else if (it.kind === 'held') { const o = S.byKey.get(it.b); box(o, '#b197fc', [3, 6], 3); }
    }
    for (const it of S.draw) {
      if (it.kind !== 'pair') continue;
      const A = S.byKey.get(it.a), B = S.byKey.get(it.b);
      const col = it.how === 'name' ? '#74c0fc' : '#ffa94d';
      const moved = Math.abs(A.x - B.x) + Math.abs(A.y - B.y) + Math.abs(A.w - B.w) + Math.abs(A.h - B.h) > 2;
      box(A, col, [6, 6], 2); box(B, col, [], 4);
      if (moved) arrow(A.x + A.w / 2, A.y + A.h / 2, B.x + B.w / 2, B.y + B.h / 2, col);
      if (moved || it.how !== 'name' || !/^!!(s\d\d|bg)$/.test(B.name)) label((it.how === 'name' ? '' : 'auto ') + name(B), B.x, B.y - 4, col);
    }
    for (const it of S.draw) {
      if (it.kind === 'gone') { const o = S.byKey.get(it.a); label('out ' + name(o), o.x, o.y + o.h + 24, '#ff6b6b'); }
      else if (it.kind === 'new') { const o = S.byKey.get(it.b); label('in ' + name(o), o.x, o.y + o.h + 24, '#69db7c'); }
    }
  }

  function drawLabel(t) {
    const tr = S.transition;
    let phase = 'hold';
    if (t < (tr.dur || 0) && tr.kind !== 'cut') phase = tr.kind === 'morph' ? `Morph ${tr.option || ''}` : (tr.fromBlack ? 'Fade from black' : 'Fade');
    else if (S.groups.some((g) => t >= g.start && t < g.end && g.effects)) phase = 'build';
    const clicks = S.clicks.filter((c) => c <= t).length;
    const txt = `${S.nn}  ${(t / 1000).toFixed(1)} s  ${phase}${S.clicks.length ? `  click ${clicks}/${S.clicks.length}` : ''}`;
    ctx.save();
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    ctx.font = '500 20px "DejaVu Sans Mono", monospace';
    const w = ctx.measureText(txt).width + 18;
    ctx.fillStyle = 'rgba(11,18,28,0.55)';
    ctx.fillRect(SW - w - 8, SH - 34, w, 28);
    ctx.fillStyle = 'rgba(255,255,255,0.92)';
    ctx.fillText(txt, SW - w + 1, SH - 13);
    ctx.restore();
  }

  // ------------------------------------------------------------------ api
  window.__load = async function loadScene(scene) {
    S = scene;
    canvas.width = scene.size[0];
    canvas.height = scene.size[1];
    scale = canvas.width / SW;
    S.byKey = new Map();
    for (const o of [...(scene.prev || []), ...scene.cur]) S.byKey.set(o.key, o);
    S.byTarget = new Map();
    for (const e of scene.effects) {
      for (const b of e.behaviours) {
        if (b.spid == null) continue;
        const key = `s${scene.index}:${b.spid}`;
        if (!S.byTarget.has(key)) S.byTarget.set(key, []);
        S.byTarget.get(key).push({ b, e });
      }
    }
    for (const l of S.byTarget.values()) l.sort((p, q) => p.b.begin - q.b.begin);
    const need = new Set();
    for (const o of [...(scene.prev || []), ...scene.cur]) {
      if (o.img) need.add(o.img.src);
      if (o.textLayer) need.add(o.textLayer.src);
      if (o.gif) o.gif.frames.forEach((f) => need.add(f));
    }
    await Promise.all([...need].map(load));
    window.__clip = { T: scene.T, seek: window.__seek, width: canvas.width, height: canvas.height };
    return { T: scene.T, images: need.size };
  };

  window.__seek = async function seek(t, opts = {}) {
    // on-demand frames (video) for this instant
    const want = [];
    for (const o of S.cur) { const s = pictureSrc(o, 'cur', t); if (s && !ready.has(s)) want.push(s); }
    for (const o of S.prev || []) { const s = pictureSrc(o, 'prev', t); if (s && !ready.has(s)) want.push(s); }
    if (want.length) { await Promise.all(want.map(load)); want.forEach(remember); }
    render(t);
    if (opts.overlay === 'pairs' && S.transition.kind === 'morph' && S.prev) overlayPairs();
    if (opts.label) drawLabel(t);
    return true;
  };
})();
