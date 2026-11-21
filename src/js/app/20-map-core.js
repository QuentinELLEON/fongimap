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
    ['grid-canvas', 'commune-canvas', 'dot-canvas', 'label-canvas'].forEach((id) => {
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

