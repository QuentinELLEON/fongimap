// Benchmark of the core engine in Node on the real records, tiled x1 / x3 / x5 to emulate bigger datasets.
//   node tools/bench_engine.js            (needs a built data.js)
// Prints init (inflate + decode + index) and filter times for 6 scenarios; results are recorded in specs/performance.md.
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const zlib = require('node:zlib');

const ROOT = path.join(__dirname, '..');
const sandbox = { console, atob: (s) => Buffer.from(s, 'base64').toString('binary') }; sandbox.globalThis = sandbox; vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(ROOT, 'src/js/core/engine.js'), 'utf8'), sandbox);
const core = sandbox.FMAP_CORE;
const sb = { window: {} }; vm.createContext(sb);
vm.runInContext(fs.readFileSync(path.join(ROOT, 'data.js'), 'utf8'), sb);
const M = sb.window.FMAP_META, D = M.dicts;
const t0 = process.hrtime.bigint();
const raw1 = new Uint8Array(zlib.inflateSync(Buffer.from(sb.window.FMAP_DATA, 'base64')));
const inflateMs = Number(process.hrtime.bigint() - t0) / 1e6;
const S = M.sites;
const ms = (f) => { const a = process.hrtime.bigint(); const r = f(); return [Number(process.hrtime.bigint() - a) / 1e6, r]; };

const scen = {
  none: {},
  species: { speciesSet: [D.species.indexOf('Boletus edulis')] },
  month: { monthSet: [10] },
  dept: { deptSet: [D.dept.indexOf('39')] },
  years: { yearMin: 2000, yearMax: 2021 },
  all: { speciesSet: [D.species.indexOf('Boletus edulis'), D.species.indexOf('Amanita phalloides')], monthSet: [9, 10], deptSet: [D.dept.indexOf('39'), D.dept.indexOf('25')], yearMin: 1990, yearMax: 2021, edible: 0 },
};
const base = () => ({ speciesSet: [], phylumSet: [], guildSet: [], trophicSet: [], ecoregionSet: [], monthSet: [], deptSet: [], yearMin: 0, yearMax: 0, edible: 0, commune: -1 });

(async () => {
  console.log('records: ' + M.n_records.toLocaleString() + '   inflate of the packed blob: ' + inflateMs.toFixed(0) + ' ms');
  for (const rep of [1, 3, 5]) {
    const raw = new Uint8Array(raw1.length * rep);
    for (let r = 0; r < rep; r++) raw.set(raw1, r * raw1.length);
    const eng = core.createEngine();
    const [tInit] = await (async () => { const a = process.hrtime.bigint(); await eng.init({ raw, N: M.n_records * rep, nSpecies: D.species.length, sites: { lon: S.lon, lat: S.lat, approx: S.approx, cell: S.cell, commune: S.commune }, edible: M.edible.codes, drawnDepts: D.dept.map((_, i) => i) }); return [Number(process.hrtime.bigint() - a) / 1e6]; })();
    const row = {};
    for (const [name, s] of Object.entries(scen)) {
      eng.filter(Object.assign(base(), s));                       // warm-up
      const times = []; for (let i = 0; i < 5; i++) times.push(ms(() => eng.filter(Object.assign(base(), s)))[0]);
      times.sort((a, b) => a - b); row[name] = times[2].toFixed(0) + ' ms';
    }
    console.log('x' + rep + ' (' + (M.n_records * rep / 1e6).toFixed(1) + ' M)  init(decode+index) ' + tInit.toFixed(0) + ' ms  filter+aggregate median: ' + JSON.stringify(row));
  }
})();
