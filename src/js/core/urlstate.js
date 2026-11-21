/* ═══════════════════════════════════════════════════════════════════════════
   Shareable view: filters + map position serialised in the URL hash (works on file://, nothing is sent to a server).
   Only STABLE identifiers are used (Latin names, département / INSEE codes, FUNGuild names), never dictionary indices,
   which change from one build to the next.  Pure functions, unit-tested in Node (tests/urlstate.test.js).
   Example:  #sp=Boletus%20edulis&m=9,10&d=39&y=2000-2021&e=1&v=5.700,46.700,6.0
   ═══════════════════════════════════════════════════════════════════════════ */
(function (root) {
  'use strict';
  const core = root.FMAP_CORE = root.FMAP_CORE || {};
  const LIST = '~';                                          // separator of names (a Latin name never contains it)
  const enc = (s) => encodeURIComponent(s).replace(/%7E/g, '~');
  const dec = (s) => { try { return decodeURIComponent(s); } catch (e) { return ''; } };

  core.defaultViewState = () => ({ sp: [], q: '', m: [], d: [], y: null, c: '', e: 0, g: [], ph: [], tr: [], ec: [], v: null, l: 'auto', mt: 'density', n: '', fo: 1, al: 1 });

  // model -> "k=v&k=v" (defaults omitted)
  core.encodeState = function (s) {
    const out = [], D = core.defaultViewState();
    const names = (k) => { if (s[k] && s[k].length) out.push(k + '=' + s[k].map(enc).join(LIST)); };
    names('sp');
    if (s.q) out.push('q=' + enc(s.q));
    if (s.m && s.m.length) out.push('m=' + s.m.join(','));
    if (s.d && s.d.length) out.push('d=' + s.d.map(enc).join(','));
    if (s.y && s.y.length === 2) out.push('y=' + s.y[0] + '-' + s.y[1]);
    if (s.c) out.push('c=' + enc(s.c));
    if (s.e) out.push('e=' + s.e);
    names('g'); names('ph'); names('tr'); names('ec');
    if (s.v && s.v.length === 3) out.push('v=' + s.v[0].toFixed(3) + ',' + s.v[1].toFixed(3) + ',' + s.v[2].toFixed(1));
    if (s.l && s.l !== D.l) out.push('l=' + enc(s.l));
    if (s.mt && s.mt !== D.mt) out.push('mt=' + enc(s.mt));
    if (s.n) out.push('n=' + enc(s.n));
    if (s.fo === 0) out.push('fo=0');                       // IGN forest / altitude overlays: on by default, only "off" is written
    if (s.al === 0) out.push('al=0');
    return out.join('&');
  };

  // "k=v&k=v" -> model; unknown keys and malformed values are ignored, never an error
  core.decodeState = function (str) {
    const s = core.defaultViewState();
    String(str || '').replace(/^#/, '').split('&').forEach((kv) => {
      const i = kv.indexOf('='); if (i < 1) return;
      const k = kv.slice(0, i), v = kv.slice(i + 1);
      const names = () => v.split(LIST).map(dec).filter(Boolean);
      const ints = () => v.split(',').map((x) => parseInt(x, 10)).filter((x) => Number.isFinite(x));
      switch (k) {
        case 'sp': case 'g': case 'ph': case 'tr': case 'ec': s[k] = names(); break;
        case 'q': s.q = dec(v); break;
        case 'm': s.m = ints().filter((x) => x >= 1 && x <= 12); break;
        case 'd': s.d = v.split(',').map(dec).filter(Boolean); break;
        case 'y': { const p = v.split('-').map((x) => parseInt(x, 10)); if (p.length === 2 && p.every(Number.isFinite) && p[0] <= p[1]) s.y = p; break; }
        case 'c': s.c = dec(v); break;
        case 'e': { const e = parseInt(v, 10); s.e = e === 1 || e === 2 ? e : 0; break; }
        case 'v': { const p = v.split(',').map(Number); if (p.length === 3 && p.every(Number.isFinite) && p[2] >= 1 && p[2] <= 80) s.v = p; break; }
        case 'l': s.l = dec(v); break;
        case 'mt': s.mt = dec(v); break;
        case 'fo': s.fo = v === '0' ? 0 : 1; break;
        case 'al': s.al = v === '0' ? 0 : 1; break;
        case 'n': s.n = dec(v) === 'latin' ? 'latin' : dec(v) === 'fr' ? 'fr' : ''; break;
        default: break;
      }
    });
    return s;
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);
