# FongiMap — Architecture: review and target

**Status:** proposed (supersedes the architecture parts of `design.md` v1.0)
**Date:** 21 November 2026
**Scope:** how the code, data and build are organised today, what is wrong with that, and where we are going so that a server-backed dataset can be added **without losing the serverless, double-click `index.html` deliverable**.
All figures below were measured on the repository at commit `5f2a22c` unless marked *(to verify)*.

---

## 1. Today in one page

```
 data_raw/*.csv (219 MB, ignored)  ──┐
 data_raw/communes*.json (6 MB)    ──┤  build.py (807 lines, pandas+numpy)  ──►  data.js   (8.04 MB)
 data_processed/*.geojson, *.csv   ──┘                                              │
                                                                                    ▼
 src/{index.template.html, style.css, app.js}  +  build/{d3,fflate}  ──► assemble_html.py ──► index.html (0.8 MB)

 runtime:  <script src="data.js">  →  window.FMAP_META (JSON, 2.7 MB) + window.FMAP_DATA (base64 zlib, 5.3 MB)
           app.js (single IIFE, 1 509 lines): decode → typed-array columns → filter pass → aggregate pass → D3 + 3 canvases
```

What works well and must be **kept**: offline double-click delivery; typed-array columns with one filter pass (≈ 22–65 ms at 1 M rows, per `context.md` §7); cross-filtering semantics (`failMask` bits); semantic zoom; build-time geography (land mask, hexagons, commune assignment); conservative, documented edibility; a good README and a written design history.

Data composition of `data.js` (measured): records 5.30 MB (base64) · `META` 2.74 MB = sites 1.47, hexagon cells 0.48, communes 0.41, dictionaries 0.28, toponyms 0.09, edibility 0.02.

---

## 2. Critique

Severity: **H** blocks the roadmap · **M** costs time every week · **L** hygiene.

| # | Finding | Evidence | Sev. |
|---|---|---|---|
| A1 | **Specs contradict the code.** `design.md`/`requirements.md`/`tasks.md` are v1.0: they describe six bottom charts, GPS dots with a 100 k subsample, a 230 px sidebar, screen-space hexbin, "two files", "desktop-only min 1280", and "commune-level resolution out of scope", while the app has none of the charts, ships hexagons built in Lambert-93, filters by commune, and is 296 px wide. `tasks.md` still says "CSV pending"; `context.md` §4 still says `build.py` is "do not use yet". | file contents | H |
| A2 | **No seam between data, engine and view.** `app.js` is one IIFE with ≈ 60 shared mutable `let`s (`lonQ…corine`, `failMask`, `siteOf`, `tf`, `state`, `BR`, `previewing`…). Rendering, filtering, DOM, geometry and data decoding all read each other's globals. Swapping or adding a data source means editing everything. | `app.js:87-112, 343-350` | H |
| A3 | **Data interface = two globals and a hard-coded format.** `boot()` reads `window.FMAP_META`/`FMAP_DATA`; `REC = 18`, `Q_MAX`, the bbox, field order are duplicated in `build.py` and `app.js` and in `design.md` §2.2 (three copies, no schema field, no version, no checksum). | `app.js:47-48,152`, `build.py:67-91` | H |
| A4 | **Format limits that silently lose data.** 8-bit dictionary indices cap at 254 values: `family` has 318 distinct values (64 become "missing"), `dept` is full at 254 *including foreign/typo codes* (`context.md` §7.1). A second dataset with different cardinalities cannot reuse the layout. | `build.py:encode_categorical`, `context.md` §7.1 | M |
| A5 | **Geography and dataset are welded.** One `META` blob mixes dataset-specific data (sites, dictionaries) with dataset-independent geography (communes, hexagon cells, toponyms, edibility). Rebuilding the dataset re-ships geography; a second dataset would have to duplicate it. | `build.py:771-787` | H |
| A6 | **No canonical keys.** Species are indices into a build-local dictionary, communes are indices into `META.communes`. Nothing links two datasets (or French names, or edibility) except re-matching strings. `cd_ref` (TAXREF) is in the CSV for 94.9 % of rows and is **dropped** at read time. | `build.py:WANTED` | H |
| A7 | **Generated artefacts and caches are versioned.** `index.html` (795 kB), `data.js` (8 MB), `__pycache__/build.cpython-39.pyc` are tracked; `.gitignore` held only the raw CSV path. Every rebuild adds a few MB of incompressible (already zlib'd) history. `.git/objects` is already ≈ 33 MB for two commits. | `git ls-files`, `du -sh .git` | M |
| A8 | **Repo hygiene around the raw CSV is contradictory.** `.gitattributes` still routes `data_raw/DATA_Gautier et al 2022.csv` through Git LFS while `.gitignore` ignores that same path and commit `5f2a22c` removed the pointer; the first commit still references a 219 MB LFS object (≈ 210 MB sit in the local `.git/lfs`). LFS itself is **not** a quota problem (GitHub currently lists 10 GiB free storage/bandwidth; older docs said 1 GiB) but nobody should rely on a manually dropped file. | `.gitattributes`, `git log` | L |
| A9 | **Build is a monolith with a ceiling.** `build.py` does ETL, geocoding, land mask, hexagons, commune assignment, edibility and packing in one 807-line file; NFR-05.1 limits it to pandas+numpy, which is incompatible with the polygon work (topology, simplification, point-in-polygon at 35 k communes) the cartographers' feedback requires. | `build.py`, `requirements.md` NFR-05.1 | M |
| A10 | **Single-file delivery does not scale with the roadmap.** D3 (280 kB; the app calls ~25 functions from roughly a third of D3's modules: selection, zoom, transition, array, geo, scale, scale-chromatic, interpolate, ease, quadtree, polygon), the basemap (0.8 MB), and soon ≈ 2–3 MB of commune geometry are inlined into HTML that must be parsed before first paint. NFR-03.1 (index.html < 1.2 MB) will not survive; NFR-01.1 ("exactly two files") must be consciously replaced by "one folder". | `assemble_html.py` | M |
| A11 | **Main-thread everything.** Decode (base64 → inflate → 1 M-iteration de-interleave), filter and aggregate share the UI thread. Fine at 1 M; at 5 M (second dataset) filters become 110–330 ms janks (linear extrapolation, *to verify*). | `app.js:134-261` | M |
| A12 | **No automated checks.** No unit tests, no lint, no CI, no golden numbers. Performance figures in `context.md` were measured by hand. `window.FMAP_APP` is a manual debug hook. | repo tree | M |
| A13 | **User-facing text and labels are hard-coded** French literals in JS and HTML; guild/trophic labels are raw English FUNGuild values in a French UI. Blocks i18n and French-name work. | `app.js:1047`, `makeGroups` | M |
| A14 | **Accessibility debt:** filter chips and month cells are non-focusable `span`/`div`; several text/background pairs are below WCAG AA (e.g. `--fg3` on `--bg` = 3.67:1). Detail in `plans/ui-overhaul.md`. | `app.js:1067,1099`, `style.css` | M |
| A15 | **Vendored libs untracked in provenance.** `build/d3.min.js`, `build/fflate.umd.js` have no recorded version/URL/hash/licence file. | `build/` | L |

Things I checked and found **not** to be problems: HTML injection (strings pass through `esc()`; `safe_script` protects inline scripts); file:// failure handling (clear message in `boot`); reduced-motion support; the edibility disclaimers (consistent and prominent).

---

## 3. Constraints that shape the target

1. **Must still open by double-click from `file://`, offline.** Consequences (see §6 matrix): no ES modules, no `fetch` of local files, data must arrive through `<script>`.
2. **A server will exist in a few months** and must be an *option*, not a requirement.
3. **Two datasets** with different schemas, one of them **dynamic** (updated and/or queried remotely).
4. **Maintainers are not primarily front-end developers**: the build must stay runnable as `python build.py && python assemble_html.py`; heavy tooling lives in CI.
5. **Public, CC-BY data**: attribution travels with every export; sensitive positions (protected species) must be degradable at build/server time.

---

## 4. Target architecture

### 4.1 Principle: static-first, server-optional

The UI talks to an **Engine** that answers "given these filters, what are the aggregates?". Where the data comes from is the business of a **DataSource**.

```
UI (map, species list, drawer)  ── only knows Engine.setFilters / onResult(aggregates) ──┐
                                                                                          │
        Engine ─────────────────────────────────────────────────────────────────────────┐ │
          LocalEngine   typed columns in memory (Worker; main-thread slices as fallback) │ │
          RemoteEngine  POST query → server aggregates (same result shape)  [later]      │ │
                                                                                          │ │
        DataSource ◄────────────────────────────────────────────────────────────────────┘ │
          ScriptSource  <script src="*.js"> → window.FMAP.register(...)   (file:// OK)      │
          HttpSource    fetch(*.bin), Range, ETag, IndexedDB cache         (web)            │
```
A dataset in **embedded** mode and a dataset in **remote** mode produce the **same aggregate objects** — that is the contract that makes the server a drop-in.

### 4.2 Module layers (still one `app` per build, no runtime module system)

```
core/    pure functions, no DOM, unit-testable in Node
         format, decode, filters, aggregate, searchKey, geo math, class breaks
engine/  Engine interface, LocalEngine (+ worker entry), RemoteEngine
data/    ScriptSource, HttpSource, package registry, taxa & geo access
view/    map layers (canvas), legend, species list, drawer, filters UI, i18n
app.js   wiring and application state (URL hash, persisted prefs)
```
Source files are **classic scripts concatenated into one IIFE** (ordering manifest) — no `import`/`export` — so the same sources run on `file://`. Introduce `esbuild` (IIFE output, tree-shaken D3) only when the benefit is demonstrated (ADR-6).

### 4.3 Data packages

| Package | Contents | Shared by datasets? |
|---|---|---|
| `geo-admin` | départements, régions, communes (topology, LOD1), hexagon grid definition, toponyms, projection parameters | yes |
| `taxa` | canonical taxon table keyed by `cd_ref`: Latin name, French names (+status/source), family/order, edibility + notes | yes |
| `ds-<id>` | columns (SoA), local dictionaries, `localSpecies → taxonId`, sites (locality, hexagon, commune ids), schema + checksum | no |
| manifest | package list, versions, update times, chunk lists | — |

Each package has **two byte-identical encodings**: `*.bin` (HTTP) and `*.js` (script tag with base64 body) — one generator, a test asserting equal hashes.

### 4.4 Canonical keys

| Entity | Key | Fallback |
|---|---|---|
| Taxon | TAXREF `cd_ref` | normalised Latin binomial |
| Département / commune | INSEE code (COG year pinned) | name+département |
| Hexagon | Lambert-93 axial `(q,r)` of the 10 km grid, shared id | — |
| Observation | `(dataset, id)` | — |

Dataset-local indices stay private to a package; the app always converts through the canonical tables. The existing `edibility.csv` becomes a `taxa` attribute rather than a per-build array.

### 4.5 Record format v2 (columnar)

Rationale and numbers to be produced by a spike (`plans/dynamic-dataset.md` §4.2): one buffer per column (SoA) instead of 18-byte interleaved rows ⇒ better compression, zero-copy views, no de-interleave loop; versioned header (`magic`, `format`, schema, rows, CRC32); dictionary index width chosen per column from real cardinality (fixes A4); `fflate` or native `DecompressionStream`.

### 4.6 Repository layout

**Implemented on 24 November 2026 (issue #10, ADR-12)**, in a smaller form than the original target (no esbuild, no `dist/`, no package split):

```
index.html                hand-written entry page (≈ 19 KB): markup + <link>/<script src>; double-click it (file://)
assets/css/app.css        built from src/css/*.css (ordered topical files)
assets/js/                app.js (src/js/app/*.js in ONE function scope) · core.js (src/js/core) · worker-source.js · geo-france.js · vendor/{d3,fflate}
assets/data/              datasets built by tools/build_data.py: data.js · datasets.js (registry) · geo-communes.js · data-<id>[.000n].js
src/{css,js/core,js/app}  the sources of everything under assets/ except assets/data/
vendor/                   d3.min.js, fflate.umd.js, VENDOR.md (versions, URL, licence)
tools/                    build_data.py (CSV -> assets/data) · build_web.py (src -> assets) · pipeline/ · fetch_raw.py · import_gbif.py ·
                          prepare_vernacular.py · make_synthetic_csv.py · check_file_url.js · check_a11y.js · bench_engine.js · serve_remote.js
data_raw/ (ignored CSV)   downloaded + SHA-256-checked inputs         data_processed/   small committed inputs (GeoJSON, edibility, vernacular names)
tests/   specs/   .github/
```
`assets/` is generated and still committed (ADR-5 was not adopted, see §9); CI fails when it is stale with respect to `src/`.

### 4.7 Delivery

| Output | For | Contents |
|---|---|---|
| `dist/standalone/` | cartographers, offline use | `index.html` + `data.js` (+ lazy `geo-communes.js`, optional `ds-<second>.js`) — **same experience as today**. Optional "single fat file" variant (≈ 10–12 MB) available. |
| `dist/web/` | hosted site | thin `index.html`, `app.js`, manifest, `.bin` packages, optional API URL |
| Release asset | people without Python | `fongimap-offline.zip` built by CI |

---

## 5. Decisions (ADR log)

| ID | Decision | Alternatives considered | Status |
|---|---|---|---|
| ADR-1 | **Static-first, server-optional** via `DataSource`/`Engine` ports | (a) rewrite as SPA + API; (b) keep globals and bolt on `fetch` | proposed |
| ADR-2 | **Columnar package format v2**, dual encoding `.bin`/`.js`, versioned header | keep 18-byte rows; Parquet/Arrow (large WASM, `fetch` needed) | proposed — spike first |
| ADR-3 | **Canonical keys** (`cd_ref`, INSEE, grid id) | name matching | proposed |
| ADR-4 | **Admin geometry derived from commune topology** | separate dept/region GeoJSON | proposed (see `plans/communes-layer.md`) |
| ADR-5 | **Generated artefacts out of git**, built and published by CI; raw data fetched by script with SHA-256 | commit builds; Git LFS for raw CSV | proposed. The known content hash of the current CSV is `db9eeadf3297bd56ebc6d474d434b8d44000f1a5597c105be1711a13700a4000` (sha256 = its former LFS object id, i.e. the hash of the file committed in `6959efe`). |
| ADR-6 | **Assembly:** keep Python concatenation now; adopt `esbuild` (IIFE) when tree-shaking/worker bundling pays off | webpack/vite (heavier), ES modules (blocked on `file://`) | proposed |
| ADR-7 | **Engine in a Worker with main-thread fallback** (same API) | main thread only; SharedArrayBuffer (needs cross-origin isolation, impossible on `file://`) | proposed — spike on `file://` per browser |
| ADR-8 | **Server contract = bounded aggregates, not records** | stream raw rows | proposed |
| ADR-9 | **`prepare_*` scripts run once, outputs committed** (geometry, vernacular names) so `tools/build_data.py` stays pandas+numpy | add shapely to `build.py` | proposed |

---

## 6. What `file://` allows (design constraints to test, not assume)

| Capability | `file://` | Confidence |
|---|---|---|
| Classic `<script src>` | works | used today |
| ES modules / `import` | blocked (CORS, opaque origin) | high |
| `fetch()` of a local file | blocked in Chromium | high |
| Worker from `Blob` URL | **Chrome 157 and Edge 158: works on `file://`** (measured 24 Nov 2026 with `tools/check_file_url.js`: engine back-end `worker`, no error). Firefox and Safari not measured; the page falls back to the main-thread engine when the worker cannot start (WebKit bug reports say it can fail). | high for Chromium, medium elsewhere |
| `SharedArrayBuffer` | no (needs cross-origin isolation) | high |
| IndexedDB / `localStorage` | varies by browser/origin; always wrap in `try/catch` | medium |
| WebAssembly from bytes | OK | medium |
| `DecompressionStream` | modern browsers; keep `fflate` fallback (Firefox 88–112 in NFR-04) | high |

---

## 7. Migration principles

1. **Golden master first** (`tests/golden/`): same counters for ~30 filter scenarios before/after every step; anchors: 1 043 262 observations, 11 618 taxa, 96 départements, Pas-de-Calais 78 199, Valbonne 302/180/7.
2. **One seam per PR**, behaviour-preserving until the format change.
3. **Documentation moves with code**: every step updates this file and `context.md`.
4. **No feature work waits for the full refactor**: French names, commune layer and UI quick wins fit the current structure and are written to be portable (single `displayName`, lazy geometry package, tokens).

---

## 8. Recommended order of work

1. Docs and repo hygiene (this change).
2. `french-names` (small, high-value, fixes a visible defect).
3. `ui-overhaul` T1/T2/T6 (tokens, accessibility, list/drawer).
4. `communes-layer` **spike**, then build + runtime.
5. Architecture foundation steps 2–6 (golden master → Engine → package split → taxa).
6. Columnar v2 + worker, then **second dataset** (regime A → B → C).

Rough dependency graph: `foundation 2–6` → `dynamic-dataset`; all others independent.

---

## 9. Implementation status and revised decisions (21 November 2026)

| ADR | Outcome |
|---|---|
| ADR-1 static-first, server-optional | **Implemented** as an engine client with three back-ends (worker, main thread, remote HTTP) and `?ds=` dataset loading by classic `<script>`. A separate `HttpSource` for `.bin` files turned out to be unnecessary: script injection works on `file://` **and** over HTTP, so there is one delivery path and no "standalone vs web" split. |
| ADR-2 columnar format v2 | **Rejected by measurement** (`performance.md`: +3 % size, decode gain ≤ 100 ms once, in the worker). The v1 18-byte format stays; `format` is still not versioned in a header (known gap). |
| ADR-3 canonical keys | **Partly**: INSEE codes in the commune table, TAXREF `cd_ref` per species in `META.cdref` (11 615 of 11 618 species; used for the INPN link and the CSV export; 952 of 1 219 for the GBIF dataset via FongiBase names). Not done: a shared taxa table across datasets and a shared hexagon id. |
| ADR-4 admin geometry from the commune topology | **Partly**: the commune layer and its borders come from the IGN topology; départements/régions at low zoom and the land mask still use the older GeoJSON. |
| ADR-5 artefacts out of git | **Not adopted on purpose**: `index.html`, `data.js`, `geo-communes.js` and the GBIF dataset stay committed so that a checkout or a zip opens by double-click; CI checks the build and tests but does not publish. Revisit if the repository size becomes a problem. |
| ADR-6 esbuild | **Not adopted**: no need appeared (concatenation + tests are enough; D3 tree-shaking would save ≈ 150 KB). |
| ADR-7 engine in a Worker with fallback | **Implemented**; behaviour on `file://` per browser still to be verified. |
| ADR-8 bounded aggregates over HTTP | **Implemented** as `engine-remote.js` + `tools/serve_remote.js`, tested against the local engine. |
| ADR-9 prepare scripts with committed outputs | **Done for vernacular names**; commune geometry is built inside `tools/build_data.py` through `tools/pipeline/communes.py` (numpy only) from a checksum-verified raw input instead. |

Repository layout: reorganised on 24 November 2026 (§4.6, ADR-12). Findings A1 (stale specs), A2 (no seam between data, engine and view), A3 (data interface), A4 (unversioned format: fixed by the `META.format` header, ADR-12), A8 (LFS leftovers), A12 (no tests: fixed), A13 (hard-coded strings: English via phrase translation, not extraction) and A14 (accessibility) were addressed to the degree described in `context.md` §9–11.

### ADR-10 (21 November 2026): optional online overlays at the last zoom levels

**Decision.** Forests and altitude are fetched from IGN's open Géoplateforme services at runtime, only at the last zoom levels (k ≥ ≈ 50), each behind its own switch, and are **not** embedded. **Why not embedded:** the finest open layers are far too large for a single-page offline deliverable (measured: the IGN contour-line layer is 30 MB for one 0.1° tile in the Jura and 124 MB in the Alps; BD TOPO vegetation 5.8 MB per tile; the forest mask 0.6–1.2 MB per tile before gzip, 115 kB gzipped per 0.05° tile). **How:** forest = WFS `IGNF_MASQUE-FORET.2021-2023:masque_foret`; altitude = elevations from the altimetry service (`ign_rge_alti_wld`, POST of up to 2 500 points) sampled on a 21 × 21 grid per 0.05° tile (≈ 200 m) with shared edge samples, contour lines by marching squares in the browser (`core/contour.js`), summits and passes from WFS `BDTOPO_V3:detail_orographique` with their altitude read from the grid. **Costs and limits:** every view sends the displayed area to data.geopf.fr (disclosed in the options and the help); the altimetry service answers HTTP 429 under load (requests are serialised and retried); contour resolution is that of the sampling (≈ 200 m), not the 5 m source DEM; without a connection the overlays are absent. **Alternatives rejected:** embedding a coarse raster (blocky at the last level), IGN WMTS raster tiles (Web Mercator tiles would need warping into the app's Lambert projection).

### ADR-11 (24 November 2026): optional weather check in "Autour de moi"

**Decision.** The "Autour de moi" panel (issue #14) may call **Open-Meteo** (`api.open-meteo.com/v1/forecast`, no key, CORS enabled) to read the last 14 days of hourly rain, humidity, temperature and soil moisture, and show a simple indication of how favourable the last days were. This is the **second declared exception** to "no network at runtime" (after ADR-10).
**Why a network call.** Weather is not in the dataset and cannot be embedded (it changes hourly). **Guard rails.** (1) It never runs by itself: only when the user clicks "Vérifier l'humidité". (2) The only data sent is the position **rounded to 0.01° (≈ 1 km)**, in the URL; nothing is stored or put in the shareable link; the geolocation itself never leaves the page. (3) Offline or on failure the panel says so and everything else keeps working. (4) The verdict is a documented rule of thumb (`core/nearby.js`, `assessWeather`: rain over 14 and 3 days, air humidity, temperature, with frost / heat as a veto), labelled as indicative and not validated. (5) Only available for today's date.
**Rejected.** Embedding a climatology (not "the last 3 days"); a paid or keyed API (a key cannot be kept secret in a static page); Météo-France open data (no CORS-friendly point API at the time of writing).

### ADR-12 (24 November 2026): split deliverable, tools under `tools/`

**Decision.** The standalone deliverable is no longer one 0.9 MB generated `index.html`: it is a hand-written `index.html` plus `assets/` (CSS, scripts, datasets), all classic scripts, so a double-click still works. Build scripts live in `tools/` (`build_data.py`, `build_web.py`, `pipeline/`), vendored libraries in `vendor/`, shipped datasets in `assets/data/`. **Consequences.** The Web Worker is started from a Blob whose text is delivered as a string (`assets/js/worker-source.js`), because a classic script cannot read back its own source; dataset paths are resolved against `window.FMAP_DATA_DIR`; the app and the engine are unchanged. **Checked** on `file://` in Chrome and Edge (`tools/check_file_url.js`), 23 Node tests, axe-core on 7 screens (`tools/check_a11y.js`).
**Also in this change (from the #9 follow-ups):** the record format now carries a **versioned header** (`META.format`: name, version, record size, field list, CRC-32 of the records; per-chunk CRC-32 for chunked datasets). The engine refuses an unknown version; `?verify=1` checks the checksum at start; datasets built before the header existed still load (read as version 1).
