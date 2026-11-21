  // ── species browser: searchable, sortable list that answers "which fungi here / now / edible" ──
  // The list counts records passing every filter EXCEPT the species filter (see aggregate), so it follows the
  // département, period, month, edibility and guild filters while still showing the other species.
  // « aussi appelé : X » when the species was found through a French alias rather than its main name
  const hintFor = (s, via) => { const n = frOf.get(s)[via - 1]; return n ? 'aussi appelé : ' + n : ''; };
  const ROW_H = 46, PAGE = 60;
  const BR = { query: '', sort: 'count', limit: PAGE, timer: 0, rows: [], total: 0 };
  let alphaRank = null, familyLower = [];
  let previewTimer = 0, savedTarget = null, savedByDept = null;

  // alphabetical rank of every species by its displayed name (French or Latin, per the current preference)
  function computeAlphaRank() {
    const names = DICT.species.map((_, s) => FMAP_CORE.searchKey(displayName(s)));
    const idx = d3.range(DICT.species.length).sort((p, q) => (names[p] < names[q] ? -1 : names[p] > names[q] ? 1 : p - q));
    alphaRank = new Int32Array(DICT.species.length);
    idx.forEach((s, r) => { alphaRank[s] = r; });
  }

  function initBrowser() {
    computeAlphaRank();
    familyLower = DICT.family.map((f) => String(f).toLowerCase());
    const input = $('search-species');
    const apply = () => { BR.query = input.value.trim(); BR.limit = PAGE; renderBrowser(lastAgg); $('sp-scroll').scrollTop = 0; };
    input.addEventListener('input', () => { clearTimeout(BR.timer); BR.timer = setTimeout(apply, 150); });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { clearTimeout(BR.timer); apply(); if (BR.rows[0]) pickSpecies(BR.rows[0].idx); }
      else if (e.key === 'Escape' && input.value) { input.value = ''; clearTimeout(BR.timer); apply(); e.stopPropagation(); }
    });
    $('seg-sort').addEventListener('click', (e) => {
      const b = e.target.closest('button'); if (!b) return;
      BR.sort = b.dataset.v; BR.limit = PAGE;
      document.querySelectorAll('#seg-sort button').forEach((x) => x.classList.toggle('on', x === b));
      renderBrowser(lastAgg);
    });
    $('sp-more').addEventListener('click', () => { BR.limit += PAGE; renderBrowser(lastAgg); });
    $('sp-multi').addEventListener('click', () => {
      if (BR.total < 2) return;
      ensureMatches();
      const all = []; for (let s = 0; s < DICT.species.length; s++) if (lastAgg.bySpecies[s] > 0 && BR.matches.has(s)) all.push(s);
      setSpecies(all, '« ' + $('search-species').value.trim() + ' » (' + fmt(all.length) + ' espèces)');
      scheduleUpdate();
    });
    $('species-active').addEventListener('click', () => { clearSpecies(); closeDrawer(); scheduleUpdate(); });
    $('commune-active').addEventListener('click', () => { state.commune = -1; scheduleUpdate(); });
    $('sp-list').addEventListener('mouseleave', endPreview);
    $('seg-name').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b && b.dataset.v !== namePref) setNamePref(b.dataset.v); });
    document.querySelectorAll('#seg-name button').forEach((b) => b.classList.toggle('on', b.dataset.v === namePref));
  }

  // species matching the typed query (Latin, French name, alias, family), computed once per query
  function ensureMatches() {
    if (BR.matchesFor === BR.query) return;
    BR.matchesFor = BR.query;
    BR.matches = BR.query ? new Map(Array.from(FMAP_CORE.search(searchIndex, BR.query) || []).map((m) => [m.s, m])) : null;
  }

  // rebuild the list: keyed D3 join, FLIP re-ranking (rows glide to their new rank), animated counts
  function renderBrowser(a) {
    if (!a) return;
    const L = DICT.species.length, counts = a.bySpecies;
    ensureMatches();
    const M = BR.matches, idx = [];
    for (let s = 0; s < L; s++) if (counts[s] > 0 && (!M || M.has(s))) idx.push(s);
    if (BR.sort === 'alpha') idx.sort((p, q) => alphaRank[p] - alphaRank[q]);
    else if (M) idx.sort((p, q) => M.get(p).tier - M.get(q).tier || counts[q] - counts[p] || alphaRank[p] - alphaRank[q]);   // best match first, then most observed
    else idx.sort((p, q) => counts[q] - counts[p] || alphaRank[p] - alphaRank[q]);
    BR.total = idx.length;
    const rows = idx.slice(0, BR.limit).map((s, r) => ({ idx: s, rank: r, name: displayName(s), fr: showsFrench(s), latin: DICT.species[s], fam: spFamily[s] !== MISSING ? DICT.family[spFamily[s]] : '', hint: (M && M.get(s).via >= 1 && frOf.has(s) && M.get(s).tier > 0 ? hintFor(s, M.get(s).via) : ''), n: counts[s], edi: ediOf[s] }));
    BR.rows = rows;

    $('sp-count').textContent = fmt(BR.total) + (BR.total > 1 ? ' espèces · ' + (BR.sort === 'alpha' ? 'par ordre alphabétique' : 'triées par observations') : ' espèce') + (BR.query ? ' · « ' + $('search-species').value.trim() + ' »' : '');
    const multi = $('sp-multi');
    multi.classList.toggle('hidden', !(BR.query && BR.total > 1));
    multi.textContent = 'Voir les ' + fmt(BR.total) + ' espèces sur la carte';
    const more = $('sp-more');
    more.classList.toggle('hidden', BR.total <= rows.length);
    more.textContent = 'Voir plus (' + fmt(Math.min(PAGE, BR.total - rows.length)) + ' sur ' + fmt(BR.total - rows.length) + ' restantes)';
    $('sp-empty').classList.toggle('hidden', BR.total > 0);
    $('sp-empty').textContent = BR.query ? 'Aucune espèce ne correspond à cette recherche avec les filtres actuels.' : 'Aucune espèce avec les filtres actuels : assouplissez-les (Réinitialiser).';

    const ch = $('commune-active');
    ch.classList.toggle('hidden', state.commune < 0);
    ch.innerHTML = state.commune >= 0 ? '<span class="chip active" title="Retirer ce filtre">Commune : <b>' + esc(communeLabel(state.commune)) + '</b>  ×</span>' : '';
    const holder = $('species-active');
    holder.classList.toggle('hidden', state.speciesSet.size === 0);
    holder.innerHTML = state.speciesSet.size ? '<span class="chip active" title="Retirer ce filtre">Filtre : <em>' + esc(trunc(state.speciesLabel, 40)) + '</em>  ×</span>' : '';

    const list = $('sp-list');
    list.style.height = rows.length * ROW_H + 'px';
    // FLIP step 1 (First): where every visible row is now (transforms included)
    const first = new Map();
    list.querySelectorAll('.sp-row:not(.leaving)').forEach((el) => first.set(el.__data__.idx, el.getBoundingClientRect().top));
    list.querySelectorAll('.sp-row').forEach((el) => el.getAnimations().forEach((an) => an.cancel()));
    const sel = d3.select(list).selectAll('div.sp-row').data(rows, (d) => d.idx).join(
      (en) => {
        const r = en.append('div').attr('class', 'sp-row').attr('role', 'button').attr('tabindex', 0);
        r.append('span').attr('class', 'sp-badge').append('i');
        const m = r.append('span').attr('class', 'sp-main'); m.append('em').attr('class', 'sp-name'); m.append('small').attr('class', 'sp-fam');
        r.append('b').attr('class', 'sp-n');
        r.on('click', (e, d) => pickSpecies(d.idx))
          .on('keydown', (e, d) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pickSpecies(d.idx); } })
          .on('mouseenter', (e, d) => previewSpecies(d.idx));
        return r;
      },
      (up) => up.classed('leaving', false).style('pointer-events', null).style('opacity', null).interrupt('x'),
      (ex) => ex.filter(':not(.leaving)').classed('leaving', true).style('pointer-events', 'none').transition('x').duration(DUR / 2).style('opacity', 0).remove());
    sel.style('top', (d) => d.rank * ROW_H + 'px')
      .classed('sel', (d) => state.speciesSet.has(d.idx)).attr('aria-pressed', (d) => state.speciesSet.has(d.idx))
      .attr('title', (d) => d.name + (d.fr ? ' (' + d.latin + ')' : '') + ' — ' + EDI[d.edi].label).attr('aria-label', (d) => d.name + (d.fr ? ', ' + d.latin : '') + ', ' + fmt(d.n) + ' observations, ' + EDI[d.edi].label);
    sel.select('.sp-badge').style('background', (d) => EDI[d.edi].colour).style('color', (d) => EDI[d.edi].ink).select('i').text((d) => EDI[d.edi].icon);
    sel.select('.sp-name').classed('latin', (d) => !d.fr).text((d) => d.name);
    sel.select('.sp-fam').html((d) => (d.fr ? '<i>' + esc(d.latin) + '</i>' : '') + (d.fr && d.fam ? ' · ' : '') + esc(d.fam) + (d.hint ? ' · ' + esc(d.hint) : ''));
    sel.select('.sp-n').each(function (d) { tweenNumber(this, d.n); });
    // FLIP steps 2-3 (Last, Invert, Play): rows that moved start at their old place and glide to the new one
    if (DUR) {
      sel.each(function (d) {
        const was = first.get(d.idx), now = this.getBoundingClientRect().top;
        if (was === undefined) this.animate([{ opacity: 0, transform: 'translateX(-10px)' }, { opacity: 1, transform: 'none' }], { duration: DUR * 0.7, easing: 'cubic-bezier(.22,.8,.3,1)' });
        else if (Math.abs(was - now) > 1) this.animate([{ transform: 'translateY(' + (was - now) + 'px)' }, { transform: 'none' }], { duration: DUR, easing: 'cubic-bezier(.22,.8,.3,1)' });
      });
    }
  }

  // hover on a list row: preview that species on the map (one engine call, nothing else changes)
  function previewSpecies(idx) {
    clearTimeout(previewTimer);
    const tok = ++previewTok;
    previewTimer = setTimeout(async () => {
      const res = await engine.preview(idx);
      if (tok !== previewTok) return;                          // the pointer left, or a filter changed meanwhile
      if (!previewing) { savedTarget = siteTarget.slice(); savedByDept = agg.byDept.slice(); }
      previewing = true;
      siteFrom.set(siteShown); siteTarget.set(res.siteCount);
      finishSites(); tipCache.clear(); tipTok++; updateMap({ byDept: res.byDept }); startSiteAnim(false);
      $('preview-tag').innerHTML = 'Aperçu : ' + nameHtml(idx);
      $('preview-tag').classList.remove('hidden');
    }, 140);
  }
  function endPreview() {
    clearTimeout(previewTimer); previewTok++;
    if (!previewing) return;
    previewing = false;
    siteFrom.set(siteShown); siteTarget.set(savedTarget);
    finishSites(); tipCache.clear(); tipTok++; updateMap(lastAgg); startSiteAnim(false);
    $('preview-tag').classList.add('hidden');
  }

  // clear every filter (not the map position)
  function resetFilters() {
    ['speciesSet', 'phylumSet', 'guildSet', 'trophicSet', 'ecoregionSet', 'monthSet', 'deptSet'].forEach((k) => state[k].clear());
    clearSpecies();
    state.yearMin = 0; state.yearMax = 0; state.edible = 0; state.commune = -1;
    $('year-min').value = YEAR_LO; $('year-max').value = YEAR_HI;
    BR.query = ''; BR.limit = PAGE; $('search-species').value = '';
  }
  // restore the no-filter state and the whole-France view
  function resetAll() {
    resetFilters(); closeDrawer();
    mapSvg.transition().duration(DUR || 1).call(zoom.transform, d3.zoomIdentity);
    updateAll();
  }

