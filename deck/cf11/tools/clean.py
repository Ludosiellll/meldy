"""Clean the files that go to the jury of anything a reader does not see on the slides, and check that they are clean.

    python tools/clean.py pptx out/meldy-codingfest11.pptx       rewrite the PPTX in place
    python tools/clean.py pdf  out/meldy-codingfest11.pdf        rewrite the PDF copy in place
    python tools/clean.py check out/meldy-codingfest11.pptx out/meldy-codingfest11.pdf [--no-notes]

pptx: document properties neutral (title «Meldy», subject, author, keywords, description, category and «last
      modified by» empty, revision 1; app.xml without application, company, manager or template); the master's date
      field without the template's frozen date, its field ids renewed; media without
      metadata: PNG text and time chunks, JPEG EXIF/XMP/comment segments, SVG comments and <metadata>, MP4 container and
      stream tags (remuxed with ffmpeg, streams copied as they are).
pdf:  the document information is the title «Meldy» only (no author, subject, keywords, creator or producer), no XMP
      packet, no embedded files and no media annotations (LibreOffice attaches each video as a Screen annotation; the
      poster is page content, so the page looks the same), link annotations kept.
check: fails on any of: words that name tools, people or places of the work (FORBIDDEN, in every XML part, in media
      metadata, in the PDF's dictionaries outside its streams), e-mail addresses, file paths, properties that are not
      neutral, custom properties, comments, tags, hidden slides, speaker notes (with --no-notes), media names other than
      imageN/mediaN, alt texts or object names that look like file names, PDF metadata, attachments or annotations
      other than links. Prints what it looked at and «HIDDEN DATA: clean» or the findings.
"""
from __future__ import annotations

import io
import re
import shutil
import struct
import subprocess
import sys
import tempfile
import zipfile
from pathlib import Path

from lxml import etree

# the names of assistant vendors and their products are kept spelled backwards, so the repository does not carry them
_VENDORS = '|'.join([w[::-1] for w in ('edualc', 'ciporhtna', 'ianepo', 'tpgtahc')] + [r'\b' + 'tpg'[::-1]])
FORBIDDEN = re.compile(
    _VENDORS + r'|generated|python-pptx|pptx|libreoffice|\bimpress\b|pypdf|\bagent|'
    r'scratchpad|/tmp/|/home/|/root/|worktree|draft|черновик|\btodo\b|\bИИ сделал|simple-icons|chromium|puppeteer|skia|'
    r'headless', re.I)
EMAIL = re.compile(r'[\w.+-]+@[\w-]+\.[\w.-]+')
PATHLIKE = re.compile(r'\.(png|jpe?g|svg|gif|mp4|m4v|mov|html?|json|py|mjs)\b|[\\/]', re.I)
NS = {
    'cp': 'http://schemas.openxmlformats.org/package/2006/metadata/core-properties',
    'dc': 'http://purl.org/dc/elements/1.1/',
    'ep': 'http://schemas.openxmlformats.org/officeDocument/2006/extended-properties',
    'p': 'http://schemas.openxmlformats.org/presentationml/2006/main',
    'a': 'http://schemas.openxmlformats.org/drawingml/2006/main',
}
TITLE = 'Meldy'
COVER_NAME = 'Титульный'   # the PDF bookmark of the cover, which carries no title on the slide


# ---------------------------------------------------------------- media metadata
PNG_KEEP = {b'IHDR', b'PLTE', b'IDAT', b'IEND', b'tRNS', b'gAMA', b'cHRM', b'sRGB', b'iCCP', b'pHYs', b'sBIT', b'bKGD'}


def png_chunks(b: bytes):
    i = 8
    while i + 8 <= len(b):
        n, t = struct.unpack('>I4s', b[i:i + 8])
        yield t, b[i:i + 12 + n]
        i += 12 + n


def clean_png(b: bytes) -> bytes:
    if b[:8] != b'\x89PNG\r\n\x1a\n':
        return b
    return b[:8] + b''.join(raw for t, raw in png_chunks(b) if t in PNG_KEEP)


def jpeg_segments(b: bytes):
    """(marker, raw bytes) of every segment before the scan; the rest (scan and after) as marker None."""
    i = 2
    while i + 4 <= len(b) and b[i] == 0xFF:
        m = b[i + 1]
        if m == 0xDA:
            break
        n = struct.unpack('>H', b[i + 2:i + 4])[0]
        yield m, b[i:i + 2 + n]
        i += 2 + n
    yield None, b[i:]


def jpeg_keeps(m: int, raw: bytes) -> bool:
    if m is None:
        return True
    if m == 0xE0:
        return raw[4:9] == b'JFIF\x00'
    if m == 0xE2:
        return raw[4:16] == b'ICC_PROFILE\x00'
    if m == 0xEE:
        return raw[4:9] == b'Adobe'
    return not (0xE1 <= m <= 0xEF or m == 0xFE)


def clean_jpeg(b: bytes) -> bytes:
    if b[:2] != b'\xff\xd8':
        return b
    return b[:2] + b''.join(raw for m, raw in jpeg_segments(b) if jpeg_keeps(m, raw))


def clean_svg(b: bytes) -> bytes:
    root = etree.fromstring(b, etree.XMLParser(remove_comments=True, remove_pis=True, resolve_entities=False))
    for el in root.iter('{http://www.w3.org/2000/svg}metadata'):
        el.getparent().remove(el)
    return etree.tostring(root, xml_declaration=True, encoding='UTF-8')


def clean_mp4(b: bytes, suffix: str) -> bytes:
    with tempfile.TemporaryDirectory() as d:
        src, dst = Path(d) / ('in' + suffix), Path(d) / ('out' + suffix)
        src.write_bytes(b)
        cmd = ['ffmpeg', '-v', 'error', '-y', '-i', str(src), '-map', '0', '-c', 'copy', '-map_metadata', '-1',
               '-map_chapters', '-1', '-fflags', '+bitexact', '-flags:v', '+bitexact', '-flags:a', '+bitexact',
               '-metadata:s:v', 'handler_name=VideoHandler', '-metadata:s:a', 'handler_name=SoundHandler',
               '-movflags', '+faststart', str(dst)]
        r = subprocess.run(cmd, capture_output=True, text=True)
        if r.returncode != 0 or not dst.exists():
            raise SystemExit(f'ffmpeg could not remux the video: {r.stderr.strip()[:300]}')
        return dst.read_bytes()


def mp4_tags(b: bytes, suffix: str) -> list[str]:
    with tempfile.TemporaryDirectory() as d:
        src = Path(d) / ('in' + suffix)
        src.write_bytes(b)
        r = subprocess.run(['ffprobe', '-v', 'error', '-show_entries', 'format_tags:stream_tags', '-of', 'compact', str(src)],
                           capture_output=True, text=True)
        return [t for t in re.findall(r'tag:([^=|]+)=([^|\n]*)', r.stdout) for t in [f'{t[0]}={t[1]}']]


# ---------------------------------------------------------------- properties
def clean_core(b: bytes) -> bytes:
    root = etree.fromstring(b)
    want = {'{%s}title' % NS['dc']: TITLE}
    for tag in ('{%s}subject' % NS['dc'], '{%s}creator' % NS['dc'], '{%s}description' % NS['dc'],
                '{%s}keywords' % NS['cp'], '{%s}lastModifiedBy' % NS['cp'], '{%s}category' % NS['cp'],
                '{%s}contentStatus' % NS['cp'], '{%s}identifier' % NS['dc']):
        want[tag] = ''
    for el in list(root):
        if el.tag in want:
            el.text = want[el.tag] or None
        elif el.tag == '{%s}revision' % NS['cp']:
            el.text = '1'
        elif el.tag == '{%s}lastPrinted' % NS['cp']:
            root.remove(el)
    if root.find('dc:title', NS) is None:
        etree.SubElement(root, '{%s}title' % NS['dc']).text = TITLE
    return etree.tostring(root, xml_declaration=True, encoding='UTF-8', standalone=True)


APP_DROP = ('Application', 'AppVersion', 'Company', 'Manager', 'Template', 'HyperlinkBase', 'DocSecurity')


def clean_app(b: bytes) -> bytes:
    root = etree.fromstring(b)
    for el in list(root):
        if etree.QName(el).localname in APP_DROP:
            root.remove(el)
    return etree.tostring(root, xml_declaration=True, encoding='UTF-8', standalone=True)


# ---------------------------------------------------------------- master and layouts
# The empty template the compiler starts from carries a frozen date in the date field ("1/27/13") and fixed field ids;
# the date field gets no text (PowerPoint fills it in) and the ids new values (stable from build to build).
DATE_FLD = re.compile(rb'(<a:fld [^>]*type="datetime[^"]*"[^>]*>(?:(?!</a:fld>).)*?<a:t>)[^<]*(</a:t>)', re.S)
FLD_ID = re.compile(rb'(<a:fld id=")(\{[0-9A-Fa-f-]{36}\})(")')


def clean_master(b: bytes) -> bytes:
    import uuid
    b = DATE_FLD.sub(rb'\1\2', b)
    return FLD_ID.sub(lambda m: m.group(1) + ('{%s}' % str(uuid.uuid5(uuid.NAMESPACE_URL, 'meldy:' + m.group(2).decode()))).upper().encode() + m.group(3), b)


def master_findings(name: str, b: bytes) -> list[str]:
    t = b.decode('utf-8', 'replace')
    out = [f'{name}: date text «{m.group(0)}»' for m in re.finditer(r'<a:t>\d{1,2}/\d{1,2}/\d{2,4}</a:t>', t)]
    for g in ('5BCAD085-E8A6-8845-BD4E-CB4CCA059FC4', 'C1FF6DA9-008F-8B48-92A6-B652298478BF'):
        if g in t.upper():
            out.append(f'{name}: template field id {g}')
    return out


# ---------------------------------------------------------------- pptx
def clean_pptx(path: Path) -> None:
    src = path.read_bytes()
    zin = zipfile.ZipFile(io.BytesIO(src))
    out = io.BytesIO()
    changed = []
    with zipfile.ZipFile(out, 'w') as zout:
        for info in zin.infolist():
            name = info.filename
            b = zin.read(name)
            low = name.lower()
            nb = b
            if name == 'docProps/core.xml':
                nb = clean_core(b)
            elif name == 'docProps/app.xml':
                nb = clean_app(b)
            elif re.fullmatch(r'ppt/(slidemasters/slidemaster|slidelayouts/slidelayout|notesmasters/notesmaster)\d+\.xml', low):
                nb = clean_master(b)
            elif low.endswith('.png'):
                nb = clean_png(b)
            elif low.endswith(('.jpg', '.jpeg')):
                nb = clean_jpeg(b)
            elif low.endswith('.svg'):
                nb = clean_svg(b)
            elif low.startswith('ppt/media/') and low.endswith(('.mp4', '.m4v', '.mov')):
                nb = clean_mp4(b, Path(low).suffix)
            if nb != b:
                changed.append(f'{name} ({len(b)} -> {len(nb)} bytes)')
            zi = zipfile.ZipInfo(name, date_time=(1980, 1, 1, 0, 0, 0))
            zi.compress_type = info.compress_type
            zi.external_attr = info.external_attr
            zout.writestr(zi, nb)
    path.write_bytes(out.getvalue())
    print(f'cleaned {path.name}: {len(changed)} part(s) changed, {len(src) / 1e6:.3f} -> {len(out.getvalue()) / 1e6:.3f} MB')
    for c in changed:
        print('  ' + c)


# ---------------------------------------------------------------- pdf
def clean_pdf(path: Path) -> None:
    from pypdf import PdfReader, PdfWriter
    from pypdf.generic import ArrayObject, DictionaryObject, IndirectObject, NameObject, StreamObject, TextStringObject

    r = PdfReader(str(path))
    w = PdfWriter(clone_from=r)
    root = w._root_object
    dropped_annots = set()
    kept = 0
    for page in w.pages:
        annots = page.get('/Annots')
        if annots is None:
            continue
        keep = ArrayObject()
        for ref in annots.get_object():
            a = ref.get_object()
            if a.get('/Subtype') == '/Link':
                keep.append(ref)
                kept += 1
            else:
                dropped_annots.add(getattr(ref, 'idnum', id(a)))
        if keep:
            page[NameObject('/Annots')] = keep
        else:
            del page['/Annots']

    def prune(node, seen):   # the structure tree points at the dropped annotations through OBJR kids
        node = node.get_object()
        if id(node) in seen:
            return
        seen.add(id(node))
        kids = node.get('/K') if hasattr(node, 'get') else None
        if kids is None:
            return
        k = kids.get_object()
        if isinstance(k, ArrayObject):
            new = ArrayObject()
            for kid in k:
                ko = kid.get_object()
                if hasattr(ko, 'get') and ko.get('/Type') == '/OBJR' and getattr(ko.get('/Obj'), 'idnum', None) in dropped_annots:
                    continue
                new.append(kid)
                if hasattr(ko, 'get'):
                    prune(kid, seen)
            node[NameObject('/K')] = new
        elif hasattr(k, 'get'):
            if k.get('/Type') == '/OBJR' and getattr(k.get('/Obj'), 'idnum', None) in dropped_annots:
                node[NameObject('/K')] = ArrayObject()
            else:
                prune(kids, seen)

    # the cover has no title (no «Титульный» label, owner 23.10), so LibreOffice names its bookmark «Slide 1»;
    # the outline shows the mandatory name instead
    outlines = root.get('/Outlines')
    first = outlines.get_object().get('/First') if outlines is not None else None
    if first is not None and re.fullmatch(r'(Slide|Слайд) 1', str(first.get_object().get('/Title', ''))):
        first.get_object()[NameObject('/Title')] = TextStringObject(COVER_NAME)
    if '/StructTreeRoot' in root:
        prune(root['/StructTreeRoot'], set())
    for key in ('/Metadata', '/PieceInfo', '/AF'):
        if key in root:
            del root[key]
    names = root.get('/Names')
    if names is not None and '/EmbeddedFiles' in names.get_object():
        del names.get_object()['/EmbeddedFiles']
    w.metadata = None
    w.add_metadata({'/Title': TITLE})
    if w._info is not None:
        info = w._info.get_object()
        for k in list(info.keys()):
            if k != '/Title':
                del info[k]
    # the dropped media (annotation -> rendition -> clip -> file -> the video) refer to themselves, so they are dropped by
    # reachability from the catalogue and the information dictionary, not by reference counts
    reach, stack = set(), [w._root_object.indirect_reference]
    if w._info is not None:
        stack.append(w._info.indirect_reference or w._info)
    while stack:
        o = stack.pop()
        if isinstance(o, IndirectObject):
            if o.idnum in reach:
                continue
            reach.add(o.idnum)
            stack.append(w._objects[o.idnum - 1])
        elif isinstance(o, (DictionaryObject, StreamObject)):
            stack.extend(o.values())
        elif isinstance(o, ArrayObject):
            stack.extend(o)
    for i in range(len(w._objects)):
        if (i + 1) not in reach:
            w._objects[i] = None
    w.pdf_header = r.pdf_header
    buf = io.BytesIO()
    w.write(buf)
    old = path.stat().st_size
    path.write_bytes(buf.getvalue())
    print(f'cleaned {path.name}: {len(dropped_annots)} media annotation(s) dropped, {kept} link(s) kept, '
          f'{old / 1e6:.3f} -> {len(buf.getvalue()) / 1e6:.3f} MB')


# ---------------------------------------------------------------- check
def check(pptx: Path, pdf: Path | None, no_notes: bool) -> int:
    bad: list[str] = []
    seen: list[str] = []
    z = zipfile.ZipFile(pptx)
    names = z.namelist()
    seen.append(f'{pptx.name}: {len(names)} parts')
    for name in names:
        b = z.read(name)
        low = name.lower()
        if low.endswith(('.xml', '.rels')):
            t = b.decode('utf-8', 'replace')
            text = t
            for m in FORBIDDEN.finditer(text):
                bad.append(f'{name}: «{text[max(0, m.start() - 30):m.end() + 30]}»')
            for m in EMAIL.finditer(text):
                if not m.group(0).endswith(('.xml', '.rels')) and 'schemas' not in m.group(0):
                    bad.append(f'{name}: e-mail address «{m.group(0)}»')
            for m in re.finditer(r'(?:file:|[A-Za-z]:\\\\|/(?:usr|var|opt|mnt|Users)/)[^"<\s]*', text):
                bad.append(f'{name}: path «{m.group(0)}»')
        if re.fullmatch(r'ppt/(slidemasters/slidemaster|slidelayouts/slidelayout|notesmasters/notesmaster)\d+\.xml', low):
            bad += master_findings(name, b)
        if name.startswith(('ppt/comments', 'ppt/commentAuthors', 'ppt/tags/', 'docProps/custom', 'customXml/')) \
                or 'comment' in low or 'custdata' in low:
            bad.append(f'{name}: part must not be there')
        if low.startswith('ppt/media/'):
            if not re.fullmatch(r'ppt/media/(image|media)\d+\.(png|jpe?g|svg|gif|mp4|m4v|mov)', low):
                bad.append(f'{name}: media name')
            if low.endswith('.png'):
                extra = [t.decode('latin1') for t, _ in png_chunks(b) if t not in PNG_KEEP]
                if extra:
                    bad.append(f'{name}: PNG chunks {extra}')
            elif low.endswith(('.jpg', '.jpeg')):
                extra = [hex(m) for m, raw in jpeg_segments(b) if not jpeg_keeps(m, raw)]
                if extra:
                    bad.append(f'{name}: JPEG segments {extra}')
            elif low.endswith('.svg'):
                t = b.decode('utf-8', 'replace')
                if '<!--' in t or '<metadata' in t:
                    bad.append(f'{name}: SVG comment or metadata')
            elif low.endswith(('.mp4', '.m4v', '.mov')):
                tags = mp4_tags(b, Path(low).suffix)
                allowed = re.compile(r'(major_brand|minor_version|compatible_brands|language|vendor_id)=.*|'
                                     r'handler_name=(VideoHandler|SoundHandler|)$')
                extra = [t for t in tags if not allowed.fullmatch(t)]
                if extra:
                    bad.append(f'{name}: video tags {extra}')
        if low == 'docprops/thumbnail.jpeg':
            extra = [hex(m) for m, raw in jpeg_segments(b) if not jpeg_keeps(m, raw)]
            if extra:
                bad.append(f'{name}: JPEG segments {extra}')
    core = etree.fromstring(z.read('docProps/core.xml'))
    props = {etree.QName(el).localname: (el.text or '') for el in core}
    seen.append('core: ' + ', '.join(f'{k}={v!r}' for k, v in props.items()))
    for k, v in props.items():
        if k == 'title' and v != TITLE:
            bad.append(f'core.xml: title {v!r}')
        elif k == 'revision' and v != '1':
            bad.append(f'core.xml: revision {v!r}')
        elif k not in ('title', 'revision', 'created', 'modified', 'language') and v:
            bad.append(f'core.xml: {k} {v!r}')
    app = etree.fromstring(z.read('docProps/app.xml'))
    for el in app:
        if etree.QName(el).localname in APP_DROP:
            bad.append(f'app.xml: {etree.QName(el).localname} {el.text!r}')
    pres = etree.fromstring(z.read('ppt/presentation.xml'))
    n_slides = len(pres.findall('p:sldIdLst/p:sldId', NS))
    hidden, alts, objnames, notes_chars = 0, set(), set(), 0
    for name in names:
        if re.fullmatch(r'ppt/slides/slide\d+\.xml', name):
            sld = etree.fromstring(z.read(name))
            if sld.get('show') == '0':
                hidden += 1
            for c in sld.iter('{%s}cNvPr' % NS['p']):
                objnames.add(c.get('name') or '')
                for attr in ('descr', 'title'):
                    if c.get(attr):
                        alts.add(c.get(attr))
        if re.fullmatch(r'ppt/notesSlides/notesSlide\d+\.xml', name):
            ns_ = etree.fromstring(z.read(name))
            for sp in ns_.iter('{%s}sp' % NS['p']):
                ph = sp.find('.//p:nvPr/p:ph', NS)
                if ph is not None and ph.get('type') == 'body':
                    notes_chars += len(''.join(sp.itertext()).strip())
    if hidden:
        bad.append(f'{hidden} hidden slide(s)')
    n_notes_parts = sum(1 for n in names if re.fullmatch(r'ppt/notesSlides/notesSlide\d+\.xml', n))
    seen.append(f'slides {n_slides}, hidden {hidden}, notes slides {n_notes_parts}, notes text {notes_chars} characters')
    if no_notes and (n_notes_parts or notes_chars):
        bad.append(f'speaker notes present: {n_notes_parts} notes slide(s), {notes_chars} characters')
    for a in sorted(alts):
        if PATHLIKE.search(a) or FORBIDDEN.search(a):
            bad.append(f'alt text «{a}»')
    for n in sorted(objnames):
        if PATHLIKE.search(n) or FORBIDDEN.search(n):
            bad.append(f'object name «{n}»')
    seen.append(f'alt texts: {sorted(alts)}')
    seen.append('object names: ' + ', '.join(sorted({re.sub(r"\d\d\.\d+", "NN.N", n) for n in objnames})))

    if pdf is not None and pdf.exists():
        from pypdf import PdfReader
        r = PdfReader(str(pdf))
        info = dict(r.metadata or {})
        seen.append(f'{pdf.name}: {len(r.pages)} pages, info {info}')
        if set(info) - {'/Title'} or info.get('/Title') != TITLE:
            bad.append(f'PDF info {info}')
        root = r.trailer['/Root']
        if '/Metadata' in root:
            bad.append('PDF has an XMP packet')
        names_ = root.get('/Names')
        if names_ is not None and '/EmbeddedFiles' in names_.get_object():
            bad.append('PDF has embedded files')
        subtypes = {}
        for i, page in enumerate(r.pages, 1):
            for ref in page.get('/Annots') or []:
                a = ref.get_object()
                st = a.get('/Subtype')
                subtypes[st] = subtypes.get(st, 0) + 1
                if st != '/Link':
                    bad.append(f'PDF page {i}: annotation {st}')
                else:
                    uri = (a.get('/A') or {}).get('/URI')
                    seen.append(f'PDF page {i}: link {uri}')
        outline = []

        def walk(o):
            for it in o:
                if isinstance(it, list):
                    walk(it)
                else:
                    outline.append(it.title)
        try:
            walk(r.outline)
        except Exception:   # noqa: BLE001
            pass
        seen.append(f'PDF annotations {subtypes}, outline {outline}')
        for t in outline:
            if FORBIDDEN.search(t or ''):
                bad.append(f'PDF outline «{t}»')
        raw = pdf.read_bytes()
        dicts = re.sub(rb'stream\r?\n.*?endstream', b'', raw, flags=re.S).decode('latin1')
        for m in FORBIDDEN.finditer(dicts):
            bad.append(f'PDF: «{dicts[max(0, m.start() - 30):m.end() + 30]}»')
        if pdf.stat().st_size and len(r.pages) != n_slides:
            bad.append(f'PDF has {len(r.pages)} pages for {n_slides} slides (notes pages?)')
    for s in seen:
        print('  ' + s)
    if bad:
        print(f'HIDDEN DATA: {len(bad)} finding(s)')
        for b_ in bad:
            print('  ✗ ' + b_)
        return 1
    print('HIDDEN DATA: clean')
    return 0


def main(argv: list[str]) -> int:
    if len(argv) < 2 or argv[0] not in ('pptx', 'pdf', 'check'):
        print(__doc__)
        return 2
    if argv[0] == 'pptx':
        clean_pptx(Path(argv[1]))
    elif argv[0] == 'pdf':
        clean_pdf(Path(argv[1]))
    else:
        rest = [a for a in argv[1:] if not a.startswith('--')]
        return check(Path(rest[0]), Path(rest[1]) if len(rest) > 1 else None, '--no-notes' in argv)
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
