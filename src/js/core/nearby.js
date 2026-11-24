/* ═══════════════════════════════════════════════════════════════════════════
   "Autour de moi" helpers (issue #14): pure functions, no DOM, run in the page and in Node tests.
     - seasonWeights(): how much each calendar month counts for a given day (observations only carry a month)
     - sitesWithin():   which places lie inside a radius around a point, with distance and bearing
     - weatherUrl() / assessWeather(): the optional, online "recent humidity" check (Open-Meteo, see ADR-11)
   The ranking itself (counting records per species and per place) is engine.nearby() in engine.js.
   ═══════════════════════════════════════════════════════════════════════════ */
(function (root) {
  'use strict';
  const core = root.FMAP_CORE = root.FMAP_CORE || {};
  const RAD = Math.PI / 180, KM_PER_DEG_LAT = 111.19;

  const daysInMonth = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();

  // Weight of each month (index 1..12; index 0 = records without a month, never counted) for the day y-m-d.
  // The month of the date counts fully; in the second half of a month the next one starts to count, in the first
  // half the previous one still does (ramp 0 -> 0.5 over half a month), so a date near a month boundary sees both.
  core.seasonWeights = function (y, m, d) {
    const w = new Float32Array(13), dim = daysInMonth(y, m), f = dim > 1 ? (d - 1) / (dim - 1) : 0.5;
    w[m] = 1;
    const prev = m === 1 ? 12 : m - 1, next = m === 12 ? 1 : m + 1;
    w[prev] = Math.max(w[prev], Math.max(0, 0.5 - f));
    w[next] = Math.max(w[next], Math.max(0, f - 0.5));
    return w;
  };

  const COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SO', 'O', 'NO'];
  core.compass = (deg) => COMPASS[Math.round((((deg % 360) + 360) % 360) / 45) % 8];

  // Places (parallel arrays of degrees) within radiusKm of (lon0, lat0). Equirectangular distance: accurate to a few
  // metres over 100 km at French latitudes. Returns { idx: Int32Array, dist: Float32Array (km), bearing: Float32Array (° from north) }.
  core.sitesWithin = function (lon, lat, lon0, lat0, radiusKm) {
    const kx = KM_PER_DEG_LAT * Math.cos(lat0 * RAD), idx = [], dist = [], bearing = [];
    const dLon = radiusKm / kx, dLat = radiusKm / KM_PER_DEG_LAT;
    for (let i = 0; i < lon.length; i++) {
      const dx = (lon[i] - lon0) * kx, dy = (lat[i] - lat0) * KM_PER_DEG_LAT;
      if (Math.abs(lon[i] - lon0) > dLon || Math.abs(lat[i] - lat0) > dLat) continue;
      const r = Math.hypot(dx, dy);
      if (r > radiusKm) continue;
      idx.push(i); dist.push(r); bearing.push(((Math.atan2(dx, dy) / RAD) + 360) % 360);
    }
    return { idx: Int32Array.from(idx), dist: Float32Array.from(dist), bearing: Float32Array.from(bearing) };
  };

  // ── recent weather (optional, online) ────────────────────────────────────────
  // Open-Meteo forecast API: hourly series for the last 14 days up to now, no key, CORS enabled. The position is rounded to
  // 0.01° (about 1 km) before it leaves the page, and only when the user asks for the check.
  core.weatherUrl = function (lat, lon) {
    const r = (v) => (Math.round(v * 100) / 100).toFixed(2);
    return 'https://api.open-meteo.com/v1/forecast?latitude=' + r(lat) + '&longitude=' + r(lon) +
      '&past_days=14&forecast_days=1&timezone=auto&hourly=precipitation,relative_humidity_2m,temperature_2m,soil_moisture_3_to_9cm';
  };

  const mean = (a) => { let s = 0, n = 0; for (const v of a) if (v !== null && v !== undefined && !Number.isNaN(v)) { s += v; n++; } return n ? s / n : null; };
  const sum = (a) => { let s = 0; for (const v of a) if (v !== null && v !== undefined && !Number.isNaN(v)) s += v; return s; };

  // From the API answer to the numbers shown and a deliberately simple verdict. The rule of thumb behind it: fungi fruit
  // after water has soaked the ground and while temperatures are mild (not frozen, not hot). It is an indication, not a
  // validated model: thresholds below are plain constants, listed with their reasons so they can be argued with.
  core.assessWeather = function (api, nowMs) {
    const H = api && api.hourly;
    if (!H || !H.time || !H.time.length) throw new Error('réponse météo vide');
    const nowStr = new Date(nowMs + (api.utc_offset_seconds || 0) * 1000).toISOString().slice(0, 13) + ':00';
    let last = -1; for (let i = 0; i < H.time.length; i++) if (H.time[i] <= nowStr) last = i; else break;
    if (last < 0) throw new Error('pas de données récentes');
    const slice = (arr, n) => (arr || []).slice(Math.max(0, last - n + 1), last + 1);
    const rain3 = sum(slice(H.precipitation, 72)), rain14 = sum(slice(H.precipitation, 336));
    const rh3 = mean(slice(H.relative_humidity_2m, 72)), temp3 = mean(slice(H.temperature_2m, 72));
    const soilRaw = mean(slice(H.soil_moisture_3_to_9cm, 72)), soil3 = soilRaw === null ? null : soilRaw * 100;   // m³/m³ -> %
    const byDay = new Map();
    for (let i = 0; i <= last; i++) { const d = H.time[i].slice(0, 10), v = H.precipitation && H.precipitation[i]; byDay.set(d, (byDay.get(d) || 0) + (v || 0)); }
    const days = Array.from(byDay.entries()).slice(-14).map(([date, mm]) => ({ date, mm: Math.round(mm * 10) / 10 }));

    let points = 0; const reasons = [];
    if (rain14 >= 25) { points += 2; reasons.push(['rain14', 'high']); } else if (rain14 >= 10) { points += 1; reasons.push(['rain14', 'some']); } else if (rain14 < 5) { points -= 2; reasons.push(['rain14', 'low']); } else reasons.push(['rain14', 'some']);
    if (rain3 >= 3) { points += 1; reasons.push(['rain3', 'recent']); }
    if (rh3 !== null) { if (rh3 >= 85) { points += 1; reasons.push(['rh', 'humid']); } else if (rh3 < 65) { points -= 1; reasons.push(['rh', 'dry']); } }
    if (temp3 !== null) { if (temp3 >= 6 && temp3 <= 20) { points += 1; reasons.push(['temp', 'mild']); } else if (temp3 < 2) { points -= 2; reasons.push(['temp', 'cold']); } else if (temp3 > 26) { points -= 2; reasons.push(['temp', 'hot']); } }
    let level = points >= 3 ? 'good' : points >= 1 ? 'mid' : 'low';
    if (temp3 !== null && (temp3 < 2 || temp3 > 28)) level = 'low';        // frost or heat stops fruiting whatever the rain
    return { rain3, rain14, rh3, temp3, soil3, days, level, points, reasons, asOf: H.time[last] };
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);
