/**
 * How a question's text splits into its words and its code on the screen (QuestionCard in a «занятие» and «Как на
 * экзамене», KeyQuestion on the import page and in «Ключи») and in the Telegram bot (a «занятие» in chat, the group's
 * «Вопрос дня»), which runs a byte-exact copy of this file (scripts/sync_bot_plan.mjs). Pure functions: no React, no
 * network, only relative `.ts` imports.
 *
 * The importer flags a question as code (`TestItem.code`, backend/bank_parse.py): signs of C, a monospace font in the
 * question or its options, SQL and shell lines. Questions imported before 2026-10-10 kept a flag without the last
 * three, so 90 of 203 questions with SQL or commands showed them in the heading font (usability check m1). The safety
 * net here: lines after the first that clearly read as code — SQL, a shell command, signs of C, two rows of a table
 * drawn with spaces or bars — are code even when the flag is off. The first line is the question and stays words.
 *
 * Inside a block every line is kept as typed; the block runs from its first code line to its last, and after a shell
 * prompt («C:\>ping …», «$ ls -l») to the end of the text: the command's output belongs to it.
 */
import { codeLike } from './codeLines.ts';

export interface StemParts {
  before: string;
  code: string | null;
  after: string;
}

const LITERAL = /"[^"]*"|'[^']*'|`[^`]*`/g;
const COMMENT_TAIL = /(?:\s--\s|\s#\s|\/\/).*$/;

/** Russian words: more than half of the letters Cyrillic, string values and comments left out. */
export function wordsLine(line: string): boolean {
  const bare = line.replace(LITERAL, '""').replace(COMMENT_TAIL, ' ');
  const letters = bare.match(/\p{L}/gu) ?? [];
  const cyrillic = bare.match(/[а-яё]/gi) ?? [];
  return letters.length > 0 && cyrillic.length * 2 > letters.length;
}

// The same lines as backend/bank_parse.py SQL_LINE_RE and SHELL_LINE_RE (kept in step by stemCode.test.ts).
const SQL_LINE = new RegExp(
  [
    String.raw`^(?:SELECT|INSERT\s+INTO|DELETE\s+FROM|CREATE\s+(?:UNIQUE\s+)?(?:TABLE|INDEX|VIEW|TRIGGER|PROCEDURE|FUNCTION|DATABASE|SCHEMA|SEQUENCE|USER|ROLE)|ALTER\s+TABLE|DROP\s+(?:TABLE|INDEX|VIEW|TRIGGER|PROCEDURE|FUNCTION|DATABASE|SCHEMA|SEQUENCE|USER|ROLE)|TRUNCATE|GRANT|REVOKE|BEGIN\s+TRANSACTION|COMMIT|ROLLBACK|SAVEPOINT|SET\s+TRANSACTION|WHERE|(?:(?:INNER|LEFT|RIGHT|FULL|CROSS)\s+)?(?:OUTER\s+)?JOIN|ORDER\s+BY|GROUP\s+BY|HAVING|UNION)\b`,
    String.raw`^(?:UPDATE\s+\w+|FROM\s+\w|SET\s+\S+\s+\S|BEGIN\s*;|VALUES\s*\(|WITH\s+\w+\s+AS\b)`,
    String.raw`^(?:select\b.*\bfrom\b|insert\s+into\b|delete\s+from\b|update\s+\w+\s+set\b|(?:create|alter|drop)\s+table\b)`,
  ].join('|'),
);
const SHELL_LINE = new RegExp(
  String.raw`^(?:\$\s+\S|#!\/|[A-Za-z]:\\[^\s>]*>|PS\s+[A-Za-z]:\\|@echo\b` +
    String.raw`|(?:Get|Set|New|Remove|Start|Stop|Restart|Invoke|Write|Test|Import|Export|Select|Where|Sort|Format|Out|Measure|Clear|Copy|Move|Rename|Enable|Disable|Install|Update|ConvertTo|ConvertFrom|ForEach)-[A-Z][A-Za-z]+(?=[\s|]|$)` +
    String.raw`|(?:sudo|ls|cd|pwd|cat|echo|grep|egrep|find|chmod|chown|chgrp|mkdir|rmdir|rm|cp|mv|ln|touch|tar|gzip|gunzip|zip|unzip|apt|apt-get|yum|dnf|pacman|systemctl|service|journalctl|ps|top|htop|kill|killall|pkill|nice|renice|df|du|free|mount|umount|uname|whoami|useradd|usermod|userdel|groupadd|passwd|history|which|whereis|head|tail|sort|uniq|wc|cut|awk|sed|tr|xargs|ssh|scp|rsync|curl|wget|ping|traceroute|tracert|ipconfig|ifconfig|ip|netstat|nslookup|dig|docker|git|bash|sh|zsh|python3?|pip3?|export|source|alias|crontab|sleep|jobs|nohup|umask|tasklist|taskkill|netsh|route|arp|hostname|systeminfo|chkdsk|xcopy|robocopy|attrib|dir|copy|del|cls|type|set)(?=\s|$))`,
);
/** A shell prompt: what follows it is the command's output. */
const PROMPT = /^(?:\$\s+\S|[A-Za-z]:\\[^\s>]*>|PS\s+[A-Za-z]:\\|>>>\s)/;

/** A question's end: a word and «?» («ls?», «Where is the station?»), not «echo $?». */
const ASKS = /\p{L}\?\s*$/u;

/** A recognisable line of SQL or of a shell (a command, a prompt, a statement), not a question and not Russian words. */
export function sqlOrShellLine(line: string): boolean {
  const text = line.trim();
  if (!text || ASKS.test(text) || wordsLine(text)) return false;
  return SQL_LINE.test(text) || SHELL_LINE.test(text);
}

/** Clear signs of C-like code (no keyword rule: «If…», «For…», «New…» of an English question stay words). */
function cSigns(line: string): boolean {
  const text = line.trim();
  if (!text || wordsLine(text)) return false;
  return (
    /[;{]$|^[}\])]+;?$/.test(text) ||
    /=>|==|!=|\+\+|&&|::|->|<<|>>/.test(text) ||
    /^(?:#include|#define|#region|import\s+\w|from\s+\w+\s+import\b|def\s+\w+\(|class\s+\w+|public\s|private\s|protected\s|static\s|void\s|return\b|using\s+[\w.]+;|namespace\s)/.test(text)
  );
}

/** A row of a table drawn with spaces or bars («Студент   | Телефоны»): its columns need the code's monospace. */
export function tableLine(line: string): boolean {
  const text = line.replace(/\s+$/, '');
  return /\S {3,}\S/.test(text.trimStart()) || /\S\s*\|\s*\S/.test(text);
}

/** An assignment of a program («x := 5», «a = [3, 7, 1, 9]», «VAR=hello»): code once the question is code. */
function assignment(line: string): boolean {
  const text = line.trim();
  return !wordsLine(text) && /^[A-Za-z_][\w.[\]]*\s*(?::=|[-+*/%]?=)\s*\S/.test(text);
}

/** A line of an HTTP message («HTTP/1.1 403 Forbidden», «Server: nginx»): code once the question is code. */
function httpLine(line: string): boolean {
  const text = line.trim();
  return /^HTTP\/\d(?:\.\d)?\s+\d{3}\b/.test(text) || (/^[A-Z][A-Za-z0-9-]*:\s+\S/.test(text) && !wordsLine(text));
}

/** Words that open or close a block of code («interface IShape», «try», «done», «fi»): code once the question is code. */
const BLOCK_WORDS = /^(?:interface|try|catch|finally|enum|abstract|sealed|virtual|override|async|await|foreach|switch|case|do|throw|yield|lock|record|delegate|event|internal|template|typedef|struct|fn|func|let|mut|impl|trait|module|program|procedure|var|fi|done|esac|then|elif|else|begin|end)\b/;

/** A line of code of a question that is code (the flag, or the net found a sure line): permissive. */
export function codeLine(line: string): boolean {
  const text = line.trim();
  if (codeLike(line) || sqlOrShellLine(line) || tableLine(line) || assignment(line) || httpLine(line) || PROMPT.test(text)) return true;
  // A call or a block left open at the end of the line («db.students.find(») or closed on a line of its own («)»),
  // a block word: not in Russian words.
  return text !== '' && !wordsLine(text) && (/[({[]$/.test(text) || /^[}\])]+[;,)]*$/.test(text) || BLOCK_WORDS.test(text));
}

/** A line that surely is code, for a question without the flag: SQL, a shell, clear signs of C. */
export function sureCodeLine(line: string): boolean {
  return sqlOrShellLine(line) || cSigns(line) || PROMPT.test(line.trim());
}

const lineList = (stem: string) => stem.replace(/\r\n?/g, '\n').split('\n');

/**
 * The lines after the first that clearly read as code: one sure line (SQL, a shell, signs of C), or two rows of a
 * table. Then the question is shown as code even when it was imported without the flag.
 */
export function laterLinesCodeLike(stem: string): boolean {
  const later = lineList(stem).slice(1);
  if (later.some(sureCodeLine)) return true;
  return later.filter((line) => line.trim() !== '' && tableLine(line)).length >= 2;
}

/** A question line: it ends with «?» (a question after the output of a command stays words). */
const QUESTION_END = /\?\s*$/;

function split(lines: string[], from: number): StemParts | null {
  let first = -1;
  for (let index = from; index < lines.length; index += 1) {
    if (codeLine(lines[index])) {
      first = index;
      break;
    }
  }
  if (first < 0) return null;
  let last = lines.length - 1;
  if (PROMPT.test(lines[first].trim())) {
    // The output of the command belongs to it, up to a question at the end.
    while (last > first && (lines[last].trim() === '' || (QUESTION_END.test(lines[last]) && wordsLine(lines[last])))) last -= 1;
  } else {
    while (last > first && !codeLine(lines[last])) last -= 1;
  }
  // A question line ending with «?» or «:» right before the code stays words even if it has brackets (model.splitStem).
  if (first === 0 && lines.length > 1 && /[?:]\s*$/.test(lines[0]) && !/[;{}]/.test(lines[0])) first = 1;
  const block = lines.slice(first, last + 1).join('\n').replace(/\s+$/, '');
  if (!block) return null;
  return { before: lines.slice(0, first).join('\n').trim(), code: block, after: lines.slice(last + 1).join('\n').trim() };
}

/**
 * The words before the code, the code block (its lines verbatim) and the words after. With the flag, as
 * model.splitStem did, with SQL, shell lines, tables and their output known too; without it, only when later lines
 * clearly read as code (laterLinesCodeLike), and the first line always stays words.
 */
export function stemParts(stem: string, code: boolean): StemParts {
  const text = stem.replace(/\r\n?/g, '\n');
  const words: StemParts = { before: text.trim(), code: null, after: '' };
  if (!text.includes('\n')) return words;
  const lines = text.split('\n');
  if (code) return split(lines, 0) ?? words;
  if (!laterLinesCodeLike(text)) return words;
  return split(lines, 1) ?? words;
}

/** The spaces a code line starts with (tabs as four): its hanging indent on a phone, so a wrapped part continues under it. */
export function leadingSpaces(line: string, most = 20): number {
  const lead = /^ */.exec(line.replace(/\t/g, '    '))?.[0].length ?? 0;
  return Math.min(lead, most);
}
