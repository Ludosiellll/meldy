/**
 * Copies a text: the Clipboard API first (called at once, inside the click: Safari allows it only there), then
 * the old way — select a field and copy. Without a field of the page, a hidden one is made for that moment.
 * False when neither worked: the page then shows the text to copy by hand.
 */
export async function copyText(text: string, field: HTMLInputElement | HTMLTextAreaElement | null = null): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Falls through to selecting the text.
  }
  let temporary: HTMLTextAreaElement | null = null;
  try {
    let target = field;
    if (!target) {
      temporary = document.createElement('textarea');
      temporary.value = text;
      temporary.setAttribute('readonly', '');
      temporary.style.position = 'fixed';
      temporary.style.opacity = '0';
      temporary.style.pointerEvents = 'none';
      document.body.appendChild(temporary);
      target = temporary;
    }
    target.focus();
    target.select();
    return typeof document.execCommand === 'function' ? document.execCommand('copy') : false;
  } catch {
    return false;
  } finally {
    temporary?.remove();
  }
}
