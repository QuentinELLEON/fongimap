/* ═══════════════════════════════════════════════════════════════════════════
   FongiMap – application logic (single IIFE, no modules, runs on file://)

   Data: FongiBase extract, Gautier et al. 2022 – https://zenodo.org/records/17158524

   Binary record format (specs/design.md §2.2) – little-endian, 18 bytes/record,
   produced by build.py, zlib-compressed + base64 in data.js (window.FMAP_DATA):

     Offset  Bytes  Type    Field       Notes
     0       2      uint16  lon_q       quantised longitude, 0xFFFF = missing
     2       2      uint16  lat_q       quantised latitude,  0xFFFF = missing
     4       2      uint16  year        0 = missing
     6       1      uint8   month       1-12, 0 = missing
     7       2      uint16  species     index into dicts.species, 0xFFFE = missing
     9       1      uint8   family      index into dicts.family,    0xFF = missing
     10      1      uint8   order       index into dicts.order,     0xFF = missing
     11      1      uint8   class_      index into dicts.class_,    0xFF = missing
     12      1      uint8   phylum      index into dicts.phylum,    0xFF = missing
     13      1      uint8   guild       index into dicts.guild,     0xFF = missing
     14      1      uint8   trophic     index into dicts.trophic,   0xFF = missing
     15      1      uint8   dept        index into dicts.dept,      0xFF = missing
     16      1      uint8   ecoregion   index into dicts.ecoregion, 0xFF = missing
     17      1      uint8   corine      index into dicts.corine,    0xFF = missing

   lon = lon_min + lon_q / 65534 * (lon_max - lon_min)   (same for lat)

   Besides the records, data.js carries META.sites (the distinct GPS positions with their
   locality name) and META.edible (edibility code per species).  A record's site is found
   from its (lon_q, lat_q) pair.

   Filtering model: applyFilters() writes one value per record into failMask.
   Bit i set  <=>  the record fails filter i  (0 = passes every filter).
   The species browser (sidebar) and the map's départements count the records that fail
   *at most their own* filter (species / département), so the list keeps showing the other
   species and the map keeps showing the other départements next to the selected ones
   (cross-filtering, "brushing and linking" between list and map).

   Interaction design follows Shneiderman's mantra: overview first (départements),
   zoom and filter (semantic zoom: densité -> lieux exacts; species browser + filters),
   details on demand (tooltip, species drawer).  All changes animate with D3 joins (enter / update / exit) and
   transitions, which are disabled when the user prefers reduced motion.
   ═══════════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  // ── constants ─────────────────────────────────────────────────────────────
  const REC = 18;
  const SP_MISSING = 0xFFFE, MISSING = 0xFF, COORD_MISSING = 0xFFFF, Q_MAX = 65534;
  const YEAR_LO = 1900, YEAR_HI = 2021;
  const VIRT = 1000;                         // virtual map box the projection is fitted to
  const RARE_N = 100;                        // rarefaction sample size (Hurlbert)
  const EARTH_R_KM = 6371.0088;
  // graduated symbols for places (absolute counts -> size): 1-9, 10-99, 100-999, 1000+ observations
  const SYM_RADII = [3.6, 5.6, 8.5, 13], SYM_LABELS = ['1 – 9', '10 – 99', '100 – 999', '1 000 et plus'];
  const symClass = (w) => (w >= 1000 ? 3 : w >= 100 ? 2 : w >= 10 ? 1 : 0);
  const CLUSTER_PX = 17;                     // places closer than this on screen are grouped into one symbol
  // 10 km grid cells (equal area -> count = density -> lightness ramp): 1-9, 10-49, 50-199, 200-999, 1000+
  const CELL_CUTS = [10, 50, 200, 1000], CELL_LABELS = ['1 – 9', '10 – 49', '50 – 199', '200 – 999', '1 000 et plus'];
  const cellClass = (w) => (w >= 1000 ? 4 : w >= 200 ? 3 : w >= 50 ? 2 : w >= 10 ? 1 : 0);
  const MONTHS = ['Janv', 'Févr', 'Mars', 'Avr', 'Mai', 'Juin', 'Juil', 'Août', 'Sept', 'Oct', 'Nov', 'Déc'];
  // failure bits
  const F_SPECIES = 1, F_PHYLUM = 2, F_GUILD = 4, F_TROPHIC = 8, F_ECO = 16, F_YEAR = 32, F_MONTH = 64, F_DEPT = 128, F_EDIBLE = 256, F_COMMUNE = 512;
  const TABLEAU = d3.schemeTableau10;
  const COL_NA = '#d9d5c6', COL_OTHER = '#9aa59a', COL_ZERO = '#e9e6dc';
  const COL_ACCENT1 = '#3a6b35', COL_ACCENT3 = '#c47b2b';
  const REDUCED = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const DUR = REDUCED ? 0 : 600;
  const EASE = d3.easeCubicOut;

  // edibility classes (indicative, curated – see data_processed/edibility.csv)
  const EDI = [
    { label: 'Comestibilité inconnue', short: 'Inconnue', colour: '#cfcabb', icon: '?' },
    { label: 'Comestible', short: 'Comestible', colour: '#009E73', icon: '✔' },
    { label: 'Comestible après cuisson / avec précautions', short: 'À cuire', colour: '#56B4E9', icon: '♨' },
    { label: 'Non comestible ou sans intérêt', short: 'Non comestible', colour: '#9a9484', icon: '–' },
    { label: 'Toxique', short: 'Toxique', colour: '#E69F00', icon: '⚠' },
    { label: 'Mortel', short: 'Mortel', colour: '#7a1b12', icon: '☠' },
  ];

  const $ = (id) => document.getElementById(id);
  const fmt = (n) => Number(n).toLocaleString('fr-FR');
    const tick = () => new Promise((r) => setTimeout(r, 15));
  const smooth = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
  const trunc = (s, n) => (s.length > n ? s.slice(0, n - 1) + '…' : s);
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  // ── global data (filled by boot) ─────────────────────────────────────────
  let META, DICT, N = 0;
  let lonQ, latQ, year, month, species, family, order_, class_, phylum, guild, trophic, dept, ecoregion, corine;
  let failMask;                              // Uint16Array(N)
  let speciesLower = [];
  let DEPTS, REGIONS;
  let featDept = [];                         // GeoJSON feature index -> dict dept index (-1 = none)
  let deptFeat = new Map();                  // dict dept index -> feature index
  let ediOf = new Uint8Array(65536);         // species index -> edibility class
  let spFamily = new Uint8Array(65536).fill(MISSING);   // species index -> family index (one pass at load)
  let COM = { names: [], dep: [], lon: [], lat: [] }, siteCommune = null;   // commune table, commune of each site
  let nSites = 0, siteOf = null, sitePX = null, sitePY = null, siteName = [];
  let siteTarget = null, siteFrom = null, siteShown = null, siteTree = null, siteApprox = null;

  // ── filter state ─────────────────────────────────────────────────────────
  const state = {
    speciesSet: new Set(), speciesLabel: '',
    phylumSet: new Set(), guildSet: new Set(), trophicSet: new Set(), ecoregionSet: new Set(),
    yearMin: 0, yearMax: 0,                  // 0 = filter disabled
    monthSet: new Set(), deptSet: new Set(),
    edible: 0,                               // 0 all, 1 edible, 2 toxic
    commune: -1,                             // index into META.communes, -1 = no commune filter
  };
  let previewing = false;                    // a species list row is hovered: the map shows its distribution
  let lastAgg = null;
  const perf = { filter: 0, aggregate: 0, render: 0, total: 0 };

  // ═══════════════════════════════════════════════════════════════════════════
  // Bootstrap
  // ═══════════════════════════════════════════════════════════════════════════
  function setLoading(msg, pct) {
    $('loading-msg').textContent = msg;
    if (pct != null) $('loading-bar').style.width = pct + '%';
  }
  function showError(msg) {
    const p = $('loading-msg');
    p.className = 'error'; p.textContent = msg;
    $('loading-spinner').style.display = 'none';
    $('loading-bar-wrap').style.display = 'none';
  }
  function decodeBase64(b64) {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  // split the interleaved 18-byte records into one typed array per field
  function splitColumns(raw) {
    lonQ = new Uint16Array(N); latQ = new Uint16Array(N); year = new Uint16Array(N);
    month = new Uint8Array(N); species = new Uint16Array(N);
    family = new Uint8Array(N); order_ = new Uint8Array(N); class_ = new Uint8Array(N);
    phylum = new Uint8Array(N); guild = new Uint8Array(N); trophic = new Uint8Array(N);
    dept = new Uint8Array(N); ecoregion = new Uint8Array(N); corine = new Uint8Array(N);
    for (let i = 0, o = 0; i < N; i++, o += REC) {
      lonQ[i] = raw[o] | (raw[o + 1] << 8);
      latQ[i] = raw[o + 2] | (raw[o + 3] << 8);
      year[i] = raw[o + 4] | (raw[o + 5] << 8);
      month[i] = raw[o + 6];
      species[i] = raw[o + 7] | (raw[o + 8] << 8);
      family[i] = raw[o + 9]; order_[i] = raw[o + 10]; class_[i] = raw[o + 11];
      phylum[i] = raw[o + 12]; guild[i] = raw[o + 13]; trophic[i] = raw[o + 14];
      dept[i] = raw[o + 15]; ecoregion[i] = raw[o + 16]; corine[i] = raw[o + 17];
    }
  }

  async function boot() {
    try {
      setLoading('Lecture des données…', 5);
      await tick();
      if (!window.FMAP_META || typeof window.FMAP_DATA !== 'string') {
        throw new Error('Fichier data.js introuvable ou invalide.\nExécutez build.py puis placez data.js dans le même dossier que index.html.');
      }
      META = window.FMAP_META; DICT = META.dicts; N = META.n_records;
      DEPTS = window.FMAP_DEPTS; REGIONS = window.FMAP_REGIONS;

      setLoading('Décodage…', 15); await tick();
      const packed = decodeBase64(window.FMAP_DATA);
      window.FMAP_DATA = null;

      setLoading('Décompression…', 30); await tick();
      const raw = fflate.unzlibSync(packed);
      if (raw.length !== N * REC) throw new Error('Taille des données inattendue (' + raw.length + ' ≠ ' + N * REC + ').');

      setLoading('Indexation de ' + fmt(N) + ' observations…', 50); await tick();
      splitColumns(raw);
      failMask = new Uint16Array(N);
      speciesLower = DICT.species.map((s) => s.toLowerCase());
      for (let i = 0; i < N; i++) { const sp = species[i]; if (sp < SP_MISSING && spFamily[sp] === MISSING) spFamily[sp] = family[i]; }
      if (META.edible) for (let i = 0; i < META.edible.codes.length; i++) ediOf[i] = META.edible.codes.charCodeAt(i) - 48;

      let ymin = 9999, ymax = 0;
      for (let i = 0; i < N; i++) { const y = year[i]; if (y) { if (y < ymin) ymin = y; if (y > ymax) ymax = y; } }
      META.yearSpan = ymax ? ymin + '–' + ymax : '';

      setLoading('Préparation de la carte…', 75); await tick();
      mapDeptNames();
      buildMap();
      initSites();
      buildSidebar();
      initBrowser();
      initDrawer();
      initHelp();

      setLoading('Premier rendu…', 90); await tick();
      updateAll(true);
      setLoading('Prêt', 100);
      $('loading-overlay').classList.add('hidden');
      maybeShowHelp();
    } catch (err) {
      console.error(err);
      showError(String(err && err.message ? err.message : err));
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Département name matching (CSV codes/names <-> GeoJSON names / codes)
  // ═══════════════════════════════════════════════════════════════════════════
  function normName(s) { return String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]/g, ''); }
  function normCode(s) { const t = String(s).trim().toUpperCase(); return /^\d+$/.test(t) ? String(parseInt(t, 10)) : t; }

  function mapDeptNames() {
    const byName = new Map(), byCode = new Map();
    DICT.dept.forEach((name, i) => {
      byName.set(normName(name), i);
      if (/^(\d{1,2}|2[ab])$/i.test(String(name).trim())) byCode.set(normCode(name), i);
      const m = String(name).match(/\((\d{1,2}|2[ABab])\)/);
      if (m) byCode.set(normCode(m[1]), i);
    });
    const unmatched = [];
    featDept = DEPTS.features.map((f, fi) => {
      const nm = normName(f.properties.nom);
      let idx = byName.has(nm) ? byName.get(nm) : -1;
      if (idx < 0 && byCode.has(normCode(f.properties.code))) idx = byCode.get(normCode(f.properties.code));
      if (idx >= 0) deptFeat.set(idx, fi); else unmatched.push(f.properties.nom);
      return idx;
    });
    if (unmatched.length) console.warn('FongiMap: départements de la carte sans données :', unmatched);
  }
  const deptName = (di) => (deptFeat.has(di) ? DEPTS.features[deptFeat.get(di)].properties.nom : DICT.dept[di]);

  // ═══════════════════════════════════════════════════════════════════════════
  // Filter engine
  // ═══════════════════════════════════════════════════════════════════════════
  function tableFromSet(set, size) { const t = new Uint8Array(size); set.forEach((i) => { t[i] = 1; }); return t; }

  // one pass over all records -> failMask (0 = passes every active filter)
  function applyFilters() {
    const useSp = state.speciesSet.size > 0, usePh = state.phylumSet.size > 0, useGu = state.guildSet.size > 0;
    const useTr = state.trophicSet.size > 0, useEc = state.ecoregionSet.size > 0;
    const useYr = state.yearMin > 0, useMo = state.monthSet.size > 0, useDe = state.deptSet.size > 0;
    const useEd = state.edible > 0, useCo = state.commune >= 0, so = siteOf;
    const sOk = new Uint8Array(nSites);
    if (useCo) for (let k = 0; k < nSites; k++) if (siteCommune[k] === state.commune) sOk[k] = 1;
    const spT = tableFromSet(state.speciesSet, 65536), phT = tableFromSet(state.phylumSet, 256);
    const guT = tableFromSet(state.guildSet, 256), trT = tableFromSet(state.trophicSet, 256);
    const ecT = tableFromSet(state.ecoregionSet, 256), moT = tableFromSet(state.monthSet, 16);
    const deT = tableFromSet(state.deptSet, 256);
    const edT = new Uint8Array(8);
    if (state.edible === 1) { edT[1] = 1; edT[2] = 1; } else if (state.edible === 2) { edT[4] = 1; edT[5] = 1; }
    const y0 = state.yearMin, y1 = state.yearMax, ed = ediOf, fm = failMask;
    for (let i = 0; i < N; i++) {
      let f = 0;
      if (useSp && spT[species[i]] === 0) f |= F_SPECIES;
      if (usePh && phT[phylum[i]] === 0) f |= F_PHYLUM;
      if (useGu && guT[guild[i]] === 0) f |= F_GUILD;
      if (useTr && trT[trophic[i]] === 0) f |= F_TROPHIC;
      if (useEc && ecT[ecoregion[i]] === 0) f |= F_ECO;
      if (useYr) { const y = year[i]; if (y === 0 || y < y0 || y > y1) f |= F_YEAR; }
      if (useMo && moT[month[i]] === 0) f |= F_MONTH;
      if (useDe && deT[dept[i]] === 0) f |= F_DEPT;
      if (useEd && edT[ed[species[i]]] === 0) f |= F_EDIBLE;
      if (useCo) { const st = so[i]; if (st < 0 || sOk[st] === 0) f |= F_COMMUNE; }
      fm[i] = f;
    }
  }

  const agg = { total: 0, nSpecies: 0, nDepts: 0, gps: 0, bySpecies: new Uint32Array(65536), byDept: new Uint32Array(256) };
  const seenSp = new Uint8Array(65536), seenDe = new Uint8Array(256);

  // one pass over failMask -> header counts, per-species counts (species browser), per-département counts (map), per-site counts
  function aggregate() {
    agg.bySpecies.fill(0); agg.byDept.fill(0);
    seenSp.fill(0); seenDe.fill(0);
    siteTarget.fill(0);
    const bySp = agg.bySpecies, byDe = agg.byDept, sc = siteTarget, so = siteOf, fm = failMask;
    let total = 0, nSp = 0, gps = 0;
    for (let i = 0; i < N; i++) {
      const f = fm[i];
      if (f === 0) {
        total++;
        const s = species[i]; bySp[s]++;
        if (seenSp[s] === 0) { seenSp[s] = 1; nSp++; }
        const d = dept[i]; byDe[d]++; seenDe[d] = 1;
        const st = so[i]; if (st >= 0) { sc[st]++; gps++; }
      } else if (f === F_SPECIES) bySp[species[i]]++;      // fails only the species filter: the browser still lists it
      else if (f === F_DEPT) byDe[dept[i]]++;              // fails only the département filter: the map still shows it
    }
    if (seenSp[SP_MISSING]) nSp--;
    let nDe = 0;                               // count only départements drawn on the map
    for (let d = 0; d < 256; d++) if (seenDe[d] === 1 && deptFeat.has(d)) nDe++;
    agg.total = total; agg.nSpecies = nSp; agg.nDepts = nDe; agg.gps = gps;
    return agg;
  }

  // top-n indices of a counts array, optionally skipping one index (the "missing" code)
  function topN(counts, n, skip) {
    const idx = [];
    for (let i = 0; i < counts.length; i++) if (counts[i] > 0 && i !== skip) idx.push(i);
    idx.sort((a, b) => counts[b] - counts[a]);
    return idx.slice(0, n);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Update loop
  // ═══════════════════════════════════════════════════════════════════════════
  let updatePending = false;
  function scheduleUpdate() {
    if (updatePending) return;
    updatePending = true;
    setTimeout(() => { updatePending = false; updateAll(); }, 0);
  }

  // filters -> counts -> every panel
  function updateAll(first) {
    const t0 = performance.now();
    siteFrom.set(siteShown);                   // animate bubbles / cells from what is on screen now
    clearTimeout(previewTimer); previewing = false; $('preview-tag').classList.add('hidden');
    labelVer++;
    applyFilters();
    const t1 = performance.now();
    const a = aggregate();
    finishSites();
    const t2 = performance.now();
    lastAgg = a;
    tipCache.clear();
    updateStats(a);
    updateMap(a);
    renderBrowser(a);
    syncUI();
    startSiteAnim(first);
    const t3 = performance.now();
    perf.filter = t1 - t0; perf.aggregate = t2 - t1; perf.render = t3 - t2; perf.total = t3 - t0;
  }

  function tweenNumber(el, to) {
    const from = +el.dataset.v || 0; el.dataset.v = to;
    if (DUR === 0) { el.textContent = fmt(to); return; }
    d3.select(el).transition('num').duration(DUR).tween('text', () => { const i = d3.interpolateNumber(from, to); return (t) => { el.textContent = fmt(Math.round(i(t))); }; });
  }
  function updateStats(a) {
    tweenNumber($('n-filtered'), a.total); tweenNumber($('n-species'), a.nSpecies); tweenNumber($('n-depts'), a.nDepts);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Map: choropleth, zoom, layers, place names, tooltips
  // ═══════════════════════════════════════════════════════════════════════════
  let projection, pathGen, zoom, mapSvg, gZoom, gBase, deptG, deptPaths, landClip, deptByArea = [];
  let tf = d3.zoomIdentity;
  const base = { s: 1, ox: 0, oy: 0, w: 0, h: 0 };
  const tipCache = new Map();
  let featCount = [], featVal = [], deptArea = [], deptCentroid = [], layerMode = 'auto', legendKey = '';
  let metric = 'density', showApprox = true, legend = { title: '', note: '', cuts: [], labels: [], ramp: [] };
  let hover = null;                          // {type: 'site' | 'cluster' | 'cell' | 'dept', …} highlighted on the label canvas
  let clusters = [];                         // symbols drawn by the last drawSites() (screen coordinates)

  // choropleth measures. Raw counts mostly reflect département size and observer effort, so the default
  // is a density; richness (distinct species) and rarefied richness (species expected in RARE_N records,
  // Hurlbert) are less sensitive to how much each département has been surveyed.
  const METRICS = {
    density: { title: 'Observations par 100 km²', note: 'Reflète aussi le nombre d’observateurs.' },
    count: { title: 'Observations par département', note: 'Dépend de la taille du département.' },
    richness: { title: 'Espèces distinctes par département', note: 'Croît avec le nombre d’observations.' },
    rarefied: { title: 'Espèces attendues pour ' + RARE_N + ' observations', note: 'Comparable entre départements ; écarts souvent faibles.' },
  };

  function buildMap() {
    mapSvg = d3.select('#map-svg');
    gZoom = mapSvg.append('g');
    gBase = gZoom.append('g');
    // Lambert-93 (the official French projection): central meridian 3°E, standard parallels 44°N and 49°N
    projection = d3.geoConicConformal().rotate([-3, 0]).parallels([44, 49]).fitSize([VIRT, VIRT], DEPTS);
    pathGen = d3.geoPath(projection);
    deptArea = DEPTS.features.map((f) => d3.geoArea(f) * EARTH_R_KM * EARTH_R_KM);   // km², spherical
    deptCentroid = DEPTS.features.map((f) => pathGen.centroid(f));
    deptByArea = d3.range(DEPTS.features.length).sort((p, q) => deptArea[q] - deptArea[p]);
    landClip = new Path2D(); d3.geoPath(projection, landClip)(DEPTS);     // land area of France, used to mask the canvas layers

    deptG = gBase.append('g').attr('class', 'dept-layer');
    deptPaths = deptG.selectAll('path').data(DEPTS.features).join('path')
      .attr('class', 'dept-path').attr('d', pathGen).attr('fill', COL_ZERO)
      .on('click', (e, d) => {
        if (onMapClick(e)) return;
        const di = featDept[DEPTS.features.indexOf(d)];
        if (di >= 0) { toggleSet(state.deptSet, di); scheduleUpdate(); }
      })
      .on('dblclick', (e, d) => { e.preventDefault(); const b = pathGen.bounds(d); flyTo(b[0][0], b[0][1], b[1][0], b[1][1]); });
    gBase.append('g').selectAll('path').data(REGIONS.features).join('path').attr('class', 'region-path').attr('d', pathGen);
    initPlaces();

    zoom = d3.zoom().scaleExtent([1, 80]).on('zoom', (e) => {
      tf = e.transform;
      gZoom.attr('transform', tf);
      hideTip();
      requestDraw();
    });
    mapSvg.call(zoom).on('dblclick.zoom', null);
    mapSvg.on('mousemove', onMapMove).on('mouseleave', hideTip).on('click', (e) => { if (!(e.target.classList && e.target.classList.contains('dept-path'))) onMapClick(e); });
    $('btn-zoom-in').onclick = () => mapSvg.transition().duration(DUR || 1).call(zoom.scaleBy, 1.8);
    $('btn-zoom-out').onclick = () => mapSvg.transition().duration(DUR || 1).call(zoom.scaleBy, 1 / 1.8);
    $('btn-zoom-reset').onclick = () => mapSvg.transition().duration(DUR * 1.2 || 1).call(zoom.transform, d3.zoomIdentity);

    // options popover (secondary map controls, hidden by default: progressive disclosure)
    const pop = $('options-pop');
    $('btn-options').addEventListener('click', (e) => { e.stopPropagation(); pop.classList.toggle('hidden'); $('btn-options').classList.toggle('on', !pop.classList.contains('hidden')); });
    document.addEventListener('click', (e) => { if (!pop.classList.contains('hidden') && !e.target.closest('#options-wrap')) { pop.classList.add('hidden'); $('btn-options').classList.remove('on'); } });
    $('seg-layer').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) setLayerMode(b.dataset.v); });
    $('sel-metric').addEventListener('change', (e) => { metric = e.target.value; scheduleUpdate(); });
    $('chk-approx').addEventListener('change', (e) => { showApprox = e.target.checked; scheduleUpdate(); });

    // locator inset: France with the current viewport; click to recentre
    d3.select('#locator-map').attr('d', pathGen(REGIONS));
    $('locator').addEventListener('click', (e) => {
      const r = $('locator').getBoundingClientRect();
      const vx = (e.clientX - r.left) / r.width * VIRT, vy = (e.clientY - r.top) / r.height * VIRT;
      mapSvg.transition().duration(DUR || 1).call(zoom.translateTo, base.ox + base.s * vx, base.oy + base.s * vy);
    });
    new ResizeObserver(layoutMap).observe($('map-container'));
    layoutMap();
  }

  function setLayerMode(m) {
    layerMode = m;
    document.querySelectorAll('#seg-layer button').forEach((b) => b.classList.toggle('on', b.dataset.v === m));
    requestDraw();
  }

  // fit the virtual 1000x1000 map box into the container; size canvases
  function layoutMap() {
    const box = $('map-container').getBoundingClientRect();
    const w = Math.max(10, Math.round(box.width)), h = Math.max(10, Math.round(box.height));
    base.w = w; base.h = h;
    base.s = Math.min(w, h) / VIRT * 0.97;
    base.ox = (w - base.s * VIRT) / 2;
    base.oy = (h - base.s * VIRT) / 2;
    gBase.attr('transform', 'translate(' + base.ox + ',' + base.oy + ') scale(' + base.s + ')');
    zoom.extent([[0, 0], [w, h]]).translateExtent([[0, 0], [w, h]]);
    const dpr = window.devicePixelRatio || 1;
    ['grid-canvas', 'dot-canvas', 'label-canvas'].forEach((id) => {
      const c = $(id);
      c.width = Math.round(w * dpr); c.height = Math.round(h * dpr);
      c.getContext('2d').setTransform(dpr, 0, 0, dpr, 0, 0);
    });
    labelKey = '';
    requestDraw();
  }

  // restrict drawing to the land area of France (département polygons): nothing over the sea or abroad
  function clipToLand(ctx) {
    const dpr = window.devicePixelRatio || 1, k = tf.k, a = k * base.s * dpr;
    ctx.setTransform(a, 0, 0, a, (tf.x + k * base.ox) * dpr, (tf.y + k * base.oy) * dpr);
    ctx.clip(landClip);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  // département borders over the cells / places, so a cell is visibly cut where a border passes
  function strokeBorders(ctx, colour, px) {
    const dpr = window.devicePixelRatio || 1, k = tf.k, a = k * base.s;
    ctx.setTransform(a * dpr, 0, 0, a * dpr, (tf.x + k * base.ox) * dpr, (tf.y + k * base.oy) * dpr);
    ctx.lineWidth = px / a; ctx.strokeStyle = colour; ctx.lineJoin = 'round';
    ctx.stroke(landClip);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  // smooth fly-to a bounding box given in virtual map coordinates
  function flyTo(x0, y0, x1, y1) {
    const availW = $('map-container').classList.contains('drawer-open') ? Math.max(200, base.w - 340) : base.w;
    const bw = Math.max(1, (x1 - x0) * base.s), bh = Math.max(1, (y1 - y0) * base.s);
    const k = Math.max(1, Math.min(60, 0.78 * Math.min(availW / bw, base.h / bh)));
    const cx = base.ox + base.s * (x0 + x1) / 2, cy = base.oy + base.s * (y0 + y1) / 2;
    mapSvg.transition().duration(DUR * 1.4 || 1).ease(d3.easeCubicInOut)
      .call(zoom.transform, d3.zoomIdentity.translate(availW / 2 - k * cx, base.h / 2 - k * cy).scale(k));
  }
  // same, from a [x0, y0, x1, y1] box, never tighter than ~60 km so a single place stays readable
  function flyToBox(b, minHalf) {
    const m = minHalf || 30, cx = (b[0] + b[2]) / 2, cy = (b[1] + b[3]) / 2, hw = Math.max(m, (b[2] - b[0]) / 2 + 8), hh = Math.max(m, (b[3] - b[1]) / 2 + 8);
    flyTo(cx - hw, cy - hh, cx + hw, cy + hh);
  }

  // ── per-département species statistics (richness, rarefied richness) ─────────
  let deptSp = null;
  const deptRich = new Float32Array(256), deptRare = new Float32Array(256).fill(NaN);
  // species counts per département among records passing every filter except the département filter
  function computeRichness() {
    const L = DICT.species.length;
    if (!deptSp) deptSp = new Uint16Array(256 * L);
    deptSp.fill(0);
    const keep = ~F_DEPT;
    for (let i = 0; i < N; i++) {
      if ((failMask[i] & keep) !== 0) continue;
      const s = species[i], d = dept[i];
      if (s >= L || d === MISSING) continue;
      const k = d * L + s; if (deptSp[k] < 65535) deptSp[k]++;
    }
    deptRich.fill(0); deptRare.fill(NaN);
    deptFeat.forEach((fi, d) => {
      let tot = 0, rich = 0;
      const o = d * L;
      for (let s = 0; s < L; s++) { const c = deptSp[o + s]; if (c) { tot += c; rich++; } }
      deptRich[d] = rich;
      if (metric !== 'rarefied' || tot < RARE_N) return;
      // Hurlbert: E[S_n] = sum over species of 1 - C(tot - c, n) / C(tot, n)
      let e = 0;
      for (let s = 0; s < L; s++) {
        const c = deptSp[o + s]; if (!c) continue;
        if (tot - c < RARE_N) { e += 1; continue; }
        let pr = 1;
        for (let j = 0; j < RARE_N; j++) pr *= (tot - c - j) / (tot - j);
        e += 1 - pr;
      }
      deptRare[d] = e;
    });
  }

  const fmtVal = (v) => (v >= 100 ? fmt(Math.round(v)) : v >= 10 ? String(Math.round(v)) : v >= 1 ? String(Math.round(v * 10) / 10).replace('.', ',') : String(Math.round(v * 100) / 100).replace('.', ','));
  // round a class boundary to a readable value (1, 1.5, 2, 2.5, 3, 4, 5, 6, 8 × a power of ten)
  function niceCut(v) {
    if (!(v > 0)) return 0;
    const p = Math.pow(10, Math.floor(Math.log10(v))), m = v / p;
    const steps = [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10];
    let best = steps[0];
    for (const s of steps) if (Math.abs(Math.log(m / s)) < Math.abs(Math.log(m / best))) best = s;
    return Math.round(best * p * 100) / 100;
  }

  // recolour départements: 6 classes with rounded boundaries on the chosen measure (lightness ramp = relative quantity)
  function updateMap(a) {
    featCount = DEPTS.features.map((_, fi) => (featDept[fi] >= 0 ? a.byDept[featDept[fi]] : 0));
    if (metric === 'richness' || metric === 'rarefied') computeRichness();
    featVal = DEPTS.features.map((_, fi) => {
      const d = featDept[fi]; if (d < 0) return null;
      if (metric === 'count') return featCount[fi] || null;
      if (metric === 'density') return featCount[fi] ? featCount[fi] / (deptArea[fi] / 100) : null;
      if (metric === 'richness') return deptRich[d] || null;
      return deptRare[d] === deptRare[d] ? deptRare[d] : null;       // NaN -> insufficient data
    });
    const vals = featVal.filter((v) => v !== null && v > 0);
    const raw = d3.scaleQuantile().domain(vals.length ? vals : [0]).range(d3.range(6)).quantiles();
    const dedupe = (arr) => { const o = []; arr.forEach((c) => { if (c > 0 && (!o.length || c > o[o.length - 1])) o.push(c); }); return o; };
    let cuts = dedupe(raw.map(niceCut));
    if (cuts.length < 4) cuts = dedupe(raw.map((v) => (v < 10 ? Math.round(v * 10) / 10 : Math.round(v))));   // narrow range: finer rounding
    const nRamp = cuts.length + 1;
    const ramp = d3.quantize((t) => d3.interpolateYlGn(0.2 + 0.78 * t), Math.max(2, nRamp)).slice(0, nRamp);
    const scale = d3.scaleThreshold().domain(cuts).range(ramp);
    const labels = ramp.map((_, i) => (i === 0 ? 'moins de ' + fmtVal(cuts[0] === undefined ? 0 : cuts[0]) : i === cuts.length ? fmtVal(cuts[i - 1]) + ' et plus' : fmtVal(cuts[i - 1]) + ' – ' + fmtVal(cuts[i])));
    legend = { title: METRICS[metric].title, note: METRICS[metric].note, cuts, ramp, labels };
    const anySel = state.deptSet.size > 0;
    deptPaths
      .attr('fill', (d, fi) => (featVal[fi] === null ? COL_ZERO : scale(featVal[fi])))
      .classed('selected', (d, fi) => anySel && state.deptSet.has(featDept[fi]))
      .classed('dim', (d, fi) => anySel && !state.deptSet.has(featDept[fi]));
    if (anySel) deptPaths.filter('.selected').raise();
    legendKey = '';                              // force legend refresh
    requestDraw();
  }

  // ── semantic zoom: how visible each layer is ─────────────────────────────
  function layerAlphas() {
    const k = tf.k;
    switch (layerMode) {
      case 'dept': return { gridA: 0, dotA: 0 };
      case 'grid': return { gridA: 1, dotA: 0 };
      case 'sites': return { gridA: 0, dotA: 1 };
      default: return { gridA: smooth(1.7, 2.8, k), dotA: smooth(5.2, 6.4, k) };
    }
  }

  // one legend at a time: the layer that dominates the current view
  function renderLegend(al) {
    const kind = al.dotA > 0.5 ? 'sites' : al.gridA > 0.5 ? 'grid' : 'dept';
    const hint = layerMode === 'auto' && kind === 'dept' && tf.k < 2.4;
    const key = [kind, showApprox, hint, legend.title, legend.cuts.join(',')].join('|');
    if (key === legendKey) return;
    legendKey = key;
    const row = (swatch, label) => '<li>' + swatch + '<span>' + label + '</span></li>';
    let html;
    if (kind === 'dept') {
      html = '<h5>' + esc(legend.title) + '</h5><ul>' + legend.ramp.map((c, i) => row('<i class="sw" style="background:' + c + '"></i>', legend.labels[i])).join('') +
        row('<i class="sw" style="background:' + COL_ZERO + '"></i>', 'aucune observation') + '</ul>' +
        '<p class="legend-note">' + esc(legend.note) + (hint ? ' Zoomez : des hexagones puis des lieux apparaissent.' : '') + '</p>';
    } else if (kind === 'grid') {
      html = '<h5>Observations par hexagone</h5><p class="legend-note top">Chaque hexagone mesure 10 km de large (≈ 87 km²) : plus il est foncé, plus il y a eu d’observations.</p><ul>' +
        CELL_LABELS.map((l, i) => row('<i class="sw" style="background:' + cellColour(i) + '"></i>', l)).join('') + '</ul>';
    } else {
      html = '<h5>Observations par lieu</h5><ul class="circles">' +
        SYM_RADII.map((rr, i) => row('<i class="circ" style="width:' + Math.round(2 * rr) + 'px;height:' + Math.round(2 * rr) + 'px"></i>', SYM_LABELS[i])).join('') + '</ul>' +
        '<ul class="kinds">' + row('<i class="circ exact"></i>', 'position GPS') +
        (showApprox ? row('<i class="circ approx"></i>', 'centre de commune (approximatif)') : '') +
        row('<i class="circ exact group"></i>', 'plusieurs lieux proches regroupés') + '</ul>';
    }
    $('map-legend').innerHTML = html;
    $('map-legend').classList.remove('swap'); void $('map-legend').offsetWidth; $('map-legend').classList.add('swap');
  }

  // ── GPS sites and 10 km grid cells ───────────────────────────────────────
  let nCells = 0, cellPX = null, cellPY = null, siteCell = null, cellW = null, cellTarget = null, cellTree = null, cellSize = 10;
  let siteLoc = [];
  function initSites() {
    const S = META.sites || { lon: [], lat: [], loc: [], names: [''] };
    nSites = S.lon.length; siteName = S.names;
    const lonK = (META.lon_max - META.lon_min) / Q_MAX, latK = (META.lat_max - META.lat_min) / Q_MAX;
    sitePX = new Float32Array(nSites); sitePY = new Float32Array(nSites);
    const key2site = new Map();
    for (let k = 0; k < nSites; k++) {
      const p = projection([META.lon_min + S.lon[k] * lonK, META.lat_min + S.lat[k] * latK]) || [NaN, NaN];
      sitePX[k] = p[0]; sitePY[k] = p[1];
      key2site.set(S.lon[k] * 65536 + S.lat[k], k);
    }
    siteOf = new Int32Array(N).fill(-1);
    for (let i = 0; i < N; i++) {
      if (lonQ[i] === COORD_MISSING) continue;
      const k = key2site.get(lonQ[i] * 65536 + latQ[i]);
      if (k !== undefined) siteOf[i] = k;
    }
    siteTarget = new Uint32Array(nSites); siteFrom = new Float32Array(nSites); siteShown = new Float32Array(nSites);
    COM = META.communes || COM; siteCommune = Int32Array.from(S.commune || new Array(nSites).fill(-1));
    siteLoc = S.loc; siteApprox = S.approx || new Array(nSites).fill(0);

    // 10 km hexagons (equal area) in Lambert-93, corners computed by build.py
    const C = META.cells || { q: [], r: [], corners: [] };
    nCells = C.q.length; siteCell = Int32Array.from(S.cell || new Array(nSites).fill(0));
    cellPX = new Float32Array(nCells * 6); cellPY = new Float32Array(nCells * 6);
    cellW = new Float32Array(nCells); cellTarget = new Float32Array(nCells);
    const cx = new Float32Array(nCells), cy = new Float32Array(nCells);
    for (let c = 0; c < nCells; c++) {
      for (let v = 0; v < 6; v++) {
        const p = projection([C.corners[c * 12 + v * 2], C.corners[c * 12 + v * 2 + 1]]);
        cellPX[c * 6 + v] = p[0]; cellPY[c * 6 + v] = p[1]; cx[c] += p[0] / 6; cy[c] += p[1] / 6;
      }
    }
    if (nCells) cellSize = Math.hypot(cellPX[0] - cellPX[1], cellPY[0] - cellPY[1]);
    cellTree = d3.quadtree().x((c) => cx[c]).y((c) => cy[c]).addAll(d3.range(nCells));
  }

  // after counting: drop approximate sites if asked, then sum sites into their grid cell
  function finishSites() {
    if (!showApprox) for (let k = 0; k < nSites; k++) if (siteApprox[k]) siteTarget[k] = 0;
    cellTarget.fill(0);
    for (let k = 0; k < nSites; k++) cellTarget[siteCell[k]] += siteTarget[k];
  }

  // graduated symbols (classed sizes, explicit legend) instead of a continuous radius
  const symZoom = (k) => 0.9 + 0.04 * Math.log2(k);
  const siteR = (w, zf) => SYM_RADII[symClass(w)] * zf;

  let animRaf = 0, animStart = 0;
  function startSiteAnim(first) {
    if (DUR === 0 || first) { for (let k = 0; k < nSites; k++) siteShown[k] = siteTarget[k]; requestDraw(); return; }
    animStart = performance.now();
    if (!animRaf) animRaf = requestAnimationFrame(animStep);
  }
  function animStep(now) {
    const t = Math.min(1, (now - animStart) / DUR), e = EASE(t);
    for (let k = 0; k < nSites; k++) siteShown[k] = siteFrom[k] + (siteTarget[k] - siteFrom[k]) * e;
    drawLayers();
    animRaf = t < 1 ? requestAnimationFrame(animStep) : 0;
  }

  let drawQueued = false;
  function requestDraw() {
    if (drawQueued) return;
    drawQueued = true;
    requestAnimationFrame(() => { drawQueued = false; drawLayers(); });
  }

  const cellColour = (i) => d3.interpolateYlOrBr(0.16 + 0.72 * i / 4);

  // draw dept fade, grid cells, sites, place names, scale bar and locator for the current zoom / mode
  function drawLayers() {
    if (!siteShown) return;
    const al = layerAlphas();
    deptG.style('opacity', 1 - 0.7 * Math.max(al.gridA, al.dotA));     // the choropleth recedes once finer layers take over
    const gridVis = al.gridA * (1 - al.dotA);
    $('grid-canvas').style.opacity = gridVis.toFixed(3);
    $('dot-canvas').style.opacity = al.dotA.toFixed(3);
    if (gridVis > 0.01) drawGrid();
    if (al.dotA > 0.01) drawSites(); else clusters = [];
    renderLegend(al);
    updateScale(); updateLocator();
    layoutLabels(al); paintLabels();
  }

  // amber graduated symbols; places closer than CLUSTER_PX on screen are grouped (cluster, don't remove)
  function drawSites() {
    const ctx = $('dot-canvas').getContext('2d');
    ctx.clearRect(0, 0, base.w, base.h);
    const k = tf.k, a = k * base.s, bx = tf.x + k * base.ox, by = tf.y + k * base.oy, zf = symZoom(k);
    const cols = Math.ceil((base.w + 40) / CLUSTER_PX) + 2, grid = new Map(), out = [];
    for (let s = 0; s < nSites; s++) {
      const w = siteShown[s];
      if (w < 0.5) continue;
      const x = bx + a * sitePX[s], y = by + a * sitePY[s];
      if (x < -20 || y < -20 || x > base.w + 20 || y > base.h + 20) continue;
      const key = (((y + 20) / CLUSTER_PX) | 0) * cols + (((x + 20) / CLUSTER_PX) | 0);
      let c = grid.get(key);
      if (c === undefined) { c = { x, y, sx: x * w, sy: y * w, W: w, n: 1, s, ap: siteApprox[s] ? w : 0, m: null }; grid.set(key, c); out.push(c); }
      else { c.sx += x * w; c.sy += y * w; c.W += w; c.n++; if (siteApprox[s]) c.ap += w; if (!c.m) c.m = [c.s]; c.m.push(s); }
    }
    for (const c of out) { if (c.n > 1) { c.x = c.sx / c.W; c.y = c.sy / c.W; } c.r = siteR(c.W, zf); }
    out.sort((p, q) => q.W - p.W);              // big first: small symbols end up on top
    ctx.save(); clipToLand(ctx);
    strokeBorders(ctx, 'rgba(60,52,38,.4)', 0.9);
    for (const c of out) {
      const approx = c.ap >= 0.5 * c.W;
      ctx.beginPath(); ctx.arc(c.x, c.y, c.r, 0, 6.2832);
      ctx.fillStyle = approx ? 'rgba(214,134,26,.28)' : 'rgba(214,134,26,.84)'; ctx.fill();
      ctx.strokeStyle = approx ? 'rgba(150,88,12,.75)' : '#5c3406'; ctx.lineWidth = c.n > 1 ? 2 : 1; ctx.stroke();
    }
    ctx.restore();
    clusters = out;
  }

  // 10 km hexagons in 5 lightness classes of the number of observations, with département borders on top
  function drawGrid() {
    const ctx = $('grid-canvas').getContext('2d');
    ctx.clearRect(0, 0, base.w, base.h);
    const k = tf.k, a = k * base.s, bx = tf.x + k * base.ox, by = tf.y + k * base.oy;
    cellW.fill(0);
    for (let s = 0; s < nSites; s++) cellW[siteCell[s]] += siteShown[s];
    const paths = CELL_LABELS.map(() => new Path2D());
    for (let c = 0; c < nCells; c++) {
      const w = cellW[c];
      if (w < 0.5) continue;
      const o = c * 6, x0 = bx + a * cellPX[o], y0 = by + a * cellPY[o];
      if (x0 < -80 || y0 < -80 || x0 > base.w + 80 || y0 > base.h + 80) continue;
      const p = paths[cellClass(w)];
      p.moveTo(x0, y0);
      for (let v = 1; v < 6; v++) p.lineTo(bx + a * cellPX[o + v], by + a * cellPY[o + v]);
      p.closePath();
    }
    ctx.save(); clipToLand(ctx);
    ctx.globalAlpha = 0.92; ctx.lineWidth = 0.6;
    paths.forEach((p, l) => { const col = cellColour(l); ctx.fillStyle = col; ctx.strokeStyle = col; ctx.fill(p); ctx.stroke(p); });
    ctx.globalAlpha = 1;
    strokeBorders(ctx, 'rgba(45,38,26,.75)', 1.3);
    ctx.restore();
  }

  // ── place names (toponyms) with level of detail and collision handling ───────
  // regions -> big towns -> département names -> smaller towns -> biggest places, by zoom; no two labels overlap.
  let places = { n: 0, name: [], pop: null, x: null, y: null, commune: [] };
  let regionLabels = [], labelItems = [], labelKey = '', labelVer = 0;
  // context names so the user can tell where the map is: sea and neighbouring countries (name, lon, lat, kind)
  const CONTEXT_NAMES = [
    ['Océan Atlantique', -3.9, 45.4, 'sea'], ['Manche', -1.6, 50.2, 'sea'], ['Mer Méditerranée', 5.4, 42.55, 'sea'],
    ['BELGIQUE', 4.7, 50.62, 'land'], ['ALLEMAGNE', 8.5, 49.05, 'land'], ['SUISSE', 7.4, 46.75, 'land'],
    ['ITALIE', 7.9, 44.55, 'land'], ['ESPAGNE', 0.2, 42.15, 'land'],
  ];
  let contextXY = [];
  function initPlaces() {
    const P = META.places;
    if (P && P.names.length) {
      const n = P.names.length, px = new Float32Array(n), py = new Float32Array(n);
      for (let i = 0; i < n; i++) { const p = projection([P.lon[i], P.lat[i]]); px[i] = p[0]; py[i] = p[1]; }
      places = { n, name: P.names, pop: P.pop, x: px, y: py, commune: P.commune || [] };
    }
    regionLabels = REGIONS.features.map((f) => {
      const polys = f.geometry.type === 'MultiPolygon' ? f.geometry.coordinates : [f.geometry.coordinates];
      let best = polys[0], ba = -1;
      polys.forEach((c) => { const ar = d3.geoArea({ type: 'Polygon', coordinates: c }); if (ar > ba) { ba = ar; best = c; } });
      const c = pathGen.centroid({ type: 'Polygon', coordinates: best });
      return { text: f.properties.nom.toUpperCase(), x: c[0], y: c[1] };
    });
    contextXY = CONTEXT_NAMES.map((c) => { const p = projection([c[1], c[2]]); return { text: c[0], x: p[0], y: p[1], kind: c[3] }; });
  }

  const textWidths = new Map();
  function textW(ctx, font, text) {
    const key = font + '|' + text;
    let w = textWidths.get(key);
    if (w === undefined) { ctx.font = font; w = ctx.measureText(text).width; textWidths.set(key, w); }
    return w;
  }
  const FONT = { region: '700 11px system-ui, sans-serif', dept: '600 10px system-ui, sans-serif', townBig: '700 12px system-ui, sans-serif', town: '500 10.5px system-ui, sans-serif', site: 'italic 600 10px system-ui, sans-serif', sea: 'italic 11px system-ui, sans-serif', land: '600 10px system-ui, sans-serif' };

  // choose which labels fit: greedy by priority, rejecting any that overlaps one already placed
  function layoutLabels(al) {
    const k = tf.k, a = k * base.s, bx = tf.x + k * base.ox, by = tf.y + k * base.oy;
    const key = [tf.x.toFixed(1), tf.y.toFixed(1), k.toFixed(3), base.w, base.h, labelVer, al.dotA > 0.5 ? 1 : 0, [...state.deptSet].join(','), state.commune].join('|');
    if (key === labelKey) return;
    labelKey = key;
    const ctx = $('label-canvas').getContext('2d'), W = base.w, H = base.h;
    const boxes = [], items = [], used = new Set();
    const fits = (x0, y0, x1, y1) => { for (let i = 0; i < boxes.length; i++) { const b = boxes[i]; if (x0 < b[2] + 3 && x1 > b[0] - 3 && y0 < b[3] + 2 && y1 > b[1] - 2) return false; } return true; };
    const inView = (x, y) => x > 4 && y > 4 && x < W - 4 && y < H - 4;
    const put = (kind, text, x, y, opt) => {
      const w = textW(ctx, FONT[kind], text) + (kind === 'region' ? text.length * 1.2 : 0), h = 12;
      const dot = kind === 'town' || kind === 'townBig', lk = text.toLowerCase();
      if (kind === 'site' && used.has(lk)) return false;      // a place already named as a town is not named twice
      const x0 = dot ? x + 5 : x - w / 2, y0 = y - h / 2;
      if (!inView(x, y) || !fits(x0 - (dot ? 8 : 0), y0, x0 + w, y0 + h)) return false;
      used.add(lk);
      boxes.push([x0 - (dot ? 8 : 0), y0, x0 + w, y0 + h]);
      items.push({ kind, text, x: dot ? x0 : x, y, dot: dot ? [x, y] : null, box: boxes[boxes.length - 1], commune: opt && opt.commune !== undefined ? opt.commune : -1 });
      return true;
    };
    // 0. selected départements, always labelled
    state.deptSet.forEach((di) => {
      const fi = deptFeat.get(di); if (fi === undefined) return;
      put('region', deptName(di).toUpperCase(), bx + a * deptCentroid[fi][0], by + a * deptCentroid[fi][1]);
    });
    if (state.commune >= 0) {                  // the chosen commune is always named
      const p = projection([COM.lon[state.commune], COM.lat[state.commune]]);
      put('region', COM.names[state.commune].toUpperCase(), bx + a * p[0], by + a * p[1] - 14);
    }
    // 1. regions while the whole country is in view
    if (k < 3.2) regionLabels.forEach((r) => put('region', r.text, bx + a * r.x, by + a * r.y));
    // 2. major towns
    const popMin = 1.6e6 * Math.pow(k, -2), townPass = (big) => {
      for (let i = 0; i < places.n; i++) {
        const p = places.pop[i];
        if (p < popMin) break;
        if ((p >= 200000) !== big) continue;
        const x = bx + a * places.x[i], y = by + a * places.y[i];
        if (inView(x, y)) put(big ? 'townBig' : 'town', places.name[i], x, y, { commune: places.commune[i] === undefined ? -1 : places.commune[i] });
      }
    };
    if (k >= 2.2) townPass(true);
    // 3. département names
    if (k >= 2.8 && k < 14) deptByArea.forEach((fi) => { if (featDept[fi] >= 0) put('dept', DEPTS.features[fi].properties.nom, bx + a * deptCentroid[fi][0], by + a * deptCentroid[fi][1]); });
    // 4. smaller towns
    if (k >= 2.2) townPass(false);
    // 5. biggest places by name at high zoom
    if (al.dotA > 0.5 && k >= 9) {
      clusters.filter((c) => c.n === 1 && c.W >= 100).sort((p, q) => q.W - p.W).slice(0, 80).forEach((c) => {
        const nm = siteName[siteLoc[c.s]]; if (nm) put('site', nm, c.x, c.y - c.r - 7);
      });
    }
    // 6. sea and neighbouring countries (context)
    if (k < 4) contextXY.forEach((c) => put(c.kind, c.text, bx + a * c.x, by + a * c.y));
    labelItems = items;
  }

  // draw the chosen labels (white halo for legibility) and the hover highlight
  function paintLabels() {
    const ctx = $('label-canvas').getContext('2d');
    ctx.clearRect(0, 0, base.w, base.h);
    ctx.lineJoin = 'round'; ctx.textBaseline = 'middle';
    const colour = { region: '#33402d', dept: '#4a3f2c', townBig: '#1f1a12', town: '#2b2217', site: '#6b3d08', sea: '#5f7d92', land: '#79858c' };
    for (const it of labelItems) {
      ctx.font = FONT[it.kind];
      if ('letterSpacing' in ctx) ctx.letterSpacing = it.kind === 'region' ? '1.2px' : '0px';
      ctx.textAlign = it.dot ? 'left' : 'center';
      const halo = it.kind === 'sea' || it.kind === 'land' ? 'rgba(255,255,255,.55)' : 'rgba(255,255,255,.92)';
      ctx.lineWidth = 3.2; ctx.strokeStyle = halo; ctx.strokeText(it.text, it.x, it.y);
      ctx.fillStyle = colour[it.kind]; ctx.fillText(it.text, it.x, it.y);
      if (it.dot) {
        ctx.beginPath(); ctx.arc(it.dot[0], it.dot[1], it.kind === 'townBig' ? 3.2 : 2.4, 0, 6.2832);
        ctx.fillStyle = '#2b2217'; ctx.fill(); ctx.lineWidth = 1.2; ctx.strokeStyle = '#fff'; ctx.stroke();
      }
    }
    if ('letterSpacing' in ctx) ctx.letterSpacing = '0px';
    if (!hover) return;
    ctx.lineWidth = 2.4; ctx.strokeStyle = '#111';
    if (hover.type === 'site' || hover.type === 'cluster') { ctx.beginPath(); ctx.arc(hover.x, hover.y, hover.r + 2.5, 0, 6.2832); ctx.stroke(); }
    else if (hover.type === 'cell') {
      const k = tf.k, a = k * base.s, bx = tf.x + k * base.ox, by = tf.y + k * base.oy, o = hover.c * 6;
      ctx.beginPath(); ctx.moveTo(bx + a * cellPX[o], by + a * cellPY[o]);
      for (let v = 1; v < 6; v++) ctx.lineTo(bx + a * cellPX[o + v], by + a * cellPY[o + v]);
      ctx.closePath(); ctx.stroke();
    } else if (hover.type === 'dept') {
      const k = tf.k, a = k * base.s, bx = tf.x + k * base.ox, by = tf.y + k * base.oy, c = deptCentroid[hover.fi];
      ctx.font = '700 13px system-ui, sans-serif'; ctx.textAlign = 'center';
      ctx.lineWidth = 4; ctx.strokeStyle = 'rgba(255,255,255,.95)'; ctx.strokeText(DEPTS.features[hover.fi].properties.nom, bx + a * c[0], by + a * c[1]);
      ctx.fillStyle = '#111'; ctx.fillText(DEPTS.features[hover.fi].properties.nom, bx + a * c[0], by + a * c[1]);
    }
  }
  function setHover(h) {
    const same = (!h && !hover) || (h && hover && h.type === hover.type && h.id === hover.id);
    if (same) return;
    hover = h; paintLabels();
  }

  // ── scale bar and locator inset ───────────────────────────────────────────
  function updateScale() {
    const k = tf.k, a = k * base.s, bx = tf.x + k * base.ox, by = tf.y + k * base.oy;
    const cx = base.w / 2, cy = base.h / 2;
    const p0 = projection.invert([(cx - 50 - bx) / a, (cy - by) / a]), p1 = projection.invert([(cx + 50 - bx) / a, (cy - by) / a]);
    if (!p0 || !p1) return;
    const R = EARTH_R_KM, rad = Math.PI / 180, dLat = (p1[1] - p0[1]) * rad, dLon = (p1[0] - p0[0]) * rad;
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(p0[1] * rad) * Math.cos(p1[1] * rad) * Math.sin(dLon / 2) ** 2;
    const kmPer100px = 2 * R * Math.asin(Math.sqrt(h)), kmPx = kmPer100px / 100;
    let km = 1;
    for (const c of [0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 50, 100, 200, 500]) if (c / kmPx <= 110) km = c;
    $('scale-line').style.width = Math.round(km / kmPx) + 'px';
    const txt = (km < 1 ? km * 1000 + ' m' : km + ' km');
    if ($('scale-label').textContent !== txt) $('scale-label').textContent = txt;
  }
  function updateLocator() {
    const k = tf.k, a = k * base.s, bx = tf.x + k * base.ox, by = tf.y + k * base.oy;
    const x0 = Math.max(0, (0 - bx) / a), y0 = Math.max(0, (0 - by) / a), x1 = Math.min(VIRT, (base.w - bx) / a), y1 = Math.min(VIRT, (base.h - by) / a);
    d3.select('#locator-rect').attr('x', x0).attr('y', y0).attr('width', Math.max(8, x1 - x0)).attr('height', Math.max(8, y1 - y0));
    $('locator').classList.toggle('shown', k > 1.35);
  }

  // ── commune filter: click a town name or a place symbol ─────────────────────
  const communeLabel = (ci) => COM.names[ci] + ' (' + COM.dep[ci] + ')';
  function labelAt(mx, my) {
    for (const it of labelItems) if (it.commune >= 0 && mx >= it.box[0] && mx <= it.box[2] && my >= it.box[1] && my <= it.box[3]) return it.commune;
    return -1;
  }
  // click on the map: a town label or a single place filters on its commune, a group of places zooms in
  function onMapClick(e) {
    const box = $('map-container').getBoundingClientRect(), mx = e.clientX - box.left, my = e.clientY - box.top;
    const lc = labelAt(mx, my);
    if (lc >= 0) { pickCommune(lc); return true; }
    if (layerAlphas().dotA > 0.35) {
      let best = null;
      for (const c of clusters) { const r = c.r + 3; if ((c.x - mx) ** 2 + (c.y - my) ** 2 < r * r) best = c; }
      if (best) {
        if (best.n === 1 && siteCommune[best.s] >= 0) pickCommune(siteCommune[best.s]);
        else mapSvg.transition().duration(DUR || 1).call(zoom.scaleBy, 2.2, [best.x, best.y]);
        return true;
      }
    }
    return false;
  }
  // choose a commune (again = clear): filter on it and fly to its places
  function pickCommune(ci) {
    if (ci < 0) return;
    if (state.commune === ci) state.commune = -1;
    else {
      state.commune = ci;
      let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
      for (let k = 0; k < nSites; k++) if (siteCommune[k] === ci) { x0 = Math.min(x0, sitePX[k]); x1 = Math.max(x1, sitePX[k]); y0 = Math.min(y0, sitePY[k]); y1 = Math.max(y1, sitePY[k]); }
      const p = projection([COM.lon[ci], COM.lat[ci]]);
      flyToBox([Math.min(x0, p[0]), Math.min(y0, p[1]), Math.max(x1, p[0]), Math.max(y1, p[1])], 4);
    }
    scheduleUpdate();
  }

  // ── tooltips (département, place / group of places, or grid cell) ─────────
  function onMapMove(e) {
    const box = $('map-container').getBoundingClientRect();
    const mx = e.clientX - box.left, my = e.clientY - box.top;
    const al = layerAlphas();
    const k = tf.k, a = k * base.s, bx = tf.x + k * base.ox, by = tf.y + k * base.oy;
    const vx = (mx - bx) / a, vy = (my - by) / a;
    $('map-svg').style.cursor = labelAt(mx, my) >= 0 ? 'pointer' : '';
    if (al.dotA > 0.35 && clusters.length) {
      let best = null;
      for (const c of clusters) { const r = c.r + 3; if ((c.x - mx) ** 2 + (c.y - my) ** 2 < r * r) best = c; }   // drawn big -> small: the last hit is on top
      if (best) {
        $('map-svg').style.cursor = 'pointer';
        setHover({ type: best.n > 1 ? 'cluster' : 'site', id: best.s + '_' + best.n, x: best.x, y: best.y, r: best.r });
        if (best.n > 1) showClusterTip(best, mx, my); else showSiteTip(best.s, mx, my);
        return;
      }
    }
    if (al.gridA > 0.35 && al.dotA < 0.35 && cellTree) {
      const c = cellTree.find(vx, vy, cellSize);
      if (c !== undefined && cellTarget[c] >= 1) {
        const o = c * 6, poly = [0, 1, 2, 3, 4, 5].map((v) => [cellPX[o + v], cellPY[o + v]]);
        if (d3.polygonContains(poly, [vx, vy])) { setHover({ type: 'cell', id: c, c }); showCellTip(c, mx, my); return; }
      }
    }
    const t = e.target;
    if (t && t.classList && t.classList.contains('dept-path')) {
      const d = d3.select(t).datum(), fi = DEPTS.features.indexOf(d);
      setHover({ type: 'dept', id: fi, fi }); showDeptTip(d, mx, my);
    } else hideTip();
  }

  function placeTip(mx, my) {
    const tip = $('map-tooltip'), cw = base.w, ch = base.h, tw = tip.offsetWidth, th = tip.offsetHeight;
    const left = mx + 16 + tw > cw ? mx - 16 - tw : mx + 16;
    const top = Math.max(4, Math.min(ch - th - 4, my - th / 2));
    tip.style.transform = 'translate(' + Math.max(4, left) + 'px,' + top + 'px)';
    tip.classList.remove('hidden');
  }
  function hideTip() { $('map-tooltip').classList.add('hidden'); setHover(null); }
  const dotHtml = (code) => '<i class="dot" style="background:' + EDI[code].colour + '"></i>';

  // top species and number of distinct species among the records passing all filters except the `ignore` bits
  function topSpeciesWhere(ignore, fn, n) {
    const spc = new Map(), keep = ~ignore;
    for (let i = 0; i < N; i++) {
      if ((failMask[i] & keep) !== 0 || !fn(i)) continue;
      const s = species[i]; spc.set(s, (spc.get(s) || 0) + 1);
    }
    const all = [...spc.entries()].filter((e) => e[0] !== SP_MISSING);
    return { top: all.sort((a, b) => b[1] - a[1]).slice(0, n), distinct: all.length };
  }
  function listHtml(top) { return top.map((t) => dotHtml(ediOf[t[0]]) + '<em>' + esc(DICT.species[t[0]]) + '</em> ' + fmt(t[1])).join('<br>'); }

  function showDeptTip(d, mx, my) {
    const fi = DEPTS.features.indexOf(d), di = featDept[fi];
    let html = '<strong>' + esc(d.properties.nom) + '</strong> <span class="muted">(' + esc(d.properties.code) + ') · ' + fmt(Math.round(deptArea[fi])) + ' km²</span><br>';
    if (di < 0) html += '<span class="muted">Aucune donnée</span>';
    else {
      const c = featCount[fi];
      let tot = 0; for (let k = 0; k < agg.byDept.length; k++) tot += agg.byDept[k];
      if (c === 0) html += 'Aucune observation';
      else {
        const key = 'd' + di;
        if (!tipCache.has(key)) {
          const gc = new Uint32Array(256);
          const r = topSpeciesWhere(F_DEPT, (i) => { if (dept[i] !== di) return false; gc[guild[i]]++; return true; }, 3);
          let gB = -1, gM = 0; for (let g = 0; g < 255; g++) if (gc[g] > gM) { gM = gc[g]; gB = g; }
          tipCache.set(key, { top: r.top, distinct: r.distinct, guild: gB >= 0 ? DICT.guild[gB] : null });
        }
        const det = tipCache.get(key);
        html += fmt(c) + ' observations <span class="muted">(' + (100 * c / tot).toFixed(1).replace('.', ',') + ' % · ' + fmtVal(c / (deptArea[fi] / 100)) + ' / 100 km²)</span><br>' +
          fmt(det.distinct) + ' espèces distinctes<br>' + listHtml(det.top);
        if (det.guild) html += '<br><span class="muted">Guilde dominante :</span> ' + esc(det.guild);
        html += '<br><span class="muted">Clic : filtrer · double-clic : zoomer</span>';
      }
    }
    $('map-tooltip').innerHTML = html;
    placeTip(mx, my);
  }

  function showSiteTip(s, mx, my) {
    const key = 's' + s;
    if (!tipCache.has(key)) tipCache.set(key, topSpeciesWhere(0, (i) => siteOf[i] === s, 3));
    const name = siteName[siteLoc[s]] || 'Lieu sans nom', r = tipCache.get(key);
    $('map-tooltip').innerHTML = '<strong>' + esc(name) + '</strong><br>' + fmt(siteTarget[s]) + ' observations · ' + fmt(r.distinct) + ' espèces' +
      (siteApprox[s] ? '<br><span class="muted">position approximative (centre de commune)</span>' : '') + '<br>' + listHtml(r.top) +
      (siteCommune[s] >= 0 ? '<br><span class="muted">Clic : filtrer sur ' + esc(communeLabel(siteCommune[s])) + '</span>' : '');
    placeTip(mx, my);
  }

  function showClusterTip(c, mx, my) {
    const key = 'g' + c.s + '_' + c.n;
    if (!tipCache.has(key)) { const set = new Set(c.m); tipCache.set(key, topSpeciesWhere(0, (i) => set.has(siteOf[i]), 3)); }
    const r = tipCache.get(key);
    $('map-tooltip').innerHTML = '<strong>' + fmt(c.n) + ' lieux regroupés</strong><br>' + fmt(Math.round(c.W)) + ' observations · ' + fmt(r.distinct) + ' espèces<br>' + listHtml(r.top) +
      '<br><span class="muted">Clic : zoomer pour les séparer</span>';
    placeTip(mx, my);
  }

  function showCellTip(c, mx, my) {
    const key = 'c' + c;
    if (!tipCache.has(key)) tipCache.set(key, topSpeciesWhere(0, (i) => { const s = siteOf[i]; return s >= 0 && siteCell[s] === c && (showApprox || !siteApprox[s]); }, 3));
    const r = tipCache.get(key);
    $('map-tooltip').innerHTML = '<strong>Hexagone de 10 km</strong> <span class="muted">(≈ 87 km²)</span><br>' +
      fmt(cellTarget[c]) + ' observations · ' + fmt(r.distinct) + ' espèces<br>' + listHtml(r.top);
    placeTip(mx, my);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Sidebar: species browser (tab 1) and filters (tab 2)
  // ═══════════════════════════════════════════════════════════════════════════
  let guildGroups = null, phylumGroups = null;
  const phylumColour = (i) => {
    const n = DICT.phylum[i];
    return n === 'Basidiomycota' ? COL_ACCENT1 : n === 'Ascomycota' ? COL_ACCENT3 : ['#4e79a7', '#b07aa1', '#76b7b2', '#9c755f'][i % 4];
  };
  const guildColour = (i) => (i < 8 ? TABLEAU[i] : COL_OTHER);

  // groups of dictionary indices shown as one chip: first nTop values, "Autres", optional "non renseigné"
  function makeGroups(dictName, nTop, colourFn, withMissing) {
    const L = DICT[dictName].length, out = [];
    for (let i = 0; i < Math.min(nTop, L); i++) out.push({ label: DICT[dictName][i], colour: colourFn(i), idx: [i] });
    if (L > nTop) out.push({ label: 'Autres', colour: COL_OTHER, idx: d3.range(nTop, L) });
    if (withMissing) out.push({ label: 'Non renseigné', colour: COL_NA, idx: [MISSING] });
    return out;
  }
  const groupActive = (set, g) => g.idx.some((i) => set.has(i));
  function toggleGroup(set, g) {
    const all = g.idx.every((i) => set.has(i));
    g.idx.forEach((i) => (all ? set.delete(i) : set.add(i)));
  }

  const chipRefs = [];
  function toggleSet(set, v) { if (set.has(v)) set.delete(v); else set.add(v); }

  // create toggle chips for a list of groups bound to a filter Set
  function buildChips(containerId, groups, set) {
    const el = $(containerId); el.innerHTML = '';
    const refs = groups.map((g) => {
      const c = document.createElement('span');
      c.className = 'chip'; c.title = g.label;
      if (g.swatch) { const s = document.createElement('i'); s.className = 'swatch'; s.style.background = g.swatch; c.appendChild(s); }
      c.appendChild(document.createTextNode(g.label));
      c.addEventListener('click', () => { toggleGroup(set, g); scheduleUpdate(); });
      el.appendChild(c);
      return { g, el: c };
    });
    chipRefs.push({ refs, set, id: containerId });
  }

  // display names for lower-case source values (the source spells "mediterranen")
  const PRETTY = { atlantique: 'Atlantique', continental: 'Continental', montagnard: 'Montagnard', mediterranen: 'Méditerranéen' };
  const prettyLabel = (v) => PRETTY[v] || (v.charAt(0).toUpperCase() + v.slice(1));

  function buildSidebar() {
    guildGroups = makeGroups('guild', 8, guildColour, true); phylumGroups = makeGroups('phylum', 2, phylumColour, true);
    const withSwatch = (gs) => gs.map((g) => (g.swatch = g.colour, g));
    buildChips('filter-guild', withSwatch(guildGroups.filter((g) => g.label !== 'Non renseigné')), state.guildSet);
    buildChips('filter-phylum', withSwatch(phylumGroups.filter((g) => g.label !== 'Non renseigné')), state.phylumSet);
    buildChips('filter-trophic', makeGroups('trophic', DICT.trophic.length, () => null, false), state.trophicSet);
    buildChips('filter-ecoregion', makeGroups('ecoregion', DICT.ecoregion.length, () => null, false).map((g) => (g.label = prettyLabel(g.label), g)), state.ecoregionSet);

    // tabs: species browser / filters
    $('side-tabs').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) showTab(b.dataset.tab); });

    // accordion
    document.querySelectorAll('.filter-section .fs-head').forEach((b) => b.addEventListener('click', () => b.parentElement.classList.toggle('open')));

    // months
    const mg = $('filter-month');
    MONTHS.forEach((name, i) => {
      const b = document.createElement('div');
      b.className = 'month-btn'; b.textContent = name; b.dataset.m = i + 1;
      b.addEventListener('click', () => { toggleSet(state.monthSet, i + 1); scheduleUpdate(); });
      mg.appendChild(b);
    });

    // départements (alphabetical); clicking toggles without needing Ctrl
    const sel = $('filter-dept');
    DICT.dept.map((name, i) => ({ name: deptFeat.has(i) ? deptName(i) : null, i }))
      .filter((d) => d.name !== null).sort((a, b) => a.name.localeCompare(b.name, 'fr'))
      .forEach(({ name, i }) => {
        const o = document.createElement('option'); o.value = i; o.textContent = name;
        o.addEventListener('mousedown', (e) => { e.preventDefault(); sel.focus(); toggleSet(state.deptSet, i); scheduleUpdate(); });
        sel.appendChild(o);
      });
    sel.addEventListener('change', () => {
      state.deptSet.clear();
      Array.from(sel.selectedOptions).forEach((o) => state.deptSet.add(parseInt(o.value, 10)));
      scheduleUpdate();
    });

    // year range
    const ymin = $('year-min'), ymax = $('year-max');
    const onYear = (which) => () => {
      let a = +ymin.value, b = +ymax.value;
      if (a > b) { if (which === 'min') a = b; else b = a; }
      setYearRange(a, b);
    };
    ymin.addEventListener('input', onYear('min'));
    ymax.addEventListener('input', onYear('max'));
    updateYearLabel();

    // edibility control
    $('seg-edible').addEventListener('click', (e) => {
      const b = e.target.closest('button'); if (!b) return;
      state.edible = +b.dataset.v; scheduleUpdate();
    });

    $('btn-reset').addEventListener('click', resetAll);
    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      if (!$('help').classList.contains('hidden')) closeHelp(); else closeDrawer();
    });
  }

  function showTab(name) {
    document.querySelectorAll('#side-tabs button').forEach((b) => { const on = b.dataset.tab === name; b.classList.toggle('on', on); b.setAttribute('aria-selected', on); });
    document.querySelectorAll('.side-panel').forEach((p) => p.classList.toggle('on', p.id === 'panel-' + name));
  }

  // set the year filter (the full default range disables it)
  function setYearRange(a, b) {
    if (a <= YEAR_LO && b >= YEAR_HI) { state.yearMin = 0; state.yearMax = 0; a = YEAR_LO; b = YEAR_HI; }
    else { state.yearMin = a; state.yearMax = b; }
    $('year-min').value = a; $('year-max').value = b;
    updateYearLabel();
    scheduleUpdate();
  }
  function updateYearLabel() {
    const a = +$('year-min').value, b = +$('year-max').value, span = YEAR_HI - YEAR_LO, f = $('range-fill');
    $('year-range-label').textContent = a + '–' + b;
    f.style.left = (100 * (a - YEAR_LO) / span) + '%';
    f.style.width = (100 * (b - a) / span) + '%';
  }

  // refresh chip / month / dept / edibility widgets and the badges from state
  function syncUI() {
    chipRefs.forEach(({ refs, set }) => refs.forEach(({ g, el }) => el.classList.toggle('active', g.idx.length > 0 && g.idx.every((i) => set.has(i)))));
    document.querySelectorAll('.month-btn').forEach((b) => b.classList.toggle('active', state.monthSet.has(+b.dataset.m)));
    Array.from($('filter-dept').options).forEach((o) => { o.selected = state.deptSet.has(parseInt(o.value, 10)); });
    document.querySelectorAll('#seg-edible button').forEach((b) => b.classList.toggle('on', +b.dataset.v === state.edible));
    const chipCount = (id) => { const r = chipRefs.find((c) => c.id === id); return r ? r.refs.filter((x) => x.el.classList.contains('active')).length : 0; };
    const counts = {
      commune: state.commune >= 0 ? 1 : 0, year: state.yearMin > 0 ? 1 : 0, month: state.monthSet.size, guild: chipCount('filter-guild'), dept: state.deptSet.size,
      adv: chipCount('filter-phylum') + chipCount('filter-trophic') + chipCount('filter-ecoregion'),
    };
    document.querySelectorAll('.filter-section').forEach((s) => {
      const n = counts[s.dataset.key] || 0, bd = s.querySelector('.badge');
      bd.textContent = n; bd.classList.toggle('on', n > 0);
    });
    const total = d3.sum(Object.values(counts)), tb = $('filters-badge');
    tb.textContent = total; tb.classList.toggle('on', total > 0);
    updateYearLabel();
  }

  function setSpecies(indices, label) { state.speciesSet = new Set(indices); state.speciesLabel = label; }
  function clearSpecies() { state.speciesSet = new Set(); state.speciesLabel = ''; }

  // choose one species: filter on it, fly to its distribution and open its sheet; choosing it again clears
  function pickSpecies(idx) {
    if (state.speciesSet.size === 1 && state.speciesSet.has(idx)) { clearSpecies(); closeDrawer(); }
    else { setSpecies([idx], DICT.species[idx]); openSpecies(idx, true); }
    scheduleUpdate();
  }

  // ── species browser: searchable, sortable list that answers "which fungi here / now / edible" ──
  // The list counts records passing every filter EXCEPT the species filter (see aggregate), so it follows the
  // département, period, month, edibility and guild filters while still showing the other species.
  const ROW_H = 46, PAGE = 60;
  const BR = { query: '', sort: 'count', limit: PAGE, timer: 0, rows: [], total: 0 };
  let alphaRank = null, familyLower = [];
  let previewTimer = 0, savedTarget = null, savedByDept = null;

  function initBrowser() {
    const idx = d3.range(DICT.species.length).sort((p, q) => DICT.species[p].localeCompare(DICT.species[q], 'fr'));
    alphaRank = new Int32Array(DICT.species.length);
    idx.forEach((s, r) => { alphaRank[s] = r; });
    familyLower = DICT.family.map((f) => String(f).toLowerCase());
    const input = $('search-species');
    const apply = () => { BR.query = input.value.trim().toLowerCase(); BR.limit = PAGE; renderBrowser(lastAgg); $('sp-scroll').scrollTop = 0; };
    input.addEventListener('input', () => { clearTimeout(BR.timer); BR.timer = setTimeout(apply, 150); });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { clearTimeout(BR.timer); apply(); if (BR.rows[0]) pickSpecies(BR.rows[0].idx); }
      else if (e.key === 'Escape' && input.value) { input.value = ''; clearTimeout(BR.timer); apply(); e.stopPropagation(); }
    });
    $('seg-sort').addEventListener('click', (e) => {
      const b = e.target.closest('button'); if (!b) return;
      BR.sort = b.dataset.v; BR.limit = PAGE;
      document.querySelectorAll('#seg-sort button').forEach((x) => x.classList.toggle('on', x === b));
      renderBrowser(lastAgg);
    });
    $('sp-more').addEventListener('click', () => { BR.limit += PAGE; renderBrowser(lastAgg); });
    $('sp-multi').addEventListener('click', () => {
      if (BR.total < 2) return;
      const all = []; for (let s = 0; s < DICT.species.length; s++) if (lastAgg.bySpecies[s] > 0 && matchesQuery(s)) all.push(s);
      setSpecies(all, '« ' + $('search-species').value.trim() + ' » (' + fmt(all.length) + ' espèces)');
      scheduleUpdate();
    });
    $('species-active').addEventListener('click', () => { clearSpecies(); closeDrawer(); scheduleUpdate(); });
    $('commune-active').addEventListener('click', () => { state.commune = -1; scheduleUpdate(); });
    $('sp-list').addEventListener('mouseleave', endPreview);
  }

  const matchesQuery = (s) => !BR.query || speciesLower[s].includes(BR.query) || (spFamily[s] !== MISSING && familyLower[spFamily[s]].includes(BR.query));

  // rebuild the list: keyed D3 join, FLIP re-ranking (rows glide to their new rank), animated counts
  function renderBrowser(a) {
    if (!a) return;
    const L = DICT.species.length, counts = a.bySpecies;
    const idx = [];
    for (let s = 0; s < L; s++) if (counts[s] > 0 && matchesQuery(s)) idx.push(s);
    if (BR.sort === 'alpha') idx.sort((p, q) => alphaRank[p] - alphaRank[q]);
    else idx.sort((p, q) => counts[q] - counts[p] || alphaRank[p] - alphaRank[q]);
    BR.total = idx.length;
    const rows = idx.slice(0, BR.limit).map((s, r) => ({ idx: s, rank: r, name: DICT.species[s], fam: spFamily[s] !== MISSING ? DICT.family[spFamily[s]] : '', n: counts[s], edi: ediOf[s] }));
    BR.rows = rows;

    $('sp-count').textContent = fmt(BR.total) + (BR.total > 1 ? ' espèces · ' + (BR.sort === 'alpha' ? 'par ordre alphabétique' : 'triées par observations') : ' espèce') + (BR.query ? ' · « ' + $('search-species').value.trim() + ' »' : '');
    const multi = $('sp-multi');
    multi.classList.toggle('hidden', !(BR.query && BR.total > 1));
    multi.textContent = 'Voir les ' + fmt(BR.total) + ' espèces sur la carte';
    const more = $('sp-more');
    more.classList.toggle('hidden', BR.total <= rows.length);
    more.textContent = 'Voir plus (' + fmt(Math.min(PAGE, BR.total - rows.length)) + ' sur ' + fmt(BR.total - rows.length) + ' restantes)';
    $('sp-empty').classList.toggle('hidden', BR.total > 0);
    $('sp-empty').textContent = BR.query ? 'Aucune espèce ne correspond à cette recherche avec les filtres actuels.' : 'Aucune espèce avec les filtres actuels : assouplissez-les (Réinitialiser).';

    const ch = $('commune-active');
    ch.classList.toggle('hidden', state.commune < 0);
    ch.innerHTML = state.commune >= 0 ? '<span class="chip active" title="Retirer ce filtre">Commune : <b>' + esc(communeLabel(state.commune)) + '</b>  ×</span>' : '';
    const holder = $('species-active');
    holder.classList.toggle('hidden', state.speciesSet.size === 0);
    holder.innerHTML = state.speciesSet.size ? '<span class="chip active" title="Retirer ce filtre">Filtre : <em>' + esc(trunc(state.speciesLabel, 40)) + '</em>  ×</span>' : '';

    const list = $('sp-list');
    list.style.height = rows.length * ROW_H + 'px';
    // FLIP step 1 (First): where every visible row is now (transforms included)
    const first = new Map();
    list.querySelectorAll('.sp-row:not(.leaving)').forEach((el) => first.set(el.__data__.idx, el.getBoundingClientRect().top));
    list.querySelectorAll('.sp-row').forEach((el) => el.getAnimations().forEach((an) => an.cancel()));
    const sel = d3.select(list).selectAll('div.sp-row').data(rows, (d) => d.idx).join(
      (en) => {
        const r = en.append('div').attr('class', 'sp-row').attr('role', 'button').attr('tabindex', 0);
        r.append('span').attr('class', 'sp-badge').append('i');
        const m = r.append('span').attr('class', 'sp-main'); m.append('em').attr('class', 'sp-name'); m.append('small').attr('class', 'sp-fam');
        r.append('b').attr('class', 'sp-n');
        r.on('click', (e, d) => pickSpecies(d.idx))
          .on('keydown', (e, d) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pickSpecies(d.idx); } })
          .on('mouseenter', (e, d) => previewSpecies(d.idx));
        return r;
      },
      (up) => up.classed('leaving', false).style('pointer-events', null).style('opacity', null).interrupt('x'),
      (ex) => ex.filter(':not(.leaving)').classed('leaving', true).style('pointer-events', 'none').transition('x').duration(DUR / 2).style('opacity', 0).remove());
    sel.style('top', (d) => d.rank * ROW_H + 'px')
      .classed('sel', (d) => state.speciesSet.has(d.idx)).attr('aria-pressed', (d) => state.speciesSet.has(d.idx))
      .attr('title', (d) => d.name + ' — ' + EDI[d.edi].label);
    sel.select('.sp-badge').style('background', (d) => EDI[d.edi].colour).style('color', (d) => (d.edi === 0 ? '#5a4e3a' : '#fff')).select('i').text((d) => EDI[d.edi].icon);
    sel.select('.sp-name').text((d) => d.name);
    sel.select('.sp-fam').text((d) => d.fam);
    sel.select('.sp-n').each(function (d) { tweenNumber(this, d.n); });
    // FLIP steps 2-3 (Last, Invert, Play): rows that moved start at their old place and glide to the new one
    if (DUR) {
      sel.each(function (d) {
        const was = first.get(d.idx), now = this.getBoundingClientRect().top;
        if (was === undefined) this.animate([{ opacity: 0, transform: 'translateX(-10px)' }, { opacity: 1, transform: 'none' }], { duration: DUR * 0.7, easing: 'cubic-bezier(.22,.8,.3,1)' });
        else if (Math.abs(was - now) > 1) this.animate([{ transform: 'translateY(' + (was - now) + 'px)' }, { transform: 'none' }], { duration: DUR, easing: 'cubic-bezier(.22,.8,.3,1)' });
      });
    }
  }

  // hover on a list row: preview that species on the map (one pass over the records, nothing else changes)
  function previewSpecies(idx) {
    clearTimeout(previewTimer);
    previewTimer = setTimeout(() => {
      if (!previewing) { savedTarget = siteTarget.slice(); savedByDept = agg.byDept.slice(); }
      previewing = true;
      siteFrom.set(siteShown); siteTarget.fill(0);
      const byD = new Uint32Array(256), fm = failMask, mask = ~F_SPECIES;
      for (let i = 0; i < N; i++) {
        if (species[i] !== idx || (fm[i] & mask) !== 0) continue;
        byD[dept[i]]++;
        const st = siteOf[i]; if (st >= 0) siteTarget[st]++;
      }
      finishSites(); tipCache.clear(); updateMap({ byDept: byD }); startSiteAnim(false);
      $('preview-tag').innerHTML = 'Aperçu : <em>' + esc(DICT.species[idx]) + '</em>';
      $('preview-tag').classList.remove('hidden');
    }, 140);
  }
  function endPreview() {
    clearTimeout(previewTimer);
    if (!previewing) return;
    previewing = false;
    siteFrom.set(siteShown); siteTarget.set(savedTarget);
    finishSites(); tipCache.clear(); updateMap(lastAgg); startSiteAnim(false);
    $('preview-tag').classList.add('hidden');
  }

  // clear every filter (not the map position)
  function resetFilters() {
    ['speciesSet', 'phylumSet', 'guildSet', 'trophicSet', 'ecoregionSet', 'monthSet', 'deptSet'].forEach((k) => state[k].clear());
    clearSpecies();
    state.yearMin = 0; state.yearMax = 0; state.edible = 0; state.commune = -1;
    $('year-min').value = YEAR_LO; $('year-max').value = YEAR_HI;
    BR.query = ''; BR.limit = PAGE; $('search-species').value = '';
  }
  // restore the no-filter state and the whole-France view
  function resetAll() {
    resetFilters(); closeDrawer();
    mapSvg.transition().duration(DUR || 1).call(zoom.transform, d3.zoomIdentity);
    updateAll();
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // "À quoi sert ce site ?" panel (first visit, then the ? button) and starter questions
  // ═══════════════════════════════════════════════════════════════════════════
  const SEEN_KEY = 'fongimap-intro-seen';
  const store = {
    get() { try { return window.localStorage.getItem(SEEN_KEY); } catch (e) { return null; } },
    set(v) { try { window.localStorage.setItem(SEEN_KEY, v); } catch (e) { /* storage blocked: the panel simply shows again next time */ } },
  };
  const spIdx = (name) => DICT.species.indexOf(name);
  const genusIdx = (g) => d3.range(DICT.species.length).filter((i) => DICT.species[i].startsWith(g + ' '));
  // each starter presets filters, then lets the normal pipeline do the rest
  const STARTERS = [
    { label: 'Où trouver des cèpes ?', run: () => ({ pick: spIdx('Boletus edulis') }) },
    { label: 'Quels champignons comestibles en octobre ?', run: () => ({ months: [10], edible: 1 }) },
    { label: 'Où trouve-t-on des morilles au printemps ?', run: () => ({ genus: 'Morchella', months: [3, 4, 5] }) },
    { label: 'Où a-t-on vu l’amanite phalloïde (mortelle) ?', run: () => ({ pick: spIdx('Amanita phalloides') }) },
  ];

  function initHelp() {
    $('btn-help').addEventListener('click', openHelp);
    $('help-close').addEventListener('click', closeHelp);
    $('help-start').addEventListener('click', closeHelp);
    $('help').addEventListener('mousedown', (e) => { if (e.target === $('help')) closeHelp(); });
    $('help-starters').innerHTML = '';
    STARTERS.forEach((st) => {
      const b = document.createElement('button'); b.type = 'button'; b.textContent = st.label;
      b.addEventListener('click', () => applyStarter(st.run()));
      $('help-starters').appendChild(b);
    });
    let located = 0, approxN = 0;
    for (let i = 0; i < N; i++) { const s = siteOf[i]; if (s >= 0) { located++; if (siteApprox[s]) approxN++; } }
    $('help-data').textContent = fmt(N) + ' observations' + (META.yearSpan ? ' (' + META.yearSpan + ')' : '') + ' ; ' + Math.round(100 * located / N) + ' % ont une position sur la carte, dont ' +
      Math.round(100 * approxN / Math.max(1, located)) + ' % seulement au centre de la commune (symboles plus pâles).';
  }
  function openHelp() { $('help').classList.remove('hidden'); $('help-start').focus(); }
  function closeHelp() { $('help').classList.add('hidden'); store.set('1'); }
  function maybeShowHelp() { if (!store.get()) openHelp(); }

  function applyStarter(o) {
    closeHelp(); resetFilters(); closeDrawer(); showTab('species');
    if (o.months) o.months.forEach((m) => state.monthSet.add(m));
    if (o.edible) state.edible = o.edible;
    if (o.genus) { const g = genusIdx(o.genus); if (g.length) setSpecies(g, 'genre ' + o.genus + ' (' + fmt(g.length) + ' espèces)'); }
    if (o.pick !== undefined && o.pick >= 0) { setSpecies([o.pick], DICT.species[o.pick]); openSpecies(o.pick, true); }
    else mapSvg.transition().duration(DUR || 1).call(zoom.transform, d3.zoomIdentity);
    updateAll();
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Species drawer (details on demand)
  // ═══════════════════════════════════════════════════════════════════════════
  let drawerSpecies = -1;

  function initDrawer() { $('drawer-close').addEventListener('click', closeDrawer); }
  function closeDrawer() { $('map-container').classList.remove('drawer-open'); $('drawer').setAttribute('aria-hidden', 'true'); drawerSpecies = -1; }

  // one pass over the records of a species: all-time statistics independent of the current filters
  function scanSpecies(idx) {
    const mo = new Uint32Array(13), de = new Uint32Array(256), gu = new Uint32Array(256), seen = new Uint8Array(nSites);
    let n = 0, y0 = 9999, y1 = 0, first = -1, nSitesSeen = 0;
    const px = [], py = [];
    for (let i = 0; i < N; i++) {
      if (species[i] !== idx) continue;
      n++; if (first < 0) first = i;
      const y = year[i]; if (y) { if (y < y0) y0 = y; if (y > y1) y1 = y; }
      mo[month[i]]++; de[dept[i]]++; gu[guild[i]]++;
      const s = siteOf[i]; if (s >= 0 && !seen[s]) { seen[s] = 1; nSitesSeen++; px.push(sitePX[s]); py.push(sitePY[s]); }
    }
    px.sort(d3.ascending); py.sort(d3.ascending);
    const q = (arr, p) => (arr.length ? d3.quantile(arr, p) : null);
    const topDepts = topN(de, 5, MISSING).filter((d) => deptFeat.has(d)).map((d) => ({ name: deptName(d), n: de[d] }));
    let gB = -1, gM = 0; for (let g = 0; g < 255; g++) if (gu[g] > gM) { gM = gu[g]; gB = g; }
    return {
      n, y0, y1, months: Array.from(mo).slice(1), sites: nSitesSeen, nDepts: de.reduce((s, c, d) => s + (c > 0 && deptFeat.has(d) ? 1 : 0), 0), topDepts,
      guild: gB >= 0 ? DICT.guild[gB] : null,
      tax: first >= 0 ? { phylum: DICT.phylum[phylum[first]], class_: DICT.class_[class_[first]], order: DICT.order[order_[first]], family: DICT.family[family[first]] } : {},
      bbox: px.length ? [q(px, 0.02), q(py, 0.02), q(px, 0.98), q(py, 0.98)] : null,
    };
  }

  // Information provider. Today everything comes from the embedded dataset; to add a photo or a
  // description from the web later, set window.FMAP_SPECIES_PROVIDER = (name) => Promise<{imageUrl, summary}>.
  function getSpeciesInfo(idx) {
    const base_ = scanSpecies(idx), name = DICT.species[idx];
    const ext = typeof window.FMAP_SPECIES_PROVIDER === 'function' ? window.FMAP_SPECIES_PROVIDER(name) : Promise.resolve(null);
    return Promise.resolve(ext).catch(() => null).then((x) => Object.assign({ idx, name, imageUrl: null, summary: null }, base_, x || {}));
  }

  function placeholderSvg(code, name) {
    const c = EDI[code].colour, id = 'g' + Math.abs(name.split('').reduce((a, ch) => (a * 31 + ch.charCodeAt(0)) | 0, 7));
    return '<svg viewBox="0 0 336 170" preserveAspectRatio="xMidYMid slice" role="img" aria-label="Illustration à venir">' +
      '<defs><linearGradient id="' + id + '" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="' + c + '" stop-opacity=".55"/><stop offset="1" stop-color="#2b2217" stop-opacity=".85"/></linearGradient></defs>' +
      '<rect width="336" height="170" fill="url(#' + id + ')"/>' +
      '<g transform="translate(168,92)" fill="#f7f4ee" fill-opacity=".92"><path d="M-62 0 C-62 -52 62 -52 62 0 Z"/><path d="M-13 0 h26 c4 26 6 38 8 52 h-42 c2 -14 4 -26 8 -52z" fill-opacity=".8"/>' +
      '<circle cx="-26" cy="-20" r="6" fill="' + c + '" fill-opacity=".55"/><circle cx="14" cy="-30" r="5" fill="' + c + '" fill-opacity=".55"/><circle cx="34" cy="-12" r="4" fill="' + c + '" fill-opacity=".55"/></g></svg>';
  }

  function miniBars(host, vals, labels, colour) {
    const W = 304, H = 62, m = 12, bw = W / vals.length, mx = d3.max(vals) || 1;
    const svg = d3.select(host).append('svg').attr('viewBox', '0 0 ' + W + ' ' + (H + m + 2));
    const g = svg.append('g');
    const bars = g.selectAll('rect').data(vals).join('rect').attr('x', (d, i) => i * bw + 2).attr('width', bw - 4).attr('rx', 2)
      .attr('y', H).attr('height', 0).attr('fill', colour);
    bars.transition().duration(DUR * 1.3).ease(d3.easeBackOut.overshoot(0.8)).delay((d, i) => (DUR ? i * 40 : 0))
      .attr('y', (d) => H - (H - 4) * d / mx).attr('height', (d) => (H - 4) * d / mx);
    bars.append('title').text((d, i) => labels[i] + ' : ' + fmt(d));
    svg.selectAll('text').data(labels).join('text').attr('x', (d, i) => i * bw + bw / 2).attr('y', H + m).attr('text-anchor', 'middle')
      .style('font-size', '8.5px').style('fill', 'var(--fg3)').text((d) => d.charAt(0));
  }

  function openSpecies(idx, fly) {
    drawerSpecies = idx;
    $('map-container').classList.add('drawer-open'); $('drawer').setAttribute('aria-hidden', 'false');
    getSpeciesInfo(idx).then((info) => {
      if (drawerSpecies !== idx) return;
      if (fly && info.bbox) flyToBox(info.bbox);          // fly to the 2nd-98th percentile box of its places, beside the drawer
      const e = ediOf[idx], E = EDI[e], genus = info.name.split(' ')[0];
      const note = (META.edible && META.edible.notes[idx]) || (META.edible && META.edible.genus_notes[genus]) || '';
      const tax = [info.tax.phylum, info.tax.class_, info.tax.order, info.tax.family].filter(Boolean).join(' › ');
      const img = info.imageUrl ? '<img alt="' + esc(info.name) + '" src="' + esc(info.imageUrl) + '">' : placeholderSvg(e, info.name);
      $('drawer-body').innerHTML =
        '<figure class="dr-photo">' + img + '<figcaption>' + (info.imageUrl ? 'Photo' : 'Photo à venir') + '</figcaption></figure>' +
        '<div class="dr-body">' +
        '<div><div class="dr-title">' + esc(info.name) + '</div><div class="dr-tax">' + esc(tax) + '</div></div>' +
        '<div class="dr-edi" style="--edi:' + E.colour + '"><span style="font-size:20px">' + E.icon + '</span><div><b>' + esc(E.label) + '</b>' +
        (note ? esc(note) : (e === 0 ? 'Aucune information de comestibilité dans la base embarquée.' : '')) +
        '<small>Information indicative et non validée : ne jamais consommer un champignon sur la seule base de cette application ; faites-le contrôler par un pharmacien ou une société mycologique.</small></div></div>' +
        (info.summary ? '<p style="margin-top:10px">' + esc(info.summary) + '</p>' : '') +
        '<div class="dr-figs">' +
        '<div class="dr-fig"><b>' + fmt(info.n) + '</b><span>observations</span></div>' +
        '<div class="dr-fig"><b>' + (info.y0 < 9999 ? info.y0 + '–' + info.y1 : '—') + '</b><span>période</span></div>' +
        '<div class="dr-fig"><b>' + fmt(info.sites) + '</b><span>lieux géolocalisés</span></div>' +
        '<div class="dr-fig"><b>' + info.nDepts + '</b><span>départements</span></div></div>' +
        '<div class="dr-sec">Saisonnalité</div><div id="dr-months"></div>' +
        '<div class="dr-sec">Départements les plus riches</div><div id="dr-depts"></div>' +
        (info.guild ? '<div class="dr-sec">Guilde</div><div>' + esc(info.guild) + '</div>' : '') +
        '<div class="dr-actions">' +
        (info.bbox ? '<button class="primary" id="dr-fly">Voir sur la carte</button>' : '') +
        '<a target="_blank" rel="noopener" href="https://fr.wikipedia.org/wiki/' + encodeURIComponent(info.name.replace(/ /g, '_')) + '">Wikipédia ↗</a>' +
        '<a target="_blank" rel="noopener" href="https://www.gbif.org/species/search?q=' + encodeURIComponent(info.name) + '">GBIF ↗</a></div></div>';
      miniBars($('dr-months'), info.months, MONTHS, COL_ACCENT1);
      const dh = d3.select('#dr-depts'), mx = d3.max(info.topDepts, (d) => d.n) || 1;
      const rows = dh.selectAll('div').data(info.topDepts).join('div').style('display', 'flex').style('align-items', 'center').style('gap', '6px').style('margin', '2px 0').style('font-size', '11px');
      rows.append('span').style('width', '100px').style('flex-shrink', 0).text((d) => d.name);
      const track = rows.append('div').style('flex', 1).style('height', '8px').style('background', 'var(--bg3)').style('border-radius', '4px').append('div')
        .style('height', '100%').style('width', '0%').style('border-radius', '4px').style('background', COL_ACCENT1);
      track.transition().duration(DUR * 1.3).ease(EASE).delay((d, i) => (DUR ? 150 + i * 70 : 0)).style('width', (d) => (100 * d.n / mx) + '%');
      rows.append('span').style('width', '44px').style('text-align', 'right').style('color', 'var(--fg3)').text((d) => fmt(d.n));
      const flyBtn = $('dr-fly');
      if (flyBtn) flyBtn.addEventListener('click', () => flyToBox(info.bbox));
    });
  }

  // debugging / test hook
  window.FMAP_APP = {
    state, perf, get agg() { return lastAgg; }, get sites() { return { n: nSites, shown: siteShown, target: siteTarget }; },
    viewAt(lon, lat, k) {                      // test helper: centre the map on a longitude / latitude at zoom k
      const p = projection([lon, lat]), cx = base.ox + base.s * p[0], cy = base.oy + base.s * p[1];
      mapSvg.call(zoom.transform, d3.zoomIdentity.translate(base.w / 2 - k * cx, base.h / 2 - k * cy).scale(k));
    },
    updateAll, resetAll, pickCommune, setYearRange, setLayerMode, openSpecies, pickSpecies, flyTo, scanSpecies, applyStarter, STARTERS,
    get clusters() { return clusters; }, get labels() { return labelItems; }, get browser() { return BR; },
    get transform() { return tf; },
  };

  // ── go ────────────────────────────────────────────────────────────────────
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
