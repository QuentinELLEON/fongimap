// Runs the golden scenarios in the real page (served over http) through window.FMAP_APP and returns the counters.
// Usage (browser console / automation):  JSON.stringify(await (0, eval)(await (await fetch('/tests/golden/browser-run.js')).text()))
(async () => {
  const sc = await (await fetch('/tests/golden/scenarios.json')).json();
  const M = window.FMAP_META, D = M.dicts, A = window.FMAP_APP, S = A.state;
  const reset = () => { ['speciesSet', 'phylumSet', 'guildSet', 'trophicSet', 'ecoregionSet', 'monthSet', 'deptSet'].forEach((k) => S[k].clear()); S.yearMin = 0; S.yearMax = 0; S.edible = 0; S.commune = -1; };
  const out = {};
  for (const s of sc) {
    reset();
    (s.species || []).forEach((n) => { const i = D.species.indexOf(n); if (i < 0) throw new Error('species ' + n); S.speciesSet.add(i); });
    (s.months || []).forEach((m) => S.monthSet.add(m));
    (s.depts || []).forEach((c) => { const i = D.dept.indexOf(c); if (i < 0) throw new Error('dept ' + c); S.deptSet.add(i); });
    (s.phylum || []).forEach((n) => { const i = D.phylum.indexOf(n); if (i < 0) throw new Error('phylum ' + n); S.phylumSet.add(i); });
    (s.guildRank || []).forEach((i) => S.guildSet.add(i));
    if (s.yearMin) { S.yearMin = s.yearMin; S.yearMax = s.yearMax; }
    S.edible = s.edible || 0;
    if (s.commune) { const C = M.communes; let ci = -1; for (let i = 0; i < C.names.length; i++) if (C.names[i] === s.commune[0] && String(C.dep[i]) === s.commune[1]) { ci = i; break; } if (ci < 0) throw new Error('commune'); S.commune = ci; }
    await A.updateAll();
    const a = A.agg, top = [];
    for (let i = 0; i < a.bySpecies.length; i++) if (a.bySpecies[i] > 0) top.push([i, a.bySpecies[i]]);
    top.sort((p, q) => q[1] - p[1] || p[0] - q[0]);
    let sitesOn = 0, sitesSum = 0; const st = A.sites.target; for (let k = 0; k < st.length; k++) if (st[k] > 0) { sitesOn++; sitesSum += st[k]; }
    let deptsSum = 0; for (let d = 0; d < a.byDept.length; d++) deptsSum += a.byDept[d];
    out[s.id] = { total: a.total, nSpecies: a.nSpecies, nDepts: a.nDepts, gps: a.gps, sitesOn, sitesSum, deptsSum, top5: top.slice(0, 5).map((t) => [D.species[t[0]] === undefined ? null : D.species[t[0]], t[1]]) };
  }
  reset(); await A.updateAll();
  return out;
})()
