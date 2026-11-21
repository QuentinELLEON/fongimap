# FongiMap — Requirements (v2, 21 November 2026)

Replaces v1.0 (kept in `history/requirements-v1.md`). These requirements describe what the application **does today**; the checks column says how each one is verified. IDs of v1 are not reused.

## 1. Functional requirements

| ID | Requirement | Check |
|---|---|---|
| FR-1 Data | The page loads one dataset at a time from classic `<script>` files next to `index.html` (`data.js`, or `data-<id>.js` chosen by `?ds=<id>`); a registry `datasets.js` feeds the dataset selector. Datasets may be split into period chunks loaded newest first and appended in the background. | `tests/chunks.test.js`; manual (`?ds=…`) |
| FR-2 Map levels | Semantic zoom: départements → 10 km hexagons → communes (polygons, coloured) → graduated places; borders have a hierarchy (commune < département < région < coast); names appear as they fit. | manual |
| FR-3 Colour measures | Départements: observations per 100 km² (default), total, distinct species, rarefied richness; communes: density or total; classes by quantiles with rounded, published breaks; one legend for the dominant layer. | manual |
| FR-4 Filters | Species (set), period, months, département(s), commune, guild, phylum, trophic mode, ecoregion, edibility (all / edible / toxic); combined with AND; cross-filtering (the species list ignores only the species filter, départements only the département filter); one bar shows every active filter. | `tests/golden.test.js` (20 scenarios) |
| FR-5 Species browser | Search in French names, aliases, Latin names and families (accent-, ligature-, hyphen- and plural-tolerant, type-ahead, ranked); sort by observations or A→Z by displayed name; French or Latin first (persisted); preview on hover; species sheet with seasonality, richest départements, edibility, links (Wikipedia, GBIF, INPN when a TAXREF code exists). | `tests/search.test.js`; manual |
| FR-6 Orientation | Place names with collision handling, scale bar, locator inset, "Go to a commune" search, tooltips for départements / communes / places / hexagons. | manual |
| FR-7 Positions | Every observation shows how precise its position is (GPS vs commune centre); approximate positions can be hidden; positions are clipped to land at build time. | build log, manual |
| FR-8 Sharing | The full view (filters, map position, level, measure, name preference) is in the URL hash using stable identifiers; PNG export (map + legend + active filters + attribution), CSV export of the species list (with source on every row), copy link. | `tests/urlstate.test.js`; manual |
| FR-9 Languages and themes | French (default) and English interface; light, dark or automatic theme (the map area stays light). Species names, place names and the edibility notes of the data are not translated. | manual |
| FR-10 Attribution | The dataset credit is shown in the footer and in exports; the data file headers carry source and licence; synthetic datasets show a warning banner. | manual |
| FR-11 Safety | Edibility is indicative, conservative and unvalidated; the disclaimer is shown on the species sheet and in the help panel. | manual |

## 2. Non-functional requirements

| ID | Requirement | Measured |
|---|---|---|
| NFR-1 Offline | Opens by double-click from `file://`, no network at runtime (no CDN, fonts, tiles, icons). Classic scripts only (no ES modules, no `fetch` of local files); `localStorage` always in `try/catch`. | architecture.md §6 |
| NFR-2 Performance | Filtering and aggregation ≤ 50 ms for 1 M records and ≤ 100 ms for 5 M, off the main thread (Web Worker; main-thread fallback). A full layer redraw with the commune layer visible ≤ 10 ms. | `specs/performance.md` |
| NFR-3 Size | `index.html` ≈ 0.9 MB; `data.js` 9.4 MB (limit 12 MB); commune geometry 2.2 MB loaded lazily. | build log |
| NFR-4 Browsers | Chrome / Edge / Firefox current. Safari and Firefox are untested here; the Worker may be unavailable on `file://` (automatic fallback). | not verified |
| NFR-5 Build | `python build.py && python assemble_html.py` with Python 3.9+, pandas, numpy only; raw inputs fetched by `tools/fetch_raw.py` with SHA-256 verification; geometry work in `pipeline/` (numpy only); outputs deterministic. | build log |
| NFR-6 Quality | `node --test "tests/*.test.js"` (engine golden master, search, URL state, chunk loading, remote engine) must pass; counters of the real data must not change unexplained (anchors in `CLAUDE.md`). | CI |
| NFR-7 Accessibility | Interactive elements are focusable buttons; the map is keyboard-operable; result counts are announced; text contrast ≥ 4.5:1 on the light theme; targets ≥ 24 px where practical. | manual (axe-core not run) |
| NFR-8 Privacy | No tracking, no network call; imported datasets never store observer names. | review |

## 3. Out of scope (today)

Photos of species (a provider hook exists), user accounts, writing data back, elevation / habitat layers, a server (a remote-engine contract exists, see `architecture.md`), translation of species names and edibility notes.
