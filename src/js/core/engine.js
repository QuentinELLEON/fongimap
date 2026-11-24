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
