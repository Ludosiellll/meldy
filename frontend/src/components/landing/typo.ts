/**
 * Russian typesetting for landing copy: a one- or two-letter word never ends a line
 * («с | интервальным» → «с интервальным» kept together), and a dash never starts one.
 *
 * Two passes, because a match consumes the space in front of the next short word
 * («и в лесу»). No regex lookbehind: Safari before 16.4 cannot parse it.
 */
export const NBSP = ' ';

const SHORT_WORD = /(^|[\s«„(])([а-яёА-ЯЁ]{1,2}) /g;

export function ty(text: string): string {
  const glue = (s: string) => s.replace(SHORT_WORD, `$1$2${NBSP}`);
  return glue(glue(text)).replace(/ ([—–])/g, `${NBSP}$1`);
}
