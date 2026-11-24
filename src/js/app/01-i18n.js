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
    ', espèce par espèce, à partir d’observations de naturalistes (bases FongiBase et GBIF).': ', species by species, from naturalists’ observations (FongiBase and GBIF databases).',
    'Jeux de données :': 'Datasets:', '(selon le jeu choisi).': '(depending on the chosen dataset).',
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
