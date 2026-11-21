# FongiMap — Literature and sources

Everything the design relies on, with **how much I verified it**. "Checked 2026-11-21" = a web search in this session returned the page/claim; it is **not** a full read of the document unless stated. "Carried over" = cited in an earlier session (`context.md` §7.4) and not re-verified here. Do not treat unverified items as facts in user-facing text.

## 1. The dataset

| Source | Notes | Status |
|---|---|---|
| Gautier et al. 2022, *FongiBase extract*, Zenodo record 17158524 (DOI 10.5281/zenodo.17158524), CC-BY 4.0 | schema, counts; local CSV hash `db9eeadf…4000` (see `architecture.md` ADR-5) | read in earlier sessions (`context.md` §2) |
| Paper mirror: PMC9504494 | stats, taxonomic and ecological distributions, sampling bias | carried over |

## 2. Cartography (colour, classes, zoom, labels)

Carried over from `context.md` §7.4 (not re-verified in this session): Penn State GEOG 486 and MetricGate on choropleths (normalise, classify, publish class breaks); UBC / Wikipedia on graduated symbols and Flannery compensation; GBIF community material on observation-effort bias and rarefaction limits; EPSG:2154 Lambert-93 parameters (spatialreference.org); INPN 10 km grid record; GIS&T Body of Knowledge on uncertainty depiction; Cornell/Atlas colour guidance.

Design rules used by the plans, from those sources and from standard cartographic practice (not from a new citation): normalise counts by area before shading; publish class breaks; hierarchy of line weights (region > département > commune); use value (lightness) for relative quantities and size for absolute counts; avoid red/green opposition (Okabe-Ito palette already adopted).

## 3. Administrative geometry (commune polygons)

| Source | What it gives | Status |
|---|---|---|
| [data.gouv.fr — Contours administratifs](https://www.data.gouv.fr/fr/datasets/contours-administratifs/) | Etalab commune/département/région contours, GeoJSON and GeoJSON.gz; says highly generalised versions exist for fast web display | Checked 2026-11-21. **Licence and file sizes not confirmed.** |
| [data.gouv.fr — Communes, cantons et EPCI 2025 (ADMIN-EXPRESS COG PLUS, IGN)](https://www.data.gouv.fr/datasets/communes-cantons-et-epci-2025-admin-express-cog-plus-ign/informations) | IGN-simplified communes in geoparquet, GeoJSON (EPSG:4326) and TopoJSON (4326 and 2154) | Checked 2026-11-21. Sizes/licence to confirm in the spike. |
| [data.gouv.fr — API Découpage Administratif (API Géo)](https://www.data.gouv.fr/dataservices/api-decoupage-administratif-api-geo/discussions) | per-commune name, population, INSEE code, centre, contour in WGS-84 | Checked 2026-11-21. Parameter details (`geometry=contour`) seen only in a third-party gist; **confirm on the official OpenAPI page**. |
| [gregoiredavid/france-geojson](https://packagist.org/packages/gregoiredavid/france-geojson) | communes per département + a "light" national version based on IGN simplified data; **already the source of our départements/régions** | Checked 2026-11-21 |
| [data.gouv.fr — Contours des communes de France simplifié, DOM rapprochés](https://data.gouv.fr/en/reuses/diagnostic-mobilite) | simplified commune map derived from ADMIN-EXPRESS-COG | Seen in results only |

Open question for all of them: **COG vintage** must equal the vintage of `data_raw/communes.json` (merged communes would otherwise break INSEE joins).

## 4. French vernacular names

| Source | What it gives | Status |
|---|---|---|
| [data.gouv.fr — Référentiel taxonomique TAXREF](https://www.data.gouv.fr/datasets/referentiel-taxonomique-taxref-1/) (PatriNat/INPN) | national taxonomic reference with vernacular names where available; dataset page lists an open licence; mentions experts incl. Société Mycologique de France; notices of download pages being temporary/inaccessible at times | Checked 2026-11-21. **The vernacular-names file layout (column names) could not be confirmed**; read the INPN technical documentation for the current version. |
| INPN TAXREF docs, e.g. [inpn.mnhn.fr/docs-web/docs/download/413731](https://inpn.mnhn.fr/docs-web/docs/download/413731), [354850](https://inpn.mnhn.fr/docs-web/docs/download/354850) | version reports / structure; one mentions vernacular names for odonates, hemipterans and fungi | Indexed in search, **not read** |
| [Wikidata property P1843 "taxon common name"](https://www.wikidata.org/wiki/Property:P1843) | monolingual-text common names per taxon item (filter by language tag) | Checked 2026-11-21. CC0 licence of Wikidata data **not confirmed** here; check the Wikidata terms. |
| GBIF backbone `vernacularNames` | multi-source common names | Not checked; per-name licences vary |

Mapping used by the plan: CSV `cd_ref` (94.9 % filled) → TAXREF; vernacular entries attach to a `cd_nom` that may be a synonym ⇒ join through `cd_nom → cd_ref`.

## 5. Data delivery and performance

| Source | Used for | Status |
|---|---|---|
| [PMTiles docs](https://docs.protomaps.com/pmtiles/) and the [PMTiles repository](https://github.com/protomaps/PMTiles) | single-file tile archive read with HTTP `Range` requests; works on any storage with Range + CORS | Checked 2026-11-21 (search result summaries). One write-up reports a static host without Range support worked around with a service worker. |
| Worker-from-Blob on `file://` | the engine-in-a-worker option | Checked 2026-11-21: search results mixed. A WebKit bug reports workers from `blob:`/`data:` URLs fail in `file://` documents; an old Q&A claims Chrome works. Module workers/ES modules rely on CORS and are blocked on `file://`. **Needs a spike per browser.** See [MDN Worker()](https://developer.mozilla.org/docs/Web/API/Worker/Worker). |
| [GitHub docs — Git LFS billing](https://docs.github.com/en/billing/concepts/product-billing/git-lfs) | whether LFS quota is a risk for the 219 MB CSV | Checked 2026-11-21: the 1 GiB figure is legacy; current docs list larger free allowances (the exact current number differs between GitHub pages — 10 GiB on one, a changelog mentions 250 GiB). Conclusion: not a blocker; still prefer a checksum-verified download script. |
| deck.gl / Apache Arrow / DuckDB-WASM | considered and **rejected for the standalone build** (WASM size, `fetch` need) | Not researched in this session; rejection is a design judgement, revisit with the benchmark |

## 6. Accessibility

| Source | Used for | Status |
|---|---|---|
| WCAG 2.2 (contrast 1.4.3 / non-text contrast 1.4.11, target size 2.5.8, name/role/value 4.1.2) | thresholds in `plans/ui-overhaul.md` | Known criteria; **contrast ratios in the plan were computed in this session** with the WCAG relative-luminance formula: `#8a7d66` on `#f7f4ee` = 3.67:1; white on `#56B4E9` = 2.31:1; white on `#E69F00` = 2.25:1 |

## 7. To read next (suggested, not yet read)

1. INPN TAXREF technical documentation for the current version (vernacular file structure and licence).
2. Official API Géo OpenAPI page (contour parameters, coordinate precision).
3. IGN ADMIN-EXPRESS licence page (Licence Ouverte) and file sizes of the simplified TopoJSON.
4. Mapshaper documentation on topology-preserving simplification (for `tools/prepare_communes.py` if Node is accepted).
5. GBIF guidance on sensitive species and coordinate generalisation (for the second dataset).
6. A comparison of crossfilter-style incremental filtering vs. full passes at ≥ 5 M rows (only if the benchmark demands it).
