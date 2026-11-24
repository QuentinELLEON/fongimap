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
