// Locate Playwright: $PLAYWRIGHT_MODULE, a normal `import 'playwright'`, or the image's global install.
// Never runs `playwright install`: the Chromium build that ships with the module is used as is.
export async function loadChromium() {
  const candidates = [process.env.PLAYWRIGHT_MODULE, 'playwright', '/opt/node22/lib/node_modules/playwright/index.mjs'];
  const errors = [];
  for (const spec of candidates) {
    if (!spec) continue;
    try {
      const mod = await import(spec);
      const chromium = mod.chromium || (mod.default && mod.default.chromium);
      if (chromium) return chromium;
    } catch (e) {
      errors.push(`${spec}: ${e.message.split('\n')[0]}`);
    }
  }
  throw new Error('Playwright not found. Set PLAYWRIGHT_MODULE to its index.mjs.\n' + errors.join('\n'));
}
