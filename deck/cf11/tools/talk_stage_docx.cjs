'use strict';
// The speaker's Word file from talk/stage-talk.json (tools/talk_stage.py): for each slide its name and the clock, what
// the hall sees, what to say in large type (beside a film, the film's seconds in the left column), actions in bold
// brackets, and what to answer if asked in small grey type.
//   node deck/cf11/tools/talk_stage_docx.cjs <stage-talk.json> <out.docx>
const fs = require('fs');
const { Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell, WidthType, BorderStyle, AlignmentType,
  TabStopType, ShadingType } = require('docx');

const [src, out] = process.argv.slice(2);
const talk = JSON.parse(fs.readFileSync(src, 'utf8'));
const FONT = 'Arial';
const GREY = '6B7078';
const mmss = (s) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;
const NONE = { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' };
const noBorders = { top: NONE, bottom: NONE, left: NONE, right: NONE, insideHorizontal: NONE, insideVertical: NONE };

/** Runs of one line: [actions] bold and grey, the rest large. */
function runs(text, size = 28) {
  const out = [];
  for (const piece of text.split(/(\[[^\]]*\])/)) {
    if (!piece) continue;
    if (piece.startsWith('[')) out.push(new TextRun({ text: piece, font: FONT, size: size - 4, bold: true, color: GREY }));
    else out.push(new TextRun({ text: piece, font: FONT, size }));
  }
  return out;
}

const W = 9638; // A4 text width at 2 cm margins, twips
const kids = [
  new Paragraph({ spacing: { after: 80 }, children: [new TextRun({ text: talk.title, font: FONT, size: 40, bold: true })] }),
  new Paragraph({ spacing: { after: 60 }, children: [new TextRun({ text: `${talk.slides.length} слайдов, ${talk.words} слов, около ${Math.round(talk.seconds / 60)} минут в спокойном темпе.`, font: FONT, size: 22, color: GREY })] }),
  new Paragraph({ spacing: { after: 60 }, children: [new TextRun({ text: 'Крупный текст говорите вслух. Серым сверху — что видит зал. На слайдах с роликом слева секунды ролика: это момент, к которому относится фраза. Ролики идут по кругу, ждать их не нужно.', font: FONT, size: 22, color: GREY })] }),
  new Paragraph({ spacing: { after: 300 }, children: [new TextRun({ text: 'Жирным в квадратных скобках — действие. Мелким серым после слайда — что ответить, если спросят.', font: FONT, size: 22, color: GREY })] }),
];
for (const [i, s] of talk.slides.entries()) {
  kids.push(new Paragraph({
    keepNext: true, spacing: { before: i ? 360 : 0, after: 60 },
    border: { top: { style: BorderStyle.SINGLE, size: 6, color: 'D9DCE1', space: 8 } },
    tabStops: [{ type: TabStopType.RIGHT, position: W }],
    children: [
      new TextRun({ text: `Слайд ${i + 1}. ${s.name}`, font: FONT, size: 26, bold: true }),
      new TextRun({ text: `\t${mmss(s.start)}–${mmss(s.end)}`, font: FONT, size: 22, color: GREY }),
    ],
  }));
  if (s.screen) kids.push(new Paragraph({ keepNext: true, spacing: { after: 140 }, children: [new TextRun({ text: `На экране: ${s.screen}`, font: FONT, size: 20, italics: true, color: GREY })] }));
  const timed = s.parts.some((p) => p.at);
  if (timed) {
    const rows = s.parts.map((p) => new TableRow({
      cantSplit: true,
      children: [
        new TableCell({ width: { size: 1000, type: WidthType.DXA }, margins: { top: 40, bottom: 120, right: 120 },
          children: [new Paragraph({ children: [new TextRun({ text: p.at ? `${p.at[0]}–${p.at[1]} с` : '', font: FONT, size: 20, color: GREY })] })] }),
        new TableCell({ width: { size: W - 1000, type: WidthType.DXA }, margins: { top: 40, bottom: 120 },
          children: [new Paragraph({ spacing: { line: 320 }, children: runs(p.text) })] }),
      ],
    }));
    kids.push(new Table({ width: { size: W, type: WidthType.DXA }, columnWidths: [1000, W - 1000], borders: noBorders, rows }));
  } else {
    for (const p of s.parts) kids.push(new Paragraph({ spacing: { after: 140, line: 320 }, children: runs(p.text) }));
  }
  for (const a of s.asked) {
    kids.push(new Paragraph({ spacing: { before: 60, after: 60 }, indent: { left: 360 },
      shading: { type: ShadingType.CLEAR, color: 'auto', fill: 'F4F5F7' },
      children: [new TextRun({ text: a, font: FONT, size: 18, color: GREY })] }));
  }
}
for (const a of talk.appendix || []) {
  kids.push(new Paragraph({ pageBreakBefore: true, spacing: { after: 160 }, children: [new TextRun({ text: a.title, font: FONT, size: 30, bold: true })] }));
  for (const line of a.lines) {
    const label = line.endsWith(':');
    kids.push(new Paragraph({ keepNext: label, spacing: { before: label ? 220 : 0, after: label ? 80 : 140, line: label ? 240 : 320 },
      children: label ? [new TextRun({ text: line.slice(0, -1), font: FONT, size: 22, bold: true, color: GREY })] : runs(line, 26) }));
  }
}
const doc = new Document({
  creator: 'Meldy', title: talk.title,
  sections: [{ properties: { page: { size: { width: 11906, height: 16838 }, margin: { top: 1134, bottom: 1134, left: 1134, right: 1134 } } }, children: kids }],
});
Packer.toBuffer(doc).then((buf) => { fs.writeFileSync(out, buf); console.log(`${out}: ${talk.slides.length} slides, ${talk.words} words`); });
