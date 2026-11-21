/* ═══════════════════════════════════════════════════════════════════════════
   Engine client: the only way the UI reaches the record engine.
   Every method returns a Promise.  Two interchangeable back-ends with the same API:
     - 'worker': the engine runs in a Web Worker built from a Blob (the main thread never scans records)
     - 'local' : the engine runs on the main thread (fallback; always used when a Worker cannot start,
                 e.g. some browsers on file://)
   A future 'remote' back-end (server aggregates) plugs in here without touching the UI.
   ═══════════════════════════════════════════════════════════════════════════ */
(function (root) {
  'use strict';
  const core = root.FMAP_CORE = root.FMAP_CORE || {};
  const METHODS = ['init', 'append', 'filter', 'preview', 'richness', 'topWhere', 'scanSpecies', 'info'];

  // ArrayBuffers of typed arrays found at the top level of a result (moved, not copied, to the other thread)
  core.collectTransfers = function (r) {
    const out = [], seen = new Set();
    const add = (v) => { if (v && ArrayBuffer.isView(v) && !seen.has(v.buffer) && v.buffer.byteLength > 0) { seen.add(v.buffer); out.push(v.buffer); } };
    if (r && typeof r === 'object') { add(r); Object.keys(r).forEach((k) => add(r[k])); }
    return out;
  };

  // code appended to the worker source: wires postMessage to the engine
  const WORKER_ENTRY = [
    'const __engine = FMAP_CORE.createEngine();',
    'self.onmessage = async (e) => {',
    '  const { id, method, args } = e.data;',
    '  try {',
    "    const r = method === 'init' ? await __engine.init(args[0], (m, p) => self.postMessage({ id, progress: [m, p] })) : await __engine[method].apply(__engine, args);",
    '    self.postMessage({ id, ok: true, result: r }, FMAP_CORE.collectTransfers(r));',
    '  } catch (err) { self.postMessage({ id, ok: false, error: String(err && err.message ? err.message : err) }); }',
    '};',
  ].join('\n');

  function localClient(opts) {
    const engine = core.createEngine();
    if (opts.yieldFn) engine.setYield(opts.yieldFn);
    const client = { mode: 'local', terminate() {} };
    METHODS.forEach((m) => {
      client[m] = (...args) => new Promise((resolve, reject) => {
        setTimeout(() => {                         // a macrotask: lets the browser paint between calls
          try { resolve(m === 'init' ? engine.init(args[0], opts.onProgress) : engine[m](...args)); } catch (e) { reject(e); }
        }, 0);
      });
    });
    return client;
  }

  function workerClient(opts) {
    return new Promise((resolve, reject) => {
      let w, url;
      try {
        url = URL.createObjectURL(new Blob([opts.workerSource + '\n' + WORKER_ENTRY], { type: 'text/javascript' }));
        w = new Worker(url);
      } catch (e) { reject(e); return; }
      const pending = new Map(); let nextId = 1, alive = false;
      const fail = (err) => { pending.forEach((p) => p.reject(err)); pending.clear(); if (!alive) reject(err); };
      w.onerror = (ev) => fail(new Error('worker error: ' + (ev && ev.message ? ev.message : 'unknown')));
      w.onmessageerror = () => fail(new Error('worker message error'));
      w.onmessage = (e) => {
        const d = e.data, p = pending.get(d.id);
        if (!p) return;
        if (d.progress) { if (opts.onProgress) opts.onProgress(d.progress[0], d.progress[1]); return; }
        pending.delete(d.id);
        if (d.ok) p.resolve(d.result); else p.reject(new Error(d.error));
      };
      const call = (method, args) => new Promise((res, rej) => { const id = nextId++; pending.set(id, { resolve: res, reject: rej }); w.postMessage({ id, method, args }); });
      const client = { mode: 'worker', terminate() { w.terminate(); URL.revokeObjectURL(url); } };
      METHODS.forEach((m) => { client[m] = (...args) => call(m, m === 'init' ? args.slice(0, 1) : args); });   // functions cannot cross postMessage
      // handshake: the worker must answer a trivial call, otherwise fall back
      const timer = setTimeout(() => { w.terminate(); reject(new Error('worker handshake timeout')); }, 4000);
      call('info', []).then(() => { alive = true; clearTimeout(timer); resolve(client); }, (err) => { clearTimeout(timer); reject(err); });
    });
  }

  // opts: { worker: boolean, workerSource: string, yieldFn, onProgress(msg, pct) }
  core.createEngineClient = async function (opts) {
    if (opts.remote && core.createRemoteClient) return core.createRemoteClient(opts.remote);        // records stay on the server
    if (opts.worker && opts.workerSource && typeof Worker !== 'undefined' && typeof Blob !== 'undefined') {
      try { return await workerClient(opts); } catch (e) { if (typeof console !== 'undefined') console.warn('FongiMap: Worker indisponible, moteur sur le fil principal.', e && e.message); }
    }
    return localClient(opts);
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);
