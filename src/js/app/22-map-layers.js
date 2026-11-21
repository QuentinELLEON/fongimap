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
    for (let k = 0; k < nSites; k++) {
      const p = projection([META.lon_min + S.lon[k] * lonK, META.lat_min + S.lat[k] * latK]) || [NaN, NaN];
      sitePX[k] = p[0]; sitePY[k] = p[1];
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

