"""Onest in PowerPoint: which typeface name each CSS weight maps to, and how the faces are embedded.

The static Onest TTFs name themselves for GDI-style (RIBBI) families, which is what PowerPoint matches:
    Onest-400.ttf  nameID 1 "Onest"           nameID 2 "Regular"   -> typeface "Onest",          b=0
    Onest-500.ttf  nameID 1 "Onest Medium"    nameID 2 "Regular"   -> typeface "Onest Medium",   b=0
    Onest-600.ttf  nameID 1 "Onest SemiBold"  nameID 2 "Regular"   -> typeface "Onest SemiBold", b=0
    Onest-700.ttf  nameID 1 "Onest"           nameID 2 "Bold"      -> typeface "Onest",          b=1
(500/600 carry the typographic family "Onest" only in nameIDs 16/17, which PowerPoint does not use for matching.)
`check_font_names` re-reads the files so a font update cannot silently break the mapping.

Embedding: each face is written as an uncompressed Embedded OpenType (.fntdata, application/x-fontdata) in the
layout LibreOffice's PPTX export uses for PowerPoint (vcl/source/font/EOTConverter.cxx: version 0x00020002,
no MTX compression, no XOR, null-terminated UTF-16 names), listed in p:embeddedFontLst with
p:presentation/@embedTrueTypeFonts="1".
"""
from __future__ import annotations

import struct
from dataclasses import dataclass
from pathlib import Path

from fontTools.ttLib import TTFont
from lxml import etree

NS_P = 'http://schemas.openxmlformats.org/presentationml/2006/main'
NS_R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
RT_FONT = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/font'
CT_FONTDATA = 'application/x-fontdata'


@dataclass(frozen=True)
class Face:
    weight: int          # CSS weight of the static file
    typeface: str        # what a:latin/@typeface and p:font/@typeface say
    bold: bool           # a:rPr/@b
    file: str            # file name in design/fonts/
    slot: str            # p:embeddedFont child: regular | bold


FACES = {
    400: Face(400, 'Onest', False, 'Onest-400.ttf', 'regular'),
    500: Face(500, 'Onest Medium', False, 'Onest-500.ttf', 'regular'),
    600: Face(600, 'Onest SemiBold', False, 'Onest-600.ttf', 'regular'),
    700: Face(700, 'Onest', True, 'Onest-700.ttf', 'bold'),
}


def face_for_weight(weight: float) -> Face:
    """Nearest static face for a computed CSS weight (100-900); 300 and below use 400, 800+ use 700."""
    w = int(weight or 400)
    if w < 450:
        return FACES[400]
    if w < 550:
        return FACES[500]
    if w < 650:
        return FACES[600]
    return FACES[700]


def _name(font: TTFont, name_id: int) -> str:
    rec = font['name'].getName(name_id, 3, 1, 0x409) or font['name'].getName(name_id, 1, 0, 0)
    return rec.toUnicode() if rec else ''


def check_font_names(font_dir: Path) -> list[str]:
    """Problems with the font files vs FACES (empty list = the mapping is right)."""
    problems = []
    for face in FACES.values():
        p = Path(font_dir) / face.file
        if not p.exists():
            problems.append(f'{p}: missing')
            continue
        f = TTFont(p, lazy=True)
        fam, sub = _name(f, 1), _name(f, 2)
        if fam != face.typeface:
            problems.append(f'{face.file}: nameID 1 is {fam!r}, the deck references {face.typeface!r}')
        want_sub = 'Bold' if face.bold else 'Regular'
        if sub != want_sub:
            problems.append(f'{face.file}: nameID 2 is {sub!r}, expected {want_sub!r}')
        if f['OS/2'].usWeightClass != face.weight:
            problems.append(f'{face.file}: usWeightClass {f["OS/2"].usWeightClass} != {face.weight}')
        if f['OS/2'].fsType & 0x000E and not f['OS/2'].fsType & 0x0008:
            problems.append(f'{face.file}: fsType {f["OS/2"].fsType:#x} forbids embedding')
    return problems


def vertical_metrics(font_path: Path) -> tuple[float, float, float]:
    """(ascent, descent, lineGap) as fractions of the em, as LibreOffice and Chromium read them
    (OS/2 typo metrics when USE_TYPO_METRICS is set, else hhea)."""
    f = TTFont(font_path, lazy=True)
    upm = f['head'].unitsPerEm
    os2, hhea = f['OS/2'], f['hhea']
    if os2.fsSelection & (1 << 7):
        return os2.sTypoAscender / upm, -os2.sTypoDescender / upm, os2.sTypoLineGap / upm
    return hhea.ascent / upm, -hhea.descent / upm, hhea.lineGap / upm


# ------------------------------------------------------------------------------------------------ EOT
def _eot_name(font: TTFont, name_id: int) -> bytes:
    s = _name(font, name_id)
    if not s:
        return struct.pack('<HH', 0, 0)
    data = s.encode('utf-16-le')
    return struct.pack('<HH', 0, len(data) + 2) + data + b'\0\0'


def ttf_to_eot(ttf_path: Path) -> bytes:
    """Uncompressed EOT, byte-compatible with LibreOffice's EOTConverter (the format its PPTX export embeds)."""
    data = Path(ttf_path).read_bytes()
    font = TTFont(ttf_path, lazy=True)
    os2, head = font['OS/2'], font['head']
    pan = os2.panose
    panose = bytes([pan.bFamilyType, pan.bSerifStyle, pan.bWeight, pan.bProportion, pan.bContrast,
                    pan.bStrokeVariation, pan.bArmStyle, pan.bLetterForm, pan.bMidline, pan.bXHeight])
    names = b''.join(_eot_name(font, i) for i in (1, 2, 5, 4))   # family, subfamily, version, full name
    tail = (struct.pack('<HH', 0, 0)            # Padding5, RootStringSize (no root string)
            + bytes([0x42, 0x53, 0x47, 0x50])   # RootStringCheckSum of an empty root string (0x50475342)
            + struct.pack('<I', 1252)           # EUDCCodePage
            + struct.pack('<HH', 0, 0)          # Padding6, SignatureSize
            + struct.pack('<II', 0, 0))         # EUDCFlags, EUDCFontSize
    fixed = (struct.pack('<III', len(data), 0x00020002, 0)        # FontDataSize, Version, Flags
             + panose + bytes([0, os2.fsSelection & 1])           # Charset (0, as LibreOffice), Italic
             + struct.pack('<IHH', os2.usWeightClass, os2.fsType, 0x504C)
             + struct.pack('<IIII', os2.ulUnicodeRange1, os2.ulUnicodeRange2, os2.ulUnicodeRange3, os2.ulUnicodeRange4)
             + struct.pack('<II', os2.ulCodePageRange1, os2.ulCodePageRange2)
             + struct.pack('<I', head.checkSumAdjustment)
             + b'\0' * 16)                                        # Reserved1..4
    total = 4 + len(fixed) + len(names) + len(tail) + len(data)
    return struct.pack('<I', total) + fixed + names + tail + data


def parse_eot_header(blob: bytes) -> dict:
    """Read back the fields ttf_to_eot writes (used by the tests and check_pptx.py)."""
    eot_size, font_size, version, flags = struct.unpack_from('<IIII', blob, 0)
    off = 16 + 10
    charset, italic = blob[off], blob[off + 1]
    weight, fstype, magic = struct.unpack_from('<IHH', blob, off + 2)
    off = 80                     # fixed header size; each name is Padding (u16), Size (u16), UTF-16LE + NUL
    names = []
    for _ in range(4):
        _, size = struct.unpack_from('<HH', blob, off)
        off += 4
        names.append(blob[off:off + max(0, size - 2)].decode('utf-16-le'))
        off += size
    return {'eotSize': eot_size, 'fontDataSize': font_size, 'version': version, 'flags': flags, 'charset': charset,
            'italic': italic, 'weight': weight, 'fsType': fstype, 'magic': magic, 'family': names[0],
            'subfamily': names[1], 'versionName': names[2], 'fullName': names[3],
            'fontData': blob[len(blob) - font_size:]}


def embed_fonts(prs, font_dir: Path, weights=(400, 500, 600, 700)) -> list[str]:
    """Embed the given static faces; returns the typefaces listed in p:embeddedFontLst."""
    from pptx.opc.package import Part
    from pptx.opc.packuri import PackURI

    pres = prs.part._element
    groups: dict[str, dict[str, Face]] = {}
    for w in sorted(set(weights)):
        face = FACES[w]
        groups.setdefault(face.typeface, {})[face.slot] = face
    lst = etree.Element(f'{{{NS_P}}}embeddedFontLst')
    n = 0
    for typeface in sorted(groups, key=lambda t: (t != 'Onest', t)):
        ef = etree.SubElement(lst, f'{{{NS_P}}}embeddedFont')
        etree.SubElement(ef, f'{{{NS_P}}}font', typeface=typeface, pitchFamily='2', charset='0')
        for slot in ('regular', 'bold', 'italic', 'boldItalic'):
            face = groups[typeface].get(slot)
            if not face:
                continue
            n += 1
            part = Part(PackURI(f'/ppt/fonts/font{n}.fntdata'), CT_FONTDATA, prs.part.package,
                        ttf_to_eot(Path(font_dir) / face.file))
            rid = prs.part.relate_to(part, RT_FONT)
            etree.SubElement(ef, f'{{{NS_P}}}{slot}').set(f'{{{NS_R}}}id', rid)
    old = pres.find(f'{{{NS_P}}}embeddedFontLst')
    if old is not None:
        pres.remove(old)
    pres.find(f'{{{NS_P}}}notesSz').addnext(lst)
    pres.set('embedTrueTypeFonts', '1')
    if 'saveSubsetFonts' in pres.attrib:
        del pres.attrib['saveSubsetFonts']   # keep every glyph so the owner can still edit text in PowerPoint
    return sorted(groups)
