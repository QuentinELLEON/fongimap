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

