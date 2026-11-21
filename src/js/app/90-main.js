  // debugging / test hook
  window.FMAP_APP = {
    state, perf, get agg() { return lastAgg; }, get sites() { return { n: nSites, shown: siteShown, target: siteTarget }; },
    viewAt(lon, lat, k) {                      // test helper: centre the map on a longitude / latitude at zoom k
      const p = projection([lon, lat]), cx = base.ox + base.s * p[0], cy = base.oy + base.s * p[1];
      mapSvg.call(zoom.transform, d3.zoomIdentity.translate(base.w / 2 - k * cx, base.h / 2 - k * cy).scale(k));
    },
    updateAll, resetAll, pickCommune, setYearRange, setLayerMode, openSpecies, pickSpecies, flyTo, scanSpecies, applyStarter, STARTERS,
    get engine() { return engine; }, serializeState,
    get clusters() { return clusters; }, get labels() { return labelItems; }, get browser() { return BR; },
    get transform() { return tf; },
  };

  // ── go ────────────────────────────────────────────────────────────────────
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
