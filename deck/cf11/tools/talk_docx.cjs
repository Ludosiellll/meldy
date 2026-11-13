'use strict';
// The talk as a Word file for the speaker: every slide's notes (the talk, then what to say if asked) from a slides
// folder, with the seconds each slide takes at 110 words a minute.
//
//   node deck/cf11/tools/talk_docx.cjs <slides dir> <out.docx> [--title "…"]
const fs = require('fs');
const path = require('path');
const { Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType } = require('docx');

const [dir, out] = process.argv.slice(2);
const titleArg = process.argv.indexOf('--title');
const TITLE = titleArg > 0 ? process.argv[titleArg + 1] : 'Meldy. Текст выступления';
const WPM = 110;
const ASIDE = ['Если спросят', 'О записи', 'Докладчику', 'О ролике'];
const plain = (s) => s.replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/<[^>]+>/g, '').trim();

const slides = fs.readdirSync(dir).filter((f) => /^\d\d-.*\.html$/.test(f)).sort().map((f) => {
  const html = fs.readFileSync(path.join(dir, f), 'utf8');
  const name = (html.match(/<div class="sec"[^>]*>(.*?)<\/div>/) || [null, 'Титульный'])[1];
  const claim = (html.match(/<div class="claim"[^>]*>(.*?)<\/div>/s) || [null, ''])[1];
  const notes = (html.match(/<template data-pptx="notes">([\s\S]*?)<\/template>/) || [null, ''])[1];
  const paras = notes.split(/\n\s*\n/).map((p) => p.replace(/\s+/g, ' ').trim()).filter(Boolean);
  const talk = paras.filter((p) => !ASIDE.some((a) => p.startsWith(a)));
  const aside = paras.filter((p) => ASIDE.some((a) => p.startsWith(a)));
  const words = talk.join(' ').split(/\s+/).filter(Boolean).length;
  return { n: Number(f.slice(0, 2)), name: plain(name), claim: plain(claim.replace(/<br>/g, ' / ')), talk, aside, words };
});

const FONT = 'Arial';
const run = (text, o = {}) => new TextRun({ text, font: FONT, size: 26, ...o });
const total = slides.reduce((a, s) => a + s.words, 0);
const mmss = (sec) => `${Math.floor(sec / 60)} мин ${String(Math.round(sec % 60)).padStart(2, '0')} с`;
const kids = [
  new Paragraph({ heading: HeadingLevel.TITLE, spacing: { after: 120 }, children: [new TextRun({ text: TITLE, font: FONT, size: 44, bold: true })] }),
  new Paragraph({ spacing: { after: 80 }, children: [run(`${slides.length} слайдов, ${total} слов, около ${mmss((total / WPM) * 60)} в спокойном темпе.`, { color: '555555' })] }),
  new Paragraph({ spacing: { after: 360 }, children: [run('Крупный текст говорят вслух. Мелкий серый текст под ним нужен только для ответов на вопросы.', { color: '555555' })] }),
];
for (const s of slides) {
  const sec = Math.max(5, Math.round(((s.words / WPM) * 60) / 5) * 5);
  kids.push(new Paragraph({
    heading: HeadingLevel.HEADING_2, keepNext: true, spacing: { before: 320, after: 60 },
    children: [new TextRun({ text: `Слайд ${s.n}. ${s.name}`, font: FONT, size: 30, bold: true }), new TextRun({ text: `   около ${sec} с`, font: FONT, size: 22, color: '777777' })],
  }));
  if (s.claim) kids.push(new Paragraph({ keepNext: true, spacing: { after: 120 }, children: [run(`На слайде: ${s.claim}`, { size: 22, color: '777777', italics: true })] }));
  for (const p of s.talk) kids.push(new Paragraph({ spacing: { after: 140, line: 340 }, alignment: AlignmentType.LEFT, children: [run(p)] }));
  for (const p of s.aside) kids.push(new Paragraph({ spacing: { after: 100, line: 280 }, indent: { left: 360 }, children: [run(p, { size: 20, color: '666666' })] }));
}
const doc = new Document({ creator: 'Meldy', title: TITLE, sections: [{ properties: { page: { margin: { top: 1000, bottom: 1000, left: 1200, right: 1200 } } }, children: kids }] });
Packer.toBuffer(doc).then((buf) => { fs.writeFileSync(out, buf); console.log(`${out}: ${slides.length} slides, ${total} words, ${mmss((total / WPM) * 60)}`); slides.forEach((s) => console.log(`  ${String(s.n).padStart(2, '0')} ${s.words}`)); });
