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
    const al2 = layerAlphas();
    if (al2.communeA > 0.5 && al2.dotA < 0.6) { const ci = communeAt(mx, my); if (ci >= 0) { pickCommune(ci); return true; } }
    return false;
  }
  // choose a commune (again = clear): filter on it and fly to its places
  function pickCommune(ci) {
    if (ci < 0) return;
    if (state.commune === ci) state.commune = -1;
    else {
      state.commune = ci;
      const cbx = communeBox(ci);
      if (cbx) flyToBox(cbx, 3);
      else {
      let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
      for (let k = 0; k < nSites; k++) if (siteCommune[k] === ci) { x0 = Math.min(x0, sitePX[k]); x1 = Math.max(x1, sitePX[k]); y0 = Math.min(y0, sitePY[k]); y1 = Math.max(y1, sitePY[k]); }
      const p = projection([COM.lon[ci], COM.lat[ci]]);
      flyToBox([Math.min(x0, p[0]), Math.min(y0, p[1]), Math.max(x1, p[0]), Math.max(y1, p[1])], 4);
      }
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
    if (al.communeA > 0.5 && al.dotA < 0.6) {
      const ci = communeAt(mx, my);
      if (ci >= 0) { $('map-svg').style.cursor = 'pointer'; setHover({ type: 'commune', id: ci, ci }); showCommuneTip(ci, mx, my); return; }
    }
    if (al.gridA > 0.35 && al.dotA < 0.35 && al.communeA < 0.5 && cellTree) {
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
  function hideTip() { tipKey = ''; $('map-tooltip').classList.add('hidden'); setHover(null); }
  const dotHtml = (code) => '<i class="dot" style="background:' + EDI[code].colour + '"></i>';

  // The top species of a place come from the record engine (asynchronous): the tooltip is drawn at once
  // without the list, then completed when the answer arrives (unless the pointer has moved on).
  function withTop(key, spec, render) {
    tipKey = key;
    const cached = tipCache.get(key);
    if (cached) { render(cached); return; }
    render(null);
    const tok = tipTok;
    engine.topWhere(spec, 3).then((r) => { if (tok !== tipTok) return; tipCache.set(key, r); if (tipKey === key) render(r); });
  }
  const topPending = '<span class="muted">…</span>';
  function listHtml(top) { return top.map((t) => dotHtml(ediOf[t[0]]) + '<span title="' + esc(latinName(t[0])) + '">' + nameHtml(t[0]) + '</span> ' + fmt(t[1])).join('<br>'); }

  function showDeptTip(d, mx, my) {
    const fi = DEPTS.features.indexOf(d), di = featDept[fi];
    const head = '<strong>' + esc(d.properties.nom) + '</strong> <span class="muted">(' + esc(d.properties.code) + ') · ' + fmt(Math.round(deptArea[fi])) + ' km²</span><br>';
    const out = (html) => { $('map-tooltip').innerHTML = html; placeTip(mx, my); };
    if (di < 0) { tipKey = ''; out(head + '<span class="muted">Aucune donnée</span>'); return; }
    const c = featCount[fi];
    if (c === 0) { tipKey = ''; out(head + 'Aucune observation'); return; }
    let tot = 0; for (let k = 0; k < agg.byDept.length; k++) tot += agg.byDept[k];
    withTop('d' + di, { kind: 'dept', di }, (det) => {
      out(head + fmt(c) + ' observations <span class="muted">(' + (100 * c / tot).toFixed(1).replace('.', ',') + ' % · ' + fmtVal(c / (deptArea[fi] / 100)) + ' / 100 km²)</span><br>' +
        (det ? fmt(det.distinct) + ' espèces distinctes<br>' + listHtml(det.top) + (det.guild >= 0 ? '<br><span class="muted">Guilde dominante :</span> ' + esc(guildFr(DICT.guild[det.guild])) : '') : topPending) +
        '<br><span class="muted">Clic : filtrer · double-clic : zoomer</span>');
    });
  }

  function showSiteTip(s, mx, my) {
    const name = siteName[siteLoc[s]] || 'Lieu sans nom';
    withTop('s' + s, { kind: 'site', s }, (r) => {
      $('map-tooltip').innerHTML = '<strong>' + esc(name) + '</strong><br>' + fmt(siteTarget[s]) + ' observations' + (r ? ' · ' + fmt(r.distinct) + ' espèces' : '') +
        (siteApprox[s] ? '<br><span class="muted">position approximative (centre de commune)</span>' : '') + '<br>' + (r ? listHtml(r.top) : topPending) +
        (siteCommune[s] >= 0 ? '<br><span class="muted">Clic : filtrer sur ' + esc(communeLabel(siteCommune[s])) + '</span>' : '');
      placeTip(mx, my);
    });
  }

  function showClusterTip(c, mx, my) {
    withTop('g' + c.s + '_' + c.n, { kind: 'sites', list: c.m }, (r) => {
      $('map-tooltip').innerHTML = '<strong>' + fmt(c.n) + ' lieux regroupés</strong><br>' + fmt(Math.round(c.W)) + ' observations' + (r ? ' · ' + fmt(r.distinct) + ' espèces<br>' + listHtml(r.top) : '<br>' + topPending) +
        '<br><span class="muted">Clic : zoomer pour les séparer</span>';
      placeTip(mx, my);
    });
  }

  function showCellTip(c, mx, my) {
    withTop('c' + c, { kind: 'cell', c, showApprox }, (r) => {
      $('map-tooltip').innerHTML = '<strong>Hexagone de 10 km</strong> <span class="muted">(≈ 87 km²)</span><br>' +
        fmt(cellTarget[c]) + ' observations' + (r ? ' · ' + fmt(r.distinct) + ' espèces<br>' + listHtml(r.top) : '<br>' + topPending);
      placeTip(mx, my);
    });
  }
