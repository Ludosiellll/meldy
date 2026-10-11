// Injected into every slide page by extract.mjs (see CONTRACT.md for the markup).
// window.__pptxCollect(opts)  -> plain JSON description of the slide (geometry in slide px, origin = slide root)
// window.__pptxRenderPrep(id, mode, hideOwnBox) / __pptxRenderClear() -> isolate one element for a 2x picture render
(() => {
  'use strict';
  const TYPES = new Set(['title', 'text', 'shape', 'image', 'video', 'gif']);
  const ANIMS = new Set(['fade', 'rise', 'wipe', 'zoom', 'appear', 'settle']);
  const TRIGGERS = new Set(['after', 'with', 'click']);
  const TRANSITIONS = new Set(['morph', 'fade', 'none']);
  const DIRS = new Set(['left', 'right', 'up', 'down']);
  const MORPH_OPTIONS = new Set(['object', 'word', 'char']);
  const INLINE = new Set(['inline', 'inline-block', 'inline-flex', 'inline-grid', 'inline-table', 'contents', 'ruby', 'ruby-text']);
  const REPLACED = new Set(['img', 'svg', 'canvas', 'video', 'iframe', 'object', 'embed', 'picture', 'math']);
  const SKIP = new Set(['script', 'style', 'template', 'noscript', 'head', 'title', 'link', 'meta']);
  const WS = /^[ \t\n\r\f]$/;   // CSS collapsible white space (NOT U+00A0)

  const num = (v) => { const x = parseFloat(v); return Number.isFinite(x) ? x : 0; };
  const round = (v, d = 3) => Math.round(v * 10 ** d) / 10 ** d;

  // ---------------------------------------------------------------- colours
  const cctx = document.createElement('canvas').getContext('2d', { willReadFrequently: true });
  function parseColor(str) {
    if (!str || str === 'transparent' || str === 'none') return null;
    let m = str.match(/^rgba?\(\s*([\d.]+)[ ,]+([\d.]+)[ ,]+([\d.]+)(?:\s*[,/]\s*([\d.]+%?))?\s*\)$/);
    let r, g, b, a;
    if (m) {
      [r, g, b] = [m[1], m[2], m[3]].map((v) => Math.round(num(v)));
      a = m[4] === undefined ? 1 : (m[4].endsWith('%') ? num(m[4]) / 100 : num(m[4]));
    } else {
      // other colour syntaxes (oklch(), color(), named): let the canvas convert to sRGB
      cctx.clearRect(0, 0, 1, 1);
      cctx.fillStyle = '#000';
      cctx.fillStyle = str;
      cctx.fillRect(0, 0, 1, 1);
      const d = cctx.getImageData(0, 0, 1, 1).data;
      [r, g, b, a] = [d[0], d[1], d[2], d[3] / 255];
    }
    if (a <= 0.001) return null;
    const hex = [r, g, b].map((v) => Math.max(0, Math.min(255, v)).toString(16).padStart(2, '0')).join('').toUpperCase();
    return { rgb: hex, alpha: round(a, 4) };
  }
  const sameColor = (a, b) => (!a && !b) || (a && b && a.rgb === b.rgb && Math.abs(a.alpha - b.alpha) < 0.01);

  // ---------------------------------------------------------------- geometry
  let ROOT = null, ORIGIN = { x: 0, y: 0 };
  function rel(r) { return { x: round(r.left - ORIGIN.x), y: round(r.top - ORIGIN.y), w: round(r.width), h: round(r.height) }; }

  function matrixOf(el) {
    // 2D part of the cumulative CSS transform from the slide root down to el (transform + individual rotate/scale)
    const chain = [];
    for (let n = el; n && n !== ROOT.parentElement; n = n.parentElement) chain.push(n);
    let m = new DOMMatrix();
    for (let i = chain.length - 1; i >= 0; i--) {
      const cs = getComputedStyle(chain[i]);
      if (cs.transform && cs.transform !== 'none') m = m.multiply(new DOMMatrix(cs.transform));
      if (cs.rotate && cs.rotate !== 'none') { const a = num(cs.rotate.split(' ').pop()); m = m.rotate(0, 0, a); }
      if (cs.scale && cs.scale !== 'none') { const s = cs.scale.split(' ').map(num); m = m.scale(s[0], s.length > 1 ? s[1] : s[0]); }
    }
    return m;
  }

  function geometry(el) {
    const r = el.getBoundingClientRect();
    const bbox = rel(r);
    const m = matrixOf(el);
    const rot = Math.atan2(m.b, m.a) * 180 / Math.PI;
    const scale = Math.hypot(m.a, m.b);
    let box = bbox, rotDeg = 0;
    if (Math.abs(rot) > 0.05) {
      const lw = (el.offsetWidth !== undefined ? el.offsetWidth : el.getBBox().width) * scale;
      const lh = (el.offsetHeight !== undefined ? el.offsetHeight : el.getBBox().height) * scale;
      const cx = bbox.x + bbox.w / 2, cy = bbox.y + bbox.h / 2;
      box = { x: round(cx - lw / 2), y: round(cy - lh / 2), w: round(lw), h: round(lh) };
      rotDeg = round(rot, 2);
    }
    return { box, bbox, rot: rotDeg, scale: round(scale, 4) };
  }

  function effectiveOpacity(el) {
    let o = 1;
    for (let n = el; n && n !== ROOT; n = n.parentElement) o *= num(getComputedStyle(n).opacity);
    return round(o, 4);
  }

  function clipInfo(el) {
    // intersection of every ancestor that clips overflow (padding boxes), plus that ancestor's corner radius
    let clip = null, radius = null;
    for (let n = el.parentElement; n && n !== document.documentElement; n = n.parentElement) {
      const cs = getComputedStyle(n);
      const clips = (cs.overflowX !== 'visible') || (cs.overflowY !== 'visible');
      if (!clips) { if (n === ROOT) break; else continue; }
      const r = n.getBoundingClientRect();
      const c = { x: r.left - ORIGIN.x + n.clientLeft, y: r.top - ORIGIN.y + n.clientTop, w: n.clientWidth, h: n.clientHeight };
      if (!clip) { clip = c; radius = num(cs.borderTopLeftRadius) ? { px: num(cs.borderTopLeftRadius) - n.clientLeft, box: c } : null; }
      else {
        const x1 = Math.max(clip.x, c.x), y1 = Math.max(clip.y, c.y);
        const x2 = Math.min(clip.x + clip.w, c.x + c.w), y2 = Math.min(clip.y + clip.h, c.y + c.h);
        clip = { x: x1, y: y1, w: Math.max(0, x2 - x1), h: Math.max(0, y2 - y1) };
      }
      if (n === ROOT) break;
    }
    return { clip: clip && { x: round(clip.x), y: round(clip.y), w: round(clip.w), h: round(clip.h) }, clipRadius: radius && { px: round(radius.px), box: rel({ left: radius.box.x + ORIGIN.x, top: radius.box.y + ORIGIN.y, width: radius.box.w, height: radius.box.h }) } };
  }

  // ---------------------------------------------------------------- box styles
  function parseRadius(v, w, h, scale = 1) {
    const parts = String(v).trim().split(/\s+/);
    const res = (p, ref) => (p.endsWith('%') ? num(p) / 100 * ref : num(p) * scale);
    const rx = res(parts[0], w), ry = res(parts[1] || parts[0], h);
    return [rx, ry];
  }
  function boxStyle(el, w, h, scale = 1) {
    // w, h: the element box on the slide (after transforms); CSS lengths are scaled to it
    const cs = getComputedStyle(el);
    const sides = ['Top', 'Right', 'Bottom', 'Left'].map((s) => ({
      w: num(cs[`border${s}Width`]) * scale, style: cs[`border${s}Style`], color: parseColor(cs[`border${s}Color`]),
    }));
    const vis = sides.filter((s) => s.w > 0 && s.style !== 'none' && s.style !== 'hidden' && s.color);
    let line = null, lineUniform = true;
    if (vis.length) {
      const a = sides[0];
      lineUniform = vis.length === 4 && sides.every((s) => Math.abs(s.w - a.w) < 0.01 && s.style === a.style && sameColor(s.color, a.color));
      if (lineUniform) line = { w: round(a.w), color: a.color, dash: a.style };
    }
    const radii = ['TopLeft', 'TopRight', 'BottomRight', 'BottomLeft'].map((c) => parseRadius(cs[`border${c}Radius`], w, h, scale));
    // CSS 3 "overlapping curves": scale every radius down by the same factor
    let f = 1;
    const sumX1 = radii[0][0] + radii[1][0], sumX2 = radii[3][0] + radii[2][0];
    const sumY1 = radii[0][1] + radii[3][1], sumY2 = radii[1][1] + radii[2][1];
    if (sumX1 > w) f = Math.min(f, w / sumX1);
    if (sumX2 > w) f = Math.min(f, w / sumX2);
    if (sumY1 > h) f = Math.min(f, h / sumY1);
    if (sumY2 > h) f = Math.min(f, h / sumY2);
    const outline = cs.outlineStyle !== 'none' && num(cs.outlineWidth) > 0 && parseColor(cs.outlineColor);
    return {
      fill: parseColor(cs.backgroundColor),
      line, lineUniform, hasBorder: vis.length > 0,
      radii: radii.map(([x, y]) => [round(x * f), round(y * f)]),
      bgImage: cs.backgroundImage !== 'none',
      shadow: cs.boxShadow !== 'none',
      outline: !!outline,
      clipPath: cs.clipPath && cs.clipPath !== 'none',
    };
  }

  function pseudoPaints(el) {
    for (const pe of ['::before', '::after']) {
      const ps = getComputedStyle(el, pe);
      if (!ps.content || ps.content === 'none' || ps.content === 'normal') continue;
      if (ps.display === 'none') continue;
      return true;
    }
    return false;
  }
  function pseudoText(el) {
    const out = [];
    for (const pe of ['::before', '::after']) {
      const ps = getComputedStyle(el, pe);
      const c = ps.content;
      if (c && c !== 'none' && c !== 'normal' && c !== '""' && /^".*"$/.test(c)) out.push(pe + ' ' + c);
    }
    return out;
  }
  function decor(el) {
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden') return false;
    if (parseColor(cs.backgroundColor) || cs.backgroundImage !== 'none' || cs.boxShadow !== 'none') return true;
    for (const s of ['Top', 'Right', 'Bottom', 'Left']) {
      if (num(cs[`border${s}Width`]) > 0 && cs[`border${s}Style`] !== 'none' && parseColor(cs[`border${s}Color`])) return true;
    }
    if (cs.outlineStyle !== 'none' && num(cs.outlineWidth) > 0 && parseColor(cs.outlineColor)) return true;
    return pseudoPaints(el);
  }

  // Does anything inside el (excluding nested marked objects) paint? textToo: count visible glyphs as paint
  function descendantsPaint(el, textToo) {
    const walk = (node) => {
      for (const c of node.childNodes) {
        if (c.nodeType === 3) {
          if (textToo && c.data.trim() && getComputedStyle(c.parentElement).visibility !== 'hidden'
              && parseColor(getComputedStyle(c.parentElement).color)) return true;
        } else if (c.nodeType === 1) {
          if (c.hasAttribute('data-pptx')) continue;
          const cs = getComputedStyle(c);
          if (cs.display === 'none' || SKIP.has(c.localName)) continue;
          if (REPLACED.has(c.localName)) return true;
          if (decor(c)) return true;
          if (walk(c)) return true;
        }
      }
      return false;
    };
    return walk(el);
  }

  // ---------------------------------------------------------------- text
  const fm = new Map();
  const mctx = document.createElement('canvas').getContext('2d');
  function fontMetrics(cs) {
    const font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
    if (!fm.has(font)) {
      mctx.font = font;
      const m = mctx.measureText('Hgжй');
      fm.set(font, { asc: m.fontBoundingBoxAscent, desc: m.fontBoundingBoxDescent });
    }
    return fm.get(font);
  }

  function runStyle(parent, textEl) {
    const cs = getComputedStyle(parent);
    let op = 1, deco = new Set(), vAlign = 'baseline';
    for (let n = parent; n && n !== textEl.parentElement; n = n.parentElement) {
      const ncs = getComputedStyle(n);
      if (n !== textEl) op *= num(ncs.opacity);
      ncs.textDecorationLine.split(/\s+/).forEach((d) => d !== 'none' && deco.add(d));
      if (vAlign === 'baseline' && ncs.verticalAlign !== 'baseline' && ncs.display.startsWith('inline')) vAlign = ncs.verticalAlign;
    }
    const fill = cs.webkitTextFillColor && cs.webkitTextFillColor !== cs.color ? cs.webkitTextFillColor : cs.color;
    const color = parseColor(fill);
    const link = parent.closest('a[href]');
    const met = fontMetrics(cs);
    return {
      family: cs.fontFamily, weight: Math.round(num(cs.fontWeight)), italic: cs.fontStyle !== 'normal',
      sizePx: round(num(cs.fontSize)), color: color && { rgb: color.rgb, alpha: round(color.alpha * op, 4) },
      letterSpacingPx: cs.letterSpacing === 'normal' ? 0 : round(num(cs.letterSpacing)),
      underline: deco.has('underline'), strike: deco.has('line-through'),
      transform: cs.textTransform, vAlign,
      href: link && textEl.contains(link) ? link.href : null,
      asc: round(met.asc), desc: round(met.desc),
      ws: cs.whiteSpace,
    };
  }
  const styleKey = (s) => JSON.stringify([s.family, s.weight, s.italic, s.sizePx, s.color, s.letterSpacingPx, s.underline, s.strike, s.vAlign, s.href]);

  function transformChar(ch, tf, prev, lang) {
    if (tf === 'uppercase') return ch.toLocaleUpperCase(lang);
    if (tf === 'lowercase') return ch.toLocaleLowerCase(lang);
    if (tf === 'capitalize' && (!prev || /[\s \-—–«"(\[\/]/.test(prev))) return ch.toLocaleUpperCase(lang);
    return ch;
  }

  function alignOf(cs) {
    const a = cs.textAlign;
    const rtl = cs.direction === 'rtl';
    if (a === 'center' || a === '-webkit-center') return 'ctr';
    if (a === 'right' || a === '-webkit-right' || (a === 'end' && !rtl) || (a === 'start' && rtl)) return 'r';
    if (a === 'justify') return 'just';
    return 'l';
  }

  function contentBox(el) {
    const r = el.getBoundingClientRect(), cs = getComputedStyle(el);
    const l = num(cs.borderLeftWidth) + num(cs.paddingLeft), t = num(cs.borderTopWidth) + num(cs.paddingTop);
    const rr = num(cs.borderRightWidth) + num(cs.paddingRight), b = num(cs.borderBottomWidth) + num(cs.paddingBottom);
    return { x: r.left - ORIGIN.x + l, y: r.top - ORIGIN.y + t, w: r.width - l - rr, h: r.height - t - b, ins: { l, t, r: rr, b } };
  }

  function spaceWidth(st) {
    mctx.font = `${st.italic ? 'italic' : 'normal'} ${st.weight} ${st.sizePx}px ${st.family}`;
    return mctx.measureText(' ').width + st.letterSpacingPx;
  }

  function collectText(el, lang, warnings, label, scale = 1) {
    const tokens = [];
    const range = document.createRange();
    let replaced = 0;
    const walk = (node, block) => {
      for (const c of node.childNodes) {
        if (c.nodeType === 3) {
          const parent = c.parentElement;
          const pcs = getComputedStyle(parent);
          if (pcs.visibility === 'hidden') continue;
          const st = runStyle(parent, el);
          const keepNl = /^(pre|pre-wrap|pre-line|break-spaces)$/.test(pcs.whiteSpace);
          const data = c.data;
          for (let i = 0; i < data.length;) {
            const cp = data.codePointAt(i);
            const len = cp > 0xffff ? 2 : 1;
            const ch = String.fromCodePoint(cp);
            if (keepNl && ch === '\n') { tokens.push({ kind: 'br', block }); i += len; continue; }
            range.setStart(c, i); range.setEnd(c, i + len);
            const rects = [...range.getClientRects()].filter((r) => r.width > 0.01 || (!WS.test(ch) && r.height > 0));
            if (rects.length) tokens.push({ kind: 'ch', ch: WS.test(ch) ? ' ' : ch, st, rect: rects[0], block });
            i += len;
          }
        } else if (c.nodeType === 1) {
          if (c.hasAttribute('data-pptx')) continue;              // nested marked object: its own picture/shape/text
          const ln = c.localName;
          if (SKIP.has(ln)) continue;
          const cs = getComputedStyle(c);
          if (cs.display === 'none') continue;
          if (ln === 'br') { tokens.push({ kind: 'br', block }); continue; }
          if (REPLACED.has(ln)) { replaced++; continue; }
          const pt = pseudoText(c);
          if (pt.length) warnings.push(`${label}: generated text ${pt.join(', ')} is not carried as live text (it stays in the under-layer picture only if it is not a glyph)`);
          if (cs.display === 'list-item' && cs.listStyleType !== 'none') {
            warnings.push(`${label}: list markers (${cs.listStyleType}) are not live text; write "•"/"—" in the text or draw them with ::before`);
          }
          if (INLINE.has(cs.display)) walk(c, block);
          else { tokens.push({ kind: 'block' }); walk(c, c); tokens.push({ kind: 'block' }); }
        }
      }
    };
    walk(el, el);

    // split into paragraphs at <br> and block boundaries
    const paras = [];
    let cur = [];
    for (const t of tokens) {
      if (t.kind === 'ch') cur.push(t);
      else if (cur.length) { paras.push(cur); cur = []; }
    }
    if (cur.length) paras.push(cur);

    const elBox = contentBox(el);
    const out = [];
    for (const chars of paras) {
      // apply text-transform with word context, then cluster into rendered lines by baseline
      let prev = null;
      for (const t of chars) { t.out = transformChar(t.ch, t.st.transform, prev, lang); prev = t.ch; }
      const lines = [];
      let L = null;
      for (const t of chars) {
        const base = t.rect.top + t.st.asc * scale;   // rects are on the slide (transformed), metrics are CSS px
        const newLine = !L || (base > L.baseline + 0.45 * Math.max(L.maxSize, t.st.sizePx) && t.rect.left < L.right - 0.5);
        if (newLine) { L = { chars: [], baseline: base, maxSize: 0, left: t.rect.left, right: t.rect.right, hasBase: t.st.vAlign === 'baseline' }; lines.push(L); }
        if (!L.hasBase && t.st.vAlign === 'baseline') { L.baseline = base; L.hasBase = true; }
        L.chars.push(t);
        L.maxSize = Math.max(L.maxSize, t.st.sizePx);
        L.left = Math.min(L.left, t.rect.left);
        L.right = Math.max(L.right, t.rect.right);
      }
      // runs per line; drop white space at soft line ends and starts
      const block0 = chars[0].block;
      const justify = alignOf(getComputedStyle(block0)) === 'just';
      const outLines = [];
      lines.forEach((ln, li) => {
        let cs = ln.chars;
        if (lines.length > 1) {
          while (cs.length && cs[cs.length - 1].ch === ' ' && li < lines.length - 1) cs = cs.slice(0, -1);
          while (cs.length && cs[0].ch === ' ' && li > 0) cs = cs.slice(1);
        }
        // Glyph boxes of consecutive characters touch (letter-spacing and kerning are inside them); a gap means
        // inline padding/border/margin or a nested object. It becomes extra spacing after that character.
        cs.forEach((t, k) => {
          const nx = cs[k + 1];
          let g = nx ? nx.rect.left - t.rect.right : 0;
          // justified lines: Chromium widens the spaces; carry the widening explicitly (the paragraph becomes 'l')
          if (justify && t.ch === ' ' && li < lines.length - 1) g += t.rect.width - spaceWidth(t.st) * scale;
          t.extra = Math.abs(g) > 0.75 ? round(g, 2) : 0;
        });
        const runs = [];
        for (const t of cs) {
          const k = styleKey(t.st) + (t.extra ? `|gap${t.extra}` : '');
          const last = runs[runs.length - 1];
          if (last && last.key === k && !t.extra && !last.extra) { last.text += t.out; last.raw += t.ch; last.right = t.rect.right; }
          else runs.push({ key: k, text: t.out, raw: t.ch, st: t.st, left: t.rect.left, right: t.rect.right, top: t.rect.top, extra: t.extra });
        }
        const visible = cs.filter((t) => t.ch !== ' ');
        outLines.push({
          baseline: round(ln.baseline - ORIGIN.y),
          left: round((visible.length ? Math.min(...visible.map((t) => t.rect.left)) : ln.left) - ORIGIN.x),
          right: round((visible.length ? Math.max(...visible.map((t) => t.rect.right)) : ln.right) - ORIGIN.x),
          maxSizePx: round(ln.maxSize * scale, 3),
          runs: runs.map((r) => {
            const s = r.st;
            const shift = s.vAlign !== 'baseline' ? round((ln.baseline - (r.top + s.asc * scale)) / (s.sizePx * scale), 3) : 0;
            return {
              text: r.text, raw: r.raw, family: s.family, weight: s.weight, italic: s.italic,
              sizePx: round(s.sizePx * scale, 3), color: s.color,
              letterSpacingPx: round(s.letterSpacingPx * scale + (r.extra || 0), 3), underline: s.underline,
              strike: s.strike, transform: s.transform, baselineShift: shift, href: s.href,
              ascPx: round(s.asc * scale, 3), descPx: round(s.desc * scale, 3),
              ...(r.extra ? { gapPx: r.extra } : {}),
            };
          }),
        });
      });
      const block = chars[0].block;
      const bcs = getComputedStyle(block);
      const bBox = contentBox(block);
      const lh = bcs.lineHeight === 'normal' ? null : round(num(bcs.lineHeight));
      out.push({
        align: justify ? 'l' : alignOf(bcs),          // justified lines carry their widened spaces explicitly
        lineHeightPx: lh === null ? null : round(lh * scale, 3),
        indentPx: round(num(bcs.textIndent) * scale),
        marLPx: round(Math.max(0, bBox.x - elBox.x)),
        marRPx: round(Math.max(0, (elBox.x + elBox.w) - (bBox.x + bBox.w))),
        lines: outLines,
      });
    }
    if (out.some((p) => p.lines.some((l) => l.runs.some((r) => r.baselineShift)))) {
      warnings.push(`${label}: superscript/subscript text is shrunk again by PowerPoint/LibreOffice; prefer the characters ² ³ ₂`);
    }
    return { paragraphs: out, replacedChildren: replaced };
  }

  // ---------------------------------------------------------------- media sources
  function fileOf(url) {
    if (!url) return null;
    try { return new URL(url, document.baseURI).href; } catch (e) { return null; }
  }

  // ---------------------------------------------------------------- notes
  function notesOf() {
    const tpls = [...document.querySelectorAll('template[data-pptx="notes"]')];
    const raw = tpls.map((t) => t.content.textContent).join('\n\n');
    return raw.replace(/\r\n?/g, '\n').split(/\n[ \t]*\n/)
      .map((p) => p.replace(/[ \t\n\r\f]+/g, ' ').trim()).filter(Boolean);
  }

  // ---------------------------------------------------------------- main
  window.__pptxCollect = function collect(opts = {}) {
    ROOT = document.querySelector('main.slide') || document.querySelector('.slide');
    const warnings = [];
    if (!ROOT) return { error: 'no <main class="slide"> in the page' };
    const rr = ROOT.getBoundingClientRect();
    ORIGIN = { x: rr.left, y: rr.top };
    if (Math.abs(rr.width - 1920) > 0.5 || Math.abs(rr.height - 1080) > 0.5) warnings.push(`slide root is ${rr.width}x${rr.height}, expected 1920x1080`);
    const lang = (ROOT.closest('[lang]') || document.documentElement).getAttribute('lang') || 'ru';
    let transition = (ROOT.dataset.transition || 'morph').trim();
    if (!TRANSITIONS.has(transition)) { warnings.push(`unknown data-transition="${transition}", using morph`); transition = 'morph'; }
    const tdur = ROOT.dataset.transitionDur ? Math.round(num(ROOT.dataset.transitionDur)) : null;
    let morphOption = (ROOT.dataset.morph || 'object').trim();
    if (!MORPH_OPTIONS.has(morphOption)) { warnings.push(`unknown data-morph="${morphOption}", using object`); morphOption = 'object'; }
    if (ROOT.dataset.morph && transition !== 'morph') warnings.push(`data-morph="${morphOption}" without a morph transition has no effect`);

    const fontsLoaded = [...document.fonts].filter((f) => f.status === 'loaded').map((f) => `${f.family.replace(/["']/g, '')} ${f.weight}`);
    const marked = [...document.querySelectorAll('[data-pptx]')].filter((el) => el.dataset.pptx !== 'notes');
    const elements = [];
    let titles = 0;
    marked.forEach((el, i) => {
      const type = el.dataset.pptx;
      const label = `${type}#${i + 1}${el.dataset.name ? ' ' + el.dataset.name : ''}`;
      el.setAttribute('data-pptx-id', 'e' + (i + 1));
      if (!TYPES.has(type)) { warnings.push(`${label}: unknown data-pptx="${type}", skipped`); return; }
      if (!ROOT.contains(el)) { warnings.push(`${label}: outside the slide root, skipped`); return; }
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden') { warnings.push(`${label}: not rendered (display/visibility), skipped`); return; }
      const g = geometry(el);
      if (g.bbox.w < 0.5 || g.bbox.h < 0.5) { warnings.push(`${label}: zero size, skipped`); return; }
      const d = {
        id: 'e' + (i + 1), type, domIndex: i, name: el.dataset.name || null, tag: el.localName,
        box: g.box, bbox: g.bbox, rot: g.rot, scale: g.scale, opacity: effectiveOpacity(el),
        href: el.dataset.href || null, alt: el.getAttribute('aria-label') || el.getAttribute('alt') || null,
        anim: null, notes: [],
        ...clipInfo(el),
      };
      if (g.rot && (type === 'image' || type === 'gif')) warnings.push(`${label}: rotated ${g.rot}°, placed as its upright bounding box`);
      if (el.dataset.anim) {
        const eff = el.dataset.anim.trim();
        const trig = (el.dataset.animTrigger || 'after').trim();
        if (!ANIMS.has(eff)) warnings.push(`${label}: unknown data-anim="${eff}", no animation`);
        else if (!TRIGGERS.has(trig)) warnings.push(`${label}: unknown data-anim-trigger="${trig}", no animation`);
        else d.anim = {
          effect: eff, trigger: trig,
          delayMs: Math.max(0, Math.round(num(el.dataset.animDelay || 0))),
          durMs: Math.max(1, Math.round(num(el.dataset.animDur || 500))),
          order: el.dataset.animOrder !== undefined ? Math.round(num(el.dataset.animOrder)) : null,
        };
        if (d.anim && el.dataset.animDir !== undefined) {
          const dir = el.dataset.animDir.trim();
          if (eff !== 'wipe') warnings.push(`${label}: data-anim-dir only applies to wipe, ignored`);
          else if (!DIRS.has(dir)) warnings.push(`${label}: unknown data-anim-dir="${dir}", using left`);
          else d.anim.dir = dir;
        }
      } else if (el.dataset.animDir !== undefined) {
        warnings.push(`${label}: data-anim-dir without data-anim, ignored`);
      }
      if (type === 'title' || type === 'text') {
        if (type === 'title') titles++;
        d.style = boxStyle(el, g.box.w, g.box.h, g.scale || 1);
        if (g.rot) warnings.push(`${label}: rotated text cannot be measured line by line; mark it data-pptx="image" if it looks off`);
        const sc = g.scale || 1;
        const t = collectText(el, lang, warnings, label, sc);
        const cb = contentBox(el);
        d.text = { ...t, insets: { l: round(cb.ins.l * sc), t: round(cb.ins.t * sc), r: round(cb.ins.r * sc), b: round(cb.ins.b * sc) },
          lang, wrapNone: /^(nowrap|pre)$/.test(cs.whiteSpace) };
        if (!t.paragraphs.length) warnings.push(`${label}: no visible text`);
        const ownExtra = d.style.bgImage || d.style.shadow || d.style.outline || !d.style.lineUniform || pseudoPaints(el);
        if (ownExtra || descendantsPaint(el, false) || t.replacedChildren) d.render = { mode: 'under' };
        if (d.style.clipPath) warnings.push(`${label}: clip-path on a text element is not carried`);
        const families = new Set(t.paragraphs.flatMap((p) => p.lines.flatMap((l) => l.runs.map((r) => r.family))));
        for (const f of families) if (!/onest/i.test(f)) warnings.push(`${label}: font-family ${f} is not Onest`);
      } else if (type === 'shape') {
        d.style = boxStyle(el, g.box.w, g.box.h, g.scale || 1);
        if (!d.style.fill && !d.style.line && !d.style.hasBorder) warnings.push(`${label}: shape has neither fill nor border`);
        const ownExtra = d.style.bgImage || d.style.shadow || d.style.outline || !d.style.lineUniform || pseudoPaints(el) || d.style.clipPath;
        if (ownExtra || descendantsPaint(el, true)) d.render = { mode: 'over' };
      } else if (type === 'image') {
        const src = el.dataset.src;
        if (src) {
          d.src = { url: fileOf(src), fit: el.localName === 'img' ? cs.objectFit : 'cover', position: cs.objectPosition };
          d.style = boxStyle(el, g.box.w, g.box.h, g.scale || 1);
          if (/\.svg(\?|#|$)/i.test(src)) d.render = { mode: 'svg' };
        } else {
          d.render = { mode: 'image' };
        }
      } else if (type === 'video' || type === 'gif') {
        const src = el.dataset.src;
        if (!src) { warnings.push(`${label}: data-src missing, skipped`); return; }
        d.src = {
          url: fileOf(src),
          poster: el.dataset.poster ? fileOf(el.dataset.poster) : null,
          loop: type === 'video' && el.hasAttribute('data-loop') && !/^(false|0|no|off)$/i.test(el.dataset.loop || ''),
          autoplay: type === 'video' ? !/^(false|0|no|off)$/i.test(el.dataset.autoplay || '') : true,
          fit: (el.localName === 'img' || el.localName === 'video') ? cs.objectFit : 'cover',
          position: cs.objectPosition,
        };
        d.style = boxStyle(el, g.box.w, g.box.h, g.scale || 1);
        if (type === 'video' && !d.src.poster) warnings.push(`${label}: no data-poster; the build takes frame 0`);
      }
      // clipping by an overflow ancestor
      if (d.clip) {
        const b = d.bbox, c = d.clip;
        const inside = b.x >= c.x - 0.5 && b.y >= c.y - 0.5 && b.x + b.w <= c.x + c.w + 0.5 && b.y + b.h <= c.y + c.h + 0.5;
        d.clipped = !inside;
        if (!inside && (type === 'text' || type === 'title' || type === 'shape')) warnings.push(`${label}: partly hidden by an overflow ancestor; a native object is not clipped`);
      }
      elements.push(d);
    });
    if (titles !== 1) warnings.push(`slide has ${titles} data-pptx="title" elements, expected exactly one`);
    const names = new Map();
    for (const e of elements) if (e.name) names.set(e.name, (names.get(e.name) || 0) + 1);
    for (const [n, c] of names) if (c > 1) warnings.push(`name ${n} is used ${c} times on this slide; Morph needs it unique`);
    return { lang, transition: { type: transition, durMs: tdur, option: morphOption }, notes: notesOf(), elements, warnings, fontsLoaded,
             root: { x: round(rr.left + window.scrollX), y: round(rr.top + window.scrollY), w: round(rr.width), h: round(rr.height) } };
  };

  // ---------------------------------------------------------------- isolated 2x renders
  const RENDER_CSS = `
    html.pptx-render, html.pptx-render body { background: transparent !important; }
    html.pptx-render body * { visibility: hidden !important; }
    html.pptx-render [data-pptx-target], html.pptx-render [data-pptx-target] * { visibility: visible !important; }
    html.pptx-render [data-pptx-target] [data-pptx], html.pptx-render [data-pptx-target] [data-pptx] * { visibility: hidden !important; }
    html.pptx-render [data-pptx-target][data-pptx-hidebox~="bg"] { background-color: transparent !important; }
    html.pptx-render [data-pptx-target][data-pptx-hidebox~="border"] { border-color: transparent !important; }
    html.pptx-render [data-pptx-target][data-pptx-mode="under"], html.pptx-render [data-pptx-target][data-pptx-mode="under"] * {
      -webkit-text-fill-color: transparent !important; text-decoration-color: transparent !important;
      text-shadow: none !important; -webkit-text-stroke-color: transparent !important; caret-color: transparent !important; }
    /* "text": only the glyphs of a live text box (for the motion preview; the PPTX draws them itself) */
    html.pptx-render [data-pptx-target][data-pptx-mode="text"], html.pptx-render [data-pptx-target][data-pptx-mode="text"] * {
      background: transparent !important; border-color: transparent !important; box-shadow: none !important;
      outline-color: transparent !important; text-shadow: none !important; }
    html.pptx-render [data-pptx-target][data-pptx-mode="text"]::before, html.pptx-render [data-pptx-target][data-pptx-mode="text"]::after,
    html.pptx-render [data-pptx-target][data-pptx-mode="text"] *::before, html.pptx-render [data-pptx-target][data-pptx-mode="text"] *::after {
      background: transparent !important; border-color: transparent !important; box-shadow: none !important;
      -webkit-text-fill-color: transparent !important; }
    html.pptx-render [data-pptx-target][data-pptx-mode="text"] :is(img, svg, canvas, video, picture, iframe) { visibility: hidden !important; }
  `;
  // hide: '' | 'bg' | 'border' | 'bg border' -- the parts of the element's own box that the native object already draws
  window.__pptxRenderPrep = function prep(id, mode, hide) {
    if (!document.getElementById('pptx-render-css')) {
      const s = document.createElement('style'); s.id = 'pptx-render-css'; s.textContent = RENDER_CSS; document.head.appendChild(s);
    }
    ROOT = document.querySelector('main.slide') || document.querySelector('.slide');
    const rr = ROOT.getBoundingClientRect();
    ORIGIN = { x: rr.left, y: rr.top };
    const el = document.querySelector(`[data-pptx-id="${id}"]`);
    if (!el) return null;
    document.documentElement.classList.add('pptx-render');
    el.setAttribute('data-pptx-target', '');
    el.setAttribute('data-pptx-mode', mode);
    if (hide) el.setAttribute('data-pptx-hidebox', hide);
    // paint bounds: the element, its unmarked descendants, generous room for shadows and pseudo-elements
    let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
    const add = (r, m) => { if (r.width <= 0 && r.height <= 0) return; x1 = Math.min(x1, r.left - m); y1 = Math.min(y1, r.top - m); x2 = Math.max(x2, r.right + m); y2 = Math.max(y2, r.bottom + m); };
    const shadowMargin = (n) => {
      const sh = getComputedStyle(n).boxShadow;
      if (!sh || sh === 'none') return 0;
      return sh.split(/,(?![^(]*\))/).reduce((m, part) => {
        const v = (part.replace(/rgba?\([^)]*\)|#[0-9a-f]+|inset/gi, '').match(/-?[\d.]+px/g) || []).map(num);
        return Math.max(m, Math.abs(v[0] || 0) + Math.abs(v[1] || 0) + Math.abs(v[2] || 0) + Math.max(0, v[3] || 0));
      }, 0);
    };
    add(el.getBoundingClientRect(), 12 + shadowMargin(el));
    const walk = (n) => {
      for (const c of n.children) {
        if (c.hasAttribute('data-pptx')) continue;
        add(c.getBoundingClientRect(), 12 + shadowMargin(c));
        walk(c);
      }
    };
    walk(el);
    // clamp to the slide
    x1 = Math.max(x1, rr.left); y1 = Math.max(y1, rr.top); x2 = Math.min(x2, rr.right); y2 = Math.min(y2, rr.bottom);
    if (x2 <= x1 || y2 <= y1) return null;
    x1 = Math.floor(x1); y1 = Math.floor(y1); x2 = Math.ceil(x2); y2 = Math.ceil(y2);
    return { page: { x: x1 + window.scrollX, y: y1 + window.scrollY, w: x2 - x1, h: y2 - y1 },
             slide: { x: x1 - ORIGIN.x, y: y1 - ORIGIN.y, w: x2 - x1, h: y2 - y1 } };
  };
  window.__pptxRenderClear = function clear() {
    document.documentElement.classList.remove('pptx-render');
    for (const el of document.querySelectorAll('[data-pptx-target]')) {
      el.removeAttribute('data-pptx-target'); el.removeAttribute('data-pptx-mode'); el.removeAttribute('data-pptx-hidebox');
    }
  };
  // ---------------------------------------------------------------- private fill
  // data-fill="key": the element's text is replaced by map[key] (deck/cf11/private/fill.json, git-ignored) before
  // anything is measured or rendered, and the element gets data-filled (CSS can drop placeholder styling with it).
  window.__pptxFill = function fill(map) {
    const filled = [], missing = [];
    for (const el of document.querySelectorAll('[data-fill]')) {
      const key = (el.dataset.fill || '').trim();
      const v = map && Object.prototype.hasOwnProperty.call(map, key) ? map[key] : undefined;
      if (typeof v === 'string' || typeof v === 'number') {
        el.textContent = String(v);
        el.setAttribute('data-filled', '');
        filled.push(key);
      } else {
        missing.push(key);
      }
    }
    return { filled, missing };
  };
  window.__pptxAssignIds = function assignIds() {
    [...document.querySelectorAll('[data-pptx]')].filter((el) => el.dataset.pptx !== 'notes')
      .forEach((el, i) => el.setAttribute('data-pptx-id', 'e' + (i + 1)));
  };
})();
