// Golden-master test of the core engine in Node (no browser): the counters for 20 filter scenarios must equal
// the ones recorded from the original application (tests/golden/baseline.json).
// Run:  node --test tests/
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const zlib = require('node:zlib');

const ROOT = path.join(__dirname, '..');
const dataPath = path.join(ROOT, 'data.js');
const have = fs.existsSync(dataPath);

function loadCore() {
  const sandbox = { console, atob: (s) => Buffer.from(s, 'base64').toString('binary') };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  for (const f of ['engine.js']) vm.runInContext(fs.readFileSync(path.join(ROOT, 'src/js/core', f), 'utf8'), sandbox, { filename: f });
  return sandbox.FMAP_CORE;
}

// départements drawn on the basemap: dictionary entries whose code matches a GeoJSON feature (same rule as the app)
function drawnDepts(dict) {
  const norm = (s) => { const x = String(s).trim().toUpperCase(); return /^\d+$/.test(x) ? String(parseInt(x, 10)) : x; };
  const gj = JSON.parse(fs.readFileSync(path.join(ROOT, 'data_processed/departements.geojson'), 'utf8').replace(/^﻿/, ''));
  const codes = new Set(gj.features.map((f) => norm(f.properties.code)));
  return dict.map((c, i) => (codes.has(norm(c)) ? i : -1)).filter((i) => i >= 0);
}

function loadData() {
  const sb = { window: {} };
  vm.createContext(sb);
  vm.runInContext(fs.readFileSync(dataPath, 'utf8'), sb, { filename: 'data.js' });
  return sb.window;
}

test('engine reproduces the golden counters', { skip: !have && 'data.js not built', timeout: 120000 }, async () => {
  const core = loadCore();
  const { FMAP_META: M, FMAP_DATA: b64 } = loadData();
  const D = M.dicts;
  const raw = new Uint8Array(zlib.inflateSync(Buffer.from(b64, 'base64')));
  const eng = core.createEngine();
  const S = M.sites;
  const stats = await eng.init({
    raw, N: M.n_records, nSpecies: D.species.length,
    sites: { lon: S.lon, lat: S.lat, approx: S.approx, cell: S.cell, commune: S.commune },
    edible: M.edible.codes, drawnDepts: drawnDepts(D.dept),
  });
  assert.strictEqual(stats.N, 1043262);

  const scenarios = JSON.parse(fs.readFileSync(path.join(__dirname, 'golden/scenarios.json'), 'utf8'));
  const baseline = JSON.parse(fs.readFileSync(path.join(__dirname, 'golden/baseline.json'), 'utf8'));
  const diffs = [];
  for (const s of scenarios) {
    const st = { speciesSet: [], phylumSet: [], guildSet: [], trophicSet: [], ecoregionSet: [], monthSet: s.months || [], deptSet: [], yearMin: s.yearMin || 0, yearMax: s.yearMax || 0, edible: s.edible || 0, commune: -1 };
    (s.species || []).forEach((n) => st.speciesSet.push(D.species.indexOf(n)));
    (s.depts || []).forEach((c) => st.deptSet.push(D.dept.indexOf(c)));
    (s.phylum || []).forEach((n) => st.phylumSet.push(D.phylum.indexOf(n)));
    st.guildSet = s.guildRank || [];
    if (s.commune) st.commune = M.communes.names.findIndex((n, i) => n === s.commune[0] && String(M.communes.dep[i]) === s.commune[1]);
    const a = eng.filter(st);
    const top = []; for (let i = 0; i < a.bySpecies.length; i++) if (a.bySpecies[i] > 0) top.push([i, a.bySpecies[i]]);
    top.sort((p, q) => q[1] - p[1] || p[0] - q[0]);
    let sitesOn = 0, sitesSum = 0; for (const v of a.siteCount) if (v > 0) { sitesOn++; sitesSum += v; }
    let deptsSum = 0; for (const v of a.byDept) deptsSum += v;
    const got = { total: a.total, nSpecies: a.nSpecies, nDepts: a.nDepts, gps: a.gps, sitesOn, sitesSum, deptsSum, top5: top.slice(0, 5).map((t) => [D.species[t[0]] === undefined ? null : D.species[t[0]], t[1]]) };
    try { assert.deepStrictEqual(got, baseline[s.id]); } catch (e) { diffs.push(s.id + ': ' + JSON.stringify(got)); }
  }
  assert.deepStrictEqual(diffs, [], 'scenarios that differ from tests/golden/baseline.json');
});
