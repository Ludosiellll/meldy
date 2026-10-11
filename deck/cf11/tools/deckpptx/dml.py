"""Small DrawingML helpers shared by text, shapes and pictures."""
from __future__ import annotations

from lxml import etree

NS_A = 'http://schemas.openxmlformats.org/drawingml/2006/main'
A = f'{{{NS_A}}}'


def color_el(tag: str, color: dict | None, extra_alpha: float = 1.0):
    """<a:solidFill><a:srgbClr val=..><a:alpha/></..> for {'rgb','alpha'} (tag = solidFill); None -> <a:noFill/>."""
    if not color:
        return etree.Element(A + 'noFill')
    fill = etree.Element(A + tag)
    clr = etree.SubElement(fill, A + 'srgbClr', val=color['rgb'])
    alpha = color.get('alpha', 1.0) * extra_alpha
    if alpha < 0.9995:
        etree.SubElement(clr, A + 'alpha', val=str(int(round(max(0.0, alpha) * 100000))))
    return fill
