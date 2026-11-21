  // ═══════════════════════════════════════════════════════════════════════════
  // Species drawer (details on demand)
  // ═══════════════════════════════════════════════════════════════════════════
  let drawerSpecies = -1;

  function initDrawer() { $('drawer-close').addEventListener('click', closeDrawer); }
  function closeDrawer() { $('map-container').classList.remove('drawer-open'); $('drawer').setAttribute('aria-hidden', 'true'); drawerSpecies = -1; }

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
    $('map-container').classList.add('drawer-open'); $('drawer').setAttribute('aria-hidden', 'false');
    getSpeciesInfo(idx).then((info) => {
      if (drawerSpecies !== idx) return;
      if (fly && info.bbox) flyToBox(info.bbox);          // fly to the 2nd-98th percentile box of its places, beside the drawer
      const e = ediOf[idx], E = EDI[e], genus = info.name.split(' ')[0];
      const note = (META.edible && META.edible.notes[idx]) || (META.edible && META.edible.genus_notes[genus]) || '';
      const tax = [info.tax.phylum, info.tax.class_, info.tax.order, info.tax.family].filter(Boolean).join(' › ');
      const img = info.imageUrl ? '<img alt="' + esc(info.name) + '" src="' + esc(info.imageUrl) + '">' : placeholderSvg(e, info.name);
      $('drawer-body').innerHTML =
        '<figure class="dr-photo">' + img + '<figcaption>' + (info.imageUrl ? 'Photo' : 'Photo à venir') + '</figcaption></figure>' +
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

