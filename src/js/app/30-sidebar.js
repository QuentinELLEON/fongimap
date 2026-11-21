  // ═══════════════════════════════════════════════════════════════════════════
  // Sidebar: species browser (tab 1) and filters (tab 2)
  // ═══════════════════════════════════════════════════════════════════════════
  let guildGroups = null, phylumGroups = null;
  const phylumColour = (i) => {
    const n = DICT.phylum[i];
    return n === 'Basidiomycota' ? COL_ACCENT1 : n === 'Ascomycota' ? COL_ACCENT3 : ['#4e79a7', '#b07aa1', '#76b7b2', '#9c755f'][i % 4];
  };
  const guildColour = (i) => (i < 8 ? TABLEAU[i] : COL_OTHER);

  // groups of dictionary indices shown as one chip: first nTop values, "Autres", optional "non renseigné"
  function makeGroups(dictName, nTop, colourFn, withMissing) {
    const L = DICT[dictName].length, out = [];
    for (let i = 0; i < Math.min(nTop, L); i++) out.push({ label: dictLabel(dictName, DICT[dictName][i]), colour: colourFn(i), idx: [i] });
    if (L > nTop) out.push({ label: 'Autres', colour: COL_OTHER, idx: d3.range(nTop, L) });
    if (withMissing) out.push({ label: 'Non renseigné', colour: COL_NA, idx: [MISSING] });
    return out;
  }
  const groupActive = (set, g) => g.idx.some((i) => set.has(i));
  function toggleGroup(set, g) {
    const all = g.idx.every((i) => set.has(i));
    g.idx.forEach((i) => (all ? set.delete(i) : set.add(i)));
  }

  const chipRefs = [];
  function toggleSet(set, v) { if (set.has(v)) set.delete(v); else set.add(v); }

  // create toggle chips for a list of groups bound to a filter Set
  function buildChips(containerId, groups, set) {
    const el = $(containerId); el.innerHTML = '';
    const refs = groups.map((g) => {
      const c = document.createElement('button');
      c.type = 'button'; c.className = 'chip'; c.title = g.label; c.setAttribute('aria-pressed', 'false');
      if (g.swatch) { const s = document.createElement('i'); s.className = 'swatch'; s.style.background = g.swatch; c.appendChild(s); }
      c.appendChild(document.createTextNode(g.label));
      c.addEventListener('click', () => { toggleGroup(set, g); scheduleUpdate(); });
      el.appendChild(c);
      return { g, el: c };
    });
    chipRefs.push({ refs, set, id: containerId });
  }

  // display names for lower-case source values (the source spells "mediterranen")
  const PRETTY = { atlantique: 'Atlantique', continental: 'Continental', montagnard: 'Montagnard', mediterranen: 'Méditerranéen' };
  const prettyLabel = (v) => PRETTY[v] || (v.charAt(0).toUpperCase() + v.slice(1));

  function buildSidebar() {
    guildGroups = makeGroups('guild', 8, guildColour, true); phylumGroups = makeGroups('phylum', 2, phylumColour, true);
    const withSwatch = (gs) => gs.map((g) => (g.swatch = g.colour, g));
    buildChips('filter-guild', withSwatch(guildGroups.filter((g) => g.label !== 'Non renseigné')), state.guildSet);
    buildChips('filter-phylum', withSwatch(phylumGroups.filter((g) => g.label !== 'Non renseigné')), state.phylumSet);
    buildChips('filter-trophic', makeGroups('trophic', DICT.trophic.length, () => null, false), state.trophicSet);
    buildChips('filter-ecoregion', makeGroups('ecoregion', DICT.ecoregion.length, () => null, false).map((g) => (g.label = prettyLabel(g.label), g)), state.ecoregionSet);

    // tabs: species browser / filters
    $('side-tabs').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) showTab(b.dataset.tab); });

    // accordion
    document.querySelectorAll('.filter-section .fs-head').forEach((b) => b.addEventListener('click', () => b.parentElement.classList.toggle('open')));

    // months
    const mg = $('filter-month');
    MONTHS.forEach((name, i) => {
      const b = document.createElement('button');
      b.type = 'button'; b.setAttribute('aria-pressed', 'false'); b.className = 'month-btn'; b.textContent = name; b.dataset.m = i + 1;
      b.addEventListener('click', () => { toggleSet(state.monthSet, i + 1); scheduleUpdate(); });
      mg.appendChild(b);
    });

    // départements (alphabetical); clicking toggles without needing Ctrl
    const sel = $('filter-dept');
    DICT.dept.map((name, i) => ({ name: deptFeat.has(i) ? deptName(i) : null, i }))
      .filter((d) => d.name !== null).sort((a, b) => a.name.localeCompare(b.name, 'fr'))
      .forEach(({ name, i }) => {
        const o = document.createElement('option'); o.value = i; o.textContent = name;
        o.addEventListener('mousedown', (e) => { e.preventDefault(); sel.focus(); toggleSet(state.deptSet, i); scheduleUpdate(); });
        sel.appendChild(o);
      });
    sel.addEventListener('change', () => {
      state.deptSet.clear();
      Array.from(sel.selectedOptions).forEach((o) => state.deptSet.add(parseInt(o.value, 10)));
      scheduleUpdate();
    });

    // year range
    const ymin = $('year-min'), ymax = $('year-max');
    const onYear = (which) => () => {
      let a = +ymin.value, b = +ymax.value;
      if (a > b) { if (which === 'min') a = b; else b = a; }
      setYearRange(a, b);
    };
    ymin.addEventListener('input', onYear('min'));
    ymax.addEventListener('input', onYear('max'));
    updateYearLabel();

    // edibility control
    $('seg-edible').addEventListener('click', (e) => {
      const b = e.target.closest('button'); if (!b) return;
      state.edible = +b.dataset.v; scheduleUpdate();
    });

    $('btn-reset').addEventListener('click', resetAll);
    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      if (!$('help').classList.contains('hidden')) closeHelp(); else closeDrawer();
    });
  }

  function showTab(name) {
    document.querySelectorAll('#side-tabs button').forEach((b) => { const on = b.dataset.tab === name; b.classList.toggle('on', on); b.setAttribute('aria-selected', on); });
    document.querySelectorAll('.side-panel').forEach((p) => p.classList.toggle('on', p.id === 'panel-' + name));
  }

  // set the year filter (the full default range disables it)
  function setYearRange(a, b) {
    if (a <= YEAR_LO && b >= YEAR_HI) { state.yearMin = 0; state.yearMax = 0; a = YEAR_LO; b = YEAR_HI; }
    else { state.yearMin = a; state.yearMax = b; }
    $('year-min').value = a; $('year-max').value = b;
    updateYearLabel();
    scheduleUpdate();
  }
  function updateYearLabel() {
    const a = +$('year-min').value, b = +$('year-max').value, span = YEAR_HI - YEAR_LO, f = $('range-fill');
    $('year-range-label').textContent = a + '–' + b;
    f.style.left = (100 * (a - YEAR_LO) / span) + '%';
    f.style.width = (100 * (b - a) / span) + '%';
  }

  // refresh chip / month / dept / edibility widgets and the badges from state
  function syncUI() {
    chipRefs.forEach(({ refs, set }) => refs.forEach(({ g, el }) => { const on = g.idx.length > 0 && g.idx.every((i) => set.has(i)); el.classList.toggle('active', on); el.setAttribute('aria-pressed', on); }));
    document.querySelectorAll('.month-btn').forEach((b) => { const on = state.monthSet.has(+b.dataset.m); b.classList.toggle('active', on); b.setAttribute('aria-pressed', on); });
    Array.from($('filter-dept').options).forEach((o) => { o.selected = state.deptSet.has(parseInt(o.value, 10)); });
    document.querySelectorAll('#seg-edible button').forEach((b) => b.classList.toggle('on', +b.dataset.v === state.edible));
    const chipCount = (id) => { const r = chipRefs.find((c) => c.id === id); return r ? r.refs.filter((x) => x.el.classList.contains('active')).length : 0; };
    const counts = {
      commune: state.commune >= 0 ? 1 : 0, year: state.yearMin > 0 ? 1 : 0, month: state.monthSet.size, guild: chipCount('filter-guild'), dept: state.deptSet.size,
      adv: chipCount('filter-phylum') + chipCount('filter-trophic') + chipCount('filter-ecoregion'),
    };
    document.querySelectorAll('.filter-section').forEach((s) => {
      const n = counts[s.dataset.key] || 0, bd = s.querySelector('.badge');
      bd.textContent = n; bd.classList.toggle('on', n > 0);
    });
    const total = d3.sum(Object.values(counts)), tb = $('filters-badge');
    tb.textContent = total; tb.classList.toggle('on', total > 0);
    updateYearLabel();
    renderFilterBar();
  }

  function setSpecies(indices, label) { state.speciesSet = new Set(indices); state.speciesLabel = label; }
  function clearSpecies() { state.speciesSet = new Set(); state.speciesLabel = ''; }

  // choose one species: filter on it, fly to its distribution and open its sheet; choosing it again clears
  function pickSpecies(idx) {
    if (state.speciesSet.size === 1 && state.speciesSet.has(idx)) { clearSpecies(); closeDrawer(); }
    else { setSpecies([idx], displayName(idx)); openSpecies(idx, true); }
    scheduleUpdate();
  }

