  // ═══════════════════════════════════════════════════════════════════════════
  // "Autour de moi" (issue #14): where am I, what has been seen within a radius around that point at this time of year,
  // where to go for it, and (optionally, online) how wet the last three days were.
  //   · the position comes from the browser (geolocation) or from a click on the map; it never leaves the page, is not
  //     stored and is not put in the shareable link;
  //   · the ranking is computed by the record engine (engine.nearby) from the sites inside the radius;
  //   · the humidity check is the only network call of this panel: it needs a click, sends the position rounded to
  //     about 1 km to open-meteo.com and is absent offline (ADR-11).
  // ═══════════════════════════════════════════════════════════════════════════
  const NEAR = {
    me: null,                       // { lon, lat, src: 'gps' | 'map', acc }
    radius: 25, edible: 0, view: 'species', species: -1, limit: 40,
    date: null,                     // 'YYYY-MM-DD'
    sites: null, res: null, tok: 0, placing: false, wx: null, wxState: 'idle',
  };
  let siteLon = null, siteLat = null, meCircle = null;
  const FRANCE_BOX = [-5.6, 41.0, 10.0, 51.6];

  const todayStr = () => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
  const parseDate = (s) => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || ''); return m ? { y: +m[1], m: +m[2], d: +m[3] } : null; };
  const longDate = (s) => { const p = parseDate(s); return p ? new Date(p.y, p.m - 1, p.d).toLocaleDateString(LANG === 'en' ? 'en-GB' : 'fr-FR', { day: 'numeric', month: 'long' }) : ''; };

  function sitesGeo() {
    if (siteLon) return;
    const S = META.sites || { lon: [], lat: [] }, kx = (META.lon_max - META.lon_min) / Q_MAX, ky = (META.lat_max - META.lat_min) / Q_MAX;
    siteLon = new Float32Array(S.lon.length); siteLat = new Float32Array(S.lat.length);
    for (let k = 0; k < S.lon.length; k++) { siteLon[k] = META.lon_min + S.lon[k] * kx; siteLat[k] = META.lat_min + S.lat[k] * ky; }
  }

  function nearMessage(text, kind) {
    const el = $('np-msg');
    el.textContent = tr(text || ''); el.classList.toggle('hidden', !text); el.dataset.kind = kind || 'info';
  }

  // ── location ───────────────────────────────────────────────────────────────
  function setMe(lon, lat, src, acc) {
    NEAR.me = { lon, lat, src, acc: acc || 0 }; NEAR.wx = null; NEAR.wxState = 'idle'; NEAR.species = -1; NEAR.limit = 40;
    const g = d3.geoCircle().center([lon, lat]).radius(NEAR.radius / EARTH_R_KM * 180 / Math.PI)();
    meCircle = { geo: g, path: new Path2D() }; d3.geoPath(projection, meCircle.path)(g);
    const out = lon < FRANCE_BOX[0] || lon > FRANCE_BOX[2] || lat < FRANCE_BOX[1] || lat > FRANCE_BOX[3];
    nearMessage(out ? 'Ce point est hors de la France métropolitaine : les données ne la couvrent pas.' : '', 'warn');
    paintNearLoc(); renderWeather(); labelKey = ''; requestDraw();
    const b = pathGen.bounds(g); if (!out) flyTo(b[0][0], b[0][1], b[1][0], b[1][1]);
    refreshNearby();
  }
  function clearMe() { NEAR.me = null; meCircle = null; NEAR.res = null; NEAR.sites = null; paintNearLoc(); renderWeather(); renderNear(); labelKey = ''; requestDraw(); }
  function paintNearLoc() {
    const m = NEAR.me, el = $('np-loc');
    if (!m) { el.textContent = tr('Aucun point choisi.'); return; }
    const lat = m.lat.toFixed(3).replace('.', ','), lon = m.lon.toFixed(3).replace('.', ',');
    el.textContent = tr(m.src === 'gps' ? 'Votre position' : 'Point choisi sur la carte') + ' · ' + lat + ' N, ' + lon + ' E' + (m.acc ? ' · ± ' + fmt(Math.round(m.acc)) + ' m' : '');
  }

  function locate() {
    if (!navigator.geolocation) { nearMessage('La localisation n’est pas disponible dans ce navigateur : choisissez un point sur la carte.', 'warn'); return; }
    const b = $('np-geo'); b.disabled = true; b.classList.add('busy'); nearMessage('Localisation en cours…', 'info');
    navigator.geolocation.getCurrentPosition((p) => {
      b.disabled = false; b.classList.remove('busy'); nearMessage('', 'info');
      setMe(p.coords.longitude, p.coords.latitude, 'gps', p.coords.accuracy);
    }, (err) => {
      b.disabled = false; b.classList.remove('busy');
      nearMessage(err && err.code === 1 ? 'Localisation refusée. Autorisez-la dans votre navigateur ou choisissez un point sur la carte.'
        : 'Position introuvable pour le moment. Choisissez un point sur la carte.', 'warn');
    }, { enableHighAccuracy: false, timeout: 12000, maximumAge: 300000 });
  }

  function setPlacing(on) {
    NEAR.placing = on; $('np-pick').setAttribute('aria-pressed', on ? 'true' : 'false'); $('np-pick').classList.toggle('on', on);
    $('pick-tag').classList.toggle('hidden', !on); $('map-container').classList.toggle('placing', on);
  }
  // called first by onMapClick: while placing, the next click on the map chooses the point
  function placeAt(e) {
    const box = $('map-container').getBoundingClientRect(), k = tf.k, a = k * base.s;
    const ll = projection.invert([(e.clientX - box.left - (tf.x + k * base.ox)) / a, (e.clientY - box.top - (tf.y + k * base.oy)) / a]);
    setPlacing(false);
    if (ll) setMe(ll[0], ll[1], 'map', 0);
  }

  // marker and radius, drawn on the label canvas (above every other layer)
  function drawMe(ctx) {
    if (!NEAR.me || !meCircle) return;
    const dpr = window.devicePixelRatio || 1, k = tf.k, a = k * base.s, bx = tf.x + k * base.ox, by = tf.y + k * base.oy;
    ctx.save();
    ctx.setTransform(a * dpr, 0, 0, a * dpr, bx * dpr, by * dpr); ctx.lineJoin = 'round';
    ctx.fillStyle = 'rgba(29,78,170,.07)'; ctx.fill(meCircle.path);
    ctx.lineWidth = 4.2 / a; ctx.strokeStyle = 'rgba(255,255,255,.92)'; ctx.stroke(meCircle.path);
    ctx.setLineDash([7 / a, 5 / a]); ctx.lineWidth = 2 / a; ctx.strokeStyle = '#1d4eaa'; ctx.stroke(meCircle.path);
    ctx.restore();
    const p = projection([NEAR.me.lon, NEAR.me.lat]), x = bx + a * p[0], y = by + a * p[1];
    ctx.beginPath(); ctx.arc(x, y, 10, 0, 6.2832); ctx.fillStyle = 'rgba(29,78,170,.22)'; ctx.fill();
    ctx.beginPath(); ctx.arc(x, y, 5.5, 0, 6.2832); ctx.fillStyle = '#1d4eaa'; ctx.fill(); ctx.lineWidth = 2; ctx.strokeStyle = '#fff'; ctx.stroke();
  }

  // ── what and where ─────────────────────────────────────────────────────────
  async function refreshNearby() {
    const tok = ++NEAR.tok;
    if (!NEAR.me) { renderNear(); return; }
    sitesGeo();
    const dt = parseDate(NEAR.date) || parseDate(todayStr());
    NEAR.sites = FMAP_CORE.sitesWithin(siteLon, siteLat, NEAR.me.lon, NEAR.me.lat, NEAR.radius);
    const q = { sites: NEAR.sites.idx, weights: FMAP_CORE.seasonWeights(dt.y, dt.m, dt.d), edible: NEAR.edible, species: NEAR.species };
    const res = await engine.nearby(q);
    if (tok !== NEAR.tok) return;                                  // a newer question superseded this one
    NEAR.res = res; renderNear();
  }

  const compassFr = (deg) => { const c = FMAP_CORE.compass(deg); return LANG === 'en' ? c.replace('O', 'W') : c; };

  function renderNear() {
    const list = $('np-list'), more = $('np-more'), sum = $('np-sum'), R = NEAR.res, m = NEAR.me;
    document.querySelectorAll('#seg-near-view button').forEach((b) => b.classList.toggle('on', b.dataset.v === NEAR.view));
    $('np-h-res').textContent = tr(NEAR.view === 'places' && NEAR.species >= 0 ? 'Où le trouver ?' : NEAR.view === 'places' ? 'Où aller ?' : 'Que trouver ?');
    more.classList.add('hidden');
    if (!m) { sum.textContent = ''; list.innerHTML = '<p class="np-empty">' + esc(tr('Choisissez un point : vous verrez quels champignons ont été observés près de lui à cette époque de l’année, et où.')) + '</p>'; return; }
    if (!R) { sum.textContent = tr('Calcul…'); list.innerHTML = ''; return; }
    const when = longDate(NEAR.date || todayStr());
    if (R.total === 0) {
      sum.textContent = '';
      list.innerHTML = '<p class="np-empty">' + esc(tr('Aucune observation dans ce rayon : augmentez-le ou choisissez un autre point.')) + '</p>'; return;
    }
    sum.textContent = fmt(Math.round(R.totalSeason)) + ' ' + tr('observations autour du') + ' ' + when + ' · ' + fmt(R.total) + ' ' + tr('en tout') + ' · ' + tr('rayon') + ' ' + NEAR.radius + ' km';
    if (NEAR.view === 'places') renderPlaces(list, more, R); else renderSpeciesList(list, more, R);
  }

  function renderSpeciesList(list, more, R) {
    const L = DICT.species.length, seasonal = R.totalSeason >= 1, idx = [];
    for (let s = 0; s < L; s++) if (seasonal ? R.season[s] >= 0.5 : R.all[s] > 0) idx.push(s);
    idx.sort((p, q) => (seasonal ? R.season[q] - R.season[p] : 0) || R.all[q] - R.all[p] || p - q);
    const top = idx.slice(0, NEAR.limit), max = seasonal && top.length ? R.season[top[0]] : (top.length ? R.all[top[0]] : 1);
    const head = seasonal ? '' : '<p class="np-empty">' + esc(tr('Rien n’a été noté à cette époque dans ce rayon : voici les espèces vues dans l’année.')) + '</p>';
    list.innerHTML = head + top.map((s) => {
      const n = seasonal ? Math.round(R.season[s]) : R.all[s], pct = Math.max(4, Math.round(100 * (seasonal ? R.season[s] : R.all[s]) / max)), sel = NEAR.species === s;
      const fr = showsFrench(s), fam = spFamily[s] !== MISSING ? DICT.family[spFamily[s]] : '', E = EDI[ediOf[s]];
      return '<div class="np-row-sp' + (sel ? ' sel' : '') + '" role="button" tabindex="0" data-s="' + s + '" aria-pressed="' + sel + '" title="' + esc(E.label) + '">' +
        '<span class="sp-badge" aria-hidden="true" style="background:' + E.colour + ';color:' + E.ink + '"><i>' + E.icon + '</i></span>' +
        '<span class="sp-main"><em class="sp-name' + (fr ? '' : ' latin') + '">' + esc(displayName(s)) + '</em><small class="sp-fam">' + (fr ? '<i>' + esc(DICT.species[s]) + '</i>' : '') + (fr && fam ? ' · ' : '') + esc(fam) + '</small><span class="sr-only"> — ' + esc(E.label) + '</span>' +
        '<span class="np-bar" aria-hidden="true"><i style="width:' + pct + '%"></i></span></span>' +
        '<span class="np-n"><b>' + fmt(n) + '</b><small>' + (seasonal ? fmt(R.all[s]) + ' ' + esc(tr('au total')) : esc(tr('observations'))) + '</small></span></div>';
    }).join('');
    if (idx.length > top.length) { more.classList.remove('hidden'); more.textContent = tr('Voir plus') + ' (' + fmt(idx.length - top.length) + ' ' + tr('restantes') + ')'; }
  }

  function renderPlaces(list, more, R) {
    const S = NEAR.sites, rows = [];
    for (let i = 0; i < S.idx.length; i++) { const s = S.idx[i], v = R.siteSeason[s], all = R.siteAll[s]; if (all > 0) rows.push({ s, v, all, d: S.dist[i], b: S.bearing[i] }); }
    const seasonal = R.siteSeason ? rows.some((r) => r.v >= 0.5) : false;
    rows.sort((p, q) => (seasonal ? q.v - p.v : 0) || q.all - p.all || p.d - q.d);
    const top = rows.slice(0, Math.min(NEAR.limit, 25));
    const head = NEAR.species >= 0 ? '<p class="np-pick">' + nameHtml(NEAR.species) + ' <button type="button" class="np-link" id="np-unpick">' + esc(tr('Retirer')) + '</button></p>' : '';
    if (!top.length) { list.innerHTML = head + '<p class="np-empty">' + esc(tr('Aucun lieu avec une position précise dans ce rayon.')) + '</p>'; return; }
    const max = seasonal ? top[0].v : top[0].all;
    list.innerHTML = head + top.map((r) => {
      const name = siteName[siteLoc[r.s]] || '', ci = siteCommune[r.s], com = ci >= 0 ? COM.names[ci] + ' (' + COM.dep[ci] + ')' : '';
      const title = name && com && name.toLowerCase() !== COM.names[ci].toLowerCase() ? name : (com || name || tr('Lieu sans nom'));
      const sub = (name && com && title === name ? com + ' · ' : '') + fmt(Math.round(r.d)) + ' km ' + compassFr(r.b) + (siteApprox[r.s] ? ' · ' + tr('centre de commune') : '');
      const n = seasonal ? Math.round(r.v) : r.all, pct = Math.max(4, Math.round(100 * (seasonal ? r.v : r.all) / max));
      return '<div class="np-row-pl" role="button" tabindex="0" data-s="' + r.s + '"><span class="np-pin" aria-hidden="true"></span>' +
        '<span class="sp-main"><span class="sp-name">' + esc(title) + '</span><small class="sp-fam">' + esc(sub) + '</small><span class="np-bar" aria-hidden="true"><i style="width:' + pct + '%"></i></span></span>' +
        '<span class="np-n"><b>' + fmt(n) + '</b><small>' + (seasonal ? fmt(r.all) + ' ' + esc(tr('au total')) : esc(tr('observations'))) + '</small></span></div>';
    }).join('');
    if (rows.length > top.length) { more.classList.remove('hidden'); more.textContent = tr('Voir plus') + ' (' + fmt(rows.length - top.length) + ' ' + tr('restantes') + ')'; }
  }

  // choose a species from the list: filter the map on it and list the places where it was seen near the point
  function pickNearSpecies(s) {
    NEAR.species = NEAR.species === s ? -1 : s;
    if (NEAR.species >= 0) { setSpecies([s], displayName(s)); openSpecies(s, false); NEAR.view = 'places'; }
    else { clearSpecies(); closeDrawer(); }
    scheduleUpdate(); refreshNearby();
  }
  function goToSite(s) {
    sitesGeo();
    const x = sitePX[s], y = sitePY[s]; flyTo(x - 3, y - 3, x + 3, y + 3);
  }

  // ── recent weather (online, on demand) ───────────────────────────────────────
  const isToday = () => (NEAR.date || todayStr()) === todayStr();
  async function checkWeather() {
    if (!NEAR.me) return;
    NEAR.wxState = 'loading'; renderWeather();
    const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), 10000);
    try {
      const r = await fetch(FMAP_CORE.weatherUrl(NEAR.me.lat, NEAR.me.lon), { signal: ctl.signal });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      NEAR.wx = FMAP_CORE.assessWeather(await r.json(), Date.now()); NEAR.wxState = 'ok';
    } catch (e) { NEAR.wx = null; NEAR.wxState = 'error'; console.warn('Météo :', e && e.message); }
    clearTimeout(timer); renderWeather();
  }

  const WX_REASON = {
    'rain14:high': (w) => fmt(Math.round(w.rain14)) + ' mm de pluie en 14 jours : sol bien arrosé', 'rain14:some': (w) => fmt(Math.round(w.rain14)) + ' mm de pluie en 14 jours : pluie modérée',
    'rain14:low': (w) => fmt(Math.round(w.rain14)) + ' mm de pluie en 14 jours : très sec', 'rain3:recent': (w) => fmt(Math.round(w.rain3)) + ' mm tombés ces 3 derniers jours',
    'rh:humid': (w) => 'Air humide (' + Math.round(w.rh3) + ' %)', 'rh:dry': (w) => 'Air sec (' + Math.round(w.rh3) + ' %)',
    'temp:mild': (w) => 'Températures douces (' + Math.round(w.temp3) + ' °C en moyenne)', 'temp:cold': (w) => 'Gel ou grand froid (' + Math.round(w.temp3) + ' °C en moyenne)', 'temp:hot': (w) => 'Forte chaleur (' + Math.round(w.temp3) + ' °C en moyenne)',
  };
  const WX_LEVEL = { good: 'Conditions plutôt favorables', mid: 'Conditions moyennes', low: 'Conditions peu favorables' };

  function renderWeather() {
    const el = $('np-wx'), w = NEAR.wx;
    if (!NEAR.me) { el.innerHTML = '<p class="np-empty">' + esc(tr('Choisissez d’abord un point.')) + '</p>'; return; }
    if (!isToday()) { el.innerHTML = '<p class="np-empty">' + esc(tr('L’humidité récente n’est disponible que pour aujourd’hui : remettez la date du jour.')) + '</p>'; return; }
    if (NEAR.wxState === 'loading') { el.innerHTML = '<p class="np-empty">' + esc(tr('Vérification en cours…')) + '</p>'; return; }
    if (NEAR.wxState !== 'ok' || !w) {
      el.innerHTML = (NEAR.wxState === 'error' ? '<p class="np-msg" data-kind="warn">' + esc(tr('Impossible de joindre le service météo (hors ligne ?). Le reste du panneau fonctionne sans connexion.')) + '</p>' : '') +
        '<button type="button" id="np-wx-btn" class="np-btn">' + esc(tr('Vérifier l’humidité')) + '</button>' +
        '<p class="np-note">' + esc(tr('Un clic envoie la position, arrondie à 1 km près, à open-meteo.com (service météo en ligne). Rien n’est envoyé sinon.')) + '</p>';
      return;
    }
    const tile = (v, u, l) => '<div class="np-tile"><b>' + v + '<small>' + u + '</small></b><span>' + esc(tr(l)) + '</span></div>';
    const mx = Math.max(5, ...w.days.map((d) => d.mm)), BW = 280 / w.days.length;
    const bars = w.days.map((d, i) => { const h = Math.round(46 * d.mm / mx); return '<rect x="' + (i * BW + 2).toFixed(1) + '" y="' + (50 - h) + '" width="' + (BW - 4).toFixed(1) + '" height="' + Math.max(h, d.mm > 0 ? 1 : 0) + '" rx="1.5"><title>' + esc(longDate(d.date)) + ' : ' + d.mm.toString().replace('.', ',') + ' mm</title></rect>'; }).join('');
    el.innerHTML = '<div class="np-verdict ' + w.level + '"><b>' + esc(tr(WX_LEVEL[w.level])) + '</b><ul>' + w.reasons.map((r) => '<li>' + esc(tr(WX_REASON[r[0] + ':' + r[1]](w))) + '</li>').join('') + '</ul></div>' +
      '<div class="np-tiles">' + tile(w.rain3.toFixed(1).replace('.', ','), ' mm', 'Pluie, 3 jours') + tile(w.rh3 === null ? '–' : Math.round(w.rh3), ' %', 'Humidité de l’air') +
      tile(w.soil3 === null ? '–' : Math.round(w.soil3), ' %', 'Humidité du sol') + tile(w.temp3 === null ? '–' : Math.round(w.temp3), ' °C', 'Température') + '</div>' +
      '<div class="np-chart"><span>' + esc(tr('Pluie par jour, 14 derniers jours')) + ' (max ' + mx.toFixed(0) + ' mm)</span><svg viewBox="0 0 280 52" role="img" aria-label="' + esc(tr('Pluie par jour, 14 derniers jours')) + '"><line x1="0" y1="50.5" x2="280" y2="50.5"/>' + bars + '</svg></div>' +
      '<p class="np-note">' + esc(tr('Indication simple, pas un modèle validé : les champignons sortent souvent quelques jours à quelques semaines après des pluies, par temps doux. Source : Open-Meteo.')) + ' <button type="button" id="np-wx-btn" class="np-link">' + esc(tr('Actualiser')) + '</button></p>';
  }

  // ── wiring ───────────────────────────────────────────────────────────────────
  function initNearby() {
    NEAR.date = todayStr(); $('np-date').value = NEAR.date;
    $('np-geo').addEventListener('click', locate);
    $('np-pick').addEventListener('click', () => { setPlacing(!NEAR.placing); if (NEAR.placing) { showTab('near'); ensureSidebar(); } });
    $('pick-cancel').addEventListener('click', () => setPlacing(false));
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && NEAR.placing) { setPlacing(false); e.stopPropagation(); } }, true);
    $('np-date').addEventListener('change', () => { if (parseDate($('np-date').value)) { NEAR.date = $('np-date').value; renderWeather(); refreshNearby(); } });
    $('np-today').addEventListener('click', () => { NEAR.date = todayStr(); $('np-date').value = NEAR.date; renderWeather(); refreshNearby(); });
    const seg = (id, fn) => $(id).addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b) return; document.querySelectorAll('#' + id + ' button').forEach((x) => x.classList.toggle('on', x === b)); fn(b.dataset.v); });
    seg('seg-radius', (v) => {
      NEAR.radius = +v; NEAR.limit = 40;
      if (NEAR.me) { const g = d3.geoCircle().center([NEAR.me.lon, NEAR.me.lat]).radius(NEAR.radius / EARTH_R_KM * 180 / Math.PI)(); meCircle = { geo: g, path: new Path2D() }; d3.geoPath(projection, meCircle.path)(g); labelKey = ''; requestDraw(); const b = pathGen.bounds(g); flyTo(b[0][0], b[0][1], b[1][0], b[1][1]); }
      refreshNearby();
    });
    seg('seg-near-edible', (v) => { NEAR.edible = +v; NEAR.limit = 40; refreshNearby(); });
    seg('seg-near-view', (v) => { NEAR.view = v; NEAR.limit = 40; renderNear(); });
    $('np-more').addEventListener('click', () => { NEAR.limit += 40; renderNear(); });
    const act = (e) => {
      const sp = e.target.closest('.np-row-sp'), pl = e.target.closest('.np-row-pl');
      if (e.target.closest('#np-unpick')) { pickNearSpecies(NEAR.species); return; }
      if (sp) pickNearSpecies(+sp.dataset.s); else if (pl) goToSite(+pl.dataset.s);
    };
    $('np-list').addEventListener('click', act);
    $('np-list').addEventListener('keydown', (e) => { if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('[role=button]')) { e.preventDefault(); act(e); } });
    $('np-wx').addEventListener('click', (e) => { if (e.target.closest('#np-wx-btn')) checkWeather(); });
    renderNear(); renderWeather();
  }
