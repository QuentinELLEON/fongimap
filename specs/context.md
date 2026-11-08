# FongiMap — Session Context

> What was asked, what was investigated, and what has already been done.  
> Keep this file updated as work progresses.

---

## 1. Original Request (verbatim summary)

The user asked for a **fully standalone, serverless, offline-capable interactive web application** that:

- Displays a map of France and plots mushroom (fungal) observation locations from the **FongiBase extract dataset** published by Gautier et al. 2022.
- Shows as much of the data as possible through **several complementary visualisation techniques**, while staying fast and smooth.
- Works by **double-clicking `index.html`** (file:// protocol, no internet connection).
- Has the dataset **hardcoded/embedded** in the shipped app (no runtime fetch).
- Uses **no online map tiles or CDN at runtime** — includes the France basemap itself.
- Has an **offline build script** (Python or Node) that cleans the raw CSV and produces a compact embedded binary format using quantised coordinates and dictionary-encoded strings.

The project goal was characterised as "think like a team: product owner, UX designer, data engineer, performance engineer."

---

## 2. Data Investigation (completed)

### 2.1 Sources Fetched

| Resource | URL | Outcome |
|---|---|---|
| Zenodo record page | https://zenodo.org/records/17158524 | Listed files: CSV (219.3 MB) + README.txt |
| README.txt | https://zenodo.org/records/17158524/files/README.txt | **Full column schema confirmed** |
| Paper (PMC mirror) | https://pmc.ncbi.nlm.nih.gov/articles/PMC9504494/ | Detailed stats, distributions, ecology |

### 2.2 Confirmed Dataset Schema

File: `DATA_Gautier et al 2022.csv`  
Size: 219.3 MB · Encoding: UTF-8 with BOM · Separator: comma

| Column | Type | Coverage | Notes |
|---|---|---|---|
| `id` | string | 100% | unique record identifier |
| `genus_species_ref` | string | 98.3% | binomial (TAXREF) |
| `genus_ref` | string | ~99% | genus |
| `species_ref` | string | ~98% | specific epithet |
| `family` | string | ~98% | TAXREF family |
| `order` | string | ~98% | TAXREF order |
| `class` | string | ~98% | TAXREF class |
| `phylum` | string | ~95% | TAXREF phylum |
| `cd_ref` | string | ~98% | TAXREF code |
| `trophic_mode` | string | 87.9% | FUNGuild trophic mode |
| `guild` | string | 87.9% | FUNGuild ecological guild |
| `date` | string | 99.9% have year | YYYY-MM-DD where available |
| `country` | string | 100% | always "France" |
| `department` | string | ~95% | French département name |
| `locality` | string | partial | free-text |
| `ecoregion` | string | ~95% | Atlantic / Continental / Mediterranean / Montane |
| `CORINE_biotope` | string | 11.8% | CORINE habitat code |
| `gps_latitude` | float | 42.7% GPS + 32.9% commune proxy | decimal degrees |
| `gps_longitude` | float | same | decimal degrees |

### 2.3 Key Statistics from the Paper

**Scale:**
- 1,043,262 records total · 11,556 unique taxa
- Date range: 1708–2021 (72.4% of records are post-2000)
- 9 records pre-1800; 7,226 between 1800–1900

**Taxonomy:**
- 88.8% Basidiomycota · 7.8% Ascomycota · ~3.4% other/unassigned
- Top orders: Agaricales 50.4%, Russulales 12.1%, Polyporales 8.6%, Boletales 6.0%
- 61.2% of taxa have fewer than 10 records (long-tail distribution)

**Ecology:**
- 87.9% of records have a guild assignment
- Top guilds: Mycorrhizal 44.6% · Litter saprotroph 31.6% · Wood saprotroph 18.1%
- Only 11.8% have a CORINE biotope code

**Geography:**
- France bbox confirmed: lat [41.0, 51.5] · lon [−5.5, 10.0]
- Highest-density departments: Pas-de-Calais (78,199), Doubs (75,227), Jura (70,851)
- Lowest-density departments: Indre (109), Lot-et-Garonne (125)
- Mediterranean departments severely under-sampled vs. Atlantic/Continental/Montane

---

## 3. Assets Already Downloaded

All files live in the project folder `fongimap/`.

| File | Path | Size | Status |
|---|---|---|---|
| D3.js v7 minified | `build/d3.min.js` | 280 KB | ✅ downloaded |
| fflate v0.8.2 UMD | `build/fflate.umd.js` | 32 KB | ✅ downloaded |
| Départements GeoJSON (simplified) | `data_processed/departements.geojson` | 569 KB | ✅ downloaded & validated |
| Regions GeoJSON (simplified) | `data_processed/regions.geojson` | 225 KB | ✅ downloaded & validated |

**GeoJSON validation results:**
- Départements: 96 features · properties: `{ code: "01", nom: "Ain" }` · covers all metropolitan France including Corsica (2A, 2B)
- Regions: 13 features · properties: `{ code: "11", nom: "Île-de-France" }`
- Both re-saved as clean UTF-8 (BOM stripped)

**Library validation:**
- fflate: UMD format confirmed — sets `self.fflate` on the global scope, works on file:// without module system
- D3 v7: standard minified build, sets `window.d3`
- Binary struct dtype verified in Python: 14-field structured array → 18 bytes/record ✅

---

## 4. Code Written (superseded — see §7)

> **Note:** The user clarified that specs should be written before any code. The following files were created during an earlier, premature implementation pass. They should be reviewed against the final spec before being used.

| File | Status | Note |
|---|---|---|
| `build.py` | Draft — **do not use yet** | ETL script skeleton, logic mostly correct but not validated against real CSV |
| `assemble_html.py` | Draft — **do not use yet** | HTML assembly script |
| `src/style.css` | Draft — **do not use yet** | Visual styles |

---

## 5. Decisions Still Needed

These were identified during investigation and must be resolved before coding:

| # | Question | Options | Impact |
|---|---|---|---|
| 1 | Dot downsampling | Random 100k subsample vs. spatially stratified per hex cell | Rendering quality at low zoom |
| 2 | Choropleth metric | Raw count vs. records/km² | Scientific accuracy |
| 3 | Default year range | 1900–2021 (practical) vs. full 1708–2021 | Timeline readability |
| 4 | Corsica display | In main viewport vs. inset box | Map layout aesthetics |
| 5 | CORINE biotope | Include as filter (warn about 11.8% coverage) vs. exclude | Scope / clutter |
| 6 | Mobile layout | Desktop-only vs. responsive stacked layout | Scope |

---

## 6. Spec Files (this session)

| File | Description |
|---|---|
| `specs/context.md` | This file — session history and decisions |
| `specs/requirements.md` | Functional and non-functional requirements |
| `specs/design.md` | Architecture, data format, UI layout, component design |
| `specs/tasks.md` | Ordered implementation task list |

---

## 7. Implementation record and deviations from the spec (November 2026)

Built: `build.py`, `assemble_html.py`, `src/{index.template.html,style.css,app.js}`, `README.md`,
`tools/make_synthetic_csv.py`. The real CSV was **not available**, so everything was tested on synthetic
data with the same schema (random values, not real observations).

**Open questions (design.md §7) — default assumptions applied:** random (stable hash) 100k dot subsample;
raw-count choropleth; default year range 1900–2021; Corsica in the main viewport; CORINE is encoded in the
data but has no filter; desktop-only (min width 1100 px).

**Deviations / additions**
- **Cross-filtering:** each chart that sets a filter ignores its own filter when counting (timeline, months,
  phylum, guild, species, and the map's départements), as design.md §4.2 implies for timeline/months
  ("bars highlighted for years within the filter"). Header stats and GPS layers use all filters.
  Départements outside the selection are dimmed, selected ones outlined.
- **Hexbin:** `d3-hexbin` is not part of the D3 bundle, so binning is implemented in `app.js` (screen-space
  pointy-top hexagons, radius 10 px, recomputed on zoom/pan, log colour scale).
- **Canvas** is used for the dot and hex layers (100k SVG circles would be too slow); points are projected once,
  lazily, the first time a layer is switched on.
- **Species filter is a set** (not a single index) so that the search can select a whole genus ("Tous : …").
- **Filter engine:** `applyFilters()` produces a `failMask` (bit set = fails that filter) instead of a 0/1 mask,
  and one `aggregate()` pass produces all counts (instead of one function per aggregate).
- **Timeline** shows 1900–2021 only (FR-06.1); older and undated records are only reachable via other panels.
- **Record order:** `build.py` sorts records by (département, species) before compression — order has no
  meaning and it shrinks `data.js` by ~25 % (1M synthetic rows: 14.3 → 11.0 MB).
- **Dictionary key** is `class_` (as in design.md §2.3). Département names are matched to the GeoJSON by
  accent/case/punctuation-insensitive name, then by code; mismatches are logged with `console.warn`.
- Overlay language and labels are French; the département list uses click-to-toggle (no Ctrl needed).
- **Measured (synthetic 1,043,262 rows, Chromium):** page ready < 1 s; filter+aggregate+render 35–65 ms;
  with dots + hexagons on 100 ms; JS heap ~88 MB total.

### 7.1 Real-data run (November 2026)

The real CSV was downloaded from Zenodo (219.3 MB) and built: 1,043,262 rows, `data.js` 5.04 MB (zlib x5.3), build 13 s;
in Chromium the page is ready in ~1 s, filter + render ~70 ms; header shows 1,043,262 / 11,618 taxa / 96 départements and
the map maximum is 78,199 records (matches the paper's Pas-de-Calais figure). Differences from the assumptions in §2:
- `department` holds **codes** ("62", "2A"…, 889 distinct values incl. foreign/typo codes); `build.py` guarantees the 96 basemap codes a dictionary slot and the app maps them to names via the GeoJSON.
- Only **462,678** records (44 %) have a valid in-box GPS point: 328,164 are `0,0` and 248,416 `NULL`. The spec's 42.7 % + 32.9 % "commune proxy" figure does not hold for this file.
- `ecoregion` values are lower-case French (`atlantique`, `continental`, `montagnard`, `mediterranen`); labels are prettified in the UI.
- Guild names differ from the paper's grouping (`Ectomycorrhizal` 37 % is the top guild; 31 values). Family has 318 values (254 kept; rare ones become "missing"), phylum 7 values.
- Placeholders: species `NA NA` (53,299), dates `YYYY-01-01` (70,345; month stored as unknown), years outside 1700–2021 (157) dropped.
Not yet checked: `file://` double-click, Firefox, Edge.

### 7.2 Precision, declutter, animation, edibility (November 2026)

- **Spatial precision:** the file only has département + GPS (462,678 records, 38,411 distinct positions) + free-text `locality`. `build.py` now writes `META.sites` (position + most frequent locality per site). Records without GPS stay département-level; geocoding them needs an external commune gazetteer (not downloaded).
- **Semantic zoom** (course: reduce information by grouping, not removing): départements -> weighted hexagons (sites binned) -> exact site bubbles; replaces the 100k-dot subsample (FR-03) since all 38k sites fit. Header toggles "Points GPS / Hexagones" replaced by the map-level selector.
- **Declutter:** collapsible sidebar with active-filter badges; guilds 8+Autres, phyla 2+Autres; four chart cards (timeline, seasonality, top species/families tabs, guild/phylum donut tabs) instead of six; amber bubbles instead of guild-coloured dots.
- **Animation:** keyed D3 joins + eased transitions for all charts, animated header counts, bubble/hexagon value tweening, fly-to, sliding drawer; all off under `prefers-reduced-motion`.
- **Edibility:** curated `data_processed/edibility.csv` (not validated; conservative); `META.edible`; `failMask` widened to 16 bits for the edible filter; species drawer with placeholder image and `FMAP_SPECIES_PROVIDER` hook.

### 7.3 Commune geocoding (November 2026)

`data_raw/communes.json` (34,969 communes, geo.api.gouv.fr, downloaded on the user's approval) lets `build.py` place records
without GPS by normalised (département code, locality) -> commune centre (468,823 records) or median of same-locality GPS
points (8,793). Located records 462,678 -> 927,273 (88.9 %); sites 38,411 -> 45,245 (6,834 approximate, `META.sites.approx`).
Approximate sites are drawn pale and flagged in tooltips. Bubble radius is now logarithmic (a few communes hold >20k records).
Risk: same-name homonyms inside one département are resolved to the first commune listed; locality text that names a hamlet
or forest absent from the commune list only matches through other GPS observations.

### 7.4 Cartography upgrade after literature search (November 2026)

Sources consulted: Penn State GEOG 486 / MetricGate (choropleth: normalise, classify, publish cut points), GBIF community and recent papers (effort bias, rarefaction limits),
UBC / Wikipedia (Flannery compensation; graduated symbols), EPSG:2154 via spatialreference.org (Lambert-93 parameters), INPN 10 km grid record, GIS&T BoK (uncertainty views), Cornell / Atlas (colour).
Changes: Lambert-93 parameters (rotate -3); département measure selector (density default, total, richness, Hurlbert rarefied n=100) with 7 quantile classes and no near-white class;
INPN-style 10 km grid computed in `build.py` (ellipsoidal Lambert-93, `META.cells`, `META.sites.cell`) replacing screen-space hexagons; graduated site symbols with explicit classes; approximate-position toggle;
colour-blind-safe edibility palette. Not adopted: KDE heatmaps, Flannery-scaled continuous radii (value range 1 to 20,000 collapses most sites to the minimum size).
Caveats: rarefied richness at n=100 ranges only ~86-96 outside one outlier (37), so quantile classes exaggerate small differences (noted in the legend); the grid is aligned on the INPN convention but was not compared with the official INPN shapefile.

### 7.5 Declutter, species browser, orientation, masking (November 2026)

Triggered by the user's review ("Pas où se situer. Pas de toponyme. Pourquoi hexagones ? Légende pas claire. Trop d'informations. Masquage … Points non lisibles. Enlever le graphe d'observations par année. À quoi sert le site ?") and by "add a way to show fungi easily and remove the data vis on the bottom". Measured on the real data in Chromium (1280 x 760).

**A. Bottom charts removed.** The whole `#charts` row (timeline, seasonality, top species/families, guild/phylum donuts) and its code (renderTimeline/Months/Top/Comp, initCharts, TL/MO/TP/CP, ResizeObserver, tab handlers, chart CSS, markup) are deleted, not commented. Kept: `makeGroups`, `groupActive` (currently unused, kept on request), `toggleGroup`, `phylumColour`, `guildColour`. `aggregate()` now returns only total, nSpecies, nDepts, bySpecies (records failing at most the species filter), byDept (at most the département filter) and per-site counts; byYear/byMonth/byPhylum/byGuild/byFamily and their single-bit cases are gone. The period slider and month grid stay in the sidebar, so no filter was lost.

**B. Species browser (sidebar tab "🍄 Champignons", default; second tab "Filtres" with an active-filter badge; sidebar 296 px).** Course notions: *filter before detail* (search, sort and filters narrow the list), *brushing and linking* (list <-> map: click selects, hover previews), *details on demand* (species drawer), *response time* (debounce 150 ms; filter + redraw 22-42 ms measured). Implementation: debounced substring search (species or family), sort "Plus observées" / "A→Z" (alphabetical rank computed once), top 60 + "Voir plus", keyed D3 join on absolutely positioned rows with a real FLIP re-ranking (Web Animations API: measure first, set the new position, invert, play), slide/fade for enter, fade for exit, tweened counts. The species->family map is built once at load (`Uint8Array(65536)` filled with 255). Click = species filter + fly to the 2nd-98th percentile box of its places (drawer-aware, never tighter than ~60 km) + drawer; click again clears. Several matches -> "Voir les N espèces sur la carte" (multi-species filter; replaces the dropdown "Tous : …"). Enter picks the first row. Hover preview = one pass over the records that recolours départements and places for that species only (140 ms debounce), undone on mouse leave, with an "Aperçu : …" tag on the map. The old dropdown autocomplete (`initSearch`) is removed. Caveat: for widespread species (cèpe and amanite phalloïde are in ~90 départements) the fly-to box is the whole country.

**C. Review items.**
1. *Orientation / toponyms* — place names with level of detail and collision handling on a third canvas (white halo for legibility): regions (k < 3.2) -> towns >= 200k inhabitants -> département names (2.8 <= k < 14) -> towns down to 5 000 inhabitants (threshold 1.6e6 * k^-1.7) -> biggest places by locality name (k >= 9, skipped when already named as a town); sea and neighbouring-country names at k < 4; selected départements always labelled, hovered département named; scale bar; clickable locator inset (shown at k > 1.35). Data question: the user chose **download population** (recommended): `data_raw/communes_population.json` (geo.api.gouv.fr `communes?fields=nom,code,population`, 1.9 MB, 34,969 communes) joined to `communes.json` by INSEE code; 2,280 communes >= 5,000 inhabitants embedded in `META.places` (~0.15 MB of data.js).
2. *Hexagons* — the user most likely saw the earlier hexagon build: hexagons no longer exist (§7.4); the layer shown now is the 10 x 10 km INPN grid. Kept as the middle semantic-zoom level (zonal + relative data -> lightness; cells have equal area so count = density) because it avoids overplotting 45k places when nothing is filtered. It is justified in the legend by one sentence ("Chaque carré couvre 10 × 10 km (100 km²) : plus il est foncé, plus il y a eu d'observations") and called "carrés" in the UI; its selector moved into Options. If it still reads as clutter, removal is simple (drop the `grid` mode and `META.cells`, ~0.4 MB of data.js).
3. *Legend* — one block, for the dominant layer only. Départements: plain title with unit ("Observations par 100 km²"), 6 labelled swatches with rounded boundaries (from quantiles; finer rounding when the range is narrow), an "aucune observation" swatch, one-line caveat; no "classes à effectifs égaux" / "échelle log". Carrés: 5 lightness classes. Lieux: 4 proportional-size classes (x10 each) + key GPS / commune centre (only when approximate positions are shown) / grouped places. Checked against the memory table: zonal + relative -> valeur; absolute counts -> taille.
4. *Progressive disclosure* — default view = map + headline + species browser + 2 tabs; the edibility segmented control stays in the header; layer mode, département colour measure and approximate positions moved to the "⚙ Options de la carte" popover; phylum, trophic mode and ecoregion are under "Filtres avancés" (collapsed). Visible controls in the default view, same counting script: **41 -> 15** (plus about 11 visible list rows), chart marks 159 -> 0, legend blocks up to 3 -> exactly 1, three stat pills -> one headline line, level label removed (hint in the legend instead).
5. *Masking* — build-time land mask (point in polygon on the 96 département polygons in Lambert-93, numpy only): 272 of 45,245 distinct positions are outside the simplified basemap; 252 (7,357 records) within 3 km are pulled 300 m inland, 20 (266 records) farther away (sea, abroad, islands missing from the basemap such as the Sept-Îles, coordinates rounded to whole degrees at sea) lose their position; 0 kept positions remain outside. Draw-time `ctx.clip()` on a `Path2D` of the département polygons for the grid and place canvases. Département codes outside the basemap: 16,364 records (971/972/973/974/976: 13,828; blank: 1,011; ZMMMT: 156; stray codes). Checked visually: Côtes-d'Armor/Brittany coast, Mediterranean (Marseille-Toulon), Corsica, Nord/Belgian border, Jura/Swiss border.
6. *Unreadable points* — 4 size classes (3.6 / 5.6 / 8.5 / 13 px radius) instead of 5, dark outline for exact positions, pale fill + brown ring for commune-centre positions, big symbols drawn first, **clustering** of places closer than 17 px (thick outline; tooltip "N lieux regroupés"), narrower grid -> places cross-fade (k 5.2-6.4; the old 4.5-7.5 overlap looked muddy), département fill fades to 30 % under finer layers, hover ring, names of the biggest places at high zoom.
7. *Purpose* — tagline under the title, "?" button, first-visit panel (what it answers, 3-step how-to, 4 starter questions, sources and limits including observer effort, the share of approximate positions computed from the data, unvalidated edibility); dismissal stored in `localStorage` inside try/catch.

**Deviations / caveats.** The grid layer was kept rather than removed (see 2). The sea is drawn in a neutral grey-blue and neighbouring countries are only named, not drawn (no neighbour geometry offline). The Sept-Îles and similar islands lose their position because the basemap has no island polygons. `FMAP_APP` gained `viewAt(lon, lat, k)`, `applyStarter`, `clusters`, `labels`, `browser` for scripted checks. Not verified: Firefox/Edge, double-click opening on `file://` (the in-app browser refuses `file://`; tested over `http.server`), screen readers, touch devices, `prefers-reduced-motion` (code path unchanged: durations 0, FLIP skipped).

### 7.6 Follow-up: squares -> hexagons, département borders (November 2026)

User notes after §7.5: "Remove it [the square grid]; département -> commune; pour les mailles revenir sur hexagone de 10 km; garder un moyen de bien lire la carte; mettre la frontière des départements et couper les mailles quand la frontière est passée."
Done: the INPN-style squares are removed and replaced by **10 km hexagons** (pointy-top, 10 km flat to flat, ~86.6 km², `META.cells` = axial q/r + 6 corners, `build.py` `hex_of`; 4,818 occupied cells; data.js 7.21 -> 7.40 MB). Département borders are stroked over the hexagons (dark) and under the place symbols (light) from the same `Path2D` as the land clip, so cells read as cut at each border and the coast/frontier stays crisp; legend, labels and scale kept for map reading. UI wording: "hexagones" everywhere (selector, legend, tooltip "Hexagone de 10 km (≈ 87 km²)", help panel).
Interpretation caveats: "Remove it" and "back to hexagons" were read together as "no squares, use hexagons". Cells are not geometrically split per département (the border line is drawn over them; a hexagon straddling a border keeps one colour). "département -> commune" is not implemented as a new choropleth level: the project has commune centres only (no commune polygons; real boundaries would be a large download needing approval), so approximate places are already commune-level symbols; to be confirmed with the user.

### 7.7 Commune filter (November 2026)

Request: "clicking on a commune (example Valbonne) puts a filter on the commune". Without commune polygons (not downloaded), `build.py` `build_communes` assigns every site to a commune: the commune whose normalised name equals the site's main locality when its centre is within 12 km (10,789 of 45,200 sites), otherwise the nearest commune centre (numpy, chunked). `META.communes` (11,939 communes that have a site or a toponym: name, département code, centre) and `META.sites.commune` / `META.places.commune` carry the result; data.js 7.40 -> 8.04 MB. In the app a new failure bit `F_COMMUNE` (512) is evaluated per record through its site (records without position fail while the filter is on). Click a town label or a single place symbol -> `pickCommune` (filter + fly to the commune's places, at least ~8 km wide); click again or the chip clears it; clicking a group of places zooms in (the département click handler is skipped when a label or symbol is hit). The chosen commune is always labelled; the species browser follows the filter. Toponym threshold changed to 1.6e6 * k^-2 so towns of ~10k inhabitants (Valbonne) are named from k ~ 12. Verified on Valbonne (06): 302 observations, 180 species, 7 places, k 43; chip, badge, clearing and bubble click work. Caveats: membership is approximate (a GPS point near a boundary can fall in the neighbour; large communes with far-flung points are only as good as the nearest-centre rule); only communes with a place on the map can be picked.

