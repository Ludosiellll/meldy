import { describe, expect, it } from 'vitest';
import { softwareRenderer } from './view';

/* Speed audit 07.11, PERF-5: a context drawn by the CPU sends the projector to the 2D board. */
function renderer(name: string | null, withInfo = true) {
  const gl = {
    RENDERER: 0x1f01,
    getExtension: (ext: string) => (withInfo && ext === 'WEBGL_debug_renderer_info' ? { UNMASKED_RENDERER_WEBGL: 0x9246 } : null),
    getParameter: (p: number) => (p === 0x9246 || p === 0x1f01 ? name : null),
  };
  return { getContext: () => gl as unknown as WebGL2RenderingContext };
}

describe('softwareRenderer', () => {
  it('names the CPU renderers', () => {
    for (const name of [
      'ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver)',
      'llvmpipe (LLVM 15.0.7, 256 bits)',
      'ANGLE (Microsoft, Microsoft Basic Render Driver Direct3D11 vs_5_0 ps_5_0)',
    ]) {
      expect(softwareRenderer(renderer(name))).toBe(true);
    }
  });

  it('leaves real GPUs and unknown names in 3D', () => {
    for (const name of ['ANGLE (Intel, Intel(R) UHD Graphics 620 Direct3D11 vs_5_0 ps_5_0, D3D11)', 'Mali-G57', 'Apple GPU', 'Adreno (TM) 610', 'WebKit WebGL', null]) {
      expect(softwareRenderer(renderer(name))).toBe(false);
    }
    expect(softwareRenderer(renderer('Google SwiftShader', false))).toBe(true);
    expect(softwareRenderer({ getContext: () => { throw new Error('lost'); } } as never)).toBe(false);
  });
});
