# FongiMap — Design (v2, 21 November 2026)

Replaces v1.0 (kept in `history/design-v1.md`; its §2.2 binary record format is still the one used). Target architecture and decisions: `architecture.md`; measurements: `performance.md`.

## 1. Deliverable

```
index.html          entry page (≈ 19 KB): markup and <script src> only
assets/css, assets/js   styles, D3, fflate, département/région GeoJSON, engine (core.js), worker text, app.js (≈ 1 MB in 8 files)
assets/data/data.js  FongiBase: META (dictionaries, sites, communes table, hexagon cells, places, edibility, vernacular names, TAXREF codes) + records (base64 zlib)
assets/data/geo-communes.js  commune boundaries (topology, 2.2 MB) – loaded lazily at zoom
assets/data/datasets.js  registry of datasets for the selector
data-<id>.js (+ data-<id>.NNNN.js chunks)   other datasets (e.g. data-gbif_fr_recent.js)
```

## 2. Build (Python, numpy + pandas only)

`tools/fetch_raw.py` → `data_raw/` (CSV and IGN commune topology, SHA-256 checked). `tools/build_data.py` → CSV cleaning, geocoding of records without GPS by commune name, land mask, 10 km hexagons (Lambert-93), exact site→commune assignment (`pipeline/communes.py`), edibility, vernacular names (`data_processed/vernacular_fr.csv`, made by `tools/prepare_vernacular.py`), packing. `assemble_html.py` → `index.html` from `src/`. Datasets other than FongiBase: `tools/import_gbif.py` then `build.py --dataset-id … [--chunks N]`.

Record format (18 bytes, little-endian, sorted by département then species for compression): lon_q u16, lat_q u16, year u16, month u8, species u16, family, order, class, phylum, guild, trophic, dept, ecoregion, corine (u8 each). Coordinates are quantised over the bounding box of metropolitan France (≈ 2 m).

## 3. Runtime

```
UI (src/js/app)  ──promises──►  engine client (core/engine-client.js)
                                   ├─ 'worker'  Web Worker built from a Blob (preferred)
                                   ├─ 'local'   same engine on the main thread (automatic fallback, ?worker=0)
                                   └─ 'remote'  HTTP/JSON contract (core/engine-remote.js), reference server tools/serve_remote.js
core/engine.js: decode → filter pass (failMask bits) → aggregate pass → counts per species / département / site;
                preview, richness, topWhere, scanSpecies, append (chunks)
```
The UI never reads per-record arrays; it receives bounded aggregates. Filter semantics and the failMask bits are documented at the top of `engine.js`.

Map: SVG départements; canvas layers for hexagons, communes, places and labels; the commune layer decodes `assets/data/geo-communes.js` in slices, keeps per-commune `Path2D` in a bounded cache and a 40×40 tile index for culling, strokes every arc once by class. Names: `core/search.js` (pure) and `app/12-names.js` (`displayName()` is the only way to show a species name).

Shared state: `core/urlstate.js` (URL hash), `localStorage` for preferences (language, theme, name preference, help seen) inside `try/catch`.

## 4. Interface

Header (title, headline counts, dataset selector, edibility segment, reset, language, help) · active-filter bar · sidebar (mushrooms list, filters) · map with options popover, commune search, zoom controls, legend, locator, scale · species sheet (drawer) · help dialog. Under 760 px the sidebar moves below the map. Dark theme darkens the interface and keeps the map area light.

Colour roles: green sequential ramp (YlGn) for relative quantity at département and commune level, lightness ramp (YlOrBr) for hexagons, amber graduated symbols for absolute counts at places, colour-blind-safe edibility palette with icons and dark ink on the badges.

## 5. Tests and measurements

`tests/` (Node): golden master of the engine on the real data (20 scenarios), search, URL state, chunk equivalence, remote-engine equivalence. `tools/bench_engine.js` for timings. CI: `.github/workflows/ci.yml`; manual dataset refresh: `refresh-gbif.yml`.

## 6. Known limits

Worker on `file://` is browser-dependent (fallback exists); Safari / Firefox untested; English covers the interface, not the data; the département polygons used at low zoom are a different generalisation from the commune topology (no visible conflict because the commune layer covers them); edibility table is hand-written and unvalidated.

## Motion mode, side panel, "Autour de moi" (24 November 2026)

- **Motion mode** (`22-map-layers.js`): while the user pans or zooms, the five canvases keep their last bitmap and the compositor moves it (CSS transform from the transform of the last draw to the current one); the redraw runs once the gesture pauses (140 ms) or, in a long gesture or fly-to, at most every ~450 ms. Hit-tests are paused during motion because their data describes the last redraw. Nothing is requested from IGN while moving; requests for tiles that scrolled out are aborted. Forest polygons are shared between tiles (by id), simplified below one pixel and clipped to the viewport before stroking (`27-ign.js`).
- **Side panel toggle** (`32-panel-toggle.js`): top-bar button + edge handle + `[` / Ctrl-B; remembered in `localStorage`; the map area resizes once (no animated layout) and the view is shifted so the geography stays where it was.
- **Autour de moi** (`34-nearby.js`, `core/nearby.js`, `engine.nearby`): a point (browser geolocation or a click on the map, never stored or shared), a date (the month counts fully, neighbours ramp in over half a month) and a radius (5–50 km) give, from the records of the sites inside the circle: species ranked by observations in season (with the all-year count), places ranked likewise (distance and bearing), restricted to one species when one is picked, with an edibility switch. The optional weather indication is ADR-11.
