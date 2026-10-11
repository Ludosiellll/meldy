// A placeholder for a product recording that is not shot yet: a calm frame inside the window, the words
// «ролик с сайта: …» in the faint colour and a dashed frame, so nobody takes it for the product.
// Usage in a page: <script>window.PLACEHOLDER = { width, height, radius, lines: [...] }</script><script src="placeholder.js">
(function () {
  const P = window.PLACEHOLDER;
  const stage = document.createElement('div');
  stage.className = 'stage';
  stage.style.cssText = `width:${P.width}px;height:${P.height}px;background:#ffffff`;
  stage.innerHTML = `
    <div style="left:0;top:0;width:${P.width}px;height:${P.height}px;border-radius:${P.radius}px;background:#f3f3f0"></div>
    <div style="left:${P.inset}px;top:${P.inset}px;width:${P.width - 2 * P.inset}px;height:${P.height - 2 * P.inset}px;border-radius:${Math.max(8, P.radius - P.inset)}px;border:3px dashed rgba(138,143,151,.55)"></div>
    <div id="ph-text" style="left:0;right:0;top:0;bottom:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;text-align:center;color:#8a8f97"></div>`;
  document.body.appendChild(stage);
  const box = stage.querySelector('#ph-text');
  box.style.position = 'absolute';
  P.lines.forEach((line, i) => {
    const d = document.createElement('div');
    d.style.cssText = `position:static;font-size:${i === 0 ? P.big : P.small}px;line-height:1.3;font-weight:${i === 0 ? 600 : 400};white-space:nowrap`;
    d.textContent = line;
    box.appendChild(d);
  });
  window.__clip = { T: 2000, seek() {}, width: P.width, height: P.height, poster: 0, loop: true };
})();
