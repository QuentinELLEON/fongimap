// Application: built from src/js/app/*.js (one function scope) by tools/build_web.py
/* ═══════════════════════════════════════════════════════════════════════════
   FongiMap – application logic (single IIFE, no modules, runs on file://)

   Data: FongiBase extract, Gautier et al. 2022 – https://zenodo.org/records/17158524

   Binary record format (specs/design.md §2.2) – little-endian, 18 bytes/record,
   produced by tools/build_data.py, zlib-compressed + base64 in assets/data/data.js (window.FMAP_DATA):

     Offset  Bytes  Type    Field       Notes
     0       2      uint16  lon_q       quantised longitude, 0xFFFF = missing
     2       2      uint16  lat_q       quantised latitude,  0xFFFF = missing
     4       2      uint16  year        0 = missing
     6       1      uint8   month       1-12, 0 = missing
     7       2      uint16  species     index into dicts.species, 0xFFFE = missing
     9       1      uint8   family      index into dicts.family,    0xFF = missing
     10      1      uint8   order       index into dicts.order,     0xFF = missing
     11      1      uint8   class_      index into dicts.class_,    0xFF = missing
     12      1      uint8   phylum      index into dicts.phylum,    0xFF = missing
     13      1      uint8   guild       index into dicts.guild,     0xFF = missing
     14      1      uint8   trophic     index into dicts.trophic,   0xFF = missing
     15      1      uint8   dept        index into dicts.dept,      0xFF = missing
     16      1      uint8   ecoregion   index into dicts.ecoregion, 0xFF = missing
     17      1      uint8   corine      index into dicts.corine,    0xFF = missing

   lon = lon_min + lon_q / 65534 * (lon_max - lon_min)   (same for lat)

   Besides the records, the dataset script carries META.sites (the distinct GPS positions with their
   locality name) and META.edible (edibility code per species).  A record's site is found
   from its (lon_q, lat_q) pair.

   Filtering model: applyFilters() writes one value per record into failMask.
   Bit i set  <=>  the record fails filter i  (0 = passes every filter).
   The species browser (sidebar) and the map's départements count the records that fail
   *at most their own* filter (species / département), so the list keeps showing the other
   species and the map keeps showing the other départements next to the selected ones
   (cross-filtering, "brushing and linking" between list and map).

   Interaction design follows Shneiderman's mantra: overview first (départements),
   zoom and filter (semantic zoom: densité -> lieux exacts; species browser + filters),
   details on demand (tooltip, species drawer).  All changes animate with D3 joins (enter / update / exit) and
   transitions, which are disabled when the user prefers reduced motion.
   ═══════════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  // ── constants ─────────────────────────────────────────────────────────────
  const REC = 18;
  const VERIFY = /[?&]verify=1\b/.test(location.search);     // ?verify=1 checks the CRC-32 of the data (about 50 ms more at start)
  const DATA_DIR = window.FMAP_DATA_DIR || '';      // folder of the dataset scripts, relative to index.html (set by index.html)
  const SP_MISSING = 0xFFFE, MISSING = 0xFF, COORD_MISSING = 0xFFFF, Q_MAX = 65534;
  let YEAR_LO = 1900, YEAR_HI = 2021;      // period slider range: set from META.year_range at boot
  const VIRT = 1000;                         // virtual map box the projection is fitted to
  const RARE_N = 100;                        // rarefaction sample size (Hurlbert)
  const EARTH_R_KM = 6371.0088;
  // graduated symbols for places (absolute counts -> size): 1-9, 10-99, 100-999, 1000+ observations
  const SYM_RADII = [3.6, 5.6, 8.5, 13], SYM_LABELS = ['1 – 9', '10 – 99', '100 – 999', '1 000 et plus'];
  const symClass = (w) => (w >= 1000 ? 3 : w >= 100 ? 2 : w >= 10 ? 1 : 0);
  const CLUSTER_PX = 17;                     // places closer than this on screen are grouped into one symbol
  // 10 km grid cells (equal area -> count = density -> lightness ramp): 1-9, 10-49, 50-199, 200-999, 1000+
  const CELL_CUTS = [10, 50, 200, 1000], CELL_LABELS = ['1 – 9', '10 – 49', '50 – 199', '200 – 999', '1 000 et plus'];
  const cellClass = (w) => (w >= 1000 ? 4 : w >= 200 ? 3 : w >= 50 ? 2 : w >= 10 ? 1 : 0);
  let MONTHS = ['Janv', 'Févr', 'Mars', 'Avr', 'Mai', 'Juin', 'Juil', 'Août', 'Sept', 'Oct', 'Nov', 'Déc'];
  // failure bits
  const F_SPECIES = 1, F_PHYLUM = 2, F_GUILD = 4, F_TROPHIC = 8, F_ECO = 16, F_YEAR = 32, F_MONTH = 64, F_DEPT = 128, F_EDIBLE = 256, F_COMMUNE = 512;
  const TABLEAU = d3.schemeTableau10;
  const COL_NA = '#d9d5c6', COL_OTHER = '#9aa59a', COL_ZERO = '#e9e6dc';
  const COL_ACCENT1 = '#3a6b35', COL_ACCENT3 = '#c47b2b';
  const REDUCED = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const DUR = REDUCED ? 0 : 600;
  const EASE = d3.easeCubicOut;

  // edibility classes (indicative, curated – see data_processed/edibility.csv)
  const EDI = [
    { label: 'Comestibilité inconnue', short: 'Inconnue', colour: '#cfcabb', icon: '?' },
    { label: 'Comestible', short: 'Comestible', colour: '#009E73', icon: '✔' },
    { label: 'Comestible après cuisson / avec précautions', short: 'À cuire', colour: '#56B4E9', icon: '♨' },
    { label: 'Non comestible ou sans intérêt', short: 'Non comestible', colour: '#9a9484', icon: '–' },
    { label: 'Toxique', short: 'Toxique', colour: '#E69F00', icon: '⚠' },
    { label: 'Mortel', short: 'Mortel', colour: '#7a1b12', icon: '☠' },
  ];
  EDI.forEach((e) => { e.ink = e.colour === '#7a1b12' ? '#ffffff' : '#1d160c'; });   // text colour with contrast >= 4.5:1 on the badge colour

  const $ = (id) => document.getElementById(id);
  const fmt = (n) => Number(n).toLocaleString(LANG === 'en' ? 'en-GB' : 'fr-FR');
  const tick = () => new Promise((r) => setTimeout(r, 15));
  const smooth = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
  const trunc = (s, n) => (s.length > n ? s.slice(0, n - 1) + '…' : s);
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  // ── global data (filled by boot) ─────────────────────────────────────────
  let META, DICT, N = 0;
  let engine = null;                         // record engine client (Web Worker or main thread): see core/engine-client.js
  let dataStats = { located: 0, approxN: 0 };
  let speciesLower = [];
  let DEPTS, REGIONS;
  let featDept = [];                         // GeoJSON feature index -> dict dept index (-1 = none)
  let deptFeat = new Map();                  // dict dept index -> feature index
  let ediOf = new Uint8Array(65536);         // species index -> edibility class
  let spFamily = new Uint8Array(65536).fill(MISSING);   // species index -> family index (one pass at load)
  let COM = { names: [], dep: [], lon: [], lat: [] }, siteCommune = null;   // commune table, commune of each site
  let nSites = 0, sitePX = null, sitePY = null, siteName = [];
  let siteTarget = null, siteFrom = null, siteShown = null, siteTree = null, siteApprox = null;

  // ── filter state ─────────────────────────────────────────────────────────
  const state = {
    speciesSet: new Set(), speciesLabel: '',
    phylumSet: new Set(), guildSet: new Set(), trophicSet: new Set(), ecoregionSet: new Set(),
    yearMin: 0, yearMax: 0,                  // 0 = filter disabled
    monthSet: new Set(), deptSet: new Set(),
    edible: 0,                               // 0 all, 1 edible, 2 toxic
    commune: -1,                             // index into META.communes, -1 = no commune filter
  };
  let previewTok = 0, tipTok = 0, tipKey = '';   // stale-answer guards for asynchronous engine calls
  let previewing = false;                    // a species list row is hovered: the map shows its distribution
  let lastAgg = null;
  const perf = { filter: 0, aggregate: 0, render: 0, total: 0, draw: 0 };


  // ═══════════════════════════════════════════════════════════════════════════
  // Language (French default, English on request: ?lang=en or the FR/EN button; remembered in localStorage)
  // French is the source language everywhere in the code. English is applied to the DOM by phrase: the page text and
  // everything the app writes later (tooltips, legend, lists, drawer) is translated by a MutationObserver. Species
  // names, place names and the edibility notes of the data stay as they are (French / Latin).
  // ═══════════════════════════════════════════════════════════════════════════
  const LANG = (() => {
    try {
      const m = /[?&]lang=(fr|en)\b/.exec(location.search);
      if (m) { window.localStorage.setItem('fongimap-lang', m[1]); return m[1]; }
      return window.localStorage.getItem('fongimap-lang') === 'en' ? 'en' : 'fr';
    } catch (e) { return /[?&]lang=en\b/.test(location.search) ? 'en' : 'fr'; }
  })();

  // whole text of an element (trimmed) -> English
  const EN_EXACT = {
    'Tous': 'All', 'Auto': 'Auto', 'Départements': 'Departments', 'Hexagones': 'Hexagons', 'Communes': 'Communes', 'Lieux': 'Places',
    'Latin': 'Latin', 'Français': 'French', 'Mois': 'Months', 'Période': 'Period', 'Filtres': 'Filters', 'Département': 'Department',
    'Écorégion': 'Ecoregion', 'Mode trophique': 'Trophic mode', 'Phylum': 'Phylum', 'Champignons': 'Mushrooms', '🍄 Champignons': '🍄 Mushrooms',
    'Plus observées': 'Most observed', 'A→Z': 'A→Z', 'Nom affiché': 'Name shown', 'Guilde écologique': 'Ecological guild', 'Filtres avancés': 'Advanced filters',
    'Commencer': 'Start', 'Essayez': 'Try', 'Ce que vous pouvez y trouver': 'What you can find here', 'Comment l’utiliser': 'How to use it', 'Sources et limites': 'Sources and limits',
    '🍽 Comestibles': '🍽 Edible', '☠ Toxiques': '☠ Toxic', '↺ Réinitialiser': '↺ Reset', '⚙ Options de la carte': '⚙ Map options', 'Niveau de détail': 'Level of detail',
    'Couleur des départements': 'Department colour', 'Thème': 'Theme', 'Automatique': 'Automatic', 'Clair': 'Light', 'Sombre': 'Dark', 'Partager et exporter': 'Share and export', 'Copier le lien': 'Copy link', 'Image PNG': 'PNG image', 'Liste CSV': 'CSV list',
    'Chargement…': 'Loading…', 'synthétique': 'synthetic', 'Photo': 'Photo', 'Tri': 'Sort', 'Comestibilité': 'Edibility', 'Espèce': 'Species', 'Commune': 'Commune',
    'Comestibles': 'Edible', 'Toxiques': 'Toxic', 'Filtre': 'Filter', 'Tout réinitialiser': 'Reset all', 'Aucune commune': 'No commune',
  };
  // fragments (matched as whole words / phrases anywhere in a text) -> English
  const EN_FRAG = {
    'Où et quand trouve-t-on quels champignons en France ?': 'Where and when can you find which mushrooms in France?',
    'observations ·': 'observations ·', 'espèces ·': 'species ·', 'départements': 'departments', 'espèces': 'species', 'espèce': 'species',
    'Jeu de données': 'Dataset', 'Données :': 'Data:', 'Fond de carte :': 'Basemap:', 'Noms et populations des communes :': 'Commune names and populations:',
    'Comestibilité indicative': 'Indicative edibility', ': ne jamais consommer un champignon sur la seule base de cette application.': ': never eat a mushroom on the sole basis of this application.',
    'Niveau de détail de la carte': 'Map level of detail', 'Le niveau de détail suit le zoom': 'The level of detail follows the zoom', 'Hexagones de 10 km': '10 km hexagons',
    'Limites et couleurs des communes': 'Commune boundaries and colours', 'Lieux de récolte': 'Collection places', 'Mesure représentée par la couleur des départements': 'Measure shown by the département colour',
    'Observations par 100 km²': 'Observations per 100 km²', 'Observations (total)': 'Observations (total)', 'Espèces distinctes': 'Distinct species', 'Richesse raréfiée (100 obs.)': 'Rarefied richness (100 obs.)',
    'Afficher les positions approximatives (centre de commune)': 'Show approximate positions (commune centre)', 'Décocher pour ne garder que les vrais points GPS': 'Untick to keep only real GPS points',
    'Image de la carte avec légende et sources': 'Map image with legend and sources', 'Liste des espèces de la vue, en CSV': 'List of the species in view, as CSV',
    'Vue entière': 'Whole France', 'Position sur la carte de France': 'Position on the map of France', 'Fermer (Échap)': 'Close (Esc)',
    'À quoi sert FongiMap ?': 'What is FongiMap for?', 'À quoi sert ce site ?': 'What is this site for?', 'Aide : à quoi sert ce site ?': 'Help: what is this site for?',
    'FongiMap montre': 'FongiMap shows', 'où et quand des champignons ont été observés en France': 'where and when mushrooms were observed in France',
    ', espèce par espèce, à partir d’un million d’observations de naturalistes (base FongiBase).': ', species by species, from a million naturalists’ observations (FongiBase).',
    'Où a-t-on vu telle espèce ?': 'Where has a given species been seen?', 'Quelles espèces dans mon département, en octobre ?': 'Which species in my département, in October?',
    'Lesquelles sont comestibles, lesquelles toxiques ?': 'Which are edible, which toxic?', 'Quelle est la fiabilité de la position ?': 'How reliable is the position?',
    'Choisissez un champignon dans la liste': 'Pick a mushroom in the', ': la carte s’y place et sa fiche s’ouvre.': 'list: the map goes there and its sheet opens.',
    'Zoomez': 'Zoom', ': départements, puis hexagones de 10 km, puis lieux ; les noms de lieux apparaissent.': ': départements, then 10 km hexagons, then communes and places; place names appear.',
    'Affinez avec l’onglet': 'Refine with the', '(période, mois, département) ou « Comestibles / Toxiques ».': 'tab (period, months, département) or “Edible / Toxic”.',
    ', Gautier et al. 2022, licence CC-BY 4.0.': ', Gautier et al. 2022, CC-BY 4.0 licence.', 'Les cartes montrent surtout': 'The maps mostly show', 'où les observateurs vont': 'where observers go',
    '(effort d’observation), pas l’abondance réelle des champignons.': '(observation effort), not the real abundance of mushrooms.', 'La comestibilité est': 'Edibility is',
    'indicative, partielle et non validée': 'indicative, partial and not validated', ': ne jamais consommer un champignon sur la seule base de cette application ; faites-le contrôler par un pharmacien ou une société mycologique.': ': never eat a mushroom on the sole basis of this application; have it checked by a pharmacist or a mycological society.',
    'Chercher : cèpe, girolle, Amanita, famille…': 'Search: porcini, chanterelle, Amanita, family…', 'Chercher une espèce': 'Search for a species', 'Nom affiché en premier': 'Name shown first',
    'Année minimale': 'Minimum year', 'Année maximale': 'Maximum year', 'Filtres actifs': 'Active filters', 'Aller à une commune…': 'Go to a commune…', 'Aller à une commune': 'Go to a commune',
    'Toutes les espèces': 'All species', 'Espèces comestibles (indicatif)': 'Edible species (indicative)', 'Espèces toxiques ou mortelles (indicatif)': 'Toxic or deadly species (indicative)', 'Réinitialiser tous les filtres': 'Reset all filters',
    'Jeu de données synthétique : valeurs aléatoires de démonstration, sans lien avec de vraies observations.': 'Synthetic dataset: random demonstration values, unrelated to real observations.',
    ': valeurs aléatoires de démonstration, sans lien avec de vraies observations.': ': random demonstration values, unrelated to real observations.',
    // legend and map texts
    'Reflète aussi le nombre d’observateurs.': 'Also reflects the number of observers.', 'Observations par département': 'Observations per département', 'Dépend de la taille du département.': 'Depends on the size of the département.',
    'Espèces distinctes par département': 'Distinct species per département', 'Croît avec le nombre d’observations.': 'Grows with the number of observations.', 'Espèces attendues pour': 'Species expected for',
    'Comparable entre départements ; écarts souvent faibles.': 'Comparable between départements; differences are often small.', 'moins de': 'less than', 'et plus': 'and more', 'aucune observation': 'no observations',
    ' Zoomez : des hexagones puis des lieux apparaissent.': ' Zoom in: hexagons, then places, appear.', 'Observations par commune': 'Observations per commune', 'Observations par km²': 'Observations per km²',
    'Chaque commune est colorée selon son nombre d’observations': 'Each commune is coloured by its number of observations', 'rapporté à sa surface': 'relative to its area',
    'Les lieux au centre de la commune n’ont pas de position plus fine : la commune est l’échelle fiable.': 'Places at the commune centre have no finer position: the commune is the reliable scale.',
    'Traits : commune < département < région.': 'Lines: commune < département < region.', 'Observations par hexagone': 'Observations per hexagon',
    'Chaque hexagone mesure 10 km de large (≈ 87 km²) : plus il est foncé, plus il y a eu d’observations.': 'Each hexagon is 10 km wide (≈ 87 km²): the darker it is, the more observations there were.',
    'Observations par lieu': 'Observations per place', 'position GPS': 'GPS position', 'centre de commune (approximatif)': 'commune centre (approximate)', 'plusieurs lieux proches regroupés': 'several nearby places grouped',
    'Aucune donnée': 'No data', 'Aucune observation': 'No observations', 'espèces distinctes': 'distinct species', 'Guilde dominante :': 'Dominant guild:', 'Clic : filtrer · double-clic : zoomer': 'Click: filter · double-click: zoom',
    'Lieu sans nom': 'Unnamed place', 'position approximative (centre de commune)': 'approximate position (commune centre)', 'Clic : filtrer sur': 'Click: filter on', 'lieux regroupés': 'places grouped',
    'Clic : zoomer pour les séparer': 'Click: zoom in to separate them', 'Hexagone de 10 km': '10 km hexagon', 'Clic : filtrer sur cette commune': 'Click: filter on this commune', 'hab.': 'inh.',
    // species list and drawer
    'par ordre alphabétique': 'in alphabetical order', 'triées par observations': 'sorted by observations', 'Voir les': 'See the', 'sur la carte': 'on the map', 'Voir plus': 'Show more', 'restantes': 'remaining',
    'Aperçu :': 'Preview:', 'aussi appelé :': 'also called:', 'Aussi appelé :': 'Also called:', 'Aucune espèce ne correspond à cette recherche avec les filtres actuels.': 'No species matches this search with the current filters.',
    'Aucune espèce avec les filtres actuels : assouplissez-les (Réinitialiser).': 'No species with the current filters: relax them (Reset).', 'Voir sur la carte': 'Show on map',
    'Aucune information de comestibilité dans la base embarquée.': 'No edibility information in the embedded database.', 'période': 'period', 'lieux géolocalisés': 'geolocated places',
    'Saisonnalité': 'Seasonality', 'Départements les plus riches': 'Richest départements', 'Guilde': 'Guild',
    'Information indicative et non validée : ne jamais consommer un champignon sur la seule base de cette application ; faites-le contrôler par un pharmacien ou une société mycologique.': 'Indicative, unvalidated information: never eat a mushroom on the sole basis of this application; have it checked by a pharmacist or a mycological society.',
    'Comestible après cuisson / avec précautions': 'Edible when cooked / with care', 'Non comestible ou sans intérêt': 'Not edible or of no interest', 'Comestibilité inconnue': 'Edibility unknown',
    'Comestible': 'Edible', 'Toxique': 'Toxic', 'Mortel': 'Deadly', 'Inconnue': 'Unknown', 'À cuire': 'Cook first', 'Non comestible': 'Not edible',
    // filter bar, live region, misc
    ': retirer ce filtre': ': remove this filter', 'Retirer ce filtre': 'Remove this filter', 'départements.': 'departments.', 'Export impossible :': 'Export impossible:', 'Lien copié ✓': 'Link copied ✓',
    'Carte des observations. Flèches : déplacer. Plus et moins : zoomer. Zéro : vue entière.': 'Map of observations. Arrow keys: pan. Plus and minus: zoom. Zero: whole France.',
    'ont une position sur la carte, dont': 'have a position on the map, of which', 'seulement au centre de la commune (symboles plus pâles).': 'only at the commune centre (paler symbols).',
    'Où trouver des cèpes ?': 'Where to find porcini?', 'Quels champignons comestibles en octobre ?': 'Which edible mushrooms in October?', 'Où trouve-t-on des morilles au printemps ?': 'Where are morels found in spring?',
    'Où a-t-on vu l’amanite phalloïde (mortelle) ?': 'Where has the death cap (deadly) been seen?', 'Démarrage du moteur…': 'Starting the engine…', 'Lecture des données…': 'Reading the data…',
    'Décodage…': 'Decoding…', 'Décompression…': 'Decompressing…', 'Préparation de la carte…': 'Preparing the map…', 'Premier rendu…': 'First render…', 'Prêt': 'Ready',
    'Indexation de': 'Indexing', 'Fichier data.js introuvable ou invalide.': 'data.js missing or invalid.', 'Aucune commune': 'No commune', 'mis à jour le': 'updated on',
    'Forêts (IGN, en ligne, aux derniers niveaux de zoom)': 'Forests (IGN, online, at the last zoom levels)',
    'Altitudes : courbes de niveau, sommets et cols (IGN, en ligne)': 'Altitude: contour lines, summits and passes (IGN, online)',
    'Ces couches interrogent data.geopf.fr (IGN) avec la zone affichée ; hors ligne, elles sont simplement absentes.': 'These layers query data.geopf.fr (IGN) with the displayed area; offline they are simply absent.',
    'Aux derniers niveaux de zoom, les': 'At the last zoom levels, the', 'forêts': 'forests', 'altitudes': 'altitudes', '(courbes de niveau, sommets, cols) viennent de l’IGN et sont chargées': '(contour lines, summits, passes) come from the IGN and are loaded', 'en ligne': 'online', '; chacune se désactive dans ⚙ Options de la carte.': '; each can be switched off in ⚙ Map options.',
    'Chargement des couches IGN…': 'Loading IGN layers…', 'Couches IGN indisponibles (hors ligne ?)': 'IGN layers unavailable (offline?)',
    'Forêt (IGN, masque 2021-2023)': 'Forest (IGN, 2021-2023 mask)', 'Courbes de niveau (gras : 100 m)': 'Contour lines (bold: 100 m)', 'Sommet ou col, altitude en m': 'Summit or pass, altitude in m',
    'Forêts, courbes de niveau et altitudes (couches en ligne) :': 'Forests, contour lines and altitudes (online layers):', 'forêts et altitudes : IGN (Licence Ouverte)': 'forests and altitudes: IGN (Open Licence)',
    'Autour de moi': 'Around me',
    'Où êtes-vous ?': 'Where are you?',
    'Aucun point choisi.': 'No point chosen.',
    'Me localiser': 'Locate me',
    'Choisir sur la carte': 'Pick on the map',
    'Quand et jusqu’où ?': 'When and how far?',
    'Aujourd’hui': 'Today',
    'Rayon': 'Radius',
    'rayon': 'radius',
    'Espèces': 'Species',
    'Toutes': 'All',
    'Humidité des 3 derniers jours': 'Humidity of the last 3 days',
    'Que trouver ?': 'What to find?',
    'Où aller ?': 'Where to go?',
    'Où le trouver ?': 'Where to find it?',
    'Lieux': 'Places',
    'Affichage': 'View',
    'Votre position': 'Your position',
    'Point choisi sur la carte': 'Point chosen on the map',
    'Cliquez sur la carte pour choisir le point': 'Click the map to choose the point',
    'Annuler': 'Cancel',
    'Ces comptages montrent surtout': 'These counts mostly show',
    'Choisissez un point : vous verrez quels champignons ont été observés près de lui à cette époque de l’année, et où.': 'Choose a point: you will see which mushrooms were observed near it at this time of year, and where.',
    'Aucune observation dans ce rayon : augmentez-le ou choisissez un autre point.': 'No observation in this radius: enlarge it or choose another point.',
    'Rien n’a été noté à cette époque dans ce rayon : voici les espèces vues dans l’année.': 'Nothing was recorded at this time of year in this radius: here are the species seen over the year.',
    'Aucun lieu avec une position précise dans ce rayon.': 'No place with a precise position in this radius.',
    'observations autour du': 'observations around',
    'en tout': 'in total',
    'au total': 'in total',
    'Calcul…': 'Computing…',
    'Retirer': 'Remove',
    'centre de commune': 'commune centre',
    'Choisissez d’abord un point.': 'Choose a point first.',
    'L’humidité récente n’est disponible que pour aujourd’hui : remettez la date du jour.': 'Recent humidity is only available for today: set the date back to today.',
    'Vérification en cours…': 'Checking…',
    'Impossible de joindre le service météo (hors ligne ?). Le reste du panneau fonctionne sans connexion.': 'The weather service cannot be reached (offline?). The rest of the panel works without a connection.',
    'Vérifier l’humidité': 'Check humidity',
    'Un clic envoie la position, arrondie à 1 km près, à open-meteo.com (service météo en ligne). Rien n’est envoyé sinon.': 'One click sends the position, rounded to about 1 km, to open-meteo.com (online weather service). Nothing is sent otherwise.',
    'Pluie, 3 jours': 'Rain, 3 days',
    'Humidité de l’air': 'Air humidity',
    'Humidité du sol': 'Soil moisture',
    'Température': 'Temperature',
    'Pluie par jour, 14 derniers jours': 'Rain per day, last 14 days',
    'Actualiser': 'Refresh',
    'Indication simple, pas un modèle validé : les champignons sortent souvent quelques jours à quelques semaines après des pluies, par temps doux. Source : Open-Meteo.': 'A simple indication, not a validated model: mushrooms often appear a few days to a few weeks after rain, in mild weather. Source: Open-Meteo.',
    'Conditions plutôt favorables': 'Rather favourable conditions',
    'Conditions moyennes': 'Average conditions',
    'Conditions peu favorables': 'Rather unfavourable conditions',
    'mm de pluie en 14 jours : sol bien arrosé': 'mm of rain in 14 days: well-watered ground',
    'mm de pluie en 14 jours : pluie modérée': 'mm of rain in 14 days: moderate rain',
    'mm de pluie en 14 jours : très sec': 'mm of rain in 14 days: very dry',
    'mm tombés ces 3 derniers jours': 'mm fell in the last 3 days',
    'Air humide': 'Humid air',
    'Air sec': 'Dry air',
    'Températures douces': 'Mild temperatures',
    'Gel ou grand froid': 'Frost or severe cold',
    'Forte chaleur': 'Intense heat',
    '°C en moyenne': '°C on average',
    'La localisation n’est pas disponible dans ce navigateur : choisissez un point sur la carte.': 'Location is not available in this browser: pick a point on the map.',
    'Localisation en cours…': 'Locating…',
    'Localisation refusée. Autorisez-la dans votre navigateur ou choisissez un point sur la carte.': 'Location denied. Allow it in your browser or pick a point on the map.',
    'Position introuvable pour le moment. Choisissez un point sur la carte.': 'Position not found for now. Pick a point on the map.',
    'Ce point est hors de la France métropolitaine : les données ne la couvrent pas.': 'This point is outside metropolitan France: the data does not cover it.',
    'Date': 'Date',
    'Rien n’est envoyé sinon.': 'Nothing is sent otherwise.',
    'Que trouver près de moi, en ce moment ?': 'What can I find near me, right now?', 'L’onglet': 'The', 'peut vérifier l’': 'tab can check the', 'humidité récente': 'recent humidity',
    'en ligne (Open-Meteo), seulement sur un clic ; votre position n’est ni enregistrée ni partagée.': 'online (Open-Meteo), only on a click; your position is neither stored nor shared.',
    'Masquer le panneau latéral': 'Hide the side panel', 'Afficher le panneau latéral': 'Show the side panel', 'Panneau latéral affiché.': 'Side panel shown.', 'Panneau latéral masqué.': 'Side panel hidden.',
    'Champignons et filtres': 'Mushrooms and filters',
    'Guilde écologique': 'Ecological guild', 'Non renseigné': 'Not recorded', 'Autres': 'Others', 'Zoom +': 'Zoom +', 'Zoom −': 'Zoom −',
  };

  const FRAG_KEYS = Object.keys(EN_FRAG).sort((a, b) => b.length - a.length);
  let FRAG_RES = null;
  function fragRes() {
    if (FRAG_RES) return FRAG_RES;
    const esc_ = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    FRAG_RES = FRAG_KEYS.map((k) => { let re; try { re = new RegExp('(?<![\\p{L}\\p{N}])' + esc_(k) + '(?![\\p{L}\\p{N}])', 'gu'); } catch (e) { re = new RegExp(esc_(k), 'g'); } return [re, EN_FRAG[k], k]; });
    return FRAG_RES;
  }
  // English version of a piece of text (identity in French)
  function tr(s) {
    if (LANG !== 'en' || !s) return s;
    const t = s.trim();
    if (t && Object.prototype.hasOwnProperty.call(EN_EXACT, t)) return s.replace(t, EN_EXACT[t]);
    let out = s;
    for (const [re, en, k] of fragRes()) { if (out.indexOf(k) >= 0) out = out.replace(re, en); }
    return out;
  }
  const SKIP_I18N = '#sp-list, .dr-title, .dr-latin, .dr-alias, #commune-results, #search-species, #commune-search, script, style, .sp-name';
  const ATTRS = ['title', 'placeholder', 'aria-label', 'alt'];
  function translateTree(root) {
    if (LANG !== 'en' || !root) return;
    if (root.nodeType === 3) { const v = root.nodeValue; if (v && v.trim()) { const t = tr(v); if (t !== v) root.nodeValue = t; } return; }
    if (root.nodeType !== 1) return;
    ATTRS.forEach((a) => { const v = root.getAttribute && root.getAttribute(a); if (v) { const t = tr(v); if (t !== v) root.setAttribute(a, t); } });   // placeholders and titles even on skipped elements
    if (root.matches && root.matches(SKIP_I18N)) return;                                                                                       // but never the names inside them
    root.childNodes.forEach(translateTree);
  }
  function initLanguage() {
    document.documentElement.lang = LANG;
    const b = document.getElementById('btn-lang');
    if (b) {
      b.textContent = LANG === 'en' ? 'FR' : 'EN'; b.title = LANG === 'en' ? 'Passer en français' : 'Switch to English';
      b.addEventListener('click', () => { try { window.localStorage.setItem('fongimap-lang', LANG === 'en' ? 'fr' : 'en'); } catch (e) { /* not remembered */ } location.href = location.pathname + '?lang=' + (LANG === 'en' ? 'fr' : 'en') + location.hash; });
    }
    if (LANG !== 'en') return;
    translateTree(document.body);
    new MutationObserver((recs) => {
      for (const r of recs) {
        if (r.type === 'characterData') translateTree(r.target);
        else if (r.type === 'attributes') { const v = r.target.getAttribute(r.attributeName), t = tr(v || ''); if (v && t !== v) r.target.setAttribute(r.attributeName, t); }
        else r.addedNodes.forEach(translateTree);
      }
    }).observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ATTRS });
  }
  if (LANG === 'en') MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  initLanguage();

  // ═══════════════════════════════════════════════════════════════════════════
  // Theme: light, dark or automatic (system preference). Panels, header and dialogs go dark; the map area keeps its
  // light "paper" palette so that every data colour and label halo stays validated (see .style.css, #map-container).
  // ═══════════════════════════════════════════════════════════════════════════
  const THEME_KEY = 'fongimap-theme';
  let themePref = 'auto';
  try { const v = window.localStorage.getItem(THEME_KEY); if (v === 'light' || v === 'dark') themePref = v; } catch (e) { /* blocked storage: automatic */ }
  const systemDark = () => !!(window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
  function applyTheme() { document.documentElement.setAttribute('data-theme', themePref === 'dark' || (themePref === 'auto' && systemDark()) ? 'dark' : 'light'); }
  function initTheme() {
    applyTheme();
    if (window.matchMedia) { const mq = window.matchMedia('(prefers-color-scheme: dark)'); if (mq.addEventListener) mq.addEventListener('change', applyTheme); }
    const sel = $('sel-theme'); if (!sel) return;
    sel.value = themePref;
    sel.addEventListener('change', () => { themePref = sel.value; try { window.localStorage.setItem(THEME_KEY, themePref === 'auto' ? '' : themePref); } catch (e) { /* not remembered */ } applyTheme(); });
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Bootstrap
  // ═══════════════════════════════════════════════════════════════════════════
  function setLoading(msg, pct) {
    $('loading-msg').textContent = msg;
    if (pct != null) $('loading-bar').style.width = pct + '%';
  }
  function showError(msg) {
    const p = $('loading-msg');
    p.className = 'error'; p.textContent = msg;
    $('loading-spinner').style.display = 'none';
    $('loading-bar-wrap').style.display = 'none';
  }
  // text of the worker: the inflate library + the core engine (assets/js/worker-source.js: a script file cannot read back its own text)
  const workerSource = () => (typeof window.FMAP_WORKER_SRC === 'string' ? window.FMAP_WORKER_SRC : '');

  // ── datasets delivered in chunks (append-only, by period): newest first, older ones in the background ─────────
  const noteStats = (st) => { spFamily = st.spFamily; dataStats = st; META.yearSpan = st.ymax ? st.ymin + '–' + st.ymax : ''; };
  function chunkScript(file) {
    return new Promise((resolve, reject) => {
      const s = document.createElement('script'); s.src = DATA_DIR + file;
      s.onload = () => { const c = window.FMAP_CHUNKS && window.FMAP_CHUNKS[file]; s.remove(); if (c) { delete window.FMAP_CHUNKS[file]; resolve(c); } else reject(new Error('Morceau vide : ' + file)); };
      s.onerror = () => reject(new Error('Morceau introuvable : ' + file));
      document.head.appendChild(s);
    });
  }
  async function loadChunk(i) { const c = await chunkScript(META.chunks[i].file); return engine.append({ b64: c.data, crc32: META.chunks[i].crc32, verify: VERIFY }); }
  async function loadRemainingChunks() {
    const total = META.chunks.length, el = $('chunk-progress');
    try {
      for (let i = total - 2, done = 1; i >= 0; i--, done++) {
        el.textContent = '· chargement des périodes ' + done + '/' + total + '…'; el.classList.remove('hidden');
        noteStats(await loadChunk(i));
        initNames(); BR.matchesFor = null; computeAlphaRank();
        await updateAll();
      }
    } catch (err) { console.error(err); el.textContent = '· ' + err.message; return; }
    el.classList.add('hidden'); updateHelpData();
  }

  async function boot() {
    try {
      setLoading('Lecture des données…', 5);
      await tick();
      if (!window.FMAP_META || typeof window.FMAP_DATA !== 'string') {
        throw new Error('Fichier data.js introuvable ou invalide.\nExécutez tools/build_data.py : il écrit assets/data/data.js à côté de index.html.');
      }
      META = window.FMAP_META; DICT = META.dicts; N = META.n_records;
      DEPTS = window.FMAP_DEPTS; REGIONS = window.FMAP_REGIONS;
      if (META.year_range) {
        YEAR_LO = META.year_range[0]; YEAR_HI = META.year_range[1];
        ['year-min', 'year-max'].forEach((id) => { $(id).min = YEAR_LO; $(id).max = YEAR_HI; });
        $('year-min').value = YEAR_LO; $('year-max').value = YEAR_HI;
      }
      speciesLower = DICT.species.map((s) => s.toLowerCase());
      mapDeptNames();
      if (META.edible) for (let i = 0; i < META.edible.codes.length; i++) ediOf[i] = META.edible.codes.charCodeAt(i) - 48;

      setLoading('Démarrage du moteur…', 10); await tick();
      const useWorker = !/[?&]worker=0\b/.test(location.search);        // ?worker=0 forces the main-thread engine
      const ds = (window.FMAP_DATASETS || []).filter((e) => e.id === (window.FMAP_DS_ID || 'fongibase'))[0];
      const remote = ds && ds.mode === 'remote' && ds.api ? { url: ds.api, dataset: ds.id } : null;
      engine = await FMAP_CORE.createEngineClient({ remote, worker: useWorker, workerSource: workerSource(), yieldFn: tick, onProgress: setLoading });
      const S = META.sites || { lon: [], lat: [], approx: [], cell: [], commune: [] };
      let st = await engine.init({
        b64: window.FMAP_DATA, N: META.chunks ? 0 : N, nSpecies: DICT.species.length,
        format: META.format, crc32: META.format && META.format.crc32, verify: VERIFY,
        sites: { lon: S.lon, lat: S.lat, approx: S.approx || [], cell: S.cell || [], commune: S.commune || [] },
        edible: META.edible ? META.edible.codes : null, drawnDepts: Array.from(deptFeat.keys()),
      }, setLoading);
      window.FMAP_DATA = null;
      if (META.chunks) st = await loadChunk(META.chunks.length - 1);       // newest period first: usable at once
      noteStats(st);
      initNames();

      setLoading('Préparation de la carte…', 75); await tick();
      buildMap();
      initSites();
      initCommunes();
      buildSidebar();
      initBrowser();
      initDrawer();
      initHelp();
      initUI();
      initPanelToggle();
      initNearby();
      initIgn();
      initTheme();

      setLoading('Premier rendu…', 90); await tick();
      await updateAll(true);
      initDatasets();
      const fromHash = applyHash(location.hash);        // a shared link restores its filters and view
      if (fromHash) await updateAll();
      bootDone = true;
      setLoading('Prêt', 100);
      $('loading-overlay').classList.add('hidden');
      if (!fromHash) maybeShowHelp();
      if (META.chunks && META.chunks.length > 1) loadRemainingChunks();
    } catch (err) {
      console.error(err);
      showError(String(err && err.message ? err.message : err));
    }
  }


  // ═══════════════════════════════════════════════════════════════════════════
  // Département name matching (CSV codes/names <-> GeoJSON names / codes)
  // ═══════════════════════════════════════════════════════════════════════════
  function normName(s) { return String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]/g, ''); }
  function normCode(s) { const t = String(s).trim().toUpperCase(); return /^\d+$/.test(t) ? String(parseInt(t, 10)) : t; }

  function mapDeptNames() {
    const byName = new Map(), byCode = new Map();
    DICT.dept.forEach((name, i) => {
      byName.set(normName(name), i);
      if (/^(\d{1,2}|2[ab])$/i.test(String(name).trim())) byCode.set(normCode(name), i);
      const m = String(name).match(/\((\d{1,2}|2[ABab])\)/);
      if (m) byCode.set(normCode(m[1]), i);
    });
    const unmatched = [];
    featDept = DEPTS.features.map((f, fi) => {
      const nm = normName(f.properties.nom);
      let idx = byName.has(nm) ? byName.get(nm) : -1;
      if (idx < 0 && byCode.has(normCode(f.properties.code))) idx = byCode.get(normCode(f.properties.code));
      if (idx >= 0) deptFeat.set(idx, fi); else unmatched.push(f.properties.nom);
      return idx;
    });
    if (unmatched.length) console.warn('FongiMap: départements de la carte sans données :', unmatched);
  }
  const deptName = (di) => (deptFeat.has(di) ? DEPTS.features[deptFeat.get(di)].properties.nom : DICT.dept[di]);


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
  const guildFr = (v) => (LANG === 'en' ? v : GUILD_FR[v] || v);
  const dictLabel = (dictName, v) => (dictName === 'guild' ? guildFr(v) : dictName === 'trophic' ? (LANG === 'en' ? v : TROPHIC_FR[v] || v) : v);

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


  // ═══════════════════════════════════════════════════════════════════════════
  // Update loop
  // ═══════════════════════════════════════════════════════════════════════════
  let updatePending = false, updateVer = 0;
  let agg = { total: 0, nSpecies: 0, nDepts: 0, gps: 0, bySpecies: new Uint32Array(65536), byDept: new Uint32Array(256) };
  function scheduleUpdate() {
    if (updatePending) return;
    updatePending = true;
    setTimeout(() => { updatePending = false; updateAll(); }, 0);
  }

  // filter state as plain arrays: this is what travels to the record engine
  function serializeState() {
    const a = (s) => Array.from(s);
    return { speciesSet: a(state.speciesSet), phylumSet: a(state.phylumSet), guildSet: a(state.guildSet), trophicSet: a(state.trophicSet),
      ecoregionSet: a(state.ecoregionSet), monthSet: a(state.monthSet), deptSet: a(state.deptSet),
      yearMin: state.yearMin, yearMax: state.yearMax, edible: state.edible, commune: state.commune };
  }

  // top-n indices of a counts array, optionally skipping one index (the "missing" code)
  function topN(counts, n, skip) {
    const idx = [];
    for (let i = 0; i < counts.length; i++) if (counts[i] > 0 && i !== skip) idx.push(i);
    idx.sort((a, b) => counts[b] - counts[a]);
    return idx.slice(0, n);
  }

  // filters -> counts (engine) -> every panel. A newer call supersedes an older one still waiting for the engine.
  async function updateAll(first) {
    const ver = ++updateVer, t0 = performance.now();
    siteFrom.set(siteShown);                   // animate bubbles / cells from what is on screen now
    clearTimeout(previewTimer); previewTok++; previewing = false; $('preview-tag').classList.add('hidden');
    labelVer++;
    const res = await engine.filter(serializeState());
    if (ver !== updateVer) return;
    if (metric === 'richness' || metric === 'rarefied') {
      const r = await engine.richness(metric);
      if (ver !== updateVer) return;
      deptRich.set(r.rich); deptRare.set(r.rare);
    }
    const t1 = performance.now();
    agg = res; siteTarget.set(res.siteCount);
    finishSites();
    lastAgg = agg;
    tipCache.clear(); tipTok++;
    updateStats(agg);
    updateMap(agg);
    renderBrowser(agg);
    syncUI();
    liveAnnounce(agg); scheduleHash();
    if (NEAR.me && NEAR.species >= 0 && !state.speciesSet.has(NEAR.species)) { NEAR.species = -1; refreshNearby(); }   // the species chosen in "Autour de moi" was cleared elsewhere
    startSiteAnim(first);
    const t3 = performance.now();
    perf.filter = res.ms.filter; perf.aggregate = res.ms.aggregate; perf.render = t3 - t1; perf.total = t3 - t0;
  }

  function tweenNumber(el, to) {
    const from = +el.dataset.v || 0; el.dataset.v = to;
    if (DUR === 0) { el.textContent = fmt(to); return; }
    d3.select(el).transition('num').duration(DUR).tween('text', () => { const i = d3.interpolateNumber(from, to); return (t) => { el.textContent = fmt(Math.round(i(t))); }; });
  }
  function updateStats(a) {
    tweenNumber($('n-filtered'), a.total); tweenNumber($('n-species'), a.nSpecies); tweenNumber($('n-depts'), a.nDepts);
  }


  // ═══════════════════════════════════════════════════════════════════════════
  // Map: choropleth, zoom, layers, place names, tooltips
  // ═══════════════════════════════════════════════════════════════════════════
  let projection, pathGen, zoom, mapSvg, gZoom, gBase, deptG, regionG, deptPaths, landClip, deptByArea = [];
  let tf = d3.zoomIdentity;
  const base = { s: 1, ox: 0, oy: 0, w: 0, h: 0, dpr: 0 };
  const tipCache = new Map();
  let featCount = [], featVal = [], deptArea = [], deptCentroid = [], layerMode = 'auto', legendKey = '';
  let metric = 'density', showApprox = true, legend = { title: '', note: '', cuts: [], labels: [], ramp: [] };
  let hover = null;                          // {type: 'site' | 'cluster' | 'cell' | 'dept', …} highlighted on the label canvas
  let clusters = [];                         // symbols drawn by the last drawSites() (screen coordinates)

  // choropleth measures. Raw counts mostly reflect département size and observer effort, so the default
  // is a density; richness (distinct species) and rarefied richness (species expected in RARE_N records,
  // Hurlbert) are less sensitive to how much each département has been surveyed.
  const METRICS = {
    density: { title: 'Observations par 100 km²', note: 'Reflète aussi le nombre d’observateurs.' },
    count: { title: 'Observations par département', note: 'Dépend de la taille du département.' },
    richness: { title: 'Espèces distinctes par département', note: 'Croît avec le nombre d’observations.' },
    rarefied: { title: 'Espèces attendues pour ' + RARE_N + ' observations', note: 'Comparable entre départements ; écarts souvent faibles.' },
  };

  function buildMap() {
    mapSvg = d3.select('#map-svg');
    gZoom = mapSvg.append('g');
    gBase = gZoom.append('g');
    // Lambert-93 (the official French projection): central meridian 3°E, standard parallels 44°N and 49°N
    projection = d3.geoConicConformal().rotate([-3, 0]).parallels([44, 49]).fitSize([VIRT, VIRT], DEPTS);
    pathGen = d3.geoPath(projection);
    deptArea = DEPTS.features.map((f) => d3.geoArea(f) * EARTH_R_KM * EARTH_R_KM);   // km², spherical
    deptCentroid = DEPTS.features.map((f) => pathGen.centroid(f));
    deptByArea = d3.range(DEPTS.features.length).sort((p, q) => deptArea[q] - deptArea[p]);
    landClip = new Path2D(); d3.geoPath(projection, landClip)(DEPTS);     // land area of France, used to mask the canvas layers

    deptG = gBase.append('g').attr('class', 'dept-layer');
    deptPaths = deptG.selectAll('path').data(DEPTS.features).join('path')
      .attr('class', 'dept-path').attr('d', pathGen).attr('fill', COL_ZERO)
      .on('click', (e, d) => {
        if (onMapClick(e)) return;
        const di = featDept[DEPTS.features.indexOf(d)];
        if (di >= 0) { toggleSet(state.deptSet, di); scheduleUpdate(); }
      })
      .on('dblclick', (e, d) => { e.preventDefault(); const b = pathGen.bounds(d); flyTo(b[0][0], b[0][1], b[1][0], b[1][1]); });
    regionG = gBase.append('g');
    regionG.selectAll('path').data(REGIONS.features).join('path').attr('class', 'region-path').attr('d', pathGen);
    initPlaces();

    zoom = d3.zoom().scaleExtent([1, 80]).on('zoom', (e) => {
      tf = e.transform;
      gZoom.attr('transform', tf);
      hideTip();
      if (quietZoom) requestDraw(); else onMotion();
      scheduleHash();
    });
    mapSvg.call(zoom).on('dblclick.zoom', null);
    mapSvg.on('mousemove', onMapMove).on('mouseleave', hideTip).on('click', (e) => { if (!(e.target.classList && e.target.classList.contains('dept-path'))) onMapClick(e); });
    $('btn-zoom-in').onclick = () => mapSvg.transition().duration(DUR || 1).call(zoom.scaleBy, 1.8);
    $('btn-zoom-out').onclick = () => mapSvg.transition().duration(DUR || 1).call(zoom.scaleBy, 1 / 1.8);
    $('btn-zoom-reset').onclick = () => mapSvg.transition().duration(DUR * 1.2 || 1).call(zoom.transform, d3.zoomIdentity);

    // options popover (secondary map controls, hidden by default: progressive disclosure)
    const pop = $('options-pop');
    $('btn-options').addEventListener('click', (e) => { e.stopPropagation(); pop.classList.toggle('hidden'); $('btn-options').classList.toggle('on', !pop.classList.contains('hidden')); });
    document.addEventListener('click', (e) => { if (!pop.classList.contains('hidden') && !e.target.closest('#options-wrap')) { pop.classList.add('hidden'); $('btn-options').classList.remove('on'); } });
    $('seg-layer').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) setLayerMode(b.dataset.v); });
    $('sel-metric').addEventListener('change', (e) => { metric = e.target.value; scheduleUpdate(); });
    $('chk-approx').addEventListener('change', (e) => { showApprox = e.target.checked; scheduleUpdate(); });

    // locator inset: France with the current viewport; click to recentre
    d3.select('#locator-map').attr('d', pathGen(REGIONS));
    $('locator').addEventListener('click', (e) => {
      const r = $('locator').getBoundingClientRect();
      const vx = (e.clientX - r.left) / r.width * VIRT, vy = (e.clientY - r.top) / r.height * VIRT;
      mapSvg.transition().duration(DUR || 1).call(zoom.translateTo, base.ox + base.s * vx, base.oy + base.s * vy);
    });
    new ResizeObserver(layoutMap).observe($('map-container'));
    layoutMap();
  }

  function setLayerMode(m) {
    layerMode = m;
    document.querySelectorAll('#seg-layer button').forEach((b) => b.classList.toggle('on', b.dataset.v === m));
    requestDraw(); scheduleHash();
  }

  // fit the virtual 1000x1000 map box into the container; size canvases
  function layoutMap() {
    const box = $('map-container').getBoundingClientRect();
    const w = Math.max(10, Math.round(box.width)), h = Math.max(10, Math.round(box.height)), dpr0 = window.devicePixelRatio || 1;
    if (w === base.w && h === base.h && dpr0 === base.dpr) return;
    base.w = w; base.h = h; base.dpr = dpr0;
    base.s = Math.min(w, h) / VIRT * 0.97;
    base.ox = (w - base.s * VIRT) / 2;
    base.oy = (h - base.s * VIRT) / 2;
    gBase.attr('transform', 'translate(' + base.ox + ',' + base.oy + ') scale(' + base.s + ')');
    zoom.extent([[0, 0], [w, h]]).translateExtent([[0, 0], [w, h]]);
    const dpr = window.devicePixelRatio || 1;
    ['grid-canvas', 'commune-canvas', 'ign-canvas', 'dot-canvas', 'label-canvas'].forEach((id) => {
      const c = $(id);
      c.width = Math.round(w * dpr); c.height = Math.round(h * dpr);
      c.getContext('2d').setTransform(dpr, 0, 0, dpr, 0, 0);
    });
    labelKey = '';
    resetCanvasTransform();
    requestDraw();
  }

  // restrict drawing to the land area of France (département polygons): nothing over the sea or abroad
  function clipToLand(ctx) {
    const dpr = window.devicePixelRatio || 1, k = tf.k, a = k * base.s * dpr;
    ctx.setTransform(a, 0, 0, a, (tf.x + k * base.ox) * dpr, (tf.y + k * base.oy) * dpr);
    ctx.clip(landClip);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  // département borders over the cells / places, so a cell is visibly cut where a border passes
  function strokeBorders(ctx, colour, px) {
    const dpr = window.devicePixelRatio || 1, k = tf.k, a = k * base.s;
    ctx.setTransform(a * dpr, 0, 0, a * dpr, (tf.x + k * base.ox) * dpr, (tf.y + k * base.oy) * dpr);
    ctx.lineWidth = px / a; ctx.strokeStyle = colour; ctx.lineJoin = 'round';
    ctx.stroke(landClip);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  // smooth fly-to a bounding box given in virtual map coordinates
  function flyTo(x0, y0, x1, y1) {
    const availW = $('map-container').classList.contains('drawer-open') ? Math.max(200, base.w - 340) : base.w;
    const bw = Math.max(1, (x1 - x0) * base.s), bh = Math.max(1, (y1 - y0) * base.s);
    const k = Math.max(1, Math.min(60, 0.78 * Math.min(availW / bw, base.h / bh)));
    const cx = base.ox + base.s * (x0 + x1) / 2, cy = base.oy + base.s * (y0 + y1) / 2;
    mapSvg.transition().duration(DUR * 1.4 || 1).ease(d3.easeCubicInOut)
      .call(zoom.transform, d3.zoomIdentity.translate(availW / 2 - k * cx, base.h / 2 - k * cy).scale(k));
  }
  // same, from a [x0, y0, x1, y1] box, never tighter than ~60 km so a single place stays readable
  function flyToBox(b, minHalf) {
    const m = minHalf || 30, cx = (b[0] + b[2]) / 2, cy = (b[1] + b[3]) / 2, hw = Math.max(m, (b[2] - b[0]) / 2 + 8), hh = Math.max(m, (b[3] - b[1]) / 2 + 8);
    flyTo(cx - hw, cy - hh, cx + hw, cy + hh);
  }


  // ── per-département species statistics (richness, rarefied richness) ─────────
  const deptRich = new Float32Array(256), deptRare = new Float32Array(256).fill(NaN);
  const fmtVal = (v) => (v >= 100 ? fmt(Math.round(v)) : v >= 10 ? String(Math.round(v)) : v >= 1 ? String(Math.round(v * 10) / 10).replace('.', ',') : String(Math.round(v * 100) / 100).replace('.', ','));
  // round a class boundary to a readable value (1, 1.5, 2, 2.5, 3, 4, 5, 6, 8 × a power of ten)
  function niceCut(v) {
    if (!(v > 0)) return 0;
    const p = Math.pow(10, Math.floor(Math.log10(v))), m = v / p;
    const steps = [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10];
    let best = steps[0];
    for (const s of steps) if (Math.abs(Math.log(m / s)) < Math.abs(Math.log(m / best))) best = s;
    return Math.round(best * p * 100) / 100;
  }

  // recolour départements: 6 classes with rounded boundaries on the chosen measure (lightness ramp = relative quantity)
  function updateMap(a) {
    featCount = DEPTS.features.map((_, fi) => (featDept[fi] >= 0 ? a.byDept[featDept[fi]] : 0));
    featVal = DEPTS.features.map((_, fi) => {
      const d = featDept[fi]; if (d < 0) return null;
      if (metric === 'count') return featCount[fi] || null;
      if (metric === 'density') return featCount[fi] ? featCount[fi] / (deptArea[fi] / 100) : null;
      if (metric === 'richness') return deptRich[d] || null;
      return deptRare[d] === deptRare[d] ? deptRare[d] : null;       // NaN -> insufficient data
    });
    const vals = featVal.filter((v) => v !== null && v > 0);
    const raw = d3.scaleQuantile().domain(vals.length ? vals : [0]).range(d3.range(6)).quantiles();
    const dedupe = (arr) => { const o = []; arr.forEach((c) => { if (c > 0 && (!o.length || c > o[o.length - 1])) o.push(c); }); return o; };
    let cuts = dedupe(raw.map(niceCut));
    if (cuts.length < 4) cuts = dedupe(raw.map((v) => (v < 10 ? Math.round(v * 10) / 10 : Math.round(v))));   // narrow range: finer rounding
    const nRamp = cuts.length + 1;
    const ramp = d3.quantize((t) => d3.interpolateYlGn(0.2 + 0.78 * t), Math.max(2, nRamp)).slice(0, nRamp);
    const scale = d3.scaleThreshold().domain(cuts).range(ramp);
    const labels = ramp.map((_, i) => (i === 0 ? 'moins de ' + fmtVal(cuts[0] === undefined ? 0 : cuts[0]) : i === cuts.length ? fmtVal(cuts[i - 1]) + ' et plus' : fmtVal(cuts[i - 1]) + ' – ' + fmtVal(cuts[i])));
    legend = { title: METRICS[metric].title, note: METRICS[metric].note, cuts, ramp, labels };
    const anySel = state.deptSet.size > 0;
    deptPaths
      .attr('fill', (d, fi) => (featVal[fi] === null ? COL_ZERO : scale(featVal[fi])))
      .classed('selected', (d, fi) => anySel && state.deptSet.has(featDept[fi]))
      .classed('dim', (d, fi) => anySel && !state.deptSet.has(featDept[fi]));
    if (anySel) deptPaths.filter('.selected').raise();
    legendKey = '';                              // force legend refresh
    requestDraw();
  }


  // ── semantic zoom: how visible each layer is ─────────────────────────────
  function layerAlphas() {
    const k = tf.k, hc = hasCommunes();
    switch (layerMode) {
      case 'dept': return { gridA: 0, communeA: 0, dotA: 0 };
      case 'grid': return { gridA: 1, communeA: 0, dotA: 0 };
      case 'communes': return { gridA: 0, communeA: hc ? 1 : 0, dotA: 0 };
      case 'sites': return { gridA: 0, communeA: 0, dotA: 1 };
      default: return { gridA: smooth(1.7, 2.8, k), communeA: hc ? smooth(COMMUNE_K[0], COMMUNE_K[1], k) : 0, dotA: hc ? smooth(SITE_K[0], SITE_K[1], k) : smooth(5.2, 6.4, k) };
    }
  }

  // one legend at a time: the layer that dominates the current view
  function renderLegend(al) {
    const kind = al.dotA > 0.5 ? 'sites' : al.communeA > 0.5 ? 'commune' : al.gridA > 0.5 ? 'grid' : 'dept';
    const hint = layerMode === 'auto' && kind === 'dept' && tf.k < 2.4;
    const key = [kind, showApprox, hint, legend.title, legend.cuts.join(','), metric, communeCuts.join(','), ignVisible() ? (ign.forest ? 'f' : '') + (ign.alt ? 'a' : '') : '-'].join('|');
    if (key === legendKey) return;
    legendKey = key;
    const row = (swatch, label) => '<li>' + swatch + '<span>' + label + '</span></li>';
    let html;
    if (kind === 'dept') {
      html = '<p class="lg-title" role="heading" aria-level="2">' + esc(legend.title) + '</p><ul>' + legend.ramp.map((c, i) => row('<i class="sw" style="background:' + c + '"></i>', legend.labels[i])).join('') +
        row('<i class="sw" style="background:' + COL_ZERO + '"></i>', 'aucune observation') + '</ul>' +
        '<p class="legend-note">' + esc(legend.note) + (hint ? ' Zoomez : des hexagones puis des lieux apparaissent.' : '') + '</p>';
    } else if (kind === 'commune') {
      const byCount = metric === 'count';
      html = '<p class="lg-title" role="heading" aria-level="2">' + (byCount ? 'Observations par commune' : 'Observations par km²') + '</p><ul>' +
        communeRamp.map((c, i) => row('<i class="sw" style="background:' + c + '"></i>', communeLabels[i])).join('') +
        row('<i class="sw" style="background:' + COL_ZERO + '"></i>', 'aucune observation') + '</ul>' +
        '<p class="legend-note">Chaque commune est colorée selon son nombre d’observations' + (byCount ? '' : ' rapporté à sa surface') + '. Les lieux au centre de la commune n’ont pas de position plus fine : la commune est l’échelle fiable. Traits : commune &lt; département &lt; région.</p>';
    } else if (kind === 'grid') {
      html = '<p class="lg-title" role="heading" aria-level="2">Observations par hexagone</p><p class="legend-note top">Chaque hexagone mesure 10 km de large (≈ 87 km²) : plus il est foncé, plus il y a eu d’observations.</p><ul>' +
        CELL_LABELS.map((l, i) => row('<i class="sw" style="background:' + cellColour(i) + '"></i>', l)).join('') + '</ul>';
    } else {
      html = '<p class="lg-title" role="heading" aria-level="2">Observations par lieu</p><ul class="circles">' +
        SYM_RADII.map((rr, i) => row('<i class="circ" style="width:' + Math.round(2 * rr) + 'px;height:' + Math.round(2 * rr) + 'px"></i>', SYM_LABELS[i])).join('') + '</ul>' +
        '<ul class="kinds">' + row('<i class="circ exact"></i>', 'position GPS') +
        (showApprox ? row('<i class="circ approx"></i>', 'centre de commune (approximatif)') : '') +
        row('<i class="circ exact group"></i>', 'plusieurs lieux proches regroupés') + '</ul>';
    }
    $('map-legend').innerHTML = html + ignLegendHtml();
    $('map-legend').classList.remove('swap'); void $('map-legend').offsetWidth; $('map-legend').classList.add('swap');
  }

  // ── GPS sites and 10 km grid cells ───────────────────────────────────────
  let nCells = 0, cellPX = null, cellPY = null, siteCell = null, cellW = null, cellTarget = null, cellTree = null, cellSize = 10;
  let siteLoc = [];
  function initSites() {
    const S = META.sites || { lon: [], lat: [], loc: [], names: [''] };
    nSites = S.lon.length; siteName = S.names;
    const lonK = (META.lon_max - META.lon_min) / Q_MAX, latK = (META.lat_max - META.lat_min) / Q_MAX;
    sitePX = new Float32Array(nSites); sitePY = new Float32Array(nSites);
    for (let k = 0; k < nSites; k++) {
      const p = projection([META.lon_min + S.lon[k] * lonK, META.lat_min + S.lat[k] * latK]) || [NaN, NaN];
      sitePX[k] = p[0]; sitePY[k] = p[1];
    }
    siteTarget = new Uint32Array(nSites); siteFrom = new Float32Array(nSites); siteShown = new Float32Array(nSites);
    COM = META.communes || COM; siteCommune = Int32Array.from(S.commune || new Array(nSites).fill(-1));
    siteLoc = S.loc; siteApprox = S.approx || new Array(nSites).fill(0);

    // 10 km hexagons (equal area) in Lambert-93, corners computed by build.py
    const C = META.cells || { q: [], r: [], corners: [] };
    nCells = C.q.length; siteCell = Int32Array.from(S.cell || new Array(nSites).fill(0));
    cellPX = new Float32Array(nCells * 6); cellPY = new Float32Array(nCells * 6);
    cellW = new Float32Array(nCells); cellTarget = new Float32Array(nCells);
    const cx = new Float32Array(nCells), cy = new Float32Array(nCells);
    for (let c = 0; c < nCells; c++) {
      for (let v = 0; v < 6; v++) {
        const p = projection([C.corners[c * 12 + v * 2], C.corners[c * 12 + v * 2 + 1]]);
        cellPX[c * 6 + v] = p[0]; cellPY[c * 6 + v] = p[1]; cx[c] += p[0] / 6; cy[c] += p[1] / 6;
      }
    }
    if (nCells) cellSize = Math.hypot(cellPX[0] - cellPX[1], cellPY[0] - cellPY[1]);
    cellTree = d3.quadtree().x((c) => cx[c]).y((c) => cy[c]).addAll(d3.range(nCells));
  }

  // after counting: drop approximate sites if asked, then sum sites into their grid cell
  function finishSites() {
    if (!showApprox) for (let k = 0; k < nSites; k++) if (siteApprox[k]) siteTarget[k] = 0;
    cellTarget.fill(0);
    for (let k = 0; k < nSites; k++) cellTarget[siteCell[k]] += siteTarget[k];
    updateCommunes();
  }

  // graduated symbols (classed sizes, explicit legend) instead of a continuous radius
  const symZoom = (k) => 0.9 + 0.04 * Math.log2(k);
  const siteR = (w, zf) => SYM_RADII[symClass(w)] * zf;

  let animRaf = 0, animStart = 0;
  function startSiteAnim(first) {
    if (DUR === 0 || first) { for (let k = 0; k < nSites; k++) siteShown[k] = siteTarget[k]; requestDraw(); return; }
    animStart = performance.now();
    if (!animRaf) animRaf = requestAnimationFrame(animStep);
  }
  function animStep(now) {
    const t = Math.min(1, (now - animStart) / DUR), e = EASE(t);
    for (let k = 0; k < nSites; k++) siteShown[k] = siteFrom[k] + (siteTarget[k] - siteFrom[k]) * e;
    if (!moving) drawLayers();
    animRaf = t < 1 ? requestAnimationFrame(animStep) : 0;
  }

  let drawQueued = false;
  function requestDraw() {
    if (drawQueued || moving) return;                  // during a gesture the settle step redraws everything once
    drawQueued = true;
    requestAnimationFrame(() => { drawQueued = false; if (!moving) drawLayers(); });
  }

  // ── motion: while the user pans or zooms, the canvases keep their last bitmap and the compositor moves it (CSS
  //    transform, no JavaScript per frame). The costly redraw happens once the gesture pauses, or at most every
  //    few hundred ms during a long gesture or fly-to, so panning stays smooth at every zoom level. ─────────
  const SETTLE_MS = 140, CANVAS_IDS = ['grid-canvas', 'commune-canvas', 'ign-canvas', 'dot-canvas', 'label-canvas'];
  let moving = false, settleTimer = 0, drawnTf = { x: 0, y: 0, k: 1 }, lastDrawAt = 0, lastDrawMs = 0, canvasEls = null;
  function resetCanvasTransform() {
    if (!canvasEls) canvasEls = CANVAS_IDS.map($);
    canvasEls.forEach((c) => { c.style.transform = ''; });
    canvasEls[4].style.visibility = '';
  }
  function onMotion() {
    if (!siteShown) return;
    if (!moving) lastDrawAt = performance.now();          // a gesture never starts with a full redraw
    moving = true;
    clearTimeout(settleTimer); settleTimer = setTimeout(settle, SETTLE_MS);
    if (!canvasEls) canvasEls = CANVAS_IDS.map($);
    if (performance.now() - lastDrawAt > Math.max(450, lastDrawMs * 6)) { drawLayers(true); return; }   // long gesture: refresh the bitmap now and then
    const s = tf.k / drawnTf.k, css = 'translate(' + (tf.x - s * drawnTf.x).toFixed(2) + 'px,' + (tf.y - s * drawnTf.y).toFixed(2) + 'px) scale(' + s.toFixed(5) + ')';
    canvasEls.forEach((c) => { c.style.transform = css; });
    canvasEls[4].style.visibility = s > 1.5 || s < 0.67 ? 'hidden' : '';      // stretched text is unreadable: hide it until the redraw
  }
  function settle() { moving = false; clearTimeout(settleTimer); drawLayers(); }

  const cellColour = (i) => d3.interpolateYlOrBr(0.16 + 0.72 * i / 4);

  // draw dept fade, grid cells, sites, place names, scale bar and locator for the current zoom / mode
  function drawLayers(interim) {
    if (!siteShown) return;
    const t0 = performance.now();
    drawnTf = { x: tf.x, y: tf.y, k: tf.k };
    resetCanvasTransform();
    const al = layerAlphas();
    deptG.style('opacity', 1 - 0.7 * Math.max(al.gridA, al.communeA, al.dotA));     // the choropleth recedes once finer layers take over
    regionG.style('display', al.communeA > 0.99 ? 'none' : null);                   // the commune canvas draws the region borders itself: no SVG strokes to repaint
    const gridVis = al.gridA * (1 - al.communeA) * (1 - al.dotA);
    $('grid-canvas').style.opacity = gridVis.toFixed(3);
    $('commune-canvas').style.opacity = al.communeA.toFixed(3);
    $('dot-canvas').style.opacity = al.dotA.toFixed(3);
    if (gridVis > 0.01) drawGrid();
    if (al.communeA > 0.01) drawCommunes(al); else if (visCommunes.length) { visCommunes = []; $('commune-canvas').getContext('2d').clearRect(0, 0, base.w, base.h); }
    drawIgn(interim);
    if (al.dotA > 0.01) drawSites(); else clusters = [];
    renderLegend(al);
    updateScale(); updateLocator();
    layoutLabels(al); paintLabels();
    lastDrawAt = performance.now(); lastDrawMs = lastDrawAt - t0; perf.draw = lastDrawMs;
  }

  // amber graduated symbols; places closer than CLUSTER_PX on screen are grouped (cluster, don't remove)
  function drawSites() {
    const ctx = $('dot-canvas').getContext('2d');
    ctx.clearRect(0, 0, base.w, base.h);
    const k = tf.k, a = k * base.s, bx = tf.x + k * base.ox, by = tf.y + k * base.oy, zf = symZoom(k);
    const cols = Math.ceil((base.w + 40) / CLUSTER_PX) + 2, grid = new Map(), out = [];
    for (let s = 0; s < nSites; s++) {
      const w = siteShown[s];
      if (w < 0.5) continue;
      const x = bx + a * sitePX[s], y = by + a * sitePY[s];
      if (x < -20 || y < -20 || x > base.w + 20 || y > base.h + 20) continue;
      const key = (((y + 20) / CLUSTER_PX) | 0) * cols + (((x + 20) / CLUSTER_PX) | 0);
      let c = grid.get(key);
      if (c === undefined) { c = { x, y, sx: x * w, sy: y * w, W: w, n: 1, s, ap: siteApprox[s] ? w : 0, m: null }; grid.set(key, c); out.push(c); }
      else { c.sx += x * w; c.sy += y * w; c.W += w; c.n++; if (siteApprox[s]) c.ap += w; if (!c.m) c.m = [c.s]; c.m.push(s); }
    }
    for (const c of out) { if (c.n > 1) { c.x = c.sx / c.W; c.y = c.sy / c.W; } c.r = siteR(c.W, zf); }
    out.sort((p, q) => q.W - p.W);              // big first: small symbols end up on top
    ctx.save(); clipToLand(ctx);
    strokeBorders(ctx, 'rgba(60,52,38,.4)', 0.9);
    for (const c of out) {
      const approx = c.ap >= 0.5 * c.W;
      ctx.beginPath(); ctx.arc(c.x, c.y, c.r, 0, 6.2832);
      ctx.fillStyle = approx ? 'rgba(214,134,26,.28)' : 'rgba(214,134,26,.84)'; ctx.fill();
      ctx.strokeStyle = approx ? 'rgba(150,88,12,.75)' : '#5c3406'; ctx.lineWidth = c.n > 1 ? 2 : 1; ctx.stroke();
    }
    ctx.restore();
    clusters = out;
  }

  // 10 km hexagons in 5 lightness classes of the number of observations, with département borders on top
  function drawGrid() {
    const ctx = $('grid-canvas').getContext('2d');
    ctx.clearRect(0, 0, base.w, base.h);
    const k = tf.k, a = k * base.s, bx = tf.x + k * base.ox, by = tf.y + k * base.oy;
    cellW.fill(0);
    for (let s = 0; s < nSites; s++) cellW[siteCell[s]] += siteShown[s];
    const paths = CELL_LABELS.map(() => new Path2D());
    for (let c = 0; c < nCells; c++) {
      const w = cellW[c];
      if (w < 0.5) continue;
      const o = c * 6, x0 = bx + a * cellPX[o], y0 = by + a * cellPY[o];
      if (x0 < -80 || y0 < -80 || x0 > base.w + 80 || y0 > base.h + 80) continue;
      const p = paths[cellClass(w)];
      p.moveTo(x0, y0);
      for (let v = 1; v < 6; v++) p.lineTo(bx + a * cellPX[o + v], by + a * cellPY[o + v]);
      p.closePath();
    }
    ctx.save(); clipToLand(ctx);
    ctx.globalAlpha = 0.92; ctx.lineWidth = 0.6;
    paths.forEach((p, l) => { const col = cellColour(l); ctx.fillStyle = col; ctx.strokeStyle = col; ctx.fill(p); ctx.stroke(p); });
    ctx.globalAlpha = 1;
    strokeBorders(ctx, 'rgba(45,38,26,.75)', 1.3);
    ctx.restore();
  }


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
    drawMe(ctx);
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
    if (NEAR.placing) { placeAt(e); return true; }        // "Autour de moi": the next click chooses the point
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
    if (moving) return;                                  // hit-test data describes the last redraw, not the bitmap being moved
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
    m.l = layerMode; m.mt = metric; m.n = namePref; m.fo = ign.forest ? 1 : 0; m.al = ign.alt ? 1 : 0;
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
    if (typeof m.fo === 'number' && (m.fo === 0) === ign.forest) setIgn('forest', m.fo === 1);
    if (typeof m.al === 'number' && (m.al === 0) === ign.alt) setIgn('alt', m.al === 1);
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
    const rows = [['nom_francais', 'nom_latin', 'cd_ref_taxref', 'famille', 'observations', 'comestibilite_indicative', 'source']];
    const idx = [];
    for (let s = 0; s < DICT.species.length; s++) if (lastAgg.bySpecies[s] > 0) idx.push(s);
    idx.sort((p, r) => lastAgg.bySpecies[r] - lastAgg.bySpecies[p] || p - r);
    idx.forEach((s) => rows.push([hasFr(s) ? frOf.get(s)[0] : '', DICT.species[s], (META.cdref && META.cdref[s]) || '', spFamily[s] !== MISSING ? DICT.family[spFamily[s]] : '', lastAgg.bySpecies[s], EDI[ediOf[s]].label, SOURCE_LINE]));
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
    ['grid-canvas', 'commune-canvas', 'ign-canvas', 'dot-canvas', 'label-canvas'].forEach((id) => {
      const c = $(id); ctx.globalAlpha = c.style.opacity === '' ? 1 : +c.style.opacity; ctx.drawImage(c, 0, 0, W * S, H * S);
    });
    ctx.globalAlpha = 1;
    // legend
    const lg = $('map-legend'), title = lg.querySelector('.lg-title'), lis = Array.from(lg.querySelectorAll('li'));
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
    ctx.fillText('FongiMap · ' + SOURCE_LINE + ' · limites IGN / Etalab' + (ignVisible() ? ' · forêts et altitudes : IGN (Licence Ouverte)' : '') + ' · comestibilité indicative' + (filters ? ' · ' + filters : '') + ' · ' + stamp(), 8 * S, (H - 11) * S, (W - 16) * S);
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

  // ── datasets ─────────────────────────────────────────────────────────────
  const currentDataset = () => (window.FMAP_DATASETS || []).filter((e) => e.id === (window.FMAP_DS_ID || 'fongibase'))[0] || null;
  function initDatasets() {
    const list = window.FMAP_DATASETS || [], cur = currentDataset(), sel = $('sel-dataset');
    if (list.length > 1) {
      sel.innerHTML = list.map((e) => '<option value="' + esc(e.id) + '"' + (cur && cur.id === e.id ? ' selected' : '') + '>' + esc(e.title) + (e.synthetic ? ' (synthétique)' : '') + '</option>').join('');
      sel.classList.remove('hidden');
      sel.addEventListener('change', () => { location.href = location.pathname + (sel.value === 'fongibase' ? '' : '?ds=' + encodeURIComponent(sel.value)) + location.hash; });   // a full reload: dictionaries and places differ per dataset
    }
    if (cur && cur.synthetic) $('ds-banner').classList.remove('hidden');
    if (cur && cur.id !== 'fongibase') {
      $('ds-credit').textContent = 'Jeu « ' + cur.title + ' » : ' + (cur.credit || cur.source || '') + (cur.licence ? ' — ' + cur.licence : '') + (cur.updated ? ' — mis à jour le ' + cur.updated : '') + '.';
      document.title = cur.title + ' — FongiMap';
    }
  }

  function initUI() {
    initMapKeyboard();
    $('btn-copylink').addEventListener('click', copyLink);
    $('btn-png').addEventListener('click', () => { exportPNG().catch((err) => { console.error(err); window.alert('Export impossible : ' + err.message); }); });
    $('btn-csv').addEventListener('click', exportCSV);
    window.addEventListener('hashchange', () => { if (bootDone && !applyingHash && applyHash(location.hash)) scheduleUpdate(); });
  }

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
        r.append('span').attr('class', 'sp-badge').attr('aria-hidden', 'true').append('i');
        const m = r.append('span').attr('class', 'sp-main'); m.append('em').attr('class', 'sp-name'); m.append('small').attr('class', 'sp-fam'); m.append('span').attr('class', 'sr-only sp-edi');
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
      .attr('title', (d) => d.name + (d.fr ? ' (' + d.latin + ')' : '') + ' — ' + EDI[d.edi].label);
    sel.select('.sp-badge').style('background', (d) => EDI[d.edi].colour).style('color', (d) => EDI[d.edi].ink).select('i').text((d) => EDI[d.edi].icon);
    sel.select('.sp-edi').text((d) => ' — ' + EDI[d.edi].label);
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


  // ═══════════════════════════════════════════════════════════════════════════
  // Side panel toggle (issue #13): the left panel (species list, filters, around-me) can be hidden to give the map the
  // whole window. Two controls drive it (the button in the top bar and the handle on the panel edge), plus the "["
  // key and Ctrl/Cmd + B. The choice is remembered. Hiding the panel resizes the map once, instantly (no animated
  // layout, which would redraw the canvases at every frame); the geography under the eyes stays where it was.
  // ═══════════════════════════════════════════════════════════════════════════
  const SIDE_KEY = 'fongimap-sidebar';
  let sideOpen = true, quietZoom = false;
  try { if (window.localStorage.getItem(SIDE_KEY) === 'closed') sideOpen = false; } catch (e) { /* storage blocked: open */ }

  function paintSidebarControls() {
    const label = sideOpen ? 'Masquer le panneau latéral ([)' : 'Afficher le panneau latéral ([)', aria = sideOpen ? 'Masquer le panneau latéral' : 'Afficher le panneau latéral';
    ['btn-side', 'side-rail'].forEach((id) => {
      const b = $(id); if (!b) return;
      b.setAttribute('aria-expanded', sideOpen ? 'true' : 'false'); b.title = tr(label); b.setAttribute('aria-label', tr(aria));
    });
    $('main').classList.toggle('side-collapsed', !sideOpen);
  }

  // open / close the panel. user = false for the silent restore at start-up.
  function setSidebar(open, user) {
    open = !!open;
    if (open === sideOpen && user !== undefined) return;
    sideOpen = open;
    paintSidebarControls();
    if (user) {
      try { window.localStorage.setItem(SIDE_KEY, open ? 'open' : 'closed'); } catch (e) { /* not remembered */ }
      $('live').textContent = tr(open ? 'Panneau latéral affiché.' : 'Panneau latéral masqué.');
      if (open) {                                          // the panel slides in; closing is instant
        const m = $('main'); m.classList.remove('side-opening'); void m.offsetWidth; m.classList.add('side-opening');
        $('sidebar').addEventListener('animationend', () => m.classList.remove('side-opening'), { once: true });
      }
    }
    if (!zoom) return;                                     // before the map exists nothing needs to move
    const w0 = base.w;
    layoutMap();                                           // synchronous: reads the new size of the map area
    if (getComputedStyle($('main')).flexDirection.indexOf('row') === 0 && w0 && base.w !== w0) {
      quietZoom = true;                                    // keep the geography where it was on screen (the map area grew or shrank on its left)
      try { mapSvg.call(zoom.translateBy, (base.w - w0) / tf.k, 0); } finally { quietZoom = false; }
    }
    requestDraw();
  }
  const toggleSidebar = () => setSidebar(!sideOpen, true);
  function ensureSidebar() { if (!sideOpen) setSidebar(true, true); }

  function initPanelToggle() {
    paintSidebarControls();
    $('btn-side').addEventListener('click', toggleSidebar);
    $('side-rail').addEventListener('click', toggleSidebar);
    document.addEventListener('keydown', (e) => {
      const t = e.target, typing = t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));
      if ((e.key === '[' && !typing && !e.ctrlKey && !e.metaKey && !e.altKey) || ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'b')) { e.preventDefault(); toggleSidebar(); }
    });
  }
  if (!sideOpen) paintSidebarControls();                   // restored before the first layout: the map starts at its final size

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
    updateHelpData();
  }
  function updateHelpData() {
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
    if (o.pick !== undefined && o.pick >= 0) { setSpecies([o.pick], displayName(o.pick)); openSpecies(o.pick, true); }
    else mapSvg.transition().duration(DUR || 1).call(zoom.transform, d3.zoomIdentity);
    updateAll();
  }


  // ═══════════════════════════════════════════════════════════════════════════
  // Species drawer (details on demand)
  // ═══════════════════════════════════════════════════════════════════════════
  let drawerSpecies = -1;

  function initDrawer() { $('drawer-close').addEventListener('click', closeDrawer); }
  function closeDrawer() { $('map-container').classList.remove('drawer-open'); $('drawer').setAttribute('aria-hidden', 'true'); $('drawer').setAttribute('inert', ''); drawerSpecies = -1; }

  // all-time statistics of a species (engine pass), then the map-dependent parts (bounding box of its places)
  async function scanSpecies(idx) {
    const r = await engine.scanSpecies(idx);
    const px = [], py = [];
    r.sites.forEach((s) => { px.push(sitePX[s]); py.push(sitePY[s]); });
    px.sort(d3.ascending); py.sort(d3.ascending);
    const q = (arr, p) => (arr.length ? d3.quantile(arr, p) : null);
    const topDepts = topN(r.de, 5, MISSING).filter((d) => deptFeat.has(d)).map((d) => ({ name: deptName(d), n: r.de[d] }));
    let gB = -1, gM = 0; for (let g = 0; g < 255; g++) if (r.gu[g] > gM) { gM = r.gu[g]; gB = g; }
    const tx = r.tax;
    return {
      n: r.n, y0: r.y0, y1: r.y1, months: Array.from(r.months).slice(1), sites: r.sites.length, nDepts: r.de.reduce((s, c, d) => s + (c > 0 && deptFeat.has(d) ? 1 : 0), 0), topDepts,
      guild: gB >= 0 ? DICT.guild[gB] : null,
      tax: tx ? { phylum: DICT.phylum[tx.phylum], class_: DICT.class_[tx.class_], order: DICT.order[tx.order], family: DICT.family[tx.family] } : {},
      bbox: px.length ? [q(px, 0.02), q(py, 0.02), q(px, 0.98), q(py, 0.98)] : null,
    };
  }

  // Information provider. Today everything comes from the embedded dataset; to add a photo or a
  // description from the web later, set window.FMAP_SPECIES_PROVIDER = (name) => Promise<{imageUrl, summary}>.
  function getSpeciesInfo(idx) {
    const name = DICT.species[idx];
    const ext = typeof window.FMAP_SPECIES_PROVIDER === 'function' ? window.FMAP_SPECIES_PROVIDER(name) : Promise.resolve(null);
    return Promise.all([scanSpecies(idx), Promise.resolve(ext).catch(() => null)]).then(([base_, x]) => Object.assign({ idx, name, imageUrl: null, summary: null }, base_, x || {}));
  }

  function placeholderSvg(code, name) {
    const c = EDI[code].colour, id = 'g' + Math.abs(name.split('').reduce((a, ch) => (a * 31 + ch.charCodeAt(0)) | 0, 7));
    return '<svg viewBox="0 0 336 170" preserveAspectRatio="xMidYMid slice" role="img" aria-label="Illustration à venir">' +
      '<defs><linearGradient id="' + id + '" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="' + c + '" stop-opacity=".55"/><stop offset="1" stop-color="#2b2217" stop-opacity=".85"/></linearGradient></defs>' +
      '<rect width="336" height="170" fill="url(#' + id + ')"/>' +
      '<g transform="translate(168,92)" fill="#f7f4ee" fill-opacity=".92"><path d="M-62 0 C-62 -52 62 -52 62 0 Z"/><path d="M-13 0 h26 c4 26 6 38 8 52 h-42 c2 -14 4 -26 8 -52z" fill-opacity=".8"/>' +
      '<circle cx="-26" cy="-20" r="6" fill="' + c + '" fill-opacity=".55"/><circle cx="14" cy="-30" r="5" fill="' + c + '" fill-opacity=".55"/><circle cx="34" cy="-12" r="4" fill="' + c + '" fill-opacity=".55"/></g></svg>';
  }

  function miniBars(host, vals, labels, colour) {
    const W = 304, H = 62, m = 12, bw = W / vals.length, mx = d3.max(vals) || 1;
    const svg = d3.select(host).append('svg').attr('viewBox', '0 0 ' + W + ' ' + (H + m + 2));
    const g = svg.append('g');
    const bars = g.selectAll('rect').data(vals).join('rect').attr('x', (d, i) => i * bw + 2).attr('width', bw - 4).attr('rx', 2)
      .attr('y', H).attr('height', 0).attr('fill', colour);
    bars.transition().duration(DUR * 1.3).ease(d3.easeBackOut.overshoot(0.8)).delay((d, i) => (DUR ? i * 40 : 0))
      .attr('y', (d) => H - (H - 4) * d / mx).attr('height', (d) => (H - 4) * d / mx);
    bars.append('title').text((d, i) => labels[i] + ' : ' + fmt(d));
    svg.selectAll('text').data(labels).join('text').attr('x', (d, i) => i * bw + bw / 2).attr('y', H + m).attr('text-anchor', 'middle')
      .style('font-size', '8.5px').style('fill', 'var(--fg3)').text((d) => d.charAt(0));
  }

  function openSpecies(idx, fly) {
    drawerSpecies = idx;
    $('map-container').classList.add('drawer-open'); $('drawer').setAttribute('aria-hidden', 'false'); $('drawer').removeAttribute('inert');
    getSpeciesInfo(idx).then((info) => {
      if (drawerSpecies !== idx) return;
      if (fly && info.bbox) flyToBox(info.bbox);          // fly to the 2nd-98th percentile box of its places, beside the drawer
      const e = ediOf[idx], E = EDI[e], genus = info.name.split(' ')[0];
      const note = (META.edible && META.edible.notes[idx]) || (META.edible && META.edible.genus_notes[genus]) || '';
      const tax = [info.tax.phylum, info.tax.class_, info.tax.order, info.tax.family].filter(Boolean).join(' › ');
      const img = info.imageUrl ? '<img alt="' + esc(info.name) + '" src="' + esc(info.imageUrl) + '">' : placeholderSvg(e, info.name);
      $('drawer-body').innerHTML =
        (info.imageUrl ? '<figure class="dr-photo">' + img + '<figcaption>Photo</figcaption></figure>' : '') +
        '<div class="dr-body">' +
        '<div><div class="dr-title' + (showsFrench(idx) ? '' : ' latin') + '">' + esc(displayName(idx)) + '</div>' + (showsFrench(idx) ? '<div class="dr-latin">' + esc(info.name) + '</div>' : '') +
        (aliasesOf(idx).length ? '<div class="dr-alias">Aussi appelé : ' + esc(aliasesOf(idx).join(', ')) + '</div>' : '') + '<div class="dr-tax">' + esc(tax) + '</div></div>' +
        '<div class="dr-edi" style="--edi:' + E.colour + '"><span style="font-size:20px">' + E.icon + '</span><div><b>' + esc(E.label) + '</b>' +
        (note ? esc(note) : (e === 0 ? 'Aucune information de comestibilité dans la base embarquée.' : '')) +
        '<small>Information indicative et non validée : ne jamais consommer un champignon sur la seule base de cette application ; faites-le contrôler par un pharmacien ou une société mycologique.</small></div></div>' +
        (info.summary ? '<p style="margin-top:10px">' + esc(info.summary) + '</p>' : '') +
        '<div class="dr-figs">' +
        '<div class="dr-fig"><b>' + fmt(info.n) + '</b><span>observations</span></div>' +
        '<div class="dr-fig"><b>' + (info.y0 < 9999 ? info.y0 + '–' + info.y1 : '—') + '</b><span>période</span></div>' +
        '<div class="dr-fig"><b>' + fmt(info.sites) + '</b><span>lieux géolocalisés</span></div>' +
        '<div class="dr-fig"><b>' + info.nDepts + '</b><span>départements</span></div></div>' +
        '<div class="dr-sec">Saisonnalité</div><div id="dr-months"></div>' +
        '<div class="dr-sec">Départements les plus riches</div><div id="dr-depts"></div>' +
        (info.guild ? '<div class="dr-sec">Guilde</div><div>' + esc(guildFr(info.guild)) + '</div>' : '') +
        '<div class="dr-actions">' +
        (info.bbox ? '<button class="primary" id="dr-fly">Voir sur la carte</button>' : '') +
        '<a target="_blank" rel="noopener" href="https://fr.wikipedia.org/wiki/' + encodeURIComponent(info.name.replace(/ /g, '_')) + '">Wikipédia ↗</a>' +
        ((META.cdref && META.cdref[idx]) ? '<a target="_blank" rel="noopener" href="https://inpn.mnhn.fr/espece/cd_nom/' + encodeURIComponent(META.cdref[idx]) + '">INPN ↗</a>' : '') +
        '<a target="_blank" rel="noopener" href="https://www.gbif.org/species/search?q=' + encodeURIComponent(info.name) + '">GBIF ↗</a></div></div>';
      miniBars($('dr-months'), info.months, MONTHS, COL_ACCENT1);
      const dh = d3.select('#dr-depts'), mx = d3.max(info.topDepts, (d) => d.n) || 1;
      const rows = dh.selectAll('div').data(info.topDepts).join('div').style('display', 'flex').style('align-items', 'center').style('gap', '6px').style('margin', '2px 0').style('font-size', '11px');
      rows.append('span').style('width', '100px').style('flex-shrink', 0).text((d) => d.name);
      const track = rows.append('div').style('flex', 1).style('height', '8px').style('background', 'var(--bg3)').style('border-radius', '4px').append('div')
        .style('height', '100%').style('width', '0%').style('border-radius', '4px').style('background', COL_ACCENT1);
      track.transition().duration(DUR * 1.3).ease(EASE).delay((d, i) => (DUR ? 150 + i * 70 : 0)).style('width', (d) => (100 * d.n / mx) + '%');
      rows.append('span').style('width', '44px').style('text-align', 'right').style('color', 'var(--fg3)').text((d) => fmt(d.n));
      const flyBtn = $('dr-fly');
      if (flyBtn) flyBtn.addEventListener('click', () => flyToBox(info.bbox));
    });
  }


  // debugging / test hook
  window.FMAP_APP = {
    state, perf, get agg() { return lastAgg; }, get sites() { return { n: nSites, shown: siteShown, target: siteTarget }; },
    viewAt(lon, lat, k) {                      // test helper: centre the map on a longitude / latitude at zoom k
      const p = projection([lon, lat]), cx = base.ox + base.s * p[0], cy = base.oy + base.s * p[1];
      mapSvg.call(zoom.transform, d3.zoomIdentity.translate(base.w / 2 - k * cx, base.h / 2 - k * cy).scale(k));
    },
    NEAR, setMe, refreshNearby, checkWeather,
    updateAll, resetAll, pickCommune, setYearRange, setLayerMode, openSpecies, pickSpecies, flyTo, scanSpecies, applyStarter, STARTERS,
    get engine() { return engine; }, serializeState,
    get ign() { return ign; }, ignDebug() { const h = {}; ign.tiles.forEach((v) => { const k = v.layer + ':' + v.state; h[k] = (h[k] || 0) + 1; }); return { h, running: ign.running, queue: ign.queue.length, alt: ign.altQueue.length, errors: ign.errors }; },
    drawLayers, get geoState() { return geoState; }, forestStats() { return ign.fpCache ? { pts: ign.fpCache.path.nPts } : null; }, setForestTol(v) { FOREST_TOL = v; ign.fpCache = null; },
    timeDraw(n) {                              // mean duration of a full layer redraw at the current view (ms)
      const t0 = performance.now(); for (let i = 0; i < (n || 5); i++) { labelKey = ''; drawLayers(); } return (performance.now() - t0) / (n || 5);
    },
    get clusters() { return clusters; }, get labels() { return labelItems; }, get browser() { return BR; },
    get transform() { return tf; },
  };

  // ── go ────────────────────────────────────────────────────────────────────
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
