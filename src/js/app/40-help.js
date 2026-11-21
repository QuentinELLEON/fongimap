  // ═══════════════════════════════════════════════════════════════════════════
  // "À quoi sert ce site ?" panel (first visit, then the ? button) and starter questions
  // ═══════════════════════════════════════════════════════════════════════════
  const SEEN_KEY = 'fongimap-intro-seen';
  const store = {
    get() { try { return window.localStorage.getItem(SEEN_KEY); } catch (e) { return null; } },
    set(v) { try { window.localStorage.setItem(SEEN_KEY, v); } catch (e) { /* storage blocked: the panel simply shows again next time */ } },
  };
  const spIdx = (name) => DICT.species.indexOf(name);
  const genusIdx = (g) => d3.range(DICT.species.length).filter((i) => DICT.species[i].startsWith(g + ' '));
  // each starter presets filters, then lets the normal pipeline do the rest
  const STARTERS = [
    { label: 'Où trouver des cèpes ?', run: () => ({ pick: spIdx('Boletus edulis') }) },
    { label: 'Quels champignons comestibles en octobre ?', run: () => ({ months: [10], edible: 1 }) },
    { label: 'Où trouve-t-on des morilles au printemps ?', run: () => ({ genus: 'Morchella', months: [3, 4, 5] }) },
    { label: 'Où a-t-on vu l’amanite phalloïde (mortelle) ?', run: () => ({ pick: spIdx('Amanita phalloides') }) },
  ];

  function initHelp() {
    $('btn-help').addEventListener('click', openHelp);
    $('help-close').addEventListener('click', closeHelp);
    $('help-start').addEventListener('click', closeHelp);
    $('help').addEventListener('mousedown', (e) => { if (e.target === $('help')) closeHelp(); });
    $('help-starters').innerHTML = '';
    STARTERS.forEach((st) => {
      const b = document.createElement('button'); b.type = 'button'; b.textContent = st.label;
      b.addEventListener('click', () => applyStarter(st.run()));
      $('help-starters').appendChild(b);
    });
    const located = dataStats.located, approxN = dataStats.approxN;
    $('help-data').textContent = fmt(N) + ' observations' + (META.yearSpan ? ' (' + META.yearSpan + ')' : '') + ' ; ' + Math.round(100 * located / N) + ' % ont une position sur la carte, dont ' +
      Math.round(100 * approxN / Math.max(1, located)) + ' % seulement au centre de la commune (symboles plus pâles).';
  }
  function openHelp() { $('help').classList.remove('hidden'); $('help-start').focus(); }
  function closeHelp() { $('help').classList.add('hidden'); store.set('1'); }
  function maybeShowHelp() { if (!store.get()) openHelp(); }

  function applyStarter(o) {
    closeHelp(); resetFilters(); closeDrawer(); showTab('species');
    if (o.months) o.months.forEach((m) => state.monthSet.add(m));
    if (o.edible) state.edible = o.edible;
    if (o.genus) { const g = genusIdx(o.genus); if (g.length) setSpecies(g, 'genre ' + o.genus + ' (' + fmt(g.length) + ' espèces)'); }
    if (o.pick !== undefined && o.pick >= 0) { setSpecies([o.pick], DICT.species[o.pick]); openSpecies(o.pick, true); }
    else mapSvg.transition().duration(DUR || 1).call(zoom.transform, d3.zoomIdentity);
    updateAll();
  }

