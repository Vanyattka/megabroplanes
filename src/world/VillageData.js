// Minimal structured-clone-safe representation of a village for worker
// transfer. The full Village object carries houses, roads, cached meshes
// and other main-thread concerns; terrain only needs the flat-factor
// rectangles (airport + village). Stripping to just this shape keeps
// postMessage payloads tiny (~100 bytes per affecting village) and
// prevents accidentally transferring Three.js objects.
export function villageToWorkerData(v) {
  const r = v.villageRect;
  return {
    airportX: v.airportX,
    airportZ: v.airportZ,
    angle: v.angle,
    padY: v.padY,
    villageRect: {
      cx: r.cx,
      cz: r.cz,
      angle: r.angle,
      halfL: r.halfL,
      halfW: r.halfW,
    },
  };
}

export function villagesToWorkerData(villages) {
  const out = new Array(villages.length);
  for (let i = 0; i < villages.length; i++) out[i] = villageToWorkerData(villages[i]);
  return out;
}
