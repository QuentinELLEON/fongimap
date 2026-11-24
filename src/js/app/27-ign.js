  // ═══════════════════════════════════════════════════════════════════════════
  // IGN overlays at the last zoom levels (ONLINE, optional, each with its own switch):
  //   · forests  — IGN "masque forêt 2021-2023" polygons (Géoplateforme WFS), delimitation drawn over the colour code
  //   · altitude — contour lines computed here from IGN RGE ALTI elevations (Géoplateforme altimetry service),
  //                bold labelled lines every 100 m, plus summits and passes (BD TOPO oronyms) with their altitude
  // Both services are open (Licence Ouverte) and answer with CORS; nothing is shipped in the page, so the offline
  // promise holds: without a connection the overlays are simply absent. The requests carry only the displayed area.
  //
  // Performance rules (issue #12): nothing is requested or computed while the map is being moved (see onMotion());
  // requests for tiles that scrolled out of view are aborted; forest polygons are shared between tiles, simplified
  // below the pixel and clipped to the viewport before they are stroked.
  // ═══════════════════════════════════════════════════════════════════════════
  const IGN = {
    wfs: 'https://data.geopf.fr/wfs/ows', alti: 'https://data.geopf.fr/altimetrie/1.0/calcul/alti/rest/elevation.json',
    forestLayer: 'IGNF_MASQUE-FORET.2021-2023:masque_foret', oroLayer: 'BDTOPO_V3:detail_orographique',
    k: [48, 58],                    // fade-in range of the zoom factor (last levels only: bounded download size)
    tile: 0.05, n: 21,              // tile = 0.05° x 0.05°; elevation sampled on n x n points (≈ 200 m)
    maxTiles: 70, inflight: 4, batch: 5,
  };
  const IGN_KEY = 'fongimap-ign';
  const ign = { forest: true, alt: true, tiles: new Map(), wanted: new Set(), queue: [], running: 0, altQueue: [], altTimer: 0, errors: 0, lastErr: 0, status: '', forestVer: 0, fpCache: null };
  try { const v = JSON.parse(window.localStorage.getItem(IGN_KEY) || 'null'); if (v) { ign.forest = v.forest !== false; ign.alt = v.alt !== false; } } catch (e) { /* defaults */ }
  const ignSave = () => { try { window.localStorage.setItem(IGN_KEY, JSON.stringify({ forest: ign.forest, alt: ign.alt })); } catch (e) { /* not remembered */ } };
  const ignAlpha = () => smooth(IGN.k[0], IGN.k[1], tf.k);
  const ignVisible = () => (ign.forest || ign.alt) && ignAlpha() > 0.02;

  function setIgn(which, on) {
    ign[which] = on; ignSave();
    if ($('chk-' + (which === 'forest' ? 'forest' : 'alt'))) $('chk-' + (which === 'forest' ? 'forest' : 'alt')).checked = on;
    legendKey = ''; requestDraw(); scheduleHash();
  }
  function initIgn() {
    $('chk-forest').checked = ign.forest; $('chk-alt').checked = ign.alt;
    $('chk-forest').addEventListener('change', (e) => setIgn('forest', e.target.checked));
    $('chk-alt').addEventListener('change', (e) => setIgn('alt', e.target.checked));
  }

  // ── tiles ────────────────────────────────────────────────────────────────
  const tkey = (layer, tx, ty) => layer + ':' + tx + ',' + ty;
  const tileBox = (tx, ty) => ({ lon0: tx * IGN.tile, lat0: ty * IGN.tile, lon1: (tx + 1) * IGN.tile, lat1: (ty + 1) * IGN.tile });

  // geographic box of the viewport (corners and edge midpoints, the projection is conic)
  function viewBoxGeo() {
    const k = tf.k, a = k * base.s, bx = tf.x + k * base.ox, by = tf.y + k * base.oy;
    let lo0 = 1e9, la0 = 1e9, lo1 = -1e9, la1 = -1e9;
    for (const sx of [0, base.w / 2, base.w]) for (const sy of [0, base.h / 2, base.h]) {
      const ll = projection.invert([(sx - bx) / a, (sy - by) / a]); if (!ll) continue;
      lo0 = Math.min(lo0, ll[0]); lo1 = Math.max(lo1, ll[0]); la0 = Math.min(la0, ll[1]); la1 = Math.max(la1, ll[1]);
    }
    return { lo0, la0, lo1, la1 };
  }
  function visibleTiles() {
    const b = viewBoxGeo(), out = [];
    for (let ty = Math.floor(b.la0 / IGN.tile); ty <= Math.floor(b.la1 / IGN.tile); ty++) for (let tx = Math.floor(b.lo0 / IGN.tile); tx <= Math.floor(b.lo1 / IGN.tile); tx++) out.push([tx, ty]);
    return out;
  }
  function tileGet(layer, tx, ty, create) {
    const key = tkey(layer, tx, ty); let t = ign.tiles.get(key);
    if (!t && create) {
      if (ign.tiles.size > 260) { for (const [kk, v] of ign.tiles) { if (!ign.wanted.has(kk) && v.state !== 'loading') { ign.tiles.delete(kk); if (v.layer === 'forest') ign.forestVer++; } if (ign.tiles.size < 180) break; } }
      t = { key, layer, tx, ty, state: 'new', data: null, tries: 0, at: 0, abort: null }; ign.tiles.set(key, t);
    }
    return t;
  }

  // ── network queue (4 at a time, only tiles still in view) ─────────────────────
  function enqueue(task) { ign.queue.push(task); pump(); }
  function pump() {
    while (ign.running < IGN.inflight && ign.queue.length) {
      const task = ign.queue.shift();
      if (!ign.wanted.has(task.tile.key)) { task.tile.state = 'new'; continue; }       // scrolled away before its turn
      ign.running++; ignStatus();
      task.run(task.ac ? task.ac.signal : undefined).then(() => { task.tile.state = 'ok'; ign.errors = 0; }, (err) => {
        if (err && err.name === 'AbortError') { task.tile.state = 'new'; return; }        // scrolled away: not an error, may be asked again
        task.tile.state = 'err'; task.tile.at = Date.now(); ign.errors++; ign.lastErr = Date.now(); console.warn('IGN :', err && err.message);
      }).finally(() => { ign.running--; ignStatus(); requestDraw(); pump(); });
    }
  }
  function ignStatus() {
    const el = $('ign-status'); if (!el) return;
    const busy = ign.running + ign.queue.length + ign.altQueue.length, off = ign.errors >= 3 && !busy;
    const txt = busy ? 'Chargement des couches IGN…' : off ? 'Couches IGN indisponibles (hors ligne ?)' : '';
    if (txt !== ign.status) { ign.status = txt; el.textContent = tr(txt); el.classList.toggle('hidden', !txt); }
  }

  const wfsUrl = (type, b) => IGN.wfs + '?service=WFS&version=2.0.0&request=GetFeature&outputFormat=application%2Fjson&srsName=EPSG%3A4326&count=5000&typeNames=' + encodeURIComponent(type) +
    '&bbox=' + [b.lat0, b.lon0, b.lat1, b.lon1].join(',') + ',urn:ogc:def:crs:EPSG::4326';
  async function getJson(url, signal) { const r = await fetch(url, signal ? { signal } : undefined); if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); }

  // ── forest polygons ─────────────────────────────────────────────────────────
  // A forest crossing a tile border comes back with every tile it touches: features are kept once (by id) and shared, so a
  // polygon is drawn once. Rings are stored as projected Float32Arrays with their bounding boxes; at draw time only what is
  // near the viewport is turned into screen coordinates, simplified below the pixel and clipped to the viewport. (Stroking
  // the whole of a large forest at the deepest zoom, most of it off screen, used to cost about 650 ms per frame.)
  let forestById = new Map(), forestStamp = 0, FOREST_TOL = 1;       // simplification tolerance in screen pixels
  function forestFeature(f) {
    const hasId = f.id !== undefined && f.id !== null;
    if (hasId && forestById.has(f.id)) return forestById.get(f.id);
    const g = f.geometry; if (!g) return null;
    const polys = g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : [];
    const feat = { rings: [], x0: 1e9, y0: 1e9, x1: -1e9, y1: -1e9, stamp: 0 };
    for (const poly of polys) for (const r of poly) {
      const n = r.length - 1;                                        // GeoJSON rings repeat their first point
      if (n < 3) continue;
      const xy = new Float32Array(n * 2); let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
      for (let i = 0; i < n; i++) {
        const q = projection(r[i]); xy[2 * i] = q[0]; xy[2 * i + 1] = q[1];
        if (q[0] < x0) x0 = q[0]; if (q[0] > x1) x1 = q[0]; if (q[1] < y0) y0 = q[1]; if (q[1] > y1) y1 = q[1];
      }
      feat.rings.push({ xy, x0, y0, x1, y1 });
      if (x0 < feat.x0) feat.x0 = x0; if (x1 > feat.x1) feat.x1 = x1; if (y0 < feat.y0) feat.y0 = y0; if (y1 > feat.y1) feat.y1 = y1;
    }
    if (!feat.rings.length) return null;
    if (hasId) { if (forestById.size > 6000) forestById = new Map(); forestById.set(f.id, feat); }
    return feat;
  }
  // Sutherland-Hodgman against one half-plane (axis 0 = x, 1 = y; keep values >= bound when keepGreater, else <= bound)
  function clipHalf(p, axis, bound, keepGreater) {
    const out = [], n = p.length / 2; if (!n) return out;
    const inside = (v) => (keepGreater ? v >= bound : v <= bound);
    let px = p[2 * n - 2], py = p[2 * n - 1], pin = inside(axis === 0 ? px : py);
    for (let i = 0; i < n; i++) {
      const cx = p[2 * i], cy = p[2 * i + 1], cin = inside(axis === 0 ? cx : cy);
      if (cin !== pin) {
        if (axis === 0) { const t = (bound - px) / (cx - px); out.push(bound, py + t * (cy - py)); }
        else { const t = (bound - py) / (cy - py); out.push(px + t * (cx - px), bound); }
      }
      if (cin) out.push(cx, cy);
      px = cx; py = cy; pin = cin;
    }
    return out;
  }
  // screen-space Path2D of every forest ring near the viewport (12 px margin: the clipping edges stay out of sight)
  function forestPath(tiles, a, bx, by, W, H) {
    const M = 12, vx0 = (-M - bx) / a, vy0 = (-M - by) / a, vx1 = (W + M - bx) / a, vy1 = (H + M - by) / a, stamp = ++forestStamp, path = new Path2D(), TOL2 = FOREST_TOL * FOREST_TOL;
    let nPts = 0;
    for (const t of tiles) {
      if (t.state !== 'ok' || !t.data) continue;
      for (const f of t.data.feats) {
        if (f.stamp === stamp) continue; f.stamp = stamp;
        if (f.x1 < vx0 || f.x0 > vx1 || f.y1 < vy0 || f.y0 > vy1) continue;
        for (const r of f.rings) {
          if (r.x1 < vx0 || r.x0 > vx1 || r.y1 < vy0 || r.y0 > vy1) continue;
          if ((r.x1 - r.x0) * a < 0.8 && (r.y1 - r.y0) * a < 0.8) continue;           // under a pixel: invisible
          let pts = [], lx = 1e9, ly = 1e9; const xy = r.xy;
          for (let i = 0; i < xy.length; i += 2) {
            const x = bx + a * xy[i], y = by + a * xy[i + 1];
            if ((x - lx) * (x - lx) + (y - ly) * (y - ly) < TOL2) continue;             // radial simplification below a pixel
            pts.push(x, y); lx = x; ly = y;
          }
          if (pts.length < 6) continue;
          if (r.x0 < vx0 || r.x1 > vx1 || r.y0 < vy0 || r.y1 > vy1) {                    // partly outside the view: clip
            pts = clipHalf(pts, 0, -M, true); pts = clipHalf(pts, 0, W + M, false); pts = clipHalf(pts, 1, -M, true); pts = clipHalf(pts, 1, H + M, false);
            if (pts.length < 6) continue;
          }
          path.moveTo(pts[0], pts[1]); nPts += pts.length / 2;
          for (let i = 2; i < pts.length; i += 2) path.lineTo(pts[i], pts[i + 1]);
          path.closePath();
        }
      }
    }
    path.nPts = nPts;
    return path;
  }

  function loadForest(t) {
    t.state = 'loading'; t.abort = new AbortController();
    enqueue({ tile: t, ac: t.abort, run: async (signal) => {
      const d = await getJson(wfsUrl(IGN.forestLayer, tileBox(t.tx, t.ty)), signal), feats = [];
      (d.features || []).forEach((f) => { const ft = forestFeature(f); if (ft) feats.push(ft); });
      t.data = { feats, n: feats.length }; ign.forestVer++;
    } });
  }

  // elevation grid of a tile (n x n, shared edge samples with the neighbours so contours meet at tile borders)
  function loadAlt(t) {
    t.state = 'loading'; ign.altQueue.push(t);
    clearTimeout(ign.altTimer); ign.altTimer = setTimeout(flushAlt, 40);
  }
  // the altimetry service rate-limits (HTTP 429): one request at a time, spaced out, retried with a back-off
  let altBusy = false;
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  async function flushAlt() {
    if (altBusy) return;
    altBusy = true;
    try {
      while (ign.altQueue.length) {
        const group = ign.altQueue.splice(0, IGN.batch).filter((t) => ign.wanted.has(t.key) || (t.state = 'new', false));
        if (!group.length) continue;
        const lons = [], lats = [], n = IGN.n, d = IGN.tile / (n - 1);
        group.forEach((t) => { const b = tileBox(t.tx, t.ty); for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) { lons.push((b.lon0 + i * d).toFixed(5)); lats.push((b.lat0 + j * d).toFixed(5)); } });
        const body = JSON.stringify({ lon: lons.join('|'), lat: lats.join('|'), resource: 'ign_rge_alti_wld', delimiter: '|', indent: 'false', measures: 'false', zonly: 'true' });
        ign.running++; ignStatus();
        try {
          let j = null;
          for (let attempt = 0; attempt < 4 && !j; attempt++) {
            const r = await fetch(IGN.alti, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
            if (r.status === 429) { await wait(1200 * (attempt + 1)); continue; }
            if (!r.ok) throw new Error('HTTP ' + r.status);
            j = await r.json();
          }
          if (!j) throw new Error('HTTP 429 (rate limit)');
          const z = j.elevations || [];
          group.forEach((t, gi) => { const g = new Float32Array(n * n); for (let q = 0; q < n * n; q++) { const v = z[gi * n * n + q]; g[q] = v > -1000 ? v : NaN; } t.data = { z: g, paths: new Map(), labels: new Map() }; t.state = 'ok'; });
          ign.errors = 0;
        } catch (err) { group.forEach((t) => { t.state = 'err'; t.at = Date.now(); }); ign.errors++; console.warn('IGN altitude :', err && err.message); }
        ign.running--; ignStatus(); requestDraw();
        await wait(250);
      }
    } finally { altBusy = false; pump(); }
  }
  function loadOro(t) {
    t.state = 'loading'; t.abort = new AbortController();
    enqueue({ tile: t, ac: t.abort, run: async (signal) => {
      const d = await getJson(wfsUrl(IGN.oroLayer, tileBox(t.tx, t.ty)), signal);
      t.data = { pts: (d.features || []).filter((f) => f.geometry && f.geometry.type === 'Point' && /sommet|col|pic|dôme|dome|aiguille|puy/i.test(String(f.properties.nature || '')) && f.properties.toponyme)
        .map((f) => ({ name: f.properties.toponyme, nature: String(f.properties.nature), lon: f.geometry.coordinates[0], lat: f.geometry.coordinates[1] })) };
    } });
  }

  // ── contour lines: marching squares on the elevation grid ─────────────────────
  const isoSegments = FMAP_CORE.isoSegments;
  // Path2D (minor and major lines) and label candidates of a tile for a contour interval
  function tileContours(t, minor) {
    const D = t.data; let r = D.paths.get(minor); if (r) return r;
    const n = IGN.n, d = IGN.tile / (n - 1), b = tileBox(t.tx, t.ty), major = minor * 5;
    let lo = 1e9, hi = -1e9; for (let q = 0; q < n * n; q++) { const v = D.z[q]; if (v === v) { if (v < lo) lo = v; if (v > hi) hi = v; } }
    r = { minor: new Path2D(), major: new Path2D(), labels: [] };
    if (hi - lo >= minor * 0.6) {
      const pt = (g) => projection([b.lon0 + g[0] * d, b.lat0 + g[1] * d]);
      for (let alt = Math.ceil(lo / minor) * minor; alt <= hi; alt += minor) {
        const isMajor = alt % major === 0, path = isMajor ? r.major : r.minor; let best = null;
        isoSegments(D.z, n, alt, (p, q) => {
          const P = pt(p), Q = pt(q); path.moveTo(P[0], P[1]); path.lineTo(Q[0], Q[1]);
          if (isMajor) { const mx = (P[0] + Q[0]) / 2, my = (P[1] + Q[1]) / 2, dc = (p[0] - n / 2) ** 2 + (p[1] - n / 2) ** 2; if (!best || dc < best.dc) best = { alt, x: mx, y: my, dc, ang: Math.atan2(Q[1] - P[1], Q[0] - P[0]) }; }
        });
        if (best) r.labels.push(best);
      }
    }
    D.paths.set(minor, r); return r;
  }
  // altitude at a point by bilinear interpolation in the tile grid (null while the grid is not loaded)
  function altitudeAt(lon, lat) {
    const tx = Math.floor(lon / IGN.tile), ty = Math.floor(lat / IGN.tile), t = ign.tiles.get(tkey('alt', tx, ty));
    if (!t || t.state !== 'ok' || !t.data.z) return null;
    const n = IGN.n, d = IGN.tile / (n - 1), gx = (lon - tx * IGN.tile) / d, gy = (lat - ty * IGN.tile) / d, i = Math.min(n - 2, Math.floor(gx)), j = Math.min(n - 2, Math.floor(gy)), fx = gx - i, fy = gy - j, z = t.data.z;
    const v = (z[j * n + i] * (1 - fx) + z[j * n + i + 1] * fx) * (1 - fy) + (z[(j + 1) * n + i] * (1 - fx) + z[(j + 1) * n + i + 1] * fx) * fy;
    return v === v ? Math.round(v) : null;
  }

  // ── drawing ──────────────────────────────────────────────────────────────
  const FOREST_FILL = 'rgba(8,96,96,.12)', FOREST_LINE = 'rgba(6,74,74,.9)';
  const CONTOUR_MINOR = 'rgba(150,98,40,.5)', CONTOUR_MAJOR = 'rgba(120,70,20,.92)';
  // interim = a refresh in the middle of a long gesture: only what is already in memory is drawn, nothing is requested
  function drawIgn(interim) {
    const cv = $('ign-canvas'), ctx = cv.getContext('2d');
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, cv.width, cv.height);
    const alpha = ignAlpha();
    if (!interim) ign.wanted = new Set();
    if (alpha <= 0.02 || !(ign.forest || ign.alt)) { ignStatus(); return; }
    const tiles = visibleTiles();
    if (tiles.length > IGN.maxTiles) { ignStatus(); return; }
    const dpr = window.devicePixelRatio || 1, k = tf.k, a = k * base.s, bx = tf.x + k * base.ox, by = tf.y + k * base.oy;
    const want = (layer, tx, ty) => {
      const t = tileGet(layer, tx, ty, !interim); if (!t) return null;
      if (!interim) { ign.wanted.add(t.key); if (t.state === 'err' && Date.now() - t.at > 30000 && t.tries < 3) { t.tries++; t.state = 'new'; } }
      return t;
    };
    const forestT = [], altT = [], oroT = [];
    for (const [tx, ty] of tiles) {
      if (ign.forest) { const t = want('forest', tx, ty); if (t) forestT.push(t); }
      if (ign.alt) { const t1 = want('alt', tx, ty), t2 = want('oro', tx, ty); if (t1) altT.push(t1); if (t2) oroT.push(t2); }
    }
    if (!interim) {
      ign.tiles.forEach((t) => { if (t.state === 'loading' && t.abort && !ign.wanted.has(t.key)) t.abort.abort(); });     // left the view: stop downloading it
      forestT.forEach((t) => { if (t.state === 'new') loadForest(t); });
      altT.forEach((t) => { if (t.state === 'new') loadAlt(t); });
      oroT.forEach((t) => { if (t.state === 'new') loadOro(t); });
    }
    cv.style.opacity = alpha.toFixed(3);
    ctx.lineJoin = 'round';
    if (ign.forest) {
      const key = [tf.x.toFixed(2), tf.y.toFixed(2), tf.k.toFixed(4), base.w, base.h, ign.forestVer].join('|');
      if (!ign.fpCache || ign.fpCache.key !== key) ign.fpCache = { key, path: forestPath(forestT, a, bx, by, base.w, base.h) };
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = FOREST_FILL; ctx.strokeStyle = FOREST_LINE; ctx.lineWidth = 1.1;
      ctx.fill(ign.fpCache.path, 'evenodd'); ctx.stroke(ign.fpCache.path);
    }
    const labels = [], minor = k >= 68 ? 20 : 50;                              // contour interval follows the zoom (bold line every 5th)
    if (ign.alt) {
      ctx.setTransform(a * dpr, 0, 0, a * dpr, bx * dpr, by * dpr);
      altT.forEach((t) => {
        if (t.state !== 'ok' || !t.data.z) return;
        const c = tileContours(t, minor);
        ctx.strokeStyle = CONTOUR_MINOR; ctx.lineWidth = 0.55 / a; ctx.stroke(c.minor);
        ctx.strokeStyle = CONTOUR_MAJOR; ctx.lineWidth = 1.15 / a; ctx.stroke(c.major);
        c.labels.forEach((l) => labels.push(l));
      });
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.textBaseline = 'middle'; ctx.textAlign = 'center'; ctx.lineJoin = 'round';
    const taken = [], free = (x, y, w, h) => { for (const r of taken) if (Math.abs(r[0] - x) < (r[2] + w) / 2 && Math.abs(r[1] - y) < (r[3] + h) / 2) return false; taken.push([x, y, w, h]); return true; };
    if (ign.alt) {
      oroT.forEach((t) => {                                                    // summits and passes, with the altitude read from the elevation grid
        if (t.state !== 'ok' || !t.data) return;
        t.data.pts.forEach((p) => {
          const q = projection([p.lon, p.lat]), x = bx + a * q[0], y = by + a * q[1];
          if (x < 0 || y < 0 || x > base.w || y > base.h) return;
          const z = altitudeAt(p.lon, p.lat), txt = p.name + (z !== null ? ' · ' + fmt(z) + ' m' : ''), w = ctx.measureText(txt).width + 14;
          if (!free(x, y - 8, w, 14)) return;
          ctx.font = '600 10.5px system-ui, sans-serif';
          ctx.fillStyle = '#3a2410'; ctx.beginPath(); ctx.moveTo(x, y - 5); ctx.lineTo(x - 4.5, y + 3); ctx.lineTo(x + 4.5, y + 3); ctx.closePath(); ctx.fill();
          ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(255,255,255,.92)'; ctx.strokeText(txt, x, y - 14); ctx.fillStyle = '#3a2410'; ctx.fillText(txt, x, y - 14);
        });
      });
      ctx.font = '600 10px system-ui, sans-serif';
      labels.sort((p, q) => p.dc - q.dc).forEach((l) => {                       // altitude of the bold contour lines
        const x = bx + a * l.x, y = by + a * l.y; if (x < 8 || y < 8 || x > base.w - 8 || y > base.h - 8) return;
        const txt = fmt(l.alt) + ' m', w = ctx.measureText(txt).width + 8;
        if (!free(x, y, Math.max(w, 90), 18)) return;
        ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(255,255,255,.9)'; ctx.strokeText(txt, x, y); ctx.fillStyle = '#6b3d0c'; ctx.fillText(txt, x, y);
      });
    }
    if (!interim) { pump(); ignStatus(); }
  }

  // legend rows for the visible overlays
  function ignLegendHtml() {
    if (!ignVisible()) return '';
    const rows = [];
    if (ign.forest) rows.push('<li><i class="sw ign-forest"></i><span>Forêt (IGN, masque 2021-2023)</span></li>');
    if (ign.alt) rows.push('<li><i class="sw ign-contour"></i><span>Courbes de niveau (gras : 100 m)</span></li>', '<li><i class="sw ign-peak">▲</i><span>Sommet ou col, altitude en m</span></li>');
    return '<ul class="kinds ign">' + rows.join('') + '</ul>';
  }
