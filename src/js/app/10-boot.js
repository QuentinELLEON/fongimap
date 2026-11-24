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

