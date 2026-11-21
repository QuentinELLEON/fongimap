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

---

# Research round of 21 November 2026 (second dataset and literature)

How to read this part: every entry comes from a web search run on 21 November 2026; the statements are what the **search result summaries** said, I did not read the full papers unless marked "read". "Implication" lines are my proposals for FongiMap, not findings of the sources. Items whose mapping from URL to paper I could not confirm are flagged.

## 8. The French national fungal database and GBIF

| Source | What it says (as returned by the search) | Implication |
|---|---|---|
| [Gautier et al. 2022, *Unravelling the French National Fungal Database*, J. Fungi 8(9):981](https://www.mdpi.com/2309-608X/8/9/981/html) (also [PMC9504494](https://pmc.ncbi.nlm.nih.gov/articles/PMC9504494)) | First national mycological database initiated in 2008 (SMF, SMNF, MNHN, Université de Lille 2); hosted by the association ADONIF since 2015; contains the located-records database **FongiBase** and the taxonomic reference tool **FongiRef**; **FongiBase records are systematically transferred to GBIF through the French SINP**; four clusters of intense sampling in France, Mediterranean poorly documented; Basidiomycota 88.8 % and Agaricales 50.4 % of records | A GBIF second dataset **contains FongiBase's own sources**: dedupe by date (FongiBase extract ends in 2021) and expect near-duplicates in 2022+ if ADONIF data keep flowing |
| [Zenodo record 17158524](https://zenodo.org/records/17158524) | Published 2025-09-19, "Version 1", CC-BY 4.0; the API shows no newer version | FongiBase is a **static** snapshot, not a dynamic source |
| [GBIF data-use page "Distribution and diversity of macrofungi in Europe"](https://www.gbif.org/data-use/5ClnNPphVKTBhjJ0XMuQS) | GBIF holds a large amount of macrofungal occurrence data, especially in Europe, from amateurs, researchers and naturalists | Supports using GBIF as the generic source |
| INPN species pages, e.g. [cd_nom 463944](https://inpn.mnhn.fr/espece/cd_nom/463944/tab/sources) | Lists SMF and ADONIF as providers; carries the caveat that available data reflect the state of knowledge and must never be considered exhaustive | Reuse this caveat wording in the app's "limits" panel |
| [SMF newsletter no. 30](https://www.mycofrance.fr/wp-content/uploads/2015/05/Lettre-de-la-SMF-30.pdf) | Mentions an SMF project submitted to the INPN to list and map French fungal taxa, possibly with direct transfer into the INPN database | Possible future **authoritative** French source (status unknown): ask SMF / INPN |

## 9. Sampling bias, effort and data quality of fungal records

| Source | Finding | Implication |
|---|---|---|
| [Journal of Fungi 2022 (DOAJ record)](https://doaj.org/article/92543054916a4eda8ba42e3e25742cbb) and [MDPI Conservation 6(2):40](https://www.mdpi.com/2673-7159/6/2/40) (returned for the query; relevance to fungi not confirmed for the second) | Macrofungi need high sampling frequency and long periods; reduced sampling can lose recorded species | Keep the "effort, not abundance" disclaimer prominent; never read absence as absence |
| Central-European study on mammals and vascular plants (returned by the search; title not captured) | Argues for separating **data-quality errors** from **structural spatial bias** (records cluster near roads, towns, accessible areas) | Distinguish "uncertain position" (already shown) from "unevenly sampled area" (not shown): candidate feature: an effort layer (observation days or distinct observers per cell when the data allow it) |
| [Battersby, Strebe & Finn 2016 (PDF hosted on tableau.com; the title I remember, *Shapes on a plane: evaluating the impact of projection distortion on spatial binning*, was not confirmed by the search)](https://tableau.com/sites/default/files/2023-01/Battersby_Strebe_Finn_2016.pdf) | Binning (hexagons included) is often used without discussing its hazards; readers assume equal-area bins; projection distortion complicates density estimates; trade-offs apply to any bin shape | FongiMap's hexagons are 10 km in Lambert-93 (a conformal projection: cell *area* varies slightly with latitude): say "≈ 87 km²", keep the legend note, and measure the actual area spread (not done) |
| [ALA Labs: hex maps for species occurrence data](https://labs.ala.org.au/posts/2021-04-14_hex-maps-for-species-occurrence-data/) and [hexagons + points on one map](https://labs.ala.org.au/posts/2024-01-25_hex_point_maps) | Practical recipes: hexagon grid over a country outline, counts on a log colour scale, hexagons with points for sparse areas; hexagon size is the key design parameter; hexagons avoid the diagonal-neighbour bias of squares | Matches the current semantic zoom (departments → hexagons → places); consider a log or quantile-with-visible-breaks scale choice documented in the legend |
| [GBIF *Current best practices for generalizing sensitive species occurrence data* (Chapman, 2020)](https://docs.gbif.org/sensitive-species-best-practices/master/) | Explains how generalised records at different precisions should be read; sensitivity designations should carry a review date and reasons | Any imported dataset must **not undo** a publisher's coordinate generalisation: filter on `coordinateUncertaintyInMeters`, never "refine" positions |
| PMC article [PMC7528811](https://pmc.ncbi.nlm.nih.gov/articles/PMC7528811) (returned for the query) | Erroneous or overly imprecise coordinates are a central problem for downstream analyses | Keep the geospatial-issue filter and an uncertainty ceiling in the importer |

## 10. Citizen science, identification accuracy and safety

| Source | Finding | Implication |
|---|---|---|
| [iNaturalist blog: *A second experiment to learn about the accuracy of iNaturalist observations*](https://www.inaturalist.org/blog/90263) | Research Grade estimated 97 % correct, Needs ID 79 %; the dataset is skewed to common, easy species, which inflates the average | Do not transfer the 97 % to difficult macrofungi; keep "Research Grade" only as a filter, not as a guarantee |
| [PubMed 36794335, *A comparison of the accuracy of mushroom identification applications using digital photographs* (Clin. Toxicol. 2023)](https://pubmed.ncbi.nlm.nih.gov/36794335/) | 78 specimens, 3 apps: best 49 % correct (Picture Mushroom), iNaturalist 35 %; for poisonous species 30–44 %; small sample, very wide confidence intervals; authors report poisonings after wrong "edible" identifications | The app's edibility note must stay conservative; consider adding a visible "photo apps are not reliable" line in the help panel |
| [Allen & McMullin on lichen Research-Grade observations](https://par.nsf.gov/servlets/purl/10436322) (URL returned for the query; paper identity not confirmed) | For lichens, accuracy varied from nothing identifiable to 100 % correct by species | Relevant because **GBIF "Fungi" is ~3/4 lichens** (see `datasets.md`): exclude lichens or flag them |
| [ANSES: la saison des champignons avance, soyez vigilant](https://www.anses.fr/fr/actualite/saison-champignons-avance-cette-annee-soyez-vigilant-face-aux-risques-dintoxications), [ANSES toxicovigilance report](https://www.anses.fr/system/files/Toxicovigilance2023VIG0127Ra.pdf) | Surveillance since 2016 from poison-centre data; more than 1 300 cases reported over calendar year 2025; one death and three liver transplants after a phalloidian syndrome; a previous season peaked in October (56 % of cases); poison centres noted wrong identifications by smartphone apps | Seasonality shown in FongiMap (October peak of observations) is also the **poisoning peak**: pair the seasonal views with the ANSES advice and the poison-centre number given on the ANSES page |

## 11. Phenology and climate

| Source | Finding | Implication |
|---|---|---|
| Kauserud et al. 2012 (PNAS), summarised in the search; URL returned: [PMC3437857](https://pmc.ncbi.nlm.nih.gov/articles/PMC3437857) (mapping to the paper not confirmed) | 746 297 dated, geo-referenced records of 486 autumn-fruiting species (Austria, Norway, Switzerland, UK): fruiting season widened 1970–2007, mean fruiting date later; mycorrhizal fungi have a more compressed season than saprotrophs | A **phenology view per species** (share of records by month, split by guild) is scientifically meaningful with the data FongiMap already holds |
| 2009 Proc. B study on spring fungi (Norway, UK; ~6 000 records), returned via [PMC2842805](https://pmc.ncbi.nlm.nih.gov/articles/PMC2842805) (mapping not confirmed) | Spring fungi fruit progressively earlier | Show direction of trend only with a visible effort caveat |
| Swiss/Austrian altitudinal shift study 1960–2010 (returned among [PMC6426159](https://pmc.ncbi.nlm.nih.gov/articles/PMC6426159), [PMC7015340](https://pmc.ncbi.nlm.nih.gov/articles/PMC7015340), [PMC9828532](https://pmc.ncbi.nlm.nih.gov/articles/PMC9828532); mapping not confirmed) | Possible upslope shifts, confounded by drought and land use; pan-European analysis of ~4.9 million observations: mean annual temperature important, especially for autumn fungi | Altitude is not in the data (no DEM offline); a DEM could be an optional future layer |
| General caveat repeated across these results | Records are opportunistic and **collection effort grows over time**, which biases trends | Any trend feature must normalise by total records per year/month (share, not count) |

## 12. Using GBIF-mediated data (licences, DOI)

| Source | Finding | Implication |
|---|---|---|
| [GBIF citation guidelines](https://www.gbif.org/citation-guidelines), [data user agreement](https://tools.gbif.org/terms/data-user), [rgbif: citing GBIF-mediated data](https://docs.ropensci.org/rgbif/articles/gbif_citations.html), [GBIF data blog: search, download, analyze, cite](https://data-blog.gbif.org/post/search-download-analyze-cite) | Users who download data commit to cite it by **DOI**; each download gets its own DOI; the occurrence **search** API gives no citable DOI (run a download with identical filters to obtain one); the publisher's licence prevails over general terms | `tools/import_gbif.py` is good for prototypes; a published dataset needs a **GBIF download with DOI** (GBIF account) and a per-record licence column |

## 13. Ideas that follow from this literature (not implemented)

1. **Phenology panel** per species and per guild: monthly share of records, with the number of records shown and a normalisation by total monthly effort.
2. **Effort layer**: distinct observation days or observers per hexagon where the dataset provides an observer or event key (never store personal names).
3. **Provenance in the tooltip**: dataset, licence, coordinate uncertainty of the place.
4. **Safety pairing**: ANSES wording and the poison-centre number next to the "Toxiques / Mortelles" views; a "photo apps are unreliable" line.
5. **Lichen switch**: an explicit "Lichens" facet (class / order list) so that data sources that mix macrofungi and lichens stay comparable.
6. **Area check of the hexagons**: compute the real spherical area per cell and publish the spread (Battersby et al.).
