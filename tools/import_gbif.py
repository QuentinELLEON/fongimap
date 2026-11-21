#!/usr/bin/env python3
"""
Import French fungal occurrences from GBIF into a CSV with the FongiBase columns, ready for build.py:

    python tools/import_gbif.py --from-year 2022 --out test_data/gbif_fr.csv
    python build.py --csv test_data/gbif_fr.csv --dataset-id gbif_fr_recent --chunks 5 \
        --title "GBIF - champignons de France depuis 2022" --licence "CC0 / CC-BY 4.0" \
        --credit "GBIF.org occurrences (France, Fungi), CC0 / CC-BY 4.0" --source https://www.gbif.org --updated 2026-11-21

Default selection (see specs/datasets.md for why): country FR, kingdom Fungi (taxonKey 5), HUMAN_OBSERVATION, with
coordinates and no geospatial issue, licence CC0 or CC-BY 4.0 only (CC-BY-NC is excluded unless --allow-nc),
coordinate uncertainty <= 1 000 m (this also drops the deliberately blurred positions of sensitive species).
The observer name (recordedBy) is never read or stored.

Uses the public search API in monthly slices (each slice stays far below the 100 000 offset limit). For a publication or a
redistributed copy, use a GBIF *download* instead: it yields a DOI that must be cited under CC-BY.

Columns that GBIF does not provide are enriched from the FongiBase CSV when --enrich is given and the file exists:
guild / trophic mode by species (else by genus), ecoregion by département (most frequent value).
The département comes from the GBIF stateProvince "(NN)" when present, else from the commune polygon of the point.
"""
import argparse
import csv
import json
import re
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

API = "https://api.gbif.org/v1/occurrence/search"
HEADERS = {"User-Agent": "fongimap-data-import/1.0 (open-source mycology map)"}
COLUMNS = ["id", "genus_species_ref", "genus_ref", "species_ref", "family", "order", "class", "phylum", "cd_ref", "trophic_mode", "guild",
           "date", "country", "department", "locality", "ecoregion", "CORINE_biotope", "gps_latitude", "gps_longitude"]
LICHEN_CLASSES = {"Lecanoromycetes", "Arthoniomycetes", "Lichinomycetes", "Candelariomycetes", "Coniocybomycetes", "Collemopsidiomycetes", "Ostropomycetidae"}
LICHEN_ORDERS = {"Verrucariales", "Pyrenulales", "Mycocaliciales", "Lecanorales", "Peltigerales", "Teloschistales", "Caliciales", "Graphidales", "Ostropales"}
FIELDS_USED = ("key", "species", "genus", "family", "order", "class", "phylum", "eventDate", "decimalLatitude", "decimalLongitude",
               "locality", "stateProvince", "license")


def get(params, retries=4):
    url = API + "?" + urllib.parse.urlencode(params, doseq=True)
    for attempt in range(retries):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=HEADERS), timeout=90) as r:
                return json.load(r)
        except Exception as e:
            print("   retry %d: %s" % (attempt + 1, str(e)[:90]))
            time.sleep(2 * (attempt + 1))
    raise SystemExit("GBIF request failed: " + url)


def dept_from_state(s):
    m = re.search(r"\((\d{2}|2A|2B)\)", s or "")
    return m.group(1) if m else ""


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--from-year", type=int, default=2022)
    ap.add_argument("--to-year", type=int, default=time.gmtime().tm_year)
    ap.add_argument("--out", default=str(ROOT / "test_data" / "gbif_fr.csv"))
    ap.add_argument("--max", type=int, default=0, help="stop after N rows (testing)")
    ap.add_argument("--max-uncertainty", type=int, default=1000, help="coordinate uncertainty in metres (0 = no limit)")
    ap.add_argument("--keep-lichens", action="store_true", help="keep lichenised fungi (GBIF Fungi includes ~3/4 lichen records; FongiBase is macrofungi only)")
    ap.add_argument("--allow-nc", action="store_true", help="also accept CC-BY-NC records (NOT redistributable commercially)")
    ap.add_argument("--enrich", default=str(ROOT / "data_raw" / "DATA_Gautier et al 2022.csv"), help="FongiBase CSV used to fill guild / trophic mode / ecoregion")
    args = ap.parse_args()
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

    base = {"country": "FR", "taxonKey": 5, "basisOfRecord": "HUMAN_OBSERVATION", "hasCoordinate": "true", "hasGeospatialIssue": "false",
            "license": ["CC0_1_0", "CC_BY_4_0"] + (["CC_BY_NC_4_0"] if args.allow_nc else [])}
    if args.max_uncertainty:
        base["coordinateUncertaintyInMeters"] = "0,%d" % args.max_uncertainty
    rows, seen = [], set()
    for year in range(args.from_year, args.to_year + 1):
        for month in range(1, 13):
            q = dict(base, year=year, month=month, limit=0)
            total = get(q)["count"]
            if not total:
                continue
            got = 0
            while got < total:
                page = get(dict(base, year=year, month=month, limit=300, offset=got))
                res = page.get("results", [])
                if not res:
                    break
                for r in res:
                    got += 1
                    if r["key"] in seen or not r.get("species") or r.get("decimalLatitude") is None:
                        continue
                    seen.add(r["key"])
                    rows.append({k: r.get(k) for k in FIELDS_USED})
                if page.get("endOfRecords"):
                    break
            print("%d-%02d: %d (total so far %d)" % (year, month, total, len(rows)))
            if args.max and len(rows) >= args.max:
                break
            time.sleep(0.2)
        if args.max and len(rows) >= args.max:
            break
    if not args.keep_lichens:
        n0 = len(rows)
        rows = [r for r in rows if (r.get("class") not in LICHEN_CLASSES) and (r.get("order") not in LICHEN_ORDERS)]
        print("lichen filter: %d -> %d occurrences" % (n0, len(rows)))
    # country=FR includes the overseas territories: keep metropolitan France (the map's bounding box) and Corsica only
    n_all = len(rows)
    rows = [r for r in rows if 41.0 <= r["decimalLatitude"] <= 51.5 and -5.5 <= r["decimalLongitude"] <= 10.0]
    print("fetched %d occurrences, %d inside the metropolitan bounding box" % (n_all, len(rows)))

    # enrichment tables from FongiBase (guild / trophic by species then genus; ecoregion by département)
    sp_info, ge_info, eco_by_dep, cdref_of = {}, {}, {}, {}
    enrich = Path(args.enrich)
    if enrich.exists():
        import pandas as pd
        df = pd.read_csv(enrich, usecols=["genus_species_ref", "genus_ref", "trophic_mode", "guild", "department", "ecoregion", "cd_ref"], dtype=str, encoding="utf-8-sig")
        modal = lambda s: s.dropna().mode().iloc[0] if s.notna().any() else ""
        g = df.dropna(subset=["guild"]).groupby("genus_species_ref")[["trophic_mode", "guild"]].agg(modal)
        sp_info = {k: (r.trophic_mode, r.guild) for k, r in g.iterrows()}
        g = df.dropna(subset=["guild"]).groupby("genus_ref")[["trophic_mode", "guild"]].agg(modal)
        ge_info = {k: (r.trophic_mode, r.guild) for k, r in g.iterrows()}
        e = df.dropna(subset=["ecoregion"]).groupby("department")["ecoregion"].agg(modal)
        eco_by_dep = dict(e)
        c = df.dropna(subset=["cd_ref"]).groupby("genus_species_ref")["cd_ref"].agg(modal)
        cdref_of = dict(c)                       # canonical TAXREF key for species that FongiBase also knows
        print("enrichment: %d species, %d genera, %d départements" % (len(sp_info), len(ge_info), len(eco_by_dep)))

    # département of the points without "(NN)" in stateProvince: commune polygons (pipeline/communes.py)
    need = [i for i, r in enumerate(rows) if not dept_from_state(r["stateProvince"])]
    dep_of = {}
    topo = ROOT / "data_raw" / "a_com2025_topo.json"
    if need and topo.exists():
        from pipeline import communes as C
        import numpy as np
        cg = C.build(topo, eps_m=1000.0, log=lambda m: None)
        lon = np.array([rows[i]["decimalLongitude"] for i in need]); lat = np.array([rows[i]["decimalLatitude"] for i in need])
        idx = C.assign_sites(cg, lon, lat, log=print)
        for i, c in zip(need, idx):
            dep_of[i] = cg["table"]["dep"][int(c)]
    elif need:
        print("note: %d records have no département (communes topology missing: python tools/fetch_raw.py --what communes)" % len(need))

    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    with open(out, "w", encoding="utf-8", newline="") as f:
        w = csv.writer(f, lineterminator="\n")
        w.writerow(COLUMNS)
        for i, r in enumerate(rows):
            sp = r["species"]; genus = r.get("genus") or sp.split(" ")[0]
            dep = dept_from_state(r["stateProvince"]) or dep_of.get(i, "")
            troph, guild = sp_info.get(sp) or ge_info.get(genus) or ("", "")
            date = (r.get("eventDate") or "")[:10]
            w.writerow([r["key"], sp, genus, sp.split(" ", 1)[1] if " " in sp else "", r.get("family") or "", r.get("order") or "", r.get("class") or "",
                        r.get("phylum") or "", cdref_of.get(sp, ""), troph, guild, date, "France", dep, r.get("locality") or "", eco_by_dep.get(dep, ""), "",
                        "%.6f" % r["decimalLatitude"], "%.6f" % r["decimalLongitude"]])
    print("wrote %s (%d rows)" % (out, len(rows)))


if __name__ == "__main__":
    main()
