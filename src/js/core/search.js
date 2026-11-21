/* ═══════════════════════════════════════════════════════════════════════════
   Bilingual species search: Latin names, French vernacular names (primary + aliases), families.
   Pure functions, no DOM: unit-tested in Node (tests/search.test.js).

   Normalisation (searchKey): lower case, ligatures (œ æ), accents removed, every non-alphanumeric
   character (apostrophe, hyphen, comma…) becomes one space.  "Cœur-de-bœuf" -> "coeur de boeuf".
   (Not the same as the département-name matcher, which glues words together.)

   Matching: every query word must match a word of ONE name (prefix match; the typed words are
   plural-tolerant: "cèpes" finds "cèpe").  Ranking tiers, best first:
     0 whole name equals the query     1 name starts with the query
     2 every query word starts a word  3 every query word occurs inside the name   4 family only
   ═══════════════════════════════════════════════════════════════════════════ */
(function (root) {
  'use strict';
  const core = root.FMAP_CORE = root.FMAP_CORE || {};

  function searchKey(s) {
    return String(s).toLowerCase().replace(/œ/g, 'oe').replace(/æ/g, 'ae').normalize('NFD')
      .replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
  }
  core.searchKey = searchKey;

  // query -> { key, words }: words of >= 4 letters lose a trailing s / x (plural), harmless for prefix matching
  function parseQuery(q) {
    const key = searchKey(q);
    const words = key ? key.split(' ').map((w) => (w.length >= 4 && /[sx]$/.test(w) ? w.slice(0, -1) : w)) : [];
    return { key, words };
  }
  core.parseQuery = parseQuery;

  // entries: array indexed by species: { latin, fr: [primary, ...aliases] | null, family: string }
  function buildSearchIndex(entries) {
    return entries.map((e) => {
      const names = [{ text: e.latin, key: searchKey(e.latin), kind: 'latin' }];
      (e.fr || []).forEach((t, i) => names.push({ text: t, key: searchKey(t), kind: i === 0 ? 'fr' : 'alias' }));
      names.forEach((n) => { n.words = n.key.split(' '); });
      return { names, fam: e.family ? searchKey(e.family) : '' };
    });
  }
  core.buildSearchIndex = buildSearchIndex;

  // -> { tier, via } for one species, or null when it does not match
  function matchOne(rec, Q) {
    let best = null;
    for (let i = 0; i < rec.names.length; i++) {
      const n = rec.names[i];
      let tier = -1;
      if (n.key === Q.key) tier = 0;
      else if (n.key.startsWith(Q.key)) tier = 1;
      else if (Q.words.every((w) => n.words.some((x) => x.startsWith(w)))) tier = 2;
      else if (Q.words.every((w) => n.key.includes(w))) tier = 3;
      if (tier >= 0 && (best === null || tier < best.tier)) best = { tier, via: i };
    }
    if (best === null && rec.fam && Q.words.every((w) => rec.fam.includes(w))) best = { tier: 4, via: -1 };
    return best;
  }
  core.matchOne = matchOne;

  // all matches: Int32Array-like list of species indices with tiers, filtered by an optional predicate (e.g. count > 0)
  function search(index, query, accept) {
    const Q = parseQuery(query);
    if (!Q.key) return null;                                 // empty query: no restriction
    const out = [];
    for (let s = 0; s < index.length; s++) {
      if (accept && !accept(s)) continue;
      const m = matchOne(index[s], Q);
      if (m) out.push({ s, tier: m.tier, via: m.via });
    }
    return out;
  }
  core.search = search;
})(typeof globalThis !== 'undefined' ? globalThis : self);
