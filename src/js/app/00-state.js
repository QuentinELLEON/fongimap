/* ═══════════════════════════════════════════════════════════════════════════
   FongiMap – application logic (single IIFE, no modules, runs on file://)

   Data: FongiBase extract, Gautier et al. 2022 – https://zenodo.org/records/17158524

   Binary record format (specs/design.md §2.2) – little-endian, 18 bytes/record,
   produced by build.py, zlib-compressed + base64 in data.js (window.FMAP_DATA):

     Offset  Bytes  Type    Field       Notes
     0       2      uint16  lon_q       quantised longitude, 0xFFFF = missing
     2       2      uint16  lat_q       quantised latitude,  0xFFFF = missing
     4       2      uint16  year        0 = missing
     6       1      uint8   month       1-12, 0 = missing
     7       2      uint16  species     index into dicts.species, 0xFFFE = missing
     9       1      uint8   family      index into dicts.family,    0xFF = missing
     10      1      uint8   order       index into dicts.order,     0xFF = missing
     11      1      uint8   class_      index into dicts.class_,    0xFF = missing
     12      1      uint8   phylum      index into dicts.phylum,    0xFF = missing
     13      1      uint8   guild       index into dicts.guild,     0xFF = missing
     14      1      uint8   trophic     index into dicts.trophic,   0xFF = missing
     15      1      uint8   dept        index into dicts.dept,      0xFF = missing
     16      1      uint8   ecoregion   index into dicts.ecoregion, 0xFF = missing
     17      1      uint8   corine      index into dicts.corine,    0xFF = missing

   lon = lon_min + lon_q / 65534 * (lon_max - lon_min)   (same for lat)

   Besides the records, data.js carries META.sites (the distinct GPS positions with their
   locality name) and META.edible (edibility code per species).  A record's site is found
   from its (lon_q, lat_q) pair.

   Filtering model: applyFilters() writes one value per record into failMask.
   Bit i set  <=>  the record fails filter i  (0 = passes every filter).
   The species browser (sidebar) and the map's départements count the records that fail
   *at most their own* filter (species / département), so the list keeps showing the other
   species and the map keeps showing the other départements next to the selected ones
   (cross-filtering, "brushing and linking" between list and map).

   Interaction design follows Shneiderman's mantra: overview first (départements),
   zoom and filter (semantic zoom: densité -> lieux exacts; species browser + filters),
   details on demand (tooltip, species drawer).  All changes animate with D3 joins (enter / update / exit) and
   transitions, which are disabled when the user prefers reduced motion.
   ═══════════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  // ── constants ─────────────────────────────────────────────────────────────
  const REC = 18;
  const SP_MISSING = 0xFFFE, MISSING = 0xFF, COORD_MISSING = 0xFFFF, Q_MAX = 65534;
  const YEAR_LO = 1900, YEAR_HI = 2021;
  const VIRT = 1000;                         // virtual map box the projection is fitted to
  const RARE_N = 100;                        // rarefaction sample size (Hurlbert)
  const EARTH_R_KM = 6371.0088;
  // graduated symbols for places (absolute counts -> size): 1-9, 10-99, 100-999, 1000+ observations
  const SYM_RADII = [3.6, 5.6, 8.5, 13], SYM_LABELS = ['1 – 9', '10 – 99', '100 – 999', '1 000 et plus'];
  const symClass = (w) => (w >= 1000 ? 3 : w >= 100 ? 2 : w >= 10 ? 1 : 0);
  const CLUSTER_PX = 17;                     // places closer than this on screen are grouped into one symbol
  // 10 km grid cells (equal area -> count = density -> lightness ramp): 1-9, 10-49, 50-199, 200-999, 1000+
  const CELL_CUTS = [10, 50, 200, 1000], CELL_LABELS = ['1 – 9', '10 – 49', '50 – 199', '200 – 999', '1 000 et plus'];
  const cellClass = (w) => (w >= 1000 ? 4 : w >= 200 ? 3 : w >= 50 ? 2 : w >= 10 ? 1 : 0);
  const MONTHS = ['Janv', 'Févr', 'Mars', 'Avr', 'Mai', 'Juin', 'Juil', 'Août', 'Sept', 'Oct', 'Nov', 'Déc'];
  // failure bits
  const F_SPECIES = 1, F_PHYLUM = 2, F_GUILD = 4, F_TROPHIC = 8, F_ECO = 16, F_YEAR = 32, F_MONTH = 64, F_DEPT = 128, F_EDIBLE = 256, F_COMMUNE = 512;
  const TABLEAU = d3.schemeTableau10;
  const COL_NA = '#d9d5c6', COL_OTHER = '#9aa59a', COL_ZERO = '#e9e6dc';
  const COL_ACCENT1 = '#3a6b35', COL_ACCENT3 = '#c47b2b';
  const REDUCED = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const DUR = REDUCED ? 0 : 600;
  const EASE = d3.easeCubicOut;

  // edibility classes (indicative, curated – see data_processed/edibility.csv)
  const EDI = [
    { label: 'Comestibilité inconnue', short: 'Inconnue', colour: '#cfcabb', icon: '?' },
    { label: 'Comestible', short: 'Comestible', colour: '#009E73', icon: '✔' },
    { label: 'Comestible après cuisson / avec précautions', short: 'À cuire', colour: '#56B4E9', icon: '♨' },
    { label: 'Non comestible ou sans intérêt', short: 'Non comestible', colour: '#9a9484', icon: '–' },
    { label: 'Toxique', short: 'Toxique', colour: '#E69F00', icon: '⚠' },
    { label: 'Mortel', short: 'Mortel', colour: '#7a1b12', icon: '☠' },
  ];
  EDI.forEach((e) => { e.ink = e.colour === '#7a1b12' ? '#ffffff' : '#1d160c'; });   // text colour with contrast >= 4.5:1 on the badge colour

  const $ = (id) => document.getElementById(id);
  const fmt = (n) => Number(n).toLocaleString('fr-FR');
    const tick = () => new Promise((r) => setTimeout(r, 15));
  const smooth = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
  const trunc = (s, n) => (s.length > n ? s.slice(0, n - 1) + '…' : s);
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  // ── global data (filled by boot) ─────────────────────────────────────────
  let META, DICT, N = 0;
  let engine = null;                         // record engine client (Web Worker or main thread): see core/engine-client.js
  let dataStats = { located: 0, approxN: 0 };
  let speciesLower = [];
  let DEPTS, REGIONS;
  let featDept = [];                         // GeoJSON feature index -> dict dept index (-1 = none)
  let deptFeat = new Map();                  // dict dept index -> feature index
  let ediOf = new Uint8Array(65536);         // species index -> edibility class
  let spFamily = new Uint8Array(65536).fill(MISSING);   // species index -> family index (one pass at load)
  let COM = { names: [], dep: [], lon: [], lat: [] }, siteCommune = null;   // commune table, commune of each site
  let nSites = 0, sitePX = null, sitePY = null, siteName = [];
  let siteTarget = null, siteFrom = null, siteShown = null, siteTree = null, siteApprox = null;

  // ── filter state ─────────────────────────────────────────────────────────
  const state = {
    speciesSet: new Set(), speciesLabel: '',
    phylumSet: new Set(), guildSet: new Set(), trophicSet: new Set(), ecoregionSet: new Set(),
    yearMin: 0, yearMax: 0,                  // 0 = filter disabled
    monthSet: new Set(), deptSet: new Set(),
    edible: 0,                               // 0 all, 1 edible, 2 toxic
    commune: -1,                             // index into META.communes, -1 = no commune filter
  };
  let previewTok = 0, tipTok = 0, tipKey = '';   // stale-answer guards for asynchronous engine calls
  let previewing = false;                    // a species list row is hovered: the map shows its distribution
  let lastAgg = null;
  const perf = { filter: 0, aggregate: 0, render: 0, total: 0 };

