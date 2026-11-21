  // ═══════════════════════════════════════════════════════════════════════════
  // Names: French / Latin display, bilingual search index, French labels of FUNGuild categories
  // ═══════════════════════════════════════════════════════════════════════════
  // Every place that shows a species name goes through displayName() / latinName(): never read DICT.species[...] for display.
  const GUILD_FR = {
    'Ectomycorrhizal': 'Ectomycorhizien', 'Wood saprotroph': 'Saprotrophe du bois', 'Undefined saprotroph': 'Saprotrophe (non précisé)',
    'Soil saprotroph': 'Saprotrophe du sol', 'Plant pathogen': 'Pathogène de plantes', 'Litter saprotroph': 'Saprotrophe de la litière',
    'Undefined symbiotroph': 'Symbiotrophe (non précisé)', 'Leaf saprotroph': 'Saprotrophe des feuilles', 'Dung saprotroph': 'Saprotrophe des excréments',
    'Fungal parasite': 'Parasite de champignons', 'Plant saprotroph': 'Saprotrophe de plantes', 'Bryophyte': 'Associé aux bryophytes',
    'Bryophyte Parasite': 'Parasite de bryophytes', 'Endophyte': 'Endophyte', 'Myxomycetes': 'Myxomycètes', 'Lichenized': 'Lichénisé',
    'Insect parasite': 'Parasite d’insectes', 'Fungal saprotroph': 'Saprotrophe de champignons', 'Burnt soil saprotroph': 'Saprotrophe des sols brûlés',
    'Lichen Parasite': 'Parasite de lichens', 'Animal Pathogen': 'Pathogène d’animaux', 'Bryophyte pathogen': 'Pathogène de bryophytes',
    'Carbonicolous': 'Carbonicole', 'Epiphyte': 'Épiphyte', 'Animal saprotroph': 'Saprotrophe animal', 'Burnt sites saprotroph': 'Saprotrophe des sites brûlés',
    'Plant parasite': 'Parasite de plantes', 'Parasite': 'Parasite', 'Orchid Mycorrhizal': 'Mycorhizien d’orchidées', 'Nematophagous': 'Nématophage',
    'Plant endophyte': 'Endophyte de plantes',
  };
  const TROPHIC_FR = {
    'Saprotroph': 'Saprotrophe', 'Symbiotroph': 'Symbiotrophe', 'Pathotroph': 'Pathotrophe', 'Pathotroph-Saprotroph': 'Pathotrophe-saprotrophe',
    'Saprotroph-Symbiotroph': 'Saprotrophe-symbiotrophe', 'Pathotroph-Symbiotroph': 'Pathotrophe-symbiotrophe', 'Pathotroph-Saprotroph-Symbiotroph': 'Pathotrophe-saprotrophe-symbiotrophe',
  };
  const guildFr = (v) => GUILD_FR[v] || v;
  const dictLabel = (dictName, v) => (dictName === 'guild' ? guildFr(v) : dictName === 'trophic' ? (TROPHIC_FR[v] || v) : v);

  const NAME_KEY = 'fongimap-name-pref';
  const prefStore = {
    get() { try { return window.localStorage.getItem(NAME_KEY); } catch (e) { return null; } },
    set(v) { try { window.localStorage.setItem(NAME_KEY, v); } catch (e) { /* blocked storage: the choice just is not remembered */ } },
  };
  let namePref = 'fr';                         // 'fr' = French name first, 'latin' = Latin name first
  const frOf = new Map();                      // species index -> [primary French name, ...aliases]
  let searchIndex = null;

  function initNames() {
    const V = META.vernacular;
    if (V) V.idx.forEach((s, i) => frOf.set(s, V.names[i].split('|')));
    const saved = prefStore.get(); if (saved === 'fr' || saved === 'latin') namePref = saved;
    searchIndex = FMAP_CORE.buildSearchIndex(DICT.species.map((latin, s) => ({ latin, fr: frOf.get(s) || null, family: spFamily[s] !== MISSING ? DICT.family[spFamily[s]] : '' })));
  }
  const latinName = (s) => DICT.species[s];
  const hasFr = (s) => frOf.has(s);
  const displayName = (s) => (namePref === 'fr' && frOf.has(s) ? frOf.get(s)[0] : DICT.species[s]);
  const aliasesOf = (s) => (frOf.has(s) ? frOf.get(s).slice(1) : []);
  // true when the displayed name is the French one (so the Latin name is shown as a second line, in italics)
  const showsFrench = (s) => namePref === 'fr' && frOf.has(s);
  // HTML for a name in a list: French in roman type, Latin in italics
  const nameHtml = (s) => (showsFrench(s) ? esc(frOf.get(s)[0]) : '<em>' + esc(DICT.species[s]) + '</em>');
  function setNamePref(p) {
    namePref = p; prefStore.set(p);
    document.querySelectorAll('#seg-name button').forEach((b) => b.classList.toggle('on', b.dataset.v === p));
    alphaRank = null; computeAlphaRank();
    if (state.speciesSet.size === 1) { const only = [...state.speciesSet][0]; state.speciesLabel = displayName(only); }
    tipCache.clear(); tipTok++;
    if (lastAgg) renderBrowser(lastAgg);
    if (drawerSpecies >= 0) openSpecies(drawerSpecies, false);
    scheduleHash();
  }

