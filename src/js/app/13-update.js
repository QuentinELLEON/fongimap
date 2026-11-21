  // ═══════════════════════════════════════════════════════════════════════════
  // Update loop
  // ═══════════════════════════════════════════════════════════════════════════
  let updatePending = false, updateVer = 0;
  let agg = { total: 0, nSpecies: 0, nDepts: 0, gps: 0, bySpecies: new Uint32Array(65536), byDept: new Uint32Array(256) };
  function scheduleUpdate() {
    if (updatePending) return;
    updatePending = true;
    setTimeout(() => { updatePending = false; updateAll(); }, 0);
  }

  // filter state as plain arrays: this is what travels to the record engine
  function serializeState() {
    const a = (s) => Array.from(s);
    return { speciesSet: a(state.speciesSet), phylumSet: a(state.phylumSet), guildSet: a(state.guildSet), trophicSet: a(state.trophicSet),
      ecoregionSet: a(state.ecoregionSet), monthSet: a(state.monthSet), deptSet: a(state.deptSet),
      yearMin: state.yearMin, yearMax: state.yearMax, edible: state.edible, commune: state.commune };
  }

  // top-n indices of a counts array, optionally skipping one index (the "missing" code)
  function topN(counts, n, skip) {
    const idx = [];
    for (let i = 0; i < counts.length; i++) if (counts[i] > 0 && i !== skip) idx.push(i);
    idx.sort((a, b) => counts[b] - counts[a]);
    return idx.slice(0, n);
  }

  // filters -> counts (engine) -> every panel. A newer call supersedes an older one still waiting for the engine.
  async function updateAll(first) {
    const ver = ++updateVer, t0 = performance.now();
    siteFrom.set(siteShown);                   // animate bubbles / cells from what is on screen now
    clearTimeout(previewTimer); previewTok++; previewing = false; $('preview-tag').classList.add('hidden');
    labelVer++;
    const res = await engine.filter(serializeState());
    if (ver !== updateVer) return;
    if (metric === 'richness' || metric === 'rarefied') {
      const r = await engine.richness(metric);
      if (ver !== updateVer) return;
      deptRich.set(r.rich); deptRare.set(r.rare);
    }
    const t1 = performance.now();
    agg = res; siteTarget.set(res.siteCount);
    finishSites();
    lastAgg = agg;
    tipCache.clear(); tipTok++;
    updateStats(agg);
    updateMap(agg);
    renderBrowser(agg);
    syncUI();
    startSiteAnim(first);
    const t3 = performance.now();
    perf.filter = res.ms.filter; perf.aggregate = res.ms.aggregate; perf.render = t3 - t1; perf.total = t3 - t0;
  }

  function tweenNumber(el, to) {
    const from = +el.dataset.v || 0; el.dataset.v = to;
    if (DUR === 0) { el.textContent = fmt(to); return; }
    d3.select(el).transition('num').duration(DUR).tween('text', () => { const i = d3.interpolateNumber(from, to); return (t) => { el.textContent = fmt(Math.round(i(t))); }; });
  }
  function updateStats(a) {
    tweenNumber($('n-filtered'), a.total); tweenNumber($('n-species'), a.nSpecies); tweenNumber($('n-depts'), a.nDepts);
  }

