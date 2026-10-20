/**
 * The landing's first screen is also plain HTML in index.html (#static-hero), so a guest on «/» sees it before any
 * script. On every other first screen it is hidden from the start (theme-init.js puts sh-off on <html>: another
 * address, or a signed-in visitor), and it leaves the page here, before the app renders: hidden, it changes nothing on
 * screen, and the page keeps one <main> and one <h1>. On «/» the landing (components/home3/Landing3) takes its place.
 */
export function dropStaticHero(doc: Document = document): void {
  const root = doc.documentElement;
  // theme-init.js did not run (a blocked file): off «/» the app's screen must not wait behind the static one
  if (doc.location.pathname !== '/') root.classList.add('sh-off');
  if (root.classList.contains('sh-off')) doc.getElementById('static-hero')?.remove();
}
