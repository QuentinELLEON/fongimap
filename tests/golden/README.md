# Golden master

`baseline.json` holds the counters of 20 filter scenarios (`scenarios.json`), first recorded from the original
application (before the engine refactor, `assets/data/data.js` built from the real CSV).

Intentional re-baselining:
- **valbonne** (2026-11-21, issue #1): commune membership of a place moved from "nearest commune centre / same-name
  commune within 12 km" to an exact point-in-polygon test on IGN commune boundaries. Valbonne (06) went from
  302 observations / 180 species / 7 places to **313 / 181 / 9**. All 19 other scenarios are unchanged.

Run `node --test "tests/*.test.js"` (needs a built `assets/data/data.js`). In a browser: see `browser-run.js`.
