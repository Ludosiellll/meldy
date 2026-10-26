/**
 * How long a chosen recording is, read by the browser from the file's own header before anything is sent: the page
 * shows the length and the price at once (lib/plans recordingCost) and stops a recording over 2 hours, which the
 * server refuses too. null when the browser cannot read it (an .ogg on Safari, a broken file): then the server's own
 * measure decides, and the page shows the price of a lecture.
 */
export function mediaDuration(file: Blob, timeoutMs = 5000): Promise<number | null> {
  return new Promise(resolve => {
    if (typeof document === 'undefined' || typeof URL.createObjectURL !== 'function') {
      resolve(null);
      return;
    }
    const video = (file.type || '').startsWith('video/');
    const element = document.createElement(video ? 'video' : 'audio');
    const url = URL.createObjectURL(file);
    let settled = false;
    const finish = (seconds: number | null) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      element.removeAttribute('src');
      try {
        element.load();
      } catch {
        // jsdom has no media pipeline
      }
      URL.revokeObjectURL(url);
      resolve(seconds !== null && Number.isFinite(seconds) && seconds > 0 ? seconds : null);
    };
    const timer = window.setTimeout(() => finish(null), timeoutMs);
    element.preload = 'metadata';
    element.muted = true;
    element.addEventListener('loadedmetadata', () => finish(element.duration));
    element.addEventListener('error', () => finish(null));
    element.src = url;
  });
}

/** «47 мин», «1 ч 05 мин», «2 ч» — as the server says it (backend quota.hours_minutes). */
export function hoursMinutes(seconds: number): string {
  const total = Math.max(0, Math.ceil((Number(seconds) || 0) / 60));
  const hours = Math.floor(total / 60);
  const minutes = total % 60;
  if (hours && minutes) return `${hours} ч ${String(minutes).padStart(2, '0')} мин`;
  if (hours) return `${hours} ч`;
  return `${minutes} мин`;
}
