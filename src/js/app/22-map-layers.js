  // ── semantic zoom: how visible each layer is ─────────────────────────────
  function layerAlphas() {
    const k = tf.k, hc = hasCommunes();
    switch (layerMode) {
      case 'dept': return { gridA: 0, communeA: 0, dotA: 0 };
      case 'grid': return { gridA: 1, communeA: 0, dotA: 0 };
      case 'communes': return { gridA: 0, communeA: hc ? 1 : 0, dotA: 0 };
      case 'sites': return { gridA: 0, communeA: 0, dotA: 1 };
      default: return { gridA: smooth(1.7, 2.8, k), communeA: hc ? smooth(COMMUNE_K[0], COMMUNE_K[1], k) : 0, dotA: hc ? smooth(SITE_K[0], SITE_K[1], k) : smooth(5.2, 6.4, k) };
    }
  }

  // one legend at a time: the layer that dominates the current view
  function renderLegend(al) {
    const kind = al.dotA > 0.5 ? 'sites' : al.communeA > 0.5 ? 'commune' : al.gridA > 0.5 ? 'grid' : 'dept';
    const hint = layerMode === 'auto' && kind === 'dept' && tf.k < 2.4;
    const key = [kind, showApprox, hint, legend.title, legend.cuts.join(','), metric, communeCuts.join(','), ignVisible() ? (ign.forest ? 'f' : '') + (ign.alt ? 'a' : '') : '-'].join('|');
    if (key === legendKey) return;
    legendKey = key;
    const row = (swatch, label) => '<li>' + swatch + '<span>' + label + '</span></li>';
    let html;
    if (kind === 'dept') {
      html = '<p class="lg-title" role="heading" aria-level="2">' + esc(legend.title) + '</p><ul>' + legend.ramp.map((c, i) => row('<i class="sw" style="background:' + c + '"></i>', legend.labels[i])).join('') +
        row('<i class="sw" style="background:' + COL_ZERO + '"></i>', 'aucune observation') + '</ul>' +
        '<p class="legend-note">' + esc(legend.note) + (hint ? ' Zoomez : des hexagones puis des lieux apparaissent.' : '') + '</p>';
    } else if (kind === 'commune') {
      const byCount = metric === 'count';
      html = '<p class="lg-title" role="heading" aria-level="2">' + (byCount ? 'Observations par commune' : 'Observations par km²') + '</p><ul>' +
        communeRamp.map((c, i) => row('<i class="sw" style="background:' + c + '"></i>', communeLabels[i])).join('') +
        row('<i class="sw" style="background:' + COL_ZERO + '"></i>', 'aucune observation') + '</ul>' +
        '<p class="legend-note">Chaque commune est colorée selon son nombre d’observations' + (byCount ? '' : ' rapporté à sa surface') + '. Les lieux au centre de la commune n’ont pas de position plus fine : la commune est l’échelle fiable. Traits : commune &lt; département &lt; région.</p>';
    } else if (kind === 'grid') {
      html = '<p class="lg-title" role="heading" aria-level="2">Observations par hexagone</p><p class="legend-note top">Chaque hexagone mesure 10 km de large (≈ 87 km²) : plus il est foncé, plus il y a eu d’observations.</p><ul>' +
        CELL_LABELS.map((l, i) => row('<i class="sw" style="background:' + cellColour(i) + '"></i>', l)).join('') + '</ul>';
    } else {
      html = '<p class="lg-title" role="heading" aria-level="2">Observations par lieu</p><ul class="circles">' +
        SYM_RADII.map((rr, i) => row('<i class="circ" style="width:' + Math.round(2 * rr) + 'px;height:' + Math.round(2 * rr) + 'px"></i>', SYM_LABELS[i])).join('') + '</ul>' +
        '<ul class="kinds">' + row('<i class="circ exact"></i>', 'position GPS') +
        (showApprox ? row('<i class="circ approx"></i>', 'centre de commune (approximatif)') : '') +
        row('<i class="circ exact group"></i>', 'plusieurs lieux proches regroupés') + '</ul>';
    }
    $('map-legend').innerHTML = html + ignLegendHtml();
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
    updateCommunes();
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
    if (!moving) drawLayers();
    animRaf = t < 1 ? requestAnimationFrame(animStep) : 0;
  }

  let drawQueued = false;
  function requestDraw() {
    if (drawQueued || moving) return;                  // during a gesture the settle step redraws everything once
    drawQueued = true;
    requestAnimationFrame(() => { drawQueued = false; if (!moving) drawLayers(); });
  }

  // ── motion: while the user pans or zooms, the canvases keep their last bitmap and the compositor moves it (CSS
  //    transform, no JavaScript per frame). The costly redraw happens once the gesture pauses, or at most every
  //    few hundred ms during a long gesture or fly-to, so panning stays smooth at every zoom level. ─────────
  const SETTLE_MS = 140, CANVAS_IDS = ['grid-canvas', 'commune-canvas', 'ign-canvas', 'dot-canvas', 'label-canvas'];
  let moving = false, settleTimer = 0, drawnTf = { x: 0, y: 0, k: 1 }, lastDrawAt = 0, lastDrawMs = 0, canvasEls = null;
  function resetCanvasTransform() {
    if (!canvasEls) canvasEls = CANVAS_IDS.map($);
    canvasEls.forEach((c) => { c.style.transform = ''; });
    canvasEls[4].style.visibility = '';
  }
  function onMotion() {
    if (!siteShown) return;
    if (!moving) lastDrawAt = performance.now();          // a gesture never starts with a full redraw
    moving = true;
    clearTimeout(settleTimer); settleTimer = setTimeout(settle, SETTLE_MS);
    if (!canvasEls) canvasEls = CANVAS_IDS.map($);
    if (performance.now() - lastDrawAt > Math.max(450, lastDrawMs * 6)) { drawLayers(true); return; }   // long gesture: refresh the bitmap now and then
    const s = tf.k / drawnTf.k, css = 'translate(' + (tf.x - s * drawnTf.x).toFixed(2) + 'px,' + (tf.y - s * drawnTf.y).toFixed(2) + 'px) scale(' + s.toFixed(5) + ')';
    canvasEls.forEach((c) => { c.style.transform = css; });
    canvasEls[4].style.visibility = s > 1.5 || s < 0.67 ? 'hidden' : '';      // stretched text is unreadable: hide it until the redraw
  }
  function settle() { moving = false; clearTimeout(settleTimer); drawLayers(); }

  const cellColour = (i) => d3.interpolateYlOrBr(0.16 + 0.72 * i / 4);

  // draw dept fade, grid cells, sites, place names, scale bar and locator for the current zoom / mode
  function drawLayers(interim) {
    if (!siteShown) return;
    const t0 = performance.now();
    drawnTf = { x: tf.x, y: tf.y, k: tf.k };
    resetCanvasTransform();
    const al = layerAlphas();
    deptG.style('opacity', 1 - 0.7 * Math.max(al.gridA, al.communeA, al.dotA));     // the choropleth recedes once finer layers take over
    regionG.style('display', al.communeA > 0.99 ? 'none' : null);                   // the commune canvas draws the region borders itself: no SVG strokes to repaint
    const gridVis = al.gridA * (1 - al.communeA) * (1 - al.dotA);
    $('grid-canvas').style.opacity = gridVis.toFixed(3);
    $('commune-canvas').style.opacity = al.communeA.toFixed(3);
    $('dot-canvas').style.opacity = al.dotA.toFixed(3);
    if (gridVis > 0.01) drawGrid();
    if (al.communeA > 0.01) drawCommunes(al); else if (visCommunes.length) { visCommunes = []; $('commune-canvas').getContext('2d').clearRect(0, 0, base.w, base.h); }
    drawIgn(interim);
    if (al.dotA > 0.01) drawSites(); else clusters = [];
    renderLegend(al);
    updateScale(); updateLocator();
    layoutLabels(al); paintLabels();
    lastDrawAt = performance.now(); lastDrawMs = lastDrawAt - t0; perf.draw = lastDrawMs;
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

