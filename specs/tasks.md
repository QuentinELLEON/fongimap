# FongiMap — Implementation Tasks

**Version:** 1.0  
**Last updated:** November 2026  
**Status key:** ✅ Done · 🔲 To do · ⚠️ Done (needs review against spec)

---

## Prerequisites (before starting)

- [ ] User places `DATA_Gautier et al 2022.csv` in `data_raw/` (**still pending** — real data not yet built)
- [x] Python 3.9+ with pandas and numpy installed
- [x] Open design questions resolved with the default assumptions of `design.md §7` (see `context.md §7`)

---

## Phase 0 — Assets (Completed)

| # | Task | Status | Output |
|---|---|---|---|
| 0.1 | Fetch and read FongiBase README from Zenodo to confirm column schema | ✅ | 19 columns confirmed — see `context.md §2.2` |
| 0.2 | Read paper (PMC9504494) to extract data quality stats and value distributions | ✅ | Stats recorded in `context.md §2.3` |
| 0.3 | Download `departements-version-simplifiee.geojson` from gregoiredavid/france-geojson | ✅ | `data_processed/departements.geojson` (96 features) |
| 0.4 | Download `regions-version-simplifiee.geojson` | ✅ | `data_processed/regions.geojson` (13 features) |
| 0.5 | Download D3 v7.9.0 minified | ✅ | `build/d3.min.js` (280 KB) |
| 0.6 | Download fflate v0.8.2 UMD | ✅ | `build/fflate.umd.js` (32 KB) |
| 0.7 | Strip BOM from both GeoJSON files, validate JSON parse | ✅ | Clean UTF-8 saved |
| 0.8 | Verify numpy structured array dtype = 18 bytes/record | ✅ | Confirmed in Python |

---

## Phase 1 — Specs (Completed this session)

| # | Task | Status | Output |
|---|---|---|---|
| 1.1 | Write `specs/context.md` | ✅ | Session history, what was asked, what was done |
| 1.2 | Write `specs/requirements.md` | ✅ | FR-01..08, NFR-01..06 |
| 1.3 | Write `specs/design.md` | ✅ | Binary format, frontend architecture, UI layout |
| 1.4 | Write `specs/tasks.md` | ✅ | This file |

---

## Phase 2 — Build Pipeline

| # | Task | Depends on | Acceptance criteria |
|---|---|---|---|
| 2.1 | Write `build.py` — CSV reader with auto-detect separator and BOM handling | — | Reads full CSV without errors; prints row count matching 1,043,262 |
| 2.2 | Add `--inspect` mode to `build.py` — prints schema, null rates, coord coverage, date range, top values per field | 2.1 | Output matches known stats from `context.md §2.3` |
| 2.3 | Add coordinate quantisation to uint16 with France bbox | 2.1 | Values in [0, 65534]; out-of-bbox records → 0xFFFF; reverse-transform error < 200m |
| 2.4 | Add dictionary encoding for all 10 categorical fields | 2.1 | Dictionaries match expected counts (e.g. 4 ecoregion values, ~11,556 species) |
| 2.5 | Add date parsing — extract year (uint16) and month (uint8) | 2.1 | year=0 for missing; month=0 for missing; full range 1708–2021 preserved |
| 2.6 | Pack into numpy structured array (18-byte dtype) | 2.3, 2.4, 2.5 | `arr.nbytes == 18 * 1_043_262` |
| 2.7 | Compress with `zlib.compress(level=9)` and base64-encode | 2.6 | Output < 12 MB |
| 2.8 | Write `data.js` with `FMAP_META` JSON and `FMAP_DATA` base64 string | 2.7 | File is valid JS; `<script src="data.js">` loads without error in browser |
| 2.9 | Test `build.py --sample 10000` end-to-end | 2.8 | Completes in < 10s; `data.js` < 200 KB |
| 2.10 | Test `build.py` full CSV | 2.8 | Completes in < 10 min; output < 12 MB |

---

## Phase 3 — Styles (`src/style.css`)

| # | Task | Depends on | Acceptance criteria |
|---|---|---|---|
| 3.1 | Write CSS variables and reset | — | Palette matches `design.md §5.1` |
| 3.2 | Style topbar (flex layout, stat pills, toggles, reset button) | 3.1 | Renders correctly at 1280px+ width |
| 3.3 | Style sidebar (scrollable, filter sections, chip groups) | 3.1 | Sidebar scrolls independently; chips wrap correctly |
| 3.4 | Style range sliders, month grid, multi-select list | 3.1 | Controls are visually consistent with palette |
| 3.5 | Style map panel (fill container, background colour) | 3.1 | Map SVG fills its container; no overflow |
| 3.6 | Style chart rows (fixed heights, card borders) | 3.1 | Two chart rows visible below map; heights match layout spec |
| 3.7 | Style loading overlay (spinner, progress bar) | 3.1 | Overlay covers full page; progress bar animates |
| 3.8 | Style tooltip | 3.1 | Tooltip appears near cursor; does not overflow page edges |

---

## Phase 4 — Application Logic (`src/app.js`)

### 4.A — Bootstrap & Data Loading

| # | Task | Depends on | Acceptance criteria |
|---|---|---|---|
| 4.A.1 | Write IIFE wrapper; show loading overlay on DOM ready | — | Overlay visible immediately; no uncaught errors |
| 4.A.2 | Decode `FMAP_DATA`: `atob()` → Uint8Array | — | Buffer length = base64 payload size × 0.75 |
| 4.A.3 | Decompress with `fflate.decompressSync()` | 4.A.2 | Decompressed length = `FMAP_META.n_records × 18` |
| 4.A.4 | Slice decompressed buffer into 14 typed-array column views | 4.A.3 | `columns.year[0]` returns a valid year; `columns.lon_q[0]` returns a valid uint16 |
| 4.A.5 | Build helper lookup maps from `FMAP_META.dicts` | — | `dicts.species[0]` returns correct species name |
| 4.A.6 | Initialise `state` object with default values | — | `state.yearMin == 0`, all sets empty |
| 4.A.7 | Hide loading overlay after data ready | 4.A.4 | Overlay hidden; UI interactive |

### 4.B — Filter Engine

| # | Task | Depends on | Acceptance criteria |
|---|---|---|---|
| 4.B.1 | Write `applyFilters()` — single loop, builds `Uint8Array` mask | 4.A.4 | With no filters, all 1,043,262 entries = 1; correct subset with test filters |
| 4.B.2 | Write `countFiltered(mask)` — returns total count, unique species count, unique dept count | 4.B.1 | Matches expected counts for test filters |
| 4.B.3 | Write `aggregateByField(mask, columnArray, n)` — returns top-N counts | 4.B.1 | Returns correct top guilds (mycorrhizal ~44%) with no filter |
| 4.B.4 | Write `aggregateByYear(mask)` — returns Map: year → count | 4.B.1 | Year 2016 is near peak (from paper) |
| 4.B.5 | Write `aggregateByMonth(mask)` — returns Array[12] of counts | 4.B.1 | Seasonal peak in autumn months (Sept–Nov) expected |
| 4.B.6 | Write `aggregateByDept(mask)` — returns Map: dept_idx → count | 4.B.1 | Pas-de-Calais highest count with no filter |
| 4.B.7 | Benchmark `applyFilters()` on full dataset | 4.B.1 | < 150ms in Chrome DevTools performance panel |

### 4.C — Map Rendering

| # | Task | Depends on | Acceptance criteria |
|---|---|---|---|
| 4.C.1 | Set up D3 `geoConicConformal` projection fitted to France viewport | — | France outline correctly positioned and fills SVG |
| 4.C.2 | Render 96 département paths from `FMAP_DEPTS` GeoJSON | 4.C.1 | All 96 paths visible; no missing polygons |
| 4.C.3 | Render 13 region outline paths from `FMAP_REGIONS` GeoJSON | 4.C.1 | Region borders overlay correctly on dept paths |
| 4.C.4 | Apply YlGn choropleth colour scale to département paths | 4.B.6 | Pas-de-Calais/Doubs/Jura darkest; Indre/Lot-et-Garonne lightest |
| 4.C.5 | Wire D3 zoom behaviour to map SVG | 4.C.2 | Scroll to zoom, drag to pan; +/−/⊞ buttons work |
| 4.C.6 | Implement département hover tooltip | 4.B.6 | Tooltip shows name, count, top-3 species, dominant guild |
| 4.C.7 | Implement département click → dept filter toggle | 4.B.1 | Click adds dept to filter; second click removes it; map recolours |
| 4.C.8 | Implement GPS dot layer (scatter of GPS records) | 4.A.4 | Dots render at correct positions; max 100k shown |
| 4.C.9 | Implement hexbin layer using d3-hexbin | 4.A.4 | Hexcells appear over France; size/colour scales with count |
| 4.C.10 | Wire GPS dots and hexbin layer toggle switches | 4.C.8, 4.C.9 | Toggling switches shows/hides layers without re-running filter |
| 4.C.11 | Render map legend | 4.C.4 | 3 labelled colour swatches match choropleth scale |

### 4.D — Chart Rendering

| # | Task | Depends on | Acceptance criteria |
|---|---|---|---|
| 4.D.1 | Render timeline bar chart (year × count) | 4.B.4 | Bars visible 1900–2021; pre-1900 bars present but shorter |
| 4.D.2 | Add D3 brush to timeline for year-range selection | 4.D.1 | Brush sets `state.yearMin/yearMax`; all panels update |
| 4.D.3 | Render monthly distribution bar chart | 4.B.5 | Autumn peak visible with no filter |
| 4.D.4 | Render phylum donut chart | 4.B.3 | ~89% Basidiomycota segment correct |
| 4.D.5 | Render guild donut chart | 4.B.3 | ~45% Mycorrhizal segment correct |
| 4.D.6 | Render top-15 species horizontal bar chart | 4.B.3 | Sorted descending; most common species at top |
| 4.D.7 | Render top-10 families horizontal bar chart | 4.B.3 | Agaricaceae expected near top |
| 4.D.8 | Make all charts respond to filter changes (updateAll fan-out) | 4.B.1 | Filtering by "Basidiomycota" updates all other charts within 200ms |

### 4.E — Sidebar Interactivity

| # | Task | Depends on | Acceptance criteria |
|---|---|---|---|
| 4.E.1 | Populate phylum chips from `FMAP_META.dicts.phylum` | — | All phylum values shown as chips |
| 4.E.2 | Populate guild chips (top 10) | — | Top 10 guilds shown; "Autres" chip for remainder |
| 4.E.3 | Populate trophic mode chips | — | All trophic modes shown |
| 4.E.4 | Populate ecoregion chips (always exactly 4) | — | Atlantic, Continental, Mediterranean, Montane |
| 4.E.5 | Populate département list in alphabetical order | — | 96 items in select |
| 4.E.6 | Wire all chips → toggle respective Set in state → trigger applyFilters | 4.E.1–4 | Clicking "Ascomycota" filters to ~81k records |
| 4.E.7 | Implement taxon search autocomplete (debounced 200ms, substring match) | 4.A.5 | Typing "amanita" shows all Amanita species; selecting sets species filter |
| 4.E.8 | Wire year range slider (dual-thumb) → state.yearMin/Max | — | Moving slider to 1990–2000 updates all panels |
| 4.E.9 | Wire month grid toggles → state.monthSet | — | Selecting October shows autumn-heavy data |
| 4.E.10 | Wire département list → state.deptSet | — | Selecting "Doubs" shows only Doubs records |
| 4.E.11 | Wire Reset button → clear all state → re-render | All 4.E | After reset, record count = 1,043,262 |

### 4.F — Header Statistics

| # | Task | Depends on | Acceptance criteria |
|---|---|---|---|
| 4.F.1 | Update filtered count pill on every filter change | 4.B.2 | Shows correct count within 200ms |
| 4.F.2 | Update taxon count pill | 4.B.2 | Shows correct unique species count |
| 4.F.3 | Update département count pill | 4.B.2 | Shows correct count of depts with ≥1 record |

---

## Phase 5 — Assembly & Integration

| # | Task | Depends on | Acceptance criteria |
|---|---|---|---|
| 5.1 | Write `assemble_html.py` to concatenate `src/style.css`, `src/app.js`, lib JS, and GeoJSON into `index.html` | Phase 3, Phase 4 | `index.html` < 1.2 MB; parses without error |
| 5.2 | Test `index.html` + sample `data.js` (10k rows) by opening on file:// | 5.1, 2.9 | App loads, shows map, all panels render |
| 5.3 | Test with full `data.js` (1M rows) | 5.1, 2.10 | Loads in < 5s; filter operations < 200ms |
| 5.4 | Test in Chrome, Firefox, Edge | 5.3 | No console errors; layout consistent |
| 5.5 | Verify completely offline (disable network in DevTools) | 5.3 | Zero network requests; all features work |

---

## Phase 6 — Documentation

| # | Task | Depends on | Acceptance criteria |
|---|---|---|---|
| 6.1 | Write `README.md` with prerequisites, build steps, usage instructions | Phase 5 | A new user can build and run the app following only the README |
| 6.2 | Add inline binary format comment block to `build.py` | 2.6 | Format matches `design.md §2.2` exactly |
| 6.3 | Add inline binary format comment block to `app.js` | 4.A.4 | Format matches `design.md §2.2` exactly |
| 6.4 | Update `specs/context.md` with final decisions and any deviations from spec | Phase 5 | Accurate record of what was built |

---

## Notes

- Phases 2–4 can be developed in parallel once Phase 1 is complete.
- Within Phase 4, sections 4.A → 4.B → 4.C can be developed first as the backbone, then 4.D and 4.E added without blocking.
- The `--sample 10000` flag on `build.py` enables fast iteration throughout Phase 4 without waiting for the full dataset.
- Draft code for `build.py`, `assemble_html.py`, and `src/style.css` already exists from the previous session but has not been validated against this spec. Review required before using.

---

## Implementation status (November 2026)

Phases 2–6 were implemented and verified against **synthetic** FongiBase-shaped data
(10k and 1,043,262 rows; see `context.md §7`). Not yet verified against the real CSV, and
Firefox/Edge were not tested (only the built-in Chromium browser).

| Phase | Status | Notes |
|---|---|---|
| 2 Build pipeline | ✅ | `build.py` rewritten (vectorised). 1M rows: ~13 s, `data.js` 11.0 MB on near-incompressible synthetic data. `--sample`, `--inspect`, BOM and separator detection done. Real-CSV run pending. |
| 3 Styles | ✅ | `src/style.css` |
| 4 App logic | ✅ | `src/app.js`; full-dataset filter+aggregate 35–100 ms incl. GPS layers; page ready < 1 s on 1M rows. |
| 5 Assembly | ✅ (5.1–5.3, 5.5 partly) | `index.html` 718 KB. Tested over http://localhost (the in-app browser refuses `file://`); app uses no network and no modules so `file://` should behave identically — confirm by double-clicking. 5.4 (Firefox/Edge) not done. |
| 6 Docs | ✅ | `README.md`, format comments in `build.py` and `app.js`, `context.md §7` |
