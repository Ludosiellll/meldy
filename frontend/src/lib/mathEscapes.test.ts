import { describe, expect, it } from 'vitest';
import katex from 'katex';
import { repairFormula, repairMathEscapes } from './mathEscapes';

const TAB = '\t';
const FF = '\f';
const BS = '\b';
const CR = '\r';
const LF = '\n';

/** What a lecture analysed before 2026-10-08 keeps: json.loads read the commands' backslashes as escapes. */
const STORED = [
  '## Работа с соединениями и агрегатными функциями',
  '',
  `Для подсчёта используются агрегатные функции ($${TAB}ext{COUNT}$, $${TAB}ext{SUM}$, $${TAB}ext{MAX}$).`,
  `Доля строк — $${FF}rac{n}{N}$, коэффициент $${BS}eta$, плотность $${CR}ho$, условие $a ${LF}eq b$, градиент $${LF}abla f$.`,
  '',
  '$$',
  `${TAB}ext{SELECT} ${TAB}imes ${FF}rac{1}{n} ${CR}ightarrow x`,
  '$$',
  '',
  '- пункт один',
  '- not a formula: a new line here stays',
].join('\n');

describe('repairMathEscapes', () => {
  it('puts the backslash back inside inline and display formulas', () => {
    const fixed = repairMathEscapes(STORED);
    expect(fixed).toContain('($\\text{COUNT}$, $\\text{SUM}$, $\\text{MAX}$)');
    expect(fixed).toContain('Доля строк — $\\frac{n}{N}$, коэффициент $\\beta$, плотность $\\rho$, условие $a \\neq b$, градиент $\\nabla f$.');
    expect(fixed).toContain('$$\n\\text{SELECT} \\times \\frac{1}{n} \\rightarrow x\n$$');
    expect(fixed).not.toMatch(/[\t\f\b\r]/);
  });

  it('keeps the text around the formulas, its line breaks included', () => {
    const fixed = repairMathEscapes(STORED);
    // Two of the stored «line breaks» were \neq and \nabla; every real one stays.
    expect(fixed.split('\n').length).toBe(STORED.split('\n').length - 2);
    expect(fixed).toContain('## Работа с соединениями и агрегатными функциями\n\nДля подсчёта');
    expect(fixed).toContain('\n- пункт один\n- not a formula: a new line here stays');
  });

  it('renders in KaTeX as the commands, not «extCOUNT»', () => {
    const fixed = repairMathEscapes(`$${TAB}ext{COUNT}$`);
    const html = katex.renderToString(fixed.slice(1, -1));
    expect(html).toContain('<annotation encoding="application/x-tex">\\text{COUNT}</annotation>');
    const shown = html.replace(/<annotation[\s\S]*?<\/annotation>/, '').replace(/<[^>]+>/g, '');
    expect(shown).toContain('COUNT');
    expect(shown).not.toContain('ext');
    // Before the repair the same text rendered as «ext» and COUNT in math italics.
    const broken = katex.renderToString(`${TAB}ext{COUNT}`).replace(/<annotation[\s\S]*?<\/annotation>/, '').replace(/<[^>]+>/g, '');
    expect(broken).toContain('ext');
  });

  it('leaves a text without formulas or without lost backslashes as the same string', () => {
    const plain = 'Строка\nещё строка\tс табуляцией';
    expect(repairMathEscapes(plain)).toBe(plain);
    const clean = 'Формула $\\frac{a}{b}$ и $$\\text{SUM}$$';
    expect(repairMathEscapes(clean)).toBe(clean);
  });

  it('never touches code, escaped dollars or prices outside a formula', () => {
    const code = ['```bash', `echo $${TAB}ext $HOME`, '```', `Цена \\$5 и ${TAB}text`].join('\n');
    expect(repairMathEscapes(code)).toBe(code);
    const inline = `Команда \`echo $${TAB}ext$\` и $${TAB}ext{A}$`;
    expect(repairMathEscapes(inline)).toBe(`Команда \`echo $${TAB}ext$\` и $\\text{A}$`);
  });

  it('a new line inside a display formula before a variable stays a new line', () => {
    const display = `$$${LF}e^{i\\pi} + 1 = 0${LF}x = 1${LF}$$`;
    expect(repairMathEscapes(display)).toBe(display);
  });

  it('\\ne and \\ni only inside an inline formula, not at its start', () => {
    expect(repairMathEscapes(`$a ${LF}e b$ и $x ${LF}i A$`)).toBe('$a \\ne b$ и $x \\ni A$');
    expect(repairFormula(`a ${LF}e b`, 'display')).toBe(`a ${LF}e b`);
    expect(repairFormula(`${LF}e`, 'inline')).toBe(`${LF}e`);
  });

  it('a carriage return before a new line is left alone', () => {
    expect(repairFormula(`a${CR}${LF}b`)).toBe(`a${CR}${LF}b`);
  });

  it('a formula does not run over a blank line', () => {
    const text = `Цена $5${LF}${LF}и ${TAB}ext $`;
    expect(repairMathEscapes(text)).toBe(text);
  });
});
