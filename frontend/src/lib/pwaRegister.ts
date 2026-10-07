/// <reference types="vite-plugin-pwa/vanillajs" />
/**
 * vite-plugin-pwa's registration of the service worker, in a module of its own: the virtual module
 * exists only in Vite's build and dev server, so tests replace this one (vi.mock) instead.
 */
export { registerSW } from 'virtual:pwa-register';
