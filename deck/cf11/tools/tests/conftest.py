import sys
from pathlib import Path

TOOLS = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(TOOLS))

DECK = TOOLS.parent
FONTS = DECK / 'design' / 'fonts'
PML_XSD = Path('/mnt/skills/public/pptx/scripts/office/schemas/ISO-IEC29500-4_2016/pml.xsd')
