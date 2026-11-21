'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const sb = {}; sb.globalThis = sb; vm.createContext(sb);
vm.runInContext(fs.readFileSync(path.join(__dirname, '../src/js/core/contour.js'), 'utf8'), sb);
const iso = sb.FMAP_CORE.isoSegments;
const segs = (z, n, t) => { const out = []; iso(z, n, t, (p, q) => out.push([Array.from(p), Array.from(q)])); return out; };

test('a ramp gives one straight vertical line at the right place', () => {
  const n = 6, z = new Float32Array(n * n); for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) z[j * n + i] = i * 10;
  const s = segs(z, n, 25);                       // 25 lies between i = 2 (20) and i = 3 (30)
  assert.strictEqual(s.length, n - 1);
  s.forEach(([p, q]) => { assert.ok(Math.abs(p[0] - 2.5) < 1e-9 && Math.abs(q[0] - 2.5) < 1e-9); });
});

test('a flat grid and thresholds outside the range give nothing', () => {
  const n = 5, z = new Float32Array(n * n).fill(100);
  assert.strictEqual(segs(z, n, 50).length, 0); assert.strictEqual(segs(z, n, 150).length, 0);
});

test('a hill gives a closed loop: every segment end is shared by exactly two segments', () => {
  const n = 21, z = new Float32Array(n * n);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) z[j * n + i] = 100 - Math.hypot(i - 10, j - 10) * 10;
  const s = segs(z, n, 62), count = new Map();
  s.forEach(([p, q]) => [p, q].forEach((e) => { const k = e[0].toFixed(6) + ',' + e[1].toFixed(6); count.set(k, (count.get(k) || 0) + 1); }));
  assert.ok(s.length > 20);
  count.forEach((v) => assert.strictEqual(v, 2));
  s.forEach(([p]) => assert.ok(Math.abs(Math.hypot(p[0] - 10, p[1] - 10) - 3.8) < 0.25));      // radius 3.8 cells (100 - 10 r = 62)
});

test('missing values (NaN) are skipped without error', () => {
  const n = 4, z = new Float32Array(n * n); for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) z[j * n + i] = i * 10;
  z[5] = NaN;
  assert.doesNotThrow(() => segs(z, n, 15));
});
