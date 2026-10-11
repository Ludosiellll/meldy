// Shared timeline helpers for the deck's motion clips. A clip is a pure function of time: seek(ms) sets every
// property from t, so a frame renders the same on any machine (render.mjs steps through it frame by frame).
(function () {
  const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
  const E = {
    lin: (t) => t,
    out3: (t) => 1 - (1 - t) ** 3,
    out5: (t) => 1 - (1 - t) ** 5,
    in3: (t) => t ** 3,
    inOut3: (t) => (t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2),
    inOut5: (t) => (t < 0.5 ? 16 * t ** 5 : 1 - (-2 * t + 2) ** 5 / 2),
    // Meldy's curve, cubic-bezier(.16, 1, .3, 1), solved for x.
    meldy: (() => {
      const [x1, y1, x2, y2] = [0.16, 1, 0.3, 1];
      const bx = (s) => 3 * x1 * s * (1 - s) ** 2 + 3 * x2 * s * s * (1 - s) + s ** 3;
      const by = (s) => 3 * y1 * s * (1 - s) ** 2 + 3 * y2 * s * s * (1 - s) + s ** 3;
      return (x) => {
        if (x <= 0) return 0;
        if (x >= 1) return 1;
        let lo = 0, hi = 1;
        for (let k = 0; k < 40; k += 1) { const m = (lo + hi) / 2; if (bx(m) < x) lo = m; else hi = m; }
        return by((lo + hi) / 2);
      };
    })(),
  };
  /** Progress of t through [a, b], eased. */
  const seg = (t, a, b, e = E.out3) => e(clamp((t - a) / (b - a)));
  const mix = (a, b, p) => a + (b - a) * p;
  const rgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const mixc = (a, b, p) => { const x = rgb(a), y = rgb(b); return `rgb(${x.map((v, i) => Math.round(mix(v, y[i], p))).join(',')})`; };
  const el = (parent, cls, text) => { const d = document.createElement('div'); if (cls) d.className = cls; if (text != null) d.textContent = text; parent.appendChild(d); return d; };
  /** A stable pseudo-random number for (i, j): the same on every run. */
  const hash = (i, j = 0) => { const s = Math.sin(i * 127.1 + j * 311.7) * 43758.5453; return s - Math.floor(s); };
  const C = { ink: '#0b121c', muted: '#4b515b', faint: '#8a8f97', line: '#e3e3dd', yellow: '#f4c45b', named: '#e9b13c', canvas: '#f3f3f0', white: '#ffffff', blue: '#2869dd', blueFg: '#1f5bc6' };
  window.M = { clamp, E, seg, mix, mixc, el, hash, C };
})();
