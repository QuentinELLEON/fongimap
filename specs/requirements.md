# FongiMap — Requirements

**Version:** 1.0  
**Dataset:** FongiBase extract — Gautier et al. 2022 ([Zenodo 17158524](https://zenodo.org/records/17158524))  
**Last updated:** November 2026

---

## 1. Functional Requirements

### FR-01 — Data Loading

| ID | Requirement |
|---|---|
| FR-01.1 | The app shall load all 1,043,262 fungal observation records from an embedded data file (`data.js`) without any network request. |
| FR-01.2 | The data file shall be a `<script>` tag that sets two globals: `window.FMAP_META` (metadata + dictionaries) and `window.FMAP_DATA` (base64-encoded compressed binary blob). |
| FR-01.3 | The app shall decompress the binary blob using fflate (zlib inflate) entirely in-browser. |
| FR-01.4 | A loading overlay shall be shown during decompression and parsing, with a status message and progress indicator. |
| FR-01.5 | The app shall be fully functional within 5 seconds of page load on a modern laptop (2020+). |

### FR-02 — Map View

| ID | Requirement |
|---|---|
| FR-02.1 | The app shall display a choropleth map of metropolitan France divided into 96 départements. |
| FR-02.2 | Each département shall be coloured according to the count of observation records it contains (within the active filter). |
| FR-02.3 | The map shall include a region-boundary overlay (13 metropolitan regions) drawn on top of the département layer. |
| FR-02.4 | The map shall support zoom and pan via mouse scroll, drag, and dedicated zoom buttons. |
| FR-02.5 | Hovering over a département shall display a tooltip showing: département name, total record count, top 3 most-observed species, and dominant guild. |
| FR-02.6 | Clicking a département on the map shall add it to the active département filter. |
| FR-02.7 | The map shall use a D3 conic conformal projection centred on France — no external tile service. |

### FR-03 — GPS Dot Layer

| ID | Requirement |
|---|---|
| FR-03.1 | A toggleable dot layer shall render individual GPS-located observations as points on the map. |
| FR-03.2 | When the full dataset is active, dots shall be spatially subsampled to a maximum of 100,000 visible points to maintain rendering performance. |
| FR-03.3 | Dots shall be coloured by guild category using a fixed categorical colour scale. |
| FR-03.4 | The dot layer shall be off by default and togglable via a header switch. |

### FR-04 — Hexbin Density Layer

| ID | Requirement |
|---|---|
| FR-04.1 | A toggleable hexbin layer shall aggregate GPS-located records into hexagonal cells and colour or size them by record count. |
| FR-04.2 | Hexbin cell size shall adapt to the current zoom level. |
| FR-04.3 | The hexbin layer shall be off by default and togglable via a header switch. |
| FR-04.4 | The dot layer and hexbin layer may both be active simultaneously. |

### FR-05 — Filters

| ID | Requirement |
|---|---|
| FR-05.1 | The app shall provide a species/taxon search with autocomplete from the full list of 11,556 taxa (substring match, case-insensitive). |
| FR-05.2 | The app shall provide multi-select toggle chips for **phylum** (Basidiomycota, Ascomycota, others). |
| FR-05.3 | The app shall provide multi-select toggle chips for **ecological guild** (up to 10 shown, covering >95% of records). |
| FR-05.4 | The app shall provide multi-select toggle chips for **trophic mode**. |
| FR-05.5 | The app shall provide multi-select toggle chips for **ecoregion** (Atlantic, Continental, Mediterranean, Montane). |
| FR-05.6 | The app shall provide a dual-thumb year-range slider covering 1900–2021 by default. Records with no date shall be excluded when the slider is moved from its defaults. |
| FR-05.7 | The app shall provide a month filter as a 3×4 grid of toggleable month abbreviations. |
| FR-05.8 | The app shall provide a scrollable multi-select département list. |
| FR-05.9 | All filters shall be combined with AND logic (a record must satisfy every active filter). |
| FR-05.10 | A Reset button shall restore all filters to their default (no filter) state. |
| FR-05.11 | Applying any filter shall update all visible panels within 200ms for the full dataset. |

### FR-06 — Charts (all cross-filtered)

| ID | Requirement |
|---|---|
| FR-06.1 | **Timeline bar chart** — records per year from 1900 to 2021. Supports brush-range selection to set year filter. |
| FR-06.2 | **Monthly distribution bar chart** — records per month (Jan–Dec). Click a bar to toggle that month in the filter. |
| FR-06.3 | **Phylum donut chart** — proportional breakdown by phylum. Click a segment to toggle that phylum in the filter. |
| FR-06.4 | **Guild donut chart** — proportional breakdown by guild. Click a segment to toggle that guild in the filter. |
| FR-06.5 | **Top-15 species horizontal bar chart** — most observed species in current filter, sorted by count. Click a bar to set the species filter. |
| FR-06.6 | **Top-10 families horizontal bar chart** — most observed families in current filter, sorted by count. |
| FR-06.7 | All charts shall reflect the currently active filters (i.e., they display filtered data, not the full dataset). |

### FR-07 — Header Statistics

| ID | Requirement |
|---|---|
| FR-07.1 | The header shall display the current filtered record count, the number of unique taxa in the filtered set, and the number of départements represented. |
| FR-07.2 | All three counts shall update whenever any filter changes. |

### FR-08 — Attribution & Metadata

| ID | Requirement |
|---|---|
| FR-08.1 | The app shall display a credit to Gautier et al. 2022 and the Zenodo DOI. |
| FR-08.2 | The data.js file shall include a comment header identifying the data source and licence (CC-BY 4.0). |

---

## 2. Non-Functional Requirements

### NFR-01 — Offline & Standalone

| ID | Requirement |
|---|---|
| NFR-01.1 | The deliverable shall consist of exactly two files: `index.html` and `data.js`. |
| NFR-01.2 | Both files shall work when opened via the `file://` protocol with no internet connection. |
| NFR-01.3 | `index.html` shall contain all HTML, CSS, JavaScript, GeoJSON, and library code inline — no external references. |
| NFR-01.4 | `data.js` shall be loaded via a `<script src="data.js">` tag (works on file:// without fetch). |

### NFR-02 — Performance

| ID | Requirement |
|---|---|
| NFR-02.1 | Initial page load + data parse shall complete in under 5 seconds on a mid-range 2020+ laptop. |
| NFR-02.2 | Any filter operation shall complete a full re-render of all panels in under 200ms on the same hardware. |
| NFR-02.3 | RAM usage from data storage shall not exceed 50 MB (binary + typed arrays). |
| NFR-02.4 | The dot layer shall never render more than 100,000 points simultaneously. |
| NFR-02.5 | Filter computation shall operate directly on typed arrays without per-record object allocation. |

### NFR-03 — File Size

| ID | Requirement |
|---|---|
| NFR-03.1 | `index.html` (with inlined libs and GeoJSON) shall be under 1.2 MB. |
| NFR-03.2 | `data.js` (full dataset, compressed) shall be under 12 MB. |
| NFR-03.3 | The build script shall produce a `data.js` that is at minimum 2× smaller than the raw binary equivalent. |

### NFR-04 — Browser Compatibility

| ID | Requirement |
|---|---|
| NFR-04.1 | The app shall work in Chrome 90+, Firefox 88+, and Edge 90+ without polyfills. |
| NFR-04.2 | The app shall not use ES modules (import/export) since they are blocked on file:// in most browsers. |
| NFR-04.3 | All JavaScript shall be written as a single IIFE or plain script — no module bundler required. |

### NFR-05 — Build Pipeline

| ID | Requirement |
|---|---|
| NFR-05.1 | The build script shall require only Python 3.9+, pandas, and numpy (no unusual dependencies). |
| NFR-05.2 | The build script shall complete processing all 1,043,262 records in under 10 minutes on a standard laptop. |
| NFR-05.3 | The build script shall handle the UTF-8 BOM in the source CSV gracefully. |
| NFR-05.4 | The build script shall auto-detect the CSV separator (comma or semicolon). |
| NFR-05.5 | The build script shall accept `--sample N` and `--inspect` flags for development and testing. |
| NFR-05.6 | The build script shall print a clear error if the CSV is not found, including where to place it. |

### NFR-06 — Code Quality

| ID | Requirement |
|---|---|
| NFR-06.1 | JavaScript shall use `const`/`let` only (no `var`). |
| NFR-06.2 | All major functions shall have a one-line comment describing their purpose. |
| NFR-06.3 | The binary record format shall be documented in a comment block in both `build.py` and `app.js`. |

---

## 3. Out of Scope

- Mobile / touch layout (desktop viewport assumed)
- Server-side rendering or API
- User accounts or persistence
- Export / download of filtered data
- Offline tile caching (basemap is SVG-only)
- Phylogenetic tree visualisation
- Temporal animation (time-lapse)
- Commune-level resolution (département is the finest administrative grain shown)
