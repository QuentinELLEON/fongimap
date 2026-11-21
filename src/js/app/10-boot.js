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
  // text of the worker: the inflate library + the core engine, read back from the page's own inline scripts
  function workerSource() {
    const a = document.getElementById('fmap-fflate'), b = document.getElementById('fmap-core');
    return a && b ? a.textContent + '\n' + b.textContent : '';
  }

  async function boot() {
    try {
      setLoading('Lecture des données…', 5);
      await tick();
      if (!window.FMAP_META || typeof window.FMAP_DATA !== 'string') {
        throw new Error('Fichier data.js introuvable ou invalide.\nExécutez build.py puis placez data.js dans le même dossier que index.html.');
      }
      META = window.FMAP_META; DICT = META.dicts; N = META.n_records;
      DEPTS = window.FMAP_DEPTS; REGIONS = window.FMAP_REGIONS;
      speciesLower = DICT.species.map((s) => s.toLowerCase());
      mapDeptNames();
      if (META.edible) for (let i = 0; i < META.edible.codes.length; i++) ediOf[i] = META.edible.codes.charCodeAt(i) - 48;

      setLoading('Démarrage du moteur…', 10); await tick();
      const useWorker = !/[?&]worker=0\b/.test(location.search);        // ?worker=0 forces the main-thread engine
      engine = await FMAP_CORE.createEngineClient({ worker: useWorker, workerSource: workerSource(), yieldFn: tick, onProgress: setLoading });
      const S = META.sites || { lon: [], lat: [], approx: [], cell: [], commune: [] };
      const st = await engine.init({
        b64: window.FMAP_DATA, N, nSpecies: DICT.species.length,
        sites: { lon: S.lon, lat: S.lat, approx: S.approx || [], cell: S.cell || [], commune: S.commune || [] },
        edible: META.edible ? META.edible.codes : null, drawnDepts: Array.from(deptFeat.keys()),
      }, setLoading);
      window.FMAP_DATA = null;
      spFamily = st.spFamily; dataStats = st;
      initNames();
      META.yearSpan = st.ymax ? st.ymin + '–' + st.ymax : '';

      setLoading('Préparation de la carte…', 75); await tick();
      buildMap();
      initSites();
      initCommunes();
      buildSidebar();
      initBrowser();
      initDrawer();
      initHelp();

      setLoading('Premier rendu…', 90); await tick();
      await updateAll(true);
      setLoading('Prêt', 100);
      $('loading-overlay').classList.add('hidden');
      maybeShowHelp();
    } catch (err) {
      console.error(err);
      showError(String(err && err.message ? err.message : err));
    }
  }

