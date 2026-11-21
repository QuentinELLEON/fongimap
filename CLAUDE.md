# FongiMap — guidance for AI assistants and new contributors

Offline, serverless interactive map of 1 043 262 fungal observations in France (FongiBase extract, Gautier et al. 2022, CC-BY 4.0). Deliverable today: `index.html` + `data.js`, opened by double-click (`file://`), no network.

## Read first
1. `specs/README.md` — which documents are current (requirements/design v2) and which are historical (`specs/history/`).
2. `specs/architecture.md` — critique of the current structure, target architecture, ADR log.
3. `specs/roadmap.md` — planned work with links to the GitHub issues and detailed plans in `specs/plans/`.
4. `specs/context.md` §7 — decision history (what was tried, what was rejected, why).

## Commands
```powershell
python build.py                 # CSV -> data.js (~25 s; needs data_raw/DATA_Gautier et al 2022.csv)
python build.py --sample 20000  # fast loop on the first 20 000 rows
python build.py --inspect       # schema / coverage statistics, writes nothing
python assemble_html.py         # src/ + build/ + data_processed/ -> index.html
python tools/make_synthetic_csv.py --rows 20000 --out test_data/x.csv   # SYNTHETIC data, never present as real
```
Requirements: Python 3.9+, pandas, numpy; Node 22+ for the tests. Run `python tools/fetch_raw.py --what all` for the raw inputs and `node --test "tests/*.test.js"` for the tests (CI runs both the build check and the tests). Other datasets: `python tools/import_gbif.py` then `python build.py --csv … --dataset-id … --chunks 3` (see `specs/datasets.md`).

## Hard constraints (do not break without an ADR)
- Must work from `file://`: **no ES modules, no `fetch` of local files**, data enters through `<script>`. Classic scripts only, one IIFE. `localStorage`/IndexedDB always inside `try/catch`.
- No network at runtime: no CDN, fonts, tiles or icons from the web.
- `build.py` stays `pandas + numpy` only. Heavy geometry work goes in separate `tools/prepare_*.py` scripts whose **outputs are committed** in `data_processed/` with provenance in `SOURCES.md`.
- Never present synthetic data as real. Never claim edibility is validated: `data_processed/edibility.csv` is an indicative, hand-written table, conservative by design; the disclaimer wording in the UI is a safety feature.
- Attribution/licence lines (FongiBase CC-BY 4.0, geo.api.gouv.fr, gregoiredavid/france-geojson) must stay in the UI footer, `data.js` header and any export.

## Code map
- `src/js/app/*.js` (one IIFE, concatenated in file order) talks to the DOM-free engine in `src/js/core/engine.js` through `engine-client.js` (Web Worker, main-thread fallback, or remote): filter pass (`failMask`, one bit per filter) → aggregate → `updateMap` / `renderBrowser`. Cross-filtering rule: the species list ignores only the species filter, départements ignore only the département filter.
- Binary record format: 18 bytes/record, documented identically in `build.py` and the head of `app.js`. Change **both** and bump a version; there is no schema header yet.
- `META` in `data.js` mixes dataset data (sites, dictionaries) and geography (communes, hexagon cells, toponyms, edibility). Planned to be split.
- Semantic zoom: `layerAlphas()` (départements → 10 km hexagons → places). Canvas layers: `grid-canvas`, `dot-canvas`, `label-canvas`; départements are SVG.
- Debug hook: `window.FMAP_APP` (state, `perf`, `viewAt`, `pickSpecies`…).

## Regression anchors (must not change unexplained)
1 043 262 observations · 11 618 taxa · 96 départements · Pas-de-Calais 78 199 · Valbonne (06): 302 observations, 180 species, 7 places.
Performance reference (1 M rows, Chromium): page ready ≈ 1 s, filter + render ≈ 22–65 ms.

## Conventions
- UI language: French. Documents in `specs/` are English; implementation plans in `specs/plans/` and issues are French.
- Raw data is never committed (`data_raw/*.csv` ignored). Generated outputs (`index.html`, `data.js`) are still committed for now; the plan is to stop (ADR-5).
- Update `specs/context.md` (§7.x) when behaviour or decisions change; update `specs/architecture.md` when structure changes.
- Prefer small, behaviour-preserving PRs; compare counters before/after.
