  // ═══════════════════════════════════════════════════════════════════════════
  // Commune layer: polygons coloured by observations, hierarchical borders, names, hover, click, search
  // Geometry comes from geo-communes.js (built by tools/build_data.py, see tools/pipeline/communes.py for the format). It is loaded and
  // decoded lazily, never at boot: arcs are shared between communes so every border is drawn once, classed by the
  // administrative level it separates (commune / département / région / coast).
  // ═══════════════════════════════════════════════════════════════════════════
  const COMMUNE_K = [4, 5.5];                // zoom range where the commune layer fades in (départements -> hexagons -> communes)
  const SITE_K = [9, 11];                    // places (graduated symbols) appear on top of the communes from here
  const TILE_N = 40, TILE = VIRT / TILE_N;   // spatial index: 40 x 40 tiles over the virtual map box
  // line styles per arc class: [colour, width in screen px]
  const BORDER = [['rgba(60,52,38,.30)', 0.5], ['rgb(96,86,64)', 1.2], ['rgb(58,50,36)', 1.9], ['rgb(46,40,28)', 0.9]];
  let G = null, geoState = 'idle';           // decoded geometry; 'idle' | 'loading' | 'ready' | 'failed'
  let communeCount = null, communeClass = null, communeCuts = [], communeRamp = [], communeLabels = [];
  let communeSites = null, comKeys = null;
  let visCommunes = [];                      // communes drawn by the last drawCommunes(): { ci, x0, y0, x1, y1 } in screen px
  let comStamp = 0;

  const hasCommunes = () => !!(META.communes && META.communes.code);

  // after the table is in memory: degrees from the 16-bit anchors, sites per commune, search keys
  function initCommunes() {
    if (!hasCommunes()) return;
    const kx = (META.lon_max - META.lon_min) / Q_MAX, ky = (META.lat_max - META.lat_min) / Q_MAX;
    COM = META.communes;
    COM.lon = COM.lonq.map((q) => META.lon_min + q * kx); COM.lat = COM.latq.map((q) => META.lat_min + q * ky);
    const n = COM.names.length;
    communeCount = new Uint32Array(n); communeClass = new Uint8Array(n).fill(255);
    communeSites = Array.from({ length: n }, () => []);
    for (let s = 0; s < nSites; s++) { const c = siteCommune[s]; if (c >= 0) communeSites[c].push(s); }
    comKeys = COM.names.map((x) => FMAP_CORE.searchKey(x));
    initCommuneSearch();
    setTimeout(ensureGeometry, 1200);        // preload quietly once the first frame is up
  }

  // ── geometry loading and decoding ────────────────────────────────────────
  function ensureGeometry() {
    if (G || geoState === 'loading' || geoState === 'failed' || !hasCommunes()) return;
    geoState = 'loading';
    if (window.FMAP_GEO_COMMUNES) { decodeGeometry(window.FMAP_GEO_COMMUNES); return; }
    const s = document.createElement('script'); s.src = DATA_DIR + 'geo-communes.js';
    s.onload = () => { if (window.FMAP_GEO_COMMUNES) decodeGeometry(window.FMAP_GEO_COMMUNES); else geoState = 'failed'; };
    s.onerror = () => { geoState = 'failed'; console.warn('FongiMap : geo-communes.js introuvable, pas de limites communales.'); };
    document.head.appendChild(s);
  }
  const idle = () => new Promise((r) => setTimeout(r, 0));

  async function decodeGeometry(pkg) {
    try {
      const bin = atob(pkg.data), z = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) z[i] = bin.charCodeAt(i);
      pkg.data = null; window.FMAP_GEO_COMMUNES = null;
      await idle();
      const raw = fflate.unzlibSync(z);
      const nA = pkg.n_arcs, nCom = pkg.n_communes, sz = pkg.sizes;
      let p = 0;
      const vi = () => { let v = 0, s = 0, b; do { b = raw[p++]; v |= (b & 0x7f) << s; s += 7; } while (b & 0x80); return v >>> 0; };
      const lonK = (META.lon_max - META.lon_min) / Q_MAX, latK = (META.lat_max - META.lat_min) / Q_MAX;
      const off = new Uint32Array(nA + 1), ax = new Float32Array(sz.arcs), ay = new Float32Array(sz.arcs), box = new Float32Array(nA * 4);
      let n = 0;
      for (let a = 0; a < nA; a++) {
        const cnt = vi();
        off[a] = n;
        if (cnt === 0) { box.fill(0, a * 4, a * 4 + 4); continue; }
        let qx = vi(), qy = vi(), x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
        for (let i = 0; i < cnt; i++) {
          if (i > 0) { const dx = vi(), dy = vi(); qx += (dx >>> 1) ^ -(dx & 1); qy += (dy >>> 1) ^ -(dy & 1); }
          const pt = projection([META.lon_min + qx * lonK, META.lat_min + qy * latK]);
          ax[n] = pt[0]; ay[n] = pt[1]; n++;
          if (pt[0] < x0) x0 = pt[0]; if (pt[0] > x1) x1 = pt[0]; if (pt[1] < y0) y0 = pt[1]; if (pt[1] > y1) y1 = pt[1];
        }
        box[a * 4] = x0; box[a * 4 + 1] = y0; box[a * 4 + 2] = x1; box[a * 4 + 3] = y1;
        if ((a & 4095) === 4095) await idle();            // keep the page responsive while decoding
      }
      off[nA] = n;
      const cls = raw.slice(p, p + sz.classes); p += sz.classes;
      // rings per commune: com[ci] = array of rings, each an Int32Array of (arc << 1 | reversed)
      const com = new Array(nCom), cbox = new Float32Array(nCom * 4);
      for (let c = 0; c < nCom; c++) {
        const rings = []; let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
        for (let np = vi(); np > 0; np--) for (let nr = vi(); nr > 0; nr--) {
          const nf = vi(), refs = new Int32Array(nf);
          for (let i = 0; i < nf; i++) {
            const r = vi(); refs[i] = r; const a = r >> 1;
            if (box[a * 4] < x0) x0 = box[a * 4]; if (box[a * 4 + 1] < y0) y0 = box[a * 4 + 1]; if (box[a * 4 + 2] > x1) x1 = box[a * 4 + 2]; if (box[a * 4 + 3] > y1) y1 = box[a * 4 + 3];
          }
          rings.push(refs);
        }
        com[c] = rings; cbox[c * 4] = x0; cbox[c * 4 + 1] = y0; cbox[c * 4 + 2] = x1; cbox[c * 4 + 3] = y1;
        if ((c & 4095) === 4095) await idle();
      }
      // tile index: communes and arcs listed in every tile their bounding box touches (class-0 arcs only in the tile of their first point)
      const tcom = Array.from({ length: TILE_N * TILE_N }, () => []), tarc = Array.from({ length: TILE_N * TILE_N }, () => []);
      const tr = (v) => Math.max(0, Math.min(TILE_N - 1, Math.floor(v / TILE)));
      for (let c = 0; c < nCom; c++) for (let ty = tr(cbox[c * 4 + 1]); ty <= tr(cbox[c * 4 + 3]); ty++) for (let tx = tr(cbox[c * 4]); tx <= tr(cbox[c * 4 + 2]); tx++) tcom[ty * TILE_N + tx].push(c);
      for (let a = 0; a < nA; a++) {
        if (cls[a] === 255 || off[a + 1] - off[a] < 2) continue;
        if (cls[a] === 0) tarc[tr(ay[off[a]]) * TILE_N + tr(ax[off[a]])].push(a);
        else for (let ty = tr(box[a * 4 + 1]); ty <= tr(box[a * 4 + 3]); ty++) for (let tx = tr(box[a * 4]); tx <= tr(box[a * 4 + 2]); tx++) tarc[ty * TILE_N + tx].push(a);
      }
      const apt = (a) => off[a + 1] - off[a];
      G = {
        nA, nCom, off, ax, ay, cls, com, cbox, tcom, tarc, stamp: new Uint32Array(nCom), paths: new Map(), pts: new Map(), tilePaths: new Map(),
        // outline of a commune as a Path2D (virtual coordinates) + its ring vertices (for hit tests), built on first use
        path(c) {
          let pth = this.paths.get(c);
          if (pth) return pth;
          if (this.paths.size > 9000) { this.paths.clear(); this.pts.clear(); }
          pth = new Path2D(); const rings = [];
          for (const refs of com[c]) {
            const xs = [], ys = [];
            for (let i = 0; i < refs.length; i++) {
              const a = refs[i] >> 1, rev = refs[i] & 1, o = off[a], m = apt(a);
              for (let j = (i === 0 ? 0 : 1); j < m; j++) { const q = o + (rev ? m - 1 - j : j); xs.push(ax[q]); ys.push(ay[q]); }
            }
            if (xs.length < 3) continue;
            pth.moveTo(xs[0], ys[0]); for (let i = 1; i < xs.length; i++) pth.lineTo(xs[i], ys[i]); pth.closePath();
            rings.push([xs, ys]);
          }
          this.paths.set(c, pth); this.pts.set(c, rings);
          return pth;
        },
        // one Path2D per (tile, class) holding the arcs of that class assigned to the tile
        tile(t, k) {
          const key = t * 4 + k; let pth = this.tilePaths.get(key);
          if (pth) return pth;
          pth = new Path2D();
          for (const a of tarc[t]) {
            if (cls[a] !== k) continue;
            const o = off[a], m = apt(a); pth.moveTo(ax[o], ay[o]);
            for (let j = 1; j < m; j++) pth.lineTo(ax[o + j], ay[o + j]);
          }
          this.tilePaths.set(key, pth);
          return pth;
        },
      };
      geoState = 'ready';
      requestDraw();
    } catch (err) { geoState = 'failed'; console.error('FongiMap : décodage des communes impossible', err); }
  }

  // bounding box of a commune in virtual coordinates, or null while the geometry is not decoded
  const communeBox = (ci) => (G ? [G.cbox[ci * 4], G.cbox[ci * 4 + 1], G.cbox[ci * 4 + 2], G.cbox[ci * 4 + 3]] : null);

  // ── colours: classes of the chosen measure over the communes that have observations ─────────────────────
  function updateCommunes() {
    if (!communeCount) return;
    communeCount.fill(0);
    for (let s = 0; s < nSites; s++) { const c = siteCommune[s]; if (c >= 0 && siteTarget[s] > 0) communeCount[c] += siteTarget[s]; }
    const byCount = metric === 'count', val = new Float64Array(communeCount.length), vals = [];
    for (let c = 0; c < val.length; c++) {
      const n = communeCount[c];
      if (n > 0) { val[c] = byCount ? n : n / Math.max(COM.area[c], 0.05); vals.push(val[c]); }
    }
    const raw = d3.scaleQuantile().domain(vals.length ? vals : [0]).range(d3.range(6)).quantiles();
    const dedupe = (arr) => { const o = []; arr.forEach((c) => { if (c > 0 && (!o.length || c > o[o.length - 1])) o.push(c); }); return o; };
    let cuts = dedupe(raw.map(niceCut));
    if (cuts.length < 4) cuts = dedupe(raw.map((v) => (v < 10 ? Math.round(v * 10) / 10 : Math.round(v))));
    const nRamp = cuts.length + 1;
    communeCuts = cuts;
    communeRamp = d3.quantize((t) => d3.interpolateYlGn(0.2 + 0.78 * t), Math.max(2, nRamp)).slice(0, nRamp);
    communeLabels = communeRamp.map((_, i) => (i === 0 ? 'moins de ' + fmtVal(cuts[0] === undefined ? 0 : cuts[0]) : i === cuts.length ? fmtVal(cuts[i - 1]) + ' et plus' : fmtVal(cuts[i - 1]) + ' – ' + fmtVal(cuts[i])));
    for (let c = 0; c < val.length; c++) communeClass[c] = communeCount[c] > 0 ? Math.min(d3.bisectRight(cuts, val[c]), nRamp - 1) : 255;
  }

  // ── drawing ──────────────────────────────────────────────────────────────
  function drawCommunes(al) {
    const cv = $('commune-canvas'), ctx = cv.getContext('2d');
    ctx.clearRect(0, 0, base.w, base.h);
    visCommunes = [];
    if (!G) { ensureGeometry(); return; }
    const dpr = window.devicePixelRatio || 1, k = tf.k, a = k * base.s, bx = tf.x + k * base.ox, by = tf.y + k * base.oy;
    const vx0 = -bx / a, vy0 = -by / a, vx1 = (base.w - bx) / a, vy1 = (base.h - by) / a;
    const tr = (v) => Math.max(0, Math.min(TILE_N - 1, Math.floor(v / TILE)));
    const tx0 = tr(vx0) - 1, tx1 = tr(vx1) + 1, ty0 = tr(vy0) - 1, ty1 = tr(vy1) + 1;
    const buckets = new Map(), stamp = ++comStamp, cb = G.cbox;
    for (let ty = Math.max(0, ty0); ty <= Math.min(TILE_N - 1, ty1); ty++) for (let tx = Math.max(0, tx0); tx <= Math.min(TILE_N - 1, tx1); tx++) {
      for (const c of G.tcom[ty * TILE_N + tx]) {
        if (G.stamp[c] === stamp) continue;
        G.stamp[c] = stamp;
        if (cb[c * 4] > vx1 || cb[c * 4 + 2] < vx0 || cb[c * 4 + 1] > vy1 || cb[c * 4 + 3] < vy0) continue;
        const cl = communeClass[c];
        let b = buckets.get(cl); if (!b) buckets.set(cl, b = []);
        b.push(c);
        visCommunes.push({ ci: c, x0: bx + a * cb[c * 4], y0: by + a * cb[c * 4 + 1], x1: bx + a * cb[c * 4 + 2], y1: by + a * cb[c * 4 + 3] });
      }
    }
    ctx.setTransform(a * dpr, 0, 0, a * dpr, bx * dpr, by * dpr);
    ctx.globalAlpha = 1 - 0.55 * al.dotA;                                   // the colour recedes once places are drawn on top
    buckets.forEach((list, cl) => { ctx.fillStyle = cl === 255 ? COL_ZERO : communeRamp[cl]; for (const c of list) ctx.fill(G.path(c), 'evenodd'); });
    ctx.globalAlpha = 1; ctx.lineJoin = 'round';
    for (let kcls = 0; kcls < 4; kcls++) {                                  // fine lines first, coarse lines on top
      ctx.strokeStyle = BORDER[kcls][0]; ctx.lineWidth = BORDER[kcls][1] / a;
      for (let ty = Math.max(0, ty0); ty <= Math.min(TILE_N - 1, ty1); ty++) for (let tx = Math.max(0, tx0); tx <= Math.min(TILE_N - 1, tx1); tx++) ctx.stroke(G.tile(ty * TILE_N + tx, kcls));
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  // commune under a screen point (bounding box then even-odd test on the ring vertices), or -1
  function communeAt(mx, my) {
    if (!G) return -1;
    const k = tf.k, a = k * base.s, vx = (mx - (tf.x + k * base.ox)) / a, vy = (my - (tf.y + k * base.oy)) / a;
    const t = Math.max(0, Math.min(TILE_N - 1, Math.floor(vy / TILE))) * TILE_N + Math.max(0, Math.min(TILE_N - 1, Math.floor(vx / TILE)));
    for (const c of G.tcom[t]) {
      const b = G.cbox;
      if (vx < b[c * 4] || vx > b[c * 4 + 2] || vy < b[c * 4 + 1] || vy > b[c * 4 + 3]) continue;
      G.path(c);
      let inside = false;
      for (const [xs, ys] of G.pts.get(c)) {
        for (let i = 0, j = xs.length - 1; i < xs.length; j = i++) {
          if ((ys[i] > vy) !== (ys[j] > vy) && vx < (xs[j] - xs[i]) * (vy - ys[i]) / (ys[j] - ys[i]) + xs[i]) inside = !inside;
        }
      }
      if (inside) return c;
    }
    return -1;
  }

  function strokeCommune(ctx, ci) {                       // outline of one commune, drawn on the label canvas for the hover highlight
    if (!G) return;
    const dpr = window.devicePixelRatio || 1, k = tf.k, a = k * base.s;
    ctx.save();
    ctx.setTransform(a * dpr, 0, 0, a * dpr, (tf.x + k * base.ox) * dpr, (tf.y + k * base.oy) * dpr);
    ctx.lineWidth = 2.4 / a; ctx.strokeStyle = '#111'; ctx.lineJoin = 'round';
    ctx.stroke(G.path(ci));
    ctx.restore();
  }

  function showCommuneTip(ci, mx, my) {
    const n = communeCount[ci], area = COM.area[ci], pop = COM.pop[ci];
    const head = '<strong>' + esc(COM.names[ci]) + '</strong> <span class="muted">(' + esc(COM.dep[ci]) + ') · ' + fmt(pop) + ' hab. · ' + fmtVal(area) + ' km²</span><br>';
    if (!n) { tipKey = ''; $('map-tooltip').innerHTML = head + 'Aucune observation'; placeTip(mx, my); return; }
    withTop('m' + ci, { kind: 'sites', list: communeSites[ci] }, (r) => {
      $('map-tooltip').innerHTML = head + fmt(n) + ' observations <span class="muted">(' + fmtVal(n / Math.max(area, 0.05)) + ' / km²)</span>' +
        (r ? ' · ' + fmt(r.distinct) + ' espèces<br>' + listHtml(r.top) : '<br>' + topPending) +
        '<br><span class="muted">Clic : filtrer sur cette commune</span>';
      placeTip(mx, my);
    });
  }

  // ── "Aller à une commune" search box (map corner) ────────────────────────────
  function initCommuneSearch() {
    const input = $('commune-search'), list = $('commune-results');
    if (!input) return;
    let timer = 0, cur = [];
    const close = () => { list.classList.add('hidden'); list.innerHTML = ''; cur = []; input.setAttribute('aria-expanded', 'false'); };
    const go = (ci) => { close(); input.value = ''; input.blur(); goToCommune(ci); };
    const run = () => {
      const Q = FMAP_CORE.parseQuery(input.value);
      if (!Q.key) { close(); return; }
      const res = [];
      for (let c = 0; c < comKeys.length; c++) {
        const key = comKeys[c];
        if (key === Q.key) res.push([0, c]); else if (key.startsWith(Q.key)) res.push([1, c]);
        else if (Q.words.every((w) => key.split(' ').some((x) => x.startsWith(w)))) res.push([2, c]);
      }
      res.sort((p, q) => p[0] - q[0] || COM.pop[q[1]] - COM.pop[p[1]]);
      cur = res.slice(0, 8).map((r) => r[1]);
      list.innerHTML = cur.map((c, i) => '<li role="option" data-c="' + c + '"' + (i === 0 ? ' class="on"' : '') + '>' + esc(COM.names[c]) + ' <span>' + esc(COM.dep[c]) + ' · ' + fmt(COM.pop[c]) + ' hab.</span></li>').join('') || '<li class="none">Aucune commune</li>';
      list.classList.remove('hidden'); input.setAttribute('aria-expanded', 'true');
    };
    input.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(run, 90); });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); clearTimeout(timer); run(); if (cur.length) go(cur[0]); }
      else if (e.key === 'Escape') { input.value = ''; close(); e.stopPropagation(); }
    });
    list.addEventListener('mousedown', (e) => { const li = e.target.closest('li[data-c]'); if (li) { e.preventDefault(); go(+li.dataset.c); } });
    input.addEventListener('blur', () => setTimeout(close, 120));
  }

  // fly to a commune and filter on it
  function goToCommune(ci) { state.commune = -1; pickCommune(ci); }
