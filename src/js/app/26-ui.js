  // ═══════════════════════════════════════════════════════════════════════════
  // Interface: active-filter bar, shareable URL, exports (PNG / CSV / link), keyboard map, live announcements
  // ═══════════════════════════════════════════════════════════════════════════
  let bootDone = false, applyingHash = false;

  // ── active filters, all in one place ──────────────────────────────────────
  function activeFilters() {
    const f = [];
    if (state.speciesSet.size) f.push({ title: 'Espèce', label: state.speciesLabel || (state.speciesSet.size + ' espèces'), clear() { clearSpecies(); closeDrawer(); } });
    if (state.commune >= 0) f.push({ title: 'Commune', label: communeLabel(state.commune), clear() { state.commune = -1; } });
    state.deptSet.forEach((di) => f.push({ title: 'Département', label: deptName(di), clear() { state.deptSet.delete(di); } }));
    if (state.yearMin > 0) f.push({ title: 'Période', label: state.yearMin + '–' + state.yearMax, clear() { state.yearMin = 0; state.yearMax = 0; $('year-min').value = YEAR_LO; $('year-max').value = YEAR_HI; } });
    Array.from(state.monthSet).sort((a, b) => a - b).forEach((m) => f.push({ title: 'Mois', label: MONTHS[m - 1], clear() { state.monthSet.delete(m); } }));
    if (state.edible) f.push({ title: 'Comestibilité', label: state.edible === 1 ? 'Comestibles' : 'Toxiques', clear() { state.edible = 0; } });
    chipRefs.forEach(({ refs, set }) => refs.forEach(({ g }) => { if (g.idx.length && g.idx.every((i) => set.has(i))) f.push({ title: 'Filtre', label: g.label, clear() { toggleGroup(set, g); } }); }));
    return f;
  }
  function renderFilterBar() {
    const bar = $('filter-bar'), list = activeFilters();
    bar.classList.toggle('hidden', list.length === 0);
    bar.textContent = '';
    list.forEach((f) => {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'fchip'; b.title = f.title + ' : retirer ce filtre';
      b.setAttribute('aria-label', f.title + ' ' + f.label + ' : retirer ce filtre');
      const s = document.createElement('span'); s.textContent = f.label; b.appendChild(s);
      const x = document.createElement('i'); x.setAttribute('aria-hidden', 'true'); x.textContent = '×'; b.appendChild(x);
      b.addEventListener('click', () => { f.clear(); scheduleUpdate(); });
      bar.appendChild(b);
    });
    if (list.length > 1) {
      const r = document.createElement('button'); r.type = 'button'; r.className = 'fchip clear'; r.textContent = 'Tout réinitialiser';
      r.addEventListener('click', resetAll); bar.appendChild(r);
    }
  }

  // ── screen-reader announcement of the result count (debounced: the headline animates) ───
  let liveTimer = 0;
  function liveAnnounce(a) {
    clearTimeout(liveTimer);
    liveTimer = setTimeout(() => { $('live').textContent = fmt(a.total) + ' observations, ' + fmt(a.nSpecies) + ' espèces, ' + a.nDepts + ' départements.'; }, 700);
  }

  // ── shareable view (URL hash) ────────────────────────────────────────────
  function viewModel() {
    const m = FMAP_CORE.defaultViewState();
    if (state.speciesSet.size && state.speciesSet.size <= 30) m.sp = Array.from(state.speciesSet).map((i) => DICT.species[i]).filter(Boolean);
    else if (state.speciesSet.size) m.q = BR.query;
    m.m = Array.from(state.monthSet).sort((a, b) => a - b);
    m.d = Array.from(state.deptSet).map((i) => DICT.dept[i]);
    if (state.yearMin > 0) m.y = [state.yearMin, state.yearMax];
    if (state.commune >= 0 && COM.code) m.c = COM.code[state.commune];
    m.e = state.edible;
    m.g = Array.from(state.guildSet).map((i) => DICT.guild[i]).filter(Boolean);
    m.ph = Array.from(state.phylumSet).map((i) => DICT.phylum[i]).filter(Boolean);
    m.tr = Array.from(state.trophicSet).map((i) => DICT.trophic[i]).filter(Boolean);
    m.ec = Array.from(state.ecoregionSet).map((i) => DICT.ecoregion[i]).filter(Boolean);
    const k = tf.k, a = k * base.s, bx = tf.x + k * base.ox, by = tf.y + k * base.oy;
    if (k > 1.05) { const ll = projection.invert([(base.w / 2 - bx) / a, (base.h / 2 - by) / a]); if (ll) m.v = [ll[0], ll[1], k]; }
    m.l = layerMode; m.mt = metric; m.n = namePref;
    return m;
  }
  let hashTimer = 0;
  function scheduleHash() {
    if (!bootDone || applyingHash) return;
    clearTimeout(hashTimer);
    hashTimer = setTimeout(() => {
      try { const s = FMAP_CORE.encodeState(viewModel()); history.replaceState(null, '', s ? '#' + s : location.pathname + location.search); } catch (e) { /* history blocked: the link just is not updated */ }
    }, 400);
  }
  // restore filters and view from a hash; returns true when something was applied
  function applyHash(str) {
    const m = FMAP_CORE.decodeState(str);
    const none = JSON.stringify(m) === JSON.stringify(FMAP_CORE.defaultViewState());
    if (none) return false;
    applyingHash = true;
    resetFilters(); closeDrawer();
    const idxOf = (dict, names) => names.map((n) => dict.indexOf(n)).filter((i) => i >= 0);
    const sp = idxOf(DICT.species, m.sp);
    if (sp.length) setSpecies(sp, sp.length === 1 ? displayName(sp[0]) : '« ' + sp.length + ' espèces »');
    if (m.q) { $('search-species').value = m.q; BR.query = m.q; }
    m.m.forEach((x) => state.monthSet.add(x));
    idxOf(DICT.dept, m.d).forEach((i) => state.deptSet.add(i));
    if (m.y) { state.yearMin = Math.max(YEAR_LO, m.y[0]); state.yearMax = Math.min(YEAR_HI, m.y[1]); $('year-min').value = state.yearMin; $('year-max').value = state.yearMax; }
    if (m.c && COM.code) { const ci = COM.code.indexOf(m.c); if (ci >= 0) state.commune = ci; }
    state.edible = m.e;
    idxOf(DICT.guild, m.g).forEach((i) => state.guildSet.add(i));
    idxOf(DICT.phylum, m.ph).forEach((i) => state.phylumSet.add(i));
    idxOf(DICT.trophic, m.tr).forEach((i) => state.trophicSet.add(i));
    idxOf(DICT.ecoregion, m.ec).forEach((i) => state.ecoregionSet.add(i));
    if (METRICS[m.mt]) { metric = m.mt; $('sel-metric').value = m.mt; }
    if (['auto', 'dept', 'grid', 'communes', 'sites'].indexOf(m.l) >= 0) setLayerMode(m.l);
    if (m.n && m.n !== namePref) setNamePref(m.n);
    if (m.v) {
      const p = projection([m.v[0], m.v[1]]), cx = base.ox + base.s * p[0], cy = base.oy + base.s * p[1];
      mapSvg.call(zoom.transform, d3.zoomIdentity.translate(base.w / 2 - m.v[2] * cx, base.h / 2 - m.v[2] * cy).scale(m.v[2]));
    }
    applyingHash = false;
    return true;
  }

  // ── exports ──────────────────────────────────────────────────────────────
  function download(blob, name) {
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 3000);
  }
  const stamp = () => new Date().toISOString().slice(0, 10);
  const SOURCE_LINE = 'FongiBase, Gautier et al. 2022, CC-BY 4.0 (doi:10.5281/zenodo.17158524)';

  // species of the current view as CSV (UTF-8 with BOM for spreadsheets); the source is repeated on every row
  function exportCSV() {
    const q = (v) => '"' + String(v).replace(/"/g, '""') + '"';
    const rows = [['nom_francais', 'nom_latin', 'famille', 'observations', 'comestibilite_indicative', 'source']];
    const idx = [];
    for (let s = 0; s < DICT.species.length; s++) if (lastAgg.bySpecies[s] > 0) idx.push(s);
    idx.sort((p, r) => lastAgg.bySpecies[r] - lastAgg.bySpecies[p] || p - r);
    idx.forEach((s) => rows.push([hasFr(s) ? frOf.get(s)[0] : '', DICT.species[s], spFamily[s] !== MISSING ? DICT.family[spFamily[s]] : '', lastAgg.bySpecies[s], EDI[ediOf[s]].label, SOURCE_LINE]));
    download(new Blob(['\uFEFF' + rows.map((r) => r.map(q).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8' }), 'fongimap-especes-' + stamp() + '.csv');
  }

  // PNG of the current map view with legend, active filters and attribution (composed offline from the page's own layers)
  async function exportPNG() {
    const W = base.w, H = base.h, S = 2, out = document.createElement('canvas');
    out.width = W * S; out.height = H * S;
    const ctx = out.getContext('2d');
    ctx.fillStyle = '#dfe7eb'; ctx.fillRect(0, 0, out.width, out.height);
    const svg = $('map-svg'), clone = svg.cloneNode(true), src = svg.querySelectorAll('*'), dst = clone.querySelectorAll('*');
    clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg'); clone.setAttribute('width', W); clone.setAttribute('height', H);
    src.forEach((el, i) => { const cs = getComputedStyle(el); ['fill', 'stroke', 'stroke-width', 'opacity', 'fill-opacity', 'stroke-opacity', 'stroke-linejoin'].forEach((p) => dst[i].style.setProperty(p, cs.getPropertyValue(p))); });
    const img = new Image();
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(new XMLSerializer().serializeToString(clone));
    await img.decode();
    ctx.drawImage(img, 0, 0, W * S, H * S);
    ['grid-canvas', 'commune-canvas', 'dot-canvas', 'label-canvas'].forEach((id) => {
      const c = $(id); ctx.globalAlpha = c.style.opacity === '' ? 1 : +c.style.opacity; ctx.drawImage(c, 0, 0, W * S, H * S);
    });
    ctx.globalAlpha = 1;
    // legend
    const lg = $('map-legend'), title = lg.querySelector('h5'), lis = Array.from(lg.querySelectorAll('li'));
    if (title && lis.length) {
      const lh = 18 * S, w = 232 * S, h = (30 + lis.length * 18) * S, x = 12 * S, y = (H - 12) * S - h - 24 * S;
      ctx.fillStyle = 'rgba(247,244,238,.95)'; ctx.strokeStyle = '#cdc9bc'; ctx.lineWidth = S; ctx.fillRect(x, y, w, h); ctx.strokeRect(x, y, w, h);
      ctx.fillStyle = '#2b2217'; ctx.font = '700 ' + 12 * S + 'px system-ui, sans-serif'; ctx.textBaseline = 'middle'; ctx.fillText(title.textContent, x + 10 * S, y + 14 * S, w - 20 * S);
      ctx.font = (11 * S) + 'px system-ui, sans-serif';
      lis.forEach((li, i) => {
        const sw = li.querySelector('i'), cy = y + (30 + i * 18) * S - 4 * S;
        if (sw) { ctx.fillStyle = getComputedStyle(sw).backgroundColor; if (sw.classList.contains('circ')) { ctx.beginPath(); ctx.arc(x + 17 * S, cy, 5 * S, 0, 6.2832); ctx.fill(); ctx.stroke(); } else ctx.fillRect(x + 10 * S, cy - 6 * S, 14 * S, 12 * S); }
        ctx.fillStyle = '#2b2217'; ctx.fillText(li.textContent.trim(), x + 32 * S, cy, w - 42 * S);
      });
    }
    // active filters + attribution band
    const filters = activeFilters().map((f) => f.label).join(' · ');
    ctx.fillStyle = 'rgba(255,255,255,.92)'; ctx.fillRect(0, (H - 22) * S, W * S, 22 * S);
    ctx.fillStyle = '#2b2217'; ctx.font = (10 * S) + 'px system-ui, sans-serif'; ctx.textBaseline = 'middle';
    ctx.fillText('FongiMap · ' + SOURCE_LINE + ' · limites IGN / Etalab · comestibilité indicative' + (filters ? ' · ' + filters : '') + ' · ' + stamp(), 8 * S, (H - 11) * S, (W - 16) * S);
    return new Promise((resolve) => out.toBlob((b) => { download(b, 'fongimap-' + stamp() + '.png'); resolve(b); }, 'image/png'));
  }

  async function copyLink() {
    try { history.replaceState(null, '', '#' + FMAP_CORE.encodeState(viewModel())); } catch (e) { /* ignore */ }
    const b = $('btn-copylink');
    try { await navigator.clipboard.writeText(location.href); b.textContent = 'Lien copié ✓'; }
    catch (e) { window.prompt('Copiez ce lien :', location.href); }
    setTimeout(() => { b.textContent = 'Copier le lien'; }, 2200);
  }

  // ── keyboard access to the map: arrows pan, + / − zoom, 0 whole France ──────────
  function initMapKeyboard() {
    const el = $('map-svg');
    el.setAttribute('tabindex', '0'); el.setAttribute('role', 'application');
    el.setAttribute('aria-label', 'Carte des observations. Flèches : déplacer. Plus et moins : zoomer. Zéro : vue entière.');
    el.addEventListener('keydown', (e) => {
      const step = 90 / tf.k, t = mapSvg.transition().duration(DUR ? 180 : 1);
      if (e.key === 'ArrowLeft') t.call(zoom.translateBy, step, 0);
      else if (e.key === 'ArrowRight') t.call(zoom.translateBy, -step, 0);
      else if (e.key === 'ArrowUp') t.call(zoom.translateBy, 0, step);
      else if (e.key === 'ArrowDown') t.call(zoom.translateBy, 0, -step);
      else if (e.key === '+' || e.key === '=') t.call(zoom.scaleBy, 1.5);
      else if (e.key === '-' || e.key === '_') t.call(zoom.scaleBy, 1 / 1.5);
      else if (e.key === '0') t.call(zoom.transform, d3.zoomIdentity);
      else return;
      e.preventDefault();
    });
  }

  function initUI() {
    initMapKeyboard();
    $('btn-copylink').addEventListener('click', copyLink);
    $('btn-png').addEventListener('click', () => { exportPNG().catch((err) => { console.error(err); window.alert('Export impossible : ' + err.message); }); });
    $('btn-csv').addEventListener('click', exportCSV);
    window.addEventListener('hashchange', () => { if (bootDone && !applyingHash && applyHash(location.hash)) scheduleUpdate(); });
  }
