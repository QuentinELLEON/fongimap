/* ═══════════════════════════════════════════════════════════════════════════
   Remote engine client: same promise API as the local / worker engines, answered by a server.
   Contract (docs: specs/plans/dynamic-dataset.md §8):  POST {base}/v1/datasets/{id}/{method}   body {"args": [...]}
   The server owns the records; the browser only ever receives bounded aggregates.  Typed arrays travel as
   {"__ta": "Uint32Array", "b64": "..."}.  A reference implementation that wraps the very same core engine is
   tools/serve_remote.js (tests/remote.test.js checks that both give identical counters).
   Not wired to a dataset entry by default: set  mode: "remote", api: "https://…"  in datasets.js to use it.
   ═══════════════════════════════════════════════════════════════════════════ */
(function (root) {
  'use strict';
  const core = root.FMAP_CORE = root.FMAP_CORE || {};
  const TYPES = { Uint8Array, Uint16Array, Uint32Array, Int32Array, Float32Array, Float64Array };

  // JSON replacer / reviver for typed arrays (base64 of the raw little-endian bytes)
  core.encodeTyped = function (key, v) {
    if (v && ArrayBuffer.isView(v) && !(v instanceof DataView)) {
      const bytes = new Uint8Array(v.buffer, v.byteOffset, v.byteLength);
      let b64;
      if (typeof Buffer !== 'undefined') b64 = Buffer.from(bytes).toString('base64');
      else { let s = ''; for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]); b64 = btoa(s); }
      return { __ta: v.constructor.name, b64 };
    }
    return v;
  };
  core.decodeTyped = function (key, v) {
    if (v && typeof v === 'object' && v.__ta && TYPES[v.__ta]) {
      const bin = typeof Buffer !== 'undefined' ? Uint8Array.from(Buffer.from(v.b64, 'base64')) : Uint8Array.from(atob(v.b64), (ch) => ch.charCodeAt(0));
      return new TYPES[v.__ta](bin.buffer);
    }
    return v;
  };

  // opts: { url, dataset }
  core.createRemoteClient = function (opts) {
    const base = String(opts.url).replace(/\/$/, '') + '/v1/datasets/' + encodeURIComponent(opts.dataset) + '/';
    const call = async (method, args) => {
      const r = await fetch(base + method, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ args }, core.encodeTyped) });
      if (!r.ok) throw new Error('serveur : ' + r.status + ' ' + (await r.text()).slice(0, 200));
      return JSON.parse(await r.text(), core.decodeTyped);
    };
    const client = { mode: 'remote', terminate() {} };
    ['filter', 'preview', 'richness', 'topWhere', 'scanSpecies', 'nearby', 'info'].forEach((m) => { client[m] = (...args) => call(m, args); });
    client.init = () => call('info', []);        // the server already holds the records: init just reads its summary
    client.append = () => Promise.reject(new Error('append is not available on a remote dataset'));
    return client;
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);
