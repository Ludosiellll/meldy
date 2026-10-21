/**
 * The renderer on a canvas: camera, frame loop, adaptive quality, pause while the tab is hidden, and the numbers the
 * perf harness reads.
 */
import * as THREE from 'three';
import { QUALITY_LEVELS, QualityGovernor } from '../quality';
import { impactOf, stageOf, type MoveMap } from '../arenaPlan';
import type { CameraSpec, FrameStats, ViewOptions } from '../types';
import type { KitImpl } from './game3d';
import { UNITS } from './crowd';

const HISTORY = 240;
const _v = new THREE.Vector3();

function percentile(values: Float32Array, n: number, p: number, scratch: Float32Array): number {
  if (n === 0) return 0;
  scratch.set(values.subarray(0, n));
  const sorted = scratch.subarray(0, n).sort();
  return sorted[Math.min(n - 1, Math.floor(p * (n - 1) + 0.5))];
}

export class ViewImpl {
  readonly renderer: THREE.WebGLRenderer;
  readonly camera = new THREE.PerspectiveCamera(38, 16 / 9, 0.1, 400);
  private readonly governor = new QualityGovernor();
  private auto = true;
  private readonly maxRatio: number;
  private raf = 0;
  private running = false;
  private last = 0;
  private onFrame: ((dt: number, now: number) => void) | null = null;
  private readonly observer: ResizeObserver | null;
  private readonly onVisibility: () => void;
  private readonly frameMs = new Float32Array(HISTORY);
  private readonly cpuMs = new Float32Array(HISTORY);
  private readonly scratch = new Float32Array(HISTORY);
  private filled = 0;
  private at = 0;
  private shakeLeft = 0;
  private shakeStrength = 0;
  private readonly base = { eye: new THREE.Vector3(), target: new THREE.Vector3() };
  private fitTo: { map: MoveMap; margins: Required<NonNullable<CameraSpec['margins']>> } | null = null;
  private lastCalls = 0;
  private lastTris = 0;
  private width = 1;
  private height = 1;
  private disposed = false;

  constructor(
    private readonly kit: KitImpl,
    readonly canvas: HTMLCanvasElement,
    options: ViewOptions = {},
  ) {
    this.maxRatio = options.maxPixelRatio ?? 1.5;
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: options.antialias ?? true,
      alpha: options.transparent ?? false,
      preserveDrawingBuffer: options.preserveDrawingBuffer ?? false,
      powerPreference: 'high-performance',
    });
    if (!this.renderer.capabilities.isWebGL2) throw new Error('WebGL 2 is needed for the 3D games');
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.NoToneMapping;
    this.renderer.setClearColor(0x000000, options.transparent ? 0 : 1);
    if (typeof options.quality === 'number') this.setQuality(options.quality);
    this.kit.tags.scale = options.tagScale ?? 1;
    if (options.tagHeight !== undefined) this.kit.crowd.tagY = options.tagHeight;
    this.observer = typeof ResizeObserver === 'function' ? new ResizeObserver(() => this.resize()) : null;
    this.observer?.observe(canvas);
    this.onVisibility = () => {
      if (document.hidden) this.pause();
      else if (this.running) this.resume();
    };
    document.addEventListener('visibilitychange', this.onVisibility);
    this.camera.position.set(0, 10, 20);
    this.camera.lookAt(0, 0, 0);
    this.resize();
  }

  /** Follows the canvas's CSS size; called by a ResizeObserver, call it yourself where there is none. */
  resize(): void {
    if (this.disposed) return;
    const w = Math.max(1, this.canvas.clientWidth || this.canvas.width);
    const h = Math.max(1, this.canvas.clientHeight || this.canvas.height);
    this.width = w;
    this.height = h;
    const level = QUALITY_LEVELS[this.governor.level];
    const ratio = Math.min(window.devicePixelRatio || 1, this.maxRatio) * level.scale;
    this.renderer.setPixelRatio(ratio);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.kit.shared.kitAspect.value = w / h;
    this.kit.tags.setViewport(w, h);
    if (this.fitTo) this.fit();
  }

  /** Puts the camera in map units: eye and target (x, y on the map, z the height), field of view in degrees. */
  setCamera(spec: CameraSpec): void {
    if (spec.arena) {
      this.fitTo = {
        map: spec.arena,
        margins: { top: 0, bottom: 0, left: 0, right: 0, ...(spec.margins ?? {}) },
      };
      this.camera.fov = spec.fov ?? 38;
      this.camera.updateProjectionMatrix();
      this.fit();
      return;
    }
    this.fitTo = null;
    if (spec.fov) this.camera.fov = spec.fov;
    this.camera.updateProjectionMatrix();
    const eye = spec.eye ?? { x: 0, y: 1000, z: 500 };
    const target = spec.target ?? { x: 0, y: 0, z: 0 };
    this.base.eye.set(eye.x / UNITS, eye.z / UNITS, eye.y / UNITS);
    this.base.target.set(target.x / UNITS, target.z / UNITS, target.y / UNITS);
    this.placeCamera(0);
  }

  /** The 3/4 view of the arena from the front: the whole floor and the boss on its stage, as tight as fits. */
  private fit(): void {
    const fit = this.fitTo;
    if (!fit) return;
    const { map, margins } = fit;
    const W = map.w / UNITS;
    const H = map.h / UNITS;
    const stage = stageOf(map);
    const target = new THREE.Vector3(W / 2, 0, H / 2 - H * 0.15);
    const dir = new THREE.Vector3(0, 17, 33).normalize();
    // the floor's corners (the frame may be cut at the front) and the top of a boss on its stage
    const points = [
      new THREE.Vector3(0, 0, H),
      new THREE.Vector3(W, 0, H),
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(W, 0, 0),
      new THREE.Vector3(stage.x / UNITS, 7.4, stage.y / UNITS),
      new THREE.Vector3(impactOf(map).x / UNITS, 0, impactOf(map).y / UNITS),
    ];
    const lim = { l: -1 + 2 * margins.left, r: 1 - 2 * margins.right, b: -1 + 2 * margins.bottom, t: 1 - 2 * margins.top };
    let dist = Math.max(W, H) * 0.4;
    for (let k = 0; k < 300; k++) {
      this.camera.position.copy(target).addScaledVector(dir, dist);
      this.camera.lookAt(target);
      this.camera.updateMatrixWorld(true);
      let ok = true;
      for (const p of points) {
        _v.copy(p).project(this.camera);
        if (_v.x < lim.l || _v.x > lim.r || _v.y < lim.b || _v.y > lim.t || _v.z > 1) {
          ok = false;
          break;
        }
      }
      if (ok) break;
      dist *= 1.02;
    }
    this.base.eye.copy(this.camera.position);
    this.base.target.copy(target);
    const scene = this.kit.scene;
    if (scene.fog instanceof THREE.Fog) {
      scene.fog.near = dist * 1.25;
      scene.fog.far = dist * 2.1;
    }
    this.placeCamera(0);
  }

  private placeCamera(dt: number): void {
    this.camera.position.copy(this.base.eye);
    if (this.shakeLeft > 0) {
      this.shakeLeft = Math.max(0, this.shakeLeft - dt);
      const u = 0.8 - this.shakeLeft;
      const a = this.shakeStrength * Math.exp(-u * 5);
      this.camera.position.x += Math.sin(u * 63) * a;
      this.camera.position.y += Math.cos(u * 51) * a;
    }
    this.camera.lookAt(this.base.target);
    this.camera.updateMatrixWorld(true);
  }

  /** A short jolt of the camera (the stomp). */
  shake(strength = 0.35): void {
    this.shakeLeft = 0.8;
    this.shakeStrength = strength * (this.base.eye.distanceTo(this.base.target) / 37);
  }

  /** Draws one frame now (without advancing anything). */
  renderOnce(dt = 0): void {
    if (this.disposed) return;
    this.placeCamera(dt);
    this.kit.prepareRender(this.camera);
    this.renderer.render(this.kit.scene, this.camera);
    this.lastCalls = this.renderer.info.render.calls;
    this.lastTris = this.renderer.info.render.triangles;
  }

  /** One frame: your callback, the kit's update, the draw. What the loop runs; the perf harness calls it directly. */
  frame(dt: number): number {
    const t0 = performance.now();
    if (this.onFrame) this.onFrame(dt, this.kit.now());
    this.kit.update(dt);
    this.renderOnce(dt);
    return performance.now() - t0;
  }

  /** Runs the frame loop (requestAnimationFrame). `onFrame` runs first each frame: move the players there. */
  start(onFrame?: (dt: number, now: number) => void): void {
    this.onFrame = onFrame ?? null;
    this.running = true;
    if (!document.hidden) this.resume();
  }

  stop(): void {
    this.running = false;
    this.pause();
  }

  private resume(): void {
    if (this.raf || this.disposed) return;
    this.last = performance.now();
    this.governor.reset();
    const loop = (now: number) => {
      this.raf = requestAnimationFrame(loop);
      const interval = now - this.last;
      this.last = now;
      const dt = Math.min(0.1, interval / 1000);
      const cpu = this.frame(dt);
      this.record(interval, cpu);
      if (this.auto && this.governor.push(interval)) this.applyQuality();
    };
    this.raf = requestAnimationFrame(loop);
  }

  private pause(): void {
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
  }

  private record(interval: number, cpu: number): void {
    this.frameMs[this.at] = interval;
    this.cpuMs[this.at] = cpu;
    this.at = (this.at + 1) % HISTORY;
    if (this.filled < HISTORY) this.filled++;
  }

  /** Records a frame measured outside the loop (the perf harness). */
  recordFrame(interval: number, cpu: number): void {
    this.record(interval, cpu);
  }

  /** 'auto' lets frame times choose; a number pins a level (0 best … 5 cheapest). */
  setQuality(level: 'auto' | number): void {
    if (level === 'auto') {
      this.auto = true;
      return;
    }
    this.auto = false;
    this.governor.force(level);
    this.applyQuality();
  }

  private applyQuality(): void {
    const level = QUALITY_LEVELS[this.governor.level];
    this.kit.setLook(level.outlines, level.effects);
    this.resize();
  }

  /** Compiles every shader and uploads the textures before the round, so the first frames do not stall. */
  async warmUp(): Promise<void> {
    this.kit.showAllForWarmUp(true);
    this.kit.prepareRender(this.camera);
    const r = this.renderer as THREE.WebGLRenderer & { compileAsync?: (s: THREE.Object3D, c: THREE.Camera) => Promise<unknown> };
    if (r.compileAsync) await r.compileAsync(this.kit.scene, this.camera);
    else this.renderer.compile(this.kit.scene, this.camera);
    this.renderer.render(this.kit.scene, this.camera);
    this.kit.showAllForWarmUp(false);
    this.renderOnce();
  }

  stats(): FrameStats {
    const n = this.filled;
    let fSum = 0;
    let cSum = 0;
    for (let i = 0; i < n; i++) {
      fSum += this.frameMs[i];
      cSum += this.cpuMs[i];
    }
    const level = this.governor.level;
    return {
      frames: n,
      fps: n && fSum > 0 ? (1000 * n) / fSum : 0,
      frameMs: { mean: n ? fSum / n : 0, p95: percentile(this.frameMs, n, 0.95, this.scratch) },
      cpuMs: { mean: n ? cSum / n : 0, p95: percentile(this.cpuMs, n, 0.95, this.scratch) },
      drawCalls: this.lastCalls,
      triangles: this.lastTris,
      quality: level,
      pixelRatio: this.renderer.getPixelRatio(),
      width: this.width,
      height: this.height,
      players: this.kit.crowd.players.length,
    };
  }

  resetStats(): void {
    this.filled = 0;
    this.at = 0;
  }

  dispose(): void {
    if (this.disposed) return;
    this.stop();
    this.disposed = true;
    this.observer?.disconnect();
    document.removeEventListener('visibilitychange', this.onVisibility);
    this.renderer.dispose();
    this.renderer.forceContextLoss();
  }
}
