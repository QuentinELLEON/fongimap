// The remote engine (HTTP + JSON) must answer exactly like the local engine: same counters, same per-place queries.
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const have = fs.existsSync(path.join(ROOT, 'assets/data/data.js'));

test('remote engine equals the local engine', { skip: !have && 'data.js not built', timeout: 120000 }, async () => {
  const { startEngine, createServer } = require('../tools/serve_remote.js');
  const { core, engine, meta } = await startEngine(path.join(ROOT, 'assets/data/data.js'));
  const server = createServer(core, engine, 'fongibase');
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  try {
    // client code runs in its own context, like the browser would
    const sb = { fetch, console, btoa, atob, Buffer }; sb.globalThis = sb; vm.createContext(sb);
    for (const f of ['engine.js', 'engine-remote.js']) vm.runInContext(fs.readFileSync(path.join(ROOT, 'src/js/core', f), 'utf8'), sb);
    const remote = sb.FMAP_CORE.createRemoteClient({ url: 'http://127.0.0.1:' + port, dataset: 'fongibase' });
    const D = meta.dicts;
    const st = { speciesSet: [D.species.indexOf('Boletus edulis')], phylumSet: [], guildSet: [], trophicSet: [], ecoregionSet: [], monthSet: [9, 10], deptSet: [], yearMin: 2000, yearMax: 2021, edible: 0, commune: -1 };
    const a = engine.filter(st), b = await remote.filter(st);
    assert.deepStrictEqual([b.total, b.nSpecies, b.nDepts, b.gps], [a.total, a.nSpecies, a.nDepts, a.gps]);
    assert.deepStrictEqual(Array.from(b.siteCount), Array.from(a.siteCount));
    assert.deepStrictEqual(Array.from(b.byDept), Array.from(a.byDept));
    const t1 = engine.topWhere({ kind: 'dept', di: D.dept.indexOf('39') }, 3), t2 = await remote.topWhere({ kind: 'dept', di: D.dept.indexOf('39') }, 3);
    assert.deepStrictEqual(JSON.parse(JSON.stringify(t2)), JSON.parse(JSON.stringify(t1)));
    const i = await remote.init();
    assert.strictEqual(i.N, meta.n_records);
  } finally { server.closeAllConnections(); server.close(); }
});
