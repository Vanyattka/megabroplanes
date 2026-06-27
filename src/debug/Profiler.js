// Lightweight performance profiler for chunk streaming & frame pacing.
//
// Enable by setting DEBUG_PROFILER = true in config.js. When disabled,
// every call here short-circuits on a single boolean — zero runtime cost.
//
// Usage:
//   import { profiler } from './debug/Profiler.js';
//   const t = profiler.timeBegin('terrain');
//   // ... work ...
//   profiler.timeEnd('terrain', t, { cx, cz });
//
// Reports:
//   - Summary every 5 s to console.group
//   - Every frame > 20 ms logged with breakdown of what was built that frame
//   - Post-chunk frames flagged as possible "shader compile stall"
//
// Counters (heightAt/biomeAt/seaMaskAt): tell us whether within-chunk caching
// of noise values would actually pay off. High repeat ratio => caching wins.

import { DEBUG_PROFILER, DEBUG_PROFILER_LONG_FRAME_MS, DEBUG_PROFILER_REPORT_INTERVAL_MS }
  from '../config.js';

class Profiler {
  constructor(enabled) {
    this.enabled = enabled;
    this.longFrameMs = DEBUG_PROFILER_LONG_FRAME_MS;
    this.reportIntervalMs = DEBUG_PROFILER_REPORT_INTERVAL_MS;

    // Circular buffer of frame durations (ms). Last ~10 s at 60 Hz.
    this.frames = [];
    this.frameCap = 600;

    // Per-category build-duration samples (ms). Kept last 200 each.
    this.builds = {
      terrain: [],
      scatter: [],
      roads: [],
      chunkMgr: [],      // total time spent inside ChunkManager.update()
      village: [],
      ruin: [],
      farm: [],
    };
    this.buildCap = 200;

    // Counters reset every report window.
    this.counters = {
      heightAt: 0,
      biomeAt: 0,
      seaMaskAt: 0,
      chunksBuilt: 0,
      scattersBuilt: 0,
      roadsBuilt: 0,
    };

    // Per-frame aggregates — rolled into longFrame report and cleared each
    // frameEnd().
    this._cf = this._newCurrentFrame();

    // Heuristic shader-compile stall detector: when a new terrain chunk is
    // added we set a timestamp; if the *next* frame is unusually long, the
    // cost is likely shader compilation on first render.
    this._chunkAddedThisFrame = 0;

    this._frameStart = 0;
    this._lastReport = performance.now();

    // Long-frame ring buffer for end-of-session dump.
    this.longFrames = [];
    this.longFrameCap = 50;
  }

  _newCurrentFrame() {
    return {
      terrain: 0, terrainMs: 0,
      scatter: 0, scatterMs: 0,
      roads: 0,   roadsMs: 0,
      village: 0, villageMs: 0,
      ruin: 0,    ruinMs: 0,
      farm: 0,    farmMs: 0,
      chunkMgrMs: 0,
    };
  }

  // ---- frame timing ----
  frameBegin() {
    if (!this.enabled) return;
    this._frameStart = performance.now();
    this._chunkAddedThisFrame = this._cf.terrain;
  }

  frameEnd() {
    if (!this.enabled) return;
    const dt = performance.now() - this._frameStart;
    this.frames.push(dt);
    if (this.frames.length > this.frameCap) this.frames.shift();

    if (dt > this.longFrameMs) {
      const cf = this._cf;
      // Heuristic: large gap between wall-clock frame time and our
      // measured build totals usually means render pass or GC — NOT
      // shader compile (since we now share one terrain material and warm
      // the cache at startup). So we only flag "shader-suspect" when the
      // gap is big AND no chunks were built this frame (an isolated stall
      // with nothing else going on is more likely a compile hiccup).
      const buildMs = cf.terrainMs + cf.scatterMs + cf.roadsMs + cf.villageMs + cf.ruinMs + cf.farmMs;
      const gap = dt - buildMs;
      const shaderSuspect =
        cf.terrain === 0 && cf.scatter === 0 &&
        cf.village === 0 && cf.ruin === 0 && cf.farm === 0 && gap > 20;
      const tag = shaderSuspect ? ' [shader-compile?]' : '';
      // Console line short enough to scan while flying.
      console.log(
        `[LONG ${dt.toFixed(1)}ms]${tag} ` +
        `terrain=${cf.terrain}(${cf.terrainMs.toFixed(1)}ms) ` +
        `scatter=${cf.scatter}(${cf.scatterMs.toFixed(1)}ms) ` +
        `village=${cf.village}(${cf.villageMs.toFixed(1)}ms) ` +
        `ruin=${cf.ruin}(${cf.ruinMs.toFixed(1)}ms) ` +
        `farm=${cf.farm}(${cf.farmMs.toFixed(1)}ms) ` +
        `roads=${cf.roads}(${cf.roadsMs.toFixed(1)}ms) ` +
        `chunkMgr=${cf.chunkMgrMs.toFixed(1)}ms`
      );
      this.longFrames.push({ dt, ...cf, shaderSuspect });
      if (this.longFrames.length > this.longFrameCap) this.longFrames.shift();
    }

    this._cf = this._newCurrentFrame();

    if (performance.now() - this._lastReport > this.reportIntervalMs) {
      this.report();
    }
  }

  // ---- timers ----
  timeBegin() {
    if (!this.enabled) return 0;
    return performance.now();
  }

  timeEnd(category, t0) {
    if (!this.enabled) return;
    const dt = performance.now() - t0;
    const arr = this.builds[category];
    if (arr) {
      arr.push(dt);
      if (arr.length > this.buildCap) arr.shift();
    }
    const cf = this._cf;
    if (category === 'terrain')      { cf.terrain++;  cf.terrainMs  += dt; this.counters.chunksBuilt++; }
    else if (category === 'scatter') { cf.scatter++;  cf.scatterMs  += dt; this.counters.scattersBuilt++; }
    else if (category === 'roads')   { cf.roads++;    cf.roadsMs    += dt; this.counters.roadsBuilt++; }
    else if (category === 'village') { cf.village++;  cf.villageMs  += dt; }
    else if (category === 'ruin')    { cf.ruin++;     cf.ruinMs     += dt; }
    else if (category === 'farm')    { cf.farm++;     cf.farmMs     += dt; }
    else if (category === 'chunkMgr'){ cf.chunkMgrMs += dt; }
  }

  // ---- counters ----
  incr(name, by = 1) {
    if (!this.enabled) return;
    this.counters[name] = (this.counters[name] || 0) + by;
  }

  // ---- summary ----
  report() {
    this._lastReport = performance.now();
    if (this.frames.length === 0) return;

    const f = this.frames;
    const sorted = [...f].sort((a, b) => a - b);
    const sum = f.reduce((s, x) => s + x, 0);
    const avg = sum / f.length;
    const p50 = sorted[Math.floor(f.length * 0.50)];
    const p95 = sorted[Math.floor(f.length * 0.95)];
    const p99 = sorted[Math.floor(f.length * 0.99)];
    const mx = sorted[sorted.length - 1];
    const long = f.filter(x => x > this.longFrameMs).length;

    const fps = 1000 / avg;

    console.groupCollapsed(
      `%c[PROFILER] ${f.length}f · avg ${avg.toFixed(1)}ms (${fps.toFixed(0)} fps) · p95 ${p95.toFixed(1)}ms · p99 ${p99.toFixed(1)}ms · max ${mx.toFixed(1)}ms · long ${long}`,
      'color:#4a9'
    );
    console.log(`frame dist: p50=${p50.toFixed(1)} p95=${p95.toFixed(1)} p99=${p99.toFixed(1)} max=${mx.toFixed(1)} long(>${this.longFrameMs}ms)=${long}/${f.length} (${(long/f.length*100).toFixed(1)}%)`);

    for (const [cat, times] of Object.entries(this.builds)) {
      if (times.length === 0) continue;
      const s = times.reduce((a, b) => a + b, 0);
      const a = s / times.length;
      const bSorted = [...times].sort((x, y) => x - y);
      const bP95 = bSorted[Math.floor(times.length * 0.95)];
      const bMax = bSorted[bSorted.length - 1];
      console.log(`${cat.padEnd(10)}: n=${times.length.toString().padStart(4)}  avg=${a.toFixed(2)}ms  p95=${bP95.toFixed(2)}ms  max=${bMax.toFixed(2)}ms`);
    }

    const c = this.counters;
    const chunks = c.chunksBuilt || 0;
    const heightPerChunk = chunks ? (c.heightAt / chunks).toFixed(0) : '—';
    const biomePerChunk  = chunks ? (c.biomeAt  / chunks).toFixed(0) : '—';
    console.log(
      `counters: heightAt=${c.heightAt} (${heightPerChunk}/chunk)  biomeAt=${c.biomeAt} (${biomePerChunk}/chunk)  seaMask=${c.seaMaskAt}  chunks=${c.chunksBuilt}  scatters=${c.scattersBuilt}  roads=${c.roadsBuilt}`
    );

    if (this.longFrames.length > 0) {
      const shaderN = this.longFrames.filter(l => l.shaderSuspect).length;
      console.log(`long-frame buffer: ${this.longFrames.length} entries, ${shaderN} tagged shader-suspect`);
    }
    console.groupEnd();

    // Reset rolling counters (keeps per-window stats clean).
    this.counters = {
      heightAt: 0, biomeAt: 0, seaMaskAt: 0,
      chunksBuilt: 0, scattersBuilt: 0, roadsBuilt: 0,
    };
  }
}

export const profiler = new Profiler(DEBUG_PROFILER);

// Expose on window for ad-hoc queries from DevTools console.
if (typeof window !== 'undefined' && DEBUG_PROFILER) {
  window.profiler = profiler;
  console.log('%c[PROFILER] enabled — window.profiler available; summary every 5s', 'color:#4a9;font-weight:bold');
}
