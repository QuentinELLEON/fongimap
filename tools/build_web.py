#!/usr/bin/env python3
"""
Build the browser assets (everything under assets/ except assets/data/) from the sources.

  src/css/*.css            styles, concatenated in file-name order            -> assets/css/app.css
  src/js/core/*.js         record engine, client, search, URL state, helpers   -> assets/js/core.js
                           (also run in a Web Worker and in the Node tests)
  src/js/app/*.js          application logic, concatenated in file-name order
                           inside ONE function scope (no modules)             -> assets/js/app.js
  vendor/*.js              D3 v7 and fflate, copied unchanged                  -> assets/js/vendor/
  data_processed/*.geojson basemap (départements, régions), coordinates
                           rounded to 4 decimals                               -> assets/js/geo-france.js
  (derived)                text of fflate + core, for the Web Worker Blob      -> assets/js/worker-source.js

index.html is hand-written (it only references these files); the datasets in assets/data/ come from
tools/build_data.py.  Everything is a classic script so that a double-click on index.html works (file://).

Usage:  python tools/build_web.py [--out DIR]      (default DIR = repository root; with another DIR, index.html is copied too)
"""
import argparse
import json
import re
import shutil
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
MAX_KB = 1.6 * 1024          # budget for the whole of assets/css + assets/js (the old single index.html was 0.9 MB)

# order matters only for readability: everything in core is resolved at call time
CORE_FILES = ["engine.js", "engine-client.js", "search.js", "urlstate.js", "engine-remote.js", "contour.js", "nearby.js"]
VENDOR_FILES = ["fflate.umd.js", "d3.min.js"]


def read(path):
    return Path(path).read_text(encoding="utf-8-sig").strip()


def concat_js(folder, names=None):
    base = ROOT / "src" / "js" / folder
    files = [base / n for n in names] if names else sorted(base.glob("*.js"))
    return "\n".join(Path(f).read_text(encoding="utf-8") for f in files)


def round_coords(o, nd=4):
    if isinstance(o, float):
        return round(o, nd)
    if isinstance(o, list):
        return [round_coords(x, nd) for x in o]
    return o


def compact_geojson(path):
    """Minify a GeoJSON file: keep only code/nom properties, round coordinates."""
    gj = json.loads(read(path))
    for f in gj["features"]:
        f["geometry"]["coordinates"] = round_coords(f["geometry"]["coordinates"])
        f["properties"] = {k: f["properties"][k] for k in ("code", "nom") if k in f["properties"]}
    return json.dumps(gj, ensure_ascii=False, separators=(",", ":"))


def write(path, text):
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8", newline="\n") as f:
        f.write(text)
    return path.stat().st_size


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=str(ROOT), help="output directory (assets/ is created inside it)")
    args = ap.parse_args()
    out = Path(args.out)

    needed = ["index.html", "src/js/app/00-state.js", "src/js/core/engine.js", "src/css/00-base.css",
              "vendor/d3.min.js", "vendor/fflate.umd.js", "data_processed/departements.geojson", "data_processed/regions.geojson"]
    for p in needed:
        if not (ROOT / p).is_file():
            sys.exit("ERROR: missing %s" % p)

    sizes = {}
    css = "\n".join(Path(f).read_text(encoding="utf-8").rstrip("\n") + "\n" for f in sorted((ROOT / "src" / "css").glob("*.css")))
    sizes["assets/css/app.css"] = write(out / "assets/css/app.css", css)

    for n in VENDOR_FILES:
        dst = out / "assets/js/vendor" / n
        dst.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(ROOT / "vendor" / n, dst)
        sizes["assets/js/vendor/" + n] = dst.stat().st_size

    geo = ("// Basemap of France (départements, régions): data_processed/*.geojson, simplified; built by tools/build_web.py\n"
           "window.FMAP_DEPTS = %s;\nwindow.FMAP_REGIONS = %s;\n"
           % (compact_geojson(ROOT / "data_processed" / "departements.geojson"), compact_geojson(ROOT / "data_processed" / "regions.geojson")))
    sizes["assets/js/geo-france.js"] = write(out / "assets/js/geo-france.js", geo)

    core = concat_js("core", CORE_FILES)
    sizes["assets/js/core.js"] = write(out / "assets/js/core.js", "// Record engine and helpers (no DOM): built from src/js/core by tools/build_web.py\n" + core)

    # the Web Worker is started from a Blob (a worker cannot be loaded from a file:// URL): its source travels as a string
    worker = read(ROOT / "vendor" / "fflate.umd.js") + "\n" + core
    sizes["assets/js/worker-source.js"] = write(out / "assets/js/worker-source.js",
                                                "// Text of fflate + core, used to start the Web Worker from a Blob. Built by tools/build_web.py\nwindow.FMAP_WORKER_SRC = %s;\n" % json.dumps(worker, ensure_ascii=False))

    app = concat_js("app")
    sizes["assets/js/app.js"] = write(out / "assets/js/app.js", "// Application: built from src/js/app/*.js (one function scope) by tools/build_web.py\n" + app)

    if out.resolve() != ROOT:
        shutil.copyfile(ROOT / "index.html", out / "index.html")

    total = sum(sizes.values()) / 1024
    for k in sorted(sizes):
        print("  %-34s %7.0f KB" % (k, sizes[k] / 1024))
    print("assets built in %s: %.0f KB (+ index.html %.0f KB)" % (out, total, (ROOT / "index.html").stat().st_size / 1024))
    if total > MAX_KB:
        print("WARNING: assets exceed the %.0f KB budget." % MAX_KB)
    if not (out / "assets/data/data.js").is_file():
        print("Note: assets/data/data.js is not there yet - run tools/build_data.py first.")


if __name__ == "__main__":
    main()
