# FongiMap — guidance for AI assistants and new contributors

Offline, serverless interactive map of 1 043 262 fungal observations in France (FongiBase extract, Gautier et al. 2022, CC-BY 4.0). Deliverable today: `index.html` + `assets/` (CSS, scripts, datasets), opened by double-click (`file://`), no network.

## Read first
1. `specs/README.md` — which documents are current (requirements/design v2) and which are historical (`specs/history/`).
2. `specs/architecture.md` — critique of the structure, ADR log (ADR-10 IGN overlays, ADR-11 weather check, ADR-12 split deliverable).
3. `specs/roadmap.md` — planned work with links to the GitHub issues and detailed plans in `specs/plans/`.
4. `specs/context.md` §7 and §13 — decision history (what was tried, what was rejected, why).

## Commands
```powershell
python tools/build_data.py                 # CSV -> assets/data/data.js (~40 s; needs data_raw/DATA_Gautier et al 2022.csv)
python tools/build_data.py --sample 20000  # fast loop on the first 20 000 rows
python tools/build_data.py --inspect       # schema / coverage statistics, writes nothing
python tools/build_web.py                  # src/ + vendor/ + data_processed/ -> assets/css, assets/js (index.html is hand-written)
python tools/make_synthetic_csv.py --rows 20000 --out test_data/x.csv   # SYNTHETIC data, never present as real
node --test "tests/*.test.js"              # 23 tests (engine golden master, nearby, search, URL state, chunks, remote engine)
node tools/check_file_url.js               # real file:// load in headless Chrome/Edge: counters, worker back-end, errors
node tools/check_a11y.js                   # axe-core on 7 screens (npm install --no-save axe-core first); 0 serious/critical expected
```
Requirements: Python 3.9+, pandas, numpy; Node 22+ for the tests and checks. Run `python tools/fetch_raw.py --what all` for the raw inputs. CI builds the assets, fails when the committed `assets/` are stale with respect to `src/` (run `python tools/build_web.py` and commit), and runs the tests. Other datasets: `python tools/import_gbif.py` then `python tools/build_data.py --csv … --dataset-id … --chunks 3` (see `specs/datasets.md`).
Deployment: `.github/workflows/deploy-netlify.yml` checks the assets and the tests, then (on pushes to `main`) publishes `index.html` + `assets/` to the Netlify site `fongimap`; it needs the GitHub secret `NETLIFY_AUTH_TOKEN` (never commit a token).
After editing anything in `src/`, rebuild with `python tools/build_web.py`: the browser loads `assets/`, not `src/`.

## Hard constraints (do not break without an ADR)
- Must work from `file://`: **no ES modules, no `fetch` of local files**, data enters through `<script>`. Classic scripts only, the app in one function scope. `localStorage`/IndexedDB always inside `try/catch`.
- No network at runtime: no CDN, fonts, tiles or icons from the web. **Two declared, optional exceptions**: ADR-10 (IGN forest / altitude overlays at the last zoom levels, each with its own switch) and ADR-11 (the "Autour de moi" humidity check: only on a click, position rounded to 1 km sent to open-meteo.com). Without a connection both are just absent. A user's position is never stored, logged or put in the shareable link.
- `tools/build_data.py` stays `pandas + numpy` only. Heavy geometry work goes in separate `tools/prepare_*.py` scripts whose **outputs are committed** in `data_processed/` with provenance in `SOURCES.md`.
- Never present synthetic data as real. Never claim edibility is validated: `data_processed/edibility.csv` is an indicative, hand-written table, conservative by design; the disclaimer wording in the UI is a safety feature.
- Attribution/licence lines (FongiBase CC-BY 4.0, geo.api.gouv.fr, gregoiredavid/france-geojson) must stay in the UI footer, the dataset script header and any export.

## Code map
- `index.html` (hand-written) loads `assets/`. Sources: `src/css/*.css` (ordered topical files), `src/js/core/*.js` (DOM-free engine, search, URL state, contour, nearby; runs in a Web Worker and in Node), `src/js/app/*.js` (concatenated in file order into one function scope).
- `src/js/app/*.js` talks to the engine through `engine-client.js` (Web Worker started from a Blob whose text is `assets/js/worker-source.js`, main-thread fallback, or remote): filter pass (`failMask`, one bit per filter) → aggregate → `updateMap` / `renderBrowser`. Cross-filtering rule: the species list ignores only the species filter, départements ignore only the département filter.
- Binary record format: 18 bytes/record, documented identically in `tools/build_data.py` and the head of `src/js/app/00-state.js` / `core/engine.js`. Self-described by `META.format` (version, record size, CRC-32); change all three and bump `FORMAT_VERSION` in both places.
- `META` in the dataset script mixes dataset data (sites, dictionaries) and geography (communes, hexagon cells, toponyms, edibility). Planned to be split.
- Semantic zoom: `layerAlphas()` (départements → 10 km hexagons → communes → places). Canvas layers: `grid-canvas`, `commune-canvas`, `ign-canvas`, `dot-canvas`, `label-canvas`; départements are SVG.
- **Motion mode** (`22-map-layers.js`): during pan/zoom the canvases are moved by CSS transform and redrawn when the gesture pauses; never call `drawLayers()` from a zoom handler, call `requestDraw()` (it is a no-op while moving). Anything slow belongs in a redraw, not in a per-frame path.
- Side panel toggle `32-panel-toggle.js`; "Autour de moi" `34-nearby.js` + `core/nearby.js` + `engine.nearby`.
- Debug hook: `window.FMAP_APP` (state, `perf` incl. `perf.draw`, `viewAt`, `pickSpecies`, `NEAR`, `setMe`…).

## Regression anchors (must not change unexplained)
Default dataset (`window.FMAP_DS_DEFAULT` in `index.html`): **GBIF positions précises**, 26 813 observations · 2 602 species · 96 départements, 99 % located, 0 % approximate. FongiBase (`?ds=fongibase`) anchors:
1 043 262 observations · 11 618 taxa · 96 départements · Pas-de-Calais 78 199 · Valbonne (06): 302 observations, 180 species, 7 places.
Performance reference (1 M rows, Chromium): page ready ≈ 1 s, filter + render ≈ 22–65 ms; a redraw at the deepest zoom with forests ≈ 65–90 ms once per gesture (`specs/performance.md`).

## Conventions
- UI language: French (English via phrase table in `01-i18n.js`: add an entry for every new visible string). Documents in `specs/` are English; implementation plans in `specs/plans/` and issues are French.
- Raw data is never committed (`data_raw/*.csv` ignored). Generated outputs (`assets/`) are still committed for now; the plan is to stop (ADR-5).
- Update `specs/context.md` (§7.x, §13…) when behaviour or decisions change; update `specs/architecture.md` when structure changes.
- Prefer small, behaviour-preserving PRs; compare counters before/after.
