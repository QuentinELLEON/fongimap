#!/usr/bin/env node
// Reference server for the remote-engine contract: wraps the SAME core engine behind
//   POST /v1/datasets/{id}/{method}   {"args": [...]}   ->  JSON (typed arrays as base64)
// Usage:  node tools/serve_remote.js [assets/data/data.js] [port]     (listens on 127.0.0.1 only; development / contract tests)
// A production server would implement the same endpoints over a real store; the browser code does not change.
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const vm = require('node:vm');
const zlib = require('node:zlib');

const ROOT = path.join(__dirname, '..');
const METHODS = new Set(['filter', 'preview', 'richness', 'topWhere', 'scanSpecies', 'nearby', 'info']);

function loadCore() {
  const sb = { console, Buffer, atob: (s) => Buffer.from(s, 'base64').toString('binary') }; sb.globalThis = sb; vm.createContext(sb);
  for (const f of ['engine.js', 'engine-remote.js']) vm.runInContext(fs.readFileSync(path.join(ROOT, 'src/js/core', f), 'utf8'), sb, { filename: f });
  return sb.FMAP_CORE;
}

// load a data.js and start an engine on it -> { core, engine, meta }
async function startEngine(dataFile, drawnDepts) {
  const core = loadCore();
  const sb = { window: {} }; vm.createContext(sb);
  vm.runInContext(fs.readFileSync(dataFile, 'utf8'), sb, { filename: path.basename(dataFile) });
  const M = sb.window.FMAP_META, S = M.sites;
  const engine = core.createEngine();
  await engine.init({
    raw: new Uint8Array(zlib.inflateSync(Buffer.from(sb.window.FMAP_DATA, 'base64'))), N: M.n_records, nSpecies: M.dicts.species.length,
    sites: { lon: S.lon, lat: S.lat, approx: S.approx, cell: S.cell, commune: S.commune }, edible: M.edible.codes,
    drawnDepts: drawnDepts || M.dicts.dept.map((_, i) => i),
  });
  return { core, engine, meta: M };
}

function createServer(core, engine, datasetId) {
  return http.createServer((req, res) => {
    const m = /^\/v1\/datasets\/([^/]+)\/(\w+)$/.exec(req.url || '');
    const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type' };
    if (req.method === 'OPTIONS') { res.writeHead(204, cors); res.end(); return; }
    if (req.method !== 'POST' || !m || decodeURIComponent(m[1]) !== datasetId || !METHODS.has(m[2])) { res.writeHead(404, cors); res.end('not found'); return; }
    let body = '';
    req.on('data', (c) => { body += c; if (body.length > 1e6) req.destroy(); });
    req.on('end', async () => {
      try {
        const args = JSON.parse(body, core.decodeTyped).args || [];
        const out = await engine[m[2]](...args);
        res.writeHead(200, Object.assign({ 'Content-Type': 'application/json' }, cors));
        res.end(JSON.stringify(out, core.encodeTyped));
      } catch (e) { if (res.headersSent) { res.destroy(); return; } res.writeHead(400, cors); res.end(String(e && e.message ? e.message : e)); }
    });
  });
}

module.exports = { startEngine, createServer };

if (require.main === module) {
  const dataFile = path.resolve(process.argv[2] || path.join(ROOT, 'assets/data/data.js')), port = +process.argv[3] || 8787;
  startEngine(dataFile).then(({ core, engine }) => {
    createServer(core, engine, 'fongibase').listen(port, '127.0.0.1', () => console.log('remote engine on http://127.0.0.1:' + port + '/v1/datasets/fongibase/<method>'));
  });
}
