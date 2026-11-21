  // ── per-département species statistics (richness, rarefied richness) ─────────
  const deptRich = new Float32Array(256), deptRare = new Float32Array(256).fill(NaN);
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

