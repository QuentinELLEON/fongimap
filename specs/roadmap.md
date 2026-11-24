# FongiMap — Roadmap (from the cartographers' feedback, 21 Nov 2026)

Replaces `tasks.md` (historical). Each item has a GitHub issue (body = the detailed plan in `plans/`). Estimates are rough single-developer figures from the plans, **not commitments**; the biggest unknowns are listed per item.

| # | Issue | Plan | Size | Blocks / depends | Main unknown |
|---|---|---|---|---|---|
| 3 | [Noms français + recherche bilingue](https://github.com/QuentinELLEON/fongimap/issues/3) | [french-names](plans/french-names.md) | S–M (≈ 4–5 d + human review) | none | who reviews names; TAXREF vernacular file layout |
| 2 | [Améliorer l'UI générale](https://github.com/QuentinELLEON/fongimap/issues/2) | [ui-overhaul](plans/ui-overhaul.md) | L (≈ 19–22 d total; T1+T2+T6 ≈ 4.5 d) | T6 after #3; T5 with #1 | tablets/phones really targeted? |
| 1 | [Communes colorées au zoom](https://github.com/QuentinELLEON/fongimap/issues/1) | [communes-layer](plans/communes-layer.md) | L (≈ 9–13 d) | geometry package fits #5 but does not wait for it | real size of simplified commune geometry (spike) |
| 5 | [Fondation d'architecture](https://github.com/QuentinELLEON/fongimap/issues/5) | [architecture-foundation](plans/architecture-foundation.md) | L (≈ 10–14 d) | prerequisite of #4 | none blocking |
| 4 | [Second jeu de données dynamique + perfs](https://github.com/QuentinELLEON/fongimap/issues/4) | [dynamic-dataset](plans/dynamic-dataset.md) | XL (A ≈ 11–14 d, +B ≈ 5 d, +C ≥ 8 d) | needs #5 steps 2–6 | **what the second dataset is, what "dynamic" means** |

## Suggested order
1. **Now (no code risk):** merge this documentation; answer the open questions in each issue.
2. `#3` French names — small, fixes a visible defect (the search placeholder promises « cèpe » but only Latin names and families are searched).
3. `#2` quick wins T1 (tokens) + T2 (accessibility) + T6 (list/drawer), in parallel with the `#1` **spike** (geometry size) and the `#4` **spike** (columnar format, Worker on `file://`).
4. `#1` commune layer; `#2` T5 (map controls/legend) together with it.
5. `#5` foundation steps 2–6 (golden master → Engine → geo/taxa packages).
6. `#4` columnar v2 + worker, then the second dataset (regime A → B → C).
7. `#2` remaining chantiers (responsive, filter bar, URL state, export, i18n).

## Spikes (cheap, de-risk the expensive items)
| Spike | Question answered | Output |
|---|---|---|
| Commune geometry | How many MB for 35 k communes at 3 tolerances, topology kept? | table of raw / zlib / base64 sizes + test render |
| Columnar format | SoA vs 18-byte rows: size and decode time on the real CSV | numbers in `specs/performance.md` |
| Worker on `file://` | Does a Blob worker run in Chrome, Edge, Firefox, Safari? | compatibility table in `architecture.md` §6 |
| Vernacular names | Coverage of top 500 / top 2 000 species from TAXREF + Wikidata | coverage report + missing list |

## Definition of done (every item)
- Regression anchors unchanged (see `CLAUDE.md`), golden-master counters identical.
- `context.md` §7.x updated with what/why and measured numbers; `architecture.md` updated if the structure changed.
- No new network dependency at runtime; `file://` still works for the standalone build.
- Accessibility: no new non-focusable interactive element, contrast ≥ AA.

## Status (21 Nov 2026)
All five issues have an implementation on the integration branch `integration/cartographers-feedback` (see `context.md` §9 for what was done, deviations and what is left): #3 done (coverage gap: 129 of the top-500 species still need a reviewed name), #1 done, #5 partly (engine / worker / tests / CI done; package split with canonical keys, esbuild and folder moves not done), #2 done except i18n and dark theme, #4 infrastructure done (selector, chunked progressive loading, remote contract) but no real second dataset yet: see the research PR.

## Status (updated after the second round)
#1, #2 (except axe-core and the usability test), #3 and #4 (second dataset integrated: GBIF France macrofungi since 2022) are implemented on `main`; #5 is implemented except the items listed in `architecture.md` §9 (shared taxa table, versioned header, layout reorganisation, esbuild — the last two decided against). See `context.md` §11 for the remaining list.

## Status (24 November 2026, branch `feat/open-issues-9-10-12-13-14`)
Issues #10 (clean-up and split deliverable), #12 (performance at deep zoom), #13 (side panel toggle) and #14 ("Autour de moi") are implemented; #9 is a checklist: the items doable without third parties were done (axe-core audit, `file://` worker check on Chrome and Edge, versioned format header), the rest stays open with its reason. See `context.md` §13.
