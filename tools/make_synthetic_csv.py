#!/usr/bin/env python3
"""
Generate a SYNTHETIC CSV with the same schema as the FongiBase extract.

Purpose: test build.py and index.html end-to-end when the real 219 MB CSV is not
available (and benchmark the 1M-row case).  The data is random - it must never be
presented as real observations.

  python tools/make_synthetic_csv.py --rows 20000  --out test_data/SYNTHETIC_20k.csv
  python tools/make_synthetic_csv.py --rows 1043262 --out test_data/SYNTHETIC_1M.csv
"""
import argparse
import json
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parent.parent

GENERA = ("Amanita Boletus Russula Cortinarius Lactarius Mycena Agaricus Inocybe Hygrophorus "
          "Tricholoma Clitocybe Entoloma Marasmius Pluteus Psathyrella Coprinus Cantharellus "
          "Hebeloma Laccaria Suillus Lepiota Macrolepiota Collybia Armillaria Pholiota Galerina "
          "Panellus Polyporus Trametes Fomes Ganoderma Stereum Peziza Helvella Morchella Xylaria "
          "Hypholoma Gymnopus Lycoperdon Scleroderma Clavaria Ramaria Hydnum Tylopilus Leccinum "
          "Xerocomus Gyroporus Paxillus Gomphidius Cystoderma").split()
EPITHETS = ("alba rubra nigra viridis flava fusca grisea aurea lutea pallida pura vulgaris "
            "silvestris campestris arvensis pratensis communis maxima minor gracilis robusta "
            "elegans mirabilis fragilis amara dulcis acris mollis dura rigida velutina "
            "squamosa laevis rugosa punctata striata zonata radicata nivea candida cinerea "
            "badia castanea ochracea olivacea purpurea rosea violacea cyanea umbrina").split()
FAMILIES = ("Agaricaceae Amanitaceae Boletaceae Cortinariaceae Russulaceae Hygrophoraceae "
            "Tricholomataceae Entolomataceae Inocybaceae Mycenaceae Psathyrellaceae Strophariaceae "
            "Polyporaceae Hymenochaetaceae Pezizaceae Helvellaceae Xylariaceae Cantharellaceae").split()
ORDERS = ["Agaricales", "Russulales", "Polyporales", "Boletales", "Cantharellales",
          "Pezizales", "Xylariales", "Hymenochaetales"]
GUILDS = [("Mycorrhizal", .446), ("Litter saprotroph", .316), ("Wood saprotroph", .181),
          ("Parasite", .02), ("Soil saprotroph", .015), ("Dung saprotroph", .012),
          ("Lichenized", .005), ("Endophyte", .005)]
TROPHIC = {"Mycorrhizal": "Symbiotroph", "Lichenized": "Symbiotroph", "Endophyte": "Symbiotroph",
           "Parasite": "Pathotroph"}
BOOST = {"Pas-de-Calais": 10, "Doubs": 10, "Jura": 9, "Indre": .05, "Lot-et-Garonne": .05}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--rows", type=int, default=20000)
    ap.add_argument("--out", default=str(ROOT / "test_data" / "SYNTHETIC_20k.csv"))
    ap.add_argument("--seed", type=int, default=1)
    a = ap.parse_args()
    rng = np.random.default_rng(a.seed)
    n = a.rows

    feats = json.load(open(ROOT / "data_processed" / "departements.geojson", encoding="utf-8-sig"))["features"]
    names, cents = [], []
    for f in feats:
        g = f["geometry"]
        polys = g["coordinates"] if g["type"] == "MultiPolygon" else [g["coordinates"]]
        ring = max((p[0] for p in polys), key=len)
        pts = np.array(ring)
        names.append(f["properties"]["nom"])
        cents.append(pts.mean(axis=0))
    cents = np.array(cents)
    w = np.array([rng.lognormal(0, .9) * BOOST.get(nm, 1) for nm in names])
    d = rng.choice(len(names), n, p=w / w.sum())

    # taxonomy: 11 556 species = genus x epithet (+ numeric suffix when needed)
    sp_names = []
    for i in range(11556):
        g, e = GENERA[i % len(GENERA)], EPITHETS[(i // len(GENERA)) % len(EPITHETS)]
        k = i // (len(GENERA) * len(EPITHETS))
        sp_names.append("%s %s%s" % (g, e, "" if k == 0 else " var%d" % k))
    z = 1.0 / np.arange(1, len(sp_names) + 1) ** 1.05
    sp = rng.choice(len(sp_names), n, p=z / z.sum())
    genus_of = np.array([i % len(GENERA) for i in range(len(sp_names))])
    fam_of = np.array([FAMILIES[(g * 7) % len(FAMILIES)] for g in range(len(GENERA))])
    ord_of = np.array([ORDERS[(g * 3) % len(ORDERS)] for g in range(len(GENERA))])
    g_sp = genus_of[sp]
    gw = np.array([x[1] for x in GUILDS]); gw = gw / gw.sum()
    guild_of_genus = rng.choice(len(GUILDS), len(GENERA), p=gw)
    guild = np.array([GUILDS[i][0] for i in guild_of_genus[g_sp]], dtype=object)
    guild[rng.random(n) < .121] = ""
    trophic = np.array([TROPHIC.get(g, "Saprotroph") if g else "" for g in guild], dtype=object)

    phylum = np.where(rng.random(n) < .888, "Basidiomycota", "Ascomycota").astype(object)
    phylum[rng.random(n) < .034] = ""

    # dates: recent-heavy, autumn peak
    year = np.where(rng.random(n) < .724, rng.integers(2000, 2022, n), rng.integers(1850, 2000, n))
    month = rng.choice(np.arange(1, 13), n, p=np.array([2, 2, 3, 6, 9, 8, 7, 9, 22, 22, 9, 3.]) / 102.)
    day = rng.integers(1, 29, n)
    date = np.array(["%04d-%02d-%02d" % t for t in zip(year, month, day)], dtype=object)
    date[rng.random(n) < .001] = ""

    # coordinates: ~75 % located, clustered around a few "communes" per département
    lon = cents[d, 0] + rng.normal(0, .25, n)
    lat = cents[d, 1] + rng.normal(0, .2, n)
    lon, lat = np.clip(lon, -4.9, 9.5), np.clip(lat, 41.4, 51.0)
    nocoord = rng.random(n) > .75
    lon_s = np.where(nocoord, "", np.char.mod("%.5f", lon))
    lat_s = np.where(nocoord, "", np.char.mod("%.5f", lat))

    eco = np.array(["Atlantic", "Continental", "Mediterranean", "Montane"], dtype=object)[
        rng.choice(4, n, p=[.35, .38, .1, .17])]
    corine = np.where(rng.random(n) < .118, np.array(["41.1", "41.2", "42.5", "83.31"], dtype=object)[
        rng.integers(0, 4, n)], "")

    df = pd.DataFrame({
        "id": ["SYN-%07d" % i for i in range(n)],
        "genus_species_ref": np.array(sp_names, dtype=object)[sp],
        "genus_ref": np.array(GENERA, dtype=object)[g_sp],
        "species_ref": np.array([s.split(" ", 1)[1] for s in sp_names], dtype=object)[sp],
        "family": fam_of[g_sp], "order": ord_of[g_sp], "class": "Agaricomycetes",
        "phylum": phylum, "cd_ref": "", "trophic_mode": trophic, "guild": guild,
        "date": date, "country": "France", "department": np.array(names, dtype=object)[d],
        "locality": "", "ecoregion": eco, "CORINE_biotope": corine,
        "gps_latitude": lat_s, "gps_longitude": lon_s,
    })
    out = Path(a.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    df.to_csv(out, index=False, encoding="utf-8-sig")
    print("wrote %s (%d rows, SYNTHETIC)" % (out, n))


if __name__ == "__main__":
    main()
