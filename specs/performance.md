# FongiMap — Performance measurements

Measured on 21 November 2026 on the development laptop (Windows 10, Node 26 / V8; page figures from the in-app Chromium pane). Reproduce: `node tools/bench_engine.js` (needs a built `data.js`). These are **single-machine, single-run-family** numbers: use them for orders of magnitude and for before/after comparisons, not as guarantees.

## Core engine (Node, real records, tiled to emulate larger datasets)

`filter()` = one filter pass + one aggregation pass, median of 5 runs.

| Records | init (decode + index) | none | species | month | département | years | all combined |
|---|---|---|---|---|---|---|---|
| 1.04 M (real) | 88 ms | 20 ms | 13 ms | 21 ms | 16 ms | 20 ms | 26 ms |
| 3.1 M (×3) | 275 ms | 47 ms | 31 ms | 49 ms | 34 ms | 49 ms | 52 ms |
| 5.2 M (×5) | 1 595 ms | 77 ms | 53 ms | 82 ms | 56 ms | 86 ms | 89 ms |

- Filtering scales linearly (≈ 15–17 ns per record). The earlier extrapolation in `plans/dynamic-dataset.md` §2 (110–330 ms at 5 M) was **too pessimistic**: the measured cost at 5.2 M is 53–89 ms.
- `init` is the part that grows faster than linearly at 5 M (typed-array allocation and the site map); it is paid once, and it runs in the worker.
- In the page (Chromium, 1.04 M records, worker engine): filter ≈ 7–8 ms + aggregate ≈ 21–27 ms inside the worker; the main thread only receives the aggregates. The 20 golden scenarios run identically in worker and main-thread mode.
- Page "render" after a result arrives (recolour, list re-render, animations): 300–470 ms measured while the golden runner changes filters back to back; it is the part to optimise next, not filtering.

## Record format: is a columnar (SoA) format worth it?

Question from the plan (`dynamic-dataset.md` §4.2). Measured on the real 1 043 262 records (zlib level 9):

| Layout | Compressed size |
|---|---|
| Interleaved 18-byte records, sorted by (département, species) — **current** | 3.97 MB |
| One byte plane per column (SoA) | 4.08 MB (+3 %) |
| Species column alone: raw 2.09 MB → zlib 0.25 MB; delta + zlib | 0.15 MB (saves ≈ 0.1 MB overall, 2.5 %) |

Because the records are already sorted, interleaving costs nothing in compression. **Decision: no columnar v2 format.** The remaining benefit (skipping the de-interleave loop) is ≈ 50–100 ms once per load and happens in the worker. Revisit only if a dataset cannot be pre-sorted.

## Commune geometry (IGN ADMIN-EXPRESS COG PLUS 2025, 34 750 metropolitan communes)

| Douglas-Peucker tolerance | vertices kept (of 518 286) | raw | zlib | base64 |
|---|---|---|---|---|
| 100 m (**shipped**) | 402 898 | 2.21 MB | 1.65 MB | 2.20 MB |
| 250 m | 297 724 | 2.04 MB | 1.45 MB | 1.93 MB |
| 500 m | 246 928 | 1.94 MB | 1.33 MB | 1.78 MB |

- The size is dominated by the 104 124 arcs, not by vertices: tolerance barely matters, so the finest tested value is shipped. A single level of detail is enough (the planned L2 level is not needed at this size). Budget in the plan was ≤ 3 MB: met (2.20 MB, in a separate `geo-communes.js` loaded lazily).
- `data.js` grew from 8.04 MB to 9.43 MB (full commune table of 34 750 names + population + area + label anchors, +1.4 MB). Limit NFR-03.2 is 12 MB.
- Full redraw of all map layers with the commune layer visible: 6.5 ms (Paris, k = 6), 1.8 ms (Jura, k = 6), 7.4 ms (k = 4.5), 2.4 ms (k = 9), 3.0 ms (k = 20). Geometry is decoded in slices while the page stays responsive, once, after the first frame.
- Build: 36 s end to end (was ≈ 25 s) with the polygon work (simplification alone measured at 8.5–10 s; the point-in-polygon pass was not timed separately).
- Site → commune: 45 149 / 45 200 sites fall inside a polygon; 51 (coast, border) use the nearest label point.

## Vernacular names (data preparation, not runtime)

- TAXREF v18 API: 12 756 `cd_ref` fetched in ≈ 8–10 minutes with 4–8 threads (resumable cache); 1 024 species have a French name. Wikidata (SPARQL, POST) added 64 more. Final: **1 088 species, 62.2 % of the observations; top 100 / 500 / 2 000 species: 90 % / 81 % / 68 %** (by observations). 129 of the 500 most observed species have no French name in either source (listed in `build_reports/missing_fr_top500.csv`, not versioned).

## Not measured

- Worker-from-Blob on `file://` in each browser (the page falls back to the main-thread engine automatically; the handshake takes ≤ 4 s to fail). Firefox, Safari, Edge not tested.
- Memory use (worker + main thread), low-end hardware, phones.

## IGN overlays (Géoplateforme, measured 21 November 2026)

| Layer | Payload per tile | Verdict |
|---|---|---|
| Forest mask 2021-2023 (WFS) | 0.05° tile: 372 kB JSON, **115 kB gzipped**, 0.8 s; 0.1° tile: 0.6–1.2 MB | used |
| BD TOPO vegetation (WFS) | 0.1° tile: 5.8 MB (2 261 polygons) | too heavy (would give forest types) |
| Contour lines (WFS `ELEVATION.CONTOUR.LINE:courbe`) | 0.1° tile: 30 MB (Jura, 38 s) / 124 MB (Alps, 121 s) | unusable |
| Elevations (altimetry POST) | 2 500 points in 2.2 s, `Access-Control-Allow-Origin: *`; HTTP 429 when several requests run in parallel | used, serialised |
| Summits / passes (WFS `detail_orographique`) | 48 kB for 73 features (Alps tile) | used |

At k = 66 over the Jura or the Oisans (24–30 tiles in view) all layers are ready in about 15–25 s on this connection; a full redraw of every layer takes ≈ 6 ms once loaded.
