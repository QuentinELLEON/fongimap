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
  const FONT = { commune: '500 10px system-ui, sans-serif', region: '700 11px system-ui, sans-serif', dept: '600 10px system-ui, sans-serif', townBig: '700 12px system-ui, sans-serif', town: '500 10.5px system-ui, sans-serif', site: 'italic 600 10px system-ui, sans-serif', sea: 'italic 11px system-ui, sans-serif', land: '600 10px system-ui, sans-serif' };

  // choose which labels fit: greedy by priority, rejecting any that overlaps one already placed
  function layoutLabels(al) {
    const k = tf.k, a = k * base.s, bx = tf.x + k * base.ox, by = tf.y + k * base.oy;
    const key = [tf.x.toFixed(1), tf.y.toFixed(1), k.toFixed(3), base.w, base.h, labelVer, al.dotA > 0.5 ? 1 : 0, al.communeA > 0.5 ? 1 : 0, [...state.deptSet].join(','), state.commune].join('|');
    if (key === labelKey) return;
    labelKey = key;
    const ctx = $('label-canvas').getContext('2d'), W = base.w, H = base.h;
    const boxes = [], items = [], used = new Set();
    const fits = (x0, y0, x1, y1) => { for (let i = 0; i < boxes.length; i++) { const b = boxes[i]; if (x0 < b[2] + 3 && x1 > b[0] - 3 && y0 < b[3] + 2 && y1 > b[1] - 2) return false; } return true; };
    const inView = (x, y) => x > 4 && y > 4 && x < W - 4 && y < H - 4;
    const put = (kind, text, x, y, opt) => {
      const w = textW(ctx, FONT[kind], text) + (kind === 'region' ? text.length * 1.2 : 0), h = 12;
      const dot = kind === 'town' || kind === 'townBig', lk = text.toLowerCase();
      if ((kind === 'site' || kind === 'commune') && used.has(lk)) return false;      // a place already named as a town is not named twice
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
    // 5b. commune names wherever the polygon is wide enough to hold its name (largest populations first)
    if (al.communeA > 0.5 && k >= 7 && visCommunes.length) {
      const cand = visCommunes.slice().sort((p, q) => COM.pop[q.ci] - COM.pop[p.ci]);
      let n = 0;
      for (const v of cand) {
        if (n >= 220) break;
        if (v.x1 - v.x0 < 36 || v.y1 - v.y0 < 14) continue;
        const nm = COM.names[v.ci];
        if (v.x1 - v.x0 < textW(ctx, FONT.commune, nm) + 8) continue;
        const p = projection([COM.lon[v.ci], COM.lat[v.ci]]);
        if (put('commune', nm, bx + a * p[0], by + a * p[1], { commune: v.ci })) n++;
      }
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
    const colour = { region: '#33402d', dept: '#4a3f2c', townBig: '#1f1a12', town: '#2b2217', commune: '#3b3426', site: '#6b3d08', sea: '#5f7d92', land: '#79858c' };
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
    } else if (hover.type === 'commune') {
      strokeCommune(ctx, hover.ci);
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

