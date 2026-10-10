"""Convert a line of text in a TTF into outline paths (no font needed to display it).
Outputs: <out>.svg (paths, viewBox in font units) and <out>.json (DrawingML-ready path commands).
Usage: python text_to_paths.py <font.ttf> "<text>" <out_prefix> [letter_spacing_em]
Shaping by HarfBuzz (kerning), overlaps removed by skia-pathops so any fill rule renders the same.
"""
import sys, json
import uharfbuzz as hb
import pathops
from fontTools.ttLib import TTFont
from fontTools.pens.transformPen import TransformPen
from fontTools.pens.recordingPen import RecordingPen

font_path, text, out = sys.argv[1], sys.argv[2], sys.argv[3]
track = float(sys.argv[4]) if len(sys.argv) > 4 else 0.0
tt = TTFont(font_path)
upm = tt['head'].unitsPerEm
gs = tt.getGlyphSet()
blob = hb.Blob.from_file_path(font_path)
face = hb.Face(blob); hbfont = hb.Font(face)
buf = hb.Buffer(); buf.add_str(text); buf.guess_segment_properties()
hb.shape(hbfont, buf, {"kern": True, "liga": True})
order = tt.getGlyphOrder()
path = pathops.Path()
pen = path.getPen()
x = 0
for info, pos in zip(buf.glyph_infos, buf.glyph_positions):
    gname = order[info.codepoint]
    tp = TransformPen(pen, (1, 0, 0, 1, x + pos.x_offset, pos.y_offset))
    gs[gname].draw(tp)
    x += pos.x_advance + track * upm
path.simplify()          # remove overlaps, normalise winding
rec = RecordingPen(); path.draw(rec)
# bounds (font units, y up) -> flip to y down with origin at top-left of the ink box
xmin, ymin, xmax, ymax = path.bounds
W, H = xmax - xmin, ymax - ymin
def tr(pt):
    return (round(pt[0] - xmin), round(ymax - pt[1]))
cmds = []
svg_d = []
for op, args in rec.value:
    if op == 'moveTo':
        p = tr(args[0]); cmds.append(['M', p]); svg_d.append('M%d %d' % p)
    elif op == 'lineTo':
        p = tr(args[0]); cmds.append(['L', p]); svg_d.append('L%d %d' % p)
    elif op == 'qCurveTo':
        pts = [tr(a) for a in args]
        # expand implied on-curve points (TrueType style) into single quads
        offs, end = pts[:-1], pts[-1]
        for i, c in enumerate(offs):
            nxt = end if i == len(offs) - 1 else ((c[0] + offs[i + 1][0]) // 2, (c[1] + offs[i + 1][1]) // 2)
            cmds.append(['Q', c, nxt]); svg_d.append('Q%d %d %d %d' % (c + nxt))
    elif op == 'curveTo':
        pts = [tr(a) for a in args]; cmds.append(['C'] + pts); svg_d.append('C%d %d %d %d %d %d' % (pts[0] + pts[1] + pts[2]))
    elif op in ('closePath', 'endPath'):
        cmds.append(['Z']); svg_d.append('Z')
json.dump({"text": text, "upm": upm, "w": round(W), "h": round(H), "ascent_off": round(tt['hhea'].ascent - ymax),
           "advance": round(x), "cmds": cmds}, open(out + '.json', 'w'), ensure_ascii=False)
open(out + '.svg', 'w').write(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 %d %d" width="%d" height="%d">'
    '<title>%s</title><path fill="#0B121C" d="%s"/></svg>' % (round(W), round(H), round(W) // 4, round(H) // 4, text, ' '.join(svg_d)))
print('glyph runs:', len(buf.glyph_infos), '| ink box (font units):', round(W), 'x', round(H), '| commands:', len(cmds))
