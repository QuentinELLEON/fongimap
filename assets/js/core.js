// Record engine and helpers (no DOM): built from src/js/core by tools/build_web.py
/* ═══════════════════════════════════════════════════════════════════════════
   FongiMap core engine: record columns, filters, aggregation, per-record queries.

   No DOM, no globals except `fflate` (inflate) and `atob` when a base64 payload is given.
   Runs unchanged in three places: the page (main thread), a Web Worker, and Node (tests).
   The UI only talks to it through the promise-based client in engine-client.js.

   Binary record format v1: 18 bytes/record, little-endian (documented in build.py):
     0 lon_q u16 | 2 lat_q u16 | 4 year u16 | 6 month u8 | 7 species u16 | 9 family | 10 order | 11 class_
     12 phylum | 13 guild | 14 trophic | 15 dept | 16 ecoregion | 17 corine   (u8 each; 0xFF = missing)

   Filter model: one pass writes failMask[i] (bit set = record fails that filter). A record "passes"
   when failMask[i] === 0.  The species list ignores only F.SPECIES and the map's départements
   ignore only F.DEPT, so the other values stay visible next to the selected ones (cross-filtering).
   ═══════════════════════════════════════════════════════════════════════════ */
(function (root) {
  'use strict';
  const core = root.FMAP_CORE = root.FMAP_CORE || {};

  const REC = 18, SP_MISSING = 0xFFFE, MISSING = 0xFF, COORD_MISSING = 0xFFFF, RARE_N = 100;
  const F = { SPECIES: 1, PHYLUM: 2, GUILD: 4, TROPHIC: 8, ECO: 16, YEAR: 32, MONTH: 64, DEPT: 128, EDIBLE: 256, COMMUNE: 512 };
  const FORMAT_VERSION = 1;                      // layout above; tools/build_data.py writes the same number in META.format.version
  core.FORMAT_VERSION = FORMAT_VERSION;
  core.F = F; core.REC = REC; core.SP_MISSING = SP_MISSING; core.MISSING = MISSING; core.RARE_N = RARE_N;

  // CRC-32 (IEEE) of a byte array, to check a record blob against META.format.crc32 / chunks[i].crc32
  let CRC_TABLE = null;
  core.crc32 = function (bytes) {
    if (!CRC_TABLE) { CRC_TABLE = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; CRC_TABLE[n] = c >>> 0; } }
    let c = 0xFFFFFFFF; for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  };
  // a dataset announces its layout in META.format; datasets built before the header existed have none and are read as version 1
  function checkFormat(fmt) {
    if (!fmt) return;
    if (fmt.version !== FORMAT_VERSION || fmt.record_bytes !== REC) throw new Error('Format de données non pris en charge (version ' + fmt.version + ', ' + fmt.record_bytes + ' octets par observation) : reconstruisez le jeu avec tools/build_data.py.');
  }
  const verifyCrc = (raw, crc, what) => { if (crc !== undefined && crc !== null && core.crc32(raw) !== crc) throw new Error('Somme de contrôle invalide (' + what + ') : fichier de données corrompu ou incomplet.'); };

  const tableFromList = (list, size) => { const t = new Uint8Array(size); for (let i = 0; i < list.length; i++) t[list[i]] = 1; return t; };

  // split the interleaved records into one typed array per field
  function splitColumns(raw, N) {
    const c = {
      lonQ: new Uint16Array(N), latQ: new Uint16Array(N), year: new Uint16Array(N), month: new Uint8Array(N), species: new Uint16Array(N),
      family: new Uint8Array(N), order: new Uint8Array(N), class_: new Uint8Array(N), phylum: new Uint8Array(N), guild: new Uint8Array(N),
      trophic: new Uint8Array(N), dept: new Uint8Array(N), ecoregion: new Uint8Array(N), corine: new Uint8Array(N),
    };
    for (let i = 0, o = 0; i < N; i++, o += REC) {
      c.lonQ[i] = raw[o] | (raw[o + 1] << 8); c.latQ[i] = raw[o + 2] | (raw[o + 3] << 8);
      c.year[i] = raw[o + 4] | (raw[o + 5] << 8); c.month[i] = raw[o + 6];
      c.species[i] = raw[o + 7] | (raw[o + 8] << 8);
      c.family[i] = raw[o + 9]; c.order[i] = raw[o + 10]; c.class_[i] = raw[o + 11];
      c.phylum[i] = raw[o + 12]; c.guild[i] = raw[o + 13]; c.trophic[i] = raw[o + 14];
      c.dept[i] = raw[o + 15]; c.ecoregion[i] = raw[o + 16]; c.corine[i] = raw[o + 17];
    }
    return c;
  }
  core.splitColumns = splitColumns;

  function decodeBase64(b64) {
    const bin = atob(b64), out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  function createEngine() {
    let N = 0, c = null, failMask = null, siteOf = null, nSites = 0, S = null, ediOf = null, drawn = null, nSpeciesDict = 0, ready = false;
    let yieldFn = null, key2site = null, run = null;
    // site, family and statistics of records [from, to)
    const indexRecords = (from, to) => {
      for (let i = from; i < to; i++) {
        if (c.lonQ[i] !== COORD_MISSING) {
          const k = key2site.get(c.lonQ[i] * 65536 + c.latQ[i]);
          if (k !== undefined) { siteOf[i] = k; run.located++; if (S.approx[k]) run.approxN++; }
        }
        const sp = c.species[i]; if (sp < SP_MISSING && run.spFamily[sp] === MISSING) run.spFamily[sp] = c.family[i];
        const y = c.year[i]; if (y) { if (y < run.ymin) run.ymin = y; if (y > run.ymax) run.ymax = y; }
      }
    };
    const summary = () => ({ N, ymin: run.ymin, ymax: run.ymax, located: run.located, approxN: run.approxN, spFamily: run.spFamily.slice() });
    const step = async (msg, pct, progress) => { if (progress) progress(msg, pct); if (yieldFn) await yieldFn(); };

    const engine = {
      setYield(fn) { yieldFn = fn; },

      // payload: { b64 | packed | raw, N, sites:{lon,lat,approx,cell,commune}, edible: codes string|null, drawnDepts: [dept idx], nSpecies }
      async init(p, progress) {
        checkFormat(p.format);
        N = p.N; S = p.sites || { lon: [], lat: [], approx: [], cell: [], commune: [] }; nSites = S.lon.length;
        nSpeciesDict = p.nSpecies;
        let raw = p.raw;
        if (!raw && p.N === 0) raw = new Uint8Array(0);
        if (!raw) {
          await step('Décodage…', 15, progress);
          const packed = p.packed || decodeBase64(p.b64);
          await step('Décompression…', 30, progress);
          raw = root.fflate.unzlibSync(packed);
        }
        if (raw.length !== N * REC) throw new Error('Taille des données inattendue (' + raw.length + ' ≠ ' + N * REC + ').');
        if (p.verify) verifyCrc(raw, p.crc32, 'jeu de données');
        await step('Indexation de ' + N.toLocaleString('fr-FR') + ' observations…', 50, progress);
        c = splitColumns(raw, N); raw = null;
        failMask = new Uint16Array(N);
        drawn = new Uint8Array(256); (p.drawnDepts || []).forEach((d) => { drawn[d] = 1; });
        ediOf = new Uint8Array(65536);
        if (p.edible) for (let i = 0; i < p.edible.length; i++) ediOf[i] = p.edible.charCodeAt(i) - 48;

        // record -> site (exact position) and species -> family, year span, located share: one pass each
        key2site = new Map();
        for (let k = 0; k < nSites; k++) key2site.set(S.lon[k] * 65536 + S.lat[k], k);
        siteOf = new Int32Array(N).fill(-1);
        run = { spFamily: new Uint8Array(65536).fill(MISSING), ymin: 9999, ymax: 0, located: 0, approxN: 0 };
        indexRecords(0, N);
        ready = true;
        return summary();
      },

      // add records (a later chunk of the same dataset: same dictionaries and sites, append-only). Columns grow in place.
      async append(p) {
        const raw = p.raw || root.fflate.unzlibSync(p.packed || decodeBase64(p.b64));
        if (raw.length % REC !== 0) throw new Error('Morceau de données invalide.');
        if (p.verify) verifyCrc(raw, p.crc32, 'morceau');
        const n = raw.length / REC, add = splitColumns(raw, n), N0 = N;
        const merged = {};
        Object.keys(c).forEach((k) => { merged[k] = new c[k].constructor(N0 + n); merged[k].set(c[k]); merged[k].set(add[k], N0); });
        c = merged; N = N0 + n; failMask = new Uint16Array(N);
        const so = new Int32Array(N).fill(-1); so.set(siteOf); siteOf = so;
        indexRecords(N0, N);
        return summary();
      },

      // one pass -> failMask, one pass -> counts. `st`: { speciesSet, phylumSet, guildSet, trophicSet, ecoregionSet, monthSet, deptSet: number[],
      //                                                    yearMin, yearMax (0 = off), edible (0|1|2), commune (-1 = off) }
      filter(st) {
        const t0 = Date.now();
        const useSp = st.speciesSet.length > 0, usePh = st.phylumSet.length > 0, useGu = st.guildSet.length > 0;
        const useTr = st.trophicSet.length > 0, useEc = st.ecoregionSet.length > 0;
        const useYr = st.yearMin > 0, useMo = st.monthSet.length > 0, useDe = st.deptSet.length > 0;
        const useEd = st.edible > 0, useCo = st.commune >= 0, so = siteOf;
        const sOk = new Uint8Array(nSites);
        if (useCo) for (let k = 0; k < nSites; k++) if (S.commune[k] === st.commune) sOk[k] = 1;
        const spT = tableFromList(st.speciesSet, 65536), phT = tableFromList(st.phylumSet, 256), guT = tableFromList(st.guildSet, 256);
        const trT = tableFromList(st.trophicSet, 256), ecT = tableFromList(st.ecoregionSet, 256), moT = tableFromList(st.monthSet, 16), deT = tableFromList(st.deptSet, 256);
        const edT = new Uint8Array(8);
        if (st.edible === 1) { edT[1] = 1; edT[2] = 1; } else if (st.edible === 2) { edT[4] = 1; edT[5] = 1; }
        const y0 = st.yearMin, y1 = st.yearMax, ed = ediOf, fm = failMask;
        const species = c.species, phylum = c.phylum, guild = c.guild, trophic = c.trophic, ecoregion = c.ecoregion, year = c.year, month = c.month, dept = c.dept;
        for (let i = 0; i < N; i++) {
          let f = 0;
          if (useSp && spT[species[i]] === 0) f |= F.SPECIES;
          if (usePh && phT[phylum[i]] === 0) f |= F.PHYLUM;
          if (useGu && guT[guild[i]] === 0) f |= F.GUILD;
          if (useTr && trT[trophic[i]] === 0) f |= F.TROPHIC;
          if (useEc && ecT[ecoregion[i]] === 0) f |= F.ECO;
          if (useYr) { const y = year[i]; if (y === 0 || y < y0 || y > y1) f |= F.YEAR; }
          if (useMo && moT[month[i]] === 0) f |= F.MONTH;
          if (useDe && deT[dept[i]] === 0) f |= F.DEPT;
          if (useEd && edT[ed[species[i]]] === 0) f |= F.EDIBLE;
          if (useCo) { const s = so[i]; if (s < 0 || sOk[s] === 0) f |= F.COMMUNE; }
          fm[i] = f;
        }
        const t1 = Date.now();
        const bySpecies = new Uint32Array(65536), byDept = new Uint32Array(256), siteCount = new Uint32Array(nSites);
        const seenSp = new Uint8Array(65536), seenDe = new Uint8Array(256);
        let total = 0, nSp = 0, gps = 0;
        for (let i = 0; i < N; i++) {
          const f = fm[i];
          if (f === 0) {
            total++;
            const s = species[i]; bySpecies[s]++;
            if (seenSp[s] === 0) { seenSp[s] = 1; nSp++; }
            const d = dept[i]; byDept[d]++; seenDe[d] = 1;
            const st2 = so[i]; if (st2 >= 0) { siteCount[st2]++; gps++; }
          } else if (f === F.SPECIES) bySpecies[species[i]]++;      // fails only the species filter: the browser still lists it
          else if (f === F.DEPT) byDept[dept[i]]++;                 // fails only the département filter: the map still shows it
        }
        if (seenSp[SP_MISSING]) nSp--;
        let nDe = 0; for (let d = 0; d < 256; d++) if (seenDe[d] === 1 && drawn[d] === 1) nDe++;
        return { total, nSpecies: nSp, nDepts: nDe, gps, bySpecies, byDept, siteCount, ms: { filter: t1 - t0, aggregate: Date.now() - t1 } };
      },

      // distribution of one species among records passing every filter except the species filter
      preview(idx) {
        const byDept = new Uint32Array(256), siteCount = new Uint32Array(nSites), mask = ~F.SPECIES, fm = failMask, species = c.species, dept = c.dept;
        for (let i = 0; i < N; i++) {
          if (species[i] !== idx || (fm[i] & mask) !== 0) continue;
          byDept[dept[i]]++;
          const s = siteOf[i]; if (s >= 0) siteCount[s]++;
        }
        return { byDept, siteCount };
      },

      // species richness per département (and Hurlbert rarefied richness when metric === 'rarefied'), ignoring the département filter
      richness(metric) {
        const L = nSpeciesDict, keep = ~F.DEPT, deptSp = new Uint16Array(256 * L), species = c.species, dept = c.dept;
        for (let i = 0; i < N; i++) {
          if ((failMask[i] & keep) !== 0) continue;
          const s = species[i], d = dept[i];
          if (s >= L || d === MISSING) continue;
          const k = d * L + s; if (deptSp[k] < 65535) deptSp[k]++;
        }
        const rich = new Float32Array(256), rare = new Float32Array(256).fill(NaN);
        for (let d = 0; d < 256; d++) {
          if (!drawn[d]) continue;
          let tot = 0, r = 0; const o = d * L;
          for (let s = 0; s < L; s++) { const n = deptSp[o + s]; if (n) { tot += n; r++; } }
          rich[d] = r;
          if (metric !== 'rarefied' || tot < RARE_N) continue;
          let e = 0;                                  // Hurlbert: E[S_n] = sum over species of 1 - C(tot - c, n) / C(tot, n)
          for (let s = 0; s < L; s++) {
            const n = deptSp[o + s]; if (!n) continue;
            if (tot - n < RARE_N) { e += 1; continue; }
            let pr = 1; for (let j = 0; j < RARE_N; j++) pr *= (tot - n - j) / (tot - j);
            e += 1 - pr;
          }
          rare[d] = e;
        }
        return { rich, rare };
      },

      // top species (and distinct count) among records passing the current filters, restricted to a place:
      //  { kind: 'dept', di } | { kind: 'site', s } | { kind: 'sites', list } | { kind: 'cell', c, siteCell, showApprox }
      topWhere(spec, n) {
        const keep = spec.kind === 'dept' ? ~F.DEPT : ~0, spc = new Map(), fm = failMask, species = c.species, dept = c.dept, guild = c.guild;
        let inSet = null;
        if (spec.kind === 'sites') inSet = tableFromList(spec.list, nSites);
        if (spec.kind === 'cell') inSet = new Uint8Array(nSites);
        if (spec.kind === 'cell') for (let k = 0; k < nSites; k++) if (S.cell[k] === spec.c && (spec.showApprox || !S.approx[k])) inSet[k] = 1;
        const gc = new Uint32Array(256);
        for (let i = 0; i < N; i++) {
          if ((fm[i] & keep) !== 0) continue;
          if (spec.kind === 'dept') { if (dept[i] !== spec.di) continue; gc[guild[i]]++; }
          else if (spec.kind === 'site') { if (siteOf[i] !== spec.s) continue; }
          else { const s = siteOf[i]; if (s < 0 || inSet[s] === 0) continue; }
          const s = species[i]; spc.set(s, (spc.get(s) || 0) + 1);
        }
        const all = [...spc.entries()].filter((e) => e[0] !== SP_MISSING);
        let gB = -1, gM = 0; for (let g = 0; g < 255; g++) if (gc[g] > gM) { gM = gc[g]; gB = g; }
        return { top: all.sort((a, b) => b[1] - a[1] || a[0] - b[0]).slice(0, n), distinct: all.length, guild: gB };
      },

      // What grows around a point, for a season (issue #14). The caller lists the sites inside its radius; the engine counts the
      // records of those sites, per species and per site, independently of the interface filters.
      //   q = { sites: number[] | Int32Array, weights: Float32Array(13) (weight of month 1..12, index 0 unused), edible: 0 | 1 | 2, species: -1 | idx }
      //   -> { season (weighted, per species), all (all months, per species), siteSeason, siteAll (per site; restricted to q.species when given), total, totalSeason }
      nearby(q) {
        const inSet = tableFromList(q.sites, nSites), w = q.weights, ed = ediOf, mode = q.edible || 0, one = q.species === undefined ? -1 : q.species;
        const season = new Float32Array(65536), all = new Uint32Array(65536), siteSeason = new Float32Array(nSites), siteAll = new Uint32Array(nSites);
        const species = c.species, month = c.month; let total = 0, totalSeason = 0;
        for (let i = 0; i < N; i++) {
          const s = siteOf[i];
          if (s < 0 || inSet[s] === 0) continue;
          const sp = species[i];
          if (sp >= SP_MISSING) continue;
          if (mode === 1) { if (ed[sp] !== 1 && ed[sp] !== 2) continue; } else if (mode === 2) { if (ed[sp] !== 4 && ed[sp] !== 5) continue; }
          const wm = w[month[i]] || 0;
          all[sp]++; total++; season[sp] += wm; totalSeason += wm;
          if (one < 0 || one === sp) { siteAll[s]++; siteSeason[s] += wm; }
        }
        return { season, all, siteSeason, siteAll, total, totalSeason };
      },

      // all-time statistics of one species (independent of the filters)
      scanSpecies(idx) {
        const months = new Uint32Array(13), de = new Uint32Array(256), gu = new Uint32Array(256), seen = new Uint8Array(nSites), sites = [];
        const species = c.species, year = c.year, month = c.month, dept = c.dept, guild = c.guild;
        let n = 0, y0 = 9999, y1 = 0, first = -1;
        for (let i = 0; i < N; i++) {
          if (species[i] !== idx) continue;
          n++; if (first < 0) first = i;
          const y = year[i]; if (y) { if (y < y0) y0 = y; if (y > y1) y1 = y; }
          months[month[i]]++; de[dept[i]]++; gu[guild[i]]++;
          const s = siteOf[i]; if (s >= 0 && !seen[s]) { seen[s] = 1; sites.push(s); }
        }
        const tax = first >= 0 ? { phylum: c.phylum[first], class_: c.class_[first], order: c.order[first], family: c.family[first] } : null;
        return { n, y0, y1, months, de, gu, sites: Int32Array.from(sites), tax };
      },

      // cheap probes used by tests / diagnostics
      info() { return Object.assign({ ready, N, nSites }, ready ? summary() : {}); },
    };
    return engine;
  }
  core.createEngine = createEngine;
})(typeof globalThis !== 'undefined' ? globalThis : self);

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
  const METHODS = ['init', 'append', 'filter', 'preview', 'richness', 'topWhere', 'scanSpecies', 'nearby', 'info'];

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

/* ═══════════════════════════════════════════════════════════════════════════
   Bilingual species search: Latin names, French vernacular names (primary + aliases), families.
   Pure functions, no DOM: unit-tested in Node (tests/search.test.js).

   Normalisation (searchKey): lower case, ligatures (œ æ), accents removed, every non-alphanumeric
   character (apostrophe, hyphen, comma…) becomes one space.  "Cœur-de-bœuf" -> "coeur de boeuf".
   (Not the same as the département-name matcher, which glues words together.)

   Matching: every query word must match a word of ONE name (prefix match; the typed words are
   plural-tolerant: "cèpes" finds "cèpe").  Ranking tiers, best first:
     0 whole name equals the query     1 name starts with the query
     2 every query word starts a word  3 every query word occurs inside the name   4 family only
   ═══════════════════════════════════════════════════════════════════════════ */
(function (root) {
  'use strict';
  const core = root.FMAP_CORE = root.FMAP_CORE || {};

  function searchKey(s) {
    return String(s).toLowerCase().replace(/œ/g, 'oe').replace(/æ/g, 'ae').normalize('NFD')
      .replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
  }
  core.searchKey = searchKey;

  // query -> { key, words }: words of >= 4 letters lose a trailing s / x (plural), harmless for prefix matching
  function parseQuery(q) {
    const key = searchKey(q);
    const words = key ? key.split(' ').map((w) => (w.length >= 4 && /[sx]$/.test(w) ? w.slice(0, -1) : w)) : [];
    return { key, words };
  }
  core.parseQuery = parseQuery;

  // entries: array indexed by species: { latin, fr: [primary, ...aliases] | null, family: string }
  function buildSearchIndex(entries) {
    return entries.map((e) => {
      const names = [{ text: e.latin, key: searchKey(e.latin), kind: 'latin' }];
      (e.fr || []).forEach((t, i) => names.push({ text: t, key: searchKey(t), kind: i === 0 ? 'fr' : 'alias' }));
      names.forEach((n) => { n.words = n.key.split(' '); });
      return { names, fam: e.family ? searchKey(e.family) : '' };
    });
  }
  core.buildSearchIndex = buildSearchIndex;

  // -> { tier, via } for one species, or null when it does not match
  function matchOne(rec, Q) {
    let best = null;
    for (let i = 0; i < rec.names.length; i++) {
      const n = rec.names[i];
      let tier = -1;
      if (n.key === Q.key) tier = 0;
      else if (n.key.startsWith(Q.key)) tier = 1;
      else if (Q.words.every((w) => n.words.some((x) => x.startsWith(w)))) tier = 2;
      else if (Q.words.every((w) => n.key.includes(w))) tier = 3;
      if (tier >= 0 && (best === null || tier < best.tier)) best = { tier, via: i };
    }
    if (best === null && rec.fam && Q.words.every((w) => rec.fam.includes(w))) best = { tier: 4, via: -1 };
    return best;
  }
  core.matchOne = matchOne;

  // all matches: Int32Array-like list of species indices with tiers, filtered by an optional predicate (e.g. count > 0)
  function search(index, query, accept) {
    const Q = parseQuery(query);
    if (!Q.key) return null;                                 // empty query: no restriction
    const out = [];
    for (let s = 0; s < index.length; s++) {
      if (accept && !accept(s)) continue;
      const m = matchOne(index[s], Q);
      if (m) out.push({ s, tier: m.tier, via: m.via });
    }
    return out;
  }
  core.search = search;
})(typeof globalThis !== 'undefined' ? globalThis : self);

/* ═══════════════════════════════════════════════════════════════════════════
   Shareable view: filters + map position serialised in the URL hash (works on file://, nothing is sent to a server).
   Only STABLE identifiers are used (Latin names, département / INSEE codes, FUNGuild names), never dictionary indices,
   which change from one build to the next.  Pure functions, unit-tested in Node (tests/urlstate.test.js).
   Example:  #sp=Boletus%20edulis&m=9,10&d=39&y=2000-2021&e=1&v=5.700,46.700,6.0
   ═══════════════════════════════════════════════════════════════════════════ */
(function (root) {
  'use strict';
  const core = root.FMAP_CORE = root.FMAP_CORE || {};
  const LIST = '~';                                          // separator of names (a Latin name never contains it)
  const enc = (s) => encodeURIComponent(s).replace(/%7E/g, '~');
  const dec = (s) => { try { return decodeURIComponent(s); } catch (e) { return ''; } };

  core.defaultViewState = () => ({ sp: [], q: '', m: [], d: [], y: null, c: '', e: 0, g: [], ph: [], tr: [], ec: [], v: null, l: 'auto', mt: 'density', n: '', fo: 1, al: 1 });

  // model -> "k=v&k=v" (defaults omitted)
  core.encodeState = function (s) {
    const out = [], D = core.defaultViewState();
    const names = (k) => { if (s[k] && s[k].length) out.push(k + '=' + s[k].map(enc).join(LIST)); };
    names('sp');
    if (s.q) out.push('q=' + enc(s.q));
    if (s.m && s.m.length) out.push('m=' + s.m.join(','));
    if (s.d && s.d.length) out.push('d=' + s.d.map(enc).join(','));
    if (s.y && s.y.length === 2) out.push('y=' + s.y[0] + '-' + s.y[1]);
    if (s.c) out.push('c=' + enc(s.c));
    if (s.e) out.push('e=' + s.e);
    names('g'); names('ph'); names('tr'); names('ec');
    if (s.v && s.v.length === 3) out.push('v=' + s.v[0].toFixed(3) + ',' + s.v[1].toFixed(3) + ',' + s.v[2].toFixed(1));
    if (s.l && s.l !== D.l) out.push('l=' + enc(s.l));
    if (s.mt && s.mt !== D.mt) out.push('mt=' + enc(s.mt));
    if (s.n) out.push('n=' + enc(s.n));
    if (s.fo === 0) out.push('fo=0');                       // IGN forest / altitude overlays: on by default, only "off" is written
    if (s.al === 0) out.push('al=0');
    return out.join('&');
  };

  // "k=v&k=v" -> model; unknown keys and malformed values are ignored, never an error
  core.decodeState = function (str) {
    const s = core.defaultViewState();
    String(str || '').replace(/^#/, '').split('&').forEach((kv) => {
      const i = kv.indexOf('='); if (i < 1) return;
      const k = kv.slice(0, i), v = kv.slice(i + 1);
      const names = () => v.split(LIST).map(dec).filter(Boolean);
      const ints = () => v.split(',').map((x) => parseInt(x, 10)).filter((x) => Number.isFinite(x));
      switch (k) {
        case 'sp': case 'g': case 'ph': case 'tr': case 'ec': s[k] = names(); break;
        case 'q': s.q = dec(v); break;
        case 'm': s.m = ints().filter((x) => x >= 1 && x <= 12); break;
        case 'd': s.d = v.split(',').map(dec).filter(Boolean); break;
        case 'y': { const p = v.split('-').map((x) => parseInt(x, 10)); if (p.length === 2 && p.every(Number.isFinite) && p[0] <= p[1]) s.y = p; break; }
        case 'c': s.c = dec(v); break;
        case 'e': { const e = parseInt(v, 10); s.e = e === 1 || e === 2 ? e : 0; break; }
        case 'v': { const p = v.split(',').map(Number); if (p.length === 3 && p.every(Number.isFinite) && p[2] >= 1 && p[2] <= 80) s.v = p; break; }
        case 'l': s.l = dec(v); break;
        case 'mt': s.mt = dec(v); break;
        case 'fo': s.fo = v === '0' ? 0 : 1; break;
        case 'al': s.al = v === '0' ? 0 : 1; break;
        case 'n': s.n = dec(v) === 'latin' ? 'latin' : dec(v) === 'fr' ? 'fr' : ''; break;
        default: break;
      }
    });
    return s;
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);

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

/* ═══════════════════════════════════════════════════════════════════════════
   Marching squares: isoline segments of a regular elevation grid (used for the IGN altitude overlay).
   z: Float32Array / array of n x n values (row-major, index j * n + i); t: threshold; push(p, q) receives the two end points
   of every segment in grid units (x along i, y along j). Cells with a missing value (NaN) are skipped.
   Pure function, unit-tested in Node (tests/contour.test.js).
   ═══════════════════════════════════════════════════════════════════════════ */
(function (root) {
  'use strict';
  const core = root.FMAP_CORE = root.FMAP_CORE || {};
  core.isoSegments = function isoSegments(z, n, t, push) {
    for (let j = 0; j < n - 1; j++) for (let i = 0; i < n - 1; i++) {
      const a = z[j * n + i], b = z[j * n + i + 1], c = z[(j + 1) * n + i + 1], d = z[(j + 1) * n + i];
      if (a !== a || b !== b || c !== c || d !== d) continue;
      const idx = (a >= t ? 1 : 0) | (b >= t ? 2 : 0) | (c >= t ? 4 : 0) | (d >= t ? 8 : 0);
      if (idx === 0 || idx === 15) continue;
      const L = [i, j + (t - a) / (d - a)], B = [i + (t - a) / (b - a), j], R = [i + 1, j + (t - b) / (c - b)], T = [i + (t - d) / (c - d), j + 1];
      switch (idx) {
        case 1: case 14: push(L, B); break;
        case 2: case 13: push(B, R); break;
        case 3: case 12: push(L, R); break;
        case 4: case 11: push(R, T); break;
        case 6: case 9: push(B, T); break;
        case 7: case 8: push(L, T); break;
        case 5: if ((a + b + c + d) / 4 >= t) { push(L, T); push(B, R); } else { push(L, B); push(R, T); } break;
        case 10: if ((a + b + c + d) / 4 >= t) { push(L, B); push(R, T); } else { push(L, T); push(B, R); } break;
        default: break;
      }
    }
  }
})(typeof globalThis !== 'undefined' ? globalThis : self);

/* ═══════════════════════════════════════════════════════════════════════════
   "Autour de moi" helpers (issue #14): pure functions, no DOM, run in the page and in Node tests.
     - seasonWeights(): how much each calendar month counts for a given day (observations only carry a month)
     - sitesWithin():   which places lie inside a radius around a point, with distance and bearing
     - weatherUrl() / assessWeather(): the optional, online "recent humidity" check (Open-Meteo, see ADR-11)
   The ranking itself (counting records per species and per place) is engine.nearby() in engine.js.
   ═══════════════════════════════════════════════════════════════════════════ */
(function (root) {
  'use strict';
  const core = root.FMAP_CORE = root.FMAP_CORE || {};
  const RAD = Math.PI / 180, KM_PER_DEG_LAT = 111.19;

  const daysInMonth = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();

  // Weight of each month (index 1..12; index 0 = records without a month, never counted) for the day y-m-d.
  // The month of the date counts fully; in the second half of a month the next one starts to count, in the first
  // half the previous one still does (ramp 0 -> 0.5 over half a month), so a date near a month boundary sees both.
  core.seasonWeights = function (y, m, d) {
    const w = new Float32Array(13), dim = daysInMonth(y, m), f = dim > 1 ? (d - 1) / (dim - 1) : 0.5;
    w[m] = 1;
    const prev = m === 1 ? 12 : m - 1, next = m === 12 ? 1 : m + 1;
    w[prev] = Math.max(w[prev], Math.max(0, 0.5 - f));
    w[next] = Math.max(w[next], Math.max(0, f - 0.5));
    return w;
  };

  const COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SO', 'O', 'NO'];
  core.compass = (deg) => COMPASS[Math.round((((deg % 360) + 360) % 360) / 45) % 8];

  // Places (parallel arrays of degrees) within radiusKm of (lon0, lat0). Equirectangular distance: accurate to a few
  // metres over 100 km at French latitudes. Returns { idx: Int32Array, dist: Float32Array (km), bearing: Float32Array (° from north) }.
  core.sitesWithin = function (lon, lat, lon0, lat0, radiusKm) {
    const kx = KM_PER_DEG_LAT * Math.cos(lat0 * RAD), idx = [], dist = [], bearing = [];
    const dLon = radiusKm / kx, dLat = radiusKm / KM_PER_DEG_LAT;
    for (let i = 0; i < lon.length; i++) {
      const dx = (lon[i] - lon0) * kx, dy = (lat[i] - lat0) * KM_PER_DEG_LAT;
      if (Math.abs(lon[i] - lon0) > dLon || Math.abs(lat[i] - lat0) > dLat) continue;
      const r = Math.hypot(dx, dy);
      if (r > radiusKm) continue;
      idx.push(i); dist.push(r); bearing.push(((Math.atan2(dx, dy) / RAD) + 360) % 360);
    }
    return { idx: Int32Array.from(idx), dist: Float32Array.from(dist), bearing: Float32Array.from(bearing) };
  };

  // ── recent weather (optional, online) ────────────────────────────────────────
  // Open-Meteo forecast API: hourly series for the last 14 days up to now, no key, CORS enabled. The position is rounded to
  // 0.01° (about 1 km) before it leaves the page, and only when the user asks for the check.
  core.weatherUrl = function (lat, lon) {
    const r = (v) => (Math.round(v * 100) / 100).toFixed(2);
    return 'https://api.open-meteo.com/v1/forecast?latitude=' + r(lat) + '&longitude=' + r(lon) +
      '&past_days=14&forecast_days=1&timezone=auto&hourly=precipitation,relative_humidity_2m,temperature_2m,soil_moisture_3_to_9cm';
  };

  const mean = (a) => { let s = 0, n = 0; for (const v of a) if (v !== null && v !== undefined && !Number.isNaN(v)) { s += v; n++; } return n ? s / n : null; };
  const sum = (a) => { let s = 0; for (const v of a) if (v !== null && v !== undefined && !Number.isNaN(v)) s += v; return s; };

  // From the API answer to the numbers shown and a deliberately simple verdict. The rule of thumb behind it: fungi fruit
  // after water has soaked the ground and while temperatures are mild (not frozen, not hot). It is an indication, not a
  // validated model: thresholds below are plain constants, listed with their reasons so they can be argued with.
  core.assessWeather = function (api, nowMs) {
    const H = api && api.hourly;
    if (!H || !H.time || !H.time.length) throw new Error('réponse météo vide');
    const nowStr = new Date(nowMs + (api.utc_offset_seconds || 0) * 1000).toISOString().slice(0, 13) + ':00';
    let last = -1; for (let i = 0; i < H.time.length; i++) if (H.time[i] <= nowStr) last = i; else break;
    if (last < 0) throw new Error('pas de données récentes');
    const slice = (arr, n) => (arr || []).slice(Math.max(0, last - n + 1), last + 1);
    const rain3 = sum(slice(H.precipitation, 72)), rain14 = sum(slice(H.precipitation, 336));
    const rh3 = mean(slice(H.relative_humidity_2m, 72)), temp3 = mean(slice(H.temperature_2m, 72));
    const soilRaw = mean(slice(H.soil_moisture_3_to_9cm, 72)), soil3 = soilRaw === null ? null : soilRaw * 100;   // m³/m³ -> %
    const byDay = new Map();
    for (let i = 0; i <= last; i++) { const d = H.time[i].slice(0, 10), v = H.precipitation && H.precipitation[i]; byDay.set(d, (byDay.get(d) || 0) + (v || 0)); }
    const days = Array.from(byDay.entries()).slice(-14).map(([date, mm]) => ({ date, mm: Math.round(mm * 10) / 10 }));

    let points = 0; const reasons = [];
    if (rain14 >= 25) { points += 2; reasons.push(['rain14', 'high']); } else if (rain14 >= 10) { points += 1; reasons.push(['rain14', 'some']); } else if (rain14 < 5) { points -= 2; reasons.push(['rain14', 'low']); } else reasons.push(['rain14', 'some']);
    if (rain3 >= 3) { points += 1; reasons.push(['rain3', 'recent']); }
    if (rh3 !== null) { if (rh3 >= 85) { points += 1; reasons.push(['rh', 'humid']); } else if (rh3 < 65) { points -= 1; reasons.push(['rh', 'dry']); } }
    if (temp3 !== null) { if (temp3 >= 6 && temp3 <= 20) { points += 1; reasons.push(['temp', 'mild']); } else if (temp3 < 2) { points -= 2; reasons.push(['temp', 'cold']); } else if (temp3 > 26) { points -= 2; reasons.push(['temp', 'hot']); } }
    let level = points >= 3 ? 'good' : points >= 1 ? 'mid' : 'low';
    if (temp3 !== null && (temp3 < 2 || temp3 > 28)) level = 'low';        // frost or heat stops fruiting whatever the rain
    return { rain3, rain14, rh3, temp3, soil3, days, level, points, reasons, asOf: H.time[last] };
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);
