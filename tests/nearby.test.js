// "Autour de moi" (issue #14): season weights, radius selection, weather assessment and the engine's nearby() count.
// Synthetic data only (a handful of hand-made records): this test needs neither data.js nor a browser.
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
function loadCore() {
  const sb = { console };
  sb.globalThis = sb; vm.createContext(sb);
  for (const f of ['engine.js', 'nearby.js']) vm.runInContext(fs.readFileSync(path.join(ROOT, 'src/js/core', f), 'utf8'), sb, { filename: f });
  return sb.FMAP_CORE;
}
const core = loadCore();

test('season weights: month of the date counts fully, neighbours ramp in near the boundary', () => {
  let w = core.seasonWeights(2026, 10, 16);                      // mid-month: October only
  assert.strictEqual(w[10], 1); assert.strictEqual(w[9], 0); assert.strictEqual(w[11], 0);
  w = core.seasonWeights(2026, 10, 31);                          // end of month: half of November
  assert.strictEqual(w[10], 1); assert.ok(Math.abs(w[11] - 0.5) < 1e-6); assert.strictEqual(w[9], 0);
  w = core.seasonWeights(2026, 1, 1);                            // start of January: half of December (wraps)
  assert.ok(Math.abs(w[12] - 0.5) < 1e-6); assert.strictEqual(w[0], 0);
  w = core.seasonWeights(2026, 12, 31);                          // end of December: half of January
  assert.ok(Math.abs(w[1] - 0.5) < 1e-6);
});

test('sitesWithin keeps places inside the radius, with distance and bearing', () => {
  // 0: the centre, 1: ~11 km north, 2: ~22 km east (at 46°N), 3: ~200 km away
  const lon = [5.0, 5.0, 5.0 + 22 / (111.19 * Math.cos(46 * Math.PI / 180)), 7.5], lat = [46.0, 46.1, 46.0, 46.0];
  const r = core.sitesWithin(lon, lat, 5.0, 46.0, 25);
  assert.deepStrictEqual(Array.from(r.idx), [0, 1, 2]);
  assert.ok(Math.abs(r.dist[1] - 11.12) < 0.1); assert.ok(Math.abs(r.bearing[1] - 0) < 0.5);
  assert.ok(Math.abs(r.dist[2] - 22) < 0.2); assert.ok(Math.abs(r.bearing[2] - 90) < 0.5);
  assert.strictEqual(core.compass(0), 'N'); assert.strictEqual(core.compass(92), 'E'); assert.strictEqual(core.compass(359), 'N'); assert.strictEqual(core.compass(225), 'SO');
  assert.strictEqual(core.sitesWithin(lon, lat, 5.0, 46.0, 5).idx.length, 1);
});

test('weather: wet and mild recently is favourable, dry or frozen is not', () => {
  const mk = (rainPerHour, rh, temp) => {
    const time = [], precipitation = [], relative_humidity_2m = [], temperature_2m = [], soil_moisture_3_to_9cm = [];
    for (let i = 0; i < 15 * 24; i++) {
      const t = new Date(Date.UTC(2026, 10, 10) + i * 3600e3).toISOString().slice(0, 13) + ':00';
      time.push(t); precipitation.push(rainPerHour); relative_humidity_2m.push(rh); temperature_2m.push(temp); soil_moisture_3_to_9cm.push(0.31);
    }
    return { utc_offset_seconds: 3600, hourly: { time, precipitation, relative_humidity_2m, temperature_2m, soil_moisture_3_to_9cm } };
  };
  const now = Date.UTC(2026, 10, 24, 9, 30);                     // 24 Nov 2026 10:30 local (UTC+1)
  const wet = core.assessWeather(mk(0.2, 90, 11), now);
  assert.strictEqual(wet.level, 'good'); assert.ok(Math.abs(wet.rain3 - 14.4) < 0.01); assert.ok(wet.rain14 > 60);
  assert.ok(Math.abs(wet.soil3 - 31) < 0.01); assert.strictEqual(wet.days.length, 14); assert.strictEqual(wet.days[13].date, '2026-11-24');
  assert.strictEqual(core.assessWeather(mk(0, 55, 14), now).level, 'low');
  assert.strictEqual(core.assessWeather(mk(0.1, 80, -3), now).level, 'low');
  assert.throws(() => core.assessWeather({ hourly: { time: [] } }, now));
  assert.ok(/latitude=46\.60&longitude=5\.90/.test(core.weatherUrl(46.6049, 5.8951)), 'position is rounded to 0.01°');
});

test('engine.nearby counts species and places inside the chosen sites, weighted by season', async () => {
  const rec = (site, month, species) => { const b = Buffer.alloc(18); b.writeUInt16LE(site, 0); b.writeUInt16LE(0, 2); b.writeUInt16LE(2010, 4); b[6] = month; b.writeUInt16LE(species, 7); b.fill(0xFF, 9); return b; };
  // sites 0, 1 inside the radius, site 2 outside. species 0 (edible), 1 (toxic)
  const rows = [rec(0, 10, 0), rec(0, 10, 0), rec(0, 5, 0), rec(1, 11, 1), rec(1, 10, 1), rec(2, 10, 0), rec(0, 0, 1)];
  const raw = new Uint8Array(Buffer.concat(rows));
  const eng = core.createEngine();
  const codes = String.fromCharCode(48 + 1, 48 + 4);              // species 0 -> class 1 (edible), species 1 -> class 4 (toxic)
  await eng.init({ raw, N: rows.length, nSpecies: 2, sites: { lon: [0, 1, 2], lat: [0, 0, 0], approx: [0, 0, 0], cell: [0, 0, 0], commune: [-1, -1, -1] }, edible: codes, drawnDepts: [] });
  const w = core.seasonWeights(2026, 10, 31);                     // October 1, November 0.5
  let r = eng.nearby({ sites: [0, 1], weights: w, edible: 0, species: -1 });
  assert.strictEqual(r.total, 6); assert.strictEqual(r.all[0], 3); assert.strictEqual(r.all[1], 3);
  assert.ok(Math.abs(r.season[0] - 2) < 1e-6);                    // two October records of species 0
  assert.ok(Math.abs(r.season[1] - 1.5) < 1e-6);                  // one October + one November (0.5); the record without month is never in season
  assert.ok(Math.abs(r.siteSeason[0] - 2) < 1e-6); assert.ok(Math.abs(r.siteSeason[1] - 1.5) < 1e-6); assert.strictEqual(r.siteSeason[2], 0);
  r = eng.nearby({ sites: [0, 1], weights: w, edible: 1, species: -1 });
  assert.strictEqual(r.total, 3); assert.strictEqual(r.all[1], 0);
  r = eng.nearby({ sites: [0, 1], weights: w, edible: 2, species: -1 });
  assert.strictEqual(r.total, 3); assert.strictEqual(r.all[0], 0);
  r = eng.nearby({ sites: [0, 1], weights: w, edible: 0, species: 1 });   // places where species 1 was seen
  assert.deepStrictEqual([r.siteAll[0], r.siteAll[1]], [1, 2]);
});

test('format header: unknown versions are refused, the checksum catches corruption', async () => {
  const raw = new Uint8Array(18 * 2).fill(0xFF), good = core.crc32(raw);
  const payload = (extra) => Object.assign({ raw, N: 2, nSpecies: 1, sites: { lon: [], lat: [], approx: [], cell: [], commune: [] }, edible: null, drawnDepts: [] }, extra);
  await core.createEngine().init(payload({ format: { version: core.FORMAT_VERSION, record_bytes: core.REC }, crc32: good, verify: true }));
  await core.createEngine().init(payload({}));                                          // datasets built before the header existed stay readable
  await assert.rejects(core.createEngine().init(payload({ format: { version: 99, record_bytes: 18 } })), /Format de données/);
  await assert.rejects(core.createEngine().init(payload({ crc32: good ^ 1, verify: true })), /Somme de contrôle/);
  assert.strictEqual(core.crc32(new TextEncoder().encode('123456789')), 0xCBF43926);   // the standard CRC-32 check value
});
