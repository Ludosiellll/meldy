"""The package every deck starts from: python-pptx's default template reduced to one master + one layout.

* 16:9 at 13.333 x 7.5 in (12192000 x 6858000 EMU), no 4:3 `type` attribute left behind.
* One layout ("Meldy", from "Title Only") whose title placeholder each slide re-positions; the other ten layouts go.
* Theme "Meldy": the deck tokens as theme colours (hyperlink = the label blue) and Onest as the theme fonts, so text
  the owner adds in PowerPoint starts in the deck's font and ink colour.
* Master: canvas background (#F3F3F0), title style = the mandatory label (Onest SemiBold, caps, label blue).
* No printer settings blob, ru-RU as the default language, pictures never auto-compressed by PowerPoint.
"""
from __future__ import annotations

from lxml import etree
from pptx import Presentation
from pptx.dml.color import RGBColor
from pptx.opc.constants import RELATIONSHIP_TYPE as RT

from .units import SLIDE_H_EMU, SLIDE_W_EMU, emu

NS_A = 'http://schemas.openxmlformats.org/drawingml/2006/main'
NS_P = 'http://schemas.openxmlformats.org/presentationml/2006/main'
A, P = f'{{{NS_A}}}', f'{{{NS_P}}}'

TOKENS = {
    'canvas': 'F3F3F0', 'surface': 'FFFFFF', 'ink': '0B121C', 'muted': '4B515B', 'faint': '8A8F97', 'line': 'E3E3DD',
    'blue': '2869DD', 'label': '1F5BC6', 'yellow': 'F4C45B', 'named': 'E9B13C', 'pink': 'F5B6CD',
}
THEME_COLORS = {   # scheme slot -> token
    'dk1': 'ink', 'lt1': 'surface', 'dk2': 'muted', 'lt2': 'canvas',
    'accent1': 'blue', 'accent2': 'yellow', 'accent3': 'label', 'accent4': 'named', 'accent5': 'pink', 'accent6': 'faint',
    'hlink': 'label', 'folHlink': 'label',
}
MAJOR_FONT, MINOR_FONT = 'Onest SemiBold', 'Onest'
LAYOUT_NAME = 'Meldy'


def _theme(blob: bytes) -> bytes:
    root = etree.fromstring(blob)
    root.set('name', 'Meldy')
    te = root.find(f'{A}themeElements')
    cs = te.find(f'{A}clrScheme')
    cs.set('name', 'Meldy')
    for slot, token in THEME_COLORS.items():
        el = cs.find(f'{A}{slot}')
        for c in list(el):
            el.remove(c)
        etree.SubElement(el, A + 'srgbClr', val=TOKENS[token])
    fs = te.find(f'{A}fontScheme')
    fs.set('name', 'Meldy')
    for kind, face in (('majorFont', MAJOR_FONT), ('minorFont', MINOR_FONT)):
        f = fs.find(f'{A}{kind}')
        f.find(f'{A}latin').set('typeface', face)
        for script_font in f.findall(f'{A}font'):
            if script_font.get('script') == 'Cyrl':
                script_font.set('typeface', face)
    fmt = te.find(f'{A}fmtScheme')
    fmt.set('name', 'Meldy')
    # no theme effect styles (shadows) that a shape could pick up through a style reference
    for es in fmt.iter(f'{A}effectStyle'):
        for c in list(es):
            es.remove(c)
        etree.SubElement(es, A + 'effectLst')
    return etree.tostring(root, xml_declaration=True, encoding='UTF-8', standalone=True)


def _title_style(master_el):
    ts = master_el.find(f'{P}txStyles/{P}titleStyle')
    lvl = ts.find(f'{A}lvl1pPr')
    for c in list(lvl):
        lvl.remove(c)
    lvl.set('algn', 'l')
    ln = etree.SubElement(lvl, A + 'lnSpc')
    etree.SubElement(ln, A + 'spcPct', val='100000')
    sb = etree.SubElement(lvl, A + 'spcBef')
    etree.SubElement(sb, A + 'spcPts', val='0')
    etree.SubElement(lvl, A + 'buNone')
    d = etree.SubElement(lvl, A + 'defRPr', sz='2000', b='0', kern='1200', cap='all', spc='240')
    sf = etree.SubElement(d, A + 'solidFill')
    etree.SubElement(sf, A + 'srgbClr', val=TOKENS['label'])
    etree.SubElement(d, A + 'latin', typeface='+mj-lt')
    etree.SubElement(d, A + 'ea', typeface='+mj-ea')
    etree.SubElement(d, A + 'cs', typeface='+mj-cs')


def new_presentation() -> Presentation:
    prs = Presentation()
    prs.slide_width, prs.slide_height = SLIDE_W_EMU, SLIDE_H_EMU
    pres = prs.part._element
    sld_sz = pres.find(f'{P}sldSz')
    if 'type' in sld_sz.attrib:
        del sld_sz.attrib['type']
    pres.set('autoCompressPictures', '0')
    for d in pres.iter(f'{A}defRPr'):
        if d.getparent().tag == f'{A}defPPr':
            d.set('lang', 'ru-RU')

    master = prs.slide_masters[0]
    keep = next(l for l in master.slide_layouts if l.name == 'Title Only')
    for layout in list(master.slide_layouts):
        if layout is not keep:
            master.slide_layouts.remove(layout)
    keep._element.cSld.set('name', LAYOUT_NAME)
    title = next(s for s in keep.placeholders if s.placeholder_format.type is not None and 'TITLE' in str(s.placeholder_format.type))
    title.left, title.top, title.width, title.height = emu(128), emu(112), emu(1664), emu(48)

    theme = master.part.part_related_by(RT.THEME)
    theme._blob = _theme(theme.blob)
    bg = master.background.fill
    bg.solid()
    bg.fore_color.rgb = RGBColor.from_string(TOKENS['canvas'])
    _title_style(master._element)

    for rel in list(prs.part.rels.values()):
        if rel.reltype == RT.PRINTER_SETTINGS:
            prs.part.drop_rel(rel.rId)
    return prs


def app_properties_xml(n_slides: int, n_notes: int, n_media: int, words: int, paragraphs: int, titles: list[str]) -> bytes:
    """docProps/app.xml: counts, slide titles; no company or template names. PowerPoint rewrites it on save."""
    ns = 'http://schemas.openxmlformats.org/officeDocument/2006/extended-properties'
    vt = 'http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes'
    root = etree.Element(f'{{{ns}}}Properties', nsmap={None: ns, 'vt': vt})

    def add(tag, text):
        etree.SubElement(root, f'{{{ns}}}{tag}').text = str(text)

    add('TotalTime', 0)
    add('Words', words)
    add('Application', 'Meldy deck compiler (python-pptx)')
    add('PresentationFormat', 'Widescreen')
    add('Paragraphs', paragraphs)
    add('Slides', n_slides)
    add('Notes', n_notes)
    add('HiddenSlides', 0)
    add('MMClips', n_media)
    add('ScaleCrop', 'false')
    hp = etree.SubElement(root, f'{{{ns}}}HeadingPairs')
    vec = etree.SubElement(hp, f'{{{vt}}}vector', size='4', baseType='variant')
    for name, count in (('Theme', 1), ('Slide Titles', len(titles))):
        v1 = etree.SubElement(vec, f'{{{vt}}}variant')
        etree.SubElement(v1, f'{{{vt}}}lpstr').text = name
        v2 = etree.SubElement(vec, f'{{{vt}}}variant')
        etree.SubElement(v2, f'{{{vt}}}i4').text = str(count)
    tp = etree.SubElement(root, f'{{{ns}}}TitlesOfParts')
    vec = etree.SubElement(tp, f'{{{vt}}}vector', size=str(1 + len(titles)), baseType='lpstr')
    for t in ['Meldy'] + titles:
        etree.SubElement(vec, f'{{{vt}}}lpstr').text = t
    add('LinksUpToDate', 'false')
    add('SharedDoc', 'false')
    add('HyperlinksChanged', 'false')
    return etree.tostring(root, xml_declaration=True, encoding='UTF-8', standalone=True)
