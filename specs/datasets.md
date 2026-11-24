# FongiMap — Choosing the second (dynamic) dataset

**Date:** 21 November 2026 · **Status:** research + working importer; the choice below is a **recommendation**, the owner decides (open questions at the end).
Context: `plans/dynamic-dataset.md` (architecture, three regimes), `literature.md` §8–12 (sources), `performance.md` (cost of size).
All counts below were obtained from the public GBIF API on 21 November 2026 and will drift.

## 1. What "dynamic" has to mean here

The first dataset (FongiBase extract, Zenodo record 17158524, "Version 1", published 2025-09-19) is a **static snapshot ending in 2021**. A useful second dataset should therefore:

1. **keep growing** (new observations without us re-cutting a CSV by hand);
2. **complement** FongiBase instead of duplicating it (other period, other observers, other data flows);
3. carry a licence we can **redistribute with attribution** (CC0 / CC-BY) — FongiMap ships its data inside a downloadable page;
4. have **usable positions** (and honest uncertainty), and respect the publisher's protection of sensitive species;
5. be reachable **without a server of ours**: an open API or periodic export we can turn into static chunk files (regime B of the plan), with the option to query a server later (regime C);
6. fit the current schema (species, date, position, place name) with little loss.

## 2. Candidates

| # | Candidate | Size / freshness (measured) | Licence | Fit | Verdict |
|---|---|---|---|---|---|
| A | **GBIF occurrences: Fungi, country FR, 2022 →** (aggregates iNaturalist, Observation.org, CardObs, regional SINP datasets, …) | 1 255 170 occurrences all years; **128 542 since 2022**; datasets last modified days ago (iNaturalist dataset: 2026-11-19, Observation.org 2026-11-17) | per record: CC-BY 4.0 (1 063 396), CC-BY-NC 4.0 (133 966), CC0 (57 808) over all years | best schema fit; one API; continues FongiBase in time; FongiBase itself flows to GBIF through SINP (J. Fungi 2022) | **Recommended** with filters (§3) |
| B | iNaturalist API directly (France, fungi, research grade) | 119 836 observations returned by the API (place id for France to be double-checked) | per observation (mix of CC0 / CC-BY / CC-BY-NC / all rights reserved) | richest metadata (photos, community IDs), real time | Same observers as A's biggest source; use only if we need photos or hourly freshness (regime C). Rate limits apply |
| C | Observation.org | 18 838 FR fungi occurrences on GBIF (all years) | CC-BY-NC (sample record) | good, but NC | Only through A, and only if NC is acceptable |
| D | FongiBase / ADONIF live database | no public API found; Zenodo shows no newer version | CC-BY 4.0 | native schema | Ask ADONIF about periodic exports; until then it already reaches us through A |
| E | INPN / SINP open data (national occurrence flows) | most regional SINP datasets already appear in GBIF (many of them are published by UAR PatriNat, the INPN / SINP operator, per the GBIF organisation record) | open licence (verify per dataset) | unknown | Check with INPN whether a dedicated fungi export exists |
| F | Herbarium and sequence datasets in GBIF (MNHN cryptogamy collection, INSDC sequences, Swiss fungi databank) | thousands to tens of thousands | CC-BY / CC0 | specimens, not field observations | Out of scope (different meaning of a "record") |

## 3. Findings that change the plan (measured)

1. **"Fungi" on GBIF is mostly lichens.** Of the 32 210 French records since 2022 that pass the strict filters below, only **7 914 are not lichens** (75 % lichens: Xanthoria parietina, Flavoparmelia caperata, Parmelia sulcata… lead the list). FongiBase is a macrofungi database; comparing the two without a filter would mislead. The importer excludes lichen classes/orders by default (`--keep-lichens` to keep them).
2. **The licence filter is the biggest cut.** Since 2022: 125 915 French fungi occurrences have coordinates and no geospatial issue; only **48 759** of them are human observations under CC0 / CC-BY (the rest is mostly CC-BY-NC). Adding a coordinate uncertainty ceiling of 1 km leaves **32 780** (all taxa).
3. **Sensitive species are blurred by publishers** (positions of threatened taxa are generalised to coarse cells; the exact size is publisher-specific and was not checked). The uncertainty ceiling removes them from the map instead of drawing a false point: this follows GBIF's best-practice guide (never "refine" generalised coordinates).
4. **Overlap with FongiBase is by source, not by record**: FongiBase's records are transferred to GBIF via SINP, the extract stops in 2021, so a `year ≥ 2022` slice has no date overlap; near-duplicates are still possible if the same observation is published by two aggregators (not checked).
5. **Taxonomy and names**: GBIF species names are backbone names, not TAXREF `cd_ref`; 982 of the 1 725 species of the unfiltered slice exist in FongiBase. With lichens removed, 446 species have a French name (66 % of the records); new species stay Latin-only until `tools/prepare_vernacular.py --extra-csv` finds a name.

## 4. Recommendation

**Dataset 2 = "GBIF — champignons de France depuis 2022"**, built from GBIF with: country FR, taxonKey 5 (Fungi) **minus lichens**, human observations, with coordinates and no geospatial issue, **CC0 / CC-BY 4.0 only**, coordinate uncertainty ≤ 1 000 m, year ≥ 2022.
Delivered **as regime B** (chunked static files, rebuilt on demand/weekly), so it works serverless and can move behind the remote engine later.

Current size of that strict slice: **7 914 occurrences, 1 219 species, 96 départements** (built and loaded in the app: `?ds=gbif_fr_recent`, period slider 2022–2026, French names where known). It is a thin dataset today; the levers to grow it, from least to most controversial:

| Lever | Effect | Cost / risk |
|---|---|---|
| Raise the uncertainty ceiling to 5 km | adds commune-level positions | the map already distinguishes approximate positions; needs a legend wording check |
| Move the start year back (2016–2021) | many more records, but **overlaps FongiBase dates** | needs a duplicate check by (species, date, position) before use |
| Allow **CC-BY-NC** (`--allow-nc`) | the large majority of iNaturalist / Observation.org records | NC forbids commercial use and redistribution terms must be kept; **owner decision** (project licence, who hosts) |
| Add the pre-2022 CC-BY records of non-FongiBase providers | more history | same duplicate check |

See §6 for the measured effect of the NC option.

## 5. Mapping and what the importer does (`tools/import_gbif.py`)

| FongiBase column | GBIF field / rule |
|---|---|
| `id` | occurrence `key` |
| `genus_species_ref`, `genus_ref`, `species_ref` | `species`, `genus`, epithet |
| `family`, `order`, `class`, `phylum` | same-named fields |
| `cd_ref` | **not available** (left empty; names are matched by Latin binomial) |
| `trophic_mode`, `guild` | filled from FongiBase by species, else by genus (enrichment, may be wrong for new species) |
| `date` | `eventDate` cut to `YYYY-MM-DD` |
| `department` | `stateProvince` "(NN)" when present, else the commune polygon of the point (`tools/pipeline/communes.py`) |
| `locality` | `locality` |
| `ecoregion` | modal value of the département in FongiBase |
| `gps_latitude`, `gps_longitude` | `decimalLatitude`, `decimalLongitude` (metropolitan bounding box only) |
| observer | **never read** (`recordedBy` is not requested nor stored: personal data) |

Other safeguards: monthly API slices (the search API refuses offsets above 100 000), de-duplication by occurrence key, a User-Agent that names the tool only.

## 6. Measured effect of relaxing the filters

Human observations with coordinates and no geospatial issue, 2022 → November 2026, counted from GBIF facets (lichen share estimated at **class level** only: Lecanoromycetes, Arthoniomycetes, Lichinomycetes, Candelariomycetes, Coniocybomycetes, Collemopsidiomycetes; the importer also removes lichenised orders, so its counts are a little lower: 7 914 against 9 046 for the first row).

| Filters | All records | Lichen classes | Remaining (macrofungi, estimate) |
|---|---|---|---|
| CC0 + CC-BY, uncertainty ≤ 1 km (**recommended start**) | 32 780 | 23 734 | ≈ 9 000 (importer: 7 914) |
| CC0 + CC-BY, ≤ 5 km | 39 117 | 25 487 | ≈ 13 600 |
| + CC-BY-NC, ≤ 1 km | 79 746 | 35 376 | ≈ 44 400 |
| + CC-BY-NC, ≤ 5 km | 89 654 | 37 749 | ≈ 51 900 |
| + CC-BY-NC, ≤ 30 km (everything but strongly blurred positions) | 94 896 | 38 964 | ≈ 55 900 |

Allowing CC-BY-NC multiplies the usable macrofungi records by about **five**. That is the decision that matters most (question 1).

## 7. Refreshing ("dynamic")

- **Now:** `python tools/import_gbif.py && python tools/build_data.py --csv … --dataset-id gbif_fr_recent --chunks 3 --year-min 2022 --year-max <current year> …` (≈ 5 minutes for the strict slice). Output files (in `assets/data/`): `data-gbif_fr_recent.js` + chunk files + `datasets.js` (git-ignored: they are build artefacts).
- **Automatable:** `.github/workflows/refresh-gbif.yml` (manual trigger, **untested on GitHub**) rebuilds and uploads the files as an artifact; scheduling and publishing (Pages / release) are one decision away.
- **Citation:** the search API gives **no DOI**. For anything redistributed, run a GBIF *download* with the same filters (needs a GBIF account) and cite its DOI, as the GBIF data-user agreement asks; keep the per-dataset licence in the data (not done yet: the importer keeps only records whose licence is accepted and records nothing per row).
- **Later (regime C):** the remote engine contract (`engine-remote.js`, `tools/serve_remote.js`) lets a server answer filters if the dataset ever outgrows the browser.

## 8. Open questions for the owner

1. Is **CC-BY-NC** acceptable for FongiMap (non-commercial hosting, no redistribution of the data files)? It multiplies the dataset size; the answer also depends on the project's own licence.
2. Do we want **lichens** as a separate, switchable facet instead of excluding them?
3. Who owns the GBIF account for **download DOIs**, and where should rebuilt datasets be published?
4. Should near-duplicates against FongiBase be removed before extending the period back to 2016–2021?
5. Is a dedicated **ADONIF / SMF / INPN** export possible? (It would beat any aggregator for macrofungi quality.)
6. Photos from iNaturalist would enrich the species drawer: acceptable licence-wise (per photo) and worth a separate integration?

## 9. Third dataset: "GBIF — positions précises (≤ 100 m)" (24 November 2026)

**Why.** FongiBase has a GPS point for only 43 % of its records and the centre of the commune for 33 %. Measured on the GBIF API on 24 November 2026 (macrofungi: Agaricomycetes, Pezizomycetes, Dacrymycetes, Tremellomycetes; human observations; CC0 + CC-BY): positions declared accurate to ≤ 100 m number 4 986 since 2022, 12 047 for 2010-2021 and 28 235 over all years (≤ 1 km: 6 607 / 19 060 / 41 915; ≤ 30 m: 4 245 / 6 449 / 11 400); allowing CC-BY-NC would add about 30 000 / 18 000 / 32 000 at ≤ 100 m.
**Choice.** Not the 2022-only slice (it is a subset of `gbif_fr_recent`), and not CC-BY-NC (open licence decision, §8 question 1): **1990 → today, CC0 + CC-BY, coordinate uncertainty ≤ 100 m, lichens excluded.** It is a separate, selectable dataset (the selector reloads the page), so its overlap with FongiBase for 2010-2021 does not double count anything.
**Result.** 26 813 occurrences, 2 602 species (646 with a French name), 96 départements, 2.6 MB (`assets/data/data-gbif_precise.js`, embedded, no chunks); checksum verified (`?ds=gbif_precise&verify=1`), loads on `file://` in Chrome (`CHECK_QUERY="?ds=gbif_precise" node tools/check_file_url.js`).
**Rebuild.**
```
python tools/import_gbif.py --from-year 1990 --max-uncertainty 100 --out test_data/gbif_precise.csv      # ≈ 15 min (monthly API slices)
python tools/build_data.py --csv test_data/gbif_precise.csv --dataset-id gbif_precise --year-min 1990 --year-max <year> --title "GBIF — champignons de France, positions précises (≤ 100 m)" --credit "…" --licence "CC0 / CC-BY 4.0" --updated <date>
git checkout assets/data/geo-communes.js     # the build rewrites it identically except for its header comment
```
**Default.** Since 24 November 2026 this is the dataset opened without `?ds=` (`window.FMAP_DS_DEFAULT` in `index.html`); FongiBase stays one click away (`?ds=fongibase`, header selector) and keeps the regression anchors of `CLAUDE.md`. Exports (PNG, CSV) carry the credit line of the dataset in use. A thinner default (26 813 against 1 043 262 observations) trades coverage for position quality: 99 % of its records are located, none only at a commune centre.
**Limits.** Uncertainty is declared by the publisher (often phone GPS accuracy) and records without a value are excluded; sensitive species are blurred by publishers and therefore absent; GBIF names are not TAXREF (2 027 of 2 602 species have a `cd_ref`); no GBIF download DOI yet (§7), so cite GBIF.org with the access date until one is made.
