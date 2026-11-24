# specs/ — documentation index

| File | Status | Purpose |
|---|---|---|
| [`architecture.md`](architecture.md) | **current** (proposed target) | Review of today's structure (findings A1–A15), target architecture (static-first, server-optional), ADR log, `file://` constraints. |
| [`roadmap.md`](roadmap.md) | **current** | Planned work, order, dependencies, links to GitHub issues. |
| [`plans/`](plans/) | **current** (French) | One detailed implementation plan per issue: [communes](plans/communes-layer.md) · [UI](plans/ui-overhaul.md) · [noms français](plans/french-names.md) · [second jeu de données](plans/dynamic-dataset.md) · [fondation d'architecture](plans/architecture-foundation.md). |
| [`literature.md`](literature.md) | **current** | Sources behind the design and how far each was verified; §8–13 = research round on fungal data, citizen science, phenology, safety, GBIF. |
| [`datasets.md`](datasets.md) | **current** | Choice of the second (dynamic) dataset: candidates, measurements, recommendation, open questions. |
| [`performance.md`](performance.md) | **current** | Measured engine, format and geometry costs. |
| [`context.md`](context.md) | **current, living log** | Request, investigation, decisions and implementation record (§7.x). §8–10 = cartographers' feedback round, implementation, research. |
| [`requirements.md`](requirements.md) | **current (v2)** | What the application does today and how each requirement is checked. |
| [`design.md`](design.md) | **current (v2)** | Deliverable, build, runtime architecture, interface. |
| [`history/`](history/) | historical | The v1.0 requirements, design and task list (original intent). |

Rule: when the code changes, update `context.md` (what/why) and, if the structure or a decision changes, `architecture.md`. Do not edit `history/` except for corrections of fact.

Paths renamed on 24 November 2026 (ADR-12): `build.py` → `tools/build_data.py`, `assemble_html.py` → `tools/build_web.py`, `pipeline/` → `tools/pipeline/`, `build/` → `vendor/`, `data.js` / `datasets.js` / `geo-communes.js` / `data-*.js` → `assets/data/`, `src/style.css` → `src/css/*.css`, `src/index.template.html` → `index.html`. Older sections of `context.md`, the plans and `history/` keep the names of their time.
