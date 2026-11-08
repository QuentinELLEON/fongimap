#!/usr/bin/env python3
"""
Assemble the standalone index.html from:
  src/index.template.html   page skeleton with placeholders
  src/style.css             styles
  src/app.js                application logic
  build/fflate.umd.js       zlib inflate (inlined)
  build/d3.min.js           D3 v7 (inlined)
  data_processed/*.geojson  basemap (inlined, coordinates rounded to 4 decimals)

Usage:  python assemble_html.py [--out DIR]
The resulting index.html expects data.js (from build.py) in the same folder.
"""
import argparse
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
MAX_KB = 1.2 * 1024  # NFR-03.1


def read(path):
    return Path(path).read_text(encoding="utf-8-sig").strip()


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


def safe_script(js):
    """Prevent an inline script from terminating early."""
    return re.sub(r"</(script)", r"<\\/\1", js, flags=re.I)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=str(ROOT), help="output directory for index.html")
    args = ap.parse_args()

    for p in ("src/app.js", "src/style.css", "src/index.template.html", "build/d3.min.js",
              "build/fflate.umd.js", "data_processed/departements.geojson",
              "data_processed/regions.geojson"):
        if not (ROOT / p).is_file():
            sys.exit("ERROR: missing %s" % p)

    html = read(ROOT / "src" / "index.template.html")
    parts = {
        "/*%%CSS%%*/": read(ROOT / "src" / "style.css"),
        "/*%%FFLATE%%*/": safe_script(read(ROOT / "build" / "fflate.umd.js")),
        "/*%%D3%%*/": safe_script(read(ROOT / "build" / "d3.min.js")),
        "/*%%DEPTS%%*/": compact_geojson(ROOT / "data_processed" / "departements.geojson"),
        "/*%%REGIONS%%*/": compact_geojson(ROOT / "data_processed" / "regions.geojson"),
        "/*%%APP%%*/": safe_script(read(ROOT / "src" / "app.js")),
    }
    for key, val in parts.items():
        if key not in html:
            sys.exit("ERROR: placeholder %s not found in template" % key)
        html = html.replace(key, val)  # str.replace: no escaping issues with backslashes

    out_dir = Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)
    out = out_dir / "index.html"
    with open(out, "w", encoding="utf-8", newline="\n") as f:
        f.write(html)
    kb = out.stat().st_size / 1024
    print("index.html written: %.0f KB -> %s" % (kb, out))
    if kb > MAX_KB:
        print("WARNING: index.html exceeds the %.0f KB target" % MAX_KB)
    if not (out_dir / "data.js").is_file():
        print("Note: data.js is not next to index.html yet - run build.py first.")


if __name__ == "__main__":
    main()
