// A dataset delivered in chunks (engine.init with no records, then engine.append per chunk) must give exactly the
// counters of the same data loaded at once.  Chunk boundaries are arbitrary here (3 uneven pieces).
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const zlib = require('node:zlib');

const ROOT = path.join(__dirname, '..');
const have = fs.existsSync(path.join(ROOT, 'data.js'));

test('chunked loading equals one-shot loading', { skip: !have && 'data.js not built', timeout: 120000 }, async () => {
  const sandbox = { console, atob: (s) => Buffer.from(s, 'base64').toString('binary') }; sandbox.globalThis = sandbox; vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'src/js/core/engine.js'), 'utf8'), sandbox);
  const core = sandbox.FMAP_CORE;
  const sb = { window: {} }; vm.createContext(sb);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'data.js'), 'utf8'), sb);
  const M = sb.window.FMAP_META, D = M.dicts, S = M.sites;
  const raw = new Uint8Array(zlib.inflateSync(Buffer.from(sb.window.FMAP_DATA, 'base64')));
  const N = M.n_records;
  const payload = (n) => ({ N: n, nSpecies: D.species.length, sites: { lon: S.lon, lat: S.lat, approx: S.approx, cell: S.cell, commune: S.commune }, edible: M.edible.codes, drawnDepts: D.dept.map((_, i) => i) });

  const whole = core.createEngine();
  const st1 = await whole.init(Object.assign({ raw }, payload(N)));
  const chunked = core.createEngine();
  await chunked.init(Object.assign({ N: 0 }, payload(0)));
  const cuts = [0, 123457, 700001, N];
  let st2;
  for (let i = 0; i < 3; i++) st2 = await chunked.append({ raw: raw.slice(cuts[i] * 18, cuts[i + 1] * 18) });

  assert.strictEqual(st2.N, st1.N);
  assert.deepStrictEqual([st2.ymin, st2.ymax, st2.located, st2.approxN], [st1.ymin, st1.ymax, st1.located, st1.approxN]);
  assert.deepStrictEqual(Array.from(st2.spFamily), Array.from(st1.spFamily));
  const base = () => ({ speciesSet: [], phylumSet: [], guildSet: [], trophicSet: [], ecoregionSet: [], monthSet: [], deptSet: [], yearMin: 0, yearMax: 0, edible: 0, commune: -1 });
  const scenarios = [{}, { speciesSet: [D.species.indexOf('Boletus edulis')] }, { monthSet: [10], edible: 1 }, { deptSet: [D.dept.indexOf('39')], yearMin: 2000, yearMax: 2021 }];
  for (const s of scenarios) {
    const a = whole.filter(Object.assign(base(), s)), b = chunked.filter(Object.assign(base(), s));
    assert.deepStrictEqual([b.total, b.nSpecies, b.nDepts, b.gps], [a.total, a.nSpecies, a.nDepts, a.gps]);
    assert.deepStrictEqual(Array.from(b.siteCount), Array.from(a.siteCount));
    assert.deepStrictEqual(Array.from(b.byDept), Array.from(a.byDept));
  }
});
