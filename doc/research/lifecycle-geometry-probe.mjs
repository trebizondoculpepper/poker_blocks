import assert from "node:assert/strict";
const offsets = [
  [1, 0, 0],
  [-1, 0, 0],
  [0, 1, 0],
  [0, -1, 0],
  [0, 0, 1],
  [0, 0, -1],
];
const key = (p) => p.join(",");
function analyze(points) {
  const occupied = new Set(points.map(key));
  const lo = [0, 1, 2].map((a) => Math.min(...points.map((p) => p[a])));
  const hi = [0, 1, 2].map((a) => Math.max(...points.map((p) => p[a])));
  const dims = hi.map((v, a) => v - lo[a] + 1);
  const volume = dims.reduce((a, b) => a * b, 1);
  let exposed = 0;
  for (const p of points)
    for (const d of offsets) if (!occupied.has(key(p.map((v, a) => v + d[a])))) exposed++;
  const min = lo.map((v) => v - 1),
    max = hi.map((v) => v + 1);
  if (max.reduce((n, v, a) => n * (v - min[a] + 1), 1) > 10000)
    throw new Error("probe budget exceeded");
  const outside = new Set([key(min)]),
    pending = [min];
  for (let i = 0; i < pending.length; i++)
    for (const d of offsets) {
      const p = pending[i].map((v, a) => v + d[a]);
      const k = key(p);
      if (p.some((v, a) => v < min[a] || v > max[a]) || occupied.has(k) || outside.has(k)) continue;
      outside.add(k);
      pending.push(p);
    }
  let sealedEmpty = 0;
  for (let x = lo[0]; x <= hi[0]; x++)
    for (let y = lo[1]; y <= hi[1]; y++)
      for (let z = lo[2]; z <= hi[2]; z++) {
        const k = key([x, y, z]);
        if (!occupied.has(k) && !outside.has(k)) sealedEmpty++;
      }
  return {
    count: points.length,
    dims,
    volume,
    density: points.length / volume,
    exposed,
    sealedEmpty,
    neighborTests: 6 * points.length,
  };
}
const cube = Array.from({ length: 8 }, (_, i) => [i % 2, Math.floor(i / 2) % 2, Math.floor(i / 4)]);
const all = Array.from({ length: 27 }, (_, i) => [i % 3, Math.floor(i / 3) % 3, Math.floor(i / 9)]);
const cases = {
  cube,
  line: Array.from({ length: 8 }, (_, i) => [i, 0, 0]),
  ring: all.filter(([x, y, z]) => z === 0 && (x !== 1 || y !== 1)),
  shell: all.filter((p) => !p.every((v) => v === 1)),
  tunnel: all.filter(([x, y]) => x !== 1 || y !== 1),
};
const results = Object.fromEntries(Object.entries(cases).map(([n, p]) => [n, analyze(p)]));
assert.equal(results.line.density, results.cube.density);
assert.equal(results.shell.sealedEmpty, 1);
assert.equal(results.tunnel.sealedEmpty, 0);
assert.equal(results.ring.sealedEmpty, 0);
console.log(JSON.stringify(results, null, 2));
