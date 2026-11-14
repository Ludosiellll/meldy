'use strict';
// The jury's questions and answers as a Word file for the speaker, from a Markdown note:
//   # Title / plain paragraphs (the intro) / «- » bullets
//   ## Section            (a part: architecture, AI, data…; each starts on a new page; «Связи» is left out)
//   ### Question          (numbered through the document, listed in the contents at the start)
//   **Сказать:** …        (large: what to say)
//   **Если спросят подробнее:** …   (normal)
//   **Не говорить:** …    (small, dark red)
//   **Опора:** …          (where it was checked: kept in the note, left out of the Word file)
//   node deck/cf11/tools/qa_docx.cjs <note.md> <out.docx>
const fs = require('fs');
const { Document, Packer, Paragraph, TextRun, LevelFormat, AlignmentType, BorderStyle, TabStopType } = require('docx');

const [src, out] = process.argv.slice(2);
const md = fs.readFileSync(src, 'utf8').replace(/^---\n[\s\S]*?\n---\n/, '').replace(/<!--[\s\S]*?-->/g, '');
const FONT = 'Arial';
const GREY = '5F646C';
const W = 9638;

/** Inline Markdown: **bold** and `code` (shown plain). */
function inline(text, base = {}) {
  const runs = [];
  for (const piece of text.split(/(\*\*[^*]+\*\*)/)) {
    if (!piece) continue;
    const bold = piece.startsWith('**') && piece.endsWith('**');
    const t = (bold ? piece.slice(2, -2) : piece).replace(/`([^`]+)`/g, '$1').replace(/\[\[([^\]|]+\|)?([^\]]+)\]\]/g, '$2');
    runs.push(new TextRun({ text: t, font: FONT, size: 22, ...base, bold: bold || base.bold }));
  }
  return runs;
}

// --- parse
const lines = md.split('\n');
let title = '';
const intro = [];
const sections = [];
let sec = null, q = null, field = null;
for (const raw of lines) {
  const line = raw.replace(/\s+$/, '');
  if (line.startsWith('# ')) { title = line.slice(2).trim(); continue; }
  if (line.startsWith('## ')) { sec = { title: line.slice(3).trim(), items: [], text: [] }; if (sec.title !== 'Связи') sections.push(sec); q = null; field = null; continue; }
  if (line.startsWith('### ')) { q = { q: line.slice(4).trim(), fields: [] }; (sec ?? (sec = { title: '', items: [], text: [] }, sections.push(sec), sec)).items.push(q); field = null; continue; }
  const m = line.match(/^\*\*([^*]+?):\*\*\s*(.*)$/);
  if (m && q) { field = { label: m[1].trim(), text: [m[2]] }; q.fields.push(field); continue; }
  if (!line.trim()) { field = null; continue; }
  if (field) field.text.push(line.trim());
  else if (q) q.fields.push({ label: '', text: [line.trim()] });
  else if (sec) sec.text.push(line);
  else intro.push(line);
}

// --- render
const kids = [];
kids.push(new Paragraph({ spacing: { after: 120 }, children: [new TextRun({ text: title, font: FONT, size: 40, bold: true })] }));
const bullet = (text, opts = {}) => new Paragraph({ numbering: { reference: 'dots', level: 0 }, spacing: { after: 60 }, children: inline(text, opts) });
for (const l of intro) {
  if (l.startsWith('- ')) kids.push(bullet(l.slice(2)));
  else kids.push(new Paragraph({ spacing: { after: 100 }, children: inline(l, { color: GREY }) }));
}
// contents
let n = 0;
kids.push(new Paragraph({ spacing: { before: 240, after: 100 }, children: [new TextRun({ text: 'Вопросы', font: FONT, size: 28, bold: true })] }));
for (const s of sections) {
  if (!s.items.length) continue;
  kids.push(new Paragraph({ spacing: { before: 140, after: 40 }, children: [new TextRun({ text: s.title, font: FONT, size: 22, bold: true })] }));
  for (const it of s.items) {
    n += 1;
    kids.push(new Paragraph({ spacing: { after: 20 }, indent: { left: 280 }, children: [new TextRun({ text: `${n}. ${it.q}`, font: FONT, size: 20, color: GREY })] }));
  }
}
n = 0;
for (const s of sections) {
  kids.push(new Paragraph({ pageBreakBefore: true, spacing: { after: 160 }, children: [new TextRun({ text: s.title, font: FONT, size: 32, bold: true })] }));
  for (const l of s.text) {
    if (l.startsWith('- ')) kids.push(bullet(l.slice(2), { size: 24 }));
    else kids.push(new Paragraph({ spacing: { after: 100 }, children: inline(l, { size: 24 }) }));
  }
  for (const it of s.items) {
    n += 1;
    kids.push(new Paragraph({
      keepNext: true, spacing: { before: 300, after: 80 },
      border: { top: { style: BorderStyle.SINGLE, size: 4, color: 'DADDE2', space: 8 } },
      children: [new TextRun({ text: `${n}. ${it.q}`, font: FONT, size: 26, bold: true })],
    }));
    for (const f of it.fields) {
      const label = f.label.toLowerCase();
      if (label.startsWith('опора')) continue;
      const text = f.text.join(' ');
      if (label.startsWith('сказать') || !label) {
        kids.push(new Paragraph({ spacing: { after: 100, line: 320 }, children: inline(text, { size: 26 }) }));
      } else if (label.startsWith('не говорить')) {
        kids.push(new Paragraph({ spacing: { after: 80 }, indent: { left: 280 },
          children: [new TextRun({ text: 'Не говорить: ', font: FONT, size: 19, bold: true, color: '9B2C2C' }), ...inline(text, { size: 19, color: '9B2C2C' })] }));
      } else {
        kids.push(new Paragraph({ spacing: { after: 80 }, indent: { left: 280 },
          children: [new TextRun({ text: `${f.label}: `, font: FONT, size: 20, bold: true, color: GREY }), ...inline(text, { size: 20, color: GREY })] }));
      }
    }
  }
}
const doc = new Document({
  creator: 'Meldy', title,
  numbering: { config: [{ reference: 'dots', levels: [{ level: 0, format: LevelFormat.BULLET, text: '•', alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 360, hanging: 240 } } } }] }] },
  sections: [{ properties: { page: { size: { width: 11906, height: 16838 }, margin: { top: 1134, bottom: 1134, left: 1134, right: 1134 } } }, children: kids }],
});
Packer.toBuffer(doc).then((buf) => { fs.writeFileSync(out, buf); console.log(`${out}: ${n} questions in ${sections.length} parts`); });
